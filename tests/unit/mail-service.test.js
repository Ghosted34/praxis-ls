/**
 * mail.service.syncConnection unit tests — hermetic. Verifies the engine loop:
 * dedup-insert, one event per NEW message, attachment persistence, CRM linking,
 * cursor advance, and error isolation. Repo / adapter / vault / settings /
 * events are all mocked.
 *
 * PR-1A rewrote what the loop writes. It no longer inserts a flat
 * `email_inbound` row; it folds each message into a CONVERSATION
 * (thread.repo.upsertThread → insertMessage), walks FOLDERS with a cursor each,
 * and records read state per user. So the assertions here moved from
 * `mail.repo.insertInbound` to `thread.repo.insertMessage`, and a second folder
 * appears in the fixtures — a loop that only ever sees one folder cannot show
 * that a failure in one is isolated from the rest, which is the property the
 * per-folder cursor exists to protect.
 *
 * NOTE: jest.mock factories are hoisted, so any var they reference must be
 * `mock`-prefixed (jest's babel-hoist rule).
 */
"use strict";

const mockFetchSince = jest.fn();
const mockListFolders = jest.fn();
const mockVerify = jest.fn();
const mockMarkAsRead = jest.fn();
const mockSendEmail = jest.fn();
const mockEmitEvent = jest.fn(async () => {});

