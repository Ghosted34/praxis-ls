/**
 * Capability (authority overlay) assignment + the requireCapability gate.
 *
 * Two halves, both needed for the SoD layer to be real:
 *   1. requireCapability() — the gate now mounted on the highest-authority costing
 *      routes (cash-request disburse, costing status). CEO bypasses; a non-CEO
 *      without the code gets 403; LINE_MANAGER resolves off is_line_manager.
 *   2. capability.service.setForUser — the writer user_capability never had, so the
 *      gate could be satisfied for a non-CEO. Replace-all, invalidates the user's
 *      identity cache (caps live under identity:caps, which invalidateGrants does
 *      NOT clear), and emits the security-critical role.changed (Watch-the-Watcher).
 */
"use strict";

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getUserCapabilities: jest.fn(),
  invalidateUser: jest.fn(async () => {}),
  invalidateGrants: jest.fn(async () => {}),
}));
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (c, id) => id || null,
  emitEvent: jest.fn(async () => {}),
  audit: jest.fn(async () => {}),
}));

const identityCache = require("../../src/shared/cache/identity-cache");
const emit = require("../../src/shared/events/emit");
const { requireCapability } = require("../../src/middleware/rbac");

const USER = "3f1c9a10-0000-4000-8000-000000000001";

/** req whose identityDb just hands the callback a marker client. */
const reqWith = (user) => ({ user, identityDb: (fn) => fn("CLIENT") });

describe("requireCapability", () => {
  beforeEach(() => {
    identityCache.getUserCapabilities.mockReset();
    identityCache.getUserCapabilities.mockResolvedValue({
      capabilities: [],
      is_line_manager: false,
    });
  });

  it("lets the CEO through without even reading capabilities", async () => {
    const req = reqWith({ user_id: USER, is_ceo: true });
    const next = jest.fn();
    await requireCapability("APPROVER")(req, {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(identityCache.getUserCapabilities).not.toHaveBeenCalled();
    expect(req.capabilities).toContain("APPROVER");
  });

  it("403s a non-CEO who lacks the code", async () => {
    const req = reqWith({ user_id: USER, is_ceo: false });
    await expect(
      requireCapability("APPROVER")(req, {}, jest.fn()),
    ).rejects.toMatchObject({
      code: "CAPABILITY_REQUIRED",
      status: 403,
    });
  });

  it("admits a non-CEO who holds the code", async () => {
    identityCache.getUserCapabilities.mockResolvedValue({
      capabilities: ["APPROVER"],
      is_line_manager: false,
    });
    const req = reqWith({ user_id: USER, is_ceo: false });
    const next = jest.fn();
    await requireCapability("APPROVER")(req, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("resolves LINE_MANAGER off is_line_manager, not the code array", async () => {
    identityCache.getUserCapabilities.mockResolvedValue({
      capabilities: [],
      is_line_manager: true,
    });
    const req = reqWith({ user_id: USER, is_ceo: false });
    const next = jest.fn();
    await requireCapability("LINE_MANAGER")(req, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("500s if tenant context (identityDb) never ran", async () => {
    const req = { user: { user_id: USER, is_ceo: false } };
    await expect(
      requireCapability("APPROVER")(req, {}, jest.fn()),
    ).rejects.toMatchObject({
      code: "NO_TENANT_CONTEXT",
      status: 500,
    });
  });
});

describe("capability.repo user assignment", () => {
  const repo = require("../../src/modules/security/capability/capability.repo");

  it("manages only the blanket (document_type='*') rows", async () => {
    const queries = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [] };
      }),
    };
    await repo.setUserCapabilities(client, USER, ["cap-a", "cap-b"]);
    const del = queries.find((q) => q.sql.startsWith("DELETE"));
    expect(del.sql).toContain("document_type = $2");
    expect(del.params).toEqual([USER, "*"]);
    const inserts = queries.filter((q) => q.sql.startsWith("INSERT"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].sql).toContain("ON CONFLICT DO NOTHING");
    expect(inserts[0].params).toEqual([USER, "cap-a", "*"]);
  });

  it("clears blanket capabilities when given an empty list", async () => {
    const queries = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [] };
      }),
    };
    await repo.setUserCapabilities(client, USER, []);
    expect(queries.filter((q) => q.sql.startsWith("INSERT"))).toHaveLength(0);
    expect(queries.some((q) => q.sql.startsWith("DELETE"))).toBe(true);
  });
});

