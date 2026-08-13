# Verifying the approval chain works

A click-through that proves the workflow engine actually enforces something, plus
the SQL to diagnose it when it doesn't. Written 2026-08-02 alongside the changes
in `doc/ORGANOGRAMME_AUDIT_2026-08-02.md`.

---

## 0. Why "Awaiting me" is empty right now

The panel was not filtering. `workspace.repo.approvals` accepted a `roleIds`
argument and never used it — the SQL read _every_ `PENDING` task in the tenant.
So an empty panel does **not** mean "nothing is assigned to you"; it means
**there are no pending approval tasks at all**.

One caveat before you trust that: `safe()` in the same file swallows query
errors and returns `[]`, so a query that throws looks identical to an empty
result. If the panel is empty and the SQL below says it shouldn't be, check the
API log.

Both the panel and the Approvals queue now filter by the caller's roles and
approvable modules.

---

## 1. Run first

```bash
npm run lint
npm test
npm run build --prefix client
```

Migrations — tenant `0488`–`0494`; seeds `9022`, `9130`. `scripts/deploy.sh`'s
migrate service runs platform + tenant + seeds, or per tenant:

```bash
node scripts/db/migrate.js --slug=smartls     # confirm the actual script name
```

Then confirm the new column and grants landed:

```sql
-- 0488
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'approval_task' AND column_name = 'module_key';

-- 9022 — should return 4 module keys x roles
SELECT module_key, count(*) FROM permission
 WHERE module_key IN ('MOD-00A','MOD-63','MOD-71','MOD-72') GROUP BY 1;
```

---

## 2. Is there a chain to run at all?

This is the first thing to check, because with no workflow bound every submission
auto-approves and nothing ever reaches a queue.

```sql
-- Workflows and their steps. Expect 7 default workflows after 0469/0492/0491 (the six original events plus purchase requests).
SELECT w.name, et.key AS event, w.is_active,
       s.step_seq, s.step_kind, r.code AS role, sc.code AS scope,
       s.capability_code, s.min_amount_xaf, s.max_amount_xaf
  FROM workflow w
  JOIN event_type et ON et.event_type_id = w.event_type_id
  LEFT JOIN workflow_step s ON s.workflow_id = w.workflow_id
  LEFT JOIN role  r  ON r.role_id  = s.role_id
  LEFT JOIN scope sc ON sc.scope_id = s.scope_id
 ORDER BY et.key, s.step_seq;
```

**If this returns nothing**, `0469` failed and swallowed the error — that is
exactly the silent failure `0492` was written to repair, so re-run the migration
and watch for `WARNING [0492]` in the output.

```sql
-- Anything pending?
SELECT approval_task_id, entity_ref, module_key, assigned_role_id, status, created_at
  FROM approval_task ORDER BY created_at DESC LIMIT 20;
```

---

## 3. The click-through

**You need two users.** Maker-checker is enforced for everyone including the
CEO, so the person who raises the document cannot approve it. If your tenant has
one real account, create a second before starting — this is the single most
likely reason a legitimate approval gets refused.

### Setup (as SUPER_ADMIN or CEO)

1. **Security → Scopes → Organigramme.** Create `HQ`, then a child, e.g. `DLA`
   (Douala). The chart should nest them. A node with nobody assigned shows an
   amber "no one assigned" pill.
2. **Assign people.** Expand `DLA` and assign user B. Expand `HQ` and assign
   user A. This writes `user_scope`, which nothing in the product could do
   before today.
3. **Governance → Workflows.** Open a workflow (e.g. _Purchase order —
   approval_), **Add step**: role = Finance (or a role user B holds), part of the
   company = `DLA`, capability = Approver.
4. **Security → Permissions.** Give user B's role `approve` on the module that
   owns the document — `MOD-60` for purchase orders. This is the new per-task
   gate: MOD-67 no longer grants it.

### Prove each rule

| #   | Do this                                        | Expect                                                                                       |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | As user A, issue a purchase order              | A task appears in Approvals and in user B's "Awaiting me"                                    |
| 2   | As user A, press Approve on the PO screen      | **422 APPROVAL_PENDING** — "decide it from Approvals rather than approving it directly" (W4) |
| 3   | As user A, open Approvals and approve the task | **403 SELF_APPROVAL** — A raised it (W5)                                                     |
| 4   | As user C (in HQ, not in DLA, wrong role)      | **403 NOT_ELIGIBLE** — role or scope (W2/W6)                                                 |
| 5   | As user B (Finance, in DLA)                    | Approves; the PO moves to APPROVED_LOCKED                                                    |
| 6   | As a user in **HQ**, the parent of DLA         | Also approves — authority flows down the tree                                                |
| 7   | Add a VALIDATE step and call it with `approve` | **422 WRONG_ACTION_FOR_STEP** (W9)                                                           |
| 8   | Check user C's Approvals queue                 | The task is not listed — filtered by role + module (W12)                                     |

Test 6 is the one that proves the organigramme is real rather than decorative: a
manager one level up qualifies without being assigned to the child node.

### Amount bands

Add two steps, `≤ 1 000 000` and `> 1 000 000`, then submit a document with **no
total**. It should route through **both** — an unknown amount now means "most
scrutiny", where it previously collapsed to 0 and skipped every min-bounded step
(W10).

---

## 4. Mail (separate change)

`/mail/*` now requires `MOD-72`. Sign in as a user whose role has no MOD-72 grant
and confirm the inbox 403s; the default grants are SUPER_ADMIN, CEO, MANAGEMENT
and SALES. **If Operations or Finance staff use the mailbox in practice, widen it
in the permission matrix** — the default is deliberately narrow because that
grant reads client correspondence and can send as the company.

---

## 5. If something refuses when it shouldn't

Read the error code — each one names its cause:

| Code                           | Meaning                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `SELF_APPROVAL`                | You raised it. Use a second user.                         |
| `NOT_ELIGIBLE`                 | Wrong role, outside the scope, or missing the capability. |
| `APPROVAL_PENDING`             | A chain is live — go through Approvals.                   |
| `WRONG_ACTION_FOR_STEP`        | VALIDATE step actioned with approve, or vice versa.       |
| `PERMISSION_DENIED for MOD-xx` | No `approve` grant on the owning module.                  |
| `SCOPE_CYCLE`                  | The chosen parent sits beneath this scope.                |

A step with **no role and no scope is open to anyone** — that is every step built
before today, so existing chains keep working unchanged.
