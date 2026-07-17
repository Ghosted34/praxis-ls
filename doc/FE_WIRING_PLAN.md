# Frontend Wiring Plan

Turning the scaffolded screens into live, data-backed pages. The infrastructure
already exists; this is about connecting each screen to its API and replacing the
`<Planned/>` placeholder route with a real page.

## Scope & focus

**Main focus: Finance and Operations** — the money-and-movement spine of the app.
But **all areas are in scope**, because the system is end-to-end: a dossier flows

```
Sales/Commercial → Operations → Costing → Procurement → Invoicing → Finance → Vault
        (quote/lead)   (files, transit)  (cost)  (PO/supplier inv)  (AR/AP)  (GL/tax)  (docs)
```

so wiring Finance and Operations well means wiring the areas that feed and consume
them too. We don't do areas in isolation — we follow the flow so each screen's data
is real by the time a downstream screen needs it. No ownership split; one effort.

Notes on the two focus areas:

- **Finance** is already partially wired (`lib/finance-api.ts`,
  `features/finance/pages.tsx`); we finish the remaining screens (e.g. `finance/debt`,
  now backend-ready with edit/delete) and complete the end-to-end legs.
- **Operations** has no feature folder yet — all four screens are backend-`ready`,
  so it gets a fresh `lib/operations-api.ts` + `features/operations/pages.tsx`.

Everything rides one API client, one set of UI primitives, and one four-states
pattern, so the areas stay consistent as we go.

## Design & beautification (draw from Pixie, keep Praxis's skin)

We wire **and** beautify each screen in the same pass — polish is not a later phase.
Design inspiration comes from `C:\pixie-girl-hub` (`apps/admin/src/components/ui/`
+ `docs/FRONTEND_INSTRUCTION_MUST_READ.md`), which is a mature, client-approved kit.

**Adopt from Pixie (patterns & quality):**
- Richer primitives: `DataTable` (sortable, paginated, four states baked in),
  `Drawer` for detail/create/edit, `Pill`/status badges, `KpiTile`, `MoneyText`
  (tabular JetBrains Mono for money), `Skeleton` loaders, `Card`, `Pagination`.
- Glassmorphism on overlays/dropdowns/drawers; hairline borders; soft glow.
- Micro-labels (uppercase, tracked), Playfair for headings/numerals, generous
  spacing, luxe-but-legible. Four states + permission-aware rendering everywhere.

**Keep Praxis's own identity (do NOT copy):**
- Praxis's palette and shell — the orange/blue "Control Tower" tokens in
  `client/src/index.css`, `.lux-topbar`/`.lux-navlink`, `.glass`. We are **not**
  importing Pixie's Maroon Noir colors. Inspiration is structure, components,
  interactions and finish — the brand skin stays Praxis.
- Never inline a hex/font/radius — always the existing token.

**How it lands:** in Wave 0 we grow Praxis's `components/ui/` toward Pixie's kit
(port `DataTable`, `Drawer`, `Pill`, `KpiTile`, `MoneyText`, `Skeleton`, re-skinned
to Praxis tokens). Every screen after that composes those, so beautification is
built-in, not bolted on.

## What already exists (don't rebuild)

- `lib/api-client.ts` — `tenant(path, opts)` / `platform(path, opts)`: attaches the
  Bearer token + `X-Praxis-Env`, does the silent 401-refresh-retry, unwraps the
  `{ data }` envelope, and throws a typed `ApiError { code, message, status }`.
- Per-domain typed wrappers: `lib/finance-api.ts`, `lib/security-api.ts`. Each new
  area gets its own `lib/<area>-api.ts` in the same shape.
- `components/ui/states.tsx` — `Spinner`, `LoadingRow`, `EmptyState`, `ErrorState`.
- `components/ui/*` — `button`, `card`, `input`, `label`, `modal`, `table`,
  `otp-input`, `icons`.
- `features/scaffold/screen-specs.ts` — the catalogue of un-built screens with a
  per-screen `status` (`ready` / `partial` / `readonly` / `none`), planned columns,
  actions, and AI actions. `<Planned/>` renders these. **This is the worklist.**
- `app/app.tsx` — the router; wiring a screen = swap its `<Planned/>` for the real page.
- `lib/rbac.ts` — permission checks for hiding controls the user can't use.

Backend status across the catalogue: **33 ready · 4 partial · 3 readonly · 6 none.**
We wire `ready` first.

## Conventions to lock (both halves follow these)

1. **One api module per area** — `lib/<area>-api.ts` exports typed functions that
   call `tenant("/<route>")`. No `fetch` in components; no cross-area imports.
