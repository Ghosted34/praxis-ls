# AI Implementation Audit — Praxis LS

**Date:** 2026-08-08
**Scope:** Full AI subsystem — orchestrator, governance, retrieval, LLM, vision, voice, action registrar, client UI, and tests.
**Auditor:** Automated code review

---

## 1. Executive Summary

The Praxis LS AI layer is a **well-architected, deeply considered system** built around a "reads free, writes confirmed" autonomy model. The codebase demonstrates exceptional documentation discipline — nearly every non-obvious decision carries an inline rationale — and several critical security vulnerabilities were identified and remediated _within_ the audit trail of the code itself (SEC H1: missing RBAC on AI actions; SEC H3: unvalidated confirm payloads). The architecture is sound, the governance model is layered, and the testing surface covers the key trust boundaries.

**That said, the audit identified findings across all severity levels.** The most significant are a residual input-validation gap in the confirm path, a tool-scoping heuristic that can silently exclude relevant actions, the absence of rate-limiting on the ask endpoint, and a PII redaction layer that is acknowledged-coarse but still insufficient for the OHADA financial context.

### Scorecard

| Area                         | Rating                        |
| ---------------------------- | ----------------------------- |
| Architecture & Design        | ★★★★★ Excellent               |
| Security & Authorization     | ★★★★☆ Good (post-remediation) |
| Governance & Spend Control   | ★★★★★ Excellent               |
| Reliability & Error Handling | ★★★★☆ Good                    |
| Performance & Cost           | ★★★★☆ Good                    |
| Testing & Verification       | ★★★★☆ Good                    |
| PII Redaction                | ★★★☆☆ Needs Improvement       |
| Observability                | ★★★★☆ Good                    |

---

## 2. Architecture Overview

The AI system follows the decision record in `doc/AI_ARCHITECTURE.md`:

```
User → Composer (client) → POST /ai/ask
  → ai-gate middleware (EMV feature flag)
  → orchestrator.ask()
    → governance.canUseFeature() (feature + grant + budget)
    → retrieval.retrieve() (pgvector, tenant ∪ global corpus)
    → loadTools() → selectTools() (relevance-scoped catalogue)
    → llm.chat() (DeepSeek → Gemini fallback)
    → Read tools: execute inline, RBAC-gated, narrate back
    → Write tools: propose as action cards (AWAITING_CONFIRM)
  → User confirms → confirmAction()
    → Re-check governance + RBAC
    → Execute via registry → immutable_ledger
```

**Key architectural decisions (all sound):**

- Action manifests (`*.ai.js`) auto-derive the tool catalogue — zero drift between modules and AI capability.
- Per-tenant encryption-isolated corpus with pgvector; global corpus in platform DB.
- AES-256-GCM for vendor API keys at rest.
- Conversation memory with bounded replay window (20 turns) + rolling summary (batched every 10 turns).
- Provider fallback chain: DeepSeek → Gemini for chat; Gemini for vision; Groq for voice.

---

## 3. Findings

### 3.1 HIGH — Residual Confirm Payload Validation Gap

**File:** `src/services/ai/orchestrator.service.js`, `confirmAction()`
**Severity:** High

When a user edits a proposed action's payload through the interactive form, the orchestrator re-validates against the catalogue schema:

```js
if (edited && typeof edited === "object") {
  const { rows: cat } = await client.query(
    "SELECT payload_schema FROM ai_action_catalogue WHERE action_key=$1",
    [run.action_key],
  );
  const errs = validatePayload(cat[0] && cat[0].payload_schema, edited);
  ...
}
```

**Issue 1:** If `cat[0]` is undefined (action_key deleted from catalogue between propose and confirm), `cat[0] && cat[0].payload_schema` is `undefined`, and `validatePayload(undefined, edited)` returns `[]` (no errors) because `(schema && schema.required) || []` short-circuits. The edited payload executes with zero validation.

**Issue 2:** `validatePayload` is a minimal JSON-schema gate — it checks required fields and unknown keys but performs **no type checking**. A string where a number is expected, or a negative where only positive makes sense, passes through.

