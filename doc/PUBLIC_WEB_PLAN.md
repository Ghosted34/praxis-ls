# The tenant public website — build plan

**Status:** draft for review. Nothing here is built yet except where marked ✅.
**Audience:** anyone picking up one of the five workstreams below.
**Read §3 before you write a line of code**, whichever workstream you have. It is
the part that makes five people building five things produce one system instead
of five.

---

## 1. The one rule

**We are not porting smartls.cm. We are replacing it with something it cannot be.**

SmartLS's current site (six pages, PHP, Bootstrap 5.3) is a genuinely good
marketing site. It is also almost entirely **hardcoded HTML**: five Kaizen
articles are `<div>`s, the services are `<div>`s, the testimonials are `<div>`s,
and the headline statistics are literals — `data-counter="41850"`. Four PHP
endpoints are the only living things on it: tracking, quote, contact,
partnership.

"Better" means three things at once, and none of them is optional:

1. **Prettier.** Their design is good; ours has to be visibly better, not merely
   equivalent. Design quality is a shipping requirement, not a finishing touch.
2. **More capable.** Every page should do more than its counterpart does.
3. **Wired to the ERP.** The page *knows things*, because it is rendered by the
   system that already holds the answers.

If a decision in your workstream comes down to "match their page" versus "use
what the ERP knows", **use what the ERP knows** and note the divergence in your
PR.

---

## 2. What we are competing with

### What their site does well — keep these

- Clear IA: Home · Services · Insights · Smart Track · About · GET A QUOTE.
  (their "Kaizen Hub" is renamed **Insights** — ours, and the display label.)
- Tracking is the hero CTA. The home hero is a reference input that hands off to
  `smart-track?ref=…`. That instinct is right; a logistics customer's first
  question is "where is my cargo".
- Bilingual EN/FR throughout.
- Trust furniture that earns its place: 22 client logos (UNFPA, WFP, MINUSCA,
  Maersk, CMA CGM, DHL, Tata, L&T, GIZ, PAD), three named testimonials with real
  roles, five corporate policies.
- A four-step quote wizard rather than one intimidating form.

### Three failures that repeat on every page

These are systemic, so we fix them **once, in the shared layer** (§3), not five
times:

1. **`alert()` is the error state.** A bad tracking reference, a failed quote
   submission, a network blip — all surface as a browser alert. There is no
   designed failure anywhere on the site.
2. **There are no empty states.** Filter the insights grid to nothing and you get a
   blank page with no message. Track a reference with no milestones and you get
   one grey row.
3. **There is no structured data.** No `Organization`, no `Article`, no
   `Service`, no `BreadcrumbList`, anywhere. For a business whose buyers search,
   this is the cheapest win on the table and it is entirely unclaimed.

### One thing we must not copy

