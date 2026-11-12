/* =====================================================================
   MSDMS · auth.js
   DEMO-ONLY authentication, role-based access control and geographic
   scoping. LocalStorage sessions are NOT production security – a real
   deployment needs server-side authentication (SSO / OTP / MFA).
   ===================================================================== */
'use strict';

const SESSION_KEY = 'msdms_session';
const DEMO_PASSWORD = 'Demo@123';

const R_STATE = ['STATE_ADMIN', 'STATE_OFFICER'];
const R_GEO = ['DISTRICT_OFFICER', 'TALUKA_OFFICER'];
const R_WH = ['CENTRAL_WH', 'DISTRICT_WH', 'TALUKA_WH'];

/* Navigation + page-level permissions (single source of truth) */
const NAV = [
  { section: 'nav.overview', items: [
    { page: 'dashboard', icon: 'speedometer2', roles: Object.keys(ROLES).filter(r => r !== 'STUDENT') },
    { page: 'student-portal', icon: 'person-badge', roles: ['STUDENT'] },
    { page: 'ai-insights', icon: 'stars', roles: [...R_STATE, ...R_GEO, ...R_WH, 'TRANSPORT_MGR', 'PRINCIPAL'], ai: true },
    { page: 'notifications', icon: 'bell', roles: Object.keys(ROLES) }] },
  { section: 'nav.admin', items: [
    { page: 'districts', icon: 'geo-alt', roles: [...R_STATE, ...R_GEO] },
    { page: 'schools', icon: 'building', roles: [...R_STATE, ...R_GEO, 'PRINCIPAL'] },
    { page: 'users', icon: 'shield-lock', roles: R_STATE }] },
  { section: 'nav.beneficiary', items: [
    { page: 'students', icon: 'people', roles: [...R_STATE, ...R_GEO, 'PRINCIPAL', 'EMPLOYEE'] },
    { page: 'distribution', icon: 'qr-code-scan', roles: ['PRINCIPAL', 'EMPLOYEE'] }] },
  { section: 'nav.supply', items: [
    { page: 'procurement', icon: 'cart-check', roles: [...R_STATE, 'CENTRAL_WH'] },
    { page: 'warehouses', icon: 'house-gear', roles: [...R_STATE, ...R_GEO, ...R_WH] },
    { page: 'inventory', icon: 'box-seam', roles: [...R_STATE, ...R_GEO, ...R_WH, 'PRINCIPAL', 'EMPLOYEE'] },
    { page: 'allocations', icon: 'diagram-3', roles: [...R_STATE, ...R_GEO, ...R_WH, 'PRINCIPAL'] }] },
  { section: 'nav.transport', items: [
    { page: 'vehicles', icon: 'truck', roles: [...R_STATE, 'TRANSPORT_MGR'] },
    { page: 'tracking', icon: 'broadcast-pin', roles: [...R_STATE, ...R_GEO, ...R_WH, 'TRANSPORT_MGR', 'DRIVER'] },
    { page: 'shipments', icon: 'send-check', roles: [...R_STATE, ...R_GEO, ...R_WH, 'TRANSPORT_MGR', 'DRIVER', 'PRINCIPAL'] },
    { page: 'deliveries', icon: 'clipboard-check', roles: ['STATE_ADMIN', ...R_GEO, 'DISTRICT_WH', 'TALUKA_WH', 'PRINCIPAL', 'EMPLOYEE'] }] },
  { section: 'nav.governance', items: [
    { page: 'reports', icon: 'file-earmark-bar-graph', roles: [...R_STATE, ...R_GEO, ...R_WH, 'TRANSPORT_MGR', 'PRINCIPAL'] },
    { page: 'audit-logs', icon: 'journal-text', roles: [...R_STATE, 'DISTRICT_OFFICER', 'PRINCIPAL'] }] }
];

/* Action-level permissions */
const CAPS = {
  'master.edit': ['STATE_ADMIN'],
  'school.edit': ['STATE_ADMIN', 'DISTRICT_OFFICER', 'TALUKA_OFFICER'],
  'school.profile': ['PRINCIPAL'],
  'emp.manage': ['STATE_ADMIN', 'PRINCIPAL'],
  'student.edit': ['STATE_ADMIN', 'PRINCIPAL'],
  'proc.manage': ['STATE_ADMIN', 'CENTRAL_WH'],
  'stock.manage': ['STATE_ADMIN', ...R_WH, ...R_GEO, 'PRINCIPAL', 'EMPLOYEE'],
  'ship.create': ['STATE_ADMIN', ...R_WH, ...R_GEO],
  'ship.transport': ['STATE_ADMIN', 'TRANSPORT_MGR'],
  'veh.manage': ['STATE_ADMIN', 'TRANSPORT_MGR'],
  'alloc.create': ['STATE_ADMIN', ...R_GEO],
  'policy.edit': ['STATE_ADMIN'],
  'req.raise': ['PRINCIPAL'],
  'req.approve': ['STATE_ADMIN', ...R_GEO],
  'dist.perform': ['PRINCIPAL', 'EMPLOYEE'],
  'data.reset': Object.keys(ROLES)
};

