'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   DJ BookPro — Main App
══════════════════════════════════════════════════════════════════════════ */

const GST_RATE = 0.18;

const CREW_PRICING = {
  maddy:  { name: 'Maddy',  sell: 65000, buy: 25000 },
  amnish: { name: 'Amnish', sell: 8000,  buy: 8000  },
  rajat:  { name: 'Rajat',  sell: 0,     buy: 0     },
  hardik: { name: 'Hardik', sell: 35000, buy: 15000 },
};

/* ─── State ──────────────────────────────────────────────────────────────── */
let allBookings       = [];
let editingId         = null;
let statusFilter      = 'all';
let searchTerm        = '';
let paymentBookingId  = null;
let whatsappBookingId = null;
let generatedPayLink  = null;
let extraDateCount    = 0;   // for dynamic additional dates

/* ─── API helper ─────────────────────────────────────────────────────────── */
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    // Session expired – redirect to login
    location.href = '/login';
    return;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ─── Initialise ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  /* Auth guard – confirm we have a session */
  try {
    const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json());
    if (!me.loggedIn) { location.href = '/login'; return; }
    document.getElementById('userName').textContent = me.user.name;
    if (me.user.picture) {
      document.getElementById('userAvatar').innerHTML =
        `<img src="${me.user.picture}" alt="avatar" style="width:30px;height:30px;border-radius:50%;object-fit:cover">`;
    }
  } catch {
    location.href = '/login';
    return;
  }

  document.getElementById('today-date').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  /* Set minimum dates to tomorrow */
  setFutureDateMin();

  wireToggles();
  loadDashboard();
  loadBookings();
});

/* ─── Logout ────────────────────────────────────────────────────────────── */
async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  location.href = '/login';
}

/* ─── Navigation ─────────────────────────────────────────────────────────── */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  const navBtn = document.querySelector(`[data-view="${name}"]`);
  if (navBtn) navBtn.classList.add('active');
  if (name === 'calendar')  renderCalendar();
  if (name === 'payments')  renderPaymentsView();
  if (name === 'team')      renderTeamView();
  if (name === 'analytics') renderAnalyticsView();
  if (name === 'loyalty')   renderLoyaltyView();
}

