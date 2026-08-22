"use strict";
const fs = require("fs");
const path = require("path");

/**
 * NO TELEMETRY, ANYWHERE IN THE MAIL MODULE.
 *
 * §5.x / Q32: read/open tracking pixels and click-tracking link rewriting are
 * OUT. The first version of this test grepped three files by name — which
 * would stay green while a fourth outbound path (a new provider, a new
 * template, a signature variant) silently grew a pixel. The gate now walks
 * every source file in `src/modules/mail/`, so a new outbound path is covered
 * the day it is written, without anyone remembering to add it to a list.
 */
const MAIL_ROOT = path.resolve(__dirname, "../../src/modules/mail");

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(js|ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const FILES = walk(MAIL_ROOT);

// The three markers a tracking feature cannot avoid writing, in the spellings
// the codebase has used. Kept deliberately narrow so that a prohibition
// comment does not trip it; kept as a regex so `tracking_pixel` and
// `tracking-pixel` are both caught.
const BANNED = [/tracking[_-]?pixel/i, /open[_-]?rate/i, /rewrite(Link|Href)/i];

describe("no tracking pixel, no link rewriting — in any outbound mail path", () => {
  test("the gate is walking the module, not an empty directory", () => {
    expect(FILES.length).toBeGreaterThan(30);
    expect(FILES).toContain(path.join(MAIL_ROOT, "mail", "compose.js"));
    expect(FILES).toContain(path.join(MAIL_ROOT, "signature", "signature.html.js"));
  });

  test.each(FILES.map((f) => [path.relative(MAIL_ROOT, f), f]))(
    "%s contains no pixel, open-rate or link-rewrite markers",
    (_rel, file) => {
      const src = fs.readFileSync(file, "utf8");
      for (const re of BANNED) {
        expect(src).not.toMatch(re);
      }
    },
  );
});
