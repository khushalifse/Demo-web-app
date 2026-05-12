'use strict';
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt  = require('bcryptjs');
const store   = require('../lib/loyalty-store');
const { readCustomers, writeCustomers, safeCustomer } = require('../lib/customer-store');

const BOOKINGS_PATH            = path.join(__dirname, '..', 'data', 'bookings.json');
const COMMISSION_PAYMENTS_PATH = path.join(__dirname, '..', 'data', 'commission-payments.json');

function readPayments() {
  try { return JSON.parse(fs.readFileSync(COMMISSION_PAYMENTS_PATH, 'utf8')); }
  catch { return []; }
}
function writePayments(d) {
  fs.writeFileSync(COMMISSION_PAYMENTS_PATH, JSON.stringify(d, null, 2), 'utf8');
}

function readBookings() {
  try { return JSON.parse(fs.readFileSync(BOOKINGS_PATH, 'utf8')); }
  catch { return []; }
}
function effectiveBase(b) {
  return (Number(b.totalPrice)      || 0) +
         (Number(b.hologramAmount)  || 0) +
         (Number(b.dholAmount)      || 0) +
         (Number(b.ancillaryAmount) || 0);
}
function deriveTier(businessTotal, tiers) {
  let current = null;
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  for (const t of sorted) if (businessTotal >= t.threshold) current = t;
  return current || { name: 'Bronze', threshold: 0, discountPercent: 5 };
}

// Apply the admin-assigned tier override as a FLOOR — vendor sees at least
// the assigned tier, but can graduate to a higher one based on business.
function tierWithFloor(computed, overrideName, tiers) {
  if (!overrideName) return computed;
  const ov = tiers.find(t => (t.name || '').toLowerCase() === overrideName.toLowerCase());
  if (!ov) return computed;
  return (!computed || (Number(computed.threshold) || 0) < (Number(ov.threshold) || 0))
    ? ov
    : computed;
}

