/**
 * Browser-side image compression — the first half of the upload engine.
 *
 * WHY COMPRESS HERE when the server compresses too. Because the server's pass
 * happens AFTER the bytes have crossed the network, and the bytes crossing the
 * network are the wait the user is watching on the progress bar. A 6 MB phone
 * photo on a 3G connection in the corridor is roughly a 40-second upload; the
 * same photo resized here first is about 400 KB and lands in under three. The
 * server pass still runs and is still authoritative — a client that skipped
 * this (an API caller, a future mobile app, someone with a devtools console)
 * must never be able to plant an unprocessed original in storage.
 *
 * WHY WEBP, and why NOT always. `canvas.toBlob` supports "image/webp" in every
 * browser we serve and supports AVIF in none of them, so WebP is the only
 * modern format available on this side; the server adds AVIF afterwards.
 *
 * But the format the client emits becomes the format of the stored MASTER, and
 * the master is what a download hands back. An agent who forwards a customs
 * declaration to a broker, a bank or a government e-portal cannot send a .webp
 * to systems that refuse it. So the rule is by purpose, not global:
 *
 *   document / brand  → re-encode in the SOURCE format (JPEG stays JPEG)
 *   photo / avatar    → re-encode as WebP
 *
 * `brand` is in the first group deliberately: a logo is capped at 512 KB
 * anyway, so there is no byte argument worth trading the tenant's ability to
 * download their own asset for.
 *
 * FAILURE IS ALWAYS "SEND THE ORIGINAL". Every path in this file degrades to
 * the untouched File. A compression bug must cost bytes, never an upload.
 */

/** Purpose of the image, mirroring the backend's image-pipeline profiles. */
export type UploadProfile = "photo" | "document" | "brand" | "avatar";

/** Longest edge, per profile, matching src/services/image-pipeline.service.js. */
const MAX_EDGE: Record<UploadProfile, number> = {
  photo: 2400,
  document: 2600,
  brand: 1024,
  avatar: 512,
};

const QUALITY: Record<UploadProfile, number> = {
  photo: 0.82,
  document: 0.88,
  brand: 0.9,
  avatar: 0.85,
};

/** Profiles whose master must stay downloadable by third-party software. */
const KEEP_SOURCE_FORMAT: ReadonlySet<UploadProfile> = new Set([
  "document",
  "brand",
]);

/**
 * Formats we will re-encode. Anything else is passed through:
 * - SVG is vector, and rasterising it would be a downgrade, not a compression;
 * - GIF may be animated, and a canvas round-trip keeps only the first frame;
 * - HEIC cannot be decoded by any browser, so `createImageBitmap` rejects it
 *   and the server's libheif path handles it instead.
 */
const RE_ENCODABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export type CompressResult = {
  /** The file to upload — either a new compressed File or the original. */
  file: File;
  /** True when the returned file is smaller than what was passed in. */
  compressed: boolean;
  originalBytes: number;
  bytes: number;
};

function passthrough(file: File): CompressResult {
  return {
    file,
    compressed: false,
    originalBytes: file.size,
    bytes: file.size,
  };
}

/** Swap a filename's extension to match the encoded type. */
function renameFor(name: string, mime: string): string {
  const ext = mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : "jpg";
  const stem = name.replace(/\.[^./\\]+$/, "") || "image";
  return `${stem}.${ext}`;
}

/**
 * Canvas `toBlob` as a promise. Resolves null rather than rejecting, because a
 * browser that cannot encode the requested type calls back with null instead of
 * throwing, and both cases mean the same thing here: fall back.
 */
function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      /* @silent:parse — an unsupported encoder type; the caller falls back. */
      resolve(null);
    }
  });
}

/**
 * Compress an image file for upload.
 *
 * Returns the ORIGINAL file unchanged when the input is not a re-encodable
 * raster, when the browser cannot decode it, or when the re-encode would not
 * actually be smaller — that last case is real rather than theoretical, since
 * re-encoding an already-optimised 80 KB JPEG usually makes it bigger.
 */
