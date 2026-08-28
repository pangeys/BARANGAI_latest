/* ═══════════════════════════════════════════════════════
   BICTS — js/app.js  (DB-connected version)
═══════════════════════════════════════════════════════ */

const API_URL = 'api.php';

let complaints = [];
let _officers  = [];

/*
 * Super Admin keeps an untouched global copy.
 * The visible arrays below are filtered by the
 * All Barangays context selector.
 */
let _allComplaints = [];
let _allOfficers   = [];
let _editingOfficerId = null;
let _assignComplaintId = null;
let _currentDetailComplaintId = null;
let nextId     = 1;
let notifStore = [];

function isViewer() { return (window.CURRENT_USER || {}).role === 'viewer'; }
function mask(text) {
  if (!isViewer()) return text;
  const s = String(text == null ? '' : text);
  return s.trim() ? '••••••' : s;
}

function getSelectedSuperAdminBarangayId() {

  const user =
    window.CURRENT_USER || {};

  if (user.role !== 'super_admin') {
    return 0;
  }

  const select =
    document.getElementById(
      'global-barangay-select'
    );

  return Number(
    select?.value || 0
  );
}


function applySuperAdminContext() {

    /*
  * Refresh Reports & Analytics when
  * the Super Admin context changes.
  */
  const reportsScreen =
    document.getElementById(
      'screen-reports'
    );

  if (
    reportsScreen &&
    reportsScreen.classList.contains('active')
  ) {

    if (
      typeof renderReports === 'function'
    ) {
      renderReports();
    }

    if (
      typeof renderWeeklyBars === 'function'
    ) {
      renderWeeklyBars();
    }
  }

  const user =
    window.CURRENT_USER || {};

  /*
   * Normal Barangay Admin:
   * preserve the exact existing behavior.
   */
  if (user.role !== 'super_admin') {

    complaints =
      [..._allComplaints];

    _officers =
      [..._allOfficers];

    renderAll();
    renderOfficersTable();
    renderOfficerStats();

    return;
  }


  const barangayId =
    getSelectedSuperAdminBarangayId();


  /*
   * All Barangays.
   */
  if (barangayId <= 0) {

    complaints =
      [..._allComplaints];

    _officers =
      [..._allOfficers];

  /*
   * One selected barangay.
   */
  } else {

    complaints =
      _allComplaints.filter(
        c =>
          Number(c.barangay_id) ===
          barangayId
      );

    _officers =
      _allOfficers.filter(
        o =>
          Number(o.barangay_id) ===
          barangayId
      );
  }


  renderAll();

  renderOfficersTable();

  renderOfficerStats();

    /*
  * Refresh Users & Roles too when that
  * screen is currently visible.
  */
  const usersScreen =
    document.getElementById(
      'screen-users'
    );

  if (
    usersScreen &&
    usersScreen.classList.contains('active') &&
    typeof loadUsers === 'function'
  ) {
    loadUsers();
  }

    /*
  * Refresh dedicated Activity Logs when
  * the Super Admin barangay context changes.
  */
  const activityLogsScreen =
    document.getElementById(
      'screen-activity-logs'
    );


  if (
    activityLogsScreen &&
    activityLogsScreen.classList.contains('active') &&
    typeof loadGlobalActivityLogs === 'function'
  ) {

    loadGlobalActivityLogs();
  }

  /*
   * If Settings is currently open,
   * load the selected barangay's configuration.
   */
  const settingsScreen =
  document.getElementById(
    'screen-settings'
  );


if (
  settingsScreen &&
  settingsScreen.classList.contains('active')
) {

  /*
   * Always call this, including All Barangays,
   * so stale General values are cleared.
   */
  loadSettingsGeneral();


  /*
   * If the Audit tab is currently visible,
   * refresh its scope too.
   */
  const auditPanel =
    document.getElementById(
      'settings-panel-audit'
    );


  if (
    auditPanel &&
    auditPanel.style.display !== 'none'
  ) {

    loadSettingsAuditLog();
  }
  }
}

async function loadFromDB() {

  try {

    const res =
      await fetch(
        API_URL + '?type=init',
        {
          credentials:'include',
          cache:'no-store'
        }
      );

    if (!res.ok) {
      throw new Error(
        'HTTP ' + res.status
      );
    }

    const data =
      await res.json();


    _allComplaints =
      Array.isArray(data.complaints)
        ? data.complaints
        : [];

    _allOfficers =
      Array.isArray(data.officers)
        ? data.officers
        : [];


    /*
     * Start with the complete authorized dataset.
     * applySuperAdminContext() will narrow it
     * when the Super Admin selects one barangay.
     */
    complaints =
      [..._allComplaints];

    _officers =
      [..._allOfficers];


    notifStore =
      (data.notifications || []).map(
        n => ({
          msg:       n.msg,
          type:      n.type,
          time:      n.time,
          createdAt: n.createdAt || null,
          unread:    n.isRead ? false : true,
        })
      );


    nextId =
      parseInt(data.nextId) || 1;

  } catch (err) {

    console.warn(
      'BICTS: Could not reach api.php, running in-memory.',
      err
    );

    complaints = [];
    _officers  = [];

    _allComplaints = [];
    _allOfficers   = [];

    notifStore = [];
    nextId = 1;
  }


  applySuperAdminContext();

  renderNotifs();
}

async function addComplaint(data) {
  const dateFiled = new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  try {
    const res    = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'add_complaint', data: { ...data, date_filed: dateFiled } }),
    });
    const result = await res.json();
    if (result.success) {
      const newComplaint = { id: result.id, date: dateFiled, ...data };
      complaints.unshift(newComplaint);
      renderAll();
      return newComplaint;
    }
  } catch (err) {
    console.warn('BICTS: DB save failed, using in-memory fallback.', err);
  }
  const id = '#' + String(nextId).padStart(3, '0');
  complaints.unshift({ id, date: dateFiled, ...data });
  nextId++;
  renderAll();
  return complaints[0];
}

