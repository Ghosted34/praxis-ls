"use strict";
/**
 * The connection's schema, across nested db calls.
 *
 * WHAT BROKE. `req.tenantDb` and `req.identityDb` share ONE pooled connection,
 * and switching between them re-binds `search_path`. The switch was one-way: a
 * nested call left the connection wherever it had moved it, so a handler shaped
 * like this ran its business SQL on the WRONG schema —
 *
 *     req.tenantDb(async (c) =>                          // sandbox
 *       service.update(c, { patch: await withDepartment(req, body) }))
 *                              ^ identityDb → SET search_path = live
 *
 * Under sandbox that made `PATCH /vacancies/:id` answer "Vacancy not found" —
 * it searched LIVE for a row that exists in sandbox — and made `POST` on the
 * same controllers write a sandbox session's row INTO THE LIVE SCHEMA. Four
 * handlers were shaped that way: vacancies and employees, create and update.
 *
 * Under LIVE none of it showed, because both calls already wanted live and the
 * switch never happened. That is why it survived every environment where the
 * feature was tried before somebody flipped to Test.
 *
 * WHAT THESE PIN. The pin is restored when a nested call finishes, including
 * when it throws — so the outer callback always continues on the schema it
 * asked for.
 */

const registry = require("../../src/services/tenant/registry.service");
const { tenantContext } = require("../../src/middleware/tenant-context");

const SCHEMA = Symbol.for("praxis.conn.schema");

/** A connection that records every search_path it is bound to. */
function fakeLease() {
  return {
    sets: [],
    async query(text) {
      const m = /SET search_path = ([a-z0-9_]+)/i.exec(String(text));
      if (m) this.sets.push(m[1]);
      return { rows: [] };
    },
    release() {},
  };
}

/** Run the middleware and hand back the request it decorated. */
function requestOn(env, lease) {
  jest.spyOn(registry, "acquire").mockImplementation(async (_meta, wantEnv) => {
    // The real acquire binds the SCHEMA NAME, not the env name — the assertions
    // below read the same value a repo would.
    const schema = wantEnv === "sandbox" ? "sandbox_schema" : "live_schema";
    lease.sets.push(schema);
    lease[SCHEMA] = schema;
    return lease;
  });

  const req = {
    tenant: { slug: "t", is_live: false, live_schema: "live_schema", sandbox_schema: "sandbox_schema" },
    user: { user_id: "u1" },
    get: () => (env === "sandbox" ? "sandbox" : "live"),
    header: () => (env === "sandbox" ? "sandbox" : "live"),
    headers: { "x-praxis-env": env },
  };
  const res = { on: () => {}, set: () => {}, setHeader: () => {} };
  tenantContext(req, res, () => {});
  return req;
}

describe("tenant-context — the pin survives a nested call", () => {
  afterEach(() => jest.restoreAllMocks());

  it("puts the connection back on the outer schema when identityDb returns", async () => {
    const lease = fakeLease();
    const req = requestOn("sandbox", lease);

    let schemaDuringOuterWork = null;
    await req.tenantDb(async (c) => {
      // The shape every one of the four broken handlers had: an identity read
      // in the middle of a tenant callback.
      await req.identityDb(async () => ({ scope_id: null, department: "Ops" }));
      schemaDuringOuterWork = c[SCHEMA];
      return null;
    });

    // Before the fix this was "live" — and the SELECT that followed it looked
    // for a sandbox row in the live schema.
    expect(schemaDuringOuterWork).toBe("sandbox_schema");
    // …and the last thing the connection was told is the outer schema, not the
    // inner one.
    expect(lease.sets[lease.sets.length - 1]).toBe("sandbox_schema");
  });

  it("restores the pin even when the nested call throws", async () => {
    const lease = fakeLease();
    const req = requestOn("sandbox", lease);

    let schemaAfterFailure = null;
    await req.tenantDb(async (c) => {
      await req
        .identityDb(async () => {
          throw new Error("unknown department");
        })
        .catch(() => {});
      schemaAfterFailure = c[SCHEMA];
      return null;
    });

    // A failed lookup must not leave the connection somewhere else either —
    // the handler above it may well carry on and write.
    expect(schemaAfterFailure).toBe("sandbox_schema");
  });

  it("costs nothing on a live session, where both calls want the same schema", async () => {
    const lease = fakeLease();
    const req = requestOn("live", lease);

    await req.tenantDb(async () => {
      await req.identityDb(async () => null);
    });

    // One bind, from the checkout. No switch means no restore.
    expect(lease.sets).toEqual(["live_schema"]);
  });
});
