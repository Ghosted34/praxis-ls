# Sales & CRM — feature build

**Date:** 15 August 2026 · **Repo re-read at:** `9852d4c5`
**Supersedes** `SALES_CRM_BUILD_SPLIT.md` and `SALES_CRM_SESSION_PROMPTS.md`.

Fourteen features. Each is a **vertical slice** — it owns its own migration, service, routes, UI and tests, and ships working on its own. No shared foundation session.

Each block below is a complete, self-contained prompt. Paste **Block A**, then one feature block. Nothing else to read.

---

## Dependencies

Only four exist. Everything else can be built in any order.

```
F2 Company Profile ──┐
F3 Proposal Builder ─┴── F4 Proposal Generation
F3 Proposal Builder ───── F5 Proposal Sharing
F11 Success Stories ───── F12 Public Portfolio
F6 Lead Register + F9 + F10 ── F13 Public Intake
```

`F1 · F6 · F7 · F8 · F9 · F10 · F11 · F14` — independent, start any time.

---

# BLOCK A · preamble (paste first, every session)

```
You are building ONE feature of the Sales & CRM module on Praxis-LS. The
feature block that follows this preamble is the complete specification — you do
not need to read any planning document.

## Ground rules

VERTICAL SLICE. This feature owns its own migration, service, repo, controller,
routes, validator, events, and UI. Do not create a shared "schema pass" or defer
columns to another session. When you are done, this feature works.

FOLLOW THE HOUSE PATTERN. Read src/modules/sales/lead/ first — every module is
.service / .repo / .controller / .routes / .validator / .events / .ai. Match it
exactly. Read doc/CONVENTIONS.md and doc/BUILD_CONVENTIONS.md for naming, and
doc/DB_ARCHITECTURE.md for schema conventions. If the feature has UI, read
doc/FRONTEND_GUIDE.md and doc/FE_DESIGN_RULES.md.

*.ai.js FILES ARE NOT AI GENERATORS. They register the module's operations in
the function-calling tool catalogue for the assistant. Adding a feature means
adding its operations there too.

LEGACY IS THE BEHAVIOURAL SPEC, NOT THE IMPLEMENTATION. The legacy PHP is at
doc/reference/legacy_codebase/. Your block names the exact files and line
numbers. Read them to learn what the feature does for a user. Do NOT port: raw
SQL, hard-coded credentials, free-text status writes with no transition guard,
hard deletes. Where this system already has a stricter pattern — lifecycle
guards, per-transition permissions, audit and event emission, transactional
multi-table writes — keep this system's.

## Two rules that override everything

1. No cost or margin field may reach an external model. The exclusion is written
   into the SQL query, not applied afterwards.
2. No status value may be valid as both an intake state and a pipeline stage.
   The legacy overloads one column for both; that is the specific mistake we are
   not repeating.

## Settled decisions — do not revisit

- Clean start. No legacy data is being migrated. You have no mapping obligation
  and no legacy ref format to preserve. Use the system's numbering service.
- French columns land in the schema now. The app-wide language toggle is
  separate work — do not build it.
- Campaign performance figures are hand-entered. No campaign attribution link.
- Company profile is per-tenant configuration, never hard-coded.
- Client consent for public naming is three-state: NOT_ASKED / ANONYMISED_ONLY /
  NAMED, defaulting to NOT_ASKED, which renders as anonymised.

## Questions

You may ask AT MOST THREE questions, and only about business rules you cannot
determine from the code or the legacy — who approves what, what a user is
allowed to do, what a field means to the business.

Do NOT ask about technical choices. Column types, table vs child table, jsonb vs
relation, component layout, file naming, test structure, enum vs text-plus-check
— you own all of these. Decide, and state the decision in one line.

If you have no business-rule questions, say so and start building.

## Definition of done

The feature works end to end, its migration applies twice cleanly, its tests
pass, and it is reachable from the UI. State in one paragraph what you built and
any decision you took that someone might disagree with.
```

---

# F1 · Live Meetings

