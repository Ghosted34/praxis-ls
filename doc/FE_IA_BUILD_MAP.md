# Praxis LS — FE Build Map & AI-Integration Map

_Prepared 2026-07-15. Companion to `doc/FE_IA_HANDOFF.md` (the module→IA mapping) and
`doc/SESSION_HANDOFF.md` (session history). This doc is the **work-to-be-done** view: every
screen that is scaffolded but not yet wired to the backend, its intended pages/tabs/columns/
actions (for design / Pixie inspiration), and the **AI-integration map** — every place the AI
model can be invoked._

Machine-readable source of truth for this map: `client/src/features/scaffold/screen-specs.ts`
(rendered by `ScreenScaffold` / `<Planned/>`). Editing that file updates the running app; keep
this doc in step with it.

---

## How the scaffolds work

Every un-built route now renders a **finished skeleton** instead of the old generic "Coming
soon" card. The skeleton shows the real intended structure — header + primary action buttons,
tabs, the planned table columns, an "awaiting backend integration" state, and the **AI actions**
that apply on that screen. This makes the whole IA reviewable end-to-end before any data is
wired, and gives design a concrete surface to pull inspiration onto.

- Component: `client/src/features/scaffold/screen-scaffold.tsx`
- Catalogue: `client/src/features/scaffold/screen-specs.ts`
- Routing: `client/src/app/app.tsx` points every un-built route at `<Planned/>`, which resolves
  the current path to its spec.

### Backend-status legend

| Badge | Meaning |
|---|---|
| **ready** | Backend endpoints exist and are verified — screen just needs FE wiring. |
| **partial** | Some endpoints exist (e.g. list/create) but the flow isn't complete. |
| **readonly** | Backend is read-only today (no create/update/delete). |
| **none** | No backend endpoint yet — BE dev must build it. |

### AI-action legend

| Kind | Meaning |
|---|---|
| **read** | The assistant can query this screen's data (no side effects). |
| **write** | The assistant can perform an action here (human-confirmed). |
| **assist** | An LLM-generative / inference step — draft, triage, reconcile, verify, search. |

---

## 1. Work to be done — screens, pages & tabs

Grouped by menu area. "Tabs" are pages-within-a-screen; "Columns" are the planned table/list
structure; "Actions" are the primary buttons.

### Overview

| Screen | Route | BE | Tabs | Key columns / actions |
|---|---|---|---|---|
| My Workspace | `/workspace` | readonly | My tasks · My approvals · Recent | Item/Type/Due/Status; approvals queue |
| Godmode Console | `/godmode` | none | — | Tenant/Plan/Status/Capacity · Provision tenant (superadmin only) |

### Commercial

