/**
 * Smart Comms calls — the BRAIN (PR-2, guide §4.5 / §4.9 / §4.10).
 *
 * Everything that happens to a call after it ends lives here: the recorded parts
 * are transcribed part by part with NO forced language, the attributed
 * transcript is assembled, the summary draft is written into the CALLER's app
 * language, and the caller is told it is ready.
 *
 * ── THE TRANSCRIPT-NEVER-DIES CHAIN, IN CODE ───────────────────────────────
 *
 *   1. per side, per 60–120 s part: `transcription.service.transcribe` with
 *      `detectLanguage` and no hint (row 7). Three attempts per part, backoff
 *      between them; the vendor's own language answer is stored on the part.
 *   2. ALL PARTS OK  → transcript rows, provider 'groq', certified TRUE.
 *      ANY PART FAILS → the WHOLE SIDE falls back (step 3). A transcript with a
 *      hole in it is worse than a complete flagged one: a reader cannot tell
 *      which sentences are missing.
 *   3. FALLBACK: the side's live capture (§4.9) becomes transcript rows
 *      covering the SAME part spans, provider 'browser-live', certified FALSE.
 *      The call goes TRANSCRIPTION_FAILED — visible in the call record, alerted
 *      to ops, and picked up by the daily reprocess.
 *   4. REPROCESS (this file, re-entered by the sweep): the certified rows land,
 *      the flagged rows are RETIRED (never deleted — what the caller was told at
 *      the time is part of the record), and the draft is regenerated only while
 *      it is still PENDING_REVIEW. A SENT summary is never rewritten: the caller
 *      is OFFERED an optional update message instead.
 *   5. SUMMARY: `llm.service` (DeepSeek → Gemini). Down → the draft IS the
 *      attributed transcript, provenance 'transcript-only', labelled in the UI
 *      as "summary unavailable — provider down". Still sendable. The transcript
 *      exists either way — that is the guarantee.
 *
 * The ONLY no-transcript state that exists is Groq down AND no browser
 * recogniser AND the upload failed. It is not silent: the call record says
 * TRANSCRIPTION_FAILED with the reason, both ends are told over the socket, ops
 * is alerted, and the reprocess keeps trying.
 *
 * ── PROVENANCE IS LAW ──────────────────────────────────────────────────────
 *
 * A 'browser-live' summary is visibly labelled "generated from the in-call
 * browser capture (unverified)". Certified rows are always provider-produced
 * from the vaulted bytes (the CHECK constraint in migration 14010 makes that
 * true in the schema, not merely here). Browser words are never certified into
 * the record — the standing rule from chat/browser-transcribe.ts.
 *
 * ── NO AUTO-POST PATH ─────────────────────────────────────────────────────
 *
 * Nothing in this file writes a chat message except `sendSummary`, which
 * requires the CALLER as the actor and a draft the caller has reviewed. There is
 * no scheduled, no automatic and no "helpful" variant. That is decision row 3,
 * and it is why `sendSummary` is the only function here that touches
 * `comms_message` at all.
 */
"use strict";

const crypto = require("crypto");
const { callSummary } = require("@praxis/shared");
const storage = require("../../services/storage.service");
const transcription = require("../../services/ai/transcription.service");
const llm = require("../../services/ai/llm.service");
const governance = require("../ai/governance/governance.service");
const alerts = require("../../services/platform/alert-routing.service");
const repo = require("./smartcomm.call.repo");
const events = require("./smartcomm.events");
const { emitEvent, audit, resolveActorId } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");
const realtime = require("../../realtime");
const requestContext = require("../../config/request-context");
const { logger } = require("../../config/logger");

