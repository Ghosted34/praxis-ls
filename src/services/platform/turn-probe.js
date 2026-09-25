/**
 * One TURN allocation from the server (calls audit PR-7, O5: the platform
 * call check). The relay is asked for exactly what a caller's browser asks
 * for — an Allocate over UDP with a credential minted the way the API mints
 * them (smartcomm.turn.service `turnCredential`) — so a wrong
 * TURN_CREDENTIAL_SECRET, a relay that is down, or a port the network drops
 * all fail here the same way they fail a call.
 *
 * RFC 5389 / 5766, the minimum: an unauthenticated Allocate, the 401 that
 * carries REALM and NONCE, the authenticated retry with MESSAGE-INTEGRITY
 * (HMAC-SHA1 under MD5(username:realm:password), the long-term credential),
 * then a Refresh with LIFETIME 0 so the allocation does not sit on the relay
 * for ten minutes. No dependency: the relay's own client tools are not in
 * the runtime image, and this is forty lines of framing.
 */
"use strict";

const crypto = require("crypto");
const dgram = require("dgram");

const MAGIC = 0x2112a442;
const T = {
  ALLOCATE: 0x0003,
  ALLOCATE_OK: 0x0103,
  ALLOCATE_ERR: 0x0113,
  REFRESH: 0x0004,
};
const A = {
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  LIFETIME: 0x000d,
  REALM: 0x0014,
  NONCE: 0x0015,
  XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019,
};

function attr(type, value) {
  const pad = (4 - (value.length % 4)) % 4;
  const head = Buffer.alloc(4);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(value.length, 2);
  return Buffer.concat([head, value, Buffer.alloc(pad)]);
}

/** A message; with `key`, MESSAGE-INTEGRITY over it (length counting the MI). */
function message(type, txId, attrs, key = null) {
  let body = Buffer.concat(attrs);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(type, 0);
  header.writeUInt32BE(MAGIC, 4);
  txId.copy(header, 8);
  if (key) {
    header.writeUInt16BE(body.length + 24, 2);
    // codeql[js/weak-cryptographic-algorithm] — STUN's MESSAGE-INTEGRITY is HMAC-SHA1 by RFC 5389.
    const mi = crypto.createHmac("sha1", key).update(Buffer.concat([header, body])).digest();
    body = Buffer.concat([body, attr(A.MESSAGE_INTEGRITY, mi)]);
  }
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

function parse(buf) {
  if (!buf || buf.length < 20 || buf.readUInt32BE(4) !== MAGIC) return null;
  const type = buf.readUInt16BE(0);
  const len = buf.readUInt16BE(2);
  const attrs = {};
  let off = 20;
  while (off + 4 <= 20 + len && off + 4 <= buf.length) {
    const t = buf.readUInt16BE(off);
    const l = buf.readUInt16BE(off + 2);
    attrs[t] = buf.subarray(off + 4, off + 4 + l);
    off += 4 + l + ((4 - (l % 4)) % 4);
  }
  return { type, txId: buf.subarray(8, 20), attrs };
}

function xorAddress(v) {
  if (!v || v.length < 8) return null;
  const port = v.readUInt16BE(2) ^ (MAGIC >>> 16);
  if (v[1] !== 0x01) return `ipv6:${port}`;
  const ip = [0, 1, 2, 3].map((i) => v[4 + i] ^ ((MAGIC >>> (24 - 8 * i)) & 0xff)).join(".");
  return `${ip}:${port}`;
}

function errorOf(v) {
  if (!v || v.length < 4) return null;
  return { code: v[2] * 100 + v[3], reason: v.subarray(4).toString("utf8") };
}

/**
 * Allocate a relay address on `host:port` with the long-term credential
 * `label` (coturn's "username", `<expiry>:<token>`) and `mac` (the HMAC it
 * checks) — `smartcomm.turn.service` `signedLabel`. Resolves
 * `{ ok, relayed, ms, error, code }`; never throws.
 */
function allocate({ host, port, label, mac, timeoutMs = 5000 }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    const done = (out) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* @silent:teardown — the socket is already closed. */
      }
      resolve({ ms: Date.now() - started, ...out });
    };
    const timer = setTimeout(() => done({ ok: false, error: `no answer from ${host}:${port} within ${timeoutMs} ms` }), timeoutMs);
    const transport = attr(A.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0]));
    let key = null;
    let realm = null;
    let nonce = null;
    const send = (buf) => socket.send(buf, port, host, (err) => err && done({ ok: false, error: err.message }));

    socket.on("error", (err) => done({ ok: false, error: err.message }));
    socket.on("message", (raw) => {
      const msg = parse(raw);
      if (!msg) return;
      if (msg.type === T.ALLOCATE_ERR) {
        const err = errorOf(msg.attrs[A.ERROR_CODE]);
        if (err && err.code === 401 && !key && msg.attrs[A.REALM] && msg.attrs[A.NONCE]) {
          realm = msg.attrs[A.REALM].toString("utf8");
          nonce = msg.attrs[A.NONCE];
          // The long-term credential key is MD5 by RFC 5389 §15.4 — the wire
          // protocol, not a chosen cipher; nothing here is a person's password.
          key = crypto.createHash("md5").update(`${label}:${realm}:${mac}`).digest();
          send(message(T.ALLOCATE, crypto.randomBytes(12), [
            transport,
            attr(A.USERNAME, Buffer.from(label)),
            attr(A.REALM, Buffer.from(realm)),
            attr(A.NONCE, nonce),
          ], key));
          return;
        }
        done({ ok: false, code: err ? err.code : null, error: err ? `${err.code} ${err.reason}`.trim() : "allocation refused" });
        return;
      }
      if (msg.type === T.ALLOCATE_OK) {
        const relayed = xorAddress(msg.attrs[A.XOR_RELAYED_ADDRESS]);
        // Release it at once: a check should not hold a relay port for 10 min.
        if (key) {
          send(message(T.REFRESH, crypto.randomBytes(12), [
            attr(A.LIFETIME, Buffer.from([0, 0, 0, 0])),
            attr(A.USERNAME, Buffer.from(label)),
            attr(A.REALM, Buffer.from(realm)),
            attr(A.NONCE, nonce),
          ], key));
        }
        setTimeout(() => done({ ok: true, relayed }), 50);
      }
    });
    send(message(T.ALLOCATE, crypto.randomBytes(12), [transport]));
  });
}

module.exports = { allocate, _test: { message, parse, attr, xorAddress } };
