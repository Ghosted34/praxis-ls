/**
 * LLM chat + function-calling. Vendor-agnostic, platform-first: creds/endpoint/
 * model come from the ONE shared, encrypted platform.ai_vendor_credential set via
 * platformVendors.getConfig(vendor). If a vendor isn't configured there, we fall
 * back to .env (BUILD_CONVENTIONS §7: DB-first, env-fallback). If
 * neither is set, the call degrades to a clear stub. All vendors here speak the
 * OpenAI-compatible /chat/completions shape.
 */
"use strict";

const axios = require("axios");
const { config } = require("../../config/env");
const platformVendors = require("../platform/ai-vendor.service");
const { logger } = require("../../config/logger");

const PRIMARY = "deepseek";
const FALLBACK = "gemini";

// .env fallback vendors (OpenAI-compatible endpoints only).
const ENV_VENDORS = {
  deepseek: { vendor: "deepseek", api_key: config.DEEPSEEK_API_KEY, endpoint_url: config.DEEPSEEK_BASE_URL, model: config.DEEPSEEK_MODEL },
  openai: { vendor: "openai", api_key: config.OPENAI_API_KEY, endpoint_url: config.OPENAI_BASE_URL, model: config.OPENAI_MODEL },
};

/** Platform-first, env-fallback vendor config for a chat vendor, or null. Keys
 *  are the ONE shared deploy-wide set (platform.ai_vendor_credential); `client`
 *  is kept for signature compatibility but no longer sources the key. */
async function resolveVendor(client, name) {
  const db = await platformVendors.getConfig(name);
  if (db && db.is_active !== false && db.api_key && db.endpoint_url) return db;
  const env = ENV_VENDORS[name];
  if (env && env.api_key && env.endpoint_url) return env;
  return null;
}

// Some models (notably DeepSeek, esp. when handed a large tool list) emit their
// tool-call markup as TEXT in `content` instead of the structured `tool_calls`
// field — e.g. `<｜…DSML…｜>invoke name="…"<parameter name="…">…`. Left as-is it
// leaks raw markup to the user and the real action never runs. This recovers any
// parsable calls and, either way, strips the markup so the user never sees it.
// Anchored on the actual markup characters — the full-width pipe (｜), the ▁
// token DeepSeek uses, the literal DSML marker, or an `invoke name="` tag — so it
// never false-triggers on prose that merely says "tool calls".
const TOOLCALL_MARKUP = /[｜▁]|DSML|invoke\s+name="/i;

function extractInlineToolCalls(content) {
  if (!content || !TOOLCALL_MARKUP.test(content)) return { toolCalls: [], text: content || "" };
  const calls = [];
  const invokeRe = /invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/[^>]*?invoke\s*>/gi;
  let m;
  while ((m = invokeRe.exec(content))) {
    const args = {};
    const paramRe = /parameter\s+name="([^"]+)"[^>]*?>([\s\S]*?)<\/[^>]*?parameter\s*>/gi;
    let pm;
    while ((pm = paramRe.exec(m[2]))) args[pm[1]] = pm[2].trim();
    calls.push({ id: `inline_${calls.length}`, type: "function", function: { name: m[1], arguments: JSON.stringify(args) } });
  }
  // Cut everything from the first markup marker to the end, then remove any
  // residual angle-bracket/pipe tokens, so the visible text is clean prose.
  const text = content
    .replace(/(?:<[^>]*)?(?:[｜▁]{1,2}\s*DSML|invoke\s+name="|[｜▁]\s*tool)[\s\S]*$/i, "")
    .replace(/<\/?[^>]*>/g, "")
    .replace(/[｜▁]/g, "")
    .trim();
  return { toolCalls: calls, text };
}

async function callVendor(vendor, { messages, tools, temperature }) {
  const base = String(vendor.endpoint_url).replace(/\/$/, "");
  const body = { model: vendor.model, messages, temperature };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }
  const { data } = await axios.post(`${base}/chat/completions`, body, {
    headers: { Authorization: `Bearer ${vendor.api_key}`, "Content-Type": "application/json" },
    timeout: 60000,
  });
  const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
  let toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  let text = msg.content || "";
  // Only salvage from text when the provider didn't already return structured calls.
  if (!toolCalls.length && TOOLCALL_MARKUP.test(text)) {
    const inline = extractInlineToolCalls(text);
    toolCalls = inline.toolCalls;
    text = inline.text;
  }
  return { provider: vendor.vendor, text, toolCalls, usage: data.usage || {} };
}

