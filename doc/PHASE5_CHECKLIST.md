# Phase 5 — density, polish, and regression-proofing: status

**Phase 5 deliverables:** *"Density system with usage guidance. Desktop interaction patterns documented. CI gates that fail on contrast, a11y and visual regressions. One canonical frontend guide."* — `DESKTOP_UI_AUDIT.md` §3, Phase 5.

This is the tracked record, in the shape of `PHASE4_CHECKLIST.md`. It exists so "the phase is done" is a claim someone can check rather than take on trust.

**Status: Phase 5 complete.** Every item below is either done and gated, or listed under §5 with the reason it was not taken.

---

## 1. The gates

Ten now, up from seven. Each fails the build.

| Gate | Command | What it holds |
|---|---|---|
| Typecheck | `tsc -b` | strict, `noUnusedLocals`, `noUnusedParameters` — and now the e2e specs too |
| Lint | `npm run lint` | **0 errors.** `jsx-a11y` and `react-hooks/exhaustive-deps` at `error` |
| Tests | `npm test` | **648 passing**, up from 563 |
| **Contrast** | `npm run check:contrast` | every text pair, **composited** — pills measured on their own tinted ground, and no fill token used as type |
| **Motion** | `npm run check:motion` | **new** — 250ms in-app budget; `prefers-reduced-motion` still honoured |
| **Docs** | `npm run check:docs` | **new** — the guide may not name a component that does not exist (F5) |
| **Layout** | `npm run test:e2e` | **new** — four desktop widths, row height, sticky/frozen columns, in a real browser |
| Palette | `npm run check:palette` | zero raw Tailwind palette colours |
| Bundle | `npm run check:bundle` | no circular chunks |
| Shared schemas | `npm run check:shared` | `packages/shared` resolves, parses, one Zod instance |

All ten run in CI (`.github/workflows/ci.yaml`, `frontend` job).

An eleventh command, `npm run prove:gates`, is **not** in CI: it deliberately breaks the working tree. See §4.

---

## 2. Scope, item by item

The audit's Phase 5 scope, and where each landed.

| # | Scope item | Status |
|---|---|---|
| 1 | Compact table variant · user-selectable density | ✅ 28 / 32 / 40px, account menu, `data-density` → `--row-py` |
| 2 | Sticky headers · frozen first columns | ✅ opt-in on `DataList` / `ListPage`; reference screen is chart-of-accounts |
| 3 | Column visibility controls | ✅ `useColumnVisibility` + `<ColumnsMenu>`, persisted per screen |
| 4 | Multi-select with shift-click · bulk row actions | ✅ `useRowSelection` + `<BulkBar>`, scope pruned to visible rows |
| 5 | Keyboard row navigation | ✅ roving tabindex; 200 tab stops → 1, table semantics kept |
| 6 | Inline edit where it fits | ✅ `<InlineEdit>`, wired to service-type names; §3.2 on where it does **not** fit |
| 7 | Resizable split panes for master-detail | ✅ `<SplitPane>`, a real `role="separator"` with arrow keys |
| 8 | Retire the draggable FAB on desktop | ✅ `md:hidden`; `<QuickActionsMenu>` in the top bar carries the unread count |
| 9 | Motion and reduced-motion review | ✅ hover lifts gone; `check:motion` in CI |
| 10 | AAA where it pays | ◐ body text and money **gated at 7:1**; pills gated at AA — see §3.1 |
| 11 | `jsx-a11y` warn → error | ✅ already done in Phase 4, one phase early |
| 12 | Contrast assertions in CI | ✅ and substantially rewritten — see §3.1 |
| 13 | Visual regression baselines | ✅ as **measured invariants**, not pixels — see §3.3 |
| 14 | "New screen" generator | ✅ `npm run new:screen`, itself tested |
| 15 | Consolidate the six frontend docs | ✅ `doc/FRONTEND_GUIDE.md`, gated by `check:docs` |
| — | The 2560px tier (deferred by Phases 1, 3, 4) | ✅ `max-w-wide` 1664 → 2160 |

---

## 3. What the work found

Three findings that only appeared by doing rather than reading. Full write-up in `DESKTOP_UI_AUDIT.md` Addendum 8.

### 3.1 Every light-theme status pill was failing AA, on a gated codebase

The contrast gate measured status text against `--card`. A status pill does not sit on `--card` — `.st-ok` is `rgb(var(--ok))` over `rgb(var(--ok-fill) / 0.13)`. F13 said so in as many words. Measured on the composite:

| Pill | Was | Now |
|---|---|---|
| `.st-blue` / `.st-info` | 3.27:1 | 4.55:1 |
| `.st-orange` | 3.79:1 | 4.57:1 |
| `.st-ok` | 3.75:1 | 4.55:1 |
| `.st-warn` | 3.98:1 | 4.60:1 |
| `.st-bad` | 3.58:1 | 4.58:1 |

*(worst surface, `--background`, light theme; dark passed throughout)*

The gate now parses the `.st-*` rules out of `index.css` and composites them — 28 measurements where there were six hand-written ones, and a pill added tomorrow is measured without anyone remembering.

**AAA is reported, not gated, for pills.** A pill's value is being legible *and* recognisably coloured; 7:1 on a tinted ground drives the tint to near-white or the ink to near-black, at which point the tone stops carrying meaning. Body text and money figures **are** gated at 7:1 and clear it at ~15:1.

### 3.2 `--primary` was used as text at 38 files' worth of call sites

