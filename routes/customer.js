'use strict';
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const store   = require('../lib/loyalty-store');
const { readCustomers, safeCustomer } = require('../lib/customer-store');

const BOOKINGS_PATH            = path.join(__dirname, '..', 'data', 'bookings.json');
const COMMISSION_PAYMENTS_PATH = path.join(__dirname, '..', 'data', 'commission-payments.json');

function readBookings() {
  try { return JSON.parse(fs.readFileSync(BOOKINGS_PATH, 'utf8')); }
  catch { return []; }
}
function readPayments() {
  try { return JSON.parse(fs.readFileSync(COMMISSION_PAYMENTS_PATH, 'utf8')); }
  catch { return []; }
}

function effectiveBase(b) {
  return (Number(b.totalPrice)      || 0) +
         (Number(b.hologramAmount)  || 0) +
         (Number(b.dholAmount)      || 0) +
         (Number(b.ancillaryAmount) || 0);
}

function deriveTier(businessTotal, tiers) {
  // Pick the highest tier whose threshold is met. Returns the next tier too.
  let current = null;
  let next    = null;
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  for (const t of sorted) {
    if (businessTotal >= t.threshold) current = t;
    else if (!next) next = t;
  }
  return { current, next };
}

// Convert an admin-assigned tier override into a head-start business credit.
// Effective business = real business + this credit. A vendor placed on Gold
// (threshold ₹25L) is treated as if they walked in with ₹25L already given,
// so logging ₹30L of real business pushes them past Platinum (₹50L).
function floorCredit(overrideName, tiers) {
  if (!overrideName) return 0;
  const ov = tiers.find(t => (t.name || '').toLowerCase() === overrideName.toLowerCase());
  return ov ? (Number(ov.threshold) || 0) : 0;
}

// Find the tier override that was effective on a given date by walking the
// history (sorted oldest-first). Returns null if no override applied yet.
// `customer.tierOverride` is the live latest value used for new entries; we
// only consult history for events that may pre-date the latest change.
function overrideAtDate(customer, dateISO) {
  if (!Array.isArray(customer.tierOverrideHistory) || !customer.tierOverrideHistory.length) {
    // Legacy: no history yet — apply the single current override to all events.
    return customer.tierOverride || null;
  }
  const history = [...customer.tierOverrideHistory].sort(
    (a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom)
  );
  let active = null;
  for (const h of history) {
    if (h.effectiveFrom <= dateISO) active = h.tier || null;
    else break;
  }
  return active;
}

router.get('/me', (req, res) => {
  res.json({ customer: req.session.customer });
});

