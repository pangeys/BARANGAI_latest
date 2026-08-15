/* ═══════════════════════════════════════════════════════
   BICTS — js/render.js
   All DOM render functions. No hardcoded data — reads
   from data.js constants and the live complaints[] store.
═══════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════ */
function renderAccuracyBars() {
  const el = document.getElementById('accuracy-bars');
  if (!el) return;
  el.innerHTML = MODEL_ACCURACY_BARS.map(({ label, value }) =>
    '<div style="margin-bottom:10px;">' +
    '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">' +
    '<span style="color:var(--text2);font-weight:500">' + label + '</span>' +
    '<span style="color:var(--blue);font-family:var(--mono);font-weight:600">' + value + '%</span>' +
    '</div><div class="progress"><div class="progress-fill" style="width:' + value + '%"></div></div></div>'
  ).join('');
}

function renderDashboardDonut() {
  const donutEl  = document.getElementById('dashboard-donut');
  const legendEl = document.getElementById('dashboard-legend');
  if (!donutEl || !legendEl) return;

  /* Use live complaints if any; fall back to dataset counts; fall back to real sample proportions */
  const counts = {};
  CATEGORIES.forEach(c => { counts[c] = 0; });

  if (complaints.length > 0) {
    complaints.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });
  } else if (datasetRows.length > 0) {
    datasetRows.forEach(r => {
      const m = mapToMergedCategory(r.category);
      if (m) counts[m]++;
    });
  } else {
    /* Final 3,669-record modeling distribution (Chapter 4 source). */
    DATASET_CONSOLIDATION.forEach(r => { counts[r.merged] = r.total; });
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  let conic = '', cum = 0;
  CATEGORIES.forEach(cat => {
    const pct = (counts[cat] / total) * 100;
    conic += CAT_COLORS[cat] + ' ' + cum.toFixed(2) + '% ' + (cum + pct).toFixed(2) + '%,';
    cum += pct;
  });
  donutEl.style.background = 'conic-gradient(' + conic.slice(0, -1) + ')';

  legendEl.innerHTML = CATEGORIES.map(cat => {
    const pct = Math.round((counts[cat] / total) * 100);
    return '<div class="legend-item">' +
      '<div class="legend-dot" style="background:' + CAT_COLORS[cat] + '"></div>' +
      cat.split(' / ')[0].split(' & ')[0] + ' (' + pct + '%)</div>';
  }).join('');
}

function renderCriticalCases() {
  const el = document.getElementById('critical-cases');
  if (!el) return;
  const critical = complaints.filter(c => c.priority === 'Critical' && c.status !== 'Resolved' && c.status !== 'Closed');
  if (critical.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No critical cases</div><div class="empty-desc">No complaints require immediate attention.</div></div>';
    return;
  }
  el.innerHTML =
    '<div class="alert alert-danger">🚨 <strong>' + critical.length + ' critical</strong> case' + (critical.length !== 1 ? 's' : '') + ' need immediate attention.</div>' +
    critical.map(c =>
      '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);">' +
      '<span style="font-family:var(--mono);font-size:10px;color:var(--text3)">' + c.id + '</span>' +
      '<span class="badge b-red">' + c.category + '</span>' +
      '<span style="margin-left:auto;font-family:var(--mono);font-size:11px;font-weight:700;color:var(--red)">' + c.score + '</span>' +
      '</div>'
    ).join('');
}

function renderDashboardStats() {
  const total    = complaints.length;
  const pending  = complaints.filter(c => c.status === 'Open').length;
  const resolved = complaints.filter(c => c.status === 'Resolved').length;

  const tEl = document.getElementById('stat-total');
  const pEl = document.getElementById('stat-pending');
  const rEl = document.getElementById('stat-resolved');
  if (tEl) tEl.textContent = total;
  if (pEl) pEl.textContent = pending;
  if (rEl) rEl.textContent = resolved;

  const recentBox = document.getElementById('dashboard-recent');
  if (!recentBox) return;
  if (complaints.length === 0) {
    recentBox.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No complaints yet</div><div class="empty-desc">Submitted complaints will appear here.</div></div>';
    return;
  }
  const rows = complaints.slice(0, 5).map(c => {
    const isFinished = c.status === 'Resolved' || c.status === 'Closed';
    const btn = !isFinished
      ? '<button class="btn btn-sm" style="background:var(--green);color:#fff;border:none;" onclick="resolveComplaint(\'' + c.id + '\')">✓ Resolve</button>'
      : '<span style="font-size:11px;color:' + (c.status === 'Closed' ? 'var(--text3)' : 'var(--green)') + ';font-weight:600;">' + (c.status === 'Closed' ? '⊘ Closed' : '✓ Resolved') + '</span>';
    return '<tr>' +
      '<td class="mono">' + c.id + '</td>' +
      '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + mask(c.description) + '</td>' +
      '<td><span class="badge b-blue">' + c.category + '</span></td>' +
      '<td><span class="badge ' + c.pb + '">' + c.priority + '</span></td>' +
      '<td><span class="badge ' + c.sb + '">' + c.status + '</span></td>' +
      '<td>' + btn + '</td></tr>';
  }).join('');
  recentBox.innerHTML =
    '<table class="tbl"><thead><tr><th>ID</th><th>Description</th><th>Category</th><th>Priority</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
}

/* ══════════════════════════════════════════════════════
   COMPLAINTS TABLE
══════════════════════════════════════════════════════ */
function renderComplaints() {
  const tbody = document.getElementById('complaints-tbody');
  if (!tbody) return;

  const sub = document.querySelector('#screen-complaints .page-sub');
  if (sub) sub.textContent = complaints.length + ' total record' + (complaints.length !== 1 ? 's' : '');

  const searchVal = (document.getElementById('complaint-search')?.value || '').toLowerCase();
  const catVal    = document.getElementById('cat-filter')?.value   || '';
  const priVal    = document.getElementById('pri-filter')?.value   || '';

  const filtered = complaints.filter(c => {
    if (_activeStatusFilter !== 'All' && c.status !== _activeStatusFilter) return false;
    if (catVal && c.category !== catVal) return false;
    if (priVal && c.priority !== priVal) return false;
    if (searchVal && !(c.id + c.description + c.category).toLowerCase().includes(searchVal)) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3);font-size:12px;">No complaints match the current filters.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const isFinished = c.status === 'Resolved' || c.status === 'Closed';
    const btn = !isFinished
      ? '<button class="btn btn-sm" style="background:var(--green);color:#fff;border:none;" onclick="resolveComplaint(\'' + c.id + '\')">✓ Resolve</button>'
      : '<span style="font-size:11px;color:' + (c.status === 'Closed' ? 'var(--text3)' : 'var(--green)') + ';font-weight:600;">' + (c.status === 'Closed' ? '⊘ Closed' : '✓ Resolved') + '</span>';
    return '<tr>' +
      '<td class="mono">' + c.id + '</td>' +
      '<td style="font-size:10px;color:var(--text3)">' + c.date + '</td>' +
      '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + mask(c.description) + '</td>' +
      '<td><span class="badge b-blue">' + c.category + '</span></td>' +
      '<td><span class="badge ' + c.pb + '" style="font-family:var(--mono)">' + c.score + ' – ' + c.priority + '</span></td>' +
      '<td style="font-size:11px">' + c.officer + '</td>' +
      '<td><span class="badge ' + c.sb + '">' + c.status + '</span></td>' +
      '<td>' + btn + '</td>' +
      '<td><button class="btn btn-ghost btn-sm" onclick="viewComplaint(\'' + c.id + '\')">View →</button></td>' +
      '</tr>';
  }).join('');
}

