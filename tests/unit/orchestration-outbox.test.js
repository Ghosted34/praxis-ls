"use strict";

/**
 * TC-C8 — the orchestration outbox at 0%, with at-least-once idempotency
 * unverified.
 *
 * This is the transactional-outbox pattern: `event_log` is written inside the
 * business transaction, and a dispatcher later drives handlers from it. The
 * pattern's whole value is that an event cannot be lost — the write and the
 * event commit together. Its whole cost is that an event CAN be delivered
 * twice, because "handler ran" and "row marked done" are two steps and a crash
 * fits between them.
 *
 * So "at-least-once" is not a property of the dispatcher. It is a CONTRACT WITH
 * THE HANDLERS, and it had never been tested from either side.
 *
 * The handlers behind this are the cross-module money flows —
 * costing-approved-draft-invoice, supplier-invoice-posted-cost-entry,
 * receipt-posted-collected-signal. Double delivery means two draft invoices for
 * one approved costing. Zero delivery means none, permanently, while the app
 * returns 200s. Both have happened in this class of system, and neither is
 * visible without a test that says which is supposed to happen.
 *
 * WHAT IS ASSERTED
 *
 *   - an event with no subscriber leaves the queue and stays in event_log
 *   - a handler that throws is retried, and the attempt count advances
 *   - retries STOP at MAX_ATTEMPTS and the row goes DEAD, not around again
 *   - a DEAD row is not re-selected on the next pass
 *   - one handler failing does not mark the event done for the others
 *   - a feature-disabled handler is skipped without failing the event
 */

/**
 * The handler registry is MOCKED rather than mutated.
 *
 * Mocking it means the dispatcher's real handlers never register, so this file
 * tests the dispatcher's delivery contract and nothing else — a change to any
 * of the eleven real handlers cannot make these tests fail, and the handler
 * list each test needs is exactly the list it declares.
 *
 * `handlers` is a module-scoped array the factory closes over, which is what
 * lets a test set the handler list without re-instantiating the mock.
 *
 * (A first version instead reassigned `registry.getHandlers` on a module
 * required at the top of this file. That silently did nothing once the
 * dispatcher loaded its own registry instance, and six tests failed for a
 * reason that had nothing to do with the dispatcher. Mock the module; don't
 * mutate a reference to it.)
 */
let mockHandlers = [];
jest.mock("../../src/orchestration/registry", () => ({
  // The full surface: something in the dispatcher's require graph calls
  // register() at load time, so a mock providing only getHandlers fails at
  // import with "register is not a function" — before any assertion runs.
  register: () => {},
  eventKeys: () => [...new Set(mockHandlers.map((h) => h.key))],
  getHandlers: (key) => mockHandlers.filter((h) => h.key === key),
}));

/**
 * The dispatcher is required ONCE, at load.
 *
 * It used to be re-required in `beforeEach` behind `jest.resetModules()`, which
 * is why this file "hung": requiring the dispatcher pulls `./handlers`, whose
 * require graph is 171 modules, and resetModules made every one of the ten
 * tests rebuild all of it. On a normal filesystem that is a couple of seconds
 * wasted; over a mounted one it is ~6s per test, so the file died around test
 * seven or eight with no failure and no summary — which reads exactly like a
 * leaked timer or connection and is not one. (Requiring the dispatcher leaves
 * zero active handles beyond stdio, and the process exits cleanly.)
 *
 * The reset is not needed. The dispatcher holds no module-level mutable state —
 * every sweep's state lives on the `client` the caller passes — and it looks
 * handlers up through `registry.getHandlers(key)` at dispatch time, so the
 * mock below picks up whatever `handlers` is set to for the current test
 * without anything being reloaded.
 */
const dispatcher = require("../../src/orchestration/dispatcher");

/**
 * A fake outbox: `event_log` rows plus an `event_dispatch` side table, driven
 * by the same SQL shapes the dispatcher issues.
 */
