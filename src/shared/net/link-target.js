"use strict";

/**
 * May we fetch this URL, and is it one of ours?
 *
 * A chat message that unfurls itself turns a READ into an OUTBOUND REQUEST: the
 * first time somebody pastes a link, the server goes to that address with a
 * tenant's credentials on the network. That is the definition of an SSRF surface,
 * and a link preview is the classic way to reach `169.254.169.254`, a Postgres
 * on `localhost:5432`, or whichever internal admin panel has no authentication
 * because everybody assumed it was only reachable from inside the VPC.
 *
 * So this module is written as a gatekeeper first and a helper second. Everything
 * else in the link-preview feature is allowed to assume the URL it was handed has
 * come through `screenUrl` and survived — and only `guarded-fetch.js` calls it,
 * which is deliberate: a gate with three callers has three chances to be skipped.
 *
 * ── WHY THE CHECKS ARE DONE TWICE (and why that is not redundancy) ─────────
 *
 * `new URL()` accepts a host. The DNS accepts a name. Those are different
 * questions, and answering only the first is the bug in most SSRF code: the
 * literal-IP and private-range rules stop `http://127.0.0.1`, they do not stop
 * `http://internal-lab.corp.example`, which resolves to 127.0.0.1 five minutes
 * later. So `guarded-fetch.js` applies these same range rules to EVERY address
 * the resolver returns, at the point where it pins the socket to one of them
 * (`makeGuardedLookup`) — the check and the connection cannot be separated in
 * time, which is the only version of this that is not a race — and `screenUrl`
 * is re-run on every redirect hop, because a public host that 302s to a metadata
 * endpoint is a public URL for exactly as long as nobody follows it.
 *
 * The resolver is INJECTED rather than imported for the same reason `dns-target.js`
 * injects its lookup: a test that needs real DNS is a test that fails on a train,
 * and the range rules — the part that is actually load-bearing — have nothing to
 * do with whether a name resolves anywhere.
 *
 * ── WHY THIS MODULE DOES NOT ANSWER "IS IT OURS?" ──────────────────────────
 *
 * It used to, and the predicate went unused: the own-host decision belongs to
 * `link-detect.toAppPath` (shared with the client, which has to linkify the same
 * characters the server fetches) and to the links service's `selfHosts()`. It is
 * worth recording WHY that decision is not here, because the answer changes what
 * a caller DOES, not merely how: a link to our own app is never fetched at all —
 * it is resolved from the database the reader already has rights on — while a
 * link to anyone else's site is fetched through the gate above. A product that
 * fetches itself over its own public interface pays a round trip to its own load
 * balancer, arrives with no session, and gets a login page; the "preview" of a
 * shared invoice would be a sign-in form. A dead `isOwnHost` in a security module
 * is worse than none: someone would eventually assume it was wired.
 */

const net = require("node:net");

/** Only the two ports a preview is ever worth fetching on. A site on :8080 does
 *  not get a card; it stays a plain clickable link. Deliberate: every extra port
 *  is an internal service somebody has exposed on a non-standard number, and the
 *  value of the preview does not justify the reach. */
const ALLOWED_PORTS = new Set(["80", "443"]);

/** Hostnames that are never fetchable regardless of what DNS says. `localhost`
 *  and single-label names are here because on a Docker network they resolve to
 *  whatever the compose file happened to name a service — `postgres`, `redis`,
 *  `mailpit` — which is precisely the set of things a preview must not reach. */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"];
const BLOCKED_HOSTS = new Set(["localhost"]);

/**
 * IPv4 ranges that must never be the target of a server-side fetch.
 *
 * Written as explicit prefixes rather than "everything except public", because
 * the exceptions are the point: a shared address like `100.64.0.0/10` (CGNAT,
 * and what Tailscale hands out) is blocked for the same reason the private ones
 * are, and it is NOT covered by the classic `isPrivate` helpers people copy.
 */
const V4_BLOCKED = [
  ["0.0.0.0", 8], // "this host on this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space / CGNAT / VPN meshes
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — cloud metadata lives here
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved / future use (includes 255.255.255.255)
];

