/**
 * Mention fan-out: three channels, exactly once each (§7.10, §7.9 criterion 9).
 *
 * As merged, `notes.service.create` wrote the `mention` row and called
 * `notification.notify` — one channel of the three the guide specifies, and no
 * test asserted the other two, so the gap was invisible. Push actually came
 * free (notify fans out to it), but the chat card did not exist at all, and the
 * chat card is the half the brief described most concretely.
 *
 * The "exactly once" half matters as much as the "three": posting a chat card
 * through `smartcomm.postMessage` notifies every other member of that channel,
 * so the naive wiring delivers a mention twice from one event.
 */
"use strict";

jest.mock("../../src/modules/notification/notification.service", () => ({
  notify: jest.fn(async () => ({ notification_id: "n-1" })),
  notifyMany: jest.fn(async () => 0),
}));
jest.mock("../../src/modules/smartcomm/smartcomm.service", () => ({
  createChannel: jest.fn(async () => ({ group_id: "g-1", kind: "DIRECT" })),
  postMessage: jest.fn(async () => ({ message_id: "m-1" })),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
}));

const notify = require("../../src/modules/notification/notification.service");
const chat = require("../../src/modules/smartcomm/smartcomm.service");
const mention = require("../../src/modules/mail/binding/mention.service");
const notes = require("../../src/modules/mail/binding/notes.service");

