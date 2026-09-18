# Praxis AI — Engineering Audit & Remediation Plan

**Prepared as a Principal Engineer review — LLM integration & ERP AI automation.**
**Scope:** the entire Praxis AI subsystem, backend and frontend.
**Goal of the remediation:** after these fixes, Praxis AI should feel like *Claude, connected to our ERP* — fast, no timeouts, a wide and reliable context window, accurate answers grounded in real tenant data, correct grammar, and the ability to reliably **create anything** (lead, client, supplier, PO, PR, opportunity, …) through the same guarded, human‑confirmed flow.

> How to read this: findings are grouped by theme and severity (**P0** ship‑blocker → **P3** polish). Every finding cites the file that owns it so it can be verified and fixed directly. The remediation is broken into **8 milestones, each a single PR**, at the end.

---

## 0. Remediation progress

_Last updated: 2026-09-18. Keep this section in step with `main` — when a PR merges, tick the findings it closed and link it here. Status legend: ✅ merged · 🟡 in progress · ⬜ not started._

**Next up for another engineer:** PR 5 (reliability/timeouts E1–E4, G2), then PR 6 (conversation management/Spaces), the PR 7 coverage gate + remaining manifests, and PR 8 (eval harness/observability). The write-contract backlog (154 writes) lives in `src/services/ai/write-contract-baseline.json` and is chipped away in any PR. PR 1 (grounding integrity) and PR 2 (completeness/model/fallback + one cached prompt) are both closed now — B5's shared, cacheable prompt prefix (`buildSystemPrompt`/`SYSTEM_RULES`) is the seam PR 4's D3 wider context window can now grow against cheaply. **Whoever closes a milestone updates this section** (the milestone row, the finding rows, and Appendix A where relevant).

