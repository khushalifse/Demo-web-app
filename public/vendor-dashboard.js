'use strict';

const fmtINR = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const tierTone = {
  Silver:   { bg: 'linear-gradient(135deg, #b0bec5, #78909c)', icon: 'medal' },
  Gold:     { bg: 'linear-gradient(135deg, #ffd54f, #ff8f00)', icon: 'medal' },
  Platinum: { bg: 'linear-gradient(135deg, #b39ddb, #5e35b1)', icon: 'crown' },
};

let LOYALTY = null;

async function loadDashboard() {
  try {
    const [me, tiers, history] = await Promise.all([
      fetch('/api/loyalty/me').then(r => r.json()),
      fetch('/api/loyalty/tiers').then(r => r.json()),
      fetch('/api/loyalty/history').then(r => r.json()),
    ]);
    LOYALTY = me;
    renderHeader(me);
    renderTierHero(me);
    renderProgress(me);
    renderTierLadder(tiers, me);
    renderHistory(history);
    updatePreview();
  } catch (err) {
    console.error(err);
    showToast('Failed to load dashboard. Please refresh.');
    if (err.status === 401) location.href = '/vendor-login';
  }
}

function renderHeader(d) {
  document.getElementById('vendorName').textContent = (d.vendor && d.vendor.name) || 'Vendor';
  document.getElementById('fyLabel').textContent    = d.fiscalYear;
  document.getElementById('fyDays').textContent     = d.daysRemainingInFY;
}

function renderTierHero(d) {
  const tone = (d.currentTier && tierTone[d.currentTier.name]) || { bg: 'linear-gradient(135deg, #cfd8dc, #90a4ae)', icon: 'circle-notch' };
  const hero = document.getElementById('tierHero');
  hero.style.background = tone.bg;
  document.getElementById('thBadge').innerHTML = `<i class="fas fa-${tone.icon}"></i>`;
  document.getElementById('thName').textContent     = d.currentTier ? d.currentTier.name : 'No tier yet';
  document.getElementById('thDiscount').textContent = (d.discountPercent || 0) + '%';
  document.getElementById('thYtd').textContent      = fmtINR(d.ytdSales);
  document.getElementById('thShows').textContent    = d.ytdShowCount;
}

function renderProgress(d) {
  const card = document.getElementById('progressCard');
  if (!d.nextTier) {
    document.getElementById('nextTierName').textContent = 'Top tier achieved';
    document.getElementById('progressSub').textContent  = `You are at the top — ${d.currentTier ? d.currentTier.name : ''}.`;
    document.getElementById('progressPct').textContent  = '100%';
    document.getElementById('progressFill').style.width = '100%';
    return;
  }
  const lower = d.currentTier ? d.currentTier.threshold : 0;
  const span  = d.nextTier.threshold - lower;
  const pct   = span > 0 ? Math.min(100, Math.max(0, ((d.ytdSales - lower) / span) * 100)) : 0;

  document.getElementById('nextTierName').textContent = d.nextTier.name;
  document.getElementById('progressSub').textContent  = `${fmtINR(d.remainingToNext)} away from ${d.nextTier.name} (${d.nextTier.discountPercent}% discount).`;
  document.getElementById('progressPct').textContent  = pct.toFixed(0) + '%';
  document.getElementById('progressFill').style.width = pct + '%';
}

function renderTierLadder(tiers, d) {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const wrap = document.getElementById('tierLadder');
  wrap.innerHTML = sorted.map(t => {
    const achieved = d.ytdSales >= t.threshold;
    const isCurrent = d.currentTier && d.currentTier.name === t.name;
    return `
      <div class="ladder-row ${achieved ? 'achieved' : ''} ${isCurrent ? 'current' : ''}">
        <div class="lr-icon"><i class="fas fa-${(tierTone[t.name] || {}).icon || 'medal'}"></i></div>
        <div class="lr-body">
          <div class="lr-name">${t.name}</div>
          <div class="lr-meta">${fmtINR(t.threshold)} annual sales · ${t.discountPercent}% discount</div>
        </div>
        <div class="lr-status">${achieved ? '<i class="fas fa-check-circle"></i>' : ''}</div>
      </div>`;
  }).join('');
}

function renderHistory(rows) {
  document.getElementById('historyCount').textContent = `${rows.length} booking${rows.length === 1 ? '' : 's'}`;
  const tbody = document.getElementById('historyBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">No bookings yet.</td></tr>`;
    return;
  }
  const paymentBadge = s => `<span class="badge badge-pay-${s}">${s.replace(/([A-Z])/g, ' $1').trim()}</span>`;
  const reversalBadge = s => `<span class="badge badge-rev-${s}">${s.replace(/([A-Z])/g, ' $1').trim()}</span>`;
  tbody.innerHTML = rows.map(b => `
    <tr>
      <td>${b.eventDate || '—'}</td>
      <td>${esc(b.eventType || '—')}</td>
      <td>${esc(b.venue || '—')}</td>
      <td class="text-right">${fmtINR(b.fullPrice || b.totalPrice)}</td>
      <td class="text-right">${b.discountAmount ? fmtINR(b.discountAmount) + ' (' + b.discountPercent + '%)' : '—'}</td>
      <td>${paymentBadge(b.paymentStatus || 'Pending')}</td>
      <td>${reversalBadge(b.reversalStatus || 'NotEligible')}</td>
      <td>${b.isAjsShow === false ? '<span class="badge badge-rev-NotEligible">Non-AJ</span>' : '<i class="fas fa-check" style="color:#22c55e"></i>'}</td>
    </tr>
  `).join('');
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function updatePreview() {
  if (!LOYALTY) return;
  const amount = Number(document.getElementById('previewAmount').value) || 0;
  document.getElementById('prRate').textContent     = (LOYALTY.discountPercent || 0) + '%';
  if (!amount) {
    document.getElementById('prFull').textContent     = fmtINR(0);
    document.getElementById('prDiscount').textContent = fmtINR(0);
    document.getElementById('prNet').textContent      = fmtINR(0);
    return;
  }
  const res = await fetch('/api/loyalty/preview?amount=' + amount).then(r => r.json());
  document.getElementById('prFull').textContent     = fmtINR(res.fullPrice);
  document.getElementById('prDiscount').textContent = fmtINR(res.discountAmount);
  document.getElementById('prNet').textContent      = fmtINR(res.netAfterReversal);
}

function scrollToBookings(e) { e.preventDefault(); document.getElementById('bookings').scrollIntoView({ behavior: 'smooth' }); }

async function vendorLogout() {
  await fetch('/api/vendor-auth/logout', { method: 'POST' });
  location.href = '/vendor-login';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

loadDashboard();
