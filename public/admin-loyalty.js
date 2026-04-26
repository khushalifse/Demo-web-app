'use strict';

const fmtINR = n => '₹' + Number(n || 0).toLocaleString('en-IN');
let VENDORS = [];

function showTab(name) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = (p.id === 'tab-' + name) ? '' : 'none');
  if (name === 'vendors')   loadVendors();
  if (name === 'reversals') loadReversals();
  if (name === 'manual')    loadVendorOptions();
  if (name === 'report')    loadReport();
  if (name === 'audit')     loadAudit();
}

async function loadVendors() {
  const tbody = document.getElementById('vendorsBody');
  tbody.innerHTML = `<tr><td colspan="9" class="empty-cell"><i class="fas fa-circle-notch fa-spin"></i> Loading…</td></tr>`;
  const rows = await fetch('/api/admin/loyalty/vendors').then(r => r.json());
  VENDORS = rows;
  document.getElementById('vendorCount').textContent = `${rows.length} vendor${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">No vendors yet. They sign up at <code>/vendor-login</code>.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(v => `
    <tr>
      <td>${esc(v.name)}</td>
      <td>${esc(v.companyName || '—')}</td>
      <td>${esc(v.email)}</td>
      <td><span class="badge badge-rev-${v.currentTier === 'Platinum' ? 'Approved' : v.currentTier === 'Gold' ? 'Eligible' : v.currentTier === 'Silver' ? 'NotEligible' : 'NotEligible'}">${v.currentTier || '—'}</span>${v.manualTierOverride ? ' <i class="fas fa-shield-halved" title="Manual override" style="color:#f59e0b"></i>' : ''}</td>
      <td>${v.discountPercent}%</td>
      <td class="text-right">${fmtINR(v.ytdSales)}</td>
      <td class="text-right">${v.ytdShowCount}</td>
      <td>${v.fiscalYear}</td>
      <td class="text-center">
        <button class="btn-ghost" onclick='openOverride(${JSON.stringify(v).replace(/'/g, "&#39;")})'>Override</button>
      </td>
    </tr>
  `).join('');
}

async function loadReversals() {
  const tbody = document.getElementById('reversalsBody');
  tbody.innerHTML = `<tr><td colspan="7" class="empty-cell"><i class="fas fa-circle-notch fa-spin"></i> Loading…</td></tr>`;
  const [bookings, vendors] = await Promise.all([
    fetch('/api/bookings').then(r => r.json()),
    fetch('/api/admin/loyalty/vendors').then(r => r.json()),
  ]);
  const byVendor = Object.fromEntries(vendors.map(v => [v.id, v]));
  const queue = bookings.filter(b => b.reversalStatus === 'Eligible' || b.reversalStatus === 'Approved');

  if (!queue.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No reversals pending.</td></tr>`;
    return;
  }
  tbody.innerHTML = queue.map(b => `
    <tr>
      <td>${esc((byVendor[b.vendorId] || {}).name || '—')}</td>
      <td>${esc(b.eventType || '—')}</td>
      <td>${b.eventDate}</td>
      <td class="text-right">${fmtINR(b.fullPrice || b.totalPrice)}</td>
      <td class="text-right">${fmtINR(b.discountAmount)}</td>
      <td><span class="badge badge-rev-${b.reversalStatus}">${b.reversalStatus}</span></td>
      <td class="text-center">
        <button class="btn-success" onclick="approveReversal('${b.id}')"><i class="fas fa-check"></i> Approve</button>
      </td>
    </tr>
  `).join('');
}

async function approveReversal(id) {
  if (!confirm('Approve discount reversal for this booking?')) return;
  const res = await fetch(`/api/admin/loyalty/booking/${id}/approve-reversal`, { method: 'PATCH' });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Failed to approve');
  showToast('Reversal approved.');
  loadReversals();
}

async function loadVendorOptions() {
  if (!VENDORS.length) {
    VENDORS = await fetch('/api/admin/loyalty/vendors').then(r => r.json());
  }
  const sel = document.getElementById('ms-vendor');
  sel.innerHTML = '<option value="">— Select vendor —</option>' +
    VENDORS.map(v => `<option value="${v.id}">${esc(v.name)} (${esc(v.email)})</option>`).join('');
}

