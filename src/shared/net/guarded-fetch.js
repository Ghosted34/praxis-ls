"use strict";

/**
 * HTTP for a URL somebody else chose.
 *
 * Every request in this product is normally to a host we configure: a provider,
 * a storage endpoint, a webhook an operator typed into a settings screen. This is
 * the one place a URL arrives from the content of a message, which makes it the
 * one place a plain `axios.get` is a vulnerability rather than a convenience. So
 * this module is a small, deliberate `http`/`https` client whose whole job is to
 * refuse.
 *
 * ── WHY NOT axios / undici fetch ────────────────────────────────────────────
 *
 * Both follow redirects for you, and a preview fetch MUST re-screen every hop:
 * `https://public.example/redirect-to?url=http://169.254.169.254/` is a public
 * host for exactly as long as nobody follows it. `redirect: "manual"` in undici's
 * fetch answers with an opaque response that hides the `Location` header, so the
 * hop cannot even be read, let alone checked. Both are fixed at the point that
 * matters most, which is the whole reason this file exists.
 *
 * ── THE ONE DEFENCE THAT MATTERS MOST: `lookup` ─────────────────────────────
 *
 * Checking "is this host private?" and THEN resolving it leaves a window, and DNS
 * rebinding drives a truck through it: the attacker's zone answers the first query
 * with a public address (screen passes) and the second — the one the HTTP client
 * actually connects to — with `127.0.0.1`. So the screen does not resolve the
 * name separately. It installs `guardedLookup` INTO the request, and the check
 * happens on the address the resolver returned, in the same call the socket will
 * use. There is no window, because there is no second resolution.
 *
 * ── WHY THE CAPS ARE ALL THREE KINDS ────────────────────────────────────────
 *
 * A host that never answers, a host that answers and streams forever, and a host
 * that answers with 40 MB of HTML are three different failures and each needs its
 * own bound: a connect/socket timeout for the first, an idle timeout between
 * chunks for the second, and a byte counter that destroys the response for the
 * third. A preview that can occupy a worker for a minute and 40 MB of memory is
 * a denial of service that costs the tenant nothing to trigger: paste a link.
 */

const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");
const dns = require("node:dns");
const linkTarget = require("./link-target");

/** HTML head metadata is in the first few kilobytes of a page. A site whose
 *  `<head>` is not there in 256 KB is not serving a page, it is serving a
 *  download. */
const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_IDLE_MS = 4000;
const DEFAULT_MAX_HOPS = 3;

/** Identifies what we are, because a site deciding whether to answer a bot is
 *  making an informed decision rather than guessing, and because an
 *  unidentifiable crawler hitting a partner's tracking page on a tenant's behalf
 *  is exactly the kind of traffic a NOC should be able to trace to us. */
const USER_AGENT =
  "PraxisLSBot/1.0 (+https://praxisls.com/link-previews; tenant link previews; read-only)";

class BlockedError extends Error {
  constructor(reason, detail) {
    super(`link fetch blocked: ${reason}`);
    this.name = "BlockedError";
    this.blockReason = reason;
    this.detail = detail;
  }
}

/**
 * A `dns.lookup`-compatible function that refuses to hand back an address we are
 * not allowed to connect to.
 *
 * `verbatim: true` matters: without it Node applies its own reordering of A/AAAA
 * results, and happy-eyeballs clients prefer IPv6, so the address actually
 * connected to is not necessarily the one inspected. Here the callback receives
 * exactly the list we filtered.
 */
function makeGuardedLookup({ resolve = dns.promises.lookup.bind(dns.promises) } = {}) {
  return function guardedLookup(hostname, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const cb = typeof callback === "function" ? callback : () => {};
    // An IP literal never reaches the resolver, so the literal cases are settled
    // up front — including `all: false`, where a single blocked address is enough
    // to refuse the whole host.
    if (linkTarget.isBlockedAddress(hostname)) {
      const err = new BlockedError("blocked-address", hostname);
      cb(err, options && options.all ? [] : null);
      return;
    }
    resolve(hostname, { ...options, verbatim: true, all: true })
      .then((records) => {
        const list = Array.isArray(records) ? records : [records];
        const safe = list.filter((r) => r && !linkTarget.isBlockedAddress(r.address));
        if (!safe.length) {
          const err = new BlockedError("private-resolver", hostname);
          cb(err, options && options.all ? [] : null);
          return;
        }
        if (options && options.all) cb(null, safe);
        else cb(null, safe[0].address, safe[0].family || 4);
      })
      .catch((err) => cb(err, options && options.all ? [] : null));
  };
}

/** The shape checks that apply to every hop, redirect included. */
function screenHop(rawUrl) {
  const screened = linkTarget.screenUrl(rawUrl);
  if (!screened.ok) return { ok: false, reason: screened.reason };
  return { ok: true, url: screened.url };
}

function readCapped(res, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let truncated = false;
    res.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        truncated = true;
        chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
        res.destroy();
        return;
      }
      chunks.push(chunk);
    });
    res.on("error", reject);
    // `close` fires on a destroyed stream too, which is what a truncation looks
    // like from here — so both events settle the same promise and a capped read
    // is an ANSWER ("here is the head, it was long") rather than a failure.
    const done = () => resolve({ buffer: Buffer.concat(chunks), truncated });
    res.on("end", done);
    res.on("close", done);
  });
}

/**
 * One GET, one hop. Redirects are NOT followed here — a 3xx comes back as
 * `{ kind: "redirect" }` so the caller can re-screen the destination and count
 * the hop. `finish` is the only way out, and it is idempotent, because a socket
 * can error after it has answered just as happily as before.
 */
