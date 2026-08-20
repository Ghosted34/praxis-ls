"use strict";
const crypto = require("crypto");

function sha(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function contentHash({ headers = {}, body = "", attachments = [] }) {
  const canon = JSON.stringify({ headers, body, attachments: attachments.slice().sort() });
  return sha(canon);
}

function chainHash(prev, content) {
  return sha(String(prev || "") + String(content));
}

function append(prevRow, message) {
  const content = contentHash(message);
  const prev = prevRow ? prevRow.chain_hash : "";
  return {
    content_hash: content,
    prev_hash: prev || null,
    chain_hash: chainHash(prev, content),
    attachment_hashes: message.attachments || [],
  };
}

function verify(rows) {
  let prev = "";
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const expect = chainHash(prev, r.content_hash);
    if (r.chain_hash !== expect) return { ok: false, broken_at: i, seq: r.seq };
    prev = r.chain_hash;
  }
  return { ok: true, count: rows.length };
}

module.exports = { contentHash, chainHash, append, verify, sha };
