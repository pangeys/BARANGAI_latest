/* ═══════════════════════════════════════════════════════
   BICTS — js/dataset.js
   Loads and displays the labeled training dataset used to
   train the SVM classifier and the Fuzzy AHP module.

   Reference file: data/combined_dataset.csv
   Expected cols:  Complaint Description, Category, Date,
                   Frequency, Severity, Urgency,
                   Number of Affected Individuals

   Note: the Frequency/Severity/Urgency/Number of Affected
   Individuals columns in this CSV are kept for dataset
   inspection/reference only. The live system re-derives
   these four values from raw complaint text at submission
   time (see classifier.js extractSeverity/extractUrgency/
   extractFrequency), so the dashboard's Fuzzy AHP scoring
   does NOT read them from this file.

   Re-generate this file by running the dataset prep /
   Colab pipeline, then place the CSV in data/.
═══════════════════════════════════════════════════════ */

const DATASET_FILE = 'data/combined_dataset.csv';

let datasetRows = [];

/* ── CSV Parser ── */
function parseCSV(text) {
  const lines  = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

  const findCol = (...names) => {
    for (const n of names) {
      const idx = header.findIndex(h => h.toLowerCase() === n.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const descIdx   = findCol('Complaint Description', 'complaint_description', 'complaint_summary', 'summary', 'text', 'complaint_text');
  const categoryIdx = findCol('Category', 'category', 'label', 'class');
  const dateIdx      = findCol('Date', 'date');
  const freqIdx       = findCol('Frequency', 'frequency');
  const sevIdx         = findCol('Severity', 'severity');
  const urgIdx           = findCol('Urgency', 'urgency');
  const affIdx             = findCol('Number of Affected Individuals', 'affected_individuals', 'affected');

  if (descIdx === -1 || categoryIdx === -1) {
    console.error('BICTS: CSV missing required columns (Complaint Description, Category)');
    return [];
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols    = splitCSVLine(lines[i]);
    if (cols.length < 2) continue;
    const summary  = (cols[descIdx]     || '').replace(/^"|"$/g, '').trim();
    const category = (cols[categoryIdx] || '').replace(/^"|"$/g, '').trim();
    if (!summary || !category) continue;
    rows.push({
      summary,
      category,
      date:      dateIdx  !== -1 ? (cols[dateIdx]  || '').replace(/^"|"$/g, '').trim() : 'N/A',
      frequency: freqIdx  !== -1 ? (cols[freqIdx]  || '').replace(/^"|"$/g, '').trim() : '',
      severity:  sevIdx   !== -1 ? (cols[sevIdx]   || '').replace(/^"|"$/g, '').trim() : '',
      urgency:   urgIdx   !== -1 ? (cols[urgIdx]   || '').replace(/^"|"$/g, '').trim() : '',
      affected:  affIdx   !== -1 ? (cols[affIdx]   || '').replace(/^"|"$/g, '').trim() : '',
      row: i,
    });
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

/* Categories now come directly from the CSV / svm_model.json —
   no merge-mapping needed since CATEGORIES in data.js already
   matches the dataset's Category column 1:1. Kept as a thin
   passthrough so callers that previously used
   mapToMergedCategory() keep working unchanged. */
function mapToMergedCategory(raw) {
  const trimmed = (raw || '').trim();
  return CATEGORIES.includes(trimmed) ? trimmed : null;
}

/* ── Auto-load training dataset on boot ── */
function initDatasetUpload() {
  fetch(DATASET_FILE)
    .then(res => { if (!res.ok) throw new Error('not found'); return res.text(); })
    .then(text => {
      const rows = parseCSV(text);
      if (rows.length === 0) return;
      datasetRows = rows;
      renderDatasetStats();
      renderDatasetTable();
      renderDashboardDonut();
      showDatasetSection();
    })
    .catch(() => {
      const el = document.getElementById('dataset-empty');
      if (el) el.innerHTML =
        '<div class="alert alert-warn" style="margin:0;">' +
        '⚠️ Training dataset not found. Place ' +
        '<code style="font-family:monospace;background:var(--bg2);padding:1px 5px;border-radius:3px;">combined_dataset.csv</code>' +
        ' inside the <code style="font-family:monospace;background:var(--bg2);padding:1px 5px;border-radius:3px;">data/</code> folder.' +
        '</div>';
    });
}

function showDatasetSection() {
  const empty = document.getElementById('dataset-empty');
  const table = document.getElementById('dataset-table-wrap');
  if (empty) empty.style.display = 'none';
  if (table) table.style.display = 'block';
}

/* Stats bar: total · per-category counts */
function renderDatasetStats() {
  const el = document.getElementById('dataset-stats');
  if (!el || datasetRows.length === 0) return;

  const total = datasetRows.length;

  const counts = {};
  CATEGORIES.forEach(c => { counts[c] = 0; });
  datasetRows.forEach(r => { const m = mapToMergedCategory(r.category); if (m) counts[m]++; });

  el.innerHTML =
    '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">' +
    '<span style="font-size:12px;font-weight:600;color:var(--text)">Reference CSV: ' +
    '<span style="color:var(--blue)">' + total + ' rows · 6 categories</span></span>' +
    '</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">' +
    CATEGORIES.map(cat =>
      '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);">' +
      '<span style="width:8px;height:8px;border-radius:2px;background:' + CAT_COLORS[cat] + ';flex-shrink:0;"></span>' +
      cat + ': <strong>' + counts[cat] + '</strong></span>'
    ).join('') + '</div>';
}

/* Filter state */
let _dsSearch    = '';
let _dsCatFilter = '';
let _dsPage      = 1;
const DS_PAGE_SIZE = 15;

function filterDatasetTable() {
  _dsSearch    = (document.getElementById('ds-search')?.value     || '').toLowerCase();
  _dsCatFilter = (document.getElementById('ds-cat-filter')?.value || '');
  _dsPage = 1;
  renderDatasetTable();
}

function getFilteredRows() {
  return datasetRows.filter(r => {
    const m = mapToMergedCategory(r.category) || r.category;
    if (_dsCatFilter && m !== _dsCatFilter) return false;
    if (_dsSearch && !r.summary.toLowerCase().includes(_dsSearch)) return false;
    return true;
  });
}

function renderDatasetTable() {
  const tbody    = document.getElementById('dataset-tbody');
  const pageInfo = document.getElementById('ds-page-info');
  const prevBtn  = document.getElementById('ds-prev');
  const nextBtn  = document.getElementById('ds-next');
  if (!tbody) return;

  const filtered   = getFilteredRows();
  const total      = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / DS_PAGE_SIZE));
  _dsPage          = Math.min(_dsPage, totalPages);
  const pageRows   = filtered.slice((_dsPage - 1) * DS_PAGE_SIZE, _dsPage * DS_PAGE_SIZE);

  if (pageRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">No records match the current filter.</td></tr>';
  } else {
    tbody.innerHTML = pageRows.map(r => {
      const merged = mapToMergedCategory(r.category) || r.category;
      const color  = CAT_COLORS[merged] || '#8A9BB0';
      return '<tr>' +
        '<td style="font-family:var(--mono);color:var(--text3);font-size:10px">' + r.row + '</td>' +
        '<td style="font-size:12px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(r.summary) + '</td>' +
        '<td><span class="badge" style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44">' + escHtml(merged) + '</span></td>' +
        '<td style="font-size:11px;color:var(--text3)">' + escHtml(r.date || 'N/A') + '</td>' +
        '</tr>';
    }).join('');
  }

  if (pageInfo) pageInfo.textContent = 'Page ' + _dsPage + ' of ' + totalPages + ' · ' + total + ' records';
  if (prevBtn)  prevBtn.disabled = _dsPage <= 1;
  if (nextBtn)  nextBtn.disabled = _dsPage >= totalPages;
}

function dsPagePrev() { if (_dsPage > 1) { _dsPage--; renderDatasetTable(); } }
function dsPageNext() {
  if (_dsPage < Math.ceil(getFilteredRows().length / DS_PAGE_SIZE)) { _dsPage++; renderDatasetTable(); }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
