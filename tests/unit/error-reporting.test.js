"use strict";

/**
 * OBS-E1 (no centralised error tracking) and OBS-E2 (frontend errors
 * completely invisible) — both Critical, both closed by one sink.
 *
 * Before this, a 500 produced a log line on a box whose logs are not shipped
 * and are wiped on every deploy, and a browser exception produced nothing at
 * all. "What broke this week" was unanswerable.
 *
 * The assertions that matter most are the NEGATIVE ones. An alert channel that
 * fires on 404s, or floods on a render loop, gets muted within a week — and a
 * muted channel is indistinguishable from the state we started in. Dedupe, the
 * rate ceiling, and "4xx must never page anyone" are the difference between
 * error tracking and noise.
 */

const http = require("http");
const express = require("express");
const request = require("supertest");

const REPORTER = "../../src/shared/observability/error-reporter";

let hook;
let received;
let port;

beforeAll(async () => {
  received = [];
  hook = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try { received.push(JSON.parse(body).praxis); } catch { /* ignore */ }
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise((r) => hook.listen(0, r));
  port = hook.address().port;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
});

afterAll(() => new Promise((r) => hook.close(r)));

/**
 * `report()` persists before it dedupes (see error-reporter's comment on why),
 * and `persist()` arms a 2s flush timer. This file never flushes, so without
 * this the timer outlives the suite, fires after teardown, and lazily requires
 * the platform pool into an environment that no longer exists — Jest reports it
 * as "a worker process has failed to exit gracefully".
 *
 * `flush()` now clears its own timer, which closes the common path; this closes
 * the one where nothing ever flushes at all.
 */
afterEach(() => {

  require("../../src/shared/observability/error-store").__reset();
});

/** Give the fire-and-forget POST time to land. */
const settle = () => new Promise((r) => setTimeout(r, 150));

function freshReporter() {
  jest.resetModules();
  const rep = require(REPORTER);
  rep.__reset();
  received.length = 0;
  return rep;
}

describe("OBS-E1 — server errors reach a sink", () => {
  it("sends the error with tenant, user, route and request_id", async () => {
    const rep = freshReporter();
    const rc = require("../../src/config/request-context");

    await rc.run({ tenant: "smartls", userId: "u-9" }, () =>
      rep.report(new Error("boom in finance"), {
        origin: "server",
        route: "POST /invoices",
        request_id: "req-1",
      }),
    );
    await settle();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      message: "boom in finance",
      tenant: "smartls",
      user_id: "u-9",
      route: "POST /invoices",
      request_id: "req-1",
      origin: "server",
    });
  });

  it("never throws when the webhook is unreachable", async () => {
    jest.resetModules();
    process.env.ALERT_WEBHOOK_URL = "http://127.0.0.1:1/dead";
    const rep = require(REPORTER);
    rep.__reset();
    await expect(rep.report(new Error("x"), {})).resolves.toBeDefined();
    process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
  });
});

describe("OBS-E1 — the channel stays usable", () => {
  it("collapses identical errors to one notification", async () => {
    const rep = freshReporter();
    for (let i = 0; i < 5; i++) await rep.report(new Error("same failure"), {});
    await settle();
    expect(received).toHaveLength(1);
  });

  it("collapses the same error carrying different ids", async () => {
    // "user <uuid> not found" is ONE problem, not one per user. Without id
    // normalisation dedupe never matches and the ceiling does all the work.
    const rep = freshReporter();
    await rep.report(new Error("user 41f2c0de-1111-2222-3333-444455556666 not found"), {});
    await rep.report(new Error("user 99a1b2c3-9999-8888-7777-666655554444 not found"), {});
    await settle();
    expect(received).toHaveLength(1);
  });

  it("keeps genuinely different errors separate", async () => {
    const rep = freshReporter();
    await rep.report(new Error("alpha failed"), {});
    await rep.report(new Error("beta failed"), {});
    await settle();
    expect(received).toHaveLength(2);
  });

  it("caps outbound notifications per minute", async () => {
    const rep = freshReporter();
    for (let i = 0; i < 40; i++) await rep.report(new Error(`distinct ${i}x`), {});
    await settle();
    expect(received.length).toBeLessThanOrEqual(rep.MAX_PER_MINUTE);
  });

  it("ignores line/column drift in the stack frame", async () => {
    // The same function throwing the same error must stay one fingerprint after
    // an unrelated edit shifts its line, or dedupe breaks on every deploy.
    const rep = freshReporter();
    const a = new Error("stable failure");
    a.stack = "Error: stable failure\n    at doThing (/app/src/x.js:10:5)";
    const b = new Error("stable failure");
    b.stack = "Error: stable failure\n    at doThing (/app/src/x.js:42:9)";
    expect(rep.fingerprint(a)).toBe(rep.fingerprint(b));
  });
});

