/* =====================================================================
   MSDMS · students.js
   Beneficiary registration, eligibility, QR identity and the mobile-first
   student portal. All students are fictional. NO Aadhaar data is
   collected or stored – identity verification is a simulated status.
   ===================================================================== */
'use strict';

const QR = {
  svg(text, cell = 4) { try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true }); } catch (e) { return '<div class="text-muted small">QR unavailable</div>'; } },
  payload(st) { return `MSDMS|${st.id}`; }
};

const Stu = {
  canSeeNames() { return Auth.is('PRINCIPAL', 'EMPLOYEE', 'STUDENT'); }, // data minimisation above school level
  name(st) { return this.canSeeNames() ? st.name : U.mask(st.name); },
  cycleStatus(st, cycle = U.month()) {
    const ent = Policy.entitlement(st), got = Policy.distributed(st.id, cycle, 'MONTHLY');
    return ent === 0 ? 'NOT_ELIGIBLE' : got >= ent ? 'RECEIVED' : got > 0 ? 'PARTIAL' : 'PENDING';
  },
  newId(districtId) { return `MH-${districtId}-${new Date().getFullYear()}-${U.pad(++DB.d.seq.STU, 6)}`; },
  register(f, schoolId) {
    const s = DB.get('schools', schoolId);
    if (!s || s.status !== 'ACTIVE') throw new Error('Select an active school.');
    if (DB.d.students.some(x => x.schoolId === schoolId && x.cls === f.cls && x.division === f.division && x.roll === f.roll && x.enrollment === 'ACTIVE')) throw new Error(`Roll number ${f.roll} already exists in Class ${f.cls}-${f.division}.`);
    const st = { id: this.newId(s.districtId), name: f.name, schoolId, districtId: s.districtId, talukaId: s.talukaId, cls: f.cls, division: f.division, roll: f.roll, eligibility: 'PENDING_VERIFICATION', enrollment: 'ACTIVE', registeredOn: U.iso(new Date()), verification: { status: 'PENDING', ref: '' }, extraAuth: {} };
    DB.d.students.push(st); Audit.log('Students', 'REGISTER', st.id, '', `Class ${f.cls}-${f.division}, ${s.id}`); return st;
  },
  card(st) {
    const s = DB.get('schools', st.schoolId);
    return `<div class="id-card"><div class="id-qr">${QR.svg(QR.payload(st))}</div><div class="id-info"><small>Beneficiary identity card · prototype</small><h4>${esc(this.name(st))}</h4><code>${st.id}</code><div>${esc(s.name)}</div><div>Class ${st.cls}-${st.division} · Roll ${st.roll}</div><div class="mt-1">${UI.badge(st.eligibility)}</div></div></div>`;
  },
  history(st, limit) {
    const rows = DB.d.distributions.filter(x => x.studentId === st.id).slice().reverse().slice(0, limit || 99);
    return rows.length ? `<table class="table table-sm align-middle mb-0"><thead><tr><th>Cycle</th><th>Date</th><th>Product</th><th>Batch</th><th class="text-end">Qty</th><th>Type</th></tr></thead><tbody>${rows.map(x => `<tr><td>${U.monthLabel(x.cycle)}</td><td>${U.fmtDT(x.at)}</td><td>${esc(DB.name('products', x.productId))}</td><td>${DB.get('batches', x.batchId).batchNo}</td><td class="text-end">${x.qty}</td><td>${UI.badge(x.type === 'ADDITIONAL' ? 'PENDING' : 'ACTIVE', x.type)}</td></tr>`).join('')}</tbody></table>` : UI.empty('No distribution recorded yet.');
  }
};

