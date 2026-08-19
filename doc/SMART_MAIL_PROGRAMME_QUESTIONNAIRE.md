# Praxis LS — "Smart Mail" Programme: Feasibility Read & 35-Question Decision Sheet

**Purpose.** You proposed ~40 capabilities across five themes (deep ERP integration, autonomous AI,
next-gen compose, triage/productivity, security/compliance), plus the standalone
**Smart LS Signature Generator** HTML tool. This document does three things:

1. Reports what the codebase **already has** that these ideas can stand on, and what is genuinely net-new.
2. Restructures your ideas into **5 large PRs** with a dependency order that actually builds.
3. Asks **35 decision questions** — each with three concrete options and my recommendation — whose
   answers are the missing inputs for the final engineering guide.

**How to use it.** Answer inline (tick an option or write your own). Where you are happy with my
recommendation, just write "Rec". Once returned, I produce `doc/SMART_MAIL_ENGINEERING_GUIDE.md`:
a build-ready spec (migrations, module trees, endpoints, component trees, acceptance criteria,
test plan) split across the 5 PRs, executable by any competent engineer or AI agent.

---

## 0. Codebase reality check

I walked the mail stack, the AI stack, the master-data/360 stack, the vault, the workers and the
frontend. This is what is actually there (not what the README aspires to).

### 0.1 The stack you are really building on

| Layer           | Reality in this repo                                                                                                                                                                                                 | Note                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend         | Node 20, **Express**, CommonJS, plain `pg` (no ORM)                                                                                                                                                                  | README says NestJS/TypeScript — the code is Express/JS. The guide will follow the code.                                                                               |
| Module shape    | `src/modules/<group>/<module>/` with `repo / service / controller / routes / validator / events` (+ optional `<module>.ai.js`)                                                                                       | Auto-mounted by `src/shared/http/module-loader.js`. Adding a module needs no central wiring.                                                                          |
| DB              | PostgreSQL 16, **one database per tenant** + a platform DB                                                                                                                                                           | Email tables carry **no tenant column**. ~200 numbered SQL files in `migrations/tenant/`.                                                                             |
| Queue / workers | BullMQ + ioredis, `src/jobs/workers.js`, handlers in `src/jobs/handlers/`                                                                                                                                            | `mail-sync`, `mail-sync-scheduler`, `mail-webhook-renew`, `email-send` already exist.                                                                                 |
| Realtime        | socket.io + Redis adapter; `src/realtime/mail-bus.js` bridges worker→web                                                                                                                                             | `mail:new` already pushes to room `t:<slug>:mail`.                                                                                                                    |
| Frontend        | React 18 + Vite + TS + Tailwind + Radix + react-router + react-hook-form/zod, PWA                                                                                                                                    | **No rich-text editor library is installed.**                                                                                                                         |
| AI              | `src/services/ai/`: orchestrator (~79 KB), `llm.service` (DeepSeek primary → Gemini fallback, OpenAI-compatible), pgvector retrieval, `vision.service` (Gemini), `transcription.service` (Groq/Whisper), `redact.js` | Propose→confirm gate (`ai_action_run`), catalogue from `*.ai.js`, spend in `ai_usage_ledger`, EMV flags `ai.assistant` / `ai.assistant.backend` / `ai.vectorization`. |
| Security        | `requirePermission(MOD-xx, action)`, `immutable_ledger`, encrypted `integration_secret` setting section (AES-256-GCM)                                                                                                | Mail = **MOD-72**, team chat = **MOD-64**.                                                                                                                            |

### 0.2 Mail today

- **Two distinct email configurations** (`doc/EMAIL_TWO_CONFIGS.md`), and they must stay distinct:
  - **System email** — `email_identity` (purposes `BILLING / DOCUMENTS / NOTIFICATIONS / SUPPORT`)
    - `email_send_log`, sent by `src/services/email.service.js`, with a Praxis-owned fallback sender.
  - **User mailbox** — `email_connection` (`imap_smtp` | `microsoft_graph` | `google_gmail`),
    handled by `src/modules/mail/`, inbound + outbound.
- `email_inbound` stores **both** directions (`direction IN/OUT`), with `thread_key`, `entity_ref`,
  `external_message_id`, and a dedup unique index. `email_attachment` → `document_vault`.
- Inbound sync: BullMQ poll (default 60 s) + optional IMAP IDLE + Graph webhook + Gmail Pub/Sub.
- Auto-linking **already exists**: a dossier reference in the subject wins, else sender email →
  `client_master.email`, written to `entity_ref` (`mail.service.autoLink`).
- HTML is sanitised on ingest (`sanitize-html`). Send failures are classified into user-facing
  guidance (`smtp-error.map.js`, `SmtpErrorGuide`).
- UI: `client/src/features/comms/mail.tsx` — Threads / Mailboxes / Send-log tabs, reachable at
  `/comms/mail`.

### 0.3 Honest gaps (this is the work)

| Gap                                                                                                                              | Evidence                            |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **No attachments on outbound.** `mail.service.send` takes `{to, cc, subject, html, text}` only.                                  | `src/modules/mail/mail.service.js`  |
| **Composer is a plain `<textarea>`.** No formatting, no fonts, no emoji, no images, no BCC.                                      | `ComposeModal` in `mail.tsx`        |
| **No folders.** IMAP sync polls INBOX only (documented gap **G-5**). No Spam, Sent, Drafts, Archive, Trash as browsable folders. | `doc/MAIL_AUDIT_2026-08-06.md`      |
| **No search** over mail, no bulk actions, no pagination beyond `before` cursor, no labels/flags/star.                            | `mail.repo.js`                      |
| **No thread grouping in the UI** — the list is flat messages, though `thread_key` exists.                                        | `mail.tsx`                          |
| **No signature concept anywhere** in schema, service or UI.                                                                      | grep: zero hits for email signature |
| **No telemetry** (opens/clicks), no scheduling, no snooze/boomerang, no SLA, no assignment.                                      | —                                   |
| **No internal notes / @mentions** on any thread; `smartcomm` has no mention primitive either.                                    | `0430_smartcomm.sql`                |
| **No mail-side AI at all** beyond a 5-action `mail.ai.js` catalogue stub (list/read/send/reply).                                 | `src/modules/mail/mail.ai.js`       |

### 0.4 Assets you already own that make this cheaper than it looks

| Idea                     | Existing asset to reuse                                                                                                                    | Saving |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Smart Dossier right pane | `src/modules/master/party-360.service.js` — KPIs, aging buckets, open invoices, contacts, documents, compliance, all zero-safe             | Large  |
| Dynamic signatures       | `src/modules/master/entity-letterhead.service.js` — the exact "derive blocks from stored facts, never retype" pattern, with FR/EN handling | Large  |
| Domain health inspector  | `src/modules/mail/dns-check.js` — MX/SPF/DKIM lookups with per-record verdicts and relay-specific fix hints                                | Large  |
| Secure ephemeral links   | `proposal.share()` — hashed token, expiry, revoke, `viewed_at`/`downloaded_at`, public route                                               | Medium |
| Attachment OCR → ledger  | `vision.service` (Gemini) + the bank-statement OCR precedent, incl. `ocr_used/ocr_provider/ocr_model` provenance stamping                  | Large  |
| Voice-to-email           | `transcription.service` (Groq/Whisper) + `ai-transcribe` worker already wired                                                              | Medium |
| Action cards in email    | `ai_action_run` propose→confirm + `action-registrar` + Zod gate + RBAC                                                                     | Large  |
| Auto-routing / boomerang | `src/orchestration/` dispatcher + handlers, `workflow` + `approval_task`                                                                   | Medium |
| Escalation & mentions    | `notification.service` (in-app + web-push + email) + `smartcomm` channels                                                                  | Medium |
| Doc filing from email    | `document_vault` + `dictionary_ref` kind `DOCUMENT_TYPE` (BL, MAWB, INVOICE, POD, CUSTOMS, APEC…) + compliance module                      | Large  |

### 0.5 Feasibility verdict per theme

Scale: **Green** = straightforward on current foundations · **Amber** = real work, no unknowns ·
**Red** = needs a decision or carries product/legal risk before it can be scoped.

