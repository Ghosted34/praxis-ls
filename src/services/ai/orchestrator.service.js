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
const { buildFieldMeta } = require("./action-fields");
const { logger } = require("../../config/logger");
const actionAuthz = require("./action-authz");
const { buildSources, buildTrace } = require("./answer-sources");

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
      logger.warn({ err }, "[ai] conversation history unavailable");
      return { conversationId: conversationId || null, turns: [], summary: null };
    }
  },
  async save(client, { conversationId, question, answer }) {
    if (!conversationId) return;
    try {
      await convo.addMessage(client, { conversationId, role: "user", content: question });
      if (answer) await convo.addMessage(client, { conversationId, role: "assistant", content: answer });
    } catch (err) {
      logger.warn({ err }, "[ai] conversation turn not persisted");
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
      logger.warn({ err }, "[ai] conversation summarisation skipped");
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

// ── Tool scoping ────────────────────────────────────────────────────────────
// The catalogue can advertise 150+ actions; handing all of them to the model
// every turn bloats the request and pushes weaker models (DeepSeek especially)
// into emitting malformed/hallucinated tool calls. So when the list is large we
// send a focused subset: a small always-on CORE, plus the actions most relevant
// to THIS turn (scored on the message + recent history so a "yes"/"go ahead"
// still surfaces the tool the previous turn was about). Resolution/validation on
// confirm still uses the full catalogue — scoping only limits what's OFFERED.
// Phrases that mean "I'm about to act" — used to catch a stall (announcement with
// no tool call). "let me know" is excluded so a normal closing doesn't match.
const STALL_RE = /\b(let me(?! know)|i['’]?ll\b|i will\b|let['’]?s\b|one moment|hold on|allow me|give me a moment|now i)\b/i;
const TOOL_LIMIT = 64;
const CORE_TOOLS = new Set([
  "create_client", "open_dossier", "list_dossiers", "list_clients", "list_leads",
  "list_opportunities", "list_quotations", "list_final_invoices", "receivables_ageing", "get_trial_balance",
]);
const tokenize = (s) => (s || "").toLowerCase().match(/[a-z]{3,}/g) || [];

function selectTools(tools, contextText, limit = TOOL_LIMIT) {
  if (tools.length <= limit) return tools;
  const q = new Set(tokenize(contextText));
  const scored = tools.map((t) => {
    const hay = `${t.action_key} ${t.title} ${t.description || ""}`.toLowerCase();
    let s = 0;
    for (const w of q) if (hay.includes(w)) s += 1;
    if (CORE_TOOLS.has(t.action_key)) s += 100; // core is always retained
    if (!t.is_write) s += 0.5; // gentle tie-break toward reads (answering needs them)
    return { t, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.t);
}

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
async function ask({ client, user, conversationId, message, allowed, registry, feature = "assistant" }) {
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
    // Reads vs writes: a question is never a create.
    "A question or request to SEE/LIST/COUNT/CHECK/SUMMARISE data is a READ — use a list_/get_ action (or just " +
    "answer); NEVER a create_/update_/record_ write. Propose a write ONLY when the user explicitly asks to create, " +
    "change, advance, record, or post something. 'How many X are there' means list_X, not create_X. " +
    // Filter/fetch by the internal id, not a human label.
    "When filtering or fetching a record, use its internal id (the UUID from a previous read), NOT a human " +
    "reference like a vehicle registration, ref, or code — those won't match an id filter. " +
    "You act with the user's permissions and cannot exceed them. " +
    // Speak business language, not database language. Users identify records by
    // name/reference, not internal keys — surfacing a UUID reads as a leak.
    "Speak in plain business language. Refer to records by their name or human reference " +
    "(a dossier by its ref e.g. SBX-2026-0001, a client or lead by its name), and use natural " +
    "field names (\"payment terms\", not \"payment_terms_days\"). NEVER show the user raw database " +
    "identifiers (UUIDs like d69be65d-…), internal id columns, or snake_case field names unless they " +
    "explicitly ask for an ID. When confirming an action you took, name the record, not its UUID. " +
    // One step at a time: propose a single action, let the human confirm it, then
    // (a recap is generated automatically) wait before the next.
    "When a task needs several actions, do them ONE AT A TIME: propose a single action, wait for the user to " +
    "confirm it, then wait for their go-ahead before proposing the next. Do not propose multiple actions at once. " +
    // The stall to kill: the model saying "let me do that now" WITHOUT emitting the
    // tool call, forcing the user to prod it. Announce and act in the same turn.
    "CRUCIAL: the moment you decide to act (and the user has given the go-ahead), CALL the function in that SAME " +
    "reply. Never end your turn with only a statement of intent like 'let me do that now' or 'one moment' and then " +
    "stop — if you say you will do it, do it in the same response. The user must never have to ask you to proceed " +
    "with an action you already announced. " +
    // Status machines: a record usually can't jump straight to a terminal state.
    "For a status change, move ONE valid step along the lifecycle described in the action (e.g. a DRAFT proposal goes " +
    "to IN_REVIEW before SENT); never skip states — if unsure of the current state, read it first." +
    "\n\nCONTEXT:\n" +
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

  // Offer a focused, relevant slice of the catalogue (scored on this turn + the
  // replayed history), not all 150 tools — keeps weaker models from choking.
  const contextText = [message, ...history.turns.map((m) => m.content || "")].join(" ");
  const offered = selectTools(tools, contextText);
  let res = await llm.chat({ client, messages, tools: offered.map(toOpenAiTool) });
  await recordUsage(client, { user, conversationId: history.conversationId, res, feature });
  // Whether the anti-stall nudge below had to fire. A step in the trace, because
  // "the model needed prodding" is part of how this answer came about.
  let nudged = false;

  // Anti-stall: the model sometimes ANNOUNCES an action ("Now let me check…",
  // "I'll create it now") but emits no tool call, forcing the user to type
  // "continue". When that happens, nudge it ONCE to actually act in this turn.
  // The nudge message is not persisted — only the real question + final answer.
  if (!res.toolCalls.length && STALL_RE.test(res.text || "")) {
    const retry = await llm.chat({
      client,
      messages: [
        ...messages,
        { role: "assistant", content: res.text || "" },
        { role: "user", content: "Proceed NOW: if this needs an action, call the function in THIS reply; otherwise give the answer directly. Do not just say you will." },
      ],
      tools: offered.map(toOpenAiTool),
    });
    await recordUsage(client, { user, conversationId: history.conversationId, res: retry, feature });
    if (retry.toolCalls.length || (retry.text && retry.text.trim())) {
      res = retry;
      nudged = true;
    }
  }

  // Split the model's tool calls: reads are pure, so we run them NOW and let the
  // model narrate the data back (a single bounded hop); writes are proposed as
  // action cards that a human confirms. `writeCalls` collects both the writes from
  // this turn and any write the follow-up proposes after seeing the read data.
  const defFor = (call) => tools.find((t) => t.action_key === call.function.name);
  // Reads available to this caller — the set a reference field's picker may draw
  // from (buildFieldMeta only offers a picker whose read is in here).
  const availableReads = new Set(tools.filter((t) => !t.is_write).map((t) => t.action_key));
  const writeCalls = [];
  const readCalls = [];
  for (const call of res.toolCalls) {
    const def = defFor(call);
    if (!def) continue;
    (def.is_write ? writeCalls : readCalls).push({ call, def });
  }

  let answer = res.text;

  /**
   * What every read actually returned — the ground truth behind the citations
   * under the answer and the steps in its trace (`answer-sources.js`).
   *
   * Captured HERE, unredacted and uncapped, and not recovered later from the
   * tool messages: those are truncated to 6 000 characters and scrubbed for
   * egress to the model, so a row count taken from them would be a count of what
   * survived the cap, not of what was read. Nothing in this array reaches a
   * model — only a label, a route and a row count reach the browser.
   */
  const readTrace = [];

  if (readCalls.length && registry) {
    const toolMsgs = [];
    for (const { call, def } of readCalls) {
      let payload = {};
      try { payload = JSON.parse(call.function.arguments || "{}"); } catch { payload = {}; }
      let content;
      const step = { actionKey: def.action_key, payload, result: null, failed: false, error: null };
      try {
        // SEC H1. `def.required_permission` was selected into the tool list and
        // never compared against anything. A read action returns tenant data
        // the caller may hold no grant to see, so it is gated on the same terms
        // as a write — and the model gets the denial as tool output rather than
        // an exception, so it can tell the user why instead of the turn dying.

        await actionAuthz.assertAllowed(client, user, def);
        const fn = registry[def.action_key];
        const out = fn ? await fn({ client, user, payload }) : { error: "no executor" };
        step.result = out && out.data !== undefined ? out.data : out;
        // A missing executor is reported, not thrown, so it lands here rather
        // than in the catch — and a read that produced only an error grounds
        // nothing, so it must not become a citation.
        if (!fn) { step.failed = true; step.error = "no executor"; }
        content = JSON.stringify(step.result);
      } catch (err) {
        step.failed = true;
        step.error = err.message;
        content = JSON.stringify({ error: err.message });
      }
      readTrace.push(step);
      // Cap + redact so a big list can't blow the context or leak sensitive text.
      toolMsgs.push({ role: "tool", tool_call_id: call.id, content: redact(content).slice(0, 6000) });
    }
    // No tools on the follow-up: the model must now narrate the fetched data as
    // prose (passing tools risks it re-calling reads and returning empty text). A
    // write it wants alongside a read should be proposed in the FIRST turn, which
    // is already captured in writeCalls.
    const followup = await llm.chat({
      client,
      messages: [
        ...messages,
        { role: "assistant", content: res.text || null, tool_calls: readCalls.map((r) => r.call) },
        ...toolMsgs,
      ],
    });
    await recordUsage(client, { user, conversationId: history.conversationId, res: followup, feature });
    answer = followup.text || answer;
  }

  // Persist the exchange AFTER the answer is finalised (post read-narration), so
  // the stored assistant turn is what the user actually saw — not the empty text
  // of a turn that only made tool calls. Best-effort; never blocks the response.
  await history_.save(client, {
    conversationId: history.conversationId,
    question: message,
    answer: answer || null,
  });

  const actions = [];
  const batchId = writeCalls.length ? crypto.randomUUID() : null;
  for (const { call, def } of writeCalls) {
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
      // Drives the interactive form: schema types each field, field_meta says
      // which render as dropdowns (enum inline, or a `ref` list-read to fetch).
      schema: def.payload_schema,
      field_meta: buildFieldMeta(def.payload_schema, availableReads),
    });
  }

  const batchable = actions.filter((x) => x.requires_confirmation && (!x.validation_errors || x.validation_errors.length === 0));

  /**
   * Grounding, from the reads rather than from the prose.
   *
   * Both fields are OMITTED when empty rather than sent as `[]`, because the
   * client renders on presence: the trace disclosure and the sources footer both
   * test length, and an answer that consulted nothing should show nothing rather
   * than an empty "Trace · 0 steps". `AskResult.sources` / `.trace` are already
   * optional on the wire (`client/src/lib/ai-api.ts`).
   *
   * `sources` never includes a write: a proposed action is what the assistant
   * wants to DO, not what the answer stands on. It appears in the trace, which
   * is a record of the turn, not a citation list.
   */
  const sources = buildSources(readTrace);
  const trace = buildTrace({
    reads: readTrace,
    writes: writeCalls.map(({ def }) => ({ actionKey: def.action_key })),
    recalled: hits.length,
    nudged,
  });

  // conversation_id is returned so the client can keep sending the same thread
  // (and so a future multi-thread UI has the handle it would need).
  return {
    answer,
    actions,
    batch_id: batchId,
    batch_size: batchable.length,
    provider: res.provider,
    conversation_id: history.conversationId,
    ...(sources.length ? { sources } : {}),
    ...(trace.length ? { trace } : {}),
  };
}

/**
 * Execute a confirmed action via the whitelisted registry, with the user's
 * permissions. Logs to the immutable ledger. Registry maps action_key → fn.
 */
async function confirmAction({ client, user, actionRunId, registry, payload: edited }) {
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

  // The interactive form can submit an edited payload (user picked selects /
  // filled fields). Re-validate against the SAME catalogue schema the propose
  // step used, then persist it, so what executes is exactly what was confirmed
  // and the ledger reflects the final values — never the model's first guess.
  let payload = run.proposed_payload;
  if (edited && typeof edited === "object") {
    const { rows: cat } = await client.query(
      "SELECT payload_schema FROM ai_action_catalogue WHERE action_key=$1",
      [run.action_key],
    );
    const errs = validatePayload(cat[0] && cat[0].payload_schema, edited);
    if (errs.length) throw new Error(`invalid payload: ${errs.join("; ")}`);
    payload = edited;
    await client.query("UPDATE ai_action_run SET proposed_payload=$2 WHERE action_run_id=$1", [actionRunId, payload]);
  }

  // SEC H1. THE gap. This ran the executor with the caller's identity and no
  // permission check whatsoever, so the assistant bypassed the module grant
  // matrix entirely: draft_supplier_invoice and draft_cash_request were
  // reachable by a warehouse operator holding only WMS grants.
  //
  // Checked HERE, at execution, and not only when the action was proposed — the
  // two are separated by a human confirmation step, and a user's grants can be
  // revoked in between. That is the same reason the governance gate above is
  // re-checked at confirm time.
  const { rows: defRows } = await client.query(
    "SELECT action_key, required_permission FROM ai_action_catalogue WHERE action_key=$1",
    [run.action_key],
  );
  await actionAuthz.assertAllowed(client, user, defRows[0] || { action_key: run.action_key, required_permission: null });

  const result = await fn({ client, user, payload });
  await client.query(
    "UPDATE ai_action_run SET status='EXECUTED', executed_entity_ref=$2 WHERE action_run_id=$1",
    [actionRunId, result && result.entity_ref ? result.entity_ref : null],
  );
  await client.query(
    `INSERT INTO immutable_ledger (actor_user_id, action, module_key, entity_ref, after_json)
     VALUES ($1,$2,'MOD-67',$3,$4)`,
    [user.user_id, `ai.action.${run.action_key}`, result && result.entity_ref, payload],
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
      // Name the record so recall is concrete: replayed later, "✓ Executed
      // create_client — name: SODECOTON (client:…)" lets the model answer "what
      // did you just do?" by name, not just by action key.
      const SALIENT = ["name", "full_name", "title", "ref", "code", "label", "to", "status", "amount", "email"];
      const parts = [];
      for (const k of SALIENT) {
        if (payload && payload[k] !== undefined && payload[k] !== null && payload[k] !== "") parts.push(`${k}: ${payload[k]}`);
        if (parts.length >= 3) break;
      }
      const summary = parts.length ? ` — ${parts.join(", ")}` : "";
      await convo.addMessage(client, {
        conversationId: run.conversation_id,
        role: "assistant",
        content: `✓ Executed ${run.action_key}${summary}${ref}.`,
      });
    }
  } catch (err) {
    logger.warn({ err, actionRunId }, "[ai] execution note not recorded in conversation");
  }

  // Step-by-step narration. After a confirmed action we generate a short message
  // that (1) confirms what was done by name, (2) recaps what's been completed in
  // this task, and (3) proposes the SINGLE next step as a question — then stops
  // and waits. No tools on this call, so it can only talk, never chain another
  // action. Best-effort: a narration failure never fails the executed action.
  let message = null;
  try {
    if (run.conversation_id) {
      const hist = await history_.load(client, { user, conversationId: run.conversation_id });
      const sys =
        "You are Praxis LS, carrying out a step-by-step task for the user. An action was JUST executed " +
        "successfully. Reply in 1-3 short sentences of plain business language (never show UUIDs or " +
        "snake_case field names): first confirm what was done, naming the record; then recap what has been " +
        "completed in this task so far; then propose the SINGLE next step as a question and STOP. Do not take " +
        "any further action or call any function — wait for the user's go-ahead.";
      const nar = await llm.chat({
        client,
        temperature: 0.3,
        messages: [
          { role: "system", content: sys },
          ...hist.turns.map((m) => ({ role: m.role, content: redact(m.content) })),
        ],
      });
      message = nar.text || null;
      await recordUsage(client, { user, conversationId: run.conversation_id, res: nar, feature: "assistant" });
      if (message) await convo.addMessage(client, { conversationId: run.conversation_id, role: "assistant", content: message });
    }
  } catch (err) {
    logger.warn({ err, actionRunId }, "[ai] post-action narration skipped");
  }

  return { ok: true, result, message };
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
    logger.error({ err }, "ai usage log failed");
  }
}

module.exports = { ask, confirmAction, confirmBatch, loadTools };
