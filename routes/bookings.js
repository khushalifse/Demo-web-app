const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const store    = require('../lib/loyalty-store');
const tierCalc = require('../lib/tier-calc');
const { derivePaymentStatus } = require('../lib/payment-status');

const DB_PATH = path.join(__dirname, '../data/bookings.json');

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Effective base (base + addon amounts) ───────────────────────────────────
function effectiveBase(b) {
  return (Number(b.totalPrice)      || 0) +
         (Number(b.hologramAmount)  || 0) +
         (Number(b.dholAmount)      || 0) +
         (Number(b.ancillaryAmount) || 0);
}

// Persists vendor's loyalty status row so the admin/vendor dashboards stay in sync
// after a booking add/edit/cancel/payment.
function refreshVendorStatus(vendorId) {
  if (!vendorId) return;
  const statuses = store.readStatuses();
  const existing = statuses.find(s => s.vendorId === vendorId) || null;
  const fresh    = tierCalc.recomputeStatus(vendorId, store.readBookings(), store.readTiers(), existing);
  const idx = statuses.findIndex(s => s.vendorId === vendorId);
  if (idx === -1) statuses.push(fresh); else statuses[idx] = fresh;
  store.writeStatuses(statuses);
}

// Snapshot the vendor's current tier/discount onto a new booking. Per spec,
// tier crossings only apply to FUTURE bookings — capture discount% at create time.
function snapshotLoyaltyFields(payload) {
  const out = { ...payload };
  out.isAjsShow = out.isAjsShow !== false; // default true
  out.fullPrice = Number(out.totalPrice) || 0;
  if (out.vendorId && out.isAjsShow) {
    const statuses = store.readStatuses();
    const existing = statuses.find(s => s.vendorId === out.vendorId) || null;
    const fresh    = tierCalc.recomputeStatus(out.vendorId, store.readBookings(), store.readTiers(), existing);
    out.discountPercent = fresh.discountPercent || 0;
    out.discountAmount  = Math.round((out.fullPrice * out.discountPercent) / 100);
  } else {
    out.discountPercent = 0;
    out.discountAmount  = 0;
  }
  out.reversalStatus     = out.reversalStatus     || 'NotEligible';
  out.reversalAmount     = out.reversalAmount     || 0;
  out.reversalDate       = out.reversalDate       || null;
  out.reversalApprovedBy = out.reversalApprovedBy || null;
  out.paymentStatus      = derivePaymentStatus(out);
  return out;
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const bookings  = readDB();
  const GST_RATE  = 0.18;
  const today     = new Date();
  today.setHours(0, 0, 0, 0);

  const monthStart   = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd     = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const daysInMonth  = monthEnd.getDate();

  // ── This month's bookings (not cancelled) ──
  const thisMonthBookings = bookings
    .filter(b => {
      const d = new Date(b.eventDate + 'T00:00:00');
      return d >= monthStart && d <= monthEnd && b.bookingStatus !== 'Cancelled';
    })
    .sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));

  // ── Confirmed revenue for this month (incl. GST) ──
  const thisMonthRevenue = thisMonthBookings
    .filter(b => b.bookingStatus === 'Confirmed' || b.bookingStatus === 'Completed')
    .reduce((sum, b) => sum + effectiveBase(b) * (1 + GST_RATE), 0);

  // ── Total pending payments across all active bookings ──
  const pendingPaymentsTotal = bookings
    .filter(b => b.bookingStatus !== 'Cancelled')
    .reduce((sum, b) => {
      const total = effectiveBase(b) * (1 + GST_RATE);
      const paid  = b.depositPaid ? (Number(b.depositAmount) || 0) : 0;
      return sum + Math.max(0, total - paid);
    }, 0);

  // ── Free days in current month (no confirmed bookings) ──
  const bookedDaysSet = new Set();
  bookings
    .filter(b => b.bookingStatus === 'Confirmed' || b.bookingStatus === 'Completed')
    .forEach(b => {
      const addIfInMonth = (dateStr) => {
        const d = new Date(dateStr + 'T00:00:00');
        if (d >= monthStart && d <= monthEnd) bookedDaysSet.add(dateStr);
      };
      if (b.eventDate) addIfInMonth(b.eventDate);
      if (b.eventDate && b.eventDateTo && b.eventDateTo > b.eventDate) {
        const cur = new Date(b.eventDate + 'T00:00:00');
        const end = new Date(b.eventDateTo + 'T00:00:00');
        while (cur <= end) {
          addIfInMonth(cur.toISOString().split('T')[0]);
          cur.setDate(cur.getDate() + 1);
        }
      }
      if (Array.isArray(b.additionalDates)) {
        b.additionalDates.forEach(d => { if (d) addIfInMonth(d); });
      }
    });

  const occupiedDays    = bookedDaysSet.size;
  const freeDaysCount   = daysInMonth - occupiedDays;
  const occupancyPercent = daysInMonth > 0 ? Math.round((occupiedDays / daysInMonth) * 100) : 0;

  res.json({
    thisMonthCount:       thisMonthBookings.length,
    thisMonthRevenue,
    pendingPaymentsTotal,
    freeDaysCount,
    occupancyPercent,
    thisMonthBookings,
    // legacy keys kept for compatibility
    upcomingCount:        thisMonthBookings.length,
    totalRevenue:         thisMonthRevenue,
    pendingDepositsCount: bookings.filter(b => !b.depositPaid && b.bookingStatus !== 'Cancelled').length,
    upcomingBookings:     thisMonthBookings,
  });
});

