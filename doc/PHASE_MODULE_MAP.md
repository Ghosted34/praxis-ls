# Praxis LS — Phase → Module Map (complete, nothing left out)

Every MOD-xx from the platform catalogue, mapped to the phase(s) it belongs to.
Modules that legitimately span phases are **listed in each** (marked ↔). Status:
✅ built real · 🟡 partial/real-but-thin · ⬜ generic CRUD stub · 🧩 schema only.
(Derived from `WORK_TO_BE_DONE.md` phases + the KB + the MOD catalogue. Group in
parentheses.)

---

## Phase 0 — Foundations (multi-tenancy, security, engines)
- MOD-67 IAM / RBAC engine (security) ✅
- MOD-68 Session Management (security) ✅
- MOD-69 Immutable Ledger / audit (security) ✅
- MOD-70 Settings (security) 🟡  ↔ P2 (numbering/business rules), P4 (full hub)
- MOD-00A Dashboard & My Workspace (dashboard) ⬜  ↔ P4 (chat-on-dashboards)
- MOD-00B God Mode CEO purge console (dashboard) ✅  ↔ P5 (hardening)
- Universal Event Engine / workflow (workflow) ✅  — event types, workflows, steps, executor, approvals
- Watch-the-Watcher / notifications (notification) 🟡
- White-label branding (branding) ✅
- Module catalogue / feature projection (catalogue, platform) ✅
- Shared infra: numbering, document capture, storage, worker runtime ✅ (built during P1)

## Phase 1 — Accounting spine
- MOD-06 Chart of Accounts (master) ⬜ **seed done, module still generic — GAP**
- MOD-05 Financial Dictionary (master) ✅  (+ posting_rule / account determination)
- MOD-07 Tax Jurisdiction + Tax Center outputs (master/finance) ✅ (tax_declaration)
- MOD-09 Treasury Accounts (master) ⬜  ↔ P2 (treasury used by invoicing/costing)
- MOD-55 Journal Entries (OHADA) (finance) ✅  — posting engine + reversal
- MOD-56 General Ledger (finance) 🟡  (trial balance built; grand-livre view pending)
- MOD-57 Income Statement (finance) ✅  (statements service)
- MOD-58 Profit & Loss (finance) ✅  (= Compte de résultat, incl. class 8)
- MOD-59 Cash-Flow / TAFIRE (finance) ⬜ **TAFIRE not built — GAP** (statements module = MOD-59 key but TAFIRE pending)
- MOD-50 Proforma & Advance Invoices (finance) ✅  ↔ P2 (bind to dossier)
- MOD-51 Final Invoice (finance) ✅  ↔ P2 (bind to dossier/costing)
- MOD-49 Project Disbursal / régie d'avance (costing) ✅  ↔ P2 (project cycle)
- MOD-64 File Repository Vault (vault) ✅  ↔ P4 (data room)
- MOD-66 Document Verification / QR (vault) 🟡 (hash+token built; scan endpoint pending)
- PDF worker + Email/SMTP (services) 🟡 (services built; runtime needs Chromium/SMTP)

## Phase 2 — Commercial cycle
- MOD-01 Corporate Entities (master) ⬜
- MOD-02 Human Capital / Employees (master) ⬜  ↔ P3 (HR)
- MOD-03 Client Master (master) ✅  (KYC, credit limit, withholding)
- MOD-04 Supplier / Partner Master (master) ✅  (mobile money, non-resident SIT)
- MOD-08 Currency & Live FX (master) ✅  (resolver + fx-sync worker)
- MOD-10 Expense Rates (master) ⬜
- MOD-29 Operations File Registry / dossier (operations) ✅
- MOD-30 Transit Order (operations) ⬜
- MOD-31 Operational Milestone Tracking (operations) ✅
- MOD-32 Delivery Note (operations) ⬜
- MOD-46 Project Costing (costing) ✅
- MOD-47 Cost Tracking (costing) ✅
- MOD-48 Project Cost Reconciliation (costing) ✅ (in cost_tracking)
- MOD-49 Project Disbursal (costing) ✅  ↔ P1
- MOD-27 Margin Simulator (commercial) ⬜  ↔ P4 (Pricing Variance Index)
- MOD-28 Extra-Charges Engine Simulator (commercial) ⬜
- MOD-50 Proforma & Advance Invoices (finance) ✅  ↔ P1
- MOD-51 Final Invoice (finance) ✅  ↔ P1
- MOD-52 Smart Receivables Ledger (finance) ⬜
- MOD-53 Project Financing / debt (finance) ⬜ (optional, finance.debt off by default)
- MOD-60 Purchase Orders (procurement) ⬜
- MOD-61 Goods Received (procurement) ⬜
- MOD-62 Purchase Requests (procurement) ⬜
- Sales cycle feeding operations (may be P2 or P4): MOD-20 Leads, MOD-21 Meetings,
  MOD-22 Marketing Campaigns, MOD-23 Proposal Generator, MOD-24 Sales Pipeline,
  MOD-25 Inbound Intake, MOD-26 Project Portfolio (sales) ⬜

