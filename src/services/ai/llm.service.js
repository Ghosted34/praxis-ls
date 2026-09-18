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

// Gemini speaks the OpenAI /chat/completions shape ONLY through Google's
// compatibility gateway, never its native endpoint (audit B2 — the native API
// is a different shape, so a fallback pointed there resolves but every call
// fails). This is the compat base for the .env fallback; a
// platform.ai_vendor_credential row for "gemini" (the intended source) overrides
// it when ops configure one.
const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

// .env fallback vendors (OpenAI-compatible endpoints only).
const ENV_VENDORS = {
  deepseek: { vendor: "deepseek", api_key: config.DEEPSEEK_API_KEY, endpoint_url: config.DEEPSEEK_BASE_URL, model: config.DEEPSEEK_MODEL },
  openai: { vendor: "openai", api_key: config.OPENAI_API_KEY, endpoint_url: config.OPENAI_BASE_URL, model: config.OPENAI_MODEL },
  // FALLBACK (audit B2). Before this entry existed resolveVendor("gemini")
  // returned null — so a primary outage degraded straight to the stub instead of
  // to a working fallback. Reuses the existing GEMINI_API_KEY / GEMINI_MODEL
  // against the OpenAI-compat gateway above (no new env knobs).
  gemini: { vendor: "gemini", api_key: config.GEMINI_API_KEY, endpoint_url: GEMINI_OPENAI_BASE_URL, model: config.GEMINI_MODEL },
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

/**
 * Prompt caching (audit B5). The orchestrator marks the first system message
 * with `cachePrefix` — the large, STABLE rules block that repeats verbatim every
 * turn — so a provider can cache it instead of re-reading 2–3 KB on every call.
 * How that is expressed depends on the vendor, and an unknown request field 400s
 * some of them, so we check support first and degrade cleanly:
 *   · "explicit" — Anthropic-style: the prefix becomes its own content part with
 *     a `cache_control` breakpoint; the dynamic tail is a second, uncached part.
 *   · "auto"     — OpenAI, DeepSeek (context cache on disk), the Gemini gateway:
 *     no request flag exists — the provider caches a stable PREFIX on its own, so
 *     we simply keep sending the plain string with the rules first.
 *   · "none"     — unknown vendor: send plain, rely on nothing.
 */
const PROMPT_CACHE_STYLE = { anthropic: "explicit", openai: "auto", deepseek: "auto", gemini: "auto" };
function promptCacheStyle(vendorName) {
  return PROMPT_CACHE_STYLE[String(vendorName || "").toLowerCase()] || "none";
}
function supportsPromptCache(vendorName) {
  return promptCacheStyle(vendorName) !== "none";
}

/** Drop the internal cache hints so they never reach the vendor over the wire. */
function stripCacheHints(m) {
  if (!("cache" in m) && !("cachePrefix" in m)) return m;
  const copy = { ...m };
  delete copy.cache;
  delete copy.cachePrefix;
  return copy;
}

/**
 * Apply a message's `cachePrefix` hint for this vendor's caching style, and
 * ALWAYS strip the hint. Only an explicit-style vendor whose string content
 * actually begins with the prefix is rewritten into cached + uncached parts;
 * every other case sends the plain string unchanged (identical bytes to before
 * caching existed), so correctness never depends on cache support.
 */
function prepareMessages(vendor, messages) {
  const style = promptCacheStyle(vendor && vendor.vendor);
  return messages.map((m) => {
    const canSplit = m.cachePrefix && typeof m.content === "string" && m.content.startsWith(m.cachePrefix);
    if (style !== "explicit" || !canSplit) return stripCacheHints(m);
    const base = stripCacheHints(m);
    const rest = m.content.slice(m.cachePrefix.length);
    const content = [{ type: "text", text: m.cachePrefix, cache_control: { type: "ephemeral" } }];
    if (rest) content.push({ type: "text", text: rest });
    return { ...base, content };
  });
}

/**
 * A resolved endpoint that is Gemini's NATIVE API rather than its OpenAI-compat
 * gateway (audit B2). The native host does not speak /chat/completions, so a
 * "gemini" vendor pointed there resolves but every call fails — the health check
 * flags it so the misconfig is visible before the first request.
 *
 * Parses the URL and matches the HOST exactly (not a substring of the whole URL
 * string): a substring check would both miss a legitimately different host and
 * mis-flag a look-alike like `generativelanguage.googleapis.com.example.com`
 * (CodeQL js/incomplete-url-substring-sanitization). The OpenAI-compat gateway
 * is the same host under a `/…/openai` path, so the path decides compat.
 */
function looksLikeNativeGemini(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return false; // not a parseable URL — nothing to flag
  }
  const isGoogleGenAiHost = parsed.hostname.toLowerCase() === "generativelanguage.googleapis.com";
  const hasOpenAiCompatPath = /(^|\/)openai(\/|$)/i.test(parsed.pathname);
  return isGoogleGenAiHost && !hasOpenAiCompatPath;
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

async function callVendor(vendor, { messages, tools, temperature, responseFormat, maxTokens }) {
  const base = String(vendor.endpoint_url).replace(/\/$/, "");
  const body = { model: vendor.model, messages: prepareMessages(vendor, messages), temperature };
  // Explicit output ceiling — without it the vendor default (often short) caps
  // the reply mid-sentence (audit B1). See config.AI_MAX_TOKENS.
  if (maxTokens) body.max_tokens = maxTokens;
  if (responseFormat) body.response_format = responseFormat;
  if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }
  const { data } = await axios.post(`${base}/chat/completions`, body, {
    headers: { Authorization: `Bearer ${vendor.api_key}`, "Content-Type": "application/json" },
    // Generous + configurable (audit E1): an `ask` makes several sequential
    // calls, so a tight cap trips a slow multi-hop turn and is misread as a
    // transient failure.
    timeout: config.AI_REQUEST_TIMEOUT_MS,
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
  // `model` rides along so the usage ledger records WHICH model was billed —
  // the vendor row can be re-pointed at a cheaper/newer model at any time, and
  // a ledger that only names the vendor cannot explain a change in spend.
  return { provider: vendor.vendor, model: data.model || vendor.model || null, text, toolCalls, usage: data.usage || {} };
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
async function* callVendorStream(vendor, { messages, tools, temperature, maxTokens }) {
  const base = String(vendor.endpoint_url).replace(/\/$/, "");
  // `stream_options.include_usage` makes OpenAI-compatible vendors emit a final
  // usage chunk on a stream; without it token usage is unknown for every
  // streamed turn and the budget/spend ledger under-counts (audit B4).
  const body = { model: vendor.model, messages: prepareMessages(vendor, messages), temperature, stream: true, stream_options: { include_usage: true } };
  if (maxTokens) body.max_tokens = maxTokens;
  if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }

  let response;
  try {
    response = await axios.post(`${base}/chat/completions`, body, {
      headers: { Authorization: `Bearer ${vendor.api_key}`, "Content-Type": "application/json" },
      // Time-to-first-response ceiling for the stream (audit E1); once bytes
      // flow, the SSE heartbeat and client-disconnect abort govern the body, so
      // a long-but-live answer is never cut off.
      timeout: config.AI_STREAM_TIMEOUT_MS,
      responseType: "stream",
    });
  } catch (err) {
    // Stream not supported or network error — fall back to non-streaming.
    logger.warn({ err, vendor: vendor.vendor }, "streaming vendor call failed, falling back");
    const result = await callVendor(vendor, { messages, tools, temperature, maxTokens });
    yield { delta: result.text, done: true, toolCalls: result.toolCalls, text: result.text, usage: result.usage, provider: vendor.vendor, model: result.model || vendor.model || null };
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
        yield { delta: "", done: true, toolCalls: finalToolCalls, text: finalText, usage, provider: vendor.vendor, model: vendor.model || null };
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
        /* @silent:parse — one malformed SSE frame is isolated; subsequent frames remain usable. */
        // Malformed SSE line — skip silently (common with some vendors).
      }
    }
  }

  // Stream ended without [DONE] — emit what we have.
  const toolCalls = Array.from(toolCallBuffers.values()).map((tc) => ({
    id: tc.id, type: tc.type || "function", function: { name: tc.function.name, arguments: tc.function.arguments },
  }));
  yield { delta: "", done: true, toolCalls, text, usage, provider: vendor.vendor, model: vendor.model || null };
}

