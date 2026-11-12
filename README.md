# MSDMS – Maharashtra Sanitary Distribution Management System (Prototype)

Interactive HTML / CSS / JavaScript prototype of a state-scale sanitary pad supply-chain and
beneficiary management platform: central procurement → district warehouse → taluka distribution
centre → school → individual student, with end-to-end traceability.

> **Prototype only.** All records are fictional. This is not an official Government of Maharashtra
> service and uses no government emblems. GPS, identity verification and AI outputs are simulated.
> Demo sign-in (LocalStorage) is **not** production security. No Aadhaar data is collected or stored.

## Run

No build step. Open `index.html`, or serve the folder (recommended):

```bash
python3 -m http.server 8080
```

then browse to `http://localhost:8080`. All libraries are vendored in `assets/vendor`, so the
prototype works offline (only the OpenStreetMap background tiles need internet; an indicative
Maharashtra outline is drawn when tiles are unavailable).

## Demo logins (password `Demo@123`)

| Role | Email | Scope |
|---|---|---|
| State Super Admin | admin@msdms.demo | Maharashtra |
| State Officer | officer@msdms.demo | Maharashtra (read-only) |
| District Officer | district@msdms.demo | Pune district |
| Taluka Officer | taluka@msdms.demo | Haveli taluka |
| Central Warehouse Manager | warehouse@msdms.demo | State Central Warehouse |
| District Warehouse Manager | dwarehouse@msdms.demo | Pune District Warehouse |
| Taluka Warehouse Manager | twarehouse@msdms.demo | Haveli Taluka DC |
| Transport Manager | transport@msdms.demo | Fleet |
| Vehicle Driver | driver@msdms.demo | Own trips |
| School Principal | principal@msdms.demo | SCH-001 |
| School Employee | employee@msdms.demo | SCH-001 |
| Student / Beneficiary | student@msdms.demo | Own record |

The header has a **Demo Guide** (the 24-step end-to-end scenario with one-click role switching),
a quick role switcher in the user menu, an EN / मराठी toggle and **Reset demo data**.

## AI features ("Sakhi AI", simulated)

Everything runs in the browser with transparent statistical / rule-based models over the demo
data; nothing is sent to an external service. `AIService.ask()` in `assets/js/ai.js` is the
integration point for an approved AI/ML service.

- **Executive brief** on the State dashboard and AI Insights page
- **Demand forecasting** (linear trend with range) per district
- **Stock-out risk prediction** per school, and district stock cover vs forecast demand
- **Anomaly detection**: unusual adjustments, transit loss, off-hours distribution, idle stock, silent GPS
- **Smart recommendations** with one-click, audited actions (e.g. create a replenishment allocation)
- **Shipment delay-risk scoring** with contributing factors
- **Assistant** (floating button on every page): role- and jurisdiction-aware questions such as
  “Which schools are low on stock?”, “Show delayed shipments”, “What should I do today?”

## Structure

```
index.html                 redirect to pages/login.html
pages/*.html               one thin shell per screen (20 screens)
assets/css/                style.css (tokens, shell, components) · dashboard.css · responsive.css
assets/js/data.js          mock store (LocalStorage), seed data, inventory ledger, policy
assets/js/auth.js          demo auth, role permissions, geographic scoping
assets/js/i18n.js          language dictionary (English default, Marathi-ready)
assets/js/app.js           shell, reusable table / form / modal / document / export components
assets/js/dashboard.js     role-specific dashboards, alerts
assets/js/inventory.js     procurement, warehouses, inventory ledger
assets/js/transportation.js  shipments, simulated GPS, tracking map, deliveries & GRN, fleet
assets/js/masters.js       geography masters, schools, employees, users & roles
assets/js/students.js      beneficiary register, QR identity, student portal
assets/js/distribution.js  allocations, monthly engine, additional requests, QR distribution
assets/js/reports.js       reports, audit logs, notification centre
assets/js/ai.js            AI insights and assistant (simulated)
docs/screenshots/          captures of every screen
```

## What works

- Role-based navigation and permissions for 12 roles; district / taluka / school data isolation
- CRUD for masters, schools, employees, suppliers, vehicles, drivers, students, policy rules
- Procurement with QC → stock inward; batch-wise independent stock per location; unique
  transaction IDs; negative stock is rejected; adjustments, damage, expiry write-off, reconciliation
- Shipment lifecycle `CREATED → APPROVED → READY_FOR_DISPATCH → DISPATCHED → IN_TRANSIT →
  REACHED_DESTINATION → RECEIVED / PARTIALLY_RECEIVED` (+ `DELAYED`, `CANCELLED`), dispatch challan,
  transfer note, GRN, delivery receipt, discrepancy report
- Live tracking on a Leaflet map with simulated movement, GPS-loss simulation and two location sources
- Monthly allocation engine driven by a configurable entitlement policy; additional requests with
  configurable approval levels
- QR-based student distribution with eligibility / entitlement checks and duplicate prevention
- 25 reports with filters and Excel (CSV) / PDF (print) export; data-minimised beneficiary reports
- Notification centre and a centralised audit trail with old / new values

## Sample data

1 state · 3 divisions · 5 districts · 10 talukas · 20 villages · 20 schools · 1 central + 5 district
warehouses + 10 taluka distribution centres · 5 vehicles · 10 drivers · 20 school employees ·
100 students · 5 suppliers · 10 batches · 20 shipments · 30 distribution transactions.

## Design

Colour tokens and the Outfit typeface follow the OCCPL e-commerce portal theme (crimson + indigo
on light grey). Tokens live at the top of `assets/css/style.css`.
