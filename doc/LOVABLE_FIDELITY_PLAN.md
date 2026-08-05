# Lovable UI-Fidelity Plan — full app redesign to the reference mock

> ## ⚠ SUPERSEDED — see `doc/FRONTEND_GUIDE.md`
>
> Shipped in session 15, then largely reversed by Phase 1: F17 found the mock's visual language was "a coherent aesthetic aimed at the wrong category", and the display serif, mesh gradient, glow shadows and 500ms entrances are gone.
>
> This file is kept for the history it holds. **Where it disagrees with
> `doc/FRONTEND_GUIDE.md`, the guide wins.** Do not add to this file; add to the guide.
> (Phase 5 of `doc/DESKTOP_UI_AUDIT.md`, closing F15: six overlapping frontend plans, and
> "a new engineer cannot tell which is current — and the one that reads most authoritative
> is the one that's wrong".)

_Drafted 2026-07-22 (session 12). Status: **DONE — kit restyle shipped in session 15 (2026-07-27).**_

> **Session 15 update.** The full kit restyle below is implemented. `index.css` (font-display w400,
> `--ease`/`--dur`, `fadeUp`+`modalRise`, global reduced-motion, `.chip*`/`.sec*`, `.btn-primary`/
> `.btn-surface`), `button.tsx`, `table.tsx`+`data-list.tsx` (tablecard, orange row hover, micro header,
> **+ mobile card fallback**), `kpi-tile.tsx` (icon square + serif value + delta), `modal.tsx`+`input.tsx`
> (radius/rise/border-tint focus), and the `Chips`/`Segmented` + every hand-rolled filter/nav pill row are
> converted. Serif `font-semibold` stripped app-wide. All colours track `--primary` via `color-mix` so
> tenant re-tint still works. Verified in-sandbox: `tsc -b` + Tailwind compile clean; Windows
> `npm run build`/side-by-side screenshots still owed (the Definition of Done). The original plan follows
> for reference.

---

## Goal

Close the visual gap between the deployed app and the Lovable reference
(`doc/reference/reference-mock-lovable` — the visual SSOT). The user compared the two
side-by-side in production: same bones (fonts, orange, layout DNA) but the reference reads
"mature" because of detail-level differences in the shared kit. **Strategy: restyle the
shared kit, not individual screens** — the app is fully token + kit driven, so fixing
`index.css` + `components/ui/*` re-skins every screen at once. Appearance settings keep
working untouched: everything stays on the CSS-variable tokens that `theme.ts applyBrand()`
overrides per tenant.

## Source of truth

- **`doc/reference/reference-mock-lovable/src/lib/dashboard/style.css.txt`** — the complete
  design system (tokens + every component pattern). Line refs below point here.
- `body.html.txt` / `script.js.txt` beside it — markup patterns and interactions.
- Per project convention: before restyling an area's screens, read that area's `v-<area>`
  section in the mock.

## Audit — exact reference values vs our kit

Token names map 1:1 (our `index.css` was derived from this file), so the drift is in
**component measurements**, not palette. The deltas that matter, with reference values:

### 1. Display typography — THE big one
Reference uses **Playfair Display at `font-weight: 400` everywhere** (`.htitle`, `.sec h2`,
`.kpi .kv`, modal `h3`, panel headers — all `font-weight: 400`). Our screens pair
`font-display` with Tailwind `font-semibold`/`font-medium`, which renders a heavier serif
and changes the whole personality.
**Fix:** in `client/src/index.css`, make `.font-display` enforce `font-weight: 400`
(`!important` is acceptable here — the reference never uses a heavier serif), then remove
now-redundant `font-semibold` from headings as they're touched. Title sizes: page hero
`clamp(32px,4.4vw,52px)` (`.htitle`), section headers `21px` (`.sec h2`), card/panel
headers `16–18px`.

### 2. Buttons (`.btn`, style.css ~110–113)
Reference: `padding 10px 17px; border-radius 11px; font-size 13px; font-weight 600;`
surface bg + `--line` border + `--shadow-s`; hover = `translateY(-1px)` + `--shadow-m` +
`border-color: rgb(var(--orange)/0.4)`. **Primary** = `linear-gradient(135deg,
rgb(--orange), rgb(--orange-deep))`, white text, `box-shadow: 0 8px 20px
rgb(--orange/0.35)` (the orange glow).
**Fix:** `components/ui/button.tsx` — replace the flat shadcn variants with these values,
mapped onto `--primary`/`--brand-orange-deep` tokens (NOT hardcoded orange) so tenant
re-tinting keeps working.

### 3. Tables (`table.data`, ~289–295)
Reference: header `9.5px` uppercase `tracking 0.14em` on `--surface-2` background; cells
`padding 14px 16px; font-size 13px`; row borders `rgb(--line/0.05)` (much fainter than
ours); row hover `rgb(--orange/0.04)` (orange-tinted, not grey); last row borderless;
wrapper `.tablecard` = radius 16 + overflow hidden.
**Fix:** `components/ui/table.tsx` (TH/TD/TR/Table). TH nowrap is already done.

### 4. KPI tiles (`.kpi`, ~231–242)
Reference: `padding 18px 20px; radius 16`; a 38px rounded **icon square** tinted
`rgb(--orange/0.12)`; label = micro 10px `tracking 0.16em`; **value = serif 30px weight
400**; optional delta line (`.kd.up/.down` in ok/bad); hover `translateY(-3px)` +
`--shadow-m`. Ours is a flat half-height card with a gradient top edge.
**Fix:** `components/ui/kpi-tile.tsx` — accept optional `icon` (already in props) and
`delta`; render to the reference recipe.

### 5. Chips (`.chip`, ~282–285)
Reference: `padding 8px 14px; radius 10px; font 12.5px/600`; surface bg + line border +
`--shadow-s`; hover `translateY(-1px)`; active = `rgb(--orange/0.12)` bg +
`rgb(--orange/0.3)` border + orange-ink text; count badge = tiny 999px pill on
`rgb(--ink/0.07)`.
**Fix:** add `.chip`/`.chip.on`/`.chip .ct` classes to `index.css`; convert the hand-rolled
chip rows in `features/operations/pages.tsx`, `features/finance/hub.tsx`, and the shared
`Chips` in `features/sales/ui.tsx`.

### 6. Modals (`.modal`, ~335 + 452–457)
Reference: `radius 22px`, `--shadow-l`, `rise 0.28s` entrance, header title serif w400 with
meta pills, body padding `20px 24px 24px`.
**Fix:** `components/ui/modal.tsx` (also owns `Field`/`Select`).

### 7. Inputs/Selects (~287, 573–574)
Reference: surface bg (not transparent), line border, `radius 10px`, `font 13px`, focus =
`border-color rgb(--orange/0.5)` (border tint, no ring offset).
**Fix:** `components/ui/input.tsx` + `Select` in `modal.tsx` (keep the dark-mode option
colours fix).

### 8. Section headers (`.sec`, ~245–248)
Serif 21px w400 + a 1px `--line` rule filling the remaining width + optional orange-ink
link right. Add a small `SectionHeader` component or `.sec` classes; adopt in hub overview
pages.

### 9. Segmented control (`.seg`, ~151–154)
`padding 3px; radius 10`; buttons `5px 11px; radius 7; font 11px/700`; active = surface bg
+ shadow + orange-ink text. Restyle `Segmented` in `features/sales/ui.tsx`.

### 10. Motion
`--ease: cubic-bezier(0.16,1,0.3,1); --dur 0.3s`; cards/tables enter with
`fadeUp .55s both`; hover lifts (−1px buttons/chips, −3px KPIs). Add the keyframes +
`--ease`/`--dur` to `index.css` and use in the restyled components.
`prefers-reduced-motion: reduce` kills all of it (reference does this globally — copy it).

## Already done (session 12 quick pass — don't redo)

- `Pill` humanizes string children (`enumLabel`); `.status` pills already have the dot.
- `TH` whitespace-nowrap; ops-list key columns nowrap.
- `money0()` for columns whose header carries the currency; zero → "—".
- Ops milestone cell: "No milestones yet" instead of empty bar + 0%.
- Branding seed (`scripts/tenant/seed-branding.js`): Lovable palette + login hero.

## Suggested execution order (each step is shippable alone)

1. **`index.css`**: `.font-display` w400, `--ease`/`--dur`, `fadeUp`, `.chip*`, `.sec*`
   classes. Biggest visible win, zero component API changes.
2. **`button.tsx`** — the primary-gradient button appears on every screen.
3. **`table.tsx`** + `data-list.tsx` (`.tablecard` wrapper, header bg, orange row hover).
4. **`kpi-tile.tsx`** (icon square + serif value + delta).
5. **`modal.tsx`** + `input.tsx` (forms).
6. Chip/Segmented conversions (ops page, finance hub, sales/ui).
7. Per-area screen pass against the mock's `v-<area>` markup (layout/spacing only —
   components are now right by construction). Start with Operations.

## Constraints — read before coding

- **Tokens only.** Never hardcode the orange/blue — use `--primary`,
  `--brand-orange-deep`, `--ok/--warn/--bad`, `--ink-*`, `--surface-*` so Appearance
  re-tinting keeps working. The reference's `--orange` IS our `--primary` post-branding.
- **Radius is tenant-overridable** (`--radius` via Appearance) — reference values (16/11px)
  become the *defaults*, expressed relative to `var(--radius)` where sane.
- **Two hub idioms exist** (FinanceHub-shaped vs `TabbedHub`) — restyle shared pieces, do
  not unify hubs in this wave.
- **`ResourceList` renders `<HubTabs/>`** (colleague's invariant) — table restyle must not
  break it.
- **Windows validators are authoritative** (`npm run lint` / `npm test` /
  `npm run build --prefix client`); the CI pipeline now also typechecks the client on every
  push, and merged work auto-deploys — small shippable steps, please.
- Screens must stay legible in **both light and dark** — the reference defines both token
  sets; ours already mirror them.

## Definition of done

Side-by-side of the deployed app vs the Lovable app on: Operations list, Finance hub,
Control Tower, a modal form, and the login/landing — no obvious "which one is the
prototype" tell. Screenshot pairs attached to the PR.