/* ══════════════════════════════════════════════════════
   PRIORITY QUEUE
══════════════════════════════════════════════════════ */
function renderPriorityQueue() {
  const tbody = document.getElementById('priority-tbody');
  if (!tbody) return;
  if (complaints.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text3);font-size:12px;">No complaints in queue.</td></tr>';
    return;
  }
  const sorted = [...complaints].sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
  tbody.innerHTML = sorted.map((c, i) => {
    const scoreColor = parseFloat(c.score) >= 70 ? 'var(--red)' : parseFloat(c.score) >= 42 ? 'var(--amber)' : 'var(--blue)';
    const ahp        = computeAHPScore(c.category, c.affected, c.description);
    const isFinished = c.status === 'Resolved' || c.status === 'Closed';
    const btn        = !isFinished
      ? '<button class="btn btn-sm" style="background:var(--green);color:#fff;border:none;" onclick="resolveComplaint(\'' + c.id + '\')">✓ Resolve</button>'
      : '<span style="font-size:11px;color:' + (c.status === 'Closed' ? 'var(--text3)' : 'var(--green)') + ';font-weight:600;">' + (c.status === 'Closed' ? '⊘ Closed' : '✓ Done') + '</span>';
    return '<tr>' +
      '<td style="font-weight:700;font-family:var(--mono);color:var(--text3)">#' + (i + 1) + '</td>' +
      '<td class="mono">' + c.id + '</td>' +
      '<td><span class="badge b-blue" style="font-size:9px;">' + c.category + '</span></td>' +
      '<td style="font-family:var(--mono);font-weight:700;color:' + scoreColor + '">' + c.score + '</td>' +
      '<td style="font-size:11px;font-family:var(--mono)">' + ahp.severity  + '</td>' +
      '<td style="font-size:11px;font-family:var(--mono)">' + ahp.urgency  + '</td>' +
      '<td style="font-size:11px;font-family:var(--mono)">' + ahp.frequency + '</td>' +
      '<td style="font-family:var(--mono);text-align:center">'              + c.affected + '</td>' +
      '<td style="font-size:11px">' + c.officer + '</td>' +
      '<td><span class="badge ' + c.sb + '">' + c.status + '</span></td>' +
      '<td>' + btn + '</td></tr>';
  }).join('');
}

/* ══════════════════════════════════════════════════════
   KANBAN BOARD
══════════════════════════════════════════════════════ */
function renderKanban() {
  const el = document.getElementById('kanban-board');
  if (!el) return;
  const COLS = [
    { status: 'Open',        label: 'Open',        color: '#8A9BB0', badge: 'b-gray'  },
    { status: 'In Progress', label: 'In Progress',  color: '#1E5FA8', badge: 'b-blue'  },
    { status: 'For Hearing', label: 'For Hearing',  color: '#B06000', badge: 'b-amber' },
    { status: 'Resolved',    label: 'Resolved',     color: '#1B7A4A', badge: 'b-green' },
    { status: 'Closed',      label: 'Closed',       color: '#8A9BB0', badge: 'b-gray'  },
  ];
  el.innerHTML = COLS.map(col => {
    const cards = complaints.filter(c => c.status === col.status);
    const curIdx = STATUS_FLOW.indexOf(col.status);
    const nextLabel = curIdx < STATUS_FLOW.length - 2 ? STATUS_FLOW[curIdx + 1] : null;

    const cardHTML = cards.length === 0
      ? '<div style="text-align:center;padding:22px 12px;color:var(--text3);font-size:11px;background:var(--bg);border-radius:var(--r);border:1px dashed var(--border);">No cases</div>'
      : cards.map(c => {
          const shortDesc = isViewer() ? '••••••' : (c.description.length > 60 ? c.description.slice(0, 60) + '…' : c.description);
          let actions = '';
          if (col.status !== 'Resolved' && col.status !== 'Closed') {
            actions += '<button class="btn btn-sm" style="background:var(--green);color:#fff;border:none;font-size:10px;padding:3px 8px;" onclick="resolveComplaint(\'' + c.id + '\')">✓ Resolve</button>';
            if (nextLabel) actions += '<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;" onclick="advanceStatus(\'' + c.id + '\')">→ ' + nextLabel + '</button>';
            actions = '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">' + actions + '</div>';
          } else if (col.status === 'Closed') {
            actions = '<div style="margin-top:6px;font-size:10px;color:var(--text3);">⊘ Closed' + (c.closeReason ? ' · ' + c.closeReason : '') + '</div>';
          } else {
            actions = '<div style="margin-top:6px;font-size:10px;color:var(--green);">✓ Resolved' + (c.resolvedAt ? ' · ' + c.resolvedAt : '') + '</div>';
          }
          return '<div class="kanban-card" style="border-left:3px solid ' + col.color + ';">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<span class="kanban-id">' + c.id + '</span>' +
            '<span class="badge ' + c.pb + '" style="font-size:9px;">' + c.priority + '</span>' +
            '</div><div class="kanban-desc">' + shortDesc + '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
            '<span class="badge b-blue" style="font-size:9px;">' + c.category + '</span>' +
            '<span style="font-size:9px;color:var(--text3);margin-left:auto;">' + c.date + '</span>' +
            '</div>' + actions + '</div>';
        }).join('');

    return '<div class="kanban-col">' +
      '<div class="kanban-col-header">' +
      '<div class="kanban-col-dot" style="background:' + col.color + '"></div>' +
      '<span class="kanban-col-title">' + col.label + '</span>' +
      '<span class="badge ' + col.badge + ' kanban-col-count">' + cards.length + '</span>' +
      '</div><div>' + cardHTML + '</div></div>';
  }).join('');
}

/* ══════════════════════════════════════════════════════
   AI RESULTS
══════════════════════════════════════════════════════ */
function renderDatasetVersionTable() {
  const tbody = document.getElementById('dataset-version-tbody');
  if (!tbody) return;
  tbody.innerHTML = DATASET_VERSIONS.map(row => {
    const best = Math.max(row.nb, row.svm, row.bi);
    const bestModel = row.svm === best ? 'SVM' : row.bi === best ? 'BiLSTM' : 'Naive Bayes';
    return '<tr' + (row.best ? ' style="background:var(--sky-light);"' : '') + '>' +
      '<td style="font-weight:600;font-size:12px">' + row.ver + (row.best ? ' ★' : '') + '</td>' +
      '<td style="font-family:var(--mono);font-size:11px">' + row.train.toLocaleString() + '</td>' +
      '<td style="font-family:var(--mono)">' + row.nb.toFixed(2) + '%</td>' +
      '<td style="font-family:var(--mono);font-weight:' + (row.svm === best ? '700' : '400') + ';color:' + (row.svm === best ? 'var(--blue)' : 'inherit') + '">' + row.svm.toFixed(2) + '%</td>' +
      '<td style="font-family:var(--mono)">' + row.bi.toFixed(2) + '%</td>' +
      '<td><span class="badge b-blue">' + bestModel + '</span></td></tr>';
  }).join('');
}

