'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const PATHS = {
  bookings:       path.join(DATA_DIR, 'bookings.json'),
  vendors:        path.join(DATA_DIR, 'vendors.json'),
  tiers:          path.join(DATA_DIR, 'loyalty-tiers.json'),
  status:         path.join(DATA_DIR, 'vendor-loyalty-status.json'),
  manualShows:    path.join(DATA_DIR, 'manual-show-entries.json'),
  overrideAudit:  path.join(DATA_DIR, 'tier-override-audit.json'),
};

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

const readBookings      = ()    => readJSON(PATHS.bookings,      []);
const writeBookings     = (d)   => writeJSON(PATHS.bookings,     d);
const readVendors       = ()    => readJSON(PATHS.vendors,       []);
const writeVendors      = (d)   => writeJSON(PATHS.vendors,      d);
const readTiers         = ()    => readJSON(PATHS.tiers,         []);
const readStatuses      = ()    => readJSON(PATHS.status,        []);
const writeStatuses     = (d)   => writeJSON(PATHS.status,       d);
const readManualShows   = ()    => readJSON(PATHS.manualShows,   []);
const writeManualShows  = (d)   => writeJSON(PATHS.manualShows,  d);
const readOverrideAudit = ()    => readJSON(PATHS.overrideAudit, []);
const writeOverrideAudit= (d)   => writeJSON(PATHS.overrideAudit, d);

module.exports = {
  PATHS,
  readBookings, writeBookings,
  readVendors,  writeVendors,
  readTiers,
  readStatuses, writeStatuses,
  readManualShows,   writeManualShows,
  readOverrideAudit, writeOverrideAudit,
};
