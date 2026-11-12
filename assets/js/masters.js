/* =====================================================================
   MSDMS · masters.js
   Government administration masters: geography, departments, schools,
   school employees, users & role permission matrix.
   ===================================================================== */
'use strict';

/* ---------- Page: Geography & Masters ---------- */
let geoTab = 'districts';
App.pages.districts = root => {
  const d = DB.d, can = Auth.can('master.edit'), dIds = Scope.districtIds(), tIds = Scope.talukaIds();
  const dOpt = d.districts.map(x => ({ v: x.id, l: x.name })), tOpt = d.talukas.map(x => ({ v: x.id, l: `${x.name} (${DB.name('districts', x.districtId)})` }));
  const cfg = {
    divisions: { label: 'Divisions', icon: 'grid', rows: d.divisions, prefix: 'DIV', fields: [{ name: 'name', label: 'Division name', required: true, col: 12 }],
      cols: [{ key: 'id', label: 'Division ID' }, { key: 'name', label: 'Division' }, { label: 'Districts', value: x => d.districts.filter(y => y.divisionId === x.id).map(y => y.name).join(', ') }] },
    districts: { label: 'Districts', icon: 'map', rows: d.districts.filter(x => dIds.includes(x.id)), prefix: 'D', fields: [{ name: 'name', label: 'District name', required: true }, { name: 'divisionId', label: 'Division', type: 'select', required: true, options: d.divisions.map(x => ({ v: x.id, l: x.name })) }, { name: 'lat', label: 'Latitude', type: 'number', step: 'any', required: true, min: 15, max: 23 }, { name: 'lng', label: 'Longitude', type: 'number', step: 'any', required: true, min: 72, max: 81 }],
      cols: [{ key: 'id', label: 'Code' }, { key: 'name', label: 'District', render: x => `<strong>${esc(x.name)}</strong>` }, { label: 'Division', value: x => DB.name('divisions', x.divisionId) }, { label: 'Talukas', value: x => d.talukas.filter(y => y.districtId === x.id).length, cls: 'text-end' }, { label: 'Schools', value: x => d.schools.filter(y => y.districtId === x.id).length, cls: 'text-end' }, { label: 'Registered students', value: x => d.students.filter(y => y.districtId === x.id).length, cls: 'text-end' }, { label: 'District WH stock', value: x => Inv.total('WH-' + x.id), cls: 'text-end', render: x => U.num(Inv.total('WH-' + x.id)) }] },
    talukas: { label: 'Talukas', icon: 'pin-map', rows: d.talukas.filter(x => tIds.includes(x.id)), prefix: 'T', fields: [{ name: 'name', label: 'Taluka name', required: true }, { name: 'districtId', label: 'District', type: 'select', required: true, options: dOpt }, { name: 'lat', label: 'Latitude', type: 'number', step: 'any', required: true, min: 15, max: 23 }, { name: 'lng', label: 'Longitude', type: 'number', step: 'any', required: true, min: 72, max: 81 }],
      cols: [{ key: 'id', label: 'Code' }, { key: 'name', label: 'Taluka', render: x => `<strong>${esc(x.name)}</strong>` }, { label: 'District', value: x => DB.name('districts', x.districtId) }, { label: 'Villages', value: x => d.villages.filter(y => y.talukaId === x.id).length, cls: 'text-end' }, { label: 'Schools', value: x => d.schools.filter(y => y.talukaId === x.id).length, cls: 'text-end' }, { label: 'Taluka DC stock', value: x => Inv.total('DC-' + x.id), cls: 'text-end', render: x => DB.node('DC-' + x.id) ? U.num(Inv.total('DC-' + x.id)) : '—' }],
      filters: [{ key: 'd', label: 'District', get: x => DB.name('districts', x.districtId) }] },
    villages: { label: 'Villages & PIN Codes', icon: 'signpost', rows: d.villages.filter(x => tIds.includes(x.talukaId)), prefix: 'VIL', fields: [{ name: 'name', label: 'Village / locality', required: true }, { name: 'talukaId', label: 'Taluka', type: 'select', required: true, options: tOpt }, { name: 'pin', label: 'PIN Code', required: true, pattern: '4[0-9]{5}', error: '6-digit Maharashtra PIN (starts with 4)' }],
      cols: [{ key: 'id', label: 'Village ID' }, { key: 'name', label: 'Village / Locality' }, { label: 'Taluka', value: x => DB.name('talukas', x.talukaId) }, { label: 'District', value: x => DB.name('districts', DB.get('talukas', x.talukaId).districtId) }, { key: 'pin', label: 'PIN Code' }],
      filters: [{ key: 't', label: 'Taluka', get: x => DB.name('talukas', x.talukaId) }] },
    departments: { label: 'Government Departments', icon: 'bank', rows: d.departments, prefix: 'DEP', fields: [{ name: 'name', label: 'Department name', required: true, col: 12 }, { name: 'nodal', label: 'Nodal department for this scheme', type: 'checkbox' }],
      cols: [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Department' }, { label: 'Role', value: x => x.nodal ? 'Nodal department' : 'Partner department', render: x => x.nodal ? UI.badge('ACTIVE', 'Nodal') : UI.badge('CREATED', 'Partner') }] }
  };
  const tabs = Auth.isState() ? ['divisions', 'districts', 'talukas', 'villages', 'departments'] : ['districts', 'talukas', 'villages'];
  if (!tabs.includes(geoTab)) geoTab = tabs[0];
  const c = cfg[geoTab];
  root.innerHTML = UI.kpis([{ label: 'State', value: 'Maharashtra', icon: 'flag' }, { label: 'Divisions', value: d.divisions.length, icon: 'grid', tone: 'blue' }, { label: 'Districts', value: cfg.districts.rows.length, icon: 'map', tone: 'green' }, { label: 'Talukas', value: cfg.talukas.rows.length, icon: 'pin-map', tone: 'saffron' }, { label: 'Villages / PIN codes', value: cfg.villages.rows.length, icon: 'signpost' }], 'kpi-5') +
    UI.tabs('gtabs', tabs.map(k => ({ key: k, label: cfg[k].label, icon: cfg[k].icon, count: cfg[k].rows.length })), geoTab) + `<div class="panel"><div class="panel-b" id="gBody"></div></div>`;
  UI.onTabs('gtabs', k => { geoTab = k; App.refresh(); });
  UI.table('#gBody', {
    id: 'geo' + geoTab, rows: c.rows, exportName: geoTab, filters: c.filters || [],
    toolbar: can ? `<button class="btn btn-sm btn-primary" data-act="new"><i class="bi bi-plus-lg"></i> Add</button>` : '',
    columns: c.cols.concat(can ? [{ label: '', sort: false, noExport: true, render: () => UI.actBtn('edit', 'pencil', 'Edit') }] : []),
    onAction: (act, id) => {
      const rec = act === 'edit' ? DB.get(geoTab, id) : null;
      UI.modal({
        title: `${rec ? 'Edit' : 'Add'} · ${c.label}`, body: UI.fields(c.fields, rec || {}), onSubmit: f => {
          if (rec) { Audit.log('Masters', 'UPDATE_' + geoTab.toUpperCase(), rec.id, rec.name, f.name); Object.assign(rec, f); }
          else {
            let nid = geoTab === 'districts' || geoTab === 'talukas' ? f.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() : `${c.prefix}-${U.pad(d[geoTab].length + 1)}`;
            while (d[geoTab].some(x => x.id === nid)) nid += 'X';
            d[geoTab].push({ id: nid, ...f });
            if (geoTab === 'districts') d.nodes.push({ id: `WH-${nid}`, type: 'DISTRICT', name: `${f.name} District Warehouse`, districtId: nid, talukaId: null, lat: f.lat, lng: f.lng, capacity: 80000, manager: 'To be assigned' });
            if (geoTab === 'talukas') d.nodes.push({ id: `DC-${nid}`, type: 'TALUKA', name: `${f.name} Taluka Distribution Centre`, districtId: f.districtId, talukaId: nid, lat: f.lat, lng: f.lng, capacity: 15000, manager: 'To be assigned' });
            Audit.log('Masters', 'CREATE_' + geoTab.toUpperCase(), nid, '', f.name);
          }
          App.commit('Master record saved.');
        }
      });
    }
  });
};

/* ---------- Page: Schools ---------- */
const SchoolUI = {
  TYPES: ['Zilla Parishad', 'Government', 'Government Aided', 'Municipal', 'Ashram School'],
  form(s, limited) {
    const d = DB.d, tIds = Scope.talukaIds();
    return UI.fields([
      { name: 'name', label: 'School Name', required: true, col: 8 }, { name: 'udise', label: 'UDISE+ Code (fictional)', required: true, pattern: '[0-9]{11}', error: '11-digit code', col: 4, readonly: limited },
      limited ? null : { name: 'talukaId', label: 'Taluka', type: 'select', required: true, options: d.talukas.filter(x => tIds.includes(x.id)).map(x => ({ v: x.id, l: `${x.name} · ${DB.name('districts', x.districtId)}` })) },
      limited ? null : { name: 'villageId', label: 'Village', type: 'select', required: true, options: d.villages.filter(v => tIds.includes(v.talukaId)).map(v => ({ v: v.id, l: `${v.name} (${v.pin})` })) },
      { name: 'address', label: 'Address', required: true, col: 8 }, { name: 'pin', label: 'PIN Code', required: true, pattern: '4[0-9]{5}', error: '6-digit PIN', col: 4 },
      { name: 'type', label: 'School Type', type: 'select', required: true, options: this.TYPES, col: 4 },
      { name: 'lat', label: 'GPS Latitude', type: 'number', step: 'any', required: true, min: 15, max: 23, col: 4 }, { name: 'lng', label: 'GPS Longitude', type: 'number', step: 'any', required: true, min: 72, max: 81, col: 4 },
      { name: 'principal', label: 'Principal Name', required: true }, { name: 'principalMobile', label: 'Principal Mobile', required: true, pattern: '[0-9]{10}', error: '10-digit mobile number' },
      { name: 'totalStudents', label: 'Total Students', type: 'number', required: true, min: 0, step: 1 }, { name: 'eligible', label: 'Eligible Beneficiaries', type: 'number', required: true, min: 0, step: 1 }].filter(Boolean), s || { type: 'Zilla Parishad' });
  },
  save(s, f) {
    const d = DB.d;
    if (f.eligible > f.totalStudents) throw new Error('Eligible beneficiaries cannot exceed total students.');
    if (f.udise && d.schools.some(x => x.udise === f.udise && x !== s)) throw new Error('UDISE+ code already exists.');
    if (s) { Audit.log('Schools', 'UPDATE', s.id, `${s.name} | ${s.principal}`, `${f.name} | ${f.principal}`); Object.assign(s, f); const n = DB.node(s.id); n.name = s.name; n.lat = s.lat; n.lng = s.lng; return s; }
    const t = DB.get('talukas', f.talukaId), id = `SCH-${U.pad(d.schools.length + 1, 3)}`;
    const rec = { id, ...f, districtId: t.districtId, status: 'ACTIVE' }; d.schools.push(rec);
    d.nodes.push({ id, type: 'SCHOOL', name: f.name, districtId: t.districtId, talukaId: t.id, schoolId: id, lat: f.lat, lng: f.lng, capacity: 2000 });
    Audit.log('Schools', 'CREATE', id, '', f.name); return rec;
  },
  employees(s, canEmp) {
    const list = DB.d.employees.filter(e => e.schoolId === s.id);
    return `<div class="d-flex justify-content-between align-items-center mb-2"><h6 class="mb-0">Authorised employees</h6>${canEmp ? `<button type="button" class="btn btn-sm btn-primary" data-emp="new"><i class="bi bi-plus-lg"></i> Add employee</button>` : ''}</div>
      <table class="table table-sm align-middle"><thead><tr><th>ID</th><th>Name</th><th>Designation</th><th>Permissions</th><th>Status</th><th></th></tr></thead><tbody>${list.map(e => `<tr><td>${e.id}</td><td>${esc(e.name)}<div class="sub">${e.mobile}</div></td><td>${esc(e.designation)}</td><td>${['unload', 'inventory', 'distribute'].map(p => `<span class="perm ${e.perms[p] ? 'on' : ''}">${{ unload: 'Unloading', inventory: 'Inventory', distribute: 'Distribution' }[p]}</span>`).join('')}</td><td>${UI.badge(e.active ? 'ACTIVE' : 'INACTIVE')}</td><td>${canEmp ? `<button type="button" class="btn btn-sm btn-outline-primary" data-emp="${e.id}"><i class="bi bi-pencil"></i></button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="text-muted">No employees added.</td></tr>'}</tbody></table>`;
  },
  empDialog(s, e, done) {
    UI.modal({
      title: e ? `Edit employee ${e.id}` : 'Add school employee', body: UI.fields([{ name: 'name', label: 'Employee name', required: true }, { name: 'mobile', label: 'Mobile', required: true, pattern: '[0-9]{10}', error: '10-digit mobile number' }, { name: 'designation', label: 'Role / designation', type: 'select', required: true, options: ['Clerk', 'Teacher', 'Lab Assistant', 'Health Coordinator', 'Store Keeper'] }, { name: 'active', label: 'Active', type: 'checkbox', col: 6, value: e ? e.active : true },
        { html: '<label class="form-label">Distribution permissions</label>' }, { name: 'p_unload', label: 'Confirm unloading & goods receipt', type: 'checkbox', col: 12, value: e ? e.perms.unload : true }, { name: 'p_inventory', label: 'Update inventory / record damaged stock', type: 'checkbox', col: 12, value: e ? e.perms.inventory : true }, { name: 'p_distribute', label: 'Distribute to students (QR scan)', type: 'checkbox', col: 12, value: e ? e.perms.distribute : true }], e || {}),
      onSubmit: f => {
        const perms = { unload: f.p_unload, inventory: f.p_inventory, distribute: f.p_distribute }, rec = { name: f.name, mobile: f.mobile, designation: f.designation, active: f.active, perms };
        if (e) { Audit.log('School Employees', 'UPDATE', e.id, JSON.stringify(e.perms), JSON.stringify(perms)); Object.assign(e, rec); }
        else { const id = `EMP-${U.pad(DB.d.employees.length + 1, 3)}`; DB.d.employees.push({ id, schoolId: s.id, ...rec }); Audit.log('School Employees', 'CREATE', id, '', f.name); }
        DB.save(); UI.toast('Employee saved.'); done();
      }
    });
  },
  profile(s) {
    const act = DB.d.audit.filter(a => DB.d.users.some(u => u.id === a.userId && u.schoolId === s.id && u.role === 'EMPLOYEE')).slice(-6).reverse();
    return UI.kv([['School ID', s.id], ['UDISE+ Code (fictional)', s.udise], ['School Type', s.type], ['District / Taluka', `${DB.name('districts', s.districtId)} / ${DB.name('talukas', s.talukaId)}`], ['Village', DB.name('villages', s.villageId)], ['Address', esc(s.address) + ' – ' + s.pin], ['GPS Location', `${s.lat}, ${s.lng}`], ['Principal', esc(s.principal) + ' · ' + s.principalMobile], ['Total Students', U.num(s.totalStudents)], ['Eligible Beneficiaries', U.num(s.eligible)], ['Registered in system', DB.d.students.filter(x => x.schoolId === s.id).length], ['Current stock', U.num(Inv.total(s.id)) + ' packets'], ['Status', UI.badge(s.status)]]) +
      `<hr><div id="empBox"></div>` + (act.length ? `<h6 class="mt-3">Recent employee activity</h6><ul class="act-list">${act.map(a => `<li><strong>${esc(a.action.replace(/_/g, ' '))}</strong> · ${esc(a.module)} · ${esc(a.recordId)}<small>${esc(a.user)} · ${U.fmtDT(a.at)}</small></li>`).join('')}</ul>` : '');
  },
  bindEmp(el, s) {
    const canEmp = Auth.can('emp.manage') && Scope.schoolIds().includes(s.id), box = $('#empBox', el); if (!box) return;
    box.innerHTML = this.employees(s, canEmp);
    $$('[data-emp]', box).forEach(b => b.onclick = () => this.empDialog(s, b.dataset.emp === 'new' ? null : DB.get('employees', b.dataset.emp), () => this.bindEmp(el, s)));
  }
};

App.pages.schools = root => {
  const rows = Scope.schools(), can = Auth.can('school.edit'), u = Auth.user();
  if (Auth.is('PRINCIPAL')) { // own school profile
    const s = rows[0];
    root.innerHTML = UI.card(`${esc(s.name)}`, SchoolUI.profile(s), { icon: 'building', tools: `<button class="btn btn-sm btn-primary" id="spEdit"><i class="bi bi-pencil"></i> Edit school profile</button>` });
    SchoolUI.bindEmp(root, s);
    $('#spEdit').onclick = () => UI.modal({ title: 'Edit school profile', size: 'lg', body: SchoolUI.form(s, true), onSubmit: f => { SchoolUI.save(s, f); App.commit('School profile updated.'); } });
    return;
  }
  root.innerHTML = UI.kpis([{ label: 'Schools', value: rows.length, icon: 'building' }, { label: 'Active', value: rows.filter(s => s.status === 'ACTIVE').length, icon: 'check-circle', tone: 'green' }, { label: 'Total students', value: U.num(U.sum(rows, s => s.totalStudents)), icon: 'people', tone: 'blue' }, { label: 'Eligible beneficiaries', value: U.num(U.sum(rows, s => s.eligible)), icon: 'person-check', tone: 'saffron' }], 'kpi-4') + UI.card('School master', '<div id="scTbl"></div>', { icon: 'building' });
  UI.table('#scTbl', {
    id: 'sch', rows, exportName: 'schools', filters: [{ key: 'd', label: 'District', get: s => DB.name('districts', s.districtId) }, { key: 't', label: 'Taluka', get: s => DB.name('talukas', s.talukaId) }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }],
    toolbar: can ? `<button class="btn btn-sm btn-outline-primary" data-act="import"><i class="bi bi-upload"></i> Import Excel</button><button class="btn btn-sm btn-primary" data-act="new"><i class="bi bi-plus-lg"></i> Add School</button>` : '',
    columns: [{ key: 'id', label: 'School ID' }, { key: 'udise', label: 'UDISE+ Code' }, { key: 'name', label: 'School Name', render: s => `<a href="#" data-act="view" data-id="${s.id}"><strong>${esc(s.name)}</strong></a><div class="sub">${esc(s.type)}</div>` },
      { label: 'District', value: s => DB.name('districts', s.districtId) }, { label: 'Taluka', value: s => DB.name('talukas', s.talukaId) }, { label: 'Village', value: s => DB.name('villages', s.villageId), cls: 'd-none' }, { key: 'pin', label: 'PIN', cls: 'd-none' },
      { key: 'principal', label: 'Principal', render: s => `${esc(s.principal)}<div class="sub">${s.principalMobile}</div>` }, { key: 'totalStudents', label: 'Students', cls: 'text-end', render: s => U.num(s.totalStudents) }, { key: 'eligible', label: 'Eligible', cls: 'text-end', render: s => U.num(s.eligible) },
      { label: 'Stock', value: s => Inv.total(s.id), cls: 'text-end', render: s => U.num(Inv.total(s.id)) }, { key: 'status', label: 'Status', render: s => UI.badge(s.status) },
      { label: '', sort: false, noExport: true, render: s => `<div class="acts">${UI.actBtn('view', 'eye', 'View', 'outline-secondary')}${can ? UI.actBtn('edit', 'pencil', 'Edit') + UI.actBtn('toggle', s.status === 'ACTIVE' ? 'pause-circle' : 'play-circle', s.status === 'ACTIVE' ? 'Deactivate' : 'Activate', s.status === 'ACTIVE' ? 'outline-danger' : 'outline-success') : ''}</div>` }],
    onAction: (act, id) => {
      const s = id && DB.get('schools', id);
      if (act === 'new' || act === 'edit') return UI.modal({ title: s ? `Edit ${s.id}` : 'Add school', size: 'lg', body: SchoolUI.form(act === 'edit' ? s : null), onSubmit: f => { const r = SchoolUI.save(act === 'edit' ? s : null, f); App.commit(`School ${r.id} saved.`); } });
      if (act === 'view') return UI.modal({ title: `${esc(s.name)}`, size: 'xl', cancel: 'Close', body: SchoolUI.profile(s), onShow: el => SchoolUI.bindEmp(el, s) });
      if (act === 'toggle') return UI.confirm(`${s.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} school`, `Change status of <strong>${esc(s.name)}</strong>? Deactivated schools are excluded from allocations and dispatch.`, () => { const old = s.status; s.status = old === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'; Audit.log('Schools', 'STATUS_CHANGE', s.id, old, s.status); App.commit(`School ${s.status.toLowerCase()}.`); }, s.status === 'ACTIVE' ? 'danger' : 'success');
      if (act === 'import') {
        const t0 = DB.get('talukas', Scope.talukaIds()[0]), v0 = DB.d.villages.find(v => v.talukaId === t0.id);
        UI.importDialog({
          title: 'Import schools from Excel (CSV)', columns: ['name', 'udise', 'talukaId', 'villageId', 'address', 'pin', 'type', 'lat', 'lng', 'principal', 'principalMobile', 'totalStudents', 'eligible'],
          sample: `Demo Kanya Vidyalaya (Imported),27${Date.now().toString().slice(-9)},${t0.id},${v0.id},"Main Road, ${v0.name}",${v0.pin},Government,${t0.lat + 0.02},${t0.lng + 0.02},Asha Demo,9000099901,310,120`,
          onRows: rws => { let ok = 0, bad = 0; rws.forEach(r => { try { if (!r.name || !/^[0-9]{11}$/.test(r.udise) || !Scope.talukaIds().includes(r.talukaId)) throw 0; SchoolUI.save(null, { ...r, lat: +r.lat, lng: +r.lng, totalStudents: +r.totalStudents || 0, eligible: +r.eligible || 0 }); ok++; } catch (e) { bad++; } }); Audit.log('Schools', 'BULK_IMPORT', '', '', `${ok} imported, ${bad} rejected`); App.commit(`${ok} school(s) imported${bad ? `, ${bad} row(s) rejected by validation` : ''}.`, bad ? 'warning' : 'success'); }
        });
      }
    }
  });
};

/* ---------- Page: Users & Roles ---------- */
App.pages.users = root => {
  const pages = NAV.flatMap(s => s.items), roles = Object.keys(ROLES);
  const scope = u => u.schoolId ? DB.name('schools', u.schoolId) : u.talukaId ? DB.name('talukas', u.talukaId) + ' Taluka' : u.districtId ? DB.name('districts', u.districtId) + ' District' : u.nodeId ? DB.nodeName(u.nodeId) : 'Maharashtra State';
  root.innerHTML = `<div class="sim-banner"><i class="bi bi-shield-exclamation"></i> <strong>Demo authentication only.</strong> Sessions are held in browser LocalStorage for this prototype. A production system requires server-side authentication, MFA / OTP, password policy, encrypted storage and server-enforced authorisation.</div>` +
    UI.card('Demo user accounts', '<div id="uTbl"></div>', { icon: 'people' }) +
    UI.card('Role × module permission matrix', `<div class="table-responsive"><table class="table table-sm matrix"><thead><tr><th>Module</th>${roles.map(r => `<th><span>${ROLES[r].label}</span></th>`).join('')}</tr></thead><tbody>${pages.map(p => `<tr><td>${t('page.' + p.page)}</td>${roles.map(r => `<td>${p.roles.includes(r) ? '<i class="bi bi-check-circle-fill text-success"></i>' : '<i class="bi bi-dash text-muted"></i>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`, { icon: 'shield-lock' }) +
    UI.card('Security design', `<div class="sec-grid">${[['person-lock', 'Role-based access control', 'Navigation, pages and actions are authorised per role from one permission map.'], ['geo-alt', 'Geographic data restriction', 'District, taluka and school users only see records inside their jurisdiction.'], ['building-lock', 'School-level isolation', 'Principals and employees cannot open another school\'s inventory or students.'], ['incognito', 'Student privacy', 'Beneficiaries may be minors: reports are minimised, names masked, history visible only to the student and authorised school staff.'], ['fingerprint', 'Aadhaar disabled', 'No Aadhaar data is collected or stored. Identity verification is a simulated status only.'], ['clock-history', 'Session expiry', `Idle sessions expire after ${DB.d.settings.sessionMinutes} minutes.`], ['journal-check', 'Audit trail', 'Every create, update, approval, stock and distribution action is logged with user, role and old/new values.'], ['diagram-2', 'Approval workflows', 'Allocations, additional requests and discrepancies follow configurable approval levels.']].map(x => `<div><i class="bi bi-${x[0]}"></i><strong>${x[1]}</strong><p>${x[2]}</p></div>`).join('')}</div>
      ${Auth.is('STATE_ADMIN') ? `<hr><form class="row g-2 align-items-end" id="sessForm"><div class="col-auto"><label class="form-label" for="sessMin">Session expiry (minutes of inactivity)</label><input class="form-control form-control-sm" id="sessMin" type="number" min="5" max="240" required value="${DB.d.settings.sessionMinutes}"></div><div class="col-auto"><button class="btn btn-sm btn-primary">Save</button></div></form>` : ''}`, { icon: 'shield-check' });
  UI.table('#uTbl', { id: 'usr', rows: DB.d.users, exportName: 'users', pageSize: 12, filters: [{ key: 'lvl', label: 'Level', get: u => ROLES[u.role].level }],
    columns: [{ key: 'id', label: 'User ID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Demo login' }, { label: 'Role', value: u => ROLES[u.role].label, render: u => UI.badge('IN_TRANSIT', ROLES[u.role].label) }, { label: 'Level', value: u => ROLES[u.role].level }, { label: 'Data scope', value: scope }, { label: 'Last activity', value: u => { const a = DB.d.audit.filter(x => x.userId === u.id).pop(); return a ? U.fmtDT(a.at) : '—'; } }] });
  const sf = $('#sessForm'); if (sf) sf.onsubmit = e => { e.preventDefault(); const v = +$('#sessMin').value; if (!(v >= 5 && v <= 240)) return UI.toast('Enter 5–240 minutes.', 'error'); Audit.log('Security', 'UPDATE_SESSION_EXPIRY', 'settings', DB.d.settings.sessionMinutes, v); DB.d.settings.sessionMinutes = v; App.commit('Session policy updated.'); };
};
