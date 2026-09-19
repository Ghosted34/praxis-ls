/**
 * Praxis assistant API — the in-screen AI (draft / suggest / carry out this
 * screen's actions). `askPraxis` returns an answer plus proposed action runs;
 * write actions come back AWAITING_CONFIRM and are executed (permission-
 * inheriting) via confirm. This is the per-screen surface, not a general chat.
 */
import { tenant, downloadPost } from "./api-client";

/** One selectable option for a reference dropdown, sourced from a list-read. */
export type AiOption = { value: unknown; label: string };

/**
 * Per-field UI hint for the interactive action form. `select` fields either
 * carry inline `options` (enums) or a `ref` list-read the form fetches options
 * from; `number`/`text` are plain inputs.
 */
export type AiFieldMeta = {
  label: string;
  required?: boolean;
  widget: "select" | "number" | "text" | "boolean" | "array";
  ref?: string;
  options?: AiOption[];
  /** For `array` widgets: the fields of each repeatable row. */
  item_fields?: Record<string, AiFieldMeta>;
};

export type AiActionRun = {
  action_run_id: string;
  action_key: string;
  payload?: Record<string, unknown>;
  requires_confirmation?: boolean;
  validation_errors?: string[];
  /** JSON-schema of the payload (types + required), for the interactive form. */
  schema?: { properties?: Record<string, unknown>; required?: string[] };
  /** Per-field render hints (dropdowns, refs, labels). */
  field_meta?: Record<string, AiFieldMeta>;
};

/**
 * One record, document or report an answer was grounded on.
 *
 * `kind` drives how the grounding footer draws the chip; omitted means the UI
 * infers it from the href (an in-app route is a record, an absolute URL is
 * external). See `components/ai/grounding.ts`.
 */
export type AiSourceLike = {
  label: string;
  href: string;
  kind?: "record" | "external" | "report";
};

export type AskResult = {
  answer: string;
  actions: AiActionRun[];
  batch_id?: string | null;
  batch_size?: number;
  blocked?: boolean;
  gate?: { reason?: string };
  /** Thread the turn was recorded against — resolved server-side. */
  conversation_id?: string | null;
  /**
   * Which vendor answered, or NULL when none did.
   *
   * The server has always sent this (`orchestrator.service.js` returns
   * `provider: res.provider`); the type simply did not carry it, so the one
   * signal that separates "the model answered" from "the provider chain was
   * exhausted" was invisible to the client. `classifyAiFailure` reads it — see
   * there for why the answer TEXT is not a reliable substitute.
   */
  provider?: string | null;
  /**
   * OPTIONAL GROUNDING, and optional on purpose.
   *
   * Both are derived server-side from the read actions the orchestrator actually
   * executed (`src/services/ai/answer-sources.js`) — never from the answer text,
   * which would report what the model MENTIONED rather than what it read. They
   * are authoritative for exactly that reason: the read layer knows which action
   * ran and under which permission, and prose cannot say either.
   *
   * OMITTED, not empty, when a turn consulted nothing. Both surfaces render on
   * presence — the sources footer and the `Trace · N steps` disclosure — so an
   * empty array would draw a "Trace · 0 steps" control under small talk.
   * `mergeSources` keeps the link-derived sources as a floor beneath these.
   */
  sources?: AiSourceLike[];
  /** Ordered, human-readable steps taken to reach the answer. */
  trace?: string[];
};

/**
 * Stored conversation. One rolling thread per user: the assistant continues
 * where you left off, across reloads and devices, because the transcript lives
 * in `ai_message` rather than in component state.
 */
export type AiHistoryMessage = {
  ai_message_id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * The grounding the answer was given when it was written (0521).
   *
   * NULL on any message stored before that migration, and on every user turn —
   * a question cites nothing. Both are `null | undefined | []` at the type level
   * for the same reason the UI renders on presence: "we did not record this" and
   * "this consulted nothing" must not become the same thing on screen.
   */
  sources?: AiSourceLike[] | null;
  trace?: string[] | null;
  created_at: string;
};
export type AiHistory = {
  conversation_id: string;
  messages: AiHistoryMessage[];
};

