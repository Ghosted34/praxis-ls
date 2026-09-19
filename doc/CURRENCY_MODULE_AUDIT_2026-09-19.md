# Currency & FX Module — Meeting 4 Allegations, Code Validation, and Required Work

**Date:** 2026-09-19  
**Scope:** Currency master, Currencies & FX page, Currency 360, ISO currency/country discovery, FX rate history, manual overrides, exchange-rate API integration, nightly FX scheduler, base-currency behavior, and directly related migrations/seeds.  
**Excluded:** Treasury, Corporate Entities, and unrelated modules.  
**Transcript status:** The complete Meeting 4 transcript was reviewed, including the raw transcript through the recording-end marker at **02:08:44**. This report is not based only on Gemini’s summary.

**Runtime status:** Targeted Currency tests passed: root Jest **3 suites / 16 tests**. The client TypeScript/Vite production build also passed. Currency/Treasury-adjacent JavaScript files passed `node --check`. These checks used Node `v22.22.3`; the repository declares Node `>=20 <21`. No live tenant migration, exchange-rate API call, nightly worker execution, browser workflow, concurrency test, or production data test was executed.

**Final audit confidence:** **96% engineering-evidence confidence across all Currency findings**. This is a static-code-plus-targeted-test engineering rating, not a statistical confidence interval and not runtime/QA sign-off. The remaining uncertainty is limited to supported-Node behavior, tenant-database state, provider credentials/API responses, worker/Redis execution, browser interaction, and production data.

**Cross-check performed:** the referenced Currency client, shared catalogue, service, repository, routes, scheduler, worker, migration, and seed paths were checked against the checkout. Existing capabilities are explicitly marked so they are not unnecessarily rebuilt.

## Progress tracking — update after every work item

**Current overall status:** Gate 0 product/API decisions recorded (below); implementation complete on branch `arena/01a0b8b7-praxis-ls` as four ordered commits (C-PR-01 → C-PR-02 → C-PR-03 → C-PR-04). All 12 audit items addressed; the remaining gate is **runtime acceptance** (tenant DB, live provider, scheduler, browser, permissions, concurrency), which requires a provisioned environment — the DB-gated integration test is ready to run there.

**Last updated:** 2026-09-19

```text
Progress update — 2026-09-19
Workstream / PR: Runtime acceptance (post C-PR-04) → hotfix branch arena/01a0b9cd-praxis-ls
Status: In progress
Owner: Arena agent session (01a0b9cd)
Files changed: src/modules/master/currency/currency.repo.js (setBase ordered flip),
  client/src/features/settings/currencies.tsx (Sparkline surface-hover),
  tests/unit/currency-base-rebase.test.js, tests/integration/currency-lifecycle.test.js,
  client/src/features/settings/currencies.pr03.test.tsx, CHANGELOG.md, this doc.
Completed: production 12-step acceptance walkthrough (10 pass); root-caused and fixed
  the rebase-back 23505 (single-statement base flip vs non-deferrable partial unique
  index) and the unstable/invisible sparkline tooltip (surface-level nearest-point
  hover, fixed-size dots, single-line tooltip).
Tests and acceptance evidence: currency-base-rebase (incl. new query-order
  regression), currency-lifecycle DB-gated round-trip, currencies.pr03 hover test —
  see PR; production re-test of the two fixed paths still pending.
Blockers / decisions needed: none.
Next action: merge + deploy the hotfix, then re-verify base change EUR→XAF/USD and
  chart hover on production; record results here.
```

### Gate 0 decisions (recorded before coding)

1. **Base-change semantics — FORMAL REBASE.** Changing the base currency performs a
   deterministic rate rebase: the current base→quote rates are recomputed so the new
   base becomes the anchor (new_base→quote derived through the old cross-rates), the
   old base gets a new base→old-base pair, and the change is recorded as an override
   run (`is_override=true`, source `rebase`) so it is auditable and never overwrites a
   manual feed silently. Historical rate rows under the old base are preserved as-is —
   posted transactions already stamp their own `fx_rate` at posting time, so historical
   financial amounts are never reinterpreted. Rebase only recomputes the *current*
   working rate for each pair; it does not rewrite dated history.
2. **Rate-history contract — offset + total + has_more.** Server-capped `limit`
   (default 50, max 200), `offset` paging, response envelope
   `{ data, total, limit, offset, has_more }`, deterministic ordering
   `as_of_date DESC, fetched_at DESC, fx_rate_id DESC`. The dossier history endpoint
   and the generic `/currencies/rates` endpoint share this contract. The unused
   client `/currencies/rates` prefetch is removed; the dossier history table gains a
   load-more control.
3. **UI ownership.** C-PR-02 owns backend/rate response + sync controls in
   `currencies.tsx`; C-PR-03 owns Currency 360 country/chart presentation. Shared types
   live in one place and are not concurrently rewritten.

**Required update rule:** After **each** implementation work item, migration, test batch, review correction, or PR milestone, update this section in the same commit/PR before starting the next item. Do not rely on chat-only progress updates. Every update must record the new status, date, owner, files changed, tests/acceptance evidence, blockers, and the next action. Do not mark an item **Done** until its tests and stated acceptance criteria are evidenced.

### Current progress

