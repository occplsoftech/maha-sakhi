/* =====================================================================
   MSDMS · inventory.js
   Procurement (suppliers, purchase orders, QC), warehouse network and
   the batch-wise inventory ledger for every stock location.
   ===================================================================== */
'use strict';

const Stock = {
  MIN: { CENTRAL: 20000, DISTRICT: 2000, TALUKA: 300, SCHOOL: 20 },
  schoolReq(schoolId) { return U.sum(DB.d.students.filter(s => s.schoolId === schoolId), s => Policy.entitlement(s)); },
  isLow(node) { const tot = Inv.total(node.id); return tot < Math.max(this.MIN[node.type], node.type === 'SCHOOL' ? this.schoolReq(node.id) : 0); },
  expiry(batch) { const n = U.daysBetween(new Date(), batch.exp); return n < 0 ? 'EXPIRED' : n <= 60 ? 'EXPIRING' : 'OK'; },
  expBadge(b) { const e = this.expiry(b), n = U.daysBetween(new Date(), b.exp); return e === 'EXPIRED' ? UI.badge('EXPIRED') : e === 'EXPIRING' ? UI.badge('PENDING', `Expires in ${n} d`) : UI.badge('ACTIVE', 'OK'); },
  alerts(nodes) {
    const out = [];
    nodes.forEach(n => {
      if (n.type === 'SCHOOL' && DB.get('schools', n.id).status !== 'ACTIVE') return;
      if (this.isLow(n)) out.push({ type: 'LOW_STOCK', sev: Inv.total(n.id) === 0 ? 'bad' : 'warn', nodeId: n.id, msg: `${n.name}: ${U.num(Inv.total(n.id))} packets in stock (below minimum).` });
      Inv.batches(n.id).forEach(b => { const e = this.expiry(b.batch); if (e !== 'OK') out.push({ type: e === 'EXPIRED' ? 'EXPIRED_STOCK' : 'EXPIRING_STOCK', sev: e === 'EXPIRED' ? 'bad' : 'warn', nodeId: n.id, msg: `${n.name}: batch ${b.batch.batchNo} (${U.num(b.qty)} packets) ${e === 'EXPIRED' ? 'has expired' : 'expires ' + U.fmtDate(b.batch.exp)}.` }); });
    });
    return out;
  },
  typeLabel: { CENTRAL: 'Central Warehouse', DISTRICT: 'District Warehouse', TALUKA: 'Taluka Distribution Centre', SCHOOL: 'School Store' }
};

