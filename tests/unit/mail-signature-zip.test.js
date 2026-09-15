/**
 * THE ZIP WRITER.
 *
 * A hand-written archive format is exactly the kind of code that "works" on the
 * machine it was written on and produces a file Windows Explorer refuses to
 * open. So these assert the BYTES — the signatures, the offsets in the central
 * directory, the CRCs — rather than only that `build` returned a Buffer. The
 * parse-back at the bottom is the real test: it walks the central directory the
 * way an extractor does and recovers every file.
 */
"use strict";

const zlib = require("zlib");
const zip = require("../../src/modules/mail/signature/signature.zip");

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

const file = (name, body) => ({ name, data: Buffer.from(body) });

/** Walk the central directory the way an extractor does. */
function readArchive(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);
  expect(buf.readUInt32LE(end)).toBe(END_SIG);

  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    expect(buf.readUInt32LE(p)).toBe(CENTRAL_SIG);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");

    // Follow the pointer into the local header and read the bytes back.
    expect(buf.readUInt32LE(localOffset)).toBe(LOCAL_SIG);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    out.push({ name, crc, size, data: buf.slice(dataStart, dataStart + size) });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("archive structure", () => {
  test("an empty archive is still a valid archive", () => {
    const buf = zip.build([]);
    expect(buf.readUInt32LE(buf.length - 22)).toBe(END_SIG);
    expect(readArchive(buf)).toHaveLength(0);
  });

  test("every file round-trips, byte for byte", () => {
    const files = [
      file("Signature_A.png", "first"),
      file("Signature_B.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])),
      file("Signature_C.png", "x".repeat(5000)),
    ];
    const entries = readArchive(zip.build(files));
    expect(entries.map((e) => e.name)).toEqual([
      "Signature_A.png", "Signature_B.png", "Signature_C.png",
    ]);
    entries.forEach((e, i) => {
      expect(e.data.equals(files[i].data)).toBe(true);
    });
  });

  test("the CRC in the directory is the CRC of the bytes", () => {
    const data = Buffer.from("the quick brown fox");
    const [entry] = readArchive(zip.build([{ name: "a.png", data }]));
    const expected = zlib.crc32 ? zlib.crc32(data) : zip.crc32(data);
    expect(entry.crc).toBe(expected);
    expect(zip.crc32(data)).toBe(expected); // the fallback agrees with zlib
  });

  /** STORE, not DEFLATE: a PNG is already a deflate stream, so re-compressing
   *  costs CPU and usually adds bytes. */
  test("entries are stored, and the archive is barely larger than its payload", () => {
    const payload = Buffer.from("y".repeat(50000));
    const buf = zip.build([{ name: "a.png", data: payload }]);
    expect(buf.length).toBeGreaterThan(payload.length);
    expect(buf.length).toBeLessThan(payload.length + 300);
  });
});

describe("names", () => {
  /** The names come from HR records, so they are user data. */
  test("a path traversal cannot escape the archive", () => {
    const [entry] = readArchive(zip.build([file("../../etc/crontab", "x")]));
    expect(entry.name).not.toContain("..");
    expect(entry.name).not.toContain("/");
    expect(entry.name).not.toContain("\\");
  });

  test("an absolute path is defused", () => {
    const [entry] = readArchive(zip.build([file("/etc/passwd", "x")]));
    expect(entry.name).not.toMatch(/^\//);
  });

  /**
   * Two people can share a name. Without this the second entry silently
   * overwrites the first on extraction and a manager is quietly one signature
   * short — the kind of failure nobody notices until someone asks.
   */
  test("a duplicate name is suffixed rather than colliding", () => {
    const entries = readArchive(zip.build([
      file("Signature_Jean_Nkoa.png", "one"),
      file("Signature_Jean_Nkoa.png", "two"),
      file("Signature_Jean_Nkoa.png", "three"),
    ]));
    expect(new Set(entries.map((e) => e.name)).size).toBe(3);
    expect(entries.map((e) => e.data.toString())).toEqual(["one", "two", "three"]);
  });

  test("an empty name still produces an addressable entry", () => {
    const [entry] = readArchive(zip.build([file("", "x")]));
    expect(entry.name).toBe("file-1");
  });

  test("accented names survive as UTF-8", () => {
    const [entry] = readArchive(zip.build([file("Signature_Élodie_Kamga.png", "x")]));
    expect(entry.name).toBe("Signature_Élodie_Kamga.png");
  });
});

describe("bounds", () => {
  test("too many entries is refused, not silently truncated", () => {
    const many = Array.from({ length: zip.MAX_ENTRIES + 1 }, (_, i) => file(`${i}.png`, "x"));
    expect(() => zip.build(many)).toThrow(/exceeds/);
  });

  test("a pre-1980 timestamp is clamped rather than emitting a negative year", () => {
    const { date } = zip.dosDateTime(new Date("1971-01-01T00:00:00Z"));
    expect(date >>> 9).toBe(0); // 1980 + 0
    expect(date).toBeGreaterThanOrEqual(0);
  });

  test("an invalid date falls back to now instead of corrupting the field", () => {
    expect(() => zip.dosDateTime(new Date("nonsense"))).not.toThrow();
    expect(zip.dosDateTime(new Date("nonsense")).date).toBeGreaterThan(0);
  });
});
