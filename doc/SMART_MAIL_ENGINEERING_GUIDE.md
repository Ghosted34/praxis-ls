# Praxis LS — Smart Mail: Engineering Guide

**Status:** Plan of record. Built from `doc/SMART_MAIL_PROGRAMME_QUESTIONNAIRE.md` plus the
answers returned on all 35 questions and all eight optional additions.
**Read alongside:** `doc/CONVENTIONS.md` (module layout), `doc/BUILD_CONVENTIONS.md` (document
lifecycle, numbering, approval, AI), `doc/EMAIL_ENGINE_PLAN.md` (what the mail engine already does),
`doc/EMAIL_TWO_CONFIGS.md` (system email vs mailbox — never conflate them), `doc/AI_ARCHITECTURE.md`
(reads free, writes confirmed), `doc/DB_ARCHITECTURE.md` (database-per-tenant, encrypted secrets).

**Audience.** An engineer or an AI agent implementing one PR chapter end to end without needing to
re-derive a decision. Every chapter is self-contained: migrations, backend, frontend, contracts,
acceptance criteria, tests, rollout, ordered task list.

---

## 0. How to use this document

- **§1** is the decision log. It is binding. If the code disagrees with §1, the code is wrong.
- **§2** states what we are building and — just as importantly — what we are **not**, and why.
- **§3** is cross-cutting: flags, RBAC, provider policy, performance budgets, testing gates,
  migration numbering. Read it once before starting any chapter.
- **§5–§9** are the five PRs. Work them in the order given in §3.1.
- **§10** is the index set (migrations, endpoints, flags, env, events) and the v2 backlog.

Conventions used below: `→` marks a deliverable file. **MUST** / **MUST NOT** are hard rules that a
reviewer should reject a PR over. Anything marked _(v2)_ is explicitly out of scope for this
programme and is listed in §10.6.

---

## 1. Decision log

### 1.1 The 35 answers

| #   | Question              | Decision                                                                                                                                                   | Consequence for the build                                                                      |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | PR sequencing         | **B** — PR-1 alone, then PR-2 ‖ PR-3, then PR-4 ‖ PR-5                                                                                                     | Two engineers after the foundation. §3.1 fixes the merge order.                                |
| 2   | Message data model    | **B** — new `email_thread` / `email_message` / `email_message_state`, backfill, compat view                                                                | One cut-over migration in PR-1. `email_inbound` survives as a view.                            |
| 3   | Folder scope          | **B** — canonical six (Inbox, Sent, Drafts, Spam, Archive, Trash) + user folders read-only                                                                 | Multi-folder IMAP sync closes the long-standing G-5 gap.                                       |
| 4   | Provider priority     | **A** — IMAP/SMTP first, no special treatment for the rest. **Smart Logistics runs cPanel SMTP/IMAP.**                                                     | IMAP is the reference implementation _and_ the test target.                                    |
| 5   | Gating                | **B** — `mail.*` flag namespace, **all on for Smart Logistics, off for every other tenant**                                                                | Every new surface ships behind a flag. §3.3.                                                   |
| 6   | Mailbox ownership     | **B** — Personal, Shared, Delegated, "best UI/UX possible"                                                                                                 | Enum declared in PR-1; Personal + Shared built in PR-1; Delegated in PR-5.                     |
| 7   | Search                | **A + B** — Postgres FTS in PR-1, semantic recall in PR-4                                                                                                  | No new infrastructure.                                                                         |
| 8   | Editor                | **A** — TipTap + a dedicated outbound email-HTML serializer                                                                                                | The serializer is the real deliverable, not the toolbar.                                       |
| 9   | Attachments           | **B**, hard cap **25 MB**                                                                                                                                  | Offload threshold 10 MB → secure link (PR-5). Vault-first always.                              |
| 10  | Slash commands        | **B** — declarative registry, seeded with costing, quotation, proforma, invoice, PO + more                                                                 | `mail.commands.js` manifest, permission-filtered. §5.6.4 documents how to add one.             |
| 11  | Drafts / undo-send    | **B**, and **IMAP/SMTP only — no Gmail/Outlook work in this programme**                                                                                    | Server drafts + undo-send + offline queue. No provider draft sync.                             |
| 12  | Split inbox + VIP     | **B** — deterministic rules, AI only on the residue                                                                                                        | A known party never lands in the System stream. VIP = manual flag **or** threshold.            |
| 13  | Signature format      | **C** — HTML on every system email, downloadable PNG for Outlook/webmail/Gmail                                                                             | One template, two renderers (HTML + Puppeteer PNG).                                            |
| 14  | Signature fields      | **B** — derived where the DB has it, **manual entry where it does not**                                                                                    | No new `employee` columns. User-entered fields live on `user_signature_profile`.               |
| 15  | Templates             | **B** — admin-curated set, seeded with the exact current Smart LS layout + two variants                                                                    | Three seeded templates, department defaults.                                                   |
| 16  | Promotion propagation | **B** — resolve at send time, cached render invalidated on `employee.updated`                                                                              | History is never rewritten.                                                                    |
| 17  | System-mail signature | **B** — corporate block, no person, **labelled by department** (Operations, Billing, Customer Support, HR…)                                                | Department label comes from the `email_identity` purpose.                                      |
| 18  | Auto-binding          | **A + confidence score** — **suggest only**                                                                                                                | Binding becomes a suggestion the user accepts. Auto-accept threshold exists but ships **off**. |
| 19  | Dossier pane          | **B** — Overview first, then tabs                                                                                                                          | `mail-context` aggregator + drawer.                                                            |
| 20  | Action cards          | **A for v1** — read-only cards + deep-link with prefill; **say plainly when data is missing**                                                              | No writes from inside the mail UI. Missing-field UI instead of assumptions.                    |
| 21  | Notes & mentions      | **B** + an `@` picker showing **name and role**, reusing the shared employee picker                                                                        | New `mention` primitive; notes structurally cannot be sent outward.                            |
| 22  | Inbound documents     | **B** — AI suggests, human approves, then it appears in Client 360 → Documents                                                                             | Never files silently.                                                                          |
| 23  | Entity conversion     | **B** — always confirm                                                                                                                                     | Review form pre-filled from parsed data + duplicate detection.                                 |
| 24  | AI autonomy           | **A** — draft-only, always. No auto-send lane.                                                                                                             | Every AI output lands in the composer for a human.                                             |
| 25  | Inline autocomplete   | **A for v1 — not built**                                                                                                                                   | On-demand generation and rewrite instead. Major cost saving.                                   |
| 26  | Tone presets          | **B** + a tenth preset. **EN and FR only.**                                                                                                                | Ten presets + five one-click actions + protected-terms glossary.                               |
| 27  | Drafting grounding    | **B** — fact-fenced, whitelisted reads, extensible, **commented for future developers**                                                                    | Deny-list: costing/margin, payroll, supplier pricing.                                          |
| 28  | OCR depth             | **B**, restricted to supplier invoices, receipts, client POs, proofs of payment/cheques. **Nothing reaches the ledger. NO DB WRITE WITHOUT HUMAN REVIEW.** | Extraction → staging row → reviewed prefill → the user creates the record in its own module.   |
| 29  | Summaries / sentiment | **A** — summaries only. **No sentiment or churn radar.**                                                                                                   | Removes a whole subsystem and its failure modes.                                               |
| 30  | Voice + guardrails    | **B** — cleanup pass, warn-set + one hard block, audio not retained                                                                                        | Hard block = financial document to a domain failing the PR-5 anti-spoof check.                 |
| 31  | Shared inbox          | **A** — manual claim + SLA timers. **No intent classifier, no auto-routing, no forwarding.**                                                               | Removes the auto-routing subsystem.                                                            |
| 32  | Telemetry             | **A** — **not built.** EU counterparties confirmed; Smart Logistics has an EU entity.                                                                      | No tracking pixel, no link rewriting. Secure-link opens are the only open signal.              |
| 33  | Secure links          | **A** — expiring links, no PIN                                                                                                                             | `secure_link` service with expiry + revoke + audited views. PIN is a documented v2 hook.       |
| 34  | Archive & visibility  | **B** — hash-chained archive + Private/Team/Company + audited break-glass                                                                                  | True WORM (S3 Object Lock) documented as the upgrade path.                                     |
| 35  | Anti-spoofing         | **B** — graded verdicts with lookalike detection, plus the outbound deliverability dashboard                                                               | Public RBLs only; a paid IP-reputation feed is a config hook, not scope.                       |

### 1.2 The eight additions

|     | Addition                                 | Answer                | Where it lands                                             |
| --- | ---------------------------------------- | --------------------- | ---------------------------------------------------------- |
| a   | Undo-send and a send queue               | **Yes**               | PR-1 §5.5.5                                                |
| b   | "This thread is bound to nothing" nudge  | **No**                | Not built                                                  |
| c   | Bounce / delivery-failure (DSN) handling | **Yes**               | PR-5 §9.8                                                  |
| d   | Per-party preferred language             | **Yes**               | PR-2 §6.4 (one column + resolution helper)                 |
| e   | `mail-context` performance budget        | **Yes, emphatically** | PR-3 §7.5 — its own aggregator, cache, and a hard p95 gate |
| f   | Notification dedup + push wired properly | **Yes**               | PR-3 §7.7                                                  |
| g   | Keyboard-first inbox flow                | **v2**                | §10.6                                                      |
| h   | Mail-specific CI tests                   | **Yes**               | §3.7 and every chapter's test plan                         |

### 1.3 PR-0 decisions (a later round, all built)

A tenth-question round settled the foundation the 35 above assumed. Full detail in §4.2; the ones
that change what the later chapters may take for granted:

| #   | Decision                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | One personal mailbox per user, enforced by a unique index, with a deliberate handover action.                                                                                           |
| P2  | Seven seeded shared mailboxes, not twelve — documents, customs, fleet and warehouse fold into Operations; careers folds into HR; accounts folds into Procurement; Claims is not seeded. |
| P3  | Access is VIEWER / AGENT / MANAGER, not one membership flag.                                                                                                                            |
| P4  | Gmail and Microsoft are kept and tested but gated off — server-side, not only in the UI.                                                                                                |
| P5  | Send-point routing carries **per-corporate-entity** overrides.                                                                                                                          |
| P6  | Origin tagging by `X-Praxis-*` header plus our own Message-ID; historical mail is `UNKNOWN`, never guessed.                                                                             |
| P7  | Every configuration surface lives **in Comms**, in sub-tabs. Nothing moved to Settings.                                                                                                 |
| P8  | Two setup flows from one engine, with a cPanel preset.                                                                                                                                  |
| P9  | Per-mailbox send throttles with spillover, 90-day default sync depth, visible health.                                                                                                   |
| P10 | No requirements register — the final audit is read by a human.                                                                                                                          |

### 1.4 Unasked questions resolved by judgment

Three capabilities from the original brief did not get their own question. Decided here, and flagged
so nobody thinks they were forgotten:

1. **Follow-up boomerang / snooze-and-return — BUILT** (PR-5 §9.5). BullMQ delayed jobs, auto-cancelled
   when the client replies. No consent or provider issues; high value; reuses the send-queue machinery.
2. **Scheduled send — BUILT** (PR-5 §9.5). Same machinery as undo-send, so it is nearly free once the
   send queue exists.
3. **Client-timezone delivery — PARTIALLY BUILT** (PR-5 §9.5). "Send at 09:00 in the recipient's local
   time" is built, driven by a `timezone` column on the party. **"Peak open-rate hours" is not built**
   and cannot be: Q32 removed open tracking, so the data it would need does not exist. This is stated
   in the UI rather than faked.

---

## 2. Scope

### 2.1 What we are building

Twenty-four capabilities, across five PRs, all behind `mail.*` flags:

**PR-0 — Foundation** _(delivered)_. Mailbox kind, one personal mailbox per person enforced in the
database, the seven-slot shared-mailbox catalogue, VIEWER/AGENT/MANAGER grants with an audit trail,
the send-point registry with per-corporate-entity routing that explains itself, origin tagging and
the external-send echo, per-mailbox send throttles and health, the SMTP-only lockdown, and the
Comms → Setup surface. See §4.

**PR-1 — Mail Core & Master Composer.** Thread/message model · six canonical folders with real IMAP
multi-folder sync · full-text search with filters · bulk actions · thread grouping · split inbox
(Human / System) · VIP lane · shared mailboxes · TipTap rich composer with an email-safe serializer ·
attachments in and out (25 MB) · internal document picker · slash commands · server drafts ·
undo-send · offline send queue.

**PR-2 — Identity, Signatures & Deliverability.** Signature template engine (HTML + PNG from one
definition) · ERP-derived fields with governed user overrides · three seeded templates with
department defaults · promotion-aware cache invalidation · department-labelled corporate blocks on
system mail · per-party preferred language · outbound deliverability dashboard (SPF/DKIM/DMARC/MX/
rDNS/RBL) with scheduled re-checks and regression alerts.

**PR-3 — ERP Binding, Smart Dossier & Collaboration.** Confidence-scored binding suggestions (never
automatic) · the `mail-context` right-pane dossier with a hard performance budget · read-only ERP
action cards with honest missing-data handling · internal side-notes · the `@mention` primitive with
an employee picker showing name and role · mention fan-out into chat, notification and push ·
notification dedup · inbound document classification with human approval, filed into Client 360 ·
required-document checklists and the "chase missing documents" composer · one-click entity conversion
with duplicate detection.

**PR-4 — AI Layer.** On-demand generation and rewrite · ten tone presets + five one-click actions ·
EN/FR translation with a protected-terms glossary · fact-fenced ERP-grounded drafting with a visible
sources strip · executive thread summaries · attachment OCR extraction into a review form (never into
the ledger) · voice-to-professional-text · pre-send guardrails · semantic mail search.

**PR-5 — Workflow, Security & Compliance.** Shared-inbox claim/assignment with soft locks · SLA
timers on business hours · Open/Pending/Resolved · follow-up boomerang · scheduled and
recipient-local-time delivery · delegated mailboxes · secure expiring links · hash-chained immutable
archive · Private/Team/Company visibility with audited break-glass · ERP-validated anti-spoofing with
lookalike detection · DSN/bounce handling.

### 2.2 What we are deliberately not building

Each of these was a live idea in the brief and is out of scope by decision, not omission. Do not
"helpfully" add them.

| Not built                                                                    | Decision     | Reason on the record                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read/open tracking pixels, click-tracking link rewriting                     | Q32 = A      | EU counterparties and an EU entity; and open rates are systematically wrong under Apple MPP and image blocking. Secure-link opens carry the real commercial signal. |
| Sentiment badges, churn radar, at-risk escalation                            | Q29 = A      | A model's judgement about a person's mood, displayed to colleagues, on bilingual correspondence.                                                                    |
| Auto-routing by intent; auto-forwarding to departments or external addresses | Q31 = A      | Auto-forwarding is how confidential correspondence leaves a company by accident. Manual claim + SLA delivers the operational outcome.                               |
| Inline "as-you-type" autocomplete                                            | Q25 = A      | Cost per keystroke; on-demand generation delivers most of the value. Revisit with usage data.                                                                       |
| Auto-send of any AI-generated mail                                           | Q24 = A      | No undo exists for a wrong email to a customs broker.                                                                                                               |
| Any AI write to a business table without human review                        | Q28          | Explicit instruction; also the standing rule in `BUILD_CONVENTIONS.md` §5.                                                                                          |
| Posting OCR output to the ledger                                             | Q28          | Nothing from OCR reaches the GL in this programme.                                                                                                                  |
| Gmail / Microsoft 365 feature work                                           | Q4 = A, Q11  | Existing adapters keep working untouched; no new provider-specific paths.                                                                                           |
| Peak-open-hour send optimisation                                             | §1.4         | The data source was removed with telemetry.                                                                                                                         |
| PIN-protected links                                                          | Q33 = A      | Expiry + revocation only; PIN is a v2 extension point already shaped for.                                                                                           |
| Provider-side draft sync                                                     | Q11          | IMAP-only programme.                                                                                                                                                |
| Unbound-thread nudge                                                         | Addition (b) | Declined.                                                                                                                                                           |
| Keyboard-first inbox shortcuts                                               | Addition (g) | v2.                                                                                                                                                                 |

---

## 3. Cross-cutting architecture

### 3.1 Sequencing and merge order

```
PR-0  Foundation (DELIVERED)                 ── mailbox identity, access, routing, origin tagging
        │
PR-1  Mail Core & Master Composer            ── must merge to main before anything else starts
        │
        ├── PR-2  Identity, Signatures & Deliverability   ┐  parallel, near-zero file overlap
        └── PR-3  ERP Binding, Dossier & Collaboration    ┘
                    │
                    ├── PR-4  AI Layer          ┐  parallel; PR-4 needs PR-3's bindings,
                    └── PR-5  Workflow/Security ┘  PR-5 needs PR-3's visibility groundwork
```

**Overlap map** (the files two parallel PRs both touch — coordinate or serialise these):

| File                                             | PR-2                    | PR-3                      | PR-4          | PR-5                          |
| ------------------------------------------------ | ----------------------- | ------------------------- | ------------- | ----------------------------- |
| `src/modules/mail/mail/mail.service.js`          | reads signature at send | binding hooks on ingest   | —             | queue + archive hooks on send |
| `client/src/features/comms/mail/composer/*`      | signature block         | document picker           | AI toolbar    | schedule + guardrail bar      |
| `client/src/features/comms/mail/thread-view.tsx` | —                       | dossier drawer, notes tab | summary strip | verdict banner                |

Rule: each PR adds its own component into a declared slot rather than editing the other's markup.
The composer and thread view expose named slots in PR-1 for exactly this reason (§5.6.6).

### 3.2 ⚠ The module-loader landmine — read before writing a single file

`src/shared/http/module-loader.js` classifies a directory under `src/modules/` as follows:

> _A dir with module SUBFOLDERS is a group (its own `<dir>.routes.js` is **ignored**); a dir with no
> module subfolders but a matching `<dir>.routes.js` is a standalone module._

`src/modules/mail/` is currently a **standalone (flat)** module: `mail.routes.js` lives directly in
it, and `providers/` does not count because there is no `providers/providers.routes.js`.

**The moment anyone adds `src/modules/mail/signature/signature.routes.js`, `mail` becomes a group and
`src/modules/mail/mail.routes.js` is silently ignored — the entire mailbox API 404s with no error at
boot.** This is the single most likely way to lose a day on this programme.

**PR-0 has already done this**, as its own commit, verified contract-neutral before any sub-module
was added. It is kept here because the RULE still applies to every later chapter: anything adding a
directory under `src/modules/mail/` must give it a matching `<name>.routes.js`, and nothing may put a
loose `*.routes.js` back at the group root.

The move that was performed:

```
src/modules/mail/                       src/modules/mail/                  ← now a GROUP
  mail.routes.js                          mail/                            ← the existing module
  mail.controller.js         ───▶            mail.routes.js
  mail.service.js                            mail.controller.js
  mail.repo.js                               mail.service.js
  mail.validator.js                          mail.repo.js
  mail.events.js                             mail.validator.js
  mail.ai.js                                 mail.events.js
  autodiscover.js                            mail.ai.js
  dns-check.js                               autodiscover.js
  smtp-error.map.js                          dns-check.js
  providers/                                 smtp-error.map.js
                                             providers/
                                       (PR-2 adds signature/, PR-3 binding/, PR-4 assist/, PR-5 triage/)
```

`basePath` stays `/mail`, so **no URL changes**. Internal requires go from `../../` to `../../../`.
External references to update (exhaustive, verified by grep):

```
src/jobs/handlers/mail-sync.js            mail.service, mail.repo
src/jobs/handlers/mail-webhook-renew.js   mail.service
src/jobs/mail-idle.js                     mail.repo
src/services/email.service.js             smtp-error.map
src/services/platform/settings.probes.js  smtp-error.map
tests/unit/mail-service.test.js           mail.service, mail.repo, providers/imapSmtp.provider
tests/unit/mail-provider.test.js          providers/imapSmtp.provider
tests/unit/mail-graph.test.js             providers/microsoftGraph.provider
tests/unit/mail-gmail.test.js             providers/gmail.provider
tests/unit/mail-webhook-auth.test.js      mail.service, mail.repo, all providers, autodiscover
tests/unit/mail-setup.test.js             dns-check
tests/integration/mail-imap.test.js       providers/imapSmtp.provider
```

**Acceptance for Task 0:** `npm test` is green and `GET /api/tenant/mail/connections` still answers,
with zero behaviour change in the diff.

### 3.3 Feature flags

All flags are `feature_state` rows in the tenant DB, projected by the Platform Console, checked with
`requireFeature()` on routes and read by the client from the bootstrap payload. **Default `off`
everywhere except the `smartls` tenant, which is seeded `on` for all of them** (Q5).

