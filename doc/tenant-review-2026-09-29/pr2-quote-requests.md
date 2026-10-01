# PR 2 of 4 — Quote requests: one intake model for website, portal and desk

> Tenant review of 29 Sep 2026 ("meeting 6"). Owner decisions answered 2026-10-01.
> Evidence and decisions: [register.md](register.md) (items 2.1–2.11, decisions Q1–Q6).

You are working in the praxis-ls repository: Praxis LS, a white-label, multi-tenant logistics
and OHADA-accounting ERP. Backend Node/Express in `src/`, staff app in `client/`, public website
and client portal in `public-web/`, shared Zod schemas and rules in `packages/shared`. Read
`CLAUDE.md` before writing any code and follow it exactly.

## Context

A quote request reaches the tenant three ways — the public website, the client portal, and staff
keying one in from an email — and the three disagree about what a request is:

- none of them stores a structured service type: the website drops the service id it knows, the
  portal stores translated words ("Sea freight · Import", or the French) and regex-parses them
  back, and the desk picks from a hard-coded list of 10 that misses Rail, Customs Brokerage and
  Project Cargo;
- the portal wizard's modes and directions are hard-coded (no Rail, "In-country" instead of
  Inland, no Hinterland);
- Incoterms are hard-coded four times, all different;
- a portal request loses who asked (the list shows "—"), the desk cannot show channel PORTAL,
  website attachments are stored but never shown to staff, a request keyed in from an email can
  never be tied to a client, and a client cannot open a request or attach a document to it.

Every item has been verified against the code. If the code now contradicts the register, trust
the code, say so in the PR, and carry on.

## Read first

- [register.md](register.md): sections 0–2, the whole "PR2" section, "Owner decisions › PR2".
- `doc/FRONTEND_GUIDE.md`: §3.5 (primitives — the "Choose one" table), §3.10 (dialogs),
  §3.12 (dates), §3.13 (uploads, including public-web's own copy of the engine), §6 (pre-PR
  checklist).
- `doc/BUILD_CONVENTIONS.md`, `doc/AI_ARCHITECTURE.md` §2, `doc/SALES_CRM_FEATURES.md` (F6 intake).
- The header comments of `src/modules/operations/_shared/service-mode.js`,
  `public-web/src/lib/service-modes.ts` and `migrations/tenant/13774_service_type_enquiry_shape.sql`
  — they explain why services are data and why the website's wizard reads them.

## Owner decisions (final — do not re-ask)

- **Q1 The wizard's first step.** Six cards: **Sea, Air, Rail, Road** — grouped under a subtle
  "Transport" label — then **Storage** and **Customs**. After a card, the client picks the flow:
  **Import, Export, End-to-End, Inland or Hinterland**, showing only the flows that exist for that
  card. Every card and every flow maps to the tenant's service types: a service type added later
  appears on its own, and a request stores the service type it maps to.
- **Q2 Hinterland direction.** Under Hinterland (road or rail), ask "Into the hinterland" (import
  transit, e.g. Douala → N'Djamena) or "Out of the hinterland" (export transit, e.g.
  Bangui → Douala), stored on the request. One service type stays one service type.
- **Q3 Incoterms.** Each service type carries the Incoterms it offers, editable in Service types,
  pre-filled from the ICC 2020 rules: sea services get all 11; air, road and rail get the 7
  any-mode terms. Requests offer only those, plus "Not sure".
- **Q4 Documents on a portal request.** At least ONE document is required to send a portal
  request, and the commercial invoice is the one strongly encouraged — it is what lets the team
  price. The client can add more documents to a sent request at any time.
- **Q5 Tying a desk request to a client.** Both: a client picker on the Quote requests form that
  suggests the matching client from the requester's email or domain, AND "New quote request" from
  the Client 360 with the client already filled in. A linked request appears in that client's
  portal, and the client's account manager becomes its owner.
- **Q6 The public website.** The website's quote form uses the same six cards and steps through
  one shared component. Documents are strongly encouraged but stay optional there — a stranger may
  not have one yet and must not be turned away.

**Auditor defaults** (applied unless the owner overrides them; they are recorded in the register):

- A service that fits none of the six cards (today Project Cargo and Business Representation)
  is listed under a small "Other services" link below the cards, so nothing the tenant creates is
  ever unreachable.
- Owner of a new request: the linked client's account manager; a prospect stays unassigned until
  someone presses "Start review", which makes them the owner.
