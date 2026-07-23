'use strict';
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

const ENQUIRIES_PATH = path.join(__dirname, '..', 'data', 'enquiries.json');

function readEnquiries() {
  try { return JSON.parse(fs.readFileSync(ENQUIRIES_PATH, 'utf8')); }
  catch { return []; }
}
function writeEnquiries(list) {
  fs.writeFileSync(ENQUIRIES_PATH, JSON.stringify(list, null, 2), 'utf8');
}

// GET /api/admin/enquiries — list all enquiries newest-first.
router.get('/', (req, res) => {
  const list = readEnquiries()
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  res.json(list);
});

// POST /api/admin/enquiries — capture a new enquiry. Name, event date and
// at least one contact (email OR phone) are required; the rest is optional.
router.post('/', (req, res) => {
  const { name, email, phone, eventStartDate, eventEndDate, notes } = req.body || {};
  const trim = (v) => (v == null ? '' : String(v).trim());

  const cleanName  = trim(name);
  const cleanEmail = trim(email);
  const cleanPhone = trim(phone);
  const startDate  = trim(eventStartDate) || null;
  const endDate    = trim(eventEndDate)   || null;

  if (!cleanName)    return res.status(400).json({ error: 'Name is required.' });
  if (!cleanEmail && !cleanPhone)
    return res.status(400).json({ error: 'Enter an email or a phone number.' });
  if (!startDate)    return res.status(400).json({ error: 'Event date is required.' });
  if (startDate && endDate && endDate < startDate) {
    return res.status(400).json({ error: 'Event end date cannot be earlier than the start date.' });
  }

  const entry = {
    id:              uuidv4(),
    name:            cleanName,
    email:           cleanEmail || null,
    phone:           cleanPhone || null,
    eventStartDate:  startDate,
    eventEndDate:    endDate,
    notes:           trim(notes) || null,
    createdAt:       new Date().toISOString(),
    createdBy:       (req.session && req.session.user && req.session.user.name) || null,
  };
  const list = readEnquiries();
  list.push(entry);
  writeEnquiries(list);
  res.status(201).json(entry);
});

// DELETE /api/admin/enquiries/:id
router.delete('/:id', (req, res) => {
  const list = readEnquiries();
  const idx  = list.findIndex(e => e.id === req.params.id);
  console.log(`[enquiries DELETE] id=${req.params.id} idx=${idx} total=${list.length}`);
  if (idx === -1) return res.status(404).json({ error: 'Enquiry not found.' });
  try {
    list.splice(idx, 1);
    writeEnquiries(list);
    res.json({ success: true });
  } catch (err) {
    console.error('[enquiries DELETE] write failed:', err);
    res.status(500).json({ error: 'Could not save the change to disk: ' + err.message });
  }
});

module.exports = router;
