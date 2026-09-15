/**
 * Transcribing a voice note with the BROWSER's own recogniser.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The workspace's transcription runs server-side against Groq/Whisper, and a
 * workspace that never configured a key gets `UNAVAILABLE` — which is honest,
 * and is also the end of the road. On a corridor where a two-minute clip is
 * sometimes the only instruction anyone wrote down, "nobody configured a
 * provider" should not be the last word.
 *
 * Chrome (and Edge, and Safari under `webkitSpeechRecognition`) ships a
 * recogniser in the platform. It costs no key, no vendor and no round trip, and
 * it is already how `components/ai/speech.ts` lets somebody dictate a question.
 * So it is the fallback: when the workspace has none, the READER's own browser
 * can have a go.
 *
 * ── THE THING IT CANNOT DO, STATED PLAINLY ────────────────────────────────
 *
 * `SpeechRecognition` listens to the MICROPHONE. There is no API on any
 * shipping browser that hands it a file, a Blob, an `<audio>` element or a
 * `MediaStreamTrack` you built yourself — so the only way to point it at a
 * recording is to PLAY the recording where the microphone can hear it.
 *
 * That is a real constraint and not a defect in this file, and the UI says so
 * in as many words before anything happens: the clip plays out loud, the
 * microphone listens, and a noisy room or a muted speaker produces a worse
 * result than a quiet one. Pretending otherwise — starting silently and
 * returning nothing — is the failure shape `voice-recorder.tsx` already has a
 * paragraph about: a control that appears to work and does nothing.
 *
 * It is also why the words this produces are shown to the reader and NEVER
 * written back to the conversation. `smartcomm.service.js` renders every
 * message into a SHA-256'd certified export, and a transcript in that record
 * has to be something the workspace's own provider produced from the stored
 * bytes — not what one member's laptop thought it heard across a desk.
 *
 * ── ENGLISH OR FRENCH ─────────────────────────────────────────────────────
 *
 * The recogniser is told which language to expect and does not guess. Given the
 * wrong one it does not fail — it produces confident, fluent nonsense, which is
 * worse than nothing on a customs instruction. So the language is a visible
 * control, defaulted to the one the reader is already running the ERP in, and
 * changing it re-runs the clip rather than editing what it heard.
 */
import * as React from "react";
import { recognitionCtor, type RecognitionLike } from "@/components/ai/speech";
import i18n from "@/lib/i18n";

/** The two the corridor speaks. `en-GB`, not `en-US`: the same reason
 *  `lib/format.ts` pins en-GB for anything with a day number in it. */
export type SpeechLang = "en-GB" | "fr-FR";

export const SPEECH_LANGS: { value: SpeechLang; label: string }[] = [
  { value: "en-GB", label: "EN" },
  { value: "fr-FR", label: "FR" },
];

/** Open in the language the reader is already reading the product in. */
export function defaultSpeechLang(): SpeechLang {
  return String(i18n.language || "").startsWith("fr") ? "fr-FR" : "en-GB";
}

/** Is there a recogniser at all? Firefox has none, and the caller renders no
 *  button rather than a dead one. */
export function speechSupported(): boolean {
  return recognitionCtor() !== null;
}

/**
 * The ways listening ends badly, kept apart because they need different
 * sentences — the same reasoning the player's `Problem` union gets.
 *
 *   "denied"  the microphone was refused. The reader can change that.
 *   "nothing" it listened and heard no words. Usually the volume, sometimes
 *             the language, occasionally a clip with no speech in it.
 *   "failed"  the recogniser itself errored — offline, or no network service
 *             behind it. Nothing the reader did.
 */
export type ListenProblem = null | "denied" | "nothing" | "failed";

type State = {
  listening: boolean;
  /** Everything heard so far, settled + interim. Rendered live. */
  heard: string;
  problem: ListenProblem;
};

const IDLE: State = { listening: false, heard: "", problem: null };

