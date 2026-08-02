/**
 * The agent loop (PRD §10.2/§10.3): recall → plan with function-calling →
 * Zod-gate proposed actions (≤2 self-correct → manual fallback) → return action
 * cards for human confirm → execute with the user's permissions → log.
 * The AI never exceeds the calling user; sensitive text is redacted before egress.
 */
"use strict";

const crypto = require("crypto");
const llm = require("./llm.service");
const { retrieve, toContextBlock } = require("./retrieval.service");
const { redact } = require("./redact");
const governance = require("../../modules/ai/governance/governance.service");
const convo = require("../../modules/ai/assistant/assistant.repo");
const { logger } = require("../../config/logger");

/**
 * How many past turns are replayed to the model. Stored history is unbounded —
 * this only caps what is re-sent, so cost per call stays flat however long the
 * thread grows. 20 messages ≈ 10 question/answer exchanges.
 */
const HISTORY_TURNS = 20;

/**
 * How many messages must fall out of the replay window before the summary is
 * regenerated (0481).
 *
 * The trade-off this number encodes: regenerating on every turn would mean a
 * second model call per question — roughly doubling the cost of a long thread,
 * against a budget that is hard-capped per tenant. Batching makes it one extra
 * call per ten turns. The price is a **gap**: up to `SUMMARY_BATCH - 1` messages
 * can sit outside both the replay window and the summary, so a detail mentioned
 * exactly there is briefly unavailable until the next batch absorbs it. Bounded,
 * self-correcting, and much cheaper than the alternative — but real, so it is
 * written down rather than discovered.
 */
const SUMMARY_BATCH = 10;

/** Cap on the summary itself, so the thing that bounds cost cannot grow unbounded. */
const SUMMARY_WORDS = 200;

/**
 * Conversation memory, isolated here so a failure in it can never take down an
 * answer. History is an enhancement: if the tables are unreachable the assistant
 * must still respond, just without recall — the same best-effort contract the
 * geocoding and milestone-seeding paths follow.
 */
const history_ = {
  /** Resolve the thread id once, so condense + load agree on which thread. */
  async currentId(client, user) {
    try {
      return await convo.currentConversation(client, user.user_id);
    } catch {
      return null;
    }
  },
  async load(client, { user, conversationId }) {
    try {
      const id = conversationId || (await convo.currentConversation(client, user.user_id));
      const state = await convo.conversationSummary(client, id);
      return {
        conversationId: id,
        turns: await convo.recentMessages(client, id, HISTORY_TURNS),
        summary: state.summary || null,
      };
    } catch (err) {
      logger.warn({ err: err.message }, "[ai] conversation history unavailable");
      return { conversationId: conversationId || null, turns: [], summary: null };
    }
  },
  async save(client, { conversationId, question, answer }) {
    if (!conversationId) return;
    try {
      await convo.addMessage(client, { conversationId, role: "user", content: question });
      if (answer) await convo.addMessage(client, { conversationId, role: "assistant", content: answer });
    } catch (err) {
      logger.warn({ err: err.message }, "[ai] conversation turn not persisted");
    }
  },

  /**
   * Fold everything that has scrolled out of the replay window into one rolling
   * summary (0481).
   *
   * WHY. `HISTORY_TURNS` caps what is re-sent so cost stays flat, but the effect
   * was that turn 21 did not fade — it vanished. A user who was told something in
   * message 3 and refers back to it in message 30 got a blank stare, which is
   * worse than no memory at all, because the assistant had already taught them to
   * expect recall.
   *
   * Runs BEFORE the model call, not after, so the current question benefits from
   * the summary that was just written rather than the next one. Batched (see
   * SUMMARY_BATCH) so the extra call is amortised over ten turns.
   *
   * Best-effort throughout: a summariser that throws must never cost the user an
   * answer, and a failed batch simply retries on the next turn — `summary_through`
   * only advances after a successful write, so nothing is skipped.
   */
  async condense(client, { user, conversationId, feature }) {
    if (!conversationId) return;
    try {
      const state = await convo.conversationSummary(client, conversationId);
      const pending = await convo.messagesAwaitingSummary(client, conversationId, {
        keepRecent: HISTORY_TURNS,
        sinceMessageId: state.summary_through,
      });
      if (pending.length < SUMMARY_BATCH) return;

      // Redacted on the way IN, like every other egress path — the summariser is
      // a model call, so PII/financial scrubbing applies before the text leaves.
      const transcript = pending.map((m) => `${m.role}: ${redact(m.content)}`).join("\n");
      const prior = state.summary ? `EXISTING SUMMARY:\n${redact(state.summary)}\n\n` : "";
      const res = await llm.chat({
        client,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You maintain a running summary of an ERP assistant conversation. " +
              `Rewrite the existing summary and the new exchanges into ONE summary of at most ${SUMMARY_WORDS} words. ` +
              "Keep decisions, figures, record references and anything the user asked to be remembered. " +
              "Drop pleasantries and anything already superseded. Write plain prose, no preamble.",
          },
          { role: "user", content: `${prior}NEW EXCHANGES:\n${transcript}` },
        ],
      });
      if (!res.text) return; // no provider configured, or the vendor failed — try again next turn

      await convo.setSummary(client, conversationId, {
        summary: res.text.trim(),
        throughMessageId: pending[pending.length - 1].ai_message_id,
      });
      // Counted against the tenant's AI budget like any other call — it is real
      // spend, and hiding it would make the cap lie. `call_type` distinguishes it
      // so the spend dashboard can show what summarisation costs.
      await recordUsage(client, { user, conversationId, res, feature, callType: "summary" });
    } catch (err) {
      logger.warn({ err: err.message }, "[ai] conversation summarisation skipped");
    }
  },
};

