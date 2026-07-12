# Praxis LS — Phase 0–4 Re-Audit (every src file vs the whole doc corpus)

**Date:** 2026-07-11 · **Auditor pass:** fresh, adversarial re-verification
**Bar (the client's own):** *if the code cannot "talk" (implement) every
requirement in `doc/`, we have done nothing.* This report scores the codebase
against that bar — not against the previous audits, which are treated as claims
to be re-checked, not facts.

**Scope audited:** all 729 `src/**.js` files, 24 tenant migrations + 11 seeds,
the client, and the full `doc/` corpus (PRD v2, OHADA/Tax KB, DB/AI architecture,
RBAC journey, BUILD/CONVENTIONS, AI readiness/knowledge, every phase map & prior
audit).

**Method:** syntax-check of every file; full Jest run; eslint; a require-graph /
gating scan; a manifest→catalogue build; and a service-by-service read of the
core flows (ledger, invoicing, procurement, payroll, workflow, AI) against the
KB/PRD invariants they claim to enforce.

---

## 0. Headline verdict

The **accounting spine (P1) and commercial cycle (P2) genuinely talk the doc.**
OHADA invariants are enforced in DB triggers *and* mirrored in pure, tested rules;
the sale/purchase determination engine is cent-accurate; invoicing posts revenue,
clears advances (4191) and débours (4731) correctly; receivables do FIFO + ageing
+ dunning; payroll computes the full Cameroon statutory stack and posts a balanced
journal; statements and VAT/IS returns derive from the validated GL. The prior
audit's **critical auth hole is closed** — the `auth-coverage` test passes and
every mounted tenant router carries `authMiddleware` (verified independently).

But three requirements that the docs state as **first-class rules** are **not yet
implemented in code**, and they are load-bearing. In priority order:

1. **The configurable approval workflow drives exactly ONE document type.**
   PRD §7.2 says *"Generalise Issuer→Validator→Approver to invoices, receipts,
   journals, disbursals"*; BUILD_CONVENTIONS §2 says *design every approvable
   module to plug into the executor now*. In code, only `final_invoice` calls
   `executor.start` and registers an `onApproved` handler. Proforma, PO, supplier
   invoice, payroll, régie, cash request, costing and quotation each run their own
   **hard-coded status ladder** and never touch the tenant's configurable
   `workflow`/`workflow_step` chain. So "the tenant designs its own approval
   hierarchy and it governs approvable documents" is true for 1 of ~9 documents.

2. **The AI can *read* everything and *write* almost nothing.** AI_ARCHITECTURE
   §0's headline promise is *"the app is the AI's toolbox — AI capability == app
   capability, zero drift."* The registrar builds 338 catalogue actions
   (169 reads / 169 writes) with **169/169 reads AI-enabled** — but the write
   safety-registry (`action-registry.js`) whitelists only `create_client`,
   `create_operations_file`, `ping`, so **1 of 169 write tools is executable**
   (`create_operations_file`'s key isn't even the one the manifest emits). Raising
   an invoice, posting a journal, running payroll, cutting a PO — none are
   AI-executable. The safety *design* is correct; the registry was just never
   populated. Writes are ~1% of the promised surface.

3. **Field-level confidentiality is stored and editable but never applied to
   responses.** PRD §5.6/§7.3 [RULE]: *field-level confidentiality is first-class,
   implemented via column-level policies and response serializers* (mask margins,
   salaries, supplier cost rates, GL from unauthorised roles). `field_visibility`
   exists as config, is cache-resolved, and emits Watch-the-Watcher events on
   change — but **no serializer masks any field on the way out.** The only real
   enforcement is `pricing_variance.salesView` (strips cost) and an *unused*
   `SENSITIVE_FIELDS` helper in `employees.rules.js` (never called by the service).
   Salaries, margins and cost rates are currently returned to any role the module
   route lets through.

Net: **P0–P2 are production-shaped and largely honest; the three items above are
real "code doesn't talk the doc yet" gaps** — one in the commercial/accounting
core (workflow generalisation), two in Phase-4/cross-cutting (AI writes, field
masking). Everything else that's missing is either explicitly deferred in the
docs (portals' external auth, Smart Comms WS, provider runtimes) or minor.

---

## 1. What the code genuinely talks (verified this pass)

- **Build integrity.** All 729 `src` files pass `node --check` (0 syntax errors).
  Module-loader auto-mounts every `<group>/<module>/*.routes.js`; 503 route
  handlers across the tenant surface.
- **Tests.** 45 of 47 unit suites green (~470 tests). Two failures, both
  test-vs-code drift, not product bugs (§3). Strong coverage on the pure rules
  (ledger, determination, statements, tax, receivables, payroll-adjacent,
  workflow executor, RBAC gating, numbering, quotation, pricing-variance).
- **OHADA ledger invariants — enforced at the DB, the real authority**
  (`0220_ledger.sql` / `0221`): unknown-account reject, postable-leaf only
  (§23.3), débours never class 6/7 (§23.4), no VAT on débours (§23.5), analytical
  completeness / `dossier_id` required (§23.10), balanced-or-reject (§23.1),
  gap-free `entry_no`, validated entries immutable — UPDATE/DELETE blocked, only
  reversal (§23.8/§23.16), mandatory `source_doc_ref`. Mirrored by pure
  `determination.js` (sale/purchase, cent-accurate, unit-tested to KB numbers).
- **Invoicing chain.** proforma → advance posts **Dr 521 / Cr 4191** (liability,
  not revenue); final invoice recognises **411 / 706 / 4432**, clears **4191** and
  **4731**, allocates a number, captures the vault doc, and fires `executor.start`.
- **Receivables** (MOD-52): FIFO allocation, ageing buckets, dunning levels — from
  settings, tested.
- **Payroll** (MOD-17): CNPS pension/family/injury with ceiling, CFC, 30% frais
  pro, progressive IRPP barème, CAC surtax; `OPEN→COMPUTED→SUBMITTED→APPROVED→
  VALIDATED→DISBURSED` SoD ladder; posts a balanced 661/664 → 431/447/422 journal.
- **Statements & tax:** trial balance, compte de résultat, bilan, grand livre,
  TAFIRE/cash-flow; VAT return + corporate/minimum tax over the validated GL.
- **Numbering:** tenant-configurable scheme in `setting`, allocated in-txn,
  physically per-schema (sandbox never burns live numbers).
- **Security/RBAC:** real role×capability×scope×permission engine; **grant-cache
  invalidation on every security write** (verified across app_user, capability,
  field_visibility, iam_role, permission, scope, session); Argon2id, JWT
  access+refresh, TOTP 2FA, 30-min idle logout, Redis session store + remote kill;
  God Mode CEO-only + Argon2 PIN, refuses ledger-connected records; audit ledger
  append-only (DB trigger) with maker-checker restore; notification inbox
  self-scoped (the old cross-tenant leak is fixed).
- **Workflow executor itself is real** — amount-threshold step routing, pure and
  unit-tested; `workflow` admin module exposes event-type/workflow/step CRUD +
  the approvals queue, all gated. (The gap is adoption by modules — §2.1.)
- **AI plumbing is real** — governance (EMV toggle, per-user grants, soft/hard
  spend caps, AES-256-GCM vendor keys, test-connection), orchestrator
  (recall→plan→Zod-gate→confirm→execute→log), batch plans, voice/vision workers,
  DB-first vendor keys with env fallback, redaction before egress. (The gap is the
  empty write registry — §2.2.)
- **Phase-3 hybrid modules are real**, not stubs: they layer hand-written domain
  methods (attendance clock-out with employee-integrity check; inventory signed
  stock moves + movement ledger + state machine; payroll; asset lifecycle; etc.)
  on top of generic CRUD. Verified by reading the services, not line counts.

---

## 2. What the code does NOT yet talk (the real gaps)

### 2.1 🔴 Approval workflow generalised to only one document (core gap)
`grep` of every approvable service for `executor.start` / `onApproved.register`:

| Document | own status ladder | plugs into tenant workflow |
|---|---|---|
| final_invoice | yes | **yes** (start + onApproved) |
| proforma | yes | no |
| purchase_order | yes | no |
| supplier_invoice | yes | no |
| payroll | yes | no |
| regie / cash_request | yes | no |
| costing | yes | no |
| quotation | yes | no |

Each non-invoice document approves via a bespoke `setStatus`/`transition` with
hard-coded steps, so a tenant that redesigns its approval hierarchy in the
Universal Event Engine changes **nothing** for POs, payroll, disbursals, costing.
This directly under-delivers PRD §7.2 and BUILD_CONVENTIONS §2/§6.
**DoD:** on submit each approvable module calls `executor.start(eventTypeKey,
entityRef, amountXaf)` and registers an `onApproved` handler that performs its
terminal action; the seeded sample workflow drives at least invoice + PO + payroll
end-to-end.

### 2.2 🔴 AI write surface is ~1% wired (headline-promise gap)
`buildCatalogue()` → 169 write actions, but `isExecutable(write)` is true only when
the key exists in `action-registry.registry`, which contains `ping`, `create_client`,
`create_operations_file`. So `ai_enabled` writes = **1** (`create_client`). The
manifests, Zod schemas, RBAC bindings and confirm flow are all present and correct
— the vetted executor map was simply never filled in. Until it is, "the app is the
AI's toolbox" is false for writes.
**DoD:** populate `action-registry` with the reviewed executors for the core write
actions (invoice, journal, PO, receipt, dossier, quotation, payroll-run), each
calling the module service with the caller's client; `action-registrar` test
asserts a target set is executable; a smoke test drives one AI write end-to-end
(propose→confirm→ledger).

### 2.3 🟠 Field-level confidentiality not enforced on the wire
`field_visibility` is config-only. No response serializer applies it; `employees`
even ships an unused `stripSensitive`. Result: `base_salary`, `bank_block`, job
margin and supplier cost rates are returned to any role whose route permits the
read. PRD §5.6/§7.3 make masking a [RULE].
**DoD:** a shared serializer (or repo-level column policy) masks fields per the
caller's `field_visibility`; employees/costing/dossier-360/supplier responses run
through it; a test asserts a Sales token never receives `net_profit`/cost columns.

### 2.4 🟠 Statutory tax outputs incomplete (P1 completeness)
`tax_declaration` implements `vat-return` and `corporate-tax` only. PRD §12.4 and
the KB require the **DSF dataset, CNPS declaration, and withholding (2.2%/5.5%)
return** as first-class ledger-derived outputs; "Notes annexes" and a **guided
monthly close** (PRD §MOD-57–59, §12) are also absent. These are named
deliverables of the accounting core, not Phase-5 polish.
**DoD:** withholding return, CNPS declaration and a DSF dataset export derive from
the GL with tests against KB figures; a period-close path locks `accounting_period`.

### 2.5 🟠 AI grounding freshness + vectorization toggle not wired
No `entity.action` → re-embed handler on the event bus (AI_KNOWLEDGE §4), and
ingest does not skip a tenant whose `ai.vectorization` flag is off (AI_READINESS
flags this as a real leak). Recall confidentiality filtering *is* present.
**DoD:** an ingest handler re-embeds the changed card on its event; reindex/ingest
check the tenant flag and skip when off.

### 2.6 🟡 Two failing tests (test-vs-code drift, not product defects)
- `action-registrar.test.js` — asserts every write permission matches
  `MOD-\d+:(create|edit|approve|view|delete)`, but ~40 Phase-3 manifests use
  `action:"update"`. `rbac.js` *does* accept `update` (→`can_update`), so this is
  **not** a runtime 403 — but it's inconsistent with the rest of the codebase
  (which uses `edit`) and it fails CI. Normalise `update`→`edit` in those manifests.
- `pdf-email.test.js` — calls `email.send({to…}, tx)` while the implementation is
  the newer per-purpose `email.send(client, {to…}, tx)` (BUILD_CONVENTIONS §7).
  The implementation is correct; the test is stale. Update the test.

### 2.7 🟡 One eslint error
`src/modules/hr/payroll/payroll.rules.js:57` uses `!=` (should be `!==`,
`eqeqeq`). `eslint src --quiet` → 1 error, 0 warnings. Trivial fix.

### 2.8 ⬜ Documented-as-deferred (not counted against the bar, listed for closure)
Portals' external magic-link auth; Smart Comms real-time WebSocket (persistence +
certified export already built); sandbox-wipe **scheduler** wiring (service +
script exist, no cron); provider runtimes (PDF/Chromium, SMTP, Groq voice, Gemini
vision, FX) throw "not configured" until keys are set — by design; the Live-mode
Super-Admin self-grant block (`permission.service` TODO); 29 retained orphan files;
integration tests against a real Postgres (everything is unit/mock/trigger-design
level today — the DB triggers are the runtime authority but haven't been exercised
against a provisioned tenant).

---

## 3. Principle-adherence scorecard

| Principle (doc) | Status |
|---|---|
| Auth on every tenant router (RBAC journey) | ✅ verified (auth-coverage green) |
| SQL only in repos; parameterised (CONVENTIONS) | ✅ |
| Ledger invariants enforced (KB §23) | ✅ DB triggers + tested rules |
| Reversal-not-edit, immutable posted data (PRD §8.5) | ✅ |
| Numbering: allocate-in-txn, capture-once, per-schema | ✅ |
| Business rules from settings, not literals | ✅ (dunning, régie window, tolerances, thresholds) |
| DB-first vendor/SMTP/FX keys, env fallback (BUILD §7) | ✅ |
| Every module ships `.ai.js` (AI readiness) | ✅ 74 manifests; reads fully wired |
| **Issuer→Validator→Approver generalised (PRD §7.2)** | 🔴 only final_invoice |
| **AI capability == app capability (AI_ARCH §0)** | 🔴 reads yes, writes ~1% |
| **Field-level confidentiality applied (PRD §7.3)** | 🟠 config only, no serializer |
| Full statutory tax outputs (PRD §12.4) | 🟠 VAT+IS only; DSF/CNPS/WHT missing |
| AI grounding freshness / vectorization toggle | 🟠 not wired |

---

## 4. End-to-end flow — does the chain connect?

**Yes, structurally, for the money path:** enquiry/lead → opportunity → (proposal/
quotation) → dossier → costing / cash-request(régie) → proforma/advance(4191) →
final invoice(411/706/4432, clears 4191/4731) → GL → statements/VAT/IS → receipt →
receivables ageing/dunning; procurement PR→PO→GRN→supplier-invoice→GL; reporting,
pricing-variance and compliance read across it. The links exist and are tested at
the rules level.

**Where the chain is thinner than the doc:** the **approval gate** between "submit"
and "post" is only the real configurable engine for the final invoice — everywhere
else it's a private state machine (§2.1); and the **AI cannot drive the chain**
because its write executors are unregistered (§2.2). The reporting/statement layer
is missing three named statutory outputs (§2.4).

---

## 5. Prioritised close-out (to fully "talk the docs")

1. 🔴 **Wire the approval executor into every approvable module** (invoice already
   done as the template) — proforma, PO, supplier-invoice, payroll, régie,
   cash-request, costing, quotation. §2.1.
2. 🔴 **Populate the AI write registry** with the vetted core executors and add the
   end-to-end smoke test. §2.2.
3. 🟠 **Add the field-visibility response serializer** and route sensitive
   responses through it. §2.3.
4. 🟠 **Build the missing statutory tax outputs** (withholding, CNPS declaration,
   DSF dataset) + period-close lock. §2.4.
5. 🟠 **Wire event-driven re-embed + honour `ai.vectorization`.** §2.5.
6. 🟡 Fix the two stale tests (§2.6) and the one eslint error (§2.7).
7. ⬜ Then the documented-deferred set (§2.8): integration tests on a real Postgres
   first (it is the only way to prove the trigger layer that currently carries the
   invariants), then portals' external auth, Smart Comms WS, sandbox scheduler,
   provider runtimes.

**Bottom line against the client's bar:** the accounting/commercial core *does*
talk the doc and is the hard-won, correct part. But two of the platform's
signature promises — a tenant-designed approval hierarchy that governs *all*
approvable documents, and an AI whose reach equals the app's — are, in code,
realised for one document and one write respectively. Those two, plus response-time
field masking, are the difference between "P0–P4 shaped" and "P0–P4 done."
