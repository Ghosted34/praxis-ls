/**
 * Smart Comms calls: everything that happens to a call after it ends. The
 * recorded parts are transcribed with no forced language, the attributed
 * transcript is assembled, the summary draft is written in the caller's app
 * language, and the caller is told it is ready.
 *
 * Transcription, per part (owner decision A-1): Groq once; on any Groq error,
 * the same part goes to Gemini once. Nothing is retried inside a job. If both
 * fail the part fails and its side has no transcript for this run (never a
 * mixture of transcribed and missing parts). Both providers work from the
 * stored audio, so both produce certified rows, and each row names its real
 * provider. The browser live capture is never used to build a transcript;
 * old calls keep their `browser-live` rows and still render them.
 *
 * Summary (owner decision A-2): Gemini first, DeepSeek as the last resort. If
 * neither answers, the attributed transcript is the draft ('transcript-only').
 *
 * Nothing here posts to a conversation except `sendSummary`, which needs the
 * caller as the actor (decision row 3).
 */
"use strict";

const crypto = require("crypto");
const { callSummary } = require("@praxis/shared");
const storage = require("../../services/storage.service");
const transcription = require("../../services/ai/transcription.service");
const geminiTranscription = require("../../services/ai/gemini-transcription.service");
const llm = require("../../services/ai/llm.service");
const governance = require("../ai/governance/governance.service");
const alerts = require("../../services/platform/alert-routing.service");
const repo = require("./smartcomm.call.repo");
const { CERTIFIED_PROVIDERS } = require("./smartcomm.call.vocab");
const events = require("./smartcomm.events");
const { emitEvent, audit, resolveActorId } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");
const realtime = require("../../realtime");
const requestContext = require("../../config/request-context");
const { logger } = require("../../config/logger");

const SIDES = ["caller", "callee"];
/** D6: two languages, no free-text field. */
const DRAFT_LANGUAGES = ["en", "fr"];
/**
 * How long the pipeline waits for a side's uploads before deciding they are not
 * coming. Uploads fire at hang-up and the last one re-enqueues immediately, so
 * this bound only ever applies to the misfire path (a tab killed mid-upload);
 * the caller's side of a 27-minute call is ~15–30 parts on a corridor
 * connection, which is why it is minutes and not seconds.
 */
const UPLOAD_GRACE_MS = 5 * 60 * 1000;
/** A PROCESSING row older than this is a dead worker's, not a live one's. */
const PROCESSING_STALE_MS = 10 * 60 * 1000;
/** One part of mono Opus at ~32 kbps for 120 s is ~0.5 MB; 12 MB is a bound on
 *  pathological input (a browser sending raw PCM), not a real ceiling. */
const MAX_PART_BYTES = 12 * 1024 * 1024;
/** A 30-minute call is a few hundred segments; the cap bounds a hostile body. */
const MAX_LIVE_SEGMENTS = 2000;
/** D7: audio is kept 30 days (tenant-overridable in PR-3's settings). */
const RETENTION_DAYS = 30;

const cref = (id) => "comms_call:" + id;

/* ── Small pure helpers (exported: they carry the contract, so they are
      tested directly rather than only through the database) ─────────────── */

/**
 * The vendor's language answer, as one of the two languages this product
 * speaks. Whisper reports a NAME ("English", "french") through verbose_json and
 * a code through other paths, so both are accepted; anything else (a Spanish
 * word in a French call, a mis-detection) falls back to `fallback` rather than
 * being invented. The fallback is the draft language — the caller's own app
 * language — because a part whose language cannot be read was, in practice,
 * heard by a caller running the product in that language.
 */
function toEnFr(value, fallback = "en") {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return fallback;
  if (v.startsWith("en") || v.startsWith("english")) return "en";
  if (v.startsWith("fr") || v.startsWith("french")) return "fr";
  return fallback;
}

/** Which side of the call this user is on, or null. */
function sideOf(call, userId) {
  if (!call || !userId) return null;
  if (call.caller_id === userId) return "caller";
  if (call.callee_id === userId) return "callee";
  return null;
}

/** Is this call a candidate for the pipeline at all? */
function isPipelineEligible(call) {
  if (!call) return false;
  if (call.status === "ENDED") return true;
  // A call that connected and then died (ICE exhaustion mid-call) has audio
  // too. "Runs regardless of reason" (§4.1) is only honest if it includes the
  // failure that happens AFTER media started.
  return call.status === "FAILED" && !!call.connected_at;
}

/**
 * The attributed transcript (guide §4.2): `Caller:` then `Callee:`, each in part
 * order, each part carrying its detected language.
 *
 * "A mid-call switch shows up as a language change between parts — never
 * re-guessed from a mix." The markers are literal `[en]` / `[fr]` labels because
 * the reader of this string is a language model drafting a summary, and the one
 * thing it must not do is silently translate a French sentence it cannot tell is
 * French.
 */
function buildAttributedTranscript({ rows, names = {} }) {
  const sides = SIDES.map((side) => {
    const mine = rows
      .filter((r) => r.side === side)
      .sort((a, b) => Number(a.part_index) - Number(b.part_index));
    const label = side === "caller" ? "Caller" : "Callee";
    const name = names[side] || null;
    const body = mine.length
      ? mine.map((r) => `[${r.language}] ${String(r.text || "").trim()}`).join("\n")
      : null;
    return {
      side,
      label,
      name,
      provider: mine[0]?.provider || null,
      certified: mine.length > 0 && mine.every((r) => r.certified === true),
      parts: mine.map((r) => ({
        part_index: Number(r.part_index),
        text: r.text,
        language: r.language,
        provider: r.provider,
        certified: r.certified === true,
      })),
      text: body,
    };
  });
  const text = sides
    .filter((s) => s.parts.length)
    .map((s) => `${s.label}${s.name ? ` (${s.name})` : ""}:\n${s.text}`)
    .join("\n\n");
  return { sides, text };
}