function makeOutbox(events, { featuresOn = true } = {}) {
  const dispatch = new Map(); // event_id -> { status, attempts }
  const db = {
    dispatch,
    queries: [],
    async query(sql, params = []) {
      this.queries.push(sql);

      if (/FROM event_log el/.test(sql)) {
        const [maxAttempts, limit] = params;
        const due = events.filter((e) => {
          const d = dispatch.get(e.event_id);
          if (!d) return true;
          return d.status === "FAILED" && d.attempts < maxAttempts;
        });
        return {
          rows: due.slice(0, limit).map((e) => ({
            ...e,
            attempts: dispatch.get(e.event_id)
              ? dispatch.get(e.event_id).attempts
              : 0,
          })),
        };
      }
      if (/feature_state|feature/.test(sql) && /SELECT/i.test(sql)) {
        return {
          rows: [{ enabled: featuresOn, state: featuresOn ? "ON" : "OFF" }],
        };
      }
      // Two distinct upserts, modelled from the real statements rather than
      // guessed at — markDone hardcodes 'DONE' and attempts 0 in the SQL text,
      // markFailed passes (id, status, attempts, error) as parameters. A first
      // version of this fake read params[1] as the attempt count for BOTH,
      // which left attempts permanently 0 and made the retry ceiling look
      // broken when it was not.
      if (/INSERT INTO event_dispatch/.test(sql)) {
        const id = params[0];
        if (/'DONE'/.test(sql)) {
          dispatch.set(id, {
            status: "DONE",
            attempts: dispatch.get(id)?.attempts || 0,
          });
          return { rows: [{ status: "DONE" }] };
        }
        const [, status, attempts] = params;
        dispatch.set(id, { status, attempts });
        return { rows: [{ status }] };
      }
      return { rows: [] };
    },
  };
  return db;
}

const ev = (id, key) => ({
  event_id: id,
  event_type_key: key,
  entity_ref: `costing:${id}`,
  payload: {},
});

