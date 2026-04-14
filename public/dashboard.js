'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   DJ BookPro — Dashboard Module
   Reads bookings from localStorage (key: "djbookpro_bookings")
   Seeds sample data if the store is empty.
══════════════════════════════════════════════════════════════════════════ */

const LS_KEY  = 'djbookpro_bookings';
const GST_RATE = 0.18;

/* ══════════════════════════════════════════════════════════════════════════
   SAMPLE DATA  (seeded only when localStorage has no bookings)
══════════════════════════════════════════════════════════════════════════ */
const SAMPLE_BOOKINGS = [
  /* ── April 2026 ─────────────────────────────────────────────────────── */
  {
    id: 'bk-001', clientName: 'Priya & Vikram Singh', phone: '+91 98765 43210',
    eventDate: '2026-04-05', eventTime: '18:00',
    venue: 'The Grand Hyatt, Mumbai',
    eventType: 'Wedding',
    musicGenres: ['Bollywood', 'EDM', 'R&B'],
    equipment: ['CDJs', 'Mixer', 'PA Speakers', 'Lighting Rig'],
    totalPrice: 120000, depositAmount: 40000, depositPaid: true,
    paymentStatus: 'Partial', bookingStatus: 'Confirmed',
  },
  {
    id: 'bk-002', clientName: 'TechCorp India – Annual Gala', phone: '+91 22 4567 8900',
    eventDate: '2026-04-12', eventTime: '19:30',
    venue: 'Taj Lands End, Bandra',
    eventType: 'Corporate Event',
    musicGenres: ['Pop', 'House', 'Jazz'],
    equipment: ['DJ Controller', 'PA Speakers', 'Subwoofers', 'Microphone'],
    totalPrice: 75000, depositAmount: 88500, depositPaid: true,
    paymentStatus: 'Confirmed', bookingStatus: 'Confirmed',
  },
  {
    id: 'bk-003', clientName: 'Sunburn Pre-Party (Arjun Events)', phone: '+91 97654 32109',
    eventDate: '2026-04-18', eventTime: '22:00',
    venue: 'Blue Frog, Lower Parel',
    eventType: 'Festival',
    musicGenres: ['EDM', 'House', 'Techno'],
    equipment: ['CDJs', 'Mixer', 'Lighting Rig', 'Smoke Machine'],
    totalPrice: 60000, depositAmount: 0, depositPaid: false,
    paymentStatus: 'Pending', bookingStatus: 'Enquiry',
  },
  {
    id: 'bk-004', clientName: 'Rahul Sharma', phone: '+91 87654 32100',
    eventDate: '2026-04-20', eventTime: '20:00',
    venue: 'Trident Hotel, Nariman Point',
    eventType: 'Birthday Party',
    musicGenres: ['Hip-Hop', 'R&B', 'Pop'],
    equipment: ['DJ Controller', 'PA Speakers', 'LED Uplighting'],
    totalPrice: 30000, depositAmount: 35400, depositPaid: true,
    paymentStatus: 'Confirmed', bookingStatus: 'Confirmed',
  },
  {
    id: 'bk-005', clientName: 'Urban Club – Friday Residency', phone: '+91 22 2345 6789',
    eventDate: '2026-04-25', eventTime: '23:00',
    venue: 'Urban Club, Andheri West',
    eventType: 'Club Night',
    musicGenres: ['House', 'Techno', 'EDM'],
    equipment: ['CDJs', 'Mixer', 'Subwoofers'],
    totalPrice: 40000, depositAmount: 15000, depositPaid: true,
    paymentStatus: 'Partial', bookingStatus: 'Confirmed',
  },
  {
    id: 'bk-006', clientName: 'Karan Malhotra', phone: '+91 96543 21098',
    eventDate: '2026-04-28', eventTime: '19:00',
    venue: 'Sea Princess Hotel, Juhu',
    eventType: 'Private Party',
    musicGenres: ['Bollywood', 'Pop'],
    equipment: ['DJ Controller', 'PA Speakers', 'Microphone'],
    totalPrice: 55000, depositAmount: 0, depositPaid: false,
    paymentStatus: 'Pending', bookingStatus: 'Enquiry',
  },
  {
    id: 'bk-007', clientName: 'Deepa & Suresh Iyer', phone: '+91 98453 21076',
    eventDate: '2026-04-30', eventTime: '17:30',
    venue: 'ITC Grand Central, Parel',
    eventType: 'Anniversary',
    musicGenres: ['Jazz', 'Classical', 'Bollywood'],
    equipment: ['DJ Controller', 'PA Speakers', 'LED Uplighting', 'Projector'],
    totalPrice: 42000, depositAmount: 10000, depositPaid: true,
    paymentStatus: 'Partial', bookingStatus: 'Enquiry',
  },

  /* ── March 2026 ──────────────────────────────────────────────────────── */
  {
    id: 'bk-008', clientName: 'Sarah & Raj Kumar', phone: '+91 99887 76655',
    eventDate: '2026-03-08', eventTime: '17:00',
    venue: 'Sahara Star Hotel, Vile Parle',
    eventType: 'Wedding',
    musicGenres: ['Bollywood', 'Pop', 'R&B'],
    equipment: ['CDJs', 'Mixer', 'PA Speakers', 'Lighting Rig', 'Smoke Machine'],
    totalPrice: 85000, depositAmount: 100300, depositPaid: true,
    paymentStatus: 'Confirmed', bookingStatus: 'Completed',
  },
  {
    id: 'bk-009', clientName: 'Pulse Nightclub', phone: '+91 22 8899 1122',
    eventDate: '2026-03-14', eventTime: '22:30',
    venue: 'Pulse Nightclub, Worli',
    eventType: 'Club Night',
    musicGenres: ['EDM', 'Techno', 'House'],
    equipment: ['CDJs', 'Mixer', 'Lighting Rig'],
    totalPrice: 35000, depositAmount: 41300, depositPaid: true,
    paymentStatus: 'Confirmed', bookingStatus: 'Completed',
  },
  {
    id: 'bk-010', clientName: 'Aisha Patel', phone: '+91 94325 76543',
    eventDate: '2026-03-22', eventTime: '18:30',
    venue: 'The Leela, Andheri East',
    eventType: 'Birthday Party',
    musicGenres: ['Hip-Hop', 'R&B', 'Pop'],
    equipment: ['DJ Controller', 'PA Speakers', 'LED Uplighting'],
    totalPrice: 45000, depositAmount: 53100, depositPaid: true,
    paymentStatus: 'Confirmed', bookingStatus: 'Completed',
  },
  {
    id: 'bk-011', clientName: 'Nexus Events – Holi Bash', phone: '+91 22 6677 8899',
    eventDate: '2026-03-25', eventTime: '14:00',
    venue: 'NSCI Dome, Worli',
    eventType: 'Festival',
    musicGenres: ['Bollywood', 'EDM', 'Pop', 'Reggae'],
    equipment: ['CDJs', 'Mixer', 'PA Speakers', 'Subwoofers', 'Lighting Rig', 'Smoke Machine'],
    totalPrice: 95000, depositAmount: 112100, depositPaid: true,
    paymentStatus: 'Confirmed', bookingStatus: 'Completed',
  },

  /* ── May 2026 ────────────────────────────────────────────────────────── */
  {
    id: 'bk-012', clientName: 'Ananya & Dev Kapoor', phone: '+91 99001 23456',
    eventDate: '2026-05-10', eventTime: '17:00',
    venue: 'JW Marriott, Juhu',
    eventType: 'Wedding',
    musicGenres: ['Bollywood', 'Pop', 'EDM', 'R&B'],
    equipment: ['CDJs', 'Mixer', 'PA Speakers', 'Subwoofers', 'Lighting Rig', 'LED Uplighting'],
    totalPrice: 150000, depositAmount: 50000, depositPaid: true,
    paymentStatus: 'Partial', bookingStatus: 'Confirmed',
  },
  {
    id: 'bk-013', clientName: 'Nisha Gupta', phone: '+91 98700 12345',
    eventDate: '2026-05-15', eventTime: '19:00',
    venue: 'The Westin, Powai',
    eventType: 'Birthday Party',
    musicGenres: ['Pop', 'R&B'],
    equipment: ['DJ Controller', 'PA Speakers'],
    totalPrice: 28000, depositAmount: 0, depositPaid: false,
    paymentStatus: 'Pending', bookingStatus: 'Enquiry',
  },
  {
    id: 'bk-014', clientName: 'StartupFest Mumbai 2026', phone: '+91 22 3344 5566',
    eventDate: '2026-05-22', eventTime: '18:00',
    venue: 'NESCO Exhibition Centre, Goregaon',
    eventType: 'Corporate Event',
    musicGenres: ['EDM', 'House', 'Pop'],
    equipment: ['CDJs', 'Mixer', 'PA Speakers', 'Subwoofers', 'Lighting Rig', 'Microphone'],
    totalPrice: 90000, depositAmount: 30000, depositPaid: true,
    paymentStatus: 'Partial', bookingStatus: 'Confirmed',
  },
  {
    id: 'bk-015', clientName: 'Blaze Nightclub', phone: '+91 22 9988 7766',
    eventDate: '2026-05-30', eventTime: '23:00',
    venue: 'Blaze, Andheri East',
    eventType: 'Club Night',
    musicGenres: ['Techno', 'House'],
    equipment: ['CDJs', 'Mixer'],
    totalPrice: 38000, depositAmount: 0, depositPaid: false,
    paymentStatus: 'Pending', bookingStatus: 'Cancelled',
  },
  {
    id: 'bk-016', clientName: 'Meera & Arjun Desai', phone: '+91 95556 78901',
    eventDate: '2026-05-03', eventTime: '16:30',
    venue: 'Shangri-La, Mumbai',
    eventType: 'Wedding',
    musicGenres: ['Bollywood', 'Classical', 'Pop'],
    equipment: ['CDJs', 'Mixer', 'PA Speakers', 'Lighting Rig'],
    totalPrice: 110000, depositAmount: 110000 * 1.18, depositPaid: true,
    paymentStatus: 'Confirmed', bookingStatus: 'Confirmed',
  },
];