/* ---------- Page: Procurement ---------- */
let procTab = 'po';
App.pages.procurement = root => {
  const d = DB.d, can = Auth.can('proc.manage');
  const approved = U.sum(d.batches, b => b.approved), rejected = U.sum(d.batches, b => b.rejected);
  root.innerHTML = UI.kpis([
    { label: 'Purchase orders', value: d.purchaseOrders.length, icon: 'cart-check' }, { label: 'Packets ordered', value: U.num(U.sum(d.purchaseOrders, p => p.qtyOrdered)), icon: 'bag', tone: 'blue' },
    { label: 'QC approved (inward)', value: U.num(approved), icon: 'patch-check', tone: 'green' }, { label: 'Rejected in QC', value: U.num(rejected), icon: 'x-octagon', tone: 'red' },
    { label: 'Pending receipt', value: U.num(U.sum(d.purchaseOrders.filter(p => p.status !== 'RECEIVED'), p => p.qtyOrdered - p.qtyReceived)), icon: 'hourglass-split', tone: 'saffron' }], 'kpi-5') +
    UI.tabs('ptabs', [{ key: 'po', label: 'Purchase Orders', icon: 'cart-check', count: d.purchaseOrders.length }, { key: 'batch', label: 'Batches & Quality Inspection', icon: 'upc-scan', count: d.batches.length }, { key: 'sup', label: 'Suppliers', icon: 'buildings', count: d.suppliers.length }], procTab) + `<div class="panel"><div class="panel-b" id="pBody"></div></div>`;
  UI.onTabs('ptabs', k => { procTab = k; App.refresh(); });
  if (procTab === 'po') {
    UI.table('#pBody', {
      id: 'po', rows: d.purchaseOrders.slice().reverse(), exportName: 'purchase-orders', filters: [{ key: 'status', label: 'Status' }, { key: 'sup', label: 'Supplier', get: p => DB.name('suppliers', p.supplierId) }],
      toolbar: can ? `<button class="btn btn-sm btn-primary" data-act="new"><i class="bi bi-plus-lg"></i> New Purchase Order</button>` : '',
      columns: [{ key: 'id', label: 'PO Number', render: p => `<strong>${p.id}</strong>` }, { label: 'Supplier', value: p => DB.name('suppliers', p.supplierId) }, { label: 'Product', value: p => DB.name('products', p.productId) }, { label: 'Purchase Date', value: p => p.date, render: p => U.fmtDate(p.date) },
        { key: 'qtyOrdered', label: 'Ordered', cls: 'text-end', render: p => U.num(p.qtyOrdered) }, { key: 'qtyReceived', label: 'Received', cls: 'text-end', render: p => U.num(p.qtyReceived) },
        { label: 'Batches', value: p => p.batchIds.map(b => DB.get('batches', b).batchNo).join(', ') || '—' }, { key: 'status', label: 'Status', render: p => UI.badge(p.status) },
        { label: '', sort: false, noExport: true, render: p => can && p.status !== 'RECEIVED' ? UI.actBtn('recv', 'box-arrow-in-down', 'Receive & QC', 'primary') : '' }],
      onAction: (act, id) => {
        if (act === 'new') return UI.modal({
          title: 'New purchase order', size: 'lg', body: UI.fields([{ name: 'supplierId', label: 'Supplier', type: 'select', required: true, options: d.suppliers.filter(s => s.status === 'ACTIVE').map(s => ({ v: s.id, l: s.name })) }, { name: 'productId', label: 'Product', type: 'select', required: true, options: d.products.map(p => ({ v: p.id, l: p.name })) }, { name: 'qtyOrdered', label: 'Quantity ordered (packets)', type: 'number', required: true, min: 100, step: 1 }, { name: 'date', label: 'Purchase date', type: 'date', required: true, value: U.day(new Date()), max: U.day(new Date()) }]),
          onSubmit: f => { const po = { id: `PO-${new Date().getFullYear()}-${U.pad(++d.seq.PO, 4)}`, ...f, date: U.iso(new Date(f.date)), qtyReceived: 0, status: 'ORDERED', batchIds: [] }; d.purchaseOrders.push(po); Audit.log('Procurement', 'CREATE_PO', po.id, '', `${U.num(f.qtyOrdered)} packets`); App.commit(`${po.id} created.`); }
        });
        const po = DB.get('purchaseOrders', id), rem = po.qtyOrdered - po.qtyReceived;
        UI.modal({
          title: `Receive stock & quality inspection · ${po.id}`, size: 'lg', submit: 'Post stock inward', submitIcon: 'box-arrow-in-down', tone: 'success',
          body: UI.kv([['Supplier', esc(DB.name('suppliers', po.supplierId))], ['Product', esc(DB.name('products', po.productId))], ['Ordered', U.num(po.qtyOrdered)], ['Pending receipt', U.num(rem)]]) + '<hr>' + UI.fields([
            { name: 'batchNo', label: 'Batch number', required: true, value: `MH26-R${U.pad(d.seq.BAT + 1, 3)}`, pattern: '[A-Z0-9-]{4,16}' },
            { name: 'qtyReceived', label: 'Quantity received (packets)', type: 'number', required: true, min: 1, max: rem, step: 1, value: rem },
            { name: 'mfg', label: 'Manufacturing date', type: 'date', required: true, value: U.day(U.addDays(new Date(), -30)), max: U.day(new Date()) },
            { name: 'exp', label: 'Expiry date', type: 'date', required: true, value: U.day(U.addDays(new Date(), 700)), min: U.day(U.addDays(new Date(), 1)) },
            { name: 'rejected', label: 'Rejected quantity (QC)', type: 'number', required: true, min: 0, step: 1, value: 0 },
            { name: 'qc', label: 'Quality inspection result', type: 'select', required: true, options: ['PASSED', 'FAILED'], value: 'PASSED' },
            { name: 'remark', label: 'Inspection remarks', type: 'textarea', col: 12, value: 'Sampling as per demo QC protocol; packaging and absorbency checks satisfactory.' }]) +
            `<div class="steps-note mt-3"><i class="bi bi-info-circle"></i> Approved quantity = received − rejected. Approved stock is posted to <strong>${esc(DB.nodeName('WH-CEN'))}</strong> with a unique transaction ID.</div>`,
          onSubmit: f => {
            if (f.rejected > f.qtyReceived) throw new Error('Rejected quantity cannot exceed received quantity.');
            if (d.batches.some(b => b.batchNo === f.batchNo)) throw new Error('Batch number already exists.');
            if (new Date(f.exp) <= new Date(f.mfg)) throw new Error('Expiry date must be after manufacturing date.');
            const approvedQty = f.qc === 'FAILED' ? 0 : f.qtyReceived - f.rejected;
            const bat = { id: `BAT-${U.pad(++d.seq.BAT)}`, batchNo: f.batchNo, productId: po.productId, supplierId: po.supplierId, poId: po.id, mfg: f.mfg, exp: f.exp, qtyReceived: f.qtyReceived, rejected: f.qtyReceived - approvedQty, approved: approvedQty, qc: f.qc, receivedOn: U.iso(new Date()), remark: f.remark };
            d.batches.push(bat); po.batchIds.push(bat.id); po.qtyReceived += f.qtyReceived; po.status = po.qtyReceived >= po.qtyOrdered ? 'RECEIVED' : 'PARTIAL';
            let txn = null; if (approvedQty > 0) txn = Inv.post({ nodeId: 'WH-CEN', batchId: bat.id, qty: approvedQty, type: 'INWARD', ref: po.id, note: `Procurement inward · batch ${bat.batchNo}` });
            Audit.log('Procurement', 'STOCK_INWARD', po.id, `Received ${f.qtyReceived}`, `Approved ${approvedQty}, rejected ${bat.rejected}`, `QC ${f.qc}`);
            Notify.push('STOCK_RECEIVED', 'New stock received', `${U.num(approvedQty)} packets (batch ${bat.batchNo}) inward at Central Warehouse against ${po.id}.`, { nodes: ['WH-CEN'] });
            App.commit(`Stock inward posted: ${U.num(approvedQty)} packets${txn ? ' · ' + txn.id : ''}.`);
          }
        });
      }
    });
  } else if (procTab === 'batch') {
    const net = id => U.sum(Object.values(d.stock), s => s[id] || 0);
    UI.table('#pBody', {
      id: 'bat', rows: d.batches.slice().reverse(), exportName: 'batches', filters: [{ key: 'qc', label: 'QC' }, { key: 'e', label: 'Expiry', get: b => Stock.expiry(b) }],
      columns: [{ key: 'batchNo', label: 'Batch No.', render: b => `<strong>${b.batchNo}</strong>` }, { label: 'Product', value: b => DB.name('products', b.productId) }, { label: 'Supplier', value: b => DB.name('suppliers', b.supplierId) }, { key: 'poId', label: 'PO' },
        { key: 'mfg', label: 'Mfg. Date', render: b => U.fmtDate(b.mfg) }, { key: 'exp', label: 'Expiry Date', render: b => `${U.fmtDate(b.exp)} ${Stock.expBadge(b)}` },
        { key: 'qtyReceived', label: 'Received', cls: 'text-end', render: b => U.num(b.qtyReceived) }, { key: 'rejected', label: 'Rejected', cls: 'text-end', render: b => U.num(b.rejected) }, { key: 'approved', label: 'Approved', cls: 'text-end', render: b => U.num(b.approved) },
        { label: 'In network', value: b => net(b.id), cls: 'text-end', render: b => U.num(net(b.id)) }, { key: 'qc', label: 'QC', render: b => UI.badge(b.qc) }]
    });
  } else {
    const form = s => UI.fields([{ name: 'name', label: 'Supplier name', required: true }, { name: 'city', label: 'City', required: true }, { name: 'gstin', label: 'GSTIN (fictional)', required: true, pattern: '[0-9A-Z]{15}', error: '15-character GSTIN' }, { name: 'contact', label: 'Contact person', required: true }, { name: 'mobile', label: 'Mobile', required: true, pattern: '[0-9]{10}', error: '10-digit mobile number' }, { name: 'status', label: 'Status', type: 'select', required: true, options: ['ACTIVE', 'INACTIVE'] }], s || { status: 'ACTIVE' });
    UI.table('#pBody', {
      id: 'sup', rows: d.suppliers, exportName: 'suppliers', filters: [{ key: 'status', label: 'Status' }],
      toolbar: can ? `<button class="btn btn-sm btn-primary" data-act="new"><i class="bi bi-plus-lg"></i> Add Supplier</button>` : '',
      columns: [{ key: 'id', label: 'Supplier ID' }, { key: 'name', label: 'Name', render: s => `<strong>${esc(s.name)}</strong>` }, { key: 'city', label: 'City' }, { key: 'gstin', label: 'GSTIN (fictional)' }, { key: 'contact', label: 'Contact' }, { key: 'mobile', label: 'Mobile' },
        { label: 'POs', value: s => d.purchaseOrders.filter(p => p.supplierId === s.id).length, cls: 'text-end' }, { key: 'status', label: 'Status', render: s => UI.badge(s.status) }, { label: '', sort: false, noExport: true, render: () => can ? UI.actBtn('edit', 'pencil', 'Edit') : '' }],
      onAction: (act, id) => { const s = act === 'edit' ? DB.get('suppliers', id) : null; UI.modal({ title: s ? 'Edit supplier' : 'Add supplier', size: 'lg', body: form(s), onSubmit: f => { if (s) { Object.assign(s, f); Audit.log('Procurement', 'UPDATE_SUPPLIER', s.id); } else { const nid = `SUP-${U.pad(d.suppliers.length + 1)}`; d.suppliers.push({ id: nid, ...f }); Audit.log('Procurement', 'CREATE_SUPPLIER', nid, '', f.name); } App.commit('Supplier saved.'); } }); }
    });
  }
};

