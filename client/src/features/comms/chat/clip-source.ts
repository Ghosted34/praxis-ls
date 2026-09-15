/**
 * Fetching a voice note's bytes, and KNOWING WHAT ARRIVED.
 *
 * ── WHY THIS EXISTS AND `useObjectUrl` WAS NOT ENOUGH ─────────────────────
 *
 * "This browser can't play this recording" was reported over and over against
 * a player that plays. Every part was measured and every part was sound: the
 * recorder produces valid `audio/webm;codecs=opus`; multer, the storage driver
 * and the controller return the bytes byte-for-byte with the right
 * `Content-Type`; a `blob:` URL built exactly the way this app builds one
 * decodes in Chromium; and the generated service worker, in control of the
 * page, passes the media fetch through untouched. All of that was proved by
 * driving the real modules end to end — and none of it explains a bubble that
 * says it cannot play.
 *
 * What nothing could see was WHICH BYTES the failing install actually received,
 * because an object URL is opaque. `res.ok` is true for a 200, and a 200 whose
 * body is the SPA's `index.html` — an auth redirect, a proxy rule, a route that
 * stopped matching in one deployment — is handed to `<audio>` exactly like a
 * clip. The element then fires `error`, and "can't play this" is printed for
 * something that was never audio at all.
 *
 * So the bytes are sniffed before anything is asked to play them, and what the
 * player reports is the truth about the response rather than a guess about the
 * browser. A container this device lacks and a login page wearing an
 * `audio/webm` header need opposite responses from whoever reads the message:
 * one is the device, the other is the deployment.
 *
 * ── THE SNIFF IS THE MAGIC NUMBER, NOT THE HEADER ─────────────────────────
 *
 * `Content-Type` is what the server CLAIMS. It is set from a database column
 * that was written at upload time, so it is exactly what cannot be trusted
 * when the question is "did the right bytes come back". The first few bytes of
 * every container this product can produce are unambiguous, so they are what
 * gets read.
 */
import * as React from "react";
import * as api from "@/lib/smartcomm-api";

/**
 * What the bytes actually are.
 *
 * "page" and "payload" are the two that matter most: neither is audio, both
 * arrive with a 200, and both mean the recording never reached the browser.
 */
export type Container =
  | "webm"
  | "ogg"
  | "mp4"
  | "wav"
  | "mp3"
  /** HTML — almost always the SPA shell, served where a clip was asked for. */
  | "page"
  /** JSON — an error envelope that came back with the wrong status. */
  | "payload"
  | "empty"
  | "unknown";

/** True for the containers a browser can be asked to play. */
export function isAudioContainer(c: Container): boolean {
  return c === "webm" || c === "ogg" || c === "mp4" || c === "wav" || c === "mp3";
}

const ascii = (b: Uint8Array, from: number, text: string) =>
  text.split("").every((ch, i) => b[from + i] === ch.charCodeAt(0));

/**
 * Identify the container from its leading bytes.
 *
 * Only the signatures this product can actually produce or mistakenly serve.
 * A longer table would be a longer list of things to be wrong about — anything
 * unrecognised is "unknown", which is already the honest answer.
 */
export function sniffContainer(bytes: Uint8Array): Container {
  if (!bytes.length) return "empty";
  // EBML — Matroska and WebM.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  if (ascii(bytes, 0, "OggS")) return "ogg";
  // ISO base media: a size field, then "ftyp". mp4, m4a and friends.
  if (ascii(bytes, 4, "ftyp")) return "mp4";
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE")) return "wav";
  if (ascii(bytes, 0, "ID3")) return "mp3";
  // MPEG audio frame sync — 11 set bits.
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  // Not audio at all. Leading whitespace is skipped because a shell served by
  // a proxy is often indented.
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++;
  if (bytes[i] === 0x3c) return "page"; // '<'
  if (bytes[i] === 0x7b || bytes[i] === 0x5b) return "payload"; // '{' or '['
  return "unknown";
}

/** How many leading bytes are enough to name every container above. */
const HEAD_BYTES = 16;

/**
 * The first bytes of a blob, or null if they cannot be read.
 *
 * `blob.arrayBuffer()` is the direct route and is what every browser takes.
 * The `FileReader` branch is for jsdom, which implements `FileReader` and not
 * `Blob.arrayBuffer` — without it the component whose entire job is telling a
 * good response from a bad one is the one component that cannot be tested.
 *
 * What is NOT used here, having been tried and been wrong: wrapping the blob
 * in a `Response`. jsdom's `Response` comes from a different implementation
 * than its `Blob`, does not recognise it, and stringifies it to the text
 * "[object Blob]" — which sniffs as JSON and reported a perfectly good WebM as
 * a broken deployment. A fallback that silently answers something plausible is
 * worse than one that answers nothing.
 */