// Tier override that was effective on a given date (walks history oldest-first).
function overrideAtDate(customer, dateISO) {
  if (!Array.isArray(customer.tierOverrideHistory) || !customer.tierOverrideHistory.length) {
    return customer.tierOverride || null;     // legacy single-value
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

// 16-char URL-safe random password. Used for admin-created accounts and resets.
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$%';
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// GET /api/admin/customers — list all vendors, decorated with business, tier,
// commission earned/paid/outstanding, plus the latest event date so the admin
// can prefill payouts.
router.get('/', (req, res) => {
  const customers = readCustomers();
  const bookings  = readBookings();
  const payments  = readPayments();
  const tiers     = store.readTiers();

  // Mirror customer.js: walk events oldest-first, applying tier-at-time +
  // floor (with date-aware override history), so commissionEarned uses the
  // same historically-accurate math the vendor sees on their dashboard.
  function commissionEarnedFor(c) {
    const mine = bookings
      .filter(b => b.customerId === c.id && b.bookingStatus !== 'Cancelled' && !b.directByClient)
      .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
    let running = 0, total = 0;
    for (const b of mine) {
      const amt = effectiveBase(b);
      running += amt;
      const computed = (deriveTier(running, tiers)) || { discountPercent: 5 };
      const eff      = tierWithFloor(computed, overrideAtDate(c, b.eventDate), tiers) || computed;
      total += Math.round(amt * (Number(eff.discountPercent) || 0) / 100);
    }
    return total;
  }

  const decorated = customers.map(c => {
    const mineAll  = bookings.filter(b => b.customerId === c.id && b.bookingStatus !== 'Cancelled');
    const mineLoy  = mineAll.filter(b => !b.directByClient);
    const business = mineLoy.reduce((sum, b) => sum + effectiveBase(b), 0);
    // "Current" tier uses the LATEST override (today) — same as what new
    // entries will be created under.
    const today    = new Date().toISOString().split('T')[0];
    const tier     = tierWithFloor(deriveTier(business, tiers), overrideAtDate(c, today), tiers);
    const tierRate = Number(tier.discountPercent) || 0;
    const earned   = commissionEarnedFor(c);
    const paid     = payments
      .filter(p => p.customerId === c.id)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const lastEventDate = mineAll
      .map(b => b.eventDateTo || b.eventDate)
      .filter(Boolean)
      .sort()
      .pop() || null;
    return {
      ...safeCustomer(c),
      bookingsCount:         mineAll.length,
      businessGross:         business,                       // net, excl. GST
      tier:                  { name: tier.name, discountPercent: tierRate },
      commissionEarned:      earned,
      commissionPaid:        paid,
      commissionOutstanding: Math.max(0, earned - paid),
      lastEventDate,
    };
  });

  res.json(decorated);
});

// GET /api/admin/customers/export — full backup of customers.json as a
// downloadable file. Hashed passwords are included so a round-trip import
// preserves working logins. Treat the file as sensitive.
router.get('/export', (req, res) => {
  const customers = readCustomers();
  const stamp = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vendors-export-${stamp}.json"`);
  res.send(JSON.stringify(customers, null, 2));
});

// POST /api/admin/customers/import — accepts { vendors: [...] } and adds any
// rows whose email isn't already in the system. Existing accounts are kept as
// they are (non-destructive). Reports imported / skipped counts.
router.post('/import', (req, res) => {
  const incoming = (req.body && Array.isArray(req.body.vendors)) ? req.body.vendors : null;
  if (!incoming) return res.status(400).json({ error: 'Expected { vendors: [ ... ] }.' });
  if (incoming.length > 1000) return res.status(413).json({ error: 'Too many rows (max 1000).' });

  const customers = readCustomers();
  const existingEmails = new Set(customers.map(c => (c.email || '').toLowerCase()));
  const existingIds    = new Set(customers.map(c => c.id));

  let imported = 0, skipped = 0, invalid = 0;
  for (const v of incoming) {
    if (!v || typeof v !== 'object' || !v.email || !v.password || !v.id) { invalid++; continue; }
    const emailKey = String(v.email).toLowerCase();
    if (existingEmails.has(emailKey) || existingIds.has(v.id)) { skipped++; continue; }
    customers.push({
      ...v,
      email:              emailKey,
      status:             v.status || 'approved',
      source:             v.source || 'import',
      role:               'customer',
      commissionPercent:  Number(v.commissionPercent) || 0,
      tierOverrideHistory: Array.isArray(v.tierOverrideHistory) ? v.tierOverrideHistory : [],
      pocs:               Array.isArray(v.pocs) ? v.pocs : [],
      mustChangePassword: !!v.mustChangePassword,
      createdAt:          v.createdAt || new Date().toISOString(),
    });
    existingEmails.add(emailKey);
    existingIds.add(v.id);
    imported++;
  }
  if (imported > 0) writeCustomers(customers);
  res.json({ success: true, imported, skipped, invalid });
});

// POST /api/admin/customers/bulk-create — Excel/CSV-friendly bulk import.
// Accepts { rows: [{ name, email, phone, companyName, password, tierOverride,
// pocs }, ...] } with plain row data — server generates the ID and hashes the
// password. Existing accounts (matched by email) are skipped, never overwritten.
router.post('/bulk-create', async (req, res) => {
  const rows = (req.body && Array.isArray(req.body.rows)) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: 'Expected { rows: [ ... ] }.' });
  if (rows.length > 500) return res.status(413).json({ error: 'Too many rows (max 500).' });

  const customers = readCustomers();
  const tiers     = store.readTiers();
  const tierByName = new Map(tiers.map(t => [(t.name || '').toLowerCase(), t.name]));
  const existingEmails = new Set(customers.map(c => (c.email || '').toLowerCase()));

  let imported = 0, skipped = 0;
  const errors = [];
  const created = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const rowNum = i + 2; // +1 for 0-index, +1 for header row in the sheet
    const name        = String(r.name || '').trim();
    const email       = String(r.email || '').trim().toLowerCase();
    const companyName = String(r.companyName || '').trim();
    const password    = String(r.password || '');
    const phone       = String(r.phone || '').trim() || null;
    const tierRaw     = String(r.tierOverride || '').trim();
    const tierOverride = tierRaw ? (tierByName.get(tierRaw.toLowerCase()) || null) : null;

    let pocs = [];
    if (Array.isArray(r.pocs)) pocs = r.pocs.map(s => String(s).trim()).filter(Boolean);
    else if (typeof r.pocs === 'string')
      pocs = r.pocs.split(/[;,\n]/).map(s => s.trim()).filter(Boolean);

    if (!name || !email || !companyName) {
      errors.push({ row: rowNum, reason: 'Missing name, email, or company.' }); continue;
    }
    if (!password || password.length < 6) {
      errors.push({ row: rowNum, reason: 'Password is required (min 6 chars) for new vendors.' }); continue;
    }
    if (existingEmails.has(email)) { skipped++; continue; }

    const hashed = await bcrypt.hash(password, 12);
    const customer = {
      id:                uuidv4(),
      name,
      email,
      phone,
      companyName,
      password:          hashed,
      role:              'customer',
      status:            'approved',
      source:            'excel-import',
      commissionPercent: 0,
      tierOverride,
      tierOverrideHistory: tierOverride
        ? [{ tier: tierOverride, effectiveFrom: new Date().toISOString().split('T')[0] }]
        : [],
      pocs,
      mustChangePassword: true,
      passwordChangedAt:  null,
      createdAt:         new Date().toISOString(),
      approvedAt:        new Date().toISOString(),
      declinedAt:        null,
    };
    customers.push(customer);
    existingEmails.add(email);
    created.push({ row: rowNum, email, name });
    imported++;
  }
  if (imported > 0) writeCustomers(customers);
  res.json({ success: true, imported, skipped, errors, created });
});

