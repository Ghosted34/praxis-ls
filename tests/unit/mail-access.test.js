/**
 * Mailbox access grants (PR-0).
 *
 * NOTE: jest.mock factories are hoisted, so any var they reference must be
 * `mock`-prefixed (jest's babel-hoist rule).
 */
"use strict";

const mockEmit = jest.fn(async () => {});
const mockAudit = jest.fn(async () => {});

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: (...a) => mockEmit(...a),
  audit: (...a) => mockAudit(...a),
  resolveActorId: async (_c, id) => id || null,
}));
jest.mock("../../src/modules/mail/mail/mailbox.repo", () => ({
  getConnection: jest.fn(),
  liveMember: jest.fn(async () => null),
  insertMember: jest.fn(async (_c, d) => ({ ...d })),
  setMemberRole: jest.fn(async (_c, cid, uid, role) => ({
    email_connection_id: cid,
    user_id: uid,
    member_role: role,
  })),
  revokeMember: jest.fn(async () => ({ member_role: "AGENT" })),
  recordAccessAudit: jest.fn(async () => ({})),
  listMembers: jest.fn(async () => []),
  listAccessAudit: jest.fn(async () => []),
}));

const repo = require("../../src/modules/mail/mail/mailbox.repo");
const access = require("../../src/modules/mail/mail/access");

const C = {};
const SHARED = {
  email_connection_id: "c-shared",
  kind: "SHARED",
  status: "CONNECTED",
  owner_user_id: "owner",
  email_address: "billing@t.cm",
};
const PERSONAL = {
  email_connection_id: "c-mine",
  kind: "PERSONAL",
  status: "CONNECTED",
  owner_user_id: "ada",
  email_address: "ada@t.cm",
};

beforeEach(() => {
  jest.clearAllMocks();
  repo.liveMember.mockResolvedValue(null);
});

describe("roleFor", () => {
  test("the owner of a personal mailbox is its access; nobody else has any", async () => {
    repo.getConnection.mockResolvedValue(PERSONAL);
    expect(await access.roleFor(C, "c-mine", "ada")).toBe("OWNER");
    expect(await access.roleFor(C, "c-mine", "someone-else")).toBeNull();
  });

  test("the owner of a shared mailbox administers it even with no grant row", async () => {
    // A mailbox created before the membership table, or one whose grant was
    // revoked by mistake, must not lock its own creator out.
    repo.getConnection.mockResolvedValue(SHARED);
    repo.liveMember.mockResolvedValue(null);
    expect(await access.roleFor(C, "c-shared", "owner")).toBe("MANAGER");
  });

  test("a member gets the role their grant says", async () => {
    repo.getConnection.mockResolvedValue(SHARED);
    repo.liveMember.mockResolvedValue({ member_role: "VIEWER" });
    expect(await access.roleFor(C, "c-shared", "u2")).toBe("VIEWER");
  });

  test("an archived mailbox grants nobody anything", async () => {
    repo.getConnection.mockResolvedValue({ ...SHARED, status: "ARCHIVED" });
    repo.liveMember.mockResolvedValue({ member_role: "MANAGER" });
    expect(await access.roleFor(C, "c-shared", "u2")).toBeNull();
  });

  test("an unknown mailbox and an anonymous caller both get nothing", async () => {
    repo.getConnection.mockResolvedValue(null);
    expect(await access.roleFor(C, "nope", "u2")).toBeNull();
    expect(await access.roleFor(C, "c-shared", null)).toBeNull();
  });
});

describe("the role ladder", () => {
  test.each([
    ["VIEWER", true, false, false],
    ["AGENT", true, true, false],
    ["MANAGER", true, true, true],
  ])(
    "%s: read=%s send=%s manage=%s",
    async (role, canRead, canSend, canManage) => {
      repo.getConnection.mockResolvedValue(SHARED);
      repo.liveMember.mockResolvedValue({ member_role: role });
      const check = async (fn) =>
        fn(C, "c-shared", "u2")
          .then(() => true)
          .catch(() => false);
      expect(await check(access.assertCanRead)).toBe(canRead);
      expect(await check(access.assertCanSend)).toBe(canSend);
      expect(await check(access.assertCanManage)).toBe(canManage);
    },
  );

  test("refusal is a 403 with a code the UI can act on", async () => {
    repo.getConnection.mockResolvedValue(SHARED);
    repo.liveMember.mockResolvedValue({ member_role: "VIEWER" });
    await expect(
      access.assertCanSend(C, "c-shared", "u2"),
    ).rejects.toMatchObject({
      code: "MAILBOX_FORBIDDEN",
      status: 403,
    });
  });
});

