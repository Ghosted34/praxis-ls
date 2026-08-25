"use strict";

/**
 * mail.ai is the floor for the AI surface — NOT a gate over the whole /mail
 * namespace.
 *
 * THE REGRESSION THIS FILE PINS
 *
 * The mail.ai gate was once applied router-wide (`router.use(
 * requireFeature("mail.ai"))`) on a router mounted at /mail. Every mail
 * module mounts at /mail — the module loader discovers them alphabetically,
 * so `assist` is the FIRST /mail a request meets. A router-level gate on
 * this router therefore ran for every /mail/* request that fell through to
 * it: with AI off (this flag's default), the gate answered FEATURE_DISABLED
 * for GET /mail/threads, GET /mail/folders and GET /mail/mailboxes/mine
 * before the request ever reached mail.routes.js, which serves them. The
 * whole inbox was unreachable for every tenant that had not opted into AI,
 * while the Platform Console correctly showed "Mail AI: off" — the worst
 * kind of gate, inverted: the surface it protected was the wrong one.
 *
 * The fix scopes the gate to the /assist/* routes, per route. This test
 * reproduces the loader's mount arrangement — the REAL assist router plus a
 * stand-in for the mail module at the same base path, in discovery order —
 * and asserts both halves of the fix:
 *
 *   1. With AI OFF, normal inbox requests pass the assist router through
 *      untouched and reach the module that owns them.
 *   2. With AI OFF, the AI routes — including OCR extraction, which keeps
 *      BOTH protections: the mail.ai floor and its own mail.ocr gate — are
 *      still refused.
 *
 * Only the two things that would need Postgres are mocked — authentication
 * and the permission lookup (the mock answers with a distinctive code so a
 * test can tell "the AI gate let this through" from "the AI gate fired").
 * Express, the assist router, the feature gate and the error handler are
 * real.
 */

const express = require("express");
const request = require("supertest");

jest.mock("../../src/middleware/auth", () => ({
  authMiddleware: (req, _res, next) => {
    req.user = {
      user_id: "11111111-1111-1111-1111-111111111111",
      role_ids: [],
      is_ceo: false,
    };
    next();
  },
}));

// Stands in for RBAC at the permission check. If a request reaches this, the
// AI gate in front of it passed.
jest.mock("../../src/middleware/rbac", () => ({
  requirePermission: () => (_req, _res, next) => {
    const err = new Error("permission check reached (mock)");
    err.code = "RBAC_MOCK";
    err.status = 403;
    return next(err);
  },
}));

const { errorHandler } = require("../../src/middleware/error-handler");
const assist = require("../../src/modules/mail/assist/assist.routes");

/** feature_state as projected for the test tenant. Absent key = no row =
 * the gate fails CLOSED, as for a tenant provisioned before the flag. */
let features = {};

/** Stand-in for the mail/mail module (inbox, folders, mailbox setup) — the
 * routes the regression lost. The loader mounts it at the same base path,
 * AFTER assist. */
const mailStub = express.Router();
for (const p of ["/threads", "/folders", "/mailboxes/mine"]) {
  // `p` is the route's LOCAL path (the router is mounted at /mail), so strip
  // the leading slash to name the surface.
  mailStub.get(p, (_req, res) => res.json({ data: p.replace(/^\//, "") }));
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.tenantDb = async (fn) =>
    fn({
      query: async (text, params) => {
        if (/FROM feature_state/.test(text)) {
          const state = features[params[0]];
          return { rows: state === undefined ? [] : [{ state }] };
        }
        return { rows: [] };
      },
    });
  next();
});
// The loader's discovery order for the /mail modules: assist first, the mail
// module after it.
app.use(assist.basePath, assist.router);
app.use("/mail", mailStub);
app.use((err, req, res, _next) => errorHandler(err, req, res, _next));

describe("AI off — the /mail namespace stays reachable", () => {
  beforeEach(() => {
    features = { "mail.ai": "off" };
  });

  test.each([
    ["/mail/threads", "threads"],
    ["/mail/folders", "folders"],
    ["/mail/mailboxes/mine", "mailboxes/mine"],
  ])("GET %s reaches the mail module, not the AI gate", async (p, label) => {
    const res = await request(app).get(p);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: label });
  });
});

describe("AI off — the AI surface is still refused", () => {
  beforeEach(() => {
    features = { "mail.ai": "off" };
  });

  test.each([
    ["/mail/assist/compose"],
    ["/mail/assist/draft"],
    ["/mail/assist/summary"],
    ["/mail/assist/search"],
  ])("POST %s is answered by the mail.ai gate", async (p) => {
    const res = await request(app).post(p).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_DISABLED");
    expect(res.body.error.message).toContain("mail.ai");
  });

  test("OCR extraction keeps its AI floor — refused before it would reach a vision vendor", async () => {
    const res = await request(app).post("/mail/assist/ocr/att-1").send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_DISABLED");
    expect(res.body.error.message).toContain("mail.ai");
  });

  test("the gate refuses before it costs a query — no permission lookup after it", async () => {
    const res = await request(app).post("/mail/assist/compose").send({});
    expect(res.body.error.code).not.toBe("RBAC_MOCK");
  });
});

describe("AI on — the gate passes, and OCR keeps its own flag", () => {
  beforeEach(() => {
    features = { "mail.ai": "on", "mail.ocr": "off" };
  });

  test("POST /mail/assist/compose passes the AI gate and reaches the permission check", async () => {
    const res = await request(app).post("/mail/assist/compose").send({});
    expect(res.status).toBe(403);
    // The mock RBAC's distinctive code: the request got PAST mail.ai.
    expect(res.body.error.code).toBe("RBAC_MOCK");
  });

  test("OCR extraction still needs mail.ocr — two gates, not one", async () => {
    const res = await request(app).post("/mail/assist/ocr/att-1").send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_DISABLED");
    expect(res.body.error.message).toContain("mail.ocr");
  });

  test("inbox reads are unaffected when AI is on, as when it is off", async () => {
    const res = await request(app).get("/mail/threads");
    expect(res.status).toBe(200);
  });
});