// PATCH /api/admin/customers/:id/approve
router.patch('/:id/approve', (req, res) => {
  const customers = readCustomers();
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Customer not found.' });
  customers[idx].status      = 'approved';
  customers[idx].approvedAt  = new Date().toISOString();
  customers[idx].declinedAt  = null;
  writeCustomers(customers);
  res.json({ success: true, customer: safeCustomer(customers[idx]) });
});

// PATCH /api/admin/customers/:id/decline
router.patch('/:id/decline', (req, res) => {
  const customers = readCustomers();
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Customer not found.' });
  customers[idx].status      = 'declined';
  customers[idx].declinedAt  = new Date().toISOString();
  customers[idx].approvedAt  = null;
  writeCustomers(customers);
  res.json({ success: true, customer: safeCustomer(customers[idx]) });
});

// PATCH /api/admin/customers/:id — update editable fields (POCs, phone, company, tier override)
router.patch('/:id', (req, res) => {
  const customers = readCustomers();
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Vendor not found.' });

  const body = req.body || {};

  if (typeof body.companyName === 'string') {
    if (!body.companyName.trim())
      return res.status(400).json({ error: 'Company name cannot be empty.' });
    customers[idx].companyName = body.companyName.trim();
  }
  if (typeof body.phone === 'string')  customers[idx].phone = body.phone.trim() || null;
  if (typeof body.name  === 'string' && body.name.trim()) customers[idx].name = body.name.trim();
  if (Array.isArray(body.pocs)) {
    customers[idx].pocs = body.pocs.map(p => typeof p === 'string' ? p.trim() : '').filter(Boolean);
  }
  if (typeof body.tierOverride === 'string' || body.tierOverride === null) {
    let newOverride = null;
    if (body.tierOverride) {
      const tiers = store.readTiers();
      const matched = tiers.find(t => (t.name || '').toLowerCase() === String(body.tierOverride).toLowerCase());
      newOverride = matched ? matched.name : null;
    }
    const oldOverride = customers[idx].tierOverride || null;
    if (newOverride !== oldOverride) {
      // Tier change: append a new history entry effective TODAY. Past events
      // (eventDate < today) keep their previous tier — the dashboard uses the
      // history entry that was active at each event's date.
      if (!Array.isArray(customers[idx].tierOverrideHistory)) {
        customers[idx].tierOverrideHistory = [];
      }
      customers[idx].tierOverrideHistory.push({
        tier:          newOverride,
        effectiveFrom: new Date().toISOString().split('T')[0],
      });
      customers[idx].tierOverride = newOverride;
    }
  }

  writeCustomers(customers);
  res.json({ success: true, customer: safeCustomer(customers[idx]) });
});

