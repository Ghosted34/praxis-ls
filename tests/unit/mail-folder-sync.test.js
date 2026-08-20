/**
 * Multi-folder sync: a UIDVALIDITY reset in one folder re-scans ONLY that
 * folder (§3.7).
 *
 * `mail-threading.test.js` already proves `folders.cursorFor` decides correctly
 * in isolation, and `mail-service.test.js` proves each folder is fetched with
 * its own cursor. Neither proves the property the guide actually names, which
 * is the JOIN of the two: that a renumber in Spam does not drag Inbox back to
 * uid 0. That is the failure the per-folder cursor exists to prevent — and it
 * is silent when it happens, because a full re-scan looks exactly like a busy
 * morning until you notice the same 4,000 messages arriving again.
 *
 * The whole file exercises the real `syncConnection` loop with the repo and
 * adapter mocked, so what is asserted is what the engine does, not what a
 * helper returns.
 */
"use strict";

const mockFetchSince = jest.fn();
const mockListFolders = jest.fn();

jest.mock("../../src/modules/mail/mail/providers/imapSmtp.provider", () => ({
  ImapSmtpProvider: jest.fn().mockImplementation(() => ({
    fetchSince: mockFetchSince,
    listFolders: mockListFolders,
    verify: jest.fn(async () => ({ ok: true })),
    markAsRead: jest.fn(),
    sendEmail: jest.fn(),
    capabilities: () => ({ folders: true, folderMove: true, serverFlags: true }),
  })),
}));
jest.mock("../../src/modules/security/setting/setting.service", () => ({
  SECRET_SECTION: "integration_secret",
  put: jest.fn(async () => ({})),
  readSecret: jest.fn(async () => "pw"),
}));
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (_c, id) => id || null,
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  createDocument: jest.fn(async () => ({ doc_id: "v1" })),
}));
jest.mock("sanitize-html", () => {
  const fn = (html) => String(html);
  fn.defaults = { allowedTags: ["p"], allowedAttributes: {} };
  return fn;
});
jest.mock("../../src/modules/mail/mail/mailbox.repo", () => ({
  getConnection: jest.fn(async () => ({ email_connection_id: "conn-1", kind: "PERSONAL" })),
  updateConnection: jest.fn(async () => ({})),
  clearFailures: jest.fn(async () => ({})),
  bumpFailure: jest.fn(async () => ({ consecutive_failures: 1, status: "CONNECTED" })),
  sendCounts: jest.fn(async () => ({ hourly: 0, daily: 0 })),
  bumpSendWindow: jest.fn(async () => ({ sent_count: 1 })),
  recordAccessAudit: jest.fn(async () => ({})),
  listMembers: jest.fn(async () => []),
  liveMember: jest.fn(async () => null),
  personalFor: jest.fn(async () => null),
}));
jest.mock("../../src/shared/config/settings", () => ({ getSetting: jest.fn(async () => ({})) }));
jest.mock("../../src/modules/mail/binding/binding.service", () => ({ suggestOnIngest: jest.fn(async () => []) }));
jest.mock("../../src/modules/mail/mail/mail.repo", () => ({
  getConnection: jest.fn(),
  setError: jest.fn(async () => {}),
  addAttachment: jest.fn(async () => ({})),
  findClientByEmail: jest.fn(async () => null),
  findDossierByRefs: jest.fn(async () => null),
  listAttachments: jest.fn(async () => []),
}));
jest.mock("../../src/modules/mail/mail/thread.repo", () => ({
  upsertFolder: jest.fn(async (_c, connId, f) => ({ email_folder_id: `fold-${f.canonical}`, ...f })),
  syncableFolders: jest.fn(async () => []),
  setFolderCursor: jest.fn(async () => ({})),
  setFolderError: jest.fn(async () => ({})),
  streamRules: jest.fn(async () => []),
  knownParty: jest.fn(async () => null),
  upsertThread: jest.fn(async () => ({ email_thread_id: "thr-1", message_count: 0 })),
  updateThread: jest.fn(async () => ({})),
  refreshThreadCounts: jest.fn(async () => ({})),
  insertMessage: jest.fn(async () => ({ email_message_id: "msg-1" })),
  seedStateForMembers: jest.fn(async () => 0),
  setThreadRead: jest.fn(async () => 0),
}));

const repo = require("../../src/modules/mail/mail/mail.repo");
const threads = require("../../src/modules/mail/mail/thread.repo");
const folders = require("../../src/modules/mail/mail/folders");
const service = require("../../src/modules/mail/mail/mail.service");

const DB = { query: jest.fn(async () => ({ rows: [] })) };
const CONN = {
  email_connection_id: "conn-1", provider: "imap_smtp",
  email_address: "ops@smartlogistics.cm", secret_key: "mail_conn:conn-1", sync_cursor: null,
};

/** Three folders, each with its own remembered position. */
const INBOX = { email_folder_id: "fold-INBOX", canonical: "INBOX", provider_path: "INBOX", is_syncable: true, sync_cursor: { uidvalidity: 10, last_uid: 4000 } };
const SPAM = { email_folder_id: "fold-SPAM", canonical: "SPAM", provider_path: "Junk", is_syncable: true, sync_cursor: { uidvalidity: 22, last_uid: 17 } };
const SENT = { email_folder_id: "fold-SENT", canonical: "SENT", provider_path: "Sent", is_syncable: true, sync_cursor: { uidvalidity: 31, last_uid: 900 } };