async function resolveComplaint(id) {
  if (isViewer()) return;
  const c = complaints.find(x => x.id === id);
  if (!c || c.status === 'Resolved' || c.status === 'Closed') return;

  try {
    const res = await fetch(API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_status', id, status: 'Resolved', sb: 'b-green' }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) throw new Error(result.error || 'Could not resolve complaint.');

    c.status = 'Resolved';
    c.sb = 'b-green';
    c.resolvedAt = result.changed_at || c.resolvedAt;
    await loadComplaintStatusHistory(id, c);
    renderAll();
    await pushNotif('Complaint ' + id + ' (' + c.category + ') marked as Resolved.', 'success');
  } catch (err) {
    console.warn('BICTS: DB status sync failed.', err);
  }
}

async function closeComplaint(id, reason) {
  if (isViewer()) return;
  const c = complaints.find(x => x.id === id);
  if (!c || c.status === 'Resolved' || c.status === 'Closed') return;

  try {
    const res = await fetch(API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close_complaint', id, reason: reason || 'Closed' }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) throw new Error(result.error || 'Could not close complaint.');

    c.status = 'Closed';
    c.sb = 'b-gray';
    c.closeReason = reason || 'Closed';
    c.closedAt = result.changed_at || c.closedAt;
    c.resolvedAt = null;
    await loadComplaintStatusHistory(id, c);
    renderAll();
    await pushNotif('Complaint ' + id + ' (' + c.category + ') closed — ' + c.closeReason + '.', 'info');
  } catch (err) {
    console.warn('BICTS: DB close sync failed.', err);
  }
}

let _closingId = null;
function openCloseModal(id) {
  _closingId = id;
  const sel = document.getElementById('close-reason');
  if (sel) sel.selectedIndex = 0;
  showModal('closeModal');
}
async function submitCloseCase() {
  if (!_closingId) return;
  const reason = document.getElementById('close-reason')?.value || 'Closed';
  const id = _closingId;
  closeModal('closeModal');
  await closeComplaint(id, reason);
  _closingId = null;
  if (typeof viewComplaint === 'function') viewComplaint(id);
}

async function advanceStatus(id) {
  if (isViewer()) return;
  const c = complaints.find(x => x.id === id);
  if (!c) return;
  const idx = STATUS_FLOW.indexOf(c.status);
  if (idx >= STATUS_FLOW.length - 1) return;

  const nextStatus = STATUS_FLOW[idx + 1];
  const nextBadge = statusBadge(nextStatus);

  try {
    const res = await fetch(API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_status', id, status: nextStatus, sb: nextBadge }),
    });
    const result = await res.json();
    if (!res.ok || !result.success) throw new Error(result.error || 'Could not update complaint status.');

    c.status = nextStatus;
    c.sb = nextBadge;
    if (nextStatus === 'Resolved') c.resolvedAt = result.changed_at || c.resolvedAt;
    await loadComplaintStatusHistory(id, c);
    renderAll();

    if (nextStatus === 'Resolved') {
      await pushNotif('Complaint ' + id + ' (' + c.category + ') marked as Resolved.', 'success');
    } else {
      await pushNotif('Complaint ' + id + ' moved to ' + nextStatus + '.', 'info');
    }
  } catch (err) {
    console.warn('BICTS: DB status sync failed.', err);
  }
}

async function pushNotif(msg, type, barangayId = 0) {

  const time =
    new Date().toLocaleTimeString(
      'en-PH',
      {
        hour: '2-digit',
        minute: '2-digit'
      }
    );

  notifStore.unshift({
    msg,
    type,
    time,
    createdAt: new Date().toISOString(),
    unread: true
  });

  renderNotifs();

  const bell =
    document.querySelector('.topbar-action');

  if (bell) {
    bell.style.background = 'var(--sky-light)';

    setTimeout(() => {
      bell.style.background = '';
    }, 1200);
  }

  try {

    const payload = {
      action: 'add_notification',
      msg,
      notif_type: type,
      time
    };

    /*
     * Super Admin notifications must belong
     * to an explicit barangay.
     */
    if (
      (window.CURRENT_USER || {}).role ===
        'super_admin' &&
      Number(barangayId) > 0
    ) {
      payload.barangay_id =
        Number(barangayId);
    }

    const res =
      await fetch(
        API_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify(payload)
        }
      );

    if (!res.ok) {

      const data =
        await res.json()
          .catch(() => ({}));

      throw new Error(
        data.error ||
        'Notification save failed'
      );
    }

  } catch (err) {

    console.warn(
      'BICTS: Notification DB save failed.',
      err
    );
  }
}

function renderAll() {
  renderDashboardStats();
  renderCriticalCases();
  renderComplaints();
  renderPriorityQueue();
  renderKanban();
  renderDashboardDonut();
  renderWeeklyBars();
}

/* ══════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════ */
const SCREEN_TITLES = {
  dashboard:          'Dashboard',
  complaints:         'All Complaints',
  'complaint-detail': 'Complaint Detail',
  priority:           'Priority Queue',
  cases:              'Case Board',
  ai:                 'AI Classification Results',
  reports:            'Reports',
  users:              'User Management',
  notifs:             'Notifications',
  officers:           'Officer Management',

  'activity-logs': 'Activity Logs',
};

function showScreen(id, navEl) {
  // Remove both active classes and any stale inline display values left by
  // previous Safari/mobile boot workarounds. Inline display:block would
  // otherwise override .screen { display:none } and leave Dashboard visible.
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.removeProperty('display');
  });

  const el = document.getElementById('screen-' + id);
  if (el) {
    el.style.removeProperty('display');
    el.classList.add('active');
  }

  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle) topbarTitle.textContent = SCREEN_TITLES[id] || id;

  const content = document.getElementById('content');
  if (content) content.scrollTop = 0;
  if (navEl) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    navEl.classList.add('active');
  }
  if (id === 'users'    && typeof loadUsers === 'function')    loadUsers();
  if (id === 'officers' && typeof loadOfficers === 'function') loadOfficers();

  if (
    id === 'settings' &&
    typeof loadSettingsGeneral === 'function'
  ) {
    loadSettingsGeneral();
  }
}

function doLogout() {
  fetch('api/auth.php?action=logout', {
    credentials:'include',
    cache:'no-store'
  }).finally(() => {
    location.replace('login.html');
  });
}

/* ══════════════════════════════════════════════════════
   CASE NOTES
══════════════════════════════════════════════════════ */
let _currentComplaintNotes = [];
let _currentComplaintId    = null;

async function loadNotes(complaintId) {
  _currentComplaintId    = complaintId;
  _currentComplaintNotes = [];
  try {
    const res  = await fetch(API_URL + '?type=notes&complaint_id=' + encodeURIComponent(complaintId));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _currentComplaintNotes = data.notes || [];
  } catch (err) { console.warn('BICTS: Could not load notes.', err); }
  renderCaseNotes();
}

async function addNote(complaintId, content) {
  const user       = window.CURRENT_USER || {};
  const optimistic = {
    id: null, author: user.name || 'Unknown', author_role: user.role || '',
    content, created_at: new Date().toISOString().slice(0,19).replace('T',' '),
    updated_at: new Date().toISOString().slice(0,19).replace('T',' '),
  };
  _currentComplaintNotes.push(optimistic);
  renderCaseNotes();
  try {
    const res    = await fetch(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_note', complaint_id: complaintId, content,
        author: optimistic.author, author_role: optimistic.author_role,
        barangay_id: user.barangay_id || null }),
    });
    const result = await res.json();
    if (result.success) {
      const idx = _currentComplaintNotes.indexOf(optimistic);
      if (idx !== -1) _currentComplaintNotes[idx] = { ...optimistic, id: result.id, created_at: result.created_at, updated_at: result.updated_at || result.created_at };
      renderCaseNotes();
    } else throw new Error(result.error || 'Server returned failure');
  } catch (err) {
    console.warn('BICTS: Note save failed.', err);
    _currentComplaintNotes = _currentComplaintNotes.filter(n => n !== optimistic);
    renderCaseNotes();
    alert('Could not save the note. Please try again.');
  }
}

function editNote(noteId) {
  const note = _currentComplaintNotes.find(n => n.id === noteId);
  if (!note) return;
  const contentEl = document.getElementById('note-content-' + noteId);
  if (!contentEl) return;
  contentEl.innerHTML =
    '<textarea id="note-edit-ta-' + noteId + '" class="inp ta" style="min-height:70px;margin-bottom:6px;font-size:13px;">' + _escHtml(note.content) + '</textarea>' +
    '<div style="display:flex;gap:6px;justify-content:flex-end;">' +
      '<button class="btn btn-secondary btn-sm" onclick="cancelNoteEdit(' + noteId + ')">Cancel</button>' +
      '<button class="btn btn-primary btn-sm" id="note-save-btn-' + noteId + '" onclick="saveNoteEdit(' + noteId + ')">Save</button>' +
    '</div>';
  const ta = document.getElementById('note-edit-ta-' + noteId);
  if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
  const actionsEl = document.getElementById('note-actions-' + noteId);
  if (actionsEl) actionsEl.style.display = 'none';
}

