"use strict";
const { envelope, withResult } = require("../../src/shared/crud/with-result");

describe("envelope() — the mutation shape", () => {
  it("wraps a plain payload as changed:true", () => {
    expect(envelope({ id: "s1" })).toEqual({
      ok: true,
      changed: true,
      data: { id: "s1" },
    });
  });

  it("respects a service's self-classifying { changed: false, message }", () => {
    const out = envelope({
      changed: false,
      message: "Session was already revoked",
    });
    expect(out).toEqual({
      ok: true,
      changed: false,
      message: "Session was already revoked",
    });
    expect("data" in out).toBe(false);
  });

  it("uses opts.idle when the service reported a no-op without a message", () => {
    const out = envelope(
      { changed: false },
      { idle: "That session was already revoked" },
    );
    expect(out.message).toBe("That session was already revoked");
  });

  it("preserves a service's { changed: true, data }", () => {
    expect(envelope({ changed: true, data: { id: "s1" } })).toEqual({
      ok: true,
      changed: true,
      data: { id: "s1" },
    });
  });
});

describe("withResult() — Express integration", () => {
  function makeRes() {
    return {
      _status: null,
      _body: null,
      headersSent: false,
      status(s) {
        this._status = s;
        return this;
      },
      json(b) {
        this._body = b;
        return this;
      },
    };
  }

  it("responds 200 with the enveloped result", async () => {
    const handler = withResult(async () => ({ id: "s1" }));
    const res = makeRes();
    await handler({}, res, () => {
      throw new Error("next() should not be called");
    });
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ ok: true, changed: true, data: { id: "s1" } });
  });

  it("routes a thrown error to next(err) so error-handler.js takes over", async () => {
    const err = new Error("boom");
    const handler = withResult(async () => {
      throw err;
    });
    const res = makeRes();
    let seen = null;
    await handler({}, res, (e) => {
      seen = e;
    });
    expect(seen).toBe(err);
    expect(res._body).toBeNull();
  });

  it("does not double-respond when the inner fn already responded", async () => {
    const handler = withResult(async (_req, res) => {
      res.headersSent = true;
      return null;
    });
    const res = makeRes();
    await handler({}, res, () => {});
    expect(res._body).toBeNull();
  });
});
