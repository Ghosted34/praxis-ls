/**
 * A minimal, dependency-free ZIP writer — enough to hand a browser a folder of
 * vaulted documents in one download.
 *
 * ── WHY NOT A LIBRARY ───────────────────────────────────────────────────────
 *
 * `jszip` is about 100 kB minified and `archiver` is a Node package; neither is
 * in `client/package.json`, and the option that exists for exactly this
 * ("download the selected documents") should not cost the bundle a compression
 * engine to produce. Every document this writes is a PDF or an image — already
 * compressed formats — so deflating them would spend CPU to save nothing and
 * add the one part of ZIP that is genuinely hard to get right.
 *
 * STORE (method 0) is therefore not a shortcut, it is the right method: the
 * archive is a set of offsets and CRCs, which is what makes a reader that
 * cannot compress unable to corrupt anything either.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
 *
 * No DEFLATE, no ZIP64 (a >4 GB archive or >65,535 entries), no encryption, no
 * directories — the entries are flat paths and a folder is expressed by the
 * name. Each is refused or unnecessary for a few dozen documents, and a silent
 * ZIP64 overflow would produce an archive that opens in one tool and not
 * another. If a caller ever needs one of them, that is the moment to reach for
 * a library, not to extend this.
 *
 * Format: PKWARE APPNOTE 6.3.x, §4.3.6 (local header), §4.3.12 (central
 * directory), §4.3.16 (end of central directory).
 */

/** One file to write into the archive. */
export type ZipEntry = {
  /** Path inside the archive, e.g. `RCCM-2026.pdf`. Slashes are kept. */
  name: string;
  /** The bytes. `Blob` is accepted because that is what a fetch returns. */
  data: Uint8Array | Blob;
};

const text = new TextEncoder();

/**
 * CRC-32 (IEEE 802.3), the checksum every ZIP entry header carries.
 *
 * A module-level table built once from the polynomial 0xEDB88320 — the
 * reflected form of 0x04C11DB7 — which is what makes this a table lookup per
 * byte rather than eight shifts, and the difference between a 20-document
 * archive taking a frame and taking a second.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A filename that is safe in every reader.
 *
 * The characters Windows refuses (`\ / : * ? " < > |`) and control characters
 * become `-`; leading dots and spaces go, because a name that begins with
 * either is how a "hidden" or "empty" entry appears in some tools. Length is
 * capped, with the extension preserved — some vaulted documents are named from
 * a full sentence, and a 400-character name makes an archive that will not
 * extract on Windows at all.
 */
export function zipSafeName(name: string, fallback = "document"): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/^[\s.]+/, "")
    .trim();
  const safe = cleaned || fallback;
  if (safe.length <= 120) return safe;
  const dot = safe.lastIndexOf(".");
  const ext = dot > 0 && safe.length - dot <= 12 ? safe.slice(dot) : "";
  return safe.slice(0, 120 - ext.length) + ext;
}

/** `unique` — append ` (2)`, ` (3)` … before the extension when a name collides. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  while (taken.has(`${base} (${n})${ext}`)) n++;
  return `${base} (${n})${ext}`;
}

/**
 * A blob's bytes, whatever the environment offers.
 *
 * `Blob.prototype.arrayBuffer` is the obvious call; jsdom's `Blob` does not have
 * it, and the fallback has to be `FileReader` — which is the one reader both
 * have. Getting this wrong made the writer work in a browser and fail in the
 * suite that exists to prove it works.
 */
async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function")
    return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Is this the bytes, or a blob of them?
 *
 * `instanceof Uint8Array` is FALSE for an array built in another realm — which
 * is exactly what a `TextEncoder` or a fixture in a test file produces under
 * vitest's jsdom environment. An `instanceof` check silently sent a plain
 * `Uint8Array` down the Blob path, where the reader refused it as "not a Blob".
 * An internal-slot check answers the same question across realms.
 */
function isBytes(v: unknown): v is Uint8Array {
  return (
    ArrayBuffer.isView(v) &&
    Object.prototype.toString.call(v) === "[object Uint8Array]"
  );
}

