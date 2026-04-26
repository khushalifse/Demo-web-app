'use strict';

// Indian fiscal year: April 1 -> March 31.
// Returned label format: "2026-2027" meaning Apr-2026 to Mar-2027.

function getFiscalYearForDate(date) {
  const d = new Date(date);
  const month = d.getMonth(); // 0-indexed; March = 2, April = 3
  const year  = d.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function getCurrentFiscalYear() {
  return getFiscalYearForDate(new Date());
}

function getFiscalYearBounds(label) {
  const [startYear] = label.split('-').map(Number);
  const start = new Date(startYear, 3, 1);                // Apr 1, 00:00 local
  const end   = new Date(startYear + 1, 2, 31, 23, 59, 59, 999); // Mar 31
  return { start, end };
}

function daysRemainingInFiscalYear(now = new Date()) {
  const fy = getCurrentFiscalYear();
  const { end } = getFiscalYearBounds(fy);
  const ms = end - now;
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function isBookingInFiscalYear(eventDateStr, fyLabel) {
  if (!eventDateStr) return false;
  return getFiscalYearForDate(eventDateStr + 'T00:00:00') === fyLabel;
}

module.exports = {
  getFiscalYearForDate,
  getCurrentFiscalYear,
  getFiscalYearBounds,
  daysRemainingInFiscalYear,
  isBookingInFiscalYear,
};
