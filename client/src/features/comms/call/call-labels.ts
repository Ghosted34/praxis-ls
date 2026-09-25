/**
 * How a call reads in the Calls list and on its page. Pure, so the list, the
 * record and their tests share one vocabulary.
 */
import { tr, tv } from "@/lib/i18n";
import type { Tone } from "@/components/ui/pill";
import type { Call, CallListRow, CallTranscriptGap, CallTranscriptState } from "@/lib/smartcomm-api";

/** The other person's name, from this user's side of the call. */
export function peerOf(call: Pick<Call, "caller_id" | "caller_name" | "callee_name">, me: string | null): string | null {
  return (call.caller_id === me ? call.callee_name : call.caller_name) || null;
}

/** "4:05", or null for a call that never connected. */
export function callDuration(seconds?: number | null): string | null {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (!s) return null;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What happened to the call, in the reader's words. */
export function callOutcome(call: Pick<Call, "status" | "end_reason">, isCaller: boolean): string {
  switch (call.status) {
    case "RINGING": return tr("Ringing");
    case "IN_CALL": return tr("In progress");
    case "NO_ANSWER": return isCaller ? tr("No answer") : tr("Missed");
    case "CANCELLED": return isCaller ? tr("Cancelled") : tr("Missed");
    case "DECLINED": return tr("Declined");
    case "BUSY": return tr("Busy");
    case "FAILED": return tr("Could not connect");
    default:
      return call.end_reason === "disconnected" ? tr("Connection lost") : tr("Ended");
  }
}

/** The record pipeline's state as a label and a tone, or null when there is nothing to say. */
export function stateBadge(state?: CallTranscriptState | null): { label: string; tone: Tone } | null {
  switch (state) {
    case "PENDING":
    case "PROCESSING": return { label: tr("Transcribing…"), tone: "blue" };
    case "TRANSCRIPTION_FAILED": return { label: tr("Transcript failed"), tone: "bad" };
    case "NO_RECORDING": return { label: tr("Not recorded"), tone: "mute" };
    default: return null;
  }
}

/** The summary's badge on a list row: what, if anything, is waiting for this user. */
export function summaryBadge(row: CallListRow, isCaller: boolean): { label: string; tone: Tone } | null {
  if (!isCaller || !row.draft_status) return null;
  if (row.draft_status === "PENDING_REVIEW") return { label: tr("Summary to review"), tone: "warn" };
  if (row.draft_status === "SENT" && row.summary_update_available) return { label: tr("Update available"), tone: "warn" };
  if (row.draft_status === "SENT") return { label: tr("Summary sent"), tone: "ok" };
  return null;
}

/** "02:05" from seconds into a side's recording. */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The minutes with no transcript, for the caller (the editor is the caller's):
 * "02:00–04:00 on your side". Empty when nothing is missing.
 */
export function gapsSentence(gaps: CallTranscriptGap[]): string {
  if (!gaps.length) return "";
  const spans = gaps
    .map((g) => tv(g.side === "caller" ? "{{from}}–{{to}} on your side" : "{{from}}–{{to}} on their side", {
      from: clockOf(g.from_s), to: clockOf(g.to_s),
    }))
    .join(", ");
  return tv("Not transcribed: {{spans}}. The draft says so; an administrator can re-run those minutes from the call record.", { spans });
}

/**
 * Why a call's transcript is incomplete, in words (audit N4). The server sends
 * a code (C11), never a provider's own message.
 */
export function transcriptionReasonSentence(reason: string | null | undefined): string | null {
  switch (reason) {
    case "SIDE_NOT_RECORDED":
      return tr("One side of this call was not recorded, so the transcript has only the other side.");
    case "PARTS_NOT_TRANSCRIBED":
      return tr("Part of this call could not be transcribed.");
    case "OVER_BUDGET":
      return tr("Part of this call was not transcribed: your company's daily call transcription allowance was used up.");
    case "TRANSCRIPTION_FAILED":
      return tr("This call could not be transcribed.");
    default:
      return null;
  }
}