/**
 * Where a transcript's words came from, for the UI label.
 *
 *   browser-live  any current row is from the in-call capture (old calls only)
 *   gemini        certified, and at least one part went to Gemini
 *   groq          certified, every part from Groq
 */
function transcriptProvenance(rows) {
  if (rows.some((r) => r.certified !== true)) return "browser-live";
  return rows.some((r) => r.provider === "gemini") ? "gemini" : "groq";
}

/**
 * What the draft is worth. The LLM being down (or there being no words to
 * summarise) outranks the transcript's provenance: the sentence the caller
 * needs is "summary unavailable".
 */
function provenanceOf({ llmOk, rows }) {
  if (!llmOk || !rows.length) return "transcript-only";
  return transcriptProvenance(rows);
}

/** The prompt (§4.10). Exported so the language rules are testable as text. */
function summaryPrompt({ transcript, meta }) {
  const language = DRAFT_LANGUAGES.includes(meta.language) ? meta.language : "en";
  const languageName = language === "fr" ? "French" : "English";
  const system = [
    "You draft the summary of an internal voice call between two employees. The draft is reviewed and edited by the CALLER before anything is sent, so it must be accurate and boring rather than polished.",
    "",
    "RULES, in order of importance:",
    `1. Write the "summary" field in ${languageName}. It is the connective prose a colleague reads: what the call was about, what was decided, in 2 to 4 sentences.`,
    '2. This is the critical one: every "key_points[].text" and every "follow_ups[].text" MUST be the speaker\'s own words, VERBATIM, in the language they were actually spoken in. The transcript marks each part with its language ([en] or [fr]). NEVER translate them, never paraphrase them, never tidy their grammar — they are quotations from a certified record, and silently rewriting a business statement is the one thing this draft must not do. A French sentence stays French inside an English draft.',
    '3. key_points[].raised_by is "caller" or "callee" — who raised it. follow_ups[].owner is who is on the hook for it, and "due" is an ISO date (YYYY-MM-DD) or null when no date was mentioned.',
    "4. Never invent anything. If a date, an owner or an amount was not said, it is null or it is absent.",
    "",
    "Answer with JSON only, exactly this shape:",
    '{"summary": "...", "key_points": [{"text": "...", "raised_by": "caller"}], "follow_ups": [{"text": "...", "owner": "callee", "due": null}]}',
  ].join("\n");

  const metaLines = [
    `Call: ${meta.callerName || "Caller"} (caller) ↔ ${meta.calleeName || "Callee"} (callee)`,
    meta.durationSeconds ? `Duration: ${Math.round(meta.durationSeconds / 60)} minutes` : null,
    `Draft language: ${languageName}`,
  ].filter(Boolean);

  const user = [
    metaLines.join("\n"),
    "",
    "Attributed transcript (each part is labelled with the language spoken):",
    transcript || "(no words were captured for this call)",
  ].join("\n");

  return { system, user, language };
}

/* ── Realtime (best-effort, exactly like the call state machine's) ────────── */
function rtToUser(userId, event, payload, { slug = null, env = null } = {}) {
  const tenant = slug || requestContext.getTenant();
  const scope = env || requestContext.getEnv();
  if (tenant && userId) realtime.publishToUser(tenant, scope, userId, event, payload);
}

/** Is the recording half of calls switched on for this tenant? The tenant
 *  kill switch (decision row 2) — off means no recorder, no banner, and these
 *  routes answer 403 like every other gated feature. The routes carry
 *  `requireFeature`, so this exists for the SERVICE-side readers: the client is
 *  told the flag with the call it is in, so the consent banner is never shown
 *  over a call that is not being recorded. */
async function recordingEnabled(client) {
  const { rows } = await client.query(
    "SELECT state FROM feature_state WHERE feature_key = $1",
    ["call_recording"],
  );
  return !!rows[0] && rows[0].state === "on";
}

/* ── Ingest (the client's half of §4.5 step 1) ──────────────────────────── */

/** Participant + role. A stranger's id answers exactly like a missing one. */
async function participantCall(client, callId, userId) {
  const call = await repo.findCall(client, callId);
  if (!call) throw new AppError("NOT_FOUND", "Call not found", 404);
  const side = sideOf(call, userId);
  if (!side) throw new AppError("NOT_FOUND", "Call not found", 404);
  return { call, side };
}

const EXT_BY_TYPE = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
};

/**
 * One recorded part, uploaded at hang-up.
 *
 * The upload is the ONLY place the caller's app language is reported: there is
 * no per-user language column in the schema, and the draft language belongs to
 * the call — it is what THIS draft was written for. Only the caller's side may
 * set it (§4.10: the caller is the human in the loop).
 */
async function registerPart(client, {
  callId, actor, side, partIndex, partCount, durationMs, language = null, file, slug = null,
}) {
  const { call, side: mine } = await participantCall(client, callId, actor.user_id);
  if (side !== mine) {
    throw new AppError("NOT_YOUR_SIDE", "You can only upload your own side of a call", 403);
  }
  if (call.status === "RINGING") {
    throw new AppError("CALL_NOT_STARTED", "There is nothing recorded yet", 409);
  }
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new AppError("NO_FILE", "No audio in this upload", 400);
  }
  if (file.buffer.length > MAX_PART_BYTES) {
    throw new AppError("FILE_TOO_LARGE", `A recording part exceeds ${MAX_PART_BYTES / (1024 * 1024)} MB`, 413, {
      user_message: "That recording part is too large to upload. The rest of the call is unaffected.",
    });
  }

  const contentType = String(file.mimetype || "audio/webm").split(";")[0].trim() || "audio/webm";
  const ext = EXT_BY_TYPE[contentType] || "webm";
  // Same storage driver as voice notes (services/storage.service), different
  // prefix: calls are their own thing and the retention sweep must be able to
  // enumerate exactly them.
  const tenant = slug || requestContext.getTenant() || "tenant";
  const key = `tenant_${tenant}/comms/calls/${callId}/${side}_${String(partIndex).padStart(3, "0")}_${crypto.randomBytes(6).toString("hex")}.${ext}`;
  await storage.put(file.buffer, { key, contentType });

  const part = await repo.upsertRecordingPart(client, {
    callId,
    side,
    partIndex,
    partCount,
    vaultRef: key,
    mediaType: contentType,
    sizeBytes: file.buffer.length,
    durationSeconds: Math.max(1, Math.round((Number(durationMs) || 0) / 1000)),
  });

  if (mine === "caller" && DRAFT_LANGUAGES.includes(language) && call.summary_language !== language) {
    await repo.setSummaryLanguage(client, { callId, language });
  }
  // The call is visibly QUEUED from the first byte: the record the caller
  // looks at a second later says "transcribing", not nothing at all.
  if (!call.transcription_state) {
    await repo.setTranscriptionState(client, { callId, state: "PENDING" });
  }
  logger.info({ callId, side, partIndex, bytes: file.buffer.length }, "call: recording part stored");
  return part;
}

