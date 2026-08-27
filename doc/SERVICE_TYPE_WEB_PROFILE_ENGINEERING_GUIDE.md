# Service type web profiles — engineering guide

**Status:** draft for implementation. **No application code in this document.**
**Date:** 2026-08-27
**Surfaces in scope:** Master data → Service types (new **Website** tab), the web-profile data model and its tenant API, the anonymous `/public/services` endpoint, the `document_vault` public-media allowlist extension, and the `website` feature flag.
**Out of scope:** the tenant website renderer itself (a separate build, exactly as `praxisls.com` is a separate repo per `WEB_BUILD_BRIEF.md` §1), hosting/domains, the portfolio page, intake forms (`public_intake` already exists).

This is the senior-engineer audit plus the locked product decisions from nine questions. Implementation is **two large PRs**. When both land, every tenant that buys the website package can expose its service types — bilingual, illustrated, SEO-addressable — through a public API a website builder can consume as-is.

Related reading: `SERVICE_TYPE_FORMS.md` (how service types already version their operational form), `DB_ARCHITECTURE.md` §1 (why the tenant DB boundary matters to a public endpoint), `BRAND_GLOSSARY_FR_EN.md` (the customer-facing voice in both languages).

---

## 1. What exists today (audit)

### 1.1 The service type

`service_type` (migration `0310_operations.sql`) is an **operational master table**, FR-first, with no public surface:

| Column | State |
|---|---|
| `key` | citext, unique — the stable code everything joins on (`SEA_FREIGHT_IMPORT`) |
| `name_fr` | NOT NULL |
| `name_en` | **nullable** — a service can exist with no English name at all |
| `territory` | a domain code (`DOMESTIC_INLAND`, …), not marketing copy |
| `is_system`, `is_active`, `created_at` | governance / archive |

Fifteen system types are seeded (`9080_seed_dictionary.sql`). The module (`src/modules/operations/service_type/`) rides **MOD-29** with the dossier (see `service_type.events.js` for why re-keying would 403 non-CEO users); DELETE is archive-via-`is_active`, never a row delete. The screen already governs a lot: versioned detail forms, milestone templates, dictionary tiers, assumptions, container capture — eight tabs on the dossier today (`service-type-dossier.tsx`).

**Nothing anywhere describes a service to a customer.** No description, no media, no public visibility, no slug, no SEO fields.

### 1.2 The precedents this feature should reuse (they are strong)

The Sales CRM portfolio (`success_story`, F11/F12) is a dress rehearsal for almost every part of this:

- **Slug + publishing** (`0694`): `slug` with a partial unique index (`WHERE slug IS NOT NULL`), `is_published`, `published_at`, `signed_off_by`; slugs auto-suggested by a slugify helper; slug regex `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` enforced in Zod.
- **Public media allowlist** (`10702`): `document_vault` gained `public_media_scope` (CHECK: only `SUCCESS_STORY` today), `public_media_entity_ref` (`success_story:<uuid>`), `public_media_role` (`COVER | CLIENT_LOGO | GALLERY`), `public_media_content_type` (**images only** — png/jpeg/webp) plus a completeness CHECK; a row is publicly servable only when `status = 'VERIFIED'` **and** explicitly scoped.
- **Anonymous serving** (`portfolio_public`): `/public/portfolio` routes are rate-limited (120 / 15 min), **pinned to the LIVE schema** (`req.tenantDbIn("live", …)` — an internet caller may not select sandbox via `X-Praxis-Env`), send `nosniff` + `Cache-Control: public, max-age=300`, and stream media bytes only after re-checking the allowlist.
- **Media upload flow** (`success_story.service.js`): `dataUrl` upload → `vault.createDocument` (`sniff: true`, 10 MB cap, image allowlist) → stamps the four `public_media_*` columns; replacing cover/logo **archives the old vault row and clears its public scope**; **media changes are refused while published** (`LOCKED`, unpublish first).
- **Anonymous intake already exists** (`public_intake`): quote requests, contact enquiries, partnerships, newsletter — the future website's forms are built.
- **Feature gating works without auth**: `requireFeature` only needs tenant context (`feature-gate.js`), so an anonymous router may carry `feature: "website"` and answer `FEATURE_DISABLED` (403) when the package is off.
- **The lesson of `9115`**: a feature flag with no `platform.feature_catalogue` row is a flag nobody can switch on — `tests/security/feature-catalogue-coverage.test.js` fails the PR.

And the context: `WORK_TO_BE_DONE.md` already carries the open commercial item *"Which tenants get a website package (build-from-scratch vs. connect-existing) and pricing"*. This feature is the content plumbing that question's answer depends on.

### 1.3 Defects / traps to avoid copying

