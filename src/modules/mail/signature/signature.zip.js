/**
 * A minimal ZIP writer — PURE. Enough to hand a manager one file containing a
 * team's signature PNGs.
 *
 * WHY NOT A LIBRARY. The repo has no zip-writing dependency, and this needs one
 * feature of the format: several already-compressed files, stored. `archiver`
 * and `jszip` both bring a stream stack and a deflate implementation to do work
 * that must not happen here — a PNG is already a deflate stream, so compressing
 * it again costs CPU and typically ADDS bytes. Method 0 (STORE) is not a
 * shortcut around a missing library; it is the correct method for this payload,
 * and it is ~90 lines.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. No ZIP64, no encryption, no directory
 * entries, no data descriptors. The bound is a team's worth of ~70 kB images,
 * which is orders of magnitude below the 4 GiB / 65 535-entry point where
 * ZIP64 becomes necessary — `build` throws rather than silently emitting a
 * corrupt archive if a caller ever approaches it.
 */
"use strict";

const zlib = require("zlib");

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const STORE = 0;
const VERSION = 20; // 2.0 — the floor for the UTF-8 flag below.
const UTF8_FLAG = 0x0800;

const MAX_ENTRIES = 60000;
const MAX_TOTAL = 3 * 1024 * 1024 * 1024; // well under the 4 GiB ZIP64 boundary

/**
 * MS-DOS date/time, which is what the format stores. Two-second resolution and
 * a 1980 epoch are not choices — they are the field widths.
 */
function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Names are sanitised HERE rather than trusted from the caller: an entry called
 * `../../etc/cron.d/x` is the classic zip-slip, and the person naming these
 * entries is whoever typed an employee's name into HR.
 */
function safeName(name, index) {
  const base = String(name || "")
    // Separators first: without one, a `..` cannot traverse anywhere.
    .replace(/[\\/ ]/g, "_")
    // Then dot-runs, ANYWHERE, not just leading. Stripping only the leading
    // run left `../../etc/crontab` as `_.._etc_crontab` — harmless, since the
    // separators are already gone, but it makes the guarantee "no separators
    // AND no `..`" rather than "no separators, so the `..` cannot matter".
    // The first is checkable by looking at the output; the second needs an
    // argument.
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .trim();
  return base || `file-${index + 1}`;
}

/**
 * @param {Array<{name: string, data: Buffer, date?: Date}>} files
 * @returns {Buffer}
 */
function build(files) {
  const entries = Array.isArray(files) ? files : [];
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`zip: ${entries.length} entries exceeds the ${MAX_ENTRIES} this writer supports`);
  }

  const locals = [];
  const centrals = [];
  const seen = new Set();
  let offset = 0;
  let total = 0;

  entries.forEach((entry, i) => {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || "");
    total += data.length;
    if (total > MAX_TOTAL) throw new Error("zip: archive exceeds this writer's size limit");

    // Two people with the same name must not collapse into one entry — the
    // second write would silently win and a manager would be short a signature.
    let name = safeName(entry.name, i);
    if (seen.has(name)) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (seen.has(`${stem}-${n}${ext}`)) n += 1;
      name = `${stem}-${n}${ext}`;
    }
    seen.add(name);

    const nameBuf = Buffer.from(name, "utf8");
    const crc = zlib.crc32 ? zlib.crc32(data) : crc32(data);
    const { time, date } = dosDateTime(entry.date);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(STORE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed === uncompressed under STORE
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(STORE, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  });

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

/**
 * CRC-32 for Node versions without `zlib.crc32` (added in Node 20.15). The
 * table is built once; a per-call table would dominate the cost of storing a
 * 70 kB PNG.
 */
let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[i] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

module.exports = { build, safeName, dosDateTime, crc32, MAX_ENTRIES, MAX_TOTAL };
