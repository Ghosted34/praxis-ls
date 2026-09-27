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
const dns = require("dns").promises;
const net = require("net");

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
 * Is this address one a relay probe must never be pointed at?
 *
 * The relay host is operator-supplied — it comes from the platform console
 * and from `.env` — so "press Test" is a request to send a UDP packet to a
 * name somebody typed. Without this, that is a port scanner with a button:
 * a root admin (or anyone who reaches that setting) could aim it at
 * 169.254.169.254 and read whether cloud metadata answers.
 *
 * The ranges are the ones coturn's own entrypoint denies as peers
 * (docker/coturn/docker-entrypoint.sh, calls audit C1). Keeping the two
 * lists the same shape is deliberate: the relay must not reach the host's
 * private services, and neither must the thing that tests the relay.
 */
function isBlockedAddress(ip) {
  const v = String(ip || "");
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is an IPv4 address wearing a hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  const addr = mapped ? mapped[1] : v;

  if (net.isIPv4(addr)) {
    const [a, b] = addr.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;               // this network, RFC 1918, loopback
    if (a === 169 && b === 254) return true;                         // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;                // RFC 1918
    if (a === 192 && b === 168) return true;                         // RFC 1918
    if (a === 192 && b === 0) return true;                           // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true;               // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true;            // benchmarking
    if (a >= 224) return true;                                       // multicast and reserved
    return false;
  }
  if (net.isIPv6(addr)) {
    const low = addr.toLowerCase();
    if (low === "::" || low === "::1") return true;                  // unspecified, loopback
    if (/^f[cd]/.test(low)) return true;                             // unique-local fc00::/7
    if (/^fe[89ab]/.test(low)) return true;                          // link-local fe80::/10
    if (/^ff/.test(low)) return true;                                // multicast
    return false;
  }
  // Not an address we can reason about: refuse rather than guess.
  return true;
}

/**
 * Resolve `host` and refuse it unless every address it answers with is
 * public. Every address, not the first: a name that resolves to one public
 * and one private address is the DNS-rebinding shape, and taking the public
 * one would send the packet to whichever the OS picked anyway.
 */
async function assertProbeableHost(host) {
  const literal = net.isIP(host);
  const addresses = literal
    ? [host]
    : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length) throw new Error(`${host} does not resolve`);
  const blocked = addresses.filter(isBlockedAddress);
  if (blocked.length) {
    throw new Error(
      `${host} resolves to ${blocked[0]}, which is a private, loopback or link-local address — `
      + "a relay must be reachable from the public internet, and probing an internal address is refused",
    );
  }
  return addresses;
}

/**
 * Allocate a relay address on `host:port` with the long-term credential
 * `label` (coturn's "username", `<expiry>:<token>`) and `mac` (the HMAC it
 * checks) — `smartcomm.turn.service` `signedLabel`. Resolves
 * `{ ok, relayed, ms, error, code }`; never throws.
 *
 * `allowPrivate` exists for one caller: the integration suite, which spawns
 * its own turnserver on this machine's LAN address. Nothing that takes a host
 * from a person may pass it.
 */
async function allocate({ host, port, label, mac, timeoutMs = 5000, allowPrivate = false }) {
  // The packet goes to the address we CHECKED, never to the name. Resolving
  // once and sending to the result closes the gap between the two: a name
  // that answers publicly here and privately a millisecond later cannot move
  // the target, because the target is already an address. It also means the
  // operator-supplied string never reaches the socket.
  let target = host;
  if (!allowPrivate) {
    try {
      [target] = await assertProbeableHost(host);
    } catch (err) {
      return { ok: false, code: "BLOCKED_ADDRESS", error: err.message, ms: 0 };
    }
  }
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
    // `target` is an address assertProbeableHost resolved and then refused
    // unless EVERY answer was public — never the operator's string.
    const send = (buf) => socket.send(buf, port, target, (err) => err && done({ ok: false, error: err.message }));

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

module.exports = { allocate, isBlockedAddress, _test: { message, parse, attr, xorAddress, assertProbeableHost } };
