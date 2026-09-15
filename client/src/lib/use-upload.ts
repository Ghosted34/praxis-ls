/**
 * useUpload — the upload engine's state machine.
 *
 * WHY A HOOK AND NOT A HELPER PER SCREEN. Because the two things that were
 * missing everywhere are STATE, not markup: a preview needs an object URL that
 * somebody has to revoke, and a percentage needs a progress callback threaded
 * from the XHR all the way back to a bar. `FileDrop` has accepted
 * `uploadProgress` and `uploadSuccess` props since it was written and 28 of the
 * 30 call sites never passed them — not because anyone decided not to, but
 * because wiring it by hand at each site is four pieces of state and a cleanup
 * effect, every time. This owns all of it once.
 *
 * THE LIFECYCLE a call site gets for free:
 *
 *   idle → compressing → uploading (0…100) → success        ↺ retry
 *                                          ↘ error
 *
 * `compressing` is a real state rather than a detail: resizing a 12 MP photo
 * takes a beat on a mid-range phone, and without it the UI sits dead between
 * the file picker closing and the first progress event.
 *
 * OBJECT URLS, not data URLs. `URL.createObjectURL` is synchronous and costs no
 * copy, where `FileReader.readAsDataURL` base64-inflates the whole image into a
 * string held in memory — on a multi-file picker that is the difference between
 * a preview appearing instantly and a visible stall. They must be revoked, and
 * this revokes every one of them on unmount and on removal.
 */
import * as React from "react";
import {
  compressImage,
  isPreviewableImage,
  previewUrlFor,
  type UploadProfile,
} from "@/lib/image-compress";

export type UploadState =
  | "idle"
  | "compressing"
  | "uploading"
  | "success"
  | "error";

export type UploadItem<T = unknown> = {
  /** Stable identity across re-renders; File objects are not comparable. */
  id: string;
  /** What the user picked, before compression. */
  file: File;
  /** What will actually be sent — the compressed file, once prepared. */
  prepared: File | null;
  /** Object URL for the preview, or null for a non-image. */
  previewUrl: string | null;
  state: UploadState;
  /** 0–100. Meaningful only while `state` is "uploading" or "success". */
  percent: number;
  error: string | null;
  /**
   * The thrown error itself, kept alongside the message.
   *
   * Call sites need more than the text: the branding upload maps a 403 to "you
   * need Settings edit permission", which only an ApiError's `status` can tell
   * it. Matching on the message string instead would break the first time
   * anyone reworded it.
   */
  errorCause: unknown;
  result: T | null;
  originalBytes: number;
  /** Bytes actually sent; equals originalBytes when compression was skipped. */
  bytes: number;
};

export type UseUploadOptions<T> = {
  /** Purpose of these images — drives compression and server-side treatment. */
  profile?: UploadProfile;
  /** Reject anything larger than this, before compression. */
  maxBytes?: number;
  /** Allow more than one file at a time. */
  multiple?: boolean;
  /**
   * Upload as soon as a file is picked (the default), or wait for `start()`.
   *
   * Deferred is not an edge case: the vault upload collects a document type and
   * a reference AFTER the file is chosen and sends all of it in one request, so
   * uploading on pick would send the metadata fields empty. Those sites still
   * get the preview and the compression immediately — only the request waits.
   */
  autoStart?: boolean;
  /** Performs the actual request. Must report progress and honour the signal. */
  send: (
    file: File,
    ctx: { onProgress: (percent: number) => void; signal: AbortSignal },
  ) => Promise<T>;
  /** Called once every item has reached "success". */
  onAllComplete?: (results: T[]) => void;
};

