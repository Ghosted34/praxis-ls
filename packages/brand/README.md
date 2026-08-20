# @praxis/brand

The colours, type and mark rules that belong to **Praxis**, in one file, so they
stop being copied.

## The boundary

There are two theming layers in this product and only one of them existed by
name before this package.

|                       | **Tenant layer**                                        | **Brand layer** (this package)                                                                                           |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Tokens                | `--primary`, `--accent`, `--secondary`, …               | `--brand-orange`, `--brand-slate`, `--brand-carbon`, …                                                                   |
| Owner                 | the tenant, via Settings → Appearance                   | Praxis. Nobody else, ever.                                                                                               |
| Overridden at runtime | yes — `client/src/lib/theme.ts` on every paint          | **no**                                                                                                                   |
| Lives in              | `client/src/index.css`                                  | `packages/brand/tokens.css`                                                                                              |
| Surfaces              | the tenant workspace, their login page, their documents | praxisls.com, the platform console, the status page, docs, the splash screen, PWA install chrome, mail from praxisls.com |

The tenant layer was always well built — deriving `--primary-ink` per tenant so a
brand colour chosen as a fill stays legible as text is more care than most ERPs
take. What was missing was anywhere to put the colours that are _ours_. With no
such place, the Praxis orange survived only as "the value a tenant hasn't
overridden yet" — which is why it ended up hand-typed in ten files.

If you ever want to write `--brand-orange: var(--primary)`, you are on a tenant
surface and should not be importing this package.

## Migrating off `#F5821F`

`#F5821F` was never the brand colour; it was the value that happened to be in
the code. The brand sheet says Optical Orange **`#FF5A00`**. These are the call
sites that still carry the old literal — each one should import from here
instead. **This is deliberately not done yet**: it touches the running app and
belongs in its own PR, separate from any marketing work.

| File                                                                                                           | What it paints                                              |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `client/src/index.css`                                                                                         | `--primary` / `--ring` defaults                             |
| `client/src/lib/theme.ts:53,70`                                                                                | the fallback when a tenant sets no colour                   |
| `client/src/features/settings/appearance-page.tsx:39-48`                                                       | the "this is what you'll get" defaults in the editor        |
| `client/src/features/settings/document-templates.tsx:74,146` · `document-templates-page.tsx:294`               | document accent                                             |
| `client/src/components/splash-screen.tsx:43-44`                                                                | first paint (also `#9aa8a6`, which is in no palette at all) |
| `src/routes/pwa.js:41` · `packages/shared/pwa-design.js:158`                                                   | generated PWA manifest `theme_color`                        |
| `src/services/documents/templates/kit.js:159` · `registry.js:1010`                                             | PDF template accent                                         |
| `src/modules/portal_auth/portal_auth.service.js:129` · `src/modules/security/app_user/app_user.service.js:590` | mail shells                                                 |
| `scripts/tenant/seed-branding.js` (×3)                                                                         | the seed a new tenant starts from                           |
| `platform-console/src/styles.css:2,7,44`                                                                       | console chrome                                              |

Two things to get right while doing it, both of which will otherwise ship a
regression:

1. **`--primary-foreground: white` cannot come along.** White on `#FF5A00`
   measures **3.13:1** and fails AA at body sizes. Use `onOrange` (carbon,
   **6.33:1**). The platform console already did this correctly
   (`.btn.primary { color: #1c1204 }`); the tenant app did not.
2. **The blue is not brand.** `#1C9BD7` / `#0C4A7A` / `#34AAE2` / `#1884C4` had
   become a de-facto second brand colour — `--brand-2` in the console, plus
   every link, focus ring and `.btn-link`, over a background that gradients
   orange _and_ blue. The brand is three colours. Blue survives only as
   `status.info*`, re-derived to pass as text.

`scripts/tenant/seed-branding.js` is the one place where the old value may
legitimately stay: it seeds a _tenant's_ palette, and a tenant's default being
Praxis orange is a product decision, not a brand rule.

## How these values were derived

Every contrast figure in `index.js` and `tokens.css` is measured, not estimated,
using the `contrast()` function this package exports — so the guarantees are
testable rather than asserted:

```js
const { contrast, palette, onOrange } = require("@praxis/brand");
contrast("#FFFFFF", palette.orange); // 3.13  ← fails AA
contrast(onOrange, palette.orange); // 6.33  ← passes
```

The inks were derived the same way `client/src/lib/theme.ts` derives
`--primary-ink`: hold the hue, walk toward black (light theme) or white (dark
theme) until the colour clears 4.5:1 against **both** surfaces of that theme —
the card and the page background — and stop at the first value that does.

The one asymmetry worth internalising: **on dark grounds the brand orange
already passes as text** (6.33:1 on carbon), so there is nothing to step down.
On light grounds it does not, and `#C74600` is where it clears. That asymmetry
is a large part of why dark is the primary expression rather than a preference.

If you change a value here, re-run the check and update the comment in the same
edit. A stale contrast comment is worse than none — it is the thing someone will
trust instead of measuring.
