# PR 1 of 4 — Client portal go-live

> Tenant review of 29 Sep 2026 ("meeting 6"). Owner decisions answered 2026-10-01.
> Evidence and decisions: [register.md](register.md) (items 1.1–1.13, decisions D1–D8).

You are working in the praxis-ls repository: Praxis LS, a white-label, multi-tenant logistics
and OHADA-accounting ERP. Backend Node/Express in `src/`, staff app in `client/`, public website
and client portal in `public-web/`, shared Zod schemas and rules in `packages/shared`. Read
`CLAUDE.md` before writing any code and follow it exactly.

## Context

The first tenant (SMART Logistics & Services, MD Timothée Massomba) wants his clients following
their shipments on the portal within about two weeks. The review showed the portal is not ready:

- documents a client uploads and staff accept vanish;
- the right people are not told when a client acts, and nobody can see whether a client was
  emailed;
- tapping an alert while the app is open lands nowhere;
- clients cannot find the portal on the website, whose labels the tenant wants in Title Case.

Every item has been verified against the code. If the code now contradicts the register, trust
the code, say so in the PR, and carry on.

## Read first

- [register.md](register.md): sections 0–2, the whole "PR1" section, "Owner decisions › PR1" and
  "PR1 — amendment".
- `doc/FRONTEND_GUIDE.md`: §3.5 (primitives), §3.10 (dialogs), §3.12 (dates), §3.13 (uploads),
  §6 (pre-PR checklist).
- `doc/BUILD_CONVENTIONS.md`, `doc/AI_ARCHITECTURE.md` §2, `doc/ERROR_HANDLING.md`,
  `doc/PUSH_NOTIFICATIONS.md`.
- `doc/BRAND_GLOSSARY_FR_EN.md` §5 and `doc/WEB_BUILD_BRIEF.md` N8 — you amend both (F2).

## Owner decisions (final — do not re-ask)

- **D1 Accept flow.** Accepting a client's KYC upload files it on the Client 360 as VERIFIED by
  the reviewer and re-runs compliance at once. Ask for number / issue date / expiry / authority
  only when that document type requires them.
- **D2 What the portal asks a client for.** The union of (a) the client document types marked
  "required to activate" and (b) the active client `document_requirement` rules, de-duplicated
  through one mapping. **Never bank details.** Plus a "Request from client" button in
  Client 360 › Documents with a document-type picker.
- **D3 Staff email.** Everyone on the client's "who is told" list (D7) is emailed by default,
  opt-out per person.
- **D4 Invites.** "Send on WhatsApp" / "Copy link" share the portal **sign-in** link (email
  pre-filled, emailed 6-digit code). The set-password token never passes through staff hands.
- **D5 Capitalisation.** Title Case in English **and** French across the entire public website
  and the client portal's chrome, as a maintained standard. Full sentences stay as written.
- **D6 Portal entry.** A "Client Portal" outline button beside the orange "Request a Quote" in
  the header (top of the mobile menu too); the hero card's small portal link becomes a full-width
  button.
- **D7 Who is told about a client.** The client's account manager + the CEO-role users (kept as
  today) + any extra people picked for that client ("Also notify"). The account manager and the
  Also-notify people are picked at client creation and edited on the Client 360. All of them get
  in-app + push + email by default. No reachable account manager → the Client inbox team.
- **D8 Client emails.** Automatic emails keep today's rule. Staff gain **"Send by email"** on any
  team message, which sends it at once as a properly branded, professionally structured email,
  and can see on each message whether it was emailed.

## What to build

### A. Client documents and KYC (1.1, 1.2, 1.3)

**A1 — Accepting files the document (1.1, D1).**
- Where: `reviewRequest` (`src/modules/portal/portal_client.service.js:690`), decision ACCEPT on
  a client-level document request.
- In one transaction, create or supersede the client's `client_document` row of the matching
  type:
  - `vault_id` = the answer's vault document; scan and verification VERIFIED;
  - `verified_by` / `verified_at` = the reviewer / now;
  - `content_hash` taken from the vault row.
- Write and version it the way `src/modules/master/_shared/nested.js` handles party documents,
  not by hand. Keep the audit trail.
- Then call `compliance.sync(c, { kind: "client", partyId })` so "Required to activate" and the
  compliance flags update in the same request.
- When the `party_document_type` requires expiry or issuing authority, the staff Accept action
  asks for those fields and the document number first. Use `DateField`, never a native date
  input, and a `Dialog`, never `window.confirm`.
- File-level (shipment) document requests keep today's behaviour.