let seq = 0;
const nextId = () => `up_${Date.now().toString(36)}_${(seq += 1)}`;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useUpload<T = unknown>({
  profile = "document",
  maxBytes,
  multiple = false,
  autoStart = true,
  send,
  onAllComplete,
}: UseUploadOptions<T>) {
  const [items, setItems] = React.useState<UploadItem<T>[]>([]);
  // start() must see the CURRENT items without being re-created on every
  // render — a Save handler captured in a callback prop would otherwise hold a
  // stale closure and upload nothing.
  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  // The send callback is captured per-upload rather than per-render, so a call
  // site is not forced to memoise it to avoid restarting an in-flight upload.
  const sendRef = React.useRef(send);
  sendRef.current = send;
  const doneRef = React.useRef(onAllComplete);
  doneRef.current = onAllComplete;

  const controllers = React.useRef(new Map<string, AbortController>());
  const urls = React.useRef(new Set<string>());

  const revoke = React.useCallback((url: string | null) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  }, []);

  // Unmount cleanup. An object URL that is never revoked pins the whole File in
  // memory for the lifetime of the document, which on a documents screen the
  // user scrolls through all day is a leak with teeth.
  React.useEffect(() => {
    const urlSet = urls.current;
    const ctrls = controllers.current;
    return () => {
      urlSet.forEach((u) => URL.revokeObjectURL(u));
      urlSet.clear();
      ctrls.forEach((c) => c.abort());
      ctrls.clear();
    };
  }, []);

  const patch = React.useCallback(
    (id: string, next: Partial<UploadItem<T>>) => {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, ...next } : it)),
      );
    },
    [],
  );

  /**
   * Compress, then upload, one item. Progress is clamped to 99 until the
   * server has actually answered — a bar that reads 100% while the request is
   * still open is the single most common way an upload UI lies, because the
   * browser finishes SENDING well before the server finishes storing.
   */
  const run = React.useCallback(
    async (item: UploadItem<T>, options: { upload: boolean } = { upload: true }) => {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);

      try {
        let toSend = item.prepared;
        if (!toSend) {
          patch(item.id, { state: "compressing", percent: 0 });
          const out = await compressImage(item.file, profile);
          toSend = out.file;
          patch(item.id, { prepared: out.file, bytes: out.bytes });
        }

        if (!options.upload) {
          // Deferred: compressed and previewed, waiting for start().
          patch(item.id, { state: "idle", percent: 0, error: null });
          return { ok: true as const, result: null };
        }

        patch(item.id, {
          state: "uploading",
          percent: 0,
          error: null,
          errorCause: null,
        });
        const result = await sendRef.current(toSend, {
          onProgress: (percent) =>
            patch(item.id, {
              percent: Math.max(0, Math.min(99, Math.round(percent))),
            }),
          signal: controller.signal,
        });

        patch(item.id, {
          state: "success",
          percent: 100,
          result,
          error: null,
          errorCause: null,
        });
        return { ok: true as const, result };
      } catch (err) {
        const aborted =
          controller.signal.aborted ||
          (err as { code?: string })?.code === "UPLOAD_ABORTED";
        patch(item.id, {
          state: aborted ? "idle" : "error",
          percent: 0,
          error: aborted
            ? null
            : (err as Error)?.message || "That upload did not go through.",
          errorCause: aborted ? null : err,
        });
        return { ok: false as const, result: null };
      } finally {
        controllers.current.delete(item.id);
      }
    },
    [patch, profile],
  );

  /** Add files and immediately begin compressing + uploading them. */
  const pick = React.useCallback(
    async (picked: FileList | File[] | null) => {
      const files = Array.from(picked || []);
      if (!files.length) return;
      const accepted = multiple ? files : files.slice(0, 1);

      const created: UploadItem<T>[] = accepted.map((file) => {
        const previewable = isPreviewableImage(file);
        // The preview is created here, synchronously, BEFORE any compression or
        // upload — so it is on screen the instant the picker closes rather than
        // after a round trip. That is the whole point of enforcing it centrally.
        const previewUrl = previewable ? previewUrlFor(file) : null;
        if (previewUrl) urls.current.add(previewUrl);

        const tooBig = maxBytes != null && file.size > maxBytes;
        return {
          id: nextId(),
          file,
          prepared: null,
          previewUrl,
          state: tooBig ? "error" : "idle",
          percent: 0,
          error: tooBig
            ? `That file is ${humanSize(file.size)} — the limit here is ${humanSize(maxBytes as number)}.`
            : null,
          errorCause: null,
          result: null,
          originalBytes: file.size,
          bytes: file.size,
        };
      });

      setItems((prev) => {
        if (multiple) return [...prev, ...created];
        prev.forEach((p) => revoke(p.previewUrl));
        return created;
      });

      const runnable = created.filter((c) => c.state !== "error");
      const results = await Promise.all(
        runnable.map((c) => run(c, { upload: autoStart })),
      );
      if (autoStart && results.length && results.every((r) => r.ok)) {
        doneRef.current?.(results.map((r) => r.result as T));
      }
    },
    [autoStart, maxBytes, multiple, revoke, run],
  );

  /**
   * Send everything that is waiting. For deferred uploads — the caller's Save
   * button calls this, and awaits it, so the form can close only once the
   * server has actually taken the bytes.
   */
  const start = React.useCallback(async () => {
    const pending = itemsRef.current.filter(
      (i) => i.state === "idle" || i.state === "error",
    );
    if (!pending.length) return { ok: true as const, results: [] as T[] };
    const outcomes = await Promise.all(pending.map((p) => run(p)));
    const ok = outcomes.every((o) => o.ok);
    const results = outcomes
      .filter((o) => o.ok)
      .map((o) => o.result as T);
    if (ok) doneRef.current?.(results);
    return { ok, results };
  }, [run]);

  /** Cancel an in-flight upload, or drop a finished one. */
  const remove = React.useCallback(
    (id: string) => {
      controllers.current.get(id)?.abort();
      controllers.current.delete(id);
      setItems((prev) => {
        const hit = prev.find((p) => p.id === id);
        if (hit) revoke(hit.previewUrl);
        return prev.filter((p) => p.id !== id);
      });
    },
    [revoke],
  );

  /** Re-send a failed item. The compressed file is reused, not rebuilt. */
  const retry = React.useCallback(
    (id: string) => {
      const hit = items.find((p) => p.id === id);
      if (hit) void run(hit);
    },
    [items, run],
  );

  const reset = React.useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setItems((prev) => {
      prev.forEach((p) => revoke(p.previewUrl));
      return [];
    });
  }, [revoke]);

  const busy = items.some(
    (i) => i.state === "compressing" || i.state === "uploading",
  );

  return {
    items,
    pick,
    remove,
    retry,
    reset,
    start,
    busy,
    /** True once at least one item has uploaded and none is pending or failed. */
    complete:
      items.length > 0 && items.every((i) => i.state === "success"),
  };
}