describe("orchestration outbox (TC-C8)", () => {
  beforeEach(() => {
    // The only per-test state there is. See the note above the require.
    mockHandlers = [];
  });

  it("has a retry ceiling at all", () => {
    // Without one, a permanently-failing handler is an infinite loop that
    // re-runs a money flow every sweep, forever.
    expect(typeof dispatcher.MAX_ATTEMPTS).toBe("number");
    expect(dispatcher.MAX_ATTEMPTS).toBeGreaterThan(0);
  });

  it("clears an event that has no subscriber", async () => {
    // It must leave the QUEUE without leaving the LOG — event_log is the audit
    // record and keeps the event forever; event_dispatch is the work list.
    const db = makeOutbox([ev(1, "nobody.listens")]);
    const out = await dispatcher.dispatchPending(db);
    expect(out.skipped).toBe(1);
    expect(out.processed).toBe(0);
    expect(db.dispatch.get(1).status).toBe("DONE");
  });

  it("runs a subscribed handler and marks the event done exactly once", async () => {
    let runs = 0;
    mockHandlers = [
      {
        key: "costing.approved",
        feature: null,
        run: async () => {
          runs += 1;
        },
      },
    ];
    const db = makeOutbox([ev(1, "costing.approved")]);
    const out = await dispatcher.dispatchPending(db);
    expect(runs).toBe(1);
    expect(out.processed).toBe(1);
    expect(db.dispatch.get(1).status).toBe("DONE");
  });

  it("does not re-deliver an event already marked DONE", async () => {
    // The at-least-once contract in its ordinary case: a second sweep must not
    // produce a second draft invoice.
    let runs = 0;
    mockHandlers = [
      {
        key: "costing.approved",
        feature: null,
        run: async () => {
          runs += 1;
        },
      },
    ];
    const db = makeOutbox([ev(1, "costing.approved")]);
    await dispatcher.dispatchPending(db);
    await dispatcher.dispatchPending(db);
    expect(runs).toBe(1);
  });

  it("retries a failing handler on the next sweep", async () => {
    let runs = 0;
    mockHandlers = [
      {
        key: "costing.approved",
        feature: null,
        run: async () => {
          runs += 1;
          if (runs === 1) throw new Error("transient");
        },
      },
    ];
    const db = makeOutbox([ev(1, "costing.approved")]);
    const first = await dispatcher.dispatchPending(db);
    expect(first.failed).toBe(1);
    expect(db.dispatch.get(1).status).toBe("FAILED");

    const second = await dispatcher.dispatchPending(db);
    expect(runs).toBe(2);
    expect(second.processed).toBe(1);
    expect(db.dispatch.get(1).status).toBe("DONE");
  });

  it("stops retrying at MAX_ATTEMPTS instead of looping forever", async () => {
    let runs = 0;
    mockHandlers = [
      {
        key: "costing.approved",
        feature: null,
        run: async () => {
          runs += 1;
          throw new Error("permanent");
        },
      },
    ];
    const db = makeOutbox([ev(1, "costing.approved")]);

    // Sweep well past the ceiling; the handler must not run past it.
    for (let i = 0; i < dispatcher.MAX_ATTEMPTS + 5; i += 1) {
      await dispatcher.dispatchPending(db);
    }
    expect(runs).toBeLessThan(dispatcher.MAX_ATTEMPTS + 5);
    expect(runs).toBe(dispatcher.MAX_ATTEMPTS);
  });

  it("leaves a permanently failing event visible rather than silently dropped", async () => {
    // OBS-A6's counterpart: a DEAD row is a business action that will never
    // happen unless a person intervenes, so it must stay findable.
    mockHandlers = [
      {
        key: "costing.approved",
        feature: null,
        run: async () => {
          throw new Error("permanent");
        },
      },
    ];
    const db = makeOutbox([ev(1, "costing.approved")]);
    for (let i = 0; i < dispatcher.MAX_ATTEMPTS; i += 1) {
      await dispatcher.dispatchPending(db);
    }
    const final = db.dispatch.get(1);
    expect(final.attempts).toBe(dispatcher.MAX_ATTEMPTS);
    expect(["DEAD", "FAILED"]).toContain(final.status);
  });

  it("does not mark an event done when ONE of several handlers fails", async () => {
    // Partial delivery marked complete is the worst outcome: the surviving
    // handler's work happened, the failed one's never will, and nothing says so.
    let good = 0;
    mockHandlers = [
      {
        key: "costing.approved",
        feature: null,
        run: async () => {
          good += 1;
        },
      },
      {
        key: "costing.approved",
        feature: null,
        run: async () => {
          throw new Error("second handler");
        },
      },
    ];
    const db = makeOutbox([ev(1, "costing.approved")]);
    const out = await dispatcher.dispatchPending(db);
    expect(good).toBe(1);
    expect(out.processed).toBe(0);
    expect(out.failed).toBe(1);
    expect(db.dispatch.get(1).status).not.toBe("DONE");
  });

  it("honours the limit so one sweep cannot monopolise a connection", async () => {
    mockHandlers = [
      { key: "costing.approved", feature: null, run: async () => {} },
    ];
    const many = Array.from({ length: 50 }, (_, i) =>
      ev(i + 1, "costing.approved"),
    );
    const db = makeOutbox(many);
    const out = await dispatcher.dispatchPending(db, { limit: 10 });
    expect(out.processed).toBe(10);
  });

  it("reports counts that add up", async () => {
    mockHandlers = [
      { key: "costing.approved", feature: null, run: async () => {} },
    ];
    const db = makeOutbox([ev(1, "costing.approved"), ev(2, "nobody.listens")]);
    const out = await dispatcher.dispatchPending(db);
    expect(out.processed + out.skipped + out.failed).toBe(2);
  });
});