Phase 1 measured `--primary` as type at 2.59:1, built `--primary-ink` to replace it, and migrated nothing. `text-primary` is what Tailwind's `primary.DEFAULT` makes the natural spelling and it is shorter than the correct one — Addendum 7's ergonomics lesson, one token over.

A ratio check over tokens could never have found it: every token was passing. The gate now also scans source for a fill token in a text position, and it caught one more site after the sweep, in a syntax the sweep did not know about (`text-[color:var(--primary)]`).

The same defect existed in `lib/theme.ts`, where the ink is derived at runtime for every non-default tenant — invisible to any build-time gate.

### 3.3 The density fix from Phase 1 had never landed on a real screen

F17 measured ~46px rows and diagnosed the padding. Phase 1 changed the padding. A real list row stayed at **49px**, because a table row is as tall as its tallest cell and 67 screens put `<Button size="sm">` (`h-9`, 36px) in the actions column.

Invisible to jsdom, which has no layout engine, and not what the Phase 3/4 browser runs measured. Found on the browser gate's first real run.

Fixed at two shared sources — `--row-control-h` (20px) applied by `<RowActions>`, and `.status` given its own 16px line box.

---

## 4. How the gates were verified

`npm run prove:gates` injects a real regression per gated class, asserts a non-zero exit, restores, and asserts a zero exit. **12/12 pass.** Output is in the commit message for `Phase 5 (6/n)`.

This is not ceremony. A gate nobody has seen fail is a gate nobody knows works, and this repo has three separate records of that (Addendum 4's circular-chunk warning; Addendum 7's two wrong-when-written gates; Phase 5's own doc gate passing a reintroduced `<CrudResource>` on its first attempt).

The run itself found a twelfth defect: the palette gate was flagging the proof harness's own regression string — the second time that gate has flagged its own evidence.

---

## 5. What was NOT taken, and why

Stated explicitly so nobody assumes it is done.

### 5.1 Forms are still not on `<Form>` + shared Zod schemas

Unchanged from Phases 3 and 4. Only `finalInvoice` has schemas in `packages/shared`. `useZodForm` is reachable and gated (`check:shared`), and the generator's form stub documents the target shape — but moving each module's schemas is per-module work with a backend counterpart, and Phase 5's scope does not include it.

### 5.2 Pixel screenshot baselines are deliberately not committed

The layout gate asserts **measured invariants**: content column at four widths, row height against the density token, sticky/frozen behaviour, one `<h1>`, no horizontal scroll, zero page errors.

A committed pixel baseline would differ between a developer's machine and `ubuntu-latest` on font hinting alone, so its first CI run would be red for a reason nobody can act on — and this repo has twice written down what happens to a gate like that. Screenshots and traces **are** captured, as artifacts on failure, for a human to look at. They are evidence, not the assertion.

### 5.3 Four screens carry the new affordances; the rest are unchanged

Sticky headers, frozen columns, column visibility, selection, inline edit and split panes are wired into `chart-of-accounts`, `service-types` and `client-360` — enough to prove each end to end and give the next person a screen to copy. Density, the row-height bound, the FAB retirement, the motion budget and the contrast retune are **app-wide** because they are token- or shared-component-level.

Rolling selection and column visibility across the remaining ~90 list screens is per-screen judgement (which columns matter, what a bulk action should do), not mechanical, and the audit does not ask for it.

### 5.4 `xl:` appears 6 times and `2xl:` once

Unchanged from Phase 4's §4.1, and still not the problem it looks like: after Phase 1 the *container* carries the desktop behaviour, and the dominant content is tables, which fill their container. The remaining `sm:grid-cols-2` sites are overwhelmingly form grids inside width-capped modals, where two columns is correct at every viewport.

What changed is that the container now genuinely uses a 2560px display, and there is a browser assertion proving it.

### 5.5 Three files remain over 400 lines

Down from four. `hr/pages.tsx` went; the rest are unchanged deliberate keeps:

| File | Lines | Why |
|---|---|---|
| `app/layout/app-shell.tsx` | 765 | the shell; Phase 3 took it 924 → 702, Phase 5 added the density menu and quick actions |
| `security/permission-matrix-page.tsx` | 445 | the audit calls this "the best file in the codebase" and spends a paragraph on why |
| `auth/login-modal.tsx` | 409 | one auth flow, three stages sharing state; the seams are worse than the size |

`features/scaffold/screen-specs.ts` (930) is a **data** table, not a component.

### 5.6 The operator usability session has not happened

Phase 5's validation asks for one "on the densest screens (Finance invoice list, Security permission matrix) at 1920px". That needs an operator, and it is the one deliverable an engineer cannot produce alone. The measurements it would be run against are in place; the session is not.

### 5.7 `platform-console/` remains out of scope

As it has been throughout.

---

## 6. How to verify

**Check exit codes, not output** — `npm test | grep 'Tests '` makes `$?` grep's, which is how a red build was once reported green on this repo.

```sh
cd client
npx tsc -b;                 echo "tsc:      $?"
npm run lint;               echo "lint:     $?"
npm test;                   echo "test:     $?"
npm run check:contrast;     echo "contrast: $?"
npm run check:motion;       echo "motion:   $?"
npm run check:palette;      echo "palette:  $?"
npm run check:docs;         echo "docs:     $?"
npm run build;              echo "build:    $?"
npm run check:bundle;       echo "bundle:   $?"
npm run check:shared;       echo "shared:   $?"
npm run test:e2e;           echo "layout:   $?"
```

`npm run test:e2e` needs a Chromium: `npx playwright install --with-deps chromium`. It builds and serves `dist/` itself.

To re-verify that the gates are gates: `npm run prove:gates` (clean tree required; it edits real files and restores them).