/** One row in the history sidebar. `title` falls back to the first user message. */
export type AiConversationMeta = {
  conversation_id: string;
  title: string | null;
  last_at: string;
  message_count: number;
  /**
   * When the thread was pinned / archived, or null (13930, audit J1-J2).
   *
   * TIMESTAMPS RATHER THAN BOOLEANS, all the way to the client. The rail only
   * needs presence — it renders a pin marker and sorts on it — but "when did
   * this get archived" is a question somebody eventually asks, and a boolean
   * can never answer it. Presence-checking a nullable date costs nothing here
   * and keeps the option open.
   */
  pinned_at?: string | null;
  archived_at?: string | null;
};

/** What `patchAiConversation` may change. Send only what the user altered. */
export type AiConversationPatch = {
  /** Empty string RESTORES the derived title (the first user message). */
  title?: string;
  pinned?: boolean;
  archived?: boolean;
};

/** The current thread, or a specific one by id (the server verifies ownership). */
export const fetchAiHistory = (conversationId?: string) =>
  tenant<AiHistory>(
    `/ai/history${conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ""}`,
  );

/**
 * The caller's past threads for the history sidebar.
 *
 * Pinned first, then most recent — the server settles that order before its
 * LIMIT, so the rail can group on what it is given (`groupConversations`).
 * Archived threads are excluded unless asked for, because the archived section
 * is opened rarely and paying for it on every load is the wrong trade.
 */
export const listAiConversations = (opts?: { includeArchived?: boolean }) =>
  tenant<AiConversationMeta[]>(
    `/ai/conversations${opts?.includeArchived ? "?include_archived=true" : ""}`,
  );

/**
 * Pin, rename or archive one thread. Answers with the updated row.
 *
 * ONE CALL FOR THE THREE, and it answers with the row rather than `{ ok }` so
 * the rail can patch what it has instead of refetching the list. That matters
 * for rename in particular: clearing the title hands back the DERIVED one (the
 * first user message), which the client cannot compute for itself.
 */
