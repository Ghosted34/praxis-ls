/**
 * A call summary inside a bubble (Smart Comms PR-2).
 *
 * ── RESOLVED AT READ TIME, LIKE AN ERP CARD ─────────────────────────────────
 *
 * The message stores a POINTER (`comms_attachment.call_id`) and the card arrives
 * with the thread read. That matters here more than it does for an invoice: a
 * summary can be REGENERATED in the other language after it was posted, and a
 * frozen copy would leave the conversation showing French while the record — and
 * the transcript link beside it — says English. The reader sees the record as it
 * stands.
 *
 * ── THE LABEL IS THE HONESTY ────────────────────────────────────────────────
 *
 * Three provenances, three sentences, and none of them is buried:
 *
 *   certified transcript  the provider read the recorded audio
 *   browser capture       the in-call recogniser carried the call, so the words
 *                         may be partial and are marked unverified
 *   provider down         the transcript IS the draft — the caller was told so
 *                         before they sent it, and the conversation should be
 *                         able to see the same thing
 *
 * ── THE TRANSCRIPT IS A CLICK, NOT A PAYLOAD ────────────────────────────────
 *
 * Transcripts are long and most readers never open one, so the card loads it on
 * demand and only for a member of the call. That is also why it is a separate
 * request rather than a field on the attachment: a channel with forty calls in
 * it must not carry forty transcripts into every thread read.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { dateDmy } from "@/lib/format";
import * as api from "@/lib/smartcomm-api";
import type { CallCard, CallTranscriptView } from "@/lib/smartcomm-api";

const PROVENANCE_LABEL: Record<CallCard["provenance"], string> = {
  groq: "Transcribed from the call recording",
  "browser-live": "Generated from the in-call browser capture (unverified)",
  "transcript-only": "Summary unavailable — provider down",
};

function minutes(seconds?: number | null): string | null {
  const s = Number(seconds) || 0;
  if (!s) return null;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** The attributed transcript, opened on demand. */
function TranscriptPanel({ callId, onClose }: { callId: string; onClose: () => void }) {
  const [view, setView] = React.useState<CallTranscriptView | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    api.getCallTranscript(callId)
      .then((v) => {
        if (live) setView(v);
      })
      .catch(() => {
        /* @silent:parse — a transcript that cannot be read (the call is not
           ours after a role change, the row is gone) shows the same sentence a
           missing one does; there is no retry a reader can act on. */
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [callId]);

  return (
    <div className="mt-2 rounded-lg border border-border bg-background/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-micro font-medium text-muted-foreground">
          {tr("Transcript")}
          {view && !view.certified ? ` · ${tr("from the browser capture, unverified")}` : ""}
        </p>
        <button type="button" onClick={onClose} className="text-micro text-muted-foreground hover:text-foreground">
          {tr("Hide")}
        </button>
      </div>
      {failed && <p className="mt-1 text-xs text-muted-foreground">{tr("The transcript is not available.")}</p>}
      {!failed && !view && (
        <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
          {tr("Loading…")}
        </p>
      )}
      {view && (
        <div className="mt-1 space-y-2">
          {view.sides
            .filter((s) => s.parts.length)
            .map((s) => (
              <div key={s.side}>
                <p className="text-micro font-medium text-foreground">
                  {s.name || (s.side === "caller" ? tr("Caller") : tr("Callee"))}
                </p>
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">{s.text}</p>
              </div>
            ))}
          {view.state === "TRANSCRIPTION_FAILED" && (
            <p className="text-micro text-muted-foreground">
              {tr("The certified transcript could not be produced — this is the in-call capture.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A posted call summary. `card` is null when the row was deleted or the reader
 * lost access — the same shape an ERP card degrades to, with a sentence rather
 * than a spinner that never resolves.
 */
export function CallSummaryCardView({
  card,
  label,
  callId,
}: {
  card: CallCard | null;
  label?: string | null;
  callId?: string | null;
}) {
  const [showTranscript, setShowTranscript] = React.useState(false);
  const id = (card && card.call_id) || callId || null;

  if (!card || !id) {
    return (
      <div className="rounded-xl border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
        {label || tr("Call summary")} — {tr("this record is no longer available")}
      </div>
    );
  }

  const dur = minutes(card.duration_seconds);
  const when = card.ended_at ? dateDmy(card.ended_at) : null;

  return (
    <div className="rounded-xl border border-border bg-card/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">{tr("Call summary")}</p>
        <p className="text-micro text-muted-foreground">
          {[when, dur].filter(Boolean).join(" · ")}
        </p>
      </div>
      <p className="mt-0.5 text-micro text-muted-foreground">{tr(PROVENANCE_LABEL[card.provenance] || PROVENANCE_LABEL.groq)}</p>

      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{card.summary_text}</p>

      {card.key_points.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {card.key_points.map((p, i) => (
            <li key={`kp-${i}`} className="text-xs text-foreground">
              • {p.text}{" "}
              <span className="text-micro text-muted-foreground">
                ({p.raised_by === "caller" ? card.caller_name || tr("Caller") : card.callee_name || tr("Callee")})
              </span>
            </li>
          ))}
        </ul>
      )}

      {card.follow_ups.length > 0 && (
        <div className="mt-2">
          <p className="text-micro font-medium text-muted-foreground">{tr("Follow-ups")}</p>
          <ul className="space-y-0.5">
            {card.follow_ups.map((f, i) => (
              <li key={`fu-${i}`} className="text-xs text-foreground">
                • {f.text}
                {f.due ? ` · ${dateDmy(f.due)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.update_available && (
        <p className="mt-2 text-micro text-muted-foreground">
          {tr("An updated summary is available from the certified transcript.")}
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowTranscript((v) => !v)}
        className="mt-2 text-micro text-primary-ink underline-offset-2 hover:underline"
      >
        {showTranscript ? tr("Hide transcript") : tr("Show transcript")}
      </button>
      {showTranscript && <TranscriptPanel callId={id} onClose={() => setShowTranscript(false)} />}
    </div>
  );
}