- **The slugify helper drops accents.** `success_story`'s `slug()` replaces every `[^a-z0-9]` run with a dash, so `"Fret Aérien Import"` → `"fret-a-rien-import"`. For a product whose first language is French this is not cosmetic: our suggestion helper **must NFD-normalise and strip combining marks first** (`é → e`), then dash-fold. `"Fret Aérien Import"` → `"fret-aerien-import"`.
- **`name_en` is nullable** — an English website page cannot be rendered from a service with no English name. The publish gate must check the *service type's* `name_en`, not just profile fields.
- **Public endpoints must never expose drafts**: list/detail return only `is_published AND is_active`, and a *related services* list must filter to published profiles or it leaks unpublished slugs.

---

## 2. Locked product decisions (9 questions)

| # | Decision |
|---|---|
| 1 | **Separate 1:1 `service_type_web_profile` table** (plus `service_type_web_faq`, `service_type_web_related`). No marketing columns on `service_type` — the master table stays operational; a missing profile row simply means "not on the website". |
| 2 | **`slug_fr` + `slug_en`**, auto-suggested from each language's name (accent-safe), unique per tenant whenever set. Matches the localised-slug precedent of `praxisls.com` (`/en/…` ⇄ `/fr/…` + hreflang). |
| 3 | **Video = external embed URL only** in v1 (YouTube / Vimeo / Dailymotion host allowlist). Pictures go through the `document_vault` public-media path. No self-hosted video this phase; the media shape extends later without reshaping. |
| 4 | **New "Website" tab** on the service-type dossier (Master data → Service types), not a separate website admin area. |
| 5 | **Publishing requires both languages complete and at least one image** — the **cover is that image and is mandatory**; a gallery without a cover does not satisfy it. Uses the **same rights as service-type editing** (MOD-29 `edit`). No separate publish permission, no sign-off actor. |
| 6 | **Two large PRs** (§5). |
| 7 | **Copy depth:** `short_description` (card teaser + meta fallback), `long_description` (page body), `highlights` (guidance 4–8 bullets, hard cap 8) — each bilingual. |
| 8 | **SEO fields:** `meta_title` + `meta_description` per language (fallback to name / short description), optional **icon** field for grid cards; share image falls back to the cover; JSON-LD is renderer-generated from the record. |
| 9 | **Page sections from the system:** per-service **FAQ** (bilingual), **related services** (manual picks), **coverage note** per language. **No success-story linking** — the portfolio is its own page. The *Request a quote* CTA is a page element (renderer), fed by the existing public intake. |

---

## 3. Target experience

### 3.1 The Website tab

Appears as the ninth tab on the service-type dossier, only when the `website` feature is on for the tenant.

**The tab always GETs, and the GET always answers.** Opening the tab fires `GET /service-types/:id/web` unconditionally. For a service type that exists, that endpoint answers **200 every time** — `profile: null` plus the derived readiness object when no row exists yet — so the tab renders one of three states (empty / draft / published) and **never branches on a 404**. The only 404 is the service type id itself not existing, which the surrounding screen already owns. Every create and every edit goes through the **one upsert endpoint** (`PUT …/web`, create-when-absent, update-when-present — §4.5), so the client never needs to know whether the row exists. Full read coverage, full write coverage, no orphan verbs.

- **No profile row** → an empty state explaining what the tab does, one action: **"Create web page"**. That button calls the same upsert endpoint with the first save — there is no separate create call. Creating the row never changes anything operational — dossiers, forms, milestones are untouched.
- Sections of the tab:
  - **Content** — short + long description and highlights per language, with a language toggle (side-by-side on wide screens). Copy hints reference `BRAND_GLOSSARY_FR_EN.md` register rules (this text is customer-facing).
  - **Media** — cover image (marked *required to publish*), gallery (add/remove/reorder), optional icon, one video URL. Uploads reuse the story-media interaction (`dataUrl`, size/type messages identical).
  - **SEO** — `slug_fr` / `slug_en` with live accent-safe suggestions (§4.7); meta title/description per language with character counters and the computed fallback shown; "share image falls back to cover" note.
  - **Page sections** — FAQ editor (bilingual Q&A rows, ordered), related-services multi-pick (search over service types), coverage note per language.
  - **Publish** — a **readiness checklist** that ticks live: name EN (see below), short ×2, long ×2, slug ×2, **cover image**. The **Publish** button is disabled until every item ticks; **Unpublish** is always available and keeps all content.
- **The `name_en` checklist row is special**: the English name lives on the *service type*, not the profile, and its missing state is common (`name_en` is nullable today). The row reads "English name — set on the service type" and carries a **jump action that opens the existing service-type edit modal** (the `editing` three-state already on `service-types.tsx`). The web tab never writes `name_en` itself — one writer, the existing form; the tab only reads it (the GET returns `readiness.name_en_present`, recomputed per call, never stored).
- **Copy edits are live while published** (a CMS typo fix must not require downtime). **Slug and media changes are refused while published** (422 `LOCKED`, unpublish first) — slugs because renaming a live URL is an SEO decision, media to stay consistent with the story-media precedent.
- On an **archived** service type the tab shows a mute notice ("archived services are never public") — archive already auto-unpublished it (§4.2).

