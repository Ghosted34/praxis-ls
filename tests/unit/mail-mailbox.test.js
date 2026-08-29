/**
 * Mailbox lifecycle and the SMTP-only lockdown (PR-0).
 *
 * NOTE: jest.mock factories are hoisted, so any var they reference must be
 * `mock`-prefixed (jest's babel-hoist rule).
 */
"use strict";

const mockEmit = jest.fn(async () => {});
const mockAudit = jest.fn(async () => {});
const mockGetSetting = jest.fn(async () => ({}));
const mockRemoveSecret = jest.fn(async () => ({ deleted: true }));

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: (...a) => mockEmit(...a),
  audit: (...a) => mockAudit(...a),
  resolveActorId: async (_c, id) => id || null,
}));
jest.mock("../../src/shared/config/settings", () => ({
  getSetting: (...a) => mockGetSetting(...a),
}));
jest.mock("../../src/modules/security/setting/setting.service", () => ({
  SECRET_SECTION: "integration_secret",
  remove: (...a) => mockRemoveSecret(...a),
}));
jest.mock("../../src/modules/mail/mail/mailbox.repo", () => ({
  listCatalogue: jest.fn(async () => []),
  getCatalogueEntry: jest.fn(async () => null),
  upsertCatalogueEntry: jest.fn(async (_c, d) => ({ ...d })),
  updateCatalogueEntry: jest.fn(async (_c, k, p) => ({
    catalogue_key: k,
    ...p,
  })),
  listAll: jest.fn(async () => []),
  listForUser: jest.fn(async () => []),
  getConnection: jest.fn(),
  updateConnection: jest.fn(async (_c, id, p) => ({
    email_connection_id: id,
    ...p,
  })),
  personalFor: jest.fn(async () => null),
  connectionForCatalogue: jest.fn(async () => null),
  listMembers: jest.fn(async () => []),
  liveMember: jest.fn(async () => null),
  insertMember: jest.fn(async (_c, d) => ({ ...d })),
  setMemberRole: jest.fn(async () => ({})),
  revokeMember: jest.fn(async () => ({ member_role: "AGENT" })),
  revokeAllForUser: jest.fn(async () => []),
  recordAccessAudit: jest.fn(async () => ({})),
  listAccessAudit: jest.fn(async () => []),
  sendCounts: jest.fn(async () => ({ hourly: 0, daily: 0 })),
  bumpSendWindow: jest.fn(async () => ({ sent_count: 1 })),
  clearFailures: jest.fn(async () => ({})),
  bumpFailure: jest.fn(async () => ({
    consecutive_failures: 1,
    status: "CONNECTED",
  })),
}));

const repo = require("../../src/modules/mail/mail/mailbox.repo");
const mailbox = require("../../src/modules/mail/mail/mailbox.service");

const C = {};
const PERSONAL = {
  email_connection_id: "c1",
  kind: "PERSONAL",
  status: "CONNECTED",
  owner_user_id: "ada",
  email_address: "ada@t.cm",
};

beforeEach(() => {
  // clearAllMocks resets calls but NOT implementations, so every mockResolvedValue
  // a test sets would leak into the next one. Re-establish the defaults here.
  jest.clearAllMocks();
  mockGetSetting.mockResolvedValue({});
  mockRemoveSecret.mockResolvedValue({ deleted: true });
  repo.personalFor.mockResolvedValue(null);
  repo.connectionForCatalogue.mockResolvedValue(null);
  repo.getCatalogueEntry.mockResolvedValue(null);
  repo.revokeAllForUser.mockResolvedValue([]);
  repo.listMembers.mockResolvedValue([]);
  repo.liveMember.mockResolvedValue(null);
  repo.sendCounts.mockResolvedValue({ hourly: 0, daily: 0 });
  repo.listCatalogue.mockResolvedValue([]);
});

