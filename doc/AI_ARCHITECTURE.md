# Praxis LS — AI Architecture (Decision Record)

**Status:** Design of record for the AI layer. Decisions below are locked; build follows this. Read with `doc/AI_KNOWLEDGE.md` (the knowledge/ingestion layer) and `doc/CONVENTIONS.md` (module layout).

## 0. One-line thesis

**The app is the AI's toolbox.** Every module declares what the AI may do; the tool catalogue is generated from the modules, so AI capability always equals app capability with zero drift.

## 1. Locked decisions

| Decision                 | Choice                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autonomy                 | **Reads free, writes confirmed.** Read tools run inline; every write returns an action card the user confirms.                                                                              |
| Confirmation granularity | **Plan-based, AI-suggested.** The AI proposes a plan of 1..N writes; single write → one card, multi-step → a batched plan card. The AI recommends batch-vs-per-action; the user can switch. |
| Tool catalogue           | **Auto-derived from modules** via a per-module `<module>.ai.js` manifest → `ai_action_catalogue`.                                                                                           |
| Permissions              | The AI **never exceeds the calling user**. Every tool runs on the caller's tenant connection with the caller's RBAC; writes are additionally Zod-gated.                                     |
| Modalities (v1)          | Text chat · per-module beck-&-call · chat-on-dashboards · **voice-to-text** · **document-vision** (last two via workers).                                                                   |
| Voice/vision             | **Worker jobs** (`worker-ai`), feeding the same propose→confirm pipeline.                                                                                                                   |
| Providers                | **Chat chain chosen in the Platform Console** (Integrations → AI providers → *Use as primary*; default DeepSeek → Gemini), Gemini vision, OpenAI-compatible **embeddings**, **Groq** voice. All API, one deploy-wide key set, swappable layer. |
| Grounding freshness      | **Event-driven re-embed** — the event engine re-indexes the changed record's card on its `entity.action`. Full reindex only on migrate/deploy.                                              |
| Isolation                | Tenant corpus in the tenant DB; global corpus (code/docs/schema) in the platform DB.                                                                                                        |

## 2. The action manifest (`<module>.ai.js`)

Seventh optional file in a module folder (`src/modules/<group>/<module>/`). Declares the module's AI surface; a boot-time registrar upserts it into `ai_action_catalogue` and wires the runtime executor map.

```js
// src/modules/finance/final_invoice/final_invoice.ai.js
const service = require("./final_invoice.service");
const validator = require("./final_invoice.validator");

module.exports = {
  entity: "final_invoice",
  // read tools: auto-approved, no confirmation
  reads: [
    {
      key: "list_final_invoices",
      service: service.list,
      describe: "List final invoices.",
    },
    {
      key: "get_final_invoice",
      service: service.get,
      describe: "Get one final invoice by id.",
    },
  ],
  // write tools: Zod-gated + RBAC + confirmation
  writes: [
    {
      key: "raise_final_invoice",
      // WRITE CONTRACT: `(client, payload, actor) => …`. Map the AI's snake_case
      // payload to the service's real argument shape and forward the FULL actor.
      // A bare `service.create` ref is NOT allowed for a write (see below).
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create, // becomes payload_schema
      permission: "finance.create", // checked against the caller's RBAC
      confirm: true,
      describe:
        "Issue a final invoice for a dossier (recognises revenue per KB §8.3).",
    },
  ],
};
```

**The write-execution contract.** The generic write adapter invokes a manifest
write as `service(client, payload, actor)`, where `payload` is the AI's
snake_case object and `actor` is the **full authenticated user**. A write
therefore MUST be an inline wrapper that (a) maps that payload to the service's
real argument shape and (b) forwards the actor — e.g.
`(c, p, actor) => service.create(c, { data: p, actor })`, or the field mapping a
camelCase service needs: `(c, p, actor) => service.createDraft(c, { requestedBy: p.requested_by, …, actor })`.
A **bare service reference cannot conform**: its second parameter is
`{ data, actor }` (or camelCase args), so the flat payload lands in the wrong
slot and the actor is silently dropped — the audit filed these as C1–C3
(`create_supplier` threw, `create_lead`/`create_opportunity` lost attribution).
Reads are unaffected (they take `(client, payload)` and a read that depends on
the caller receives `{ user_id }` as a third argument).

This is enforced by `tests/unit/ai-write-contract.test.js` via
`services/ai/write-contract.js`: it proves the named create actions run with the
actor, and a **ratchet** fails the build if a new write does not forward the
actor (unless grandfathered in `write-contract-baseline.json`, whose backlog only
shrinks). Hand-vetted executors in `action-registry.js` bridge the payload
themselves and always pass `actor: user`, so they conform by construction.

