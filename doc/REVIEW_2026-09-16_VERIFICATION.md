# Verification of the 16 Sep 2026 review follow-ups

**Verified:** 18 Sep 2026, against the working tree at `arena/01a0b61d-praxis-ls`
(base `56be83b`). Each row was checked by reading the owning file, not by
trusting the tracker.

**Headline:** **35 of 37 items are done.** The remaining 2 are data entry that
only an operator with the tenant in front of them can do.

**Updated 18 Sep 2026 (later that day):** #17, #22 and #24 — the three
engineering gaps this report identified — have since been closed. See the
"What changed after this report" section at the end for what shipped, including
two defects that only surfaced while writing the tests for them.

**Status legend**
`✅ done` — found in code, at the named owner ·
`🟡 partial` — the ask is half-met; the remainder is named ·
`🔴 open` — not found ·
`📋 operator` — the feature exists, the *value* has not been entered

---

## Score

| Bucket | Done | Partial | Open | Operator |
|---|---|---|---|---|
| §1 Bugs (1–17) | 16 | 0 | 0 | 1 |
| §2 Improvements (18–37) | 19 | 0 | 0 | 1 |
| **Total (37)** | **35** | **0** | **0** | **2** |

*(At first verification this read 30 ✅ · 1 🟡 · 4 🔴 · 2 📋. The four 🔴 were
#17, #24 and two mis-scored rows; #17, #22 and #24 were fixed the same day.)*

---

## §1 — Bugs

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Stale unread counter, Ops Task Force | ✅ | `comms/team-chat.tsx` L522-560 — joins every member channel on the comms socket, reloads on `comms:message`, plus a 15 s reconciler interval. Keyed on the joined-id string so a reload doesn't re-join. |
| 2 | Email → quote/code-request conversion errors | ✅ | Hardened both ends. `work/convert.tsx` L89 catches the preview rejection into `<ErrorState>`; L105-108 guards the `.map` on a malformed `duplicates` that used to throw the "Something went wrong" boundary; `attach()` reports through `reportActionError`. Backend `mail/binding/convert.service.js` previews only — it never writes a business record. |
| 3 | Microsoft mailbox connection fails | ✅ | `mail/providers/microsoftOAuth.js` L132-195 `classifyProviderError()` — maps `AADSTS700016 / 7000215 / 7000222` (bad/expired secret), `65001 / 90094` (admin consent), `50011` (redirect URI) to sentences naming the owner and the fix; L196-210 mints the v2 `/adminconsent` URL the setup page offers. |
| 4 | Secure doc links open in the PWA, require sign-in | ✅ | `app/app.tsx` L542-546 routes `/s/:token` **outside** `RequireAuth` and outside `AppShell`; `features/public/secure-link-page.tsx` fetches with `{ auth: false }` so a staff session is deliberately not sent; `mail/public_secure/public_secure.routes.js` is unauthenticated, rate-limited, `noindex`, and answers one opaque 404 for expired/revoked/never-existed. |
| 5 | Customers show as UUIDs in mail | ✅ | `mail/mail/thread.service.js` L60-85 `attachLabels()` resolves `entity_ref` → `entity_label` through the dossier aggregator (per-module read rule honoured, fail-soft to `null`). Consumed by `thread-list.tsx` L184, `thread-view.tsx` L522, `binding.tsx` L116/146, `intake.tsx`, `semantic-search.tsx`. |
| 6 | Disconnected addresses in the sender dropdown | ✅ | `composer/new-message.tsx` L102 `conns.filter(c => c.status === "CONNECTED")`; the seed preference is re-checked against that list (L107-118) so a since-disconnected mailbox can't seed a composer that cannot send. `setup/send-points.tsx` L80 applies the same rule. |
| 7 | Chat preview stuck on "no message yet" | ✅ | `team-chat.tsx` L327-340 `channelPreview()` — voice note, shared record, photo(s), video, attachment each have their own wording; L358-359 prefixes the sender's name on group channels ("Marc: Voice note"). |
| 8 | Composer text box ~20 % taller | ✅ | `inbox/composer/editor.tsx` L14 — `min-h-[14.4rem]` (12 rem × 1.2). |
| 9 | Registered address missing from client overview | ✅ | `masterdata/clients.tsx` L452-458 — a "Registered address" column rendering `address, city` with an em-dash fallback. |
| 10 | Activation status: draft vs pending | ✅ | `clients.tsx` L482-497 — prefers the `registration_status` ladder over the legacy `is_active` boolean, with the reasoning inline; the "Active" KPI (L510) counts the same way. |
| 11 | Client → supplier conversion drops NIU + docs | ✅ | `master/party-lifecycle.service.js` `convert()` — copies `party_registration` rows, re-mirrors NIU/RCCM from those rows onto the new master (falling back to the source's legacy columns), and copies the KYC document rows re-keyed to the new party, skipping `REJECTED`/`EXPIRED`, resetting verification to `PENDING`. All inside one transaction. |
| 12 | Legal-forms library conflates GmbH vs UG | ✅ | `packages/shared/data/legal-forms.js` L234-258 — GLEIF ships UG as `63KS` abbreviated "GmbH UG"; the patch adds `"UG"` as an exact alias and sets the printable abbreviation to `UG`, and L369-373 teaches `matchStored()` to prefer an exact abbreviation match so a stored "UG" can no longer normalise onto GmbH (`2HBR`). |
| 13 | Attachments discarded during entity creation | ✅ | `masterdata/entity-360.tsx` L3213-3270 — the create path now validates the returned `document_id`, then uploads to the vault and patches `vault_id`; an upload failure re-throws so the modal says so rather than the row silently claiming a scan. |
| 14 | Letterhead missing legal form / contact / address | ✅ | `services/documents/templates/letterhead-blocks.js` — blocks `legal_form` (L108), `contact` (L155-160), `registered_address` (L117), each with its own visibility toggle, plus `entity.legal_form` as a token (L341). |
| 15 | Renewals / working-calendar / public-story tabs misaligned | ✅ | `masterdata/entity-360.tsx` L1484-1499 — one `<nav>` with `flex flex-wrap items-end gap-1 overflow-x-auto border-b` and `-mb-px` on each button, so every tab (including the three named) sits on the same baseline and the strip wraps instead of overflowing. |
| 16 | "About us" cover rejects images under 1200 px | ✅ | `site/site_settings/site_settings.media.js` L234-250 — the width floor now applies only to slots that genuinely need it (`spec.minWidth > 1`); cover slots accept any size and `writeVariants` simply produces fewer rungs. Client side, `lib/image-compress.ts` `resizeDimensions()` never enlarges below a floor so the server sees true source dimensions. |
| 17 | Praxis AI hallucinations, memory timeouts, lead-creation rejected | ✅ **fixed 18 Sep** | All three symptoms addressed and test-pinned. **(a) Contract fidelity** — `action-registrar.js` `zodToJsonSchema()` was "top-level shape only", so `create_lead.owner_user_id` was advertised as a bare `string` while `lead.validator.js` demanded a uuid; it now emits `format`/`pattern`/`minLength`/bounds/array sizes and enum members. **(b) Propose-time enforcement** — `orchestrator.service.js` `validatePayload` checks the advertised constraints, so a bad value fails next to the form instead of after confirm. **(c) Memory budget** — new `AI_SUMMARY_TIMEOUT_MS` (20 s) with `timeoutMs`/`singleVendor` on `llm.service`, bounding the best-effort pre-answer summariser away from a 240 s worst case. **(d)** `SYSTEM_RULES` gained IDENTIFIER RULES, because advertising `format:"uuid"` otherwise lets a model satisfy the shape by inventing a passing value. Tests: `ai-tool-contract-fidelity` (8), `ai-payload-validation` (15), `ai-memory-budget` (7). **Defect found while testing:** the date check used bare `Date.parse`, which rolls over — `"2026-02-31"` parsed as 3 March, silently moving a deadline by three days; replaced with a `Date.UTC` round-trip. |

---

## §2 — Improvements

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 18 | Employee picker to assign/share a thread | ✅ | `inbox/work/triage.tsx` L145-185 — `EmployeePicker` with `requireAccount`, stacked layout (a row pushed Assign off a 300 px rail), assigning over a live assignee deliberately allowed. |
| 19 | Client picker when linking a thread | ✅ | `inbox/work/binding.tsx` — server suggestions with signal + confidence band, accept/reject, and unbinding offered from the same place. |
| 20 | Operations-file picker ("link it to myself") | ✅ | `binding.tsx` L219-221 — the manual control is labelled **"Link it myself"** when unbound and "Link to something else" when bound; accepts `client:…` / `dossier:…` refs. The review's requested wording is present. |
| 21 | Team / shared-mailbox creation UI | ✅ | `comms/setup/mailboxes.tsx` L506, L545, L558 — "New shared mailbox" gated on MOD-72 **create** (not `can_administer`, which is edit); `shared-mailbox-affordance.test.tsx` pins that a role with edit-but-not-create is not offered a button that could only 403. |
| 22 | Collapsible right-hand work panel, default collapsed | ✅ **fixed 18 Sep** | The **sections** already collapsed (`inbox/work/index.tsx` accordion); the **whole rail** now does too. `thread-view.tsx` renders the `xl:w-[22rem]` column only when `railOpen`, and otherwise a full-height vertical spine (`[writing-mode:vertical-rl]`, not `rotate` — a rotated element keeps its original box, so the reading pane would never get the width back) carrying `aria-expanded`/`aria-controls`. `WorkRail` gained an `onCollapse` control in its header. Default is **collapsed**, persisted in `localStorage` beside `comms:info-open`, and deliberately **not** reset on thread change — it is a preference, not per-thread state. Collapsed still shows a badge for **unbound** or **overdue**, because those are what an operator scans for. 8 tests in `inbox.test.tsx`, including the broken-`localStorage` case (Safari private mode throws on `setItem`; the toggle must outlive it). |
| 23 | Thread search when sending invoices/costings/documents | ✅ | Search-by-meaning exists (`work/semantic-search.tsx`, mounted at `inbox/index.tsx` L461) and the send-time need is met from the other direction: `masterdata/entity-360.tsx` hands selected vault ids straight to `NewMessageDialog`, so a document is attached to a draft without re-uploading, and `new-message.tsx` L173 carries `threadId` so a reopened draft stays on its thread. |
| 24 | Document-preview modal for a secure link | ✅ **fixed 18 Sep** | The deliberate refusal is reversed, and the sandboxing objection behind it is answered rather than waved through. The API now returns `preview_kind` (`"pdf"`/`"image"`/`null`) from a server-side allow-list, and `/download?disposition=inline` serves those two kinds inline under `nosniff` + `default-src 'none'; object-src 'none'; frame-ancestors 'self'`. Narrower than the internal dialog **on purpose**: `text/plain` and `text/csv` are download-only here, because that reader is anyone the URL was forwarded to. **A PDF response deliberately carries no `sandbox` token** — Chromium will not start its PDF viewer in a sandboxed frame, so `sandbox=""` ships a blank pane the recipient cannot distinguish from a corrupt file; images keep the full sandbox. 17 server tests + 10 page tests. **Blocking defect found first:** `secure-link.service` read `doc.content_type`, and `document_vault` **has no such column** (0340 creates it without one; no later migration adds it) — so every secure-link recipient in the product's history was told their document was `application/octet-stream`. Type is now derived from the storage key via a shared `document_vault.mime.js`. The suite that should have caught it was asserting against a mock that invented the column. |
| 25 | Remove the redundant "sender setup & channels" section | ✅ | `comms/setup.tsx` L1-8 — the per-section sender table is removed, with Send points named as the single surface for "which address does this mail from?". `comms/external-channel.tsx` is a stub. The remaining "Senders & channels" tab is the credentials/DNS surface, not the removed table. |
| 26 | Mandatory phone on client creation | ✅ | Company-level, not a contact's: migration `13900` adds `client_master.phone` and seeds `party_field_config('CLIENT','phone', is_required=true)`; `client_master.service.js` L33 calls `masterConfig.enforceRequired`. `clients.tsx` L371-390 renders it `required` with its own hint. Policy, so a tenant can toggle it in Settings → Master Data. |
| 27 | Edit registration numbers / tax IDs after creation | ✅ | Not locked. `client_master.service.js` `update()` accepts `registrations`, re-validates them for the country, and re-mirrors NIU/RCCM onto the master. In LIVE the sensitive subset (legal name, credit limit, status) goes through maker-checker — registrations are not in that set. |
| 28 | Supplier category → searchable picker | ✅ | `masterdata/suppliers.tsx` L65-73, L250-275 — bound to the `supplier_type` registry with an inline "Add a category…" that creates in the registry then selects it. |
| 29 | Payment methods multi-select | ✅ | `suppliers.tsx` L75-90 (state), L277-295 (checkbox group), L167 (payload). Migration `13900` adds `supplier_master.payment_methods text[]`, backfills from the scalar, and keeps `payment_method` as a legacy mirror so WHT reports and the 360 keep working. Enum enforced in the shared Zod schema, not a CHECK, per the 13791 rule. |
| 30 | Attestation of fiscal compliance as a mandatory client doc | ✅ | Migration `13900` seeds `party_document_type('FISCAL_COMPLIANCE', …, CLIENT, requires_expiry, requires_issuing_authority, ESCALATED, is_required)`. |
| 31 | Clickable KPI tiles (headcount → employee list) | ✅ | `masterdata/entity-kpi-drill.tsx` + `kpi-details-modal.tsx`, mounted at `entity-360.tsx` L1480. Shareholders, Employees (`GET /employees?entity_id`), Subsidiaries and Journal each drill; Ownership deliberately has none (82 % is a figure, not a list). |
| 32 | "Share document" → attach corporate docs to an email draft | ✅ | `entity-360.tsx` L3013-3080 — tick documents, then either email (vault ids handed to `NewMessageDialog`, no re-upload) or download as a ZIP. Documents with no scan are listed and named rather than silently dropped. Covered by `entity-documents-share.test.tsx`. |
| 33 | Regime picker for tax & jurisdiction | ✅ | `components/regime-picker.tsx`, wired at `entity-360.tsx` L45/L528/L988. Strict enum from `packages/shared/data/tax-regimes.js` (REEL, NORMAL, SIMPLIFIE, LIBERATOIRE, FORFAIT, FRANCHISE) with inline add for a new uppercase code, search over code + fr/en labels + hints, full keyboard support. |
| 34 | PO Box prints on the letterhead | ✅ | `letterhead-blocks.js` L136-153 — a `po_box` block and a combined `postal_address` block (address + BP on two lines), each toggleable; L593-600 derives `po_box_line` from the entity or its registered address; L424 places it in the default layout; `letterhead-studio.tsx` L100 exposes `show_registered_address` and the PO Box toggles. |
| 35 | CEO's birthday as a public holiday | 📋 **operator** | The feature is complete — `masterdata/working-calendar-tab.tsx` manages holidays (`holiday_date`, `name_fr/en`, `is_recurring`) and `9090_seed_working_calendar.sql` seeds the Cameroon set. The CEO's birthday is **not** in any seed, correctly: it is one tenant's data, not fleet data. Someone has to add the row. |
| 36 | Paste a screenshot into a support ticket | ✅ | `features/support/new-ticket-modal.tsx` L22-25, L204 and `ticket-thread.tsx` L258 — `onPaste` on the FilePicker, so Ctrl+V lands the clipboard bitmap on both the new-ticket form and the reply. |
| 37 | Standalone office-expense module | ✅ | Net-new and complete: `src/modules/finance/office_expense/` (service, repo, controller, routes, rules, validator, events, ai), `client/src/features/finance/office-expenses.tsx`, migration `13910_office_expense.sql`, seed `9133_office_expense_module.sql` (MOD-77), routed in `app/layout/areas.ts` L207 and `finance/hub.tsx`, and in the axe screen sweep. Routes auto-mount via the module loader. Draft → post lifecycle, mirroring how costing controls operations files. |

---

## What is actually left

**Engineering (0 remaining — all three are now done):**

1. ~~**#17 — Praxis AI.**~~ Done 18 Sep. Contract fidelity, propose-time
   validation and a memory timeout budget; 30 new tests.
2. ~~**#22 — whole-rail collapse.**~~ Done 18 Sep. Persisted, default-collapsed,
   with a badge that survives the collapse.
3. ~~**#24 — preview on the public secure-link page.**~~ Done 18 Sep. The
   sandboxing question was answered rather than deferred.

**Operator / data entry (2 — the only work left):**

- **#35** — add the CEO's birthday in Corporate Entity → Working calendar.
- **Non-engineering carry-overs** from §3 of the review are unchanged: order
  apparel, register the JBS Praxis company email, configure company mailboxes
  and routing, and have *petit papa* correct the shareholder/profile data.

**Note on the review's own classification:** three items the tracker filed as
`📊 data/config` turned out to need code and got it — #12 (GmbH/UG) needed an
alias-and-matcher patch in `packages/shared`, not a seed edit; #30 and #34
shipped as migration `13900` and letterhead blocks respectively. Only #35 is
genuinely a value someone types in.

---

## What changed after this report (18 Sep 2026)

The three engineering gaps above were closed the same day. Two of them uncovered
defects that were **not** on the review's list and that nobody had reported —
both found by writing the test rather than by reading the code.

### The two unreported defects

**1. Impossible dates silently moved deadlines (found under #17).**
`validatePayload` checked dates with bare `Date.parse`, which does not reject an
out-of-range day — it rolls it over. `Date.parse("2026-02-31")` yields 3 March.
So an AI-proposed task due on a date that does not exist was accepted and filed
three days late, with nothing anywhere saying so. Replaced with a `Date.UTC`
round-trip compared against the digits as written.

**2. Every secure-link recipient was told their document was a binary blob
(found under #24).** `secure-link.service.fetchTarget` reported
`doc.content_type || "application/octet-stream"`, and `document_vault` **has no
`content_type` column** — migration 0340 creates the table without one, 0669
adds `original_name`/`client_id`/`doc_type_ref_id`/`uploaded_by`, 10702 adds only
the `public_media_*` set. The left operand was therefore `undefined` on every row
in the product, and the fallback fired 100% of the time.

That one is worth dwelling on, because there *was* a test over it and it was
green: the suite mocked the vault row with a `content_type` field the schema does
not have, so it asserted against its own invention. A mock that supplies a field
the table lacks does not test the code — it tests the mock. The fixture now
mirrors the real shape, and the type is derived from the storage key's extension
(the extension the upload service itself chose) via a new shared
`document_vault.mime.js`, which both the vault's own download route and the
public secure-link route read.

### Decisions worth recording

**#22 — the rail is a preference, not per-thread state.** It persists in
`localStorage` and is deliberately *not* reset when the thread changes: someone
working the queue wants it open on every thread, someone reading wants it shut on
every thread, and resetting it means re-collapsing it forty times an hour.
Collapsing also must not hide the two facts an operator scans for, so the
collapsed spine still carries an **unbound** or **overdue** badge — overdue wins
when both apply, because that is the one with a clock attached.

**#24 — the PDF preview deliberately has no `sandbox`.** This looks like an
omission and will attract a "fix", so it is stated here and asserted in two
tests. Chromium refuses to instantiate its built-in PDF viewer inside a sandboxed
frame; `sandbox=""` renders a blank pane (Brave shows a block page), and the
response's `object-src 'none'` closes the usual `<embed>` fallback. A preview
that renders nothing is *worse* than no preview, because the recipient cannot
tell it from a corrupt file. Everything that does not break the viewer stays on
(`default-src 'none'`, `object-src 'none'`, `frame-ancestors 'self'`, `nosniff`),
and images — which need no viewer — keep the full sandbox.

The public allow-list is also **narrower than the internal one** on purpose. The
internal `VaultPreviewDialog` frames `text/plain` and `text/csv`; the public page
will not, because some browsers content-sniff a `text/*` body into markup and
this reader is whoever the link was forwarded to, not a colleague in a session.

### Tests added

| File | Tests | Pins |
|---|---|---|
| `tests/unit/ai-tool-contract-fidelity.test.js` | 8 | Every uuid-ish field in the live catalogue declares its format |
| `tests/unit/ai-payload-validation.test.js` | 15 | Formats enforced at propose time; the hard-won leniency (unknown keys, empty optionals) stays |
| `tests/unit/ai-memory-budget.test.js` | 7 | Summary timeout < request timeout; `singleVendor` makes exactly one call |
| `tests/security/mail-secure-link-preview.test.js` | 17 | Real HTTP responses: allow-list, inline-is-a-request, the no-sandbox-on-PDF rule |
| `client/.../secure-link-page.test.tsx` | 10 | The page obeys `preview_kind` and never re-derives it from the content type |
| `client/.../inbox.test.tsx` (added to) | 8 | Rail collapse, persistence across threads, badge, broken `localStorage` |

**Suite state after the change:** backend 520 suites / 8945 tests green; client
202 files / 2683 tests green; `tsc -b` clean; no new lint warnings.
