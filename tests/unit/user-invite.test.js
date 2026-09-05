"use strict";
/**
 * PROVISIONING BY INVITATION — creating a login without anybody typing a password.
 *
 * ── WHY THIS PATH EXISTS ───────────────────────────────────────────────────
 *
 * `POST /users` used to demand a `password`, which means provisioning somebody's
 * account requires an administrator to invent a credential and then transmit it
 * — over WhatsApp, on a sticky note, in a mail nobody deletes. The credential is
 * known to two people from the moment it exists, and the one who did not choose
 * it usually never changes it.
 *
 * `invite: true` replaces that: the row is created with a random hash nobody
 * holds, and a single-use activation link goes to the address on the record. It
 * is what "Provision account" on an employee dossier calls, and it is what the
 * legacy system did (`must_set_password = 1` plus an emailed token).
 *
 * The properties below are the ones that make it safe rather than merely
 * convenient, so they are asserted rather than assumed.
 */

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
jest.mock("../../src/shared/db/sandbox-user-mirror", () => ({
  mirrorUserBestEffort: jest.fn(),
}));
jest.mock("../../src/modules/security/app_user/app_user.repo");

const argon2 = require("argon2");
const repo = require("../../src/modules/security/app_user/app_user.repo");
const emailService = require("../../src/services/email.service");
const policy = require("../../src/shared/security/password-policy");
const svc = require("../../src/modules/security/app_user/app_user.service");

const NEW_USER = {
  user_id: "u-9",
  email: "florence@smartls.cm",
  full_name: "SPECIMEN Marie Claire",
  status: "ACTIVE",
};

/** Answers the entity-name lookup the invitation uses to brand its subject. */
const fakeClient = () => ({
  query: jest.fn().mockImplementation(async (sql) =>
    /FROM corporate_entity/i.test(sql)
      ? { rows: [{ legal_name: "SMART LOGISTICS & SERVICES LIMITED" }] }
      : { rows: [] },
  ),
});

beforeEach(() => {
  jest.clearAllMocks();
  repo.insertUser.mockResolvedValue(NEW_USER);
  repo.getUserSafe.mockResolvedValue(NEW_USER);
  repo.roleIds.mockResolvedValue([]);
  repo.setRoles.mockResolvedValue();
  repo.invalidateUserResets.mockResolvedValue();
  repo.createResetToken.mockResolvedValue("t-1");
  // The employee link is checked before the insert (see the guard test below);
  // the default here is "the record is there", which is the ordinary case.
  repo.employeeExists.mockResolvedValue(true);
});

