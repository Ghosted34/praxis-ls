/**
 * thread.service — the conversation layer. Hermetic: the repo, the access
 * checks and the provider adapter are all mocked, so what is under test is the
 * service's own decisions.
 *
 * Three of those decisions are load-bearing and each has a test that fails loudly
 * if it is reversed:
 *
 *   1. READ STATE IS PER USER. Every call carries an actor. A handler that
 *      forgets one shows Marie's unread count to Paul.
 *   2. THE LOCAL CHANGE STANDS EVEN WHEN THE MAIL SERVER REFUSES. The user
 *      pressed the button; the button has to work.
 *   3. A BULK ACTION REPORTS ITS FAILURES rather than failing whole. Archiving
 *      forty conversations and silently dropping two is worse than saying which.
 */
"use strict";

jest.mock("../../src/modules/mail/mail/thread.repo");
jest.mock("../../src/modules/mail/mail/mail.repo");
jest.mock("../../src/modules/mail/mail/access", () => ({
  assertCanRead: jest.fn(async () => true),
}));
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (c, id) => id || null,
  emitEvent: jest.fn(async () => ({})),
}));

const repo = require("../../src/modules/mail/mail/thread.repo");
const mailRepo = require("../../src/modules/mail/mail/mail.repo");
const access = require("../../src/modules/mail/mail/access");
const { emitEvent } = require("../../src/shared/events/emit");
const service = require("../../src/modules/mail/mail/thread.service");

const ME = { user_id: "user-1" };
const THREAD = {
  email_thread_id: "thr-1",
  email_connection_id: "conn-1",
  subject: "Demurrage",
  messages: [
    { email_message_id: "m1", external_message_id: "<a>" },
    { email_message_id: "m2", external_message_id: "<b>" },
  ],
};

const mockMarkAsRead = jest.fn(async () => ({}));
const mockMoveMessage = jest.fn(async () => ({}));

beforeEach(() => {
  jest.clearAllMocks();
  repo.getThread.mockResolvedValue(THREAD);
  repo.getThreadById.mockResolvedValue(THREAD);
  repo.setThreadRead.mockResolvedValue(2);
  repo.setThreadStarred.mockResolvedValue(2);
  repo.moveThread.mockResolvedValue([{ email_message_id: "m1" }, { email_message_id: "m2" }]);
  repo.updateThread.mockResolvedValue({ email_thread_id: "thr-1", stream: "HUMAN" });
  repo.syncableFolders.mockResolvedValue([{ canonical: "ARCHIVE", provider_path: "Archive" }]);
  repo.ensureCanonicalFolder.mockResolvedValue({ email_folder_id: "fold-ARCHIVE", canonical: "ARCHIVE" });
  repo.applyLabel.mockResolvedValue(true);
  repo.listThreads.mockResolvedValue([]);
  access.assertCanRead.mockResolvedValue(true);
  mailRepo.getConnection.mockResolvedValue({ email_connection_id: "conn-1", status: "CONNECTED" });
  // The adapter the service reaches for when it propagates to the mail server.
  jest.spyOn(require("../../src/modules/mail/mail/mail.service"), "resolveAdapter")
    .mockResolvedValue({ markAsRead: mockMarkAsRead, moveMessage: mockMoveMessage });
});

/* ── queryFrom: the search box becomes repo filters ───────────────────────── */

describe("queryFrom", () => {
  test("an explicit query parameter beats the same operator typed in the box", () => {
    // The folder rail is a click; the box is a guess. A click wins.
    const q = service.queryFrom({ folder: "sent", q: "in:inbox demurrage" });
    expect(q.folder).toBe("SENT");
  });

  test("operators in the box become structured filters and free text becomes a tsquery", () => {
    const q = service.queryFrom({ q: "from:maersk has:attachment demurrage" });
    expect(q).toMatchObject({ from: ["maersk"], hasAttachment: true, tsquery: "demurrage:*" });
  });

  test("is:read is not the same as no filter at all", () => {
    expect(service.queryFrom({ q: "is:read" }).unread).toBe(false);
    expect(service.queryFrom({}).unread).toBeUndefined();
  });

  test("a string 'false' from the query string is a boolean false, not a truthy string", () => {
    expect(service.queryFrom({ unread: "false" }).unread).toBe(false);
    expect(service.queryFrom({ unread: "true" }).unread).toBe(true);
  });
});

/* ── per-user state ───────────────────────────────────────────────────────── */