async function saveNoteEdit(noteId) {
  const ta = document.getElementById('note-edit-ta-' + noteId);
  if (!ta) return;
  const newContent = ta.value.trim();
  if (!newContent) { alert('Note cannot be empty.'); ta.focus(); return; }
  const saveBtn = document.getElementById('note-save-btn-' + noteId);
  if (saveBtn) { saveBtn.textContent = 'Saving…'; saveBtn.disabled = true; }
  try {
    const res    = await fetch(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit_note', id: noteId, content: newContent }),
    });
    const result = await res.json();
    if (result.success) {
      const note = _currentComplaintNotes.find(n => n.id === noteId);
      if (note) { note.content = newContent; note.updated_at = result.updated_at || new Date().toISOString().slice(0,19).replace('T',' '); }
      renderCaseNotes();
    } else throw new Error(result.error || 'Server returned failure');
  } catch (err) {
    console.warn('BICTS: Note edit failed.', err);
    if (saveBtn) { saveBtn.textContent = 'Save'; saveBtn.disabled = false; }
    alert('Could not save the edit. Please try again.');
  }
}

function cancelNoteEdit(noteId) { renderCaseNotes(); }

async function deleteNote(noteId) {
  if (!confirm('Delete this note? This cannot be undone.')) return;
  const removed = _currentComplaintNotes.find(n => n.id === noteId);
  _currentComplaintNotes = _currentComplaintNotes.filter(n => n.id !== noteId);
  renderCaseNotes();
  try {
    const res = await fetch(API_URL, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_note', id: noteId }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Server returned failure');
  } catch (err) {
    console.warn('BICTS: Note delete failed.', err);
    if (removed) { _currentComplaintNotes.push(removed); _currentComplaintNotes.sort((a,b) => new Date(a.created_at)-new Date(b.created_at)); }
    renderCaseNotes();
    alert('Could not delete the note. Please try again.');
  }
}

async function submitNote() {
  const ta      = document.getElementById('note-content');
  const content = (ta ? ta.value : '').trim();
  if (!content) { alert('Please write something before saving.'); return; }
  const btn = document.getElementById('note-submit-btn');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
  await addNote(_currentComplaintId, content);
  if (btn) { btn.textContent = 'Save Note'; btn.disabled = false; }
  if (ta)  ta.value = '';
  hideNoteForm();
}

function showNoteForm() {
  const form = document.getElementById('note-form');
  if (form) form.style.display = 'block';
  const ta = document.getElementById('note-content');
  if (ta) { ta.value = ''; ta.focus(); }
}

function hideNoteForm() {
  const form = document.getElementById('note-form');
  if (form) form.style.display = 'none';
  const ta = document.getElementById('note-content');
  if (ta) ta.value = '';
}

function renderCaseNotes() {
  const el = document.getElementById('case-notes');
  if (!el) return;
  if (_currentComplaintNotes.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:20px 0;"><div class="empty-icon">📝</div><div class="empty-title">No notes yet</div><div class="empty-desc">Add a note to begin tracking case progress.</div></div>';
    return;
  }
  el.innerHTML = _currentComplaintNotes.map(function(n) {
    const initial    = (n.author || '?').charAt(0).toUpperCase();
    const createdStr = _formatNoteDate(n.created_at);
    const wasEdited  = n.updated_at && n.updated_at !== n.created_at && Math.abs(new Date(n.updated_at)-new Date(n.created_at)) > 2000;
    const editedTag  = wasEdited ? '<span style="font-size:10px;color:var(--text3);font-style:italic;"> · edited</span>' : '';
    const canAct     = n.id !== null && window.CURRENT_USER;
    return (
      '<div style="padding:12px 0;border-bottom:1px solid var(--border);" id="note-row-' + n.id + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="width:28px;height:28px;border-radius:50%;background:var(--sky-light);color:var(--blue);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">' + initial + '</div>' +
            '<span style="font-size:12px;font-weight:600;">' + _escHtml(n.author) + '</span>' +
            (n.author_role ? '<span class="badge b-gray" style="font-size:9px;">' + _escHtml(n.author_role) + '</span>' : '') +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;" id="note-actions-' + n.id + '">' +
            '<span style="font-size:10px;color:var(--text3);">' + createdStr + editedTag + '</span>' +
            (canAct ?
              '<button class="btn btn-ghost btn-sm" style="padding:2px 7px;font-size:11px;" onclick="editNote(' + n.id + ')" title="Edit note">✏️</button>' +
              '<button style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text3);padding:2px 4px;" onclick="deleteNote(' + n.id + ')" title="Delete note">✕</button>'
            : '') +
          '</div>' +
        '</div>' +
        '<div id="note-content-' + n.id + '" style="font-size:13px;color:var(--text2);line-height:1.65;padding-left:36px;white-space:pre-wrap;">' + _escHtml(n.content) + '</div>' +
      '</div>'
    );
  }).join('');
}

function _escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _formatNoteDate(rawDate) {
  return typeof formatBarangAIDateTime === 'function'
    ? formatBarangAIDateTime(rawDate)
    : (rawDate || '—');
}

async function loadComplaintStatusHistory(id, complaintObj = null) {
  const c = complaintObj || complaints.find(x => x.id === id);
  if (!c) return [];
  try {
    const res = await fetch(API_URL + '?type=status_history&complaint_id=' + encodeURIComponent(id) + '&_=' + Date.now());
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Could not load status history.');
    c.statusHistory = Array.isArray(data.history) ? data.history : [];
    return c.statusHistory;
  } catch (err) {
    console.warn('BICTS: status history unavailable.', err);
    c.statusHistory = Array.isArray(c.statusHistory) ? c.statusHistory : [];
    return c.statusHistory;
  }
}

/* ══════════════════════════════════════════════════════
   COMPLAINT DETAIL VIEW
══════════════════════════════════════════════════════ */
async function viewComplaint(id) {
  _currentDetailComplaintId = id;
  const c = complaints.find(x => x.id === id);
  if (!c) return;
  const bcEl = document.getElementById('detail-breadcrumb');
  if (bcEl) bcEl.textContent = id + ' – ' + c.category;
  const ptEl = document.getElementById('detail-page-title');
  if (ptEl) ptEl.textContent = id + ' – ' + c.category;
  const badgeRow = document.getElementById('detail-badge-row');
  if (badgeRow) badgeRow.innerHTML =
    '<span class="badge b-blue">' + c.category + '</span>' +
    '<span class="badge ' + c.pb + '">' + c.priority + ' Priority</span>' +
    '<span class="badge ' + c.sb + '">' + c.status + '</span>';
  const resolveBtn = document.getElementById('detail-resolve-btn');
  if (resolveBtn) {
    if (c.status !== 'Resolved') {
      resolveBtn.textContent = '✓ Resolve'; resolveBtn.style.color = 'var(--green)'; resolveBtn.style.borderColor = 'var(--green)';
      resolveBtn.onclick = async () => { await resolveComplaint(id); await viewComplaint(id); };
    } else {
      resolveBtn.textContent = '✓ Resolved'; resolveBtn.style.color = 'var(--text3)'; resolveBtn.style.borderColor = 'var(--border)';
      resolveBtn.onclick = null;
    }
  }
  const closeBtn = document.getElementById('detail-close-btn');
  if (closeBtn) {
    if (c.status === 'Closed') {
      closeBtn.textContent = '⊘ Closed'; closeBtn.style.color = 'var(--text3)'; closeBtn.onclick = null; closeBtn.style.display = 'inline-flex';
    } else if (c.status === 'Resolved') {
      closeBtn.style.display = 'none';
    } else {
      closeBtn.textContent = '⊘ Close Case'; closeBtn.style.color = 'var(--text3)'; closeBtn.style.display = 'inline-flex';
      closeBtn.onclick = () => openCloseModal(id);
    }
  }
  await loadComplaintStatusHistory(id, c);

  const fieldMap = {
    'detail-date-filed':         formatBarangAIDateTime(c.createdAt),
    'detail-incident-date':      formatIncidentDateTime(c.incidentDate, c.incidentTime),
    'detail-location':           c.location    || '—',
    'detail-affected':           c.affected    || '—',
    'detail-complainant':        c.complainant || 'Anonymous',
    'detail-officer':            c.officer     || '—',
    'detail-officer-assigned':   c.officerAssignedAt ? formatBarangAIDateTime(c.officerAssignedAt) : (c.officer && c.officer !== '—' ? 'Timestamp unavailable for older record' : 'Pending assignment'),
  };
  Object.entries(fieldMap).forEach(([elId, val]) => { const el = document.getElementById(elId); if (el) el.textContent = val; });
  const descEl = document.getElementById('detail-description');
  if (descEl) descEl.textContent = c.description || 'No description provided.';
  renderDetailNlpBars(c);
  renderDetailAhp(c);
  renderDetailTimeline(c);
  hideNoteForm();
  await loadNotes(id);
  showScreen('complaint-detail', null);
  document.getElementById('topbar-title').textContent = id + ' – ' + c.category;
}