describe("grant", () => {
  test("a personal mailbox cannot be shared — handover is the route", async () => {
    repo.getConnection.mockResolvedValue(PERSONAL);
    await expect(
      access.grant(C, {
        connectionId: "c-mine",
        userId: "u2",
        actor: { user_id: "ada" },
      }),
    ).rejects.toMatchObject({ code: "PERSONAL_MAILBOX" });
    expect(repo.insertMember).not.toHaveBeenCalled();
  });

  test("granting writes the audit row, the event and the ledger entry", async () => {
    repo.getConnection.mockResolvedValue(SHARED);
    await access.grant(C, {
      connectionId: "c-shared",
      userId: "u2",
      role: "AGENT",
      actor: { user_id: "owner" },
    });
    expect(repo.insertMember).toHaveBeenCalledWith(
      C,
      expect.objectContaining({ member_role: "AGENT", granted_by: "owner" }),
    );
    expect(repo.recordAccessAudit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({ action: "GRANTED" }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({ eventTypeKey: "mailbox.access.granted" }),
    );
    // Access changes are security-critical: they must reach the sensitive feed.
    expect(mockAudit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({ isSensitive: true }),
    );
  });

  test("re-granting the same role is a no-op, because a picker cannot know", async () => {
    repo.getConnection.mockResolvedValue(SHARED);
    repo.liveMember.mockResolvedValue({ member_role: "AGENT" });
    await access.grant(C, {
      connectionId: "c-shared",
      userId: "u2",
      role: "AGENT",
      actor: {},
    });
    expect(repo.setMemberRole).not.toHaveBeenCalled();
    expect(repo.insertMember).not.toHaveBeenCalled();
  });

  test("changing an existing member's role updates rather than duplicating", async () => {
    repo.getConnection.mockResolvedValue(SHARED);
    repo.liveMember.mockResolvedValue({ member_role: "VIEWER" });
    await access.grant(C, {
      connectionId: "c-shared",
      userId: "u2",
      role: "MANAGER",
      actor: {},
    });
    expect(repo.setMemberRole).toHaveBeenCalled();
    expect(repo.insertMember).not.toHaveBeenCalled();
    expect(repo.recordAccessAudit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({
        action: "ROLE_CHANGED",
        detail: expect.objectContaining({ previous_role: "VIEWER" }),
      }),
    );
  });

  test("an unknown role is refused before anything is written", async () => {
    repo.getConnection.mockResolvedValue(SHARED);
    await expect(
      access.grant(C, {
        connectionId: "c-shared",
        userId: "u2",
        role: "ADMIN",
        actor: {},
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("revoke", () => {
  test("records the withdrawal and says what was lost", async () => {
    repo.getConnection.mockResolvedValue(SHARED);
    const r = await access.revoke(C, {
      connectionId: "c-shared",
      userId: "u2",
      actor: { user_id: "owner" },
    });
    expect(r).toEqual({ revoked: true, member_role: "AGENT" });
    expect(mockEmit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({ eventTypeKey: "mailbox.access.revoked" }),
    );
  });

  test("revoking a grant that is not there is not an error", async () => {
    repo.getConnection.mockResolvedValue(SHARED);
    repo.revokeMember.mockResolvedValue(null);
    expect(
      await access.revoke(C, {
        connectionId: "c-shared",
        userId: "u2",
        actor: {},
      }),
    ).toEqual({ revoked: false });
  });
});

describe("recordSentAs", () => {
  test("names the human behind a team address", async () => {
    await access.recordSentAs(C, {
      connectionId: "c-shared",
      actor: { user_id: "u2" },
      to: ["client@x.cm"],
      subject: "Invoice",
    });
    expect(repo.recordAccessAudit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({
        action: "SENT_AS",
        subject_user_id: "u2",
      }),
    );
  });

  test("a failed audit write never fails the send", async () => {
    repo.recordAccessAudit.mockRejectedValueOnce(new Error("db down"));
    await expect(
      access.recordSentAs(C, {
        connectionId: "c-shared",
        actor: {},
        to: "x@y.cm",
      }),
    ).resolves.toBeUndefined();
  });
});
