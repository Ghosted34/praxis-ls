/**
 * ImapSmtpProvider unit tests — hermetic (imapflow + mailparser mocked, no real
 * server). Covers the parts that actually bite: the UIDVALIDITY-safe cursor,
 * incremental fetch, normalization/threadKey, capabilities, and reply threading.
 * See doc/EMAIL_ENGINE_PLAN.md §5/§6.
 */
"use strict";

// mailparser: our mock just parses the JSON we stashed in `source`.
jest.mock("mailparser", () => ({
  simpleParser: async (src) => JSON.parse(src.toString()),
}));

// imapflow: a fake ImapFlow driven by static __mailbox / __messages.
jest.mock("imapflow", () => {
  class ImapFlow {
    constructor(opts) {
      this.opts = opts;
      this.mailbox = null;
    }
    async connect() {}
    async logout() {}
    async getMailboxLock() {
      this.mailbox = ImapFlow.__mailbox;
      return { release() {} };
    }

    async *fetch() {
      for (const m of ImapFlow.__messages) yield m;
    }
    async mailboxExists() {
      return false;
    }
    async append() {}
  }
  ImapFlow.__mailbox = { uidValidity: 10 };
  ImapFlow.__messages = [];
  return { ImapFlow };
});

const { ImapFlow } = require("imapflow");
const {
  ImapSmtpProvider,
} = require("../../src/modules/mail/mail/providers/imapSmtp.provider");

const msg = (uid, overrides = {}) => ({
  uid,
  flags: new Set(),
  source: Buffer.from(
    JSON.stringify({
      messageId: `<msg-${uid}@test>`,
      subject: `Subject ${uid}`,
      from: { value: [{ address: "sender@ext.com" }] },
      to: { value: [{ address: "me@company.cm" }] },
      references: [],
      inReplyTo: null,
      html: `<p>${uid}</p>`,
      text: String(uid),
      date: "2026-08-01T10:00:00.000Z",
      attachments: [],
      ...overrides,
    }),
  ),
});

const conn = {
  email_address: "me@company.cm",
  imap_host: "imap.test",
  imap_port: 993,
  imap_secure: true,
  smtp_host: "smtp.test",
  smtp_port: 587,
  auth_user: "me@company.cm",
  password: "pw",
};

describe("ImapSmtpProvider.capabilities", () => {
  it("advertises appendSent (SMTP won't file Sent for us) and no push/delta", () => {
    const caps = new ImapSmtpProvider(conn).capabilities();
    expect(caps.appendSent).toBe(true);
    expect(caps.push).toBe(false);
    expect(caps.delta).toBe(false);
  });
});

describe("ImapSmtpProvider.fetchSince cursor", () => {
  beforeEach(() => {
    ImapFlow.__mailbox = { uidValidity: 10 };
    ImapFlow.__messages = [msg(5)];
  });

  it("fresh mailbox (no cursor): fetches all and returns the max uid + uidvalidity", async () => {
    const { messages, nextCursor } = await new ImapSmtpProvider(
      conn,
    ).fetchSince(null);
    expect(messages).toHaveLength(1);
    expect(messages[0].externalMessageId).toBe("<msg-5@test>");
    expect(nextCursor).toEqual({ uidvalidity: 10, last_uid: 5 });
  });

  it("same uidvalidity, cursor past the message: fetches nothing (incremental)", async () => {
    const { messages, nextCursor } = await new ImapSmtpProvider(
      conn,
    ).fetchSince({ uidvalidity: 10, last_uid: 5 });
    expect(messages).toHaveLength(0);
    expect(nextCursor).toEqual({ uidvalidity: 10, last_uid: 5 });
  });

  it("uidvalidity changed: ignores the stale cursor and re-scans from 0", async () => {
    const { messages } = await new ImapSmtpProvider(conn).fetchSince({
      uidvalidity: 99,
      last_uid: 100,
    });
    expect(messages).toHaveLength(1); // re-scanned despite last_uid > uid
    expect(messages[0].externalMessageId).toBe("<msg-5@test>");
  });
});

describe("ImapSmtpProvider._normalize threadKey", () => {
  const p = new ImapSmtpProvider(conn);
  it("prefers References[0], then In-Reply-To, then Message-Id", () => {
    expect(
      p._normalize(
        { messageId: "<m>", references: ["<root>"], inReplyTo: "<parent>" },
        { uid: 1 },
      ).threadKey,
    ).toBe("<root>");
    expect(
      p._normalize({ messageId: "<m>", inReplyTo: "<parent>" }, { uid: 1 })
        .threadKey,
    ).toBe("<parent>");
    expect(p._normalize({ messageId: "<m>" }, { uid: 1 }).threadKey).toBe(
      "<m>",
    );
  });
  it("extracts addresses and marks direction IN", () => {
    const n = p._normalize(
      {
        messageId: "<m>",
        from: { value: [{ address: "a@b" }] },
        to: { value: [{ address: "c@d" }] },
      },
      { uid: 1 },
    );
    expect(n.from).toBe("a@b");
    expect(n.to).toEqual(["c@d"]);
    expect(n.direction).toBe("IN");
  });
});

describe("ImapSmtpProvider.createReply", () => {
  it("threads the reply: sets In-Reply-To and appends the original to References", async () => {
    const p = new ImapSmtpProvider(conn);
    const spy = jest
      .spyOn(p, "sendEmail")
      .mockResolvedValue({ externalMessageId: "<new>", threadKey: "<root>" });
    await p.createReply("<orig>", {
      to: "sender@ext.com",
      references: ["<root>"],
      bodyText: "hi",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        inReplyTo: "<orig>",
        references: ["<root>", "<orig>"],
      }),
    );
  });
});