| Flag                  | Gates                                                                                | PR                                 |
| --------------------- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| `mail.core`           | Threads, folders, search, bulk actions, split inbox                                  | 1                                  |
| `mail.composer`       | Rich editor, attachments, slash commands, drafts, undo-send                          | 1                                  |
| `mail.shared_inbox`   | Shared mailboxes, membership                                                         | 1 (surface) / 5 (assignment + SLA) |
| `mail.signatures`     | Signature engine and admin                                                           | 2                                  |
| `mail.deliverability` | Outbound domain-health dashboard                                                     | 2                                  |
| `mail.binding`        | Binding suggestions, dossier drawer, action cards                                    | 3                                  |
| `mail.notes`          | Internal notes and mentions                                                          | 3                                  |
| `mail.doc_intake`     | Inbound document classification and filing                                           | 3                                  |
| `mail.ai`             | Every AI surface (also under the `ai.assistant.backend` ceiling)                     | 4                                  |
| `mail.followup`       | Boomerang, scheduled send, timezone delivery                                         | 5                                  |
| `mail.secure_links`   | Expiring links                                                                       | 5                                  |
| `mail.archive`        | Hash-chained archive and visibility model                                            | 5                                  |
| `mail.antispoof`      | Inbound verdicts                                                                     | 5                                  |
| `mail.provider.oauth` | Shows the Microsoft/Google connect buttons — **default off in this programme** (Q11) | 1                                  |

**MUST:** an AI flag is a _floor_, not a ceiling. `mail.ai` on with `ai.assistant.backend` off means
AI stays off. Reuse `src/modules/ai/governance/governance.service.js`'s existing two-level check.

### 3.4 RBAC

Mail is **MOD-72**. Team chat is **MOD-64**. They are separate rights and must stay separate
(`mail.routes.js` documents why at length — do not undo it).

| New surface                          | Module                           | Action          | Rationale                                           |
| ------------------------------------ | -------------------------------- | --------------- | --------------------------------------------------- |
| Read threads, folders, search        | MOD-72                           | `view`          |                                                     |
| Send, reply, forward, schedule       | MOD-72                           | `create`        | Produces correspondence                             |
| Mark read, star, move folder, snooze | MOD-72                           | `edit`          | Changes state                                       |
| Bulk delete / archive                | MOD-72                           | `delete`        |                                                     |
| Mailbox connection management        | MOD-72                           | `edit`          | Holds credentials                                   |
| Shared-mailbox membership            | MOD-72                           | `edit`          | Grants others access to mail                        |
| Signature template admin             | MOD-70 (Settings)                | `edit`          | Brand governance                                    |
| Own signature profile                | —                                | authed only     | Personal preference, like `preference`              |
| Internal notes and mentions          | MOD-72                           | `create`        |                                                     |
| Binding accept/reject                | MOD-72                           | `edit`          | Writes onto the CRM timeline                        |
| Document filing from mail            | MOD-64 (Vault)                   | `create`        | The vault owns the document                         |
| Entity conversion                    | The **target** module's `create` |                 | A lead is created under MOD-26's rights, not mail's |
| AI draft/rewrite/summarise           | MOD-72 `view` + `mail.ai`        |                 | Reading and drafting, never sending                 |
| Deliverability dashboard             | MOD-70                           | `view` / `edit` |                                                     |
| Break-glass thread access            | God-Mode role                    | `approve`       | Always writes `immutable_ledger`                    |

**MUST:** a slash command, an action card and an AI read each execute the target module's own service
with the caller's connection and the caller's RBAC. There is no mail-side bypass. (`AI_ARCHITECTURE`
§1, `BUILD_CONVENTIONS` §5.)

### 3.5 Provider policy — IMAP-first (Q4, Q11)

`providers/provider.interface.js` already exposes `capabilities()` returning
`{push, delta, serverThreads, appendSent}`. Extend it with:

```js
capabilities() {
  return {
    push: false, delta: false, serverThreads: false, appendSent: true,   // existing
    folders: true,          // can enumerate + select folders            (IMAP: yes)
    folderMove: true,       // can MOVE a message between folders        (IMAP: yes)
    serverFlags: true,      // \Seen \Flagged \Answered are server-side  (IMAP: yes)
    serverDrafts: false,    // can APPEND to Drafts                      (not used this programme)
    serverSearch: false,    // provider-side search                      (we use Postgres FTS)
  };
}
```

Rules:

1. **IMAP/SMTP is the reference implementation and the CI target.** Every feature has a defined,
   tested IMAP behaviour. Smart Logistics runs cPanel IMAP/SMTP; that is what must work.
2. **Graph and Gmail adapters MUST keep passing their existing tests.** Do not delete them, do not
   refactor them beyond the mechanical moves in §3.2, and do not add provider-specific paths for
   them. They get the generic path where their capabilities allow.
3. Where a capability is absent, the UI shows a specific, non-apologetic state — _"Moving messages
   isn't available for this mailbox type"_ — never a disabled button with no explanation, and never a
   button that silently does nothing.
4. `mail.provider.oauth` ships **off**, hiding the Microsoft/Google connect buttons from the setup UI
   for the duration of this programme.

### 3.6 Performance budgets (addition e, and it is a gate not a wish)