```
Build structured client-discovery capture on meetings.

## What the feature is

A salesperson opens a meeting record against a lead, and captures the meeting in
three named sections rather than one free-text box: business and operations
context, pain points, and proposed strategy. Each section can be typed or
dictated. The three sections are the raw material a proposal is later drafted
from, so they are structured data, not notes.

## Legacy behaviour to match

doc/reference/legacy_codebase/administration/view/admin/smart-quote-leads.php
  - openMeetingWizard()  ~line 1061 — the "Supply Chain Diagnostic / Client
    Discovery Framework" modal: select lead, meeting date, location, then the
    three sections.
  - saveMeetingNotes()   ~line 1092
  - toggleDictation()    ~line 1744, stopRecording() ~1799, processAudio() ~1805

doc/reference/legacy_codebase/administration/api/smart_quote_api.php
  - case 'save_meeting_notes'  ~line 268 — writes meeting_ops, meeting_pain,
    meeting_strategy.
  - case 'transcribe_audio'    ~line 471 — Groq whisper-large-v3, base64 webm to
    an ephemeral temp file, unlinked immediately after.

Each section in the legacy prints scripted probing questions above the input —
"What is the core nature of your imported/exported goods (perishables, heavy
equipment, standard retail)?", "What are your average monthly container/tonnage
volumes?", "Who are your primary end-users, and how critical is delivery timing
to your revenue?". These prompts are part of the feature; a blank box gets blank
answers.

## What exists here already

migrations/tenant/0350_sales_crm.sql
  - `meeting` at line 23 — has transcript_vault_id
  - `meeting_note` at line 33 — meeting_id, author_id, body, is_minutes

src/modules/sales/meeting/meeting.service.js line 10 — transcript_vault_id is
read from the REQUEST BODY. Nothing enqueues transcription.

The transcription machinery already works and is governed:
  - src/jobs/handlers/ai-transcribe.js
  - src/services/ai/transcription.service.js
  - src/modules/ai/governance/ applies the caps

## Build

- Typed discovery sections replacing free-text `body` for discovery notes.
  Keep `meeting_note` usable for ordinary minutes.
- Meeting location, which the current schema lacks and the legacy captures.
- Per-section dictation that enqueues ai-transcribe and lands the returned text
  in that section. The worker writes transcript_vault_id, not the caller.
- Seeded probing-question prompts per section, editable per tenant.
- A retrievable "latest discovery set" for a lead — a later feature reads it.

## Done when

A meeting is captured section by section against a lead; dictation round-trips
audio to text into the correct section; a section with audio whose transcription
failed is visibly in that state rather than silently empty; and the discovery set
for a lead can be fetched in one call.
```

---

# F2 · Company Profile

```
Build the per-tenant company profile that AI-drafted content is grounded in.
This exists in neither system in usable form.

## What the feature is

Every tenant needs a machine-readable description of itself — what it does, how
big it is, what it has done before — so that generated proposals and case
studies state facts rather than invent them. Today the legacy holds this as
1,200 characters of one company's facts hard-coded into a PHP string.

## What is being replaced

doc/reference/legacy_codebase/administration/api/smart_quote_api.php lines
152-164. Read it. It carries: slogan, operating regions and gateways, warehouse
square metreage, fleet size, a clearance-time benchmark, industry
specialisations, network memberships, three named past projects with their
metrics, and a turnover figure.

Every one of those is a different KIND of fact and they do not share a source.

## Three layers — build them separately

DECLARED. Slogan, positioning, memberships, certifications, service promises.
Human-authored. Collected by a form, and by PDF upload where extraction fills
THE SAME FIELDS with per-field human confirmation — never a text blob alongside
the structured data, because then two sources disagree and the longer one wins.

DERIVED. Recomputed from the tenant's own data by PURE SQL — no model:
  - fleet count and composition (the vehicle registry)
  - warehouse capacity (space and location management)
  - top lanes by origin/destination frequency across dossiers
  - vertical mix by service type and commodity
  - average clearance time from milestone timestamps
  - client count, and turnover band from the ledger
Typed fields, not prose. Each carries computed_at. Refresh nightly, top up
automatically when the sheet is stale at the point of use, and expose a manual
refresh. Show the as-of date wherever the sheet is consumed.

CONSENT. `public_reference_consent` on client_master — NOT_ASKED /
ANONYMISED_ONLY / NAMED, default NOT_ASKED, which renders anonymised. Set it
through the existing approve-gated client flow; read
src/modules/master/client_master/client_master.routes.js — /verify, /block and
the change-request endpoints are already there, so this needs no new workflow.

## Hard constraints

- Margin and every cost field are excluded IN THE DERIVED QUERIES. Not
  redacted downstream — never selected.
- Schema-scoped. One tenant seeing another's facts is a commercial incident.
- Refresh respects the sandbox AI cap even though the sheet itself uses no model.

## Done when

A tenant with an empty profile still produces a valid thin fact sheet; the
derived figures match hand-run SQL; no cost or margin column appears in any
derived query; two tenants cannot reach each other's sheets; the nightly refresh
is registered in src/jobs/workers.js.
```

---

# F3 · Proposal Builder