**Recommendation:** Fail closed when the catalogue row is missing. Add type validation against the schema's `properties[k].type`. The Zod schemas on the module validators already encode these constraints — the `zodToJsonSchema` conversion should preserve enough to check types.

---

### 3.2 HIGH — No Rate Limiting on `/ai/ask`

**File:** `src/modules/ai/assistant/assistant.routes.js`
**Severity:** High

The ask endpoint has auth + governance gate but **no rate limiting**. A legitimate user (or compromised session) can fire requests in a tight loop. Each call invokes:

1. Vector embedding (embeddings vendor API call)
2. LLM chat (DeepSeek/Gemini API call)
3. Optionally, read tool executions + a follow-up LLM call
4. Optionally, an anti-stall nudge (another LLM call)

A single user can burn through a tenant's budget cap in seconds, and the soft-cap WARN state does not block — only the hard cap does. The `shared/http/rate-limit.js` utility exists in the codebase and is used on other routes; it should be applied here.

**Recommendation:** Apply per-user rate limiting (e.g., 10 req/min) on `/ai/ask`. Consider a token-bucket approach tied to the budget period.

---

### 3.3 MEDIUM — Tool Scoping Heuristic Can Silently Exclude Relevant Actions

**File:** `src/services/ai/orchestrator.service.js`, `selectTools()`
**Severity:** Medium

When the catalogue exceeds 64 tools, `selectTools` scores and ranks them by simple token overlap with the user message + history. The scoring is:

```js
const tokenize = (s) => (s || "").toLowerCase().match(/[a-z]{3,}/g) || [];
```

This tokenizer:

- Drops all tokens shorter than 3 characters (excluding abbreviations like "PO", "GRN", "BL", "VAT")
- Uses no stemming or synonym handling
- Scores a CORE tool at +100, which guarantees its inclusion but may crowd out a relevant non-CORE tool

