"use strict";

/**
 * Every relative `require()` in src/ resolves to a file that exists.
 *
 * ── THE BUG THIS EXISTS TO CATCH, WHICH SHIPPED ────────────────────────────
 *
 * `smartcomm.service.js` sat at `src/modules/smartcomm/` — one level shallower
 * than every other notification caller, which lives at
 * `src/modules/<area>/<sub>/`. It carried that deeper layout's require:
 *
 *     require("../../notification/notification.service")
 *
 * From three levels that resolves to `src/notification/notification.service`,
 * a directory which has never existed. The line threw MODULE_NOT_FOUND — into
 * the best-effort catch that wraps every notify call, because a notification
 * failure must never fail the business operation that produced it. So Smart
 * Comms notified NOBODY for every message ever posted: no in-app row, no push,
 * no email, no error, no log line anyone read.
 *
 * Nothing else could have caught it. Lint does not resolve module paths, the
 * unit tests mocked the module by its correct path rather than driving the
 * producer, and the one integration-shaped test asserted a `notifyMany` call it
 * made itself. A lazy require inside a try/catch is invisible until someone
 * asks "does this actually notify?" — which is how this was found.
 *
 * Static resolution is the cheap half of that question, and it is the half that
 * generalises: any lazy require in a swallowing catch has the same failure
 * mode, and there are hundreds of them in this tree.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../src");

/** Every .js file under src/. */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(full, out);
    } else if (e.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Relative specifiers only. A bare specifier ("pg", "zod") is a dependency
 * question that `npm ci` already answers; a relative one is a claim about this
 * repository's own layout, which is what drifts when a file moves or a require
 * is copied between directories at different depths.
 *
 * Template literals are skipped — `require(\`./handlers/${name}\`)` has no one
 * answer to check. Those are rare here and none are in a notification path.
 */
const RELATIVE_REQUIRE = /require\(\s*["'](\.[^"']*)["']\s*\)/g;

/**
 * Blank out comments, preserving offsets so reported line numbers stay true.
 *
 * NOT cosmetic. This codebase documents heavily, and several files quote a
 * require in prose — `workers.js` carries a commented-out example queue,
 * `platform-mail.service.js` quotes the handler line while explaining a bug,
 * and `identity-cache.js` names the path two middlewares import it by. All
 * three are correct prose about paths that are deliberately not live code, and
 * a gate that fails on them is a gate someone deletes.
 *
 * String states are tracked so a `//` inside a literal — every URL in the tree
 * — does not swallow the rest of its line. Regex literals are not tracked: a
 * `require(` inside one would have to be written on purpose.
 */
function stripComments(src) {
  let out = "";
  let state = "code"; // code | line | block | sq | dq | tpl
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const next = src[i + 1];
    const keep = () => { out += c; };
    const blank = () => { out += c === "\n" ? "\n" : " "; };
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; blank(); continue; }
      if (c === "/" && next === "*") { state = "block"; blank(); continue; }
      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "`") state = "tpl";
      keep();
    } else if (state === "line") {
      if (c === "\n") { state = "code"; keep(); } else blank();
    } else if (state === "block") {
      if (c === "*" && next === "/") { out += "  "; i += 1; state = "code"; continue; }
      blank();
    } else {
      // Inside a string. A backslash escapes the next character, including the
      // quote that would otherwise close it.
      if (c === "\\") { out += c + (next ?? ""); i += 1; continue; }
      if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) {
        state = "code";
      }
      keep();
    }
  }
  return out;
}

describe("every relative require in src/ resolves", () => {
  const files = walk(ROOT);

  it("finds the files it is going to check", () => {
    // A walk that silently returned nothing would make the assertion below
    // vacuously pass, which is the one way this test could lie.
    expect(files.length).toBeGreaterThan(100);
  });

  it("has no unresolvable relative require", () => {
    const broken = [];
    for (const file of files) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      const dir = path.dirname(file);
      for (const m of src.matchAll(RELATIVE_REQUIRE)) {
        const spec = m[1];
        try {
          require.resolve(path.resolve(dir, spec));
        } catch {
          const line = src.slice(0, m.index).split("\n").length;
          broken.push(
            `${path.relative(ROOT, file)}:${line} → ${spec}`,
          );
        }
      }
    }
    // Named in the failure rather than counted: the whole point is that the
    // offending line is invisible at runtime, so the test has to print it.
    expect(broken).toEqual([]);
  });
});
