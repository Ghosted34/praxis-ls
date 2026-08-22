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
| Providers                | **DeepSeek primary → Gemini fallback** (reasoning/agent + vision), OpenAI-compatible **embeddings**, **Groq** voice. All API, per-tenant keys, swappable layer.                             |
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
      service: service.create,
      schema: validator.schemas.create, // becomes payload_schema
      permission: "finance.create", // checked against the caller's RBAC
      confirm: true,
      describe:
        "Issue a final invoice for a dossier (recognises revenue per KB §8.3).",
    },
  ],
};
```

**Registrar (boot / `ai:sync-actions`):** walk every `*.ai.js`, upsert `ai_action_catalogue` rows (`action_key`, `is_write`, `payload_schema` from the Zod schema, `required_permission`, `requires_confirmation`, `ai_enabled`), and build an in-memory `{ action_key → { service, schema, permission } }` map. Adding/removing a module updates the catalogue automatically → no drift. Sensitive writes (accounting postings, payroll) may hand-tune their Zod/business-rule layer while still being auto-registered.

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
- **PII/financial redaction** before any external model call or embed.
- **Provider routing**: DeepSeek → Gemini fallback; Gemini for vision; Groq for voice; embeddings via OpenAI-compatible endpoint. Keys per tenant where billing separates; discovery keys treated as compromised and rotated.
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
src/services/ai/redact.js                       PII/financial redaction
src/workers/ai/                                 worker-ai: ingest/embed, transcribe (voice), vision (doc)
src/modules/ai/assistant/                        the /api/tenant/ai HTTP surface (ask + confirm + batch)
migrations/tenant/04xx_ai_batch.sql             adds ai_action_run.batch_id
scripts/ai/sync-actions.js                       CLI: rebuild ai_action_catalogue from *.ai.js
scripts/ai/reindex.js                            backfill knowledge (exists)
```

## 8. Open follow-ups (not blockers)

- Long-term per-user memory (preferences) beyond conversation history.
- Cross-module plans that span services (e.g. cost + quote): the batch already supports it; service-level transaction spanning modules is the piece to design when we build finance/costing depth.
- Depends on **tenant auth + RBAC** landing (the orchestrator's permission check needs a real `req.user`).
