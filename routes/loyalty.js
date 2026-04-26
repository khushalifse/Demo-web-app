'use strict';
const express = require('express');
const router  = express.Router();

const store     = require('../lib/loyalty-store');
const tierCalc  = require('../lib/tier-calc');
const fy        = require('../lib/fiscal-year');

// Reads the persisted status row, recomputes against current bookings + FY,
// and writes back if anything changed (handles lazy April-1 reset).
function getOrCreateStatus(vendorId) {
  const statuses = store.readStatuses();
  const bookings = store.readBookings();
  const tiers    = store.readTiers();

  const existing = statuses.find(s => s.vendorId === vendorId) || null;
  const fresh    = tierCalc.recomputeStatus(vendorId, bookings, tiers, existing);

  const isStale =
    !existing ||
    existing.fiscalYear      !== fresh.fiscalYear ||
    existing.ytdSales        !== fresh.ytdSales ||
    existing.ytdShowCount    !== fresh.ytdShowCount ||
    existing.currentTier     !== fresh.currentTier;

  if (isStale) {
    const idx = statuses.findIndex(s => s.vendorId === vendorId);
    if (idx === -1) statuses.push(fresh); else statuses[idx] = fresh;
    store.writeStatuses(statuses);
  }
  return fresh;
}

router.get('/me', (req, res) => {
  const vendorId = req.session.vendor.id;
  const status   = getOrCreateStatus(vendorId);
  const tiers    = store.readTiers();

  const currentTier = tiers.find(t => t.name === status.currentTier) || null;
  const next        = tierCalc.nextTier(currentTier, tiers);
  const remainingToNext = next ? Math.max(0, next.threshold - status.ytdSales) : 0;

  res.json({
    vendor:           req.session.vendor,
    fiscalYear:       status.fiscalYear,
    daysRemainingInFY: fy.daysRemainingInFiscalYear(),
    ytdSales:         status.ytdSales,
    ytdShowCount:     status.ytdShowCount,
    currentTier:      currentTier,
    discountPercent:  status.discountPercent,
    nextTier:         next,
    remainingToNext,
    manualOverride:   status.manualTierOverride || null,
  });
});

router.get('/tiers', (req, res) => {
  res.json(store.readTiers());
});

// Vendor's full booking history (includes non-AJ shows) with payment & reversal status.
router.get('/history', (req, res) => {
  const vendorId = req.session.vendor.id;
  const bookings = store.readBookings()
    .filter(b => b.vendorId === vendorId)
    .sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));
  res.json(bookings);
});

// Preview: given an amount, show what discount this vendor would receive
// if a booking were made today. Used by the "discounted price preview" widget.
router.get('/preview', (req, res) => {
  const amount = Number(req.query.amount) || 0;
  const status = getOrCreateStatus(req.session.vendor.id);
  const discountPercent = status.discountPercent || 0;
  const discountAmount  = Math.round((amount * discountPercent) / 100);
  res.json({
    fullPrice:       amount,
    discountPercent,
    discountAmount,
    netAfterReversal: amount - discountAmount,
    currentTier:     status.currentTier,
  });
});

module.exports = router;
