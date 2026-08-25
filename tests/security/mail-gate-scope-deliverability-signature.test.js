"use strict";

/**
 * The deliverability and signature surfaces are scoped to their own routes,
 * not the whole /mail namespace (the same inverted pattern as mail.ai in
 * PR #13). Real routers + stand-ins for mail and triage in loader order.
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

jest.mock("../../src/middleware/rbac", () => ({
  requirePermission: () => (_req, _res, next) => {
    const err = new Error("permission check reached (mock)");
    err.code = "RBAC_MOCK";
    err.status = 403;
    return next(err);
  },
}));

const { errorHandler } = require("../../src/middleware/error-handler");
const deliverability = require("../../src/modules/mail/deliverability/deliverability.routes");
const signature = require("../../src/modules/mail/signature/signature.routes");

let features = {};

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

// Loader discovery order for /mail: deliverability (3rd), then mail stub,
// then signature (6th), then triage stub.
const mailStub = express.Router();
for (const p of ["/threads", "/folders", "/mailboxes/mine"]) {
  mailStub.get(p, (_req, res) => res.json({ data: p.replace(/^\//, "") }));
}

const triageStub = express.Router();
triageStub.post("/threads/:id/claim", (_req, res) => res.json({ data: "claimed" }));
triageStub.post("/threads/:id/assign", (_req, res) => res.json({ data: "assigned" }));

app.use(deliverability.basePath, deliverability.router);
app.use("/mail", mailStub);
app.use(signature.basePath, signature.router);
app.use("/mail", triageStub);
app.use((err, req, res, _next) => errorHandler(err, req, res, _next));

describe("deliverability off — namespace stays reachable", () => {
  beforeEach(() => {
    features = { "mail.deliverability": "off", "mail.signatures": "on" };
  });

  test.each([
    ["/mail/threads", "threads"],
    ["/mail/folders", "folders"],
    ["/mail/mailboxes/mine", "mailboxes/mine"],
  ])("GET %s passes deliverability router untouched", async (p, label) => {
    const res = await request(app).get(p);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: label });
  });

  test("triage claim passes through deliverability and reaches triage", async () => {
    const res = await request(app).post("/mail/threads/42/claim").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "claimed" });
  });
});

describe("deliverability off — own surface refused", () => {
  beforeEach(() => {
    features = { "mail.deliverability": "off", "mail.signatures": "on" };
  });

  test.each([
    ["/mail/deliverability", "GET"],
    ["/mail/deliverability/check", "POST"],
    ["/mail/deliverability/example.com/history", "GET"],
  ])("%s %s is refused by mail.deliverability gate", async (p, method) => {
    const reqMethod = method === "POST" ? request(app).post(p) : request(app).get(p);
    const res = method === "POST" ? await reqMethod.send({}) : await reqMethod;
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_DISABLED");
    expect(res.body.error.message).toContain("mail.deliverability");
  });
});

describe("signature off — namespace stays reachable", () => {
  beforeEach(() => {
    features = { "mail.deliverability": "on", "mail.signatures": "off" };
  });

  test.each([
    ["/mail/threads", "threads"],
    ["/mail/folders", "folders"],
    ["/mail/mailboxes/mine", "mailboxes/mine"],
  ])("GET %s passes signature router untouched", async (p, label) => {
    const res = await request(app).get(p);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: label });
  });

  test("triage claim passes signature router and reaches triage", async () => {
    const res = await request(app).post("/mail/threads/42/claim").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "claimed" });
  });
});

describe("signature off — own surface refused", () => {
  beforeEach(() => {
    features = { "mail.deliverability": "on", "mail.signatures": "off" };
  });

  test.each([
    ["/mail/signature", "GET"],
    ["/mail/signature", "PUT"],
    ["/mail/signature/preview", "GET"],
    ["/mail/signature/png", "POST"],
    ["/mail/signature/png", "GET"],
    ["/mail/signature/templates", "GET"],
    ["/mail/signature/templates/1", "PATCH"],
  ])("%s %s is refused by mail.signatures gate", async (p, method) => {
    const reqMethod = method === "POST" ? request(app).post(p) : method === "PUT" ? request(app).put(p) : method === "PATCH" ? request(app).patch(p) : request(app).get(p);
    const res = method === "GET" ? await reqMethod : await reqMethod.send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_DISABLED");
    expect(res.body.error.message).toContain("mail.signatures");
  });
});

describe("both off — worst case", () => {
  beforeEach(() => {
    features = { "mail.deliverability": "off", "mail.signatures": "off" };
  });

  test("inbox reads still reach the mail module (neither gate answers for it)", async () => {
    const res = await request(app).get("/mail/threads");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "threads" });
  });

  test("triage claim still reaches triage (signature gate does not block it)", async () => {
    const res = await request(app).post("/mail/threads/42/claim").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "claimed" });
  });

  test("deliverability route is refused by its own gate", async () => {
    const res = await request(app).get("/mail/deliverability");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_DISABLED");
    expect(res.body.error.message).toContain("mail.deliverability");
  });

  test("signature route is refused by its own gate", async () => {
    const res = await request(app).get("/mail/signature");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_DISABLED");
    expect(res.body.error.message).toContain("mail.signatures");
  });
});

describe("flags on — nothing refused incorrectly", () => {
  beforeEach(() => {
    features = { "mail.deliverability": "on", "mail.signatures": "on" };
  });

  test("deliverability routes pass through to permission mock", async () => {
    const res = await request(app).get("/mail/deliverability");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("RBAC_MOCK");
  });

  test("signature route passes through to permission mock", async () => {
    const res = await request(app).get("/mail/signature/templates");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("RBAC_MOCK");
  });

  test("inbox reads are unaffected", async () => {
    const res = await request(app).get("/mail/threads");
    expect(res.status).toBe(200);
  });

  test("triage claim is unaffected", async () => {
    const res = await request(app).post("/mail/threads/42/claim").send({});
    expect(res.status).toBe(200);
  });
});