Their public tracking page prints the client's name — `L&T Power Transmission &
Distribution` — on a URL keyed only by a shipment reference. Anyone who guesses
or is forwarded a reference learns who the shipper is. `tracking_public.service`
already withholds this deliberately; its comment says internal status, forecast,
health, delay attribution and cause notes "are never copied into the response".

**Default: we do not expose the client name.** See §6.

---

## 3. Shared conventions — MANDATORY

### 3.1 Where the site lives

Decided already, implemented in `src/server.js`:

| Host | Serves |
|---|---|
| `<tenant>.praxisls.com` | ERP at root. **Unchanged. Do not move it.** |
| `<tenant>.praxisls.com/public` | public site on a workspace host, behind `SERVE_PUBLIC_WEB` |
| a tenant's own domain (`surface='public'`) | public site at **root**, no ERP |

`public_base` (default `/public`) is per-host, in `platform.subdomain`.

**Never hardcode `/public`.** Build every internal link from the resolved base.
The same bundle serves at `/public` on a workspace host and at `/` on a custom
domain; a hardcoded prefix means rewriting every link the day a client buys a
domain, and losing whatever indexing we had.

### 3.2 Language and URLs

Theirs is a client-side `data-i18n` swap: one URL, JS rewrites the text. Google
therefore only ever indexes one language, and a French page cannot be linked to.

**Ours serves real URLs per language** — `/{lang}/…` with `lang` in `fr|en` —
with `<link rel="alternate" hreflang>` between them and a self-referencing
canonical. Our model is already bilingual to the column (`*_fr` / `*_en`
everywhere in `service_type_web_profile`), so this costs us almost nothing and is
a thing their site cannot do without a rebuild.

FR is the default for a Cameroonian tenant. The tenant's default language is
config, not a constant.

### 3.3 The state vocabulary

This is the piece the whole system shares, including the client portal.
`tracking_public` already names the first three; **use these words everywhere**,
in code and in the UI copy:

| State | Meaning | Where it comes from |
|---|---|---|
| `COMPLETED` | done, in the past | `public_state` |
| `CURRENT` | happening now | `public_state` |
| `UPCOMING` | not yet reached | `public_state` |
| `CLOSED` | the whole thing is finished | `computed_status === "COMPLETED"` |

Plus four presentation states every list, panel and form must implement:

| State | Requirement |
|---|---|
| **loading** | a skeleton of the real shape. Never a spinner on a blank page. |
| **empty** | says what is missing, and offers the next action. Never a blank region. |
| **not-found** | distinct from empty. "No shipment matches that reference" ≠ "this shipment has no milestones yet". |
| **error** | inline, retryable, with the request id. **Never `alert()`.** |

Build these as shared components in `public-web/src/components/state/` before
building any page that needs them. Whoever gets to them first owns them; the rest
import.

### 3.4 Design tokens

Take SmartLS's palette as the tenant's brand, but **tokenised, never inline**:

```
--brand-primary      #055B83   deep blue
--brand-primary-2    #1F99D8   light blue
--brand-accent       #EE7D04   orange — CTAs
--brand-success      #2ECC71   green
--brand-ink          charcoal  footer, body
```

Headings Montserrat 600–800, body Manrope 300–700 — again as tenant config, not
constants. Another tenant gets different values and the same components.

Density: the request from the field is roughly **10% tighter than the current
ERP**. Set that once at the root (`font-size: 93.75%` on `:root`, i.e. 15px base)
and let everything inherit; do not hand-tune component sizes.

### 3.5 Media

**Do not serve public images through `/media`.** That route returns signed,
expiring, `Cache-Control: private` URLs (`src/server.js`, `storage.signedUrl`).
On a public page that means images that expire out of Google's index, no CDN
caching, and broken social previews.

`service_type_web_public` already models the correct pattern: a dedicated
`/public/…/media/:id` route with a fail-closed allowlist re-check, a one-year
immutable cache header and an ETag. **Copy that pattern.** Read
`service_type_web_public.routes.js` before adding any public media route.

### 3.6 Forms

`public_intake` already gives you, for free:

- rate limiting, 5/hour per form
- a honeypot (`website_url` must be empty)
- a time trap (`form_started_at`; submissions under 1.5s are rejected)
- Zod `.strict()` — unknown fields are rejected, not ignored

**Use it. Do not write a new public form endpoint.** If a field is missing, add
it to the schema.

Client-side rules:

- Every `required` attribute must be backed by real validation. On their site the
  form is `onsubmit="return false;"` and submits from a button `onclick`, so
  native validation never runs and every `required` on the page is decorative.
- Validate email as an email, not as "not empty".
- Enforce upload limits client-side as well as server-side. Their page states
  "Max 10MB" and never checks.

### 3.7 SEO baseline

Every public page ships with, no exceptions:

- server-rendered `<title>`, meta description, canonical, OG and Twitter tags —
  `shared/http/public-head.js` already does this; extend it, don't bypass it
- `hreflang` alternates per §3.2
- JSON-LD: `Organization` sitewide, `Service` on service pages, `Article` on
  insights, `BreadcrumbList` on anything nested
- `robots.txt` and `sitemap.xml` per host — already implemented in `server.js`
- **`noindex` on any staging host.** `staging.smartls.cm` must never be indexed;
  a staging copy competing with production is worse than no staging at all.

---

## 4. Workstreams

Each is independently shippable. 1–3 do not depend on 4.

### WS1 — Tracking ✅ backend exists

**Endpoint:** `GET /api/tenant/public/tracking/:reference` — `feature: null`, so
it works today regardless of the `website` package flag. Rate limited 30/15min.

**Returns:** `reference`, `computed_status`, `current_stage`, `origin`,
`destination`, `progress {completed, total, percent}`, `milestones[]` with
`public_state`, `is_complete`, `is_current`, `due_date`, `completed_at`,
`location`, `stage_reference`, `progress_note`.

**Add to the payload:** `service_type` (drives the mode icon) and `last_update`
(derive from the latest `completed_at`).

**Build:**
- reference input, and the `?ref=` handoff from a hero input on any page
- the four milestone states of §3.3, designed — not three CSS classes on one row
- a progress bar from `progress.percent` — **their site cannot draw this**, it
  has no such field
- not-found / empty / error per §3.3

**Do not:** expose the client name (§6), invent DELAYED/RISK/DUE badges (§6), or
use `alert()`.

**Acceptance:** a valid reference renders; an unknown reference renders a
designed not-found, not an alert; a reference with no milestones renders a
designed empty state; the API being down renders a retryable inline error; every
state is reachable in Storybook or an equivalent fixture page.

### WS2 — Intake ✅ backend exists

**Endpoints:** `POST /api/tenant/public/intake/{quote-requests,contact-enquiries,partnerships,newsletter}` — `feature: null`.

Covers all four of their forms. Three of the four can be wired with no schema
change at all.

**Two blockers on the quote form:**

1. `incoterm` is the **only required field** in the quote schema
   (`z.string().min(1).max(30)`), and their wizard never asks for it. A port
   would 422 on every submission. **Decide:** add an Incoterm field (natural for
   freight, N/A for warehousing) or relax it to optional. Recommend adding it —
   it is a real datum a forwarder needs, and asking for it signals competence.
2. **No file upload.** The route takes JSON and the validator is `.strict()`.
   Supporting an attachment means a multipart path plus vault storage.

**Add to the quote schema:** `estimated_weight`, `project_cargo_flag`,
`warehouse_location`, `warehouse_duration`, `additional_notes`.

**Build:** the four-step wizard — Need → Route → Details → Contact — with their
good ideas kept (branching labels per mode: Airport/Port/Place of Loading;
warehouse branch; project-cargo toggle; step dots that navigate back to completed
steps).

**Improve on theirs:**
- **Make the attachment optional.** Requiring a commercial invoice before someone
  can ask a price loses every prospect who is still shopping.
- Real validation per §3.6.
- Persist wizard state so a refresh does not wipe four steps of input.
- Designed error states, not `alert()`.
- **Decide on geocoding.** Theirs calls `photon.komoot.io` — an unkeyed public
  instance, every keystroke of a prospect's route sent to a third party — and
  then never submits the coordinates it captures. Either send lat/lng and use
  them, or drop the dependency and take plain text.

**Acceptance:** all four forms submit against the real endpoints; validation
failures are inline and specific; the honeypot and time trap are wired; a
submission returns and displays the reference the API generates.

### WS3 — Services

**Endpoint:** `GET /api/tenant/public/services` and `/:slug` — **gated on
`feature: "website"`**, which is `default_state = 'off'` by design
(`migrations/seeds/9116_seed_website_feature.sql`). To enable for a tenant:
platform console → Tenant → **Migrate** (projects `feature_state`), then toggle
`website` on. Until both, this 403s.

**The one structural gap:** `publicList` returns a **flat array**. Their page is
three named pillars — Freight Solutions / Logistics Solutions / Value-Added —
with anchors and jump links. `service_type` has no grouping column
(`key`, `name_fr/en`, `territory`, `is_system`, `is_active`), and `territory` is
an operational axis, not a marketing taxonomy.

**Migration:** `service_type_web_group` (key, `name_fr/en`, `sort_order`,
optional icon) + nullable `group_id` on `service_type_web_profile`; group in
`publicList`.

**Also add:** a single emphasised claim per service (their `kv` line — *"average
48-hour clearance time"*), and an accent token per service.

**We are already ahead here.** `service_type_web_profile` has `coverage_*`, FAQ,
gallery, video and related services; their page has none of them. Use them —
that is the argument for switching, not parity.

### WS4 — Site content (Home + About)

The largest piece, and the one with no backend at all yet.

**Not a page builder.** A fixed library of **typed blocks**, ordered per page,
each with defined bilingual fields. About is the page most likely to vary between
tenants, which is exactly why blocks rather than one rigid schema.

Block library, derived from their two pages:

| Block | Fields |
|---|---|
| `hero` | kicker, title, lead, background image, optional inline tracking input, CTA |
| `stat_chips` | n × {label, value} — About's Founded/Base/Focus |
| `stat_counters` | n × {label, value, unit, sublabel, icon} |
| `logo_strip` | title + ordered logos |
| `feature_list` | n × {icon, title, text} |
| `card_grid` | n × {icon, title, text, image, claim} — industries, pillars |
| `text_image` | eyebrow, rich text, image, caption |
| `two_column_values` | mission/vision, or any label + rich text pair |
| `leader_message` | photo, name, role, org, rich text, signature |
| `pillar_framework` | 3 × {letter, title, text, bullets} — E/S/G generalises |
| `testimonials` | n × {initials, name, role, quote} |
| `form_block` | which `public_intake` form to render |
| `contact_block` | address, phone, WhatsApp, email, map coords |
| `cta_band` | title + button |
| `policies` | n × {title, rich text} → PDF |

**The differentiator, and the point of the whole project:** `stat_counters`
binds to a **live ERP metric** instead of a literal. They hardcode `41850` CBM,
`72` hours clearance, `123433` miles. We hold the dossiers.

A block stores a `metric_key` naming an entry in `site_content.metrics.js`. It
never stores a query, a table and column, or a filter — every one of those is
arbitrary execution driven by tenant-editable content. An unregistered key is
refused at save time. The literal stays required as the fallback.

**Settled 2026-08-30.** All read `dossier_visible` (never `dossier` — the view
excludes DRAFT, and its own comment says to read from it for anything that
enumerates), all are all-time, all filtered to `COMPLETED`. All-time-completed
is the only series that cannot go *down* between two visits, and a counter that
falls reads as a bug to a visitor. An open file is work in progress, not a
delivered result.

| Key | Is |
|---|---|
| `dossiers.volume_cbm_total` | `SUM(volume_cbm)` over completed files. The equivalent of their 41,850. NULL volumes contribute nothing rather than zero — a brokerage-only file moved no cargo. |
| `dossiers.completed_count` | Files delivered. |
| `clients.served_count` | `COUNT(DISTINCT client_id)` — claims breadth, so repeat business counts once. |
| `services.published_count` | How many services the tenant publishes. |

**Two are deliberately absent and must not be guessed:**

- **Distance covered.** There is no distance anywhere in the tenant schema. The
  only such column in the database is `attendance_log.distance_m`, which is HR
  geofencing. It stays a literal until routes carry a distance.
- **Average clearance time.** Computable from `milestone_instance.completed_at`,
  but only once operations names the two milestone codes it runs between — and
  those differ per service type; the clearance clock on an air import is not the
  one on a hinterland transit. The mechanism is in place; add the metric when
  the pair is named.

A wrong number on a client's public page is worse than a literal somebody chose
on purpose.

**Policies:** they generate PDFs client-side with html2pdf (an html2canvas
screenshot). We render PDFs server-side with Puppeteer. Ours should be properly
typeset documents.

### WS4b — Success stories and Careers

Both already exist as public modules and neither is in SmartLS's current site,
so they are additions rather than replacements:

| Page | Module | Gate |
|---|---|---|
| Success stories | `sales/success_story` → `/public/success-stories` | `feature: null` |
| Careers | `hr/careers` → `/public/careers` | `feature: null` |

**They follow the patterns, they do not invent any.** Same shared components of
§3.3, same media rules of §3.5, same per-language URLs of §3.2, same SEO
baseline of §3.7. A success story is card grid → detail, the same shape as
services; a vacancy list is the same shape again with an application form that
goes through `public_intake` rather than a new endpoint.

Two things they get for free that are worth using: careers rides the HR module,
so a vacancy on the website is the vacancy operations actually opened and closes
itself when filled — no stale listings, which is the single most common failure
of a careers page. And a success story is the natural place to point a
`card_grid` block's `href` at, so the home page can feature them without a
second content model.

`JobPosting` structured data on a vacancy detail page is not optional — it is
what puts a listing into Google Jobs, and it is the cheapest reach a careers
page can buy.

### WS5 — Insights

**Nothing exists.** New module on the `portfolio_public` shape (list / media /
`:slug` detail), with `service_type_web_profile` as the content-model template.

```
insight_article
  slug_fr/en, title_fr/en, excerpt_fr/en, body_fr/en
  cover_vault_id, tags text[], author_user_id → app_user
  meta_title_*/meta_description_*
  is_published, published_at, published_by, sort_order
