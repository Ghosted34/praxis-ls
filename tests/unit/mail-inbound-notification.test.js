"use strict";
/**
 * Inbound mail raises a notification for the people who work the mailbox.
 *
 * ── THE BUG THIS FILE PINS ──────────────────────────────────────────────────
 *
 * It raised NOTHING. `syncConnection` emitted `email.thread.created` /
 * `email.thread.replied`, and the allowlist in shared/notifications/
 * notify-events.js has no `email.*` key — so no in-app row, no email and no
 * push, for every inbound message that was not an @-mention. A user whose phone
 * was in their pocket with the app closed learned about an urgent mail the next
 * time they happened to open the app.
 *
 * The four things asserted below are the four ways the naive fix would have
 * been wrong: notifying on outbound mail, notifying the whole module instead of
 * the mailbox, quoting the message when the tenant asked us not to, and
 * dropping automated mail into somebody's night.
 */

// `mock`-prefixed so jest's out-of-scope-variable guard allows the factory
// to close over it.
const mockNotifyMany = jest.fn(async () => 2);
jest.mock("../../src/modules/notification/notification.service", () => ({
  notifyMany: (...a) => mockNotifyMany(...a),
}));

const mailNotify = require("../../src/modules/mail/mail/mail-notify.service");

/**
 * A tenant client that answers the three reads onInboundMessage makes: the
 * thread row, the recipient set, and the preview setting.
 */
function makeClient({ thread = {}, recipients = ["u-1", "u-2"], preview = null } = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (/FROM email_thread\b/.test(sql)) {
        return {
          rows: [{
            email_thread_id: "t-1", subject: "Re: BL 4471", assigned_user_id: null,
            is_vip: false, stream: "HUMAN", ...thread,
          }],
        };
      }
      if (/FROM app_user/.test(sql)) return { rows: recipients.map((user_id) => ({ user_id })) };
      if (/setting/i.test(sql)) return { rows: preview ? [{ value: preview }] : [] };
      return { rows: [] };
    }),
  };
}

const conn = {
  email_connection_id: "c-1",
  owner_user_id: "u-1",
  kind: "SHARED",
  email_address: "billing@praxisls.com",
};
const row = { email_message_id: "m-1", thread_id: "t-1", is_new_thread: false };
const message = {
  direction: "IN",
  from: "Ama Boateng <ama@client.cm>",
  subject: "Re: BL 4471 demurrage",
  bodyText: "Please confirm the free days before Friday.\n\n> On Monday you wrote:\n> the original",
};

beforeEach(() => mockNotifyMany.mockClear());