describe("OBS-E1 — only real failures page anyone", () => {
  function appThrowing(err) {
    // errorHandler is required HERE, not at describe-time.
    //
    // `freshReporter()` calls jest.resetModules() to get a clean capture array.
    // A handler required before that still closes over the OLD error-reporter
    // instance, so it reported into a module nothing was watching and
    // `received` stayed empty — the test read as "the 500 was not reported"
    // when the product was reporting it perfectly.
    //
    // The same identity trap explains the ZodError case below: `instanceof`
    // against a class from a different module instance is always false, so a
    // validation error fell through to the 500 branch.
     
    const { errorHandler } = require("../../src/middleware/error-handler");
    const app = express();
    app.use((req, _res, next) => { req.request_id = "rid-500"; next(); });
    app.get("/boom", () => { throw err; });
    app.use(errorHandler);
    return app;
  }

  it("reports a 500", async () => {
    freshReporter();
    jest.resetModules();
    const res = await request(appThrowing(new Error("db exploded"))).get("/boom");
    await settle();
    expect(res.status).toBe(500);
    expect(received.some((r) => r && r.message === "db exploded")).toBe(true);
  });

  it("does NOT report a 4xx", async () => {
    // API F-1 made deliberate 404s return 404 instead of 500. If those reached
    // the alert channel, its first week would be "ticket not found" and it
    // would be muted — which is the whole reason F-1 was fixed first.
    freshReporter();
    const err = new Error("Ticket not found");
    err.status = 404;
    const res = await request(appThrowing(err)).get("/boom");
    await settle();
    expect(res.status).toBe(404);
    expect(received).toHaveLength(0);
  });

  it("does NOT report a validation error", async () => {
    // AFTER freshReporter(), so this is the same zod instance the freshly
    // required errorHandler will `instanceof` against.
    freshReporter();
     
    const { ZodError } = require("zod");
    const res = await request(
      appThrowing(new ZodError([{ code: "custom", path: ["x"], message: "bad" }])),
    ).get("/boom");
    await settle();
    // 422, not 400: API F-2 standardised validation failures on 422 to match the
    // 90 module validators that already used it. This assertion predates that
    // and only surfaced once the module-identity bug above stopped masking it
    // by sending every ZodError down the 500 branch.
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    // The point of the test is unchanged: a client error pages nobody.
    expect(received).toHaveLength(0);
  });
});

/**
 * Spec §2.3 pt 4 — "Backend must capture … API validation failures".
 *
 * This was deliberately NOT done for most of the module's life, and the reason
 * was sound: a channel whose first week is "email is required" gets muted. The
 * requirement and the reason are reconciled by the five-level scheme — captured
 * at `notice`, which records and counts but never notifies.
 *
 * The test above ("does NOT report a validation error") still passes unchanged,
 * and that is the point: it measures what reaches the WEBHOOK, and nothing here
 * changes that answer. These assert the other half — that it reaches the STORE.
 */
describe("§2.3 pt 4 — validation failures are recorded, never paged", () => {
  const STORE = "../../src/shared/observability/error-store";

  /** Capture what the store is asked to persist, without a database. */
  function captureStore() {
    const store = require(STORE);
    const rows = [];
    store.__reset();
    store.__setQuery(async (_sql, params) => {
      rows.push(params);
      return { rows: [] };
    });
    return { store, rows };
  }

  function appThrowingValidation() {
    const { errorHandler } = require("../../src/middleware/error-handler");
    const { ZodError } = require("zod");
    const app = express();
    app.use((req, _res, next) => { req.request_id = "rid-422"; next(); });
    app.post("/signup", () => {
      throw new ZodError([
        { code: "custom", path: ["email"], message: "Required" },
        { code: "custom", path: ["password"], message: "Too short" },
      ]);
    });
    app.use(errorHandler);
    return app;
  }

  it("persists the failure at level `notice`", async () => {
    freshReporter();
    const { store, rows } = captureStore();

    await request(appThrowingValidation()).post("/signup").send({}).expect(422);
    await settle();
    await store.flush();

    expect(rows).toHaveLength(1);
    // UPSERT params: [tenant, signature, level, origin, message, …]
    expect(rows[0][2]).toBe("notice");
    expect(rows[0][4]).toContain("email, password");
  });

  it("still reaches NO ONE — the 422 pages nobody, exactly as before", async () => {
    freshReporter();
    const { store } = captureStore();

    await request(appThrowingValidation()).post("/signup").send({}).expect(422);
    await settle();
    await store.flush();

    expect(received).toHaveLength(0);
  });

  it("does not spend the outbound rate limit that a real 500 needs", async () => {
    // The ceiling is 20 reports a minute. If a broken form could burn it, a
    // genuine 500 in the same minute would be dropped — noise starving signal.
    const rep = freshReporter();
    const { store } = captureStore();

    const app = appThrowingValidation();
    for (let i = 0; i < 30; i += 1) {

      await request(app).post("/signup").send({}).expect(422);
    }
    await settle();

    // A real error afterwards must still get through.
    await rep.report(new Error("the actual outage"), {});
    await settle();
    await store.flush();

    expect(received.some((r) => r && r.message === "the actual outage")).toBe(true);
  });

  it("groups repeated bad input into ONE row rather than one per attempt", async () => {
    // A ZodError's own message is a JSON dump of every issue, so passing it
    // through would fingerprint differently for each combination of bad fields
    // and one broken form would produce hundreds of groups. The synthesised
    // message keys on route + sorted field names instead.
    freshReporter();
    const { store, rows } = captureStore();

    const app = appThrowingValidation();
    for (let i = 0; i < 5; i += 1) {

      await request(app).post("/signup").send({}).expect(422);
    }
    await settle();
    await store.flush();

    // NOT "one statement". The requests are sequential and each takes longer
    // than the 250ms leading edge, so several flush cycles legitimately occur —
    // the same reason the store batches at all. Grouping is done by the UPSERT's
    // ON CONFLICT (signature), so the property to assert is that every statement
    // carries the SAME signature and the counts add up to the attempts.
    const signatures = new Set(rows.map((r) => r[1]));
    expect(signatures.size).toBe(1);

    const COUNT = rows[0].length - 1;
    expect(rows.reduce((n, r) => n + r[COUNT], 0)).toBe(5);
  });
});

