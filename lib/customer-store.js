'use strict';
const fs   = require('fs');
const path = require('path');

const CUSTOMERS_PATH = path.join(__dirname, '..', 'data', 'customers.json');

function readCustomers() {
  try { return JSON.parse(fs.readFileSync(CUSTOMERS_PATH, 'utf8')); }
  catch { return []; }
}
function writeCustomers(list) {
  fs.writeFileSync(CUSTOMERS_PATH, JSON.stringify(list, null, 2), 'utf8');
}

// Strip password and any internal-only fields before sending to clients.
function safeCustomer(c) {
  return {
    id:               c.id,
    name:             c.name,
    email:            c.email,
    phone:            c.phone || null,
    companyName:      c.companyName || null,
    status:           c.status,
    commissionPercent: Number(c.commissionPercent) || 0,
    source:           c.source || 'self',
    tierOverride:     c.tierOverride || null,           // current admin-assigned tier (latest)
    tierOverrideHistory: Array.isArray(c.tierOverrideHistory) ? c.tierOverrideHistory : [],
    pocs:             Array.isArray(c.pocs) ? c.pocs : [],
    mustChangePassword: !!c.mustChangePassword,
    passwordChangedAt:  c.passwordChangedAt || null,
    createdAt:        c.createdAt,
    approvedAt:       c.approvedAt || null,
    declinedAt:       c.declinedAt || null,
  };
}

module.exports = { CUSTOMERS_PATH, readCustomers, writeCustomers, safeCustomer };
