# Approvals, Workflow & Organigramme — fix plan

**Status:** plan for review (draft before fix, per request).
**Symptom reported:** a leave request exists, but **Approvals** shows "nothing pending approval".

---

## 1. What exists today (research)

The universal approval engine is real and partially wired:

- **Schema:** `event_type` (with `is_approvable`), `workflow` (binds to one approvable event type), `workflow_step` (ordered; `action` VALIDATE|APPROVE, `role_id`, scope, `min/max_amount_xaf`), `approval_task` (runtime queue).
- **Executor** (`src/services/workflow/executor.js`): `start({ eventTypeKey, entityRef, amountXaf })` opens the first applicable task **only if** an active workflow is bound to that approvable event and a step applies; otherwise returns `{ autoApproved: true }`. `act()` advances/completes. On final approval, `services/workflow/on-approved.dispatch()` tells the module to post/finalize.
- **Admin API** (`/workflows`, `/event-types`, `/approvals`): the Workflow designer + the runtime queue. `ApprovalsPage` reads `/approvals?status=PENDING`; `WorkflowsPage` reads `/workflows`.
- **Modules already integrated** (they call `executor.start`): payroll, final invoice, costing, cash request, supplier invoice, purchase order.

## 2. Root causes (why Approvals is empty)

1. **No workflows are configured.** With no `workflow` bound to an approvable `event_type`, `start()` returns `autoApproved` for _every_ event — so even the six integrated modules create **zero** approval tasks. The queue is structurally empty until a tenant designs workflows.
2. **Leave (and most Phase-3 workstations) never call the engine.** Leave uses its own `/leave/:id/decision` (REQUESTED→APPROVED/REJECTED). Same for the transitions I built recently (contracts, incidents, dispatch, work orders, cycle counts, outbound, appraisal reward). None open an `approval_task`, so they can never appear in the central inbox — regardless of config.
3. **No organigramme.** The `employee` table has no `reports_to`/manager column. Steps can only route to a **role**, never to "the requester's manager". There is no org-chart anywhere, so approval routing can't follow reporting lines.

So the reported bug is the intersection of (1) + (2): leave doesn't feed the engine, and the engine has no config even if it did.

## 3. Target design

- **Organigramme:** add `employee.reports_to` (self-FK) + optional department head; render an **org chart** (Employee 360 gains a "manager"/"direct reports" view). Introduce a step `assignee_type` = `ROLE | MANAGER | USER` and teach the executor to resolve `MANAGER` to the requester's manager's user account at task-open time.
- **Configured, seeded workflows:** ship sensible **default workflows** for the core approvable events, editable in the Workflow designer, so the system works out of the box: leave, salary advance, payroll run, sales/final invoice, purchase order, cash request.
- **Universal integration:** one thin helper every module calls on its "submitted for approval" event (or an emit-side hook keyed off `event_type.is_approvable`). On completion, `on-approved.dispatch` runs the module's finalize; on reject, the module goes REJECTED. The module's own status becomes a projection of the `approval_task` outcome — single source of truth.
- **Approvals inbox UX:** decorate each task with a human summary (what/who/amount), filter to the current user (role/scope/manager), a pending **count badge** in the nav, and act-with-note.

## 4. Phased delivery

**Phase 0 — Seed config (unblocks the six integrated modules).**
Register approvable `event_type`s and seed default `workflow` + `workflow_step`s (role-based) for payroll, invoice, PO, cash request. Immediately, those submissions start showing in Approvals. Migration + idempotent seed.

**Phase 1 — Leave → engine (fixes the reported symptom).**
On leave submit, call `executor.start("leave.requested", entityRef, amount)`. On approve/reject completion, `on-approved` sets the leave row APPROVED / the reject path sets REJECTED. Keep the Leave queue screen, but it reads the same task state. Result: a submitted leave request appears in Approvals for the right approver.

**Phase 2 — Organigramme.**
Migration `employee.reports_to`; Employee 360 manager picker + "direct reports"; a dedicated **Org chart** screen (People & HR tab). Add `assignee_type=MANAGER` resolution in the executor so leave routes to the requester's line manager, then falls back to a role.

**Phase 3 — Extend to remaining approvable transitions.**
Contracts sign-off, high-value dispatch, damaged-stock write-off, etc. — opt each in via config, not code, using the universal helper.

**Phase 4 — Inbox polish + notifications.**
Entity decoration, nav count badge, filters, and a notification on task assignment/decision.

## 5. Data-model changes

- `ALTER TABLE employee ADD COLUMN reports_to uuid REFERENCES employee(employee_id);`
- `ALTER TABLE workflow_step ADD COLUMN assignee_type text NOT NULL DEFAULT 'ROLE';` (+ optional `assignee_user_id`).
- Seed migration: approvable `event_type` rows + one default `workflow` + steps each for leave, advance, payroll, invoice, PO, cash.

## 6. Open decisions (need a call before build)

1. **No-workflow default:** keep today's **auto-approve** (frictionless) or switch to **auto-hold** (nothing passes without an approver)? Recommend: keep auto-approve, but seed defaults so the common cases are covered.
2. **Approver when manager is unset:** fall back to a role (e.g. HR Manager) — confirm the role names per tenant.
3. **Amount basis for leave:** leave has no XAF amount; salary advances do. Route leave by type/duration instead of amount (add a non-amount routing key), or keep a single step.
4. **Migrate existing module transitions** (do we retrofit contracts/dispatch/etc. now, or only leave + finance for v1?).

## 7. Suggested order

Phase 0 + Phase 1 first (config seed + leave wiring) — this is what makes "nothing pending" go away and demonstrates the loop end to end. Then Phase 2 (organigramme) for real routing, then 3–4.
