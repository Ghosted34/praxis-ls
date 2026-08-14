"use strict";
// Self-service password CHANGE (signed in, proving the current password). The
// sibling of password-reset.test.js: same dependency-heavy service, same mocking
// strategy, and the same reason for existing — the security behaviours here are
// decisions, and they should be assertable without a database.
//
// What is asserted: the current password is actually verified (a token alone is
// not enough), the wrong-password answer is 403 and not 401, policy runs before
// any write, outstanding reset links are voided, and the caller's own session
// survives while every other one is killed.

jest.mock("argon2", () => ({
  argon2id: 2,
  hash: jest.fn().mockResolvedValue("argon2-hash"),
  verify: jest.fn(),
}));
jest.mock("../../src/config/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (c, id) => id || null,
  emitEvent: jest.fn(),
  audit: jest.fn(),
}));
jest.mock("../../src/services/email.service", () => ({
  send: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../src/shared/cache/identity-cache", () => ({
  invalidateUser: jest.fn(),
}));
jest.mock("../../src/shared/cache/session-store", () => ({
  removeSession: jest.fn(),
  indexSession: jest.fn(),
}));
jest.mock("../../src/shared/security/password-policy", () => ({
  assertStrongPassword: jest.fn().mockResolvedValue({ breachChecked: true }),
  MIN_LENGTH: 12,
}));
jest.mock("../../src/modules/security/app_user/app_user.repo");
jest.mock("../../src/modules/notification/notification.repo");

const argon2 = require("argon2");
const repo = require("../../src/modules/security/app_user/app_user.repo");
const notificationRepo = require("../../src/modules/notification/notification.repo");
const sessionStore = require("../../src/shared/cache/session-store");
const identityCache = require("../../src/shared/cache/identity-cache");
const policy = require("../../src/shared/security/password-policy");
const svc = require("../../src/modules/security/app_user/app_user.service");

const fakeClient = () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) });
const USER = {
  user_id: "u-1",
  email: "user@acme.com",
  full_name: "Ada Lovelace",
  status: "ACTIVE",
  password_hash: "argon2-current",
};
const NEW_PASSWORD = "Zt9$vQ2m!pLwR";

beforeEach(() => {
  jest.clearAllMocks();
  policy.assertStrongPassword.mockResolvedValue({ breachChecked: true });
  argon2.hash.mockResolvedValue("argon2-hash");
  repo.getUserWithHash.mockResolvedValue(USER);
  repo.setPasswordHash.mockResolvedValue(USER);
  repo.invalidateUserResets.mockResolvedValue();
  repo.killOtherSessionsForUser.mockResolvedValue([]);
  notificationRepo.insertForUser.mockResolvedValue({});
});

describe("changeOwnPassword — proving the current password", () => {
  test("correct current password: rehashes, voids reset links, keeps this session", async () => {
    argon2.verify.mockResolvedValue(true);
    repo.killOtherSessionsForUser.mockResolvedValue(["s-2", "s-3"]);

    const out = await svc.changeOwnPassword(fakeClient(), {
      userId: "u-1",
      currentPassword: "old-one",
      newPassword: NEW_PASSWORD,
      sessionId: "s-1",
      ip: "1.1.1.1",
    });

    expect(out).toEqual({ changed: true, sessions_signed_out: 2 });
    expect(argon2.verify).toHaveBeenCalledWith("argon2-current", "old-one");
    expect(policy.assertStrongPassword).toHaveBeenCalledWith(NEW_PASSWORD, {
      email: "user@acme.com",
    });
    expect(repo.setPasswordHash).toHaveBeenCalledTimes(1);
    // A link mailed before the change must not outlive it.
    expect(repo.invalidateUserResets).toHaveBeenCalledWith(
      expect.anything(),
      "u-1",
    );
    // s-1 is the caller's own session and is spared — the repo is told to keep it.
    expect(repo.killOtherSessionsForUser).toHaveBeenCalledWith(
      expect.anything(),
      "u-1",
      "s-1",
      "u-1",
    );
    expect(sessionStore.removeSession).toHaveBeenCalledTimes(2);
    expect(identityCache.invalidateUser).toHaveBeenCalledWith("u-1");
    expect(notificationRepo.insertForUser).toHaveBeenCalledTimes(1);
  });

  test("wrong current password: 403 (not 401) and nothing is written", async () => {
    argon2.verify.mockResolvedValue(false);

    await expect(
      svc.changeOwnPassword(fakeClient(), {
        userId: "u-1",
        currentPassword: "not-it",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CURRENT_PASSWORD", status: 403 });

    expect(repo.setPasswordHash).not.toHaveBeenCalled();
    expect(repo.killOtherSessionsForUser).not.toHaveBeenCalled();
    // The policy (and its outbound HIBP call) never runs for a failed proof.
    expect(policy.assertStrongPassword).not.toHaveBeenCalled();
  });

  test("an argon2 error counts as a failed proof, never as a pass", async () => {
    argon2.verify.mockRejectedValue(new Error("malformed hash"));

    await expect(
      svc.changeOwnPassword(fakeClient(), {
        userId: "u-1",
        currentPassword: "old-one",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CURRENT_PASSWORD" });
    expect(repo.setPasswordHash).not.toHaveBeenCalled();
  });

  test("reusing the same password is refused", async () => {
    argon2.verify.mockResolvedValue(true);

    await expect(
      svc.changeOwnPassword(fakeClient(), {
        userId: "u-1",
        currentPassword: NEW_PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "SAME_PASSWORD", status: 422 });
    expect(repo.setPasswordHash).not.toHaveBeenCalled();
  });

  test("weak password is rejected BEFORE any write", async () => {
    argon2.verify.mockResolvedValue(true);
    policy.assertStrongPassword.mockRejectedValueOnce(
      Object.assign(new Error("weak"), { code: "WEAK_PASSWORD", status: 422 }),
    );

    await expect(
      svc.changeOwnPassword(fakeClient(), {
        userId: "u-1",
        currentPassword: "old-one",
        newPassword: "short",
      }),
    ).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    expect(repo.setPasswordHash).not.toHaveBeenCalled();
    expect(repo.killOtherSessionsForUser).not.toHaveBeenCalled();
  });

  test("a suspended account cannot change its password on a still-live token", async () => {
    repo.getUserWithHash.mockResolvedValue({ ...USER, status: "SUSPENDED" });

    await expect(
      svc.changeOwnPassword(fakeClient(), {
        userId: "u-1",
        currentPassword: "old-one",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(argon2.verify).not.toHaveBeenCalled();
  });

  test("a failed write rolls back and does not invalidate the identity cache", async () => {
    argon2.verify.mockResolvedValue(true);
    repo.setPasswordHash.mockRejectedValueOnce(new Error("db down"));
    const client = fakeClient();

    await expect(
      svc.changeOwnPassword(client, {
        userId: "u-1",
        currentPassword: "old-one",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow("db down");

    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(identityCache.invalidateUser).not.toHaveBeenCalled();
  });
});
