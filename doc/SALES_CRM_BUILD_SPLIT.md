# Sales & CRM (Group IV) — build split

**Date:** 15 August 2026 · **Companion to:** `GAP_REVIEW_2026-08-14.md` Addendum II (G26–G37)
**Purpose:** twelve units that can each be built and tested in a separate session. Every unit states what it depends on, what is explicitly out of its scope, and how you know it is done.

**Standing decisions (1–9, 15 Aug)** apply throughout: clean start, no legacy data; keep `lead → opportunity`; per-tenant company DNA; all five public surfaces in one pass; FR in schema now; legacy campaign model with manual actuals; new-system numbering throughout; proposal generation as new capability; approved vendor creates a DRAFT supplier.

**Later decisions:** per-tenant origin allowlist in Settings · fact sheet is pure SQL with nightly refresh, top-up on stale open, manual button · client consent is three-state defaulting to `NOT_ASKED`.

---

## Dependency order

```
S1 (schema)
 ├── S2 (company profile) ──┐
 ├── S3 (discovery capture) │
 ├── S4 (proposal record) ──┼── S5 (proposal AI)
 │        └───────────────── S6 (proposal delivery)
 ├── S7 (lead intake + conversion)
 ├── S8 (pipeline)
 ├── S9 (campaigns)
 ├── S10 (inbound intake)
 └── S11 (success stories) ── S2
                              │
      S6 + S7 + S11 ──────────┴── S12 (public surfaces)
```

S1 first. S2–S4 and S7–S11 are then independent of each other and can run in any order or in parallel. S5, S6 and S12 are the only true joins.

---

## S1 · Schema pass

**Depends on:** nothing. **Blocks:** everything.

One migration set covering every Group IV column change, so no later session carries a migration.

- `proposal` — `language`, `currency`, `service_category`, `incoterm`, `origin_location`, `destination_location`, `cargo_description`, `estimated_weight`, `project_cargo_flag`, `customs_clearance_target`, `transit_time_target`, `free_days_demurrage`, `payment_conditions`, `validity_days`, `token`, `token_expires_at`, `viewed_at`, `downloaded_at`, `converted_client_id`, `converted_quote_id`
- `proposal_narrative` — `language`, plus `raw_client_operations`, `raw_pain_points`, `raw_proposed_strategy`, `raw_tone`
- `lead` — `country`, `address`, `niu`, `rccm`, plus the intake fields from G31 (`intake_channel`, `submission_datetime`, `service_category`, `service_type`, `incoterm`, `origin_location`, `destination_location`, `warehouse_location`, `warehouse_duration`, `estimated_weight`, `estimated_value_xaf`, `project_cargo_flag`, `cargo_description`) — on `lead` or a `lead_request_detail` child, your call
- `marketing_campaign` — `platform`, `owner_name`, `target_service`, `budget_amount`, `currency`, `remarks`, `target_leads`, `target_opportunities`, `target_won`, `actual_leads`, `actual_opportunities`, `actual_won`, `rejection_reason`; status check extended with `PLANNED` and `PENDING_APPROVAL`
- `success_story` — `slug` (unique), `client_id`, `service_category`, `exec_summary`, `ops_execution`, `hard_kpis` jsonb, `cover_image_path`, `client_logo_path`, `gallery_images` jsonb; new `success_story_dossier` join table (closes G25)
- `contact_enquiry` — `enquiry_type`, `company_name`, `internal_notes`; status check extended with `RESPONDED`
- `partnership_request` — `country_of_origin`, `network_memberships` jsonb, `contact_title`, `proposal_type`, `corporate_profile_vault_id`, `internal_notes`, `supplier_id`
- `client_master` — `public_reference_consent` enum defaulting `NOT_ASKED`
- `pipeline_stage` seed — add `PRICING_IN_PROGRESS` at sort 2, probability 50

**Out of scope:** any service or UI code.

**Done when:** the tenant migration set applies twice cleanly in the CI `migrations` job; `db:provision` on a fresh tenant produces every column; seeds include the seven pipeline stages.

---

## S2 · Tenant company profile ("company DNA") — G37

**Depends on:** S1. **Blocks:** S5, S11's AI half.

- `tenant_profile` — declared: slogan, positioning, memberships, certifications, service promises. Form entry plus PDF extraction into **the same fields**, each requiring human confirmation.
- `tenant_fact_sheet` — derived, **pure SQL, typed fields, no model**: fleet count (MOD-39), warehouse capacity (MOD-34), top lanes by POL/POD frequency, vertical mix by service type + commodity, average clearance time from milestone timestamps, client count, turnover band from the ledger. Each row carries `computed_at`.
- Refresh: nightly job, automatic top-up when the sheet is older than N hours at composer open, manual refresh button. As-of date visible wherever the sheet is consumed.
- Consent: `public_reference_consent` settable through the existing `approve`-gated client flow; `NOT_ASKED` renders as anonymised.

