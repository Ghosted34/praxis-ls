/**
 * The one sentence that says what a call transcript or summary is worth. Shared
 * by the summary editor and the chat card so the two can never disagree.
 *
 * Groq and Gemini both transcribe the stored call audio, so both read as the
 * recording (owner decision A-1). browser-live exists only on old calls.
 */
import { tr } from "@/lib/i18n";
import type { CallProvenance } from "@/lib/smartcomm-api";

const PROVENANCE_LABEL: Record<CallProvenance, string> = {
  groq: "Transcribed from the call recording",
  gemini: "Transcribed from the call recording",
  "browser-live": "Generated from the in-call browser capture (unverified)",
  "transcript-only": "Summary unavailable — provider down",
};

export function provenanceLabel(provenance: CallProvenance | string | null | undefined): string {
  return tr(PROVENANCE_LABEL[provenance as CallProvenance] || PROVENANCE_LABEL.groq);
}
