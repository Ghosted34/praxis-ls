"use strict";

/**
 * Idempotency middleware.
 *
 * This is the piece that makes the client's offline replay safe, so the tests
 * are written against the ways it could fail DANGEROUSLY rather than merely
 * fail:
 *
 *   - it lets a replay execute a second time (a duplicated invoice or journal
 *     entry — a material misstatement, not a rough edge);
 *   - it returns a stored response to a DIFFERENT request that happened to
 *     present the same key (handing a caller someone else's data);
 *   - it caches a failure, pinning the user to their own typo;
 *   - it fails the write when the table is missing, turning a safety net into
 *     an outage for every un-migrated tenant.
 */

const {
  idempotency,
  hashRequest,
  KEY_PATTERN,
} = require("../../src/middleware/idempotency");

/** A stand-in for the tenant lease, scripted per test. */
function fakeDb(handlers) {
  return {
    query: jest.fn((sql, params) => {
      if (/^INSERT INTO idempotency_key/.test(sql.trim()))
        return handlers.insert(params);
      if (/^SELECT state/.test(sql.trim())) return handlers.select(params);
      if (/^UPDATE idempotency_key/.test(sql.trim()))
        return handlers.update ? handlers.update(params) : { rows: [] };
      if (/^DELETE FROM idempotency_key/.test(sql.trim()))
        return handlers.del ? handlers.del(params) : { rows: [] };
      throw new Error(`unexpected sql: ${sql}`);
    }),
  };
}

function makeReq({
  method = "POST",
  key = "11111111-2222-3333-4444-555555555555",
  body = { code: "SLAS" },
  db,
} = {}) {
  return {
    method,
    originalUrl: "/api/tenant/entities",
    url: "/api/tenant/entities",
    // A bearer token on every fixture: the middleware deliberately skips
    // unauthenticated requests (no credential, no claim), so omitting this
    // would make every test below exercise the skip path instead.
    headers: {
      authorization: "Bearer test-token",
      ...(key ? { "idempotency-key": key } : {}),
    },
    body,
    user: { user_id: "u-1" },
    tenantDb: (fn) => Promise.resolve(fn(db)),
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    sent: null,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.sent = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  return res;
}

/** Run the middleware and resolve once it has called next() or answered. */
function run(req, res) {
  return new Promise((resolve) => {
    const next = (err) => resolve({ outcome: "next", err });
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const r = originalJson(body);
      resolve({ outcome: "answered", body });
      return r;
    };
    idempotency(req, res, next);
  });
}

