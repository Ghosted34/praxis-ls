# Praxis LS — Brutal Frontend Review (scoped to the dev's claim: "Phase 1 & 2 done")

**Date:** 2026-07-12 · **Scope reviewed:** `client/` in full, against PRD §9/§15,
the 13-group module map, and the Lovable reference (`doc/reference/reference-mock-lovable`).
**Verdict up front:** the claim "Phase 1 and 2 are done" **does not survive contact
with the code.** Phase 1 (accounting spine) is maybe 55–60% surfaced. Phase 2 (the
commercial cycle — the actual heart of the product) is ~10% surfaced. Meanwhile
**Phase 3 (HR/Fleet/WMS) was built out as read-only shells** — work that wasn't even
in the claimed scope, done shallowly, while the Phase-2 dossier/costing/procurement
core is simply absent. This is inverted priorities dressed up as progress.

No code was changed. This is a review only.

---

## 1. The sidebar is not grouped like the module map (your first complaint — confirmed)

`client/src/app/layout/app-shell.tsx` hard-codes **7 ad-hoc nav groups**: Overview,
Finance, Security & Access, Fleet, Warehouse, People & HR, Governance.

The PRD ships **13 module groups** (I–XIII). The nav collapses and reshuffles them,
so the information architecture doesn't match the system it's fronting:

| PRD group (src) | In the sidebar? |
|---|---|
| I. Dashboard & Workspace | Partial ("Overview" → one item; no My Workspace) |
| II. Master Data | **Missing as a group** — COA is dumped under "Finance"; Clients/Suppliers/Entities/FinDict/Tax/Currency/Treasury/Expense-rates have no nav at all |
| III. HR | Yes ("People & HR") |
| IV. Sales & CRM | **Missing entirely** |
| V. Commercial & Pricing | **Missing entirely** |
| VI. Logistics Operations | **Missing entirely** (no dossier, transit, milestones, delivery) |
| VII. Warehouse (WMS) | Yes ("Warehouse") |
| VIII. Fleet | Yes |
| IX. Ops Costing | **Missing entirely** |
| X. Finance & Treasury | Partial (accounting only; no treasury) |
| XI. Procurement | **Missing entirely** |
| XII. Document Vault & Insights | **Missing entirely** |
| XIII. System & Security | Split across "Security & Access" + "Governance" (Settings/Appearance mis-filed under Governance) |

So **6 of the 13 groups have no presence in the nav at all**, and two groups
(Master Data, System) are dissolved into others. Fixing the grouping is not enough on
its own, because most of those groups have **no screens to group** (§2).

---

## 2. Module coverage vs the claimed Phase 1 & 2

The implemented screens are enumerated in `client/src/app/screen-registry.json` and
mounted in the shell. Mapped against what Phase 1 & 2 actually require:

### Phase 1 — Accounting spine (PRD §17.2). Status: **partial, ~55–60%**

Genuinely built and real (not stubs) — credit where due:
- **Journals** (`features/finance/pages.tsx` `JournalsPage`) — real post form,
  balanced-or-rejected check client-side, validate-to-lock, and reversal-not-edit.
- **Proforma / advance** — real form, posts the advance (4191) correctly framed.
- **Final invoice** — real draft → edit → submit lifecycle with débours flag.
- **Statements** — Trial balance, Compte de résultat, Bilan, Grand livre, Cash flow,
  Notes, and a **guided period freeze/close** panel. Solid.
- **Tax center** — TVA return + corporate tax.

Missing or hollow inside Phase 1:
- **Financial Dictionary (MOD-05): no screen.** This is load-bearing — the invoice
  form has a "Dictionary item" dropdown, but there is **no UI to create or manage
  dictionary items or their posting rules.** You can consume dict items you can't
  create.
- **Posting Rules (§8.7): no screen.**
- **Treasury accounts (MOD-09): no screen.**
- **Currency & FX (MOD-08): no screen.**
- **Tax jurisdiction / tax codes config (MOD-07): no screen** (only the read-only tax
  outputs).
- **Expense rates (MOD-10): no screen.**
- **Chart of Accounts (MOD-06):** exists but is a **read-only `ResourceList`** — no
  hierarchy tree (class→account→sub→detail), no add-sub-account. Under-built.
- **Tax center is missing outputs the backend already computes:** the UI exposes only
  VAT + corporate tax, but the API implements **withholding, CNPS/DIPE, and the DSF
  dataset** (`src/modules/finance/tax_declaration/tax_declaration.service.js`). The FE
  is behind its own backend.
- **DSF export tab:** missing from Statements though `dsfDataset` exists server-side.

### Phase 2 — Commercial cycle (PRD §17.3). Status: **~10%, effectively absent**

Present:
- Proforma, Final invoice, Receivables — i.e. the **finance sliver** of Phase 2 only.
  Receivables is a **read-only list** with no ageing buckets or dunning UI.

Missing — and this is the damning part, because these ARE Phase 2:
- **Master data — Clients (MOD-03) and Suppliers (MOD-04): no screens.** You cannot
  create a client in the app, yet the invoice/advance forms depend on picking one.
- **Corporate entities (MOD-01): no management screen** (only dropdowns).
- **Operations File / the dossier (MOD-29): missing.** The PRD calls the dossier "the
  centre of gravity" (§15.1); it isn't in the UI at all.
