/**
 * Praxis assistant API — the in-screen AI (draft / suggest / carry out this
 * screen's actions). `askPraxis` returns an answer plus proposed action runs;
 * write actions come back AWAITING_CONFIRM and are executed (permission-
 * inheriting) via confirm. This is the per-screen surface, not a general chat.
 */
import { tenant } from "./api-client";

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
  widget: "select" | "number" | "text";
  ref?: string;
  options?: AiOption[];
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

export type AskResult = {
  answer: string;
  actions: AiActionRun[];
  batch_id?: string | null;
  batch_size?: number;
  blocked?: boolean;
  gate?: { reason?: string };
  /** Thread the turn was recorded against — resolved server-side. */
  conversation_id?: string | null;
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
  created_at: string;
};
export type AiHistory = { conversation_id: string; messages: AiHistoryMessage[] };

/** One row in the history sidebar. `title` falls back to the first user message. */
export type AiConversationMeta = {
  conversation_id: string;
  title: string | null;
  last_at: string;
  message_count: number;
};

/** The current thread, or a specific one by id (the server verifies ownership). */
export const fetchAiHistory = (conversationId?: string) =>
  tenant<AiHistory>(`/ai/history${conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ""}`);

/** The caller's past threads for the history sidebar (metadata only, newest first). */
export const listAiConversations = () => tenant<AiConversationMeta[]>("/ai/conversations");

/** Start a fresh thread. The old one is retained, just no longer current. */
export const clearAiHistory = () => tenant<AiHistory>("/ai/history/clear", { method: "POST" });

export const askPraxis = (message: string, conversationId?: string) =>
  tenant<AskResult>("/ai/ask", { method: "POST", body: { message, conversation_id: conversationId } });

/** Confirm an action; pass `payload` to execute the form-edited values. */
export const confirmAiAction = (actionRunId: string, payload?: Record<string, unknown>) =>
  tenant<{ ok: boolean; result?: unknown }>(`/ai/actions/${actionRunId}/confirm`, {
    method: "POST",
    body: payload ? { payload } : {},
  });

/** Options for a reference dropdown, from an ai_enabled list-read (RBAC-scoped). */
export const fetchActionOptions = (ref: string, q?: string) =>
  tenant<AiOption[]>(`/ai/options?ref=${encodeURIComponent(ref)}${q ? `&q=${encodeURIComponent(q)}` : ""}`);

export const confirmAiBatch = (batchId: string) =>
  tenant<{ batch_id: string; halted: boolean; executed: number; results: unknown[] }>(
    `/ai/batches/${batchId}/confirm`,
    { method: "POST" },
  );