jest.mock("../../src/modules/mail/mail/providers/imapSmtp.provider", () => ({
  ImapSmtpProvider: jest.fn().mockImplementation(() => ({
    fetchSince: mockFetchSince,
    listFolders: mockListFolders,
    verify: mockVerify,
    markAsRead: mockMarkAsRead,
    sendEmail: mockSendEmail,
    capabilities: () => ({ folders: true, folderMove: true, serverFlags: true }),
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
// PR-0: the sync loop now writes health book-keeping (clear on success, count
// on failure) and asks the mailbox layer for a send allowance. Mocked here for
// the same reason mail.repo is — these are hermetic tests with no database.
jest.mock("../../src/modules/mail/mail/mailbox.repo", () => ({
  getConnection: jest.fn(async () => ({
    email_connection_id: "conn-1",
    kind: "PERSONAL",
  })),
  updateConnection: jest.fn(async () => ({})),
  clearFailures: jest.fn(async () => ({})),
  bumpFailure: jest.fn(async () => ({
    consecutive_failures: 1,
    status: "CONNECTED",
  })),
  sendCounts: jest.fn(async () => ({ hourly: 0, daily: 0 })),
  bumpSendWindow: jest.fn(async () => ({ sent_count: 1 })),
  recordAccessAudit: jest.fn(async () => ({})),
  listMembers: jest.fn(async () => []),
  liveMember: jest.fn(async () => null),
  personalFor: jest.fn(async () => null),
}));
jest.mock("../../src/shared/config/settings", () => ({
  getSetting: jest.fn(async () => ({})),
}));
jest.mock("../../src/modules/mail/mail/mail.repo", () => ({
  getConnection: jest.fn(),
  setError: jest.fn(async () => {}),
  addAttachment: jest.fn(async () => ({})),
  findClientByEmail: jest.fn(async () => null),
  findDossierByRefs: jest.fn(async () => null),
  listAttachments: jest.fn(async () => []),
}));
// PR-1A: the conversation model. Mocked wholesale for the same reason mail.repo
// is — these tests are hermetic and there is no database behind them.
jest.mock("../../src/modules/mail/mail/thread.repo", () => ({
  upsertFolder: jest.fn(async (_c, connId, f) => ({
    email_folder_id: `fold-${f.canonical}`,
    email_connection_id: connId,
    canonical: f.canonical,
    provider_path: f.provider_path,
    is_syncable: f.is_syncable !== false,
    sync_cursor: null,
    last_sync_at: null,
  })),
  syncableFolders: jest.fn(async () => []),
  setFolderCursor: jest.fn(async () => ({})),
  setFolderError: jest.fn(async () => ({})),
  streamRules: jest.fn(async () => []),
  knownParty: jest.fn(async () => null),
  upsertThread: jest.fn(async () => ({ email_thread_id: "thr-1", message_count: 0 })),
  updateThread: jest.fn(async () => ({})),
  refreshThreadCounts: jest.fn(async () => ({})),
  insertMessage: jest.fn(),
  seedStateForMembers: jest.fn(async () => 0),
  setThreadRead: jest.fn(async () => 0),
  getMessage: jest.fn(),
  listThreads: jest.fn(async () => []),
  timelineByEntity: jest.fn(async () => []),
}));

const repo = require("../../src/modules/mail/mail/mail.repo");
const threads = require("../../src/modules/mail/mail/thread.repo");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const service = require("../../src/modules/mail/mail/mail.service");

const CONN = {
  email_connection_id: "conn-1",
  provider: "imap_smtp",
  email_address: "me@co.cm",
  secret_key: "mail_conn:conn-1",
  sync_cursor: null,
};

// Two folders, because one folder cannot demonstrate isolation. INBOX first so
// the ordinary assertions read against a familiar name.
const INBOX = {
  email_folder_id: "fold-INBOX", canonical: "INBOX", provider_path: "INBOX",
  is_syncable: true, sync_cursor: null,
};
const ARCHIVE = {
  email_folder_id: "fold-ARCHIVE", canonical: "ARCHIVE", provider_path: "Archive",
  is_syncable: true, sync_cursor: { uidvalidity: 10, last_uid: 3 },
};

const inbound = (over = {}) => ({
  externalMessageId: "<a>", from: "x@y", to: ["me@co.cm"],
  subject: "A", bodyText: "a", attachments: [], ...over,
});

// jest.clearAllMocks() resets CALLS but not IMPLEMENTATIONS, so every default a
// test may consume is re-established here. A mockResolvedValueOnce left over
// from a previous test is one of the hardest failures in this file to read.
beforeEach(() => {
  jest.clearAllMocks();
  repo.getConnection.mockResolvedValue(CONN);
  repo.findClientByEmail.mockResolvedValue(null);
  repo.findDossierByRefs.mockResolvedValue(null);
  mockListFolders.mockResolvedValue([
    { path: "INBOX", name: "INBOX", flags: [] },
    { path: "Archive", name: "Archive", flags: ["\\Archive"] },
  ]);
  threads.syncableFolders.mockResolvedValue([INBOX]);
  threads.upsertThread.mockResolvedValue({ email_thread_id: "thr-1", message_count: 0 });
  threads.knownParty.mockResolvedValue(null);
  threads.streamRules.mockResolvedValue([]);
  threads.insertMessage.mockResolvedValue({ email_message_id: "msg-1" });
  mockFetchSince.mockResolvedValue({ messages: [], nextCursor: null });
});

test("discovers folders from the server and syncs each with its own cursor", async () => {
  threads.syncableFolders.mockResolvedValue([INBOX, ARCHIVE]);
  mockFetchSince.mockResolvedValue({ messages: [], nextCursor: { uidvalidity: 10, last_uid: 4 } });

  const res = await service.syncConnection({}, "conn-1", {});

  // Each folder is fetched with ITS OWN cursor, not one shared connection cursor.
  // UIDVALIDITY is per mailbox in IMAP: sharing a cursor makes a renumber in
  // Archive look like a renumber in INBOX and re-downloads the wrong folder.
  expect(mockFetchSince).toHaveBeenCalledWith(null, "INBOX");
  expect(mockFetchSince).toHaveBeenCalledWith({ uidvalidity: 10, last_uid: 3 }, "Archive");
  expect(threads.setFolderCursor).toHaveBeenCalledWith({}, "fold-INBOX", { uidvalidity: 10, last_uid: 4 });
  expect(threads.setFolderCursor).toHaveBeenCalledWith({}, "fold-ARCHIVE", { uidvalidity: 10, last_uid: 4 });
  expect(res.folders).toEqual([
    { folder: "INBOX", fetched: 0 },
    { folder: "ARCHIVE", fetched: 0 },
  ]);
});

test("inserts new messages, dedups, emits one event each, advances the folder cursor", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ externalMessageId: "<a>", subject: "A" }), inbound({ externalMessageId: "<b>", subject: "B" })],
    nextCursor: { uidvalidity: 10, last_uid: 7 },
  });
  threads.insertMessage
    .mockResolvedValueOnce({ email_message_id: "msg-a" })
    .mockResolvedValueOnce(null); // duplicate → ON CONFLICT DO NOTHING

  const res = await service.syncConnection({}, "conn-1", { slug: "smartls" });

  expect(res).toMatchObject({ connection: "conn-1", fetched: 2, inserted: 1 });
  const kinds = mockEmitEvent.mock.calls.map((c) => c[1].eventTypeKey);
  expect(kinds.filter((k) => k === "email.thread.created" || k === "email.received")).toHaveLength(1);
  expect(threads.setFolderCursor).toHaveBeenCalledWith({}, "fold-INBOX", { uidvalidity: 10, last_uid: 7 });
});

