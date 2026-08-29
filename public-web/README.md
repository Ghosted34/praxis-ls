# public-web — the stranger-facing app

Marketing site (`/public/*`) and external portal (`/portal/*`) for a Praxis tenant:
everything a person reads or does **without a staff account**. React 18 + Vite + TS,
its own `package.json`, its own lockfile, its own design layer — a sibling of
`client/` and `platform-console/`, not a subfolder of either.

Structure follows **maersk.com** (band rhythm, one idea per band, an oversized
tracking widget as the site's primary function, a "what happens next" list under a
form, terminal cards for the signed-in surfaces). Colour, type and voice stay
Praxis: `--primary #ff5a00` on carbon, IBM Plex Sans / Inter / JetBrains Mono,
declarative sentences. That hybrid is the brief's "close to ready" reading —
a scaffold someone can improve without redesigning.

```
/public                       marketing (bilingual EN/FR + quote form)
/public/track                 shipment tracking (also ?ref= deep links)
/public/services              published service types (live, /public/services/:slug)
/public/portfolio             client stories   (+ /public/portfolio/:slug)
/public/proposals/:token      a proposal a salesperson sent, + PDF download
/public/careers               open roles       (+ /public/careers/:token application)
/portal/login                 sign-in          /portal/set-password?token=…
/portal/*                     CLIENT · INVESTOR · AUDITOR terminals
/                             → /public        (bare root only)
```

**Legacy paths are redirected, not deleted** — `/track`, `/tracking`,
`/portfolio[/:slug]`, `/proposal/:token`, `/careers[/:token]` → `/public/*`, and
`/client-portal/*` → `/portal/*`. Query strings survive (a tracking link without
its `?ref=` is an empty form) and slugs are re-encoded. Deep links never redirect;
only the bare root does.

**Out of scope, on purpose:** `/login`, `/reset-password` (staff sign-in stays in
`client`, where every bookmark points), `/v/:code` verification and `/sign/:token`
signing. `src/server.js` never routes those here, and `src/app/app.test.tsx`
asserts this app renders no second password form for them.

## Run it

```bash
npm install --prefix public-web
npm run dev --prefix public-web        # proxies /api → VITE_API_TARGET (default :8080, the API's own PORT)
npm run build --prefix public-web      # needs the API running for /api/tenant/branding
```

`dist/` is served by the API itself when `SERVE_PUBLIC_WEB=1` and
`public-web/dist/index.html` exists (both conditions; see `src/server.js`). Locally,
without a tenant API, every page still renders: `GET /api/tenant/branding` fails and
the default dress is used, and data-driven bands fall back to their empty states.
Nothing here has a mock dataset — screens show live data or an explicit empty state,
never invented numbers.

