"use strict";

/**
 * 14180 — telling clients what is waiting in their portal, by email and push.
 *
 *   PRODUCER (shared/notifications/notify-portal.js)
 *     1. Only the listed events, only the kind worth telling (a team reply,
 *        not the client's own message; a stage DONE, not started).
 *     2. Never from a sandbox, never without a tenant to queue for.
 *     3. The outbox row is written inside a savepoint, so a failure cannot
 *        abort the business transaction — and nothing throws.
 *     4. One job per client, topic and window: a burst is one message.
 *
 *   DELIVERY (modules/portal/portal_notify.service.js)
 *     5. Switches: defaults (shipment steps off by email), per-scope topics,
 *        a hidden topic kept as it was.
 *     6. A chat reply pushed only to people who have not read it; emailed at
 *        most once an hour per conversation.
 *     7. Everything else batched into one email per person, with the send
 *        point an administrator can route; a person told once is not told
 *        again on a retry; a failed send gives its claim back and the job
 *        is retried.
 *     8. A push endpoint must be a real push service (the worker POSTs to it).
 */

let mockRows;
let mockPushes;
let mockEmails;
let mockEnqueued;
let mockCtx;
let mockDb;

jest.mock("../../src/config/request-context", () => ({
  getTenant: () => (mockCtx ? mockCtx.tenant : null),
  getEnv: () => (mockCtx ? mockCtx.env : null),
  get: () => mockCtx,
}));
jest.mock("../../src/jobs/queue-producer", () => ({
  enqueue: async (...args) => {
    mockEnqueued.push(args);
    return { id: "job" };
  },
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveBySlug: async (slug) => ({ slug, tenant_id: "t-1", db_name: "db" }),
  publicSurfaceOrigin: async () => "https://acme.example",
  workspaceOrigin: async () => ({ origin: "https://acme.praxis.test" }),
}));
jest.mock("../../src/shared/push/push.service", () => ({
  sendToPortalUser: async (c, p) => {
    mockPushes.push(p);
    return { sent: 1, failed: 0, total: 1 };
  },
  getPublicKey: async () => "BPUBLIC",
  currentKeyFingerprint: async () => "fp",
}));
jest.mock("../../src/services/email.service", () => ({
  send: async (c, m) => {
    if (m.to === "fails@acme.cm") throw new Error("SMTP down");
    mockEmails.push(m);
    return { messageId: "m" };
  },
}));
jest.mock("../../src/modules/branding/branding.service", () => ({
  getBranding: async () => ({ name: "Acme Logistics", primary: "#0a7d5a", primaryForeground: "#ffffff", logoUrl: "/media/logo.png" }),
}));
jest.mock("../../src/modules/portal/portal_notify.repo", () =>
  new Proxy({}, {
    get: (_t, name) => (...args) => {
      if (!mockDb[name]) throw new Error(`repo.${String(name)} not mocked`);
      return mockDb[name](...args);
    },
  }));

const producer = require("../../src/shared/notifications/notify-portal");
const notify = require("../../src/modules/portal/portal_notify.service");
const { isPushService, schemas } = require("../../src/modules/portal_auth/portal_auth.validator");

const CLIENT = "22222222-2222-4222-8222-222222222222";
const SHIP = "33333333-3333-4333-8333-333333333333";
const MSG = "44444444-4444-4444-8444-444444444444";
const STAGE = "55555555-5555-4555-8555-555555555555";
const INV = "66666666-6666-4666-8666-666666666666";

