/* =====================================================================
   MSDMS · dashboard.js
   Role-specific dashboards: State command centre, district / taluka,
   warehouse, transport, driver, principal and school employee.
   ===================================================================== */
'use strict';

const Stats = {
  /* Statewide distributed = prior-month demo baseline aggregates + live transactions */
  baseline(districtIds, month) { return U.sum(DB.d.baseline.monthly.filter(m => !month || m.month === month), m => U.sum(districtIds, id => m.byDistrict[id] || 0)); },
  live(schoolIds, month) { return U.sum(DB.d.distributions.filter(x => schoolIds.includes(x.schoolId) && (!month || x.cycle === month)), x => x.qty); },
  coverage(schoolIds, cycle = U.month()) {
    const el = DB.d.students.filter(s => schoolIds.includes(s.schoolId) && Policy.entitlement(s) > 0), got = el.filter(s => Policy.distributed(s.id, cycle, 'MONTHLY') >= Policy.entitlement(s));
    return { eligible: el.length, served: got.length, pct: el.length ? Math.round(got.length / el.length * 100) : 0 };
  }
};

const Alerts = {
  all() {
    const out = [], ships = Scope.shipments(), nodes = Scope.nodes(), sIds = Scope.schoolIds(), add = (sev, type, icon, msg, link) => out.push({ sev, type, icon, msg, link });
    ships.filter(s => s.status === 'DELAYED').forEach(s => add('bad', 'Delayed vehicle', 'truck', `${s.id} (${DB.get('vehicles', s.vehicleId).regNo}) to ${DB.nodeName(s.toNode)} is delayed.`, 'tracking'));
    ships.filter(s => s.status === 'REACHED_DESTINATION').forEach(s => add('warn', 'Pending delivery', 'clipboard-check', `${s.id} reached ${DB.nodeName(s.toNode)}; goods receipt pending.`, 'deliveries'));
    Stock.alerts(nodes).forEach(a => add(a.sev, a.type === 'LOW_STOCK' ? 'Low stock' : a.type === 'EXPIRED_STOCK' ? 'Expired stock' : 'Expiring stock', a.type === 'LOW_STOCK' ? 'box-seam' : 'calendar-x', a.msg, 'inventory'));
    DB.d.requests.filter(r => sIds.includes(r.schoolId) && r.status.startsWith('PENDING')).forEach(r => add('warn', 'Pending additional request', 'envelope-exclamation', `${r.id}: ${DB.name('schools', r.schoolId)} requests ${U.num(r.qty)} packets (${r.status.replace(/_/g, ' ').toLowerCase()}).`, 'allocations'));
    DB.d.ledger.filter(t => t.type === 'ADJUSTMENT' && Math.abs(t.qty) >= 200 && nodes.some(n => n.id === t.nodeId)).slice(-5).forEach(t => add('bad', 'Unusual inventory adjustment', 'sliders', `${t.id}: ${t.qty > 0 ? '+' : ''}${U.num(t.qty)} at ${DB.nodeName(t.nodeId)} by ${t.user}.`, 'audit-logs'));
    if (!Auth.user().schoolId && new Date().getDate() >= 10) Scope.districtIds().forEach(id => { const c = Stats.coverage(DB.d.schools.filter(s => s.districtId === id && sIds.includes(s.id)).map(s => s.id)); if (c.eligible && c.pct < 40) add('warn', 'Low beneficiary coverage', 'people', `${DB.name('districts', id)}: ${c.pct}% of eligible students served this cycle (${c.served}/${c.eligible}).`, 'reports'); });
    return out.sort((a, b) => (a.sev === 'bad' ? 0 : 1) - (b.sev === 'bad' ? 0 : 1));
  },
  html(list, max = 8) { return list.length ? `<div class="alert-list">${list.slice(0, max).map(a => `<a class="alert-row ${a.sev}" href="${a.link}.html"><i class="bi bi-${a.icon}"></i><div><strong>${a.type}</strong><span>${esc(a.msg)}</span></div><i class="bi bi-chevron-right"></i></a>`).join('')}</div>${list.length > max ? `<div class="sub p-2 text-center">+ ${list.length - max} more alerts</div>` : ''}` : UI.empty('No critical alerts.', 'shield-check'); }
};