/* ─── Dashboard ──────────────────────────────────────────────────────────── */
async function loadDashboard() {
  try {
    const stats     = await api('GET', '/api/bookings/stats');
    const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    document.getElementById('stat-upcoming').textContent    = stats.thisMonthCount;
    document.getElementById('stat-month-label').textContent = monthLabel;
    document.getElementById('stat-revenue').textContent     = formatCurrency(stats.thisMonthRevenue);
    document.getElementById('stat-revenue-label').textContent = monthLabel;
    document.getElementById('stat-deposits').textContent    = formatCurrency(stats.pendingPaymentsTotal);
    document.getElementById('stat-month').textContent       = stats.freeDaysCount;
    document.getElementById('stat-occupancy').textContent   = `${stats.occupancyPercent}% Month Occupied`;

    initDashboardFilter();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ─── Dashboard Filter ───────────────────────────────────────────────────── */
function initDashboardFilter() {
  const sel = document.getElementById('dash-month-filter');
  if (!sel) return;

  // Build month options from allBookings
  const monthSet = new Set();
  allBookings.forEach(b => {
    if (b.eventDate) monthSet.add(b.eventDate.slice(0, 7)); // YYYY-MM
  });
  const months = [...monthSet].sort();
  const curYM  = new Date().toISOString().slice(0, 7);

  sel.innerHTML = '<option value="all">All Bookings</option>' +
    months.map(ym => {
      const label = new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      return `<option value="${ym}"${ym === curYM ? ' selected' : ''}>${label}</option>`;
    }).join('');

  applyDashboardFilter();
}

function applyDashboardFilter() {
  const sel = document.getElementById('dash-month-filter');
  const ym  = sel ? sel.value : 'all';
  let filtered = allBookings;
  if (ym !== 'all') {
    filtered = allBookings.filter(b => b.eventDate && b.eventDate.startsWith(ym));
  }
  filtered = [...filtered].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  renderDashboardTableRows(filtered);
}

/* ─── Dashboard Table (new column set) ──────────────────────────────────── */
function renderDashboardTableRows(bookings) {
  const tbody = document.getElementById('dashboard-table-body');
  if (!bookings.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row">
      <i class="fas fa-calendar-times" style="display:block;font-size:2rem;margin-bottom:10px;opacity:.3"></i>
      No bookings this month</td></tr>`;
    return;
  }
  tbody.innerHTML = bookings.map(b => {
    const base        = effectiveBase(b);
    const totalWithGST = base * (1 + GST_RATE);
    const paid        = b.depositPaid ? (b.depositAmount || 0) : 0;
    const pendingAmt  = Math.max(0, totalWithGST - paid);
    const dateStr     = b.eventDate ? formatDate(b.eventDate) : '—';

    return `<tr>
      <td>
        <div class="client-name">${esc(b.clientName || '—')}</div>
        <div class="row-sub">${dateStr}${b.eventTime ? ' · ' + b.eventTime : ''}</div>
      </td>
      <td>
        <div class="client-name">${esc(b.hostName || '—')}</div>
      </td>
      <td>
        <div class="venue-name">${esc(b.venue || '—')}</div>
      </td>
      <td>
        <span class="event-type-pill">${esc(b.eventType || '—')}</span>
      </td>
      <td>
        <div class="price-text">${formatCurrency(totalWithGST)}</div>
        <div class="row-sub">Base ₹${Math.round(b.totalPrice || 0).toLocaleString('en-IN')}${base > (b.totalPrice||0) ? ` +add-ons` : ''}</div>
      </td>
      <td>
        ${pendingAmt > 0
          ? `<div class="price-text pending-amount">${formatCurrency(pendingAmt)}</div>
             <div class="row-sub pending-label">Pending</div>`
          : `<div class="price-text cleared-amount">Cleared</div>
             <div class="row-sub cleared-label">Fully Paid</div>`
        }
      </td>
      <td>${buildStatusCell(b)}</td>
      <td>
        <div class="row-remarks">${b.remarks ? esc(b.remarks) : '<span style="color:var(--text-3)">—</span>'}</div>
      </td>
      <td>
        <div class="action-btns">
          <button class="btn-icon edit"          title="Edit"         onclick="openModal('${b.id}')"><i class="fas fa-pen"></i></button>
          <button class="btn-icon delete"        title="Delete"       onclick="confirmDelete('${b.id}','${esc(b.clientName)}')"><i class="fas fa-trash-alt"></i></button>
          <button class="btn-icon payment"       title="Payment Link" onclick="openPaymentModal('${b.id}')"><i class="fas fa-link"></i></button>
          <button class="btn-icon whatsapp-icon" title="WhatsApp"     onclick="openWhatsAppModal('${b.id}')"><i class="fab fa-whatsapp"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ─── All Bookings ───────────────────────────────────────────────────────── */
async function loadBookings() {
  try {
    allBookings = await api('GET', '/api/bookings');
    applyFilters();
    renderPaymentsView();
    renderTeamView();
    renderAnalyticsView();
    initDashboardFilter();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ─── Payments View ──────────────────────────────────────────────────────── */
function renderPaymentsView() {
  const active = allBookings.filter(b => b.bookingStatus !== 'Cancelled');
  const tbody  = document.getElementById('payments-table-body');
  if (!tbody) return;

  let totalBilled   = 0;
  let totalReceived = 0;

  if (!active.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No bookings found</td></tr>`;
  } else {
    tbody.innerHTML = active.map(b => {
      const base         = effectiveBase(b);
      const totalWithGST = base * (1 + GST_RATE);
      const received     = Number(b.depositAmount) || 0;
      const balance      = Math.max(0, totalWithGST - received);
      totalBilled   += totalWithGST;
      totalReceived += received;

      return `<tr>
        <td>
          <div class="client-name">${esc(b.hostName || b.clientName)}</div>
          <div class="row-sub">${esc(b.clientName !== (b.hostName || b.clientName) ? b.clientName : '')}</div>
        </td>
        <td>
          <div class="event-date">${formatDate(b.eventDate)}</div>
          <div class="event-time">${b.eventTime || '—'}</div>
        </td>
        <td><div class="price-text">${formatCurrency(totalWithGST)}</div></td>
        <td><div class="price-text" style="color:var(--success)">${formatCurrency(received)}</div></td>
        <td>
          ${balance > 0
            ? `<div class="price-text pending-amount">${formatCurrency(balance)}</div>`
            : `<div class="price-text cleared-amount">Cleared</div>`}
        </td>
        <td>
          <div class="action-btns">
            <button class="btn-icon payment" title="Payment" onclick="openPaymentModal('${b.id}')"><i class="fas fa-link"></i></button>
            <button class="btn-icon whatsapp-icon" title="WhatsApp" onclick="openWhatsAppModal('${b.id}')"><i class="fab fa-whatsapp"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  const outstanding = Math.max(0, totalBilled - totalReceived);
  document.getElementById('pay-total-billed').textContent   = formatCurrency(totalBilled);
  document.getElementById('pay-total-received').textContent = formatCurrency(totalReceived);
  document.getElementById('pay-outstanding').textContent    = formatCurrency(outstanding);
  document.getElementById('payments-badge').textContent     = `${active.length} booking${active.length !== 1 ? 's' : ''}`;
}

/* ─── Team View ──────────────────────────────────────────────────────────── */
function renderTeamView() {
  const grid = document.getElementById('team-grid');
  if (!grid) return;

  const artists = [
    { key: 'maddy',  name: 'Maddy',  icon: 'fa-headphones', color: '#f05829' },
    { key: 'amnish', name: 'Amnish', icon: 'fa-headphones', color: '#3b82f6' },
    { key: 'rajat',  name: 'Rajat',  icon: 'fa-headphones', color: '#10b981' },
    { key: 'hardik', name: 'Hardik', icon: 'fa-headphones', color: '#f59e0b' },
  ];

  const active = allBookings.filter(b => b.bookingStatus !== 'Cancelled');

  grid.innerHTML = artists.map(artist => {
    const assignments = active.filter(b => (b[artist.key] || 0) > 0);
    const totalEvents = assignments.reduce((sum, b) => sum + (Number(b[artist.key]) || 0), 0);
    const upcoming    = assignments
      .filter(b => b.eventDate >= new Date().toISOString().split('T')[0])
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

    const bookingRows = upcoming.slice(0, 6).map(b => `
      <div class="team-event-row">
        <div>
          <div class="team-event-name">${esc(b.hostName || b.clientName)}</div>
          <div class="team-event-meta">${esc(b.eventType)} · ${esc(b.venue || '').split(',').slice(-1)[0].trim()}</div>
        </div>
        <div class="team-event-right">
          <div class="team-event-date">${formatDate(b.eventDate)}</div>
          <span class="crew-pill">${b[artist.key]}× events</span>
        </div>
      </div>`).join('');

    return `
      <div class="team-card">
        <div class="team-card-header" style="border-color:${artist.color}">
          <div class="team-avatar" style="background:${artist.color}20;color:${artist.color}">
            <i class="fas ${artist.icon}"></i>
          </div>
          <div class="team-info">
            <div class="team-name">${artist.name}</div>
            <div class="team-stats">
              <span class="crew-pill">${totalEvents} total event${totalEvents !== 1 ? 's' : ''}</span>
              <span style="color:var(--text-3);font-size:0.75rem">${upcoming.length} upcoming</span>
            </div>
          </div>
        </div>
        <div class="team-events-list">
          ${bookingRows || '<div class="team-empty">No upcoming events</div>'}
        </div>
      </div>`;
  }).join('');

  document.getElementById('team-badge').textContent = `${active.length} active booking${active.length !== 1 ? 's' : ''}`;
}

/* ─── Analytics View ─────────────────────────────────────────────────────── */
function renderAnalyticsView() {
  const today  = getToday();
  const active = allBookings.filter(b => b.bookingStatus !== 'Cancelled');

  // KPIs
  const confRevenue = active
    .filter(b => b.bookingStatus === 'Confirmed' || b.bookingStatus === 'Completed')
    .reduce((s, b) => s + effectiveBase(b) * (1 + GST_RATE), 0);
  const totalReceived = active.reduce((s, b) => s + (Number(b.depositAmount) || 0), 0);
  const totalBilled   = active.reduce((s, b) => s + effectiveBase(b) * (1 + GST_RATE), 0);
  const outstanding   = Math.max(0, totalBilled - totalReceived);
  const confirmed     = active.filter(b => b.bookingStatus === 'Confirmed').length;

  document.getElementById('an-total-revenue').textContent   = formatCurrency(confRevenue);
  document.getElementById('an-total-bookings').textContent  = active.length;
  document.getElementById('an-confirmed-count').textContent = `${confirmed} confirmed`;
  document.getElementById('an-outstanding').textContent     = formatCurrency(outstanding);

  // Monthly breakdown
  const monthMap = {};
  active.forEach(b => {
    if (!b.eventDate) return;
    const ym = b.eventDate.slice(0, 7);
    if (!monthMap[ym]) monthMap[ym] = { bookings: 0, revenue: 0, received: 0 };
    monthMap[ym].bookings++;
    monthMap[ym].revenue  += effectiveBase(b) * (1 + GST_RATE);
    monthMap[ym].received += Number(b.depositAmount) || 0;
  });
  const sortedMonths = Object.keys(monthMap).sort();
  document.getElementById('an-monthly-body').innerHTML = sortedMonths.map(ym => {
    const d   = new Date(ym + '-01T00:00:00');
    const lbl = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const m   = monthMap[ym];
    const out = Math.max(0, m.revenue - m.received);
    return `<tr>
      <td><strong>${lbl}</strong></td>
      <td>${m.bookings}</td>
      <td><div class="price-text" style="font-size:0.9rem">${formatCurrency(m.revenue)}</div></td>
      <td style="color:var(--success)">${formatCurrency(m.received)}</td>
      <td style="color:var(--warning)">${formatCurrency(out)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="empty-row">No data</td></tr>';

  // Status breakdown
  const statuses = ['Enquiry','Confirmed','Completed','Cancelled'];
  const total_all = allBookings.length || 1;
  document.getElementById('an-status-bars').innerHTML = statuses.map(s => {
    const cnt = allBookings.filter(b => b.bookingStatus === s).length;
    const pct = Math.round((cnt / total_all) * 100);
    const cls = s === 'Confirmed' ? 'success' : s === 'Cancelled' ? 'danger' : s === 'Completed' ? 'info' : 'warning';
    return `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:4px">
        <span style="color:var(--text-2)">${s}</span>
        <span style="color:var(--text)">${cnt} booking${cnt !== 1 ? 's' : ''}</span>
      </div>
      <div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--${cls});border-radius:4px;transition:width 0.5s"></div>
      </div>
    </div>`;
  }).join('');

  // Artist utilization
  document.getElementById('an-artist-bars').innerHTML = Object.entries(CREW_PRICING).map(([key, a]) => {
    const events = allBookings.reduce((s, b) => s + (Number(b[key]) || 0), 0);
    const rev    = allBookings.reduce((s, b) => s + (Number(b[key]) || 0) * a.sell, 0);
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:600;color:var(--text)">${a.name}</div>
        <div style="font-size:0.75rem;color:var(--text-3)">Sell ₹${a.sell.toLocaleString('en-IN')} / Buy ₹${a.buy.toLocaleString('en-IN')}</div>
      </div>
      <div style="text-align:right">
        <div class="crew-pill" style="margin-bottom:3px">${events} event${events !== 1 ? 's' : ''}</div>
        <div style="font-size:0.75rem;color:var(--success)">Rev ${formatCurrency(rev)}</div>
      </div>
    </div>`;
  }).join('');

  // Profitability
  const totalRevenue = active.reduce((s, b) => s + effectiveBase(b) * (1 + GST_RATE), 0);
  const totalCost    = active.reduce((s, b) => {
    return s +
      (Number(b.maddy)  || 0) * CREW_PRICING.maddy.buy  +
      (Number(b.amnish) || 0) * CREW_PRICING.amnish.buy +
      (Number(b.rajat)  || 0) * CREW_PRICING.rajat.buy  +
      (Number(b.hardik) || 0) * CREW_PRICING.hardik.buy;
  }, 0);
  const grossProfit  = totalRevenue - totalCost;
  const margin       = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(1) : 0;
  document.getElementById('an-profit-section').innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text-2)">Total Revenue (all active)</span>
      <strong>${formatCurrency(totalRevenue)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text-2)">Artist Purchase Costs</span>
      <strong style="color:var(--danger)">${formatCurrency(totalCost)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <strong style="color:var(--success)">Gross Profit</strong>
      <strong style="color:var(--success)">${formatCurrency(grossProfit)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0">
      <span style="color:var(--text-3);font-size:0.82rem">Gross Margin</span>
      <span style="color:var(--accent);font-weight:700;font-size:1rem">${margin}%</span>
    </div>`;

  document.getElementById('analytics-period').textContent = `${active.length} active booking${active.length !== 1 ? 's' : ''}`;
}

function applyFilters() {
  searchTerm = document.getElementById('search-input').value.toLowerCase().trim();
  const today = getToday();
  const filtered = allBookings.filter(b => {
    let matchStatus;
    if (statusFilter === 'all') {
      matchStatus = true;
    } else if (statusFilter === 'Completed') {
      // Completed = past date AND fully paid
      const totalWithGST = effectiveBase(b) * (1 + GST_RATE);
      const received = Number(b.depositAmount) || 0;
      matchStatus = b.eventDate < today && received >= totalWithGST;
    } else {
      matchStatus = b.bookingStatus === statusFilter;
    }
    const matchSearch = !searchTerm ||
      (b.clientName  || '').toLowerCase().includes(searchTerm) ||
      (b.hostName    || '').toLowerCase().includes(searchTerm) ||
      (b.venue       || '').toLowerCase().includes(searchTerm) ||
      (b.eventType   || '').toLowerCase().includes(searchTerm);
    return matchStatus && matchSearch;
  });
  renderTableRows('bookings-table-body', filtered, false);
  document.getElementById('bookings-count').textContent =
    `Showing ${filtered.length} of ${allBookings.length} booking${allBookings.length !== 1 ? 's' : ''}`;
}

function setStatusFilter(status, btn) {
  statusFilter = status;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  applyFilters();
}

/* ─── Table Rendering ────────────────────────────────────────────────────── */
function renderTableRows(tbodyId, bookings, isDashboard) {
  const tbody = document.getElementById(tbodyId);
  if (!bookings.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">
      <i class="fas fa-calendar-times" style="display:block;font-size:2rem;margin-bottom:10px;opacity:.3"></i>
      No bookings found</td></tr>`;
    return;
  }
  tbody.innerHTML = bookings.map(b => {
    const base        = effectiveBase(b);
    const gst         = base * GST_RATE;
    const totalWithGST = base + gst;
    const dateDisplay = buildDateDisplay(b);

    return `<tr>
      <td>
        <div class="client-name">${esc(b.hostName || b.clientName)}</div>
        <div class="client-phone">${esc(b.clientName !== b.hostName ? b.clientName : '')}
          <span style="color:var(--text-3)">${esc(buildFullPhone(b))}</span>
        </div>
      </td>
      <td>
        <div class="event-date">${dateDisplay}</div>
        <div class="event-time">${b.eventTime || '—'}</div>
      </td>
      <td>${esc(b.venue)}</td>
      <td>${esc(b.eventType)}</td>
      <td>
        <div class="price-text">${formatCurrency(totalWithGST)}</div>
        <div class="deposit-amount" style="font-size:0.72rem;color:var(--text-3)">
          Base: ${formatCurrency(base)} + GST: ${formatCurrency(gst)}
        </div>
      </td>
      <td>
        <div class="deposit-amount">${formatCurrency(b.depositAmount)}</div>
        ${depositBadge(b)}
      </td>
      <td>${buildStatusCell(b)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon edit"         title="Edit"            onclick="openModal('${b.id}')"><i class="fas fa-pen"></i></button>
          <button class="btn-icon delete"       title="Delete"          onclick="confirmDelete('${b.id}','${esc(b.clientName)}')"><i class="fas fa-trash-alt"></i></button>
          <button class="btn-icon record-pay"   title="Record Payment"  onclick="openPaymentModal('${b.id}')"><i class="fas fa-rupee-sign"></i></button>
          <button class="btn-icon payment"      title="Payment Link"    onclick="openPaymentModal('${b.id}')"><i class="fas fa-link"></i></button>
          <button class="btn-icon whatsapp-icon"title="WhatsApp"        onclick="openWhatsAppModal('${b.id}')"><i class="fab fa-whatsapp"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ─── Status Cell builder ────────────────────────────────────────────────── */
function buildStatusCell(b) {
  let html = `<span class="status-badge status-${(b.bookingStatus || '').toLowerCase()}">${esc(b.bookingStatus)}</span>`;
  if (b.hologram)     html += `<br><span class="hologram-badge"><i class="fas fa-cube"></i> Hologram</span>`;
  if (b.dholRequired) html += `<br><span class="dhol-badge"><i class="fas fa-drum"></i> Dhol</span>`;
  if (b.ancillaryActs) {
    const actName = b.ancillaryActName ? `: ${esc(b.ancillaryActName)}` : '';
    html += `<br><span class="ancillary-badge"><i class="fas fa-star"></i> Act${actName}</span>`;
  }
  const crew = [
    b.maddy  > 0 ? `Maddy×${b.maddy}`  : null,
    b.amnish > 0 ? `Amnish×${b.amnish}` : null,
    b.rajat  > 0 ? `Rajat×${b.rajat}`  : null,
    b.hardik > 0 ? `Hardik×${b.hardik}` : null,
  ].filter(Boolean);
  if (crew.length) {
    html += `<div class="crew-pills">${crew.map(c => `<span class="crew-pill">${c}</span>`).join('')}</div>`;
  }
  return html;
}

/* ─── Date helpers ───────────────────────────────────────────────────────── */
function buildDateDisplay(b) {
  const dates = [];
  if (b.eventDate) dates.push(formatDate(b.eventDate));
  if (b.eventDateTo && b.eventDateTo !== b.eventDate) dates.push('→ ' + formatDate(b.eventDateTo));
  if (Array.isArray(b.additionalDates)) {
    b.additionalDates.slice(0, 2).forEach(d => dates.push(formatDate(d)));
    if (b.additionalDates.length > 2) dates.push(`+${b.additionalDates.length - 2} more`);
  }
  return dates.join('<br>') || '—';
}

function buildFullPhone(b) {
  const code = b.countryCode || '+91';
  const num  = b.phone || '';
  return num ? `${code} ${num}` : '';
}

/* ─── GST Calculator (live) ──────────────────────────────────────────────── */
function updateGSTCalc() {
  const base     = parseFloat(document.getElementById('f-totalPrice').value)    || 0;
  const deposit  = parseFloat(document.getElementById('f-depositAmount').value) || 0;

  const holoAmt  = document.getElementById('f-hologram')?.checked
    ? (parseFloat(document.getElementById('f-hologramAmount')?.value) || 0) : 0;
  const dholAmt  = document.getElementById('f-dholRequired')?.checked
    ? (parseFloat(document.getElementById('f-dholAmount')?.value)     || 0) : 0;
  const ancAmt   = document.getElementById('f-ancillaryActs')?.checked
    ? (parseFloat(document.getElementById('f-ancillaryAmount')?.value)|| 0) : 0;

  const addons   = holoAmt + dholAmt + ancAmt;
  const subtotal = base + addons;
  const gst      = subtotal * GST_RATE;
  const total    = subtotal + gst;
  const pending  = Math.max(0, total - deposit);

  document.getElementById('gc-base').textContent    = formatCurrency(base);

  const addonsRow = document.getElementById('gc-addons-row');
  if (addons > 0) {
    document.getElementById('gc-addons').textContent = formatCurrency(addons);
    addonsRow.style.display = '';
  } else {
    addonsRow.style.display = 'none';
  }

  document.getElementById('gc-gst').textContent     = formatCurrency(gst);
  document.getElementById('gc-total').textContent   = formatCurrency(total);
  document.getElementById('gc-deposit').textContent = formatCurrency(deposit);

  const pendEl = document.getElementById('gc-pending');
  pendEl.textContent = formatCurrency(pending);
  pendEl.closest('.gst-row').classList.toggle('all-clear', pending === 0);
}

/* ─── Future-date validation helpers ─────────────────────────────────────── */
function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function setFutureDateMin() {
  const today = getToday();
  const el = document.getElementById('f-eventDate');
  if (el) el.min = today;
}

function validateStartDate(el) {
  const today = getToday();
  const val = el.value;
  if (val && val < today) {
    el.style.borderColor = 'var(--danger)';
    el.style.boxShadow   = '0 0 0 3px rgba(239,68,68,0.2)';
    el.title = 'Date cannot be in the past';
    el.setCustomValidity('Date cannot be in the past');
  } else {
    el.style.borderColor = '';
    el.style.boxShadow   = '';
    el.title = '';
    el.setCustomValidity('');
    if (val) onStartDateChange();
  }
}

function onStartDateChange() {
  const startEl = document.getElementById('f-eventDate');
  const endEl   = document.getElementById('f-eventDateTo');
  if (!startEl || !endEl || !startEl.value) return;
  const start = startEl.value;
  // min = start date, default = start date, max = start + 5 days
  const maxDate = new Date(start + 'T00:00:00');
  maxDate.setDate(maxDate.getDate() + 5);
  const maxStr = maxDate.toISOString().split('T')[0];
  endEl.min = start;
  endEl.max = maxStr;
  if (!endEl.value || endEl.value < start) endEl.value = start;
}

function validateEndDate(el) {
  const startVal = document.getElementById('f-eventDate')?.value;
  const today    = getToday();
  if (el.value && el.value < today) {
    el.style.borderColor = 'var(--danger)';
    el.style.boxShadow   = '0 0 0 3px rgba(239,68,68,0.2)';
    el.setCustomValidity('End date cannot be in the past');
  } else if (startVal && el.value < startVal) {
    el.style.borderColor = 'var(--danger)';
    el.style.boxShadow   = '0 0 0 3px rgba(239,68,68,0.2)';
    el.setCustomValidity('End date cannot be before start date');
  } else {
    el.style.borderColor = '';
    el.style.boxShadow   = '';
    el.setCustomValidity('');
  }
}

/* ─── Extra Dates (full card per date) ──────────────────────────────────── */
function addExtraDate(prefill = {}) {
  extraDateCount++;
  const n = extraDateCount;
  const list = document.getElementById('extra-dates-list');
  const card = document.createElement('div');
  card.className = 'extra-date-card';
  card.id = `extra-date-row-${n}`;

  const eventTypeOptions = [
    'Wedding','Sangeet','Haldi / Mehendi / Baraat','After Party',
    'Birthday Party','Anniversary','Private Party',
    'Corporate Event','Club Night','Festival','Other'
  ].map(t => `<option${t === prefill.eventType ? ' selected' : ''}>${t}</option>`).join('');

  card.innerHTML = `
    <div class="extra-date-card-header">
      <span class="extra-date-label"><i class="fas fa-calendar-plus"></i> Additional Date ${n}</span>
      <button type="button" class="btn-remove-date" onclick="removeExtraDate(${n})">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label>Date</label>
        <input type="date" id="extra-date-${n}" min="${getTomorrow()}" />
      </div>
      <div class="form-group">
        <label>Event Time</label>
        <input type="time" id="extra-time-${n}" />
      </div>
    </div>
    <div class="form-group" style="margin-top:8px">
      <label>Event Type</label>
      <select id="extra-type-${n}">
        <option value="">Same as main…</option>
        ${eventTypeOptions}
      </select>
    </div>
    <div class="requirements-grid" style="margin-top:10px">
      <div class="req-toggle-row">
        <div class="req-toggle-label"><i class="fas fa-cube" style="color:var(--accent)"></i><span>Hologram</span></div>
        <label class="toggle">
          <input type="checkbox" id="extra-hologram-${n}" onchange="toggleExtraReq('hologram',${n})" />
          <span class="toggle-slider"></span>
          <span class="toggle-text" id="extra-hologram-text-${n}">No</span>
        </label>
      </div>
      <div class="form-group req-amount-row" id="extra-hologram-amt-row-${n}" style="display:none">
        <label>Hologram Amount (₹)</label>
        <input type="number" id="extra-hologram-amount-${n}" placeholder="e.g. 18000" min="0" step="500" />
      </div>
      <div class="req-toggle-row">
        <div class="req-toggle-label"><i class="fas fa-drum" style="color:var(--warning)"></i><span>Dhol Required</span></div>
        <label class="toggle">
          <input type="checkbox" id="extra-dhol-${n}" onchange="toggleExtraReq('dhol',${n})" />
          <span class="toggle-slider"></span>
          <span class="toggle-text" id="extra-dhol-text-${n}">No</span>
        </label>
      </div>
      <div class="form-group req-amount-row" id="extra-dhol-amt-row-${n}" style="display:none">
        <label>Dhol Amount (₹)</label>
        <input type="number" id="extra-dhol-amount-${n}" placeholder="e.g. 6000" min="0" step="500" />
      </div>
      <div class="req-toggle-row">
        <div class="req-toggle-label"><i class="fas fa-star" style="color:var(--info)"></i><span>Ancillary Acts</span></div>
        <label class="toggle">
          <input type="checkbox" id="extra-ancillary-${n}" onchange="toggleExtraReq('ancillary',${n})" />
          <span class="toggle-slider"></span>
          <span class="toggle-text" id="extra-ancillary-text-${n}">No</span>
        </label>
      </div>
      <div id="extra-ancillary-details-${n}" style="display:none">
        <div class="form-grid" style="margin-top:4px">
          <div class="form-group">
            <label>Act Name</label>
            <input type="text" id="extra-ancillary-name-${n}" placeholder="Sufi singer, Comedian…" />
          </div>
          <div class="form-group">
            <label>Ancillary Amount (₹)</label>
            <input type="number" id="extra-ancillary-amount-${n}" placeholder="0" min="0" step="500" />
          </div>
        </div>
      </div>
    </div>`;

  list.appendChild(card);

  // Prefill values
  if (prefill.date)  setValue(`extra-date-${n}`, prefill.date);
  if (prefill.time)  setValue(`extra-time-${n}`, prefill.time);
  if (prefill.hologram) {
    document.getElementById(`extra-hologram-${n}`).checked = true;
    document.getElementById(`extra-hologram-text-${n}`).textContent = 'Yes';
    document.getElementById(`extra-hologram-amt-row-${n}`).style.display = '';
    if (prefill.hologramAmount) setValue(`extra-hologram-amount-${n}`, prefill.hologramAmount);
  }
  if (prefill.dholRequired) {
    document.getElementById(`extra-dhol-${n}`).checked = true;
    document.getElementById(`extra-dhol-text-${n}`).textContent = 'Yes';
    document.getElementById(`extra-dhol-amt-row-${n}`).style.display = '';
    if (prefill.dholAmount) setValue(`extra-dhol-amount-${n}`, prefill.dholAmount);
  }
  if (prefill.ancillaryActs) {
    document.getElementById(`extra-ancillary-${n}`).checked = true;
    document.getElementById(`extra-ancillary-text-${n}`).textContent = 'Yes';
    document.getElementById(`extra-ancillary-details-${n}`).style.display = '';
    if (prefill.ancillaryActName) setValue(`extra-ancillary-name-${n}`, prefill.ancillaryActName);
    if (prefill.ancillaryAmount)  setValue(`extra-ancillary-amount-${n}`, prefill.ancillaryAmount);
  }
}

function toggleExtraReq(type, n) {
  const cb = document.getElementById(`extra-${type}-${n}`);
  document.getElementById(`extra-${type}-text-${n}`).textContent = cb.checked ? 'Yes' : 'No';
  if (type === 'hologram') {
    document.getElementById(`extra-hologram-amt-row-${n}`).style.display = cb.checked ? '' : 'none';
    if (!cb.checked) setValue(`extra-hologram-amount-${n}`, '');
  } else if (type === 'dhol') {
    document.getElementById(`extra-dhol-amt-row-${n}`).style.display = cb.checked ? '' : 'none';
    if (!cb.checked) setValue(`extra-dhol-amount-${n}`, '');
  } else if (type === 'ancillary') {
    document.getElementById(`extra-ancillary-details-${n}`).style.display = cb.checked ? '' : 'none';
  }
}

function removeExtraDate(n) {
  document.getElementById(`extra-date-row-${n}`)?.remove();
}

function getExtraDates() {
  return Array.from({ length: extraDateCount }, (_, i) => {
    const el = document.getElementById(`extra-date-${i + 1}`);
    return el?.value || null;
  }).filter(Boolean);
}

function getExtraDateDetails() {
  return Array.from({ length: extraDateCount }, (_, i) => {
    const n = i + 1;
    const dateEl = document.getElementById(`extra-date-${n}`);
    if (!dateEl?.value) return null;
    return {
      date:             dateEl.value,
      time:             document.getElementById(`extra-time-${n}`)?.value             || null,
      eventType:        document.getElementById(`extra-type-${n}`)?.value             || null,
      hologram:         document.getElementById(`extra-hologram-${n}`)?.checked       || false,
      hologramAmount:   parseFloat(document.getElementById(`extra-hologram-amount-${n}`)?.value) || 0,
      dholRequired:     document.getElementById(`extra-dhol-${n}`)?.checked           || false,
      dholAmount:       parseFloat(document.getElementById(`extra-dhol-amount-${n}`)?.value)     || 0,
      ancillaryActs:    document.getElementById(`extra-ancillary-${n}`)?.checked      || false,
      ancillaryActName: document.getElementById(`extra-ancillary-name-${n}`)?.value   || null,
      ancillaryAmount:  parseFloat(document.getElementById(`extra-ancillary-amount-${n}`)?.value)|| 0,
    };
  }).filter(Boolean);
}

function clearExtraDates() {
  document.getElementById('extra-dates-list').innerHTML = '';
  extraDateCount = 0;
}

/* ─── Open / Close Modal ─────────────────────────────────────────────────── */
function openModal(id = null) {
  editingId = id;

  document.getElementById('modal-title').innerHTML =
    `<i class="fas fa-${id ? 'pen' : 'calendar-plus'}"></i> ${id ? 'Edit' : 'Add'} Booking`;
  document.getElementById('submit-btn-text').textContent = id ? 'Update Booking' : 'Save Booking';

  document.getElementById('booking-form').reset();
  document.getElementById('deposit-toggle-text').textContent   = 'No';
  document.getElementById('hologram-toggle-text').textContent  = 'No';
  document.getElementById('dhol-toggle-text').textContent      = 'No';
  document.getElementById('ancillary-toggle-text').textContent = 'No';
  document.getElementById('hologram-amount-row').style.display = 'none';
  document.getElementById('dhol-amount-row').style.display     = 'none';
  document.getElementById('ancillary-details-row').style.display = 'none';

  clearExtraDates();
  setFutureDateMin();

  if (!id) {
    document.getElementById('f-totalPrice').value = '425000';
    updateGSTCalc();
  }

  if (id) {
    const b = allBookings.find(x => x.id === id);
    if (b) populateForm(b);
  }

  openModalEl('booking-modal');
}

function populateForm(b) {
  setValue('f-hostName',        b.hostName        || b.clientName || '');
  setValue('f-clientName',      b.clientName      || '');
  setValue('f-countryCode',     b.countryCode     || '+91');
  setValue('f-phone',           b.phone           || '');
  setValue('f-eventDate',       b.eventDate       || '');
  setValue('f-eventDateTo',     b.eventDateTo     || '');
  setValue('f-eventTime',       b.eventTime       || '');
  setValue('f-venue',           b.venue           || '');
  setValue('f-eventType',       b.eventType       || '');
  setValue('f-totalPrice',      b.totalPrice      || '');
  setValue('f-depositAmount',   b.depositAmount   || '');
  setValue('f-bookingStatus',   b.bookingStatus   || 'Enquiry');
  setValue('f-paymentMode',     b.paymentMode     || '');
  setValue('f-maddy',           b.maddy           || 0);
  setValue('f-amnish',          b.amnish          || 0);
  setValue('f-rajat',           b.rajat           || 0);
  setValue('f-hardik',          b.hardik          || 0);
  setValue('f-ancillaryActName', b.ancillaryActName || '');
  setValue('f-ancillaryAmount',  b.ancillaryAmount  || '');
  setValue('f-hologramAmount',   b.hologramAmount   || '');
  setValue('f-dholAmount',       b.dholAmount       || '');
  setValue('f-remarks',          b.remarks          || '');

  setToggle('f-depositPaid',   b.depositPaid,    'deposit-toggle-text');
  setToggle('f-hologram',      b.hologram,       'hologram-toggle-text');
  setToggle('f-dholRequired',  b.dholRequired,   'dhol-toggle-text');
  setToggle('f-ancillaryActs', b.ancillaryActs,  'ancillary-toggle-text');

  document.getElementById('hologram-amount-row').style.display   = b.hologram      ? '' : 'none';
  document.getElementById('dhol-amount-row').style.display       = b.dholRequired  ? '' : 'none';
  document.getElementById('ancillary-details-row').style.display = b.ancillaryActs ? '' : 'none';

  // Restore additional dates with full detail cards
  if (Array.isArray(b.additionalDateDetails) && b.additionalDateDetails.length) {
    b.additionalDateDetails.forEach(d => addExtraDate(d));
  } else if (Array.isArray(b.additionalDates) && b.additionalDates.length) {
    b.additionalDates.forEach(date => addExtraDate({ date }));
  }

  updateGSTCalc();
}

/* ─── Form Submit ────────────────────────────────────────────────────────── */
async function handleFormSubmit(e) {
  e.preventDefault();

  const eventDate = document.getElementById('f-eventDate').value;
  if (!editingId && eventDate && eventDate < getToday()) {
    showToast('Event date must be today or a future date.', 'error');
    return;
  }

  const extraDates = getExtraDates();
  // Client-side double-booking check (Confirmed status only)
  const bookingStatus = document.getElementById('f-bookingStatus').value;
  if (bookingStatus === 'Confirmed') {
    const datesToCheck = [eventDate, document.getElementById('f-eventDateTo').value, ...extraDates].filter(Boolean);
    for (const d of datesToCheck) {
      const conflict = allBookings.find(b =>
        b.id !== editingId &&
        b.bookingStatus === 'Confirmed' &&
        (b.eventDate === d ||
         (b.eventDate && b.eventDateTo && d >= b.eventDate && d <= b.eventDateTo) ||
         (Array.isArray(b.additionalDates) && b.additionalDates.includes(d)))
      );
      if (conflict) {
        showToast(`Double booking on ${d}! "${conflict.hostName || conflict.clientName}" is already confirmed.`, 'error');
        return;
      }
    }
  }

  const payload = {
    hostName:          document.getElementById('f-hostName').value.trim(),
    clientName:        document.getElementById('f-clientName').value.trim(),
    countryCode:       document.getElementById('f-countryCode').value,
    phone:             document.getElementById('f-phone').value.trim(),
    eventDate,
    eventDateTo:       document.getElementById('f-eventDateTo').value       || null,
    additionalDates:       extraDates,
    additionalDateDetails: getExtraDateDetails(),
    eventTime:         document.getElementById('f-eventTime').value         || null,
    venue:             document.getElementById('f-venue').value.trim(),
    eventType:         document.getElementById('f-eventType').value,
    hologram:          document.getElementById('f-hologram').checked,
    hologramAmount:    document.getElementById('f-hologram').checked
                         ? (parseFloat(document.getElementById('f-hologramAmount').value) || 0) : 0,
    dholRequired:      document.getElementById('f-dholRequired').checked,
    dholAmount:        document.getElementById('f-dholRequired').checked
                         ? (parseFloat(document.getElementById('f-dholAmount').value) || 0) : 0,
    ancillaryActs:     document.getElementById('f-ancillaryActs').checked,
    ancillaryActName:  document.getElementById('f-ancillaryActName').value.trim() || null,
    ancillaryAmount:   document.getElementById('f-ancillaryActs').checked
                         ? (parseFloat(document.getElementById('f-ancillaryAmount').value) || 0) : 0,
    maddy:             parseInt(document.getElementById('f-maddy').value)    || 0,
    amnish:            parseInt(document.getElementById('f-amnish').value)   || 0,
    rajat:             parseInt(document.getElementById('f-rajat').value)    || 0,
    hardik:            parseInt(document.getElementById('f-hardik').value)   || 0,
    remarks:           document.getElementById('f-remarks').value.trim()    || null,
    totalPrice:        parseFloat(document.getElementById('f-totalPrice').value)    || 0,
    depositAmount:     parseFloat(document.getElementById('f-depositAmount').value) || 0,
    depositPaid:       document.getElementById('f-depositPaid').checked,
    paymentMode:       document.getElementById('f-paymentMode').value       || null,
    bookingStatus,
  };

  if (!payload.hostName || !payload.clientName || !payload.eventDate || !payload.venue) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  try {
    if (editingId) {
      await api('PUT', `/api/bookings/${editingId}`, payload);
      showToast('Booking updated!', 'success');
    } else {
      await api('POST', '/api/bookings', payload);
      showToast('Booking added!', 'success');
    }
    closeModal('booking-modal');
    await loadBookings();
    await loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ─── Delete ─────────────────────────────────────────────────────────────── */
function confirmDelete(id, clientName) {
  document.getElementById('delete-client-name').textContent = clientName;
  document.getElementById('confirm-delete-btn').onclick = () => doDelete(id);
  openModalEl('delete-modal');
}

async function doDelete(id) {
  try {
    await api('DELETE', `/api/bookings/${id}`);
    showToast('Booking deleted.', 'success');
    closeModal('delete-modal');
    await loadBookings();
    await loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ─── Payment Link Modal ─────────────────────────────────────────────────── */
function openPaymentModal(id) {
  paymentBookingId = id;
  generatedPayLink = null;
  const b = allBookings.find(x => x.id === id);
  if (!b) return;

  // Reset record-payment section
  document.getElementById('record-payment-amount').value = '';
  document.getElementById('record-payment-mode').value   = '';
  updateRecordBalance();

  document.getElementById('payment-client-info').innerHTML =
    `<strong>${esc(b.hostName || b.clientName)}</strong> — ${esc(b.eventType)} at ${esc(b.venue)}<br>
     <span style="color:var(--text-3);font-size:0.8rem">${formatDate(b.eventDate)}${b.eventTime ? ' · ' + b.eventTime : ''}</span>`;

  document.getElementById('ptc-deposit-amt').textContent = formatCurrency(b.depositAmount);
  document.getElementById('ptc-full-amt').textContent    = formatCurrency(b.totalPrice);

  document.getElementById('link-result').style.display = 'none';
  document.querySelector('input[name="paymentType"][value="deposit"]').checked = true;

  const btn = document.getElementById('generate-link-btn');
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-bolt"></i> Generate Payment Link';

  const prevSection = document.getElementById('prev-links-section');
  const prevList    = document.getElementById('prev-links-list');
  if (b.paymentLinks && b.paymentLinks.length) {
    prevList.innerHTML = b.paymentLinks.slice(0, 3).map(pl => `
      <div class="prev-link-item">
        <div><span style="font-weight:600;color:var(--text)">${formatCurrency(pl.amount)}</span>
          <span style="color:var(--text-3);margin-left:6px">(${pl.type})</span><br>
          <a href="${pl.url}" target="_blank">${pl.url}</a></div>
        <div>
          <span class="prev-link-meta">${formatRelativeDate(pl.createdAt)}</span>
          <button class="btn btn-icon" style="margin-left:6px" onclick="copyText('${pl.url}')"><i class="fas fa-copy"></i></button>
        </div>
      </div>`).join('');
    prevSection.style.display = 'block';
  } else {
    prevSection.style.display = 'none';
  }
  openModalEl('payment-modal');
}

async function generatePaymentLink() {
  const btn         = document.getElementById('generate-link-btn');
  const paymentType = document.querySelector('input[name="paymentType"]:checked').value;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating…';
  try {
    const result = await api('POST', `/api/bookings/${paymentBookingId}/payment-link`, { paymentType });
    generatedPayLink = result.url;
    document.getElementById('link-url').value = result.url;
    document.getElementById('link-open').href = result.url;
    document.getElementById('link-result').style.display = 'block';
    showToast('Payment link generated!', 'success');
    await loadBookings();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-bolt"></i> Generate Another Link';
  }
}

function copyLink() { copyText(document.getElementById('link-url').value); }
function openWhatsAppFromPayment() {
  closeModal('payment-modal');
  openWhatsAppModal(paymentBookingId, generatedPayLink);
}

/* ─── WhatsApp Modal ─────────────────────────────────────────────────────── */
function openWhatsAppModal(id, prefillLink = null) {
  whatsappBookingId = id;
  const b = allBookings.find(x => x.id === id);
  if (!b) return;

  document.getElementById('wa-recipient').innerHTML =
    `<i class="fab fa-whatsapp"></i>
     <div><strong>${esc(b.hostName || b.clientName)}</strong><br>
     <span style="color:var(--text-3);font-size:0.8rem">${esc(buildFullPhone(b))}</span></div>`;

  const linkInput = document.getElementById('wa-payment-link');
  linkInput.value = prefillLink || (b.paymentLinks && b.paymentLinks[0]?.url) || '';

  renderWhatsAppPreview(b, linkInput.value);
  linkInput.oninput = () => renderWhatsAppPreview(b, linkInput.value);

  const sendBtn = document.getElementById('wa-send-btn');
  sendBtn.disabled = false;
  sendBtn.innerHTML = '<i class="fab fa-whatsapp"></i> Send Message';

  openModalEl('whatsapp-modal');
}

function renderWhatsAppPreview(b, payLink) {
  const eventDate = new Date(b.eventDate + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const gst   = effectiveBase(b) * GST_RATE;
  const total = effectiveBase(b) + gst;
  const depositStatus  = b.depositPaid ? '✅ Paid' : '⏳ Pending';
  const paymentSection = payLink ? `\n💰 Payment Link: ${payLink}` : '';

  const msg =
    `Hi ${b.hostName || b.clientName}! 🎶\n\n` +
    `Friendly reminder for your upcoming event:\n\n` +
    `📅 Date: ${eventDate}\n` +
    `⏰ Time: ${b.eventTime || 'TBD'}\n` +
    `📍 Venue: ${b.venue}\n` +
    `🎉 Event: ${b.eventType}\n\n` +
    `💳 Payment Summary:\n` +
    `• Base: ₹${Math.round(effectiveBase(b)).toLocaleString('en-IN')}\n` +
    `• GST (18%): ₹${Math.round(gst).toLocaleString('en-IN')}\n` +
    `• Total: ₹${total.toLocaleString('en-IN')}\n` +
    `• Deposit: ₹${(b.depositAmount || 0).toLocaleString('en-IN')} – ${depositStatus}` +
    paymentSection +
    `\n\nLooking forward to making your event unforgettable! 🎧✨`;

  document.getElementById('wa-preview').textContent = msg;
}

async function sendWhatsApp() {
  const paymentLink = document.getElementById('wa-payment-link').value.trim();
  const btn = document.getElementById('wa-send-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';
  try {
    await api('POST', `/api/bookings/${whatsappBookingId}/whatsapp`, { paymentLink: paymentLink || null });
    showToast('WhatsApp reminder sent!', 'success');
    closeModal('whatsapp-modal');
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fab fa-whatsapp"></i> Send Message';
  }
}

/* ─── Effective base price (includes addon amounts) ─────────────────────── */
function effectiveBase(b) {
  return (Number(b.totalPrice)      || 0) +
         (Number(b.hologramAmount)  || 0) +
         (Number(b.dholAmount)      || 0) +
         (Number(b.ancillaryAmount) || 0);
}

/* ─── Deposit Badge helper ───────────────────────────────────────────────── */
function depositBadge(b) {
  const totalWithGST = effectiveBase(b) * (1 + GST_RATE);
  const dep          = b.depositAmount || 0;
  const remaining    = Math.max(0, totalWithGST - dep);

  if (b.depositPaid && remaining <= 0) {
    return `<span class="deposit-badge paid"><i class="fas fa-check"></i> Paid</span>`;
  }
  if (b.depositPaid && dep > 0 && remaining > 0) {
    return `<span class="deposit-badge partial"><i class="fas fa-adjust"></i> Partial</span>`;
  }
  return `<span class="deposit-badge unpaid"><i class="fas fa-clock"></i> Pending</span>`;
}

/* ─── Calendar ───────────────────────────────────────────────────────────── */
function getBookedDates() {
  const booked = new Set();
  allBookings.filter(b => b.bookingStatus === 'Confirmed').forEach(b => {
    if (b.eventDate) booked.add(b.eventDate);
    // Fill date range
    if (b.eventDate && b.eventDateTo && b.eventDateTo > b.eventDate) {
      const cur = new Date(b.eventDate + 'T00:00:00');
      const end = new Date(b.eventDateTo + 'T00:00:00');
      while (cur <= end) {
        booked.add(cur.toISOString().split('T')[0]);
        cur.setDate(cur.getDate() + 1);
      }
    }
    if (Array.isArray(b.additionalDates)) {
      b.additionalDates.forEach(d => { if (d) booked.add(d); });
    }
  });
  return booked;
}

function isWeekendDay(dateObj) {
  const d = dateObj.getDay(); // 0=Sun,5=Fri,6=Sat
  return d === 0 || d === 5 || d === 6;
}

function renderCalendar() {
  const bookedDates = getBookedDates();
  const today       = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr    = today.toISOString().split('T')[0];

  const MONTHS      = 24;
  const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  // 0=Sun is weekend, 5=Fri, 6=Sat
  const WKND_IDX    = new Set([0, 5, 6]);

  let summaryHtml = '<div class="cal-summary">';
  let gridHtml    = '<div class="cal-grid">';

  for (let m = 0; m < MONTHS; m++) {
    const yr    = today.getFullYear();
    const mo    = today.getMonth() + m;
    const first = new Date(yr, mo, 1);
    const year  = first.getFullYear();
    const month = first.getMonth();
    const daysInMonth  = new Date(year, month + 1, 0).getDate();
    const firstDOW     = first.getDay(); // day of week for 1st (0=Sun)
    const monthLabel   = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    // Count free/booked upcoming weekend days
    let freeWknds = 0, bookedWknds = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, month, day);
      if (dateObj < today) continue;
      if (!isWeekendDay(dateObj)) continue;
      const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      if (bookedDates.has(ds)) bookedWknds++;
      else freeWknds++;
    }

    // ── Summary card ──
    summaryHtml += `
      <div class="cal-month-summary">
        <div class="cal-sum-month">${monthLabel}</div>
        <div class="cal-sum-stats">
          ${freeWknds   ? `<span class="cal-sum-free"><i class="fas fa-check-circle"></i> ${freeWknds} free weekend day${freeWknds !== 1 ? 's' : ''}</span>` : ''}
          ${bookedWknds ? `<span class="cal-sum-booked"><i class="fas fa-times-circle"></i> ${bookedWknds} booked</span>` : ''}
          ${!freeWknds && !bookedWknds ? `<span class="cal-sum-none">Past month</span>` : ''}
        </div>
      </div>`;

    // ── Day-name header ──
    const dayNamesHtml = DAY_NAMES.map((n, i) =>
      `<div class="cal-day-name${WKND_IDX.has(i) ? ' weekend' : ''}">${n}</div>`
    ).join('');

    // ── Day cells ──
    let daysHtml = '';
    // Filler empties before day 1
    for (let i = 0; i < firstDOW; i++) daysHtml += '<div class="cal-day empty"></div>';

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj  = new Date(year, month, day);
      const ds       = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const isPast   = dateObj < today;
      const isToday  = ds === todayStr;
      const isBooked = bookedDates.has(ds);
      const isWknd   = isWeekendDay(dateObj);

      let cls = 'cal-day';
      if (isPast)   cls += ' past';
      if (isWknd)   cls += ' weekend';
      if (isToday)  cls += ' today';
      if (isBooked) {
        cls += ' booked';
      } else if (isWknd && !isPast) {
        cls += ' free';
      }

      // Tooltip for booked days
      let tip = '';
      if (isBooked) {
        const bk = allBookings.find(b =>
          b.bookingStatus === 'Confirmed' && (
            b.eventDate === ds ||
            (b.eventDate && b.eventDateTo && ds >= b.eventDate && ds <= b.eventDateTo) ||
            (Array.isArray(b.additionalDates) && b.additionalDates.includes(ds))
          )
        );
        if (bk) tip = ` title="${esc(bk.hostName || bk.clientName)} — ${esc(bk.eventType)}"`;
      }

      daysHtml += `<div class="${cls}"${tip}>${day}</div>`;
    }

    // ── Assemble month card ──
    gridHtml += `
      <div class="cal-month">
        <div class="cal-month-header">
          <span class="cal-month-name">${monthLabel}</span>
          <div class="cal-month-badges">
            ${freeWknds   ? `<span class="cal-badge free">${freeWknds} free</span>` : ''}
            ${bookedWknds ? `<span class="cal-badge booked">${bookedWknds} booked</span>` : ''}
          </div>
        </div>
        <div class="cal-days-header">${dayNamesHtml}</div>
        <div class="cal-days-grid">${daysHtml}</div>
      </div>`;
  }

  summaryHtml += '</div>';
  gridHtml    += '</div>';

  document.getElementById('cal-container').innerHTML = summaryHtml + gridHtml;
}

/* ─── Rate Calculator ────────────────────────────────────────────────────── */
function updateCalc() {
  const base      = parseFloat(document.getElementById('calc-base').value)        || 0;
  const holo      = parseFloat(document.getElementById('calc-hologram').value)    || 0;
  const dhol      = parseFloat(document.getElementById('calc-dhol').value)        || 0;
  const ancillary = parseFloat(document.getElementById('calc-ancillary').value)   || 0;
  const travel    = parseFloat(document.getElementById('calc-travel').value)      || 0;
  const depPct    = parseFloat(document.getElementById('calc-deposit-pct').value) || 30;

  const maddy_n   = parseInt(document.getElementById('calc-maddy').value)  || 0;
  const amnish_n  = parseInt(document.getElementById('calc-amnish').value) || 0;
  const rajat_n   = parseInt(document.getElementById('calc-rajat').value)  || 0;
  const hardik_n  = parseInt(document.getElementById('calc-hardik').value) || 0;

  const addons   = holo + dhol + ancillary + travel;
  const subtotal = base + addons;
  const gst      = subtotal * GST_RATE;
  const total    = subtotal + gst;
  const deposit  = total * (depPct / 100);
  const balance  = total - deposit;

  // Artist cost (purchase prices)
  const artistCost =
    maddy_n  * CREW_PRICING.maddy.buy  +
    amnish_n * CREW_PRICING.amnish.buy +
    rajat_n  * CREW_PRICING.rajat.buy  +
    hardik_n * CREW_PRICING.hardik.buy;

  const grossProfit = total - artistCost;
  const margin      = total > 0 ? ((grossProfit / total) * 100).toFixed(1) : 0;

  document.getElementById('cr-base').textContent        = formatCurrency(base);
  document.getElementById('cr-addons').textContent      = formatCurrency(addons);
  document.getElementById('cr-gst').textContent         = formatCurrency(gst);
  document.getElementById('cr-total').textContent       = formatCurrency(total);
  document.getElementById('cr-deposit').textContent     = formatCurrency(deposit);
  document.getElementById('cr-balance').textContent     = formatCurrency(balance);
  document.getElementById('cr-profit-revenue').textContent = formatCurrency(total);
  document.getElementById('cr-artist-cost').textContent = formatCurrency(artistCost);
  document.getElementById('cr-gross-profit').textContent = formatCurrency(grossProfit);
  document.getElementById('cr-margin').textContent      = `${margin}%`;
}

function resetCalc() {
  ['calc-base','calc-hologram','calc-dhol','calc-ancillary','calc-travel'].forEach(id => {
    document.getElementById(id).value = '';
  });
  ['calc-maddy','calc-amnish','calc-rajat','calc-hardik'].forEach(id => {
    document.getElementById(id).value = '0';
  });
  document.getElementById('calc-deposit-pct').value = '30';
  updateCalc();
}

/* ─── Record Payment ─────────────────────────────────────────────────────── */
function updateRecordBalance() {
  const b = allBookings.find(x => x.id === paymentBookingId);
  if (!b) return;
  const totalWithGST = effectiveBase(b) * (1 + GST_RATE);
  const alreadyPaid  = Number(b.depositAmount) || 0;
  const adding       = parseFloat(document.getElementById('record-payment-amount').value) || 0;
  const newBalance   = Math.max(0, totalWithGST - alreadyPaid - adding);

  document.getElementById('rb-total').textContent   = formatCurrency(totalWithGST);
  document.getElementById('rb-paid').textContent    = formatCurrency(alreadyPaid + adding);
  document.getElementById('rb-balance').textContent = formatCurrency(newBalance);
}

async function recordPayment() {
  const amount = parseFloat(document.getElementById('record-payment-amount').value);
  const mode   = document.getElementById('record-payment-mode').value;
  if (!amount || amount <= 0) {
    showToast('Enter a valid payment amount.', 'error');
    return;
  }
  const btn = document.getElementById('record-payment-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
  try {
    await api('PATCH', `/api/bookings/${paymentBookingId}/record-payment`, {
      additionalPayment: amount,
      paymentMode: mode || undefined,
    });
    showToast('Payment recorded!', 'success');
    document.getElementById('record-payment-amount').value = '';
    document.getElementById('record-payment-mode').value   = '';
    await loadBookings();
    await loadDashboard();
    // Refresh balance display
    updateRecordBalance();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check"></i> Save Payment';
  }
}

/* ─── Toggle wiring ──────────────────────────────────────────────────────── */
function wireToggles() {
  document.getElementById('f-depositPaid').addEventListener('change', function () {
    document.getElementById('deposit-toggle-text').textContent = this.checked ? 'Yes' : 'No';
  });
  document.getElementById('f-hologram').addEventListener('change', function () {
    document.getElementById('hologram-toggle-text').textContent = this.checked ? 'Yes' : 'No';
    document.getElementById('hologram-amount-row').style.display = this.checked ? '' : 'none';
    if (!this.checked) document.getElementById('f-hologramAmount').value = '';
    updateGSTCalc();
  });
  document.getElementById('f-dholRequired').addEventListener('change', function () {
    document.getElementById('dhol-toggle-text').textContent = this.checked ? 'Yes' : 'No';
    document.getElementById('dhol-amount-row').style.display = this.checked ? '' : 'none';
    if (!this.checked) document.getElementById('f-dholAmount').value = '';
    updateGSTCalc();
  });
  document.getElementById('f-ancillaryActs').addEventListener('change', function () {
    document.getElementById('ancillary-toggle-text').textContent = this.checked ? 'Yes' : 'No';
    document.getElementById('ancillary-details-row').style.display = this.checked ? '' : 'none';
    if (!this.checked) {
      document.getElementById('f-ancillaryActName').value = '';
      document.getElementById('f-ancillaryAmount').value  = '';
    }
    updateGSTCalc();
  });
}

/* ─── Modal helpers ──────────────────────────────────────────────────────── */
function openModalEl(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
}
function handleOverlayClick(e, id) { if (e.target.id === id) closeModal(id); }

/* ─── Utilities ──────────────────────────────────────────────────────────── */
function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function setToggle(id, checked, textId) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = !!checked;
  const textEl = document.getElementById(textId);
  if (textEl) textEl.textContent = el.checked ? 'Yes' : 'No';
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '—';
  return '₹' + Math.round(Number(amount)).toLocaleString('en-IN');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatRelativeDate(isoStr) {
  const d    = new Date(isoStr);
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied!', 'info');
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('Copied!', 'info');
  }
}

let toastTimer;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className   = `toast ${type} show`;
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

/* ═══════════════════════════════════════════════════════════════════════════
   LOYALTY VIEW — Vendor list, reversal queue, manual show, FY report, audit
═══════════════════════════════════════════════════════════════════════════ */

let LOY_VENDORS = [];
let LOY_OVERRIDE_VENDOR_ID = null;

function loyEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function loyShowTab(name) {
  document.querySelectorAll('.loy-tab').forEach(t => t.classList.toggle('active', t.dataset.loyTab === name));
  document.querySelectorAll('.loy-panel').forEach(p => p.style.display = (p.id === 'loy-panel-' + name) ? '' : 'none');
  if (name === 'vendors')   loyLoadVendors();
  if (name === 'reversals') loyLoadReversals();
  if (name === 'manual')    loyLoadVendorOptions();
  if (name === 'report')    loyLoadReport();
  if (name === 'audit')     loyLoadAudit();
}

async function renderLoyaltyView() {
  loyShowTab('vendors');
  // Preload reversal queue silently so the count badge appears on the Reversal tab
  setTimeout(() => { loyLoadReversals().catch(() => {}); }, 200);
}

function loyTierIcon(tier) {
  if (tier === 'Platinum') return 'crown';
  if (tier === 'Gold' || tier === 'Silver') return 'medal';
  return 'circle';
}
function loyInitials(name) {
  return (name || '?').split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}
function loyTierBadge(tier) {
  if (!tier) return `<span class="badge badge-tier-none">—</span>`;
  return `<span class="badge badge-tier-${tier}"><i class="fas fa-${loyTierIcon(tier)}"></i> ${tier}</span>`;
}

async function loyLoadVendors() {
  const tbody = document.getElementById('loy-vendors-body');
  tbody.innerHTML = `<tr><td colspan="6" class="loy-empty"><i class="fas fa-circle-notch fa-spin"></i> Loading…</td></tr>`;
  try {
    const rows = await api('GET', '/api/admin/loyalty/vendors');
    LOY_VENDORS = rows;
    document.getElementById('loy-vendor-count').textContent = `(${rows.length})`;
    if (rows.length) {
      document.getElementById('loyalty-fy-badge').innerHTML = `<i class="fas fa-calendar"></i> FY ${rows[0].fiscalYear}`;
    }
    // Populate tier summary pills
    const counts = { Silver: 0, Gold: 0, Platinum: 0 };
    rows.forEach(r => { if (counts[r.currentTier] !== undefined) counts[r.currentTier]++; });
    document.getElementById('lts-silver').textContent   = counts.Silver;
    document.getElementById('lts-gold').textContent     = counts.Gold;
    document.getElementById('lts-platinum').textContent = counts.Platinum;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="loy-empty">No vendors yet. They sign up at <code>/vendor-login</code>.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(v => `
      <tr>
        <td>
          <div class="loy-vendor-cell">
            <div class="loy-vendor-avatar">${loyInitials(v.name)}</div>
            <div>
              <div class="loy-vendor-name">${loyEsc(v.name)}${v.manualTierOverride ? ' <i class="fas fa-shield-halved loy-override-flag" title="Manual tier override"></i>' : ''}</div>
              <div class="loy-vendor-meta">${loyEsc(v.companyName || v.email)}</div>
            </div>
          </div>
        </td>
        <td>${loyTierBadge(v.currentTier)}</td>
        <td><span class="loy-discount-pct">${v.discountPercent}%</span></td>
        <td>
          <div class="loy-money">${formatCurrency(v.ytdSales)}</div>
          <div class="loy-money-2">YTD ${v.fiscalYear}</div>
        </td>
        <td><div class="loy-money">${v.ytdShowCount}</div></td>
        <td class="text-right">
          <div class="loy-actions">
            <button class="btn btn-ghost loy-btn-mini" onclick='loyOpenOverride(${JSON.stringify(v).replace(/'/g, "&#39;")})'><i class="fas fa-shield-halved"></i> Override</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load vendors: ' + err.message, 'error');
  }
}

async function loyLoadReversals() {
  const tbody = document.getElementById('loy-reversals-body');
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px"><i class="fas fa-circle-notch fa-spin"></i> Loading…</td></tr>`;
  try {
    const [bookings, vendors] = await Promise.all([
      api('GET', '/api/bookings'),
      LOY_VENDORS.length ? Promise.resolve(LOY_VENDORS) : api('GET', '/api/admin/loyalty/vendors'),
    ]);
    if (!LOY_VENDORS.length) LOY_VENDORS = vendors;
    const byVendor = Object.fromEntries(vendors.map(v => [v.id, v]));
    const queue = bookings.filter(b => b.reversalStatus === 'Eligible' || b.reversalStatus === 'Approved');
    // Update pending count on the tab
    const pending = queue.filter(b => b.reversalStatus === 'Eligible').length;
    const countEl = document.getElementById('loy-rev-count');
    if (countEl) countEl.textContent = pending > 0 ? pending : '';

    if (!queue.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="loy-empty"><i class="fas fa-check-circle" style="color:#86efac;font-size:24px;display:block;margin-bottom:8px"></i>All caught up — no reversals pending.</td></tr>`;
      return;
    }
    tbody.innerHTML = queue.map(b => {
      const vendor = byVendor[b.vendorId] || {};
      return `
      <tr>
        <td>
          <div class="loy-vendor-cell">
            <div class="loy-vendor-avatar">${loyInitials(vendor.name)}</div>
            <div>
              <div class="loy-vendor-name">${loyEsc(vendor.name || '—')}</div>
              <div class="loy-vendor-meta">${loyTierBadge(vendor.currentTier)}</div>
            </div>
          </div>
        </td>
        <td>${loyEsc(b.eventType || '—')}<div class="loy-row-sub">${loyEsc(b.venue || '')}</div></td>
        <td><div class="loy-money">${b.eventDate}</div></td>
        <td><div class="loy-money">${formatCurrency(b.fullPrice || b.totalPrice)}</div></td>
        <td><div class="loy-money" style="color:#86efac">${formatCurrency(b.discountAmount)}</div><div class="loy-row-sub">${b.discountPercent}% reversal</div></td>
        <td><span class="badge badge-rev-${b.reversalStatus}">${b.reversalStatus}</span></td>
        <td class="text-right">
          ${b.reversalStatus === 'Eligible'
            ? `<button class="btn btn-primary loy-btn-mini" onclick="loyApproveReversal('${b.id}')"><i class="fas fa-check"></i> Approve</button>`
            : `<span class="loy-row-sub">Approved ${b.reversalDate ? new Date(b.reversalDate).toLocaleDateString() : ''}</span>`}
        </td>
      </tr>
    `;}).join('');
  } catch (err) {
    showToast('Failed to load reversals: ' + err.message, 'error');
  }
}

async function loyApproveReversal(id) {
  if (!confirm('Approve discount reversal for this booking?')) return;
  try {
    await api('PATCH', `/api/admin/loyalty/booking/${id}/approve-reversal`);
    showToast('Reversal approved.', 'success');
    loyLoadReversals();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loyLoadVendorOptions() {
  if (!LOY_VENDORS.length) {
    LOY_VENDORS = await api('GET', '/api/admin/loyalty/vendors');
  }
  const sel = document.getElementById('loy-ms-vendor');
  sel.innerHTML = '<option value="">— Select vendor —</option>' +
    LOY_VENDORS.map(v => `<option value="${v.id}">${loyEsc(v.name)} (${loyEsc(v.email)})</option>`).join('');
}

async function loySubmitManualShow(e) {
  e.preventDefault();
  const payload = {
    vendorId:      document.getElementById('loy-ms-vendor').value,
    showName:      document.getElementById('loy-ms-showName').value.trim(),
    showDate:      document.getElementById('loy-ms-date').value,
    amount:        Number(document.getElementById('loy-ms-amount').value) || 0,
    venue:         document.getElementById('loy-ms-venue').value.trim(),
    depositAmount: Number(document.getElementById('loy-ms-deposit').value) || 0,
    isAjsShow:     document.getElementById('loy-ms-isAjs').value === 'true',
    reason:        document.getElementById('loy-ms-reason').value.trim(),
    remarks:       document.getElementById('loy-ms-remarks').value.trim(),
  };
  try {
    await api('POST', '/api/admin/loyalty/manual-show', payload);
    showToast('Manual show added.', 'success');
    e.target.reset();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loyLoadReport() {
  const fy = document.getElementById('loy-report-fy').value.trim();
  const url = fy ? `/api/admin/loyalty/report?fy=${encodeURIComponent(fy)}` : '/api/admin/loyalty/report';
  try {
    const data = await api('GET', url);
    const grid = document.getElementById('loy-report-grid');
    const counts = data.tierCounts || {};
    grid.innerHTML = `
      <div class="stat-card"><div class="stat-icon"><i class="fas fa-calendar"></i></div><div class="stat-body"><div class="stat-value">${data.fiscalYear}</div><div class="stat-label">Fiscal Year</div></div></div>
      <div class="stat-card success"><div class="stat-icon"><i class="fas fa-rupee-sign"></i></div><div class="stat-body"><div class="stat-value">${formatCurrency(data.totalSales)}</div><div class="stat-label">Total AJ Sales</div></div></div>
      <div class="stat-card accent"><div class="stat-icon"><i class="fas fa-headphones-alt"></i></div><div class="stat-body"><div class="stat-value">${data.totalShows}</div><div class="stat-label">Total AJ Shows</div></div></div>
      <div class="stat-card warning"><div class="stat-icon"><i class="fas fa-medal"></i></div><div class="stat-body"><div class="stat-value" style="font-size:0.95rem;line-height:1.6;font-weight:500">
        <div>Silver: <strong>${counts.Silver || 0}</strong></div>
        <div>Gold: <strong>${counts.Gold || 0}</strong></div>
        <div>Platinum: <strong>${counts.Platinum || 0}</strong></div>
      </div><div class="stat-label">Tier Distribution</div></div></div>
    `;
    const tbody = document.getElementById('loy-report-body');
    if (!data.vendors.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="loy-empty">No vendors.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.vendors.map(v => `
      <tr>
        <td>
          <div class="loy-vendor-cell">
            <div class="loy-vendor-avatar">${loyInitials(v.name)}</div>
            <div>
              <div class="loy-vendor-name">${loyEsc(v.name)}</div>
              <div class="loy-vendor-meta">${loyEsc(v.companyName || '')}</div>
            </div>
          </div>
        </td>
        <td>${loyTierBadge(v.currentTier === 'None' ? null : v.currentTier)}</td>
        <td><div class="loy-money">${formatCurrency(v.ytdSales)}</div></td>
        <td><div class="loy-money">${v.ytdShowCount}</div></td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load report: ' + err.message, 'error');
  }
}

async function loyLoadAudit() {
  try {
    const rows = await api('GET', '/api/admin/loyalty/audit');
    const vendors = LOY_VENDORS.length ? LOY_VENDORS : await api('GET', '/api/admin/loyalty/vendors');
    const byId = Object.fromEntries(vendors.map(v => [v.id, v.name]));
    const tbody = document.getElementById('loy-audit-body');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="loy-empty">No tier overrides yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>
          <div class="loy-money">${new Date(r.at).toLocaleDateString()}</div>
          <div class="loy-row-sub">${new Date(r.at).toLocaleTimeString()}</div>
        </td>
        <td>${loyEsc(byId[r.vendorId] || r.vendorId)}</td>
        <td>${loyTierBadge(r.fromTier)} <i class="fas fa-arrow-right" style="color:var(--text-3);margin:0 6px"></i> ${loyTierBadge(r.toTier)}</td>
        <td>${loyEsc(r.reason || '—')}</td>
        <td>${loyEsc(r.byName || r.by || '—')}</td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load audit: ' + err.message, 'error');
  }
}

function loyOpenOverride(v) {
  LOY_OVERRIDE_VENDOR_ID = v.id;
  document.getElementById('loy-ov-vendorName').value = v.name;
  document.getElementById('loy-ov-tier').value = (v.manualTierOverride && v.manualTierOverride.tier) || '';
  document.getElementById('loy-ov-reason').value = '';
  openModalEl('loyalty-override-modal');
}

async function loySubmitOverride() {
  const tier   = document.getElementById('loy-ov-tier').value;
  const reason = document.getElementById('loy-ov-reason').value.trim();
  if (!reason) return showToast('Reason is required for the audit log.', 'error');
  try {
    await api('POST', `/api/admin/loyalty/vendor/${LOY_OVERRIDE_VENDOR_ID}/override-tier`, { tier: tier || null, reason });
    showToast('Tier override saved.', 'success');
    closeModal('loyalty-override-modal');
    loyLoadVendors();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