**A2 — One list of what to ask a client for (1.2, D2).**
- Today the portal's asks come from `document_requirement` + `dictionary_ref(kind='DOCUMENT_TYPE')`
  (`syncRuleRequests`, `src/modules/portal/portal_client.repo.js:109`). Activation reads
  `party_document_type` + `required_for_activation` (migration `14030`).
- Create ONE explicit link so a client-level request always knows which client document type it
  satisfies. Recommended approach:
  - key client-level requests to `party_document_type` directly (a nullable FK on
    `client_request`), so a tenant-created type such as "Attestation de Conformité Fiscale" is
    requestable with no twin row;
  - keep `dictionary_ref` codes for file-level documents;
  - seed the system pairs (RCCM → BUSINESS_LICENSE, NIU → TAXPAYER_CARD,
    ID_SIGNATORY → IDENTIFICATION) so existing open requests still resolve.
- The rule sync asks for the union of:
  - the client's activation types, resolved by the compliance engine's own code so exemptions
    such as `exempt_outside_country` hold;
  - the active CLIENT rules;
  - de-duplicated through that link.
- Bank details are never requested from clients:
  - deactivate the `10747` GLOBAL BANK_DETAILS client rule in a migration;
  - cancel OPEN rule-generated BANK_DETAILS client requests (leave SUBMITTED / ACCEPTED /
    REJECTED alone);
  - make sure the sync cannot recreate them.
  A client can still send bank details unprompted.

**A3 — Everything a client sent appears on the Client 360 (1.1).**
- Client 360 › Documents (`client/src/features/masterdata/party-360.tsx`) shows the client's
  documents and, beside them, every file the client sent through the portal that is waiting for
  review or was sent back.
- Show its state, who at the client sent it and when, and the existing Accept / Send back
  actions (same endpoints, same permissions).
- Accepted files simply appear as documents (A1).

**A4 — "Request from client" in Client 360 › Documents (D2).**
- A "Request from client" button next to "Add document" on the Documents tab opens a sheet with
  a document-type picker.
- The picker lists the SAME types as the tab's "Add document" form: `listDocumentTypes("CLIENT")`
  in `client/src/lib/masterdata-api.ts:2017` (`GET /party-document-types?applies_to=CLIENT`,
  which returns CLIENT and BOTH types). Active types only, searchable. Reuse that data source; do
  not create a second list.
- Next to each type, show where it stands for this client: on file (valid until a date), already
  requested (a date), or missing / required to activate. A type with an open request cannot be
  requested twice.
- Several types can be picked at once; this creates one portal request per type.
- An "Other — describe it" option covers a document that has no type yet; it files under OTHER
  when accepted.
- Optional note and due date (`DateField`). The client is notified exactly as today.
- Shipment documents (commercial invoice, BL, packing list) stay on the Portal tab and the
  operations file, where a shipment is chosen. The Portal tab's request flow keeps working.

**A5 — The portal Library shows the client's accepted documents (1.3).**
- `CLIENT_DOCUMENT_SELECT` (`src/modules/portal/portal.repo.js:57`) requires
  `extra.client_visible = 'true'`, which no `14150` KYC type has.
- A client must see the KYC documents they sent and that were accepted. Keep the VERIFIED,
  ownership and download guards; do not widen the visibility of internal documents.

### B. Who is told about a client, and how (1.4, 1.5, 1.13, D3, D7, D8)

**B1 — The "who is told" list (D7).**
- For a client the list is: its account manager + the CEO-role users (as today) + its
  "Also notify" people.
- Pick them at creation. The New client form (`client/src/features/masterdata/clients.tsx`) has
  no account-manager field today, although the API already accepts `relationship_manager_user_id`
  on create and routes it through the audited `account_manager.service`
  (`src/modules/master/client_master/client_master.service.js:38-51`). Add:
  - an "Account manager" employee picker, sourced from `/clients/account-manager-candidates`
    (people with an active login);
  - an "Also notify" multi-picker sourced from the same list.
- Edit both later on the Client 360's account-manager card, which also shows the whole list, for
  example "Told about this client: <AM> (account manager), <names> (CEO), <names> (also notify)".
- Store "Also notify" per client: a new table in your migration range, audited. A disabled login
  drops out of routing automatically. The field's Zod schema lives in `packages/shared`
  (`check:schemas`).