/* ══════════════════════════════════════════════════════
   MODALS
══════════════════════════════════════════════════════ */
function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
  if (id === 'submitModal') resetWizard();
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
function initModalBackdropClose() {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
  });
}

/* ══════════════════════════════════════════════════════
   SUBMIT COMPLAINT WIZARD
══════════════════════════════════════════════════════ */
let wizardStep    = 1;
const TOTAL_STEPS = 4;
let _lastAiResult = { cat: CATEGORIES[0], conf: 75, scores: {} };

function resetWizard() {
  wizardStep = 1;
  renderWizardStep();
  ['w-date','w-time','w-location','w-description','w-complainant','w-affected']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function wizardNext() {
  if (wizardStep === 1) {
    const loc  = (document.getElementById('w-location')?.value  || '').trim();
    const desc = (document.getElementById('w-description')?.value || '').trim();
    if (!loc || !desc) { alert('Please fill in Location and Description before proceeding.'); return; }
  }
  if (wizardStep < TOTAL_STEPS) {
    wizardStep++;
    renderWizardStep();
    if (wizardStep === 3) runAiClassification();
  }
}

function wizardBack() {
  if (wizardStep > 1) { wizardStep--; renderWizardStep(); }
}

async function wizardSubmit() {
  const description = document.getElementById('w-description')?.value || '';
  const affected    = document.getElementById('w-affected')?.value    || '1';
  const complainantInput = (document.getElementById('w-complainant')?.value || '').trim();
  if (!_runtimeSettings.allow_anonymous && !complainantInput) {
    alert('Anonymous complaints are disabled. Please provide the complainant name.');
    return;
  }
  const cat         = _lastAiResult.cat;
  const conf        = _lastAiResult.conf;
  const ahp         = computeAHPScore(cat, affected, description);
  const priInfo     = priorityLabel(ahp.score);
  const submitBtn   = document.getElementById('wizard-submit');
  if (submitBtn) { submitBtn.textContent = 'Saving…'; submitBtn.disabled = true; }
  await addComplaint({
    description,
    location:    document.getElementById('w-location')?.value    || '',
    date:        document.getElementById('w-date')?.value        || '',
    time:        document.getElementById('w-time')?.value        || '',
    complainant: complainantInput || 'Anonymous',
    affected, category: cat, confidence: conf,
    score: ahp.score.toString(), priority: priInfo.label,
    pb: priInfo.badge, officer: '—', status: 'Open', sb: 'b-gray',
  });
  await pushNotif('New complaint — ' + cat + ' · Priority: ' + priInfo.label, 'info');
  if (submitBtn) { submitBtn.textContent = '✓ Submit Complaint'; submitBtn.disabled = false; }
  wizardStep = 5;
  renderWizardStep();
}

function renderWizardStep() {
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const numEl = document.getElementById('ws-n-' + i);
    const lblEl = document.getElementById('ws-l-' + i);
    if (!numEl) continue;
    const state       = i < wizardStep ? 'done' : i === wizardStep ? 'cur' : 'todo';
    numEl.className   = 'wizard-step-n '     + state;
    if (lblEl) lblEl.className = 'wizard-step-label ' + state;
    numEl.textContent = i < wizardStep ? '✓' : String(i);
  }
  document.querySelectorAll('.wizard-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(wizardStep <= TOTAL_STEPS ? 'wp-' + wizardStep : 'wp-success');
  if (panel) panel.classList.add('active');
  const backBtn   = document.getElementById('wizard-back');
  const nextBtn   = document.getElementById('wizard-next');
  const submitBtn = document.getElementById('wizard-submit');
  const cancelBtn = document.getElementById('wizard-cancel');
  const doneBtn   = document.getElementById('wizard-done');
  if (!backBtn) return;
  if (wizardStep === 5) {
    [backBtn, nextBtn, submitBtn].forEach(b => { b.style.display = 'none'; });
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (doneBtn)   doneBtn.style.display   = 'inline-flex';
    return;
  }
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  if (doneBtn)   doneBtn.style.display   = 'none';
  backBtn.style.display   = wizardStep > 1           ? 'inline-flex' : 'none';
  nextBtn.style.display   = wizardStep < TOTAL_STEPS ? 'inline-flex' : 'none';
  submitBtn.style.display = wizardStep === TOTAL_STEPS ? 'inline-flex' : 'none';
  nextBtn.textContent     = wizardStep === 2 ? 'Next: AI Classify →' : wizardStep === 3 ? 'Next: Confirm →' : 'Next →';
}

function runAiClassification() {
  const desc   = document.getElementById('w-description')?.value || '';
  const result = _runtimeSettings.auto_classify
    ? classifyDescription(desc)
    : { cat: 'Unclassified', conf: 0, scores: {}, scoreType: 'disabled' };
  _lastAiResult = result;
  const catEl  = document.getElementById('ai-cat');
  const confEl = document.getElementById('ai-conf');
  const barsEl = document.getElementById('ai-conf-bars');
  if (catEl)  catEl.textContent  = result.cat;
  if (confEl) confEl.textContent = _runtimeSettings.auto_classify
    ? result.conf + '% relative SVM score · Word (1,3) + char_wb (3,6) TF-IDF'
    : 'Automatic classification is disabled in Settings.';
  if (barsEl) {
    barsEl.innerHTML = CATEGORIES.map(cat => {
      const pct = result.scores[cat] || 3;
      return '<div class="conf-bar">' +
        '<span class="conf-label">' + cat + (cat === result.cat ? ' ★' : '') + '</span>' +
        '<div class="conf-track"><div class="conf-fill" style="width:' + pct + '%;background:' +
        (cat === result.cat ? 'var(--blue)' : 'var(--sky)') + '"></div></div>' +
        '<span class="conf-pct">' + pct + '%</span></div>';
    }).join('');
  }
  const el  = document.getElementById('confirm-rows');
  if (!el) return;
  const aff = document.getElementById('w-affected')?.value || '1';
  const ahp = computeAHPScore(result.cat, aff, desc);
  const pri = priorityLabel(ahp.score);
  el.innerHTML = [
    ['Date',            document.getElementById('w-date')?.value        || '—'],
    ['Time',            document.getElementById('w-time')?.value        || '—'],
    ['Location',        document.getElementById('w-location')?.value    || '—'],
    ['Description',     (desc.length > 80 ? desc.slice(0,80) + '…' : desc)],
    ['Complainant',     document.getElementById('w-complainant')?.value || 'Anonymous'],
    ['Affected',        aff],
    ['AI Category',     result.cat + (_runtimeSettings.auto_classify ? ' (' + result.conf + '% relative SVM score)' : ' (automatic classification disabled)')],
    ['Fuzzy AHP Score', ahp.score + ' / 100 → ' + pri.label],
  ].map(r =>
    '<div class="confirm-row"><span class="confirm-key">' + r[0] + '</span><span class="confirm-val">' + r[1] + '</span></div>'
  ).join('');
}

/* ══════════════════════════════════════════════════════
   FILTER STATE
══════════════════════════════════════════════════════ */
let _activeStatusFilter = 'All';

// Runtime settings that directly affect complaint submission.
// Defaults preserve BarangAI's core behavior until DB-backed settings load.
let _runtimeSettings = { auto_classify: true, allow_anonymous: true };

function filterByStatus(status, el) {
  _activeStatusFilter = status;
  document.querySelectorAll('#screen-complaints .filter-row .chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderComplaints();
}

function filterComplaints() { renderComplaints(); }

/* ══════════════════════════════════════════════════════
   SETTINGS — General tab (DB-backed)
══════════════════════════════════════════════════════ */
async function loadSettingsGeneral() {

  const user =
    window.CURRENT_USER || null;

  const set =
    (id, val) => {
      const el =
        document.getElementById(id);

      if (el) {
        el.value = val || '';
      }
    };

  const tog =
    (id, val) => {
      const el =
        document.getElementById(id);

      if (!el) return;

      el.classList.toggle('on', !!val);
      el.classList.toggle('off', !val);
    };


  /*
   * SUPER ADMIN — ALL BARANGAYS
   */
  if (
    user &&
    user.role === 'super_admin'
  ) {

    const barangayId =
      typeof getSelectedSuperAdminBarangayId === 'function'
        ? getSelectedSuperAdminBarangayId()
        : 0;


    if (barangayId <= 0) {

      set('cfg-barangay-name', '');
      set('cfg-municipality', '');
      set('cfg-admin-email', '');

      tog('tog-auto-classify', false);
      tog('tog-allow-anonymous', false);

      const saveBtn =
        document.getElementById(
          'settings-save-btn'
        );

      if (saveBtn) {
        saveBtn.disabled = true;
      }

      const msg =
        document.getElementById(
          'settings-msg'
        );

      if (msg) {
        msg.style.color =
          'var(--text3)';

        msg.textContent =
          'Select a barangay from the top selector to view or edit its settings.';
      }

      return;
    }
  }


  try {

    let url =
      'api/settings.php?action=get';


    if (
      user &&
      user.role === 'super_admin'
    ) {

      const barangayId =
        getSelectedSuperAdminBarangayId();

      url +=
        '&barangay_id=' +
        encodeURIComponent(barangayId);
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


    if (!res.ok || !data.ok) {
      throw new Error(
        data.error ||
        'Could not load settings.'
      );
    }


    const s =
      data.settings;


    _runtimeSettings.auto_classify =
      !!Number(s.auto_classify);

    _runtimeSettings.allow_anonymous =
      !!Number(s.allow_anonymous);


    set(
      'cfg-barangay-name',
      s.barangay_name
    );

    set(
      'cfg-municipality',
      s.municipality
    );

    set(
      'cfg-admin-email',
      s.admin_email
    );


    tog(
      'tog-auto-classify',
      Number(s.auto_classify) === 1
    );

    tog(
      'tog-allow-anonymous',
      Number(s.allow_anonymous) === 1
    );


    const saveBtn =
      document.getElementById(
        'settings-save-btn'
      );

    if (saveBtn) {
      saveBtn.disabled = false;
    }


    const msg =
      document.getElementById(
        'settings-msg'
      );

    if (msg) {
      msg.textContent = '';
    }


  } catch(e) {

    console.warn(
      'Could not load settings',
      e
    );

    const msg =
      document.getElementById(
        'settings-msg'
      );

    if (msg) {
      msg.style.color =
        'var(--red)';

      msg.textContent =
        e.message ||
        'Could not load settings.';
    }
  }
}

async function saveSettings() {

  const get =
    id => {

      const el =
        document.getElementById(id);

      return el
        ? el.value.trim()
        : '';
    };


  const tog =
    id => {

      const el =
        document.getElementById(id);

      return el
        ? el.classList.contains('on')
        : false;
    };


  const user =
    window.CURRENT_USER || {};


  const msg =
    document.getElementById(
      'settings-msg'
    );


  const btn =
    document.getElementById(
      'settings-save-btn'
    );


  /*
   * Super Admin cannot save ambiguous
   * All Barangays settings.
   */
  let targetBarangayId = 0;


  if (
    user.role === 'super_admin'
  ) {

    targetBarangayId =
      typeof getSelectedSuperAdminBarangayId ===
        'function'
        ? getSelectedSuperAdminBarangayId()
        : 0;


    if (targetBarangayId <= 0) {

      if (msg) {

        msg.style.color =
          'var(--red)';

        msg.textContent =
          'Select a barangay before saving settings.';
      }

      return;
    }
  }


  if (btn) {

    btn.textContent =
      'Saving…';

    btn.disabled = true;
  }


  try {

    const body = {

      barangay_name:
        get('cfg-barangay-name'),

      municipality:
        get('cfg-municipality'),

      admin_email:
        get('cfg-admin-email'),

      auto_classify:
        tog('tog-auto-classify'),

      allow_anonymous:
        tog('tog-allow-anonymous')
    };


    if (
      user.role === 'super_admin'
    ) {

      body.barangay_id =
        targetBarangayId;
    }


    const res =
      await fetch(
        'api/settings.php?action=save',
        {
          method:'POST',

          credentials:'include',

          headers:{
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify(body)
        }
      );


    const data =
      await res.json();


    if (!res.ok || !data.ok) {

      throw new Error(
        data.error ||
        'Failed to save settings.'
      );
    }


    if (msg) {

      msg.textContent =
        '✓ Settings saved successfully.';

      msg.style.color =
        'var(--green)';


      setTimeout(
        () => {
          msg.textContent = '';
        },
        3000
      );
    }


  } catch(e) {

    if (msg) {

      msg.textContent =
        e.message ||
        'Network error. Please try again.';

      msg.style.color =
        'var(--red)';
    }


  } finally {

    if (btn) {

      btn.textContent =
        'Save Settings';


      /*
       * Keep disabled only if Super Admin
       * returned to All Barangays meanwhile.
       */
      btn.disabled =
        user.role === 'super_admin' &&
        (
          typeof getSelectedSuperAdminBarangayId !==
            'function' ||
          getSelectedSuperAdminBarangayId() <= 0
        );
    }
  }
}

/* ══════════════════════════════════════════════════════
   SETTINGS — Audit Log tab
══════════════════════════════════════════════════════ */
async function loadSettingsAuditLog() {

  const tbody =
    document.getElementById(
      'settings-audit-tbody'
    );


  if (!tbody) return;


  tbody.innerHTML =
    '<tr>' +
      '<td colspan="5" ' +
      'style="text-align:center;padding:24px;color:var(--text3);">' +
        'Loading…' +
      '</td>' +
    '</tr>';


  try {

    const user =
      window.CURRENT_USER || {};


    let url =
      'api/settings.php?action=audit';


    if (
      user.role === 'super_admin'
    ) {

      const barangayId =
        typeof getSelectedSuperAdminBarangayId ===
          'function'
          ? getSelectedSuperAdminBarangayId()
          : 0;


      if (barangayId > 0) {

        url +=
          '&barangay_id=' +
          encodeURIComponent(
            barangayId
          );
      }
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
      !data.ok ||
      !data.log ||
      !data.log.length
    ) {

      tbody.innerHTML =
        '<tr>' +
          '<td colspan="5" ' +
          'style="text-align:center;padding:24px;color:var(--text3);">' +
            'No activity recorded yet.' +
          '</td>' +
        '</tr>';

      return;
    }


    tbody.innerHTML =
      data.log.map(r =>
        '<tr>' +

          '<td style="font-size:11px;color:var(--text3);white-space:nowrap">' +
            (r.created_at || '—') +
          '</td>' +

          '<td style="font-weight:500">' +
            _escHtml(
              r.user_name || '—'
            ) +
          '</td>' +

          '<td>' +
            '<span class="badge b-gray" style="font-size:9px">' +
              _escHtml(
                r.action || '—'
              ) +
            '</span>' +
          '</td>' +

          '<td style="font-size:11px">' +
            _escHtml(
              r.detail || '—'
            ) +
          '</td>' +

          '<td style="font-family:var(--mono);font-size:11px">' +
            _escHtml(
              r.ip_address || '—'
            ) +
          '</td>' +

        '</tr>'
      ).join('');


  } catch(e) {

    tbody.innerHTML =
      '<tr>' +
        '<td colspan="5" ' +
        'style="text-align:center;color:var(--red);">' +
          'Failed to load audit log.' +
        '</td>' +
      '</tr>';
  }
}

/* ══════════════════════════════════════════════════════
   SETTINGS — Tab switcher (ALL tabs working)
══════════════════════════════════════════════════════ */
function switchSettingsTab(tabName, el) {
  // Update active tab highlight
  const tabsContainer = document.getElementById('settings-tabs');
  if (tabsContainer) {
    tabsContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (el) {
      el.classList.add('active');
    } else {
      Array.from(tabsContainer.querySelectorAll('.tab')).forEach(t => {
        if (t.textContent.toLowerCase().includes(tabName)) t.classList.add('active');
      });
    }
  }

  // Hide all panels
  ['general','categories','ai','audit','officers'].forEach(name => {
    const p = document.getElementById('settings-panel-' + name);
    if (p) p.style.display = 'none';
  });

  // Show the selected panel
  const active = document.getElementById('settings-panel-' + tabName);
  if (active) active.style.display = '';

  // Lazy-load data per tab
  if (tabName === 'general')   loadSettingsGeneral();
  if (tabName === 'audit')     loadSettingsAuditLog();
  if (tabName === 'officers')  {
    if (_officers.length > 0) { renderOfficersTable(); renderOfficerStats(); }
    else loadOfficers();
  }
  if (tabName === 'categories') renderSettingsCategories();
  if (tabName === 'ai')         renderSettingsAiPerf();
}

/* ══════════════════════════════════════════════════════
   SETTINGS — Categories tab
══════════════════════════════════════════════════════ */
function renderSettingsCategories() {
  const tbody = document.getElementById('categories-tbody');
  if (!tbody) return;
  tbody.innerHTML = CATEGORIES.map((cat, i) => {
    const count   = complaints.filter(c => c.category === cat).length;
    const confs   = complaints.filter(c => c.category === cat && c.confidence).map(c => parseFloat(c.confidence));
    const avgConf = confs.length ? Math.round(confs.reduce((a,b)=>a+b,0)/confs.length) : '—';
    return '<tr>' +
      '<td style="font-family:var(--mono);color:var(--text3)">' + (i+1) + '</td>' +
      '<td style="font-weight:500">' + cat + '</td>' +
      '<td><div style="width:14px;height:14px;border-radius:3px;background:' + CAT_COLORS[cat] + ';display:inline-block;"></div></td>' +
      '<td style="font-family:var(--mono);text-align:center">' + count + '</td>' +
      '<td style="font-family:var(--mono);text-align:center">' + (avgConf !== '—' ? avgConf + '%' : '—') + '</td>' +
    '</tr>';
  }).join('');
}

/* ══════════════════════════════════════════════════════
   SETTINGS — AI Model tab performance bars
══════════════════════════════════════════════════════ */
function renderSettingsAiPerf() {
  const bars = document.getElementById('ai-settings-perf-bars');
  if (bars) {
    bars.innerHTML = MODEL_ACCURACY_BARS.map(({ label, value }) =>
      '<div style="margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">' +
          '<span style="color:var(--text2);font-weight:500">' + label + '</span>' +
          '<span style="color:var(--blue);font-family:var(--mono);font-weight:600">' + value.toFixed(2) + '%</span>' +
        '</div>' +
        '<div class="progress"><div class="progress-fill" style="width:' + value + '%"></div></div>' +
      '</div>'
    ).join('');
  }

  const info = document.getElementById('ai-settings-model-summary');
  if (info) {
    const items = [
      ['Active Model', FINAL_MODEL_INFO.active_model],
      ['Final Modeling Records', FINAL_MODEL_INFO.dataset_size.toLocaleString()],
      ['Training Records', FINAL_MODEL_INFO.training_size.toLocaleString()],
      ['Locked Test Records', FINAL_MODEL_INFO.testing_size.toLocaleString()],
      ['Accuracy', FINAL_MODEL_INFO.accuracy.toFixed(2) + '%'],
      ['Weighted Precision', FINAL_MODEL_INFO.precision.toFixed(2) + '%'],
      ['Weighted Recall', FINAL_MODEL_INFO.recall.toFixed(2) + '%'],
      ['Weighted F1', FINAL_MODEL_INFO.f1.toFixed(2) + '%'],
      ['Feature Configuration', FINAL_MODEL_INFO.feature_configuration],
      ['Feature Extraction', FINAL_MODEL_INFO.feature_extraction],
      ['Best Parameter', FINAL_MODEL_INFO.best_parameter],
      ['Class Weight', FINAL_MODEL_INFO.class_weight],
      ['Exact-text Train/Test Overlap', String(FINAL_MODEL_INFO.duplicate_overlap)],
    ];
    info.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;">' +
      items.map(([k,v]) => '<div style="border:1px solid var(--border);border-radius:var(--r);padding:11px 12px;background:var(--bg);">' +
        '<div style="font-size:9px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">' + k + '</div>' +
        '<div style="font-size:12px;font-weight:600;color:var(--text);word-break:break-word;">' + v + '</div></div>').join('') +
      '</div>';
  }

  const tbody = document.getElementById('ai-settings-category-tbody');
  if (tbody) {
    tbody.innerHTML = PER_CATEGORY_REPORT.map(r =>
      '<tr><td style="font-weight:500">' + r.cat + '</td>' +
      '<td>' + (parseFloat(r.prec) * 100).toFixed(2) + '%</td>' +
      '<td>' + (parseFloat(r.rec) * 100).toFixed(2) + '%</td>' +
      '<td><strong>' + (parseFloat(r.f1) * 100).toFixed(2) + '%</strong></td>' +
      '<td style="font-family:var(--mono)">' + r.sup + '</td></tr>'
    ).join('');
  }
}

/* ══════════════════════════════════════════════════════
   MISC UI INIT
══════════════════════════════════════════════════════ */
function toggleSetting(el) {
  el.classList.toggle('on');
  el.classList.toggle('off');
}

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', function() {
      this.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
    });
  });
}

