/**
 * Hold-to-talk, transcribed server-side.
 *
 * ── WHY NOT THE BROWSER'S OWN SPEECH API ───────────────────────────────────
 *
 * `webkitSpeechRecognition` is free and needs no round trip, and it is the wrong
 * choice here for three reasons that all bite the same user: it does not exist
 * in Firefox or in most installed-PWA webviews, it silently ships audio to the
 * browser vendor rather than to the provider this workspace configured, and its
 * accuracy on Nigerian and Cameroonian English is materially worse than
 * Whisper's. This records locally and posts the clip to the tenant's own
 * transcription provider.
 *
 * ── WHAT IT APPENDS, AND WHY IT NEVER REPLACES ─────────────────────────────
 *
 * Transcribed text is APPENDED to whatever is already in the field. Somebody
 * who types half an answer, then speaks the rest, must not lose the half they
 * typed — and somebody who records twice is adding a second thought, not
 * correcting the first. Replacing is destructive and unrecoverable; appending
 * is one Backspace away from either.
 *
 * ── FAILURE IS ALWAYS SAID OUT LOUD ────────────────────────────────────────
 *
 * A mic button that does nothing is the worst outcome: people press it again,
 * and again, and conclude the product is broken. Every failure path here —
 * permission refused, no provider configured, a clip too short to contain
 * speech — produces a visible sentence telling them what happened and that they
 * can type instead.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";

/** Below this, the clip is a mis-click rather than an answer. */
const MIN_MS = 400;
/** The server caps the payload; stopping first gives a clearer message than a
 *  422 after the upload. */
const MAX_MS = 120_000;

type State = "idle" | "recording" | "working";

function MicIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" fill={on ? "currentColor" : "none"} />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export function VoiceInput({
  onText,
  disabled,
  label = "Record your answer",
}: {
  /** Called with the transcript. The caller appends — see the header. */
  onText: (text: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [state, setState] = React.useState<State>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const recorder = React.useRef<MediaRecorder | null>(null);
  const chunks = React.useRef<Blob[]>([]);
  const startedAt = React.useRef(0);
  const stopTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Release the microphone if the question is answered and unmounted mid-record
  // — without this the browser's recording indicator stays lit on a screen with
  // no mic on it, which reads as the app listening when it is not.
  React.useEffect(() => () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, dismissed, or no device. All three are the same recovery.
      setError("No microphone access — type your answer instead.");
      return;
    }
    const rec = new MediaRecorder(stream);
    recorder.current = rec;
    chunks.current = [];
    startedAt.current = Date.now();

    rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const ms = Date.now() - startedAt.current;
      if (ms < MIN_MS || !chunks.current.length) {
        setState("idle");
        setError("That was too short to hear — hold the button while you speak.");
        return;
      }
      setState("working");
      try {
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onerror = () => reject(new Error("read failed"));
          r.onload = () => resolve(String(r.result));
          r.readAsDataURL(blob);
        });
        const { text } = await api.transcribeAnswer(dataUrl);
        if (text) onText(text);
        // An empty transcript is a real outcome — silence, or background noise
        // Whisper found no words in — and saying so beats appending nothing and
        // leaving the person wondering whether it worked.
        else setError("Nothing was picked up. Try again, closer to the mic.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't transcribe that. Type your answer instead.");
      } finally {
        setState("idle");
      }
    };

    rec.start();
    setState("recording");
    stopTimer.current = setTimeout(() => { if (rec.state === "recording") rec.stop(); }, MAX_MS);
  }

  function stop() {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  const recording = state === "recording";
  const busy = state === "working";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={disabled || busy}
        // Press-and-hold on pointer, so it behaves like a walkie-talkie; but
        // `onClick` would fire on Enter/Space for a keyboard user and start a
        // recording nothing could stop, so the keyboard path is an explicit
        // toggle instead.
        onPointerDown={(e) => { e.preventDefault(); if (!recording) void start(); }}
        onPointerUp={stop}
        onPointerLeave={() => { if (recording) stop(); }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          if (recording) stop(); else void start();
        }}
        aria-label={recording ? "Stop recording" : label}
        aria-pressed={recording}
        title={recording ? "Release to transcribe" : label}
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition-colors",
          recording
            ? "border-[rgb(var(--bad)_/_0.5)] bg-[rgb(var(--bad)_/_0.12)] text-[rgb(var(--bad))]"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          busy && "opacity-60",
        )}
      >
        {busy ? (
          <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-transparent border-t-current" />
        ) : (
          <MicIcon on={recording} />
        )}
      </button>
      {/* Live region: the state changes without focus moving, so a screen-reader
          user would otherwise get no signal that recording started or ended. */}
      <span role="status" aria-live="polite" className="sr-only">
        {recording ? "Recording" : busy ? "Transcribing" : ""}
      </span>
      {(recording || busy || error) && (
        <span className={cn("text-right text-xs", error ? "text-[rgb(var(--bad))]" : "text-muted-foreground")}>
          {error || (recording ? "Listening — release when done" : "Transcribing…")}
        </span>
      )}
    </div>
  );
}