/* ---------- Page: Warehouses ---------- */
App.pages.warehouses = root => {
  const nodes = Scope.nodes().filter(n => n.type !== 'SCHOOL'), by = t => nodes.filter(n => n.type === t);
  const alerts = Stock.alerts(nodes);
  root.innerHTML = UI.kpis([
    { label: 'Central warehouse stock', value: U.num(U.sum(by('CENTRAL'), n => Inv.total(n.id))), icon: 'bank' },
    { label: 'District warehouses', value: U.num(U.sum(by('DISTRICT'), n => Inv.total(n.id))), icon: 'house-gear', tone: 'blue', sub: `${by('DISTRICT').length} locations` },
    { label: 'Taluka distribution centres', value: U.num(U.sum(by('TALUKA'), n => Inv.total(n.id))), icon: 'box-seam', tone: 'green', sub: `${by('TALUKA').length} locations` },
    { label: 'Stock alerts', value: alerts.length, icon: 'exclamation-triangle', tone: 'red' }], 'kpi-4') +
    `<div class="chain"><span><i class="bi bi-bank"></i> Central Warehouse</span><i class="bi bi-arrow-right"></i><span><i class="bi bi-house-gear"></i> District Warehouse</span><i class="bi bi-arrow-right"></i><span><i class="bi bi-box-seam"></i> Taluka Distribution Centre</span><i class="bi bi-arrow-right"></i><span><i class="bi bi-building"></i> School</span></div>` +
    UI.card('Warehouse & distribution centre master', '<div id="whTbl"></div>', { icon: 'house-gear' });
  UI.table('#whTbl', {
    id: 'wh', rows: nodes, exportName: 'warehouses', pageSize: 16, filters: [{ key: 'type', label: 'Type', options: ['CENTRAL', 'DISTRICT', 'TALUKA'].map(v => ({ v, l: Stock.typeLabel[v] })) }, { key: 'd', label: 'District', get: n => n.districtId ? DB.name('districts', n.districtId) : 'State' }],
    columns: [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Location', render: n => `<strong>${esc(n.name)}</strong><div class="sub">${Stock.typeLabel[n.type]}</div>` }, { label: 'District', value: n => n.districtId ? DB.name('districts', n.districtId) : '—' }, { key: 'manager', label: 'In-charge' },
      { label: 'Stock (packets)', value: n => Inv.total(n.id), cls: 'text-end', render: n => `<strong>${U.num(Inv.total(n.id))}</strong>` }, { label: 'Batches', value: n => Inv.batches(n.id).length, cls: 'text-end' },
      { label: 'Utilisation', value: n => Math.round(Inv.total(n.id) / n.capacity * 100), render: n => { const p = Math.min(100, Math.round(Inv.total(n.id) / n.capacity * 100)); return `<div class="mini-prog lg"><i style="width:${p}%"></i></div><div class="sub">${p}% of ${U.num(n.capacity)}</div>`; } },
      { label: 'Health', value: n => Stock.isLow(n) ? 'LOW' : 'OK', render: n => (Stock.isLow(n) ? UI.badge('DELAYED', 'Low stock') : UI.badge('ACTIVE', 'Healthy')) + (alerts.some(a => a.nodeId === n.id && a.type !== 'LOW_STOCK') ? ' ' + UI.badge('PENDING', 'Expiry alert') : '') },
      { label: '', sort: false, noExport: true, render: n => `<div class="acts">${UI.actBtn('ledger', 'journal-text', 'Ledger', 'outline-primary')}${Auth.can('master.edit') ? UI.actBtn('edit', 'pencil', 'Edit', 'outline-secondary') : ''}</div>` }],
    onAction: (act, id) => {
      if (act === 'ledger') return location.href = `inventory.html?node=${id}`;
      const n = DB.node(id);
      UI.modal({ title: `Edit ${esc(n.name)}`, body: UI.fields([{ name: 'name', label: 'Name', required: true, col: 12 }, { name: 'manager', label: 'In-charge', required: true }, { name: 'capacity', label: 'Capacity (packets)', type: 'number', required: true, min: 100 }], n), onSubmit: f => { Audit.log('Masters', 'UPDATE_WAREHOUSE', n.id, n.name, f.name); Object.assign(n, f); App.commit('Warehouse updated.'); } });
    }
  });
};

