/**
 * Per-section dictation: record → upload → wait for the worker.
 *
 * WHY THIS IS A HOOK AND NOT TWENTY LINES IN THE COMPONENT.
 *
 * The legacy does this inline (smart-quote-leads.php toggleDictation ~1744) and
 * gets three things wrong that are invisible until they happen: the microphone
 * tracks are only released on the happy path, a second section can be started
 * while the first is recording, and a failure is a toast that leaves the box
 * blank. All three are state problems, so the state lives in one place.
 *
 * WHY THE MEETING IS RESOLVED LAZILY, NOT PASSED IN.
 *
 * Two surfaces dictate. The meeting drawer already has a record and simply hands
 * back its id. The one-step wizard does NOT — the meeting does not exist until
 * something commits, and pressing a microphone IS that commitment: audio the
 * user has already spoken has to belong to something. So the caller supplies a
 * function, and the wizard's version creates the meeting on first use.
 *
 * It resolves BEFORE the recording starts, deliberately. Resolving at upload
 * time would let someone talk for two minutes and only then learn the record
 * could not be created.
 *
 * The transcript does NOT come back from the upload. The upload answers 202 and
 * the ai-transcribe worker lands the text on the record, so this polls the
 * meeting's discovery until the section stops saying DICTATING.
 */
import * as React from "react";
import {
  dictateDiscoverySection,
  fetchDiscovery,
  type SectionKey,
} from "@/lib/meeting-api";
import { errMsg } from "@/lib/use-resource";

/** Opus at 24 kbps, and a hard stop at five minutes — together that is ~900 KB,
 *  inside the API's 1.4 MB ceiling for one dictation with room to spare. */
const BITS_PER_SECOND = 24_000;
const MAX_MS = 5 * 60_000;

const POLL_MS = 2_500;
const POLL_LIMIT = 48; // two minutes of waiting, then say so rather than spin.

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of ["audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the recording"));
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });

export type DictationState = {
  /** The section currently recording, or null. One at a time, by construction. */
  recording: SectionKey | null;
  /** The section whose audio is uploading or awaiting the worker. */
  pending: SectionKey | null;
  error: string | null;
};

export function useDictation(
  /** Returns the meeting to dictate against, creating it if it does not exist
   *  yet. Return null to refuse (e.g. no lead picked). */
  resolveMeetingId: () => Promise<string | null>,
  onLanded: () => void,
) {
  const [state, setState] = React.useState<DictationState>({
    recording: null,
    pending: null,
    error: null,
  });
  const recorder = React.useRef<MediaRecorder | null>(null);
  const stream = React.useRef<MediaStream | null>(null);
  const autoStop = React.useRef<number | null>(null);
  const meetingId = React.useRef<string | null>(null);
  const alive = React.useRef(true);

  const release = React.useCallback(() => {
    if (autoStop.current) window.clearTimeout(autoStop.current);
    autoStop.current = null;
    // Released on EVERY exit, not just the one where the user pressed stop —
    // a live microphone track is a recording light the user cannot switch off.
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
  }, []);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      release();
    };
  }, [release]);

  /** Poll until the worker has moved the section off DICTATING. */
  const waitForTranscript = React.useCallback(
    async (section: SectionKey) => {
      const id = meetingId.current;
      if (!id) return;
      for (let i = 0; i < POLL_LIMIT; i += 1) {
        await new Promise((r) => window.setTimeout(r, POLL_MS));
        if (!alive.current) return;
        let landed = false;
        try {
          const d = await fetchDiscovery(id);
          landed = !d.sections.some(
            (s) => s.section_key === section && s.capture_state === "DICTATING",
          );
        } catch {
          // A poll that fails is not a dictation that failed — the worker is
          // still going. Keep waiting; the record is the source of truth.
          landed = false;
        }
        if (landed) {
          if (alive.current) setState((s) => ({ ...s, pending: null }));
          onLanded();
          return;
        }
      }
      if (alive.current) {
        setState((s) => ({
          ...s,
          pending: null,
          error:
            "The transcription is taking longer than expected. It will appear on the section when it lands — reopen this meeting to check.",
        }));
      }
      onLanded();
    },
    [onLanded],
  );

  const upload = React.useCallback(
    async (section: SectionKey, blob: Blob) => {
      const id = meetingId.current;
      if (!id) return;
      setState({ recording: null, pending: section, error: null });
      try {
        await dictateDiscoverySection(id, section, await toDataUrl(blob));
        // Refresh immediately: the section is now DICTATING on the server and
        // the user should see that, not a box that looks untouched.
        onLanded();
        void waitForTranscript(section);
      } catch (e) {
        setState({ recording: null, pending: null, error: errMsg(e) });
        onLanded();
      }
    },
    [onLanded, waitForTranscript],
  );

  const stop = React.useCallback(() => {
    if (recorder.current && recorder.current.state !== "inactive") {
      recorder.current.stop();
    }
  }, []);

  const start = React.useCallback(
    async (section: SectionKey) => {
      if (state.recording || state.pending) return;
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof MediaRecorder === "undefined"
      ) {
        setState((s) => ({
          ...s,
          error: "This browser cannot record audio — type the section instead.",
        }));
        return;
      }

      // The record first. Anything spoken has to have somewhere to land, and a
      // failure here must surface before the microphone opens.
      let id: string | null = null;
      try {
        id = await resolveMeetingId();
      } catch (e) {
        setState((s) => ({ ...s, error: errMsg(e) }));
        return;
      }
      if (!id) return;
      meetingId.current = id;

      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.current = media;
        const mimeType = pickMimeType();
        const rec = new MediaRecorder(media, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: BITS_PER_SECOND,
        });
        recorder.current = rec;
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
          release();
          if (!alive.current) return;
          void upload(section, blob);
        };
        rec.start();
        autoStop.current = window.setTimeout(() => stop(), MAX_MS);
        setState({ recording: section, pending: null, error: null });
      } catch {
        release();
        setState((s) => ({
          ...s,
          recording: null,
          error:
            "Microphone access was refused. Allow it in your browser settings, or type the section instead.",
        }));
      }
    },
    [release, resolveMeetingId, state.pending, state.recording, stop, upload],
  );

  const dismissError = React.useCallback(
    () => setState((s) => ({ ...s, error: null })),
    [],
  );

  return { ...state, start, stop, dismissError };
}
