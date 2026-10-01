# PR 4 of 4 — Quotations end-to-end, and search that finds everything

> Tenant review of 29 Sep 2026 ("meeting 6"). Owner decisions answered 2026-10-01.
> Evidence and decisions: [register.md](register.md) (items 4.1–4.5, decisions G1–G6).
> **Start only after PR 2 is merged** — this builds on its request ↔ client link, its
> `service_type_id` and its portal request screen.

You are working in the praxis-ls repository: Praxis LS, a white-label, multi-tenant logistics
and OHADA-accounting ERP. Backend Node/Express in `src/`, staff app in `client/`, public website
and client portal in `public-web/`, shared Zod schemas and rules in `packages/shared`. Read
`CLAUDE.md` before writing any code and follow it exactly.

## Context

- **Quotations never reach the client.** The portal lists Sales proposals only
  (`src/modules/portal/portal_proposal.service.js:96`). Commercial quotations (MOD-27) — what the
  team prepares, including for requests that arrived by email — are absent. Timothée asked for
  them in the portal.
- **One "Quotes" page.** The portal menu has one Quotes line, whose Proposals tab appears only once
  a proposal exists (`public-web/src/features/portal/screens/quotes.tsx:183-201`). Agreed in the
  meeting: separate "Requests for Quotation" and "Quotations" lines in the left menu.
- **No quotation from a costing.** `quotation.createDraft` takes lines from the caller and only
  stores `costing_id`; today's only route is costing → margin simulation → approve → "Create
  quotation" (`client/src/features/commercial/margin-simulations.tsx:1013`).
- **Families need work** before the tenant tests them: today a per-line select in the "By family"
  view (`client/src/components/client-families.tsx`).
- **Nobody can find anything by typing.** ⌘K matches English nav labels by substring
  (`client/src/components/command-palette.tsx:224-240`): "quote" does not find "Quotations",
  "devis" finds nothing, and there is no record search. Tom could not find Quotations in the
  meeting — it sits under Engage › Commercial while Proposals is under Sales & CRM.

If the code now contradicts the register, trust the code, say so in the PR, and carry on.

## Read first

- [register.md](register.md): sections 0–2, the whole "PR4" section, "Owner decisions › PR4", and
  the PR 2 decisions (Q1–Q6) you build on.
- `src/modules/portal/portal_proposal.service.js` — the portal's e-signature acceptance you reuse.
- `src/modules/commercial/quotation/*`, `src/modules/commercial/margin_simulation/*`
  (`margin_simulation.rules.js`: `classifyLine`, `priceForMargin`, `computeMargin`).
- `migrations/tenant/14130_client_headings.sql` and `client/src/lib/client-headings.ts` — families.
- `client/src/app/screen-registry.json` / `screen-registry.ts`, `client/src/app/layout/areas.ts`,
  `tests/unit/ai-readiness.test.js`, `doc/AI_READINESS.md`.
- `doc/FRONTEND_GUIDE.md` §3.5, §3.10, §3.12, §3.13, §6; `doc/SIGNATURE_ENGINEERING_GUIDE.md`.

## Owner decisions (final — do not re-ask)

- **G1 Quotation from a costing.** One click on a costing, priced directly: débours pass through
  at cost (no margin, no VAT); our service lines take their price plus the tenant's target margin;
  own-cost lines stay internal — they set the floor and are not billed. Families come across. The
  quotation opens as a DRAFT to adjust; the workings are kept as a margin simulation behind the
  scenes.
- **G2 Families.** All four: move several lines at once; a family column in the detailed view;
  drag a line between families; order the families (per document, with a default order in
  settings).
- **G3 Quotations in the portal.** Cards that identify each offer at a glance (both quotations and
  proposals, with All / Quotations / Proposals tabs). A card opens a full page: every detail,
  download, accept and sign, decline — then back. From that page the client can ask about the
  quotation in the chat, with the quotation referenced. Seamless, no friction.
- **G4 Acceptance.** E-signature, exactly like proposals: the signature programme's flow bound to
  the document's hash. Accepted → the team is told and can turn it into an invoice draft. Decline
  asks for a reason.
