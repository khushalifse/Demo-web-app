'use strict';
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt  = require('bcryptjs');
const store   = require('../lib/loyalty-store');

function safeVendor(v) {
  return { id: v.id, name: v.name, email: v.email, phone: v.phone || null, companyName: v.companyName || null };
}

router.get('/me', (req, res) => {
  if (req.session.vendor) return res.json({ loggedIn: true, vendor: req.session.vendor });
  res.json({ loggedIn: false });
});

router.post('/signup', async (req, res) => {
  const { name, email, password, phone, companyName } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const vendors = store.readVendors();
  if (vendors.find(v => v.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: 'An account with this email already exists.' });

  const hashed = await bcrypt.hash(password, 12);
  const vendor = {
    id: uuidv4(),
    name,
    email: email.toLowerCase(),
    phone: phone || null,
    companyName: companyName || null,
    password: hashed,
    role: 'vendor',
    createdAt: new Date().toISOString(),
  };
  vendors.push(vendor);
  store.writeVendors(vendors);

  req.session.vendor = safeVendor(vendor);
  res.json({ success: true, vendor: req.session.vendor });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const vendors = store.readVendors();
  const vendor  = vendors.find(v => v.email.toLowerCase() === email.toLowerCase());
  if (!vendor || !vendor.password)
    return res.status(401).json({ error: 'Invalid email or password.' });

  const valid = await bcrypt.compare(password, vendor.password);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

  req.session.vendor = safeVendor(vendor);
  res.json({ success: true, vendor: req.session.vendor });
});

router.post('/logout', (req, res) => {
  // Clearing only the vendor key keeps any admin session alive in the same browser.
  if (req.session) req.session.vendor = null;
  res.json({ success: true });
});

module.exports = router;
