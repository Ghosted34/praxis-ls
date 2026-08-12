# Desktop Frontend — UI/UX Audit & Remediation Roadmap

**Phase 0 — audit only. No code changed.**
**Date:** 2026-08-04 · **Scope:** `client/` (React 18 + Vite + TS, tenant PWA) · **Reviewer:** Principal Frontend Engineer (inherited codebase)

---

## 0. Executive summary

The verdict up front, because it is not the one the brief anticipated.

This codebase is **not** "no reusable components". It has a real primitive layer (`components/ui/*`), a real token system (`index.css` + `tailwind.config.ts`), shared data hooks (`lib/use-resource.ts`), and a shared list scaffold (`components/data-list.tsx`) that 36 files genuinely use. Someone competent built a design system here.

The problem is that **the system was never finished, never enforced, and is now actively diverging from itself.** Three things follow from that:

1. **The desktop breakpoint does not exist.** The app has 216 `sm:` (640px) prefixes, 22 `md:`, 30 `lg:`, and **zero `xl:` / `2xl:`**. Every layout decision in the product is made at 640px. Combined with `mx-auto max-w-6xl` repeated at **86 call sites**, the app renders _identically_ at 1280px, 1920px and 2560px — a 1152px column floating in dead space. This is precisely the "stretched mobile view" the brief describes, and it is mechanical, not aesthetic.

2. **The design system has no enforcement, so it forked.** `components/ui/card.tsx` exports a complete Card set with **zero importers** — while four competing hand-rolled card recipes are used instead. 122 raw Tailwind palette colours bypass the tokens the team's own doc calls rule #1. Six copies of the same error helper exist.

3. **Accessibility is systematically, not incidentally, broken.** 569 form fields render a `<label>` with no association to their control. `aria-invalid`, `aria-describedby` and `aria-required` appear **zero times in ~40,000 lines**. The `.micro` label class — used 198 times — sits at **3.01:1 contrast**, failing WCAG AA in both light and dark themes.

Underneath all of it sits the finding that should be fixed first regardless of roadmap: **the home screen is a static HTML mock in an iframe** (F1).

The good news is that the corrective path is short, because the foundation is 70% built. This is a _completion and enforcement_ project, not a rewrite.

### Severity roll-up

| Sev          | Count | Headline items                                                                                                                                                                                               |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Critical** | 4     | Control Tower iframe · no desktop breakpoints · form label association · documented on-ramp is fictional                                                                                                     |
| **High**     | 9     | Container cap · god files · token bypass · `.micro` contrast · menu keyboard nav · heading structure · dead primitives · no tests · no a11y lint                                                             |
| **Medium**   | 11    | Loading inconsistency · `errMsg` double-wrap bug · nav IA · focus indicators · state duplication · card drift · typography scale · undefined CSS class · modal focus trap · empty-state gaps · inline styles |
| **Low**      | 3     | Icon duplication · FAB overlap · `dangerouslySetInnerHTML`                                                                                                                                                   |

---

## 1. Method & scope

Every file under `client/src` was inventoried; all 96 screens in `app/screen-registry.json` were traced through `app/app.tsx` to their implementing component. Findings below are grounded in file references and counts produced from the tree, not from pattern assumptions.

**Inventory:**

|                        |                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Client source          | ~39,650 lines across 173 TS/TSX files                                                  |
| Screens (registry)     | 96, across 17 areas                                                                    |
| Routes (`app/app.tsx`) | 62 `<Route>` declarations, 20 hub routes with `:section`                               |
| Feature areas          | 24 directories under `features/`                                                       |
| Shared primitives      | 12 files in `components/ui/`                                                           |
| Shared mid-tier        | `data-list`, `resource-list`, `tabbed-hub`, `action-form`, `document-view`, `praxis-*` |
| Frontend tests         | **0** (backend has ~50 Jest suites)                                                    |

A second surface exists — `platform-console/` (8 files, separate vendor-facing app). It is out of scope for this audit but shares none of the tenant app's primitives, which is itself worth noting as a future consolidation candidate.

---

## 2. Findings

### F1 — The home screen is a static HTML mock inside an iframe

**Severity: Critical · Structural**

`features/dashboard.tsx` (1,196 lines) does not render React. It builds an HTML string and injects it into an `<iframe srcDoc>`:

```
client/src/features/dashboard.tsx:1188-1195
    <iframe title="Control Tower" srcDoc={srcDoc}
      className="h-[calc(100vh-7rem)] w-full border-0"
      sandbox="allow-scripts allow-same-origin" />
```

The content is three raw text assets totalling **1,440 lines** (`features/dashboard-mock/body.html.txt`, `style.css.txt`, `script.js.txt`). Live data is grafted on by generating a `<script>` that rewrites the DOM via `innerHTML` (`dashboard.tsx:662, 671, 676, 843, 906, 954-956`), navigation is a `postMessage` bridge (`:726, :747, :970, :987`), and theming is a `MutationObserver` watching `window.parent.document`.

Consequences, all of them live today:

- **Duplicated design system.** The mock ships its own 575-line stylesheet redefining `--ink`, `--ok`, `--warn`, `--bad`, `.micro`, `.status`, `.st-*` (`style.css.txt:11-108`). Tenant white-labelling — the product's core promise — does **not** reach it: `--primary` is never forwarded into the frame.
- **Its own, worse responsive behaviour.** The mock's breakpoints top out at `@media (max-width: 1180px)` (`style.css.txt:401`). Above 1180px it is frozen. The app's most-viewed screen is the least desktop-aware.
- **Fixed-height guesswork.** `h-[calc(100vh-7rem)]` hardcodes the shell chrome at 112px. The real header is 66px, `<main>` adds `p-6`, and in TEST mode a sandbox banner adds ~37px more (`app-shell.tsx:878-886`) — so the frame is mis-sized in the default case and clipped in sandbox.
- **Sandbox is nominal.** `allow-scripts allow-same-origin` together permit the frame to reach `window.parent.document` — which the theme sync relies on. That combination is documented by the HTML spec as effectively removing the sandbox.
- Untestable, un-instrumentable, unreachable by the command palette, and outside the parent's focus order.

The KPI cards, drill-downs, live-shipment list and world map are genuinely good work. They need to be React components fed by the same hooks as the rest of the app.

---

### F2 — There is no desktop breakpoint. The entire app lays out at 640px.

**Severity: Critical · Structural**

Breakpoint prefixes across all `.tsx`:

| Prefix | Min-width | Count   |
| ------ | --------- | ------- |
| `sm:`  | 640px     | **216** |
| `md:`  | 768px     | 22      |
| `lg:`  | 1024px    | 30      |
| `xl:`  | 1280px    | **0**   |
| `2xl:` | 1536px    | **0**   |

Grid usage tells the same story: **111 × `sm:grid-cols-2`** against 7 × `lg:grid-cols-2`, 6 × `lg:grid-cols-3`, 5 × `lg:grid-cols-4`.

Concretely: a form or KPI grid becomes two columns at 640px and _remains two columns_ at 2560px. A 24" monitor gets the tablet layout. `tailwind.config.ts` never customises `screens`, so the defaults apply unchanged and the two widths that matter for this product's users are unaddressed.

This is the single highest-leverage finding in the audit. It is also, unusually, mostly mechanical to fix.

---

### F3 — Every page self-caps at 1152px

**Severity: High · Quick win (mechanically), Structural (to do well)**

`mx-auto max-w-6xl` appears at **86 call sites**. It is copy-pasted as a literal in ~40 files and aliased as `const shell = "mx-auto max-w-6xl animate-fade-in"` in ~28 more (e.g. `features/finance/hub.tsx:24`).

`app/layout/app-shell.tsx:890` gives `<main>` no width constraint at all — so the cap lives entirely in the pages, inconsistently:

| Width                | Files                                                          |
| -------------------- | -------------------------------------------------------------- |
| `max-w-6xl` (1152px) | 86 sites — the de facto standard                               |
| `max-w-5xl`          | `hr/my-hr.tsx`                                                 |
| `max-w-4xl`          | `help/help-page.tsx`                                           |
| `max-w-3xl`          | `settings/appearance-page.tsx`, `components/document-view.tsx` |
| `max-w-2xl`          | `settings/login-editor.tsx`                                    |
| _(none)_             | `comms/team-chat.tsx`                                          |

Five different page widths, no rule governing which to use, and no `<main>`-level container to change centrally. On a 1920px viewport the data tables — the actual product — occupy 60% of the screen while the operator scrolls.

The fix is not "remove the cap": dense financial tables want width, reading-oriented settings pages do not. It needs a small set of named container widths applied deliberately (see Phase 2).

---

### F4 — 569 form fields have no label-to-control association

**Severity: Critical · Structural**

`components/ui/modal.tsx:440-469` is the `Field` wrapper used by essentially every write form in the product:

```tsx
<div className={cn("space-y-1.5", className)}>
  <label className="text-sm font-medium text-foreground">   // no htmlFor
    {label}
    {required && <span className="text-destructive"> *</span>}
  </label>
  {children}                                                 // no id, no aria-*
  {error ? <p className="text-xs text-destructive">{error}</p> : …}
</div>
```

The label wraps nothing and points at nothing. Measured impact:

|                                                                           | Count                          |
| ------------------------------------------------------------------------- | ------------------------------ |
| `<Field>` render sites                                                    | **569** across 40+ files       |
| …with label→control association                                           | **0**                          |
| …passing `required` (renders a visual `*` only)                           | 188                            |
| …passing `error`                                                          | **4**                          |
| `aria-required` / `aria-invalid` / `aria-describedby` in the whole client | **0 / 0 / 0**                  |
| `htmlFor` anywhere                                                        | 12 (against 647 form controls) |

This fails **WCAG 2.1 §1.3.1 (Info and Relationships)**, **§3.3.2 (Labels or Instructions)** and **§4.1.2 (Name, Role, Value)** at every write surface in the ERP. A screen-reader user hears "edit text, blank" on 569 fields. Clicking a label does not focus its input. Required-ness is conveyed by a red asterisk and nothing else.

Because it is one component, the _structural_ fix is one component — but the 188 `required` and 4 `error` call sites show the field-level validation story is also mostly missing (see F12).

Heaviest concentrations: `masterdata/pages.tsx` (50), `finance/pages.tsx` (50), `sales/pages.tsx` (48), `security/pages.tsx` (25), `settings/config-pages.tsx` (24), `master/pages.tsx` (24).

---

### F5 — The documented way to build a screen does not exist

**Severity: Critical · Quick win (doc), Structural (the on-ramp itself)**

`doc/FE_DESIGN_RULES.md` §3 is the onboarding path for a new engineer. It states:

> **The default list screen is `<ResourceList>`** … **Write-capable lists use `<CrudResource>`** (`components/crud-resource.tsx`) — the create / edit / delete sibling … driven by a declarative `fields` spec.

Both claims are false:

- **`components/crud-resource.tsx` does not exist.** No file, no export, no reference anywhere in `client/src`. It is referenced by four docs (`FE_DESIGN_RULES.md`, `UI_DEPTH_OVERHAUL_PLAN.md`, `WORK_DONE.md`, `SESSION_HISTORY.md`).
- **`ResourceList` exists but has zero call sites.** `components/resource-list.tsx` is imported by nothing; the only two mentions in `features/` are comments recording its removal (`finance/pages.tsx:1123`, `security/pages.tsx:4`).

So the documented on-ramp points at a deleted component and a dead one. Every screen instead hand-rolls `useList` + `DataList` + a bespoke `Modal` form. **This is the root cause of most other findings in this audit** — there is no paved road, so 24 feature areas each paved their own.

This is why the roadmap leads with foundation rather than pages: fixing screens without fixing the on-ramp reproduces the drift.

---

### F6 — Duplication: the same UI reimplemented instead of shared

**Severity: High · Structural**

**Card surfaces.** `components/ui/card.tsx` exports `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`. **Import count: 0.** It is dead code. Meanwhile:

| Recipe                                                   | Uses                            |
| -------------------------------------------------------- | ------------------------------- |
| `rounded-2xl border border-border bg-card p-5 shadow-sm` | 12 (across 11 files)            |
| `lux-card` + ad-hoc padding/flex                         | ~40 in 14 distinct combinations |
| `rounded-xl border bg-card p-5`                          | 5                               |
| `rounded-lg border bg-card …`                            | 4                               |

The identical "panel with a serif title and a CTA" block is independently written in `features/finance/hub.tsx:70` (`AgeingPanel`), `:115` (`CashPanel`), and `features/workspace/workspace-page.tsx:29` (`Panel`).

**Error helpers.** `lib/use-resource.ts:10` exports `errMsg`. Five files define their own copy anyway: `features/master/pages.tsx:22`, `features/sales/ui.tsx:12`, `features/finance/pages.tsx:92`, `features/settings/master-data-pages.tsx:19`, `features/settings/config-pages.tsx:23`. **Six implementations of one 6-line function.**

**Money formatting.** `lib/format.ts` exports `money`. Four more exist: `components/document-view.tsx:67`, `features/sales/ui.tsx:31`, `features/finance/pages.tsx:106`, `features/portal/portal-app.tsx:225` — with differing locale, currency and fraction-digit behaviour, so the same amount can render differently on two screens.

**Textarea.** No primitive exists. 18 raw `<textarea>` elements, styled by three separate local constants: `components/settings/controls.tsx:76`, `components/action-form.tsx:15`, `features/settings/store-pages.tsx:26`.

**Icons.** `components/ui/icons.tsx` holds 20 icons. `app/layout/app-shell.tsx` defines **26 more inline** (`:164-345`), `components/floating-actions.tsx` 4 more (`:24-27`), `features/settings/settings-hub.tsx` a `Glyph` switch of ~8. Several — download, search, shield, help, chevron — are drawn two or three times with different path data.

**Tables.** `components/ui/table.tsx` is the shared table; `components/ui/workflow.tsx:888` (`LineTable`) is a second, independent table implementation; and 12 feature files still emit raw `<table>`.

---

### F7 — Component architecture: god files and no page-level decomposition

**Severity: High · Structural**

17 files exceed 400 lines. The worst:

