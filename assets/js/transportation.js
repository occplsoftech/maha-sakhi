/* =====================================================================
   MSDMS · transportation.js
   Shipment workflow service, simulated GPS service, fleet & driver
   management, live tracking map, shipments and goods receipt (GRN).
   ALL GPS DATA IS SIMULATED.
   ===================================================================== */
'use strict';

/* ---------- Integration-ready mock location services ----------
   Replace these two adapters with real GPS-device / driver-app APIs.
   Contract:  getPosition(vehicle, shipment) -> { lat, lng, speed, at, online } */
const GpsDeviceService = {
  source: 'DEVICE', label: 'GPS hardware device (simulated)',
  getPosition(vehicle, shipment) { return Ship.simPosition(shipment, vehicle); }
};
const DriverAppService = {
  source: 'MOBILE', label: 'Driver mobile app (simulated)',
  getPosition(vehicle, shipment) { return Ship.simPosition(shipment, vehicle); }
};

const MH_OUTLINE = [[20.13, 72.74], [20.3, 73.4], [20.65, 73.45], [21.1, 73.8], [21.65, 73.85], [22.03, 74.3], [21.6, 74.6], [21.4, 75.5], [21.35, 76.2], [21.1, 76.6], [21.5, 77.3], [21.6, 78.2], [21.5, 78.9], [21.7, 79.5], [21.6, 80.3], [21.2, 80.65], [20.6, 80.5], [20.2, 80.5], [19.5, 80.8], [18.7, 80.3], [18.85, 79.9], [19.5, 79.9], [19.4, 79.2], [19.8, 78.3], [19.3, 77.9], [18.4, 77.6], [18.3, 77.0], [17.9, 76.9], [17.5, 76.3], [17.3, 75.6], [16.9, 75.3], [16.7, 74.6], [16.0, 74.4], [15.7, 74.0], [15.72, 73.68], [16.5, 73.33], [17.3, 73.2], [18.2, 72.95], [18.9, 72.8], [19.5, 72.72]];

const MapKit = {
  create(id, opts = {}) {
    const map = L.map(id, { zoomControl: true, attributionControl: true }).setView(opts.center || [18.9, 74.6], opts.zoom || 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 16, attribution: '© OpenStreetMap contributors' }).addTo(map);
    L.polygon(MH_OUTLINE, { color: '#7a0e33', weight: 1.5, fillColor: '#fde7ec', fillOpacity: 0.35, dashArray: '4 4', interactive: false }).addTo(map)
      .bindTooltip('Maharashtra – indicative outline', { sticky: true });
    return map;
  },
  icon(cls, glyph) { return L.divIcon({ className: '', html: `<div class="map-pin ${cls}"><i class="bi bi-${glyph}"></i></div>`, iconSize: [30, 30], iconAnchor: [15, 15] }); }
};

