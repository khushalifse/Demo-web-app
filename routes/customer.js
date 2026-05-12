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

// Apply admin-assigned tier override as a floor — vendor never drops below it,
// but can graduate higher organically.
function applyTierFloor(computed, overrideName, tiers) {
  if (!overrideName) return computed;
  const ov = tiers.find(t => (t.name || '').toLowerCase() === overrideName.toLowerCase());
  if (!ov) return computed;
  const cur = computed || { threshold: 0 };
  return ((Number(cur.threshold) || 0) < (Number(ov.threshold) || 0)) ? ov : cur;
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
  const { current } = deriveTier(businessGross, tiers);
  // Every vendor starts at Bronze (threshold 0). Admin can override to a higher
  // floor — that's applied here so the vendor sees at least the assigned tier.
  const computed = current
    ? { name: current.name, discountPercent: current.discountPercent, threshold: current.threshold }
    : { name: 'Bronze', discountPercent: 5, threshold: 0 };
  const tier = applyTierFloor(computed, me.tierOverride, tiers) || computed;

  // The "next tier" must always be ABOVE the effective (floored) tier — not
  // above the raw-business tier. Otherwise a vendor assigned Silver as a floor
  // sees "Silver is your next tier" even though they're already at Silver.
  const sortedTiers   = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const effectiveT    = Number(tier.threshold) || 0;
  const nextTierConf  = sortedTiers.find(t => Number(t.threshold) > effectiveT) || null;
  // Progress bar should fill within the CURRENT tier's band — a Gold-floor
  // vendor with ₹30L of business is 20% of the way from Gold (₹25L) to
  // Platinum (₹50L), not 60% of the way from zero. Same idea for every tier:
  // each band runs from the tier's own threshold to the next one's.
  // For "remaining" we treat the floor as the starting line too — if a
  // Gold-floor vendor has only ₹0 of real business, they still see "₹25L
  // away from Platinum", not "₹50L away".
  const nextTier = nextTierConf
    ? (() => {
        const baseline   = Math.max(businessGross, effectiveT);
        const bandSize   = Math.max(1, Number(nextTierConf.threshold) - effectiveT);
        const withinBand = Math.max(0, businessGross - effectiveT);
        return {
          name: nextTierConf.name,
          threshold: nextTierConf.threshold,
          remaining: Math.max(0, nextTierConf.threshold - baseline),
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
    const computed = deriveTier(running, tiers).current
                  || { name: 'Bronze', discountPercent: 5 };
    // Use the tier override that was active on this event's date — past
    // events keep their original tier even if the override has been changed.
    const overrideOnDate = overrideAtDate(me, b.eventDate);
    const ttat = applyTierFloor(computed, overrideOnDate, tiers) || computed;
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