**Registrar (boot / `ai:sync-actions`):** walk every `*.ai.js`, upsert `ai_action_catalogue` rows (`action_key`, `is_write`, `payload_schema` from the Zod schema, `required_permission`, `requires_confirmation`, `ai_enabled`), and build an in-memory `{ action_key → { service, schema, permission } }` map. Adding/removing a module updates the catalogue **the next time the sync runs** — the derivation is automatic, the propagation is not, and the gap between the two is where drift lived. Two CI gates close it (audit I1/I2/I4): `scripts/check-ai-manifest-coverage.js` fails the build when a module with a public controller has neither a `<module>.ai.js` nor an `// ai:none <reason>` opt-out in its controller, and `scripts/ai/sync-actions.js --check` fails when the manifests are inconsistent (a duplicate `action_key`, an `ai_enabled` action with no executor, a write with no schema or a permission verb `action-authz` cannot map). With `--tenant=<slug>` it also diffs the derived catalogue against the rows in **both** the `live` and `sandbox` schemas, which is the check that would have caught an action working in LIVE and missing in TEST. Sensitive writes (accounting postings, payroll) may hand-tune their Zod/business-rule layer while still being auto-registered.

## 3. Surfaces

1. **Floating assistant** — global chat (`/api/tenant/ai/ask`).
2. **Per-module beck-&-call** — the client sends `{ module, record_id }`; the orchestrator prioritizes that module's tools and preloads the current record as context. "Raise the proforma for this" already knows the dossier.
3. **Chat-on-dashboards** — a chat box under each report to interrogate its data (the Power-BI differentiator).
4. **Voice** — a voice note → `worker-ai` transcribe (Groq/Whisper) → text → same pipeline.
5. **Document-vision** — upload (BL/invoice/receipt) → `worker-ai` Gemini vision extract → structured fields → prefilled action.

## 4. The agent loop

```
user turn (text | transcribed voice | extracted doc)  +  {module, record_id}?
  → recall: embed query, vector-search tenant ∪ global corpus (confidentiality-filtered)
  → plan: DeepSeek with the tool catalogue (reads + writes visible to this user)
  → read tools run inline for exact/live values
  → if writes proposed → build a PLAN of 1..N actions
       → Zod-validate each payload (≤2 self-correct → else prefilled manual form)
       → RBAC-check each against the caller
       → return action card(s): single card or batched plan card (AI suggests which)
  → on confirm → execute (each action = module.service on the caller's tenant client)
       → batch commits/logs together; halts on first failure
  → log every step: ai_usage_ledger (cost/tokens) + immutable_ledger (executed writes)
```

Multi-step reads chain freely; **no write executes without confirmation.**

## 5. Data model (already in migration tenant/0400 + additions)

- `ai_action_catalogue` — the generated tool registry (`payload_schema`, `is_write`, `required_permission`, `requires_confirmation`, `ai_enabled`).
- `ai_action_run` — one per proposed action; states `PROPOSED → VALIDATION_FAILED | AWAITING_CONFIRM → CONFIRMED → EXECUTED | MANUAL_FALLBACK | REJECTED`. **Add:** `batch_id uuid` so a plan's actions group, confirm, and commit together.
- `ai_conversation` / `ai_message` — sessions + turns.
- `ai_document` / `ai_chunk` (pgvector) — the tenant corpus (schema cards, entity cards, docs).
- Governance: `ai_feature_flag`, `ai_access_grant`, `ai_vendor_credential` (encrypted keys), `ai_budget_period`, `ai_usage_ledger`.
- `ai_health_event` (13940) — the QUALITY signals, append-only, deliberately separate from `ai_usage_ledger`. The ledger answers what a call cost, is tied to a budget period and is read by the spend cap; a turn that fell back to another vendor and came back truncated still *succeeded* in the only sense the ledger means. `conversation_id` carries no FK, matching the ledger, because a conversation can now be purged (13930) and an FK with no `ON DELETE` would block that.

## 6. Governance & safety

- **EMV toggle** per tenant: `feature_state` — `ai.assistant` (UI), `ai.assistant.backend` (server actions), `ai.vectorization` (recall). Off → nothing runs.
- **Spend caps**: per-tenant / per-feature (`ai_budget_period`, `ai_usage_ledger`); soft cap warns, hard cap blocks.
- **What a call costs**: `governance.recordUsage` prices every metered call as
  tokens (or audio minutes) × the rates on that vendor's `ai_vendor_credential`
  row, in the vendor's own currency (`cost_native` / `cost_native_currency`),
  then converts it once into the tenant's base currency through MOD-08's
  `fx_rate_daily` for `cost_xaf` — the column budget caps read. Two consequences
  worth knowing: a vendor whose rates are still 0 meters every call at zero
  (AI Control → Vendors flags it "Not priced"), and a currency with no FX rate
  on file leaves `cost_xaf` at 0 with the true figure preserved in
  `cost_native` — never the raw foreign amount passed through, which would
  understate spend by the size of the rate.