function renderModelComparison() {
  const el = document.getElementById('model-comparison-tbody');
  if (!el) return;
  el.innerHTML = MODEL_COMPARISON_V2.map(r =>
    '<tr><td style="font-weight:500;font-size:12px">' + r.metric + '</td>' +
    '<td style="font-family:var(--mono);color:var(--text3)">'  + r.nb  + '</td>' +
    '<td style="font-family:var(--mono);font-weight:700;color:var(--blue);background:var(--sky-light)">' + r.svm + '</td>' +
    '<td style="font-family:var(--mono)">' + r.bi + '</td></tr>'
  ).join('');
}

function renderF1Table() {
  const el = document.getElementById('f1-tbody');
  if (!el) return;
  el.innerHTML = PER_CATEGORY_REPORT.map(r =>
    '<tr><td style="font-size:11px">' + r.cat + '</td>' +
    '<td style="font-family:var(--mono);color:var(--green)">'   + r.prec + '</td>' +
    '<td style="font-family:var(--mono);color:var(--green)">'   + r.rec  + '</td>' +
    '<td style="font-family:var(--mono);font-weight:700;color:var(--blue)">' + r.f1 + '</td>' +
    '<td style="font-family:var(--mono);color:var(--text3)">'   + r.sup  + '</td></tr>'
  ).join('');
}

function renderNlpPipeline() {
  const el = document.getElementById('nlp-pipeline');
  if (!el) return;
  el.innerHTML = NLP_PIPELINE_STEPS.map((s, i) =>
    '<div style="display:flex;align-items:center;gap:8px;">' +
    (i > 0 ? '<span style="color:var(--text3);font-size:12px">→</span>' : '') +
    '<div style="background:var(--sky-light);border:1px solid #B5D0EE;border-radius:var(--r);padding:7px 10px;font-size:11px;color:var(--blue);font-weight:500;">' + s + '</div></div>'
  ).join('');
}

function renderAugTags() {
  const el = document.getElementById('aug-tags');
  if (!el) return;
  if (!AUG_TECHNIQUES || AUG_TECHNIQUES.length === 0) {
    el.innerHTML = '<div style="font-size:11px;color:var(--text3);">No data augmentation applied — training set consists entirely of real complaint records.</div>';
    return;
  }
  el.innerHTML = AUG_TECHNIQUES.map(t =>
    '<div style="background:var(--green-light);border:1px solid #A8D8BC;border-radius:var(--r);padding:6px 10px;font-size:11px;color:var(--green);font-weight:500;">' +
    '<strong>' + t.label + '</strong><span style="color:var(--text3);font-weight:400"> · ' + t.detail + '</span></div>'
  ).join('');
}

/* ══════════════════════════════════════════════════════
   REPORTS
══════════════════════════════════════════════════════ */
function renderReports() {
  const el = document.getElementById('report-list');
  if (!el) return;
  el.innerHTML = REPORT_ITEMS.map(r =>
    '<div class="card" style="margin-bottom:10px;"><div class="card-body" style="display:flex;align-items:center;gap:14px;padding:14px 16px;">' +
    '<div style="width:38px;height:38px;border-radius:var(--r);background:var(--sky-light);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">' + r.icon + '</div>' +
    '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">' + r.title + '</div>' +
    '<div style="font-size:11px;color:var(--text3);margin-top:2px">' + r.desc + '</div></div>' +
    '<button class="btn btn-ghost btn-sm" onclick="viewReport(\'' + r.title + '\')">View</button>' +
    '<button class="btn btn-primary btn-sm" onclick="downloadReportPDF(\'' + r.title + '\')">⬇ Export PDF</button>' +
    '</div></div>'
  ).join('');
}

function renderWeeklyBars() {
  const el = document.getElementById('weekly-bars');
  if (!el) return;

  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const monthName   = now.toLocaleDateString('en-PH', { month: 'long' });
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Weekly buckets for THIS month: W1=1-7, W2=8-14, ...
  const weeks = [];
  for (let start = 1; start <= daysInMonth; start += 7) {
    const end = Math.min(start + 6, daysInMonth);
    weeks.push({ start, end, count: 0, lbl: 'W' + (weeks.length + 1) });
  }

  // Count real complaints filed this month, by day-of-month
  complaints.forEach(c => {
    const parsed = new Date((c.date || '') + ' ' + year);
    if (isNaN(parsed)) return;
    if (parsed.getMonth() !== month) return;
    const dom = parsed.getDate();
    const w = weeks.find(x => dom >= x.start && dom <= x.end);
    if (w) w.count++;
  });

  // Realtime date range label — injected next to the card title (no HTML edit needed)
  const card = el.closest('.card');
  const titleEl = card ? card.querySelector('.card-title') : null;
  if (titleEl) {
    titleEl.textContent = 'Weekly Complaint Volume (Last 7 Days)';
    let rangeEl = card.querySelector('#weekly-range');
    if (!rangeEl) {
      rangeEl = document.createElement('span');
      rangeEl.id = 'weekly-range';
      rangeEl.style.cssText = 'font-size:11px;color:var(--text3);font-family:var(--mono);margin-left:auto;';
      titleEl.insertAdjacentElement('afterend', rangeEl);
    }
    rangeEl.textContent = monthName + ' 1–' + daysInMonth + ', ' + year;
  }

  // Distinct color per week so each bar reads separately
  const colors = ['#1E5FA8', '#1B7A4A', '#B06000', '#7A4FC0', '#C0392B', '#2E86C1'];
  const max = Math.max(...weeks.map(w => w.count), 1);

  el.innerHTML = weeks.map((w, i) =>
    '<div class="bar-wrap">' +
    '<div class="bar-val">' + w.count + '</div>' +
    '<div class="bar" style="height:' + Math.max(4, Math.round((w.count / max) * 100)) + 'px;' +
         'background:' + colors[i % colors.length] + ';border-color:' + colors[i % colors.length] + ';"></div>' +
    '<div class="bar-lbl" title="Day ' + w.start + '–' + w.end + '">' + w.lbl + '</div></div>'
  ).join('');
}

function renderIsoEval() {
  const el = document.getElementById('iso-eval');
  if (!el) return;
  const rows = [
    ['Usability',              '—', 'Pending'],
    ['Functional Suitability', '—', 'Pending'],
    ['Reliability',            '—', 'Pending'],
  ];
  el.innerHTML = rows.map(r =>
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);">' +
    '<span style="font-size:12px;font-weight:500;color:var(--text)">' + r[0] + '</span>' +
    '<div style="display:flex;align-items:center;gap:8px;">' +
    '<span style="font-size:12px;font-family:var(--mono);color:var(--blue);font-weight:700">' + r[1] + '</span>' +
    '<span class="badge b-gray">' + r[2] + '</span></div></div>'
  ).join('');
}

