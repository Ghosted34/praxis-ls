"use strict";
/**
 * The reliability contract of notification delivery.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 *
 * Three things, and each one loses a notification on its own:
 *
 *   1. `tag: userId` on every push. A tag tells the OS "REPLACE the existing
 *      notification with this one", so five mails produced one visible alert
 *      and four silently destroyed ones.
 *   2. `url: "/notifications"` hardcoded, so a tap landed on a generic list
 *      rather than the thing the notification was about.
 *   3. No retry and no fallback. Push and email went out inline inside the
 *      producer's open transaction; a transient 500 from a push service was
 *      logged at warn level and the notification was gone for ever.
 *
 * Everything below pins the fix for one of those.
 */

const mockSendToUser = jest.fn(async () => ({ sent: 1, failed: 0, total: 1 }));
const mockEmailSend = jest.fn(async () => ({}));
const mockEnqueue = jest.fn(async () => ({ id: "job-1" }));
const mockResolveBySlug = jest.fn(async () => null);
const mockGetTenant = jest.fn(() => null);

jest.mock("../../src/modules/notification/notification.repo");
jest.mock("../../src/shared/push/push.service", () => ({
  sendToUser: (...a) => mockSendToUser(...a),
  getPublicKey: jest.fn(),
}));
jest.mock("../../src/services/email.service", () => ({ send: (...a) => mockEmailSend(...a) }));
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: (...a) => mockEnqueue(...a) }));
jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveBySlug: (...a) => mockResolveBySlug(...a),
}));
jest.mock("../../src/config/request-context", () => ({
  getTenant: (...a) => mockGetTenant(...a),
  get: () => undefined,
  getUserId: () => null,
  getRequestId: () => null,
  run: (_c, f) => f(),
}));

const repo = require("../../src/modules/notification/notification.repo");
const svc = require("../../src/modules/notification/notification.service");