/** Normalise the live capture the client uploads (§4.9). Anything malformed is
 *  dropped rather than failing the upload: the audio is the side's real
 *  material, and the live log is the fallback behind it. */
function normaliseSegments(raw, fallbackLanguage) {
  let list = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      /* @silent:parse — a live-log body that is not JSON is dropped; the audio
         upload in the same request is the part that matters, and failing the
         whole request over the fallback's bookkeeping would lose the audio. */
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const s of list.slice(0, MAX_LIVE_SEGMENTS)) {
    if (!s || typeof s !== "object") continue;
    const text = String(s.text ?? "").trim();
    if (!text) continue;
    const seq = Number.isInteger(Number(s.seq)) && Number(s.seq) >= 0 ? Number(s.seq) : out.length;
    if (seen.has(seq)) continue;
    seen.add(seq);
    const language = DRAFT_LANGUAGES.includes(s.language) ? s.language : fallbackLanguage;
    const started = Number(s.started_ms);
    const ended = Number(s.ended_ms);
    out.push({
      seq,
      text: text.slice(0, 2000),
      language,
      startedMs: Number.isFinite(started) && started >= 0 ? Math.round(started) : null,
      endedMs: Number.isFinite(ended) && ended >= 0 ? Math.round(ended) : null,
    });
  }
  return out;
}

/**
 * The browser live capture, uploaded at hang-up (both the audio upload's
 * companion body and, on a retry, on its own).
 */
async function registerLiveLog(client, { callId, actor, side, segments, language = null }) {
  const { side: mine } = await participantCall(client, callId, actor.user_id);
  if (side !== mine) {
    throw new AppError("NOT_YOUR_SIDE", "You can only upload your own side of a call", 403);
  }
  const fallback = DRAFT_LANGUAGES.includes(language) ? language : "en";
  const normalised = normaliseSegments(segments, fallback);
  const written = await repo.upsertLiveLog(client, { callId, side, segments: normalised });
  return { side, written };
}

/* ── The pipeline (the job body) ────────────────────────────────────────── */

/** Names for the transcript header and the prompt. Nulls are honest: a call
 *  whose participant row has gone is still a call that happened. */
async function participantNames(client, call) {
  const { rows } = await client.query(
    "SELECT user_id, full_name FROM app_user WHERE user_id = ANY($1::uuid[])",
    [[call.caller_id, call.callee_id]],
  );
  const byId = new Map(rows.map((r) => [r.user_id, r.full_name]));
  return { caller: byId.get(call.caller_id) || null, callee: byId.get(call.callee_id) || null };
}

const errText = (err) => String((err && err.message) || err || "failed").slice(0, 200);

/**
 * One part, one Groq attempt, then one Gemini attempt (owner decision A-1).
 * No language hint (row 7): a hint forces a code-switched call into one
 * language, and Whisper's failure mode is a fluent translation.
 */
async function transcribePart({ part, vendor }) {
  let audio;
  try {
    audio = await storage.get(part.vault_ref);
  } catch (err) {
    // The bytes are gone: no provider can help, so no provider is called.
    logger.warn({ err, recording_id: part.recording_id }, "call: part bytes unreadable");
    return { ok: false, attempts: 0, error: "recording unreadable" };
  }
  let groqError;
  try {
    const out = await transcription.transcribe({
      audio,
      mimeType: part.media_type,
      language: null,
      vendor,
      detectLanguage: true,
      maxRetries: 0,
    });
    return { ok: true, attempts: 1, result: { ...out, provider: "groq" } };
  } catch (err) {
    groqError = err;
    logger.warn({ err, recording_id: part.recording_id }, "call: groq failed; trying gemini once");
  }
  try {
    const out = await geminiTranscription.transcribe({ audio, mimeType: part.media_type });
    return { ok: true, attempts: 2, result: out };
  } catch (err) {
    logger.warn({ err, recording_id: part.recording_id }, "call: gemini failed too; the part fails");
    return { ok: false, attempts: 2, error: `groq: ${errText(groqError)}; gemini: ${errText(err)}` };
  }
}

/**
 * One side, part by part. Returns every part's certified rows, or no rows and
 * the reason: a side with a hole is not certified, and nothing fills the hole.
 */
async function transcribeSide(client, {
  side, parts, vendor, language, userId, conversationId,
}) {
  const mine = parts.filter((p) => p.side === side).sort((a, b) => a.part_index - b.part_index);
  if (!mine.length) {
    return { side, certified: false, rows: [], reason: "no recording was uploaded for this side" };
  }

  const rows = [];
  for (const part of mine) {
    const outcome = await transcribePart({ part, vendor });
    if (!outcome.ok) {
      await repo.setPartResult(client, {
        recordingId: part.recording_id,
        status: "FAILED",
        language: null,
        error: outcome.error,
        attempts: Number(part.attempts || 0) + outcome.attempts,
      });
      return {
        side,
        certified: false,
        rows: [],
        reason: `part ${part.part_index} could not be transcribed (${outcome.error})`,
      };
    }

    const detected = toEnFr(outcome.result.detected_language, language);
    await repo.setPartResult(client, {
      recordingId: part.recording_id,
      status: "OK",
      language: detected,
      error: null,
      attempts: Number(part.attempts || 0) + outcome.attempts,
    });
    // D9: the call pipeline bills the same `voice` line as voice notes.
    await recordVoiceUsage(client, {
      userId,
      conversationId,
      result: outcome.result,
      fallbackSeconds: Number(part.duration_seconds) || 0,
    });
    rows.push({
      side,
      partIndex: Number(part.part_index),
      text: String(outcome.result.text || "").trim(),
      language: detected,
      provider: outcome.result.provider,
      certified: true,
    });
  }
  return { side, certified: true, rows, reason: null };
}

