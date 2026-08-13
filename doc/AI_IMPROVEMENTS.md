# AI Improvements — Implementation Summary

**Date:** 2026-08-08
**Branch:** `arena/019fe0c1-praxis-ls`

---

## Problems Addressed

| #   | User Report                                                                     | Root Cause                                                                                                | Fix                                                                            |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | "It snooze a lot — proposes an action and doesn't execute until another prompt" | System prompt said "wait for go-ahead before proposing next" + confirm narration asked "shall I proceed?" | Removed wait-for-go-ahead; auto-propose next step after confirm                |
| 2   | "Confuses itself when details are provided — keeps saying missing fields"       | `validatePayload` rejected unknown keys (e.g. `client_name` vs `client_id`)                               | Lenient validation: only required fields enforced, unknown fields pass through |
| 3   | "Drafts well but can't execute what it drafted"                                 | No guidance on draft→execute flow; system stopped after drafting to ask permission                        | System prompt now says "draft AND immediately call the write function"         |
| 4   | "Should cover actions from anywhere in the system"                              | Only 3 entity card builders; tool scoping dropped domain abbreviations                                    | Expanded to 12 entity types; added domain synonym dictionary                   |
| 5   | "Must not speak raw/database language"                                          | Prompt rule was present but not strong enough                                                             | Strengthened with absolute language rules + self-correction guidance           |
| 6   | "Should self-learn from patterns"                                               | No execution history feedback to the model                                                                | Recent successful action patterns injected into system prompt                  |
| 7   | "Render response word-by-word while generating"                                 | Full completion awaited before rendering                                                                  | SSE streaming endpoint + client-side incremental rendering                     |

---

## Files Changed

### Server (Node.js)

| File                                               | Change                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/ai/llm.service.js`                   | Added `chatStream()` and `callVendorStream()` for SSE-based token streaming from DeepSeek/Gemini. Falls back to non-streaming `callVendor` when streaming fails.                                                                                                                                                                                                                                                                          |
| `src/services/ai/orchestrator.service.js`          | **7 fixes in one file:** (1) `askStream()` generator yielding SSE events; (2) system prompt: auto-continue after confirm; (3) system prompt: draft→execute in one flow; (4) lenient `validatePayload` (required-only); (5) domain synonym dictionary for tool scoping; (6) `recentPatterns()` for self-learning; (7) strengthened language rules. Also: `confirmAction` narration now auto-proposes next step via follow-up `ask()` call. |
| `src/modules/ai/assistant/assistant.service.js`    | Added `askStream` export wrapping `orchestrator.askStream`.                                                                                                                                                                                                                                                                                                                                                                               |
| `src/modules/ai/assistant/assistant.controller.js` | Added `askStream` SSE controller: sets `text/event-stream` headers, 15s heartbeat, client disconnect detection, pipes generator events as `data: {json}\n\n`.                                                                                                                                                                                                                                                                             |
| `src/modules/ai/assistant/assistant.routes.js`     | Mounted `POST /ai/ask/stream` route.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/services/ai/knowledge/entity-cards.js`        | Expanded from 3 to 12 entity card builders: added `final_invoice`, `quotation`, `supplier_master`, `purchase_order`, `employee`, `vehicle`, `proforma`, `supplier_invoice`, `lead`, `opportunity`.                                                                                                                                                                                                                                        |

### Client (TypeScript/React)