**Out of scope:** the generator itself. This session ends with a fact set, not a proposal.

**Done when:** a tenant with no profile still yields a valid (thin) fact sheet; margin and every cost field are absent from the derived queries **at the query, not by redaction**; two tenants cannot see each other's sheets; the nightly job appears in `workers.js`.

---

## S3 · Live Meeting — structured discovery capture

**Depends on:** S1. **Blocks:** nothing hard (S5 reads it if present).

Rebuild of the legacy **Supply Chain Diagnostic**: select lead, meeting date, location, then three named sections — business & operations context, pain points, proposed strategy — each with scripted probing questions and its own dictation control.

- Typed sections on `meeting_note` rather than free `body`
- Per-section dictation enqueues the existing `ai-transcribe` job; result lands in that section
- `meeting.transcript_vault_id` written by the worker, not the request body

**Out of scope:** anything reading these for generation.

**Done when:** a meeting can be recorded section by section, dictation round-trips to text, and the three sections are retrievable for a lead as a discovery set.

---

## S4 · Proposal record + composer (no AI)

**Depends on:** S1. **Blocks:** S5, S6.

The proposal as a document: header with all commercial terms, lines, narrative sections, and the existing `DRAFT → IN_REVIEW → SENT → ACCEPTED/REJECTED` lifecycle with its per-transition permissions.

- Line autocomplete against `dictionary_item` (the FK already exists on `proposal_line`) — decide explicitly whether unit price prefills; the legacy left it commented out
- EN/FR narrative editing side by side
- Numbering through `numbering.service`, not the legacy's `rand(100,999)`

**Out of scope:** generation, tokens, public pages, PDF.

**Done when:** a proposal can be created, edited, reviewed and accepted by hand end to end; accept produces a quotation with the right total; the lifecycle refuses skipped states.

---

## S5 · Proposal AI generation — G26

**Depends on:** S2, S4. Reads S3 if present.

- Content-generation service under `services/ai/`, called from `proposal.service`
- Prompt assembled from the tenant fact set (S2) plus the discovery sections (S3) plus a tone selector
- **Closed numbered fact set**; each generated claim references the fact it rests on; output citing an absent fact is rejected
- Zod validation per §10.3 — 2 retries, then fall back to a pre-filled manual form
- Both languages in one call
- `ai_generated` set by this path and nothing else

**Out of scope:** sending anything.

**Done when:** a draft generates from real tenant data; a deliberately malformed model response falls back to the manual form without the user seeing it; no cost or margin field appears anywhere in the outbound payload; sandbox runs against the low cap or mock vendor.

---

## S6 · Proposal delivery — token, public page, PDF — G21 + G30

**Depends on:** S4. Feeds S12.

- Signed, expiring, revocable token — **not** the legacy's 32-bit `SLAS-` + 8 hex
- Public `GET /proposals/public/:token` returning header, client, lines and bilingual narrative
- Client-facing page with EN/FR toggle
- **Server-side** PDF into the vault on `SENT`, written to `pdf_vault_id` — not the legacy's browser-side rasteriser
- Share action producing the link with copy and `wa.me` options, per PRD §11.5
- `viewed_at` / `downloaded_at` stamped by the public route

**Out of scope:** the shared public-surface infrastructure — that is S12. Build the route; S12 wraps it.

**Done when:** a token opens the proposal with no session, an expired or revoked token does not, the PDF in the vault matches the page, and opening it stamps `viewed_at` once.

---

## S7 · Lead intake and conversion — G31 + G32

**Depends on:** S1.

