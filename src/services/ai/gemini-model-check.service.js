/**
 * Does the Gemini model this deployment is configured with still exist?
 * (doc/SMART_COMMS_CALLS_AUDIT.md N3.)
 *
 * Google retires Gemini model ids on a schedule. A retired id answers every
 * generateContent with 404, which silently takes out the call transcription
 * fallback (owner decision O1), the call summary (O2) and document vision. The
 * credential in the platform console is the source of truth; this asks
 * Google's native models endpoint about exactly the id that credential (or the
 * GEMINI_MODEL env fallback) names.
 *
 * Read-only and bounded: one GET, a 10 s timeout, the answer kept for ten
 * minutes. Logged once at API boot; shown on the console's AI providers screen.
 */
"use strict";

const axios = require("axios");
const { config } = require("../../config/env");
const { resolveVendor } = require("./llm.service");
const { nativeBase } = require("./gemini-transcription.service");
const { logger } = require("../../config/logger");

const TIMEOUT_MS = 10_000;
const CACHE_MS = 10 * 60 * 1000;
let cached = null;

/**
 * { status, model, checked_at, detail?, http_status? }
 *   ok            the model exists and can generate content
 *   missing       Google answered 404 for this id: it is retired or misspelt
 *   unusable      it exists but does not support generateContent
 *   unconfigured  no gemini credential and no GEMINI_API_KEY
 *   error         could not tell (bad key, network, Google down)
 */
async function checkGeminiModel({ force = false } = {}) {
  if (!force && cached && Date.now() - Date.parse(cached.checked_at) < CACHE_MS) return cached;
  const checkedAt = new Date().toISOString();
  let vendor = null;
  try {
    vendor = await resolveVendor(null, "gemini");
  } catch (err) {
    logger.warn({ err }, "gemini model check: the gemini credential could not be read");
  }
  const model = String((vendor && vendor.model) || config.GEMINI_MODEL || "").replace(/^models\//, "") || null;
  if (!vendor || !vendor.api_key) {
    cached = { status: "unconfigured", model, checked_at: checkedAt };
    return cached;
  }
  const url = `${nativeBase(vendor.endpoint_url)}/models/${encodeURIComponent(model)}`;
  try {
    const { data } = await axios.get(url, {
      headers: { "x-goog-api-key": vendor.api_key },
      timeout: TIMEOUT_MS,
    });
    const methods = (data && data.supportedGenerationMethods) || [];
    cached = methods.length && !methods.includes("generateContent")
      ? { status: "unusable", model, checked_at: checkedAt, detail: "This model cannot generate content." }
      : { status: "ok", model, checked_at: checkedAt, detail: (data && data.displayName) || null };
  } catch (err) {
    const status = err.response ? err.response.status : null;
    const message = (err.response && err.response.data && err.response.data.error && err.response.data.error.message)
      || err.message;
    cached = status === 404
      ? { status: "missing", model, checked_at: checkedAt, http_status: 404, detail: String(message).slice(0, 300) }
      : { status: "error", model, checked_at: checkedAt, http_status: status, detail: String(message).slice(0, 300) };
  }
  return cached;
}

/** The boot log line: ERROR when the model is gone, since calls depend on it. */
async function logGeminiModelAtBoot() {
  const out = await checkGeminiModel({ force: true });
  if (out.status === "ok") {
    logger.info({ model: out.model }, "Gemini model check OK");
  } else if (out.status === "missing" || out.status === "unusable") {
    logger.error(
      { geminiModel: out },
      `GEMINI MODEL "${out.model}" IS NOT AVAILABLE (${out.status}) — call transcription fallback, call summaries ` +
        "and document vision will fail. Set a current model on the gemini credential (platform console → " +
        "Integrations → AI providers). See calls audit N3.",
    );
  } else if (out.status === "error") {
    logger.warn({ geminiModel: out }, "Gemini model check could not reach Google");
  }
  return out;
}

function resetCache() {
  cached = null;
}

module.exports = { checkGeminiModel, logGeminiModelAtBoot, resetCache };