// Actions the AI may propose come from ai_action_catalogue (ai_enabled=true).
async function loadTools(client) {
  const { rows } = await client.query(
    `SELECT action_key, title, description, payload_schema, is_write,
            required_permission, requires_confirmation
       FROM ai_action_catalogue WHERE ai_enabled = true`,
  );
  return rows;
}

const toOpenAiTool = (a) => ({
  type: "function",
  function: {
    name: a.action_key,
    description: a.title + (a.description ? ` — ${a.description}` : ""),
    parameters: a.payload_schema && Object.keys(a.payload_schema).length ? a.payload_schema : { type: "object", properties: {} },
  },
});

// Minimal JSON-schema gate: required keys present + no unknown top-level keys.
function validatePayload(schema, payload) {
  const errors = [];
  const props = (schema && schema.properties) || {};
  for (const req of (schema && schema.required) || []) {
    if (payload[req] === undefined) errors.push(`missing '${req}'`);
  }
  for (const k of Object.keys(payload)) {
    if (Object.keys(props).length && !props[k]) errors.push(`unknown '${k}'`);
  }
  return errors;
}

/**
 * One assistant turn. Returns { answer, actions:[{action_run_id, action_key,
 * payload, requires_confirmation}] }. Does NOT execute writes — that needs an
 * explicit confirm (see confirmAction).
 */