- **G5 Search.** ⌘K finds EVERYTHING — every module, page, tab and record — in English and
  French, limited to what the person may open. A gate makes sure every new page and tab is
  registered, and `CLAUDE.md` and the README say so.
- **G6 Staff menu.** Quotations moves next to Proposals in Sales & CRM: Quote requests →
  Proposals → Quotations, the order the work flows. Commercial keeps the simulators and pricing
  variance.

**Auditor defaults** (applied unless the owner overrides them; recorded in the register):

- "Create quotation" is offered on a costing that is validated or approved; on a draft costing
  it is disabled with the reason.
- If the tenant has no target-margin setting yet, add one (Settings › Commercial) defaulting to 0 %,
  so nothing is invented; the quotation form shows the margin applied.
- On a phone, the portal's bottom bar keeps five slots: "Requests" and "Quotations" sit under one
  Quotes slot with a two-way switch at the top of the page; the desktop sidebar has both lines.

## What to build

### A. A quotation from a costing (4.3, G1)

- A "Create quotation" action on the costing sheet (`client/src/features/costing/costing-sheet-360.tsx`)
  and its API.
- Pricing reuses the margin simulator's own rules, so a quotation priced directly equals what the
  simulator would produce for the same costing at the target margin:
  - débours lines (by `classifyLine`) pass through at cost, no margin, no VAT;
  - service lines are priced with `priceForMargin` at the tenant's target margin;
  - own-cost lines are not billed. The quotation shows the pricer "Own costs on this file: X — the
    services must cover them", with a warning when they do not.
- Families (`client_heading`), container types, tax codes and quantities cross intact.
- The quotation opens as a DRAFT linked to the costing (`costing_id`) and to the client's quote
  request when there is one. The workings are saved as a margin simulation linked both ways and
  marked as created from the costing — the pricer is not walked through it. The quotation's
  existing send / approval flow is unchanged.
- `quotation.ai.js` and `costing.ai.js` advertise the new write under the AI write contract.

### B. Families (4.4, G2)

In both the costing sheet and the quotation form (shared `client/src/components/client-families.tsx`
and its callers):

