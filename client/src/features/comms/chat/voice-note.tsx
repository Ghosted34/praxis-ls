/**
 * Playing a voice note back, and reading it when playing it is not an option.
 *
 * ── THE TRANSCRIPT IS ASKED FOR, NOT PRODUCED ─────────────────────────────
 *
 * Somebody in a meeting cannot play a clip. Somebody on a noisy quay cannot
 * hear one. And `certifiedExport` renders every message to one line of a
 * SHA-256'd transcript, so a voice note without words was the one format that
 * vanished from the legal record of a channel — the format people reach for
 * precisely when an instruction is urgent. All of that is why the words matter.
 *
 * None of it is a reason to produce them for every clip. Every voice note used
 * to go to the provider the moment it landed, unasked: a bill per clip, and a
 * copy of a private conversation leaving the tenant, paid on the guess that
 * somebody would want to read it. Most voice notes are listened to, once, by
 * the two people in the thread.
 *
 * So there is a button. Pressing it transcribes THIS clip, the result is stored
 * and published to the channel (so the second person to press it pays nothing
 * and reads the same sentence), and a clip nobody asks about costs nothing.
 *
 * The states are shown as different things because they need different
 * responses:
 *
 *   NONE         nobody has asked yet. The button.
 *   PENDING      a provider call is in flight. Wait.
 *   DONE         here are the words.
 *   UNAVAILABLE  nobody configured a provider. The operator's problem — and
 *                the cue to offer the reader's OWN BROWSER instead, which is
 *                the one path that needs no key and no vendor. See
 *                `browser-transcribe.ts` for what that can and cannot do.
 *   FAILED       it was tried and did not work. Play the clip.
 *
 * ── THE BARS ARE STORED, NOT DECODED ──────────────────────────────────────
 *
 * `waveform` came off the recorder's own analyser at capture time. Decoding the
 * clip here to draw them would mean every reader of every bubble paying for a
 * `decodeAudioData` — the same work, done n times instead of once.
 *
 * ── WHY VOICE NOTES DID NOT PLAY, AND WHAT EACH FIX IS FOR ────────────────
 *
 * Three separate defects, each of which alone was enough to make a clip
 * unplayable, and which together produced "nothing happens, on every device".
 *
 *   1. THE ELEMENT DID NOT EXIST WHEN THE FINGER WENT DOWN. The <audio> was
 *      rendered only once the bytes had landed, so the first press had no
 *      element to act on and the `play()` that eventually ran was one network
 *      round trip removed from the gesture that asked for it. That is exactly
 *      the shape WebKit refuses: on iOS — Safari and the installed PWA alike —
 *      a media element may only start from inside a user gesture, and a press
 *      that starts a fetch and plays on its `.then()` is not inside one. The
 *      element is mounted from the first render now, and the press calls
 *      `load()` on it SYNCHRONOUSLY, which is what clears WebKit's restriction
 *      for every later `play()` on that element.
 *
 *   2. EVERY REFUSAL WAS REPORTED AS THE SAME REFUSAL. `play()` rejects with a
 *      named error, and the catch ignored the name: "your browser stopped it
 *      from starting on its own" was printed for a clip the browser could not
 *      decode, which sends the reader pressing play again for ever at a
 *      recording that will never play. The three names get their three
 *      sentences.
 *
 *   3. THE BAR — the four-times-bigger, progress-shaped target a hand actually
 *      goes for — GAVE UP WHENEVER THE CONTAINER CARRIED NO DURATION. It
 *      refused to act unless `el.duration` was finite, and `MediaRecorder`
 *      writes a WebM with no duration in its header. Chromium recovers one by
 *      scanning a fully-buffered blob (measured, in `e2e/voice-note.spec.ts`);
 *      WebKit does not, and reports `Infinity` for exactly the clips this app
 *      produces. So a check that was meant to mean "not loaded yet" meant
 *      "recorded by us, on an iPhone" — and there it swallowed every press of
 *      the bar in silence. The length now falls back to `duration_ms`, which
 *      the recorder measured at capture time and stored on the row precisely
 *      because the container does not carry it.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/smartcomm-api";
import type { CommAttachment, TranscriptStatus } from "@/lib/smartcomm-api";
import { useObjectUrl } from "./use-object-url";
import { clock } from "./audio-utils";
import {
  SPEECH_LANGS,
  defaultSpeechLang,
  useClipListener,
  type SpeechLang,
} from "./browser-transcribe";

const SPEEDS = [1, 1.5, 2] as const;

/**
 * Which ground this bubble is drawn on.
 *
 * NOT decoration. `message-bubble.tsx` paints the sender's own messages
 * `bg-primary` — the tenant's brand fill — and everything inside inherits that
 * ground. `--muted-foreground` is the token for secondary text on a SURFACE,
 * and on the orange fill it measures 2.39:1 in light mode and **1.01:1 in
 * dark**, which is not "low contrast", it is invisible. Every status line in
 * this file was drawn in it.
 *
 * The bubble knows which ground it painted and nothing else does, so it says.
 */