// ─── Double-booking helper ────────────────────────────────────────────────────
function hasDateConflict(booking, dateStr) {
  if (!dateStr) return false;
  if (booking.eventDate === dateStr) return true;
  if (booking.eventDate && booking.eventDateTo &&
      dateStr >= booking.eventDate && dateStr <= booking.eventDateTo) return true;
  if (Array.isArray(booking.additionalDates) && booking.additionalDates.includes(dateStr)) return true;
  return false;
}

function checkDoubleBooking(bookings, payload, excludeId) {
  const datesToCheck = [payload.eventDate];
  if (payload.eventDateTo) datesToCheck.push(payload.eventDateTo);
  if (Array.isArray(payload.additionalDates)) datesToCheck.push(...payload.additionalDates);

  for (const date of datesToCheck.filter(Boolean)) {
    const conflict = bookings.find(b =>
      b.id !== excludeId &&
      b.bookingStatus === 'Confirmed' &&
      hasDateConflict(b, date)
    );
    if (conflict) {
      return `Double booking on ${date}! "${conflict.hostName || conflict.clientName}" is already confirmed for that date.`;
    }
  }
  return null;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const bookings = readDB();
  const sorted = bookings.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
  res.json(sorted);
});

router.get('/:id', (req, res) => {
  const booking = readDB().find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  res.json(booking);
});

router.post('/', (req, res) => {
  const bookings = readDB();

  // Double-booking guard (only blocks Confirmed status)
  if (req.body.bookingStatus === 'Confirmed') {
    const conflict = checkDoubleBooking(bookings, req.body, null);
    if (conflict) return res.status(409).json({ error: conflict });
  }

  const withLoyalty = snapshotLoyaltyFields(req.body);
  const booking = {
    id: uuidv4(),
    ...withLoyalty,
    depositPaid: req.body.depositPaid === true || req.body.depositPaid === 'true',
    paymentLinks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  bookings.push(booking);
  writeDB(bookings);
  refreshVendorStatus(booking.vendorId);
  res.status(201).json(booking);
});

router.put('/:id', (req, res) => {
  const bookings = readDB();
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });

  // Double-booking guard (only blocks Confirmed status)
  if (req.body.bookingStatus === 'Confirmed') {
    const conflict = checkDoubleBooking(bookings, req.body, req.params.id);
    if (conflict) return res.status(409).json({ error: conflict });
  }

  // On edit, re-derive paymentStatus from depositAmount, but DO NOT re-snapshot
  // discountPercent — that was locked in at create time per spec ("tier crossing
  // mid-year applies to future bookings only").
  const merged = {
    ...bookings[idx],
    ...req.body,
    id: req.params.id,
    depositPaid: req.body.depositPaid === true || req.body.depositPaid === 'true',
    paymentLinks: bookings[idx].paymentLinks || [],
    updatedAt: new Date().toISOString(),
  };
  merged.paymentStatus = derivePaymentStatus(merged);
  if (merged.paymentStatus === 'FullyPaid' &&
      merged.isAjsShow &&
      Number(merged.discountAmount) > 0 &&
      merged.reversalStatus === 'NotEligible') {
    merged.reversalStatus = 'Eligible';
  }
  bookings[idx] = merged;
  writeDB(bookings);
  refreshVendorStatus(merged.vendorId);
  res.json(bookings[idx]);
});