/** A connection that records what it was asked, and answers from `mockRows`. */
function conn(env) {
  const calls = [];
  const c = {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      for (const [re, answer] of mockRows) {
        if (re.test(sql)) {
          if (answer instanceof Error) throw answer;
          return typeof answer === "function" ? answer(sql, params) : answer;
        }
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  if (env) c[Symbol.for("praxis.conn.env")] = env;
  return c;
}
const inserts = (c) => c.calls.filter((x) => /INSERT INTO portal_notify_outbox/.test(x.sql));

beforeEach(() => {
  mockRows = [];
  mockPushes = [];
  mockEmails = [];
  mockEnqueued = [];
  mockCtx = { tenant: "acme", env: "live" };
  mockDb = {};
});

/* ── the producer ─────────────────────────────────────────────────────── */

describe("which events reach a client", () => {
  test("an event that is not on the list costs nothing — no query at all", async () => {
    const c = conn("live");
    expect(await producer.onEvent(c, { eventTypeKey: "invoice.drafted", entityRef: `invoice:${INV}`, payload: {} })).toBeNull();
    expect(c.calls).toEqual([]);
    expect(mockEnqueued).toEqual([]);
  });

  test("a team reply is recorded for its conversation and queued twice: a quick push, a slow email", async () => {
    const c = conn("live");
    const out = await producer.onEvent(c, {
      eventTypeKey: "portal.client_message",
      entityRef: `client_message:${MSG}`,
      payload: { client_id: CLIENT, dossier_id: SHIP, direction: "STAFF", kind: "TEXT" },
    });
    expect(out).toMatchObject({ clientId: CLIENT, topic: "MESSAGES", thread: SHIP });
    expect(inserts(c)[0].params).toEqual([CLIENT, "MESSAGES", SHIP, "portal.client_message", `client_message:${MSG}`]);
    // Inside a savepoint, released after.
    expect(c.calls[0].sql).toBe("SAVEPOINT portal_notify");
    expect(c.calls.map((x) => x.sql)).toContain("RELEASE SAVEPOINT portal_notify");
    expect(mockEnqueued.map((e) => [e[0], e[1]])).toEqual([
      ["portal-notify-deliver", "push"],
      ["portal-notify-deliver", "email"],
    ]);
    const [push, email] = mockEnqueued.map((e) => e[3].delay);
    expect(push).toBeGreaterThanOrEqual(12_000);
    expect(push).toBeLessThanOrEqual(20_000);
    expect(email).toBeGreaterThanOrEqual(10 * 60_000);
  });

  test("the client's OWN message is not news to them", async () => {
    const c = conn("live");
    const out = await producer.onEvent(c, {
      eventTypeKey: "portal.client_message",
      entityRef: `client_message:${MSG}`,
      payload: { client_id: CLIENT, dossier_id: null, kind: "TEXT" },
    });
    expect(out).toBeNull();
    expect(c.calls).toEqual([]);
  });

  test("a stage is told when it is DONE and client-visible — read, not trusted from the payload", async () => {
    mockRows = [[/FROM milestone_instance mi/, { rows: [{ client_id: CLIENT }] }]];
    const c = conn("live");
    await producer.onEvent(c, {
      eventTypeKey: "milestone.advanced",
      entityRef: `dossier:${SHIP}`,
      payload: { milestone_instance_id: STAGE, to: "IN_PROGRESS" },
    });
    expect(inserts(c)).toEqual([]);

    const out = await producer.onEvent(c, {
      eventTypeKey: "milestone.advanced",
      entityRef: `dossier:${SHIP}`,
      payload: { milestone_instance_id: STAGE, to: "DONE" },
    });
    expect(out).toMatchObject({ topic: "SHIPMENTS", item: `milestone_instance:${STAGE}` });
    const read = c.calls.find((x) => /FROM milestone_instance mi/.test(x.sql));
    expect(read.sql).toMatch(/is_client_visible/);
  });

  test("an internal stage — no client-visible row — records nothing", async () => {
    const c = conn("live");
    const out = await producer.onEvent(c, {
      eventTypeKey: "milestone.advanced",
      entityRef: `dossier:${SHIP}`,
      payload: { milestone_instance_id: STAGE, to: "DONE" },
    });
    expect(out).toBeNull();
    expect(inserts(c)).toEqual([]);
    expect(mockEnqueued).toEqual([]);
  });

  test("never from a sandbox, never without a tenant", async () => {
    const sandbox = conn("sandbox");
    const evt = { eventTypeKey: "client_request.created", entityRef: `client_request:${MSG}`, payload: { client_id: CLIENT } };
    expect(await producer.onEvent(sandbox, evt)).toBeNull();
    expect(sandbox.calls).toEqual([]);

    mockCtx = null;
    const live = conn("live");
    expect(await producer.onEvent(live, evt)).toBeNull();
    expect(live.calls).toEqual([]);
  });

  test("a failed write rolls back to the savepoint and does not throw into the business operation", async () => {
    mockRows = [[/INSERT INTO portal_notify_outbox/, new Error("relation does not exist")]];
    const c = conn("live");
    const out = await producer.onEvent(c, {
      eventTypeKey: "invoice_bundle.published", entityRef: `final_invoice:${INV}`, payload: { client_id: CLIENT },
    });
    expect(out).toBeNull();
    expect(c.calls.map((x) => x.sql)).toContain("ROLLBACK TO SAVEPOINT portal_notify");
    expect(mockEnqueued).toEqual([]);
  });

  test("a burst is one job: the same client, topic and window share a job id", async () => {
    const meta = { slug: "acme" };
    const t0 = 28_333_334 * 60_000 + 40_000; // 40 s into a minute
    await producer.schedule(meta, { clientId: CLIENT, topic: "BILLING" }, t0);
    await producer.schedule(meta, { clientId: CLIENT, topic: "BILLING" }, t0 + 5_000);
    await producer.schedule(meta, { clientId: CLIENT, topic: "BILLING" }, t0 + 30_000);
    const ids = mockEnqueued.map((e) => e[3].jobId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids[0]).not.toMatch(/:/);
  });
});

/* ── the switches ─────────────────────────────────────────────────────── */

describe("a person's own switches", () => {
  test("defaults: everything on, except shipment steps by email", async () => {
    mockDb.setting = async () => null;
    const s = await notify.settings(null, { clientId: CLIENT, email: "marie@acme.cm", scope: "ALL" });
    expect(s.topics.map((x) => x.topic)).toEqual(["MESSAGES", "REQUESTS", "BILLING", "PROPOSALS", "SHIPMENTS"]);
    expect(s.topics.find((x) => x.topic === "SHIPMENTS")).toEqual({ topic: "SHIPMENTS", email: false, push: true });
    expect(s.topics.find((x) => x.topic === "BILLING")).toEqual({ topic: "BILLING", email: true, push: true });
  });

  test("a colleague given Billing only is offered the General conversation and billing — nothing else", async () => {
    mockDb.setting = async () => null;
    const s = await notify.settings(null, { clientId: CLIENT, email: "fin@acme.cm", scope: "BILLING" });
    expect(s.topics.map((x) => x.topic)).toEqual(["MESSAGES", "BILLING"]);
  });

  test("saving keeps a topic this person cannot see exactly as it was", async () => {
    let saved = null;
    mockDb.setting = async () => (saved ? { email_off: saved.emailOff, push_off: saved.pushOff } : { email_off: ["SHIPMENTS", "PROPOSALS"], push_off: [] });
    mockDb.saveSetting = async (c, s) => {
      saved = s;
      return s;
    };
    await notify.saveSettings(null, {
      clientId: CLIENT, email: "fin@acme.cm", scope: "BILLING",
      topics: [{ topic: "BILLING", email: false, push: true }, { topic: "SHIPMENTS", email: true, push: true }],
    });
    // BILLING turned off by email; SHIPMENTS and PROPOSALS untouched — this
    // person cannot see them, so their choice cannot be changed from here.
    expect(saved.emailOff.sort()).toEqual(["BILLING", "PROPOSALS", "SHIPMENTS"]);
    expect(saved.pushOff).toEqual([]);
  });
});

/* ── delivery ─────────────────────────────────────────────────────────── */

const MARIE = { email: "marie@acme.cm", scope: "ALL", granted_at: "2026-01-01", portal_user_id: "pu-1", devices: 1, language: "en" };
const PAUL = { email: "paul@acme.cm", scope: "OPERATIONS", granted_at: "2026-01-01", portal_user_id: "pu-2", devices: 2, language: "fr" };
const FIN = { email: "fin@acme.cm", scope: "BILLING", granted_at: "2026-01-01", portal_user_id: "pu-3", devices: 1, language: "en" };

function deliveryDb({ people, waiting, unread = {}, told = false, claim = () => 1 }) {
  const marked = [];
  const released = [];
  Object.assign(mockDb, {
    audience: async () => people,
    clientProfile: async () => ({ name: "Acme Trading", preferred_language: "en" }),
    waiting: async (c, { channel }) => (waiting[channel] || []),
    markDone: async (c, { ids, channel }) => marked.push([channel, ids]),
    unreadReplies: async (c, { portalUserId }) => unread[portalUserId] || [],
    recentlyTold: async () => told,
    claim: async (c, a) => claim(a),
    release: async (c, id) => released.push(id),
    sweep: async () => {},
    staleGroups: async () => [],
    invoices: async () => [{ invoice_id: INV, doc_number: "FA-2026-0012", currency: "XAF", total_ttc: "1250000", payment_due_on: "2026-10-30", documents: 3 }],
    proofs: async () => [],
    requests: async () => [],
    proposals: async () => [],
    stages: async () => [],
  });
  return { marked, released };
}

const TENANT = { slug: "acme", tenant_id: "t-1" };

describe("a reply from the team", () => {
  const rows = [{ outbox_id: 7, event_key: "portal.client_message", item_ref: `client_message:${MSG}` }];

  test("is pushed to whoever has not read it, and opens that conversation", async () => {
    const { marked } = deliveryDb({
      people: [MARIE, PAUL],
      waiting: { push: rows },
      unread: { "pu-1": [{ message_id: MSG, body: "The truck left Douala", author: "Awa", dossier_ref: null }] },
    });
    const out = await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "MESSAGES", thread: "general", stage: "push" });
    // Paul read it in the portal already: nothing for him.
    expect(mockPushes).toHaveLength(1);
    expect(mockPushes[0]).toMatchObject({
      portal_user_id: "pu-1",
      title: "Acme Logistics",
      body: "Awa: The truck left Douala",
      url: "/portal?chat=general",
      tag: "messages:general",
      urgency: "high",
    });
    expect(out.pushed).toBe(1);
    expect(marked).toEqual([["push", [7]]]);
  });

  test("a shipment's conversation says which shipment, and a Billing-only colleague is not told", async () => {
    deliveryDb({
      people: [FIN, MARIE],
      waiting: { push: rows },
      unread: {
        "pu-1": [{ message_id: MSG, body: "", attachment_kind: "IMAGE", author: "Awa", dossier_ref: "PRX-2026-0418" }],
        "pu-3": [{ message_id: MSG, body: "x", author: "Awa", dossier_ref: "PRX-2026-0418" }],
      },
    });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "MESSAGES", thread: SHIP, stage: "push" });
    expect(mockPushes.map((p) => p.portal_user_id)).toEqual(["pu-1"]);
    expect(mockPushes[0].title).toBe("Acme Logistics · PRX-2026-0418");
    expect(mockPushes[0].body).toBe("Awa: Photo");
    expect(mockPushes[0].url).toBe(`/portal?chat=${SHIP}`);
  });

  test("is emailed at most once an hour per conversation", async () => {
    const { marked } = deliveryDb({
      people: [MARIE],
      waiting: { email: rows },
      unread: { "pu-1": [{ message_id: MSG, body: "Hello", author: "Awa" }] },
      told: true,
    });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "MESSAGES", thread: "general", stage: "email" });
    expect(mockEmails).toEqual([]);
    // Handled, not left waiting: the earlier email already said the thread moved.
    expect(marked).toEqual([["email", [7]]]);
  });

  test("the email is in the person's language, with French punctuation", async () => {
    deliveryDb({
      people: [PAUL],
      waiting: { email: rows },
      unread: { "pu-2": [{ message_id: MSG, body: "Le camion est parti", author: "Awa" }] },
    });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "MESSAGES", thread: "general", stage: "email" });
    expect(mockEmails).toHaveLength(1);
    expect(mockEmails[0].subject).toBe("Acme Logistics vous a écrit");
    expect(mockEmails[0].text).toContain("Awa : Le camion est parti");
    expect(mockEmails[0].text).toContain("https://acme.example/portal?chat=general");
    expect(mockEmails[0].sendPoint).toBe("portal.notify");
  });
});