| Path                                                    | p95 target                  | Enforcement                                                                                                                                     |
| ------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /mail/threads` (50 rows, folder + filters)         | **250 ms**                  | Integration test asserts the query plan uses the covering index; `EXPLAIN` snapshot test                                                        |
| `GET /mail/threads/:id` (messages + attachments)        | **200 ms**                  |                                                                                                                                                 |
| `GET /mail/search?q=`                                   | **400 ms**                  | GIN index on `tsvector`                                                                                                                         |
| **`GET /mail/context?thread_id=`** (the dossier drawer) | **300 ms cold, 50 ms warm** | Dedicated aggregator, single round trip, 60 s per-entity cache; a CI test fails the build if the endpoint issues more than **6** SQL statements |
| `POST /mail/send` (excluding SMTP)                      | **150 ms**                  | Send is enqueued, not synchronous                                                                                                               |
| Composer keystroke → render                             | **16 ms**                   | No network on keypress                                                                                                                          |

The `mail-context` endpoint is the one users feel on every single click. It **MUST NOT** call
`party-360.service.js` — that service computes far more than the drawer shows. It gets its own
aggregator with its own SQL (§7.5).

### 3.7 Testing and CI gates

The repo runs ~1,400 tests and gates on `npm run ci`. This programme adds (addition h):

| Test                               | File                                            | Asserts                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider capability matrix         | `tests/unit/mail-capabilities.test.js`          | Every adapter returns every capability key; no feature calls an adapter method its capabilities deny                                                                     |
| Outbound HTML snapshot             | `tests/unit/mail-html-serializer.test.js`       | Editor JSON → email HTML is table-based, fully inline-styled, has no `<style>` block, no external CSS, ≤ 102 KB (Gmail's clip threshold), and a matching plain-text part |
| **Notes never leave the building** | `tests/security/mail-notes-containment.test.js` | For every outbound path (`send`, `reply`, `forward`, scheduled flush, AI draft), a thread carrying internal notes produces a body containing none of them                |
| Fact fence                         | `tests/unit/mail-ai-factfence.test.js`          | A draft containing a date/reference/amount absent from the retrieved facts is rejected                                                                                   |
| Binding is suggest-only            | `tests/unit/mail-binding.test.js`               | Ingest writes a suggestion row and **never** sets `entity_ref` while auto-accept is off                                                                                  |
| Context budget                     | `tests/integration/mail-context-budget.test.js` | ≤ 6 SQL statements, and a warm call under the cache                                                                                                                      |
| Search correctness                 | `tests/integration/mail-search.test.js`         | FTS finds by subject, body, participant; respects folder and visibility filters                                                                                          |
| Multi-folder sync                  | `tests/unit/mail-folder-sync.test.js`           | UIDVALIDITY reset per folder re-scans only that folder                                                                                                                   |
| Visibility                         | `tests/security/mail-visibility.test.js`        | A Private thread is invisible to a colleague with MOD-72 view; break-glass writes a ledger row                                                                           |
| Archive chain                      | `tests/unit/mail-archive-chain.test.js`         | Tampering with an archived body breaks chain verification                                                                                                                |
| Anti-spoof                         | `tests/unit/mail-antispoof.test.js`             | Lookalike domains at Levenshtein ≤ 2 and homoglyph substitutions are caught                                                                                              |
| Signature render                   | `tests/unit/mail-signature.test.js`             | Same template → HTML and PNG agree on content; promotion invalidates the cache; history is unchanged                                                                     |

Also required, per existing repo gates: `npm run db:check:idempotency` (every new migration must be
re-runnable), `npm run db:check:columns` (no query references a column that does not exist), and the
frontend's `check:contrast`, `check:motion`, `check:bundle`, `check:palette`, `check:docs`.

**Bundle note:** TipTap plus extensions is the largest addition to the client bundle in this
programme. It **MUST** be lazy-loaded with the composer (`React.lazy`), never in the main chunk, or
`npm run check:bundle --prefix client` will fail — correctly.

### 3.8 Migrations

Forward-only, idempotent (`IF NOT EXISTS` / guarded `DO $$`), numbered above the current maximum
(`10722` — PR-0 was renumbered from `10721` when procurement's own `10721`/`10722` landed on
`main` first; see the note below). Reserved ranges, so parallel PRs never collide:

| PR   | Range                                   |
| ---- | --------------------------------------- |
| PR-0 | `10723`–`10730` (all eight used)      |
| PR-1 | `10731`–`10739`                         |
| PR-2 | `10740`–`10744`                         |
| PR-3 | `10745`–`10749`                         |
| PR-4 | `10750`–`10754`                         |
| PR-5 | `10755`–`10764`                         |

Every migration ends with a commented-out rollback block, as the existing files do.

**Reserving a range does not reserve it on `main`.** PR-0 was written against `10721`–`10728` and had
to be renumbered to `10723`–`10730` before it merged, because a procurement PR landed `10721` and
`10722` while it was in flight. `check-migration-numbers.js` catches the collision, but only once
both are on the same branch — so **rebase or merge `main` before the final push and re-check the
numbering**, rather than trusting the range table. The table says which range a PR should *aim* at;
`main` says what is actually free.

### 3.9 Internationalisation

EN and FR at parity (Q26), through the existing `tr()` / i18next setup. Three distinct language
axes, and they must not be conflated:

1. **UI language** — the operator's own preference (existing).
2. **Recipient language** — `party.preferred_language` (PR-2, addition d): drives signature variant,
   template selection and AI translation defaults.
3. **Message language** — detected per inbound message, shown as a badge, used to seed reply language.

---

## 4. PR-0 — Foundation: mailbox identity, access and routing · **DELIVERED**

> **Goal.** Establish what a mailbox IS before anything is built on it: whose it is, which team
> address it fulfils, who may work it, which part of the product sends from it, how hard it may be
> pushed, and whether a message in the Sent folder was sent from here or from somebody's phone.

**Status:** built, tested and merged. This chapter records what shipped, because PR-1 through PR-5
are written against it. **Flags:** all fourteen `mail.*` keys, seeded off.
**Migrations:** `10723`–`10730`. **Depends on:** nothing.

### 4.1 Why PR-0 exists

The original plan started at PR-1 and assumed a mailbox model rather than establishing one. Three
things made that untenable:

1. **`email_connection` had no notion of what a mailbox is for.** It carried an owner and a "default"
   flag, so one person could own any number of mailboxes and nothing said whether an address was a
   person's or a team's. Every later chapter — shared inboxes, visibility, delegation, routing —
   needed that distinction, and retrofitting it after PR-1's thread/message rework would have meant
   two migrations over the same rows.
2. **Origin tagging cannot be added late.** Whether a message was sent from Praxis is stamped into
   the message at send time or it is never known. Every week that waited was a week of mail that
   could only ever be `UNKNOWN`.
3. **The module-loader landmine** (§3.2) had to be cleared before any sub-module could be added.

### 4.2 The ten decisions

| #   | Question                      | Decision                                                                                                                                                                                                                               |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | One personal mailbox per user | Database constraint plus a UI handover action. Offboarding archives; converting a personal mailbox to shared is deliberate, never automatic.                                                                                           |
| 2   | The shared-mailbox catalogue  | **Seven** seeded slots: Operations (with documents, customs, fleet and warehouse folded in), Billing, Sales, Support, Procurement & Accounts, Human Resources (with careers), General Enquiries. Free-form entries allowed. No Claims. |
| 3   | Access model                  | VIEWER / AGENT / MANAGER, granted through the employee picker, audited, auto-revoked on deactivation.                                                                                                                                  |
| 4   | Gmail and Microsoft           | Kept, tested, and gated off behind `mail.provider.oauth`. Hidden in the UI **and** refused server-side.                                                                                                                                |
| 5   | Send-point routing            | A full registry with **per-corporate-entity overrides**, and a resolution that explains itself.                                                                                                                                        |
| 6   | Origin tagging                | `X-Praxis-*` headers plus our own Message-ID; `PRAXIS` / `EXTERNAL` / `UNKNOWN`.                                                                                                                                                       |
| 7   | Where the setup lives         | **All of it in Comms**, in sub-tabs. Nothing moved to Settings.                                                                                                                                                                        |
| 8   | Setup experience              | Two flows from one engine, with a cPanel preset.                                                                                                                                                                                       |
| 9   | Limits                        | Per-mailbox hourly and daily send caps with spillover, 90-day default sync depth, visible health.                                                                                                                                      |
| 10  | Requirements register         | Not built — the audit is read by a human.                                                                                                                                                                                              |

### 4.3 What shipped

**Schema (`10723`–`10730`).** Connection `kind` (PERSONAL / SHARED / DELEGATED), `visibility`,
`entity_id`, `catalogue_key`, `department`, ARCHIVED status and health counters, with
`ux_email_connection_one_personal` as the actual rule. The seven-entry catalogue. Membership with
roles, revocation-as-a-row, and an access audit table. The send-point registry: 22 declared send
points, 9 of them wired to real callers today, bindable per entity, with the existing
`email_section_binding` rows carried across so no routing changed. Origin columns on `email_inbound`.
Throttle columns and the hourly counter table. Eight event types. The `mail` settings section and all
fourteen flags.

**Backend.** Three pure modules — `origin.js`, `limits.js` and the health rollup — plus `access.js`
(the predicates the engine calls before it sends, in their own file so mail.service and
mailbox.service cannot form a require cycle), `mailbox.service.js` (lifecycle) and
`sendpoint.service.js` (routing that returns a sentence explaining itself). 19 endpoints under
`/mail`, all MOD-72.

**Engine changes.** `connect()` enforces the one-personal rule and the provider lockdown.
`send()`/`reply()` check access, then the rate limit, then stamp the origin headers; sending as a
shared mailbox writes a `SENT_AS` row naming the human. `syncConnection()` reads direction off the
message rather than assuming inbound, so a Sent-folder copy is classified by its stamp — this is the
echo. `email.service.resolveMail` gained send-point resolution as the most specific tier, above the
existing section and purpose tiers and below nothing, so it can re-route nothing that already worked.

**Frontend.** Comms → Setup with four sub-tabs, gated by a server-computed capability rather than by
guessing from readable modules.

### 4.4 What PR-1 through PR-5 must now assume

- **A mailbox has a kind.** Do not add one. `PERSONAL` mailboxes have no members; the owner is the
  access. Shared and delegated ones go through `access.js`.
- **Binding suggestions in PR-3 write to a new table, not to `entity_ref` on ingest.** PR-0 left
  `mail.service.autoLink` as it was; PR-3 replaces it (§7.2).
- **PR-1's thread/message backfill MUST carry the four origin columns across.** Losing
  `origin_user_id` would make every shared-mailbox send anonymous retroactively.
- **PR-1's send queue must call `mailbox.checkSendAllowance` before it flushes,** or the throttle is
  bypassed by the very path that most needs it — a bulk run.
- **PR-5's visibility work extends a column that already exists.** `email_connection.visibility` is
  on the row with the right defaults; PR-5 adds the thread-level column, the predicate and
  break-glass, not the concept.
- **PR-2's signature engine resolves the sender through the send-point registry,** not through
  `email_identity` directly.

### 4.5 Verification performed

Against PostgreSQL 16: the platform database migrated, a tenant provisioned from nothing, and all
sixteen files (live + sandbox) force-re-applied against the already-populated database with no error
and no duplicated seed rows. A scripted end-to-end pass proved the database refuses a second personal
mailbox and the service refuses it first with a sentence; a VIEWER may read and may not send; a
personal mailbox cannot be granted to anyone; an entity binding beats a tenant binding without
disturbing it; the hourly cap holds a send and reports when it resumes; handover converts and
re-grants; offboarding revokes. 3904 backend tests and 1529 client tests pass, and every static gate
is green.

---

## 5. PR-1 — Mail Core & the Master Composer

> **Goal.** Turn `/comms/mail` from a message list into a mail client an operator would choose over
> Outlook: real threads, six folders, search, bulk actions, a split inbox, shared mailboxes, and a
> composer with formatting, attachments, document insertion and slash commands — with drafts,
> undo-send and an offline queue so nothing is ever lost.

**Flags:** `mail.core`, `mail.composer`, `mail.shared_inbox` (surface only), `mail.provider.oauth` (off).
**Migrations:** `10731`–`10739`. **Depends on:** nothing. **Blocks:** everything else.

### 5.0 PR-1 SHIPS AS TWO PULL REQUESTS · **1A DELIVERED, 1B NEXT**

PR-1 was specified as one pull request and is being built as two. The split was judged necessary on
review of the actual diff, and the reasoning is recorded here because "we split it" is the kind of
decision that later reads as drift unless the argument survives with it.

|          | PR-1A — the model                                                                                                        | PR-1B — the composer                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Contains | thread/message model + backfill · folders + per-folder cursors · per-user state · labels, stars · FTS search · bulk actions · the human/machine split · the inbox, rail and conversation view | TipTap + the email-safe serializer · attachments both ways · drafts · send queue · undo-send · offline · slash commands · vault document picker |
| Risk     | a one-way data migration over every stored message                                                                       | a large new dependency and a bundle-size gate                                                     |
| Status   | **delivered** (migrations `10731`–`10736`)                                                                               | next                                                                                              |

**Why split.** Five reasons, in the order they carried weight:

1. **The model cut-over is the single riskiest change in the programme** and it deserves to be
   reviewed, merged and — if necessary — reverted on its own. A revert that also takes out a text
   editor is a revert nobody wants to perform at the moment they need to.
2. **File overlap is near zero.** 1A is the schema, the engine and a read surface; 1B is a composer
   and its plumbing. Two reviewers can hold each in their head.
3. **1A is independently shippable.** An inbox with folders, search, triage and bulk actions is a
   usable product on its own; a composer with no conversation model to compose into is not.
4. **TipTap is a bundle-gate risk** (`check:bundle`, `check:motion`) and belongs where it can be
   dealt with on its own rather than alongside a migration.
5. **Combined, the diff would exceed PR-0's already-heavy 67-file review.** PR-0 was accepted as
   heavy because the foundation had to land whole. This does not have to.

### 5.0.1 What PR-1A actually shipped, and what changed from this specification

The sections below (§5.2 onwards) are the specification as written. Three things were built
differently, each for a reason found during the build:

- **`email_inbound` becomes `email_inbound_legacy` — there is NO compatibility view.** §5.2 specifies
  a view. A view is not insertable, so every writer would have needed changing anyway; all the
  readers are ours and were changed in the same commit; and the view's `is_read` could only have been
  `bool_or(is_read)` over the per-user state rows — which is exactly the mailbox-wide read flag the
  migration exists to remove. A compatibility layer that reintroduces the defect it is compatible
  with is worse than no compatibility layer.
- **The folder sync cursor is PER FOLDER, not per connection.** UIDVALIDITY is a per-mailbox value in
  IMAP. One cursor shared across folders makes a renumber in Spam look like a renumber in Inbox and
  re-downloads the wrong folder — so `email_folder.sync_cursor` carries it and
  `email_connection.sync_cursor` is no longer read by the loop.
- **Migration `10736` was added** (party e-mail lookup indexes) — not in the original range plan, but
  inside PR-1's reserved `10731`–`10739`. See the bug list below.

**Four bugs the database found that no static check could have.** The unit tests mock the repo, so
`thread.repo.js`'s SQL had never executed. Running every one of its queries against a freshly
provisioned tenant surfaced:

1. **`unaccent` landed in the tenant schema, not `public`.** Tenant migrations run with
   `search_path = <schema>,public`, so `CREATE EXTENSION IF NOT EXISTS unaccent` created it in `live`
   — and `unaccent_safe`'s hardcoded `public.unaccent(t)` did not exist. Its own
   `EXCEPTION WHEN OTHERS` handler swallowed the error and returned the text unfolded. Nothing
   failed, nothing logged, and accent folding was simply absent. `10733` now asks for the extension
   in `public` explicitly **and** builds the wrapper with whatever schema it actually occupies.
   *General lesson for every later PR: a guarded `EXCEPTION WHEN OTHERS` around a schema-qualified
   call turns a wiring mistake into silence.*
2. **The QUERY side was not folded either.** `Déclaration` is stored as the token `declaration`, but a
   user typing the word the way French actually spells it produced `déclaration` and matched nothing.
   Both sides go through `unaccent_safe` now.
3. **Known-party lookup compared `email = $1`, case-sensitively.** Addresses arrive as the sender's
   client wrote them — `Client@Maersk.CM` is an ordinary From line — so the override that keeps a
   client's mail out of the System stream silently did not fire. Both lookups fold case; `10736` adds
   the functional indexes so the ingest hot path stays an index scan.
4. **Moving a conversation to a folder the server never advertised** left its messages in a folder the
   rail could not draw, which to a user is indistinguishable from deleted mail.
   `ensureCanonicalFolder` guarantees the row before the move.

**What PR-1B must now assume.**

- **A conversation is the unit.** Compose, reply and forward all key on `email_thread_id`. The
  composer's draft rows reference the thread, not a message.
- **Read state is per user.** A draft or a send must not write `is_read` anywhere except through
  `thread.repo.setThreadRead(client, userId, …)`.
- **`recordOutbound` already exists and already threads.** A sent message joins (or starts) a
  conversation and lands in SENT immediately, and the dedup index absorbs the copy the Sent-folder
  sync brings back a minute later. The send queue calls it; it does not reimplement it.
- **The send queue must call `mailbox.checkSendAllowance` before it flushes** (PR-0, §4.4) — the
  throttle is bypassed by exactly the path that most needs it otherwise.
- **The thread view has a footer reserved for the composer** and says so on screen rather than
  rendering an empty region.
- **The old flat surfaces are still mounted**: `GET /mail/thread` and the "Message log" tab. PR-1B
  deletes both once nothing calls them.

### 5.0.2 What PR-1B shipped, and what changed from this specification

Migrations `10737`–`10739`. Six things were built differently from §5.2/§5.5/§5.6, each for a reason
found during the build:

- **`erpBlock` carries NODES, not an `attrs.html` string.** §5.6.4 has a slash command render HTML at
  insert time and the serializer emit it. That is an HTML injection straight through: a TipTap
  document arrives in a request body, so anyone who can POST a draft could put anything in that
  string and have it sent as the company. Putting a sanitizer in front of it would be filtering a
  hole we dug ourselves. A command now returns a subtree, rendered by the same escaped path as
  everything the user typed. *General rule for PR-2 to PR-5: nothing you add to a document may be
  emitted as markup. If your feature needs rich output, emit nodes.*
- **Outbound sanitisation narrowed to the quoted history.** §5.6.2 sanitises the whole output. After
  the erpBlock change, everything the serializer builds is escaped by construction and the only
  fragment that came from outside is the other party's stored `body_html`. Sanitising our own shell
  on every send is a parse we do not need.
- **`email_attachment.email_inbound_id` renamed to `email_message_id`.** It stopped meaning what it
  says when PR-1A re-pointed its FK. Renamed with six call sites rather than sixty.
- **An attachment belongs to a draft OR a message, enforced by a CHECK.** §5.2's
  `email_draft.attachment_ids uuid[]` would have been a second, unconstrained record of the same
  relationship — and an array column cannot express "exactly one owner" or cascade correctly.
- **The queue re-checks the send throttle at flush**, not only at enqueue. A burst can be individually
  under the cap and collectively over it, and only the flusher can see that.
- **A permanent refusal is not retried at all.** §5.5.5 says "retry with backoff up to 3". Trying a
  rejected sender address three times does not make it work; it delays telling someone something only
  they can fix and burns three more entries in the mail host's abuse log. Transient failures back off
  30s / 2min / 8min; a 422/413 or a `SENDER_NOT_AUTHORIZED`-class code goes straight to FAILED.

**The guide's suggested module keys for the slash commands were five-sixths wrong.** §5.6.4 lists
MOD-46 for invoice, MOD-45 for proforma, MOD-27 for quotation, MOD-40 for costing, MOD-55 for
purchase order. Checked against `platform.module_catalogue`: MOD-46 is Project Costing, MOD-45 is
Incident & Claim Management, MOD-40 is Compliance & Periodic Expenses, MOD-55 is OHADA Journal
Entries. The real keys are **MOD-51** Final Invoice, **MOD-50** Proforma, **MOD-27** Quotation,
**MOD-46** Costing, **MOD-60** Purchase Orders, **MOD-29** Operations File, MOD-64 vault, MOD-09
treasury. A key absent from the catalogue has grants for nobody and 403s every non-CEO user, and it
presents as a permissions problem rather than a typo — so `commands.service.validateManifest()` now
checks, and a test fails on one. *Verify a module key against the catalogue before using it anywhere.*

**Two silent data-loss bugs the database found.** The unit tests mock the repo, so a smoke that runs
every query against a real tenant was the only thing that could catch these:

1. A **partial autosave wiped the fields it did not send**. The composer saves the field that changed;
   an UPDATE writing every column cleared the recipients and the mailbox every time someone edited
   the subject, invisibly until a message was addressed to nobody. The SET clause is now built from
   the keys present — `undefined` means "not provided", `null` and `[]` mean "clear it".
2. `saveDraft` **nulled the body** on every subject-only save, for the same reason one level up.

**Two accessibility findings, both from the gates.** `aria-activedescendant` on the slash menu's
listbox announces nothing — it is only honoured on the element that has focus, which is the editor;
it is written onto the editor's DOM node instead. And `aria-expanded` is invalid on `role="textbox"`
(axe caught it): only `combobox` may carry it, and re-roling a rich-text editor to buy one attribute
is the wrong trade. `aria-controls` is global and stays.

**TipTap is kept out of the vendor chunk.** `isEditorPackage` in `client/vite.config.ts` excludes
`@tiptap/*` and `prosemirror-*` so Rollup attaches them to the dynamic import that pulls them — the
composer is behind `React.lazy`, and ~150 kB gzipped of editor on the login screen for people who
never compose an email is not a trade worth making. Verified from `dist/`: the editor chunk is
reached only by an `import()` from the mail chunk and never from the HTML entry.

**Extension slots exist and are the only way PR-2 to PR-5 should add composer UI:**
`composer.toolbar.right`, `composer.footer.left`, `composer.footer.right`, `composer.presend`.

### 5.1 Scope

**In.** Task 0 restructure · thread/message model with backfill · six canonical folders + multi-folder
IMAP sync · per-user message state · labels/stars · Postgres FTS search with filters · bulk actions ·
split inbox and VIP lane · shared mailbox kind + membership · TipTap composer + email-safe serializer ·
outbound attachments (25 MB) + internal document picker · slash-command registry · server drafts ·
undo-send · offline send queue · composer and thread-view extension slots.

**Out.** Signatures (PR-2) · binding UI and the dossier drawer (PR-3) · any AI (PR-4) · assignment,
SLA, scheduling, secure links (PR-5) · provider draft sync · Gmail/Graph feature work.

### 5.2 Migrations

#### `10731_mail_thread_message.sql` — the model cut-over

Creates the new spine and backfills from `email_inbound`, which becomes a compatibility **view** so
`mail.ai.js`, `clientTimeline`, the 360 pages and any external reader keep working unchanged.

```sql
CREATE TABLE IF NOT EXISTS email_thread (
  email_thread_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_connection_id uuid NOT NULL REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  thread_key          text NOT NULL,              -- provider thread id, else References[0]/Message-Id
  subject             text,
  participants        citext[] NOT NULL DEFAULT '{}',
  message_count       integer NOT NULL DEFAULT 0,
  unread_count        integer NOT NULL DEFAULT 0,
  has_attachment      boolean NOT NULL DEFAULT false,
  stream              text NOT NULL DEFAULT 'HUMAN' CHECK (stream IN ('HUMAN','SYSTEM')),
  is_vip              boolean NOT NULL DEFAULT false,
  entity_ref          text,                       -- set only by an ACCEPTED binding (PR-3)
  first_message_at    timestamptz NOT NULL DEFAULT now(),
  last_message_at     timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_connection_id, thread_key)
);

CREATE TABLE IF NOT EXISTS email_message (
  email_message_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_thread_id     uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  email_connection_id uuid NOT NULL REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  email_identity_id   uuid REFERENCES email_identity(email_identity_id),
  external_message_id text,
  message_id_header   text,                       -- RFC Message-ID, for threading + DSN correlation
  direction           text NOT NULL CHECK (direction IN ('IN','OUT')),
  folder              text NOT NULL DEFAULT 'INBOX'
                        CHECK (folder IN ('INBOX','SENT','DRAFTS','SPAM','ARCHIVE','TRASH')),
  provider_folder     text,                       -- the raw provider path, for round-tripping
  from_address        citext NOT NULL,
  from_name           text,
  to_address          citext[] NOT NULL DEFAULT '{}',
  cc_address          citext[] NOT NULL DEFAULT '{}',
  bcc_address         citext[] NOT NULL DEFAULT '{}',
  reply_to            citext,
  subject             text,
  body_html           text,
  body_text           text,
  body_preview        text,
  in_reply_to         text,
  references_header   text[],
  size_bytes          bigint,
  language            text,                       -- detected, §3.9 axis 3
  headers             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- selected headers only, never the full blob
  received_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_message_dedup
  ON email_message(email_connection_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_email_message_thread ON email_message(email_thread_id, received_at);

-- Per-user state. This is the reason for the whole rework: a shared mailbox needs
-- "read by Marie, unread by Paul", which a single boolean cannot express.
CREATE TABLE IF NOT EXISTS email_message_state (
  email_message_id uuid NOT NULL REFERENCES email_message(email_message_id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  is_read          boolean NOT NULL DEFAULT false,
  is_starred       boolean NOT NULL DEFAULT false,
  read_at          timestamptz,
  PRIMARY KEY (email_message_id, user_id)
);

-- The thread list is the hottest query in the product. This index carries it.
CREATE INDEX IF NOT EXISTS ix_email_thread_list
  ON email_thread(email_connection_id, stream, last_message_at DESC)
  INCLUDE (subject, message_count, unread_count, has_attachment, is_vip);
```

**Backfill** (inside the same migration, guarded so a re-run is a no-op): group `email_inbound` by
`(email_connection_id, COALESCE(thread_key, external_message_id, email_inbound_id::text))` into
threads, copy each row into `email_message` (mapping `direction='OUT'` → `folder='SENT'`, else
`'INBOX'`), and materialise `email_message_state` for the connection owner from the old `is_read`.

**Then** rename the table and put a view in its place:

```sql
ALTER TABLE email_inbound RENAME TO email_inbound_legacy;
CREATE OR REPLACE VIEW email_inbound AS
  SELECT m.email_message_id AS email_inbound_id, m.email_connection_id, m.email_identity_id,
         m.external_message_id, t.thread_key, m.direction, m.from_address,
         array_to_string(m.to_address, ', ') AS to_address, m.subject, m.body_preview,
         m.body_html, m.body_text, m.in_reply_to, t.entity_ref,
         COALESCE(bool_or(s.is_read), false) AS is_read, m.received_at
    FROM email_message m
    JOIN email_thread t USING (email_thread_id)
    LEFT JOIN email_message_state s USING (email_message_id)
   GROUP BY m.email_message_id, t.thread_key, t.entity_ref;
```

`email_attachment.email_inbound_id` is repointed to `email_message_id` with the same values (ids are
carried across in the backfill), and the FK re-targeted.

> **MUST:** run `npm run db:check:columns` after this migration. It is the gate that catches any
> query still selecting a column the view does not expose.

#### `10732_mail_folders_labels.sql`

Per-connection folder map (canonical → provider path + per-folder UIDVALIDITY cursor), user labels,
and the message↔label join.

```sql
CREATE TABLE IF NOT EXISTS email_folder (
  email_folder_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_connection_id uuid NOT NULL REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  canonical           text CHECK (canonical IN ('INBOX','SENT','DRAFTS','SPAM','ARCHIVE','TRASH')),
  provider_path       text NOT NULL,
  display_name        text,
  is_syncable         boolean NOT NULL DEFAULT true,
  sync_cursor         jsonb,          -- {uidvalidity, last_uid} PER FOLDER, never one global cursor
  last_sync_at        timestamptz,
  last_error          text,
  UNIQUE (email_connection_id, provider_path)
);
CREATE TABLE IF NOT EXISTS email_label (
  email_label_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name  text NOT NULL, colour text, owner_user_id uuid REFERENCES app_user(user_id),
  UNIQUE (name, owner_user_id)
);
CREATE TABLE IF NOT EXISTS email_thread_label (
  email_thread_id uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  email_label_id  uuid NOT NULL REFERENCES email_label(email_label_id)  ON DELETE CASCADE,
  PRIMARY KEY (email_thread_id, email_label_id)
);
```

> **Why per-folder cursors.** The existing single `email_connection.sync_cursor` holds one
> `{uidvalidity, last_uid}`. UIDVALIDITY is a **per-mailbox** value in IMAP — sharing one cursor
> across six folders means a reset on Spam triggers a full re-scan of Inbox. This is the correctness
> heart of multi-folder sync.

#### `10733_mail_search.sql`

```sql
ALTER TABLE email_message ADD COLUMN IF NOT EXISTS search_tsv tsvector;
-- Generated in a trigger rather than GENERATED ALWAYS, because the source columns
-- are large and the weights differ: subject and participants must outrank body.
CREATE INDEX IF NOT EXISTS ix_email_message_tsv ON email_message USING GIN (search_tsv);
```

Trigger builds `setweight(to_tsvector('simple', subject),'A') || setweight(from/to,'B') ||
setweight(body_text,'C')`. Dictionary is `'simple'`, not `'english'` — the corpus is bilingual and
stemming French with an English dictionary is worse than not stemming.

#### `10734_mail_outbound_attachment.sql`

Generalises `email_attachment` to both directions, adds inline/`cid:` support and content-disposition,
and adds a composed-attachment staging table used before a draft is sent.

#### `10735_mail_draft_and_queue.sql`

```sql
CREATE TABLE IF NOT EXISTS email_draft (
  email_draft_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  email_connection_id uuid REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  reply_to_message_id uuid REFERENCES email_message(email_message_id) ON DELETE SET NULL,
  kind            text NOT NULL DEFAULT 'NEW' CHECK (kind IN ('NEW','REPLY','REPLY_ALL','FORWARD')),
  to_address citext[] NOT NULL DEFAULT '{}', cc_address citext[] NOT NULL DEFAULT '{}',
  bcc_address citext[] NOT NULL DEFAULT '{}',
  subject         text,
  body_json       jsonb,        -- TipTap document — the editable truth
  body_html       text,         -- serialized email HTML — what would be sent
  attachment_ids  uuid[] NOT NULL DEFAULT '{}',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reply_to_message_id, kind)   -- one live draft per user per reply target
);

CREATE TABLE IF NOT EXISTS email_send_queue (
  email_send_queue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_connection_id uuid NOT NULL REFERENCES email_connection(email_connection_id),
  user_id         uuid NOT NULL REFERENCES app_user(user_id),
  payload         jsonb NOT NULL,     -- the fully composed message
  status          text NOT NULL DEFAULT 'HELD'
                    CHECK (status IN ('HELD','QUEUED','SENDING','SENT','FAILED','CANCELLED')),
  release_at      timestamptz NOT NULL,   -- now()+undo window, or a scheduled time (PR-5)
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  sent_message_id uuid REFERENCES email_message(email_message_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_send_queue_due
  ON email_send_queue(release_at) WHERE status IN ('HELD','QUEUED');
```

#### ~~Connection kind and membership~~ — **delivered by PR-0**

This was to be PR-1's migration. **PR-0 shipped it** as `10723` (kind, visibility, owning entity,
ARCHIVED status, and the one-live-personal-mailbox unique index) plus `10725` (membership with
VIEWER / AGENT / MANAGER and an access audit trail). Two differences from the sketch that was
planned here, both deliberate:

- the member roles are **VIEWER / AGENT / MANAGER**, not OWNER / MEMBER / VIEWER, because reading a
  team's mail and sending as it are different rights and "member" collapsed them;
- revocation is a `revoked_at` column rather than a `DELETE`, so "who could see billing@ in March"
  stays answerable — which PR-5's compliance work needs.

PR-1 therefore adds no migration here. `visibility` is already on the row and defaults
`PERSONAL → PRIVATE`, `SHARED → TEAM`; PR-5 adds the enforcement (§9.5), not the column.

#### `10736_mail_stream_rules.sql`

Tenant-editable classification rules for the split inbox, plus the VIP source.

```sql
CREATE TABLE IF NOT EXISTS email_stream_rule (
  email_stream_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_kind text NOT NULL CHECK (match_kind IN ('HEADER','FROM_ADDRESS','FROM_DOMAIN','SUBJECT_REGEX')),
  match_key   text, match_value text NOT NULL,
  stream      text NOT NULL CHECK (stream IN ('HUMAN','SYSTEM')),
  priority    integer NOT NULL DEFAULT 100,
  is_system   boolean NOT NULL DEFAULT false,     -- seeded rules, not user-deletable
  created_by  uuid REFERENCES app_user(user_id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE client_master   ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false;
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false;
```

Seeded system rules (`is_system = true`): `Auto-Submitted != no`, `Precedence: bulk|junk|list`,
presence of `List-Unsubscribe`, `X-Auto-Response-Suppress`, `Content-Type: multipart/report`,
`Return-Path: <>`, and the address patterns `no-?reply@`, `mailer-daemon@`, `postmaster@`,
`bounce*@`, `cron@`, `root@`.

#### `10737_mail_events.sql`

New `event_type` rows: `email.thread.created`, `email.message.moved`, `email.send.queued`,
`email.send.cancelled`, `email.send.failed`, `email.attachment.stored`.

#### ~~Feature flags~~ — **delivered by PR-0**

All fourteen `mail.*` keys are seeded off by PR-0's `10730`, along with the `mail` settings section
that holds the tenant-wide defaults. PR-1 turns `mail.core` and `mail.composer` on for the pilot
tenant from the Platform Console; it does not add a migration.

### 5.3 Backend layout

```
src/modules/mail/                     ← now a GROUP (see §3.2)
  mail/
    mail.routes.js        + folders, threads, search, bulk, drafts, queue, members
    mail.controller.js
    mail.service.js       existing engine + thread assembly, send-queue entry points
    mail.repo.js          existing + thread/message/state/folder/label/draft/queue SQL
    mail.validator.js     + zod schemas for every new endpoint
    mail.events.js        + the new keys
    mail.ai.js            unchanged in PR-1
    mail.folders.js       NEW — canonical folder mapping + discovery per provider
    mail.threading.js     NEW — pure: message headers → thread_key + participants
    mail.stream.js        NEW — pure: headers + party lookup → HUMAN | SYSTEM + reason
    mail.search.js        NEW — query parsing (from:, has:attachment, folder:, before:) → SQL
    mail.commands.js      NEW — the slash-command manifest (§5.6.4)
    mail.compose.js       NEW — TipTap JSON → email HTML + text serializer (server-side truth)
    autodiscover.js  dns-check.js  smtp-error.map.js  providers/
src/jobs/handlers/
  mail-sync.js            reworked: iterate folders, per-folder cursors
  mail-send-flush.js      NEW — releases due email_send_queue rows
  mail-send-flush-scheduler.js  NEW
```

**Why `mail.threading.js`, `mail.stream.js` and `mail.compose.js` are pure modules.** They are the
three places where a subtle bug is expensive and a unit test is cheap. Keeping them free of I/O means
the tests in §5.9 run in milliseconds and cover the real logic rather than a mock of it — the same
reasoning `entity-letterhead.service.js` documents for itself.

### 5.4 Endpoints

All under `/api/tenant/mail`, all behind `authMiddleware` + `requirePermission("MOD-72", …)` +
`requireFeature("mail.core"|"mail.composer")`.

| Method | Path | Action | Purpose |
| ------ | --------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---- | ---- | ----- | -------- |
| GET | `/folders?connection_id=` | view | Canonical + user folders with unread counts |
| POST | `/folders/refresh` | edit | Re-discover the provider's folder list |
| GET | `/threads` | view | Paged thread list. Filters: `connection_id`, `folder`, `stream`, `label`, `starred`, `unread`, `has_attachment`, `vip`, `q`, `before`, `limit` |
| GET | `/threads/:id` | view | Thread with all messages, attachments, participants |
| POST | `/threads/:id/read` | edit | Mark thread read/unread for the caller |
| POST | `/threads/:id/star` | edit | Star/unstar for the caller |
| POST | `/threads/:id/move` | edit | Move to a canonical folder (server + local) |
| POST | `/threads/bulk` | edit / delete | `{ids[], op: read                                                                                                                              | unread | star | move | label | delete}` |
| GET | `/search?q=` | view | FTS with the same filters as `/threads` |
| GET | `/labels` · POST · PATCH · DELETE `/labels/:id` | view / edit | Personal labels |
| GET | `/drafts` · GET `/drafts/:id` | view | The caller's drafts |
| PUT | `/drafts/:id` | create | Autosave (idempotent upsert) |
| DELETE | `/drafts/:id` | edit | Discard |
| POST | `/send` | create | Compose → queue. Returns `{queue_id, release_at}` |
| POST | `/send/:queueId/cancel` | create | Undo-send within the window |
| GET | `/send/pending` | view | The caller's held/queued messages |
| POST | `/threads/:id/reply` · `/reply-all` · `/forward` | create | Same queue path |
| POST | `/attachments` | create | Upload → vault → returns an attachment id for a draft |
| GET | `/attachments/:id/download` | view | Auth-gated bytes |
| POST | `/attachments/from-vault` | create | Attach an existing vault document by id |
| GET | `/commands` | view | Slash commands **visible to this caller** after RBAC filtering |
| POST | `/commands/:key/resolve` | view | Runs the command's resolver, returns the block to insert |
| GET | `/connections/:id/members` · POST · DELETE | view / edit | Shared-mailbox membership |
| GET | `/stream-rules` · POST · DELETE `/stream-rules/:id` | view / edit | Split-inbox rules |

### 5.5 Backend behaviour

#### 5.5.1 Multi-folder sync (closes G-5)

`mail-sync` per connection:

1. `adapter.listFolders()` (new interface method; IMAP `LIST`, others per capability) → upsert
   `email_folder`, mapping to canonical names by well-known aliases (`INBOX`, `Sent`/`Sent Items`/
   `Éléments envoyés`, `Drafts`/`Brouillons`, `Junk`/`Spam`/`Courrier indésirable`, `Archive`,
   `Trash`/`Deleted Items`/`Corbeille`) and by the IMAP `\Sent \Drafts \Junk \Archive \Trash`
   special-use flags where the server advertises them (RFC 6154), which is more reliable than names.
2. For each syncable folder, `adapter.fetchSince(folder.sync_cursor, folder.provider_path)`.
   **UIDVALIDITY change re-scans only that folder.**
3. Normalise → `mail.threading.threadKeyFor(message)` → upsert `email_thread` → insert
   `email_message` (dedup index) → attachments to the vault → `mail.stream.classify()` → per-user
   state rows for the connection's members.
4. Advance that folder's cursor. A failure on one folder records `email_folder.last_error` and
   **must not** abort its siblings — the existing per-connection error discipline, one level down.
5. Publish `mail:new` on the Redis bus as today.

Folder budget: cap at 25 syncable folders per connection, newest-first, to stop a mailbox with 400
archive folders from starving the queue.

#### 5.5.2 Threading (`mail.threading.js`)

`threadKeyFor({messageIdHeader, inReplyTo, references, subject, provider, providerThreadId})`:
provider thread id when `capabilities().serverThreads`; else `references[0]`; else `inReplyTo`; else
`messageIdHeader`. Subject-based grouping is **not** used as a primary key (it merges unrelated
`Re: Invoice` threads) — only as a tiebreak within one connection and one participant set.

#### 5.5.3 Split inbox (`mail.stream.js`)

```
classify(message, { knownParties }) → { stream, reason, rule_id? }
```

Order:

1. **Known-party override.** If `from_address` or its domain matches a `client_master`,
   `supplier_master`, `employee` or `lead` record → `HUMAN`, reason `known_party`. **This wins over
   everything.** (Q12 — the failure mode that would kill trust.)
2. Tenant rules by `priority`, then seeded system rules.
3. Default `HUMAN`.

The residue — nothing matched and the sender is unknown — is where PR-4 may add an AI verdict. In
PR-1 it defaults to `HUMAN` and the reason is `default`. Every classification stores its `reason`, so
"why is this in System?" is answerable from the row.

#### 5.5.4 Search (`mail.search.js`)

Parses a Gmail-ish mini-language into structured filters plus a free-text remainder:
`from:`, `to:`, `subject:`, `has:attachment`, `is:unread`, `is:starred`, `folder:`, `label:`,
`before:`, `after:`, `client:`. The remainder becomes `plainto_tsquery('simple', …)` against
`search_tsv`. Results are always filtered by the caller's accessible connections.

#### 5.5.5 Send queue, undo-send and offline (addition a)

`POST /mail/send` **never** talks to SMTP inline. It:

1. Validates, serializes the body (§5.6.2), resolves attachments.
2. Writes `email_send_queue` with `status='HELD'`, `release_at = now() + undo_window`.
3. Returns `{queue_id, release_at}`. The UI shows _"Sending in 20s — Undo"_.

`mail-send-flush` (BullMQ repeatable, every 5 s) claims due rows with
`FOR UPDATE SKIP LOCKED`, flips to `SENDING`, calls the adapter, records the OUT `email_message`,
emits `email.sent`, sets `SENT`. Failures increment `attempts` and retry with backoff up to 3, then
`FAILED` with the classified `smtp-error.map` message surfaced to the sender's notification bell.

`POST /send/:queueId/cancel` sets `CANCELLED` if and only if the row is still `HELD` — a single
`UPDATE … WHERE status='HELD'` with a rowcount check, so the race against the flusher is decided by
the database, not by a timer.

**Offline:** the client persists un-POSTed sends in IndexedDB and replays them on reconnect with an
`Idempotency-Key` header; the existing `0662_idempotency_key` machinery de-duplicates.

Undo window default **20 s**, user-configurable (off / 10 / 20 / 30) via `preference`.

#### 5.5.6 Attachments

- Upload → sniffed (`document_vault.sniffContentType`) → stored in the vault with
  `entityRef = 'email_draft:<id>'`, then re-pointed to `email_message:<id>` on send.
- **Hard cap 25 MB** total per message, enforced server-side on the sum, not per file (Q9).
- Above **10 MB** the composer offers a secure link instead. In PR-1 that button is present but
  disabled with _"Available once secure links are enabled"_; PR-5 wires it.
- Inline images paste as `cid:` parts, not base64 in the body — base64 inflates the message past
  Gmail's 102 KB clip threshold fast.
- `POST /attachments/from-vault` is the **internal document picker**: pick by document type
  (`dictionary_ref` kind `DOCUMENT_TYPE`), client, or dossier; the file is referenced, never re-uploaded.

### 5.6 Frontend

```
client/src/features/comms/mail/
  index.tsx                  MailPage shell: folder rail · thread list · reading pane · right slot
  folder-rail.tsx            canonical folders, counts, labels, Human/System toggle, VIP filter
  thread-list.tsx            virtualised, grouped, bulk-select, keyboard-navigable
  thread-view.tsx            message stack, quote folding, attachment strip, EXTENSION SLOTS
  search-bar.tsx             mini-language input with chips
  composer/
    composer.tsx             the modal/pane shell, slot host
    editor.tsx               TipTap instance + toolbar (LAZY-LOADED)
    toolbar.tsx              bold/italic/underline/strike · H1-H3 · lists · quote · code
                             · link · table · image · hr · text colour · highlight · font family
                             · font size · alignment · emoji picker · clear formatting
    slash-menu.tsx           "/" trigger → permission-filtered command list
    attachment-bar.tsx       drag-drop, progress, size meter, vault picker button
    recipient-field.tsx      existing recipient search, extended to Cc/Bcc + chips
    serializer.ts            client mirror of mail.compose.js, for live preview only
  mailboxes.tsx              existing Mailboxes tab + shared-mailbox members UI
```

#### 5.6.1 The editor

TipTap with `StarterKit`, `Underline`, `Link`, `Image`, `Table`, `TextStyle`, `Color`, `Highlight`,
`FontFamily`, `TextAlign`, `Placeholder`, `CharacterCount`, plus two custom nodes:
`erpBlock` (what a slash command inserts — a rendered, non-editable ERP table with its data pinned at
insert time) and `mention` (added in PR-3).

Font family choices are **web-safe stacks only** — Arial, Helvetica, Georgia, Times New Roman,
Verdana, Tahoma, Trebuchet, Courier New — with a note in the UI. The codebase already learned this
the hard way: see the comment in `notification.service.js` about Outlook stripping `@font-face`.
Offering Montserrat here would render as Times New Roman at the recipient and nobody would know why.

#### 5.6.2 The serializer — the actual deliverable

`mail.compose.js` (server, authoritative) converts TipTap JSON → email HTML:

- Table-based layout, max-width **600 px**, everything inline-styled. **No `<style>` block, no
  classes, no external CSS, no web fonts, no flex/grid, no CSS variables.**
- Colours emitted as explicit hex on both `color` and `bgcolor` where relevant; never `currentColor`.
- Images: `cid:` for inline, absolute HTTPS for hosted; every image gets `alt`, explicit `width`, and
  `style="display:block"`.
- Links get `target="_blank" rel="noopener noreferrer"`.
- A `text/plain` alternative is generated from the same tree, not from the HTML.
- Output passes through `sanitize-html` on the way out as well as in — outbound sanitisation is not
  redundant, it is what stops a pasted payload from a compromised source going out over the tenant's
  signature.
- **Hard limit 102 KB** for the HTML part; over it, the composer warns before send (Gmail clips and
  hides the rest behind "View entire message", which silently truncates a quotation).

The client's `serializer.ts` is for live preview only. **The server's output is what is sent**, so a
client-side bug can never produce mail nobody reviewed.

#### 5.6.3 Reading pane

Threads render newest-last with collapsed quoted history (detected by `>` prefixes, `<blockquote>`,
and the `On … wrote:` / `Le … a écrit :` patterns — both languages). Remote images are **blocked by
default** with a per-sender "always show" that is stored per user. Blocking remote images is also the
only privacy control we have left after Q32 removed telemetry — it stops _other people's_ pixels too.

#### 5.6.4 Slash commands — and how to add one later (Q10)

`src/modules/mail/mail/mail.commands.js`:

```js
/**
 * Slash-command manifest. Same shape and same discipline as a `<module>.ai.js`
 * manifest: a command declares the module it belongs to and the permission the
 * caller must hold, and the registry filters the list per user. A command can
 * never read more than the person typing it could read in the UI.
 *
 * ── TO ADD A COMMAND WHEN YOU BUILD A NEW MODULE ──────────────────────────
 *  1. Add an entry below with a unique `key` (this becomes "/key" in the editor).
 *  2. `module_key` + `permission` — the SAME pair the module's own routes use.
 *     Do not invent a new permission; if the module has no read grant that fits,
 *     the command does not belong in mail yet.
 *  3. `resolve(client, params, ctx)` — call the module's SERVICE, never SQL.
 *     `ctx` carries { user, thread, boundEntityRef } so a command can default to
 *     the thread's bound client without asking.
 *  4. `render(data, lang)` — return { html, text, json } where `json` is a TipTap
 *     `erpBlock` node. Render in `lang` ('en'|'fr'); fall back to 'en'.
 *  5. Add a row to the i18n dictionary for label/description, and a case to
 *     tests/unit/mail-commands.test.js asserting the permission is enforced.
 * There is NO central wiring step: the registry walks this file at boot.
 */