/** Usage recording is bookkeeping: a failure to record it must not fail the
 *  transcription that has ALREADY happened and been paid for. */
async function recordVoiceUsage(client, { userId, conversationId, result, fallbackSeconds }) {
  const usage = result.usage || {};
  try {
    await governance.recordUsage(client, {
      userId,
      featureKey: "voice",
      conversationId,
      provider: result.provider || "groq",
      model: result.model || null,
      callType: "transcribe",
      audioSeconds: result.audio_seconds || fallbackSeconds || 0,
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
    });
  } catch (err) {
    logger.warn({ err }, "call: recording voice usage failed");
  }
}

/** Statuses a call cannot leave. RINGING and IN_CALL are the only live ones. */
const TERMINAL_STATUSES = new Set(["ENDED", "FAILED", "NO_ANSWER", "CANCELLED", "DECLINED", "BUSY"]);

/** A terminal state for a call with nothing to transcribe (audit A5): no LLM,
 *  no alert, no notification, and never selected by the sweep again. */
async function markNoRecording(client, callId, reason) {
  await repo.setTranscriptionState(client, { callId, state: "NO_RECORDING", error: null });
  return { skipped: "no_recording", reason };
}

/**
 * The job body. `origin` is "hangup" (the job enqueued when the call ended) or
 * "sweep" (the daily reprocess). A sweep run never notifies anyone: no push, no
 * in-app row, no socket event (audit A4). Idempotent by state: a CERTIFIED call
 * with a draft, a NO_RECORDING call and a live PROCESSING run are left alone.
 */