/* ══════════════════════════════════════════════════════
   NOTIFICATIONS / SETTINGS
══════════════════════════════════════════════════════ */
function renderNotifs() {
  const el = document.getElementById('notifs-list');
  updateNotifBadge();
  if (!el) return;
  if (notifStore.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🔔</div><div class="empty-title">No notifications</div><div class="empty-desc">You\'re all caught up.</div></div>';
    return;
  }
  el.innerHTML = notifStore.map(n =>
    '<div class="notif-item">' +
    '<div class="notif-ico">' + (n.type === 'success' ? '✅' : '📋') + '</div>' +
    '<div style="flex:1;"><div class="notif-txt">' + n.msg + '</div><div class="notif-time">' + n.time + '</div></div>' +
    (n.unread !== false ? '<div class="notif-dot2"></div>' : '') +
    '</div>'
  ).join('');
}

/* Red count badge on the topbar bell */
function updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const count = notifStore.filter(n => n.unread !== false).length;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

/* "Mark all as read" — clears dots + badge, and saves to DB */
function markAllNotifsRead() {
  notifStore.forEach(n => { n.unread = false; });
  renderNotifs();
  /* persist so it stays read after logout/reload */
  fetch(API_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'mark_read' }),
  }).catch(err => console.warn('BICTS: mark_read sync failed.', err));
}

function renderSettings() {
  const fEl = document.getElementById('settings-fields');
  if (fEl) fEl.innerHTML = SETTINGS_FIELDS.map(f =>
    '<div class="field" style="margin-bottom:12px;"><div class="label">' + f.label + '</div>' +
    '<input class="inp filled" value="' + f.value + '" placeholder="' + (f.value ? '' : 'Not set') + '"></div>'
  ).join('');

  const tEl = document.getElementById('settings-toggles');
  if (tEl) tEl.innerHTML = SETTINGS_TOGGLES.map(t =>
    '<div class="setting-row"><div class="setting-info">' +
    '<div class="setting-name">' + t.name + '</div>' +
    '<div class="setting-desc">' + t.desc + '</div>' +
    '</div><div class="toggle ' + (t.on ? 'on' : 'off') + '"></div></div>'
  ).join('');
}

/* ══════════════════════════════════════════════════════
   COMPLAINT DETAIL — NLP + AHP panels
══════════════════════════════════════════════════════ */
function renderDetailNlpBars(complaint) {
  const barsEl = document.getElementById('nlp-conf-bars');
  if (!barsEl) return;
  const result = classifyDescription(complaint.description || '');
  barsEl.innerHTML = CATEGORIES.map(cat => {
    const pct = cat === complaint.category
      ? (complaint.confidence || result.scores[cat] || 0)
      : (result.scores[cat] ?? 0);
    return '<div class="conf-bar">' +
      '<span class="conf-label">' + cat + (cat === complaint.category ? ' ★' : '') + '</span>' +
      '<div class="conf-track"><div class="conf-fill" style="width:' + pct + '%;background:' +
      (cat === complaint.category ? 'var(--blue)' : 'var(--sky)') + '"></div></div>' +
      '<span class="conf-pct">' + pct + '%</span></div>';
  }).join('');

  const predEl = document.getElementById('nlp-predicted-label');
  if (predEl) predEl.textContent = complaint.category;
}

function renderDetailAhp(complaint) {
  const ahp     = computeAHPScore(complaint.category, complaint.affected, complaint.description);
  const priInfo = priorityLabel(ahp.score);

  const scoreEl = document.getElementById('detail-score-num');
  if (scoreEl) {
    scoreEl.textContent = ahp.score;
    scoreEl.className   = 'score-num ' + priInfo.label.toLowerCase();
  }
  const badgeEl = document.getElementById('detail-priority-badge');
  if (badgeEl) {
    badgeEl.textContent = priInfo.label;
    badgeEl.className   = 'badge ' + priInfo.badge;
  }
  const ahpEl = document.getElementById('ahp-criteria');
  if (ahpEl) {
    ahpEl.innerHTML = [
      ['Severity',             ahp.severity,       '46.6%'],
      ['Urgency',              ahp.urgency,        '27.7%'],
      ['Affected Individuals', ahp.affectedBucket, '16.1%'],
      ['Frequency',            ahp.frequency,      '9.6%'],
    ].map(r =>
      '<div style="display:flex;justify-content:space-between;font-size:11px;padding:5px 0;border-bottom:1px solid var(--border);">' +
      '<span style="color:var(--text3)">' + r[0] + '</span>' +
      '<span style="color:var(--text);font-weight:500">' + r[1] + '</span>' +
      '<span style="color:var(--text3);font-family:var(--mono)">w=' + r[2] + '</span></div>'
    ).join('');
  }
}

function renderDetailTimeline(complaint) {
  const el = document.getElementById('detail-timeline');
  if (!el) return;
  const events = [
    { dot: 'done', label: 'Complaint Filed',    meta: complaint.date + (complaint.time ? ' · ' + complaint.time : '') },
    { dot: 'done', label: 'AI Classification',  meta: complaint.category + ' · ' + (complaint.confidence || '—') + '% relative SVM score' },
    { dot: complaint.status !== 'Open' ? 'done' : 'pend', label: 'Officer Assigned',
      meta: complaint.officer !== '—' ? complaint.officer : 'Pending assignment' },
    { dot: complaint.status === 'Resolved' ? 'done' : 'pend', label: 'Case Resolved',
      meta: complaint.resolvedAt ? 'Resolved at ' + complaint.resolvedAt : 'Pending resolution' },
  ];
  el.innerHTML = '<ul class="tl">' + events.map(e =>
    '<li><div class="tl-dot ' + e.dot + '"></div>' +
    '<div><div class="tl-act">' + e.label + '</div>' +
    '<div class="tl-meta">' + e.meta + '</div></div></li>'
  ).join('') + '</ul>';
}

/* ── Case notes placeholder ── */
function renderCaseNotes() {
  const el = document.getElementById('case-notes');
  if (el) el.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-title">No notes yet</div><div class="empty-desc">Add a note to begin tracking case progress.</div></div>';
}

/* ── Map report title to API type param ── */
function getReportType(title) {
  if (title.includes('Classification')) return 'classification';
  if (title.includes('Volume'))         return 'volume';
  if (title.includes('Response'))       return 'response';
  if (title.includes('Outcome'))        return 'outcome';
  return 'volume';
}

function appendReportScope(url) {

  const user =
    window.CURRENT_USER || {};

  /*
   * Normal Barangay Admin:
   * backend automatically enforces own barangay.
   */
  if (user.role !== 'super_admin') {
    return url;
  }


  const barangayId =
    typeof getSelectedSuperAdminBarangayId === 'function'
      ? getSelectedSuperAdminBarangayId()
      : 0;


  /*
   * One explicit barangay selected.
   */
  if (barangayId > 0) {

    return url +
      '&barangay_id=' +
      encodeURIComponent(barangayId);
  }


  /*
   * Super Admin global scope.
   */
  return url + '&scope=all';
}

