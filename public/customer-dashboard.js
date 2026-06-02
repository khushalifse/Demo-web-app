'use strict';

const fmtINR = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let FORCE_PWD_CHANGE = false;
// When the admin opens this page via /admin-vendor-view?id=XYZ we switch to
// a read-only preview of the named vendor's dashboard. The vendor login flow
// (customer-auth/me + change-password modal) is skipped entirely.
const ADMIN_PREVIEW_VENDOR_ID = (() => {
  if (location.pathname !== '/admin-vendor-view') return null;
  const q = new URLSearchParams(location.search);
  return q.get('id') || null;
})();

async function init() {
  if (ADMIN_PREVIEW_VENDOR_ID) return initAdminPreview();
  try {
    const me = await fetch('/api/customer-auth/me', { credentials: 'same-origin' }).then(r => r.json());
    if (!me.loggedIn) { location.href = '/vendor-login'; return; }
    const ownerName = (me.customer.name || '').trim();
    const company   = (me.customer.companyName || '').trim();
    document.getElementById('customerName').textContent = company || ownerName || 'Vendor';
    const greet = document.getElementById('greetName');
    greet.textContent = company
      ? `${company} · ${ownerName}`
      : (ownerName || 'there');

    await loadDashboard();

    // First-login forced password change
    if (me.customer.mustChangePassword) {
      FORCE_PWD_CHANGE = true;
      openChangePassword(true);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function initAdminPreview() {
  // Fetch the vendor's profile so we can show their name in the header before
  // the main dashboard load completes.
  try {
    const list = await api('/api/admin/customers');
    const v = list.find(c => c.id === ADMIN_PREVIEW_VENDOR_ID);
    if (!v) { showToast('Vendor not found in admin list.', 'error'); return; }
    const ownerName = (v.name || '').trim();
    const company   = (v.companyName || '').trim();
    document.getElementById('customerName').textContent = company || ownerName || 'Vendor';
    const greet = document.getElementById('greetName');
    greet.textContent = (company ? `${company} · ${ownerName}` : ownerName) +
                       ' — viewing as admin';

    // Replace the vendor's logout button with a "Back to vendors" link.
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.innerHTML  = '<i class="fas fa-arrow-left"></i>';
      logoutBtn.title      = 'Back to admin Vendors';
      logoutBtn.onclick    = (e) => { e.preventDefault(); location.href = '/admin-customers.html'; };
    }
    // Admin can't change the vendor's password from this preview — hide that affordance.
    const changePwdBtn = document.getElementById('changePwdBtn');
    if (changePwdBtn) changePwdBtn.style.display = 'none';

    await loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openChangePassword(forced) {
  FORCE_PWD_CHANGE = !!forced;
  const intro = document.getElementById('cp-intro');
  const title = document.getElementById('cp-title');
  const close = document.getElementById('cp-closeBtn');
  const cancel= document.getElementById('cp-cancelBtn');
  if (forced) {
    title.textContent = 'Set Your Own Password';
    intro.innerHTML   = '<i class="fas fa-shield-halved" style="color:var(--accent)"></i> ' +
                        'For security, please set a new password before continuing. ' +
                        'Your current password is the temporary one your account manager shared with you.';
    close.style.display  = 'none';
    cancel.style.display = 'none';
  } else {
    title.textContent = 'Change Password';
    intro.textContent = 'Enter your current password and choose a new one.';
    close.style.display  = '';
    cancel.style.display = '';
  }
  document.getElementById('changePwdForm').reset();
  document.getElementById('changePwdModal').classList.add('open');
}

function closeChangePassword() {
  if (FORCE_PWD_CHANGE) return; // can't close while forced
  document.getElementById('changePwdModal').classList.remove('open');
}

async function submitChangePassword(e) {
  e.preventDefault();
  const cur = document.getElementById('cp-current').value;
  const nw  = document.getElementById('cp-new').value;
  const cfm = document.getElementById('cp-confirm').value;
  if (nw !== cfm) { showToast('New passwords do not match.', 'error'); return; }
  if (nw.length < 6) { showToast('New password must be at least 6 characters.', 'error'); return; }
  if (nw === cur) { showToast('New password must be different from the current one.', 'error'); return; }
  try {
    const res = await fetch('/api/customer-auth/change-password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not change password');
    FORCE_PWD_CHANGE = false;
    document.getElementById('changePwdModal').classList.remove('open');
    showToast('Password updated successfully.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadDashboard() {
  // Admin preview hits the admin endpoint (no vendor session required).
  const url = ADMIN_PREVIEW_VENDOR_ID
    ? `/api/admin/customers/${ADMIN_PREVIEW_VENDOR_ID}/dashboard`
    : '/api/customer/dashboard';
  const d = await api(url);

  renderHero(d);
  renderValidity(d.loyalty);
  renderEarnings(d);
  renderProgress(d);
  renderLadder(d.tiers || [], d.tier);
  renderEvents(d.events || []);
  renderPayments(d.payments || []);
}

function renderValidity(loyalty) {
  if (!loyalty) return;
  const banner    = document.getElementById('validityBanner');
  const startedEl = document.getElementById('vb-started');
  const expiresEl = document.getElementById('vb-expires');
  const summaryEl = document.getElementById('vb-summary');
  const iconEl    = document.getElementById('vb-icon');

  startedEl.textContent = formatLongDate(loyalty.startedAt);
  expiresEl.textContent = formatLongDate(loyalty.expiresAt);

  banner.classList.remove('warning', 'danger', 'expired');
  if (loyalty.expired) {
    banner.classList.add('expired');
    summaryEl.textContent = 'Programme has expired — please contact your account manager to renew.';
    iconEl.innerHTML = '<i class="fas fa-circle-exclamation"></i>';
  } else if (loyalty.daysToExpiry <= 30) {
    banner.classList.add('danger');
    summaryEl.textContent = `Expires in ${loyalty.daysToExpiry} day${loyalty.daysToExpiry === 1 ? '' : 's'} — renew with your account manager soon.`;
    iconEl.innerHTML = '<i class="fas fa-triangle-exclamation"></i>';
  } else if (loyalty.daysToExpiry <= 90) {
    banner.classList.add('warning');
    summaryEl.textContent = `Active · ${loyalty.daysToExpiry} days remaining`;
    iconEl.innerHTML = '<i class="fas fa-hourglass-half"></i>';
  } else {
    summaryEl.textContent = `Active · ${loyalty.daysToExpiry} days remaining`;
    iconEl.innerHTML = '<i class="fas fa-shield-halved"></i>';
  }
}

function formatLongDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function renderHero(d) {
  const tier  = d.tier || { name: 'Unranked', discountPercent: 0 };
  const hero  = document.getElementById('tierHero');
  const klass = (tier.name || 'unranked').toLowerCase();
  hero.className = 'tier-hero ' + klass;

  // Swap badge icon for the tier
  const icon = document.getElementById('tierIcon');
  if (klass === 'platinum')      icon.className = 'fas fa-crown';
  else if (klass === 'gold')     icon.className = 'fas fa-trophy';
  else if (klass === 'silver')   icon.className = 'fas fa-medal';
  else if (klass === 'bronze')   icon.className = 'fas fa-award';
  else                            icon.className = 'fas fa-seedling';

  document.getElementById('th-tierName').textContent = tier.name || 'Unranked';
  document.getElementById('th-tierRate').textContent =
    (tier.discountPercent ? tier.discountPercent + '% commission on every booking (net of GST)'
                          : 'Earn commission on every booking');
  document.getElementById('th-business').textContent = fmtINR(d.businessGross);
}

function renderEarnings(d) {
  document.getElementById('ec-totalEarned').textContent = fmtINR(d.totalCommissionEarned);
  document.getElementById('ec-eventCount').textContent  = (d.events || []).length;
  document.getElementById('ec-rate').textContent        = (d.tier && d.tier.discountPercent || 0) + '%';
  const paidEl    = document.getElementById('ec-paid');
  const payCntEl  = document.getElementById('ec-payCount');
  const outEl     = document.getElementById('ec-outstanding');
  if (paidEl)   paidEl.textContent   = fmtINR(d.totalCommissionPaid || 0);
  if (payCntEl) payCntEl.textContent = (d.payments || []).length;
  if (outEl)    outEl.textContent    = fmtINR(d.commissionOutstanding || 0);
}

function renderProgress(d) {
  const wrap = document.getElementById('progressWrap');
  if (!d.nextTier) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  const next = d.nextTier;

  document.getElementById('pw-remaining').textContent = fmtINR(next.remaining);
  document.getElementById('pw-nextTier').textContent  = next.name;
  document.getElementById('pw-pct').textContent       = next.progressPercent + '%';
  document.getElementById('pw-fill').style.width      = next.progressPercent + '%';

  // Show the "you'd have earned more" nudge only when there's already history.
  const uplift = Number(d.upliftIfNext) || 0;
  const upliftBox = document.getElementById('pw-uplift');
  if (uplift > 0 && (d.events || []).length > 0) {
    upliftBox.style.display = '';
    document.getElementById('pw-upliftTier').textContent   = next.name;
    document.getElementById('pw-upliftAmount').textContent = fmtINR(uplift);
  } else {
    upliftBox.style.display = 'none';
  }
}

function renderLadder(tiers, currentTier) {
  const grid = document.getElementById('ladderGrid');
  if (!tiers.length) {
    grid.innerHTML = '<p style="color:var(--text-2);font-size:13px;padding:12px">No tiers configured.</p>';
    return;
  }
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const currentName = (currentTier && currentTier.name) || '';
  const currentThreshold = (currentTier && currentTier.threshold) || 0;

  grid.innerHTML = sorted.map(t => {
    const cls       = t.name.toLowerCase();
    const isCurrent = currentName === t.name;
    const isUnlocked = currentThreshold >= t.threshold;
    let statusKlass = 'locked', statusText = 'Locked', cardKlass = 'locked';
    if (isCurrent)        { statusKlass = 'current';  statusText = 'Current';  cardKlass = 'current'; }
    else if (isUnlocked)  { statusKlass = 'unlocked'; statusText = 'Unlocked'; cardKlass = ''; }

    return `
      <div class="ladder-card tier-${cls} ${cardKlass}">
        <span class="lc-status ${statusKlass}">${statusText}</span>
        <div class="lc-tier ${cls}"><i class="fas fa-medal"></i> ${t.name}</div>
        <div class="lc-rate">${t.discountPercent}% commission on every booking</div>
        <div class="lc-threshold">Reach ${fmtINR(t.threshold)} in business given</div>
      </div>
    `;
  }).join('');
}

function renderEvents(events) {
  const body = document.getElementById('eventsBody');
  document.getElementById('eventCount').textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;
  if (!events.length) {
    body.innerHTML = `
      <tr><td colspan="9">
        <div class="empty-state">
          <i class="fas fa-calendar-plus"></i>
          <h3>No events yet</h3>
          <p>Once your first booking is confirmed, your commission will appear here. Talk to your account manager to plan your first event.</p>
        </div>
      </td></tr>`;
    return;
  }
  body.innerHTML = events.map(e => {
    const tierName = e.tierAtTime || 'Bronze';
    const tierCls  = tierName.toLowerCase();
    const endCell  = (e.eventDateTo && e.eventDateTo !== e.eventDate)
      ? formatDate(e.eventDateTo)
      : '<span style="color:var(--text-3)">—</span>';
    const client   = (e.clientName && e.clientName.trim())
      ? escapeHtml(e.clientName)
      : '<span style="color:var(--text-3)">—</span>';
    const tierCell = e.directByClient
      ? '<span class="status-badge" style="background:rgba(148,163,184,0.18);color:var(--text-2)">Direct</span>'
      : `<span class="tier-pill tier-${tierCls}"><i class="fas fa-medal"></i> ${tierName}</span>`;
    // When the booking spans multiple tier bands, show the blended rate +
    // a hover tooltip listing each band. Single-band stays plain like "15%".
    const bd = Array.isArray(e.commissionBreakdown) ? e.commissionBreakdown : [];
    const rateText = e.directByClient
      ? '—'
      : (Number.isInteger(e.rate) ? e.rate + '%' : e.rate.toFixed(2) + '%');
    const rateCell = (!e.directByClient && bd.length > 1)
      ? `<span title="${bd.map(s => `${fmtINR(s.amount)} @ ${s.rate}%`).join(' + ')}" style="border-bottom:1px dashed var(--text-3);cursor:help">${rateText}<span style="color:var(--text-3);font-size:0.72rem;margin-left:4px">blended</span></span>`
      : rateText;
    const commissionCell = e.directByClient
      ? '<span style="color:var(--text-3)">₹0</span>'
      : `<span style="color:var(--accent);font-weight:700">${fmtINR(e.commissionEarned)}</span>`;

    // Commission Paid / Partial / Not Paid / N/A (direct)
    let payCell;
    switch (e.commissionStatus) {
      case 'paid':
        payCell = '<span class="status-badge" style="background:var(--success-bg);color:var(--success)"><i class="fas fa-circle-check"></i> Paid</span>';
        break;
      case 'partial':
        payCell = '<span class="status-badge" style="background:var(--warning-bg);color:var(--warning)"><i class="fas fa-coins"></i> Partial</span>';
        break;
      case 'unpaid':
        payCell = '<span class="status-badge" style="background:var(--danger-bg);color:var(--danger)"><i class="fas fa-hourglass-half"></i> Not Paid</span>';
        break;
      default:
        payCell = '<span class="status-badge" style="background:var(--surface-2);color:var(--text-3)">—</span>';
    }

    return `
      <tr${e.directByClient ? ' style="opacity:0.85"' : ''}>
        <td data-label="Start Date" style="text-align:left">${formatDate(e.eventDate)}</td>
        <td data-label="End Date" style="text-align:left">${endCell}</td>
        <td data-label="Client" style="text-align:left">${client}</td>
        <td data-label="Event" style="text-align:left">${escapeHtml(e.eventType || '—')}</td>
        <td data-label="Tier" style="text-align:center">${tierCell}</td>
        <td data-label="Booking Total" style="text-align:right">${fmtINR(e.total)}</td>
        <td data-label="Rate" style="text-align:center">${rateCell}</td>
        <td data-label="Commission" style="text-align:right">${commissionCell}</td>
        <td data-label="Payment" style="text-align:center">${payCell}</td>
      </tr>
    `;
  }).join('');
}

function renderPayments(payments) {
  const body = document.getElementById('paymentsBody');
  const cnt  = document.getElementById('paymentsCount');
  if (!body) return;
  cnt.textContent = `${payments.length} payment${payments.length === 1 ? '' : 's'}`;
  if (!payments.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty-row">No payments yet — your account manager will record them here.</td></tr>`;
    return;
  }
  body.innerHTML = payments.map(p => `
    <tr>
      <td data-label="Date" style="text-align:left">${formatDate(p.date)}</td>
      <td data-label="Amount" style="text-align:right;color:var(--success);font-weight:700">${fmtINR(p.amount)}</td>
      <td data-label="Mode" style="text-align:left">${escapeHtml(p.mode)}</td>
      <td data-label="Notes" style="text-align:left">${escapeHtml(p.notes || '—')}</td>
    </tr>
  `).join('');
}

function formatDate(s) {
  if (!s) return '—';
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return s; }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

async function customerLogout() {
  try { await fetch('/api/customer-auth/logout', { method: 'POST', credentials: 'same-origin' }); }
  catch {}
  location.href = '/customer-login';
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type || '');
  setTimeout(() => t.classList.remove('show'), 2800);
}

document.addEventListener('DOMContentLoaded', init);