```
Build the proposal as a document a salesperson composes by hand, end to end. No
AI, no client-facing link, no PDF — those are separate features.

## What the feature is

A commercial proposal for a logistics job: who it is for, what the shipment is,
what the commercial terms are, a priced line list, and narrative sections in
English and French. It moves through draft, review, sent, and accepted or
rejected.

## Legacy behaviour to match

doc/reference/legacy_codebase/administration/view/admin/smart-quote-leads.php
  - openProposalEditor()        ~line 1209
  - addProposalRow / removeProposalRow / updateRowData / renderProposalTable
                                 ~lines 1266-1330
  - searchDictionaryForLine()   ~line 1334 — line descriptions autocomplete
    against the financial dictionary
  - selectDictionaryItem()      ~line 1371 — note the unit-price prefill is
    COMMENTED OUT. Decide deliberately whether to enable it.
  - openEditChoice()            ~line 1444 — on a lead that already has a
    proposal, the edit action offers "edit lead" or "edit proposal"
  - saveProposal()              ~line 1543
  - EN/FR preview tabs at lines 608-630

doc/reference/legacy_codebase/administration/api/smart_quote_api.php
  - case 'save_proposal'   ~line 303 — shows every column the proposal carries
  - case 'fetch_proposal'  ~line 240

## Commercial terms the legacy proposal carries and this system does not

language, currency, service_category, incoterm, origin_location,
destination_location, cargo_description, estimated_weight, project_cargo_flag,
customs_clearance_target, transit_time_target, free_days_demurrage,
payment_conditions, validity_days, converted_client_id, converted_quote_id.

Narratives additionally keep the raw inputs beside the output —
raw_client_operations, raw_pain_points, raw_proposed_strategy, raw_tone — which
is what makes redrafting in a different tone possible without re-interviewing
the client.

## What exists here already

migrations/tenant/0350_sales_crm.sql
  - `proposal` line 62 — doc_number, lead_id, client_id, opportunity_id, title,
    status, ai_generated, reviewed_by, pdf_vault_id. No commercial terms.
  - `proposal_line` line 76 — ALREADY has dictionary_item_id. The relation you
    need exists; the autocomplete does not.
  - `proposal_narrative` line 84 — (section, body, sort_order). No language.

src/modules/sales/proposal/ — the lifecycle DRAFT → IN_REVIEW → SENT →
ACCEPTED/REJECTED with per-transition permissions, accept → quotation. Keep all
of it. The legacy has no review state and this system's is better.

## Do not port

proposal_ref in the legacy is 'QT-' . date('Ymd') . '-' . rand(100,999) —
random, and it collides within a day. Use the numbering service.

## Build

- Commercial-term columns, and language on narratives so EN and FR coexist.
- Composer with the line table, dictionary autocomplete, and EN/FR narrative
  editing side by side.
- Raw narrative inputs stored alongside generated output.

## Done when

A proposal is created, priced, reviewed, sent and accepted entirely by hand;
accept produces a quotation with the correct total; the lifecycle refuses a
skipped state; a line picked from the dictionary carries its relation, not just
its text.
```

---

# F4 · Proposal Generation

```
Build AI drafting of proposal narrative. Requires the Company Profile feature
and the Proposal Builder feature to exist first.

## What the feature is

A salesperson enters rough notes — what the client does, what hurts, what we
propose — picks a tone, and gets back a polished bilingual proposal narrative
they then edit and send. The point is that it states real facts about the
company and invents nothing.

## Read the legacy prompt closely

doc/reference/legacy_codebase/administration/api/smart_quote_api.php lines
139-237, case 'generate_ai_content'. The prompt is the asset. It contains:

  - The company-facts block (lines 152-164). This does NOT get ported — it comes
    from the tenant Company Profile feature.
  - Four case-study archetypes — ENERGY, PHARMA, HEAVY, SANITIZED — each with a
    fixed set of permitted metrics and an instruction never to invent others.
    This structure DOES get ported.
  - Exactly four SLAs on fixed themes (customs, visibility, cost/transit,
    handling) with titles under 30 characters and values under 40, because they
    render into a fixed-width table. These constraints DO get ported.
  - Both languages produced in a single call, returned as one JSON object with
    _en and _fr pairs.
  - JSON forced at the API level, plus a regex stripping markdown fences for
    when the model disobeys anyway.

## What exists here

Nothing. src/modules/sales/proposal/proposal.ai.js is a tool-catalogue
registration, not a generator — it exposes list/get/draft/transition/accept to
the assistant. Narratives arrive from the request body, so `ai_generated` is a
flag the caller asserts about itself.

Read before designing: src/services/ai/llm.service.js, src/services/ai/redact.js,
src/modules/ai/governance/.

## Build beyond what the legacy does

- Ground the prompt in a CLOSED, NUMBERED fact set from the company profile.
  Require each generated claim to reference the fact it rests on. Reject output
  citing a fact that is not in the set. "Never invent metrics" as prose is what
  the legacy does and it is not enough.
- Validate the model's JSON against a strict schema. On failure the agent
  re-prompts itself, capped at two retries, then falls back to a pre-filled
  manual form. The user never sees a broken payload.
- `ai_generated` is set by this path and by nothing else.
- Sandbox runs against the hard low cap or a mock provider.
- Read the meeting discovery sections for the lead as generator input if they
  exist.

## Done when

A draft generates from real tenant data and real discovery notes; a deliberately
malformed model response reaches the manual form without the user noticing; no
cost or margin value appears anywhere in the outbound payload; a sandbox run
does not spend live credits.
```