/**
 * Streaming vendor call — yields `{ delta, done, toolCalls, text, usage }` chunks
 * as the model generates them. The caller (orchestrator) forwards `delta` events
 * to the client over SSE so the answer renders word-by-word instead of waiting
 * for the full completion.
 *
 * WHY THIS EXISTS. The user's most consistent performance complaint is that the
 * assistant "thinks" for 5–15 seconds and then dumps the whole answer at once.
 * Streaming starts rendering the first token within ~500ms, which is the
 * difference between "this is slow" and "this is typing". Tool calls (reads,
 * proposed writes) are still buffered — they arrive as discrete events once the
 * model finishes generating, because the client needs the full call to render
 * an action card or execute a read.
 *
 * FALLBACK. When the vendor does not support streaming (or the stream errors),
 * we fall back to the non-streaming `callVendor` and emit a single chunk with
 * the complete text. The orchestrator treats this identically to a stream that
 * produced one delta.
 */
async function* callVendorStream(vendor, { messages, tools, temperature }) {
  const base = String(vendor.endpoint_url).replace(/\/$/, "");
  const body = { model: vendor.model, messages, temperature, stream: true };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }

  let response;
  try {
    response = await axios.post(`${base}/chat/completions`, body, {
      headers: { Authorization: `Bearer ${vendor.api_key}`, "Content-Type": "application/json" },
      timeout: 120000,
      responseType: "stream",
    });
  } catch (err) {
    // Stream not supported or network error — fall back to non-streaming.
    logger.warn({ err, vendor: vendor.vendor }, "streaming vendor call failed, falling back");
    const result = await callVendor(vendor, { messages, tools, temperature });
    yield { delta: result.text, done: true, toolCalls: result.toolCalls, text: result.text, usage: result.usage, provider: vendor.vendor };
    return;
  }

  let text = "";
  const toolCallBuffers = new Map(); // index → { id, type, function: { name, arguments } }
  let usage = {};

  // Parse SSE lines from the response stream.
  const stream = response.data;
  for await (const rawChunk of stream) {
    const chunk = typeof rawChunk === "string" ? rawChunk : rawChunk.toString("utf8");
    const lines = chunk.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") {
        // Finalize tool calls from buffers.
        const toolCalls = Array.from(toolCallBuffers.values()).map((tc) => ({
          id: tc.id,
          type: tc.type || "function",
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
        // If no structured tool calls, try to recover inline ones from text.
        const finalToolCalls = toolCalls.length ? toolCalls : (TOOLCALL_MARKUP.test(text) ? extractInlineToolCalls(text).toolCalls : []);
        const finalText = toolCalls.length ? text : (TOOLCALL_MARKUP.test(text) ? extractInlineToolCalls(text).text : text);
        yield { delta: "", done: true, toolCalls: finalToolCalls, text: finalText, usage, provider: vendor.vendor };
        return;
      }
      try {
        const json = JSON.parse(payload);
        const delta = (json.choices && json.choices[0] && json.choices[0].delta) || {};
        if (json.usage) usage = json.usage;

        // Text delta — yield immediately for client rendering.
        if (delta.content) {
          text += delta.content;
          yield { delta: delta.content, done: false };
        }

        // Tool call deltas — buffer until complete.
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallBuffers.has(idx)) {
              toolCallBuffers.set(idx, { id: tc.id || `tc_${idx}`, type: "function", function: { name: "", arguments: "" } });
            }
            const buf = toolCallBuffers.get(idx);
            if (tc.id) buf.id = tc.id;
            if (tc.function) {
              if (tc.function.name) buf.function.name += tc.function.name;
              if (tc.function.arguments) buf.function.arguments += tc.function.arguments;
            }
          }
        }
      } catch {
        // Malformed SSE line — skip silently (common with some vendors).
      }
    }
  }

  // Stream ended without [DONE] — emit what we have.
  const toolCalls = Array.from(toolCallBuffers.values()).map((tc) => ({
    id: tc.id, type: tc.type || "function", function: { name: tc.function.name, arguments: tc.function.arguments },
  }));
  yield { delta: "", done: true, toolCalls, text, usage, provider: vendor.vendor };
}

