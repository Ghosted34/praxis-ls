# Tenant review — meeting 6 (29 Sep 2026): findings verified against the code

**Source.** Google Meet transcript + Gemini notes of meeting 6 with Timothée Massomba
(MD of SMART Logistics & Services Ltd, the first tenant), presented by Tom Blake (JBS
Praxis), plus the nine screen captures embedded in the notes. Every item below was
checked against `main` at `683d672` (2026-09-29). Items marked **[Meeting]** were
raised in the meeting; **[Found]** were found while verifying them and were not raised.

This is the auditor's register for the four PRs that follow from the meeting. The PR prompts
live beside it in this folder (see [README.md](README.md)); each one points here for evidence,
and QC of each PR is done against this file and that PR's Definition of done.

---

## 0. Reading the transcript — what the transcription got wrong

| Transcript says | Means |
| --- | --- |
| "code request", "smart code request", "edit smart code request" | **Quote request** (`SQ-2026-000n`), Engage › Sales & CRM › Quote requests |
| "petit papa", "pip papa" | Timothée Massomba (tenant) |
| "Goom", "Boom International", "Elisha forum international" | GOUM INTERNATIONAL COMPANY SARL; its portal user is Elisha Godwin |
| "Resotel" | RESOTEL SARL (real client) |
| "Cement Cam" | **CINECAM** — a DRAFT test client sitting in LIVE |
| "bank rip", "bankrupt" | Bank **RIB** uploaded on the treasury account |
| "C", "C rate", "C import" | Sea freight (import) |
| "integos", "inco term" | Incoterm |
| "get pass" | **Gate pass** (terminal exit ticket) |
| "the T capital" | The tonne unit under the portal quote's weight field (`≈ 25 t`) |
| "the P under shipment visibility" | The "Client portal" link inside the hero's Shipment Visibility card |
| "the former website … smart track, kaizen hub, about" | The old SmartLS site, whose menu used **Title Case** |
| "Duala, KBY, Seak / Bangi / Liville" | Douala, … / Bangui / Libreville (coverage labels) |
| "Gabon is GB" | Typed as **GB** — that is the **United Kingdom**; Gabon is **GA** |
| "20T dry", "20 foot hot" | 20' Dry, 20' HC |
| "Commercial says I define quotations" | Engage › **Commercial** › Quotations (Proposals live under Sales & CRM) |

## 1. Not bugs — do not build