// POST /api/admin/customers/:id/reset-password — admin issues a new password.
// Returns the password ONCE so admin can share it. Vendor must change it on
// next login (mustChangePassword=true).
router.post('/:id/reset-password', async (req, res) => {
  const customers = readCustomers();
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Vendor not found.' });

  const { password } = req.body || {};
  if (!password || String(password).length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });

  customers[idx].password           = await bcrypt.hash(String(password), 12);
  customers[idx].mustChangePassword = true;
  writeCustomers(customers);

  res.json({
    success: true,
    customer: safeCustomer(customers[idx]),
    credentials: {
      email:    customers[idx].email,
      password: String(password),
      loginUrl: '/customer-login',
    },
  });
});

// PATCH /api/admin/customers/:id/commission — set commission percent for a customer
router.patch('/:id/commission', (req, res) => {
  const pct = Number(req.body && req.body.commissionPercent);
  if (Number.isNaN(pct) || pct < 0 || pct > 100)
    return res.status(400).json({ error: 'Commission percent must be between 0 and 100.' });

  const customers = readCustomers();
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Customer not found.' });
  customers[idx].commissionPercent = pct;
  writeCustomers(customers);
  res.json({ success: true, customer: safeCustomer(customers[idx]) });
});

// POST /api/admin/customers/manual — admin creates a customer login directly.
// Returns the generated password ONCE so the admin can copy & forward it to the customer.
router.post('/manual', async (req, res) => {
  const { name, email, phone, companyName, commissionPercent, password, tierOverride, pocs } = req.body || {};
  if (!name || !email)
    return res.status(400).json({ error: 'Name and email are required.' });
  if (!companyName || !String(companyName).trim())
    return res.status(400).json({ error: 'Company / organisation name is required.' });
  if (!password || String(password).length < 6)
    return res.status(400).json({ error: 'A custom password (min 6 characters) is required.' });

  const customers = readCustomers();
  if (customers.find(c => c.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: 'A customer with this email already exists.' });

  // Normalise tierOverride against the configured ladder (case-insensitive).
  let normalisedTier = null;
  if (tierOverride && String(tierOverride).trim()) {
    const tiers   = store.readTiers();
    const matched = tiers.find(t => (t.name || '').toLowerCase() === String(tierOverride).toLowerCase());
    if (matched) normalisedTier = matched.name;
  }

  // POCs: array of names (clean strings only).
  let cleanedPocs = [];
  if (Array.isArray(pocs)) {
    cleanedPocs = pocs.map(p => typeof p === 'string' ? p.trim() : '').filter(Boolean);
  }

  const plainPassword = String(password);
  const hashed        = await bcrypt.hash(plainPassword, 12);

  const customer = {
    id:                uuidv4(),
    name,
    email:             email.toLowerCase(),
    phone:             phone || null,
    companyName:       companyName || null,
    password:          hashed,
    role:              'customer',
    status:            'approved',         // admin-created accounts are pre-approved
    source:            'manual',
    commissionPercent: Number(commissionPercent) || 0,
    tierOverride:      normalisedTier,
    tierOverrideHistory: normalisedTier
      ? [{ tier: normalisedTier, effectiveFrom: new Date().toISOString().split('T')[0] }]
      : [],
    pocs:              cleanedPocs,
    mustChangePassword: true,                  // forces a password change on first login
    passwordChangedAt:  null,                  // populated when vendor changes their own password
    createdAt:         new Date().toISOString(),
    approvedAt:        new Date().toISOString(),
    declinedAt:        null,
  };
  customers.push(customer);
  writeCustomers(customers);

  res.status(201).json({
    success: true,
    customer: safeCustomer(customer),
    // Returned in plaintext exactly once — admin must forward to the customer.
    credentials: {
      email:    customer.email,
      password: plainPassword,
      loginUrl: '/customer-login',
    },
  });
});

