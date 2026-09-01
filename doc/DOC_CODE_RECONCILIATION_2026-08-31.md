# Doc ↔ Code Reconciliation & Invariant Audit — 2026-08-31

**Scope.** The two source-of-truth documents (`Praxis_LS_Kickoff_Meeting_Transcript.md`,
`SmartLS_PRD_Master_Functional_Spec_v2.md`) read in full, reconciled against the
repository. Prior audit documents in `doc/` were deliberately **not** consulted —
this is an independent pass. **Findings only; no code was changed.**

**Method.** Invariants were traced to their enforcement point, preferring database
constraints and triggers over application code, since only the former survives a
new call path. Module coverage was established from the auto-mounted route table
(`src/shared/http/module-loader.js`), not from directory names.

---

## Part 1 — Discrepancies between the two documents, now closed

Seven contradictions were found between the transcript and the PRD. All are now
resolved; the resolutions came from the product owner except where the code is
cited as the deciding evidence.

| # | Subject | Transcript | PRD | Resolution |
|---|---------|-----------|-----|-----------|
| 1 | Tenant isolation | Database-per-tenant | Schema-per-tenant (§5.3) | **Database-per-tenant.** Confirmed in code: `provisioning.service.js` connects via `m.tenantDbName(slug)`. PRD §5.3 is stale. |
| 2 | Sandbox location | Live + Sandbox inside the tenant's Postgres | `tenant_<slug>` / `tenant_<slug>_sandbox` schemas | **A `sandbox` schema inside each tenant's own database.** Both documents are half-right. |
| 3 | God Mode reach | CEO may purge anything; reversible via ledger JSON | Refuses ledger-connected records (§8.5) | **PRD wins.** Enforced — see F-INV-04. |
| 4 | Object storage | AWS S3 (cheapest) | Explicitly non-AWS, S3-compatible (§5.1) | **Neither — configurable.** Drivers for local and S3-compatible; the choice is a deployment decision, not a code constraint. |
| 5 | Mail fallback sender | `nmail.praxisls.com` | `+<tenant>@mail.praxisls.com` (§5.9) | **Neither — set in the admin console.** Both literal domains should be struck from the docs. |
| 6 | Backend framework | Node + TS (unspecified) | NestJS modular monolith (§5.1) | **Express / CommonJS, settled.** The PRD's NestJS row is stale. |
| 7 | AI routing | DeepSeek primary → Gemini fallback | Gemini content+vision / DeepSeek reasoning / Groq voice (§10.4) | **Transcript wins for chat.** `src/services/ai/llm.service.js:16-17` — `PRIMARY = "deepseek"`, `FALLBACK = "gemini"`. Groq is separate and correct for voice (`transcription.service.js:19-32`). |

### Corrections the documents need

- **`Praxis_LS_Kickoff_Meeting_Transcript.md`** — "Grok" (xAI) is a transcription
  error for **Groq**. Three occurrences: §8 body (twice) and Appendix A row **D8**.
  Left uncorrected, a reader integrates the wrong vendor.
- **PRD §5.1 / §5.3 / §5.9 / §6.3 / §6.4 and the stack table** — stale per the
  table above.
- **PRD §5.8 / Appendix A** — "all provider keys live in `.env`" is no longer true.
  Vendor credentials resolve **DB-first** (`platform.ai_vendor_credential`), with
  `.env` as fallback, per `BUILD_CONVENTIONS §7`.
- **OpenAI is a fourth AI vendor and appears in neither document** — in two roles:
  a configurable OpenAI-compatible chat vendor, and the **embeddings** provider.

### Consequences of database-per-tenant the PRD did not anticipate

The PRD wrote its operational sections assuming schemas in one cluster.

- **§6.3 backups** say "every tenant schema + the platform schema". With separate
  databases this is per-database `pg_dump` and per-tenant WAL archiving. Restoring
  one tenant gets cheaper; monitoring gets N times wider, and the backup job must
  enumerate databases, not schemas.
- **§6.4 scaling** places PgBouncer at 10+ tenants. Separate databases mean
  separate connection pools rather than one shared pool, so pooling pressure
  arrives earlier than the ladder predicts.