describe("one personal mailbox per person", () => {
  test("passes when the person has none", async () => {
    await expect(
      mailbox.assertNoPersonalMailbox(C, "ada"),
    ).resolves.toBeUndefined();
  });

  test("refuses a second, naming the one they already have and what to do instead", async () => {
    repo.personalFor.mockResolvedValue(PERSONAL);
    await expect(
      mailbox.assertNoPersonalMailbox(C, "ada"),
    ).rejects.toMatchObject({
      code: "PERSONAL_MAILBOX_EXISTS",
      status: 409,
    });
    const err = await mailbox.assertNoPersonalMailbox(C, "ada").catch((e) => e);
    expect(err.message).toContain("ada@t.cm");
    expect(err.message).toMatch(/shared mailbox/i);
  });
});

describe("classify", () => {
  test("a personal mailbox defaults to private and gains no members", async () => {
    await mailbox.classify(C, "c1", {
      kind: "PERSONAL",
      actor: { user_id: "ada" },
    });
    expect(repo.updateConnection).toHaveBeenCalledWith(
      C,
      "c1",
      expect.objectContaining({ kind: "PERSONAL", visibility: "PRIVATE" }),
    );
    expect(repo.insertMember).not.toHaveBeenCalled();
  });

  test("a shared mailbox defaults to team and makes its creator a manager", async () => {
    // Otherwise the person who just set it up cannot add anybody to it.
    repo.getConnection.mockResolvedValue({
      email_connection_id: "c2",
      kind: "SHARED",
      status: "CONNECTED",
    });
    await mailbox.classify(C, "c2", {
      kind: "SHARED",
      catalogueKey: "BILLING",
      actor: { user_id: "ada" },
    });
    expect(repo.updateConnection).toHaveBeenCalledWith(
      C,
      "c2",
      expect.objectContaining({
        kind: "SHARED",
        visibility: "TEAM",
        catalogue_key: "BILLING",
      }),
    );
    expect(repo.insertMember).toHaveBeenCalledWith(
      C,
      expect.objectContaining({ member_role: "MANAGER" }),
    );
  });

  test("tenant policy overrides the built-in default visibility", async () => {
    mockGetSetting.mockResolvedValue({ shared_default_visibility: "COMPANY" });
    repo.getConnection.mockResolvedValue({
      email_connection_id: "c2",
      kind: "SHARED",
      status: "CONNECTED",
    });
    await mailbox.classify(C, "c2", { kind: "SHARED", actor: {} });
    expect(repo.updateConnection).toHaveBeenCalledWith(
      C,
      "c2",
      expect.objectContaining({ visibility: "COMPANY" }),
    );
  });
});

describe("archive", () => {
  test("stops the mailbox, withdraws every grant, and keeps the mail", async () => {
    repo.getConnection.mockResolvedValue({ ...PERSONAL, kind: "SHARED" });
    repo.listMembers.mockResolvedValue([{ user_id: "u2" }, { user_id: "u3" }]);
    await mailbox.archive(C, "c1", { user_id: "admin" });
    expect(repo.updateConnection).toHaveBeenCalledWith(
      C,
      "c1",
      expect.objectContaining({ status: "ARCHIVED", is_default: false }),
    );
    expect(repo.revokeMember).toHaveBeenCalledTimes(2);
    expect(mockEmit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({ eventTypeKey: "mailbox.archived" }),
    );
  });

  test("archiving twice is a no-op", async () => {
    repo.getConnection.mockResolvedValue({ ...PERSONAL, status: "ARCHIVED" });
    await mailbox.archive(C, "c1", {});
    expect(repo.updateConnection).not.toHaveBeenCalled();
  });
});

/**
 * ── DISCONNECT ──────────────────────────────────────────────────────────────
 *
 * The action that had no button. A person could connect their mailbox in
 * Comms → Setup → My mailbox and then had no way to un-connect it: the page
 * pointed at an administrator's screen most people cannot open, where the only
 * control was "Retire" — which stops the sync and leaves the stored IMAP
 * password sitting in `integration_secret`.
 *
 * The two halves are tested separately because they fail differently, and one
 * of them is the whole reason the action exists.
 */
