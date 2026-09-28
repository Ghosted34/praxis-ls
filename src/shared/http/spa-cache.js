/**
 * Cache headers for the built staff PWA (client/dist), served single-origin.
 *
 * THE RULE. Everything in dist/ is served with `max-age=1h` EXCEPT the three
 * files that decide which build a device is running. Those are `no-cache` —
 * "store it, but ask the server before using it" — so a deploy is visible the
 * moment it is live, on every device, through whatever sits in between.
 *
 *   sw.js            the service worker. The browser revalidates it on every
 *                    update check regardless of this header, but a CDN or
 *                    reverse proxy in front of us does not: one that honours
 *                    `max-age=3600` answers every device's update check with
 *                    the PREVIOUS build for up to an hour, and the "New version
 *                    available" toast cannot appear for a build the device has
 *                    never been shown.
 *   push-handler.js  pulled into sw.js by `importScripts`. Imported scripts DO
 *                    go through the HTTP cache (updateViaCache: "imports"), so a
 *                    change to push handling alone could sit unnoticed for an
 *                    hour — the byte-comparison that detects an update would
 *                    compare against the cached copy.
 *   index.html       the shell that names the hashed bundles. The SPA fallback
 *                    already sends it with max-age=0; this covers a direct
 *                    `/index.html` request going through express.static.
 *
 * The hashed files under assets/ keep their hour — their names change with
 * their bytes, so a stale copy is never asked for.
 */
"use strict";

const path = require("path");

const REVALIDATE_ALWAYS = new Set(["sw.js", "push-handler.js", "index.html"]);

/** `setHeaders` for express.static over client/dist. */
function setSpaCacheHeaders(res, filePath) {
  if (REVALIDATE_ALWAYS.has(path.basename(filePath))) {
    res.setHeader("Cache-Control", "no-cache");
  }
}

module.exports = { setSpaCacheHeaders, REVALIDATE_ALWAYS };
