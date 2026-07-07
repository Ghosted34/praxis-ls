/**
 * Deterministic text splitter + content hashing. Splits on blank lines / size so
 * re-ingesting unchanged content yields identical chunks + hashes (idempotent).
 */
"use strict";

const crypto = require("crypto");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
// rough token estimate: ~4 chars/token
const estTokens = (s) => Math.ceil(s.length / 4);

function chunkText(text, opts = {}) {
  const maxChars = opts.maxChars || 3200; // ~800 tokens
  const overlap = opts.overlap || 200;
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const paras = clean.split(/\n{2,}/);
  const chunks = [];
  let buf = "";
  const flush = () => {
    const c = buf.trim();
    if (c) chunks.push(c);
    buf = "";
  };
  for (const p of paras) {
    if (buf.length + p.length + 2 > maxChars && buf) {
      flush();
      if (overlap > 0) buf = chunks[chunks.length - 1].slice(-overlap) + "\n\n";
    }
    if (p.length > maxChars) {
      // hard-split an oversized paragraph
      for (let i = 0; i < p.length; i += maxChars - overlap) {
        chunks.push(p.slice(i, i + maxChars).trim());
      }
      continue;
    }
    buf += (buf ? "\n\n" : "") + p;
  }
  flush();

  return chunks.map((content, chunk_no) => ({
    chunk_no,
    content,
    content_hash: sha256(content),
    token_count: estTokens(content),
  }));
}

module.exports = { chunkText, sha256, estTokens };
