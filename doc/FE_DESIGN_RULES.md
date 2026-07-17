# Praxis LS — Frontend Design & Layout Rules

_Source of truth: `client/src/index.css` (design system) + `client/src/components/*`.
This doc summarises them so a new screen looks like the rest without reverse-engineering
CSS. Values below are copied from `index.css` — if they ever disagree, the CSS wins._

The look is the Lovable **"Control Tower"** system ported onto the app's real plumbing.
Two hard rules underpin everything:

1. **Never hardcode colours.** Use the semantic tokens (via Tailwind utilities like
   `bg-card`, `text-muted-foreground`, `border`) or the `lux-*` classes. Hex belongs only
   inside `index.css`.
2. **Every accent resolves to `--primary`.** The tenant white-label loader (`src/lib/theme.ts`)
   overrides `--primary` / `--primary-foreground` / `--ring` at runtime, so anything you tint
   with `--primary` re-colours per tenant automatically. Tint with anything else and you break
   white-label.

---

## 1. Design tokens

Defined on `:root` and re-tuned under `.dark` (light/dark/system toggle flips the class).

**Surfaces / text**

| Token | Light | Purpose |
|---|---|---|
| `--background` | `rgb(243 246 251)` | App backdrop (cool off-white) |
| `--foreground` | `rgb(16 30 52)` | Primary text (navy) |
| `--card` / `--popover` | `rgb(255 255 255)` | Panel / dropdown surface |
| `--muted` / `--secondary` | `rgb(247 250 253)` | Subtle fills |
| `--muted-foreground` | `rgb(78 98 128)` | Secondary text |
| `--accent` | `rgb(239 244 250)` | Hover / selected fill |
| `--border` | `rgb(16 30 52 / 0.09)` | Hairline borders |
| `--input` | `rgb(16 30 52 / 0.12)` | Field borders |

**Accent (tenant-overridable at runtime)**

| Token | Value | Purpose |
|---|---|---|
| `--primary` | `rgb(245 130 31)` | Brand accent (orange default) |
| `--primary-foreground` | `rgb(255 255 255)` | Text on primary |
| `--ring` | `rgb(245 130 31)` | Focus ring |
| `--destructive` | `rgb(210 68 58)` | Danger |

**Brand + status palette** (`rgb()` triplets, used as `rgb(var(--x))`):
`--brand-orange 245 130 31`, `--brand-blue 24 132 196`, `--brand-blue-bright 28 155 215`,
plus `-ink` / `-deep` variants; status `--ok 40 148 94`, `--warn 176 128 24`,
`--bad 210 68 58`; ink `--ink 16 30 52`, `--ink-3 132 150 176`.

**Type, radius, shadow, mesh**

- `--font-display: "Playfair Display", Georgia, serif` — headings only.
- `--font-body: "Montserrat", system-ui, …` — everything else. Body is `14px` / line-height `1.55`.
- `--radius: 0.9rem` (cards); pills use `999px`.
- Shadows: `--shadow-s` (cards), `--shadow-m` (raised), `--shadow-l` (overlays/dropdowns).
- A fixed **mesh glow** (orange top-right, blue bottom-left) sits behind everything via
  `body::before`; don't add competing full-page backgrounds.

---

## 2. Signature classes

Use these instead of re-styling from scratch.

