'use strict';
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt  = require('bcryptjs');

const USERS_PATH = path.join(__dirname, '../data/users.json');

/* ── helpers ── */
function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); }
  catch { return []; }
}
function writeUsers(u) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(u, null, 2), 'utf8');
}
function safeUser(u) {
  return { id: u.id, name: u.name, email: u.email, picture: u.picture || null };
}

/* ── GET /api/auth/me ──────────────────────────────────────────────────────── */
router.get('/me', (req, res) => {
  if (req.session.user) return res.json({ loggedIn: true, user: req.session.user });
  res.json({ loggedIn: false });
});

/* ── GET /api/auth/config ─────────────────────────────────────────────────── */
router.get('/config', (req, res) => {
  res.json({ googleEnabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) });
});

/* ── POST /api/auth/signup ────────────────────────────────────────────────── */
// Super-admin signup is disabled — only one predefined admin exists.
// (Customer self-registration still works via /api/customer-auth/signup.)
router.post('/signup', (req, res) => {
  res.status(403).json({
    error: 'Super admin signup is disabled. Sign in with the predefined credentials.',
  });
});

/* ── POST /api/auth/login ─────────────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const users = readUsers();
  const user  = users.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (!user || !user.password) {
    // Generic message – don't reveal whether email exists
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

  req.session.user = safeUser(user);
  res.json({ success: true, user: req.session.user });
});

/* ── POST /api/auth/logout ────────────────────────────────────────────────── */
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

/* ── PATCH /api/auth/credentials ──────────────────────────────────────────── */
// Update the logged-in super admin's email, name, or password.
// Requires the current password as confirmation.
router.patch('/credentials', async (req, res) => {
  if (!req.session || !req.session.user)
    return res.status(401).json({ error: 'Authentication required.' });

  const { currentPassword, newName, newEmail, newPassword } = req.body || {};
  if (!currentPassword)
    return res.status(400).json({ error: 'Current password is required.' });

  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.session.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Account not found.' });

  const valid = await bcrypt.compare(currentPassword, users[idx].password || '');
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

  let changed = false;

  if (newName && newName.trim() && newName.trim() !== users[idx].name) {
    users[idx].name = newName.trim();
    changed = true;
  }

  if (newEmail && newEmail.toLowerCase() !== users[idx].email) {
    const e = newEmail.toLowerCase();
    if (users.some((u, i) => i !== idx && (u.email || '').toLowerCase() === e))
      return res.status(409).json({ error: 'That email is already in use.' });
    users[idx].email = e;
    changed = true;
  }

  if (newPassword) {
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    users[idx].password = await bcrypt.hash(newPassword, 12);
    changed = true;
  }

  if (!changed)
    return res.status(400).json({ error: 'Nothing to update — provide a new name, email, or password.' });

  writeUsers(users);
  req.session.user = safeUser(users[idx]);
  res.json({ success: true, user: req.session.user });
});

/* ══════════════════════════════════════════════════════════════════════════
   GOOGLE OAUTH  (requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in .env
   and Authorised redirect URI set to <APP_URL>/auth/google/callback in the
   Google Cloud Console)
══════════════════════════════════════════════════════════════════════════ */

/* ── GET /api/auth/google ─────────────────────────────────────────────────── */
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId)
    return res.redirect('/login?error=google_not_configured');

  const base        = process.env.APP_URL || 'https://demo-web-app-4l6i.onrender.com';
  const redirectUri = `${base}/api/auth/google/callback`;
  const params      = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'offline',
    prompt:        'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

/* ── GET /api/auth/google/callback ───────────────────────────────────────── */
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/login?error=google_denied');

  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const base         = process.env.APP_URL || 'https://demo-web-app-4l6i.onrender.com';
  const redirectUri  = `${base}/api/auth/google/callback`;

  try {
    /* 1 – exchange code for tokens */
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, client_id: clientId, client_secret: clientSecret,
                             redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) throw new Error(tokens.error_description || 'Token exchange failed');

    /* 2 – fetch user profile */
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    /* 3 – find or create user */
    const users = readUsers();
    let user = users.find(u => u.googleId === profile.id || u.email === profile.email);

    if (!user) {
      user = {
        id: uuidv4(), name: profile.name, email: profile.email,
        password: null, googleId: profile.id, picture: profile.picture,
        createdAt: new Date().toISOString(),
      };
      users.push(user);
    } else {
      if (!user.googleId) user.googleId = profile.id;
      user.picture = profile.picture;
    }
    writeUsers(users);

    req.session.user = safeUser(user);
    res.redirect('/');
  } catch (err) {
    console.error('Google OAuth error:', err.message);
    res.redirect('/login?error=google_failed');
  }
});

module.exports = router;