/* ══════════════════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════════════════ */
let allBookings = [];

/* ══════════════════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  seedIfEmpty();
  allBookings = loadBookings();
  setDefaultMonth();
  applyFilters();
});

function seedIfEmpty() {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (!stored || JSON.parse(stored).length === 0) {
      localStorage.setItem(LS_KEY, JSON.stringify(SAMPLE_BOOKINGS));
    }
  } catch {
    localStorage.setItem(LS_KEY, JSON.stringify(SAMPLE_BOOKINGS));
  }
}

function loadBookings() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || [];
  } catch {
    return [];
  }
}

function setDefaultMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('monthFilter').value = `${y}-${m}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   COMPUTED FIELDS
══════════════════════════════════════════════════════════════════════════ */
function calcGST(b) {
  return Math.round(b.totalPrice * GST_RATE * 100) / 100;
}

function calcPending(b) {
  const totalWithGST = b.totalPrice + calcGST(b);
  const paid = b.depositPaid ? (Number(b.depositAmount) || 0) : 0;
  return Math.max(0, totalWithGST - paid);
}

function resolvePaymentStatus(b) {
  // Use stored paymentStatus if available, otherwise derive
  if (b.paymentStatus) return b.paymentStatus;
  const pending = calcPending(b);
  if (pending <= 0) return 'Confirmed';
  if (b.depositPaid && Number(b.depositAmount) > 0) return 'Partial';
  return 'Pending';
}