async function readHead(blob: Blob): Promise<Uint8Array | null> {
  const head = blob.slice(0, HEAD_BYTES);
  if (typeof head.arrayBuffer === "function") {
    return new Uint8Array(await head.arrayBuffer());
  }
  if (typeof FileReader === "undefined") return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(reader.result instanceof ArrayBuffer ? new Uint8Array(reader.result) : null);
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(head);
  });
}

/**
 * The container, best-effort — and BEST-EFFORT IS THE POINT.
 *
 * This is a diagnostic. A diagnostic that can refuse a clip is worse than no
 * diagnostic at all, so every failure here returns null and the player carries
 * on exactly as it would have: a head that cannot be read simply means nothing
 * is claimed about the bytes.
 *
 * Only the head is copied. Sniffing costs nothing on sixteen bytes and would
 * cost a second copy of a two-minute clip on the whole thing.
 */
async function readContainer(blob: Blob): Promise<Container | null> {
  try {
    const head = await readHead(blob);
    return head ? sniffContainer(head) : null;
  } catch {
    /* @silent:parse — a head that cannot be read says nothing about the clip,
       and must never be the reason one refuses to play. */
    return null;
  }
}

export type Clip = {
  url: string | null;
  /** Null until the bytes have arrived. */
  container: Container | null;
  /** What the server CLAIMED it was sending. Kept beside `container` because
   *  the two disagreeing is itself the diagnosis. */
  declaredType: string;
  bytes: number;
  loading: boolean;
  /** The request itself failed — offline, a 4xx, a 5xx. */
  error: boolean;
};

const IDLE: Clip = {
  url: null, container: null, declaredType: "", bytes: 0, loading: false, error: false,
};

/**
 * The clip's bytes, as an object URL, with a description of what they are.
 *
 * Fetched on demand rather than on render, for the reason `useObjectUrl` gives:
 * a channel with forty voice notes in its history must not pull forty clips
 * down to draw forty bars. The URL is revoked on unmount — an object URL that
 * is never revoked pins the whole blob in memory for the life of the document.
 */
export function useClip(mediaId: string, enabled: boolean): Clip {
  const [state, setState] = React.useState<Clip>(IDLE);
  const active = enabled && !!mediaId;

  React.useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    let url: string | null = null;
    let alive = true;
    setState({ ...IDLE, loading: true });

    (async () => {
      try {
        const blob = await api.mediaBlob(mediaId, controller.signal);
        const next: Clip = {
          url: URL.createObjectURL(blob),
          container: await readContainer(blob),
          declaredType: blob.type || "",
          bytes: blob.size,
          loading: false,
          error: false,
        };
        url = next.url;
        if (alive) setState(next);
        // Unmounted between the fetch resolving and this line: revoke now,
        // because no cleanup will run for a state that was never set.
        else if (next.url) URL.revokeObjectURL(next.url);
      } catch {
        // An abort is the caller changing its mind, not a failure — but it
        // cannot be told apart here without leaking the reason into state, and
        // an unmounted component renders nothing either way.
        if (alive) setState({ ...IDLE, error: true });
      }
    })();

    return () => {
      alive = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [active, mediaId]);

  return state;
}

/**
 * One line naming what came back, for a reader to read out or screenshot.
 *
 * Deliberately terse and deliberately concrete: "audio/webm, 0 bytes" and
 * "audio/webm but the body is a web page" are different faults with different
 * owners, and either is worth more than a paragraph about codecs.
 */
export function describeClip(clip: Clip): string {
  const size = clip.bytes >= 1024 ? `${Math.round(clip.bytes / 1024)} KB` : `${clip.bytes} bytes`;
  const declared = clip.declaredType || "no content type";
  if (clip.container === "empty") return `${declared}, empty response`;
  if (clip.container === "page") return `${declared} header, but the body is a web page (${size})`;
  if (clip.container === "payload") return `${declared} header, but the body is JSON (${size})`;
  if (clip.container === "unknown") return `${declared}, ${size}, unrecognised format`;
  return `${declared} · ${clip.container} · ${size}`;
}