/* ---------- Shipment workflow ---------- */
const Ship = {
  ACTIVE: ['DISPATCHED', 'IN_TRANSIT', 'DELAYED'],
  get(id) { return DB.get('shipments', id); },
  destinations(fromId) {
    const f = DB.node(fromId); if (!f) return [];
    if (f.type === 'CENTRAL') return DB.d.nodes.filter(n => n.type === 'DISTRICT');
    if (f.type === 'DISTRICT') return DB.d.nodes.filter(n => n.type === 'TALUKA' && n.districtId === f.districtId);
    if (f.type === 'TALUKA') return DB.d.nodes.filter(n => n.type === 'SCHOOL' && n.talukaId === f.talukaId && DB.get('schools', n.id).status === 'ACTIVE');
    return [];
  },
  canManage(s) { return Auth.can('ship.create') && Scope.owns(s.fromNode); },
  canTransport(s) { return this.canManage(s) || Auth.can('ship.transport') || (Auth.is('DRIVER') && s.driverId === Auth.user().driverId); },
  canReceive(s) { return Scope.owns(s.toNode) && !Auth.is('CENTRAL_WH') && Scope.employeePerm('unload'); },
  step(s, status, note) {
    const old = s.status; s.status = status;
    s.timeline.push({ status, at: U.iso(new Date()), by: DB.actor ? DB.actor.name : 'System', note: note || '' });
    Audit.log('Shipments', 'STATUS_CHANGE', s.id, old, status, note);
  },
  create(o) {
    const from = DB.node(o.fromNode), to = DB.node(o.toNode);
    if (!from || !to || !this.destinations(from.id).some(n => n.id === to.id)) throw new Error('Destination is not valid for the selected source in the supply chain hierarchy.');
    if (!(o.qty > 0) || !Number.isInteger(o.qty)) throw new Error('Dispatch quantity must be a positive whole number.');
    const reserved = U.sum(DB.d.shipments.filter(s => s.fromNode === from.id && s.batchId === o.batchId && ['CREATED', 'APPROVED', 'READY_FOR_DISPATCH'].includes(s.status)), s => s.qty);
    const avail = Inv.qty(from.id, o.batchId) - reserved;
    if (o.qty > avail) throw new Error(`Only ${U.num(avail)} packets of this batch are available (after reservations). Negative stock is not permitted.`);
    const id = DB.nextId('SHP'), at = U.iso(new Date());
    const s = {
      id, fromNode: from.id, toNode: to.id, productId: DB.get('batches', o.batchId).productId, batchId: o.batchId, qty: o.qty,
      vehicleId: o.vehicleId || null, driverId: o.driverId || null, createdAt: at, dispatchDate: null, eta: o.eta ? U.iso(new Date(o.eta)) : U.iso(U.addDays(new Date(), 1)),
      status: 'CREATED', timeline: [{ status: 'CREATED', at, by: DB.actor.name }], receivedQty: null, damagedQty: null, shortageQty: null,
      grnNo: null, challanNo: `DC-${id.slice(4)}`, sim: null, allocationId: o.allocationId || null, requestId: null
    };
    DB.d.shipments.push(s);
    if (s.allocationId) { const a = DB.get('allocations', s.allocationId); if (a) { a.shipmentId = id; s.requestId = a.requestId || null; } }
    Audit.log('Shipments', 'CREATE', id, '', `${U.num(o.qty)} packets ${from.name} → ${to.name}`);
    Notify.push('DISPATCH_CREATED', 'Dispatch created', `${id}: ${U.num(o.qty)} packets planned from ${from.name} to ${to.name}.`, { nodes: [from.id, to.id] });
    return s;
  },
  assign(s, vehicleId, driverId) {
    const v = DB.get('vehicles', vehicleId), dr = DB.get('drivers', driverId);
    if (!v || !dr) throw new Error('Select a vehicle and a driver.');
    if (v.status !== 'AVAILABLE' && v.id !== s.vehicleId) throw new Error(`Vehicle ${v.regNo} is not available (${v.status}).`);
    if (dr.status !== 'AVAILABLE' && dr.id !== s.driverId) throw new Error(`Driver ${dr.name} is on another trip.`);
    if (new Date(v.insuranceTill) < new Date() || new Date(v.fitnessTill) < new Date()) throw new Error('Vehicle insurance / fitness has expired.');
    if (s.qty > v.capacity) throw new Error(`Quantity exceeds vehicle capacity (${U.num(v.capacity)} packets).`);
    const old = s.vehicleId; s.vehicleId = v.id; s.driverId = dr.id;
    Audit.log('Shipments', 'ASSIGN_VEHICLE', s.id, old || '', `${v.regNo} / ${dr.name}`);
  },
  approve(s) { this.step(s, 'APPROVED', 'Dispatch approved'); },
  ready(s) { if (!s.vehicleId || !s.driverId) throw new Error('Assign a vehicle and driver before marking ready.'); this.step(s, 'READY_FOR_DISPATCH'); },
  dispatch(s) {
    if (!s.vehicleId || !s.driverId) throw new Error('Assign a vehicle and driver before dispatch.');
    const v = DB.get('vehicles', s.vehicleId), dr = DB.get('drivers', s.driverId);
    if (v.status !== 'AVAILABLE') throw new Error(`Vehicle ${v.regNo} is not available (${v.status}).`);
    Inv.post({ nodeId: s.fromNode, batchId: s.batchId, qty: -s.qty, type: 'TRANSFER_OUT', ref: s.id, note: `Dispatch to ${DB.nodeName(s.toNode)}` });
    v.status = 'ON_TRIP'; dr.status = 'ON_TRIP'; s.dispatchDate = U.iso(new Date());
    this.step(s, 'DISPATCHED', `Challan ${s.challanNo} generated`);
    const a = s.allocationId && DB.get('allocations', s.allocationId); if (a) a.status = 'DISPATCHED';
    const r = s.requestId && DB.get('requests', s.requestId); if (r) r.status = 'DISPATCHED';
  },
  start(s) {
    s.sim = { start: Date.now(), dur: DB.d.settings.simTripSeconds || 75 };
    this.step(s, 'IN_TRANSIT', 'Trip started');
    Notify.push('VEHICLE_DEPARTED', 'Vehicle departed', `${s.id}: ${DB.get('vehicles', s.vehicleId).regNo} left ${DB.nodeName(s.fromNode)} for ${DB.nodeName(s.toNode)}.`, { nodes: [s.fromNode, s.toNode], roles: ['DRIVER'] });
  },
  arrive(s) {
    if (s.sim) { s.sim.start = Date.now() - s.sim.dur * 1000; delete s.sim.frozen; }
    this.step(s, 'REACHED_DESTINATION', 'Vehicle reached destination');
    Notify.push('VEHICLE_ARRIVED', 'Vehicle arrived', `${s.id} has reached ${DB.nodeName(s.toNode)}. Goods receipt is pending.`, { nodes: [s.fromNode, s.toNode] });
    Notify.push('DELIVERY_PENDING', 'Delivery pending', `Open Deliveries & GRN to unload and verify shipment ${s.id}.`, { nodes: [s.toNode] });
  },
  delay(s, reason) {
    this.step(s, 'DELAYED', reason || 'Marked delayed');
    Notify.push('VEHICLE_DELAYED', 'Vehicle delayed', `${s.id} is delayed${reason ? ': ' + reason : ''}.`, { nodes: [s.fromNode, s.toNode] });
  },
  cancel(s, reason) {
    if (!['CREATED', 'APPROVED', 'READY_FOR_DISPATCH'].includes(s.status)) throw new Error('Only shipments that have not been dispatched can be cancelled.');
    this.step(s, 'CANCELLED', reason);
    const a = s.allocationId && DB.get('allocations', s.allocationId); if (a) { a.shipmentId = null; }
  },
  /* Goods receipt. Dispatch quantity is never overwritten: received + damaged + shortage must equal it. */
  receive(s, o) {
    if (s.status !== 'REACHED_DESTINATION') throw new Error('Shipment has not reached the destination yet.');
    const received = o.received, damaged = o.damaged || 0, shortage = s.qty - received - damaged;
    if (received < 0 || damaged < 0 || shortage < 0) throw new Error('Received + damaged cannot exceed the dispatched quantity.');
    const node = DB.node(s.toNode), disc = damaged > 0 || shortage > 0;
    const needsConfirm = disc && node.type === 'SCHOOL' && Auth.is('EMPLOYEE');
    const grn = { id: DB.nextId('GRN'), shipmentId: s.id, nodeId: s.toNode, at: U.iso(new Date()), dispatched: s.qty, received, damaged, shortage, receivedBy: DB.actor.name, ack: o.ackName, proof: o.proof || 'not uploaded', remark: o.remark || '', status: needsConfirm ? 'PENDING_CONFIRMATION' : 'CONFIRMED' };
    DB.d.grns.push(grn); s.grnNo = grn.id;
    Audit.log('Deliveries', 'GOODS_RECEIPT', grn.id, `Dispatched ${s.qty}`, `Received ${received}, damaged ${damaged}, shortage ${shortage}`);
    if (disc) {
      DB.d.discrepancies.push({ id: DB.nextId('DSC'), shipmentId: s.id, grnNo: grn.id, nodeId: s.toNode, at: grn.at, damaged, shortage, remark: o.remark || '', status: node.type === 'SCHOOL' ? 'OPEN' : 'SUBMITTED_TO_TALUKA', history: [{ at: grn.at, by: DB.actor.name, action: 'Reported at receipt' }] });
    }
    if (needsConfirm) Notify.push('DELIVERY_PENDING', 'Receipt awaiting confirmation', `${grn.id} for ${s.id} has a discrepancy and needs the Principal's confirmation.`, { nodes: [s.toNode] });
    else this.confirmGrn(grn);
    return grn;
  },
  confirmGrn(grn) {
    const s = this.get(grn.shipmentId), a = s.allocationId && DB.get('allocations', s.allocationId);
    const note = `Receipt from ${DB.nodeName(s.fromNode)}${a && a.type === 'ADDITIONAL' ? ' (additional allocation)' : ''}`;
    if (grn.received + grn.damaged > 0) Inv.post({ nodeId: s.toNode, batchId: s.batchId, qty: grn.received + grn.damaged, type: 'TRANSFER_IN', ref: s.id, note });
    if (grn.damaged > 0) Inv.post({ nodeId: s.toNode, batchId: s.batchId, qty: -grn.damaged, type: 'DAMAGE', ref: s.id, note: 'Damaged on receipt' });
    grn.status = 'CONFIRMED'; s.receivedQty = grn.received; s.damagedQty = grn.damaged; s.shortageQty = grn.shortage;
    this.step(s, grn.damaged || grn.shortage ? 'PARTIALLY_RECEIVED' : 'RECEIVED', `${grn.id} confirmed`);
    const v = DB.get('vehicles', s.vehicleId), dr = DB.get('drivers', s.driverId); if (v) v.status = 'AVAILABLE'; if (dr) dr.status = 'AVAILABLE';
    if (a) a.status = 'RECEIVED';
    const r = s.requestId && DB.get('requests', s.requestId); if (r) r.status = 'RECEIVED';
    Notify.push('DELIVERY_CONFIRMED', 'Delivery confirmed', `${grn.id}: ${U.num(grn.received)} packets received at ${DB.nodeName(s.toNode)} (shipment ${s.id}).`, { nodes: [s.fromNode, s.toNode] });
    Notify.push('STOCK_RECEIVED', 'New stock received', `${DB.nodeName(s.toNode)} inventory increased by ${U.num(grn.received)} packets.`, { nodes: [s.toNode] });
  },
  /* ---- Simulation ---- */
  progress(s) {
    if (['REACHED_DESTINATION', 'RECEIVED', 'PARTIALLY_RECEIVED'].includes(s.status)) return 1;
    if (!s.sim || !['IN_TRANSIT', 'DELAYED'].includes(s.status)) return 0;
    return Math.max(0, Math.min(1, (Date.now() - s.sim.start) / (s.sim.dur * 1000)));
  },
  shown(s) { const v = DB.get('vehicles', s.vehicleId); return v && !v.gpsOnline && s.sim && s.sim.frozen != null ? s.sim.frozen : this.progress(s); },
  route(s) {
    const a = DB.node(s.fromNode), b = DB.node(s.toNode), n = 14, h = [...s.id].reduce((x, c) => x + c.charCodeAt(0), 0);
    const dx = b.lat - a.lat, dy = b.lng - a.lng, amp = (0.06 + (h % 5) * 0.012) * (h % 2 ? 1 : -1), pts = [];
    for (let i = 0; i <= n; i++) { const k = i / n, w = Math.sin(k * Math.PI) * amp + Math.sin(k * Math.PI * 3) * amp * 0.25; pts.push([a.lat + dx * k - dy * w, a.lng + dy * k + dx * w]); }
    return pts;
  },
  pointAt(route, p) { const f = p * (route.length - 1), i = Math.min(route.length - 2, Math.floor(f)), k = f - i; return [route[i][0] + (route[i + 1][0] - route[i][0]) * k, route[i][1] + (route[i + 1][1] - route[i][1]) * k]; },
  distance(s) { const r = this.route(s); let d = 0; for (let i = 1; i < r.length; i++) d += U.haversine(r[i - 1], r[i]); return d * 1.18; },
  simPosition(s, v) {
    const online = !v || v.gpsOnline, p = this.shown(s), [lat, lng] = this.pointAt(this.route(s), p);
    const moving = online && p > 0 && p < 1 && ['IN_TRANSIT', 'DELAYED'].includes(s.status);
    return { lat, lng, progress: p, online, speed: moving ? Math.round(44 + 12 * Math.sin(Date.now() / 9000 + s.id.length) + (s.status === 'DELAYED' ? -20 : 0)) : 0, at: online ? new Date() : new Date(s.sim && s.sim.lostAt || Date.now() - 9e5) };
  },
  position(s) { const v = DB.get('vehicles', s.vehicleId); return (v && v.gpsSource === 'MOBILE' ? DriverAppService : GpsDeviceService).getPosition(v, s); },
  sync() {
    let ch = false;
    DB.d.shipments.forEach(s => {
      if (!['IN_TRANSIT', 'DELAYED'].includes(s.status) || !s.sim) return;
      if (this.progress(s) >= 1) { this.arrive(s); ch = true; }
      else if (s.status === 'IN_TRANSIT' && new Date(s.eta) < new Date()) { this.delay(s, 'Expected arrival time exceeded'); ch = true; }
    });
    if (ch) DB.save(); return ch;
  },
  /* ---- Documents ---- */
  docHead(s) {
    const v = DB.get('vehicles', s.vehicleId), dr = DB.get('drivers', s.driverId), b = DB.get('batches', s.batchId);
    return UI.kv([['Shipment ID', s.id], ['Challan No.', s.challanNo], ['Source', esc(DB.nodeName(s.fromNode))], ['Destination', esc(DB.nodeName(s.toNode))], ['Product', esc(DB.name('products', s.productId))], ['Batch No.', b.batchNo + ' (Exp ' + U.fmtDate(b.exp) + ')'], ['Vehicle', v ? v.regNo + ' · ' + v.type : '—'], ['Driver', dr ? esc(dr.name) + ' · ' + dr.mobile : '—'], ['Dispatch Date', U.fmtDT(s.dispatchDate)], ['Expected Arrival', U.fmtDT(s.eta)]]);
  },
  sign(...who) { return `<div class="sign">${who.map(w => `<div>${w}</div>`).join('')}</div>`; },
  challan(s, transfer) {
    UI.doc(transfer ? `Stock Transfer Note · ${s.id}` : `Dispatch Challan · ${s.challanNo}`, this.docHead(s) + `<table class="table table-bordered mt-3"><thead><tr><th>#</th><th>Product</th><th>Batch</th><th>Dispatch Quantity (packets)</th></tr></thead><tbody><tr><td>1</td><td>${esc(DB.name('products', s.productId))}</td><td>${DB.get('batches', s.batchId).batchNo}</td><td>${U.num(s.qty)}</td></tr></tbody></table>` + this.sign('Dispatched by', 'Driver', 'Received by'));
  },
  grnDoc(grn, kind = 'GRN') {
    const s = this.get(grn.shipmentId), titles = { GRN: `Goods Receipt Note · ${grn.id}`, RECEIPT: `Delivery Receipt · ${grn.id}`, DISC: `Discrepancy Report · ${grn.id}` };
    UI.doc(titles[kind], this.docHead(s) + `<table class="table table-bordered mt-3"><thead><tr><th>Dispatched</th><th>Received (good)</th><th>Damaged</th><th>Shortage</th></tr></thead><tbody><tr><td>${U.num(grn.dispatched)}</td><td>${U.num(grn.received)}</td><td>${U.num(grn.damaged)}</td><td>${U.num(grn.shortage)}</td></tr></tbody></table>` +
      UI.kv([['GRN Number', grn.id], ['Receipt Date', U.fmtDT(grn.at)], ['Received by', esc(grn.receivedBy)], ['Acknowledged by', esc(grn.ack)], ['Delivery proof', esc(grn.proof)], ['Status', grn.status.replace(/_/g, ' ')], kind === 'DISC' ? ['Discrepancy remark', esc(grn.remark || '—')] : null]) + this.sign('Receiving official', 'Driver', kind === 'DISC' ? 'Reviewing authority' : 'Store in-charge'));
  }
};

