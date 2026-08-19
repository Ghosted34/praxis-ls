/**
 * SMTP-only lockdown and the cPanel preset (PR-0).
 *
 * The Microsoft Graph and Gmail adapters are built, tested and working. This
 * programme deliberately does ONE provider properly first — the one the first
 * tenant runs — so they are gated rather than deleted, and these tests prove the
 * gate is on the server and not only on the button.
 *
 * NOTE: jest.mock factories are hoisted, so any var they reference must be
 * `mock`-prefixed (jest's babel-hoist rule).
 */
"use strict";

const mockVerify = jest.fn(async () => ({ ok: true }));

jest.mock("../../src/modules/mail/mail/providers/imapSmtp.provider", () => ({
  ImapSmtpProvider: jest
    .fn()
    .mockImplementation(() => ({ verify: mockVerify })),
}));
jest.mock("../../src/modules/security/setting/setting.service", () => ({
  SECRET_SECTION: "integration_secret",
  put: jest.fn(async () => ({})),
  readSecret: jest.fn(async () => "pw"),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => {}),
  audit: jest.fn(async () => {}),
  resolveActorId: async (_c, id) => id || null,
}));
jest.mock("../../src/shared/config/settings", () => ({
  getSetting: jest.fn(async () => ({})),
}));
jest.mock(
  "../../src/modules/vault/document_vault/document_vault.service",
  () => ({ createDocument: jest.fn() }),
);
jest.mock("sanitize-html", () => {
  const fn = (h) => h;
  fn.defaults = { allowedTags: [], allowedAttributes: {} };
  return fn;
});
jest.mock("../../src/modules/mail/mail/mail.repo", () => ({
  insertConnection: jest.fn(async (_c, d) => ({
    email_connection_id: "new-1",
    ...d,
  })),
  getConnection: jest.fn(async () => ({
    email_connection_id: "new-1",
    provider: "imap_smtp",
    email_address: "a@t.cm",
    secret_key: "k",
  })),
  updateConnection: jest.fn(async () => ({})),
  setError: jest.fn(async () => {}),
  ensureDefaultConnection: jest.fn(async () => {}),
}));
// The connection mock is STATEFUL: classify() writes the kind and then grant()
// reads it back, which in a transaction sees the write. A static mock would test
// the mock rather than the code.
const mockConn = {
  email_connection_id: "new-1",
  kind: "PERSONAL",
  status: "CONNECTED",
  email_address: "a@t.cm",
};
jest.mock("../../src/modules/mail/mail/mailbox.repo", () => ({
  getConnection: jest.fn(async () => ({ ...mockConn })),
  updateConnection: jest.fn(async (_c, id, p) => {
    Object.assign(mockConn, p);
    return { email_connection_id: id, ...p };
  }),
  personalFor: jest.fn(async () => null),
  liveMember: jest.fn(async () => null),
  insertMember: jest.fn(async () => ({})),
  recordAccessAudit: jest.fn(async () => ({})),
}));

const mailRepo = require("../../src/modules/mail/mail/mail.repo");
const mailboxRepo = require("../../src/modules/mail/mail/mailbox.repo");
const service = require("../../src/modules/mail/mail/mail.service");
const { cpanelPreset } = require("../../src/modules/mail/mail/autodiscover");

/** A tenant client whose only job is to answer the feature-flag lookup. */
const clientWithFlag = (state) => ({
  query: jest.fn(async () => ({ rows: state === null ? [] : [{ state }] })),
});

beforeEach(() => {
  jest.clearAllMocks();
  mailboxRepo.personalFor.mockResolvedValue(null);
  Object.assign(mockConn, {
    email_connection_id: "new-1",
    kind: "PERSONAL",
    status: "CONNECTED",
    email_address: "a@t.cm",
  });
});

