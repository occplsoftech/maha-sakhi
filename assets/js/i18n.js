/* =====================================================================
   MSDMS · i18n.js
   Language-ready architecture. English is the prototype default; the
   Marathi dictionary below covers navigation and common labels and can be
   extended key-by-key without touching page code:  t('key')
   ===================================================================== */
'use strict';

const I18N = {
  en: {
    'app.name': 'Maharashtra Sanitary Distribution Management System', 'app.short': 'MSDMS',
    'nav.overview': 'Overview', 'nav.admin': 'Administration', 'nav.beneficiary': 'Beneficiaries',
    'nav.supply': 'Supply Chain', 'nav.transport': 'Transportation', 'nav.governance': 'Governance',
    'page.dashboard': 'Dashboard', 'page.student-portal': 'My Portal', 'page.ai-insights': 'AI Insights',
    'page.notifications': 'Notifications', 'page.districts': 'Geography & Masters', 'page.schools': 'Schools',
    'page.users': 'Users & Roles', 'page.students': 'Students', 'page.distribution': 'QR Distribution',
    'page.procurement': 'Procurement', 'page.warehouses': 'Warehouses', 'page.inventory': 'Inventory Ledger',
    'page.allocations': 'Allocations & Requests', 'page.vehicles': 'Vehicles & Drivers', 'page.tracking': 'Live Tracking',
    'page.shipments': 'Shipments', 'page.deliveries': 'Deliveries & GRN', 'page.reports': 'Reports', 'page.audit-logs': 'Audit Logs',
    'c.search': 'Search…', 'c.export': 'Export', 'c.logout': 'Sign out', 'c.reset': 'Reset demo data', 'c.guide': 'Demo Guide',
    'c.switch': 'Switch demo role', 'c.all': 'All', 'c.assistant': 'Sakhi AI Assistant'
  },
  mr: {
    'app.name': 'महाराष्ट्र सॅनिटरी वितरण व्यवस्थापन प्रणाली', 'app.short': 'MSDMS',
    'nav.overview': 'आढावा', 'nav.admin': 'प्रशासन', 'nav.beneficiary': 'लाभार्थी',
    'nav.supply': 'पुरवठा साखळी', 'nav.transport': 'वाहतूक', 'nav.governance': 'नियंत्रण',
    'page.dashboard': 'डॅशबोर्ड', 'page.student-portal': 'माझे पोर्टल', 'page.ai-insights': 'एआय विश्लेषण',
    'page.notifications': 'सूचना', 'page.districts': 'भौगोलिक मास्टर्स', 'page.schools': 'शाळा',
    'page.users': 'वापरकर्ते व भूमिका', 'page.students': 'विद्यार्थिनी', 'page.distribution': 'क्यूआर वितरण',
    'page.procurement': 'खरेदी', 'page.warehouses': 'गोदामे', 'page.inventory': 'साठा नोंदवही',
    'page.allocations': 'वाटप व मागणी', 'page.vehicles': 'वाहने व चालक', 'page.tracking': 'थेट ट्रॅकिंग',
    'page.shipments': 'पाठवणी', 'page.deliveries': 'पोच व जीआरएन', 'page.reports': 'अहवाल', 'page.audit-logs': 'ऑडिट नोंदी',
    'c.search': 'शोधा…', 'c.export': 'निर्यात', 'c.logout': 'बाहेर पडा', 'c.reset': 'डेमो डेटा रीसेट', 'c.guide': 'डेमो मार्गदर्शक',
    'c.switch': 'डेमो भूमिका बदला', 'c.all': 'सर्व', 'c.assistant': 'सखी एआय सहाय्यक'
  }
};
const Lang = {
  cur: localStorage.getItem('msdms_lang') || 'en',
  set(l) { this.cur = l; localStorage.setItem('msdms_lang', l); }
};
function t(key) { return (I18N[Lang.cur] && I18N[Lang.cur][key]) || I18N.en[key] || key; }