| #   | Capability                                         | Verdict   | The honest constraint                                                                                                                                       |
| --- | -------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dynamic smart signatures from ERP data             | **Green** | Only question is HTML vs image and who may edit.                                                                                                            |
| 2   | Rich text editor ("the richest possible")          | **Green** | Pick a library; email HTML compatibility is the real craft, not the editor.                                                                                 |
| 3   | Attachments in/out + internal document picker      | **Green** | Vault, size cap and dedup already solved.                                                                                                                   |
| 4   | Slash commands (`/invoice-table`, `/bank-details`) | **Green** | Needs a permissioned command registry; the snippet/document sources exist.                                                                                  |
| 5   | Full mail management (folders, spam, search, bulk) | **Amber** | Multi-folder IMAP sync + a search index; the deferred G-5.                                                                                                  |
| 6   | Split inbox (human vs system stream)               | **Green** | Deterministic header rules get ~95 % of it.                                                                                                                 |
| 7   | Auto-entity binding & smart dossier pane           | **Green** | Binding exists; 360 exists; needs a mail-scoped aggregator and a drawer.                                                                                    |
| 8   | In-email ERP action cards                          | **Amber** | Must route through existing services + approval ladder, never a shortcut.                                                                                   |
| 9   | Internal side-notes & @mentions → chat             | **Green** | New table + mention primitive + notification fan-out.                                                                                                       |
| 10  | One-click entity converter (Lead/Ticket/Task/PR)   | **Green** | Targets exist (`lead`, `q_ticket`, `approval_task`, `purchase_request`).                                                                                    |
| 11  | Inbound doc → doc-type filing + missing-doc chase  | **Amber** | Needs a per-client/service-type required-document checklist.                                                                                                |
| 12  | Tone rewrite / formalise / translate               | **Green** | Pure LLM call through the existing gate.                                                                                                                    |
| 13  | Executive thread summaries                         | **Green** | Cache per thread head; invalidate on new message.                                                                                                           |
| 14  | Zero-prompt, ERP-grounded drafting                 | **Amber** | Accuracy depends on tool whitelisting + citation; hallucinated shipment facts are a client-facing risk.                                                     |
| 15  | Inline autocomplete "in your natural voice"        | **Amber** | Latency and cost per keystroke; a per-user style profile needs data.                                                                                        |
| 16  | Attachment OCR → post to ledger/inventory          | **Amber** | Extraction is easy; **matching** to POs/invoices and posting is the hard, auditable part.                                                                   |
| 17  | Sentiment & churn radar                            | **Amber** | Cheap to compute, easy to get wrong; needs a defined escalation route and an appeal path.                                                                   |
| 18  | Pre-send guardrails                                | **Green** | Missing-attachment and domain-mismatch checks are deterministic.                                                                                            |
| 19  | Voice-to-professional-text                         | **Green** | Groq/Whisper already wired; add composer capture.                                                                                                           |
| 20  | Follow-up boomerang / sequences                    | **Green** | BullMQ delayed jobs + a rules table.                                                                                                                        |
| 21  | Shared inbox + assignment + SLA timers             | **Amber** | Concurrency (two agents replying at once) needs a claim/lock model.                                                                                         |
| 22  | Client-timezone delivery scheduling                | **Amber** | No timezone on `client_master` today; "peak open-rate hours" needs telemetry first.                                                                         |
| 23  | Read & click telemetry                             | **Red**   | Technically easy (pixel + link rewrite). It is the **legal/consent** stance that must be decided — and blocked images make open rates systematically wrong. |
| 24  | Domain health & deliverability inspector           | **Green** | `dns-check.js` covers most; IP reputation needs a third-party feed.                                                                                         |
| 25  | Immutable regulatory archive                       | **Amber** | `immutable_ledger` gives the hash chain; true WORM needs object-lock storage.                                                                               |
| 26  | Role-based mail visibility                         | **Amber** | A visibility model on threads plus a break-glass audited path.                                                                                              |
| 27  | ERP-validated anti-spoofing                        | **Green** | Compare From-domain to verified party domains + read `Authentication-Results`.                                                                              |
| 28  | Auto-routing by intent                             | **Amber** | Internal assignment is safe; **auto-forwarding outside** is a data-leak risk.                                                                               |
| 29  | VIP routing lane                                   | **Green** | A flag on the party + a sort rule.                                                                                                                          |
| 30  | Secure ephemeral links + PIN                       | **Green** | The proposal share-token pattern generalises cleanly.                                                                                                       |

**Nothing here is infeasible.** Three things need a decision before they can be scoped honestly:
**telemetry consent (23)**, **auto-forwarding scope (28)**, and **how far OCR automation goes into
the ledger (16)**. Those are Q32, Q31 and Q28 below.

---

## 1. The proposed 5-PR split

Each PR is independently shippable and leaves the product working if the next never lands.

| PR       | Name                                           | Delivers                                                                                                                                                                                                                                                 | Depends on                             |
| -------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **PR-1** | **Mail Core & the Master Composer**            | Thread/message model rework, multi-folder sync (Inbox/Sent/Drafts/Spam/Archive/Trash), search, bulk actions, thread grouping, split inbox + VIP lane, the rich editor, attachments both ways, internal document picker, slash commands, drafts/undo-send | —                                      |
| **PR-2** | **Identity, Signatures & Deliverability**      | Signature engine (ERP-derived, template-governed, promotion-aware), signature admin + batch, system-email branding policy, domain health inspector, anti-spoofing verdicts                                                                               | PR-1 (composer must render signatures) |
| **PR-3** | **ERP Binding, Smart Dossier & Collaboration** | Confidence-scored auto-binding, right-pane dossier drawer, in-email action cards, internal side-notes + @mentions into chat, inbound document filing + missing-document chase, one-click entity conversion                                               | PR-1                                   |
| **PR-4** | **The AI Layer**                               | Compose copilot (tones, rewrite, translate), inline autocomplete, zero-prompt ERP-grounded drafting, thread summaries, sentiment/churn radar, attachment OCR ingestion, voice-to-email, pre-send guardrails                                              | PR-1, PR-3 (grounding needs bindings)  |
| **PR-5** | **Workflow, Telemetry, Security & Compliance** | Shared inbox + assignment + SLA, boomerang/follow-up sequences, scheduled + timezone delivery, read/click telemetry into the CRM timeline, secure ephemeral links + PIN, immutable archive, role-based visibility, auto-routing by intent                | PR-1, PR-3                             |

> **Sizing reality.** These are five _large_ PRs, not five afternoons. Expect roughly
> PR-1 ≈ 3–4 weeks, PR-2 ≈ 1.5–2 weeks, PR-3 ≈ 3 weeks, PR-4 ≈ 3–4 weeks, PR-5 ≈ 3–4 weeks for one
> full-stack engineer per PR, on top of a codebase where CI runs ~1,400 tests and every module is
> expected to carry migrations, validators, RBAC, AI manifest and tests. Q1 asks how you want to
> handle that.

---

## 2. The 35 questions

Each question gives three options and a recommendation. Write your choice on the
**Decision** line; add a note if you want a variant.

---

### Section A — Programme & architecture (Q1–Q5)

---

#### Q1 · How should the five PRs be sequenced and staffed?

_Why it matters:_ PR-1 is a hard dependency for everything else. Trying to parallelise it produces
merge wars in `mail.service.js` and `mail.tsx`, which are the two hottest files in the plan.

- **A) Strictly serial.** One PR at a time, merged and deployed before the next starts. Slowest calendar, lowest risk, each PR is demoable.
- **B) PR-1 alone first, then PR-2/PR-3 in parallel, then PR-4/PR-5 in parallel.** Two engineers after the foundation lands. Roughly 40 % faster than serial.
- **C) All five in parallel behind feature flags** on a shared long-lived integration branch, merged to `main` at the end.

> **Recommendation: B.** PR-1 rewrites the message model and the composer — the two things every
> other PR touches. Once it is merged, PR-2 (signatures) and PR-3 (binding/dossier) barely overlap
> in files, and PR-4/PR-5 sit on top of PR-3's bindings. Option C guarantees a painful merge on
> `mail.service.js`; option A is safe but slow if you have more than one engineer.

**Decision:** **********\*\***********\_\_**********\*\***********

---

#### Q2 · How far do we rework the message data model?

_Why it matters:_ Today one table, `email_inbound`, holds both inbound and outbound messages, with
no thread entity, no folder, no labels, no per-user state. Every feature you asked for — threading,
folders, assignment, snooze, telemetry, visibility — wants somewhere to live.

- **A) Extend `email_inbound` in place.** Add `folder`, `is_starred`, `snooze_until`, etc. as columns. Cheapest; keeps a table named "inbound" holding outbound mail forever.
- **B) Introduce `email_thread` + `email_message` + `email_message_state` (per-user read/star/snooze) + `email_label`, backfill from `email_inbound`, keep a compatibility view.** Clean model, one migration, one cut-over.
- **C) Same tables as B but dual-write for a release** before switching reads.

> **Recommendation: B.** The naming debt is already causing confusion in the code comments, and
> shared inboxes (Q6) make per-user state mandatory — you cannot express "read by Marie, unread by
> Paul" on a single boolean. A backfill plus a `email_inbound` view keeps `mail.ai.js`, the client
> timeline and the 360 pages working while the new surfaces are built. Option C's dual-write is
> over-engineering for a single-tenant-per-DB system where the table is small and downtime for a
> migration is a few seconds.

**Decision:** **********\*\***********\_\_**********\*\***********

---

#### Q3 · Which mail folders do we sync and expose?

_Why it matters:_ You asked "Do we get a spam folder too? Do we get to see our inbox and outbox?"
Today only INBOX is polled (documented gap G-5). Each provider models folders differently — IMAP
has folders, Gmail has labels, Graph has mailFolders.