App.pages.students = root => {
  const rows = Scope.students(), can = Auth.can('student.edit'), cyc = U.month(), school = Auth.user().schoolId;
  const elig = rows.filter(s => s.eligibility === 'ELIGIBLE' && s.enrollment === 'ACTIVE'), done = elig.filter(s => Stu.cycleStatus(s) === 'RECEIVED');
  root.innerHTML = (Stu.canSeeNames() ? '' : `<div class="sim-banner"><i class="bi bi-incognito"></i> <strong>Data minimisation.</strong> Student names are masked above school level and private distribution history is restricted to the student and authorised school staff.</div>`) +
    UI.kpis([{ label: 'Registered students', value: rows.length, icon: 'people' }, { label: 'Eligible beneficiaries', value: elig.length, icon: 'person-check', tone: 'green' }, { label: 'Pending verification', value: rows.filter(s => s.eligibility === 'PENDING_VERIFICATION').length, icon: 'hourglass-split', tone: 'saffron' },
      { label: `Distributed · ${U.monthLabel(cyc)}`, value: done.length, icon: 'bag-check', tone: 'blue' }, { label: 'Pending this cycle', value: elig.length - done.length, icon: 'bag-x', tone: 'red' }], 'kpi-5') + UI.card('Beneficiary register', '<div id="stTbl"></div>', { icon: 'people' });
  const profile = st => {
    const ent = Policy.entitlement(st), extra = st.extraAuth[cyc] || 0, staff = Auth.is('PRINCIPAL', 'EMPLOYEE', 'STATE_ADMIN');
    UI.modal({
      title: `Student profile · ${st.id}`, size: 'lg', cancel: 'Close',
      body: Stu.card(st) + UI.kv([['Unique Student ID', st.id], ['School', esc(DB.name('schools', st.schoolId)) + ` (${st.schoolId})`], ['District / Taluka', `${DB.name('districts', st.districtId)} / ${DB.name('talukas', st.talukaId)}`], ['Class / Division / Roll', `${st.cls} / ${st.division} / ${st.roll}`], ['Eligibility', UI.badge(st.eligibility)], ['Enrollment', UI.badge(st.enrollment)], ['Registration Date', U.fmtDate(st.registeredOn)],
        ['Identity verification', UI.badge(st.verification.status, st.verification.status === 'VERIFIED_SIMULATED' ? 'Verified (simulated)' : 'Pending') + (st.verification.ref ? ` <code>${st.verification.ref}</code>` : '')], ['Monthly entitlement (policy)', `${ent} packet(s)`], [`Status · ${U.monthLabel(cyc)}`, UI.badge(Stu.cycleStatus(st))], ['Additional allocation authorised', extra ? `${extra} packet(s) this cycle` : 'None']]) +
        `<div class="steps-note my-3"><i class="bi bi-fingerprint"></i> Aadhaar is not collected, stored or used as a login ID in this prototype. Verification shown here is a simulated status from dummy records.</div>
        <div class="d-flex gap-2 flex-wrap mb-3"><button type="button" class="btn btn-sm btn-outline-primary" id="pQr"><i class="bi bi-printer"></i> Print QR card</button>${can && st.verification.status !== 'VERIFIED_SIMULATED' ? `<button type="button" class="btn btn-sm btn-outline-success" id="pVer"><i class="bi bi-patch-check"></i> Run simulated verification</button>` : ''}${Auth.is('PRINCIPAL', 'STATE_ADMIN') && ent > 0 ? `<button type="button" class="btn btn-sm btn-outline-warning" id="pExtra"><i class="bi bi-plus-circle"></i> Authorise additional allocation</button>` : ''}</div>
        <h6>Distribution history</h6>${staff ? Stu.history(st) : '<p class="text-muted small">Restricted. Individual distribution history is visible only to the student and authorised school staff.</p>'}`,
      onShow: (el, m) => {
        const on = (id, fn) => { const b = $(id, el); if (b) b.onclick = fn; };
        on('#pQr', () => UI.print(`Student QR card ${st.id}`, `<div style="display:flex;gap:20px;align-items:center;border:1px solid #999;padding:16px;width:420px"><div style="width:150px">${QR.svg(QR.payload(st))}</div><div><h2>${esc(st.name)}</h2><p><b>${st.id}</b><br>${esc(DB.name('schools', st.schoolId))}<br>Class ${st.cls}-${st.division} · Roll ${st.roll}</p></div></div>`));
        on('#pVer', () => { st.verification = { status: 'VERIFIED_SIMULATED', ref: `SIM-VRF-${U.pad(Math.floor(Math.random() * 99999), 5)}` }; const old = st.eligibility; if (old === 'PENDING_VERIFICATION') st.eligibility = 'ELIGIBLE'; Audit.log('Students', 'IDENTITY_VERIFICATION_SIMULATED', st.id, old, st.eligibility, st.verification.ref); m.hide(); App.commit('Simulated verification completed. Student marked eligible.'); });
        on('#pExtra', () => { m.hide(); UI.modal({ title: `Authorise additional allocation · ${st.id}`, tone: 'warning', submit: 'Authorise', body: UI.fields([{ name: 'qty', label: 'Additional packets (this cycle)', type: 'number', required: true, min: 1, max: 4, step: 1, value: 1 }, { name: 'reason', label: 'Reason', type: 'select', required: true, options: ['Medical need certified by school health coordinator', 'Loss / damage of issued packet', 'Other approved reason'] }]), onSubmit: f => { st.extraAuth[cyc] = (st.extraAuth[cyc] || 0) + f.qty; Audit.log('Students', 'AUTHORISE_ADDITIONAL', st.id, '', `${f.qty} packet(s) · ${f.reason}`, 'Principal'); App.commit('Additional distribution authorised for this cycle.'); } }); });
      }
    });
  };
  const form = st => UI.fields([{ name: 'name', label: 'Student Name', required: true, col: 12, pattern: "[A-Za-z .'-]{3,60}", error: 'Enter 3–60 letters.' },
    school || st ? null : { name: 'schoolId', label: 'School', type: 'select', required: true, col: 12, options: Scope.schools().filter(s => s.status === 'ACTIVE').map(s => ({ v: s.id, l: `${s.id} · ${s.name}` })) },
    { name: 'cls', label: 'Class', type: 'select', required: true, options: [6, 7, 8, 9, 10, 11, 12], col: 4 }, { name: 'division', label: 'Division', type: 'select', required: true, options: ['A', 'B', 'C', 'D'], col: 4 }, { name: 'roll', label: 'Roll Number', type: 'number', required: true, min: 1, max: 200, step: 1, col: 4 }].filter(Boolean), st || {});
  UI.table('#stTbl', {
    id: 'stu', rows, exportName: 'students', pageSize: 12,
    filters: [...(school ? [] : [{ key: 'school', label: 'School', get: s => s.schoolId }]), { key: 'cls', label: 'Class', get: s => String(s.cls) }, { key: 'eligibility', label: 'Eligibility' }, { key: 'enrollment', label: 'Enrollment' }, { key: 'c', label: 'This cycle', get: s => Stu.cycleStatus(s) }],
    toolbar: can ? `<button class="btn btn-sm btn-outline-primary" data-act="import"><i class="bi bi-upload"></i> Bulk import</button><button class="btn btn-sm btn-primary" data-act="new"><i class="bi bi-person-plus"></i> Register Student</button>` : '',
    columns: [{ key: 'id', label: 'Student ID', render: s => `<a href="#" data-act="view" data-id="${s.id}"><code>${s.id}</code></a>` }, { label: 'Student Name', value: s => Stu.name(s), render: s => `<strong>${esc(Stu.name(s))}</strong>` },
      { label: 'School', value: s => s.schoolId, render: s => `${s.schoolId}<div class="sub">${esc(DB.name('talukas', s.talukaId))}, ${esc(DB.name('districts', s.districtId))}</div>` }, { label: 'Class', value: s => `${s.cls}-${s.division}` }, { key: 'roll', label: 'Roll', cls: 'text-end' },
      { key: 'eligibility', label: 'Eligibility', render: s => UI.badge(s.eligibility) }, { key: 'enrollment', label: 'Enrollment', render: s => UI.badge(s.enrollment) }, { label: 'Entitlement', value: s => Policy.entitlement(s), cls: 'text-end' },
      { label: U.monthLabel(cyc), value: s => Stu.cycleStatus(s), render: s => UI.badge(Stu.cycleStatus(s)) },
      { label: '', sort: false, noExport: true, render: () => `<div class="acts">${UI.actBtn('view', 'qr-code', 'Profile', 'outline-secondary')}${can ? UI.actBtn('edit', 'pencil', 'Edit') + UI.actBtn('manage', 'gear', 'Manage', 'outline-primary') : ''}</div>` }],
    onAction: (act, id) => {
      const st = id && DB.get('students', id);
      if (act === 'view') return profile(st);
      if (act === 'new') return UI.modal({ title: 'Register student', submit: 'Register', submitIcon: 'person-plus', body: form() + '<div class="steps-note mt-3"><i class="bi bi-info-circle"></i> A unique Student ID and QR code are generated automatically. Eligibility is activated after the (simulated) authorised verification workflow.</div>', onSubmit: f => { const n = Stu.register({ ...f, cls: +f.cls }, school || f.schoolId); App.commit(`Student registered: ${n.id}`); setTimeout(() => profile(n), 400); } });
      if (act === 'edit') return UI.modal({ title: `Edit ${st.id}`, body: form(st), onSubmit: f => { Audit.log('Students', 'UPDATE', st.id, `${st.name}|${st.cls}-${st.division}|${st.roll}`, `${f.name}|${f.cls}-${f.division}|${f.roll}`); Object.assign(st, { name: f.name, cls: +f.cls, division: f.division, roll: f.roll }); App.commit('Student updated.'); } });
      if (act === 'manage') return UI.modal({
        title: `Eligibility, enrollment & transfer · ${st.id}`, size: 'lg', body: UI.fields([{ name: 'eligibility', label: 'Eligibility Status', type: 'select', required: true, options: ['ELIGIBLE', 'PENDING_VERIFICATION', 'NOT_ELIGIBLE'] }, { name: 'enrollment', label: 'Enrollment Status', type: 'select', required: true, options: ['ACTIVE', 'TRANSFERRED', 'INACTIVE'] },
          { name: 'schoolId', label: 'School (transfer)', type: 'select', required: true, col: 12, options: DB.d.schools.filter(s => s.status === 'ACTIVE').map(s => ({ v: s.id, l: `${s.id} · ${s.name}` })), help: 'Selecting another school transfers the student; history moves with the student ID.' }, { name: 'reason', label: 'Reason / order reference', type: 'textarea', required: true, col: 12 }], st),
        onSubmit: f => {
          if (f.eligibility === 'ELIGIBLE' && st.verification.status !== 'VERIFIED_SIMULATED') throw new Error('Run the (simulated) identity verification before marking the student eligible.');
          const old = `${st.eligibility}|${st.enrollment}|${st.schoolId}`;
          if (f.schoolId !== st.schoolId) { const ns = DB.get('schools', f.schoolId); st.schoolId = ns.id; st.districtId = ns.districtId; st.talukaId = ns.talukaId; f.enrollment = 'ACTIVE'; Audit.log('Students', 'SCHOOL_TRANSFER', st.id, old.split('|')[2], ns.id, f.reason); }
          st.eligibility = f.eligibility; st.enrollment = f.enrollment; Audit.log('Students', 'ELIGIBILITY_UPDATE', st.id, old, `${st.eligibility}|${st.enrollment}|${st.schoolId}`, f.reason); App.commit('Student status updated.');
        }
      });
      if (act === 'import') { const sid = school || Scope.schoolIds()[0]; UI.importDialog({ title: 'Bulk import students (Excel / CSV)', columns: ['name', 'schoolId', 'cls', 'division', 'roll'], sample: `Ananya Demo,${sid},8,A,${70 + Math.floor(Math.random() * 20)}\nKirti Demo,${sid},9,B,${91 + Math.floor(Math.random() * 20)}\nInvalid Row,${sid},15,A,3`, onRows: rws => { let ok = 0, bad = 0; rws.forEach(r => { try { const c = +r.cls, roll = +r.roll; if (!r.name || !(c >= 6 && c <= 12) || !(roll > 0) || !Scope.schoolIds().includes(r.schoolId)) throw 0; Stu.register({ name: r.name, cls: c, division: (r.division || 'A').toUpperCase(), roll }, r.schoolId); ok++; } catch (e) { bad++; } }); Audit.log('Students', 'BULK_IMPORT', '', '', `${ok} imported, ${bad} rejected`); App.commit(`${ok} student(s) imported${bad ? `, ${bad} row(s) rejected by validation` : ''}.`, bad ? 'warning' : 'success'); } }); }
    }
  });
};

