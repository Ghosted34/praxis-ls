"use strict";
/**
 * Regression tests for two schema-shaped defects in the security/session module.
 *
 * B5 — `killAllForUser` used to query `UPDATE session …`. There is no table
 * named `session`; the tenant table is `user_session`. Every "Revoke all mine"
 * threw `42P01 undefined_table` and fell through to a generic 500.
 *
 * These tests pin two things independently of the running database:
 *
 *   1. The exact table each repo function queries. A pg mock inspects the SQL
 *      text and rejects with the real Postgres error code when the referenced
 *      table isn't in a known-good allowlist — so if the query gets renamed to
 *      a non-existent table again, the test fails with the same shape a live
 *      db would produce (`err.code === "42P01"`).
 *
 *   2. That the error handler now maps 42P01 (and 42703) to 500 SCHEMA_ERROR
 *      rather than a bare INTERNAL_ERROR — so the class is greppable in
 *      error_event and does reach the reporter.
 */

const repo = require("../../src/modules/security/session/session.repo");

const KNOWN_TABLES = new Set(["user_session", "platform_session"]);

function fakeClient() {
  return {
    calls: [],
    async query(text, params) {
      this.calls.push({ text, params });
      // Extract every "<verb> [ONLY] <table>" reference and validate.
      const refs = [
        ...text.matchAll(
          /\b(?:FROM|UPDATE|INTO|JOIN)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)/gi,
        ),
      ]
        .map((m) => m[1].toLowerCase())
        .filter((t) => !["only"].includes(t));
      for (const t of refs) {
        if (!KNOWN_TABLES.has(t)) {
          const err = new Error(`relation "${t}" does not exist`);
          err.code = "42P01";
          throw err;
        }
      }
      return { rows: [] };
    },
  };
}

describe("session.repo — schema-name regressions", () => {
  it("killAllForUser targets user_session (B5)", async () => {
    const client = fakeClient();
    await expect(repo.killAllForUser(client, "u1", "actor1")).resolves.toEqual(
      [],
    );
    const sql = client.calls[0].text;
    expect(sql).toMatch(/UPDATE\s+user_session\b/i);
    expect(sql).not.toMatch(/UPDATE\s+session\b/i);
  });

  it("kill targets user_session", async () => {
    const client = fakeClient();
    await expect(repo.kill(client, "s1", "actor1")).resolves.toBeNull();
    expect(client.calls[0].text).toMatch(/UPDATE\s+user_session\b/i);
  });

  it("listForUser selects from user_session and returns killed_at", async () => {
    const client = fakeClient();
    await repo.listForUser(client, "u1");
    const sql = client.calls[0].text;
    expect(sql).toMatch(/FROM\s+user_session\b/i);
    // The client type declares `killed_at`; the SELECT must actually project it.
    expect(sql).toMatch(/\bkilled_at\b/);
  });
});

describe("error-handler — 42P01/42703 map to 500 SCHEMA_ERROR", () => {
  const { errorHandler } = require("../../src/middleware/error-handler");

  // Silence the reporter and logger side-effects — the test cares about the
  // response shape.
  jest.mock("../../src/shared/observability/error-reporter", () => ({
    report: jest.fn(),
  }));

  function run(err) {
    const req = {
      method: "POST",
      path: "/x",
      originalUrl: "/x",
      request_id: "r",
    };
    let payload = null;
    let status = null;
    const res = {
      status(s) {
        status = s;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      },
    };
    errorHandler(err, req, res, () => {});
    return { status, payload };
  }

  it("maps 42P01 undefined_table to 500 SCHEMA_ERROR", () => {
    const err = new Error('relation "session" does not exist');
    err.code = "42P01";
    const { status, payload } = run(err);
    expect(status).toBe(500);
    expect(payload.error.code).toBe("SCHEMA_ERROR");
  });

  it("maps 42703 undefined_column to 500 SCHEMA_ERROR", () => {
    const err = new Error("column x does not exist");
    err.code = "42703";
    const { status, payload } = run(err);
    expect(status).toBe(500);
    expect(payload.error.code).toBe("SCHEMA_ERROR");
  });
});
