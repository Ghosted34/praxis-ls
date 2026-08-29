"use strict";

/**
 * The Error Centre's explanation prompt is about THIS codebase.
 *
 * ── What went wrong, and why a test is the right answer ─────────────────────
 *
 * The prompt was copied verbatim from `doc/PROMPT_ErrorMonitor_Module.md` §7.4,
 * which opens "specializing in Node.js/NestJS debugging" — the spec was written
 * against an assumed stack. A real production notice (a 422 on
 * POST /api/tenant/mail/send) came back explained in terms of a `SendMailDto`,
 * a `MailModule`, class-validator decorators and a NestJS ValidationPipe. None
 * of them exist here, all of it read as authoritative, and the ops lead the
 * explanation is written for has no way to tell the difference.
 *
 * The fix was to tell the model what the codebase actually is. The RISK in that
 * fix is a brief that slowly stops being true — a description of the stack that
 * nobody re-reads is exactly the artefact that rots, and a rotted brief is the
 * same failure with a different accent.
 *
 * So every load-bearing claim in `services/ai/codebase-brief.js` is checked
 * here against the tree as committed. If someone adopts TypeORM, renames
 * `req.tenantDb`, or moves the error handler, this file fails and the brief
 * gets corrected with the change that made it wrong.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const brief = require("../../src/services/ai/codebase-brief");
const { CODEBASE_BRIEF, locateRoute, whereToLook } = brief;

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

describe("the brief describes the stack this repo actually has", () => {
  test("THE FRAMEWORKS IT RULES OUT ARE GENUINELY ABSENT", () => {
    // The whole incident in one assertion. If any of these ever arrives, the
    // brief is lying to the model and this is where that gets caught.
    const forbidden = ["@nestjs/core", "@nestjs/common", "class-validator", "class-transformer", "typeorm", "prisma", "@prisma/client", "sequelize", "mongoose"];
    for (const manifest of ["package.json", "client/package.json", "platform-console/package.json"]) {
      const pkg = JSON.parse(read(manifest));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const name of forbidden) {
        expect({ manifest, name, present: Boolean(deps[name]) }).toEqual({ manifest, name, present: false });
      }
    }
  });

  test("the runtime it names is the runtime that is installed", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.type).toBe("commonjs");
    expect(pkg.engines.node).toMatch(/20/);
    for (const dep of ["express", "zod", "pg", "bullmq"]) {
      expect(pkg.dependencies[dep]).toBeDefined();
    }
    // No ORM smuggled in beside `pg`.
    expect(CODEBASE_BRIEF).toContain("hand-written SQL");
  });

  test("the error contract it quotes is the one error-handler.js implements", () => {
    expect(exists("src/utils/errors.js")).toBe(true);
    const errors = read("src/utils/errors.js");
    expect(errors).toMatch(/class AppError/);
    expect(errors).toMatch(/constructor\(code, message, status = 400, details = null\)/);

    const handler = read("src/middleware/error-handler.js");
    // The three keys the brief promises a client will see.
    expect(handler).toMatch(/code: err\.code/);
    expect(handler).toMatch(/message: err\.message/);
    expect(handler).toMatch(/fields: err\.details/);
    // And the synthetic ValidationError the brief warns about, by name.
    expect(handler).toMatch(/ValidationError/);
    expect(handler).toMatch(/reportValidation/);
    expect(CODEBASE_BRIEF).toMatch(/SYNTHETIC/);
  });

  test("the two API namespaces it names are the two that are mounted", () => {
    const routes = read("src/routes/index.js");
    expect(routes).toMatch(/router\.use\("\/platform"/);
    expect(routes).toMatch(/router\.use\("\/tenant"/);
  });

  test("the request-scoped db helpers it names exist", () => {
    const ctx = read("src/middleware/tenant-context.js");
    expect(ctx).toMatch(/req\.tenantDb\s*=/);
    expect(ctx).toMatch(/req\.identityDb\s*=/);
  });

  test("A REAL MODULE FOLLOWS THE LAYOUT IT DESCRIBES", () => {
    // Named from the module the incident came from, so the example in the brief
    // and the example in production are the same shape.
    for (const suffix of ["routes", "controller", "service", "repo", "validator"]) {
      expect(exists(`src/modules/mail/mail/mail.${suffix}.js`)).toBe(true);
    }
    expect(read("src/modules/mail/mail/mail.validator.js")).toMatch(/require\("zod"\)/);
  });

  test("the front ends it names are where it says they are", () => {
    expect(exists("client/package.json")).toBe(true);
    expect(exists("platform-console/package.json")).toBe(true);
    expect(JSON.parse(read("client/package.json")).dependencies.react).toMatch(/18/);
  });
});

describe("the route hint points at code that exists", () => {
  test("resolves the route from the incident to the module that serves it", () => {
    expect(locateRoute("POST /api/tenant/mail/send")[0]).toBe("src/modules/mail/mail");
  });

  test("a namespace narrows an ambiguous name", () => {
    expect(locateRoute("GET /api/platform/errors/:id")).toEqual(["src/modules/platform/errors"]);
  });

  test("plural, kebab and compound names all land", () => {
    expect(locateRoute("GET /api/tenant/currencies")).toContain("src/modules/master/currency");
    expect(locateRoute("GET /api/tenant/chart-of-accounts")).toContain("src/modules/master/chart_of_accounts");
    expect(locateRoute("GET /api/tenant/clients")).toContain("src/modules/master/client_master");
  });

  test("SAYS NOTHING RATHER THAN GUESSING", () => {
    // The failure mode being fixed is confident invention. A hint that cannot
    // be resolved must be absent, not approximate.
    expect(locateRoute("GET /api/tenant/does-not-exist-anywhere")).toEqual([]);
    expect(whereToLook("GET /api/tenant/does-not-exist-anywhere")).toBeNull();
    expect(whereToLook("")).toBeNull();
  });

  test("every file it offers can be opened, and the conventional ones come first", () => {
    const hint = whereToLook("POST /api/tenant/mail/send");
    expect(hint).toMatch(/src\/modules\/mail\/mail\//);
    // Alphabetical order put access.js and autodiscover.js ahead of the
    // validator — the one file that held the fault in the reported incident.
    expect(hint).toMatch(/mail\.validator\.js/);
    const files = hint.split("\n").flatMap((line) => (line.split(" — ")[1] || "").split(", ").filter(Boolean));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(exists(path.join("src/modules/mail/mail", f.trim()))).toBe(true);
    }
  });

  test("every mounted route either resolves or is silent — never throws", () => {
    // The contract file is generated from the mounted routers, so this is the
    // real surface rather than a sample.
    const contract = JSON.parse(read("doc/api-contract.json"));
    const routes = Object.keys(contract.routes);
    expect(routes.length).toBeGreaterThan(100);
    let resolved = 0;
    for (const route of routes) {
      const dirs = locateRoute(route);
      expect(Array.isArray(dirs)).toBe(true);
      for (const dir of dirs) expect(exists(dir)).toBe(true);
      if (dirs.length) resolved += 1;
    }
    // Not a coverage target for its own sake: a hint on two thirds of routes is
    // the difference between a model that knows where to look and one that
    // invents a path. If a rename drops it below this, the index needs the
    // rename, not a lower number.
    expect(resolved / routes.length).toBeGreaterThan(0.66);
  });
});

describe("the prompt itself", () => {
  const svc = require("../../src/services/platform/error-explain.service");

  test("still asks for the four sections §7.1 specifies", () => {
    for (const bit of ["What happened", "Why it happened", "responsible", "Suggested fix"]) {
      expect(svc.SYSTEM_PROMPT).toContain(bit);
    }
  });

  test("NO LONGER TELLS THE MODEL THIS IS NESTJS", () => {
    expect(svc.SYSTEM_PROMPT).not.toMatch(/specializing in Node\.js\/NestJS/);
    expect(svc.SYSTEM_PROMPT).toContain("NOT NestJS");
    expect(svc.SYSTEM_PROMPT).toMatch(/Express/);
    expect(svc.SYSTEM_PROMPT).toMatch(/Zod/);
  });

  test("forbids inventing a file, in as many words", () => {
    expect(svc.SYSTEM_PROMPT).toMatch(/Never invent/);
  });

  test("the user turn carries the route's candidate location and no PII", () => {
    const ctx = svc.buildContext({
      name: "ValidationError",
      message: "VALIDATION_ERROR: bcc, cc",
      level: "notice",
      origin: "server",
      module: null,
      route: "POST /api/tenant/mail/send",
      file_path: null,
      occurrence_count: 3,
      first_seen: "2026-08-29T13:24:56.000Z",
      last_seen: "2026-08-29T13:25:47.000Z",
      stack_trace: [{ index: 0, file: null, line: null, function: "POST /send" }],
      // §11: `context` carries request_id, user_id and the browser URL. It is
      // not sent, and adding the location hint must not have changed that.
      context: { user_id: ACTOR_ID, request_id: "req_123", url: "https://smartls.praxisls.com/mail" },
    });

    expect(ctx).toContain("VALIDATION_ERROR: bcc, cc");
    expect(ctx).toContain("src/modules/mail/mail/");
    expect(ctx).toContain("mail.validator.js");
    expect(ctx).not.toContain("req_123");
    expect(ctx).not.toContain(ACTOR_ID);
    expect(ctx).not.toContain("praxisls.com");
  });
});
