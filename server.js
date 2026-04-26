require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const session = require('express-session');

const app  = express();
const PORT = process.env.PORT || 3000;

// Render / Heroku / any reverse-proxy host: trust the proxy so secure cookies work over HTTPS
app.set('trust proxy', 1);

/* ── Data dir ──────────────────────────────────────────────────────────────── */
const dataDir   = path.join(__dirname, 'data');
const dbPath    = path.join(dataDir, 'bookings.json');
const usersPath = path.join(dataDir, 'users.json');

const vendorsPath        = path.join(dataDir, 'vendors.json');
const tiersPath          = path.join(dataDir, 'loyalty-tiers.json');
const statusPath         = path.join(dataDir, 'vendor-loyalty-status.json');
const manualShowsPath    = path.join(dataDir, 'manual-show-entries.json');
const overrideAuditPath  = path.join(dataDir, 'tier-override-audit.json');

if (!fs.existsSync(dataDir))   fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dbPath))    fs.writeFileSync(dbPath,    '[]', 'utf8');
if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, '[]', 'utf8');
if (!fs.existsSync(vendorsPath))        fs.writeFileSync(vendorsPath,       '[]', 'utf8');
if (!fs.existsSync(statusPath))         fs.writeFileSync(statusPath,        '[]', 'utf8');
if (!fs.existsSync(manualShowsPath))    fs.writeFileSync(manualShowsPath,   '[]', 'utf8');
if (!fs.existsSync(overrideAuditPath))  fs.writeFileSync(overrideAuditPath, '[]', 'utf8');
if (!fs.existsSync(tiersPath)) {
  fs.writeFileSync(tiersPath, JSON.stringify([
    { name: 'Silver',   threshold: 1000000, discountPercent: 10 },
    { name: 'Gold',     threshold: 2000000, discountPercent: 15 },
    { name: 'Platinum', threshold: 3000000, discountPercent: 20 },
  ], null, 2), 'utf8');
}

// One-shot migration: ensure existing bookings carry the loyalty fields.
require('./lib/migrate-bookings').run();

/* ── Core middleware ───────────────────────────────────────────────────────── */
app.use(cors());
app.use(express.json());

/* ── Sessions ──────────────────────────────────────────────────────────────── */
app.use(session({
  secret:            process.env.SESSION_SECRET || 'djbookpro-dev-secret-change-in-prod',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));

/* ── Auth middleware ───────────────────────────────────────────────────────── */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.originalUrl.startsWith('/api')) return res.status(401).json({ error: 'Authentication required.' });
  res.redirect('/login');
}

function requireVendor(req, res, next) {
  if (req.session && req.session.vendor) return next();
  if (req.originalUrl.startsWith('/api')) return res.status(401).json({ error: 'Vendor authentication required.' });
  res.redirect('/vendor-login');
}

/* ── Auth routes (public) ──────────────────────────────────────────────────── */
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/vendor-auth', require('./routes/vendor-auth'));

/* ── Protected API routes ──────────────────────────────────────────────────── */
app.use('/api/bookings',       requireAuth,   require('./routes/bookings'));
app.use('/api/admin/loyalty',  requireAuth,   require('./routes/admin-loyalty'));
app.use('/api/loyalty',        requireVendor, require('./routes/loyalty'));

/* ── Static assets ─────────────────────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, 'public')));

/* ── Public auth pages ─────────────────────────────────────────────────────── */
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/vendor-login', (req, res) => {
  if (req.session && req.session.vendor) return res.redirect('/vendor-dashboard.html');
  res.sendFile(path.join(__dirname, 'public', 'vendor-login.html'));
});

/* ── Vendor pages (vendor-only) ────────────────────────────────────────────── */
app.get('/vendor-dashboard.html', requireVendor, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vendor-dashboard.html'));
});

/* ── Admin loyalty page (admin-only) ──────────────────────────────────────── */
app.get('/admin-loyalty.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-loyalty.html'));
});

/* ── All other pages require admin auth ────────────────────────────────────── */
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`DJ BookPro running → http://localhost:${PORT}`);
});