describe("capability.service.setForUser", () => {
  const service = require("../../src/modules/security/capability/capability.service");

  beforeEach(() => {
    identityCache.invalidateUser.mockClear();
    emit.emitEvent.mockClear();
    emit.audit.mockClear();
  });

  it("writes, invalidates the user's cache, and emits the security-critical event", async () => {
    const client = {
      query: jest.fn(async () => ({
        rows: [{ capability_id: "cap-a", code: "APPROVER" }],
      })),
    };
    const out = await service.setForUser(client, {
      userId: USER,
      capabilityIds: ["cap-a"],
      actor: { user_id: "actor-1" },
    });
    expect(identityCache.invalidateUser).toHaveBeenCalledWith(USER);
    // Must be role.changed (seeded security-critical), NOT capability.updated.
    expect(emit.emitEvent).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ eventTypeKey: "role.changed" }),
    );
    expect(emit.audit).toHaveBeenCalled();
    expect(out).toEqual([{ capability_id: "cap-a", code: "APPROVER" }]);
  });
});

describe("capability.service.setForUser — self-grant maker-checker", () => {
  const service = require("../../src/modules/security/capability/capability.service");

  /** Fake client that answers the catalogue lookup and repo.userCapabilities. */
  function capClient({ catalogue = {}, current = [] } = {}) {
    return {
      query: jest.fn(async (sql, params) => {
        if (/FROM capability WHERE capability_id = ANY/.test(sql)) {
          const ids = params[0] || [];
          return {
            rows: ids
              .filter((id) => catalogue[id])
              .map((id) => ({ capability_id: id, code: catalogue[id] })),
          };
        }
        if (/FROM user_capability uc/.test(sql)) {
          return {
            rows: current.map((id) => ({
              capability_id: id,
              code: catalogue[id],
              name: catalogue[id],
            })),
          };
        }
        return { rows: [] }; // DELETE / INSERT
      }),
    };
  }

  it("blocks a user granting THEMSELVES a new APPROVER authority", async () => {
    const client = capClient({
      catalogue: { "cap-appr": "APPROVER" },
      current: [],
    });
    await expect(
      service.setForUser(client, {
        userId: USER,
        capabilityIds: ["cap-appr"],
        actor: { user_id: USER },
      }),
    ).rejects.toMatchObject({ code: "SELF_GRANT_FORBIDDEN", status: 403 });
  });

  it("lets a user KEEP a restricted authority a different admin already granted them", async () => {
    const client = capClient({
      catalogue: { "cap-appr": "APPROVER" },
      current: ["cap-appr"],
    });
    await expect(
      service.setForUser(client, {
        userId: USER,
        capabilityIds: ["cap-appr"],
        actor: { user_id: USER },
      }),
    ).resolves.toBeDefined();
  });

  it("lets an admin grant APPROVER to a DIFFERENT user", async () => {
    const client = capClient({
      catalogue: { "cap-appr": "APPROVER" },
      current: [],
    });
    await expect(
      service.setForUser(client, {
        userId: USER,
        capabilityIds: ["cap-appr"],
        actor: { user_id: "someone-else" },
      }),
    ).resolves.toBeDefined();
  });

  it("allows self-assigning LINE_MANAGER (not a restricted authority)", async () => {
    const client = capClient({
      catalogue: { "cap-lm": "LINE_MANAGER" },
      current: [],
    });
    await expect(
      service.setForUser(client, {
        userId: USER,
        capabilityIds: ["cap-lm"],
        actor: { user_id: USER },
      }),
    ).resolves.toBeDefined();
  });

  it("allows a user clearing their own capabilities", async () => {
    const client = capClient({ catalogue: {}, current: ["cap-appr"] });
    await expect(
      service.setForUser(client, {
        userId: USER,
        capabilityIds: [],
        actor: { user_id: USER },
      }),
    ).resolves.toBeDefined();
  });
});