module.exports = [
  { key: "invoice",   module_key: "MOD-46", permission: "view", params: ["invoice_no?"],  … },
  { key: "proforma",  module_key: "MOD-45", permission: "view", … },
  { key: "quotation", module_key: "MOD-27", permission: "view", … },
  { key: "costing",   module_key: "MOD-40", permission: "view", … },
  { key: "po",        module_key: "MOD-55", permission: "view", … },
  { key: "dossier",   module_key: "MOD-30", permission: "view", … },
  { key: "document",  module_key: "MOD-64", permission: "view", … },  // vault picker
  { key: "bank",      module_key: "MOD-09", permission: "view", … },  // masked per visibility
  { key: "snippet",   module_key: null,     permission: null,   … },  // tenant text snippets
  { key: "signature", module_key: null,     permission: null,   … },  // PR-2
];
```

The five you named — costing, quotation, proforma, invoice, purchase order — plus `dossier`
(a shipment status block, the single most-typed thing in a forwarder's day), `document` (the vault
picker you asked for), `bank` (payment details, masked by the existing `confidential.js` rules),
`snippet` and `signature`.

**Snippets** get a tiny admin screen under Settings → Company → Mail snippets: label, body, language,
optional department scope. No data access, so no permission beyond being signed in.

#### 5.6.5 Shared mailbox UX (Q6 — "best UI/UX possible")

- The folder rail groups mailboxes: _Mine_ then _Shared_, each collapsible, each with its own unread
  badge; a single "All mail" pseudo-folder merges them.
- A shared thread shows small **presence avatars** of colleagues currently viewing it (socket.io room
  per thread, already available), and a **"Marie is replying…"** indicator. PR-1 ships presence;
  PR-5 adds the claim/lock that makes it authoritative.
- Read state is per user and the UI says so on hover — _"Read by you · Unread for 2 others"_ — because
  the single most confusing thing about shared inboxes is not knowing whether a colleague has seen it.

#### 5.6.6 Extension slots (the merge-conflict prophylactic)

`thread-view.tsx` and `composer.tsx` each export a slot registry:

```ts
export type MailSlot =
  | "thread.header.right" // PR-3 binding chip, PR-5 verdict banner
  | "thread.aside" // PR-3 dossier drawer
  | "thread.tabs" // PR-3 internal notes tab
  | "thread.summary" // PR-4 executive summary strip
  | "composer.toolbar.right" // PR-4 AI menu, PR-4 voice button
  | "composer.footer.left" // PR-2 signature selector
  | "composer.footer.right" // PR-5 schedule button
  | "composer.presend"; // PR-4 guardrails, PR-5 anti-spoof block
