/* =====================================================================
   MSDMS · app.js
   Application shell (sidebar, header), reusable UI components (tables,
   forms, modals, documents, charts) and page bootstrapping.
   ===================================================================== */
'use strict';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Chart palette – e-commerce portal tokens, validated categorical order (indigo, crimson, teal, amber, sky) */
const PALETTE = ['#4338ca', '#d61f45', '#0e9f8e', '#c77700', '#0284c7'];

const STATUS_CLS = {
  ACTIVE: 'ok', ELIGIBLE: 'ok', RECEIVED: 'ok', APPROVED: 'ok', PASSED: 'ok', AVAILABLE: 'ok', ACKNOWLEDGED: 'ok', CONFIRMED: 'ok', VERIFIED_SIMULATED: 'ok', ONLINE: 'ok', CLOSED: 'ok', RESOLVED: 'ok',
  CREATED: 'muted', DRAFT: 'muted', ORDERED: 'info', GENERATED: 'info', READY_FOR_DISPATCH: 'info', DISPATCHED: 'info', IN_TRANSIT: 'info', ON_TRIP: 'info', REACHED_DESTINATION: 'warn',
  PENDING: 'warn', PENDING_VERIFICATION: 'warn', PENDING_TALUKA: 'warn', PENDING_DISTRICT: 'warn', PENDING_STATE: 'warn', PENDING_CONFIRMATION: 'warn', PARTIALLY_RECEIVED: 'warn', PARTIAL: 'warn', MAINTENANCE: 'warn', SUBMITTED_TO_TALUKA: 'warn', OPEN: 'warn', TRANSFERRED: 'muted',
  DELAYED: 'bad', CANCELLED: 'bad', REJECTED: 'bad', NOT_ELIGIBLE: 'bad', INACTIVE: 'bad', OFFLINE: 'bad', EXPIRED: 'bad', FAILED: 'bad'
};

