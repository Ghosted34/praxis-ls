# Sales & CRM — session prompts

Paste **Block A** then the block for the session you're starting. Each is self-contained.

---

# BLOCK A · shared preamble (paste first, every session)

```
You are picking up one unit of a Sales & CRM (Group IV) rebuild on Praxis-LS.
Read for context BEFORE proposing anything. Do not write code yet.

## Read first — plan and decisions
- doc/SALES_CRM_BUILD_SPLIT.md — the twelve-session split. Find your session; it
  states dependencies, scope, out-of-scope and done-when.
- doc/GAP_REVIEW_2026-08-14.md — Addendum II (G26–G37) is the Sales & CRM
  analysis. The decisions block near the top of Addendum II lists nine settled
  decisions plus three later ones. Treat all twelve as settled.
- doc/SmartLS_PRD_Master_Functional_Spec_v2.md — §9 Group IV (MOD-20…MOD-26)
  and §10 (AI, the Zod gate, provider routing, governance).

## Read first — house conventions
- doc/CONVENTIONS.md, doc/BUILD_CONVENTIONS.md — module layout, naming.
- doc/DB_ARCHITECTURE.md — schema conventions, tenant isolation.
- doc/API_REFERENCE.md — existing route shapes.
- doc/FRONTEND_GUIDE.md, doc/FE_DESIGN_RULES.md — if the unit has UI.
- doc/WORK_DONE.md and doc/SESSION_HANDOFF.md — what previous sessions did and
  left. Check whether your unit was partly started.

## Read first — the current system
- migrations/tenant/0350_sales_crm.sql — every Group IV table.
- src/modules/sales/ — the seven modules. Note the pattern: .service /.repo /
  .controller /.routes /.validator /.events /.ai. Follow it exactly.
- Note that *.ai.js files are tool-catalogue registrations for the
  function-calling assistant (PRD §10.2). They are NOT AI content generators.

## Read first — the legacy
Legacy source is at doc/reference/legacy_codebase/. The per-session block below
names the exact files. Read them as the behavioural spec — the live PHP system
is what the client uses today. But note:
- Legacy debt the PRD says to remove is NOT to be ported: hard-coded
  credentials, raw SQL, hard-delete, the five copy-pasted role folders,
  free-text status POSTs with no transition guard.
- Where the rebuild already has a stricter pattern (lifecycle guards,
  per-transition RBAC, audit + event emission, transactional writes), keep the
  rebuild's and map at the edges.

## Standing decisions — do not relitigate
1. Clean start. No legacy data migration. No mapping obligation.
2. Keep the rebuild's lead → opportunity split.
3. Company DNA is per-tenant configuration.
4. All five public surfaces ship in one pass (session S12), not piecemeal.
5. French lands in the schema now; the app-wide UI toggle is separate work.
6. Campaigns follow the legacy model — manual actuals, no campaign_id
   attribution in this pass.
7. New-system numbering throughout. No legacy ref formats preserved.
8. Proposal generation is new capability, scoped deliberately.
9. Approved vendor partnership creates a DRAFT supplier.
10. Per-tenant origin allowlist in Settings for public surfaces.
11. Derived fact sheet is pure SQL, no model. Nightly + top-up on stale open +
    manual refresh button.
12. Client consent is three-state (NOT_ASKED / ANONYMISED_ONLY / NAMED),
    default NOT_ASKED, rendering as anonymised.

## Two rules that apply to every session
- No cost or margin field may ever reach an external model, and the exclusion
  is drawn AT THE QUERY, not by downstream redaction.
- No status value may be valid as both an intake state and a pipeline stage.
  The legacy overloads one column for both; that is the specific thing we are
  not repeating.

## How to finish this reading phase
Produce, in this order:
1. A short statement of what you found already built vs. still missing for this
   unit — cite file:line, not status documents.
2. Anything in the split's scope that is already done, or that you think is
   wrong.
3. QUESTIONS. For every question, give AT LEAST THREE concrete options with the
   trade-off of each, and mark the one you recommend. Do not ask open questions
   without options. If you have no questions, say so explicitly and explain why.

Then stop and wait. Do not write code until the questions are answered.
```

---

# S1 · Schema pass