/* ── Download PDF from PHP backend ── */
function downloadReportPDF(title) {

  const dateFrom =
    document.getElementById(
      'report-date-from'
    )?.value || '';

  const dateTo =
    document.getElementById(
      'report-date-to'
    )?.value || '';

  const type =
    getReportType(title);


  let url =
    'api/generate_report.php?type=' +
    type;


  if (dateFrom) {
    url +=
      '&date_from=' +
      encodeURIComponent(dateFrom);
  }


  if (dateTo) {
    url +=
      '&date_to=' +
      encodeURIComponent(dateTo);
  }


  /*
   * Add Super Admin report scope.
   */
  url =
    appendReportScope(url);


  const a =
    document.createElement('a');

  a.href = url;
  a.target = '_blank';
  a.download = '';

  document.body.appendChild(a);

  a.click();

  document.body.removeChild(a);
}

/* ── Preview PDF in a new browser tab (View button) ── */
function viewReport(title) {

  const dateFrom =
    document.getElementById(
      'report-date-from'
    )?.value || '';

  const dateTo =
    document.getElementById(
      'report-date-to'
    )?.value || '';

  const type =
    getReportType(title);


  let url =
    'api/generate_report.php?type=' +
    type +
    '&view=1';


  if (dateFrom) {
    url +=
      '&date_from=' +
      encodeURIComponent(dateFrom);
  }


  if (dateTo) {
    url +=
      '&date_to=' +
      encodeURIComponent(dateTo);
  }


  /*
   * Add Super Admin report scope.
   */
  url =
    appendReportScope(url);


  window.open(
    url,
    '_blank'
  );
}

/* ═══════════════════════════════════════════════════════════
   USERS MANAGEMENT + MY ACCOUNT
   Backend: api/profile.php
═══════════════════════════════════════════════════════════ */

const PROFILE_API = 'api/profile.php';

async function profileCall(action, body = null, method = 'POST') {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
  if (body) opts.body = JSON.stringify({ action, ...body });
  const url = method === 'GET' ? PROFILE_API + '?action=' + action : PROFILE_API;
  const res = await fetch(url, opts);
  return res.json();
}

