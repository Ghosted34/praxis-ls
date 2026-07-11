/**
 * LLM chat + function-calling. Vendor-agnostic and DB-driven: creds, endpoint,
 * model and per-token costs come from the encrypted ai_vendor_credential rows
 * via governance.getVendorConfig(client, vendor) — NOT .env
 * (doc/BUILD_CONVENTIONS.md §7). Primary -> fallback are both configured in the
 * AI Control surface. When no vendor is configured the call degrades to a clear
 * stub so the assistant explains itself instead of crashing. All vendors here
 * speak the OpenAI-compatible /chat/completions shape.
 */
"use strict";

const axios = require("axios");
const governance = require("../../modules/ai/governance/governance.service");
const { logger } = require("../../config/logger");

const PRIMARY = "deepseek";
const FALLBACK = "gemini";

async function callVendor(vendor, { messages, tools, temperature }) {
  const base = String(vendor.endpoint_url).replace(/\/$/, "");
  const body = { model: vendor.model, messages, temperature };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }
  const { data } = await axios.post(`${base}/chat/completions`, body, {
    headers: { Authorization: `Bearer ${vendor.api_key}`, "Content-Type": "application/json" },
    timeout: 60000,
  });
  const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
  return {
    provider: vendor.vendor,
    text: msg.content || "",
    toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
    usage: data.usage || {},
  };
}

const STUB = {
  provider: null,
  text: "The AI assistant has no chat provider configured yet. An administrator can add one under AI Control > Vendors.",
  toolCalls: [],
  usage: {},
};

async function chat({ client, messages, tools, temperature = 0.2, vendorName = PRIMARY }) {
  if (!client) throw new Error("llm.chat requires a tenant client to resolve vendor keys from the DB");
  const primary = await governance.getVendorConfig(client, vendorName);
  if (primary && primary.api_key && primary.endpoint_url) {
    try {
      return await callVendor(primary, { messages, tools, temperature });
    } catch (err) {
      logger.warn({ err: err.message, vendor: vendorName }, "primary LLM vendor failed -> trying fallback");
    }
  }
  const fallback = await governance.getVendorConfig(client, FALLBACK);
  if (fallback && fallback.api_key && fallback.endpoint_url) {
    try {
      return await callVendor(fallback, { messages, tools, temperature });
    } catch (err) {
      logger.warn({ err: err.message, vendor: FALLBACK }, "fallback LLM vendor failed");
    }
  }
  return STUB;
}

module.exports = { chat, PRIMARY, FALLBACK };