describe("read state is per user", () => {
  test("markRead writes against the ACTOR, not the thread", async () => {
    const res = await service.markRead({}, ME, "thr-1", true);
    expect(repo.setThreadRead).toHaveBeenCalledWith({}, "user-1", "thr-1", true);
    expect(res).toMatchObject({ email_thread_id: "thr-1", messages: 2, is_read: true });
  });

  test("marking read tells the mail server so the user's phone agrees", async () => {
    await service.markRead({}, ME, "thr-1", true);
    await new Promise(setImmediate); // propagation is fire-and-forget
    expect(mockMarkAsRead).toHaveBeenCalledWith("<a>");
    expect(mockMarkAsRead).toHaveBeenCalledWith("<b>");
  });

  test("MARKING UNREAD DOES NOT TELL THE SERVER — it is a personal to-do, not a fact about the message", async () => {
    await service.markRead({}, ME, "thr-1", false);
    await new Promise(setImmediate);
    expect(repo.setThreadRead).toHaveBeenCalledWith({}, "user-1", "thr-1", false);
    expect(mockMarkAsRead).not.toHaveBeenCalled();
  });

  test("a provider failure does not undo the local read flip", async () => {
    mockMarkAsRead.mockRejectedValue(new Error("IMAP gone"));
    const res = await service.markRead({}, ME, "thr-1", true);
    expect(res.is_read).toBe(true);
    expect(repo.setThreadRead).toHaveBeenCalled();
  });

  test("a conversation the caller may not see is a 404, not an empty success", async () => {
    repo.getThread.mockResolvedValue(null);
    await expect(service.markRead({}, ME, "thr-x", true)).rejects.toMatchObject({ status: 404 });
    expect(repo.setThreadRead).not.toHaveBeenCalled();
  });

  test("star is per user too", async () => {
    const res = await service.star({}, ME, "thr-1", true);
    expect(repo.setThreadStarred).toHaveBeenCalledWith({}, "user-1", "thr-1", true);
    expect(res).toMatchObject({ is_starred: true, messages: 2 });
  });
});

/* ── moving ───────────────────────────────────────────────────────────────── */

describe("move", () => {
  test("rejects a folder that is not one of the canonical six", async () => {
    await expect(service.move({}, ME, "thr-1", "SOMEWHERE")).rejects.toMatchObject({ status: 422 });
    expect(repo.moveThread).not.toHaveBeenCalled();
  });

  test("moves every message in the conversation and mirrors it on the server", async () => {
    const res = await service.move({}, ME, "thr-1", "archive");
    expect(repo.moveThread).toHaveBeenCalledWith({}, "user-1", "thr-1", "ARCHIVE");
    await new Promise(setImmediate);
    expect(mockMoveMessage).toHaveBeenCalledWith("<a>", "Archive");
    expect(res).toMatchObject({ folder: "ARCHIVE", messages: 2 });
  });

  test("a mailbox with no such folder still moves locally, and the rail gets a row for it", async () => {
    repo.syncableFolders.mockResolvedValue([]); // server has no Archive
    const res = await service.move({}, ME, "thr-1", "ARCHIVE");
    expect(res.messages).toBe(2);
    expect(mockMoveMessage).not.toHaveBeenCalled();
    // Without this row the messages sit in a folder the rail cannot draw, which
    // to the user is indistinguishable from the mail having been deleted.
    expect(repo.ensureCanonicalFolder).toHaveBeenCalledWith({}, "conn-1", "ARCHIVE");
  });

  test("the destination row is guaranteed BEFORE the messages point at it", async () => {
    const order = [];
    repo.ensureCanonicalFolder.mockImplementation(async () => { order.push("ensure"); return {}; });
    repo.moveThread.mockImplementation(async () => { order.push("move"); return []; });
    await service.move({}, ME, "thr-1", "ARCHIVE");
    expect(order).toEqual(["ensure", "move"]);
  });

  test("checks mailbox access on top of the route's RBAC gate", async () => {
    access.assertCanRead.mockRejectedValue(Object.assign(new Error("no"), { status: 403 }));
    await expect(service.move({}, ME, "thr-1", "ARCHIVE")).rejects.toMatchObject({ status: 403 });
    expect(repo.moveThread).not.toHaveBeenCalled();
  });
});

/* ── bulk ─────────────────────────────────────────────────────────────────── */

