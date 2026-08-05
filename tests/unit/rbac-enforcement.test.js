"use strict";

/**
 * TC-C3 — `rbacCheck()` and `ceoCheck()` were uncovered. The enforcement paths
 * of a multi-tenant ERP never ran in a test.
 *
 * These three middlewares are the entire authorization story for ~700 routes.
 * Services do not check grants; route middleware does, and this is it. So the
 * question these tests answer is not "does requirePermission work" but "can any
 * of the ways it might quietly stop working go unnoticed" — because a
 * permission check that silently passes everyone looks exactly like a
 * permission check that works.
 *
 * THE ACTION→COLUMN MAP IS THE SHARP EDGE
 *
 * `edit` maps to `can_update`, `view` to `can_read`, and — deliberately —
 * `export` to `can_read` and `publish` to `can_update`, because the permission
 * table has no dedicated columns for those. Every one of those pairings is
 * asserted here. A refactor that "tidies" the map by dropping an alias turns a
 * gated export route into an ungated one, and nothing else in the codebase
 * would notice.
 *
 * `action-authz.js` (SEC H1) duplicates this map for the AI path. Both are
 * asserted against the same expectations below, so the two cannot drift into
 * enforcing different rules — which would be worse than enforcing none, because
 * it would look correct.
 */

let MOCK_GRANTS = [];
let MOCK_SCOPE_IDS = [];
let MOCK_CAPS = { capabilities: [], is_line_manager: false };

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getGrants: async () => MOCK_GRANTS,
  getUserScopeClosure: async () => MOCK_SCOPE_IDS,
  getUserCapabilities: async () => MOCK_CAPS,
}));

let requirePermission;
let requireCapability;
let requireCeo;

const clerk = { user_id: "u-clerk", role_ids: ["r-clerk"], is_ceo: false };
const ceo = { user_id: "u-ceo", role_ids: ["r-ceo"], is_ceo: true };

const makeReq = (user) => ({ user, identityDb: (fn) => fn({}) });

/** Run a middleware; return { error, nexted, req }. */
async function run(mw, req) {
  let nexted = false;
  try {
    await mw(req, {}, () => {
      nexted = true;
    });
  } catch (err) {
    return { error: err, nexted, req };
  }
  return { error: null, nexted, req };
}

