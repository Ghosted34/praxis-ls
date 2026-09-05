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
// `connect()` now asks who hosts the domain's mail before accepting a password.
// That is a live MX lookup, and a unit test must not depend on somebody else's
// zone or on the runner having DNS. Only that one export is replaced; the real
// `cpanelPreset` below is still the real thing.
const mockHostedProviderOf = jest.fn(async () => null);
jest.mock("../../src/modules/mail/mail/autodiscover", () => ({
  ...jest.requireActual("../../src/modules/mail/mail/autodiscover"),
  hostedProviderOf: (...a) => mockHostedProviderOf(...a),
}));
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
  // `connect()` asks whether the address is already on a LIVE connection before
  // it inserts, so that a second one is refused by name rather than by the
  // 23505 from `ux_email_connection_address_live` (13776). Nothing here is
  // about a duplicate address, so it is always free.
  findByAddress: jest.fn(async () => null),
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

  /* ── THE GATE HAS TO BE ON THE OAUTH PATH TOO ────────────────────────────
   *
   * Everything above proves `connect()` is gated, and `connect()` is the
   * IMAP path. The OAuth path never goes through it: `startOAuth` mints a
   * consent URL and `completeOAuth` calls `repo.insertConnection` itself. So
   * for as long as the check lived only in `connect()`, P4's "gated off —
   * server-side, not only in the UI" was false for the two providers it was
   * written about, and hiding the two buttons in `setup/mailboxes.tsx` was
   * the entire enforcement. A stale tab, a bookmarked
   * `/mail/oauth/google/start`, or a curl walked straight past it.
   *
   * Asserted at BOTH ends on purpose. The start check is what stops a person
   * being sent to Microsoft to consent to something we will refuse; the
   * complete check is what stops a state token minted while the flag was on
   * from landing a mailbox after an administrator turned it off. */
  test.each([
    ["startMicrosoftOAuth", "microsoft_graph"],
    ["startGoogleOAuth", "google_gmail"],
  ])("%s refuses before anyone is redirected to consent", async (fn) => {
    await expect(
      service[fn](clientWithFlag("off"), {
        slug: "smartls",
        redirectUri: "https://smartls.example/cb",
        actor: { user_id: "u1" },
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_ENABLED", status: 403 });
  });

  test.each([
    ["completeMicrosoftOAuth", "microsoft_graph"],
    ["completeGoogleOAuth", "google_gmail"],
  ])("%s refuses on the way back, and writes no connection", async (fn) => {
    await expect(
      service[fn](clientWithFlag("off"), {
        code: "x",
        state: "y",
        slug: "smartls",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_ENABLED", status: 403 });
    // The point of checking before the token exchange: no row, and nothing
    // sent to the provider either.
    expect(mailRepo.insertConnection).not.toHaveBeenCalled();
  });

  test("with the flag ON, start gets past the lockdown", async () => {
    // It still fails — the IdP is not configured in a unit test — but NOT
    // here, which is what makes this a flag rather than a rewrite.
    const err = await service
      .startMicrosoftOAuth(clientWithFlag("on"), {
        slug: "smartls",
        redirectUri: "https://smartls.example/cb",
        actor: {},
      })
      .catch((e) => e);
    expect(err && err.code).not.toBe("PROVIDER_NOT_ENABLED");
  });
});

/* ── A PASSWORD CANNOT REACH A MICROSOFT OR GOOGLE MAILBOX ────────────────
 *
 * Both providers finished removing Basic auth from the legacy protocols —
 * Exchange Online for IMAP/POP in 2022 and for SMTP AUTH on 30 April 2026,
 * Google by dropping "less secure app" passwords. So `imap_smtp` + a password
 * against such a domain cannot succeed, and letting the attempt through returns
 * a bare AUTHENTICATIONFAILED that reads as a typo. The person then retypes the
 * password, tries an app password, and asks IT to check the account — none of
 * which can work, because the protocol is closed.
 *
 * Detection is by MX so it catches a CUSTOM domain, which is the case that
 * matters: nobody is confused about @outlook.com. */
describe("mailboxes that cannot take a password", () => {
  afterEach(() => mockHostedProviderOf.mockResolvedValue(null));

  test.each([
    ["microsoft", /Microsoft 365/],
    ["google", /Google/],
  ])("a custom domain whose MX is %s is refused before any row is written", async (key, named) => {
    mockHostedProviderOf.mockResolvedValue({ key, source: "mx" });
    const err = await service
      .connect(clientWithFlag("off"), {
        email_address: "timothee@smartls.cm",
        provider: "imap_smtp",
        password: "pw",
        actor: { user_id: "u1" },
      })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "MAILBOX_OAUTH_REQUIRED", status: 422 });
    expect(err.message).toMatch(named);
    // Nothing written and no secret vaulted: the refusal is BEFORE the row.
    expect(mailRepo.insertConnection).not.toHaveBeenCalled();
  });

  test("an ordinary mail host is still connected with a password", async () => {
    mockHostedProviderOf.mockResolvedValue(null);
    await service.connect(clientWithFlag("off"), {
      email_address: "support@jbspraxis.com",
      provider: "imap_smtp",
      password: "pw",
      actor: { user_id: "u1" },
    });
    expect(mailRepo.insertConnection).toHaveBeenCalled();
  });

  test("a resolver failure lets the connection through rather than blocking it", async () => {
    // Fails OPEN on purpose. `hostedProviderOf` answers null for "could not
    // tell" as well as "nobody", and a DNS hiccup must never block a mailbox
    // that would have worked.
    mockHostedProviderOf.mockResolvedValue(null);
    await service.connect(clientWithFlag("off"), {
      email_address: "a@t.cm",
      provider: "imap_smtp",
      actor: { user_id: "u1" },
    });
    expect(mailRepo.insertConnection).toHaveBeenCalled();
  });

  test("the OAuth providers are not judged by MX — the flag decides them", async () => {
    // A Microsoft-hosted domain connecting via microsoft_graph must fail at the
    // lockdown, not here: this guard is only about passwords.
    mockHostedProviderOf.mockResolvedValue({ key: "microsoft", source: "mx" });
    await expect(
      service.connect(clientWithFlag("off"), {
        email_address: "timothee@smartls.cm",
        provider: "microsoft_graph",
        actor: { user_id: "u1" },
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_ENABLED" });
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