async function ask({ client, user, conversationId, message, allowed, feature = "assistant" }) {
  // Governance gate (AI_ARCHITECTURE §6): feature enabled + user granted + budget
  // not hard-capped. Nothing hits a model when the gate is closed.
  const gate = await governance.canUseFeature(client, { userId: user.user_id, featureKey: feature });
  if (!gate.allowed) {
    return { answer: `The AI assistant is unavailable: ${gate.reason}.`, actions: [], blocked: true, gate };
  }
  const hits = await retrieve({ query: message, tenantClient: client, allowed, k: 6 });
  const tools = await loadTools(client);

  const system =
    "You are Praxis LS, an OHADA-aware logistics ERP assistant. Ground answers in the CONTEXT. " +
    "Only call a function when the user asks to DO something; never invent data. " +
    "You act with the user's permissions and cannot exceed them.\n\nCONTEXT:\n" +
    redact(toContextBlock(hits));

  // ── Conversation memory ──────────────────────────────────────────────────
  // Until 2026-08-01 this array was just [system, user] on every call, so the
  // assistant could not answer "and what about last month?" — it had never seen
  // the previous turn. ai_conversation / ai_message have existed since 0400_ai
  // and were simply never written to.
  //
  // HISTORY_TURNS caps what is REPLAYED, not what is stored: everything is kept,
  // but only the last few turns are re-sent. That keeps per-call token cost flat
  // and predictable, which matters because AI spend is budget-capped per tenant
  // (governance.canUseFeature hard-blocks on the cap) — an unbounded transcript
  // would make each successive question in a long thread cost more than the last.
  //
  // Redaction applies to history too: PII/financial scrubbing has to hold for
  // replayed turns exactly as it does for the live question.
  // Fold anything that has scrolled out of the window into the rolling summary
  // first, so THIS answer sees it (0481). Best-effort — never blocks the answer.
  const resolvedId = conversationId || (await history_.currentId(client, user));
  await history_.condense(client, { user, conversationId: resolvedId, feature });

  const history = await history_.load(client, { user, conversationId: resolvedId });
  const messages = [
    { role: "system", content: system },
    // The summary rides as a system message rather than a fake assistant turn:
    // it is context about the conversation, not something anyone actually said,
    // and labelling it honestly stops the model quoting it back as its own words.
    ...(history.summary
      ? [{
          role: "system",
          content:
            "EARLIER IN THIS CONVERSATION (summary of turns no longer replayed in full):\n" +
            redact(history.summary),
        }]
      : []),
    ...history.turns.map((m) => ({ role: m.role, content: redact(m.content) })),
    { role: "user", content: redact(message) },
  ];

  const res = await llm.chat({ client, messages, tools: tools.map(toOpenAiTool) });
  await recordUsage(client, { user, conversationId: history.conversationId, res, feature });
  // Persist the exchange AFTER the model call: a failed call leaves no orphan
  // user turn that would be replayed forever with no answer beside it.
  await history_.save(client, {
    conversationId: history.conversationId,
    question: message,
    answer: res.text || null,
  });

  const actions = [];
  const batchId = res.toolCalls.length ? crypto.randomUUID() : null;
  for (const call of res.toolCalls) {
    const def = tools.find((t) => t.action_key === call.function.name);
    if (!def) continue;
    let payload = {};
    try {
      payload = JSON.parse(call.function.arguments || "{}");
    } catch {
      payload = {};
    }
    const errs = validatePayload(def.payload_schema, payload);
    const status = errs.length ? "VALIDATION_FAILED" : "AWAITING_CONFIRM";
    const run = await client.query(
      `INSERT INTO ai_action_run (conversation_id, user_id, action_key, proposed_payload, status, validation_error, batch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING action_run_id`,
      // history.conversationId, not the raw parameter: the thread is resolved
      // server-side now, so an action proposed by a client that sent no
      // conversation_id still attaches to the user's real thread instead of
      // being orphaned with a null reference.
      [history.conversationId || null, user.user_id, def.action_key, payload, status, errs.join("; ") || null, batchId],
    );
    actions.push({
      action_run_id: run.rows[0].action_run_id,
      action_key: def.action_key,
      payload,
      requires_confirmation: def.requires_confirmation,
      validation_errors: errs,
    });
  }

  const batchable = actions.filter((x) => x.requires_confirmation && (!x.validation_errors || x.validation_errors.length === 0));
  // conversation_id is returned so the client can keep sending the same thread
  // (and so a future multi-thread UI has the handle it would need).
  return { answer: res.text, actions, batch_id: batchId, batch_size: batchable.length, provider: res.provider, conversation_id: history.conversationId };
}

/**
 * Execute a confirmed action via the whitelisted registry, with the user's
 * permissions. Logs to the immutable ledger. Registry maps action_key → fn.
 */