```

`GET /public/insights` (tag filter, paginated) · `/:slug` · `/media/:id`,
`feature: "website"`.

**Fix what theirs gets wrong:**
- **Their filter bar hides articles.** `data-tags` contains `sustainability` and
  `operations`; the buttons are only All/Strategy/Humanitarian/Technology. Two
  articles are unreachable by any filter. Derive filters from the tags in use.
- **No dates anywhere** — no published date on cards, no `article:published_time`,
  `og:type` is `website`. A knowledge hub that cannot show recency is not
  credible.
- **No excerpt.** Cards carry title + author only.
- **Search is title-only, client-side, over hardcoded DOM.** Fine at 5 articles,
  useless at 30.
- **Author names live inside translation keys** (`kaizen_by_prefix_article` wraps
  "By Joseph MOUKOKO"). Names are not translatable content.

**Free win:** their five authors are staff. Link `author_user_id` to the HR
records we already hold and author attribution, photos and author pages come for
nothing — the website rendering ERP data again.

**Naming:** `insights` everywhere — module, route, and the label users see. The
"Kaizen Hub" name is retired. (pixie-girl-hub also has an unrelated `ops/kaizen`
console, so the name was ambiguous in two directions.)

---

## 5. Sequencing

```
WS1 Tracking ──┐
WS2 Intake  ───┼── independent, ship in any order
WS3 Services ──┘
                    WS4 Site content ── WS5 Insights
