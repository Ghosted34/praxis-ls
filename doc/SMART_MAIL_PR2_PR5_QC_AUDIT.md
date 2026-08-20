# Smart Mail — QC audit of PR-2 → PR-5 as merged

**Date:** 2026-08-20
**Subject:** commit `980bd6d8` *feat(mail): Smart Mail PR-2 through PR-5 — signatures, binding, AI,
workflow* (merged as PR #238), plus `daf66287`, `334d7202`, `c47108cd`.
**Measured against:** `doc/SMART_MAIL_ENGINEERING_GUIDE.md` §6–§9 and §3.7.
**Method:** every table, service, endpoint, worker, event handler and test named in the guide was
looked for by name in the tree, and every leaf module was checked for a caller.

---

## 1. The finding in one paragraph

The four chapters were merged as one commit and the build is green: 4,518 backend tests pass. The
green build is not evidence of much. **Every migration in §6–§9 landed and the schema is complete and
correct** — all 22 tables and every column the guide specifies exist. **Most of the leaf logic landed
too, and it is good code**: `antispoof.evaluate`, `archive-chain`, `sla-clock`, `bounce-parse`,
`visibility.clause`, `binding.extract` are all present, readable and, where tested, correct. What is
missing is the wiring between the two. Eleven of the tables the migrations created are referenced by
**zero lines of application code**. Several of the pure modules that the test suite exercises directly
are called by **nothing**. The features are, in the literal sense, not connected.

## 2. The eleven orphan tables

Created by a migration in this programme; read or written by no `src/` file:

| Table | Migration | Chapter | Consequence |
| --- | --- | --- | --- |
| `mail_sla_policy` | `10755` | §9.2 | No SLA policy is ever read; no due date is ever computed |
| `email_thread_lock` | `10755` | §9.2 | Soft lock does not exist; two agents can collide silently |
| `secure_link_view` | `10758` | §9.4 | Link opens are never recorded — the one open signal in the product |
| `party_verified_domain` | `10761` | §9.7 | The anti-spoof check has no corpus of known domains |
| `email_bounce` | `10762` | §9.8 | DSNs land in the inbox as ordinary mail and are never classified |
| `document_requirement` | `10747` | §7.6 | No checklist; "Chase missing documents" has nothing to chase |
| `email_attachment_classification` | `10747` | §7.6 | Inbound documents are never proposed for filing |
| `attachment_extraction` | `10751` | §8.6 | OCR does not run |
| `email_thread_summary` | `10750` | §8.5 | Thread summaries are not generated |
| `email_thread_share` | `10759` | §9.5 | Only referenced inside the unused visibility predicate |
| `business_hours` / `business_holiday` | `10755` | §9.2 | Only referenced inside the unused SLA clock |

## 3. Chapter verdicts

| Chapter | Backend | Frontend | Verdict |
| --- | --- | --- | --- |
| **PR-2** Signatures & Deliverability | ~90 % | ~70 % | **Substantially delivered.** Genuinely good work — see §4. |
| **PR-3** Binding, Dossier, Collaboration | ~55 % | 0 % | Binding is real and wired. Dossier, cards, intake, convert are thin. |
| **PR-4** AI Layer | ~20 % | 0 % | **A facade.** No LLM call is made on any path. |
| **PR-5** Workflow, Security, Compliance | ~30 % | 0 % | Pure helpers exist; **nothing calls them**. |

---

## 4. PR-2 — Identity, Signatures & Deliverability · substantially delivered

This chapter was built properly and should be treated as the reference for how the others should look.

**Present and wired:** `10764`–`10768`; the full `signature/` module including the pure
`signature.resolve.js`, `signature.html.js` and the Puppeteer `signature.png.js`; the `source_hash`
cache; **both** orchestration invalidation handlers, registered in
`src/orchestration/handlers/index.js`; `email.service.send({ signature })` with the machine-mail vs
named-user split from §6.4, correctly wrapped so a missing signature cannot fail an OTP;
`outbox.service` baking the signature at send time behind the `mail.signatures` flag;
`resolveLanguage()` as a single helper; the deliverability module with PTR, DMARC and RBL; and
`deliverability-check` + `deliverability-check-scheduler` registered in `src/jobs/workers.js`.

**Gaps:**

| # | Gap | Severity |
| --- | --- | --- |
| 2.1 | §6.5 regression alert: a `PASS → FAIL` transition should emit `deliverability.regressed` and notify MOD-70. Verify the transition detection actually fires the notification rather than only writing the row. | Medium |
| 2.2 | §6.6 splits the UI into `signature-admin`, `template-editor`, `signature-profile`, `signature-preview`. Shipped as one `settings/email-signatures.tsx`. Cosmetic, but confirm the **PNG download at 1×/2×/3×** is present — it is the capability people will miss from the standalone tool. | Low |
| 2.3 | §6.7 criterion 9 asks for an Outlook/Gmail/Apple Mail snapshot test. Not present. | Medium |

---

## 5. PR-3 — Binding, Dossier & Collaboration · partially delivered

**Present and wired:** `10769`, `10770`, `10747`, `10748`, `10749`. `binding.extract.js` implements the
full signal table with ISO 6346 check-digit validation. `binding.service.suggestOnIngest` **is called
from ingest** (`mail.service.js:420` → `autoLink` → `binding.suggestOnIngest`) and correctly writes
suggestion rows without setting `entity_ref`; `THREAD_HISTORY` inheritance and the off-by-default
`auto_accept_threshold` are both handled as §7.2 specifies. Accept / reject / bind / unbind /
accept-batch all exist, emit events and write audit rows. Notes are contained: `compose.js` has no
path to `email_thread_note`.

**Gaps:**

| # | Gap | Severity | Acceptance criterion broken |
| --- | --- | --- | --- |
| 3.1 | **Mention fan-out is one channel, not three.** `notes.service.create` writes the `mention` row and calls `notification.notify()`. There is no chat card and no push. §7.4 requires in-app **and** chat **and** push, once each. | High | §7.9 (9) |
| 3.2 | **`mail-context` has no cache.** §7.5 requires a 60 s per-`entity_ref` Redis cache invalidated by four events. There is none, so the 50 ms warm budget cannot be met and no CI test asserts the ≤ 6 statement budget (`tests/integration/mail-context-budget.test.js` does not exist). | High | §7.9 (6) |
| 3.3 | **Five of six dossier tabs return `{ rows: [] }`.** Only `money` for a client is implemented. `operations`, `commercial`, `documents`, `interactions`, `compliance` are stubs, and the supplier flip (open POs, three-way-match exceptions, scorecard) is not built. `documents_missing` and `last_contact_at` are hardcoded `null` in the Overview. | High | §7.9 (7) |
| 3.4 | **Two of seven action cards.** `cards.js` declares `proforma` and `invoice`. §7.3 requires Client, Dossier/Shipment, Invoice, Proforma, Quotation, Purchase Order and Document request, each in its own file under `binding/cards/`. | Medium | §7.9 (8) |
| 3.5 | **Inbound document intake is not built.** `document_requirement` and `email_attachment_classification` are unused; no classification job, no file-it prompt, no chase composer, no CEMAC seed. | High | §7.9 (12) |
| 3.6 | **Conversion is preview-only and dedup is one field.** `convert.service` returns a prefill and looks for a duplicate lead by exact e-mail. §7.7 requires `dedup.service` with `party_name_norm` and phone, six targets, and the bidirectional link back onto the thread. | Medium | §7.9 (13) |
| 3.7 | **`mail-context` ignores visibility.** The route passes `{ userId }`; `context.overview(client, entityRef)` takes two arguments and drops it. | High | §9.5 MUST |
| 3.8 | Push wiring (§7.4, addition f): the stale `push.service.js` comment, the Console VAPID panel and the Settings opt-in are not addressed. | Medium | — |
| 3.9 | Frontend: none of §7.8 exists — no binding chip, dossier drawer, cards, notes tab, intake prompt or convert flow. | High | §7.9 (all UI) |

---

## 6. PR-4 — The AI Layer · a facade

This is the chapter that most needs re-reading against §8.

`assist.service.compose()` resolves a **prompt string** and returns it. It does not call
`llm.service`. `assist.service.draft()` returns whatever `facts` array it was handed — and the route
never passes one, so **every draft request returns the "this thread is not bound to a record" branch**.
No AI call is made anywhere in the mail module.

| # | Gap | Severity | Acceptance criterion broken |
| --- | --- | --- | --- |
| 4.1 | **No LLM call on any path.** Neither `compose` nor `draft` reaches `src/services/ai/llm.service.js`. | Critical | §8.11 (1, 2, 3) |
| 4.2 | **The grounding whitelist never executes.** `assist.grounding` is required and then used only in a no-op `if`. No whitelisted read runs, so no fact ever reaches the fence or the sources strip. | Critical | §8.11 (1, 2) |
| 4.3 | **No metering.** §8.2 requires every call to write `ai_usage_ledger` with `feature = 'mail_ai'` and a sub-type. Nothing does. Soft/hard cap behaviour therefore does not exist. | High | §8.11 (11) |
| 4.4 | **The gate is hand-rolled.** `assertAiOn` queries `feature_state` directly instead of reusing `ai/governance/governance.service.js`'s two-level check, which §3.3 marks **MUST**. It also runs before RBAC has been consulted for the thread. | High | §3.3 |
| 4.5 | **No thread summaries.** `email_thread_summary` unused; no 5-message trigger, no `thread.summary` slot. | High | §8.11 (5) |
| 4.6 | **No OCR.** `attachment_extraction` unused; `src/jobs/handlers/mail-ocr-extract.js` does not exist; the four doc kinds and the review form are not built. | High | §8.11 (6) |
| 4.7 | **No voice endpoint.** `/mail/assist/voice` does not exist. | Medium | §8.11 (8) |
| 4.8 | **No translate / rewrite endpoints.** `assist.prompts` holds all ten presets and the five actions correctly, but only `/assist/compose` exists and it returns a prompt, so the glossary's byte-for-byte guarantee is never exercised on real output. | High | §8.11 (4) |
| 4.9 | **No semantic search.** No `ai_chunk` ingestion on `email.received`, no "search by meaning" toggle. | Medium | §8.9 |
| 4.10 | The §8.8 hard block is defined in `assist.guardrails` and exposed at `/assist/guardrails`, but nothing calls it before a send, and the `immutable_ledger` override entry is not written. | High | §8.11 (9) |
| 4.11 | `tests/integration/mail-ai-draft.test.js` (§8.12) does not exist. | Medium | — |

**Note in fairness:** `assist.factfence.js`, `assist.glossary.js`, `assist.guardrails.js` and
`assist.prompts.js` are correct as written, and `assist.grounding.js` carries the §8.4.1 comment block.
The chapter is a good set of parts with no engine.

---

## 7. PR-5 — Workflow, Security & Compliance · pure helpers, no wiring

Every leaf module in `src/modules/mail/triage/` is unreferenced outside its own unit test and, for
three of them, `triage.routes.js`.

| # | Gap | Severity | Acceptance criterion broken |
| --- | --- | --- | --- |
| 5.1 | **`visibility.clause` is applied to no read path.** It is exported from `triage.routes.js` and imported by nothing. Thread list, get, search, timeline, `mail-context` and AI grounding all read without it. **A Private thread is currently visible to any colleague holding MOD-72 view.** | **Critical** | §9.10 (7) |
| 5.2 | **`archive-chain` is never appended.** No ingest or send hook writes `email_archive`; the table is empty, so `GET /mail/archive/verify` walks nothing and returns `{ ok: true }` unconditionally. The service-layer delete block does not exist. The compliance claim is currently unsupported by any behaviour. | **Critical** | §9.10 (9) |
| 5.3 | **`antispoof.evaluate` is never called.** `email_message.auth_verdict` is never written, `party_verified_domain` is never read or written, and no banner has a verdict to render. The bank-detail-change escalation — §9.7's "highest-value line of code in the programme" — never runs. | **Critical** | §9.10 (10, 11) |
| 5.4 | **DSNs are never parsed.** `bounce-parse.parseDsn` has no caller; `email_bounce` is empty; contact `email_status` is never set; the composer has no hard-bounce warning. | High | §9.10 (12) |
| 5.5 | **No SLA sweep worker.** `src/jobs/handlers/mail-sla-sweep.js` does not exist and no `mail-sla-*` queue is registered in `src/jobs/workers.js`. `first_response_due_at`, `resolution_due_at` and `sla_breached_at` are never written; `mail.sla.breached` is never emitted. | High | §9.10 (2, 3) |
| 5.6 | **No follow-up sweep worker.** Snooze and boomerang rows are inserted by `/threads/:id/snooze` and `/followup` and then never fire. (`cancel_on_reply` **is** correctly enforced on ingest at `mail.service.js:427` — that half works.) | High | §9.10 (4) |
| 5.7 | **`sla-clock` computes in server-local time.** `getDay()` / `setHours()` ignore `business_hours.timezone`, so the Friday-16:30 → Monday-10:30 case is only correct if the process happens to run in `Africa/Douala`. `dueAt` also has a dead ternary — `applies_to_vip ? first_response_minutes : first_response_minutes` — so the VIP tier does nothing, and `resolution_due_at` is never computed. | High | §9.10 (2) |
| 5.8 | **Secure links do not serve anything.** `GET /public/secure/:token` returns `{ label, target_kind, expires_at }` — never the document. It does not insert `secure_link_view`, records no IP or user-agent, and posts nothing to the CRM timeline. | High | §9.10 (6) |
| 5.9 | **Break-glass grants nothing.** `POST /threads/:id/breakglass` writes an audit row and returns `{ ok: true }`; there is no God-Mode role check (it uses `requirePermission(M,'approve')`) and no subsequent read is actually unlocked by it. | High | §9.10 (8) |
| 5.10 | **Scheduled send is not implemented.** `POST /mail/send` accepts no `send_at` or `send_in_recipient_morning`; `10757 party.timezone` is unused. | High | §9.10 (5) |
| 5.11 | **Delegated mailboxes (W4) not built** — no `Sender:` header distinct from `From:`, no per-access ledger row. | Medium | §9.1 |
| 5.12 | **Missing endpoints** from §9.9: `POST`/`DELETE /threads/:id/lock`, `GET/POST/PATCH /sla-policies`, `GET/PUT /business-hours` and `/holidays`, `DELETE /followup/:id`, `GET /secure-links`, `POST /threads/:id/share` + `DELETE /share/:userId`, `GET/POST/DELETE /verified-domains`, `GET /bounces`. | High | §9.9 |
| 5.13 | `bounce-parse.classifyStatus` can never return `COMPLAINT`, though the `email_bounce` CHECK allows it. | Low | — |
| 5.14 | Frontend: none of PR-5's UI exists — no claim/assign controls, SLA badges, snooze menu, schedule picker, visibility control, verdict banner or bounce notice. | High | §9.10 (all UI) |

---

## 8. Why the whole test suite stayed green

This is the part worth keeping, because it is the same shape as `FN-1` in
`doc/SMART_MAIL_FIELD_NOTES.md` and it will recur.

Every test written for PR-2 → PR-5 **imports the leaf module and calls it directly**:

```js
const { canSee, clause } = require(".../triage/visibility");   // mail-visibility.test.js
const { evaluate, lookalike } = require(".../triage/antispoof"); // mail-antispoof.test.js
const { verify } = require(".../triage/archive-chain");          // mail-archive-chain.test.js
```

`mail-visibility.test.js` is named `tests/security/…` and asserts, correctly, that a Private thread is
invisible to a colleague — **of the predicate**. The application never runs the predicate. The test
passes and the leak is real. `mail-no-telemetry.test.js` greps three files for the string
`tracking_pixel`; it would pass on an empty repository.

**The rule this yields, and the one the new tests below enforce:** a test that imports a module and
calls it has tested that module. It has not tested that the product uses it. Where the guide says a
behaviour happens *on ingest*, *on send*, or *on every read path*, the test must assert **at the call
site** — that the ingest path writes the row, that the send path consults the check, that the list
query contains the predicate. §3.7 already asks for exactly this in four places
(`mail-notes-containment`, `mail-binding`, `mail-context-budget`, `mail-visibility`); three of the four
were written as leaf tests instead.

## 9. Missing tests from §3.7 and the chapter test plans

Named in the guide, absent from the tree:

- `tests/unit/mail-capabilities.test.js` (§3.7 — provider capability matrix)
- `tests/unit/mail-html-serializer.test.js` (§3.7 — outbound HTML, ≤ 102 KB, plain-text part)
- `tests/unit/mail-folder-sync.test.js` (§3.7 — per-folder UIDVALIDITY reset)
- `tests/integration/mail-context-budget.test.js` (§3.7, §7.10 — ≤ 6 statements, warm cache)
- `tests/integration/mail-search.test.js` (§3.7 — FTS by subject/body/participant, filters)
- `tests/unit/mention-fanout.test.js` (§7.10 — three channels, exactly once)
- `tests/unit/notification-dedupe.test.js` (§7.10)
- `tests/unit/doc-classification.test.js` (§7.10)
- `tests/integration/mail-convert-dedup.test.js` (§7.10)
- `tests/unit/mail-ocr-extract.test.js` (§8.12)
- `tests/integration/mail-ai-draft.test.js` (§8.12)
- `tests/integration/mail-shared-inbox.test.js` (§9.11 — claim race under concurrency)
- `tests/integration/mail-scheduled-send.test.js` (§9.11)
- Client: `dossier-drawer.test.tsx`, `notes-tab.test.tsx`, `mention-picker.test.tsx`,
  `signature-profile.test.tsx`

Present but leaf-only, and needing a call-site counterpart: `mail-visibility`, `mail-antispoof`,
`mail-archive-chain`, `mail-bounce-parse`, `mail-sla-clock`, `mail-followup`, `secure-link`,
`mail-no-telemetry`.

---

## 10. Recommended order of work

1. **The three Criticals in §7** — `visibility` (a live privacy leak), `archive` (a false compliance
   claim), `antispoof` (the fraud control the programme was partly justified by). Each is a wiring
   job against code that already exists and is already tested.
2. **The wiring-test layer** in §8 — added *first* for each fix, so the gap cannot silently reopen.
3. **PR-5's two missing workers** (SLA sweep, follow-up sweep) and the `sla-clock` timezone defect.
4. **PR-4's engine** — the LLM call, the grounding execution, metering, and the governance gate.
5. **PR-3's dossier tabs, cache and intake**, then the remaining action cards and conversion dedup.
6. **The frontend for PR-3 → PR-5**, which is the largest single remaining block and has no partial
   credit in the current tree.

Items 4–6 are each a chapter's worth of work in their own right and should be planned as such rather
than folded into a QC pass.

---

## 11. What the QC pass itself changed

Nothing in this section is new feature work. Every fix connects code that was already written,
already correct and already unit-tested to the path that was meant to call it.

### 11.1 Closed

| Gap | What was done |
| --- | --- |
| **5.1 visibility** | `visibility.clause` is ANDed into every thread read — list, get, FTS search, stream counts, label-apply, CRM timeline. `timelineByEntity` requires a caller and returns nothing without one. The AI read adapter passes the actor as a third argument, so `client_mail_timeline` and `list_mail_thread` are bound by the same predicate (§9.5's MUST). |
| **5.9 break-glass** | Now `requireCeo()`, writes the `immutable_ledger` row *before* it reads, and actually returns the thread, through the single deliberately-unrestricted reader `getThreadUnrestricted`. |
| **5.2 archive** | `triage/ingest-hooks.js` appends every ingested and every sent message to `email_archive`, under `FOR UPDATE` on the tail row so two concurrent archives cannot claim one predecessor. `GET /mail/archive/verify` now reports **coverage** as well as chain integrity — `verify([])` is `{ ok: true }`, and that was being shown as a pass over an empty table. |
| **5.3 anti-spoofing** | `antispoof.evaluate` runs on every inbound message; `auth_verdict` and `auth_detail` are stored. Only `ADMIN_VERIFIED` domains are trusted; `OBSERVED` accrues with a counter, for the one-click "this domain belongs to <party>" affordance. |
| **5.4 bounces** | DSNs are parsed into `email_bounce`, correlated to the original by `Message-ID`, and mark `client_contact` / `supplier_contact` — a soft bounce never downgrades an address already `HARD_FAILED`. |
| **5.5 / 5.6 workers** | `mail-sla-sweep` and `mail-followup-sweep` written, registered and **enqueued on a repeat**. `deliverability-check-scheduler` had a worker and no tick, and is now enqueued too. `MAIL_FOLLOWUP_SWEEP_INTERVAL_MS` added; `MAIL_SLA_SWEEP_INTERVAL_MS` and `MAIL_DELIVERABILITY_INTERVAL_MS` already existed in config and were read by nobody. |
| **5.7 SLA clock** | Computes in `business_hours.timezone` with real IANA arithmetic instead of the server's zone; the VIP ternary that returned the same value on both branches is gone; `resolution_due_at` is computed; PENDING/RESOLVED pause and stop the clocks; no calendar yields **no** due date rather than one a year out. |
| **3.1 mention fan-out** | All three channels. `mention.service` posts the chat card into the author↔mentioned DM with `notifyMembers: false`, so one logical event stays one notification per user per channel. |
| **3.2 / 3.7 mail-context** | 60-second Redis cache keyed by entity **and caller**, invalidated by the four named events through `invalidate-mail-context` handlers; `documents_missing` and `last_contact_at` are computed rather than hardcoded `null`; both they and the Interactions tab carry the visibility predicate; unbuilt tabs return `not_built: true` instead of an empty list that reads as "this client has none". |
| **§3.5 capabilities** | `baseCapabilities()` declares all nine keys, so a capability that is missing and one that is denied are no longer indistinguishable. `propagateToServer` asks `capabilities()` before it calls, rather than probing for the method. |

### 11.2 Tests added

Seven suites, all of the *call-site* kind described in §8:

- `tests/security/mail-visibility-wiring.test.js` — the predicate is applied at every read, the timeline fails closed, exactly one reader bypasses it and that one is CEO-gated and ledgered.
- `tests/security/mail-ingest-hooks-wiring.test.js` — archive/verdict/DSN behaviour **and** that the sync loop and `recordOutbound` call the hook.
- `tests/unit/mail-sweeps-wiring.test.js` — the clock, both sweeps, and that each queue is registered *and* enqueued.
- `tests/unit/mail-capabilities.test.js` — the §3.7 matrix, plus proof that a denied capability is not attempted.
- `tests/unit/mail-folder-sync.test.js` — the §3.7 claim proper: a UIDVALIDITY reset re-scans **only** the folder that was renumbered.
- `tests/unit/mention-fanout.test.js` — three channels, exactly once, and the no-account refusal.
- `tests/integration/mail-context-budget.test.js` — ≤ 6 statements cold, **zero** warm, per-caller keying, SCAN not KEYS.
- `tests/unit/notification-dedupe.test.js` — rewritten from two leaf assertions to eleven, including that suppression covers push, not only the in-app row.

Two existing fixtures were corrected rather than worked around: `mail-service.test.js` passed `{}` as
its db client (a production guard had grown around that fixture), and `mail-threads.test.js` had an
adapter with no `capabilities()`. Both are the FN-1 shape — a fixture that cannot produce what the
real thing produces tests only itself.

**`mail-html-serializer.test.js` (§3.7) is not missing after all**: `tests/unit/mail-compose.test.js`
already covers the same ground in 61 tests, including the 102 KB clip threshold and the plain-text
part. A naming mismatch, not a gap.

### 11.3 Still open after this pass

Unchanged from §5–§7 above, and none of it is a wiring job:

- **PR-4's engine** (4.1–4.11). No LLM call is made on any mail path. The largest single gap.
- **PR-3's remaining substance**: five of six dossier tabs, five of seven action cards, inbound
  document intake, conversion dedup beyond exact e-mail, the Console VAPID panel.
- **PR-5's remaining endpoints** (5.12): soft locks, SLA-policy and business-hours admin, secure-link
  listing, thread sharing, verified-domain admin, `/mail/bounces`. Secure links still return a label
  rather than the document (5.8), and scheduled send is not implemented (5.10).
- **The frontend for PR-3 → PR-5** (3.9, 4.x, 5.14) — no partial credit exists in the tree.

### 11.4 Two spec discrepancies found while testing

Recorded rather than silently coded around:

1. **§9.10 criterion 2 says a Friday 16:30 arrival with a 4-business-hour SLA is due Monday 10:30.**
   On the calendar the guide itself seeds (Mon–Fri 08:00–17:00) the answer is Monday **11:30**: 30
   minutes before Friday's close, then 3h30 from Monday's open. 10:30 requires an 18:00 close. The
   test asserts the rule — *Monday, not Saturday* — and the arithmetic the seeded calendar produces.
2. **§7.6 specifies `document_requirement.doc_type_ref_id uuid REFERENCES dictionary_ref(ref_id)`.**
   Migration `10747` shipped `doc_type_code text` instead, and `email_attachment_classification`
   likewise carries `suggested_doc_type_code`. Not corrected — the migration is already on `main` —
   but the checklist count joins through `dictionary_ref.code`, and anything else reading these
   columns must too. `npm run db:check:columns` catches a query written to the guide's shape; it
   caught this one.
