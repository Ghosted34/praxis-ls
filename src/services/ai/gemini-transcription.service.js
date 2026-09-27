/**
 * Voice-to-text through Gemini: the call pipeline's second provider (Smart Comms
 * owner decision A-1). Groq is tried once; on any Groq error the same part comes
 * here once. Nothing in this file retries.
 *
 * The contract is Groq's: the words verbatim, in the language spoken, and that
 * language as "en" or "fr". Temperature 0 and a JSON schema keep the model from
 * summarising, tidying or translating.
 *
 * The credential is the platform `gemini` row (env GEMINI_API_KEY fallback),
 * resolved exactly as chat resolves it. That row points at Google's
 * OpenAI-compat gateway, which takes only wav/mp3 audio, so this calls the
 * native generateContent API on the same host and version instead.
 *
 * Audio types: the Gemini Developer API accepts wav, mp3, aiff, aac, ogg
 * (Vorbis) and flac. Browsers record webm/Opus (Chrome, Edge), mp4/AAC (Safari)
 * or ogg/Opus (Firefox), none of which is on that list, so those are converted
 * to 16 kHz mono FLAC with ffmpeg first (installed in the Docker image). 16 kHz
 * is what Gemini downsamples to anyway.
 */
"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const axios = require("axios");
const { config } = require("../../config/env");
const { resolveVendor } = require("./llm.service");

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Sent as is. Anything else is converted. */
const ACCEPTED = new Map([
  ["audio/wav", "audio/wav"],
  ["audio/x-wav", "audio/wav"],
  ["audio/mp3", "audio/mp3"],
  ["audio/mpeg", "audio/mp3"],
  ["audio/aiff", "audio/aiff"],
  ["audio/aac", "audio/aac"],
  ["audio/flac", "audio/flac"],
]);
const CONVERT_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 90_000;
/** Gemini bills and measures audio at 32 tokens per second. */
const AUDIO_TOKENS_PER_SECOND = 32;

const SYSTEM = [
  "You transcribe one part of a recorded business phone call between two colleagues.",
  "1. Write down the words spoken, verbatim, in the language they were spoken in. Never translate. Never summarise, paraphrase, correct grammar or add words.",
  '2. The call is in English or French. Report the language most of the speech is in as "en" or "fr".',
  "3. No speaker labels, timestamps or descriptions of sounds. If nothing intelligible is said, text is an empty string.",
  'Answer with JSON only: {"text": "...", "language": "en"}',
].join("\n");

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    text: { type: "STRING" },
    language: { type: "STRING", format: "enum", enum: ["en", "fr"] },
  },
  required: ["text", "language"],
};

const baseType = (mimeType) => String(mimeType || "").split(";")[0].trim().toLowerCase();

/** The native API root for a credential that may point at the compat gateway. */
function nativeBase(endpointUrl) {
  let url;
  try {
    url = new URL(String(endpointUrl || ""));
  } catch {
    return DEFAULT_BASE;
  }
  const version = url.pathname.replace(/\/+$/, "").replace(/\/openai$/i, "");
  return `${url.origin}${version || "/v1beta"}`;
}

function runFfmpeg(args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${signal || code}: ${err.trim().split("\n").pop() || "no output"}`));
    });
  });
}

/**
 * The bytes Gemini will accept. A type on its list is passed through; anything
 * else becomes 16 kHz mono FLAC. Files rather than pipes on both ends: Safari's
 * MP4 is not always streamable, and a FLAC written to a pipe has no sample
 * count in its header.
 */
async function toGeminiAudio({ audio, mimeType, timeoutMs = CONVERT_TIMEOUT_MS }) {
  const accepted = ACCEPTED.get(baseType(mimeType));
  if (accepted) return { data: audio, mimeType: accepted };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "praxis-audio-"));
  try {
    const input = path.join(dir, "part.bin");
    const output = path.join(dir, "part.flac");
    await fs.writeFile(input, audio);
    let data;
    try {
      await runFfmpeg(
        ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", input,
          "-vn", "-ac", "1", "-ar", "16000", "-c:a", "flac", output],
        { timeoutMs },
      );
      data = await fs.readFile(output);
    } catch (err) {
      throw new Error(`could not convert ${baseType(mimeType) || "audio"} for Gemini (${err.message})`);
    }
    if (!data.length) throw new Error(`could not convert ${baseType(mimeType) || "audio"} for Gemini (empty output)`);
    return { data, mimeType: "audio/flac" };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function audioSecondsFrom(usage) {
  const details = (usage && usage.promptTokensDetails) || [];
  const audio = details.find((d) => d && d.modality === "AUDIO");
  return audio && audio.tokenCount ? Math.round(audio.tokenCount / AUDIO_TOKENS_PER_SECOND) : null;
}

/**
 * transcribe({ audio, mimeType }) → { text, detected_language, audio_seconds,
 * provider: "gemini", model, usage }. Throws on any failure; the caller decides
 * what a failed part means.
 */
async function transcribe({ audio, mimeType, timeoutMs = REQUEST_TIMEOUT_MS }) {
  if (!Buffer.isBuffer(audio) || audio.length === 0) throw new Error("transcribe needs a non-empty audio Buffer");
  const vendor = await resolveVendor(null, "gemini");
  if (!vendor || !vendor.api_key) {
    throw new Error("Gemini transcription is not configured (no gemini credential or GEMINI_API_KEY)");
  }
  const input = await toGeminiAudio({ audio, mimeType });
  const model = String(vendor.model || config.GEMINI_MODEL).replace(/^models\//, "");
  const url = `${nativeBase(vendor.endpoint_url)}/models/${encodeURIComponent(model)}:generateContent`;

  const { data } = await axios.post(url, {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: input.mimeType, data: input.data.toString("base64") } },
        { text: "Transcribe this audio." },
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  }, {
    headers: { "x-goog-api-key": vendor.api_key, "Content-Type": "application/json" },
    timeout: timeoutMs,
    maxBodyLength: Infinity,
  });

  const blocked = data && data.promptFeedback && data.promptFeedback.blockReason;
  if (blocked) throw new Error(`Gemini refused the audio (${blocked})`);
  const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  if (!candidate) throw new Error("Gemini returned no transcript");
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new Error(`Gemini stopped early (${candidate.finishReason})`);
  }
  const raw = ((candidate.content && candidate.content.parts) || []).map((p) => p.text || "").join("");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Gemini transcription reply was not JSON");
  }
  if (!parsed || typeof parsed.text !== "string" || typeof parsed.language !== "string") {
    throw new Error("Gemini transcription reply did not match the contract");
  }
  return {
    text: parsed.text.trim(),
    detected_language: parsed.language,
    audio_seconds: audioSecondsFrom(data.usageMetadata),
    provider: "gemini",
    model,
    usage: data.usageMetadata || {},
  };
}

module.exports = { transcribe, toGeminiAudio, nativeBase };