// ─── Record Manual Payment ────────────────────────────────────────────────────
router.patch('/:id/record-payment', (req, res) => {
  const bookings = readDB();
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });

  const { additionalPayment, paymentMode } = req.body;
  const added = Number(additionalPayment) || 0;
  if (added <= 0) return res.status(400).json({ error: 'Payment amount must be greater than zero.' });

  const b            = bookings[idx];
  const GST_RATE     = 0.18;
  const totalWithGST = effectiveBase(b) * (1 + GST_RATE);
  const newDeposit   = (Number(b.depositAmount) || 0) + added;

  bookings[idx].depositAmount = newDeposit;
  bookings[idx].depositPaid   = newDeposit >= totalWithGST ? true : b.depositPaid;
  if (paymentMode) bookings[idx].paymentMode = paymentMode;
  bookings[idx].paymentStatus = derivePaymentStatus(bookings[idx]);
  if (bookings[idx].paymentStatus === 'FullyPaid' &&
      bookings[idx].isAjsShow &&
      Number(bookings[idx].discountAmount) > 0 &&
      bookings[idx].reversalStatus === 'NotEligible') {
    bookings[idx].reversalStatus = 'Eligible';
  }
  bookings[idx].updatedAt = new Date().toISOString();

  writeDB(bookings);
  refreshVendorStatus(bookings[idx].vendorId);
  res.json(bookings[idx]);
});

router.delete('/:id', (req, res) => {
  const bookings = readDB();
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Booking not found' });
  const removed = bookings[idx];
  bookings.splice(idx, 1);
  writeDB(bookings);
  // Removing a booking reduces YTD; refresh vendor's tier.
  refreshVendorStatus(removed.vendorId);
  res.json({ success: true });
});

// ─── Generate Razorpay Payment Link ───────────────────────────────────────────
router.post('/:id/payment-link', async (req, res) => {
  const bookings = readDB();
  const booking = bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const { paymentType } = req.body; // 'deposit' or 'full'
  const amount = paymentType === 'deposit'
    ? Number(booking.depositAmount)
    : Number(booking.totalPrice);

  if (!amount || isNaN(amount)) {
    return res.status(400).json({ error: 'Invalid amount for the selected payment type' });
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ error: 'Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env file.' });
  }

  try {
    const Razorpay = require('razorpay');
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const linkPayload = {
      amount: Math.round(amount * 100), // paise
      currency: 'INR',
      accept_partial: false,
      description: `DJ Booking – ${booking.eventType} at ${booking.venue} (${booking.eventDate})`,
      customer: {
        name: booking.clientName,
        contact: booking.phone,
      },
      notify: { sms: true, email: false },
      reminder_enable: true,
      notes: {
        booking_id: booking.id,
        payment_type: paymentType,
        client: booking.clientName,
      },
    };

    if (process.env.CALLBACK_URL) {
      linkPayload.callback_url = process.env.CALLBACK_URL;
      linkPayload.callback_method = 'get';
    }

    const link = await razorpay.paymentLink.create(linkPayload);

    // Persist the link on the booking
    const idx = bookings.findIndex(b => b.id === req.params.id);
    if (!bookings[idx].paymentLinks) bookings[idx].paymentLinks = [];
    bookings[idx].paymentLinks.unshift({
      type: paymentType,
      amount,
      url: link.short_url,
      razorpayId: link.id,
      createdAt: new Date().toISOString(),
    });
    writeDB(bookings);

    res.json({ url: link.short_url, amount, type: paymentType });
  } catch (err) {
    console.error('Razorpay error:', err);
    res.status(500).json({ error: err.error?.description || err.message || 'Failed to generate payment link' });
  }
});

// ─── Send WhatsApp Reminder ───────────────────────────────────────────────────
router.post('/:id/whatsapp', async (req, res) => {
  const bookings = readDB();
  const booking = bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const { paymentLink } = req.body; // optional

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_NUMBER) {
    return res.status(500).json({ error: 'Twilio credentials not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER in your .env file.' });
  }

  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const eventDate = new Date(booking.eventDate).toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const depositStatus = booking.depositPaid ? '✅ Paid' : '⏳ Pending';
    const paymentSection = paymentLink
      ? `\n💰 *Payment Link:* ${paymentLink}`
      : '';

    const message =
      `Hi ${booking.clientName}! 🎶\n\n` +
      `Friendly reminder for your upcoming event:\n\n` +
      `📅 *Date:* ${eventDate}\n` +
      `⏰ *Time:* ${booking.eventTime}\n` +
      `📍 *Venue:* ${booking.venue}\n` +
      `🎉 *Event:* ${booking.eventType}\n\n` +
      `💳 *Payment Summary:*\n` +
      `• Total: ₹${Number(booking.totalPrice).toLocaleString('en-IN')}\n` +
      `• Deposit: ₹${Number(booking.depositAmount).toLocaleString('en-IN')} – ${depositStatus}` +
      paymentSection +
      `\n\nLooking forward to making your event unforgettable! 🎧✨`;

    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${booking.phone}`,
      body: message,
    });

    res.json({ success: true, message: 'WhatsApp reminder sent!' });
  } catch (err) {
    console.error('Twilio error:', err);
    res.status(500).json({ error: err.message || 'Failed to send WhatsApp message' });
  }
});

module.exports = router;