describe("everything else, batched", () => {
  const rows = [
    { outbox_id: 11, event_key: "invoice.posted", item_ref: `invoice:${INV}` },
    { outbox_id: 12, event_key: "invoice_bundle.published", item_ref: `final_invoice:${INV}` },
  ];

  test("one email and one push per person for the whole batch, to those who handle billing", async () => {
    const { marked } = deliveryDb({ people: [MARIE, PAUL, FIN], waiting: { push: rows, email: rows } });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "BILLING", thread: null, stage: "both" });
    // Paul has the operations side only.
    expect(mockEmails.map((m) => m.to).sort()).toEqual(["fin@acme.cm", "marie@acme.cm"]);
    expect(mockPushes.map((p) => p.portal_user_id).sort()).toEqual(["pu-1", "pu-3"]);
    const mail = mockEmails[0];
    expect(mail.subject).toBe("Acme Logistics: 2 billing updates");
    expect(mail.text).toContain("New invoice FA-2026-0012, 1,250,000 XAF, due 30/10/2026");
    expect(mail.text).toContain("Invoice FA-2026-0012: 3 supporting documents to download");
    // One invoice: the link opens it.
    expect(mail.text).toContain(`https://acme.example/portal/billing?invoice=${INV}`);
    expect(mail.html).toContain("#0a7d5a");
    expect(mail.html).not.toMatch(/<script/i);
    expect(marked).toEqual([["push", [11, 12]], ["email", [11, 12]]]);
  });

  test("somebody who switched a topic off by email is not emailed about it", async () => {
    deliveryDb({ people: [{ ...MARIE, email_off: ["BILLING"], push_off: [] }], waiting: { push: rows, email: rows } });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "BILLING", thread: null, stage: "both" });
    expect(mockEmails).toEqual([]);
    expect(mockPushes).toHaveLength(1);
  });

  test("a person already told (a retried job) is not told again", async () => {
    deliveryDb({ people: [MARIE], waiting: { push: rows, email: rows }, claim: () => null });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "BILLING", thread: null, stage: "both" });
    expect(mockEmails).toEqual([]);
    expect(mockPushes).toEqual([]);
  });

  test("a failed send gives its claim back, leaves the rows waiting and fails the job for a retry", async () => {
    let n = 0;
    const { marked, released } = deliveryDb({
      people: [{ ...MARIE, email: "fails@acme.cm" }],
      waiting: { email: rows },
      claim: () => ++n,
    });
    await expect(
      notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "BILLING", thread: null, stage: "email" }),
    ).rejects.toThrow("SMTP down");
    expect(released).toEqual([1]);
    expect(marked).toEqual([]);
  });

  test("nothing still true, nothing sent: an answered proposal is no longer news", async () => {
    const { marked } = deliveryDb({
      people: [MARIE],
      waiting: { push: [{ outbox_id: 20, event_key: "proposal.sent", item_ref: `proposal:${INV}` }] },
    });
    await notify.deliver(null, { tenant: TENANT, clientId: CLIENT, topic: "PROPOSALS", thread: null, stage: "push" });
    expect(mockPushes).toEqual([]);
    expect(marked).toEqual([["push", [20]]]);
  });
});

describe("a device", () => {
  test("must belong to a real push service — the worker POSTs to it", () => {
    expect(isPushService("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushService("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushService("https://web.push.apple.com/QGx")).toBe(true);
    expect(isPushService("https://wns2-db5p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushService("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushService("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isPushService("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushService("https://fcm.googleapis.com:8443/x")).toBe(false);
    const bad = schemas.pushSubscribe.safeParse({
      subscription: { endpoint: "https://internal.local/hook", keys: { p256dh: "a", auth: "b" } },
    });
    expect(bad.success).toBe(false);
  });

  test("settings take the five topics and nothing else", () => {
    expect(schemas.notifySettings.safeParse({ topics: [{ topic: "BILLING", email: false, push: true }] }).success).toBe(true);
    expect(schemas.notifySettings.safeParse({ topics: [{ topic: "PAYROLL", email: false, push: true }] }).success).toBe(false);
    expect(schemas.notifySettings.safeParse({ topics: [], client_id: CLIENT }).success).toBe(false);
  });
});
