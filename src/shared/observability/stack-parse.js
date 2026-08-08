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

/**
 * PARSED WITH STRING OPERATIONS, NOT REGEX — deliberately, and this is a
 * security fix rather than a style preference.
 *
 * The previous version used three regexes of the shape
 *
 *     /^\s*at\s+(?:async\s+)?(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/
 *
 * plus a `/^\s*(at\s|.*@)/` guard. Every one of them pairs a lazy `.+?` with an
 * adjacent `\s+` or `@`, which is textbook polynomial backtracking: on
 * `"at " + " ".repeat(4000)` the engine tries every split point and the match
 * degrades to O(n²). CodeQL flagged all four as "polynomial regular expression
 * used on uncontrolled data", and it was right about the "uncontrolled" part —
 * which is what makes this worth fixing rather than suppressing:
 *
 *   `POST /api/client-errors` IS UNAUTHENTICATED, BY DESIGN. A browser cannot
 *   present a token when the page it is on has just crashed, so the endpoint
 *   takes a `stack` string from anyone, rate-limited to 30/min and capped at
 *   4000 chars. Those caps bound the damage; they do not remove it. 4000 chars
 *   of crafted whitespace across 40 frames, 30 times a minute, is sustained
 *   quadratic work on a single-threaded event loop — and it lands on the ERROR
 *   REPORTING path, i.e. the one that exists to survive an incident and must
 *   never become one.
 *
 * Splitting on the known delimiters is linear, allocation-light, and reads more
 * plainly than the regexes did. The only regex left is anchored, bounded, and
 * runs on a string this module has already length-capped.
 */

/**
 * A frame longer than this is not a frame. The longest real one in this
 * codebase is ~140 chars; the cap is defence in depth behind the linear parser
 * rather than the thing holding the line.
 */
const MAX_FRAME_LEN = 512;

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

/**
 * Split a trailing `…:<line>:<col>` off a location.
 *
 * `lastIndexOf` twice rather than `/:(\d+):(\d+)$/`: an end-anchored regex with
 * two `\d+` groups still costs O(n²) on a string of colons, because the engine
 * retries from every start position. Two backward scans are O(n) and cannot be
 * made to behave otherwise.
 */
function splitPosition(loc) {
  const c2 = loc.lastIndexOf(":");
  if (c2 < 1) return null;
  const c1 = loc.lastIndexOf(":", c2 - 1);
  if (c1 < 1) return null;

  const line = Number(loc.slice(c1 + 1, c2));
  const col = Number(loc.slice(c2 + 1));
  if (!Number.isInteger(line) || !Number.isInteger(col)) return null;

  return { file: loc.slice(0, c1), line, col };
}

/**
 * One frame → `{ fn, file, line, col }`, or null.
 *
 * Handles the three V8 shapes and the Firefox/Safari `fn@url:1:2` form. Every
 * step is an indexOf, a slice or a trim; there is no backtracking anywhere.
 */
function parseLine(raw) {
  if (typeof raw !== "string") return null;
  // Cap BEFORE any scanning, so a pathological line costs one slice.
  const text = (raw.length > MAX_FRAME_LEN ? raw.slice(0, MAX_FRAME_LEN) : raw).trim();

  if (text.startsWith("at ")) {
    let rest = text.slice(3).trim();
    if (rest.startsWith("async ")) rest = rest.slice(6).trim();

    // "at fn (file:line:col)" — the location is inside the LAST parens, because
    // a function name may legitimately contain them (`Object.<anonymous>`).
    if (rest.endsWith(")")) {
      const open = rest.lastIndexOf("(");
      if (open > 0) {
        const pos = splitPosition(rest.slice(open + 1, -1));
        if (pos) return { fn: rest.slice(0, open).trim() || "(anonymous)", ...pos };
      }
    }
    // "at file:line:col" — anonymous frame.
    const pos = splitPosition(rest);
    return pos ? { fn: "(anonymous)", ...pos } : null;
  }

  // SpiderMonkey / JavaScriptCore: "fn@https://host/asset.js:12:34".
  const at = text.indexOf("@");
  if (at !== -1) {
    const pos = splitPosition(text.slice(at + 1));
    if (pos) return { fn: text.slice(0, at) || "(anonymous)", ...pos };
  }
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
    //
    // Was `/^\s*(at\s|.*@)/` — the `.*@` alternative is O(n²) on a line with no
    // `@`, and this runs on every line of an attacker-supplied stack. Two
    // linear string checks say the same thing; `parseLine` rejects anything
    // that gets past them.
    const t = raw.trimStart();
    if (!(t.startsWith("at ") || t.includes("@"))) continue;
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