---

# F5 · Proposal Sharing

```
Build client-facing proposal delivery. Requires the Proposal Builder feature.

## What the feature is

Sales sends a prospect a link. The prospect opens their branded proposal in a
browser with no account, no password and no portal invite, reads it in English
or French, and downloads a PDF. Sales can see that they opened it.

## Legacy behaviour to match

doc/reference/legacy_codebase/administration/api/public_quote_api.php — 101
lines, read all of it. It is the public payload: header, client, priced lines,
and the bilingual narrative with SLA arrays decoded.

doc/reference/legacy_codebase/public_html/quote.php
  - fetchProposalData()  ~line 247 — reads ?token= and ?lang=
  - renderDocument()     ~line 290 — paginated A4 layout, EN/FR toggle
  - generatePDF()        ~line 617

doc/reference/legacy_codebase/administration/view/admin/smart-quote-leads.php
  - showShareModal()  ~line 1634 — builds the link, pre-fills the lead's phone
    and a covering message
  - sendWhatsApp()    ~line 1673 — opens wa.me with the encoded message

## Four legacy defects to correct, not reproduce

1. The token is 'SLAS-' plus 8 hex characters — 32 bits of entropy, no expiry
   column, no revocation. Build signed, expiring, revocable.
2. The PDF is generated in the visitor's browser by rasterising each page to a
   JPEG. It is unsearchable, unsigned, never uploaded, and the server never sees
   it. This system has a server-side PDF kit with bilingual templates and XAF
   formatting — use it, write the result to pdf_vault_id on send.
3. There are TWO public token endpoints; the one in smart_quote_api.php at line
   32 omits narratives entirely. Build one.
4. A quote_downloaded.php exists in the legacy but nothing calls it — there is
   NO open tracking today. viewed_at and downloaded_at are new capability, not
   restoration.

## Build

- Token minting, expiry and revocation on the proposal.
- One public route returning header, client, lines and bilingual narrative
  through an explicit column allow-list.
- Client-facing page with a language toggle, defaulting to the proposal's own
  language, overridable by query string.
- Server-side PDF into the vault on send.
- Share action producing the link with copy and wa.me options — this system's
  convention is that phone contact opens WhatsApp rather than in-app calling.
- viewed_at and downloaded_at stamped by the public route.

## Public-route pattern

src/modules/hr/careers/careers.routes.js is the reference implementation for an
unauthenticated tenant module — rate limiting via src/shared/http/rate-limit.js,
allow-list responses, uniform 404s on every refusal, tenant resolved by host.
Read its header comment before writing yours; follow it.

## Done when

A token opens the proposal with no session; an expired or revoked token returns
the same 404 as a nonexistent one; the vaulted PDF matches the rendered page;
opening stamps viewed_at once; the routes are rate limited.
```

---

# F6 · Lead Register and Quote Intake

```
Build the lead register, quote-request intake, and conversion to a client.

## What the feature is

Two things that are one journey. A request for a quote arrives — from the
website or keyed in by staff — carrying the whole logistics scope. Staff work
it, and when it becomes real, convert it into a client and an opportunity.

## Legacy behaviour to match

doc/reference/legacy_codebase/administration/view/admin/smart-quote-intake.php
  - The intake register: reference, date, requester, service, route, weight,
    status, attachment, and a Manage drawer.
  - The manual-entry drawer carries: public ref (auto), status, requester name,
    company, email, phone, service type, INCOTERM (required), origin,
    destination, warehouse location, warehouse duration.
  - Five KPI tiles: total, received, under review, quoted, converted.
  - Filters: search, status, month, year. CSV export.

doc/reference/legacy_codebase/administration/view/admin/smart-quote-leads.php
  - The lead register and the Register New Lead modal ~line 1135: company name,
    contact person, phone, email, country, headquarters address, NIU (tax id),
    RCCM (trade register).

doc/reference/legacy_codebase/administration/api/smart_quote_api.php
  - case 'convert_lead' ~line 389 — writes client_master, allocates a public
    reference, creates the quote record and back-links, all in one transaction.

## THE CONSTRAINT THAT DEFINES THIS FEATURE

Read chipStatus() at smart-quote-intake.php lines 701-717. It prefixes a status
with "SP-" whenever the row has been converted, then prints the raw value. And
read api/sales_pipeline/_common.php line 24, which maps RECEIVED to NEW on read.

The legacy stores intake statuses AND pipeline stages in the same column. One
row, one column, two state machines. That is why the live system's KPI tiles
show 5 of 26 rows — the other 21 hold pipeline stages that no intake counter
matches, and "converted: 0" is false.

Intake lifecycle belongs on the lead. Pipeline stages belong on the pipeline.
Never both. KPI counters must partition the whole set.

## Also do not port

- convert_lead hard-codes client type to 'BOTH' and payment terms to 30 days
  regardless of the lead. Prompt, or take from settings.
- isConverted is computed two different ways — from the converted-opportunity id
  in the row renderer at line 847, and from the status value in the drawer at
  line 1019 — so a converted row greys out in the list while the drawer still
  offers Convert.

## What exists here

migrations/tenant/0350_sales_crm.sql `lead` at line 7 — company_name,
contact_name, email, phone, source, service_interest, status, owner_user_id,
client_id, details_json. Missing: country, address, niu, rccm, and every
logistics-scope field.

src/modules/sales/lead/ — has convert, mapping email and name only.

## Build

- Country, address, NIU and RCCM on the lead — these are what make a complete
  client on conversion, and without them Finance re-keys them by hand.
- The logistics-scope intake fields, an intake channel, and a public reference
  from the numbering service.
- Attachments on intake — single file and multiple documents, with cleanup if
  the write rolls back.
- KPI tiles that sum to the total under every filter combination.
- Conversion producing a client complete enough to invoice.

## Done when

The KPI tiles account for every row; a converted lead yields a client Finance
does not have to complete; no status value is accepted as both an intake state
and a pipeline stage; an attachment upload that fails leaves no orphan.
```