export const patchAiConversation = (id: string, patch: AiConversationPatch) =>
  tenant<AiConversationMeta>(`/ai/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
  });

/**
 * Remove one thread. `purge` is the irreversible half.
 *
 * Without `purge` the thread is soft-deleted: it leaves every list and stops
 * being loadable by id, and the rows are still there. With it, the transcript
 * is destroyed and the action runs that never executed go with it — the ones
 * that DID execute are detached and kept, because they are the only record of a
 * real change to the ERP. The flag rides in the URL rather than a body because
 * a DELETE body is the one thing in HTTP an intermediary may drop, and this is
 * not a field that may be lost silently.
 */
export const deleteAiConversation = (id: string, opts?: { purge?: boolean }) =>
  tenant<{ conversation_id: string; purged: boolean }>(
    `/ai/conversations/${encodeURIComponent(id)}${opts?.purge ? "?purge=true" : ""}`,
    { method: "DELETE" },
  );

/** Start a fresh thread. The old one is retained, just no longer current. */
export const clearAiHistory = () =>
  tenant<AiHistory>("/ai/history/clear", { method: "POST" });

/**
 * How the caller has pointed the assistant: which area of the product the
 * question is about, and what SHAPE of answer is wanted.
 *
 * BE HANDOFF. `POST /ai/ask` accepts these today and drops them — its zod schema
 * (`assistant.validator.js`) is non-strict, so unknown keys are stripped rather
 * than rejected, and nothing breaks. They are sent anyway because the UI is the
 * thing that knows them and the wire is where the contract belongs: adding
 * `scope` and `mode` to that schema is all that is needed to start honouring
 * them. `scope` is an area key from `AREAS` (`app/layout/areas.ts`), or `all`.
 */
export type AskOptions = { scope?: string; mode?: string };

/**
 * How long a NON-STREAMING ask may take before the client gives up (audit G2).
 *
 * `tenant()` sets no timeout at all, which is right for an ordinary list — a
 * request that never answers is the browser's problem and its own default is
 * fine. It is wrong here. A single `/ai/ask` turn is several sequential model
 * calls (initial + one per tool round + a final pass), and the server now
 * allows each of them up to `AI_REQUEST_TIMEOUT_MS` (120s, audit E1). So the
 * ceiling on the round trip is minutes, and with no client bound a stalled turn
 * renders as a spinner that never resolves — indistinguishable from a frozen
 * screen, which is how people end up asking the same thing three times.
 *
 * 180s is deliberately GENEROUS and deliberately finite: longer than the
 * server's own per-call cap so a legitimately slow multi-hop answer is never cut
 * off by us, short enough that a request which is never coming back says so.
 * The streaming path does not need this — its heartbeat is the liveness signal —
 * which is the other half of why streaming is the path to prefer.
 */
export const AI_ASK_TIMEOUT_MS = 180_000;

/**
 * A signal that aborts on the caller's request OR after `ms`, whichever first.
 *
 * Hand-rolled rather than `AbortSignal.any([...])`: that composes exactly this
 * in two lines, and is missing from the jsdom environment the component tests
 * run in, so using it would make every test that exercises an ask throw on a
 * shape that works perfectly in a browser.
 */
function withTimeout(ms: number, signal?: AbortSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new DOMException("The assistant took too long to answer.", "TimeoutError")),
    ms,
  );
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });
  }
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

export const askPraxis = async (
  message: string,
  conversationId?: string,
  opts?: AskOptions,
  signal?: AbortSignal,
) => {
  const bounded = withTimeout(AI_ASK_TIMEOUT_MS, signal);
  try {
    return await tenant<AskResult>("/ai/ask", {
      method: "POST",
      signal: bounded.signal,
      body: {
        message,
        conversation_id: conversationId,
        scope: opts?.scope,
        mode: opts?.mode,
      },
    });
  } finally {
    bounded.done();
  }
};

/**
 * What kind of failure this was, and therefore what the person should be told.
 *
 * TWO KINDS, and they want different words (audit G4). A TRANSIENT failure — a
 * dropped connection, a 5xx, a turn that timed out — is worth trying again, and
 * that is the whole advice. A PROVIDER failure is not: the vendor chain is
 * misconfigured (audit B2 — a primary whose credential is wrong and a fallback
 * that cannot answer), and no amount of retrying by this person fixes a
 * credential. They still get the retry button, because a credential lookup can
 * itself hiccup and because taking the only control away from somebody staring
 * at a broken feature is its own insult — but the message names where the fix
 * lives so they can ask the right person instead of trying six more times.
 *
 * READ FROM `provider`, NOT FROM THE ANSWER TEXT. When the chain is exhausted
 * the server returns a normal, successful turn whose text explains the problem
 * in prose — so the failure arrives looking exactly like a good answer, and the
 * only machine-readable trace of it is that no vendor is named. Matching the
 * prose instead would break the first time somebody improved the wording, and
 * would mistake an ANSWER about configuration for a configuration failure.
 *
 * Returns null when nothing went wrong.
 */
export type AiFailure = { kind: "provider" | "transient"; message: string };

const PROVIDER_ADVICE =
  "The AI has no working chat provider right now — an administrator can check the credentials under AI Control → Vendors.";

export function classifyAiFailure(input: {
  /** The vendor that answered, from the `done` event or `AskResult`. */
  provider?: string | null;
  /** True when governance refused the turn — already explained in the answer. */
  blocked?: boolean;
  /** An error thrown or an `error` event, when the turn did not complete. */
  error?: unknown;
  /** True once the turn completed, so a null provider is meaningful. */
  completed?: boolean;
}): AiFailure | null {
  if (input.error !== undefined && input.error !== null) {
    const message =
      input.error instanceof DOMException && input.error.name === "TimeoutError"
        ? "The assistant took too long to answer."
        : input.error instanceof Error
          ? input.error.message
          : String(input.error);
    return { kind: "transient", message };
  }
  // A governance refusal is a decision, not a fault: the answer already says so.
  if (input.blocked) return null;
  if (input.completed && !input.provider) {
    return { kind: "provider", message: PROVIDER_ADVICE };
  }
  return null;
}

/**
 * One event in the SSE stream from `/ai/ask/stream`.
 *
 * `delta` carries an incremental token OF THE REPLY (rendered immediately so the
 * answer types out word by word). `answer`, `actions`, `sources`, `trace` arrive
 * once at the end of the turn as the finalised, authoritative values. `done`
 * signals the stream is complete. `error` is a recoverable failure.
 *
 * `status` and `reset` are the assistant's working-out, and exist because the
 * two were once the same channel. Every round of "Let me pull the dossier 360°"
 * went out as `delta`, so the model's thinking was rendered as its answer — a
 * pricing question came back as fifteen repetitions of a lookup it was in the
 * middle of. `status` is a single ephemeral line, REPLACED each time and never
 * persisted; `reset` says "what I have sent you so far was narration, drop it",
 * which the server sends when a reply it began optimistically turns out to have
 * been a preamble to a tool call.
 */
export type AiStreamEvent =
  | { type: "delta"; text: string }
  | { type: "status"; text: string }
  | { type: "reset" }
  | { type: "answer"; text: string }
  | { type: "actions"; actions: AiActionRun[]; batch_id?: string | null }
  | { type: "sources"; sources: AiSourceLike[] }
  | { type: "trace"; trace: string[] }
  | { type: "done"; conversation_id?: string | null; provider?: string | null }
  | { type: "error"; message: string };

/**
 * Streaming ask — yields SSE events as they arrive. The caller (useAiThread)
 * updates the turn incrementally: text grows with each `delta`, action cards
 * appear when `actions` arrives, and the turn completes on `done`.
 *
 * FALLBACK. If the streaming endpoint is unreachable (older server, proxy
 * stripping SSE), we fall back to the non-streaming `askPraxis` and yield a
 * single `answer` + `done` event. The client renders identically either way —
 * the non-streaming path just shows the whole answer at once instead of word
 * by word.
 *
 * Uses `fetch` directly rather than `EventSource` because: (1) EventSource is
 * GET-only and we need POST with a body; (2) fetch streams work with the app's
 * auth headers (EventSource cannot set custom headers); (3) fetch gives us
 * abort control for when the user navigates away mid-stream.
 */
export async function* askPraxisStream(
  message: string,
  conversationId?: string,
  opts?: AskOptions,
  signal?: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  // Build the same request the `tenant()` helper would, but with raw fetch so
  // we can consume the response as a stream. tokenStore supplies the auth
  // token and the env header; the URL follows the same `/api/tenant${path}`
  // convention.
  const { tokenStore } = await import("./token-store");
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");
  headers.set("X-Praxis-Env", tokenStore.getEnv());
  const accessToken = tokenStore.getAccess();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  let response: Response;
  try {
    response = await fetch("/api/tenant/ai/ask/stream", {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
        scope: opts?.scope,
        mode: opts?.mode,
      }),
      signal,
    });
  } catch {
    // Network error or abort — fall back to non-streaming.
    if (signal?.aborted) return;
    const result = await askPraxis(message, conversationId, opts, signal);
    yield { type: "answer", text: result.answer };
    if (result.actions?.length)
      yield {
        type: "actions",
        actions: result.actions,
        batch_id: result.batch_id,
      };
    if (result.sources?.length)
      yield { type: "sources", sources: result.sources };
    if (result.trace?.length) yield { type: "trace", trace: result.trace };
    yield {
      type: "done",
      conversation_id: result.conversation_id,
      provider: result.provider ?? null,
    };
    return;
  }

  if (!response.ok || !response.body) {
    // Server returned an error or doesn't support streaming — fall back.
    if (response.status === 404 || response.status === 501) {
      const result = await askPraxis(message, conversationId, opts, signal);
      yield { type: "answer", text: result.answer };
      if (result.actions?.length)
        yield {
          type: "actions",
          actions: result.actions,
          batch_id: result.batch_id,
        };
      if (result.sources?.length)
        yield { type: "sources", sources: result.sources };
      if (result.trace?.length) yield { type: "trace", trace: result.trace };
      yield {
        type: "done",
        conversation_id: result.conversation_id,
        provider: result.provider ?? null,
      };
      return;
    }
    const text = await response.text().catch(() => "Request failed");
    yield { type: "error", message: text || `HTTP ${response.status}` };
    yield { type: "done" };
    return;
  }

  // Parse SSE from the readable stream.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (terminated by \n\n).
      const events = buffer.split("\n\n");
      buffer = events.pop() || ""; // keep the incomplete tail

      for (const raw of events) {
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue; // heartbeat or comment
          if (!trimmed.startsWith("data:")) continue;
          try {
            const event = JSON.parse(trimmed.slice(5).trim()) as AiStreamEvent;
            yield event;
            if (event.type === "done" || event.type === "error") return;
          } catch {
            // Malformed JSON — skip.
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Confirm an action; pass `payload` to execute the form-edited values. `message`
 *  is Praxis's step-by-step recap after a successful run. `next_actions` carries
 *  auto-proposed follow-up actions (the snooze fix: the server proposes the next
 *  step instead of asking "shall I proceed?"). */
export const confirmAiAction = (
  actionRunId: string,
  payload?: Record<string, unknown>,
) =>
  tenant<{
    ok: boolean;
    result?: unknown;
    message?: string | null;
    next_actions?: AiActionRun[];
  }>(`/ai/actions/${actionRunId}/confirm`, {
    method: "POST",
    body: payload ? { payload } : {},
  });

/** Options for a reference dropdown, from an ai_enabled list-read (RBAC-scoped). */
export const fetchActionOptions = (ref: string, q?: string) =>
  tenant<AiOption[]>(
    `/ai/options?ref=${encodeURIComponent(ref)}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  );