describe("disconnect", () => {
  test("archives AND forgets the credential — the half Retire never did", async () => {
    repo.getConnection.mockResolvedValue({ ...PERSONAL, secret_key: "mail_conn:c1" });
    await mailbox.disconnect(C, "c1", { user_id: "ada" });

    expect(repo.updateConnection).toHaveBeenCalledWith(
      C, "c1", expect.objectContaining({ status: "ARCHIVED" }),
    );
    expect(mockRemoveSecret).toHaveBeenCalledWith(
      C, expect.objectContaining({ section: "integration_secret", key: "mail_conn:c1" }),
    );
    expect(repo.updateConnection).toHaveBeenCalledWith(
      C, "c1", expect.objectContaining({ secret_key: null, token_expires_at: null }),
    );
  });

  test("it is a separate audited event, not an archive wearing a hat", async () => {
    repo.getConnection.mockResolvedValue({ ...PERSONAL, secret_key: "k" });
    await mailbox.disconnect(C, "c1", { user_id: "ada" });
    expect(repo.recordAccessAudit).toHaveBeenCalledWith(
      C, expect.objectContaining({ action: "MAILBOX_DISCONNECTED" }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      C, expect.objectContaining({ action: "mailbox.disconnected", isSensitive: true }),
    );
  });

  test("an ALREADY archived mailbox still gets its credential cleared", async () => {
    // The reason the two halves are separate: "Retire" left a live password on
    // a dead mailbox, and disconnecting one of those has to finish the job
    // rather than short-circuit on the status.
    repo.getConnection.mockResolvedValue({ ...PERSONAL, status: "ARCHIVED", secret_key: "k" });
    await mailbox.disconnect(C, "c1", { user_id: "ada" });
    expect(mockRemoveSecret).toHaveBeenCalled();
  });

  test("a settings row that is already gone is the state we wanted", async () => {
    repo.getConnection.mockResolvedValue({ ...PERSONAL, secret_key: "k" });
    const gone = new Error("no such setting");
    gone.code = "NOT_FOUND";
    mockRemoveSecret.mockRejectedValueOnce(gone);
    await expect(mailbox.disconnect(C, "c1", {})).resolves.toBeTruthy();
  });

  test("an unknown mailbox is a 404", async () => {
    repo.getConnection.mockResolvedValue(null);
    await expect(mailbox.disconnect(C, "nope", {})).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("handover", () => {
  test("converts a personal mailbox and records who did it to whom", async () => {
    // access.grant re-reads the connection after the update. In a transaction it
    // sees SHARED; the mock has to behave the same way or it tests the mock.
    let kind = "PERSONAL";
    repo.getConnection.mockImplementation(async () => ({ ...PERSONAL, kind }));
    repo.updateConnection.mockImplementation(async (_c, id, p) => {
      if (p.kind) kind = p.kind;
      return { email_connection_id: id, ...p };
    });
    repo.getCatalogueEntry.mockResolvedValue({
      catalogue_key: "SUPPORT",
      label_en: "Customer Support",
    });
    await mailbox.handover(C, "c1", {
      catalogueKey: "SUPPORT",
      actor: { user_id: "admin" },
    });
    expect(repo.updateConnection).toHaveBeenCalledWith(
      C,
      "c1",
      expect.objectContaining({ kind: "SHARED", catalogue_key: "SUPPORT" }),
    );
    expect(repo.recordAccessAudit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({
        action: "MAILBOX_HANDOVER",
        detail: expect.objectContaining({ previous_owner: "ada" }),
      }),
    );
    // Taking one person's correspondence and showing it to a team is sensitive.
    expect(mockAudit).toHaveBeenCalledWith(
      C,
      expect.objectContaining({ isSensitive: true }),
    );
  });

  test("refuses a mailbox that is already shared", async () => {
    repo.getConnection.mockResolvedValue({ ...PERSONAL, kind: "SHARED" });
    await expect(
      mailbox.handover(C, "c1", { actor: {} }),
    ).rejects.toMatchObject({ code: "NOT_PERSONAL" });
  });

  test("refuses a catalogue slot another mailbox already fills", async () => {
    repo.getConnection.mockResolvedValue(PERSONAL);
    repo.getCatalogueEntry.mockResolvedValue({
      catalogue_key: "SUPPORT",
      label_en: "Customer Support",
    });
    repo.connectionForCatalogue.mockResolvedValue({
      email_address: "support@t.cm",
    });
    await expect(
      mailbox.handover(C, "c1", { catalogueKey: "SUPPORT", actor: {} }),
    ).rejects.toMatchObject({ code: "CATALOGUE_TAKEN" });
  });
});

describe("offboardUser", () => {
  test("archives their mailbox and withdraws every grant they held", async () => {
    repo.personalFor.mockResolvedValue(PERSONAL);
    repo.getConnection.mockResolvedValue(PERSONAL);
    repo.revokeAllForUser.mockResolvedValue([
      { email_connection_id: "c-shared" },
    ]);
    const r = await mailbox.offboardUser(C, "ada", { user_id: "admin" });
    expect(r).toEqual({ archived_personal: true, grants_revoked: 1 });
  });

  test("is safe to run for somebody with no mailbox at all", async () => {
    const r = await mailbox.offboardUser(C, "nobody", { user_id: "admin" });
    expect(r).toEqual({ archived_personal: false, grants_revoked: 0 });
  });
});

describe("checkSendAllowance", () => {
  test("reports the effective limits alongside the verdict", async () => {
    repo.getConnection.mockResolvedValue({ ...PERSONAL, send_limit_hourly: 5 });
    mockGetSetting.mockResolvedValue({ send_limit_daily: 20 });
    repo.sendCounts.mockResolvedValue({ hourly: 5, daily: 5 });
    const a = await mailbox.checkSendAllowance(C, "c1", 1);
    expect(a.allowed).toBe(false);
    expect(a.reason).toBe("HOURLY_LIMIT");
    expect(a.limits).toEqual(
      expect.objectContaining({ send_limit_hourly: 5, send_limit_daily: 20 }),
    );
  });

  test("an unknown mailbox is a 404, not a silent allow", async () => {
    repo.getConnection.mockResolvedValue(null);
    await expect(mailbox.checkSendAllowance(C, "nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("setLimits", () => {
  test("null clears the override so the tenant default applies again", async () => {
    repo.getConnection.mockResolvedValue(PERSONAL);
    await mailbox.setLimits(
      C,
      "c1",
      { send_limit_hourly: null },
      { user_id: "admin" },
    );
    expect(repo.updateConnection).toHaveBeenCalledWith(C, "c1", {
      send_limit_hourly: null,
    });
  });

  test("an empty patch changes nothing", async () => {
    repo.getConnection.mockResolvedValue(PERSONAL);
    await mailbox.setLimits(C, "c1", {}, {});
    expect(repo.updateConnection).not.toHaveBeenCalled();
  });
});

describe("catalogue", () => {
  test("a new entry is normalised into a safe key and local part", async () => {
    const row = await mailbox.addCatalogueEntry(
      C,
      { catalogue_key: " claims desk ", label_en: "Claims" },
      {},
    );
    expect(row.catalogue_key).toBe("CLAIMS_DESK");
    expect(row.is_system).toBe(false);
  });

  test("a duplicate key is refused", async () => {
    repo.getCatalogueEntry.mockResolvedValue({ catalogue_key: "BILLING" });
    await expect(
      mailbox.addCatalogueEntry(
        C,
        { catalogue_key: "BILLING", label_en: "x" },
        {},
      ),
    ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
  });

  test("listing marks which slots are actually filled", async () => {
    repo.listCatalogue.mockResolvedValue([
      {
        catalogue_key: "BILLING",
        label_en: "Billing",
        label_fr: "Facturation",
        email_connection_id: "c2",
        email_address: "billing@t.cm",
      },
      {
        catalogue_key: "HR",
        label_en: "HR",
        label_fr: "RH",
        email_connection_id: null,
      },
    ]);
    const rows = await mailbox.listCatalogue(C);
    expect(rows.map((r) => r.configured)).toEqual([true, false]);
  });
});
