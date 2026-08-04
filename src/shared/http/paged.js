"use strict";
/**
 * Send one page of a list plus the true match count.
 *
 * The response BODY is unchanged — still `{ data: [...] }`, a bare array of
 * rows — so every existing consumer keeps working. The count rides along as the
 * `X-Total-Count` header, which is what lets a client render real pagination
 * instead of silently displaying the first 50 rows and filtering those.
 *
 * That silent truncation was a live data-visibility bug: `page()` clamps every
 * list to 50, and the Finance hub filtered the truncated set in the browser, so
 * it reported "No invoices match" for invoices that existed further down.
 *
 * Note for cross-origin callers: a custom response header is invisible to
 * browser JS unless CORS advertises it. `X-Total-Count` is listed in
 * `exposedHeaders` in src/server.js — if you add another such header, add it
 * there too or the client will read `null` and never know why.
 *
 * @example
 * list: asyncHandler(async (req, res) =>
 *   sendPaged(res, await req.tenantDb((c) => service.listPaged(c, req.query)))),
 */
function sendPaged(res, { rows, total }) {
  res.set("X-Total-Count", String(total));
  return res.json({ data: rows });
}

module.exports = { sendPaged };