/* ══════════════════════════════════════════════════════
   OFFICER MANAGEMENT
══════════════════════════════════════════════════════ */
async function loadOfficers() {

  try {

    const res =
      await fetch(
        API_URL + '?type=officers',
        {
          credentials:'include',
          cache:'no-store'
        }
      );

    if (!res.ok) {
      throw new Error(
        'HTTP ' + res.status
      );
    }

    const data =
      await res.json();

    const loaded =
      Array.isArray(data.officers)
        ? data.officers
        : [];


    if (
      (window.CURRENT_USER || {}).role ===
      'super_admin'
    ) {

      _allOfficers = loaded;

      applySuperAdminContext();

      return;

    } else {

      _officers = loaded;

      _allOfficers =
        [...loaded];
    }

  } catch (err) {

    console.warn(
      'BICTS: Could not load officers.',
      err
    );
  }


  renderOfficersTable();

  renderOfficerStats();
}

function renderOfficersTable() {
  const tbody = document.getElementById('officers-tbody');
  if (!tbody) return;
  if (_officers.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center;padding:48px;color:var(--text3);">' +
        '<div style="font-size:28px;margin-bottom:8px;">👮</div>' +
        '<div style="font-weight:600;margin-bottom:4px;">No officers yet</div>' +
        '<div style="font-size:11px;">Click <strong>+ Add Officer</strong> to get started.</div>' +
      '</td></tr>';
    return;
  }
  tbody.innerHTML = _officers.map(function(o) {
    const isActive   = o.status === 'Active';
    const badgeCls   = isActive ? 'b-green' : 'b-gray';
    const activeCases = complaints.filter(function(c) {
      return String(c.officer_id) === String(o.id) && c.status !== 'Resolved' && c.status !== 'Closed';
    }).length;
    return (
      '<tr>' +
        '<td><div style="font-weight:600;">' + _escHtml(o.name) + '</div>' +
          (activeCases > 0 ? '<div style="font-size:10px;color:var(--text3);">' + activeCases + ' active case' + (activeCases!==1?'s':'') + '</div>' : '') +
        '</td>' +
        '<td>' + _escHtml(o.rank    || '—') + '</td>' +
        '<td>' + _escHtml(o.contact || '—') + '</td>' +
        '<td style="font-size:12px">' + _escHtml(o.email || '—') + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + _escHtml(o.status) + '</span></td>' +
        '<td><div style="display:flex;gap:6px;">' +
          '<button class="btn btn-ghost btn-sm" onclick="openEditOfficer(' + o.id + ')" style="font-size:11px;">✏️ Edit</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="deleteOfficer(' + o.id + ')" style="font-size:11px;color:var(--red,#dc2626);">✕ Delete</button>' +
        '</div></td>' +
      '</tr>'
    );
  }).join('');
}

