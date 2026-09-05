"use strict";

/**
 * Storing, keeping and CLEARING the sending leg's own sign-in.
 *
 * The provider matrix (mail-smtp-credentials.test.js) proves the right credential
 * reaches the wire. This file is about the state that gets it there, and every
 * case here is a way the two halves can fall out of step:
 *
 *   · a mailbox switched back to "Same as IMAP" whose relay password is still on
 *     disk — unreachable through the UI, still decryptable, and read again the
 *     moment anybody switches back;
 *   · an edit that only moves the SMTP host and silently destroys a working
 *     relay credential, because the form did not resend it;
 *   · a blank password on an edit taken as "clear it" rather than as "keep it",
 *     which is the opposite of what the same blank means one field above;
 *   · a mailbox created in "different credentials" mode with no password, which
 *     is a mailbox that claims a sign-in it does not have.
 *
 * NOTE: jest.mock factories are hoisted, so any var they reference must be
 * `mock`-prefixed (jest's babel-hoist rule).
 */

const mockVerify = jest.fn(async () => ({ ok: true }));
const mockProviderArgs = [];
jest.mock("../../src/modules/mail/mail/providers/imapSmtp.provider", () => ({
  ImapSmtpProvider: jest.fn().mockImplementation((conn) => {
    mockProviderArgs.push(conn);
    return { verify: mockVerify };
  }),
}));

/**
 * The vault, as a Map. A real encrypt/decrypt round trip is `setting.service`'s
 * own test; what matters here is WHICH KEYS exist after each operation, and a
 * Map makes "the row is gone" an assertion rather than an inference.
 */
const mockVault = new Map();
jest.mock("../../src/modules/security/setting/setting.service", () => ({
  SECRET_SECTION: "integration_secret",
  put: jest.fn(async (_c, { key, value }) => { mockVault.set(key, value.secret); return {}; }),
  remove: jest.fn(async (_c, { key }) => {
    if (!mockVault.has(key)) {
      const err = new Error("No setting");
      err.code = "NOT_FOUND";
      throw err;
    }
    mockVault.delete(key);
    return { deleted: true };
  }),
  readSecret: jest.fn(async (_c, key) => (mockVault.has(key) ? mockVault.get(key) : null)),
}));

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => {}),
  audit: jest.fn(async () => {}),
  resolveActorId: async (_c, id) => id || null,
}));
jest.mock("../../src/shared/config/settings", () => ({ getSetting: jest.fn(async () => ({})) }));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({ createDocument: jest.fn() }));
// A live MX lookup must not decide whether this suite passes on a train.
jest.mock("../../src/modules/mail/mail/autodiscover", () => ({
  ...jest.requireActual("../../src/modules/mail/mail/autodiscover"),
  hostedProviderOf: jest.fn(async () => null),
}));
jest.mock("sanitize-html", () => {
  const fn = (h) => h;
  fn.defaults = { allowedTags: [], allowedAttributes: {} };
  return fn;
});

/**
 * The connection row, as one mutable object.
 *
 * STATEFUL on purpose: the flows under test write a column and then read it back
 * within the same call — `applySmtpCredentialMode` nulls `smtp_user`, and the
 * response is built from a fresh `getConnection`. A static mock would assert the
 * mock rather than the code.
 */
const mockRow = {};
const CONN_ID = "conn-1";
jest.mock("../../src/modules/mail/mail/mail.repo", () => ({
  insertConnection: jest.fn(async (_c, d) => { Object.assign(mockRow, d); return { ...mockRow }; }),
  // `connect()` refuses a duplicate LIVE address by name before it inserts
  // (13776). Nothing in this file is about a duplicate address, so it is free.
  findByAddress: jest.fn(async () => null),
  getConnection: jest.fn(async () => ({ ...mockRow })),
  updateConnection: jest.fn(async (_c, _id, patch) => { Object.assign(mockRow, patch); return { ...mockRow }; }),
  setError: jest.fn(async () => {}),
  ensureDefaultConnection: jest.fn(async () => {}),
  // The real one is an EXISTS against the setting table; here it is the same
  // question asked of the same fake vault, so the service sees one truth.
  hasSmtpCredentials: jest.fn(async (_c, id) => mockVault.has(`mail_conn_smtp:${id}`)),
}));
jest.mock("../../src/modules/mail/mail/mailbox.repo", () => ({
  getConnection: jest.fn(async () => ({ ...mockRow })),
  updateConnection: jest.fn(async (_c, _id, patch) => { Object.assign(mockRow, patch); return { ...mockRow }; }),
  personalFor: jest.fn(async () => null),
  liveMember: jest.fn(async () => null),
  insertMember: jest.fn(async () => ({})),
  recordAccessAudit: jest.fn(async () => ({})),
}));