- **Move several at once** — tick lines (detailed or By-family view), then "Move to family…"
  (the registry's headings or a new one made up for this document).
- **A family column in the detailed view** — see and change each line's family without switching
  views.
- **Drag between families** in the By-family view, with an equivalent keyboard path and an
  announced move (a11y).
- **Order the families** — per document, with a default order in Financial Dictionary settings
  (the `CLIENT_HEADING` registry); the printed quotation and invoice follow it.
- Printed and signed payloads keep the rules of `14130`: detailed lines are stored, posted and
  signed; print shows one line per heading × nature.

### C. The portal: Requests for Quotation and Quotations (4.1, 4.2, G3, G4)

- **Menu** (`public-web/src/features/portal/shell/portal-shell.tsx:160-164`, routes in
  `portal-app.tsx`): "Requests for Quotation" (the request list PR 2 built) and "Quotations",
  each its own line on desktop. On a phone, see the auditor default. `/portal/quotes` keeps
  working (redirect). The Quotations line shows how many offers wait for an answer.
- **Cards.** Every offer the client may see — commercial quotations SENT / ACCEPTED / REJECTED /
  EXPIRED / CONVERTED, and proposals as today — newest and "waiting for you" first, with tabs
  All / Quotations / Proposals. Each card shows enough to recognise it: number, service, route,
  total and currency, valid-until, status, and the request it answers.
- **The offer page.** Opens from a card, back returns to the list:
  - every detail — service, route, Incoterm, validity, payment terms, the families exactly as the
    PDF prints them, HT / VAT / TTC;
  - "Download PDF" (the QUOTATION template, `src/services/documents/templates/registry.js:163`);
  - "Accept and sign" and "Decline" (G4);
  - "Ask about this quotation" opens the chat with the quotation referenced (a reference chip the
    team sees in the Client inbox, linking to the quotation).
- **Acceptance (G4).** Reuse `portal_proposal.service.js` for QUOTATION — it is already a
  signable type (`src/modules/vault/document_vault/document_vault.types.js:254`) with a canonical
  hash (`src/services/signatures/canonical.js:153`). Start, code, complete, then the quotation's
  `accept` (`quotation.service.js`; convert stays a staff decision). Decline records the reason.
  When the tenant has e-signature off, offer the same confirmed "Accept" that proposals fall back
  to.
- **Telling people.** A quotation SENT reaches the client like a proposal does (add `quotation.sent`
  to `src/shared/notifications/notify-portal.js`, topic PROPOSALS). Accepted / declined reach the
  team (add both to `NOTIFIABLE`, `src/shared/notifications/notify-events.js`, routed to the
  client's "who is told" list from PR 1 if it has merged). Keep those hunks minimal — PR 1 owns
  those files.
- **The request ↔ quotation link.** Add `quotation.quote_request_id`, set when the quotation comes
  from a request (through its opportunity or picked by staff). The portal's request page (PR 2 left
  a named place) shows the quotation; the quotation shows its request.
- New portal strings follow the Title Case standard and the LABEL / PROSE gate
  (`public-web/scripts/check-i18n.mjs`) PR 1 adds.

### D. The staff menu (G6)

- Move Quotations into Sales & CRM after Proposals (`client/src/app/layout/areas.ts`):
  Quote requests → Proposals → Quotations. Commercial keeps Margin simulation, Extra-charge
  simulation and Pricing variance.
- Old URLs keep working (`/commercial/quotations` redirects). Update the screen registry, the axe
  register and every link that pointed there.

### E. Search that finds everything (4.5, G5)

This is the largest part of the PR. Build it as one coherent piece.

- **What it finds**, limited to what the person may open (the same `canOpenRoute` and RBAC module
  checks the shell uses — never a result that would 403):
  - **modules and pages** — every route;
  - **tabs and sections** — every hub section (`/sales/:section` and the like) and every
    URL-addressable tab of every 360 / dossier;
  - **records** — at least: clients, suppliers, contacts, operations files, quote requests,
    proposals, quotations, costings, invoices (proforma and final), receipts, purchase orders,
    employees, treasury accounts, dictionary lines, service types, documents in the vault — by
    reference number and by name;
  - **actions** — the existing quick actions, plus "Ask Praxis AI".
- **Both languages and real words.** Titles in EN and FR, plus one maintained synonym list
  (quote / devis / cotation / offer → Quotations; invoice / facture; file / dossier / opération;
  client / customer; …). Accent- and case-insensitive; a typo of one letter still finds it.
- **Records come from the server**: one `/search` endpoint fanning out to per-module search
  providers, each declared next to its module (the same "a module that is not declared is
  invisible" principle as the AI manifests), each enforcing its module's `view` permission,
  respecting LIVE / TEST, bounded per group, rate-limited, and fast on the existing trigram /
  search indexes (`migrations/tenant/0504_correctness_and_search_indexes.sql`; add what is
  missing in your range).
- **The palette**: grouped results (Pages, Tabs, then each record type, then Actions), keyboard
  first, recent searches, opening a record lands on its 360 or detail.
- **The gate — every page, every tab, no exceptions** (the owner's words: "Every single one").
  Extend the screen registry (`client/src/app/screen-registry.json`) to carry tabs and sections
  with EN / FR titles and synonyms, and add a check, wired into `npm run ci` and CI, that fails
  when:
  - a `<Route>` in `client/src/app/app.tsx` has no registry entry;
  - a hub section in `areas.ts` or a URL-addressable tab has no entry;
  - a module with records has no search provider (or an explicit, reasoned opt-out, like
    `// ai:none`);
  - an entry points at a route that no longer exists.
  Today `tests/unit/ai-readiness.test.js` checks only the registry's shape and uniqueness; the
  router has about 105 routes. Make registering the path of least resistance:
  `client/scripts/new-screen.mjs` prints the registry entry with the rest.
- **Write the rule down.** Add a short "Search: every page, tab and record is findable" rule to
  `CLAUDE.md` (beside the other frontend rules, naming the gate) and to the README's development
  section, and update `doc/AI_READINESS.md` where it describes the registry.

**If the diff becomes too large to review in one piece**, ship E as its own pull request directly
after this one (title `feat(search): …`), with the same Definition of done for E. Both must merge
before the tenant's next review.

## Boundaries — other PRs own these

- **PR 1** owns notifications (you add only the quotation entries in C), client documents and KYC,
  the public website and the Title Case gate.
- **PR 2** owns quote-request data, the service-type mode / flow / Incoterms, and the portal's
  request list and request page — you add the quotation to the place it left for you.
- **PR 3** owns currencies (a EUR quotation uses the fixed parity once PR 3 has merged), the
  financial dictionary and its siblings, expense rates, signing windows and the Control Tower.
- If a fix truly needs one of those files, keep the hunk minimal and explain why in the PR.

## Rules

- Migrations ONLY in: tenant `14380`–`14419`, platform `0125`–`0128`, seeds `9155`–`9159`. They
  must be idempotent and reversible (the idempotency, reversibility, numbering and
  destructive-migration gates in `scripts/db`). Never renumber an applied migration.
- Never `window.confirm` / `alert` / `prompt`. Use `DateField` / `DateTimeField`, and format
  dates with `lib/format.ts`. Colour comes only from tokens. Drag and drop has a keyboard
  equivalent.
- Validation lives in `packages/shared` and is used by both sides (`check:schemas`). The RBAC
  action is `edit`, not `update`.
- Test as a NON-CEO user: the CEO role bypasses `requirePermission`, and search must never show a
  record the person cannot open.
- Update every touched module's `<module>.ai.js` under the AI write contract
  (`tests/unit/ai-write-contract.test.js`), and the AI catalogue (`node scripts/ai/sync-actions.js`).
- Regenerate, never hand-edit: `node scripts/generate-api-docs.js` and the API contract
  (`check-api-contract --update`).
- Nothing from TEST may email or push anyone.
- Before every push: merge `origin/main`, then run `npm run ci` from the root (the full gate
  list), each frontend app's lint and tests, and the FULL backend jest — never a subset.

## Definition of done (prove each in the PR)

1. "Create quotation" on an approved costing opens a DRAFT quotation: débours at cost without
   VAT, services at the target margin, own costs not billed but shown as the floor, families
   intact; the linked margin simulation exists; the result equals the simulator's for the same
   inputs (test).
2. Families: several lines moved at once; changed from the detailed view; dragged (and moved by
   keyboard); the family order chosen on the document is the order printed.
3. The portal shows "Requests for Quotation" and "Quotations" lines on desktop and the agreed
   switch on a phone; `/portal/quotes` still works.
4. A SENT quotation appears as a card and its page shows the families exactly as its PDF, which
   downloads; the client is notified as for a proposal.
5. The client signs it: it becomes ACCEPTED with a verifiable signature and the team is told; a
   decline records the reason.
6. "Ask about this quotation" opens the chat with the reference, and staff see the chip linking to
   the quotation.
7. The request page shows its quotation; the quotation shows its request.
8. Quotations sits after Proposals in Sales & CRM; the old URL redirects.
9. ⌘K finds "quotation", "devis" and "cotation" → Quotations; a client by name; a quotation, a
   request and an operations file by number; a 360 tab by name — and nothing the user may not
   open.
10. The new gate fails on an unregistered route, hub section or tab, and on a module with
    records but no search provider; `CLAUDE.md` and the README state the rule.

## The pull request

Open ONE pull request to `main` (or two, per E's escape hatch). The title starts with a
Conventional Commits prefix:

```
feat(quotes): quotations from costing to the client's portal — families, e-signed acceptance, Sales & CRM menu, search that finds everything (meeting 6, PR 4)
```

The body follows `.github/pull_request_template.md` and includes a table of register item →
what changed → how it was verified, plus anything not done and why.