test("a message that starts a conversation is announced as a new thread", async () => {
  mockFetchSince.mockResolvedValue({ messages: [inbound()], nextCursor: null });
  threads.upsertThread.mockResolvedValue({ email_thread_id: "thr-new", message_count: 0 });

  await service.syncConnection({}, "conn-1", {});

  expect(mockEmitEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ eventTypeKey: "email.thread.created" }),
  );
});

test("a reply into an existing conversation is announced as received, not as a new thread", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ externalMessageId: "<r>", inReplyTo: "<a>", references: ["<a>"] })],
    nextCursor: null,
  });
  threads.upsertThread.mockResolvedValue({ email_thread_id: "thr-1", message_count: 2 });

  await service.syncConnection({}, "conn-1", {});

  const kinds = mockEmitEvent.mock.calls.map((c) => c[1].eventTypeKey);
  expect(kinds).toContain("email.received");
  expect(kinds).not.toContain("email.thread.created");
  // Threaded onto the conversation the References header names, not onto itself.
  expect(threads.upsertThread).toHaveBeenCalledWith({}, expect.objectContaining({ thread_key: "<a>" }));
});

test("classifies the first inbound message of a conversation into a stream", async () => {
  // The SYSTEM verdicts are DATA, not code — migration 10734 seeds eight header
  // rules and an administrator can tune them. Only the known-party override is
  // hard-coded. So the rule has to be supplied here, exactly as the sync loop
  // reads it from email_stream_rule.
  threads.streamRules.mockResolvedValue([{
    email_stream_rule_id: "rule-1", match_kind: "HEADER_VALUE", match_key: "auto-submitted",
    match_value: "auto-(generated|replied)", stream: "SYSTEM", is_active: true,
    reason: "Carries Auto-Submitted, which RFC 3834 reserves for automated mail.",
  }]);
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ from: "no-reply@cpanel.example", subject: "Backup complete", headers: { "auto-submitted": "auto-generated" } })],
    nextCursor: null,
  });

  await service.syncConnection({}, "conn-1", {});

  expect(threads.updateThread).toHaveBeenCalledWith(
    {}, "thr-1", expect.objectContaining({ stream: "SYSTEM", stream_reason: expect.stringContaining("Auto-Submitted") }),
  );
});

test("a known party overrides the system verdict — a client's mail is never buried", async () => {
  // With this rule and no override the verdict would be SYSTEM. That is the
  // point: the override has to beat a rule that genuinely matches, or the test
  // proves nothing.
  threads.streamRules.mockResolvedValue([{
    email_stream_rule_id: "rule-1", match_kind: "HEADER_VALUE", match_key: "auto-submitted",
    match_value: "auto-(generated|replied)", stream: "SYSTEM", is_active: true,
    reason: "Carries Auto-Submitted, which RFC 3834 reserves for automated mail.",
  }]);
  threads.knownParty.mockResolvedValue({ kind: "client", id: "cli-1", name: "Acme", is_vip: true });
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ from: "ops@acme.cm", headers: { "auto-submitted": "auto-generated" } })],
    nextCursor: null,
  });

  await service.syncConnection({}, "conn-1", {});

  expect(threads.updateThread).toHaveBeenCalledWith(
    {}, "thr-1", expect.objectContaining({ stream: "HUMAN", is_vip: true }),
  );
});

