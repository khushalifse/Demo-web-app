'use strict';
const { computeYtd, tierFromSales, nextTier, recomputeStatus, effectiveBase, bookingCountsForTier } = require('../lib/tier-calc');
const { getCurrentFiscalYear, getFiscalYearForDate } = require('../lib/fiscal-year');

const tiers = [
  { name: 'Silver',   threshold: 1000000, discountPercent: 10 },
  { name: 'Gold',     threshold: 2000000, discountPercent: 15 },
  { name: 'Platinum', threshold: 3000000, discountPercent: 20 },
];

const FY = getCurrentFiscalYear();
const FY_START_YEAR = parseInt(FY.split('-')[0], 10);
const inFy = m => `${FY_START_YEAR}-${String(m).padStart(2, '0')}-15`;          // m is fiscal-month (1=Apr)
const fyDate = (fyMonth) => {
  // fyMonth 1..12 maps to Apr..Mar across the FY
  const calendarMonth = ((fyMonth - 1 + 3) % 12);
  const calendarYear  = (calendarMonth >= 3) ? FY_START_YEAR : FY_START_YEAR + 1;
  return `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-15`;
};

function mkBooking(overrides = {}) {
  return {
    id: 'b' + Math.random(),
    vendorId: 'v1',
    eventDate: fyDate(2),         // mid-FY
    bookingStatus: 'Confirmed',
    isAjsShow: true,
    totalPrice: 100000,
    hologramAmount: 0, dholAmount: 0, ancillaryAmount: 0,
    ...overrides,
  };
}

describe('tier thresholds', () => {
  test('₹0 → no tier', () => {
    expect(tierFromSales(0, tiers)).toBeNull();
  });
  test('₹9,99,999 → still no tier (just under Silver)', () => {
    expect(tierFromSales(999999, tiers)).toBeNull();
  });
  test('exactly ₹10L → Silver', () => {
    expect(tierFromSales(1000000, tiers).name).toBe('Silver');
  });
  test('₹15L → Silver (between Silver and Gold)', () => {
    expect(tierFromSales(1500000, tiers).name).toBe('Silver');
  });
  test('exactly ₹20L → Gold', () => {
    expect(tierFromSales(2000000, tiers).name).toBe('Gold');
  });
  test('exactly ₹30L → Platinum', () => {
    expect(tierFromSales(3000000, tiers).name).toBe('Platinum');
  });
  test('₹50L → still Platinum (highest)', () => {
    expect(tierFromSales(5000000, tiers).name).toBe('Platinum');
  });
});

describe('nextTier', () => {
  test('null → Silver', () => {
    expect(nextTier(null, tiers).name).toBe('Silver');
  });
  test('Silver → Gold', () => {
    expect(nextTier(tiers[0], tiers).name).toBe('Gold');
  });
  test('Gold → Platinum', () => {
    expect(nextTier(tiers[1], tiers).name).toBe('Platinum');
  });
  test('Platinum → null (top)', () => {
    expect(nextTier(tiers[2], tiers)).toBeNull();
  });
});

describe('YTD computation', () => {
  test('sums effectiveBase across qualifying bookings only', () => {
    const bookings = [
      mkBooking({ totalPrice: 600000 }),
      mkBooking({ totalPrice: 400000, hologramAmount: 50000 }),
    ];
    const { ytdSales, ytdShowCount } = computeYtd(bookings, 'v1', FY);
    expect(ytdSales).toBe(600000 + 400000 + 50000);
    expect(ytdShowCount).toBe(2);
  });

  test('excludes non-AJ shows', () => {
    const bookings = [
      mkBooking({ totalPrice: 1000000 }),
      mkBooking({ totalPrice: 1000000, isAjsShow: false }),
    ];
    expect(computeYtd(bookings, 'v1', FY).ytdSales).toBe(1000000);
  });

  test('excludes cancelled bookings (handles refund/cancellation case)', () => {
    const bookings = [
      mkBooking({ totalPrice: 1500000 }),
      mkBooking({ totalPrice: 800000, bookingStatus: 'Cancelled' }),
    ];
    expect(computeYtd(bookings, 'v1', FY).ytdSales).toBe(1500000);
  });

  test('excludes bookings outside the active fiscal year', () => {
    const lastFy = `${FY_START_YEAR - 1}-12-15`;
    const bookings = [
      mkBooking({ totalPrice: 2000000, eventDate: lastFy }),
      mkBooking({ totalPrice: 500000 }),
    ];
    expect(computeYtd(bookings, 'v1', FY).ytdSales).toBe(500000);
  });

  test('excludes other vendors', () => {
    const bookings = [
      mkBooking({ vendorId: 'v1', totalPrice: 500000 }),
      mkBooking({ vendorId: 'v2', totalPrice: 5000000 }),
    ];
    expect(computeYtd(bookings, 'v1', FY).ytdSales).toBe(500000);
  });
});