const service = require("../../src/modules/mail/mail/mail.service");
const settings = require("../../src/modules/security/setting/setting.service");

const SHARED_KEY = `mail_conn:${CONN_ID}`;
const SMTP_KEY = `mail_conn_smtp:${CONN_ID}`;

/** A tenant client whose only job is to answer the provider feature-flag lookup. */
const client = { query: jest.fn(async () => ({ rows: [] })) };

/** Put the row into "connected, sharing one credential" — the ordinary mailbox. */
function givenSharedCredentialMailbox() {
  mockVault.clear();
  mockVault.set(SHARED_KEY, "cpanel-pw");
  Object.keys(mockRow).forEach((k) => delete mockRow[k]);
  Object.assign(mockRow, {
    email_connection_id: CONN_ID,
    provider: "imap_smtp",
    email_address: "ops@jbspraxis.com",
    display_name: "Ops",
    imap_host: "mail.jbspraxis.com", imap_port: 993, imap_secure: true,
    smtp_host: "mail.smtp2go.com", smtp_port: 465, smtp_secure: true,
    auth_user: "ops@jbspraxis.com",
    smtp_user: null,
    secret_key: SHARED_KEY,
    status: "CONNECTED",
    owner_user_id: "user-1",
  });
}

/** …and then give it its own relay sign-in. */
function givenSeparateCredentialMailbox() {
  givenSharedCredentialMailbox();
  mockVault.set(SMTP_KEY, "api-key");
  mockRow.smtp_user = "smtp2go-user";
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProviderArgs.length = 0;
  mockVerify.mockResolvedValue({ ok: true });
  givenSharedCredentialMailbox();
});

describe("editing a mailbox onto its own sending credential", () => {
  test("both halves are stored — the password in its OWN vault row, the username on the row", async () => {
    await service.updateImapConnection(client, CONN_ID, {
      smtp_auth: "separate", smtp_user: "smtp2go-user", smtp_password: "api-key",
    });
    expect(mockVault.get(SMTP_KEY)).toBe("api-key");
    expect(mockRow.smtp_user).toBe("smtp2go-user");
    // The mailbox password is untouched. Receiving must keep working while the
    // operator is fixing sending.
    expect(mockVault.get(SHARED_KEY)).toBe("cpanel-pw");
  });

  test("the response says the mailbox is in separate mode, and never what the password is", async () => {
    const out = await service.updateImapConnection(client, CONN_ID, {
      smtp_auth: "separate", smtp_user: "smtp2go-user", smtp_password: "api-key",
    });
    expect(out).toMatchObject({ smtp_auth: "separate", has_smtp_credentials: true });
    expect(JSON.stringify(out)).not.toContain("api-key");
  });

  test("the re-test after the edit runs against the credential just typed", async () => {
    await service.updateImapConnection(client, CONN_ID, {
      smtp_auth: "separate", smtp_user: "smtp2go-user", smtp_password: "api-key",
    });
    // The whole point of "Save & test": a verdict about the OLD credential would
    // tell the operator their fix failed when it worked, or worked when it did not.
    expect(mockProviderArgs.at(-1)).toMatchObject({
      smtp_user: "smtp2go-user",
      smtp_password: "api-key",
      password: "cpanel-pw",
    });
  });
});