- **A) INBOX only + locally recorded Sent** (today's behaviour). Nothing new to build; Spam, Drafts and Archive remain invisible.
- **B) A fixed canonical set — Inbox, Sent, Drafts, Spam/Junk, Archive, Trash** — mapped per provider, plus user-created folders shown read-only.
- **C) Full folder-tree mirror,** including nested user folders, with move/create/delete pushed back to the server.

> **Recommendation: B.** It answers the actual need ("full email management") without committing to
> a bidirectional folder-tree sync, which is where IMAP implementations traditionally rot. Moving a
> message between the six canonical folders pushes to the server; managing arbitrary folder trees
> stays in the user's native client. Option C can follow later without a data-model change if the
> folder is stored as a canonical enum plus a raw provider path.

**Decision:** **********\*\***********\_\_**********\*\***********

---

#### Q4 · Which provider is the priority, and how do we handle capability gaps?

_Why it matters:_ Graph and Gmail give server-side threads and delta sync; IMAP does not. Gmail has
labels not folders. Only Graph and Gmail can reliably report a message's own folder. If we build to
the richest provider, IMAP tenants get a broken product, and vice versa.

- **A) IMAP/SMTP first.** Most portable, works with any cPanel or Zoho mailbox typical of a Cameroonian SME. Richer providers get no special treatment.
- **B) Capability-flag everything.** Each adapter already declares `{push, delta, serverThreads, appendSent}`; extend that set (`folders`, `labels`, `serverSearch`, `flags`) and have the UI degrade per mailbox, with IMAP as the guaranteed floor.
- **C) Microsoft 365 first,** treating Graph as the reference implementation and IMAP as legacy.

> **Recommendation: B, with IMAP as the tested floor.** The capability pattern is already in the
> codebase and is the only thing that stops the UI from lying to a user whose mailbox cannot do
> what a button offers. Concretely: every feature ships with a defined IMAP behaviour, and richer
> providers get the faster path. Please still tell me **which provider Smart Logistics itself
> uses** — that decides what we test against first.

**Decision:** **********\*\***********\_\_**********\*\***********
**Smart Logistics' own mail provider:** ****\*\*****\_\_****\*\*****

---

#### Q5 · How is all this gated and rolled out?

_Why it matters:_ This is a multi-tenant white-label product with a Platform Console, `feature_state`
projection and entitlement metering already in place. Thirty new capabilities cannot arrive as one
switch.

- **A) One flag, `mail.v2`.** Simple; all-or-nothing per tenant; no way to sell AI mail separately.
- **B) A `mail.*` flag namespace** — `mail.folders`, `mail.signatures`, `mail.ai`, `mail.telemetry`, `mail.shared_inbox`, `mail.secure_links` — each projected by the Platform Console, defaulting off, with the AI ones additionally under the existing `ai.assistant.backend` ceiling.
- **C) Plan-tier entitlements only** (Starter/Pro/Enterprise), no per-feature flags.

> **Recommendation: B.** It matches the existing pattern (`feature_state` + EMV ceiling), lets you
> dark-launch telemetry and AI per tenant, and gives Sales something to package later — tiers can be
> defined as bundles of these flags without another migration. Telemetry and shared inbox in
> particular need to be off by default for legal reasons (Q32) and operational reasons (Q30).

**Decision:** **********\*\***********\_\_**********\*\***********

---

### Section B — PR-1: Mail core & the master composer (Q6–Q12)

---

#### Q6 · What is the mailbox ownership model?

_Why it matters:_ Today `email_connection` has an `owner_user_id` and a per-owner default — mail is
strictly personal. Your shared-inbox requirement (`support@`, `billing@`) and "role-based
visibility" both need a different model.

- **A) Personal only.** Each user connects their own mailbox; shared addresses are just another personal connection someone owns.
- **B) Three kinds: Personal, Shared (team-owned, multi-member, assignable), Delegated (a PA works another user's mailbox with audit).** Visibility and assignment attach to the connection kind.
- **C) Personal + Shared** (drop delegation for now).

> **Recommendation: B, building Personal + Shared in PR-1 and Delegated in PR-5.** Declaring the
> three kinds up-front costs one enum column now and avoids a second migration later; delegation is
> a real logistics-office need (an assistant covering a manager's inbox) but it needs the audited
> visibility model from PR-5 to be safe.

**Decision:** **********\*\***********\_\_**********\*\***********

---

#### Q7 · How do we search mail?

_Why it matters:_ "search through and all… full email management". There is no search today. Body
text lives in Postgres; the corpus per tenant is small by web standards but large for a `LIKE`.

- **A) Postgres full-text search** — a `tsvector` column over subject + body + participants, GIN-indexed, with filters (folder, date, has-attachment, party, bound entity). No new infrastructure.
- **B) Postgres FTS + semantic search via the existing pgvector corpus** — keyword results plus "find the thread where we agreed the demurrage waiver", reusing `ai_chunk`.
- **C) An external engine (Meilisearch/OpenSearch)** as a new service per deployment.

> **Recommendation: A in PR-1, B in PR-4.** FTS with the right filters covers the daily need and
> costs one migration; you already run pgvector, so semantic recall is an incremental add once the
> AI layer exists. Option C adds a service to operate, back up and secure per tenant — a real cost
> on a self-managed VPS for a benefit you do not need at this corpus size.

**Decision:** **********\*\***********\_\_**********\*\***********

---

#### Q8 · Which rich-text editor, and how do we make its output survive real mail clients?

_Why it matters:_ You asked for "the richest possible editor… a masterpiece". No editor is installed
today. The hard part is not the toolbar — it is that Outlook renders a subset of HTML from 2007,
Gmail strips `<style>` blocks, and dark mode inverts colours unpredictably.

- **A) TipTap (ProseMirror).** Headless, MIT, extension-based — mentions, slash commands, tables and custom nodes (an invoice table, an action card) are first-class. Largest bundle of the three (~120 KB gz with extensions).
- **B) Lexical (Meta).** Smaller and faster, excellent plugin model, but tables/custom serialisation need more hand-rolling and the ecosystem is thinner.
- **C) A `contenteditable` toolbar built in-house.** No dependency, total control, and a guaranteed multi-week detour into browser bugs.

> **Recommendation: A (TipTap) plus a dedicated outbound serializer.** The serializer is the real
> deliverable: author in a constrained schema, then emit table-based, inline-styled, ~600 px-wide
> email HTML with a plain-text alternative part, run through `sanitize-html` on the way out as well
> as in. Fonts must be web-safe stacks (the codebase already learned this — see the comment in
> `notification.service.js` about Outlook stripping `@font-face`). Emoji ship as Unicode, not
> images. This is the one place where "richest possible" and "renders correctly at the client" pull
> against each other, and the serializer is where we resolve it.

**Decision:** **********\*\***********\_\_**********\*\***********

---

#### Q9 · What is the attachment policy?

_Why it matters:_ "We must be able to attach documents — now we can't." Outbound attachments do not
exist at all; inbound ones are capped at 25 MB and stored in `document_vault`.

- **A) Direct attach only,** 25 MB cap (matching the current inbound limit), files stored in the vault and referenced by the message.
- **B) Vault-first with automatic offload:** anything under a threshold (say 10 MB) attaches normally; above it the composer offers a secure ephemeral link (PR-5) instead, and total message size is enforced at 25 MB.
- **C) Links only** for anything not tiny — never attach binaries.

> **Recommendation: B.** It is what large mail systems do, and it plugs straight into the ephemeral
> link work you asked for. Every outbound attachment gets a `document_vault` row, which means the
> file that went to a client is content-hashed and auditable — which the immutable-archive
> requirement (Q34) needs anyway. Please confirm the **threshold** and the **hard cap**.

**Decision:** **********\*\***********\_\_**********\*\***********
**Offload threshold / hard cap:** **\_\_** MB / **\_\_** MB

---

#### Q10 · What is in the slash-command and picker registry, and how is it permissioned?

_Why it matters:_ `/invoice-table`, `/bank-details`, `/quote-pdf` all pull ERP data into a message
that goes to an external party. A command that renders a table of unpaid invoices must not run for
a user who cannot read finance.

- **A) A fixed built-in list** of ~8 commands, each hard-coded with a permission check.
- **B) A declarative registry** (`mail.commands.js`, mirroring the `*.ai.js` manifest pattern): each command declares `{key, label, module_key, permission, resolver, render}`, is discovered at boot, and is filtered per-user by the same RBAC used everywhere else. Tenant admins can additionally define **snippets** (text/HTML) with no data access.
- **C) Free-form templating** — users write handlebars-style expressions against ERP entities.

> **Recommendation: B.** It reuses the pattern the codebase already trusts for the AI catalogue, so
> the command list can never grant more than the user has, and adding a command is a file, not a
> wiring change. Option C is a data-exfiltration surface with a template engine attached.
>
> **Proposed v1 command set** — please strike or add:
> `/invoice` (insert an invoice summary table) · `/quote` · `/dossier` (shipment status block) ·
> `/bank-details` (from `treasury_account`, masked per visibility) · `/document` (vault picker) ·
> `/snippet` · `/signature` · `/availability` (meeting slots) · `/secure-link`.