- No reachable account manager → the Client inbox team (MOD-64C edit), as today.
- Use this ONE list everywhere: B2, B3 and the existing chat routing (`staffAudience`,
  `src/modules/portal/portal_chat.repo.js:238`, whose CEO-role query is today's "MD").
- Update `client_master.ai.js` so the assistant can set the account manager and the Also-notify
  list on create / update (AI write contract).

**B2 — Email by default (1.4, D3).**
- Events covered:
  - a client message (`alertTeam`, `src/modules/portal/portal_chat.service.js`);
  - a document or answer sent (`client_request.submitted`);
  - a payment claim (`payment_proof.submitted`);
  - a new quote request (B3).
- Everyone on the client's list gets, by default: in-app, push (on devices where they turned
  notifications on) and email. A person's explicit preference row always wins.
- Put the default where the Preferences matrix reads it
  (`packages/shared/rules/notification-email-default.js`; a dedicated client-activity category is
  the clean way). Do NOT use `forceEmail`.
- Group bursts: at most one email per person per conversation per 15 minutes. In-app and push
  stay per message.

**B3 — New quote requests (1.5).**
- `quote_request.created` notifies nobody today (not in `NOTIFIABLE`,
  `src/shared/notifications/notify-events.js:24`).
- Staff side:
  - a request linked to a client: that client's list, as in B2;
  - a website prospect with no client: MOD-20 Quote-request editors in-app, the CEO-role users by
    email;
  - a website enquiry already raises "New lead": make that ONE alert, not two.
- Read `client_id`, channel and reference from the `quote_request` row named by the event's
  entity ref. Do NOT edit `src/modules/sales/quote_request/*` (PR 2 owns it).
- Client side (portal requests only):
  - an acknowledgement on creation ("We received your request SQ-…");
  - email + push when the status moves to CLARIFICATION_REQUIRED or QUOTED; push only for
    UNDER_REVIEW;
  - add a quote topic to the client's switches (`TOPICS` in
    `src/modules/portal/portal_notify.service.js` + the portal Account screen), email on by
    default.
- Never email website prospects from the public form: anyone can type any address into it, so it
  would be a mail-bombing vector. The site already shows them their reference.

**B4 — "Send by email" on a message (D8).**
- Where: every TEAM message in a client conversation — Client 360 › Messages, Comms › Clients,
  and the operations-file thread from D.
- Hovering shows an envelope action, "Send by email". On touch screens it is in the message's
  ⋯ / long-press menu.
- It emails that message IMMEDIATELY, regardless of the automatic rules, as a properly branded,
  professionally structured email:
  - the tenant's logo and colours — reuse the branding the portal emails already use
    (`emailHtml` + `branding.getBranding` in `portal_notify.service.js`): one shared layout, not a
    second template;
  - a clear subject: "<company> · <shipment ref>" for a shipment's thread, else "Message from
    <tenant>";
  - the message text, plus the shipment reference and route when it has one;
  - the message's attachments attached (vault files, within the mail size limit), otherwise a
    secure link;
  - the sender's own email signature (`email.service` `send` with `signature: "auto"` and the
    sender as actor), and a reply-to so a reply reaches the team;
  - an "Open your portal" button to the conversation.
- Recipients: the client's portal users who can see that conversation, pre-ticked and editable
  before sending. A deliberate send also reaches someone who switched automatic message emails
  off or has not signed in yet (it is the team writing to them), but never a removed or disabled
  login.
- One click sends once (guard against double clicks and retries). Record it on the message
  ("Emailed to Elisha Godwin · 10:42 · by Tom") and in the audit ledger. Never from TEST.
- Permission: the same as replying (MOD-64C edit).

**B5 — Staff can see whether a client was emailed (D8).**
- Automatic client emails keep today's rule:
  - a team reply is emailed after 10–20 minutes, only if still unread;
  - at most once an hour per conversation;
  - only to people who have signed in at least once.
  They switch to the same branded layout as B4.
- Each team message shows staff its delivery state: "Emailed 10:42", "Read in the portal — no
  email needed", or "Not emailed: <reason>" (never signed in, switched off, failed).
- Read this from what portal notifications already record (`portal_notify_sent` and the read
  state). Do not add a second log.

### C. A tap on an alert opens the thing (1.6)

- **C1** The staff service worker's generic `notificationclick`
  (`client/public/push-handler.js:364-397`) swallows a rejected `client.navigate()`.
  - Port the portal's pattern (`public-web/public/portal/sw.js:73-96`): `postMessage`
    `{ type: "praxis:navigate", url }` to an open window, which navigates inside the SPA, then
    focus.
  - Add ONE app-wide listener in the shell; today only `comms-live.tsx:140` listens, and only for
    calls.
  - Fall back to `openWindow` when no window exists or none answers.
  - Call / ring handling stays unchanged; keep `push-handler-call-ring.test.ts` green and add
    tests for the generic path.