| script                 | what it proves                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm test`             | 50 cases: the route table mounts and says the right sentence per route, i18n detection/parity, theme, intake validators |
| `npm run typecheck`    | `tsc -b` over `src`, `vite.config.ts`, `scripts`                                                                        |
| `npm run lint`         | flat ESLint (repo preset), `warn` → fail                                                                                |
| `npm run check:i18n`   | EN/FR key parity, no dangling `t()`/`tr()`, interpolation tokens, French typography (§5), no hardcoded prose in JSX     |
| `npm run check:bundle` | chunk graph acyclic, first paint ≤ 128 kB gzip                                                                          |

Both gates are also wired into CI (`frontend` matrix job). `scripts/check-fonts.mjs`
at the repo root scans `public-web/src` too, so a font family cannot be named here
without being in the library.

## Design contract (do not re-derive it)

`src/index.css` owns the tokens and the band system; `tailwind.config.ts` owns the
type ramp, `lane-*` keyframes, `band`/`gutter` spacing and the max-width set.
Classes: `.wrap .band .band-muted .band-hero .rule-top .eyebrow .micro .num
.field .track-widget .prose-site .skip-link`, utilities `text-micro|label|sm|base|
lg|title|h3|h2|h1|display|jumbo`, `p-band gap-band px-gutter`, `ok warn bad info`
(+ `-fill` variants). `--ok/--warn/--bad/--info` and `--mode-*` are bare `r g b`
triplets — write `text-warn`, never `text-[hsl(var(--warn))]`, and use `/40`
modifiers rather than `rgb(var(--x)/0.4)`.

Copy lives in exactly one place: `src/lib/i18n-dict.ts` (`site.*` for the public
pages, `portal.*` for the terminals, `strings` for `tr()`, which sentence-cases a
server enum and looks it up). `check:i18n` enforces it, which is what makes the
rule real: a literal sentence inside JSX is invisible to the dictionary and shows
up as English on a French page forever.

## What was deliberately NOT copied from `client`

These are `client` bugs found while porting. `public-web` does not reproduce them;
fixing `client` is a separate change.

1. **The marketing quote form 422s in `client`.** It posts `service_type` and
   `estimated_weight`, and `src/routes/intake.routes.js` validates `.strict()`, so a
   quote sent from the public site is rejected as a validation error. This app posts
   only fields the schema declares.
2. **`incoterm` is required by the schema but labelled optional** in the client
   form ("optional"). Labelled required here, because that is what the server does.
3. **Password rules.** `client/src/features/portal/portal-auth.tsx` checks a
   minimum of 8 characters; `src/shared/security/password-policy.js` requires 12,
   four classes, rejects the email's local part and checks HIBP. Here the copy and
   the client-side check mirror the server, so nobody types a password the API will
   refuse. (Server-side enforcement is unchanged — the client-side check is only to
   avoid a round trip.)
4. **`salaryBand()` hardcoded English** ("From", "Up to") in the careers feature →
   dictionary keys, so a French vacancy page reads « À partir de ».
5. **`{reference}` instead of `{{reference}}`** in the careers receipt copy: i18next
   prints single-brace tokens literally, so the reference never appeared in the
   confirmation. Fixed here for both languages, and `check:i18n` now rejects the
   shape anywhere in a dictionary value.

**Impossible by contract, so not invented:** `GET /branding` exposes no
`supportEmail`, `privacyPolicyUrl`, `complianceNoticeUrl`, `productName`,
`wordmark`, address or phone (`branding.service.js` `KEYS`/`LOGIN_KEYS`). The
footer and hero therefore say nothing about an office, a phone number or a policy
page — brief N12 forbids inventing facts, and a fabricated "Douala office, +237…"
line on a page a client reads before signing is exactly the kind of thing that
becomes a promise. When those keys exist, the components that want them are
`src/components/site/site-footer.tsx` and `src/lib/branding.ts` (`Branding`).

## Notes for whoever improves this next

- **Route chunking is load-bearing.** Every route is `React.lazy` against ONE
  `vendor` bucket. Adding a `manualChunks` bucket to fix an import problem will
  reintroduce the 2026-08-04 blank page (cyclic chunks throw during module
  evaluation, before React renders, so no boundary catches it). `check:bundle`
  exists to make that unmissable; read its header before touching `vite.config.ts`.
- **`tr()` on a ported screen needs the root subscription.** `main.tsx` runs one
  `useLang()` at the root precisely because `tr()` has no hook of its own — without
  it, headings re-render on a language toggle and status pills do not.
- **The mount order in `src/server.js` matters.** `client/dist` registers
  `app.get("*")`; anything mounted after it is unreachable for page requests, which
  is why `public-web` is mounted first and why its path test excludes `/api` and
  `/media` (a mistyped `/public/…` deep link must not return HTML to an SDK).
- **`SERVE_PUBLIC_WEB` is off by default** so a deployment that builds this app by
  accident cannot silently move `/track` and `/client-portal` in the same release as
  an unrelated migration.
- **Print styles are a feature**: `/public/proposals/:token` prints to PDF through
  the browser's own engine (`@media print` block in `index.css`), which is why the
  proposal page has no toolbar of its own.

## Verification status

Typecheck, lint, 50 tests, both gates and `vite build` are green locally, and the
built `dist/` was served and fetched route-by-route (every SPA route returns the
shell, and the hashed assets resolve). Two things could not be run in this workspace and are left
to CI: the Express mount (`node_modules` is absent at the repo root, so
`buildApp()` cannot boot here — `docker-build` exercises the real path), and any
screen against a live tenant API, which needs Postgres and Redis.
