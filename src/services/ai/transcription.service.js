/**
 * Voice-to-text (AI_ARCHITECTURE §3/§6). Provider: Groq/Whisper (OpenAI-compatible
 * transcription endpoint). Keys come from the tenant's governance vendor config
 * where set, else the platform env. Swappable behind this one function; throws a
 * clear error when no provider is configured (parity with PDF needing Chromium).
 */
"use strict";

const { config } = require("../../config/env");
const platformVendors = require("../platform/ai-vendor.service");

const { logger } = require("../../config/logger");

/**
 * transcribe({ audio, mimeType, language, vendor }) → { text, audio_seconds, provider }.
 * `audio` is a Buffer; `vendor` is an optional decrypted governance config
 * ({ api_key, endpoint_url, model }) resolved from governance (DB).
 *
 * `language` is an ISO-639-1 hint ("en" / "fr"), and it is a hint the caller
 * should give whenever it has one. Whisper detects the language on its own and
 * is good at it on a clean thirty-second clip — it is markedly less good on a
 * five-second one with a forklift behind it, and its failure mode is not an
 * error but a fluent TRANSLATION into the language it guessed. A transcript
 * that reads as confident English of a French instruction is worse than no
 * transcript, because nothing about it looks wrong.
 */
async function transcribe({ audio, mimeType = "audio/mpeg", language = null, vendor = null }) {
  // Synchronous transcription callers (mail dictation, vacancy intake,
  // training notes and Smart Comms) do not pass a vendor object. The queued AI
  // worker does, but requiring every caller to repeat that lookup made the
  // Platform Console configuration invisible to the synchronous paths: they
  // checked only GROQ_API_KEY and incorrectly said voice input was not set up.
  // Resolve the same deploy-wide `groq` row here, at the shared boundary.
  let resolved = vendor;
  if (!resolved) {
    try {
      resolved = await platformVendors.getConfig("groq");
    } catch (err) {
      // Preserve the documented env fallback during a platform-DB outage.
      logger.warn({ err }, "could not resolve platform transcription vendor; using environment fallback");
    }
  }
  const enabledVendor = resolved && resolved.is_active !== false ? resolved : null;
  const apiKey = (enabledVendor && enabledVendor.api_key) || config.GROQ_API_KEY;
  const baseURL = (enabledVendor && enabledVendor.endpoint_url) || config.WHISPER_BASE_URL;
  if (!apiKey) throw new Error("voice transcription provider not configured (Groq/Whisper key missing)");
  if (!Buffer.isBuffer(audio) || audio.length === 0) throw new Error("transcribe needs a non-empty audio Buffer");

  const OpenAI = require("openai");
  const groq = new OpenAI({ apiKey, baseURL });
  const model = (enabledVendor && enabledVendor.model) || "whisper-large-v3";
  try {
    const res = await groq.audio.transcriptions.create({
      file: await toFile(audio, `audio.${extFor(mimeType)}`, mimeType),
      model,
      // Omitted rather than sent empty: the endpoint treats an empty string as
      // a language it cannot parse on some deployments, where absent means
      // "detect it yourself", which is the behaviour we want when nobody said.
      ...(LANGUAGES.has(String(language || "").toLowerCase())
        ? { language: String(language).toLowerCase() }
        : {}),
    });
    return { text: (res && res.text) || "", audio_seconds: res.duration || 0, provider: "groq" };
  } catch (err) {
    logger.warn({ err }, "transcription failed");
    throw err;
  }
}

/** The language hints this deployment accepts. Two, because two is what the
 *  corridor speaks and an unchecked passthrough is a free-text field going to
 *  a vendor. */
const LANGUAGES = new Set(["en", "fr"]);

/**
 * The extension Whisper is given.
 *
 * The endpoint decides what a file IS partly from its name, and a buffer sent as
 * a bare "audio" is a coin flip — so the container the browser recorded in is
 * named explicitly. Falls back to mp3, which is what the default mimeType says.
 */
function extFor(mimeType) {
  const type = String(mimeType || "").split(";")[0].trim().toLowerCase();
  return (
    {
      "audio/webm": "webm",
      "audio/ogg": "ogg",
      "audio/mp4": "mp4",
      "audio/m4a": "m4a",
      "audio/x-m4a": "m4a",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/mpeg": "mp3",
    }[type] || "mp3"
  );
}

// openai SDK's toFile helper (lazy so tests without the dep still load this file).
async function toFile(buffer, name, type) {
  const { toFile: tf } = require("openai");
  return tf(buffer, name, { type });
}

module.exports = { transcribe };
