'use strict';
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');

const store    = require('../lib/loyalty-store');
const tierCalc = require('../lib/tier-calc');
const fy       = require('../lib/fiscal-year');
const { derivePaymentStatus, GST_RATE, effectiveBase } = require('../lib/payment-status');

// Recomputes and persists a vendor's status row. Called whenever something
// affects YTD: booking added/edited/cancelled, payment recorded, reversal
// processed, manual show entry, or tier override.
function refreshStatus(vendorId) {
  if (!vendorId) return null;
  const statuses = store.readStatuses();
  const bookings = store.readBookings();
  const tiers    = store.readTiers();
  const existing = statuses.find(s => s.vendorId === vendorId) || null;
  const fresh    = tierCalc.recomputeStatus(vendorId, bookings, tiers, existing);
  const idx = statuses.findIndex(s => s.vendorId === vendorId);
  if (idx === -1) statuses.push(fresh); else statuses[idx] = fresh;
  store.writeStatuses(statuses);
  return fresh;
}

// ─── GET /api/admin/loyalty/vendors ──────────────────────────────────────────
// Vendor list with current tier, YTD sales, show count.
router.get('/vendors', (req, res) => {
  const vendors  = store.readVendors();
  const bookings = store.readBookings();
  const tiers    = store.readTiers();
  const statuses = store.readStatuses();

  const rows = vendors.map(v => {
    const existing = statuses.find(s => s.vendorId === v.id) || null;
    const fresh    = tierCalc.recomputeStatus(v.id, bookings, tiers, existing);
    return {
      id: v.id, name: v.name, email: v.email, phone: v.phone,
      companyName: v.companyName, createdAt: v.createdAt,
      fiscalYear: fresh.fiscalYear,
      ytdSales: fresh.ytdSales,
      ytdShowCount: fresh.ytdShowCount,
      currentTier: fresh.currentTier,
      discountPercent: fresh.discountPercent,
      manualTierOverride: fresh.manualTierOverride,
    };
  });
  res.json(rows);
});

// ─── GET /api/admin/loyalty/vendor/:id ───────────────────────────────────────
router.get('/vendor/:id', (req, res) => {
  const vendor = store.readVendors().find(v => v.id === req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  const status = refreshStatus(vendor.id);
  const history = store.readBookings()
    .filter(b => b.vendorId === vendor.id)
    .sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));
  res.json({
    vendor: { id: vendor.id, name: vendor.name, email: vendor.email, phone: vendor.phone, companyName: vendor.companyName },
    status,
    history,
  });
});

// ─── POST /api/admin/loyalty/manual-show ─────────────────────────────────────
// Admin adds a show on behalf of a vendor. Creates a booking record with
// vendorId set, flagged as a manual entry in manual-show-entries.json.
router.post('/manual-show', (req, res) => {
  const {
    vendorId, showName, showDate, amount,
    isAjsShow = true, paymentStatus = 'Pending', depositAmount = 0,
    venue = '', eventType = '', remarks = '',
  } = req.body || {};

  if (!vendorId || !showName || !showDate || !amount) {
    return res.status(400).json({ error: 'vendorId, showName, showDate and amount are required.' });
  }
  const vendors = store.readVendors();
  if (!vendors.find(v => v.id === vendorId)) {
    return res.status(404).json({ error: 'Vendor not found.' });
  }

  // Snapshot the vendor's tier at booking-creation time. Per spec, tier
  // crossings only apply to FUTURE bookings — so we capture discount% now.
  const status = refreshStatus(vendorId);
  const discountPercent = (isAjsShow && status.discountPercent) ? status.discountPercent : 0;
  const fullPrice = Number(amount) || 0;
  const discountAmount = Math.round((fullPrice * discountPercent) / 100);

  const bookings = store.readBookings();
  const bookingId = uuidv4();
  const booking = {
    id: bookingId,
    vendorId,
    hostName: vendors.find(v => v.id === vendorId).name,
    clientName: vendors.find(v => v.id === vendorId).name,
    countryCode: '+91',
    phone: vendors.find(v => v.id === vendorId).phone || '',
    eventDate: showDate,
    eventDateTo: null,
    additionalDates: [],
    additionalDateDetails: [],
    eventTime: '',
    venue,
    eventType: eventType || showName,
    hologram: false, hologramAmount: 0,
    dholRequired: false, dholAmount: 0,
    ancillaryActs: false, ancillaryActName: null, ancillaryAmount: 0,
    maddy: 0, amnish: 0, rajat: 0, hardik: 0,
    remarks,
    totalPrice: fullPrice,
    fullPrice,
    discountPercent,
    discountAmount,
    depositAmount: Number(depositAmount) || 0,
    depositPaid: false,
    paymentMode: null,
    bookingStatus: 'Confirmed',
    paymentStatus,
    reversalStatus: 'NotEligible',
    reversalAmount: 0,
    reversalDate: null,
    reversalApprovedBy: null,
    isAjsShow: !!isAjsShow,
    paymentLinks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // Recompute paymentStatus from depositAmount to keep it consistent.
  booking.paymentStatus = derivePaymentStatus(booking);
  if (booking.paymentStatus === 'FullyPaid' && booking.isAjsShow && discountAmount > 0) {
    booking.reversalStatus = 'Eligible';
  }

  bookings.push(booking);
  store.writeBookings(bookings);

  const manualShows = store.readManualShows();
  manualShows.push({
    id: uuidv4(),
    bookingId,
    vendorId,
    addedBy: req.session.user.id,
    addedByName: req.session.user.name,
    showName,
    showDate,
    amount: fullPrice,
    paymentStatus: booking.paymentStatus,
    reason: req.body.reason || null,
    createdAt: new Date().toISOString(),
  });
  store.writeManualShows(manualShows);

  refreshStatus(vendorId);
  res.status(201).json(booking);
});

// ─── PATCH /api/admin/loyalty/booking/:id/payment ────────────────────────────
// Admin marks a payment received against a booking. Recomputes paymentStatus;
// flips reversalStatus to Eligible when fully paid (AJ shows w/ discount only).
router.patch('/booking/:id/payment', (req, res) => {
  const { addAmount, paymentMode } = req.body || {};
  const added = Number(addAmount) || 0;
  if (added <= 0) return res.status(400).json({ error: 'addAmount must be > 0' });

  const bookings = store.readBookings();
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });
  const b = bookings[idx];

  const totalWithGST = effectiveBase(b) * (1 + GST_RATE);
  const newDeposit   = (Number(b.depositAmount) || 0) + added;
  bookings[idx].depositAmount = newDeposit;
  bookings[idx].depositPaid   = newDeposit >= totalWithGST;
  if (paymentMode) bookings[idx].paymentMode = paymentMode;
  bookings[idx].paymentStatus = derivePaymentStatus(bookings[idx]);

  if (bookings[idx].paymentStatus === 'FullyPaid' &&
      bookings[idx].isAjsShow &&
      Number(bookings[idx].discountAmount) > 0 &&
      bookings[idx].reversalStatus === 'NotEligible') {
    bookings[idx].reversalStatus = 'Eligible';
  }
  bookings[idx].updatedAt = new Date().toISOString();
  store.writeBookings(bookings);

  if (bookings[idx].vendorId) refreshStatus(bookings[idx].vendorId);
  res.json(bookings[idx]);
});

