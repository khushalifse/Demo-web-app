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
    if (!me.loggedIn) { location.href = '/admin-login'; return; }
    document.getElementById('userName').textContent = me.user.name;
    if (me.user.picture) {
      document.getElementById('userAvatar').innerHTML =
        `<img src="${me.user.picture}" alt="avatar" style="width:30px;height:30px;border-radius:50%;object-fit:cover">`;
    }
  } catch {
    location.href = '/admin-login';
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  location.href = '/admin-login';
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

  // Default the date to today and block past dates — business entries are
  // logged for upcoming or just-happened events; past-dating opens the door
  // to backdated tier manipulation, which we don't want.
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('lb-date');
  if (dateInput) {
    dateInput.min = today;
    if (!dateInput.value) dateInput.value = today;
  }
  const endInput = document.getElementById('lb-endDate');
  if (endInput) endInput.min = today;
  syncEndDateMin();
}

// Inline copy of the tier ladder + helpers — kept in sync with the server.
// Used by the Log Business Entry preview to show banded commission and the
// "currently X → upgrading to Y" teaser.
const PREVIEW_TIERS = [
  { name: 'Bronze',   threshold: 0,       discountPercent: 5    },
  { name: 'Silver',   threshold: 1000000, discountPercent: 7.5  },
  { name: 'Gold',     threshold: 2500000, discountPercent: 10   },
  { name: 'Platinum', threshold: 5000000, discountPercent: 15   },
];
function previewFloorCredit(tierOverrideName) {
  if (!tierOverrideName) return 0;
  const floor = PREVIEW_TIERS.find(t => t.name.toLowerCase() === String(tierOverrideName).toLowerCase());
  return floor ? floor.threshold : 0;
}
function previewBandedCommission(cumulativeBefore, amount) {
  const after = cumulativeBefore + amount;
  let commission = 0;
  const breakdown = [];
  for (let i = 0; i < PREVIEW_TIERS.length; i++) {
    const t = PREVIEW_TIERS[i];
    const bandStart = t.threshold;
    const bandEnd   = (i + 1 < PREVIEW_TIERS.length) ? PREVIEW_TIERS[i + 1].threshold : Infinity;
    const overlap = Math.max(0, Math.min(bandEnd, after) - Math.max(bandStart, cumulativeBefore));
    if (overlap > 0) {
      const seg = Math.round(overlap * t.discountPercent / 100);
      commission += seg;
      breakdown.push({ tier: t.name, rate: t.discountPercent, amount: overlap, commission: seg });
    }
  }
  return { commission, breakdown };
}
// Find the tier a vendor will be on after adding `addAmount` of business.
function projectTier(currentBusiness, addAmount, tierOverrideName) {
  const effective = (Number(currentBusiness) || 0) + (Number(addAmount) || 0) + previewFloorCredit(tierOverrideName);
  let projected = PREVIEW_TIERS[0];
  for (const t of PREVIEW_TIERS) if (effective >= t.threshold) projected = t;
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

// When the start date changes, force the end date to be on or after it
// (and never before today either, even if the start date somehow was).
function syncEndDateMin() {
  const start = document.getElementById('lb-date').value;
  const endEl = document.getElementById('lb-endDate');
  if (!endEl) return;
  const today = new Date().toISOString().split('T')[0];
  endEl.min = (start && start > today) ? start : today;
  if (endEl.value && endEl.value < endEl.min) {
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

  // Banded commission preview: walk the booking through whatever tier bands
  // it crosses, summing each overlap × that band's rate.
  const cumulativeBefore = (Number(v.businessGross) || 0) + previewFloorCredit(v.tierOverride);
  const banded = direct
    ? { commission: 0, breakdown: [] }
    : previewBandedCommission(cumulativeBefore, amount);
  document.getElementById('lbp-commission').textContent = fmtINR(banded.commission);

  // Show the per-band breakdown only when the booking actually crosses a
  // boundary (otherwise it's just "₹30L @ 10%" — same info as the row above).
  const bdEl = document.getElementById('lbp-breakdown');
  if (!direct && banded.breakdown.length > 1 && amount > 0) {
    bdEl.style.display = '';
    bdEl.textContent = banded.breakdown
      .map(seg => `${fmtINR(seg.amount)} @ ${seg.rate}%`)
      .join('  +  ') + `  =  ${fmtINR(banded.commission)}`;
  } else {
    bdEl.style.display = 'none';
  }

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

  const projected = projectTier(v.businessGross, amount, v.tierOverride);
  if (projected.name !== currentTier && amount > 0) {
    upliftBox.style.display = '';
    upliftBox.innerHTML =
      '<i class="fas fa-rocket"></i> Currently <strong>' + currentTier + ' (' + currentRate + '%)</strong>' +
      ' — will upgrade to <strong id="lbp-newTier">' + projected.name + ' (' + projected.discountPercent + '%)</strong>' +
      ' after this entry.';
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
  const today = new Date().toISOString().split('T')[0];
  if (date < today)    { showToast('Event start date cannot be in the past.', 'error'); return; }
  if (endDate && endDate < today) { showToast('Event end date cannot be in the past.', 'error'); return; }
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
  const ok = await customConfirm({
    title: 'Delete payment record?',
    message: "This will remove the commission payment from the vendor's history.",
    confirmText: 'Delete',
    danger: true,
  });
  if (!ok) return;
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
        const resetReq = c.passwordResetRequested
          ? `<span class="status-badge" style="background:var(--danger-bg);color:var(--danger);font-size:0.65rem;margin-left:6px" title="Vendor requested a password reset on ${formatPayDate((c.passwordResetRequestedAt || '').slice(0,10))} — issue a new password from the key icon."><i class="fas fa-key"></i> reset requested</span>`
          : '';
        const isExpanded = EXPANDED_VENDOR_ID === c.id;
        const caret = isExpanded ? '<i class="fas fa-chevron-up" style="font-size:0.65rem;margin-left:4px"></i>'
                                 : '<i class="fas fa-chevron-down" style="font-size:0.65rem;margin-left:4px"></i>';
        const detailRow = isExpanded ? entriesRowHTML(c.id) : '';
        return `
          <tr${isExpanded ? ' class="row-expanded"' : ''}>
            <td data-label="Name & Email">
              <div class="client-name">${escapeHtml(c.name)} ${pwdBadge}${mustChange}${resetReq}</div>
              <div style="font-size:0.78rem;color:var(--text-2);margin-top:2px">${escapeHtml(c.email)}</div>
            </td>
            <td data-label="Company">${escapeHtml(c.companyName || '—')}</td>
            <td data-label="POCs">${pocCell}</td>
            <td data-label="Tier"><span class="tier-pill tier-${tierCls}"><i class="fas fa-medal"></i> ${tierName} <span style="opacity:0.75">(${tierRate}%)</span></span>${overrideHint}</td>
            <td data-label="Bookings" style="text-align:right">
              <button type="button" class="link-amount" title="View / edit entries" onclick="openBusinessEntries('${c.id}')">
                ${c.bookingsCount || 0}${caret}
              </button>
            </td>
            <td data-label="Business (net)" style="text-align:right">
              <button type="button" class="link-amount" title="View / edit entries" onclick="openBusinessEntries('${c.id}')">
                ${fmtINR(c.businessGross || 0)}
              </button>
            </td>
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
          </tr>${detailRow}`;
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
  const ok = await customConfirm({
    title: 'Decline this registration?',
    message: "The vendor will not be able to log in. You can re-approve them later.",
    confirmText: 'Decline',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/admin/customers/${id}/decline`, { method: 'PATCH' });
    showToast('Registration declined.', 'success');
    await load();
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteCustomer(id) {
  const ok = await customConfirm({
    title: 'Delete vendor account?',
    message: "Their commission-payment history will be wiped. Bookings are kept.",
    confirmText: 'Delete vendor',
    danger: true,
  });
  if (!ok) return;
  try {
    const res = await api(`/api/admin/customers/${id}`, { method: 'DELETE' });
    const removed = res && res.removedPayments ? ` · ${res.removedPayments} payment record(s) removed` : '';
    showToast(`Vendor removed${removed}.`, 'success');
    await load();
    await loadPaymentHistory();
  } catch (err) { showToast(err.message, 'error'); }
}

// Column order shared between Excel export and import. Keep this list as the
// single source of truth so re-importing an exported file just works. Password
// is intentionally blank in exports (we don't expose bcrypt hashes) and is only
// required when creating new vendors via Import.
const EXCEL_COLUMNS = [
  'Owner Name', 'Email', 'Phone', 'Company / Organisation',
  'Password (new vendors only)', 'Initial Tier',
  'POCs (semicolon-separated)', 'Status', 'Commission %', 'Created',
];

/* ─── Reusable confirm modal (replaces native window.confirm) ─────────── */
let _confirmResolver = null;

function customConfirm({ title, message, confirmText, cancelText, danger } = {}) {
  return new Promise((resolve) => {
    _confirmResolver = resolve;
    document.getElementById('confirm-title').innerHTML =
      (danger ? '<i class="fas fa-triangle-exclamation" style="color:var(--danger)"></i> '
              : '<i class="fas fa-circle-question"></i> ') +
      (title || 'Are you sure?');
    document.getElementById('confirm-message').textContent = message || '';
    const okBtn = document.getElementById('confirm-ok');
    okBtn.textContent = confirmText || 'Confirm';
    okBtn.className   = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    document.getElementById('confirm-cancel').textContent = cancelText || 'Cancel';
    document.getElementById('confirmModal').classList.add('open');
  });
}

function resolveConfirm(answer) {
  document.getElementById('confirmModal').classList.remove('open');
  const fn = _confirmResolver;
  _confirmResolver = null;
  if (fn) fn(answer);
}

/* ─── Business Entries (inline expandable row under each vendor) ──────── */
let EXPANDED_VENDOR_ID = null;

function openBusinessEntries(vendorId) {
  // Toggle: click the same vendor's link again to collapse.
  EXPANDED_VENDOR_ID = (EXPANDED_VENDOR_ID === vendorId) ? null : vendorId;
  render();
}

function entriesRowHTML(vendorId) {
  const v = CUSTOMERS.find(c => c.id === vendorId);
  const list = (v && Array.isArray(v.entries)) ? v.entries : [];
  if (!list.length) {
    return `<tr class="entries-row"><td colspan="8" class="entries-cell">
      <div class="entries-wrap"><div class="empty-row">No entries logged yet for this vendor.</div></div>
    </td></tr>`;
  }
  const rows = list.map(e => {
    const dateLabel = formatPayDate(e.eventDate) + (e.eventDateTo ? ' → ' + formatPayDate(e.eventDateTo) : '');
    const directBadge = e.directByClient
      ? '<span class="source-pill self">Direct</span>'
      : '<span style="color:var(--text-3)">—</span>';
    const client = e.clientName ? escapeHtml(e.clientName) : '<span style="color:var(--text-3)">—</span>';
    const desc   = e.eventType  ? escapeHtml(e.eventType)  : '<span style="color:var(--text-3)">—</span>';
    const tierTag = e.tierOverride
      ? `<span class="status-badge" style="background:var(--accent-glow);color:var(--accent);font-size:0.65rem;margin-left:6px" title="Commission pinned to ${escapeHtml(e.tierOverride)} by admin"><i class="fas fa-thumbtack"></i> ${escapeHtml(e.tierOverride)}</span>`
      : '';
    return `
      <tr>
        <td>${escapeHtml(dateLabel)}</td>
        <td>${client}</td>
        <td>${desc}${tierTag}</td>
        <td style="text-align:center">${directBadge}</td>
        <td style="text-align:right"><span class="price-text">${fmtINR(e.netAmount)}</span></td>
        <td>
          <div class="actions-cell" style="justify-content:center">
            <button class="btn-icon edit" title="Edit entry" onclick="openEditEntry('${vendorId}', '${e.id}')">
              <i class="fas fa-pen"></i>
            </button>
            <button class="btn-icon delete" title="Delete entry" onclick="deleteBusinessEntry('${vendorId}', '${e.id}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
  return `<tr class="entries-row"><td colspan="8" class="entries-cell">
    <div class="entries-wrap">
      <div class="entries-title"><i class="fas fa-list"></i> Business Entries</div>
      <table class="table table-inner">
        <thead>
          <tr>
            <th>Date</th>
            <th>Client</th>
            <th>Description</th>
            <th style="text-align:center">Direct?</th>
            <th style="text-align:right">Amount (₹)</th>
            <th style="text-align:center">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </td></tr>`;
}

function openEditEntry(vendorId, bookingId) {
  const v = CUSTOMERS.find(c => c.id === vendorId);
  const e = v && v.entries && v.entries.find(x => x.id === bookingId);
  if (!e) { showToast('Entry not found — try refreshing.', 'error'); return; }
  document.getElementById('ee-vendorId').value  = vendorId;
  document.getElementById('ee-bookingId').value = bookingId;
  document.getElementById('ee-date').value      = e.eventDate || '';
  document.getElementById('ee-dateTo').value    = e.eventDateTo || '';
  document.getElementById('ee-amount').value    = e.netAmount || 0;
  document.getElementById('ee-client').value    = e.clientName || '';
  document.getElementById('ee-desc').value      = e.eventType || '';
  document.getElementById('ee-direct').value    = e.directByClient ? 'yes' : 'no';
  document.getElementById('ee-tier').value      = e.tierOverride || '';
  document.getElementById('editEntryModal').classList.add('open');
}

function closeEditEntry() {
  document.getElementById('editEntryModal').classList.remove('open');
}

async function submitEditEntry(ev) {
  ev.preventDefault();
  const vendorId  = document.getElementById('ee-vendorId').value;
  const bookingId = document.getElementById('ee-bookingId').value;
  const amount    = Number(document.getElementById('ee-amount').value);
  const date      = document.getElementById('ee-date').value;
  const dateTo    = document.getElementById('ee-dateTo').value;
  const client    = document.getElementById('ee-client').value.trim();
  const desc      = document.getElementById('ee-desc').value.trim();
  const direct    = document.getElementById('ee-direct').value === 'yes';
  const tier      = document.getElementById('ee-tier').value || null;

  if (!date)            { showToast('Event start date is required.', 'error'); return; }
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast('Amount must be greater than zero.', 'error'); return;
  }
  if (dateTo && dateTo < date) {
    showToast("End date can't be earlier than the start date.", 'error'); return;
  }
  try {
    await api(`/api/admin/customers/${vendorId}/business-entry/${bookingId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        netAmount:      amount,
        eventDate:      date,
        eventDateTo:    dateTo || null,
        clientName:     client,
        description:    desc,
        directByClient: direct,
        tierOverride:   tier,
      }),
    });
    showToast('Entry updated. Commission recomputed.', 'success');
    closeEditEntry();
    await load();
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteBusinessEntry(vendorId, bookingId) {
  const ok = await customConfirm({
    title: 'Delete business entry?',
    message: "This will permanently remove the entry and recompute the vendor's tier and commission.",
    confirmText: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/admin/customers/${vendorId}/business-entry/${bookingId}`, { method: 'DELETE' });
    showToast('Entry deleted.', 'success');
    await load();
  } catch (err) { showToast(err.message, 'error'); }
}

async function wipeTestData() {
  const ok = await customConfirm({
    title:       'Wipe ALL vendors and bookings?',
    message:     'This permanently deletes every vendor account, every business entry, every commission payment, and every loyalty record. Your super-admin login and the tier ladder are kept. This cannot be undone.',
    confirmText: 'Yes, wipe everything',
    danger:      true,
  });
  if (!ok) return;
  try {
    const res = await api('/api/admin/customers/wipe-test-data', { method: 'POST' });
    const parts = Object.entries(res.removed || {})
      .filter(([, n]) => n > 0)
      .map(([file, n]) => `${file.replace('.json', '')}: ${n}`)
      .join(' · ');
    showToast(parts ? `Cleared ${res.totalRows} rows · ${parts}` : 'Already empty — nothing to clear.', 'success');
    await load();
  } catch (err) { showToast(err.message, 'error'); }
}

function downloadSampleExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Excel library failed to load — check your internet connection.', 'error');
    return;
  }
  // Two example rows so admins can see both a fully-specified vendor and a
  // minimal one. They can delete these, fill their own rows, and re-import.
  const sample = [
    {
      'Owner Name':                  'Asha Patel',
      'Email':                       'asha@example.com',
      'Phone':                       '9876543210',
      'Company / Organisation':      'Patel Events',
      'Password (new vendors only)': 'TempPass@123',
      'Initial Tier':                'Gold',
      'POCs (semicolon-separated)':  'Asha Patel; Riya Patel',
      'Status':                      '',
      'Commission %':                '',
      'Created':                     '',
    },
    {
      'Owner Name':                  'Ravi Kumar',
      'Email':                       'ravi@example.com',
      'Phone':                       '',
      'Company / Organisation':      'Kumar Productions',
      'Password (new vendors only)': 'WelcomeRavi1',
      'Initial Tier':                '',
      'POCs (semicolon-separated)':  '',
      'Status':                      '',
      'Commission %':                '',
      'Created':                     '',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sample, { header: EXCEL_COLUMNS });
  ws['!cols'] = [{ wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 26 }, { wch: 24 }, { wch: 14 }, { wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];

  // Inline guide on a second sheet so admins know which fields matter.
  const guide = [
    ['Field', 'Required?', 'Notes'],
    ['Owner Name', 'Yes', 'Full name of the vendor contact'],
    ['Email', 'Yes', 'Must be unique. Used as login.'],
    ['Phone', 'No', '10-digit mobile (or any free text)'],
    ['Company / Organisation', 'Yes', 'Company name displayed in the admin'],
    ['Password (new vendors only)', 'Yes', 'Min 6 chars. Vendor will be forced to change on first login.'],
    ['Initial Tier', 'No', 'Bronze, Silver, Gold or Platinum. Leave blank for auto (Bronze).'],
    ['POCs (semicolon-separated)', 'No', 'Multiple names separated by ";". Example: Asha; Riya'],
    ['Status', '—', 'Read-only on export. Ignored on import.'],
    ['Commission %', '—', 'Read-only on export. Ignored on import.'],
    ['Created', '—', 'Read-only on export. Ignored on import.'],
    ['', '', ''],
    ['Behaviour', '', ''],
    ['Existing email', '', 'Row is skipped — never overwrites an existing vendor.'],
    ['Invalid row', '', 'Reported back as "Row N: <reason>" so you can fix the sheet.'],
  ];
  const wsGuide = XLSX.utils.aoa_to_sheet(guide);
  wsGuide['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 60 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vendors');
  XLSX.utils.book_append_sheet(wb, wsGuide, 'Guide');
  XLSX.writeFile(wb, 'vendors-sample-template.xlsx');
  showToast('Sample template downloaded — fill it in and use "Import Excel".', 'success');
}

function exportVendorsExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Excel library failed to load — check your internet connection.', 'error');
    return;
  }
  const data = (CUSTOMERS || []).map(c => ({
    'Owner Name':                  c.name || '',
    'Email':                       c.email || '',
    'Phone':                       c.phone || '',
    'Company / Organisation':      c.companyName || '',
    'Password (new vendors only)': '',
    'Initial Tier':                c.tierOverride || '',
    'POCs (semicolon-separated)':  (c.pocs || []).join('; '),
    'Status':                      c.status || '',
    'Commission %':                Number(c.commissionPercent) || 0,
    'Created':                     c.createdAt ? new Date(c.createdAt).toISOString().split('T')[0] : '',
  }));
  const ws = XLSX.utils.json_to_sheet(data, { header: EXCEL_COLUMNS });
  ws['!cols'] = [{ wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 26 }, { wch: 24 }, { wch: 14 }, { wch: 32 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vendors');
  const stamp = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `vendors-export-${stamp}.xlsx`);
  showToast(`Exported ${data.length} vendor row(s).`, 'success');
}

async function importVendorsExcel(ev) {
  const input = ev.target;
  const file  = input.files && input.files[0];
  input.value = ''; // allow re-uploading the same filename later
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    showToast('Excel library failed to load — check your internet connection.', 'error');
    return;
  }

  let sheetRows;
  try {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    sheetRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  } catch {
    showToast('Could not read that file as an Excel / CSV sheet.', 'error');
    return;
  }
  if (!sheetRows.length) { showToast('The sheet is empty.', 'error'); return; }

  // Map sheet headers (tolerant of small variations) → API row fields.
  const rows = sheetRows.map(r => {
    const get = (...keys) => {
      for (const k of keys) {
        const hit = Object.keys(r).find(h => h.toLowerCase().trim() === k.toLowerCase());
        if (hit && r[hit] !== '' && r[hit] != null) return String(r[hit]);
      }
      return '';
    };
    return {
      name:         get('Owner Name', 'Name'),
      email:        get('Email'),
      phone:        get('Phone'),
      companyName:  get('Company / Organisation', 'Company'),
      password:     get('Password (new vendors only)', 'Password'),
      tierOverride: get('Initial Tier', 'Tier'),
      pocs:         get('POCs (semicolon-separated)', 'POCs'),
    };
  });

  const ok = await customConfirm({
    title: `Import ${rows.length} vendor row(s)?`,
    message: "New vendors will be created. Rows whose email already exists in the system will be skipped.",
    confirmText: 'Import',
  });
  if (!ok) return;

  try {
    const res = await api('/api/admin/customers/bulk-create', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
    const parts = [`${res.imported} created`];
    if (res.skipped) parts.push(`${res.skipped} skipped (email exists)`);
    if (res.errors && res.errors.length) {
      parts.push(`${res.errors.length} error(s)`);
      console.warn('Vendor import errors:', res.errors);
    }
    showToast(parts.join(' · '), res.imported > 0 ? 'success' : 'error');
    if (res.errors && res.errors.length) {
      // Surface the first few errors so the admin can fix the sheet.
      const detail = res.errors.slice(0, 5).map(e => `Row ${e.row}: ${e.reason}`).join('\n');
      alert(`Some rows didn't import:\n\n${detail}${res.errors.length > 5 ? `\n…and ${res.errors.length - 5} more (see console).` : ''}`);
    }
    await load();
  } catch (err) {
    showToast(err.message, 'error');
  }
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
    const rpEmail = document.getElementById('rp-credsEmail');
    const rpPwd   = document.getElementById('rp-credsPassword');
    const rpUrl   = document.getElementById('rp-credsLoginUrl');
    const rpFullUrl = `${location.origin}${res.credentials.loginUrl}`;
    rpEmail.textContent = `Email: ${res.credentials.email}`;     rpEmail.dataset.copy = res.credentials.email;
    rpPwd.textContent   = `Password: ${res.credentials.password}`; rpPwd.dataset.copy = res.credentials.password;
    rpUrl.textContent   = `Login: ${rpFullUrl}`;                  rpUrl.dataset.copy = rpFullUrl;
    showToast('Password reset. Share the credentials with the vendor.', 'success');
    await load();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function copyText(elId) {
  const el = document.getElementById(elId);
  const text = el?.dataset?.copy ?? el?.textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
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

// Track which vendor's credentials are currently shown — the WhatsApp button
// uses this to know which phone number to dial. Reset when the card is
// re-populated (e.g. after creating another vendor).
let CREDS_VENDOR_ID    = null;
let CREDS_VENDOR_PHONE = null;

function showCredentials(creds, customer) {
  const card = document.getElementById('credsCard');
  card.style.display = '';
  const fullUrl = location.origin + creds.loginUrl;
  const emailEl = document.getElementById('credsEmail');
  const pwdEl   = document.getElementById('credsPassword');
  const urlEl   = document.getElementById('credsLoginUrl');
  emailEl.textContent = `Email: ${creds.email}`;       emailEl.dataset.copy = creds.email;
  pwdEl.textContent   = `Password: ${creds.password}`; pwdEl.dataset.copy   = creds.password;
  urlEl.textContent   = `Login: ${fullUrl}`;           urlEl.dataset.copy   = fullUrl;
  document.getElementById('credsMessage').textContent =
    `Hi ${customer.name},\n\n` +
    `Your AJ Vendor Portal account is ready.\n\n` +
    `• Login URL: ${fullUrl}\n` +
    `• Email: ${creds.email}\n` +
    `• Password: ${creds.password}\n\n` +
    `Sign in to track your bookings, loyalty tier and commission.`;

  CREDS_VENDOR_ID    = customer.id;
  CREDS_VENDOR_PHONE = customer.phone || null;
  // Both the SMS and WhatsApp buttons need to know whether we have a phone on
  // file. Disable both with a tooltip explaining why when we don't.
  ['credsSmsBtn', 'credsWhatsappBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (!CREDS_VENDOR_PHONE) {
      btn.disabled = true;
      btn.title    = 'Vendor has no phone number on file — edit the vendor and try again.';
      btn.style.opacity = '0.55';
      btn.style.cursor  = 'not-allowed';
    } else {
      btn.disabled = false;
      btn.title    = `Send to ${CREDS_VENDOR_PHONE}`;
      btn.style.opacity = '';
      btn.style.cursor  = '';
    }
  });
}

async function sendCredsViaSms() {
  if (!CREDS_VENDOR_ID) { showToast('No vendor selected — create or reset a vendor first.', 'error'); return; }
  const message = document.getElementById('credsMessage').textContent || '';
  if (!message.trim()) { showToast('Nothing to send — credentials message is empty.', 'error'); return; }

  const ok = await customConfirm({
    title:       'Send credentials via SMS?',
    message:     `This will text ${CREDS_VENDOR_PHONE || 'the vendor'} the login details from your Twilio SMS number.`,
    confirmText: 'Send SMS',
  });
  if (!ok) return;

  const btn = document.getElementById('credsSmsBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await api(`/api/admin/customers/${CREDS_VENDOR_ID}/send-sms`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    showToast(`SMS sent to ${res.to || CREDS_VENDOR_PHONE}.`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function sendCredsViaWhatsapp() {
  if (!CREDS_VENDOR_ID) { showToast('No vendor selected — create or reset a vendor first.', 'error'); return; }
  const message = document.getElementById('credsMessage').textContent || '';
  if (!message.trim()) { showToast('Nothing to send — credentials message is empty.', 'error'); return; }

  const ok = await customConfirm({
    title:       'Send credentials via WhatsApp?',
    message:     `This will message ${CREDS_VENDOR_PHONE || 'the vendor'} from your business WhatsApp number with the login details.`,
    confirmText: 'Send now',
  });
  if (!ok) return;

  const btn = document.getElementById('credsWhatsappBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await api(`/api/admin/customers/${CREDS_VENDOR_ID}/send-whatsapp`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    showToast(`WhatsApp sent to ${res.to || CREDS_VENDOR_PHONE}.`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function copyCreds(id) {
  const el = document.getElementById(id);
  const text = el?.dataset?.copy ?? el?.textContent ?? '';
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
