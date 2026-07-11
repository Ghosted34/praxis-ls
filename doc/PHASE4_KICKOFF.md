# Praxis LS — Phase 4 Kickoff (Intelligence & reach)

Entry audit for Phase 4, done against `AI_ARCHITECTURE.md`, `AI_KNOWLEDGE.md`,
`AI_READINESS.md` and the module catalogue. Records what already exists, the
scaffold debt that was cleared on entry, and the dependency-ordered build plan.

## 1. What already exists (reusable)

The AI service layer is substantially scaffolded under `src/services/ai/`:
`orchestrator.service`, `retrieval.service`, `ingest.service`, `llm.service`,
`embeddings.service`, `redact`, `chunker`, `action-registry`, plus a `knowledge/`
walker and `scripts/ai/reindex.js`. The tenant AI schema (`migrations/tenant/
0400_ai.sql`) is complete: `ai_feature_flag`, `ai_access_grant`,
`ai_vendor_credential`, `ai_budget_period`, `ai_usage_ledger`,
`ai_action_catalogue`, `ai_document`/`ai_chunk` (pgvector), `ai_conversation`/
`ai_message`, `ai_action_run`. The `ai/assistant` HTTP module (`/api/tenant/ai`,
feature `ai.assistant.backend`) is a thin, correct wrapper over the orchestrator.

Per the AI-readiness rule, **every module now ships a `<module>.ai.js` manifest**
— 32 manifests total (15 added this sprint for the modules built in the Phase-1/2
gap-closure). Each declares `reads` (auto-approved) and `writes` (Zod-gated + RBAC
+ confirm), so the auto-derived tool catalogue equals app capability with no drift.

## 2. Scaffold debt cleared on entry

`ai/governance` and `ai/insights` were **foreign code** (same contamination class
Phase 0 removed): they queried NGN-currency columns (`hard_cap_ngn`,
`cost_price_ngn`), a `config/brands.t(brand, "invoices")` brand-table
architecture, and non-existent business tables (`service_jobs`, `crm_deals`,
`production_runs`, `sales_orders`). None of that matches Praxis LS (XAF/centimes,
schema-per-tenant, `dossier`/`invoice`/…). They were the two modules the loader
had been silently skipping.

Actions taken:
- **Removed** both foreign modules entirely.
- **Rebuilt `ai/governance` real** against the actual `ai_*` schema: the EMV
  feature toggle (`ai_feature_flag`), per-user access grants (`ai_access_grant`),
  spend caps (`ai_budget_period` + `ai_usage_ledger`, soft→WARN / hard→BLOCK), and
  vendor credentials (`ai_vendor_credential`, API keys AES-256-GCM encrypted via
  `encryption.service`, never returned by read APIs). Exposes the runtime guard
  `canUseFeature(user, feature)` and `recordUsage(...)` the orchestrator needs,
  plus `getVendorConfig` (internal, decrypted). Pure rules
  (`estimateCostXaf`/`capState`/`canUse`) are unit-tested.
- Fixed a stale relative-path bug in the remaining AI files
  (`../../config` → `../../../config`).

Result: the loader now discovers and mounts **87/87** modules with zero skips;
`eslint src --quiet` is clean.

## 3. Phase 4 build plan (dependency-ordered)

1. ✅ **Action registrar sync** — `src/services/ai/action-registrar.js` walks all
   33 manifests → 134 catalogue actions (63 writes / 71 reads), Zod→JSON-schema,
   `required_permission`, `requires_confirmation`; `ai_enabled` gated by the vetted
   executor registry (no drift). CLI `scripts/ai/sync-actions.js` (--tenant/--all/
   --dry). Assistant uses the auto-derived executor map.
2. ✅ **Assistant pipeline gated** — orchestrator `ask()`/`confirmAction` check
   `governance.canUseFeature` (feature on + grant + budget not hard-capped) and
   record usage against the budget period via `governance.recordUsage`.
3. ✅ **Multi-write plans** — `0420_ai_batch.sql` adds `ai_action_run.batch_id`;
   a turn's proposed writes share a batch; `confirmBatch` executes them in order,
   halting on first failure (`POST /ai/batches/:batchId/confirm`).
4. ✅ **worker-ai** — `ai-transcribe` (Groq/Whisper voice→text) and `ai-vision`
   (Gemini doc→fields) handlers feed the same propose→confirm turn, governance-
   gated on `voice`/`doc_vision`; queues registered in the worker runtime.
   Provider calls are swappable services; they throw a clear "not configured"
   until keys are set (parity with PDF needing Chromium). Event-driven re-embed
   handler still to wire.
5. **MOD-63 Reporting & Insights** — rebuild `insights` real against Praxis LS
   tables (dossier P&L, receivables ageing, procurement spend, cash position),
   with chat-on-dashboards.
5. **MOD-27 Pricing Variance Index** — the Sales-facing R/Y/G view over
   `pricing_variance` (quote vs actual cost; never exposes raw cost to Sales).
6. **MOD-65 Compliance Checker** — proof-required rules over `cost_entry`/vault.
7. **Portals + Smart Comms** — Client Portal (↔ dossier), Investor/Board terminal
   (↔ statements), Audit data room (↔ vault); WebSocket messaging + certified
   export.

## 4. Test ledger delta

New this entry: `ai-governance` (3), `tax-jurisdiction` (3); `ai-readiness` now
covers all 32 manifests (38 assertions). Full suite remains green.
