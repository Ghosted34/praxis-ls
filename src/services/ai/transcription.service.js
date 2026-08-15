/**
 * Voice-to-text (AI_ARCHITECTURE §3/§6). Provider: Groq/Whisper (OpenAI-compatible
 * transcription endpoint). Keys come from the tenant's governance vendor config
 * where set, else the platform env. Swappable behind this one function; throws a
 * clear error when no provider is configured (parity with PDF needing Chromium).
 */
"use strict";

const { config } = require("../../config/env");

const { logger } = require("../../config/logger");

/**
 * transcribe({ audio, mimeType, vendor }) → { text, audio_seconds, provider }.
 * `audio` is a Buffer; `vendor` is an optional decrypted governance config
 * ({ api_key, endpoint_url, model }) resolved from governance (DB).
 */
async function transcribe({ audio, mimeType = "audio/mpeg", vendor = null }) {
  const apiKey = (vendor && vendor.api_key) || config.GROQ_API_KEY;
  const baseURL = (vendor && vendor.endpoint_url) || config.WHISPER_BASE_URL;
  if (!apiKey) throw new Error("voice transcription provider not configured (Groq/Whisper key missing)");
  if (!Buffer.isBuffer(audio) || audio.length === 0) throw new Error("transcribe needs a non-empty audio Buffer");

  const OpenAI = require("openai");
  const groq = new OpenAI({ apiKey, baseURL });
  const model = (vendor && vendor.model) || "whisper-large-v3";
  try {
    const res = await groq.audio.transcriptions.create({
      file: await toFile(audio, `audio.${extFor(mimeType)}`, mimeType),
      model,
    });
    return { text: (res && res.text) || "", audio_seconds: res.duration || 0, provider: "groq" };
  } catch (err) {
    logger.warn({ err }, "transcription failed");
    throw err;
  }
}

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
