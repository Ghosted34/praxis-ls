/**
 * On-demand AI explanation of an error (spec §7).
 *
 * Deliberately reuses `services/ai/llm.service.chat()` rather than calling a
 * provider directly: that module already implements the DeepSeek-primary /
 * Gemini-fallback chain §7.4 asks for, sourcing keys from the encrypted
 * platform.ai_vendor_credential store. A second HTTP client here would mean two
 * places to rotate a key and two places to get the fallback wrong.
 *
 * THREE CACHE TIERS, keyed on signature and not error_id
 *
 *   The same fault in two tenants is the same explanation. Keying on error_id
 *   would pay the model once per tenant for one answer.
 *
 *   1. Redis, 1h TTL (§7.5) — absorbs the "everyone clicks Explain during an
 *      incident" burst.
 *   2. platform.error_explanation — durable, survives a cache flush and a
 *      deploy, and is what the detail drawer renders on first paint without
 *      spending a token.
 *   3. `force` bypasses both, for the mockup's [Regenerate] button.
 *
 * WHAT IS SENT TO THE MODEL
 *
 *   Message, parsed frames, module, route, counts. NOT `context` — that carries
 *   request_id, user_id and browser URL, and §11 requires error data be
 *   sanitised of PII before it leaves. The stack is truncated to the frames
 *   that identify the fault; a 40-frame trace does not explain better than 12.
 */

"use strict";

const { logger } = require("../../config/logger");
const db = require("./db");
const { AppError } = require("../../utils/errors");
const llm = require("../ai/llm.service");

const CACHE_TTL_SECONDS = 3600;
const CACHE_PREFIX = "err:explain:";
const PROMPT_VERSION = 1;
const MAX_FRAMES = 12;

/** Spec §7.4, verbatim — the contract the explanation format is tested against. */
const SYSTEM_PROMPT = `You are an expert backend developer specializing in Node.js/NestJS debugging.
Explain this error in plain English for a non-technical ops team lead. Include:
1. What happened (one sentence)
2. Why it happened (technical cause)
3. Which module/function is responsible
4. Suggested fix (code snippet if applicable)

Format your response in clear sections. Keep explanations concise but actionable.`;

function redis() {
  try {
     
    return require("../../config/redis").getClient();
  } catch {
    // Redis absent (tests, a worker without it): fall through to the DB tier.
    return null;
  }
}

async function fromRedis(signature) {
  const c = redis();
  if (!c) return null;
  try {
    const hit = await c.get(CACHE_PREFIX + signature);
    return hit ? JSON.parse(hit) : null;
  } catch {
    return null;
  }
}

async function toRedis(signature, value) {
  const c = redis();
  if (!c) return;
  try {
    await c.set(CACHE_PREFIX + signature, JSON.stringify(value), "EX", CACHE_TTL_SECONDS);
  } catch {
    /* caching is best-effort */
  }
}

/** Build the user-turn context payload described in §7.3. */
function buildContext(row) {
  const frames = Array.isArray(row.stack_trace) ? row.stack_trace.slice(0, MAX_FRAMES) : [];
  const chain = frames
    .map((f) => `  [${f.index}] ${f.file || "?"}:${f.line || "?"} → ${f.function || "?"}`)
    .join("\n");

  return [
    `Error: ${row.name || "Error"}: ${row.message}`,
    `Level: ${row.level}`,
    `Origin: ${row.origin}`,
    row.module ? `Module: ${row.module}` : null,
    row.route ? `Route: ${row.route}` : null,
    row.file_path ? `Location: ${row.file_path}:${row.line_number || "?"}` : null,
    `Occurrences: ${row.occurrence_count}`,
    `First seen: ${row.first_seen}`,
    `Last seen: ${row.last_seen}`,
    chain ? `\nStack trace:\n${chain}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {object} opts
 * @param {string} opts.errorId
 * @param {string} [opts.actorId] platform user requesting it
 * @param {boolean} [opts.force] bypass both caches (Regenerate)
 */
async function explain({ errorId, actorId = null, force = false }) {
  const { rows } = await db.query(
    `SELECT error_id, signature, level, origin, name, message, module, route,
            file_path, line_number, occurrence_count, first_seen, last_seen, stack_trace
       FROM platform.error_event WHERE error_id = $1`,
    [errorId],
  );
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", "Error not found", 404);

  if (!force) {
    const cached = await fromRedis(row.signature);
    if (cached) return { ...cached, cached: true, source: "redis" };

    const stored = await db.query(
      `SELECT explanation, generated_by, model, created_at
         FROM platform.error_explanation WHERE signature = $1`,
      [row.signature],
    );
    if (stored.rows[0]) {
      const value = {
        signature: row.signature,
        explanation: stored.rows[0].explanation,
        generated_by: stored.rows[0].generated_by,
        model: stored.rows[0].model,
        generated_at: stored.rows[0].created_at,
      };
      await toRedis(row.signature, value);
      return { ...value, cached: true, source: "db" };
    }
  }

  const result = await llm.chat({
    client: null,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildContext(row) },
    ],
    temperature: 0.2,
  });

  // llm.chat returns a STUB with provider:null when no vendor is configured.
  // Storing that would poison the cache with an apology, and every later call
  // would serve it back as a real explanation.
  if (!result.provider) {
    throw new AppError(
      "AI_UNAVAILABLE",
      "No AI provider is configured. Add DeepSeek or Gemini credentials under Integrations → AI providers.",
      503,
    );
  }

  const value = {
    signature: row.signature,
    explanation: result.text,
    generated_by: result.provider,
    model: null,
    generated_at: new Date().toISOString(),
  };

  try {
    await db.query(
      `INSERT INTO platform.error_explanation
         (signature, explanation, generated_by, model, prompt_version, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (signature) DO UPDATE
         SET explanation = EXCLUDED.explanation,
             generated_by = EXCLUDED.generated_by,
             prompt_version = EXCLUDED.prompt_version,
             requested_by = EXCLUDED.requested_by,
             updated_at = now()`,
      [row.signature, value.explanation, value.generated_by, value.model, PROMPT_VERSION, actorId],
    );
  } catch (err) {
    // The explanation is already generated and useful; failing to file it away
    // should not deny it to the person who asked.
    logger.warn({ err, signature: row.signature }, "failed to persist error explanation");
  }

  await toRedis(row.signature, value);
  return { ...value, cached: false, source: "live" };
}

module.exports = { explain, SYSTEM_PROMPT, CACHE_TTL_SECONDS };
