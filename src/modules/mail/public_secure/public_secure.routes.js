/**
 * The public face of a secure link (§9.4).
 *
 * Unauthenticated by design — the token IS the authorisation — which is why
 * everything here is deliberately unhelpful to anyone not already holding one:
 *
 *  · rate-limited, so a token cannot be guessed at volume;
 *  · `X-Robots-Tag: noindex`, so a forwarded link never reaches a search index;
 *  · no directory listing, and no endpoint that enumerates anything;
 *  · expired, revoked and never-existed all answer the SAME 404 with the SAME
 *    words. Telling an anonymous caller which of the three applies tells them
 *    whether a document was ever there.
 *
 * ── IT NOW SERVES THE DOCUMENT ──────────────────────────────────────────────
 *
 * This route used to return `{ label, target_kind, expires_at }` and stop: the
 * recipient got a JSON description of a file they could not have, no
 * `secure_link_view` row was ever written, and nothing reached the CRM
 * timeline — which §9.4 calls "the ONLY open signal in the product" and the
 * reason Q32 could drop open tracking at no commercial cost.
 *
 * Two paths, because they answer different questions: `GET /` is metadata for
 * the viewer page, `GET /download` is the bytes. The VIEW is recorded on the
 * metadata call, since reaching the page is the signal worth putting on a
 * timeline; whether the recipient then clicked Save is not the interesting part.
 */
"use strict";

const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { asyncHandler, AppError } = require("../../../utils/errors");
const links = require("../triage/secure-link.service");

const router = express.Router();

/**
 * 60 per 15 minutes per IP. Generous for a person opening a link a few times
 * and re-downloading; hopeless for anyone walking a 256-bit token space.
 */
const limit = makeLimiter({ name: "secure-link-public", max: 60, windowMs: 15 * 60 * 1000 });

/** Everything here is uncacheable and unindexable. */
function publicHeaders(res) {
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.set("Cache-Control", "no-store, max-age=0");
  res.set("Referrer-Policy", "no-referrer");
}

/** The same opaque answer for every reason a link will not open. */
const gone = () => new AppError("NOT_FOUND", "This link has expired or been revoked.", 404);

/**
 * The caller's address, for the view record.
 *
 * `req.ip` respects the app's trust-proxy setting; the raw socket address is
 * the fallback so a misconfigured proxy records something real rather than
 * nothing. Express reports IPv4-mapped IPv6 as `::ffff:1.2.3.4` — `inet`
 * accepts it, but the plain form is what an operator expects to read.
 */
function clientIp(req) {
  const raw = req.ip || (req.socket && req.socket.remoteAddress) || null;
  return raw ? String(raw).replace(/^::ffff:/, "") : null;
}

router.get("/:token", limit, asyncHandler(async (req, res) => {
  publicHeaders(res);
  const row = await req.tenantDbIn("live", (c) => links.resolve(c, req.params.token));

  const target = await req.tenantDbIn("live", (c) => links.open(c, row, {
    ip: clientIp(req),
    userAgent: req.get("user-agent"),
  })).catch((err) => {
    // A vault document not yet rendered answers 409 internally; outwardly it is
    // the same 404 as a bad token, per the header comment.
    if (err && err.status === 409) throw gone();
    throw err;
  });

  return res.json({
    data: {
      label: row.label,
      target_kind: row.target_kind,
      expires_at: row.expires_at,
      filename: target.filename || null,
      content_type: target.content_type || null,
      size_bytes: target.size_bytes || null,
      download_path: `/public/secure/${req.params.token}/download`,
    },
  });
}));

/**
 * The bytes.
 *
 * Sent as an attachment under the original filename, sanitised first — a name
 * arriving from a vault row is not hostile today, but a response header is the
 * wrong place to find out otherwise.
 */
router.get("/:token/download", limit, asyncHandler(async (req, res) => {
  publicHeaders(res);
  const row = await req.tenantDbIn("live", (c) => links.resolve(c, req.params.token));
  const target = await req.tenantDbIn("live", (c) => links.fetchTarget(c, row)).catch((err) => {
    if (err && err.status === 409) throw gone();
    throw err;
  });

  if (!target.buffer) throw gone();

  const safe = String(target.filename || "document").replace(/[^\w. -]+/g, "_").slice(0, 120);
  res.set("Content-Type", target.content_type || "application/octet-stream");
  res.set("Content-Disposition", `attachment; filename="${safe}"`);
  res.set("Content-Length", String(target.buffer.length));
  return res.send(target.buffer);
}));

module.exports = { basePath: "/public/secure", feature: null, idParam: "text", router };