export async function compressImage(
  file: File,
  profile: UploadProfile = "document",
): Promise<CompressResult> {
  if (!file || !file.size) return passthrough(file);
  if (!RE_ENCODABLE.has(file.type)) return passthrough(file);
  if (typeof createImageBitmap !== "function") return passthrough(file);

  let bitmap: ImageBitmap;
  try {
    // `imageOrientation: "from-image"` is what keeps a portrait phone photo
    // upright. Without it the EXIF rotation is dropped by the decode and every
    // sideways holiday photo becomes a sideways upload.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    /* @silent:parse — undecodable here (HEIC, corrupt); the server decides. */
    return passthrough(file);
  }

  try {
    const maxEdge = MAX_EDGE[profile];
    const longest = Math.max(bitmap.width, bitmap.height);
    // Never enlarge: a 400px image resized "up" to 2400 is the same picture in
    // nine times the bytes.
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return passthrough(file);

    // A PNG may be transparent, and drawing it onto an undefined canvas then
    // encoding to JPEG turns transparent pixels black. White is the safe mat
    // for the one case where transparency cannot survive the target format.
    const targetType =
      KEEP_SOURCE_FORMAT.has(profile) ? file.type : "image/webp";
    if (targetType === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    let blob = await toBlob(canvas, targetType, QUALITY[profile]);
    // A browser that cannot encode WebP hands back null (or a PNG); fall back
    // to JPEG, which every canvas implementation supports.
    if (!blob && targetType !== "image/jpeg") {
      blob = await toBlob(canvas, "image/jpeg", QUALITY[profile]);
    }
    if (!blob || blob.size >= file.size) return passthrough(file);

    const out = new File([blob], renameFor(file.name, blob.type), {
      type: blob.type,
      lastModified: file.lastModified,
    });
    return {
      file: out,
      compressed: true,
      originalBytes: file.size,
      bytes: out.size,
    };
  } catch {
    /* @silent:parse — canvas/encoder failure; uploading the original is fine. */
    return passthrough(file);
  } finally {
    bitmap.close?.();
  }
}

/**
 * Read a File back as a base64 data URL.
 *
 * For the endpoints that still take one. The engine works in Files because that
 * is what compresses and what multipart sends; this is the adapter at the edge,
 * so a site can be migrated onto the engine without its API being changed in
 * the same step.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

/**
 * True when a URL is safe to hand to an `<img src>`.
 *
 * The only scheme that reaches here is `blob:`, which cannot execute and cannot
 * be reinterpreted as markup — unlike `data:text/html` or `javascript:`, which
 * a URL sink genuinely will honour.
 *
 * A named guard rather than an inline `startsWith` because that is what makes
 * the check legible both to a reader and to CodeQL, which reports this flow as
 * js/xss-through-dom on public-web's copy of this file.
 */
export function isSafeBlobUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("blob:");
}

/**
 * An object URL for a preview, proven to be one before it reaches an `src`.
 *
 * `URL.createObjectURL` can only ever return `blob:<origin>/<uuid>`, so the
 * check below can never fail in practice. It is here because the VALUE flows
 * from a file the user chose into an `<img src>`, and "user-controlled data
 * reaches a URL sink" is a real shape — one CodeQL flags as high severity
 * (js/xss-through-dom) precisely because it cannot see that the blob contract
 * holds. Asserting the prefix at the point of creation makes the guarantee
 * local and checkable instead of an argument about an API's contract, and it
 * still catches the day someone swaps this for a FileReader data: URL — where
 * `data:text/html` IS reachable and the sink would be live.
 *
 * Returns null rather than throwing: no preview is a degraded control, and a
 * thrown error here would take the whole upload with it.
 */
export function previewUrlFor(file: File): string | null {
  if (!file) return null;
  try {
    const url = URL.createObjectURL(file);
    return isSafeBlobUrl(url) ? url : null;
  } catch {
    /* @silent:parse — no object-URL support; the control renders without one. */
    return null;
  }
}

/** True when this file is an image the engine will show a preview for. */
export function isPreviewableImage(file: File | null | undefined): boolean {
  if (!file) return false;
  return (
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|svg|avif|heic|heif)$/i.test(file.name)
  );
}