const SIDES = ["caller", "callee"];
/** D6: two languages, no free-text field. */
const DRAFT_LANGUAGES = ["en", "fr"];
/** 3 attempts per part (§4.5 step 2). */
const PART_RETRIES = 3;
/** Between attempts. Short: the job already has BullMQ's own backoff on top. */
const RETRY_BACKOFF_MS = 800;
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
 * The part spans of a side, as [startMs, endMs) windows.
 *
 * Derived from the parts' own durations rather than from wall-clock times:
 * a part boundary IS the language boundary (row 7), and the live capture's
 * timestamps are relative to the side's recording start, so this is the only
 * arithmetic that lets a segment be attributed to the span it belongs to.
 */
function partSpans(parts) {
  let at = 0;
  return parts.map((p) => {
    const start = at;
    at += Math.max(0, Number(p.duration_seconds) || 0) * 1000;
    return { partIndex: p.part_index, startMs: start, endMs: at };
  });
}

/**
 * Group a side's live-capture segments into the part spans they belong to.
 *
 * A segment that straddles a boundary is attributed to the span containing its
 * MIDPOINT — the recogniser's segment is a sentence-ish chunk, and splitting one
 * across two spans would be a word cut in half. A segment with no timestamps
 * (an old client, a recogniser that never reported an offset) is appended to the
 * LAST span, which keeps the text rather than discarding words the fallback is
 * going to need.
 */
function groupSegmentsByPart(segments, spans) {
  const buckets = new Map(spans.map((s) => [s.partIndex, []]));
  if (!spans.length) return buckets;
  const last = spans[spans.length - 1];
  for (const seg of segments) {
    const start = Number.isFinite(Number(seg.started_ms)) ? Number(seg.started_ms) : null;
    const end = Number.isFinite(Number(seg.ended_ms)) ? Number(seg.ended_ms) : start;
    if (start === null) {
      buckets.get(last.partIndex).push(seg);
      continue;
    }
    const mid = (start + (end === null ? start : end)) / 2;
    const span = spans.find((s) => mid >= s.startMs && mid < s.endMs) || last;
    buckets.get(span.partIndex).push(seg);
  }
  return buckets;
}

/**
 * The fallback rows for ONE side (§4.5 step 3): the live capture, cut along the
 * recorded part spans, one row per span.
 *
 * `language` is the recogniser's language — the app language of the side that
 * ran it (the two recognisers cannot run in one browser, and the fallback is
 * therefore strong in that language and best-effort in the other; that is why
 * it is flagged). A span with no words at all still produces a row with an empty
 * text: "this span was captured and contained nothing" is honest information,
 * and it is also what lets the caller see the SHAPE of what was lost.
 */
