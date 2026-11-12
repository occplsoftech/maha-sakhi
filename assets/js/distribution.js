/* =====================================================================
   MSDMS · distribution.js
   Allocations, monthly allocation engine, entitlement policy, additional
   on-demand requests and QR-based student-wise distribution.
   ===================================================================== */
'use strict';

const Alloc = {
  create(o) {
    if (!(o.qty > 0) || !Number.isInteger(o.qty)) throw new Error('Allocation quantity must be a positive whole number.');
    if (!Ship.destinations(o.fromNode).some(n => n.id === o.toNode)) throw new Error('Destination is outside the supply-chain hierarchy of the source.');
    const to = DB.node(o.toNode), a = { id: DB.nextId('ALC'), level: to.type, type: o.type || 'MANUAL', fromNode: o.fromNode, toNode: o.toNode, month: o.month || U.month(), qty: o.qty, status: 'APPROVED', shipmentId: null, createdAt: U.iso(new Date()), createdBy: DB.actor.name, remark: o.remark || '', requestId: o.requestId || null, cycleId: o.cycleId || null };
    DB.d.allocations.push(a);
    Audit.log('Allocations', 'CREATE', a.id, '', `${U.num(a.qty)} packets → ${to.name}`, `Approved by ${DB.actor.name}`);
    Notify.push('ALLOCATION_CREATED', a.type === 'MONTHLY' ? 'Monthly allocation created' : 'Allocation created', `${a.id}: ${U.num(a.qty)} packets allocated to ${to.name} for ${U.monthLabel(a.month)}.`, { nodes: [o.fromNode, o.toNode] });
    return a;
  },
  /* Monthly engine: eligible students → entitlement → school requirement → stock check → replenishment */
  compute(schools) {
    return schools.filter(s => s.status === 'ACTIVE').map(s => {
      const el = DB.d.students.filter(x => x.schoolId === s.id && Policy.entitlement(x) > 0), requirement = U.sum(el, x => Policy.entitlement(x)), stock = Inv.total(s.id);
      return { id: s.id, schoolId: s.id, eligible: el.length, requirement, stock, replenish: Math.max(0, requirement - stock) };
    });
  },
  LEVEL_ROLE: { TALUKA: 'TALUKA_OFFICER', DISTRICT: 'DISTRICT_OFFICER', STATE: 'STATE_ADMIN' },
  canApprove(r) {
    if (!r.status.startsWith('PENDING_') || !Auth.can('req.approve') || !Scope.schoolIds().includes(r.schoolId)) return false;
    return Auth.is('STATE_ADMIN') || Auth.is(this.LEVEL_ROLE[r.status.slice(8)]);
  },
  decide(r, approve, remark) {
    const lv = r.status.slice(8), levels = DB.d.settings.approvalLevels, old = r.status, s = DB.get('schools', r.schoolId);
    r.history.push({ at: U.iso(new Date()), by: DB.actor.name, level: lv, action: approve ? 'APPROVED' : 'REJECTED', remark });
    if (!approve) r.status = 'REJECTED';
    else { const nx = levels[levels.indexOf(lv) + 1]; r.status = nx ? 'PENDING_' + nx : 'APPROVED'; }
    Audit.log('Additional Requests', approve ? 'APPROVE' : 'REJECT', r.id, old, r.status, `${lv} level · ${remark}`);
    if (r.status === 'APPROVED') {
      const a = this.create({ fromNode: `DC-${s.talukaId}`, toNode: s.id, qty: r.qty, type: 'ADDITIONAL', remark: `Additional request ${r.id}`, requestId: r.id }); r.allocationId = a.id;
      Notify.push('REQUEST_APPROVED', 'Request approved', `${r.id} for ${U.num(r.qty)} packets is approved. Dispatch will follow from the Taluka DC.`, { nodes: [s.id, `DC-${s.talukaId}`] });
    } else Notify.push(approve ? 'REQUEST_RECEIVED' : 'REQUEST_APPROVED', approve ? 'Additional request pending' : 'Request rejected', `${r.id} (${s.name}) is now ${r.status.replace(/_/g, ' ').toLowerCase()}.`, { nodes: [s.id, `DC-${s.talukaId}`, `WH-${s.districtId}`] });
  }
};

