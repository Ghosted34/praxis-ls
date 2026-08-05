# Typography — the font library, the picker, and the two appearance layers

Everything the ERP renders type with is decided by three CSS variables:
`--font-display`, `--font-body`, `--font-mono`. `client/src/index.css` binds
them to `body` and to the ~35 `.font-display` call sites, so setting them once
changes every screen. This document is about who gets to set them, and with
what.

## The library

`client/src/lib/fonts.ts` is the closed set of fifteen families the product
ships. All fifteen are self-hosted through `@fontsource` under SIL OFL or
Apache-2.0, which is the whole point: **what a tenant picks is what every user
renders, on every device.**

| Sans | Serif | Mono |
| --- | --- | --- |
| Inter · Roboto · Noto Sans · Plus Jakarta Sans · IBM Plex Sans · Work Sans · Open Sans · Public Sans · Montserrat · Source Sans 3 · Lato | Lora · Merriweather | JetBrains Mono · Cascadia Code |

### Why Segoe UI, SF Pro and Helvetica Neue are not in it

They are proprietary — Microsoft, Apple and Monotype — and cannot be
redistributed. Listing them would mean shipping a name that renders natively on
one OS and silently substitutes on every other, which is the failure this
library exists to end. **Noto Sans, Plus Jakarta Sans and Work Sans** stand in
for them respectively.

Note that the sans fallback stack still leads with `system-ui`, which is the
licence-clean way to reach Segoe UI on Windows and SF Pro on Apple platforms:
the OS picks its own face and nothing is redistributed.

### What is persisted

The **CSS stack string**, not the id — the same value the free-text boxes wrote
before the library existed, so no data migration was needed.
`fontByValue()` resolves a stored string back to a library entry by matching its
first family, which is what makes pre-library data correct rather than merely
preserved: a tenant who typed `"Montserrat", Georgia, serif` now resolves to
Montserrat and loads the real webfont, where before the browser found no
Montserrat installed and quietly rendered Georgia.

A stack that matches nothing is kept and shown as **Custom**. It is never
rewritten — opening a settings screen must not change a setting.

### Loading is lazy, and that is enforced in three places

1. `loadFonts()` pulls only the families the active stacks name — at most three
   of fifteen — and is called from the branding context on every paint.
2. `vite.config.ts` excludes `@fontsource` from the `vendor` bucket, so Rollup
   attaches each family to the dynamic import that pulls it. Left in `vendor`
   they all landed in the eagerly-loaded stylesheet: 96 `@font-face` rules and
   57 kB of render-blocking CSS on every page load.
3. The service worker does **not** precache `woff2`. It used to, which was right
   for one bundled family and became wrong at fifteen — the SW would have
   downloaded 2.8 MB on install for every user to serve the three actually in
   use. Fonts are cached `CacheFirst` at runtime instead, so the offline promise
   still holds for the fonts a user has in force; it is earned on first paint
   rather than prepaid for all fifteen.

Only Inter is in the startup bundle (statically imported by `main.tsx`), because
it is the default every unbranded tenant falls back to.

## The picker

`client/src/components/settings/font-picker.tsx`. A controlled input over one
CSS font-family string — it knows nothing about tenants, users or endpoints, so
the same component serves both editors below without a variant or a flag.

**Every font name renders in its own face.** That is the point of the control,
not a flourish: reading "Merriweather" set in Merriweather tells you what you
are choosing. It is why mounting the picker loads the whole library, and it is
asserted in `font-picker.test.tsx` — if that test ever fails, the control has
degraded into a styled version of the text box it replaced.

Options are grouped Sans / Serif / Monospace via the shared `Select`'s optional
`group` field. Every slot offers all fifteen; the group that suits the slot
leads. There is a collapsed escape hatch for a raw custom stack, for the tenant
who eventually turns up with a licensed corporate typeface on their own CDN.

## Two layers: tenant, then user

| | Tenant appearance | My appearance |
| --- | --- | --- |
| Screen | `/appearance` | `/my-appearance` |
| Who | Settings edit (MOD-70) | any signed-in user, self-service |
| API | `PUT /branding` | `PUT /me/preferences/appearance` |
| Storage | `setting` (section `appearance`) | `user_preference` (0496) |
| Scope | colours, logos, favicon, type, radius, theme | **type only** |

The user layer overrides the tenant's fonts **for that user only**, and follows
them to any device they sign in on. Colour, logo and favicon are deliberately
not user-overridable — those are the company's identity, and letting a user
restyle them means two people on a call disagreeing about what the product looks
like, and support screenshots you cannot trust. The allow-list in
`preference.service.js` is that boundary, and it is tested.

### Precedence

`branding-context.tsx` merges both layers in one place, `resolveFonts()`:
the user's value if set, the tenant's otherwise. Merging at a single point is
what keeps a partial override honest — a user who overrides only the body font
keeps *tracking* the tenant on display and mono, rather than freezing at
whatever those were the day they saved.

`absent ≠ null` runs the whole way down: an omitted key in a `PUT` is left
alone, an explicit `null` deletes the row and restores inheritance. There is no
third state, and no row ever stores a copy of the tenant's current value.

### Why the personal layer is not applied before login

It cannot be — the server will not say who you are without a token. The login
screen is always the tenant's type, and the user's own takes over on the first
authenticated paint. `UserAppearanceSync` sits inside `AuthProvider` (where both
auth and branding are readable) and pushes the result up. Caching a user's fonts
in `localStorage` to paint them pre-auth was rejected: it paints one person's
preference before you know who is at the keyboard, which is wrong on a shared
terminal.

## Adding a family

1. `npm i @fontsource-variable/<family>` in `client/`.
2. Add a `FontDef` to `FONTS` in `lib/fonts.ts`. Confirm the declared family
   name from the package's `index.css` — variable packages declare
   `'<Name> Variable'`, **with a space**. Getting this wrong is silent: the app
   downloads the font and renders the fallback, which is exactly what
   `--font-display` did for months by asking for `"InterVariable"`.
3. `fonts.test.ts` asserts the count; update it deliberately.
4. Confirm the family is OFL/Apache-2.0. A font we cannot redistribute does not
   belong in a picker that promises identical rendering everywhere.
