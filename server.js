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

if (!fs.existsSync(dataDir))   fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dbPath))    fs.writeFileSync(dbPath,    '[]', 'utf8');
if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, '[]', 'utf8');

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

/* ── Auth routes (public) ──────────────────────────────────────────────────── */
app.use('/api/auth', require('./routes/auth'));

/* ── Protected API routes ──────────────────────────────────────────────────── */
app.use('/api/bookings', requireAuth, require('./routes/bookings'));

/* ── Static assets (CSS, JS, images – no auth needed for assets) ──────────── */
app.use(express.static(path.join(__dirname, 'public')));

/* ── Login page (redirect to / if already logged in) ─────────────────────── */
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

/* ── All other pages require auth ─────────────────────────────────────────── */
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`DJ BookPro running → http://localhost:${PORT}`);
});