let alcTab = 'alloc', engMonth = null;
App.pages.allocations = root => {
  const d = DB.d, u = Auth.user(), vis = Scope.nodeIds(), own = Scope.ownNodeIds().filter(id => DB.node(id).type !== 'SCHOOL');
  const allocs = d.allocations.filter(a => vis.includes(a.fromNode) || vis.includes(a.toNode)).reverse();
  const reqs = d.requests.filter(r => Scope.schoolIds().includes(r.schoolId)).reverse();
  const mine = reqs.filter(r => Alloc.canApprove(r));
  root.innerHTML = UI.kpis([
    { label: 'Allocations', value: allocs.length, icon: 'diagram-3' }, { label: 'Awaiting dispatch', value: allocs.filter(a => a.status === 'APPROVED').length, icon: 'hourglass-split', tone: 'saffron' },
    { label: 'Allocated this month (packets)', value: U.num(U.sum(allocs.filter(a => a.month === U.month() && a.status !== 'CANCELLED'), a => a.qty)), icon: 'box-seam', tone: 'blue' },
    { label: 'Additional requests pending', value: reqs.filter(r => r.status.startsWith('PENDING')).length, icon: 'envelope-exclamation', tone: 'red', sub: mine.length ? `${mine.length} awaiting your action` : '' }], 'kpi-4') +
    UI.tabs('atabs', [{ key: 'alloc', label: 'Allocations', icon: 'diagram-3', count: allocs.length }, { key: 'engine', label: 'Monthly allocation engine', icon: 'cpu' }, { key: 'req', label: 'Additional requests', icon: 'envelope-plus', count: reqs.length }, { key: 'policy', label: 'Entitlement policy', icon: 'sliders' }], alcTab) + `<div class="panel"><div class="panel-b" id="aBody"></div></div>`;
  UI.onTabs('atabs', k => { alcTab = k; App.refresh(); });
  const body = $('#aBody');

  if (alcTab === 'alloc') {
    UI.table(body, {
      id: 'alc', rows: allocs, exportName: 'allocations', filters: [{ key: 'level', label: 'Level', options: [{ v: 'DISTRICT', l: 'District' }, { v: 'TALUKA', l: 'Taluka' }, { v: 'SCHOOL', l: 'School' }] }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'month', label: 'Month', options: [...new Set(allocs.map(a => a.month))].map(m => ({ v: m, l: U.monthLabel(m) })) }],
      toolbar: Auth.can('alloc.create') && own.length ? `<button class="btn btn-sm btn-primary" data-act="new"><i class="bi bi-plus-lg"></i> New Allocation</button>` : '',
      columns: [{ key: 'id', label: 'Allocation ID', render: a => `<strong>${a.id}</strong>` }, { key: 'level', label: 'Level', render: a => UI.badge('IN_TRANSIT', a.level) }, { key: 'type', label: 'Type' }, { label: 'From', value: a => DB.nodeName(a.fromNode) }, { label: 'To', value: a => DB.nodeName(a.toNode) },
        { label: 'Month', value: a => a.month, render: a => U.monthLabel(a.month) }, { key: 'qty', label: 'Quantity', cls: 'text-end', render: a => U.num(a.qty) }, { key: 'shipmentId', label: 'Shipment', render: a => a.shipmentId || '—' }, { key: 'status', label: 'Status', render: a => UI.badge(a.status) },
        { label: '', sort: false, noExport: true, render: a => a.status === 'APPROVED' && !a.shipmentId && Scope.owns(a.fromNode) && Auth.can('ship.create') ? `<div class="acts">${UI.actBtn('ship', 'send', 'Create shipment', 'primary')}${Auth.can('alloc.create') ? UI.actBtn('cancel', 'x-lg', 'Cancel', 'outline-danger') : ''}</div>` : '' }],
      onAction: (act, id) => {
        const a = id && DB.get('allocations', id);
        if (act === 'ship') return ShipUI.newDialog({ fromNode: a.fromNode, toNode: a.toNode, qty: a.qty, allocationId: a.id });
        if (act === 'cancel') return UI.confirm('Cancel allocation', `Cancel <strong>${a.id}</strong>?`, () => { a.status = 'CANCELLED'; Audit.log('Allocations', 'CANCEL', a.id, 'APPROVED', 'CANCELLED'); App.commit('Allocation cancelled.', 'warning'); }, 'danger');
        UI.modal({
          title: 'New allocation', size: 'lg', submit: 'Approve allocation',
          body: UI.fields([{ name: 'fromNode', label: 'Allocating from', type: 'select', required: true, options: own.map(id => ({ v: id, l: DB.nodeName(id) })), value: own[0] }, { name: 'toNode', label: 'Allocate to', type: 'select', required: true, options: [] },
            { name: 'qty', label: 'Quantity (packets)', type: 'number', required: true, min: 1, step: 1 }, { name: 'month', label: 'Allocation month', type: 'month', required: true, value: U.month() }, { name: 'remark', label: 'Remarks / order reference', type: 'textarea', col: 12 }]) + `<div class="steps-note mt-3" id="alcHint"></div>`,
          onShow: el => { const f = n => $(`[name=${n}]`, el), fill = () => { f('toNode').innerHTML = '<option value="">Select…</option>' + Ship.destinations(f('fromNode').value).map(n => `<option value="${n.id}">${esc(n.name)} · stock ${U.num(Inv.total(n.id))}</option>`).join(''); $('#alcHint', el).innerHTML = `<i class="bi bi-info-circle"></i> Available at source: <strong>${U.num(Inv.total(f('fromNode').value))}</strong> packets. The allocation is fulfilled by a tracked shipment.`; }; fill(); f('fromNode').onchange = fill; },
          onSubmit: f => { const a2 = Alloc.create(f); App.commit(`Allocation ${a2.id} approved.`); }
        });
      }
    });
  } else if (alcTab === 'engine') {
    engMonth = engMonth || U.month();
    const lines = Alloc.compute(Scope.schools()), cyc = d.cycles.find(c => c.month === engMonth), isAdmin = Auth.is('STATE_ADMIN');
    const show = cyc ? cyc.lines.filter(l => Scope.schoolIds().includes(l.schoolId)).map(l => ({ id: l.schoolId, ...l })) : lines;
    body.innerHTML = `<div class="engine-steps">${['Identify eligible students', 'Apply entitlement policy', 'School-wise requirement', 'Check school stock', 'Replenishment need', 'Approve & allocate', 'Dispatch & receipt', 'Student distribution'].map((x, i) => `<div class="${cyc ? (cyc.status === 'APPROVED' ? (i < 6 ? 'done' : '') : i < 5 ? 'done' : '') : i < 5 ? 'cur' : ''}"><b>${i + 1}</b>${x}</div>`).join('')}</div>
      <div class="filter-bar"><label>Distribution month<select class="form-select form-select-sm" id="engM">${[1, 0, -1, -2].map(k => U.addMonths(U.month(), k)).map(m => `<option value="${m}" ${m === engMonth ? 'selected' : ''}>${U.monthLabel(m)}</option>`).join('')}</select></label>
      <div class="eng-sum"><span>Eligible students <b>${U.sum(show, l => l.eligible)}</b></span><span>Requirement <b>${U.num(U.sum(show, l => l.requirement))}</b></span><span>School stock <b>${U.num(U.sum(show, l => l.stock))}</b></span><span>Replenishment <b>${U.num(U.sum(show, l => l.replenish))}</b></span></div>
      <div class="ms-auto d-flex gap-2 align-items-end">${cyc ? UI.badge(cyc.status, `Cycle ${cyc.status}`) : UI.badge('DRAFT', 'Preview – not generated')}${isAdmin && !cyc ? `<button class="btn btn-sm btn-primary" id="engGen"><i class="bi bi-cpu"></i> Generate monthly allocation</button>` : ''}${isAdmin && cyc && cyc.status === 'GENERATED' ? `<button class="btn btn-sm btn-success" id="engApp"><i class="bi bi-check2-circle"></i> Approve & create school allocations</button>` : ''}</div></div><div id="engTbl"></div>
      <p class="formula">Requirement uses the entitlement policy configured by Government (see <em>Entitlement policy</em>) for registered eligible students; nothing is hard-coded. Replenishment = max(0, requirement − current school stock).</p>`;
    UI.table('#engTbl', { id: 'eng' + engMonth, rows: show, exportName: `monthly-allocation-${engMonth}`, filters: [{ key: 't', label: 'Taluka', get: l => DB.name('talukas', DB.get('schools', l.schoolId).talukaId) }],
      columns: [{ key: 'schoolId', label: 'School ID' }, { label: 'School', value: l => DB.name('schools', l.schoolId) }, { label: 'Taluka', value: l => DB.name('talukas', DB.get('schools', l.schoolId).talukaId) }, { key: 'eligible', label: 'Eligible students', cls: 'text-end' }, { key: 'requirement', label: 'Monthly requirement', cls: 'text-end' }, { key: 'stock', label: 'Existing stock', cls: 'text-end' }, { key: 'replenish', label: 'Replenishment', cls: 'text-end', render: l => l.replenish ? `<strong class="text-danger">${l.replenish}</strong>` : '<span class="text-success">Sufficient</span>' }] });
    $('#engM').onchange = e => { engMonth = e.target.value; App.refresh(); };
    const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
    on('#engGen', () => { const c = { id: `CYC-${engMonth}`, month: engMonth, status: 'GENERATED', createdAt: U.iso(new Date()), approvedBy: '', lines: Alloc.compute(d.schools) }; d.cycles.push(c); Audit.log('Monthly Allocation', 'GENERATE_CYCLE', c.id, '', `${c.lines.length} schools, replenishment ${U.sum(c.lines, l => l.replenish)}`); Notify.push('ALLOCATION_CREATED', 'Monthly allocation created', `Allocation cycle for ${U.monthLabel(engMonth)} generated and awaiting approval.`, {}); App.commit('Monthly allocation generated. Review and approve.'); });
    on('#engApp', () => UI.confirm('Approve monthly allocation', `Approve the ${U.monthLabel(engMonth)} cycle? School-level allocations will be created for every school that needs replenishment, for dispatch by the Taluka DC.`, () => { let n = 0; cyc.lines.filter(l => l.replenish > 0).forEach(l => { const s = DB.get('schools', l.schoolId); Alloc.create({ fromNode: `DC-${s.talukaId}`, toNode: s.id, qty: l.replenish, month: engMonth, type: 'MONTHLY', remark: `Cycle ${cyc.id}`, cycleId: cyc.id }); n++; }); cyc.status = 'APPROVED'; cyc.approvedBy = u.name; Audit.log('Monthly Allocation', 'APPROVE_CYCLE', cyc.id, 'GENERATED', 'APPROVED', u.name); App.commit(`Cycle approved. ${n} school allocation(s) created.`); }, 'success', 'Approve'));
    body.insertAdjacentHTML('beforeend', `<h6 class="mt-3">Allocation history by month</h6><table class="table table-sm"><thead><tr><th>Cycle</th><th>Month</th><th>Schools</th><th>Requirement</th><th>Replenishment</th><th>Status</th><th>Approved by</th></tr></thead><tbody>${d.cycles.slice().reverse().map(c => `<tr><td>${c.id}</td><td>${U.monthLabel(c.month)}</td><td>${c.lines.length}</td><td>${U.sum(c.lines, l => l.requirement)}</td><td>${U.sum(c.lines, l => l.replenish)}</td><td>${UI.badge(c.status)}</td><td>${esc(c.approvedBy || '—')}</td></tr>`).join('')}</tbody></table>`);
  } else if (alcTab === 'req') {
    const lv = d.settings.approvalLevels;
    body.innerHTML = `<div class="chain mb-3"><span><i class="bi bi-mortarboard"></i> School Principal</span>${lv.map(l => `<i class="bi bi-arrow-right"></i><span>${l[0] + l.slice(1).toLowerCase()} Officer</span>`).join('')}<i class="bi bi-arrow-right"></i><span>Approved</span><i class="bi bi-arrow-right"></i><span>Stock Dispatch</span><i class="bi bi-arrow-right"></i><span>School Receipt</span></div><div id="rqTbl"></div>`;
    UI.table('#rqTbl', {
      id: 'req', rows: reqs, exportName: 'additional-requests', filters: [{ key: 'status', label: 'Status' }],
      toolbar: Auth.can('req.raise') ? `<button class="btn btn-sm btn-primary" data-act="new"><i class="bi bi-plus-lg"></i> Raise additional request</button>` : '',
      columns: [{ key: 'id', label: 'Request ID', render: r => `<a href="#" data-act="track" data-id="${r.id}"><strong>${r.id}</strong></a>` }, { label: 'School', value: r => `${r.schoolId} ${DB.name('schools', r.schoolId)}`, render: r => `${r.schoolId}<div class="sub">${esc(DB.name('schools', r.schoolId))}</div>` }, { label: 'Request Date', value: r => r.date, render: r => U.fmtDate(r.date) },
        { key: 'currentStock', label: 'Stock at request', cls: 'text-end' }, { key: 'eligible', label: 'Eligible', cls: 'text-end' }, { key: 'qty', label: 'Requested', cls: 'text-end', render: r => `<strong>${U.num(r.qty)}</strong>` }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Approval Status', render: r => UI.badge(r.status) },
        { label: '', sort: false, noExport: true, render: r => `<div class="acts">${Alloc.canApprove(r) ? UI.actBtn('approve', 'check2', 'Approve', 'success') + UI.actBtn('reject', 'x-lg', 'Reject', 'outline-danger') : ''}${UI.actBtn('track', 'signpost', 'Track', 'outline-secondary')}</div>` }],
      onAction: (act, id) => {
        const r = id && DB.get('requests', id);
        if (act === 'new') { const s = DB.get('schools', u.schoolId); return UI.modal({ title: 'Raise additional stock request', size: 'lg', submit: 'Submit request', submitIcon: 'send', body: UI.kv([['School', `${s.id} · ${esc(s.name)}`], ['Current stock', U.num(Inv.total(s.id))], ['Eligible students', U.num(s.eligible)]]) + '<hr>' + UI.fields([{ name: 'qty', label: 'Requested quantity (packets)', type: 'number', required: true, min: 1, max: 5000, step: 1 }, { name: 'docs', label: 'Supporting document', type: 'file', accept: '.pdf,image/*', help: 'Demo: only the file name is stored.' }, { name: 'reason', label: 'Reason', type: 'textarea', required: true, col: 12, rows: 3 }]), onSubmit: f => { const rq = { id: DB.nextId('REQ'), schoolId: s.id, currentStock: Inv.total(s.id), eligible: s.eligible, qty: f.qty, reason: f.reason, date: U.iso(new Date()), docs: f.docs || 'not attached', status: 'PENDING_' + lv[0], history: [{ at: U.iso(new Date()), by: u.name, level: 'SCHOOL', action: 'RAISED', remark: '' }], allocationId: null }; d.requests.push(rq); Audit.log('Additional Requests', 'RAISE', rq.id, '', `${f.qty} packets`); Notify.push('REQUEST_RECEIVED', 'Additional request received', `${s.name} requested ${U.num(f.qty)} additional packets (${rq.id}).`, { nodes: [s.id, `DC-${s.talukaId}`, `WH-${s.districtId}`] }); App.commit(`Request ${rq.id} submitted to the ${lv[0].toLowerCase()} officer.`); } }); }
        if (act === 'track') return UI.modal({ title: `Request tracking · ${r.id} ${UI.badge(r.status)}`, size: 'lg', cancel: 'Close', body: UI.kv([['School', `${r.schoolId} · ${esc(DB.name('schools', r.schoolId))}`], ['Requested quantity', U.num(r.qty)], ['Current stock at request', r.currentStock], ['Eligible students', r.eligible], ['Reason', esc(r.reason)], ['Supporting documents', esc(r.docs)], ['Allocation', r.allocationId], ['Shipment', r.allocationId ? (DB.get('allocations', r.allocationId).shipmentId || 'Awaiting dispatch') : '—']]) + `<h6 class="mt-3">Approval trail</h6><ol class="timeline">${r.history.map(h => `<li><span class="dot st-${h.action === 'REJECTED' ? 'bad' : 'ok'}"></span><div><strong>${h.action} · ${h.level}</strong><small>${U.fmtDT(h.at)} · ${esc(h.by)}${h.remark ? ' · ' + esc(h.remark) : ''}</small></div></li>`).join('')}</ol>` });
        UI.modal({ title: `${act === 'approve' ? 'Approve' : 'Reject'} ${r.id}`, tone: act === 'approve' ? 'success' : 'danger', submit: act === 'approve' ? 'Approve' : 'Reject', body: `<p>${esc(DB.name('schools', r.schoolId))} requests <strong>${U.num(r.qty)}</strong> packets. Current school stock: <strong>${U.num(Inv.total(r.schoolId))}</strong>.</p>` + UI.fields([{ name: 'remark', label: 'Remarks', type: 'textarea', required: true, col: 12 }]), onSubmit: f => { Alloc.decide(r, act === 'approve', f.remark); App.commit(`Request ${r.id}: ${r.status.replace(/_/g, ' ')}`, act === 'approve' ? 'success' : 'warning'); } });
      }
    });
  } else {
    const can = Auth.can('policy.edit');
    body.innerHTML = `<div class="steps-note mb-3"><i class="bi bi-bank"></i> The monthly entitlement is <strong>configured by Government</strong>. The system never assumes a fixed number of packets per student; the rules below are demo values and can be replaced by the approved Government Resolution.</div><div id="polTbl"></div>
      <h6 class="mt-4">Approval levels for additional requests</h6><form id="lvForm" class="d-flex gap-3 flex-wrap align-items-center">${['TALUKA', 'DISTRICT', 'STATE'].map(l => `<div class="form-check"><input class="form-check-input" type="checkbox" id="lv${l}" value="${l}" ${d.settings.approvalLevels.includes(l) ? 'checked' : ''} ${can ? '' : 'disabled'}><label class="form-check-label" for="lv${l}">${l[0] + l.slice(1).toLowerCase()} level</label></div>`).join('')}${can ? '<button class="btn btn-sm btn-primary">Save approval levels</button>' : ''}</form>`;
    UI.table('#polTbl', {
      id: 'pol', rows: d.policies, search: false, toolbar: can ? `<button class="btn btn-sm btn-primary" data-act="new"><i class="bi bi-plus-lg"></i> Add policy rule</button>` : '',
      columns: [{ key: 'id', label: 'Rule ID' }, { key: 'name', label: 'Policy' }, { label: 'Classes', value: p => `${p.classFrom}–${p.classTo}` }, { key: 'packets', label: 'Packets / student / month', cls: 'text-end' }, { key: 'ref', label: 'Order reference' }, { key: 'effectiveFrom', label: 'Effective from', render: p => U.fmtDate(p.effectiveFrom) }, { label: 'Status', value: p => p.active ? 'ACTIVE' : 'INACTIVE', render: p => UI.badge(p.active ? 'ACTIVE' : 'INACTIVE') }, { label: '', sort: false, render: () => can ? UI.actBtn('edit', 'pencil', 'Edit') : '' }],
      onAction: (act, id) => { const p = act === 'edit' ? DB.get('policies', id) : null; UI.modal({ title: p ? `Edit ${p.id}` : 'Add entitlement rule', size: 'lg', body: UI.fields([{ name: 'name', label: 'Policy name', required: true, col: 12 }, { name: 'classFrom', label: 'Class from', type: 'number', required: true, min: 1, max: 12, col: 3 }, { name: 'classTo', label: 'Class to', type: 'number', required: true, min: 1, max: 12, col: 3 }, { name: 'packets', label: 'Packets per month', type: 'number', required: true, min: 0, max: 10, step: 1, col: 3 }, { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true, col: 3 }, { name: 'ref', label: 'Government order reference', required: true }, { name: 'active', label: 'Active', type: 'checkbox', col: 6 }], p || { active: true, effectiveFrom: U.day(new Date()) }), onSubmit: f => { if (f.classTo < f.classFrom) throw new Error('"Class to" must be ≥ "Class from".'); if (f.active && d.policies.some(x => x !== p && x.active && f.classFrom <= x.classTo && f.classTo >= x.classFrom)) throw new Error('Class range overlaps another active rule.'); if (p) { Audit.log('Entitlement Policy', 'UPDATE', p.id, `${p.classFrom}-${p.classTo}: ${p.packets}`, `${f.classFrom}-${f.classTo}: ${f.packets}`, f.ref); Object.assign(p, f); } else { const nid = `POL-${U.pad(d.policies.length + 1)}`; d.policies.push({ id: nid, ...f }); Audit.log('Entitlement Policy', 'CREATE', nid, '', `${f.classFrom}-${f.classTo}: ${f.packets}`, f.ref); } App.commit('Entitlement policy saved.'); } }); }
    });
    $('#lvForm').onsubmit = e => { e.preventDefault(); const sel = $$('#lvForm input:checked').map(i => i.value); if (!sel.length) return UI.toast('Select at least one approval level.', 'error'); Audit.log('Settings', 'UPDATE_APPROVAL_LEVELS', 'settings', d.settings.approvalLevels.join('>'), sel.join('>')); d.settings.approvalLevels = sel; App.commit('Approval levels updated.'); };
  }
};

