'use strict';
const fy = require('./fiscal-year');

// effectiveBase mirrors routes/bookings.js: base + addons. Used as the AJ-show
// sales contribution (pre-GST). GST is excluded so tier thresholds match the
// "Annual Sales" figures in the spec (₹10L / ₹20L / ₹30L are sales, not gross).
function effectiveBase(b) {
  return (Number(b.totalPrice)      || 0) +
         (Number(b.hologramAmount)  || 0) +
         (Number(b.dholAmount)      || 0) +
         (Number(b.ancillaryAmount) || 0);
}

// A booking contributes to YTD sales/show-count only if it is an AJ show,
// not cancelled, and its event date falls in the current fiscal year.
function bookingCountsForTier(b, fyLabel) {
  if (b.isAjsShow === false) return false;
  if (b.bookingStatus === 'Cancelled') return false;
  if (!fy.isBookingInFiscalYear(b.eventDate, fyLabel)) return false;
  return true;
}

function computeYtd(bookings, vendorId, fyLabel) {
  const matching = bookings.filter(b =>
    b.vendorId === vendorId && bookingCountsForTier(b, fyLabel)
  );
  const ytdSales = matching.reduce((sum, b) => sum + effectiveBase(b), 0);
  return { ytdSales, ytdShowCount: matching.length };
}

// Returns the highest tier whose threshold is met, or null if below Silver.
function tierFromSales(ytdSales, tiers) {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  let achieved = null;
  for (const t of sorted) {
    if (ytdSales >= t.threshold) achieved = t;
  }
  return achieved; // null or { name, threshold, discountPercent }
}

function nextTier(currentTier, tiers) {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  if (!currentTier) return sorted[0] || null;
  const idx = sorted.findIndex(t => t.name === currentTier.name);
  return idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;
}

// Recalculates a vendor's loyalty status. Lazy-resets if the stored fiscalYear
// is stale (i.e. April 1 has passed). Returns the up-to-date status row;
// callers are responsible for persisting if they want it written back.
function recomputeStatus(vendorId, bookings, tiers, existingStatus) {
  const currentFy = fy.getCurrentFiscalYear();
  const stale = !existingStatus || existingStatus.fiscalYear !== currentFy;

  const { ytdSales, ytdShowCount } = computeYtd(bookings, vendorId, currentFy);
  const auto = tierFromSales(ytdSales, tiers);

  const override = !stale && existingStatus && existingStatus.manualTierOverride
    ? existingStatus.manualTierOverride
    : null;

  const currentTier = override
    ? tiers.find(t => t.name === override.tier) || auto
    : auto;

  return {
    vendorId,
    fiscalYear: currentFy,
    ytdSales,
    ytdShowCount,
    currentTier: currentTier ? currentTier.name : null,
    discountPercent: currentTier ? currentTier.discountPercent : 0,
    manualTierOverride: override,
    lastRecalculatedAt: new Date().toISOString(),
  };
}

module.exports = {
  effectiveBase,
  bookingCountsForTier,
  computeYtd,
  tierFromSales,
  nextTier,
  recomputeStatus,
};