### 3.2 The public API (what the website consumes)

Anonymous, LIVE-pinned, rate-limited, feature-gated — same shape as `/public/portfolio`:

```
GET /public/services                  list — published + active only, sort_order then name_fr
GET /public/services/:slug            detail — matches slug_fr OR slug_en; returns the full bilingual record
GET /public/services/media/:id        image bytes — allowlist re-checked before streaming
```

The detail payload carries **both languages and both slugs** (`alternates: { fr, en }`) so the renderer builds `/fr/<slug_fr>` and `/en/<slug_en>` from one lookup and emits the hreflang pair itself. Media arrives as **URLs only** — never bytes inside JSON.

---

## 4. Architecture

### 4.1 Data model (one tenant migration)

Next free tenant migration number (confirm with `ls migrations/tenant | sort | tail -1` — `12745` at time of writing). Sketch:

```sql
CREATE TABLE service_type_web_profile (
  service_type_id        uuid PRIMARY KEY REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  short_description_fr   text,
  short_description_en   text,
  long_description_fr    text,
  long_description_en    text,
  highlights_fr          jsonb NOT NULL DEFAULT '[]',   -- array of strings, cap 8 in the validator
  highlights_en          jsonb NOT NULL DEFAULT '[]',
  coverage_fr            text,
  coverage_en            text,
  slug_fr                text,                          -- regex + partial unique index (below)
  slug_en                text,
  meta_title_fr          text,
  meta_title_en          text,
  meta_description_fr    text,
  meta_description_en    text,
  cover_vault_id         uuid REFERENCES document_vault(doc_id),
  icon_vault_id          uuid REFERENCES document_vault(doc_id),
  gallery_vault_ids      uuid[] NOT NULL DEFAULT '{}',
  video_url              text,                          -- external embed; host allowlist in the validator
  is_published           boolean NOT NULL DEFAULT false,
  published_at           timestamptz,
  published_by           uuid REFERENCES app_user(user_id),
  sort_order             integer NOT NULL DEFAULT 100,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_stwp_slug_fr ON service_type_web_profile(slug_fr) WHERE slug_fr IS NOT NULL;
CREATE UNIQUE INDEX ux_stwp_slug_en ON service_type_web_profile(slug_en) WHERE slug_en IS NOT NULL;
CREATE TRIGGER trg_stwp_updated BEFORE UPDATE ON service_type_web_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE service_type_web_faq (
  faq_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id  uuid NOT NULL REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  question_fr      text NOT NULL,
  question_en      text NOT NULL,
  answer_fr        text NOT NULL,
  answer_en        text NOT NULL,
  sort_order       integer NOT NULL DEFAULT 100,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_stwp_faq ON service_type_web_faq(service_type_id, sort_order);

CREATE TABLE service_type_web_related (
  service_type_id          uuid REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  related_service_type_id  uuid REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  PRIMARY KEY (service_type_id, related_service_type_id),
  CHECK (service_type_id <> related_service_type_id)
);
```

Notes:

- **Slugs are `text`, not citext** — the regex (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, same as `success_story`) already forces lowercase ASCII, so case-insensitivity concerns vanish; uniqueness is a partial unique index exactly like `0694`'s. Unique **whenever set**, drafts included — two services must never discover at publish time that they both wanted `/fr/fret-maritime`.
- **FAQ is set-replaced**, not row-patched: one `PUT` with the whole ordered list (the `replaceDossiers` precedent). At this size (≤ 12 rows) per-row endpoints are ceremony.
- **`ON DELETE CASCADE`** is belt-and-braces — service types are archived, not deleted — but if a row ever is purged, its web presence must not survive it.
- **No seed rows.** The fifteen system types get no pre-created profiles and no pre-filled slugs: a profile row means "this service goes on the website", which is the tenant's decision, in the tenant's voice. Slugs are *suggested* at creation (accent-safe), never seeded.

### 4.2 Publishing rules

**Completeness gate (both languages, enforced server-side; the FE checklist is the courtesy, the service is the control — the same principle as the option-list validation in `SERVICE_TYPE_FORMS.md`):**

Publish requires all of —

| Item | Why |
|---|---|
| `service_type.name_en` present | `name_en` is nullable on the master table; an English page cannot render without it. Checked against the **service type row**, not the profile — and surfaced in the tab as a checklist row that jumps to the existing edit modal (§3.1). |
| `short_description_fr` + `_en` | the card text and the meta-description fallback |
| `long_description_fr` + `_en` | the page body |
| `slug_fr` + `slug_en` | the page address in each language |
| `cover_vault_id` set and publicly servable | **At least one image is mandatory, and the cover is that image — locked, not veto-able** (§11 records it as decided). A gallery without a cover does not satisfy it: the card, the hero and the share image all derive from the cover, so a cover-less page is a stub by construction. |

Optional (publishing does not require): highlights, FAQ, coverage, video, meta title/description, icon, gallery, related services.

