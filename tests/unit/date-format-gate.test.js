"use strict";

/**
 * The day-first date gate — `scripts/check-date-format.js`.
 *
 * A month-first date is the hardest kind of defect to catch by testing the
 * PRODUCT: 03/07/2026 parses, renders and round-trips perfectly under either
 * reading, so every existing suite stays green while the operator reads the
 * wrong day. The gate is what closes that, which makes the gate's own judgement
 * the thing worth pinning.
 *
 * Two ways for it to be worthless, and BOTH happened while it was being
 * written — which is why they are the two halves of this file:
 *
 *   · It passes vacuously. The first draft blanked string bodies before
 *     scanning, so `type="date"` and `"en-US"` — which only ever appear inside
 *     strings — were invisible, and it reported a clean tree over live
 *     violations. A gate that cannot fail is worse than no gate, because it is
 *     believed. The second draft desynced its scanner on the regex literal
 *     `/^["'](en-US)["']$/` and swallowed the rest of the file, the same
 *     failure by a different route.
 *   · It cries wolf. Money is formatted with `toLocaleString("en-US", …)` all
 *     over this codebase and is not a date; `{ month: "long" }` is a month NAME
 *     with no order in it. Flag those and the gate gets switched off.
 */

const { scanSource, blankNonCode, orderSensitive } = require("../../scripts/check-date-format");

const rules = (src, rel = "client/src/x.tsx") => scanSource(src, rel).map((p) => p.rule);

describe("what the gate must SEE", () => {
  it("flags a native date input — the control it exists to eliminate", () => {
    expect(rules('<Input type="date" value={x} onChange={f} />')).toEqual(["native-date-input"]);
    expect(rules("<input type='date' />")).toEqual(["native-date-input"]);
  });

  it("flags a date format with no locale pinned", () => {
    // Nothing here says en-US, which is exactly the problem: it says nothing,
    // so the machine decides, and a US-configured machine decides month-first.
    expect(rules("const s = new Date(x).toLocaleDateString();")).toEqual(["floating-locale"]);
    expect(rules('d.toLocaleDateString(undefined, { day: "numeric", month: "short" });')).toEqual(["floating-locale"]);
    expect(rules('d.toLocaleDateString([], { day: "numeric", month: "short" });')).toEqual(["floating-locale"]);
    expect(rules('new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(d);')).toEqual(["floating-locale"]);
  });

  it("flags a month-first locale written out", () => {
    expect(rules('d.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" });'))
      .toEqual(["month-first-locale"]);
    expect(rules('new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit" }).format(d);'))
      .toEqual(["month-first-locale"]);
  });

  it("flags the format written out as a literal, in either case", () => {
    expect(rules('const FMT = "MM/DD/YYYY";')).toEqual(["month-first-literal"]);
    expect(rules('const hint = "mm/dd/yyyy";')).toEqual(["month-first-literal"]);
  });

  it("sees INTO strings — the blind spot that made an early draft report green", () => {
    // Every pattern this gate bans lives inside a string literal. A scanner that
    // blanks string bodies before matching finds none of them and says so.
    expect(blankNonCode('const a = "type=\\"date\\"";')).toContain("type=");
    expect(rules('const attrs = \'type="date"\';')).toEqual(["native-date-input"]);
  });

  it("does not desync on a regex literal carrying quote characters", () => {
    // `/^["'](en-US)["']$/` holds two quotes. Read as string delimiters they
    // swallow everything after, and the violation below goes unreported.
    const src = [
      'const RE = /^["\'](en-US|en)["\']$/;',
      'const s = new Date(x).toLocaleDateString();',
    ].join("\n");
    expect(rules(src)).toEqual(["floating-locale"]);
  });
});