---

# F7 · Sales Pipeline

```
Build the opportunity pipeline board.

## What the feature is

A kanban of open deals by stage, with the money on it — what the pipeline is
worth, and how often deals are won.

## Legacy behaviour to match

doc/reference/legacy_codebase/administration/view/admin/sales-pipelining.php
  - STAGES at line 514 and STAGE_CONFIG at 515-520. Note each stage carries a
    win probability: new 10, qualified 30, pricing 50, quote sent 70, won 100.
  - KPI render at lines 590-591 — pipeline value in millions, and win rate.
  - Card fields: reference, title, client, value, stage, source, scope, updated.
  - CSV export ~line 803.
  - An "Attribution (Locked)" tab at lines 399 and 459 — ignore it; it ships the
    literal string 'N/A' at line 581 and was never implemented.

doc/reference/legacy_codebase/administration/api/sales_pipeline/_common.php
  - line 26 — the permitted stages: NEW, QUALIFIED, PRICING_IN_PROGRESS,
    QUOTATION_SENT, NEGOTIATION, WON, LOST.

## What exists here

migrations/seeds/9030_seed_reference.sql line 17 seeds SIX stages — NEW,
QUALIFIED, PROPOSAL, NEGOTIATION, WON, LOST.

The legacy has seven. The missing one is PRICING_IN_PROGRESS, and it is not
decorative — it means "with the margin simulator", the handoff from sales to
commercial pricing, and it carries a 50% probability. The live system has
records sitting in it right now.

migrations/tenant/0350_sales_crm.sql `opportunity` at line 101 and
`pipeline_stage` at line 93. src/modules/sales/opportunity/ has a board endpoint
giving per-stage count, value and weighted value.

## Build

- Seed the missing stage with its sort order and probability.
- Pipeline value and win rate, which the legacy has and this system does not.
- Opportunity source and a scope summary on the card.
- CSV export.
- Keep this system's stage-transition validation, auto-settle on won or lost,
  and the lock on settled opportunities. The legacy accepts any status by POST
  with no guard — that is a regression, not a feature.

## Not in scope

Campaign attribution. Performance figures are hand-entered by decision.

## Done when

Seven stages render; win rate matches a hand calculation on seeded data; a
settled opportunity refuses to move; the export opens in Excel with the money
columns typed as numbers.
```

---

# F8 · Marketing Campaigns