describe("an inbound message notifies the mailbox", () => {
  test("recipients come from the MAILBOX, and the push is a deep link to the thread", async () => {
    const client = makeClient();
    const out = await mailNotify.onInboundMessage(client, { conn, message, row });

    expect(out.notified).toBe(2);
    expect(mockNotifyMany).toHaveBeenCalledTimes(1);
    const [, userIds, opts] = mockNotifyMany.mock.calls[0];
    expect(userIds).toEqual(["u-1", "u-2"]);
    expect(opts.category).toBe("comms");
    // Not /notifications. A mail alert that lands on the notifications list has
    // made the reader find the message a second time.
    expect(opts.url).toBe("/comms/mail?thread=t-1");
    // Collapse per thread, NOT per user (which is what `tag: userId` did, and
    // it destroyed every notification but the last).
    expect(opts.pushTag).toBe("mail:t-1");
    expect(opts.renotify).toBe(true);
    expect(opts.urgency).toBe("high");
    expect(opts.emailFallback).toBe(true);
    expect(opts.entityRef).toBe("email_thread:t-1");
  });

  test("the recipient query asks for owner, live members, assignee and shares", async () => {
    const client = makeClient({ thread: { assigned_user_id: "u-9" } });
    await mailNotify.onInboundMessage(client, { conn, message, row });

    const call = client.query.mock.calls.find(([sql]) => /FROM app_user/.test(sql));
    expect(call).toBeTruthy();
    const [sql, params] = call;
    expect(sql).toMatch(/email_connection_member/);
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(sql).toMatch(/email_thread_share/);
    expect(sql).toMatch(/status = 'ACTIVE'/);
    expect(params).toEqual(["c-1", "u-1", "t-1", "u-9"]);
  });

  test("OUTBOUND mail notifies nobody — we sent it", async () => {
    const client = makeClient();
    const out = await mailNotify.onInboundMessage(client, {
      conn, row, message: { ...message, direction: "OUT" },
    });
    expect(out).toEqual({ notified: 0, skipped: "outbound" });
    expect(mockNotifyMany).not.toHaveBeenCalled();
  });

  test("the SYSTEM stream does not wake a phone", async () => {
    const client = makeClient({ thread: { stream: "SYSTEM" } });
    const out = await mailNotify.onInboundMessage(client, { conn, message, row });
    expect(out).toEqual({ notified: 0, skipped: "system stream" });
    expect(mockNotifyMany).not.toHaveBeenCalled();
  });

  test("the FIRST SYNC of a mailbox notifies nobody — it is a 90-day backfill", async () => {
    // Without this a newly connected mailbox fires hundreds of pushes at once,
    // for mail that is weeks old and already dealt with. The only thing anyone
    // does about that is turn notifications off, permanently.
    const client = makeClient();
    const out = await mailNotify.onInboundMessage(client, {
      conn, message, row, isFirstSync: true,
    });
    expect(out).toEqual({ notified: 0, skipped: "first sync" });
    expect(mockNotifyMany).not.toHaveBeenCalled();
  });

  test("the preview setting is read once per sync run, not once per message", async () => {
    // A backfill ingests hundreds of messages through this function; a settings
    // query for each is a query per message for an answer that cannot change
    // mid-run. Memoised on the run's own ctx, never at module scope — that
    // would share one tenant's privacy setting with every other tenant in the
    // process.
    const client = makeClient();
    const ctx = {};
    await mailNotify.onInboundMessage(client, { conn, message, row, ctx });
    await mailNotify.onInboundMessage(client, { conn, message, row, ctx });
    await mailNotify.onInboundMessage(client, { conn, message, row, ctx });

    const settingReads = client.query.mock.calls.filter(([sql]) => /setting/i.test(sql));
    expect(settingReads).toHaveLength(1);
    expect(mockNotifyMany).toHaveBeenCalledTimes(3);
  });

  test("nobody to tell → no notification, no throw", async () => {
    const client = makeClient({ recipients: [] });
    const out = await mailNotify.onInboundMessage(client, { conn, message, row });
    expect(out).toEqual({ notified: 0, skipped: "no recipients" });
    expect(mockNotifyMany).not.toHaveBeenCalled();
  });

  test("a VIP thread is HIGH priority", async () => {
    const client = makeClient({ thread: { is_vip: true } });
    await mailNotify.onInboundMessage(client, { conn, message, row });
    expect(mockNotifyMany.mock.calls[0][2].priority).toBe("HIGH");
  });

  test("best-effort: a database failure never escapes into the sync loop", async () => {
    const client = { query: jest.fn(async () => { throw new Error("connection reset"); }) };
    await expect(
      mailNotify.onInboundMessage(client, { conn, message, row }),
    ).resolves.toEqual({ notified: 0, skipped: "error" });
  });
});

