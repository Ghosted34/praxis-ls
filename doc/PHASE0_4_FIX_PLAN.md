# Praxis LS — Phase 0–4 Fix Plan (4 steps)

Derived from `doc/PHASE0_4_REAUDIT_2026-07-11.md`. Closes the gaps between what
the docs require and what the code currently does. Ordered by dependency: each
step leaves the tree green (`node --check` + `jest` + `eslint`) before the next.
Trivial fixes are folded into the step that already edits those files.

Legend: 🔴 blocking (doc states as a first-class RULE) · 🟠 completeness gap.

---

## Step 1 — Generalise the approval workflow to every approvable document 🔴
**Gap (§2.1):** only `final_invoice` calls `executor.start` + registers an
`onApproved` handler. PRD §7.2 / BUILD_CONVENTIONS §2 require every approvable
document to be governed by the tenant's configurable `workflow`/`workflow_step`
chain. Today proforma/PO/supplier-invoice/payroll/régie/cash-request/costing/
quotation each run a private hard-coded status ladder.

**Template to copy:** `src/modules/finance/final_invoice/final_invoice.service.js`
(`executor.start` on submit → `onApproved.register("invoice", …)` posts on
approval).

**Scope / files:**
- `src/modules/finance/proforma/proforma.service.js`
- `src/modules/procurement/purchase_order/purchase_order.service.js`
- `src/modules/procurement/supplier_invoice/supplier_invoice.service.js`
- `src/modules/hr/payroll/payroll.service.js`
- `src/modules/costing/regie/regie.service.js`
- `src/modules/costing/cash_request/cash_request.service.js`
- `src/modules/costing/costing/costing.service.js`
- `src/modules/commercial/quotation/quotation.service.js`
- `src/services/workflow/on-approved.js` (new prefixes: `po`, `supplier_invoice`,
  `payroll`, `regie`, `cash_request`, `costing`, `quotation`, `proforma`)
- `migrations/seeds/9060_seed_sample_workflow.sql` (seed sample chains for at
  least invoice + PO + payroll so the path is exercised out of the box)

**Work:** on each module's "submit for approval" transition, call
`executor.start({ eventTypeKey, entityRef, amountXaf })`; when the chain returns
`{ autoApproved: true }` (no workflow bound) keep today's direct transition so
nothing regresses; register an `onApproved` handler that runs the module's
terminal action (post/lock). Amount thresholds already route inside the executor.

**Fold-in (housekeeping):** fix `src/modules/hr/payroll/payroll.rules.js:57`
`!=` → `!==` (the sole eslint error) while payroll is open.

**DoD:** a tenant workflow governs invoice **and** PO **and** payroll end-to-end
(submit → approval_task → act → post); `workflow-executor` + `on-approved` tests
extended to cover ≥2 new document prefixes; no module skips approval when a
workflow IS bound; eslint clean.

---

## Step 2 — Make the AI's write reach equal the app's 🔴
**Gap (§2.2 + §2.5):** 169 write tools are catalogued but only 1 is executable —
`src/services/ai/action-registry.js` whitelists just `ping`/`create_client`/
`create_operations_file`. AI_ARCHITECTURE §0 promises "AI capability == app
capability." Also no event-driven re-embed, and ingest ignores the
`ai.vectorization` toggle (AI_READINESS leak).

**Scope / files:**
- `src/services/ai/action-registry.js` — add vetted executors for the core write
  actions (raise proforma/final invoice, post journal, create/issue PO, record
  GRN + supplier invoice, post receipt, open/transition dossier, create/accept
  quotation, run/advance payroll). Each calls the module **service** with the
  caller's client + identity (RBAC/audit already apply in-service).
- ~40 Phase-3 `*.ai.js` manifests — normalise `action:"update"` → `action:"edit"`
  (fleet/*, hr/*, wms/*, etc.) so the vocabulary matches the rest of the codebase
  and `middleware/rbac.js` mapping; **this also fixes the failing
  `action-registrar.test.js`.**
- `src/services/ai/ingest.service.js` + `scripts/ai/reindex.js` — skip a tenant
  whose `ai.vectorization` flag is `off`.
- `src/shared/events/emit.js` (or a worker handler) — on `entity.action`,
  re-embed the changed record's card (grounding freshness).

**DoD:** a target set of write actions is `ai_enabled` and executable;
`action-registrar.test.js` green; one end-to-end smoke test drives an AI write
(propose → confirm → ledger row); ingest honours the vectorization flag; a
changed record re-embeds on its event.

---

## Step 3 — Enforce field-level confidentiality on responses 🟠
**Gap (§2.3):** `field_visibility` is config-only; no serializer masks anything on
the way out (the lone real strip is `pricing_variance.salesView`; `employees`
ships an *unused* `stripSensitive`). PRD §5.6/§7.3 make masking a [RULE].

**Scope / files:**
- New `src/shared/rbac/field-mask.js` — `maskFields(row(s), { caller, entity })`
  driven by the caller's resolved `field_visibility` (via `identity-cache`).
- Wire it into the response path of the sensitive surfaces:
  `master/employees` (salary, bank_block), `costing`/`cost_tracking` and the
  dossier-360 money block (`operations_file.service`), `supplier_master` (cost
  rates), GL/statement reads for non-finance roles.
- Remove/replace the dead `stripSensitive` in `employees.rules.js` with the shared
  masker.

**DoD:** a Sales-scoped token never receives `net_profit`/margin/cost columns; an
HR-less role never receives `base_salary`/`bank_block`; a test asserts masking per
role for employees + dossier-360 + supplier.

---

## Step 4 — Complete the statutory accounting outputs 🟠
**Gap (§2.4):** `tax_declaration` implements only `vat-return` + `corporate-tax`.
PRD §12.4 / the KB require the **withholding (2.2%/5.5%) return, CNPS declaration,
and DSF dataset**, plus **Notes annexes** and a **guided monthly close** (period
lock) for the statement suite.

**Scope / files:**
- `src/modules/finance/tax_declaration/tax_declaration.rules.js` +
  `.service.js` + `.routes.js` + `.validator.js` — add `withholdingReturn`,
  `cnpsDeclaration`, `dsfDataset`, each derived from the validated GL/trial
  balance (rules pure + unit-tested to KB figures).
- `src/modules/finance/financial_statement/financial_statement.{rules,service,
  routes}.js` — Notes annexes; a guided monthly-close path that locks
  `accounting_period` (validated entries already immutable via triggers).
- Tests: `tax-center` / `statements-extra` extended for the new outputs.

**Fold-in (housekeeping):** correct the stale `pdf-email.test.js` — it calls
`email.send({to…}, tx)` but the current per-purpose implementation is
`email.send(client, {to…}, tx)` (BUILD_CONVENTIONS §7); the code is right, the
test is stale. Update the test signature.

**DoD:** withholding + CNPS + DSF outputs return correct figures over a seeded
ledger; a period can be closed/locked; full `jest` + `eslint` green (0 failing
suites, 0 lint errors).

---

## Sequencing & exit criteria
1 → 2 → 3 → 4. Steps 1 and 2 are the 🔴 promises (approval hierarchy + AI reach);
3 and 4 are the 🟠 completeness rules (masking + statutory outputs). After Step 4
the two stale tests and the eslint error are gone, and every item under
"principle-adherence" in the re-audit flips to ✅ except the explicitly-deferred
set (§2.8: real-Postgres integration tests, portals' external auth, Smart Comms
WS, provider runtimes, sandbox scheduler) — those stay Phase-4-tail / Phase-5.