- **Unit cost did not fill on the costing line** — Tom had edited a different line; it works (#492).
- **"If the client leaves the set-password page they can never set a password"** — false.
  The invite link lives 7 days (`src/modules/portal_auth/portal_auth.service.js:54`), is consumed
  only on a successful submit, and a client can always sign in with an emailed 6-digit code.
- **Two "Gate-Pass Fee" lines** — by design: seed `9082` gives each service a sibling per
  fulfilment mode ("— Client Account" = débours, "— Own Cost" = our expense). The defect is that
  nothing explains or guards the choice (PR3).
- **Exchange rates shown foreign-first** — done (#491). The *value* shown is wrong (PR3).

## 2. Actions that are not code

- Timothée: create the other banks / microfinance / MoMo / petty-cash accounts under Treasury.
- Tom: send the staff-app link by WhatsApp (PR1 adds a share button so this is self-serve).
- Tom: re-enter the Gabon coverage row as **GA** on the corporate entity (PR3 stops a repeat).
- Tom: remove CINECAM from LIVE — there is **no delete path for a client today** (PR3 adds one).
- Tom: tenant mail — Tom avoided the tenant's own domain for the invite test because mail to
  `smartls.cm` may not arrive; see `doc/MAIL_DELIVERABILITY_SMARTLS_2026-09-04.md` (DNS, not code).

---

## PR1 — Client portal go-live: documents, notifications, deep links, website entry

Why first: Timothée wants his friends' containers (≈2 weeks out) followed on the portal.

**1.1 [Meeting] Accepted client uploads never reach Client 360 › Documents.**
`reviewRequest` (`src/modules/portal/portal_client.service.js:690`) flips the request to
ACCEPTED and the vault row to VERIFIED — nothing writes `client_document`, which is the only
table the 360 Documents tab and the compliance engine read
(`src/modules/master/compliance/compliance.service.js:30,69`). Tom also wants every
client-sent file listed there whatever its review state.

**1.2 [Found] Two document registries that never meet — activation can never clear from the portal.**
The portal asks for `document_requirement` codes in `dictionary_ref(kind='DOCUMENT_TYPE')`:
RCCM, NIU, ID_SIGNATORY, BANK_DETAILS (`migrations/tenant/10747_party_document_checklist.sql`,
`14150_client_portal_foundations.sql:220`). Client activation checks `party_document_type`:
BUSINESS_LICENSE, TAXPAYER_CARD, IDENTIFICATION, BANK_RIB and the tenant's own "Attestation de
Conformité Fiscale" (`0511_party_master_rich.sql:736`; screenshot 1 shows GOUM "REQUIRED TO
ACTIVATE: Missing Attestation de Conformité Fiscale, Missing Business Licence / RCCM"). Unless
someone re-creates it by hand as a portal requirement, the portal never asks for the Attestation
that blocks activation, and an accepted RCCM never clears "Missing Business Licence / RCCM".
Also: #471 (migration `14030`) took Bank RIB out of *activation*, but the portal's own `10747`
GLOBAL rule still asks every client for BANK_DETAILS — client bank details are not needed to
onboard (only for refunds and for matching incoming transfers), so the portal must stop asking.

**1.3 [Meeting/Gemini] Accepted uploads are missing from the portal's own Library too.**
`CLIENT_DOCUMENT_SELECT` (`src/modules/portal/portal.repo.js:57`) requires
`dictionary_ref.extra->>'client_visible' = 'true'`; none of the 14150 types carry it.

**1.4 [Meeting] Staff are not emailed about client activity.**
Email is opt-in for every category except `tasks`
(`packages/shared/rules/notification-email-default.js:33`). Unless the account manager has
ticked Email in Preferences, a client's message, document or location reaches them in-app only —
consistent with Tom finding nothing in his mail during the demo.

**1.5 [Meeting] A new quote request notifies nobody.**
`quote_request.created` is not in `NOTIFIABLE` (`src/shared/notifications/notify-events.js:24`).
A website enquiry surfaces only as "New lead"; a **portal** request creates no lead and is
silent. Clients get no acknowledgement or status mail either — `notify-portal.js` has no
quote-request entries. Tom had to go looking for SQ-2026-0003 in the meeting.

**1.6 [Meeting] Tapping a notification while the app is already open does not land.**
Generic push clicks call `client.navigate(target).catch(() => {})` then `focus()`
(`client/public/push-handler.js:364-397`) — a rejected navigate is swallowed and the app comes
forward on the old page. Only calls use the `praxis:navigate` postMessage (`comms-live.tsx:140`).
The bell is a plain `<Link>` (`client/src/components/notification-bell.tsx:134`), so a click on
the page you are on refetches nothing, and the live socket (`client/src/lib/use-live-notifications.ts`)
only moves the badge. Tom had to press reload to see the RCCM upload.

**1.7 [Meeting] Client questions on a milestone are invisible on the operations file.**
Stored with `milestone_instance_id` (`src/modules/portal/portal_chat.repo.js:26`); the chat
panel that shows them is mounted only in Client 360 and the Client inbox, never on the file.

**1.8 [Meeting] Portal invitations are email-only.** When the mail fails the UI says so
(`client/src/features/portal/client-portal-people.tsx:161-167`) and offers no copy/WhatsApp
fallback. *(Decided: D4 — share the sign-in link, never the set-password token.)*

**1.9 [Meeting] Installing the app needs a human.** Timothée had to be told to open the link in
Chrome; nothing detects an in-app browser (WhatsApp/Facebook webviews cannot install a PWA) or
offers "Open in Chrome" / share-install-link (`client/src/lib/pwa-install.ts`).

**1.10 [Meeting] Website: the client portal is hard to find.** Top strip link is `text-xs`
(`public-web/src/components/site/site-header.tsx:310-330`); the hero card link is a small text
link (`public-web/src/components/site/hero.tsx:607-616`); the full portal band sits far down the
homepage (`marketing-page.tsx:187`). Agreed: keep "Request a quote" primary, make the portal
more visible (header + hero card).

**1.11 [Meeting] Website capitalisation.** Timothée wants Title Case on short labels ("Our
Work", "Client Portal") as on the former site. Every `site.*` string is already
tenant-overridable (`public-web/src/lib/site-copy.ts`), but there is no case policy; the
defaults are sentence case (`public-web/src/lib/i18n-dict.ts:117,126`). French typography is
sentence case. A title-case helper with per-language small words already exists (meeting 5,
`financial_dictionary.rules.js` `titleCase`).

**1.12 [Meeting] Nav spacing "About … Services" looks uneven** — the Services chevron is a
separate button after the label; verify optically and balance.

**1.13 [Found] "The MD" in client alerts is every active user holding the CEO role**
(`src/modules/portal/portal_chat.repo.js:250-254`). The vendor's JBS Praxis login holds that
role (screenshots: "JBS Praxis — CEO / Executive"), so it already receives every client-message
alert; an email default for "the MD" would mail it every client email too. *(Decided: D7 —
accepted; Tom is an SMART LS employee.)*

**Note.** The portal's own service worker already routes a tapped alert correctly
(`public-web/public/portal/sw.js:73-96`, `postMessage` → the page navigates itself); 1.6 is the
staff app's `push-handler.js` only — port that pattern.

## PR2 — Quote requests: one intake model across website, portal and desk

**2.1 [Meeting, root cause] No structured service type anywhere.** `quote_request` has only
free-text `service_category`/`service_type` (`WRITABLE`, `src/modules/sales/quote_request/quote_request.repo.js:16`).
The website wizard knows `service_type_id` but posts only the name
(`public-web/src/components/site/quote-wizard.tsx:221-225`; the intake schema is `.strict()`,
`public_intake.validator.js:20`). The portal posts translated words — "Sea freight · Import"
or the French equivalent (`public-web/src/features/portal/screens/quotes.tsx:440`) — and
regex-parses them back (`:114-131`). The staff form uses a hardcoded enum of 10 keys
(`client/src/features/sales/quote-request-forms.tsx:38-49`) that misses CUSTOMS_BROKERAGE,
PROJECT_CARGO and all three RAIL services of the 15 seeded (`migrations/seeds/9080_seed_dictionary.sql:150`).
Tom: "This is hardcoded… we're supposed to have a picker with a popover."

**2.2 [Meeting] Portal wizard modes/directions are hardcoded.** `MODES` has no RAIL, `DIRECTIONS`
is IMPORT/EXPORT/LOCAL shown as "In-country" (`quotes.tsx:42-43`). Asked: Inland (not
"in-country"), Hinterland, Rail, all under "transport"; hinterland runs both ways. The website
already derives modes from the tenant's services (`public-web/src/lib/service-modes.ts` `modesOf`,
server `src/modules/operations/_shared/service-mode.js`).

**2.3 [Meeting] Incoterms hardcoded four times, all different.** Portal 6 (`quotes.tsx:45`),
staff 10 without FAS (`quote-request-forms.tsx:50`), AI fill 11 (`portal_quote_fill.service.js:36`),
mail glossary 11 (`mail/assist/assist.glossary.js:8`). Portal "not sure" is stored as `TBD`
(`portal.service.js:317`) which the staff select cannot show (it displays EXW and defaults FOB).

**2.4 [Meeting screenshot] Portal requests lose who asked.** `createClientQuote`
(`src/modules/portal/portal.service.js:300`) fills requester name/email from the **company**
record and never sets `requester_company`, so the list shows "—" (screenshot 4: SQ-2026-0003 is
GOUM's; SQ-2026-0002 is most likely the CINECAM request made earlier in the meeting, which Tom
then could not spot), "Logged by —", and Owner stays empty even when the client has an account
manager.

**2.5 [Found] Channel PORTAL is missing from the desk.** The edit form's channels are
MANUAL/WEBSITE/REFERRAL/CAMPAIGN (`quote-request-forms.tsx:37`) — a portal request displays as
MANUAL — and the list filter has no Portal chip (`quote-requests.tsx:98-104`).

**2.6 [Meeting] No documents with a request.** The portal wizard has no upload step and a sent
request cannot take a document later; a commercial invoice sent in chat (screenshot 5) cannot
be filed onto the request.

**2.7 [Found] Website enquiry attachments are invisible to staff.** The file is stored under
`entityRef: "quote_request:intake"` and only in `quote_request.attachment_doc_id`
(`src/modules/sales/public_intake/public_intake.service.js:82-100,145`); the Attachments tab and
the 360 read only `quote_request_attachment` (`quote_request.repo.js:199`, `sales-360.service.js:290`).

**2.8 [Meeting] A request keyed in from an email cannot be tied to a client**, so it can never
appear in that client's portal: no `client_id` in the staff validator or the PATCH whitelist, no
client picker on the form.

**2.9 [Meeting] The portal request list cannot be opened** — no detail, no status history, no
link to the offer that answered it.

**2.10 [Meeting] "≈ 25 t" → capital T** (`quotes.tsx:609`); **2.11 [Found]** staff form labels
are raw enum codes (SEA_FREIGHT_IMPORT, LESS_THAN_7_DAYS) and untranslated.

## PR3 — Money, master data and signing

**3.1 [Found, critical] EUR↔XAF is not the legal parity.** Screen showed "1 EUR = 656.168 XAF";
the BEAC fixed parity is **655.957** (same for XOF). 656.168 = 1/0.001524 — the
exchangerate-api feed's rounded rate, stored as-is by the daily/“on add” sync
(`src/modules/master/currency/currency.sync.js:55-120`). Nothing pins a peg; costings pre-fill
their rate from here (#497 `GET /costings/fx-rate`). And a treasurer cannot pin it by hand
either: the resolver prefers an override only on the SAME date (`currency.rules.js:9-18`), so the
next night's feed row beats yesterday's manual rate.

**3.2 [Meeting] Débours vs own-cost siblings are unexplained and unguarded.** Picking "Gate-Pass
Fee — Own Cost" on a client-billed costing posts to the wrong account (Tom's own words) and no
picker groups siblings, explains them, or warns.

**3.3 [Meeting] Operations users must pick GL accounts to create a dictionary line**
("Every item maps to accounts before it can be saved", `financial-dictionary-form.tsx:655`;
service 422 at `financial_dictionary.service.js:211`). Tom floated "leave it to the accountant".
*Found while answering F7:*
- every AI call is gated on the ASSISTANT's tenant switch. `canUseFeature` checks
  `ai.assistant.backend` whatever feature key it is given (`governance.service.js`), and the
  client hides all AI UI when `ai_enabled` is false (`client/src/components/ai-actions.tsx`);
- `ai.*` features are off by default in the platform catalogue
  (`migrations/seeds/9110_seed_platform_features.sql`);
- a call is priced at the vendor's one token price (`estimateCostNative`,
  `governance.rules.js`), so a stronger model or a grounded search would be under-counted;
- `llm.service.js` uses Gemini's OpenAI-compatible endpoint, which has no Google Search; the
  native `generateContent` is already used in `gemini-transcription.service.js:147`.

**3.4 [Meeting-derived] A rate's VAT basis is a free-text note** (`expense_rate.validator.js:14,23`);
"VAT inclusive" typed there changes no arithmetic.

**3.5 [Meeting + Found] Coverage country is a free 2-letter box.** `maxLength={2}`
(`client/src/features/masterdata/entity-public-story-tab.tsx:293`), schema accepts any two
letters (`packages/shared/schemas/site-settings.js:249`), and rows with a short code are silently
dropped on save (`:361-366`). Hence "why does it not accept more than two" and Gabon saved as GB.
`client/src/components/country-select.tsx` exists.

**3.6 [Meeting] A draft client cannot be discarded** — no DELETE route
(`src/modules/master/client_master/client_master.routes.js`); CINECAM stays in LIVE.

**3.7 [Meeting] Signing on a computer without fingerprint/face means an emailed code every
time.** `if (!supported) startCode()` (`client/src/components/signing/use-signing-proof.tsx:115`)
never offers the phone's passkey (WebAuthn hybrid/QR), although the server already passes each
credential's transports (`signing-proof.service.js:64-90`).

**3.8 [Meeting] Vendor access to the tenant's LIVE is an ordinary CEO account.**
*(Owner decision F5: no change — out of scope.)* "I trust you,
not your people." The JBS Praxis login holds the CEO role (RBAC bypass), appears as an employee
(entity shows 3 employees: 2 real + JBS Praxis), and there is no tenant-visible support-access
model (no grant, expiry, or support-activity view).

**3.9 [Meeting] LIVE looks broken when it is empty** ("my live is not working") — the Control
Tower shows zeros on a tenant with no operations file yet; no go-live checklist.

## PR4 — Quotations end-to-end

**4.1 [Meeting] Quotations raised by the team never reach the client's portal.** The portal lists
Sales **proposals** only (`src/modules/portal/portal_proposal.service.js:96`); Commercial
**quotations** (MOD-27) are absent. Timothée: quotations prepared from an emailed request must
appear in the portal.

**4.2 [Meeting, agreed] Separate "Requests for quotation" and "Quotations"** — two lines in the
portal's left menu (`public-web/src/features/portal/shell/portal-shell.tsx:160-164`) instead of
one "Quotes" page whose Proposals tab appears only once a proposal exists (`quotes.tsx:183-201`).

**4.3 [Meeting] A quotation cannot be started from a costing.** `quotation.createDraft` takes lines
from the caller and only stores `costing_id`; the only route is costing → margin simulation →
approve → "Create quotation" (`margin-simulations.tsx:1013`), which nobody used in the meeting.

**4.4 [Meeting] Families (client headings) need refinement before the next test** — today a
per-line select in the "By family" view (`client/src/components/client-families.tsx`); no bulk
move, no family column in the detailed view.

**4.5 [Meeting] "Type quotation and it opens."** ⌘K matches English nav labels by substring
(`client/src/components/command-palette.tsx:224-240`): "quote" does not find "Quotations",
"devis"/"cotation" find nothing, and there is no record search (SQ-/QT- numbers, client names).

---

## Owner decisions

### PR1 (answered 2026-10-01)

- **D1 Accept flow** — accepting a client's KYC upload files it on the Client 360 as VERIFIED by
  the reviewer and re-runs compliance at once; the reviewer is asked for number / issue / expiry /
  authority only when that document type requires them.
- **D2 What the portal asks for** — the union of the client document types marked "required to
  activate" and the active client `document_requirement` rules, de-duplicated through one mapping —
  **never bank details**. Plus a **"Request from client"** button in Client 360 › Documents that
  picks from the client document-type list.
- **D3 Staff email** — the client's account manager **and the MD** are emailed by default
  (opt-out per person); no reachable account manager → the Client inbox team. Because of 1.13,
  "the MD" becomes a tenant setting rather than "every CEO-role user".
- **D4 Invites** — "Send on WhatsApp" / "Copy link" share the portal sign-in link (email
  pre-filled, emailed 6-digit code); the set-password token never passes through staff hands.
- **D5 Capitalisation** — Title Case in English **and French** across the entire public website
  (and the client portal's chrome), as a maintained standard; full sentences unchanged.
- **D6 Portal entry** — a "Client Portal" outline button beside the orange "Request a Quote" in
  the header (top of the mobile menu too), and the hero card's link becomes a full-width button.

### PR1 — amendment (answered 2026-10-01, supersedes D3's MD setting)

- **D7 Who is told about a client** — the client's account manager **+ the CEO-role users (kept)
  + any extra people picked for that client ("Also notify")**. The account manager and the
  Also-notify people are picked **at client creation** (the New client form has no account-manager
  field today although the API accepts one — `client_master.service.js:38-51`) and edited on the
  Client 360, which shows the whole list. All of them get in-app + push + email by default
  (opt-out per person). The tenant-level "MD" setting from D3 is dropped. The JBS Praxis login
  holds the CEO role and so is on every client's list — accepted: Tom is an SMART LS employee
  (see PR3 decision F5).
- **D8 Client emails** — automatic emails keep today's rule (a team reply is emailed after 10–20
  minutes only if still unread, at most once an hour per conversation, only to people who have
  signed in once — which is why the demo, where the "client" read every reply live, produced no
  email). Added: **"Send by email" on hover over any team message** (⋯ menu on touch), which sends
  that message at once as a properly branded, professionally structured email (tenant logo and
  colours, the sender's signature, attachments, a button back to the portal), and staff can see on
  each message whether it was emailed. Tom's "you can pick to respond by email" does not exist in
  the code today; this is it.

### PR2 (answered 2026-10-01)

- **Q1 The wizard's first step** — six cards: Sea, Air, Rail, Road (under a subtle "Transport"
  label), Storage, Customs; then the flow (Import, Export, End-to-End, Inland, Hinterland), only
  the flows that exist for that card. Every card and flow maps to the tenant's service types; a
  new service type appears on its own; a request stores its service type.
- **Q2 Hinterland** — ask "into" or "out of" the hinterland; one service type stays one.
- **Q3 Incoterms** — per service type, editable, pre-filled from ICC 2020 (sea: all 11; air,
  road, rail: the 7 any-mode terms), plus "Not sure".
- **Q4 Documents (portal)** — at least one document is required to send; the commercial invoice
  is the one strongly encouraged; more can be added later.
- **Q5 Tying a desk request to a client** — both: a client picker suggesting the match from the
  requester's email or domain, and "New quote request" from the Client 360. A linked request
  appears in the client's portal with the account manager as owner.
- **Q6 Website** — the same six cards and steps through one shared component; documents strongly
  encouraged but optional for strangers.
- **Auditor defaults** — services fitting no card (Project Cargo, Business Representation) sit
  under an "Other services" link; a prospect's request is unassigned until "Start review" makes
  the reviewer its owner; the weight reads "≈ 25 T".

### PR3 (answered 2026-10-01)

- **F1 EUR parity** — locked at 655.957 for XAF and XOF; the feed never touches it; open drafts
  re-priced, signed / sealed / posted documents untouched. The override-beaten-by-tomorrow's-feed
  bug is fixed for every currency (`currency.rules.js:9-18` prefers an override only on the same
  date).
- **F2 Siblings** — one entry per sibling group in every picker, then "billed to the client at
  cost" or "our own cost", preset from the file; a mismatch is flagged.
- **F3 Accounting of a new line** — the AI (Gemini with Google Search grounding, plus the
  tenant's own audited lines, chart of accounts and `doc/OHADA_KB.md`) suggests the OHADA posting
  and pre-fills it; anyone with dictionary create / edit rights edits and saves it.
- **F4 VAT basis** — each rate says whether it includes VAT; the HT figure is stored; débours are
  always HT.
- **F5 Vendor access** — no change. Tom is an SMART LS employee and will change his password.
  (Auditor note given to the owner: a password change signs out other sessions but does not reset
  the account-wide Quick PIN or remove passkeys on other devices — change the PIN and review the
  passkeys too.) Item 3.8 is out of scope.
- **F6 Signing** — the phone's passkey first, the emailed code last; plus a 5-minute window per
  person and session after one confirmation, each signature still bound to its own document hash.
- **F7 The model and the cost** — owner's words:
  > "Seed a stronger Gemini model JUST FOR THIS feature. And it caches for future uses to
  > minimize cost to the max. This model works just here. Every tenant should have it. It's
  > quite sensitive. We don't need to manually configure anything. It should be automated."

  Hence:
  - its own feature key, ON for every tenant, with its own gate (not the assistant's switch);
  - the strongest generally available Gemini Pro-tier model with Google Search grounding,
    chosen and verified automatically, with a logged fallback to the platform's Gemini model;
  - only generic, tenant-free questions;
  - a platform-wide cache shared by all tenants;
  - mapping onto each tenant's chart of accounts done locally;
  - the model's own prices and the search fee metered;
  - a labelled local fallback that never blocks a save.
- **F8 Where it runs** — the create wizard, a change of a line's direction, one review of the
  existing lines (lists mismatches, changes nothing), and spreadsheet imports (a row without a
  posting gets a suggestion the person accepts before commit).
- **Auditor defaults** — only a DRAFT client with no history can be deleted; coverage countries
  from the shared ISO list; an empty LIVE shows a go-live checklist.

### PR4 (answered 2026-10-01)

- **G1 Quotation from a costing** — one click, priced directly with the margin simulator's own
  rules: débours at cost (no margin, no VAT), services at the target margin, own costs not billed
  (they set the floor); families come across; a DRAFT to adjust; the workings kept as a linked
  margin simulation.
- **G2 Families** — all four: bulk move, a family column in the detailed view, drag between
  families, and a per-document family order with a default in settings.
- **G3 Quotations in the portal** — cards (quotations and proposals, All / Quotations / Proposals
  tabs) that open a full page: details, download, accept and sign, decline, then back; "ask about
  this quotation" opens the chat with the quotation referenced.
- **G4 Acceptance** — e-signature exactly like proposals.
- **G5 Search** — ⌘K finds every module, page, tab and record, in English and French, limited to
  what the person may open; a gate fails any unregistered page or tab; `CLAUDE.md` and the README
  state the rule.
- **G6 Staff menu** — Quotations moves next to Proposals in Sales & CRM.
- **Auditor defaults** — "Create quotation" on a validated or approved costing only; a 0 % target
  margin setting if none exists; on a phone, Requests and Quotations share one Quotes slot with a
  switch.

## Sequencing and migrations

- PR1 and PR2 are independent and can run together. PR3 is independent of all. **Start PR4
  after PR2 is merged** — it builds on PR2's request ↔ client link and portal quotes screen.
- Disjoint migration ranges (CI blocks duplicate numbers, `scripts/db/check-migration-numbers.js`):

  | PR | tenant | platform | seeds |
  | --- | --- | --- | --- |
  | PR1 | 14260–14299 | 0111–0114 | 9140–9144 |
  | PR2 | 14300–14339 | 0115–0118 | 9145–9149 |
  | PR3 | 14340–14379 | 0119–0124 | 9150–9154 |
  | PR4 | 14380–14419 | 0125–0128 | 9155–9159 |
