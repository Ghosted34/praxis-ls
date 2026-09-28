/**
 * The chat's media — photos and voice notes shown in place, recording a voice
 * note, and finding where the phone is.
 *
 * PHOTOS AND VOICE NOTES ARE FETCHED, NOT LINKED. The portal's session is a
 * bearer header, and an `<img src>` cannot send one; the bytes come through
 * `portalBlob` and are shown from an object URL. Those URLs are cached by
 * attachment for the life of the page — scrolling a thread up and down must
 * not download the same photo twice — and the oldest are revoked past a
 * ceiling, so a long session does not hold every photo it ever showed.
 */
import * as React from "react";
import { portalChatAttachment } from "@/lib/portal-api";

const CACHE_LIMIT = 80;
const cache = new Map<string, Promise<string>>();

function remember(key: string, url: Promise<string>) {
  cache.set(key, url);
  while (cache.size > CACHE_LIMIT) {
    const [oldest, value] = cache.entries().next().value as [string, Promise<string>];
    cache.delete(oldest);
    void value.then((u) => URL.revokeObjectURL(u)).catch(() => {
      /* @silent:teardown a URL that never resolved has nothing to revoke */
    });
  }
}

/**
 * Hand the cache a URL we already hold — the picked photo's own preview, or
 * the voice note just recorded — so the saved message shows it at once rather
 * than fetching back the bytes that were just sent.
 */
export function seedAttachmentUrl(id: string, preview: boolean, url: string) {
  remember(`${id}:${preview ? "p" : "o"}`, Promise.resolve(url));
}

/** An object URL for one attachment, fetched once per page. */
export function attachmentUrl(id: string, preview = false): Promise<string> {
  const key = `${id}:${preview ? "p" : "o"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = portalChatAttachment(id, preview).then((blob) => URL.createObjectURL(blob));
  // A failed fetch is not remembered, so the next render tries again.
  url.catch(() => cache.delete(key));
  remember(key, url);
  return url;
}

/** The URL once it has arrived; null while loading; "error" if it could not be fetched. */
export function useAttachmentUrl(id: string | null, preview = false, enabled = true): string | null | "error" {
  const [url, setUrl] = React.useState<string | null | "error">(null);
  React.useEffect(() => {
    if (!id || !enabled) return;
    let live = true;
    attachmentUrl(id, preview)
      .then((u) => live && setUrl(u))
      .catch(() => live && setUrl("error"));
    return () => {
      live = false;
    };
  }, [id, preview, enabled]);
  return url;
}

/** "0:07", "4:32". */
export function clock(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/* ── voice notes ─────────────────────────────────────────────────────────── */

/** The server refuses longer; the recorder stops itself here rather than losing the take. */
export const MAX_VOICE_MS = 5 * 60 * 1000;

/**
 * What this browser records, best first. Opus at 32 kbit/s is a clear voice at
 * 240 KB a minute — the compression CLAUDE.md asks of every upload happens in
 * the encoder. Safari records AAC in MP4 and reports none of the others.
 */
const TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a" };

export type Recording = { file: File; durationMs: number };
export type RecorderState = "idle" | "starting" | "recording";
export type RecorderError = "unsupported" | "denied" | null;

export function useVoiceRecorder() {
  const [state, setState] = React.useState<RecorderState>("idle");
  const [elapsed, setElapsed] = React.useState(0);
  const [error, setError] = React.useState<RecorderError>(null);
  const rec = React.useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    chunks: Blob[];
    started: number;
    timer: number;
    done: ((r: Recording | null) => void) | null;
    keep: boolean;
  } | null>(null);

  const release = React.useCallback(() => {
    const r = rec.current;
    if (!r) return;
    window.clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setState("idle");
    setElapsed(0);
  }, []);

  // Leaving the chat mid-recording stops the microphone — the red dot in the
  // browser's tab must never outlive the screen that turned it on.
  React.useEffect(
    () => () => {
      const r = rec.current;
      if (r) {
        r.keep = false;
        if (r.recorder.state !== "inactive") r.recorder.stop();
      }
      release();
    },
    [release],
  );

  const stop = React.useCallback((keep: boolean): Promise<Recording | null> => {
    const r = rec.current;
    if (!r) return Promise.resolve(null);
    return new Promise((resolve) => {
      r.keep = keep;
      r.done = resolve;
      if (r.recorder.state !== "inactive") r.recorder.stop();
      else resolve(null);
    });
  }, []);

  const start = React.useCallback(async (): Promise<boolean> => {
    setError(null);
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("unsupported");
      return false;
    }
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState("idle");
      setError("denied");
      return false;
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
    const started = Date.now();
    const entry = {
      recorder,
      stream,
      chunks: [] as Blob[],
      started,
      timer: 0,
      done: null as ((r: Recording | null) => void) | null,
      keep: true,
    };
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) entry.chunks.push(e.data);
    };
    recorder.onstop = () => {
      const durationMs = Date.now() - entry.started;
      const type = (recorder.mimeType || mimeType || "audio/webm").split(";")[0];
      const blob = new Blob(entry.chunks, { type });
      const out =
        entry.keep && blob.size > 0 && durationMs >= 500
          ? { file: new File([blob], `voice-${new Date(started).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${EXT[type] || "webm"}`, { type }), durationMs }
          : null;
      const done = entry.done;
      release();
      done?.(out);
    };
    entry.timer = window.setInterval(() => {
      const ms = Date.now() - started;
      setElapsed(ms);
      // The server's ceiling, reached: keep the take rather than lose it.
      if (ms >= MAX_VOICE_MS && recorder.state === "recording") recorder.stop();
    }, 250);
    rec.current = entry;
    recorder.start(1000);
    setState("recording");
    return true;
  }, [release]);

  return { state, elapsed, error, start, stop, clearError: () => setError(null) };
}

/* ── location ────────────────────────────────────────────────────────────── */

export type Fix = { lat: number; lng: number; accuracy: number | null };

/** Where the phone is — or why not: "denied" (the site may not ask) or "failed". */
export function locate(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("failed"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: Math.round(p.coords.latitude * 1e6) / 1e6,
          lng: Math.round(p.coords.longitude * 1e6) / 1e6,
          accuracy: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null,
        }),
      (err) => reject(new Error(err && err.code === 1 ? "denied" : "failed")),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}

/** A maps link every phone opens in its own maps app. */
export const mapsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