const client = {
  query: jest.fn(async () => ({ rows: [{ email: "u@x.com", full_name: "U" }] })),
};

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` clears recorded calls but KEEPS implementations, so a
  // `mockReturnValue` set in one test leaks into the next. Both tenant lookups
  // are re-pinned to "no tenant" here, which is what makes each test's
  // queued-vs-inline path its own choice rather than a side effect of order.
  mockGetTenant.mockReturnValue(null);
  mockResolveBySlug.mockResolvedValue(null);
  mockSendToUser.mockResolvedValue({ sent: 1, failed: 0, total: 1 });
  repo.insertForUser.mockResolvedValue({ notification_id: "n-1" });
  repo.insertForUsers.mockResolvedValue([{ notification_id: "n-1", user_id: "u-1" }]);
  repo.isChannelEnabled.mockResolvedValue(true);
  repo.preferencesFor.mockResolvedValue(new Map());
  // The address now arrives with the delivery plan, resolved in ONE query for
  // every recipient rather than one query per recipient inside the send loop
  // (which is what PERF S5 removed). So this is where a recipient's email
  // comes from, not a per-user SELECT.
  repo.activeEmailsFor.mockResolvedValue(
    new Map([
      ["u-1", { user_id: "u-1", email: "u@x.com", full_name: "U" }],
      ["u-2", { user_id: "u-2", email: "v@x.com", full_name: "V" }],
    ]),
  );
  repo.unreadCount.mockResolvedValue(4);
  repo.unreadCountsFor.mockResolvedValue(new Map([["u-1", 7]]));
});

describe("the push payload", () => {
  test("no tag by default — notifications STACK instead of replacing each other", async () => {
    await svc.notify(client, { userId: "u-1", eventTypeKey: "invoice.posted", title: "Inv" });
    const [, opts] = mockSendToUser.mock.calls[0];
    // The regression that mattered: `tag: userId` meant one visible
    // notification per user, for ever, no matter how many arrived.
    expect(opts.tag).toBeUndefined();
    expect(opts.user_id).toBe("u-1");
  });

  test("a caller that wants collapsing gets it, and it stays audible", async () => {
    await svc.notify(client, {
      userId: "u-1", eventTypeKey: "email.thread.replied", title: "Mail",
      pushTag: "mail:t-9", renotify: true, urgency: "high",
    });
    const [, opts] = mockSendToUser.mock.calls[0];
    expect(opts.tag).toBe("mail:t-9");
    // Without renotify a replacing notification updates in place with no sound
    // — indistinguishable, to a phone in a pocket, from never arriving.
    expect(opts.renotify).toBe(true);
    expect(opts.urgency).toBe("high");
  });

  test("the deep link is carried through, and defaults to the inbox", async () => {
    await svc.notify(client, {
      userId: "u-1", eventTypeKey: "email.thread.created", title: "Mail",
      url: "/comms/mail?thread=t-9", pushData: { kind: "mail", thread_id: "t-9" },
    });
    expect(mockSendToUser.mock.calls[0][1].url).toBe("/comms/mail?thread=t-9");
    expect(mockSendToUser.mock.calls[0][1].data).toEqual({ kind: "mail", thread_id: "t-9" });

    mockSendToUser.mockClear();
    await svc.notify(client, { userId: "u-1", eventTypeKey: "invoice.posted", title: "Inv" });
    expect(mockSendToUser.mock.calls[0][1].url).toBe("/notifications");
  });

  test("the badge number rides along, read AFTER the insert so it counts this one", async () => {
    await svc.notify(client, { userId: "u-1", eventTypeKey: "invoice.posted", title: "Inv" });
    expect(mockSendToUser.mock.calls[0][1].badgeCount).toBe(4);
  });

  test("notifyMany gives each recipient their own badge number", async () => {
    repo.preferencesFor.mockResolvedValue(new Map());
    repo.insertForUsers.mockResolvedValue([{ user_id: "u-1" }, { user_id: "u-2" }]);
    repo.unreadCountsFor.mockResolvedValue(new Map([["u-1", 7], ["u-2", 2]]));
    await svc.notifyMany(client, ["u-1", "u-2"], { eventTypeKey: "invoice.posted", title: "Inv" });
    const byUser = Object.fromEntries(
      mockSendToUser.mock.calls.map(([, o]) => [o.user_id, o.badgeCount]),
    );
    expect(byUser).toEqual({ "u-1": 7, "u-2": 2 });
  });
});

describe("the email fallback", () => {
  const mailOpts = {
    userId: "u-1", eventTypeKey: "email.thread.created", title: "Mail from Ama",
    body: "Re: BL 4471", emailFallback: true,
  };

  test("no registered device → the email goes out over the preference", async () => {
    // EMAIL preference off, which is the default. Without the fallback this
    // user would have been told on no channel at all.
    repo.isChannelEnabled.mockImplementation(async (_c, _u, ch) => ch === "IN_APP");
    mockSendToUser.mockResolvedValue({ sent: 0, failed: 0, total: 0, reason: "no registered devices" });

    await svc.notify(client, mailOpts);
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    expect(mockEmailSend.mock.calls[0][1]).toMatchObject({ to: "u@x.com", subject: "Mail from Ama" });
  });

  test("every device failed → the email goes out too", async () => {
    repo.isChannelEnabled.mockImplementation(async (_c, _u, ch) => ch === "IN_APP");
    mockSendToUser.mockResolvedValue({ sent: 0, failed: 3, total: 3 });
    await svc.notify(client, mailOpts);
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
  });

  test("push landed → no fallback email, because they already know", async () => {
    repo.isChannelEnabled.mockImplementation(async (_c, _u, ch) => ch === "IN_APP");
    mockSendToUser.mockResolvedValue({ sent: 2, failed: 0, total: 2 });
    await svc.notify(client, mailOpts);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  test("push unconfigured deployment-wide → NO fallback, so it stays visible as the ops problem it is", async () => {
    repo.isChannelEnabled.mockImplementation(async (_c, _u, ch) => ch === "IN_APP");
    mockSendToUser.mockResolvedValue({ sent: 0, reason: "push not configured" });
    await svc.notify(client, mailOpts);
    // Otherwise a deployment with no VAPID keypair emails every recipient on
    // every message, which hides the missing keypair behind a flood.
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  test("without emailFallback, an opted-out user gets no email — the old behaviour is intact", async () => {
    repo.isChannelEnabled.mockImplementation(async (_c, _u, ch) => ch === "IN_APP");
    mockSendToUser.mockResolvedValue({ sent: 0, reason: "no registered devices" });
    await svc.notify(client, { ...mailOpts, emailFallback: false });
    expect(mockEmailSend).not.toHaveBeenCalled();
  });
});

describe("delivery moves onto the queue when it can", () => {
  test("with a tenantMeta, push and SMTP leave the caller's transaction", async () => {
    const meta = { slug: "smartls", db_name: "praxis_smartls" };
    await svc.notify(client, {
      userId: "u-1", eventTypeKey: "email.thread.created", title: "Mail",
      pushTag: "mail:t-1", url: "/comms/mail?thread=t-1", emailFallback: true,
      ctx: { tenantMeta: meta, env: "live" },
    });

    // Nothing sent inline: the whole outbound half is now the worker's.
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(mockEmailSend).not.toHaveBeenCalled();

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const [queue, jobName, data] = mockEnqueue.mock.calls[0];
    expect(queue).toBe("notification-deliver");
    expect(jobName).toBe("deliver");
    expect(data.tenantMeta).toBe(meta);
    expect(data.env).toBe("live");
    // The plan is resolved, not re-derived on the worker — a retry three
    // minutes later must not disagree with the in-app row already written.
    expect(data.recipients).toEqual([
      { userId: "u-1", email: true, push: true, badgeCount: 4 },
    ]);
    expect(data.notification).toMatchObject({
      title: "Mail", tag: "mail:t-1", url: "/comms/mail?thread=t-1",
      emailFallback: true, category: "comms",
    });
  });

  test("no tenant context → delivery stays inline, exactly as before the queue existed", async () => {
    await svc.notify(client, { userId: "u-1", eventTypeKey: "invoice.posted", title: "Inv" });
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockSendToUser).toHaveBeenCalledTimes(1);
  });

  test("Redis down → inline, not lost", async () => {
    mockEnqueue.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await svc.notify(client, {
      userId: "u-1", eventTypeKey: "invoice.posted", title: "Inv",
      ctx: { tenantMeta: { slug: "smartls" } },
    });
    expect(mockSendToUser).toHaveBeenCalledTimes(1);
  });

  test("a request-path caller resolves its tenant from the ambient context", async () => {
    mockGetTenant.mockReturnValue("smartls");
    mockResolveBySlug.mockResolvedValue({ slug: "smartls", db_name: "praxis_smartls" });
    await svc.notify(client, { userId: "u-1", eventTypeKey: "comms.message_posted", title: "Msg" });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][2].tenantMeta).toMatchObject({ slug: "smartls" });
  });
});

describe("deliverOutbound — the one implementation both paths run", () => {
  test("a recipient whose in-app was suppressed is not pushed", async () => {
    await svc.deliverOutbound(client, {
      recipients: [{ userId: "u-1", push: false, email: false }],
      notification: { title: "T", category: "comms" },
    });
    expect(mockSendToUser).not.toHaveBeenCalled();
  });

  test("a push that throws is contained — later recipients still get theirs", async () => {
    mockSendToUser
      .mockRejectedValueOnce(new Error("FCM 500"))
      .mockResolvedValueOnce({ sent: 1, failed: 0, total: 1 });
    const out = await svc.deliverOutbound(client, {
      recipients: [{ userId: "u-1", push: true }, { userId: "u-2", push: true }],
      notification: { title: "T", category: "comms" },
    });
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
    expect(out.pushed).toBe(1);
  });
});

describe("addresses are fetched in one query, not one per recipient", () => {
  test("a fan-out to many recipients issues a single address lookup", async () => {
    repo.insertForUsers.mockResolvedValue([{ user_id: "u-1" }, { user_id: "u-2" }]);
    repo.preferencesFor.mockResolvedValue(
      new Map([["u-1:EMAIL", true], ["u-2:EMAIL", true]]),
    );
    await svc.notifyMany(client, ["u-1", "u-2"], {
      eventTypeKey: "invoice.posted", title: "Inv",
    });
    // Not two. PERF S5 batched this deliberately, and an earlier draft of
    // deliverOutbound put the per-user SELECT back inside the send loop.
    expect(repo.activeEmailsFor).toHaveBeenCalledTimes(1);
    expect(repo.activeEmailsFor.mock.calls[0][1].sort()).toEqual(["u-1", "u-2"]);
    expect(mockEmailSend).toHaveBeenCalledTimes(2);
  });

  test("a silenced recipient is never emailed by the fallback — that would route around the opt-out", async () => {
    // `push: false` is "I turned this category off". Push is not attempted, and
    // the fallback must not treat "no push sent" as "they were not reached".
    const out = await svc.deliverOutbound(client, {
      recipients: [{ userId: "u-1", push: false, email: false }],
      notification: { title: "T", category: "comms", emailFallback: true },
    });
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(out.fellBack).toBe(0);
  });
});