**Decision:** **********\*\***********\_\_**********\*\***********
**Commands to add or remove:** ******\*\*******\_\_******\*\*******

---

#### Q11 · Drafts, undo-send, and offline behaviour?

_Why it matters:_ This is a PWA used in a warehouse. Losing a half-written message to a dropped
connection is the fastest way to make people go back to Outlook.

- **A) Local drafts only** (browser storage), no undo-send.
- **B) Server-side autosaved drafts** (per user per thread, like the existing `comms_draft` table), **plus a 15–30 s undo-send window**, plus offline queueing that flushes when the connection returns.
- **C) B, and also sync drafts to the provider's Drafts folder** so they appear in Outlook/Gmail too.

> **Recommendation: B, with C as a PR-1 stretch for Graph and Gmail only.** Server drafts are cheap
> (one table, mirroring `comms_draft`) and are the difference between "a tool I trust" and "a tool I
> retype into". Provider draft sync is genuinely useful but IMAP APPEND-to-Drafts is fiddly; making
> it capability-flagged (Q4) keeps it optional. Undo-send is implemented as a delayed BullMQ job,
> not a fake client-side timer, so it survives a page close.

**Decision:** **********\*\***********\_\_**********\*\***********
**Undo-send window:** **\_\_** seconds

---

#### Q12 · How do we classify the Split Inbox (human vs system) and the VIP lane?

_Why it matters:_ You want cPanel notices, delivery failures and server logs out of the main inbox,
and high-value clients pinned to the top. Misclassifying a client's mail as "system" is worse than
not splitting at all.

- **A) Deterministic header rules only** — `Auto-Submitted`, `Precedence: bulk/junk`, `List-Unsubscribe`, `X-Auto-Response-Suppress`, DSN/bounce content types, `no-reply@`/`mailer-daemon@`/`postmaster@` patterns, plus a tenant-editable sender allow/deny list. Transparent, debuggable, no cost per message.
- **B) Rules first, AI fallback** for the residue, with every AI verdict stored, correctable by the user, and the correction persisted as a per-tenant rule.
- **C) AI classification for everything,** with a confidence score.

> **Recommendation: B.** Headers settle the overwhelming majority for free; the AI only sees what
> the rules cannot decide, which keeps cost negligible and behaviour explainable. Crucially, **a
> message from a party that exists in `client_master` / `supplier_master` never goes to the System
> stream**, regardless of what the classifier thinks — that single rule prevents the failure mode
> that would kill trust in the feature.
>
> For **VIP**: a flag on the party record (`is_vip`, plus automatic VIP for accounts above a
> configurable revenue or receivables threshold) that pins their threads and bypasses other sorting.

**Decision:** **********\*\***********\_\_**********\*\***********
**VIP definition (manual flag / revenue threshold / both):** ****\*\*****\_\_****\*\*****

---

### Section C — PR-2: Identity, signatures & deliverability (Q13–Q17)

_Context: your `Smart_LS_Signature_Generator.html` is a standalone canvas tool — it renders a
650 × 325 px signature to a `<canvas>`, exports PNG/WebP at 1×/2×/3× with palette compression, has
an EN/FR toggle, a batch tab for 10+ staff, JSON project save/load and a "save to PC" flow. Bringing
it into the ERP changes what it should be, which is what Q13–Q16 decide._

---

#### Q13 · Should a signature be HTML, an image, or both?

_Why it matters:_ This is the single most consequential signature decision. Your existing tool
produces an **image**. Images always render identically — and are unselectable, unsearchable,
invisible to screen readers, often blocked by default in Outlook, and add ~30 KB to every message.
HTML signatures are selectable and clickable but render differently across clients.

- **A) Image (PNG) only** — exactly what the current tool does. Pixel-perfect everywhere it renders at all; phone numbers and emails are not clickable or copyable; blocked-image users see a grey box.
- **B) HTML-first with a hosted logo image** — a table-based, inline-styled signature with real text, real `tel:`/`mailto:` links, the logo served from the tenant's asset URL, and a plain-text variant for text-only parts.
- **C) Both: HTML by default, with a per-tenant switch to image mode,** and the image generated server-side from the same template so the two can never drift.

> **Recommendation: C, implemented HTML-first.** One template definition, two renderers. The HTML
> renderer is what ships in every message; the image renderer (headless Chromium via the existing
> `puppeteer` dependency — the same engine the PDF service uses) exists for tenants who insist on
> pixel-perfection and for the "export my signature to paste into Outlook desktop" workflow your
> standalone tool serves today. Building it as one template with two renderers is barely more work
> than either alone and removes the "which one is current?" problem permanently.

**Decision:** **********\*\***********\_\_**********\*\***********

---

#### Q14 · Where does each signature field come from, and who wins on conflict?

_Why it matters:_ "The system automatically pulls the user's name, job title, and phone numbers."
`employee` has `full_name`, `job_title`, `department`, `email`, `avatar_ref` — but **no phone
column**. `corporate_entity` has `phone`, address, and the letterhead blocks. `app_user` has name and
email. So some fields exist, some must be added, and some must be user-entered.

- **A) Everything derived, nothing editable.** Signature = pure function of `employee` + `corporate_entity`. Perfectly consistent; a wrong job title in HR becomes a wrong signature with no workaround.
- **B) Derived with a governed override list.** Company blocks (logo, motto, address, legal mentions, colours) are locked to the entity; person blocks (name, title, department) derive from `employee` and are read-only; contact blocks (desk phone, mobile, optional pronouns, optional certifications) are user-editable and stored on a new `user_signature_profile`. Missing source columns (`employee.phone_desk`, `employee.phone_mobile`) get added in the same migration.
- **C) Fully user-authored** with the corporate block injected.

> **Recommendation: B.** It is the same principle as `entity-letterhead.service.js` — _the operator
> chooses which blocks appear; the content is derived_ — which is already the codebase's stated
> position on exactly this class of problem, and it is right: retyping the company address into 40
> signatures is how you end up with four versions of it. Adding the two phone columns to `employee`
> also fixes a real master-data gap (HR cannot currently record a staff phone number at all).

**Decision:** **********\*\***********\_\_**********\*\***********
**Fields you want user-editable beyond desk/mobile phone:** ****\*\*****\_\_****\*\*****

---

#### Q15 · Who controls signature templates?

_Why it matters:_ Brand consistency versus individual autonomy. Your tool today lets one person
configure everything, including logo upload and slogan.

- **A) One locked tenant template.** The admin defines it; every user gets the same layout with their own data. Maximum consistency, zero flexibility.
- **B) An admin-curated set of approved templates** (e.g. Standard, Compact, With-certifications, Legal-footer) plus per-department defaults; the user picks from the approved set and fills only the fields Q14 marks editable.
- **C) Free design per user,** with the corporate logo enforced.

> **Recommendation: B.** Departments genuinely differ — an Operations signature wants a tracking
> link and the ops hotline, Finance wants bank details and a payment-terms line, Sales wants a
> booking link. A curated set handles that without letting anyone invent a new brand. The admin
> screen lives under Settings → Company → Signatures, alongside branding.

**Decision:** **********\*\***********\_\_**********\*\***********
**Template variants you want seeded:** ****\*\*****\_\_****\*\*****

---

#### Q16 · What exactly happens on a promotion — and what about mail already sent?

_Why it matters:_ "If a user gets a promotion, their email signature updates automatically across
the entire platform." The word _entire_ hides a question: does history change too?

- **A) Resolve at send time, never touch history.** The signature is composed when the message is sent, from the data current at that moment. Old emails keep the old title — which is what actually happened, and what an auditor expects.
- **B) Resolve at send time, plus a stored render** cached per user and invalidated by an `employee.updated` orchestration handler, so signature composition costs nothing at send time.
- **C) Store a signature reference and render live at display time,** so old messages retroactively show the new title.

> **Recommendation: B.** It gives you the "updates automatically everywhere" behaviour for everything
> going forward — the moment HR posts the promotion, the next email carries the new title, on every
> surface including system-generated mail — while keeping the sent record truthful. The invalidation
> hook slots into `src/orchestration/handlers/` exactly like the existing handlers.
> **Option C is a trap**: rewriting what a past email said is an integrity problem, and it directly
> contradicts the immutable-archive requirement in Q34.

**Decision:** **********\*\***********\_\_**********\*\***********

---

#### Q17 · What do system-generated emails carry, and from which identity?

_Why it matters:_ You said "for system generated emails it comes from system addresses". The
codebase agrees — `email_identity` per purpose, with a Praxis-owned fallback. But an OTP email and
an invoice email should not look the same, and neither should carry a person's mobile number.

- **A) No signature on system mail** — just the existing branded HTML wrapper.
- **B) A corporate signature block** (entity identity, logo, legal mentions, unsubscribe where applicable) rendered from the same template engine, with **no person block**, varying by purpose: `BILLING` gets payment/bank details, `SUPPORT` gets the support contact, `NOTIFICATIONS` stays minimal.
- **C) The signature of the user who triggered the action** (e.g. the accountant who issued the invoice).

