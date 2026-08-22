# Smart Mail — Principal Engineer Independent Audit

**Date:** 2026-08-22 · **Auditor:** Principal Engineer / QA specialist consultant (independent of the
build and QC teams)
**Measured against:** `doc/SMART_MAIL_ENGINEERING_GUIDE.md` (plan of record, incl. §1 decision log,
§3 cross-cutting, §4–§9 chapters, §10.5 Definition of Done) and `doc/SMART_MAIL_PROGRAMME_QUESTIONNAIRE.md`
(35 decisions + 8 additions).
**Method:** independent line-by-line read of every file under `src/modules/mail/`, the mail job
handlers, all 47 programme migrations, the client mail surface, and every mail test file; plus
*executed* verification — full backend suite, full client suite, `tsc -b`, production build,
bundle/shared/schema gates, and chunk-graph analysis. Nothing in this report is taken on trust from
`doc/SMART_MAIL_PR2_PR5_QC_AUDIT.md` or `doc/SMART_MAIL_FIELD_NOTES.md`; each claim below was
re-verified against the tree, and where the in-house QC claims were re-verified, they are marked
*(re-verified)*.

---

## 0. Executive summary

**Final score: 76 / 100** — *substantially delivered, with genuinely excellent craft in the parts
that exist, but the programme currently fails its own §9.5 MUST ("one predicate, applied to every
thread read") on roughly 30 routes, and carries three Critical authorisation defects that the
in-house QC passes did not catch.*

| Per-PR score | Score | One-line verdict |
|---|---|---|
| PR-0 Foundation | **92** | Delivered and wired; the send-point registry's `is_wired` claims were wrong at merge (fixed later) and one phantom send point remains. |
| PR-1A Mail Core (model) | **89** | Best chapter in the programme; per-user state, folders, FTS and backfill are correct. The legacy flat surface it left mounted carries an unscoped read. |
| PR-1B Master Composer | **84** | The serializer is exemplary and the send queue is race-correct, but inbound attachments cannot be opened and nothing can be deleted. |
| PR-2 Signatures & Deliverability | **88** | Substantially delivered and wired; PNG rendering pays a browser launch per render; migration renumbering left a stale header. |
| PR-3 Binding, Dossier & Collaboration | **74** | Binding is real and suggest-only as specified; every thread-scoped route in the chapter runs without the §9.5 predicate. |
| PR-4 AI Layer | **78** | The facade is gone — real LLM calls, grounding, fence, metering — but the draft/OCR paths read threads and attachments the caller may not see. |
| PR-5 Workflow, Security & Compliance | **71** | The hardest chapter is 90% wired; the visibility model it was built to protect has a full bypass in `shareThread`. |
| Cross-cutting (flags, i18n, migrations, process) | **75** | Gates are unusually strong; i18n parity and the §3.8 range discipline were broken. |

**The four things that must be fixed before any pilot tenant:**

1. **C-1 — PRIVATE-visibility bypass.** `POST /mail/threads/:id/share` (any MOD-72 *edit* user)
   inserts a `email_thread_share` row for any thread and any user. The §9.5 predicate treats a
   share row as a read grant — so **any operator can grant themselves read access to any Private
   thread in the tenant**. The "privacy" control is bypassable without CEO/God-Mode.
2. **C-2 — Vault exfiltration.** `POST /mail/attachments/from-vault` calls
   `documentVault.get(client, id)`, which is a bare id lookup — the vault's own
   `requireDocumentPermission` never runs. Any MOD-72 *create* user can attach **any document in
   the tenant vault (HR files, other clients' contracts, bank documents)** to a draft and send it
   outside.
3. **C-3 — Unscoped tenant-wide inbox.** Legacy `GET /mail/inbox` (still mounted, still rendered by
   the live "Message log" tab) lists **every inbound message of every mailbox in the tenant** for
   any MOD-72 *view* user, with no mailbox scope, no thread visibility, and a mailbox-wide
   `is_read` — the exact defect the PR-1A rework existed to remove.
4. **C-4 — The ungated class.** ~30 thread/message/attachment-scoped routes across
   `binding.routes.js`, `triage.routes.js` and `assist.routes.js` execute with no §9.5 check at
   route or service level: internal notes readable (and writable), private threads bindable to ERP
   entities (a CRM-timeline write), action cards and suggestions readable, OCR pointed at
   private-thread attachments **through a third-party vision vendor**, and AI drafts generated over
   private-thread transcripts. The in-house FN-2 lesson ("a write that RETURNS the row is a read")
   was applied to exactly four triage routes and not enumerated across the module.

Everything else is high-quality, tested, and — for the parts the QC passes covered — genuinely
well-engineered. The audit below is exhaustive, with evidence per finding and a QA checklist at the
end.

---

## 1. Verification log (what was actually run)

| Check | Result |
|---|---|
| `npx jest` (full backend suite) | **5,447 passed, 41 skipped, 349 suites, 0 failed** (64.6 s). The only mail skip: `mail-imap.test.js`, gated on live cPanel credentials — legitimate. |
| `client: npx tsc -b` | **Clean, zero errors.** |
| `client: npx vitest run` | **1,708 passed, 6 skipped, 112 files, 0 failed.** |
| `client: npm run build` + `check:bundle` | Build green; chunk graph acyclic; **TipTap/prosemirror verified absent from the entry and vendor chunks** — `index-9X_kE9Fe.js` (the editor, 387 kB) is referenced only by the lazy `mail-CG42bcXL.js` chunk. §3.7 bundle rule satisfied. |
| `check:shared`, `check:schemas` | Green. |
| Migration rollback blocks | All 47 programme migrations carry a `-- DOWN` block. |
| Feature-flag gating | `mail.core`/`mail.composer`/`mail.antispoof`/`mail.ai`/`mail.ocr`/`mail.binding`/`mail.notes`/`mail.doc_intake`/`mail.shared_inbox`/`mail.followup`/`mail.secure_links`/`mail.archive` all observed applied on routes or in hooks (re-verified in `mail.routes.js`, `assist.routes.js`, `binding.routes.js`, `triage.routes.js`, `ingest-hooks.flagOn`). |
| API reference | `doc/API_REFERENCE.md` is generated from the mounted routers; all mail endpoints present. |
| Screen registry | New screens (mailbox, email setup, signatures, deliverability) registered with `module_key` and actions. |

---

## 2. The line-count question — was "PR2–5 < 7,500 lines" a red flag?

**Yes. And the in-house QC audit independently reached the same conclusion from the other
direction.** Your numbers (PR-0 +9,571, PR-1A +5,110, PR-1B +6,800; PR2–5 combined under 7,500)
describe the *original PR diffs on GitHub*. The current tree does not match the sum of those five
diffs — it is far larger:

| Programme footprint (current tree) | Lines |
|---|---|
| Backend `src/modules/mail/` (all chapters) | 16,424 |
| Mail job handlers | 330 |
| Programme migrations (10723–10778) | ~2,593 |
| Mail test files (unit + integration + security) | 12,153 |
| Client mail surface (inbox, setup, signature/deliverability settings, mail API libs) | 11,395 |

By file group, the **chapters 2–5 backend alone is 7,572 lines** (signature 1,486 + binding 1,924 +
assist 1,935 + triage/public 2,227) — already at or above the entire PR2–5 diff you cited — before
counting their ~30 migrations, their client surface (work rail, four setup tabs, settings screens)
and their ~7k lines of tests.

**What that arithmetic proves:** the commit that shipped "PR-2 through PR-5" (980bd6d8, PR #238)
was under-built — it contained the schema and the pure leaf functions, and very little else — and
most of the substance (wiring, the AI engine, the dossier tabs, the workflow endpoints, the whole
PR-3→5 frontend) landed **after the merge, in repair commits** (721ca0bf, ec816f5e, 585c0e73 and the
fourth sweep). `doc/SMART_MAIL_PR2_PR5_QC_AUDIT.md` §1–§3 documents this from the inside: eleven
orphan tables, an AI layer that "returned a prompt string instead of a draft", PR-5 as "pure
helpers, no wiring", frontend "0%".

**Auditor's read of this, honestly:** the line count was a correct red flag, and the organisation's
response to it (the QC audit, the field notes, the four orphan-sweep gates) was the right
response — better than most. But it has two consequences you should know:

1. **The PR chapters are not a reliable record of what was delivered.** Scoring "per PR" on the
   original diff would score *the stubs*, not the product. The per-PR scores in §3 below score the
   **current tree's implementation of each chapter**, because that is what a QA engineer will test.
2. **The repair process was good but incomplete.** Each sweep fixed what its own question found
   ("what table does nothing read?", "what flag does nothing gate?"). The question it never asked
   was *"which route reads a thread without the visibility predicate?"* — which is exactly where
   the four Critical findings below live. The gates guard tables, flags, workers, send points and
   the four triage writes. They do not guard the other ~30 thread-scoped routes.

---

## 3. Per-PR assessment

### 3.1 PR-0 — Foundation · **92/100**

**Delivered and verified.** Migrations 10723–10730; `kind`/`visibility`/`entity_id`/ARCHIVED + the
one-live-personal-mailbox unique index; seven-slot shared catalogue; VIEWER/AGENT/MANAGER grants
with `revoked_at`-as-a-row; send-point registry with per-entity overrides; origin tagging
(`X-Praxis-*` + own Message-ID); per-mailbox throttles with hourly counter table; 8 event types;
the `mail` settings section + all flags.

**Quality notes (all positive unless marked).**
- `access.js` predicates are separate from service files to avoid require cycles — the right call,
  and the file documents it.
- Offboarding (`offboardUser`) archives the personal mailbox and revokes all shared grants,
  driven from `app_user.updated` via orchestration so a mailbox failure cannot block a security
  action *(re-verified: handler registered in `src/orchestration/handlers/index.js`)*.

**Findings.**
- **P0-1 (Medium, historical/fixed).** At merge, `mail_send_point` declared 9 rows
  `is_wired = true` naming exact files — **none of them passed a send point** (QC §14.1, the
  "largest single finding" of the third sweep). Eight are now genuinely wired at their call sites.
  *Residual:* the ninth, `auth.otp`, describes a sender that does not exist (2FA is TOTP); 10777
  flips it to `is_wired=false`. Awaiting decision D5. A registry row that promises a capability the
  product does not have is a trap for the next routing decision.
- **P0-2 (Low).** `sweepSendWindows` now runs inside the daily deliverability check — throttle
  counter rows are bounded. Verified.

### 3.2 PR-1A — Mail Core (model) · **89/100**

**Delivered and verified.** 10731–10736: `email_thread`/`email_message`/`email_message_state`
with backfill; per-folder UIDVALIDITY cursors (`email_folder.sync_cursor`); GIN `tsvector` search
with the `'simple'` dictionary and accent-folding on **both** document and query sides; seeded
stream rules + known-party override (case-folded, functionally indexed in 10736); the
`email_inbound_legacy` rename (no compat view — a documented, argued deviation that is the right
call). The FN-1 citext[] incident produced `scripts/check-citext-arrays.js`, a build gate that
discovers `(table, column)` pairs from the migrations — the best defence in the programme.

**Quality notes.**
- `upsertThread` is defensively written on every field (COALESCE/OR/LEAST/GREATEST, participants
  unioned with case-folding) — this is the file a future engineer should copy.
- Every `citext[]` read is cast `::text[]`; the header comment explains why, and the gate enforces it.
- `listThreads` unread/star are per-user via state rows; the "no state row = unread" rule is correct.
- Index set matches the §3.6 budgets: `ix_email_thread_list` (covering), `ix_email_message_thread`,
  `ix_email_message_state_unread`, `ix_email_message_tsv` (GIN), and the 10736 functional
  `lower(email)` indexes that keep the ingest hot path on an index scan.

**Findings.**
- **C-3 (Critical).** The legacy flat surface is still mounted (`/inbox`, `/thread`,
  `/thread/:id`, `/thread/:id/attachments`, …) and is still rendered: `mail.tsx` keeps a
  "Threads"/Message-log mode that calls `GET /mail/inbox`. `listInbox` (mail.repo.js:54) queries
  `email_message` with `direction='IN'` and **no user scope, no mailbox scope, no thread
  visibility**, and computes `is_read` as `EXISTS(state WHERE is_read)` with **no user_id** —
  the mailbox-wide read flag the rework deleted, resurrected on the legacy surface. Any MOD-72
  view user sees the entire tenant's inbound mail in the UI.
- **P1A-1 (Medium).** `GET /mail/thread/:id` (legacy detail) is scoped to accessible
  connections but **not** to thread visibility — inside a shared mailbox, the legacy detail view
  can open a thread the new surface would 404. Same class as C-4.
- **P1A-2 (Low).** `listFolders` takes a `connection_id` with no accessible-connection check —
  folder names and message counts for any tenant mailbox are enumerable by any MOD-72 view user.

### 3.3 PR-1B — Master Composer · **84/100**

**Delivered and verified.** 10737–10739: two-way attachments with the one-owner CHECK;
`email_draft` + `email_send_queue`; the TipTap composer (lazy-loaded — bundle rule verified in
§1); the server-authoritative serializer; slash commands; drafts; undo-send; offline queue.

**Quality notes — this chapter's best asset is `compose.js`, and it is genuinely excellent:**
pure, escaped-by-construction, table/inline-styled 600 px email HTML, plain-text part derived from
the same tree (not by stripping HTML), `erpBlock` carrying **nodes not an HTML string** (the
injection hole the guide warned about is closed at the design level), quoted-history the only
third-party fragment and it is re-sanitised on the way out with a narrower allow-list, 102 KB
Gmail-clip warning, web-safe fonts only, `safeHref`/`safeSrc` rejecting `javascript:`/`data:`.
The send queue is race-correct end to end: `claimDue` is one `UPDATE … FOR UPDATE SKIP LOCKED`
statement; undo is `UPDATE … WHERE status='HELD'` + rowcount; a permanent refusal (422/413,
sender-rejected class) is never retried; stalled `SENDING` rows are requeued after a 10-minute
window and only while attempts remain. The offline queue mints the `Idempotency-Key` **once at
compose** and the server's partial unique index collapses replays — the correct mechanism.

**Findings.**
- **H-2 (High, functional gap).** Inbound attachments cannot be opened. The reading pane renders
  an "Attachment" pill and nothing else (`thread-view.tsx:102`); there is no attachment strip, and
  **`GET /mail/attachments/:id/download` from §5.4 does not exist anywhere in the module** (no
  route, no handler, no client call). A mail client that cannot open the bill of lading that just
  arrived fails the core use case; acceptance criterion 8 is only half met (storage + hash yes,
  retrieval no).
- **H-1 (High, functional gap).** Nothing can be deleted. The bulk op enum is
  `read/unread/star/unstar/move/label/unlabel` — the guide's `delete` op is absent, and a repo-wide
  grep finds **no message-deletion path anywhere in the mail module** (no hard delete, no
  empty-trash). §9.6's "deletion of an archived message is blocked in the service layer" is
  vacuous because deletion itself does not exist. Consequences: Trash accumulates forever, the
  provider's Trash is never emptied, and there is no purge for GDPR-style requests from inside the
  product.
- **P1B-1 (Medium).** i18n: `client/src/features/comms/inbox/**` and `comms/setup/**` contain
  **zero `tr()` calls** and the i18n dictionary has no `mail.*` keys — the entire new mail UI is
  English-only. DoD #5 ("EN and FR strings at parity; no hard-coded user-visible English") is not
  met for the programme's largest new surface. (The signature settings screen has partial EN/FR
  entries — the conversion was started and not finished.)
- **P1B-2 (Low).** The serializer shell hard-codes `<html lang="en">` for French messages.
- **P1B-3 (Low).** `retryPlan`'s permanent-code list still names `RECIPIENT_REJECTED` and
  `AUTH_FAILED`, which nothing emits (flagged in FN-1 as "dead names in a list that reads as
  authoritative"; still present in `outbox.service.js`).

### 3.4 PR-2 — Identity, Signatures & Deliverability · **88/100**

**Delivered and verified.** 10764–10768 (see H-6 for the numbering). `signature.resolve.js` (pure,
null-safe `join`, system-vs-person split — a SYSTEM render never carries a person's mobile, as
§6.4 requires), `signature.html.js` (same email-safe rules as the serializer), `signature.png.js`
(screenshots the **same HTML**; 650×325 at 1×/2×/3× matching the standalone tool; renderer
injected so tests never launch Chromium), `source_hash` cache with both invalidation handlers
registered (`employee-updated-invalidate-signature`, `entity-updated-invalidate-signatures`),
`resolveLanguage` as the single five-step helper, `email.service.send({signature})` with the
machine-mail vs named-user split wrapped so a missing signature cannot fail an OTP, and the
deliverability module (MX/SPF/DKIM from `dns-check.js` + PTR + DMARC parse with plain-language
reading + public RBL list as a setting) with a daily scheduler and a PASS→FAIL regression alert
that notifies and survives a dead notifier *(call-site test `mail-deliverability-wiring.test.js`
re-verified)*.

**Findings.**
- **H-6 (Medium, process).** The reserved range table (§3.8) was violated and the repair left a
  trace: the signature engine's file header still reads "10740 Signature engine (PR-2)" in
  `migrations/tenant/10764_signature_engine.sql`. PR-2's range was consumed by unrelated modules
  (attendance/reconciliation/costing) before the mail PR-2 migrations landed; the engine landed in
  **PR-5's reserved range (10764)**, and PR-3's `mail_binding_suggestion` / `mail_thread_note_mention`
  landed as 10769/10770 — *after* all of PR-5's migrations. The guide anticipated exactly this
  ("Reserving a range does not reserve it on main … rebase or merge main before the final push
  and re-check") — the rebase/re-check did not happen, and the header comment now points a
  future reader at a number that belongs to another team's migration.
- **P2-1 (Medium, performance).** `signature.png.defaultShot` launches a **fresh headless Chrome
  per render** (browser → page → screenshot → close). PNG download is user-initiated so this is
  acceptable today, but under concurrent use (the batch tab is gone; a manager regenerating
  signatures for a team is not) each render pays a multi-second launch and the machines run
  unbounded Chrome processes. A pooled/reused browser would be the robust form.
- **P2-2 (Low).** §6.6's four-screen split (admin/template-editor/profile/preview) shipped as one
  `settings/email-signatures.tsx`. Cosmetic; documented as such. PNG download at 1×/2×/3× is
  present *(verified in `signature-profile` flow and `downloadSignaturePng` in the API lib)*.

### 3.5 PR-3 — ERP Binding, Smart Dossier & Collaboration · **74/100**

**Delivered and verified.** `binding.extract.js` implements the full signal table — ISO 6346
check-digit validated (the letter-value cascade and `sum % 11 % 10` are standard-correct; I traced
it against the spec), quoted-history scanned last at 0.6× confidence, THREAD_HISTORY inheritance
at 0.99, SENDER_DOMAIN deliberately 0.55. `suggestOnIngest` is called from ingest and writes
suggestion rows **without** setting `entity_ref` *(call-site test `mail-binding-suggest-only`
re-verified)*; `auto_accept_threshold` exists and is off by default. Accept/reject/bind/unbind/
accept-batch all audit. Notes: separate table, separate render path, `compose.js` has no path to
`email_thread_note` *(containment test re-verified)*; mention fan-out is three channels (in-app +
chat DM card + push) with `notifyMembers:false` on the chat post so one event stays one
notification per channel *(mention-fanout test re-verified)*. Dossier: `mail-context.service.js`
never calls `party-360`; client overview is **3 statements** under the 6-statement budget
*(budget test re-verified, warm case asserts zero queries)*; 60 s Redis cache keyed by entity
**and caller**, invalidated by the four named events; unbuilt supplier combinations answer
`not_built: true` rather than a fake empty list. Cards: seven files, one per card, directory-read
registry. Conversion previews through the shared dedup service and writes the 10748 back-link
columns. Intake classifies on ingest and files **only** through an explicit actor-carrying call
with MOD-64 `create` — the "never file silently" rule holds.

**Findings.**
- **C-4 (Critical class — this chapter's contribution).** Every thread-scoped route in
  `binding.routes.js` runs with no §9.5 check at route or service level:
  `GET /threads/:id/notes` (internal notes — the most sensitive content in the product — readable
  by any MOD-72 view user for any thread id), `POST /threads/:id/notes` (and its mention fan-out —
  any user can ping any user with a note on any thread), `GET /threads/:id/cards` +
  `:card/readiness` (thread subject, participants, bound client name, payment terms, dossier
  incoterm/delivery place — `cards/_facts.js` has no predicate), `GET /threads/:id/suggestions`
  (matched reference text, entity refs), `POST /threads/:id/suggestions/:sid/accept|reject`,
  `POST|DELETE /threads/:id/bind` (**binds a Private thread to an entity — a CRM-timeline write —
  by any MOD-72 edit user**), `POST /threads/:id/convert`, `POST /threads/:id/converted`,
  `GET /threads/:id/intake`, and `POST /suggestions/accept-batch` (up to 200 thread ids at once).
  `mail-visibility-wiring.test.js` asserts the predicate on `thread.repo` builders and a handful
  of named call sites — it does not enumerate routes, so this whole file passed every gate.
- **P3-1 (Medium, RBAC design).** The dossier drawer shows client **financials** (outstanding,
  overdue, credit limit, headroom) to any MOD-72 view user — the AI grounding layer re-checks
  per-source module RBAC, the drawer does not re-check anything. A user with mail rights but no
  finance rights reads the client's balance from the mail pane. The guide never specified
  per-source RBAC for the drawer (§7.5's budget is a performance contract), so this is a design
  gap to decide, not a code bug — but it should be decided, because "MOD-72 view ⇒ client
  financials" is a standing leak surface.
- **P3-2 (Low).** `GET /intake/chase/:clientId` is client-scoped, not thread-scoped: the missing-
  document list for any client id is readable by any MOD-72 view user (same class as P3-1).

### 3.6 PR-4 — The AI Layer · **78/100**

**Delivered and verified.** The facade is genuinely gone. `assist.service.js` runs the five-step
pipeline in order on every generating path: two-level gate through `ai/governance` (the
`ai.assistant.backend` ceiling is now enforced in the **projection** via `depends_on`, and the
service's floor check is the tenant's own `mail.ai`); grounding executes `assist.grounding.collect`
with per-source RBAC against the **caller** and reports *withheld* sources rather than dropping
them; generation goes through the single `generate()` choke point calling `llm.service.chat`; the
fact-fence runs on the **real generated text** (and a fenced draft still arrives, marked — the
right product call); metering records to `ai_usage_ledger` with `feature_key='mail_ai'` and a
sub-type **in a `finally`, on success and failure** — one call site, so the meter cannot decay by
omission. Summaries (5-message trigger, stale-by-count cache, POST so a cache miss that bills is
not a retriable GET), translate/rewrite/voice (transcript in, not audio — reusing the product's
own transcription), semantic search with a per-thread §9.5 re-filter over the vector candidates,
and OCR staging that **never writes a business record**, gated by its own `mail.ocr` flag on the
route *and* in the service *and* at enqueue, with the first-sync/financial-looking/narrowings that
keep it from becoming a bill. `mail-ai-draft`/`mail-ai-routes`/`mail-ai-nowrite`/`mail-ai-budget`
wiring tests exist and pass.

**Findings.**
- **C-4 (Critical class — this chapter's contribution).** The thread reads take no visibility:
  `threadContext` (thread subject, `entity_ref`, client/dossier/supplier join) and `threadMessages`
  (the last 6–40 message **bodies**) query `email_thread`/`email_message` by id with no predicate.
  Any MOD-72 view user who knows (or guesses from a notification/deep-link) a thread id can
  `POST /mail/assist/draft` and receive a generated reply **built from a Private thread's
  transcript plus the ERP facts of its bound entity**; `summary` additionally **writes** the
  transcript-derived cache row to `email_thread_summary`, which is then readable by the same
  unscoped `SELECT` on any later call. `POST /assist/ocr/:attachmentId` is worse in kind: it
  resolves an arbitrary attachment id, reads the vault bytes and **sends them to the external
  vision vendor** (a supplier invoice with bank details leaves the building), with no check that
  the attachment belongs to a thread the caller may see. `GET /assist/ocr/pending` lists
  tenant-wide. The route's own header comment ("every route passes the actor in … a service called
  with no user withholds every source") addresses grounding RBAC — the visibility question was
  never asked of these routes.
- **H-4 (High, RBAC inconsistency).** The AI action catalogue (`mail.ai.js`) declares
  `send_mail`/`reply_mail` with `permission: { module: "MOD-64", action: "create" }` while the
  HTTP send path requires **MOD-72** create (§3.4: "Mail is MOD-72 … They are separate rights and
  must stay separate"). The orchestrator enforces exactly the declared permission, so the two send
  paths check **different modules**: a chat-permitted user who is not a mail user can send mail
  through the copilot (confirmed), and a mail user without chat create cannot.
- **P4-1 (Low).** `assertAiOn`'s floor check queries `feature_state` directly — correct for the
  tenant flag, but it duplicates the shape the platform projection now also enforces for
  `mail.ai` (depends_on). Two sources of truth for the floor; harmless while both fail closed.

### 3.7 PR-5 — Workflow, Security & Compliance · **71/100**

**Delivered and verified.** This is the chapter whose promises are hardest to keep, and most of
them hold: `sla-clock.js` does real IANA-zone business-hours arithmetic (two-pass `zonedToUtc`
that survives DST; the dead VIP ternary is gone; no calendar ⇒ no due date rather than a fake one);
both sweeps (`mail-sla-sweep`, `mail-followup-sweep`) are registered **and enqueued on a repeat**
*(wiring test re-verified)*; the SLA sweep derives `first_responded_at` from the messages (so a
phone-sent reply stops the clock), fires breaches once per thread, and notifies MANAGERS + the
assignee with a per-user dedupe key; soft locks never steal a live one and an expired lock is
taken silently; follow-ups are claimed atomically (`WITH claimed … FOR UPDATE SKIP LOCKED`) and a
failed notification does not re-open the row; secure links serve real bytes with the token
SHA-256-hashed (32-byte CSPRNG), view recorded **before** fetch, expired/revoked/never-existed all
answering the identical 404, rate-limited, noindex; break-glass is `requireCeo()`, writes the
`immutable_ledger` row **before** reading, and returns the thread through the single
`getThreadUnrestricted` reader; the archive appends every ingested and sent message under
`FOR UPDATE` on the tail row (the chain cannot fork on concurrent sends), covers **attachment
hashes** in the seal (verified in `10760` + `ingest-hooks`), and `/archive/verify` reports
**coverage** as well as integrity — an empty chain over 40,000 messages is `INCOMPLETE`, not a
pass; anti-spoof runs on every inbound (memoised corpus, ADMIN_VERIFIED only, OBSERVED accrues and
confers nothing), the lookalike detector is real (Levenshtein ≤ 2 on a homoglyph-folded domain,
TLD swap, hyphen drop, affix), and the bank-detail-change escalation — the "highest-value line of
code in the programme" — fires; DSNs are parsed to `email_bounce`, correlated by Message-ID, and
mark the contact with the "soft never downgrades hard" rule; scheduled send resolves both §9.3
shapes with IANA math, refuses to invent a third, throws `NO_RECIPIENT_TIMEZONE` rather than
guessing, and caps at 90 days for the right reason.

**Findings.**
- **C-1 (Critical).** `workflow.shareThread` inserts into `email_thread_share` with **no check
  that the caller can see the thread** — and the §9.5 predicate treats a share row as a read
  grant. Sequence: any MOD-72 edit user → `POST /mail/threads/<id>/share {user_id: <self>}` →
  `GET /mail/threads/<id>` now succeeds for a **PRIVATE** thread. The visibility model's only
  per-thread granularity is writable by anyone who can edit mail. `unshareThread` has no
  ownership check either (any editor can revoke someone else's share — and quietly remove the
  trace of their own share), and `listShares` is ungated (discloses who was let in). Break-glass
  exists for exactly this access and is CEO-gated and ledgered; `shareThread` is its unledgered
  twin.
- **C-4 (Critical class — this chapter's contribution).** `POST /threads/:id/snooze` and
  `/followup` INSERT with no thread check (the FK guarantees existence, nothing guarantees
  visibility; they also become existence oracles); `POST|DELETE /threads/:id/lock` is ungated
  (discloses who is working a thread); `GET /threads/:id/shares` (see C-1). The four writes the
  FN-2 pass fixed (claim/assign/status/visibility-PATCH) carry the `getThread` gate plus the
  predicate inside the UPDATE — the pattern is there; it was applied to four of eleven
  thread-scoped writes in this file.
- **H-5 (High, dead path with a lying error).** `fetchTarget` for `target_kind='GENERATED_PDF'`
  returns a stub with **no buffer** — the public download then answers 404 "This link has
  expired or been revoked" (a false statement; the link is fine, the renderer was never written),
  and the metadata call still records a view and increments `view_count`. The route validator
  accepts `GENERATED_PDF` minting, so an admin can hand a client a permanently broken link whose
  error message points at the wrong cause.
- **P5-1 (Medium, scale).** `sla.service.sweep` dates at most **500** undated open threads per
  tick, with **no `ORDER BY`** — under a sustained backlog > 500, which threads get dated is
  arbitrary and the oldest (most at-risk) threads can starve. Also, `resolution_due_at` is
  computed and stored but **no breach is ever detected or alerted for it** — only first-response
  breaches notify. A team can miss every resolution promise with all green.
- **P5-2 (Medium, scale).** Notification dedupe is a **process-local in-memory Map**
  (`shouldDedupe`, 60 s window). The "one event, at most one notification per user per channel"
  guarantee (addition f) holds within one API process; across replicas or after a restart it
  does not. The repo already runs Redis for exactly this kind of state — a `SET … NX EX 60`
  dedupe is the robust form.
- **P5-3 (Low).** `assign` takes an arbitrary `user_id` (validated as UUID, not existence —
  a bad id 500s on the FK) and the route does not distinguish "a lead assigns" from any editor,
  as §9.2's phrasing implies.
- **P5-4 (Low, honest-limitation).** `VERIFIED` requires an `Authentication-Results` header with
  `dmarc=pass|spf=pass` — a receiving server that doesn't write the header can never yield
  VERIFIED, so verified domains sit at UNVERIFIED with a "mark as belonging" prompt until the
  header appears. Conservative by design; document it for the operator.

### 3.8 Cross-cutting · **75/100**

**What is genuinely strong (re-verified, not read off the docs):**
- **The gate discipline is above the standard of any codebase I have audited at this scale.**
  Four orphan-sweep gates (tables / workers+events / send points / feature flags) each with a
  size-capped allowance list that fails if it grows; the citext[] gate derived from migrations;
  the call-site wiring tests that assert *the product uses the code* rather than testing leaves;
  `check:bundle` actually enforced and satisfied; the API docs generated from mounted routers;
  the silent-catch taxonomy ratchet; CodeQL ReDoS on the search box caught and fixed with a
  50,000-underscore regression test. The FN-1/FN-2 field notes are the right artefact and the
  lessons are applied.
- **Test volume and shape:** 5,447 backend + 1,708 client tests, all green in my run. The tests
  named by the guide exist (three under slightly different names: `mail-html-serializer` ⇒
  `mail-compose.test.js` (61 tests), `mail-send-queue` ⇒ `mail-outbox.test.js`,
  `mail-search-parse` ⇒ `tests/integration/mail-search.test.js`).
- **RBAC/flag coverage on the core surface:** every route in the conversation/composer sections of
  `mail.routes.js` carries `requireFeature` + `requirePermission`; the PR-0 setup surface is
  deliberately ungated with a documented reason (an admin locked out of turning the feature on).

**Findings.**
- **H-3 (High, DoD breach).** EN/FR parity (DoD #5) — see P1B-1. The largest new UI surface in the
  programme ships 100% English.
- **H-6 (Medium, process).** Migration range-table violation — see P2-1/§3.4.
- **X-1 (Low, documented deviation, pending decision).** Q5 decided "all on for Smart Logistics,
  **off for every other tenant**". The as-built model (9114 + plan gating) ships **12 of 15**
  `mail.*` flags **on** in the platform catalogue, with plan inclusion as the commercial gate and
  per-tenant overrides for the rest. This is a coherent re-interpretation and it is documented in
  the QC handover as open decision D2 — but the decision log (§1.1, Q5) and the as-built behaviour
  now disagree, and a pilot rollout that assumes "other tenants are dark" would be surprised:
  any tenant whose plan includes the flags is live on the mailbox. Decide and record.
- **X-2 (Low).** `auth.otp` phantom send point (P0-1) — decision D5.
- **X-3 (Info).** The programme's commits are not recoverable from this repository's history
  (squashed to a single merge commit), so the per-PR accounting in §2 rests on the GitHub PR
  diffs. If the programme is ever re-audited from the repo alone, the QC/field-notes documents are
  the only record of what each PR contained.

---

## 4. Consolidated finding register

| ID | Sev | Area | Finding | Fix shape |
|---|---|---|---|---|
| **C-1** | **Critical** | PR-5 | `shareThread`/`unshareThread`/`listShares` ungated ⇒ any MOD-72 edit user self-grants (and un-grants) read access to any PRIVATE thread | Gate on `getThread` caller-visibility + require the caller be the owner or a current sharee; ledger unshare |
| **C-2** | **Critical** | PR-1B/PR-3 | `/attachments/from-vault` bypasses vault document permissions (`documentVault.get` has no actor check) ⇒ any MOD-72 create user exfiltrates any vault document by email | Call the vault's permission predicate (or a service-level `assertDocumentAccess(client, id, actor)`) before staging |
| **C-3** | **Critical** | PR-1A legacy | `GET /mail/inbox` unscoped tenant-wide inbound + mailbox-wide `is_read`; rendered by the live Message-log tab | Scope by `accessible(user)` + visibility, or delete the legacy surface per the PR-1B plan ("deletes both once nothing calls them") |
| **C-4** | **Critical** | PR-3/4/5 | ~30 thread/message/attachment-scoped routes (binding ×13, triage ×7, assist ×8, legacy detail ×2) with no §9.5 predicate — notes, cards, suggestions, bind (a CRM write), OCR-to-vendor, AI draft-over-private-transcript, snooze/followup/lock/shares | Add the `getThread` gate at route (or a `requireVisibleThread` middleware); extend `mail-visibility-wiring` to enumerate **routes**, not just repo builders |
| **H-1** | High | PR-1B | No message deletion anywhere; no bulk `delete` op; Trash never emptyable; §9.6 delete-block vacuous | Implement delete (TRASH empty / per-thread delete) that respects the archive (per §9.6: block, ledger the attempt) or explicitly retire TRASH as "archive" and say so |
| **H-2** | High | PR-1B | Inbound attachments not viewable/downloadable; `GET /attachments/:id/download` (§5.4) absent | Auth-gated download through the vault (visibility-scoped), attachment strip in the reading pane |
| **H-3** | High | Cross | New mail UI has zero i18n conversion (DoD #5) | Convert `comms/inbox` + `comms/setup` through the existing `tr()` dictionary |
| **H-4** | High | PR-4 | AI `send_mail`/`reply_mail` gated MOD-64 create vs MOD-72 create on the HTTP path | Align the catalogue to MOD-72 (guide §3.4) or document the divergence |
| **H-5** | High | PR-5 | `GENERATED_PDF` secure links mintable but never serveable; false "expired/revoked" 404 | Implement the renderer or stop accepting the target kind (422 at mint) |
| **H-6** | Med | Cross | Migration range table violated; 10764 header says "10740"; PR-3 migrations landed after PR-5's | Renumber is impossible post-merge; fix the header, add the collision gate to run against `main` on every push |
| **P3-1** | Med | PR-3 | Dossier shows client financials on MOD-72 view alone (no per-source RBAC) | Decide: re-check the owning module's view right per source (as the AI layer does), or record the decision |
| **P1A-1/2** | Med | PR-1A | Legacy `/thread/:id` ignores thread visibility; `/folders` ignores mailbox access | Same fix family as C-3/C-4 |
| **P0-1** | Med | PR-0 | `auth.otp` phantom send point | Decide D5 (delete vs build) |
| **P5-1** | Med | PR-5 | SLA sweep `LIMIT 500` without `ORDER BY`; resolution breaches never alerted | Order by `first_message_at ASC`; add resolution-breach detection |
| **P5-2** | Med | PR-5 | Notification dedupe is process-local | Redis `SET NX EX 60` |
| **P2-1** | Med | PR-2 | Puppeteer browser launched per PNG render | Pool/reuse the browser across renders |
| **P1B-3, P4-1, P5-3..4, X-1..3, P1B-2, L-items** | Low | — | Dead retry codes; duplicate flag-floor sources; assign target not existence-checked; VERIFIED-header limitation; flag-default deviation (D2); squashed history; `lang="en"` shell; `getQueued` null-user `OR` | Housekeeping list for the next maintenance PR |

---

## 5. What would have to be true to call this 100%

1. C-1–C-4 fixed, with a route-enumeration wiring test (the gate that would have caught all four
   in one sweep) and manual confirmation that a non-owner with MOD-72 edit gets 404 on every
   thread-scoped route for a Private thread they were not shared.
2. H-1/H-2 implemented (or explicitly descoped with a user-visible statement — "Trash is
   Archive; deletion is a support operation" is a legitimate product answer, but it must be a
   decision, not an accident).
3. H-3 converted; H-4 aligned; H-5 resolved.
4. X-1/D2, P0-1/D5, P3-1 recorded as decisions.
5. The §6 QA checklist below executed end-to-end against a provisioned tenant with a live cPanel
   mailbox — the DB-backed claims (backfill parity, chain coverage, SLA dates, sync cursors) are
   only as good as the real-tenant run, and `doc/SMART_MAIL_PR2_PR5_QC_AUDIT.md` §16.4 is explicit
   that no database was available during the repair passes.

---

## 6. QA checklist — Smart Mail programme

> How to use: each box is a **testable statement**. "✔ verified" marks items I verified against
> the tree in this audit (code/structure/static evidence). Items marked ⚠ need a **live tenant +
> live cPanel mailbox** to close. Do not tick a box on the strength of a green unit test alone —
> that is the exact failure mode this programme has documented three times (FN-1, FN-2, QC §8).

### A. Pre-pilot security (the four Criticals — block pilot until all green)

- [ ] ⚠ As user A (MOD-72 edit, member of shared mailbox S): `POST /mail/threads/<private-id>/share {user_id: A}` → must **403/404**. Then `GET /mail/threads/<private-id>` → must still be 404. (C-1)
- [ ] ⚠ Share a Private thread to user B **as the owner**: B can open it; C cannot; the share row is audit-visible; unshare by B or C is refused; unshare by the owner works and is audited. (C-1)
- [ ] ⚠ As a MOD-72 create user with **no** MOD-64/vault rights: `POST /mail/attachments/from-vault` with a vault id of an HR document → must refuse (403/404), no attachment row written. (C-2)
- [ ] ⚠ `GET /mail/inbox` as a fresh MOD-72 view user with their own personal mailbox only → returns **only their mailbox's** inbound, and `is_read` reflects **their** state. (C-3)
- [ ] ⚠ Route sweep: for each of the ~30 routes in C-4, call it as a user who cannot see the thread → 404, indistinguishable from non-existent (no subject, no note, no card, no suggestion, no OCR, no draft). (C-4)
- [ ] ⚠ `POST /mail/assist/draft` on a Private thread the caller cannot open → 404; no row appears in `email_thread_summary`. (C-4)
- [ ] ⚠ `POST /mail/assist/ocr/<attachment-of-private-thread>` → 404 and **no vision-vendor call** (verify in the vendor ledger / `ai_usage_ledger` — no `ocr` row for the caller). (C-4)
- [ ] ⚠ `GET /mail/threads/:id/notes` on a thread in a shared mailbox marked PRIVATE by its owner → 404 for a member who was not shared. (C-4)
- [ ] ⚠ Break-glass still works and is the *only* non-owner path to a Private thread: CEO `POST /breakglass` with reason → ledger row written **before** the body is returned; non-CEO → 403. (control preserved)
- [ ] ⚠ Notes containment across **every** outbound path on a real send: note text must not appear in the sent message's `body_html`/`body_text` (send, reply, forward, scheduled flush, AI-inserted draft). (regression — test exists, confirm on live SMTP)
- [ ] ⚠ Guardrail hard block: financial-document attachment + recipient on an UNVERIFIED/SUSPICIOUS domain of a bound party → send refused until a ≥10-char reason is typed; the reason lands in `immutable_ledger`; the override is shown in the response. (control preserved)

### B. PR-0 — Foundation

- [ ] ✔ One-personal-mailbox rule: second personal mailbox for the same user is refused (DB unique index + service sentence).
- [ ] ✔ Shared mailbox: VIEWER can read, cannot send; AGENT can send as it; MANAGER appears in SLA breach notifications.
- [ ] ✔ Grant revocation writes `revoked_at` (row survives); a revoked member immediately loses read access (visibility clause checks `revoked_at IS NULL`).
- [ ] ✔ Handover converts personal→shared and re-grants; offboarding (suspend user) archives the personal mailbox and revokes all shared grants with `email_access_audit` rows.
- [ ] ✔ Send-point routing: entity binding beats tenant binding beats section beats purpose; an unbound tenant sends from exactly the address it sent from yesterday (tier 3/4 byte-parity).
- [ ] ⚠ Hourly send cap holds the send and reports `retry_at`; daily cap message says "resumes after midnight UTC".
- [ ] ✔ Origin stamping: messages sent from Praxis carry `X-Praxis-*` headers and our Message-ID; Sent-folder sync copies are classified OUT by the stamp, not assumed inbound.
- [ ] ⚠ `auth.otp` send point: confirm decision D5 outcome (row deleted, or an emailed-code path exists) — the registry must not describe a capability the product lacks.

### C. PR-1A — Mail Core

- [ ] ⚠ cPanel IMAP: connect → discovers all six canonical folders; each folder keeps its own UIDVALIDITY cursor; force a renumber on Spam (e.g. server-side purge) → only Spam re-scans.
- [ ] ⚠ Backfill parity on a populated tenant: every `email_inbound_legacy` row has exactly one `email_message` with the same id, direction mapped to folder (OUT→SENT), `participants` correct on multi-party threads, per-owner `email_message_state` seeded from old `is_read`.
- [ ] ✔ Threading: reply-to-reply lands in the same thread; two unrelated `Re: Invoice` from different senders do **not** merge.
- [ ] ⚠ Search: `from:maersk has:attachment folder:INBOX demurrage` returns the right threads; `client:<name>` filters by bound entity; a quoted phrase `subject:"bill of lading"` is one filter; accent-folding works both ways (`déclaration` finds `Déclaration`).
- [ ] ✔ Known-party override: mail from a `client_master` address classified SYSTEM by `Precedence: bulk` still lands HUMAN (`known_party` reason, case-insensitive match).
- [ ] ✔ Per-user read state: marking read in a shared mailbox changes only the caller's rows; the UI shows "Read by you · Unread for N others".
- [ ] ⚠ Bulk: 200 threads → archive reflected on the provider; mixed-batch failure reports per-id errors without aborting.
- [ ] ⚠ **C-3 fix**: legacy Message-log tab scoped to the caller (or removed); no tenant-wide list reachable.

### D. PR-1B — Composer & Send

- [ ] ✔ Serializer: editor JSON → table-based, inline-styled, ≤102 KB warning, no `<style>`/classes/web fonts; plain-text part from the tree; `javascript:`/`data:` hrefs dropped (text kept); images carry alt+width+`display:block`.
- [ ] ✔ Undo race: cancel wins if the row is still HELD; after flush, cancel returns 409 "already left"; the database decides, not the timer.
- [ ] ✔ Offline: compose offline → reconnect → replayed exactly once (idempotency key minted at compose; duplicate POSTs collapse).
- [ ] ✔ 25 MB rule on the **sum**: three files totalling 26 MB refused with the breakdown; 24 MB succeeds; each file vaulted with a content hash.
- [ ] ✔ Slash commands: `/invoice` etc. appear only to users holding the module's view; the manifest's module keys validate against `platform.module_catalogue` (build fails on a bad key); `/invoice INV-…` pins the data at insert time (editing the record later does not change the sent draft).
- [ ] ⚠ **H-2 fix**: every inbound attachment is downloadable from the reading pane; download is auth-gated and visibility-scoped; an attachment of an invisible thread → 404.
- [ ] ⚠ **H-1 fix**: deletion path exists (or is explicitly descoped): emptying Trash / deleting a thread works for the caller, is refused for archived messages per §9.6 with the attempt ledgered, and says so.
- [ ] ⚠ Drafts: close browser mid-compose → draft restored with attachments; subject-only autosave does not wipe recipients/body (the two FN-era data-loss bugs, regression-checked live).
- [ ] ⚠ Scheduled send: `send_at` in the past / >90 days → 422; recipient-morning without a party timezone → 422 `NO_RECIPIENT_TIMEZONE` (not a guess); a scheduled message reports `undo_seconds: 0` and is not in the undo toast.

### E. PR-2 — Signatures & Deliverability

- [ ] ✔ HTML/PNG parity: same template → identical text content in both renders; PNG 2× is 1300×650; PNG served at 1×/2×/3× from the profile screen.
- [ ] ⚠ Promotion: change `job_title` in HR → next email carries the new title with no manual step; an email sent before the change still shows the old title (history never rewritten).
- [ ] ✔ System mail: OTP/notification mail carries the department-labelled corporate block, no person, no mobile; a named user emailing an invoice carries their signature over the tenant's BILLING identity.
- [ ] ✔ Missing typed fields leave no dangling separators (blank-safe join); a user with no profile still gets a correct signature.
- [ ] ⚠ FR recipient (`preferred_language='fr'`) receives the French motto and French legal notice; the five-step `resolveLanguage` order is exercised (explicit > party > replied-to > UI > tenant).
- [ ] ⚠ Deliverability: remove the tenant's DKIM record → row turns red at the next daily check and MOD-70 holders are notified (`deliverability.regressed` emitted even if the notifier is down — row survives).
- [ ] ⚠ RBL list is a setting: adding a host changes behaviour without a deploy.

### F. PR-3 — Binding, Dossier & Collaboration

- [ ] ✔ Suggest-only: inbound quoting `SLAS-2026-0042` produces a 0.97 suggestion and **never** sets `entity_ref` while `auto_accept_threshold` is null; accepting binds, supersedes rivals, audits, and puts the thread on the client timeline.
- [ ] ✔ ISO 6346: a container token with a bad check digit produces no suggestion; a valid one resolving to a dossier does (0.90).
- [ ] ✔ Domain-only matches are 0.55 and render visibly weaker; a quoted-history reference is downgraded.
- [ ] ✔ Dossier budget: Overview ≤ 6 statements cold, 0 warm (cache); the four invalidation events (`invoice.posted`, `payment.received`, `milestone.completed`, `document.captured`) bust it; tabs lazy-load one query each.
- [ ] ⚠ **P3-1 decision recorded**: per-source RBAC on the drawer (or an explicit acceptance that MOD-72 view ⇒ client financials).
- [ ] ✔ Cards: an unready card shows the same enabled button plus exactly which fields are missing and why; no card writes; deep-link prefills the owning module.
- [ ] ✔ Notes & mentions: mention fans out to in-app + chat DM card + push, **once each**; mentioning an employee with no user account is refused with a reason; the note never appears in any outbound body.
- [ ] ✔ Intake: a classified BL shows "File it?" with the machine's guess correctable; nothing is filed without the explicit actor-carrying call (MOD-64 create); filing sets doc type + client and the document appears in Client 360 → Documents.
- [ ] ⚠ Conversion: a repeat enquirer is offered "attach to the existing lead" first (dedup on email + name norm + phone); saving creates the record through the target module's own validator and both records link back.
- [ ] ⚠ **C-4 fix**: every binding route 404s on an invisible thread (see A).

### G. PR-4 — AI Layer

- [ ] ✔ Gate: `mail.ai` on + `ai.assistant.backend` off ⇒ every AI surface absent (403 with the specific reason), not present-and-erroring; the projection's `depends_on` enforces the floor independently.
- [ ] ⚠ Grounding: draft on a bound thread uses only whitelisted reads, per-source RBAC'd against the **caller**; withheld sources are named in the response; costing/margin, payroll, supplier pricing are unreachable (deny-list test + a live attempt as a finance-restricted user).
- [ ] ⚠ Fact fence: a stubbed/real LLM output containing a date, reference or amount absent from the facts is marked `needs_review` with the offending token named; the draft still arrives (not blanked).
- [ ] ✔ Glossary: translate EN→FR preserves `FOB`, `40HC`, `SLAS-2026-0042`, `compte 411` byte-for-byte (restored programmatically if the model dropped them; the restored terms are named in the response).
- [ ] ✔ Summaries: 4-message thread → none ("summaries start at 5"); 5+ → cached; 5 more messages → regenerated; the summary is POST (a retry/proxy cannot double-bill a cache miss).
- [ ] ✔ OCR: extraction writes one `attachment_extraction` row and **no business record**; review/dismiss are actor-carrying; `mail.ocr` off ⇒ no vendor call even from a queued job; nothing runs during first sync.
- [ ] ✔ No-AI-write: no assist path calls a create/update service (asserted by test — re-run it).
- [ ] ✔ Metering: every generating call lands in `ai_usage_ledger` with `feature_key='mail_ai'` + sub-type, on success **and** failure; the hard budget cap disables surfaces with an explicit message.
- [ ] ⚠ **H-4 fix**: AI `send_mail`/`reply_mail` permission matches the HTTP path (MOD-72 create), confirmed in `ai_action_catalogue` and by a live confirm-card as a chat-only user.
- [ ] ⚠ **C-4 fix**: draft/summary/OCR refuse invisible threads/attachments (see A).

### H. PR-5 — Workflow, Security & Compliance

- [ ] ⚠ SLA: thread arriving Friday 16:30 (server in UTC, office `Africa/Douala` Mon–Fri 08–17) with 4-business-hour first response → due **Monday 11:30** (the guide's "10:30" assumes an 18:00 close — the test pins the seeded calendar's arithmetic); PENDING pauses the clock, a client reply resumes it, RESOLVED stops it.
- [ ] ⚠ Breach: first-response breach fires exactly one notification per target (MANAGERS + assignee) with a dedupe key; a dead notifier does not suppress the ledger/event.
- [ ] ⚠ **P5-1**: backlog > 500 undated threads → oldest dated first (ORDER BY present); a resolution-due breach is detected (alert added or explicitly descoped).
- [ ] ⚠ Soft lock: two agents on the same shared thread — second sees "Marie started replying" with the option to continue; an expired lock is taken silently; releasing a colleague's lock is refused.
- [ ] ⚠ Boomerang: 3-day no-reply returns the thread; a client reply on day 2 cancels it **and** pauses a multi-step sequence; snoozes are per-user (a colleague cannot cancel yours).
- [ ] ⚠ Secure link: token shown once, only its SHA-256 stored; view recorded **before** bytes; expired/revoked/never-existed → identical 404; view lands on the client's CRM timeline; **H-5**: `GENERATED_PDF` mints either work end-to-end or are refused at mint.
- [ ] ✔ Visibility: Private thread invisible to a colleague with MOD-72 view — in the list, in search, in the client timeline, in the dossier, and to the AI (the last three re-verified in code; the first two are the wiring test's territory — extend it per C-4).
- [ ] ⚠ Archive: `GET /mail/archive/verify` on a populated tenant reports `SOUND` only when coverage is 100% of messages **and** the chain verifies; edit an archived body in the DB → the first break is reported; concurrent sends do not fork the chain (tail lock).
- [ ] ⚠ Anti-spoof: `smartlogistics-cm.com` claiming to be `smartlogistics.cm` (passing SPF, owned by the attacker) → `LIKELY_IMPERSONATION` despite the passing header; a "new bank details" message from a non-verified domain escalates to `SUSPICIOUS` and notifies Finance; an `OBSERVED` domain never confers `VERIFIED`; one-click "mark domain as belonging" writes `ADMIN_VERIFIED`.
- [ ] ⚠ Bounce: a hard DSN marks the contact `HARD_FAILED` and the composer warns before the next send; a soft bounce never downgrades a hard-failed address; DSNs route to the System stream but stay visible on the original thread.
- [ ] ⚠ **C-1/C-4 fix**: share/snooze/followup/lock/shares all 404 on invisible threads (see A).

### I. Cross-cutting & rollout

- [ ] ⚠ **Live-tenant proof** (QC §16.4 says none of the repair work ever saw a database): `db:reset:local` → provision `smartls` → re-apply the tenant set → ledger reports 0 → `feature-report.js --slug=smartls` shows the 15 `mail.*` rows with the intended states.
- [ ] ✔ All 15 `mail.*` flags gate something real (feature-gating gate green) and fail closed when the row is missing.
- [ ] ⚠ **X-1/D2 decision recorded**: which tenants see the mailbox by default (catalogue defaults vs plan), and the pilot list. The decision log (Q5) and the as-built behaviour must be reconciled on paper.
- [ ] ⚠ **H-3**: EN/FR parity on the mail UI — with the FR toggle, every string in inbox/setup/work-rail/composer is French (or the gap is explicitly descoped per release).
- [ ] ✔ Telemetry: no tracking pixel, no link rewriting anywhere in `src/modules/mail/` (gate walks the whole module); secure-link views are the only open signal.
- [ ] ✔ No AI auto-send: the AI catalogue's writes are `confirm: true`; no sequence/scheduled path sends without a human (follow-up sweeps fire notifications only — asserted by test).
- [ ] ⚠ Rollback: flags off restores the previous UI immediately; `email_inbound_legacy` is retained (one-release rule) — confirm the retention calendar.
- [ ] ⚠ Performance budgets on the real tenant (50k-message mailbox): thread list p95 ≤ 250 ms, thread detail ≤ 200 ms, search ≤ 400 ms, context cold ≤ 300 ms / warm ≤ 50 ms, send-queue insert ≤ 150 ms; a first 90-day-depth sync completes without starving other connections (per-folder isolation: one folder's failure records `last_error` and siblings continue).
- [ ] ⚠ First-sync cost check: no OCR vendor calls during backfill; the anti-spoof corpus is read once per run (memoised), not per message.
- [ ] ⚠ Notification volume: one logical event ⇒ at most one notification per user per channel (mention, SLA breach, follow-up, send failure each exercised) — and across **two API replicas** once the dedupe is Redis-backed (P5-2).
- [ ] ⚠ Observability: a FAILED queued send reaches the sender's notification bell with the classified SMTP guidance (not a raw 550); a stalled SENDING row requeues after 10 minutes and not a fourth time.

---

## 7. Closing note

This programme is in better shape than its line counts suggested and worse than its internal
reports suggested — both at once. The line counts were a correct red flag: four chapters shipped
as mostly unwired parts, and the organisation's QC process found it, fixed it, and built gates
against the *class* of failure — a response that would be exemplary in most organisations. But
the gates encode the questions the team had already thought of (tables read, flags checked,
workers enqueued, send points wired, four specific writes gated). The questions they had **not**
yet thought of — "which route reads a thread without the predicate?", "which cross-module call
skips the other module's permissions?", "what can a user do with a thread id they shouldn't
have?" — are exactly where the four Critical findings sit, and all four are the same shape:
**an authorisation that was enforced on the primary path and not enumerated on the secondary
ones.**

The craft of the code that exists is high — the serializer, the SLA arithmetic, the archive
serialization, the send-queue state machine, the fact-fence design, the call-site wiring tests.
None of the findings above is architectural rework; each is a bounded fix. That is the fair
summary of 76/100: the building is sound, the wiring is 95% right, and four doors open that
should be locked. Lock them, execute checklist section A, and this programme can pilot.

— *Principal Engineer / Auditor, independent audit, 2026-08-22*
---

# Addendum A — post-audit verification · 2026-08-22 (same day)

**Why this exists.** §4's finding register is a snapshot, and a register nobody
re-checks becomes a list of things everyone assumes are being handled. This
addendum re-reads the tree after the audit was filed and records three things:
what has actually been **closed**, what is **still open with today's evidence
line**, and one fix shape **the audit itself got wrong**.

Everything below was re-verified against the working tree, not carried over
from §4.

---

## A.1 Closed since the audit

### H-6 (new instance) — the `tenant/11743` migration-number collision · **CLOSED**

§3.4 raised H-6 as a *process* finding about the reserved range table, with the
10764 header as its visible residue. Re-running the gate found the same class
had recurred, and this one was live: `scripts/db/check-migration-numbers.js`
was **failing the build**, and CI runs it as a required step in `build-test`.

Two files had landed as `11743` from two parallel streams:

| File | Stream |
|---|---|
| `11743_email_thread_participants_repair.sql` | Smart Mail (§5.9 participants repair) |
| `11743_seed_rail_transportation.sql` | Rail service types |

The migrator keys its ledger on **filename** and sorts alphabetically, so the
two applied in whatever order their descriptive suffixes happened to sort. That
is the exact failure the gate's own header warns about: harmless while the pair
touch different objects, a silent ordering bug the day they do not.

**The mail file is the half that moved** — renamed to
`11745_email_thread_participants_repair.sql`. The rail seed had to keep its
number: `11744_backfill_rail_milestones_and_fields.sql` opens with *"11743 added
the three rail service_type rows"* and backfills them, so moving the seed above
its own backfill would have broken a real dependency to satisfy a numbering
rule. The mail repair, by contrast, is a self-contained data fix over
`email_thread` that depends only on 10731 having run; nothing orders against it.
Its position relative to the rail seed is also unchanged — it already sorted
first under the tie-break, and now sorts after both, which no statement cares
about.

**Why the rename is safe here, and why that is not a general licence.** The
standing rule — restated in §3.2 of this audit and in the gate's own header — is
*never renumber an applied migration*, because the ledger keys on filename and a
rename makes the migrator apply the file again. That is acceptable in this one
case because the statement is idempotent by construction: after one run no
`participants` element contains a comma, so the `WHERE` matches nothing and the
re-run updates zero rows. The file said so before it moved; it now says so
above the rename note as well. The stale `11743_…` ledger row is left behind
pointing at a filename that no longer exists, and `migrator.contentDrift` skips
rows whose file is absent, so no tenant reports drift and no fleet status is
affected.

Verified after the move: `check-migration-numbers` (no new collisions),
`check-migration-reversibility` (218 checked, all declared),
`check-destructive-migrations`, `check-migration-idempotency` — all green.

---

## A.2 Correction to the audit — H-6's residual header must **not** be fixed

§3.4 and §4 both give H-6's fix shape as *"fix the header"*:
`migrations/tenant/10764_signature_engine.sql:2` still reads
`TENANT DB — 10740 Signature engine (PR-2)`.

**That fix would cause a worse problem than the one it solves, and this audit
argued so itself sixty lines earlier.** §3.2's own reasoning for why the
participants defect got a *repair migration* instead of an edit to 10731 applies
here without modification: the migrator records a `sha256` per applied file and
`contentDrift` compares it on every fleet-status run. Editing an applied
migration — **including changing only a comment** — does not re-run it, and does
raise content drift on every tenant that has already applied it. A one-character
comment fix would light up the whole fleet as drifted, over a header.

**Revised fix shape:** leave `10764_signature_engine.sql` byte-identical. The
correction belongs where a reader will actually look for it — the §3.8 range
table and this addendum. Recorded here:

> `migrations/tenant/10764_signature_engine.sql` is the **PR-2 signature
> engine**. Its header's "10740" is the number the file was written against
> before PR-2's reserved range was consumed by attendance/reconciliation/costing
> on `main`. The number in the filename is authoritative; the number in the
> header is historical and cannot be corrected without raising fleet-wide
> content drift.

The other half of H-6's fix shape — *"add the collision gate to run against
`main` on every push"* — stands, and is the part that would have caught the
11743 pair before merge rather than after.

---

## A.3 Re-verified still open — no Critical has been closed

Each line below is today's evidence, re-read rather than carried forward. The
register in §4 is accurate as filed.

| ID | Status | Evidence in the tree today |
|---|---|---|
| **C-1** | **OPEN** | `mail/triage/workflow.service.js:239` — `shareThread` is `INSERT INTO email_thread_share … RETURNING *` with a `userId` presence check and nothing else. No caller-visibility gate, no ownership check. `unshareThread` (`:256`) and `listShares` (`:270`) likewise. |
| **C-2** | **OPEN** | `mail/mail.routes.js:242` — `POST /attachments/from-vault` still mounted behind `requirePermission(M,"create")` only. |
| **C-3** | **OPEN** | `mail/mail.routes.js:90` — `router.get("/inbox", core, requirePermission(M,"view"), c.inbox)`. The legacy flat surface is still mounted. |
| **C-4** | **OPEN** | `mail/binding/binding.routes.js:52,54` — `GET`/`POST /threads/:id/notes` carry `requireFeature("mail.notes")` + `requirePermission` and no thread predicate. Representative of the ~30. |
| **H-1** | **OPEN** | `mail/mail.validator.js:172` — `op: z.enum(["read","unread","star","unstar","move","label","unlabel"])`. No `delete`, and no deletion path elsewhere in the module. |
| **H-2** | **OPEN** | No `/attachments/:id/download` exists in `src/modules/mail/`. The only download route in the module is the public secure-link one at `public_secure/public_secure.routes.js:99`, which is token-scoped and unrelated. |
| **H-3** | **OPEN** | `client/src/features/comms/inbox/*.tsx` — `tr(` occurrences: `folder-rail` 0, `index` 0, `thread-list` 0, `thread-view` 0. |
| **H-4** | **OPEN** | `mail/mail.ai.js:24` — `permission: { module: "MOD-64", action: "create" }` on `send_mail`, against MOD-72 on the HTTP path. |
| **H-5** | **OPEN** | `mail/triage/secure-link.service.js:172-175` — the `GENERATED_PDF` branch returns `{ kind, target_ref, label }` with no `buffer`; `triage.routes.js:112` still accepts the kind at mint. |
| **H-6** | **PARTIAL** | Collision instance closed (A.1). Residual header stands by design (A.2). |

**Nothing in §6 checklist section A has been executed** — those items need a
live tenant, and the four Criticals remain the pilot blockers §0 says they are.

---

## A.4 One finding from outside this programme, in exactly this programme's shape

Recorded here rather than in a mail document because §7's closing thesis
predicted it, and because the fix touched a mail migration (A.1).

A tenant's **sandbox schema was rebuilt overnight and a night's work was lost**,
with nothing in the platform console able to say what had done it. Three
defects compounded:

1. `migrations/platform/0101` added `last_sandbox_wipe_at` as a bare nullable
   column with no backfill, and the auto-wipe scheduler reads NULL as *"never
   wiped → wipe now"*.
2. `provisioning.stampSandboxWipe` queried a `pg.Client` it had never
   connected. pg 8 does not throw on that — the query is queued and the promise
   **never settles** — so the stamp never happened, the worker stalled and
   retried, and the column stayed NULL. The 14-day interval was therefore never
   once applied: the sandbox was rebuilt **nightly**.
3. `DROP SCHEMA sandbox CASCADE` was the **only destructive platform action
   with no `platform_audit` row**, while changing the wipe *interval* was
   audited.

That third item is §7's sentence about mail, transposed one layer down: *an
enforcement applied on the primary path and never enumerated on the secondary
ones.* The gates guard what the team had already thought to ask about; nobody
had asked "which destructive action writes no audit row?"

Fixed alongside this audit: wipes are manual by default
(`SANDBOX_WIPE_CRON` empty), `0` is finally a storable value for
`sandbox_wipe_days` (the scheduler always honoured it; a `CHECK (> 0)` made the
documented opt-out unexpressible), every rebuild writes one `sandbox.wiped`
audit row carrying source/actor/`previous_wipe_at`, and the stamp connects.

**The CI gap worth naming.** `.github/workflows/ci.yaml`'s `migrations` job
stands up Postgres and provisions a real tenant — and never calls
`wipeSandbox`. The incident happened in a path CI has a live database for and
does not execute. One step after *"Apply the tenant migration set again"* would
have caught the hang on the day it merged.

— *Addendum A, same independent pass, 2026-08-22*

---

# Addendum B — remediation · 2026-08-22

Addendum A recorded that nothing in §4's register had been closed. This records
the pass that closed it, what shape each fix took, and — the part worth reading
— the three places where the finding's own suggested fix turned out to be the
wrong one.

**Status: every Critical and every High in §4 is closed.** What follows is per
finding, with the reasoning that is not obvious from the diff.

---

## B.1 The four Criticals

### C-1 — PRIVATE-visibility bypass · **CLOSED**

Two guards, because the finding contained two holes and one guard would have
left the second.

`requireVisibleThread()` on `share` / `unshare` / `shares` closes the one the
audit described: a caller who cannot see a thread now 404s before any statement
runs, so the `POST {user_id: <self>}` self-grant is unreachable.

That alone is not enough. Of the people who *can* see a thread, not all should
decide who else does — otherwise the first colleague an owner shares with can
re-share onward, and any member of a shared mailbox can hand out a PRIVATE
thread they could see only because they are in the mailbox. So
`workflow.assertMaySteward` additionally requires the caller be the thread's
**owner or a current sharee**. It is deliberately permissive for COMPANY and
TEAM threads: a share row discloses nothing about a thread everyone can already
read, so stewardship bites only where it means something.

`unshareThread` is now `isSensitive` and no longer swallows its ledger write.
That is the subtler half of C-1: removing a share also removes the *trace* of
one, so an operator who granted themselves access and then unshared left the
table exactly as they found it. The ledger row is what makes that recoverable,
and a failure to write it is now reported rather than dropped.

### C-2 — vault exfiltration · **CLOSED**

The fix is structural, because the defect was.

SEC-M3 implemented the vault's record-level rule as `requireDocumentPermission`
— an **express middleware** in `document_vault.routes.js`, keyed on
`req.params.id`. That made it correct for the vault's own two routes and
*unreachable from anywhere else*: a caller in another module could only reach
`service.get`, a bare id lookup. Mail called exactly that.

The rule now lives in `document_vault.service.assertDocumentAccess`, and the
middleware is a thin wrapper over it — one rule, two callers, the same shape as
`mail/triage/visibility.js`. It takes two clients (document row and RBAC grants
live in different schemas) rather than guessing one from the other, which is how
a sandbox caller would otherwise end up checked against no grants at all.

**The detail worth keeping:** the comment above the vulnerable call already
claimed that "`getByRef`/`get` apply the module's own confidentiality rules". The
author checked that the rule should apply and believed it did. A comment
asserting a security property is not evidence of one, and this is the second
finding in this programme where the prose was ahead of the code.

### C-3 — unscoped tenant-wide inbox · **CLOSED**

`mail.repo.listInbox` now carries `accessible` + the §9.5 clause and computes
`is_read` from the caller's own state row. The endpoint's response shape is
unchanged, so the legacy Message-log tab keeps working.

`userId` is **required, not defaulted** — a call without one returns an empty
list. A default of "no user" on this particular query is precisely what the
finding was, so the omission now surfaces as an empty screen rather than as a
tenant-wide disclosure.

The old header called the shared `is_read` "honest for a legacy endpoint". That
was a fair description of the read-state semantics and not of the missing scope,
and the second thing sheltered behind the first.

### C-4 — the ungated class · **CLOSED**

New `src/modules/mail/mail/visible.js`: five middlewares (thread by path, thread
by body, message, attachment, batch). Applied across binding, triage, assist and
the legacy and conversation surfaces in `mail.routes.js` — **40 scoped routes,
39 gated, 1 exemption**.

Decisions inside it:

- **Every refusal is 404, never 403.** A 403 confirms a private thread exists,
  which for a conversation whose existence is the sensitive part is most of the
  disclosure. It also stops `snooze` and `followup` being existence oracles,
  which they were purely through their FK failing differently for a real id.
- **`accept-batch` narrows rather than refuses.** Refusing a 200-id batch
  because one id is invisible tells the caller which of 200 guesses was real.
  The list is filtered to the visible subset and the dropped count is reported —
  a stated narrowing, not a silent cap.
- **Gate read *and* in-statement predicate on writes.** The gate answers "may
  this caller see it" before work starts; the predicate inside the UPDATE closes
  the window where visibility changed between the two. The four triage writes
  already did this; the pattern was generalised, not replaced.
- **The conversation routes are gated even though their services were already
  correct.** `thread.service` reads through `repo.getThread`, so `GET
  /threads/:id` and friends were never open the way binding's were. They carry
  the gate anyway, because an invariant with "except the ones whose service
  happens to be right" in it is not one a future author can apply without
  reading every service first. The cost is one indexed head read.
- **OCR's list and extraction review/dismiss got service-level predicates**, not
  middleware — a middleware cannot narrow a list it does not build.

---

## B.2 The Highs

| ID | Fix |
|---|---|
| **H-1** | `delete` bulk op + `DELETE /threads/:id` + `POST /folders/empty` (TRASH/SPAM only, enumerated in both the validator and the service). Sealed messages are never deleted and the **blocked attempt is ledgered** — a retention control's most interesting event is the refusal, not the successes. Migration **11746** fixes `email_bounce.original_message_id`, which was NO ACTION only by omission (its 10738 siblings both cascade) and would have turned a legitimate delete into a 23503. IMAP gained a real `serverDelete` capability + `deleteMessage`, so deleted mail does not resurrect on the next sync; adapters answering `false` are skipped cleanly. |
| **H-2** | `GET /mail/attachments/:attachmentId/download`, visibility-scoped through the same gate, streaming from the vault. `Content-Disposition: attachment` + `nosniff`, deliberately: an inbound attachment is by definition a file a stranger chose, and rendering an untrusted `text/html` in the app's own origin is how a mail client becomes an XSS vector. Client side: an `AttachmentStrip` in the reading pane, fetched lazily per expanded message — a forty-message thread must not fire forty requests to draw a pane where thirty-nine are collapsed. |
| **H-3** | 31 files under `comms/inbox` and `comms/setup` converted, **545 key pairs** added to both sides of `i18n-dict.ts`. Uses the repo's `tr()` / `i18n-dict` path rather than the partial `mail.*` react-i18next scheme, matching the three already-converted siblings in the same folder. Parity is compiler-enforced (`export const fr: Dict`), and the file typechecks clean, so all 2,022 keys match on both sides. |
| **H-4** | `send_mail` / `reply_mail` moved MOD-64 → **MOD-72** create. The reads in that catalogue were already MOD-72; only the writes had drifted, which is why the two send paths checked different modules. |
| **H-5** | `GENERATED_PDF` refused at **mint**, not at download. The renderer still does not exist; refusing where the operator is standing lets a 422 say something true, instead of handing a client a permanently broken link whose 404 says "expired or revoked" about a link that is neither. Restore the enum value the day a renderer exists. |

---

## B.3 Three fixes the findings got wrong

Recorded because in each case the audit's stated fix shape would have caused a
second problem, and because two of them are the same mistake.

1. **H-6's "fix the header" (see A.2).** Editing an applied migration's bytes —
   even a comment — raises content drift on every tenant that applied it.
2. **C-2's "call the vault's permission predicate".** There was no predicate to
   call; it was middleware. The fix had to *create* the callable rule first,
   which is a larger change than the finding implies and the reason this defect
   existed at all.
3. **H-1's "block deletion of archived messages per §9.6".** §9.6's block could
   not be made real by adding a check, because the FK already refused —
   silently, as a 23503 surfacing to the user as a 500. The block had to become
   a *named refusal with a ledgered attempt*, and a second FK
   (`email_bounce`) had to be relaxed before any legitimate delete could
   succeed at all.

---

## B.4 The gate

`tests/security/mail-route-visibility.test.js` walks the mounted routers and
fails any thread-, message- or attachment-scoped route that carries no gate.
Two allow-list entries, each with its reason, size-capped at 2.

Two properties it has that `mail-visibility-wiring.test.js` did not:

- **It takes no list of call sites.** A wiring test that names its call sites
  can only assert about the ones somebody remembered to name; all ~30 ungated
  routes were simply absent from that list, and absence from a list is not a
  failure. This one enumerates what express actually mounted.
- **It recognises gates by a stamped property, not by function name.**
  `asyncHandler` returns an anonymous arrow, so the inner function's name never
  reaches the express layer — a name-matching gate would have matched nothing
  and reported success. That is the same failure shape the file exists to
  prevent, and it was nearly built into the fix.

**A near-miss worth recording.** The first version of its scope regex matched
`/attachments/:attachmentId` and therefore missed `POST /assist/ocr/:attachmentId`
— the one route that sends bytes to an external vendor, and so the single most
important route in the sweep. It was gated; the gate simply could not see it. A
checker whose scope pattern is narrower than the surface it claims to cover
reports success over the routes it never looked at.

---

## B.5 What was verified, and what was not

**Verified on the tree:** 32/32 route-gating and finding-specific assertions
(a standalone harness mirroring the jest gate, since jest's startup on the dev
mount exceeds the shell timeout); `eslint` clean on all 21 backend files
touched, 0 errors; `tsc --noEmit` clean over `comms/**`, `mail-api.ts` and
`i18n-dict.ts` (the only remaining errors are `@tiptap/*` module resolution,
an artefact of Windows-installed `node_modules` read from Linux, present before
this work); migration numbering, reversibility, destructive-statement and
idempotency gates all green; silent-catch back to **0 new** (three pre-existing
unmarked catches in `imapSmtp.provider.js` surfaced when the file was edited and
were given real taxonomy markers rather than a regenerated baseline).

**NOT verified, and it matters:** the full `npx jest` suite has not run against
these changes. Nor has the client `vitest` suite, `check-response-contract`,
`check-schema-drift`, `check-api-contract`, or the `migrations` CI job. The
existing `mail-visibility-wiring.test.js` and the mail integration suites
exercise paths this pass changed, and **several will need updating** — every
service signature that gained a caller argument (`listInbox`, `listShares`,
`listPending`) is a place an existing test may still call the old shape.

§6 checklist section A remains unexecuted: it needs a live tenant and a live
cPanel mailbox, and no amount of static verification substitutes for it. The
code is ready for that run; it has not had it.

— *Addendum B, 2026-08-22*