/* ---------- Page: Vehicles & Drivers ---------- */
let vehTab = 'vehicles';
App.pages.vehicles = root => {
  const can = Auth.can('veh.manage'), d = DB.d;
  root.innerHTML = UI.kpis([
    { label: 'Vehicles', value: d.vehicles.length, icon: 'truck' }, { label: 'On trip', value: d.vehicles.filter(v => v.status === 'ON_TRIP').length, icon: 'signpost-2', tone: 'blue' },
    { label: 'Available', value: d.vehicles.filter(v => v.status === 'AVAILABLE').length, icon: 'check-circle', tone: 'green' },
    { label: 'Documents expiring ≤ 30 days', value: d.vehicles.filter(v => U.daysBetween(new Date(), v.insuranceTill) <= 30 || U.daysBetween(new Date(), v.fitnessTill) <= 30).length, icon: 'exclamation-triangle', tone: 'red' }], 'kpi-4') +
    UI.tabs('vtabs', [{ key: 'vehicles', label: 'Vehicles', icon: 'truck', count: d.vehicles.length }, { key: 'drivers', label: 'Drivers', icon: 'person-vcard', count: d.drivers.length }], vehTab) + `<div class="panel"><div class="panel-b" id="vtbl"></div></div>`;
  UI.onTabs('vtabs', k => { vehTab = k; App.refresh(); });
  const docBadge = dt => { const n = U.daysBetween(new Date(), dt); return `${U.fmtDate(dt)} ${n < 0 ? UI.badge('EXPIRED') : n <= 30 ? UI.badge('PENDING', n + ' days left') : ''}`; };
  if (vehTab === 'vehicles') {
    const form = v => UI.fields([
      { name: 'regNo', label: 'Registration Number', required: true, pattern: '[A-Z]{2}[0-9]{2}-[A-Z]{1,2}-[0-9]{4}', placeholder: 'MH12-AB-1234', error: 'Format: MH12-AB-1234' },
      { name: 'type', label: 'Vehicle Type', type: 'select', required: true, options: ['Truck (10T)', 'Truck (7T)', 'Tempo (3T)', 'Mini Truck (1.5T)'] },
      { name: 'capacity', label: 'Capacity (packets)', type: 'number', required: true, min: 100 },
      { name: 'driverId', label: 'Default Driver', type: 'select', options: d.drivers.map(x => ({ v: x.id, l: x.name })) },
      { name: 'gpsDeviceId', label: 'GPS Device ID', required: true }, { name: 'gpsSource', label: 'Location Source', type: 'select', required: true, options: [{ v: 'DEVICE', l: 'GPS hardware device' }, { v: 'MOBILE', l: 'Driver mobile app' }] },
      { name: 'insuranceTill', label: 'Insurance valid till', type: 'date', required: true }, { name: 'fitnessTill', label: 'Fitness valid till', type: 'date', required: true },
      { name: 'status', label: 'Status', type: 'select', required: true, options: ['AVAILABLE', 'MAINTENANCE'].concat(v && v.status === 'ON_TRIP' ? ['ON_TRIP'] : []) }], v || { status: 'AVAILABLE', gpsSource: 'DEVICE', gpsDeviceId: `GPS-SIM-${U.pad(d.vehicles.length + 1, 4)}` });
    const save = v => f => {
      if (d.vehicles.some(x => x.regNo === f.regNo && x !== v)) throw new Error('Registration number already exists.');
      if (v) { Audit.log('Vehicles', 'UPDATE', v.id, v.status, f.status); Object.assign(v, f); } else { const id = `VEH-${U.pad(d.vehicles.length + 1)}`; d.vehicles.push({ id, gpsOnline: true, ...f }); Audit.log('Vehicles', 'CREATE', id, '', f.regNo); }
      App.commit('Vehicle saved.');
    };
    UI.table('#vtbl', {
      id: 'veh', rows: d.vehicles, exportName: 'vehicles', filters: [{ key: 'status', label: 'Status' }, { key: 'type', label: 'Type' }],
      toolbar: can ? `<button class="btn btn-sm btn-primary" data-act="new"><i class="bi bi-plus-lg"></i> Add Vehicle</button>` : '',
      columns: [{ key: 'id', label: 'Vehicle ID' }, { key: 'regNo', label: 'Registration No.', render: v => `<strong>${v.regNo}</strong>` }, { key: 'type', label: 'Type' }, { key: 'capacity', label: 'Capacity', render: v => U.num(v.capacity), cls: 'text-end' },
        { label: 'Driver', value: v => DB.name('drivers', v.driverId) }, { key: 'gpsDeviceId', label: 'GPS Device', render: v => `${v.gpsDeviceId}<div class="sub">${v.gpsSource === 'MOBILE' ? 'Driver app' : 'Hardware'} · ${v.gpsOnline ? 'online' : 'offline'} (simulated)</div>` },
        { key: 'insuranceTill', label: 'Insurance', render: v => docBadge(v.insuranceTill) }, { key: 'fitnessTill', label: 'Fitness', render: v => docBadge(v.fitnessTill) }, { key: 'status', label: 'Status', render: v => UI.badge(v.status) },
        { label: '', sort: false, noExport: true, render: () => can ? UI.actBtn('edit', 'pencil', 'Edit') : '' }],
      onAction: (act, id) => { const v = act === 'edit' ? DB.get('vehicles', id) : null; UI.modal({ title: v ? `Edit vehicle ${v.regNo}` : 'Add vehicle', size: 'lg', body: form(v), onSubmit: save(v) }); }
    });
  } else {
    const form = x => UI.fields([{ name: 'name', label: 'Driver Name', required: true }, { name: 'mobile', label: 'Mobile Number', required: true, pattern: '[0-9]{10}', error: '10-digit mobile number' }, { name: 'license', label: 'Licence Number', required: true }, { name: 'licenseTill', label: 'Licence valid till', type: 'date', required: true }, { name: 'vehicleId', label: 'Assigned Vehicle', type: 'select', options: d.vehicles.map(v => ({ v: v.id, l: v.regNo })) }], x || {});
    UI.table('#vtbl', {
      id: 'drv', rows: d.drivers, exportName: 'drivers', filters: [{ key: 'status', label: 'Status' }],
      toolbar: can ? `<button class="btn btn-sm btn-primary" data-act="new"><i class="bi bi-plus-lg"></i> Add Driver</button>` : '',
      columns: [{ key: 'id', label: 'Driver ID' }, { key: 'name', label: 'Name', render: x => `<strong>${esc(x.name)}</strong>` }, { key: 'mobile', label: 'Mobile' }, { key: 'license', label: 'Licence', render: x => `${x.license}<div class="sub">${docBadge(x.licenseTill)}</div>` },
        { label: 'Assigned Vehicle', value: x => x.vehicleId ? DB.get('vehicles', x.vehicleId).regNo : '—' },
        { label: 'Current Trip', value: x => { const s = d.shipments.find(s => s.driverId === x.id && [...Ship.ACTIVE, 'REACHED_DESTINATION'].includes(s.status)); return s ? s.id : '—'; } },
        { label: 'Trips', value: x => d.shipments.filter(s => s.driverId === x.id && s.dispatchDate).length, cls: 'text-end' }, { key: 'status', label: 'Status', render: x => UI.badge(x.status) },
        { label: '', sort: false, noExport: true, render: () => UI.actBtn('trips', 'clock-history', 'Trips', 'outline-secondary') + (can ? UI.actBtn('edit', 'pencil', 'Edit') : '') }],
      onAction: (act, id) => {
        const x = DB.get('drivers', id);
        if (act === 'trips') { const trips = d.shipments.filter(s => s.driverId === id && s.dispatchDate); return UI.modal({ title: `Trip history · ${esc(x.name)}`, size: 'lg', cancel: 'Close', body: trips.length ? `<table class="table table-sm"><thead><tr><th>Shipment</th><th>Route</th><th>Dispatched</th><th>Qty</th><th>Status</th></tr></thead><tbody>${trips.map(s => `<tr><td>${s.id}</td><td>${esc(DB.nodeName(s.fromNode))} → ${esc(DB.nodeName(s.toNode))}</td><td>${U.fmtDT(s.dispatchDate)}</td><td>${U.num(s.qty)}</td><td>${UI.badge(s.status)}</td></tr>`).join('')}</tbody></table>` : UI.empty('No trips recorded.') }); }
        UI.modal({ title: x ? `Edit driver` : 'Add driver', body: form(act === 'edit' ? x : null), onSubmit: f => { if (act === 'edit') { Object.assign(x, f); Audit.log('Drivers', 'UPDATE', x.id); } else { const nid = `DRV-${U.pad(d.drivers.length + 1)}`; d.drivers.push({ id: nid, status: 'AVAILABLE', ...f }); Audit.log('Drivers', 'CREATE', nid, '', f.name); } App.commit('Driver saved.'); } });
      }
    });
  }
};