- **PII/financial redaction, in two classes** (`services/ai/redact.js`, audit A1/F3).
  A single blanket scrub used to guard every path, and its catch-all
  `\b\d{9,}\b → [NUM]` hid every amount from 100,000,000 XAF up from the model —
  so the assistant was asked to report figures it had never been shown. The two
  paths are now separated by what happens to the text:
  - `redactForReasoning()` — the caller's OWN authorised data going into a prompt
    and nowhere else (tool results, the tenant context block, replayed history,
    the live question). The caller is authenticated, their RBAC chose the tools,
    and retrieval already filtered the corpus by confidentiality tag. Amounts,
    ERP references, contact data and the NIU arrive intact.
  - `redactExternal()` — text that is PERSISTED, INDEXED or becomes client-facing:
    the conversation summariser, the embeddings vendor (masked at
    `embeddings.embedBatch`, so corpus and query are scrubbed identically and
    recall is preserved), and the proposal generator. Additionally masks contact
    data and the NIU. Exported as plain `redact` too, so a caller that has not
    thought about which class it is in gets the strict one.

  Both paths mask payment instruments (IBAN, RIB, card PAN) and individual
  government identity numbers (CNPS/SSN, passport) — those are high-harm and are
  never the answer to a question. Number handling is **structural**: a digit run
  is masked because an account label precedes it or because it is long enough
  (13+) that no plausible figure reaches it, never because it crossed nine
  digits. The passport pattern is anchored to a passport context, because its
  bare shape (`AB1234567`) is also the shape of half the references in this ERP.
- **Provider routing**: the chat chain is `[primary, fallback]` where the primary is the `ai_vendor_credential` row flagged `is_chat_primary` in the platform DB (chosen in the console; `services/ai/chat-vendors.js` holds the defaults, DeepSeek → Gemini) and the fallback is the default chain minus the primary — so choosing Gemini makes DeepSeek the fallback. `llm.service.resolveChain` reads the flag per call (no restart), ignores a flag on a non-chat vendor, and falls back to the default when the platform DB cannot be asked; the boot health check reports which chain is in force and whether it came from the console or the code. Gemini for vision; Groq for voice; embeddings via OpenAI-compatible endpoint. One shared key set per deployment; discovery keys treated as compromised and rotated.
- **Auditability**: every executed AI write is on the immutable ledger with `source = ai.action.<key>`; every call is on the usage ledger.

## 7. Component/build map

```
src/modules/<group>/<module>/<module>.ai.js   per-module action manifest (NEW convention)
src/services/ai/action-registrar.js            walks *.ai.js → ai_action_catalogue + executor map
src/services/ai/orchestrator.service.js         plan → recall → tools → plan-of-writes → confirm → execute → log
src/services/ai/retrieval.service.js            vector search tenant ∪ global (+ confidentiality)
src/services/ai/ingest.service.js               embed + upsert; event-driven re-embed handler
src/services/ai/llm.service.js                  DeepSeek→Gemini chat + function-calling
src/services/ai/embeddings.service.js           OpenAI-compatible embeddings
src/services/ai/redact.js                       PII/financial redaction — redactForReasoning vs redactExternal (§6)
src/workers/ai/                                 worker-ai: ingest/embed, transcribe (voice), vision (doc)
src/modules/ai/assistant/                        the /api/tenant/ai HTTP surface (ask + confirm + batch)
migrations/tenant/04xx_ai_batch.sql             adds ai_action_run.batch_id
scripts/ai/sync-actions.js                       CLI: rebuild ai_action_catalogue from *.ai.js
scripts/ai/reindex.js                            backfill knowledge (exists)
```

## 7b. Evaluation and health (audit H1, H2)

**Health.** Every signal the assistant already produced and discarded is now a
row: truncation (`finish_reason: "length"` — nothing read it before, so B1's
`max_tokens` fix was unverifiable in production), fallback to a second vendor,
a rejected credential, an exhausted chain, a timeout, the tool-round cap, a
duplicate-read groove, and the anti-stall nudge. `services/ai/health.service.js`
owns the vocabulary and refuses an unknown kind rather than writing it — a
typo'd kind is a counter that reads zero for ever and gets believed.
`llm.service` detects the vendor-chain events (it is the only layer that can
see a fallback happen) and the orchestrator records them through `recordUsage`,
the one choke point every model call already passes through. AI Control →
Health reports them as rates per 1,000 turns, with every kind shown including
the ones at zero.

**Eval.** The golden set (`services/ai/eval/golden-set.js`) is one case per
behaviour the audit paid for, each citing its finding. Grading is a pure
function (`eval/grade.js`), and the split matters:

| | runs | gates the build |
| --- | --- | --- |
| `tests/unit/ai-eval-grader.test.js` | every push, no DB, no vendor | **yes** |
| `scripts/ai/eval.js --tenant=<slug>` | on demand — a seeded tenant + a real model | no |

The rules are what CI can hold to. A gate that asks a live model a question and
asserts on the prose needs a provisioned tenant and a funded credential, and
answers differently every run — a build that reddens because a model rephrased
something is a build people learn to ignore. So the grader is regression-tested
against recorded answers, including the audit's named A1 case (a figure
≥ 100,000,000 XAF reported exactly, and any redaction marker in a tenant-facing
answer treated as a failure), and the live pass reuses that same function
rather than re-implementing it slightly differently.

## 8. Open follow-ups (not blockers)

- Long-term per-user memory (preferences) beyond conversation history.
- Cross-module plans that span services (e.g. cost + quote): the batch already supports it; service-level transaction spanning modules is the piece to design when we build finance/costing depth.
- Depends on **tenant auth + RBAC** landing (the orchestrator's permission check needs a real `req.user`).