**Lifecycle rules:**

1. `is_published` may only be true while `service_type.is_active` — enforced in the service layer (cross-table CHECKs are not this codebase's style; a rule + test is, like the attendance policies).
2. **Archive auto-unpublishes, atomically** with the deactivation (`service_type.service.archive` gains one step). Reactivation never auto-republishes.
3. Publish stamps `published_at` (first publish) and `published_by`; unpublish clears neither — they are the historical record.
4. Slug + media writes are refused while published (`LOCKED` 422, message: "Unpublish before changing …") — same wording family as story media.
5. A profile row may be created for an inactive service type (drafting ahead of launch) but can never be published while inactive.

### 4.3 Media — extend the `10702` allowlist, don't fork it

- `document_vault` CHECK extensions (drop + re-add, `IF NOT EXISTS`-guarded like `10702`): `public_media_scope` gains `'SERVICE_TYPE'`; `public_media_role` gains `'ICON'` (`COVER`/`GALLERY` reused as-is); `public_media_content_type` **stays images-only** (video is an embed URL — decision 3). The `ck_vault_public_media_complete` CHECK keeps working because uploads always set all four columns together.
- `doc_type = 'SERVICE_TYPE_MEDIA'`, `public_media_entity_ref = 'service_type:<uuid>'`.
- Upload/remove endpoints mirror story media exactly: `vault.createDocument` with `sniff: true`, 10 MB cap, image allowlist; **replacing cover/icon archives the old vault row and clears its public scope** (no orphaned public bytes); removing a gallery item clears its scope. Lock-while-published applies (§4.2 rule 4).
- The public media route re-checks `status = 'VERIFIED'` + scope + role + content type before streaming, exactly like `portfolio_public.service.media` — the allowlist is checked at serve time, not trusted from the profile row.

### 4.4 Feature gating — the commercial switch

New feature key **`website`**, default **off** (this is the tenant website package; which tenants get it is the open commercial item in `WORK_TO_BE_DONE.md`):

1. `platform.feature_catalogue` row: `('website', 'MOD-29', 'Tenant website content', …, 'off', '{}')` — rides the same module key as service types, exactly as the service-type module itself does.
2. Tenant `feature_state` rows arrive via the standard projection (`provisioning.projectFeatures(slug)` / console → Tenant → Migrate). **Read `9115`'s header first** — this is precisely how fifteen `mail.*` flags shipped unswitchable, and `tests/security/feature-catalogue-coverage.test.js` fails the PR if the row is missing.
3. Both surfaces carry the gate: the admin web routes are mounted inside the service-type router's world (already `feature: "operations"`), the public router exports `feature: "website"` — which works for anonymous callers because `requireFeature` needs only tenant context.

### 4.5 Module layout (per `CONVENTIONS.md`)

```
src/modules/operations/service_type_web/
  service_type_web.repo.js        profile/faq/related SQL + the public read queries
  service_type_web.service.js     publishing gate, media allowlist stamping, audit
  service_type_web.validator.js   Zod: slugs, video host allowlist, highlights caps, FAQ set
  service_type_web.events.js      audit action constants (rides the service-type module key)
src/modules/operations/service_type_web_public/
  service_type_web_public.routes.js   basePath "/public/services", feature "website",
                                      idParam "text" (slug-shaped, not uuid)
```

Admin routes hang off the existing `service_type.routes.js` as `/service-types/:id/web…` — the same arrangement `service_type_field` uses ("the form lives on the service type, so its routes hang off this router"), with the validator bound to `validateX` names for `check-write-route-validators.js`. No central wiring edit; the loader mounts the public module.

**Admin API:**

**Admin API — full create / read / update coverage, no gaps:**

| Endpoint | Verb semantics | Gate |
|---|---|---|
| `GET /service-types/:id/web` | **Read, always.** 200 for every existing service type: `{ profile, faq, related, readiness }`; `profile: null` before creation. 404 only for a service type id that does not exist. | view |
| `PUT /service-types/:id/web` | **Create + edit in one upsert.** Absent row + body ⇒ created (201 semantics on first write); present row + body ⇒ updated. **Omitted keys are left unchanged** (the `pick()`-of-defined-keys pattern) — the client may PATCH-edit a single field with the same verb. Refuses slug fields while published (`LOCKED`). | edit |
| `POST /service-types/:id/web/publish` | **Action** — the completeness gate of §4.2, atomically. | edit |
| `POST /service-types/:id/web/unpublish` | **Action** — always allowed, keeps content. | edit |
| `POST /service-types/:id/web/media` | **Create** — `{ role, dataUrl, originalName }`; refuses while published (`LOCKED`). | edit |
| `DELETE /service-types/:id/web/media/:docId` | **Delete** — archives the vault row, clears its public scope; refuses while published. | edit |
| `PUT /service-types/:id/web/faq` | **Set-replace** the ordered bilingual list (the `replaceDossiers` precedent). | edit |
| `PUT /service-types/:id/web/related` | **Set-replace** related service ids. | edit |

The read path is total and the write path covers create, edit and both lifecycle actions — there is no state the tab can reach that has no endpoint. The upsert follows the dictionary-tier/`PUT /:id/containers` precedent (one verb, no create-vs-update choice for the caller); if the client team prefers an explicit `POST` create + `PATCH` edit pair, that split is acceptable — the contract that matters is: **absent row + body ⇒ created, present row + body ⇒ updated, and GET never 404s on a live service type.**

All writes audited (`WEB_PROFILE_CREATED/UPDATED/PUBLISHED/UNPUBLISHED`, `WEB_MEDIA_ADDED/REMOVED`, `WEB_FAQ_UPDATED`, `WEB_RELATED_UPDATED`).

### 4.6 Public payloads

List item: `service_type_id, slug_fr, slug_en, name_fr, name_en, short_description_fr/en, cover_url, icon_url, has_video, sort_order` — enough for the services grid without the bodies. Detail: everything, plus `highlights_fr/en`, `long_description_fr/en`, `coverage_fr/en`, `faq[]`, `video_url`, `gallery_urls[]`, `meta_*`, `related[]` (slug + name per language, **published profiles only**), `alternates: { fr: slug_fr, en: slug_en }`, `published_month`. `mediaUrl(id) = /api/tenant/public/services/media/:id`, nulled when the allowlist check fails — the `cover_allowed` pattern from `portfolio_public.service.list`.

The **admin** GET returns, beside `profile` / `faq` / `related`, a derived `readiness` object: `{ name_en_present, short_fr, short_en, long_fr, long_en, slug_fr, slug_en, cover, publishable, missing: [...] }` — recomputed on every read (never stored), so ticking an item elsewhere (e.g. setting `name_en` in the edit modal) reflects on the next GET with no cache to invalidate. This object is what the tab's checklist renders, and it is **mirror-identical to what the publish endpoint enforces** — one function computes it, the endpoint and the GET both call it.

### 4.7 The slug helper — shared, accent-safe, and it fixes the story bug too

The trap, precisely: `success_story.service.js` slugifies with `value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")`. After `toLowerCase`, a precomposed `é` is still `é` — it is not in `[a-z0-9]`, so **every accented character becomes a dash**: `"Fret Aérien Import"` → `"fret-a-rien-import"`. In a French-first product that mangles the majority of real service names, and the mangled slug is then *stored* and becomes the public URL forever.

**The fix is one helper, used everywhere slugs are suggested or normalised:**

1. `String.prototype.normalize("NFD")` — decomposes `é` into `e` + combining acute.
2. Strip combining marks: `/\p{M}/gu` removed.
3. `toLowerCase()`.
4. Fold every `[^a-z0-9]+` run (spaces, apostrophes, punctuation — `"L'entrepôt"` → `l-entrepot`) to a single `-`.
5. Trim leading/trailing dashes; collapse repeats.
6. **Cap at 80 characters, cut at a dash boundary** (never mid-word — a truncated word in a URL is worse than a shorter slug).
7. **Never return an empty string**: if the input yields nothing (`"中文服务"`), fall back to the service type's `key` lowercased-and-dashed (`SEA_FREIGHT_IMPORT` → `sea-freight-import`). A slug column that accepts `""` is a unique index waiting to collide.

Placement: `src/shared/text/slug.js` (CommonJS, pure, no imports — trivially requireable by any module *and* by the docker mount probe), with a typed twin at `client/src/lib/slug.ts` for the live suggestion box. The server helper is the authority: the FE suggestion is a courtesy preview, and the validator normalises through the same algorithm before saving (rule: **what the user accepted in the box is what gets stored** — no silent rewriting on save; if the typed value fails the regex, 422 with the suggestion attached).

**And fix the existing bug in the same PR** (`success_story.service.js`): swap its local `slug()` for the shared helper. This is deliberately safe — the helper is only called at **create** to auto-suggest (`slug(data.title)`), so **no stored slug is ever rewritten**; already-published story URLs are byte-identical before and after. Only future suggestions stop eating accents. A regression test pins it.

The regex itself is unchanged from the `success_story` validator (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`) — acceptance stays strict; only *suggestion* was broken.

---

## 5. Two large PRs

**PR1 — backend complete, ships dark.** The migration (tables + vault CHECK extension + updated_at trigger, with a `-- DOWN` block per the reversibility gate), the platform catalogue seed (+ projection), the **shared accent-safe slug helper + the `success_story` swap**, `service_type_web` module (repo/service/validator/events), admin endpoints mounted on `service_type.routes.js` (GET-always semantics, upsert), the archive-auto-unpublish hook, the `service_type_web_public` module, jest suites under `tests/`, and **the regenerated contract artifacts** (`doc/api-contract.json --update`, `doc/API_REFERENCE.md`, `doc/ERROR_CODES.md` — see §8). Nothing user-visible changes; the public URL answers only for tenants with the flag on.

**PR2 — the Website tab.** `service-type-web-tab.tsx` (new), tab registration in `service-type-dossier.tsx`, the `client/src/lib/slug.ts` twin of the shared helper, `operations-api.ts` types + calls (GET-always, one upsert), the readiness checklist + publish/unpublish flow, media upload UI, FAQ/related editors, vitest coverage. Purely client; PR1 is its contract.

---

## 6. Implementation rules (do not regress)

1. **Public routes pin LIVE** — `req.tenantDbIn("live", …)`; an internet caller never selects sandbox.
2. **Media serves only through the allowlist** — VERIFIED + scoped + role + image content type re-checked at serve time. Never stream because a profile row points at a doc id.
3. **`is_published` implies `is_active`** — publish of an inactive type is refused; archive unpublishes atomically.
4. **The completeness gate is server-side.** The FE checklist mirrors it; it is not the control.
5. **Slugs: regex both ends, unique when set (drafts included), accent-safe suggestion** (NFD → strip marks → dash-fold). Never port `success_story`'s `slug()` verbatim.
6. **Locked while published:** slug and media writes 422 `LOCKED`; copy edits stay live.
7. **No bytes in JSON** — media are URLs; the media route streams with `nosniff` + `Cache-Control: public, max-age=300`.
8. **Rate-limit** anonymous routes (`makeLimiter`, 120 / 15 min, same as portfolio-public).
9. **No draft leakage** — list/detail filter published + active; related lists filter to published; media of unpublished profiles is unreachable (allowlist + profile row never referenced publicly).
10. **RBAC unchanged:** view reads, edit writes (incl. publish) on the existing service-type module key — decision 5. No new permission tree, no new module gate for admins beyond the `website` feature.
11. **i18n:** one column per language, never a "bilingual" text field; FE copy through the existing `tr` / dict patterns; customer-facing copy hints follow `BRAND_GLOSSARY_FR_EN.md`.
12. **Audit every write.**
13. **GET is total.** `GET …/web` answers 200 for every existing service type (`profile: null` when absent) — the tab never branches on 404, and there is no client state without an endpoint (§4.5).
14. **One upsert, one writer per field.** Create and edit are the same endpoint with omitted-keys-unchanged semantics; `name_en` is written only by the existing service-type form; slugs are normalised by the shared helper, never silently rewritten on save.
15. **New modules must require cleanly** — no DB/storage access at module top level. A module that throws at require time is *skipped* by the loader, and the docker job's mount report fails CI on any skip (§8, family 8).

---

## 7. Test plan (minimum)

Tests live where CI reads them: jest under `tests/` (`jest.config.js` matches `tests/**/*.test.js`; suites for this feature in `tests/unit/service-type-web-*.test.js`, the catalogue row check in `tests/security/`), vitest under the client (`npm run test --prefix client`). **Coverage is a ratchet, not a target** — the global **functions ≥ 13 %** floor in `jest.config.js` must not dip, which in practice means the new service/repo functions are tested as they are written, not retro-fitted.

| Layer | Must prove |
|---|---|
| `service_type_web.validator` | slug regex rejects case/accents/spaces; video host outside allowlist rejected; > 8 highlights rejected; FAQ rows missing either language rejected; PUT body with unknown keys refused |
| `service_type_web.service` | publish gate: each missing required item → 422 naming it (incl. **missing cover** and **missing `name_en` on the service type**); `name_en`-less service type cannot publish; publish inactive refused; archive unpublishes atomically; slug/media write while published → `LOCKED`; replacing cover archives + unscopes the old vault row |
| `service_type_web.repo` | upsert is create-once-then-update (second PUT updates, does not duplicate); duplicate `slug_fr` / `slug_en` across two services hits the partial unique index |
| **GET totality** | `GET …/web` on a service type with no profile row → 200 with `profile: null` + full readiness; after first PUT → 200 with the row; readiness recomputed per GET (set `name_en` via the service type → next GET flips `name_en_present`); 404 only for a nonexistent service type id |
| shared slug helper | `"Fret Aérien Import"` → `fret-aerien-import` (the `fret-a-rien` trap); `"Dédouanement"` → `dedouanement`; `"L'entrepôt"` → `l-entrepot`; double spaces → one dash; > 80 chars cuts at a dash boundary; non-latin input falls back to the dashed `key`; empty-after-trim never returned |
| `success_story` (regression) | new story from accented title gets the accent-safe suggestion (`"Dédouanement à Douala"` → `dedouanement-a-douala`); **existing stored slugs untouched** (no rewrite path) |
| `service_type_web_public` | list returns published + active only, in `sort_order` then `name_fr`; detail matches by either slug, 404s unknown; `related` omits unpublished; media route refuses non-VERIFIED / unscoped / non-image; flag off → 403 `FEATURE_DISABLED` |
| Website tab (vitest) | readiness checklist gates Publish exactly per §4.2 (incl. the `name_en` row and its jump action opening the edit modal); first save on the empty state calls the one upsert; unpublish keeps content; tab renders the no-profile empty state; archived service type shows the mute notice; slug box previews via the client twin of the shared helper |
| security | anonymous caller cannot reach any `/service-types/:id/web…` write; catalogue-coverage test passes |

---

## 8. CI — the wall these PRs must stay green on

CI (`.github/workflows/ci.yaml`) runs **five jobs** — `build-test`, `migrations`, `security`, `frontend` (matrix: `client` + `platform-console`), `docker-build` — whose gates group into **eight families**. Both PRs touch every family except none: each family below lists what this feature specifically must do (or deliberately not do) to keep the wall green. **The PRs are not done until all eight are green.**

**Family 1 — the PR title gate.** `build-test` rejects a title that is not usable as a changelog line: it must match `type(scope): what changed` (`feat|fix|chore|docs|refactor|perf|test|build|ci|revert`, scope `[a-z0-9 ._/-]+`, ≥ 6 chars of subject). Ours: `feat(service-types): web profiles — data, admin API, public services (PR1)` and `feat(client): service-type Website tab (PR2)`. The gate re-runs on title *edits* on purpose; a rejected title is fixed by editing the title, never by an empty commit.

**Family 2 — parse + lint ratchets.** `node --check` on every `src`/`scripts` file; `eslint . --max-warnings 136` (root) and `--max-warnings 112` (client). The ceilings are **ratchets**: our new files must land with **zero new warnings**, or the count grows for everyone after us. Run `npm run lint` and `npm run lint --prefix client` locally before pushing; do not push "it's only a warning".

**Family 3 — unit tests + the coverage floor.** Root: `npx jest --coverage` with the global **functions ≥ 13 %** threshold — new, untested service functions drag the function average and can fail a gate that has nothing to do with us by name. Client: `vitest run`. Also the **jest.mock hoisting guard** (`scripts/check-jest-mock-hoisting.js`): mock factories must not close over module-scope variables (name them `mock…`). §7 is the list; every row is a CI row.

**Family 4 — migration guards.** Five checks read our SQL before any database does:

- *Numbering* (`check-migration-numbers.js`): the tenant migration number and the `91xx` platform-seed number must be **unique across the repo** — re-check `ls migrations/tenant | sort | tail -1` and the seeds directory on the day, numbers move.
- *Reversibility* (`check-migration-reversibility.js`): every new migration carries a commented **`-- DOWN`** block (like `0694`'s) or an explicit `-- IRREVERSIBLE: <reason>`. Ours is additive — write the DOWN.
- *Rerunnable + applied-immutable* (`check-migration-idempotency.js`): `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / guarded constraint drops throughout, and **never edit the file after it has applied** — a changed definition goes in a new migration.
- *Destructive declaration* (`check-destructive-migrations.js`): ours drops no data, so no `-- DESTRUCTIVE` marker — keep it that way.
- *Schema drift* (`check-schema-drift.js`): `service_type_web_*` must be created in exactly one file; the `notification_preference` incident is the cautionary tale in the workflow comments.

**Family 5 — API surface guards.** Six checks in `build-test` read the routes themselves:

- *Write routes are validated* (`check-write-route-validators.js`): every write handler visibly carries a Zod validator (the `validateX` binding-naming convention — the guard recognises validators by that shape, and a validator it cannot see is a validator the next person assumes is missing). All six of our write endpoints comply.
- *API contract* (`check-api-contract.js`): removals and lost auth/RBAC/validator gates fail; additions don't — but **run `node scripts/check-api-contract.js --update` and read the diff** so the committed contract shows the new surface with its gates.
- *API docs in sync* (`generate-api-docs.js --check`): `API_REFERENCE.md` and `ERROR_CODES.md` are **generated** — adding routes or error codes without running `node scripts/generate-api-docs.js` and committing the result fails CI. Prefer reusing existing codes (`NOT_FOUND`, `LOCKED`, `VALIDATION`-family); any genuinely new code enters the registry through regeneration, not by hand.
- *Response-contract drift* (`check-response-contract.js`): every snake_case field on a client TS type must be a real column, a server-emitted alias, or baselined in `doc/response-contract-baseline.json`. Our profile fields are real columns (safe); if the readiness/view-model shape trips the check, re-bless with `--update` **and understand why** before committing.
- *No new silent catches* (`check-silent-catch.js`): every empty `catch` carries `/* @silent: <class> */` or it fails. Media teardown paths are where we would be tempted — don't be.
- *Actor FK guard* + *citext[] casts*: audit through `emit.js`'s guarded helpers only (never a raw actor id into an `_by` column), and we add no `citext[]` columns — slugs are `text` precisely so that gate stays a non-event.

**Family 6 — the `migrations` job (a real Postgres, from nothing).** Platform seeds, a tenant provisioned from scratch, the whole tenant set applied **twice** (idempotency proven on a live database, not by inspection), constraint probes, integration suites. Our migration must therefore create cleanly in fresh-provision order — `service_type` (0310), `document_vault` (0340) and `set_updated_at()` all exist before our number runs — and re-apply as a no-op.

**Family 7 — security.** `npm audit` at high severity (we plan **zero new dependencies** — the embed approach of decision 3 is partly this; if one is ever truly needed it must arrive audit-clean) and the secret scan (no keys in code; the tenant's video URL is data, not a secret).

**Family 8 — frontend gates + the docker image.** Client job: `lint`, **contrast** and **raw-palette** gates (the tab uses `var(--brand-*)` tokens — no raw hex, orange-as-text uses the ink variant, per `WEB_BUILD_BRIEF.md` N3/N4), **motion budget** (`prefers-reduced-motion` respected), **docs gate** (if `FRONTEND_GUIDE.md` names a component of ours, it must be a real export — the `ResourceList` incident), **schema gates** (we keep our validator backend-side and add nothing to `packages/shared` — a shared schema must be imported by *both* halves or the gate flags it), `tsc -b && vite build`, the Playwright **desktop layout gate** (the ninth tab must not break the dossier layout), and the **bundle-graph** check (no manual chunking edits — nothing to do). Docker job: the image builds, boots under production env, the **mount report shows zero skipped modules** (rule 15 — our two modules require cleanly with no DB), and the PDF raster probes are untouched by us.

**The local pre-push ritual** (all of it already scripted): `npm run ci` (the local CI mirror), `npm run lint`, `npm test`, `npm run lint --prefix client`, `npm run test --prefix client`, `npm run build --prefix client` — then the doc regeneration of family 5. A PR that is red on any family is not "in review".

---

## 9. Rollout

1. Apply the tenant migration to every tenant DB (live + sandbox) via the standard migration path; apply the platform catalogue seed; **re-project features** (console → Tenant → Migrate or `provisioning.projectFeatures`) — flag stays **off** everywhere by default.
2. Enable `website` on one sandbox tenant; QA PR1 endpoints by curl against `/public/services` (empty list is correct before any profile exists).
3. Merge PR2; the tab is invisible to tenants without the flag — no dark-launch gymnastics needed.
4. First real consumer: the first tenant website build reads `/public/services` exactly as `WEB_BUILD_BRIEF.md` made `praxisls.com` a consumer of the brand package — separate repo, same contract.

---

## 10. File touch list (expected)

**PR1:** `migrations/tenant/<next>_service_type_web_profile.sql` (with `-- DOWN`), `migrations/seeds/91xx_seed_website_feature.sql` (platform catalogue; unique number), `src/shared/text/slug.js` (accent-safe helper), `src/modules/sales/success_story/success_story.service.js` (swap to the shared helper), `src/modules/operations/service_type_web/{repo,service,validator,events}.js`, `src/modules/operations/service_type_web_public/service_type_web_public.routes.js` (+ thin service if the queries outgrow the repo), `src/modules/operations/service_type/service_type.routes.js` (mount web endpoints), `src/modules/operations/service_type/service_type.service.js` (archive auto-unpublish), `tests/unit/service-type-web-*.test.js` (+ the slug-helper and success-story regression suites), and the **regenerated artifacts**: `doc/api-contract.json`, `doc/API_REFERENCE.md`, `doc/ERROR_CODES.md`.

**PR2:** `client/src/features/masterdata/service-type-web-tab.tsx` (new), `client/src/features/masterdata/service-type-dossier.tsx` (TABS + render), `client/src/lib/slug.ts` (twin of the shared helper), `client/src/lib/operations-api.ts` (profile types + GET-always/upsert calls), vitest specs beside the tab.

---

## 11. Open items that are *not* blockers

- ~~Cover image required to publish~~ — **decided (2026-08-27): required.** At least one image, and the cover is that image. Recorded here so nobody re-litigates it silently; flip it only with the product owner, in this file.
- **Video host allowlist contents** — proposed YouTube / Vimeo / Dailymotion (Dailymotion matters in francophone markets); final list is one validator array.
- **Seeded slugs for the fifteen system types** — decided no (§4.1); revisit if tenants ask for a head start.
- **Dedicated share/og image field** — falls back to cover now; a column is a one-line migration when a design asks for it.
- **JSON-LD shape, sitemap.xml, robots, hreflang emission** — renderer repo's job; the API supplies `alternates` and the raw material.
- **Self-hosted video** — deliberately deferred; the embed column and the allowlist pattern extend without reshaping.
- **The website package commercial question** (`WORK_TO_BE_DONE.md`, "which tenants get a website package") — stays open; this feature is what its answer will switch on.

When the two PRs land, a service type's operational definition (forms, milestones, dictionary) and its public face (copy, media, slug, FAQ) live side by side on one screen, in two tables that never contaminate each other — and `/public/services` is the single contract every tenant website consumes.