```
Your unit is S1 in doc/SALES_CRM_BUILD_SPLIT.md — the single migration set for
all Group IV column changes, so no later session carries a migration.

Legacy files to read as the field spec:
- administration/view/admin/smart-quote-intake.php   (quote_requests columns)
- administration/view/admin/smart-quote-leads.php    (smart_leads, proposals)
- administration/api/smart_quote_api.php             (proposal + narrative writes)
- administration/api/success_story_api.php           (story + ops links)
- administration/view/admin/market-campaign-registration.php

Also read: migrations/tenant/0300_masterdata.sql (client_master, supplier_master),
migrations/seeds/9030_seed_reference.sql (pipeline_stage seed).

The split lists the columns. Your job is to decide types, nullability, checks,
indexes and table-vs-child-table placement — and to say where you disagree with
the list.

Questions I expect you to have options for: whether the lead intake fields go on
`lead` or a `lead_request_detail` child; whether `hard_kpis` / `gallery_images` /
`network_memberships` are jsonb or child tables; how `public_reference_consent`
is expressed (enum type vs text + check).
```

---

# S2 · Tenant company profile (G37)

```
Your unit is S2 — the per-tenant company profile that the proposal generator
reads. Neither system has this in usable form. Read G37 in
doc/GAP_REVIEW_2026-08-14.md in full; it is the specification.

Legacy file to read — the thing being replaced:
- administration/api/smart_quote_api.php lines 152–164. This is ~1,200
  characters of Smart Logistics' company facts hard-coded into a PHP string.
  That is what becomes tenant configuration.

Also read: src/modules/master/corporate_entity/, src/modules/master/client_master/,
and whatever modules expose fleet (MOD-39), warehouse space (MOD-34) and ledger
revenue — you need to know what the derived layer can actually query.

Three layers: declared profile (form + PDF extraction into the SAME fields),
derived fact sheet (pure SQL, typed fields, computed_at timestamp), proof points
(shared store with success_story).

Non-negotiable: margin and cost excluded at the query. Schema-scoped so no
tenant sees another's. Sandbox respects the AI cap.

Questions I expect options for: which specific aggregates make the v1 fact sheet;
what the PDF extraction does when a field is ambiguous; how the staleness
threshold N is configured.
```

---

# S3 · Live Meeting — structured discovery capture

```
Your unit is S3 — rebuilding the legacy "Supply Chain Diagnostic / Client
Discovery Framework" as structured capture on meeting_note.

Legacy files:
- administration/view/admin/smart-quote-leads.php — openMeetingWizard() around
  line 1061, saveMeetingNotes() around 1092, and the dictation trio
  toggleDictation / stopRecording / processAudio around 1744–1805.
- administration/api/smart_quote_api.php — case 'save_meeting_notes' and case
  'transcribe_audio' (Groq whisper-large-v3, ephemeral temp file, immediate
  unlink).

The legacy modal has: select lead, meeting date, location, then three named
sections each with its own microphone and scripted probing questions. Those
three fields (meeting_ops / meeting_pain / meeting_strategy) are the input to
the proposal generator.

Current system: src/modules/sales/meeting/. Note transcript_vault_id is set from
the request body at meeting.service.js:10 — nothing enqueues transcription. The
worker exists: src/jobs/handlers/ai-transcribe.js and
src/services/ai/transcription.service.js.

Questions I expect options for: typed sections on meeting_note vs typed fields on
lead; whether the probing questions are seeded config or hard-coded; what happens
to a section that has audio but failed transcription.
```

---

# S4 · Proposal record + composer (no AI)

```
Your unit is S4 — the proposal as a document, by hand, end to end. No AI, no
tokens, no public page, no PDF. Those are S5 and S6.

Legacy files:
- administration/view/admin/smart-quote-leads.php — openProposalEditor (~1209),
  addProposalRow / removeProposalRow / updateRowData / renderProposalTable
  (~1266–1330), searchDictionaryForLine (~1334), selectDictionaryItem (~1371),
  saveProposal (~1543), openEditChoice (~1444).
- administration/api/smart_quote_api.php — case 'save_proposal' and
  case 'fetch_proposal'.

Note two things in the legacy: proposal_ref is 'QT-' . date('Ymd') . '-' .
rand(100,999), which is random and collides within a day — do not port it, use
numbering.service. And the dictionary autocomplete borrows the proforma module's
endpoint and takes description only; the unit-price prefill is commented out at
line ~1371. proposal_line.dictionary_item_id already exists in the rebuild.

Keep the rebuild's DRAFT → IN_REVIEW → SENT → ACCEPTED/REJECTED lifecycle and its
per-transition permissions. The legacy has no review state; the PRD requires one.

Questions I expect options for: whether dictionary selection prefills unit price;
how EN/FR narrative editing is laid out; whether narrative sections are a fixed
set or user-defined.
```

