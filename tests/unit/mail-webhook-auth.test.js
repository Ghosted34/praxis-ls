"use strict";

/**
 * G-6 — webhook authenticity hardening on the pre-auth Microsoft / Google routes.
 *  • Microsoft Graph: a notification's `clientState` must resolve to a real,
 *    CONNECTED mailbox in the tenant — a forged/stale id is skipped, not synced.
 *  • Gmail Pub/Sub: a push whose `subscription` does not match the configured
 *    GOOGLE_PUBSUB_TOPIC is ignored before any decode/lookup.
 */

const mockFetchSince = jest.fn();
jest.mock("../../src/modules/mail/mail/providers/imapSmtp.provider", () => ({
  ImapSmtpProvider: jest.fn().mockImplementation(() => ({
    fetchSince: mockFetchSince,
    verify: jest.fn(),
    markAsRead: jest.fn(),
  })),
}));
jest.mock(
  "../../src/modules/mail/mail/providers/microsoftGraph.provider",
  () => ({
    MicrosoftGraphProvider: jest.fn(),
  }),
);
jest.mock("../../src/modules/mail/mail/providers/gmail.provider", () => ({
  GmailProvider: jest.fn(),
}));
jest.mock("../../src/modules/mail/mail/providers/microsoftOAuth", () => ({
  authorizeUrl: jest.fn(),
  isConfigured: () => true,
  exchangeCode: jest.fn(),
  refresh: jest.fn(),
}));
jest.mock("../../src/modules/mail/mail/providers/googleOAuth", () => ({
  authorizeUrl: jest.fn(),
  isConfigured: () => true,
  exchangeCode: jest.fn(),
  refresh: jest.fn(),
}));
jest.mock("../../src/config/env", () => ({
  config: { GOOGLE_PUBSUB_TOPIC: "projects/praxis/topics/mail" },
}));
jest.mock("../../src/modules/security/setting/setting.service", () => ({
  SECRET_SECTION: "integration_secret",
  readSecret: jest.fn(async () => "pw"),
  put: jest.fn(),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => {}),
  audit: jest.fn(),
  resolveActorId: async (c, i) => i,
}));
jest.mock(
  "../../src/modules/vault/document_vault/document_vault.service",
  () => ({ createDocument: jest.fn(async () => ({ doc_id: "v" })) }),
);
jest.mock("../../src/realtime/mail-bus", () => ({
  publishMailEvent: jest.fn(),
}));
jest.mock("../../src/modules/mail/mail/autodiscover", () => ({
  autodiscover: jest.fn(),
}));
jest.mock("sanitize-html", () => {
  const fn = (h) => h;
  fn.defaults = { allowedTags: [], allowedAttributes: {} };
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
  findByAddress: jest.fn(),
  setError: jest.fn(async () => {}),
  addAttachment: jest.fn(async () => ({})),
  findClientByEmail: jest.fn(async () => null),
  findDossierByRefs: jest.fn(async () => null),
}));
// PR-1A: the sync loop the webhooks trigger now walks FOLDERS and writes into
// the conversation model. Mocked for the same reason mail.repo is — this suite
// is about webhook authenticity, not about what the sync then stores.
jest.mock("../../src/modules/mail/mail/thread.repo", () => ({
  upsertFolder: jest.fn(async () => ({ email_folder_id: "fold-INBOX", canonical: "INBOX", provider_path: "INBOX", is_syncable: true, sync_cursor: null })),
  syncableFolders: jest.fn(async () => [{ email_folder_id: "fold-INBOX", canonical: "INBOX", provider_path: "INBOX", sync_cursor: null }]),
  setFolderCursor: jest.fn(async () => ({})),
  setFolderError: jest.fn(async () => ({})),
  streamRules: jest.fn(async () => []),
  knownParty: jest.fn(async () => null),
  upsertThread: jest.fn(async () => ({ email_thread_id: "thr-1", message_count: 0 })),
  updateThread: jest.fn(async () => ({})),
  refreshThreadCounts: jest.fn(async () => ({})),
  insertMessage: jest.fn(async () => null),
  seedStateForMembers: jest.fn(async () => 0),
  setThreadRead: jest.fn(async () => 0),
}));

const repo = require("../../src/modules/mail/mail/mail.repo");
const service = require("../../src/modules/mail/mail/mail.service");

const CONN = {
  email_connection_id: "conn-1",
  provider: "imap_smtp",
  email_address: "me@co.cm",
  status: "CONNECTED",
  secret_key: "k",
  sync_cursor: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  repo.getConnection.mockResolvedValue(CONN);
  mockFetchSince.mockResolvedValue({
    messages: [],
    nextCursor: { uidvalidity: 1, last_uid: 1 },
  });
});

describe("Microsoft Graph webhook (G-6)", () => {
  it("skips a clientState that is not a real connection in the tenant", async () => {
    repo.getConnection.mockResolvedValue(null); // forged / stale / other-tenant id
    const res = await service.handleGraphNotification(
      {},
      { value: [{ clientState: "00000000-0000-0000-0000-000000000000" }] },
      {},
    );
    expect(res.synced).toBe(0);
    expect(mockFetchSince).not.toHaveBeenCalled();
  });

  it("skips a clientState that is not CONNECTED", async () => {
    repo.getConnection.mockResolvedValue({ ...CONN, status: "ERROR" });
    const res = await service.handleGraphNotification(
      {},
      { value: [{ clientState: "conn-1" }] },
      {},
    );
    expect(res.synced).toBe(0);
    expect(mockFetchSince).not.toHaveBeenCalled();
  });

  it("syncs a clientState that resolves to a connected mailbox", async () => {
    const res = await service.handleGraphNotification(
      {},
      { value: [{ clientState: "conn-1" }] },
      {},
    );
    expect(res.synced).toBe(1);
    expect(mockFetchSince).toHaveBeenCalled();
  });
});

describe("Google Gmail Pub/Sub webhook (G-6)", () => {
  const pushBody = (payload, subscription) => ({
    message: { data: Buffer.from(JSON.stringify(payload)).toString("base64") },
    subscription,
  });

  it("ignores a push whose subscription does not match the configured topic", async () => {
    const res = await service.handleGmailNotification(
      {},
      pushBody({ emailAddress: "me@co.cm" }, "projects/other/topics/x"),
    );
    expect(res.ignored).toBe(true);
    expect(repo.findByAddress).not.toHaveBeenCalled();
  });

  it("ignores a push for an unknown mailbox even with a matching subscription", async () => {
    repo.findByAddress.mockResolvedValue(null);
    const res = await service.handleGmailNotification(
      {},
      pushBody(
        { emailAddress: "ghost@co.cm" },
        "projects/praxis/topics/mail/subscriptions/s",
      ),
    );
    expect(res.ignored).toBe(true);
  });

  it("syncs a matching push for a known mailbox", async () => {
    repo.findByAddress.mockResolvedValue(CONN);
    const res = await service.handleGmailNotification(
      {},
      pushBody(
        { emailAddress: "me@co.cm" },
        "projects/praxis/topics/mail/subscriptions/s",
      ),
    );
    expect(res).not.toBeUndefined();
    expect(mockFetchSince).toHaveBeenCalled();
  });
});