// POST /api/admin/customers/:id/business-entry
// Records net business given by a vendor as a minimal booking record. Drives
// the vendor's loyalty dashboard (tier + commission).
router.post('/:id/business-entry', (req, res) => {
  const customers = readCustomers();
  const customer  = customers.find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Vendor not found.' });

  const { netAmount, eventDate, eventDateTo, clientName, poc, description, directByClient } = req.body || {};
  const amount = Number(netAmount);
  if (!amount || amount <= 0)
    return res.status(400).json({ error: 'Net business amount must be greater than zero.' });

  const date    = eventDate || new Date().toISOString().split('T')[0];
  const dateTo  = (eventDateTo && eventDateTo >= date) ? eventDateTo : null;
  const direct  = !!directByClient;

  const bookings = readBookings();
  const tiers    = store.readTiers();
  // Direct-by-client bookings don't count toward loyalty business.
  const business = bookings
    .filter(b => b.customerId === customer.id && b.bookingStatus !== 'Cancelled' && !b.directByClient)
    .reduce((s, b) => s + effectiveBase(b), 0);
  const projectedBusiness = direct ? business : business + amount;
  // Apply the override as a floor so a vendor with an assigned tier never
  // earns commission at a lower rate than they're entitled to. Mirrors the
  // calculation in GET / so the dashboard and the saved entry agree.
  const computedTier = deriveTier(projectedBusiness, tiers);
  const tier         = tierWithFloor(computedTier, overrideAtDate(customer, date), tiers) || computedTier;

  const entry = {
    id:                 uuidv4(),
    customerId:         customer.id,
    clientName:         (clientName && clientName.trim()) || customer.name,
    hostName:           customer.companyName || customer.name,
    countryCode:        '+91',
    phone:              customer.phone || '',
    eventDate:          date,
    eventDateTo:        dateTo,
    additionalDates:    [],
    eventTime:          '',
    venue:              '—',
    eventType:          (description && description.trim()) || 'Business Entry',
    musicGenres:        [],
    equipment:          [],
    hologram:           false,
    hologramAmount:     0,
    dholRequired:       false,
    dholAmount:         0,
    ancillaryActs:      false,
    ancillaryActName:   null,
    ancillaryAmount:    0,
    totalPrice:         amount,         // net of GST
    depositAmount:      0,
    depositPaid:        false,
    paymentMode:        null,
    paymentStatus:      'Pending',
    bookingStatus:      'Confirmed',    // counted toward tier immediately
    isAjsShow:          true,
    fullPrice:          amount,
    directByClient:     direct,         // bypasses commission + tier counting
    discountPercent:    direct ? 0 : (Number(tier.discountPercent) || 0),
    discountAmount:     direct ? 0 : Math.round(amount * (Number(tier.discountPercent) || 0) / 100),
    reversalStatus:     'NotEligible',
    reversalAmount:     0,
    reversalDate:       null,
    reversalApprovedBy: null,
    paymentLinks:       [],
    remarks:            'Logged as business entry by admin',
    poc:                (poc && String(poc).trim()) || null,
    isManualEntry:      true,
    createdAt:          new Date().toISOString(),
    updatedAt:          new Date().toISOString(),
  };
  bookings.push(entry);
  fs.writeFileSync(BOOKINGS_PATH, JSON.stringify(bookings, null, 2), 'utf8');

  res.status(201).json({
    success:   true,
    entry,
    newTier:   { name: tier.name, discountPercent: tier.discountPercent },
    newBusiness: projectedBusiness,
    commissionFromThisEntry: direct ? 0 : Math.round(amount * (Number(tier.discountPercent) || 0) / 100),
    directByClient: direct,
  });
});

// GET /api/admin/customers/:id/business-entries
// All bookings tied to this vendor (both loyalty-counting and direct-by-client),
// chronological. Used by the admin inline-entries panel under each vendor row.
//
// Bookings created through the admin "Log Business Entry" form use `customerId`
// while older entries coming in via /api/admin/loyalty/manual-show use `vendorId`
// — we accept either so legacy data still surfaces in this panel.
router.get('/:id/business-entries', (req, res) => {
  const customers = readCustomers();
  const customer  = customers.find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Vendor not found.' });

  const allBookings = readBookings();
  const matched = allBookings.filter(b =>
    b.customerId === customer.id || b.vendorId === customer.id
  );
  console.log(`[business-entries] vendor=${customer.id} (${customer.email}) ` +
              `total-bookings=${allBookings.length} matched=${matched.length}`);

  const list = matched
    .sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate))
    .map(b => ({
      id:             b.id,
      eventDate:      b.eventDate,
      eventDateTo:    b.eventDateTo || null,
      eventType:      b.eventType || '',
      clientName:     b.clientName || '',
      netAmount:      Number(b.totalPrice) || 0,
      directByClient: !!b.directByClient,
      bookingStatus:  b.bookingStatus,
      poc:            b.poc || null,
      createdAt:      b.createdAt,
    }));
  res.json(list);
});

