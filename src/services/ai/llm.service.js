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

const STUB = {
  provider: null,
  text: "The AI assistant has no chat provider configured yet. An administrator can add one under AI Control > Vendors.",
  toolCalls: [],
  usage: {},
};

async function chat({ client, messages, tools, temperature = 0.2, vendorName = PRIMARY }) {
  for (const name of [vendorName, FALLBACK]) {
    // eslint-disable-next-line no-await-in-loop
    const vendor = await resolveVendor(client, name);
    if (!vendor) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      return await callVendor(vendor, { messages, tools, temperature });
    } catch (err) {
      logger.warn({ err, vendor: name }, "LLM vendor failed");
    }
  }
  return STUB;
}

module.exports = { chat, resolveVendor, PRIMARY, FALLBACK };