```

**MUST:** PR-2 through PR-5 add UI by registering into a slot. Editing another PR's JSX is what makes
parallel work fail.

### 5.7 Contracts

Shared Zod schemas go in `packages/shared/src/mail/` so client and server agree:
`ThreadSummary`, `ThreadDetail`, `MessageDetail`, `Attachment`, `DraftPayload`, `SendPayload`,
`QueueEntry`, `FolderSummary`, `CommandDescriptor`, `SearchQuery`. The client's `mail-api.ts` is
regenerated against them; `npm run check:schemas --prefix client` is the existing gate.

### 5.8 Acceptance criteria

1. Connecting a cPanel IMAP mailbox discovers and syncs Inbox, Sent, Drafts, Spam, Archive and Trash;
   each folder keeps its own UIDVALIDITY cursor, and a reset on one re-scans only that one.
2. Messages group into threads; a reply to a reply lands in the same thread; two unrelated
   `Re: Invoice` messages from different senders do **not** merge.
3. In a shared mailbox, marking a message read affects only the caller; a colleague still sees it
   unread, and the UI says so.
4. Search `from:maersk has:attachment folder:INBOX demurrage` returns the right threads in under
   400 ms p95 on a 50 000-message mailbox.
5. Bulk-selecting 200 threads and archiving them completes, updates the server, and is reflected in
   the provider mailbox.
6. A message from an address on `client_master` is **never** classified into the System stream, even
   when it carries `Precedence: bulk`.
7. The composer produces bold/italic/lists/tables/colours/links/emoji that render correctly in
   Outlook 2016+, Gmail web, Gmail Android, Apple Mail and Thunderbird (snapshot-tested markup).
8. Attaching three files totalling 26 MB is refused with a clear message; 24 MB succeeds; each file
   lands in `document_vault` with a content hash.
9. `/invoice INV-2026-0042` inserts a rendered invoice table; the same command typed by a user
   without MOD-46 view **does not appear in the menu at all**.
10. Closing the browser mid-compose and returning restores the draft, with attachments.
11. Pressing Send then Undo within the window sends nothing and leaves no OUT message.
12. Sending with no connection, then regaining it, flushes the queued message exactly once.
13. `email_inbound` still answers every existing query; `mail.ai.js`, `clientTimeline` and the 360
    pages are unchanged and untouched.
14. `npm run ci` green, including `db:check:idempotency`, `db:check:columns` and `check:bundle`.

### 5.9 Tests

`tests/unit/`: `mail-threading.test.js` · `mail-stream.test.js` · `mail-search-parse.test.js` ·
`mail-html-serializer.test.js` · `mail-capabilities.test.js` · `mail-folder-sync.test.js` ·
`mail-send-queue.test.js` (undo race, retry, idempotency) · `mail-commands.test.js` (RBAC filtering).
`tests/integration/`: `mail-model-backfill.test.js` (backfill correctness + view parity) ·
`mail-search.test.js` · `mail-context-budget.test.js` (scaffolded here, asserted in PR-3).
`client/src/features/comms/mail/*.test.tsx`: composer serialization, slash menu, bulk selection,
folder rail; plus the existing `screens.axe.test.tsx` a11y sweep must cover the new screens.

### 5.10 Rollout

1. Merge Task 0 (restructure) alone; confirm green.
2. Ship migrations; run `db:migrate:tenants`; verify the `email_inbound` view with `db:check:columns`.
3. Enable `mail.core` for `smartls` only; leave `mail.composer` off for 48 h while the old composer
   remains reachable behind a query flag.
4. Enable `mail.composer`. Keep `mail.provider.oauth` off.
5. **Rollback:** flags off restores the previous UI immediately. The data migration is additive —
   `email_inbound_legacy` is retained for one release, and the view can be swapped back to the table.

### 5.11 Task list

```
T0   (done in PR-0 — the group restructure is already on main)
T1   10731 model + backfill + compatibility view; db:check:columns
T2   10732 folders/labels; adapter.listFolders() on all three providers (IMAP real, others per capability)
T3   Rework mail-sync for per-folder cursors; mail.folders.js special-use mapping
T4   mail.threading.js + thread assembly on ingest
T5   10733 FTS + trigger; mail.search.js; GET /search
T6   10736 + mail.stream.js; seeded rules; known-party override; stream rules admin endpoints
T7   10739 connection kind + members; shared-mailbox endpoints
T8   Thread/folder/bulk endpoints + repo SQL + validators
T9   10734 attachments both directions; upload, vault picker, download
T10  10735 drafts + send queue; mail-send-flush worker; undo + cancel; idempotency
T11  mail.compose.js serializer + 102 KB guard + plain-text part
T12  mail.commands.js registry + /commands endpoints + the ten seeded commands
T13  FE: shell, folder rail, thread list (virtualised), thread view, slots
T14  FE: composer + TipTap (lazy) + toolbar + slash menu + attachment bar + Cc/Bcc
T15  FE: search bar, bulk actions, split-inbox toggle, VIP filter, shared-mailbox grouping + presence
T16  10737 events, 10738 flags + platform seed for smartls
T17  Tests per §5.9; i18n EN/FR; screen-registry entries; API docs regeneration
```

---

## 6. PR-2 — Identity, Signatures & Deliverability

> **Goal.** Every message the product sends — from a person or from the system — carries the right
> identity, derived from ERP data, governed by the company, updated the moment HR posts a promotion,
> and demonstrably deliverable.

**Flags:** `mail.signatures`, `mail.deliverability`. **Migrations:** `10740`–`10744`.
**Depends on:** PR-1 (composer slots, serializer). **Parallel with:** PR-3.

### 6.1 Scope

**In.** One signature template definition rendered two ways (HTML + PNG) · ERP-derived fields with a
governed override list · three seeded templates with department defaults · send-time resolution with
a promotion-invalidated cache · department-labelled corporate blocks on system mail · per-party
preferred language · outbound deliverability dashboard with scheduled re-checks and regression alerts.

**Out.** Inbound anti-spoofing (PR-5 — it needs the visibility and audit machinery) · paid IP
reputation feeds · per-recipient signature variants.

### 6.2 The signature model

#### `10740_signature_engine.sql`

```sql
-- The template: a layout spec plus authored (non-derivable) wording, per language.
CREATE TABLE IF NOT EXISTS signature_template (
  signature_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL UNIQUE,          -- 'smartls_classic' | 'compact' | 'formal_legal'
  name           text NOT NULL,
  description    text,
  layout         jsonb NOT NULL,                -- block order, widths, colours, logo placement
  copy_en        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- motto, disclaimer, confidentiality notice
  copy_fr        jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope_kind     text NOT NULL DEFAULT 'TENANT'
                   CHECK (scope_kind IN ('TENANT','DEPARTMENT','ENTITY')),
  scope_value    text,                          -- department name or entity_id when scoped
  is_default     boolean NOT NULL DEFAULT false,
  is_system      boolean NOT NULL DEFAULT false,-- seeded; editable but not deletable
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_signature_template_default
  ON signature_template (scope_kind, COALESCE(scope_value,'')) WHERE is_default;

-- What the USER supplies. Derived fields are NOT stored here — they are read live.
-- Q14: fields the DB does not carry (desk/mobile phone today) are typed by the user.
CREATE TABLE IF NOT EXISTS user_signature_profile (
  user_id        uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  signature_template_id uuid REFERENCES signature_template(signature_template_id),
  phone_desk     text,
  phone_mobile   text,
  whatsapp       text,
  pronouns       text,
  credentials    text,                -- 'MSc, FIATA Dip.'
  booking_url    text,
  language       text CHECK (language IN ('en','fr')),   -- null = follow the recipient
  extra          jsonb NOT NULL DEFAULT '{}'::jsonb,     -- future editable fields, no migration needed
  is_enabled     boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The cache (Q16). Invalidated by employee.updated / entity change / template change.
CREATE TABLE IF NOT EXISTS signature_render (
  signature_render_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES app_user(user_id) ON DELETE CASCADE,
  identity_key   text,                -- for SYSTEM renders: the email_identity purpose/department
  language       text NOT NULL CHECK (language IN ('en','fr')),
  format         text NOT NULL CHECK (format IN ('HTML','PNG')),
  scale          smallint NOT NULL DEFAULT 1 CHECK (scale IN (1,2,3)),
  content        text,                -- HTML body for format='HTML'
  storage_path   text,                -- vault/object key for format='PNG'
  source_hash    text NOT NULL,       -- hash of the resolved inputs; a mismatch = stale
  generated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (COALESCE(user_id::text, identity_key), language, format, scale)
);
```

#### `10741_signature_seed.sql`

Seeds three templates, `is_system = true`:

| key               | What it is                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smartls_classic` | **The exact layout of the current standalone generator**: logo left in a bordered panel, name in the brand colour, job title beneath, then desk phone · mobile · email, then physical address and P.O. Box, website, and the motto as a full-width bottom bar. 650 × 325 at 1×. This is the one everyone gets on day one, so nothing visibly changes for staff already using the tool. |
| `compact`         | Three lines, no logo panel: **Name · Title**, then phone/mobile/email on one line, then company + website. For high-volume operational mail and mobile signatures.                                                                                                                                                                                                                     |
| `formal_legal`    | `smartls_classic` plus a legal block derived from `corporate_entity` (legal form, share capital, RCCM, NIU) and a per-language confidentiality notice. Default for Finance and Legal departments.                                                                                                                                                                                      |

Department defaults (`scope_kind='DEPARTMENT'`) are seeded for Operations, Commercial/Sales, Finance,
HR and Customer Support, all pointing at `smartls_classic` except Finance → `formal_legal`.

#### `10742_party_language.sql` (addition d)

```sql
ALTER TABLE client_master   ADD COLUMN IF NOT EXISTS preferred_language text CHECK (preferred_language IN ('en','fr'));
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS preferred_language text CHECK (preferred_language IN ('en','fr'));
ALTER TABLE lead            ADD COLUMN IF NOT EXISTS preferred_language text CHECK (preferred_language IN ('en','fr'));
```

Resolution order for the language of any outbound message:
**explicit choice in the composer → party `preferred_language` → language of the message being
replied to → the sender's own UI language → tenant default.**
One helper, `resolveLanguage(ctx)`, in `src/modules/mail/signature/language.js`, used by signatures,
templates and (in PR-4) AI translation. **MUST** be one function — three copies of this rule is how
a French client starts receiving English invoices.

#### `10743_mail_domain_health.sql`

```sql
CREATE TABLE IF NOT EXISTS domain_health_check (
  domain_health_check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain        text NOT NULL,
  record        text NOT NULL CHECK (record IN ('MX','SPF','DKIM','DMARC','PTR','RBL')),
  selector      text,                       -- DKIM selector when record='DKIM'
  verdict       text NOT NULL CHECK (verdict IN ('PASS','FAIL','UNKNOWN')),
  value         text,
  suggestion    text,
  checked_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_domain_health_latest ON domain_health_check(domain, record, checked_at DESC);
```

#### `10744_signature_events.sql`

`signature.template.changed`, `signature.profile.changed`, `signature.cache.invalidated`,
`deliverability.regressed`.

### 6.3 Signature resolution and rendering

```
src/modules/mail/signature/
  signature.routes.js      /mail/signature (own profile) + /mail/signature/templates (admin)
  signature.controller.js
  signature.service.js     resolve → render → cache → invalidate
  signature.repo.js
  signature.validator.js
  signature.events.js
  signature.resolve.js     PURE: (employee, entity, profile, template, lang) → block model
  signature.html.js        PURE: block model → email-safe HTML
  signature.png.js         block model → PNG via puppeteer (the only impure renderer)
  language.js              resolveLanguage(ctx)
```

**`signature.resolve.js` is pure and is modelled directly on `entity-letterhead.service.js`.** Read
that file first; this one follows the same contract — _the operator chooses which blocks appear, the
content is derived_ — and the same blank-safe `join()` discipline so a missing P.O. Box does not
leave a dangling separator.

Field sources (Q14):

| Block   | Field                                               | Source                                                 | Editable?       |
| ------- | --------------------------------------------------- | ------------------------------------------------------ | --------------- |
| Person  | Full name                                           | `employee.full_name` → `app_user.full_name`            | No              |
| Person  | Job title                                           | `employee.job_title`                                   | No              |
| Person  | Department                                          | `employee.department`                                  | No              |
| Contact | Email                                               | `email_connection.email_address` (the sending mailbox) | No              |
| Contact | Desk phone                                          | `user_signature_profile.phone_desk`                    | **Yes — typed** |
| Contact | Mobile                                              | `user_signature_profile.phone_mobile`                  | **Yes — typed** |
| Contact | WhatsApp, pronouns, credentials, booking URL        | `user_signature_profile`                               | **Yes — typed** |
| Company | Legal name, logo, address, P.O. Box, phone, website | `corporate_entity` + `entity_address` + branding       | No              |
| Company | Motto / strapline, disclaimer                       | `signature_template.copy_{en,fr}`                      | Admin only      |
| Company | Legal mentions (RCCM, NIU, capital)                 | `corporate_entity`, via the letterhead service         | No              |

> **Note for whoever picks this up later.** Desk and mobile phone are typed by the user because
> `employee` has no phone columns today (Q14). That is a real master-data gap: HR cannot record a
> staff phone number anywhere. If it is ever fixed, `signature.resolve.js` needs one change — prefer
> `employee.phone_*` and fall back to the profile — and nothing else. Leave that comment in the file.

**Rendering.**

- `signature.html.js` emits the same email-safe HTML the composer serializer must produce
  (§5.6.2): tables, inline styles, web-safe font stack, logo as an absolute HTTPS URL from the
  tenant's branding assets with `alt`, explicit width and `display:block`.
- `signature.png.js` renders the _same_ HTML in headless Chromium (`puppeteer`, already a dependency
  and already used by `pdf.service.js`) at 650 × 325 CSS px, at scale 1×, 2× or 3× — matching the
  standalone tool's export options. It stores to the vault and returns a download URL.
- **One definition, two renderers** (Q13). A test asserts the text content of the two is identical, so
  they cannot drift.

**Send-time resolution + cache (Q16).**

`signature.service.resolveFor({userId, connectionId, language})` computes a `source_hash` over the
resolved inputs (employee row version, entity version, profile `updated_at`, template `updated_at`,
branding logo URL, language). Cache hit when the hash matches; otherwise render and store.

Invalidation is event-driven, mirroring the existing orchestration handlers:

```
src/orchestration/handlers/employee-updated-invalidate-signature.js
  eventKey: "employee.updated"   → delete signature_render rows for the linked app_user
src/orchestration/handlers/entity-updated-invalidate-signatures.js
  eventKey: "corporate_entity.updated" → delete all renders for that entity's users
```

Both **MUST** be idempotent (at-least-once delivery, per `src/orchestration/registry.js`).

**MUST NOT:** rewrite a signature into an already-sent `email_message`. The signature is baked into
`body_html` at send time and stays there. Option C in Q16 was explicitly rejected, and it also
contradicts PR-5's archive.

### 6.4 System-email identity (Q17)

`email_identity` already has a free-text `purpose` (the CHECK was dropped in `0521`). We use it as
the **department label**:

| purpose         | Department label EN / FR              | Signature block                              |
| --------------- | ------------------------------------- | -------------------------------------------- |
| `OPERATIONS`    | Operations / Exploitation             | corporate + ops contact                      |
| `BILLING`       | Billing / Facturation                 | corporate + payment details + legal mentions |
| `SUPPORT`       | Customer Support / Service client     | corporate + support contact + hours          |
| `HR`            | Human Resources / Ressources humaines | corporate only                               |
| `DOCUMENTS`     | Documents                             | corporate only                               |
| `NOTIFICATIONS` | (none — minimal)                      | corporate strip only                         |

`email.service.send()` gains an optional `{ signature: 'auto' | 'none' | userId }`:

- **Machine mail** (OTP, password reset, notification fan-out, system alerts) → the corporate block
  for its purpose, **no person**.
- **Document mail sent by a named user** (an accountant emailing an invoice, an ops officer sending a
  BL) → **that user's personal signature** over the tenant's `DOCUMENTS`/`BILLING` sender identity, so
  the client has a human to reply to. This is the documented exception from Q17 and it needs to be
  explicit in the code, not accidental.

**MUST NOT** change the `resolveMail` fallback chain. When the tenant has no SMTP of their own, the
Praxis fallback sender is used and the _sender_ falls back with the transport — that rule
(`email.service.js`, gap G-4) exists so a tenant-domain From never goes out through the deploy relay
and fails SPF. Signatures are a body concern and must not touch it.

### 6.5 Deliverability dashboard

`src/modules/mail/deliverability/` — a thin module over the existing `dns-check.js`, which already
does MX/SPF/DKIM with relay-specific fix hints. Adds:

- **PTR / reverse DNS** for the sending host.
- **DMARC** parse (policy, `rua`, alignment) with a plain-language reading: _"p=none — you are
  monitoring only; nobody is stopping a spoof of your domain yet."_
- **Public RBL checks** against a configurable list (`zen.spamhaus.org`, `bl.spamcop.net`,
  `b.barracudacentral.org`) for the sending IP. **No paid feed** (Q35): the list is a setting, so
  adding a commercial feed later is configuration, not code.
- **Scheduled re-check** — BullMQ `deliverability-check-scheduler`, daily, per tenant, over every
  domain in `email_identity` and every connected `email_connection` domain.
- **Regression alert** — a `PASS → FAIL` transition emits `deliverability.regressed` and notifies
  MOD-70 holders. A domain that silently loses its DKIM record is exactly the failure that is invisible
  until invoices stop arriving.

Endpoints: `GET /mail/deliverability` (latest verdict per domain per record),
`POST /mail/deliverability/check` (re-check now), `GET /mail/deliverability/:domain/history`.

UI: Settings → Company → Deliverability. A traffic-light row per domain, each expandable to the exact
DNS record to add, with a copy button — reusing the presentation `mail-setup-wizard.tsx` already has.

### 6.6 Frontend

```
client/src/features/settings/signatures/
  signature-admin.tsx        template list, editor, department defaults   (MOD-70 edit)
  template-editor.tsx        layout + copy_en/copy_fr + live preview
  signature-profile.tsx      the user's own editable fields + preview + PNG download (1x/2x/3x)
  signature-preview.tsx      shared renderer preview, EN/FR toggle
client/src/features/settings/deliverability/
  deliverability-panel.tsx
```

The user-facing screen sits under **Settings → My profile → Email signature** and carries the
capability the standalone tool had that people will miss: **Download PNG** at 1×, 2× and 3×, so it can
be pasted into Outlook desktop, webmail or Gmail (Q13).

Composer integration is a **slot registration** into `composer.footer.left` (§5.6.6): a signature
selector when the user has more than one available template, showing the block inline in the editor
as a non-editable node so what they see is what sends.

### 6.7 Acceptance criteria

1. A user with no profile still gets a correct signature — every derived field present, typed fields
   simply absent, no dangling separators or empty lines.
2. Changing an employee's `job_title` in HR causes the **next** email to carry the new title, with no
   manual step and no cache flush by hand.
3. An email sent before the promotion still shows the old title when re-opened.
4. HTML and PNG renders of the same signature contain identical text; the PNG at 2× is 1300 × 650.
5. A system OTP email carries the corporate block and no person's name or mobile number.
6. An invoice emailed by a named accountant carries that accountant's signature and the tenant's
   BILLING sender identity.
7. A client with `preferred_language = 'fr'` receives the French motto and French legal notice.
8. Removing the tenant's DKIM record turns the dashboard row red within 24 h and notifies MOD-70.
9. The signature HTML renders correctly in Outlook 2016+, Gmail web and Apple Mail (snapshot test).
10. A non-admin cannot edit a template; an admin cannot delete a seeded one.

### 6.8 Tests

`tests/unit/mail-signature.test.js` (resolution precedence, blank-safety, HTML/PNG parity,
promotion invalidation, history immutability) · `signature-language.test.js` (the five-step
resolution order) · `mail-deliverability.test.js` (DMARC parsing, RBL verdicts, regression detection)
· `client/.../signature-profile.test.tsx`.

### 6.9 Task list

```
S1  10740 schema; signature.resolve.js (pure) + unit tests first
S2  signature.html.js + snapshot tests against the four target clients
S3  signature.png.js via puppeteer; vault storage; 1x/2x/3x
S4  Cache + source_hash + the two orchestration invalidation handlers
S5  10741 seed the three templates (classic must match the standalone tool pixel-for-intent)
S6  10742 party language + language.js resolver, wired into signature + template selection
S7  email.service.send({signature}) — machine vs named-user paths; guard the fallback rule
S8  Admin UI (templates, department defaults) + profile UI + PNG download
S9  Composer slot registration
S10 10743 + deliverability module, PTR/DMARC/RBL, scheduler, regression alert, panel
S11 10744 events; i18n; screen-registry; tests per §6.8
```

---

## 7. PR-3 — ERP Binding, Smart Dossier & Collaboration

> **Goal.** The inbox stops being a separate application. Every thread knows which client, dossier or
> invoice it belongs to (once a human agrees), shows that record's live state beside it, lets the team
> argue about it privately, and turns an email into an ERP record without retyping anything.

**Flags:** `mail.binding`, `mail.notes`, `mail.doc_intake`. **Migrations:** `10745`–`10749`.
**Depends on:** PR-1. **Parallel with:** PR-2. **Blocks:** PR-4 (grounding), PR-5 (visibility).

### 7.1 Scope

**In.** Reference extraction and confidence-scored **suggestions** · accept/reject with audit ·
`mail-context` aggregator and the right-pane dossier · read-only ERP action cards with explicit
missing-data handling · internal side-notes · the `@mention` primitive with an employee picker showing
name and role · mention fan-out to chat + notification + push · notification dedup · inbound document
classification with human approval into Client 360 → Documents · required-document checklists and the
chase composer · one-click entity conversion with duplicate detection.

**Out.** Any automatic binding (Q18) · writes from action cards (Q20) · AI drafting (PR-4) · sentiment
(not built at all) · assignment and SLA (PR-5).

### 7.2 Binding — suggestions, never assumptions

#### `10745_mail_binding_suggestion.sql`

```sql
CREATE TABLE IF NOT EXISTS email_binding_suggestion (
  email_binding_suggestion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_thread_id  uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  email_message_id uuid REFERENCES email_message(email_message_id) ON DELETE CASCADE,
  entity_ref       text NOT NULL,               -- 'client:<id>' | 'dossier:<id>' | 'invoice:<id>' …
  entity_label     text,                        -- denormalised for display without a join
  signal           text NOT NULL CHECK (signal IN
                     ('DOSSIER_REF','INVOICE_REF','PO_REF','QUOTE_REF','CONTAINER_NO','BL_AWB_NO',
                      'SENDER_ADDRESS','SENDER_DOMAIN','THREAD_HISTORY')),
  matched_text     text,                        -- the exact substring that matched, for "why"
  confidence       numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status           text NOT NULL DEFAULT 'SUGGESTED'
                     CHECK (status IN ('SUGGESTED','ACCEPTED','REJECTED','SUPERSEDED')),
  decided_by       uuid REFERENCES app_user(user_id),
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_thread_id, entity_ref, signal)
);
CREATE INDEX IF NOT EXISTS ix_binding_open ON email_binding_suggestion(email_thread_id)
  WHERE status = 'SUGGESTED';
```

#### The behaviour change, stated plainly

`mail.service.autoLink()` **currently writes `entity_ref` directly on ingest.** Q18 changes that:

- Extraction still runs on ingest, but it now writes **suggestion rows**, not the binding.
- `email_thread.entity_ref` is set **only** when a human accepts a suggestion (or binds manually).
- **Existing `entity_ref` values are preserved** by the PR-1 backfill and are treated as already-
  accepted bindings. Nobody loses a link they already had.
- A per-tenant setting `mail.binding.auto_accept_threshold` exists and ships **`null` (off)**. If the
  team later decides that a 0.98-confidence exact dossier-reference match should bind itself, that is
  a settings change, not a code change. **It ships off** (Q18).

Because suggestions accumulate, the thread list shows an "Unbound (n)" filter and the dossier drawer
offers **Accept all high-confidence** for a batch — the answer to "will my inbox be a wall of
chips?" is a one-click batch, not silent binding.

#### Signals and confidence (`binding.extract.js`, pure)

| Signal           | Pattern                                                                                            | Confidence                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DOSSIER_REF`    | `SLAS-2026-0042` style (existing regex `[A-Za-z0-9]{2,}-\d{4}-\d{2,}`) resolving to a real dossier | 0.97                                                                                                     |
| `INVOICE_REF`    | Document number matching `invoice.doc_number`                                                      | 0.95                                                                                                     |
| `PO_REF`         | Matching `purchase_order.doc_number`                                                               | 0.95                                                                                                     |
| `QUOTE_REF`      | Matching a quotation/proposal reference                                                            | 0.92                                                                                                     |
| `CONTAINER_NO`   | **ISO 6346 with check-digit validation** — 4 letters + 7 digits, checksum verified                 | 0.90 if it resolves to a dossier line, else not suggested                                                |
| `BL_AWB_NO`      | Carrier BL or 3-digit-prefixed AWB (`123-45678901`) resolving to a dossier                         | 0.88                                                                                                     |
| `SENDER_ADDRESS` | Exact match on a `client_contact` / `supplier_contact` / `client_master.email`                     | 0.85                                                                                                     |
| `THREAD_HISTORY` | The thread already has an accepted binding                                                         | 0.99 (auto-applied to later messages in the same thread — this is not a new binding, it is the same one) |
| `SENDER_DOMAIN`  | Domain matches a party's known domain                                                              | **0.55** — deliberately low. Freight forwarding runs on shared agent domains and Gmail addresses.        |

Scan order: subject first, then the first 4 KB of body text, then attachment filenames. Search the
**quoted history last and at reduced confidence** — a reference inside a forwarded chain often
belongs to a different shipment.

**Checksum-validate container numbers.** An unvalidated 11-character token matches all sorts of
things; ISO 6346's check digit removes essentially all false positives for four lines of code.

#### Endpoints

| Method | Path                                        | Action                                  |
| ------ | ------------------------------------------- | --------------------------------------- |
| GET    | `/mail/threads/:id/suggestions`             | view                                    |
| POST   | `/mail/threads/:id/suggestions/:sid/accept` | edit                                    |
| POST   | `/mail/threads/:id/suggestions/:sid/reject` | edit                                    |
| POST   | `/mail/threads/:id/bind`                    | edit — manual bind to any `entity_ref`  |
| DELETE | `/mail/threads/:id/bind`                    | edit — unbind, audited                  |
| POST   | `/mail/suggestions/accept-batch`            | edit — `{thread_ids[], min_confidence}` |

Accepting writes `email_thread.entity_ref`, marks siblings `SUPERSEDED`, emits `email.thread.bound`
and writes an `audit` row. Unbinding is equally audited — a thread that silently detaches from a
dossier is a support call nobody can answer.

### 7.3 Action cards — read-only, and honest (Q20)

`email_thread.entity_ref` resolves to a card in the reading pane. **v1 cards read; they do not write.**

Each card shows live ERP state and offers actions that **deep-link into the owning module's screen with
prefilled query parameters** — the record is created in its own module, under its own lifecycle,
numbering, approval chain and audit, exactly as `BUILD_CONVENTIONS.md` §1–§5 requires.

**The missing-data rule (this is the part you asked for explicitly).** Before offering an action, the
card calls a _prefill readiness_ check that returns:

```jsonc
{
  "ready": false,
  "target": "/finance/proforma/new",
  "prefill": { "client_id": "…", "dossier_id": "…", "currency": "XAF" },
  "missing": [
    {
      "field": "incoterm",
      "label": "Incoterm",
      "why": "not stated in this thread",
    },
    {
      "field": "delivery_place",
      "label": "Place of delivery",
      "why": "dossier has no delivery place yet",
    },
  ],
}
```

The UI then does one of two things, and **never** a third:

1. `ready: true` → _"Create proforma"_ opens the module screen prefilled.
2. `ready: false` → the card says, in plain words, **"I can start a proforma but I need 2 things:
   Incoterm, Place of delivery"**, with small inline inputs to supply them, and the button stays
   labelled _"Create proforma"_ and opens the module screen prefilled once they are filled.

**MUST NOT** guess a missing value, substitute a default, or open a form silently missing fields. If
the thread does not say the incoterm, the card says the thread does not say the incoterm.

v1 card set: **Client**, **Dossier/Shipment**, **Invoice**, **Proforma**, **Quotation**,
**Purchase Order**, **Document request**. Each declares its readiness rule in
`src/modules/mail/binding/cards/<card>.js` — one file per card, so adding a card is a file.

### 7.4 Internal notes and mentions (Q21)

#### `10746_mail_thread_note_mention.sql`

```sql
CREATE TABLE IF NOT EXISTS email_thread_note (
  email_thread_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_thread_id  uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  author_user_id   uuid NOT NULL REFERENCES app_user(user_id),
  body             text NOT NULL,
  body_json        jsonb,                -- TipTap doc, so mentions are structured nodes
  reply_to_note_id uuid REFERENCES email_thread_note(email_thread_note_id),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- A REUSABLE primitive, not a mail-only one. Chat, dossiers and invoices can
-- mention people through this same table later without another migration.
CREATE TABLE IF NOT EXISTS mention (
  mention_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind      text NOT NULL CHECK (source_kind IN ('MAIL_NOTE','CHAT_MESSAGE','DOSSIER_NOTE')),
  source_ref       text NOT NULL,                -- 'email_thread_note:<id>'
  context_ref      text,                         -- 'email_thread:<id>' — where to send the user
  mentioned_user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  author_user_id   uuid NOT NULL REFERENCES app_user(user_id),
  excerpt          text,
  is_read          boolean NOT NULL DEFAULT false,
  acknowledged_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mention_inbox ON mention(mentioned_user_id, is_read, created_at DESC);
```

#### Containment — the non-negotiable

Notes live in a different table, render through a different component, and are **never** read by any
outbound path. Concretely:

- `mail.compose.js` takes a draft body; it has no access to a notes repo. There is no code path from
  `email_thread_note` to `email_message.body_html`.
- The reply composer's quoted-history builder reads `email_message` only.
- The Notes tab is visually distinct (amber left border, `Internal only — the customer cannot see
this` label at the top of the pane and again above the input).
- `tests/security/mail-notes-containment.test.js` asserts it across every outbound path including the
  scheduled-send flush and, later, AI drafts.

#### The `@` picker (Q21)

Reuse **`client/src/components/employee-picker.tsx`**. Read its header comment first: it exists
because a `<select>` over `/employees` silently truncated at 50 rows and made the fifty-first employee
unselectable. Do not rebuild it.

Extend it with a `variant="mention"` that:

- triggers inline on `@` inside the TipTap notes editor,
- renders **name · job title · department** per row (the roles you asked for) with the avatar where
  `employee.avatar_ref` exists,
- resolves the employee to their `app_user` (via `app_user.employee_id`) and refuses to insert a
  mention for an employee with no user account, saying so — a silent no-op mention is worse than none,
- inserts a structured `mention` node, not text, so rename-safety and fan-out both work.

#### Fan-out (and dedup — addition f)

On note save, for each mention: write the `mention` row, then notify **once**:

1. **In-app** — `notification.service.notify()` with category `MENTION`, deep-linking to
   `/comms/mail?thread=<id>&tab=notes`.
2. **Chat** — post a compact card into the mentioned user's Smart Comms direct channel:
   _"Blake mentioned you on «Re: BL for SLAS-2026-0042» — 'can we hold the demurrage?'"_ with a link.
   This is the "goes to the in-house chat box directly" behaviour you described.
3. **Push** — via the existing web-push path.

> **Push is more built than it looks.** `push.service.js` carries a stale comment claiming the
> delivery pipeline is unimplemented. It is not: `push_subscription` (0473), `GET/POST/DELETE
/notifications/push/*`, `client/src/components/pwa/push-opt-in.tsx` and `client/public/push-handler.js`
> all exist and are wired into the Workbox SW. What is actually missing is **VAPID configuration** in
> the Platform Console. PR-3 therefore: (a) fixes that comment, (b) adds the Console panel to generate
> and store the VAPID keypair, (c) surfaces push opt-in in Settings → Notifications, (d) adds an
> end-to-end test. That is "wire push properly" (addition f).

**Dedup rule.** One logical event produces at most one notification per user per channel. Implement in
`notification.service` as a `dedupe_key` (`{category}:{source_ref}:{user_id}`) with a 60-second
suppression window, so a note that mentions someone already watching the thread does not also fire the
thread-activity notification. **MUST** be applied in the service, not per caller.

### 7.5 The Smart Dossier drawer (Q19 + addition e)

#### The aggregator — and what it must not do

`src/modules/mail/binding/mail-context.service.js`

**MUST NOT call `party-360.service.js`.** That service computes aging detail, compliance recomputation,
GL parity, cap tables and child collections — correct for a 360 page, far too much for a drawer that
opens on every thread click. This is its own query set, tuned for this budget:

| Budget                  | Target                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| SQL statements per call | **≤ 6** (CI-asserted)                                                                                                            |
| p95 cold                | **300 ms**                                                                                                                       |
| p95 warm (cache hit)    | **50 ms**                                                                                                                        |
| Cache                   | 60 s per `entity_ref`, in Redis, invalidated by `invoice.posted`, `payment.received`, `milestone.completed`, `document.captured` |

`GET /mail/context?entity_ref=client:<id>` returns:

```jsonc
{
  "kind": "CLIENT",
  "header":  { "name", "ref", "type", "is_vip", "account_manager", "risk_flags": [], "language" },
  "overview": {                                     // ← the Overview tab, always loaded
    "outstanding_xaf", "overdue_xaf", "credit_limit", "credit_headroom",
    "payment_terms_days", "open_dossiers", "open_quotes", "documents_missing", "last_contact_at"
  },
  "tabs_available": ["money","operations","commercial","documents","interactions","compliance"]
}
```

Each tab is a **separate lazy call** (`/mail/context/:tab`), so the drawer paints instantly and only
the tab you open costs anything. That is what makes the 300 ms budget achievable — it is a design
decision, not an optimisation.

#### Content (Q19 = B: Overview first, then tabs)

| Tab              | Content                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Overview**     | The header + the eight overview figures above. One screen, no scrolling.                                          |
| **Money**        | Aging buckets (current / 1-30 / 31-60 / 61-90 / 90+), open invoices with due dates, last payment, credit headroom |
| **Operations**   | Open dossiers: reference, service type, current milestone, ETA, blocked milestones flagged                        |
| **Commercial**   | Open quotations and proposals with status, last invoice, YTD revenue                                              |
| **Documents**    | Required-vs-received checklist with gaps highlighted, plus **Chase missing documents**                            |
| **Interactions** | Last 10 across email, chat, notes, calls — the account's history, not just this thread                            |
| **Compliance**   | KYC/screening status, blocked flags, expiring registrations                                                       |

**Supplier threads flip the pane**: header + open POs, three-way-match exceptions, and the supplier
scorecard (`supplier_scorecard.service.js` already computes it). Dossier-bound threads show the
dossier first with its client behind it.

### 7.6 Inbound documents (Q22)

#### `10747_party_document_checklist.sql`

```sql
CREATE TABLE IF NOT EXISTS document_requirement (
  document_requirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind   text NOT NULL CHECK (scope_kind IN ('CLIENT_TYPE','SERVICE_TYPE','GLOBAL')),
  scope_value  text,
  doc_type_ref_id uuid NOT NULL REFERENCES dictionary_ref(ref_id),
  is_mandatory boolean NOT NULL DEFAULT true,
  applies_to   text NOT NULL DEFAULT 'CLIENT' CHECK (applies_to IN ('CLIENT','DOSSIER')),
  validity_days integer,                 -- e.g. a tax exemption certificate expires
  sort_order   integer NOT NULL DEFAULT 100,
  is_active    boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS email_attachment_classification (
  email_attachment_classification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_attachment_id uuid NOT NULL REFERENCES email_attachment(email_attachment_id) ON DELETE CASCADE,
  suggested_doc_type_ref_id uuid REFERENCES dictionary_ref(ref_id),
  suggested_entity_ref text,
  confidence   numeric(4,3),
  extracted    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'SUGGESTED'
                 CHECK (status IN ('SUGGESTED','FILED','REJECTED')),
  filed_doc_id uuid REFERENCES document_vault(doc_id),
  decided_by   uuid REFERENCES app_user(user_id),
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

Requirements are **tenant-configurable** (your answer), seeded with a Cameroon/CEMAC default:
import file → BL/AWB, commercial invoice, packing list, customs declaration, APEC where applicable;
export file → commercial invoice, packing list, certificate of origin, export declaration; client
onboarding → RCCM, NIU/tax certificate, ID of signatory, bank details.

**Flow.** Attachment lands in the vault on ingest (already happens) → classification job proposes a
doc type + the bound client/dossier with a confidence → the Documents tab and the attachment strip show
_"Looks like a Bill of Lading for SLAS-2026-0042 — File it?"_ → the user confirms or corrects → we set
`document_vault.doc_type_ref_id` + `client_id`, emit `document.captured`, and **it appears in Client
360 → Documents**, which is exactly where you asked for it to land.

**MUST:** never file silently, at any confidence, in this programme.

**Chase composer.** _"Chase missing documents"_ opens the composer prefilled with a bilingual list of
exactly the outstanding items, in the client's `preferred_language`, from a tenant-editable snippet.

### 7.7 Entity conversion (Q23)

`POST /mail/threads/:id/convert` → `{ target, prefill, duplicates }`, then the user reviews a form and
saves through the **target module's own service and validator**.

Targets: **Lead** (MOD-26), **Quote Request**, **Contact Enquiry** (MOD-25), **Support Ticket**,
**Task / approval item**, **Purchase Requisition** (MOD-56). Quote Request and Contact Enquiry are
included because they are the two most common inbound shapes for a forwarder and the Sales CRM already
models them.

**Duplicate detection** runs before the form opens, using `master/_shared/dedup.service.js`: same
email, same normalised company name (`party_name_norm`, migration 0513), same phone. When a match is
found the dialog leads with _"Thierry at Camrail is already a lead (opened 3 days ago) — attach this
email to it?"_ and makes _Create new_ the secondary action.

Conversion is bidirectional in the record: the created entity gets the thread's `entity_ref`, and the
thread shows what it became.

### 7.8 Frontend

```
client/src/features/comms/mail/
  binding/
    binding-chip.tsx        → slot "thread.header.right"  · confidence, matched text, accept/reject
    bind-dialog.tsx         manual bind search over clients/suppliers/dossiers/invoices
    dossier-drawer.tsx      → slot "thread.aside"         · Overview + lazy tabs
    cards/*.tsx             read-only ERP cards + the missing-field prompt
  notes/
    notes-tab.tsx           → slot "thread.tabs"          · internal-only styling, TipTap + mentions
    mention-picker.tsx      employee-picker variant="mention"
  intake/
    attachment-suggestion.tsx  file-it prompt in the attachment strip
    chase-dialog.tsx
  convert/
    convert-menu.tsx  convert-form.tsx  duplicate-warning.tsx
```

### 7.9 Acceptance criteria

1. An inbound message quoting `SLAS-2026-0042` produces a **suggestion** at 0.97 and **does not** set
   `entity_ref`. The thread list shows it as unbound.
2. Accepting the suggestion binds the thread, supersedes rivals, writes an audit row, and puts the
   message on the client's timeline.
3. Later messages in an already-bound thread inherit the binding without a new suggestion.
4. A sender on a shared agent domain produces a 0.55 domain suggestion that is visibly weaker.
5. A container number that fails its ISO 6346 check digit produces no suggestion.
6. The drawer opens in under 300 ms cold on a client with 400 invoices, issues ≤ 6 statements, and
   under 50 ms warm.
7. Opening the Money tab issues its own single query; not opening it costs nothing.
8. "Create proforma" on a thread lacking an incoterm states exactly which two fields are missing and
   creates nothing until they are supplied.
9. Mentioning a colleague notifies them in-app, in chat and on push — **once each**, not twice.
10. Mentioning an employee with no user account explains why it cannot be done.
11. An internal note never appears in any outbound body, including on reply, forward and scheduled send.
12. Confirming a classified BL sets its doc type and client and it appears in Client 360 → Documents.
13. Converting a repeat enquirer offers to attach to the existing lead rather than creating a duplicate.
14. Every accept, reject, bind, unbind and filing is on the audit trail with the actor.

### 7.10 Tests

`tests/unit/`: `mail-binding-extract.test.js` (every signal, ISO 6346 checksum, quoted-history
downgrade) · `mail-binding-suggest-only.test.js` (**ingest never writes `entity_ref`**) ·
`mail-cards-readiness.test.js` · `mention-fanout.test.js` (three channels, exactly once) ·
`notification-dedupe.test.js` · `doc-classification.test.js`.
`tests/integration/`: `mail-context-budget.test.js` (**≤ 6 statements, p95 assertions**) ·
`mail-convert-dedup.test.js`.
`tests/security/`: `mail-notes-containment.test.js`.
Client: `dossier-drawer.test.tsx`, `notes-tab.test.tsx`, `mention-picker.test.tsx`.

### 7.11 Task list

```
B1  10745 + binding.extract.js (pure) with the full signal table + checksum validation — tests first
B2  Rework ingest: suggestions instead of entity_ref writes; preserve existing bindings; setting stub
B3  Suggestion endpoints + accept/reject/bind/unbind/batch + audit
B4  mail-context.service.js: Overview query set, ≤6 statements, Redis cache + invalidation events
B5  Lazy tab endpoints (money, operations, commercial, documents, interactions, compliance) + supplier flip
B6  Card readiness framework + the seven v1 cards
B7  10746 notes + mention primitive; notes service; containment test BEFORE the UI
B8  employee-picker variant="mention"; app_user resolution; no-account handling
B9  Mention fan-out: notification + chat card + push; dedupe_key in notification.service
B10 Push: fix the stale comment, Console VAPID panel, Settings opt-in, e2e test
B11 10747 requirements + Cameroon/CEMAC seed + checklist computation + chase composer
B12 Attachment classification job (Gemini vision) + suggestion UI + filing into vault/360
B13 10748 conversion targets + prefill extractors + dedup + review forms
B14 FE: chips, drawer, cards, notes tab, intake prompts, convert flow
B15 10749 events; i18n; screen-registry; tests per §7.10
```

---

## 8. PR-4 — The AI Layer

> **Goal.** The operator opens a thread and the reply is already written, factually correct, in the
> right language and the right tone — and a human still presses Send, every single time.

**Flags:** `mail.ai` (under the `ai.assistant.backend` ceiling). **Migrations:** `10750`–`10744`.
**Depends on:** PR-1 (composer), PR-3 (bindings — grounding needs to know who the thread is about).
**Parallel with:** PR-5.

### 8.1 Scope

**In.** On-demand generation and rewrite · 10 tone presets + 5 one-click actions · EN↔FR translation
with a protected-terms glossary · fact-fenced ERP-grounded drafting with a visible sources strip ·
executive thread summaries · attachment OCR extraction into a review form · voice-to-professional-text
· pre-send guardrails · semantic mail search.

**Out — and these are decisions, not omissions.**

| Not built                                 | Why                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Inline as-you-type autocomplete           | Q25 = A. Cost per keystroke. On-demand covers it.                                                                |
| Any auto-send                             | Q24 = A.                                                                                                         |
| Sentiment badges, churn radar, escalation | Q29 = A. Not built at all.                                                                                       |
| Auto-routing by intent                    | Q31 = A.                                                                                                         |
| Any AI write to a business table          | Q28. Everything lands in the composer or a review form.                                                          |
| OCR → ledger posting                      | Q28. Nothing from OCR reaches the GL.                                                                            |
| Per-user fine-tuned models                | Not proposed; a style profile is the substitute and it is **deferred to v2** (§10.6) since autocomplete is gone. |

### 8.2 Architecture

Everything runs through the existing AI stack. **No new provider integration, no parallel gate.**

```
composer / thread view
      │  POST /mail/assist/*
      ▼
src/modules/mail/assist/           NEW module (a subfolder of the mail GROUP — see §3.2)
  assist.routes.js        · flag: mail.ai, permission MOD-72 view, ai-gate on top
  assist.controller.js
  assist.service.js       orchestrates: gather → ground → prompt → fence → return
  assist.prompts.js       every prompt, versioned, in one file, EN+FR
  assist.grounding.js     the whitelisted read set (§8.4) — HEAVILY COMMENTED
  assist.factfence.js     PURE: draft + facts → { ok, violations[] }
  assist.glossary.js      protected terms that must survive rewriting/translation
  assist.guardrails.js    PURE: pre-send checks → { warnings[], blocks[] }
  assist.repo.js
  assist.validator.js
      │
      ▼
src/services/ai/llm.service.js        DeepSeek primary → Gemini fallback (unchanged)
src/services/ai/redact.js             runs before EVERY external call (unchanged)
src/services/ai/retrieval.service.js  pgvector, for semantic search + thread recall
src/services/ai/vision.service.js     Gemini, for OCR
src/services/ai/transcription.service.js  Groq/Whisper, for voice
src/modules/ai/governance/            spend caps, EMV ceiling, per-feature budget (unchanged)
```

**Metering.** Every call records to `ai_usage_ledger` with `feature = 'mail_ai'` and a sub-type
(`draft`, `rewrite`, `translate`, `summary`, `ocr`, `voice`, `search`). This is what makes the monthly
bill predictable instead of a surprise (§3 risk 3). A soft cap warns the tenant; a hard cap degrades
every AI surface to a disabled state with an honest message — never a silent no-op.

### 8.3 Compose assistance (Q26)

`POST /mail/assist/compose` · `{ mode, tone?, thread_id?, draft?, language }`

**Ten tone presets** (`assist.prompts.js`, each with an EN and an FR system prompt):

| #   | Preset                                            | When it is right                                                                                                                                |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formal / corporate                                | First contact, official correspondence                                                                                                          |
| 2   | Friendly professional                             | Established client, routine exchange                                                                                                            |
| 3   | Concise executive                                 | Bulleted, decision-ready, for a director                                                                                                        |
| 4   | Persuasive / commercial                           | Quotations, proposals, winning the business                                                                                                     |
| 5   | Apologetic / service recovery                     | A delay, a damage, a mistake that is ours                                                                                                       |
| 6   | Firm — payment chase                              | Overdue receivable, still a relationship                                                                                                        |
| 7   | Firm — escalation                                 | Repeated failure, consequences named                                                                                                            |
| 8   | Technical / operational precision                 | Carriers, brokers, customs: facts, no warmth                                                                                                    |
| 9   | Warm follow-up                                    | Nudging a quiet thread without pressure                                                                                                         |
| 10  | **Formal notice / contractual (mise en demeure)** | Demurrage notice, claim, force majeure, contractual deadline — measured, dated, quotable, and in OHADA practice often the step before a dispute |

Plus an **"Other…"** free-text instruction, and **five one-click actions**: _Fix grammar_ · _Shorten_ ·
_Expand_ · _Translate → Français_ · _Translate → English_.

**Protected terms glossary** (`assist.glossary.js`). A term in this list **MUST** survive rewriting and
translation byte-for-byte: Incoterms (`FOB`, `CIF`, `DDP`, `EXW`, `CFR`, `DAP`…), HS codes, container
type codes (`20GP`, `40HC`, `40RF`), port and airport codes, OHADA/SYSCOHADA account numbers and names,
document references (anything matching the reference patterns in §7.2), currency codes and amounts,
vessel and voyage numbers, carrier names. The check runs after generation; a violation is repaired by
a targeted second pass, and if it still fails the original term is restored programmatically.

> An LLM "improving" _FOB Douala_ into something friendlier, or translating _compte 411_ as _account
> 411_, is the class of error that reaches a customs broker and costs money. This is why the glossary
> is enforced mechanically rather than requested in a prompt.

**Language.** EN and FR only (Q26), resolved by the single `resolveLanguage()` helper from PR-2 §6.2.

### 8.4 Zero-prompt grounded drafting (Q27)

`POST /mail/assist/draft` · `{ thread_id }` → a draft, plus the facts it used.

Pipeline:

```
thread + accepted binding (PR-3)
  → classify the incoming ask         (where is my container / what do I owe / send me the invoice / …)
  → run ONLY whitelisted reads        (§8.4.1) on the caller's connection with the caller's RBAC
  → redact.js                          before anything leaves the building
  → generate with the fact list pinned in the prompt
  → assist.factfence.js                reject any date / reference / amount not in the facts
  → return { draft_html, draft_text, facts[], confidence, language }
```

#### 8.4.1 The grounding whitelist

`assist.grounding.js`. This file is the security boundary for drafting, and it is written to be read
by whoever extends it:

```js
/**
 * GROUNDING WHITELIST — what the drafting assistant is allowed to know.
 *
 * WHY A WHITELIST AND NOT A BLACKLIST. The assistant drafts messages that go to
 * CUSTOMERS. Anything reachable here can end up in a client's inbox. A blacklist
 * fails open: a module added next year is readable until someone remembers to
 * exclude it. This list fails closed.
 *
 * ── TO ADD A SOURCE ───────────────────────────────────────────────────────
 *  1. Ask first: would it be acceptable for this value to appear, verbatim, in
 *     an email to the client this thread is bound to? If not, stop here.
 *  2. Add an entry with { key, module_key, permission, read(client, ctx), label }.
 *     `read` MUST call the module's SERVICE, never SQL, so RBAC and field
 *     visibility apply exactly as they do in the UI.
 *  3. Every value the read returns must be renderable as a short factual string,
 *     because the fact-fence compares the generated draft against these strings.
 *  4. Add it to the deny-list test in tests/unit/mail-ai-grounding.test.js if it
 *     is adjacent to anything financial-internal.
 *
 * ── PERMANENTLY OUT OF BOUNDS ─────────────────────────────────────────────
 * Do not add, under any framing:
 *   · costing, margin, or the pricing variance index   (our profit on their job)
 *   · payroll, salaries, employee compensation
 *   · supplier buy rates and supplier contract terms   (our cost base)
 *   · other clients' data of any kind
 *   · internal thread notes (PR-3)                     (structurally impossible, and stays that way)
 * These are not "sensitive-ish". Each one, in a client's inbox, is a commercial
 * incident. The list is short on purpose.
 */