| File                                   | Change                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/lib/ai-api.ts`             | Added `AiStreamEvent` type union, `askPraxisStream()` async generator consuming SSE via fetch ReadableStream. Auto-fallback to non-streaming `askPraxis` on 404/network error. Updated `confirmAiAction` return type to include `next_actions`.                                                         |
| `client/src/components/ai/thread.ts`   | Rewrote `send()` to consume `askPraxisStream`: creates assistant turn immediately with empty text, updates in place as deltas arrive. Added `streamAbort` ref for cancellation. Updated `confirmAction` to render `next_actions` from confirm response. Updated `newThread` to abort in-flight streams. |
| `client/src/features/ai/workspace.tsx` | Thinking indicator hides once streaming text starts arriving (the growing answer IS the thinking).                                                                                                                                                                                                      |

### Tests

| File                              | Purpose                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `tests/unit/ai-streaming.test.js` | Tests for lenient validation, SSE event parsing, and pattern block generation. |

---

## Architecture: Streaming Flow

```
Client                          Server
  │                               │
  │  POST /ai/ask/stream          │
  │  { message, conversation_id } │
  │──────────────────────────────►│
  │                               │  governance gate
  │                               │  retrieval + tool loading + patterns
  │                               │  build system prompt
  │                               │
  │  Content-Type: text/event-    │
  │  stream                       │
  │◄──────────────────────────────│  SSE headers
  │                               │
  │  data: {"type":"delta",       │
  │    "text":"The total "}       │
  │◄──────────────────────────────│  llm.chatStream() yields tokens
  │                               │
  │  data: {"type":"delta",       │
  │    "text":"is 50,000 XAF."}   │
  │◄──────────────────────────────│
  │                               │  read tools execute (non-streaming)
  │  data: {"type":"delta",       │
  │    "text":"\n\nBased on…"}    │
  │◄──────────────────────────────│  narration streamed
  │                               │
  │  data: {"type":"answer",      │
  │    "text":"The total is…"}    │
  │◄──────────────────────────────│  final answer
  │                               │
  │  data: {"type":"actions",     │
  │    "actions":[…]}             │
  │◄──────────────────────────────│  proposed writes
  │                               │
  │  data: {"type":"sources",     │
  │    "sources":[…]}             │
  │◄──────────────────────────────│  grounding citations
  │                               │
  │  data: {"type":"trace",       │
  │    "trace":[…]}               │
  │◄──────────────────────────────│  reasoning steps
  │                               │
  │  data: {"type":"done",        │
  │    "conversation_id":"…"}     │
  │◄──────────────────────────────│  stream complete
  │                               │
```

---

## Architecture: Auto-Continue After Confirm

```
Before (snooze loop):
  User: "Create a dossier for SODECOTON"
  AI: [proposes open_dossier action card]
  User: [clicks Confirm]
  AI: "✓ Created dossier SBX-2026-0042. Shall I create a costing for it?"
  User: "Yes"                          ← wasted turn
  AI: [proposes create_costing]
  User: [clicks Confirm]
  AI: "✓ Created costing. Shall I…?"
  User: "Yes"                          ← wasted turn
  …

After (auto-continue):
  User: "Create a dossier for SODECOTON"
  AI: [proposes open_dossier action card]
  User: [clicks Confirm]
  AI: "✓ Created dossier SBX-2026-0042.
       [proposes create_costing action card]"    ← auto-proposed
  User: [clicks Confirm]
  AI: "✓ Created costing CST-2026-0018.
       [proposes draft_quotation action card]"   ← auto-proposed
  …
```

---

## Key Design Decisions

### Why SSE and not WebSockets?

The existing realtime layer uses Socket.IO for push notifications, but streaming an answer is request-response. SSE is simpler (no upgrade, no bidirectional), works over HTTP/2, auto-reconnects in browsers, and doesn't couple chat to the notification socket.

### Why `fetch` and not `EventSource`?

`EventSource` is GET-only and cannot carry the POST body or auth headers. `fetch` with `ReadableStream` gives us POST + headers + abort control.

### Why non-streaming for read-tool narration?

Read tools execute database queries and the narration LLM call needs the full tool output before generating text. Streaming would add latency without visible benefit — the user sees nothing until the narration is complete anyway. Only the INITIAL model call streams, because that's the one the user stares at while waiting.

### Why lenient validation instead of field mapping?

Field mapping (e.g. `client_name` → look up → `client_id`) was considered but rejected because: (1) the interactive form already handles this via `field_meta` dropdowns; (2) the model's pre-filled values are a starting point the user can edit; (3) strict validation caused the "confuses itself" problem. Lenient validation lets the proposed action reach the form, where the user can correct anything before confirming.

### Why auto-propose from `confirmAction` and not from the client?

The server has the full conversation context and the executor registry. A client-side auto-ask would need to synthesize a message and re-enter the `send()` flow, duplicating logic. The server's `confirmAction` already has everything it needs to propose the next step in one round-trip.
