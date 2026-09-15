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

## The experience layer, and why this app's rules differ

This app is granted an **express exception from the tenant-application design
doctrine**, and if you have come here from `client/` that will look like a
contradiction. It is written down in
`doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md` §1; the short version:

`public-web` is the surface by which a tenant is judged by people who have never
met them. The ERP is an instrument for someone who opens the same table forty
times a day, and every motion rule there exists to protect that person from
decoration they have to sit through. Nobody sits through this app: a visitor
arrives once, decides in seconds, and leaves. Impression is the job.

`client/scripts/check-motion.mjs` already said so, before this exception existed
— it carves out "the front door … the only place in this product where
'impression' is the job". This app is that surface, so the carve-out became the
rule here and got a gate of its own.

**What actually differs:**

| | ERP | here |
| --- | --- | --- |
| Motion | 250 ms, everything | 200 ms for response · 600 ms for entrance · unbounded for scroll-linked, by named exemption |
| Decorative motion | forbidden | expected |
| Payload | as needed | **128 kB gzip first paint, unchanged** |

**What does not differ, and has no exception anywhere:** reduced motion renders
the *settled* state (never a faster animation), WCAG AA in both themes, full
keyboard operation, no raw palette colours, no native dialogs, and nothing on
the page asserts a fact the tenant's own data does not carry.

### The gates that hold that second list up

Run from this directory. `npm run ci` at the repo root runs all of them in CI's
own order, along with everything else.

```
npm run lint            # includes the a11y rules and the native-dialog ban
npm run check:motion    # the two budgets, the exemption list, and the
                        # reduced-motion umbrella — per-block, brace-matched
npm run check:i18n      # both languages, French typography, no prose in JSX
npm run check:assets    # §1.3's provenance/slot rule, byte caps, bilingual alt
npm run check:palette   # no raw palette colours (the ONE copy, in client/scripts)
npm run check:bundle    # acyclic chunks · 128 kB first paint · 220 kB deferred
npm test
```

`check:contrast` is **missing** and should be here. §5.6 assigned it to PR 1,
PR 1 did not ship it, and the guide's §3.4 (F-15) records what it would have
caught: the tenant's primary CTA sitting at 3.13:1 on every page of this app.

### Two things that are easy to get wrong here

**The hero is the LCP element.** Nothing on its path may wait for a lazy import,
and nothing decorative may paint before it. `StagedLines` takes
`paintImmediately` for exactly this reason — text at `opacity: 0` is not
painted, so a headline that fades in delays the page's largest paint by its own
entrance. PR 4 gives every page a hero, so every page inherits this.

**Anything that reads layout or opens a connection on mount belongs behind
`lib/after-paint.ts`,** unless the visitor is actually waiting for it. The hero's
canvas, the announcements read and the corridor read are all deferred; doing
them eagerly cost 301 ms of forced reflow behind the element they decorate.

**The pieces:**

- `src/lib/motion.ts` — scroll scrub, pointer-as-light, device tilt, proximity.
  They write CSS custom properties and never React state; a scrub through
  `setState` re-renders sixty times a second and is why marketing pages stutter
  on the mid-range Android this app exists for.
- `src/components/ui/type.tsx` — type as a material. Staged headlines, weight
  that responds to scroll, pull-quotes, figure callouts.
- `src/index.css` — one stated light source (top-left, 60°), a six-step
  elevation scale where each level is a contact shadow *plus* an ambient shadow
  *plus* a light-catch, and material tokens.
- `src/fonts.css` — the four faces, subset to `latin` + `latin-ext` only.
- `scripts/check-motion.mjs` — the budget, the exemption list with reasons, and
  a per-block assertion that the reduced-motion umbrella is intact.
- `packages/shared/design/palette.js` — the tenant palette engine. Not bundled
  here: it runs on the server and its output arrives as tokens.

**Adding motion?** Put the duration in a token, name the selector in the gate's
`NARRATIVE` or `EXEMPT` list *with a reason* if it needs more than 200 ms, and
run `npm run check:motion`. Raising a number without a reason is the thing the
gate exists to make visible.

## Verification status

Typecheck, lint, 50 tests, both gates and `vite build` are green locally, and the
built `dist/` was served and fetched route-by-route (every SPA route returns the
shell, and the hashed assets resolve). Two things could not be run in this workspace and are left
to CI: the Express mount (`node_modules` is absent at the repo root, so
`buildApp()` cannot boot here — `docker-build` exercises the real path), and any
screen against a live tenant API, which needs Postgres and Redis.