module.exports = [
  { key: "dossier_status",    module_key: "MOD-30", permission: "view", … },
  { key: "milestones",        module_key: "MOD-31", permission: "view", … },
  { key: "shipment_tracking", module_key: "MOD-30", permission: "view", … },
  { key: "invoice_status",    module_key: "MOD-46", permission: "view", … },
  { key: "payment_status",    module_key: "MOD-47", permission: "view", … },
  { key: "quote_status",      module_key: "MOD-27", permission: "view", … },
  { key: "client_terms",      module_key: "MOD-03", permission: "view", … },  // payment terms, contacts
  { key: "document_checklist",module_key: "MOD-64", permission: "view", … },  // PR-3
];
```

#### 8.4.2 The fact fence (`assist.factfence.js`, pure)

Extracts every **date**, **reference-shaped token**, **money amount**, **percentage** and **time** from
the generated draft and asserts each appears in the fact list (dates normalised across formats and
both languages). A violation returns the draft to the model once with the specific offending token
named; a second failure drops that sentence and flags the draft as `partial`.

The composer shows a **sources strip** beneath the draft:

> _Facts used · Dossier SLAS-2026-0042 — customs cleared 18 Aug 09:12 · Delivery ETA 18 Aug 14:00 ·
> Invoice INV-2026-0311 — 1 250 000 XAF outstanding, due 25 Aug_

Four facts an operator confirms in two seconds. That is the actual time saving; without it they must
re-verify the whole message and the feature is worthless.

### 8.5 Thread summaries (Q29 = A)

`10750` adds `email_thread_summary (email_thread_id PK, language, summary, message_count_at_generation,
generated_at, model)`. Generated on demand when a thread reaches **5+ messages**, cached, invalidated
when `message_count` changes. Rendered into slot `thread.summary`: 2–3 sentences covering the latest
position, open blockers and explicit next steps, in the reader's UI language.

**No sentiment is computed, stored or displayed anywhere** (Q29). If a future PR wants it, it is a new
decision, not an extension of this one.

### 8.6 Attachment OCR (Q28)

**The rule, stated once and enforced everywhere: extraction produces a staging row and a review form.
Nothing from OCR writes a business record, and nothing from OCR touches the ledger.**

#### `10751_mail_ocr_extraction.sql`

```sql
CREATE TABLE IF NOT EXISTS attachment_extraction (
  attachment_extraction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_attachment_id uuid NOT NULL REFERENCES email_attachment(email_attachment_id) ON DELETE CASCADE,
  doc_kind    text NOT NULL CHECK (doc_kind IN
                ('SUPPLIER_INVOICE','RECEIPT','CLIENT_PO','PROOF_OF_PAYMENT','CHEQUE','UNKNOWN')),
  fields      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- normalised extraction
  raw         text,                                  -- the model's raw answer, for debugging
  matches     jsonb NOT NULL DEFAULT '[]'::jsonb,    -- candidate ERP records + scores
  confidence  numeric(4,3),
  provider    text, model text, page_count integer,  -- provenance, as bank_statement does
  status      text NOT NULL DEFAULT 'EXTRACTED'
                CHECK (status IN ('EXTRACTED','REVIEWED','DISMISSED','FAILED')),
  reviewed_by uuid REFERENCES app_user(user_id),
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

Document kinds, exactly as you scoped them:

| Kind                      | Extracted                                                                            | Review target                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Supplier invoice          | supplier, invoice no, date, currency, subtotal, tax, total, line items, PO reference | Prefill for a **draft supplier invoice**, opened in Procurement — created there by the user |
| Receipt                   | payee, date, amount, currency, category hint                                         | Prefill for an expense/cost entry form                                                      |
| **Client purchase order** | buyer, PO no, date, incoterm, items, quantities, delivery place                      | Prefill for a **quotation** (your stated use: a client PO becomes our quote)                |
| Proof of payment / cheque | payer, bank, amount, date, reference, cheque no                                      | Prefill for payment allocation **review** — not an allocation                               |

The review UI shows the document page beside the extracted fields, each field editable, each with its
confidence, and a **"Create draft in <module>"** button that deep-links exactly as the PR-3 action
cards do (§7.3). Provenance (`provider`, `model`, `page_count`) is stamped the way
`bank_statement.ocr_*` already does — an auditor asking "where did this number come from" must be able
to tell OCR from a machine-readable source.

Worker: `src/jobs/handlers/mail-ocr-extract.js`, triggered on `email.attachment.stored` for PDFs and
images under the vault cap, rate-limited per tenant, budget-metered.

### 8.7 Voice-to-professional-text (Q30)

Composer button → `MediaRecorder` (`audio/webm;codecs=opus`, already handled by
`transcription.service.extFor`) → `POST /mail/assist/voice` → Groq/Whisper → a cleanup pass that strips
fillers, restores punctuation and paragraphs, applies the chosen tone and adds a greeting and sign-off
→ inserted into the editor for review.

**Audio is not retained** (Q30): the buffer is transcribed and discarded; only the text is kept, and
the raw transcript is shown once beside the cleaned version so the user can see what was changed.
Recording is explicit press-and-hold or click-to-toggle with a visible level meter and elapsed time —
never ambient capture.

### 8.8 Pre-send guardrails (Q30)

`assist.guardrails.js` — pure, runs on the composed message before it is queued.

**Warnings** (dismissible, shown in slot `composer.presend`):

| Check                  | Trigger                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Missing attachment     | Body says _attached / attaché / ci-joint / please find / veuillez trouver_ and there is none   |
| Recipient mismatch     | A recipient's domain does not match the thread's bound entity                                  |
| Unintended tone        | The model reads the draft as aggressive when the selected tone was not one of the firm presets |
| Reply-all width        | More than 10 recipients on a reply-all                                                         |
| No subject             | Empty subject                                                                                  |
| Unresolved placeholder | `[amount]`, `XXX`, `TBD`, `<name>`, `lorem`                                                    |
| Out of hours           | Send time is outside the recipient's working hours (informational; PR-5 offers to schedule)    |
| Oversized HTML         | Body over 102 KB (Gmail clips)                                                                 |
| Language mismatch      | Drafting in EN to a party whose `preferred_language` is FR                                     |

**One hard block:** a message carrying a financial document (invoice, proforma, statement, bank
details) to a domain the anti-spoofing check rates **Suspicious** or **Likely impersonation**.
Overridable only by typing a reason, which is written to `immutable_ledger`.

In PR-4 the block's verdict source is a stub returning `Verified` until PR-5 lands the real check
(§9.7); the wiring, the override and the ledger entry are all built and tested here so PR-5 only
supplies the verdict.

### 8.9 Semantic search (Q7, second half)

The FTS search from PR-1 gains a _"Search by meaning"_ toggle: the query is embedded and matched
against mail chunks in the existing `ai_chunk` corpus (ingested by `ingest.service` on
`email.received`, respecting the tenant's `ai.vectorization` flag), then merged with the keyword
results and de-duplicated. Keyword remains the default; semantic is opt-in per search, because it
costs an embedding call and keyword is right most of the time.

### 8.10 AI action catalogue

Extend `src/modules/mail/mail/mail.ai.js` with **reads only** — the copilot may read a thread, a
summary or a client timeline, and it may draft. It **MUST NOT** gain a new write beyond the existing
confirmed `send_mail` / `reply_mail`, and those keep `confirm: true`.

### 8.11 Acceptance criteria

1. Selecting _Firm — payment chase_ on an empty composer, for a thread bound to a client with an
   overdue invoice, produces a bilingual-correct draft naming the real invoice number and amount.
2. Every date, reference and amount in a generated draft appears in the sources strip; a fabricated
   one is caught by the fence and never reaches the editor.
3. Asking for a draft on a thread bound to nothing produces a tone-appropriate draft with **no ERP
   facts** and says so, rather than inventing any.
4. _Translate → Français_ preserves `FOB`, `40HC`, `SLAS-2026-0042` and `compte 411` exactly.
5. A thread of 8 messages shows a 2–3 sentence summary; a 4-message thread shows none.
6. A PDF supplier invoice produces extracted fields with confidences and **creates nothing**; the user
   reaches a prefilled draft in Procurement only by clicking through.
7. **No AI path writes to any business table.** Asserted by test.
8. Dictating 45 seconds produces clean, paragraphed, signed-off prose; the audio is not persisted.
9. Sending "see attached" with no attachment warns; sending an invoice to a suspicious domain blocks
   until a reason is typed, and the reason is on the immutable ledger.
10. With `ai.assistant.backend` off, every AI surface is absent — not present-and-erroring.
11. Hitting the tenant's hard budget cap disables the AI surfaces with an explicit message.

### 8.12 Tests

`tests/unit/`: `mail-ai-factfence.test.js` · `mail-ai-grounding.test.js` (**deny-list enforcement**) ·
`mail-ai-glossary.test.js` · `mail-ai-prompts.test.js` (all 10 presets × EN/FR resolve) ·
`mail-ai-guardrails.test.js` · `mail-ocr-extract.test.js` (fixtures per doc kind) ·
`mail-ai-nowrite.test.js` (**no AI path calls a create/update service**) · `mail-ai-budget.test.js`.
`tests/integration/`: `mail-ai-draft.test.js` end-to-end against a stubbed LLM.

### 8.13 Task list

```
A1  assist module skeleton, routes behind mail.ai + the ai.assistant.backend ceiling + metering
A2  assist.prompts.js — 10 presets × EN/FR + 5 actions; assist.glossary.js + its test
A3  Compose/rewrite/translate endpoints + composer AI menu (slot composer.toolbar.right)
A4  assist.grounding.js (whitelist + the comment block verbatim) + the deny-list test
A5  assist.factfence.js (pure) + tests; draft endpoint; sources strip UI
A6  10750 summaries + generation + cache invalidation + thread.summary slot
A7  10751 + mail-ocr-extract worker + the four doc kinds + matching + review UI
A8  Voice capture UI + /assist/voice + cleanup pass; assert no audio retention
A9  assist.guardrails.js + presend slot + hard-block wiring with the PR-5 stub + ledger override
A10 Semantic search toggle; ai_chunk ingestion on email.received
A11 mail.ai.js reads; scripts/ai/sync-actions.js run; screen-registry actions[] updated
A12 i18n; tests per §8.12
```

---

## 9. PR-5 — Workflow, Security & Compliance

> **Goal.** A team can run `support@` and `billing@` without stepping on each other, nothing gets
> forgotten, sensitive correspondence stays sensitive, an auditor can be satisfied in an afternoon,
> and a lookalike-domain invoice fraud gets stopped at the banner.

**Flags:** `mail.shared_inbox` (assignment/SLA), `mail.followup`, `mail.secure_links`, `mail.archive`,
`mail.antispoof`. **Migrations:** `10755`–`10764`. **Depends on:** PR-1, PR-3.
**Parallel with:** PR-4.

### 9.1 Scope

**In.** Shared-inbox claim, assignment and soft locks · status flags · SLA timers on tenant business
hours · delegated mailboxes · follow-up boomerang · scheduled send and recipient-local-time delivery ·
secure expiring links · hash-chained immutable archive · Private/Team/Company visibility with audited
break-glass · ERP-validated anti-spoofing with lookalike detection · DSN/bounce handling.

**Out.** Telemetry of any kind (Q32) · auto-routing and auto-forwarding (Q31) · PIN-protected links
(Q33) · peak-open-hour optimisation (§1.4) · true WORM object storage (documented upgrade path, §9.6).

### 9.2 Shared inbox — claim, not routing (Q31)

#### `10755_mail_assignment_sla.sql`

```sql
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES app_user(user_id);
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS work_status text NOT NULL DEFAULT 'OPEN'
  CHECK (work_status IN ('OPEN','PENDING','RESOLVED'));
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS first_response_due_at timestamptz;
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS resolution_due_at timestamptz;
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS first_responded_at timestamptz;
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS sla_breached_at timestamptz;

CREATE TABLE IF NOT EXISTS mail_sla_policy (
  mail_sla_policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email_connection_id uuid REFERENCES email_connection(email_connection_id) ON DELETE CASCADE,
  applies_to_vip boolean NOT NULL DEFAULT false,
  first_response_minutes integer NOT NULL,
  resolution_minutes     integer NOT NULL,
  business_hours_only    boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS business_hours (
  business_hours_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at time NOT NULL, closes_at time NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Douala'
);
CREATE TABLE IF NOT EXISTS business_holiday (
  business_holiday_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_on date NOT NULL UNIQUE, name text
);

-- Soft lock: advisory, short-lived, and refreshed by a heartbeat.
CREATE TABLE IF NOT EXISTS email_thread_lock (
  email_thread_id uuid PRIMARY KEY REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
```

**Seeded SLA policy** (the tiers I proposed and you did not override): first response **4 business
hours**, **1 hour** for VIP; resolution **2 business days**. Business hours seeded Mon–Fri
08:00–17:00 `Africa/Douala`, with Cameroonian public holidays. All tenant-editable.

**Claim, not routing.** A thread in a shared mailbox is unassigned until someone claims it (or a lead
assigns it). An optional round-robin assigns on arrival for teams that want it — off by default.
**There is no intent classifier and no forwarding anywhere in this PR** (Q31).

**Soft lock UX.** Opening the composer on a shared thread takes a 2-minute lock, refreshed every 30 s
while typing. A colleague opening the same thread sees _"Marie started replying 40 seconds ago"_ with
the option to continue anyway — advisory, never a hard block, because a stale lock that blocks a
customer reply is worse than a duplicated one.

**SLA clocks** run in `src/jobs/handlers/mail-sla-sweep.js` (BullMQ repeatable, 5 min), computing
against business hours and holidays, emitting `mail.sla.breached` to the team lead through the
notification service. Clocks pause in `PENDING` (waiting on the customer) and stop on
`RESOLVED` or on the first outbound message for the first-response clock.

**Delegated mailboxes** (Q6, third kind): `email_connection.kind='DELEGATED'` plus a member row grants
a named user access to another user's mailbox. Every read and send on a delegated mailbox writes an
`immutable_ledger` row naming the delegate and the owner, and outbound mail carries a
`Sender:` header distinct from `From:` — which is both correct RFC 5322 and the honest thing to do.

### 9.3 Follow-up boomerang and scheduled send (§1.4)

#### `10756_mail_followup.sql`

```sql
CREATE TABLE IF NOT EXISTS email_followup (
  email_followup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_thread_id uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('SNOOZE','NO_REPLY','SEQUENCE_STEP')),
  due_at       timestamptz NOT NULL,
  cancel_on_reply boolean NOT NULL DEFAULT true,
  note         text,
  sequence_id  uuid,  step_index integer,
  status       text NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','FIRED','CANCELLED')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_followup_due ON email_followup(due_at) WHERE status='PENDING';
```

- **Snooze** — hide the thread, bring it back at a chosen time.
- **No-reply boomerang** — _"return this to my inbox in 3 days if they haven't replied"_, exactly the
  behaviour described in the brief. `cancel_on_reply` is enforced on ingest: a new inbound message on
  the thread cancels every pending `NO_REPLY` follow-up for it.
- **Multi-step sequences** — a small ordered set of reminders (day 3, day 7, day 14), auto-pausing the
  whole sequence on a client reply. These are **reminders to a human**, never automatic sends
  (Q24 forbids auto-send, and that applies here too).

`src/jobs/handlers/mail-followup-sweep.js` fires due rows into the notification service.

**Scheduled send and recipient-local time.** `POST /mail/send` accepts `{ send_at }` or
`{ send_in_recipient_morning: true }`, writing `email_send_queue.release_at` accordingly. Recipient
timezone comes from a new `party.timezone` column (`10757`), defaulted from the party's country. The
UI states plainly: _"Delivers at 09:00 Tuesday, Paris time."_

**MUST NOT** offer or imply "best time to send" optimisation. Open data does not exist (Q32) and the
UI must not pretend otherwise.

### 9.4 Secure ephemeral links (Q33)

#### `10758_secure_link.sql`

```sql
CREATE TABLE IF NOT EXISTS secure_link (
  secure_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL UNIQUE,          -- SHA-256 of the token; the token is never stored
  target_kind  text NOT NULL CHECK (target_kind IN ('VAULT_DOC','GENERATED_PDF')),
  target_ref   text NOT NULL,
  entity_ref   text,                           -- for the CRM timeline
  label        text,
  created_by   uuid NOT NULL REFERENCES app_user(user_id),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  first_viewed_at timestamptz,
  view_count   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS secure_link_view (
  secure_link_view_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secure_link_id uuid NOT NULL REFERENCES secure_link(secure_link_id) ON DELETE CASCADE,
  ip inet, user_agent text, viewed_at timestamptz NOT NULL DEFAULT now()
);
```

Modelled directly on `proposal.share()` (`sales/proposal/proposal.service.js`) — read it first; the
token/hash/expiry/revoke discipline is already proven there. Generalised so any vault document or
generated PDF can be shared.

Defaults: **7-day expiry**, unlimited views, revocable at any moment from the thread. Public route
`GET /public/secure/:token` (no auth, rate-limited, no directory listing, `X-Robots-Tag: noindex`).

**Composer integration:** attachments over 10 MB (§5.5.6) offer _"Send as a secure link instead"_, and
any attachment can be converted to one manually. The link's views land on the client's CRM timeline —
this is the **only** open signal in the product, and it is precise, first-party and unaffected by
image blocking. It is the reason Q32's answer costs you nothing commercially.

**PIN is not built** (Q33 = A). `secure_link` has room for it and the service has a documented
extension point; adding it later is a column and a form field, not a redesign.

### 9.5 Visibility (Q34)

#### `10759_mail_visibility.sql`

```sql
ALTER TABLE email_thread ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'PRIVATE'
  CHECK (visibility IN ('PRIVATE','TEAM','COMPANY'));
CREATE TABLE IF NOT EXISTS email_thread_share (
  email_thread_id uuid NOT NULL REFERENCES email_thread(email_thread_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  granted_by uuid REFERENCES app_user(user_id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email_thread_id, user_id)
);
```

Defaults inherited from the connection (`10739`): **Personal → Private**, **Shared → Team**.
Threads on a mailbox belonging to Finance or an executive default to Private regardless.

Enforcement is a **single repo-level predicate** applied to every thread and message read:

```sql
-- visibilityClause(userId) — one function, used by list, get, search, timeline,
-- context, AI grounding and export. A second copy of this rule is a leak.
(  t.visibility = 'COMPANY'
OR (t.visibility = 'TEAM'    AND EXISTS (SELECT 1 FROM email_connection_member m
                                          WHERE m.email_connection_id = t.email_connection_id
                                            AND m.user_id = $userId))
OR (t.visibility = 'PRIVATE' AND (c.owner_user_id = $userId
                                  OR EXISTS (SELECT 1 FROM email_thread_share s
                                              WHERE s.email_thread_id = t.email_thread_id
                                                AND s.user_id = $userId))))
```

**Break-glass.** The God-Mode role can read anything, and every such read writes an
`immutable_ledger` row (`action = 'mail.breakglass.read'`) with the thread, the actor and a required
reason. The UI makes this deliberate: a confirmation dialog that says the access will be logged and
attributed.

**MUST:** the AI grounding layer (PR-4) and the search index respect the same predicate. An assistant
that summarises a thread the caller cannot open is the same leak by another route.

### 9.6 Immutable archive (Q34)

#### `10760_mail_archive_chain.sql`

```sql
CREATE TABLE IF NOT EXISTS email_archive (
  email_archive_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_message_id uuid NOT NULL UNIQUE REFERENCES email_message(email_message_id),
  seq            bigint GENERATED ALWAYS AS IDENTITY,
  content_hash   text NOT NULL,        -- SHA-256 over canonicalised headers+body+attachment hashes
  prev_hash      text,                 -- the previous row's chain_hash
  chain_hash     text NOT NULL,        -- SHA-256(prev_hash || content_hash)
  attachment_hashes text[] NOT NULL DEFAULT '{}',
  archived_at    timestamptz NOT NULL DEFAULT now()
);
```

- Every message, in and out, is archived at ingest or at send.
- Deletion of an archived message is **blocked in the service layer for every role including the CEO**;
  a purge attempt itself emits an `immutable_ledger` entry.
- `GET /mail/archive/verify` walks the chain and reports the first break, so verification is a button
  rather than a project.
- Bodies and attachments stay in `document_vault` under its existing 10-year retention.

> **What "immutable" honestly means here.** Append-only with a verifiable hash chain: nobody can alter
> or remove a message without the chain proving it. It is not physically undeletable. The upgrade to
> that is **S3 Object Lock in compliance mode**, which becomes available when object storage moves off
> local disk (the README's plan). At that point it is a `storage.service` configuration change, not a
> code change. Say this to an auditor in these words; do not overclaim.

### 9.7 ERP-validated anti-spoofing (Q35)

#### `10761_mail_antispoof.sql`

```sql
CREATE TABLE IF NOT EXISTS party_verified_domain (
  party_verified_domain_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_kind  text NOT NULL CHECK (party_kind IN ('CLIENT','SUPPLIER')),
  party_id    uuid NOT NULL,
  domain      citext NOT NULL,
  source      text NOT NULL CHECK (source IN ('ADMIN_VERIFIED','OBSERVED','IMPORTED')),
  verified_by uuid REFERENCES app_user(user_id),
  verified_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  UNIQUE (party_kind, party_id, domain)
);
ALTER TABLE email_message ADD COLUMN IF NOT EXISTS auth_verdict text
  CHECK (auth_verdict IN ('VERIFIED','UNVERIFIED','SUSPICIOUS','LIKELY_IMPERSONATION'));
ALTER TABLE email_message ADD COLUMN IF NOT EXISTS auth_detail jsonb NOT NULL DEFAULT '{}'::jsonb;
```

`antispoof.evaluate(message, {parties})` — pure, four inputs:

1. **`Authentication-Results`** from the receiving server: SPF, DKIM, DMARC verdicts and alignment.
2. **Exact domain match** against `party_verified_domain` for the thread's bound party.
3. **Lookalike detection** — against every known party domain: Levenshtein ≤ 2, homoglyph and IDN
   substitution (`rn`→`m`, Cyrillic `а`, `0`→`o`), added or dropped hyphens, and TLD swaps
   (`.cm` ↔ `.com` ↔ `.co`). **This is the check that catches real fraud**: `smartlogistics-cm.com`
   passes SPF perfectly because the attacker owns it, so header authentication alone saves nobody.
4. **First contact from a new domain claiming a known party** — the display name matches a known
   party but the domain has never been seen.

| Verdict                | UI                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `VERIFIED`             | Quiet — a small tick on the sender                                                                           |
| `UNVERIFIED`           | Subtle grey note; offer _"Mark this domain as belonging to <party>"_ (writes `ADMIN_VERIFIED`)               |
| `SUSPICIOUS`           | Amber banner naming the specific reason                                                                      |
| `LIKELY_IMPERSONATION` | Full-width red interstitial hiding the body until acknowledged; blocks the financial-document send from §8.8 |

**Bank-detail-change escalation.** A message whose body matches bank-change language (account number,
IBAN, _"new bank details"_, _"nouvelles coordonnées bancaires"_, _"updated remittance"_) from anything
other than `VERIFIED` is escalated to `SUSPICIOUS` regardless of its other signals, and notifies
Finance. This single rule is the highest-value line of code in the programme: it is precisely the
attack that takes money out of freight forwarders.

`OBSERVED` domains accrue automatically from correspondence history but **never** confer `VERIFIED` on
their own — that requires a human, in the UI, once.

### 9.8 Bounce and DSN handling (addition c)

#### `10762_mail_bounce.sql`

```sql
CREATE TABLE IF NOT EXISTS email_bounce (
  email_bounce_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_message_id uuid REFERENCES email_message(email_message_id),
  original_message_id_header text,
  recipient   citext NOT NULL,
  bounce_type text NOT NULL CHECK (bounce_type IN ('HARD','SOFT','COMPLAINT','DELAY')),
  status_code text,                    -- RFC 3463 enhanced status, e.g. 5.1.1
  diagnostic  text,
  reported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE client_contact   ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'OK'
  CHECK (email_status IN ('OK','SOFT_FAILING','HARD_FAILED'));
ALTER TABLE supplier_contact ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'OK'
  CHECK (email_status IN ('OK','SOFT_FAILING','HARD_FAILED'));
```

Inbound messages with `Content-Type: multipart/report; report-type=delivery-status` are parsed rather
than shown as ordinary mail: correlate by `Message-ID` to the original, classify by enhanced status
code, mark the recipient, and surface it on the original thread as _"Delivery failed to
x@y.cm — mailbox does not exist"_. A `HARD_FAILED` address is warned about in the composer before the
next send. This ends the "we emailed the invoice three times" failure permanently.

DSNs are also routed to the **System stream** by the seeded rules from PR-1 (§5.5.3), so they do not
clutter the human inbox while still being visible on the thread they belong to.

### 9.9 Endpoints

| Method          | Path                                                                     | Action                              |
| --------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| POST            | `/mail/threads/:id/claim` · `/assign` · `/status`                        | edit                                |
| POST            | `/mail/threads/:id/lock` · DELETE                                        | edit                                |
| GET/POST/PATCH  | `/mail/sla-policies`                                                     | view / edit                         |
| GET/PUT         | `/mail/business-hours` · `/mail/holidays`                                | view / edit                         |
| POST            | `/mail/threads/:id/snooze` · `/followup` · DELETE `/followup/:id`        | edit                                |
| POST            | `/mail/secure-links` · GET · POST `/:id/revoke`                          | create / view / edit                |
| GET             | `/public/secure/:token`                                                  | public, rate-limited                |
| PATCH           | `/mail/threads/:id/visibility` · POST `/share` · DELETE `/share/:userId` | edit                                |
| POST            | `/mail/threads/:id/breakglass`                                           | approve (God-Mode), always ledgered |
| GET             | `/mail/archive/verify`                                                   | view (MOD-70)                       |
| GET/POST/DELETE | `/mail/verified-domains`                                                 | view / edit                         |
| GET             | `/mail/bounces`                                                          | view                                |

### 9.10 Acceptance criteria

1. Two agents opening the same shared thread: the second sees the first is replying, and can proceed.
2. A thread arriving Friday 16:30 with a 4-business-hour SLA is due Monday 10:30, not Saturday.
3. Marking `PENDING` pauses the clock; a client reply resumes it.
4. A 3-day no-reply boomerang returns the thread; a client reply on day 2 cancels it silently.
5. Scheduling for a Paris client's 09:00 sends at 08:00 Douala time in summer and 09:00 in winter
   (DST handled by the IANA zone, not an offset).
6. A secure link opens once, is logged on the client's timeline, and 404s after expiry and after revoke.
7. A Private thread is invisible to a colleague holding MOD-72 view — in the list, in search, in the
   client timeline and to the AI.
8. A break-glass read produces an `immutable_ledger` row with actor, thread and reason.
9. Editing an archived body directly in the database makes `/mail/archive/verify` report the break.
10. `smartlogistics-cm.com` claiming to be `smartlogistics.cm` is flagged `LIKELY_IMPERSONATION`
    despite a passing SPF, and blocks an invoice send until a reason is typed.
11. A "new bank details" message from an unverified domain escalates and notifies Finance.
12. A hard bounce marks the contact and warns before the next send to it.
13. **No tracking pixel and no rewritten link exists anywhere in an outbound message.** Asserted by test.

### 9.11 Tests

`tests/unit/`: `mail-sla-clock.test.js` (business hours, holidays, DST, pause/resume) ·
`mail-followup.test.js` (cancel-on-reply) · `mail-antispoof.test.js` (Levenshtein, homoglyph, TLD swap,
bank-change escalation) · `mail-archive-chain.test.js` · `secure-link.test.js` (expiry, revoke, hash
never stores the token) · `mail-bounce-parse.test.js` (RFC 3464 fixtures).
`tests/security/`: `mail-visibility.test.js` (every read path, including AI and search) ·
`mail-no-telemetry.test.js` (**no pixel, no link rewriting, in any outbound path**).
`tests/integration/`: `mail-shared-inbox.test.js` (claim race under concurrency) ·
`mail-scheduled-send.test.js`.

### 9.12 Task list

```
W1  10755 assignment/SLA/business hours/locks + seed policy and Cameroon holidays
W2  Claim/assign/status endpoints; soft lock + heartbeat; presence integration with PR-1
W3  mail-sla-sweep worker; pause/resume; breach notification to team leads
W4  Delegated mailbox kind: access rules, Sender: header, per-access ledger row
W5  10756 + 10757 party timezone; followup service; snooze/boomerang/sequence; cancel-on-reply on ingest
W6  Scheduled send via email_send_queue.release_at; recipient-local-time UI (no "best time" claims)
W7  10758 secure_link generalised from proposal.share; public route; revoke; timeline events
W8  Composer integration for >10 MB offload and manual conversion
W9  10759 visibility + the SINGLE visibilityClause predicate applied to every read path
W10 Break-glass flow + ledger + confirmation UI
W11 10760 archive chain, ingest/send hooks, delete block, /archive/verify
W12 10761 verified domains + antispoof.evaluate + lookalike + bank-change rule + verdict UI
W13 Wire PR-4's hard block to the real verdict; remove the stub
W14 10762 bounce parsing, contact status, composer warning
W15 10763 events, 10764 flags; i18n; screen-registry; tests per §9.11
```

---

## 10. Appendices

### 10.1 Migration index

| File                                   | PR    | What it does                                                                                                       |
| -------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `10723_mail_connection_foundation.sql` | **0** | Connection `kind` / `visibility` / `entity_id` / ARCHIVED / health, and the one-live-personal-mailbox unique index |
| `10724_mail_shared_catalogue.sql`      | **0** | `mail_shared_catalogue` + the seven seeded team addresses                                                          |
| `10725_mail_access_grant.sql`          | **0** | `email_connection_member` (VIEWER/AGENT/MANAGER) + `email_access_audit`                                            |
| `10726_mail_send_point.sql`            | **0** | `mail_send_point` + `mail_send_point_binding` (per-entity) + 22 seeded send points                                 |
| `10727_mail_origin_tag.sql`            | **0** | `sent_via`, `message_id_header`, `origin_user_id`, `origin_send_point` on `email_inbound`                          |
| `10728_mail_limits.sql`                | **0** | Per-mailbox send throttles, sync depth, `email_send_window`                                                        |
| `10729_mail_foundation_events.sql`     | **0** | Eight mailbox / access / routing event types                                                                       |
| `10730_mail_defaults_and_flags.sql`    | **0** | The `mail` settings section and all fourteen `mail.*` flags                                                        |
| `10731_mail_thread_message.sql`        | 1     | `email_thread`, `email_message`, `email_message_state`; backfill; `email_inbound` → view                           |
| `10732_mail_folders_labels.sql`        | 1     | `email_folder` (per-folder cursors), `email_label`, `email_thread_label`                                           |
| `10733_mail_search.sql`                | 1     | `search_tsv` + GIN + weighting trigger                                                                             |
| `10734_mail_outbound_attachment.sql`   | 1     | Attachments both directions, inline `cid:`, disposition                                                            |
| `10735_mail_draft_and_queue.sql`       | 1     | `email_draft`, `email_send_queue`                                                                                  |
| `10736_mail_stream_rules.sql`          | 1     | `email_stream_rule` + seeds; `is_vip` on client/supplier                                                           |
| `10737_mail_events.sql`                | 1     | New `event_type` rows                                                                                              |
| `10740_signature_engine.sql`           | 2     | `signature_template`, `user_signature_profile`, `signature_render`                                                 |
| `10741_signature_seed.sql`             | 2     | Three templates + department defaults                                                                              |
| `10742_party_language.sql`             | 2     | `preferred_language` on client/supplier/lead                                                                       |
| `10743_mail_domain_health.sql`         | 2     | `domain_health_check`                                                                                              |
| `10744_signature_events.sql`           | 2     | Signature + deliverability event types                                                                             |
| `10745_mail_binding_suggestion.sql`    | 3     | `email_binding_suggestion`                                                                                         |
| `10746_mail_thread_note_mention.sql`   | 3     | `email_thread_note`, `mention`                                                                                     |
| `10747_party_document_checklist.sql`   | 3     | `document_requirement`, `email_attachment_classification`                                                          |
| `10748_mail_conversion.sql`            | 3     | Conversion link-back columns + indexes                                                                             |
| `10749_mail_binding_events.sql`        | 3     | Binding, note, mention, filing event types                                                                         |
| `10750_mail_thread_summary.sql`        | 4     | `email_thread_summary`                                                                                             |
| `10751_mail_ocr_extraction.sql`        | 4     | `attachment_extraction`                                                                                            |
| `10752_mail_ai_events.sql`             | 4     | AI-surface event types                                                                                             |
| `10755_mail_assignment_sla.sql`        | 5     | Assignment, work status, SLA, business hours, locks                                                                |
| `10756_mail_followup.sql`              | 5     | `email_followup`                                                                                                   |
| `10757_party_timezone.sql`             | 5     | `timezone` on client/supplier/lead                                                                                 |
| `10758_secure_link.sql`                | 5     | `secure_link`, `secure_link_view`                                                                                  |
| `10759_mail_visibility.sql`            | 5     | Thread `visibility`, `email_thread_share`                                                                          |
| `10760_mail_archive_chain.sql`         | 5     | `email_archive` hash chain                                                                                         |
| `10761_mail_antispoof.sql`             | 5     | `party_verified_domain`, `auth_verdict`                                                                            |
| `10762_mail_bounce.sql`                | 5     | `email_bounce`, contact `email_status`                                                                             |
| `10763_mail_workflow_events.sql`       | 5     | SLA, follow-up, secure link, break-glass event types                                                               |
| `10764_mail_workflow_flags.sql`        | 5     | PR-5 feature flags                                                                                                 |

### 10.2 Feature flag index

`mail.core` · `mail.composer` · `mail.shared_inbox` · `mail.provider.oauth` _(off)_ ·
`mail.signatures` · `mail.deliverability` · `mail.binding` · `mail.notes` · `mail.doc_intake` ·
`mail.ai` · `mail.followup` · `mail.secure_links` · `mail.archive` · `mail.antispoof`.

All default **off**; all seeded **on for the `smartls` tenant** (Q5). `mail.ai` additionally requires
`ai.assistant.backend`.

### 10.3 New environment variables

| Var                               | Default                                                  | Purpose                                  |
| --------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| `MAIL_UNDO_WINDOW_SECONDS`        | `20`                                                     | Default undo-send window                 |
| `MAIL_SEND_FLUSH_INTERVAL_MS`     | `5000`                                                   | Send-queue flusher cadence               |
| `MAIL_FOLDER_SYNC_LIMIT`          | `25`                                                     | Max syncable folders per connection      |
| `MAIL_ATTACH_MAX_BYTES`           | `26214400`                                               | 25 MB hard cap                           |
| `MAIL_ATTACH_OFFLOAD_BYTES`       | `10485760`                                               | 10 MB → offer a secure link              |
| `MAIL_HTML_MAX_BYTES`             | `104448`                                                 | 102 KB Gmail clip warning                |
| `MAIL_SECURE_LINK_DAYS`           | `7`                                                      | Default link expiry                      |
| `MAIL_SLA_SWEEP_INTERVAL_MS`      | `300000`                                                 | SLA clock sweep                          |
| `MAIL_DELIVERABILITY_INTERVAL_MS` | `86400000`                                               | Daily domain health re-check             |
| `MAIL_RBL_HOSTS`                  | `zen.spamhaus.org,bl.spamcop.net,b.barracudacentral.org` | Public blocklists                        |
| `MAIL_AI_MONTHLY_CAP_XAF`         | —                                                        | Soft/hard budget for `feature='mail_ai'` |

Everything else reuses existing configuration. No new third-party service, no new paid dependency.

### 10.4 New npm dependencies

| Package                                             | Where  | Why                                         |
| --------------------------------------------------- | ------ | ------------------------------------------- |
| `@tiptap/react`, `@tiptap/starter-kit` + extensions | client | The editor (Q8). **Lazy-loaded** — see §3.7 |
| `juice` _(or an equivalent inliner)_                | server | CSS inlining for the outbound serializer    |
| `mailparser`                                        | server | Already present — reused for DSN parsing    |
| `puppeteer`                                         | server | Already present — reused for signature PNG  |

No new backend service, no new database, no new queue. That is deliberate: this deployment is a
self-managed VPS and every added daemon is someone's weekend.

### 10.5 Definition of done, per PR

A PR is done when **all** of the following hold:

1. Every acceptance criterion in its chapter passes, demonstrated, not asserted.
2. `npm run ci` green, including `db:check:idempotency`, `db:check:columns`, and the client's
   `check:bundle`, `check:contrast`, `check:motion`, `check:palette`, `check:schemas`, `check:docs`.
3. Every new endpoint appears in `doc/API_REFERENCE.md` via `scripts/generate-api-docs.js`
   (**regenerate; never hand-format — it is byte-compared in CI**).
4. Every new screen has a `client/src/app/screen-registry.json` entry with its `module_key`, purpose
   and reachable `actions[]`.
5. EN and FR strings at parity; no hard-coded user-visible English.
6. Every new route declares its RBAC action, and the action **describes what the endpoint does** —
   the standard `smartcomm.routes.js` sets out at length.
7. New tables have FK indexes (the repo has a `0500_fk_indexes.sql` precedent) and `created_at`
   indexes where they are listed.
8. Migrations carry a commented-out rollback block.
9. Flags default off, and the PR states which tenant is enabled for the pilot.

### 10.6 Deferred to v2 (recorded, not forgotten)

| Item                                                     | Why deferred                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Keyboard-first inbox shortcuts                           | Addition (g) — your call                                                               |
| Inline as-you-type autocomplete + per-user style profile | Q25 — revisit with accepted-draft data                                                 |
| PIN-protected secure links                               | Q33 — the schema and service already have the hook                                     |
| Sentiment / churn radar                                  | Q29 — a fresh decision, not an extension                                               |
| Auto-routing by intent                                   | Q31                                                                                    |
| Read/click telemetry                                     | Q32 — would need a legal review first                                                  |
| S3 Object Lock WORM archive                              | Blocked on the move to S3; then configuration, not code                                |
| Gmail / Microsoft 365 feature parity                     | Q4/Q11 — adapters retained and working, no new work                                    |
| Provider-side draft sync                                 | Q11                                                                                    |
| Full arbitrary folder-tree sync with create/delete       | Q3 — canonical six chosen; the schema stores the raw provider path so this is additive |
| Paid IP-reputation feed                                  | Q35 — `MAIL_RBL_HOSTS` is already the extension point                                  |
| Packing-list and customs-declaration OCR                 | Q28 — after the first four kinds prove out                                             |
| Promoting `phone_desk`/`phone_mobile` onto `employee`    | Q14 — one change in `signature.resolve.js` when HR master data is next touched         |
| Multi-step automated send sequences                      | Q24 forbids auto-send; reminders only for now                                          |
| "Unbound thread" nudge                                   | Addition (b) — declined                                                                |

### 10.7 The three things most likely to go wrong

Written down so the person hitting them recognises the symptom.

1. **Mail silently 404s after someone adds a subfolder under `src/modules/mail/`.** The module-loader
   reclassifies the directory as a group and ignores `mail.routes.js`. There is no boot error. §3.2
   exists for this; do Task 0 first.
2. **The `email_inbound` view drifts from its consumers.** Anything selecting a column the view does
   not expose fails at runtime, not at migration time. `npm run db:check:columns` is the gate — run it
   after every migration in PR-1, not just at the end.
3. **The dossier drawer quietly gets slow.** It opens on every thread click, so a regression is felt
   immediately and blamed on "the inbox". The ≤ 6-statement CI assertion in §7.5 is what keeps a
   well-meaning `party-360` call from being added later.

---

## 11. Closing note on scope

Twenty-four capabilities across five PRs is a substantial programme — comfortably three to four months
of focused full-stack work at the standard this codebase already holds itself to (migrations,
validators, RBAC, AI manifests, tests, i18n, accessibility, docs regeneration).

The answers cut it down considerably, and sensibly: dropping telemetry, sentiment, auto-routing and
inline autocomplete removed four subsystems that carried the most risk and the least certain value.
What is left is a mail client an operator would actually prefer, wired into the ERP that makes it
worth having.

Two things are worth deciding early, before PR-1 merges:

- **Who pilots it.** The flags are seeded on for `smartls` only. A week of one team's real use after
  PR-1 will change PR-3's dossier-pane priorities more usefully than any amount of further design.
- **The v1 line inside each PR.** Each chapter's task list is ordered so that stopping after roughly
  two-thirds still ships something coherent. If the calendar tightens, cut from the bottom of a task
  list rather than starting a sixth PR.