async function processCall(client, {
  callId, tenantMeta = null, env = "live", user = null, slug = null, origin = "hangup",
}) {
  const tenant = slug || (tenantMeta && tenantMeta.slug) || null;
  // Where realtime events go: this tenant, and this call's env (audit A9).
  const rt = { slug: tenant, env };
  const announce = origin !== "sweep";
  const call = await repo.findCall(client, callId);
  if (!call) return { skipped: "missing" };
  if (call.transcription_state === "NO_RECORDING") return { skipped: "no_recording" };
  if (!isPipelineEligible(call)) {
    // A call that never connected has no audio. Marking it keeps it out of
    // the sweep's oldest-first window for good (audit B5).
    if (TERMINAL_STATUSES.has(call.status)) return markNoRecording(client, callId, "never_connected");
    return { skipped: "not_ended", status: call.status };
  }

  if (call.transcription_state === "PROCESSING" && call.transcription_updated_at
      && Date.now() - Date.parse(call.transcription_updated_at) < PROCESSING_STALE_MS) {
    return { skipped: "in_flight" };
  }
  const existingSummary = await repo.getSummary(client, callId);
  if (call.transcription_state === "CERTIFIED" && existingSummary) {
    return { skipped: "certified", summary_status: existingSummary.draft_status };
  }

  // No audio, no pipeline (audit A5), decided before any attempt is counted.
  if (!(await recordingEnabled(client))) return markNoRecording(client, callId, "recording_off");
  const parts = await repo.listRecordingParts(client, callId);
  const withinGrace = call.ended_at
    && Date.now() - Date.parse(call.ended_at) < UPLOAD_GRACE_MS;
  // A side with nothing uploaded yet may still be flushing. The hang-up
  // enqueue is delayed for that; the daily sweep catches what it leaves.
  const missing = SIDES.filter((side) => !parts.some((p) => p.side === side));
  if (missing.length && withinGrace) {
    return { waiting: true, missing, ended_at: call.ended_at };
  }
  if (!parts.length) return markNoRecording(client, callId, "no_parts");

  // The governance gate (D9). A refusal is recorded on the call and counted as
  // an attempt, so the daily retry of a refused call is bounded too.
  const gate = await governance.canUseFeature(client, {
    userId: call.caller_id,
    featureKey: "calls",
  });
  if (!gate.allowed) {
    await repo.bumpTranscriptionAttempts(client, callId);
    await repo.setTranscriptionState(client, {
      callId,
      state: "TRANSCRIPTION_FAILED",
      error: gate.reason || "Call transcription is not available on this plan right now",
    });
    if (announce) {
      const payload = { call_id: callId, reason: gate.reason || "unavailable" };
      rtToUser(call.caller_id, "call:transcription_failed", payload, rt);
      rtToUser(call.callee_id, "call:transcription_failed", payload, rt);
    }
    return { blocked: true, reason: gate.reason };
  }

  const names = await participantNames(client, call);
  const draftLanguage = DRAFT_LANGUAGES.includes(call.summary_language) ? call.summary_language : "en";
  const firstFailure = call.transcription_state !== "TRANSCRIPTION_FAILED";

  await repo.bumpTranscriptionAttempts(client, callId);
  await repo.setTranscriptionState(client, { callId, state: "PROCESSING" });

  let vendor = null;
  try {
    vendor = await require("../../services/platform/ai-vendor.service").getConfig("groq");
  } catch (err) {
    // Preserve the env fallback documented in transcription.service — a
    // platform-DB outage must not be the reason a call has no transcript.
    logger.warn({ err }, "call: could not resolve the platform transcription vendor");
  }

  const perSide = {};
  for (const side of SIDES) {
    perSide[side] = await transcribeSide(client, {
      side,
      parts,
      vendor,
      language: draftLanguage,
      userId: call.caller_id,
      conversationId: null,
    });
    if (perSide[side].rows.length) {
      // Certified rows land first, then an old call's browser-capture rows are
      // retired, so a reader never sees a moment with no current rows.
      await repo.insertTranscriptRows(client, {
        callId, side, rows: perSide[side].rows,
      });
      await repo.retireFlaggedRows(client, { callId, side });
    }
  }

  const allCertified = SIDES.every((s) => perSide[s].certified && perSide[s].rows.length > 0);
  const failures = SIDES
    .filter((s) => !perSide[s].certified || !perSide[s].rows.length)
    .map((s) => `${s}: ${perSide[s].reason || "no transcript"}`);

  await repo.setTranscriptionState(client, {
    callId,
    state: allCertified ? "CERTIFIED" : "TRANSCRIPTION_FAILED",
    error: allCertified ? null : failures.join(" · ").slice(0, 500),
  });

  await emitEvent(client, {
    eventTypeKey: allCertified ? events.CALL_TRANSCRIBED : events.CALL_TRANSCRIPTION_FAILED,
    moduleKey: events.MODULE,
    entityRef: cref(callId),
    actorUserId: await resolveActorId(client, user && user.user_id),
  });
  await audit(client, {
    actorUserId: await resolveActorId(client, user && user.user_id),
    action: allCertified ? events.CALL_TRANSCRIBED : events.CALL_TRANSCRIPTION_FAILED,
    moduleKey: events.MODULE,
    entityRef: cref(callId),
    after: { state: allCertified ? "CERTIFIED" : "TRANSCRIPTION_FAILED", failures },
  });

  if (!allCertified) {
    // Visible on both ends and retried by the sweep. Ops hears about a call's
    // FIRST failure only, not every nightly re-run of it (audit A4).
    if (announce) {
      const payload = { call_id: callId, reason: failures.join(" · ").slice(0, 200) };
      rtToUser(call.caller_id, "call:transcription_failed", payload, rt);
      rtToUser(call.callee_id, "call:transcription_failed", payload, rt);
    }
    if (firstFailure) await raiseOpsAlert({ call, failures, tenantMeta, env });
  }

  // ── The summary draft ──
  const current = await repo.listCurrentTranscripts(client, callId);
  const credited = buildAttributedTranscript({
    rows: current,
    names: { caller: names.caller, callee: names.callee },
  });
  const everyRowCertified = current.length > 0 && current.every((r) => r.certified === true);

  // A DISCARDED draft is a decision the caller made. Regenerating it behind
  // their back would be the one form of auto-post this file refuses.
  if (existingSummary && existingSummary.draft_status === "DISCARDED") {
    return { call_id: callId, state: allCertified ? "CERTIFIED" : "TRANSCRIPTION_FAILED", summary: "discarded" };
  }

  const drafted = await draftSummary(client, {
    call, names, transcript: credited, rows: current, language: draftLanguage, failures,
  });

  if (existingSummary && existingSummary.draft_status === "SENT") {
    // A SENT summary is never rewritten. The caller is offered an optional
    // update, and only when the record went from unverified to certified.
    const improved = everyRowCertified && !CERTIFIED_PROVIDERS.includes(existingSummary.provenance);
    if (improved) {
      await repo.markUpdateAvailable(client, callId);
      if (announce) {
        rtToUser(call.caller_id, "call:summary_ready", {
          call_id: callId, status: "UPDATE_AVAILABLE", provenance: drafted.provenance,
        }, rt);
      }
    }
    return {
      call_id: callId,
      state: allCertified ? "CERTIFIED" : "TRANSCRIPTION_FAILED",
      summary: improved ? "update_available" : "kept",
    };
  }

  const stored = await repo.upsertSummaryDraft(client, {
    callId,
    summaryText: drafted.summary_text,
    keyPoints: drafted.key_points,
    followUps: drafted.follow_ups,
    language: drafted.language,
    provenance: drafted.provenance,
  });

  await emitEvent(client, {
    eventTypeKey: events.CALL_SUMMARY_DRAFTED,
    moduleKey: events.MODULE,
    entityRef: cref(callId),
    actorUserId: null,
  });
  // Notify once per call (audit A4): the claim on notified_at is atomic, and a
  // sweep run never claims, so a sweep-made draft waits in the Calls list.
  if (announce && await repo.claimSummaryNotification(client, callId)) {
    await notifySummaryReady(client, { call, summary: stored, names, rt });
  }

  logger.info(
    { callId, state: stored ? "ready" : "none", provenance: drafted.provenance, language: drafted.language },
    "call: pipeline finished",
  );
  return {
    call_id: callId,
    state: allCertified ? "CERTIFIED" : "TRANSCRIPTION_FAILED",
    sides: Object.fromEntries(SIDES.map((s) => [s, perSide[s].certified ? "certified" : "flagged"])),
    summary: { provenance: drafted.provenance, language: drafted.language, draft_status: stored?.draft_status },
  };
}

/**
 * Ops alert for the one visible failure path (§4.5 step 3).
 *
 * Never throws: an alerting failure must not be able to turn a degraded call
 * into a failed job, because that would lose the retry too.
 */
async function raiseOpsAlert({ call, failures, tenantMeta, env = "live" }) {
  try {
    await alerts.raise({
      event: "comms.transcription_failed",
      subject: `Call transcript fell back to the browser capture (${failures[0] || "reason unknown"})`,
      detail: {
        env,
        call_id: call.call_id,
        caller_id: call.caller_id,
        callee_id: call.callee_id,
        failures,
        note: "The flagged transcript is live and the caller has a draft. The daily reprocess retries the certified version.",
      },
      tenant: (tenantMeta && tenantMeta.slug) || requestContext.getTenant() || null,
    });
  } catch (err) {
    logger.warn({ err, callId: call.call_id }, "call: ops alert failed");
  }
}