---

# S5 · Proposal AI generation (G26)

```
Your unit is S5 — the generator. Depends on S2 (fact sheet) and S4 (the record).
Read G26 in doc/GAP_REVIEW_2026-08-14.md in full first.

Legacy file — read the prompt itself, closely:
- administration/api/smart_quote_api.php lines 139–237, case
  'generate_ai_content'. Note: ~1,200 chars of company DNA; four case-study
  archetypes (ENERGY / PHARMA / HEAVY / SANITIZED) each with fixed permitted
  metrics; exactly four SLAs with title <30 chars and value <40 chars because
  they render into a fixed-width table; both languages in one call; forced
  response_mime_type application/json plus a backtick-stripping regex.

The company DNA does NOT get ported — it comes from S2's tenant fact sheet. The
archetype structure and the formatting constraints DO.

Requirements beyond the legacy:
- Closed, numbered fact set. Each generated claim references the fact it rests
  on. Output citing an absent fact is rejected.
- Zod validation per PRD §10.3 — 2 retries, then fall back to a pre-filled
  manual form. The user never sees a broken payload.
- ai_generated set by this path and nothing else.
- Sandbox uses the hard low cap or a mock vendor.

Read src/services/ai/ (llm.service, redact, orchestrator) and
src/modules/ai/governance/ before designing.

Questions I expect options for: where the archetype set lives (seeded config vs
tenant profile vs source); how citation validation is enforced without making
the prompt unusable; what the manual-form fallback is pre-filled with.
```

---

# S6 · Proposal delivery — token, public page, PDF (G21 + G30)

```
Your unit is S6. Build the routes; session S12 wraps them in the shared public
infrastructure. Do not build rate limiting or CORS here.

Legacy files:
- administration/api/public_quote_api.php — the full public payload (header,
  client, lines, bilingual narrative). 101 lines, read all of it.
- public_html/quote.php — the client-facing renderer. fetchProposalData ~247,
  renderDocument ~290, setLang ~612, generatePDF ~617.
- administration/view/admin/smart-quote-leads.php — showShareModal ~1634,
  copyProposalLink, openProposalLink, sendWhatsApp ~1673.

Three legacy defects, all corrected here, not ported:
- Token is 'SLAS-' . bin2hex(random_bytes(4)) — 32 bits, no expiry column, no
  revocation. Use signed, expiring, revocable.
- PDF is html2canvas → jsPDF in the browser: a rasterised image PDF, never
  stored, never seen by the server. Use the rebuild's server-side PDF kit and
  write pdf_vault_id on SENT.
- There are TWO public token endpoints; smart_quote_api.php?action=
  get_proposal_public omits narratives. Build one.
- api/marginpricing-old/quote_downloaded.php exists but nothing calls it, so
  legacy has NO open tracking. viewed_at / downloaded_at is new capability.

Share action follows PRD §11.5 — wa.me and a copy option.

Questions I expect options for: token lifetime and whether it is per-proposal or
per-send; whether revocation is explicit or implied by a new send; what an
expired token renders.
```

---

# S7 · Lead intake and conversion (G31 + G32)