export const confirmAiBatch = (batchId: string) =>
  tenant<{
    batch_id: string;
    halted: boolean;
    executed: number;
    results: unknown[];
  }>(`/ai/batches/${batchId}/confirm`, { method: "POST" });

/**
 * Export an answer's tables as one Excel workbook — one sheet per table.
 *
 * SERVER-SIDE ON PURPOSE. The platform already owns one branded ExcelJS
 * builder (`src/services/spreadsheet`), so a client-built file would be a
 * second, worse-looking implementation of something that exists. The
 * alternative also means shipping a spreadsheet writer to every browser that
 * loads the app — for one button, into a bundle this repo actively polices
 * (`check:bundle`).
 *
 * Rows go up as strings because that is what they are: cells lifted out of a
 * markdown table in an answer. The server coerces the numeric-looking ones so
 * amounts arrive as numbers rather than text, which is the difference between a
 * spreadsheet you can sum and one you have to retype.
 */
export type AiExportTable = {
  title: string;
  header: string[];
  rows: string[][];
};

/**
 * Record feedback on an AI answer (thumbs up/down).
 *
 * This drives the self-improvement loop: bad answers with comments are
 * periodically reviewed to tune the system prompt, and recent down-votes
 * are injected into the prompt as "PATTERNS USERS DISLIKED" so the model
 * actively avoids repeating known mistakes.
 */
export const submitAiFeedback = (feedback: {
  conversation_id?: string;
  message_id?: string;
  question?: string;
  answer?: string;
  vote: "up" | "down";
  comment?: string;
  action_keys?: string[];
}) =>
  tenant<{ ok: boolean }>("/ai/feedback", { method: "POST", body: feedback });

export async function downloadAiTables(
  tables: AiExportTable[],
  filename?: string,
): Promise<void> {
  await downloadPost(
    "/tenant/ai/export/tables",
    { tables },
    filename || `praxis-ai-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}
