/**
 * The ZIP writer is the only thing standing between "share these documents" and
 * a folder of files that will not open, so it is tested as a FORMAT rather than
 * as a function: every assertion here reads bytes back out of the archive the
 * way a real unzip tool does, by walking the central directory.
 *
 * A test that only checked the Blob's size or type would pass on an archive with
 * a wrong CRC or a wrong central-directory offset — both of which produce a file
 * that lists fine in one tool and extracts as corruption in another.
 */
import { describe, expect, it } from "vitest";
import { buildZip, crc32, uniqueName, zipSafeName } from "./zip";

const text = new TextEncoder();
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** The bytes of a Blob, as a plain array. jsdom's Blob has no `arrayBuffer`. */
function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

type Entry = {
  name: string;
  crc: number;
  size: number;
  offset: number;
  method: number;
};

/**
 * A minimal reader: find the end-of-central-directory record, follow it to the
 * central directory, and read each entry's name, CRC, size and local-header
 * offset. This is the same path `unzip -l` takes, written out so a disagreement
 * between what we wrote and what the format says fails here.
 */
function readZip(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD is the last 22 bytes when there is no archive comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no end-of-central-directory record");

  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  expect(cdOffset + cdSize).toBe(eocd);

  const entries: Entry[] = [];
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameLen = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    entries.push({
      name,
      crc: view.getUint32(at + 16, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
      method: view.getUint16(at + 10, true),
    });
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}

/** The stored bytes of one entry, read through its LOCAL header. */
function payloadOf(bytes: Uint8Array, entry: Entry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(entry.offset, true)).toBe(0x04034b50);
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  return bytes.subarray(start, start + entry.size);
}

describe("crc32", () => {
  it("matches the reference values", () => {
    // The published check value for "123456789" is 0xCBF43926.
    expect(crc32(text.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("zipSafeName", () => {
  it("replaces what Windows refuses and keeps what matters", () => {
    expect(zipSafeName('RCCM: "Business Licence"/2026?')).toBe(
      "RCCM- -Business Licence--2026-",
    );
    expect(zipSafeName("Attestation de conformité fiscale.pdf")).toBe(
      "Attestation de conformité fiscale.pdf",
    );
  });

  it("falls back rather than producing an empty name", () => {
    expect(zipSafeName("   ")).toBe("document");
    expect(zipSafeName("...")).toBe("document");
  });

  it("caps the length but keeps the extension", () => {
    const long = `${"a".repeat(400)}.pdf`;
    const safe = zipSafeName(long);
    expect(safe.length).toBe(120);
    expect(safe.endsWith(".pdf")).toBe(true);
  });
});

describe("uniqueName", () => {
  it("numbers a collision before the extension", () => {
    const taken = new Set(["RCCM.pdf"]);
    expect(uniqueName("RCCM.pdf", taken)).toBe("RCCM (2).pdf");
    taken.add("RCCM (2).pdf");
    expect(uniqueName("RCCM.pdf", taken)).toBe("RCCM (3).pdf");
    // No extension: the counter goes on the end.
    expect(uniqueName("RCCM", new Set(["RCCM"]))).toBe("RCCM (2)");
  });
});

describe("buildZip", () => {
  it("writes an archive a central-directory reader can walk", async () => {
    const zip = await buildZip([
      { name: "ACF.pdf", data: text.encode("%PDF-1.7 first") },
      { name: "RCCM.png", data: text.encode("PNG bytes here") },
    ]);
    expect(zip.type).toBe("application/zip");

    const bytes = await bytesOf(zip);
    const entries = readZip(bytes);
    expect(entries.map((e) => e.name)).toEqual(["ACF.pdf", "RCCM.png"]);
    for (const e of entries) {
      expect(e.method).toBe(0);
      const payload = payloadOf(bytes, e);
      expect(payload.length).toBe(e.size);
      expect(crc32(payload)).toBe(e.crc);
    }
    // Stored, so the payload is the bytes that went in — offset by the header.
    expect(decode(payloadOf(bytes, entries[0]))).toBe("%PDF-1.7 first");
  });

  it("accepts Blobs, which is what a vault fetch returns", async () => {
    const zip = await buildZip([
      { name: "scan.pdf", data: new Blob([text.encode("scan")]) },
    ]);
    const bytes = await bytesOf(zip);
    const [entry] = readZip(bytes);
    expect(decode(payloadOf(bytes, entry))).toBe("scan");
  });

  it("marks names UTF-8 so accents survive the round trip", async () => {
    const zip = await buildZip([
      { name: "Attestation de conformité.pdf", data: text.encode("x") },
    ]);
    const bytes = await bytesOf(zip);
    const view = new DataView(bytes.buffer);
    // General-purpose bit 11, on both the local and the central header.
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
    expect(readZip(bytes)[0].name).toBe("Attestation de conformité.pdf");
  });

  it("writes an empty archive rather than throwing on nothing", async () => {
    const bytes = await bytesOf(await buildZip([]));
    expect(readZip(bytes)).toEqual([]);
  });
});