async function confirmAction({ client, user, actionRunId, registry }) {
  const { rows } = await client.query(
    "SELECT * FROM ai_action_run WHERE action_run_id=$1 AND user_id=$2",
    [actionRunId, user.user_id],
  );
  const run = rows[0];
  if (!run) throw new Error("action run not found");
  if (run.status !== "AWAITING_CONFIRM") throw new Error(`cannot confirm in state ${run.status}`);

  // Re-check the governance gate at execution time (feature may have been turned
  // off or the budget hard-capped between propose and confirm).
  const gate = await governance.canUseFeature(client, { userId: user.user_id, featureKey: "assistant" });
  if (!gate.allowed) throw new Error(`AI action blocked: ${gate.reason}`);

  const fn = registry && registry[run.action_key];
  if (!fn) throw new Error(`no executor registered for ${run.action_key}`);

  const result = await fn({ client, user, payload: run.proposed_payload });
  await client.query(
    "UPDATE ai_action_run SET status='EXECUTED', executed_entity_ref=$2 WHERE action_run_id=$1",
    [actionRunId, result && result.entity_ref ? result.entity_ref : null],
  );
  await client.query(
    `INSERT INTO immutable_ledger (actor_user_id, action, module_key, entity_ref, after_json)
     VALUES ($1,$2,'MOD-67',$3,$4)`,
    [user.user_id, `ai.action.${run.action_key}`, result && result.entity_ref, run.proposed_payload],
  );

  // Record the execution in the conversation itself.
  //
  // Replayed history is user/assistant only — `tool` rows are execution detail
  // and confuse the model more than they inform it. But that left the assistant
  // blind to its own effects: it remembered PROPOSING "create this proforma",
  // never that you confirmed it. Asked "did you create that?", it would guess.
  //
  // A short factual assistant note lands in the replay window like any other
  // turn, so the next question is answered knowing the work actually happened.
  // Best-effort: an action that executed must never be reported as failed
  // because a note couldn't be written.
  try {
    if (run.conversation_id) {
      const ref = result && result.entity_ref ? ` (${result.entity_ref})` : "";
      await convo.addMessage(client, {
        conversationId: run.conversation_id,
        role: "assistant",
        content: `✓ Executed ${run.action_key}${ref}.`,
      });
    }
  } catch (err) {
    logger.warn({ err: err.message, actionRunId }, "[ai] execution note not recorded in conversation");
  }

  return { ok: true, result };
}

/**
 * Confirm and execute every AWAITING_CONFIRM action in a batch, in creation
 * order, re-checking the governance gate once. Halts on the first failure
 * (remaining actions stay AWAITING_CONFIRM). Per-module services still own their
 * own transactions — cross-module atomicity is a later design (§8) — so this is
 * "grouped + halt-on-failure", not a single distributed transaction.
 */
async function confirmBatch({ client, user, batchId, registry }) {
  const gate = await governance.canUseFeature(client, { userId: user.user_id, featureKey: "assistant" });
  if (!gate.allowed) throw new Error(`AI action blocked: ${gate.reason}`);

  const { rows } = await client.query(
    "SELECT action_run_id FROM ai_action_run WHERE batch_id=$1 AND user_id=$2 AND status='AWAITING_CONFIRM' ORDER BY created_at",
    [batchId, user.user_id],
  );
  const results = [];
  for (const r of rows) {
    let res;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await confirmAction({ client, user, actionRunId: r.action_run_id, registry });
    } catch (err) {
      results.push({ action_run_id: r.action_run_id, ok: false, error: err.message });
      return { batch_id: batchId, halted: true, executed: results.filter((x) => x.ok).length, results };
    }
    results.push({ action_run_id: r.action_run_id, ok: true, result: res.result });
  }
  return { batch_id: batchId, halted: false, executed: results.length, results };
}

async function recordUsage(client, { user, conversationId, res, feature, callType = "chat" }) {
  try {
    const u = res.usage || {};
    // Route through governance so the row is tied to the active budget period and
    // its XAF cost is derived from the vendor's per-token rate (spend caps).
    await governance.recordUsage(client, {
      userId: user.user_id, featureKey: feature, conversationId: conversationId || null,
      provider: res.provider, callType,
      inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0,
      wasSuccessful: true,
    });
  } catch (err) {
    logger.warn({ err: err.message }, "ai usage log failed");
  }
}

module.exports = { ask, confirmAction, confirmBatch, loadTools };