A user asking "create a PO for supplier X" would tokenize to `["create", "supplier"]` — the word "purchase" never appears, so `draft_purchase_order` relies on the `CORE_TOOLS` set (which doesn't include it) or on "order" matching. In practice, the `description` field often catches it, but there are edge cases.

**Recommendation:** Add domain-specific synonyms to the scoring (e.g., PO → purchase_order, GRN → goods_received). Consider expanding `CORE_TOOLS` dynamically based on the user's permitted modules. Alternatively, use the embedding vector for tool selection rather than bag-of-words.

---

### 3.4 MEDIUM — Anti-Stall Nudge Doubles Cost Without Usage Visibility

**File:** `src/services/ai/orchestrator.service.js`, anti-stall block
**Severity:** Medium

When the model announces intent without acting (`STALL_RE` matches), a nudge message is sent — an additional LLM call. The usage is recorded (`recordUsage` is called), and `nudged` is tracked in the trace. However:

1. The nudge effectively doubles the cost of affected turns.
2. `STALL_RE` matches phrases like "I'll" and "let me" — common in conversational responses. A model that says "I'll look into that" (without intending a tool call) triggers the nudge unnecessarily.
3. The nudge adds latency the user perceives as the system being slow.

**Recommendation:** Tighten `STALL_RE` to require a tool-related verb (e.g., "I'll create", "let me check", "let me fetch"). Consider a prompt-engineering approach instead — the current system prompt already includes anti-stall instructions. Monitor nudge frequency via the trace data to decide if the heuristic is net-positive.

---

### 3.5 MEDIUM — PII Redaction Is Insufficient for Financial Context

**File:** `src/services/ai/redact.js`
**Severity:** Medium

The redaction layer handles three patterns:

```js
.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, "[IBAN]")   // IBANs
.replace(/\b\d{9,}\b/g, "[NUM]")                           // Long digit runs
.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]")            // Emails
```

**Missed patterns for an OHADA logistics ERP:**

- **Phone numbers** in various formats (+237 6XX XXX XXX, 2XX XXX XXX)
- **Credit card numbers** (16 digits with spaces/dashes — not caught by `\d{9,}` if formatted)
- **Bank account numbers** (RIB in the OHADA zone: 5+5+12+2 format with separators)
- **Tax identification numbers** (NIU: format varies, often shorter than 9 digits)
- **Employee social security numbers**
- **Names** — no attempt at NER-based name redaction, though this is acknowledged as a known limitation in the codebase

The code is labeled "coarse but safe" and acknowledges this. For a system handling OHADA financial data, this needs to be more comprehensive.

**Recommendation:** Add patterns for phone numbers, formatted card/bank numbers, and NIU formats. Consider a library like `presidio` for NER-based PII detection. At minimum, add `\+?\d[\d\s-]{8,}\d` for phone numbers.

---

### 3.6 MEDIUM — Vendor Fallback Swallows All Errors Silently

**File:** `src/services/ai/llm.service.js`, `chat()`
**Severity:** Medium

```js
for (const name of [vendorName, FALLBACK]) {
  const vendor = await resolveVendor(client, name);
  if (!vendor) continue;
  try {
    return await callVendor(vendor, { messages, tools, temperature });
  } catch (err) {
    logger.warn({ err, vendor: name }, "LLM vendor failed");
  }
}
return STUB;
```

Every error — network timeout, 401 (bad key), 429 (rate limit), 500, malformed response — triggers a silent fallback. A misconfigured primary key would never be visible to the operator: every call silently uses the fallback, and the cost structure differs between vendors. The `was_successful` column in `ai_usage_ledger` always records `true` because `recordUsage` is only called on success.

**Recommendation:** Distinguish between transient errors (timeout, 5xx → retry/fallback) and configuration errors (401, 403 → alert, don't silently fallback). Add a metric for fallback activations. Record failed attempts in the usage ledger with `was_successful = false`.

---

### 3.7 LOW — `ask` Validation Does Not Bound Message Length

**File:** `src/modules/ai/assistant/assistant.validator.js`
**Severity:** Low

```js
ask: z.object({
  message: z.string().min(1),
  conversation_id: z.string().uuid().optional(),
}),
```

No maximum length on `message`. A very long message inflates the embedding cost, the system prompt, and every replayed turn. The retrieval layer caps its results and the tool messages are capped at 6000 chars, but the user's own input is unbounded.

**Recommendation:** Add `.max(10000)` or similar to the message field.

---

### 3.8 LOW — Post-Action Narration Is an Extra LLM Call on Every Confirm

**File:** `src/services/ai/orchestrator.service.js`, `confirmAction()` narration block
**Severity:** Low

After every confirmed action, a separate LLM call generates a step-by-step recap. This is good UX but:

1. It adds ~1 second latency and one more API cost to every confirm.
2. It uses `HISTORY_TURNS` (20) messages of context — the same bounded window — but the narration doesn't need that much history.
3. There's no way to disable it for cost-sensitive tenants.

**Recommendation:** Make narration configurable per tenant (via `ai_feature_flag`). Use a smaller history window (5 turns) for narration.

---

### 3.9 LOW — Entity Card Builders Are Limited to 3 Entity Types

**File:** `src/services/ai/knowledge/entity-cards.js`
**Severity:** Low

The tenant corpus is built from only 3 entity types: `dossier`, `client_master`, and `dictionary_item`. The system has 50+ modules with `.ai.js` manifests, but entity cards for most of them (vehicles, employees, invoices, purchase orders, etc.) are not built. This means retrieval grounding is thin — the vector search covers docs and schema but very few actual business records.

**Recommendation:** Expand `BUILDERS` to cover high-value entities: `final_invoice`, `quotation`, `purchase_order`, `supplier_invoice`, `employee`, `vehicle`. The pattern is straightforward and each addition improves grounding quality.

---

### 3.10 LOW — `upsertVendor` in Governance Repo Has SQL Injection Surface

**File:** `src/modules/ai/governance/governance.repo.js`, `upsertVendor()`
**Severity:** Low

```js
const cols = Object.keys(fields);
const insertCols = ["vendor", ...cols].join(", ");
...
const updateSet = cols.map((k) => k + " = EXCLUDED." + k).join(", ");
```

Column names are interpolated into SQL without validation. The `fields` object is built in `governance.service.setVendor()` from an allowlist:

```js
for (const k of ["display_name", "endpoint_url", ...]) if (patch[k] !== undefined) fields[k] = patch[k];
```

So this is **currently safe** because the service constrains what keys reach the repo. However, the repo function itself is not defensively coded — a future caller passing unchecked keys would introduce SQL injection. The same pattern in `setFlag` was already fixed (PERF S19/S20 comment) to use `query-helpers.updateOne`.

**Recommendation:** Refactor `upsertVendor` to use the same `query-helpers` pattern, or add an explicit column allowlist in the repo function.

---

### 3.11 INFORMATIONAL — Conversation Summary Has Acknowledged Gap

**File:** `src/services/ai/orchestrator.service.js`, `history_.condense()`
**Severity:** Informational

The batched summarization (every 10 turns) creates a gap where up to `SUMMARY_BATCH - 1` messages are neither in the replay window nor in the summary. This is documented in the code with a clear rationale ("bounded, self-correcting, and much cheaper than the alternative"). The trade-off is sound and the gap self-corrects on the next batch.

No action needed — this is a well-documented, intentional trade-off.

---

### 3.12 INFORMATIONAL — DeepSeek Inline Tool-Call Recovery

**File:** `src/services/ai/llm.service.js`, `extractInlineToolCalls()`
**Severity:** Informational

The LLM service handles DeepSeek's known issue of emitting tool-call markup in `content` instead of `tool_calls`. The regex-based recovery is well-anchored (requires actual markup characters) and strips the visible text. This is a robust workaround for a known vendor limitation.

No action needed.

---

## 4. Security Assessment

### 4.1 Authorization Model (Post-Remediation)

The **SEC H1** vulnerability — AI actions bypassing module RBAC — has been thoroughly remediated:

- ✅ `actionAuthz.assertAllowed()` checks permissions on both reads AND writes
- ✅ Permissions are re-checked at confirm time (grants may be revoked between propose and confirm)
- ✅ CEO bypass matches the RBAC module's own bypass
- ✅ `filterAllowed()` pre-filters the tool offer so the model never proposes unauthorized actions
- ✅ Fail-closed: a missing `required_permission` denies rather than allows

The `action-authz.js` module is one of the best-documented security fixes in the codebase, with a complete narrative of what was wrong, why it was wrong, and how the fix works.

### 4.2 Data Isolation

- ✅ Tenant corpus lives in the tenant DB (pgvector), never crosses tenants
- ✅ Global corpus (code/docs/schema) in the platform DB, always visible
- ✅ Confidentiality tags on tenant documents filter retrieval by the caller's grants
- ✅ Conversation history is user-scoped; `conversationBelongsToUser()` gates cross-user reads

### 4.3 Key Management

- ✅ AES-256-GCM encryption for vendor API keys at rest
- ✅ IV and auth tag prepended to ciphertext (standard practice)
- ✅ Read APIs never return `api_key_enc`
- ✅ Platform-first key resolution (one shared deploy-wide set)
- ⚠️ The `ENCRYPTION_KEY` is sourced from environment — no key rotation mechanism is documented

### 4.4 Input Validation

- ✅ Zod schemas on ask, confirm, and export endpoints
- ✅ Confirm payload bounded (record keys ≤64 chars)
- ⚠️ Message length unbounded (Finding 3.7)
- ⚠️ Confirm payload type validation incomplete (Finding 3.1)

---

## 5. Governance & Spend Control

The governance layer is **excellent**:

- **Two-level feature gating:** Platform console ceiling + tenant preference. Console OFF = hard off; tenant can't self-enable.
- **Per-user access grants:** Opt-out model (missing grant = allowed for entitled tenants). Revoked grants block.
- **Budget periods:** Soft cap (warn) + hard cap (block). Cost estimation from vendor per-token rates in XAF.
- **Usage ledger:** Append-only, immutable trigger, every call logged with token counts and estimated cost.
- **Vendor management:** Live key testing, rotation tracking, per-vendor monthly caps.

The `canUseFeature` function is called at both ask time AND confirm time, closing the window where a feature could be disabled between the two.

---

## 6. Testing Assessment

**923 lines across 11 test files** covering:

| Test File                         | Lines | Coverage                   |
| --------------------------------- | ----- | -------------------------- |
| `ai-answer-sources.test.js`       | 190   | Citation/source generation |
| `ai-export.test.js`               | 125   | Excel export               |
| `ai-ask-grounding.test.js`        | 124   | Retrieval grounding        |
| `ai-readiness.test.js`            | 118   | Module manifest discovery  |
| `ai-conversation-summary.test.js` | 101   | Rolling summary            |
| `ai-writes.test.js`               | 69    | Write action proposal      |
| `ai-batch.test.js`                | 59    | Batch confirmation         |
| `ai-gate.test.js`                 | 50    | Governance gate            |
| `ai-toggle.test.js`               | 31    | Feature toggle             |
| `ai-workers.test.js`              | 29    | Voice/vision workers       |
| `ai-governance.test.js`           | 27    | Pure governance rules      |

### Testing Gaps

1. **No integration test for the full ask→read→propose→confirm→execute flow.** Each stage is tested in isolation, but the chain is not.
2. **No test for `selectTools()` heuristic** — the tool-scoring logic that can exclude relevant actions is untested.
3. **No test for `extractInlineToolCalls()`** — the DeepSeek markup recovery is untested.
4. **No test for `redact()`** beyond what exists — the PII redaction has no test cases for edge patterns.
5. **No load/stress tests** for the ask endpoint.

---

## 7. Client-Side Assessment

The client AI components (`client/src/components/ai/`, `client/src/lib/ai-api.ts`) are well-built:

- ✅ TypeScript types mirror the server contract
- ✅ Interactive action forms with schema-driven widgets (select, number, text, boolean, array)
- ✅ Reference field dropdowns populated from AI-enabled list-reads (RBAC-scoped)
- ✅ Source chips derived from both server-supplied and client-extracted citations
- ✅ Markdown table extraction for the right-pane data view
- ✅ Long-form document detection and canvas lifting
- ✅ Browser-native dictation (no vendor dependency for voice input)
- ✅ Scope and mode are permission-aware (`useAiScopes` reads the user's ribbon)

**No client-side findings of significance.**

---

## 8. Recommendations Summary

| #    | Severity | Finding                              | Action                                                  |
| ---- | -------- | ------------------------------------ | ------------------------------------------------------- |
| 3.1  | **High** | Confirm payload validation gap       | Fail closed on missing catalogue row; add type checks   |
| 3.2  | **High** | No rate limiting on `/ai/ask`        | Apply per-user rate limiter                             |
| 3.3  | Medium   | Tool scoping heuristic               | Add domain synonyms; consider embedding-based selection |
| 3.4  | Medium   | Anti-stall nudge cost                | Tighten regex; monitor frequency                        |
| 3.5  | Medium   | PII redaction gaps                   | Add phone, card, RIB, NIU patterns                      |
| 3.6  | Medium   | Silent vendor fallback               | Distinguish transient vs config errors; record failures |
| 3.7  | Low      | Unbounded message length             | Add `.max(10000)` to ask schema                         |
| 3.8  | Low      | Narration cost                       | Make configurable; reduce history window                |
| 3.9  | Low      | Limited entity card builders         | Expand to more entity types                             |
| 3.10 | Low      | `upsertVendor` SQL injection surface | Use allowlist or query-helpers                          |

---

## 9. Conclusion

The Praxis LS AI implementation is **production-grade and security-conscious**, with a governance model that exceeds the norm for ERP AI features. The architecture's core principle — "the app is the AI's toolbox" — is well-realized through the manifest-driven action catalogue, and the propose→confirm pipeline correctly keeps the human in the loop for all write operations.

The two **high-severity findings** (confirm validation gap and missing rate limiting) should be addressed before any significant traffic increase. The medium-severity findings are quality and cost improvements that will become more important as usage scales.

The codebase's inline documentation is a standout feature. Every non-obvious decision — from why the summarization gap exists to why citations come from read results rather than prose — is explained at the point of implementation. This makes the system maintainable by engineers who did not write it, which is the strongest predictor of long-term code health.
