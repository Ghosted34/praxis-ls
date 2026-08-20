"use strict";
const fs = require("fs");
const path = require("path");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(js|ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("no tracking pixel, no link rewriting", () => {
  test("outbound mail paths do not inject a tracking pixel or rewrite hrefs", () => {
    const files = [
      path.resolve(__dirname, "../../src/modules/mail/mail/compose.js"),
      path.resolve(__dirname, "../../src/modules/mail/mail/outbox.service.js"),
      path.resolve(__dirname, "../../src/modules/mail/signature/signature.html.js"),
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(src).not.toMatch(/tracking[_-]?pixel/i);
      expect(src).not.toMatch(/open[_-]?rate/i);
      expect(src).not.toMatch(/rewrite(Link|Href)/i);
    }
  });
});
