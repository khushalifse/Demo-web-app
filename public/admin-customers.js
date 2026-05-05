'use strict';

const fmtINR = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

let CUSTOMERS = [];

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

async function loadHeaderUser() {
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
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  location.href = '/login';
}

async function load() {
  try {
    CUSTOMERS = await api('/api/admin/customers');
    render();
    populateLogBizVendorSelect();
    populatePayVendorSelect();
    loadPaymentHistory();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ─── Log Business Entry ────────────────────────────────────────────────── */
function populateLogBizVendorSelect() {
  const sel = document.getElementById('lb-vendor');
  if (!sel) return;
  const approved = CUSTOMERS.filter(c => c.status === 'approved');
  sel.innerHTML = '<option value="">— Select vendor —</option>' +
    approved.map(v => {
      const tierName = (v.tier && v.tier.name) || 'Bronze';
      const tierRate = (v.tier && v.tier.discountPercent) || 0;
      const company  = v.companyName ? escapeHtml(v.companyName) + ' · ' : '';
      return `<option value="${v.id}">${company}${escapeHtml(v.name)} — ${tierName} (${tierRate}%)</option>`;
    }).join('');

  // Default the date to today.
  const dateInput = document.getElementById('lb-date');
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
  syncEndDateMin();
}

// Find the next tier above a vendor's current business + new amount.
function projectTier(currentBusiness, addAmount) {
  // CUSTOMERS list returns each vendor's current tier already; but to project
  // an upgrade we need the full ladder. Quick inline copy of tiers (matches
  // server defaults). The server accepts whatever it is — we just preview.
  const TIERS = [
    { name: 'Bronze',   threshold: 0,       discountPercent: 5    },
    { name: 'Silver',   threshold: 1000000, discountPercent: 7.5  },
    { name: 'Gold',     threshold: 2500000, discountPercent: 10   },
    { name: 'Platinum', threshold: 5000000, discountPercent: 15   },
  ];
  const newTotal = (Number(currentBusiness) || 0) + (Number(addAmount) || 0);
  let projected = TIERS[0];
  for (const t of TIERS) if (newTotal >= t.threshold) projected = t;
  return projected;
}

function onLogBizVendorChange() {
  // Populate the POC dropdown from the selected vendor's POCs. Always shown
  // when a vendor is selected — POC is optional but the field stays visible.
  const id    = document.getElementById('lb-vendor').value;
  const wrap  = document.getElementById('lb-pocWrap');
  const sel   = document.getElementById('lb-poc');
  if (!id) {
    if (wrap) wrap.style.display = 'none';
    if (sel)  sel.innerHTML = '<option value="">— Select POC —</option>';
  } else {
    const v = CUSTOMERS.find(c => c.id === id);
    const pocs = (v && v.pocs) ? v.pocs : [];
    if (sel) {
      const placeholder = pocs.length
        ? '<option value="">— Optional · not specified —</option>'
        : '<option value="">— No POCs configured for this vendor —</option>';
      sel.innerHTML = placeholder +
        pocs.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
      sel.disabled = pocs.length === 0;
    }
    if (wrap) wrap.style.display = '';
  }
  updateLogBizPreview();
}

// When the start date changes, force the end date to be on or after it.
function syncEndDateMin() {
  const start = document.getElementById('lb-date').value;
  const endEl = document.getElementById('lb-endDate');
  if (!endEl) return;
  endEl.min = start || '';
  if (endEl.value && start && endEl.value < start) {
    // Wipe an end date that became invalid after the user changed the start.
    endEl.value = '';
  }
}

function updateLogBizPreview() {
  const id     = document.getElementById('lb-vendor').value;
  const amount = Number(document.getElementById('lb-amount').value) || 0;
  const direct = document.getElementById('lb-direct') && document.getElementById('lb-direct').value === 'yes';
  const card   = document.getElementById('logBizPreview');

  if (!id) { card.style.display = 'none'; return; }
  const v = CUSTOMERS.find(c => c.id === id);
  if (!v) { card.style.display = 'none'; return; }

  card.style.display = '';
  document.getElementById('lbp-vendorName').textContent = v.name + (v.companyName ? ' · ' + v.companyName : '');
  const currentTier = (v.tier && v.tier.name) || 'Bronze';
  const currentRate = (v.tier && v.tier.discountPercent) || 0;
  document.getElementById('lbp-tier').textContent = currentTier;
  document.getElementById('lbp-rate').textContent = direct ? '0% (direct)' : currentRate + '%';

  const commission = direct ? 0 : Math.round(amount * currentRate / 100);
  document.getElementById('lbp-commission').textContent = fmtINR(commission);

  const upliftBox = document.getElementById('lbp-uplift');
  if (direct) {
    upliftBox.style.display = '';
    upliftBox.innerHTML = '<i class="fas fa-circle-info"></i> Direct booking — entry will appear in vendor\'s log but no commission and no tier impact.';
    upliftBox.style.background = 'var(--info-bg)';
    upliftBox.style.borderColor = 'rgba(59,130,246,0.3)';
    upliftBox.style.color = 'var(--info)';
    return;
  }
  // Reset styles in case they were toggled to direct earlier
  upliftBox.style.background = '';
  upliftBox.style.borderColor = '';
  upliftBox.style.color = '';

  const projected = projectTier(v.businessGross, amount);
  if (projected.name !== currentTier && amount > 0) {
    upliftBox.style.display = '';
    upliftBox.innerHTML = '<i class="fas fa-rocket"></i> This entry will push them into <strong id="lbp-newTier">' + projected.name + ' (' + projected.discountPercent + '%)</strong>!';
  } else {
    upliftBox.style.display = 'none';
  }
}

async function submitBusinessEntry(e) {
  e.preventDefault();
  const btn = document.getElementById('logBizSubmit');
  const id  = document.getElementById('lb-vendor').value;
  const amount     = Number(document.getElementById('lb-amount').value) || 0;
  const date       = document.getElementById('lb-date').value;
  const endDate    = document.getElementById('lb-endDate').value;
  const clientName = document.getElementById('lb-clientName').value.trim();
  const desc       = document.getElementById('lb-description').value.trim();

  if (!id)         { showToast('Please select a vendor.', 'error'); return; }
  if (amount <= 0) { showToast('Enter a net business amount greater than zero.', 'error'); return; }
  if (!date)       { showToast('Event start date is required.', 'error'); return; }
  if (endDate && endDate < date) {
    showToast('End date can\'t be earlier than the start date. Please correct it.', 'error');
    return;
  }

  const direct = document.getElementById('lb-direct').value === 'yes';
  const pocSel = document.getElementById('lb-poc');
  const poc    = pocSel ? pocSel.value : '';

  btn.disabled = true;
  try {
    const res = await api(`/api/admin/customers/${id}/business-entry`, {
      method: 'POST',
      body: JSON.stringify({
        netAmount:      amount,
        eventDate:      date,
        eventDateTo:    endDate || null,
        clientName:     clientName,
        poc,
        description:    desc,
        directByClient: direct,
      }),
    });
    if (direct) {
      showToast('Direct booking logged · no commission, no tier impact', 'success');
    } else {
      showToast(`Entry logged · ₹${(res.commissionFromThisEntry || 0).toLocaleString('en-IN')} commission added at ${res.newTier.name}`, 'success');
    }
    document.getElementById('logBizForm').reset();
    document.getElementById('lb-direct').value = 'no';
    document.getElementById('lb-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('logBizPreview').style.display = 'none';
    await load();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ─── Commission Payments ───────────────────────────────────────────────── */
function populatePayVendorSelect() {
  const sel = document.getElementById('pay-vendor');
  if (!sel) return;
  const approved = CUSTOMERS.filter(c => c.status === 'approved');
  sel.innerHTML = '<option value="">— Select vendor —</option>' +
    approved.map(v => {
      const company = v.companyName ? escapeHtml(v.companyName) + ' · ' : '';
      const out = v.commissionOutstanding || 0;
      const tag = out > 0 ? ` (₹${out.toLocaleString('en-IN')} outstanding)` : ' (settled)';
      return `<option value="${v.id}">${company}${escapeHtml(v.name)}${tag}</option>`;
    }).join('');
  const dateInput = document.getElementById('pay-date');
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
}

let UNPAID_EVENTS_CACHE = [];

// Vendor selected → prefill amount with their outstanding commission, populate
// the Pay-For-Event dropdown with unpaid events only, and constrain the
// payment date.
async function onPayVendorChange() {
  const id      = document.getElementById('pay-vendor').value;
  const amtEl   = document.getElementById('pay-amount');
  const dateEl  = document.getElementById('pay-date');
  const hintEl  = document.getElementById('pay-vendor-hint');
  const evWrap  = document.getElementById('pay-event-wrap');
  const evSel   = document.getElementById('pay-event');
  const v       = CUSTOMERS.find(c => c.id === id);

  // Reset event dropdown
  UNPAID_EVENTS_CACHE = [];
  if (evSel)  evSel.innerHTML  = '<option value="">— All outstanding —</option>';
  if (evWrap) evWrap.style.display = 'none';

  if (!v) {
    amtEl.value = '';
    if (dateEl) {
      dateEl.min = '';
      dateEl.value = new Date().toISOString().split('T')[0];
    }
    if (hintEl) hintEl.textContent = '';
    return;
  }
  const outstanding = Number(v.commissionOutstanding) || 0;
  amtEl.value = outstanding > 0 ? outstanding : '';

  // Default min for the date = today (we'll tighten/loosen this once we know
  // which specific event the admin wants to pay for, in onPayEventChange).
  const today = new Date().toISOString().split('T')[0];
  if (dateEl) {
    dateEl.min   = today;
    dateEl.value = today;
  }

  if (hintEl) {
    const earned = Number(v.commissionEarned) || 0;
    const paid   = Number(v.commissionPaid)   || 0;
    const lastEv = v.lastEventDate ? formatPayDate(v.lastEventDate) : '—';
    hintEl.textContent =
      `Earned ₹${earned.toLocaleString('en-IN')} · Paid ₹${paid.toLocaleString('en-IN')} · ` +
      `Outstanding ₹${outstanding.toLocaleString('en-IN')} · Latest event: ${lastEv}`;
  }

  // Fetch unpaid/partial events and populate the dropdown
  try {
    const list = await api(`/api/admin/customers/${id}/unpaid-events`);
    UNPAID_EVENTS_CACHE = list;
    if (list.length && evSel) {
      evSel.innerHTML = '<option value="">— All outstanding —</option>' +
        list.map(e => {
          const tag = e.commissionStatus === 'partial' ? ' · partial' : '';
          const evName = e.eventType + (e.clientName ? ' · ' + e.clientName : '');
          return `<option value="${e.id}" data-amount="${e.commissionRemaining}">` +
                 `${formatPayDate(e.eventDate)} — ${escapeHtml(evName)} (₹${e.commissionRemaining.toLocaleString('en-IN')}${tag})` +
                 `</option>`;
        }).join('');
      if (evWrap) evWrap.style.display = '';
    }
  } catch (err) {
    /* non-fatal — vendor still works for total-outstanding payment */
  }
}

// Pay-for-event change → set amount to that event's remaining commission AND
// set the payment date to the event's date (admin is paying for that specific
// event, so the payment can happen any time on or after the event).
function onPayEventChange() {
  const sel    = document.getElementById('pay-event');
  const amt    = document.getElementById('pay-amount');
  const dateEl = document.getElementById('pay-date');
  if (!sel || !amt) return;
  const id     = sel.value;
  const today  = new Date().toISOString().split('T')[0];

  if (!id) {
    // "All outstanding" — restore vendor's outstanding total. Date floor is
    // the EARLIEST unpaid event date (or today if none).
    const vId = document.getElementById('pay-vendor').value;
    const v   = CUSTOMERS.find(c => c.id === vId);
    amt.value = (v && v.commissionOutstanding) || '';
    if (dateEl) {
      const earliest = (UNPAID_EVENTS_CACHE[0] && UNPAID_EVENTS_CACHE[0].eventDate) || today;
      dateEl.min   = earliest;
      if (!dateEl.value || dateEl.value < earliest) dateEl.value = earliest;
    }
    return;
  }

  const ev = UNPAID_EVENTS_CACHE.find(e => e.id === id);
  if (!ev) return;
  amt.value = ev.commissionRemaining;
  if (dateEl) {
    dateEl.min   = ev.eventDate;
    dateEl.value = ev.eventDate;
  }
}

async function loadPaymentHistory() {
  const body = document.getElementById('payHistoryBody');
  if (!body) return;
  try {
    const list = await api('/api/admin/customers/commission-payments/all');
    document.getElementById('payCount').textContent = `${list.length} payment${list.length === 1 ? '' : 's'}`;
    if (!list.length) {
      body.innerHTML = `<tr><td colspan="6" class="empty-row">No payments recorded yet.</td></tr>`;
      return;
    }
    body.innerHTML = list.map(p => `
      <tr>
        <td data-label="Date">${formatPayDate(p.date)}</td>
        <td data-label="Vendor">${escapeHtml(p.vendor ? p.vendor.name : '(deleted vendor)')}${p.vendor && p.vendor.companyName ? ' <span style="color:var(--text-3)">· ' + escapeHtml(p.vendor.companyName) + '</span>' : ''}</td>
        <td data-label="Amount" style="text-align:right;color:var(--accent);font-weight:700">${fmtINR(p.amount)}</td>
        <td data-label="Mode">${escapeHtml(p.mode)}</td>
        <td data-label="Notes">${escapeHtml(p.notes || '—')}</td>
        <td data-label="Actions" style="text-align:center">
          <button class="btn-icon delete" title="Delete" onclick="deletePayment('${p.id}')"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function formatPayDate(s) {
  if (!s) return '—';
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return s; }
}

async function submitPayment(e) {
  e.preventDefault();
  const id     = document.getElementById('pay-vendor').value;
  const amount = Number(document.getElementById('pay-amount').value) || 0;
  const mode   = document.getElementById('pay-mode').value;
  const date   = document.getElementById('pay-date').value;
  const notes  = document.getElementById('pay-notes').value.trim();

  if (!id)         { showToast('Please select a vendor.', 'error'); return; }
  if (amount <= 0) { showToast('Payment amount must be greater than zero.', 'error'); return; }
  if (!mode)       { showToast('Please select a payment mode.', 'error'); return; }
  if (!date)       { showToast('Payment date is required.', 'error'); return; }

  try {
    await api(`/api/admin/customers/${id}/commission-payment`, {
      method: 'POST',
      body: JSON.stringify({ amount, mode, date, notes }),
    });
    showToast(`Payment of ₹${amount.toLocaleString('en-IN')} recorded.`, 'success');
    document.getElementById('payForm').reset();
    document.getElementById('pay-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('pay-event-wrap').style.display = 'none';
    document.getElementById('pay-vendor-hint').textContent  = '';
    UNPAID_EVENTS_CACHE = [];
    await load();
    await loadPaymentHistory();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deletePayment(id) {
  if (!confirm('Delete this payment record?')) return;
  try {
    await api(`/api/admin/customers/commission-payments/${id}`, { method: 'DELETE' });
    showToast('Payment removed.', 'success');
    await loadPaymentHistory();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function render() {
  const pending  = CUSTOMERS.filter(c => c.status === 'pending');
  const approved = CUSTOMERS.filter(c => c.status === 'approved');
  const declined = CUSTOMERS.filter(c => c.status === 'declined');

  document.getElementById('badgePending').textContent  = pending.length;
  document.getElementById('badgeApproved').textContent = approved.length;
  document.getElementById('badgeDeclined').textContent = declined.length;

  // PENDING
  document.getElementById('pendingBody').innerHTML = pending.length
    ? pending.map(c => `
        <tr>
          <td><span class="client-name">${escapeHtml(c.name)}</span></td>
          <td>${escapeHtml(c.companyName || '—')}</td>
          <td>${escapeHtml(c.email)}</td>
          <td>${escapeHtml(c.phone || '—')}</td>
          <td>${formatDate(c.createdAt)}</td>
          <td>
            <div class="actions-cell" style="justify-content:center">
              <button class="btn btn-primary" style="padding:6px 12px;font-size:0.78rem" onclick="approveCustomer('${c.id}')">
                <i class="fas fa-check"></i> Approve
              </button>
              <button class="btn btn-ghost" style="padding:6px 12px;font-size:0.78rem" onclick="declineCustomer('${c.id}')">
                <i class="fas fa-times"></i> Decline
              </button>
            </div>
          </td>
        </tr>`).join('')
    : `<tr><td colspan="6" class="empty-row">No pending registrations.</td></tr>`;

  // APPROVED — show vendor's current tier and tier-derived commission earned.
  document.getElementById('approvedBody').innerHTML = approved.length
    ? approved.map(c => {
        const tierName = (c.tier && c.tier.name) || 'Bronze';
        const tierRate = (c.tier && c.tier.discountPercent) || 0;
        const tierCls  = tierName.toLowerCase();
        const overrideHint = c.tierOverride ? ` <span title="Floor set to ${c.tierOverride}" style="opacity:0.5;font-size:0.7rem">(floor)</span>` : '';
        const pocCell = (c.pocs && c.pocs.length)
          ? `<div class="poc-chips">${c.pocs.map(p => `<span class="poc-chip">${escapeHtml(p)}</span>`).join('')}</div>`
          : '<span style="color:var(--text-3)">—</span>';
        // Highlight if vendor changed their password in the last 14 days
        const pwdChangedAt = c.passwordChangedAt ? new Date(c.passwordChangedAt) : null;
        const recentlyChanged = pwdChangedAt && (Date.now() - pwdChangedAt.getTime()) < 14 * 24 * 60 * 60 * 1000;
        const pwdBadge = recentlyChanged
          ? `<span class="status-badge" style="background:var(--info-bg);color:var(--info);font-size:0.65rem;margin-left:6px" title="Vendor changed their password on ${formatPayDate(c.passwordChangedAt.slice(0,10))}"><i class="fas fa-key"></i> pwd updated</span>`
          : '';
        const mustChange = c.mustChangePassword
          ? '<span class="status-badge" style="background:var(--warning-bg);color:var(--warning);font-size:0.65rem;margin-left:6px" title="Vendor has not yet changed their initial password"><i class="fas fa-hourglass-half"></i> pending change</span>'
          : '';
        return `
          <tr>
            <td data-label="Name & Email">
              <div class="client-name">${escapeHtml(c.name)} ${pwdBadge}${mustChange}</div>
              <div style="font-size:0.78rem;color:var(--text-2);margin-top:2px">${escapeHtml(c.email)}</div>
            </td>
            <td data-label="Company">${escapeHtml(c.companyName || '—')}</td>
            <td data-label="POCs">${pocCell}</td>
            <td data-label="Tier"><span class="tier-pill tier-${tierCls}"><i class="fas fa-medal"></i> ${tierName} <span style="opacity:0.75">(${tierRate}%)</span></span>${overrideHint}</td>
            <td data-label="Bookings" style="text-align:right">${c.bookingsCount || 0}</td>
            <td data-label="Business (net)" style="text-align:right"><span class="price-text">${fmtINR(c.businessGross || 0)}</span></td>
            <td data-label="Commission Earned" style="text-align:right"><span class="price-text" style="color:var(--accent);font-weight:700">${fmtINR(c.commissionEarned || 0)}</span></td>
            <td data-label="Actions">
              <div class="actions-cell" style="justify-content:center">
                <button class="btn-icon edit" title="Edit vendor" onclick="openEditVendor('${c.id}')">
                  <i class="fas fa-pen"></i>
                </button>
                <button class="btn-icon" title="Reset password" onclick="openResetPassword('${c.id}')">
                  <i class="fas fa-key"></i>
                </button>
                <button class="btn-icon delete" title="Delete vendor" onclick="deleteCustomer('${c.id}')">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="8" class="empty-row">No vendors yet.</td></tr>`;

  // DECLINED
  document.getElementById('declinedBody').innerHTML = declined.length
    ? declined.map(c => `
        <tr>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.companyName || '—')}</td>
          <td>${escapeHtml(c.email)}</td>
          <td>${formatDate(c.declinedAt)}</td>
          <td>
            <div class="actions-cell" style="justify-content:center">
              <button class="btn btn-primary" style="padding:6px 12px;font-size:0.78rem" onclick="approveCustomer('${c.id}')">
                <i class="fas fa-check"></i> Re-approve
              </button>
              <button class="btn-icon delete" title="Delete" onclick="deleteCustomer('${c.id}')">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>`).join('')
    : `<tr><td colspan="5" class="empty-row">No declined registrations.</td></tr>`;
}

function showTab(tab) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  document.getElementById('tab-' + tab).style.display = '';
}

async function approveCustomer(id) {
  try {
    await api(`/api/admin/customers/${id}/approve`, { method: 'PATCH' });
    showToast('Vendor approved.', 'success');
    await load();
  } catch (err) { showToast(err.message, 'error'); }
}

async function declineCustomer(id) {
  if (!confirm('Decline this registration?')) return;
  try {
    await api(`/api/admin/customers/${id}/decline`, { method: 'PATCH' });
    showToast('Registration declined.', 'success');
    await load();
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteCustomer(id) {
  if (!confirm('Delete this vendor account? Their commission-payment history will be wiped. Bookings are kept.')) return;
  try {
    const res = await api(`/api/admin/customers/${id}`, { method: 'DELETE' });
    const removed = res && res.removedPayments ? ` · ${res.removedPayments} payment record(s) removed` : '';
    showToast(`Vendor removed${removed}.`, 'success');
    await load();
    await loadPaymentHistory();
  } catch (err) { showToast(err.message, 'error'); }
}

async function updateCommission(id, value) {
  const pct = Number(value);
  if (Number.isNaN(pct) || pct < 0 || pct > 100) {
    showToast('Commission must be between 0 and 100.', 'error');
    return load();
  }
  try {
    await api(`/api/admin/customers/${id}/commission`, {
      method: 'PATCH',
      body: JSON.stringify({ commissionPercent: pct }),
    });
    showToast('Commission updated.', 'success');
    await load();
  } catch (err) { showToast(err.message, 'error'); }
}

/* ─── Reset Vendor Password ─────────────────────────────────────────────── */
function openResetPassword(id) {
  const v = CUSTOMERS.find(c => c.id === id);
  if (!v) return;
  document.getElementById('rp-id').value      = v.id;
  document.getElementById('rp-vendor').textContent = (v.companyName ? v.companyName + ' · ' : '') + v.name;
  document.getElementById('rp-password').value = '';
  document.getElementById('resetPwdForm').style.display = '';
  document.getElementById('rp-credsCard').style.display = 'none';
  document.getElementById('resetPwdModal').classList.add('open');
}

function closeResetPassword() {
  document.getElementById('resetPwdModal').classList.remove('open');
}

async function submitResetPassword(e) {
  e.preventDefault();
  const id  = document.getElementById('rp-id').value;
  const pwd = document.getElementById('rp-password').value;
  if (!pwd || pwd.length < 6) {
    showToast('Password must be at least 6 characters.', 'error');
    return;
  }
  try {
    const res = await api(`/api/admin/customers/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password: pwd }),
    });
    document.getElementById('resetPwdForm').style.display = 'none';
    const card = document.getElementById('rp-credsCard');
    card.style.display = '';
    document.getElementById('rp-credsEmail').textContent    = `Email: ${res.credentials.email}`;
    document.getElementById('rp-credsPassword').textContent = `Password: ${res.credentials.password}`;
    document.getElementById('rp-credsLoginUrl').textContent = `Login: ${location.origin}${res.credentials.loginUrl}`;
    showToast('Password reset. Share the credentials with the vendor.', 'success');
    await load();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function copyText(elId) {
  try {
    await navigator.clipboard.writeText(document.getElementById(elId).textContent);
    showToast('Copied!', 'success');
  } catch {
    showToast('Copy failed — please copy manually.', 'error');
  }
}

/* ─── Edit Vendor (POCs, company, tier override, etc.) ─────────────────── */
function openEditVendor(id) {
  const v = CUSTOMERS.find(c => c.id === id);
  if (!v) return;
  document.getElementById('ev-id').value      = v.id;
  document.getElementById('ev-name').value    = v.name || '';
  document.getElementById('ev-company').value = v.companyName || '';
  document.getElementById('ev-phone').value   = v.phone || '';
  document.getElementById('ev-tier').value    = v.tierOverride || '';

  const list = document.getElementById('ev-pocsList');
  list.innerHTML = '';
  (v.pocs || []).forEach(p => addEvPocInput(p));

  document.getElementById('editVendorModal').classList.add('open');
}

function closeEditVendor() {
  document.getElementById('editVendorModal').classList.remove('open');
}

function addEvPocInput(value) {
  const list = document.getElementById('ev-pocsList');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'poc-row';
  row.innerHTML = `
    <input type="text" class="poc-input" placeholder="Full name" />
    <button type="button" class="poc-remove" title="Remove" onclick="this.parentElement.remove()">
      <i class="fas fa-times"></i>
    </button>
  `;
  list.appendChild(row);
  if (typeof value === 'string') row.querySelector('input').value = value;
  if (!value) row.querySelector('input').focus();
}

async function submitEditVendor(e) {
  e.preventDefault();
  const id = document.getElementById('ev-id').value;
  const company = document.getElementById('ev-company').value.trim();
  if (!company) { showToast('Company name is required.', 'error'); return; }

  const pocs = Array.from(document.querySelectorAll('#ev-pocsList .poc-input'))
    .map(el => el.value.trim()).filter(Boolean);

  try {
    await api(`/api/admin/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name:         document.getElementById('ev-name').value.trim(),
        companyName:  company,
        phone:        document.getElementById('ev-phone').value.trim(),
        tierOverride: document.getElementById('ev-tier').value || null,
        pocs,
      }),
    });
    showToast('Vendor updated.', 'success');
    closeEditVendor();
    await load();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ─── POC inputs (multiple full names per company) ──────────────────────── */
function addPocInput(value) {
  const list = document.getElementById('m-pocsList');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'poc-row';
  row.innerHTML = `
    <input type="text" class="poc-input" placeholder="Full name" />
    <button type="button" class="poc-remove" title="Remove" onclick="this.parentElement.remove()">
      <i class="fas fa-times"></i>
    </button>
  `;
  list.appendChild(row);
  if (typeof value === 'string') row.querySelector('input').value = value;
  row.querySelector('input').focus();
}

function collectPocs() {
  return Array.from(document.querySelectorAll('#m-pocsList .poc-input'))
    .map(el => el.value.trim())
    .filter(Boolean);
}

function clearPocInputs() {
  document.getElementById('m-pocsList').innerHTML = '';
}

async function submitManual(e) {
  e.preventDefault();
  const payload = {
    name:              document.getElementById('m-name').value.trim(),
    email:             document.getElementById('m-email').value.trim(),
    phone:             document.getElementById('m-phone').value.trim(),
    companyName:       document.getElementById('m-company').value.trim(),
    commissionPercent: Number(document.getElementById('m-commission').value) || 0,
    password:          document.getElementById('m-password').value,
    tierOverride:      document.getElementById('m-tier').value || null,
    pocs:              collectPocs(),
  };
  try {
    const res = await api('/api/admin/customers/manual', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Vendor created.', 'success');
    showCredentials(res.credentials, res.customer);
    document.getElementById('manualForm').reset();
    document.getElementById('m-commission').value = 0;
    document.getElementById('m-tier').value = '';
    clearPocInputs();
    await load();
  } catch (err) { showToast(err.message, 'error'); }
}

function showCredentials(creds, customer) {
  const card = document.getElementById('credsCard');
  card.style.display = '';
  document.getElementById('credsEmail').textContent    = `Email: ${creds.email}`;
  document.getElementById('credsPassword').textContent = `Password: ${creds.password}`;
  const fullUrl = location.origin + creds.loginUrl;
  document.getElementById('credsLoginUrl').textContent = `Login: ${fullUrl}`;
  document.getElementById('credsMessage').textContent =
    `Hi ${customer.name},\n\n` +
    `Your AJ Vendor Portal account is ready.\n\n` +
    `• Login URL: ${fullUrl}\n` +
    `• Email: ${creds.email}\n` +
    `• Password: ${creds.password}\n\n` +
    `Sign in to track your bookings, loyalty tier and commission.`;
}

async function copyCreds(id) {
  const text = document.getElementById(id).textContent;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied!', 'success');
  } catch {
    showToast('Copy failed — please copy manually.', 'error');
  }
}

function formatDate(s) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return s; }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (type || '');
  setTimeout(() => t.classList.remove('show'), 2800);
}

document.addEventListener('DOMContentLoaded', () => {
  loadHeaderUser();
  load();
});
