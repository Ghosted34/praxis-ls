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

  const messages = [
    { role: "system", content: system },
    { role: "user", content: redact(message) },
  ];

  const res = await llm.chat({ client, messages, tools: tools.map(toOpenAiTool) });
  await recordUsage(client, { user, conversationId, res, feature });

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
      [conversationId || null, user.user_id, def.action_key, payload, status, errs.join("; ") || null, batchId],
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
  return { answer: res.text, actions, batch_id: batchId, batch_size: batchable.length, provider: res.provider };
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

async function recordUsage(client, { user, conversationId, res, feature }) {
  try {
    const u = res.usage || {};
    // Route through governance so the row is tied to the active budget period and
    // its XAF cost is derived from the vendor's per-token rate (spend caps).
    await governance.recordUsage(client, {
      userId: user.user_id, featureKey: feature, conversationId: conversationId || null,
      provider: res.provider, callType: "chat",
      inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0,
      wasSuccessful: true,
    });
  } catch (err) {
    logger.warn({ err: err.message }, "ai usage log failed");
  }
}

module.exports = { ask, confirmAction, confirmBatch, loadTools };