```
Build the campaign register as a budget-and-performance record.

## What the feature is

Marketing plans a campaign, sets a budget and targets, gets it approved, runs
it, and records what it produced. The register answers "what did we spend and
what did we get".

## Legacy behaviour to match

doc/reference/legacy_codebase/administration/view/admin/market-campaign-registration.php
  - Platform enum at lines 599-604: META, GOOGLE, LINKEDIN, EMAIL, OFFLINE,
    OTHER.
  - Statuses at lines 608-612: PLANNED, PENDING_APPROVAL, ACTIVE, PAUSED,
    COMPLETED.
  - budget_amount ~774, rejection_reason ~807, target_service ~866, owner_name
    ~867, remarks ~870, and targets for leads / opportunities / won at 871-873.
  - Four KPI tiles: total spend, leads generated, deals won, average conversion.
  - Filters on campaign name/owner, platform, status. CSV export.
  - A guard stopping a sales-role user editing a campaign while it is pending
    approval.

The live screen prints its own honesty notice: "Performance metrics (Leads,
Wins) are currently in Manual Entry Mode. Update these figures weekly based on
external ad manager reports." Reproduce that — the UI should say the numbers are
hand-entered rather than implying they are measured.

## What exists here

migrations/tenant/0350_sales_crm.sql `marketing_campaign` at line 43 — name,
channel (free text), status (DRAFT/ACTIVE/PAUSED/ENDED), starts_on, ends_on,
assets_json. It is an email-sending record, not a budget record.

Keep everything this system has that the legacy does not: campaign_sender,
campaign_template (migrations/tenant/0452_campaign_templates.sql),
newsletter_subscriber, and the send endpoint. None of it should regress.

## Build

- Platform, owner, target service, budget with currency, remarks.
- Targets and actuals for leads, opportunities and deals won — hand-entered.
- The four KPI tiles.
- PLANNED and PENDING_APPROVAL added to the lifecycle, with a rejection reason
  and the edit guard while pending.
- CSV export.

## Not in scope

Linking leads to campaigns to derive the actuals. Decided: figures stay manual.

## Done when

A sales-role user cannot edit a campaign awaiting approval; rejecting one
records a reason; the KPI tiles match a hand calculation; sending a campaign
email still works exactly as it does today.
```

---

# F9 · Contact Enquiries

```
Build the contact enquiry desk.

## What the feature is

Messages from the website's contact form arrive, get classified, get answered,
and either close or become a lead.

## Legacy behaviour to match

doc/reference/legacy_codebase/administration/view/admin/contact-us-intake.php
and its api/ folder.

  - enquiry_type: GENERAL_ENQUIRY, PARTNERSHIP, CAREERS, MEDIA. The register
    filters on it.
  - company_name alongside the personal contact.
  - internal_notes, capped at 5000 characters.
  - Statuses NEW, READ, RESPONDED, CLOSED.
  - Four KPI tiles: total messages, new/unread, responded, closed.
  - A Manage action per row.

## What exists here

migrations/tenant/0350_sales_crm.sql `contact_enquiry` around line 122 — name,
email, phone, subject, message, source, status, lead_id.

Statuses are NEW / TRIAGED / CLOSED, so there is no way to record that someone
replied — and the KPI row needs exactly that.

src/modules/sales/inbound_intake/ has triage-to-lead conversion, which the
legacy does not. Keep it.

## Build

- enquiry_type, company_name, internal_notes.
- A RESPONDED state, so the four KPI tiles can be computed.
- Type and status filters, and the KPI row.
- Keep triage-to-lead.

## Done when

Every enquiry falls into exactly one KPI tile; the type filter works; replying
to an enquiry is distinguishable from having merely read it.
```

---

# F10 · Partnership Requests and Vendor Onboarding

```
Build the partnership intake desk, and wire an approved vendor into the supplier
register.

## What the feature is

Forwarding agents and vendors apply to work with the company. Someone vets the
application, and on approval the vendor starts existing as a supplier — as a
draft that still has to be verified before anything can be bought from them.

## Legacy behaviour to match

doc/reference/legacy_codebase/administration/view/admin/partnership-portal-intake.php
and its api/ folder.

  - country_of_origin.
  - network_memberships, a JSON array — WCA, JCTrans and similar. This is how a
    forwarding agent is actually vetted; it is the most load-bearing field on
    the form.
  - contact_title.
  - proposal_type: AGENCY_PARTNERSHIP or VENDOR_REGISTRATION.
  - corporate_profile_ref — an uploaded company profile document.
  - internal_notes.
  - Statuses NEW, IN_REVIEW, APPROVED, REJECTED.
  - Four KPI tiles: total proposals, agency partnerships, vendor registrations,
    pending review.

## What exists here

migrations/tenant/0350_sales_crm.sql `partnership_request` around line 131 —
company_name, contact_name, email, proposal_text, status. Almost nothing.

## The vendor link — read this before designing

The live legacy screen prints: "This module captures intake only. It does not
auto-create suppliers. Approved vendors must be manually onboarded in the
Supplier Master Registry."

That is a limitation of the legacy, not a control worth preserving. Read
src/modules/master/supplier_master/supplier_master.service.js — create() sets
registration_status to "DRAFT", POST /:id/verify is gated on the approve
permission, block and unblock take a reason, changes in live open a
maker-checker request, and the auxiliary accounting account is only allocated on
activation. The gate the legacy achieves by making a human retype everything
already exists in the module.

So approving a VENDOR_REGISTRATION creates a DRAFT supplier carrying the company
name, country, contact and the uploaded profile document, back-linked on the
request. Nothing becomes payable and no purchase order can draw on it until
somebody with the approve permission verifies it.

## Build

- The missing fields, the KPI tiles, and type/status filters.
- The corporate profile document into the vault.
- Approval of a vendor registration creating the draft supplier and the
  back-link.

## Done when

The created supplier is in DRAFT with no accounting account; it cannot be picked
on a purchase order until verified; the partnership request shows the link; an
approval where the company already exists as a supplier does not create a
duplicate.
```