> **Recommendation: B, with a documented exception for document-sending.** When a named user emails
> an invoice or a quotation to a client from within the ERP, that message should carry **that user's
> signature but the tenant's `DOCUMENTS`/`BILLING` sender identity** — the client needs a human to
> reply to. Pure machine mail (OTP, password reset, system alerts) carries the corporate block only.
> This distinction needs to be explicit in the guide because it is the sort of thing that otherwise
> gets decided accidentally by whoever writes the first template.

**Decision:** **********\*\***********\_\_**********\*\***********

---

### Section D — PR-3: ERP binding, smart dossier & collaboration (Q18–Q23)

---

#### Q18 · How aggressive is auto-binding, and on what signals?

_Why it matters:_ `mail.service.autoLink` already binds on a dossier reference in the subject, else
the sender's email. You want to extend that to tracking IDs, PO numbers, invoice numbers and domain
matching. A wrong binding puts a competitor's email on a client's timeline.

- **A) Suggest only.** Every binding is a suggestion chip the user accepts. Zero wrong bindings; friction on every thread.
- **B) Confidence-scored: auto-bind on strong signals, suggest on weak ones.** Strong = exact dossier/invoice/PO reference found in subject or body, or sender address exactly matching a party contact. Weak = sender _domain_ matches a party, or a container/BL number appears. Every binding is reversible, audited, and shows _why_ it bound.
- **C) Auto-bind on anything that matches,** with a correction path.

> **Recommendation: B.** The "show why" part matters as much as the threshold — a chip reading
> _"Bound to dossier SLAS-2026-0042 · matched reference in subject"_ lets a user trust or correct it
> in one glance. Domain-only matching must stay a suggestion: freight forwarding is full of shared
> agent domains and Gmail addresses.
>
> **Signals to extract** (please confirm): dossier reference (`SLAS-2026-####`, already implemented),
> invoice/proforma number, PO number, container number (ISO 6346, checksum-validatable), BL/AWB
> number, quote reference, sender address, sender domain.

**Decision:** **********\*\***********\_\_**********\*\***********
**Additional reference formats we must parse:** ****\*\*****\_\_****\*\*****

---

#### Q19 · What goes in the right-pane Smart Dossier — and in what order?

_Why it matters:_ You said "you are going to better advise on what can be here". The pane is
prime real estate; the temptation is to show everything and thereby show nothing. It should answer
the three questions an operator actually has mid-thread: _who is this, do they owe us, what is
moving right now._

- **A) Minimal:** identity, balance, active dossiers. Fast, fits without scrolling.
- **B) Layered:** a fixed header (identity + risk/VIP badges + assigned account manager) over collapsible sections, in this order — **① Money** (outstanding balance, overdue by aging bucket, credit limit and headroom, payment-terms days) · **② Active operations** (open dossiers with current milestone, ETA, and any blocked milestone) · **③ Commercial** (open quotes/proposals, last invoice, YTD revenue) · **④ Documents** (checklist for this client/service type with the gaps highlighted and a "chase missing documents" button) · **⑤ Interactions** (last 5 emails/calls/notes across the account, not just this thread) · **⑥ Compliance** (KYC/screening status, blocked flags).
- **C) A configurable pane** where each tenant chooses and orders the sections.

> **Recommendation: B in PR-3, with C as a later refinement.** Almost all of this already exists in
> `party-360.service.js` — outstanding, aging buckets, open invoices, contacts, documents,
> compliance are computed there today, zero-safe for a brand-new party. The work is a **thin
> `mail-context` aggregator** that returns a compact subset in one round trip (the full 360 payload
> is too heavy to fetch on every thread click) plus the drawer component. Ship a fixed, well-chosen
> order first; make it configurable once you know what people actually collapse.
>
> One addition worth making explicit: when the thread is bound to a **supplier** rather than a
> client, the pane should flip to the supplier view (open POs, three-way-match exceptions, scorecard)
> — `supplier_scorecard.service.js` already exists.

**Decision:** **********\*\***********\_\_**********\*\***********
**Sections to add / remove / reorder:** ****\*\*****\_\_****\*\*****

---

#### Q20 · Which in-email action cards ship in v1, and do they honour the approval chain?

_Why it matters:_ "Users can click 'Generate Invoice' or 'Update Status' directly inside the email
interface." `doc/BUILD_CONVENTIONS.md` is unambiguous that every record follows
draft → submit → approve → post, and that the AI "never bypasses approval… no separate AI
back-door". An action card is the same question in a different wrapper.

- **A) Read-only cards.** Show the invoice/shipment inline; every write opens the real module screen in a new tab.
- **B) Cards that invoke the real service and enter the real lifecycle.** "Generate Invoice" creates a **DRAFT** and returns a link plus an approval task if one is configured — never an issued, locked document. "Update Status" advances a milestone through the milestone engine with its normal guards.
- **C) Cards that complete the action outright** for a configurable set of low-risk operations.

> **Recommendation: B.** It is the only option consistent with the conventions the rest of the
> codebase is held to, and it still delivers the felt benefit — the operator never leaves the inbox
> to start the work. The card renders the resulting draft inline with its status, so the user sees
> exactly where it landed.
>
> **Proposed v1 cards** — please strike or add: _Create proforma from this enquiry_ ·
> _Attach this thread to a dossier_ · _Update milestone / operation status_ · _Log a payment promise_ ·
> _Request a missing document_ · _Create task / assign_ · _Convert to Lead / Ticket_ (see Q23) ·
> _Send quote PDF_.

**Decision:** **********\*\***********\_\_**********\*\***********
**Cards to add or remove:** ******\*\*******\_\_******\*\*******

---

#### Q21 · How do internal side-notes and @mentions work, and where does the mention land?

_Why it matters:_ "A private internal commentary tab on any external email thread… this shows here
and goes to the in-house chat box directly so the in-house person can see that they have been
tagged." Two systems must meet: mail (MOD-72) and team chat (MOD-64). Note that **`smartcomm` has no
mention primitive today** — this builds one.

- **A) Notes only.** A `email_thread_note` table with an internal tab; mentions are plain text; the mentioned person gets an in-app notification.
- **B) Notes + a real mention primitive.** A `mention` record (user, source, thread, note) that fans out through the existing `notification.service` (in-app + web push + optional email) **and** posts into the mentioned user's chat as a message card linking back to the thread. Mentions are resolvable/acknowledgeable.
- **C) Mirror the whole thread into a smartcomm channel** created per email thread, so all internal discussion is chat.

> **Recommendation: B.** It gives you exactly the described behaviour without duplicating every
> external email into chat (option C would flood `comms_message` and create two sources of truth for
> one conversation). The mention primitive is reusable — the same table can later back mentions in
> chat, on dossiers and on invoices, which is worth building once and properly.
>
> **A hard requirement for the guide:** internal notes must be structurally incapable of being sent
> outward. Different table, different render path, a visible internal-only treatment in the UI, and
> a test that asserts a note can never be included in an outbound message body.

**Decision:** **********\*\***********\_\_**********\*\***********

---

#### Q22 · How do inbound documents get filed, and how do we chase what is missing?

_Why it matters:_ "Once a client emails a document type… we should be able to download and it
uploads to the particular document type under the client… and we can easily see what is lacking and
notify the client." Attachments already land in `document_vault`, but with `docType: null` and no
client link — so they are stored and invisible.

- **A) Manual filing.** A "File this attachment" button opens a picker for document type + client/dossier. Reliable, one click per document.
- **B) AI-classified with one-click confirm.** On ingest, classify each attachment against the `DOCUMENT_TYPE` dictionary (BL, MAWB, INVOICE, RECEIPT, POD, CUSTOMS, APEC, PACKING_LIST, WAYBILL) using the existing Gemini vision service, pre-select the type and the bound client/dossier, and let the user confirm with one click. Confidence shown; never files silently.
- **C) Fully automatic filing** above a confidence threshold, with an audit trail.

> **Recommendation: B.** The classifier is genuinely good at this document set, but a
> misfiled bill of lading on the wrong dossier is an operational incident, so a human confirms.
> Filing writes `doc_type_ref_id` + `client_id` on the vault row — columns that already exist.
>
> **The missing-document chase** needs one new thing: a **required-document checklist per client
> type and per service type** (a Cameroon import file needs BL, packing list, commercial invoice,
> APEC/exemption where applicable, customs declaration; an export file differs). The pane shows
> received-vs-required, and "Chase missing documents" composes a pre-filled request naming exactly
> what is outstanding. Please confirm you want the checklist to be **tenant-configurable** rather
> than hard-coded — I recommend configurable, seeded with a sensible Cameroon/CEMAC default.

**Decision:** **********\*\***********\_\_**********\*\***********
**Checklist: tenant-configurable (rec) / hard-coded / other:** ****\*\*****\_\_****\*\*****

---

#### Q23 · What can an email be converted into, and how much does the AI pre-fill?

