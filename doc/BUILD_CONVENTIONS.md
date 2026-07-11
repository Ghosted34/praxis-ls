# Build Conventions — Document Lifecycle, Numbering, Approval & AI (MANDATORY)

Applies to **every module from now on**, alongside `CONVENTIONS.md` (layout) and
`AI_READINESS.md` (AI manifests + UI map). Any record a user or the AI creates
must follow this end-to-end flow. Build each module with the **whole flow and the
UI it needs** in mind so the pieces connect instead of scattering.

## 1. Every business record has a lifecycle (draft → post → get back)
Records are never one-shot inserts. The standard status ladder (already on
`invoice.status` in `0230`, reuse the same vocabulary):

```
DRAFT ─▶ SUBMITTED_FOR_VALIDATION ─▶ SUBMITTED_FOR_APPROVAL ─▶ APPROVED_LOCKED / ISSUED_LOCKED ─▶ POSTED_LOCKED
                                                                                   └▶ CANCELLED / REVERSED
```

- **Save to draft:** create returns a `DRAFT` the user can come back to.
- **Edit/update:** allowed **only while pre-lock** (DRAFT / SUBMITTED). Once
  `*_LOCKED`/`POSTED`, the record is immutable — corrections are a **reversal +
  replacement** (KB §23.16), never an in-place edit.
- **Post:** the terminal, ledger-affecting action (validates + locks).
- **Get back:** list + get (with lines/children) at every stage.

A module that only exposes the terminal action (e.g. "post") without the
draft/edit/list/get stages is **incomplete**.

## 2. Approval chain (for anything that needs one)
Submitting a record binds it to a `workflow` (Universal Event Engine, `0120`):
each step raises an `approval_task` (`PENDING → VALIDATED → APPROVED | REJECTED |
SKIPPED`, with `amount_xaf` thresholds + `assigned_role_id`). The record advances
only as its tasks clear; final approval triggers the post. Emitting the bound
`event_type` is what creates the `approval_task` rows — that executor is the
piece still to finish (Phase 4 runtime), but design every approvable module to
plug into it now.

## 3. Document numbering + capture — once, then kept in sync
Anything **drafted, posted, or generated that carries a document number**:
- Allocate the number from `doc_sequence` (per `module_key`/`year`/`entity_id`)
  **inside the caller's transaction** so the number and the row commit together.
- **Capture it in `document_vault` exactly once** (keyed by the doc number /
  `entity_ref`): storage path, `content_hash` (SHA-256, QR-verifiable), doc_type.
- If the item is **updated or regenerated later, the SAME vault row updates
  itself** (refresh `content_hash` + `storage_path`) — never a duplicate. A
  shared `document.service` (`capture(client, {entity_ref, doc_number, …})`
  upsert) must own this so every module behaves identically.

## 4. AI generates → user approves — same path as the UI
The AI can **create/generate any of these records**, but it never bypasses
approval:
- An AI write is proposed as an **action card** (`ai_action_run`,
  `PROPOSED → AWAITING_CONFIRM → CONFIRMED → EXECUTED`) that the user confirms.
- Whether initiated **in the module screen or from chat**, it calls the **same
  service** with the caller's RBAC, and then flows through the same lifecycle,
  approval chain, numbering and document capture. UI action and AI action
  converge on one code path — no separate AI back-door.

## 5. Design for the UI + end-to-end flow (no scatter)
When building a module, define up front (and record in the screen registry):
- **Screens:** list, draft editor (create/edit), detail/approve, posted view.
- **State the UI drives:** which button → which action → which downstream
  effect (approval task, number allocation, document capture, PDF render, ledger
  post). Map the whole chain so nothing is orphaned.
- **Connections:** a screen entry per lifecycle view + the `action_key`s reachable
  from it (AI-readiness Rule 2), so the app, the AI, and the docs agree.

## Definition of Done (per module — extends AI_READINESS)
- [ ] Lifecycle: draft create, edit-while-unlocked, submit, approve, post, plus
      list + get. Locked records reject in-place edit (reversal instead).
- [ ] Approvable actions bind a `workflow` and raise `approval_task`s.
- [ ] Numbered docs: allocate from `doc_sequence` in-txn; capture/upsert one
      `document_vault` row; re-sync on update.
- [ ] `<module>.ai.js` manifest: reads + confirm-gated writes; AI create routes
      through the same service + approval.
- [ ] `screen-registry.json`: one entry per lifecycle screen + its action_keys.

## Known gaps to close (so this convention is real, not aspirational)
- ~~**`shared document.service`** (numbering + `document_vault` capture/upsert)~~
  **DONE** — `src/services/documents/numbering.service.js` (tenant-schemed,
  atomic `doc_sequence`) + `src/services/documents/document.service.js`
  (capture-once / update-in-sync). Still to do: wire them into each module.
- ~~**`numbering.service.js` is foreign**~~ — superseded by the tenant-native
  `src/services/documents/numbering.service.js`. The old storefront file can be
  deleted once nothing references it.