const UI = {
  _ts: {}, _charts: {},
  badge(status, label) { return `<span class="st st-${STATUS_CLS[status] || 'muted'}">${esc(label || String(status || '—').replace(/_/g, ' '))}</span>`; },
  kpi({ label, value, icon, tone = 'navy', sub = '' }) {
    return `<div class="kpi kpi-${tone}"><div class="kpi-ic"><i class="bi bi-${icon}"></i></div><div class="kpi-body"><div class="kpi-val">${value}</div><div class="kpi-lbl">${esc(label)}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div></div>`;
  },
  kpis(list, cls = '') { return `<div class="kpi-grid ${cls}">${list.map(k => this.kpi(k)).join('')}</div>`; },
  card(title, body, opts = {}) {
    return `<section class="panel ${opts.cls || ''}"><header class="panel-h"><h2>${opts.icon ? `<i class="bi bi-${opts.icon}"></i> ` : ''}${title}</h2><div class="panel-tools">${opts.tools || ''}</div></header><div class="panel-b ${opts.flush ? 'p-0' : ''}">${body}</div></section>`;
  },
  empty(msg, icon = 'inbox') { return `<div class="empty"><i class="bi bi-${icon}"></i><div>${esc(msg)}</div></div>`; },
  toast(msg, type = 'success') {
    let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toast-container position-fixed top-0 end-0 p-3'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${type === 'error' ? 'danger' : type} border-0`;
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(msg)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    box.appendChild(el); const tt = new bootstrap.Toast(el, { delay: 4200 }); tt.show(); el.addEventListener('hidden.bs.toast', () => el.remove());
  },
  tabs(id, tabs, active) {
    return `<ul class="nav nav-tabs app-tabs" id="${id}">${tabs.map(tb => `<li class="nav-item"><button class="nav-link ${tb.key === active ? 'active' : ''}" data-tab="${tb.key}">${tb.icon ? `<i class="bi bi-${tb.icon}"></i> ` : ''}${esc(tb.label)}${tb.count != null ? ` <span class="tab-count">${tb.count}</span>` : ''}</button></li>`).join('')}</ul>`;
  },
  onTabs(id, fn) { $$(`#${id} [data-tab]`).forEach(b => b.onclick = () => fn(b.dataset.tab)); },

  /* ---------- Reusable data table: search, filters, sort, paging, export ---------- */
  table(el, o) {
    el = typeof el === 'string' ? $(el) : el; if (!el) return;
    const key = o.id || el.id, st = this._ts[key] = this._ts[key] || { q: '', f: {}, page: 1, sort: null, dir: 1 };
    const val = (c, r) => c.value ? c.value(r) : r[c.key];
    const filters = (o.filters || []).map(f => {
      const opts = f.options || [...new Set(o.rows.map(r => f.get ? f.get(r) : r[f.key]).filter(v => v != null && v !== ''))].sort();
      return `<select class="form-select form-select-sm tbl-filter" data-f="${f.key}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: ${t('c.all')}</option>${opts.map(x => { const v = typeof x === 'object' ? x.v : x, l = typeof x === 'object' ? x.l : String(x).replace(/_/g, ' '); return `<option value="${esc(v)}" ${st.f[f.key] === String(v) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
    }).join('');
    el.innerHTML = `<div class="tbl-bar">
        ${o.search === false ? '' : `<div class="tbl-search"><i class="bi bi-search"></i><input type="search" class="form-control form-control-sm" placeholder="${t('c.search')}" value="${esc(st.q)}" aria-label="Search table"></div>`}
        ${filters}<div class="ms-auto d-flex gap-2 flex-wrap">${o.toolbar || ''}
        ${o.exportName ? `<div class="btn-group"><button class="btn btn-sm btn-outline-secondary" data-x="xls"><i class="bi bi-file-earmark-excel"></i> Excel</button><button class="btn btn-sm btn-outline-secondary" data-x="pdf"><i class="bi bi-file-earmark-pdf"></i> PDF</button></div>` : ''}</div></div>
      <div class="table-responsive"><table class="table table-hover align-middle data-table"><thead><tr>${o.columns.map((c, i) => `<th class="${c.cls || ''} ${c.sort === false ? '' : 'sortable'}" data-i="${i}">${esc(c.label)}<i class="bi sort-ic"></i></th>`).join('')}</tr></thead><tbody></tbody></table></div>
      <div class="tbl-foot"><span class="tbl-info"></span><nav class="tbl-pager"></nav></div>`;
    const draw = () => {
      let rows = o.rows.filter(r => {
        if (st.q) { const hay = o.columns.map(c => String(val(c, r) ?? '')).join(' ').toLowerCase(); if (!hay.includes(st.q.toLowerCase())) return false; }
        for (const f of (o.filters || [])) { const v = st.f[f.key]; if (v && String(f.get ? f.get(r) : r[f.key]) !== v) return false; }
        return true;
      });
      if (st.sort != null && o.columns[st.sort]) {
        const c = o.columns[st.sort];
        rows = rows.slice().sort((a, b) => { const x = val(c, a), y = val(c, b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })) * st.dir; });
      }
      st.rows = rows;
      const ps = o.pageSize || 10, pages = Math.max(1, Math.ceil(rows.length / ps)); st.page = Math.min(st.page, pages);
      const pr = rows.slice((st.page - 1) * ps, st.page * ps);
      $('tbody', el).innerHTML = pr.length ? pr.map(r => `<tr data-id="${esc(r.id ?? '')}">${o.columns.map(c => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(val(c, r) ?? '—')}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${o.columns.length}">${UI.empty(o.empty || 'No records match the current filters.')}</td></tr>`;
      $('.tbl-info', el).textContent = rows.length ? `Showing ${(st.page - 1) * ps + 1}–${Math.min(st.page * ps, rows.length)} of ${rows.length}` : '0 records';
      $('.tbl-pager', el).innerHTML = pages > 1 ? `<button class="btn btn-sm btn-light" data-p="${st.page - 1}" ${st.page === 1 ? 'disabled' : ''} aria-label="Previous page"><i class="bi bi-chevron-left"></i></button><span>Page ${st.page} / ${pages}</span><button class="btn btn-sm btn-light" data-p="${st.page + 1}" ${st.page === pages ? 'disabled' : ''} aria-label="Next page"><i class="bi bi-chevron-right"></i></button>` : '';
      $$('th', el).forEach((th, i) => { const ic = $('.sort-ic', th); ic.className = 'bi sort-ic ' + (st.sort === i ? (st.dir > 0 ? 'bi-caret-up-fill' : 'bi-caret-down-fill') : ''); });
    };
    draw();
    const si = $('.tbl-search input', el); if (si) si.oninput = e => { st.q = e.target.value; st.page = 1; draw(); };
    $$('.tbl-filter', el).forEach(s => s.onchange = () => { st.f[s.dataset.f] = s.value; st.page = 1; draw(); });
    el.onclick = e => {
      const p = e.target.closest('[data-p]'); if (p) { st.page = +p.dataset.p; draw(); return; }
      const th = e.target.closest('th.sortable'); if (th) { const i = +th.dataset.i; st.dir = st.sort === i ? -st.dir : 1; st.sort = i; draw(); return; }
      const x = e.target.closest('[data-x]'); if (x) { const cols = o.columns.filter(c => !c.noExport); x.dataset.x === 'xls' ? UI.exportCSV(o.exportName, cols, st.rows) : UI.exportPDF(o.exportTitle || o.exportName, cols, st.rows); return; }
      const a = e.target.closest('[data-act]'); if (a && o.onAction) { const tr = a.closest('tr'); o.onAction(a.dataset.act, a.dataset.id || (tr && tr.dataset.id), a); }
    };
  },
  actBtn(act, icon, label, cls = 'outline-primary', id) { return `<button class="btn btn-sm btn-${cls} act" data-act="${act}" ${id ? `data-id="${esc(id)}"` : ''} title="${esc(label)}"><i class="bi bi-${icon}"></i><span>${esc(label)}</span></button>`; },

  /* ---------- Exports (demo): Excel-compatible CSV + print-to-PDF ---------- */
  cell(c, r) { const v = c.value ? c.value(r) : r[c.key]; return v == null ? '' : v; },
  exportCSV(name, cols, rows) {
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.map(c => q(c.label)).join(','), ...rows.map(r => cols.map(c => q(UI.cell(c, r))).join(','))].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `${name}-${U.day(new Date())}.csv`; a.click();
    Audit.log('Reports', 'EXPORT_EXCEL', name, '', `${rows.length} rows`); DB.save(); UI.toast(`Excel (CSV) export downloaded: ${rows.length} rows`);
  },
  exportPDF(title, cols, rows) {
    const html = `<table><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(UI.cell(c, r))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    Audit.log('Reports', 'EXPORT_PDF', title, '', `${rows.length} rows`); DB.save();
    UI.print(title, html);
  },
  print(title, html) {
    const w = window.open('', '_blank'); if (!w) { UI.toast('Allow pop-ups to print / save as PDF.', 'warning'); return; }
    w.document.write(`<!doctype html><title>${esc(title)}</title><style>body{font:13px/1.45 'Segoe UI',system-ui,sans-serif;color:#111;margin:28px}h1{font-size:18px;margin:0}h2{font-size:14px}.hd{border-bottom:3px solid #7a0e33;padding-bottom:8px;margin-bottom:14px}.sm{color:#555;font-size:11px}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;font-size:12px}th{background:#eef2f7}.grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px}.sign{display:flex;justify-content:space-between;margin-top:56px}.sign div{border-top:1px solid #333;padding-top:4px;width:30%;text-align:center;font-size:11px}</style>
      <div class="hd"><h1>${esc(t('app.name'))}</h1><div class="sm">${esc(title)} · Generated ${U.fmtDT(new Date())} · PROTOTYPE – FICTIONAL DEMO DATA</div></div>${html}`);
    w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* ignore */ } }, 300);
  },
  /* Official-style document preview (challan, GRN, receipts) with Print / PDF */
  doc(title, html) {
    this.modal({ title, size: 'lg', body: `<div class="doc-sheet"><div class="doc-hd"><div><strong>${esc(t('app.name'))}</strong><div class="small text-muted">Prototype document · fictional data · not valid for official use</div></div><div class="doc-title">${esc(title)}</div></div>${html}</div>`, submit: 'Print / Save PDF', submitIcon: 'printer', onSubmit: () => { UI.print(title, html); return false; }, cancel: 'Close' });
  },
  kv(pairs) { return `<div class="kv">${pairs.filter(Boolean).map(([k, v]) => `<div><span>${esc(k)}</span><strong>${v == null || v === '' ? '—' : v}</strong></div>`).join('')}</div>`; },

  /* ---------- Modal + form builder ---------- */
  modal({ title, body, size = '', submit = 'Save', submitIcon = 'check2', cancel = 'Cancel', onSubmit, onShow, tone = 'primary' }) {
    const el = document.createElement('div'); el.className = 'modal fade'; el.tabIndex = -1;
    el.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${size ? 'modal-' + size : ''}"><form class="modal-content" novalidate>
      <div class="modal-header"><h5 class="modal-title">${title}</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer"><button type="button" class="btn btn-light" data-bs-dismiss="modal">${cancel}</button>${onSubmit ? `<button type="submit" class="btn btn-${tone}"><i class="bi bi-${submitIcon}"></i> ${submit}</button>` : ''}</div></form></div>`;
    document.body.appendChild(el);
    const m = new bootstrap.Modal(el), form = $('form', el);
    form.onsubmit = e => {
      e.preventDefault(); if (!onSubmit) return;
      if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
      try { if (onSubmit(UI.formData(form), form, m) !== false) m.hide(); }
      catch (err) { UI.toast(err.message || String(err), 'error'); }
    };
    el.addEventListener('hidden.bs.modal', () => el.remove());
    el.addEventListener('shown.bs.modal', () => { if (onShow) onShow(el, m); });
    m.show(); return { el, m, form };
  },
  confirm(title, msg, onYes, tone = 'primary', yes = 'Confirm') { this.modal({ title, body: `<p class="mb-0">${msg}</p>`, submit: yes, tone, onSubmit: () => { onYes(); } }); },
  fields(fs, vals = {}) {
    return `<div class="row g-3">${fs.map(f => {
      if (f.html) return `<div class="col-12">${f.html}</div>`;
      const v = vals[f.name] ?? f.value ?? '', req = f.required ? 'required' : '', ro = f.readonly ? 'readonly' : '', id = 'f_' + f.name;
      const attrs = `${req} ${ro} ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.pattern ? `pattern="${f.pattern}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
      let ctl;
      if (f.type === 'select') ctl = `<select class="form-select" name="${f.name}" id="${id}" ${req} ${f.readonly ? 'disabled' : ''}><option value="">Select…</option>${(f.options || []).map(o => { const ov = typeof o === 'object' ? o.v : o, ol = typeof o === 'object' ? o.l : o; return `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
      else if (f.type === 'textarea') ctl = `<textarea class="form-control" name="${f.name}" id="${id}" rows="${f.rows || 2}" ${attrs}>${esc(v)}</textarea>`;
      else if (f.type === 'checkbox') return `<div class="col-md-${f.col || 12}"><div class="form-check"><input class="form-check-input" type="checkbox" name="${f.name}" id="${id}" ${v ? 'checked' : ''} ${req}><label class="form-check-label" for="${id}">${f.label}</label><div class="invalid-feedback">This confirmation is required.</div></div></div>`;
      else ctl = `<input class="form-control" type="${f.type || 'text'}" name="${f.name}" id="${id}" value="${f.type === 'file' ? '' : esc(v)}" ${attrs} ${f.accept ? `accept="${f.accept}"` : ''}>`;
      return `<div class="col-md-${f.col || 6}"><label class="form-label" for="${id}">${esc(f.label)}${f.required ? ' <span class="text-danger">*</span>' : ''}</label>${ctl}<div class="invalid-feedback">${esc(f.error || 'Please provide a valid value.')}</div>${f.help ? `<div class="form-text">${f.help}</div>` : ''}</div>`;
    }).join('')}</div>`;
  },
  formData(form) {
    const o = {};
    $$('[name]', form).forEach(i => {
      if (i.type === 'checkbox') o[i.name] = i.checked;
      else if (i.type === 'number') o[i.name] = i.value === '' ? null : Number(i.value);
      else if (i.type === 'file') o[i.name] = i.files && i.files[0] ? i.files[0].name : '';
      else o[i.name] = i.value.trim();
    });
    return o;
  },
  chart(id, cfg) {
    const c = document.getElementById(id); if (!c || !window.Chart) return;
    if (this._charts[id]) this._charts[id].destroy();
    return this._charts[id] = new Chart(c, cfg);
  },
  /* Parse an uploaded CSV (Excel "Save as CSV") into objects keyed by header */
  parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
      else cur += ch;
    }
    row.push(cur); if (row.some(x => x !== '')) rows.push(row);
    const head = (rows.shift() || []).map(h => h.replace(/^﻿/, '').trim());
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  },
  /* Generic bulk-import dialog (Excel/CSV) */
  importDialog({ title, columns, sample, onRows }) {
    this.modal({
      title, size: 'lg', submit: 'Import', submitIcon: 'upload',
      body: `<p class="text-muted small">Upload an Excel sheet saved as <strong>.csv</strong> with the header row below, or paste rows. Use <em>Load sample</em> for a quick demo.</p>
        <div class="code-line mb-2">${esc(columns.join(','))}</div>
        <div class="d-flex gap-2 mb-2"><input type="file" class="form-control form-control-sm" accept=".csv,text/csv" id="impFile"><button type="button" class="btn btn-sm btn-outline-secondary text-nowrap" id="impSample">Load sample</button><button type="button" class="btn btn-sm btn-outline-secondary text-nowrap" id="impTpl">Template</button></div>
        <textarea class="form-control font-monospace small" id="impText" rows="7" name="csv" required placeholder="${esc(columns.join(','))}"></textarea><div class="invalid-feedback">Provide CSV data to import.</div>`,
      onShow: el => {
        $('#impSample', el).onclick = () => $('#impText', el).value = columns.join(',') + '\n' + sample;
        $('#impTpl', el).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([columns.join(',') + '\n'], { type: 'text/csv' })); a.download = 'import-template.csv'; a.click(); };
        $('#impFile', el).onchange = e => { const f = e.target.files[0]; if (f) f.text().then(tx => $('#impText', el).value = tx); };
      },
      onSubmit: d => { const rows = UI.parseCSV(d.csv); if (!rows.length) throw new Error('No data rows found below the header.'); onRows(rows); }
    });
  }
};