- The estimated weight reads "≈ 25 T" (capital T, as asked in the meeting).

## What to build

### A. One service-type model for every request (2.1, 2.2, Q1, Q2)

**A1 — Service types say where they go.**
- Each active service type must land on exactly one card and, inside it, one flow:
  - **card**: an explicit, editable transport mode on `service_type` (SEA / AIR / RAIL / ROAD /
    STORAGE / CUSTOMS / OTHER). Backfill it from `serviceMode(key)`
    (`src/modules/operations/_shared/service-mode.js`; its WAREHOUSE is the Storage card), and
    give a new service type the same derived default. The tenant corrects a wrong one in Service
    types without engineering — the reason `13774` gave `enquiry_shape` its own column applies
    here.
  - **flow**: derived from the existing, editable `territory` — INTERNATIONAL_IMPORT → Import,
    INTERNATIONAL_EXPORT → Export, END_TO_END_INTERNATIONAL → End-to-End, DOMESTIC_INLAND → Inland,
    TRANSIT_HINTERLAND → Hinterland. A card holding a single service (Storage, Customs today)
    skips the flow step.
  - If two active services share a card and flow, the flow step shows their names instead, so
    nothing collapses silently. Service types warns about such a pair.
- Show and edit the mode in `client/src/features/masterdata/service-type-form.tsx` and the
  dossier (`service-type-dossier.tsx`), validated in `service_type.validator.js` (the
  "write routes are validated" gate, `scripts/check-write-route-validators.js`), and update
  `service_type.ai.js`.

**A2 — A request stores its service type.**
- Add `quote_request.service_type_id` (FK to `service_type`) plus the Hinterland direction
  (Q2), in your migration range.
- Backfill existing rows: match `service_category` against the service's key, `name_en` and
  `name_fr`, and the portal's "<mode> · <direction>" words in both languages (the portal's
  `modeOf` / `directionOf`, `public-web/src/features/portal/screens/quotes.tsx:114-131`, show the
  patterns). Leave an unmatched row null and report how many in the PR.
- Keep `service_category` as a display copy written from the service's name on every write, so
  exports, leads (`lead.service_interest`) and the AI keep working.
- All three paths write `service_type_id`:
  - **website** — `public-web/src/components/site/quote-wizard.tsx:221-225` knows the id but
    posts only the name; the intake schema is `.strict()`
    (`src/modules/sales/public_intake/public_intake.validator.js:20`). Accept and validate the id
    server-side (an active, published service).
  - **portal** — sends the picked service type, not words (`quotes.tsx:440`).
  - **desk** — the edit form uses a service-type picker (A4).

**A3 — The wizard, shared by portal and website (Q1, Q2, Q6).**
- ONE component in `public-web` used by both the portal sheet
  (`public-web/src/features/portal/screens/quotes.tsx`) and the website wizard
  (`public-web/src/components/site/quote-wizard.tsx`). It replaces the portal's hard-coded
  `MODES`, `DIRECTIONS` and `INCOTERMS` (`quotes.tsx:42-45`).
- Step 1: the six cards (Sea, Air, Rail, Road under a subtle "Transport" label; Storage;
  Customs), each shown only when the tenant offers at least one service there, plus the
  "Other services" link. Then the flow chips, then the Hinterland direction when relevant.
- The website keeps reading published services (`/public/services`, published AND active). The
  portal reads ALL active service types through a new portal endpoint, since existing clients may
  need services the tenant does not market. Both carry the card and flow from A1.
- Keep what each already does well: the portal's prefill ("Same as last time", "Like PRX-…"), the
  AI fill (`portal_quote_fill.service.js` must now return a service type and use the shared
  Incoterms), the place pickers, `enquiry_shape` on the website.
- Labels: "Inland", never "In-country". New portal strings follow the Title Case standard and the
  LABEL / PROSE classification gate in `public-web/scripts/check-i18n.mjs` if PR 1 has merged.

**A4 — The desk's edit form (2.1, 2.5, 2.11).**
- In `client/src/features/sales/quote-request-forms.tsx`, replace the hard-coded
  `SERVICE_CATEGORIES` (`:38-49`) with a searchable picker over active service types, from the
  primitives table in `doc/FRONTEND_GUIDE.md` §3.5 (`<Select>` with rich options or
  `<SearchSelect>`), showing each service's name and card. Tom asked for "a picker with a
  popover".