describe("what the gate must stay QUIET about", () => {
  it("ignores money and plain numbers", () => {
    // `toLocaleString` is a Number method too, and this codebase formats every
    // amount with it. en-US is correct there — it is a decimal mark, not a date.
    expect(rules('n.toLocaleString("en-US", { minimumFractionDigits: 2 });')).toEqual([]);
    expect(rules("Number(x).toLocaleString();")).toEqual([]);
    expect(rules("v.toLocaleString(currentLocale(), { maximumFractionDigits: 0 });")).toEqual([]);
  });

  it("ignores a month NAME, which has no order to get wrong", () => {
    expect(rules('new Date(2000, i, 1).toLocaleString("en", { month: "long" });')).toEqual([]);
    expect(rules('d.toLocaleDateString("en-US", { weekday: "long" });')).toEqual([]);
  });

  it("ignores a time", () => {
    expect(rules('d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });')).toEqual([]);
  });

  it("ignores a day-first or app-controlled locale", () => {
    expect(rules('d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });')).toEqual([]);
    expect(rules('d.toLocaleDateString(dateLocale(), { day: "2-digit", month: "short" });')).toEqual([]);
    expect(rules('new Intl.DateTimeFormat("en-CA", { day: "2-digit" }).formatToParts(d);')).toEqual([]);
  });

  it("ignores prose — a guide that names the ban must not BE the violation", () => {
    expect(rules('// never write mm/dd/yyyy, and never use type="date"')).toEqual([]);
    expect(rules('/* the OS locale renders mm/dd/yyyy for <input type="date"> */')).toEqual([]);
  });
});

describe("the two ways out, both of which cost a reason", () => {
  it("honours a marker on the line itself", () => {
    expect(rules('new Intl.DateTimeFormat("en-US", { day: "2-digit" }); // @date-format:parts tz math'))
      .toEqual([]);
  });

  it("honours a marker in the comment BLOCK above, reason and all", () => {
    // The reason is the point of the marker, and a reason worth reading rarely
    // fits beside the code. Continuation lines of a /* … */ block start with no
    // `*` and no `//`, so the waiver search reads the comment mask, not a regex.
    const src = [
      "/* @date-format:foreign — the bank sends its statements month-first and",
      "   refusing to parse that does not make the statement day-first. */",
      'const BANK_FMT = "MM/DD/YYYY";',
    ].join("\n");
    expect(rules(src)).toEqual([]);
  });

  it("does not let a waiver drift up past real code onto a later line", () => {
    const src = [
      "// @date-format:parts this excuses the line under it, nothing more",
      "const unrelated = 1;",
      'const FMT = "MM/DD/YYYY";',
    ].join("\n");
    expect(rules(src)).toEqual(["month-first-literal"]);
  });

  it("still bans a native date control inside an allowlisted file", () => {
    // The bank-import module may name MM/DD/YYYY — that is somebody else's
    // file format. It may not put a month-first CONTROL in front of an operator.
    const rel = "src/modules/master/reconciliation/reconciliation.rules.js";
    expect(scanSource('<Input type="date" />', rel).map((p) => p.rule)).toEqual(["native-date-input"]);
  });
});

describe("order-sensitivity, the judgement the whole gate rests on", () => {
  it("treats absent options as order-sensitive — the default IS numeric d/m/y", () => {
    expect(orderSensitive("")).toBe(true);
    expect(orderSensitive('"en-US"')).toBe(true);
  });

  it("treats a day number beside a month as order-sensitive", () => {
    expect(orderSensitive('"en-US", { day: "numeric", month: "short" }')).toBe(true);
    expect(orderSensitive('"en-US", { dateStyle: "short" }')).toBe(true);
  });

  it("treats a name-only or time-only format as safe", () => {
    expect(orderSensitive('"en", { month: "long" }')).toBe(false);
    expect(orderSensitive('"en-US", { hour: "2-digit", minute: "2-digit" }')).toBe(false);
  });
});