describe("RBAC enforcement (TC-C3)", () => {
  beforeEach(() => {
    MOCK_GRANTS = [];
    MOCK_SCOPE_IDS = [];
    MOCK_CAPS = { capabilities: [], is_line_manager: false };
    jest.resetModules();
    ({ requirePermission, requireCapability, requireCeo } = require("../../src/middleware/rbac"));
  });

  describe("requirePermission — the grant check", () => {
    it("allows a user holding the right column", async () => {
      MOCK_GRANTS = [{ can_update: true }];
      const { error, nexted } = await run(requirePermission("MOD-35", "edit"), makeReq(clerk));
      expect(error).toBeNull();
      expect(nexted).toBe(true);
    });

    it("denies a user holding a DIFFERENT column on the same module", async () => {
      // The most likely real-world denial, and the one a broken map would let
      // through: read access must not confer write access.
      MOCK_GRANTS = [{ can_read: true }];
      const { error, nexted } = await run(requirePermission("MOD-35", "edit"), makeReq(clerk));
      expect(nexted).toBe(false);
      expect(error.code).toBe("PERMISSION_DENIED");
      expect(error.status).toBe(403);
    });

    it("denies a user with no grants at all", async () => {
      MOCK_GRANTS = [];
      const { error } = await run(requirePermission("MOD-35", "view"), makeReq(clerk));
      expect(error.code).toBe("PERMISSION_DENIED");
    });

    it("allows when ANY of several role grants carries the column", async () => {
      MOCK_GRANTS = [{ can_read: true }, { can_delete: true }];
      const { error } = await run(requirePermission("MOD-35", "delete"), makeReq(clerk));
      expect(error).toBeNull();
    });

    it("treats a missing column as denied, not as undefined-is-fine", async () => {
      MOCK_GRANTS = [{ can_read: true }]; // can_approve absent entirely
      const { error } = await run(requirePermission("MOD-35", "approve"), makeReq(clerk));
      expect(error.code).toBe("PERMISSION_DENIED");
    });

    it("requires the column to be exactly true, not merely truthy", async () => {
      MOCK_GRANTS = [{ can_update: "false" }]; // a truthy string
      const { error } = await run(requirePermission("MOD-35", "edit"), makeReq(clerk));
      expect(error.code).toBe("PERMISSION_DENIED");
    });

    it("rejects an unauthenticated request with 401, not 403", async () => {
      const { error } = await run(requirePermission("MOD-35", "view"), { identityDb: (f) => f({}) });
      expect(error.code).toBe("AUTH_REQUIRED");
      expect(error.status).toBe(401);
    });

    it("fails loudly when tenantContext has not run", async () => {
      MOCK_GRANTS = [{ can_read: true }];
      const { error } = await run(requirePermission("MOD-35", "view"), { user: clerk });
      expect(error.code).toBe("NO_TENANT_CONTEXT");
      expect(error.status).toBe(500);
    });
  });

  describe("requirePermission — the action→column map", () => {
    const CASES = [
      ["view", "can_read"],
      ["read", "can_read"],
      ["create", "can_create"],
      ["edit", "can_update"],
      ["update", "can_update"],
      ["delete", "can_delete"],
      ["approve", "can_approve"],
      // Deliberate aliases: the permission table has no can_export/can_publish.
      ["export", "can_read"],
      ["publish", "can_update"],
    ];

    for (const [action, column] of CASES) {
      it(`maps "${action}" to ${column}`, async () => {
        MOCK_GRANTS = [{ [column]: true }];
        const { error } = await run(requirePermission("MOD-35", action), makeReq(clerk));
        expect(error).toBeNull();
      });
    }

    it("keeps the AI path's map identical to this one (SEC H1)", async () => {
      // action-authz.js gates AI-executed actions and carries its own copy of
      // the map. If the two ever disagree, the assistant enforces a different
      // rule from the HTTP route for the same action.
      const { COLUMN } = require("../../src/services/ai/action-authz");
      for (const [action, column] of CASES) {
        expect(COLUMN[action]).toBe(column);
      }
    });
  });

  describe("requirePermission — the CEO bypass", () => {
    it("admits the CEO with no grants whatsoever", async () => {
      MOCK_GRANTS = [];
      const { error, req } = await run(requirePermission("MOD-35", "delete"), makeReq(ceo));
      expect(error).toBeNull();
      expect(req.permission_scope).toBe("all");
    });

    it("leaves the CEO unscoped so no record-level filter applies", async () => {
      MOCK_SCOPE_IDS = ["scope-douala"];
      const { req } = await run(requirePermission("MOD-35", "view"), makeReq(ceo));
      expect(req.scope_ids).toBeNull();
    });
  });

  describe("requirePermission — record-level scope", () => {
    it("passes the closure through when the user is assigned to part of the tree", async () => {
      MOCK_GRANTS = [{ can_read: true }];
      MOCK_SCOPE_IDS = ["scope-hq", "scope-douala"];
      const { req } = await run(requirePermission("MOD-35", "view"), makeReq(clerk));
      expect(req.scope_ids).toEqual(["scope-hq", "scope-douala"]);
      expect(req.permission_scope).toBe("scoped");
    });

    it("treats an EMPTY closure as unrestricted, not as see-nothing", async () => {
      // A user with no scope assignment is unrestricted — the pre-existing
      // behaviour. Reading empty as "deny everything" would blank every list
      // screen for every unassigned user, which is how a scope feature gets
      // rolled back.
      MOCK_GRANTS = [{ can_read: true }];
      MOCK_SCOPE_IDS = [];
      const { req } = await run(requirePermission("MOD-35", "view"), makeReq(clerk));
      expect(req.scope_ids).toBeNull();
      expect(req.permission_scope).toBe("all");
    });
  });

  describe("requireCapability — segregation of duties", () => {
    it("denies a user without the authority even when they hold the module grant", async () => {
      MOCK_CAPS = { capabilities: ["ISSUER"], is_line_manager: false };
      const { error } = await run(requireCapability("APPROVER"), makeReq(clerk));
      expect(error.code).toBe("CAPABILITY_REQUIRED");
      expect(error.status).toBe(403);
    });

    it("allows a user holding the authority", async () => {
      MOCK_CAPS = { capabilities: ["ISSUER", "APPROVER"], is_line_manager: false };
      const { error } = await run(requireCapability("APPROVER"), makeReq(clerk));
      expect(error).toBeNull();
    });

    it("resolves LINE_MANAGER from the role flag rather than the capability list", async () => {
      MOCK_CAPS = { capabilities: [], is_line_manager: true };
      const { error } = await run(requireCapability("LINE_MANAGER"), makeReq(clerk));
      expect(error).toBeNull();
    });

    it("denies LINE_MANAGER when the flag is false, whatever else is held", async () => {
      MOCK_CAPS = { capabilities: ["APPROVER", "VALIDATOR"], is_line_manager: false };
      const { error } = await run(requireCapability("LINE_MANAGER"), makeReq(clerk));
      expect(error.code).toBe("CAPABILITY_REQUIRED");
    });

    it("gives the CEO every authority without a lookup", async () => {
      MOCK_CAPS = { capabilities: [], is_line_manager: false };
      const { error, req } = await run(requireCapability("APPROVER"), makeReq(ceo));
      expect(error).toBeNull();
      expect(req.capabilities).toContain("APPROVER");
      expect(req.is_line_manager).toBe(true);
    });

    it("refuses to be constructed without a capability code", () => {
      // A programming error, caught at mount time rather than at request time —
      // `requireCapability()` with no argument would otherwise be a gate that
      // admits everyone.
      expect(() => requireCapability()).toThrow("capability code required");
      expect(() => requireCapability("")).toThrow("capability code required");
    });
  });

  describe("requireCeo — the God Mode gate", () => {
    it("admits the CEO", async () => {
      const { error, nexted } = await run(requireCeo(), makeReq(ceo));
      expect(error).toBeNull();
      expect(nexted).toBe(true);
    });

    it("denies an ordinary user however privileged their grants", async () => {
      MOCK_GRANTS = [{ can_create: true, can_read: true, can_update: true, can_delete: true, can_approve: true }];
      const { error, nexted } = await run(requireCeo(), makeReq(clerk));
      expect(nexted).toBe(false);
      expect(error.code).toBe("PERMISSION_DENIED");
      expect(error.status).toBe(403);
    });

    it("denies an unauthenticated request with 401", async () => {
      const { error } = await run(requireCeo(), {});
      expect(error.code).toBe("AUTH_REQUIRED");
      expect(error.status).toBe(401);
    });

    it("requires is_ceo to be exactly true", async () => {
      const { error } = await run(requireCeo(), makeReq({ ...clerk, is_ceo: "yes" }));
      expect(error.code).toBe("PERMISSION_DENIED");
    });
  });
});