**One operational follow-up from PR 1, for whoever deploys it:** [#413](https://github.com/tomblakeasaah196/praxis-ls/pull/413) added strict redaction at `embeddings.embedBatch`, which sits on BOTH sides of the vector — ingest and query. Chunks indexed before it landed were embedded unmasked, so **the global and tenant corpora need a re-index** (`scripts/ai/reindex.js --all`) for query and corpus to be scrubbed by the same function. Until then recall is slightly degraded on text containing contact data, and mail semantic search by a literal email address no longer matches (it embeds as `[EMAIL]`) — a known, accepted cost of the choke point.

### By milestone

| PR | Theme | Status | Landed via |
| -- | ----- | ------ | ---------- |
| PR 1 | Grounding integrity (A1–A4) | ✅ merged | A2 in [#404](https://github.com/tomblakeasaah196/praxis-ls/pull/404); A1 (redaction egress split) + A3 (retrieval budgets) + A4 (no codebase in tenant answers) in [#413](https://github.com/tomblakeasaah196/praxis-ls/pull/413) |
| PR 2 | Completeness, model & no‑truncation (B1, B2, B4, B5) | ✅ merged | B1 + B4 in [#404](https://github.com/tomblakeasaah196/praxis-ls/pull/404); B2 (working Gemini fallback via the OpenAI‑compat gateway + startup health check) and B5 (one shared, cached system‑prompt builder) in [#414](https://github.com/tomblakeasaah196/praxis-ls/pull/414). (B3 — trial a stronger primary model — is a config repoint, not code, and stays open under PR 8.) |
| PR 3 | "Create anything": one write contract (C1–C4) | 🟡 partial | Contract + gate + the named creates + 31 create actions done in [#406](https://github.com/tomblakeasaah196/praxis-ls/pull/406); 154 pre-contract writes inventoried for follow-up |
| PR 4 | Steering, modes & context window (D1–D5, G1) | ✅ merged | D5 + D1 in [#404](https://github.com/tomblakeasaah196/praxis-ls/pull/404); D2/D3/D4 (per‑user steering, wider configurable context window, token‑boundary tool scoring) in [#410](https://github.com/tomblakeasaah196/praxis-ls/pull/410) |
| PR 5 | Reliability, timeouts & performance (E1–E4, G2) | ⬜ not started | — |
| PR 6 | Conversation management & Spaces UX (J1–J5) | ⬜ not started | — |
| PR 7 | Module → AI governance (I1–I4) | 🟡 partial | CLAUDE.md rule added in [#400](https://github.com/tomblakeasaah196/praxis-ls/pull/400) (I3 first step); coverage gate + missing manifests still open |
| PR 8 | Evaluation, quality bar & observability (B6, H1, H2, …) | ⬜ not started | — |

### By finding (what is actually closed on `main`)

| Finding | Sev | Status | Notes |
| ------- | --- | ------ | ----- |
| A2 — OHADA boost mis‑fires on "is" | P1 | ✅ | Regex spelled out; `boostDomainHits` test added. [#404](https://github.com/tomblakeasaah196/praxis-ls/pull/404) |
| B1 — answers truncated (no `max_tokens`) | P0/P1 | ✅ | `config.AI_MAX_TOKENS` (default 4096) sent on every completion. [#404](https://github.com/tomblakeasaah196/praxis-ls/pull/404) |
| B4 — streamed usage counted as zero | P1 | ✅ | `stream_options.include_usage` set on streamed calls. [#404](https://github.com/tomblakeasaah196/praxis-ls/pull/404) |
| B2 — declared fallback vendor can't answer | P1 | ✅ | `gemini` now resolves to the OpenAI‑compat gateway (secrets table → `.env`, no new knobs); a primary CONFIG error degrades to the working fallback (loud, not the stub); `llm.checkVendorHealth()` runs at boot and flags an unresolved/native‑endpoint/non‑distinct vendor. [#414](https://github.com/tomblakeasaah196/praxis-ls/pull/414) |
| B5 — system prompt large, uncached & duplicated | P2 | ✅ | One `SYSTEM_RULES`/`buildSystemPrompt()` shared by `ask`/`askStream` (kills the drift); static prefix marked cacheable per vendor (`cache_control` for explicit vendors, stable‑prefix plain for auto, degrade for unknown). Unblocks PR 4's D3 wider window. [#414](https://github.com/tomblakeasaah196/praxis-ls/pull/414) |
| D5 — Ask/Draft/Analyse/Act were identical | P1 | ✅ | Validator accepts `mode`/`scope`; each mode appends a real posture directive. Act still only *proposes*. [#404](https://github.com/tomblakeasaah196/praxis-ls/pull/404) |
| D1 — `scope` ignored server‑side | P1 | ✅ | Chosen Space now biases tool selection/retrieval. [#404](https://github.com/tomblakeasaah196/praxis-ls/pull/404) |
| D2 — learning signals tenant‑wide | P1 | ✅ | `recentPatterns`/`recentNegativeFeedback` now filter by `user_id` (no tenant fallback — that was the leak), capped + de‑duplicated. [#410](https://github.com/tomblakeasaah196/praxis-ls/pull/410) |
| D3 — thin replay window + prose summary | P2 | ✅ | Window is `AI_HISTORY_TURNS` (40, configurable); window/summary gap closed via `REPLAY_TURNS`; summary is now STRUCTURED (decisions/figures/records/open, verbatim). [#410](https://github.com/tomblakeasaah196/praxis-ls/pull/410) |
| D4 — crude substring tool scoring | P2 | ✅ | `selectTools` scores by token‑set membership ("add" no longer matches "address"); CORE widened per major module. [#410](https://github.com/tomblakeasaah196/praxis-ls/pull/410) |
| F2 — cross‑user prompt contamination | P2 | ✅ | Closed by D2 — no other user's actions/feedback reach a caller's prompt. [#410](https://github.com/tomblakeasaah196/praxis-ls/pull/410) |
| I3 — CLAUDE.md never mentioned manifests | P0 | ✅ | "Wire every module to the AI" rule added. [#400](https://github.com/tomblakeasaah196/praxis-ls/pull/400) |
| C1 — `create_supplier` threw (bare ref) | P0 | ✅ | Write contract + fix; proven at runtime. [#406](https://github.com/tomblakeasaah196/praxis-ls/pull/406) |
| C2 — `create_lead`/`create_opportunity` dropped the actor | P0 | ✅ | Contract forwards the full actor. [#406](https://github.com/tomblakeasaah196/praxis-ls/pull/406) |
| C3 — `create_purchase_request` snake→camel mismatch | P1 | ✅ | Manifest maps fields + forwards actor. [#406](https://github.com/tomblakeasaah196/praxis-ls/pull/406) |
| C4 — no test that a write is executable | P1 | ✅ | `ai-write-contract` gate: runtime proof + ratchet baseline. [#406](https://github.com/tomblakeasaah196/praxis-ls/pull/406) |
| A1 — redaction blanks amounts/refs | P0 | ✅ | Split into `redactForReasoning()` (the caller's own authorised data, prompt-only) and `redactExternal()` (persisted/indexed/client-facing). Number handling is structural, not a nine-digit blackout; the passport rule is anchored to a passport context. **Policy decision — reviewed and signed off before implementation**, recorded in `doc/AI_ARCHITECTURE.md` §6: payment instruments (IBAN/RIB/card) and individual government identity numbers (CNPS/SSN, passport) stay masked on BOTH paths; the two differ on contact data and the NIU only, and a test pins that so the split cannot quietly widen. Amounts and ERP refs now survive on both — which also fixes the rolling summary's `FIGURES` heading (D3). Strict masking added at `embeddings.embedBatch`, covering ingest and query symmetrically. [#413](https://github.com/tomblakeasaah196/praxis-ls/pull/413) |
| A3 — retrieval was 6 chunks total | P1 | ✅ | `k` was the per-corpus LIMIT *and* the final slice. Three pools with separate budgets — knowledge (reserved), tenant (the remainder), codebase (hard-capped) — plus a similarity floor and per-corpus over-fetch. `AI_RETRIEVAL_K` (12) / `AI_RETRIEVAL_KB_K` (4). [#413](https://github.com/tomblakeasaah196/praxis-ls/pull/413) |
| A4 — codebase chunks in tenant answers | P2 | ✅ | Excluded from tenant-facing grounding, filtered in SQL so source files cannot starve the KB before the budget applies. `includeCodebase: true` for a meta/developer surface. [#413](https://github.com/tomblakeasaah196/praxis-ls/pull/413) |
| F3 — redaction trade-off must be deliberate | P2 | ✅ | Closed by A1: third-party PII stays masked on external egress while the caller's own authorised data stops being blanked, and the policy is documented in `doc/AI_ARCHITECTURE.md` §6 rather than living in a PR description. [#413](https://github.com/tomblakeasaah196/praxis-ls/pull/413) |
| B3, B6, E1–E4, G2–G4, H1–H2, I1–I2/I4, J1–J5 | — | ⬜ | Not started. (B3 is a model repoint, not code; F1 is "good, preserve" — not a remediation item; G1 done with D1 in [#404](https://github.com/tomblakeasaah196/praxis-ls/pull/404).) |

**Recommended next PR:** PR 5 (reliability, timeouts & performance — E1–E4, G2). With grounding (PR 1, complete), completeness + model/fallback + one cached prompt (PR 2 ✅), the write contract (PR 3), and steering + context window (PR 4) landed, the next user‑visible lever is "no timeouts": streaming as the primary path, generous caps, and making post‑confirm auto‑continue cheap.

---

## 1. Architecture as it stands (grounded)

```
Client (React)
  client/src/lib/ai-api.ts                 askPraxis / askPraxisStream (SSE), confirm, options, feedback, export
  client/src/features/ai/*                 right-pane, workspace, history-rail
  client/src/features/ai-control/*         governance console (vendors, budgets, grants)

HTTP
  src/modules/ai/assistant/*               controller (ask, /ask/stream SSE, confirm, batch, history, feedback, export)
  src/modules/ai/governance/*              feature flags, grants, budgets, vendor creds, usage ledger

Orchestrator (the agent loop)
  src/services/ai/orchestrator.service.js  recall → plan (function-calling) → run reads → propose writes → confirm → execute → log
  src/services/ai/llm.service.js           OpenAI-compatible /chat/completions, streaming + non-streaming, vendor fallback
  src/services/ai/retrieval.service.js     pgvector RAG over global ∪ tenant corpora
  src/services/ai/redact.js                PII/financial scrubbing before egress
  src/services/ai/answer-sources.js        citations + trace from executed reads
  src/services/ai/action-registrar.js      derives the catalogue + executor map from every <module>.ai.js manifest
  src/services/ai/action-registry.js       hand-vetted write executors
  src/services/ai/action-fields.js         interactive form field metadata (dropdowns, ref pickers)
  src/services/ai/action-authz.js          per-action RBAC gate
```

**What is genuinely good and should be preserved:** the human‑confirm boundary on writes; per‑action RBAC re‑checked at execution (SEC H1); the spend‑cap/entitlement gate (`governance.canUseFeature`); the manifest‑driven catalogue (~82 modules already declare AI reads/writes); the citations/trace provenance; SSE streaming with a heartbeat; the duplicate‑read guard and the "final pass is told it is final" loop design. The problems below sit **on top of** a sound skeleton — most are configuration, contract, and grounding‑integrity issues, not a rewrite.

---

## 2. Findings

### A. Grounding integrity — the assistant is reasoning over mangled data (biggest quality lever)

**A1 — [P0] Redaction destroys the very figures and references the ERP exists to report.**
`redact()` (`src/services/ai/redact.js`) is applied not only to outbound embeddings but to **the tool‑result rows the model reasons over** and to the retrieved context and replayed history (`orchestrator.service.js:846, 1447` for tool results; `:662, 697, 1292, 1303` for context/history). Its catch‑all rule `\b\d{9,}\b → [NUM]` (`redact.js:72`) means **any number with 9+ digits is hidden from the model** — i.e. every amount ≥ 100,000,000 XAF (one hundred million), which for a logistics/OHADA ERP is an everyday figure. The passport rule `\b[A-Z]{1,2}\d{6,9}\b → [PASSPORT]` (`redact.js:68`) mangles ordinary ERP references (e.g. `AB1234567`), and the phone/email rules blank contact data the user is asking about. **Net effect:** the model is asked to answer questions about `[NUM]`, `[PASSPORT]`, `[EMAIL]` — so it either refuses ("I could not establish…") or *hallucinates* a plausible number. This single issue plausibly explains most of the "inaccuracy / hallucination" reported in the review.
*Fix:* separate two egress classes. (1) **Reasoning over tenant data the caller may already see** (tool results, tenant context) should NOT be blanket‑redacted — the caller is authenticated and RBAC‑scoped, and confidentiality tags already filter the corpus (`retrieval.service.js:54`). Keep amounts/refs intact; mask only true secondary‑party PII where required. (2) **True external egress** (embeddings, the summariser) keeps strict masking. Make amount/number handling structural, not a blind digit‑run, and stop the passport rule from eating ERP refs.

**A2 — [P1] The OHADA domain boost mis‑fires on almost every query.** `retrieval.service.js:79` includes `IS\b` in the domain‑keyword regex (intended as the tax "IS" — impôt sur les sociétés). With the `i` flag, `\bIS\b` matches the English word **"is"**, so any question containing "is" ("what **is** the status of…") triggers the accounting‑doc boost and re‑ranks OHADA knowledge above the actually‑relevant chunks. There is also a stray leading space in `| acompte`.
*Fix:* anchor the token (word‑boundaried, case‑sensitive `IS`, or require an accounting co‑term); add a unit test over a non‑accounting query.

**A3 — [P1] Retrieval breadth is only 6 chunks total.** `retrieve()` fetches `k=6` per corpus, merges global ∪ tenant, then `ranked.slice(0, k)` truncates back to **6 chunks total** (`retrieval.service.js:21,64`). For a "wonderful context window" that answers cross‑module questions, 6 chunks is thin, and the global (codebase) corpus competes with tenant knowledge for those 6 slots.
*Fix:* raise k (e.g. 8–12 per corpus, keep more after re‑rank), keep tenant and knowledge‑base hits in separate budgets so one cannot starve the other, and gate on a similarity floor.

**A4 — [P2] The global corpus injects codebase/schema chunks into tenant answers.** The always‑visible global corpus includes codebase and platform‑schema content (`retrieval.service.js:35`, `codebase-brief.js`). Feeding raw code/schema to the assistant is one reason it drifts toward `snake_case`/UUID/"database language" the review repeatedly flagged.
*Fix:* exclude codebase chunks from the tenant‑assistant retrieval (or tag them and only include for developer‑mode questions); keep OHADA/product docs.

### B. Answer completeness, quality & model choice

**B1 — [P0] No `max_tokens` is ever sent — long answers are truncated by the provider default.** Neither `callVendor` (`llm.service.js:70`) nor `callVendorStream` (`:113`) sets `max_tokens`. The output length is then whatever the vendor's default cap is, which is how a full memo/report "cuts off mid‑sentence" (the review's "memory timeout cutting off text" — it is an output‑token cap, not a timeout).
*Fix:* set a generous, explicit `max_tokens` (and make it configurable per feature); size the reply budget to the request.

**B2 — [P1] The declared fallback vendor is `gemini`, which does not speak `/chat/completions`.** `llm.service.js:16–17` sets `PRIMARY="deepseek"`, `FALLBACK="gemini"`, but `ENV_VENDORS` only defines `deepseek` and `openai` (`:20–23`), and Google Gemini's native API is **not** OpenAI‑`/chat/completions`‑shaped. Unless a Gemini **OpenAI‑compatible gateway** is configured in `platform.ai_vendor_credential`, `resolveVendor("gemini")` returns null and the fallback silently degrades to the stub. So a transient primary failure becomes "AI has no provider configured."
*Fix:* make the fallback a real OpenAI‑compatible vendor (or an OpenAI‑compat Gemini gateway), and add a startup/health check that both PRIMARY and FALLBACK resolve.

**B3 — [P1] Primary model is DeepSeek, with an inline‑markup salvage path — a quality and reliability tax.** `llm.service.js:36–66` exists solely because DeepSeek emits tool calls as raw text markup (`<｜…DSML…｜>invoke name=…`) that must be regex‑recovered or it leaks to the user. This is a symptom of a weak tool‑calling model. Model choice is the single biggest lever on answer quality, grammar and hallucination.
*Fix:* trial a stronger tool‑calling model as PRIMARY (governance/`ai_vendor_credential` is a one‑row repoint — `governance.service.js:264`). Keep the salvage path as defence, not as the main road.

**B4 — [P2] Streamed calls under‑count token usage → budget/spend caps drift.** The streaming body sets `stream: true` but not `stream_options: { include_usage: true }` (`llm.service.js:113`), so most OpenAI‑compatible vendors send no `usage` on a stream; `recordUsage` then logs zero input/output tokens for every streamed turn (`orchestrator.service.js:1339, 1494`). The budget hard‑cap and the spend dashboard both read that ledger.
*Fix:* set `stream_options.include_usage`, and/or estimate tokens when the vendor omits usage.

**B5 — [P2] The system prompt is large and re‑sent uncached on every call.** ~2–3 KB of rules is concatenated per turn (`orchestrator.service.js:593–662`, duplicated verbatim in `askStream` `:1236–1292`). No prompt caching is used. This is latency and cost on every question, and the two copies can drift.
*Fix:* extract the system prompt to one shared builder; enable provider prompt caching for the static prefix; keep only the dynamic tail (context, who‑is‑asking) uncached.

**B6 — [P3] No explicit style/grammar contract.** Response quality/grammar currently rides entirely on the model. Add a short, explicit style directive (concise business English, correct grammar, tables where tabular) and — see M6 — an eval that scores it.

### C. "Create anything" — the write‑execution contract is inconsistent (this is why lead/supplier/PR fail)

The AI's ability to *do* things splits into two code paths, and only one is correct:

- **Vetted registry** (`action-registry.js:23–86`) — 10 writes, each bridging the AI's `snake_case` payload to the service's real signature and **passing the actor**: `create_client`, `open_dossier`, `update/transition_dossier`, `create_costing`, `draft_quotation`, `draft_final_invoice`, `draft_purchase_order`, `draft_supplier_invoice`, `draft_cash_request`. These work.
- **Generic write adapter** (`action-registrar.js:154–167`) — every *other* write (~70 across the manifests) calls `service(client, payload, { user_id })`. This is where it breaks:

**C1 — [P0] Raw `service.create` manifest refs receive the flat payload in the wrong parameter.** `create_supplier` wires `service: service.create` (`supplier_master.ai.js:11`), but `supplier_master.service.create(client, { data, actor })` (`supplier_master.service.js:17`) expects a `{data, actor}` object. The generic adapter calls `service.create(client, <flatPayload>, {user_id})`, so `data` is `undefined` and the create **throws / validation‑fails**. **Creating a supplier via AI is broken today.** The same shape affects any manifest that wires a bare `{ data, actor }`‑style service by reference.

**C2 — [P0] Manifest arrow wrappers `(c, p) => service.x(c, {…})` silently drop the actor.** `create_lead` wires `(c, p) => service.create(c, { data: p })` (`lead.ai.js:13`); `create_opportunity` similarly (`opportunity.ai.js:13`). The generic adapter passes the actor as a 3rd argument, but these 2‑arg arrows ignore it, so the write executes with `actor = {}` (`lead.service.js:32`). Result: missing `created_by`/attribution, and a hard failure wherever the column or a rule requires the actor. This is a systemic correctness/audit gap across most non‑vetted writes.

**C3 — [P1] snake_case ↔ camelCase mismatch on non‑vetted writes.** `create_purchase_request` wires `service.createDraft` by reference (`purchase_request.ai.js:11`), but the service destructures **camelCase** `{ requestedBy, department, scopeId, justification, lines, actor }` (`purchase_request.service.js:21`). The AI payload is `snake_case`, so `requestedBy` etc. arrive `undefined`. The vetted executors solve this per‑action by hand; the generic path does not.

**C4 — [P1] There is no test that every AI‑enabled write is actually executable.** The catalogue advertises a write as `ai_enabled` whenever a manifest provides *any* `service` function (`action-registrar.js:170–173`) — regardless of whether the adapter will call it in the right shape. So the catalogue can promise capabilities the runtime cannot honour (exactly C1–C3). The misleadingly‑named `enableWritesInRegistryOnly` flag (`action-registrar.js:191, 208`) does not actually restrict anything.

**Net:** *client* and *PO* work (vetted); *supplier* is broken; *lead*, *opportunity*, *PR* execute wrongly (no actor / wrong field shape); ~65 other writes are untested and likely share the fault.
*Fix (M3):* define **one** write‑execution contract and make every module conform. Recommended: a single normalized executor that always calls the service as `service(client, { data: payload, actor: user })` (or an explicit per‑manifest `aiService` with a fixed signature), plus a build/test gate that instantiates every `ai_enabled` write against a smoke fixture and asserts it runs with the actor. This also future‑proofs new modules: "ship a manifest that conforms to the contract and you are connected."

### D. Context window, memory & steering

**D1 — [P1] The copilot can be pointed at a module, but the backend ignores it.** The client sends `scope` (area) and `mode` on every ask (`ai-api.ts:139–154, 223–228`), and the validator drops them (non‑strict schema). The review's "you must name the module for it to pull the right data" is the direct consequence: `selectTools` (`orchestrator.service.js:440`) keyword‑scores the *message text* to pick ≤64 tools, with no signal from the scope the user already chose.
*Fix:* honour `scope`/`mode` — bias tool selection and retrieval toward the chosen area; widen only on explicit "all".

**D2 — [P1] "Learning" signals are tenant‑wide, not per‑user.** `recentPatterns` (`:285`), `recentNegativeFeedback` (`:320`) and the executed‑action learning pull the last N rows across the whole tenant with no user filter, then inject them into the system prompt. This mixes one user's actions/feedback into another user's prompt (quality noise and a minor privacy smell), and grows the prompt.
*Fix:* scope to the caller (and/or their role); cap and de‑duplicate.

**D3 — [P2] Replay window is 20 turns + a 200‑word rolling summary — modest for "a wonderful context window."** `HISTORY_TURNS=20` (`:25`), `SUMMARY_WORDS=200` (`:43`), with a known gap of up to `SUMMARY_BATCH‑1` messages between the window and the summary (`:34`). Fine for cost control, but thin for long working sessions.
*Fix:* with prompt caching (B5) the replay window can grow cheaply; consider a larger window + a structured (not just prose) summary of decisions/figures/records.

**D4 — [P2] Tool scoping is crude substring scoring.** `selectTools` scores by `hay.includes(word)` (`:446`), so short tokens match spuriously (`"add"` ⊂ `"address"`, `"is"` ⊂ `"list"`), and a relevant tool can be dropped from the 64 if the user did not name its module. Combined with D1 this is the "must specify the module" complaint.
*Fix:* token‑boundary matching + the scope signal from D1; keep a slightly larger CORE set; consider embedding‑based tool retrieval.

**D5 — [P1] Ask / Draft / Analyse / Act are cosmetic — all four behave identically.** The composer offers four modes (`client/src/components/ai/context.tsx:125–128`; `composer.tsx:17`) — Ask ("answer from my records"), Draft ("write it for me"), Analyse ("figures, trends, variances"), Act ("propose an action to confirm") — and sends the chosen one as `mode`. The backend never reads it (dropped by the non‑strict validator, `ai-api.ts:136`), so **all four produce the same prompt and the same behaviour**. The user picks "Draft" and gets whatever the model would have done anyway; "Analyse" does not bias toward figures/tables; "Act" does not bias toward proposing a write. This is a visible promise the product does not keep.
*Fix:* honour `mode` server‑side — each mode appends a short posture directive to the system prompt (Draft → write the artifact in full; Analyse → prefer tables + variances and show the numbers; Act → prefer proposing the write once details exist; Ask → read‑only, never propose a write) and can bias tool selection (Act widens writes, Analyse widens reads/metrics). This is small and high‑impact.

### E. Timeouts, performance & reliability ("ensure there are no timeouts")

**E1 — [P1] Hard per‑call axios timeouts can abort real work.** Non‑streaming calls time out at 60 s (`llm.service.js:75`), streaming at 120 s (`:120`). A non‑streaming `ask` makes several sequential model calls (initial + one per tool round + final pass), each capped at 60 s; a slow model on a genuine multi‑hop chain can trip these, and a tripped call is treated as transient → falls back to the (mis‑configured, B2) `gemini` → stub. The SSE path already sends a 15 s heartbeat to defeat proxy idle timeouts (`assistant.controller.js:78`), which is good.
*Fix:* make streaming the primary path everywhere (the per‑screen `askPraxis` still uses non‑streaming); raise the timeouts to generous values, keep the heartbeat, and rely on client‑disconnect abort rather than a short hard cap. Ensure no reverse‑proxy/Express body timeout sits below the AI budget.

**E2 — [P1] Every confirmed action fires an extra full `ask()` turn.** `confirmAction` runs a narration call **and** a recursive `ask()` follow‑up to auto‑propose the next step (`orchestrator.service.js:1102, 1119`), the latter re‑running retrieval + summary‑condense + patterns/feedback/preferences + a model call — 2–3 LLM round‑trips per confirm. That is latency and spend on every single action, and the recursive `ask` passes `allowed: undefined` (`:1119`) so it loses the caller's confidentiality tags.
*Fix:* make auto‑continue opt‑in or cheap (reuse the already‑loaded context; skip retrieval/condense on the follow‑up); pass the caller's `allowed` through.

**E3 — [P2] Non‑streaming `ask` re‑issues a final toolless model call every round.** The loop sets `finalPass` and calls the model again each iteration (`:857–872`), which is correct but costly; align it with the streaming path's single final pass.

**E4 — [P2] Embeddings are a silent hard dependency for grounding.** If no embeddings vendor is configured, `retrieve` returns `[]` (`retrieval.service.js:29`) and the assistant runs with **zero** knowledge‑base grounding, relying only on tool reads — with no visible signal that recall is off.
*Fix:* surface embeddings health in AI Control; warn (once) when grounding is disabled.

### F. Security & privacy (mostly sound — protect the gains)

**F1 — [good] Writes are RBAC‑gated at execution and re‑gated at confirm** (`orchestrator.service.js:1012–1025`, SEC H1), and reads are gated too (`:830`). Keep this; the M3 contract change must not bypass `actionAuthz.assertAllowed`.
**F2 — [P2] Cross‑user prompt contamination** — see D2; treat as a privacy item as well as quality.
**F3 — [P2] Redaction trade‑off must be deliberate** — A1's fix must keep true third‑party PII masked on external egress (embeddings/summariser) even as it stops blanking the caller's own authorised data. Document the policy.

### G. Frontend

**G1 — [P1] `scope`/`mode` are collected and sent but never honoured** (pairs with D1) — `ai-api.ts:139`. Either honour them server‑side or the UI control is theatre.
**G2 — [P2] Non‑streaming fallback inherits the client HTTP timeout.** `askPraxis` uses the shared `tenant()` fetch; ensure its timeout is AI‑appropriate, or route the per‑screen copilot through the streaming path too.
**G3 — [P2] Verify the working features the review liked still hold:** listen‑aloud (TTS), open‑in‑canvas → Markdown download, and table → xlsx export (`ai-api.ts:379`, `assistant.export.js`). These should be covered by the M6 regression pass so a refactor cannot silently break them.
**G4 — [P3] Error surfacing.** The stream yields a single `error` event; make sure the UI renders a retry affordance and distinguishes "provider misconfigured" (B2) from "transient."

### H. Evaluation & observability (the missing safety net)

**H1 — [P1] There is no evaluation harness.** Every behaviour above is currently verified by hand. Without a golden‑set eval over a seeded tenant, each fix risks regressing another (this module already carries scars from exactly that — see the many "audit 3.x" comments).
*Fix (M6):* a repeatable eval: a fixture tenant, a set of graded questions and create‑X tasks, assertions on grounding accuracy (numbers reported correctly), no‑truncation, tool‑selection correctness, and write success. Run it in CI as a gate.
**H2 — [P2] Failure telemetry is thin.** `recordUsage` logs tokens/latency/success, but truncation, tool‑selection misses, duplicate‑read grooves, and fallback‑to‑stub events are not first‑class metrics.
*Fix:* structured counters + an AI‑health panel in AI Control.

### I. Module → AI governance & manifest drift (why a third of the app is invisible to the assistant)

**I1 — [P0] The read‑first rules never mention AI manifests.** `CLAUDE.md` — the document every engineer is told to read before writing code — contains **zero** references to `*.ai.js`, `ai_action_catalogue`, or the AI at all. The convention *does* exist, but only in `doc/BUILD_CONVENTIONS.md` (a build checklist, line 81) and `doc/AI_ARCHITECTURE.md` §2 — neither of which the working‑rules doc points to. So an engineer adding or changing a module has no prompt to update its manifest, and the AI silently falls behind the app.

**I2 — [P0] Nothing enforces manifest coverage or catalogue sync.** `scripts/ai/sync-actions.js` only has `--dry`/`--tenant`/`--all` — there is **no `--check` mode**, and `ci-local.js` does not run it. No gate fails when a module ships without a manifest, when a manifest drifts from its service (the C1–C3 shape mismatches), or when the live catalogue is stale. `AI_ARCHITECTURE.md:62` claims "Adding/removing a module updates the catalogue automatically → no drift" — that is **aspirational**: it only holds if someone remembers to run the sync and the manifests are correct, and there is no check that either is true.

**I3 — [P0] Measured drift: 38 of 119 modules (with a service/controller) have no manifest.** Excluding the legitimately non‑AI ones (auth/session/RBAC, `ai/*` itself, `branding`, `preference`, `audit_ledger`), the real, user‑facing coverage gaps include — several of them **built after Praxis AI shipped**:
`finance/credit_note`, `operations/q_ticket`, `dashboard/support` (support tickets — the meeting's "tickets → AI self‑healing"), `dashboard/workspace` (**Tasks & Calendar — new**), `hr/{onboarding,succession,hr_query,hr_sanction}`, `vault/{document_vault,document_verification,signature_request}`, `documents/template`, `master/{master_config,rate_provider}`. The assistant cannot see, answer about, or act on any of these — so "everything is connected to AI" is not true today.
*Fix (PR 7):* a **manifest‑coverage CI gate** — every module with a public controller either has a `*.ai.js` or carries an explicit, reviewed `// ai:none` opt‑out; plus wire manifests for the AI‑relevant gaps above.

**I4 — [P1] Confirm both `live` and `sandbox` schemas are synced.** `sync-actions.js` targets `["live"]`; a TEST/sandbox copilot (the LIVE/TEST toggle) that runs on seed‑only actions would explain "it works in live but not in test." Verify and sync both.

### J. Conversation management & Spaces UX (to actually mirror Claude)

**J1 — [P1] A conversation cannot be deleted or archived.** The repo exposes `currentConversation` / `startNewConversation` / `clearHistory` (`assistant.repo.js`) — and `clear` deliberately does **not** delete (it starts a new thread and retains the old one, because `ai_action_run` FKs `conversation_id`, `assistant.repo.js:136–150`). There is no delete or archive endpoint, service, or UI. So sensitive research (the exact case raised) cannot be removed or hidden. *Fix:* a soft‑delete/archive (`deleted_at`/`archived_at` on `ai_conversation`, filtered out of `listConversations`; a hard purge that also clears the FK'd action runs, gated by confirm).

**J2 — [P1] A conversation cannot be pinned.** No pin flag or ordering hook; important threads sink into the time buckets. *Fix:* `pinned_at`, sorted above the buckets.

**J3 — [P2] A conversation cannot be renamed.** Titles are auto‑derived from the first user message (`assistant.repo.js:84–88`); there is no rename.

**J4 — [P1] The Spaces list is not collapsible.** `history-rail.tsx:100–140` renders Spaces as a fixed, always‑expanded section above the conversation list, so a long scope list pushes chats down and hides them. *Fix:* a collapsible Spaces section (remembered open/closed per user) so the conversation list gets the room.

**J5 — [P2] Row‑level affordances are missing entirely.** Each conversation row is a single open button (`history-rail.tsx:164–190`) with no hover menu for pin/rename/archive/delete — the controls a Claude‑like history rail needs. *Fix:* a per‑row overflow menu; document the pattern in `doc/FRONTEND_GUIDE.md` in the implementing PR (kept out of this audit so `check:docs` does not flag components that do not exist yet).

---

## 3. Remediation plan — 8 milestones, one PR each

Each milestone is independently shippable, gated by `npm run ci`, and closes the findings listed. Ordered by user‑visible impact. Every finding above maps to exactly one PR below.

### PR 1 — Grounding integrity (closes A1, A2, A3, A4; also F3) · **P0** — ✅ landed ([#404](https://github.com/tomblakeasaah196/praxis-ls/pull/404), [#413](https://github.com/tomblakeasaah196/praxis-ls/pull/413))
Make the model reason over real data.
- Split redaction into "reasoning over authorised tenant data" (keep amounts/refs; mask only true PII) vs "external egress" (embeddings/summariser: strict). Remove the blanket `\d{9,}` blackout from the reasoning path; fix the passport/ref over‑match.
- Fix the OHADA boost regex (`IS\b`), add tests.
- Raise retrieval breadth; separate KB vs codebase budgets; exclude codebase chunks from tenant answers.
- **Acceptance:** ask "what is our largest receivable" on seeded data ≥ 100,000,000 XAF → the exact figure is reported, not `[NUM]`; a non‑accounting question no longer boosts OHADA docs; refs render intact.

### PR 2 — Completeness, model & no‑truncation (closes B1, B2, B4, B5; supports E1) · **P0/P1**
- Send explicit, configurable `max_tokens`; make streaming the primary path; set `stream_options.include_usage`.
- Fix the fallback vendor to a real OpenAI‑compatible endpoint + a startup health check for PRIMARY and FALLBACK; one shared cached system‑prompt builder (dedupe the two copies).
- **Acceptance:** a long memo/report renders complete; streamed turns record non‑zero token usage; killing the primary key degrades to a working fallback, not the stub.

### PR 3 — "Create anything": one write contract (closes C1, C2, C3, C4; guards F1) · **P0**
- Define a single normalized write‑execution contract (`service(client, { data: payload, actor })`, or a per‑manifest `aiService` with a fixed signature) and migrate every manifest + the generic adapter to it, so **actor is always passed** and **payload shape is always right**.
- Add a CI gate/test that every `ai_enabled` write resolves to an executor and runs against a smoke fixture **with the actor present**; fail the build if a catalogue write is not truly executable.
- **Acceptance:** creating a **lead, client, supplier, PO, PR, opportunity** (and a representative write from every module family) via the assistant succeeds end‑to‑end, with correct attribution and audit rows; the test matrix in Appendix A is green.

### PR 4 — Steering, modes & context window (closes D1, D2, D3, D4, D5; G1) · **P1**
- Honour `scope` AND `mode` server‑side: bias tool selection + retrieval toward the chosen area, and give each mode a real posture (Draft → write the artifact; Analyse → tables/variances with the numbers shown; Act → prefer proposing the write; Ask → read‑only). Token‑boundary tool scoring; scope per‑user learning/feedback/preferences; grow the replay window (cheap once PR 2 caches the prefix) with a structured summary.
- **Acceptance:** the four modes visibly change the answer's shape; choosing an area improves relevance without the user naming the module; no cross‑user data appears in prompts.

### PR 5 — Reliability, timeouts & performance (closes E1, E2, E3, E4; G2) · **P1**
- Remove sub‑budget hard timeouts end‑to‑end (generous caps + heartbeat + disconnect‑abort); make post‑confirm auto‑continue cheap/opt‑in and pass `allowed` through; align the non‑stream final‑pass; surface embeddings health.
- **Acceptance:** a genuine 6–8 hop question completes without a timeout; a confirm no longer costs 2–3 extra model calls by default; disabling embeddings shows a clear "grounding limited" state.

### PR 6 — Conversation management & Spaces UX (closes J1, J2, J3, J4, J5) · **P1**
Make the copilot's history behave like Claude's.
- Backend: soft‑delete + archive + pin + rename on `ai_conversation` (`deleted_at`/`archived_at`/`pinned_at`/`title`), with a confirm‑gated hard purge that also clears the FK'd `ai_action_run` rows; endpoints + `ai-api.ts` methods.
- Frontend: a per‑row overflow menu (pin / rename / archive / delete) on the history rail; a **collapsible Spaces section** (state remembered per user) so the conversation list gets the room; pinned threads sort above the time buckets. Document the pattern in `doc/FRONTEND_GUIDE.md` (now that the components exist, so `check:docs` stays green).
- **Acceptance:** a sensitive thread can be deleted or archived; a thread can be pinned to the top and renamed; collapsing Spaces reveals more chats.

### PR 7 — Module → AI governance: close the drift, wire the gaps (closes I1, I2, I3, I4) · **P0**
Guarantee "everything is connected to AI" and keep it that way.
- Add a **manifest‑coverage CI gate**: every module with a public controller must have a `*.ai.js` **or** an explicit reviewed `// ai:none` opt‑out; the gate lists offenders and fails the build. Add `sync-actions.js --check` (drift: catalogue vs manifests) and run both in `ci-local.js`/CI. Combine with PR 3's write‑executability gate.
- Author the missing AI‑relevant manifests (credit_note, q_ticket, support tickets, workspace Tasks/Calendar, the HR sub‑modules, document vault/verification/signature‑request, templates, master_config/rate_provider).
- **Point CLAUDE.md at the rule** (done in this audit PR as a first step) and correct `AI_ARCHITECTURE.md:62`'s "no drift" claim to reference the gate. Verify `live` **and** `sandbox` catalogue sync.
- **Acceptance:** the coverage gate is green with no silent gaps; adding a module without a manifest (or opt‑out) fails CI; the assistant can see/act on the newly‑wired modules.

### PR 8 — Evaluation, quality bar & observability (closes B6, H1, H2; G3, G4) · **P1/P2**
_F3 moved to PR 1 — the redaction policy could not be decided separately from the change that loosened it, so it is documented in `doc/AI_ARCHITECTURE.md` §6 rather than deferred to here._
- A golden‑set eval over a seeded tenant (grounding accuracy — numbers reported correctly; no truncation; tool‑selection; write success with actor; grammar/style score) wired into CI; structured AI‑health telemetry (truncations, fallbacks, tool‑miss, groove, timeouts) + an AI Control panel; regression coverage for TTS / open‑in‑canvas → Markdown / table → xlsx. The eval's grounding‑accuracy cases should include the A1 regression directly: a seeded figure ≥ 100,000,000 XAF reported exactly, and a `[NUM]` in an answer treated as a failure.
- **Acceptance:** the eval runs in CI and blocks regressions; the health panel shows truncation/timeout/fallback rates trending to zero after PRs 1–7.

---

## Appendix A — write‑executability matrix (to be filled by PR 3's gate)

For every `ai_enabled` write in `ai_action_catalogue`: does an executor resolve? Is the payload shape correct? Is the actor passed? Does a smoke create succeed?

**Status after PR 3 ([#406](https://github.com/tomblakeasaah196/praxis-ls/pull/406)):** the write contract is defined (`service(client, payload, actor)`, full actor forwarded — `action-registrar.writeAdapter` + `doc/AI_ARCHITECTURE.md` §2) and enforced by `tests/unit/ai-write-contract.test.js` (`services/ai/write-contract.js`). The confirmed-broken writes are fixed and proven at runtime: `create_client` ✅, `create_supplier` ✅ (was C1 — threw), `create_lead` ✅ (was C2 — actor dropped), `create_opportunity` ✅ (was C2), `create_purchase_request` ✅ (was C3 — field-shape + actor), `draft_purchase_order` ✅. In the same pass, **31 create actions** were migrated to the contract (every `{ data, actor }`-shaped create across fleet, HR, master, sales, finance, WMS, procurement — so "create anything" holds for the create surface). The remaining **154 writes** (updates, transitions, status/settle actions, and camelCase-mapped creates) are inventoried in `src/services/ai/write-contract-baseline.json`; the ratchet forbids new non-conforming writes and shrinks as each is migrated (PR 4+). Those 154 still execute — the ones that map fields work; the actor-dropping subset mis-attributes until migrated.

## Appendix B — configuration checklist (no code, but required for the above to hold)

- **Primary chat model:** confirm which model `platform.ai_vendor_credential` points to today; trial a stronger tool‑calling model (B3).
- **Fallback vendor:** must be OpenAI‑`/chat/completions`‑compatible and actually configured (B2).
- **Embeddings vendor:** must be configured or grounding silently degrades (E4).
- **Budgets/entitlements:** verify the plan `ai_spend_xaf` limit and tenant budget are set intentionally (`governance.service.js`).
