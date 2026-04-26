'use strict';

const GST_RATE = 0.18;

function effectiveBase(b) {
  return (Number(b.totalPrice)      || 0) +
         (Number(b.hologramAmount)  || 0) +
         (Number(b.dholAmount)      || 0) +
         (Number(b.ancillaryAmount) || 0);
}

// Derived from depositAmount vs (effectiveBase * 1.18). Stored on the booking
// for reporting convenience but always recomputed when payment changes.
function derivePaymentStatus(b) {
  const total = effectiveBase(b) * (1 + GST_RATE);
  const paid  = Number(b.depositAmount) || 0;
  if (paid <= 0)        return 'Pending';
  if (paid >= total)    return 'FullyPaid';
  return 'Partial';
}

module.exports = { GST_RATE, effectiveBase, derivePaymentStatus };