- Channels: add PORTAL and EMAIL to the form's channels (`:37`) and to the list's filter chips
  (`client/src/features/sales/quote-requests.tsx:98-104`). A portal request must never display
  as MANUAL. Labels are translated words, never codes (also `WAREHOUSE_DURATIONS`).
- Incoterm: the picker offers the chosen service's Incoterms (B) plus "To be determined", which is
  how the portal's "Not sure" (stored `TBD`) shows. It never silently displays EXW or defaults
  to FOB (`:101`, `:125`).

### B. Incoterms from the service type (2.3, Q3)

- One ICC 2020 list in `packages/shared` (`data/incoterms.js` or similar): the 11 codes, EN/FR
  names, and which are sea-and-inland-waterway only (FAS, FOB, CFR, CIF).
- `service_type` gets the Incoterms it offers, editable in the service-type form and dossier,
  backfilled from the ICC rules by the service's mode.
- Every consumer reads the shared list: the wizard (A3), the desk form (A4), the AI fill
  (`src/modules/portal/portal_quote_fill.service.js:36`) and the mail glossary
  (`src/modules/mail/assist/assist.glossary.js:8`). No hard-coded list survives.

### C. Who asked, who owns it (2.4, 2.5)

- `createClientQuote` (`src/modules/portal/portal.service.js:300`) fills the requester from the
  COMPANY record and never sets `requester_company`. Instead:
  - requester name and email = the signed-in portal user;
  - `requester_company` = the client's name;
  - the quote list shows the company, never "—", and "Logged by" reads
    "Client portal · <person>" (`client/src/features/sales/sales-360.tsx:1129`).
- Owner: the linked client's account manager on create (portal and linked desk requests). A
  prospect stays unassigned until "Start review", which makes the reviewer the owner.

### D. Documents with a request (2.6, 2.7, Q4)

- **Portal (required).** The wizard's last step asks for documents, with type chips — Commercial
  invoice (shown first and recommended), Proforma, Packing list, BL / AWB, Photos of the goods,
  Other — and a line saying why: the team prices faster and more accurately with them. At least
  one document is required to send.
  - Use public-web's copy of the upload engine (`public-web/src/components/ui/file-input.tsx`,
    `public-web/src/lib/image-compress.ts`, the portal's `features/portal/ui/upload.tsx`): preview,
    0→100 % progress, compression with the `document` profile. Never `<input type="file">`
    (`praxis/no-raw-upload`, `praxis/require-upload-progress`).
  - Upload before the request is created (as the website intake already does), so a request can
    never exist without its document. Files go to the vault owned by the client, then are linked
    to the new request in the creating transaction, and the server checks they belong to this
    client. Orphans are cleaned by the existing vault-orphan compensation.
- **A sent request.** "Add a document" on the request (portal detail, E), same rules.
- **Website (encouraged, optional).** Same document step, strongly encouraged, skippable.
- **The website file staff never see (2.7).** `storeAttachment` files it under
  `entityRef: "quote_request:intake"` and keeps it only in `quote_request.attachment_doc_id`
  (`src/modules/sales/public_intake/public_intake.service.js:82-100,145`), while the Attachments
  tab and the 360 read only `quote_request_attachment` (`quote_request.repo.js:199`,
  `src/modules/sales/sales-360.service.js:290`). Write every website file as a
  `quote_request_attachment` (the first as PRIMARY) under the request's own entity ref, and
  backfill the existing `attachment_doc_id` rows.
- **From the chat.** On an attachment in a client conversation (Client 360 › Messages,
  Comms › Clients), staff can "File on a quote request", picking one of that client's open
  requests. It links the same vault file; no copy.

### E. The request in the client's portal (2.9)

