# PR — Session 9: Security CRUD + Security/Vault hubs, Control Tower drill-downs, Governance, reconciliation, merge fields

_Branch scope: **security + vault + governance + dashboard**, plus two BE jobs (MOD-52, MOD-22).
Companion context: `doc/SESSION_HANDOFF.md` (session-9 log), `doc/WORK_DONE.md`, `doc/FE_IA_BUILD_MAP.md`._

## Summary

Builds out **Security & access** from read-only stubs to full CRUD, wraps Security and Vault in hubs,
finishes the **Governance** pair, puts the **Control Tower KPI drill-downs** on real data, and lands two
BE jobs. Validated as far as the sandbox allows: **`tsc --noEmit -p client` clean; `node --check` +
`eslint` clean (0 errors) on changed BE files.**

> ⚠️ **`npm test` did not run in the sandbox this session** (jest hangs with no output). Five new cases in
> `tests/unit/campaign-send.test.js` have **never executed** — please run `npm test` on Windows before
> merging. The logic beneath them was verified directly via `node -e`.

## ✅ No migrations

Nothing in this PR requires a schema change. `GET /receivables/overdue` deliberately adds **no new SQL** —
it reuses the existing `smart_receivables.repo.openInvoices`.

## Context: an audit correction

The trigger was the FS colleague's note that "modules under fleet, security, warehouse, vault, vehicle and
hr aren't built — collapse into tabs like the finance screen", with security + vault assigned to this
stream. On inspection:

- **Vault was already built** — all five pages shipped in session 8. It needed a hub, nothing more.
- **Security was not** — `features/security/pages.tsx` was 104 lines of `ResourceList` stubs, as its own
  header stated. It needed building.

The confusion traced to `FE_IA_BUILD_MAP.md` §4 conflating *a screen exists at that route* with *the screen
works*. That section is corrected in this PR, and now flags stubs explicitly — including **`AssetsPage`,
still a stub inside the otherwise-built `features/finance/pages.tsx`**, which `/finance/assets` routes
straight at. That one is in the finance owner's lane and wasn't among the four areas named.

## What's in it

**Security & access — full CRUD** (`features/security/pages.tsx`, 104 → 872 lines)
- **Users** — create/edit, role assignment as toggle chips, status via the separate audited
  `POST /users/:id/status`, password via `/users/:id/password`. The edit modal re-fetches `GET /users/:id`
  because the list endpoint's `SAFE_COLS` omits `role_ids`.
- **Roles** — `code` locked on edit; delete disabled for `is_system` rows.
- **Capabilities** — `code` constrained to the four values the DB CHECK allows.
- **Scopes** — entity picker, parent-scope select excluding self.
- **Field visibility** — gated **`approve`, not `edit`**, matching the router.
- **Sessions** — mine + all, per-row revoke, revoke-all (replaces the self-only stub).
- Dead `PermissionsPage` export dropped; `app.tsx` always used `permission-matrix-page.tsx`.

**Hubs** (`features/security/hub.tsx`, `features/vault/hub.tsx`)
- FinanceHub-shaped: overview landing + tab bar + section map at `/security/:section`, `/vault/:section`.
- **Why not the shared `TabbedHub`:** it publishes its tab bar via context and expects each tab page to
  render `<HubTabs/>`. None of these eleven pages do, so adopting it meant editing all eleven or
  double-rendering headers through `inlineTabs`. Vault's five pages are byte-for-byte untouched.
- Routes collapsed **13 → 4**. **Every old path still resolves as a hub section**, so nav, bookmarks, the
  ⌘K palette and `screen-registry.json` all keep working. Nav gained two "overview" entries.

**Governance** (`features/governance/pages.tsx`; `WorkflowsPage` / `ApprovalsPage` untouched)
- **Audit ledger** → four segments, matching what `/audit` actually exposes: Ledger (`immutable_ledger`,
  row → before/after JSON diff), Security events (`/audit/events`), Access reviews (create → decide each
  entry approved/revoked/flagged → complete; Complete stays disabled until every entry is decided), Restore
  queue (`/audit/soft-deletes`, request-restore + restore).
- **Notifications** → inbox (unread filter, mark-read, read-all) + a **preferences** matrix over
  `GET/PUT /notifications/preferences`.
- **No Governance hub** — its four screens sit at unrelated top-level paths (`/audit`, `/notifications`,
  `/workflows`, `/approvals`), so hubbing would move every URL for cosmetics. Say the word and it's a
  small follow-up with redirects.

**Control Tower KPI drill-downs** (`features/dashboard.tsx`)
- All four cards now render real records — revenue → `/final-invoices` grouped by client, SLA →
  `/operations` scored `ata ≤ eta`, overdue → the new MOD-52 endpoint, fleet → `/vehicles`. **No new
  drill-down BE.** Each fetch catches independently, so a gated module shows that card's empty state.