describe('recomputeStatus', () => {
  test('produces tier and discount from current bookings', () => {
    const bookings = [mkBooking({ totalPrice: 2500000 })];
    const status = recomputeStatus('v1', bookings, tiers, null);
    expect(status.currentTier).toBe('Gold');
    expect(status.discountPercent).toBe(15);
    expect(status.fiscalYear).toBe(FY);
  });

  test('lazy-resets when stored fiscalYear is stale', () => {
    const bookings = [mkBooking({ totalPrice: 1000000 })];
    const stale = { vendorId: 'v1', fiscalYear: '1999-2000', ytdSales: 99999999, currentTier: 'Platinum' };
    const status = recomputeStatus('v1', bookings, tiers, stale);
    expect(status.fiscalYear).toBe(FY);
    expect(status.ytdSales).toBe(1000000);
    expect(status.currentTier).toBe('Silver');
  });

  test('honours manual override when not stale', () => {
    const bookings = [mkBooking({ totalPrice: 500000 })]; // would otherwise be no tier
    const existing = {
      vendorId: 'v1', fiscalYear: FY, ytdSales: 500000, currentTier: null,
      manualTierOverride: { tier: 'Gold', reason: 'VIP', by: 'admin', at: new Date().toISOString() },
    };
    const status = recomputeStatus('v1', bookings, tiers, existing);
    expect(status.currentTier).toBe('Gold');
    expect(status.discountPercent).toBe(15);
  });

  test('drops manual override after FY rollover (override does not persist across years)', () => {
    const bookings = [mkBooking({ totalPrice: 1200000 })];
    const stale = {
      vendorId: 'v1', fiscalYear: '1999-2000',
      manualTierOverride: { tier: 'Platinum', reason: 'old', by: 'admin', at: '1999-04-01' },
    };
    const status = recomputeStatus('v1', bookings, tiers, stale);
    expect(status.manualTierOverride).toBeNull();
    expect(status.currentTier).toBe('Silver');
  });
});

describe('mid-year tier crossing (spec edge case)', () => {
  // Per spec: when a vendor crosses a tier mid-year, the new discount applies
  // ONLY to future bookings. tier-calc reflects the *current* tier; the
  // route layer (snapshotLoyaltyFields) is responsible for snapshotting
  // discountPercent at booking-creation time. This test documents the contract.
  test('crossing into Gold updates currentTier; existing snapshots are untouched', () => {
    const past = mkBooking({ id: 'past', totalPrice: 800000, discountPercent: 10, discountAmount: 80000 });
    const recent = mkBooking({ id: 'recent', totalPrice: 1300000 }); // pushes total > ₹20L
    const status = recomputeStatus('v1', [past, recent], tiers, null);
    expect(status.ytdSales).toBe(2100000);
    expect(status.currentTier).toBe('Gold');
    // Past booking's snapshot is the responsibility of the booking record itself.
    expect(past.discountPercent).toBe(10);
  });
});

describe('effectiveBase + bookingCountsForTier helpers', () => {
  test('effectiveBase sums totalPrice + addons', () => {
    expect(effectiveBase({ totalPrice: 100, hologramAmount: 10, dholAmount: 5, ancillaryAmount: 2 })).toBe(117);
  });
  test('bookingCountsForTier rejects cancelled, non-AJ, or out-of-FY', () => {
    expect(bookingCountsForTier(mkBooking({ bookingStatus: 'Cancelled' }), FY)).toBe(false);
    expect(bookingCountsForTier(mkBooking({ isAjsShow: false }), FY)).toBe(false);
    expect(bookingCountsForTier(mkBooking({ eventDate: '1999-05-01' }), FY)).toBe(false);
    expect(bookingCountsForTier(mkBooking(), FY)).toBe(true);
  });
});
