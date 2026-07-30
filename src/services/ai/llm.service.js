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

async function callVendor(vendor, { messages, tools, temperature }) {
  const base = String(vendor.endpoint_url).replace(/\/$/, "");
  const body = { model: vendor.model, messages, temperature };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }
  const { data } = await axios.post(`${base}/chat/completions`, body, {
    headers: { Authorization: `Bearer ${vendor.api_key}`, "Content-Type": "application/json" },
    timeout: 60000,
  });
  const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
  return { provider: vendor.vendor, text: msg.content || "", toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [], usage: data.usage || {} };
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
      logger.warn({ err: err.message, vendor: name }, "LLM vendor failed");
    }
  }
  return STUB;
}

module.exports = { chat, resolveVendor, PRIMARY, FALLBACK };