- **C2** A bell or toast click whose link is the current page refetches that page's data
  (`client/src/components/notification-bell.tsx:134` is a plain `Link` today).
- **C3** When `notification:new` arrives (`client/src/lib/use-live-notifications.ts`) for the
  screen that is open — Client 360 Portal / Documents / Messages, Comms › Clients, Quote
  requests — invalidate just those queries so the new item appears without a reload. No global
  refetch storm.

### D. Client questions on milestones (1.7)

- On the operations file's milestone timeline (`client/src/features/operations/`), show each
  stage's client questions: `client_message` rows carrying that `milestone_instance_id`.
- Give the stage a count and the thread, with an inline reply that posts into the same shipment
  conversation so the client sees it in the portal. B4's "Send by email" works there too.
- Same permission as the Client inbox (MOD-64C); follow the existing rule in
  `client/src/features/portal/client-chat-panel.tsx`.

### E. Invitations and installing the app (1.8, 1.9)

- **E1** In `client/src/features/portal/client-portal-people.tsx`, each person gets
  "Send on WhatsApp" and "Copy link" (D4).
  - The link is the portal sign-in on the tenant's public-surface origin (the registry's
    `publicSurfaceOrigin`, as invite emails already use), with their email pre-filled.
  - WhatsApp: `https://wa.me/<mobile>?text=…` when the contact has a mobile, else
    `https://wa.me/?text=…`. Message in the person's language.
  - The set-password token is never shown or shared.
- **E2** Staff app and portal:
  - detect in-app browsers (WhatsApp, Facebook / Messenger, Instagram, Telegram, LinkedIn) on the
    sign-in and install surfaces;
  - show "Open in Chrome to install" — Android: a Chrome intent URL, like the existing
    open-in-browser bar; iOS: Safari › Share › Add to Home Screen;
  - add "Share the app" (copy / WhatsApp / QR) to the staff account menu.

### F. The public website (1.10, 1.11, 1.12)

**F1 — Portal entry (D6).**
- Header (`public-web/src/components/site/site-header.tsx`): a "Client Portal" outline button
  beside the orange "Request a Quote", which stays primary. The same at the top of the mobile
  drawer. Keep the utility-strip link.
- The hero Shipment Visibility card's small link (`public-web/src/components/site/hero.tsx:607-616`)
  becomes a full-width button under the tracking field.
- Tokens only (`check:palette`, `check:contrast`). Respect the header's condense behaviour and
  `check:motion`. Pass the 1280px desktop layout gate.

**F2 — The Title Case standard (D5).**
- Scope: every LABEL-type string renders in Title Case in English AND French — nav and footer
  links and column titles, buttons / CTAs, page and section headings including the hero
  headline, eyebrows, card titles, tabs, form field labels, pills. Examples: "Our Work",
  "Client Portal", "Request a Quote", "Nos Réalisations", "Portail Client",
  "Demander un Devis". The same applies to the client portal's chrome (nav, page and sheet
  titles, buttons, tabs).
- Sentences, paragraphs, hints, placeholders and legal text stay as written. The staff ERP
  (`client/`) is out of scope.
- Implementation:
  - **One function.** Lift `titleCase` from
    `src/modules/master/financial_dictionary/financial_dictionary.rules.js:73` (small words,
    elision, acronyms; tested together with its SQL twin in seed `90995`) into `packages/shared`.
    The dictionary keeps using it with unchanged behaviour, and those tests stay green. public-web
    imports it by deep path (bundle budget; see the note in `packages/shared/index.js`).
  - **Applied at render, not by retyping strings.** Classify every `site.*` key and every portal
    chrome key as LABEL or PROSE in one maintained list next to
    `scripts/gen/gen-site-copy-catalogue.js`. Register ONE i18next post-processor in
    `public-web/src/lib/i18n.ts` that title-cases LABEL keys.
  - Tenant overrides from the copy editor (`public-web/src/lib/site-copy.ts`) go through the same
    path, and so do tenant-authored titles drawn by the heading components. Body content never.
  - A website setting, "Label capitalisation: Title Case (standard) / As written", defaulting to
    Title Case for every tenant.
  - **It is a standard that must hold.** Add a sixth check to the dictionary gate
    `public-web/scripts/check-i18n.mjs` (`npm run check:i18n`, already in CI) that fails when a
    key is unclassified, so no new label escapes the rule. Regenerate the site-copy catalogue if
    keys change (`node scripts/gen/gen-site-copy-catalogue.js`, which has a `--check` gate).
  - Amend `doc/BRAND_GLOSSARY_FR_EN.md` §5 rule 3 and `doc/WEB_BUILD_BRIEF.md` N8 (both say
    "French has no title case") to record this owner decision, dated, with its scope.