| Class | Use |
|---|---|
| `.lux-card` | Standard panel — white surface, hairline border, `--radius`, soft shadow. The default container for any block of content. |
| `.font-display` / `.serif` | Playfair headings. Pair with Tailwind sizing (`text-2xl`, etc.). |
| `.micro` | 10px uppercase tracked label (eyebrows, section kickers, table captions). |
| `.num` | Tabular figures for money/quantities (aligns columns). |
| `.status` + variant | Status pill with a leading dot. Variants: `.st-ok` (active/paid/success), `.st-warn` (pending/expiring), `.st-bad` (error/overdue), `.st-blue` (info), `.st-orange` (brand highlight), `.st-mute` (neutral). |
| `.lux-topbar` | Glass command bar (already applied by the app shell — you won't need it in screens). |
| `.lux-mark` | Brand glyph tile (blue gradient + serif letter). |
| `.lux-navlink` (+ `.active`) | Top-bar nav item with the orange active underline. Nav only. |
| `.lux-btn-primary` | Orange-gradient primary action. Prefer the `<Button>` primitive; use this for bespoke CTAs. |
| `.shadow-l` | Overlay/dropdown shadow. |
| `.lux-sidebar-in` | Slide-in animation for the More overlay sidebar. |

**Pre-auth only:** the `landing-*` and `login-*` classes are the marketing hero + sign-in
modal. They carry their own dark surface and are **not** for in-app screens — don't reuse them.

---

## 3. Building a screen

**Where things live.** Screens are components under `client/src/features/<area>/`, exported,
routed in `client/src/app/app.tsx`, and listed in the `NAV` array in
`client/src/app/layout/app-shell.tsx`. Register in `client/src/app/screen-registry.json` only
once the page and its actions are real (see `doc/FE_IA_HANDOFF.md` §3 for why). Unbuilt screens
route to the shared `<Planned/>` scaffold (`features/scaffold/screen-scaffold.tsx`, catalogue in
`screen-specs.ts`) — it renders a finished skeleton from the spec. (The old `ComingSoon` placeholder
was removed once every route pointed at `<Planned/>` or a real page — 2026-07-17.)

**The default list screen is `<ResourceList>`** (`components/resource-list.tsx`) — this is the
skeleton nearly every screen starts from. It fetches a tenant endpoint and renders a table with
real loading / empty / error states; columns are inferred from the first row if omitted:

```tsx
import { ResourceList } from "@/components/resource-list";

export const VehiclesPage = () => (
  <ResourceList
    title="Vehicles"
    description="Fleet registry (MOD-39)."
    endpoint="/vehicles"                    // hits /api/tenant/vehicles
    columns={[
      { key: "registration", label: "Registration" },
      { key: "status", label: "Status" },
    ]}
    action={(reload) => <Button onClick={reload}>New</Button>}  // optional toolbar
  />
);
```

**Data access.** Use `lib/api-client.ts`: `tenant(path)` (prefixes `/api/tenant`) and `api(path)`.
Errors throw `ApiError` with `.status` — treat `403` as a permission message, not a crash. Keep
fetch/mutation calls in a `lib/<area>-api.ts` module of typed helpers (see `lib/finance-api.ts`,
e.g. `postJournalEntry`, `createInvoiceDraft`) rather than inline in components.

**Building blocks** (don't hand-roll these):

- Tables — `components/ui/table.tsx`: `Table, THead, TBody, TR, TH, TD`.
- States — `components/ui/states.tsx`: `Spinner, LoadingRow, EmptyState, ErrorState`.
- Primitives — `components/ui/`: `button`, `input`, `label`, `card`, `otp-input`, `icons`.
- Write forms — `components/ui/modal.tsx`: `Modal`, `Field`, `Select`. Create/edit UIs are
  modals over the list, wired to a `lib/<area>-api.ts` helper.

**Layout.** The app shell already wraps content in `<main class="p-6">`, so screens **don't**
add their own outer padding or page chrome. Group content in `.lux-card` panels; constrain
forms/detail with a `max-w-*` and center (`mx-auto`). Headings use `.font-display`; small
labels use `.micro`.

**Light/dark.** Everything is token-driven — if you only used tokens and `lux-*` classes, dark
mode already works. Test both. No `dark:` hex overrides.

---

## 4. Tabs vs standalone (from the IA map)

`doc/FE_IA_HANDOFF.md` classifies each screen as **standalone** (its own route + `NAV` item) or
a **tab** (rendered inside a parent screen). Until a tabbed parent is actually built, its
children stay as flat `NAV` items pointing at the placeholder — don't invent a half-built tab
shell. When you build the parent, fold the children in as in-page tabs and collapse the menu to
the single parent entry.

---

## 5. Conventions checklist (before PR)

- [ ] Only tokens / `lux-*` classes for colour — no raw hex in the screen.
- [ ] Accents use `--primary` (verify by switching tenant colour — the screen should re-tint).
- [ ] Light **and** dark both look right.
- [ ] Loading / empty / error states present (free via `ResourceList` / `states.tsx`).
- [ ] `403` renders a permission message, not a blank/error screen.
- [ ] Headings `.font-display`, money/qty `.num`, statuses via `.status` variants.
- [ ] No extra outer padding (the shell owns `p-6`).
- [ ] RBAC action is **`edit`**, not `update` (matches the backend).
- [ ] Route added in `app.tsx` + `NAV`; `screen-registry.json` updated only when the page is real.