describe("OBS-E2 — the browser can report", () => {
  it("accepts a crash report and forwards it to the same sink", async () => {
    freshReporter();
    const { router } = require("../../src/routes/client-errors");
    const app = express();
    app.use((req, _res, next) => { req.request_id = "rid-7"; next(); });
    app.use("/api", router);

    const res = await request(app).post("/api/client-errors").send({
      message: "Cannot read properties of undefined",
      name: "TypeError",
      kind: "render",
      route: "/finance",
      fatal: true,
      stack: "TypeError: x\n    at Foo (a.js:1:1)",
    });
    await settle();

    // 204 always: a reporting endpoint that errors teaches the client to retry,
    // and a retry storm on the crash path is the last thing anyone needs.
    expect(res.status).toBe(204);
    expect(received[0]).toMatchObject({
      origin: "browser",
      severity: "fatal",
      message: "Cannot read properties of undefined",
    });
    expect(received[0].extra.kind).toBe("render");
  });

  it("drops errors thrown by the user's browser EXTENSIONS", async () => {
    // Wallet extensions inject content scripts into the page and share one
    // window.onerror, so `Cannot redefine property: ethereum` — two wallets
    // fighting over window.ethereum — arrived filed against Praxis, ×3.
    // Unactionable by construction: not our code, not fixable, unbounded
    // population. Left in, the feed fills with whatever its readers installed.
    freshReporter();
    const { router } = require("../../src/routes/client-errors");
    const app = express();
    app.use("/api", router);

    const res = await request(app).post("/api/client-errors").send({
      message: "Uncaught TypeError: Cannot redefine property: ethereum",
      name: "TypeError",
      stack: "TypeError: Cannot redefine property: ethereum\n    at r.inject (chrome-extension://bfnaelmomeimhlpmgjnjophhpkkoljpa/evmAsk.js:15:1)",
    });
    await settle();

    // Still 204 — a rejected report is not an error either.
    expect(res.status).toBe(204);
    expect(received).toHaveLength(0);
  });

  it("still accepts an error that merely MENTIONS an extension", async () => {
    // The filter matches the URL SCHEME, not the word. A same-origin script an
    // extension happened to trigger is our bug and must still report.
    freshReporter();
    const { router } = require("../../src/routes/client-errors");
    const app = express();
    app.use("/api", router);

    await request(app).post("/api/client-errors").send({
      message: "Failed to load resource for chrome-extension compatibility shim",
      name: "TypeError",
      stack: "TypeError: x\n    at loadShim (https://smartls.praxisls.com/assets/main.js:1:2)",
    });
    await settle();

    expect(received).toHaveLength(1);
  });

  it("clamps a hostile payload", async () => {
    // The body reaches an alert channel a human reads. Treat it as untrusted.
    freshReporter();
    const { router } = require("../../src/routes/client-errors");
    const app = express();
    app.use("/api", router);

    const res = await request(app).post("/api/client-errors").send({
      message: "x".repeat(5000),
      stack: "y".repeat(20000),
      unexpectedKey: "should be dropped",
    });
    await settle();

    expect(res.status).toBe(204);
    expect(received[0].message.length).toBeLessThanOrEqual(500);
    expect(received[0].stack.length).toBeLessThanOrEqual(4000);
    expect(received[0]).not.toHaveProperty("unexpectedKey");
  });
});