describe("creating a login by invitation", () => {
  test("no password is required, and none is ever transmitted", async () => {
    const out = await svc.createUser(fakeClient(), {
      data: {
        email: "florence@smartls.cm",
        full_name: "SPECIMEN Marie Claire",
        invite: true,
        employee_id: "emp-1",
      },
      origin: "https://smartls.praxisls.com",
    });
    expect(out.invitation).toMatchObject({ sent: true, email: "florence@smartls.cm" });
    // The password policy is not consulted, because there is no password.
    expect(policy.assertStrongPassword).not.toHaveBeenCalled();
    // A hash IS stored: `password_hash` is NOT NULL, and an empty string would
    // make the column mean "unusable" in one row and "a hash" in every other.
    const stored = repo.insertUser.mock.calls[0][1];
    expect(stored.password_hash).toBe("argon2-hash");
    // …and what was hashed is 48 random bytes nobody holds, not a guessable seed.
    const secret = argon2.hash.mock.calls[0][0];
    expect(secret).toMatch(/^[0-9a-f]{96}$/);
  });

  test("the invited account is ACTIVE, or the invitation could not be redeemed", async () => {
    // `resetPassword` refuses a non-ACTIVE user, so creating them SUSPENDED
    // would mail a link that bounces off its own gate.
    await svc.createUser(fakeClient(), {
      data: { email: "a@b.cm", full_name: "A B", invite: true, status: "SUSPENDED" },
    });
    expect(repo.insertUser.mock.calls[0][1].status).toBe("ACTIVE");
  });

  test("the employee link is carried onto the account", async () => {
    await svc.createUser(fakeClient(), {
      data: { email: "a@b.cm", full_name: "A B", invite: true, employee_id: "emp-7" },
    });
    expect(repo.insertUser.mock.calls[0][1].employee_id).toBe("emp-7");
  });

  test("an employee who is not in the LIVE schema is refused, by name", async () => {
    /*
     * The failure this prevents is specific and it was reachable from a button.
     * "Provision account" on an employee dossier reads that record through
     * `req.tenantDb`, so in TEST mode it hands over a SANDBOX employee id —
     * and `app_user` lives in the live schema, where the row does not exist.
     * `update` has validated this since it was written; `create` never did, so
     * the answer was a raw 23503 naming a constraint instead of a cause.
     */
    repo.employeeExists.mockResolvedValue(false);
    await expect(
      svc.createUser(fakeClient(), {
        data: { email: "a@b.cm", full_name: "A B", invite: true, employee_id: "sandbox-emp" },
      }),
    ).rejects.toMatchObject({ code: "EMPLOYEE_NOT_FOUND", status: 422 });
    // Refused BEFORE the transaction: no half-created login to clean up.
    expect(repo.insertUser).not.toHaveBeenCalled();
  });

  test("a login with no employee link never asks whether the employee exists", async () => {
    await svc.createUser(fakeClient(), {
      data: { email: "a@b.cm", full_name: "A B", invite: true },
    });
    expect(repo.employeeExists).not.toHaveBeenCalled();
  });

  test("the activation link points back at the requesting workspace", async () => {
    await svc.createUser(fakeClient(), {
      data: { email: "a@b.cm", full_name: "A B", invite: true },
      origin: "https://smartls.praxisls.com",
    });
    const mail = emailService.send.mock.calls[0][1];
    expect(mail.html).toMatch(/https:\/\/smartls\.praxisls\.com\/reset-password\?token=/);
    // Branded with the tenant's own name — an invitation from "Praxis LS" to
    // somebody who has never heard of Praxis LS reads as phishing.
    expect(mail.subject).toMatch(/SMART LOGISTICS & SERVICES LIMITED/);
  });

  test("only a HASH of the token is stored", async () => {
    await svc.createUser(fakeClient(), {
      data: { email: "a@b.cm", full_name: "A B", invite: true },
    });
    const { tokenHash } = repo.createResetToken.mock.calls[0][1];
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The live token appears in the email and nowhere else.
    const mail = emailService.send.mock.calls[0][1];
    expect(mail.html).not.toContain(tokenHash);
  });

  test("the invitation lasts days, not the reset flow's thirty minutes", async () => {
    // Somebody provisioned on a Thursday afternoon reads their mail on Monday.
    await svc.createUser(fakeClient(), {
      data: { email: "a@b.cm", full_name: "A B", invite: true },
    });
    const { expiresAt } = repo.createResetToken.mock.calls[0][1];
    const hours = (expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(48);
  });

  test("a mail failure does not undo the account — it is reported instead", async () => {
    emailService.send.mockRejectedValueOnce(new Error("SMTP down"));
    const out = await svc.createUser(fakeClient(), {
      data: { email: "a@b.cm", full_name: "A B", invite: true },
    });
    expect(out.user_id).toBe("u-9");
    expect(out.invitation.sent).toBe(false);
    expect(out.invitation.error).toMatch(/Resend invitation/);
  });
});

describe("the password path still works, and is still the exception", () => {
  test("a typed password is hashed and the full policy runs", async () => {
    await svc.createUser(fakeClient(), {
      data: { email: "a@b.cm", full_name: "A B", password: "Correct-Horse-9!" },
    });
    expect(policy.assertStrongPassword).toHaveBeenCalledWith("Correct-Horse-9!", {
      email: "a@b.cm",
    });
    expect(argon2.hash.mock.calls[0][0]).toBe("Correct-Horse-9!");
    expect(emailService.send).not.toHaveBeenCalled();
  });

  test("neither a password nor an invitation is refused, naming both ways out", async () => {
    await expect(
      svc.createUser(fakeClient(), { data: { email: "a@b.cm", full_name: "A B" } }),
    ).rejects.toMatchObject({
      code: "PASSWORD_REQUIRED",
      status: 422,
    });
    expect(repo.insertUser).not.toHaveBeenCalled();
  });
});

describe("re-sending an invitation", () => {
  test("a fresh link invalidates the outstanding one", async () => {
    // One live link at a time: an expired invitation people keep clicking is
    // worse than none, and two valid links are two ways in.
    await svc.issueInvite(fakeClient(), { userId: "u-9" });
    expect(repo.invalidateUserResets).toHaveBeenCalledWith(expect.anything(), "u-9");
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  test("a suspended account is refused rather than mailed a dead link", async () => {
    repo.getUserSafe.mockResolvedValue({ ...NEW_USER, status: "SUSPENDED" });
    await expect(svc.issueInvite(fakeClient(), { userId: "u-9" })).rejects.toMatchObject({
      code: "USER_NOT_ACTIVE",
    });
    expect(emailService.send).not.toHaveBeenCalled();
  });

  test("an unknown user is a 404, not a silent success", async () => {
    // Unlike forgot-password, the caller here is an administrator who just typed
    // the address — hiding the failure to avoid enumeration would hide a typo.
    repo.getUserSafe.mockResolvedValue(null);
    await expect(svc.issueInvite(fakeClient(), { userId: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});