function renderOfficerStats() {
  const total    = _officers.length;
  const active   = _officers.filter(o => o.status === 'Active').length;
  const inactive = _officers.filter(o => o.status === 'Inactive').length;
  const t = document.getElementById('officer-stat-total');
  const a = document.getElementById('officer-stat-active');
  const i = document.getElementById('officer-stat-inactive');
  if (t) t.textContent = total;
  if (a) a.textContent = active;
  if (i) i.textContent = inactive;
}

function openAddOfficer() {

  const user =
    window.CURRENT_USER || {};

  /*
   * Super Admin must choose a barangay
   * before creating an officer.
   */
  if (
    user.role === 'super_admin' &&
    getSelectedSuperAdminBarangayId() <= 0
  ) {

    alert(
      'Select a barangay from the All Barangays selector before adding an officer.'
    );

    return;
  }

  _editingOfficerId = null;

  const titleEl =
    document.getElementById(
      'officer-modal-title'
    );

  if (titleEl) {
    titleEl.textContent = 'Add Officer';
  }

  _clearOfficerForm();

  showModal('officerModal');
}

function openEditOfficer(id) {
  const o = _officers.find(x => String(x.id) === String(id));
  if (!o) return;
  _editingOfficerId = id;
  const titleEl = document.getElementById('officer-modal-title');
  if (titleEl) titleEl.textContent = 'Edit Officer';
  _setField('om-name', o.name||''); _setField('om-rank', o.rank||'');
  _setField('om-contact', o.contact||''); _setField('om-email', o.email||'');
  _setField('om-status', o.status||'Active');
  const msgEl = document.getElementById('om-msg');
  if (msgEl) msgEl.textContent = '';
  showModal('officerModal');
}

