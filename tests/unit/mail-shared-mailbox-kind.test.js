/**
 * A SHARED mailbox must be born SHARED.
 *
 * ── THE DEFECT THIS PINS ────────────────────────────────────────────────────
 *
 * `email_connection.kind` DEFAULTS to 'PERSONAL' (10723), and the same migration
 * puts a partial unique index on it:
 *
 *   ux_email_connection_one_personal
 *     UNIQUE (owner_user_id) WHERE kind = 'PERSONAL' AND status <> 'ARCHIVED'
 *
 * `connect()` used to leave `kind` out of the INSERT and let `classify()` stamp
 * it one statement later. That is one statement too late: the row hits the index
 * as a PERSONAL mailbox first. So an administrator who already owned a personal
 * mailbox could not create a team address AT ALL — `POST /mail/mailboxes/shared`
 * raised 23505 on the INSERT and surfaced as the error handler's generic "A
 * record with these values already exists", which names neither the rule nor the
 * mailbox standing in the way. It was 100% reproducible and had no workaround in
 * the UI, because the guard `connect()` DOES run (`assertNoPersonalMailbox`) is
 * deliberately skipped for SHARED — the index was not.
 *
 * Asserted on the INSERT payload rather than on the returned row, because the
 * returned row is the thing `classify()` fixes up afterwards. What matters is
 * what the database saw at the moment the index was evaluated.
 *
 * NOTE: jest.mock factories are hoisted, so any var they reference must be
 * `mock`-prefixed (jest's babel-hoist rule).
 */
"use strict";