/* ---------- Application shell ---------- */
const App = {
  pages: {}, page: null, root: null,
  refresh() { if (this.page && this.pages[this.page]) { this.pages[this.page](this.root); this.bell(); } },
  commit(msg, type) { DB.save(); if (msg) UI.toast(msg, type); this.refresh(); },
  go(page) { location.href = page + '.html'; },
  switchRole(email) { Auth.logout(); Auth._u = null; Auth.login(email, DEMO_PASSWORD); location.href = Auth.home(); },
  resetData() {
    UI.confirm('Reset demo data', 'All changes made during this demo will be discarded and the fictional sample data will be regenerated. Continue?', () => {
      const u = Auth.user(); DB.reset(); UI._ts = {};
      if (u) { Auth._u = null; DB.actor = { id: u.id, name: u.name, role: u.role }; Audit.log('System', 'RESET_DEMO_DATA', 'DB'); DB.save(); }
      UI.toast('Demo data has been reset.'); setTimeout(() => location.reload(), 500);
    }, 'danger', 'Reset');
  },
  bell() {
    const u = Auth.user(); if (!u || !$('#bellCount')) return;
    const list = Scope.notifications(), unread = list.filter(n => !n.readBy.includes(u.id));
    $('#bellCount').textContent = unread.length; $('#bellCount').hidden = !unread.length;
    $('#bellList').innerHTML = (list.slice(0, 6).map(n => `<a class="ntf ${n.readBy.includes(u.id) ? '' : 'unread'}" href="notifications.html"><strong>${esc(n.title)}</strong><span>${esc(n.msg)}</span><small>${U.fmtDT(n.at)}</small></a>`).join('') || UI.empty('No notifications')) + `<a class="ntf-all" href="notifications.html">View all notifications</a>`;
  },
  shell(page) {
    const u = Auth.user(), role = ROLES[u.role], navItem = NAV.flatMap(g => g.items).find(i => i.page === page), phIcon = navItem ? navItem.icon : 'grid';
    const scopeTxt = u.schoolId ? DB.name('schools', u.schoolId) : u.talukaId ? `${DB.name('talukas', u.talukaId)} Taluka` : u.districtId ? `${DB.name('districts', u.districtId)} District` : u.nodeId ? DB.nodeName(u.nodeId) : 'Maharashtra State';
    const nav = NAV.map(s => { const items = s.items.filter(i => i.roles.includes(u.role)); return items.length ? `<div class="nav-sec">${t(s.section)}</div>${items.map(i => `<a class="nav-item ${i.page === page ? 'active' : ''}" href="${i.page}.html"><i class="bi bi-${i.icon}"></i><span>${t('page.' + i.page)}</span>${i.ai ? '<em class="ai-tag">AI</em>' : ''}</a>`).join('')}` : ''; }).join('');
    document.body.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><div class="brand-mark">MS</div><div><div class="brand-name">${t('app.short')}</div><div class="brand-sub">Sanitary Distribution Management</div></div></div>
        <nav class="side-nav" aria-label="Main">${nav}</nav>
        <div class="side-foot"><span class="demo-chip"><i class="bi bi-info-circle"></i> Prototype · fictional data</span></div>
      </aside>
      <div class="backdrop" id="backdrop"></div>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn" id="menuBtn" aria-label="Toggle navigation"><i class="bi bi-list"></i></button>
          <span class="spacer"></span>
          <div class="top-tools">
            <div class="btn-group btn-group-sm lang-toggle" role="group" aria-label="Language"><button class="btn ${Lang.cur === 'en' ? 'active' : ''}" data-lang="en">EN</button><button class="btn ${Lang.cur === 'mr' ? 'active' : ''}" data-lang="mr">मराठी</button></div>
            <div class="dropdown"><button class="icon-btn" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-label="Notifications"><i class="bi bi-bell"></i><span class="bell-count" id="bellCount" hidden>0</span></button><div class="dropdown-menu dropdown-menu-end ntf-menu" id="bellList"></div></div>
            <div class="dropdown"><button class="user-btn" data-bs-toggle="dropdown"><span class="avatar">${esc(u.name.split(' ').filter(x => /^[A-Z]/.test(x) && !/^Dr/.test(x)).slice(0, 2).map(x => x[0]).join(''))}</span><span class="d-none d-md-block text-start"><strong>${esc(u.name)}</strong><small>${esc(role.label)}</small></span><i class="bi bi-chevron-down small"></i></button>
              <div class="dropdown-menu dropdown-menu-end user-menu">
                <div class="px-3 py-2 small text-muted">${esc(u.email)}<br>Scope: ${esc(scopeTxt)}</div><div class="dropdown-divider"></div>
                <h6 class="dropdown-header">${t('c.switch')}</h6>
                <div class="role-switch">${DB.d.users.map(x => `<button class="dropdown-item ${x.id === u.id ? 'active' : ''}" data-switch="${x.email}"><i class="bi bi-person"></i> ${esc(ROLES[x.role].label)}</button>`).join('')}</div>
                <div class="dropdown-divider"></div>
                <button class="dropdown-item d-md-none" id="guideBtn2"><i class="bi bi-signpost-split"></i> ${t('c.guide')}</button>
                <button class="dropdown-item" id="resetBtn"><i class="bi bi-arrow-counterclockwise"></i> ${t('c.reset')}</button>
                <button class="dropdown-item text-danger" id="logoutBtn"><i class="bi bi-box-arrow-right"></i> ${t('c.logout')}</button>
              </div></div>
          </div>
        </header>
        <section class="page__head"><div class="ph-icon"><i class="bi bi-${phIcon}"></i></div><div class="ph-text"><h1>${t('page.' + page)}</h1><p><i class="bi bi-geo-alt"></i> ${esc(scopeTxt)} · FY ${U.fy()} · ${esc(role.label)}</p></div><div class="ph-actions"><button class="btn btn-ghost-w d-none d-md-inline-flex" id="guideBtn"><i class="bi bi-signpost-split"></i> ${t('c.guide')}</button></div></section>
        <main class="content" id="content"></main>
        <footer class="foot">Demonstration prototype with fictional records. Not an official Government of Maharashtra service. GPS, identity verification and AI outputs are simulated. Demo sign-in is not production security.</footer>
      </div>
    </div>`;
    $('#menuBtn').onclick = () => document.body.classList.toggle(window.matchMedia('(max-width: 991.98px)').matches ? 'nav-open' : 'nav-collapsed');
    $('#backdrop').onclick = () => document.body.classList.remove('nav-open');
    $('#logoutBtn').onclick = () => { Auth.logout(); location.href = 'login.html'; };
    $('#resetBtn').onclick = () => App.resetData();
    $('#guideBtn').onclick = $('#guideBtn2').onclick = () => App.guide();
    $$('[data-lang]').forEach(b => b.onclick = () => { Lang.set(b.dataset.lang); location.reload(); });
    $$('[data-switch]').forEach(b => b.onclick = () => App.switchRole(b.dataset.switch));
    ['click', 'keydown'].forEach(ev => document.addEventListener(ev, () => Auth.touch(), { passive: true }));
    setInterval(() => { if (!Auth._u) return; Auth._u = null; if (!Auth.user()) location.href = 'login.html'; }, 60000);
    this.bell();
  },
  /* Guided end-to-end demo scenario (Part 22) with one-click role switching */
  guide() {
    const G = [
      ['admin@msdms.demo', 'State Super Admin', ['Open <b>Allocations & Requests</b> → <b>New Allocation</b> → Pune District Warehouse, 2,000 packets.']],
      ['warehouse@msdms.demo', 'Central Warehouse Manager', ['<b>Procurement</b> → PO-2026-0006 → <b>Receive & QC</b> 10,000 packets (stock inward).', '<b>Shipments</b> → <b>New Shipment</b> → Pune District Warehouse, 2,000 packets (link the allocation).', 'Assign vehicle <b>MH12-AB-1234</b> and driver → Approve → Ready → Dispatch → <b>Start Trip</b>.']],
      ['transport@msdms.demo', 'Transport Manager', ['<b>Live Tracking</b> → watch simulated GPS movement. Use <b>Fast-forward</b> to arrive.']],
      ['district@msdms.demo', 'District Officer (Pune)', ['<b>Deliveries & GRN</b> → Receive 2,000 packets → GRN generated.', '<b>Allocations</b> → New Allocation → Haveli Taluka DC, 1,000 packets → Create shipment → dispatch → fast-forward.']],
      ['taluka@msdms.demo', 'Taluka Officer (Haveli)', ['<b>Deliveries & GRN</b> → Receive 1,000 packets.', '<b>Allocations</b> → New Allocation → school SCH-001, 500 packets → Create shipment → dispatch → fast-forward.']],
      ['employee@msdms.demo', 'School Employee', ['<b>Deliveries & GRN</b> → confirm unloading of 500 packets → <b>Inventory</b> shows 500.']],
      ['principal@msdms.demo', 'School Principal', ['Review the dashboard and <b>Inventory Ledger</b>.']],
      ['employee@msdms.demo', 'School Employee', ['<b>QR Distribution</b> → Simulate QR scan → eligibility and entitlement verified → Confirm distribution. Stock reduces automatically.']],
      ['student@msdms.demo', 'Student', ['<b>My Portal</b> → distribution history is updated.']],
      ['admin@msdms.demo', 'State Super Admin', ['<b>Dashboard</b> shows updated statewide statistics. <b>Audit Logs</b> list every activity. <b>AI Insights</b> summarises risks.']]];
    const el = document.createElement('div'); el.className = 'offcanvas offcanvas-end guide-canvas'; el.tabIndex = -1;
    el.innerHTML = `<div class="offcanvas-header"><h5 class="offcanvas-title"><i class="bi bi-signpost-split"></i> End-to-end demo guide</h5><button class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button></div>
      <div class="offcanvas-body"><p class="small text-muted">Follow the steps in order. Each button signs you in as that demo role (password <code>${DEMO_PASSWORD}</code>). Use <em>Reset demo data</em> to repeat.</p>
      ${G.map((g, i) => `<div class="guide-step"><div class="guide-n">${i + 1}</div><div><button class="btn btn-sm btn-outline-primary mb-1" data-switch="${g[0]}"><i class="bi bi-box-arrow-in-right"></i> Sign in as ${g[1]}</button><ul>${g[2].map(x => `<li>${x}</li>`).join('')}</ul></div></div>`).join('')}
      <button class="btn btn-outline-danger btn-sm w-100 mt-2" id="gReset"><i class="bi bi-arrow-counterclockwise"></i> Reset demo data</button></div>`;
    document.body.appendChild(el); const oc = new bootstrap.Offcanvas(el); oc.show();
    $$('[data-switch]', el).forEach(b => b.onclick = () => App.switchRole(b.dataset.switch));
    $('#gReset', el).onclick = () => { oc.hide(); App.resetData(); };
    el.addEventListener('hidden.bs.offcanvas', () => el.remove());
  },
  /* ---------- Login screen ---------- */
  login() {
    const expired = sessionStorage.getItem('msdms_expired'); sessionStorage.removeItem('msdms_expired');
    const icons = { STATE_ADMIN: 'bank', STATE_OFFICER: 'briefcase', DISTRICT_OFFICER: 'map', TALUKA_OFFICER: 'pin-map', CENTRAL_WH: 'house-gear', DISTRICT_WH: 'boxes', TALUKA_WH: 'box-seam', TRANSPORT_MGR: 'truck', DRIVER: 'steering-wheel', PRINCIPAL: 'mortarboard', EMPLOYEE: 'person-workspace', STUDENT: 'person-badge' };
    document.body.className = 'login-body';
    document.body.innerHTML = `<div class="login-wrap">
      <section class="login-hero">
        <div class="brand"><div class="brand-mark">MS</div><div><div class="brand-name">MSDMS</div><div class="brand-sub">Prototype</div></div></div>
        <h1>Maharashtra Sanitary Distribution Management System</h1>
        <p>End-to-end traceability from central procurement to every eligible student — warehouses, transport, schools and beneficiaries on one platform.</p>
        <ul class="hero-pts"><li><i class="bi bi-diagram-3"></i> Central → District → Taluka → School supply chain</li><li><i class="bi bi-broadcast-pin"></i> Fleet tracking with simulated GPS</li><li><i class="bi bi-qr-code-scan"></i> QR-based student-wise distribution</li><li><i class="bi bi-stars"></i> AI insights: forecasts, risks and anomalies (simulated)</li></ul>
        <div class="hero-note">Demonstration prototype · fictional data only · not an official government service. Demo authentication is not production security.</div>
      </section>
      <section class="login-panel">
        <h2>Sign in</h2><p class="text-muted small mb-3">Select a demo role to fill the credentials, then sign in.</p>
        ${expired ? '<div class="alert alert-warning py-2 small">Your session expired due to inactivity. Please sign in again.</div>' : ''}
        <div class="role-grid">${DB.d.users.map(u => `<button type="button" class="role-card" data-email="${u.email}"><i class="bi bi-${icons[u.role] === 'steering-wheel' ? 'person-vcard' : icons[u.role]}"></i><strong>${esc(ROLES[u.role].label)}</strong><small>${esc(u.email)}</small></button>`).join('')}</div>
        <form id="loginForm" novalidate class="mt-3">
          <div class="row g-2"><div class="col-sm-7"><label class="form-label" for="lEmail">Email</label><input class="form-control" type="email" id="lEmail" required placeholder="admin@msdms.demo"><div class="invalid-feedback">Enter a valid demo email.</div></div>
          <div class="col-sm-5"><label class="form-label" for="lPw">Password</label><input class="form-control" type="password" id="lPw" required placeholder="Demo@123"><div class="invalid-feedback">Password is required.</div></div></div>
          <div class="alert alert-danger py-2 small mt-2" id="lErr" hidden>Invalid demo credentials. Password for all demo roles is <code>Demo@123</code>.</div>
          <button class="btn btn-primary w-100 mt-3" type="submit"><i class="bi bi-box-arrow-in-right"></i> Sign in</button>
        </form>
        <div class="d-flex justify-content-between small mt-3"><span class="text-muted">Demo password: <code>Demo@123</code></span><a href="#" id="lReset">Reset demo data</a></div>
      </section></div>`;
    $$('.role-card').forEach(b => b.onclick = () => { $$('.role-card').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); $('#lEmail').value = b.dataset.email; $('#lPw').value = DEMO_PASSWORD; $('#lErr').hidden = true; });
    $('#loginForm').onsubmit = e => {
      e.preventDefault(); const f = e.target; if (!f.checkValidity()) { f.classList.add('was-validated'); return; }
      const u = Auth.login($('#lEmail').value, $('#lPw').value); if (!u) { $('#lErr').hidden = false; return; }
      location.href = Auth.home(u);
    };
    $('#lReset').onclick = e => { e.preventDefault(); DB.reset(); UI.toast('Demo data has been reset.'); };
  },
  boot() {
    DB.load();
    const page = document.body.dataset.page; this.page = page;
    if (window.Chart) {
      Chart.defaults.font.family = "'Outfit Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"; Chart.defaults.font.size = 12; Chart.defaults.color = '#5d6285';
      Chart.defaults.plugins.legend.position = 'bottom'; Chart.defaults.plugins.legend.labels.boxWidth = 10; Chart.defaults.plugins.legend.labels.boxHeight = 10;
      Chart.defaults.elements.bar.borderRadius = 4; Chart.defaults.datasets.bar.maxBarThickness = 26; Chart.defaults.elements.line.borderWidth = 2; Chart.defaults.elements.point.radius = 3;
      Chart.defaults.scale.grid.color = '#eceef4'; Chart.defaults.maintainAspectRatio = false;
    }
    if (page === 'login') { if (Auth.user()) { location.href = Auth.home(); return; } this.login(); return; }
    const u = Auth.user(); if (!u) { location.href = 'login.html'; return; }
    if (typeof Ship !== 'undefined') Ship.sync();
    this.shell(page); this.root = $('#content');
    if (!Auth.canPage(page)) {
      this.root.innerHTML = `<div class="denied"><i class="bi bi-shield-lock"></i><h2>Access restricted</h2><p>The role <strong>${esc(ROLES[u.role].label)}</strong> is not authorised to open this module. This attempt has been recorded in the audit log.</p><a class="btn btn-primary" href="${Auth.home()}">Go to my home</a></div>`;
      Audit.log('Security', 'ACCESS_DENIED', page); DB.save();
    } else if (this.pages[page]) this.pages[page](this.root);
    if (typeof AI !== 'undefined') AI.mountAssistant();
  }
};
document.addEventListener('DOMContentLoaded', () => App.boot());