_Why it matters:_ "Transform an incoming email into a CRM Lead, Support Ticket, Task, or Purchase
Requisition with a single click, pre-filling all parsed data." All four targets exist (`lead`,
`q_ticket`, `approval_task`/task, `purchase_request`), plus `quote_request` and `contact_enquiry`
from the Sales CRM work.

- **A) Convert with an empty form** pre-filled only with sender, subject and body.
- **B) Convert with AI-parsed pre-fill into a review form** — the AI extracts named fields (company, contact, cargo, incoterm, origin/destination, volumes, urgency, complaint category) into the target's real validator schema, the user reviews and saves. Nothing is created without the review step.
- **C) Convert silently** and let the user edit afterwards.

> **Recommendation: B**, with the conversion recorded both ways: the new record links back to the
> email thread, and the thread shows what it became. Two additions worth making: **duplicate
> detection** (this sender is already a lead / already has an open ticket — offer to attach rather
> than create a second one, reusing `_shared/dedup.service.js`), and **conversion targets beyond
> your list**: _Quote Request_ and _Contact Enquiry_, since the Sales CRM already models those and
> they are the two most common inbound shapes for a freight forwarder.

**Decision:** **********\*\***********\_\_**********\*\***********
**Conversion targets to include:** ****\*\*****\_\_****\*\*****

---

### Section E — PR-4: The AI layer (Q24–Q30)

---

#### Q24 · How autonomous is the AI allowed to be with email?

_Why it matters:_ `doc/AI_ARCHITECTURE.md` locks the rule "**reads free, writes confirmed**" and
every AI write returns a card the user confirms. Sending an email to a client is a write with
external consequences and no undo. Your description consistently says "waiting for your approval" —
this question just makes that binding, and defines the edges.

- **A) Draft-only, always.** The AI composes into the editor; a human presses Send. No exceptions.
- **B) Draft-only for client-facing mail, with an opt-in auto-send lane** for narrowly-defined, tenant-configured cases (acknowledgement of receipt, out-of-office style status confirmations), each with a template and a rate limit.
- **C) Auto-send whenever confidence is high,** with a review log.

> **Recommendation: A for PR-4; revisit B once you have six months of accepted-draft data.** The
> failure mode of an incorrect auto-sent email to a shipping line or a customs broker is
> commercially real, and you cannot recall it. Draft-only also keeps the whole feature inside the
> existing propose→confirm architecture rather than carving an exception into it. The productivity
> claim is preserved: the draft is already written when the operator opens the thread.

**Decision:** **********\*\***********\_\_**********\*\***********

---

#### Q25 · Inline autocomplete — how, and at what cost?

_Why it matters:_ "As you type, the AI suggests full sentences in your natural voice." This is the
most expensive feature per unit of value in the whole programme: it fires on typing, not on demand.
At a keystroke-debounced cadence, a busy operator can generate hundreds of completions an hour.

- **A) Skip inline autocomplete.** Ship on-demand generation and rewrite instead (Q26/Q27), which delivers most of the benefit at a fraction of the cost.
- **B) Ghost-text completion, throttled and opt-in per user:** fires after a pause of ~500 ms at a sentence boundary only, sends a short context window (current paragraph + subject + thread summary, never the full thread), uses a cheap fast model, caches aggressively, is disabled on threads marked confidential, and counts against the tenant's AI budget with a visible per-user meter.
- **C) Full-strength completion on every keystroke** using the primary reasoning model.

> **Recommendation: B, shipped behind its own flag and off by default.** The "natural voice" part is
> worth being precise about: a genuine per-user style model is not realistic here, but a **style
> profile** — assembled from that user's last ~50 sent messages (typical greeting, sign-off, average
> sentence length, formality, language mix) and stored as a short prompt preamble — gets most of the
> perceived effect for almost nothing. Please confirm you accept a **style profile** rather than a
> fine-tuned per-user model.

**Decision:** **********\*\***********\_\_**********\*\***********
**Style profile (rec) / fine-tuned model / neither:** ****\*\*****\_\_****\*\*****

---

#### Q26 · Which tone presets do we seed, and what languages?

_Why it matters:_ "When we click on the magic icon, we can select a tone… so when they select it
becomes easy actually to proceed." The preset list is a product decision, not a technical one, and
it should reflect what a Douala freight-forwarding office actually writes.

- **A) Four generic tones:** Formal, Friendly, Concise, Persuasive.
- **B) Nine business-situational presets:** _Formal / corporate_ · _Friendly professional_ · _Concise executive_ (bulleted) · _Persuasive / commercial_ · _Apologetic / service recovery_ · _Firm — payment chase_ · _Firm — escalation_ · _Technical / operational precision_ · _Warm follow-up_. Plus separate one-click actions: **Fix grammar** · **Shorten** · **Expand** · **Translate → FR** · **Translate → EN**, each preserving logistics and accounting terminology (incoterms, HS codes, OHADA account names) via a protected-terms glossary.
- **C) A free-text instruction box** — the user types what they want.

> **Recommendation: B, and also keep C as an "Other…" option.** The presets are what make it fast;
> the free-text box is what stops the presets from being a cage. The protected-terms glossary matters
> more than it sounds — an LLM "improving" _FOB Douala_ or _compte 411_ into something friendlier is
> the kind of error that reaches a customs broker. Note the codebase already carries FR/EN i18n
> throughout, so bilingual output is consistent with the product, not an add-on.

**Decision:** **********\*\***********\_\_**********\*\***********
**Presets to add or remove:** ******\*\*******\_\_******\*\*******

---

#### Q27 · What may zero-prompt drafting read, and how do we keep it honest?

_Why it matters:_ Your example — _"order #LS-992 cleared customs this morning and is scheduled for
delivery at 2:00 PM"_ — is the flagship feature and the biggest risk in the programme. If the model
invents a delivery time, a client plans around a fiction.

- **A) Template-driven, not generative.** Detect intent ("where is my container?"), fetch the facts, and fill a pre-written bilingual template. Impossible to hallucinate a fact; reads as slightly robotic.
- **B) Generative but fact-fenced.** The AI may only state values returned by an explicit whitelist of read tools; every factual claim in the draft is annotated with its source, the draft shows a "facts used" strip the operator can verify at a glance, and a post-generation check rejects any date, reference or amount not present in the retrieved data.
- **C) Free generation over retrieved context,** trusting the model.

> **Recommendation: B.** The fact-fence and the source strip are what make this shippable — the
> operator can confirm four facts in two seconds rather than re-verifying the whole message, which
> is the actual time saving. Also required: `redact.js` runs before any external model call (it
> already exists), and the tenant can disable ERP grounding entirely while keeping tone/rewrite.
>
> **Proposed read whitelist** (all already-permissioned service reads): dossier status and
> milestones · shipment/container tracking · invoice and payment status · quote status · client
> contacts and terms · document checklist state. Please confirm nothing sensitive should be
> reachable — in particular I propose **excluding** margin/costing, payroll and supplier pricing
> from drafting context entirely, since those must never appear in a client-facing draft even by
> accident.

**Decision:** **********\*\***********\_\_**********\*\***********
**Data explicitly out of bounds for drafting:** ****\*\*****\_\_****\*\*****

---

#### Q28 · How far does attachment OCR go toward posting?

_Why it matters:_ "Incoming PDF invoices, bills of lading, or receipts are automatically parsed…
offering a one-click 'Post to Ledger/Inventory' button." Extraction is the easy 20 %. Matching line
items to an existing PO and posting to an OHADA ledger is the 80 % — and it lands in accounting,
where errors are expensive and auditable.

- **A) Extract and display only.** Show the parsed fields next to the document; a human keys them into the real form.
- **B) Extract → match → propose.** Parse the document, match it against candidate records (supplier by name/tax ID, PO by number/amount, dossier by reference), show a confidence-scored match, and produce a **DRAFT** supplier invoice / goods-received / cost entry through the normal service — which then follows the standard approval and posting ladder. Provenance is stamped exactly as the bank-statement OCR already does (`ocr_used`, `ocr_provider`, `ocr_model`, page count).
- **C) Auto-post above a confidence threshold.**

> **Recommendation: B, and never C.** The existing bank-statement reconciliation flow is the
> precedent and it is the right one — including its comment that an auditor asking "where did this
> number come from" must be able to tell OCR from a machine-readable source. Option C would put
> unreviewed machine output into a ledger that the OHADA/DSF statements are derived from.
>
> Scope question inside this: which document types do we support in v1? I propose **supplier
> invoice, receipt, and bill of lading**, deferring packing lists and customs declarations to a
> follow-up.

**Decision:** **********\*\***********\_\_**********\*\***********
**v1 OCR document types:** ******\*\*******\_\_******\*\*******

---

#### Q29 · Thread summaries and sentiment/churn radar — what exactly, and who sees it?

_Why it matters:_ Summaries are low-risk and high-value. Sentiment is the opposite: a badge reading
"angry" on a client's thread is a judgement about a person, visible to colleagues, generated by a
model, and quite capable of being wrong about a French-language message from a terse but perfectly
content client.