async function submitOfficer() {
  const name    = (_getField('om-name')    || '').trim();
  const rank    = (_getField('om-rank')    || '').trim();
  const contact = (_getField('om-contact') || '').trim();
  const email   = (_getField('om-email')   || '').trim();
  const status  = _getField('om-status') || 'Active';
  const msgEl   = document.getElementById('om-msg');
  if (!name) {
    if (msgEl) { msgEl.textContent = 'Officer name is required.'; msgEl.style.color = 'var(--red,#dc2626)'; }
    document.getElementById('om-name')?.focus();
    return;
  }
  const btn = document.getElementById('om-submit-btn');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
  const isEdit  = _editingOfficerId !== null;
  const payload = { action: isEdit ? 'edit_officer' : 'add_officer', name, rank, contact, email, status };

  if (
  !isEdit &&
  (window.CURRENT_USER || {}).role ===
    'super_admin'
) {

  const selectedBarangayId =
    getSelectedSuperAdminBarangayId();

  if (selectedBarangayId <= 0) {

    if (msgEl) {
      msgEl.textContent =
        'Select a barangay before adding an officer.';

      msgEl.style.color =
        'var(--red,#dc2626)';
    }

    if (btn) {
      btn.textContent =
        'Save Officer';

      btn.disabled = false;
    }

    return;
  }

  payload.barangay_id =
    selectedBarangayId;
}

  if (isEdit) payload.id = _editingOfficerId;
  try {
    const res    = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await res.json();
    if (result.success) {
      closeModal('officerModal');
      if (isEdit) {
        const idx = _officers.findIndex(x => String(x.id) === String(_editingOfficerId));
        if (idx !== -1) _officers[idx] = Object.assign(_officers[idx], { name, rank, contact, email, status });
        complaints.forEach(c => { if (String(c.officer_id) === String(_editingOfficerId)) c.officer = name; });
        renderAll();
      } else {
        const newOfficer = {

            id: result.id,
            name,
            rank,
            contact,
            email,
            status,

            barangay_id:
              (window.CURRENT_USER || {}).role ===
              'super_admin'
                ? getSelectedSuperAdminBarangayId()
                : Number(
                    (window.CURRENT_USER || {})
                      .barangay_id || 0
                  ),

            created_at:
              new Date()
                .toISOString()
                .slice(0,19)
                .replace('T',' ')
          };


          _officers.push(newOfficer);

          _allOfficers.push(newOfficer);
      }
      renderOfficersTable(); renderOfficerStats();
      const notifBarangayId =
        (window.CURRENT_USER || {}).role ===
          'super_admin'
            ? getSelectedSuperAdminBarangayId()
            : Number(
                (window.CURRENT_USER || {})
                  .barangay_id || 0
              );

      await pushNotif(
        isEdit
          ? 'Officer updated: ' + name
          : 'New officer added: ' + name,
        'success',
        notifBarangayId
      );
    } else {
      if (msgEl) { msgEl.textContent = result.error || 'Failed to save officer.'; msgEl.style.color = 'var(--red,#dc2626)'; }
    }
  } catch (err) {
    console.warn('BICTS: Officer save failed.', err);
    if (msgEl) { msgEl.textContent = 'Network error — please try again.'; msgEl.style.color = 'var(--red,#dc2626)'; }
  } finally {
    if (btn) { btn.textContent = 'Save Officer'; btn.disabled = false; }
  }
}