describe("the day-first twins", () => {
  const fs = require("fs");
  const path = require("path");
  const { TWINS } = require("../../scripts/check-date-format");
  const root = path.join(__dirname, "..", "..");

  it("declares the pair that has to stay identical", () => {
    expect(TWINS).toContainEqual([
      "client/src/lib/day-first-date.ts",
      "platform-console/src/lib/day-first-date.ts",
    ]);
  });

  it.each(TWINS)("%s and %s are byte-identical", (a, b) => {
    // Not an import, a COPY — and this is what keeps it honest. The Dockerfile's
    // console stage copies only platform-console/, so a relative import into
    // client/ resolves in a checkout, passes `vite build` locally, and then
    // fails inside the image. It did exactly that, which is why this exists.
    expect(fs.readFileSync(path.join(root, b), "utf8")).toBe(
      fs.readFileSync(path.join(root, a), "utf8"),
    );
  });

  it("keeps the copy free of imports, so it cannot drift through its surroundings", () => {
    for (const [a] of TWINS) {
      expect(fs.readFileSync(path.join(root, a), "utf8")).not.toMatch(/^\s*import\s/m);
    }
  });
});

describe("datetime-local — the same defect with a different `type`", () => {
  it("flags a native datetime-local control", () => {
    // It renders its DATE part in the OS locale exactly as type="date" does.
    // The first version of this gate missed every one of these because it
    // matched the attribute VALUE "date" and nothing else.
    expect(rules('<Input type="datetime-local" value={v} onChange={f} />'))
      .toEqual(["native-date-input"]);
  });

  it("points at DateTimeField rather than DateField for one", () => {
    const [hit] = scanSource('<Input type="datetime-local" />', "client/src/x.tsx");
    expect(hit.hint).toContain("DateTimeField");
  });

  it("leaves type=\"month\" alone — there is no day in it to misorder", () => {
    expect(rules('<Input type="month" value={period} onChange={f} />')).toEqual([]);
  });
});

describe("ISO dates where a person reads them", () => {
  const DOC = "src/services/documents/templates/registry.js";
  const SHEET = "src/services/spreadsheet/build.js";

  it("flags an ISO number format in a spreadsheet column", () => {
    expect(scanSource('return { fmt: "yyyy-mm-dd" };', SHEET).map((p) => p.rule))
      .toEqual(["iso-date-on-paper"]);
  });

  it("flags an ISO day sliced into a document template", () => {
    expect(scanSource("const d = dt.toISOString().slice(0, 10);", DOC).map((p) => p.rule))
      .toEqual(["iso-date-on-paper"]);
  });

  it("does NOT flag ISO anywhere else — it is the wire format", () => {
    // This is the rule's whole discipline. ISO is what the API contract, the
    // @shared validators and every `date` column are built on; a gate that
    // discouraged it generally would be telling people to break the product.
    expect(rules("const today = new Date().toISOString().slice(0, 10);")).toEqual([]);
    expect(scanSource('const q = { from: "2026-01-01" };', "src/modules/x/y.js")).toEqual([]);
    expect(scanSource("t.toISOString().slice(0, 10)", "src/modules/x/y.repo.js")).toEqual([]);
  });

  it("lets a FILENAME keep its ISO stamp, with the reason", () => {
    // "/" is a path separator: "export-11/09/2026.csv" is not a filename. ISO is
    // also what makes a folder of exports sort chronologically.
    const src = [
      "/* @date-format:filename — `/` is not legal in a filename, and ISO is",
      "   what makes a folder of exports sort. */",
      "const stamp = date.toISOString().slice(0, 10);",
    ].join("\n");
    expect(scanSource(src, "src/services/spreadsheet/helpers.js")).toEqual([]);
  });
});

describe("the live tree", () => {
  it("passes its own gate", () => {
    // The gate is only worth having if the repository actually satisfies it —
    // and this is what stops the allowlist quietly growing to cover new code.
    const { execFileSync } = require("child_process");
    const path = require("path");
    expect(() =>
      execFileSync("node", [path.join(__dirname, "..", "..", "scripts", "check-date-format.js")], {
        encoding: "utf8",
      }),
    ).not.toThrow();
  });
});
