# Praxis LS — Phase → Module Map (complete, nothing left out)

Every MOD-xx from the platform catalogue, mapped to the phase(s) it belongs to.
Modules that legitimately span phases are **listed in each** (marked ↔). Status:
✅ built real · 🟡 partial/real-but-thin · ⬜ generic CRUD stub · 🧩 schema only.
(Derived from `WORK_TO_BE_DONE.md` phases + the KB + the MOD catalogue. Group in
parentheses.) Last refresh: after Phase-1/2 gap-closure sprint (see
`PHASE1_2_REAUDIT.md`).

---

## Phase 0 — Foundations (multi-tenancy, security, engines)
- MOD-67 IAM / RBAC engine (security) ✅
- MOD-68 Session Management (security) ✅
- MOD-69 Immutable Ledger / audit (security) ✅
- MOD-70 Settings (security) ✅  ↔ P2 (numbering/business rules), P4 (full hub)
- MOD-00A Dashboard & My Workspace (dashboard) ⬜  ↔ P4 (chat-on-dashboards)
- MOD-00B God Mode CEO purge console (dashboard) ✅  ↔ P5 (hardening)
- Universal Event Engine / workflow (workflow) ✅  — event types, workflows, steps, executor, approvals
- Watch-the-Watcher / notifications (notification) 🟡
- White-label branding (branding) ✅
- Module catalogue / feature projection (catalogue, platform) ✅
- Shared infra: numbering, document capture, storage, worker runtime ✅ (built during P1)

## Phase 1 — Accounting spine  — ✅ COMPLETE
- MOD-06 Chart of Accounts (master) ✅  — hierarchical, postable-leaf, no-delete-if-referenced
- MOD-05 Financial Dictionary (master) ✅  (+ posting_rule / account determination)
- MOD-07 Tax Jurisdiction + Tax Center outputs (master/finance) ✅ (tax_declaration)
- MOD-09 Treasury Accounts (master) ✅  — class-5 mapping + MoMo, activate/deactivate
- MOD-55 Journal Entries (OHADA) (finance) ✅  — posting engine + reversal
- MOD-56 General Ledger (finance) ✅  (trial balance + grand livre per-account movements)
- MOD-57 Income Statement (finance) ✅  (statements service)
- MOD-58 Profit & Loss (finance) ✅  (= Compte de résultat, incl. class 8)
- MOD-59 Cash-Flow / TAFIRE (finance) ✅  — OHADA operating/investing/financing sectioning
- MOD-50 Proforma & Advance Invoices (finance) ✅  ↔ P2 (bind to dossier)
- MOD-51 Final Invoice (finance) ✅  ↔ P2 (bind to dossier/costing)
- MOD-49 Project Disbursal / régie d'avance (costing) ✅  ↔ P2 (cash_request document)
- MOD-64 File Repository Vault (vault) ✅  ↔ P4 (data room)
- MOD-66 Document Verification / QR (vault) ✅  — hash+token, gated /verify + public /scan
- PDF worker + Email/SMTP (services) 🟡 (code built; runtime needs Chromium/SMTP — infra)

