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

  test("a message from the backfill is too old to be news", async () => {
    // A newly connected mailbox syncs ninety days of history. Without a gate it
    // fires hundreds of pushes for mail already dealt with, and the only thing
    // anyone does about that is turn notifications off permanently.
    const client = makeClient();
    const old = { ...row, received_at: new Date(Date.now() - 30 * 24 * 3600 * 1000) };
    const out = await mailNotify.onInboundMessage(client, { conn, message, row: old });
    expect(out).toEqual({ notified: 0, skipped: "not fresh" });
    expect(mockNotifyMany).not.toHaveBeenCalled();
  });

  test("mail that arrives DURING a backfill still notifies — the old guard lost this", async () => {
    // The first version tested `!folder.last_sync_at`, a question about the
    // SYNC. Connect a mailbox at 09:00, a client writes at 09:01, and that
    // message lands in the same first pass: silent. Asking the MESSAGE how old
    // it is gets both cases right, and keeps working for folders created later.
    const client = makeClient();
    const fresh = { ...row, received_at: new Date() };
    const out = await mailNotify.onInboundMessage(client, { conn, message, row: fresh });
    expect(out.notified).toBe(2);
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
    expect(src).toMatch(/mailNotify\.onInboundMessage\(client, \{ conn, message: m, row, ctx \}\)/);
    // The digest has to be flushed too, or everything the cap held back is
    // simply dropped — which is the failure the cap exists to avoid, not cause.
    expect(src).toMatch(/mailNotify\.flushRun\(client, \{ conn, ctx \}\)/);
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

describe("the freshness window", () => {
  test.each([
    ["arriving just now notifies", 0, true],
    ["arriving 30 minutes ago notifies", 30 * 60 * 1000, true],
    ["arriving 59 minutes ago notifies", 59 * 60 * 1000, true],
    ["arriving 61 minutes ago is too old", 61 * 60 * 1000, false],
    ["from a week ago is too old", 7 * 24 * 3600 * 1000, false],
  ])("a message %s", (_label, ago, expected) => {
    expect(mailNotify.isFresh(new Date(Date.now() - ago))).toBe(expected);
  });

  test("a missing or unparseable timestamp counts as fresh", () => {
    // Ingest defaults received_at to now() when the provider gave nothing
    // usable, so a null here is unusual rather than old — and the error to
    // prefer is one notification too many (which the cap bounds) over a mail
    // dropped in silence.
    expect(mailNotify.isFresh(null)).toBe(true);
    expect(mailNotify.isFresh("not a date")).toBe(true);
  });

  test("a future timestamp is a skewed sender clock, not tomorrow's mail", () => {
    expect(mailNotify.isFresh(new Date(Date.now() + 86_400_000))).toBe(true);
  });

  test("the window is read from the ISO string a database returns, not just a Date", () => {
    expect(mailNotify.isFresh(new Date(Date.now() - 5 * 60 * 1000).toISOString())).toBe(true);
    expect(mailNotify.isFresh(new Date(Date.now() - 5 * 3600 * 1000).toISOString())).toBe(false);
  });
});

describe("the per-run cap and its digest", () => {
  const fresh = () => ({ ...row, received_at: new Date() });

  test("notifies individually up to the cap, then counts", async () => {
    const client = makeClient();
    const ctx = {};
    for (let i = 0; i < mailNotify.PER_RUN_CAP + 5; i++) {
      /* eslint-disable-next-line no-await-in-loop */
      await mailNotify.onInboundMessage(client, { conn, message, row: fresh(), ctx });
    }
    expect(mockNotifyMany).toHaveBeenCalledTimes(mailNotify.PER_RUN_CAP);
    expect(ctx.__mailNotify.get("c-1").suppressed).toBe(5);
  });

  test("the remainder arrives as ONE digest naming the count and the mailbox", async () => {
    const client = makeClient();
    const ctx = {};
    for (let i = 0; i < mailNotify.PER_RUN_CAP + 3; i++) {
      /* eslint-disable-next-line no-await-in-loop */
      await mailNotify.onInboundMessage(client, { conn, message, row: fresh(), ctx });
    }
    mockNotifyMany.mockClear();

    const out = await mailNotify.flushRun(client, { conn, ctx });
    expect(out.digested).toBe(3);
    expect(mockNotifyMany).toHaveBeenCalledTimes(1);
    const [, userIds, opts] = mockNotifyMany.mock.calls[0];
    expect(userIds).toEqual(["u-1", "u-2"]);
    // MAILBOX-scoped: the digest query passes no thread, so a thread's
    // assignee or someone it was individually shared with is not swept into a
    // summary of a mailbox they do not otherwise work.
    const digestQuery = client.query.mock.calls
      .filter(([sql]) => /FROM app_user/.test(sql))
      .pop();
    expect(digestQuery[1]).toEqual(["c-1", "u-1", null, null]);
    expect(opts.title).toBe("3 more new messages in billing@praxisls.com");
    expect(opts.url).toBe("/comms/mail");
    // Collapses on the mailbox: a later overflow REPLACES this line, because
    // the newer count already includes the older one.
    expect(opts.pushTag).toBe("mail-digest:c-1");
    expect(opts.emailFallback).toBe(true);
  });

  test("singular reads correctly", async () => {
    const client = makeClient();
    const ctx = {};
    for (let i = 0; i < mailNotify.PER_RUN_CAP + 1; i++) {
      /* eslint-disable-next-line no-await-in-loop */
      await mailNotify.onInboundMessage(client, { conn, message, row: fresh(), ctx });
    }
    mockNotifyMany.mockClear();
    await mailNotify.flushRun(client, { conn, ctx });
    expect(mockNotifyMany.mock.calls[0][2].title).toBe("1 more new message in billing@praxisls.com");
  });

  test("nothing held back → no digest", async () => {
    const client = makeClient();
    const ctx = {};
    await mailNotify.onInboundMessage(client, { conn, message, row: fresh(), ctx });
    mockNotifyMany.mockClear();
    const out = await mailNotify.flushRun(client, { conn, ctx });
    expect(out).toEqual({ notified: 0, skipped: "nothing held back" });
    expect(mockNotifyMany).not.toHaveBeenCalled();
  });

  test("flushing twice does not send the digest twice", async () => {
    const client = makeClient();
    const ctx = {};
    for (let i = 0; i < mailNotify.PER_RUN_CAP + 2; i++) {
      /* eslint-disable-next-line no-await-in-loop */
      await mailNotify.onInboundMessage(client, { conn, message, row: fresh(), ctx });
    }
    await mailNotify.flushRun(client, { conn, ctx });
    mockNotifyMany.mockClear();
    await mailNotify.flushRun(client, { conn, ctx });
    expect(mockNotifyMany).not.toHaveBeenCalled();
  });

  test("the tally is per MAILBOX, not shared across the run", async () => {
    // Two mailboxes syncing in one run must not throttle each other.
    const client = makeClient();
    const ctx = {};
    const other = { ...conn, email_connection_id: "c-2", email_address: "ops@praxisls.com" };
    for (let i = 0; i < mailNotify.PER_RUN_CAP; i++) {
      /* eslint-disable-next-line no-await-in-loop */
      await mailNotify.onInboundMessage(client, { conn, message, row: fresh(), ctx });
    }
    mockNotifyMany.mockClear();
    await mailNotify.onInboundMessage(client, { conn: other, message, row: fresh(), ctx });
    expect(mockNotifyMany).toHaveBeenCalledTimes(1);
  });
});
