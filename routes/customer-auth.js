'use strict';
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt  = require('bcryptjs');
const { readCustomers, writeCustomers, safeCustomer } = require('../lib/customer-store');

router.get('/me', (req, res) => {
  if (req.session && req.session.customer) {
    return res.json({ loggedIn: true, customer: req.session.customer });
  }
  res.json({ loggedIn: false });
});

// Customer self-signup is disabled. Accounts are created by the super admin
// and credentials are emailed/shared to the customer directly.
router.post('/signup', (req, res) => {
  res.status(403).json({
    error: 'Self-registration is disabled. Please contact your account manager to receive login credentials.',
  });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const customers = readCustomers();
  const customer  = customers.find(c => c.email.toLowerCase() === email.toLowerCase());
  if (!customer || !customer.password)
    return res.status(401).json({ error: 'Invalid email or password.' });

  const valid = await bcrypt.compare(password, customer.password);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

  if (customer.status === 'pending')
    return res.status(403).json({ error: 'Your registration is awaiting administrator approval.' });
  if (customer.status === 'declined')
    return res.status(403).json({ error: 'Your registration was declined. Please contact the administrator.' });
  if (customer.status !== 'approved')
    return res.status(403).json({ error: 'Account is not active.' });

  req.session.customer = safeCustomer(customer);
  res.json({ success: true, customer: req.session.customer });
});

router.post('/logout', (req, res) => {
  if (req.session) req.session.customer = null;
  res.json({ success: true });
});

// POST /api/customer-auth/forgot-password — vendor flags their account for a
// password reset. Admin sees a badge on the Vendors page and issues a new
// password from there. We always respond with success (even if the email
// doesn't match a record) so the endpoint can't be used to enumerate accounts.
router.post('/forgot-password', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const customers = readCustomers();
  const idx = customers.findIndex(c => (c.email || '').toLowerCase() === String(email).toLowerCase());
  if (idx !== -1) {
    customers[idx].passwordResetRequested   = true;
    customers[idx].passwordResetRequestedAt = new Date().toISOString();
    writeCustomers(customers);
  }
  res.json({
    success: true,
    message: 'If an account exists for that email, your account manager has been notified. They will share a new password with you shortly.',
  });
});

// POST /api/customer-auth/change-password — vendor changes their own password.
// Requires the current session, current password, and new password.
router.post('/change-password', async (req, res) => {
  if (!req.session || !req.session.customer)
    return res.status(401).json({ error: 'Authentication required.' });

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Current and new password are required.' });
  if (String(newPassword).length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  if (currentPassword === newPassword)
    return res.status(400).json({ error: 'New password must be different from the current one.' });

  const customers = readCustomers();
  const idx = customers.findIndex(c => c.id === req.session.customer.id);
  if (idx === -1) return res.status(404).json({ error: 'Account not found.' });

  const valid = await bcrypt.compare(currentPassword, customers[idx].password || '');
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

  customers[idx].password           = await bcrypt.hash(String(newPassword), 12);
  customers[idx].mustChangePassword = false;
  customers[idx].passwordChangedAt  = new Date().toISOString();
  writeCustomers(customers);

  // Refresh the session's safe customer view
  req.session.customer = safeCustomer(customers[idx]);
  res.json({ success: true, customer: req.session.customer });
});

module.exports = router;