describe("editing WITHOUT touching the sending credential", () => {
  test("a patch that carries no smtp_auth leaves an existing separate credential alone", async () => {
    givenSeparateCredentialMailbox();
    await service.updateImapConnection(client, CONN_ID, { display_name: "Operations" });
    expect(mockVault.get(SMTP_KEY)).toBe("api-key");
    expect(mockRow.smtp_user).toBe("smtp2go-user");
    expect(mockRow.display_name).toBe("Operations");
  });

  test("a blank SMTP password KEEPS the stored one — the same convention as the mailbox password", async () => {
    givenSeparateCredentialMailbox();
    await service.updateImapConnection(client, CONN_ID, {
      smtp_auth: "separate", smtp_user: "smtp2go-user-renamed", smtp_host: "mail.smtp2go.com",
    });
    expect(mockVault.get(SMTP_KEY)).toBe("api-key");
    expect(mockRow.smtp_user).toBe("smtp2go-user-renamed");
  });

  test("a mailbox that never had a separate credential does not gain one from an ordinary edit", async () => {
    await service.updateImapConnection(client, CONN_ID, { smtp_host: "mail.elsewhere.com" });
    expect(mockVault.has(SMTP_KEY)).toBe(false);
    expect(mockRow.smtp_user).toBeNull();
    // Hosts stay independently editable in BOTH modes — some tenants point
    // sending elsewhere while sharing one password.
    expect(mockRow.smtp_host).toBe("mail.elsewhere.com");
  });

  test("smtp_user cannot be smuggled onto a mailbox that is in shared mode", async () => {
    // Written only by the mode handler. A username stored without the password
    // that gives it meaning is the state the provider has to ignore, so the
    // cleanest guarantee is that it never gets written at all.
    await service.updateImapConnection(client, CONN_ID, { smtp_user: "smtp2go-user" });
    expect(mockRow.smtp_user).toBeNull();
  });
});

describe("switching back to Same as IMAP", () => {
  test("the vault row is DELETED and the username nulled — no orphaned secret", async () => {
    givenSeparateCredentialMailbox();
    await service.updateImapConnection(client, CONN_ID, { smtp_auth: "same" });
    expect(mockVault.has(SMTP_KEY)).toBe(false);
    expect(mockRow.smtp_user).toBeNull();
    expect(mockVault.get(SHARED_KEY)).toBe("cpanel-pw");
  });

  test("the mailbox is back on today's exact behaviour afterwards", async () => {
    givenSeparateCredentialMailbox();
    await service.updateImapConnection(client, CONN_ID, { smtp_auth: "same" });
    const resolved = mockProviderArgs.at(-1);
    expect(resolved.smtp_password).toBeNull();
    expect(resolved.smtp_user).toBeNull();
    expect(resolved.password).toBe("cpanel-pw");
  });

  test("switching to same on a mailbox that never had one is a no-op, not a 404", async () => {
    // `settings.remove` throws NOT_FOUND for a key with no row, and the state
    // being asked for is exactly "there is no such row".
    await expect(
      service.updateImapConnection(client, CONN_ID, { smtp_auth: "same" }),
    ).resolves.toMatchObject({ smtp_auth: "same", has_smtp_credentials: false });
  });

  test("a REAL storage failure is not swallowed by the not-found tolerance", async () => {
    givenSeparateCredentialMailbox();
    settings.remove.mockRejectedValueOnce(Object.assign(new Error("disk"), { code: "EIO" }));
    await expect(
      service.updateImapConnection(client, CONN_ID, { smtp_auth: "same" }),
    ).rejects.toThrow("disk");
  });
});

