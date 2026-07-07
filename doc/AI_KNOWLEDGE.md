# Praxis LS — AI Knowledge & Self-Learning Layer

**Goal:** a per-tenant assistant that *knows* (a) the entire tenant database, (b) the platform, (c) the codebase, and (d) the OHADA/tax domain — and can **carry out tasks** through governed, permission-bound actions. Read alongside `doc/DB_ARCHITECTURE.md`.

## 1. Two corpora, strict isolation
Vectors are split so tenant data never crosses tenants, while non-sensitive shared knowledge is stored once:

| Corpus | Lives in | Holds | Who sees it |
|---|---|---|---|
| **Tenant corpus** | each tenant DB (`live.ai_document`/`ai_chunk`, already in migration 0400) | that tenant's business data (dossiers, clients, invoices, dictionary, vault text, comms) + that tenant's schema cards | only that tenant, filtered further by field-confidentiality |
| **Global corpus** | platform DB (`platform.ai_source`/`ai_document`/`ai_chunk`, migration 0040) | the **codebase**, the **platform schema**, and the **domain docs** (OHADA KB, PRD, RBAC) — none of it tenant-specific | all tenants (read-only, non-sensitive) |

A query embeds once and searches **tenant corpus ∪ global corpus**, then applies the caller's RBAC/field rules to the tenant hits.

## 2. What the AI learns (knowledge sources)
1. **Database schema (structure).** Introspect `information_schema` + our catalogs → one **schema card** per table: columns/types, FKs, enums/CHECKs, the module it belongs to, and a one-line purpose. Tenant schema → tenant corpus; platform schema → global. This is how the assistant knows "the entire DB per tenant and platform" without dumping rows.
2. **Codebase.** Walk `src/`, `migrations/`, `scripts/`, `doc/` → chunk by file/section → global corpus. Lets the AI explain and reason about the system it runs inside.
3. **Domain docs.** The OHADA/Tax KB, PRD, RBAC journey → global corpus. This is where the accounting rules (débours, §23 invariants, tax codes) become retrievable knowledge.
4. **Tenant business data (contents).** Curated **entity cards** — a compact text summary per dossier, client, supplier, dictionary item, invoice, vault document, comms thread — embedded into the tenant corpus with a `confidentiality` tag and a `source_ref` back to the row. Not every column of every row: cards + live function-calling cover freshness.

## 3. Vectors vs function-calling (the division of labour)
- **Vectors (recall):** semantic "what/where/which" over schema cards, docs, codebase, and entity cards — fuzzy, cross-referenced, good for grounding.
- **Function-calling (truth):** exact, current values (a balance, an overdue list, today's FX) fetched live through whitelisted typed functions that run **with the calling user's permissions**. Freshness and authority come from here.
The assistant plans with recall, then calls functions for authoritative data, then acts.

## 4. Self-learning (how the corpus stays current)
Ingestion is a worker with four triggers:
- **Backfill** — `scripts/ai/reindex.js` builds everything from scratch (schema + codebase + docs + tenant data).
- **On write** — the Universal Event Engine (`event_log`) emits `entity.action`; an ingest handler re-embeds just the changed entity's card. So the AI "learns" a new dossier/invoice within seconds of it being created.
- **On migrate** — after `db:migrate:tenants`, schema cards are rebuilt (structure changed).
- **On deploy** — codebase + docs re-indexed when files change (content hash per chunk; only changed chunks re-embed).
Every chunk stores a `content_hash`; re-ingest is idempotent (skip unchanged), so re-learning is cheap.

## 5. Governance (unchanged rules, enforced here)
- **EMV toggle:** the whole surface is gated by `feature_state` — `ai.assistant` (UI), `ai.assistant.backend` (server actions), `ai.vectorization` (recall). Off → nothing runs.
- **The AI never exceeds the user:** recall filters by the caller's field-confidentiality; actions run with the caller's RBAC and are Zod-gated (≤2 self-correct → manual form). Human confirmation before anything writes/sends.
- **Redaction before egress:** PII/financial fields are masked before any text is sent to an external model or embedded.
- **Everything logged:** prompts/metadata/cost → `ai_usage_ledger`; executed actions → `immutable_ledger`. Per-tenant spend caps (`ai_budget_period`).
- **Provider routing:** DeepSeek (reasoning/agent) primary → Gemini fallback; OpenAI-compatible embeddings; Whisper/Groq for voice. Keys per tenant where billing separates.

## 6. Components (this build)
```
migrations/platform/0040_ai_knowledge.sql   global corpus (ai_source/ai_document/ai_chunk)
src/services/ai/embeddings.service.js        embed text → vector (dim from env)
src/services/ai/llm.service.js               chat + function-calling (DeepSeek→Gemini)
src/services/ai/chunker.js                   deterministic text splitter (+ content hash)
src/services/ai/knowledge/schema-introspect.js   DB → schema cards
src/services/ai/knowledge/codebase.js        repo/docs → chunks
src/services/ai/knowledge/entity-cards.js    tenant rows → cards
src/services/ai/ingest.service.js            embed + upsert (tenant | global), idempotent
src/services/ai/retrieval.service.js         query → vector search (tenant ∪ global) + filter
src/services/ai/orchestrator.service.js      recall + function-calling + Zod gate + execute + log
scripts/ai/reindex.js                        self-learn backfill CLI
```
