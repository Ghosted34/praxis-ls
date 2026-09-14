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
 *
 * ── THE WHOLE BAR PLAYS, AND EVERY FAILURE SAYS SOMETHING ──────────────────
 *
 * `voice-recorder.tsx` states the rule for the other half of this feature: "A
 * mic button that does nothing is the worst outcome — people press it again,
 * and again, and conclude the product is broken." The recorder obeyed it. This
 * file did not, in four places, and they compounded into a voice note that
 * could not be played at all:
 *
 *   · The waveform is a button FOUR TIMES the area of the play button, and it
 *     looks like a progress bar, so it is what a hand reaches for. It called
 *     `seek`, which began `if (!el …) return` — and before the first play there
 *     IS no <audio> element, because it is only rendered once the bytes land.
 *     So the biggest, most play-shaped target in the bubble was a permanent,
 *     silent no-op. That is the defect users reported as "voice notes not
 *     playing": they were pressing the bar.
 *   · `play()`'s rejection was swallowed with a comment claiming "the native
 *     controls remain the fallback". There are no native controls — the
 *     element is `hidden` and carries no `controls` attribute. A browser that
 *     refuses playback said nothing whatsoever.
 *   · There was no `onError` on the <audio>, so a clip that would not decode —
 *     the one failure that really is about THIS recording — rendered as a
 *     button that did nothing.
 *   · `toggle()` returned silently when the element was missing.
 *
 * So: the bar starts playback (and seeks once there is something to seek in),
 * and the three failures that can actually happen are three sentences, because
 * they need three different responses — reload, press again, or stop trying.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/smartcomm-api";
import type { CommAttachment } from "@/lib/smartcomm-api";
import { useObjectUrl } from "./use-object-url";
import { clock } from "./audio-utils";

const SPEEDS = [1, 1.5, 2] as const;

/**
 * The three ways playback fails, kept apart because they need three different
 * responses from the reader — the same reasoning the transcript states get.
 *
 *   "blocked"     the browser refused a programmatic `play()`. Pressing again
 *                 works, because that press IS the gesture it wanted.
 *   "undecodable" the bytes arrived and this browser cannot play them. Nothing
 *                 the reader does will change that; the transcript, if any, is
 *                 what is left.
 *   "gone"        there is no clip to fetch — the attachment carries no media
 *                 id. Collapsing this into "couldn't load" would send somebody
 *                 hunting a network fault that is not there.
 */
type Problem = null | "blocked" | "undecodable" | "gone";

export function VoiceNote({ attachment }: { attachment: CommAttachment }) {
  const mediaId = attachment.media_id || "";
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [position, setPosition] = React.useState(0);
  const [speed, setSpeed] = React.useState<number>(1);
  const [wanted, setWanted] = React.useState(false);
  /** null while nothing has gone wrong. See `Problem` for why three. */
  const [problem, setProblem] = React.useState<Problem>(null);
  /** A click on the bar BEFORE the clip is loaded: where to start once it is.
   *  A ref, not state — it is applied in a DOM event handler and nothing
   *  renders from it. */
  const pendingSeek = React.useRef<number | null>(null);

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
      // NOT swallowed. This `play()` is one network round trip removed from the
      // press that asked for it, which is exactly the shape a browser's
      // autoplay policy can refuse — and the refusal used to be invisible.
      audioRef.current.play().catch(() => setProblem("blocked"));
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

  /** Start the clip loading if it has not been asked for yet. Returns whether
   *  there is an element to act on right now. */
  function ensureLoading(): HTMLAudioElement | null {
    if (!mediaId) { setProblem("gone"); return null; }
    setProblem(null);
    if (!wanted) { setWanted(true); return null; }
    return audioRef.current;
  }

  function toggle() {
    const el = ensureLoading();
    // Null means the fetch has just been asked for; the effect above plays it
    // when the bytes land. Not an error, and not silence either — the button
    // shows "…" while `loading`.
    if (!el) return;
    if (el.paused) {
      el.playbackRate = speed;
      el.play().catch(() => setProblem("blocked"));
    }
    else el.pause();
  }

  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed as 1) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  /**
   * The bar PLAYS, and scrubs once there is something to scrub.
   *
   * It is four times the area of the play button and it is drawn as a progress
   * bar, so it is the target a hand actually goes for — on a phone it is very
   * nearly the only one. It used to open with `if (!el) return`, and `el` does
   * not exist until the first play has fetched the bytes, so the biggest
   * control in the bubble did nothing at all, silently, forever.
   *
   * A click before the clip is loaded therefore starts it AND remembers where
   * the finger landed, which `onLoadedMetadata` applies once a duration exists.
   * Pressing the middle of an unplayed bar starts it in the middle, which is
   * what the shape promises.
   */
  function seek(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    // A keyboard Enter reports clientX 0, which clamps to the start — "play
    // this", which is the right reading of Enter on a bar.
    const ratio = rect.width
      ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      : 0;
    const el = ensureLoading();
    if (!el || !el.duration || !Number.isFinite(el.duration)) {
      // Still loading, or not asked for yet: hold the position for the moment
      // metadata arrives.
      pendingSeek.current = ratio;
      return;
    }
    el.currentTime = ratio * el.duration;
    setPosition(el.currentTime);
    if (el.paused) el.play().catch(() => setProblem("blocked"));
  }

  /** Apply a click that landed before the clip had a duration. */
  function applyPendingSeek(el: HTMLAudioElement) {
    const ratio = pendingSeek.current;
    pendingSeek.current = null;
    if (ratio === null || !el.duration || !Number.isFinite(el.duration)) return;
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
          // The label names what it DOES, at both moments: before the clip is
          // loaded this starts it, afterwards it moves within it. A label that
          // only said "seek" described the half that was broken.
          aria-label={tr("Play from a point in the voice note")}
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
            onPlay={() => { setPlaying(true); setProblem(null); }}
            onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); setPosition(0); }}
            onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => applyPendingSeek(e.currentTarget)}
            // The bytes arrived (the fetch resolved) and the browser still
            // cannot play them — a codec this device lacks, or a truncated
            // clip. Without this handler that rendered as a button that did
            // nothing, which is the failure this whole file now exists to
            // refuse.
            onError={() => setProblem("undecodable")}
            className="hidden"
          />
        )}
      </div>

      {/* One line, and never two at once: a fetch that failed is not also a
          decode that failed, and stacking them would make the bubble taller
          every time something went wrong. */}
      {error ? (
        <p className="text-micro text-muted-foreground">
          {tr("Couldn't load that recording. Check your connection and press play again.")}
        </p>
      ) : problem === "undecodable" ? (
        <p className="text-micro text-muted-foreground">
          {tr("This browser can't play this recording.")}
        </p>
      ) : problem === "blocked" ? (
        <p className="text-micro text-muted-foreground">
          {tr("Your browser stopped it from starting on its own. Press play again.")}
        </p>
      ) : problem === "gone" ? (
        <p className="text-micro text-muted-foreground">
          {tr("This recording is no longer attached to the message.")}
        </p>
      ) : null}

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
