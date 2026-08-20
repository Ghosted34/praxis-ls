/**
 * Notes never leave the building. compose.js has no notes import; the quoted
 * history builder reads email_message only.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../src/modules/mail");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

describe("internal notes cannot be sent", () => {
  test("compose.js does not require the notes table or notes service", () => {
    const src = fs.readFileSync(path.join(ROOT, "mail/compose.js"), "utf8");
    expect(src).not.toMatch(/email_thread_note/);
    expect(src).not.toMatch(/notes\.service/);
  });

  test("no outbound path reads email_thread_note into a body", () => {
    const files = [
      path.join(ROOT, "mail/compose.js"),
      path.join(ROOT, "mail/outbox.service.js"),
      path.join(ROOT, "mail/mail.service.js"),
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(src).not.toMatch(/FROM email_thread_note/);
      expect(src).not.toMatch(/email_thread_note.*body_html/);
    }
  });

  test("the notes module is the only reader of that table under mail/", () => {
    const offenders = [];
    for (const f of walk(ROOT)) {
      if (f.endsWith("notes.service.js")) continue;
      const src = fs.readFileSync(f, "utf8");
      if (/FROM email_thread_note/.test(src)) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders).toEqual([]);
  });
});
