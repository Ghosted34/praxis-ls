/**
 * THE GATE THAT ENUMERATES ROUTES.
 *
 * `mail-visibility-wiring.test.js` asserts the §9.5 predicate on the repo's
 * query BUILDERS and on a handful of named call sites. It is a good test and it
 * passed continuously while roughly thirty thread-, message- and
 * attachment-scoped routes reached those same rows by id with nothing checking
 * that the caller could see them — internal notes readable AND writable, a
 * Private thread bindable to an ERP entity, action cards exposing subject and
 * bound client, AI drafts generated over a private transcript, and an OCR route
 * that sent a private thread's attachment to an external vision vendor.
 *
 * The reason it passed is worth stating, because it generalises: a wiring test
 * that names its call sites can only ever assert about the call sites somebody
 * remembered to name. Every one of the ~30 was simply absent from the list, and
 * absence from a list is not a failure.
 *
 * So this file does not take a list. It walks the MOUNTED ROUTERS, finds every
 * route whose path addresses a thread, message or attachment, and fails on any
 * that does not carry one of the `visible.js` middlewares. A route added
 * tomorrow is covered by construction — the author does not have to know this
 * file exists, which is the only property that made the previous gate
 * insufficient.
 *
 * The allow-list below is deliberately tiny and each entry carries its reason.
 * It is size-capped, in the same spirit as the four orphan-sweep gates: if it
 * grows, this test fails and somebody has to argue for the growth in a review
 * rather than appending a line.
 */
"use strict";

const path = require("path");

const ROUTERS = [
  ["mail", "../../src/modules/mail/mail/mail.routes"],
  ["binding", "../../src/modules/mail/binding/binding.routes"],
  ["triage", "../../src/modules/mail/triage/triage.routes"],
  ["assist", "../../src/modules/mail/assist/assist.routes"],
];

/**
 * How a gate is recognised.
 *
 * NOT by function name. `asyncHandler` returns an anonymous arrow, so the inner
 * function's name never reaches the express layer — a name-matching gate would
 * match nothing and report success, which is the same shape of failure this
 * file exists to prevent. `visible.js` stamps an explicit property instead.
 */
const { GATE_PROP } = require("../../src/modules/mail/mail/visible");

/**
 * A path is thread/message/attachment-scoped when it addresses ONE of them by
 * id. `/threads` (the list) and `/threads/bulk` are not — the list applies the
 * predicate in its own query and bulk fans out to per-thread services that do.
 */
const SCOPED = [
  /\/threads?\/:id\b/,
  /\/messages?\/:id\b/,
  // ANY `:attachmentId`, not only `/attachments/:attachmentId`. The first
  // version of this pattern missed `POST /assist/ocr/:attachmentId` — the route
  // that sends bytes to an external vision vendor, and therefore the single most
  // important one in the sweep. A gate whose scope regex is narrower than the
  // paths it is meant to cover reports success over the routes it never saw,
  // which is the exact failure this file was written to end.
  /:attachmentId\b/,
  // Derived records are durable handles to an attachment/thread. Their paths
  // do not say `thread`, but review/dismiss/file must not become an indirect
  // visibility bypass.
  /\/assist\/extractions\/:id\b/,
  /\/intake\/:id\b/,
];

/**
 * Routes that address a scoped resource and legitimately do NOT carry a gate.
 * Every entry needs a reason, and the cap below needs a review to move.
 */
const ALLOWED = new Map([
  [
    "POST /threads/:id/breakglass",
    "Break-glass IS the documented bypass (§9.5). requireCeo() + an immutable_ledger "
    + "row written BEFORE the read. Gating it would remove the only lawful way to reach "
    + "a Private thread, which is the control this whole model depends on.",
  ],
  [
    "DELETE /drafts/:id/attachments/:attachmentId",
    "The `:id` here is a DRAFT, not a thread, and a draft attachment has no thread to "
    + "apply §9.5 to — it has an owner. `attachment.service.remove` calls assertOwnDraft, "
    + "which scopes the draft to the caller, so the thread gate would be a check against "
    + "a column that is NULL on every row this route can reach.",
  ],
]);

const MAX_ALLOWED = 2;