---

# F11 · Success Stories Builder

```
Build the case-study composer.

## What the feature is

A completed job becomes a written case study. Someone picks the operations files
it covers, adds rough notes, gets a draft written from the real shipment data,
adds images, and it goes through sign-off before it can be published.

## Legacy behaviour to match

doc/reference/legacy_codebase/administration/view/admin/success-stories-builder.php
  - Note: NOTHING in the entire legacy codebase links to this file. It is
    reachable only by typing the URL. Give the rebuilt feature a navigation
    entry.

doc/reference/legacy_codebase/administration/api/success_story_api.php
  - fetch_eligible_ops  ~line 33 — the picker of operations files
  - generate_story      ~line 130 — drafts from real shipment data
  - upload_assets       ~line 198 — cover image, client logo, gallery
  - save_story          ~line 233 — allocates a story reference, writes the
    story and its operations-file links

The story itself is structured, not free prose: a headline, an executive
summary, an operations-execution section, and three or four hard KPIs as
label/value pairs rendered as a strip. It also carries a slug, a client link and
a logo, a service category, a cover image and a gallery.

## THREE DEFECTS TO FIX, NOT PORT

1. THE MOST IMPORTANT LINE IN THIS FEATURE. generate_story at line 139 selects
   `margin` from the operations file and interpolates it into the prompt sent to
   an external model — to write a public marketing page. Exclude margin and
   every cost field IN THE QUERY.

2. fetch_eligible_ops offers files that are still IN_PROGRESS, so a case study
   can be published about a job that has not finished. Restrict to completed,
   financially-pending and closed.

3. The legacy binds one story to MANY operations files through a join table.
   This system's success_story has a single dossier reference, so "we moved 40
   containers over six months" loses 39 of its receipts. Build the join.

## What exists here

migrations/tenant/0350_sales_crm.sql `success_story` around line 140 — title,
dossier_id, summary, body, ai_generated, is_published, signed_off_by,
published_at. No slug, no client, no media, no structure.

src/modules/sales/success_story/ has a sign-off-before-publish gate the legacy
lacks. Keep it.

## Consent

A client may only be named if their consent state is NAMED. Anything else
renders anonymised — the legacy already has this shape as its "sanitised" case
study archetype, it simply never checks anything.

## Build

- Slug, client link, service category, the three structured sections, KPI pairs.
- Cover image, client logo, gallery.
- Multi-dossier binding.
- The eligible-file picker, correctly scoped.
- AI drafting from real shipment data, with cost and margin excluded at source.
- A navigation entry.

## Done when

A story binds to several operations files; a client whose consent is unset
renders anonymised without anyone remembering to set anything; no cost or margin
value reaches the model; an unsigned story cannot be published.
```

---

# F12 · Public Portfolio

```
Build the public-facing case-study pages. Requires the Success Stories feature.

## What the feature is

The company's published case studies, on the public website, updated by
marketing without anyone touching code.

## Legacy behaviour to match

doc/reference/legacy_codebase/administration/api/public_portfolio_api.php
  - get_all_stories    ~line 32 — published only, lightweight: slug, title,
    service category, cover image, client logo, client name, publish month.
    Deliberately thin so the grid loads fast.
  - get_story_details  ~line 55 — by slug, the full read.

doc/reference/legacy_codebase/public_html/portfolio.php — the grid.
doc/reference/legacy_codebase/public_html/portfolio-case.php — the detail page.

## Two defects to fix

1. get_story_details at line 62 runs SELECT s.* on an unauthenticated endpoint
   with Access-Control-Allow-Origin set to *. Every column of the story table,
   including internal authoring fields, goes to anyone with a slug. Return an
   explicit allow-list.
2. Nothing checks client consent before printing a client's name.

## The pattern to follow

src/modules/hr/careers/careers.routes.js is this system's reference
implementation of an unauthenticated tenant module. Read its header comment in
full — it states the three questions to ask of any public endpoint. It uses
rate limiting from src/shared/http/rate-limit.js with separate read and write
ceilings, builds responses from an allow-list rather than a row, returns the
same 404 for every refusal so nothing can be enumerated, resolves the tenant by
host, and sets feature: null so that links already indexed by search engines
survive a feature flag being switched off. A portfolio has exactly those
properties.

client/src/features/careers/careers-page.tsx and client/src/lib/careers-api.ts
are the front-end half of the same pattern.

## Build

- Public list and detail routes, allow-listed, rate limited, published-only.
- Grid and detail pages.
- Consent honoured — a client whose state is not NAMED renders anonymised,
  including their logo.

## Done when

Both routes answer with no session; an unpublished or nonexistent slug returns
the same 404; no column outside the allow-list appears in any response; a burst
trips the rate limit; a non-consenting client is anonymised.
```