const Dash = {
  f: { fy: U.fy(), month: U.month(), division: '', district: '', taluka: '', school: '' },
  shipRows(list, n = 6) { return list.length ? `<table class="table table-sm align-middle mb-0"><thead><tr><th>Shipment</th><th>Route</th><th class="text-end">Qty</th><th>Status</th></tr></thead><tbody>${list.slice(0, n).map(s => `<tr><td><a href="shipments.html">${s.id}</a></td><td class="small">${esc(DB.nodeName(s.fromNode))} → ${esc(DB.nodeName(s.toNode))}</td><td class="text-end">${U.num(s.qty)}</td><td>${UI.badge(s.status)}</td></tr>`).join('')}</tbody></table>` : UI.empty('No shipments.', 'truck'); },
  quick(links) { return `<div class="quick">${links.map(l => `<a href="${l[0]}.html"><i class="bi bi-${l[1]}"></i><span>${l[2]}</span></a>`).join('')}</div>`; },
  canvas(id, h = 250) { return `<div class="chart-box" style="height:${h}px"><canvas id="${id}" role="img" aria-label="${id} chart"></canvas></div>`; },
  bar(id, labels, data, label, color = PALETTE[0], horizontal) { UI.chart(id, { type: 'bar', data: { labels, datasets: [{ label, data, backgroundColor: color }] }, options: { indexAxis: horizontal ? 'y' : 'x', plugins: { legend: { display: false } }, scales: { [horizontal ? 'x' : 'y']: { beginAtZero: true }, [horizontal ? 'y' : 'x']: { grid: { display: false } } } } }); },

  /* ---------- State command centre ---------- */
  state(root) {
    const d = DB.d, f = this.f;
    let schools = d.schools.filter(s => (!f.division || DB.get('districts', s.districtId).divisionId === f.division) && (!f.district || s.districtId === f.district) && (!f.taluka || s.talukaId === f.taluka) && (!f.school || s.id === f.school));
    const sIds = schools.map(s => s.id), dIds = [...new Set(schools.map(s => s.districtId))], tIds = [...new Set(schools.map(s => s.talukaId))];
    const narrow = f.taluka || f.school, base = id => narrow ? 0 : Stats.baseline(id);
    const nodeIds = d.nodes.filter(n => n.type === 'CENTRAL' ? !f.division && !f.district && !narrow : n.type === 'SCHOOL' ? sIds.includes(n.id) : n.type === 'TALUKA' ? tIds.includes(n.talukaId) && !f.school : dIds.includes(n.districtId) && !narrow).map(n => n.id);
    const ships = d.shipments.filter(s => nodeIds.includes(s.fromNode) || nodeIds.includes(s.toNode)), stu = d.students.filter(s => sIds.includes(s.schoolId));
    const dispatched = U.sum(ships.filter(s => s.dispatchDate), s => s.qty), received = U.sum(ships, s => s.receivedQty || 0), distributed = base(dIds) + Stats.live(sIds);
    const cov = Stats.coverage(sIds, f.month), alerts = Alerts.all();
    const opt = (list, sel, all) => `<option value="">${all}</option>` + list.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const months = d.baseline.monthly.map(m => m.month).concat([U.month()]);
    root.innerHTML = `<div class="filter-bar cmd-filters">
        <label>Financial Year<select class="form-select form-select-sm" data-f="fy"><option>${U.fy()}</option></select></label>
        <label>Month<select class="form-select form-select-sm" data-f="month">${months.slice().reverse().map(m => `<option value="${m}" ${m === f.month ? 'selected' : ''}>${U.monthLabel(m)}</option>`).join('')}</select></label>
        <label>Division<select class="form-select form-select-sm" data-f="division">${opt(d.divisions, f.division, 'All divisions')}</select></label>
        <label>District<select class="form-select form-select-sm" data-f="district">${opt(d.districts.filter(x => !f.division || x.divisionId === f.division), f.district, 'All districts')}</select></label>
        <label>Taluka<select class="form-select form-select-sm" data-f="taluka">${opt(d.talukas.filter(x => (!f.district || x.districtId === f.district) && (!f.division || DB.get('districts', x.districtId).divisionId === f.division)), f.taluka, 'All talukas')}</select></label>
        <label>School<select class="form-select form-select-sm" data-f="school">${opt(d.schools.filter(x => (!f.taluka || x.talukaId === f.taluka) && (!f.district || x.districtId === f.district)), f.school, 'All schools')}</select></label>
        <button class="btn btn-sm btn-light ms-auto" id="fClear"><i class="bi bi-x-circle"></i> Clear filters</button></div>` +
      UI.kpis([
        { label: 'Total Districts', value: dIds.length, icon: 'map' }, { label: 'Total Talukas', value: tIds.length, icon: 'pin-map' }, { label: 'Total Schools', value: schools.length, icon: 'building' },
        { label: 'Registered Students', value: U.num(stu.length), icon: 'people', tone: 'blue', sub: `${U.num(U.sum(schools, s => s.totalStudents))} enrolled in schools` },
        { label: 'Eligible Beneficiaries', value: U.num(U.sum(schools, s => s.eligible)), icon: 'person-check', tone: 'blue', sub: `${cov.eligible} registered & eligible` },
        { label: 'Total Procured Packets', value: U.num(U.sum(d.batches, b => b.approved)), icon: 'cart-check', tone: 'green' }, { label: 'Total Dispatched Packets', value: U.num(dispatched), icon: 'send', tone: 'green' },
        { label: 'Total Received Packets', value: U.num(received), icon: 'box-arrow-in-down', tone: 'green' }, { label: 'Total Distributed Packets', value: U.num(distributed), icon: 'bag-heart', tone: 'saffron', sub: `${U.num(Stats.live(sIds, f.month))} recorded in ${U.monthLabel(f.month)}` },
        { label: 'Remaining Stock', value: U.num(U.sum(nodeIds, id => Inv.total(id))), icon: 'boxes', tone: 'navy' }, { label: 'Active Vehicles', value: d.vehicles.filter(v => v.status === 'ON_TRIP').length, icon: 'truck', tone: 'blue', sub: `${d.vehicles.length} in fleet` },
        { label: 'Delayed Shipments', value: ships.filter(s => s.status === 'DELAYED').length, icon: 'exclamation-triangle', tone: 'red' }, { label: 'Pending School Requests', value: d.requests.filter(r => sIds.includes(r.schoolId) && r.status.startsWith('PENDING')).length, icon: 'envelope-exclamation', tone: 'red' }], 'kpi-cmd') +
      `<div class="grid-2-1">${UI.card('District distribution map', `<div id="dmap" class="dash-map"></div><div class="sub px-3 py-2">Circle size = packets distributed (FY). Click a district for statistics. Outline is indicative.</div>`, { icon: 'geo-alt', flush: true })}
        <div>${UI.card('Critical alerts', Alerts.html(alerts, 6), { icon: 'bell', flush: true, tools: `<span class="count-pill">${alerts.length}</span>` })}${typeof AI !== 'undefined' ? UI.card('AI executive brief', `<div class="ai-brief">${AI.summary().map(x => `<p>${x}</p>`).join('')}</div><a class="btn btn-sm btn-outline-primary mt-1" href="ai-insights.html"><i class="bi bi-stars"></i> Open AI Insights</a>`, { icon: 'stars', cls: 'ai-panel', tools: '<span class="ai-tag">Simulated AI</span>' }) : ''}</div></div>
      <div class="grid-3">${UI.card('District-wise distribution (packets, FY)', this.canvas('cDist'), { icon: 'bar-chart' })}${UI.card('Monthly distribution (packets, completed months)', this.canvas('cMon'), { icon: 'graph-up' })}${UI.card('Monthly procurement (packets approved)', this.canvas('cProc'), { icon: 'cart-check' })}
        ${UI.card(`Taluka-wise coverage · ${U.monthLabel(f.month)} (%)`, this.canvas('cTal'), { icon: 'pin-map' })}${UI.card('Inventory distribution by level', this.canvas('cInv'), { icon: 'pie-chart' })}${UI.card('Transportation performance (shipments)', this.canvas('cTr'), { icon: 'truck' })}</div>` +
      UI.card(`School-wise beneficiary coverage · ${U.monthLabel(f.month)} (%)`, this.canvas('cSch', Math.max(220, schools.length * 22)), { icon: 'building' }) + `<p class="formula">Distributed totals combine live transactions with demo baseline aggregates for prior months (district level). All figures are fictional.</p>`;
    $$('[data-f]').forEach(s => s.onchange = () => { f[s.dataset.f] = s.value; if (s.dataset.f === 'division') f.district = f.taluka = f.school = ''; if (s.dataset.f === 'district') f.taluka = f.school = ''; if (s.dataset.f === 'taluka') f.school = ''; App.refresh(); });
    $('#fClear').onclick = () => { Object.assign(f, { division: '', district: '', taluka: '', school: '', month: U.month() }); App.refresh(); };
    const dl = d.districts.filter(x => dIds.includes(x.id)), dval = x => base([x.id]) + Stats.live(schools.filter(s => s.districtId === x.id).map(s => s.id));
    this.bar('cDist', dl.map(x => x.name), dl.map(dval), 'Packets distributed');
    const doneM = months.slice(0, -1); UI.chart('cMon', { type: 'line', data: { labels: doneM.map(U.monthLabel), datasets: [{ label: 'Packets distributed', data: doneM.map(m => (narrow ? 0 : Stats.baseline(dIds, m)) + Stats.live(sIds, m)), borderColor: PALETTE[0], backgroundColor: 'rgba(67,56,202,.1)', fill: true, tension: .3 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } } });
    const pm = {}; d.batches.forEach(b => { const m = U.month(b.receivedOn); pm[m] = (pm[m] || 0) + b.approved; }); const pk = Object.keys(pm).sort();
    this.bar('cProc', pk.map(U.monthLabel), pk.map(k => pm[k]), 'Packets approved', PALETTE[2]);
    const tl = d.talukas.filter(x => tIds.includes(x.id)); this.bar('cTal', tl.map(x => x.name), tl.map(x => Stats.coverage(schools.filter(s => s.talukaId === x.id).map(s => s.id), f.month).pct), 'Coverage %', PALETTE[3]);
    const lv = ['CENTRAL', 'DISTRICT', 'TALUKA', 'SCHOOL'];
    UI.chart('cInv', { type: 'doughnut', data: { labels: ['Central warehouse', 'District warehouses', 'Taluka DCs', 'Schools'], datasets: [{ data: lv.map(t => U.sum(d.nodes.filter(n => n.type === t && nodeIds.includes(n.id)), n => Inv.total(n.id))), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }] }, options: { cutout: '62%' } });
    const tg = [['Received in full', ['RECEIVED']], ['Partially received', ['PARTIALLY_RECEIVED']], ['On the road', ['DISPATCHED', 'IN_TRANSIT', 'REACHED_DESTINATION']], ['Delayed', ['DELAYED']], ['Awaiting dispatch', ['CREATED', 'APPROVED', 'READY_FOR_DISPATCH']]];
    this.bar('cTr', tg.map(x => x[0]), tg.map(x => ships.filter(s => x[1].includes(s.status)).length), 'Shipments', PALETTE[1], true);
    this.bar('cSch', schools.map(s => s.id), schools.map(s => Stats.coverage([s.id], f.month).pct), 'Coverage %', PALETTE[0], true);
    const map = MapKit.create('dmap', { zoom: 7, center: [18.9, 73.9] }), mx = Math.max(1, ...dl.map(dval));
    dl.forEach(x => { const sc = schools.filter(s => s.districtId === x.id), c = Stats.coverage(sc.map(s => s.id), f.month); L.circleMarker([x.lat, x.lng], { radius: 10 + 22 * dval(x) / mx, color: '#7a0e33', weight: 1.5, fillColor: '#d61f45', fillOpacity: .65 }).addTo(map).bindPopup(`<strong>${esc(x.name)} District</strong><br>Schools: ${sc.length}<br>Eligible beneficiaries: ${U.num(U.sum(sc, s => s.eligible))}<br>Distributed (FY): ${U.num(dval(x))}<br>District WH stock: ${U.num(Inv.total('WH-' + x.id))}<br>Coverage this cycle: ${c.pct}%`).bindTooltip(x.name, { permanent: true, direction: 'bottom', className: 'map-lbl', offset: [0, 8] }); });
    if (dl.length) map.fitBounds(L.latLngBounds(dl.map(x => [x.lat, x.lng])).pad(0.35));
  },

  /* ---------- District / Taluka officer ---------- */
  geo(root) {
    const u = Auth.user(), isD = u.role === 'DISTRICT_OFFICER', own = Scope.ownNodeIds()[0], schools = Scope.schools(), sIds = schools.map(s => s.id), ships = Scope.shipments();
    const inc = ships.filter(s => s.toNode === own && [...Ship.ACTIVE, 'REACHED_DESTINATION'].includes(s.status)), out = ships.filter(s => s.fromNode === own && !['RECEIVED', 'PARTIALLY_RECEIVED', 'CANCELLED'].includes(s.status));
    const low = schools.filter(s => s.status === 'ACTIVE' && Stock.isLow(DB.node(s.id))), reqs = DB.d.requests.filter(r => sIds.includes(r.schoolId) && r.status.startsWith('PENDING')), cov = Stats.coverage(sIds), alerts = Alerts.all();
    root.innerHTML = UI.kpis([
      isD ? { label: 'Talukas', value: Scope.talukaIds().length, icon: 'pin-map' } : { label: 'Villages', value: DB.d.villages.filter(v => v.talukaId === u.talukaId).length, icon: 'signpost' },
      { label: 'Schools', value: schools.length, icon: 'building' }, { label: isD ? 'District warehouse stock' : 'Taluka DC stock', value: U.num(Inv.total(own)), icon: 'box-seam', tone: 'green' },
      { label: 'Incoming shipments', value: inc.length, icon: 'box-arrow-in-down', tone: 'blue' }, { label: 'Outgoing shipments', value: out.length, icon: 'send', tone: 'blue' },
      { label: 'School low-stock alerts', value: low.length, icon: 'exclamation-triangle', tone: 'red' }, { label: 'Additional requests pending', value: reqs.length, icon: 'envelope-exclamation', tone: 'saffron' }, { label: 'Coverage this cycle', value: cov.pct + '%', icon: 'people', tone: 'navy', sub: `${cov.served}/${cov.eligible} eligible served` }], 'kpi-4') +
      this.quick([['deliveries', 'clipboard-check', 'Receive stock'], ['allocations', 'diagram-3', isD ? 'Allocate to taluka' : 'Allocate to school'], ['shipments', 'send', 'Create shipment'], ['tracking', 'broadcast-pin', 'Track vehicles'], ['reports', 'file-earmark-bar-graph', isD ? 'District reports' : 'Taluka reports']]) +
      `<div class="grid-2">${UI.card('Stock availability by school', this.canvas('cGs', Math.max(240, schools.length * 26)), { icon: 'bar-chart' })}${UI.card('Critical alerts', Alerts.html(alerts, 7), { icon: 'bell', flush: true })}
      ${UI.card('Incoming shipments', this.shipRows(inc), { icon: 'box-arrow-in-down', flush: true })}${UI.card('Outgoing shipments', this.shipRows(out), { icon: 'send', flush: true })}</div>` +
      (isD ? UI.card('Taluka summary', `<table class="table table-sm align-middle mb-0"><thead><tr><th>Taluka</th><th class="text-end">Schools</th><th class="text-end">DC stock</th><th class="text-end">School stock</th><th class="text-end">Coverage</th></tr></thead><tbody>${DB.d.talukas.filter(t => t.districtId === u.districtId).map(t => { const sc = schools.filter(s => s.talukaId === t.id); return `<tr><td>${esc(t.name)}</td><td class="text-end">${sc.length}</td><td class="text-end">${U.num(Inv.total('DC-' + t.id))}</td><td class="text-end">${U.num(U.sum(sc, s => Inv.total(s.id)))}</td><td class="text-end">${Stats.coverage(sc.map(s => s.id)).pct}%</td></tr>`; }).join('')}</tbody></table>`, { icon: 'pin-map', flush: true }) : '');
    this.bar('cGs', schools.map(s => s.id), schools.map(s => Inv.total(s.id)), 'Packets in stock', PALETTE[0], true);
  },

  /* ---------- Warehouse managers ---------- */
  warehouse(root) {
    const own = Scope.ownNodeIds()[0], node = DB.node(own), bats = Inv.batches(own), ships = DB.d.shipments, sum = Inv.summary(own, U.month());
    const inc = ships.filter(s => s.toNode === own && [...Ship.ACTIVE, 'REACHED_DESTINATION'].includes(s.status)), out = ships.filter(s => s.fromNode === own && !['RECEIVED', 'PARTIALLY_RECEIVED', 'CANCELLED'].includes(s.status)), al = Stock.alerts([node]);
    root.innerHTML = UI.kpis([{ label: 'Stock on hand (packets)', value: U.num(Inv.total(own)), icon: 'boxes' }, { label: 'Batches in stock', value: bats.length, icon: 'upc-scan', tone: 'blue' }, { label: 'Received this month', value: U.num(sum.received + sum.additional), icon: 'box-arrow-in-down', tone: 'green' }, { label: 'Dispatched this month', value: U.num(sum.transferredOut), icon: 'send', tone: 'saffron' },
      { label: 'Awaiting dispatch', value: out.filter(s => !s.dispatchDate).length, icon: 'hourglass-split', tone: 'saffron' }, { label: 'Inbound shipments', value: inc.length, icon: 'truck', tone: 'blue' }, { label: 'Expiry / stock alerts', value: al.length, icon: 'exclamation-triangle', tone: 'red' }, { label: 'Capacity used', value: Math.round(Inv.total(own) / node.capacity * 100) + '%', icon: 'pie-chart' }], 'kpi-4') +
      this.quick([node.type === 'CENTRAL' ? ['procurement', 'box-arrow-in-down', 'Stock inward (PO)'] : ['deliveries', 'clipboard-check', 'Receive stock'], ['shipments', 'send', 'Create dispatch'], ['inventory', 'journal-text', 'Stock ledger'], ['allocations', 'diagram-3', 'Allocations'], ['tracking', 'broadcast-pin', 'Track vehicles']]) +
      `<div class="grid-2">${UI.card('Batch-wise stock (FEFO order)', this.canvas('cWb'), { icon: 'upc-scan' })}${UI.card('Alerts', al.length ? `<div class="alert-list">${al.map(a => `<div class="alert-row ${a.sev}"><i class="bi bi-exclamation-triangle"></i><div><strong>${a.type.replace(/_/g, ' ')}</strong><span>${esc(a.msg)}</span></div></div>`).join('')}</div>` : UI.empty('No stock alerts.', 'shield-check'), { icon: 'bell', flush: true })}
      ${UI.card('Outbound shipments', this.shipRows(out), { icon: 'send', flush: true })}${UI.card('Inbound shipments', this.shipRows(inc), { icon: 'box-arrow-in-down', flush: true })}</div>`;
    this.bar('cWb', bats.map(b => b.batch.batchNo), bats.map(b => b.qty), 'Packets', PALETTE[0]);
  },

  /* ---------- Transport manager ---------- */
  transport(root) {
    const d = DB.d, act = d.shipments.filter(s => Ship.ACTIVE.includes(s.status)), docs = d.vehicles.filter(v => U.daysBetween(new Date(), v.insuranceTill) <= 30 || U.daysBetween(new Date(), v.fitnessTill) <= 30);
    const done = d.shipments.filter(s => ['RECEIVED', 'PARTIALLY_RECEIVED'].includes(s.status)), unassigned = d.shipments.filter(s => ['APPROVED', 'READY_FOR_DISPATCH'].includes(s.status) && !s.vehicleId);
    root.innerHTML = UI.kpis([{ label: 'Fleet size', value: d.vehicles.length, icon: 'truck' }, { label: 'Vehicles on trip', value: d.vehicles.filter(v => v.status === 'ON_TRIP').length, icon: 'signpost-2', tone: 'blue' }, { label: 'Drivers available', value: d.drivers.filter(x => x.status === 'AVAILABLE').length, icon: 'person-vcard', tone: 'green' }, { label: 'Awaiting vehicle assignment', value: unassigned.length, icon: 'hourglass-split', tone: 'saffron' },
      { label: 'Delayed shipments', value: d.shipments.filter(s => s.status === 'DELAYED').length, icon: 'exclamation-triangle', tone: 'red' }, { label: 'GPS offline (simulated)', value: d.vehicles.filter(v => !v.gpsOnline).length, icon: 'wifi-off', tone: 'red' }, { label: 'Deliveries completed', value: done.length, icon: 'check-circle', tone: 'green' }, { label: 'Documents expiring ≤ 30 d', value: docs.length, icon: 'file-earmark-x', tone: 'saffron' }], 'kpi-4') +
      this.quick([['tracking', 'broadcast-pin', 'Live tracking'], ['shipments', 'send-check', 'Assign vehicles'], ['vehicles', 'truck', 'Fleet & drivers'], ['reports', 'file-earmark-bar-graph', 'Transport reports']]) +
      `<div class="grid-2">${UI.card('Shipment status', this.canvas('cTs'), { icon: 'bar-chart' })}${UI.card('Vehicles on the road', act.length ? `<div class="alert-list">${act.map(s => `<a class="alert-row ${s.status === 'DELAYED' ? 'bad' : ''}" href="tracking.html"><i class="bi bi-truck"></i><div><strong>${DB.get('vehicles', s.vehicleId).regNo} · ${s.id}</strong><span>${esc(DB.nodeName(s.fromNode))} → ${esc(DB.nodeName(s.toNode))} · ${Math.round(Ship.progress(s) * 100)}%</span></div>${UI.badge(s.status)}</a>`).join('')}</div>` : UI.empty('No active trips.', 'truck'), { icon: 'truck', flush: true })}
      ${UI.card('Awaiting vehicle assignment', this.shipRows(unassigned), { icon: 'hourglass-split', flush: true })}${UI.card('Document validity', docs.length ? `<table class="table table-sm mb-0"><thead><tr><th>Vehicle</th><th>Insurance</th><th>Fitness</th></tr></thead><tbody>${docs.map(v => `<tr><td>${v.regNo}</td><td>${U.fmtDate(v.insuranceTill)}</td><td>${U.fmtDate(v.fitnessTill)}</td></tr>`).join('')}</tbody></table>` : UI.empty('All documents valid.'), { icon: 'file-earmark-check', flush: true })}</div>`;
    const grp = U.groupBy(d.shipments, s => s.status), ks = SHIP_STATUS.filter(k => grp[k]);
    this.bar('cTs', ks.map(k => k.replace(/_/g, ' ')), ks.map(k => grp[k].length), 'Shipments', PALETTE[0], true);
  },

  /* ---------- Driver ---------- */
  driver(root) {
    const u = Auth.user(), dr = DB.get('drivers', u.driverId), v = dr.vehicleId && DB.get('vehicles', dr.vehicleId), mine = DB.d.shipments.filter(s => s.driverId === dr.id);
    const cur = mine.find(s => [...Ship.ACTIVE, 'REACHED_DESTINATION', 'READY_FOR_DISPATCH'].includes(s.status)), past = mine.filter(s => s.dispatchDate && s !== cur).reverse();
    root.innerHTML = `<div class="driver-wrap">${UI.card('My profile', UI.kv([['Driver', esc(dr.name)], ['Mobile', dr.mobile], ['Licence', dr.license + ' · valid till ' + U.fmtDate(dr.licenseTill)], ['Assigned vehicle', v ? `${v.regNo} · ${v.type}` : '—'], ['Status', UI.badge(dr.status)]]), { icon: 'person-vcard' })}
      ${UI.card('Current trip', cur ? `<div class="trip"><div class="trip-id">${cur.id} ${UI.badge(cur.status)}</div><div class="trip-route"><div><small>From</small><strong>${esc(DB.nodeName(cur.fromNode))}</strong></div><i class="bi bi-arrow-down"></i><div><small>To</small><strong>${esc(DB.nodeName(cur.toNode))}</strong></div></div>
        ${UI.kv([['Load', U.num(cur.qty) + ' packets'], ['Challan', cur.challanNo], ['Expected arrival', U.fmtDT(cur.eta)], ['Progress (simulated)', Math.round(Ship.progress(cur) * 100) + '%']])}<div class="mini-prog lg my-2"><i style="width:${Math.round(Ship.progress(cur) * 100)}%"></i></div>
        <div class="d-grid gap-2">${cur.status === 'DISPATCHED' ? '<button class="btn btn-primary btn-lg" data-a="start"><i class="bi bi-play-fill"></i> Start trip</button>' : ''}${['IN_TRANSIT', 'DELAYED'].includes(cur.status) ? '<button class="btn btn-success btn-lg" data-a="ff"><i class="bi bi-geo-alt-fill"></i> Mark reached destination</button><button class="btn btn-outline-warning" data-a="delay"><i class="bi bi-clock"></i> Report delay</button>' : ''}${cur.status === 'REACHED_DESTINATION' ? '<div class="alert alert-success mb-0">Reached destination. Waiting for unloading and goods receipt.</div>' : ''}${cur.status === 'READY_FOR_DISPATCH' ? '<div class="alert alert-info mb-0">Loading in progress. Trip starts after dispatch by the warehouse.</div>' : ''}<a class="btn btn-outline-primary" href="tracking.html"><i class="bi bi-map"></i> Open map</a></div></div>` : UI.empty('No trip assigned right now.', 'truck'), { icon: 'signpost-2' })}
      ${UI.card('Trip history', this.shipRows(past, 10), { icon: 'clock-history', flush: true })}</div>`;
    $$('[data-a]').forEach(b => b.onclick = () => ShipUI.act(b.dataset.a, cur));
  },

  /* ---------- School principal / employee ---------- */
  school(root) {
    const u = Auth.user(), s = DB.get('schools', u.schoolId), isP = u.role === 'PRINCIPAL', cyc = U.month(), stu = Scope.students(), cov = Stats.coverage([s.id]), sum = Inv.summary(s.id, cyc), stock = Inv.total(s.id);
    const req = Stock.schoolReq(s.id), reqs = DB.d.requests.filter(r => r.schoolId === s.id), inc = DB.d.shipments.filter(x => x.toNode === s.id && [...Ship.ACTIVE, 'REACHED_DESTINATION'].includes(x.status));
    const emps = DB.d.employees.filter(e => e.schoolId === s.id), eUsers = DB.d.users.filter(x => x.schoolId === s.id && (isP ? x.role === 'EMPLOYEE' : x.id === u.id)).map(x => x.id), act = DB.d.audit.filter(a => eUsers.includes(a.userId) && a.module !== 'Authentication').slice(-7).reverse();
    const distQty = U.sum(DB.d.distributions.filter(x => x.schoolId === s.id && x.cycle === cyc), x => x.qty), pendGrn = DB.d.grns.filter(g => g.nodeId === s.id && g.status === 'PENDING_CONFIRMATION').length;
    const tasks = [[inc.filter(x => x.status === 'REACHED_DESTINATION').length, 'deliveries', 'clipboard-check', 'shipment(s) arrived – confirm unloading and verify stock'], [cov.eligible - cov.served, 'distribution', 'qr-code-scan', 'eligible student(s) pending distribution this cycle'], [pendGrn, 'deliveries', 'person-check', 'receipt(s) awaiting Principal confirmation'], [stock < req ? 1 : 0, isP ? 'allocations' : 'inventory', 'box-seam', 'low stock – ' + (isP ? 'raise an additional request' : 'inform the Principal')]].filter(x => x[0] > 0);
    root.innerHTML = `<div class="school-head"><div><h2>${esc(s.name)}</h2><span>${s.id} · UDISE+ ${s.udise} · ${esc(DB.name('talukas', s.talukaId))}, ${esc(DB.name('districts', s.districtId))}</span></div>${UI.badge(s.status)}</div>` +
      UI.kpis(isP ? [{ label: 'Total students', value: U.num(s.totalStudents), icon: 'people' }, { label: 'Eligible girls', value: U.num(s.eligible), icon: 'person-check', tone: 'green', sub: `${cov.eligible} registered & eligible` }, { label: 'Monthly allocation (requirement)', value: U.num(req), icon: 'diagram-3', tone: 'blue' }, { label: 'Stock received this month', value: U.num(sum.received + sum.additional), icon: 'box-arrow-in-down', tone: 'green' },
        { label: 'Available inventory', value: U.num(stock), icon: 'box-seam', tone: stock < req ? 'red' : 'navy' }, { label: 'Distributed quantity', value: U.num(distQty), icon: 'bag-check', tone: 'saffron' }, { label: 'Pending distribution', value: cov.eligible - cov.served, icon: 'bag-x', tone: 'red', sub: 'students this cycle' }, { label: 'Additional stock requests', value: reqs.filter(r => r.status.startsWith('PENDING')).length, icon: 'envelope-plus', tone: 'saffron', sub: `${reqs.length} total` }]
        : [{ label: 'Available inventory', value: U.num(stock), icon: 'box-seam', tone: stock < req ? 'red' : 'navy' }, { label: 'Deliveries to unload', value: inc.filter(x => x.status === 'REACHED_DESTINATION').length, icon: 'clipboard-check', tone: 'saffron' }, { label: 'Pending distribution', value: cov.eligible - cov.served, icon: 'bag-x', tone: 'red' }, { label: 'Distributed this cycle', value: U.num(distQty), icon: 'bag-check', tone: 'green' }], 'kpi-4') +
      this.quick(isP ? [['students', 'person-plus', 'Register students'], ['deliveries', 'clipboard-check', 'Approve deliveries'], ['inventory', 'journal-text', 'School inventory'], ['allocations', 'envelope-plus', 'Additional request'], ['schools', 'people', 'Manage employees'], ['reports', 'file-earmark-bar-graph', 'Reports']] : [['deliveries', 'clipboard-check', 'Confirm unloading'], ['distribution', 'qr-code-scan', 'Scan student QR'], ['inventory', 'journal-text', 'Update inventory'], ['students', 'people', 'Students']]) +
      `<div class="grid-2">${UI.card(isP ? 'Action items' : 'My assigned tasks', tasks.length ? `<div class="alert-list">${tasks.map(x => `<a class="alert-row warn" href="${x[1]}.html"><i class="bi bi-${x[2]}"></i><div><strong>${x[0]}</strong><span>${x[3]}</span></div><i class="bi bi-chevron-right"></i></a>`).join('')}</div>` : UI.empty('Nothing pending. All tasks are complete.', 'check2-circle'), { icon: 'list-check', flush: true })}
      ${UI.card(`Class-wise distribution · ${U.monthLabel(cyc)}`, this.canvas('cCls', 230), { icon: 'bar-chart' })}
      ${UI.card(isP ? 'Employee activity' : 'My recent activity', act.length ? `<ul class="act-list p-3 mb-0">${act.map(a => `<li><strong>${esc(a.action.replace(/_/g, ' '))}</strong> · ${esc(a.module)} · ${esc(a.recordId)}<small>${esc(a.user)} · ${U.fmtDT(a.at)}</small></li>`).join('')}</ul>` : UI.empty('No activity logged yet.'), { icon: 'activity', flush: true })}
      ${UI.card('Incoming deliveries', this.shipRows(inc), { icon: 'truck', flush: true })}</div>` + (isP ? UI.card('Employees', `<table class="table table-sm mb-0"><thead><tr><th>ID</th><th>Name</th><th>Designation</th><th>Status</th></tr></thead><tbody>${emps.map(e => `<tr><td>${e.id}</td><td>${esc(e.name)}</td><td>${esc(e.designation)}</td><td>${UI.badge(e.active ? 'ACTIVE' : 'INACTIVE')}</td></tr>`).join('')}</tbody></table>`, { icon: 'people', flush: true, tools: '<a class="btn btn-sm btn-outline-primary" href="schools.html">Manage</a>' }) : '');
    const cls = [...new Set(stu.map(x => x.cls))].sort((a, b) => a - b), el = c => stu.filter(x => x.cls === c && Policy.entitlement(x) > 0);
    UI.chart('cCls', { type: 'bar', data: { labels: cls.map(c => 'Class ' + c), datasets: [{ label: 'Served', data: cls.map(c => el(c).filter(x => Stu.cycleStatus(x) === 'RECEIVED').length), backgroundColor: PALETTE[2] }, { label: 'Pending', data: cls.map(c => el(c).filter(x => Stu.cycleStatus(x) !== 'RECEIVED').length), backgroundColor: PALETTE[1] }] }, options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } } });
  }
};

App.pages.dashboard = root => {
  const r = Auth.user().role;
  if (R_STATE.includes(r)) Dash.state(root); else if (R_GEO.includes(r)) Dash.geo(root); else if (R_WH.includes(r)) Dash.warehouse(root);
  else if (r === 'TRANSPORT_MGR') Dash.transport(root); else if (r === 'DRIVER') Dash.driver(root); else Dash.school(root);
};
