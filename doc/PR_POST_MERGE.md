# PR — Post-merge: reconciliation, idiom convergence, last FE screens

_Follows `doc/PR_SESSION_8.md` (merged as #11). Context: `doc/SESSION_HANDOFF.md` →
"Post-merge reconciliation" + "Post-merge continuation"._

## Summary

Reconciles the two streams after the #11 merge, converges the duplicated UI idioms, closes the last
buildable FE items, and fixes two long-standing corporate-entity gaps. **Client `tsc` clean; changed BE
files `node --check` + `eslint` clean.**

## ⚠️ Migrations

**None new.** Note the earlier pair was renumbered at the merge — apply **`0452_campaign_templates.sql`**
and **`0453_session_refresh_jti.sql`** if not already done (they were 0450/0451 before the clash with
`0450_comms_channel_flags` / `0451_email_inbound`).

## Merge reconciliation (his side took precedence)

- Migrations renumbered to 0452/0453 (no environment had applied either pair).
- `/comms` was registered twice — his `CommsHub` won; the duplicate `SmartCommsPage` + route deleted.
- `/godmode` was registered twice — stale `<Planned/>` removed.
- Two workspace pages — kept his `workspace-page.tsx`, deleted the parallel one.
- `settings/help-center` route had been lost in the merge while the hub card + scaffold spec still
  referenced it (card dead-ended on the catch-all redirect) → restored as `<Planned/>`.
- **No conflict** in `app_user.service.js` (his `resolveChannels` + this stream's refresh rotation) or
  `finance/pages.tsx` (his invoice/journal hunks vs this stream's credit-note pickers — disjoint).

## Idiom convergence

- **AI — no change needed.** His `ScreenAi`/`PraxisCopilot` already build on `AiActions`/`useAiEnabled`.
- **Lists — both kept** (`ResourceList` self-fetches; `DataList` is presentational and is the default for
  new wired screens). `cell()` existed twice and had **diverged** on boolean casing → one implementation
  in `lib/format.ts`, re-exported from both, his `"Yes"/"No"` casing kept. No import path changed.
- **Tabs — both kept** (`TabbedHub` = route-driven shell, `Segmented` = in-page state). Master data was
  hand-rolling an identical bar → now uses `TabbedHub` via a new optional **`inlineTabs`** prop
  (default off, his hubs untouched) — needed because that hub's pages don't render `<HubTabs/>`.

## Features

- **Module catalogue** (`/settings/catalogue`) — read-only MOD-xx reference over `GET /catalogue/modules`.
- **Business setup retired** — duplicated the Corporate entities editor; route now redirects to
  `/master/corporate-entities`, hub card repointed.
- **Corporate entity gaps (BE + FE)** — `logo_light_ref`/`logo_dark_ref` added to the validator (they were
  columns the API silently dropped) + new **`POST /entities/:id/logo`** (`{data_url, variant}`, 512 KB cap,
  type-checked, stored per tenant+entity, audited), **gated MOD-01 edit** rather than the MOD-70
  `/branding/logo`. FE editor now covers **Address**, a **Bank details** block (→ invoice payment block)
  and the **letterhead logo**.
- **Control Tower** — the 4th KPI card (receivables overdue) is now live, derived FE-side from the
  existing `receivables_ageing` report producer (no new BE); hides when `reporting` is off.

## Bundle

`vite.config.ts` gained `manualChunks` for the >500 kB warning. **Unverified here** — `vite build` can't
run in the dev sandbox (Windows lockfile ⇒ missing Linux rollup binary). If the Windows build errors,
revert that file; nothing depends on it. It improves caching/parallel download, **not** first-load bytes —
routes are still eagerly imported, so route-level `React.lazy` remains the follow-up.

## Reviewer checklist

- [ ] `npm run lint`, `npm test`, `npm run build --prefix client` pass (build also confirms `manualChunks`).
- [ ] Corporate entities: edit Address + Bank details, upload a letterhead logo → `/media` URL renders.
      (Nothing exercises `storage.put` in the unit suite, so this one needs eyes.)
- [ ] `/settings/business-setup` redirects to Corporate entities; Settings-hub card works.
- [ ] `/settings/catalogue` lists modules; group filter + search work.
- [ ] Master data tabs still render (the `TabbedHub` + `inlineTabs` change).
- [ ] Control Tower shows four live KPI cards; overdue hides if `reporting` is off.
- [ ] Booleans render consistently in tables after the `cell()` dedupe (now "Yes"/"No" everywhere).

## Risk notes

- The entity logo upload path is **not unit-tested** (no storage coverage in the suite) — smoke-test it.
- `manualChunks` is unverified in this environment (see above).
- `cell()` now capitalises booleans on screens that previously rendered "yes"/"no" — cosmetic, intended.