- The mock's `openKpi` is **replaced outright** — its script is top-level with no IIFE, so its functions
  are window properties and the inline `onclick=` handlers pick up the override. This also removes its
  **simulated ~18% random load failure**, fine in a demo and wrong for real data.
- The CTA leaves the iframe: it posts `{type:'praxis-kpi-nav', id}` and the **parent owns the id→route
  map**, so the iframe cannot navigate to an arbitrary path.

**BE — `GET /receivables/overdue`** (MOD-52, gated `accounting.core`)
- Registered before `/:id`. Reuses `repo.openInvoices`, so
  `overdue.total === d1_30 + d31_60 + d61_90 + d90_plus` for the same `as_of` **by construction**.
- Fixture check: total **1100** = ageing past-due **1100**, with the not-yet-due invoice (250) correctly
  left in `current`.
- Fixes a real inconsistency: the Control Tower card came from the ageing report (net of receipts) while
  its drill-down came from raw invoices (not net) — they could disagree on screen. Both now read this one
  payload, amounts are `outstanding`, and the card no longer depends on the `reporting` flag.

**BE — campaign per-recipient merge** (MOD-22)
- `{{name}}`, `{{email}}`, `{{campaign}}`, `{{year}}` rendered per subscriber in subject and body.
- **Body values are HTML-escaped, subjects are not.** `name` comes from the public subscribe endpoint, so
  it's untrusted — without escaping, one subscriber signing up as `<script>…` lands markup in every other
  recipient's email. Subjects aren't HTML but CR/LF is stripped (header injection).
- **Unknown tokens render literally** so a typo shows up in a test send rather than silently blanking.
- `name` falls back to the email's local part, then "there".
- FE: `TemplateForm` lists the available fields under the body.

## Security notes for the reviewer

Three deliberate decisions worth a look:

1. **Iframe → parent navigation** sends a card **id**, not a path; the parent maps it. Prevents the iframe
   driving arbitrary navigation.
2. **Drill-down `meta` strings are injected as HTML** (they carry intentional `<b>`), so interpolated DB
   values are escaped. The iframe runs `allow-same-origin`, which is not a real boundary.
3. **Merge-field escaping** as described above — the one place untrusted subscriber input reaches other
   recipients.

## Bug fixed en route

`rgb(var(--info))` was invalid CSS: `--info` is a raw hex set by `lib/theme.ts` with the comment "no
consumer yet", not an `"R G B"` triplet, and isn't defined in `index.css` at all. That segment would have
rendered as nothing. Switched to `--ink-3`.

## Dead code identified, NOT deleted in this PR

The sandbox mount blocks unlink, so these need `git rm` on Windows:

- **`client/src/features/master/pages.tsx` (748 lines) — zero importers.** This stream's session-5
  master-data trio, superseded at the PR #11 merge by `masterdata/master-data-page.tsx`. Deleting it
  empties `features/master/`.
- **`ReceivablesPage` + `ChartOfAccountsPage` in `features/finance/pages.tsx`** — `ResourceList` stubs
  nothing imports; `FinanceHub` takes both from the dedicated `receivables.tsx` / `chart-of-accounts.tsx`.

> **Do NOT delete `features/dashboard-mock/`.** It was restored in session 7 and is actively rendered by
> the Control Tower; the session-6 "safe to delete" note is stale.

After deleting, re-run the client build — `noUnusedLocals` will surface any import those blocks alone used.

## Validation checklist

```
npm run lint
npm test                      # ← matters more than usual, see the warning above
npm run build --prefix client
```

Then `npm run dev` and click through:

- Security and Vault hubs — every section, plus a deep link straight to an old path (e.g. `/vault/reports`).
- The six new Security forms; confirm Field visibility fails cleanly for a role with `edit` but not `approve`.
- All four Control Tower KPI cards, including CTA routing, and one card with a user lacking the grant.
- The **access review** flow end to end — most stateful thing in this PR.
- Notification **preferences** save round-trip (opt-out model: an all-enabled grid should read back unchanged).
- The **restore queue** as the same user who deleted a record — maker-checker rejection should read as a
  clear error, not a mystery failure.

## Files

**FE:** `features/security/{pages,hub}.tsx`, `features/vault/hub.tsx`, `features/governance/pages.tsx`,
`features/dashboard.tsx`, `features/sales/pages.tsx` (merge-field hint), `app/app.tsx`,
`app/layout/app-shell.tsx`.
**BE:** `modules/finance/smart_receivables/{service,controller,routes}.js`,
`modules/sales/marketing_campaign/marketing_campaign.service.js`.
**Tests:** `tests/unit/campaign-send.test.js` (+5 cases).
**Docs:** `SESSION_HANDOFF.md`, `WORK_DONE.md`, `FE_IA_BUILD_MAP.md`, `CAMPAIGN_TEMPLATES_BE_HANDOFF.md`,
`postman/praxis-ls.phase0.postman_collection.json`.
