"use strict";
// Self-service password reset flow (doc/PLAN §1). The service is dependency-heavy
// (repo/email/cache/sessions), so those are mocked and we assert the security
// behaviours: no account enumeration on request, single-use + expiry on the token,
// policy enforcement before any write, and force-logout of all sessions on success.

jest.mock("argon2", () => ({ argon2id: 2, hash: jest.fn().mockResolvedValue("argon2-hash"), verify: jest.fn() }));
jest.mock("../../src/config/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.mock("../../src/shared/events/emit", () => ({ emitEvent: jest.fn(), audit: jest.fn() }));
jest.mock("../../src/services/email.service", () => ({ send: jest.fn().mockResolvedValue({}) }));
jest.mock("../../src/shared/cache/identity-cache", () => ({ invalidateUser: jest.fn() }));
jest.mock("../../src/shared/cache/session-store", () => ({ removeSession: jest.fn(), indexSession: jest.fn() }));
jest.mock("../../src/shared/security/password-policy", () => ({
  assertStrongPassword: jest.fn().mockResolvedValue({ breachChecked: true }),
  MIN_LENGTH: 12,
}));
jest.mock("../../src/modules/security/app_user/app_user.repo");

const repo = require("../../src/modules/security/app_user/app_user.repo");
const emailService = require("../../src/services/email.service");
const sessionStore = require("../../src/shared/cache/session-store");
const identityCache = require("../../src/shared/cache/identity-cache");
const policy = require("../../src/shared/security/password-policy");
const svc = require("../../src/modules/security/app_user/app_user.service");

const fakeClient = () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) });
const ACTIVE_USER = { user_id: "u-1", email: "user@acme.com", full_name: "Ada Lovelace", status: "ACTIVE" };

describe("requestPasswordReset — no account enumeration", () => {
  test("active user: creates a token and sends the email", async () => {
    repo.findByEmail.mockResolvedValue(ACTIVE_USER);
    repo.invalidateUserResets.mockResolvedValue();
    repo.createResetToken.mockResolvedValue("reset-1");
    const out = await svc.requestPasswordReset(fakeClient(), { email: "user@acme.com", ip: "1.1.1.1", origin: "https://acme.praxisls.com" });
    expect(out).toEqual({ ok: true });
    expect(repo.createResetToken).toHaveBeenCalledTimes(1);
    expect(emailService.send).toHaveBeenCalledTimes(1);
    // Link points back at the requesting origin and carries a token param.
    const mail = emailService.send.mock.calls[0][1];
    expect(mail.to).toBe("user@acme.com");
    expect(mail.html).toMatch(/https:\/\/acme\.praxisls\.com\/reset-password\?token=/);
  });

  test("unknown email: same { ok:true }, but NO token and NO email", async () => {
    repo.findByEmail.mockResolvedValue(null);
    const out = await svc.requestPasswordReset(fakeClient(), { email: "ghost@acme.com" });
    expect(out).toEqual({ ok: true });
    expect(repo.createResetToken).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  test("inactive user: no token issued", async () => {
    repo.findByEmail.mockResolvedValue({ ...ACTIVE_USER, status: "SUSPENDED" });
    const out = await svc.requestPasswordReset(fakeClient(), { email: "user@acme.com" });
    expect(out).toEqual({ ok: true });
    expect(repo.createResetToken).not.toHaveBeenCalled();
  });

  test("email transport failure does not change the response", async () => {
    repo.findByEmail.mockResolvedValue(ACTIVE_USER);
    repo.createResetToken.mockResolvedValue("reset-1");
    emailService.send.mockRejectedValueOnce(new Error("smtp down"));
    const out = await svc.requestPasswordReset(fakeClient(), { email: "user@acme.com" });
    expect(out).toEqual({ ok: true }); // token still created; error swallowed + logged
  });
});

describe("resetPassword — token validation + force logout", () => {
  const future = new Date(Date.now() + 10 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 1000);

  test("valid token: sets password, marks used, kills ALL sessions", async () => {
    repo.findResetByHash.mockResolvedValue({ reset_id: "r-1", user_id: "u-1", expires_at: future, used_at: null });
    repo.getUserSafe.mockResolvedValue(ACTIVE_USER);
    repo.setPasswordHash.mockResolvedValue(ACTIVE_USER);
    repo.markResetUsed.mockResolvedValue();
    repo.killAllSessionsForUser.mockResolvedValue(["s-1", "s-2"]);

    const out = await svc.resetPassword(fakeClient(), { token: "raw-token", newPassword: "Zt9$vQ2m!pLwR", ip: "1.1.1.1" });
    expect(out).toEqual({ reset: true });
    expect(policy.assertStrongPassword).toHaveBeenCalledWith("Zt9$vQ2m!pLwR", { email: "user@acme.com" });
    expect(repo.setPasswordHash).toHaveBeenCalledTimes(1);
    expect(repo.markResetUsed).toHaveBeenCalledWith(expect.anything(), "r-1");
    expect(repo.killAllSessionsForUser).toHaveBeenCalledWith(expect.anything(), "u-1", "u-1");
    expect(identityCache.invalidateUser).toHaveBeenCalledWith("u-1");
    expect(sessionStore.removeSession).toHaveBeenCalledTimes(2);
  });

  test("expired token is rejected and writes nothing", async () => {
    repo.findResetByHash.mockResolvedValue({ reset_id: "r-1", user_id: "u-1", expires_at: past, used_at: null });
    await expect(svc.resetPassword(fakeClient(), { token: "raw", newPassword: "Zt9$vQ2m!pLwR" }))
      .rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
    expect(repo.setPasswordHash).not.toHaveBeenCalled();
  });

  test("already-used token is rejected", async () => {
    repo.findResetByHash.mockResolvedValue({ reset_id: "r-1", user_id: "u-1", expires_at: future, used_at: new Date() });
    await expect(svc.resetPassword(fakeClient(), { token: "raw", newPassword: "Zt9$vQ2m!pLwR" }))
      .rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
  });

  test("unknown token is rejected", async () => {
    repo.findResetByHash.mockResolvedValue(null);
    await expect(svc.resetPassword(fakeClient(), { token: "raw", newPassword: "Zt9$vQ2m!pLwR" }))
      .rejects.toMatchObject({ code: "INVALID_RESET_TOKEN" });
  });

  test("weak password is rejected BEFORE any password write", async () => {
    repo.findResetByHash.mockResolvedValue({ reset_id: "r-1", user_id: "u-1", expires_at: future, used_at: null });
    repo.getUserSafe.mockResolvedValue(ACTIVE_USER);
    const err = Object.assign(new Error("weak"), { code: "WEAK_PASSWORD", status: 422 });
    policy.assertStrongPassword.mockRejectedValueOnce(err);
    await expect(svc.resetPassword(fakeClient(), { token: "raw", newPassword: "weak" }))
      .rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    expect(repo.setPasswordHash).not.toHaveBeenCalled();
    expect(repo.killAllSessionsForUser).not.toHaveBeenCalled();
  });
});