/**
 * The draft itself (§4.10).
 *
 * SUCCESS → the model's JSON, sanitised through the SHARED schema.
 * FAILURE → the attributed transcript IS the draft, `provenance:
 * 'transcript-only'`, labelled in the UI as "summary unavailable — provider
 * down". Still sendable: the caller gets the words they said, which is the
 * whole point of the guarantee.
 */
async function draftSummary(client, { call, names, transcript, rows, language, failures }) {
  // No words, no summary: asking the model anyway is how "(no words were
  // captured)" became a confident summary of a call (audit A5).
  if (!rows.length) {
    return {
      provenance: "transcript-only",
      language,
      summary_text: `No speech was captured for this call (${failures.join(" · ") || "no transcript"}).`,
      key_points: [],
      follow_ups: [],
    };
  }
  const prompt = summaryPrompt({
    transcript: transcript.text,
    meta: {
      language,
      callerName: names.caller,
      calleeName: names.callee,
      durationSeconds: call.duration_seconds,
    },
  });

  let out = null;
  try {
    out = await llm.chat({
      client,
      messages: [
        { role: "system", content: prompt.system, cachePrefix: prompt.system },
        { role: "user", content: prompt.user },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0.2,
      // Owner decision A-2: Gemini first, DeepSeek only as the last resort.
      vendorName: "gemini",
      fallbackVendor: "deepseek",
    });
  } catch (err) {
    logger.warn({ err, callId: call.call_id }, "call: summary LLM call threw");
    out = null;
  }

  // `llm.chat` degrades to a stub rather than throwing when every vendor is
  // down, so "no provider" is `provider === null` — the same signal the
  // orchestrator reads. A parse failure is equivalent for our purposes: there
  // is no summary to be had, and there IS a transcript to fall back to.
  const usable = out && out.provider && out.text;
  const parsed = usable ? callSummary.sanitise(out.text) : null;

  if (parsed) {
    try {
      await recordSummaryUsage(client, { call, out });
    } catch (err) {
      logger.warn({ err, callId: call.call_id }, "call: summary usage recording failed");
    }
    return {
      provenance: provenanceOf({ llmOk: true, rows }),
      language,
      summary_text: parsed.summary,
      // VERBATIM: stored exactly as the model returned them (only trimmed), in
      // the language spoken. Nothing in this pipeline translates or re-words
      // them — see §4.10 and the prompt's rule 2.
      key_points: parsed.key_points,
      follow_ups: parsed.follow_ups,
    };
  }

  return {
    provenance: provenanceOf({ llmOk: false, rows }),
    language,
    summary_text: transcript.text
      || `No speech was captured for this call (${failures.join(" · ") || "no transcript"}).`,
    key_points: [],
    follow_ups: [],
  };
}

/** The summary is an AI call like any other: its tokens are metered against the
 *  `calls` feature line so a tenant's AI budget tells the truth about it. */
async function recordSummaryUsage(client, { call, out }) {
  const usage = (out && out.usage) || {};
  await governance.recordUsage(client, {
    userId: call.caller_id,
    featureKey: "calls",
    provider: out.provider,
    model: out.model || null,
    callType: "call_summary",
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
  });
}

/** "24/09/2026" and "14:05" in the tenant's timezone (hr.timezone), day-first. */
function dayFirst(iso, timeZone) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(at);
  return { date, time };
}

/**
 * Tell the caller (socket + one notification with its push). The copy names
 * the other person, a day-first time and the duration (audit A11); the service
 * worker re-renders it in the device's language from `pushData`. Best-effort:
 * the draft is already stored, and a failed push must not lose it.
 */
async function notifySummaryReady(client, { call, summary, names, rt = {} }) {
  rtToUser(call.caller_id, "call:summary_ready", {
    call_id: call.call_id,
    status: summary.draft_status,
    provenance: summary.provenance,
  }, rt);
  try {
    const { timezoneOf } = require("../hr/attendance/attendance.reconcile");
    const when = call.ended_at ? dayFirst(call.ended_at, await timezoneOf(client)) : null;
    const peer = (names && names.callee) || null;
    const minutes = Number(call.duration_seconds) > 0
      ? Math.max(1, Math.round(Number(call.duration_seconds) / 60))
      : null;
    const body = [
      peer ? `Your call with ${peer}` : "Your call",
      when ? ` on ${when.date} at ${when.time}` : "",
      minutes ? ` (${minutes} min)` : "",
      ". Review and send the summary.",
    ].join("");
    await require("../notification/notification.service").notifyMany(client, [call.caller_id], {
      eventTypeKey: "comms.call_summary_ready",
      title: "Call summary ready",
      body,
      entityRef: cref(call.call_id),
      category: "comms",
      url: `/comms/calls/${call.call_id}`,
      pushTag: `comms:call:${call.call_id}`,
      pushData: {
        kind: "call_summary",
        call_id: call.call_id,
        peer_name: peer,
        ended_at: call.ended_at || null,
        duration_seconds: Number(call.duration_seconds) || null,
      },
    });
  } catch (err) {
    /* @silent:storage|parse|teardown */
    logger.warn({ err, callId: call.call_id }, "call: summary notification failed");
  }
}

/* ── Starting the pipeline ──────────────────────────────────────────────── */

/**
 * Enqueue the transcription of one call: from the ENDED transition (origin
 * "hangup", delayed while the clients flush their parts) and from the daily
 * sweep (origin "sweep", which never notifies). The queue de-duplicates on the
 * call id. Nothing re-enqueues from the upload path yet (audit A2, PR-2).
 */