// PATCH /api/admin/customers/:vendorId/business-entry/:bookingId
// Edit a previously logged business entry. Only the admin-facing fields are
// accepted (amount, dates, client, description, direct flag). The booking's
// stored discountPercent/discountAmount are recomputed from cumulative business
// up to this event's date, applying the tier-override floor — same logic the
// dashboards use, so the saved record stays consistent.
router.patch('/:vendorId/business-entry/:bookingId', (req, res) => {
  const customers = readCustomers();
  const customer  = customers.find(c => c.id === req.params.vendorId);
  if (!customer) return res.status(404).json({ error: 'Vendor not found.' });

  const bookings = readBookings();
  const idx = bookings.findIndex(b => b.id === req.params.bookingId && b.customerId === customer.id);
  if (idx === -1) return res.status(404).json({ error: 'Entry not found for this vendor.' });

  const b = bookings[idx];
  const { netAmount, eventDate, eventDateTo, clientName, description, directByClient, poc } = req.body || {};

  if (netAmount != null) {
    const n = Number(netAmount);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'netAmount must be > 0.' });
    b.totalPrice = n;
    b.fullPrice  = n;
  }
  if (eventDate)         b.eventDate     = String(eventDate);
  if (eventDateTo !== undefined) b.eventDateTo = eventDateTo ? String(eventDateTo) : null;
  if (clientName != null) b.clientName   = String(clientName).trim() || customer.name;
  if (description != null) b.eventType   = String(description).trim() || 'Business Entry';
  if (directByClient !== undefined) b.directByClient = !!directByClient;
  if (poc !== undefined)  b.poc          = poc ? String(poc).trim() : null;
  b.updatedAt = new Date().toISOString();

  // Recompute tier-at-time using the floored logic, then refresh the saved
  // discount fields so exports / raw reads stay consistent with the dashboard.
  const tiers = store.readTiers();
  const chrono = bookings
    .filter(x => x.customerId === customer.id && x.bookingStatus !== 'Cancelled' && !x.directByClient)
    .sort((x, y) => new Date(x.eventDate) - new Date(y.eventDate));
  let running = 0;
  for (const x of chrono) {
    running += effectiveBase(x);
    if (x.id === b.id) break;
  }
  const computed = deriveTier(running, tiers);
  const eff      = tierWithFloor(computed, overrideAtDate(customer, b.eventDate), tiers) || computed;
  const rate     = b.directByClient ? 0 : (Number(eff.discountPercent) || 0);
  b.discountPercent = rate;
  b.discountAmount  = b.directByClient ? 0 : Math.round((Number(b.totalPrice) || 0) * rate / 100);

  bookings[idx] = b;
  fs.writeFileSync(BOOKINGS_PATH, JSON.stringify(bookings, null, 2), 'utf8');
  res.json({ success: true, entry: b });
});

// DELETE /api/admin/customers/:vendorId/business-entry/:bookingId
router.delete('/:vendorId/business-entry/:bookingId', (req, res) => {
  const bookings = readBookings();
  const idx = bookings.findIndex(b =>
    b.id === req.params.bookingId && b.customerId === req.params.vendorId);
  if (idx === -1) return res.status(404).json({ error: 'Entry not found for this vendor.' });
  bookings.splice(idx, 1);
  fs.writeFileSync(BOOKINGS_PATH, JSON.stringify(bookings, null, 2), 'utf8');
  res.json({ success: true });
});