async function deleteOfficer(id) {
  const o = _officers.find(x => String(x.id) === String(id));
  if (!o) return;
  const activeCases = complaints.filter(c => String(c.officer_id) === String(id) && c.status !== 'Resolved' && c.status !== 'Closed').length;
  const warning = activeCases > 0 ? '\n\nWarning: this officer has ' + activeCases + ' active case(s) — they will be unassigned.' : '';
  if (!confirm('Delete officer "' + o.name + '"? This cannot be undone.' + warning)) return;
  try {
    const res    = await fetch(API_URL, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_officer', id }) });
    const result = await res.json();
    if (result.success) {
      _officers = _officers.filter(x => String(x.id) !== String(id));
      complaints.forEach(c => { if (String(c.officer_id) === String(id)) { c.officer = '—'; c.officer_id = 0; } });
      renderOfficersTable(); renderOfficerStats(); renderAll();
      await pushNotif('Officer "' + o.name + '" removed.', 'info');
    } else { alert(result.error || 'Could not delete officer. Please try again.'); }
  } catch (err) { console.warn('BICTS: Officer delete failed.', err); alert('Network error — please try again.'); }
}

/* ══════════════════════════════════════════════════════
   ASSIGN OFFICER MODAL
══════════════════════════════════════════════════════ */
async function openAssignModal(complaintId) {
  if (isViewer()) return;
  if (!complaintId) return;
  _assignComplaintId = complaintId;
  if (_officers.length === 0) await loadOfficers();
  const select = document.getElementById('assign-officer-select');
  const msgEl  = document.getElementById('assign-msg');
  const ctxEl  = document.getElementById('assign-complaint-ctx');
  if (msgEl) msgEl.textContent = '';
  const c = complaints.find(x => x.id === complaintId);
  if (ctxEl && c) {
    ctxEl.innerHTML =
      '<span class="badge b-blue">'       + _escHtml(c.category||'—') + '</span>' +
      '<span class="badge b-gray">'       + _escHtml(c.id)            + '</span>' +
      '<span class="badge ' + c.pb + '">' + _escHtml(c.priority||'—') + ' Priority</span>';
  }
  if (select) {
    const activeOfficers = _officers.filter(o => o.status === 'Active');
    const caseCount = {};
    complaints.forEach(comp => {
      if (comp.officer_id && comp.status !== 'Resolved' && comp.status !== 'Closed')
        caseCount[comp.officer_id] = (caseCount[comp.officer_id] || 0) + 1;
    });
    if (activeOfficers.length === 0) {
      select.innerHTML = '<option value="">No active officers — add some in Settings → Officers</option>';
    } else {
      select.innerHTML = '<option value="">-- Select Officer --</option>' +
        activeOfficers.map(o => {
          const n     = caseCount[o.id] || 0;
          const label = _escHtml(o.name) + (o.rank ? ' · ' + _escHtml(o.rank) : '') + '  (' + n + ' active case' + (n!==1?'s':'') + ')';
          return '<option value="' + o.id + '" data-name="' + _escHtml(o.name) + '">' + label + '</option>';
        }).join('');
    }
    if (c && c.officer_id) select.value = String(c.officer_id);
  }
  const dateEl = document.getElementById('assign-target-date');
  if (dateEl) dateEl.value = '';
  showModal('assignModal');
}

async function submitAssignOfficer() {
  const select  = document.getElementById('assign-officer-select');
  const dateEl  = document.getElementById('assign-target-date');
  const msgEl   = document.getElementById('assign-msg');
  const btn     = document.getElementById('assign-submit-btn');
  if (!select || !select.value) {
    if (msgEl) { msgEl.textContent = 'Please select an officer.'; msgEl.style.color = 'var(--red,#dc2626)'; }
    return;
  }
  if (msgEl) msgEl.textContent = '';
  const officerId   = parseInt(select.value, 10);
  const selectedOpt = select.options[select.selectedIndex];
  const officerName = selectedOpt.getAttribute('data-name') || (selectedOpt.text.split(' · ')[0].split('(')[0].trim());
  if (btn) { btn.textContent = 'Assigning…'; btn.disabled = true; }
  try {
    const res    = await fetch(API_URL, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'assign_officer', complaint_id: _assignComplaintId, officer_id: officerId, officer_name: officerName, target_date: dateEl ? dateEl.value : '' }),
    });
    const result = await res.json();
    if (result.success) {
      const c = complaints.find(x => x.id === _assignComplaintId);
      if (c) {
        c.officer = officerName;
        c.officer_id = officerId;
        c.officerAssignedAt = result.assigned_at || c.officerAssignedAt;
      }
      const detailEl = document.getElementById('detail-officer');
      if (detailEl) detailEl.textContent = officerName;
      const assignedEl = document.getElementById('detail-officer-assigned');
      if (assignedEl && c) assignedEl.textContent = c.officerAssignedAt ? formatBarangAIDateTime(c.officerAssignedAt) : '—';
      if (c && typeof renderDetailTimeline === 'function') renderDetailTimeline(c);
      renderAll();
      closeModal('assignModal');
      await pushNotif('Officer "' + officerName + '" assigned to complaint ' + _assignComplaintId + '.', 'success');
    } else {
      if (msgEl) { msgEl.textContent = result.error || 'Assignment failed — please try again.'; msgEl.style.color = 'var(--red,#dc2626)'; }
    }
  } catch (err) {
    console.warn('BICTS: Officer assignment failed.', err);
    if (msgEl) { msgEl.textContent = 'Network error — please try again.'; msgEl.style.color = 'var(--red,#dc2626)'; }
  } finally {
    if (btn) { btn.textContent = 'Assign Officer'; btn.disabled = false; }
  }
}

/* ══════════════════════════════════════════════════════
   PRIVATE HELPERS
══════════════════════════════════════════════════════ */
function _clearOfficerForm() {
  ['om-name','om-rank','om-contact','om-email'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  _setField('om-status', 'Active');
  const msgEl = document.getElementById('om-msg');
  if (msgEl) msgEl.textContent = '';
}
function _getField(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function _setField(id, value) { const el = document.getElementById(id); if (el) el.value = value; }

/* ══════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  await initClassifier();
  await initFuzzyAHP();
  await loadFromDB();

  renderAccuracyBars();
  renderDashboardDonut();
  renderDatasetVersionTable();
  renderModelComparison();
  renderF1Table();
  renderNlpPipeline();
  renderAugTags();
  renderReports();
  renderIsoEval();
  renderUsers();

  // Load barangay-specific settings automatically
  // only for a normal Barangay Admin.
  // Super Admin must first select an explicit barangay.
  if (
    window.CURRENT_USER &&
    window.CURRENT_USER.role === 'admin'
  ) {
    loadSettingsGeneral();
  }
  // Show only the General panel by default, hide the rest
  ['categories','ai','audit','officers'].forEach(name => {
    const p = document.getElementById('settings-panel-' + name);
    if (p) p.style.display = 'none';
  });

  initModalBackdropClose();
  initTabs();
});