- **A) Summaries only.** A cached 2–3 sentence summary at the top of any thread over N messages, regenerated on new mail, showing latest position, blockers and next steps. No sentiment.
- **B) Summaries + a private account-level risk signal.** Per-message sentiment is computed but **never displayed as a label on the message**; it feeds a rolling 30-day account signal shown only on the account manager's and team lead's dashboards as _"attention needed"_, with the contributing threads listed. Escalation is a notification, not a public badge.
- **C) Live sentiment badges on every thread,** visible to all with mail access, with automatic escalation to team leads.

> **Recommendation: B.** You get the business outcome you described — at-risk accounts surface to
> the right people — without the failure mode of a colleague seeing "ANGRY" next to a client who
> simply writes in clipped French. It also avoids an awkward conversation if a client ever sees a
> screen-share. If you want the visible badge, I would restrict it to threads containing an explicit
> complaint signal (escalation language, an SLA breach, a repeated unanswered follow-up) rather than
> a general sentiment score.
>
> Summaries: I recommend triggering at **5+ messages** in a thread, cached, invalidated on new mail.

**Decision:** **********\*\***********\_\_**********\*\***********
**Summary trigger threshold:** **\_\_** messages

---

#### Q30 · Voice-to-email and pre-send guardrails — how strict?

_Why it matters:_ Two different things that share one property: they sit between the user and the
Send button. `transcription.service` (Groq/Whisper) and the `ai-transcribe` worker already exist, so
voice is mostly UI plus a cleanup pass. Guardrails are deterministic checks, and the only question
is whether they warn or block.

- **A) Voice inserts a raw transcript; guardrails warn only.** Nothing ever blocks a send.
- **B) Voice: record → transcribe → AI cleanup pass (filler removal, paragraphing, greeting/sign-off, chosen tone) → into the editor for review, with the raw transcript retrievable. Guardrails: warn on most, hard-block on one class.** The warn set — missing attachment when the body says "attached"/"ci-joint", recipient domain not matching the bound entity, unusually aggressive tone, replying-all to a large list, no subject, unresolved placeholder text (`[amount]`, `XXX`), sending outside the recipient's working hours. The **block** — sending a financial document to a domain that fails the anti-spoofing check in Q35, overridable only with a typed reason that is logged.
- **C) Everything blocks until dismissed.**

> **Recommendation: B.** Warnings that cannot be dismissed get clicked through blindly within a
> week; a single, rare, well-chosen hard block keeps its meaning. The typed-reason override on the
> one blocking case gives you the audit trail that makes it defensible.
>
> Voice detail worth confirming: recording happens in the browser (`MediaRecorder`, webm/opus — the
> transcription service already handles that container), audio is transient and **not** retained
> after transcription unless you want it kept. I recommend **not retaining audio**.

**Decision:** **********\*\***********\_\_**********\*\***********
**Retain voice recordings? yes / no (rec: no):** **\*\***\_\_**\*\***

---

### Section F — PR-5: Workflow, telemetry, security & compliance (Q31–Q35)

---

#### Q31 · Shared inbox assignment, SLA timers, and auto-routing by intent

_Why it matters:_ Three requirements that share one mechanism: a queue with owners and clocks. The
risky one is auto-routing — "the AI reads the incoming message and automatically forwards it to the
correct department". _Forwarding_ mail outside the system is a different act from _assigning_ it
inside the system.

- **A) Manual only.** Team members claim threads; SLA timers run; no automatic routing.
- **B) Internal assignment, never external forwarding.** An intent classifier routes a thread to a **department queue inside Praxis** (Finance, Operations, Customs, Sales, Support), notifies that queue, and starts its SLA clock. Assignment is claim-based with an optional round-robin, a soft lock warns when a colleague is already replying, and status flags run Open → Pending → Resolved. No message is ever auto-forwarded to an external address.
- **C) B plus configurable auto-forwarding** to internal or external addresses per rule.

> **Recommendation: B.** Auto-forwarding is how confidential correspondence leaves an organisation
> by accident, and it is unnecessary here — the recipient is inside the same system and can be
> notified. The soft lock matters more than it sounds: two agents drafting replies to the same
> customer is the classic shared-inbox embarrassment.
>
> Please confirm the **SLA tiers** you want. I propose: first response 4 business hours (VIP: 1),
> resolution 2 business days, computed against tenant business hours and public holidays, with
> breach escalation to the team lead.

**Decision:** **********\*\***********\_\_**********\*\***********
**SLA tiers:** **********\*\***********\_\_**********\*\***********

---

#### Q32 · Read/click telemetry — what is your consent and compliance stance?

_Why it matters:_ This is the one item in your list with a legal dimension, and I would be doing you
a disservice by scoping it before you decide. Open tracking works by embedding a 1×1 pixel; click
tracking works by rewriting every link through a redirect. In the EU/UK this is regulated
(GDPR/PECR) and generally requires a lawful basis and disclosure; Cameroon's Law No. 2010/012 and
the CEMAC data-protection framework are looser but not silent. Separately, it is **technically
unreliable**: Apple Mail Privacy Protection pre-loads images for a large share of recipients,
manufacturing "opens" that never happened, and image-blocking clients hide real ones.

- **A) Don't build it.** Track only what is unambiguous — replies received, documents opened via our own secure links (Q33), which we already control end-to-end.
- **B) Build it, off by default, per-tenant opt-in with an acknowledgement screen.** Disclosed in the tenant's footer where the tenant chooses, suppressible per recipient and per thread, never applied to internal mail, opens labelled "indicative" in the UI to reflect their unreliability, clicks (which are reliable) tracked separately. Events land on the CRM timeline as you described.
- **C) Build it on by default** for all outbound mail.

> **Recommendation: B, and — genuinely — consider A.** Secure-link telemetry (Q33) gives you the
> signal that actually matters commercially: _did the client open the quotation?_ That is precise,
> defensible, and unaffected by image blocking. Generic open-rate pixels give you a number that is
> systematically wrong and carries the compliance overhead. If you serve or plan to serve EU
> counterparties, this is worth a lawyer's five minutes before we build it.

**Decision:** **********\*\***********\_\_**********\*\***********
**Do you have EU/UK counterparties? yes / no:** **\*\***\_\_**\*\***

---

#### Q33 · Secure ephemeral links and PIN protection — mechanics and defaults

_Why it matters:_ You want commercial quotes and financial statements sent as expiring links rather
than attachments. The codebase already has this pattern in `proposal.share()` — a SHA-256-hashed
token, an expiry, a revocation timestamp, and `viewed_at`/`downloaded_at` tracking, served from a
public route. It generalises cleanly.

- **A) Expiring links only,** no PIN — the token is the secret.
- **B) A generic `secure_link` service** (any vault document or generated PDF), with per-link choice of: expiry (default **7 days**), max view count, optional **6-digit PIN delivered out-of-band** (WhatsApp via the existing `whatsapp.service`, SMS, or read over the phone — never in the same email), optional recipient email verification, immediate revocation, and every view logged with IP, user agent and timestamp onto the client's timeline.
- **C) Full portal-only delivery** — no links at all; clients must log into the client portal to retrieve documents.

> **Recommendation: B, with the option to escalate individual documents to C.** The client portal
> already exists (`src/modules/portal/`), so for recurring clients portal delivery is strictly
> better; ephemeral links are the right answer for one-off recipients and prospects who will never
> create an account. Delivering the PIN through WhatsApp is a genuinely good fit for the Cameroonian
> market and reuses a service you already have.

**Decision:** **********\*\***********\_\_**********\*\***********
**Default expiry / max views:** **\_\_** days / **\_\_** views

---

#### Q34 · Immutable archive and role-based mail visibility

_Why it matters:_ "An un-deletable, timestamped archive of all communications" and "restrict viewing
so sensitive executive or financial emails remain private" are in tension: the first says keep and
prove everything, the second says show it to almost nobody. Both are achievable, but the guide has
to state precisely what "un-deletable" means, because the honest answer is _append-only with a
verifiable hash chain_, not _physically impossible to delete_.

- **A) Log metadata only** — sender, recipients, subject, timestamps, attachment hashes — into `immutable_ledger`. Cheap; proves that a message existed and what it carried, not what it said.
- **B) Hash-chained full archive.** Every message (headers, body, attachment content hashes) is hashed and chained into `immutable_ledger` at ingest/send; the bodies and attachments live in the vault under the existing 10-year retention; deletion of an archived message is blocked at the service layer for everyone including the CEO, and any purge attempt is itself a ledger entry. Verification tooling can prove no message was altered or removed.
- **C) B plus true WORM storage** — S3 Object Lock in compliance mode, so even an administrator with cloud credentials cannot delete within the retention window.