```
Your unit is S7. Read G31 and G32 in doc/GAP_REVIEW_2026-08-14.md first — G31
explains the single most important constraint on this session.

Legacy files:
- administration/view/admin/smart-quote-intake.php — the whole intake register.
  Read chipStatus() at 701–707 and the row renderer at 840–890 carefully.
- administration/api/quote_requests/ — the intake API.
- administration/api/smart_quote_api.php — case 'convert_lead' (~389). It writes
  client_master + quote_requests + back-links in one transaction.
- administration/api/sales_pipeline/_common.php line 24 — the RECEIVED → NEW
  mapping that proves the column is overloaded.

THE RULE FOR THIS SESSION: quote_requests.status holds intake values AND
pipeline stages in the legacy. That is why the live KPI tiles show 5 of 26 rows.
No status value may be valid as both. Intake lifecycle lives on lead.status;
pipeline stages live on pipeline_stage. Never both.

Two legacy defaults NOT to port: convert_lead hard-codes client_type 'BOTH' and
payment_terms_days 30. Prompt or take from settings.

Also do not port: isConverted is computed two different ways (row renderer line
847 uses converted_opportunity_id, drawer line 1019 uses status), so a converted
row greys out in the list while the drawer still offers Convert.

Questions I expect options for: how the intake lifecycle maps onto lead.status
without colliding with the existing NEW/CONTACTED/QUALIFIED/CONVERTED/LOST; how
attachments are handled pre-client; what the KPI partition is.
```

---

# S8 · Pipeline / opportunity board (G28)

```
Your unit is S8.

Legacy files:
- administration/view/admin/sales-pipelining.php — STAGES and STAGE_CONFIG at
  514–520 (note each stage carries a probability), the KPI render at 590–591,
  the "Attribution (Locked)" tab at 399/459 which ships the literal
  campaign: 'N/A' at 581, and the CSV export at ~803.
- administration/api/sales_pipeline/_common.php — stage normalisation.

Seed check: migrations/seeds/9030_seed_reference.sql:17 seeds six stages —
NEW, QUALIFIED, PROPOSAL, NEGOTIATION, WON, LOST. Legacy has seven; the missing
one is PRICING_IN_PROGRESS (probability 50), which is the handoff to the margin
simulator. S1 should have added it — verify.

Add what the legacy has and the rebuild lacks: pipeline value and win rate. Keep
what the rebuild has and the legacy lacks: moveStage validation, auto-settle on
won/lost, the settled-opportunity lock. The legacy accepts any status via POST.

Attribution is out of scope — decision 6.

Questions I expect options for: whether probability is per-stage config or
per-opportunity override; what win rate counts as its denominator; whether the
board paginates or virtualises at volume.
```

---

# S9 · Marketing campaigns (G34)

```
Your unit is S9. Decision 6 applies: port the legacy model, manual actuals, no
campaign_id attribution. Do not propose attribution.

Legacy file:
- administration/view/admin/market-campaign-registration.php — platform enum
  ~599–604, statuses ~608–612, budget_amount ~774, rejection_reason ~807,
  owner_name / target_service / targets ~866–873.
- administration/api/marketing_campaign/export.php — CSV export.

Note the legacy's own on-screen banner: "Performance metrics (Leads, Wins) are
currently in Manual Entry Mode. Update these figures weekly based on external ad
manager reports." Reproduce that honesty — the UI should say the numbers are
hand-entered.

Approval workflow: PLANNED → PENDING_APPROVAL → ACTIVE, with rejection_reason
and a guard stopping a SALES user editing while pending.

Keep the rebuild's campaign_sender, campaign_template, newsletter_subscriber and
/campaigns/:id/send — the legacy has no equivalent and they should not regress.

Questions I expect options for: whether the approval guard is RBAC or a service
rule; how actuals are entered (inline edit vs a periodic form); whether budget
is single-currency or follows the multi-currency pattern elsewhere.
```

---

# S10 · Inbound intake (G36)

```
Your unit is S10. Read G36 in doc/GAP_REVIEW_2026-08-14.md — it contains a
correction you should read before designing.

Legacy files:
- administration/view/admin/contact-us-intake.php
- administration/view/admin/partnership-portal-intake.php
- the corresponding api/ folders.

Current: src/modules/sales/inbound_intake/.

Contact enquiries need enquiry_type (GENERAL_ENQUIRY / PARTNERSHIP / CAREERS /
MEDIA), company_name, internal_notes and a RESPONDED state — the rebuild's
NEW/TRIAGED/CLOSED cannot record that someone replied, and the KPI row needs it.
Keep the existing triage → lead; the legacy has no equivalent.

Partnership requests need country_of_origin, network_memberships (WCA, JCTrans —
this is how a forwarding agent is vetted), contact_title, proposal_type
(AGENCY_PARTNERSHIP / VENDOR_REGISTRATION), the corporate profile document, and
internal_notes.

VENDOR ONBOARDING — decision 9. The legacy screen says vendors must be manually
onboarded. Ignore that; it is a limitation, not a control. Approving a
VENDOR_REGISTRATION creates a DRAFT supplier_master row. Read
src/modules/master/supplier_master/supplier_master.service.js first: create
already sets registration_status "DRAFT", /verify is gated on approve, the COA
auxiliary account is only allocated on activation. The gate already exists.

Questions I expect options for: what happens if an approved partner already
exists as a supplier; whether the profile document goes to the vault at intake
or at approval; how network_memberships is validated.
```