- A request opens (sheet on a phone, panel on a desktop) showing: the scope as sent, its
  documents with "Add a document", the status as a timeline (from the request's history), and —
  when there is one — the proposal that answered it (reached through the request's opportunity).
  Leave a clearly named place for PR 4 to add the quotation.
- Keep the route `/portal/quotes` and the page component's overall structure: PR 4 splits the
  portal menu into "Requests for Quotation" and "Quotations" and will move the proposals tab.

### F. Tying a desk request to a client (2.8, Q5)

- Add `client_id` to the quote-request validator and the PATCH whitelist (`WRITABLE`,
  `quote_request.repo.js:16`), with a shared Zod rule. A CONVERTED or closed request cannot be
  re-linked.
- The Quote requests form gets a client picker. When the requester's email matches a client
  contact, or its domain matches a client's — never a public webmail domain (gmail.com,
  yahoo.fr, outlook.com, hotmail and the like) — that client is suggested in one tap. The
  email-to-request conversion (`client/src/features/comms/inbox/work/convert.tsx`) gets the same
  suggestion from the sender's address.
- The Client 360 gets "New quote request" with the client filled in and the requester taken from
  the chosen contact, and lists that client's requests.
- A linked request appears in the client's portal (the portal already lists by `client_id`) and
  takes the account manager as owner (C).

### G. Small things (2.10, 2.11)

- The weight line reads "≈ 25 T" (`quotes.tsx:609`).
- Every code-like label the desk shows (service keys, channels, warehouse durations) is a
  translated word.

## Boundaries — other PRs own these

- **PR 1** (may run in parallel) owns notifications: `src/shared/notifications/*`,
  `src/modules/portal/portal_notify*`, `src/modules/notification/*`,
  `packages/shared/rules/notification-email-default.js`, the push service worker, client
  documents and KYC, and the public-web Title Case / LABEL classification. Keep emitting
  `quote_request.created` and the transition events exactly as today — PR 1 routes them.
- **PR 3** owns currencies, the financial dictionary, expense rates, corporate-entity coverage,
  deleting draft clients, signing and the Control Tower.
- **PR 4** owns quotations / proposals, the portal's "Requests for Quotation / Quotations" menu
  split, costing families and the command palette.
- If a fix truly needs one of those files, keep the hunk minimal and explain why in the PR.

## Rules

- Migrations ONLY in: tenant `14300`–`14339`, platform `0115`–`0118`, seeds `9145`–`9149`. They
  must be idempotent and reversible (the idempotency, reversibility, numbering and
  destructive-migration gates in `scripts/db`). Never renumber an applied migration.
- Never `window.confirm` / `alert` / `prompt`. Use `DateField` / `DateTimeField`, and format
  dates with `lib/format.ts`. Uploads go only through the upload engine. Colour comes only from
  tokens.
- Validation lives in `packages/shared` and is used by both sides (`check:schemas`) — including
  the website intake and portal quote shapes. The RBAC action is `edit`, not `update`.
- Test as a NON-CEO user: the CEO role bypasses `requirePermission`.
- Update every touched module's `<module>.ai.js` under the AI write contract
  (`tests/unit/ai-write-contract.test.js`): `quote_request.ai.js`, `service_type.ai.js`,
  `portal.ai.js`.
- Regenerate, never hand-edit: `node scripts/generate-api-docs.js`, the API contract
  (`check-api-contract --update`), the site-copy catalogue if `site.*` keys change.
- Nothing from TEST may email or push anyone.
- Before every push: merge `origin/main`, then run `npm run ci` from the root (the full gate
  list), each frontend app's lint and tests, and the FULL backend jest — never a subset.

## Definition of done (prove each in the PR)

1. A service type added in Service types appears under the right card and flow in the portal and,
   once published, on the website — with no code change. Project Cargo and Business
   Representation are reachable under "Other services".
2. Sea → Import, Rail → Hinterland (with direction) and Storage requests from the portal, the
   website and the desk each store the matching `service_type_id`; the backfill matched the
   existing rows and reports the unmatched count.
3. Each request offers exactly its service's Incoterms plus "Not sure"; the desk shows TBD as
   "To be determined"; no hard-coded Incoterm list remains (grep it).
4. A portal request cannot be sent without a document, uploads with progress, and arrives with
   its files in the Attachments tab; the client adds another later.
5. A website enquiry's file shows in the Attachments tab, and so do the backfilled old ones.
6. A portal request shows the company in the list, "Client portal · <person>" as logged by, the
   account manager as owner, and channel PORTAL in the form and filter.
7. A request keyed in from an email gets its client suggested, is linked, then appears in that
   client's portal; "New quote request" on the Client 360 does the same.
8. A client opens a request in the portal and sees its scope, documents, status timeline and the
   proposal that answered it.
9. Staff file a chat attachment onto an open request in one action.

## The pull request

Open ONE pull request to `main`. The title starts with a Conventional Commits prefix:

```
feat(quotes): one quote-request model across website, portal and desk — service types, Incoterms, documents, client link (meeting 6, PR 2)
```

The body follows `.github/pull_request_template.md` and includes a table of register item →
what changed → how it was verified, plus anything not done and why.