/* ---------- Page: Inventory ledger ---------- */
let invNode = null, invTab = 'batch', invMonth = null;
App.pages.inventory = root => {
  const nodes = Scope.nodes(), q = new URLSearchParams(location.search).get('node');
  if (!invNode) invNode = (q && nodes.some(n => n.id === q) ? q : null) || (Scope.ownNodeIds().find(id => nodes.some(n => n.id === id))) || (nodes[0] && nodes[0].id);
  invMonth = invMonth || U.month();
  const node = DB.node(invNode), s = Inv.summary(invNode, invMonth), owns = Scope.owns(invNode) && Auth.can('stock.manage'), isEmp = Auth.is('EMPLOYEE');
  const bats = Inv.batches(invNode), ledger = DB.d.ledger.filter(tx => tx.nodeId === invNode).slice().reverse();
  const pending = DB.d.shipments.filter(x => x.toNode === invNode && [...Ship.ACTIVE, 'REACHED_DESTINATION'].includes(x.status));
  const months = [0, 1, 2, 3, 4, 5].map(k => U.addMonths(U.month(), -k));
  const alerts = Stock.alerts([node]);
  root.innerHTML = `<div class="filter-bar"><label>Stock location<select class="form-select form-select-sm" id="invSel">${nodes.map(n => `<option value="${n.id}" ${n.id === invNode ? 'selected' : ''}>${esc(n.name)} (${n.id})</option>`).join('')}</select></label>
      <label>Month<select class="form-select form-select-sm" id="invM">${months.map(m => `<option value="${m}" ${m === invMonth ? 'selected' : ''}>${U.monthLabel(m)}</option>`).join('')}</select></label>
      <div class="ms-auto d-flex gap-2 flex-wrap align-items-end">${owns && !isEmp ? `<button class="btn btn-sm btn-outline-primary" id="bAdj"><i class="bi bi-sliders"></i> Stock adjustment</button><button class="btn btn-sm btn-outline-primary" id="bRec"><i class="bi bi-clipboard-data"></i> Reconcile</button>` : ''}${owns && Scope.employeePerm('inventory') ? `<button class="btn btn-sm btn-outline-danger" id="bDmg"><i class="bi bi-exclamation-octagon"></i> Record damaged / expired</button>` : ''}${node.type === 'CENTRAL' && Auth.can('proc.manage') ? `<a class="btn btn-sm btn-primary" href="procurement.html"><i class="bi bi-box-arrow-in-down"></i> Stock inward (PO)</a>` : ''}</div></div>
    ${alerts.map(a => `<div class="alert-line ${a.sev}"><i class="bi bi-exclamation-triangle"></i> ${esc(a.msg)}</div>`).join('')}
    <div class="eq-grid">${[['Opening stock', s.opening, ''], ['Monthly stock received', s.received, '+'], ['Additional stock received', s.additional, '+'], ['Total stock', s.total, '='], ['Distributed', s.distributed, '−'], ['Damaged / expired', s.damaged, '−'], ['Transferred out', s.transferredOut, '−'], ['Adjustments', s.adjustment, '±'], ['Closing stock', s.closing, '=']].map(x => `<div class="eq ${x[0] === 'Closing stock' ? 'eq-close' : ''}"><span class="eq-op">${x[2]}</span><strong>${U.num(x[1])}</strong><small>${x[0]}</small></div>`).join('')}</div>
    <p class="formula">Closing Stock = Opening Stock + Received Stock − Distributed Stock − Damaged Stock − Transferred Out (± approved adjustments) · Pending inbound transactions: <strong>${pending.length}</strong>${pending.length ? ` (${U.num(U.sum(pending, x => x.qty))} packets in transit)` : ''}</p>` +
    UI.tabs('itabs', [{ key: 'batch', label: 'Batch-wise stock', icon: 'upc-scan', count: bats.length }, { key: 'ledger', label: 'Stock movement ledger', icon: 'journal-text', count: ledger.length }, { key: 'damage', label: 'Damaged & expired', icon: 'exclamation-octagon' }], invTab) + `<div class="panel"><div class="panel-b" id="iBody"></div></div>`;
  $('#invSel').onchange = e => { invNode = e.target.value; App.refresh(); };
  $('#invM').onchange = e => { invMonth = e.target.value; App.refresh(); };
  UI.onTabs('itabs', k => { invTab = k; App.refresh(); });
  const batchOpts = bats.map(b => ({ v: b.batchId, l: `${b.batch.batchNo} · ${U.num(b.qty)} in stock · exp ${U.fmtDate(b.batch.exp)}` }));
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  on('#bAdj', () => UI.modal({
    title: `Stock adjustment · ${esc(node.name)}`, body: UI.fields([{ name: 'batchId', label: 'Batch', type: 'select', required: true, options: batchOpts, col: 12 }, { name: 'dir', label: 'Adjustment type', type: 'select', required: true, options: [{ v: '1', l: 'Increase (+)' }, { v: '-1', l: 'Decrease (−)' }] }, { name: 'qty', label: 'Quantity', type: 'number', required: true, min: 1, step: 1 }, { name: 'reason', label: 'Reason', type: 'textarea', required: true, col: 12 }]) + '<div class="steps-note mt-3"><i class="bi bi-shield-exclamation"></i> Adjustments are fully audited. Unusually large adjustments are flagged to the State command centre.</div>',
    onSubmit: f => { const qty = f.qty * Number(f.dir), tx = Inv.post({ nodeId: invNode, batchId: f.batchId, qty, type: 'ADJUSTMENT', ref: 'ADJ', note: f.reason }); Audit.log('Inventory', 'STOCK_ADJUSTMENT', tx.id, '', `${qty > 0 ? '+' : ''}${qty} · ${f.reason}`); App.commit(`Adjustment posted · ${tx.id}`); }
  }));
  on('#bDmg', () => UI.modal({
    title: `Record damaged / expired stock · ${esc(node.name)}`, tone: 'danger', body: UI.fields([{ name: 'batchId', label: 'Batch', type: 'select', required: true, options: batchOpts, col: 12 }, { name: 'type', label: 'Type', type: 'select', required: true, options: [{ v: 'DAMAGE', l: 'Damaged' }, { v: 'EXPIRED', l: 'Expired write-off' }] }, { name: 'qty', label: 'Quantity', type: 'number', required: true, min: 1, step: 1 }, { name: 'reason', label: 'Remarks', type: 'textarea', required: true, col: 12 }]),
    onSubmit: f => { const tx = Inv.post({ nodeId: invNode, batchId: f.batchId, qty: -f.qty, type: f.type, ref: f.type, note: f.reason }); Audit.log('Inventory', f.type === 'DAMAGE' ? 'RECORD_DAMAGE' : 'EXPIRY_WRITE_OFF', tx.id, '', `${f.qty} · ${f.reason}`); App.commit(`${f.qty} packets written off · ${tx.id}`, 'warning'); }
  }));
  on('#bRec', () => UI.modal({
    title: `Stock reconciliation · ${esc(node.name)}`, size: 'lg', submit: 'Post reconciliation',
    body: bats.length ? `<p class="small text-muted">Enter the physical count for each batch. Variances are posted as audited adjustments.</p><table class="table table-sm align-middle"><thead><tr><th>Batch</th><th class="text-end">System stock</th><th style="width:170px">Physical count</th></tr></thead><tbody>${bats.map(b => `<tr><td>${b.batch.batchNo}</td><td class="text-end">${U.num(b.qty)}</td><td><input class="form-control form-control-sm" type="number" min="0" step="1" required name="c_${b.batchId}" value="${b.qty}"></td></tr>`).join('')}</tbody></table>` + UI.fields([{ name: 'remark', label: 'Reconciliation remark', type: 'textarea', required: true, col: 12, value: 'Physical stock verification' }]) : UI.empty('No stock to reconcile.'),
    onSubmit: f => { let n = 0; bats.forEach(b => { const diff = f['c_' + b.batchId] - b.qty; if (diff) { const tx = Inv.post({ nodeId: invNode, batchId: b.batchId, qty: diff, type: 'ADJUSTMENT', ref: 'RECON', note: `Reconciliation: ${f.remark}` }); Audit.log('Inventory', 'RECONCILIATION', tx.id, b.qty, f['c_' + b.batchId], f.remark); n++; } }); if (!n) Audit.log('Inventory', 'RECONCILIATION', invNode, '', 'No variance'); App.commit(n ? `Reconciliation posted with ${n} variance adjustment(s).` : 'Reconciled – no variance found.'); }
  }));
  if (invTab === 'batch') UI.table('#iBody', {
    id: 'ib' + invNode, rows: bats.map(b => ({ id: b.batchId, ...b })), exportName: `batch-stock-${invNode}`, empty: 'No stock available at this location.',
    columns: [{ label: 'Batch No.', value: b => b.batch.batchNo, render: b => `<strong>${b.batch.batchNo}</strong>` }, { label: 'Product', value: b => DB.name('products', b.batch.productId) }, { label: 'Mfg. Date', value: b => b.batch.mfg, render: b => U.fmtDate(b.batch.mfg) }, { label: 'Expiry Date', value: b => b.batch.exp, render: b => U.fmtDate(b.batch.exp) }, { label: 'Expiry status', value: b => Stock.expiry(b.batch), render: b => Stock.expBadge(b.batch) }, { key: 'qty', label: 'Quantity (packets)', cls: 'text-end', render: b => `<strong>${U.num(b.qty)}</strong>` }]
  });
  else {
    const rows = invTab === 'damage' ? ledger.filter(tx => ['DAMAGE', 'EXPIRED'].includes(tx.type)) : ledger;
    UI.table('#iBody', {
      id: 'il' + invTab + invNode, rows, exportName: `stock-ledger-${invNode}`, pageSize: 12, filters: invTab === 'ledger' ? [{ key: 'type', label: 'Type' }] : [], empty: invTab === 'damage' ? 'No damaged or expired stock recorded.' : 'No transactions.',
      columns: [{ key: 'id', label: 'Transaction ID', render: tx => `<code>${tx.id}</code>` }, { label: 'Date & Time', value: tx => tx.at, render: tx => U.fmtDT(tx.at) }, { key: 'type', label: 'Type', render: tx => UI.badge(tx.qty > 0 ? 'ACTIVE' : tx.type === 'DAMAGE' || tx.type === 'EXPIRED' ? 'DELAYED' : 'CREATED', tx.type.replace(/_/g, ' ')) },
        { label: 'Batch', value: tx => DB.get('batches', tx.batchId).batchNo }, { key: 'qty', label: 'Qty', cls: 'text-end', render: tx => `<span class="${tx.qty > 0 ? 'text-success' : 'text-danger'} fw-semibold">${tx.qty > 0 ? '+' : ''}${U.num(tx.qty)}</span>` },
        { key: 'balance', label: 'Balance', cls: 'text-end', render: tx => U.num(tx.balance) }, { key: 'ref', label: 'Reference' }, { key: 'note', label: 'Remarks' }, { key: 'user', label: 'User' }]
    });
  }
};