**F3 — Nav spacing (1.12).** Measure the label-to-label gaps; the Services chevron makes one gap
read wider. Give every item the same visual rhythm, and put before/after measurements in the PR.

## Boundaries — other PRs own these

- **PR 2** (may run in parallel) owns quote-request data and screens:
  `src/modules/sales/quote_request/*`, `src/modules/sales/public_intake/*`, `createClientQuote`
  in `src/modules/portal/portal.service.js`, `client/src/features/sales/quote-request*.tsx`,
  `public-web/src/features/portal/screens/quotes.tsx`,
  `public-web/src/components/site/quote-wizard.tsx`, `public-web/src/lib/intake-api.ts`.
  You only add notification entries for quote requests (B3).
- **PR 3** owns currencies, the financial dictionary (except lifting `titleCase`), expense rates,
  corporate-entity coverage, deleting draft clients, signing and the Control Tower.
- **PR 4** owns quotations / proposals, costing families, the portal's
  "Requests for Quotation / Quotations" menu split and the command palette.
- If a fix truly needs one of those files, keep the hunk minimal and explain why in the PR.

## Rules

- Migrations ONLY in: tenant `14260`–`14299`, platform `0111`–`0114`, seeds `9140`–`9144`. They
  must be idempotent and reversible (the idempotency, reversibility, numbering and
  destructive-migration gates in `scripts/db`). Never renumber an applied migration.
- Never `window.confirm` / `alert` / `prompt`. Use `DateField` / `DateTimeField`, and format
  dates with `lib/format.ts`. Uploads go only through the upload engine. Colour comes only from
  tokens.
- Validation lives in `packages/shared` and is used by both sides (`check:schemas`). The RBAC
  action is `edit`, not `update`.
- Test as a NON-CEO user: the CEO role bypasses `requirePermission`, so CEO testing proves
  nothing about permissions.
- Every module whose reads or writes change updates its `<module>.ai.js` under the AI write
  contract (`tests/unit/ai-write-contract.test.js`).
- Regenerate, never hand-edit: `node scripts/generate-api-docs.js`, the API contract
  (`check-api-contract --update`), the site-copy catalogue.
- Nothing from TEST may email or push anyone; keep the sandbox refusals on every new send.
- Silent catches carry a taxonomy marker (`doc/ERROR_HANDLING.md`).
- Before every push: merge `origin/main`, then run `npm run ci` from the root (the full gate
  list), each frontend app's lint and tests, and the FULL backend jest — never a subset.

## Definition of done (prove each in the PR)

1. A client uploads an RCCM; staff accept it. It shows on Client 360 › Documents as VERIFIED,
   "Missing Business Licence / RCCM" is gone, and it appears in the client's portal Library.
   Integration test.
2. The portal asks for the activation types including the Attestation (unless exempt) plus the
   remaining rule types, never bank details. Open BANK_DETAILS requests are cancelled.
3. "Request from client" offers the same types as "Add document", with each type's status;
   several can be requested at once; accepting an answer files it under its type.
4. A client is created with an account manager and one Also-notify person. A client message,
   document, payment claim and portal quote request each reach exactly that list (account
   manager, Also-notify, CEO-role users) in-app, by push and by email, respecting opt-outs.
5. A portal quote request gets the acknowledgement; moving it to QUOTED emails and pushes the
   client.
6. "Send by email" on a team message delivers a branded email with the sender's signature and the
   attachment, once per click; the bubble then shows "Emailed to …". Every team message shows
   its delivery state.
7. A push tap with the app open lands without a full reload; a bell click on the current page
   refreshes it; a client upload appears live in the open Client 360 Portal tab.
8. A client's question on a stage can be seen and answered on the operations file, and the answer
   reaches the portal thread.
9. WhatsApp / copy share a sign-in link containing no token.
10. Header and hero show the portal entry; labels render Title Case in EN and FR; `check:i18n`
    fails on an unclassified key; nav gaps are measured equal.

## The pull request

Open ONE pull request to `main`. The title starts with a Conventional Commits prefix:

```
feat(portal): client documents reach the 360, who is told and how, taps that land, portal on the website (meeting 6, PR 1)
```

The body follows `.github/pull_request_template.md` and includes a table of register item →
what changed → how it was verified, plus anything not done and why.