async function startPipeline({
  callId, tenantMeta = null, env = "live", user = null, delayMs = 0, origin = "hangup",
}) {
  if (!callId) return null;
  try {
    const { enqueue } = require("../../jobs/queue-producer");
    return await enqueue("call-transcribe", "transcribe", {
      callId, tenantMeta, env, user, origin,
    }, {
      jobId: `calltranscribe-${callId}`,
      delay: delayMs,
      attempts: 2,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  } catch (err) {
    // The queue is best-effort here on purpose: the daily sweep picks up any
    // ENDED call whose pipeline never ran (listUntranscribedEndedCalls), so a
    // Redis outage costs latency, not the transcript.
    logger.warn({ err, callId }, "call: could not enqueue the transcription job");
    return null;
  }
}

/* ── Reads (the transcript and the draft) ───────────────────────────────── */

/**
 * The attributed transcript, for a participant.
 *
 * `sides` carries the per-part language, which is the shape the UI renders
 * (§4.10's toggle and the call record's language chips) and the shape the
 * reprocess reads. `text` is the attributed transcript the LLM and the vault
 * link show.
 */
async function getTranscript(client, { callId, actor }) {
  const { call } = await participantCall(client, callId, actor.user_id);
  const rows = await repo.listCurrentTranscripts(client, callId);
  const names = await participantNames(client, call);
  const built = buildAttributedTranscript({
    rows,
    names: { caller: names.caller, callee: names.callee },
  });
  const anyFlagged = rows.some((r) => r.certified !== true);
  return {
    call_id: callId,
    state: call.transcription_state || "PENDING",
    error: call.transcription_error || null,
    certified: rows.length > 0 && !anyFlagged,
    provenance: transcriptProvenance(rows),
    text: built.text,
    sides: built.sides,
    parts: rows.map((r) => ({
      side: r.side,
      part_index: r.part_index,
      language: r.language,
      provider: r.provider,
      certified: r.certified === true,
    })),
  };
}

/** The current draft, for a participant. The callee can READ it (it is the
 *  conversation's record) but only the caller can send or regenerate it. */
async function getSummary(client, { callId, actor }) {
  const { call } = await participantCall(client, callId, actor.user_id);
  const summary = await repo.getSummary(client, callId);
  const recording = await recordingEnabled(client);
  return {
    call_id: callId,
    transcription_state: call.transcription_state || "PENDING",
    transcription_error: call.transcription_error || null,
    recording_enabled: recording,
    is_caller: call.caller_id === actor.user_id,
    summary: summary
      ? {
        summary_id: summary.summary_id,
        summary_text: summary.summary_text,
        key_points: summary.key_points || [],
        follow_ups: summary.follow_ups || [],
        language: summary.language,
        provenance: summary.provenance,
        draft_status: summary.draft_status,
        sent_message_id: summary.sent_message_id || null,
        update_available: summary.update_available === true,
        update_message_id: summary.update_message_id || null,
        regenerate_count: Number(summary.regenerate_count) || 0,
      }
      : null,
  };
}

/** The card a chat reader sees, resolved live for a page of attachments (the
 *  erp-card pattern). One map keyed by call_id, built from one query. */
async function cardsForCallIds(client, callIds) {
  const ids = [...new Set((callIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const { rows } = await client.query(
    `SELECT s.call_id, s.summary_text, s.key_points, s.follow_ups, s.language,
            s.provenance, s.draft_status, s.update_available,
            c.duration_seconds, c.ended_at, c.status AS call_status,
            c.transcription_state, c.transcription_error,
            cu.full_name AS caller_name, bu.full_name AS callee_name
       FROM comms_call_summary s
       JOIN comms_call c ON c.call_id = s.call_id
       LEFT JOIN app_user cu ON cu.user_id = c.caller_id
       LEFT JOIN app_user bu ON bu.user_id = c.callee_id
      WHERE s.call_id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.call_id, r]));
}

/* ── The caller's three actions (and the only writer of a chat message) ─── */

/** The caller's own side, or a 403 with a sentence — the callee reads the
 *  record, and the caller is the one who acts on it (decision row 3). */
async function callerCall(client, callId, userId) {
  const { call } = await participantCall(client, callId, userId);
  if (call.caller_id !== userId) {
    throw new AppError("NOT_CALLER", "Only the caller can send this summary", 403);
  }
  return call;
}

/**
 * POST /calls/:id/summary/send — the caller's one tap on an editable draft.
 *
 * The body carries the FINAL content (the caller's edits), validated with the
 * shared strict schema, so what is stored, what is posted and what the caller
 * read on screen cannot be three different things. The message is a normal
 * message from the caller (`smartcomm.service.postMessage`, caller as actor —
 * auditable and exportable like every other), with a CALL attachment the client
 * renders as a summary card.
 *
 * SENDING is allowed in exactly two states:
 *   PENDING_REVIEW                        the first send
 *   SENT + update_available               the optional update message (§4.5)
 * and in no others. There is no auto-post path, and there is no second send of
 * a summary that has already been posted.
 */
async function sendSummary(client, {
  callId, actor, summaryText, keyPoints, followUps, tenantMeta = null, env = "live",
}) {
  const call = await callerCall(client, callId, actor.user_id);
  const summary = await repo.getSummary(client, callId);
  if (!summary) {
    throw new AppError("NO_SUMMARY", "There is no summary for this call yet", 404);
  }
  if (summary.draft_status === "DISCARDED") {
    throw new AppError("SUMMARY_DISCARDED", "That draft was discarded", 409);
  }
  const isUpdate = summary.draft_status === "SENT" && summary.update_available === true;
  if (summary.draft_status === "SENT" && !isUpdate) {
    throw new AppError("SUMMARY_ALREADY_SENT", "That summary has already been sent", 409);
  }

  // The strict shared schema: the caller's OWN edit is the one payload that has
  // to satisfy the contract exactly, because it is the one a human wrote.
  const parsed = callSummary.schema.parse({
    summary: summaryText ?? summary.summary_text,
    key_points: keyPoints ?? summary.key_points ?? [],
    follow_ups: followUps ?? summary.follow_ups ?? [],
  });

  const edited = await repo.applySummaryEdit(client, {
    callId,
    summaryText: parsed.summary,
    keyPoints: parsed.key_points,
    followUps: parsed.follow_ups,
  });

  const smartcomm = require("./smartcomm.service");
  const message = await smartcomm.postMessage(client, {
    groupId: call.group_id,
    // The body is the prose the caller approved; the card adds the points, the
    // follow-ups and the transcript link.
    body: isUpdate
      ? `${parsed.summary}\n\n[Updated call summary]`
      : parsed.summary,
    attachments: [{
      attachment_kind: "CALL",
      call_id: callId,
      content_type: "application/vnd.praxis.call-summary",
      filename: null,
      size_bytes: null,
    }],
    actor,
    tenantMeta,
    env,
  });
  if (!message) {
    throw new AppError("SEND_FAILED", "The summary could not be posted", 500);
  }

  const updated = isUpdate
    ? await repo.markSummaryUpdateSent(client, { callId, messageId: message.message_id })
    : await repo.markSummarySent(client, { callId, messageId: message.message_id });

  await emitEvent(client, {
    eventTypeKey: events.CALL_SUMMARY_SENT,
    moduleKey: events.MODULE,
    entityRef: cref(callId),
    actorUserId: await resolveActorId(client, actor.user_id),
  });
  logger.info({ callId, isUpdate, messageId: message.message_id }, "call: summary posted by the caller");
  return {
    call_id: callId,
    is_update: isUpdate,
    message_id: message.message_id,
    draft_status: updated ? updated.draft_status : "SENT",
    summary: edited
      ? { summary_text: edited.summary_text, key_points: edited.key_points, follow_ups: edited.follow_ups }
      : null,
  };
}

/** POST /calls/:id/summary/discard — the caller says no. The row stays (the
 *  record of the conversation keeps its draft) and its status is the truth. */
async function discardSummary(client, { callId, actor }) {
  await callerCall(client, callId, actor.user_id);
  const row = await repo.markSummaryDiscarded(client, callId);
  if (!row) {
    throw new AppError("SUMMARY_NOT_PENDING", "There is no draft waiting to be discarded", 409);
  }
  return { call_id: callId, draft_status: row.draft_status };
}

/**
 * POST /calls/:id/summary/regenerate { language } — the EN/FR toggle (§4.10).
 *
 * PENDING_REVIEW only: a SENT summary is never regenerated, only offered as an
 * optional update. Language has to differ from the current draft, because a
 * "regenerate" that produces the same language is a request to re-roll the
 * prose, and the caller asked for the other language.
 */
async function regenerateSummary(client, { callId, actor, language }) {
  await callerCall(client, callId, actor.user_id);
  const summary = await repo.getSummary(client, callId);
  if (!summary) throw new AppError("NO_SUMMARY", "There is no summary for this call yet", 404);
  if (summary.draft_status !== "PENDING_REVIEW") {
    throw new AppError(
      "SUMMARY_NOT_PENDING_REVIEW",
      "Only a draft that has not been sent can be regenerated",
      409,
    );
  }
  if (!DRAFT_LANGUAGES.includes(language)) {
    throw new AppError("BAD_LANGUAGE", "That language is not supported", 422);
  }

  const call = await repo.findCall(client, callId);
  const names = await participantNames(client, call);
  const rows = await repo.listCurrentTranscripts(client, callId);
  const transcript = buildAttributedTranscript({
    rows,
    names: { caller: names.caller, callee: names.callee },
  });
  const failures = rows.length ? [] : ["no transcript rows"];

  const drafted = await draftSummary(client, {
    call, names, transcript, rows, language, failures,
  });
  const stored = await repo.upsertSummaryDraft(client, {
    callId,
    summaryText: drafted.summary_text,
    keyPoints: drafted.key_points,
    followUps: drafted.follow_ups,
    language: drafted.language,
    provenance: drafted.provenance,
  });
  await repo.bumpRegenerateCount(client, { callId, language: drafted.language });
  await emitEvent(client, {
    eventTypeKey: events.CALL_SUMMARY_DRAFTED,
    moduleKey: events.MODULE,
    entityRef: cref(callId),
    actorUserId: await resolveActorId(client, actor.user_id),
  });
  logger.info({ callId, language: drafted.language }, "call: summary draft regenerated");
  return {
    call_id: callId,
    language: drafted.language,
    provenance: drafted.provenance,
    summary: {
      summary_text: drafted.summary_text,
      key_points: drafted.key_points,
      follow_ups: drafted.follow_ups,
      draft_status: stored ? stored.draft_status : "PENDING_REVIEW",
    },
  };
}

/* ── Retention (D7) ─────────────────────────────────────────────────────── */

/**
 * Delete the recorded AUDIO of calls past the retention window. The transcripts
 * and the summaries are permanent: the audio is the raw material, the text is
 * the record.
 *
 * The storage delete is best-effort per part and the row is only marked purged
 * when the bytes are really gone or already missing — marking first would leak
 * the object forever, which is the one outcome a retention sweep must not
 * produce.
 */
async function purgeExpiredAudio(client, { days = RETENTION_DAYS } = {}) {
  const due = await repo.partsAwaitingPurge(client, { olderThanDays: days });
  const gone = [];
  for (const part of due) {
    try {
      await storage.delete(part.vault_ref);
      gone.push(part.recording_id);
    } catch (err) {
      logger.warn({ err, recording_id: part.recording_id }, "call: audio purge failed for one part");
    }
  }
  const purged = await repo.markPartsPurged(client, gone);
  return { due: due.length, purged, failed: due.length - gone.length };
}

module.exports = {
  // ingest
  recordingEnabled,
  registerPart,
  registerLiveLog,
  // the pipeline
  startPipeline,
  processCall,
  isPipelineEligible,
  purgeExpiredAudio,
  // reads
  getTranscript,
  getSummary,
  cardsForCallIds,
  // the caller's actions
  sendSummary,
  discardSummary,
  regenerateSummary,
  // pure helpers (the contract, tested directly)
  toEnFr,
  sideOf,
  buildAttributedTranscript,
  transcriptProvenance,
  provenanceOf,
  summaryPrompt,
  normaliseSegments,
  // constants
  UPLOAD_GRACE_MS,
  RETENTION_DAYS,
  SIDES,
};