async function submitManualShow(e) {
  e.preventDefault();
  const payload = {
    vendorId:      document.getElementById('ms-vendor').value,
    showName:      document.getElementById('ms-showName').value.trim(),
    showDate:      document.getElementById('ms-date').value,
    amount:        Number(document.getElementById('ms-amount').value) || 0,
    venue:         document.getElementById('ms-venue').value.trim(),
    depositAmount: Number(document.getElementById('ms-deposit').value) || 0,
    isAjsShow:     document.getElementById('ms-isAjs').value === 'true',
    reason:        document.getElementById('ms-reason').value.trim(),
    remarks:       document.getElementById('ms-remarks').value.trim(),
  };
  const res = await fetch('/api/admin/loyalty/manual-show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Failed to add show');
  showToast('Manual show added.');
  e.target.reset();
}

async function loadReport() {
  const fy = document.getElementById('report-fy').value.trim();
  const url = fy ? `/api/admin/loyalty/report?fy=${encodeURIComponent(fy)}` : '/api/admin/loyalty/report';
  const data = await fetch(url).then(r => r.json());

  const grid = document.getElementById('reportGrid');
  const counts = data.tierCounts || {};
  grid.innerHTML = `
    <div class="report-card"><div class="rc-label">Fiscal Year</div><div class="rc-value">${data.fiscalYear}</div></div>
    <div class="report-card"><div class="rc-label">Total AJ Sales</div><div class="rc-value">${fmtINR(data.totalSales)}</div></div>
    <div class="report-card"><div class="rc-label">Total AJ Shows</div><div class="rc-value">${data.totalShows}</div></div>
    <div class="report-card"><div class="rc-label">Tier Distribution</div><div class="rc-value" style="font-size:14px;line-height:1.5">${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div></div>
  `;

  const tbody = document.getElementById('reportBody');
  if (!data.vendors.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">No vendors.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.vendors.map(v => `
    <tr>
      <td>${esc(v.name)}${v.companyName ? ' <span style="color:#94a3b8">— ' + esc(v.companyName) + '</span>' : ''}</td>
      <td>${v.currentTier}</td>
      <td class="text-right">${fmtINR(v.ytdSales)}</td>
      <td class="text-right">${v.ytdShowCount}</td>
    </tr>
  `).join('');
}

async function loadAudit() {
  const rows = await fetch('/api/admin/loyalty/audit').then(r => r.json());
  const vendors = VENDORS.length ? VENDORS : await fetch('/api/admin/loyalty/vendors').then(r => r.json());
  const byId = Object.fromEntries(vendors.map(v => [v.id, v.name]));
  const tbody = document.getElementById('auditBody');
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No tier overrides yet.</td></tr>`; return; }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${new Date(r.at).toLocaleString()}</td>
      <td>${esc(byId[r.vendorId] || r.vendorId)}</td>
      <td>${r.fromTier || '—'} → ${r.toTier || '— (cleared)'}</td>
      <td>${esc(r.reason || '—')}</td>
      <td>${esc(r.byName || r.by || '—')}</td>
    </tr>
  `).join('');
}

let _overrideVendorId = null;
function openOverride(v) {
  _overrideVendorId = v.id;
  document.getElementById('ov-vendorName').value = v.name;
  document.getElementById('ov-tier').value = (v.manualTierOverride && v.manualTierOverride.tier) || '';
  document.getElementById('ov-reason').value = '';
  document.getElementById('overrideModal').style.display = 'flex';
}
function closeOverride() {
  document.getElementById('overrideModal').style.display = 'none';
  _overrideVendorId = null;
}
async function submitOverride() {
  const tier   = document.getElementById('ov-tier').value;
  const reason = document.getElementById('ov-reason').value.trim();
  if (!reason) return showToast('Reason is required for the audit log.');
  const res = await fetch(`/api/admin/loyalty/vendor/${_overrideVendorId}/override-tier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: tier || null, reason }),
  });
  const data = await res.json();
  if (!res.ok) return showToast(data.error || 'Override failed');
  showToast('Tier override saved.');
  closeOverride();
  loadVendors();
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

loadVendors();