const STUB = {
  provider: null,
  model: null,
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

async function chat({ client, messages, tools, temperature = 0.2, vendorName = PRIMARY, responseFormat, maxTokens = config.AI_MAX_TOKENS }) {
  const chain = [...new Set([vendorName, FALLBACK])];
  let configError = null;
  for (const name of chain) {
    const vendor = await resolveVendor(client, name);
    if (!vendor) continue;
    try {
      return await callVendor(vendor, { messages, tools, temperature, responseFormat, maxTokens });
    } catch (err) {
      const kind = classifyVendorError(err);
      if (kind === "config") {
        // A bad key/endpoint must be LOUD (audit 3.6 — the operator has to know),
        // but it must NOT strand the turn on the stub while a working fallback
        // exists (audit B2 — "killing the primary key degrades to a WORKING
        // fallback, not the stub"). So log at ERROR and fall THROUGH to the next
        // vendor; visibility comes from this log + the startup health check, not
        // from denying the user an answer.
        logger.error({ err, vendor: name, errorKind: kind },
          `LLM vendor "${name}" CONFIGURATION ERROR (${err.response ? err.response.status : "connection"}) — API key or endpoint is invalid. ` +
          "Fix in AI Control > Vendors. Trying the fallback so the turn still answers.");
        configError = name;
        continue;
      }
      // Transient or rate-limited — fallback is appropriate.
      logger.warn({ err, vendor: name, errorKind: kind }, "LLM vendor failed, trying fallback");
    }
  }
  // The whole chain is exhausted. If the failures were configuration errors, say
  // so in the stub rather than the generic "no provider configured" message.
  if (configError) {
    return { ...STUB, provider: null, text: `The AI providers are unavailable — the "${configError}" credential has a configuration error and no fallback answered. An administrator should check AI Control > Vendors.` };
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
async function* chatStream({ client, messages, tools, temperature = 0.2, vendorName = PRIMARY, onDelta, maxTokens = config.AI_MAX_TOKENS }) {
  const chain = [...new Set([vendorName, FALLBACK])];
  let configError = null;
  for (const name of chain) {
    const vendor = await resolveVendor(client, name);
    if (!vendor) continue;
    try {
      for await (const chunk of callVendorStream(vendor, { messages, tools, temperature, maxTokens })) {
        if (!chunk.done && chunk.delta && onDelta) onDelta(chunk.delta);
        yield chunk;
      }
      return;
    } catch (err) {
      const kind = classifyVendorError(err);
      if (kind === "config") {
        // Loud, but fall THROUGH to the fallback — same reasoning as chat()
        // (audit 3.6 visibility + audit B2 working fallback, not the stub).
        logger.error({ err, vendor: name, errorKind: kind },
          `LLM streaming vendor "${name}" CONFIGURATION ERROR — trying the fallback so the turn still answers.`);
        configError = name;
        continue;
      }
      logger.warn({ err, vendor: name, errorKind: kind }, "LLM streaming vendor failed, trying fallback");
    }
  }
  // Chain exhausted — emit a single terminal chunk. A configuration error gets a
  // clearer message than the generic "no provider configured" stub.
  const text = configError
    ? `The AI providers are unavailable — the "${configError}" credential has a configuration error and no fallback answered. An administrator should check AI Control > Vendors.`
    : STUB.text;
  yield { delta: text, done: true, toolCalls: [], text, usage: {}, provider: null };
}

/**
 * Resolve one role's vendor for the health check WITHOUT throwing, returning
 * diagnostics rather than just the config. Mirrors resolveVendor's precedence
 * (platform credential first, then the .env fallback) so it reports exactly what
 * the runtime would use, and it survives an unreachable platform DB at boot
 * (`lookupError`) instead of masquerading a transient outage as "unconfigured".
 */
async function inspectVendor(client, role, name) {
  let db = null;
  let lookupError = false;
  try {
    db = await platformVendors.getConfig(name);
  } catch {
    /* @silent:boot — platform DB may not answer yet; fall through to .env. */
    lookupError = true;
  }
  let source = null;
  let cfg = null;
  if (db && db.is_active !== false && db.api_key && db.endpoint_url) { source = "platform"; cfg = db; }
  else {
    const env = ENV_VENDORS[name];
    if (env && env.api_key && env.endpoint_url) { source = "env"; cfg = env; }
  }
  const endpoint = (cfg && cfg.endpoint_url) || null;
  return {
    role,
    name,
    resolved: Boolean(cfg),
    source, // "platform" | "env" | null
    hasKey: Boolean(cfg && cfg.api_key),
    endpoint,
    model: (cfg && cfg.model) || null,
    // false ONLY when a resolved endpoint looks like Gemini's native API.
    openaiCompatible: endpoint ? !looksLikeNativeGemini(endpoint) : null,
    // Only meaningful when it PREVENTED resolution — a platform hiccup, not a
    // definite "not configured".
    lookupError: lookupError && !cfg,
  };
}

/**
 * Startup / on-demand health of the AI chat provider chain (audit B2).
 *
 * The declared PRIMARY and FALLBACK must BOTH resolve to a usable, OpenAI-
 * /chat/completions-compatible vendor, or a primary outage degrades to "AI has
 * no provider configured". This reports resolution ONLY (no external call, so it
 * is safe to run at boot), and flags the three ways the chain is silently broken:
 * a vendor that does not resolve, a "gemini" pointed at its native (non-compat)
 * endpoint, and a primary that equals the fallback (no distinct provider to fall
 * back to). `ok` is false on any DEFINITE problem; `inconclusive` marks the case
 * where a platform-DB hiccup left resolution unknown so a caller can log softly.
 */
async function checkVendorHealth({ client } = {}) {
  const primary = await inspectVendor(client, "primary", PRIMARY);
  const fallback = await inspectVendor(client, "fallback", FALLBACK);
  const distinct = PRIMARY !== FALLBACK;
  const issues = [];
  for (const v of [primary, fallback]) {
    if (v.resolved) {
      if (v.openaiCompatible === false) {
        issues.push(`${v.role} chat vendor "${v.name}" endpoint (${v.endpoint}) looks like Gemini's NATIVE API, which is not OpenAI /chat/completions-shaped — point it at the OpenAI-compatible gateway (…/v1beta/openai) or every call will fail.`);
      }
    } else if (!v.lookupError) {
      issues.push(`${v.role} chat vendor "${v.name}" is not configured — no active credential in platform.ai_vendor_credential and no usable .env fallback (needs a key + endpoint).`);
    }
  }
  if (!distinct) issues.push(`primary and fallback are both "${PRIMARY}" — a primary failure has no distinct provider to fall back to.`);
  const inconclusive = (primary.lookupError || fallback.lookupError) && issues.length === 0;
  return { ok: issues.length === 0, inconclusive, distinct, primary, fallback, issues, checkedAt: new Date().toISOString() };
}

module.exports = { chat, chatStream, resolveVendor, checkVendorHealth, supportsPromptCache, PRIMARY, FALLBACK };
