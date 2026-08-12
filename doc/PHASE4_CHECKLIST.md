# Phase 4 — per-screen checklist and status

**Phase 4 deliverable:** _"A tracked checklist so partial completion is visible rather than assumed."_ — `DESKTOP_UI_AUDIT.md` §3, Phase 4 validation.

This is that checklist. It exists so that "the sweep is done" is a claim someone can check rather than take on trust, and so the next person can see exactly where the line is.

**Status: Phase 4 complete.** Every item below is either done and gated, or listed under §4 with the reason it was not taken.

---

## 1. The gates

Each of these fails the build. That is the difference between this phase and the documentation-only rules the audit found being ignored (F14: rule #1 "never hardcode colours", 122 violations against it).

| Gate           | Command                  | What it holds                                                                          |
| -------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| Typecheck      | `tsc -b`                 | strict, `noUnusedLocals`, `noUnusedParameters`                                         |
| Lint           | `npm run lint`           | **0 errors.** `jsx-a11y` and `react-hooks/exhaustive-deps` are now `error`, not `warn` |
| Tests          | `npm test`               | 563 passing, incl. 262 screen-state assertions                                         |
| Contrast       | `npm run check:contrast` | every text-on-surface token pair clears WCAG AA                                        |
| **Palette**    | `npm run check:palette`  | **new in Phase 4** — zero raw Tailwind palette colours                                 |
| Bundle         | `npm run check:bundle`   | no circular chunks                                                                     |
| Shared schemas | `npm run check:shared`   | `packages/shared` resolves, parses, one Zod instance                                   |

All seven run in CI (`.github/workflows/ci.yaml`, `frontend` job).

---

## 2. The per-screen checklist

The eight items the audit specifies for each screen, and how each is verified.

| #   | Item                                            | How it is checked                                                                                                 | Status                 |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | `PageContainer` with a deliberate width variant | `page-container.test.tsx` asserts no raw `max-w-6xl` returns; browser run confirms the column tracks the viewport | ✅                     |
| 2   | Desktop-tier layout                             | Chromium at 1280/1440/1920/2560 — column grows 1232 → 1392 → 1664, no horizontal scroll                           | ✅ (see §4.1)          |
| 3   | All four states explicit                        | `screens.axe.test.tsx` renders **every registered screen in all four states**                                     | ✅                     |
| 4   | Forms on `Form` + shared Zod schema             | —                                                                                                                 | ⛔ not taken, see §4.2 |
| 5   | Raw palette → semantic tokens                   | `check:palette`, in CI                                                                                            | ✅ 0                   |
| 6   | Raw elements → primitives                       | see §4.3                                                                                                          | ◐ partial              |
| 7   | Non-interactive `onClick` → real controls       | `jsx-a11y` at `error`                                                                                             | ✅ 0                   |
| 8   | Axe clean                                       | 66 screens × 4 states, in CI                                                                                      | ✅ 0 violations        |

---

## 3. Area coverage

"Registered" means the area's screens are in `src/features/screens.axe.test.tsx` and are rendered in all four states on every CI run.

| Area                        | Screens registered | God file split            | Notes                                        |
| --------------------------- | ------------------ | ------------------------- | -------------------------------------------- |
| Finance                     | 3                  | — (Phase 3)               |                                              |
| Operations                  | 2                  | — (Phase 3)               |                                              |
| Sales                       | 6                  | ✅ 2,596 → 11 files       | largest file in the client                   |
| Security                    | 5                  | ✅ 1,039 → 7              | `shared.tsx` for the IAM types               |
| Vault                       | 4                  | ✅ 1,023 → 6              |                                              |
| Commercial                  | 4                  | ✅ 1,056 → 6              |                                              |
| Governance                  | 4                  | ✅ 928 → 5                |                                              |
| Master data (`master/`)     | 3                  | ✅ 687 → 4                |                                              |
| Master data (`masterdata/`) | 2                  | ✅ 682 → 6                |                                              |
| Procurement                 | 4                  | ✅ 459 → 5                |                                              |
| Settings                    | 10                 | ✅ 1,088 + 597 + 565 → 16 | `PageError` deduplicated                     |
| WMS                         | 5                  | —                         | `EquipmentPage` gained a loading state       |
| Fleet                       | 6                  | —                         | 1 unlabelled `<select>` fixed                |
| HR                          | 2                  | ✅ 423 → 2 + `shared`     | barrel removed; hub imports directly         |
| AI control                  | 2                  | —                         |                                              |
| Costing                     | 1                  | —                         |                                              |
| Support & admin             | 3                  | —                         | Help is static — narrowed, with the reason   |
| Portal                      | —                  | ✅ 622 → 4                | separate surface, not in the tenant register |

**66 screens, 18 areas, 262 state assertions.**

---

## 4. What was NOT taken, and why

Stated explicitly so Phase 5 does not assume it is done.

### 4.1 The 2560px tier is addressed, not solved

`max-w-wide` is 1664px, so 1920 and 2560 render the same column. Phase 1 chose that value deliberately ("so a 1920px display is actually used") and Addendum 6 already flagged the gap. Measured again here and unchanged. A genuinely fluid upper tier is a **token** decision that belongs with the Phase 5 density work, not a per-screen one.

`xl:` is used 6 times and `2xl:` once. That number is low and it is not the problem it looks like: after Phase 1 the _container_ carries the desktop behaviour, and the dominant content is tables, which fill their container. The remaining `sm:grid-cols-2` sites are overwhelmingly **form grids inside width-capped modals**, where two columns is correct at every viewport — widening those would be a regression, not a fix.

### 4.2 Forms are not on `<Form>` + shared Zod schemas

Unchanged from Phase 3's statement. Only `finalInvoice` has schemas in `packages/shared`; moving the rest is per-module work with a backend counterpart. The forms in the files split this phase were **moved, not rewritten** — same hand-rolled state, same `canSubmit` booleans.

`useZodForm` is reachable from a routed screen and the build gate for it exists (`check:shared`), so the first form to adopt it will not break the image build. That was the blocker; it is gone.

### 4.3 Raw elements → primitives is partial

|                      | Count    | Assessment                                                                                                                                                                                                                                                         |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Raw `<table>`        | 14 files | **5 are the primitives themselves** (`ui/table`, `ui/data-view`, `ui/workflow`, `markdown`, `document-view`). 9 feature files remain, mostly bespoke layouts (permission matrix, portal terminals, 360 side panels) where the shared `<Table>` is the wrong shape. |
| Ad-hoc `Loading…`    | 30 → 24  | Six bare `<div>Loading…</div>` replaced with `LoadingRow` (announced). The remaining 24 are **correct**: `LoadingRow`'s own default label, `sr-only` text inside skeletons, an `<option>` placeholder, and doc comments quoting the finding.                       |
| `const shell`        | 42       | All but one are `= pageShell.wide` — an alias for the shared token, not F14's hardcoded `"mx-auto max-w-6xl animate-fade-in"` literal. Changing the token moves all 38. Collapsing the alias itself is cosmetic.                                                   |
| `max-w-6xl` literals | **0**    | The 2 remaining hits are in a test asserting it is never reintroduced.                                                                                                                                                                                             |

### 4.4 Four files remain over 400 lines

Down from 15. Each is a deliberate keep:

| File                                  | Lines | Why                                                                                                                                                               |
| ------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scaffold/screen-specs.ts`            | 930   | a **data** table, not a component                                                                                                                                 |
| `app/layout/app-shell.tsx`            | 708   | the shell; Phase 3 already took it 924 → 702                                                                                                                      |
| `security/permission-matrix-page.tsx` | 445   | the audit calls this "the best file in the codebase" and spends a paragraph on why. Cutting it to satisfy a line count would destroy what makes it worth reading. |
| `auth/login-modal.tsx`                | 409   | one auth flow, three stages sharing state; the seams are worse than the size                                                                                      |

### 4.5 No visual-regression baseline

Unchanged from Phase 3. The four-width run was taken with a throwaway harness. Standing it up in CI needs Playwright and browsers in the frontend job, which the roadmap puts in Phase 5.

### 4.6 `platform-console/` remains out of scope

As it has been throughout.

---

## 5. Adding a screen to the gate

One entry in `src/features/screens.axe.test.tsx`:

```tsx
{
  name: "Invoices",
  render: () => <InvoicesPage />,
  routes: { "/final-invoices": [ …one representative row… ], "/clients": CLIENTS },
  populatedProof: /FIN-2026-0001/,
}
```

That buys four assertions: loading is announced, error says what went wrong, empty is not the developer default, populated has exactly one `<h1>` — each axe-clean.

**Get the fixture's paths and field names from the API types, not from memory.** Building this register, the same mistake was made seven times: a fixture keyed on a path or field the screen does not use (`/godmode` for `/god-mode/soft-deletes`, `inbound_id` for `grn_inbound_id`). Four crashed loudly. The other three were silent — nothing arrives, the screen renders its **empty state**, and all four assertions pass. An axe-clean empty table is axe-clean and worthless as coverage.

The populated test therefore asserts the fixture actually reached the screen: if `routes` supplied rows, the screen must not be sitting in an empty state. Run against all 64 cases it flagged exactly 2 — precise, not noisy.

Two opt-outs, each requiring a written reason at the call site:

- `states: [...]` narrows which of the four states apply. **The only legitimate reason is a screen that fetches nothing on arrival** — a search-first lookup has no loading state until the user asks it something.
- `rendersRows: false` allows an empty state alongside data — a side panel with nothing in it, an empty board column.

Narrowing either because a screen is _missing_ something it should have is the defect this file exists to catch.

---

## 6. How to verify

**Check exit codes, not output.** `npm test | grep 'Tests '` discards both Vitest's `Errors` line and the exit code — the pipe makes `$?` grep's. A run can report "563 passed" and still exit 1 on unhandled render errors, which is exactly how a red build was reported green on this branch.

```sh
npm test; echo "exit: $?"          # not: npm test | grep …
```