> **Recommendation: B now, with C as a documented upgrade path** once object storage moves to S3
> (the README's plan; storage is local disk today). B is honest and achievable; C is what an auditor
> would call immutable, and it is a configuration change rather than a code change once you are on
> S3 with Object Lock.
>
> **Visibility model, in the same PR:** a `visibility` classification on each thread —
> _Private_ (owner only) · _Team_ (the shared inbox's members) · _Company_ (anyone with MOD-72 view)
> — defaulting from the connection kind, changeable by the owner, with a **break-glass** path for
> the CEO/God-Mode role that always writes an `immutable_ledger` entry naming who looked at what and
> why. Finance and executive mailboxes default to Private.

**Decision:** **********\*\***********\_\_**********\*\***********
**Default visibility for personal / shared mailboxes:** ****\*\*****\_\_****\*\*****

---

#### Q35 · Anti-spoofing, domain health, and the deliverability dashboard

_Why it matters:_ "The system cross-references incoming email domains with the verified domains
saved in your client database, throwing a massive red flag if someone is trying to impersonate a
vendor." This is the single highest-value security feature in your list — supplier-invoice fraud by
domain lookalike is the most common attack on freight forwarders, and it is cheap to defend here
because you hold the master data. `dns-check.js` already does MX/SPF/DKIM lookups with per-record
verdicts.

- **A) Passive display.** Show SPF/DKIM/DMARC results from the message headers; leave the judgement to the user.
- **B) Active cross-reference with graded verdicts.** Maintain verified domains per party (derived from historical correspondence plus explicit admin verification). On every inbound message, combine (i) the `Authentication-Results` header verdict, (ii) exact domain match against the bound party, (iii) **lookalike detection** (Levenshtein distance ≤ 2, homoglyph/IDN substitution, added or dropped hyphens and TLD swaps against known party domains), and (iv) first-contact-from-a-new-domain-claiming-a-known-party. Verdicts: **Verified** (quiet) · **Unverified** (subtle) · **Suspicious** (banner) · **Likely impersonation** (full-width red interstitial that hides the body until acknowledged, and blocks the one action from Q30). Bank-detail-change language in a message from a non-verified domain always escalates.
- **C) B plus automatic quarantine** of likely-impersonation mail into a separate review queue.

> **Recommendation: B, plus the deliverability dashboard for outbound.** The lookalike check is the
> part that catches real fraud — `smartlogistics-cm.com` versus `smartlogistics.cm` passes SPF
> perfectly well because the attacker owns it, so authentication headers alone will not save anyone.
> The outbound side extends `dns-check.js` into a per-tenant dashboard (SPF, DKIM, DMARC, MX,
> reverse DNS, plus blocklist checks against the major public RBLs), re-checked on a schedule with
> alerts on regression. **IP reputation** beyond public blocklists needs a paid feed — please
> confirm whether you want that scoped or left out.

**Decision:** **********\*\***********\_\_**********\*\***********
**Scope a paid IP-reputation feed? yes / no:** **\*\***\_\_**\*\***

---

## 3. Things I would add that you did not ask for

Offered as recommendations, not decisions — say yes/no and I will fold them into the guide.

| #   | Addition                                                 | Why                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | **Undo-send and a send queue** (already folded into Q11) | The single most requested mail feature in every product that ships without it.                                                                                                                                                              |
| b   | **A "this thread is bound to nothing" nudge**            | The value of the whole programme collapses if half the mail never gets bound. A quiet prompt on unbound threads older than a day keeps the CRM timeline honest.                                                                             |
| c   | **Bounce and delivery-failure handling**                 | Today a bounce just arrives as another inbound message. Parsing DSNs and marking the recipient address as failing prevents the classic "we emailed the invoice three times" to a dead address.                                              |
| d   | **Per-party preferred language**                         | The tenant is bilingual; drafting, templates and signatures should follow the recipient's language automatically rather than the sender's. One column on the party.                                                                         |
| e   | **A `mail-context` performance budget**                  | The right-pane dossier fires on every thread click. It needs its own aggregator with a target (I suggest p95 < 300 ms) and a cache, or the inbox will feel slow and people will stop using the pane.                                        |
| f   | **Conversation-level dedup of ERP notifications**        | With system mail, chat mentions, push and SLA alerts all firing, users will get four pings for one event unless notification fan-out is deduped per event per user.                                                                         |
| g   | **An "email → dossier" keyboard-first flow**             | Operators live in the inbox. Keyboard shortcuts for bind, convert, assign and snooze are what turn this from a demo into a tool.                                                                                                            |
| h   | **Mail-specific tests in CI**                            | The repo runs ~1,400 tests. This programme should add: a provider-capability matrix test, an outbound-HTML rendering snapshot per major client, a "note can never leave the building" test (Q21), and a fact-fence test for drafting (Q27). |

---

## 4. Risks I want on the record before we build

1. **Scope.** Thirty capabilities is a mail client plus a CRM plus an AI product. The five-PR split
   makes it tractable; it does not make it small. If the calendar is fixed, tell me and I will mark
   a v1 subset per PR in the guide rather than letting each PR grow until it cannot ship.
2. **The composer is the load-bearing wall.** Rich text, attachments, slash commands, signatures, AI
   suggestions, voice, guardrails and scheduling all render into one component. It needs to be
   designed as an extensible surface in PR-1 or it will be rewritten twice.
3. **AI cost is per-message, not per-tenant.** Autocomplete, summaries, sentiment, classification,
   drafting and OCR all fire on volume. The existing `ai_usage_ledger` and budget caps must cover
   mail as its own metered feature from day one, with a visible per-tenant spend view — otherwise
   the first month's bill is a surprise.
4. **Provider divergence.** Every feature needs a defined IMAP behaviour (Q4). The most likely
   source of "it works for you but not for me" bugs in this programme.
5. **Telemetry (Q32) and auto-forwarding (Q31) are the two items where the easy build is the wrong
   build.** Both are flagged above.
6. **The signature engine will surface master-data gaps.** There is no phone number on `employee`
   today. Expect PR-2 to also be a small HR master-data cleanup.

---

## 5. Quick-answer sheet

If you want to answer fast, fill this in and I can work from it alone.

```
Q1  ___   Q8  ___   Q15 ___   Q22 ___   Q29 ___
Q2  ___   Q9  ___   Q16 ___   Q23 ___   Q30 ___
Q3  ___   Q10 ___   Q17 ___   Q24 ___   Q31 ___
Q4  ___   Q11 ___   Q18 ___   Q25 ___   Q32 ___
Q5  ___   Q12 ___   Q19 ___   Q26 ___   Q33 ___
Q6  ___   Q13 ___   Q20 ___   Q27 ___   Q34 ___
Q7  ___   Q14 ___   Q21 ___   Q28 ___   Q35 ___

Extra inputs:
  Smart Logistics' mail provider ................. ____________________
  Attachment offload threshold / hard cap ........ ______ MB / ______ MB
  Undo-send window ............................... ______ seconds
  Signature template variants to seed ............ ____________________
  Slash commands to add / remove ................. ____________________
  Dossier pane sections to add / remove / reorder  ____________________
  Reference formats to parse (containers, BL, PO)  ____________________
  Conversion targets .............................. ____________________
  Data out of bounds for AI drafting ............. ____________________
  v1 OCR document types .......................... ____________________
  SLA tiers ....................................... ____________________
  EU/UK counterparties? .......................... yes / no
  Secure link default expiry / max views ......... ______ days / ______ views
  Default visibility (personal / shared) ......... ____________________
  Paid IP-reputation feed? ....................... yes / no
  Retain voice recordings? ....................... yes / no
  Additions from §3 you want (a–h) ............... ____________________
  Hard deadline, if any .......................... ____________________
  Engineers available ............................ ____________________
```

---

## 6. What I produce once you answer

`doc/SMART_MAIL_ENGINEERING_GUIDE.md` — one build-ready document, structured as five PR chapters,
each containing:

- **Scope and non-scope**, with the v1 line drawn explicitly.
- **Migrations** — exact SQL files with numbers in this repo's sequence, forward-only and idempotent,
  matching the existing `migrations/tenant/` conventions.
- **Backend** — the module tree under `src/modules/`, every file's responsibility, endpoint table
  with method/path/RBAC action/validator, service function signatures, worker jobs and their
  schedules, events emitted, and the `*.ai.js` manifest entries.
- **Frontend** — component tree under `client/src/features/comms/`, state and data-fetching approach,
  the API client additions, screen-registry entries, and the i18n keys.
- **Contracts** — request/response shapes and Zod schemas shared through `packages/shared`.
- **Acceptance criteria** — testable statements, one per capability.
- **Test plan** — unit, integration and E2E, naming the files to create.
- **Rollout** — feature flags, migration order, backfill steps, and the rollback path.
- **Sequencing within each PR** — an ordered task list an agent or an engineer can work top to bottom.

Written so that a competent engineer, Claude, or another capable model can execute a chapter without
needing to re-derive any of the decisions above.

---

**Answered.** The completed decision sheet has been turned into the build-ready spec:
**`doc/SMART_MAIL_ENGINEERING_GUIDE.md`**. This questionnaire is retained as the record of what was
asked and why each option was recommended; §1 of the guide carries the answers that were given.