/* ---------- QR-based student-wise distribution ---------- */
const Dist = {
  check(st, cycle = U.month()) {
    const ent = Policy.entitlement(st), gotM = Policy.distributed(st.id, cycle, 'MONTHLY'), gotA = Policy.distributed(st.id, cycle, 'ADDITIONAL'), extra = (st.extraAuth[cycle] || 0) - gotA;
    const monthlyLeft = Math.max(0, ent - gotM), type = monthlyLeft > 0 ? 'MONTHLY' : 'ADDITIONAL', permitted = monthlyLeft > 0 ? monthlyLeft : Math.max(0, extra);
    let block = '';
    if (st.enrollment !== 'ACTIVE') block = 'Student enrollment is not active.';
    else if (st.eligibility !== 'ELIGIBLE') block = `Student is not eligible (${st.eligibility.replace(/_/g, ' ').toLowerCase()}).`;
    else if (ent === 0) block = 'No entitlement policy applies to this class.';
    else if (permitted === 0) block = 'Monthly entitlement already distributed. Duplicate distribution is blocked unless the Principal authorises an additional allocation.';
    return { ent, gotM, gotA, permitted, type, block };
  },
  perform(st, qty, batchId, ack) {
    const u = Auth.user(), cycle = U.month(), c = this.check(st, cycle);
    if (st.schoolId !== u.schoolId) throw new Error('This student belongs to another school.');
    if (!Scope.employeePerm('distribute')) throw new Error('You do not have distribution permission. Contact the Principal.');
    if (c.block) throw new Error(c.block);
    if (!(qty > 0) || qty > c.permitted) throw new Error(`Permitted quantity is ${c.permitted} packet(s).`);
    const id = DB.nextId('DST');
    Inv.post({ nodeId: st.schoolId, batchId, qty: -qty, type: 'DISTRIBUTION', ref: id, note: `Distribution to ${st.id}` });
    const rec = { id, studentId: st.id, schoolId: st.schoolId, productId: DB.get('batches', batchId).productId, batchId, cycle, qty, at: U.iso(new Date()), employeeId: u.employeeId || u.id, ack: ack ? 'ACKNOWLEDGED' : 'PENDING', type: c.type };
    DB.d.distributions.push(rec);
    Audit.log('Distribution', 'DISTRIBUTE', id, '', `${qty} packet(s) · ${st.id} · ${c.type}`);
    Notify.push('DISTRIBUTION_RECORDED', 'Distribution recorded', `${qty} packet(s) issued for ${U.monthLabel(cycle)} (${id}).`, { studentId: st.id });
    const node = DB.node(st.schoolId); if (Stock.isLow(node)) Notify.push('LOW_STOCK', 'Low stock alert', `${node.name} has ${Inv.total(node.id)} packets left.`, { nodes: [node.id, `DC-${node.talukaId}`] });
    return rec;
  }
};