// ─── PATCH /api/admin/loyalty/booking/:id/approve-reversal ───────────────────
router.patch('/booking/:id/approve-reversal', (req, res) => {
  const bookings = store.readBookings();
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });
  const b = bookings[idx];

  if (b.reversalStatus !== 'Eligible') {
    return res.status(400).json({ error: `Reversal not eligible (current: ${b.reversalStatus}).` });
  }
  if (!b.isAjsShow || !Number(b.discountAmount)) {
    return res.status(400).json({ error: 'Booking has no reversible discount.' });
  }

  bookings[idx].reversalStatus     = 'Reversed';
  bookings[idx].reversalAmount     = Number(b.discountAmount) || 0;
  bookings[idx].reversalDate       = new Date().toISOString();
  bookings[idx].reversalApprovedBy = req.session.user.id;
  bookings[idx].updatedAt          = new Date().toISOString();
  store.writeBookings(bookings);
  res.json(bookings[idx]);
});

// ─── POST /api/admin/loyalty/vendor/:id/override-tier ───────────────────────
router.post('/vendor/:id/override-tier', (req, res) => {
  const { tier, reason } = req.body || {};
  if (tier && !store.readTiers().find(t => t.name === tier)) {
    return res.status(400).json({ error: `Unknown tier "${tier}".` });
  }

  const statuses = store.readStatuses();
  let row = statuses.find(s => s.vendorId === req.params.id);
  if (!row) {
    row = tierCalc.recomputeStatus(req.params.id, store.readBookings(), store.readTiers(), null);
    statuses.push(row);
  }

  const audit = store.readOverrideAudit();
  audit.push({
    id: uuidv4(),
    vendorId: req.params.id,
    fromTier: row.currentTier,
    toTier:   tier || null,
    reason:   reason || null,
    by:       req.session.user.id,
    byName:   req.session.user.name,
    at:       new Date().toISOString(),
  });
  store.writeOverrideAudit(audit);

  if (tier) {
    row.manualTierOverride = {
      tier, reason: reason || null,
      by: req.session.user.id, at: new Date().toISOString(),
    };
  } else {
    row.manualTierOverride = null;
  }
  store.writeStatuses(statuses);

  const refreshed = refreshStatus(req.params.id);
  res.json(refreshed);
});

// ─── GET /api/admin/loyalty/audit ────────────────────────────────────────────
router.get('/audit', (req, res) => {
  res.json(store.readOverrideAudit().sort((a, b) => new Date(b.at) - new Date(a.at)));
});

// ─── GET /api/admin/loyalty/report ───────────────────────────────────────────
// FY tier distribution + totals. Defaults to current FY; ?fy=2025-2026 supported.
router.get('/report', (req, res) => {
  const fyLabel = req.query.fy || fy.getCurrentFiscalYear();
  const vendors  = store.readVendors();
  const bookings = store.readBookings();
  const tiers    = store.readTiers();

  const tierCounts = Object.fromEntries(tiers.map(t => [t.name, 0]));
  tierCounts['None'] = 0;

  const perVendor = vendors.map(v => {
    const ytd = tierCalc.computeYtd(bookings, v.id, fyLabel);
    const tier = tierCalc.tierFromSales(ytd.ytdSales, tiers);
    const tierName = tier ? tier.name : 'None';
    tierCounts[tierName]++;
    return {
      vendorId: v.id, name: v.name, companyName: v.companyName,
      ytdSales: ytd.ytdSales, ytdShowCount: ytd.ytdShowCount,
      currentTier: tierName,
    };
  });

  const totalSales = perVendor.reduce((s, v) => s + v.ytdSales, 0);
  const totalShows = perVendor.reduce((s, v) => s + v.ytdShowCount, 0);

  res.json({ fiscalYear: fyLabel, tierCounts, totalSales, totalShows, vendors: perVendor });
});

module.exports = router;