// Read-only dashboard: tier status, total commission, per-event commission breakdown.
router.get('/dashboard', (req, res) => {
  const customerId = req.session.customer.id;
  const customers  = readCustomers();
  const me         = customers.find(c => c.id === customerId);
  if (!me) return res.status(404).json({ error: 'Customer record not found.' });

  const all        = readBookings();
  const myBookings = all.filter(b => b.customerId === customerId);
  const active     = myBookings.filter(b => b.bookingStatus !== 'Cancelled');
  // Direct-by-client entries are listed in events but excluded from loyalty math.
  const loyaltyActive = active.filter(b => !b.directByClient);

  const businessGross = loyaltyActive.reduce((sum, b) => sum + effectiveBase(b), 0);

  const tiers = store.readTiers();
  // Add the override's threshold as a "head-start" credit, then derive the
  // tier from the combined effective business. This makes the floor additive
  // rather than a mere cap — a Gold-floor vendor who logs ₹30L of business is
  // treated as having ₹55L total and graduates to Platinum.
  const credit          = floorCredit(me.tierOverride, tiers);
  const effectiveTotal  = businessGross + credit;
  const { current }     = deriveTier(effectiveTotal, tiers);
  const tier = current
    ? { name: current.name, discountPercent: current.discountPercent, threshold: current.threshold }
    : { name: 'Bronze', discountPercent: 5, threshold: 0 };

  // "Next tier" is the lowest one whose threshold is above the vendor's
  // effective business (real + credit). Progress / remaining are measured
  // in REAL business — the credit is already baked into the current tier
  // they're sitting on.
  const sortedTiers   = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const currentT      = Number(tier.threshold) || 0;
  const nextTierConf  = sortedTiers.find(t => Number(t.threshold) > effectiveTotal) || null;
  const nextTier = nextTierConf
    ? (() => {
        // Real business needed to reach the next tier, taking the credit into
        // account. e.g. Gold-floor vendor with ₹0 real business → needs ₹25L
        // more real business to hit Platinum (₹50L threshold − ₹25L credit).
        const realRemaining = Math.max(0, Number(nextTierConf.threshold) - effectiveTotal);
        // Progress fills within the current tier's band.
        const bandSize   = Math.max(1, Number(nextTierConf.threshold) - currentT);
        const withinBand = Math.max(0, effectiveTotal - currentT);
        return {
          name: nextTierConf.name,
          threshold: nextTierConf.threshold,
          remaining: realRemaining,
          progressPercent: Math.min(100, Math.round((withinBand / bandSize) * 100)),
          extraReversalRate: Math.max(0, (nextTierConf.discountPercent || 0) - (tier.discountPercent || 0)),
        };
      })()
    : null;

  // Per-event commission breakdown — historically accurate. Walk the bookings
  // chronologically (oldest first) and compute each event's tier based on
  // CUMULATIVE business up to and including that event. This way an event that
  // crosses a tier threshold is credited at the higher rate, while earlier
  // events stay at the lower tier they were added under.
  const nextRate = nextTierConf ? Number(nextTierConf.discountPercent) || 0 : Number(tier.discountPercent) || 0;
  const chronological = [...active].sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));

  let running = 0;
  const chrono = chronological.map(b => {
    const total = effectiveBase(b);
    const direct = !!b.directByClient;
    if (!direct) running += total;
    // Use the tier override that was active on this event's date — past
    // events keep their original tier even if the override has been changed.
    const overrideOnDate = overrideAtDate(me, b.eventDate);
    const eventCredit    = floorCredit(overrideOnDate, tiers);
    const ttat = deriveTier(running + eventCredit, tiers).current
              || { name: 'Bronze', discountPercent: 5 };
    const rate = direct ? 0 : (Number(ttat.discountPercent) || 0);
    const earned          = direct ? 0 : Math.round(total * rate     / 100);
    const wouldEarnAtNext = direct ? 0 : Math.round(total * nextRate / 100);
    return {
      id:               b.id,
      eventDate:        b.eventDate,
      eventDateTo:      b.eventDateTo || null,
      eventType:        b.eventType,
      venue:            b.venue,
      clientName:       b.clientName || '',
      hostName:         b.hostName   || b.clientName,
      bookingStatus:    b.bookingStatus,
      directByClient:   direct,
      total,
      tierAtTime:       direct ? '—' : ttat.name,
      rate,
      commissionEarned: earned,
      wouldEarnAtNext,
    };
  });

  // Display newest-first.
  const events = chrono.slice().sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));

  const totalCommissionEarned = chrono.reduce((s, e) => s + e.commissionEarned, 0);
  const wouldEarnAtNextTotal  = chrono.reduce((s, e) => s + e.wouldEarnAtNext,  0);
  const upliftIfNext          = Math.max(0, wouldEarnAtNextTotal - totalCommissionEarned);

  // ── Loyalty programme expiry — 12 months from account creation ───────────
  const startedAt = new Date(me.createdAt || Date.now());
  const expiresAt = new Date(startedAt);
  expiresAt.setMonth(expiresAt.getMonth() + 12);
  const now       = new Date();
  const msPerDay  = 24 * 60 * 60 * 1000;
  const daysToExpiry = Math.ceil((expiresAt - now) / msPerDay);
  const loyaltyExpired = daysToExpiry <= 0;

  // ── Commission payments paid out to this vendor ─────────────────────────
  const payments = readPayments()
    .filter(p => p.customerId === customerId)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(p => ({
      id:     p.id,
      amount: Number(p.amount) || 0,
      mode:   p.mode,
      date:   p.date,
      notes:  p.notes || '',
    }));
  const totalCommissionPaid    = payments.reduce((s, p) => s + p.amount, 0);
  const commissionOutstanding  = Math.max(0, totalCommissionEarned - totalCommissionPaid);

  // ── Per-event Paid / Not Paid status (FIFO allocation against payments) ─
  // Walk events oldest-first, accumulate earned commission. An event is "Paid"
  // when cumulative earned UP TO AND INCLUDING it is already covered by total paid.
  // Direct entries get 'na' (no commission to pay). Mutates the same objects
  // referenced by `events` (which is a slice of `chrono`) — both arrays see it.
  let earnedSoFar = 0;
  for (const ev of chrono) {
    if (ev.directByClient || !ev.commissionEarned) {
      ev.commissionStatus = 'na';
      continue;
    }
    const prevEarnedSoFar = earnedSoFar;
    earnedSoFar += ev.commissionEarned;
    if (earnedSoFar <= totalCommissionPaid)            ev.commissionStatus = 'paid';
    else if (prevEarnedSoFar < totalCommissionPaid)    ev.commissionStatus = 'partial';
    else                                               ev.commissionStatus = 'unpaid';
  }

  res.json({
    customer:               safeCustomer(me),
    businessGross,
    bookingsCount:          myBookings.length,
    confirmedCount:         active.filter(b => b.bookingStatus === 'Confirmed' || b.bookingStatus === 'Completed').length,
    tier,
    nextTier,
    tiers,
    events,
    totalCommissionEarned,
    wouldEarnAtNextTotal,
    upliftIfNext,
    payments,
    totalCommissionPaid,
    commissionOutstanding,
    loyalty: {
      startedAt:  startedAt.toISOString(),
      expiresAt:  expiresAt.toISOString(),
      daysToExpiry,
      expired:    loyaltyExpired,
    },
  });
});

// Read-only list of the customer's own bookings, in case the front-end needs it directly.
router.get('/bookings', (req, res) => {
  const customerId = req.session.customer.id;
  const all = readBookings();
  const mine = all
    .filter(b => b.customerId === customerId)
    .sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));
  res.json(mine);
});

// Booking creation by the customer is disabled — the customer portal is view-only.
// The admin creates bookings on the customer's behalf in the main panel.
router.post('/bookings', (req, res) => {
  res.status(403).json({
    error: 'Booking creation is not available on the customer portal. Please contact your account manager.',
  });
});

module.exports = router;
