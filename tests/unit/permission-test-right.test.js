"use strict";
/**
 * The Test right (calls audit PR-7, O5) is carried through every place the
 * other rights are listed: the grant read the RBAC cache makes, the matrix
 * upsert (and saving the other rights never clears it), the validator, and the
 * migration that adds it with no backfill.
 */
const fs = require("fs");
const path = require("path");

const repo = require("../../src/modules/security/permission/permission.repo");
const { schemas } = require("../../src/modules/security/permission/permission.validator");

function fakeClient() {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ ok: true }] };
    },
  };
}

describe("the Test right (can_test)", () => {
  it("the grant upsert writes can_test, and an omitted flag leaves it as stored", async () => {
    const c = fakeClient();
    await repo.upsertGrant(c, { role_id: "r", module_key: "MOD-64", can_read: true });
    const { sql, params } = c.calls[0];
    expect(sql).toMatch(/can_test\s*=\s*COALESCE\(\$11,\s*permission\.can_test\)/);
    expect(params).toHaveLength(11);
    expect(params[10]).toBeNull();
  });

  it("the grant upsert carries a sent can_test", async () => {
    const c = fakeClient();
    await repo.upsertGrant(c, { role_id: "r", module_key: "MOD-64", can_test: true });
    expect(c.calls[0].params[10]).toBe(true);
  });

  it("the validator accepts can_test and still refuses unknown keys", () => {
    const grant = schemas.grant;
    expect(grant.safeParse({ role_id: "0b7c4f1e-7b1a-4f59-9c1e-2c8f0b6f1a11", module_key: "MOD-64", can_test: true }).success).toBe(true);
    expect(grant.safeParse({ role_id: "0b7c4f1e-7b1a-4f59-9c1e-2c8f0b6f1a11", module_key: "MOD-64", can_tset: true }).success).toBe(false);
  });

  it("the RBAC cache reads can_test with the other rights", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../src/shared/cache/identity-cache.js"), "utf8");
    expect(src).toMatch(/can_export, can_validate, can_disburse, can_test/);
  });

  it("the migration adds the column with no backfill", () => {
    const dir = path.join(__dirname, "../../migrations/tenant");
    const file = fs.readdirSync(dir).find((f) => /_permission_can_test\.sql$/.test(f));
    expect(file).toBeTruthy();
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS can_test boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/COMMENT ON COLUMN permission\.can_test/);
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(/UPDATE\s+permission/i);
  });
});
