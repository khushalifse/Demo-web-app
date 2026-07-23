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

// POST /api/admin/enquiries — capture a new enquiry. Every field is optional,
// but we accept the record and let the admin fill in missing details later.
router.post('/', (req, res) => {
  const { name, email, phone, eventStartDate, eventEndDate, notes } = req.body || {};
  const trim = (v) => (v == null ? '' : String(v).trim());

  const startDate = trim(eventStartDate) || null;
  const endDate   = trim(eventEndDate)   || null;
  if (startDate && endDate && endDate < startDate) {
    return res.status(400).json({ error: 'Event end date cannot be earlier than the start date.' });
  }

  const entry = {
    id:              uuidv4(),
    name:            trim(name)  || null,
    email:           trim(email) || null,
    phone:           trim(phone) || null,
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
  if (idx === -1) return res.status(404).json({ error: 'Enquiry not found.' });
  list.splice(idx, 1);
  writeEnquiries(list);
  res.json({ success: true });
});

module.exports = router;