jest.mock("../../src/modules/mail/mail/providers/imapSmtp.provider", () => ({
  ImapSmtpProvider: jest.fn().mockImplementation(() => ({ verify: async () => ({ ok: true }) })),
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
jest.mock("../../src/shared/config/settings", () => ({ getSetting: jest.fn(async () => ({})) }));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({ createDocument: jest.fn() }));
// A live MX lookup must not decide whether this test passes.
jest.mock("../../src/modules/mail/mail/autodiscover", () => ({
  ...jest.requireActual("../../src/modules/mail/mail/autodiscover"),
  hostedProviderOf: async () => null,
}));
jest.mock("sanitize-html", () => {
  const fn = (h) => h;
  fn.defaults = { allowedTags: [], allowedAttributes: {} };
  return fn;
});
jest.mock("../../src/modules/mail/mail/mail.repo", () => ({
  insertConnection: jest.fn(async (_c, d) => ({ email_connection_id: "new-1", ...d })),
  findByAddress: jest.fn(async () => null),
  getConnection: jest.fn(async () => ({
    email_connection_id: "new-1", provider: "imap_smtp",
    email_address: "billing@t.cm", secret_key: "k",
  })),
  updateConnection: jest.fn(async () => ({})),
  setError: jest.fn(async () => {}),
  ensureDefaultConnection: jest.fn(async () => {}),
  // `testConnection` asks whether the SENDING leg has its own sign-in, so that a
  // rejection can name which credential was offered (13777). These fixtures are
  // about `kind` and the address index, so they share one credential.
  hasSmtpCredentials: jest.fn(async () => false),
}));
// Stateful, because classify() writes the kind and grant() reads it back — a
// static mock would test the mock rather than the code.
const mockConn = { email_connection_id: "new-1", kind: "PERSONAL", status: "CONNECTED", email_address: "billing@t.cm" };
jest.mock("../../src/modules/mail/mail/mailbox.repo", () => ({
  getConnection: jest.fn(async () => ({ ...mockConn })),
  updateConnection: jest.fn(async (_c, id, p) => { Object.assign(mockConn, p); return { email_connection_id: id, ...p }; }),
  personalFor: jest.fn(async () => null),
  liveMember: jest.fn(async () => null),
  insertMember: jest.fn(async () => ({})),
  recordAccessAudit: jest.fn(async () => ({})),
}));

const mailRepo = require("../../src/modules/mail/mail/mail.repo");
const mailboxRepo = require("../../src/modules/mail/mail/mailbox.repo");
const service = require("../../src/modules/mail/mail/mail.service");

const client = { query: jest.fn(async () => ({ rows: [] })) };
const insertedKind = () => mailRepo.insertConnection.mock.calls[0][1].kind;

const CONNECT = {
  email_address: "billing@t.cm",
  provider: "imap_smtp",
  imap_host: "mail.t.cm",
  smtp_host: "mail.t.cm",
  password: "pw",
};

beforeEach(() => {
  jest.clearAllMocks();
  mailRepo.findByAddress.mockResolvedValue(null);
  mailboxRepo.personalFor.mockResolvedValue(null);
  Object.assign(mockConn, { email_connection_id: "new-1", kind: "PERSONAL", status: "CONNECTED", email_address: "billing@t.cm" });
});

describe("kind is written by the INSERT, not by the statement after it", () => {
  test("a shared mailbox is inserted as SHARED", async () => {
    await service.connect(client, { ...CONNECT, kind: "SHARED", actor: { user_id: "u1" } });
    expect(insertedKind()).toBe("SHARED");
  });

  test("a personal mailbox is still inserted as PERSONAL", async () => {
    await service.connect(client, { ...CONNECT, actor: { user_id: "u1" } });
    expect(insertedKind()).toBe("PERSONAL");
  });

  /* THE REGRESSION ITSELF. An administrator who already owns a personal mailbox
   * is the ONLY person who ever sets up a team address, so this is not an edge
   * case — it is the whole feature's normal caller. `personalFor` answering with
   * a row is exactly the state `ux_email_connection_one_personal` refuses a
   * second PERSONAL row in. */
  test("an owner of a personal mailbox can still create a shared one", async () => {
    mailboxRepo.personalFor.mockResolvedValue({
      email_connection_id: "own-1", email_address: "me@t.cm",
    });

    await expect(
      service.connect(client, { ...CONNECT, kind: "SHARED", actor: { user_id: "u1" } }),
    ).resolves.toBeTruthy();

    // Never as PERSONAL, or the partial index rejects the INSERT with a 23505
    // the caller cannot read and cannot act on.
    expect(insertedKind()).toBe("SHARED");
  });

  /* The other half of the same rule, and the reason `kind` in the INSERT is not
   * enough on its own: the guard must still refuse a SECOND personal mailbox
   * with a sentence rather than letting the index answer with a constraint. */
  test("a second personal mailbox is still refused, by name", async () => {
    mailboxRepo.personalFor.mockResolvedValue({
      email_connection_id: "own-1", email_address: "me@t.cm",
    });

    await expect(
      service.connect(client, { ...CONNECT, actor: { user_id: "u1" } }),
    ).rejects.toMatchObject({ code: "PERSONAL_MAILBOX_EXISTS", status: 409 });
    expect(mailRepo.insertConnection).not.toHaveBeenCalled();
  });
});

/* ── The other unique index on this INSERT ───────────────────────────────── */

/**
 * `ux_email_connection_address_live` (13776) replaced 0483's plain
 * UNIQUE (email_address, provider), which ranged over ARCHIVED rows too — so
 * retiring a mailbox never released its address and `disconnect`'s own
 * documented purpose ("somebody who mistyped an address into the wizard") could
 * not be completed. These pin both halves: a live address is refused BY NAME
 * rather than by constraint, and a retired one is free again.
 */
describe("an address already connected", () => {
  test("is refused with a sentence, not a 23505", async () => {
    mailRepo.findByAddress.mockResolvedValue({
      email_connection_id: "live-1", status: "CONNECTED",
    });

    await expect(
      service.connect(client, { ...CONNECT, kind: "SHARED", actor: { user_id: "u1" } }),
    ).rejects.toMatchObject({ code: "MAILBOX_ADDRESS_IN_USE", status: 409 });
    expect(mailRepo.insertConnection).not.toHaveBeenCalled();
  });

  test("names the address, so the reader knows which mailbox is in the way", async () => {
    mailRepo.findByAddress.mockResolvedValue({
      email_connection_id: "live-1", status: "CONNECTED",
    });
    const err = await service
      .connect(client, { ...CONNECT, actor: { user_id: "u1" } })
      .catch((e) => e);
    expect(err.message).toContain("billing@t.cm");
  });

  test("a RETIRED mailbox releases its address", async () => {
    mailRepo.findByAddress.mockResolvedValue({
      email_connection_id: "old-1", status: "ARCHIVED",
    });

    await expect(
      service.connect(client, { ...CONNECT, kind: "SHARED", actor: { user_id: "u1" } }),
    ).resolves.toBeTruthy();
    expect(mailRepo.insertConnection).toHaveBeenCalled();
  });
});