---

# S11 · Success stories / portfolio builder (G25 + G35)

```
Your unit is S11. Depends on S2 for the AI half. Read G27, G25 and G35 in
doc/GAP_REVIEW_2026-08-14.md.

Legacy files:
- administration/view/admin/success-stories-builder.php — note NOTHING in the
  codebase links to this file; it is reachable only by typing the URL. Give the
  rebuilt module a nav entry.
- administration/api/success_story_api.php — fetch_eligible_ops (~33),
  generate_story (~130), upload_assets (~198), save_story (~233).
- administration/api/public_portfolio_api.php
- public_html/portfolio.php and portfolio-case.php — the grid and detail pages.

THREE DEFECTS TO FIX, NOT PORT:
1. generate_story selects `margin` from operations_file_master into the Gemini
   prompt (line ~139). Dossier margin goes to Google to write a public marketing
   page. Exclude it AT THE QUERY. This is the single most important line in this
   session.
2. public_portfolio_api.php serves SELECT s.* on an unauthenticated endpoint
   with Access-Control-Allow-Origin: *. Use an explicit column allow-list.
3. fetch_eligible_ops offers IN_PROGRESS files, so a story can be published
   about a job that has not finished. Restrict to OPERATIONALLY_COMPLETED /
   FINANCIALLY_PENDING / CLOSED.

Multi-dossier via success_story_dossier closes G25 — the legacy binds many ops
files per story, the rebuild binds one.

Consent gate (decision 12): NAMED renders the client name, anything else renders
anonymised. The legacy's SANITIZED archetype is the anonymised pattern.

Keep the rebuild's sign-off-before-publish gate.

Questions I expect options for: where media is stored and how it is served;
whether slug is generated or authored; what "anonymised" renders for a client
logo.
```

---

# S12 · Public surfaces — one pass (G6 + G17 + G21 + G35)

```
Your unit is S12 — the last one. Depends on S6, S7 and S11 existing.
BLOCKING INPUT: the tenant #1 domain list. If it has not been supplied, say so
and stop.

Decision 4: all five surfaces ship together on shared infrastructure. Decision
10: per-tenant origin allowlist held in Settings (MOD-70), not hard-coded.

Legacy files:
- public_html/smart-quote.php + api/public/quote-request.php
- public_html/ contact form + public/contact-enquiry.php
- public_html/index.php partner section + api/partner/submit_partnership.php
- public_html/smart-track.php + api/public_track/get.php  ← read this closely
- administration/api/public_quote_api.php
- administration/api/public_portfolio_api.php
- public_html/partials/header.php line ~81 — smart-track is a TOP-LEVEL nav item
  on the live site today, and index.php:869 routes straight to it. It breaks the
  moment the old system goes off.

Current state: every /api route sits behind authMiddleware (src/server.js mounts
routes wholesale). The only unauthenticated tenant routes are /maintenance and
/document-verification/scan. There is no public route group.

Tracking returns the client-visible subset only — milestone_instance
.is_client_visible already exists. Reproduce the legacy's origin/destination
fallback by service type: air → air_origin/air_dest, sea → port_of_loading
falling back to sea_pol, hinterland → place_receipt/place_delivery.

Shared concerns to decide once: per-tenant origin allowlist, rate limiting,
captcha or equivalent, anonymous upload policy and size caps, and explicit
column allow-lists on every read.

Questions I expect options for: rate-limit strategy (per IP, per origin, per
tenant); anti-spam mechanism; whether anonymous file upload is allowed at all
on intake, and if so with what scanning.
```
