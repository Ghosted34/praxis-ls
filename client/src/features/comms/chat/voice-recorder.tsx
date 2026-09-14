/**
 * Recording a voice note.
 *
 * ── THE WAVEFORM IS COMPUTED WHILE RECORDING, NOT AFTERWARDS ──────────────
 *
 * An `AnalyserNode` on the live stream gives a peak per animation frame for
 * free, so the bar the sender watches IS the bar stored with the clip. The
 * alternative — decode the finished audio and compute peaks — costs a full
 * `decodeAudioData` of the blob on a mid-range phone, and would have to be
 * repeated by every reader who later renders the bubble.
 *
 * ── PRESS TO START, PRESS TO STOP. NOT HOLD-TO-TALK ───────────────────────
 *
 * `voice-input.tsx` holds, because it is dictating one answer into one field
 * and the hold IS the field's focus. A voice note is a MESSAGE: it can run to
 * two minutes, the sender needs their hand back to read what they are
 * responding to, and a finger that slips off a held button loses the whole
 * recording. WhatsApp's lock gesture exists for exactly this reason; a toggle
 * is the same affordance without the gesture to discover.
 *
 * ── EVERY FAILURE SAYS SOMETHING ──────────────────────────────────────────
 *
 * A mic button that does nothing is the worst outcome — people press it again,
 * and again, and conclude the product is broken. Permission refused, no
 * microphone, an unsupported browser and a clip too short all produce a visible
 * sentence. Three of those four are the operator's or the device's problem and
 * the sentence says so.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { clock, downsample } from "./audio-utils";

/** Below this, the press was a mis-click rather than a message. */
const MIN_MS = 600;
/** The ceiling the server also enforces. Stopping here gives a clearer message
 *  than a 422 after the upload. */
const MAX_MS = 120_000;
/** How many peaks are stored. The bar renders this many bars regardless of
 *  clip length, so a five-second note and a two-minute note look alike. */
const PEAKS = 48;

export type Recording = { blob: Blob; durationMs: number; waveform: number[]; mimeType: string };

/**
 * The container this browser will actually record in.
 *
 * Safari produces mp4/aac and everything else webm/opus, and asking for a type
 * the browser cannot encode throws rather than falling back. The server accepts
 * all of these and names the extension for Whisper from the media type.
 */
function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

export function VoiceRecorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (recording: Recording) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [level, setLevel] = React.useState(0);

  const recorder = React.useRef<MediaRecorder | null>(null);
  const stream = React.useRef<MediaStream | null>(null);
  const audioCtx = React.useRef<AudioContext | null>(null);
  const chunks = React.useRef<Blob[]>([]);
  const peaks = React.useRef<number[]>([]);
  const startedAt = React.useRef(0);
  const raf = React.useRef<number | null>(null);
  const timer = React.useRef<number | null>(null);
  // Set by cancel() so the `stop` handler knows to discard rather than send.
  const cancelled = React.useRef(false);

  /** Tear down the mic, the graph and the timers. Safe to call twice — every
   *  exit path calls it, including unmount mid-recording. */
  const teardown = React.useCallback(() => {
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; }
    if (timer.current) { window.clearInterval(timer.current); timer.current = null; }
    // The mic indicator stays lit in the tab until every track is stopped, and
    // a chat app that appears to still be listening is a trust problem.
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    audioCtx.current?.close().catch(() => {
      /* @silent:teardown — an already-closed context is not an error worth showing */
    });
    audioCtx.current = null;
    recorder.current = null;
  }, []);

  React.useEffect(() => teardown, [teardown]);

  async function start() {
    if (disabled || recording) return;
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(tr("This browser can't record audio. Type your message instead."));
      return;
    }
    const mimeType = pickMimeType();
    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        // Echo cancellation and noise suppression are on because the clip is
        // going to a phone speaker in a warehouse, not into a mixing desk.
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      /* @silent:permission — the sentence below IS the handling */
      setError(tr("Microphone access was refused. Allow it in your browser settings, or type instead."));
      return;
    }

    stream.current = micStream;
    chunks.current = [];
    peaks.current = [];
    cancelled.current = false;
    startedAt.current = Date.now();

    // Live level metering, for the bar the sender watches AND for the peaks
    // stored with the clip.
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtx.current = ctx;
      const source = ctx.createMediaStreamSource(micStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => {
        analyser.getByteTimeDomainData(buffer);
        // RMS around the 128 midpoint, scaled to 0..100. Peak amplitude alone
        // makes every bar full height the moment anyone breathes.
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length);
        const value = Math.min(100, Math.round(rms * 220));
        setLevel(value);
        peaks.current.push(value);
        raf.current = requestAnimationFrame(sample);
      };
      raf.current = requestAnimationFrame(sample);
    } catch {
      /* @silent:teardown — no analyser means no bar; the recording is unaffected */
    }

    const rec = new MediaRecorder(micStream, mimeType ? { mimeType } : undefined);
    recorder.current = rec;
    rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    rec.onstop = () => {
      const durationMs = Date.now() - startedAt.current;
      const blob = new Blob(chunks.current, { type: rec.mimeType || mimeType || "audio/webm" });
      const collected = peaks.current;
      teardown();
      setRecording(false);
      setElapsed(0);
      setLevel(0);
      if (cancelled.current) return;
      if (durationMs < MIN_MS || !blob.size) {
        setError(tr("That was too short to send. Hold on a moment longer."));
        return;
      }
      onRecorded({ blob, durationMs, waveform: downsample(collected, PEAKS), mimeType: blob.type });
    };
    rec.start();
    setRecording(true);

    timer.current = window.setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      // The cap stops the recorder, which sends what was captured — it does not
      // throw the clip away. Two minutes of speech is a message, not a mistake.
      if (ms >= MAX_MS) stop();
    }, 200);
  }

  function stop() {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }

  function cancel() {
    cancelled.current = true;
    stop();
  }

  if (!recording) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          aria-label={tr("Record a voice note")}
          title={tr("Record a voice note")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
        >
          <MicIcon on={false} />
        </button>
        {error && (
          <span role="status" className="max-w-[240px] text-micro text-muted-foreground">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
      <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" />
      <span className="shrink-0 text-sm tabular-nums text-foreground">{clock(elapsed)}</span>
      <LiveBars level={level} />
      <button
        type="button"
        onClick={cancel}
        className="shrink-0 text-micro text-muted-foreground hover:text-foreground"
      >
        {tr("Cancel")}
      </button>
      <button
        type="button"
        onClick={stop}
        aria-label={tr("Stop and attach the recording")}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
      >
        <span aria-hidden>✓</span>
      </button>
    </div>
  );
}

/** A scrolling level meter. Purely live — the stored peaks are the ones in
 *  `peaks.current`, not what this happens to be showing. */
function LiveBars({ level }: { level: number }) {
  const [history, setHistory] = React.useState<number[]>([]);
  React.useEffect(() => {
    setHistory((prev) => [...prev, level].slice(-28));
  }, [level]);
  return (
    <div className="flex h-6 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden>
      {history.map((v, i) => (
        <span
          key={i}
          className="w-[3px] shrink-0 rounded-full bg-primary"
          style={{ height: `${Math.max(8, v)}%` }}
        />
      ))}
    </div>
  );
}

function MicIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" fill={on ? "currentColor" : "none"} />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