2. **Fetch pattern** — mirror the existing pages: `useState` + `useEffect`, render
   `Spinner`/`LoadingRow` while loading, `ErrorState` on `ApiError.message`,
   `EmptyState` when empty, data otherwise. (Optional shared helper below.)
3. **Four states on every screen** — loading, empty (with the primary CTA), error
   (with the message), and permission-denied (hide the control via `rbac.ts`).
4. **Writes** — open a `modal.tsx` form; on success, refetch the list and toast;
   surface `ApiError.details` as field errors where present.
5. **Env-aware** — `tenant()` already sends `X-Praxis-Env`; switching Test/Live
   reloads, so no per-screen work.
6. **Keep `screen-specs.ts` honest** — when a screen goes live, remove its spec
   entry (or flip status) and add/update its `screen-registry.json` row.

### Optional shared helper (Claude will add first, opt-in)

`lib/use-resource.ts` — a tiny `useResource(fn, deps)` returning
`{ data, loading, error, reload }` to collapse the useState/useEffect boilerplate
into the four states. Opt-in: existing finance/ops pages keep their inline pattern
unless you choose to adopt it.

## Per-screen wiring recipe

1. Read the screen's spec in `screen-specs.ts` (columns, actions, AI actions).
2. Add/extend `lib/<area>-api.ts` with the list/get/create/update/delete calls
   (routes from the module's `.routes.js`).
3. Build the page in `features/<area>/pages.tsx` using the shared kit
   (`DataTable`, `Drawer`/`Modal`, `Pill`, `KpiTile`, `MoneyText`): header +
   primary action, table from the spec columns, row actions → drawer/modal forms,
   all four states — **styled to Pixie's polish level on Praxis tokens**.
4. Gate controls with `rbac.ts` (`view`/`create`/`edit`/`delete`).
5. **If the spec declares `ai` actions**, drop `<PraxisActions suggestions={…} context="<screen>" onApplied={reload} />` into the header — that is where Praxis drafts/suggests/carries out this screen's actions (see below). Screens with no `ai` block (e.g. all master data) get none.
6. Replace the route's `<Planned/>` in `app.tsx` with the real page.
7. Update `screen-specs.ts` / `screen-registry.json`.

**Done =** loads real data, all four states render, create/edit/delete round-trip
and refetch, controls respect permissions, **looks finished (glass, pills, money
formatting, spacing)**, no console errors.

## In-screen Praxis (per-screen AI actions)

Praxis surfaces **on the screens that declare `ai` actions** in `screen-specs.ts`
(kind `read`/`write`/`assist`) — it drafts, suggests, or carries out *that screen's*
actions. This is distinct from any general chat. Master-data screens declare **no**
`ai` actions, so they correctly show no Praxis; it lights up on Commercial, Sales,
Costing, Procurement, Vault (and one each in Operations/Finance).

Wiring is a drop-in: `components/praxis-actions.tsx` (`<PraxisActions>`) + `lib/ai-api.ts`.
- The page passes the screen's spec `ai` entries as `suggestions` (label + prompt + kind)
  and a `context` hint; the panel sends them to `POST /ai/ask`.
- Proposed **write** actions return `AWAITING_CONFIRM` and run only when the user hits
  **Confirm** (`/ai/actions/:id/confirm`, or batch) — permission-inheriting, so Praxis
  can never exceed the user. `onApplied` refetches the list.
- Praxis's *knowledge* of each screen comes from `screen-registry.json` (keep it current);
  this component is just the UI to invoke it in place.

## Sequence — follow the flow, spine first

Ordered so each screen's data is real before a downstream screen needs it. All
areas are `ready` unless noted.

**Wave 0 — shared base (once):** add `lib/use-resource.ts` (four-states helper) and
grow `components/ui/` toward Pixie's kit (`DataTable`, `Drawer`, `Pill`, `KpiTile`,
`MoneyText`, `Skeleton` — re-skinned to Praxis tokens). Then wire **Master data →
Clients** as the reference implementation (data + polish) every later screen copies.

**Wave 1 — the master data the spine depends on:** clients, suppliers, corporate
entities, treasury accounts (+ the new payment gateways), currencies/expense rates,
tax jurisdictions, financial dictionary. Nothing downstream is real without these.

**Wave 2 — Operations (focus):** new `lib/operations-api.ts` +
`features/operations/pages.tsx`; operations files, milestones, transit orders,
delivery notes. The dossier is the anchor everything else tags.

**Wave 3 — cost & procure against the dossier:** Costing (costing, cost tracking,
cash requests, régie) and Procurement (purchase requests, POs, GRN, supplier
invoices) — the actual-cost and spend legs that feed margin and payables.