function fmtLogin(val) {
  if (!val) return '<span style="color:var(--text3)">Never</span>';
  const d = new Date(String(val).replace(' ', 'T'));
  return isNaN(d) ? val : d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function roleBadge(role) {
  const cls =
    role === 'super_admin' ? 'b-blue'  :
    role === 'admin'       ? 'b-blue'  :
    role === 'resident'    ? 'b-green' :
    role === 'staff'       ? 'b-amber' :
                            'b-gray';

  const labels = {
    admin: 'Administrator',
    resident: 'Resident',
    staff: 'Staff',
    viewer: 'Viewer',
    super_admin: 'Super Admin'
  };

  const label = labels[role] || role || '—';

  return '<span class="badge ' + cls + '">' + label + '</span>';
}
function statusBadgeUser(status) {
  const cls = status === 'active' ? 'b-green' : status === 'pending' ? 'b-amber' : 'b-red';
  return '<span class="badge ' + cls + '">' + (status || 'active') + '</span>';
}

/* ── Tab switcher for the Users screen ── */
let _usersTab = 'users';
function switchUsersTab(tab, el) {
  _usersTab = tab;
  document.querySelectorAll('#users-tabs .tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  const up = document.getElementById('users-panel');
  const ap = document.getElementById('audit-panel');
  const sp = document.getElementById('stats-panel');
  if (up) up.style.display = tab === 'users' ? '' : 'none';
  if (ap) ap.style.display = tab === 'audit' ? '' : 'none';
  if (sp) sp.style.display = tab === 'stats' ? '' : 'none';
  if (tab === 'users') loadUsers();
  if (tab === 'audit') loadAuditLog();
  if (tab === 'stats') loadStaffStats();
}

/* ── 1. USER LIST (this replaces the old renderUsers placeholder) ── */
async function renderUsers() { loadUsers(); }   /* called by boot sequence */

async function loadUsers() {

  const tbody =
    document.getElementById('users-tbody');

  if (!tbody) return;


  tbody.innerHTML =
    '<tr>' +
      '<td colspan="7" ' +
      'style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">' +
      'Loading…' +
      '</td>' +
    '</tr>';


  const r =
    await profileCall(
      'list_users',
      null,
      'GET'
    );


  if (!r.ok) {

    tbody.innerHTML =
      '<tr>' +
        '<td colspan="7" ' +
        'style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">' +
        (r.error || 'Could not load users.') +
        '</td>' +
      '</tr>';

    return;
  }


  let users =
    Array.isArray(r.users)
      ? r.users
      : [];


  const currentUser =
    window.CURRENT_USER || {};


  /*
   * Super Admin:
   * apply the global barangay selector.
   */
  if (
    currentUser.role === 'super_admin'
  ) {

    const selectedBarangayId =
      typeof getSelectedSuperAdminBarangayId ===
        'function'
        ? getSelectedSuperAdminBarangayId()
        : 0;


    if (selectedBarangayId > 0) {

      users =
        users.filter(
          u =>
            Number(u.barangay_id) ===
            selectedBarangayId
        );
    }
  }


  if (!users.length) {

    tbody.innerHTML =
      '<tr>' +
        '<td colspan="7" ' +
        'style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">' +
        'No users found for the current barangay.' +
        '</td>' +
      '</tr>';

    return;
  }


  const myId =
    currentUser.id || 0;


  const barangays =
    window.SUPER_ADMIN_BARANGAYS || [];


  function barangayName(id) {

    if (!id) {
      return 'System';
    }

    const brgy =
      barangays.find(
        b =>
          Number(b.id) ===
          Number(id)
      );

    return brgy
      ? brgy.name
      : 'Barangay #' + id;
  }


  tbody.innerHTML =
    users.map(function(u){

      const isMe =
        Number(u.id) ===
        Number(myId);


      const brgyCell =
        currentUser.role === 'super_admin'
          ? (
              u.role === 'super_admin'
                ? 'System'
                : barangayName(
                    u.barangay_id
                  )
            )
          : barangayName(
              u.barangay_id
            );


      return (
        '<tr>' +

          '<td style="font-weight:500">' +
            _escHtml(
              u.full_name || '—'
            ) +
            (
              isMe
                ? ' <span style="font-size:10px;color:var(--text3)">(you)</span>'
                : ''
            ) +
          '</td>' +

          '<td style="font-size:11px;color:var(--text3)">' +
            _escHtml(
              u.email || '—'
            ) +
          '</td>' +

          '<td style="font-size:11px">' +
            _escHtml(brgyCell) +
          '</td>' +

          '<td>' +
            roleBadge(u.role) +
          '</td>' +

          '<td>' +
            statusBadgeUser(u.status) +
          '</td>' +

          '<td style="font-size:11px">' +
            fmtLogin(u.last_login) +
          '</td>' +

          '<td style="text-align:right;white-space:nowrap">' +

            (
              isMe

                ? ''

                : u.role === 'super_admin'

                  ? (
                      isMe

                        ? '<span style="font-size:10px;color:var(--text3);">Protected</span>'

                        : '<button class="btn btn-ghost btn-sm" ' +
                          'onclick="openDemoteSuperAdmin(' +
                            Number(u.id) +
                            ',\'' +
                            _escHtml(u.full_name || 'Super Administrator') +
                          '\')">' +
                            'Demote' +
                          '</button>'
                    )

                  : u.status === 'pending'

                    ? (
                        '<button class="btn btn-primary btn-sm" ' +
                        'onclick="approveUser(' +
                          Number(u.id) +
                        ')">' +
                          'Approve' +
                        '</button> ' +

                        '<button class="btn btn-ghost btn-sm" ' +
                        'onclick="rejectUser(' +
                          Number(u.id) +
                        ')">' +
                          'Reject' +
                        '</button>'
                      )

                    : (
                        (
                          u.role === 'admin' &&
                          (window.CURRENT_USER || {}).role === 'super_admin'

                            ? (
                                '<button class="btn btn-ghost btn-sm" ' +
                                'onclick="openPromoteSuperAdmin(' +
                                  Number(u.id) +
                                  ',\'' +
                                  _escHtml(u.full_name || 'Administrator') +
                                '\')">' +
                                  'Promote to Super Admin' +
                                '</button> '
                              )

                            : ''
                        ) +

                        '<button class="btn btn-ghost btn-sm" ' +
                        'onclick="cycleUserRole(' +
                          Number(u.id) +
                          ',\'' +
                          _escHtml(u.role) +
                        '\')">' +
                          'Role' +
                        '</button> ' +

                        '<button class="btn btn-ghost btn-sm" ' +
                        'onclick="toggleUserStatus(' +
                          Number(u.id) +
                          ',\'' +
                          _escHtml(u.status) +
                        '\')">' +

                          (
                            u.status === 'active'
                              ? 'Disable'
                              : 'Enable'
                          ) +

                        '</button>'
                      )
            ) +

          '</td>' +

        '</tr>'
      );

    }).join('');
}

/* role cycles admin → staff → viewer → admin */
/* role cycles admin → resident → staff → viewer → admin */
async function cycleUserRole(id, current) {
  const order = ['admin', 'resident', 'staff', 'viewer'];

  let currentIndex = order.indexOf(current);

  // If an old/unknown role is encountered,
  // safely start the cycle from admin.
  if (currentIndex === -1) {
    currentIndex = 0;
  }

  const next = order[(currentIndex + 1) % order.length];

  const r = await profileCall('update_user', {
    id,
    role: next
  });

  if (!r.ok) {
    alert(r.error || 'Update failed.');
    return;
  }

  loadUsers();
}

let _secureRoleTarget = null;


function openPromoteSuperAdmin(id, name) {

  const user =
    window.CURRENT_USER || {};

  if (user.role !== 'super_admin') {
    alert('Super Administrator access required.');
    return;
  }


  _secureRoleTarget = {
    id: Number(id),
    name: name || 'this user',
    operation: 'promote'
  };


  document.getElementById(
    'sr-user-id'
  ).value = String(id);

  document.getElementById(
    'sr-operation'
  ).value = 'promote';


  document.getElementById(
    'sr-title'
  ).textContent =
    'Promote to Super Administrator';


  document.getElementById(
    'sr-warning'
  ).innerHTML =
    '⚠️ You are granting <strong>GLOBAL SYSTEM ACCESS</strong> to <strong>' +
    _escHtml(name || 'this account') +
    '</strong>. This account will no longer belong to one specific barangay.';


  document.getElementById(
    'sr-demote-barangay-wrap'
  ).style.display = 'none';


  resetSecureRoleFields();


  showModal('secureRoleModal');
}


function openDemoteSuperAdmin(id, name) {

  const user =
    window.CURRENT_USER || {};

  if (user.role !== 'super_admin') {
    alert('Super Administrator access required.');
    return;
  }


  if (
    Number(id) ===
    Number(user.id)
  ) {
    alert(
      'You cannot demote your own active Super Administrator account.'
    );

    return;
  }


  _secureRoleTarget = {
    id: Number(id),
    name: name || 'this user',
    operation: 'demote'
  };


  document.getElementById(
    'sr-user-id'
  ).value = String(id);

  document.getElementById(
    'sr-operation'
  ).value = 'demote';


  document.getElementById(
    'sr-title'
  ).textContent =
    'Demote Super Administrator';


  document.getElementById(
    'sr-warning'
  ).innerHTML =
    '⚠️ <strong>' +
    _escHtml(name || 'This account') +
    '</strong> will lose global access and become a normal Barangay Administrator.';


  const wrap =
    document.getElementById(
      'sr-demote-barangay-wrap'
    );

  wrap.style.display = '';


  const select =
    document.getElementById(
      'sr-barangay'
    );

  select.innerHTML =
    '<option value="">-- Select Barangay --</option>';


  const barangays =
    window.SUPER_ADMIN_BARANGAYS || [];


  barangays.forEach(function(brgy) {

    const option =
      document.createElement('option');

    option.value =
      String(brgy.id);

    option.textContent =
      brgy.name;

    select.appendChild(option);
  });


  resetSecureRoleFields();


  showModal('secureRoleModal');
}


function resetSecureRoleFields() {

  const password =
    document.getElementById(
      'sr-password'
    );

  const totp =
    document.getElementById(
      'sr-totp'
    );

  const msg =
    document.getElementById(
      'sr-msg'
    );


  if (password) {
    password.value = '';
  }

  if (totp) {
    totp.value = '';
  }

  if (msg) {
    msg.textContent = '';
  }
}


function closeSecureRoleModal() {

  closeModal('secureRoleModal');

  resetSecureRoleFields();

  _secureRoleTarget = null;
}


async function submitSecureRoleChange() {

  if (!_secureRoleTarget) {
    return;
  }


  const operation =
    _secureRoleTarget.operation;


  const password =
    document.getElementById(
      'sr-password'
    ).value;


  const totp =
    document.getElementById(
      'sr-totp'
    ).value
      .replace(/\D/g, '')
      .trim();


  const barangayId =
    Number(
      document.getElementById(
        'sr-barangay'
      ).value || 0
    );


  const msg =
    document.getElementById(
      'sr-msg'
    );


  if (!password) {

    msg.style.color =
      'var(--red)';

    msg.textContent =
      'Enter your current password.';

    return;
  }


  if (totp.length !== 6) {

    msg.style.color =
      'var(--red)';

    msg.textContent =
      'Enter the 6-digit authenticator code.';

    return;
  }


  if (
    operation === 'demote' &&
    barangayId <= 0
  ) {

    msg.style.color =
      'var(--red)';

    msg.textContent =
      'Select a barangay for the demoted administrator.';

    return;
  }


  const warning =
    operation === 'promote'
      ? (
          'You are granting GLOBAL SYSTEM ACCESS to ' +
          _secureRoleTarget.name +
          '. Continue?'
        )
      : (
          'You are removing Super Administrator access from ' +
          _secureRoleTarget.name +
          '. Continue?'
        );


  if (!confirm(warning)) {
    return;
  }


  const btn =
    document.getElementById(
      'sr-submit-btn'
    );


  btn.disabled = true;

  btn.textContent =
    'Verifying…';


  try {

    const body = {

      id:
        _secureRoleTarget.id,

      operation:
        operation,

      current_password:
        password,

      totp_code:
        totp
    };


    if (operation === 'demote') {
      body.barangay_id =
        barangayId;
    }


    const r =
      await profileCall(
        'secure_super_admin_role',
        body
      );


    if (!r.ok) {

      msg.style.color =
        'var(--red)';

      msg.textContent =
        r.error ||
        'Role change failed.';

      return;
    }


    msg.style.color =
      'var(--green)';

    msg.textContent =
      r.message ||
      'Role changed successfully.';


    await loadUsers();


    setTimeout(
      closeSecureRoleModal,
      800
    );


  } catch (err) {

    console.error(
      'Secure role change failed:',
      err
    );


    msg.style.color =
      'var(--red)';

    msg.textContent =
      'Network error. Please try again.';


  } finally {

    btn.disabled = false;

    btn.textContent =
      'Confirm Role Change';
  }
}

async function toggleUserStatus(id, current) {
  const next = current === 'active' ? 'disabled' : 'active';
  const r = await profileCall('update_user', { id, status: next });
  if (!r.ok) { alert(r.error || 'Update failed.'); return; }
  loadUsers();
}
/* Approve a newly-signed-up resident: pending -> active, so they can log in */
async function approveUser(id) {
  const r = await profileCall('update_user', { id, status: 'active' });
  if (!r.ok) { alert(r.error || 'Could not approve user.'); return; }
  loadUsers();
}
/* Reject a newly-signed-up resident: pending -> disabled */
async function rejectUser(id) {
  if (!confirm('Reject this account? They will not be able to sign in.')) return;
  const r = await profileCall('update_user', { id, status: 'disabled' });
  if (!r.ok) { alert(r.error || 'Could not reject user.'); return; }
  loadUsers();
}

/* ── Add user (uses the modal in index.html) ── */
function openAddUser() {

  const user =
    window.CURRENT_USER || {};


  if (
    user.role === 'super_admin'
  ) {

    const barangayId =
      typeof getSelectedSuperAdminBarangayId ===
        'function'
        ? getSelectedSuperAdminBarangayId()
        : 0;


    if (barangayId <= 0) {

      alert(
        'Select a barangay from the All Barangays selector before creating a user.'
      );

      return;
    }
  }


  const msg =
    document.getElementById('au_msg');

  if (msg) {
    msg.textContent = '';
  }


  const m =
    document.getElementById(
      'addUserModal'
    );

  if (m) {
    m.classList.add('open');
  }
}
function closeAddUser() { const m = document.getElementById('addUserModal'); if (m) m.classList.remove('open'); }
async function submitAddUser() {
  const pw = document.getElementById('au_pw').value;
  const msg = document.getElementById('au_msg');
  msg.textContent = '';
  const pwErr = passwordStrengthError(pw);
  if (pwErr) { msg.style.color = 'var(--red)'; msg.textContent = pwErr; return; }
  const body = {
    full_name: document.getElementById('au_name').value.trim(),
    email:     document.getElementById('au_email').value.trim(),
    username:  document.getElementById('au_username').value.trim(),
    role:      document.getElementById('au_role').value,
    password:  pw,
  };
    /*
  * Super Admin must explicitly assign the
  * new account to the selected barangay.
  */
  if (
    (window.CURRENT_USER || {}).role ===
    'super_admin'
  ) {

    const barangayId =
      typeof getSelectedSuperAdminBarangayId ===
        'function'
        ? getSelectedSuperAdminBarangayId()
        : 0;


    if (barangayId <= 0) {

      msg.style.color =
        'var(--red)';

      msg.textContent =
        'Select a barangay before creating a user.';

      return;
    }


    body.barangay_id =
      barangayId;
  }
  const r = await profileCall('create_user', body);
  if (!r.ok) { msg.style.color = 'var(--red)'; msg.textContent = r.error || 'Could not create user.'; return; }
  closeAddUser();
  ['au_name','au_email','au_username','au_pw'].forEach(id => document.getElementById(id).value = '');
  loadUsers();
}

/* ── 2. ACTIVITY LOG ── */
async function loadAuditLog() {
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">Loading…</td></tr>';
  const r = await profileCall('activity_log', null, 'GET');
  if (!r.ok)         { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">' + (r.error || 'Could not load log.') + '</td></tr>'; return; }
  if (!r.log.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">No activity recorded yet.</td></tr>'; return; }
  tbody.innerHTML = r.log.map(a =>
    '<tr>' +
    '<td style="font-size:11px;color:var(--text3);white-space:nowrap">' + fmtLogin(a.created_at) + '</td>' +
    '<td style="font-size:11px;font-weight:500">' + (a.user_name || '—') + '</td>' +
    '<td><span class="badge b-gray" style="font-size:9px">' + a.action + '</span></td>' +
    '<td style="font-size:11px">' + (a.detail || '') + '</td>' +
    '</tr>'
  ).join('');
}

/* ── 3. STAFF STATS ── */
async function loadStaffStats() {
  const tbody = document.getElementById('stats-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">Loading…</td></tr>';
  const r = await profileCall('staff_stats', null, 'GET');
  if (!r.ok)           { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">' + (r.error || 'Could not load stats.') + '</td></tr>'; return; }
  if (!r.stats.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">No admin activity yet.</td></tr>'; return; }
  tbody.innerHTML = r.stats.map(s => {
    const handled = Number(s.handled) || 0;
    return '<tr>' +
      '<td style="font-weight:500">' + (s.full_name || '—') + ' ' + roleBadge(s.role) + '</td>' +
      '<td style="font-family:var(--mono);text-align:center;color:var(--green);font-weight:700">' + (Number(s.resolved) || 0) + '</td>' +
      '<td style="font-family:var(--mono);text-align:center;color:var(--text3);font-weight:700">' + (Number(s.closed) || 0) + '</td>' +
      '<td style="font-family:var(--mono);text-align:center;font-weight:700">' + handled + '</td>' +
      '<td style="font-size:11px;color:var(--text2)">' + (s.cats || '<span style="color:var(--text3)">No cases processed yet</span>') + '</td>' +
      '</tr>';
  }).join('');
}

/*
 * ════════════════════════════════════════════════════
 * SUPER ADMIN — GLOBAL ACTIVITY LOG
 * ════════════════════════════════════════════════════
 */

let _globalActivityLogs = [];


async function loadGlobalActivityLogs() {

  const user =
    window.CURRENT_USER || {};


  if (user.role !== 'super_admin') {
    return;
  }


  const tbody =
    document.getElementById(
      'sa-global-log-tbody'
    );


  if (!tbody) {
    return;
  }


  tbody.innerHTML =
    '<tr>' +
      '<td colspan="7" ' +
      'style="text-align:center;padding:30px;color:var(--text3);">' +
        'Loading activity…' +
      '</td>' +
    '</tr>';


  try {

    const barangayId =
      typeof getSelectedSuperAdminBarangayId ===
        'function'
        ? getSelectedSuperAdminBarangayId()
        : 0;


    let url =
      'api/profile.php?action=global_activity_log&limit=200';


    if (barangayId > 0) {

      url +=
        '&barangay_id=' +
        encodeURIComponent(
          barangayId
        );
    }


    const res =
      await fetch(
        url,
        {
          credentials:'include',
          cache:'no-store'
        }
      );


    const data =
      await res.json();


    if (
      !res.ok ||
      !data.ok
    ) {

      throw new Error(
        data.error ||
        'Could not load activity logs.'
      );
    }


    _globalActivityLogs =
      Array.isArray(data.log)
        ? data.log
        : [];


    populateGlobalActivityActionFilter();

    renderGlobalActivityLogs();


  } catch (err) {

    console.error(
      'Global activity log load failed:',
      err
    );


    tbody.innerHTML =
      '<tr>' +
        '<td colspan="7" ' +
        'style="text-align:center;padding:30px;color:var(--red,#dc2626);">' +
          _escHtml(
            err.message ||
            'Could not load activity logs.'
          ) +
        '</td>' +
      '</tr>';
  }
}


function populateGlobalActivityActionFilter() {

  const select =
    document.getElementById(
      'sa-log-action-filter'
    );


  if (!select) {
    return;
  }


  const previous =
    select.value;


  const actions =
    [
      ...new Set(
        _globalActivityLogs
          .map(r => r.action)
          .filter(Boolean)
      )
    ].sort();


  select.innerHTML =
    '<option value="">All Actions</option>';


  actions.forEach(function(action) {

    const option =
      document.createElement('option');

    option.value =
      action;

    option.textContent =
      formatActivityAction(action);

    select.appendChild(option);
  });


  if (
    previous &&
    actions.includes(previous)
  ) {
    select.value =
      previous;
  }
}


function renderGlobalActivityLogs() {

  const tbody =
    document.getElementById(
      'sa-global-log-tbody'
    );


  if (!tbody) {
    return;
  }


  const search =
    (
      document.getElementById(
        'sa-log-search'
      )?.value || ''
    )
      .trim()
      .toLowerCase();


  const role =
    document.getElementById(
      'sa-log-role-filter'
    )?.value || '';


  const action =
    document.getElementById(
      'sa-log-action-filter'
    )?.value || '';


  let rows =
    [..._globalActivityLogs];


  if (role) {

    rows =
      rows.filter(
        r =>
          String(r.user_role || '') ===
          role
      );
  }


  if (action) {

    rows =
      rows.filter(
        r =>
          String(r.action || '') ===
          action
      );
  }


  if (search) {

    rows =
      rows.filter(function(r){

        const haystack =
          [
            r.user_name,
            r.user_role,
            r.barangay_name,
            r.action,
            r.detail,
            r.ip_address
          ]
            .join(' ')
            .toLowerCase();


        return haystack.includes(
          search
        );
      });
  }


  const count =
    document.getElementById(
      'sa-log-count'
    );


  if (count) {

    count.textContent =
      rows.length +
      ' record' +
      (
        rows.length === 1
          ? ''
          : 's'
      ) +
      ' shown';
  }


  if (!rows.length) {

    tbody.innerHTML =
      '<tr>' +
        '<td colspan="7" ' +
        'style="text-align:center;padding:32px;color:var(--text3);">' +
          'No activity found for the current filters.' +
        '</td>' +
      '</tr>';

    return;
  }


  tbody.innerHTML =
    rows.map(function(r){

      const roleLabel =
        formatActivityRole(
          r.user_role
        );


      const barangay =
        r.barangay_id
          ? (
              r.barangay_name ||
              'Barangay #' +
              r.barangay_id
            )
          : 'System';


      return (
        '<tr>' +

          '<td style="font-size:11px;color:var(--text3);white-space:nowrap;">' +
            _escHtml(
              formatActivityTimestamp(
                r.created_at
              )
            ) +
          '</td>' +

          '<td style="font-weight:500;white-space:nowrap;">' +
            _escHtml(
              r.user_name ||
              'System'
            ) +
          '</td>' +

          '<td>' +
            '<span class="badge b-gray">' +
              _escHtml(roleLabel) +
            '</span>' +
          '</td>' +

          '<td style="font-size:11px;">' +
            _escHtml(barangay) +
          '</td>' +

          '<td>' +
            '<span class="badge b-blue" style="font-size:9px;">' +
              _escHtml(
                formatActivityAction(
                  r.action
                )
              ) +
            '</span>' +
          '</td>' +

          '<td style="font-size:11px;min-width:260px;">' +
            _escHtml(
              r.detail || '—'
            ) +
          '</td>' +

          '<td style="font-family:var(--mono);font-size:10px;white-space:nowrap;">' +
            _escHtml(
              r.ip_address || '—'
            ) +
          '</td>' +

        '</tr>'
      );

    }).join('');
}


function formatActivityAction(action) {

  return String(
    action || 'unknown'
  )
    .replace(/_/g, ' ')
    .replace(
      /\b\w/g,
      function(c){
        return c.toUpperCase();
      }
    );
}


function formatActivityRole(role) {

  const labels = {
    super_admin:
      'Super Admin',

    admin:
      'Administrator',

    staff:
      'Staff',

    viewer:
      'Viewer',

    resident:
      'Resident'
  };


  return labels[role] ||
    (
      role
        ? role
        : 'System'
    );
}


function formatActivityTimestamp(raw) {

  if (!raw) {
    return '—';
  }


  try {

    const d =
      new Date(
        String(raw)
          .replace(' ', 'T')
      );


    return d.toLocaleString(
      'en-PH',
      {
        month:'short',
        day:'numeric',
        year:'numeric',
        hour:'2-digit',
        minute:'2-digit'
      }
    );

  } catch(e) {

    return raw;
  }
}

/* ── MY ACCOUNT (profile icon in the topbar) ── */
async function openMyAccount() {
  const r = await profileCall('get_profile', null, 'GET');
  if (!r.ok) { alert(r.error || 'Could not load profile.'); return; }
  const p = r.profile;
  document.getElementById('ma_name').value  = p.full_name || '';
  document.getElementById('ma_email').value = p.email     || '';
  document.getElementById('ma_phone').value = p.phone     || '';
  document.getElementById('ma_addr').value  = p.address   || '';
  document.getElementById('ma_role').value  = p.role === 'admin' ? 'Administrator' : (p.role || '');
  document.getElementById('ma_last').textContent  = fmtLogin(p.last_login);
  document.getElementById('ma_count').textContent = (p.login_count || 0) + ' logins';
  document.getElementById('ma_pw').value = '';
  document.getElementById('ma_curpw').value = '';
  document.getElementById('ma_msg').textContent = '';
  document.getElementById('myAccountModal').classList.add('open');
}
function closeMyAccount() { document.getElementById('myAccountModal').classList.remove('open'); }
async function saveMyAccount() {
  const curpw = (document.getElementById('ma_curpw').value || '');
  const msg = document.getElementById('ma_msg');
  msg.textContent = '';
  if (!curpw) { msg.style.color = 'var(--red)'; msg.textContent = 'Enter your current password to save changes.'; return; }
  const body = {
    full_name: document.getElementById('ma_name').value.trim(),
    email:     document.getElementById('ma_email').value.trim(),
    phone:     document.getElementById('ma_phone').value.trim(),
    address:   document.getElementById('ma_addr').value.trim(),
    password:  document.getElementById('ma_pw').value || '',
    current_password: curpw,
  };
  const r = await profileCall('update_profile', body);
  if (!r.ok) { msg.style.color = 'var(--red)'; msg.textContent = r.error || 'Could not save.'; return; }
  msg.style.color = 'var(--green)'; msg.textContent = 'Saved.';
  document.getElementById('ma_curpw').value = '';
  const nameEl = document.querySelector('#sidebar-user .user-name');
  if (nameEl && r.name) nameEl.textContent = r.name;
  setTimeout(closeMyAccount, 700);
}