- Intake fields on the lead register with `intake_channel` and public ref
- Intake lifecycle expressed as `lead.status` values **kept distinct from `pipeline_stage`** — the legacy's single overloaded column is the thing we are not repeating
- KPI counters that partition the whole set (the legacy's five tiles account for 5 of 26 rows)
- Attachments on intake — single file plus multi-document, with orphan cleanup on rollback
- `convert` writes a complete `client_master` including `country`, `address`, `niu`, `rccm`; client type and payment terms prompted or from settings, **not** the legacy's hardcoded `BOTH` / 30 days

**Out of scope:** the public intake endpoint (S12).

**Done when:** KPI tiles sum to the total for every filter combination; a converted lead produces a client Finance can invoice without re-keying; no status value is ever valid as both an intake state and a pipeline stage.

---

## S8 · Pipeline / opportunity board — G28

**Depends on:** S1.

- Board reading the seven seeded stages including `PRICING_IN_PROGRESS`
- Per-stage count, value, weighted value; plus **pipeline value and win rate**, which the legacy has and the rebuild does not
- Keep the existing `moveStage` guards and settled-opportunity lock — better than the legacy's free-text status POST
- CSV export

**Out of scope:** campaign attribution (decision 6).

**Done when:** the board renders all seven stages, win rate matches a hand calculation on seeded data, and a settled opportunity refuses to move.

---

## S9 · Marketing campaigns — G34

**Depends on:** S1.

- Budget and currency, platform enum, owner, target service, remarks
- Plan vs actual on all three axes, manually keyed (decision 6)
- Four-tile KPI roll-up: total spend, total leads, total won, average conversion
- `PLANNED → PENDING_APPROVAL → ACTIVE` with `rejection_reason`, and the guard stopping a SALES user editing while pending
- CSV export
- Keep `campaign_sender`, `campaign_template`, `newsletter_subscriber` and `/campaigns/:id/send` — the legacy has no equivalent

**Done when:** a SALES user cannot edit a `PENDING_APPROVAL` campaign; rejection records a reason; the KPI tiles match a hand calculation.

---

## S10 · Inbound intake — G36

**Depends on:** S1.

- `contact_enquiry`: `enquiry_type`, `company_name`, `internal_notes`, `RESPONDED` state, KPI counters, type filter; keep the existing `triage → lead`
- `partnership_request`: `country_of_origin`, `network_memberships`, `contact_title`, `proposal_type`, corporate profile into the vault, `internal_notes`, KPI counters
- **Approving a `VENDOR_REGISTRATION` creates a DRAFT `supplier_master`** carrying company name, country, contact and the profile document, back-linked on the request

**Done when:** the created supplier is `registration_status: DRAFT`, has no COA auxiliary account, cannot be selected on a purchase order until someone with `approve` verifies it, and the partnership request shows the link.

---

## S11 · Success stories / portfolio builder — G25 + G35

**Depends on:** S1; S2 for the AI half.

- Eligible-ops picker restricted to `OPERATIONALLY_COMPLETED` / `FINANCIALLY_PENDING` / `CLOSED` — the legacy also offers `IN_PROGRESS`
- **Multi-dossier** via `success_story_dossier` (closes G25)
- Structured `exec_summary` / `ops_execution` / `hard_kpis`; cover, logo and gallery media
- AI story generation from real dossier data — **`margin` excluded at the query** (G27)
- Consent gate: `NAMED` renders the client name, anything else renders anonymised
- Keep the existing sign-off-before-publish gate
- Give the module a nav entry; nothing currently links to the legacy builder

**Done when:** a story binds to several dossiers; a client at `NOT_ASKED` renders anonymised without anyone remembering to set it; no cost or margin field reaches the model.

---

## S12 · Public surfaces — one pass — G6 + G17 + G21 + G35

**Depends on:** S6, S7, S11. **Blocking input:** the tenant #1 domain list.

Per decision 4, all five together on shared infrastructure:

| Surface | Route |
|---|---|
| Quote / lead intake | `POST /public/intake/quote` |
| Contact enquiry | `POST /public/intake/contact` |
| Partnership request | `POST /public/intake/partnership` |
| Newsletter subscribe | `POST /public/newsletter` |
| Shipment tracking | `GET /public/track/:ref` |
| Proposal by token | `GET /public/proposals/:token` |
| Portfolio | `GET /public/portfolio`, `GET /public/portfolio/:slug` |

Shared concerns, decided once: **per-tenant origin allowlist in Settings** (decision, 15 Aug), rate limiting, captcha or equivalent, anonymous upload policy and size caps, and **explicit column allow-lists on every read** — the legacy portfolio endpoint serves `SELECT s.*` to the world.

Tracking returns the client-visible subset only (`milestone_instance.is_client_visible` already exists), with the legacy's origin/destination fallback by service type — air `air_origin`/`air_dest`, sea `port_of_loading` falling back to `sea_pol`, hinterland `place_receipt`/`place_delivery`.

**Done when:** every public route is reachable without a session and returns only allow-listed columns; an origin outside the tenant's allowlist is refused; rate limits trip under a burst; a tracking reference belonging to another tenant returns nothing.

---

## Suggested session order

1. **S1** — nothing else starts cleanly without it.
2. **S7**, **S8**, **S9**, **S10** in any order — independent, self-contained, each testable alone. Good first sessions for anyone joining.
3. **S2** — then **S4**, then **S5**. This is the long pole; S2 is the prerequisite people will be tempted to skip.
4. **S3** any time after S1; it improves S5 but does not block it.
5. **S11** after S2.
6. **S6**, then **S12** last — S12 needs real surfaces to expose, and the domain list to exist.
