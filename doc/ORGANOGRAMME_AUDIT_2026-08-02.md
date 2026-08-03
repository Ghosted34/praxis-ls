# Approval workflow & organigramme audit — 2026-08-02

Audit of the business/approval workflow and the organisational structure it is meant to route
through. Read against source at HEAD (`61daf1e`); every claim carries file+line evidence. No code
was changed.

> **Status — 2026-08-02, end of session.** The approval chain was proven end to end on a real tenant
> (submit → task → maker-checker refusal → second user approves).
>
> **Fixed:** C2 (mail RBAC), C3/C4 (default grants, plus MOD-71 which was catalogued but never
> granted), W1 (role + scope pickers), W2/W5/W9 (eligibility, maker-checker, step_kind), W3
> (per-module approval gating, `approval_task.module_key`), W4 (direct approve routes refuse while a
> chain is pending), W6 (scope and capability resolved at decision time), W7 (capability enforced),
> W10 (unknown amount), W11 (default-workflow repair), W12 (inbox filtered by caller, in both
> places), A1 (user↔scope assignment, backend + UI), A2 (first `scopeColumn` adopters), A3 (closure
> resolution, used by both approvals and record filtering), A4 (cycle guard), A5 (delete semantics
> split by table), C5 (`depends_on` enforced at projection), C6 (screen registry completed —
> 59 → 96 screens).
>
> **W8 resolved by W4 rather than by auto-finalising** — see the note in `purchase_order.service.js`
> for why inferring authorisation from missing configuration was the wrong default.
>
> **B1 closed later the same day (`0493`)** — `employee.reports_to`, with `directReports` / `teamOf` /
> `managerChain`. `is_line_manager` can finally resolve a team, and W13 has an escalation path to read.
>
> **Still open:** W13 (delegation, escalation, deadlines — the data now exists, the behaviour doesn't),
> B2–B4 (no position table; `job_title` is still free text, the weakness `department` had before 0490),
> C7 (`portal.*` is not a kill switch for the external surface), C8 (minor drift).
>
> **C1 is withdrawn — it was wrong** (see Part 4).
>
> Also this session, outside the original audit: departments became scopes (0490), purchase requests
> joined the approval engine (0491), the permission matrix stopped silently wiping grants it hadn't
> loaded, and 20 silent frontend handlers were made to report. See
> `doc/PERMISSION_SWEEP_BACKLOG.md`.
>
> Decisions taken with the business for this pass: approval routing is **role AND scope** (a step
> names both; null scope = tenant-wide), users must **always** go through the workflow, approval
> permission is **module-specific**, and **maker-checker is always enforced — including for the CEO**.

## Verdict

**The approval chain routes notifications, not authority.**

The schema is well designed. `workflow_step` (`0120_events_workflow.sql:32-45`) binds each step to a
role, a capability, **a scope** and an amount band — that scope reference is the organigramme link,
and it is the right design. The executor then honours exactly one of those four dimensions: the
amount band. Role and scope are dropped when the task is created; the capability overlay is enforced
nowhere in the product. Acting on a task checks only that the task is still pending — not who you
are, not whether the step named your role, not whether you raised the item yourself.

Underneath that, three structural facts make the chain unenforceable rather than merely
under-enforced:

1. **The step designer in the UI collects `capability_code` and the amount band — the two fields the
   engine ignores — and has no field for `role_id` or `scope_id`, the ones it uses.** Every step a
   tenant builds through the product is assigned to nobody and notifies nobody.
2. **Every approvable document keeps a direct approve route, exposed as a button.** One click by one
   person locks a purchase order without the chain being consulted.
3. **The org structure the chain would route through is inert** — `user_scope` is written nowhere,
   so no user is in any scope; and there is no reporting line in the HR model at all, so
   `LINE_MANAGER` ("approves for own team") has no way to resolve a team.

Net effect on a fresh tenant: an admin can design a three-step chain with thresholds and see it
rendered correctly, while in practice the CEO approves everything, anyone with the module's `approve`
grant can bypass the chain, and the person who raised the document can approve it themselves.

---

## Severity summary

| # | Finding | Sev |
|---|---------|-----|
| W1 | The step designer collects the fields the engine ignores and omits the ones it uses | **High** |
| W2 | `act()` performs no eligibility check — any approver can act on any task at any step | **High** |
| W3 | Approval authority is one global grant on the IAM module — CEO-only by seed | **High** |
| W4 | Every approvable document has a direct approve route **and button** that bypasses the chain | **High** |
| W5 | No self-approval prevention, though the requester is already resolved and maker-checker is enforced elsewhere | **High** |
| W6 | `createTask` drops `scope_id` and `capability_code` — the organigramme dimension never reaches the task | **High** |
| W7 | `requireCapability` has zero call sites — VALIDATOR/APPROVER is unenforced product-wide | **High** |
| W8 | 5 of 6 callers ignore `autoApproved` — documents stick forever when no workflow is bound | **Med-High** |
| A1 | `user_scope` is read in one place and written nowhere — no user can ever be in a scope | **High** |
| B1 | No position table, no `reports_to` — the reporting line has no data model | **High** |
| W10 | A null amount silently bypasses the whole chain via `no_applicable_step` | **Med** |
| W11 | All six default workflows route to one heuristically-picked role; the seed swallows every error | **Med** |
| W12 | The approvals "inbox" has no user or role filter — everyone sees the whole queue | **Med** |
| W13 | No delegation, escalation, deadline or reassignment; `assigned_user_id` is never written | **Med** |
| W9 | `step_kind` isn't enforced against the action, and anyone can `skip` a step | **Med** |
| A2 | `scopeColumn` has zero adopters — a populated scope would still filter nothing | **Med** |
| A5 | `DELETE` is a no-op across 32 modules incl. every RBAC screen | **Med** |
| C2–C3 | Module-map defects found on the way (mail RBAC, MOD-00A) — see Part 4 | **High** |
| ~~C1~~ | ~~MOD-71 not catalogued~~ — **WITHDRAWN 2026-08-02, was incorrect.** See Part 4 | — |

---

## Part 1 — The approval engine

The intended shape, and it is a good one: a tenant registers approvable event types, designs
`workflow` + ordered `workflow_step`s, and modules call `executor.start` when a document reaches a
decision point. Cleared chains dispatch back to the owning module through `on-approved.js` to post
the record. Six modules are wired in: costing, final invoice, cash request, purchase order, supplier
invoice, payroll — plus leave via `0468`.

### W1 — The designer collects the fields the engine ignores (High)

The step form's state is `{ step_seq, step_kind, capability_code, min_amount_xaf, max_amount_xaf }`
(`client/src/features/governance/pages.tsx:651`). **There is no `role_id` input and no `scope_id`
input.** The API accepts both (`workflow.validator.js:36,38`) and the repo persists both
(`workflow.repo.js:94,96`) — it is only the UI that omits them.

Follow the consequence through:

- `role_id` is therefore `NULL` on every UI-created step.
- `createTask` sets `assigned_role_id: step.role_id || null` (`executor.js:56-61`) → **null**.
- `notify-approvals.onTaskOpened` opens with `if (!roleId) return 0;` (`notify-approvals.js:40`) →
  **nobody is notified**.
- The task lands in a queue with no assignee, which nothing routes and nobody is told about.

So the one field that makes a step actionable can't be set from the product, and the two fields the
UI does collect are `capability_code` (dropped at task creation, W6, and unenforced anywhere, W7) and
the amount band (the only thing that genuinely works).

### W2 — Acting on a task checks nothing about the actor (High)

`executor.act` (`executor.js:99-138`) loads the task, rejects it if `status !== 'PENDING'`, and
writes the decision. It does **not** check that the actor holds `assigned_role_id`, does not check
`capability_code`, does not check `step_kind`, and does not check scope. The service and controller
add nothing (`workflow.controller.js` `actApproval` passes straight through).

The only gate is the route: `requirePermission('MOD-67', 'approve')`
(`workflow.routes.js:47`). So **anyone who can approve anything can approve everything** — any task,
any step, any document type, regardless of the chain the tenant designed. The step's role binding
survives only as the notification recipient list.

### W3 — Approval authority is a single grant on the IAM module (High)

That gate is `MOD-67` — the IAM/RBAC engine. The right to approve a payroll run, a purchase order and
a cash request is the same permission as "approve on IAM", not a per-document or per-role authority.

In the default grants, `MOD-67` `can_approve` is seeded to **CEO only**
(`9021_seed_default_permissions.sql:52-59`; SUPER_ADMIN gets CRUD with `can_approve = false`,
MANAGEMENT read-only). Since the CEO already bypasses RBAC entirely, the practical position on a
fresh tenant is: **the CEO is the only person who can act on any approval task, and no designed chain
changes that.**

### W4 — Every approvable document keeps a bypass, and it's a button (High)

Alongside the engine, each module exposes its own transition route gated by
`requirePermission(<own module>, 'approve')`:

| Document | Bypass route |
|---|---|
| Purchase order | `POST /purchase-orders/:id/transition` → `APPROVED_LOCKED` (`purchase_order.routes.js:16`) |
| Purchase request | `POST /purchase-requests/:id/transition` (`purchase_request.routes.js:15`) |
| Cash request | `POST /cash-requests/:id/transition`, `/disburse` (`cash_request.routes.js:16-17`) |
| Costing | `POST /costings/:id/status` → `APPROVE` (`costing.routes.js:15`) |
| Payroll run | `POST /payroll/:id/status` (`payroll.routes.js:24`) |
| Leave | `POST /leave/:id/decision` (`leave_allowance.routes.js:21`) |
| Supplier invoice | `POST /supplier-invoices/:id/post` (`supplier_invoice.routes.js:16`) |

These call the same transition functions the approval dispatcher calls, with **no check for a pending
`approval_task`**. `purchase_order.transition` sets `approver_id = actor.user_id` and locks the PO
(`purchase_order.service.js:69`); the comment beside `executor.start` states the position plainly —
*"the manual APPROVED_LOCKED path is unchanged"* (`:72`).

This is not API-only. `client/src/features/procurement/pages.tsx:205` renders an approve action that
calls `transitionPO(po_id, "APPROVED_LOCKED")` directly. **One user, one click, chain skipped, and
the PO records them as approver.**

Note the interaction with W8: because five of the six modules leave documents stuck when no workflow
is bound, the bypass is not merely available — it is the path that reliably works, which is likely
why it is still wired to a button.

### W5 — Nothing prevents approving your own request (High)

There is no self-approval check anywhere in `src/services/workflow/` or `src/modules/workflow/`.

The information is already there: `notify-approvals.js:72-73` resolves `requesterFor(entityRef)` and
compares it to the actor — **to decide whether to send a notification**. The same comparison is never
made to decide whether the action is allowed. `onTaskOpened` likewise takes `excludeUserId` to avoid
pinging the person who triggered the step (`:41`), so the intent is understood; only the enforcement
is missing.

The contrast inside the product is stark. Restoring a soft-deleted record enforces two-person
integrity at **both** the service layer and the database — *"The person who deleted a record cannot
restore it themselves — needs a second admin"* (`audit_ledger.service.js:50`) backed by
`CHECK (restored_by IS NULL OR restored_by <> deleted_by)`
(`0130_platform_projection.sql:71`). So the ERP enforces maker-checker on undeleting a row, and not
on approving a payroll run.

Payroll's own routes claim SoD — *"compute (edit) and approval transitions (approve) are separate
permissions so the same person can't both run and validate payroll"* (`payroll.routes.js:1-4`) — but
nothing stops a role holding both grants, so it is a naming convention rather than a control.

### W6 — `scope_id` and `capability_code` never reach the task (High)

`createTask` (`executor.js:56-61`) copies `workflow_id`, `workflow_step_id`, `entity_ref`,
`amount_xaf` and `role_id`. It drops `step.scope_id` and `step.capability_code` — and
`approval_task` has no column for either, so they cannot be recovered at decision time without
joining back to the step, which nothing does.

**This is the organigramme finding.** `workflow_step.scope_id` is the mechanism by which "the Douala
branch manager approves Douala's costings" would be expressed. It is designed, it is persisted, it is
accepted by the API — and it is discarded the moment a task is created. Even a hand-seeded,
correctly-scoped chain would route globally.

### W7 — The capability overlay is enforced nowhere (High)

`requireCapability` is implemented at `src/middleware/rbac.js:115-160` and has **zero call sites** —
the only other mention in the backend is a doc comment (`identity-cache.js:152`). VALIDATOR,
APPROVER and LINE_MANAGER are resolved, cached and exposed on the request, and no route consults
them.

Combined with W6, `capability_code` is dead twice over: dropped at task creation, and unenforceable
even if it survived. It is nonetheless the field the step designer makes most prominent
(`pages.tsx:673-684`), which is how a tenant ends up believing segregation of duties is configured.

### W8 — Five of six callers ignore `autoApproved` (Med-High)

`executor.start` returns `{ autoApproved: true }` when no workflow is bound or no step matches the
amount (`executor.js:82-84`) — the contract being "this record needs no approval, finalise it".

`final_invoice.service.js:113-116` honours it: `if (started.autoApproved) posted = await postCore(…)`.

The other five discard the return value entirely — `costing.service.js:74`,
`cash_request.service.js:71`, `payroll.service.js:119`, `purchase_order.service.js:73`,
`supplier_invoice.service.js:67`. So with no workflow bound, those documents move to
`SUBMITTED_FOR_APPROVAL` (or equivalent), no approval task is created, nothing auto-finalises, and
**the record sits in a submitted state permanently** — invisible in the approvals queue because no
task exists.

`0469_default_workflows.sql` was written to paper over exactly this (*"with no workflow bound they
auto-approve and never reach the inbox"*) by seeding a default chain for all six events. But the same
migration invites admins to *"retune/disable these in the Workflow designer"* — and disabling one
re-opens the trap.

### W9 — `step_kind` is advisory, and anyone can skip (Med)

`act` maps the caller's action straight to a status
(`ACTION_STATUS = { validate, approve, reject, skip }`, `executor.js:91`) without comparing it to
`step_kind`. A VALIDATE step can be cleared with `approve` and an APPROVE step with `validate`; both
advance the chain identically. The FE only *offers* the matching verb
(`governance/pages.tsx:860`), so this is an API-level gap.

`skip` sets `SKIPPED` and advances to the next step with no distinct permission and no reason
required — a documented escape hatch from any mandatory stage, available to every approver.

### W10 — A null amount can bypass the chain silently (Med)

`stepApplies` treats a null amount as `0` (`executor.js:21`). If every step in a workflow carries a
`min_amount_xaf`, a document arriving with a null amount matches no step, `applicable.length === 0`,
and `start` returns `{ autoApproved: true, reason: "no_applicable_step" }` (`:84`).

Several callers can legitimately pass null — `cash_request.service.js:71`,
`payroll.service.js:119`, `purchase_order.service.js:73` and `supplier_invoice.service.js:67` all
pass `null` when the total is null/undefined. So a document with a missing total skips approval
entirely, and (per W8) four of those five callers don't even look at the result that told them so.
A threshold-banded chain should treat "amount unknown" as *needs the highest approval*, not *needs
none*.

### W11 — The default workflows are one role and a silent failure (Med)

`0469_default_workflows.sql:26-31` picks a **single** role for all six default chains —
`FINANCE`, else `MANAGEMENT`, else `CEO`, else any role, ordered by `is_system` — and inserts one
APPROVE step per workflow with that role. So payroll, purchase orders, supplier invoices, costings,
cash requests and invoices all route to the same role at every value.

The whole block is wrapped in `EXCEPTION WHEN OTHERS THEN NULL` (`:51-53`). If it fails for any
reason, the migration reports success, no workflows exist, and the system lands in the W8 state with
nothing logged. Defensive-by-design is reasonable in a migration; silent is not — this should at
minimum `RAISE WARNING`.

### W12 — The approvals inbox is not an inbox (Med)

`approval_task` is introduced in schema as *"approvals waiting on me"*
(`0120_events_workflow.sql:62-63`). `repo.listApprovals` filters on `status` and nothing else
(`workflow.repo.js:110-118`) — no filter on the caller's role, scope, or user. Every user with
`MOD-67` view sees **every pending approval in the tenant**, and the FE tiles count the whole queue
(`governance/pages.tsx:874-875`).

Given W1 leaves `assigned_role_id` null on UI-created steps, there is currently nothing to filter
*by* — the two findings have to be fixed together.

### W13 — No delegation, escalation, deadline or reassignment (Med)

`approval_task.assigned_user_id` exists (`0120:70`) and is **never written** — `createTask` sets only
`assigned_role_id`. There is no deadline or SLA column, no escalation path when a task ages, no
delegation for absence, and no reassignment endpoint. For an ERP whose approval chain can block
invoicing and payroll, "the only approver is on leave" has no answer in the model.

This is the natural place the org hierarchy would be used — escalate to the approver's manager — and
is blocked on B1.

---

## Part 2 — Why the chain cannot route by organisation

`workflow_step.scope_id` points at `scope`, whose `parent_scope_id` is commented *"the organigramme
tree"* (`0110_rbac.sql:33`) and described to users in those words on the Scopes screen
(`client/src/features/security/pages.tsx:638`). This is the ERP's organigramme. It is drawn and not
wired.

**A1 — `user_scope` is written nowhere (High).** Declared at `0110_rbac.sql:75-78`, read at exactly
one place — `identity-cache.js:127` — and there is **no INSERT anywhere in `src/` or
`client/src/`**. The scope module is CRUD on the tree only (`scope.routes.js`); no assignment
endpoint, no user picker on the screen. So `getUserScopeIds` always returns `[]`, `req.scope_ids` is
always null (`rbac.js:109`), which is deliberately treated as unrestricted. **No user is in any
scope, and none can be put in one through the product.**

**A2 — `scopeColumn` has zero adopters (Med).** The filter works
(`shared/crud/resource.js:35-37`); no repo declares it. The only other occurrences are two comments
in `rbac.js`. A1 leaves the mechanism with no input; A2 leaves it with no output.

**A3 — Scope resolution doesn't walk the tree (Med).** `identity-cache.js:127` selects direct
`user_scope` rows with no recursive CTE over `parent_scope_id`. A regional manager assigned to `HQ`
would get nothing on the branches beneath it. Without a recursive resolve, the hierarchy is a flat
list with an indent.

**A4 — No shape validation (Med).** `scope.validator.js` is a one-line re-export of
`validate.passthrough`. Nothing rejects a parent cycle or a bad `entity_id`; the FE only excludes the
node being edited from the parent dropdown (`pages.tsx:635`). Fix this *before* A3 lands — a cycle
becomes an infinite loop the moment anything walks the tree.

**A5 — `DELETE` is a no-op across 32 modules (Med).** `scope.repo.js:3` sets `activeColumn: null`,
and the shared archive only deactivates `if (repo.cfg.activeColumn)`
(`shared/crud/resource.js:87`); otherwise it writes a `soft_delete` row and returns
`{ archived: true }` without touching the record. 32 modules set `activeColumn: null`; 17 expose
DELETE through the shared archive, and the 14 that override it (checked individually — e.g.
`iam_role:19-24`, `permission:35-39`, `capability:19`, `field_visibility:19`, `scope`,
`hr/succession:35-40`, `fleet/vehicle:55-60`) add protections or cache invalidation and still never
delete. **Deleting a role, a permission grant, a capability or a scope reports success and changes
nothing.** For `session`/`audit_ledger` a non-deleting DELETE may be correct and should return 405;
for the RBAC modules it is a bug.

---

## Part 3 — The people hierarchy

**B1 — The reporting line has no data model (High).** `employee`
(`0300_masterdata.sql:50-67`) has `department text` and `job_title text` — free strings — and **no
`reports_to`, no `manager_id`, no `position_id`**. There is no department table and no position table
anywhere in the tenant schema. Because `department` is unconstrained, `employees.repo.js:43` filters
on exact string equality, and `vacancy.service.js:62-63` copies the vacancy's free-text department
onto the employee at hire, propagating whatever spelling was typed.

**B2 — `is_line_manager` promises a team nothing can resolve (High).** The flag exists
(`0110_rbac.sql:15`), is seeded as *"Line Manager — approves for own team"*
(`9020_seed_rbac_events.sql:10`), is resolved through the identity cache
(`identity-cache.js:170-185`) and is checkable via `requireCapability('LINE_MANAGER')`
(`rbac.js:155`) — which, per W7, is called nowhere. With no subordinate relation (B1) and no scope
membership (A1), "own team" is unanswerable, so the flag could only ever mean *approves everything of
this type*. `approval_task` confirms the design settled for that: assignment is to a **role**
(`assigned_role_id`), never to a person or an org node.

**B3 — Succession points at strings (Med).** `succession_plan` (`0360_hr_breadth.sql:114-122`) keys
on `role_title text` with employee FKs for incumbent and successor. The role being succeeded is
unlinked to any position record, so a plan can name a role nobody holds and a retitle silently
orphans it.

**B4 — Three unlinked answers to "where does this person sit" (Med).** The scope tree (RBAC,
unpopulated), `employee.department`/`job_title` (HR, free text, actually used), and `role`/`user_role`
(what actually decides authority). `app_user.employee_id` (declared `0100_identity.sql:42`, FK
back-wired `0300_masterdata.sql:70`) is the only bridge, and it links an account to a person — not a
person to a place in the org. The HR view and the security view of the organisation cannot be
reconciled.

---

## Part 4 — Defects found on the way (not workflow, but blocking)

**C1 — WITHDRAWN. This finding was wrong.**

The original claim was that `MOD-71` (used by `hr_query.routes.js:16` and `hr_sanction.routes.js:12`)
appeared nowhere in the catalogue, making HR discipline permanently CEO-only. **That is false.**
`migrations/seeds/9120_hr_discipline_module.sql:4-6` inserts it:

```sql
INSERT INTO platform.module_catalogue (module_key, group_key, name, sort_order, is_core) VALUES
 ('MOD-71','hr','HR Discipline (Queries & Sanctions)',28,false)
ON CONFLICT (module_key) DO NOTHING;
```

Idempotent, correctly grouped under `hr`, and committed in `c14babb` — **the same commit as the
modules themselves**. The author followed the session-17 convention exactly; the audit accused them of
breaking it. Withdrawn with apologies to whoever reads this next.

**How the error happened, because it affects how much of this document to trust.** The Linux sandbox
mounts the Windows working folder over a network filesystem whose page cache goes stale — the
condition documented at the end of `SESSION_HANDOFF.md`. Four separate `grep -r` runs over
`migrations/` returned no match for `MOD-71` and a directory listing that omitted `9120` entirely;
the file was created 2026-07-30 and was invisible to the mount. It surfaced only when read through
the Windows-side file tools.

**Re-verification performed.** Every other claim in this document that asserts an *absence* was
re-checked through the Windows file tools rather than the sandbox: `user_scope` written nowhere (A1),
`scopeColumn` zero adopters (A2), `requireCapability` zero call sites (W7), `autoApproved` consumed
only by `final_invoice` (W8), no `role_id`/`scope_id` anywhere in the governance FE (W1), no
self-approval guard in `src/services/workflow/` (W5), and no grant for `MOD-00A`/`MOD-63` in any
migration (C3/C4). **All confirmed.** A full `migrations/**/*.sql` listing taken through the file
tools matched the sandbox's view except for `9120` — that was the only file the mount hid.

The residual risk is confined to negative claims about files created since roughly 2026-07-29 that I
did not individually re-check. The positive findings (code that exists and behaves a certain way)
were read directly and are unaffected.

**C2 — The `mail` module has no authorisation (High).** `src/modules/mail/mail.routes.js` mounts 20
routes behind `authMiddleware` and nothing else — **zero `requirePermission` calls in the module**,
and `feature: null` so no feature gate either. Any authenticated user can read the inbox, any thread
and its attachments, any client's full correspondence timeline, and `POST /mail/send` **as the
company mailbox**. Arrived in commits `5da0c2c`/`155a817` (2026-08-02); in no doc.

**C3 — The Control Tower 403s for every non-CEO on a fresh tenant (High).**
`dashboard.routes.js:10-13` gates the home KPIs and control-tower payload on `MOD-00A`, which the
grant seed deliberately doesn't seed (`9021:33-35`). Same for `MOD-63`, which is all of Reporting
(`report.routes.js:12-18`). The decision is documented; the consequence appears untraced — session
17's fresh-tenant walkthrough ran as CEO, which bypasses RBAC.

**C4 — Nine seeded features are enforced nowhere**, including `hr.payroll`, `procurement` and
`sales.crm` — three of them parents of children that *are* gated. `sales.crm`, `sales.proposals` and
`sales.marketing` default to `off`, so the console shows Sales/CRM disabled for every tenant while
the routes serve normally. This is the known `depends_on` gap with a sharper edge: the parents aren't
merely unconsulted by `projectFeatures()`, they're unenforceable, so fixing projection alone won't
gate the HR or Sales branch.

**C5 — `screen-registry.json` describes about half the app** (59 screens; operations, sales,
commercial, costing, procurement, vault, comms, portal and most of settings are absent), and
`src/services/ai/knowledge/codebase.js:49-57` ingests it as the AI's map of the product. The
assistant cannot route a user to any Operations or Sales screen because it doesn't know they exist.

**C6 — `portal.*` gates the staff preview but not the external surface.** `portal.routes.js:25-27`
applies `requireFeature`; the external equivalents at `portal_auth.routes.js:37-40` carry only
`portalAuth(role)`. Turning `portal.client` off stops staff previewing, not clients reading — so the
flag is not the kill switch an operator would reach for.

---

## Recommended order

**Decide one thing first, because most of Part 1 depends on the answer: does approval authority
follow the organisation chart, or the role matrix?** Everything below assumes the org chart, since
that is what `workflow_step.scope_id` and `is_line_manager` were built for. If the answer is the role
matrix, then `scope_id`, `user_scope`, `parent_scope_id`, `is_line_manager` and `scopeColumn` should
be explicitly marked dead rather than left looking implemented — today the security UI presents five
controls that do nothing.

1. **W2 + W5 + W3 — make a decision mean something.** In `executor.act`: verify the actor holds the
   step's `assigned_role_id`, verify the capability if the step names one, reject the requester as
   approver, and check `step_kind` against the action (W9). Move the route gate off `MOD-67` onto
   something per-document. These are small, local, and everything else is worth less without them.
2. **W4 — close or justify the bypasses.** Either the direct transition routes refuse while a pending
   `approval_task` exists on the entity, or they are documented as a deliberate emergency path with
   its own permission and a loud audit entry. Fix W8 first or the bypass is the only working path.
3. **W8 + W10 + W11 — make absence safe.** Honour `autoApproved` in the five callers that ignore it,
   treat a null amount as needing the *highest* band rather than none, and let `0469` warn on failure.
4. **W1 + W6 + W12 — reconnect the designer to the engine.** Add role and scope pickers to the step
   form, carry both onto `approval_task`, then filter the inbox by the caller. Until W1 lands there
   is nothing to filter by.
5. **A1 + A3 + A4 — make the organigramme real** if the answer to the opening question was "org
   chart": user↔scope assignment in the UI, a recursive resolve over `parent_scope_id`, and a cycle
   guard before the walk.
6. **B1** — a position/reporting-line model on `employee`, which is what W13 (delegation and
   escalation) and `LINE_MANAGER` both need.
7. **C2, C3** in parallel — unrelated to workflow, but C2 is an open authorisation hole on a live
   module and shouldn't queue behind design decisions. (C1 withdrawn — it was never a defect.)

---

## Method

Read at HEAD `61daf1e` on 2026-08-02. The module/feature/screen cross-checks were scripted against
`9100_seed_platform_catalogue.sql`, `9110_seed_platform_features.sql`,
`9021_seed_default_permissions.sql`, all 102 `*.routes.js` files and
`client/src/app/screen-registry.json`; the workflow findings were read directly in
`0120_events_workflow.sql`, `0467`–`0469`, `src/services/workflow/*`, `src/modules/workflow/*`, the
six integrating module services and `client/src/features/governance/pages.tsx`. Every finding was
re-opened at source and confirmed by hand. Nothing was executed against a database — the runtime
claims (403s, stuck documents) are read from the code paths and seeds, and are worth confirming
against a provisioned tenant **as a non-CEO user**, which is the single test that would surface W3,
C1 and C3 at once.

No code was changed and no documentation was updated. `SESSION_HANDOFF.md` still describes the repo
as of session 18 and does not cover migrations `0483`–`0486` or the mail/AI-schema work merged on
2026-08-01/02.
