/**
 * Stack-trace parsing for the Error Command Center.
 *
 * Spec §3.2 renders a numbered call chain, and acceptance criterion #2 is
 * "exact module and line number clearly identified". Both need the raw `stack`
 * string turned into structured frames, and neither is satisfied by storing the
 * blob and letting the browser regex it — the module is also what §3.4's module
 * filter groups by, so it has to exist server-side as a column.
 *
 * Handles the three shapes V8 actually emits:
 *   "    at fn (/app/src/modules/x/y.service.js:89:14)"
 *   "    at /app/src/modules/x/y.service.js:89:14"        (anonymous)
 *   "    at async fn (/app/.../y.js:89:14)"
 * plus the browser's Firefox/Safari form "fn@https://host/assets/x.js:1:2",
 * because §2.3 point 3 routes window.onerror through the same sink and those
 * stacks do not look like V8's.
 *
 * Everything here is deliberately total: a stack that cannot be parsed yields
 * an empty frame list rather than throwing. This runs inside the error path, so
 * a parser bug must not be able to escalate a handled 500 into a crash.
 */

"use strict";

/** Frames from node internals / dependencies are noise in a call chain. */
const VENDOR = /[\\/](node_modules|internal)[\\/]|^node:/;

const V8_NAMED = /^\s*at\s+(?:async\s+)?(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/;
const V8_BARE = /^\s*at\s+(?:async\s+)?(.+?):(\d+):(\d+)\s*$/;
const SPIDERMONKEY = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;

/**
 * Reduce an absolute path to the repo-relative form the spec's mockups show
 * ("src/modules/shipments/shipment.controller.ts"). Container paths are
 * /app/src/... and dev paths are C:\Users\...\praxis-ls\src\..., so anchoring on
 * the first "src/" segment normalises both without knowing the deploy root.
 */
function relativise(file) {
  if (!file) return null;
  const norm = String(file).replace(/\\/g, "/").replace(/^file:\/\//, "");
  const i = norm.lastIndexOf("/src/");
  if (i !== -1) return norm.slice(i + 1);
  // Browser bundles: keep the asset path, drop scheme+host and any cache-buster.
  const m = norm.match(/^https?:\/\/[^/]+\/(.+)$/);
  if (m) return m[1].split("?")[0];
  return norm;
}

/**
 * Which product module owns this frame.
 *
 * The backend's layout is src/modules/<group>/<module>/<module>.service.js and
 * also src/modules/<module>/<module>.controller.js, so the segment after
 * "modules" is the group for nested ones and the module for flat ones. The
 * deepest named directory is the better label in both cases — "shipments"
 * rather than "logistics" — which is what §3.1's cards display.
 */
function moduleOf(relPath) {
  if (!relPath) return null;
  const parts = relPath.split("/").filter(Boolean);
  const mi = parts.indexOf("modules");
  if (mi !== -1 && parts.length > mi + 1) {
    // Last directory before the filename, bounded to the modules subtree.
    const dirs = parts.slice(mi + 1, -1);
    if (dirs.length) return dirs[dirs.length - 1];
    return parts[mi + 1].replace(/\.[jt]sx?$/, "");
  }
  // src/services/platform/db.js -> "platform"; src/jobs/handlers/x.js -> "handlers"
  for (const anchor of ["services", "jobs", "middleware", "realtime", "shared", "features"]) {
    const ai = parts.indexOf(anchor);
    if (ai !== -1) {
      const dirs = parts.slice(ai + 1, -1);
      return dirs.length ? dirs[dirs.length - 1] : anchor;
    }
  }
  return parts.length > 1 ? parts[parts.length - 2] : null;
}

function parseLine(line) {
  let m = V8_NAMED.exec(line);
  if (m) return { fn: m[1], file: m[2], line: +m[3], col: +m[4] };
  m = V8_BARE.exec(line);
  if (m) return { fn: "(anonymous)", file: m[1], line: +m[2], col: +m[3] };
  m = SPIDERMONKEY.exec(line);
  if (m) return { fn: m[1] || "(anonymous)", file: m[2], line: +m[3], col: +m[4] };
  return null;
}

/**
 * @param {string} stack raw Error.stack
 * @returns {{frames: Array, primary: object|null}}
 *   `frames` are ordered outermost-last, exactly as thrown, each with
 *   `{ index, function, file, line, column, module, vendor }`.
 *   `primary` is the first non-vendor frame — the one worth putting on the card.
 */
function parseStack(stack) {
  if (!stack || typeof stack !== "string") return { frames: [], primary: null };

  const frames = [];
  for (const raw of stack.split("\n")) {
    // The first line is "Name: message", not a frame.
    if (!/^\s*(at\s|.*@)/.test(raw)) continue;
    const p = parseLine(raw);
    if (!p) continue;
    const file = relativise(p.file);
    frames.push({
      index: frames.length + 1,
      function: p.fn,
      file,
      line: p.line,
      column: p.col,
      module: moduleOf(file),
      vendor: VENDOR.test(p.file),
    });
    // §10 budgets 100ms for this and the drawer shows a call chain, not a novel.
    if (frames.length >= 40) break;
  }

  // Our code is what a reader can act on; a frame inside pg or express is not
  // where the bug is. Falling back to frames[0] matters for errors thrown
  // entirely inside a dependency — those still need a primary location.
  const primary = frames.find((f) => !f.vendor) || frames[0] || null;
  return { frames, primary };
}

module.exports = { parseStack, relativise, moduleOf };
