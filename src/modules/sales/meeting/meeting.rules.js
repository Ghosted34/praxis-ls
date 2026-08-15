/**
 * Meeting (MOD-21) — the Client Discovery Framework, pure.
 *
 * Three named sections, not one free-text box. The legacy prints them as
 * headed panels in a wizard (smart-quote-leads.php ~817-895) and stores them as
 * three columns on the lead; here they are the fixed vocabulary of
 * `meeting_discovery_section.section_key` and the framework itself.
 *
 * Nothing in this file touches the database or the network, so the two rules
 * that matter downstream — what a dictation may append, and what a section's
 * state means — are testable without one.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

/** The framework. Order is the order they are asked in, and it matters: you
 *  cannot propose a strategy before you have heard the pain. */
const SECTIONS = [
  { key: "OPERATIONS",  seq: 1, label_en: "Business & Operations Context",  label_fr: "Contexte métier et opérations" },
  { key: "PAIN_POINTS", seq: 2, label_en: "Operational Bottlenecks",        label_fr: "Goulots d'étranglement opérationnels" },
  { key: "STRATEGY",    seq: 3, label_en: "Proposed Strategic Alignment",   label_fr: "Alignement stratégique proposé" },
];
const SECTION_KEYS = SECTIONS.map((s) => s.key);

/**
 * EMPTY / TYPED are what a human does; DICTATING / TRANSCRIBED /
 * TRANSCRIPTION_FAILED are what the ai-transcribe worker does. The last one is
 * the reason this is a state and not a boolean: the legacy shows a toast when
 * transcription fails and leaves the box blank, so a failed dictation and a
 * section nobody filled in look identical the next morning.
 */
const CAPTURE_STATES = ["EMPTY", "TYPED", "DICTATING", "TRANSCRIBED", "TRANSCRIPTION_FAILED"];

/**
 * Audio ceiling for one dictation, on the DECODED bytes.
 *
 * This number is not a guess about speech, it is derived: the API parses JSON at
 * a 2 MB limit (server.js), base64 costs 4/3, and the envelope needs room. Past
 * this the request dies in the body parser with a 413 the module never sees and
 * cannot explain, so the module refuses it FIRST, in its own words.
 *
 * What it buys in practice: the UI records Opus at 24 kbps and stops itself at
 * five minutes, which is ~900 KB — comfortably inside this, and far more than
 * one discovery section is ever dictated in. Raising it means raising the body
 * limit in server.js for every route, which is not this slice's call to make.
 */
const MAX_AUDIO_BYTES = 1_400_000;

/** What a browser's MediaRecorder actually produces, plus the two formats a
 *  phone hands over. Anything else is refused before a job is enqueued rather
 *  than after the provider rejects it. */
const AUDIO_MIME = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a"];

function assertSection(key) {
  if (!SECTION_KEYS.includes(key)) {
    throw new AppError("BAD_SECTION", `Unknown discovery section "${String(key).slice(0, 40)}" — expected one of ${SECTION_KEYS.join(", ")}`, 422);
  }
  return key;
}

/** Typing into a section: non-blank is TYPED, blanking it puts it back to EMPTY
 *  rather than leaving a stale TRANSCRIBED on an empty body. */
const stateForBody = (body) => (String(body || "").trim() ? "TYPED" : "EMPTY");

/**
 * Dictation APPENDS, it does not replace — processAudio() ~1805 does the same,
 * and it is the right call: someone who has typed three bullet points and then
 * dictates a fourth should not lose the three.
 */
function appendTranscript(existing, text) {
  const a = String(existing || "").trim();
  const b = String(text || "").trim();
  if (!b) return a;
  return a ? `${a} ${b}` : b;
}

/** All three sections, always — a meeting with nothing captured still renders
 *  the framework rather than an empty list. */
function blankSet(meetingId = null) {
  return SECTIONS.map((s) => ({
    meeting_id: meetingId,
    section_key: s.key,
    body: null,
    capture_state: "EMPTY",
    dictation_error: null,
    transcript_vault_id: null,
    audio_seconds: null,
  }));
}

/** Merge stored rows over the blank skeleton, in framework order. */
function mergeSet(rows = [], meetingId = null) {
  const byKey = new Map(rows.map((r) => [r.section_key, r]));
  return blankSet(meetingId).map((blank) => ({ ...blank, ...(byKey.get(blank.section_key) || {}) }));
}

/** True once anything has actually been captured — used to decide which meeting
 *  is a lead's "latest discovery set". A meeting that was scheduled and never
 *  written up is not one. */
const hasContent = (sections = []) => sections.some((s) => String(s.body || "").trim().length > 0);

module.exports = {
  SECTIONS, SECTION_KEYS, CAPTURE_STATES, MAX_AUDIO_BYTES, AUDIO_MIME,
  assertSection, stateForBody, appendTranscript, blankSet, mergeSet, hasContent,
};
