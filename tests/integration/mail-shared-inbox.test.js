/**
 * THE SHARED INBOX (§9.1, §9.9, §9.11) — claim race under concurrency, and the
 * triage writes that read back.
 *
 * §9.11 asks for one integration test: "claim race under concurrency". The
 * claim endpoint is a single conditional UPDATE — `WHERE assigned_user_id IS
 * NULL` — so the database, not the application, decides the winner. A test
 * that called the SQL once would test nothing about the race; this file drives
 * the real route with two claimants racing through the same recording client,
 * whose emulation applies the guard the SQL text actually carries. If the
 * guard is ever dropped, the emulation treats the update as unconditional and
 * BOTH claimants win — which fails here, before a user ever sees two agents
 * answering one customer.
 *
 * The second half guards the read half of the write: claim / assign / status /
 * visibility all RETURN the thread, so they are reads in the §9.5 sense. Each
 * must be gated by the caller's ability to see the thread — a Private thread's
 * subject must not leak through `RETURNING *` to a colleague who could never
 * open it, and a thread you cannot see must not be one you can widen to TEAM.
 */
"use strict";

const express = require("express");
const request = require("supertest");

jest.mock("../../src/middleware/auth", () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { user_id: req.headers["x-user-id"] || null };
    next();
  },
}));
jest.mock("../../src/middleware/rbac", () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireCeo: () => (_req, _res, next) => next(),
}));
jest.mock("../../src/middleware/feature-gate", () => ({
  requireFeature: () => (_req, _res, next) => next(),
}));
jest.mock("../../src/shared/http/validate", () => ({
  body: () => (_req, _res, next) => next(),
}));
jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => ({})),
  emitEvent: jest.fn(async () => ({})),
}));

const { router } = require("../../src/modules/mail/triage/triage.routes");

/**
 * A recording stand-in for the tenant database. It emulates, for the four
 * statements this suite exercises, what the real schema would do:
 *   · getThread's head query applies the visibility rule keyed on the caller;
 *   · the claim UPDATE applies `assigned_user_id IS NULL` — but ONLY when the
 *     SQL still carries it, so a regression to read-then-write shows up here
 *     as two winners instead of one;
 *   · assign / status / visibility apply unconditionally, as their SQL does.
 */
function sharedClient({ visibleTo = new Set(["u-owner"]) } = {}) {
  const calls = [];
  const assigned = new Map();
  const threads = new Map([
    ["t-1", { subject: "Invoice follow-up", visibility: "TEAM" }],
    ["t-private", { subject: "Salary negotiation", visibility: "PRIVATE" }],
  ]);
  return {
    calls,
    written: (re) => calls.filter((c) => re.test(c.text)),
    query: async (text, params) => {
      calls.push({ text, params });
      const sql = text.trim().replace(/\s+/g, " ");
      // getThread (`SELECT t.*`) and the C-4 gate (`headIfVisible` selects a
      // named column list). Both are the same question: may this caller see
      // this thread? A 404 from the gate is indistinguishable from a missing
      // row, so the fixture must answer both or every write 404s before SQL.
      if (sql.startsWith("SELECT t.*") || /SELECT t\.email_thread_id, t\.email_connection_id, t\.subject, t\.visibility/.test(sql)) {
        const [userId, threadId] = params;
        const th = threads.get(threadId);
        if (!th || !visibleTo.has(userId)) return { rows: [] };
        return {
          rows: [{
            email_thread_id: threadId, email_connection_id: "conn-1",
            subject: th.subject, participants: [], visibility: th.visibility,
            owner_user_id: "u-owner",
          }],
        };
      }
      if (/FROM email_message m/.test(sql)) return { rows: [] };
      if (/UPDATE email_thread t SET assigned_user_id/.test(sql)) {
        const threadId = params[0];
        if (!threads.has(threadId)) return { rows: [] };
        if (/assigned_user_id IS NULL/.test(sql) && assigned.has(threadId)) return { rows: [] };
        assigned.set(threadId, params[1]);
        return {
          rows: [{ email_thread_id: threadId, assigned_user_id: params[1], subject: threads.get(threadId).subject, participants: [] }],
        };
      }
      if (/UPDATE email_thread t SET work_status/.test(sql)) {
        const threadId = params[0];
        if (!threads.has(threadId)) return { rows: [] };
        return {
          rows: [{ email_thread_id: threadId, work_status: params[1], subject: threads.get(threadId).subject, participants: [] }],
        };
      }
      if (/UPDATE email_thread t SET visibility=/.test(sql)) {
        const threadId = params[0];
        if (!threads.has(threadId)) return { rows: [] };
        threads.get(threadId).visibility = params[1];
        return {
          rows: [{ email_thread_id: threadId, visibility: params[1], subject: threads.get(threadId).subject, participants: [] }],
        };
      }
      return { rows: [] };
    },
  };
}

function appWith(client) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.identityDb = async (fn) => fn(client);
    next();
  });
  app.use(router);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));
  return app;
}

