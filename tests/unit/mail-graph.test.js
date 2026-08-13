/**
 * MicrosoftGraphProvider unit tests — hermetic (axios mocked, no network).
 * Covers capabilities, Graph→NormalizedEmail mapping, delta paging + cursor, and
 * the create-reply sequence. See doc/EMAIL_ENGINE_PLAN.md Phase 2.
 */
"use strict";

jest.mock("axios");
const axios = require("axios");
const {
  MicrosoftGraphProvider,
} = require("../../src/modules/mail/providers/microsoftGraph.provider");

const provider = () =>
  new MicrosoftGraphProvider({ getAccessToken: async () => "access-tok" });

beforeEach(() => jest.clearAllMocks());

test("capabilities: push + delta + server threads, and NOT appendSent (Graph files Sent)", () => {
  const caps = provider().capabilities();
  expect(caps).toMatchObject({
    push: true,
    delta: true,
    serverThreads: true,
    appendSent: false,
  });
});

test("_normalize maps a Graph message and uses conversationId as threadKey", () => {
  const n = provider()._normalize({
    id: "AAMk-1",
    conversationId: "conv-9",
    internetMessageId: "<x@ms>",
    subject: "Hello",
    from: { emailAddress: { address: "sender@ext.com" } },
    toRecipients: [{ emailAddress: { address: "me@co.cm" } }],
    body: { contentType: "HTML", content: "<p>hi</p>" },
    receivedDateTime: "2026-08-01T09:00:00Z",
    isRead: false,
  });
  expect(n.externalMessageId).toBe("AAMk-1");
  expect(n.threadKey).toBe("conv-9");
  expect(n.from).toBe("sender@ext.com");
  expect(n.to).toEqual(["me@co.cm"]);
  expect(n.bodyHtml).toBe("<p>hi</p>");
  expect(n.direction).toBe("IN");
});

test("fetchSince follows nextLink then persists the deltaLink as the cursor", async () => {
  axios
    .mockResolvedValueOnce({
      data: {
        value: [
          {
            id: "m1",
            conversationId: "c1",
            body: { contentType: "Text", content: "1" },
          },
        ],
        "@odata.nextLink": "https://graph/next",
      },
    })
    .mockResolvedValueOnce({
      data: {
        value: [
          {
            id: "m2",
            conversationId: "c2",
            body: { contentType: "Text", content: "2" },
          },
        ],
        "@odata.deltaLink": "https://graph/delta-NEXT",
      },
    });

  const { messages, nextCursor } = await provider().fetchSince(null);

  expect(messages.map((m) => m.externalMessageId)).toEqual(["m1", "m2"]);
  expect(nextCursor).toEqual({ delta_link: "https://graph/delta-NEXT" });
  expect(axios).toHaveBeenCalledTimes(2);
});

test("fetchSince hydrates file attachments when hasAttachments is set", async () => {
  axios
    .mockResolvedValueOnce({
      data: {
        value: [
          {
            id: "m1",
            conversationId: "c1",
            hasAttachments: true,
            body: { contentType: "Text", content: "hi" },
          },
        ],
        "@odata.deltaLink": "https://graph/delta",
      },
    })
    .mockResolvedValueOnce({
      data: {
        value: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: "f.pdf",
            contentType: "application/pdf",
            size: 3,
            contentBytes: Buffer.from("abc").toString("base64"),
          },
        ],
      },
    });

  const { messages } = await provider().fetchSince(null);

  expect(messages[0].attachments).toHaveLength(1);
  expect(messages[0].attachments[0]).toMatchObject({
    filename: "f.pdf",
    content_type: "application/pdf",
  });
  expect(messages[0].attachments[0].content.toString()).toBe("abc");
  expect(axios).toHaveBeenCalledTimes(2); // delta + attachments
});

test("createReply: createReply → patch body → send, returns new id + conversation", async () => {
  axios
    .mockResolvedValueOnce({
      data: { id: "draft-1", conversationId: "conv-1" },
    }) // createReply
    .mockResolvedValueOnce({ data: {} }) // PATCH body
    .mockResolvedValueOnce({ data: {} }); // send

  const res = await provider().createReply("orig-id", { bodyText: "thanks" });

  expect(res).toEqual({ externalMessageId: "draft-1", threadKey: "conv-1" });
  expect(axios).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      method: "POST",
      url: expect.stringContaining("/me/messages/orig-id/createReply"),
    }),
  );
  expect(axios).toHaveBeenNthCalledWith(
    3,
    expect.objectContaining({
      method: "POST",
      url: expect.stringContaining("/me/messages/draft-1/send"),
    }),
  );
});