function fallbackRowsForSide({ side, parts, segments, language }) {
  const spans = partSpans(parts);
  const buckets = groupSegmentsByPart(segments, spans);
  return spans.map((span) => {
    const segs = buckets.get(span.partIndex) || [];
    const text = segs.map((s) => String(s.text || "").trim()).filter(Boolean).join(" ").trim();
    const rowLanguage = segs.find((s) => DRAFT_LANGUAGES.includes(s.language))?.language || language;
    return {
      side,
      partIndex: span.partIndex,
      text,
      language: DRAFT_LANGUAGES.includes(rowLanguage) ? rowLanguage : "en",
      provider: "browser-live",
      certified: false,
    };
  });
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
 * What the draft is WORTH (§4.10 / the UI labels).
 *
 *   groq             every current transcript row is certified
 *   browser-live     at least one side fell back to the in-call capture
 *   transcript-only  the LLM was down and the transcript IS the draft
 *
 * The LLM being down outranks the transcript's provenance: the sentence the
 * caller needs to read is "summary unavailable — provider down", and burying it
 * under a provenance note about audio would be the wrong headline.
 */
function provenanceOf({ llmOk, certified }) {
  if (!llmOk) return "transcript-only";
  return certified ? "groq" : "browser-live";
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
function rtToUser(userId, event, payload, slugOverride) {
  const slug = slugOverride || requestContext.getTenant();
  if (slug && userId) realtime.publishToUser(slug, userId, event, payload);
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

/** The per-part attempt loop: 3 tries, backoff between them, no forced
 *  language, and the vendor's own detected language carried out. */
async function transcribePart({ part, vendor }) {
  let lastError = null;
  let audio;
  try {
    audio = await storage.get(part.vault_ref);
  } catch (err) {
    // The bytes are gone or unreadable: retrying the provider will not help,
    // so this is a hard failure for the part, said plainly.
    logger.warn({ err, recording_id: part.recording_id }, "call: part bytes unreadable");
    return { ok: false, error: "recording unreadable" };
  }
  for (let attempt = 1; attempt <= PART_RETRIES; attempt += 1) {
    try {
      const out = await transcription.transcribe({
        audio,
        mimeType: part.media_type,
        // NO language hint: row 7 — per-part auto-detect, and a hint would
        // force a code-switched call into one language (or, worse, translate
        // it silently — see transcription.service.js's own warning).
        language: null,
        vendor,
        detectLanguage: true,
      });
      return { ok: true, result: out };
    } catch (err) {
      lastError = err;
      logger.warn(
        { err, recording_id: part.recording_id, attempt, of: PART_RETRIES },
        "call: part transcription attempt failed",
      );
      if (attempt < PART_RETRIES) {
        await delay(RETRY_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  }
  return { ok: false, error: (lastError && lastError.message) || "transcription failed" };
}

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * ONE side, part by part. Returns either the certified rows or the flagged
 * fallback rows — never a mixture (§4.5 step 2).
 */
async function transcribeSide(client, {
  side, parts, segments, vendor, language, userId, conversationId,
}) {
  const mine = parts.filter((p) => p.side === side).sort((a, b) => a.part_index - b.part_index);
  if (!mine.length) {
    // No audio for this side at all. That is not a transcription failure
    // (nothing was there to transcribe) — it is the one visible hole, and the
    // caller of this function says so out loud.
    return { side, certified: false, rows: [], reason: "no recording was uploaded for this side" };
  }

  const rows = [];
  for (const part of mine) {
    const outcome = await transcribePart({ part, vendor });
    if (!outcome.ok) {
      // The WHOLE side falls back. Marking only this part and keeping the rest
      // would leave a transcript that reads as complete and is not.
      await repo.setPartResult(client, {
        recordingId: part.recording_id,
        status: "FAILED",
        language: null,
        error: outcome.error,
        attempts: Number(part.attempts || 0) + PART_RETRIES,
      });
      const flagged = fallbackRowsForSide({ side, parts: mine, segments, language });
      return {
        side,
        certified: false,
        rows: flagged,
        reason: `part ${part.part_index} could not be transcribed (${outcome.error})`,
      };
    }

    const detected = toEnFr(outcome.result.detected_language, language);
    await repo.setPartResult(client, {
      recordingId: part.recording_id,
      status: "OK",
      language: detected,
      error: null,
      attempts: Number(part.attempts || 0) + 1,
    });
    // D9: voice-to-text is voice-to-text — the call pipeline bills the same
    // `voice` line the voice notes do, so a tenant's spend has one home.
    await recordVoiceUsage(client, {
      userId, conversationId, seconds: outcome.result.audio_seconds, provider: outcome.result.provider,
    });
    rows.push({
      side,
      partIndex: Number(part.part_index),
      text: String(outcome.result.text || "").trim(),
      language: detected,
      provider: "groq",
      certified: true,
    });
  }
  return { side, certified: true, rows, reason: null };
}

/** Usage recording is bookkeeping: a failure to record it must not fail the
 *  transcription that has ALREADY happened and been paid for. */
async function recordVoiceUsage(client, { userId, conversationId, seconds, provider }) {
  try {
    await governance.recordUsage(client, {
      userId,
      featureKey: "voice",
      conversationId,
      provider: provider || "groq",
      callType: "transcribe",
      audioSeconds: seconds || 0,
    });
  } catch (err) {
    logger.warn({ err }, "call: recording voice usage failed");
  }
}

/**
 * The job body (§4.5, steps 2–5).
 *
 * Idempotent by state, not by luck: a call already CERTIFIED with a draft is
 * left alone; a call mid-PROCESSING is skipped while that run is alive; and
 * every write is keyed on the call. Two enqueues (the hang-up and the last
 * upload) therefore cost one pipeline run, which is why the queue de-duplicates
 * on the call id as well.
 */
async function processCall(client, { callId, tenantMeta = null, env = "live", user = null, slug = null }) {
  // The tenant slug decides whether a socket message and the ops alert can be
  // addressed at all, and it arrives by two different routes (the job passes
  // tenantMeta, a request passes req.tenant). Deriving it here means neither
  // caller can accidentally produce a silent notification by forgetting one.
  const tenant = slug || (tenantMeta && tenantMeta.slug) || null;
  const call = await repo.findCall(client, callId);
  if (!call) return { skipped: "missing" };
  if (!isPipelineEligible(call)) return { skipped: "not_ended", status: call.status };

  if (call.transcription_state === "PROCESSING" && call.transcription_updated_at
      && Date.now() - Date.parse(call.transcription_updated_at) < PROCESSING_STALE_MS) {
    return { skipped: "in_flight" };
  }
  const existingSummary = await repo.getSummary(client, callId);
  if (call.transcription_state === "CERTIFIED" && existingSummary) {
    return { skipped: "certified", summary_status: existingSummary.draft_status };
  }

  // The governance gate (D9 / §3.2). A refusal is an ANSWER, not an error: it
  // is recorded on the call with its reason, so the caller sees "transcript
  // being retried" rather than a spinner, and the daily reprocess re-tries when
  // the plan or the budget allows it again.
  const gate = await governance.canUseFeature(client, {
    userId: call.caller_id,
    featureKey: "calls",
  });
  if (!gate.allowed) {
    await repo.setTranscriptionState(client, {
      callId,
      state: "TRANSCRIPTION_FAILED",
      error: gate.reason || "Call transcription is not available on this plan right now",
    });
    rtToUser(call.caller_id, "call:transcription_failed", {
      call_id: callId, reason: gate.reason || "unavailable",
    }, tenant);
    rtToUser(call.callee_id, "call:transcription_failed", {
      call_id: callId, reason: gate.reason || "unavailable",
    }, tenant);
    return { blocked: true, reason: gate.reason };
  }

  const parts = await repo.listRecordingParts(client, callId);
  const liveRows = await repo.listLiveLog(client, { callId });
  const names = await participantNames(client, call);
  const draftLanguage = DRAFT_LANGUAGES.includes(call.summary_language) ? call.summary_language : "en";

  // Nothing uploaded yet for a side that the client said it would upload. The
  // hang-up enqueue is deliberately delayed and the last upload re-triggers the
  // job; the daily sweep catches anything this leaves behind.
  const missing = SIDES.filter((s) => !parts.some((p) => p.side === s));
  const withinGrace = call.ended_at
    && Date.now() - Date.parse(call.ended_at) < UPLOAD_GRACE_MS;
  if (missing.length && withinGrace && !liveRows.length) {
    return { waiting: true, missing, ended_at: call.ended_at };
  }

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
    const segments = liveRows.filter((r) => r.side === side);
    perSide[side] = await transcribeSide(client, {
      side,
      parts,
      segments,
      vendor,
      language: draftLanguage,
      userId: call.caller_id,
      conversationId: null,
    });
    if (perSide[side].rows.length) {
      // Certified rows land FIRST, then the flagged ones are retired — so a
      // reader never sees a moment with no current rows, and a crash between
      // the two leaves the certified set current, which is the safe direction.
      await repo.insertTranscriptRows(client, {
        callId, side, rows: perSide[side].rows,
      });
      if (perSide[side].certified) {
        await repo.retireFlaggedRows(client, { callId, side });
      }
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
    // Visible on both ends, alerted to ops, and retried by the sweep. This is
    // the ONE failure path of the never-dies guarantee, so it is the loudest
    // thing in this file.
    const payload = { call_id: callId, reason: failures.join(" · ").slice(0, 200) };
    rtToUser(call.caller_id, "call:transcription_failed", payload, tenant);
    rtToUser(call.callee_id, "call:transcription_failed", payload, tenant);
    await raiseOpsAlert({ call, failures, tenantMeta, env });
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
    call, names, transcript: credited, language: draftLanguage, everyRowCertified, failures,
  });

  if (existingSummary && existingSummary.draft_status === "SENT") {
    // §4.5 step 3: a SENT summary is NEVER rewritten. The caller is offered an
    // optional update — and only when the record actually improved.
    const improved = everyRowCertified && existingSummary.provenance !== "groq";
    const contentChanged = drafted.provenance === "groq" && existingSummary.provenance !== "groq";
    if (improved || contentChanged) {
      await repo.markUpdateAvailable(client, callId);
      rtToUser(call.caller_id, "call:summary_ready", {
        call_id: callId, status: "UPDATE_AVAILABLE", provenance: drafted.provenance,
      }, tenant);
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
  await notifySummaryReady(client, { call, summary: stored, slug: tenant });

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
async function draftSummary(client, { call, names, transcript, language, everyRowCertified, failures }) {
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
      provenance: provenanceOf({ llmOk: true, certified: everyRowCertified }),
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
    provenance: provenanceOf({ llmOk: false, certified: everyRowCertified }),
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

/** The caller hears it: socket (live badge), then the notification fan-out
 *  (in-app row + push per preference, §4.5 step 5). Best-effort by design —
 *  the draft is already stored, and a push failure must not lose it. */
async function notifySummaryReady(client, { call, summary, slug = null }) {
  rtToUser(call.caller_id, "call:summary_ready", {
    call_id: call.call_id,
    status: summary.draft_status,
    provenance: summary.provenance,
  }, slug);
  try {
    await require("../notification/notification.service").notifyMany(client, [call.caller_id], {
      eventTypeKey: "comms.call_summary_ready",
      title: "Call summary ready",
      body: "Review and send the summary of your call.",
      entityRef: cref(call.call_id),
      category: "comms",
      url: `/comms?call=${call.call_id}`,
      pushTag: `comms:call:${call.call_id}`,
    });
  } catch (err) {
    /* @silent:storage|parse|teardown */
    logger.warn({ err, callId: call.call_id }, "call: summary notification failed");
  }
}

/* ── Starting the pipeline ──────────────────────────────────────────────── */

/**
 * Enqueue the transcription of one call. Called on the ENDED transition and
 * again when a side finishes uploading; the queue de-duplicates on the call id,
 * so the second call is a no-op while the first is in flight.
 *
 * `delayMs` exists for the ENDED enqueue specifically: the moment a call ends,
 * the clients are still flushing their parts, and a pipeline that starts
 * immediately would find no audio and (correctly, but uselessly) fall back.
 */
async function startPipeline({ callId, tenantMeta = null, env = "live", user = null, delayMs = 0 }) {
  if (!callId) return null;
  try {
    const { enqueue } = require("../../jobs/queue-producer");
    return await enqueue("call-transcribe", "transcribe", {
      callId, tenantMeta, env, user,
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
    provenance: anyFlagged ? "browser-live" : "groq",
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
  const everyRowCertified = rows.length > 0 && rows.every((r) => r.certified === true);
  const failures = rows.length ? [] : ["no transcript rows"];

  const drafted = await draftSummary(client, {
    call, names, transcript, language, everyRowCertified, failures,
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
  partSpans,
  groupSegmentsByPart,
  fallbackRowsForSide,
  buildAttributedTranscript,
  provenanceOf,
  summaryPrompt,
  normaliseSegments,
  // constants
  PART_RETRIES,
  UPLOAD_GRACE_MS,
  RETENTION_DAYS,
  SIDES,
};
