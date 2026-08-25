/**
 * The send queue. Hermetic — the repo, the mailbox limits, the access checks and
 * the provider adapter are all mocked, so what is under test is the state
 * machine's own decisions.
 *
 * Four of those decisions carry the design and each has a test that fails loudly
 * if it is reversed:
 *
 *   1. SENDING NEVER TALKS TO SMTP INLINE. `send()` writes a row and returns.
 *   2. THE PAYLOAD IS FROZEN AT ENQUEUE. What leaves is what the sender read and
 *      approved, not what the draft said a few seconds later.
 *   3. UNDO IS DECIDED BY THE DATABASE. A cancel that loses the race gets a 409,
 *      not a false confirmation.
 *   4. A PERMANENT FAILURE IS NOT RETRIED. Trying a rejected sender three times
 *      only delays telling someone something they have to fix.
 */
"use strict";

jest.mock("../../src/modules/mail/mail/outbox.repo");
jest.mock("../../src/modules/mail/mail/mail.repo");
jest.mock("../../src/modules/mail/mail/thread.repo");
jest.mock("../../src/modules/mail/mail/mailbox.service", () => ({
  checkSendAllowance: jest.fn(async () => ({ allowed: true })),
  recordSent: jest.fn(async () => ({})),
}));
jest.mock("../../src/modules/mail/mail/access", () => ({
  assertCanSend: jest.fn(async () => true),
  recordSentAs: jest.fn(async () => ({})),
}));
jest.mock("../../src/shared/config/settings", () => ({ getSetting: jest.fn(async () => ({})) }));
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (c, id) => id || null,
  emitEvent: jest.fn(async () => ({})),
}));
jest.mock("sanitize-html", () => {
  const fn = (h) => String(h);
  fn.defaults = { allowedTags: [], allowedAttributes: {} };
  return fn;
});

const repo = require("../../src/modules/mail/mail/outbox.repo");
const mailRepo = require("../../src/modules/mail/mail/mail.repo");
const mailbox = require("../../src/modules/mail/mail/mailbox.service");
const access = require("../../src/modules/mail/mail/access");
const { getSetting } = require("../../src/shared/config/settings");
const { emitEvent } = require("../../src/shared/events/emit");
const outbox = require("../../src/modules/mail/mail/outbox.service");

const ME = { user_id: "user-1" };
const CONN = {
  email_connection_id: "conn-1",
  email_address: "billing@co.cm",
  kind: "SHARED",
  status: "CONNECTED",
};
const DOC = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] };
const BASE = { connectionId: "conn-1", to: ["client@acme.cm"], subject: "Hi", body_json: DOC };

const mockSendEmail = jest.fn(async () => ({ externalMessageId: "<sent-1>" }));
const deps = () => ({
  resolveAdapter: jest.fn(async () => ({ sendEmail: mockSendEmail })),
  recordOutbound: jest.fn(async () => ({ email_message_id: "msg-1" })),
  explainSendError: (e) => e,
});

const queued = (over = {}) => ({
  email_send_queue_id: "q-1",
  email_connection_id: "conn-1",
  user_id: "user-1",
  email_draft_id: null,
  attempts: 1,
  payload: { to: ["client@acme.cm"], subject: "Hi", html: "<p>hello</p>", text: "hello", messageId: "<mid>", headers: {} },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mailRepo.getConnection.mockResolvedValue(CONN);
  mailbox.checkSendAllowance.mockResolvedValue({ allowed: true });
  access.assertCanSend.mockResolvedValue(true);
  getSetting.mockResolvedValue({});
  repo.enqueue.mockImplementation(async (_c, q) => ({
    email_send_queue_id: "q-1", status: "HELD", release_at: q.release_at, ...q,
  }));
  repo.listDraftAttachments.mockResolvedValue([]);
  repo.draftAttachmentBytes.mockResolvedValue(0);
  repo.requeueStalled.mockResolvedValue([]);
  repo.claimDue.mockResolvedValue([]);
  repo.markSent.mockResolvedValue({});
  repo.markAttemptFailed.mockResolvedValue({});
  repo.attachToMessage.mockResolvedValue(1);
  repo.deleteDraft.mockResolvedValue({});
  mockSendEmail.mockResolvedValue({ externalMessageId: "<sent-1>" });
});