/* ---------- Page: Shipments ---------- */
const ShipUI = {
  newDialog(pre = {}) {
    const own = Scope.ownNodeIds().map(id => DB.node(id)).filter(n => n.type !== 'SCHOOL');
    if (!own.length) return UI.toast('Your role cannot create shipments.', 'warning');
    const from0 = pre.fromNode || own[0].id;
    UI.modal({
      title: 'New shipment / dispatch order', size: 'lg', submit: 'Create shipment', submitIcon: 'send',
      body: UI.fields([
        { name: 'fromNode', label: 'Source warehouse', type: 'select', required: true, options: own.map(n => ({ v: n.id, l: n.name })), value: from0 },
        { name: 'toNode', label: 'Destination', type: 'select', required: true, options: [] },
        { name: 'batchId', label: 'Product / batch (FEFO order)', type: 'select', required: true, options: [] },
        { name: 'qty', label: 'Dispatch quantity (packets)', type: 'number', required: true, min: 1, step: 1, value: pre.qty || '' },
        { name: 'vehicleId', label: 'Vehicle', type: 'select', options: [], help: 'Can also be assigned later by the Transport Manager.' },
        { name: 'driverId', label: 'Driver', type: 'select', options: DB.d.drivers.filter(x => x.status === 'AVAILABLE').map(x => ({ v: x.id, l: `${x.name} · ${x.mobile}` })) },
        { name: 'eta', label: 'Expected arrival', type: 'datetime-local', required: true, value: (x => `${U.day(x)}T${U.pad(x.getHours())}:${U.pad(x.getMinutes())}`)(U.addDays(new Date(), 1)) },
        { name: 'allocationId', label: 'Against allocation', type: 'select', options: [], value: pre.allocationId || '' }]),
      onShow: el => {
        const f = n => $(`[name=${n}]`, el);
        const fill = () => {
          const from = f('fromNode').value;
          f('toNode').innerHTML = '<option value="">Select…</option>' + Ship.destinations(from).map(n => `<option value="${n.id}" ${n.id === pre.toNode ? 'selected' : ''}>${esc(n.name)}</option>`).join('');
          f('batchId').innerHTML = '<option value="">Select…</option>' + Inv.batches(from).map((b, i, arr) => `<option value="${b.batchId}" ${U.daysBetween(new Date(), b.batch.exp) < 0 ? 'disabled' : ''} ${b === arr.find(x => U.daysBetween(new Date(), x.batch.exp) >= 0) ? 'selected' : ''}>${b.batch.batchNo} · ${U.num(b.qty)} in stock · exp ${U.fmtDate(b.batch.exp)}</option>`).join('');
          f('vehicleId').innerHTML = '<option value="">Assign later…</option>' + DB.d.vehicles.filter(v => v.status === 'AVAILABLE').map(v => `<option value="${v.id}">${v.regNo} · ${v.type} · cap ${U.num(v.capacity)}</option>`).join('');
          f('allocationId').innerHTML = '<option value="">None</option>' + DB.d.allocations.filter(a => a.fromNode === from && a.status === 'APPROVED' && !a.shipmentId).map(a => `<option value="${a.id}" ${a.id === pre.allocationId ? 'selected' : ''}>${a.id} · ${esc(DB.nodeName(a.toNode))} · ${U.num(a.qty)}</option>`).join('');
        };
        fill(); f('fromNode').onchange = fill;
        f('vehicleId').onchange = () => { const v = DB.get('vehicles', f('vehicleId').value); if (v && v.driverId && DB.get('drivers', v.driverId).status === 'AVAILABLE') f('driverId').value = v.driverId; };
        f('allocationId').onchange = () => { const a = DB.get('allocations', f('allocationId').value); if (a) { f('toNode').value = a.toNode; f('qty').value = a.qty; } };
      },
      onSubmit: d => {
        const s = Ship.create(d);
        if (d.vehicleId || d.driverId) { try { Ship.assign(s, d.vehicleId, d.driverId); } catch (e) { DB.d.shipments.pop(); throw e; } }
        App.commit(`Shipment ${s.id} created.`);
      }
    });
  },
  assignDialog(s) {
    UI.modal({
      title: `Assign vehicle & driver · ${s.id}`, body: UI.fields([
        { name: 'vehicleId', label: 'Vehicle', type: 'select', required: true, options: DB.d.vehicles.filter(v => v.status === 'AVAILABLE' || v.id === s.vehicleId).map(v => ({ v: v.id, l: `${v.regNo} · ${v.type} · cap ${U.num(v.capacity)}` })) },
        { name: 'driverId', label: 'Driver', type: 'select', required: true, options: DB.d.drivers.filter(x => x.status === 'AVAILABLE' || x.id === s.driverId).map(x => ({ v: x.id, l: `${x.name} · ${x.mobile}` })) }], s),
      onShow: el => { $('[name=vehicleId]', el).onchange = e => { const v = DB.get('vehicles', e.target.value); if (v && v.driverId) $('[name=driverId]', el).value = v.driverId; }; },
      onSubmit: d => { Ship.assign(s, d.vehicleId, d.driverId); App.commit('Vehicle and driver assigned.'); }
    });
  },
  next(s) { // primary workflow action available to the current user
    const m = Ship.canManage(s), tr = Ship.canTransport(s);
    if (s.status === 'CREATED' && m) return ['approve', 'check2-circle', 'Approve'];
    if (s.status === 'APPROVED' && tr && !s.vehicleId) return ['assign', 'truck', 'Assign vehicle'];
    if (s.status === 'APPROVED' && m) return ['ready', 'box-seam', 'Mark ready'];
    if (s.status === 'READY_FOR_DISPATCH' && tr && !s.vehicleId) return ['assign', 'truck', 'Assign vehicle'];
    if (s.status === 'READY_FOR_DISPATCH' && m) return ['dispatch', 'send', 'Dispatch'];
    if (s.status === 'DISPATCHED' && tr) return ['start', 'play-fill', 'Start trip'];
    if (['IN_TRANSIT', 'DELAYED'].includes(s.status) && tr) return ['ff', 'fast-forward-fill', 'Fast-forward arrival'];
    if (s.status === 'REACHED_DESTINATION' && Ship.canReceive(s)) return ['receive', 'clipboard-check', 'Receive'];
    return null;
  },
  act(act, s) {
    try {
      if (act === 'approve') Ship.approve(s); else if (act === 'ready') Ship.ready(s); else if (act === 'dispatch') Ship.dispatch(s); else if (act === 'start') Ship.start(s); else if (act === 'ff') Ship.arrive(s);
      else if (act === 'assign') return this.assignDialog(s);
      else if (act === 'receive') return this.receiveDialog(s);
      else if (act === 'view') return this.detail(s);
      else if (act === 'challan') return Ship.challan(s);
      else if (act === 'cancel') return UI.modal({ title: `Cancel ${s.id}`, tone: 'danger', submit: 'Cancel shipment', body: UI.fields([{ name: 'reason', label: 'Reason', type: 'textarea', required: true, col: 12 }]), onSubmit: d => { Ship.cancel(s, d.reason); App.commit('Shipment cancelled.', 'warning'); } });
      else if (act === 'delay') return UI.modal({ title: `Mark ${s.id} delayed`, tone: 'warning', submit: 'Mark delayed', body: UI.fields([{ name: 'reason', label: 'Reason for delay', type: 'select', required: true, col: 12, options: ['Vehicle breakdown', 'Heavy traffic / road closure', 'Weather conditions', 'Loading delay at source', 'Other'] }]), onSubmit: d => { Ship.delay(s, d.reason); App.commit('Shipment marked delayed.', 'warning'); } });
      App.commit(`${s.id}: ${s.status.replace(/_/g, ' ')}`);
    } catch (e) { UI.toast(e.message, 'error'); }
  },
  timeline(s) { return `<ol class="timeline">${s.timeline.map(x => `<li><span class="dot st-${STATUS_CLS[x.status] || 'muted'}"></span><div><strong>${x.status.replace(/_/g, ' ')}</strong><small>${U.fmtDT(x.at)} · ${esc(x.by)}${x.note ? ' · ' + esc(x.note) : ''}</small></div></li>`).join('')}</ol>`; },
  detail(s) {
    const grn = s.grnNo && DB.get('grns', s.grnNo);
    UI.modal({
      title: `Shipment ${s.id} ${UI.badge(s.status)}`, size: 'lg', cancel: 'Close',
      body: Ship.docHead(s) + UI.kv([['Dispatch Quantity', U.num(s.qty)], ['Received / Damaged / Shortage', s.receivedQty == null ? '—' : `${U.num(s.receivedQty)} / ${U.num(s.damagedQty)} / ${U.num(s.shortageQty)}`], ['GRN', s.grnNo], ['Allocation', s.allocationId]]) +
        `<div class="d-flex gap-2 flex-wrap my-3">${s.dispatchDate ? `<button type="button" class="btn btn-sm btn-outline-primary" id="dCh"><i class="bi bi-file-earmark-text"></i> Dispatch challan</button><button type="button" class="btn btn-sm btn-outline-primary" id="dTr"><i class="bi bi-arrow-left-right"></i> Transfer note</button>` : ''}${grn ? `<button type="button" class="btn btn-sm btn-outline-success" id="dGrn"><i class="bi bi-receipt"></i> GRN</button><button type="button" class="btn btn-sm btn-outline-success" id="dRc"><i class="bi bi-receipt-cutoff"></i> Delivery receipt</button>` : ''}${grn && (grn.damaged || grn.shortage) ? `<button type="button" class="btn btn-sm btn-outline-danger" id="dDs"><i class="bi bi-exclamation-diamond"></i> Discrepancy report</button>` : ''}</div><h6>Status timeline</h6>` + this.timeline(s),
      onShow: el => { const on = (id, fn) => { const b = $(id, el); if (b) b.onclick = fn; }; on('#dCh', () => Ship.challan(s)); on('#dTr', () => Ship.challan(s, true)); on('#dGrn', () => Ship.grnDoc(grn)); on('#dRc', () => Ship.grnDoc(grn, 'RECEIPT')); on('#dDs', () => Ship.grnDoc(grn, 'DISC')); }
    });
  },
  /* Goods receipt / unloading workflow */
  receiveDialog(s) {
    const v = DB.get('vehicles', s.vehicleId), dr = DB.get('drivers', s.driverId);
    UI.modal({
      title: `Goods receipt · ${s.id}`, size: 'lg', submit: 'Submit receipt & generate GRN', submitIcon: 'clipboard-check', tone: 'success',
      body: `<div class="steps-note"><i class="bi bi-info-circle"></i> Verify the consignment against the dispatch challan. The dispatched quantity is locked and cannot be overwritten; differences are recorded as damage / shortage.</div>` + Ship.docHead(s) + '<hr>' + UI.fields([
        { name: 'vShip', type: 'checkbox', label: `Shipment ID <strong>${s.id}</strong> and challan <strong>${s.challanNo}</strong> verified`, required: true, col: 12 },
        { name: 'vVeh', type: 'checkbox', label: `Vehicle <strong>${v ? v.regNo : '—'}</strong> and driver <strong>${dr ? esc(dr.name) : '—'}</strong> verified`, required: true, col: 12 },
        { name: 'dispatched', label: 'Dispatch quantity (locked)', type: 'number', readonly: true, value: s.qty, col: 3 },
        { name: 'received', label: 'Received in good condition', type: 'number', required: true, min: 0, max: s.qty, step: 1, value: s.qty, col: 3 },
        { name: 'damaged', label: 'Damaged quantity', type: 'number', required: true, min: 0, max: s.qty, step: 1, value: 0, col: 3 },
        { name: 'shortage', label: 'Shortage (auto)', type: 'number', readonly: true, value: 0, col: 3 },
        { name: 'proof', label: 'Delivery proof (photo / signed challan)', type: 'file', accept: 'image/*,.pdf', help: 'Demo: only the file name is stored.' },
        { name: 'ackName', label: 'Acknowledged by (name)', required: true, value: Auth.user().name },
        { name: 'remark', label: 'Discrepancy remark', type: 'textarea', col: 12, help: 'Mandatory when damage or shortage is reported.' },
        { name: 'ack', type: 'checkbox', label: 'I confirm that the consignment was unloaded and physically counted in my presence.', required: true, col: 12 }]),
      onShow: el => { const f = n => $(`[name=${n}]`, el), calc = () => { f('shortage').value = Math.max(0, s.qty - (+f('received').value || 0) - (+f('damaged').value || 0)); }; f('received').oninput = calc; f('damaged').oninput = calc; },
      onSubmit: d => {
        if (d.received + d.damaged > s.qty) throw new Error('Received + damaged cannot exceed the dispatched quantity.');
        if ((d.damaged > 0 || d.received + d.damaged < s.qty) && !d.remark) throw new Error('Enter a discrepancy remark for the damage / shortage.');
        const grn = Ship.receive(s, d);
        App.commit(grn.status === 'CONFIRMED' ? `${grn.id} generated. Inventory updated with ${U.num(grn.received)} packets.` : `${grn.id} submitted to the Principal for confirmation (discrepancy reported).`, grn.status === 'CONFIRMED' ? 'success' : 'warning');
        setTimeout(() => Ship.grnDoc(grn), 450);
      }
    });
  }
};

