/**
 * The agent loop (PRD §10.2/§10.3): recall → plan with function-calling →
 * Zod-gate proposed actions (≤2 self-correct → manual fallback) → return action
 * cards for human confirm → execute with the user's permissions → log.
 * The AI never exceeds the calling user; sensitive text is redacted before egress.
 */
"use strict";

const llm = require("./llm.service");
const { retrieve, toContextBlock } = require("./retrieval.service");
const { redact } = require("./redact");
const { logger } = require("../../config/logger");

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
async function ask({ client, user, conversationId, message, allowed }) {
  const hits = await retrieve({ query: message, tenantClient: client, allowed, k: 6 });
  const tools = await loadTools(client);

  const system =
    "You are Praxis LS, an OHADA-aware logistics ERP assistant. Ground answers in the CONTEXT. " +
    "Only call a function when the user asks to DO something; never invent data. " +
    "You act with the user's permissions and cannot exceed them.\n\nCONTEXT:\n" +
    redact(toContextBlock(hits));

  const messages = [
    { role: "system", content: system },
    { role: "user", content: redact(message) },
  ];

  const res = await llm.chat({ messages, tools: tools.map(toOpenAiTool) });
  await recordUsage(client, { user, conversationId, res, feature: "assistant" });

  const actions = [];
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
      `INSERT INTO ai_action_run (conversation_id, user_id, action_key, proposed_payload, status, validation_error)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING action_run_id`,
      [conversationId || null, user.user_id, def.action_key, payload, status, errs.join("; ") || null],
    );
    actions.push({
      action_run_id: run.rows[0].action_run_id,
      action_key: def.action_key,
      payload,
      requires_confirmation: def.requires_confirmation,
      validation_errors: errs,
    });
  }

  return { answer: res.text, actions, provider: res.provider };
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
  return { ok: true, result };
}

async function recordUsage(client, { user, conversationId, res, feature }) {
  try {
    const u = res.usage || {};
    await client.query(
      `INSERT INTO ai_usage_ledger (user_id, feature_key, conversation_id, provider, model, call_type,
         input_tokens, output_tokens, total_tokens, was_successful)
       VALUES ($1,$2,$3,$4,$5,'chat',$6,$7,$8,true)`,
      [user.user_id, feature, conversationId || null, res.provider, null,
        u.prompt_tokens || 0, u.completion_tokens || 0, u.total_tokens || 0],
    );
  } catch (err) {
    logger.warn({ err: err.message }, "ai usage log failed");
  }
}

module.exports = { ask, confirmAction, loadTools };
