/* =====================================================================
   MSDMS · ai.js
   "Sakhi AI" – decision-support features for the prototype:
     · executive brief            · demand forecasting
     · stock-out risk prediction  · anomaly detection
     · smart recommendations      · shipment delay-risk scoring
     · natural-language assistant (role- and scope-aware)
   SIMULATED AI: everything here is computed in the browser with
   transparent statistical / rule-based models over the demo data. No
   data leaves the device and no external AI service is called.
   Integration point for an approved AI/ML service:  AIService.ask()
   ===================================================================== */
'use strict';

const AIService = {
  /* Replace with a call to a Government-approved, privacy-compliant model endpoint. */
  ask(question) { return Promise.resolve(AI.answer(question)); }
};

const AI = {
  /* ---- Demand forecast: least-squares trend on monthly distribution ---- */
  forecast(districtIds, horizon = 3) {
    const hist = DB.d.baseline.monthly.map(m => ({ month: m.month, v: U.sum(districtIds, id => m.byDistrict[id] || 0) }));
    const n = hist.length, xs = hist.map((_, i) => i), mx = U.sum(xs) / n, my = U.sum(hist, h => h.v) / n;
    const slope = U.sum(xs, x => (x - mx) * (hist[x].v - my)) / U.sum(xs, x => (x - mx) ** 2), icpt = my - slope * mx;
    const resid = Math.sqrt(U.sum(xs, x => (hist[x].v - (icpt + slope * x)) ** 2) / Math.max(1, n - 2));
    const fc = []; for (let k = 0; k < horizon; k++) { const x = n + k, v = Math.round(icpt + slope * x); fc.push({ month: U.addMonths(hist[n - 1].month, k + 1), v, lo: Math.round(v - 1.6 * resid), hi: Math.round(v + 1.6 * resid) }); }
    return { hist, fc, slope: Math.round(slope), growthPct: Math.round(slope / my * 1000) / 10 };
  },
  /* ---- Stock-out risk per school ---- */
  schoolRisk() {
    return Scope.schools().filter(s => s.status === 'ACTIVE').map(s => {
      const stock = Inv.total(s.id), req = Stock.schoolReq(s.id), el = DB.d.students.filter(x => x.schoolId === s.id && Policy.entitlement(x) > 0);
      const pending = U.sum(el, x => Math.max(0, Policy.entitlement(x) - Policy.distributed(x.id, U.month(), 'MONTHLY'))), inbound = U.sum(DB.d.shipments.filter(x => x.toNode === s.id && [...Ship.ACTIVE, 'REACHED_DESTINATION'].includes(x.status)), x => x.qty);
      const days = req ? Math.round(stock / (req / 30)) : 999, risk = stock === 0 ? 'CRITICAL' : stock < pending ? 'HIGH' : stock < Stock.MIN.SCHOOL || days < 45 ? 'MEDIUM' : 'LOW';
      const prob = { CRITICAL: 96, HIGH: 82, MEDIUM: 48, LOW: 8 }[risk];
      return { id: s.id, school: s, stock, req, pending, inbound, days, risk, prob, suggest: Math.max(0, Math.max(req * 2, Stock.MIN.SCHOOL * 2) - stock - inbound) };
    }).sort((a, b) => b.prob - a.prob || a.stock - b.stock);
  },
  /* ---- District warehouse cover vs. historical monthly demand ---- */
  districtCover() {
    return DB.d.districts.filter(x => Scope.districtIds().includes(x.id) && Scope.nodeIds().includes('WH-' + x.id)).map(x => {
      const f = this.forecast([x.id], 1), stock = Inv.total('WH-' + x.id), dc = U.sum(DB.d.talukas.filter(t => t.districtId === x.id), t => Inv.total('DC-' + t.id));
      const inbound = U.sum(DB.d.shipments.filter(s => s.toNode === 'WH-' + x.id && [...Ship.ACTIVE, 'REACHED_DESTINATION'].includes(s.status)), s => s.qty);
      return { district: x, stock, dc, inbound, demand: f.fc[0].v, cover: Math.round((stock + dc + inbound) / f.fc[0].v * 10) / 10, suggest: Math.max(0, Math.round((f.fc[0].v * 1.5 - stock - dc - inbound) / 500) * 500) };
    }).sort((a, b) => a.cover - b.cover);
  },
  /* ---- Anomaly detection (transparent rules with confidence scores) ---- */
  anomalies() {
    const out = [], nodes = Scope.nodeIds(), add = (score, cat, title, detail, link) => out.push({ score, cat, title, detail, link });
    DB.d.ledger.filter(t => t.type === 'ADJUSTMENT' && nodes.includes(t.nodeId)).forEach(t => { const before = t.balance - t.qty, pct = before ? Math.abs(t.qty) / before : 1; if (Math.abs(t.qty) >= 200 || pct >= 0.25) add(Math.min(97, 60 + Math.round(pct * 100)), 'Inventory', `Unusual stock adjustment ${t.id}`, `${t.qty > 0 ? '+' : ''}${U.num(t.qty)} packets (${Math.round(pct * 100)}% of balance) at ${DB.nodeName(t.nodeId)} by ${t.user}. Reason: “${t.note}”.`, 'inventory'); });
    DB.d.grns.filter(g => nodes.includes(g.nodeId) && (g.damaged + g.shortage) / g.dispatched > 0.02).forEach(g => add(Math.min(95, 55 + Math.round((g.damaged + g.shortage) / g.dispatched * 400)), 'Transit loss', `High transit variance on ${g.shipmentId}`, `${g.damaged} damaged + ${g.shortage} short of ${U.num(g.dispatched)} dispatched (${((g.damaged + g.shortage) / g.dispatched * 100).toFixed(1)}%) received at ${DB.nodeName(g.nodeId)}.`, 'deliveries'));
    DB.d.distributions.filter(x => Scope.schoolIds().includes(x.schoolId)).forEach(x => { const h = new Date(x.at).getHours(); if (h < 7 || h >= 19) add(72, 'Distribution', `Off-hours distribution ${x.id}`, `Recorded at ${U.fmtDT(x.at)} in ${x.schoolId} by ${x.employeeId}, outside normal school hours.`, 'audit-logs'); });
    if (new Date().getDate() >= 10) { const idle = Scope.schools().filter(s => { const c = Stats.coverage([s.id]); return s.status === 'ACTIVE' && c.eligible && c.served === 0 && Inv.total(s.id) > 0 && Inv.total(s.id) >= Stock.schoolReq(s.id); }); if (idle.length) add(64, 'Coverage', `Idle stock at ${idle.length} school(s)`, `${idle.slice(0, 8).map(s => s.id).join(', ')}${idle.length > 8 ? '…' : ''} hold sufficient stock but have served none of their eligible students this cycle.`, 'reports'); }
    Scope.shipments().filter(s => Ship.ACTIVE.includes(s.status)).forEach(s => { const v = DB.get('vehicles', s.vehicleId); if (v && !v.gpsOnline) add(78, 'Transport', `GPS silent on ${v.regNo}`, `No location updates from ${v.gpsDeviceId} while carrying ${s.id} (${U.num(s.qty)} packets). Last known position shown on map.`, 'tracking'); });
    return out.sort((a, b) => b.score - a.score);
  },
  /* ---- Delay-risk score for open shipments ---- */
  delayRisk() {
    return Scope.shipments().filter(s => !['RECEIVED', 'PARTIALLY_RECEIVED', 'CANCELLED', 'REACHED_DESTINATION'].includes(s.status)).map(s => {
      const v = s.vehicleId && DB.get('vehicles', s.vehicleId), dr = s.driverId && DB.get('drivers', s.driverId), dist = Ship.distance(s), why = [];
      let score = 12 + Math.min(25, Math.round(dist / 12));
      if (dist > 150) why.push(`long route (${Math.round(dist)} km)`);
      if (s.status === 'DELAYED') { score += 45; why.push('already past expected arrival'); }
      if (!v) { score += 18; why.push('no vehicle assigned'); } else {
        if (!v.gpsOnline) { score += 20; why.push('GPS offline'); }
        if (U.daysBetween(new Date(), v.insuranceTill) <= 30 || U.daysBetween(new Date(), v.fitnessTill) <= 30) { score += 10; why.push('vehicle documents expiring'); }
      }
      if (dr && U.daysBetween(new Date(), dr.licenseTill) <= 30) { score += 8; why.push('driver licence expiring'); }
      if (U.daysBetween(s.createdAt, new Date()) >= 1 && !s.dispatchDate) { score += 12; why.push('pending dispatch > 24 h'); }
      score = Math.min(96, score);
      return { id: s.id, s, score, level: score >= 65 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW', why: why.join(', ') || 'no risk factors detected' };
    }).sort((a, b) => b.score - a.score);
  },
  /* ---- Smart recommendations with one-click actions ---- */
  recommendations() {
    const out = [], open = to => DB.d.allocations.some(a => a.toNode === to && ['APPROVED', 'DISPATCHED'].includes(a.status));
    this.schoolRisk().filter(r => r.prob >= 48 && r.suggest > 0).forEach(r => {
      const dc = `DC-${r.school.talukaId}`, covered = open(r.id) || r.inbound > 0;
      if (covered) return;
      out.push({ pri: r.risk === 'CRITICAL' ? 1 : 2, icon: 'box-seam', title: `Replenish ${r.id} with ${r.suggest} packets`, why: `${esc(r.school.name)} has ${r.stock} packets against a monthly requirement of ${r.req}; ${r.pending} packets still owed to students this cycle. ${esc(DB.nodeName(dc))} holds ${U.num(Inv.total(dc))}.`,
        action: Auth.can('alloc.create') && Scope.owns(dc) ? { label: 'Create allocation', run: () => Alloc.create({ fromNode: dc, toNode: r.id, qty: r.suggest, type: 'MANUAL', remark: 'AI-recommended replenishment (reviewed by officer)' }) } : Auth.is('PRINCIPAL') ? { label: 'Raise request', link: 'allocations' } : null });
    });
    this.districtCover().filter(c => c.cover < 1.2 && c.suggest > 0 && !open('WH-' + c.district.id)).forEach(c => out.push({ pri: c.cover < 0.8 ? 1 : 2, icon: 'house-gear', title: `Send ${U.num(c.suggest)} packets to ${c.district.name} District`, why: `District + taluka stock of ${U.num(c.stock + c.dc)} covers only ${c.cover} month(s) of forecast demand (${U.num(c.demand)} / month).`,
      action: Auth.can('alloc.create') && Scope.owns('WH-CEN') ? { label: 'Create allocation', run: () => Alloc.create({ fromNode: 'WH-CEN', toNode: 'WH-' + c.district.id, qty: c.suggest, type: 'MANUAL', remark: 'AI-recommended district replenishment (reviewed by officer)' }) } : null }));
    Stock.alerts(Scope.nodes()).filter(a => a.type === 'EXPIRING_STOCK').slice(0, 3).forEach(a => out.push({ pri: 2, icon: 'calendar-x', title: 'Prioritise near-expiry batch (FEFO)', why: a.msg + ' Dispatch this batch first to avoid write-off.', action: { label: 'Open inventory', link: `inventory.html?node=${a.nodeId}`, raw: true } }));
    Stock.alerts(Scope.nodes()).filter(a => a.type === 'EXPIRED_STOCK').slice(0, 2).forEach(a => out.push({ pri: 1, icon: 'slash-circle', title: 'Quarantine and write off expired stock', why: a.msg, action: { label: 'Open inventory', link: `inventory.html?node=${a.nodeId}`, raw: true } }));
    if (Auth.is(...R_STATE, 'TRANSPORT_MGR')) {
      DB.d.vehicles.filter(v => U.daysBetween(new Date(), v.insuranceTill) <= 30 || U.daysBetween(new Date(), v.fitnessTill) <= 30).forEach(v => out.push({ pri: 3, icon: 'file-earmark-x', title: `Renew documents for ${v.regNo}`, why: `Insurance valid till ${U.fmtDate(v.insuranceTill)}, fitness till ${U.fmtDate(v.fitnessTill)}. Expired documents block dispatch.`, action: { label: 'Fleet', link: 'vehicles' } }));
      const un = DB.d.shipments.filter(s => ['APPROVED', 'READY_FOR_DISPATCH'].includes(s.status) && !s.vehicleId); if (un.length) out.push({ pri: 2, icon: 'truck', title: `Assign vehicles to ${un.length} waiting shipment(s)`, why: `${un.map(s => s.id).join(', ')} are approved but have no vehicle. ${DB.d.vehicles.filter(v => v.status === 'AVAILABLE').length} vehicle(s) are free.`, action: { label: 'Shipments', link: 'shipments' } });
    }
    const pend = DB.d.requests.filter(r => Alloc.canApprove(r)); if (pend.length) out.push({ pri: 2, icon: 'envelope-exclamation', title: `Decide ${pend.length} additional request(s)`, why: pend.map(r => `${r.id} (${r.schoolId}, ${r.qty} packets, raised ${U.daysBetween(r.date, new Date())} day(s) ago)`).join('; ') + '.', action: { label: 'Review', link: 'allocations' } });
    return out.sort((a, b) => a.pri - b.pri);
  },
  /* ---- Executive brief (narrative) ---- */
  summary() {
    const u = Auth.user(), risk = this.schoolRisk(), hi = risk.filter(r => r.prob >= 80), an = this.anomalies(), cov = Stats.coverage(Scope.schoolIds()), dl = Scope.shipments().filter(s => s.status === 'DELAYED');
    const out = [];
    if (!u.schoolId && !u.talukaId) { const f = this.forecast(Scope.districtIds(), 1); out.push(`<i class="bi bi-graph-up-arrow"></i> Demand is trending <strong>${f.growthPct >= 0 ? 'up' : 'down'} ${Math.abs(f.growthPct)}% per month</strong>; forecast for ${U.monthLabel(f.fc[0].month)} is <strong>${U.num(f.fc[0].v)} packets</strong> (${U.num(f.fc[0].lo)}–${U.num(f.fc[0].hi)}).`); }
    out.push(`<i class="bi bi-people"></i> Coverage this cycle is <strong>${cov.pct}%</strong> (${cov.served} of ${cov.eligible} registered eligible students served).`);
    out.push(hi.length ? `<i class="bi bi-exclamation-triangle"></i> <strong>${hi.length} school(s)</strong> are at high stock-out risk: ${hi.slice(0, 4).map(r => r.id).join(', ')}${hi.length > 4 ? '…' : ''}.` : `<i class="bi bi-shield-check"></i> No school is at high stock-out risk right now.`);
    if (dl.length || an.length) out.push(`<i class="bi bi-activity"></i> ${dl.length} delayed shipment(s) and <strong>${an.length} anomaly signal(s)</strong> need review.`);
    return out;
  },

  /* ---- Natural-language assistant (intent matching over scoped data) ---- */
  answer(q) {
    const u = Auth.user(), s = q.toLowerCase(), li = a => a.length ? `<ul>${a.map(x => `<li>${x}</li>`).join('')}</ul>` : '';
    if (u.role === 'STUDENT') {
      const st = DB.get('students', u.studentId), ent = Policy.entitlement(st), got = Policy.distributed(st.id, U.month());
      if (/history|past|previous/.test(s)) { const h = DB.d.distributions.filter(x => x.studentId === st.id).slice(-4).reverse(); return h.length ? 'Your recent distributions:' + li(h.map(x => `${U.monthLabel(x.cycle)} – ${x.qty} packet(s) on ${U.fmtDate(x.at)}`)) : 'No distribution is recorded for you yet.'; }
      if (/next|when|cycle/.test(s)) return `Your next distribution cycle is <strong>${U.monthLabel(U.addMonths(U.month(), 1))}</strong>. This month you have received ${got} of ${ent} packet(s).`;
      if (/qr|id|card/.test(s)) return `Your Student ID is <code>${st.id}</code>. Show the QR code on your portal at the school distribution desk — or simply tell your ID / roll number; a phone is not required.`;
      return `This month (${U.monthLabel(U.month())}) your entitlement is <strong>${ent}</strong> packet(s) and you have received <strong>${got}</strong>. Eligibility: ${st.eligibility.replace(/_/g, ' ').toLowerCase()}. You can ask me about your <em>history</em>, <em>next cycle</em> or <em>QR code</em>.`;
    }
    if (/help|what can you|कशी मदत/.test(s)) return 'I can answer questions about data in your jurisdiction, for example:' + li(['“Which schools are low on stock?”', '“Show delayed shipments”', '“Stock in Pune”', '“Forecast demand for next month”', '“Any anomalies?”', '“What should I do today?”', '“Coverage this month”']);
    if (/delay|late|विलंब|उशीर/.test(s)) { const l = Scope.shipments().filter(x => x.status === 'DELAYED'); return l.length ? `${l.length} shipment(s) are delayed:` + li(l.map(x => `<strong>${x.id}</strong> · ${DB.get('vehicles', x.vehicleId).regNo} · ${esc(DB.nodeName(x.fromNode))} → ${esc(DB.nodeName(x.toNode))} · ${Math.round(Ship.progress(x) * 100)}% of route`)) + '<a href="tracking.html">Open live tracking →</a>' : 'No shipments are delayed in your jurisdiction.'; }
    if (/anomal|unusual|suspicious|fraud|irregular/.test(s)) { const a = this.anomalies(); return a.length ? `I found ${a.length} anomaly signal(s):` + li(a.slice(0, 5).map(x => `<strong>${x.title}</strong> (${x.score}% confidence) – ${x.detail}`)) : 'No anomalies detected in your data scope.'; }
    if (/forecast|predict|demand|next month|अंदाज/.test(s)) { const f = this.forecast(Scope.districtIds()); return `Based on the last ${f.hist.length} months (trend ${f.growthPct >= 0 ? '+' : ''}${f.growthPct}% / month), projected demand is:` + li(f.fc.map(x => `<strong>${U.monthLabel(x.month)}</strong>: ${U.num(x.v)} packets (range ${U.num(x.lo)}–${U.num(x.hi)})`)) + '<small>Simple linear-trend model on demo aggregates.</small>'; }
    if (/recommend|suggest|what should|priorit|to.?do|today/.test(s)) { const r = this.recommendations(); return r.length ? 'Top recommended actions:' + li(r.slice(0, 5).map(x => `<strong>${x.title}</strong> – ${x.why}`)) + '<a href="ai-insights.html">Open AI Insights to act →</a>' : 'Nothing urgent – no recommendations right now.'; }
    if (/low\b.{0,8}stock|stock.?out|shortage|run out|कमी साठा/.test(s)) { const r = this.schoolRisk().filter(x => x.prob >= 48); return r.length ? `${r.length} school(s) need attention:` + li(r.slice(0, 8).map(x => `<strong>${x.id}</strong> ${esc(x.school.name)} – ${x.stock} in stock, needs ${x.req}/month · risk ${x.risk}`)) : 'All schools in your scope have sufficient stock.'; }
    if (/expir|कालबाह्य/.test(s)) { const a = Stock.alerts(Scope.nodes()).filter(x => x.type !== 'LOW_STOCK'); return a.length ? 'Expiry alerts:' + li(a.slice(0, 8).map(x => esc(x.msg))) : 'No batches are expired or expiring within 60 days.'; }
    if (/coverage|served|pending student|beneficiar|लाभार्थी/.test(s)) { const c = Stats.coverage(Scope.schoolIds()); return `Coverage for ${U.monthLabel(U.month())}: <strong>${c.pct}%</strong> – ${c.served} of ${c.eligible} registered eligible students have received their entitlement; ${c.eligible - c.served} pending.`; }
    if (/request/.test(s)) { const r = DB.d.requests.filter(x => Scope.schoolIds().includes(x.schoolId) && x.status.startsWith('PENDING')); return r.length ? `${r.length} additional request(s) pending:` + li(r.map(x => `<strong>${x.id}</strong> · ${x.schoolId} · ${x.qty} packets · ${x.status.replace(/_/g, ' ').toLowerCase()}`)) : 'No additional requests are pending.'; }
    if (/vehicle|truck|where|track|gps|वाहन/.test(s)) { const l = Scope.shipments().filter(x => Ship.ACTIVE.includes(x.status) && x.vehicleId); return l.length ? 'Vehicles on the road (simulated GPS):' + li(l.map(x => { const p = Ship.position(x); return `<strong>${DB.get('vehicles', x.vehicleId).regNo}</strong> · ${x.id} → ${esc(DB.nodeName(x.toNode))} · ${Math.round(p.progress * 100)}% · ${p.online ? p.speed + ' km/h' : 'GPS offline'}`; })) : 'No vehicles are on a trip right now.'; }
    if (/stock|inventory|साठा/.test(s)) {
      const nodes = Scope.nodes(), hit = nodes.filter(n => { const names = [n.name, n.id, n.districtId && DB.name('districts', n.districtId), n.talukaId && DB.name('talukas', n.talukaId)].filter(Boolean).map(x => x.toLowerCase()); return names.some(x => x.split(/[ ,]+/).some(w => w.length > 3 && s.includes(w)) || s.includes(x)); }).filter(n => n.type !== 'SCHOOL' || /sch-|school/.test(s));
      const list = hit.length ? hit : nodes.filter(n => Scope.owns(n.id)).slice(0, 6);
      return (hit.length ? 'Stock position:' : 'Stock at your locations:') + li(list.slice(0, 10).map(n => `<strong>${esc(n.name)}</strong>: ${U.num(Inv.total(n.id))} packets in ${Inv.batches(n.id).length} batch(es)`)) + (list.length ? '' : 'No stock locations found in your scope.');
    }
    if (/summary|brief|overview|status|how are we|सारांश/.test(s)) return this.summary().join('<br>');
    return 'I did not find a matching insight. Try “low stock schools”, “delayed shipments”, “forecast”, “anomalies”, “coverage” or “what should I do today?”.';
  },
  mountAssistant() {
    const u = Auth.user(); if (!u || $('#aiFab')) return;
    const chips = u.role === 'STUDENT' ? ['My status this month', 'When is my next cycle?', 'My history'] : ['What should I do today?', 'Low stock schools', 'Delayed shipments', 'Forecast demand', 'Any anomalies?'];
    document.body.insertAdjacentHTML('beforeend', `<button class="ai-fab" id="aiFab" aria-label="${t('c.assistant')}"><i class="bi bi-stars"></i><span>Ask Sakhi AI</span></button>
      <section class="ai-chat" id="aiChat" hidden aria-label="AI assistant"><header><div><i class="bi bi-stars"></i> <strong>${t('c.assistant')}</strong><small>Simulated AI · answers use only data in your jurisdiction</small></div><button class="btn-close btn-close-white" id="aiClose" aria-label="Close"></button></header>
      <div class="ai-msgs" id="aiMsgs"><div class="ai-m bot">Namaskar ${esc(u.name.split(' ')[0] === 'Dr.' ? u.name.split(' ')[1] : u.name.split(' ')[0])}! I am Sakhi, the MSDMS assistant. Ask me about stock, shipments, coverage, forecasts or risks.</div></div>
      <div class="ai-chips">${chips.map(c => `<button>${c}</button>`).join('')}</div>
      <form id="aiForm"><input class="form-control" id="aiQ" placeholder="Ask a question…" autocomplete="off" aria-label="Question"><button class="btn btn-saffron" aria-label="Send"><i class="bi bi-send-fill"></i></button></form></section>`);
    const box = $('#aiChat'), msgs = $('#aiMsgs');
    const ask = q => { if (!q.trim()) return; msgs.insertAdjacentHTML('beforeend', `<div class="ai-m me">${esc(q)}</div><div class="ai-m bot typing"><span></span><span></span><span></span></div>`); msgs.scrollTop = msgs.scrollHeight; AIService.ask(q).then(a => setTimeout(() => { $('.typing', msgs).outerHTML = `<div class="ai-m bot">${a}</div>`; msgs.scrollTop = msgs.scrollHeight; }, 450)); };
    $('#aiFab').onclick = () => { box.hidden = !box.hidden; if (!box.hidden) $('#aiQ').focus(); };
    $('#aiClose').onclick = () => box.hidden = true;
    $('#aiForm').onsubmit = e => { e.preventDefault(); ask($('#aiQ').value); $('#aiQ').value = ''; };
    $$('.ai-chips button').forEach(b => b.onclick = () => ask(b.textContent));
  }
};

/* ---------- Page: AI Insights ---------- */
let aiDistrict = '';
App.pages['ai-insights'] = root => {
  const u = Auth.user(), wide = !u.schoolId && !u.talukaId, risk = AI.schoolRisk(), an = AI.anomalies(), recs = AI.recommendations(), dr = AI.delayRisk(), dIds = Scope.districtIds();
  const fIds = aiDistrict && dIds.includes(aiDistrict) ? [aiDistrict] : dIds, f = AI.forecast(fIds), cover = AI.districtCover(), showSchools = u.role !== 'TRANSPORT_MGR' && !R_WH.includes(u.role);
  root.innerHTML = `<div class="sim-banner ai"><i class="bi bi-stars"></i> <strong>Simulated AI.</strong> Insights are produced in the browser by transparent statistical and rule-based models over fictional demo data. They support — never replace — officer decisions; every action still follows the normal approval workflow and audit trail.</div>` +
    UI.kpis([{ label: 'Schools at high stock-out risk', value: risk.filter(r => r.prob >= 80).length, icon: 'exclamation-triangle', tone: 'red' }, { label: 'Anomaly signals', value: an.length, icon: 'activity', tone: 'saffron' }, { label: 'Recommended actions', value: recs.length, icon: 'lightbulb', tone: 'blue' },
      { label: `Forecast · ${U.monthLabel(f.fc[0].month)}`, value: U.num(f.fc[0].v), icon: 'graph-up-arrow', tone: 'green', sub: `trend ${f.growthPct >= 0 ? '+' : ''}${f.growthPct}% / month` }, { label: 'Shipments at high delay risk', value: dr.filter(x => x.level === 'HIGH').length, icon: 'truck', tone: 'red' }], 'kpi-5') +
    `<div class="grid-2-1"><div>${UI.card('Executive brief', `<div class="ai-brief">${AI.summary().map(x => `<p>${x}</p>`).join('')}</div>`, { icon: 'stars', cls: 'ai-panel', tools: '<span class="ai-tag">Simulated AI</span>' })}
      ${UI.card('Smart recommendations', recs.length ? `<div class="rec-list">${recs.map((r, i) => `<div class="rec p${r.pri}"><div class="rec-ic"><i class="bi bi-${r.icon}"></i></div><div class="rec-b"><strong>${r.title}</strong><p>${r.why}</p></div>${r.action ? (r.action.run ? `<button class="btn btn-sm btn-primary" data-rec="${i}">${r.action.label}</button>` : `<a class="btn btn-sm btn-outline-primary" href="${r.action.raw ? r.action.link : r.action.link + '.html'}">${r.action.label}</a>`) : '<span class="sub">For information</span>'}</div>`).join('')}</div>` : UI.empty('No recommendations right now.', 'check2-circle'), { icon: 'lightbulb', flush: true })}</div>
      <div>${UI.card('Anomaly detection', an.length ? `<div class="alert-list">${an.map(a => `<a class="alert-row ${a.score >= 75 ? 'bad' : 'warn'}" href="${a.link}.html"><div class="score">${a.score}<small>%</small></div><div><strong>${a.title}</strong><span>${a.detail}</span><em>${a.cat}</em></div></a>`).join('')}</div>` : UI.empty('No anomalies detected.', 'shield-check'), { icon: 'activity', flush: true })}</div></div>` +
    (wide ? UI.card('Demand forecast (packets per month)', `<div class="filter-bar border-0 shadow-none p-0 mb-2"><label>District<select class="form-select form-select-sm" id="aiD"><option value="">All districts in scope</option>${DB.d.districts.filter(x => dIds.includes(x.id)).map(x => `<option value="${x.id}" ${x.id === aiDistrict ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label><div class="eng-sum">${f.fc.map(x => `<span>${U.monthLabel(x.month)} <b>${U.num(x.v)}</b></span>`).join('')}</div></div>${Dash.canvas('cFc', 280)}<p class="formula">Model: least-squares linear trend on the last ${f.hist.length} months; the shaded range is ±1.6 σ of residuals. Replace with an approved forecasting service via <code>AIService</code>.</p>`, { icon: 'graph-up-arrow' }) : '') +
    (showSchools ? UI.card('Stock-out risk prediction – schools', '<div id="aiRisk"></div>', { icon: 'box-seam' }) : '') +
    (cover.length && wide ? UI.card('District stock cover vs forecast demand', `<table class="table table-sm align-middle mb-0"><thead><tr><th>District</th><th class="text-end">District WH</th><th class="text-end">Taluka DCs</th><th class="text-end">In transit</th><th class="text-end">Forecast demand / month</th><th class="text-end">Cover (months)</th><th>Assessment</th></tr></thead><tbody>${cover.map(c => `<tr><td>${esc(c.district.name)}</td><td class="text-end">${U.num(c.stock)}</td><td class="text-end">${U.num(c.dc)}</td><td class="text-end">${U.num(c.inbound)}</td><td class="text-end">${U.num(c.demand)}</td><td class="text-end"><strong>${c.cover}</strong></td><td>${UI.badge(c.cover < 0.8 ? 'DELAYED' : c.cover < 1.2 ? 'PENDING' : 'ACTIVE', c.cover < 0.8 ? 'Replenish now' : c.cover < 1.2 ? 'Plan replenishment' : 'Adequate')}</td></tr>`).join('')}</tbody></table>`, { icon: 'house-gear', flush: true }) : '') +
    (dr.length ? UI.card('Shipment delay-risk scoring', '<div id="aiDr"></div>', { icon: 'truck' }) : '');
  $$('[data-rec]').forEach(b => b.onclick = () => { const r = recs[+b.dataset.rec]; UI.confirm('Apply AI recommendation', `<strong>${r.title}</strong><br><span class="text-muted small">${r.why}</span><br><br>This creates an approved allocation in your name. Continue?`, () => { try { const a = r.action.run(); Audit.log('AI Insights', 'APPLY_RECOMMENDATION', a.id, '', r.title, `Reviewed by ${u.name}`); App.commit(`Allocation ${a.id} created from AI recommendation.`); } catch (e) { UI.toast(e.message, 'error'); } }); });
  if ($('#aiD')) $('#aiD').onchange = e => { aiDistrict = e.target.value; App.refresh(); };
  if (wide) {
    const labels = f.hist.map(h => U.monthLabel(h.month)).concat(f.fc.map(x => U.monthLabel(x.month))), n = f.hist.length, pad = a => Array(n - 1).fill(null).concat(a);
    UI.chart('cFc', { type: 'line', data: { labels, datasets: [
      { label: 'Actual', data: f.hist.map(h => h.v), borderColor: PALETTE[0], backgroundColor: PALETTE[0], tension: .25 },
      { label: 'Forecast', data: pad([f.hist[n - 1].v, ...f.fc.map(x => x.v)]), borderColor: PALETTE[1], backgroundColor: PALETTE[1], borderDash: [6, 5], tension: .25 },
      { label: 'Upper range', data: pad([f.hist[n - 1].v, ...f.fc.map(x => x.hi)]), borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: 'rgba(214,31,69,.14)' },
      { label: 'Lower range', data: pad([f.hist[n - 1].v, ...f.fc.map(x => x.lo)]), borderColor: 'transparent', pointRadius: 0 }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { filter: i => !/range/.test(i.text) } } }, scales: { y: { beginAtZero: false }, x: { grid: { display: false } } } } });
  }
  if (showSchools) UI.table('#aiRisk', { id: 'airisk', rows: risk, exportName: 'ai-stockout-risk', pageSize: 8, filters: [{ key: 'risk', label: 'Risk', options: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] }],
    columns: [{ key: 'id', label: 'School', value: r => `${r.id} ${r.school.name}`, render: r => `<strong>${r.id}</strong><div class="sub" style="min-width:190px">${esc(r.school.name)}</div>` }, { label: 'Taluka', value: r => DB.name('talukas', r.school.talukaId) }, { key: 'stock', label: 'Stock', cls: 'text-end' }, { key: 'req', label: 'Monthly need', cls: 'text-end' }, { key: 'pending', label: 'Owed this cycle', cls: 'text-end' }, { key: 'inbound', label: 'Inbound', cls: 'text-end' }, { key: 'days', label: 'Days of cover', cls: 'text-end', render: r => r.days > 365 ? '365+' : r.days },
      { key: 'prob', label: 'Stock-out probability', render: r => `<div class="risk-bar"><i class="${r.prob >= 80 ? 'bad' : r.prob >= 40 ? 'warn' : 'ok'}" style="width:${r.prob}%"></i></div><div class="sub">${r.prob}%</div>` }, { key: 'risk', label: 'Risk', render: r => UI.badge({ CRITICAL: 'DELAYED', HIGH: 'DELAYED', MEDIUM: 'PENDING', LOW: 'ACTIVE' }[r.risk], r.risk) }, { key: 'suggest', label: 'Suggested top-up', cls: 'text-end', render: r => r.suggest ? `<strong>${r.suggest}</strong>` : '—' }] });
  if (dr.length) UI.table('#aiDr', { id: 'aidr', rows: dr, pageSize: 8, exportName: 'ai-delay-risk', filters: [{ key: 'level', label: 'Risk', options: ['HIGH', 'MEDIUM', 'LOW'] }],
    columns: [{ key: 'id', label: 'Shipment', render: r => `<strong>${r.id}</strong>` }, { label: 'Route', value: r => `${DB.nodeName(r.s.fromNode)} → ${DB.nodeName(r.s.toNode)}` }, { label: 'Status', value: r => r.s.status, render: r => UI.badge(r.s.status) }, { key: 'score', label: 'Delay risk', render: r => `<div class="risk-bar"><i class="${r.score >= 65 ? 'bad' : r.score >= 40 ? 'warn' : 'ok'}" style="width:${r.score}%"></i></div><div class="sub">${r.score}%</div>` }, { key: 'level', label: 'Level', render: r => UI.badge({ HIGH: 'DELAYED', MEDIUM: 'PENDING', LOW: 'ACTIVE' }[r.level], r.level) }, { key: 'why', label: 'Contributing factors' }] });
};
