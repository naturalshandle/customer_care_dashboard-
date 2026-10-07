/* =====================================================================
   Naturals Complaint Desk — plain JavaScript app on Supabase
   Screens: login · dashboard · complaints list · complaint detail · new/edit form
   ===================================================================== */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const STATUSES = ['Open', 'In Progress', 'Escalated', 'Resolved', 'Closed', 'Reopened'];
  const DONE = ['Resolved', 'Closed'];
  const SEVERITIES = ['Critical', 'High', 'Moderate', 'Low'];
  const SEV_HINT = {
    Critical: 'Injury, burn, allergy, infection, hygiene — 24 hrs',
    High: 'Service damage, refund, staff behaviour — 48 hrs',
    Moderate: 'Service quality, waiting, billing — 5 days',
    Low: 'Suggestions, minor feedback — 7 days'
  };
  const PAGE_SIZE = 50;

  const LABELS = {
    ticket_no: 'Ticket No', month: 'Month', complaint_date: 'Date', created_time: 'Created time',
    contact_name: 'Contact name', contact_no: 'Contact no', email_id: 'Email ID',
    salon_id: 'Salon ID', outer_id: 'Outer ID', location: 'Location', region: 'Region', rm: 'RM', cm: 'CM',
    mode_of_complaint: 'Mode of complaint', category: 'Category (Ticket)', service_category: 'Service category',
    ticket_description: 'Ticket description', severity: 'Severity', due_at: 'Due by',
    from_ckk: 'From CKK', ckk_forwarded_date: 'CKK forwarded date',
    executive: 'Executive', trainer: 'Trainer', status: 'Status', resolution: 'Resolution', remarks: 'Remarks',
    reminder_1: 'Reminder 1', reminder_2: 'Reminder 2', reminder_3: 'Reminder 3', notes: 'Notes',
    closed_date: 'Closed date', duration_hours: 'Duration', created_by: 'Created by'
  };

  // ---------------------------------------------------------------- state
  let sb = null;
  let session = null;
  const state = {
    rows: null,            // cached complaints_dashboard rows
    lookups: null,         // { mode: [...], category: [...], ... }
    salons: null,          // [{ salon_id, outer_id, location, region, rm, cm }]
    profiles: null,        // { uuid: name }
    charts: []
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const view = () => $('#view');

  // ---------------------------------------------------------------- utils
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(v) {
    if (!v) return '';
    const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v);
    if (isNaN(d)) return '';
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  }
  function fmtDateTime(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return '';
    let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${fmtDate(d)} ${h}:${pad(d.getMinutes())} ${ap}`;
  }
  function fmtDuration(hours) {
    if (hours == null || hours === '') return '';
    const h = Number(hours);
    if (h < 24) return `${h.toFixed(1)} hrs`;
    return `${(h / 24).toFixed(1)} days`;
  }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function monthKey(dateStr) { return dateStr ? dateStr.slice(0, 7) : ''; }           // 2026-01
  function monthLabel(key) {
    if (!key) return '';
    const [y, m] = key.split('-');
    return new Date(+y, +m - 1, 1).toLocaleString('en-IN', { month: 'short' }) + ' ' + y.slice(2);
  }
  function isOpen(r) { return !DONE.includes(r.status); }
  function chipSeverity(s) { return s ? `<span class="chip sev-${esc(s)}">${esc(s)}</span>` : ''; }
  function chipStatus(s) { return s ? `<span class="chip st-${esc(s.replace(/\s+/g, '-'))}">${esc(s)}</span>` : ''; }
  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (isError ? ' error' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3000);
  }
  function friendlyError(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/row-level security|permission denied/i.test(m)) return 'You do not have permission to do that.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Cannot reach the server. Check your internet connection.';
    return m;
  }
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [path, qs] = h.split('?');
    const params = Object.fromEntries(new URLSearchParams(qs || ''));
    return { parts: path.split('/'), params };
  }
  function countBy(rows, fn) {
    const m = new Map();
    rows.forEach(r => { const k = fn(r) || 'Not set'; m.set(k, (m.get(k) || 0) + 1); });
    return m;
  }
  function topN(map, n) { return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n); }
  function uniqSorted(arr) { return [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b))); }
  function nullIfEmpty(v) { return v === '' || v == null ? null : v; }

  // ---------------------------------------------------------------- data
  async function fetchAll(table, select, order) {
    const out = []; const step = 1000;
    for (let from = 0; ; from += step) {
      let q = sb.from(table).select(select).range(from, from + step - 1);
      if (order) q = q.order(order.col, { ascending: !!order.asc });
      const { data, error } = await q;
      if (error) throw error;
      out.push(...data);
      if (data.length < step) break;
    }
    return out;
  }
  async function loadRows(force) {
    if (state.rows && !force) return state.rows;
    state.rows = await fetchAll('complaints_dashboard', '*', { col: 'created_time', asc: false });
    return state.rows;
  }
  async function loadLookups() {
    if (state.lookups) return state.lookups;
    const [lk, salons] = await Promise.all([
      fetchAll('lookups', 'type,value,active'),
      fetchAll('salons', 'salon_id,outer_id,location,region,rm,cm,active', { col: 'salon_id', asc: true })
    ]);
    const g = {};
    lk.filter(x => x.active !== false).forEach(x => { (g[x.type] = g[x.type] || []).push(x.value); });
    Object.keys(g).forEach(k => g[k].sort((a, b) => a.localeCompare(b)));
    state.lookups = g;
    state.salons = salons.filter(s => s.active !== false);
    return g;
  }
  async function loadProfiles() {
    if (state.profiles) return state.profiles;
    const { data } = await sb.from('profiles').select('id,full_name');
    state.profiles = Object.fromEntries((data || []).map(p => [p.id, p.full_name]));
    return state.profiles;
  }
  function invalidate() { state.rows = null; state.lookups = null; }

  // ---------------------------------------------------------------- auth
  async function init() {
    $('#app-name').textContent = CFG.APP_NAME || 'Complaint Desk';
    $('#login-title').textContent = CFG.APP_NAME || 'Complaint Desk';
    document.title = CFG.APP_NAME || 'Complaint Desk';

    const keyMissing = !CFG.SUPABASE_ANON_KEY || /PASTE/i.test(CFG.SUPABASE_ANON_KEY);
    if (keyMissing || !window.supabase) {
      $('#config-warning').hidden = false;
      $('#login-screen').hidden = false;
      $('#login-btn').disabled = true;
      return;
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

    $('#login-form').addEventListener('submit', onLogin);
    $('#logout-btn').addEventListener('click', async () => { await sb.auth.signOut(); });
    window.addEventListener('hashchange', route);

    const { data } = await sb.auth.getSession();
    setSession(data.session);
    sb.auth.onAuthStateChange((_evt, s) => setSession(s));
  }

  function setSession(s) {
    const was = !!session; session = s;
    if (!s) {
      $('#app').hidden = true; $('#login-screen').hidden = false;
      state.rows = state.lookups = state.profiles = null;
      return;
    }
    $('#login-screen').hidden = true; $('#app').hidden = false;
    $('#user-email').textContent = s.user.email;
    if (!was) route();
  }

  async function onLogin(e) {
    e.preventDefault();
    const btn = $('#login-btn'); const err = $('#login-error');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({
      email: $('#login-email').value.trim(), password: $('#login-password').value
    });
    btn.disabled = false; btn.textContent = 'Sign in';
    if (error) { err.textContent = /invalid/i.test(error.message) ? 'Wrong email or password.' : friendlyError(error); err.hidden = false; }
  }

  // ---------------------------------------------------------------- router
  async function route() {
    if (!session) return;
    state.charts.forEach(c => c.destroy()); state.charts = [];
    const { parts, params } = parseHash();
    const page = parts[0];
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === page || (page === 'complaint' && a.dataset.nav === 'complaints')));
    window.scrollTo(0, 0);
    try {
      if (page === 'complaints') await renderList(params);
      else if (page === 'complaint' && parts[1]) await renderDetail(parts[1]);
      else if (page === 'new') await renderForm(null);
      else if (page === 'edit' && parts[1]) await renderForm(parts[1]);
      else await renderDashboard(params);
    } catch (e) {
      console.error(e);
      view().innerHTML = `<div class="card empty">Something went wrong: ${esc(friendlyError(e))}<br><br>
        <button class="btn" onclick="location.reload()">Reload</button></div>`;
    }
  }

  // ---------------------------------------------------------------- shared filters
  function applyFilters(rows, f) {
    const q = (f.q || '').toLowerCase().trim();
    return rows.filter(r => {
      if (f.from && (!r.complaint_date || r.complaint_date < f.from)) return false;
      if (f.to && (!r.complaint_date || r.complaint_date > f.to)) return false;
      if (f.region && r.region !== f.region) return false;
      if (f.severity && r.severity !== f.severity) return false;
      if (f.service && r.service_category !== f.service) return false;
      if (f.rm && r.rm !== f.rm) return false;
      if (f.status === 'active' && !isOpen(r)) return false;
      if (f.status === 'done' && isOpen(r)) return false;
      if (f.status && !['active', 'done'].includes(f.status) && r.status !== f.status) return false;
      if (f.ckk === '1' && !r.from_ckk) return false;
      if (f.overdue === '1' && !r.is_overdue) return false;
      if (f.reminder === '1' && !r.reminder_due_today) return false;
      if (q) {
        const hay = [r.ticket_no, r.contact_name, r.contact_no, r.email_id, r.salon_id, r.location, r.ticket_description]
          .join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }
  function options(list, selected, allLabel) {
    return `<option value="">${esc(allLabel)}</option>` +
      list.map(v => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
  }

  // ---------------------------------------------------------------- dashboard
  async function renderDashboard(params) {
    view().innerHTML = '<div class="loading">Loading dashboard…</div>';
    const rows = await loadRows();
    const f = { from: params.from || '', to: params.to || '', region: params.region || '', severity: params.severity || '' };
    const regions = uniqSorted(rows.map(r => r.region));

    view().innerHTML = `
      <div class="page-head">
        <div><h1>Dashboard</h1><div class="muted small">${rows.length} complaints in total</div></div>
        <a class="btn btn-primary" href="#/new">+ New complaint</a>
      </div>
      <form class="filters card" id="dash-filters">
        <label>From<input type="date" name="from" value="${esc(f.from)}"></label>
        <label>To<input type="date" name="to" value="${esc(f.to)}"></label>
        <label>Region<select name="region">${options(regions, f.region, 'All regions')}</select></label>
        <label>Severity<select name="severity">${options(SEVERITIES, f.severity, 'All severities')}</select></label>
        <button type="button" class="btn" id="dash-reset">Reset</button>
      </form>
      <div id="dash-body"></div>`;

    const form = $('#dash-filters');
    form.addEventListener('change', () => {
      const p = new URLSearchParams(Object.entries(Object.fromEntries(new FormData(form))).filter(([, v]) => v));
      location.hash = '#/dashboard' + (p.toString() ? '?' + p : '');
    });
    $('#dash-reset').addEventListener('click', () => { location.hash = '#/dashboard'; });

    const data = applyFilters(rows, f);
    const linkBase = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    const link = (extra) => {
      const p = new URLSearchParams(linkBase); Object.entries(extra).forEach(([k, v]) => p.set(k, v));
      return '#/complaints?' + p;
    };

    const open = data.filter(isOpen);
    const closedWithDur = data.filter(r => !isOpen(r) && r.duration_hours != null);
    const avgDays = closedWithDur.length
      ? (closedWithDur.reduce((s, r) => s + Number(r.duration_hours), 0) / closedWithDur.length / 24).toFixed(1) : '–';

    const kpi = (label, value, cls, href) =>
      `<div class="card kpi ${cls || ''} ${href ? 'clickable' : ''}" ${href ? `data-href="${esc(href)}"` : ''}>
         <div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div></div>`;

    $('#dash-body').innerHTML = `
      <div class="grid kpis">
        ${kpi('Total complaints', data.length, '', link({}))}
        ${kpi('Open', open.length, 'warn', link({ status: 'active' }))}
        ${kpi('Closed / resolved', data.length - open.length, 'good', link({ status: 'done' }))}
        ${kpi('Overdue', data.filter(r => r.is_overdue).length, 'alert', link({ overdue: '1' }))}
        ${kpi('Critical still open', open.filter(r => r.severity === 'Critical').length, 'alert', link({ status: 'active', severity: 'Critical' }))}
        ${kpi('Reminders due today', data.filter(r => r.reminder_due_today).length, 'warn', link({ reminder: '1' }))}
        ${kpi('From CKK Sir', data.filter(r => r.from_ckk).length, '', link({ ckk: '1' }))}
        ${kpi('Avg. time to close', avgDays === '–' ? '–' : avgDays + ' days', '')}
      </div>
      ${data.length ? `
      <div class="grid charts">
        <div class="card chart-card span-2"><h2>Complaints per month</h2><div class="chart-box"><canvas id="ch-month"></canvas></div></div>
        <div class="card chart-card"><h2>By status</h2><div class="chart-box"><canvas id="ch-status"></canvas></div></div>
        <div class="card chart-card"><h2>Open complaints by severity</h2><div class="chart-box"><canvas id="ch-sev"></canvas></div></div>
        <div class="card chart-card"><h2>By region</h2><div class="chart-box"><canvas id="ch-region"></canvas></div></div>
        <div class="card chart-card"><h2>By service category</h2><div class="chart-box"><canvas id="ch-service"></canvas></div></div>
        <div class="card chart-card"><h2>By mode of complaint</h2><div class="chart-box"><canvas id="ch-mode"></canvas></div></div>
        <div class="card chart-card"><h2>Open complaints by RM</h2><div id="rm-table"></div></div>
      </div>` : '<div class="card empty">No complaints match these filters.</div>'}`;

    $$('.kpi.clickable').forEach(el => el.addEventListener('click', () => { location.hash = el.dataset.href; }));
    if (!data.length || !window.Chart) return;

    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    Chart.defaults.color = '#6b6475';
    const BRAND = '#562665';
    const SEV_COL = { Critical: '#c62828', High: '#d9600b', Moderate: '#e0a800', Low: '#2e7d32' };
    const ST_COL = { Open: '#2457a6', 'In Progress': '#5b3aa6', Escalated: '#c62828', Resolved: '#4c9a50', Closed: '#2e7d32', Reopened: '#d9600b' };
    const baseOpts = (extra) => Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }, extra || {});
    const make = (id, cfg) => { const c = new Chart($('#' + id), cfg); state.charts.push(c); };

    // month trend: received vs closed
    const months = uniqSorted(data.map(r => monthKey(r.complaint_date)));
    const recv = countBy(data, r => monthKey(r.complaint_date));
    const closedM = countBy(data.filter(r => !isOpen(r)), r => monthKey(r.complaint_date));
    make('ch-month', {
      type: 'bar',
      data: { labels: months.map(monthLabel), datasets: [
        { label: 'Received', data: months.map(m => recv.get(m) || 0), backgroundColor: BRAND, borderRadius: 4 },
        { label: 'Closed / resolved', data: months.map(m => closedM.get(m) || 0), backgroundColor: '#8cc63f', borderRadius: 4 }
      ] },
      options: baseOpts({ plugins: { legend: { display: true, position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } })
    });

    const st = countBy(data, r => r.status);
    const stLabels = STATUSES.filter(s => st.get(s));
    make('ch-status', {
      type: 'bar',
      data: { labels: stLabels, datasets: [{ data: stLabels.map(s => st.get(s)), backgroundColor: stLabels.map(s => ST_COL[s]), borderRadius: 4 }] },
      options: baseOpts({ scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } })
    });

    const sev = countBy(open, r => r.severity);
    const sevLabels = SEVERITIES.filter(s => sev.get(s));
    make('ch-sev', {
      type: 'doughnut',
      data: { labels: sevLabels, datasets: [{ data: sevLabels.map(s => sev.get(s)), backgroundColor: sevLabels.map(s => SEV_COL[s]), borderWidth: 2 }] },
      options: baseOpts({ cutout: '60%', plugins: { legend: { display: true, position: 'right' } } })
    });

    const hbar = (id, entries) => make(id, {
      type: 'bar',
      data: { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => e[1]), backgroundColor: BRAND, borderRadius: 4 }] },
      options: baseOpts({ indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } })
    });
    hbar('ch-region', topN(countBy(data, r => r.region), 12));
    hbar('ch-service', topN(countBy(data, r => r.service_category), 10));
    hbar('ch-mode', topN(countBy(data, r => r.mode_of_complaint), 8));

    // RM table
    const byRm = new Map();
    open.forEach(r => {
      const k = r.rm || 'Not set';
      const o = byRm.get(k) || { open: 0, overdue: 0, critical: 0 };
      o.open++; if (r.is_overdue) o.overdue++; if (r.severity === 'Critical') o.critical++;
      byRm.set(k, o);
    });
    const rmRows = [...byRm.entries()].sort((a, b) => b[1].open - a[1].open).slice(0, 12);
    $('#rm-table').innerHTML = rmRows.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>RM</th><th>Open</th><th>Overdue</th><th>Critical</th></tr></thead>
        <tbody>${rmRows.map(([rm, o]) => `
          <tr data-href="${esc(link({ status: 'active', rm: rm === 'Not set' ? '' : rm }))}">
            <td>${esc(rm)}</td><td>${o.open}</td>
            <td>${o.overdue ? `<span class="chip chip-overdue">${o.overdue}</span>` : 0}</td>
            <td>${o.critical ? `<span class="chip sev-Critical">${o.critical}</span>` : 0}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No open complaints 🎉</div>';
    $$('#rm-table tr[data-href]').forEach(tr => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  }

  // ---------------------------------------------------------------- list
  async function renderList(params) {
    view().innerHTML = '<div class="loading">Loading complaints…</div>';
    const rows = await loadRows();
    const f = Object.assign({ q: '', status: '', severity: '', region: '', service: '', from: '', to: '', ckk: '', overdue: '', reminder: '', rm: '' }, params);
    const page = Math.max(1, parseInt(params.page || '1', 10));
    const regions = uniqSorted(rows.map(r => r.region));
    const services = uniqSorted(rows.map(r => r.service_category));
    const data = applyFilters(rows, f);
    const pages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    const slice = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const statusOpts = `<option value="">All statuses</option>
      <option value="active" ${f.status === 'active' ? 'selected' : ''}>All open (not closed)</option>
      <option value="done" ${f.status === 'done' ? 'selected' : ''}>All closed / resolved</option>
      ${STATUSES.map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}`;

    const activeFlags = [
      f.overdue === '1' && 'Overdue only', f.reminder === '1' && 'Reminder due today', f.ckk === '1' && 'From CKK only', f.rm && `RM: ${f.rm}`
    ].filter(Boolean);

    view().innerHTML = `
      <div class="page-head">
        <div><h1>Complaints</h1><div class="muted small">${data.length} of ${rows.length} shown</div></div>
        <div style="display:flex;gap:8px">
          <button class="btn" id="export-btn">Export to Excel (CSV)</button>
          <a class="btn btn-primary" href="#/new">+ New complaint</a>
        </div>
      </div>
      <form class="filters card" id="list-filters">
        <label class="search">Search<input type="search" name="q" value="${esc(f.q)}" placeholder="Name, phone, ticket, salon, text…"></label>
        <label>Status<select name="status">${statusOpts}</select></label>
        <label>Severity<select name="severity">${options(SEVERITIES, f.severity, 'All severities')}</select></label>
        <label>Region<select name="region">${options(regions, f.region, 'All regions')}</select></label>
        <label>Service<select name="service">${options(services, f.service, 'All services')}</select></label>
        <label>From<input type="date" name="from" value="${esc(f.from)}"></label>
        <label>To<input type="date" name="to" value="${esc(f.to)}"></label>
        <label class="checkbox"><input type="checkbox" name="ckk" value="1" ${f.ckk === '1' ? 'checked' : ''}> From CKK</label>
        <label class="checkbox"><input type="checkbox" name="overdue" value="1" ${f.overdue === '1' ? 'checked' : ''}> Overdue</label>
        <input type="hidden" name="reminder" value="${esc(f.reminder)}">
        <input type="hidden" name="rm" value="${esc(f.rm)}">
        <button type="button" class="btn" id="list-reset">Clear</button>
      </form>
      ${activeFlags.length ? `<div class="notice" style="margin-bottom:12px">Filtered: ${activeFlags.map(esc).join(' · ')}</div>` : ''}
      <div class="card" style="padding:0">
        ${slice.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Ticket</th><th>Date</th><th>Customer</th><th>Salon</th><th>Description</th><th>Severity</th><th>Status</th><th>RM</th></tr></thead>
          <tbody>${slice.map(r => `
            <tr data-id="${r.id}">
              <td class="nowrap"><b>${esc(r.ticket_no || '#' + r.id)}</b>
                ${r.from_ckk ? '<br><span class="chip chip-ckk">CKK</span>' : ''}</td>
              <td class="nowrap">${esc(fmtDate(r.complaint_date))}</td>
              <td>${esc(r.contact_name)}<div class="muted small">${esc(r.contact_no || '')}</div></td>
              <td>${esc(r.location || '')}<div class="muted small">${esc(r.salon_id || '')}${r.region ? ' · ' + esc(r.region) : ''}</div></td>
              <td class="desc"><span>${esc(r.ticket_description)}</span></td>
              <td>${chipSeverity(r.severity)}</td>
              <td>${chipStatus(r.status)}
                ${r.is_overdue ? '<br><span class="chip chip-overdue" style="margin-top:4px">Overdue</span>' : ''}
                ${r.reminder_due_today ? '<br><span class="chip chip-reminder" style="margin-top:4px">Reminder today</span>' : ''}</td>
              <td>${esc(r.rm || '')}</td>
            </tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No complaints match these filters.</div>'}
      </div>
      ${pages > 1 ? `<div class="pager">
        <button class="btn btn-sm" id="prev" ${page <= 1 ? 'disabled' : ''}>← Previous</button>
        <span class="muted">Page ${page} of ${pages}</span>
        <button class="btn btn-sm" id="next" ${page >= pages ? 'disabled' : ''}>Next →</button></div>` : ''}`;

    const form = $('#list-filters');
    const go = (pg) => {
      const p = new URLSearchParams(Object.entries(Object.fromEntries(new FormData(form))).filter(([, v]) => v));
      if (pg > 1) p.set('page', pg);
      location.hash = '#/complaints' + (p.toString() ? '?' + p : '');
    };
    form.addEventListener('change', () => go(1));
    let t; $('input[name=q]', form).addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => go(1), 400); });
    form.addEventListener('submit', e => { e.preventDefault(); go(1); });
    $('#list-reset').addEventListener('click', () => { location.hash = '#/complaints'; });
    if ($('#prev')) $('#prev').addEventListener('click', () => go(page - 1));
    if ($('#next')) $('#next').addEventListener('click', () => go(page + 1));
    $$('tbody tr[data-id]').forEach(tr => tr.addEventListener('click', () => { location.hash = '#/complaint/' + tr.dataset.id; }));
    $('#export-btn').addEventListener('click', () => exportCsv(data));

    // keep cursor in search box after re-render
    if (f.q) { const s = $('input[name=q]', form); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }

  function exportCsv(rows) {
    const cols = ['ticket_no', 'month', 'complaint_date', 'contact_name', 'mode_of_complaint', 'category', 'contact_no', 'salon_id',
      'email_id', 'location', 'ticket_description', 'service_category', 'severity', 'resolution', 'rm', 'cm', 'status',
      'created_time', 'duration_hours', 'closed_date', 'outer_id', 'region', 'from_ckk', 'ckk_forwarded_date', 'remarks',
      'executive', 'trainer', 'due_at', 'is_overdue'];
    if (rows.length && 'notes' in rows[0]) cols.splice(cols.indexOf('trainer') + 1, 0, 'notes');
    const fmt = (c, v) => {
      if (v == null) return '';
      if (['complaint_date', 'ckk_forwarded_date'].includes(c)) return fmtDate(v);
      if (['created_time', 'closed_date', 'due_at'].includes(c)) return fmtDateTime(v);
      if (c === 'duration_hours') return fmtDuration(v);
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      return v;
    };
    const cell = v => { const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [cols.map(c => cell(LABELS[c] || c)).join(',')]
      .concat(rows.map(r => cols.map(c => cell(fmt(c, r[c]))).join(','))).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `complaints_${todayISO()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------------------------------------------------------- detail
  async function renderDetail(id) {
    view().innerHTML = '<div class="loading">Loading complaint…</div>';
    const [{ data: r, error }, { data: hist }, { data: noteRow }, profiles] = await Promise.all([
      sb.from('complaints_dashboard').select('*').eq('id', id).maybeSingle(),
      sb.from('complaint_history').select('*').eq('complaint_id', id).order('changed_at', { ascending: false }),
      sb.from('complaints').select('notes').eq('id', id).maybeSingle(),
      loadProfiles()
    ]);
    if (error) throw error;
    if (!r) { view().innerHTML = '<div class="card empty">Complaint not found. <a href="#/complaints">Back to list</a></div>'; return; }

    const field = (k, v) => `<div class="field"><div class="k">${esc(LABELS[k] || k)}</div><div class="v">${v || '<span class="muted">—</span>'}</div></div>`;
    const who = (uid) => uid ? esc(profiles[uid] || 'User') : 'System / import';

    const histHtml = (hist || []).map(h => {
      if (h.action === 'INSERT') return `<div class="history-item"><b>Complaint created</b><div class="muted small">${who(h.changed_by)} · ${esc(fmtDateTime(h.changed_at))}</div></div>`;
      const ch = Object.entries(h.changes || {}).map(([k, v]) => {
        const show = x => x == null || x === '' ? '—' : (typeof x === 'boolean' ? (x ? 'Yes' : 'No') : (/^\d{4}-\d{2}-\d{2}/.test(String(x)) ? (String(x).length > 10 ? fmtDateTime(x) : fmtDate(x)) : String(x)));
        const o = show(v.old), n = show(v.new);
        const long = o.length > 60 || n.length > 60;
        return `<div><b>${esc(LABELS[k] || k)}</b>${long ? ' updated' : `: ${esc(o)} → ${esc(n)}`}</div>`;
      }).join('');
      return `<div class="history-item">${ch}<div class="muted small">${who(h.changed_by)} · ${esc(fmtDateTime(h.changed_at))}</div></div>`;
    }).join('') || '<div class="muted small">No changes recorded yet (imported complaint).</div>';

    const notes = noteRow && noteRow.notes;

    view().innerHTML = `
      <div class="page-head">
        <div>
          <a href="#/complaints" class="small">← All complaints</a>
          <h1 style="margin-top:6px">${esc(r.ticket_no || '#' + r.id)} · ${esc(r.contact_name)}</h1>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
            ${chipSeverity(r.severity)} ${chipStatus(r.status)}
            ${r.is_overdue ? '<span class="chip chip-overdue">Overdue</span>' : ''}
            ${r.reminder_due_today ? '<span class="chip chip-reminder">Reminder due today</span>' : ''}
            ${r.from_ckk ? '<span class="chip chip-ckk">From CKK Sir</span>' : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-danger" id="delete-btn">Delete</button>
          <a class="btn btn-primary" href="#/edit/${r.id}">Edit complaint</a>
        </div>
      </div>

      <div class="detail-grid">
        <div>
          <div class="card section">
            <h3>Complaint</h3>
            <div class="block-text">${esc(r.ticket_description)}</div>
            <div class="fields">
              ${field('complaint_date', esc(fmtDate(r.complaint_date)))}
              ${field('created_time', esc(fmtDateTime(r.created_time)))}
              ${field('mode_of_complaint', esc(r.mode_of_complaint))}
              ${field('category', esc(r.category))}
              ${field('service_category', esc(r.service_category))}
              ${field('due_at', esc(fmtDateTime(r.due_at)))}
              ${field('ckk_forwarded_date', esc(fmtDate(r.ckk_forwarded_date)))}
            </div>
          </div>
          <div class="card section">
            <h3>Resolution</h3>
            ${r.resolution ? `<div class="block-text">${esc(r.resolution)}</div>` : '<p class="muted">No resolution recorded yet.</p>'}
            ${r.remarks ? `<h3 style="margin-top:16px">Remarks</h3><div class="block-text">${esc(r.remarks)}</div>` : ''}
            ${notes ? `<h3 style="margin-top:16px">Notes</h3><div class="block-text">${esc(notes)}</div>` : ''}
            <div class="fields">
              ${field('executive', esc(r.executive))}
              ${field('trainer', esc(r.trainer))}
              ${field('closed_date', esc(fmtDateTime(r.closed_date)))}
              ${field('duration_hours', esc(fmtDuration(r.duration_hours)))}
            </div>
          </div>
        </div>

        <div>
          <div class="card section">
            <h3>Quick update</h3>
            <label style="margin-top:10px">Status<select id="quick-status">${STATUSES.map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
            <button class="btn btn-primary btn-block" id="quick-save" style="margin-top:10px">Save status</button>
          </div>
          <div class="card section">
            <h3>Customer</h3>
            <div class="fields" style="grid-template-columns:1fr">
              ${field('contact_name', esc(r.contact_name))}
              ${field('contact_no', r.contact_no ? `<a href="tel:${esc(r.contact_no)}">${esc(r.contact_no)}</a>` : '')}
              ${field('email_id', r.email_id ? `<a href="mailto:${esc(r.email_id)}">${esc(r.email_id)}</a>` : '')}
            </div>
          </div>
          <div class="card section">
            <h3>Salon</h3>
            <div class="fields" style="grid-template-columns:1fr 1fr">
              ${field('salon_id', esc(r.salon_id))}
              ${field('outer_id', esc(r.outer_id))}
              ${field('location', esc(r.location))}
              ${field('region', esc(r.region))}
              ${field('rm', esc(r.rm))}
              ${field('cm', esc(r.cm))}
            </div>
          </div>
          <div class="card section">
            <h3>History</h3>
            <div style="margin-top:6px">${histHtml}</div>
          </div>
        </div>
      </div>`;

    $('#quick-save').addEventListener('click', async () => {
      const status = $('#quick-status').value;
      if (status === r.status) return toast('Status is already ' + status);
      const btn = $('#quick-save'); btn.disabled = true;
      const { error: e } = await sb.from('complaints').update({ status }).eq('id', r.id);
      btn.disabled = false;
      if (e) return toast(friendlyError(e), true);
      invalidate(); toast('Status updated to ' + status); route();
    });
    $('#delete-btn').addEventListener('click', () => confirmDelete(r));
  }

  // delete — the user has to type "delete" before the button unlocks
  function confirmDelete(r) {
    const name = r.ticket_no || '#' + r.id;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <form class="modal card" novalidate>
        <h2>Delete complaint ${esc(name)}?</h2>
        <p class="muted">This permanently deletes the complaint for ${esc(r.contact_name)}. It cannot be undone.</p>
        <label><span>Type <b>delete</b> to confirm</span>
          <input name="confirm" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="delete"></label>
        <p class="form-error" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn btn-danger" disabled>Delete complaint</button>
        </div>
      </form>`;
    document.body.appendChild(wrap);

    const form = $('form', wrap), input = $('input', wrap), btn = $('button[type=submit]', wrap), err = $('.form-error', wrap);
    const typed = () => input.value.trim().toLowerCase() === 'delete';
    const onKey = e => { if (e.key === 'Escape') close(); };
    function close() {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', close);
    }
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', close);
    $('[data-cancel]', wrap).addEventListener('click', close);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    input.addEventListener('input', () => { btn.disabled = !typed(); });
    input.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!typed()) return;
      err.hidden = true; btn.disabled = true; btn.textContent = 'Deleting…';
      const { data, error } = await sb.from('complaints').delete().eq('id', r.id).select('id');
      if (error || !data || !data.length) {
        btn.disabled = false; btn.textContent = 'Delete complaint';
        err.textContent = !error ? 'You do not have permission to delete complaints.'
          : /foreign key/i.test(error.message) ? 'This complaint has linked records (history or photos), so the database refused to delete it.'
          : friendlyError(error);
        err.hidden = false;
        return;
      }
      close(); invalidate(); toast('Complaint ' + name + ' deleted');
      location.hash = '#/complaints';
    });
  }

  async function uploadPhotos(complaintId, ticketNo, files) {
    if (!CFG.N8N_PHOTO_WEBHOOK || !files || !files.length) return true;
    try {
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) { toast(`${file.name} is larger than 10 MB — skipped`, true); continue; }
        const fd = new FormData();
        fd.append('file', file, file.name);
        fd.append('complaint_id', complaintId);
        fd.append('ticket_no', ticketNo || '');
        const res = await fetch(CFG.N8N_PHOTO_WEBHOOK, {
          method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token }, body: fd
        });
        if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
      }
      return true;
    } catch (e) { toast(friendlyError(e), true); return false; }
  }

  // ---------------------------------------------------------------- form
  async function renderForm(id) {
    view().innerHTML = '<div class="loading">Loading form…</div>';
    const lk = await loadLookups();
    let r = {};
    if (id) {
      const { data, error } = await sb.from('complaints').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) { view().innerHTML = '<div class="card empty">Complaint not found.</div>'; return; }
      r = data;
    } else {
      r = { complaint_date: todayISO(), status: 'Open', from_ckk: false };
    }
    // notes needs a "notes" column on the complaints table — the field stays off until it exists
    const hasNotes = id ? 'notes' in r : !(await sb.from('complaints').select('notes').limit(1)).error;
    const v = k => esc(r[k] == null ? '' : r[k]);
    const dl = (name, list) => `<datalist id="dl-${name}">${(list || []).map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
    const sel = (name, list, value, placeholder) => `<select name="${name}"><option value="">${esc(placeholder || 'Select…')}</option>${
      uniqSorted([...(list || []), value].filter(Boolean)).map(x => `<option ${x === value ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;

    view().innerHTML = `
      <div class="page-head">
        <div>
          <a href="${id ? '#/complaint/' + id : '#/complaints'}" class="small">← ${id ? 'Back to complaint' : 'All complaints'}</a>
          <h1 style="margin-top:6px">${id ? 'Edit ' + esc(r.ticket_no || '#' + id) : 'New complaint'}</h1>
        </div>
      </div>
      <form id="complaint-form" novalidate>
        <div class="card form-section">
          <h3>Complaint</h3>
          <div class="form-grid">
            <div class="full sev-field"><span class="req">Severity</span>
              <div class="sev-picker">${SEVERITIES.map(s => `
                <label class="${s}" title="${esc(SEV_HINT[s])}"><input type="radio" name="severity" value="${s}" ${r.severity === s ? 'checked' : ''}> ${s}</label>`).join('')}
              </div>
              <span class="hint">Critical: injury, burn, allergy, infection, hygiene (24 hrs) · High: damage, refund, staff behaviour (48 hrs) · Moderate: service quality, waiting, billing (5 days) · Low: suggestions (7 days)</span>
            </div>
            <label><span class="req">Date</span><input type="date" name="complaint_date" value="${v('complaint_date')}" required></label>
            <label>Mode of complaint${sel('mode_of_complaint', lk.mode, r.mode_of_complaint)}</label>
            <label>Category (Ticket)<input name="category" list="dl-category" value="${v('category')}" placeholder="e.g. service issue">${dl('category', lk.category)}</label>
            <label>Service category<input name="service_category" list="dl-service" value="${v('service_category')}" placeholder="e.g. Facial">${dl('service', lk.service_category)}</label>
            <label class="full"><span class="req">Ticket description</span><textarea name="ticket_description" rows="5" required>${v('ticket_description')}</textarea></label>
          </div>
        </div>

        <div class="card form-section">
          <h3>Customer</h3>
          <div class="form-grid">
            <label><span class="req">Contact name</span><input name="contact_name" value="${v('contact_name')}" required></label>
            <label>Contact no<input name="contact_no" inputmode="numeric" value="${v('contact_no')}" placeholder="10-digit mobile"></label>
            <label>Email ID<input type="email" name="email_id" value="${v('email_id')}"></label>
          </div>
        </div>

        <div class="card form-section">
          <h3>Salon</h3>
          <div class="form-grid">
            <label>Salon ID<input name="salon_id" list="dl-salon" value="${v('salon_id')}" placeholder="Type to search, e.g. 91NKL1081" autocomplete="off">
              <datalist id="dl-salon">${(state.salons || []).map(s => `<option value="${esc(s.salon_id)}">${esc([s.location, s.region].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
              <span class="hint">Picking a Salon ID fills in the details below.</span></label>
            <label>Outer ID<input name="outer_id" value="${v('outer_id')}"></label>
            <label>Location<input name="location" value="${v('location')}"></label>
            <label>Region<input name="region" list="dl-region" value="${v('region')}">${dl('region', lk.region)}</label>
            <label>RM<input name="rm" value="${v('rm')}"></label>
            <label>CM<input name="cm" value="${v('cm')}"></label>
          </div>
        </div>

        <div class="card form-section">
          <h3>CKK</h3>
          <div class="form-grid">
            <label class="checkbox"><input type="checkbox" name="from_ckk" ${r.from_ckk ? 'checked' : ''}> Forwarded by CKK Sir</label>
            <label>CKK forwarded date<input type="date" name="ckk_forwarded_date" value="${v('ckk_forwarded_date')}"></label>
          </div>
        </div>

        <div class="card form-section">
          <h3>Handling</h3>
          <div class="form-grid">
            <label><span class="req">Status</span><select name="status">${STATUSES.map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
            <label>Executive<input name="executive" list="dl-exec" value="${v('executive')}">${dl('exec', lk.executive)}</label>
            <label>Trainer<input name="trainer" list="dl-trainer" value="${v('trainer')}">${dl('trainer', lk.trainer)}</label>
            ${hasNotes
              ? `<label class="full">Notes<textarea name="notes" rows="3">${v('notes')}</textarea></label>`
              : '<p class="notice full" style="margin:0">Notes switch on once the notes column is added to the database.</p>'}
            <label class="full">Resolution<textarea name="resolution" rows="4">${v('resolution')}</textarea></label>
            <label class="full">Remarks<textarea name="remarks" rows="3">${v('remarks')}</textarea></label>
          </div>
        </div>

        <p id="form-error" class="form-error" hidden></p>
        <div class="form-actions">
          <a class="btn" href="${id ? '#/complaint/' + id : '#/complaints'}">Cancel</a>
          <button type="submit" class="btn btn-primary" id="save-btn">${id ? 'Save changes' : 'Create complaint'}</button>
        </div>
      </form>`;

    const form = $('#complaint-form');

    // salon autofill
    const salonInput = $('input[name=salon_id]', form);
    salonInput.addEventListener('change', () => {
      const s = (state.salons || []).find(x => x.salon_id.toUpperCase() === salonInput.value.trim().toUpperCase());
      if (!s) return;
      salonInput.value = s.salon_id;
      ['outer_id', 'location', 'region', 'rm', 'cm'].forEach(k => { if (s[k]) $(`input[name=${k}]`, form).value = s[k]; });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#form-error'); err.hidden = true;
      const fd = new FormData(form);
      const get = k => (fd.get(k) || '').toString().trim();

      const problems = [];
      if (!get('severity')) problems.push('Choose a severity.');
      if (!get('complaint_date')) problems.push('Enter the complaint date.');
      if (!get('contact_name')) problems.push('Enter the contact name.');
      if (!get('ticket_description')) problems.push('Enter the ticket description.');
      const phone = get('contact_no').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
      if (get('contact_no') && phone.length !== 10) problems.push('Contact no should be a 10-digit mobile number.');
      if (problems.length) { err.textContent = problems.join(' '); err.hidden = false; err.scrollIntoView({ block: 'center' }); return; }

      const payload = {
        severity: get('severity'),
        complaint_date: get('complaint_date'),
        mode_of_complaint: nullIfEmpty(get('mode_of_complaint')),
        category: nullIfEmpty(get('category')),
        service_category: nullIfEmpty(get('service_category')),
        ticket_description: get('ticket_description'),
        contact_name: get('contact_name'),
        contact_no: nullIfEmpty(phone),
        email_id: nullIfEmpty(get('email_id').toLowerCase()),
        salon_id: nullIfEmpty(get('salon_id').toUpperCase()),
        outer_id: nullIfEmpty(get('outer_id')),
        location: nullIfEmpty(get('location').toUpperCase()),
        region: nullIfEmpty(get('region').toUpperCase()),
        rm: nullIfEmpty(get('rm').toUpperCase()),
        cm: nullIfEmpty(get('cm').toUpperCase()),
        from_ckk: fd.get('from_ckk') === 'on',
        ckk_forwarded_date: nullIfEmpty(get('ckk_forwarded_date')),
        status: get('status') || 'Open',
        executive: nullIfEmpty(get('executive')),
        trainer: nullIfEmpty(get('trainer')),
        resolution: nullIfEmpty(get('resolution')),
        remarks: nullIfEmpty(get('remarks'))
      };
      if (hasNotes) payload.notes = nullIfEmpty(get('notes'));

      // a Salon ID that isn't in the salon list would break the save — add it first
      if (payload.salon_id && !(state.salons || []).some(s => s.salon_id === payload.salon_id)) {
        const { error: se } = await sb.from('salons').insert({
          salon_id: payload.salon_id, outer_id: payload.outer_id, location: payload.location,
          region: payload.region, rm: payload.rm, cm: payload.cm
        });
        if (se && !/duplicate/i.test(se.message)) { err.textContent = friendlyError(se); err.hidden = false; return; }
      }

      const btn = $('#save-btn'); btn.disabled = true; btn.textContent = 'Saving…';
      let savedId = id, ticketNo = r.ticket_no;
      if (id) {
        const { error: ue } = await sb.from('complaints').update(payload).eq('id', id);
        if (ue) { btn.disabled = false; btn.textContent = 'Save changes'; err.textContent = friendlyError(ue); err.hidden = false; return; }
      } else {
        const { data, error: ie } = await sb.from('complaints').insert(payload).select('id,ticket_no').single();
        if (ie) { btn.disabled = false; btn.textContent = 'Create complaint'; err.textContent = friendlyError(ie); err.hidden = false; return; }
        savedId = data.id; ticketNo = data.ticket_no;
      }

      const photoInput = $('input[name=photos]', form);
      if (photoInput && photoInput.files.length) {
        btn.textContent = 'Uploading photos…';
        await uploadPhotos(savedId, ticketNo, photoInput.files);
      }
      invalidate();
      toast(id ? 'Changes saved' : 'Complaint created');
      location.hash = '#/complaint/' + savedId;
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
