/* =====================================================================
   MSDMS · data.js
   Centralised mock data store (LocalStorage), seed generator and the
   core inventory ledger service. ALL RECORDS ARE FICTIONAL DEMO DATA.
   ===================================================================== */
'use strict';

const DB_KEY = 'msdms_db';
const SEED_VERSION = 7;

const ROLES = {
  STATE_ADMIN:      { label: 'State Super Admin',          level: 'State' },
  STATE_OFFICER:    { label: 'State Officer',              level: 'State' },
  DISTRICT_OFFICER: { label: 'District Officer',           level: 'District' },
  TALUKA_OFFICER:   { label: 'Taluka Officer',             level: 'Taluka' },
  CENTRAL_WH:       { label: 'Central Warehouse Manager',  level: 'Warehouse' },
  DISTRICT_WH:      { label: 'District Warehouse Manager', level: 'Warehouse' },
  TALUKA_WH:        { label: 'Taluka Warehouse Manager',   level: 'Warehouse' },
  TRANSPORT_MGR:    { label: 'Transport Manager',          level: 'Transport' },
  DRIVER:           { label: 'Vehicle Driver',             level: 'Transport' },
  PRINCIPAL:        { label: 'School Principal',           level: 'School' },
  EMPLOYEE:         { label: 'School Employee',            level: 'School' },
  STUDENT:          { label: 'Student / Beneficiary',      level: 'Beneficiary' }
};

const SHIP_STATUS = ['CREATED', 'APPROVED', 'READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT',
  'REACHED_DESTINATION', 'RECEIVED', 'PARTIALLY_RECEIVED', 'DELAYED', 'CANCELLED'];

/* ---------- Utilities ---------- */
const U = {
  pad: (n, l = 2) => String(n).padStart(l, '0'),
  iso: d => new Date(d).toISOString(),
  day: d => { const x = new Date(d); return `${x.getFullYear()}-${U.pad(x.getMonth() + 1)}-${U.pad(x.getDate())}`; },
  addDays: (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; },
  month: d => { const x = d ? new Date(d) : new Date(); return `${x.getFullYear()}-${U.pad(x.getMonth() + 1)}`; },
  addMonths: (ym, n) => { const [y, m] = ym.split('-').map(Number); const x = new Date(y, m - 1 + n, 1); return `${x.getFullYear()}-${U.pad(x.getMonth() + 1)}`; },
  monthLabel: ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' }); },
  fmtDate: d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
  fmtDT: d => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
  fmtTime: d => d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—',
  num: n => Number(n || 0).toLocaleString('en-IN'),
  daysBetween: (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5),
  sum: (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0),
  groupBy: (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m; }, {}),
  fy: d => { const x = d ? new Date(d) : new Date(); const y = x.getMonth() >= 3 ? x.getFullYear() : x.getFullYear() - 1; return `${y}-${String(y + 1).slice(2)}`; },
  haversine: (a, b) => {
    const R = 6371, r = x => x * Math.PI / 180, dLat = r(b[0] - a[0]), dLng = r(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  },
  rng: seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; },
  mask: name => name.split(' ').map(p => p[0] + '•••').join(' ')
};

/* ---------- Store ---------- */
const DB = {
  d: null,
  actor: null, // set by auth.js – {id,name,role}
  load() {
    if (this.d) return this.d;
    try { const raw = localStorage.getItem(DB_KEY); if (raw) this.d = JSON.parse(raw); } catch (e) { this.d = null; }
    if (!this.d || this.d.version !== SEED_VERSION) { Seed.build(); this.save(); }
    return this.d;
  },
  save() { try { localStorage.setItem(DB_KEY, JSON.stringify(this.d)); } catch (e) { console.warn('LocalStorage save failed', e); } },
  reset() { Seed.build(); this.save(); },
  nextId(prefix, pad = 6) {
    const s = this.d.seq; s[prefix] = (s[prefix] || 0) + 1;
    return `${prefix}-${new Date().getFullYear()}-${U.pad(s[prefix], pad)}`;
  },
  get(coll, id) { return this.d[coll].find(x => x.id === id); },
  node(id) { return this.d.nodes.find(n => n.id === id); },
  nodeName(id) { const n = this.node(id); return n ? n.name : id; },
  name(coll, id) { const r = this.get(coll, id); return r ? r.name : (id || '—'); }
};

/* ---------- Audit + notifications (data level) ---------- */
const Audit = {
  log(module, action, recordId, oldVal, newVal, approval, at) {
    const a = DB.actor || { id: 'SYSTEM', name: 'System', role: 'SYSTEM' };
    DB.d.audit.push({
      id: DB.nextId('AUD'), at: at || U.iso(new Date()), userId: a.id, user: a.name, role: a.role,
      module, action, recordId: recordId || '', oldVal: oldVal == null ? '' : String(oldVal),
      newVal: newVal == null ? '' : String(newVal), approval: approval || ''
    });
  }
};