| Screen | Route | BE | Tabs | Key columns / actions |
|---|---|---|---|---|
| **Quotations** ✅ BUILT (session 6) | `/commercial/quotations` | ready | — | ⚠️ **feature-gated `commercial.quotation`** (shows an "enable it" empty state when off). List + filter chips; detail modal (line table + HT/TTC totals); create/edit draft with line editor (label/qty/unit price/**débours**); lifecycle DRAFT→SENT (entity-numbered)→ACCEPTED (opt. convert→final-invoice draft)/REJECTED/EXPIRED. VAT computed server-side. |
| **Margin simulation** ✅ BUILT (session 6) | `/commercial/margin-simulation` | ready | — | Saved-sim cards + New-simulation modal: line editor (unit cost/price/débours) → **Preview** (`/preview`, no persist) shows cost/price/margin/margin% → **Save** (`POST /`). |
| **Extra-charge simulation** ✅ BUILT (session 6) | `/commercial/extra-charge-simulation` | ready | — | Saved-sim cards + modal: shipping line/variant, free/occupied days, **tariff-tier editor** → Preview (`/preview`) shows chargeable days + per-day breakdown + total → Save. Tariff comes from tenant settings or the entered tiers. |
| **Pricing variance** ✅ BUILT (session 6) | `/commercial/pricing-variance` | ready | — | Sales R/Y/G list (flag + quote, **never raw cost**) + flag filter chips; **Compute** modal (dossier + quotation/quoted-price, optional actual cost) → `POST /compute`. |

### Sales & CRM

Funnel model (agreed with the user): **marketing → leads + opportunities → sales**. Build order
folds the whole funnel, not just the two ⭐ hubs — see `doc/SESSION_HANDOFF.md` (session 6).

| Screen | Route | BE | Tabs | Key columns / actions |
|---|---|---|---|---|
| **Leads & intake** ✅ BUILT (session 6) | `/sales/leads` | ready | Leads · Inbound intake (Enquiries · Partnership requests) | Company/Contact/Source/Status · Capture, Mark contacted, Qualify, Convert, Lost; Triage → lead; Review partnership |
| ~~Inbound intake~~ **folded into Leads** | `/sales/inbound-intake` | ready | — | Route now **redirects** to `/sales/leads?tab=intake`. Kept as a nav deep-link. |
| **Opportunities** ⭐ ✅ BUILT (session 6) | `/sales/opportunities` | ready | Board (Kanban) · List | Forecast strip (open value / weighted / open deals / win rate); drag-to-move cards across stages; New, Win (opt. open dossier), Lose, Edit; List view has a stage-move dropdown. Columns = `/opportunities/stages`, cards = OPEN opps grouped client-side, per-column value from `/opportunities/board`. Pixie **Pipeline** tab layout. |
| **Proposals** ✅ BUILT (session 6) | `/sales/proposals` | ready | — | List + filter chips; detail modal with narrative sections + priced line table + total; lifecycle DRAFT→IN_REVIEW→SENT→ACCEPTED/REJECTED (Submit, Send [entity-numbered], Reject, Accept [opt. spin quotation]); create/edit draft with narrative + line editors. **Draft with AI** surfaced via the gated AI panel (assist). |
| **Meetings** ✅ BUILT (session 6) | `/sales/meetings` | ready | — | Subject/With/Date · Schedule meeting; click a row → notes & minutes (Add note, Mark as minutes) |
| **Marketing campaigns** ✅ BUILT (session 6) | `/sales/campaigns` | ready | Campaigns · Subscribers | Metric strip (Active/Draft/Ended/Subscribers) + campaign cards with lifecycle buttons (DRAFT→ACTIVE→PAUSED↔ACTIVE→ENDED via `/:id/transition`); Subscribers tab = add (`/subscribers`) + unsubscribe (`/subscribers/unsubscribe`). Pixie **Sales campaigns** layout. |
| **Success stories** ✅ BUILT (session 6) | `/sales/success-stories` | ready | — | Filter chips (Draft/Signed off/Published) + case-study cards; create/edit draft; lifecycle **Sign off** (`/:id/sign-off`) → **Publish** (`/:id/publish`, requires sign-off) → **Unpublish**. **Draft with AI** via gated AI panel. |

**Design source:** the Pixie "Hub" CRM recording (`Recording 2026-07-17`). Its CRM is one hub with
`Today · Pipeline · Clients · Reports` tabs. We reuse its **layout** — segmented tabs, a filter-chip
row and avatar list-rows — but drive it with the app's `--primary` tokens (`lux-card`, status pills),
not the mock's crimson, so screens re-tint per tenant. The **Pipeline** (Kanban) tab is the design
reference for Opportunities; the **Clients** tab (search + chips + avatar rows) is what Leads reuses.

### Operations

| Screen | Route | BE | Tabs | Key columns / actions |
|---|---|---|---|---|
| Operations files (dossiers) | `/operations/files` | ready | Dossiers · Milestones · Transit orders · Delivery notes | Ref/Client/Service/Status · Open dossier, Advance |
| Milestones | `/operations/milestones` | ready | — | Dossier/Milestone/Due/Status · Add, Complete |
| Transit orders | `/operations/transit-orders` | ready | — | Ref/Dossier/Mode/Carrier/Status · New transit order |
| Delivery notes | `/operations/delivery-notes` | ready | — | Ref/Dossier/Consignee/Status · New delivery note |

### Procurement

| Screen | Route | BE | Tabs | Key columns / actions |
|---|---|---|---|---|
| Purchase requests | `/procurement/purchase-requests` | ready | — | Ref/Requester/Dept/Status/Amount · New, Submit, Approve |
| Purchase orders | `/procurement/purchase-orders` | ready | — | Ref/Supplier/Status/Total · New PO, Approve, Send |
| Goods received (GRN) | `/procurement/goods-received` | ready | — | Ref/PO/Received by/Status · Record GRN |
| Supplier invoices | `/procurement/supplier-invoices` | ready | Invoices · Three-way match | Ref/Supplier/Amount/WHT/Status · New, **Run 3-way match**, Post |

### Costing

| Screen | Route | BE | Tabs | Key columns / actions |
|---|---|---|---|---|
| Dossier costing | `/costing/costing` | ready | Costing sheet · Cost tracking | Dossier/Budget/Margin/Status · New, Validate, Approve |
| Cost tracking | `/costing/cost-tracking` | ready | — | Dossier/Budget/Actual/Variance · Record cost (AI reconcile) |
| Cash requests | `/costing/cash-requests` | ready | — | Ref/Requester/Amount/Status · New, Submit, Approve, Disburse, Justify |
| Régie d'avances | `/costing/regie` | ready | — | Holder/Advance/Outstanding/Status · Issue, Age advances |

### Finance

| Screen | Route | BE | Tabs | Key columns / actions |
|---|---|---|---|---|
| Financing & debt | `/finance/debt` | ready | — | BE `/financing` (MOD-53): full CRUD + `/:id/drawdown` + `/:id/repay`. Lender/Principal/Outstanding/Rate/Status · Record engagement, Drawdown, Repay |

### Master data

| Screen | Route | BE | Tabs | Key columns / actions |
|---|---|---|---|---|
| Clients | `/master/clients` | ready | — | Code/Name/NIU/Segment/Status · New client |
| Suppliers | `/master/suppliers` | ready | — | Code/Name/NIU/Category/Status · New supplier |
| Corporate entities | `/master/corporate-entities` | ready | — | Code/Legal name/NIU/RCCM/Country · New entity, Activate |
| Expense rates | `/master/expense-rates` | ready | — | Code/Category/Rate/Unit/Effective · New rate |
| Financial dictionary | `/master/financial-dictionary` | ready | — | Term/Account/Mapping/Notes · New entry |

### Vault

| Screen | Route | BE | Tabs | Key columns / actions |
|---|---|---|---|---|
| Document vault | `/vault/documents` | readonly | Documents · Signatures | Name/Type/Entity/Uploaded/Hash · Upload _(BE gap)_ |
| Document signatures | `/vault/signatures` | partial | — | Document/Signer/Status/Signed · Request signature |
| Document verification | `/vault/verification` | partial | — | Doc ID/Hash/Result · **Verify document** _(BE module incomplete)_ |
| **Compliance flags** ✅ BUILT (session 6) | `/vault/compliance-flags` | ready | Flags · Rules | **Run checks** (`POST /run`) + severity chips + include-resolved toggle; flag rows with **Resolve** (`/:id/resolve`); Rules tab = the rule catalogue. |
| **Reports** ⭐ ✅ BUILT (session 6) | `/vault/reports` | ready | Catalogue · Saved | ⚠️ **feature-gated `reporting`** ("enable it" empty state when off). Catalogue → Run modal (optional from/to/as_of/period_code/dossier_id → generic table/JSON result → Save); Saved tab (run/delete). Scheduling lives in Settings → Scheduled reports; dashboard-tile picker deferred. |

### Communication

| Screen | Route | BE | Tabs | Key columns / actions |
|---|---|---|---|---|
| Smart Comms | `/comms` | ready | Channels · Direct | Channel/Members/Unread/Activity · New channel, New message |

### Settings & Admin

| Screen | Route | BE | Tabs | Key columns / actions |
|---|---|---|---|---|
| Module catalogue | `/settings/catalogue` | readonly | — | Module/Group/Code (feeds permission matrix) |
| Business setup | `/settings/business-setup` | partial | Profile · Financial identity · Fiscal year · Policies | Field/Value · Edit |
| Business policies | `/settings/business-policies` | **none** | — | Policy/Version/Effective · New policy |
| Custom fields | `/settings/custom-fields` | **none** | — | Entity/Field/Type/Required · New field |
| Factory languages | `/settings/factory-languages` | **none** | — | Key/Screen/FR/EN · Add translation |
| Document templates | `/settings/document-templates` | **none** | — | Template/Type/Entity · New template |
| Email signatures | `/settings/email-signatures` | partial | — | User/Signature/Updated · Edit signature |
| Help center | `/settings/help-center` | **none** | — | Guide/Category |
| **Portal access** ⭐ ✅ BUILT (session 6) | `/portal/access` | ready | — | Active-grant list (portal/email/scope/expires) with **Grant** (client/investor/auditor; client needs a client scope) + **Revoke**; **Preview** the exact external scope (client/investor/auditor views, ⚠️ each gated `portal.*` → graceful "enable it" state). |

---

## 2. AI-integration map — where the model can be called

Praxis has a **central AI assistant** (`POST /api/tenant/ai/ask`, feature-flagged
`ai.assistant.backend`) that reaches every module through a per-module tool registry
(`<module>.ai.js`, exposing `reads` + `writes`). Every module below registers its service
functions as assistant-callable tools; **writes require human confirmation**
(`POST /ai/actions/:id/confirm`, or batch confirm). So AI can be invoked in two ways:

1. **Globally** — the assistant (surface it on ⌘K → "Ask", or a chat panel). It can list,
   fetch, and — with confirm — act on any screen's data.
2. **In-context** — an "AI actions" affordance on each screen (the scaffold already renders the
   list per screen). Genuine LLM-generative / inference steps are marked **assist** below.

Governance & keys: `GET/PUT /ai/governance/vendors` (provider keys, encrypted, write-only) is
surfaced as **Settings → API Keys & Secrets** (built). Feature toggles, per-user grants and
spend caps live under the same `ai/governance` module (`/features`, `/grants`, `/budget`,
`/usage`).

### Screens/tabs with in-context AI (assist = LLM generative/inference)

| Screen / tab | AI action | Kind | What it does |
|---|---|---|---|
| Commercial → Quotations | Draft quotation | write | Draft a quotation with lines + totals. |
| Commercial → Quotations | Send / accept | write | Transition or accept (optionally → final invoice). |
| Commercial → Margin simulation | Compute margin | write | Compute + persist a margin simulation (services only). |
| Commercial → Extra-charge simulation | Compute estimate | write | Tiered demurrage/detention estimate. |
| Commercial → Pricing variance | Compute variance | **assist** | Finance: compute quote-vs-actual-cost variance + flag. |
| Sales → Leads | Capture / advance / convert | write | Capture a lead, advance it, convert to a client. |
| Sales → Leads / Inbound intake | **Triage enquiry** | **assist** | Triage an inbound enquiry (optionally convert to a lead). |
| Sales → Opportunities | Create / move / win / lose | write · read | Pipeline board + stage transitions. |
| Sales → Proposals | **Draft proposal** | **assist** | AI-drafted proposal narrative; human review before send. |
| Sales → Meetings | Schedule / add minutes | write | Schedule meetings, log notes/minutes. |
| Sales → Campaigns | Create campaign / subscribers | write · read | Campaigns + newsletter audience. |
| Sales → Success stories | **Draft success story** | **assist** | AI-drafted case study from a dossier; publish after sign-off. |
| Operations → Files | Open / advance dossier | read · write | The dossier hub. |
| Procurement → Supplier invoices | **Run three-way match** | **assist** | PR↔PO↔GRN↔invoice reconciliation before posting. |
| Procurement → Supplier invoices | Post to GL | write | Dr expense+VAT / Cr supplier net of WHT + WHT. |
| Costing → Cost tracking | **Reconcile dossier** | **assist** | Budget-vs-actual reconciliation for a dossier. |
| Costing → Cost tracking | Record cost | write | Post an actual dossier cost (débours→4731). |
| Costing → Cash requests | Draft / transition / disburse / justify | write | Full disbursement + justification cycle. |
| Costing → Régie | Issue / age advance | write | Issue an advance; age unjustified ones back to receivable. |
| Finance → Debt | Create / drawdown / repay | write | Engagement + drawdown + repayment postings. |
| Finance → Journals _(built)_ | Post / reverse entry | write | Balanced JE post; reverse via contra (KB §23). |
| Finance → Receivables _(built)_ | Ageing / dunning reminders | **assist** | Ageing buckets + a dunning plan for overdue invoices. |
| Finance → Tax center _(built)_ | VAT / corporate-tax returns | **assist** | Compute TVA return and IS-vs-minimum-tax over the GL. |
| Finance → Assets _(built)_ | Depreciate / dispose | write | Post depreciation; recognise gain/loss on disposal. |
| Finance → Financial statements _(built)_ | Trial balance / Bilan / Compte de résultat / TAFIRE / Grand livre | read | Read the OHADA statements from the validated GL. |
| Vault → Document verification | **Verify document** | **assist** | QR/hash tamper check by doc_id/entity_ref. |
| Vault → Reports | Report catalogue / run | read | Run statements + operational reports by key. |
| Comms → Smart Comms | **Search messages** | **assist** | Search across the user's channels. |
| Comms → Smart Comms | Post message | write | Post to a channel. |
| Portal → Access | Grant / client view / investor terminal | write · read | Scoped external access + read surfaces. |
| Governance (Workflows/Approvals) _(built)_ | Approve / reject task | write | Runtime approval-task queue actions. |

_Every module also exposes plain **read** tools (list/get) to the assistant even where not
listed above — the table highlights the write/assist points that matter for UX._

---

## 3. Backend gaps surfaced by this pass (notify BE)

- **No endpoint yet (`none`):** Business policies, Custom fields, Factory languages (translations),
  Document/letterhead templates, Help center. These five need modules built (or, for Help center,
  a static-content decision).
- **Partial / read-only to finish:**
  - `vault/document_vault` — read-only; needs upload/create/delete.
  - `vault/document_verification` — module incomplete (missing repo + validator).
  - `email-signatures` — exists per-user on `app_user` but is MOD-67 admin-gated with no
    self-service `/me` route; add a self route for a clean Settings tile.
  - `sales/opportunity` **stages** — stage list is read-only; no stage CRUD (pipeline-stages tile
    shipped read-only).

Everything marked **ready** above is unblocked FE wiring — follow the pattern in
`client/src/features/settings/master-data-pages.tsx` and `.../config-pages.tsx`.

---

## 4. Already built (for context)

Control Tower home, IAM/Security (users, roles, permission matrix, capabilities, scopes, field
visibility, sessions, my-security), Governance (audit, notifications, workflows, approvals),
Appearance + Login editors, Settings hub. **Finance:** chart of accounts, journals, proformas &
advances, invoices, credit notes, receivables, statements, tax center (+ filing), assets.
**Fleet, WMS, HR:** full standalone screens. **Settings tiles (2026-07-15):** currencies & FX,
tax jurisdictions, bank accounts, payment gateways, scheduled reports, API keys & secrets,
pipeline stages (read-only), document numbering. **Per-tenant PWA:** dynamic manifest + icons.
