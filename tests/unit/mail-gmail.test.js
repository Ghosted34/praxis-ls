/**
 * GmailProvider unit tests — hermetic (axios mocked, no network). Covers
 * capabilities, Gmail payload → NormalizedEmail (base64url body decode, header
 * parsing), and the history-delta fetch + cursor. See EMAIL_ENGINE_PLAN Phase 2.
 */
"use strict";

jest.mock("axios");
const axios = require("axios");
const {
  GmailProvider,
} = require("../../src/modules/mail/providers/gmail.provider");

const provider = () =>
  new GmailProvider({
    getAccessToken: async () => "tok",
    emailAddress: "me@co.cm",
  });

const b64url = (s) =>
  Buffer.from(s)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const B64_TEXT = b64url("hello");
const B64_HTML = b64url("<p>hi</p>");

const GMSG = {
  id: "m1",
  threadId: "t1",
  labelIds: ["INBOX", "UNREAD"],
  internalDate: "1754040000000",
  snippet: "hi",
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: "Sender <sender@ext.com>" },
      { name: "To", value: "me@co.cm" },
      { name: "Subject", value: "Hey" },
      { name: "Message-ID", value: "<mid@ext>" },
    ],
    parts: [
      { mimeType: "text/plain", body: { data: B64_TEXT } },
      { mimeType: "text/html", body: { data: B64_HTML } },
    ],
  },
};

beforeEach(() => jest.clearAllMocks());

test("capabilities: delta + server threads, no push, no appendSent (Gmail files Sent)", () => {
  expect(provider().capabilities()).toMatchObject({
    push: false,
    delta: true,
    serverThreads: true,
    appendSent: false,
  });
});

test("_normalize decodes base64url bodies and parses headers; threadKey = threadId", () => {
  const n = provider()._normalize(GMSG);
  expect(n.externalMessageId).toBe("m1");
  expect(n.threadKey).toBe("t1");
  expect(n.from).toBe("sender@ext.com");
  expect(n.to).toEqual(["me@co.cm"]);
  expect(n.subject).toBe("Hey");
  expect(n.bodyText).toBe("hello");
  expect(n.bodyHtml).toBe("<p>hi</p>");
  expect(n.isRead).toBe(false); // UNREAD present
});

test("fetchSince(history) collects messagesAdded ids, fetches them, advances the cursor", async () => {
  axios
    .mockResolvedValueOnce({
      data: {
        history: [{ messagesAdded: [{ message: { id: "m1" } }] }],
        historyId: "999",
      },
    }) // /history
    .mockResolvedValueOnce({ data: GMSG }); // /messages/m1

  const { messages, nextCursor } = await provider().fetchSince({
    history_id: "100",
  });

  expect(messages.map((m) => m.externalMessageId)).toEqual(["m1"]);
  expect(nextCursor).toEqual({ history_id: "999" });
  expect(axios).toHaveBeenCalledTimes(2);
});

test("getMessage hydrates attachment bytes from the attachmentId ref", async () => {
  const withAtt = {
    id: "m2",
    threadId: "t2",
    labelIds: ["INBOX"],
    internalDate: "1754040000000",
    snippet: "doc",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "s@ext.com" },
        { name: "Subject", value: "Doc" },
      ],
      parts: [
        { mimeType: "text/plain", body: { data: B64_TEXT } },
        {
          mimeType: "application/pdf",
          filename: "f.pdf",
          body: { attachmentId: "att1", size: 3 },
        },
      ],
    },
  };
  axios
    .mockResolvedValueOnce({ data: withAtt }) // /messages/m2 full
    .mockResolvedValueOnce({ data: { data: b64url("PDF") } }); // /messages/m2/attachments/att1

  const n = await provider().getMessage("m2");

  expect(n.attachments).toHaveLength(1);
  expect(n.attachments[0]).toMatchObject({
    filename: "f.pdf",
    content_type: "application/pdf",
  });
  expect(n.attachments[0].content.toString()).toBe("PDF");
});

test("fetchSince(no cursor) seeds from profile historyId + recent INBOX list", async () => {
  axios
    .mockResolvedValueOnce({
      data: { emailAddress: "me@co.cm", historyId: "555" },
    }) // /profile
    .mockResolvedValueOnce({ data: { messages: [{ id: "m1" }] } }) // /messages list
    .mockResolvedValueOnce({ data: GMSG }); // /messages/m1

  const { messages, nextCursor } = await provider().fetchSince(null);

  expect(messages).toHaveLength(1);
  expect(nextCursor).toEqual({ history_id: "555" });
});