**Wave 4 — Finance (focus):** finish `lib/finance-api.ts` / `features/finance` —
proformas & advances, invoices, **credit notes**, receivables, statements, tax
center (file/submit), assets, `finance/debt`. This closes the money loop
(cost in → invoice out → GL → tax).

**Wave 5 — front of the funnel + evidence:** Commercial (quotations, simulations,
pricing variance) and Sales & CRM (leads, opportunities, proposals…) feeding the
dossier; Vault (document vault upload/list/delete, signatures, verification,
compliance flags, reports) capturing the paper trail.

**Wave 6 — oversight & glue:** Control Tower live wiring (consume
`GET /dashboard/control-tower` to replace the iframe mock in `features/dashboard.tsx`),
Governance (audit, notifications, workflows, approvals), Comms, remaining Settings
tiles, Overview `workspace` (readonly), and any `none`/`partial` screens as BE lands.

## Shared primitives (no forking)

Anything reused across areas — `use-resource`, money/date formatters, a common
DataTable — lands in `lib/` or `components/ui/` and every area imports it. Same
`api-client`, same `states.tsx`, same `ui/*` throughout.

## First moves

1. Add `lib/use-resource.ts` and wire **Master data → Clients** end-to-end (Wave 0).
2. Work down the waves along the flow (master data → operations → costing/procurement
   → finance → commercial/sales/vault → oversight).
3. Keep `screen-specs.ts` / `screen-registry.json` current so the worklist always
   reflects reality.

## Locked design conventions (Wave 1 → apply to every later wave)

These are proven in Master Data and are now the standard. Every list/CRUD screen
from Wave 2 on composes them — don't hand-roll or re-style.

**Shared kit (import, don't rebuild):**
- Data: `lib/use-resource.ts` (`useList` / `useResource`, 403 → permission message);
  `lib/<area>-api.ts` typed helpers (one per area).
- Layout: `components/data-list.tsx` — `PageHeader` (accent bar + optional eyebrow)
  and `DataList` (custom `render` per column, row-click, skeleton/error/empty/table).
- Summary: `components/ui/kpi-tile.tsx` — `KpiRow` + `KpiTile`.
- Bits: `components/ui/pill.tsx` (`Pill`/`ActivePill`), `components/ui/skeleton.tsx`,
  `lib/format.ts` (`money`/`num`/`dateFmt`), `components/ui/modal.tsx`
  (`Modal`/`Field`/`Select`) for create/edit.

**Compact top block (locked sizing — keep the table high on the page):**
- `KpiTile`: `px-3.5 py-2.5`, value `.num font-display text-xl`, thin top accent bar
  (`h-0.5 from-primary to-transparent`). `KpiRow`: `mb-4`, `gap-2.5`, 2/3/4 cols.
- `PageHeader`: title `font-display text-[22px]`, `mb-4 border-b pb-3`, left accent
  bar, tight description. No oversized hero headers.
- Screens don't add outer padding (the shell owns `p-6`); container `max-w-6xl`.

**Beautify on Praxis tokens (never Maroon Noir):** glass `.lux-card`, status via
`Pill`, money in `.num`, accents resolve to `--primary` (so tenant re-tint works).
Never inline a hex/font/radius. Light + dark must both work.

**Group related screens into a tabbed hub** (the Master Data pattern) when a nav
group is a set of registries/sub-screens:
- One `<Area>Page` shell + deep-linkable routes `area` and `area/:section`; each tab
  renders its existing page component unchanged.
- Collapse the nav group to a single entry; keep the per-section routes so
  bookmarks/registry/Praxis deep-links still work.
- Tabs = segmented control: track `rounded-xl border bg-muted p-1`; active tab
  `bg-primary text-primary-foreground font-semibold shadow-sm`; content wrapped in
  `<div key={active.key} className="animate-fade-in">` for a smooth switch.
- **RBAC is untouched** — each tab still calls its own module; per-module matrix +
  org-workflow keep referencing the same `MOD-xx` keys.

**In-screen Praxis** on screens whose `screen-specs.ts` declares `ai` actions: drop
`<PraxisActions suggestions={…} context="…" onApplied={reload} />` into the header
(`lib/ai-api.ts` + `components/praxis-actions.tsx`). Screens with no `ai` block get
none (e.g. all master data).

**Client-facing text:** never show internal `MOD-xx` codes in UI strings.

**Environment caveat (operational):** this working tree currently corrupts files on
save (NUL injection / truncation). Prefer small, verified writes; after any edit,
confirm the file has no NULs and ends cleanly; **commit to git frequently** so
there's always a clean fallback.
