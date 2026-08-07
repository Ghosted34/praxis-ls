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
export type AiSourceLike = { label: string; href: string; kind?: "record" | "external" | "report" };

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

export const askPraxis = (message: string, conversationId?: string, opts?: AskOptions) =>
  tenant<AskResult>("/ai/ask", {
    method: "POST",
    body: { message, conversation_id: conversationId, scope: opts?.scope, mode: opts?.mode },
  });

/** Confirm an action; pass `payload` to execute the form-edited values. `message`
 *  is Praxis's step-by-step recap + next-step question after a successful run. */
export const confirmAiAction = (actionRunId: string, payload?: Record<string, unknown>) =>
  tenant<{ ok: boolean; result?: unknown; message?: string | null }>(`/ai/actions/${actionRunId}/confirm`, {
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

/**
 * Export an answer's tables as one Excel workbook — one sheet per table.
 *
 * SERVER-SIDE ON PURPOSE. The platform already owns an ExcelJS toolkit
 * (`src/services/excel/workbook.js`) with the house header style, frozen header
 * rows, zebra striping and autofilter, so a client-built file would be a second,
 * worse-looking implementation of something that exists. The alternative also
 * means shipping a spreadsheet writer to every browser that loads the app — for
 * one button, into a bundle this repo actively polices (`check:bundle`).
 *
 * Rows go up as strings because that is what they are: cells lifted out of a
 * markdown table in an answer. The server coerces the numeric-looking ones so
 * amounts arrive as numbers rather than text, which is the difference between a
 * spreadsheet you can sum and one you have to retype.
 */
export type AiExportTable = { title: string; header: string[]; rows: string[][] };

export async function downloadAiTables(tables: AiExportTable[], filename?: string): Promise<void> {
  await downloadPost(
    "/tenant/ai/export/tables",
    { tables },
    filename || `praxis-ai-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}