describe("Idempotency-Key handling", () => {
  test("ignores safe methods and requests without the header", async () => {
    const db = fakeDb({
      insert: () => ({ rows: [] }),
      select: () => ({ rows: [] }),
    });

    const get = makeReq({ method: "GET", db });
    expect((await run(get, makeRes())).outcome).toBe("next");
    expect(db.query).not.toHaveBeenCalled();

    const noKey = makeReq({ key: null, db });
    expect((await run(noKey, makeRes())).outcome).toBe("next");
    expect(db.query).not.toHaveBeenCalled();
  });

  test("skips a request with no credential, so no pool checkout happens", async () => {
    // Mounted above each module's auth, so an unauthenticated caller could
    // otherwise take a tenant connection and INSERT a row of their choosing
    // before anything established they were allowed to be here.
    const db = fakeDb({
      insert: () => ({ rows: [] }),
      select: () => ({ rows: [] }),
    });
    const req = makeReq({ db });
    req.headers.authorization = "";

    const { outcome } = await run(req, makeRes());

    expect(outcome).toBe("next");
    expect(db.query).not.toHaveBeenCalled();
  });

  test("releases the key for a response that never calls res.json", async () => {
    // A 204 from a DELETE finishes through res.end. Leaving the claim in_flight
    // would 409 the client's retry for the whole stale window instead of
    // answering it, and there is no body to replay — so the key is released and
    // the next attempt simply re-runs.
    const del = jest.fn(() => ({ rows: [] }));
    const db = fakeDb({
      insert: () => ({ rows: [{ key: "k" }] }),
      select: () => ({ rows: [] }),
      del,
    });
    const res = makeRes();

    await run(makeReq({ method: "DELETE", db }), res);
    res.statusCode = 204;
    res.end();
    await new Promise((r) => setImmediate(r));

    expect(del).toHaveBeenCalled();
  });

  test("rejects a malformed key rather than putting it in a primary key", async () => {
    const db = fakeDb({
      insert: () => ({ rows: [] }),
      select: () => ({ rows: [] }),
    });
    const { err } = await run(
      makeReq({ key: "no spaces allowed!", db }),
      makeRes(),
    );

    expect(err).toBeTruthy();
    expect(err.code).toBe("IDEMPOTENCY_KEY_INVALID");
    expect(err.status).toBe(400);
  });

  test("a first request claims the key and runs normally", async () => {
    const db = fakeDb({
      insert: () => ({ rows: [{ key: "k" }] }),
      select: () => ({ rows: [] }),
    });
    const req = makeReq({ db });

    const { outcome } = await run(req, makeRes());

    expect(outcome).toBe("next");
  });

  test("A REPLAY RETURNS THE ORIGINAL RESPONSE AND DOES NOT RUN AGAIN", async () => {
    // The property the whole feature rests on. If this ever regresses, the
    // client's automatic retry becomes a duplicate-posting machine.
    const body = { code: "SLAS" };
    const db = fakeDb({
      insert: () => ({ rows: [] }), // somebody already holds it
      select: () => ({
        rows: [
          {
            state: "completed",
            status_code: 201,
            response_body: { data: { entity_id: "e-1" } },
            request_hash: hashRequest("POST", "/api/tenant/entities", body),
          },
        ],
      }),
    });
    const req = makeReq({ body, db });
    const res = makeRes();

    const result = await run(req, res);

    expect(result.outcome).toBe("answered");
    expect(res.statusCode).toBe(201);
    expect(result.body).toEqual({ data: { entity_id: "e-1" } });
    // The caller gets the created id back, so it can carry on exactly as if its
    // first attempt had succeeded — which, as far as the ledger is concerned,
    // it did.
    expect(res.headers["Idempotency-Replayed"]).toBe("true");
  });

  test("refuses to answer a DIFFERENT request presenting a used key", async () => {
    const db = fakeDb({
      insert: () => ({ rows: [] }),
      select: () => ({
        rows: [
          {
            state: "completed",
            status_code: 200,
            response_body: { data: { entity_id: "e-1" } },
            request_hash: hashRequest("POST", "/api/tenant/entities", {
              code: "SOMETHING-ELSE",
            }),
          },
        ],
      }),
    });

    const { err } = await run(
      makeReq({ body: { code: "SLAS" }, db }),
      makeRes(),
    );

    expect(err.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(err.status).toBe(422);
  });

  test("409s a replay that arrives while the original is still running", async () => {
    const body = { code: "SLAS" };
    const db = fakeDb({
      insert: () => ({ rows: [] }),
      select: () => ({
        rows: [
          {
            state: "in_flight",
            status_code: null,
            response_body: null,
            request_hash: hashRequest("POST", "/api/tenant/entities", body),
          },
        ],
      }),
    });
    const res = makeRes();

    const { err } = await run(makeReq({ body, db }), res);

    // Two identical writes racing is precisely what must not happen.
    expect(err.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    expect(err.status).toBe(409);
    expect(res.headers["Retry-After"]).toBe("2");
  });

  test("records the response BEFORE sending it, so no replay can slip through", async () => {
    const update = jest.fn(() => ({ rows: [] }));
    const db = fakeDb({
      insert: () => ({ rows: [{ key: "k" }] }),
      select: () => ({ rows: [] }),
      update,
    });
    const req = makeReq({ db });
    const res = makeRes();

    await run(req, res);
    // The handler answers.
    res.statusCode = 201;
    res.json({ data: { entity_id: "e-1" } });
    await new Promise((r) => setImmediate(r));

    expect(update).toHaveBeenCalled();
    const params = update.mock.calls[0][0];
    expect(params[1]).toBe(201);
    expect(JSON.parse(params[2])).toEqual({ data: { entity_id: "e-1" } });
    expect(params[3]).toBe("u-1");
  });

  test("RELEASES the key on a failure so the user can fix the input and retry", async () => {
    const del = jest.fn(() => ({ rows: [] }));
    const update = jest.fn(() => ({ rows: [] }));
    const db = fakeDb({
      insert: () => ({ rows: [{ key: "k" }] }),
      select: () => ({ rows: [] }),
      update,
      del,
    });
    const res = makeRes();

    await run(makeReq({ db }), res);
    res.statusCode = 422;
    res.json({
      error: { code: "VALIDATION_ERROR", message: "code: required" },
    });
    await new Promise((r) => setImmediate(r));

    // Caching a validation failure would pin the user to their own typo for as
    // long as the key lived.
    expect(del).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("passes the request THROUGH when the table does not exist", async () => {
    // An un-migrated tenant, or a database hiccup. This middleware is a safety
    // net, not a gate: failing the write here would make the feature that
    // prevents data loss a cause of it.
    const db = {
      query: jest.fn(() => {
        throw Object.assign(
          new Error('relation "idempotency_key" does not exist'),
          { code: "42P01" },
        );
      }),
    };
    const { outcome, err } = await run(makeReq({ db }), makeRes());

    expect(outcome).toBe("next");
    expect(err).toBeUndefined();
  });
});

describe("hashRequest", () => {
  test("is stable across a re-serialised body, and differs by method, path and content", () => {
    const body = { code: "SLAS", legal_name: "Smart Logistics" };
    // The outbox stores the parsed object and re-serialises on replay; an
    // identical request must not read as a key reuse.
    const reparsed = JSON.parse(JSON.stringify(body));

    expect(hashRequest("POST", "/x", body)).toBe(
      hashRequest("POST", "/x", reparsed),
    );
    expect(hashRequest("POST", "/x", body)).not.toBe(
      hashRequest("PATCH", "/x", body),
    );
    expect(hashRequest("POST", "/x", body)).not.toBe(
      hashRequest("POST", "/y", body),
    );
    expect(hashRequest("POST", "/x", body)).not.toBe(
      hashRequest("POST", "/x", { code: "OTHER" }),
    );
  });
});

describe("KEY_PATTERN", () => {
  test("accepts a UUID and a ULID, rejects the shapes that would be trouble", () => {
    expect(KEY_PATTERN.test("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(KEY_PATTERN.test("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
    expect(KEY_PATTERN.test("ob-abc123-def456")).toBe(true);
    expect(KEY_PATTERN.test("short")).toBe(false);
    expect(KEY_PATTERN.test("has space")).toBe(false);
    expect(KEY_PATTERN.test("a".repeat(201))).toBe(false);
  });
});