describe("provider lockdown", () => {
  test.each(["microsoft_graph", "google_gmail"])(
    "%s is refused while the flag is off",
    async (provider) => {
      const c = clientWithFlag("off");
      await expect(
        service.connect(c, {
          email_address: "a@t.cm",
          provider,
          actor: { user_id: "u1" },
        }),
      ).rejects.toMatchObject({ code: "PROVIDER_NOT_ENABLED", status: 403 });
      expect(mailRepo.insertConnection).not.toHaveBeenCalled();
    },
  );

  test("the refusal points at the route that does work", async () => {
    const err = await service
      .connect(clientWithFlag("off"), {
        email_address: "a@t.cm",
        provider: "google_gmail",
        actor: {},
      })
      .catch((e) => e);
    expect(err.message).toMatch(/IMAP\/SMTP/);
    expect(err.message).toMatch(/cPanel/);
  });

  test("a missing flag row is treated as off, not as permission", async () => {
    await expect(
      service.connect(clientWithFlag(null), {
        email_address: "a@t.cm",
        provider: "microsoft_graph",
        actor: {},
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_ENABLED" });
  });

  test("turning the flag on lets the adapter through again — a flag, not a rewrite", async () => {
    const c = clientWithFlag("on");
    // Fails later (no OAuth bundle), but NOT at the lockdown, which is the point.
    const err = await service
      .connect(c, {
        email_address: "a@t.cm",
        provider: "microsoft_graph",
        actor: {},
      })
      .catch((e) => e);
    expect(err && err.code).not.toBe("PROVIDER_NOT_ENABLED");
  });

  test("imap_smtp never consults the flag at all", async () => {
    const c = clientWithFlag("off");
    await service.connect(c, {
      email_address: "a@t.cm",
      provider: "imap_smtp",
      actor: { user_id: "u1" },
    });
    expect(mailRepo.insertConnection).toHaveBeenCalled();
  });
});

describe("one personal mailbox, enforced on connect", () => {
  test("a second personal connect is refused before any row is written", async () => {
    mailboxRepo.personalFor.mockResolvedValue({
      email_connection_id: "old",
      email_address: "ada@t.cm",
    });
    await expect(
      service.connect(clientWithFlag("off"), {
        email_address: "b@t.cm",
        actor: { user_id: "ada" },
      }),
    ).rejects.toMatchObject({ code: "PERSONAL_MAILBOX_EXISTS" });
    expect(mailRepo.insertConnection).not.toHaveBeenCalled();
  });

  test("a SHARED connect is not blocked by the caller's own personal mailbox", async () => {
    mailboxRepo.personalFor.mockResolvedValue({
      email_connection_id: "old",
      email_address: "ada@t.cm",
    });
    await service.connect(clientWithFlag("off"), {
      email_address: "billing@t.cm",
      kind: "SHARED",
      catalogue_key: "BILLING",
      actor: { user_id: "ada" },
    });
    expect(mailRepo.insertConnection).toHaveBeenCalled();
    expect(mailboxRepo.updateConnection).toHaveBeenCalledWith(
      expect.anything(),
      "new-1",
      expect.objectContaining({ kind: "SHARED", catalogue_key: "BILLING" }),
    );
  });
});

describe("cPanel preset", () => {
  test("returns the settings a cPanel mailbox actually uses", () => {
    expect(cpanelPreset("blake@smartlogistics.cm")).toEqual(
      expect.objectContaining({
        imap_host: "mail.smartlogistics.cm",
        imap_port: 993,
        imap_secure: true,
        smtp_host: "mail.smartlogistics.cm",
        smtp_port: 465,
        smtp_secure: true,
      }),
    );
  });

  test("the username is the FULL address — the commonest cPanel auth failure", () => {
    const p = cpanelPreset("blake@smartlogistics.cm");
    expect(p.auth_user).toBe("blake@smartlogistics.cm");
    expect(p.note).toMatch(/full email address/i);
  });

  test("refuses input that is not an address rather than guessing a host", () => {
    for (const bad of ["", "blake", "blake@localhost", null]) {
      expect(() => cpanelPreset(bad)).toThrow(/full email address/i);
    }
  });
});