App.pages.shipments = root => {
  Ship.sync();
  const rows = Scope.shipments().slice().reverse(), canNew = Auth.can('ship.create') && Scope.ownNodeIds().some(id => DB.node(id).type !== 'SCHOOL');
  const cnt = st => rows.filter(s => st.includes(s.status)).length;
  root.innerHTML = UI.kpis([
    { label: 'Total shipments', value: rows.length, icon: 'send-check' }, { label: 'Awaiting dispatch', value: cnt(['CREATED', 'APPROVED', 'READY_FOR_DISPATCH']), icon: 'hourglass-split', tone: 'saffron' },
    { label: 'On the road', value: cnt(Ship.ACTIVE), icon: 'truck', tone: 'blue' }, { label: 'Awaiting receipt', value: cnt(['REACHED_DESTINATION']), icon: 'clipboard-check', tone: 'saffron' },
    { label: 'Delayed', value: cnt(['DELAYED']), icon: 'exclamation-triangle', tone: 'red' }, { label: 'Received', value: cnt(['RECEIVED', 'PARTIALLY_RECEIVED']), icon: 'check-circle', tone: 'green' }], 'kpi-6') +
    `<div class="flow-strip">${['CREATED', 'APPROVED', 'READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'RECEIVED'].map(x => `<span>${x.replace(/_/g, ' ')}</span>`).join('<i class="bi bi-chevron-right"></i>')}</div>` +
    UI.card('Shipments', '<div id="shTbl"></div>', { icon: 'send-check' });
  UI.table('#shTbl', {
    id: 'ship', rows, exportName: 'shipments', pageSize: 12,
    filters: [{ key: 'status', label: 'Status', options: SHIP_STATUS }, { key: 'from', label: 'Source', get: s => DB.nodeName(s.fromNode) }],
    toolbar: canNew ? `<button class="btn btn-sm btn-primary" data-act="new"><i class="bi bi-plus-lg"></i> New Shipment</button>` : '',
    columns: [
      { key: 'id', label: 'Shipment ID', render: s => `<a href="#" data-act="view" data-id="${s.id}"><strong>${s.id}</strong></a>` },
      { label: 'Source → Destination', value: s => `${DB.nodeName(s.fromNode)} → ${DB.nodeName(s.toNode)}`, render: s => `${esc(DB.nodeName(s.fromNode))}<div class="sub"><i class="bi bi-arrow-return-right"></i> ${esc(DB.nodeName(s.toNode))}</div>` },
      { label: 'Batch', value: s => DB.get('batches', s.batchId).batchNo }, { key: 'qty', label: 'Qty', render: s => U.num(s.qty), cls: 'text-end' },
      { label: 'Vehicle / Driver', value: s => s.vehicleId ? `${DB.get('vehicles', s.vehicleId).regNo} ${DB.name('drivers', s.driverId)}` : 'Unassigned', render: s => s.vehicleId ? `${DB.get('vehicles', s.vehicleId).regNo}<div class="sub">${esc(DB.name('drivers', s.driverId))}</div>` : '<span class="text-muted">Unassigned</span>' },
      { label: 'Dispatch', value: s => s.dispatchDate || '', render: s => U.fmtDT(s.dispatchDate) }, { label: 'Expected', value: s => s.eta, render: s => U.fmtDT(s.eta) },
      { key: 'status', label: 'Status', render: s => UI.badge(s.status) + (['IN_TRANSIT', 'DELAYED'].includes(s.status) ? `<div class="mini-prog"><i style="width:${Math.round(Ship.progress(s) * 100)}%"></i></div>` : '') },
      { label: 'Actions', sort: false, noExport: true, render: s => { const n = ShipUI.next(s); return `<div class="acts">${n ? UI.actBtn(n[0], n[1], n[2], 'primary') : ''}${UI.actBtn('view', 'eye', 'View', 'outline-secondary')}${Ship.canManage(s) && ['CREATED', 'APPROVED', 'READY_FOR_DISPATCH'].includes(s.status) ? UI.actBtn('cancel', 'x-lg', 'Cancel', 'outline-danger') : ''}${s.status === 'IN_TRANSIT' && Ship.canTransport(s) ? UI.actBtn('delay', 'clock', 'Delay', 'outline-warning') : ''}</div>`; } }],
    onAction: (act, id) => act === 'new' ? ShipUI.newDialog() : ShipUI.act(act, Ship.get(id))
  });
};