```

**Started 2026-08-30: WS3 + WS4 together.** They are both content-model work on
the same public surface and they share a reviewer's context — WS4's `card_grid`
and pillar blocks reference the service groups WS3 introduces, so building them
apart means guessing at the join.

WS1 remains the piece that settles the §3.3 state vocabulary, so whoever takes it
owns those shared components; until then WS3/WS4 build the components they need
and WS1 adopts them rather than the reverse.

The shared components of §3.3 are a prerequisite for everything. First person in
builds them.

---

## 6. Decisions — RESOLVED 2026-08-30

These are settled. Do not reopen them in a PR; raise them here if circumstances
change.

1. **Client name on public tracking — NO.** The reference alone must not reveal
   who the shipper is. `tracking_public.service` already withholds it; keep it
   that way.
2. **Public risk badges — NO.** No DELAYED / RISK / DUE on a public surface.
   Delay attribution stays internal. Public vocabulary is COMPLETED /
   IN_PROGRESS / PENDING only.
3. **Incoterm — REQUIRED.** Keep `incoterm: z.string().min(1)` and add the field
   to the wizard. It is a real datum a forwarder needs, and asking for it signals
   competence. N/A for the warehousing branch.
4. **Geocoding — use our own.** `src/services/geoapify.service.js` already
   exists: `searchPlaces`, `forwardGeocode`, `reverseGeocode`, keyed via the
   platform console (`GEOAPIFY_API_KEY`, section `geocoding`), with its own
   cache. **Do not call a third-party geocoder from the browser.** The existing
   place-search endpoint is permission-gated (`attendance` `edit`), so WS2 needs
   a *public, rate-limited* wrapper on the same service. Unlike theirs, the
   coordinates must actually be submitted and stored — `operations/geo_place`
   and the `GEO_PLACE` field type are the model to bind to.
5. **Attachment on quote — OPTIONAL.** Theirs is mandatory; that loses every
   prospect still shopping.

---

## 7. Environment

For the record, since these bite and are not in the repo:

- `SERVE_PUBLIC_WEB=true` — needed for `/public` on workspace hosts. Defaults
  false, and no deploy sets it: `.env` lives on the server only.
- `PUBLIC_INGRESS_IP` — the A record clients point at; drives the domain DNS
  check in the platform console.
- `PLATFORM_CONSOLE_HOST` — without it the platform console is not served at all.
- The `website` feature is per-tenant and off by default. Enabling is **Migrate,
  then toggle** — in that order, or there is no row to toggle.