// GET /api/admin/customers/:id/unpaid-events
// Returns the vendor's events that still owe commission (unpaid + partial),
// with the exact amount remaining per event. Used by the payment form to
// prefill amounts. Already-paid events are filtered out.
router.get('/:id/unpaid-events', (req, res) => {
  const customers = readCustomers();
  const customer  = customers.find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Vendor not found.' });

  const tiers     = store.readTiers();
  const allBookings = readBookings();
  const mine = allBookings
    .filter(b => b.customerId === customer.id && b.bookingStatus !== 'Cancelled' && !b.directByClient)
    .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));

  // Compute commission earned per event using historical tier-at-time + the
  // override that was effective on each event's date.
  let running = 0;
  const events = mine.map(b => {
    const total = effectiveBase(b);
    running += total;
    const computed = deriveTier(running, tiers) || { discountPercent: 5 };
    const eff      = tierWithFloor(computed, overrideAtDate(customer, b.eventDate), tiers) || computed;
    const rate     = Number(eff.discountPercent) || 0;
    return {
      id:               b.id,
      eventDate:        b.eventDate,
      eventDateTo:      b.eventDateTo || null,
      eventType:        b.eventType,
      clientName:       b.clientName || '',
      tierAtTime:       eff.name,
      rate,
      commissionEarned: Math.round(total * rate / 100),
    };
  });

  // FIFO-allocate existing payments against earned commissions.
  const totalPaid = readPayments()
    .filter(p => p.customerId === customer.id)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  let earnedSoFar = 0, unallocated = totalPaid;
  const unpaid = [];
  for (const ev of events) {
    if (!ev.commissionEarned) continue;
    if (unallocated >= ev.commissionEarned) {
      unallocated -= ev.commissionEarned;          // fully paid — skip
      continue;
    }
    const remaining = ev.commissionEarned - unallocated;
    unallocated = 0;
    unpaid.push({
      ...ev,
      commissionRemaining: remaining,
      commissionStatus:    remaining === ev.commissionEarned ? 'unpaid' : 'partial',
    });
  }

  res.json(unpaid);
});

// POST /api/admin/customers/:id/commission-payment
// Record a commission payout to the vendor.
router.post('/:id/commission-payment', (req, res) => {
  const customers = readCustomers();
  const customer  = customers.find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Vendor not found.' });

  const { amount, mode, date, notes } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
  if (!mode || !String(mode).trim()) return res.status(400).json({ error: 'Payment mode is required.' });

  // Payment date can't precede the EARLIEST event the vendor has on record
  // for the loyalty programme — admin may pay for any old event, so we only
  // enforce that the payment isn't before any event has happened.
  const payDate = date || new Date().toISOString().split('T')[0];
  const myBookings = readBookings()
    .filter(b => b.customerId === customer.id && b.bookingStatus !== 'Cancelled' && !b.directByClient);
  const earliestEvent = myBookings.map(b => b.eventDate).filter(Boolean).sort()[0];
  if (earliestEvent && payDate < earliestEvent) {
    return res.status(400).json({
      error: `Payment date can't be before the earliest event date (${earliestEvent}).`,
    });
  }

  const payments = readPayments();
  const entry = {
    id:         uuidv4(),
    customerId: customer.id,
    amount:     amt,
    mode:       String(mode).trim(),
    date:       payDate,
    notes:      (notes && String(notes).trim()) || '',
    createdAt:  new Date().toISOString(),
  };
  payments.push(entry);
  writePayments(payments);
  res.status(201).json({ success: true, payment: entry });
});

// GET /api/admin/customers/commission-payments — list every payment ever made
router.get('/commission-payments/all', (req, res) => {
  const payments  = readPayments();
  const customers = readCustomers();
  const cmap = {};
  customers.forEach(c => { cmap[c.id] = { name: c.name, email: c.email, companyName: c.companyName }; });
  const decorated = payments
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(p => ({ ...p, vendor: cmap[p.customerId] || null }));
  res.json(decorated);
});

// DELETE /api/admin/customers/commission-payments/:paymentId
router.delete('/commission-payments/:paymentId', (req, res) => {
  const payments = readPayments();
  const idx = payments.findIndex(p => p.id === req.params.paymentId);
  if (idx === -1) return res.status(404).json({ error: 'Payment not found.' });
  payments.splice(idx, 1);
  writePayments(payments);
  res.json({ success: true });
});

// DELETE /api/admin/customers/:id — remove a vendor.
// Also wipes any commission-payment records tied to this vendor so the
// payment history doesn't keep orphaned rows referencing the deleted account.
// Bookings are preserved (events still happened — admin can decide what to do).
router.delete('/:id', (req, res) => {
  const customers = readCustomers();
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Vendor not found.' });
  const removedId = customers[idx].id;

  customers.splice(idx, 1);
  writeCustomers(customers);

  // Cascade delete payment history for this vendor.
  const payments = readPayments();
  const remaining = payments.filter(p => p.customerId !== removedId);
  const removedPayments = payments.length - remaining.length;
  if (removedPayments > 0) writePayments(remaining);

  res.json({ success: true, removedPayments });
});

module.exports = router;