- ~~**Approval-chain executor**~~ **DONE (engine)** —
  `src/services/workflow/executor.js` (start → act → advance, amount-threshold
  routing). Still to do: modules call `start` on submit and react to completion
  (post on approved); expose act via a gated route + AI action.
- **Retrofit steps 3–5**: `final_invoice`/`proforma`/`regie` currently jump
  straight to posted. Layer the DRAFT → submit → approve lifecycle + numbering +
  `document_vault` capture onto them to match this convention.

## 6. Tenant self-configuration (numbering, workflows, business rules)
None of the below is hard-coded. Provisioning seeds sensible **defaults**; the
tenant edits them through **Settings (MOD-70)** / **Security → RBAC (MOD-67)**.
The engines above read the tenant's config at runtime.

- **Numbering is tenant-CRUD.** A tenant-editable numbering scheme per document
  type — prefix, padding width, per-entity and/or per-year reset cadence,
  separator — drives `doc_sequence` + the shared `document.service`. Managed
  under Settings; changing a scheme never renumbers already-issued docs (history
  is immutable), it only affects future allocations.
- **Workflows are tenant-configurable.** Tenants design their own approval
  **hierarchy** in the Universal Event Engine: `workflow` + ordered
  `workflow_step`s, each step declaring **who acts** (`assigned_role_id` /
  capability), **what they may do at that level** (validate / approve / reject /
  skip), and **amount thresholds** (`amount_xaf`) that route or short-circuit
  steps. A module binds an *approvable event*; the tenant decides the levels and
  powers. The backend admin exists (`src/modules/workflow`, MOD-67) — it needs
  the config UI (designer) and the runtime executor.
- **Business rules are tenant settings.** Per-module rules live in `setting`
  (section-scoped) and are editable in Settings — e.g. régie `policy_window_days`,
  quote model (`HT_ON_TOP` vs `TTC`), default VAT/tax code, débours policy,
  period-close locks, reminder cadences. Services must **read the setting**, not
  bake the value in. Add a setting key rather than a constant whenever a value is
  something a tenant might reasonably want to change.

**Definition-of-Done additions:** any numbering, approval step, or business
constant a module introduces must be (a) seeded as a tenant default on provision,
(b) editable via Settings/RBAC, and (c) read at runtime from config — never a
hard-coded literal. Surface each as a Settings screen entry in the screen registry.

### Added to "known gaps to close"
- **Settings surfaces** for numbering schemes and per-module business rules
  (Settings/MOD-70) — CRUD + defaults on provision.
- **Workflow designer UI** + the runtime executor (bind event → build
  `approval_task`s from the tenant's `workflow_step`s → advance on clear).
- **Régie `policy_window_days`** (and similar constants already shipped) should
  move from a code default to a tenant setting.

## §7 Secrets & vendor keys — .env is for boot only

Hard rule: **the only values in `.env` are those required to *start* the
process** — database connection, JWT secret, Redis URL, port, node env. Nothing
else.

Every **operational / vendor credential** — AI provider API keys (DeepSeek,
Gemini, Groq, OpenAI-embeddings), SMTP, the FX-rate API key, and any future
third-party key — is **stored in the database**, encrypted, and managed through
the security/settings surface:

- **AI vendor keys** live in `ai_vendor_credential` (AES-256-GCM encrypted) and
  are read at call time via `governance.getVendorConfig(client, vendor)`. Read
  APIs never return the ciphertext.
- **Other operational keys** (SMTP, FX, webhooks) live in `setting`
  (section/key/value) and are read via `shared/config/settings`
  (`getSetting`/`getSection`).

Consequences for code:
- A service that talks to an external vendor takes the **tenant client** and
  resolves its key from the DB. It must NOT read `config.*_API_KEY` /
  `groups.ai.*` / `config.SMTP_*`.
- Resolution order is **DB-first, then `.env` as a fallback**. A service reads
  the DB vendor config; if unset, it may fall back to the matching `.env` value;
  if neither is present it degrades gracefully (clear "not configured" error or
  a stub). `.env` is a convenience/last-resort, never the primary source.
- Keys are entered **and connection-tested from the frontend**: every vendor
  surface exposes a "test connection" action (e.g. `POST
  /ai/governance/vendors/:vendor/test`) that does a minimal live call and returns
  `{ ok, error }` without persisting anything new.

### Per-purpose email senders (no generic sender)

There is **no single generic mail sender**. Each sending **purpose** — `BILLING`,
`DOCUMENTS`, `NOTIFICATIONS`, `SUPPORT` — has its own **verified identity** in the
`email_identity` table: From address + name + domain, its own SMTP host, and
SPF/DKIM/DMARC verification flags (plus an `is_fallback` identity on
`nmail.praxisls.com`).

A module declares its `purpose` when sending; the identity supplies the From and
transport host. `email.send(client, { to, subject, html, from, replyTo, purpose,
moduleKey })` resolves, DB-first with env fallback:
- **From + host** ← `email_identity(purpose)` → `setting "email".default` → env
- **auth creds** ← `setting "email".default` (`smtp_user/pass`) → `SMTP_*` env

Explicit `from`/`replyTo` always win. When nothing resolves, the send refuses
rather than leaking through a generic mailbox.