const STUB = {
  provider: null,
  text: "The AI assistant has no chat provider configured yet. An administrator can add one under AI Control > Vendors.",
  toolCalls: [],
  usage: {},
};

/**
 * Classify a vendor error as transient (timeout, 5xx, network → safe to
 * fallback) or configuration (401, 403, 404 → the key/endpoint is wrong and
 * falling back hides it). Audit 3.6: the old code silently fell back on
 * every error, so a misconfigured primary key was invisible — every call
 * quietly used the fallback vendor with a different cost structure.
 *
 * Returns "transient" for errors that should trigger fallback, "config" for
 * errors that should be logged loudly and NOT fall back (the operator needs
 * to see this).
 */
function classifyVendorError(err) {
  const status = err.response && err.response.status;
  // 401/403 = bad key; 404 = wrong endpoint/model. These are config errors.
  if (status === 401 || status === 403 || status === 404) return "config";
  // 429 = rate limited — transient but worth logging distinctly.
  if (status === 429) return "rate_limited";
  // 5xx, timeouts, network errors → transient, safe to fallback.
  return "transient";
}

async function chat({ client, messages, tools, temperature = 0.2, vendorName = PRIMARY }) {
  for (const name of [vendorName, FALLBACK]) {
    const vendor = await resolveVendor(client, name);
    if (!vendor) continue;
    try {
      return await callVendor(vendor, { messages, tools, temperature });
    } catch (err) {
      const kind = classifyVendorError(err);
      if (kind === "config") {
        // Configuration error — log as ERROR (not warn), do NOT silently fall
        // back. The operator needs to know the key is broken. Return the stub
        // so the user sees a clear message rather than a silent wrong answer.
        logger.error({ err, vendor: name, errorKind: kind },
          "LLM vendor CONFIGURATION ERROR — API key or endpoint is invalid. " +
          "Fix in AI Control > Vendors. Not falling back to hide this.");
        return { ...STUB, text: `AI provider "${name}" has a configuration error (${err.response ? err.response.status : "connection"}). An administrator should check the vendor settings.`, provider: null };
      }
      // Transient or rate-limited — fallback is appropriate.
      logger.warn({ err, vendor: name, errorKind: kind }, "LLM vendor failed, trying fallback");
    }
  }
  return STUB;
}

/**
 * Streaming chat — yields `{ delta, done, toolCalls, text, usage, provider }`
 * chunks. Tries PRIMARY then FALLBACK, same as `chat`. The orchestrator's
 * `askStream` forwards deltas to the client over SSE.
 *
 * `onDelta` is called with each text delta so the orchestrator can accumulate
 * the full text for conversation persistence. The generator also yields the
 * same data, so callers can use either interface.
 */
async function* chatStream({ client, messages, tools, temperature = 0.2, vendorName = PRIMARY, onDelta }) {
  for (const name of [vendorName, FALLBACK]) {
    const vendor = await resolveVendor(client, name);
    if (!vendor) continue;
    try {
      for await (const chunk of callVendorStream(vendor, { messages, tools, temperature })) {
        if (!chunk.done && chunk.delta && onDelta) onDelta(chunk.delta);
        yield chunk;
      }
      return;
    } catch (err) {
      const kind = classifyVendorError(err);
      if (kind === "config") {
        logger.error({ err, vendor: name, errorKind: kind },
          "LLM streaming vendor CONFIGURATION ERROR — not falling back.");
        const msg = `AI provider "${name}" has a configuration error. An administrator should check the vendor settings.`;
        yield { delta: msg, done: true, toolCalls: [], text: msg, usage: {}, provider: null };
        return;
      }
      logger.warn({ err, vendor: name, errorKind: kind }, "LLM streaming vendor failed, trying fallback");
    }
  }
  // No vendor — emit stub as a single chunk.
  yield { delta: STUB.text, done: true, toolCalls: [], text: STUB.text, usage: {}, provider: null };
}

module.exports = { chat, chatStream, resolveVendor, PRIMARY, FALLBACK };