- **Migrations now run N times against N databases**, which makes the CI gates on
  migration numbering and reversibility more load-bearing than the PRD assumed.
  With 276 tenant migrations, a migration that is not reliably re-runnable is a
  per-tenant failure, not a single one. See F-GAP-03.

---

## Part 2 — What the sweep found

### 2.1 Module coverage

**137 route modules** auto-mounted across 28 groups. Every module in the PRD's
70-module map (MOD-00A … MOD-70) resolves to code, including the four most likely
to have been skipped:

| Expected gap | Actually at |
|---|---|
| MOD-56 General Ledger | `finance/financial_statement/` (repo + rules) |
| Investor / Board Terminal (§11.1) | `portal/` + `portal_auth/` |
| Audit Terminal (§11.1) | `audit_room/` |
| Pricing Variance Index (§11.4) | `commercial/pricing_variance/` |

Coverage is **not** the problem. 431 backend and 134 client test files;
276 tenant + 26 platform migrations. The gaps below are gaps in *enforcement
reach*, not in whether a feature was built.

### 2.2 Invariants that hold — and hold harder than specified

Most invariants are enforced by **database triggers and constraints**, which is
stronger than the PRD required and means they cannot be bypassed by a new route.

| Invariant | Source | Enforcement |
|---|---|---|
| No dictionary item without a posting rule | §8.7, KB §23.14 | Deferred constraint trigger, `0200_coa_dictionary.sql:80`; **`0505`** closes the reverse hole (deleting the rule to orphan the item) with a second trigger on `posting_rule` |
| Σ Dr = Σ Cr | §18 DoD | Deferrable constraint trigger, `0220_ledger.sql:105`; `0499` adds a base-currency check with tolerance |
| Débours: no VAT, no class 6/7 | §18 DoD, KB §23.4-5 | `0220_ledger.sql:89,92` + `CHECK chk_debours_no_tax` (`0230:92`); re-asserted after the rename in `0640:154,157` |
| Posted entries reversal-only | §8.5 | `0220_ledger.sql:132,143,158` — entry, header and lines each refuse mutation |
| Immutable ledger append-only | §8.5 | `trg_ledger_ro BEFORE UPDATE OR DELETE … forbid_mutation()`, `0130:57` |
| Maker-checker restore | §8.5(a) | `CHECK (restored_by <> deleted_by)` on `soft_delete` |
| God Mode refuses ledger-connected records | §8.5 | See F-INV-04 |
| Sandbox wipe can never touch Live | §5.5 | By construction: `DROP SCHEMA IF EXISTS sandbox CASCADE` names the schema literally; Live is a different schema (`provisioning.service.js:750`) |
| Sandbox unreachable once Live | §5.5 | `tenant-context.js` — `!req.tenant.is_live && header === "sandbox"`. Server-side, not a hidden toggle |
| Per-environment numbering | §8.2 | By construction — `doc_sequences` is per-schema |
| Maker ≠ checker on approvals | §7.2 | `services/workflow/executor.js` — enforced for **everyone, CEO included**, a deliberate departure from the CEO's RBAC bypass |
| Two-part AI toggle (EMV) | §8 (transcript), §10 | `feature: "ai.assistant.backend"` on the assistant and governance routers, gated by `requireFeature`; per-tenant `feature_state` rather than an env var — better than specified |
| No native browser dialogs | CLAUDE.md | Clean. Every `window.confirm/alert/prompt` occurrence in the three frontends is inside a comment or a test |

**F-INV-04 — God Mode is well built.** `godmode.service.js:145-165`. The guard is
re-checked at purge time (not only in the preview), it is **referential** — any
`immutable_ledger` row keyed to the entity blocks the purge — rather than a
prefix list that would drift, `requireCeo()` uses `is_ceo !== true` so a truthy
non-boolean cannot pass, and the PIN is Argon2id with a 7-day expiry.

### 2.3 Findings

Ordered by severity.

---

#### F-GAP-01 — Field-level confidentiality is configured but almost never applied
**Severity: high.** PRD §7.3 `[RULE]`; §11.3 `[RULE]`.