| Lines | File                                 | Top-level fns | Exported |
| ----- | ------------------------------------ | ------------- | -------- |
| 2,596 | `features/finance/pages.tsx`         | 34            | 4        |
| 2,591 | `features/sales/pages.tsx`           | 27            | 6        |
| 1,196 | `features/dashboard.tsx`             | —             | 1        |
| 1,137 | `features/settings/config-pages.tsx` | 18            | 6        |
| 1,061 | `features/security/pages.tsx`        | 16            | 6        |
| 1,052 | `features/vault/pages.tsx`           | 12            | 5        |
| 1,035 | `features/commercial/pages.tsx`      | 11            | 4        |
| 941   | `features/operations/pages.tsx`      | 14            | 4        |
| 938   | `features/governance/pages.tsx`      | 18            | 4        |

`finance/pages.tsx` holds 34 components — modal forms, tables, KPI blocks, a local `useOptions` hook (`:71`), a local `errMessage` (`:92`), a local `money` (`:106`) — behind 4 exports. Nothing inside is reachable, testable or reusable from elsewhere; a sibling screen needing the same journal-line editor must copy it.

**Coupling.** `features/finance/pages.tsx:22` imports `SearchSelect` from `features/sales/ui.tsx` — Finance depends on Sales for a form control. `features/dashboard.tsx:20` imports `errMsg` from `features/sales/ui.tsx`. Feature areas reach sideways into each other because there is no shared home for these.