describe("bulk", () => {
  test("requires ids", async () => {
    await expect(service.bulk({}, ME, { ids: [], op: "read" })).rejects.toMatchObject({ status: 422 });
  });

  test("caps the batch rather than letting one request move the whole mailbox", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `t${i}`);
    await expect(service.bulk({}, ME, { ids, op: "read" })).rejects.toMatchObject({ status: 422 });
  });

  test("ONE BAD ID REPORTS ITSELF INSTEAD OF FAILING THE BATCH", async () => {
    repo.getThread.mockImplementation(async (_c, _u, id) => (id === "bad" ? null : { ...THREAD, email_thread_id: id }));
    const res = await service.bulk({}, ME, { ids: ["thr-1", "bad", "thr-2"], op: "read" });
    expect(res).toMatchObject({ op: "read", succeeded: 2 });
    expect(res.failed).toEqual([{ email_thread_id: "bad", error: expect.stringMatching(/not found/i) }]);
  });

  test("an unknown op is rejected per id rather than silently doing nothing", async () => {
    const res = await service.bulk({}, ME, { ids: ["thr-1"], op: "incinerate" });
    expect(res.succeeded).toBe(0);
    expect(res.failed[0].error).toMatch(/unknown bulk op/);
  });

  test.each([
    ["read", () => expect(repo.setThreadRead).toHaveBeenCalledWith({}, "user-1", "thr-1", true)],
    ["unread", () => expect(repo.setThreadRead).toHaveBeenCalledWith({}, "user-1", "thr-1", false)],
    ["star", () => expect(repo.setThreadStarred).toHaveBeenCalledWith({}, "user-1", "thr-1", true)],
    ["unstar", () => expect(repo.setThreadStarred).toHaveBeenCalledWith({}, "user-1", "thr-1", false)],
  ])("op %s", async (op, assertion) => {
    await service.bulk({}, ME, { ids: ["thr-1"], op });
    assertion();
  });

  test("label and unlabel route through the owner-scoped repo call", async () => {
    await service.bulk({}, ME, { ids: ["thr-1"], op: "label", label_id: "lab-1" });
    expect(repo.applyLabel).toHaveBeenCalledWith({}, "user-1", "thr-1", "lab-1", true);
    await service.bulk({}, ME, { ids: ["thr-1"], op: "unlabel", label_id: "lab-1" });
    expect(repo.applyLabel).toHaveBeenCalledWith({}, "user-1", "thr-1", "lab-1", false);
  });
});

/* ── stream correction ────────────────────────────────────────────────────── */

describe("setStream", () => {
  test("records the correction as a human decision, with a reason that says so", async () => {
    await service.setStream({}, ME, "thr-1", "SYSTEM");
    expect(repo.updateThread).toHaveBeenCalledWith({}, "thr-1", expect.objectContaining({
      stream: "SYSTEM",
      stream_reason: expect.stringMatching(/by a person/i),
    }));
    expect(emitEvent).toHaveBeenCalledWith({}, expect.objectContaining({ eventTypeKey: "email.stream.corrected" }));
  });

  test("rejects anything that is not one of the two streams", async () => {
    await expect(service.setStream({}, ME, "thr-1", "MAYBE")).rejects.toMatchObject({ status: 422 });
  });

  test("a conversation that does not exist is a 404", async () => {
    repo.getThreadById.mockResolvedValue(null);
    await expect(service.setStream({}, ME, "thr-x", "SYSTEM")).rejects.toMatchObject({ status: 404 });
  });
});

/* ── labels ───────────────────────────────────────────────────────────────── */

describe("labels", () => {
  test("applying a label goes through the owner-scoped repo call", async () => {
    const res = await service.applyLabel({}, ME, "thr-1", "lab-1", true);
    expect(repo.applyLabel).toHaveBeenCalledWith({}, "user-1", "thr-1", "lab-1", true);
    expect(res).toMatchObject({ applied: true });
  });

  test("SOMEONE ELSE'S LABEL LOOKS LIKE A MISSING ONE — the response does not confirm it exists", async () => {
    repo.applyLabel.mockResolvedValue(false);
    await expect(service.applyLabel({}, ME, "thr-1", "not-mine", true)).rejects.toMatchObject({ status: 404 });
  });

  test("removing a label that was not there is not an error", async () => {
    repo.applyLabel.mockResolvedValue(false);
    await expect(service.applyLabel({}, ME, "thr-1", "lab-1", false)).resolves.toMatchObject({ applied: false });
  });

  test("a missing label_id is a validation error, not a silent no-op", async () => {
    await expect(service.applyLabel({}, ME, "thr-1", null, true)).rejects.toMatchObject({ status: 422 });
  });

  test("label CRUD is scoped to the caller", async () => {
    repo.listLabels.mockResolvedValue([]);
    repo.createLabel.mockResolvedValue({ email_label_id: "lab-2" });
    repo.deleteLabel.mockResolvedValue({ email_label_id: "lab-2" });
    await service.labels({}, ME);
    await service.createLabel({}, ME, { name: "Urgent" });
    await service.deleteLabel({}, ME, "lab-2");
    expect(repo.listLabels).toHaveBeenCalledWith({}, "user-1");
    expect(repo.createLabel).toHaveBeenCalledWith({}, "user-1", { name: "Urgent" });
    expect(repo.deleteLabel).toHaveBeenCalledWith({}, "user-1", "lab-2");
  });
});

/* ── list / get ───────────────────────────────────────────────────────────── */

describe("list and get", () => {
  test("the list is always scoped to the caller", async () => {
    await service.list({}, ME, { folder: "inbox" });
    expect(repo.listThreads).toHaveBeenCalledWith({}, "user-1", expect.objectContaining({ folder: "INBOX" }));
  });

  test("opening a conversation that is not yours is a 404, not a 403", async () => {
    // A 403 confirms the conversation exists. For mail, that is itself a leak.
    repo.getThread.mockResolvedValue(null);
    await expect(service.get({}, ME, "thr-x")).rejects.toMatchObject({ status: 404 });
  });
});
