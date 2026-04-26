'use strict';
const store = require('./loyalty-store');
const { derivePaymentStatus } = require('./payment-status');

// Ensures every booking carries the loyalty/reversal fields. Idempotent: only
// rewrites the file when at least one record actually changed.
function run() {
  const bookings = store.readBookings();
  let changed = false;

  const migrated = bookings.map(b => {
    const next = { ...b };
    let touched = false;

    if (next.vendorId === undefined)         { next.vendorId = null;        touched = true; }
    if (next.isAjsShow === undefined)        { next.isAjsShow = true;       touched = true; }
    if (next.fullPrice === undefined)        { next.fullPrice = Number(b.totalPrice) || 0; touched = true; }
    if (next.discountPercent === undefined)  { next.discountPercent = 0;    touched = true; }
    if (next.discountAmount === undefined)   { next.discountAmount = 0;     touched = true; }
    if (next.paymentStatus === undefined)    { next.paymentStatus = derivePaymentStatus(next); touched = true; }
    if (next.reversalStatus === undefined)   { next.reversalStatus = 'NotEligible'; touched = true; }
    if (next.reversalAmount === undefined)   { next.reversalAmount = 0;     touched = true; }
    if (next.reversalDate === undefined)     { next.reversalDate = null;    touched = true; }
    if (next.reversalApprovedBy === undefined){ next.reversalApprovedBy = null; touched = true; }

    if (touched) changed = true;
    return next;
  });

  if (changed) store.writeBookings(migrated);
  return { changed, count: migrated.length };
}

module.exports = { run };