---

# F13 · Public Website Intake

```
Build the unauthenticated endpoints the marketing website posts into. Requires
the Lead Register, Contact Enquiries and Partnership Requests features.

## What the feature is

The website's forms feed the CRM directly. Today the old system takes these; the
new one has no way to receive them, which means the website cannot be pointed at
it.

## Legacy surfaces

doc/reference/legacy_codebase/public_html/smart-quote.php
  → administration/api/public/quote-request.php   (quote requests)
doc/reference/legacy_codebase/public_html/ contact form
  → administration/api/public/contact-enquiry.php (contact enquiries)
doc/reference/legacy_codebase/public_html/index.php partner section
  → administration/api/partner/submit_partnership.php

Four endpoints in total: quote request, contact enquiry, partnership
application, newsletter subscribe.

## Current state

Every route in this system sits behind authentication except the careers module.
There is no way for a website to submit anything.

## The pattern to follow

src/modules/hr/careers/careers.routes.js — and specifically its apply endpoint,
which is the closest analogue: an anonymous write that creates a row and accepts
a file. Read the reasoning in its header comment and the rate-limit ceilings it
chose and why (a high limit for reads because crawlers and refreshes are
legitimate; a low one for writes because nobody legitimately applies six times
an hour from one address). Every field is length-bounded in the validator.

## Decide once, for all four

- Rate limiting per endpoint, with reads and writes on separate ceilings.
- Spam handling.
- Whether anonymous file upload is permitted on quote requests at all — the
  legacy allows attachments with a size cap and an extension deny-list — and if
  so, what scans them.
- Length bounds on every field.

## Build

- The four endpoints, following the careers module's structure exactly.
- Submissions landing as leads, enquiries and partnership requests with an
  intake channel marking them as website-sourced.
- Newsletter subscribe against the existing subscriber table.

## Done when

All four accept a submission with no session and reject an oversized or
malformed one; a burst trips the limit; a submission from one tenant's site
cannot land in another tenant's data; a rejected upload leaves nothing behind.
```

---

# F14 · Public Shipment Tracking

```
Build tracking a shipment by reference, with no account.

## What the feature is

A client types their file reference into the website and sees where their cargo
is. This is a top-level item in the live site's navigation today and the home
page routes straight to it — so it stops working the moment the old system is
switched off.

## Legacy behaviour to match

doc/reference/legacy_codebase/public_html/smart-track.php
  → administration/api/public_track/get.php

Unauthenticated, keyed on the file reference alone. Returns the milestone
timeline — fourteen stages with due date, completion, location, reference and
notes — plus a computed status and the current stage.

Origin and destination labels resolve differently per service type:
  - air        → air origin / air destination
  - sea        → port of loading, falling back to the sea port-of-loading field
  - hinterland → place of receipt / place of delivery

Reproduce that fallback chain; a shipment with the wrong labels reads as broken.

## What exists here

Milestone instances already carry a client-visible flag — use it. The tracking
route returns only the client-visible subset, never the internal timeline.

There is no unauthenticated tracking path. The only public tenant module is
careers.

## The pattern to follow

src/modules/hr/careers/careers.routes.js. Note especially its handling of
lookup-by-token: every refusal returns the same 404, so the endpoint cannot be
used to discover which references exist. A shipment reference is guessable in a
way a minted token is not, so rate limiting here is doing real work.

## Build

- Public tracking by reference, rate limited.
- The client-visible milestone subset only, with location, stage reference and
  progress notes per stage.
- The origin/destination fallback by service type.
- No client name in the response unless the reference matches exactly.

## Done when

A valid reference returns the timeline with no session; an invalid one and one
belonging to another tenant return the identical 404; internal-only milestones
never appear; a burst of guessed references trips the limit.
```

---

## Suggested order

Nothing forces a sequence except the four dependencies. A reasonable run:

1. **F6 Lead Register** — the front of the funnel, and the largest single
   correction. Nothing depends on it except public intake.
2. **F1 Live Meetings**, **F7 Sales Pipeline**, **F8 Campaigns**,
   **F9 Enquiries**, **F10 Partnerships** — five independent features, any
   order, good for parallel sessions.
3. **F3 Proposal Builder**, then **F5 Proposal Sharing**.
4. **F2 Company Profile**, then **F4 Proposal Generation**. F2 is the one that
   will be tempting to skip because it produces nothing visible on its own —
   F4 without it generates invented facts.
5. **F11 Success Stories**, then **F12 Public Portfolio**.
6. **F13 Public Intake** and **F14 Public Tracking** last. F14 is the one with a
   hard external deadline: it is in the live website's navigation today.