export type BubbleTone = "surface" | "primary";

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

/** What `play()` rejected with, mapped to what the reader should do about it. */
function problemFor(err: unknown): Problem | "ignore" {
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  // A new load interrupted this play. Nothing went wrong and nothing is owed
  // to the reader — saying something here would put a sentence under the bubble
  // every time they pressed the bar twice.
  if (name === "AbortError") return "ignore";
  if (name === "NotSupportedError") return "undecodable";
  return "blocked";
}

export function VoiceNote({
  attachment,
  tone = "surface",
}: {
  attachment: CommAttachment;
  tone?: BubbleTone;
}) {
  const onFill = tone === "primary";
  /** Secondary text, on whichever ground this bubble painted. */
  const meta = onFill ? "text-primary-foreground/80" : "text-muted-foreground";
  /** A control drawn as text. `--primary-ink` is the accent step-down for a
   *  surface; on the accent itself the ink IS `--primary-foreground`. */
  const link = onFill
    ? "text-primary-foreground underline-offset-2 hover:underline"
    : "text-primary-ink underline-offset-2 hover:underline";

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
  /** Whether the fetch now in flight was asked for by a PRESS ON PLAY.
   *  The browser-transcription fallback needs the same bytes and starts the
   *  clip itself, from the top; autoplaying underneath it would have the
   *  recogniser listening to a clip already a second in. */
  const autoplayOnLoad = React.useRef(true);

  // The bytes are fetched on the FIRST PLAY, not on render. A channel with
  // forty voice notes in its history must not pull forty clips down to show
  // forty bars — the bars are already in the row.
  const fetcher = React.useMemo(
    () => (mediaId ? (signal: AbortSignal) => api.mediaObjectUrl(mediaId, signal) : null),
    [mediaId],
  );
  const { url, loading, error } = useObjectUrl(fetcher, { enabled: wanted });

  const durationMs = Number(attachment.duration_ms) || 0;

  /**
   * How long the clip is, in seconds, for seeking.
   *
   * `el.duration` first, because a clip that carries its own duration is the
   * authority on it. `duration_ms` second, and it is not a nicety: every clip
   * this app records comes out of `MediaRecorder`, which writes a WebM with no
   * duration in its header, so `el.duration` is `Infinity` until the thing has
   * been played to the end at least once. Seeking used to give up there.
   */
  const clipSeconds = React.useCallback(
    (el: HTMLAudioElement) =>
      Number.isFinite(el.duration) && el.duration > 0
        ? el.duration
        : durationMs > 0
          ? durationMs / 1000
          : 0,
    [durationMs],
  );

  const start = React.useCallback((el: HTMLAudioElement, rate: number) => {
    el.playbackRate = rate;
    el.play().catch((err: unknown) => {
      const next = problemFor(err);
      if (next !== "ignore") setProblem(next);
    });
  }, []);

  // Autoplay once the bytes land, but only because a press is what asked for
  // them. Nothing here ever starts on its own.
  React.useEffect(() => {
    const el = audioRef.current;
    if (!url || !wanted || !el || !el.paused) return;
    if (!autoplayOnLoad.current) {
      autoplayOnLoad.current = true;
      return;
    }
    start(el, speed);
    // `speed` and `playing` are deliberately not dependencies: re-running on a
    // speed change or on pause would restart the clip the reader just paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, wanted]);

  const bars = (attachment.waveform && attachment.waveform.length ? attachment.waveform : null) ||
    // No peaks (an older row, or an analyser that would not start): a flat even
    // bar is honest — it says "audio", and claims nothing about its shape.
    Array.from({ length: 32 }, () => 30);

  const progress = durationMs ? Math.min(1, position / (durationMs / 1000)) : 0;

  /**
   * Everything that must happen INSIDE the press, before any await.
   *
   * Returns the element when it is ready to be acted on, and null when the
   * bytes have only just been asked for — in which case the effect above plays
   * them the moment they land.
   */
  function arm(): HTMLAudioElement | null {
    if (!mediaId) {
      setProblem("gone");
      return null;
    }
    setProblem(null);
    const el = audioRef.current;
    if (!el) return null;
    if (!url) {
      // The bytes are not here yet, so this press cannot start anything. What
      // it CAN do is spend itself on `load()` — a gesture-initiated load is
      // what removes WebKit's "media may only start from a user gesture"
      // restriction from this element, and without it the `play()` that runs
      // when the fetch resolves is refused on every iPhone in the company.
      try {
        el.load();
      } catch {
        /* @silent:teardown — an element with nothing to load is not an error;
           the fetch below is what this press was really for. */
      }
      setWanted(true);
      return null;
    }
    return el;
  }

  /** Fetch the bytes without starting them — what the browser-transcription
   *  fallback needs, since it plays the clip itself from the top. */
  function loadQuietly() {
    // `wanted` already true means a press on play is mid-fetch and is owed its
    // autoplay; suppressing it here would swallow that press instead.
    if (!mediaId || url || wanted) return;
    autoplayOnLoad.current = false;
    setProblem(null);
    setWanted(true);
  }

  function toggle() {
    const el = arm();
    // Null means the fetch has just been asked for; the effect above plays it
    // when the bytes land. Not an error, and not silence either — the button
    // shows "…" while `loading`.
    if (!el) return;
    if (el.paused) start(el, speed);
    else el.pause();
  }

  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed as 1) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  /** Move to `ratio` through the clip, when there is a length to move within. */
  function seekTo(el: HTMLAudioElement, ratio: number): boolean {
    const length = clipSeconds(el);
    if (!length) return false;
    try {
      el.currentTime = ratio * length;
    } catch {
      /* @silent:teardown — a clip that is not seekable yet keeps playing from
         where it is, which is better than refusing the press outright. */
      return false;
    }
    setPosition(el.currentTime);
    return true;
  }

  /**
   * The bar PLAYS, and scrubs once there is something to scrub.
   *
   * It is four times the area of the play button and it is drawn as a progress
   * bar, so it is the target a hand actually goes for — on a phone it is very
   * nearly the only one. Two things have made it a silent no-op in the past:
   * it used to open with `if (!el) return` on an element that did not exist
   * until the first play, and then it refused to act unless `el.duration` was
   * finite, which for a clip this app recorded it never is. Both are why "the
   * voice notes don't play" was reported against a player that played.
   */
  function seek(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    // A keyboard Enter reports clientX 0, which clamps to the start — "play
    // this", which is the right reading of Enter on a bar.
    const ratio = rect.width
      ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      : 0;
    // Recorded before `arm`, so the press is honoured on the path where the
    // clip is still being fetched and `onLoadedMetadata` applies it later.
    pendingSeek.current = ratio;
    const el = arm();
    if (!el) return;
    if (seekTo(el, ratio)) pendingSeek.current = null;
    if (el.paused) start(el, speed);
  }

  /** Apply a click that landed before the clip was there to move within. */
  function applyPendingSeek(el: HTMLAudioElement) {
    const ratio = pendingSeek.current;
    pendingSeek.current = null;
    if (ratio !== null) seekTo(el, ratio);
  }

  return (
    /*
     * A WIDTH, not only a maximum — the bar's size must not depend on what
     * else happens to be in the bubble.
     *
     * The waveform is `flex-1` over bars that are themselves `flex-1`, so its
     * INTRINSIC width is about ten pixels: five 2px gaps and nothing else. A
     * bubble shrink-wraps to its widest child, and until the transcript moved
     * behind a button the widest child was a sentence — "Voice transcription
     * isn't set up on this workspace." — which stretched the row to something
     * like 320px and gave the bar its size by accident. Hiding that sentence
     * collapsed the player to a 10px stub, smaller than the play button it is
     * supposed to dwarf, which the layout gate caught in a real browser.
     */
    <div className="w-[280px] max-w-full space-y-1.5">
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

        {/*
         * MOUNTED FROM THE FIRST RENDER, with no `src` until the reader asks —
         * so it fetches nothing, and so `arm()` has something to `load()`
         * inside the press. Rendering it only once the bytes had landed is
         * defect 1 in the header: it is why iOS refused every clip.
         */}
        <audio
          ref={audioRef}
          src={url || undefined}
          preload="auto"
          onPlay={() => { setPlaying(true); setProblem(null); }}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setPosition(0); }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => applyPendingSeek(e.currentTarget)}
          // The bytes arrived (the fetch resolved) and the browser still
          // cannot play them — a codec this device lacks, or a truncated
          // clip. Without this handler that rendered as a button that did
          // nothing, which is the failure this whole file now exists to
          // refuse. Guarded on `url`, because an element with no source
          // fires `error` on some browsers merely for existing.
          onError={() => { if (url) setProblem("undecodable"); }}
          className="hidden"
        />
      </div>

      {/* One line, and never two at once: a fetch that failed is not also a
          decode that failed, and stacking them would make the bubble taller
          every time something went wrong. */}
      {error ? (
        <p className={cn("text-micro", meta)}>
          {tr("Couldn't load that recording. Check your connection and press play again.")}
        </p>
      ) : problem === "undecodable" ? (
        <p className={cn("text-micro", meta)}>{tr("This browser can't play this recording.")}</p>
      ) : problem === "blocked" ? (
        <p className={cn("text-micro", meta)}>
          {tr("Your browser stopped it from starting on its own. Press play again.")}
        </p>
      ) : problem === "gone" ? (
        <p className={cn("text-micro", meta)}>
          {tr("This recording is no longer attached to the message.")}
        </p>
      ) : null}

      <Transcript
        attachment={attachment}
        audio={audioRef}
        clipReady={!!url}
        loadClip={loadQuietly}
        meta={meta}
        link={link}
      />
    </div>
  );
}

