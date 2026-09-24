/**
 * Closed vocabularies for call rows that no longer have a CHECK behind them.
 *
 * Migration 14040 dropped the CHECKs on comms_call.end_reason,
 * comms_call_transcript.provider (and the certified/provider pairing) and
 * comms_call_summary.provenance, because an existing table may not gain or
 * widen a constraint (tests/unit/migration-constraint-ordering.test.js). The
 * repo enforces these sets on every write instead.
 */
"use strict";

/** How a call ended. `disconnected` is the liveness sweep's (both devices gone). */
const END_REASONS = [
  "hangup", "declined", "cancelled", "no_answer", "busy", "max_duration", "ice_failed", "disconnected",
];

/** Who produced a transcript row. Groq and Gemini transcribe the stored audio;
 *  browser-live is the retired in-call capture, kept so old calls render. */
const TRANSCRIPT_PROVIDERS = ["groq", "gemini", "browser-live"];
const CERTIFIED_PROVIDERS = ["groq", "gemini"];

/** What a summary draft is worth (the UI label). */
const SUMMARY_PROVENANCES = ["groq", "gemini", "browser-live", "transcript-only"];

/** Certified rows come from a provider that heard the stored audio, and only those. */
function isValidTranscriptRow({ provider, certified }) {
  if (!TRANSCRIPT_PROVIDERS.includes(provider)) return false;
  return certified === CERTIFIED_PROVIDERS.includes(provider);
}

module.exports = {
  END_REASONS,
  TRANSCRIPT_PROVIDERS,
  CERTIFIED_PROVIDERS,
  SUMMARY_PROVENANCES,
  isValidTranscriptRow,
};