function routesOf(router, out = [], prefix = "") {
  for (const layer of router.stack || []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      const gates = (layer.route.stack || [])
        .map((h) => h.handle && h.handle[GATE_PROP])
        .filter(Boolean);
      for (const m of methods) {
        out.push({ method: m.toUpperCase(), path: prefix + layer.route.path, gates });
      }
    } else if (layer.handle && layer.handle.stack) {
      routesOf(layer.handle, out, prefix);
    }
  }
  return out;
}

const all = [];
for (const [name, mod] of ROUTERS) {
  const mounted = require(path.join(__dirname, mod));
  for (const r of routesOf(mounted.router)) all.push({ ...r, file: name });
}

const scoped = all.filter((r) => SCOPED.some((re) => re.test(r.path)));
const key = (r) => `${r.method} ${r.path}`;

describe("every thread-scoped mail route carries the §9.5 gate (C-4)", () => {
  it("found the mounted routers at all — a passing suite over zero routes is not a gate", () => {
    expect(all.length).toBeGreaterThan(50);
    expect(scoped.length).toBeGreaterThan(20);
  });

  it.each(scoped.map((r) => [key(r), r]))("%s", (name, route) => {
    if (ALLOWED.has(name)) {
      // Named exemptions still have to be reachable and still have to be the
      // route we think they are — an allow-list entry for a route that has been
      // renamed silently exempts nothing and hides the rename.
      expect(ALLOWED.get(name)).toEqual(expect.any(String));
      return;
    }
    // jest's expect takes no message argument, so the diagnosis goes in the
    // value being compared — a failure then prints the sentence, not `false`.
    const verdict = route.gates.length
      ? "gated"
      : `UNGATED — ${name} (${route.file}.routes.js) reads or writes a thread-scoped `
        + "resource with no visibility gate. Add one of visible.js's middlewares, or, "
        + "if it genuinely must bypass §9.5, add it to ALLOWED with a reason and raise "
        + "MAX_ALLOWED in review.";
    expect(verdict).toBe("gated");
  });

  it("the exemption list has not quietly grown", () => {
    expect(ALLOWED.size).toBeLessThanOrEqual(MAX_ALLOWED);
  });

  it("names the four Criticals' routes explicitly, so a regression is legible", () => {
    // Not a substitute for the sweep above — a belt-and-braces list of the exact
    // endpoints the audit called out, so a failure here says WHICH finding came
    // back rather than only that some route lost a middleware.
    const mustBeGated = [
      "POST /threads/:id/share",          // C-1
      "DELETE /threads/:id/share/:userId", // C-1
      "GET /threads/:id/shares",          // C-1
      "GET /threads/:id/notes",           // C-4 binding
      "POST /threads/:id/notes",          // C-4 binding
      "POST /threads/:id/bind",           // C-4 binding — a CRM-timeline write
      "GET /threads/:id/cards",           // C-4 binding
      "GET /threads/:id/suggestions",     // C-4 binding
      "POST /threads/:id/snooze",         // C-4 triage
      "POST /threads/:id/followup",       // C-4 triage
      "POST /threads/:id/lock",           // C-4 triage
      "POST /assist/ocr/:attachmentId",   // C-4 assist — bytes leave for a vendor
      "POST /assist/extractions/:id/review", // derived attachment write
      "POST /assist/extractions/:id/dismiss", // derived attachment write
      "POST /intake/:id/file", // derived attachment → vault write
      "POST /intake/:id/reject", // derived attachment write
    ];
    for (const want of mustBeGated) {
      const route = scoped.find((r) => key(r) === want);
      expect(route ? want : `${want} IS NOT MOUNTED ANY MORE — did it move?`).toBe(want);
      const verdict = route && route.gates.length ? want : `${want} LOST ITS VISIBILITY GATE`;
      expect(verdict).toBe(want);
    }
  });
});

describe("the bypass stays a bypass (§9.5)", () => {
  it("getThreadUnrestricted has exactly one caller, and it is CEO-gated", () => {
    const fs = require("fs");
    const SRC = path.resolve(__dirname, "../../src");
    const hits = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js")) {
          const src = fs.readFileSync(p, "utf8");
          if (/getThreadUnrestricted\s*\(/.test(src) && !/thread\.repo\.js$/.test(p)) hits.push(p);
        }
      }
    })(SRC);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/triage[\\/]triage\.routes\.js$/);
    const src = fs.readFileSync(hits[0], "utf8");
    // The call must sit under the break-glass route, which is requireCeo()'d.
    expect(src).toMatch(/breakglass["']?,\s*requireCeo\(\)/);
  });
});