function fakeClient(answers = []) {
  const calls = [];
  return {
    calls,
    written: (re) => calls.filter((c) => re.test(c.text)),
    query: async (text, params) => {
      calls.push({ text, params });
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  };
}

// Order matters: the context query also mentions `FROM app_user WHERE user_id`,
// so its own matcher has to come first or it is answered with a user row and
// silently loses the subject — which is how the card ends up saying "Someone".
const NOTE_ROWS = [
  { match: /INSERT INTO email_thread_note/, rows: [{ email_thread_note_id: "note-1", email_thread_id: "t-1" }] },
  { match: /AS subject/, rows: [{ subject: "Re: BL for SLAS-2026-0042", author_name: "Blake" }] },
  { match: /FROM app_user WHERE user_id/, rows: [{ user_id: "u-marie", full_name: "Marie" }] },
];

beforeEach(() => {
  notify.notify.mockClear();
  chat.createChannel.mockClear();
  chat.postMessage.mockClear();
});

describe("all three channels fire", () => {
  test("in-app, chat and push — from one note", async () => {
    const c = fakeClient(NOTE_ROWS);
    await notes.create(c, {
      threadId: "t-1", body: "can we hold the demurrage?",
      mentions: ["u-marie"], actor: { user_id: "u-blake" },
    });

    // (1) in-app — and (3) push, which notification.service delivers off the
    // same decision. Asserting on notify() is asserting on both.
    expect(notify.notify).toHaveBeenCalledTimes(1);
    const n = notify.notify.mock.calls[0][1];
    expect(n.userId).toBe("u-marie");
    expect(n.category).toBe("MENTION");
    expect(n.entityRef).toBe("email_thread:t-1");

    // (2) chat.
    expect(chat.postMessage).toHaveBeenCalledTimes(1);
    const card = chat.postMessage.mock.calls[0][1];
    expect(card.groupId).toBe("g-1");
    expect(card.body).toContain("Blake mentioned you");
    expect(card.body).toContain("Re: BL for SLAS-2026-0042");
    expect(card.body).toContain("can we hold the demurrage?");
    expect(card.body).toContain("/comms/mail?thread=t-1&tab=notes");
  });

  test("the mention row is written before anyone is told", async () => {
    const c = fakeClient(NOTE_ROWS);
    await notes.create(c, { threadId: "t-1", body: "x", mentions: ["u-marie"], actor: { user_id: "u-blake" } });
    const ins = c.written(/INSERT INTO mention/)[0];
    expect(ins).toBeDefined();
    expect(ins.params[0]).toBe("email_thread_note:note-1");
    expect(ins.params[1]).toBe("email_thread:t-1");
  });

  test("the DM is reused, not re-created — createChannel dedupes DIRECT", async () => {
    const c = fakeClient(NOTE_ROWS);
    await notes.create(c, { threadId: "t-1", body: "x", mentions: ["u-marie"], actor: { user_id: "u-blake" } });
    const arg = chat.createChannel.mock.calls[0][1];
    expect(arg.data.kind).toBe("DIRECT");
    expect(arg.data.member_ids).toEqual(["u-marie"]);
    expect(arg.actor.user_id).toBe("u-blake");
  });
});

describe("exactly once", () => {
  test("the chat card suppresses its own notification", async () => {
    const c = fakeClient(NOTE_ROWS);
    await notes.create(c, { threadId: "t-1", body: "x", mentions: ["u-marie"], actor: { user_id: "u-blake" } });
    // Without this, Marie is told twice about one note: once as a mention, once
    // as "new message in Smart Comms" (§7.4 addition f).
    expect(chat.postMessage.mock.calls[0][1].notifyMembers).toBe(false);
    expect(notify.notify).toHaveBeenCalledTimes(1);
  });

  test("mentioning the same person twice in one note notifies once", async () => {
    const c = fakeClient(NOTE_ROWS);
    await notes.create(c, {
      threadId: "t-1", body: "x", mentions: ["u-marie", "u-marie"], actor: { user_id: "u-blake" },
    });
    expect(notify.notify).toHaveBeenCalledTimes(1);
    expect(chat.postMessage).toHaveBeenCalledTimes(1);
  });

  test("the dedupe key names the NOTE, so a second note reaches you again", async () => {
    const c = fakeClient(NOTE_ROWS);
    await notes.create(c, { threadId: "t-1", body: "x", mentions: ["u-marie"], actor: { user_id: "u-blake" } });
    expect(notify.notify.mock.calls[0][1].dedupeKey).toBe("MENTION:email_thread_note:note-1:u-marie");
    // Keyed on the thread instead, being mentioned twice in a minute would show
    // up once — which is a mention silently lost, not noise saved.
    expect(notify.notify.mock.calls[0][1].dedupeKey).not.toBe("MENTION:email_thread:t-1:u-marie");
  });

  test("the context lookup runs once for a note that names four people", async () => {
    const c = fakeClient([
      NOTE_ROWS[0],
      NOTE_ROWS[1],
      { match: /FROM app_user WHERE user_id/, rows: [{ user_id: "u-x", full_name: "X" }] },
    ]);
    await notes.create(c, {
      threadId: "t-1", body: "x", mentions: ["a", "b", "c", "d"], actor: { user_id: "u-blake" },
    });
    expect(c.written(/AS subject/)).toHaveLength(1);
    expect(notify.notify).toHaveBeenCalledTimes(4);
  });
});

describe("an employee with no user account", () => {
  test("is refused, with a reason — never silently skipped", async () => {
    const c = fakeClient([
      NOTE_ROWS[0],
      NOTE_ROWS[1],
      { match: /FROM app_user WHERE user_id/, rows: [] },
    ]);
    await expect(
      notes.create(c, { threadId: "t-1", body: "x", mentions: ["u-ghost"], actor: { user_id: "u-blake" } }),
    ).rejects.toMatchObject({ code: "NO_USER_ACCOUNT", status: 422 });
    expect(notify.notify).not.toHaveBeenCalled();
    expect(chat.postMessage).not.toHaveBeenCalled();
  });
});

describe("chat is best-effort, the mention is not", () => {
  test("a chat failure still leaves the mention delivered", async () => {
    chat.createChannel.mockRejectedValueOnce(new Error("comms off"));
    const c = fakeClient(NOTE_ROWS);
    const out = await mention.fanOut(c, {
      noteId: "note-1", threadId: "t-1", subject: "S", excerpt: "e",
      author: { user_id: "u-blake", full_name: "Blake" },
      target: { user_id: "u-marie", full_name: "Marie" },
    });
    expect(out).toEqual({ userId: "u-marie", inApp: true, chat: false });
    expect(notify.notify).toHaveBeenCalledTimes(1);
  });
});

describe("the card reads like a sentence", () => {
  test.each([
    [{ authorName: "Blake", subject: "Re: BL", excerpt: "hold it?" }, 'Blake mentioned you on «Re: BL» — “hold it?”'],
    [{ authorName: "Blake", subject: null, excerpt: null }, "Blake mentioned you on a mail thread"],
    [{ authorName: null, subject: "S", excerpt: null }, "Someone mentioned you on «S»"],
  ])("%j", (input, expected) => {
    expect(mention.cardText(input)).toBe(expected);
  });
});