`src/shared/rbac/field-mask.js` is the response-side serializer that implements
field-level confidentiality. It has **two call sites**:

- `master/employees/employees.controller.js`
- `operations/operations_file/operations_file.controller.js`

The seed (`9020_seed_rbac_events.sql:31-36`) masks `dossier.margin` for SALES,
OPERATIONS, WAREHOUSE, FLEET and PROCUREMENT, and `supplier.cost_rate` for SALES
and OPERATIONS. But **no module that actually serves those figures applies the
mask**. Verified absent from all of:

`margin_simulation` · `quotation` · `dossier_reconciliation` · `cost_tracking` ·
`payroll` · `supplier_master` · `expense_rate`

Consequences:

1. `supplier.cost_rate` masking is **entirely inert** — no module applies it.
2. A role with `view` on MOD-27 or MOD-48 sees raw margin and budget-vs-actual
   regardless of its `field_visibility` rows.
3. Worst of the three: the admin UI (`security/field_visibility/`) lets an
   administrator configure a mask, shows it as saved, and it silently does
   nothing. A control that reports success without acting is more dangerous than
   an absent one, because it stops anyone looking further.

Mitigating: costing (MOD-46) deliberately no longer carries margin at all
(`costing.service.js:163` — "margin belongs to margin_simulation + quotation"),
and route-level `requirePermission` still gates whole modules. The system is not
wide open; it is that the *field-level* layer the PRD calls first-class covers
two surfaces out of roughly ten. §11.4's Pricing Variance Index exists precisely
so Sales get a proxy instead of the real number — that intent is defeated if
Sales can open MOD-27 and read the margin directly.

---

#### F-GAP-02 — Purchase-order approval bypasses the segregation-of-duties overlay
**Severity: high.** PRD §7.2, §5.7.

`procurement/purchase_order/purchase_order.routes.js:21` gates the transition to
`APPROVED_LOCKED` with `requireTransitionPermission` **only**. No
`requireTransitionCapability`.

Compare, in the same codebase:

- `costing/costing/costing.routes.js:29,35` — `TRANSITION_CAPABILITY = { APPROVE: "APPROVER" }`, applied.
- `purchase_order.routes.js:29-35` — the **unlock** route on the same file *does*
  apply `requireTransitionCapability`.

So approving a PO requires only `permission.can_approve` on MOD-60. That matters
because `can_approve` is **deliberately outside** the self-grant maker-checker:
`security/permission/permission.service.js:9-16` argues the documented rule
concerns the ISSUER/VALIDATOR/APPROVER overlay, not the role×module grant matrix
— which is sound reasoning *provided* every approval also checks the overlay.
Here it does not. A Super Admin can therefore grant their own role `can_approve`
on MOD-60 and approve a purchase order alone — the exact circumvention §5.7
exists to prevent. The same path is closed on costing, invoices and unlocks.

The inconsistency within a single file suggests an oversight rather than a
decision.

*Note:* PRs routed through the Universal Event Engine's `approval_task` queue are
safe — `services/workflow/executor.js:217-225` enforces `step_capability_code`.
The exposure is the module's own direct `/transition` route, a second path to the
same state with weaker gating.

---

#### F-GAP-03 — Provisioning migrations swallow every error
**Severity: high.**

`0469_default_workflows.sql:49-51`:

```sql
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
```

The block that seeds a tenant's default approval workflows silently succeeds when
it fails. A tenant provisioned through a failure has **no approval chains** while
appearing fully provisioned — documents then move without the validate/approve
step the workflow was meant to impose.

This is not hypothetical. **14 migration files** carry the same bare handler, and
two of them are named `0492_default_workflows_repair.sql` and
`0506_leave_approval_repair.sql` — repairs written because the silent failures
happened and had to be patched after the fact.

It also contradicts the repository's own rule: CLAUDE.md requires that "silent
catches carry a taxonomy marker" (`doc/ERROR_HANDLING.md`). The JavaScript side is
held to that standard; the SQL side is not, and no CI gate covers it.

Full list: `0467, 0468, 0469, 0487, 0490, 0491, 0492, 0496, 0499, 0504, 0506,
0640, 10722, 10733`.