/** DOS date/time, which is what the headers carry (no timezone — local wall clock). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time:
      (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function u16(view: DataView, at: number, v: number) {
  view.setUint16(at, v, true);
}
function u32(view: DataView, at: number, v: number) {
  view.setUint32(at, v >>> 0, true);
}

/**
 * Build the archive.
 *
 * Returns a `Blob` rather than a `Uint8Array` because the caller's next move is
 * always `URL.createObjectURL` or a synthetic `<a download>` click (see
 * `vault-file.ts`); going through a blob here avoids a second copy of every
 * document in memory.
 *
 * The name encoding is marked UTF-8 (general-purpose bit 11) so an accented
 * filename — "Attestation de conformité" is the ordinary case here — extracts
 * as itself rather than as mojibake.
 */
export async function buildZip(
  entries: ZipEntry[],
  { modified = new Date() }: { modified?: Date } = {},
): Promise<Blob> {
  // Explicitly ArrayBuffer-backed: `BlobPart` does not accept a view over a
  // SharedArrayBuffer, and TS 5.9 tracks that distinction through the generic.
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const { time, date } = dosDateTime(modified);

  for (const entry of entries) {
    // Copied into a fresh ArrayBuffer-backed view: a `Uint8Array` may be a view
    // over a SharedArrayBuffer, which `BlobPart` does not accept. The copy is
    // the cheap half of the operation — the CRC reads every byte anyway.
    const bytes = new Uint8Array(
      isBytes(entry.data) ? entry.data : await blobToBytes(entry.data),
    );
    const name = text.encode(entry.name);
    const crc = crc32(bytes);

    const local = new Uint8Array(new ArrayBuffer(30 + name.length));
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); // local file header
    u16(lv, 4, 20); // version needed to extract (2.0)
    u16(lv, 6, 0x0800); // UTF-8 names
    u16(lv, 8, 0); // stored
    u16(lv, 10, time);
    u16(lv, 12, date);
    u32(lv, 14, crc);
    u32(lv, 18, bytes.length); // compressed size = stored size
    u32(lv, 22, bytes.length);
    u16(lv, 26, name.length);
    u16(lv, 28, 0); // no extra field
    local.set(name, 30);

    parts.push(local, bytes);

    // The central directory is a second copy of the same header plus the offset
    // of its local header — which is why it is built as we go: the offset is
    // only knowable after the previous entries have been laid out.
    const dir = new Uint8Array(new ArrayBuffer(46 + name.length));
    const dv = new DataView(dir.buffer);
    u32(dv, 0, 0x02014b50); // central directory header
    u16(dv, 4, 20); // version made by
    u16(dv, 6, 20); // version needed
    u16(dv, 8, 0x0800);
    u16(dv, 10, 0);
    u16(dv, 12, time);
    u16(dv, 14, date);
    u32(dv, 16, crc);
    u32(dv, 20, bytes.length);
    u32(dv, 24, bytes.length);
    u16(dv, 28, name.length);
    u16(dv, 30, 0); // extra
    u16(dv, 32, 0); // comment
    u16(dv, 34, 0); // disk number
    u16(dv, 36, 0); // internal attributes
    u32(dv, 38, 0); // external attributes
    u32(dv, 42, offset);
    dir.set(name, 46);
    central.push(dir);

    offset += local.length + bytes.length;
  }

  const centralSize = central.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(new ArrayBuffer(22));
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); // end of central directory
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, central.length);
  u16(ev, 10, central.length);
  u32(ev, 12, centralSize);
  u32(ev, 16, offset);
  u16(ev, 20, 0); // no archive comment

  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

/**
 * Save a built archive through a synthetic `<a download>` click.
 *
 * Not `window.open`: the archive is only ready after N awaited fetches, so the
 * call is no longer inside the user's click and a pop-up blocker swallows it
 * silently — the same failure `downloadVaultDoc` documents, and the reason both
 * go through an anchor.
 */
export function saveZip(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
