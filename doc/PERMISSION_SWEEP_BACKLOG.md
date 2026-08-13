# Permission-shape sweep — backlog

Raised 2026-08-02 after the same defect surfaced four times in one testing
session. Not urgent individually; systemic together. Nothing here is fixed
unless marked **FIXED**.

## The pattern

An action ordinary staff must perform sits behind a permission only an
administrator holds, because the route was written from the perspective of the
screen the code lives on rather than the person using it. It is invisible in
development because everyone tests as CEO, who bypasses RBAC entirely.

Four confirmed instances, all found by one non-admin user trying to raise and
submit a purchase request:

| #   | Route                                                           | Was gated on         | Should be                             | Status                                   |
| --- | --------------------------------------------------------------- | -------------------- | ------------------------------------- | ---------------------------------------- |
| 1   | `GET /scopes/tree` (department picker)                          | MOD-67 IAM view      | any signed-in user                    | **FIXED** — split into `/scopes/options` |
| 2   | `POST /document-templates/:docType/preview` (every View button) | MOD-70 Settings view | the module owning the doc type        | **FIXED** — `moduleKeyForDocType`        |
| 3   | `POST /purchase-requests/:id/transition` (Submit)               | MOD-62 **approve**   | `edit` to submit, `approve` to decide | **FIXED** — per-target-state             |
| 4   | `GET /catalogue/modules`                                        | MOD-67 IAM view      | —                                     | open, see below                          |

---

## A. Submit-gated-as-approve

`POST /:id/transition` (and siblings) requiring `approve` for EVERY target
state means the requester cannot advance their own draft. Since maker-checker
landed this is self-defeating: only an approver can submit, and maker-checker
then forbids that person from approving what they submitted, so the document
cannot move at all.

**ALL FIXED 2026-08-02** via `shared/http/transition-permission.js` — a
`TRANSITION_ACTION` map per module, mounted after the validator so the target
state is checked against the enum before it selects a gate. Unmapped states fall
back to `approve`, so a state added later fails closed.

| Module                         | Route                      | `edit` (submit)                            | `approve` (decide)                       |
| ------------------------------ | -------------------------- | ------------------------------------------ | ---------------------------------------- |
| `procurement/purchase_request` | `/transition`              | SUBMITTED, ORDERED                         | APPROVED, REJECTED                       |
| `commercial/quotation`         | `/transition`              | SENT, CONVERTED, EXPIRED                   | ACCEPTED, REJECTED                       |
| `costing/cash_request`         | `/transition`              | SUBMITTED, JUSTIFIED                       | APPROVED, REJECTED, DISBURSED            |
| `costing/costing`              | `/status`                  | SUBMIT_VALIDATION, SUBMIT_APPROVAL         | APPROVE, REJECT                          |
| `procurement/purchase_order`   | `/transition`              | ISSUED_LOCKED, RECEIVED, CLOSED, CANCELLED | APPROVED_LOCKED                          |
| `hr/payroll`                   | `/status`                  | OPEN, COMPUTED, SUBMITTED                  | APPROVED, VALIDATED, DISBURSED, REJECTED |
| `finance/final_invoice`        | `/submit`                  | (whole route → `edit`)                     | —                                        |
| `finance/tax_declaration`      | `/declarations/:id/submit` | (whole route → `edit`)                     | —                                        |

Payroll's segregation-of-duties note still holds: compute and approve remain
different permissions, which is the point — this only stops `approve` being
required to _compute and submit_.

Left alone deliberately: `quotation/accept` and `cash_request/disburse` keep
`approve` (accepting a quote and releasing money are decisions), and
`cash_request/justify` was already `edit`.

## B. Admin-module gates on shared reads

- **`GET /catalogue/modules` on MOD-67 view.** It returns the module catalogue
  (keys, names, groups) — reference data, not IAM. Anything that wants to label
  a module key needs it. Low severity while only the permission matrix consumes
  it, but it is the same shape as the scope-tree bug.
- `portal/access` on MOD-67: probably correct — granting an external party
  access IS an IAM action. Listed for completeness, not flagged.
- `branding` on MOD-70 edit: correct.

## C. Silent failures in the frontend

`try { … } finally { … }` with **no catch** — the action spins, then nothing
happens and the row is unchanged. The user cannot tell a permission error from a
validation error from a network failure.

This is how the milestone-advance 422 hid for weeks (session 17 log §6) and how
the Submit failure above presented.

**22 sites across 16 files** (the earlier "63" was a crude grep; this is the
matched count of `try { … } finally { … }` with no `catch`).

`client/src/lib/use-action.ts` now exists for this — it owns the busy id and the
error, so adopting it is three lines per screen and needs no new state:

```tsx
const act = useAction();
<Button
  loading={act.busyId === r.id}
  onClick={() => act.run(r.id, () => api.doThing(r.id).then(reload))}
>
  …
</Button>;
{
  act.error && <ErrorState message={act.error} />;
}
```

**Fixed** (all on the approval path, so a refusal is now readable):

- `procurement/pages.tsx` — purchase-request Submit
- `costing/pages.tsx` — costing Submit / Approve
- `operations/pages.tsx` — dossier advance
- `governance/pages.tsx` — the Approvals queue, which used `alert()`. The
  refusals it now produces (`SELF_APPROVAL`, `NOT_ELIGIBLE`,
  `WRONG_ACTION_FOR_STEP`) are explanations to read beside the row, not modals
  to dismiss.

**Remaining (18 sites, mechanical):** `ai-control/pages.tsx` ×3,
`comms/mail.tsx` ×2, `governance/pages.tsx` ×1 (a second, non-approval action),
`masterdata/pages.tsx` ×2, `fleet/dispatch.tsx`, `fleet/incidents.tsx`,
`hr/attendance.tsx`, `hr/pages.tsx`, `hr/trainings.tsx`,
`operations/service-types.tsx`, `wms/equipment.tsx`, `wms/inbound.tsx`,
`wms/outbound.tsx`.

Not done because the client typecheck doesn't complete in this sandbox and
eighteen unverifiable edits to working screens is a worse trade than leaving a
listed, one-pattern job. Do them behind a passing `npm run build --prefix
client`.

## D. Root cause worth fixing once

All four instances share a cause: **there is no test that exercises the product
as a non-CEO user.** The CEO bypasses `requirePermission` entirely
(`middleware/rbac.js`), so every one of these routes passes when tested by the
person who built it.

The cheapest durable fix is a smoke test that signs in as a role-limited user
and walks one document end to end — raise, submit, approve. That single test
would have caught all four before they reached a screen.
