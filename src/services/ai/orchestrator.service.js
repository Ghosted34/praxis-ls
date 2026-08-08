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
 * Narration uses a SMALLER replay window than the main ask (audit 3.8).
 * The narration only needs to know what was just done and the immediately
 * preceding step — not the full 20-turn context. 5 turns is enough for
 * "confirm what was done, recap progress" without paying for 20 turns of
 * history on every confirm.
 */
const NARRATION_TURNS = 5;

/**
 * How many model↔tool round-trips one turn may take before the answer must be
 * prose.
 *
 * WHY THIS EXISTS AT ALL. There used to be exactly one: the model called its
 * reads, the rows came back, and the follow-up call was made WITHOUT tools so it
 * could only narrate. That is fine for "list my clients" and wrong for every
 * question this ERP is actually asked, because a real question is a chain — find
 * the invoice, map it to a client, read that client's terms, then answer. The
 * model would take step one, say "let me check the client list", and the turn
 * would end there: no second read was possible, so a sentence of intent became
 * the final answer. The user asked for two things and got neither, and the trace
 * read "1 step" because one step was the ceiling.
 *
 * WHY IT IS BOUNDED, and why the bound is small. AI spend is capped per tenant
 * per budget period (`governance.canUseFeature` hard-blocks on it), so an
 * unbounded loop does not hang — it silently eats somebody's month. Five is
 * sized to the chains this product has: two or three lookups plus a synthesis.
 *
 * WHY THE LAST ROUND DROPS THE TOOLS. Without that, hitting the cap mid-chain
 * ends the turn on an unanswered tool call — the exact failure this constant was
 * introduced to remove, just moved to round five. Offering no tools on the final
 * pass makes prose the only thing the model can return, so the turn always ends
 * with an answer, even if it is "I could not resolve this in the steps I had".
 */
