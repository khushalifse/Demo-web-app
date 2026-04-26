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
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const users = readUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: 'An account with this email already exists.' });

  const hashed = await bcrypt.hash(password, 12);
  const user = {
    id: uuidv4(), name, email: email.toLowerCase(),
    password: hashed, googleId: null, picture: null,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);

  req.session.user = safeUser(user);
  res.json({ success: true, user: req.session.user });
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