## Phase 3 — People & assets
- MOD-02 Employees (master) ⬜  ↔ P2
- MOD-11 Vacancies (hr) ⬜
- MOD-12 Legal Contracts (hr) ⬜
- MOD-13 KPI Appraisals (hr) ⬜
- MOD-14 Attendance (hr) ⬜
- MOD-15 Leave & Allowances (hr) ⬜
- MOD-16 SOPs & Onboarding (hr) ⬜
- MOD-17 Pay Slips / Payroll (hr) ⬜  (CNPS/IRPP/CAC/CFC/RAV auto-compute, KB §9)
- MOD-18 Trainings (hr) ⬜
- MOD-19 Talent Pool / Succession (hr) ⬜
- MOD-33 Inbound Operations (wms) ⬜
- MOD-34 Space & Location Management (wms) ⬜
- MOD-35 Inventory Control & Tracking (wms) ⬜
- MOD-36 Outbound Operations (wms) ⬜
- MOD-37 Equipment Handling (wms) ⬜
- MOD-38 Audit & Cycle Counting (wms) ⬜
- MOD-39 Vehicle / Asset Registry (fleet) ⬜
- MOD-40 Compliance & Periodic Expenses (fleet) ⬜
- MOD-41 Maintenance & Work Orders (fleet) ⬜
- MOD-42 Dispatch & Allocation (fleet) ⬜
- MOD-43 Fuel & Usage Tracking (fleet) ⬜  (fuel posts to dossier cost, KB §8.7)
- MOD-44 Driver Management (fleet) ⬜
- MOD-45 Incident & Claim Management (fleet) ⬜
- MOD-54 Asset Management (finance) ⬜  (acquisition→depreciation auto-post→disposal, KB §11)

## Phase 4 — Intelligence & reach
- AI service layer (ai): assistant, governance, insights + orchestrator/RAG/actions 🟡 (scaffolds; AI-readiness rules in place)
- MOD-63 Reporting & Insights (vault) ⬜
- MOD-27 Pricing Variance Index — Sales R/Y/G view (commercial) ⬜  ↔ P2
- MOD-65 Compliance Checker (vault) ⬜
- MOD-66 Document Verification / QR — public scan (vault) 🟡  ↔ P1
- MOD-70 Settings — full config hub (security) 🟡  ↔ P0/P2
- Portals (new): Client Portal (↔ MOD-29), Investor/Board terminal (↔ MOD-56),
  Audit Terminal / data room (↔ MOD-64) ⬜
- Smart Comms Portal (smartcomm): WebSocket messaging, groups, certified export ⬜
- Support & Feedback dashboard ⬜

## Phase 5 — Hardening & migration (cross-cutting; touches all modules)
- Security: dependency + secret scanning in CI, pen-test, OWASP ASVS L2 — all modules
- Performance: load test, p95 < 400ms — all read paths
- Backup/DR: encrypted daily backups + PITR — platform + every tenant DB
- Data migration: MySQL → PostgreSQL, reconciliation, sign-off — master + finance data
- Go-live: MOD-00B God Mode, Test/Live toggle hidden, MOD-69 audit — platform/security

---

## Cross-phase modules (listed in >1 phase above)
- MOD-70 Settings — P0, P2, P4
- MOD-00A Dashboard — P0, P4
- MOD-00B God Mode — P0, P5
- MOD-49 Project Disbursal — P1, P2
- MOD-50 Proforma & Advance — P1, P2
- MOD-51 Final Invoice — P1, P2
- MOD-09 Treasury Accounts — P1, P2
- MOD-64 Vault — P1, P4
- MOD-66 QR Verification — P1, P4
- MOD-02 Employees — P2, P3
- MOD-27 Margin Simulator / Pricing Variance — P2, P4

## Known Phase-1 gaps surfaced by this map (to close)
- **MOD-06 Chart of Accounts** — seeded but module is generic CRUD; build the real
  hierarchical, is_postable-aware module (no-delete-if-referenced).
- **MOD-59 TAFIRE** — statutory cash-flow statement not built (only trial
  balance/Bilan/CR).
- **MOD-56 grand livre** (per-account movement listing) — only trial balance today.
- **MOD-66 public QR scan/verify endpoint** — hash+token exist; the resolve-and-
  re-check endpoint is pending.