/* ---------- Page: Deliveries & GRN ---------- */
let delTab = 'pending';
App.pages.deliveries = root => {
  Ship.sync();
  const own = Scope.ownNodeIds(), u = Auth.user();
  const incoming = DB.d.shipments.filter(s => own.includes(s.toNode) && [...Ship.ACTIVE, 'REACHED_DESTINATION'].includes(s.status)).reverse();
  const grns = DB.d.grns.filter(g => own.includes(g.nodeId) || Scope.nodeIds().includes(g.nodeId)).reverse();
  const discs = DB.d.discrepancies.filter(x => Scope.nodeIds().includes(x.nodeId)).reverse();
  const pendConf = grns.filter(g => g.status === 'PENDING_CONFIRMATION');
  root.innerHTML = UI.kpis([
    { label: 'Arrived – awaiting unloading', value: incoming.filter(s => s.status === 'REACHED_DESTINATION' && !DB.d.grns.some(g => g.shipmentId === s.id)).length, icon: 'box-arrow-in-down', tone: 'saffron' },
    { label: 'En route to you', value: incoming.filter(s => Ship.ACTIVE.includes(s.status)).length, icon: 'truck', tone: 'blue' },
    { label: 'Awaiting Principal confirmation', value: pendConf.length, icon: 'person-check', tone: 'saffron' },
    { label: 'Open discrepancies', value: discs.filter(x => x.status !== 'RESOLVED').length, icon: 'exclamation-diamond', tone: 'red' }], 'kpi-4') +
    UI.tabs('dtabs', [{ key: 'pending', label: 'Incoming deliveries', icon: 'truck', count: incoming.length }, { key: 'grn', label: 'Goods receipts (GRN)', icon: 'receipt', count: grns.length }, { key: 'disc', label: 'Discrepancies', icon: 'exclamation-diamond', count: discs.length }], delTab) + `<div class="panel"><div class="panel-b" id="dBody"></div></div>`;
  UI.onTabs('dtabs', k => { delTab = k; App.refresh(); });
  if (delTab === 'pending') {
    $('#dBody').innerHTML = incoming.length ? `<div class="deliv-grid">${incoming.map(s => {
      const v = DB.get('vehicles', s.vehicleId), arrived = s.status === 'REACHED_DESTINATION', pg = DB.d.grns.find(g => g.shipmentId === s.id && g.status === 'PENDING_CONFIRMATION');
      return `<article class="deliv ${arrived ? 'arrived' : ''}"><header><strong>${s.id}</strong>${UI.badge(pg ? 'PENDING_CONFIRMATION' : s.status)}</header>
        <div class="deliv-q">${U.num(s.qty)} <small>packets</small></div><div class="sub">From ${esc(DB.nodeName(s.fromNode))}<br>To ${esc(DB.nodeName(s.toNode))}</div>
        <div class="sub mt-1"><i class="bi bi-truck"></i> ${v ? v.regNo : '—'} · ${esc(DB.name('drivers', s.driverId))}</div>
        ${arrived ? '' : `<div class="mini-prog lg"><i style="width:${Math.round(Ship.progress(s) * 100)}%"></i></div><div class="sub">Route progress ${Math.round(Ship.progress(s) * 100)}% (simulated)</div>`}
        <footer>${pg ? (Auth.is('PRINCIPAL', 'STATE_ADMIN') ? `<button class="btn btn-sm btn-success" data-conf="${pg.id}"><i class="bi bi-check2"></i> Review & confirm</button>` : '<span class="sub">Awaiting Principal confirmation</span>') : arrived && Ship.canReceive(s) ? `<button class="btn btn-sm btn-success" data-rcv="${s.id}"><i class="bi bi-clipboard-check"></i> Unload & receive</button>` : ''}<button class="btn btn-sm btn-outline-secondary" data-view="${s.id}">Details</button></footer></article>`;
    }).join('')}</div>` : UI.empty('No incoming deliveries for your location right now.', 'truck');
    $$('[data-rcv]').forEach(b => b.onclick = () => ShipUI.receiveDialog(Ship.get(b.dataset.rcv)));
    $$('[data-view]').forEach(b => b.onclick = () => ShipUI.detail(Ship.get(b.dataset.view)));
    $$('[data-conf]').forEach(b => b.onclick = () => {
      const g = DB.get('grns', b.dataset.conf);
      UI.modal({ title: `Confirm receipt ${g.id}`, tone: 'success', submit: 'Approve acknowledgment', body: UI.kv([['Shipment', g.shipmentId], ['Dispatched', U.num(g.dispatched)], ['Received', U.num(g.received)], ['Damaged', U.num(g.damaged)], ['Shortage', U.num(g.shortage)], ['Entered by', esc(g.receivedBy)], ['Remark', esc(g.remark)]]) + '<p class="small text-muted mt-3 mb-0">On approval, inventory is updated with the received quantity and the discrepancy stays open for submission to the Taluka Officer.</p>', onSubmit: () => { Ship.confirmGrn(g); Audit.log('Deliveries', 'APPROVE_ACKNOWLEDGMENT', g.id, 'PENDING_CONFIRMATION', 'CONFIRMED', 'Principal'); App.commit(`${g.id} confirmed. Inventory updated.`); } });
    });
  } else if (delTab === 'grn') {
    UI.table('#dBody', {
      id: 'grn', rows: grns, exportName: 'goods-receipts', filters: [{ key: 'status', label: 'Status' }],
      columns: [{ key: 'id', label: 'GRN Number', render: g => `<strong>${g.id}</strong>` }, { key: 'shipmentId', label: 'Shipment' }, { label: 'Received at', value: g => DB.nodeName(g.nodeId) }, { label: 'Date', value: g => g.at, render: g => U.fmtDT(g.at) },
        { key: 'dispatched', label: 'Dispatched', cls: 'text-end', render: g => U.num(g.dispatched) }, { key: 'received', label: 'Received', cls: 'text-end', render: g => U.num(g.received) }, { key: 'damaged', label: 'Damaged', cls: 'text-end' }, { key: 'shortage', label: 'Shortage', cls: 'text-end' },
        { key: 'status', label: 'Status', render: g => UI.badge(g.status) },
        { label: 'Documents', sort: false, noExport: true, render: g => `<div class="acts">${UI.actBtn('GRN', 'receipt', 'GRN', 'outline-success')}${UI.actBtn('RECEIPT', 'receipt-cutoff', 'Receipt', 'outline-secondary')}${UI.actBtn('CHALLAN', 'file-earmark-text', 'Challan', 'outline-secondary')}</div>` }],
      onAction: (act, id) => { const g = DB.get('grns', id); act === 'CHALLAN' ? Ship.challan(Ship.get(g.shipmentId)) : Ship.grnDoc(g, act); }
    });
  } else {
    UI.table('#dBody', {
      id: 'disc', rows: discs, exportName: 'discrepancies', filters: [{ key: 'status', label: 'Status' }], empty: 'No discrepancies reported.',
      columns: [{ key: 'id', label: 'Report ID' }, { key: 'shipmentId', label: 'Shipment' }, { label: 'Location', value: x => DB.nodeName(x.nodeId) }, { label: 'Date', value: x => x.at, render: x => U.fmtDate(x.at) }, { key: 'damaged', label: 'Damaged', cls: 'text-end' }, { key: 'shortage', label: 'Shortage', cls: 'text-end' }, { key: 'remark', label: 'Remark' }, { key: 'status', label: 'Status', render: x => UI.badge(x.status) },
        { label: '', sort: false, noExport: true, render: x => `<div class="acts">${x.status === 'OPEN' && Auth.is('PRINCIPAL') ? UI.actBtn('submit', 'send', 'Submit to Taluka Officer', 'primary') : ''}${x.status === 'SUBMITTED_TO_TALUKA' && Auth.is('TALUKA_OFFICER', 'DISTRICT_OFFICER', 'STATE_ADMIN') ? UI.actBtn('resolve', 'check2', 'Resolve', 'success') : ''}${UI.actBtn('doc', 'file-earmark-text', 'Report', 'outline-secondary')}</div>` }],
      onAction: (act, id) => {
        const x = DB.get('discrepancies', id);
        if (act === 'doc') return Ship.grnDoc(DB.get('grns', x.grnNo), 'DISC');
        UI.modal({ title: act === 'submit' ? 'Submit discrepancy to Taluka Officer' : 'Resolve discrepancy', body: UI.fields([{ name: 'note', label: act === 'submit' ? 'Principal review note' : 'Resolution / action taken', type: 'textarea', required: true, col: 12 }]), onSubmit: d => { const old = x.status; x.status = act === 'submit' ? 'SUBMITTED_TO_TALUKA' : 'RESOLVED'; x.history.push({ at: U.iso(new Date()), by: u.name, action: `${x.status}: ${d.note}` }); Audit.log('Deliveries', 'DISCREPANCY_' + act.toUpperCase(), x.id, old, x.status, d.note); if (act === 'submit') Notify.push('DELIVERY_PENDING', 'Discrepancy submitted', `${x.id} for shipment ${x.shipmentId} needs review.`, { nodes: [`DC-${DB.node(x.nodeId).talukaId}`] }); App.commit('Discrepancy updated.'); } });
      }
    });
  }
};