## Phase 2 — Commercial cycle  — ✅ COMPLETE
- MOD-01 Corporate Entities (master) ✅  — unique code, NIU/RCCM, fiscal year, doc prefix
- MOD-02 Human Capital / Employees (master) ⬜  ↔ P3 (HR)
- MOD-03 Client Master (master) ✅  (KYC, credit limit, withholding)
- MOD-04 Supplier / Partner Master (master) ✅  (mobile money, non-resident SIT)
- MOD-08 Currency & Live FX (master) ✅  (resolver + fx-sync worker)
- MOD-10 Expense Rates (master) ✅  — effective-dated rate cards + resolver
- MOD-29 Operations File Registry / dossier (operations) ✅  (+ 360° aggregation view)
- MOD-30 Transit Order (operations) ✅  — numbered + captured
- MOD-31 Operational Milestone Tracking (operations) ✅
- MOD-32 Delivery Note (operations) ✅  — numbered + captured
- MOD-46 Project Costing (costing) ✅
- MOD-47 Cost Tracking (costing) ✅
- MOD-48 Project Cost Reconciliation (costing) ✅ (in cost_tracking)
- MOD-49 Project Disbursal / cash request (costing) ✅  ↔ P1  — lifecycle wires to régie
- MOD-27 Margin Simulator (commercial) ✅  ↔ P4 (Pricing Variance Index)
- MOD-28 Extra-Charges / Demurrage Simulator (commercial) ✅
- MOD-50 Proforma & Advance Invoices (finance) ✅  ↔ P1
- MOD-51 Final Invoice (finance) ✅  ↔ P1
- MOD-52 Smart Receivables Ledger (finance) ✅  — receipt→FIFO alloc, ageing, dunning
- MOD-53 Project Financing / debt (finance) ✅  — drawdown/repay→GL (feature finance.debt, off by default)
- MOD-60 Purchase Orders (procurement) ✅  — items, lock, numbering
- MOD-61 Goods Received + Supplier Invoice (procurement) ✅  — 3-way match → GL
- MOD-62 Purchase Requests (procurement) ✅  — requisition lifecycle
- Sales cycle feeding operations ✅ (built): MOD-20 Leads (→ convert to client),
  MOD-21 Meetings (notes/minutes + transcript link), MOD-22 Marketing Campaigns
  (+ newsletter), MOD-23 Proposal Generator (lines/narrative → accept→quotation),
  MOD-24 Sales Pipeline (Kanban board, win→dossier), MOD-25 Inbound Intake
  (enquiry/partnership → triage→lead), MOD-26 Project Portfolio / success stories
  (sign-off→publish). All gated + .ai.js.

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
- MOD-54 Asset Management (finance) 🧩  (acquisition→depreciation auto-post→disposal, KB §11 — tables exist, module pending)

## Phase 4 — Intelligence & reach  (kickoff: see PHASE4_KICKOFF.md)
- AI service layer (ai): orchestrator/retrieval/ingest/llm/embeddings/redact ✅ scaffolded; `assistant` ✅ thin surface; `governance` ✅ **rebuilt real** (EMV toggle, grants, spend caps, encrypted vendor keys, canUseFeature guard). Foreign `insights` removed — MOD-63 to rebuild real. All 32 modules ship `.ai.js` manifests.
- MOD-63 Reporting & Insights (vault) ✅ — report registry (income statement, receivables ageing, cash position, dossier margin, procurement spend, TAFIRE, dossier 360) delegating to owning services; saved reports + dashboard tiles; .ai.js reads power chat-on-dashboards
- MOD-27 Pricing Variance Index — Sales R/Y/G view (commercial) ✅  ↔ P2 — margin% quote vs actual cost, R/Y/G from tenant thresholds; Sales view strips raw cost (finance boundary), compute gated on MOD-56
- MOD-65 Compliance Checker (vault) ✅ — rule scans (missing proof, unmatched procurement, aged régie, débours-tax) → compliance_flag (INFO/WARN/RED), idempotent re-run, .ai.js reads
- MOD-66 Document Verification / QR — public scan (vault) ✅  ↔ P1
- MOD-70 Settings — full config hub (security) 🟡  ↔ P0/P2
- Portals (new): `portal` module ✅ — portal_access grant/revoke (time-boxed
  auditor), + scoped Client (dossiers/invoices/ageing), Investor (income+cash),
  Auditor (data room) views delegating to owning services; feature-gated
  portal.client/investor/audit. External magic-link auth = follow-up.
- Smart Comms Portal (smartcomm) ✅ — groups + messages + SHA-256 certified
  export captured to vault (verifiable via MOD-66); real-time WS = runtime layer.
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

## Phase-1 & Phase-2 status — all module gaps CLOSED
Every module belonging to Phase 1 and Phase 2 is now a real module (custom
service + repo + pure rules + gated routes + validator), not a generic CRUD
stub. The gap-closure sprint upgraded: MOD-06, MOD-09, MOD-01, MOD-10, MOD-27,
MOD-28, MOD-30, MOD-32, MOD-49, MOD-52, MOD-53, MOD-56 (grand livre), MOD-59
(TAFIRE), MOD-60/61/62, MOD-66 (scan) and added the dossier 360° view.

Remaining non-blocking items that touch P1/P2 surfaces (tracked to later phases):
- PDF/Email runtime (Chromium + SMTP) — code complete, infra provisioning is P5.
- MOD-54 Asset Management — schema present, module is Phase 3.
- MOD-27 Pricing Variance Index (Sales R/Y/G) — the *simulator* is done (P2);
  the sales-facing variance index is Phase 4.
- Sales cycle MOD-20..26 — Phase 4.
