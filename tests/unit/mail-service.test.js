/**
 * mail.service.syncConnection unit tests — hermetic. Verifies the engine loop:
 * dedup-insert, one email.received per NEW message, attachment persistence, CRM
 * client linking, cursor advance, and error isolation. Repo / adapter / vault /
 * settings / events are all mocked.
 *
 * NOTE: jest.mock factories are hoisted, so any var they reference must be
 * `mock`-prefixed (jest's babel-hoist rule).
 */
"use strict";

const mockFetchSince = jest.fn();
const mockVerify = jest.fn();
const mockMarkAsRead = jest.fn();
const mockSendEmail = jest.fn();
const mockEmitEvent = jest.fn(async () => {});

jest.mock("../../src/modules/mail/providers/imapSmtp.provider", () => ({
  ImapSmtpProvider: jest.fn().mockImplementation(() => ({
    fetchSince: mockFetchSince,
    verify: mockVerify,
    markAsRead: mockMarkAsRead,
    sendEmail: mockSendEmail,
  })),
}));
jest.mock("../../src/modules/security/setting/setting.service", () => ({
  SECRET_SECTION: "integration_secret",
  put: jest.fn(async () => ({})),
  readSecret: jest.fn(async () => "decrypted-password"),
}));
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (c, id) => id || null,
  emitEvent: (...a) => mockEmitEvent(...a),
}));
jest.mock(
  "../../src/modules/vault/document_vault/document_vault.service",
  () => ({
    createDocument: jest.fn(async () => ({ doc_id: "vault-1" })),
  }),
);
// sanitize-html mocked to a marker so the ingest-sanitization path is provable
// without the real dependency installed.
jest.mock("sanitize-html", () => {
  const fn = (html) => `SANITIZED:${html}`;
  fn.defaults = { allowedTags: ["p", "a"], allowedAttributes: { a: ["href"] } };
  return fn;
});
jest.mock("../../src/modules/mail/mail.repo", () => ({
  getConnection: jest.fn(),
  getInbound: jest.fn(),
  markInboundRead: jest.fn(),
  insertInbound: jest.fn(),
  setCursor: jest.fn(async () => {}),
  setError: jest.fn(async () => {}),
  addAttachment: jest.fn(async () => ({})),
  findClientByEmail: jest.fn(async () => null),
  findDossierByRefs: jest.fn(async () => null),
  setEntityRef: jest.fn(async () => {}),
}));

const repo = require("../../src/modules/mail/mail.repo");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const service = require("../../src/modules/mail/mail.service");

const CONN = {
  email_connection_id: "conn-1",
  provider: "imap_smtp",
  email_address: "me@co.cm",
  secret_key: "mail_conn:conn-1",
  sync_cursor: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  repo.getConnection.mockResolvedValue(CONN);
  repo.findClientByEmail.mockResolvedValue(null);
  repo.findDossierByRefs.mockResolvedValue(null);
});

test("inserts new messages, dedups, emits one event each, advances cursor", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [
      {
        externalMessageId: "<a>",
        threadKey: "<a>",
        from: "x@y",
        to: ["me@co.cm"],
        subject: "A",
        bodyText: "a",
        attachments: [],
      },
      {
        externalMessageId: "<b>",
        threadKey: "<b>",
        from: "x@y",
        to: ["me@co.cm"],
        subject: "B",
        bodyText: "b",
        attachments: [],
      },
    ],
    nextCursor: { uidvalidity: 10, last_uid: 7 },
  });
  repo.insertInbound
    .mockResolvedValueOnce({ email_inbound_id: "in-a", thread_key: "<a>" })
    .mockResolvedValueOnce(null); // duplicate → ON CONFLICT DO NOTHING

  const res = await service.syncConnection({}, "conn-1", { slug: "smartls" });

  expect(res).toMatchObject({ connection: "conn-1", fetched: 2, inserted: 1 });
  expect(mockEmitEvent).toHaveBeenCalledTimes(1);
  expect(mockEmitEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ eventTypeKey: "email.received" }),
  );
  expect(repo.setCursor).toHaveBeenCalledWith({}, "conn-1", {
    uidvalidity: 10,
    last_uid: 7,
  });
});

test("persists attachments to the vault and links them", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [
      {
        externalMessageId: "<c>",
        threadKey: "<c>",
        from: "x@y",
        to: ["me@co.cm"],
        subject: "C",
        bodyText: "c",
        attachments: [
          {
            filename: "f.pdf",
            content_type: "application/pdf",
            content: Buffer.from("PDFDATA"),
          },
        ],
      },
    ],
    nextCursor: { uidvalidity: 10, last_uid: 8 },
  });
  repo.insertInbound.mockResolvedValueOnce({
    email_inbound_id: "in-c",
    thread_key: "<c>",
  });

  const res = await service.syncConnection({}, "conn-1", { slug: "smartls" });

  expect(res.attachments).toBe(1);
  expect(vault.createDocument).toHaveBeenCalledWith(
    {},
    expect.objectContaining({
      slug: "smartls",
      entityRef: "email_inbound:in-c",
    }),
  );
  expect(repo.addAttachment).toHaveBeenCalledWith(
    {},
    expect.objectContaining({
      email_inbound_id: "in-c",
      vault_id: "vault-1",
      filename: "f.pdf",
    }),
  );
});