/**
 * Play one `<audio>` element out loud and transcribe what the microphone hears.
 *
 * The element is the caller's — the same one the bubble already plays — so the
 * clip is not fetched twice and the bar moves while it runs, which is the only
 * honest progress indicator available here.
 */
export function useClipListener() {
  const [state, setState] = React.useState<State>(IDLE);
  const rec = React.useRef<RecognitionLike | null>(null);
  const el = React.useRef<HTMLAudioElement | null>(null);
  const detach = React.useRef<(() => void) | null>(null);
  /** Settled text, outside React state: `onresult` fires many times a second
   *  and reads its own accumulator, which a state value would lag behind. */
  const settled = React.useRef("");

  /** Drop the recogniser, the element listener and the clip, in that order.
   *  Safe to call twice — every exit path calls it. */
  const teardown = React.useCallback(() => {
    detach.current?.();
    detach.current = null;
    const r = rec.current;
    rec.current = null;
    // `abort` rather than `stop`: stop asks for a final result and fires
    // `onend` later, which would re-enter this through a handler we have
    // already dropped.
    r?.abort();
    const audio = el.current;
    el.current = null;
    if (audio && !audio.paused) audio.pause();
  }, []);

  React.useEffect(() => teardown, [teardown]);

  const stop = React.useCallback(() => {
    teardown();
    setState((s) => ({ ...s, listening: false }));
  }, [teardown]);

  const start = React.useCallback(
    (audio: HTMLAudioElement, lang: SpeechLang) => {
      const Ctor = recognitionCtor();
      if (!Ctor) return;
      teardown();
      settled.current = "";
      setState({ listening: true, heard: "", problem: null });

      const r = new Ctor();
      rec.current = r;
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) settled.current += text;
          else interim += text;
        }
        const heard = (settled.current + interim).trimStart();
        setState((s) => (s.heard === heard ? s : { ...s, heard }));
      };
      r.onerror = (e) => {
        const denied = e && (e.error === "not-allowed" || e.error === "service-not-allowed");
        teardown();
        setState((s) => ({
          listening: false,
          heard: s.heard,
          // "no-speech" is not an error the reader can act on differently from
          // silence, so it takes the same sentence as silence.
          problem: denied ? "denied" : e && e.error === "no-speech" ? "nothing" : "failed",
        }));
      };
      r.onend = () => {
        rec.current = null;
        setState((s) => ({
          listening: false,
          heard: s.heard,
          problem: s.problem ?? (s.heard.trim() ? null : "nothing"),
        }));
      };

      try {
        r.start();
      } catch {
        // Already running, or the page cannot reach the recogniser at all.
        teardown();
        setState({ listening: false, heard: "", problem: "failed" });
        return;
      }

      // Only now is the clip played: starting it first would spend its opening
      // words on a recogniser that had not begun.
      el.current = audio;
      const ended = () => {
        // `stop`, not `abort`: the clip is over and the last partial phrase is
        // worth waiting for. `onend` reports the result.
        rec.current?.stop();
        detach.current?.();
        detach.current = null;
      };
      audio.addEventListener("ended", ended);
      detach.current = () => audio.removeEventListener("ended", ended);
      audio.currentTime = 0;
      // Normal speed regardless of what the reader last set: 2× is a good way
      // to skim a clip and a bad way to be understood.
      audio.playbackRate = 1;
      audio.muted = false;
      // Guarded for the same reason `voice-note.tsx` guards it: `play()` is
      // only specified to return a promise, and older WebKit returns
      // undefined. `.catch` on that throws out of a click handler and takes
      // the bubble down with it.
      const started = audio.play() as Promise<void> | undefined;
      if (started && typeof started.catch === "function") {
        started.catch(() => {
          teardown();
          setState({ listening: false, heard: "", problem: "failed" });
        });
      }
    },
    [teardown],
  );

  return { supported: speechSupported(), ...state, start, stop };
}