/* ── Enqueue ──────────────────────────────────────────────────────────────── */

describe("send() queues rather than sending", () => {
  test("NO SMTP CONNECTION IS OPENED — the request returns before anything leaves", async () => {
    const res = await outbox.send({}, ME, BASE);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(repo.enqueue).toHaveBeenCalled();
    expect(res).toMatchObject({ email_send_queue_id: "q-1", status: "HELD", undo_seconds: 20 });
  });

  test("the response says when the message will actually go", async () => {
    const before = Date.now();
    const res = await outbox.send({}, ME, BASE);
    const delta = new Date(res.release_at).getTime() - before;
    expect(delta).toBeGreaterThan(19000);
    expect(delta).toBeLessThan(21000);
  });

  test("THE PAYLOAD IS FROZEN AT ENQUEUE", async () => {
    // Re-deriving from the draft at flush time would mean an edit in another
    // tab, or a signature that changed in between, silently alters a message
    // somebody already read and approved.
    await outbox.send({}, ME, BASE);
    const p = repo.enqueue.mock.calls[0][1].payload;
    expect(p).toMatchObject({ to: ["client@acme.cm"], subject: "Hi" });
    expect(p.html).toMatch(/hello/);
    expect(p.text).toBe("hello");
    expect(p.messageId).toMatch(/^<.+>$/);   // our own Message-ID, stamped now
    expect(p.headers).toEqual(expect.objectContaining({}));
  });

  test("the body is serialized by the SERVER, not taken from the caller", async () => {
    await outbox.send({}, ME, { ...BASE, html: "<p>caller's version</p>" });
    // The document wins: a caller-supplied HTML string has not been through the
    // serializer, and the serializer is what makes mail survive Outlook.
    expect(repo.enqueue.mock.calls[0][1].payload.html).not.toMatch(/caller's version/);
    expect(repo.enqueue.mock.calls[0][1].payload.html).toMatch(/hello/);
  });

  test("a caller with no document may still supply parts directly", async () => {
    await outbox.send({}, ME, { connectionId: "conn-1", to: ["x@y.cm"], text: "plain" });
    expect(repo.enqueue.mock.calls[0][1].payload.text).toBe("plain");
  });

  test.each([
    [{ to: [] }, /recipient/i],
    [{ connectionId: undefined }, /mailbox/i],
    [{ body_json: undefined, html: undefined, text: undefined }, /body/i],
  ])("refuses an incomplete message: %p", async (patch, message) => {
    await expect(outbox.send({}, ME, { ...BASE, ...patch }))
      .rejects.toMatchObject({ status: 422, message: expect.stringMatching(message) });
    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  describe("the body must be real content, not a wrapper", () => {
    const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

    test("an EMPTY document is refused — the serialized shell is not a body", async () => {
      // serialize() wraps ANY document in a full HTML shell, so `html` is
      // truthy with nothing visible in it. The old truthiness check enqueued
      // that shell, the provider dropped the empty text part, and the
      // recipient got a subject with nothing under it — "sent, subject and
      // all, but no content" (2026-08-25, cPanel mailbox, new inbox
      // composer: canSend checked sender + recipient but not the body).
      await expect(outbox.send({}, ME, { ...BASE, body_json: EMPTY_DOC }))
        .rejects.toMatchObject({ status: 422, message: expect.stringMatching(/body/i) });
      expect(repo.enqueue).not.toHaveBeenCalled();
    });

    test("whitespace-only text is refused the same way", async () => {
      await expect(outbox.send({}, ME, {
        connectionId: "conn-1", to: ["x@y.cm"], text: "   \n\t  ",
      })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/body/i) });
      expect(repo.enqueue).not.toHaveBeenCalled();
    });

    test("a reply that only carries the quote still says something", async () => {
      // The quoted history is content the recipient will read — a reply that
      // adds no new words must not be refused just because the editor is
      // empty.
      await outbox.send({}, ME, {
        ...BASE, body_json: EMPTY_DOC,
        quoted_html: "<p>the original</p>", quoted_text: "the original",
      });
      const p = repo.enqueue.mock.calls[0][1].payload;
      expect(p.text).toMatch(/the original/);
    });

    test("an image-only body is not empty", async () => {
      const IMG_DOC = {
        type: "doc",
        content: [
          { type: "paragraph" },
          { type: "image", attrs: { src: "cid:att-1", alt: "invoice" } },
        ],
      };
      await outbox.send({}, ME, { ...BASE, body_json: IMG_DOC });
      const p = repo.enqueue.mock.calls[0][1].payload;
      expect(p.html).toMatch(/<img/);
      expect(p.text).toMatch(/\[image: invoice\]/);
    });
  });

  test("an archived mailbox cannot send", async () => {
    mailRepo.getConnection.mockResolvedValue({ ...CONN, status: "ARCHIVED" });
    await expect(outbox.send({}, ME, BASE)).rejects.toMatchObject({ code: "MAILBOX_ARCHIVED" });
  });

  test("access to the shared mailbox is checked before anything is written", async () => {
    access.assertCanSend.mockRejectedValue(Object.assign(new Error("no"), { status: 403 }));
    await expect(outbox.send({}, ME, BASE)).rejects.toMatchObject({ status: 403 });
    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  test("THE THROTTLE IS REPORTED AT ENQUEUE, not discovered twenty minutes later", async () => {
    mailbox.checkSendAllowance.mockResolvedValue({
      allowed: false, reason: "HOURLY_LIMIT", limit: 50, retryAt: new Date(Date.now() + 3600000).toISOString(),
    });
    await expect(outbox.send({}, ME, BASE)).rejects.toMatchObject({ code: "SEND_RATE_LIMIT", status: 429 });
    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  test("the serializer's warnings reach the caller", async () => {
    const huge = { type: "doc", content: Array.from({ length: 900 }, () => ({
      type: "paragraph", content: [{ type: "text", text: "x".repeat(120) }],
    })) };
    const res = await outbox.send({}, ME, { ...BASE, body_json: huge });
    expect(res.warnings.join(" ")).toMatch(/clips/i);
  });

  test("an idempotency key rides along so an offline replay enqueues once", async () => {
    await outbox.send({}, ME, { ...BASE, idempotency_key: "abc-123" });
    expect(repo.enqueue.mock.calls[0][1].idempotency_key).toBe("abc-123");
  });
});

/* ── The undo window ──────────────────────────────────────────────────────── */

describe("the undo window", () => {
  test.each([0, 10, 20, 30])("%ss is offered", async (n) => {
    getSetting.mockResolvedValue({ undo_send_seconds: n });
    expect(await outbox.undoSeconds({})).toBe(n);
  });

  test("ZERO IS A REAL ANSWER — someone who never wants it should not wait every time", async () => {
    getSetting.mockResolvedValue({ undo_send_seconds: 0 });
    const res = await outbox.send({}, ME, BASE);
    expect(res.undo_seconds).toBe(0);
    expect(new Date(res.release_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test.each([200, -5, "soon", 15])("%p is refused and falls back, rather than being clamped", async (bad) => {
    // A typo that produced a 200-second hold would look exactly like sending
    // being broken, and the user would have no way to tell the difference.
    getSetting.mockResolvedValue({ undo_send_seconds: bad });
    expect(await outbox.undoSeconds({})).toBe(20);
  });

  test("a per-send override is honoured only for an offered value", async () => {
    expect((await outbox.send({}, ME, { ...BASE, undo_seconds: 10 })).undo_seconds).toBe(10);
    expect((await outbox.send({}, ME, { ...BASE, undo_seconds: 999 })).undo_seconds).toBe(20);
  });
});

/* ── Cancel: the race ─────────────────────────────────────────────────────── */

describe("cancel", () => {
  test("succeeds while the row is still HELD", async () => {
    repo.cancel.mockResolvedValue(queued({ status: "CANCELLED" }));
    expect(await outbox.cancel({}, ME, "q-1")).toMatchObject({ status: "CANCELLED" });
    expect(emitEvent).toHaveBeenCalledWith({}, expect.objectContaining({ eventTypeKey: "email.send.cancelled" }));
  });

  test("THE DATABASE DECIDES THE RACE — a cancel that loses is told the truth", async () => {
    // The UPDATE matched nothing because the flusher already flipped the row to
    // SENDING. There is no window in which both sides believe they won.
    repo.cancel.mockResolvedValue(null);
    repo.getQueued.mockResolvedValue(queued({ status: "SENT" }));
    await expect(outbox.cancel({}, ME, "q-1")).rejects.toMatchObject({
      code: "ALREADY_SENT", status: 409, message: expect.stringMatching(/already left/),
    });
  });

  test("cancelling twice says so rather than pretending it worked", async () => {
    repo.cancel.mockResolvedValue(null);
    repo.getQueued.mockResolvedValue(queued({ status: "CANCELLED" }));
    await expect(outbox.cancel({}, ME, "q-1")).rejects.toMatchObject({
      message: expect.stringMatching(/already cancelled/),
    });
  });

  test("an id that is not the caller's is a 404, not someone else's message", async () => {
    repo.cancel.mockResolvedValue(null);
    repo.getQueued.mockResolvedValue(null);
    await expect(outbox.cancel({}, ME, "q-x")).rejects.toMatchObject({ status: 404 });
  });

  test("the cancel query is scoped to the caller", async () => {
    repo.cancel.mockResolvedValue(queued({ status: "CANCELLED" }));
    await outbox.cancel({}, ME, "q-1");
    expect(repo.cancel).toHaveBeenCalledWith({}, "user-1", "q-1");
  });
});

/* ── The flusher ──────────────────────────────────────────────────────────── */

describe("flushing", () => {
  test("sends a claimed row and records the outbound message", async () => {
    const d = deps();
    const res = await outbox.flushOne({}, queued(), d);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ["client@acme.cm"], subject: "Hi" }));
    expect(d.recordOutbound).toHaveBeenCalled();
    expect(repo.markSent).toHaveBeenCalledWith({}, "q-1", "msg-1");
    expect(res).toMatchObject({ status: "SENT", message_id: "msg-1" });
  });

  test("the send counter and the shared-mailbox audit both run", async () => {
    await outbox.flushOne({}, queued(), deps());
    expect(mailbox.recordSent).toHaveBeenCalledWith({}, "conn-1", 1);
    expect(access.recordSentAs).toHaveBeenCalled(); // CONN.kind is SHARED
  });

  test("a personal mailbox writes no sent-as row", async () => {
    mailRepo.getConnection.mockResolvedValue({ ...CONN, kind: "PERSONAL" });
    await outbox.flushOne({}, queued(), deps());
    expect(access.recordSentAs).not.toHaveBeenCalled();
  });

  test("THE THROTTLE IS RE-CHECKED AT FLUSH", async () => {
    // A burst can be individually under the cap and collectively over it, and
    // only the flusher can see that. Held for later rather than failed.
    mailbox.checkSendAllowance.mockResolvedValue({
      allowed: false, reason: "HOURLY_LIMIT", limit: 50, retryAt: new Date(Date.now() + 600000).toISOString(),
    });
    const res = await outbox.flushOne({}, queued(), deps());
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: "QUEUED", throttled: true });
    expect(repo.markAttemptFailed).toHaveBeenCalledWith({}, "q-1", expect.objectContaining({
      code: "SEND_RATE_LIMIT", retryAt: expect.any(Date),
    }));
  });

  test("attachments move to the message BEFORE the draft is discarded", async () => {
    // A discarded draft cascades its attachments away, so the other order would
    // take the files with it.
    const order = [];
    repo.attachToMessage.mockImplementation(async () => { order.push("attach"); return 1; });
    repo.deleteDraft.mockImplementation(async () => { order.push("delete"); return {}; });
    await outbox.flushOne({}, queued({ email_draft_id: "d-1" }), deps());
    expect(order).toEqual(["attach", "delete"]);
  });

  test("one bad message never stops the rest", async () => {
    repo.claimDue.mockResolvedValue([queued({ email_send_queue_id: "q-1" }), queued({ email_send_queue_id: "q-2" })]);
    mockSendEmail.mockRejectedValueOnce(new Error("greylisted"));
    const res = await outbox.flush({}, deps());
    expect(res.claimed).toBe(2);
    expect(res.results.map((r) => r.status)).toEqual(["QUEUED", "SENT"]);
  });

  test("stalled rows are requeued before anything is claimed", async () => {
    // A worker killed between claiming a row and recording its outcome leaves it
    // in SENDING forever: nothing else will claim it.
    await outbox.flush({}, deps());
    expect(repo.requeueStalled).toHaveBeenCalled();
    expect(repo.requeueStalled.mock.invocationCallOrder[0])
      .toBeLessThan(repo.claimDue.mock.invocationCallOrder[0]);
  });
});

/* ── Retry policy ─────────────────────────────────────────────────────────── */

describe("what is retried and what is not", () => {
  test("a transient failure backs off and comes back", () => {
    expect(outbox.retryPlan(new Error("greylisted"), 1).retryAt).toBeInstanceOf(Date);
  });

  test("the backoff lengthens rather than hammering the mail host", () => {
    const at = (n) => outbox.retryPlan(new Error("x"), n).retryAt.getTime() - Date.now();
    expect(at(0)).toBeLessThan(at(1));
    expect(at(1)).toBeLessThan(at(2));
  });

  test.each([
    ["SENDER_NOT_AUTHORIZED", 422],
    ["RECIPIENT_REJECTED", 422],
    ["AUTH_FAILED", 401],
    ["MAILBOX_ARCHIVED", 422],
  ])("A PERMANENT REFUSAL (%s) IS NOT RETRIED", (code, status) => {
    // Trying a rejected sender three times does not make it work; it delays
    // telling the person something only they can fix, and burns three more
    // entries in the mail host's abuse log.
    expect(outbox.retryPlan(Object.assign(new Error("no"), { code, status }), 0).retryAt).toBeNull();
  });

  test("retries stop after the third attempt", () => {
    expect(outbox.retryPlan(new Error("x"), outbox.MAX_ATTEMPTS).retryAt).toBeNull();
  });

  test("A FINAL FAILURE REACHES THE SENDER — by then nobody is watching the composer", async () => {
    const d = deps();
    mockSendEmail.mockRejectedValue(Object.assign(new Error("550 Sender verify failed"), {
      code: "SENDER_NOT_AUTHORIZED", status: 422,
    }));
    const res = await outbox.flushOne({}, queued(), d);
    expect(res.status).toBe("FAILED");
    expect(emitEvent).toHaveBeenCalledWith({}, expect.objectContaining({
      eventTypeKey: "email.send.failed",
      payload: expect.objectContaining({ error: expect.stringMatching(/Sender verify failed/) }),
    }));
  });

  test("a retryable failure does NOT notify — it has not failed yet", async () => {
    mockSendEmail.mockRejectedValue(new Error("451 temporary"));
    await outbox.flushOne({}, queued({ attempts: 1 }), deps());
    const kinds = emitEvent.mock.calls.map((c) => c[1].eventTypeKey);
    expect(kinds).not.toContain("email.send.failed");
  });
});

/* ── Drafts ───────────────────────────────────────────────────────────────── */

describe("drafts", () => {
  beforeEach(() => {
    repo.upsertDraft.mockResolvedValue({ email_draft_id: "d-1", user_id: "user-1" });
  });

  test("autosave serializes, so the stored HTML can never lag the JSON", async () => {
    await outbox.saveDraft({}, ME, { body_json: DOC });
    const saved = repo.upsertDraft.mock.calls[0][2];
    expect(saved.body_html).toMatch(/hello/);
    expect(saved.body_text).toBe("hello");
  });

  test("warnings come back while there is still time to act on them", async () => {
    const res = await outbox.saveDraft({}, ME, {
      body_json: { type: "doc", content: [{ type: "image", attrs: { src: "cid:a" } }] },
    });
    expect(res.warnings.join(" ")).toMatch(/no description/i);
  });

  test("A PARTIAL AUTOSAVE PASSES ONLY WHAT CHANGED — the repo must not fill in the rest", async () => {
    // The composer autosaves the field that changed. An UPDATE that wrote every
    // column would clear the recipients each time someone edited the subject,
    // and the failure is invisible until a message is addressed to nobody. The
    // repo builds its SET clause from the keys present, so the service must not
    // helpfully default the absent ones back in.
    await outbox.saveDraft({}, ME, { email_draft_id: "d-1", subject: "Only this" });
    const saved = repo.upsertDraft.mock.calls[0][2];
    expect(saved.subject).toBe("Only this");
    expect(saved.to_address).toBeUndefined();
    expect(saved.email_connection_id).toBeUndefined();
  });

  test("a body-less save leaves body_html alone rather than nulling it", async () => {
    // Same rule: `null` would be read as "clear it", and a keystroke on the
    // subject line would erase the message underneath.
    await outbox.saveDraft({}, ME, { email_draft_id: "d-1", subject: "s" });
    expect(repo.upsertDraft.mock.calls[0][2].body_html).toBeUndefined();
  });

  test("but an explicit null body IS passed through — the composer may clear it", async () => {
    await outbox.saveDraft({}, ME, { email_draft_id: "d-1", body_json: null });
    expect(repo.upsertDraft.mock.calls[0][2]).toHaveProperty("body_html", null);
  });

  test("a draft with no body saves anyway — a subject line typed first is a draft", async () => {
    const res = await outbox.saveDraft({}, ME, { subject: "Just the subject" });
    expect(repo.upsertDraft).toHaveBeenCalledWith({}, "user-1", expect.objectContaining({ subject: "Just the subject" }));
    expect(res).toMatchObject({ email_draft_id: "d-1" });
  });

  test("an anonymous caller cannot own a draft", async () => {
    await expect(outbox.saveDraft({}, {}, { subject: "x" })).rejects.toMatchObject({ status: 422 });
  });

  test.each(["getDraft", "listDrafts", "discardDraft"])("%s is scoped to the caller", async (fn) => {
    repo.getDraft.mockResolvedValue({ email_draft_id: "d-1" });
    repo.listDrafts.mockResolvedValue([]);
    repo.deleteDraft.mockResolvedValue({ email_draft_id: "d-1" });
    await outbox[fn]({}, ME, "d-1");
    const spy = { getDraft: repo.getDraft, listDrafts: repo.listDrafts, discardDraft: repo.deleteDraft }[fn];
    expect(spy).toHaveBeenCalledWith({}, "user-1", expect.anything());
  });

  test("discarding a draft that is not yours is a 404", async () => {
    repo.deleteDraft.mockResolvedValue(null);
    await expect(outbox.discardDraft({}, ME, "d-x")).rejects.toMatchObject({ status: 404 });
  });
});

/* ── Attachment size ──────────────────────────────────────────────────────── */

describe("the 25 MB rule", () => {
  test("is on the SUM, not per file — five 6 MB files each pass a per-file check", async () => {
    repo.draftAttachmentBytes.mockResolvedValue(24 * 1024 * 1024);
    await expect(outbox.assertRoomFor({}, "d-1", 2 * 1024 * 1024))
      .rejects.toMatchObject({ code: "ATTACHMENT_TOO_LARGE", status: 413 });
  });

  test("the refusal says how much is already attached", async () => {
    repo.draftAttachmentBytes.mockResolvedValue(24 * 1024 * 1024);
    await expect(outbox.assertRoomFor({}, "d-1", 5 * 1024 * 1024))
      .rejects.toMatchObject({ message: expect.stringMatching(/24\.0 MB is already attached/) });
  });

  test("past 10 MB the secure link is offered instead", async () => {
    repo.draftAttachmentBytes.mockResolvedValue(9 * 1024 * 1024);
    const r = await outbox.assertRoomFor({}, "d-1", 2 * 1024 * 1024);
    expect(r.offer_secure_link).toBe(true);
  });

  test("a small attachment passes and offers nothing", async () => {
    const r = await outbox.assertRoomFor({}, "d-1", 1024);
    expect(r.offer_secure_link).toBe(false);
  });
});