---

#### F-GAP-04 — The AI action gate is lenient, not the strict Zod gate §10.3 specifies
**Severity: medium.**

PRD §10.3 `[RULE]` requires that between LLM output and the confirmation screen
sits a **strict** Zod layer validating against "the exact Zod schema for that
action **and** against business rules (vendor exists, account/dictionary item
valid, **amount within the user's approval limit**, tenant/scope correct)".

What exists (`services/ai/orchestrator.service.js:472-500`) is a hand-written
JSON-Schema-ish validator that is **deliberately lenient**: it enforces required
fields, coerces types, and **passes unknown keys through untouched**. The comment
explains why — strict rejection produced "validation failed: unknown
'client_name'" and was the root cause of the assistant "confusing itself". That
is a legitimate UX fix. But three things follow:

1. **No business-rule validation at proposal time.** Approval limit, vendor
   existence and dictionary validity are not checked before the user is shown the
   action card. The module's own Zod schema is the gate at *execution* time — so
   the user can be shown, and confirm, an action that only then fails.
2. **No self-correction loop.** §10.3 specifies "≤2 retries, then fall back to a
   pre-filled manual form". There is no retry: `orchestrator.service.js:918-919`
   records `status: "VALIDATION_FAILED"` and returns `validation_errors` to the
   interactive form. The manual fallback exists; the retry does not. Arguably a
   better design — but it is not what the PRD says, and nobody decided that on
   the record.
3. **The file's own header comment is wrong.** Line 3 reads "Zod-gate proposed
   actions (≤2 self-correct → manual fallback)" — describing behaviour the file
   does not implement. This will mislead the next engineer more than the PRD will.

---

#### F-GAP-05 — There is a RAG stack, and §10.1 says there isn't
**Severity: medium (architectural; needs a decision, not necessarily a fix).**

PRD §10.1 `[RULE]`: *"No RAG / no vector store. The AI obtains context by
function-calling into the tenant's own API."*

The code has both:

- `migrations/tenant/0400_ai.sql:112-134` — `ai_document` + `ai_chunk`,
  `embedding vector(1536)`, an `ivfflat` cosine ANN index
- `src/services/ai/embeddings.service.js` — a working embed pipeline
- `migrations/platform/0040_ai_knowledge.sql:39` — the same at platform level

It is a *considered* implementation: chunks carry a `confidentiality` tag so
recall respects §7.3, and redaction is documented as happening before embed. This
reads as a deliberate reversal that was never written down, not as drift. But
until it is recorded, §10.1 remains a stated hard rule that the system violates,
and no one can tell which is current.

**Decision needed:** amend §10.1, or remove the vector store.

---

#### F-GAP-06 — The God Mode PIN is delivered in plaintext through the mail system
**Severity: medium.**

`godmode.service.js:97-100` — weekly rotation sends:

```
body: `Your God Mode PIN for the next ${PIN_TTL_DAYS} days is: ${pin}`
```

The most privileged credential in a tenant, in a message body. Per §5.9 that
routes through the tenant's own SMTP, and this repository has a full mail module
with threading, search and indexing — so the PIN comes to rest in a searchable
store, and in whatever the tenant's mail provider retains.

The PIN is otherwise handled carefully (Argon2id at rest, returned plaintext
exactly once on manual rotation, 7-day expiry, and the worker logs nothing). The
delivery channel is the weak link, and it undercuts the second factor that God
Mode's whole design rests on: anyone with access to the CEO's mailbox has the PIN
without ever holding the CEO's password.

---

#### F-GAP-07 — `requireCapability` exists with zero call sites
**Severity: low (informational; explains F-GAP-02).**

`middleware/rbac.js` exports `requireCapability`, and nothing calls it — recorded
in `services/workflow/executor.js:206-215` as audit findings W6/W7: "the step
designer has always collected this and nothing has ever enforced it". The
executor now enforces the capability for workflow-routed approvals, which closes
the general case. F-GAP-02 is what remains of the same root cause on a
module-owned route.

Worth noting alongside: the executor applies a **null-means-unrestricted** rule —
a workflow step naming no capability requires none. The default workflows do name
`APPROVER` (`0469:47`), so this is safe as seeded; it is only a risk for
hand-built workflows, and combined with F-GAP-03 it is a risk for any tenant
whose seeding silently failed.

---

#### F-GAP-13 — The costing validation step is unreachable, and one person can still approve their own draft
**Severity: high.** Found while testing, 2026-08-31.

The costing screen offers two buttons: **Submit for approval** and **Approve**.
There is no *Submit for validation*, and the handler's type says so outright
(`permission-matrix` aside, `pages.tsx:755`):

```ts
async function setStatus(c: api.Costing, to: "SUBMIT_APPROVAL" | "APPROVE")
```

Everything else for the two-step exists. The service maps
`SUBMIT_VALIDATION → SUBMITTED_FOR_VALIDATION` (`costing.service.js:204`); the
state is real; the create form has a **Validator** picker; and
`costing.service.js:211` refuses that transition unless a validator is named. The
only thing missing is a button that sends it. So:

- **The `SUBMITTED_FOR_VALIDATION` state can never be entered from the UI.**
- **The Validator field is decorative.** You pick someone, and the one transition
  that consumes it is unreachable, so `validator_assigned_at` is never stamped.
- The submit button's own visibility condition is
  `["DRAFT","SUBMITTED_FOR_VALIDATION"].includes(r.status)` — it *anticipates* a
  state nothing can produce.

**This is a half-applied fix, and the file says so.** The comment above the
handler records the previous defect: *"The screen had Approve and nothing else,
so `costing.submitted` — the event the approval chain binds to — could never fire
from the UI. A costing went DRAFT → APPROVED_LOCKED in one click by one person,
with the configured chain bypassed entirely."* Submit-for-approval was added.
Submit-for-validation was not.

**And the original defect is only half closed.** The Approve button renders
whenever the status is not `APPROVED_LOCKED` / `REJECTED` / `UNLOCK_REQUESTED` —
which includes **DRAFT**. So the one-click DRAFT → APPROVED_LOCKED path the
comment describes is still on screen. It is blocked only once a chain is pending
(`assertNoPendingChain`), and a chain only exists after somebody pressed Submit.
A user who presses Approve first never opens one.

**No server-side ordering to fall back on.** Unlike quotation and cash request —
both of which carry an explicit `NEXT` map and `assertTransition` —
`costing.setStatus` validates only that the action exists and the row is not
locked. `DRAFT → SUBMIT_APPROVAL` and `DRAFT → APPROVE` are both accepted. The
sequence is a UI convention, not an invariant.

**The pattern already exists two thousand lines down the same file.** The cash
request offers `"SUBMITTED" | "VALIDATED" | "APPROVED" | "REJECTED"` and its
service enforces the order, with a comment noting the two-step was *"restored
(10721, legacy parity): finance validates, management approves."* Costing was
left with one leg.

**Effect on the walkthrough.** The issue → validate → approve chain across three
people, which PRD §7.2 requires for documents that move money, is not achievable
on a costing through the UI. Two-person maker-checker still works (submit, then a
different person approves) because the workflow executor enforces maker ≠ checker.

**Suggested fix:** add the third action to the union and a button gated on
`status === "DRAFT" && validator_id`, and narrow Approve's condition to states
where approving is legitimate. The service needs no change.

---

#### F-GAP-12 — A 403 on a lookup renders as an empty dropdown, with no error anywhere
**Severity: medium (blocks the costing flow outright).** Found while testing,
2026-08-31.

On the *New costing sheet* modal, **Validator** and **Currency** are populated by
two separate lookups:

| Control | Request | Grant it needs |
|---|---|---|
| Validator | `GET /users` | **MOD-67 view** |
| Currency | `GET /currencies` | **MOD-08 view** |

Neither error is surfaced. `pages.tsx:273-278` destructures `rows` off the users
list and reads `currencies.data`, and **no branch renders either failure**. A 403
therefore arrives as an empty `<select>` — indistinguishable from "this tenant
has no currencies configured".

Currencies *are* seeded (XAF, USD, EUR, NGN, CNY — `9005_seed_currency.sql`,
`is_active` defaults true), so an empty currency list is always a permission
problem and never a data one. The default grants explain who sees what:

| Role | MOD-67 view (Validator) | MOD-08 view (Currency) |
|---|---|---|
| SUPER_ADMIN · CEO · MANAGEMENT | yes | yes |
| FINANCE · ACCOUNTANT | **no** | yes |
| **OPERATIONS · SALES** | **no** | **no** |

So the role that raises costings for a living — Operations — sees both dropdowns
empty. And this is not cosmetic: `costing.service.js:211` refuses
`SUBMIT_VALIDATION` without a validator (`NO_VALIDATOR`, 422). The user cannot
pick one, cannot submit, and is told nothing about why.

Currency degrades more kindly by accident: `useState("XAF")` means the value is
already correct even with no options rendered, so a submit still carries XAF.

**The same file already argues the opposite position, eight lines below.** For
the VAT code lookup: *"`degraded` is surfaced — silently offering zero codes is
indistinguishable from 'no tax set up'."* Someone reasoned this failure mode
through for one of the three lookups on the same form and left the other two
doing exactly what the comment warns against.

**Two things to fix, and they are different.**

1. *Surface the failures* — the VAT lookup's `degraded` treatment applied to the
   other two. This is the general lesson of F-GAP-09 one layer further out: not
   just "keep the server's message", but "an empty list must say whether it is
   empty or forbidden".
2. *Decide the grants.* Requiring MOD-67 (IAM administration) to read a picker of
   colleagues is a heavy gate for naming a validator. Either Operations gets a
   narrow read, or the picker moves to an endpoint scoped to "users who could
   validate this document" — which is the question the form is actually asking.

---

#### F-GAP-11 — The permission matrix cannot save any grant that already exists
**Severity: high.** Found while testing the walkthrough, 2026-08-31.

`PUT /api/tenant/permissions/grant` answers
`VALIDATION_ERROR — Unrecognized key(s) in object: 'permission_id'` for every
cell that already has a grant row. The RBAC grant matrix — the screen a tenant
uses to fix any permission problem, including F-GAP-10 — is unusable.

The chain:

1. `fetchPermissions()` calls `GET /permissions/matrix`, whose repo returns full
   database rows **including `permission_id`** (`permission.repo.js:93`,
   `RETURNING *`).
2. The client types them as `Grant` — a 7-field type with no `permission_id`
   (`client/src/lib/rbac.ts:15-23`). TypeScript does not strip keys at runtime;
   the property is still on the object.
3. `toggle()` spreads it straight into the request body
   (`permission-matrix-page.tsx:213`):
   `const next: Grant = { ...current, [perm]: !current[perm] };`
4. The server validator is `.strict()` (`permission.validator.js:38`) and
   rejects the unknown key with 422.

**Both halves are individually right.** The `.strict()` was added deliberately,
and the validator's own comment gives the reason: a misspelled `can_aprove`
would otherwise be silently dropped and the grant written as `false` — "on the
permission matrix specifically, a silently-dropped flag is a privilege change
nobody asked for". That reasoning is correct. The client is the side at fault.
What is missing is that nobody exercised the two together.

**The tell that confirms the mechanism.** A cell with *no* existing row saves
fine, because `emptyGrant()` constructs a clean 7-field object. But line 219
then stores the server's response — which came back via `RETURNING *` and
carries `permission_id` — so the **second** toggle of that same cell fails. Save
once, then never again.

**Fix (one line, client side):** send only the contract fields.

```ts
export const upsertGrant = (g: Grant) =>
  tenant<Grant>("/permissions/grant", {
    method: "PUT",
    body: {
      role_id: g.role_id, module_key: g.module_key,
      can_create: g.can_create, can_read: g.can_read, can_update: g.can_update,
      can_delete: g.can_delete, can_approve: g.can_approve,
    },
  });
```

`client/scripts/check-schemas.mjs` exists to catch exactly this class of
client/server schema drift (cited in `packages/shared/schemas/entity-common.js`)
but evidently does not cover this route. Widening it is the durable fix; the
snippet above is the immediate one.

**Workaround while unfixed** — direct SQL, then wait 30s for the identity cache
(or restart the API):

```sql
UPDATE permission SET can_approve = true
 WHERE module_key IN ('MOD-03','MOD-04')
   AND role_id = (SELECT role_id FROM role WHERE code = 'SUPER_ADMIN');
```

---

#### F-GAP-10 — No role can approve a client/supplier change request, so a CEO-raised one deadlocks forever
**Severity: high.** Found while testing the walkthrough, 2026-08-31.

Activating a client or supplier in **Live** opens a maker-checker
`party_change_request` (`master/_shared/change-request.service.js`). Applying it
requires `POST /clients/:id/change-requests/:crid/approve`, gated on
`requirePermission("MOD-03", "approve")` (`client_master.routes.js:44`; MOD-04
the same).

The default permission seed grants `can_approve = false` on MOD-03 and MOD-04 to
**every role without exception** — `9021_seed_default_permissions.sql:66-75`:

```sql
JOIN (VALUES ('SUPER_ADMIN', true, true, true, true, false),
             ('CEO',        false, true, false, false, false),
             ('MANAGEMENT', false, true, false, false, false),
             ('FINANCE',     true, true, true, false, false),
             ('ACCOUNTANT',  true, true, true,  true, false),
             ('SALES',      false, true, false, false, false),
             ('OPERATIONS', false, true, false, false, false)
     ) AS v(role_code, c, r, u, d, a)
CROSS JOIN (VALUES ('MOD-01'),('MOD-03'),('MOD-04'),('MOD-05'),('MOD-09'),('MOD-10'))
```

The last column is `can_approve`. It is `false` on all seven rows.

**This is not a typo in the seed.** The file header records that it is a faithful
transcription of the 18-row role × module-group access matrix in
`SmartLS_SuperAdmin_User_Journey_and_RBAC.docx`, and its legend treats `approve`
as a distinct grant type it knows how to emit (`can_read=t, can_approve=t` — it
does exactly that for CEO on MOD-67/68 twelve lines above). The matrix's master-
data row (RBAC doc line 231) simply assigns approve authority over clients and
suppliers to **nobody**.

So the defect is not a missing boolean. It is that the **governed party
change-request flow requires a grant the access model never contemplated**. The
maker-checker flow on client/supplier activation was built after the matrix was
written, gated on `MOD-03 approve`, and nothing went back to ask the access model
who was supposed to hold it. Design intent and implementation disagree, and the
seed is faithfully implementing the older of the two.

So the **only** account that can approve one of these is a CEO, and only via the
`is_ceo` bypass (`rbac.js:84`), which returns before any grant is consulted.

**The deadlock.** Maker-checker forbids the requester from approving their own
change (`assertNotRequester`, `SELF_APPROVAL`). Therefore:

| Who raised it | Who can approve |
|---|---|
| Anyone except the CEO | The CEO only |
| **The CEO** | **Nobody. Ever.** |

A client or supplier activated by the CEO is stuck in `Pending approval`
permanently. There is no second path: party changes are **not** in the workflow
engine's `on-approved.js` dispatch map, so the approvals queue cannot apply them
either — the change-request table is authoritative, exactly as its header
comment says.

This is near-certain to bite every new tenant, because the CEO/founder account
is the one that does the initial master-data setup.

**Workaround, no code change:** Security → Permissions → grant `approve` on
MOD-03 and MOD-04 to Tenant Super Admin (and probably Management/Finance), then
approve from a second account that did not raise the change.

**The fix is a product decision, not a one-line change.** Someone has to answer
"who approves a change to a client's legal name, tax number or credit limit?" —
and the honest candidates point in different directions:

- **Management / Finance** — the business owners of credit limits and tax
  identity. Fits the spirit of segregation of duties: the people accountable for
  the exposure approve changes to it.
- **Tenant Super Admin** — pragmatic, and the role already holds full CRUD on
  these modules. But it cuts against the Watch-the-Watcher principle in PRD §5.7,
  where the administrator configures access rather than approving business
  records.
- **Nobody, and drop the gate** — decide that activating a client is not a
  maker-checker event at all, and reserve the governed flow for bank-account and
  tax-identity changes, which is where the BEC-fraud reasoning in the service's
  own header actually bites.

Whichever is chosen needs the seed updated, a repair migration for provisioned
tenants, **and** the RBAC source document amended so the matrix and the code stop
disagreeing. Fixing only the seed would leave the next person to re-derive
permissions from the docx and silently undo it.

Compounded by **F-GAP-09**: the deadlock presents as "You don't have permission
to do this", so the operator cannot tell a missing grant from maker-checker and
has no way to reach either explanation from the screen.

---

#### F-GAP-09 — Every 403 is flattened to one generic message, discarding actionable server text
**Severity: medium.** Found while testing the walkthrough, 2026-08-31.

`client/src/lib/use-resource.ts:65`:

```ts
if (e.status === 403) return "You don't have permission to do this.";
```

The server's message is thrown away for **every** 403. The security layer goes to
real trouble to write messages that tell the user what to do next:

| Server code | Server message | What the user sees |
|---|---|---|
| `SELF_ROLE_CHANGE` | "You cannot change your own roles. Ask another administrator." | "You don't have permission to do this." |
| `SELF_GRANT_FORBIDDEN` | "You cannot grant yourself the APPROVER authority — another administrator must (maker-checker)." | same |
| `ROLE_ESCALATION` | "You cannot grant *Finance* because you do not hold it." | same |
| `PRIVILEGED_TARGET` | "Only a CEO can set a CEO's password…" | same |
| `NOT_ELIGIBLE` | "This step requires the APPROVER authority" | same |

Observed symptom: an administrator editing their own user record is told they
lack permission, when in fact the rule is that **nobody** may change their own
roles — a rule they can satisfy in ten seconds from a second account, if only
they were told what it was. Instead it reads as a broken permission system, and
the natural next move is to go hunting for the grant that is "missing".

This is the same defect the file itself already documents one screen down
(lines 145-165), where a 403 rendered as a feature-flag problem and sent
administrators to a dashboard toggle that was already on. `errCode()` was added
to expose the discriminator, but `errMsg()` still flattens the message, so the
fix did not reach this path.

Worth noting the asymmetry: 422 validation errors **are** surfaced field by
field, two lines below. Only 403 is blanked — the one class of error where the
server most reliably knows the remedy.

Suggested shape of a fix: return `e.message` when the server supplied one, and
keep the generic string only as the fallback for a 403 with no message body.

---

#### F-GAP-08 — Minor doc/code mismatches
**Severity: low.**

- `purchase_order.routes.js:1` — header says "feature procurement.core"; the
  export is `feature: null`, so the module is ungated.
- PRD Appendix C names the companion KB `SmartLS_OHADA_Accounting_Tax_KnowledgeBase.md`;
  the file in `doc/` is `OHADA_KB.md`.
- PRD §5.2 prescribes a pnpm/Turborepo monorepo (`apps/api`, `apps/web`,
  `apps/workers`, `packages/shared`); the repository is `src/`, `client/`,
  `platform-console/`, `public-web/`, `packages/shared`.

---

## Part 3 — Still open

| # | Question | Why it matters |
|---|----------|----------------|
| 1 | RAG: amend §10.1, or remove the vector store? | Decides whether F-GAP-05 is a feature to audit or a violation to fix |
| 2 | MySQL → PostgreSQL migration: who owns it, and when? | PRD §16 says client-owned after build; the transcript treats it as a team work item. Undecided |
| 3 | Should `permission.can_approve` be covered by the self-grant maker-checker? | The alternative to fixing F-GAP-02 route-by-route; a systemic fix, but a wider blast radius |

---

## Appendix — What this audit did not cover

- Test *quality* (431 backend / 134 client files were counted, not assessed)
- The frontend build gates (`check:palette`, `check:contrast`, `check:motion`,
  `check:docs`) were not executed
- OHADA correctness against the KB — the invariants were checked structurally,
  not the account mappings themselves
- Performance and the §14 non-functional targets
- Depth review of individual module business logic beyond the invariant paths

_Prepared 2026-08-31. Findings only — no code was modified._