/* ── the words ────────────────────────────────────────────────────────────── */

type Known = { status: TranscriptStatus; text: string | null };

/**
 * The transcript, and the button that is the only way to get one.
 *
 * Its own component because it owns five pieces of state the player does not
 * care about, and because the player is the part that has to stay simple: a
 * bug in here must not be able to stop a clip from playing.
 */
function Transcript({
  attachment,
  audio,
  clipReady,
  loadClip,
  meta,
  link,
}: {
  attachment: CommAttachment;
  audio: React.RefObject<HTMLAudioElement | null>;
  /** The bytes are here. Until they are, there is nothing for the recogniser
   *  to listen to — the element exists but carries no source. */
  clipReady: boolean;
  loadClip: () => void;
  meta: string;
  link: string;
}) {
  const mediaId = attachment.media_id || "";
  const [asked, setAsked] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  /** What the server last said, once this reader has asked. Null until then,
   *  so the row the thread arrived with is what shows. */
  const [server, setServer] = React.useState<Known | null>(null);
  const [lang, setLang] = React.useState<SpeechLang>(defaultSpeechLang);
  const listener = useClipListener();

  const known: Known = server ?? {
    status: attachment.transcript_status || "NONE",
    text: attachment.transcript ?? null,
  };

  async function transcribe() {
    setAsked(true);
    // Somebody else already pressed it in this channel: the words are on the
    // row and there is nothing to pay for.
    if (known.status === "DONE" || !mediaId) return;
    setAsking(true);
    try {
      const row = await api.transcribeMedia(mediaId, lang === "fr-FR" ? "fr" : "en");
      setServer({ status: row.transcript_status, text: row.transcript });
    } catch {
      // The call itself did not land — a network drop, a 403. That is not the
      // same as a provider that answered badly, but it needs the same sentence
      // and the same next step from the reader: press it again.
      setServer({ status: "FAILED", text: null });
    } finally {
      setAsking(false);
    }
  }

  /** Set when the reader pressed Listen before the clip had been fetched. */
  const [waitingForClip, setWaitingForClip] = React.useState(false);

  function listen() {
    if (listener.listening) {
      setWaitingForClip(false);
      listener.stop();
      return;
    }
    if (!clipReady) {
      // The reader may never have pressed play — the element is mounted but
      // has no source. Fetch it, and remember that this press was a Listen so
      // the clip is not started twice from two different places.
      setWaitingForClip(true);
      loadClip();
      return;
    }
    const el = audio.current;
    if (el) listener.start(el, lang);
  }

  React.useEffect(() => {
    if (!waitingForClip || !clipReady) return;
    const el = audio.current;
    if (!el) return;
    setWaitingForClip(false);
    listener.start(el, lang);
    // `listener` is recreated every render; depending on it would restart the
    // clip on its own state changes, which is the one thing this must not do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForClip, clipReady, lang]);

  const cycleLang = () =>
    setLang((l) => (SPEECH_LANGS.find((x) => x.value !== l) ?? SPEECH_LANGS[0]).value);

  const langChip = (
    <button
      type="button"
      onClick={cycleLang}
      aria-label={tr("Language of this recording")}
      title={tr("Language of this recording")}
      className={cn("shrink-0 rounded px-1 text-micro tabular-nums", link)}
    >
      {SPEECH_LANGS.find((x) => x.value === lang)?.label ?? "EN"}
    </button>
  );

  // Nothing asked for yet: one button and the language it will use. This is the
  // whole of requirement "not automatic" — no clip is sent anywhere, and no
  // words are shown, until somebody presses this.
  if (!asked) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={transcribe} className={cn("text-micro", link)}>
          {known.status === "DONE" ? tr("Show transcript") : tr("Transcribe")}
        </button>
        {langChip}
      </div>
    );
  }

  const pending = asking || known.status === "PENDING";

  return (
    <div className="space-y-1">
      {pending && <p className={cn("text-micro italic", meta)}>{tr("Transcribing…")}</p>}

      {!pending && known.status === "DONE" && known.text && (
        <p className="rounded-lg bg-muted px-2.5 py-1.5 text-sm text-foreground">{known.text}</p>
      )}
      {!pending && known.status === "DONE" && !known.text && (
        <p className={cn("text-micro italic", meta)}>{tr("No speech was found in this clip.")}</p>
      )}
      {!pending && known.status === "FAILED" && (
        <p className={cn("text-micro italic", meta)}>{tr("This one couldn't be transcribed.")}</p>
      )}

      {/*
       * NO PROVIDER. The workspace's problem, and not the end of the road: the
       * reader's own browser ships a recogniser. What it cannot do is read a
       * file — see browser-transcribe.ts — so the offer says out loud what
       * pressing it will actually do, before it does it.
       */}
      {!pending && known.status === "UNAVAILABLE" && (
        <div className="space-y-1">
          <p className={cn("text-micro italic", meta)}>
            {tr("Voice transcription isn't set up on this workspace.")}
          </p>
          {listener.supported ? (
            <>
              <div className="flex items-center gap-2">
                <button type="button" onClick={listen} className={cn("text-micro", link)}>
                  {listener.listening
                    ? tr("Stop listening")
                    : waitingForClip
                      ? tr("Fetching the clip…")
                      : tr("Let this browser listen instead")}
                </button>
                {langChip}
              </div>
              <p className={cn("text-micro", meta)}>
                {listener.listening
                  ? tr("Playing the clip out loud and listening. Keep the volume up.")
                  : tr("It plays the clip out loud and transcribes what the microphone hears.")}
              </p>
            </>
          ) : (
            <p className={cn("text-micro", meta)}>
              {tr("This browser has no speech recognition. Chrome or Edge can do it.")}
            </p>
          )}
        </div>
      )}

      {/* What the browser heard. Shown while it is still listening, because
          words appearing as the clip plays are the only honest sign that it is
          working — the same reason dictation runs with interim results on. */}
      {listener.heard && (
        <div className="space-y-0.5">
          <p className="rounded-lg bg-muted px-2.5 py-1.5 text-sm text-foreground">
            {listener.heard}
          </p>
          {!listener.listening && (
            <p className={cn("text-micro italic", meta)}>
              {tr("Heard by this browser. Not saved to the conversation.")}
            </p>
          )}
        </div>
      )}

      {!listener.listening && !listener.heard && listener.problem === "denied" && (
        <p className={cn("text-micro", meta)}>
          {tr("The microphone was refused. Allow it in your browser settings and try again.")}
        </p>
      )}
      {!listener.listening && !listener.heard && listener.problem === "nothing" && (
        <p className={cn("text-micro", meta)}>
          {tr("Nothing was heard. Turn the volume up, or try the other language.")}
        </p>
      )}
      {!listener.listening && !listener.heard && listener.problem === "failed" && (
        <p className={cn("text-micro", meta)}>
          {tr("This browser couldn't run speech recognition just now.")}
        </p>
      )}
    </div>
  );
}