/* ══════════════════════════════════════════════════════════════════════════
   FILTERING
══════════════════════════════════════════════════════════════════════════ */
function getFilteredBookings() {
  const monthVal = document.getElementById('monthFilter').value;      // "YYYY-MM" or ""
  const bsVal    = document.getElementById('bookingStatusFilter').value;
  const psVal    = document.getElementById('paymentStatusFilter').value;

  return allBookings.filter(b => {
    if (monthVal && b.eventDate.slice(0, 7) !== monthVal) return false;
    if (bsVal && b.bookingStatus !== bsVal)               return false;
    if (psVal && resolvePaymentStatus(b) !== psVal)       return false;
    return true;
  });
}

function applyFilters() {
  const filtered = getFilteredBookings();
  renderTable(filtered);
  updateSummaryCards(filtered);
  updateActiveFiltersPill();
}

function clearFilters() {
  setDefaultMonth();
  document.getElementById('bookingStatusFilter').value = '';
  document.getElementById('paymentStatusFilter').value = '';
  applyFilters();
}

function updateActiveFiltersPill() {
  const bsVal  = document.getElementById('bookingStatusFilter').value;
  const psVal  = document.getElementById('paymentStatusFilter').value;
  const count  = (bsVal ? 1 : 0) + (psVal ? 1 : 0);
  const pill   = document.getElementById('activeFiltersPill');
  const text   = document.getElementById('activeFiltersText');

  if (count > 0) {
    const parts = [];
    if (bsVal) parts.push(bsVal);
    if (psVal) parts.push(psVal);
    text.textContent = parts.join(', ');
    pill.style.display = 'inline-flex';
  } else {
    pill.style.display = 'none';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SUMMARY CARDS
══════════════════════════════════════════════════════════════════════════ */
function updateSummaryCards(filtered) {
  const monthVal = document.getElementById('monthFilter').value;

  const totalGigs   = filtered.length;
  const totalRev    = filtered.reduce((s, b) => s + b.totalPrice, 0);
  const totalGST    = filtered.reduce((s, b) => s + calcGST(b), 0);
  const totalPend   = filtered.reduce((s, b) => s + calcPending(b), 0);
  const totalDep    = filtered.reduce((s, b) => s + (b.depositPaid ? (Number(b.depositAmount) || 0) : 0), 0);

  document.getElementById('sc-gigs').textContent     = totalGigs;
  document.getElementById('sc-revenue').textContent  = formatCurrency(totalRev);
  document.getElementById('sc-gst').textContent      = formatCurrency(totalGST);
  document.getElementById('sc-pending').textContent  = formatCurrency(totalPend);
  document.getElementById('sc-deposits').textContent = formatCurrency(totalDep);

  const periodLabel = monthVal ? formatMonthLabel(monthVal) : 'All Time';
  ['sc-period-gigs', 'sc-period-rev', 'sc-period-dep'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = periodLabel;
  });
  const gstPeriod = document.getElementById('sc-period-gst');
  if (gstPeriod) gstPeriod.textContent = monthVal ? `18% · ${formatMonthLabel(monthVal)}` : '18% of Revenue';
  const pendPeriod = document.getElementById('sc-period-pend');
  if (pendPeriod) pendPeriod.textContent = totalPend > 0 ? 'Balance Due' : 'All Settled';
}

/* ══════════════════════════════════════════════════════════════════════════
   TABLE RENDERING
══════════════════════════════════════════════════════════════════════════ */
function renderTable(bookings) {
  const tbody    = document.getElementById('tableBody');
  const countEl  = document.getElementById('tableCount');
  const footerEl = document.getElementById('tableFooter');

  countEl.textContent = `${bookings.length} booking${bookings.length !== 1 ? 's' : ''}`;

  if (!bookings.length) {
    tbody.innerHTML = `<tr><td colspan="13" class="empty-cell">
      <i class="fas fa-calendar-times"></i>
      No bookings found for the selected filters.
    </td></tr>`;
    footerEl.innerHTML = '';
    return;
  }

  tbody.innerHTML = bookings.map((b, idx) => {
    const gst     = calcGST(b);
    const pending = calcPending(b);
    const payStat = resolvePaymentStatus(b);
    const genres  = Array.isArray(b.musicGenres) ? b.musicGenres : [];
    const equip   = Array.isArray(b.equipment)   ? b.equipment   : [];

    return `<tr>
      <td class="cell-num">${idx + 1}</td>
      <td class="cell-client">${esc(b.clientName)}</td>
      <td class="cell-date">${formatDate(b.eventDate)}</td>
      <td class="cell-venue" title="${esc(b.venue)}">${esc(b.venue)}</td>
      <td>${esc(b.eventType)}</td>
      <td>${renderTagList(genres, 2)}</td>
      <td>${renderTagList(equip, 2)}</td>
      <td class="text-right cell-price">${formatCurrency(b.totalPrice)}</td>
      <td class="text-right cell-gst">${formatCurrency(gst)}</td>
      <td class="text-center">${depositBadge(b.depositPaid)}</td>
      <td class="text-right ${pending === 0 ? 'cell-pending-zero' : 'cell-pending-nonzero'}">${formatCurrency(pending)}</td>
      <td>${paymentBadge(payStat)}</td>
      <td>${bookingBadge(b.bookingStatus)}</td>
    </tr>`;
  }).join('');

  // Footer totals row
  const sumRev  = bookings.reduce((s, b) => s + b.totalPrice, 0);
  const sumGST  = bookings.reduce((s, b) => s + calcGST(b), 0);
  const sumPend = bookings.reduce((s, b) => s + calcPending(b), 0);
  const sumDep  = bookings.reduce((s, b) => s + (b.depositPaid ? (Number(b.depositAmount) || 0) : 0), 0);

  footerEl.innerHTML =
    `Showing <strong>${bookings.length}</strong> of <strong>${allBookings.length}</strong> bookings` +
    ` &nbsp;·&nbsp; Revenue: <strong>${formatCurrency(sumRev)}</strong>` +
    ` &nbsp;·&nbsp; GST: <strong>${formatCurrency(sumGST)}</strong>` +
    ` &nbsp;·&nbsp; Deposits: <strong>${formatCurrency(sumDep)}</strong>` +
    ` &nbsp;·&nbsp; Pending: <strong>${formatCurrency(sumPend)}</strong>`;
}

/* ── Tag list renderer ── */
function renderTagList(arr, maxVisible) {
  if (!arr.length) return '<span style="color:var(--text-3)">—</span>';
  const visible = arr.slice(0, maxVisible);
  const extra   = arr.length - maxVisible;
  let html = '<div class="tag-list">';
  html += visible.map(t => `<span class="tag">${esc(t)}</span>`).join('');
  if (extra > 0) html += `<span class="tag-more">+${extra}</span>`;
  html += '</div>';
  return html;
}

/* ── Badge builders ── */
function depositBadge(paid) {
  return paid
    ? `<span class="dep-badge dep-yes"><i class="fas fa-check-circle"></i> Yes</span>`
    : `<span class="dep-badge dep-no"><i class="fas fa-times-circle"></i> No</span>`;
}

function paymentBadge(status) {
  const cls = { Confirmed: 'pay-confirmed', Partial: 'pay-partial', Pending: 'pay-pending' };
  return `<span class="badge ${cls[status] || 'pay-pending'}">${esc(status)}</span>`;
}

function bookingBadge(status) {
  const cls = {
    Enquiry:   'bs-enquiry',
    Confirmed: 'bs-confirmed',
    Completed: 'bs-completed',
    Cancelled: 'bs-cancelled',
    Pending:   'bs-pending',
  };
  return `<span class="badge ${cls[status] || 'bs-enquiry'}">${esc(status)}</span>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   EXPORT — shared data builder
══════════════════════════════════════════════════════════════════════════ */
function buildExportData() {
  const headers = [
    'Client Name',
    'Event Date',
    'Venue',
    'Event Type',
    'Music Genres',
    'Equipment',
    'Total Price (₹)',
    'GST 18% (₹)',
    'Deposit Paid',
    'Pending Amount (₹)',
    'Payment Status',
    'Booking Status',
  ];

  const rows = getFilteredBookings().map(b => [
    b.clientName,
    b.eventDate,
    b.venue,
    b.eventType,
    (Array.isArray(b.musicGenres) ? b.musicGenres : []).join(', '),
    (Array.isArray(b.equipment)   ? b.equipment   : []).join(', '),
    b.totalPrice,
    calcGST(b),
    b.depositPaid ? 'Yes' : 'No',
    calcPending(b),
    resolvePaymentStatus(b),
    b.bookingStatus,
  ]);

  return { headers, rows };
}

function exportTitle() {
  const monthVal = document.getElementById('monthFilter').value;
  return monthVal
    ? `DJ BookPro – Bookings: ${formatMonthLabel(monthVal)}`
    : 'DJ BookPro – All Bookings';
}

function exportFilename(ext) {
  const monthVal = document.getElementById('monthFilter').value;
  return `dj-bookings-${monthVal || 'all'}.${ext}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   EXPORT — PDF (jsPDF + autoTable)
══════════════════════════════════════════════════════════════════════════ */
function exportPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('PDF library not loaded yet — please try again in a moment.', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(124, 58, 237);
  doc.text(exportTitle(), 12, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  doc.text(`Generated on ${dateStr}`, 12, 22);

  const { headers, rows } = buildExportData();

  doc.autoTable({
    startY: 27,
    head: [headers],
    body: rows,
    styles: {
      fontSize: 6.8,
      cellPadding: 2.8,
      textColor: [30, 30, 50],
      lineColor: [220, 218, 235],
      lineWidth: 0.1,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [124, 58, 237],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: [248, 247, 255],
    },
    columnStyles: {
      6: { halign: 'right' },
      7: { halign: 'right' },
      9: { halign: 'right' },
    },
    margin: { left: 10, right: 10 },
    didDrawPage: (data) => {
      // Footer line
      const pageH = doc.internal.pageSize.getHeight();
      doc.setDrawColor(200, 195, 220);
      doc.line(10, pageH - 8, doc.internal.pageSize.getWidth() - 10, pageH - 8);
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 170);
      doc.text(`Page ${data.pageNumber}`, doc.internal.pageSize.getWidth() / 2, pageH - 4, { align: 'center' });
    },
  });

  // Summary totals below table
  const filtered = getFilteredBookings();
  const sumRev  = filtered.reduce((s, b) => s + b.totalPrice, 0);
  const sumGST  = filtered.reduce((s, b) => s + calcGST(b), 0);
  const sumPend = filtered.reduce((s, b) => s + calcPending(b), 0);
  const finalY  = (doc.lastAutoTable.finalY || 27) + 7;

  doc.setFontSize(7.5);
  doc.setTextColor(80, 70, 120);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `${filtered.length} Bookings  ·  Revenue: ₹${sumRev.toLocaleString('en-IN')}  ·  GST: ₹${sumGST.toLocaleString('en-IN')}  ·  Pending: ₹${sumPend.toLocaleString('en-IN')}`,
    12, finalY
  );

  doc.save(exportFilename('pdf'));
  showToast('PDF exported successfully.', 'success');
}

/* ══════════════════════════════════════════════════════════════════════════
   EXPORT — Excel (SheetJS / XLSX)
══════════════════════════════════════════════════════════════════════════ */
function exportExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Excel library not loaded yet — please try again.', 'error');
    return;
  }

  const { headers, rows } = buildExportData();
  const wb = XLSX.utils.book_new();
  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws['!cols'] = [
    { wch: 28 }, { wch: 13 }, { wch: 32 }, { wch: 18 },
    { wch: 26 }, { wch: 34 }, { wch: 14 }, { wch: 14 },
    { wch: 13 }, { wch: 17 }, { wch: 16 }, { wch: 16 },
  ];

  // Freeze header row
  ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2' }];

  XLSX.utils.book_append_sheet(wb, ws, 'Bookings');
  XLSX.writeFile(wb, exportFilename('xlsx'));
  showToast('Excel file exported successfully.', 'success');
}

/* ══════════════════════════════════════════════════════════════════════════
   EXPORT — CSV (plain JavaScript)
══════════════════════════════════════════════════════════════════════════ */
function exportCSV() {
  const { headers, rows } = buildExportData();
  const allRows = [headers, ...rows];

  const csv = allRows
    .map(row =>
      row.map(cell =>
        `"${String(cell == null ? '' : cell).replace(/"/g, '""')}"`
      ).join(',')
    )
    .join('\r\n');

  // UTF-8 BOM so Excel opens it with correct encoding
  const bom  = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href     = url;
  a.download = exportFilename('csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('CSV exported successfully.', 'success');
}

/* ══════════════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════════════ */
function formatCurrency(amount) {
  return '₹' + Math.round(Number(amount) || 0).toLocaleString('en-IN');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  const date = new Date(+y, +m - 1, +d);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatMonthLabel(monthVal) {
  if (!monthVal) return '';
  const [y, m] = monthVal.split('-');
  const date = new Date(+y, +m - 1, 1);
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Toast ── */
let toastTimer = null;
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3200);
}
