/**
 * Playing a voice note back.
 *
 * ── THE TRANSCRIPT IS PART OF THE MESSAGE, NOT A FEATURE ON IT ────────────
 *
 * Somebody in a meeting cannot play a clip. Somebody on a noisy quay cannot
 * hear one. And `certifiedExport` renders every message to one line of a
 * SHA-256'd transcript, so a voice note without words was the one format that
 * vanished from the legal record of a channel — the format people reach for
 * precisely when an instruction is urgent.
 *
 * So the words sit under the bar, and the four states are shown as four
 * different things because they need four different responses:
 *
 *   PENDING      it is being transcribed. Wait.
 *   DONE         here are the words.
 *   UNAVAILABLE  nobody configured a provider. The operator's problem, and
 *                saying "failed" would send the reader hunting a fault that is
 *                not theirs.
 *   FAILED       it was tried and did not work. Play the clip.
 *
 * ── THE BARS ARE STORED, NOT DECODED ──────────────────────────────────────
 *
 * `waveform` came off the recorder's own analyser at capture time. Decoding the
 * clip here to draw them would mean every reader of every bubble paying for a
 * `decodeAudioData` — the same work, done n times instead of once.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/smartcomm-api";
import type { CommAttachment } from "@/lib/smartcomm-api";
import { useObjectUrl } from "./use-object-url";
import { clock } from "./audio-utils";

const SPEEDS = [1, 1.5, 2] as const;

export function VoiceNote({ attachment }: { attachment: CommAttachment }) {
  const mediaId = attachment.media_id || "";
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [position, setPosition] = React.useState(0);
  const [speed, setSpeed] = React.useState<number>(1);
  const [wanted, setWanted] = React.useState(false);

  // The bytes are fetched on the FIRST PLAY, not on render. A channel with
  // forty voice notes in its history must not pull forty clips down to show
  // forty bars — the bars are already in the row.
  const fetcher = React.useMemo(
    () => (mediaId ? (signal: AbortSignal) => api.mediaObjectUrl(mediaId, signal) : null),
    [mediaId],
  );
  const { url, loading, error } = useObjectUrl(fetcher, { enabled: wanted });

  // Autoplay once the bytes land, but only because a press is what asked for
  // them. Nothing here ever starts on its own.
  React.useEffect(() => {
    if (url && wanted && audioRef.current && !playing) {
      audioRef.current.playbackRate = speed;
      audioRef.current.play().catch(() => {
        /* @silent:teardown — a browser that refuses programmatic play leaves the
           controls usable, which is the whole fallback */
      });
    }
    // `playing` is deliberately not a dependency: re-running on pause would
    // restart the clip the reader just paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, wanted]);

  const durationMs = Number(attachment.duration_ms) || 0;
  const bars = (attachment.waveform && attachment.waveform.length ? attachment.waveform : null) ||
    // No peaks (an older row, or an analyser that would not start): a flat even
    // bar is honest — it says "audio", and claims nothing about its shape.
    Array.from({ length: 32 }, () => 30);

  const progress = durationMs ? Math.min(1, position / (durationMs / 1000)) : 0;

  function toggle() {
    if (!wanted) { setWanted(true); return; }
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.playbackRate = speed;
      el.play().catch(() => {
        /* @silent:teardown — see above; the native controls remain the fallback */
      });
    }
    else el.pause();
  }

  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed as 1) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  /** Scrub by clicking the bar. The whole bar is the control, which on a phone
   *  is the difference between usable and not. */
  function seek(e: React.MouseEvent<HTMLButtonElement>) {
    const el = audioRef.current;
    if (!el || !el.duration || !Number.isFinite(el.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    setPosition(el.currentTime);
  }

  const transcriptStatus = attachment.transcript_status || "NONE";

  return (
    <div className="max-w-[320px] space-y-1.5">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          aria-label={playing ? tr("Pause voice note") : tr("Play voice note")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-60"
        >
          <span aria-hidden className="text-sm leading-none">
            {loading ? "…" : playing ? "❚❚" : "▶"}
          </span>
        </button>

        <button
          type="button"
          onClick={seek}
          aria-label={tr("Seek within the voice note")}
          className="flex h-8 flex-1 items-end gap-[2px]"
        >
          {bars.map((v, i) => {
            const played = i / bars.length <= progress;
            return (
              <span
                key={i}
                className={cn(
                  "flex-1 rounded-full transition-colors",
                  played ? "bg-primary" : "bg-border",
                )}
                style={{ height: `${Math.max(12, Math.min(100, v))}%` }}
              />
            );
          })}
        </button>

        <span className="shrink-0 text-micro tabular-nums text-muted-foreground">
          {clock(playing || position ? position * 1000 : durationMs)}
        </span>

        <button
          type="button"
          onClick={cycleSpeed}
          aria-label={tr("Playback speed")}
          className="shrink-0 rounded px-1 text-micro tabular-nums text-muted-foreground hover:text-foreground"
        >
          {speed}×
        </button>

        {url && (
          <audio
            ref={audioRef}
            src={url}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); setPosition(0); }}
            onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
            className="hidden"
          />
        )}
      </div>

      {error && <p className="text-micro text-muted-foreground">{tr("Couldn't load that recording.")}</p>}

      {transcriptStatus === "DONE" && attachment.transcript && (
        <p className="rounded-lg bg-muted px-2.5 py-1.5 text-sm text-foreground">
          {attachment.transcript}
        </p>
      )}
      {transcriptStatus === "PENDING" && (
        <p className="text-micro italic text-muted-foreground">{tr("Transcribing…")}</p>
      )}
      {transcriptStatus === "DONE" && !attachment.transcript && (
        <p className="text-micro italic text-muted-foreground">{tr("No speech was found in this clip.")}</p>
      )}
      {transcriptStatus === "UNAVAILABLE" && (
        <p className="text-micro italic text-muted-foreground">
          {tr("Voice transcription isn't set up on this workspace.")}
        </p>
      )}
      {transcriptStatus === "FAILED" && (
        <p className="text-micro italic text-muted-foreground">{tr("This one couldn't be transcribed.")}</p>
      )}
    </div>
  );
}