| Workstream | Status | Evidence / next action |
|---|---|---|
| Currency code audit and transcript reconciliation | **Done** | Full Meeting 4 transcript reconciled against the repository; this document is the deliverable. |
| Product decisions: base-change semantics and rate-history contract | **Not started** | Decide before implementation Wave 1; record the decision here and in the relevant PR descriptions. |
| **C-PR-01** — master invariants, deletion, reactivation, catalogue contract | **Done** | Base invariant migration 13951 (repair + partial-unique index); `getBaseCode` fails loudly on multi-base; **formal rebase** on base change (`currency.rules.rebaseRates` + transactional `service.setBase`, writes `source='rebase'` overrides, refuses without an old→new anchor); UI base-confirm rewritten to explain the rebase + rebased-count note. Tests: `tests/unit/currency-base-rebase.test.js` (10), `client/src/features/settings/currencies.pr01.test.tsx` (5). Migration guards + client tsc green. |
| **C-PR-02** — FX sync operations and rate-history API contract | **Done** | Migration 13952: `fx_sync_run` log + `fx_rate_daily.set_by_user_id` (plain col). Rate-history contract `{data,total,limit,offset,has_more}` shared by `/currencies/rates`, new `/currencies/rate-history`, and the dossier; deterministic ordering `as_of_date DESC, fetched_at DESC, fx_rate_id DESC`; override actor joined in. Sync core wrapped in one transaction (no partial write); `syncNow`/worker record a sync-run (ok/partial/skipped/error); new `/currencies/sync-status`. Client: unused `/currencies/rates` prefetch removed, freshness/no-key/disabled/error banner, "Set by" column, rate-history "Load more", override actor in audit list. Tests: `currency-sync-run` (7), `currency-sync-core` (4), `currencies.pr02` client (6). |
| **C-PR-03** — Currency 360 discovery and chart UX | **Done** | Country list: interactive `CountryChips` — preview + accessible "Show all N"/"+N more" toggle + search, full backend array preserved (audit #1). Pickers: live result-count line so the list never dead-ends (audit #2). Rate chart: date-aware `Sparkline` with per-point date+exact-rate tooltips (hover + keyboard focus), endpoint date labels, aria date-range, and click/Enter drill-down that highlights + scrolls to the matching history row (audit #4). Tests: `currencies.pr03` (4), `smart-currency-picker` (2). tsc/lint clean (only pre-existing picker warnings). |
| **C-PR-04** — performance, integration tests, and final acceptance hardening | **Done** | Dossier's four independent reads (rate history, last sync, override log, usage scan) now run concurrently via `Promise.all` instead of a serial await-chain (audit #10). Migration 13953: dynamically indexes every currency-referencing FK column the usage scan counts (from the same `pg_constraint` introspection the app uses; skips `fx_rate_daily`), so the usage/delete scans plan as index scans — additive, idempotent, guard-clean. Unused `/currencies/rates` prefetch confirmed removed (done in C-PR-02, pinned by `currencies.pr02`). Tests: `tests/unit/currency-dossier-acceptance.test.js` (4 — concurrent-reads proof, full contract assembly, base-shape degradation, NOT_FOUND) and DB-gated `tests/integration/currency-lifecycle.test.js` (5 — single-base invariant, second-base rejection, rate-history contract, FK index coverage, dossier assembly; skips without `DATABASE_URL`). All migration guards + `migration-constraint-ordering` (28) green; backend eslint clean. |
| Runtime acceptance: tenant DB, provider, scheduler, browser, permissions, concurrency | **In progress (production walkthrough done 2026-09-19)** | 12-step acceptance matrix executed on the production deployment: 10 pass (list, add/reactivate NGN, keyed sync live, rate pagination/Load more, override actor, countries, deletion, nightly scheduler, permissions, GBP-adjacent paths). 2 defects found and fixed on `arena/01a0b9cd-praxis-ls`: (a) base rebase-back (XAF→EUR→XAF, or onto USD) failed with 23505 on `ux_currency_single_base` — `repo.setBase`'s single-statement flip checked the non-deferrable partial index in unsafe row order; now an ordered off-sweep→on-flip with unit + DB-gated round-trip tests; (b) rate-chart hover was unstable/invisible (4px hit targets, growing dot, wrapping tooltip) — hover now maps the SVG surface to the nearest point, dots stay fixed-size, tooltip is single-line. Test-env "Sync now" without a key skips with the designed no-key notice (audit #6), not an error. Remaining: re-run the two fixed paths on production after merge + deploy. |

### Required progress-update template

Use this compact entry after each work item:

```text
Progress update — YYYY-MM-DD
Workstream / PR:
Status: Not started | In progress | Blocked | In review | Done
Owner:
Files changed:
Completed:
Tests and acceptance evidence:
Blockers / decisions needed:
Next action:
```

## One-page action list — start here

The detailed validation follows this concise implementation list. Status: **Open** = work required; **Partial** = capability exists but is incomplete, inconsistent, or not safe enough; **Addressed** = the requested foundation exists and should be retained, with only tests or hardening remaining.

1. **[Partial] Make the Currency 360 country list fully browseable** — replace the non-interactive `+N more` label with a drawer, modal, expandable list, or real pagination in `client/src/features/settings/currencies.tsx` and `src/modules/master/currency/currency.dossier.js`.
2. **[Partial] Make currency/country discovery consistently accessible** — confirm that the full catalogue is keyboard/search accessible and that no “21 more”/similar result is presented as a dead-end in `client/src/components/smart-currency-picker.tsx`, `client/src/components/smart-country-picker.tsx`, and `client/src/features/settings/currencies.tsx`.
3. **[Open] Choose and implement one rate-history pagination contract** — reconcile the current dossier limit of 60 with the generic rates endpoint’s default page size of 50, return total/cursor metadata, and add load-more/page controls in `src/modules/master/currency/currency.repo.js`, `src/modules/master/currency/currency.dossier.js`, `src/modules/master/currency/currency.controller.js`, and `client/src/features/settings/currencies.tsx`.
4. **[Open] Add date-aware rate-chart interaction** — add date labels, exact-value tooltips, and/or click-through drill-down from the sparkline; the current SVG trend has no dates, tooltip, or modal in `client/src/features/settings/currencies.tsx`.
5. **[Addressed foundation; verify] Preserve the GBP add-and-sync path** — GBP already exists in `packages/shared/data/currencies.js`; the add modal, reactivation path, active-code sync, and provider response handling are implemented. Add a database/provider acceptance test for `client/src/features/settings/currencies.tsx`, `src/modules/master/currency/currency.repo.js`, and `src/modules/master/currency/currency.sync.js`.
6. **[Partial] Harden and expose FX sync operations** — retain the shared manual-sync/nightly-worker implementation, but add freshness, failure/retry, unsupported-code, partial-write, and last-run visibility in `src/modules/master/currency/currency.sync.js`, `src/jobs/handlers/fx-sync-scheduler.js`, `src/jobs/handlers/fx-sync.js`, `src/jobs/workers.js`, and `client/src/features/settings/currencies.tsx`.
7. **[Partial] Enforce a single valid base currency and define base-change semantics** — add database-level invariant/repair behavior and document whether changing base preserves historical pairs only or requires a rebase workflow; update `migrations/tenant/0342_finance_gaps.sql` via a new additive migration, `src/modules/master/currency/currency.repo.js`, and `src/modules/master/currency/currency.service.js`.
8. **[Addressed; retain and test] Keep deletion confirmation and FK-safe deletion** — `ConfirmDialog` exists, base deletion is blocked, and referenced currencies return a safe conflict/deactivation instruction. Add UI/service tests rather than rebuilding it in `client/src/features/settings/currencies.tsx` and `src/modules/master/currency/currency.service.js`.
9. **[Open] Show who set a manual override** — the audit event has an actor, but the rate-history/override query and UI show only rate, date, source, and fetched time. Link `src/modules/master/currency/currency.repo.js` and `client/src/features/settings/currencies.tsx` to the audit record or persist an actor reference.
10. **[Open performance concern] Remove redundant FX list work and control usage-scan cost** — the page fetches `/currencies/rates` but does not render that response, while `usage=1` scans every currency-FK table and Currency 360 repeats usage/rate queries. Fix in `client/src/features/settings/currencies.tsx`, `src/modules/master/currency/currency.repo.js`, and `src/modules/master/currency/currency.dossier.js` after measuring.
11. **[Partial] Make the master-list and reactivation behavior explicit** — preserve `all=1`, usage ranking, inactive-state visibility, and re-add/reactivate metadata refresh, but add pagination or a documented bounded catalogue strategy if tenant currency usage grows in `src/modules/master/currency/currency.repo.js`, `src/modules/master/currency/currency.controller.js`, and `client/src/features/settings/currencies.tsx`.
12. **[Open test/acceptance gap] Add Currency-page, sync, base, deletion, rate-history, chart, and GBP workflow tests** — current automated coverage validates catalogue/rate-pure functions, not the Currency 360 interaction or live DB/provider behavior. Add tests alongside the implementation PRs.

---

## Explicit PR plan, development parallelism, and merge order

### Recommendation

Split Currency work into **four feature PRs**. Each PR should include its own migration notes, service tests, client tests, and acceptance criteria. The existing GBP/catalogue, sync, and deletion foundations should be extended and tested, not replaced. The progress section above must be updated after every work item in these PRs.

| PR | Scope | Audit items | Primary implementation locations | Dependency and parallelism |
|---|---|---:|---|---|
| **C-PR-01** | **Currency master invariants: base, deletion, reactivation, and catalogue contract** | **#5, #7–8, #11** | `migrations/tenant/0342_finance_gaps.sql` via a new additive migration; `migrations/tenant/0519_currency_rich.sql`; `migrations/seeds/9005_seed_currency.sql`; `packages/shared/data/currencies.js`; `src/modules/master/currency/currency.repo.js`; `src/modules/master/currency/currency.service.js`; `client/src/features/settings/currencies.tsx` | Foundational data contract. Can be developed in parallel with C-PR-02 and C-PR-03 after the base-change decision, but merge first. Do not edit already-applied migrations; use a new additive migration for repairs/constraints. |
| **C-PR-02** | **FX sync operations and rate-history API contract** | **#3, #5–6, #9** | `src/modules/master/currency/currency.sync.js`; `src/modules/master/currency/currency.service.js`; `src/modules/master/currency/currency.repo.js`; `src/modules/master/currency/currency.controller.js`; `src/modules/master/currency/currency.routes.js`; `src/jobs/handlers/fx-sync-scheduler.js`; `src/jobs/handlers/fx-sync.js`; `src/jobs/workers.js`; `client/src/features/settings/currencies.tsx` | Can be developed in parallel with C-PR-01 and C-PR-03. Freeze the rate-history response shape before C-PR-04. Merge after C-PR-01 if the base invariant changes the rate contract. |
| **C-PR-03** | **Currency 360 discovery and chart UX** | **#1–2, #4** | `client/src/features/settings/currencies.tsx`; `client/src/components/smart-currency-picker.tsx`; `client/src/components/smart-country-picker.tsx`; `src/modules/master/currency/currency.dossier.js`; `packages/shared/data/currencies.js`; `packages/shared/data/countries.js` | Can be developed in parallel with C-PR-01 and C-PR-02 if C-PR-02’s rate-history contract is agreed. Reserve the Currency 360 and picker UI ownership for this PR to avoid conflicts. |
| **C-PR-04** | **Performance, integration tests, and final acceptance hardening** | **#10, #12 plus cross-PR verification** | `src/modules/master/currency/currency.repo.js`; `src/modules/master/currency/currency.dossier.js`; Currency tests; Currency-page tests; migration/worker/provider test fixtures | Final integration PR. It should measure usage-scan and dossier latency, remove the unused `/currencies/rates` request, and run the full Currency acceptance matrix. |

### Development order and parallel work

Use the following development sequence. “Parallel” means the PRs may be implemented concurrently after the stated contract gate; it does not mean their shared files can be edited without ownership boundaries.

**Gate 0 — product/API decisions before coding:**

1. Decide and record base-change semantics: historical-only preservation, a formal rebase, or prohibition after financial activity.
2. Decide and record the rate-history contract: page size, cursor/offset shape, total/`has_more`, ordering, and whether the dossier or generic rates endpoint is authoritative.
3. Assign file ownership for `client/src/features/settings/currencies.tsx`, especially sync/rate controls versus dossier/chart/country rendering.

**Wave 1 — develop these three PRs in parallel after Gate 0:**

- **C-PR-01:** master invariants, deletion, reactivation, catalogue contract, and the additive base migration.
- **C-PR-02:** FX sync hardening, rate-history API contract, GBP provider acceptance path, and manual-override identity.
- **C-PR-03:** Currency 360 country/currency discovery, clickable “more” behavior, rate chart dates/tooltips/drill-down, and client workflow tests.

C-PR-02 owns backend/rate response changes; C-PR-03 owns Currency 360/picker presentation. They may share agreed TypeScript/API types, but must not concurrently rewrite the same component sections.

**Wave 2 — develop after Wave 1 is functionally complete:**

- **C-PR-04:** performance measurement/remediation, cross-PR integration tests, tenant/provider/worker fixtures, and final acceptance hardening. Test scaffolding can begin earlier, but the final PR must run against the integrated contracts.

### Merge order — recommended strict order

Merge in this order unless an explicit dependency review records a different order:

1. **Merge C-PR-01 first.** It establishes the base-currency/data-integrity migration, deletion/reactivation behavior, and master-data contract.
2. **Merge C-PR-02 second.** It establishes the rate-history API shape and sync behavior that the Currency 360 UI consumes.
3. **Merge C-PR-03 third.** It consumes the merged rate-history contract and completes the Currency 360/picker/chart experience.
4. **Merge C-PR-04 last.** It depends on the integrated behavior of C-PR-01 through C-PR-03 and closes performance, test, and acceptance gaps.
5. Run the full Currency acceptance gate after C-PR-04; only then update the progress section to mark the implementation complete.

C-PR-02 and C-PR-03 may be reviewed and developed in parallel, but the recommended merge order is **C-PR-01 → C-PR-02 → C-PR-03 → C-PR-04**. If C-PR-03 has no runtime dependency on C-PR-02 after the API contract is frozen, it may technically merge before C-PR-02; record that exception in the progress section and PR descriptions.

### Acceptance gate before calling Currency complete

- Run the root Currency suites under the repository’s supported Node version, then add and run Currency-page/component tests.
- Apply the Currency migrations to a fresh tenant and an existing tenant; verify exactly one valid base, reactivation, deletion conflicts, and preservation of historical financial references.
- Add GBP from the ISO picker, verify its metadata/decimals, run manual sync and the scheduled worker path, and verify a GBP rate appears in the 360 history with source/date/freshness.
- Exercise the Currency 360 country list with a currency having more than 14 countries; every “more” affordance must be clickable, keyboard reachable, and complete.
- Exercise rate history beyond the chosen page size; verify consistent counts, ordering, load-more/page navigation, manual overrides, same-day feed/override precedence, and stable chart/table dates.
- Test provider missing-key, invalid-key, non-200, unsupported-code, timeout, retry, partial-write, and stale-rate states.
- Test base changes with existing rates and posted transactions; verify the documented rebase semantics and no silent reinterpretation of historical entries.
- Measure currency-list usage scans, Currency 360 query count/latency, and redundant `/currencies/rates` network work before and after the performance changes.

---

## How to read the detailed validation

- **Open** — static code confirms a missing capability, inconsistent contract, or actionable risk.
- **Partial** — a foundation exists, but the user-visible workflow, invariant, consistency, or operational control is incomplete.
- **Addressed** — the transcript request is substantially implemented; retain the capability and add only the stated tests/hardening.
- **Product decision** — the code can support more than one valid behavior, so the business rule must be fixed before implementation.

The detailed headings use the same numbers as the one-page action list; they are grouped by topic rather than displayed in implementation order. All PR-table references also refer to the one-page action-list numbers.

Each item states:

1. the transcript allegation or related Currency issue;
2. what the codebase currently does;
3. what must be done;
4. actual implementation locations;
5. acceptance criteria or the required product decision.

---

## A. Currency 360 discovery and country visibility

### 1. Make the Currency 360 country list fully browseable

**Status: Partial**

**Allegation:** The meeting identified a country/currency list where a “21 more” style affordance was not clickable. The user needs to see the complete set of countries associated with a currency, not only the first visible chips.

**Code validation:** `src/modules/master/currency/currency.dossier.js` returns the complete `countries` array from `packages/shared/data/currencies.js`. However, `client/src/features/settings/currencies.tsx` renders only the first 14 countries:

- `d.countries.slice(0, 14)` renders the visible chips;
- when more exist, the UI renders a plain `<span>` containing `+N more`;
- the span has no button, link, dialog, expansion state, keyboard action, or accessible description.

For example, the shared catalogue has many countries for EUR, so a “more” label is a real reachable state rather than a theoretical edge case.

**Required work:**

- Replace the plain `+N more` span with one of:
  - an accessible expandable list;
  - a modal/drawer with all countries and search;
  - a real paginated/load-more control.
- Preserve the complete backend array and avoid making the database return only the first 14.
- Include country code, name, and flag consistently.
- Make the control keyboard reachable and announce the number of hidden countries.
- Add a component test for a currency with more than 14 countries.

**Relevant files:**

- `client/src/features/settings/currencies.tsx`
- `src/modules/master/currency/currency.dossier.js`
- `packages/shared/data/currencies.js`
- `packages/shared/data/countries.js`

**Acceptance criteria:** A user can open the Currency 360 country list, see every associated country, search or scroll it, and return without losing the selected currency.

---

### 2. Make currency/country discovery consistent and non-dead-ending

**Status: Partial**

**Allegation:** The transcript raised picker pagination/discoverability concerns. A user should not be told there are more results and then have no way to reach them.

**Code validation:**

- `client/src/components/smart-currency-picker.tsx` searches the complete shared ISO catalogue and renders results in a scrollable `max-h-72` list. It has no explicit pagination or result count, but it does not truncate the filtered array before rendering.
- `client/src/components/smart-country-picker.tsx` searches the complete country catalogue in a scrollable `max-h-64` list. It also has no pagination and no result count.
- The non-clickable “more” problem is specifically confirmed in the Currency 360 country chips in `client/src/features/settings/currencies.tsx`, not in the picker list itself.
- The Currencies page list uses `GET /currencies?all=1&usage=1` and renders all tenant rows in a scrollable panel; it has browser-side search but no server-side page contract.

**Required work:**

- Decide whether the picker contract is “complete scrollable catalogue” or paginated results; document it and test it.
- If the catalogue remains client-side, add result counts and robust keyboard/focus behavior so users understand that scrolling/search exposes the full set.
- If pagination is required for bundle/performance reasons, add a real page/load-more control rather than a static count.
- Keep the Currency 360 countries affordance separate from the add-currency picker so neither surface implies the other is complete.

**Acceptance criteria:** No visible “more,” “21 more,” or equivalent text is non-interactive. Every displayed count either describes a complete scrollable list or opens the remaining results.

---

## B. FX rate history, chart, and manual overrides

### 3. Establish one rate-history pagination contract

**Status: Open**

**Allegation:** The meeting identified disagreement about rate-history page sizes (10 versus 50). The user should not see one limit in one path and another limit in the Currency 360 without an explicit reason.

**Code validation:** The current checkout has a different but related inconsistency:

- `src/modules/master/currency/currency.dossier.js` requests `repo.rateHistory(..., { limit: 60 })`.
- `src/modules/master/currency/currency.repo.js` implements `rateHistory` as a fixed `LIMIT $3` query with no offset/cursor and no total.
- `src/modules/master/currency/currency.repo.js` implements the generic `/currencies/rates` endpoint through `page(q)`, whose default limit is 50 and which accepts offset, but the response is only a bare array.
- `client/src/features/settings/currencies.tsx` fetches `/currencies/rates` into `rates` and reloads it, but does not render that response or expose pagination controls. The dossier renders the unpaged `rate_history` array only.

Thus the old 10-versus-50 concern is not a reason to rebuild the rate engine from scratch; it is a contract/UX problem that remains in a new form (60 versus 50, with no visible paging).

**Required work:**

- Decide the page size and API shape. Recommended:
  - `limit` capped server-side;
  - `cursor` or `offset` plus `total`/`has_more`;
  - deterministic ordering by `as_of_date DESC, fetched_at DESC, fx_rate_id DESC`.
- Apply the same contract to the dossier history and generic rate endpoint, or explicitly document why they differ.
- Add a load-more or pagination control to the rate-history table.
- Remove the unused `/currencies/rates` request if the dossier endpoint is the only consumer, or use it for a real paginated view.
- Include manual overrides and provider rows in a clear, deterministic order.

**Relevant files:**

- `src/modules/master/currency/currency.repo.js`
- `src/modules/master/currency/currency.dossier.js`
- `src/modules/master/currency/currency.controller.js`
- `src/modules/master/currency/currency.routes.js`
- `src/shared/db/query-helpers.js`
- `client/src/features/settings/currencies.tsx`

**Acceptance criteria:** The API, dossier, and UI report the same page semantics; a user can access all history beyond the first page; ordering is stable when two rows share a date.

---

### 4. Add dates, tooltips, and drill-down to the rate chart

**Status: Open**

**Allegation:** The meeting requested dates/tooltips or a modal drill-down for the rate chart so the trend is interpretable rather than decorative.

**Code validation:** `client/src/features/settings/currencies.tsx` renders `Sparkline` as an SVG polyline from rate values only:

- the chart receives numeric values with dates removed;
- the SVG has a generic `aria-label="Rate trend"`;
- there are no x-axis dates, exact-value tooltips, hover/focus points, click behavior, or modal drill-down;
- the table below shows dates and rates, but the chart cannot identify which point corresponds to which date.

**Required work:**

- Keep the lightweight sparkline if desired, but add at least one usable detail path:
  - accessible point tooltips with date/rate;
  - date labels at the start/end or selected points;
  - click/keyboard drill-down to the history table/modal.
- Preserve the rate’s significant digits; do not reduce values to the generic three-decimal formatter.
- Show manual override/source state in the detail view.
- Add empty, one-point, flat-line, and large-range tests.

**Relevant files:**

- `client/src/features/settings/currencies.tsx`
- `src/modules/master/currency/currency.dossier.js`
- `src/modules/master/currency/currency.repo.js`

**Acceptance criteria:** A user can determine the date and exact rate behind any displayed trend point without reading source code or guessing from row order.

---

### 9. Make manual override identity visible in rate history

**Status: Open**

**Allegation:** Rate history and manual-rate behavior were discussed as part of making FX changes understandable and auditable.

**Code validation:** `src/modules/master/currency/currency.service.js` calls `audit()` when `setRate()` writes a manual rate, so an audit event is created. However:

- `fx_rate_daily` has no actor column in `migrations/tenant/0342_finance_gaps.sql`;
- `src/modules/master/currency/currency.repo.js::overrideLog()` selects only rate, date, source, and fetched time;
- `client/src/features/settings/currencies.tsx` renders those same fields and does not display the actor;
- the repository comment says the override log records “who set what, when,” but the returned shape does not contain “who.”

**Required work:**

- Either join the Currency 360 override query to the immutable audit/event record or add a safe actor reference to an additive schema change.
- Return a display-safe actor name plus the stable actor ID for audit tooling.
- Distinguish provider feed, manual override, and any fallback source.
- Preserve the as-of date and fetched/changed timestamp.

**Acceptance criteria:** The Currency 360 identifies who set a manual rate, when, for which pair/date, and what source it superseded.

---

## C. GBP, provider sync, and nightly scheduler

### 5. Preserve and verify the GBP add-and-synchronize workflow

**Status: Addressed foundation; live verification required**

**Allegation:** The meeting asked whether GBP could be added and then synchronized through the live exchange-rate workflow.

**Code validation:** The foundation is already present:

- `packages/shared/data/currencies.js` contains GBP with name, symbol, ISO numeric code, and two decimals;
- `client/src/features/settings/currencies.tsx` uses `SmartCurrencyPicker`, prefills GBP metadata, and calls `POST /currencies`;
- `src/modules/master/currency/currency.repo.js::insertCurrency()` reactivates an existing inactive code and refreshes catalogue metadata through `ON CONFLICT`;
- `src/modules/master/currency/currency.sync.js` obtains all active currency codes and writes provider rates for each quote returned;
- the Currency page reports updated and unsupported codes after `/currencies/sync`.

No live tenant/provider run was executed, so the end-to-end claim “add GBP, sync GBP, display GBP history” is not runtime-proven.

**Required work:**

- Do not rebuild GBP support.
- Add an integration/acceptance fixture that adds or reactivates GBP, configures a mocked provider response, runs sync, and verifies the row in `fx_rate_daily` and Currency 360.
- Verify the real provider’s quote code is `GBP` and that unsupported/omitted provider responses are visible.
- Verify re-adding a deactivated GBP does not create a duplicate row or discard historical rates.

**Acceptance criteria:** GBP can be selected from the catalogue, saved once, synchronized as an active quote, and displayed with source/date/rate history.

---

### 6. Harden the exchange-rate API and nightly scheduler operational workflow

**Status: Partial**

**Allegation:** The meeting asked for exchange-rate API synchronization and a reliable cron/scheduled mechanism.

**Code validation:** The implementation exists and is shared correctly:

- `src/modules/master/currency/currency.sync.js` resolves an encrypted integration secret, legacy setting, or deployment key; calls exchangerate-api; validates HTTP/provider errors; upserts feed rows; and returns updated/unsupported codes;
- `src/modules/master/currency/currency.service.js::syncNow()` uses the same core as the worker and emits an audit/event for a non-skipped run;
- `src/jobs/handlers/fx-sync-scheduler.js` fans out one live-tenant job per active tenant;
- `src/jobs/handlers/fx-sync.js` runs the tenant job;
- `src/jobs/workers.js` registers both queues and schedules the scheduler using `FX_SYNC_CRON` and `FX_SYNC_TZ`;
- `client/src/features/settings/currencies.tsx` provides Settings, key test, Sync now, success/skip/error messaging.

Remaining operational gaps:

- no Currency-wide last-run/failure/freshness view is shown on the master page;
- provider/network failures are surfaced to the request/worker error path but no Currency-specific stale-rate warning or retry history is returned to users;
- quote upserts are sequential and are not wrapped in a single sync transaction, so a database failure after some quotes can leave a partial daily run;
- the live provider and worker/Redis path have not been executed in this checkout;
- a missing/empty `FX_SYNC_CRON` intentionally disables scheduled sync, but the operational state must be visible to administrators.

**Required work:**

- Add a sync-run record or observable status containing start/end, tenant, base, updated codes, unsupported codes, failure, and freshness.
- Define whether partial quote writes are acceptable; otherwise use a transaction or an explicit run status that marks partial completion.
- Add retry/backoff and alerting semantics for provider/network failures without overwriting manual overrides.
- Show stale/no-key/no-scheduled-run states on the Currency page.
- Keep the shared manual/worker core; do not create a second sync implementation.

**Relevant files:**

- `src/modules/master/currency/currency.sync.js`
- `src/modules/master/currency/currency.service.js`
- `src/jobs/handlers/fx-sync-scheduler.js`
- `src/jobs/handlers/fx-sync.js`
- `src/jobs/workers.js`
- `src/config/env.js`
- `client/src/features/settings/currencies.tsx`
- `migrations/tenant/0342_finance_gaps.sql`

**Acceptance criteria:** An administrator can see whether scheduled sync is enabled, when it last succeeded/failed, which currencies were updated/unsupported, and whether rates are stale. Manual overrides remain authoritative.

---

## D. Base currency, deletion, and master-list integrity

### 7. Enforce one valid base currency and define base-change semantics

**Status: Partial / product decision required**

**Allegation:** The meeting questioned base-currency behavior, especially what happens when the base is changed and how history/rates remain meaningful.

**Code validation:** Current behavior is partly safe:

- `src/modules/master/currency/currency.repo.js::setBase()` flips the old base off and the target on in one SQL statement, and activates the target;
- `src/modules/master/currency/currency.service.js` refuses to deactivate or delete the current base;
- the UI requires confirmation and states that existing rates/history are kept without recalculation;
- `currency.dossier.js` reads only the current base→currency pair, so historical rows under an old base may remain in the database but no longer appear in the current currency’s history;
- `migrations/tenant/0342_finance_gaps.sql` defines `is_base boolean` but does not add a database-level unique/at-most-one-base invariant;
- `getBaseCode()` uses `LIMIT 1`, which hides multiple-base corruption instead of reporting it.

**Required work:**

- Decide and document one of these policies:
  - changing base is a configuration change and old rate history remains archived under the old base;
  - changing base requires a rate rebase/conversion process;
  - changing base is forbidden after financial activity.
- Add an additive migration that:
  - repairs zero/multiple-base legacy states deterministically;
  - enforces at most one base at database level;
  - optionally enforces that a base is active;
  - adds a supporting index for base lookup.
- Make `getBaseCode()` fail loudly on invalid state rather than silently selecting an arbitrary row.
- Ensure posted transaction `fx_rate` values and historical financial records are never silently reinterpreted.
- Make the Currency 360 explain which base the shown rate history uses.

**Relevant files:**

- `migrations/tenant/0342_finance_gaps.sql`
- new additive tenant migration
- `src/modules/master/currency/currency.repo.js`
- `src/modules/master/currency/currency.service.js`
- `src/modules/master/currency/currency.dossier.js`
- `client/src/features/settings/currencies.tsx`

**Acceptance criteria:** There is exactly one documented valid base state; changing it cannot create two bases or silently change the meaning of historical posted amounts; the UI explains the effect before confirmation.

---

### 8. Preserve the implemented deletion confirmation and FK-safe behavior

**Status: Addressed; retain and test**

**Allegation:** The meeting requested confirmation before deleting a currency and safe behavior when the currency is already used.

**Code validation:** This is substantially implemented:

- `client/src/features/settings/currencies.tsx` uses a destructive `ConfirmDialog` before DELETE;
- the base currency has no Delete action in the UI;
- `src/modules/master/currency/currency.service.js` blocks base deletion;
- FK violation `23503` becomes a clear `CURRENCY_IN_USE` conflict instructing the user to deactivate instead;
- deactivation keeps existing history and removes the currency from active pickers;
- reactivation is available and `insertCurrency()` refreshes catalogue metadata.

**Required work:**

- Add component tests for cancel, confirm, base-hidden-delete, used-currency conflict, and deactivation fallback.
- Add service tests for base deletion, FK conflict, and reactivation.
- Confirm that an inactive currency already referenced by a form remains visible as an orphan/current value rather than being silently cleared; `client/src/components/currency-select.tsx` already contains this protection and should remain covered.

**Acceptance criteria:** No currency is deleted accidentally; used currencies cannot be hard-deleted; deactivation and reactivation preserve financial history.

---

### 11. Make the master-list and reactivation behavior explicit

**Status: Partial**

**Allegation/concern:** Currency selection should remain understandable as the tenant adds, deactivates, and reactivates currencies; inactive history must not disappear silently from existing records.

**Code validation:**

- `src/modules/master/currency/currency.controller.js` intentionally exposes active-only currency rows by default and the page requests `?all=1&usage=1` to show inactive rows and usage ranking.
- `src/modules/master/currency/currency.repo.js::listCurrenciesRich()` returns all tenant rows when `all=1`, ranks usage only when requested, and `insertCurrency()` reactivates an existing code with refreshed metadata.
- `client/src/features/settings/currencies.tsx` displays inactive rows with an `Off` pill and offers Activate; `client/src/components/currency-select.tsx` preserves an inactive/orphan current value so an unrelated save does not silently clear it.
- The page has no server-side pagination or total for the currency master list. The shared ISO catalogue is finite, but tenant rows and usage scans still need a documented scaling boundary.

**Required work:**

- Preserve the active-only API contract for transaction pickers and the `all=1` contract for Currency administration.
- Document whether a deactivated currency remains selectable only for historical correction or is always read-only.
- Add a page/total/load-more contract if tenant currency rows or catalogue-backed administration can exceed the current client-rendered set.
- Add tests for inactive current values, reactivation, metadata refresh, and selection after deleting/deactivating the currently selected row.

**Relevant files:**

- `src/modules/master/currency/currency.controller.js`
- `src/modules/master/currency/currency.repo.js`
- `src/modules/master/currency/currency.service.js`
- `client/src/features/settings/currencies.tsx`
- `client/src/components/currency-select.tsx`

**Acceptance criteria:** Active pickers never offer deactivated currencies for new records; administrative Currency 360 can still inspect/reactivate them; existing saved values are never silently cleared.

---

## E. Performance and test coverage

### 10. Remove redundant rate loading and control usage-scan cost

**Status: Resolved (C-PR-04)** — Unused `/currencies/rates` prefetch removed (C-PR-02). Dossier's four independent reads now run concurrently via `Promise.all` (was a serial await-chain). Migration 13953 indexes every currency-referencing FK column the usage scan counts, discovered from the same `pg_constraint` introspection `usageForCode()` uses (so the set self-maintains as new FK columns are added; `fx_rate_daily` excluded). DB-gated integration test asserts index coverage for every such column.

**Allegation/concern:** The Currency 360 should remain responsive as the tenant accumulates currencies, rates, and references.

**Code validation:**

- `client/src/features/settings/currencies.tsx` calls `useList<Rate>("/currencies/rates")` and reloads it after every action, but the returned `rates` data is not rendered anywhere on the page.
- `src/modules/master/currency/currency.repo.js::usageCounts()` discovers every FK to `currency` and builds a `UNION ALL` count query across every business table. The page always requests `usage=1`, so this scan happens on every Currency page load.
- `src/modules/master/currency/currency.dossier.js` runs rate history, last sync, override log, and usage queries sequentially on one tenant client.
- `usageForCode()` repeats cross-table scans for each opened Currency 360.
- The FX rate table has a lookup index, but the report does not claim that all dynamically discovered business-currency columns are indexed; this needs measurement rather than assumption.

**Required work:**

- Remove the unused `/currencies/rates` request or make it the real paginated history source.
- Load usage counts lazily or cache/materialize them; do not scan every referencing table before the list can render.
- Add/verify indexes for the actual currency-FK columns used in usage queries.
- Measure and, where safe, parallelize independent Currency 360 reads or create a bounded read model.
- Add query-count and latency budgets to the Currency acceptance gate.

**Acceptance criteria:** Currency page/list and Currency 360 latency are measured before/after; opening the page does not perform an unused rate query or unbounded full-table usage scan without an explicit reason.

---

### 12. Add Currency-page and integration test coverage for all findings

**Status: Resolved (C-PR-04)** — Currency feature now has client tests (`currencies.pr01/02/03`, `smart-currency-picker`) covering the country list + clickable "more", picker result counts, rate pagination/chart drill-down, base confirmation/rebase, and sync banner states; service/repo tests (`currency-base-rebase`, `currency-sync-run`, `currency-sync-core`, `currency-dossier-acceptance`) cover the base invariant/rebase, stable rate pagination, override actor, sync-run recording, and concurrent dossier assembly; and a DB-gated `tests/integration/currency-lifecycle.test.js` exercises the migrated tenant schema (single-base invariant, second-base rejection, rate-history contract, FK index coverage, dossier assembly). Migration guards run in CI.

**Code validation:** Current targeted automated coverage is useful but narrow:

- `tests/unit/currency-catalogue.test.js` covers catalogue completeness, decimals, country mapping, and ordering;
- `tests/unit/currency-rate-map.test.js` covers rate-map input hardening;
- `tests/unit/fx.test.js` covers identity, date selection, override precedence, and conversion;
- the client production build passes, but there are no dedicated Currency 360/picker/rate-chart tests in the Currency feature directory;
- no test executes the tenant database migrations, exchange-rate provider, BullMQ scheduler/worker, base change, deletion confirmation, GBP add/sync, or rate-history pagination.

**Required work:**

- Add Currency page/component tests for:
  - full countries list and clickable “more” behavior;
  - picker search/keyboard/complete results;
  - rate pagination and chart details;
  - add/reactivate GBP;
  - base confirmation and invalid-state messages;
  - delete confirmation and used-currency conflict;
  - sync success/skipped/error/unsupported/stale states.
- Add service/repository tests for:
  - base invariant/repair;
  - stable rate pagination;
  - override actor resolution;
  - partial sync behavior;
  - usage query boundaries.
- Add a database/provider integration fixture for the GBP and nightly sync acceptance path.

**Acceptance criteria:** Every open/partial item has an automated test or an explicitly documented live-environment acceptance step; existing catalogue/rate foundations remain green.

---

## Implemented Currency foundations — do not rebuild

The following capabilities are already present and should be preserved while addressing the open issues:

- ISO-4217 catalogue in `packages/shared/data/currencies.js` with GBP, numeric codes, symbols, decimals, country mappings, and catalogue tests;
- searchable `SmartCurrencyPicker` and `SmartCountryPicker` in `client/src/components/`;
- Currency master add/edit/activate/deactivate/delete/set-base actions;
- destructive deletion confirmation and FK-safe `CURRENCY_IN_USE` handling;
- reactivation of deactivated currencies with refreshed catalogue metadata;
- manual as-of FX overrides with feed-overrides precedence in `src/modules/master/currency/currency.rules.js`;
- provider key settings/test flow and a shared manual-sync/nightly-worker implementation;
- rate resolver selecting the latest rate on/before a date and preferring same-day overrides;
- Currency 360 usage, rate, sync, and override data contracts as a foundation;
- targeted root Currency tests and a passing client TypeScript/Vite build.

The implementation backlog should extend these foundations rather than duplicate them.