/* ---------- Page: Student portal (mobile-first) ---------- */
App.pages['student-portal'] = root => {
  const st = DB.get('students', Auth.user().studentId), cyc = U.month(), ent = Policy.entitlement(st), got = Policy.distributed(st.id, cyc), status = Stu.cycleStatus(st);
  const notes = Scope.notifications().slice(0, 5), next = U.addMonths(cyc, 1);
  root.innerHTML = `<div class="portal">
    <section class="portal-card hero">${Stu.card(st)}</section>
    <section class="portal-card"><h3><i class="bi bi-calendar-check"></i> ${U.monthLabel(cyc)} allocation</h3>
      <div class="portal-stat"><div><strong>${ent}</strong><small>Monthly entitlement (packets)</small></div><div><strong>${got}</strong><small>Received this month</small></div><div>${UI.badge(status)}<small>Status</small></div></div>
      <p class="small text-muted mb-0">${status === 'RECEIVED' ? 'You have received this month\'s entitlement.' : status === 'NOT_ELIGIBLE' ? 'Your eligibility is not active. Please contact your school office.' : 'Collect your packets from the school distribution desk. Show this QR code or simply tell your Student ID / roll number.'}</p></section>
    <section class="portal-card"><h3><i class="bi bi-arrow-repeat"></i> Next distribution cycle</h3><p class="mb-0"><strong>${U.monthLabel(next)}</strong> · opens on 1 ${U.monthLabel(next)} at your school.</p></section>
    <section class="portal-card"><h3><i class="bi bi-clock-history"></i> My distribution history</h3>${Stu.history(st, 12)}</section>
    <section class="portal-card"><h3><i class="bi bi-bell"></i> Notifications</h3>${notes.map(n => `<div class="ntf-line"><strong>${esc(n.title)}</strong><span>${esc(n.msg)}</span><small>${U.fmtDT(n.at)}</small></div>`).join('') || UI.empty('No notifications')}</section>
    <section class="portal-card note"><i class="bi bi-heart"></i> This portal is optional. Students without a smartphone receive the same benefit through school-assisted distribution. Your history is private and visible only to you and authorised school staff.</section></div>`;
};