// supertest's Test only exposes `.set` once a verb is chosen, so the verb is
// selected first and the actor header rides on the chained request.
const as = (client, id) => ({
  post: (path) => request(appWith(client)).post(path).set("x-user-id", id),
  patch: (path) => request(appWith(client)).patch(path).set("x-user-id", id),
});

/* ── The claim race ───────────────────────────────────────────────────────── */

describe("two agents claim the same thread at once", () => {
  const client = sharedClient({ visibleTo: new Set(["u-marie", "u-jules", "u-owner"]) });

  test("exactly one wins; the loser hears ALREADY_CLAIMED, not a silent overwrite", async () => {
    const [a, b] = await Promise.all([
      as(client, "u-marie").post("/threads/t-1/claim"),
      as(client, "u-jules").post("/threads/t-1/claim"),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    expect(winner.body.data.assigned_user_id).toMatch(/^u-(marie|jules)$/);
    expect(loser.body.code).toBe("ALREADY_CLAIMED");
  });

  test("the race is won by a conditional UPDATE, not a read-then-write", () => {
    // The mechanism the race depends on lives in the SQL itself: one statement
    // whose WHERE carries the "still unclaimed" guard. A read-then-write —
    // SELECT the row, check, then UPDATE — would let both claimants win, and
    // every claim UPDATE must carry the guard.
    const claims = client.written(/UPDATE email_thread t SET assigned_user_id/);
    expect(claims.length).toBeGreaterThanOrEqual(2);
    for (const c of claims) expect(c.text).toMatch(/assigned_user_id IS NULL/);
    // And no claim path pre-read the row with a bare SELECT of the assignment —
    // the only read is the visibility-gated getThread.
    const bareReads = client.written(/SELECT .*assigned_user_id/);
    expect(bareReads).toHaveLength(0);
  });

  test("the claim response crosses the citext boundary as an array (FN-1)", () => {
    // The route must keep casting participants to ::text[] on the way out; the
    // raw driver value is a Postgres array literal string.
    const claims = client.written(/UPDATE email_thread t SET assigned_user_id/);
    for (const c of claims) expect(c.text).toMatch(/participants::text\[\] AS participants/);
  });
});

/* ── Claim is a read, and reads are visibility-gated (§9.5) ───────────────── */

describe("the triage writes that RETURN the thread are visibility-gated", () => {
  test("claim on a thread the caller cannot see is a 404 and writes nothing", async () => {
    const client = sharedClient();
    const res = await as(client, "u-intruder").post("/threads/t-private/claim");
    expect(res.status).toBe(404);
    expect(client.written(/UPDATE email_thread/)).toHaveLength(0);
  });

  test("claim on a thread that does not exist is a 404, not ALREADY_CLAIMED", async () => {
    const client = sharedClient();
    const res = await as(client, "u-owner").post("/threads/t-missing/claim");
    expect(res.status).toBe(404);
  });

  test("the claim UPDATE itself carries the visibility predicate", async () => {
    const client = sharedClient({ visibleTo: new Set(["u-owner", "u-marie"]) });
    await as(client, "u-marie").post("/threads/t-1/claim");
    const sql = client.written(/UPDATE email_thread t SET assigned_user_id/)[0].text;
    expect(sql).toMatch(/t\.visibility = 'COMPANY'/);
    expect(sql).toMatch(/email_thread_share/);
    expect(sql).toMatch(/c\.owner_user_id/);
  });

  test("assign is gated the same way — an invisible thread answers 404", async () => {
    const client = sharedClient();
    const res = await as(client, "u-intruder").post("/threads/t-private/assign").send({ user_id: "u-marie" });
    expect(res.status).toBe(404);
    expect(client.written(/UPDATE email_thread/)).toHaveLength(0);
  });

  test("assign overwrites the existing assignee for a caller who can see it", async () => {
    const client = sharedClient();
    const res = await as(client, "u-owner").post("/threads/t-1/assign").send({ user_id: "u-marie" });
    expect(res.status).toBe(200);
    expect(res.body.data.assigned_user_id).toBe("u-marie");
  });

  test("status is gated the same way and sets the work status", async () => {
    const client = sharedClient();
    const no = await as(client, "u-intruder").post("/threads/t-private/status").send({ status: "RESOLVED" });
    expect(no.status).toBe(404);

    const yes = await as(client, "u-owner").post("/threads/t-1/status").send({ status: "RESOLVED" });
    expect(yes.status).toBe(200);
    expect(yes.body.data.work_status).toBe("RESOLVED");
  });

  test("visibility cannot be widened by someone who cannot already see the thread", async () => {
    const client = sharedClient();
    const no = await as(client, "u-intruder").patch("/threads/t-private/visibility").send({ visibility: "TEAM" });
    expect(no.status).toBe(404);
    expect(client.written(/UPDATE email_thread t SET visibility=/)).toHaveLength(0);

    const yes = await as(client, "u-owner").patch("/threads/t-private/visibility").send({ visibility: "TEAM" });
    expect(yes.status).toBe(200);
    expect(yes.body.data.visibility).toBe("TEAM");
  });
});
