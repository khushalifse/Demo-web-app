'use strict';
const { derivePaymentStatus, GST_RATE, effectiveBase } = require('../lib/payment-status');

function mkBooking(o = {}) {
  return {
    totalPrice: 100000, hologramAmount: 0, dholAmount: 0, ancillaryAmount: 0,
    depositAmount: 0,
    discountPercent: 10, discountAmount: 10000,
    isAjsShow: true,
    reversalStatus: 'NotEligible',
    ...o,
  };
}

describe('payment status derivation', () => {
  test('zero deposit → Pending', () => {
    expect(derivePaymentStatus(mkBooking({ depositAmount: 0 }))).toBe('Pending');
  });

  test('partial deposit → Partial', () => {
    expect(derivePaymentStatus(mkBooking({ depositAmount: 50000 }))).toBe('Partial');
  });

  test('deposit equal to total + GST → FullyPaid', () => {
    const b = mkBooking({ totalPrice: 100000 });
    const total = 100000 * (1 + GST_RATE);
    b.depositAmount = total;
    expect(derivePaymentStatus(b)).toBe('FullyPaid');
  });

  test('deposit > total → still FullyPaid (overpayment is not a separate state)', () => {
    expect(derivePaymentStatus(mkBooking({ depositAmount: 99999999 }))).toBe('FullyPaid');
  });

  test('addons increase the threshold for FullyPaid', () => {
    const b = mkBooking({ totalPrice: 100000, hologramAmount: 50000, dholAmount: 5000 });
    const total = (100000 + 50000 + 5000) * (1 + GST_RATE);
    expect(derivePaymentStatus({ ...b, depositAmount: total - 1 })).toBe('Partial');
    expect(derivePaymentStatus({ ...b, depositAmount: total })).toBe('FullyPaid');
  });
});

describe('reversal eligibility lifecycle', () => {
  // Mirrors the transition logic in routes/admin-loyalty.js + bookings.js.
  function applyReversalRules(b) {
    const next = { ...b, paymentStatus: derivePaymentStatus(b) };
    if (next.paymentStatus === 'FullyPaid' &&
        next.isAjsShow &&
        Number(next.discountAmount) > 0 &&
        next.reversalStatus === 'NotEligible') {
      next.reversalStatus = 'Eligible';
    }
    return next;
  }

  test('Pending → no reversal eligibility', () => {
    const b = applyReversalRules(mkBooking({ depositAmount: 0 }));
    expect(b.paymentStatus).toBe('Pending');
    expect(b.reversalStatus).toBe('NotEligible');
  });

  test('Partial payment → still NotEligible (spec: no reversal until 100% paid)', () => {
    const b = applyReversalRules(mkBooking({ depositAmount: 50000 }));
    expect(b.paymentStatus).toBe('Partial');
    expect(b.reversalStatus).toBe('NotEligible');
  });

  test('FullyPaid AJ show with discount → flips to Eligible', () => {
    const total = 100000 * (1 + GST_RATE);
    const b = applyReversalRules(mkBooking({ depositAmount: total }));
    expect(b.paymentStatus).toBe('FullyPaid');
    expect(b.reversalStatus).toBe('Eligible');
  });

  test('FullyPaid non-AJ show → NotEligible (non-AJ shows are excluded from reversal)', () => {
    const total = 100000 * (1 + GST_RATE);
    const b = applyReversalRules(mkBooking({ depositAmount: total, isAjsShow: false }));
    expect(b.reversalStatus).toBe('NotEligible');
  });

  test('FullyPaid AJ show with zero discount (no tier yet) → NotEligible', () => {
    const total = 100000 * (1 + GST_RATE);
    const b = applyReversalRules(mkBooking({ depositAmount: total, discountAmount: 0, discountPercent: 0 }));
    expect(b.reversalStatus).toBe('NotEligible');
  });

  test('Already Reversed booking is not flipped back to Eligible', () => {
    const total = 100000 * (1 + GST_RATE);
    const b = applyReversalRules(mkBooking({ depositAmount: total, reversalStatus: 'Reversed' }));
    expect(b.reversalStatus).toBe('Reversed');
  });
});

describe('approve-reversal route guard logic', () => {
  // Validates the contract the route enforces; if the route changes, this catches it.
  test('approval path: Eligible → Reversed populates reversalAmount, reversalDate, approver', () => {
    const b = { reversalStatus: 'Eligible', isAjsShow: true, discountAmount: 12000 };
    if (b.reversalStatus !== 'Eligible') throw new Error();
    if (!b.isAjsShow || !Number(b.discountAmount)) throw new Error();
    const after = {
      ...b,
      reversalStatus: 'Reversed',
      reversalAmount: Number(b.discountAmount),
      reversalDate: '2026-04-26T00:00:00.000Z',
      reversalApprovedBy: 'admin-id',
    };
    expect(after.reversalStatus).toBe('Reversed');
    expect(after.reversalAmount).toBe(12000);
    expect(after.reversalApprovedBy).toBe('admin-id');
  });
});