function fetchOneHop(url, { maxBytes, timeoutMs, idleMs, accept, lookup, allowContentTypes }) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    let settled = false;
    // Both are assigned a few lines below and read only from callbacks, so neither
    // can be observed as null — but declaring them up front is what keeps the
    // timers' TDZ a non-question rather than a thing a future edit breaks.
    let req = null;
    let wall = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (wall) clearTimeout(wall);
      resolve(value);
    };
    const kill = (reason) => {
      if (settled) return;
      if (req && !req.destroyed) req.destroy();
      finish({ kind: "network", reason });
    };
    // A hard ceiling on the WHOLE hop, on top of the idle timeout: a host that
    // dribbles one byte per second resets an idle timer forever.
    wall = setTimeout(() => kill("timeout"), timeoutMs);

    req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? "443" : "80"),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        // The whole point: the address actually connected to is the address the
        // guard inspected, with no second resolution to race against.
        lookup,
        // `servername` for SNI, so a name-based vhost behind a CDN answers for us.
        servername: url.hostname,
        headers: {
          Accept: accept,
          "Accept-Language": "en, fr;q=0.8",
          "User-Agent": USER_AGENT,
          // `identity`, and deliberately. Advertising gzip would let a host hand
          // back compressed bytes, and this module has no decompressor — parsing
          // gzipped HTML with a regex produces a preview of nothing, on exactly
          // the sites worth previewing. A refused encoding is a worse trade than
          // a slightly larger read of an uncompressed head.
          "Accept-Encoding": "identity",
        },
      },
      async (res) => {
        const status = res.statusCode || 0;
        const headers = res.headers || {};
        try {
          if ([301, 302, 303, 307, 308].includes(status) && headers.location) {
            res.destroy();
            finish({ kind: "redirect", status, location: headers.location });
            return;
          }
          if (status >= 300) {
            res.destroy();
            finish({ kind: "status", status });
            return;
          }
          const contentType = String(headers["content-type"] || "").toLowerCase();
          if (
            allowContentTypes &&
            !allowContentTypes.some((c) => contentType.startsWith(c))
          ) {
            res.destroy();
            finish({ kind: "content-type", status, contentType });
            return;
          }
          const declared = Number(headers["content-length"] || 0);
          // An honest Content-Length over the cap is refused without reading a
          // byte; a lying one is still caught by the counter in `readCapped`.
          if (declared > maxBytes) {
            res.destroy();
            finish({ kind: "too-large", status, contentType });
            return;
          }
          const read = await readCapped(res, maxBytes);
          finish({
            kind: "body",
            status,
            headers,
            contentType,
            buffer: read.buffer,
            truncated: read.truncated,
          });
        } catch (error) {
          finish({ kind: "error", error });
        }
      },
    );

    req.setTimeout(timeoutMs, () => kill("timeout"));
    req.on("response", () => req.setTimeout(idleMs, () => kill("idle")));
    req.on("error", (error) => {
      if (error && error.name === "BlockedError") {
        finish({ kind: "blocked", reason: error.blockReason, detail: error.detail });
        return;
      }
      if (settled) return;
      finish({ kind: "network", reason: "connect-failed" });
    });
    req.end();
  });
}

/**
 * Fetch one document, following at most `maxHops` re-screened redirects.
 *
 * Never throws for a refusal or a network failure: it returns
 * `{ ok: false, reason }`, because every caller here is a best-effort preview and
 * an exception raised by a link somebody pasted is a worse bug than a missing
 * card.
 *
 * @param {string} targetUrl
 * @param {{
 *   maxBytes?: number, timeoutMs?: number, idleMs?: number, maxHops?: number,
 *   accept?: string, allowContentTypes?: string[],
 *   resolve?: (host: string, opts: object) => Promise<Array<{address: string}>>,
 * }} [opts]  `resolve` is the injected DNS answer used by tests.
 */
async function guardedFetch(targetUrl, opts = {}) {
  const config = {
    maxBytes: opts.maxBytes || DEFAULT_MAX_BYTES,
    timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    idleMs: opts.idleMs || DEFAULT_IDLE_MS,
    accept: opts.accept || "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    allowContentTypes: opts.allowContentTypes || null,
    lookup: makeGuardedLookup(opts.resolve ? { resolve: opts.resolve } : {}),
  };
  // `??` rather than `||`, so `maxHops: 0` means "refuse redirects" instead of
  // silently meaning the default.
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;

  let current = String(targetUrl || "").trim();
  for (let hops = 0; ; hops += 1) {
    const screened = screenHop(current);
    if (!screened.ok) return { ok: false, reason: screened.reason };
    const url = screened.url;
    const result = await fetchOneHop(url, config);

    if (result.kind === "blocked") {
      return { ok: false, reason: result.reason, detail: result.detail };
    }
    if (result.kind === "network") return { ok: false, reason: result.reason };
    if (result.kind === "error") return { ok: false, reason: "read-failed" };
    if (result.kind === "too-large") return { ok: false, reason: "too-large" };
    if (result.kind === "content-type") {
      return { ok: false, reason: "content-type", contentType: result.contentType };
    }
    if (result.kind === "status") return { ok: false, reason: "status", status: result.status };
    if (result.kind === "redirect") {
      if (hops >= maxHops) return { ok: false, reason: "too-many-redirects" };
      let next;
      try {
        next = new URL(result.location, url).toString();
      } catch {
        return { ok: false, reason: "bad-redirect" };
      }
      current = next;
      continue;
    }

    return {
      ok: true,
      status: result.status,
      headers: result.headers,
      contentType: result.contentType,
      body: result.buffer,
      truncated: result.truncated,
      finalUrl: url.toString(),
      hops,
    };
  }
}

module.exports = {
  guardedFetch,
  makeGuardedLookup,
  BlockedError,
  USER_AGENT,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
};