- **The 360° file modal (§11.3): missing.**
- **Transit orders (MOD-30), Milestones (MOD-31), Delivery notes (MOD-32): missing.**
- **Ops Costing — costing (MOD-46), cost tracking (MOD-47), reconciliation (MOD-48),
  disbursal / régie (MOD-49): all missing.**
- **Procurement — PO (MOD-60), GRN / three-way match (MOD-61), purchase requests
  (MOD-62), supplier invoice: all missing.**
- **Commercial — margin / extra-charge simulators (MOD-27/28), quotation, proposals,
  leads: all missing** (no Sales/Commercial nav even exists).

**So "Phase 2 is done" is false.** What exists is invoice-in / advance-in / read
receivables. The dossier-centric operations→costing→procurement→invoice workflow the
whole product is organised around has no front end.

### Out of scope but built anyway (shallow): Phase 3

Fleet (7 screens), WMS (6), most of HR (10) are wired into the nav — but
`features/fleet/pages.tsx`, `features/wms/pages.tsx` and most HR pages are **bare
read-only `ResourceList`** (`components/resource-list.tsx`): fetch endpoint, dump a
table, columns inferred from the first row. **No create/edit, no detail view, no
state-machine actions.** On an empty tenant they render "Nothing here yet" with no way
to add anything. This is "a screen exists" ≠ "the module is done." Building 23 of these
instead of the Phase-2 core is the wrong trade.

---

## 3. "Not properly done" — quality issues in what's there

- **Read-only shells masquerading as modules.** ~23 screens are `ResourceList` only
  (all Fleet, all WMS, most HR, plus COA and Receivables). They can't create, edit, or
  action anything.
- **Wrong module tags throughout the registry** (`screen-registry.json`): Journals
  tagged `MOD-05` (that's the Financial Dictionary; journals are MOD-55); Proforma
  tagged `MOD-52` (that's Receivables; proforma is MOD-50); Receivables tagged
  `MOD-56` (that's the GL; receivables is MOD-52); COA tagged `MOD-58` (that's P&L; COA
  is MOD-06). This registry is also ingested by the AI as its map of the app — wrong
  tags mislead both humans and the assistant.
- **The home dashboard is fake.** `features/dashboard.tsx` renders the Lovable mock as
  a static **`<iframe srcDoc>`** — the map, "live shipments" and KPIs are the mock's
  hard-coded HTML, **not the tenant's data.** The one screen that looks finished shows
  canned numbers.
- **No document surfaces.** No PDF preview / send for invoices, POs, payslips,
  statements — despite PDF+email being Phase 1 deliverables (§5.9/§5.10).
- **No i18n.** PRD requires full EN/FR (§14); the UI is English-only literals.
- **No My Workspace, no field-masking-aware UI, no Test-mode banner beyond a topbar
  pill** (PRD §5.5 wants an "unmistakable TEST MODE banner on every screen").

---

## 4. Design fidelity vs the Lovable reference (your third complaint — confirmed)

The app does **not** replicate the reference; it approximates a topbar/rail in
hand-rolled CSS and **iframes the mock for the dashboard only**, which is why it feels
like two different products stitched together:

- **Reference stack** (`doc/reference/reference-mock-lovable`): TanStack Router +
  TanStack Query, a **full shadcn/ui set (~40 components** incl. `sidebar.tsx`,
  `chart.tsx`, `command.tsx`, `dialog.tsx`), Playfair Display + Montserrat, a designed
  token system and "Control Tower" experience.
- **Actual app:** `react-router-dom`, no react-query, **~8 hand-rolled UI primitives**
  (`button`, `card`, `input`, `label`, `table`, `modal`, `otp-input`, `states`), custom
  `lux-*` classes. It ported the *look of the topbar* and then **embedded the mock's
  static HTML in an iframe** for the home instead of building it in React.
- Net effect: the dashboard is pixel-close (because it literally *is* the mock), and
  **every other screen looks nothing like it** — plain admin tables. That's the
  inconsistency you're seeing.
- **Your own plan already says this is wrong.** `doc/FRONTEND_PLAN.md` (top):
  *"the FE is being rebuilt to replicate the Lovable mock … the hand-rolled client/ …
  is being superseded … Phase 2 frontend should follow the Lovable replication, not
  this stack."* The dev is still shipping on the superseded Phase-0 stack and has not
  started the replication.

---

## 5. Bottom line

- **Sidebar:** 7 improvised groups, not the 13 module groups; 6 groups have no nav. ✅ your complaint holds.
- **Phase 1:** the accounting *transaction* screens (journals, invoice, advance, statements, tax) are real and decent. The accounting *master-data* screens (Financial Dictionary, Posting Rules, Treasury, Currency/FX, Tax config, Expense rates) and half the tax outputs are **missing**. ~55–60%.
- **Phase 2:** essentially **not built** — no clients/suppliers, no dossier, no milestones, no costing, no procurement, no simulators, no 360° modal. ~10%.
- **Effort was spent on out-of-scope Phase-3 read-only shells** instead of the Phase-2 core.
- **Design:** a real Lovable dashboard-by-iframe bolted onto an otherwise hand-rolled admin UI; the mandated Lovable replication hasn't started.

Calling this "Phase 1 and 2 done" is generous by roughly a full phase. The honest
status is: **Phase 0 foundation + part of Phase 1's accounting screens + a thin finance
slice of Phase 2, plus shallow Phase-3 lists — on the stack the plan says to replace.**