test("persists attachments to the vault and links them to the MESSAGE", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({
      externalMessageId: "<c>", subject: "C",
      attachments: [{ filename: "f.pdf", content_type: "application/pdf", content: Buffer.from("PDFDATA") }],
    })],
    nextCursor: { uidvalidity: 10, last_uid: 8 },
  });
  threads.insertMessage.mockResolvedValueOnce({ email_message_id: "msg-c" });

  const res = await service.syncConnection({}, "conn-1", { slug: "smartls" });

  expect(res.attachments).toBe(1);
  expect(vault.createDocument).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ slug: "smartls", entityRef: "email_message:msg-c" }),
  );
  expect(repo.addAttachment).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ email_inbound_id: "msg-c", vault_id: "vault-1", filename: "f.pdf" }),
  );
});

test("links a conversation to a client when the sender matches (CRM)", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ externalMessageId: "<d>", from: "client@acme.cm", subject: "D" })],
    nextCursor: null,
  });
  threads.insertMessage.mockResolvedValueOnce({ email_message_id: "msg-d" });
  repo.findClientByEmail.mockResolvedValueOnce({ client_id: "cli-1", name: "Acme" });

  await service.syncConnection({}, "conn-1", {});

  expect(repo.findClientByEmail).toHaveBeenCalledWith({}, "client@acme.cm");
  // The THREAD carries the link, not the single message — a dossier reference in
  // one reply is about the whole exchange.
  expect(threads.updateThread).toHaveBeenCalledWith({}, "thr-1", { entity_ref: "client:cli-1" });
});

test("auto-links to a dossier when its ref appears in the subject (wins over client)", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ externalMessageId: "<f>", from: "client@acme.cm", subject: "Re: SLAS-2026-0001 shipment" })],
    nextCursor: null,
  });
  threads.insertMessage.mockResolvedValueOnce({ email_message_id: "msg-f" });
  repo.findDossierByRefs.mockResolvedValueOnce({ dossier_id: "dos-1", ref: "SLAS-2026-0001" });

  await service.syncConnection({}, "conn-1", {});

  expect(repo.findDossierByRefs).toHaveBeenCalledWith({}, expect.arrayContaining(["SLAS-2026-0001"]));
  expect(threads.updateThread).toHaveBeenCalledWith({}, "thr-1", { entity_ref: "dossier:dos-1" });
  expect(repo.findClientByEmail).not.toHaveBeenCalled(); // dossier match short-circuits
});

test("sanitizes the inbound HTML body before storing (stored-XSS guard)", async () => {
  mockFetchSince.mockResolvedValue({
    messages: [inbound({ externalMessageId: "<e>", subject: "E", bodyHtml: "<script>evil()</script><p>hi</p>", bodyText: "hi" })],
    nextCursor: null,
  });

  await service.syncConnection({}, "conn-1", {});

  const row = threads.insertMessage.mock.calls[0][1];
  expect(row.body_html).toBe("SANITIZED:<script>evil()</script><p>hi</p>"); // passed through the sanitizer
});

test("one failing folder does not abort its siblings", async () => {
  threads.syncableFolders.mockResolvedValue([INBOX, ARCHIVE]);
  mockFetchSince
    .mockRejectedValueOnce(new Error("SELECT INBOX failed"))
    .mockResolvedValueOnce({ messages: [inbound({ externalMessageId: "<g>" })], nextCursor: { uidvalidity: 10, last_uid: 4 } });

  const res = await service.syncConnection({}, "conn-1", {});

  expect(threads.setFolderError).toHaveBeenCalledWith({}, "fold-INBOX", "SELECT INBOX failed");
  expect(res.inserted).toBe(1); // Archive still synced
  expect(res.folders).toEqual([
    { folder: "INBOX", error: "SELECT INBOX failed" },
    { folder: "ARCHIVE", fetched: 1 },
  ]);
  // A partial success is a success for the connection's health: the mailbox is
  // reachable, one folder is not.
  expect(res.error).toBeUndefined();
});