/* ---------- Page: Live tracking (simulated GPS) ---------- */
let trkSel = null, trkTimer = null;
App.pages.tracking = root => {
  const list = () => Scope.shipments().filter(s => [...Ship.ACTIVE, 'REACHED_DESTINATION'].includes(s.status) && s.vehicleId);
  root.innerHTML = `<div class="sim-banner"><i class="bi bi-broadcast"></i> <strong>Simulated GPS.</strong> Vehicle positions, speed and ETA are generated by a mock service for demonstration. Integration points: <code>GpsDeviceService</code> (hardware) and <code>DriverAppService</code> (driver mobile app).</div>
    <div class="track-layout"><div class="panel track-map"><div id="map"></div></div>
    <div class="track-side"><div class="panel"><header class="panel-h"><h2><i class="bi bi-truck"></i> Active vehicles</h2><span class="live-dot">LIVE · simulated</span></header><div class="panel-b p-0" id="trkList"></div></div><div class="panel" id="trkDetail"></div></div></div>`;
  const map = MapKit.create('map'), layers = {};
  DB.d.nodes.filter(n => n.type !== 'SCHOOL' && Scope.nodeIds().concat(['WH-CEN']).includes(n.id) || Auth.is('DRIVER')).filter(n => n.type !== 'SCHOOL').forEach(n => L.marker([n.lat, n.lng], { icon: MapKit.icon('pin-' + n.type.toLowerCase(), n.type === 'CENTRAL' ? 'bank' : n.type === 'DISTRICT' ? 'house-gear' : 'box-seam') }).addTo(map).bindPopup(`<strong>${esc(n.name)}</strong><br>Stock: ${U.num(Inv.total(n.id))} packets`));
  const drawSide = () => {
    const ss = list(); if (!trkSel || !ss.some(s => s.id === trkSel)) trkSel = ss[0] ? ss[0].id : null;
    $('#trkList').innerHTML = ss.length ? ss.map(s => { const v = DB.get('vehicles', s.vehicleId), p = Ship.position(s); return `<button class="trk-row ${s.id === trkSel ? 'sel' : ''}" data-s="${s.id}"><div><strong>${v.regNo}</strong> ${UI.badge(s.status)} ${p.online ? '' : UI.badge('OFFLINE', 'GPS offline')}</div><div class="sub">${s.id} · ${esc(DB.name('drivers', s.driverId))}</div><div class="sub">${esc(DB.nodeName(s.fromNode))} → ${esc(DB.nodeName(s.toNode))}</div><div class="mini-prog lg"><i style="width:${Math.round(p.progress * 100)}%"></i></div></button>`; }).join('') : UI.empty('No vehicles on the road. Dispatch a shipment and start the trip.', 'truck');
    $$('.trk-row').forEach(b => b.onclick = () => { trkSel = b.dataset.s; drawSide(); const l = layers[trkSel]; if (l) map.fitBounds(l.line.getBounds(), { padding: [40, 40] }); });
    const s = trkSel && Ship.get(trkSel), box = $('#trkDetail'); if (!s) { box.innerHTML = ''; return; }
    const v = DB.get('vehicles', s.vehicleId), dr = DB.get('drivers', s.driverId), p = Ship.position(s), dist = Ship.distance(s), can = Ship.canTransport(s);
    const remainMin = p.speed ? Math.round((dist * (1 - p.progress)) / p.speed * 60) : null;
    const hist = [0, .2, .4, .6, .8, 1].filter(k => k <= p.progress + 0.001).map(k => { const pt = Ship.pointAt(Ship.route(s), k); return `<tr><td>${s.sim ? U.fmtTime(s.sim.start + k * s.sim.dur * 1000) : '—'}</td><td>${pt[0].toFixed(4)}, ${pt[1].toFixed(4)}</td><td>${Math.round(dist * k)} km</td></tr>`; }).join('');
    box.innerHTML = `<header class="panel-h"><h2>${v.regNo}</h2>${UI.badge(p.online ? 'ONLINE' : 'OFFLINE', p.online ? 'GPS connected' : 'GPS disconnected')}</header><div class="panel-b">
      ${p.online ? '' : `<div class="alert alert-danger py-2 small"><i class="bi bi-wifi-off"></i> GPS signal lost (simulated). Showing <strong>last known location</strong> from ${U.fmtTime(p.at)}.</div>`}
      ${UI.kv([['Shipment', s.id], ['Driver', esc(dr.name) + ' · ' + dr.mobile], ['Source', esc(DB.nodeName(s.fromNode))], ['Destination', esc(DB.nodeName(s.toNode))], ['Current speed', p.speed + ' km/h'], ['Last updated', U.fmtTime(p.at)], ['Distance travelled', `${Math.round(dist * p.progress)} / ${Math.round(dist)} km`], ['Estimated arrival', s.status === 'REACHED_DESTINATION' ? 'Arrived' : remainMin != null ? `~${remainMin} min (sim.)` : U.fmtDT(s.eta)], ['Location source', v.gpsSource === 'MOBILE' ? 'Driver mobile app' : 'GPS device ' + v.gpsDeviceId], ['Position', `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`]])}
      <div class="mini-prog lg mt-2"><i style="width:${Math.round(p.progress * 100)}%"></i></div><div class="sub mb-2">Route progress ${Math.round(p.progress * 100)}%</div>
      ${can ? `<div class="d-flex gap-2 flex-wrap mb-3">${s.status === 'DISPATCHED' ? `<button class="btn btn-sm btn-primary" data-t="start"><i class="bi bi-play-fill"></i> Start trip</button>` : ''}${['IN_TRANSIT', 'DELAYED'].includes(s.status) ? `<button class="btn btn-sm btn-primary" data-t="ff"><i class="bi bi-fast-forward-fill"></i> Fast-forward arrival</button>` : ''}<button class="btn btn-sm btn-outline-danger" data-t="gps"><i class="bi bi-wifi${p.online ? '-off' : ''}"></i> ${p.online ? 'Simulate GPS loss' : 'Restore GPS'}</button><button class="btn btn-sm btn-outline-secondary" data-t="src"><i class="bi bi-phone"></i> Switch to ${v.gpsSource === 'MOBILE' ? 'GPS device' : 'driver app'}</button></div>` : ''}
      <h6>Trip timeline</h6>${ShipUI.timeline(s)}<h6 class="mt-3">Location history (simulated)</h6><table class="table table-sm small mb-0"><thead><tr><th>Time</th><th>Lat, Lng</th><th>Distance</th></tr></thead><tbody>${hist || '<tr><td colspan="3" class="text-muted">Trip not started</td></tr>'}</tbody></table></div>`;
    $$('[data-t]', box).forEach(b => b.onclick = () => {
      const a = b.dataset.t;
      if (a === 'start') Ship.start(s); else if (a === 'ff') Ship.arrive(s);
      else if (a === 'gps') { v.gpsOnline = !v.gpsOnline; if (s.sim) { if (!v.gpsOnline) { s.sim.frozen = Ship.progress(s); s.sim.lostAt = Date.now(); } else delete s.sim.frozen; } Audit.log('Tracking', v.gpsOnline ? 'GPS_RESTORED_SIM' : 'GPS_LOST_SIM', v.id); }
      else if (a === 'src') { v.gpsSource = v.gpsSource === 'MOBILE' ? 'DEVICE' : 'MOBILE'; v.gpsOnline = true; if (s.sim) delete s.sim.frozen; Audit.log('Tracking', 'LOCATION_SOURCE', v.id, '', v.gpsSource); }
      DB.save(); tick(true);
    });
  };
  const tick = side => {
    if (Ship.sync()) { side = true; App.bell(); }
    const ss = list(), ids = ss.map(s => s.id);
    Object.keys(layers).forEach(id => { if (!ids.includes(id)) { Object.values(layers[id]).forEach(l => map.removeLayer(l)); delete layers[id]; side = true; } });
    ss.forEach(s => {
      const v = DB.get('vehicles', s.vehicleId), p = Ship.position(s), r = Ship.route(s), done = r.filter((_, i) => i / (r.length - 1) <= p.progress).concat([[p.lat, p.lng]]);
      if (!layers[s.id]) { layers[s.id] = { line: L.polyline(r, { color: '#8a8ea8', weight: 3, dashArray: '6 6' }).addTo(map), done: L.polyline(done, { color: '#4338ca', weight: 4 }).addTo(map), mk: L.marker([p.lat, p.lng]).addTo(map) }; layers[s.id].mk.on('click', () => { trkSel = s.id; drawSide(); }); side = true; }
      const l = layers[s.id]; l.done.setLatLngs(done); l.mk.setLatLng([p.lat, p.lng]);
      l.mk.setIcon(MapKit.icon('pin-veh ' + (!p.online ? 'off' : s.status === 'DELAYED' ? 'late' : s.status === 'REACHED_DESTINATION' ? 'done' : ''), 'truck'));
      l.mk.bindTooltip(`${v.regNo} · ${p.speed} km/h${p.online ? '' : ' · last known'}`, { direction: 'top', offset: [0, -12] });
    });
    drawSide();
  };
  tick(true);
  const first = layers[trkSel]; if (first) map.fitBounds(L.featureGroup(Object.values(layers).map(l => l.line)).getBounds(), { padding: [30, 30] });
  clearInterval(trkTimer); trkTimer = setInterval(() => { if (!document.querySelector('.modal.show')) tick(false); }, 2000);
};
