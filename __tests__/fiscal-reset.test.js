'use strict';
const fy = require('../lib/fiscal-year');
const { recomputeStatus } = require('../lib/tier-calc');

const tiers = [
  { name: 'Silver',   threshold: 1000000, discountPercent: 10 },
  { name: 'Gold',     threshold: 2000000, discountPercent: 15 },
  { name: 'Platinum', threshold: 3000000, discountPercent: 20 },
];

describe('Indian fiscal year boundaries', () => {
  test('April 1 belongs to the FY starting that April', () => {
    expect(fy.getFiscalYearForDate('2026-04-01T00:00:00')).toBe('2026-2027');
  });
  test('March 31 belongs to the FY that started the previous April', () => {
    expect(fy.getFiscalYearForDate('2027-03-31T23:59:59')).toBe('2026-2027');
  });
  test('Mid-FY (Aug)', () => {
    expect(fy.getFiscalYearForDate('2026-08-15')).toBe('2026-2027');
  });
  test('January (still in same FY as previous April)', () => {
    expect(fy.getFiscalYearForDate('2027-01-10')).toBe('2026-2027');
  });
  test('isBookingInFiscalYear matches strings as YYYY-MM-DD', () => {
    expect(fy.isBookingInFiscalYear('2026-04-15', '2026-2027')).toBe(true);
    expect(fy.isBookingInFiscalYear('2026-03-15', '2026-2027')).toBe(false);
  });
  test('null/empty event date → not in FY', () => {
    expect(fy.isBookingInFiscalYear(null, '2026-2027')).toBe(false);
    expect(fy.isBookingInFiscalYear('', '2026-2027')).toBe(false);
  });
});

describe('FY bounds & days remaining', () => {
  test('bounds for 2026-2027 = Apr 1 2026 → Mar 31 2027', () => {
    const { start, end } = fy.getFiscalYearBounds('2026-2027');
    expect(start.getMonth()).toBe(3);   // April (0-indexed)
    expect(start.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(2);     // March
    expect(end.getFullYear()).toBe(2027);
  });

  test('daysRemainingInFiscalYear is non-negative integer', () => {
    const days = fy.daysRemainingInFiscalYear();
    expect(Number.isInteger(days)).toBe(true);
    expect(days).toBeGreaterThanOrEqual(0);
    expect(days).toBeLessThanOrEqual(366);
  });
});

describe('lazy April-1 reset', () => {
  test('stale row is recomputed against current bookings (counter resets to zero when no current-FY bookings)', () => {
    const stale = {
      vendorId: 'v1', fiscalYear: '2020-2021',
      ytdSales: 5000000, ytdShowCount: 12,
      currentTier: 'Platinum',
    };
    const status = recomputeStatus('v1', [], tiers, stale);
    expect(status.fiscalYear).toBe(fy.getCurrentFiscalYear());
    expect(status.ytdSales).toBe(0);
    expect(status.ytdShowCount).toBe(0);
    expect(status.currentTier).toBeNull();
    expect(status.discountPercent).toBe(0);
  });

  test('cancelled bookings reduce YTD (refund/cancellation case)', () => {
    const FY = fy.getCurrentFiscalYear();
    const FY_START_YEAR = parseInt(FY.split('-')[0], 10);
    const inFy = `${FY_START_YEAR}-08-15`;

    const bookings = [
      { id: '1', vendorId: 'v1', eventDate: inFy, isAjsShow: true, bookingStatus: 'Confirmed', totalPrice: 1500000 },
      { id: '2', vendorId: 'v1', eventDate: inFy, isAjsShow: true, bookingStatus: 'Cancelled', totalPrice: 800000 },
    ];
    const status = recomputeStatus('v1', bookings, tiers, null);
    expect(status.ytdSales).toBe(1500000);     // not 2,300,000
    expect(status.ytdShowCount).toBe(1);
    expect(status.currentTier).toBe('Silver');
  });

  test('only AJ shows count toward tier; non-AJ visible elsewhere but excluded from YTD', () => {
    const FY = fy.getCurrentFiscalYear();
    const FY_START_YEAR = parseInt(FY.split('-')[0], 10);
    const inFy = `${FY_START_YEAR}-08-15`;

    const bookings = [
      { id: 'a', vendorId: 'v1', eventDate: inFy, isAjsShow: true,  bookingStatus: 'Confirmed', totalPrice: 1000000 },
      { id: 'b', vendorId: 'v1', eventDate: inFy, isAjsShow: false, bookingStatus: 'Confirmed', totalPrice: 5000000 },
    ];
    const status = recomputeStatus('v1', bookings, tiers, null);
    expect(status.ytdSales).toBe(1000000);
    expect(status.currentTier).toBe('Silver');
  });
});