/**
 * IPv6 equivalents. `::1` and `::` are obvious; the ones that get missed are
 * `::ffff:0:0/96` (IPv4-mapped — the address a dual-stack host hands back for an
 * A-and-AAAA name, and the standard way around a naive v4-only filter) and
 * `fc00::/7` (unique local). Teredo (`2001::/32`) is blocked too: it can encode
 * an arbitrary IPv4 destination inside an address that looks public.
 */
const V6_BLOCKED = [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48], // local-use IPv4-translatable
  ["100::", 64], // discard-only
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

const ipToInt = (v4) =>
  v4.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);

function inV4Cidr(ip, [cidr, bits]) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(cidr) & mask);
}

/** Expand an IPv6 address to eight `xxxx` groups. Only needs to handle the legal
 *  forms a URL parser produces (`net.isIPv6` already accepted it), plus the
 *  IPv4-mapped tail. Written by hand because there is no parser in the runtime
 *  for it and `ipaddr.js` is not a dependency of this package. */
function expandV6(address) {
  let v6 = String(address).toLowerCase();
  const zone = v6.indexOf("%");
  if (zone !== -1) v6 = v6.slice(0, zone);
  const mapped = /:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v6);
  if (mapped) {
    const hi = (Number(mapped[1]) << 8) | Number(mapped[2]);
    const lo = (Number(mapped[3]) << 8) | Number(mapped[4]);
    v6 = v6.slice(0, mapped.index + 1) + hi.toString(16) + ":" + lo.toString(16);
  }
  const [head, tail] = v6.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail !== undefined ? tail.split(":").filter(Boolean) : null;
  let parts;
  if (tailParts === null) parts = headParts;
  else {
    const missing = Math.max(0, 8 - headParts.length - tailParts.length);
    parts = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  }
  return parts.slice(0, 8).map((p) => p.padStart(4, "0"));
}

function inV6Cidr(ip, [cidr, bits]) {
  const groups = expandV6(ip);
  const netGroups = expandV6(cidr);
  // Whole bytes are compared at a time; only the byte the prefix ends inside
  // needs a partial mask.
  for (let i = 0; i < 16; i += 1) {
    const remaining = bits - i * 8;
    if (remaining <= 0) break;
    const mask = remaining >= 8 ? 0xff : (0xff << (8 - remaining)) & 0xff;
    const byteIndex = i >> 1;
    const half = i % 2;
    const a = parseInt(netGroups[byteIndex].slice(half * 2, half * 2 + 2), 16) & mask;
    const b = parseInt(groups[byteIndex].slice(half * 2, half * 2 + 2), 16) & mask;
    if (a !== b) return false;
  }
  return true;
}

/** Is this address literal — and if so, does it fall in a range we never touch? */
function isBlockedAddress(address) {
  const clean = String(address || "").replace(/^\[|\]$/g, "");
  if (net.isIPv4(clean)) return V4_BLOCKED.some((c) => inV4Cidr(clean, c));
  if (net.isIPv6(clean)) return V6_BLOCKED.some((c) => inV6Cidr(clean, c));
  return false;
}

function normalizeHost(hostname) {
  return String(hostname || "").toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
}

function hostIsBlockedName(host) {
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  // A single label (`postgres`, `redis`, `mailpit`) is a container-network name
  // on any Docker Compose stack, which is this product's own development and
  // self-hosted topology. Public hostnames always have at least one dot.
  if (!host.includes(".")) return true;
  return false;
}

/**
 * Shape-only checks, with no I/O: protocol, credentials, port, literal-IP rules.
 * Returns a parsed URL or `{ ok: false, reason }`.
 *
 * Credentials in the URL (`https://user:pass@host`) are refused outright rather
 * than stripped: a preview is never authenticating to anything, and a URL that
 * carries a password in a chat message has already leaked it to every member of
 * the channel.
 */
function screenUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "protocol" };
  }
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  const host = normalizeHost(url.hostname);
  // An IP literal is judged on the address itself. It must not reach the
  // name rules below, where "[::1]" would look like a single-label container
  // name and be refused for a reason that has nothing to do with it.
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) return { ok: false, reason: "blocked-address" };
  } else if (hostIsBlockedName(host)) {
    return { ok: false, reason: "blocked-host" };
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (!ALLOWED_PORTS.has(port)) return { ok: false, reason: "port" };
  return { ok: true, url, host };
}

module.exports = {
  ALLOWED_PORTS,
  screenUrl,
  isBlockedAddress,
};