**Prop drilling is _not_ a significant problem here**, and it is worth being accurate about that: pages are flat, and there are only three contexts (`auth-context`, `branding-context`, `tabbed-hub`'s `HubTabsContext`). The architectural debt is file size and missing extraction, not deep prop chains.

**One genuine anti-pattern:** `components/tabbed-hub.tsx` publishes its tab bar through React context and relies on each child page to render `<HubTabs/>` in the right place — with an `inlineTabs` escape hatch (`:28`) for hubs whose pages forgot. Whether a hub's tabs appear depends on a convention no type signature enforces.

---

### F8 — Data fetching: no cache, duplicate requests, client-side filtering

**Severity: High · Structural**

There is no data layer. 148 `useEffect`s, 161 `useList`/`useResource` calls, and **196 raw `tenant()` calls made directly inside components** — roughly half of all fetching bypasses the shared hooks.

`useList` (`lib/use-resource.ts:18`) has no cache, no deduplication, no stale-while-revalidate. Every mount refetches. `features/finance/hub.tsx:145-163` fires **nine concurrent requests** on load — `/clients`, `/operations`, `/final-invoices`, `/proformas/advances`, `/receivables`, `/journal-entries`, `/treasury-accounts`, plus trial balance and ageing — then filters **entirely client-side** (`:170`, `hit()`), and re-fetches all nine every time the user navigates back.

For an ERP whose tables will reach five and six figures of rows, unpaginated fetch-everything-then-filter is a correctness and cost problem, not only a performance one. `/clients` and `/operations` in particular are fetched by many screens purely to build an id→name map (`finance/hub.tsx:33`, `:149`) — a lookup that belongs in a cached shared resource.

---

### F9 — Responsive failures beyond the breakpoint gap

**Severity: Medium–High · Mixed**

To be accurate: **the two patterns the brief specifically flags are handled correctly.** The bottom nav is `md:hidden` (`app-shell.tsx:676`) and the hamburger is `md:hidden` (`:786`). They do not leak onto desktop. What leaks is subtler:

- **12 of 16 top-level areas are behind an overlay drawer on every viewport.** `TOPBAR` inlines only `["Overview", "Operations", "Fleet", "Finance"]` (`app-shell.tsx:148`) out of 16 `NAV` groups. Commercial, Sales, Procurement, Costing, Warehouse, HR, Master data, Vault, Comms, Security, Governance and Settings are reachable only through "More", which opens a `fixed inset-0` scrim + 288px drawer (`:860-873`) — a phone navigation pattern, on a 2560px screen with several hundred pixels of unused top bar. Desktop users pay two clicks and a full-screen overlay to reach three quarters of the product.
- **`DataList` swaps to cards below `sm:`** (`data-list.tsx:87`, `:116`) — correct — but the table branch above `sm:` never adapts again. Column count, density and truncation are identical at 641px and 2560px.
- **The mobile card fallback is not keyboard accessible.** `onRowClick` is attached to a `<div>` (`data-list.tsx:120`) with no `role`, `tabIndex` or key handler.
- **Fixed viewport maths.** `dashboard.tsx:1191` (`h-[calc(100vh-7rem)]`, see F1) and the FAB's `bottom-24 right-5 md:bottom-6` (`floating-actions.tsx:113`).
- **The draggable FAB overlaps content at any width** (`floating-actions.tsx`) and persists its position in `localStorage`. A draggable floating cluster is a touch idiom; on desktop it covers the bottom-right of every table and duplicates the copilot entry point that already exists.
- **Information density is uniformly low.** `TD` is `px-4 py-3.5` (`ui/table.tsx:755`) with no compact variant — reasonable for touch, wasteful for an operator scanning 200 shipment rows on a large display.

---

### F10 — Loading states: five different idioms, inconsistently applied

**Severity: Medium · Quick win**

The primitives are good (`ui/skeleton.tsx` even documents _when_ to use which). Adoption is not:

| Idiom                         | Uses   |
| ----------------------------- | ------ |
| `<SkeletonTable>`             | 46     |
| ad-hoc `Loading…` text        | **28** |
| `<LoadingRow>`                | 10     |
| `<PageSkeleton>`              | 3      |
| `<Spinner>`                   | 2      |
| `"…"` substituted for a value | 6      |

15 sites hand-roll `<div className="py-8 text-center micro">Loading…</div>` — e.g. `features/workspace/workspace-page.tsx:52`, `finance/receivables.tsx:146`, `finance/debt.tsx:130`, `governance/pages.tsx:766`, `ai-control/pages.tsx:159`. Two sibling Finance screens use different loading affordances for the same shape of content.

`PageSkeleton` — the best of them, drawing header, toolbar, tiles and rows — is used **3 times in 96 screens**.

Additional issues: `Button` has a `loading` prop that renders a spinner but sets no `aria-busy`; skeletons carry `role="status"` (`skeleton.tsx:27`, `:54`) but there is no live region announcing _completion_, so screen-reader users get no arrival signal.

---

### F11 — Empty states: good primitive, uneven coverage, generic copy

**Severity: Medium · Quick win**

`DataList` requires an `empty` prop and falls back to `"Nothing here yet" / "No records returned."` — a developer-facing sentence that tells an operator nothing.

Where `empty` _is_ supplied, the copy is genuinely good — `finance/hub.tsx:259`: _"No invoices — Issue a final invoice from an approved costing."_ That is the standard the rest should meet.

Screens with **no empty state at all**: `features/dashboard.tsx` (the home screen), `features/wms/equipment.tsx`, `features/wms/locations.tsx`, `features/security/my-security.tsx`, `features/security/permission-matrix-page.tsx`, `features/settings/appearance-page.tsx`, `features/settings/login-editor.tsx`, `features/settings/document-templates-page.tsx`, `features/comms/setup.tsx`, `features/comms/team-chat.tsx`, `features/workspace/workspace-page.tsx`.

No empty state anywhere offers a **primary action** — the pattern that turns an empty table into an onboarding step. `EmptyState` (`ui/states.tsx:710`) accepts only `title` and `hint`; it needs an `action` slot.

---

### F12 — Errors & edge cases, including a live defect

**Severity: Medium–High · Mixed**

**A real bug: `errMsg` applied twice, discarding the server's message.**
`useList`/`useResource` already return `error` as a **formatted string** (`lib/use-resource.ts:30`, `:47`). 16 call sites pass that string through `errMsg()` _again_. Because a string is not an `ApiError`, `errMsg` falls to its default branch and returns the generic `"Something went wrong."` — **overwriting the real, specific error**, including the 403 permission message the helper exists to produce.

Confirmed at: `hr/attendance.tsx:68`, `hr/payroll.tsx:124`, `governance/pages.tsx:766`, `finance/receivables.tsx:146`, `finance/debt.tsx:130`, `workspace/workspace-page.tsx:54`, `operations/pages.tsx:304`, `comms/setup.tsx:209`, `comms/mail.tsx:64/147/239/305/306`, `comms/team-chat.tsx:232/305`, `ai-control/pages.tsx:159`.

**A second real bug: an undefined CSS class.** `features/scaffold/screen-scaffold.tsx:28` maps the `readonly` backend status to `"st-info"`. `index.css` defines `.st-blue`, `.st-orange`, `.st-ok`, `.st-warn`, `.st-bad`, `.st-mute` — **there is no `.st-info`**. Every read-only screen scaffold renders an unstyled, colourless status pill.

**Structural gaps:**

- **No error boundary anywhere.** A render-time throw in any screen blanks the entire SPA. There is no `componentDidCatch`/`ErrorBoundary` in the client.
- **Field-level validation is effectively absent** — 4 of 569 `Field`s receive an `error` (F4). Validation is enforced server-side and surfaced as one banner string; the user is not told _which_ field failed. `finance/pages.tsx:92-104` does parse 422 `details` into `"field: message"` text, but flattens it into a single sentence rather than routing it to the offending inputs.
- **No form library and no schema sharing.** The backend validates with Zod (`package.json`), and the README describes a `packages/shared` for exactly this — but that directory does not exist, and the client re-implements validation as ad-hoc booleans (e.g. `finance/pages.tsx:141`, `canSubmit`).
- `components/action-error-banner.tsx` is a retrofit explicitly documented (`app-shell.tsx:896-898`) as covering "screens whose handlers had no catch" — a known, tracked gap.

---

### F13 — Accessibility

**Severity: Critical (aggregate) · Structural**

Benchmark: **WCAG 2.1 AA as the floor.**

**Colour contrast — measured, not estimated.**

| Ratio      |         | Token / usage                           |
| ---------- | ------- | --------------------------------------- |
| **3.01:1** | ❌ FAIL | `.micro` — `--ink-3` on `--card`, light |
| **2.78:1** | ❌ FAIL | `.micro` on `--background`, light       |
| **3.89:1** | ❌ FAIL | `.micro` on `--card`, dark              |
| **2.59:1** | ❌ FAIL | `--primary` orange text on `--card`     |
| **3.53:1** | ❌ FAIL | `--warn` text on `--card`               |
| **3.83:1** | ❌ FAIL | `--ok` text on `--card`                 |
| 4.54:1     | ✅ pass | `--bad` text on `--card`                |
| 6.21:1     | ✅ pass | `--muted-foreground` on `--card`        |
| 5.93:1     | ✅ pass | `TH` label on `--secondary`             |

`.micro` is 10px, uppercase, `0.19em` tracked — unambiguously "normal text" under WCAG (large = 18.66px bold / 24px). It is used **198 times across 54 files** for eyebrows, table captions, empty-state text and loading text, and `doc/FE_DESIGN_RULES.md` §2 recommends it. It fails AA in _both_ themes.

The `--ok`/`--warn`/`--primary` failures matter because status pills (`.status`, 10.5px bold) are how the ERP communicates document state — the most semantically loaded text in the product. Note these pills pair the failing colour with a _tinted_ background, which is worse than the white-background figures above, not better.

**Keyboard & focus.**

- **No focus indicator on `.chip`, `.lux-navlink`, or `.lux-botnav-btn`** — `index.css` defines no `:focus-visible` rule for any of them. The primary navigation and every filter chip are invisible to keyboard users. The `Button` primitive _does_ ring correctly (`ui/button.tsx:65`).
- **`role="menu"` without menu keyboard semantics** at `app-shell.tsx:440`, `:530` and `notification-bell.tsx:111`. `app/layout/app-shell.tsx` contains **zero `onKeyDown` handlers**. Declaring `role="menu"`/`role="menuitem"` promises arrow-key navigation, Home/End and type-ahead, and strips the underlying link semantics — so this is actively worse than plain links would be.
- **No focus trap and no focus restoration in `Modal`** (`ui/modal.tsx:380-390`) — it handles Escape and body-scroll lock only. Tab moves focus behind the dialog; on close, focus is lost to `<body>`. **WCAG §2.4.3.** This affects every write form in the product.
- **Tabs are not tabs.** `components/tabbed-hub.tsx:41-57` renders a `<div>` of `<button>`s with no `role="tablist"`/`role="tab"`/`aria-selected` and no arrow-key handling. Same in `screen-scaffold.tsx:62-76`.
- **23 `onClick` handlers on non-interactive elements** (`div`/`tr`/`li`/`span`/`td`) across 16 files — no `role`, `tabIndex` or key handler. Only 6 `onKeyDown` handlers exist app-wide.
- **No skip link** to `<main>`. With 12 nav areas behind an overlay, keyboard users tab through the full header on every navigation.

**Semantics.**

- **~116 of 117 pages have no `<h1>`.** `PageHeader` (`data-list.tsx:44-54`) renders `<h1>` _only_ when `description` is absent — and 116 of 117 call sites pass one. The title degrades to a `.micro` `<div>` and the description becomes a `<p>`. Only ~9 real page `<h1>`s exist. Heading order is also arbitrary: `<h3>` appears inside pages with no `<h2>` (`finance/hub.tsx:71`, `:116`).
- **Labels:** see F4 — 569 unassociated fields, 0 ARIA state attributes.
- **Live regions:** 3 in ~40,000 lines (`skeleton.tsx:27`, `:54`, `action-error-banner.tsx:29`). Async success/failure is announced nowhere.
- `<table>` elements have no `<caption>` and no `scope` on `<th>`.

**Tooling:** `client/eslint.config.js` has no `eslint-plugin-jsx-a11y`. Nothing prevents regression.

**Where AAA is worth pursuing:** body text contrast (7:1) is nearly met already at 6.21:1 — worth locking in for `--muted-foreground` while retuning `.micro`. Status pills and money figures are the other candidates: they carry financial meaning where misreading has real cost.

---

### F14 — Visual & UX consistency

**Severity: Medium · Mixed**

**Typography has no scale.** 19 distinct sizes in use — 7 Tailwind steps (`text-sm` ×470, `text-xs` ×171, `text-lg` ×33, `text-base` ×12, `text-2xl` ×10, `text-xl` ×6, `text-3xl` ×2) plus **12 arbitrary pixel values**: `text-[11px]` ×30, `[13px]` ×15, `[10px]` ×7, `[9px]` ×5, `[15px]`, `[12px]`, `[9.5px]`, `[22px]`, `[18px]`, `[14px]`, `[12.5px]`, `[11.5px]`. `tailwind.config.ts` extends `colors`, `borderRadius`, `keyframes` and `animation` — but **not `fontSize` or `spacing`**. There are no typography tokens, so every developer picks a pixel value.

Page titles are consequently inconsistent: `text-[22px]` (`data-list.tsx:53`), `text-3xl` (`finance/hub.tsx:208`, `help-page.tsx:34`), `text-2xl` (`settings-hub.tsx:117`, `screen-scaffold.tsx:44`, `comms/setup.tsx:201`).

**Colour tokens are bypassed 122 times.** `doc/FE_DESIGN_RULES.md` rule #1 is "Never hardcode colours." Yet: `text-emerald-400` ×17, `text-emerald-600` ×16, `bg-emerald-500` ×15, `bg-amber-500` ×10, `text-amber-600` ×8, `text-amber-400` ×8, `bg-sky-500` ×6, `text-rose-*` ×10, `text-violet-*` ×2, `text-red-500` ×2 — across 12 files including `app/layout/app-shell.tsx` itself (`:832`, `:844`) and `components/floating-actions.tsx:145`. Semantic equivalents (`--ok`, `--warn`, `--bad`, `--brand-blue`) exist for all of them. Every one breaks tenant white-labelling.

**48 inline `style={{…}}` blocks** bypass the system further, several re-specifying `background: var(--popover)` immediately after a `bg-popover` class (`app-shell.tsx:441`, `:531`).

**Page shells differ per area** — see F3's table. `const shell` is defined independently in 28 files rather than imported once.

**Interaction patterns differ for the same job:** Finance filters with `.chip` buttons (`finance/hub.tsx:245`), hubs filter with underlined tab buttons (`tabbed-hub.tsx:41`), the scaffold uses a third tab style (`screen-scaffold.tsx:62`). Row click navigates on some tables (`onRowClick`) and does nothing on others, with no visual cue distinguishing them.

**Iconography:** three icon systems (F6), plus emoji/text glyphs used as controls — `☰` (`app-shell.tsx:790`), `✕` (`:867`), `⚠` (`:880`), `✓`/`!` (`finance/hub.tsx:224`).

---

### F15 — Developer experience

**Severity: High · Structural**

How hard is it to build a new page consistently today? **Very** — and the evidence is that 24 feature areas each solved it differently.

| What's missing                                                                               | Consequence                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Working documented on-ramp (F5)                                                              | New dev imports a nonexistent component                |
| `fontSize` / `spacing` tokens (F14)                                                          | 19 type sizes, arbitrary padding                       |
| Container width rule (F3)                                                                    | 5 page widths, `shell` redefined 28×                   |
| Form abstraction (F4, F12)                                                                   | Every form hand-rolls state, validation, error mapping |
| `Textarea`, `Checkbox`, `Radio`, `Tabs`, `Menu`, `Tooltip`, `Toast`, `Pagination` primitives | Re-invented inline or absent                           |
| **Any frontend test**                                                                        | 0 client tests vs ~50 backend suites                   |
| `eslint-plugin-jsx-a11y`                                                                     | A11y regressions ship silently                         |
| Component workbench (Storybook or equivalent)                                                | No way to see a primitive's states                     |
| Usage examples per primitive                                                                 | Docs describe two components that don't work           |

`tsconfig.json` is strict (`strict`, `noUnusedLocals`, `noUnusedParameters`) — genuinely good. But `react-hooks/exhaustive-deps` is `warn`, not `error`, and is suppressed 4 times; `@typescript-eslint/no-explicit-any` is `off`.

**Doc drift is the compounding factor.** `doc/` holds 38+ markdown files including six overlapping frontend plans (`FE_DESIGN_RULES`, `FE_IA_HANDOFF`, `FE_IA_BUILD_MAP`, `FE_WIRING_PLAN`, `FRONTEND_PLAN`, `LOVABLE_FIDELITY_PLAN`, `UI_DEPTH_OVERHAUL_PLAN`). A new engineer cannot tell which is current — and the one that reads most authoritative is the one that's wrong.

---

### F16 — Tech stack gaps

**Severity: High · Structural**

Current client dependencies: `react`, `react-dom`, `react-router-dom`, `clsx`, `tailwind-merge`, `socket.io-client`, `topojson-client`, `world-atlas`. That is all. **No state library, no data layer, no form library, no test runner, no a11y tooling, no component primitives.**

Recommended additions, each justified by a finding above. All are compatible with the fixed React + Vite / Node foundation.

| Concern                   | Recommendation                                                                                                               | Why — grounded in this audit                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server state**          | **TanStack Query v5**                                                                                                        | F8: 9 concurrent unpaginated fetches per hub, zero caching, refetch on every mount. Query gives caching, dedup, background refresh and pagination with a near drop-in replacement for `useList`. Highest ROI of anything here.               |
| **Accessible primitives** | **Radix UI** (Dialog, Tabs, DropdownMenu, Popover, Tooltip, Checkbox, RadioGroup, Select)                                    | F13: focus trap, `role="menu"` keyboard semantics and tab semantics are exactly what Radix solves correctly. Headless + unstyled, so the existing token look is preserved. Do **not** adopt a styled kit — the visual system already exists. |
| **Forms + validation**    | **React Hook Form + Zod**, with `@hookform/resolvers`                                                                        | F4/F12: 569 fields with no validation wiring; backend already uses Zod. Create the `packages/shared` the README promises and share schemas FE↔BE — one definition of "valid".                                                                |
| **Client state**          | **None — keep React context**                                                                                                | Deliberate: F7 found no prop-drilling problem. With server state moved to Query, the residual client state (auth, branding, theme) is small. Adding Zustand/Redux would be unjustified.                                                      |
| **Testing**               | **Vitest + React Testing Library + jest-axe**                                                                                | F15: zero frontend tests. Vitest shares the Vite config. `jest-axe` turns F13 into a regression gate rather than a one-off cleanup.                                                                                                          |
| **E2E / visual**          | **Playwright**                                                                                                               | Already installed and configured in this environment. Needed to prove F2/F3 at 1280/1440/1920/2560 — desktop regressions are invisible to unit tests.                                                                                        |
| **A11y linting**          | **`eslint-plugin-jsx-a11y`**                                                                                                 | F13: catches the 23 non-interactive `onClick`s and unassociated labels at author time. Add as `error` for new code.                                                                                                                          |
| **Tokens**                | **Extend `tailwind.config.ts`** with `fontSize`, `spacing`, `screens` (add `xl`/`2xl` intent), `maxWidth` (named containers) | F2/F3/F14: the config currently extends colours only, which is precisely why type and width fragmented.                                                                                                                                      |
| **Component workbench**   | **Storybook** (or Ladle for a lighter footprint)                                                                             | F15: satisfies the standing requirement for "usage examples for every new shared component".                                                                                                                                                 |
| **Bundle**                | Route-level `React.lazy`                                                                                                     | `vite.config.ts:90` already notes routes are eagerly imported and that lazy loading is "the follow-up". 62 routes in one entry bundle.                                                                                                       |

Explicitly **not** recommended: a component library with opinionated styling (MUI/Chakra/Ant) — it would fight the existing token system; a CSS-in-JS runtime — Tailwind + tokens is working; a state management library — see above.

---

## 3. Remediation roadmap — 5 phases

**Sequencing rationale.** Foundation-first, not highest-traffic-first. F5 is the reason: the drift in this codebase is caused by a missing paved road, so fixing high-traffic pages before the road exists would produce a fourth dialect of the same components. The one exception is the Control Tower (F1), which is scheduled early in Phase 3 because it is the first screen every user sees and is the largest single-file liability.

Each phase is independently shippable and leaves the app in a working state.

---

### Phase 1 — Foundation: tokens, containers, and the desktop breakpoint

**Objective.** Establish the design contract the rest of the work depends on: a type scale, a spacing scale, named container widths, real desktop breakpoints, and a token layer that passes WCAG AA.

**Scope**

- Extend `tailwind.config.ts`: `fontSize`, `spacing`, `maxWidth` (named containers), explicit `screens` including `xl`/`2xl`.
- Retune failing tokens in `index.css`: `--ink-3` (F13 — `.micro` at 3.01:1), `--ok`, `--warn`, and the `--primary`-as-text case. Preserve brand hue; adjust lightness to clear 4.5:1 in both themes. Add `.st-info` (F12).
- Add `:focus-visible` rules for `.chip`, `.lux-navlink`, `.lux-botnav-btn` (F13).
- Introduce `<PageContainer variant="wide|standard|reading">` and adopt it in `<main>` (`app-shell.tsx:890`), replacing the 86 `max-w-6xl` literals and the 28 local `const shell`s.
- Install and configure: `eslint-plugin-jsx-a11y`, Vitest + RTL + jest-axe, Playwright desktop viewport project.
- Retire `doc/FE_DESIGN_RULES.md`'s false claims (F5); mark superseded frontend docs.

**Pages/components touched.** `tailwind.config.ts`, `index.css`, `eslint.config.js`, new `components/layout/page-container.tsx`, mechanical sweep across all 86 `max-w-6xl` sites.

**Dependencies.** None — this is the root.

**Deliverables.** Token reference table (documented values + measured contrast ratios); `PageContainer` with usage examples; green a11y lint baseline; CI running lint + typecheck + tests.

**Validation.** Automated contrast assertion over every token pair in the test suite (the table in F13 becomes a test). Playwright screenshots at 1280/1440/1920/2560 before-and-after. `eslint-plugin-jsx-a11y` passing at `warn`, with a documented path to `error`. Manual keyboard pass over top nav and chips.

---

### Phase 2 — The paved road: primitives, forms, and data layer

**Objective.** Make the correct way to build a screen the easy way. This phase produces the on-ramp F5 promised and never delivered.

**Scope**

- **Primitives on Radix**, styled with Phase 1 tokens: `Dialog` (replacing `Modal` — adds focus trap + restore, F13), `Tabs` (replacing `tabbed-hub`'s div/button bar and the scaffold's third variant), `DropdownMenu` (replacing the three `role="menu"` hand-rolls), `Tooltip`, `Checkbox`, `RadioGroup`, `Select`.
- **New primitives:** `Textarea` (F6 — currently 3 local class constants), `Toast`, `Pagination`, `ErrorBoundary` (F12), `EmptyState` with an `action` slot (F11).
- **Fix `Field`** (F4): `useId`-based label association, `aria-required`, `aria-invalid`, `aria-describedby` wiring. One component, 569 sites fixed.
- **`<Form>` on React Hook Form + Zod**, with a `packages/shared` schema package shared with the backend (F12, F16).
- **TanStack Query** replacing `useList`/`useResource`, with a compatibility shim so pages migrate incrementally (F8).
- **Delete or revive dead code:** `components/ui/card.tsx` (0 importers), `components/resource-list.tsx` (0 call sites). Recommend reviving `Card` as the single card surface and deleting `ResourceList`.
- **Consolidate duplicates** (F6): one `errMsg`, one `money`, one icon set, one table.
- **Fix the `errMsg` double-wrap defect** at all 16 sites (F12).
- **`<ListPage>` scaffold** — the composition of container + header + toolbar + `DataList` + states that every list screen currently rebuilds.

**Pages/components touched.** All of `components/ui/*`, `components/data-list.tsx`, `components/tabbed-hub.tsx`, `lib/use-resource.ts`, `lib/format.ts`, new `packages/shared`.

**Dependencies.** Phase 1 (tokens, container, test infra).

**Deliverables.** Storybook with every primitive, all states (default/hover/focus/disabled/loading/error), light + dark. A usage example and a short best-practices note per primitive. A **"Build a new screen" guide** that is verified by a test asserting the example compiles and renders.

**Validation.** jest-axe on every primitive story. Keyboard-only walkthrough of Dialog, Tabs, DropdownMenu, Select against the WAI-ARIA Authoring Practices. Contract tests for `Field` label association. Screen-reader spot-check (NVDA or VoiceOver) on one representative form.

---

### Phase 3 — Control Tower and the high-traffic core

**Objective.** Convert the app's most-used surfaces onto the paved road, starting with the iframe.

**Scope**

- **Rebuild the Control Tower in React** (F1). Port the KPI cards, drill-down modals, live-shipment list and world map into components fed by TanStack Query. Delete `features/dashboard-mock/*` (1,440 lines) and the `postMessage` bridge. This is the phase's largest item and its main risk — the visual design is genuinely good and must be preserved exactly.
- **Restructure the top-level navigation** (F9): surface all 16 areas on desktop via a proper menubar, keeping the overlay drawer for `< md` only.
- Migrate **Finance** (`hub.tsx`, `pages.tsx` — 2,877 lines) and **Operations** onto `ListPage`, `Form`, and Query; split the god files by screen (F7).
- Add the **skip link** and fix page `<h1>` structure in `PageHeader` (F13).

**Pages/components touched.** `features/dashboard.tsx`, `features/dashboard-mock/*` (deleted), `app/layout/app-shell.tsx`, `features/finance/*`, `features/operations/*`, `components/data-list.tsx`.

**Dependencies.** Phases 1–2.

**Deliverables.** Control Tower as ~10 tested components with no iframe. Desktop navigation reaching all 16 areas without an overlay. Finance and Operations decomposed to one screen per file.

**Validation.** Side-by-side visual diff of old iframe vs new Control Tower at four desktop widths (Playwright). Axe scan of the dashboard — previously impossible through the iframe boundary. Tenant white-label smoke test: change `--primary`, confirm the Control Tower re-tints (it cannot today). Query devtools review confirming request count drops from 9 to a cached set.

---

### Phase 4 — Breadth: the remaining 80 screens

**Objective.** Bring every remaining screen to the same standard, area by area.

**Scope.** In descending order of size and traffic: **Sales** (2,591 lines), **Settings** (`config-pages` 1,137 + `store-pages` 609 + `master-data-pages` 601), **Security** (1,061), **Vault** (1,052), **Commercial** (1,035), **Governance** (938), **Master data** (733 + 691), **HR** (12 screens), **WMS** (6), **Fleet** (7), **Procurement**, **Costing**, **Comms**, **AI Control**, **Portal**, **Workspace**, **Support**, **Help**, **God mode**.

Per screen, a fixed checklist:

1. `PageContainer` with a deliberate width variant.
2. Desktop-tier layout — real `xl:`/`2xl:` behaviour, not a frozen `sm:` grid.
3. All four states explicit: loading (`PageSkeleton`/`SkeletonTable`), empty (with action), error, success.
4. Forms on `Form` + shared Zod schema, with field-level errors.
5. Raw palette colours → semantic tokens (F14 — 122 sites).
6. Raw `<table>`/`<input>`/`<textarea>`/`<button>` → primitives.
7. Non-interactive `onClick` → real controls (F13 — 23 sites).
8. Axe clean.

**Pages/components touched.** All remaining `features/*`.

**Dependencies.** Phases 1–3. Independent per area, so this phase parallelises across engineers — the main reason for sequencing it after the road exists.

**Deliverables.** All 96 screens on shared primitives. God files decomposed. Zero raw-palette colours. Route-level `React.lazy` (F16).

**Validation.** Per-area a11y gate (axe, zero violations). Playwright desktop screenshots per screen at 1440 and 1920. A tracked checklist so partial completion is visible rather than assumed. Bundle-size report confirming the lazy-loading win.

---

### Phase 5 — Density, polish, and regression-proofing

**Objective.** Move from "correct and consistent" to "deliberately engineered" — and make it stay that way.

**Scope**

- **Information density** (F9): a compact table variant, user-selectable row density, sticky headers and frozen first columns for wide financial tables, column visibility controls.
- **Desktop-native interactions** the app currently lacks: multi-select with shift-click, bulk row actions, keyboard row navigation, inline edit where it fits, resizable split panes for master-detail screens.
- **Retire the draggable FAB** on desktop (F9) in favour of a fixed, non-overlapping entry point; keep it for touch.
- **Motion and reduced-motion** review across the now-consistent surfaces.
- **AAA where it pays** (F13): 7:1 for body text, status pills and money figures.
- **Regression-proofing:** `eslint-plugin-jsx-a11y` from `warn` to `error`; contrast assertions in CI; visual regression baselines; a "new screen" generator that scaffolds the checklist from Phase 4.
- Consolidate the six overlapping frontend docs into one maintained guide (F15).

**Pages/components touched.** `components/ui/table.tsx`, `data-list.tsx`, high-density screens (Finance, Operations, WMS, Security matrix), CI config, `doc/`.

**Dependencies.** Phase 4 — density work is only safe once every table uses the shared component.

**Deliverables.** Density system with usage guidance. Desktop interaction patterns documented. CI gates that fail on contrast, a11y and visual regressions. One canonical frontend guide.

**Validation.** Full WCAG 2.1 AA audit against the 96-screen inventory, with AAA noted where achieved. Operator usability session on the densest screens (Finance invoice list, Security permission matrix) at 1920px. CI proven to catch a deliberately introduced regression of each gated class.

---

## 4. Appendix — measured baseline

Metrics to re-measure at each phase gate.

| Metric                                                | Today                              | Target                               |
| ----------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| `xl:` / `2xl:` breakpoint uses                        | **0 / 0**                          | Desktop tiers on every layout screen |
| `mx-auto max-w-6xl` literals                          | **86**                             | 0 (via `PageContainer`)              |
| Distinct page container widths                        | 5, unruled                         | 3, named + documented                |
| `<Field>` sites with label association                | **0 / 569**                        | 569 / 569                            |
| `aria-invalid` / `aria-describedby` / `aria-required` | **0 / 0 / 0**                      | Wired in `Field`                     |
| Pages with an `<h1>`                                  | ~9 / 117                           | 117 / 117                            |
| Token contrast failures (measured)                    | **6**                              | 0                                    |
| Raw Tailwind palette colours                          | **122**                            | 0                                    |
| Distinct font sizes                                   | **19**                             | ~8 (scale)                           |
| `errMsg` implementations                              | **6**                              | 1                                    |
| `money` implementations                               | **5**                              | 1                                    |
| Card surface recipes                                  | **4+**                             | 1                                    |
| Dead primitives (0 importers)                         | `ui/card.tsx`, `resource-list.tsx` | 0                                    |
| Files > 400 lines                                     | **17**                             | 0                                    |
| Ad-hoc `Loading…` strings                             | **28**                             | 0                                    |
| Screens with no empty state                           | **11**                             | 0                                    |
| `onClick` on non-interactive elements                 | **23**                             | 0                                    |
| `role="menu"` without keyboard nav                    | **3**                              | 0                                    |
| Frontend tests                                        | **0**                              | Per-primitive + per-area             |
| Error boundaries                                      | **0**                              | App + per-route                      |
| Documented components that exist                      | **0 / 2**                          | 2 / 2                                |

---

## 5. Open questions for review

Answers change Phase 1 scope, so these are worth settling before implementation starts.

1. **Minimum supported desktop width** — is 1280px the floor, or must 1024px laptops be first-class? Determines whether `lg:` or `xl:` is the primary desktop tier.
2. **Brand colour latitude** — `--primary` orange fails AA as text at 2.59:1. May the _text_ usage be darkened (keeping fills and the brand mark exactly as-is), or is the hex immovable? There is a clean solution either way, but it changes the token structure.
3. **Control Tower fidelity** — should the React rebuild be pixel-identical to the current mock, or is Phase 3 the moment to revisit its desktop layout (which is frozen above 1180px)?
4. **`platform-console/`** — in or out of the design system? It currently shares nothing with the tenant app.
5. **Density defaults** — should tables default to compact for operators, with comfortable as an opt-in? Affects Phase 5 scope and the Phase 1 spacing scale.

---

**Status: Phase 0 complete. Awaiting review and approval before any implementation.**

---

# Addendum — full per-screen read (2026-08-04, same day)

The findings above were produced from ~15 files read in full plus tree-wide
measurement. That is sound for counts and contrast, but it is not the
exhaustive per-screen review the brief asked for. Every remaining feature file
has now been read. **Four conclusions changed. Nothing above is retracted, but
two findings were materially wrong in emphasis.**

## A1 — CORRECTION: the codebase is bimodal, not uniformly inconsistent

This is the most important correction in the audit, because it changes the
remediation cost by roughly an order of magnitude.

There are **two parallel frontend architectures**, and they split cleanly:

**Branch A — canonical (46 files).** Built on `lib/use-resource` + `Pill`
(tokens) + `DataList` + `Modal`/`Field`. Covers **all of HR (12), WMS (7),
Fleet (7), Procurement, Governance, Security, Masterdata, Costing, AI Control,
Comms, Godmode, Support, Workspace**, and the Finance sub-pages
(`receivables`, `debt`, `chart-of-accounts`, `hub`).

**Branch B — shadow (11 files).** Built on `features/sales/ui.tsx`. Covers
**Sales, Commercial, Vault pages, Settings (×3), Portal pages,
`finance/pages.tsx`, and `dashboard.tsx`**.

`features/operations/pages.tsx` imports from **both** — it is the seam.

Branch A is genuinely good work: purpose-built workstations (payroll run,
recruitment kanban, vehicle 360, inventory ledger, contract lifecycle) rather
than CRUD tables, with consistent states and token-based status. `Pill` is
imported by **45** files; the raw-hex `Badge` by **4**. The token system won.
The shadow branch is a minority holdout.

**Implication:** the remediation is not "rewrite the frontend." It is
"finish migrating 11 files off `features/sales/ui.tsx` and delete it."

## A2 — NEW (Critical): `features/sales/ui.tsx` is a shadow design system

332 lines in a _feature folder_, imported by **10 other feature areas**
(`finance/pages`, `vault/pages`, `commercial/pages`, `settings/store-pages`,
`settings/catalogue-page`, `settings/config-pages`, `operations/pages`,
`dashboard`, `portal/pages`, `sales/pages`). It ships competing copies of the
app's core abstractions:

| Export                                                       | Conflicts with                   | Nature of conflict                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useList(path, nonce, enabled)`                              | `lib/use-resource.useList(path)` | **Incompatible signature.** Two data hooks, no `loading` flag on this one.                                                                          |
| `errMsg`                                                     | `lib/use-resource.errMsg`        | Duplicate #2 of 6                                                                                                                                   |
| `fmtMoney`                                                   | `lib/format.money`               | Different locale + currency defaults                                                                                                                |
| `Badge`                                                      | `ui/pill.Pill`                   | **A complete parallel status system** — a 27-entry hardcoded raw-Tailwind map (`bg-sky-500/10 text-sky-600 dark:text-sky-400`, …) at `ui.tsx:63-90` |
| `Segmented`, `Chips`, `Avatar`, `MetricTile`, `SearchSelect` | —                                | Only implementations, but wrongly located                                                                                                           |

`Badge`'s colour map is **the single largest source of the 122 raw-palette
violations in F14** — it is not scatter, it is one table. Deleting this file
resolves, in one move: the second data hook, the second error helper, the
second money formatter, the second status system, most raw-colour violations,
and all cross-feature coupling (F7).

`features/settings/config-pages.tsx:23-45` inlines a **fourth** copy of the
same mini-library (`errMsg`, `cell`, `fmtDate`, `useList`) while _also_
importing `SearchSelect` from the shadow lib.

## A3 — NEW (High): local re-implementations found only by reading

grep found the duplication counts; reading found what they are.

| Component     | Copies | Locations                                                                                                                                                   |
| ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Segmented`   | **4**  | `components/settings/controls.tsx:121` (exported, unused), `features/sales/ui.tsx:98`, `features/governance/pages.tsx:27`, `features/security/pages.tsx:93` |
| `Panel`       | **5**  | `workspace-page.tsx:29`, `vault/hub.tsx:44`, `security/hub.tsx:52`, `portal-app.tsx:233`, + `finance/hub.tsx` (`AgeingPanel`/`CashPanel`)                   |
| `Stat`        | **3**  | `master/pages.tsx:234`, `operations/pages.tsx:188`, `fleet/fuel.tsx:21`                                                                                     |
| `FormButtons` | **3**  | `operations/pages.tsx:56`, `procurement/pages.tsx:36`, `masterdata/pages.tsx:25`                                                                            |
| Table impl    | **4**  | `ui/table.tsx`, `ui/workflow.tsx:888` (`LineTable`), `fleet/vehicle.tsx:40` (`MiniTable` + local `Th`/`Td`), 12 raw `<table>`                               |

`features/security/pages.tsx:92` carries the comment _"Small local segmented
control (sales/ui.tsx's is scoped to that feature)"_ — the duplication is
known and was accepted rather than resolved, because there was no shared home
to put it in (F5 again).

## A4 — NEW (High): raw JSON shown to end users

Three screens dump unformatted JSON into the UI when a payload does not match
an expected shape:

- `features/vault/pages.tsx:61` — `<pre>{JSON.stringify(data, null, 2)}</pre>`
  is the **fallback renderer for every catalogue report**. A report returning
  a non-array shape shows the customer raw JSON.
- `features/portal/pages.tsx:200` — same, on the **external client portal**.
  This is the surface a tenant's own customers see.
- `features/governance/pages.tsx:118` — audit-ledger values.

`vault/pages.tsx:32-60` also infers report table columns via `Object.keys()`,
so column headers are raw database field names (`total_ttc`, `client_id`).

## A5 — Credit where it is due

Reading changed my view of the engineering, and the audit above was unfair on
this point by omission.

- **Branch A screens are well-designed products**, not scaffolds. `hr/payroll.tsx`
  models a real segregation-of-duties ladder (OPEN → Compute → Submit → Approve →
  Validate/post-GL → Disburse) with the Cameroon statutory breakdown. `wms/inventory.tsx`
  is a proper stock ledger with an append-only movement journal.
- **`features/security/permission-matrix-page.tsx:1-35`** is the best file in the
  codebase. Its header documents why the matrix was transposed (density: 70 modules ×
  5 letter-buttons = 350+ hit targets), why the popover is `fixed` not `absolute`
  (sticky columns in a scroll container would clip it), and **two features
  deliberately not built** because they would imply grants that don't exist. That is
  senior-level design reasoning.
- **Comment quality throughout is unusually high** — `dashboard.tsx:60-78` documents
  three specific defects it fixed and why each was wrong; `app.tsx:56-68` explains an
  auth-boundary routing decision rather than trusting route-ranking. Most codebases at
  this stage have no such record.

The problem here is **not** engineering judgment. It is that good judgment was
applied without a shared foundation to apply it to — so it produced 24 locally
sound solutions to the same problems (F5).

## A6 — Revised remediation impact

Phase 2 gains one high-leverage, well-bounded task that should run first:

> **Delete `features/sales/ui.tsx`.** Migrate its 11 consumers to `lib/use-resource`,
> `Pill`, `lib/format`, and relocate `SearchSelect`/`Chips`/`Avatar`/`MetricTile`
> into `components/ui/`. Resolves A2 entirely and the bulk of F6, F14 and the
> cross-feature coupling in F7.

Estimated at 3–5 days, and it converts the codebase from two architectures to one
before any other refactor is attempted.

**Coverage statement:** every file under `client/src/features/` and
`client/src/components/` has now been read. `platform-console/` remains out of scope.

---

# Addendum 2 — Aesthetics (the section the first pass avoided)

The original audit said the blockers were "specific rather than aesthetic."
That was a hedge, and it was the wrong call. Aesthetics is not a softer
category than accessibility — it is the one a buyer judges **first**, in the
first fifteen seconds of a demo, before anyone opens a VPAT or asks about test
coverage. It deserved a finding of its own. Here it is.

## F17 — The visual language is a well-executed template, and it reads as one

**Severity: High (commercially: Critical) · Structural, but the cheapest fix in this audit**

### The core diagnosis

`index.css:6-12` and `doc/LOVABLE_FIDELITY_PLAN.md` name the source honestly:
the look is the **"Lovable Control Tower"** mock, ported. That provenance is
legible in the output, and it is the whole problem. AI app-builders (Lovable,
v0, bolt) share a recognisable house style, and this codebase implements it
faithfully:

| Trait                          | Where                                                        | What it signals       |
| ------------------------------ | ------------------------------------------------------------ | --------------------- |
| Full-page gradient mesh        | `index.css:154-166` — fixed, `blur(30px)`, opacity 0.5/0.7   | Marketing page        |
| Glassmorphic bars              | `.lux-topbar`, `.lux-botnav` — `blur(20px) saturate(150%)`   | 2020–21 Big Sur trend |
| Large radii                    | `--radius: 0.9rem` = **14.4px** cards                        | Consumer app          |
| Coloured glow shadows          | `.btn-primary` — `0 8px 20px color-mix(--primary 35%)`       | Dribbble shot         |
| Hover lift micro-interactions  | `translateY(-1px)` on chips/buttons ×5, `hover:scale-105` ×3 | Landing page          |
| Display serif + geometric sans | Playfair Display + Montserrat                                | Boutique / editorial  |
| 500ms entrance animation       | `.animate-fade-up` on every card and table                   | Portfolio site        |

Individually each is defensible. Together they are a **coherent aesthetic
aimed at the wrong category.** Every one of these choices optimises for _how
the product photographs_ rather than _how it feels on the 300th use_. That is
exactly the trade a system of record must not make.

### The typography is the single worst call

`--font-display: "Playfair Display"` is a **high-contrast Didone** — an
editorial and fashion display face. It is applied at 35 sites: every page
`<h1>`, every modal title, every card `<h3>`… **and on money figures.**

```
client/src/features/finance/hub.tsx:232-233
  <div className="num font-display text-lg">{money(t?.debit)}</div>   // Total débit
  <div className="num font-display text-lg">{money(t?.credit)}</div>  // Total crédit
```

Setting a trial-balance total in a Didone serif is not a stylistic preference
I disagree with — it is wrong for the job. Didone hairlines break up at small
sizes, and the face carries luxury/editorial connotations. An audited ledger
figure should read as _precise_, not _elegant_.

Compounding it: **Playfair Display + Montserrat is arguably the most-used
Google Fonts pairing on the internet** — the default Canva/Squarespace/
wedding-invitation combination. To anyone who evaluates interfaces for a
living, it is an instant tell.

What the benchmark actually ships:

| Product              | UI typeface          |
| -------------------- | -------------------- |
| Palantir (Blueprint) | Inter                |
| Microsoft (Fluent)   | Segoe UI             |
| Google (Material 3)  | Roboto / Google Sans |
| Stripe Dashboard     | Söhne (custom)       |
| Linear               | Inter Display        |
| Vercel               | Geist                |

**Not one serious enterprise data product uses a display serif for UI.** There
is no counter-example to point at.

### Density: you are showing 40% less data than the category standard

`ui/table.tsx:755` sets `TD` to `px-4 py-3.5` — 14px top + 14px bottom against
a 13px/18px line, giving **~46px rows**. Palantir-, Bloomberg- and
Retool-class grids run **28–32px**.

For a logistics operator scanning 200 open shipments, that is the difference
between one screen and three. Density is not austerity in this category — it
is the product. And there is no compact variant to switch to (F9).

Meanwhile the _labels_ are too small in the other direction: `TH` at **9.5px**
and `.micro` at **10px**, both uppercase with 0.14–0.19em tracking. Heavy
tracking on tiny uppercase is an editorial device; here it costs legibility
and drives the contrast failures measured in F13. The type is simultaneously
too large where data lives and too small where labels live.

### Motion is tuned for a portfolio, not a workstation

`.animate-fade-up` — `translateY(12px) → 0` over **0.5s** — fires on every
card, table and view mount (`ui/table.tsx:728`, `data-list.tsx:116`). A
dispatcher who opens the shipments table forty times a day waits half a second,
forty times, for a decoration.

Linear's entire brand proposition is sub-100ms response. The enterprise
convention is 120–180ms for entrances, or none at all. 500ms reads as slow
software even when the data arrived instantly — it actively disguises good
backend performance as bad.

### Colour: a semantic collision and a dated dark mode

- **Orange as primary is a semantic conflict.** `--primary` is `#F5821F`;
  `--warn` is amber `rgb(176 128 24)`. The colour that means "confirm this
  action" and the colour that means "something is wrong" sit ~30° apart on the
  wheel. In a ledger application that is a genuine comprehension risk, not a
  taste question. It is also unusable as text at **2.59:1** (F13).
- **Dark mode is navy, not neutral.** `--background: rgb(7 19 36)` is a
  strongly blue-tinted dark. The category standard is near-neutral
  (Linear `#08090a`, Vercel `#000`, Palantir near-black). Navy darks read
  "crypto dashboard / gamer" rather than "instrument."
- **The mesh gradient sits behind every data screen**, lowering effective
  contrast everywhere — measurably so: `.micro` is 3.01:1 on `--card` but
  **2.78:1** on the meshed `--background`. Stripe uses mesh gradients on
  marketing pages and never behind a table.

### NEW — the PWA loses its typography offline

`index.html:19-24` loads both families from `fonts.googleapis.com`.
`vite.config.ts:36` globs `**/*.{js,css,html,svg,woff2}` — **local** assets
only — and there is no `runtimeCaching` rule for the font CDN.

So the offline mode this product advertises (logistics, ports, thin
connectivity) falls back to **Georgia + system sans**. Offline, the app is
visually a different product. It also blocks first render on a third-party
request, and pulls **11 weights** (4 Playfair + 7 Montserrat) when far fewer
are used.

### What is genuinely good — and it is not nothing

The _information design_ instincts here are better than the styling, which is
the far better problem to have:

- **Token architecture is properly semantic** and tenant-overridable at
  runtime. Most teams never get this right.
- **`.num` tabular figures on all money** (`index.css:175`) — correct,
  and frequently missed even by good teams.
- **Enum humanisation** — `POSTED_LOCKED` → "Posted locked" (`ui/pill.tsx:605`).
  Real polish; the reference mock did not do this.
- **The status-pill system** (dot + tinted ground) is clean and scales.
- **Light and dark are both genuinely designed**, not a filter.
- **The Control Tower's information design** — KPI band, live shipments with
  progress, route map, drill-downs — is a legitimately good dashboard concept.
  It is housed badly (F1); the thinking is sound.
- **The permission matrix** (`security/permission-matrix-page.tsx`) is the best
  _design_ work in the repo, not just the best code.

### Honest verdict

Against Palantir / Microsoft / Google / Oracle: **the aesthetics would not
stand.** Not because they are ugly — they are attractive — but because they are
_generic and mis-categorised_. It looks like a beautiful template, and
enterprise buyers have been trained by a decade of SaaS to distrust exactly
that surface. The gap is not craft; it is that the whole visual system points
at "premium consumer app" when the product is an instrument.

### The remedy is a token pass — the cheapest item in this audit

Nothing here requires re-architecture. Every change is confined to
`index.css`, `tailwind.config.ts`, `index.html` and `ui/table.tsx`:

| Change          | From                               | To                                                    |
| --------------- | ---------------------------------- | ----------------------------------------------------- |
| Display face    | Playfair Display                   | Inter Display / Geist — **self-hosted**               |
| Body face       | Montserrat (7 weights, CDN)        | Inter — self-hosted, 3–4 weights                      |
| Card radius     | 14.4px                             | 8px (controls 6px)                                    |
| Button shadow   | Coloured glow                      | 1px border + near-flat                                |
| Hover lift      | `translateY(-1px)` / `scale(1.05)` | Background/border state change                        |
| Top bar         | `blur(20px) saturate(150%)`        | Solid, 1px bottom border                              |
| Page background | Fixed mesh gradient                | Flat surface token                                    |
| Entrance motion | 500ms fade-up                      | 120ms opacity, or none                                |
| Table row       | ~46px                              | 32px default, 28px compact                            |
| Label type      | 9.5–10px, 0.19em tracking          | 11–12px, ~0.02em                                      |
| Dark base       | `rgb(7 19 36)` navy                | Near-neutral `rgb(10 11 13)`-class                    |
| Primary accent  | Orange (collides with `--warn`)    | Blue-family primary; retain orange as brand mark only |

**Estimated 1–2 weeks**, and it moves perceived tier further than any other
item on the five-phase roadmap. It should run **inside Phase 1**, alongside the
contrast retune it partly resolves anyway — the two touch the same tokens.

One caveat worth stating plainly: the orange is presumably a brand asset, and
demoting it from UI primary to brand-mark-only is a business decision, not an
engineering one. That is question 2 in §5, and it needs an owner's answer.

---

# Addendum 3 — Phase 2 implementation notes (2026-08-04)

Written while implementing Phase 2, not during the audit. Everything here is a
**correction or addition to the findings above**, discovered by changing the
code rather than reading it. Recorded so the baseline table stays honest.

## Counts that were wrong — all in the same direction

grep undercounts duplication, because copies drift and stop matching each other.

| Item                           | Audit said         | Actual                       |
| ------------------------------ | ------------------ | ---------------------------- |
| `FormButtons` copies           | 3                  | **7**                        |
| `Panel` copies                 | 5                  | **6**                        |
| `Stat` copies                  | 3 (+ `MetricTile`) | **4**                        |
| `cell` copies                  | — (not counted)    | **4**                        |
| Inlined shadow `useList`       | 1 (config-pages)   | **4**                        |
| Local textarea class constants | 3                  | **6 distinct class strings** |
| `<Field>` render sites         | 569                | **565**                      |

None of these changes a conclusion. F6's point — "the same UI reimplemented
instead of shared" — was if anything understated.

## A correctness defect F8 describes as a performance problem

F8 says the hubs do "unpaginated fetch-everything-then-filter". That is not what
happens, and what does happen is worse.

The API's shared pagination helper (`src/shared/db/query-helpers.js:47`)
**defaults to `limit 50`**, capped at 200. A screen calling `/final-invoices`
with no query parameters gets the fifty most recent invoices — not all of them —
and then filters those client-side (`features/finance/hub.tsx:257`, `hit()`).

So on any tenant with more than fifty invoices, **the Finance hub's search box
cannot find an older one, and reports nothing wrong.** It shows "No invoices
match" for a record that exists. The same shape applies to `/operations`,
`/receivables` and `/journal-entries` on that hub.

The endpoint already supports `?q=` (ILIKE on `doc_number`), `?status=` and
`?client_id=`, so the fix is server-side filtering plus `?limit=&offset=`, not
new API work. Phase 2 ships the `<Pagination>` primitive and documents the rule;
wiring the hubs is Phase 3 screen work and should be treated as a **correctness**
item there, not a performance one.

## Where a library disagreed with an assumption

Two behaviours worth recording because the obvious expectation is wrong:

- **Radix names a `DropdownMenu` from its TRIGGER**, via `aria-labelledby`,
  which beats any `aria-label` passed to the content. That is the correct
  WAI-ARIA menu-button pattern. An unnamed menu is a symptom of an unnamed
  trigger — label the button, not the menu.
- **`new Date("2026-02-31")` does not return `NaN`.** JavaScript rolls it over
  to 3 March and reports success, so the obvious `!Number.isNaN(...)` date
  refinement accepts every impossible date in the calendar. On an `entry_date`
  that means a journal entry posting silently to the wrong period. The shared
  schema round-trips the parse instead.

## Scope explicitly NOT taken in Phase 2

Stated so the next phase does not assume it is done:

- **The nine requests on the Finance hub still fire on a cold load.** Query makes
  them cached, shared and deduplicated across screens and revisits; it does not
  paginate them. See above.
- **`features/dashboard.tsx` is untouched** — the iframe (F1) is Phase 3.
- **Raw palette colours: 122 → 56.** The `Badge` map was the single largest
  source and is gone; the remainder is genuine scatter across feature screens
  and belongs to the per-area sweep in Phase 4.
- **`useList`/`useResource` remain in use at 161 sites.** They are now shims over
  TanStack Query rather than hand-rolled effects, which was the point — but no
  screen has been migrated to `useQuery` directly, and none needs to be yet.
- **Only one domain's schemas live in `packages/shared`** (final invoice). The
  package, the wiring and the pattern are real and the backend consumes them;
  moving the rest is per-module work.

---

# Addendum 4 — Production incident: the blank page, and the chunking fix (2026-08-04)

Written after Phases 1 and 2 were merged and deployed. The deploy served a **fully
blank page** on `smartls.praxisls.com`, which is what stopped Phase 3 from
starting. This records what happened, because the cause was not in any of the
work the audit describes — and the fix pulled one Phase 4 deliverable forward.

## What the user saw

An empty `<div id="root">`. No error UI, no fallback, no partial render. One
console line:

```
vendor-BC54ZJUQ.js:18  Uncaught TypeError: Cannot read properties of undefined (reading 'createContext')
```

The `304`s in the network tab were a red herring — `index.html` is served by
`res.sendFile` at `max-age=0` (`src/server.js:191`) and was correctly revalidated
and fresh, pointing at the current chunk hashes. Nothing was stale. The bundle
that arrived was the right bundle; it simply could not evaluate.

## Cause: a circular chunk graph, hand-drawn in `vite.config.ts`

`manualChunks` sorted `node_modules` into two buckets — `vendor-react` (react,
react-dom, react-router) and `vendor` (everything else). But **react-dom needs
`scheduler`**, and **react-router-dom needs `@remix-run/router`**, and neither
package name matched the react rule. Both stayed in `vendor`:

```
vendor  ──── needs react ────▶  vendor-react
vendor  ◀── needs scheduler ──  vendor-react
```

The browser began evaluating `vendor-react`, which re-entered `vendor` before
React's export binding had been assigned. Rollup emits that binding as a hoisted
`var`, so it read `undefined` rather than throwing a TDZ error, and the first
top-level `React.createContext` call in `vendor` — TanStack Query's
`QueryClientContext` — died on it.

**Why no ErrorBoundary caught it:** the throw happens during _module evaluation_,
before `ReactDOM.createRoot(...).render(...)` is ever reached. The root boundary
added in Phase 2 (`main.tsx`) and the per-route one (`app-shell.tsx`) both need
React to be running to catch anything. Neither existed yet at that moment. This
is the one failure class those boundaries structurally cannot cover.

## Why it fired now, and not before

The cycle had been in the config for as long as `vendor-react` existed. It was
harmless while nothing in `vendor` touched React _at import time_ — the old
`vendor` held clsx, tailwind-merge, socket.io-client, topojson, world-atlas and
Inter, none of which do.

**Phase 2 added TanStack Query, seven Radix packages and React Hook Form. All of
them call `createContext` at module scope.** The Phase 2 work did not introduce
the defect; it was the first code to walk into it.

Worth stating plainly: **the build was not silent.** Rollup printed

```
Circular chunk: vendor -> vendor-react -> vendor. Please adjust the manual chunk logic for these chunks.
```

as the _first line_ of the build log, plus three more for the `feature-*` buckets
(`settings → hr → wms → fleet → settings`), and exited 0. CI ran `npm run build`
and went green. A warning nobody reads is not a gate.

## The fix

**1. One manual bucket, and only one.** All of `node_modules` goes to `vendor`.
A single bucket cannot import itself, so it is acyclic by construction. Splitting
node_modules further requires proving no edge runs backwards against a lockfile
that moves — which is not a property anyone can maintain by hand.

**2. App code is no longer partitioned by hand at all.** The `feature-*` and
`dashboard-mock` buckets are gone. `app/app.tsx` now loads every screen through
`React.lazy`, and Rollup derives one chunk per route from the real graph. This is
**F16's "Route-level `React.lazy`", listed as a Phase 4 deliverable** — pulled
forward, because it is the mechanism that makes the hand-drawn buckets
unnecessary rather than merely fixed. Adding a feature area now needs no build
config change at all.

`ROUTE_LOCAL_VENDOR` in `vite.config.ts` is the escape hatch for a heavy library
that belongs with one route rather than in the first-load payload — it currently
holds `world-atlas` (~500 kB of Natural Earth geometry, read only by the Control
Tower map). Excluding a package is always safe; Rollup places it, and Rollup does
not create cycles. Adding a _bucket_ is what is forbidden.

**3. Two gates, both in CI.** `vite.config.ts` throws on Rollup's
`CIRCULAR_CHUNK` warning, and `client/scripts/check-bundle.mjs`
(`npm run check:bundle`) re-derives the graph from what was actually written to
`dist/` and fails on any cycle the bundler did not report. Both were verified by
reintroducing the original rule: the build now exits 1, and with the throw
disabled the artifact check catches it independently.

## Second defect found while verifying the first

`client/tsconfig.node.json` is `composite: true` with no `outDir`, so `tsc -b`
(the first half of `npm run build`) emitted **`vite.config.js` next to
`vite.config.ts`** — and Vite resolves `vite.config.js` _first_. Every subsequent
`npm run dev` or bare `vite build` silently used the last compiled snapshot, so
edits to `vite.config.ts` became no-ops. This was caught the hard way: a
deliberately reintroduced cycle "passed" the build because Vite was reading a
config from ten minutes earlier.

The root `.gitignore` already documents this trap and blocks both files from
being committed — but ignoring an artifact does not stop it shadowing the source
locally. `tsconfig.node.json` now emits to `node_modules/.tmp/` instead.

## Measured effect

|                                               | Before                                            | After                             |
| --------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| First load (login screen), gzip               | **423 kB** — all 17 chunks were `modulepreload`ed | **154 kB** — entry + vendor only  |
| First load, raw                               | 1,483 kB                                          | 484 kB                            |
| Entry chunk                                   | 295 kB                                            | 112 kB                            |
| JS chunks emitted                             | 17                                                | 67 (one per route)                |
| Circular chunk warnings                       | **6**                                             | 0, and now fatal                  |
| Control Tower + world map on the login screen | yes                                               | no — lazy, arrives with the route |

Verified in headless Chromium against the built `dist/`: `/`, `/login` and
`/reset-password` all render with zero page errors, and the lazy route fetches
its own chunk on navigation. The pre-fix build reproduced the exact production
failure (`#root` empty, identical `createContext` throw, identical
`vendor-BC54ZJUQ.js` hash), which is how the diagnosis was confirmed rather than
inferred.

## What this means for Phase 3

- **No build-config work is needed for the Control Tower rebuild.** `dashboard`
  is already its own lazy chunk (197 kB, the largest route). Deleting
  `features/dashboard-mock/*` shrinks it automatically.
- **Route-level lazy loading is done**, so Phase 4's bundle deliverable is
  already met and its "Bundle-size report confirming the lazy-loading win" can be
  read off the table above.
- **The `<Suspense>` boundary lives next to `<Outlet />`** in `app-shell.tsx`,
  inside the per-route `ErrorBoundary`. A new screen inherits both; it does not
  add its own.
- **`BrowserRouter` now runs with `v7_startTransition`** (`main.tsx`) so
  navigation keeps the current screen painted while the next chunk arrives,
  rather than flashing a skeleton on every route change.

## One item still open, unrelated to this incident

The `zod` alias (`vite.config.ts`) points at `../node_modules/zod`, the repo-root
copy, so the client and `packages/shared` share one Zod instance. CI installs
root dependencies for the client job to satisfy it (`ci.yaml`), but the
Dockerfile's `clientbuild` stage does **not** — `.dockerignore` excludes
`**/node_modules` and that stage runs only `npm install --prefix client`.

It builds today purely because nothing routed imports `@/components/ui/form` or
`@/lib/use-zod-form`, so the whole Zod layer is tree-shaken out (zero `zod`
references in the emitted bundle). **The first screen that actually uses
`useZodForm` will break the image build** — which, given Phase 4 puts every form
on `<Form>` + a shared schema, is a Phase 3/4 prerequisite, not a someday item.

---

# Addendum 5 — `packages/shared` was never actually buildable (2026-08-04)

Addendum 4 closed with one open item: the `zod` alias pointed at the repo-root
copy, which the Docker `clientbuild` stage does not have, so "the first screen
that actually uses `useZodForm` will break the image build."

That was right about the consequence and **wrong about the cause being one
thing**. Closing it properly meant pulling the package into a build for the
first time, and it failed three separate ways before it worked. Recording all of
them, because the pattern matters more than the bugs.

## The pattern: the only path that exercised it was the only one that couldn't see the problem

`packages/shared` shipped with 10 passing tests and was consumed by the backend
in production. It was also **completely unbuildable by the client**, and had been
since the day it was written — because no routed screen imports the form layer,
so every `vite build` tree-shook the package away and never compiled it.

Vitest loads that CommonJS through **Node**. `vite build` loads it through
**Rollup**. Those two disagree, and only the forgiving one ever ran.

## The three defects

**1. No CommonJS interop — breaks every environment, not just Docker.**
Vite applies CJS interop only to `build.commonjsOptions.include`, which defaults
to `[/node_modules/]`. `packages/shared` is _source_. Rollup therefore read
`module.exports = { common, finalInvoice }` as an ES module with no named
exports:

```
"finalInvoice" is not exported by "../packages/shared/index.js"
```

This had nothing to do with Docker or with Zod. CI would have failed on it too,
the moment any screen imported the package.

**2. The `zod` alias hardcoded the repo-root copy** — the Addendum 4 finding,
and real: `Could not load /app/node_modules/zod: ENOENT` in a client-only
install. Now resolved with a preference (root copy first — the instance the API
runs with; the client's own copy second) and a loud error if neither exists.

**3. `module.exports = { a, b }` is invisible to every bundler.** With 1 and 2
fixed, the build passed and **dev silently handed back `undefined`** — a form
with no validation, and a crash inside `zodResolver`. `cjs-module-lexer`, which
both esbuild and Rollup use to find a CommonJS module's named exports, cannot see
through the object-literal form. All three files now use `exports.name = name`,
which is identical to Node and therefore invisible to the API.

## And a fourth, found by measuring rather than assuming

With all three fixed, a probe in the browser reported:

```
{ instanceofZodType: false, hasSafeParse: true, resolverBuilt: true, resolverErrorKeys: 1 }
```

Validation worked — but **`instanceof z.ZodType` was false**, in the production
build _and_ in dev. One copy of Zod on disk is not one Zod instance: its
`exports` map has separate `import` (`./index.js`, ESM) and `require`
(`./index.cjs`, CJS) entries, so a directory alias hands client code the ESM
build and `packages/shared`'s `require("zod")` the CJS one.

That is precisely the failure the single-instance alias was written to prevent,
and it had been silently true all along — the invariant the design rests on was
only ever satisfied in Vitest, where Node gives both sides `./index.cjs`.

Pinning the ESM **entry file** for bundlers fixes it. The alias is now
tool-aware, because the two toolchains need opposite things: bundlers need the
file (or ESM and CJS split), Vitest needs the directory (or the ESM file splits
what Node had already unified). Both are asserted, not assumed.

## Also fixed, incidentally

- **`npm run dev` could not load `@shared` at all** — the dev server served its
  raw `require()` / `module.exports` to the browser. `commonjsOptions` is
  build-only. The package is now a declared `file:` dependency
  (`@praxis/shared`), so npm links it and `optimizeDeps.include` pre-bundles it.
  A Phase 3 blocker nobody had hit yet, because nobody had opened the file.
- **`vite.config.ts` and `vitest.config.ts` each carried their own copy of the
  alias block** and had drifted. Both now import `client/config/shared-alias.ts`.

## The gate

`npm run check:shared` (`client/scripts/check-shared.mjs`, wired into CI) builds
a probe entry against the **real** `vite.config.ts` and asserts the schemas
resolve, parse, and share one Zod instance. Verified to fail on a reintroduced
directory alias (`oneZodInstance: FAILED`) and on removed `commonjsOptions`
(`"common" is not exported by …`).

This is the piece that matters going into Phase 3: the package can no longer be
green in tests while broken in the build.

## Verified paths

| Path                                                   | Before                               | After                                              |
| ------------------------------------------------------ | ------------------------------------ | -------------------------------------------------- |
| `vite build`                                           | ✗ no named exports                   | ✓ one Zod instance (browser-verified)              |
| `vite dev`                                             | ✗ raw CommonJS served to the browser | ✓ one Zod instance (browser-verified)              |
| Docker `clientbuild` (clean tree, client-only install) | ✗ `ENOENT` on root zod               | ✓ build + both gates pass                          |
| `vitest`                                               | ✓ (the only path that worked)        | ✓ 184/184, up from 174 — `form.test.tsx` now loads |

The Docker path was checked by replaying the stage's exact commands against a
tree built to `.dockerignore`'s rules with no root `node_modules`, since the
sandbox has no Docker daemon. **No Dockerfile change was needed** in the end:
declaring `@praxis/shared` as a real dependency plus the zod fallback makes a
client-only install sufficient.

## One thing deliberately not changed

CI still runs `npm install` at the repo root for the client job. Vitest resolves
`packages/shared`'s `require("zod")` through **Node**, which walks up from
`packages/shared/` to the repo root and ignores Vite aliases entirely — so the
root copy is genuinely required for the test path. `deps.inline` was tried and
does not change it. A frontend-only contributor can build, lint and run the dev
server without a root install; running the full suite still needs one.

---

# Addendum 6 — Phase 3 implementation notes (2026-08-04)

Written while implementing Phase 3, not during the audit. As with Addendum 3,
everything here is a **correction or addition** to the findings above,
discovered by changing the code rather than by reading it.

Phase 3's three scope items are done: the Control Tower is React, desktop
navigation reaches all sixteen areas without an overlay, and Finance and
Operations are decomposed one screen per file. The `<h1>` and skip-link items
listed under Phase 3 were already delivered in Phase 1.

## The open questions in §5, answered by the work

**Q3 — Control Tower fidelity.** Pixel-identical was the wrong target, and the
question contains its own answer: the mock's desktop layout is _frozen above
1180px_, and the whole point of the phase is that the app has no desktop tier.
So: the **information design is preserved exactly** — KPI band, drill-downs,
live-shipment list with milestone progress, route map, launcher, briefing, in
the mock's order — and the **layout is rebuilt with real `xl`/`2xl` behaviour**.
Everything else about the mock's visual language was already superseded by Phase
1's token pass, which the frame could only track by being hand-patched twice.

**Q1 — minimum desktop width.** Answered in practice at 1280px: the top bar
seats four areas at `md`, five at `lg`, seven at `xl` and ten at `2xl`, so 1024px
laptops stay first-class without the 2560px case being designed for the 1024px
one.

## Defects found by rebuilding — all of them live in production

Reading the iframe found F1. Rebuilding it found five things the reading could
not, because each is a mismatch between two files that were never compared.

1. **The revenue KPI is badged "MTD" over an all-time figure.** The mock's
   markup hardcodes the badge; the live-data injection script rewrites the card's
   _value_ and _caption_ and never touches it. `revenue_final_ttc` is
   `SUM(total_ttc)` over every locked FINAL invoice with **no period predicate at
   all** (`dashboard.repo.js`). A month-to-date label on an all-time total, in the
   revenue tile of a finance product.
2. **The briefing has never mentioned unposted journals.** It read
   `kpis.unposted_journals`; the repo sends `unposted_journal_entries`. Not a key
   the payload has ever carried, so the clause was silently always absent.
3. **`current_milestone` was computed and never read.** The repo has returned the
   in-progress (or next pending) milestone label since the milestone engine
   landed. The live-shipment rows printed the vessel string instead. "Costing
   approval" is what an operator scanning that list wants; "MSC Lucia" is not.
4. **A failed drill-down said "All clear".** Any source that 403'd fell into the
   mock's empty state, so a user without the fleet grant was told the fleet was
   fine. In a finance context a reassuring answer to a question that was never
   asked is worse than an error. It now reports the permission message.
5. **The revenue drill-down did not reconcile with its own card.** The card sums
   every locked invoice in SQL; the drill summed one API page, which `page()`
   clamps. On a tenant past that clamp the two disagreed on screen — precisely the
   failure MOD-52 rewired the receivables card to avoid. The headline is now the
   authoritative figure, the ranking states its basis when it is a sample, and the
   sample is the API's 200-row ceiling rather than the 50-row default.

## A sixth, in Operations, of the shape Addendum 3 predicted

`/operations` had the Finance hub's defect one module over. The screen advertised
_"Search by ref, client, BL/MAWB, vessel…"_; the endpoint matched `ref` only and
reported no total, so the screen filtered the fifty most recent dossiers in the
browser and answered **"No operation files yet"** for a file that exists.

Fixed at the source: `listPaged` adds the `COUNT(*) OVER()` total, `q` covers all
four advertised fields on one placeholder, and the status/service filters are
qualified now that two tables are joined. `list()` still returns a bare array for
the callers that want one.

Two consequences worth stating:

- **The chip counts are real.** Each is a one-row request read for its
  `X-Total-Count`, so a chip says how many dossiers match across the tenant, not
  how many happen to be on the loaded page. Four small cached requests where
  there was previously one number that was wrong.
- **The service-FAMILY chips are gone, deliberately.** They bucketed rows by
  substring-matching `service_key` against four hardcoded families and filed
  anything else under "OTHER" — a guess that could only ever be made over the rows
  already loaded. A service-type select is exact, server-side, and reflects the
  types the tenant actually configured.

## What the iframe cost, measured

|                               | Before                                                           | After                                           |
| ----------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Control Tower route chunk     | **196.70 kB** raw / 59.07 kB gzip                                | **31.71 kB** / 11.25 kB                         |
| Natural Earth land + topojson | in that chunk, blocking first paint                              | own chunks (55.3 + 6.9 kB), fetched after paint |
| Requests on a cold load       | 7                                                                | **3**                                           |
| Lines of source               | 1,196 (`dashboard.tsx`) + 1,440 (`dashboard-mock/*`) = **2,636** | **1,985** across 14 files                       |
| Frontend tests covering it    | **0**                                                            | 76                                              |
| Axe scan                      | impossible — axe cannot cross an iframe boundary                 | clean                                           |

The request drop is the drill-down sources. `/final-invoices`, `/clients`,
`/operations` and `/vehicles` were fetched on _every_ mount to pre-build four
modals that are usually never opened; they now load on demand and are then shared
from the Query cache with the Finance hub, Operations and Fleet.

## Verified in a browser, not inferred

Headless Chromium against a built page, at 1280 / 1440 / 1920 / 2560, light and
dark:

| Viewport | Content column | Tower grid | KPI band | Launcher | `<h1>` | Horizontal scroll |
| -------- | -------------- | ---------- | -------- | -------- | ------ | ----------------- |
| 1280     | 1232px         | 2 col      | 4        | 6        | 1      | none              |
| 1440     | 1392px         | 2 col      | 4        | 6        | 1      | none              |
| 1920     | 1664px         | 2 col      | 4        | 6        | 1      | none              |
| 2560     | 1664px         | 2 col      | 4        | 6        | 1      | none              |

Zero page errors at any width. Two layout faults were found this way and only
this way — both invisible until the two cards sit side by side and the taller one
drives the row height:

- the shipments list's fixed `max-h` sliced its sixth row against a taller map;
- the map's ocean was an SVG `<rect>` on a fixed aspect ratio, so a stretched
  card showed a waterline with bare card beneath it.

## The white-label smoke test found a seventh defect

Phase 3's validation asks: _change `--primary`, confirm the Control Tower
re-tints (it cannot today)_. Run against a teal tenant, mimicking exactly what
`lib/theme.ts` `applyBrand()` writes at runtime:

|                             | default tenant          | teal tenant             |
| --------------------------- | ----------------------- | ----------------------- |
| map road-corridor stroke    | `rgb(245 130 31)`       | `rgb(13 148 136)`       |
| map destination node        | `rgb(245 130 31)`       | `rgb(13 148 136)`       |
| shipment reference          | `rgb(190 86 14)`        | `rgb(13 148 136)`       |
| hero primary CTA            | `rgb(245 130 31)`       | `rgb(13 148 136)`       |
| accent status pill — text   | `rgb(190 86 14)`        | `rgb(190 86 14)` ✗      |
| accent status pill — ground | `rgb(245 130 31 / .14)` | `rgb(13 148 136 / .14)` |

The last two rows are the finding, and it is **app-wide, not a Control Tower
issue**. `.st-orange` took its GROUND from `--brand-orange`, which `applyBrand`
does set from `brand.primary` — and its TEXT from `--brand-orange-ink`, which
`applyBrand` never sets. Every non-orange tenant has therefore been rendering
that pill as a tenant-tinted ground with SmartLS brown-orange text on it: the
wrong brand, and a contrast pair nobody had measured because neither half was
chosen against the other.

`.st-orange` now takes its text from `--primary-ink`, which is byte-identical for
the default tenant (both are `rgb(190 86 14)` light / `rgb(250 158 78)` dark) and
is DERIVED to clear 4.5:1 against the surface by `toAccessibleInk` for every
other one. Zero visual change for SmartLS; correct for everyone else.

Worth noting how this surfaced: not by reading `index.css`, where the rule looks
entirely reasonable, but by rendering the page under a second tenant. The
white-label promise is only testable by exercising it.

**An observation for Phase 5, not a defect:** `max-w-wide` is 1664px, so a 2560px
display renders the same column as a 1920px one with ~900px of margin. Phase 1
chose that value deliberately ("so a 1920px display is actually used") and this
phase did not second-guess it — but the 2560px case the audit opens with is now
_addressed_ rather than _solved_, and a genuinely fluid upper tier is a token
decision that belongs with the density work.

## Files over 400 lines: 18 → 15

Measured as `.tsx` under `client/src`, excluding tests and stories. §4's baseline
table says 17; that measure is not reproducible from the tree, so this is the
count re-derived at the pre-Phase-3 commit and at HEAD — the delta is −3 on any
of the three obvious variants (`.tsx` only, `.tsx`+`.ts`, either including tests).

The three removed are the three largest the audit named:
`finance/pages.tsx` (2,581), `dashboard.tsx` (1,196), `operations/pages.tsx`
(928). Finance became twelve files, Operations eight, none over 400.

`report-view.tsx` is the split that matters beyond tidiness: the report viewer
and its tabbed shell are mounted by **both** Statements and the Tax centre, and
were private to a module neither could import from.

`app-shell.tsx` went 924 → 702. Its twenty-six inline icons (F6's "three icon
systems") moved to `nav-icons.tsx` and its nav table to `nav-model.ts` — where a
test can now assert the F9 claim directly: _every one of the sixteen areas is
reachable on desktop without opening an overlay_. That is the test that fails if
someone adds a seventeenth area and does not notice it exists only behind a
scrim. Merging the two icon sets is Phase 4's sweep; this is its precondition.

## Two small structural fixes taken while adjacent

- **`ListPage` gained a `tabs` slot.** F7 names `tabbed-hub`'s
  publish-on-context / draw-in-each-page arrangement as the one genuine
  anti-pattern in the component architecture — whether a hub's tabs appear
  depends on a convention no type signature enforces. A named slot at least makes
  the position part of the scaffold rather than of each screen's layout.
- **The command palette is reachable through context.** The Control Tower used to
  open it by dispatching a synthetic `⌘K` `KeyboardEvent` at `document`, which the
  old code itself flagged as wanting exactly this fix if anything else ever needed
  it. Something did.

## Scope explicitly NOT taken in Phase 3

Stated so Phase 4 does not assume it is done.

- **Finance and Operations forms are not on `<Form>` + shared Zod schemas.** They
  were moved, not rewritten: same hand-rolled state, same `canSubmit` booleans.
  Only `finalInvoice` has schemas in `packages/shared`, and moving the rest is
  per-module work. `useZodForm` is now genuinely reachable from a routed screen
  (Addendum 5's open item), so the first form to adopt it will not break the
  image build.
- **The remaining fourteen files over 400 lines are untouched** — Sales (2,594),
  Settings, Security, Vault, Commercial, Governance, Master data, HR. That is
  Phase 4's per-area sweep, which parallelises.
- **Raw palette colours: 56 → 46.** The shell's own `emerald`/`amber` in the
  environment switch and the sandbox banner are gone, as is the last of it in
  Finance and Operations; the remaining 46 are genuine scatter across the feature
  screens Phase 4 sweeps. (Addendum 3's "122 → 56" reproduces exactly at the
  pre-Phase-3 commit, so this is the same measure.)
- **No visual-regression baseline was committed.** The four-width run above was
  taken with a throwaway harness and deleted. Standing that up in CI needs
  Playwright and browsers in the frontend job, which the roadmap puts in Phase 5.
- **`platform-console/` remains out of scope**, as it has been throughout.

---

# Addendum 7 — Phase 4 implementation notes (2026-08-04)

Written while implementing Phase 4, not during the audit. As with Addenda 3 and
6, everything here is a **correction or addition** to the findings above,
discovered by changing the code rather than by reading it.

Phase 4's deliverables are met: every remaining area is on the shared
primitives, the god files are decomposed, raw-palette colours are at zero, and
route-level `React.lazy` was already delivered in Addendum 4. The tracked
checklist the phase asks for is `doc/PHASE4_CHECKLIST.md`, which also states
plainly what was **not** taken.

## The single most useful thing built this phase was a test harness

Everything the client tested before Phase 4 was a **primitive**. That is the
right place to start — fixing `Field` repairs 565 call sites at once — but a
primitive's test cannot see the defects that only exist once a screen is
assembled. `src/test/screen-harness.tsx` renders a real routed screen with its
network faked, and `features/screens.axe.test.tsx` puts 66 screens across 18
areas through all four of their states on every CI run.

It found a defect **on its first execution, against one already-migrated
screen**, and kept finding them:

1. **Every list table in the app shipped an empty `<th>`.** Each screen ends its
   columns with `{ key: "_a", label: "" }` for row actions, which rendered a
   literally empty header — axe `empty-table-header`, on roughly ninety screens.
   Navigating by column, a screen reader announces "Approve" and "Reject" with no
   idea which column they are in. Invisible to every primitive test, because it
   only exists where a column spec meets a table.

2. **A missing GRANT was reported to the user as a DISABLED FEATURE.**
   `vault/pages.tsx` chose between "you lack access" and "this tenant doesn't
   have the feature" by regexing the error _sentence_:

   ```
   /feature|not enabled|disabled|forbidden|permission/i.test(msg)
   ```

   `errMsg` renders every 403 as "You don't have permission to do this.", which
   matches `/permission/`. So a user missing the reports grant was told
   **"Reporting isn't enabled for this tenant"** and pointed at a developer-
   dashboard flag that was already on. They would ask an admin to enable
   something already enabled; the admin would look in the wrong place; the real
   cause — their role — was never mentioned to either of them.

   The backend has always distinguished these properly (`FEATURE_DISABLED` from
   `middleware/feature-gate.js` versus `FORBIDDEN`). The discriminator was being
   discarded one layer from the screen, because `useList` returns only a
   formatted string. It now also returns `errorCode`; `error` is unchanged, so
   the 161 sites that merely display it are untouched.

   This is the same shape as Addendum 6's Control Tower defect, where any 403
   fell into an empty state that told the user everything was fine. **Twice now,
   in two unrelated modules, a permission failure has rendered as reassurance.**
   That is a pattern, not a coincidence: `errMsg` flattens every 403 to one
   sentence, and screens then try to recover the distinction from prose.

3. **Thirteen unlabelled `<select>` controls**, across Fleet, Costing, Finance,
   Settings, Security, Master data and the shared `CountrySelect` — every one
   announced as "combo box" with no indication of what it selects.

4. **WMS Equipment had no loading state.** With data still null its kanban
   rendered four _empty columns_, which does not read as "loading" — it reads as
   "this warehouse owns no equipment". A different and more alarming statement to
   make to a warehouse manager.

## A correction to F14: the cause was ergonomics, not discipline

The audit records 122 raw-palette colours as a discipline problem — rule #1 of
`FE_DESIGN_RULES.md` is "never hardcode colours", and 122 sites ignored it.

That is not quite what was happening. The semantic tones existed in `index.css`
from Phase 1 but were **never exposed to Tailwind**, so the correct spelling was

```
text-[rgb(var(--ok))]        vs        text-emerald-600
bg-[rgb(var(--ok)_/_0.12)]   vs        bg-emerald-500/10
```

The wrong thing was shorter to type than the right one, and 46 remaining sites
took the shortcut. `ok` / `warn` / `bad` / `brand-*` are now real Tailwind
colours with `<alpha-value>`, so `border-ok/40` resolves. Making the right thing
the short thing did more than the rule ever did.

## Two gates that were wrong when first written

Both found by running them rather than by reasoning about them, and both worth
recording because each failed in the way that gets a gate _disabled_:

- **The palette gate flagged its own evidence.** `ui/pill.tsx` and its test both
  QUOTE the deleted shadow `Badge` map in their header comments, as the record of
  what they replaced. A checker that reports the documentation of a fix as an
  instance of the bug teaches people it is noise. It now blanks comments first.

- **The palette gate did not scan new files.** It used `git ls-files`, which
  lists only what is already committed — so a brand-new component, the likeliest
  place for a fresh violation, was not checked at all. Caught when the gate
  passed its own new file. It also threw `ENOENT` on files deleted-but-unstaged,
  which is the normal state mid-refactor; a checker that looks broken rather than
  clean is one nobody trusts.

Both are verified to exit 1 on a reintroduced violation, including in an
untracked file.

## The lint rules are now errors, one phase early

The config said `jsx-a11y`'s backlog rules "flip to error in Phase 5 once the
count is zero". The count reached zero here, and a satisfied rule left at `warn`
only invites the backlog back. `react-hooks/exhaustive-deps` is an error too.

Neither was reached by suppression. The two biggest clusters were real:

- **Eleven `autoFocus` props were dead code.** They sit inside `<Modal>`, which
  has been Radix `Dialog` since Phase 2 and focuses its first control already.
  Deleted, not disabled. Three remain, each with a written reason — and each is
  focus _recovery_, where the element the user was on has just been unmounted.

- **Ten `exhaustive-deps` warnings were one bug, ten times.** `const rows =
query.data || []` mints a fresh array every render, so any effect depending on
  it re-runs every render. On the four 360 screens (client, vehicle, employee,
  location) that effect calls `setSelId` — the loop was bounded only by an
  `if (!selId)` guard happening to be false after the first pass.

Every remaining exception is an `eslint-disable-next-line` carrying a reason at
the call site, which is reviewable. A blanket `warn` is not.

## Two defects fixed that the audit did not name

- **`DataList`'s clickable row was mouse-only** (F9 names the mobile card; the
  desktop `<tr>` had the same problem). The fix is not `<tr role="button">` —
  that would work for the keyboard and destroy row/column position and header
  association on a 200-row table. Column 0 now renders a real `<button>` named by
  the record, so the row keeps table semantics _and_ is keyboard-reachable.

- **The Sales kanban could not be operated without a mouse.** Drag-and-drop with
  no alternative, on the CRM's primary screen. Each card now carries a "Move"
  menu calling the same endpoint, named per deal.

## What the decomposition actually surfaced

Files over 400 lines: **15 → 4**. Sales alone went from 2,596 lines in one file
to eleven. But the useful part was what only became visible once the files were
separate:

- `settings/store-pages.tsx` carried a **byte-identical second copy** of
  `PageError`.
- `shell` was declared independently in **ten** HR files; the split would have
  made an eleventh. F14's "`const shell` defined independently in 28 files",
  caught mid-regrowth.
- `hr/pages.tsx` was a **barrel** re-exporting nine sibling screens while also
  holding two of its own — which is why nobody had noticed it was a god file.

A note on the counts in §4's baseline table: `const shell` now appears 42 times,
_higher_ than the audit's 28. That is not a regression. Every one is
`= pageShell.wide` — an alias for the shared token — where the audit's 28 were
the hardcoded literal `"mx-auto max-w-6xl animate-fade-in"`. Changing the token
moves all of them. The metric got worse while the property it was measuring got
fixed, which is worth knowing before anyone re-runs the table.

## Verified in a browser, not inferred

Headless Chromium against the built `dist/`, at 1280 / 1440 / 1920 / 2560:

|                   | 1280   | 1440   | 1920   | 2560   |
| ----------------- | ------ | ------ | ------ | ------ |
| content column    | 1232px | 1392px | 1664px | 1664px |
| `<h1>` count      | 1      | 1      | 1      | 1      |
| horizontal scroll | none   | none   | none   | none   |

Six screens across Control Tower, Finance, Sales, Security, Master data and
Settings. Zero page errors. Settings → Numbering correctly holds 768px at every
width: it is `reading`, and a 1664px-wide form is not a feature.

One thing this run corrected about my own expectations. The seeded session had
to go through `/auth/refresh` — the access token is in-memory by design and only
the refresh token is persisted — so the first run measured the _landing page_ at
four widths and reported one `<h1>` and no horizontal scroll, all of it true and
all of it meaningless. A harness that renders the wrong screen still produces a
confident table.

## The 2560px case, restated

`max-w-wide` is 1664px, so 1920 and 2560 render the same column. Addendum 6
called this "addressed rather than solved"; this phase measured it again and did
not change it. It is a **token** decision — one number — and it belongs with the
Phase 5 density work, where row height, compact tables and the fluid upper tier
are the same conversation.

Relatedly, and worth stating because the raw number looks alarming: `xl:` appears
6 times and `2xl:` once, against F2's target of "desktop tiers on every layout
screen". After Phase 1 the _container_ carries the desktop behaviour, and the
dominant content is tables, which fill their container. The remaining
`sm:grid-cols-2` sites are overwhelmingly form grids **inside width-capped
modals**, where two columns is correct at every viewport. Widening those would be
a regression dressed up as a metric improvement.

## Scope explicitly NOT taken in Phase 4

- **Forms are still not on `<Form>` + shared Zod schemas.** The forms in the
  files split this phase were moved, not rewritten. `useZodForm` is reachable and
  gated (`check:shared`), so the first adopter will not break the image build —
  that was the blocker and it is gone.
- **Raw `<table>` remains in 9 feature files** (14 total, of which 5 ARE the
  primitives). These are bespoke layouts — the permission matrix, portal
  terminals, 360 side panels — where the shared `<Table>` is the wrong shape.
- **No visual-regression baseline was committed**, as in Phase 3. CI needs
  Playwright and browsers in the frontend job; Phase 5.
- **`platform-console/` remains out of scope**, as throughout.

---

# Addendum 8 — Phase 5 implementation notes (2026-08-05)

Written while implementing Phase 5, not during the audit. As with Addenda 3, 6
and 7, everything here is a **correction or addition** to the findings above,
discovered by changing the code rather than by reading it.

Phase 5's scope items are done and the tracked record is
`doc/PHASE5_CHECKLIST.md`, which also states plainly what was not taken. This
addendum is the part that changes what the audit says.

## The theme of this phase: three gates were measuring the wrong thing

Phases 1-4 built gates and the gates were green. Phase 5 found that three of the
audit's own findings had been **reported as fixed while the property they
described was still broken** — not because anyone cut a corner, but because in
each case the thing that was easy to measure was not the thing that mattered.

That is worth stating as a pattern, because it is the third time this document
has recorded a version of it. Addendum 6: a pill whose ground came from one
token and whose text came from another, "a contrast pair nobody had measured
because neither half was chosen against the other." Addendum 7: a permission
failure rendering as reassurance, twice, because `errMsg` flattened the
discriminator one layer from the screen. Now three more.

## F13 was still failing, on every light-theme status pill

**The gate measured status text against `--card`. A status pill does not sit on
`--card`.** `.st-ok` is `color: rgb(var(--ok))` over
`background: rgb(var(--ok-fill) / 0.13)`, and F13 says so in as many words:
_"these pills pair the failing colour with a tinted background, which is worse
than the white-background figures above, not better."_

Nobody had measured the composite. Measured now, on the worse of the two
surfaces it can land on:

| Pill                    | Was        | Now    |
| ----------------------- | ---------- | ------ |
| `.st-blue` / `.st-info` | **3.27:1** | 4.55:1 |
| `.st-orange`            | **3.79:1** | 4.57:1 |
| `.st-ok`                | **3.75:1** | 4.55:1 |
| `.st-warn`              | **3.98:1** | 4.60:1 |
| `.st-bad`               | **3.58:1** | 4.58:1 |

Twelve failures in the light theme, on the most semantically loaded text in an
ERP — how every document announces its state — across four phases of a gate that
was green throughout. Dark passed.

The inks are retuned along their own hues by the least amount that clears 4.5:1
(8-14%), and the gate no longer takes a hand-written list of pairs: it **parses
the `.st-*` rules out of `index.css`**, resolves `var()` chains, composites the
alpha, and measures every pill on both surfaces in both themes. A pill added
tomorrow is measured without anyone remembering this exists — which matters,
because `.st-info` was itself an audit finding (F12: referenced and never
defined) and is exactly the kind of thing a hand-maintained list does not notice.

**AAA, honestly.** Phase 5's scope says "7:1 for body text, status pills and
money figures". Body text and money clear it already (~15:1) and are now gated
there. Pills cannot: 7:1 on a tinted ground forces the tint to near-white or the
ink to near-black, at which point the tone stops carrying meaning and the pill is
just text. They are gated at AA and _reported_ against AAA. Moving a threshold
until it passes would have been the other option.

## F13's headline fix was built in Phase 1 and adopted nowhere

The audit's single most-cited number is `--primary` at **2.59:1** as text. Phase
1 built `--primary-ink` to replace it. Phase 5 found `text-primary` still in use
across **38 files**.

A ratio check over tokens could never have caught this — every token in the
matrix was passing. The defect was _which token the JSX reached for_, and the
reason is the one Addendum 7 records for the raw palette: `text-primary` is what
Tailwind's `primary.DEFAULT` makes the natural spelling, it is shorter than
`text-primary-ink`, and it renders a colour that looks brand-correct. Making the
right thing the short thing did more than the rule ever did; here, nobody had.

The gate now scans source for a fill token in a text position. It found one more
site after the sweep, in a syntax the sweep did not know about
(`text-[color:var(--primary)]`) — which is the argument for a gate over a sweep
in one line.

**`--brand-blue` had the same shape** and needed the same split: it was used as
type over its own 12% tint at eight sites (the KPI tile, three Control Tower
components, the callout, the AI action chip, both blue pills). `--brand-blue-ink`
now exists, mirroring `--primary-ink`. Rule of thumb, now in the guide:
**`brand-blue` fills, `brand-blue-ink` writes.**

**And the half no gate can see.** `applyBrand` derives `--primary-ink` at runtime
for every tenant that is not the default, and it had the identical defect —
derived against `--card`, used on a pill. It now derives against every surface
the ink can land on, tinted grounds included. The first attempt derived against
the pill ground _alone_ and broke on a near-black brand in dark mode, which the
test caught: tinting a dark surface with a near-black brand makes the ground
**darker** than the card, so a light ink clears the ground and fails the card.
There is no single worst surface; there is a set.

## F17's density fix had never landed on a screen anyone uses

F17 measured the table row at **~46px** against a 28-32px category standard and
diagnosed the padding: `px-4 py-3.5`. Phase 1 changed the padding to `py-row`
(6px), every unit test agreed, and the audit's baseline table has recorded it as
done ever since.

A real list row measured **49px**.

**The padding was never what set the height.** A table row is as tall as its
tallest cell, and every list screen in this product ends with
`<Button size="sm">` in the actions column — `h-9`, 36px, which with 12px of
padding is 48. The status pill was the second offender at 24px, inheriting a 20px
line box from its `text-sm` cell.

It could not be seen in jsdom, which has no layout engine, and it was not what
the Phase 3 and 4 browser runs measured (content column, `<h1>` count, horizontal
scroll). So the number the fix existed to change had not moved for four phases,
and nothing was wrong with anyone's reasoning — the measurement simply did not
exist.

Fixed at two shared sources rather than 67 call sites: `--row-control-h` (20px)
is applied by `<RowActions>`, and `.status` now sets its own 16px line box. Five
screens carrying a hand-rolled copy of the RowActions click shield were migrated,
which is also how they inherit the bound.

| Density     | Row, before | Row, now |
| ----------- | ----------- | -------- |
| Compact     | 49px        | 29.5px   |
| Default     | 49px        | 33.5px   |
| Comfortable | 49px        | 41.5px   |

_(the extra 1.5px over the design figure is the `<tr>` hairline and a 20.5px line
box after font metrics; the browser gate allows for it explicitly rather than
fudging the documented numbers)_

## The 2560px case, finally solved rather than restated

Addenda 6 and 7 both called this "addressed rather than solved" and both pointed
at the density work. `max-w-wide` was 1664px, so a 2560px display rendered the
same column as a 1920px one with ~450px of margin each side — the case F2's
opening sentence describes.

| Viewport | Column, before | Column, now |
| -------- | -------------- | ----------- |
| 1280     | 1232           | 1232        |
| 1440     | 1392           | 1392        |
| 1920     | 1664           | 1856        |
| 2560     | **1664**       | **2160**    |

2160 rather than uncapped, because a table row is read left to right and the
distance from a record's name to its last column is the cost of every lookup.
The frozen first column covers the tables that genuinely need more.

## Two defects the audit did not name, found by writing keyboard tests

Both in `<InlineEdit>`, both about focus, and neither visible without a test that
uses the keyboard:

1. **Entering edit mode dropped focus on `<body>`.** The button unmounts and the
   input mounts, and `select()` does not focus an element — it is a selection
   API. Leaving edit mode did the same in reverse.
2. **The fix for the first exposed a third.** The button was `disabled` while the
   save was in flight, and a disabled button cannot hold focus, so restoring
   focus to it silently did nothing. It carries `aria-busy` now: same state
   announced, element still focusable.

Worth recording because both are invisible to a mouse and to axe. The component
was axe-clean in every state throughout.

## A regression Phase 4 created, and paid off here

Phase 4 fixed the mouse-only clickable row by making column 0 a real `<button>`.
That was right, and it put **one tab stop per row** into the page. On a 200-row
shipment table, reaching the pager below it costs 200 presses of Tab plus every
row-action button on the way. A keyboard user went from "cannot open a row" to
"cannot get past the table", which is not obviously the better failure.

A roving tabindex leaves exactly one row in the tab order, with arrow keys
between them: 200 tab stops become one. It deliberately does **not** declare
`role="grid"`, for the same reason Phase 4 refused `<tr role="button">` — a
screen reader in browse mode navigates a real `<table>` by row and column and
says "row 4 of 120", and on a financial table that IS the usability. Browse mode
intercepts arrow keys before the page sees them, so the two models do not collide.

## Retiring the FAB removed something nobody had noticed it carried

F9 says the draggable cluster "covers the bottom-right of every table and
duplicates the copilot entry point". True, and the sharper point is that the
drag was the _workaround_ for the overlap rather than a feature — and the dragged
position **persists**, so moving it out of the way on one screen moved it into
the way on every other one, permanently.

What the audit did not name: the top bar deliberately never duplicated Messages
("Messages lives on the Smart Comms floating pin" — `app-shell.tsx`). So removing
the pin from desktop would have left a desktop user with **no unread-messages
indicator at all**. The replacement carries that count, in its accessible name
and not only as a coloured circle.

## A correction to §4's baseline table

Two rows need re-reading after this phase.

- **"Files > 400 lines: 17 → target 0"** is now 3, and all three are deliberate
  keeps documented in `PHASE5_CHECKLIST.md` §5.5. `features/scaffold/screen-specs.ts`
  (930) is a **data** table, not a component, and counting it was always
  misleading.
- **"Token contrast failures (measured): 6 → target 0"** was reported as 0 from
  Phase 1 onward and was in fact **12**, for the reason at the top of this
  addendum. It is 0 now, against a measurement that reflects what is on screen.

## Scope explicitly NOT taken in Phase 5

Stated so nobody assumes it is done. Full detail in `doc/PHASE5_CHECKLIST.md` §5.

- **Forms are still not on `<Form>` + shared Zod schemas.** Unchanged from Phases
  3 and 4; only `finalInvoice` has schemas in `packages/shared`.
- **No pixel screenshot baselines**, deliberately. The layout gate asserts
  measured invariants, which are deterministic across platforms; a pixel baseline
  taken on one machine and compared on another is red on its first CI run for a
  reason nobody can act on, and this document has twice recorded what happens to
  a gate like that.
- **The new affordances are wired into four screens**, not ninety. Density, the
  row-height bound, the FAB retirement, the motion budget and the contrast
  retune are app-wide because they are token- or shared-component-level;
  selection and column visibility are per-screen judgement.
- **The operator usability session has not happened.** It is the one Phase 5
  deliverable an engineer cannot produce alone.
- **`platform-console/` remains out of scope**, as throughout.