let distSel = null, distCls = '';
App.pages.distribution = root => {
  const u = Auth.user(), school = DB.get('schools', u.schoolId), cyc = U.month(), all = Scope.students().filter(s => s.enrollment === 'ACTIVE');
  const list = all.filter(s => !distCls || String(s.cls) === distCls), stock = Inv.total(school.id), elig = all.filter(s => Policy.entitlement(s) > 0), done = elig.filter(s => Stu.cycleStatus(s) === 'RECEIVED');
  const recs = DB.d.distributions.filter(x => x.schoolId === school.id).reverse(), canDo = Scope.employeePerm('distribute');
  root.innerHTML = UI.kpis([{ label: 'School stock (packets)', value: U.num(stock), icon: 'box-seam', tone: stock ? 'navy' : 'red' }, { label: 'Eligible students', value: elig.length, icon: 'person-check', tone: 'green' }, { label: `Distributed · ${U.monthLabel(cyc)}`, value: done.length, icon: 'bag-check', tone: 'blue' }, { label: 'Pending distribution', value: elig.length - done.length, icon: 'bag-x', tone: 'saffron' }], 'kpi-4') +
    `<div class="dist-layout"><section class="panel"><header class="panel-h"><h2><i class="bi bi-qr-code-scan"></i> Scan student QR</h2></header><div class="panel-b">
      <div class="scan-box"><div class="scan-frame"><i class="bi bi-qr-code"></i><span></span></div><p class="small text-muted mb-2">Camera scanning is simulated in this prototype.</p><button class="btn btn-primary" id="scanBtn" ${canDo ? '' : 'disabled'}><i class="bi bi-upc-scan"></i> Simulate QR scan</button></div>
      <div class="row g-2 mt-2"><div class="col-5"><label class="form-label" for="dCls">Class</label><select class="form-select form-select-sm" id="dCls"><option value="">All classes</option>${[...new Set(all.map(s => s.cls))].sort((a, b) => a - b).map(c => `<option ${String(c) === distCls ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="col-7"><label class="form-label" for="dId">Student ID (manual / assisted)</label><div class="input-group input-group-sm"><input class="form-control" id="dId" placeholder="MH-PUN-2026-000001" list="dIds"><button class="btn btn-outline-primary" id="dFind">Find</button></div><datalist id="dIds">${list.map(s => `<option value="${s.id}">`).join('')}</datalist></div></div>
      <div class="stu-pick mt-3">${list.map(s => `<button class="${s.id === distSel ? 'sel' : ''}" data-st="${s.id}"><span><strong>${esc(s.name)}</strong><small>${s.id} · Class ${s.cls}-${s.division} · Roll ${s.roll}</small></span>${UI.badge(Stu.cycleStatus(s))}</button>`).join('') || UI.empty('No students in this class.')}</div></div></section>
    <section class="panel" id="distPanel"></section></div>` + UI.card('Distribution register', '<div id="dstTbl"></div>', { icon: 'journal-check' });
  const panel = $('#distPanel'), st = distSel && DB.get('students', distSel);
  if (!st) panel.innerHTML = `<div class="panel-b">${UI.empty(canDo ? 'Scan a student QR code or pick a student to verify eligibility and entitlement.' : 'Distribution permission has not been assigned to you by the Principal.', 'person-bounding-box')}</div>`;
  else {
    const c = Dist.check(st), bats = Inv.batches(school.id).filter(b => Stock.expiry(b.batch) !== 'EXPIRED');
    panel.innerHTML = `<header class="panel-h"><h2><i class="bi bi-person-check"></i> Verification result</h2><span class="sub">QR payload: ${QR.payload(st)}</span></header><div class="panel-b">${Stu.card(st)}
      <div class="checks">${[[st.enrollment === 'ACTIVE', 'Enrollment active'], [st.eligibility === 'ELIGIBLE', 'Eligibility verified (simulated identity status)'], [c.ent > 0, `Monthly entitlement: ${c.ent} packet(s) as per policy`], [true, `Already distributed this cycle: ${c.gotM} monthly${c.gotA ? `, ${c.gotA} additional` : ''}`], [c.permitted > 0, c.permitted > 0 ? `Permitted now: ${c.permitted} packet(s) · ${c.type}` : 'No quantity permitted']].map(x => `<div class="${x[0] ? 'ok' : 'no'}"><i class="bi bi-${x[0] ? 'check-circle-fill' : 'x-circle-fill'}"></i> ${x[1]}</div>`).join('')}</div>
      ${c.block ? `<div class="alert alert-danger small mt-3 mb-0"><i class="bi bi-slash-circle"></i> ${esc(c.block)}</div>` : !bats.length ? `<div class="alert alert-warning small mt-3 mb-0"><i class="bi bi-box-seam"></i> No usable stock in school inventory. Receive a delivery or raise an additional request.</div>` :
        `<form id="distForm" class="mt-3" novalidate>${UI.fields([{ name: 'batchId', label: 'Product / batch (FEFO)', type: 'select', required: true, col: 8, options: bats.map(b => ({ v: b.batchId, l: `${DB.name('products', b.batch.productId)} · ${b.batch.batchNo} · ${b.qty} left` })), value: bats[0].batchId }, { name: 'qty', label: 'Quantity', type: 'number', required: true, min: 1, max: c.permitted, step: 1, value: c.permitted, col: 4 }, { name: 'ack', label: 'Student has received the packet(s) – acknowledgment captured', type: 'checkbox', required: true, col: 12 }])}<button class="btn btn-success w-100 mt-3" ${canDo ? '' : 'disabled'}><i class="bi bi-bag-check"></i> Confirm distribution</button></form>`}</div>`;
    const f = $('#distForm'); if (f) f.onsubmit = e => { e.preventDefault(); if (!f.checkValidity()) { f.classList.add('was-validated'); return; } const v = UI.formData(f); try { const r = Dist.perform(st, v.qty, v.batchId, v.ack); App.commit(`${r.id}: ${v.qty} packet(s) distributed. School stock is now ${Inv.total(school.id)}.`); } catch (er) { UI.toast(er.message, 'error'); } };
  }
  const pick = id => { const s = all.find(x => x.id === id.trim().toUpperCase()); if (!s) return UI.toast('Student ID not found in this school.', 'error'); distSel = s.id; Audit.log('Distribution', 'QR_SCAN', s.id); DB.save(); App.refresh(); };
  $('#scanBtn').onclick = () => { const pend = list.filter(s => Stu.cycleStatus(s) === 'PENDING'), s = (pend.length ? pend : list)[0]; if (!s) return UI.toast('No students to scan.', 'warning'); $('.scan-frame').classList.add('scanning'); setTimeout(() => pick(s.id), 900); };
  $('#dFind').onclick = () => pick($('#dId').value); $('#dCls').onchange = e => { distCls = e.target.value; App.refresh(); };
  $$('[data-st]').forEach(b => b.onclick = () => pick(b.dataset.st));
  UI.table('#dstTbl', { id: 'dst', rows: recs, exportName: 'distribution-register', filters: [{ key: 'cycle', label: 'Cycle', options: [...new Set(recs.map(r => r.cycle))].map(m => ({ v: m, l: U.monthLabel(m) })) }, { key: 'type', label: 'Type' }], empty: 'No distributions recorded yet.',
    columns: [{ key: 'id', label: 'Distribution ID', render: r => `<code>${r.id}</code>` }, { key: 'studentId', label: 'Student ID' }, { label: 'Student', value: r => DB.name('students', r.studentId) }, { label: 'Product', value: r => DB.name('products', r.productId) }, { label: 'Batch', value: r => DB.get('batches', r.batchId).batchNo }, { label: 'Cycle', value: r => r.cycle, render: r => U.monthLabel(r.cycle) }, { key: 'qty', label: 'Qty', cls: 'text-end' }, { label: 'Date & Time', value: r => r.at, render: r => U.fmtDT(r.at) }, { key: 'employeeId', label: 'Employee ID' }, { key: 'type', label: 'Type' }, { key: 'ack', label: 'Acknowledgment', render: r => UI.badge(r.ack) }] });
};