test("records the error on the connection and does not throw", async () => {
  mockFetchSince.mockRejectedValue(new Error("IMAP auth failed"));
  const res = await service.syncConnection({}, "conn-1", {});
  expect(res.error).toBeUndefined(); // per-folder now, not per-connection
  expect(res.folders).toEqual([{ folder: "INBOX", error: "IMAP auth failed" }]);
  expect(repo.setError).toHaveBeenCalledWith({}, "conn-1", "IMAP auth failed");
});

test("a folder listing that fails stops the sync and records it on the connection", async () => {
  mockListFolders.mockRejectedValue(new Error("LIST refused"));
  const res = await service.syncConnection({}, "conn-1", {});
  expect(res.error).toBe("LIST refused");
  expect(repo.setError).toHaveBeenCalledWith({}, "conn-1", "LIST refused");
  expect(mockFetchSince).not.toHaveBeenCalled();
});

/*
 * WHY THIS ASSERTS 422 AND NOT THE 502 IT USED TO.
 *
 * Two implementations of this mapping landed within days of each other:
 * `mapSmtpError` (#160) called a rejected sender a 502 SMTP_SENDER_REJECTED,
 * and `explainSendError` called it a 422 SENDER_NOT_AUTHORIZED. Only the
 * second was wired to `send`, so this test (which used to assert the 502
 * contract) went red on main. Both paths now share the 422 classifier —
 * Test / system-email / platform probe included — because a mail server
 * refusing your FROM address is a mailbox-config verdict, not a Praxis 5xx.
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
  expect(threads.insertMessage).not.toHaveBeenCalled();
});

test("markRead propagates to the server adapter and flips the local row (G-3)", async () => {
  threads.getMessage.mockResolvedValue({
    email_message_id: "msg-1",
    email_thread_id: "thr-1",
    email_connection_id: "conn-1",
    external_message_id: "<mid>",
  });
  repo.getConnection.mockResolvedValue({ ...CONN, status: "CONNECTED" });

  const res = await service.markRead({}, "msg-1", "user-1");

  expect(mockMarkAsRead).toHaveBeenCalledWith("<mid>");
  // Read state is PER USER and PER CONVERSATION now. A markRead that does not
  // carry a user id is the bug the whole model change exists to remove.
  expect(threads.setThreadRead).toHaveBeenCalledWith({}, "user-1", "thr-1", true);
  expect(res).toMatchObject({ email_message_id: "msg-1", is_read: true });
});

test("markRead still flips the local row when server propagation fails", async () => {
  threads.getMessage.mockResolvedValue({
    email_message_id: "msg-2",
    email_thread_id: "thr-2",
    email_connection_id: "conn-1",
    external_message_id: "<mid>",
  });
  repo.getConnection.mockResolvedValue({ ...CONN, status: "CONNECTED" });
  mockMarkAsRead.mockRejectedValueOnce(new Error("provider down"));

  const res = await service.markRead({}, "msg-2", "user-1");

  expect(threads.setThreadRead).toHaveBeenCalledWith({}, "user-1", "thr-2", true);
  expect(res).toMatchObject({ email_message_id: "msg-2", is_read: true });
});

test("linkEntity binds the CONVERSATION, not the one message it was called on", async () => {
  threads.getMessage.mockResolvedValue({ email_message_id: "msg-9", email_thread_id: "thr-9" });
  const res = await service.linkEntity({}, { inboundId: "msg-9", entity_ref: "dossier:dos-2" });
  expect(threads.updateThread).toHaveBeenCalledWith({}, "thr-9", { entity_ref: "dossier:dos-2" });
  expect(res).toEqual({ email_thread_id: "thr-9", entity_ref: "dossier:dos-2" });
});