const Auth = {
  _u: null,
  user() {
    if (this._u) return this._u;
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s) return null;
      const idle = (Date.now() - s.last) / 60000;
      if (idle > (DB.load().settings.sessionMinutes || 30)) { localStorage.removeItem(SESSION_KEY); sessionStorage.setItem('msdms_expired', '1'); return null; }
      this._u = DB.load().users.find(u => u.id === s.userId) || null;
      if (this._u) DB.actor = { id: this._u.id, name: this._u.name, role: this._u.role };
      return this._u;
    } catch (e) { return null; }
  },
  touch() { const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); if (s) { s.last = Date.now(); localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } },
  login(email, password) {
    const u = DB.load().users.find(x => x.email.toLowerCase() === String(email).trim().toLowerCase());
    if (!u || password !== DEMO_PASSWORD) return null;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: u.id, last: Date.now() }));
    this._u = u; DB.actor = { id: u.id, name: u.name, role: u.role };
    Audit.log('Authentication', 'LOGIN', u.id, '', 'Demo login'); DB.save();
    return u;
  },
  logout() {
    if (this._u) { Audit.log('Authentication', 'LOGOUT', this._u.id); DB.save(); }
    localStorage.removeItem(SESSION_KEY); this._u = null;
  },
  home(u = this.user()) { return u && u.role === 'STUDENT' ? 'student-portal.html' : 'dashboard.html'; },
  can(cap) { const u = this.user(); return !!u && (CAPS[cap] || []).includes(u.role); },
  canPage(page) { const u = this.user(); return !!u && NAV.some(s => s.items.some(i => i.page === page && i.roles.includes(u.role))); },
  is(...roles) { const u = this.user(); return !!u && roles.includes(u.role); },
  isState() { return this.is(...R_STATE); }
};

/* Geographic / organisational data scope for the logged-in user */
const Scope = {
  districtIds() {
    const u = Auth.user(), all = DB.d.districts.map(x => x.id);
    if (Auth.is(...R_STATE, 'CENTRAL_WH', 'TRANSPORT_MGR', 'DRIVER')) return all;
    return u.districtId ? [u.districtId] : [];
  },
  talukaIds() {
    const u = Auth.user();
    if (u.talukaId) return [u.talukaId];
    const ds = this.districtIds(); return DB.d.talukas.filter(t => ds.includes(t.districtId)).map(t => t.id);
  },
  schools() {
    const u = Auth.user();
    if (u.schoolId) return DB.d.schools.filter(s => s.id === u.schoolId);
    const ts = this.talukaIds(); return DB.d.schools.filter(s => ts.includes(s.talukaId));
  },
  schoolIds() { return this.schools().map(s => s.id); },
  students() {
    const u = Auth.user();
    if (u.role === 'STUDENT') return DB.d.students.filter(s => s.id === u.studentId);
    const ids = this.schoolIds(); return DB.d.students.filter(s => ids.includes(s.schoolId));
  },
  /* Nodes whose stock the user may VIEW */
  nodes() {
    const u = Auth.user(), N = DB.d.nodes;
    if (Auth.is(...R_STATE, 'TRANSPORT_MGR')) return N;
    if (u.role === 'CENTRAL_WH') return N.filter(n => n.type === 'CENTRAL' || n.type === 'DISTRICT');
    if (u.schoolId) return N.filter(n => n.id === u.schoolId);
    if (u.talukaId) return N.filter(n => n.talukaId === u.talukaId);
    if (u.districtId) return N.filter(n => n.districtId === u.districtId);
    return [];
  },
  nodeIds() { return this.nodes().map(n => n.id); },
  /* Nodes the user OPERATES (may dispatch from / receive at / adjust) */
  ownNodeIds() {
    const u = Auth.user();
    switch (u.role) {
      case 'STATE_ADMIN': return DB.d.nodes.map(n => n.id);
      case 'CENTRAL_WH': return ['WH-CEN'];
      case 'DISTRICT_OFFICER': case 'DISTRICT_WH': return [`WH-${u.districtId}`];
      case 'TALUKA_OFFICER': case 'TALUKA_WH': return [`DC-${u.talukaId}`];
      case 'PRINCIPAL': case 'EMPLOYEE': return [u.schoolId];
      default: return [];
    }
  },
  owns(nodeId) { return this.ownNodeIds().includes(nodeId); },
  shipments() {
    const u = Auth.user(), S = DB.d.shipments;
    if (Auth.is(...R_STATE, 'TRANSPORT_MGR')) return S;
    if (u.role === 'DRIVER') return S.filter(s => s.driverId === u.driverId);
    if (u.role === 'CENTRAL_WH') return S.filter(s => s.fromNode === 'WH-CEN' || s.toNode === 'WH-CEN');
    const ids = this.nodeIds(); return S.filter(s => ids.includes(s.fromNode) || ids.includes(s.toNode));
  },
  notifications() {
    const u = Auth.user(), ids = Auth.is(...R_STATE) ? null : this.nodeIds();
    return DB.d.notifications.filter(n => {
      if (u.role === 'STUDENT') return n.studentId === u.studentId;
      if (n.studentId) return false;
      if (u.role === 'DRIVER') return n.roles.includes('DRIVER');
      if (!ids) return true;
      if (u.role === 'TRANSPORT_MGR') return /VEHICLE|DISPATCH|DELIVERY/.test(n.event);
      return n.nodes.some(x => ids.includes(x) || Scope.owns(x));
    }).slice().reverse();
  },
  employeePerm(p) {
    const u = Auth.user(); if (u.role !== 'EMPLOYEE') return true;
    const e = DB.get('employees', u.employeeId); return !!(e && e.active && e.perms[p]);
  }
};