describe("the preview a phone shows", () => {
  test("sender headlines it; subject and snippet are the body", async () => {
    const client = makeClient();
    await mailNotify.onInboundMessage(client, { conn, message, row });
    const opts = mockNotifyMany.mock.calls[0][2];
    // Shared mailbox → the title says which hat to put on.
    expect(opts.title).toBe("Ama Boateng → billing@praxisls.com");
    expect(opts.body).toBe("Re: BL 4471 demurrage — Please confirm the free days before Friday.");
    // The quoted history is what the reader has ALREADY seen; a snippet made of
    // it says "> On Monday you wrote" and nothing about why the phone buzzed.
    expect(opts.body).not.toMatch(/On Monday you wrote/);
  });

  test("a personal mailbox is not labelled — there is only one hat", async () => {
    const client = makeClient();
    await mailNotify.onInboundMessage(client, {
      conn: { ...conn, kind: "PERSONAL" }, message, row,
    });
    expect(mockNotifyMany.mock.calls[0][2].title).toBe("Ama Boateng");
  });

  test("compose() honours MINIMAL — sender and subject, no body", () => {
    const { title, body } = mailNotify.compose({
      from: "Ama Boateng <ama@client.cm>",
      subject: "Re: BL 4471 demurrage",
      bodyText: "Commercially sensitive numbers.",
      mode: "MINIMAL",
    });
    expect(title).toBe("Ama Boateng");
    expect(body).toBe("Re: BL 4471 demurrage");
    expect(body).not.toMatch(/sensitive/);
  });

  test.each([
    ['"Ama Boateng" <ama@client.cm>', "Ama Boateng"],
    ["Ama Boateng <ama@client.cm>", "Ama Boateng"],
    ["<ama@client.cm>", "ama@client.cm"],
    ["ama@client.cm", "ama@client.cm"],
    ["", "Unknown sender"],
  ])("senderName(%j) → %j", (input, expected) => {
    expect(mailNotify.senderName(input)).toBe(expected);
  });

  test("a message with no subject still says something", () => {
    const { body } = mailNotify.compose({ from: "a@b.c", subject: null, bodyText: "" });
    expect(body).toBe("(no subject)");
  });

  test.each([
    ["> quoted only", ""],
    ["Hello there\n> On Monday you wrote:\n> old", "Hello there"],
    ["Line one\nLine two\n-- \nSignature", "Line one Line two -- Signature"],
    ["Body\n\n-----Original Message-----\nold", "Body"],
  ])("snippet(%j) drops quoted history", (input, expected) => {
    expect(mailNotify.snippet(input)).toBe(expected);
  });

  test("a long snippet is truncated with an ellipsis, not cut mid-flow", () => {
    const out = mailNotify.snippet("word ".repeat(200));
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("the call is actually wired into the sync loop", () => {
  /**
   * The functions above can all be right while inbound mail still notifies
   * nobody, which is exactly the state this change found the code in: the
   * machinery for a notification existed, and the ingest path did not call it.
   * A unit test of a service nothing invokes proves the service, not the
   * feature. This asserts the call site.
   */
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../src/modules/mail/mail/mail.service.js"),
    "utf8",
  );

  test("syncConnection calls onInboundMessage for every ingested message", () => {
    expect(src).toMatch(/require\("\.\/mail-notify\.service"\)/);
    expect(src).toMatch(/mailNotify\.onInboundMessage\(client, \{/);
    expect(src).toMatch(/conn, message: m, row, ctx,/);
    // The backfill guard has to be wired too, or a newly connected mailbox
    // pushes its entire ninety-day history at once.
    expect(src).toMatch(/isFirstSync: !folder\.last_sync_at/);
  });

  test("it is awaited, so the in-app row joins the sync's transaction", () => {
    expect(src).toMatch(/await mailNotify\.onInboundMessage/);
  });
});

describe("the category is one the Preferences UI can actually show", () => {
  const { CATEGORIES, categoryFor, isKnownCategory } = require("../../src/shared/notifications/categories");

  test("`comms` is a real category, not a string invented at a call site", () => {
    expect(isKnownCategory("comms")).toBe(true);
    expect(CATEGORIES.map((c) => c.key)).toContain("comms");
  });

  test("it can be silenced — mail is not a security notice", () => {
    expect(CATEGORIES.find((c) => c.key === "comms").security).toBe(false);
  });

  test.each([
    "email.thread.created",
    "email.thread.replied",
    "mail.sla.breached",
    "comms.message_posted",
    "mention.created",
  ])("%s files itself under comms, not the System catch-all", (key) => {
    expect(categoryFor(key)).toBe("comms");
  });
});