const Notify = {
  /* target: { nodes:[nodeIds], studentId, roles:[...] }. State-level users see everything. */
  push(event, title, msg, target = {}, at) {
    DB.d.notifications.push({
      id: DB.nextId('NTF'), at: at || U.iso(new Date()), event, title, msg,
      nodes: target.nodes || [], studentId: target.studentId || null, roles: target.roles || [], readBy: []
    });
    if (DB.d.notifications.length > 400) DB.d.notifications.splice(0, DB.d.notifications.length - 400);
  }
};

/* ---------- Inventory ledger service ----------
   Every node (central / district warehouse, taluka DC, school) has an
   independent batch-wise stock. Every movement creates a ledger row with
   a unique transaction ID. Negative stock is rejected. */
const Inv = {
  qty(nodeId, batchId) { return ((DB.d.stock[nodeId] || {})[batchId]) || 0; },
  total(nodeId) { return U.sum(Object.values(DB.d.stock[nodeId] || {})); },
  batches(nodeId) {
    return Object.entries(DB.d.stock[nodeId] || {}).filter(([, q]) => q > 0)
      .map(([batchId, qty]) => ({ batchId, qty, batch: DB.get('batches', batchId) }))
      .sort((a, b) => new Date(a.batch.exp) - new Date(b.batch.exp)); // FEFO
  },
  post({ nodeId, batchId, qty, type, ref, note, at }) {
    qty = Number(qty);
    if (!Number.isFinite(qty) || qty === 0) throw new Error('Quantity must be a non-zero number.');
    const cur = this.qty(nodeId, batchId);
    if (cur + qty < 0) throw new Error(`Insufficient stock at ${DB.nodeName(nodeId)}: available ${cur}, requested ${-qty}. Negative stock is not permitted.`);
    (DB.d.stock[nodeId] = DB.d.stock[nodeId] || {})[batchId] = cur + qty;
    const a = DB.actor || { id: 'SYSTEM', name: 'System' };
    const txn = {
      id: DB.nextId('TXN'), at: at || U.iso(new Date()), nodeId, batchId, type, qty,
      batchBalance: cur + qty, balance: this.total(nodeId), ref: ref || '', note: note || '', userId: a.id, user: a.name
    };
    DB.d.ledger.push(txn);
    return txn;
  },
  /* Month summary: Closing = Opening + Received − Distributed − Damaged − Transferred Out (± adjustments) */
  summary(nodeId, ym) {
    const rows = DB.d.ledger.filter(t => t.nodeId === nodeId);
    const s = { opening: 0, received: 0, additional: 0, distributed: 0, damaged: 0, transferredOut: 0, adjustment: 0 };
    rows.forEach(t => {
      const m = U.month(t.at);
      if (m < ym) { s.opening += t.qty; return; }
      if (m > ym) return;
      if (t.type === 'OPENING') s.opening += t.qty;
      else if (t.type === 'INWARD' || t.type === 'TRANSFER_IN') { if (/additional/i.test(t.note)) s.additional += t.qty; else s.received += t.qty; }
      else if (t.type === 'DISTRIBUTION') s.distributed += -t.qty;
      else if (t.type === 'DAMAGE' || t.type === 'EXPIRED') s.damaged += -t.qty;
      else if (t.type === 'TRANSFER_OUT') s.transferredOut += -t.qty;
      else s.adjustment += t.qty;
    });
    s.total = s.opening + s.received + s.additional;
    s.closing = s.total - s.distributed - s.damaged - s.transferredOut + s.adjustment;
    return s;
  }
};

/* ---------- Entitlement policy (configured by Government, never hard-coded) ---------- */
const Policy = {
  rules() { return DB.d.policies.filter(p => p.active); },
  entitlement(student) {
    if (!student || student.eligibility !== 'ELIGIBLE' || student.enrollment !== 'ACTIVE') return 0;
    const r = this.rules().find(p => student.cls >= p.classFrom && student.cls <= p.classTo);
    return r ? r.packets : 0;
  },
  distributed(studentId, cycle, type) {
    return U.sum(DB.d.distributions.filter(x => x.studentId === studentId && x.cycle === cycle && (!type || x.type === type)), x => x.qty);
  }
};

