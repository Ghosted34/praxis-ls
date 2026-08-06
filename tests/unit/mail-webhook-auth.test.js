"use strict";

/**
 * G-6 — webhook authenticity hardening on the pre-auth Microsoft / Google routes.
 *  • Microsoft Graph: a notification's `clientState` must resolve to a real,
 *    CONNECTED mailbox in the tenant — a forged/stale id is skipped, not synced.
 *  • Gmail Pub/Sub: a push whose `subscription` does not match the configured
 *    GOOGLE_PUBSUB_TOPIC is ignored before any decode/lookup.
 */

const mockFetchSince = jest.fn();
jest.mock("../../src/modules/mail/providers/imapSmtp.provider", () => ({
  ImapSmtpProvider: jest.fn().mockImplementation(() => ({ fetchSince: mockFetchSince, verify: jest.fn(), markAsRead: jest.fn() })),
}));
jest.mock("../../src/modules/mail/providers/microsoftGraph.provider", () => ({ MicrosoftGraphProvider: jest.fn() }));
jest.mock("../../src/modules/mail/providers/gmail.provider", () => ({ GmailProvider: jest.fn() }));
jest.mock("../../src/modules/mail/providers/microsoftOAuth", () => ({ authorizeUrl: jest.fn(), isConfigured: () => true, exchangeCode: jest.fn(), refresh: jest.fn() }));
jest.mock("../../src/modules/mail/providers/googleOAuth", () => ({ authorizeUrl: jest.fn(), isConfigured: () => true, exchangeCode: jest.fn(), refresh: jest.fn() }));
jest.mock("../../src/config/env", () => ({ config: { GOOGLE_PUBSUB_TOPIC: "projects/praxis/topics/mail" } }));
jest.mock("../../src/modules/security/setting/setting.service", () => ({ SECRET_SECTION: "integration_secret", readSecret: jest.fn(async () => "pw"), put: jest.fn() }));
jest.mock("../../src/shared/events/emit", () => ({ emitEvent: jest.fn(async () => {}), audit: jest.fn(), resolveActorId: async (c, i) => i }));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({ createDocument: jest.fn(async () => ({ doc_id: "v" })) }));
jest.mock("../../src/realtime/mail-bus", () => ({ publishMailEvent: jest.fn() }));
jest.mock("../../src/modules/mail/autodiscover", () => ({ autodiscover: jest.fn() }));
jest.mock("sanitize-html", () => { const fn = (h) => h; fn.defaults = { allowedTags: [], allowedAttributes: {} }; return fn; });

jest.mock("../../src/modules/mail/mail.repo", () => ({
  getConnection: jest.fn(),
  findByAddress: jest.fn(),
  insertInbound: jest.fn(),
  setCursor: jest.fn(async () => {}),
  setError: jest.fn(async () => {}),
  addAttachment: jest.fn(async () => ({})),
  findClientByEmail: jest.fn(async () => null),
  findDossierByRefs: jest.fn(async () => null),
  setEntityRef: jest.fn(async () => {}),
}));

const repo = require("../../src/modules/mail/mail.repo");
const service = require("../../src/modules/mail/mail.service");

const CONN = { email_connection_id: "conn-1", provider: "imap_smtp", email_address: "me@co.cm", status: "CONNECTED", secret_key: "k", sync_cursor: null };

beforeEach(() => {
  jest.clearAllMocks();
  repo.getConnection.mockResolvedValue(CONN);
  mockFetchSince.mockResolvedValue({ messages: [], nextCursor: { uidvalidity: 1, last_uid: 1 } });
  repo.insertInbound.mockResolvedValue(null);
});

describe("Microsoft Graph webhook (G-6)", () => {
  it("skips a clientState that is not a real connection in the tenant", async () => {
    repo.getConnection.mockResolvedValue(null); // forged / stale / other-tenant id
    const res = await service.handleGraphNotification({}, { value: [{ clientState: "00000000-0000-0000-0000-000000000000" }] }, {});
    expect(res.synced).toBe(0);
    expect(mockFetchSince).not.toHaveBeenCalled();
  });

  it("skips a clientState that is not CONNECTED", async () => {
    repo.getConnection.mockResolvedValue({ ...CONN, status: "ERROR" });
    const res = await service.handleGraphNotification({}, { value: [{ clientState: "conn-1" }] }, {});
    expect(res.synced).toBe(0);
    expect(mockFetchSince).not.toHaveBeenCalled();
  });

  it("syncs a clientState that resolves to a connected mailbox", async () => {
    const res = await service.handleGraphNotification({}, { value: [{ clientState: "conn-1" }] }, {});
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
    const res = await service.handleGmailNotification({}, pushBody({ emailAddress: "me@co.cm" }, "projects/other/topics/x"));
    expect(res.ignored).toBe(true);
    expect(repo.findByAddress).not.toHaveBeenCalled();
  });

  it("ignores a push for an unknown mailbox even with a matching subscription", async () => {
    repo.findByAddress.mockResolvedValue(null);
    const res = await service.handleGmailNotification({}, pushBody({ emailAddress: "ghost@co.cm" }, "projects/praxis/topics/mail/subscriptions/s"));
    expect(res.ignored).toBe(true);
  });

  it("syncs a matching push for a known mailbox", async () => {
    repo.findByAddress.mockResolvedValue(CONN);
    const res = await service.handleGmailNotification({}, pushBody({ emailAddress: "me@co.cm" }, "projects/praxis/topics/mail/subscriptions/s"));
    expect(res).not.toBeUndefined();
    expect(mockFetchSince).toHaveBeenCalled();
  });
});