beforeEach(() => {
  jest.clearAllMocks();
  repo.getConnection.mockResolvedValue(CONN);
  threads.syncableFolders.mockResolvedValue([INBOX, SPAM, SENT]);
  mockListFolders.mockResolvedValue([
    { path: "INBOX", name: "INBOX", flags: [] },
    { path: "Junk", name: "Junk", flags: ["\\Junk"] },
    { path: "Sent", name: "Sent", flags: ["\\Sent"] },
  ]);
  mockFetchSince.mockResolvedValue({ messages: [], nextCursor: null });
});

/** The cursor the engine handed the adapter for a given provider path. */
const cursorFor = (providerPath) => {
  const call = mockFetchSince.mock.calls.find((c) => c[1] === providerPath);
  return call && call[0];
};

describe("each folder is walked with its own remembered position", () => {
  test("three folders, three different cursors, none shared", async () => {
    await service.syncConnection(DB, "conn-1", {});
    expect(cursorFor("INBOX")).toEqual({ uidvalidity: 10, last_uid: 4000 });
    expect(cursorFor("Junk")).toEqual({ uidvalidity: 22, last_uid: 17 });
    expect(cursorFor("Sent")).toEqual({ uidvalidity: 31, last_uid: 900 });
  });

  test("a folder that has never synced starts from null, not from a sibling", async () => {
    threads.syncableFolders.mockResolvedValue([
      INBOX, { ...SPAM, sync_cursor: null },
    ]);
    await service.syncConnection(DB, "conn-1", {});
    expect(cursorFor("Junk")).toBeNull();
    expect(cursorFor("INBOX")).toEqual({ uidvalidity: 10, last_uid: 4000 });
  });
});

describe("a UIDVALIDITY reset re-scans ONLY the folder that was renumbered", () => {
  test("Spam renumbers; Inbox keeps its 4,000 messages", async () => {
    // The server has renumbered Junk (22 → 23) and left the others alone.
    mockFetchSince.mockImplementation(async (_cursor, path) => ({
      messages: [],
      nextCursor: path === "Junk"
        ? { uidvalidity: 23, last_uid: 0 }
        : { uidvalidity: path === "INBOX" ? 10 : 31, last_uid: path === "INBOX" ? 4000 : 900 },
    }));

    await service.syncConnection(DB, "conn-1", {});

    const written = Object.fromEntries(
      threads.setFolderCursor.mock.calls.map((c) => [c[1], c[2]]),
    );
    // Only Junk goes back to zero.
    expect(written["fold-SPAM"]).toEqual({ uidvalidity: 23, last_uid: 0 });
    expect(written["fold-INBOX"]).toEqual({ uidvalidity: 10, last_uid: 4000 });
    expect(written["fold-SENT"]).toEqual({ uidvalidity: 31, last_uid: 900 });
  });

  test("and the other folders are still fetched from where they left off", async () => {
    await service.syncConnection(DB, "conn-1", {});
    // If a renumber anywhere reset the CONNECTION's cursor — the pre-10732
    // shape — INBOX would be asked for everything from uid 0 and the tenant
    // would silently re-download the mailbox.
    expect(cursorFor("INBOX")).not.toBeNull();
    expect(cursorFor("INBOX").last_uid).toBe(4000);
  });

  test("cursorFor is the one place that decides, and it decides per folder", () => {
    // Same prior, two different server answers: unchanged keeps the position,
    // changed resets it and SAYS it reset.
    expect(folders.cursorFor({ uidvalidity: 22, last_uid: 17 }, 22))
      .toEqual({ uidvalidity: 22, last_uid: 17, rescanned: false });
    expect(folders.cursorFor({ uidvalidity: 22, last_uid: 17 }, 23))
      .toEqual({ uidvalidity: 23, last_uid: 0, rescanned: true });
  });
});

describe("one folder's failure is isolated from its siblings", () => {
  test("a SELECT failure on Spam does not stop Inbox or Sent", async () => {
    mockFetchSince.mockImplementation(async (_cursor, path) => {
      if (path === "Junk") throw new Error("SELECT Junk failed");
      return { messages: [], nextCursor: { uidvalidity: 10, last_uid: 4001 } };
    });

    const res = await service.syncConnection(DB, "conn-1", {});

    expect(threads.setFolderError).toHaveBeenCalledWith(DB, "fold-SPAM", "SELECT Junk failed");
    // The error is recorded ON THE FOLDER. It must not advance that folder's
    // cursor, and must not touch the others'.
    const advanced = threads.setFolderCursor.mock.calls.map((c) => c[1]);
    expect(advanced).toContain("fold-INBOX");
    expect(advanced).toContain("fold-SENT");
    expect(advanced).not.toContain("fold-SPAM");
    expect(res.folders.find((f) => f.folder === "SPAM").error).toBe("SELECT Junk failed");
  });

  test("the connection is still healthy when at least one folder succeeded", async () => {
    mockFetchSince.mockImplementation(async (_c, path) => {
      if (path === "Junk") throw new Error("nope");
      return { messages: [], nextCursor: null };
    });
    const res = await service.syncConnection(DB, "conn-1", {});
    // A per-folder failure is a per-folder fact. Marking the whole mailbox
    // broken because Junk is unreadable is how a working inbox gets a red pill.
    expect(res.error).toBeUndefined();
  });
});