/* ---------- Seed generator: resettable fictional sample data ---------- */
const Seed = {
  build() {
    const R = U.rng(20261112), rnd = (a, b) => Math.floor(R() * (b - a + 1)) + a, pick = a => a[Math.floor(R() * a.length)];
    const now = new Date(), D = off => U.iso(U.addDays(now, off));
    const curM = U.month(now), prevM = U.addMonths(curM, -1);
    const inPrev = day => { const [y, m] = prevM.split('-').map(Number); return U.iso(new Date(y, m - 1, day, rnd(9, 15), rnd(0, 59))); };
    const d = DB.d = {
      version: SEED_VERSION, seededAt: U.iso(now), seq: {},
      state: { id: 'MH', name: 'Maharashtra', code: '27' },
      divisions: [], districts: [], talukas: [], villages: [], departments: [], schools: [], nodes: [],
      suppliers: [], products: [], purchaseOrders: [], batches: [], stock: {}, ledger: [],
      vehicles: [], drivers: [], shipments: [], grns: [], discrepancies: [],
      students: [], employees: [], users: [], distributions: [],
      policies: [], cycles: [], allocations: [], requests: [], notifications: [], audit: [],
      settings: { approvalLevels: ['TALUKA', 'DISTRICT'], lowStockDays: 10, sessionMinutes: 30, simTripSeconds: 75 },
      baseline: { monthly: [] }
    };
    DB.actor = { id: 'SYSTEM', name: 'System (seed)', role: 'SYSTEM' };

    /* Geography */
    d.divisions = [
      { id: 'DIV-PUN', name: 'Pune Division' }, { id: 'DIV-NSK', name: 'Nashik Division' }, { id: 'DIV-KON', name: 'Konkan Division' }];
    d.districts = [
      { id: 'PUN', name: 'Pune', divisionId: 'DIV-PUN', lat: 18.5204, lng: 73.8567 },
      { id: 'SAT', name: 'Satara', divisionId: 'DIV-PUN', lat: 17.6805, lng: 74.0183 },
      { id: 'NSK', name: 'Nashik', divisionId: 'DIV-NSK', lat: 19.9975, lng: 73.7898 },
      { id: 'MSU', name: 'Mumbai Suburban', divisionId: 'DIV-KON', lat: 19.0596, lng: 72.8424 },
      { id: 'THA', name: 'Thane', divisionId: 'DIV-KON', lat: 19.2183, lng: 72.9781 }];
    const T = [
      ['HAV', 'Haveli', 'PUN', 18.4865, 73.9980, ['Loni Kalbhor', '412201'], ['Uruli Kanchan', '412202']],
      ['MUL', 'Mulshi', 'PUN', 18.5300, 73.6100, ['Paud', '412108'], ['Pirangut', '412115']],
      ['KAR', 'Karad', 'SAT', 17.2890, 74.1820, ['Umbraj', '415109'], ['Masur', '415106']],
      ['WAI', 'Wai', 'SAT', 17.9520, 73.8910, ['Bhuinj', '415515'], ['Pasarni', '412803']],
      ['NIP', 'Niphad', 'NSK', 20.0800, 74.1100, ['Pimpalgaon Baswant', '422209'], ['Lasalgaon', '422306']],
      ['SIN', 'Sinnar', 'NSK', 19.8450, 74.0000, ['Musalgaon', '422112'], ['Vavi', '422104']],
      ['AND', 'Andheri', 'MSU', 19.1197, 72.8468, ['Marol', '400059'], ['Versova', '400061']],
      ['KUR', 'Kurla', 'MSU', 19.0726, 72.8845, ['Chunabhatti', '400022'], ['Nehru Nagar', '400024']],
      ['KAL', 'Kalyan', 'THA', 19.2403, 73.1305, ['Titwala', '421605'], ['Mohone', '421102']],
      ['BHI', 'Bhiwandi', 'THA', 19.2967, 73.0631, ['Padgha', '421101'], ['Kharbao', '421302']]];
    T.forEach(t => {
      d.talukas.push({ id: t[0], name: t[1], districtId: t[2], lat: t[3], lng: t[4] });
      [t[5], t[6]].forEach((v, i) => d.villages.push({ id: `VIL-${t[0]}-${i + 1}`, name: v[0], talukaId: t[0], pin: v[1] }));
    });
    d.departments = [
      { id: 'DEP-01', name: 'School Education Department (Demo)', nodal: true },
      { id: 'DEP-02', name: 'Women & Child Development Department (Demo)', nodal: false },
      { id: 'DEP-03', name: 'Public Health Department (Demo)', nodal: false },
      { id: 'DEP-04', name: 'Rural Development Department (Demo)', nodal: false }];

    /* People name pools (fictional) */
    const FN = ['Aarohi', 'Sanika', 'Vaishnavi', 'Pooja', 'Sneha', 'Rutuja', 'Sakshi', 'Tanvi', 'Shruti', 'Mrunal', 'Gauri', 'Ankita', 'Pallavi', 'Komal', 'Aditi', 'Neha', 'Prachi', 'Kavya', 'Isha', 'Riya', 'Swara', 'Diksha', 'Payal', 'Mansi', 'Tejal'];
    const LN = ['Patil', 'Jadhav', 'Shinde', 'Pawar', 'More', 'Kulkarni', 'Deshmukh', 'Gaikwad', 'Chavan', 'Kale', 'Bhosale', 'Salunkhe', 'Mane', 'Sawant', 'Kadam', 'Thorat', 'Gavit', 'Waghmare', 'Naik', 'Sonawane'];
    const SF = ['Sunita', 'Vandana', 'Meera', 'Lata', 'Shobha', 'Rekha', 'Anita', 'Jyoti', 'Suvarna', 'Manisha', 'Rajesh', 'Sanjay', 'Vijay', 'Mahesh', 'Dilip'];
    const person = pool => `${pick(pool)} ${pick(LN)}`;
    let mob = 100; const mobile = () => `90000${U.pad(++mob, 5)}`;

    /* Stock nodes: central + district warehouses + taluka DCs + schools */
    d.nodes.push({ id: 'WH-CEN', type: 'CENTRAL', name: 'State Central Warehouse, Taloja', districtId: null, talukaId: null, lat: 19.0700, lng: 73.1000, capacity: 500000, manager: 'Prakash Kulkarni (Demo)' });
    d.districts.forEach(x => d.nodes.push({ id: `WH-${x.id}`, type: 'DISTRICT', name: `${x.name} District Warehouse`, districtId: x.id, talukaId: null, lat: x.lat + 0.02, lng: x.lng + 0.02, capacity: 80000, manager: person(SF) }));
    d.talukas.forEach(x => d.nodes.push({ id: `DC-${x.id}`, type: 'TALUKA', name: `${x.name} Taluka Distribution Centre`, districtId: x.districtId, talukaId: x.id, lat: x.lat, lng: x.lng, capacity: 15000, manager: person(SF) }));

    /* Schools (20) + employees (20) + students (100) */
    const SN = ['Zilla Parishad Kanya Prashala', 'Savitribai Phule Kanya Vidyalaya', 'Jijamata Girls High School', 'Government Secondary School', 'Ahilyadevi Madhyamik Vidyalaya', 'Municipal Girls High School', 'Rajmata Kanya Shala', 'Janata Vidyalaya'];
    const ST = ['Zilla Parishad', 'Government', 'Government Aided', 'Municipal'];
    let si = 0, stu = 0;
    d.talukas.forEach(t => {
      d.villages.filter(v => v.talukaId === t.id).forEach((v, k) => {
        si++; const id = `SCH-${U.pad(si, 3)}`, total = rnd(220, 640);
        const lat = +(t.lat + (k ? 0.045 : -0.04)).toFixed(4), lng = +(t.lng + (k ? -0.035 : 0.05)).toFixed(4);
        d.schools.push({
          id, udise: `27${U.pad(rnd(10, 35))}${U.pad(si * 137 + 1000, 7)}`, name: `${SN[(si - 1) % SN.length]}, ${v.name}`,
          districtId: t.districtId, talukaId: t.id, villageId: v.id, address: `Near Gram Panchayat, ${v.name}, Tal. ${t.name}`, pin: v.pin,
          type: ST[(si - 1) % ST.length], lat, lng, principal: person(SF), principalMobile: mobile(),
          totalStudents: total, eligible: Math.round(total * (0.32 + R() * 0.12)), status: 'ACTIVE'
        });
        d.nodes.push({ id, type: 'SCHOOL', name: d.schools[si - 1].name, districtId: t.districtId, talukaId: t.id, schoolId: id, lat, lng, capacity: 2000 });
        d.employees.push({ id: `EMP-${U.pad(si, 3)}`, schoolId: id, name: person(SF), mobile: mobile(), designation: pick(['Clerk', 'Lab Assistant', 'Teacher', 'Health Coordinator']), perms: { unload: true, inventory: true, distribute: true }, active: true });
        for (let j = 0; j < 5; j++) {
          stu++;
          d.students.push({
            id: `MH-${t.districtId}-2026-${U.pad(stu, 6)}`, name: person(FN), schoolId: id, districtId: t.districtId, talukaId: t.id,
            cls: 6 + ((stu + j) % 7), division: pick(['A', 'B']), roll: rnd(1, 60),
            eligibility: (stu + 5) % 17 === 0 ? 'PENDING_VERIFICATION' : (stu + 3) % 23 === 0 ? 'NOT_ELIGIBLE' : 'ELIGIBLE',
            enrollment: 'ACTIVE', registeredOn: D(-rnd(60, 200)),
            verification: { status: (stu + 5) % 17 === 0 ? 'PENDING' : 'VERIFIED_SIMULATED', ref: (stu + 5) % 17 === 0 ? '' : `SIM-VRF-${U.pad(stu * 7919 % 100000, 5)}` },
            extraAuth: {}
          });
        }
      });
    });
    d.seq.STU = stu;

    /* Entitlement policy – demo rules, editable by State Admin */
    d.policies = [
      { id: 'POL-01', name: 'Demo Policy A – Upper Primary', classFrom: 6, classTo: 8, packets: 1, active: true, ref: 'GR-DEMO/2026/01', effectiveFrom: U.day(D(-200)) },
      { id: 'POL-02', name: 'Demo Policy B – Secondary & Higher Secondary', classFrom: 9, classTo: 12, packets: 2, active: true, ref: 'GR-DEMO/2026/01', effectiveFrom: U.day(D(-200)) }];

    /* Procurement */
    d.products = [
      { id: 'PRD-01', name: 'Sanitary Pads – Regular (Pack of 8)', unit: 'Packet', spec: 'BIS IS 5405 compliant (demo)' },
      { id: 'PRD-02', name: 'Sanitary Pads – XL (Pack of 8)', unit: 'Packet', spec: 'BIS IS 5405 compliant (demo)' }];
    ['Sahyadri Hygiene Products Pvt Ltd', 'Godavari Health Care Industries', 'Konkan Mahila Udyog SHG Federation', 'Deccan Surgicals & Hygiene LLP', 'Vidarbha Care Manufacturing Co.']
      .forEach((n, i) => d.suppliers.push({ id: `SUP-0${i + 1}`, name: `${n} (Demo)`, city: ['Pune', 'Nashik', 'Ratnagiri', 'Satara', 'Nagpur'][i], gstin: `27DEMO${U.pad(i + 1, 4)}X1Z${i}`, contact: person(SF), mobile: mobile(), status: 'ACTIVE' }));
    const expOff = [540, 600, 38, 720, 480, 75, 660, 510, -12, 630];
    for (let p = 0; p < 5; p++) {
      const poId = `PO-2026-${U.pad(p + 1, 4)}`, ordered = [60000, 50000, 40000, 44000, 36000][p], date = D(-(170 - p * 28));
      const po = { id: poId, supplierId: `SUP-0${p + 1}`, productId: p % 2 ? 'PRD-02' : 'PRD-01', qtyOrdered: ordered, qtyReceived: 0, date, status: 'RECEIVED', batchIds: [] };
      for (let b = 0; b < 2; b++) {
        const i = p * 2 + b, recv = ordered / 2, rej = i % 3 === 0 ? rnd(40, 160) : 0;
        const bat = {
          id: `BAT-${U.pad(i + 1)}`, batchNo: `MH26-${'ABCDE'[p]}${101 + b}`, productId: po.productId, supplierId: po.supplierId, poId,
          mfg: U.day(U.addDays(now, expOff[i] - 730)), exp: U.day(U.addDays(now, expOff[i])), qtyReceived: recv, rejected: rej, approved: recv - rej,
          qc: 'PASSED', receivedOn: U.addDays(date, 9 + b * 6).toISOString()
        };
        if (i === 8) { bat.qtyReceived = 600; bat.rejected = 0; bat.approved = 600; }
        d.batches.push(bat); po.batchIds.push(bat.id); po.qtyReceived += bat.qtyReceived;
      }
      d.purchaseOrders.push(po);
    }
    d.purchaseOrders.push({ id: 'PO-2026-0006', supplierId: 'SUP-01', productId: 'PRD-01', qtyOrdered: 10000, qtyReceived: 0, date: D(-6), status: 'ORDERED', batchIds: [] });
    d.seq.PO = 6; d.seq.BAT = 10;

    /* Opening stock – posted through the ledger so balances reconcile */
    const openAt = (() => { const [y, m] = prevM.split('-').map(Number); return U.iso(new Date(y, m - 1, 1, 9, 0)); })();
    const open = (nodeId, batchId, qty) => Inv.post({ nodeId, batchId, qty, type: 'OPENING', ref: 'OPENING', note: 'Opening balance (demo seed)', at: openAt });
    const cenQty = [22000, 26000, 4200, 30000, 21000, 6800, 28000, 20000, 600, 24000];
    d.batches.forEach((b, i) => open('WH-CEN', b.id, cenQty[i]));
    d.districts.forEach((x, i) => { open(`WH-${x.id}`, `BAT-0${1 + (i % 2)}`, rnd(2600, 5200)); open(`WH-${x.id}`, `BAT-0${4 + (i % 2)}`, rnd(1800, 3600)); });
    d.talukas.forEach((x, i) => { open(`DC-${x.id}`, `BAT-0${1 + (i % 2)}`, rnd(700, 1500)); if (i % 3 === 0) open(`DC-${x.id}`, 'BAT-03', rnd(150, 320)); });
    const lowSchools = { 'SCH-006': 12, 'SCH-014': 8 };
    d.schools.forEach((s, i) => { if (s.id !== 'SCH-001') open(s.id, `BAT-0${1 + (i % 2)}`, lowSchools[s.id] || rnd(70, 240)); });

    /* Fleet */
    const VR = [['MH12-AB-1234', 'Truck (10T)', 20000], ['MH14-CD-5678', 'Truck (7T)', 14000], ['MH15-EF-9012', 'Tempo (3T)', 6000], ['MH04-GH-3456', 'Mini Truck (1.5T)', 3000], ['MH43-JK-7890', 'Tempo (3T)', 6000]];
    const DN = ['Ramesh Shinde', 'Santosh Pawar', 'Ganesh More', 'Anil Jadhav', 'Sunil Gaikwad', 'Vilas Kadam', 'Deepak Mane', 'Kiran Sawant', 'Nitin Thorat', 'Amol Chavan'];
    DN.forEach((n, i) => d.drivers.push({ id: `DRV-${U.pad(i + 1)}`, name: n, mobile: mobile(), license: `MH${U.pad(12 + i)}-DEMO-${U.pad(20150001 + i * 311, 8)}`, licenseTill: U.day(D(i === 6 ? 25 : 400 + i * 60)), vehicleId: i < 5 ? `VEH-0${i + 1}` : null, status: 'AVAILABLE' }));
    VR.forEach((v, i) => d.vehicles.push({
      id: `VEH-0${i + 1}`, regNo: v[0], type: v[1], capacity: v[2], driverId: `DRV-${U.pad(i + 1)}`, gpsDeviceId: `GPS-SIM-${U.pad(i + 1, 4)}`,
      gpsSource: i === 2 ? 'MOBILE' : 'DEVICE', gpsOnline: true, status: 'AVAILABLE', insuranceTill: U.day(D(i === 3 ? 18 : 200 + i * 40)), fitnessTill: U.day(D(i === 1 ? 27 : 300 + i * 30))
    }));

    /* Shipments (20) in every workflow state */
    const firstBatch = (node, qty) => (Inv.batches(node).find(b => b.qty >= qty && new Date(b.batch.exp) > U.addDays(now, 60)) || Inv.batches(node)[0]).batchId;
    const mkShip = (from, to, qty, status, off, veh, extra = {}) => {
      const id = DB.nextId('SHP'), batchId = firstBatch(from, qty), at = D(off);
      const v = veh ? d.vehicles[veh - 1] : null;
      const s = {
        id, fromNode: from, toNode: to, productId: DB.get('batches', batchId).productId, batchId, qty,
        vehicleId: v ? v.id : null, driverId: v ? v.driverId : null, createdAt: at, dispatchDate: null,
        eta: U.addDays(at, 1).toISOString(), status, timeline: [{ status: 'CREATED', at, by: 'System (seed)' }],
        receivedQty: null, damagedQty: null, shortageQty: null, grnNo: null, challanNo: `DC-${id.slice(4)}`, sim: null, allocationId: null, requestId: null
      };
      const step = (st, h) => s.timeline.push({ status: st, at: U.iso(new Date(new Date(at).getTime() + h * 36e5)), by: 'System (seed)' });
      const idx = { CREATED: 0, APPROVED: 1, READY_FOR_DISPATCH: 2, DISPATCHED: 3, IN_TRANSIT: 4, DELAYED: 4, REACHED_DESTINATION: 5, RECEIVED: 6, PARTIALLY_RECEIVED: 6, CANCELLED: -1 }[status];
      if (idx >= 1) step('APPROVED', 1);
      if (idx >= 2) step('READY_FOR_DISPATCH', 2);
      if (idx >= 3) {
        step('DISPATCHED', 3); s.dispatchDate = s.timeline[s.timeline.length - 1].at;
        Inv.post({ nodeId: from, batchId, qty: -qty, type: 'TRANSFER_OUT', ref: id, note: `Dispatch to ${DB.nodeName(to)}`, at: s.dispatchDate });
      }
      if (idx >= 4) step('IN_TRANSIT', 3.2);
      if (status === 'DELAYED') step('DELAYED', 30);
      if (idx >= 5) step('REACHED_DESTINATION', 9);
      if (idx >= 6) {
        const dmg = extra.damaged || 0, sh = extra.shortage || 0, good = qty - dmg - sh, rAt = U.iso(new Date(new Date(at).getTime() + 11 * 36e5));
        s.receivedQty = good; s.damagedQty = dmg; s.shortageQty = sh; s.grnNo = DB.nextId('GRN');
        Inv.post({ nodeId: to, batchId, qty: good + dmg, type: 'TRANSFER_IN', ref: id, note: `Receipt from ${DB.nodeName(from)}`, at: rAt });
        if (dmg) Inv.post({ nodeId: to, batchId, qty: -dmg, type: 'DAMAGE', ref: id, note: 'Damaged on receipt', at: rAt });
        d.grns.push({ id: s.grnNo, shipmentId: id, nodeId: to, at: rAt, dispatched: qty, received: good, damaged: dmg, shortage: sh, receivedBy: 'System (seed)', ack: 'Acknowledged', proof: 'delivery-proof-demo.jpg', status: 'CONFIRMED' });
        if (dmg || sh) d.discrepancies.push({ id: DB.nextId('DSC'), shipmentId: id, grnNo: s.grnNo, nodeId: to, at: rAt, damaged: dmg, shortage: sh, remark: 'Carton wet during transit; 4 packets short in sealed carton.', status: 'SUBMITTED_TO_TALUKA', history: [{ at: rAt, by: 'System (seed)', action: 'Reported at receipt' }] });
        step(status, 11);
      }
      if (status === 'CANCELLED') s.timeline.push({ status: 'CANCELLED', at: U.iso(new Date(new Date(at).getTime() + 5 * 36e5)), by: 'System (seed)' });
      if (extra.sim) { s.sim = { start: now.getTime() - extra.sim[0] * extra.sim[1] * 1000, dur: extra.sim[1] }; s.eta = extra.eta || s.eta; }
      if (v && idx >= 3 && idx <= 5) { v.status = 'ON_TRIP'; DB.get('drivers', v.driverId).status = 'ON_TRIP'; }
      d.shipments.push(s); return s;
    };
    mkShip('WH-CEN', 'WH-PUN', 6000, 'RECEIVED', -28, 1); mkShip('WH-CEN', 'WH-NSK', 5000, 'RECEIVED', -27, 2);
    mkShip('WH-CEN', 'WH-MSU', 5000, 'RECEIVED', -26, 3); mkShip('WH-CEN', 'WH-THA', 4500, 'RECEIVED', -25, 5);
    mkShip('WH-CEN', 'WH-SAT', 4000, 'RECEIVED', -24, 1); mkShip('WH-PUN', 'DC-MUL', 1200, 'RECEIVED', -20, 4);
    mkShip('WH-NSK', 'DC-NIP', 1000, 'RECEIVED', -19, 3); mkShip('DC-MUL', 'SCH-003', 200, 'RECEIVED', -15, 4);
    mkShip('DC-NIP', 'SCH-009', 180, 'PARTIALLY_RECEIVED', -14, 4, { damaged: 6, shortage: 4 });
    mkShip('WH-THA', 'DC-KAL', 900, 'RECEIVED', -12, 5); mkShip('DC-KAL', 'SCH-017', 150, 'RECEIVED', -9, 4);
    mkShip('WH-CEN', 'WH-NSK', 3000, 'IN_TRANSIT', 0, 2, { sim: [0.35, 900], eta: D(1) });
    mkShip('WH-CEN', 'WH-SAT', 2500, 'IN_TRANSIT', 0, 3, { sim: [0.2, 1200], eta: D(1) });
    mkShip('WH-MSU', 'DC-AND', 800, 'DELAYED', -2, 4, { sim: [0.55, 2400], eta: D(-1) });
    mkShip('WH-SAT', 'DC-KAR', 700, 'REACHED_DESTINATION', -1, 5);
    mkShip('WH-THA', 'DC-BHI', 600, 'CREATED', -1, 0); mkShip('DC-AND', 'SCH-013', 120, 'CREATED', 0, 0);
    mkShip('WH-NSK', 'DC-SIN', 900, 'APPROVED', -1, 0); mkShip('DC-SIN', 'SCH-011', 160, 'READY_FOR_DISPATCH', -1, 0);
    mkShip('WH-PUN', 'DC-HAV', 500, 'CANCELLED', -8, 0);
    d.vehicles[3].gpsOnline = false; d.shipments[13].sim.frozen = 0.52; // simulated GPS loss on the delayed vehicle

    /* Demo school SCH-001: small opening stock fully distributed last cycle → closing 0 */
    const s1 = d.students.filter(s => s.schoolId === 'SCH-001' && s.eligibility === 'ELIGIBLE');
    open('SCH-001', 'BAT-01', U.sum(s1, s => Policy.entitlement(s)));
    const mkDist = (st, cycle, at) => {
      const qty = Policy.entitlement(st), batchId = Inv.batches(st.schoolId)[0].batchId, id = DB.nextId('DST');
      Inv.post({ nodeId: st.schoolId, batchId, qty: -qty, type: 'DISTRIBUTION', ref: id, note: `Distribution to ${st.id}`, at });
      d.distributions.push({ id, studentId: st.id, schoolId: st.schoolId, productId: DB.get('batches', batchId).productId, batchId, cycle, qty, at, employeeId: d.employees.find(e => e.schoolId === st.schoolId).id, ack: 'ACKNOWLEDGED', type: 'MONTHLY' });
    };
    s1.forEach((st, i) => mkDist(st, prevM, inPrev(10 + i)));
    const others = d.students.filter(s => s.schoolId !== 'SCH-001' && s.schoolId !== 'SCH-002' && s.eligibility === 'ELIGIBLE' && !lowSchools[s.schoolId]);
    for (let i = 0; d.distributions.length < 20; i += 3) mkDist(others[i], prevM, inPrev(8 + (i % 16)));
    for (let i = 1; d.distributions.length < 30; i += 4) mkDist(others[i], curM, D(-rnd(1, Math.max(1, now.getDate() - 1))));

    /* Baseline aggregates for prior months (demo history for trend charts) */
    for (let k = 6; k >= 1; k--) {
      const byDistrict = {}; d.districts.forEach((x, i) => byDistrict[x.id] = Math.round((5200 + i * 650) * (0.82 + (6 - k) * 0.035) + rnd(-200, 200)));
      d.baseline.monthly.push({ month: U.addMonths(curM, -k), byDistrict });
    }

    /* Allocation history, monthly cycle, additional requests */
    d.cycles.push({ id: `CYC-${prevM}`, month: prevM, status: 'APPROVED', createdAt: inPrev(2), approvedBy: 'State Super Admin (Demo)', lines: d.schools.slice(0, 20).map(s => { const el = d.students.filter(x => x.schoolId === s.id && x.eligibility === 'ELIGIBLE'); const req = U.sum(el, x => Policy.entitlement(x)); return { schoolId: s.id, eligible: el.length, requirement: req, stock: req, replenish: 0 }; }) });
    [[0, 'WH-CEN', 'WH-PUN', 6000, 'DISTRICT'], [1, 'WH-CEN', 'WH-NSK', 5000, 'DISTRICT'], [5, 'WH-PUN', 'DC-MUL', 1200, 'TALUKA']].forEach(a => {
      const id = DB.nextId('ALC'); d.shipments[a[0]].allocationId = id;
      d.allocations.push({ id, level: a[4], type: 'MONTHLY', fromNode: a[1], toNode: a[2], month: prevM, qty: a[3], status: 'RECEIVED', shipmentId: d.shipments[a[0]].id, createdAt: d.shipments[a[0]].createdAt, createdBy: 'System (seed)', remark: 'Monthly allocation' });
    });
    const mkReq = (schoolId, qty, status, reason, off, hist) => d.requests.push({ id: DB.nextId('REQ'), schoolId, currentStock: Inv.total(schoolId), eligible: DB.get('schools', schoolId).eligible, qty, reason, date: D(off), docs: 'request-letter-demo.pdf', status, history: hist, allocationId: null });
    mkReq('SCH-006', 150, 'PENDING_TALUKA', 'Stock critically low; new admissions in Std. 8 and 9.', -2, [{ at: D(-2), by: 'Principal', level: 'SCHOOL', action: 'RAISED', remark: '' }]);
    mkReq('SCH-014', 120, 'PENDING_DISTRICT', 'Monsoon damage to stored stock; replacement required.', -4, [{ at: D(-4), by: 'Principal', level: 'SCHOOL', action: 'RAISED', remark: '' }, { at: D(-3), by: 'Taluka Officer, Andheri', level: 'TALUKA', action: 'APPROVED', remark: 'Verified during school visit.' }]);
    mkReq('SCH-019', 300, 'REJECTED', 'Requesting buffer stock for next term.', -12, [{ at: D(-12), by: 'Principal', level: 'SCHOOL', action: 'RAISED', remark: '' }, { at: D(-11), by: 'Taluka Officer, Bhiwandi', level: 'TALUKA', action: 'REJECTED', remark: 'Existing stock sufficient for current cycle.' }]);

    /* Demo users – one per role. DEMO AUTH ONLY. */
    const demoStu = d.students.find(s => s.schoolId === 'SCH-001' && s.eligibility === 'ELIGIBLE');
    d.users = [
      { id: 'USR-01', email: 'admin@msdms.demo', role: 'STATE_ADMIN', name: 'Dr. Anjali Deshmukh (Demo)' },
      { id: 'USR-02', email: 'officer@msdms.demo', role: 'STATE_OFFICER', name: 'Rohit Kulkarni (Demo)' },
      { id: 'USR-03', email: 'district@msdms.demo', role: 'DISTRICT_OFFICER', name: 'Smita Pawar (Demo)', districtId: 'PUN' },
      { id: 'USR-04', email: 'taluka@msdms.demo', role: 'TALUKA_OFFICER', name: 'Mahesh Jadhav (Demo)', districtId: 'PUN', talukaId: 'HAV' },
      { id: 'USR-05', email: 'warehouse@msdms.demo', role: 'CENTRAL_WH', name: 'Prakash Kulkarni (Demo)', nodeId: 'WH-CEN' },
      { id: 'USR-06', email: 'dwarehouse@msdms.demo', role: 'DISTRICT_WH', name: 'Vandana More (Demo)', districtId: 'PUN', nodeId: 'WH-PUN' },
      { id: 'USR-07', email: 'twarehouse@msdms.demo', role: 'TALUKA_WH', name: 'Dilip Shinde (Demo)', districtId: 'PUN', talukaId: 'HAV', nodeId: 'DC-HAV' },
      { id: 'USR-08', email: 'transport@msdms.demo', role: 'TRANSPORT_MGR', name: 'Sanjay Gaikwad (Demo)' },
      { id: 'USR-09', email: 'driver@msdms.demo', role: 'DRIVER', name: d.drivers[0].name + ' (Demo)', driverId: 'DRV-01' },
      { id: 'USR-10', email: 'principal@msdms.demo', role: 'PRINCIPAL', name: d.schools[0].principal + ' (Demo)', districtId: 'PUN', talukaId: 'HAV', schoolId: 'SCH-001' },
      { id: 'USR-11', email: 'employee@msdms.demo', role: 'EMPLOYEE', name: d.employees[0].name + ' (Demo)', districtId: 'PUN', talukaId: 'HAV', schoolId: 'SCH-001', employeeId: 'EMP-001' },
      { id: 'USR-12', email: 'student@msdms.demo', role: 'STUDENT', name: demoStu.name, schoolId: 'SCH-001', studentId: demoStu.id }];

    /* Starter notifications + audit trail */
    Notify.push('VEHICLE_DELAYED', 'Vehicle delayed', `Shipment ${d.shipments[13].id} (MH04-GH-3456) is running behind schedule.`, { nodes: ['WH-MSU', 'DC-AND'] }, D(-1));
    Notify.push('LOW_STOCK', 'Low stock alert', 'SCH-006 and SCH-014 are below the minimum stock threshold.', { nodes: ['SCH-006', 'SCH-014'] }, D(-1));
    Notify.push('EXPIRY_WARNING', 'Expiry warning', 'Batch MH26-B101 expires within 45 days. Prioritise FEFO dispatch.', { nodes: ['WH-CEN'] }, D(-1));
    Notify.push('REQUEST_RECEIVED', 'Additional request received', 'SCH-006 has raised an additional stock request for 150 packets.', { nodes: ['DC-KAR', 'SCH-006'] }, D(-2));
    Notify.push('DELIVERY_PENDING', 'Delivery pending', `Shipment ${d.shipments[14].id} has reached Karad DC and awaits goods receipt.`, { nodes: ['DC-KAR'] }, D(0));
    Notify.push('DISTRIBUTION_RECORDED', 'Distribution recorded', `Your ${U.monthLabel(prevM)} entitlement was distributed at school.`, { studentId: demoStu.id }, inPrev(12));
    Audit.log('System', 'SEED', 'DB', '', 'Fictional sample data generated');
    DB.actor = null;
    return d;
  }
};