describe("what a half-typed separate sign-in does", () => {
  test("an edit into separate mode with no password and none stored is refused", async () => {
    await expect(
      service.updateImapConnection(client, CONN_ID, { smtp_auth: "separate", smtp_user: "u" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // Refused BEFORE anything is written: a mailbox must not be left with the
    // host change applied and the credential missing.
    expect(mockVault.has(SMTP_KEY)).toBe(false);
  });

  test("a username is required even when a password is supplied", async () => {
    await expect(
      service.updateImapConnection(client, CONN_ID, { smtp_auth: "separate", smtp_password: "api-key" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockVault.has(SMTP_KEY)).toBe(false);
  });

  test("the message names the field, because the form has two new inputs", async () => {
    await expect(
      service.updateImapConnection(client, CONN_ID, { smtp_auth: "separate", smtp_user: "u" }),
    ).rejects.toMatchObject({ details: { smtp_password: expect.any(Array) } });
  });
});

describe("connecting a mailbox that needs a relay from the start", () => {
  test("the separate credential is stored before the connection is tested", async () => {
    mockVault.clear();
    Object.keys(mockRow).forEach((k) => delete mockRow[k]);
    await service.connect(client, {
      email_address: "ops@jbspraxis.com",
      imap_host: "mail.jbspraxis.com", imap_port: 993,
      smtp_host: "mail.smtp2go.com", smtp_port: 465,
      auth_user: "ops@jbspraxis.com", password: "cpanel-pw",
      smtp_auth: "separate", smtp_user: "smtp2go-user", smtp_password: "api-key",
      actor: { user_id: "user-1" },
    });
    expect(mockVault.get(`mail_conn_smtp:${mockRow.email_connection_id}`)).toBe("api-key");
    expect(mockRow.smtp_user).toBe("smtp2go-user");
    expect(mockProviderArgs.at(-1)).toMatchObject({ smtp_password: "api-key" });
  });

  test("a create in separate mode with no password writes no row at all", async () => {
    mockVault.clear();
    Object.keys(mockRow).forEach((k) => delete mockRow[k]);
    const repo = require("../../src/modules/mail/mail/mail.repo");
    await expect(
      service.connect(client, {
        email_address: "ops@jbspraxis.com", password: "cpanel-pw",
        smtp_auth: "separate", smtp_user: "smtp2go-user",
        actor: { user_id: "user-1" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(repo.insertConnection).not.toHaveBeenCalled();
  });

  test("a create in the default mode stores nothing extra and behaves as it always has", async () => {
    mockVault.clear();
    Object.keys(mockRow).forEach((k) => delete mockRow[k]);
    await service.connect(client, {
      email_address: "ops@jbspraxis.com",
      imap_host: "mail.jbspraxis.com", smtp_host: "mail.jbspraxis.com",
      auth_user: "ops@jbspraxis.com", password: "cpanel-pw",
      actor: { user_id: "user-1" },
    });
    expect([...mockVault.keys()]).toEqual([`mail_conn:${mockRow.email_connection_id}`]);
    expect(mockRow.smtp_user).toBeNull();
  });
});

describe("disconnecting forgets BOTH credentials", () => {
  const mailbox = require("../../src/modules/mail/mail/mailbox.service");

  test("the relay password is deleted alongside the mailbox password", async () => {
    givenSeparateCredentialMailbox();
    mockRow.status = "ARCHIVED"; // skip the archive half — this is about forgetting
    await mailbox.disconnect(client, CONN_ID, { user_id: "user-1" });
    expect(mockVault.has(SHARED_KEY)).toBe(false);
    expect(mockVault.has(SMTP_KEY)).toBe(false);
    expect(mockRow.smtp_user).toBeNull();
  });

  test("a relay password is removed even when the shared secret_key is already gone", async () => {
    // `mail_conn_smtp:<id>` is derived from the id and is NOT recorded in
    // `secret_key`, so gating its removal on that column would leave exactly this
    // row behind — on the mailbox somebody is disconnecting to rotate a key.
    givenSeparateCredentialMailbox();
    mockRow.status = "ARCHIVED";
    mockRow.secret_key = null;
    mockVault.delete(SHARED_KEY);
    await mailbox.disconnect(client, CONN_ID, { user_id: "user-1" });
    expect(mockVault.has(SMTP_KEY)).toBe(false);
  });
});

/**
 * The repository's half of the round trip.
 *
 * `jest.mock` above replaced mail.repo for the service tests, so the real module
 * is required through `requireActual` here and driven with a recording client.
 * There is no Postgres in the unit suite; what is checkable without one — and
 * what actually broke twice while this was being written — is the SQL's SHAPE:
 * that the column is selected at all, that the presence question keys on the
 * right vault name, and that the derived mode follows the secret rather than the
 * username. A wrong key name here is a mailbox permanently stuck in shared mode
 * with a working relay password on disk, and no test that mocks the repo can see
 * it.
 */
describe("the repo reads the column and derives the mode from the secret", () => {
  const realRepo = jest.requireActual("../../src/modules/mail/mail/mail.repo");

  const recordingClient = (rows) => {
    const calls = [];
    return {
      calls,
      query: jest.fn(async (sql, params) => { calls.push({ sql, params }); return { rows }; }),
    };
  };

  test("listConnections selects smtp_user and the presence flag", async () => {
    const c = recordingClient([]);
    await realRepo.listConnections(c, {});
    const { sql } = c.calls[0];
    expect(sql).toMatch(/c\.smtp_user/);
    expect(sql).toMatch(/has_smtp_credentials/);
    // Keyed on the same name the service writes. These two strings are the whole
    // contract between the vault and the read that reopens the form.
    expect(sql).toMatch(/mail_conn_smtp:/);
    expect(sql).toMatch(/integration_secret/);
  });

  test("a row WITH the secret comes back as separate, one WITHOUT as same", async () => {
    const withSecret = await realRepo.listConnections(
      recordingClient([{ email_connection_id: "a", smtp_user: "relay", has_smtp_credentials: true }]), {},
    );
    expect(withSecret[0]).toMatchObject({ smtp_auth: "separate", smtp_user: "relay" });

    // The case the provider matrix also pins: a username left behind on a row
    // whose secret is gone is NOT separate mode.
    const orphanUser = await realRepo.listConnections(
      recordingClient([{ email_connection_id: "b", smtp_user: "relay", has_smtp_credentials: false }]), {},
    );
    expect(orphanUser[0].smtp_auth).toBe("same");
  });

  test("the owner filter still scopes the list after the alias change", async () => {
    // The SELECT gained a table alias for the EXISTS sub-query, and the WHERE had
    // to follow it. An unqualified `owner_user_id` would have thrown at runtime
    // and nothing else in the suite touches this branch.
    const c = recordingClient([]);
    await realRepo.listConnections(c, { ownerUserId: "user-1" });
    expect(c.calls[0].sql).toMatch(/WHERE c\.owner_user_id = \$3/);
    expect(c.calls[0].params).toContain("user-1");
  });

  test("hasSmtpCredentials asks about exactly one connection's key", async () => {
    const c = recordingClient([{ present: true }]);
    await expect(realRepo.hasSmtpCredentials(c, "conn-9")).resolves.toBe(true);
    expect(c.calls[0].params).toEqual(["mail_conn_smtp:conn-9"]);

    const empty = recordingClient([{ present: false }]);
    await expect(realRepo.hasSmtpCredentials(empty, "conn-9")).resolves.toBe(false);
  });
});

/**
 * The wire contract, at the edge that rejects a request before any of the above
 * runs. On CREATE both halves are decidable from the body alone, so the 422 is
 * owed here rather than deeper in; on EDIT it is not decidable here at all,
 * because a blank password is legitimate when one is stored — which is why the
 * patch schema deliberately does not refine.
 */
describe("the connect/edit schemas", () => {
  const { schemas } = require("../../src/modules/mail/mail/mail.validator");
  const body = (extra) => ({
    email_address: "ops@jbspraxis.com", imap_host: "mail.jbspraxis.com",
    smtp_host: "mail.smtp2go.com", password: "cpanel-pw", ...extra,
  });

  test("create in separate mode needs both halves", () => {
    const bad = schemas.connect.safeParse(body({ smtp_auth: "separate", smtp_user: "relay" }));
    expect(bad.success).toBe(false);
    expect(bad.error.flatten().fieldErrors).toHaveProperty("smtp_password");

    const ok = schemas.connect.safeParse(body({ smtp_auth: "separate", smtp_user: "relay", smtp_password: "k" }));
    expect(ok.success).toBe(true);
  });

  test("create in the default mode is accepted exactly as before", () => {
    expect(schemas.connect.safeParse(body({})).success).toBe(true);
    expect(schemas.connect.safeParse(body({ smtp_auth: "same" })).success).toBe(true);
  });

  test("EDIT accepts a blank SMTP password — the vault decides, and only it can", () => {
    const p = schemas.connectPatch.safeParse({ smtp_auth: "separate", smtp_user: "relay" });
    expect(p.success).toBe(true);
  });

  test("the shared-mailbox payload carries the same choice", () => {
    // Three payloads write mailbox credentials; a rule enforced on two of them is
    // a rule with a way around it.
    const bad = schemas.sharedMailbox.safeParse({
      email_address: "ops@jbspraxis.com", smtp_auth: "separate", smtp_user: "relay",
    });
    expect(bad.success).toBe(false);
    expect(bad.error.flatten().fieldErrors).toHaveProperty("smtp_password");
  });

  test("an unknown mode is refused rather than silently treated as shared", () => {
    expect(schemas.connect.safeParse(body({ smtp_auth: "maybe" })).success).toBe(false);
  });
});
