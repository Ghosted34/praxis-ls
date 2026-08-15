/**
 * Voice, both directions — dictating a question and hearing an answer.
 *
 * BOTH ARE THE BROWSER'S, NOT A MODEL'S. `speechSynthesis` and
 * `SpeechRecognition` ship in the platform, so this adds two genuinely useful
 * affordances without adding a vendor, a key, a budget line or a round trip.
 * That is the whole reason they are worth having at this stage: they are UI.
 *
 * WHY THEY MATTER ON THIS PRODUCT SPECIFICALLY. A logistics desk is not a desk
 * half the time. The person asking "what's blocking SBX-0142" is in a yard, at
 * a counter, or holding a phone in one hand and a delivery note in the other.
 * Dictation is faster than thumbs, and having a dispatch summary read out is the
 * difference between reading it now and reading it later.
 *
 * EVERYTHING DEGRADES TO NOTHING. `supported` is false on a browser without the
 * API — Firefox has no `SpeechRecognition` — and the callers render no button
 * at all rather than a dead one. A control that does nothing when pressed is
 * worse than an absent control, because the user spends a try finding out.
 */
import * as React from "react";

/* ─────────────────────────── speaking ─────────────────────────── */

/** Strip the markdown so the voice reads prose, not asterisks and pipes. */
function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/\|/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read an answer aloud. One utterance at a time, app-wide.
 *
 * The `speakingId` is shared through a module-level subscriber set rather than a
 * context: two answers must never speak at once, and the surfaces that can
 * render an answer (drawer, workspace) are in different subtrees. Starting a
 * second utterance cancels the first, and every mounted toolbar learns about it.
 */
type Listener = (id: string | null) => void;
const listeners = new Set<Listener>();
let speaking: string | null = null;

function setSpeaking(id: string | null) {
  speaking = id;
  for (const l of listeners) l(id);
}

export function useSpeech() {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const [current, setCurrent] = React.useState<string | null>(speaking);

  React.useEffect(() => {
    listeners.add(setCurrent);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);

  // Stop on unmount of the LAST subscriber: navigating away mid-sentence and
  // having the page keep talking is a genuinely alarming bug to hit.
  React.useEffect(
    () => () => {
      if (listeners.size === 0 && supported) window.speechSynthesis.cancel();
    },
    [supported],
  );

  const toggle = React.useCallback(
    (id: string, text: string) => {
      if (!supported) return;
      window.speechSynthesis.cancel();
      if (speaking === id) {
        setSpeaking(null);
        return;
      }
      const u = new SpeechSynthesisUtterance(speakable(text));
      u.rate = 1.05; // Default reads slightly ponderously for operational prose.
      u.onend = () => setSpeaking(null);
      u.onerror = () => setSpeaking(null);
      setSpeaking(id);
      window.speechSynthesis.speak(u);
    },
    [supported],
  );

  return { supported, speakingId: current, toggle };
}

/* ────────────────────────── dictating ────────────────────────── */

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    (new () => RecognitionLike) | null;
}

/**
 * Dictate into the composer.
 *
 * INTERIM RESULTS ARE ON, and that is the difference between this feeling like
 * a microphone and feeling like a form submission. Words appear as they are
 * said, so the user can see it is working and stop when it has gone wrong,
 * rather than speaking a whole sentence into silence and hoping.
 *
 * The transcript is delivered through `onText` as the FULL text to date, not as
 * deltas — the composer owns the input value, and a delta protocol between two
 * components that both think they own a string is how you get duplicated words.
 */
export function useDictation(onText: (text: string) => void) {
  const supported = recognitionCtor() !== null;
  const [listening, setListening] = React.useState(false);
  const ref = React.useRef<RecognitionLike | null>(null);
  // Latest callback in a ref: the recognition object is created once, and a
  // handler bound to the first render's closure would write to a stale setter.
  const sink = React.useRef(onText);
  sink.current = onText;

  const stop = React.useCallback(() => {
    ref.current?.stop();
    setListening(false);
  }, []);

  const start = React.useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    ref.current = rec;
    rec.lang = document.documentElement.lang || navigator.language || "en-GB";
    rec.continuous = true;
    rec.interimResults = true;
    let settled = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) settled += t;
        else interim += t;
      }
      sink.current((settled + interim).trimStart());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    try {
      rec.start();
      setListening(true);
    } catch {
      // Already started, or the permission prompt was dismissed. Either way the
      // honest state is "not listening".
      setListening(false);
    }
  }, []);

  React.useEffect(
    () => () => {
      ref.current?.abort();
    },
    [],
  );

  return {
    supported,
    listening,
    start,
    stop,
    toggle: () => (listening ? stop() : start()),
  };
}