const MAX_TOOL_ROUNDS = 5;

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
  /**
   * Store the exchange, grounding included (0521).
   *
   * The citations and the trace ride on the ASSISTANT row and only there: they
   * describe how the answer was reached, and a question reaches nothing. Storing
   * them was the fix for a reopened thread coming back as bare prose — the
   * provenance existed for exactly as long as the browser tab did.
   *
   * Still best-effort, and that ordering matters: the answer is already on its
   * way to the user by the time this runs, so a failure here costs recall, never
   * the reply.
   */
  async save(client, { conversationId, question, answer, sources, trace }) {
    if (!conversationId) return;
    try {
      await convo.addMessage(client, { conversationId, role: "user", content: question });
      if (answer) {
        await convo.addMessage(client, {
          conversationId,
          role: "assistant",
          content: answer,
          sources: sources || [],
          trace: trace || [],
        });
      }
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

/**
 * Self-learning: recent successful action patterns.
 *
 * THE LEARNING FIX. The assistant used to have no memory of what it had
 * successfully done before. This function pulls the last 10 successfully
 * executed actions with their payloads, so the system prompt can include them
 * as "PATTERNS YOU HAVE SUCCESSFULLY EXECUTED" — the model can reference them
 * when the user asks for similar actions.
 *
 * Best-effort: a failure here never blocks the answer.
 */
async function recentPatterns(client) {
  try {
    const { rows } = await client.query(
      `SELECT action_key, proposed_payload, executed_entity_ref
         FROM ai_action_run
        WHERE status = 'EXECUTED'
          AND proposed_payload IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 10`,
    );
    return rows.map((r) => ({
      action: r.action_key,
      fields: Object.keys(r.proposed_payload || {}).slice(0, 8),
      ref: r.executed_entity_ref,
    }));
  } catch {
    return [];
  }
}

/**
 * Self-learning: recent NEGATIVE feedback (thumbs-down with comments).
 *
 * THE FEEDBACK LOOP. When users down-vote an answer AND leave a comment
 * explaining what was wrong, that comment is gold — it tells the model
 * specifically what to avoid. The last 5 recent down-votes with comments
 * are injected into the system prompt as "PATTERNS USERS DISLIKED" so the
 * model actively avoids repeating known mistakes.
 *
 * This is the cheapest form of prompt tuning: no fine-tuning, no RLHF,
 * just telling the model "last time you did X, the user said Y — don't
 * do that again."
 *
 * Best-effort: a failure here never blocks the answer.
 */
async function recentNegativeFeedback(client) {
  try {
    const { rows } = await client.query(
      `SELECT answer_text, comment, action_keys
         FROM ai_answer_feedback
        WHERE vote = 'down'
          AND comment IS NOT NULL
          AND comment <> ''
          AND created_at > now() - interval '30 days'
        ORDER BY created_at DESC
        LIMIT 5`,
    );
    return rows.map((r) => ({
      comment: r.comment,
      actions: r.action_keys || [],
    }));
  } catch {
    return [];
  }
}

/**
 * Per-user preferences.
 *
 * Users can set preferences like "always show amounts in XAF", "prefer tables
 * over prose", "always include the dossier reference". These are injected
 * into the system prompt so the model tailors its output to the user's
 * stated preferences.
 *
 * Stored as a simple JSON blob on the user's conversation or a dedicated
 * preferences table. For now, we read from ai_user_preference if it exists,
 * otherwise return empty.
 */
async function userPreferences(client, userId) {
  try {
    const { rows } = await client.query(
      "SELECT preferences FROM ai_user_preference WHERE user_id = $1",
      [userId],
    );
    if (rows[0] && rows[0].preferences) return rows[0].preferences;
  } catch {
    // Table may not exist yet — that's fine.
  }
  return {};
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
// ── Tightened anti-stall detection (audit 3.4) ──
// The old STALL_RE matched "I'll" and "let me" in ANY context — "I'll look
// into that" (conversational, no tool intended) triggered an expensive nudge.
// Now: a stall requires an ANNOUNCEMENT phrase AND an ACTION VERB in the same
// response. "I'll look into that later" matches announce but not verb → no
// nudge. "I'll create that for you now" matches both → nudge fires.
const STALL_ANNOUNCE = /\b(let me(?! know)|i['\u2019]?ll\b|i will\b|let['\u2019]?s\b|one moment|hold on|allow me|give me a moment|now i)\b/i;
const STALL_ACTION = /\b(create|check|fetch|get|find|look\s*up|pull|list|search|open|draft|raise|prepare|submit|send|record|post|update|calculate|run|read|retrieve|generate|add)\b/i;
function isStall(text) {
  return !!text && STALL_ANNOUNCE.test(text) && STALL_ACTION.test(text);
}
const TOOL_LIMIT = 64;
const CORE_TOOLS = new Set([
  "create_client", "open_dossier", "list_dossiers", "list_clients", "list_leads",
  "list_opportunities", "list_quotations", "list_final_invoices", "receivables_ageing", "get_trial_balance",
]);

// ── Domain synonyms for tool scoping ──
// THE TOOL SCOPING FIX. The old tokenizer dropped all words < 3 characters,
// which excluded domain abbreviations (PO, GRN, BL, VAT, NIU). A user asking
// "create a PO for supplier X" would tokenize to ["create", "supplier"] and
// `draft_purchase_order` would rely on description matching alone. These
// synonyms map common abbreviations to their full tool-key equivalents so
// the scoring finds the right actions.
const SYNONYMS = {
  po: "purchase_order", grn: "goods_received", bl: "bill_of_lading",
  vat: "tax", tva: "tax", niu: "tax", irpp: "tax",
  ops: "operations", dossier: "operations_file", file: "operations_file",
  proforma: "proforma", quote: "quotation", quotation: "quotation",
  invoice: "final_invoice", billing: "final_invoice",
  pr: "purchase_request", rfq: "purchase_request",
  si: "supplier_invoice", "supplier invoice": "supplier_invoice",
  hr: "employee", staff: "employee", personnel: "employee",
  wms: "warehouse", stock: "inventory", warehouse: "inventory",
  fleet: "vehicle", truck: "vehicle", car: "vehicle",
  cr: "cash_request", cash: "cash_request",
  costing: "costing", cost: "costing",
  lead: "lead", prospect: "lead",
  opportunity: "opportunity", deal: "opportunity",
  campaign: "marketing_campaign", marketing: "marketing_campaign",
  driver: "driver", fuel: "fuel_log",
  compliance: "compliance_flag", document: "document_vault",
};

const tokenize = (s) => {
  const words = (s || "").toLowerCase().match(/[a-z]{2,}/g) || [];
  // Expand synonyms so "PO" matches "purchase_order" in tool keys.
  const expanded = new Set(words);
  for (const w of words) {
    if (SYNONYMS[w]) expanded.add(SYNONYMS[w]);
  }
  return expanded;
};

function selectTools(tools, contextText, limit = TOOL_LIMIT) {
  if (tools.length <= limit) return tools;
  const q = tokenize(contextText); // already a Set with domain synonyms expanded
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

// ── LENIENT payload validation with type checking ──
// THE FIELD CONFUSION FIX. The old validatePayload rejected unknown keys — if
// the model sent `client_name` instead of `client_id`, the action was rejected
// as having an unknown field, and the user saw "validation failed: unknown
// 'client_name'" even though the assistant had all the right details. This was
// the root cause of "it confuses itself when details are provided".
//
// Now: only REQUIRED fields are enforced. Unknown fields pass through and the
// executor ignores them (services destructure what they need). The interactive
// form already handles field mapping via `field_meta` (dropdowns, refs), so
// whatever the model pre-fills is either correct or editable by the user.
//
// TYPE CHECKING is present but COERCIVE: a string "123" where a number is
// expected is accepted (the model often stringifies). A boolean "true"/"false"
// is accepted for boolean fields. The module's own Zod schema is the final
// gate at execution time. We only reject CLEARLY wrong types: an object where
// a string is expected, an array where a number is expected, etc.
function validatePayload(schema, payload) {
  const errors = [];
  const props = (schema && schema.properties) || {};
  // Required field check.
  for (const req of (schema && schema.required) || []) {
    if (payload[req] === undefined || payload[req] === null || payload[req] === "") {
      errors.push(`missing '${req}'`);
    }
  }
  // Type check for fields that ARE present — catches obviously wrong types
  // (an object where a string is expected) while allowing coercible values.
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null || value === "") continue;
    const prop = props[key];
    if (!prop || !prop.type) continue; // unknown field or no type declared — skip
    const actual = typeof value;
    if (prop.type === "string" && actual === "object" && !Array.isArray(value)) {
      errors.push(`'${key}' must be a string, got object`);
    } else if (prop.type === "number" && actual === "object") {
      // Allow stringified numbers ("123" → 123), reject objects/arrays.
      if (isNaN(Number(value))) errors.push(`'${key}' must be a number`);
    } else if (prop.type === "boolean" && actual === "object") {
      errors.push(`'${key}' must be a boolean`);
    } else if (prop.type === "array" && !Array.isArray(value)) {
      errors.push(`'${key}' must be an array`);
    }
    // Enum validation — if the schema declares enum values, check membership.
    // Only for strings, since the model may stringify enum values.
    if (Array.isArray(prop.enum) && prop.enum.length && typeof value === "string") {
      if (!prop.enum.includes(value)) {
        errors.push(`'${key}' must be one of: ${prop.enum.join(", ")}`);
      }
    }
  }
  return errors;
}

/**
 * One assistant turn. Returns { answer, actions:[{action_run_id, action_key,
 * payload, requires_confirmation}] }. Does NOT execute writes — that needs an
 * explicit confirm (see confirmAction).
 */
/**
 * Tell the model who is asking.
 *
 * WHY THIS EXISTS. Every drafted memo, letter and email came back signed
 * "[Your Name]" — "Prepared by: [Your Name]", "FROM: [Your Name]" — and that is
 * not a failure of intelligence. The model was never told. The system prompt
 * carried the ERP's rules and the retrieved CONTEXT, and nothing at all about
 * the person on the other end of the conversation, so a placeholder was the
 * honest thing for it to write.
 *
 * `req.user` has carried `display_name` and `email` since auth was built, and
 * this function already receives that object — it just used it for `user_id`
 * and threw the rest away.
 *
 * WHY IN THE PROMPT AND NOT PATCHED IN THE UI. The alternative is
 * find-and-replacing "[Your Name]" in the answer before rendering it. That is
 * worse in two ways: it silently rewrites text the model wrote, and it only
 * catches the exact placeholder it knows about — "[Name]", "[Your name here]"
 * and "[Sender]" all slip through. Told once, up front, the model signs
 * correctly everywhere, including in places no post-processor would think to
 * look.
 *
 * DEFENSIVE, because the answer must not get worse when a field is missing. A
 * user with no display_name contributes no line rather than "Name: undefined",
 * and if nothing at all is known the block is empty and the prompt is exactly
 * what it was before.
 *
 * NOT AN AUTHORISATION SIGNAL. This is stationery, not permission. Every read
 * and write is still gated by `governance.canUseFeature` and the executor's own
 * RBAC — a model that has been told the caller is the CEO has been told a fact
 * about how to address a memo, not granted anything.
 */
function whoIsAsking(user) {
  if (!user) return "";
  const lines = [];
  if (user.display_name) lines.push(`Name: ${user.display_name}`);
  if (user.email) lines.push(`Email: ${user.email}`);
  if (user.is_ceo) lines.push("Role: CEO / Executive");
  if (!lines.length) return "";
  return (
    "\n\nWHO YOU ARE TALKING TO — the signed-in user, on whose behalf you act:\n" +
    lines.join("\n") +
    "\nUse their real name when you draft anything that carries a sender, a signature or a " +
    "preparer — memos, letters, emails, notes. NEVER write a placeholder such as [Your Name], " +
    "[Name] or [Sender]: you have been told the name, so use it. Do not invent a job title, a " +
    "department or a company name you have not been given — leave those out rather than guessing."
  );
}

async function ask({ client, user, conversationId, message, allowed, registry, feature = "assistant" }) {
  // Governance gate (AI_ARCHITECTURE §6): feature enabled + user granted + budget
  // not hard-capped. Nothing hits a model when the gate is closed.
  const gate = await governance.canUseFeature(client, { userId: user.user_id, featureKey: feature });
  if (!gate.allowed) {
    return { answer: `The AI assistant is unavailable: ${gate.reason}.`, actions: [], blocked: true, gate };
  }
  const hits = await retrieve({ query: message, tenantClient: client, allowed, k: 6 });
  const tools = await loadTools(client);
  // Self-learning: recent successful execution patterns for the model to reference.
  const patterns = await recentPatterns(client);
  const patternBlock = patterns.length
    ? "\n\nPATTERNS YOU HAVE SUCCESSFULLY EXECUTED (use these as templates when the user asks for something similar):\n" +
      patterns.map((p, i) => `  ${i + 1}. ${p.action} → fields: ${p.fields.join(", ")}${p.ref ? ` (${p.ref})` : ""}`).join("\n")
    : "";

  // ── Self-improvement: recent negative feedback ──
  const feedback = await recentNegativeFeedback(client);
  const feedbackBlock = feedback.length
    ? "\n\nPATTERNS USERS DISLIKED (avoid these mistakes — users left specific feedback):\n" +
      feedback.map((f, i) => `  ${i + 1}. User said: "${f.comment}"${f.actions.length ? ` (on actions: ${f.actions.join(", ")})` : ""}`).join("\n")
    : "";

  // ── Per-user preferences ──
  const prefs = await userPreferences(client, user.user_id);
  const prefsBlock = Object.keys(prefs).length
    ? "\n\nUSER PREFERENCES (tailor your output to these):\n" +
      Object.entries(prefs).map(([k, v]) => `  • ${k}: ${v}`).join("\n")
    : "";

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
    // ── KEY CHANGE: auto-continue after each step, no waiting for go-ahead ──
    // The old prompt said "wait for their go-ahead before proposing the next"
    // which created the snooze loop: propose → confirm → "shall I proceed?" →
    // user says "yes" → propose → confirm → … Every cycle wasted a user turn
    // on "yes". Now: after proposing an action you WAIT for confirmation (that's
    // the safety property), but once confirmed the NEXT step is proposed in the
    // SAME reply. The user confirmed once, which means they want the task done.
    "When a task needs several actions, propose the FIRST action and wait for the user to " +
    "confirm it. Once it is confirmed, IMMEDIATELY propose the next step — do not ask 'shall I " +
    "proceed?' or 'would you like me to continue?'. Just do it. The user confirmed once, which " +
    "means they want the task done. " +
    // ── Draft → execute in one flow ──
    // When the user says "draft and execute", "create and submit", "prepare and send" — they
    // want BOTH steps, not a draft followed by a question. Draft the document as prose, then
    // IMMEDIATELY propose the corresponding write action with all the details from your draft
    // already filled in. The user sees the draft AND the action card together.
    "When the user asks you to 'draft and execute', 'create and submit', 'prepare and send' or " +
    "any combination of writing something AND recording it: first write the document as your " +
    "answer text, then IMMEDIATELY call the appropriate write function with the details from " +
    "your draft. Do not stop after drafting to ask 'shall I also create this?' — the user " +
    "already asked you to. " +
    // The stall to kill: the model saying "let me do that now" WITHOUT emitting the
    // tool call, forcing the user to prod it. Announce and act in the same turn.
    "CRUCIAL: the moment you decide to act (and the user has given the go-ahead), CALL the function in that SAME " +
    "reply. Never end your turn with only a statement of intent like 'let me do that now' or 'one moment' and then " +
    "stop — if you say you will do it, do it in the same response. The user must never have to ask you to proceed " +
    "with an action you already announced. " +
    // Status machines: a record usually can't jump straight to a terminal state.
    "For a status change, move ONE valid step along the lifecycle described in the action (e.g. a DRAFT proposal goes " +
    "to IN_REVIEW before SENT); never skip states — if unsure of the current state, read it first." +
    // ── Human-readable rule (strengthened) ──
    // The user consistently reports that raw database language is unacceptable.
    // Every field name, column name, table name and internal identifier must be
    // translated to business language before it reaches the user.
    "LANGUAGE RULES — these are absolute: " +
    "• NEVER show snake_case field names (say 'payment terms' not 'payment_terms_days'). " +
    "• NEVER show UUIDs, internal IDs, or database column names. " +
    "• NEVER say 'I cannot find' or 'missing field X' — if a value is unclear, ask the user " +
    "  in plain language ('which client is this for?') instead of reporting a technical error. " +
    "• When ALL the information the user provided is sufficient, USE IT — do not claim fields " +
    "  are missing when the user has already told you the values. Map what they said to the " +
    "  action's fields. " +
    "• If an action fails because of a field mapping issue, try to FIX the mapping yourself " +
    "  (e.g. look up the client by name to get their ID) before telling the user it failed. " +
    whoIsAsking(user) +
    patternBlock +
    feedbackBlock +
    prefsBlock +
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
  if (!res.toolCalls.length && isStall(res.text || "")) {
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

  /**
   * What every read actually returned — the ground truth behind the citations
   * under the answer and the steps in its trace (`answer-sources.js`).
   *
   * Captured HERE, unredacted and uncapped, and not recovered later from the
   * tool messages: those are truncated to 6 000 characters and scrubbed for
   * egress to the model, so a row count taken from them would be a count of what
   * survived the cap, not of what was read. Nothing in this array reaches a
   * model — only a label, a route and a row count reach the browser.
   *
   * It accumulates ACROSS ROUNDS, so a two-hop answer cites both hops.
   */
  const readTrace = [];

  /**
   * Every piece of prose the model produced this turn, in order.
   *
   * ACCUMULATED, NOT REPLACED — this is the other half of the bug the loop
   * fixes. The old code did `answer = followup.text || answer`, so the narration
   * after a read DISCARDED whatever the model had already said. In the streaming
   * path that text had been rendered to the user token by token; replacing it
   * meant the reply visibly vanished the moment the trace arrived, and the
   * transcript was persisted missing the part the user had actually read.
   * Whatever was shown is what is stored.
   */
  const answerParts = [];

  /**
   * THE LOOP (see `MAX_TOOL_ROUNDS`).
   *
   * Each round: split this response's calls into reads and writes, keep its
   * prose, run the reads, feed the rows back, ask again. It stops when the model
   * stops calling reads — which is the model saying it has what it needs.
   *
   * A WRITE ENDS THE CHAIN. A proposed write is a question to the user, not a
   * step the assistant may take, so the round that proposes one is the last: its
   * reads still run (they are what the write's payload was built from), the
   * model gets one toolless pass to explain itself, and the turn ends on the
   * action card awaiting a human.
   */
  const convo = [...messages];
  let current = res;
  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    const roundReads = [];
    for (const call of current.toolCalls || []) {
      const def = defFor(call);
      if (!def) continue;
      (def.is_write ? writeCalls : roundReads).push({ call, def });
    }
    if (current.text && current.text.trim()) answerParts.push(current.text.trim());
    if (!roundReads.length || !registry) break;

    const toolMsgs = [];
    for (const { call, def } of roundReads) {
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

    // The assistant message lists only the READ calls, because only those have
    // tool results below it — a tool_call without a matching tool message is a
    // malformed request to every provider.
    convo.push(
      { role: "assistant", content: current.text || null, tool_calls: roundReads.map((r) => r.call) },
      ...toolMsgs,
    );

    const finalPass = round === MAX_TOOL_ROUNDS || writeCalls.length > 0;
    current = await llm.chat({
      client,
      messages: convo,
      ...(finalPass ? {} : { tools: offered.map(toOpenAiTool) }),
    });
    await recordUsage(client, { user, conversationId: history.conversationId, res: current, feature });
    if (finalPass) {
      if (current.text && current.text.trim()) answerParts.push(current.text.trim());
      break;
    }
  }

  const answer = answerParts.join("\n\n") || res.text;

  /**
   * Grounding, from the reads rather than from the prose.
   *
   * COMPUTED BEFORE THE SAVE (0521), which is why it sits here rather than
   * beside the return. The citations and the answer are one fact about one turn;
   * writing the prose now and the provenance never meant a reopened conversation
   * came back stripped of everything that made its figures checkable.
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

  // Persist the exchange AFTER the answer is finalised (post read-narration), so
  // the stored assistant turn is what the user actually saw — not the empty text
  // of a turn that only made tool calls. Best-effort; never blocks the response.
  await history_.save(client, {
    conversationId: history.conversationId,
    question: message,
    answer: answer || null,
    sources,
    trace,
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

  // Both grounding fields are OMITTED from the response when empty rather than
  // sent as `[]`, because the client renders on presence: the trace disclosure
  // and the sources footer both test length, and an answer that consulted
  // nothing should show nothing rather than an empty "Trace · 0 steps".
  // `AskResult.sources` / `.trace` are already optional on the wire
  // (`client/src/lib/ai-api.ts`). The COLUMNS keep `[]`, which is a different
  // statement — see 0521 on why absent and empty are not the same fact.

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
  //
  // LENIENT: same relaxed validation as the propose step — required fields
  // only, unknown keys allowed. The form may submit fields the schema doesn't
  // declare (e.g. the model's original pre-fill carried extra keys the user
  // didn't edit). The executor destructures what it needs.
  let payload = run.proposed_payload;
  if (edited && typeof edited === "object") {
    const { rows: cat } = await client.query(
      "SELECT payload_schema FROM ai_action_catalogue WHERE action_key=$1",
      [run.action_key],
    );
    // FAIL CLOSED on a missing catalogue row: if the action was removed from
    // the catalogue between propose and confirm, we don't execute — the safe
    // reading of "no schema found" is "this action no longer exists".
    if (!cat[0]) throw new Error(`action '${run.action_key}' no longer in catalogue`);
    const errs = validatePayload(cat[0].payload_schema, edited);
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

  // ── Post-execution auto-continue ──
  // THE SNOOZE FIX. The old narration confirmed what was done and then asked
  // "shall I proceed with the next step?" — forcing the user to type "yes"
  // before the assistant proposed the next action. That was the core of the
  // snooze loop: confirm → "shall I?" → "yes" → propose → confirm → "shall I?"
  // → "yes" → … Each step cost TWO user interactions instead of one.
  //
  // Now: the narration confirms what was done, recaps progress, and PROPOSES
  // the next step directly (as a new action card if applicable). The user
  // confirmed the first step, which is consent to continue the task. If there
  // is a clear next step, it is proposed immediately — no question, no wait.
  //
  // We still use a non-tool call for the NARRATION (the text), but the next
  // action proposal comes from a FOLLOW-UP ask turn that runs automatically.
  // Best-effort: a narration failure never fails the executed action.
  let message = null;
  let nextActions = [];
  try {
    if (run.conversation_id) {
      // Smaller history window for narration (audit 3.8) — 5 turns instead
      // of 20. The narration only needs recent context to recap progress.
      const hist = await convo.recentMessages(client, run.conversation_id, NARRATION_TURNS);
      // Brief factual narration — no tools, just text. Confirms what was done
      // and recaps progress. The NEXT step is auto-proposed below.
      const sys =
        "You are Praxis LS, carrying out a step-by-step task for the user. An action was JUST executed " +
        "successfully. Reply in 1-2 short sentences of plain business language (never show UUIDs or " +
        "snake_case field names): confirm what was done, naming the record; then briefly recap what has " +
        "been completed so far. Do NOT ask the user if they want to continue — they do. Do NOT propose " +
        "next steps in this message — those come separately.";
      const nar = await llm.chat({
        client,
        temperature: 0.3,
        messages: [
          { role: "system", content: sys },
          ...hist.map((m) => ({ role: m.role, content: redact(m.content) })),
        ],
      });
      message = nar.text || null;
      await recordUsage(client, { user, conversationId: run.conversation_id, res: nar, feature: "assistant" });
      if (message) await convo.addMessage(client, { conversationId: run.conversation_id, role: "assistant", content: message });

      // ── Auto-propose the next step ──
      // Instead of waiting for the user to say "yes, continue", we run a
      // follow-up ask with a synthetic message that tells the model to propose
      // whatever comes next. This eliminates the snooze loop entirely.
      const autoMsg = "The previous action was just executed successfully. If there is a clear next step in this task, propose it now as an action. If the task is complete, just say so briefly.";
      const followUp = await ask({ client, user, conversationId: run.conversation_id, message: autoMsg, allowed: undefined, registry, feature: "assistant" });
      if (followUp.actions && followUp.actions.length) {
        nextActions = followUp.actions;
        // The follow-up's answer text rides with the narration.
        if (followUp.answer && message) message = message + "\n\n" + followUp.answer;
        else if (followUp.answer) message = followUp.answer;
      } else if (followUp.answer) {
        // No next action — the task is complete or the model chose to just narrate.
        message = message ? message + "\n\n" + followUp.answer : followUp.answer;
        if (followUp.answer) await convo.addMessage(client, { conversationId: run.conversation_id, role: "assistant", content: followUp.answer });
      }
    }
  } catch (err) {
    logger.warn({ err, actionRunId }, "[ai] post-action narration skipped");
  }

  return { ok: true, result, message, next_actions: nextActions };
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

/**
 * Streaming variant of `ask`. Yields SSE-shaped events the controller forwards
 * to the client:
 *   { type: "delta",   text }               — incremental text token
 *   { type: "answer",  text }               — final, complete answer text
 *   { type: "actions", actions, batch_id }   — proposed write action cards
 *   { type: "sources", sources }             — grounding citations
 *   { type: "trace",   trace }              — reasoning steps
 *   { type: "done",    conversation_id }     — turn complete
 *   { type: "error",   message }            — recoverable error
 *
 * The read-tool narration and anti-stall nudge still use the non-streaming
 * `llm.chat` (they are bounded, tool-heavy calls where streaming adds latency
 * without visible benefit — the user sees nothing until the narration is
 * complete). Only the INITIAL model call streams, because that is the one the
 * user stares at while waiting.
 */
async function* askStream({ client, user, conversationId, message, allowed, registry, feature = "assistant" }) {
  const gate = await governance.canUseFeature(client, { userId: user.user_id, featureKey: feature });
  if (!gate.allowed) {
    yield { type: "error", message: `The AI assistant is unavailable: ${gate.reason}.` };
    yield { type: "done" };
    return;
  }

  const hits = await retrieve({ query: message, tenantClient: client, allowed, k: 6 });
  const tools = await loadTools(client);
  // Self-learning: recent successful execution patterns.
  const patterns = await recentPatterns(client);
  const patternBlock = patterns.length
    ? "\n\nPATTERNS YOU HAVE SUCCESSFULLY EXECUTED (use these as templates when the user asks for something similar):\n" +
      patterns.map((p, i) => `  ${i + 1}. ${p.action} → fields: ${p.fields.join(", ")}${p.ref ? ` (${p.ref})` : ""}`).join("\n")
    : "";

  // ── Self-improvement: recent negative feedback ──
  const feedback = await recentNegativeFeedback(client);
  const feedbackBlock = feedback.length
    ? "\n\nPATTERNS USERS DISLIKED (avoid these mistakes — users left specific feedback):\n" +
      feedback.map((f, i) => `  ${i + 1}. User said: "${f.comment}"${f.actions.length ? ` (on actions: ${f.actions.join(", ")})` : ""}`).join("\n")
    : "";

  // ── Per-user preferences ──
  const prefs = await userPreferences(client, user.user_id);
  const prefsBlock = Object.keys(prefs).length
    ? "\n\nUSER PREFERENCES (tailor your output to these):\n" +
      Object.entries(prefs).map(([k, v]) => `  • ${k}: ${v}`).join("\n")
    : "";

  const system =
    "You are Praxis LS, an OHADA-aware logistics ERP assistant. Ground answers in the CONTEXT. " +
    "Only call a function when the user asks to DO something; never invent data. " +
    "A question or request to SEE/LIST/COUNT/CHECK/SUMMARISE data is a READ — use a list_/get_ action (or just " +
    "answer); NEVER a create_/update_/record_ write. Propose a write ONLY when the user explicitly asks to create, " +
    "change, advance, record, or post something. 'How many X are there' means list_X, not create_X. " +
    "When filtering or fetching a record, use its internal id (the UUID from a previous read), NOT a human " +
    "reference like a vehicle registration, ref, or code — those won't match an id filter. " +
    "You act with the user's permissions and cannot exceed them. " +
    "Speak in plain business language. Refer to records by their name or human reference " +
    "(a dossier by its ref e.g. SBX-2026-0001, a client or lead by its name), and use natural " +
    "field names (\"payment terms\", not \"payment_terms_days\"). NEVER show the user raw database " +
    "identifiers (UUIDs like d69be65d-…), internal id columns, or snake_case field names unless they " +
    "explicitly ask for an ID. When confirming an action you took, name the record, not its UUID. " +
    // ── KEY CHANGE: auto-continue after each step, no waiting for go-ahead ──
    // The old prompt said "wait for their go-ahead before proposing the next" which
    // created the snooze loop: propose → confirm → "shall I proceed?" → user says
    // "yes" → propose → confirm → … Every cycle wasted a user turn on "yes".
    // Now: after proposing an action you WAIT for confirmation (that's the safety
    // property), but once confirmed the NEXT step is proposed in the SAME reply.
    "When a task needs several actions, propose the FIRST action and wait for the user to " +
    "confirm it. Once it is confirmed, IMMEDIATELY propose the next step — do not ask 'shall I " +
    "proceed?' or 'would you like me to continue?'. Just do it. The user confirmed once, which " +
    "means they want the task done. " +
    // ── Draft → execute in one flow ──
    // When the user says "draft and execute", "create and submit", "prepare and send" — they
    // want BOTH steps, not a draft followed by a question. Draft the document as prose, then
    // IMMEDIATELY propose the corresponding write action with all the details from your draft
    // already filled in. The user sees the draft AND the action card together.
    "When the user asks you to 'draft and execute', 'create and submit', 'prepare and send' or " +
    "any combination of writing something AND recording it: first write the document as your " +
    "answer text, then IMMEDIATELY call the appropriate write function with the details from " +
    "your draft. Do not stop after drafting to ask 'shall I also create this?' — the user " +
    "already asked you to. " +
    "CRUCIAL: the moment you decide to act (and the user has given the go-ahead), CALL the function in that SAME " +
    "reply. Never end your turn with only a statement of intent like 'let me do that now' or 'one moment' and then " +
    "stop — if you say you will do it, do it in the same response. The user must never have to ask you to proceed " +
    "with an action you already announced. " +
    "For a status change, move ONE valid step along the lifecycle described in the action (e.g. a DRAFT proposal goes " +
    "to IN_REVIEW before SENT); never skip states — if unsure of the current state, read it first." +
    // ── Human-readable rule (strengthened) ──
    "LANGUAGE RULES — these are absolute: " +
    "• NEVER show snake_case field names (say 'payment terms' not 'payment_terms_days'). " +
    "• NEVER show UUIDs, internal IDs, or database column names. " +
    "• NEVER say 'I cannot find' or 'missing field X' — if a value is unclear, ask the user " +
    "  in plain language ('which client is this for?') instead of reporting a technical error. " +
    "• When ALL the information the user provided is sufficient, USE IT — do not claim fields " +
    "  are missing when the user has already told you the values. Map what they said to the " +
    "  action's fields. " +
    "• If an action fails because of a field mapping issue, try to FIX the mapping yourself " +
    "  (e.g. look up the client by name to get their ID) before telling the user it failed. " +
    whoIsAsking(user) +
    patternBlock +
    feedbackBlock +
    prefsBlock +
    "\n\nCONTEXT:\n" +
    redact(toContextBlock(hits));

  // ── Conversation memory (same as non-streaming) ──
  const resolvedId = conversationId || (await history_.currentId(client, user));
  await history_.condense(client, { user, conversationId: resolvedId, feature });
  const history = await history_.load(client, { user, conversationId: resolvedId });
  const messages = [
    { role: "system", content: system },
    ...(history.summary
      ? [{ role: "system", content: "EARLIER IN THIS CONVERSATION (summary of turns no longer replayed in full):\n" + redact(history.summary) }]
      : []),
    ...history.turns.map((m) => ({ role: m.role, content: redact(m.content) })),
    { role: "user", content: redact(message) },
  ];

  const contextText = [message, ...history.turns.map((m) => m.content || "")].join(" ");
  const offered = selectTools(tools, contextText);

  // ── Stream the initial model call ──
  let fullText = "";
  let finalToolCalls = [];
  let finalUsage = {};
  let provider = null;

  for await (const chunk of llm.chatStream({ client, messages, tools: offered.map(toOpenAiTool), onDelta: (d) => { fullText += d; } })) {
    if (!chunk.done) {
      yield { type: "delta", text: chunk.delta };
    } else {
      fullText = chunk.text || fullText;
      finalToolCalls = chunk.toolCalls || [];
      finalUsage = chunk.usage || {};
      provider = chunk.provider;
    }
  }
  await recordUsage(client, { user, conversationId: history.conversationId, res: { text: fullText, toolCalls: finalToolCalls, usage: finalUsage, provider }, feature });

  // ── Anti-stall (non-streaming, same as ask) ──
  let nudged = false;
  if (!finalToolCalls.length && isStall(fullText || "")) {
    const retry = await llm.chat({
      client,
      messages: [
        ...messages,
        { role: "assistant", content: fullText || "" },
        { role: "user", content: "Proceed NOW: if this needs an action, call the function in THIS reply; otherwise give the answer directly. Do not just say you will." },
      ],
      tools: offered.map(toOpenAiTool),
    });
    await recordUsage(client, { user, conversationId: history.conversationId, res: retry, feature });
    if (retry.toolCalls.length || (retry.text && retry.text.trim())) {
      // The retry replaces the stalled text. Emit a clear + the new text.
      yield { type: "delta", text: "\n\n" + (retry.text || "") };
      fullText = (fullText || "") + "\n\n" + (retry.text || "");
      finalToolCalls = retry.toolCalls;
      nudged = true;
    }
  }

  // ── Split reads and writes (same logic as ask) ──
  const defFor = (call) => tools.find((t) => t.action_key === call.function.name);
  const availableReads = new Set(tools.filter((t) => !t.is_write).map((t) => t.action_key));
  const writeCalls = [];
  const readTrace = [];

  /**
   * THE STREAMING INVARIANT, and the whole of bug #2.
   *
   * Every delta yielded here must survive into `answer`, because `answer` is
   * what the final `{type:"answer"}` event carries and the client applies that
   * as the turn's text. The old code streamed the post-read narration as a delta
   * (append) and then set `answer = followup.text` (replace) — so the moment the
   * closing events landed, everything the user had watched arrive was wiped and
   * replaced by the last paragraph alone. The same truncated text was persisted,
   * so reopening the thread showed the damage permanently.
   *
   * Parts in, parts out: what is streamed is what is answered is what is stored.
   */
  const answerParts = [];
  if (fullText && fullText.trim()) answerParts.push(fullText.trim());

  // ── The agent loop. Mirrors `ask` exactly; see MAX_TOOL_ROUNDS. ──
  const convo = [...messages];
  let current = { text: fullText, toolCalls: finalToolCalls };
  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    const roundReads = [];
    for (const call of current.toolCalls || []) {
      const def = defFor(call);
      if (!def) continue;
      (def.is_write ? writeCalls : roundReads).push({ call, def });
    }
    // Round 1's text is already in `answerParts` (it was streamed above); later
    // rounds are added when their delta is yielded, so this never double-counts.
    if (!roundReads.length || !registry) break;

    const toolMsgs = [];
    for (const { call, def } of roundReads) {
      let payload = {};
      try { payload = JSON.parse(call.function.arguments || "{}"); } catch { payload = {}; }
      let content;
      const step = { actionKey: def.action_key, payload, result: null, failed: false, error: null };
      try {
        await actionAuthz.assertAllowed(client, user, def);
        const fn = registry[def.action_key];
        const out = fn ? await fn({ client, user, payload }) : { error: "no executor" };
        step.result = out && out.data !== undefined ? out.data : out;
        if (!fn) { step.failed = true; step.error = "no executor"; }
        content = JSON.stringify(step.result);
      } catch (err) {
        step.failed = true;
        step.error = err.message;
        content = JSON.stringify({ error: err.message });
      }
      readTrace.push(step);
      toolMsgs.push({ role: "tool", tool_call_id: call.id, content: redact(content).slice(0, 6000) });
    }

    convo.push(
      { role: "assistant", content: current.text || null, tool_calls: roundReads.map((r) => r.call) },
      ...toolMsgs,
    );

    const finalPass = round === MAX_TOOL_ROUNDS || writeCalls.length > 0;
    current = await llm.chat({
      client,
      messages: convo,
      ...(finalPass ? {} : { tools: offered.map(toOpenAiTool) }),
    });
    await recordUsage(client, { user, conversationId: history.conversationId, res: current, feature });

    // Yield and record in the same breath, so the two can never disagree.
    if (current.text && current.text.trim()) {
      yield { type: "delta", text: "\n\n" + current.text.trim() };
      answerParts.push(current.text.trim());
    }
    if (finalPass) break;
  }

  const answer = answerParts.join("\n\n");

  // Grounding is built BEFORE the save (0521) so the stored turn carries its own
  // provenance. It is emitted further down, in the closing events, because the
  // client wants the prose on screen before the citations under it.
  const sources = buildSources(readTrace);
  const trace = buildTrace({
    reads: readTrace,
    writes: writeCalls.map(({ def }) => ({ actionKey: def.action_key })),
    recalled: hits.length,
    nudged,
  });

  // Persist the exchange.
  await history_.save(client, {
    conversationId: history.conversationId,
    question: message,
    answer: answer || null,
    sources,
    trace,
  });

  // ── Writes: action cards ──
  const actions = [];
  const batchId = writeCalls.length ? crypto.randomUUID() : null;
  for (const { call, def } of writeCalls) {
    let payload = {};
    try { payload = JSON.parse(call.function.arguments || "{}"); } catch { payload = {}; }
    // LENIENT VALIDATION. The old validatePayload rejected unknown keys — if the
    // model sent `client_name` instead of `client_id`, the action was rejected as
    // having an unknown field. This is what made the assistant "confuse itself":
    // it had all the details, used human-friendly field names, and got told they
    // were wrong. Now: only REQUIRED fields are enforced. Unknown fields pass
    // through and the executor ignores them (services destructure what they need).
    const errs = [];
    for (const req of (def.payload_schema && def.payload_schema.required) || []) {
      if (payload[req] === undefined || payload[req] === null || payload[req] === "") errs.push(`missing '${req}'`);
    }
    const status = errs.length ? "VALIDATION_FAILED" : "AWAITING_CONFIRM";
    const run = await client.query(
      `INSERT INTO ai_action_run (conversation_id, user_id, action_key, proposed_payload, status, validation_error, batch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING action_run_id`,
      [history.conversationId || null, user.user_id, def.action_key, payload, status, errs.join("; ") || null, batchId],
    );
    actions.push({
      action_run_id: run.rows[0].action_run_id,
      action_key: def.action_key,
      payload,
      requires_confirmation: def.requires_confirmation,
      validation_errors: errs,
      schema: def.payload_schema,
      field_meta: buildFieldMeta(def.payload_schema, availableReads),
    });
  }

  // Emit the final events.
  yield { type: "answer", text: answer };
  if (actions.length) yield { type: "actions", actions, batch_id: batchId };

  if (sources.length) yield { type: "sources", sources };
  if (trace.length) yield { type: "trace", trace };

  yield { type: "done", conversation_id: history.conversationId, provider };
}

module.exports = { ask, askStream, confirmAction, confirmBatch, loadTools };