test("links an inbound message to a client when the sender matches (CRM)", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [
      {
        externalMessageId: "<d>",
        threadKey: "<d>",
        from: "client@acme.cm",
        to: ["me@co.cm"],
        subject: "D",
        bodyText: "d",
        attachments: [],
      },
    ],
    nextCursor: { uidvalidity: 10, last_uid: 9 },
  });
  repo.insertInbound.mockResolvedValueOnce({
    email_inbound_id: "in-d",
    thread_key: "<d>",
  });
  repo.findClientByEmail.mockResolvedValueOnce({
    client_id: "cli-1",
    name: "Acme",
  });

  await service.syncConnection({}, "conn-1", {});

  expect(repo.findClientByEmail).toHaveBeenCalledWith({}, "client@acme.cm");
  expect(repo.setEntityRef).toHaveBeenCalledWith({}, "in-d", "client:cli-1");
});

test("auto-links to a dossier when its ref appears in the subject (wins over client)", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [
      {
        externalMessageId: "<f>",
        threadKey: "<f>",
        from: "client@acme.cm",
        to: ["me@co.cm"],
        subject: "Re: SLAS-2026-0001 shipment",
        bodyText: "f",
        attachments: [],
      },
    ],
    nextCursor: { uidvalidity: 10, last_uid: 12 },
  });
  repo.insertInbound.mockResolvedValueOnce({
    email_inbound_id: "in-f",
    thread_key: "<f>",
  });
  repo.findDossierByRefs.mockResolvedValueOnce({
    dossier_id: "dos-1",
    ref: "SLAS-2026-0001",
  });

  await service.syncConnection({}, "conn-1", {});

  expect(repo.findDossierByRefs).toHaveBeenCalledWith(
    {},
    expect.arrayContaining(["SLAS-2026-0001"]),
  );
  expect(repo.setEntityRef).toHaveBeenCalledWith({}, "in-f", "dossier:dos-1");
  expect(repo.findClientByEmail).not.toHaveBeenCalled(); // dossier match short-circuits
});

test("sanitizes the inbound HTML body before storing (stored-XSS guard)", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [
      {
        externalMessageId: "<e>",
        threadKey: "<e>",
        from: "x@y",
        to: ["me@co.cm"],
        subject: "E",
        bodyHtml: "<script>evil()</script><p>hi</p>",
        bodyText: "hi",
        attachments: [],
      },
    ],
    nextCursor: { uidvalidity: 10, last_uid: 11 },
  });
  repo.insertInbound.mockResolvedValueOnce({
    email_inbound_id: "in-e",
    thread_key: "<e>",
  });

  await service.syncConnection({}, "conn-1", {});

  const row = repo.insertInbound.mock.calls[0][1];
  expect(row.body_html).toBe("SANITIZED:<script>evil()</script><p>hi</p>"); // passed through the sanitizer
});

test("records the error on the connection and does not throw", async () => {
  mockFetchSince.mockRejectedValue(new Error("IMAP auth failed"));
  const res = await service.syncConnection({}, "conn-1", {});
  expect(res.error).toMatch(/IMAP auth failed/);
  expect(repo.setError).toHaveBeenCalledWith({}, "conn-1", "IMAP auth failed");
});

/*
 * WHY THIS ASSERTS 422 AND NOT THE 502 IT USED TO.
 *
 * Two implementations of this mapping landed within days of each other and both
 * survived the merge: `mapSmtpError` (#160), which called a rejected sender a
 * 502, and `explainSendError`, which calls it a 422. Only the second was ever
 * wired to `send`; the first was dead from the moment it merged, and this test
 * was asserting its contract — so main went red and stayed red.
 *
 * The live behaviour is also the better-argued one. A mail server refusing your
 * FROM address is a verdict on the mailbox's own SMTP setup, not a fault in
 * Praxis, and 4xx is what keeps it out of the server-error monitor where nobody
 * can act on it. The dead function is deleted rather than re-wired.
 */
test("send maps a '550 Sender verify failed' SMTP rejection to an actionable 422 AppError", async () => {
  const smtpErr = Object.assign(
    new Error(
      "Can't send mail - all recipients were rejected: 550 Sender verify failed",
    ),
    {
      responseCode: 550,
      response: "550 Sender verify failed",
      code: "EENVELOPE",
    },
  );
  mockSendEmail.mockRejectedValueOnce(smtpErr);

  await expect(
    service.send({}, { connectionId: "conn-1", to: "x@y.cm", subject: "hi" }),
  ).rejects.toMatchObject({
    name: "AppError",
    code: "SENDER_NOT_AUTHORIZED",
    status: 422,
  });
  // The failed send must not be recorded as an outbound thread copy.
  expect(repo.insertInbound).not.toHaveBeenCalled();
});

test("markRead propagates to the server adapter and flips the local row (G-3)", async () => {
  repo.getInbound.mockResolvedValue({
    email_inbound_id: "in-1",
    email_connection_id: "conn-1",
    external_message_id: "<mid>",
  });
  repo.getConnection.mockResolvedValue({ ...CONN, status: "CONNECTED" });
  repo.markInboundRead.mockResolvedValue({ email_inbound_id: "in-1" });
  const res = await service.markRead({}, "in-1");
  expect(mockMarkAsRead).toHaveBeenCalledWith("<mid>");
  expect(repo.markInboundRead).toHaveBeenCalledWith({}, "in-1");
  expect(res).toMatchObject({ email_inbound_id: "in-1" });
});

test("markRead still flips the local row when server propagation fails", async () => {
  repo.getInbound.mockResolvedValue({
    email_inbound_id: "in-2",
    email_connection_id: "conn-1",
    external_message_id: "<mid>",
  });
  repo.getConnection.mockResolvedValue({ ...CONN, status: "CONNECTED" });
  repo.markInboundRead.mockResolvedValue({ email_inbound_id: "in-2" });
  mockMarkAsRead.mockRejectedValueOnce(new Error("provider down"));
  const res = await service.markRead({}, "in-2");
  expect(repo.markInboundRead).toHaveBeenCalledWith({}, "in-2");
  expect(res).toMatchObject({ email_inbound_id: "in-2" });
});
