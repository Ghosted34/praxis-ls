/**
 * Praxis assistant API — the in-screen AI (draft / suggest / carry out this
 * screen's actions). `askPraxis` returns an answer plus proposed action runs;
 * write actions come back AWAITING_CONFIRM and are executed (permission-
 * inheriting) via confirm. This is the per-screen surface, not a general chat.
 */
import { tenant } from "./api-client";

export type AiActionRun = {
  action_run_id: string;
  action_key: string;
  payload?: Record<string, unknown>;
  requires_confirmation?: boolean;
  validation_errors?: string[];
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

export const fetchAiHistory = () => tenant<AiHistory>("/ai/history");

/** Start a fresh thread. The old one is retained, just no longer current. */
export const clearAiHistory = () => tenant<AiHistory>("/ai/history/clear", { method: "POST" });

export const askPraxis = (message: string, conversationId?: string) =>
  tenant<AskResult>("/ai/ask", { method: "POST", body: { message, conversation_id: conversationId } });

export const confirmAiAction = (actionRunId: string) =>
  tenant<{ ok: boolean; result?: unknown }>(`/ai/actions/${actionRunId}/confirm`, { method: "POST" });

export const confirmAiBatch = (batchId: string) =>
  tenant<{ batch_id: string; halted: boolean; executed: number; results: unknown[] }>(
    `/ai/batches/${batchId}/confirm`,
    { method: "POST" },
  );
