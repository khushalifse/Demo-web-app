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
const customersPath      = path.join(dataDir, 'customers.json');
const tiersPath          = path.join(dataDir, 'loyalty-tiers.json');
const statusPath         = path.join(dataDir, 'vendor-loyalty-status.json');
const manualShowsPath    = path.join(dataDir, 'manual-show-entries.json');
const overrideAuditPath  = path.join(dataDir, 'tier-override-audit.json');

if (!fs.existsSync(dataDir))   fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dbPath))    fs.writeFileSync(dbPath,    '[]', 'utf8');
if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, '[]', 'utf8');
if (!fs.existsSync(vendorsPath))        fs.writeFileSync(vendorsPath,       '[]', 'utf8');
if (!fs.existsSync(customersPath))      fs.writeFileSync(customersPath,     '[]', 'utf8');
const commissionPaymentsPath = path.join(dataDir, 'commission-payments.json');
if (!fs.existsSync(commissionPaymentsPath)) fs.writeFileSync(commissionPaymentsPath, '[]', 'utf8');
if (!fs.existsSync(statusPath))         fs.writeFileSync(statusPath,        '[]', 'utf8');
if (!fs.existsSync(manualShowsPath))    fs.writeFileSync(manualShowsPath,   '[]', 'utf8');
if (!fs.existsSync(overrideAuditPath))  fs.writeFileSync(overrideAuditPath, '[]', 'utf8');
if (!fs.existsSync(tiersPath)) {
  fs.writeFileSync(tiersPath, JSON.stringify([
    { name: 'Bronze',   threshold: 0,       discountPercent: 5    },
    { name: 'Silver',   threshold: 1000000, discountPercent: 7.5  },
    { name: 'Gold',     threshold: 2500000, discountPercent: 10   },
    { name: 'Platinum', threshold: 5000000, discountPercent: 15   },
  ], null, 2), 'utf8');
} else {
  // Make sure Bronze (the base tier) exists for accounts created before the
  // tier was added.
  try {
    const tiers = JSON.parse(fs.readFileSync(tiersPath, 'utf8'));
    if (!tiers.some(t => (t.name || '').toLowerCase() === 'bronze')) {
      tiers.unshift({ name: 'Bronze', threshold: 0, discountPercent: 5 });
      fs.writeFileSync(tiersPath, JSON.stringify(tiers, null, 2), 'utf8');
    }
  } catch {}
}

// One-shot migration: ensure existing bookings carry the loyalty fields.
require('./lib/migrate-bookings').run();

/* ── Seed predefined super admin ──────────────────────────────────────────── */
// Exactly one super-admin account. If absent on boot, seed it.
const SUPER_ADMIN = {
  email:    'admin@aj.com',
  password: 'Admin@AJ2026',
  name:     'Super Admin',
};
(async () => {
  try {
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    let users = [];
    try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8')); } catch {}
    if (!users.some(u => (u.email || '').toLowerCase() === SUPER_ADMIN.email)) {
      const hashed = await bcrypt.hash(SUPER_ADMIN.password, 12);
      users.push({
        id:        uuidv4(),
        name:      SUPER_ADMIN.name,
        email:     SUPER_ADMIN.email,
        password:  hashed,
        googleId:  null,
        picture:   null,
        createdAt: new Date().toISOString(),
      });
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8');
      console.log(`Seeded super admin → ${SUPER_ADMIN.email} / ${SUPER_ADMIN.password}`);
    }
  } catch (err) {
    console.error('Failed to seed super admin:', err.message);
  }
})();

/* ── Core middleware ───────────────────────────────────────────────────────── */
app.use(cors());
app.use(express.json());

/* ── Sessions ──────────────────────────────────────────────────────────────── */
// Tiny file-backed session store so logins survive server restarts (the default
// MemoryStore loses every session on reload). Persists to data/sessions.json.
const SESSIONS_PATH = path.join(dataDir, 'sessions.json');
class FileSessionStore extends session.Store {
  constructor() {
    super();
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8')); }
    catch { this.data = {}; }
    this._dirty  = false;
    this._timer  = null;
  }
  _flush() {
    if (!this._dirty) return;
    this._dirty = false;
    try { fs.writeFileSync(SESSIONS_PATH, JSON.stringify(this.data), 'utf8'); }
    catch (err) { console.error('Session store write failed:', err.message); }
  }
  _markDirty() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this._flush(); }, 200);
  }
  get(sid, cb) {
    const s = this.data[sid];
    if (!s) return cb(null, null);
    const exp = s.cookie && s.cookie.expires;
    if (exp && new Date(exp) < new Date()) {
      delete this.data[sid];
      this._markDirty();
      return cb(null, null);
    }
    cb(null, s);
  }
  set(sid, sess, cb)   { this.data[sid] = sess; this._markDirty(); cb && cb(null); }
  destroy(sid, cb)     { delete this.data[sid]; this._markDirty(); cb && cb(null); }
  touch(sid, sess, cb) {
    if (this.data[sid]) { this.data[sid].cookie = sess.cookie; this._markDirty(); }
    cb && cb(null);
  }
  length(cb) { cb && cb(null, Object.keys(this.data).length); }
  clear(cb)  { this.data = {}; this._markDirty(); cb && cb(null); }
}

app.use(session({
  store:             new FileSessionStore(),
  secret:            process.env.SESSION_SECRET || 'djbookpro-dev-secret-change-in-prod',
  resave:            false,
  saveUninitialized: false,
  rolling:           true, // refresh cookie expiry on each request so active users stay logged in
  cookie: {
    maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
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

function requireCustomer(req, res, next) {
  if (req.session && req.session.customer) return next();
  if (req.originalUrl.startsWith('/api')) return res.status(401).json({ error: 'Customer authentication required.' });
  res.redirect('/customer-login');
}

/* ── Auth routes (public) ──────────────────────────────────────────────────── */
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/vendor-auth',   require('./routes/vendor-auth'));
app.use('/api/customer-auth', require('./routes/customer-auth'));

/* ── Protected API routes ──────────────────────────────────────────────────── */
app.use('/api/bookings',         requireAuth,     require('./routes/bookings'));
app.use('/api/admin/loyalty',    requireAuth,     require('./routes/admin-loyalty'));
app.use('/api/admin/customers',  requireAuth,     require('./routes/admin-customers'));
app.use('/api/loyalty',          requireVendor,   require('./routes/loyalty'));
app.use('/api/customer',         requireCustomer, require('./routes/customer'));

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
app.get('/customer-login', (req, res) => {
  if (req.session && req.session.customer) return res.redirect('/customer-dashboard.html');
  res.sendFile(path.join(__dirname, 'public', 'customer-login.html'));
});

/* ── Vendor pages (vendor-only) ────────────────────────────────────────────── */
app.get('/vendor-dashboard.html', requireVendor, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vendor-dashboard.html'));
});

/* ── Customer pages (customer-only) ────────────────────────────────────────── */
app.get('/customer-dashboard.html', requireCustomer, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer-dashboard.html'));
});

/* ── Admin loyalty page (admin-only) ──────────────────────────────────────── */
app.get('/admin-loyalty.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-loyalty.html'));
});

/* ── Admin customers page (admin-only) ────────────────────────────────────── */
app.get('/admin-customers.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-customers.html'));
});

/* ── All other pages require admin auth ────────────────────────────────────── */
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`DJ BookPro running → http://localhost:${PORT}`);
});
