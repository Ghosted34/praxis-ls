"use strict";

/**
 * TC-C7 — WMS/inventory at 7.3% functions, the largest fully-dark critical
 * domain: 44 files, every service at 0%, no `.rules.js` pure-math layer to test
 * instead.
 *
 * The audit's framing is the right one:
 *
 *   > Stock quantity is the data-integrity analogue of money: a double-decrement
 *   > or a lost movement is unrecoverable without a physical count.
 *
 * That makes a mock-shaped test almost worthless here. The three failures DATA
 * 5.1 describes — lost update, racy negative-stock guard, balance and journal
 * diverging — are all CONCURRENCY and ATOMICITY failures. A fake that returns
 * canned rows cannot express any of them, and would pass just as happily
 * against the broken read-modify-write version of `move()` as against the fixed
 * one. (TC-Q3 makes exactly this complaint about the regex SQL fakes elsewhere.)
 *
 * So this file does not mock the repo. It runs the REAL repo SQL against a
 * small in-memory Postgres that implements the four semantics the fix depends
 * on:
 *
 *   1. `SELECT … FOR UPDATE` takes a real per-row lock; a second reader waits.
 *   2. `SET qty_on_hand = qty_on_hand + $2` is applied to the STORED value at
 *      write time, not to a value the caller read earlier.
 *   3. `WHERE … AND qty_on_hand + $2 >= 0` matches zero rows and returns none.
 *   4. BEGIN/COMMIT/ROLLBACK are real: a rollback undoes writes, including the
 *      movement journal.
 *
 * With those in place, "two concurrent -6 moves against a stock of 10" is a
 * thing this file can actually DO, and the assertion is the final balance.
 *
 * The fake is deliberately strict: unrecognised SQL throws rather than
 * returning `{rows: []}`. A silent empty result is how a fake absorbs a query
 * change and keeps passing.
 */

// ── a small in-memory Postgres ───────────────────────────────────────────────

function makeDb(items = []) {
  return {
    items: new Map(items.map((r) => [r.inventory_item_id, { ...r }])),
    movements: [],
    softDeletes: [],
    users: new Set(["u-1"]), // app_user rows visible in THIS schema (DATA 2.4)
    locks: new Map(), // inventory_item_id -> promise chain tail
    lockWaits: 0, // how many times a reader actually had to wait
  };
}

/** One pooled connection. Several of these share one `db`, which is the point. */
function makeClient(db, name = "c1") {
  let inTx = false;
  let undo = null; // [{ id, prev }] captured at write time
  let myMovements = null; // journal rows THIS transaction appended
  let held = []; // [{ id, release }]

  function releaseLocks() {
    for (const h of held) h.release();
    held = [];
  }

  /**
   * Row locks are RE-ENTRANT within a transaction, as Postgres's are: a
   * transaction that already holds a row lock may take it again freely. Without
   * that, two `move()` calls nested inside one `atomically()` block deadlock the
   * connection against itself — a fixture defect that looks exactly like a
   * product bug.
   */
  async function acquire(id) {
    if (held.some((h) => h.id === id)) return;
    const tail = db.locks.get(id);
    let release;
    const next = new Promise((res) => {
      release = res;
    });
    db.locks.set(id, tail ? tail.then(() => next) : next);
    if (tail) {
      db.lockWaits += 1;
      await tail;
    }
    held.push({ id, release });
  }

  return {
    name,
    sql: [],
    async query(text, params = []) {
      const t = String(text).trim().replace(/\s+/g, " ");
      this.sql.push({ text: t, params });

      // ── transaction control ──
      if (/^BEGIN/i.test(t)) {
        if (inTx) throw new Error("nested BEGIN — the depth counter failed");
        inTx = true;
        undo = [];
        myMovements = [];
        return { rows: [] };
      }
      if (/^COMMIT/i.test(t)) {
        if (!inTx) throw new Error("COMMIT outside a transaction");
        inTx = false;
        undo = null;
        myMovements = null;
        releaseLocks();
        return { rows: [] };
      }
      if (/^ROLLBACK/i.test(t)) {
        if (!inTx) throw new Error("ROLLBACK outside a transaction");
        for (const u of undo.reverse()) {
          if (u.prev === null) db.items.delete(u.id);
          else db.items.set(u.id, u.prev);
        }
        // Undo THIS transaction's journal rows by identity, not by truncating
        // to a high-water mark. A mark taken at BEGIN is wrong the moment a
        // second connection commits while this one is waiting on a row lock —
        // it would roll back the OTHER transaction's committed work. Getting
        // this wrong made a concurrency test fail for a reason that had nothing
        // to do with the code under test, which is precisely the fixture defect
        // the handoff warns about.
        for (const m of myMovements) {
          const at = db.movements.indexOf(m);
          if (at >= 0) db.movements.splice(at, 1);
        }
        inTx = false;
        undo = null;
        myMovements = null;
        releaseLocks();
        return { rows: [] };
      }
      // shared/db/tx.js probes with a SAVEPOINT: legal only inside a
      // transaction block, 25P01 outside one. That probe is how it detects a
      // BEGIN someone else opened.
      if (/^SAVEPOINT/i.test(t)) {
        if (!inTx) {
          const e = new Error(
            "SAVEPOINT can only be used in transaction blocks",
          );
          e.code = "25P01";
          throw e;
        }
        return { rows: [] };
      }
      if (/^RELEASE SAVEPOINT/i.test(t)) return { rows: [] };

      const snapshot = (id) => {
        if (!inTx) return;
        if (!undo.some((u) => u.id === id)) {
          const cur = db.items.get(id);
          undo.push({ id, prev: cur ? { ...cur } : null });
        }
      };

      // ── inventory_item ──
      if (
        /^SELECT \* FROM inventory_item WHERE "?inventory_item_id"? = \$1 FOR UPDATE$/i.test(
          t,
        )
      ) {
        await acquire(params[0]);
        const row = db.items.get(params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (
        /^SELECT \* FROM inventory_item WHERE "?inventory_item_id"? = \$1$/i.test(
          t,
        )
      ) {
        const row = db.items.get(params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (
        /^UPDATE inventory_item SET .* WHERE inventory_item_id = \$1 AND qty_on_hand \+ \$2 >= 0 RETURNING \*$/i.test(
          t,
        )
      ) {
        const [id, delta] = params;
        const row = db.items.get(id);
        if (!row) return { rows: [] };
        // The floor is checked against the STORED value under the lock.
        if (Number(row.qty_on_hand) + Number(delta) < 0) return { rows: [] };
        snapshot(id);
        const next = {
          ...row,
          qty_on_hand: Number(row.qty_on_hand) + Number(delta),
          updated_at: new Date(),
        };
        if (/location_id = \$3/.test(t)) next.location_id = params[2];
        db.items.set(id, next);
        return { rows: [{ ...next }] };
      }
      if (
        /^UPDATE inventory_item SET .* WHERE "?inventory_item_id"? = \$\d+ RETURNING \*$/i.test(
          t,
        )
      ) {
        // makeRepo's generic patch update (used by setState). It quotes its
        // identifiers and binds the pk as $1, so the id must be read from the
        // WHERE placeholder rather than assumed to be the last parameter.
        const id =
          params[
            Number(t.match(/WHERE "?inventory_item_id"? = \$(\d+)/i)[1]) - 1
          ];
        const row = db.items.get(id);
        if (!row) return { rows: [] };
        snapshot(id);
        const next = { ...row };
        t.match(/SET (.*?) WHERE/i)[1]
          .split(", ")
          .forEach((c) => {
            const mm = c.match(/^"?([a-z_]+)"? = \$(\d+)$/i);
            if (mm) next[mm[1]] = params[Number(mm[2]) - 1];
          });
        db.items.set(id, next);
        return { rows: [{ ...next }] };
      }

      // ── app_user (DATA 2.4) ──
      // resolveActorId re-reads the actor from app_user IN THE SCHEMA BEING
      // WRITTEN, because identity is pinned to `live` and this write may land
      // in `sandbox`, where that user does not exist. Modelling the table is
      // what lets a test tell "guard applied" from "guard skipped".
      if (/^SELECT user_id FROM app_user WHERE user_id = \$1$/i.test(t)) {
        return {
          rows: db.users.has(params[0]) ? [{ user_id: params[0] }] : [],
        };
      }

      // ── stock_movement (append-only journal) ──
      if (/^INSERT INTO stock_movement \(/i.test(t)) {
        const cols = t
          .match(/\(([^)]*)\) VALUES/)[1]
          .split(", ")
          .map((c) => c.replace(/"/g, ""));
        const row = {
          stock_movement_id: `mv-${db.movements.length + 1}`,
          moved_at: new Date(),
        };
        cols.forEach((c, i) => {
          row[c] = params[i];
        });
        db.movements.push(row);
        if (inTx) myMovements.push(row);
        return { rows: [row] };
      }
      if (
        /^SELECT \* FROM stock_movement WHERE inventory_item_id = \$1/i.test(t)
      ) {
        return {
          rows: db.movements.filter((m) => m.inventory_item_id === params[0]),
        };
      }
      if (/^INSERT INTO soft_delete/i.test(t)) {
        db.softDeletes.push(params);
        return { rows: [] };
      }

      // Strict on purpose. See the header.
      throw new Error(`unrecognised SQL in the inventory fake: ${t}`);
    },
  };
}

// Events and audit are the module's outbound edges, not the subject.
const mockEmitted = [];
const mockAudited = [];
let mockEmitFails = false;

/**
 * app_user rows visible in the schema being written (DATA 2.4).
 *
 * `resolveActorId` is the guard that stops a LIVE user id being written into a
 * SANDBOX actor FK, where that user does not exist and Postgres raises 23503.
 * Stubbing it to `null` would have made every actor column null and asserted
 * nothing — so the stub does the real thing against this set, and a test can
 * empty it to prove the guard is what produces the null.
 */
let mockUsersInSchema = new Set(["u-1"]);

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: async (c, e) => {
    if (mockEmitFails) throw new Error("event_log write failed");
    mockEmitted.push(e);
  },
  audit: async (c, a) => {
    mockAudited.push(a);
  },
  resolveActorId: async (c, userId) =>
    userId && mockUsersInSchema.has(userId) ? userId : null,
  clearEventTypeCache: () => {},
  WATCHER_ROLE_CODES: [],
}));

const inventory = require("../../src/modules/wms/inventory/inventory.service");
const outbound = require("../../src/modules/wms/outbound/outbound.service");

const ACTOR = { user_id: "u-1" };
const item = (over = {}) => ({
  inventory_item_id: "i-1",
  sku: "SKU-1",
  qty_on_hand: 10,
  state: "AVAILABLE",
  location_id: "loc-a",
  created_at: new Date(),
  updated_at: new Date(),
  ...over,
});

async function rejection(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection, the call resolved");
}

describe("WMS inventory (TC-C7)", () => {
  let db;
  let client;

  beforeEach(() => {
    db = makeDb([item()]);
    client = makeClient(db);
    mockEmitted.length = 0;
    mockAudited.length = 0;
    mockEmitFails = false;
    mockUsersInSchema = new Set(["u-1"]);
  });

  describe("the movement journal and the balance move together (DATA 5.1)", () => {
    it("applies a positive delta and writes exactly one movement", async () => {
      const row = await inventory.move(client, {
        id: "i-1",
        movement_kind: "RECEIPT",
        qty: 5,
        actor: ACTOR,
      });
      expect(row.qty_on_hand).toBe(15);
      expect(db.items.get("i-1").qty_on_hand).toBe(15);
      expect(db.movements).toHaveLength(1);
      expect(db.movements[0]).toMatchObject({
        inventory_item_id: "i-1",
        movement_kind: "RECEIPT",
        qty: 5,
        moved_by: "u-1",
      });
    });

    it("applies a negative delta", async () => {
      const row = await inventory.move(client, {
        id: "i-1",
        movement_kind: "ISSUE",
        qty: -4,
        actor: ACTOR,
      });
      expect(row.qty_on_hand).toBe(6);
      expect(db.movements[0].qty).toBe(-4);
    });

    it("wraps the whole move in ONE transaction", async () => {
      await inventory.move(client, {
        id: "i-1",
        movement_kind: "ISSUE",
        qty: -1,
        actor: ACTOR,
      });
      const begins = client.sql.filter((s) => /^BEGIN/.test(s.text));
      const commits = client.sql.filter((s) => /^COMMIT/.test(s.text));
      expect(begins).toHaveLength(1);
      expect(commits).toHaveLength(1);
      // …and the balance write happens inside it.
      const beginAt = client.sql.findIndex((s) => /^BEGIN/.test(s.text));
      const updateAt = client.sql.findIndex((s) =>
        /^UPDATE inventory_item/.test(s.text),
      );
      const commitAt = client.sql.findIndex((s) => /^COMMIT/.test(s.text));
      expect(beginAt).toBeLessThan(updateAt);
      expect(updateAt).toBeLessThan(commitAt);
    });

    it("takes the row lock BEFORE computing anything", async () => {
      await inventory.move(client, {
        id: "i-1",
        movement_kind: "ISSUE",
        qty: -1,
        actor: ACTOR,
      });
      const lockAt = client.sql.findIndex((s) => /FOR UPDATE/.test(s.text));
      const updateAt = client.sql.findIndex((s) =>
        /^UPDATE inventory_item/.test(s.text),
      );
      expect(lockAt).toBeGreaterThanOrEqual(0);
      expect(lockAt).toBeLessThan(updateAt);
    });

    it("derives the new balance IN SQL rather than writing an absolute value", async () => {
      // The distinction the fix turns on. An absolute write is what made two
      // concurrent moves lose one of them.
      await inventory.move(client, {
        id: "i-1",
        movement_kind: "ISSUE",
        qty: -3,
        actor: ACTOR,
      });
      const update = client.sql.find((s) =>
        /^UPDATE inventory_item SET qty_on_hand/.test(s.text),
      );
      expect(update.text).toMatch(/qty_on_hand = qty_on_hand \+ \$2/);
      expect(update.params[1]).toBe(-3); // the DELTA is the parameter, not the result
    });

    it("ROLLS BACK the balance when the journal write fails", async () => {
      // Failure 3: the quantity change used to be already committed, and
      // because qty_on_hand is absolute rather than derived there was no way to
      // detect or reconstruct it afterwards.
      const broken = makeClient(db, "broken");
      const realQuery = broken.query.bind(broken);
      broken.query = async (t, p) => {
        if (/^INSERT INTO stock_movement/i.test(String(t).trim()))
          throw new Error("journal write failed");
        return realQuery(t, p);
      };
      await rejection(
        inventory.move(broken, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -4,
          actor: ACTOR,
        }),
      );

      expect(db.items.get("i-1").qty_on_hand).toBe(10); // untouched
      expect(db.movements).toHaveLength(0);
      expect(broken.sql.some((s) => /^ROLLBACK/.test(s.text))).toBe(true);
    });

    it("ROLLS BACK the balance and the journal when the event write fails", async () => {
      // event_log is written inside the business transaction (the outbox
      // pattern). If it cannot be written, the movement did not happen.
      mockEmitFails = true;
      await rejection(
        inventory.move(client, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -4,
          actor: ACTOR,
        }),
      );
      expect(db.items.get("i-1").qty_on_hand).toBe(10);
      expect(db.movements).toHaveLength(0);
    });

    it("returns null for an unknown item without opening a write", async () => {
      const out = await inventory.move(client, {
        id: "nope",
        movement_kind: "ISSUE",
        qty: -1,
        actor: ACTOR,
      });
      expect(out).toBeNull();
      expect(db.movements).toHaveLength(0);
    });

    it("records the origin location when the caller does not supply one", async () => {
      // Otherwise the journal cannot say where the stock came from, which is
      // the whole point of a movement row.
      await inventory.move(client, {
        id: "i-1",
        movement_kind: "TRANSFER",
        qty: 0,
        to_location: "loc-b",
        actor: ACTOR,
      });
      expect(db.movements[0].from_location).toBe("loc-a");
      expect(db.movements[0].to_location).toBe("loc-b");
    });

    it("relocates the item as part of the same atomic move", async () => {
      await inventory.move(client, {
        id: "i-1",
        movement_kind: "TRANSFER",
        qty: -2,
        to_location: "loc-b",
        actor: ACTOR,
      });
      const row = db.items.get("i-1");
      expect(row.location_id).toBe("loc-b");
      expect(row.qty_on_hand).toBe(8);
    });

    it("resolves the actor through the FK guard before writing moved_by (DATA 2.4)", async () => {
      // `moved_by` is REFERENCES app_user(user_id). Identity is pinned to the
      // LIVE schema while this write lands in whichever schema the request
      // selected, so the raw id used to raise 23503 here — and, before DATA 5.1
      // made this transactional, the balance had ALREADY committed when it did.
      await inventory.move(client, {
        id: "i-1",
        movement_kind: "ISSUE",
        qty: -1,
        actor: ACTOR,
      });
      expect(db.movements[0].moved_by).toBe("u-1");
    });

    it("writes a NULL actor rather than failing when the user is absent from this schema", async () => {
      // The sandbox case. Losing an attribution is a far smaller harm than
      // failing the stock movement it describes — and the movement row must
      // still be written.
      mockUsersInSchema = new Set();
      const row = await inventory.move(client, {
        id: "i-1",
        movement_kind: "ISSUE",
        qty: -1,
        actor: ACTOR,
      });
      expect(row.qty_on_hand).toBe(9);
      expect(db.movements).toHaveLength(1);
      expect(db.movements[0].moved_by).toBeNull();
    });

    it("emits and audits once, inside the transaction", async () => {
      await inventory.move(client, {
        id: "i-1",
        movement_kind: "ISSUE",
        qty: -1,
        actor: ACTOR,
      });
      expect(mockEmitted).toHaveLength(1);
      expect(mockEmitted[0]).toMatchObject({
        entityRef: "inventory:i-1",
        actorUserId: "u-1",
      });
      expect(mockAudited).toHaveLength(1);
      expect(mockAudited[0].before.qty_on_hand).toBe(10);
      expect(mockAudited[0].after.qty_on_hand).toBe(9);
    });
  });

  describe("the negative-stock floor", () => {
    it("refuses a move that would drive the balance below zero", async () => {
      const err = await rejection(
        inventory.move(client, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -11,
          actor: ACTOR,
        }),
      );
      expect(err.code).toBe("NEGATIVE_STOCK");
      expect(err.status).toBe(422);
      expect(db.items.get("i-1").qty_on_hand).toBe(10);
      expect(db.movements).toHaveLength(0);
    });

    it("allows a move to exactly zero", async () => {
      const row = await inventory.move(client, {
        id: "i-1",
        movement_kind: "ISSUE",
        qty: -10,
        actor: ACTOR,
      });
      expect(row.qty_on_hand).toBe(0);
    });

    it("enforces the floor in the WHERE clause, not in JavaScript", async () => {
      // Failure 2: a JS-side guard ran before the lock, so two concurrent -6
      // moves against 10 both passed it.
      await rejection(
        inventory.move(client, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -99,
          actor: ACTOR,
        }),
      );
      const update = client.sql.find((s) =>
        /^UPDATE inventory_item SET qty_on_hand/.test(s.text),
      );
      expect(update.text).toMatch(/AND qty_on_hand \+ \$2 >= 0/);
    });

    it("reports the balance the DATABASE held, not one read earlier", async () => {
      const err = await rejection(
        inventory.move(client, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -11,
          actor: ACTOR,
        }),
      );
      expect(err.message).toContain("10");
      expect(err.message).toContain("-11");
    });
  });

  describe("concurrency — the failures a canned fake cannot express", () => {
    it("does not LOSE an update when two moves race the same item", async () => {
      // The original bug, exactly: both read 10, one wrote 5, the other wrote 7,
      // final answer 7 instead of 2 — and both movement rows were written, so it
      // was undetectable afterwards.
      const a = makeClient(db, "a");
      const b = makeClient(db, "b");
      await Promise.all([
        inventory.move(a, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -5,
          actor: ACTOR,
        }),
        inventory.move(b, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -3,
          actor: ACTOR,
        }),
      ]);
      expect(db.items.get("i-1").qty_on_hand).toBe(2); // 10 - 5 - 3
      expect(db.movements).toHaveLength(2);
      expect(db.lockWaits).toBeGreaterThan(0); // they genuinely serialised
    });

    it("lets only ONE of two racing moves through when both cannot fit", async () => {
      // Two concurrent -6 against 10. Under the old JS-side guard both passed
      // and the balance went to -2.
      const a = makeClient(db, "a");
      const b = makeClient(db, "b");
      const results = await Promise.allSettled([
        inventory.move(a, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -6,
          actor: ACTOR,
        }),
        inventory.move(b, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -6,
          actor: ACTOR,
        }),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].reason.code).toBe("NEGATIVE_STOCK");

      expect(db.items.get("i-1").qty_on_hand).toBe(4);
      expect(db.items.get("i-1").qty_on_hand).toBeGreaterThanOrEqual(0);
      expect(db.movements).toHaveLength(1); // the rejected one left no journal row
    });

    it("keeps the balance equal to the sum of the journal under load", async () => {
      // The invariant that makes stock reconstructable. Twenty interleaved
      // moves, then one comparison.
      const deltas = [
        5, -3, 8, -2, -6, 4, -1, 7, -9, 2, -4, 6, -5, 3, -2, 1, -1, 10, -8, 4,
      ];
      await Promise.all(
        deltas.map((d, i) =>
          inventory
            .move(makeClient(db, `w${i}`), {
              id: "i-1",
              movement_kind: "ADJUST",
              qty: d,
              actor: ACTOR,
            })
            .catch((e) => {
              if (e.code !== "NEGATIVE_STOCK") throw e;
            }),
        ),
      );

      const journalSum = db.movements.reduce((s, m) => s + Number(m.qty), 0);
      expect(db.items.get("i-1").qty_on_hand).toBe(10 + journalSum);
      expect(db.items.get("i-1").qty_on_hand).toBeGreaterThanOrEqual(0);
    });

    it("does not serialise moves on DIFFERENT items", async () => {
      // FOR UPDATE must lock the row, not the table — otherwise every warehouse
      // operation in the tenant queues behind every other one.
      db = makeDb([item(), item({ inventory_item_id: "i-2", sku: "SKU-2" })]);
      await Promise.all([
        inventory.move(makeClient(db, "a"), {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -1,
          actor: ACTOR,
        }),
        inventory.move(makeClient(db, "b"), {
          id: "i-2",
          movement_kind: "ISSUE",
          qty: -1,
          actor: ACTOR,
        }),
      ]);
      expect(db.lockWaits).toBe(0);
      expect(db.items.get("i-1").qty_on_hand).toBe(9);
      expect(db.items.get("i-2").qty_on_hand).toBe(9);
    });

    it("releases the row lock when a move fails", async () => {
      // A lock held past a failure deadlocks the item for every later move.
      const a = makeClient(db, "a");
      await rejection(
        inventory.move(a, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -99,
          actor: ACTOR,
        }),
      );
      const row = await inventory.move(makeClient(db, "b"), {
        id: "i-1",
        movement_kind: "ISSUE",
        qty: -1,
        actor: ACTOR,
      });
      expect(row.qty_on_hand).toBe(9);
    });
  });

  describe("nested transactions join rather than commit early (DATA 5.2)", () => {
    it("does not issue a second BEGIN when already inside one", async () => {
      // Postgres has no nested transactions: an inner COMMIT would commit the
      // OUTER transaction, and the caller would believe it still held one.
      const { atomically } = require("../../src/shared/db/tx");
      await atomically(client, async () => {
        await inventory.move(client, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -1,
          actor: ACTOR,
        });
        await inventory.move(client, {
          id: "i-1",
          movement_kind: "ISSUE",
          qty: -2,
          actor: ACTOR,
        });
      });
      expect(client.sql.filter((s) => /^BEGIN/.test(s.text))).toHaveLength(1);
      expect(client.sql.filter((s) => /^COMMIT/.test(s.text))).toHaveLength(1);
      expect(db.items.get("i-1").qty_on_hand).toBe(7);
    });

    it("rolls BOTH nested moves back when the outer transaction fails", async () => {
      const { atomically } = require("../../src/shared/db/tx");
      await rejection(
        atomically(client, async () => {
          await inventory.move(client, {
            id: "i-1",
            movement_kind: "ISSUE",
            qty: -1,
            actor: ACTOR,
          });
          await inventory.move(client, {
            id: "i-1",
            movement_kind: "ISSUE",
            qty: -2,
            actor: ACTOR,
          });
          throw new Error("the caller changed its mind");
        }),
      );
      expect(db.items.get("i-1").qty_on_hand).toBe(10);
      expect(db.movements).toHaveLength(0);
    });
  });

  describe("the stock state machine", () => {
    const transitions = [
      ["AVAILABLE", "QA_HOLD", true],
      ["AVAILABLE", "ALLOCATED", true],
      ["AVAILABLE", "DAMAGED", true],
      ["AVAILABLE", "DISPATCHED", false],
      ["QA_HOLD", "AVAILABLE", true],
      ["QA_HOLD", "DAMAGED", true],
      ["QA_HOLD", "ALLOCATED", false],
      ["ALLOCATED", "DISPATCHED", true],
      ["ALLOCATED", "AVAILABLE", true],
      ["ALLOCATED", "QA_HOLD", false],
      ["DAMAGED", "AVAILABLE", true],
      ["DAMAGED", "ALLOCATED", false],
      ["DISPATCHED", "AVAILABLE", false],
      ["DISPATCHED", "ALLOCATED", false],
    ];

    it("permits exactly the transitions the table declares, and no others", async () => {
      for (const [from, to, allowed] of transitions) {
        db = makeDb([item({ state: from })]);
        const c = makeClient(db);
        if (allowed) {
          const row = await inventory.setState(c, {
            id: "i-1",
            state: to,
            actor: ACTOR,
          });
          expect(row.state).toBe(to);
        } else {
          const err = await rejection(
            inventory.setState(c, { id: "i-1", state: to, actor: ACTOR }),
          );
          expect(err.code).toBe("INVALID_TRANSITION");
          expect(err.status).toBe(422);
        }
      }
    });

    it("makes DISPATCHED terminal", async () => {
      // Stock that has left the building cannot come back by a status edit; it
      // comes back as a RETURN movement with its own journal row.
      for (const to of ["AVAILABLE", "QA_HOLD", "ALLOCATED", "DAMAGED"]) {
        db = makeDb([item({ state: "DISPATCHED" })]);

        const err = await rejection(
          inventory.setState(makeClient(db), {
            id: "i-1",
            state: to,
            actor: ACTOR,
          }),
        );
        expect(err.code).toBe("INVALID_TRANSITION");
      }
    });

    it("rejects a state that is not in the machine at all", async () => {
      const err = await rejection(
        inventory.setState(client, {
          id: "i-1",
          state: "TELEPORTED",
          actor: ACTOR,
        }),
      );
      expect(err.code).toBe("INVALID_TRANSITION");
    });

    it("returns null for an unknown item rather than inventing a transition", async () => {
      expect(
        await inventory.setState(client, {
          id: "nope",
          state: "QA_HOLD",
          actor: ACTOR,
        }),
      ).toBeNull();
    });

    it("audits the before and after state", async () => {
      await inventory.setState(client, {
        id: "i-1",
        state: "QA_HOLD",
        actor: ACTOR,
      });
      expect(mockAudited[0].before.state).toBe("AVAILABLE");
      expect(mockAudited[0].after.state).toBe("QA_HOLD");
    });

    it("does not change the quantity", async () => {
      await inventory.setState(client, {
        id: "i-1",
        state: "ALLOCATED",
        actor: ACTOR,
      });
      expect(db.items.get("i-1").qty_on_hand).toBe(10);
      expect(db.movements).toHaveLength(0);
    });
  });

  describe("outbound order lifecycle", () => {
    function outboundDb(status = "CREATED") {
      const orders = new Map([
        ["o-1", { outbound_order_id: "o-1", status, dispatched_at: null }],
      ]);
      const lines = new Map();
      return {
        orders,
        lines,
        client: {
          sql: [],
          async query(text, params = []) {
            const t = String(text).trim().replace(/\s+/g, " ");
            this.sql.push({ text: t, params });
            if (
              /^SELECT \* FROM outbound_order WHERE "?outbound_order_id"? = \$1$/i.test(
                t,
              )
            ) {
              const o = orders.get(params[0]);
              return { rows: o ? [{ ...o }] : [] };
            }
            if (/^UPDATE outbound_order SET/i.test(t)) {
              const id =
                params[
                  Number(t.match(/WHERE "?outbound_order_id"? = \$(\d+)/i)[1]) -
                    1
                ];
              const o = orders.get(id);
              if (!o) return { rows: [] };
              const next = { ...o };
              t.match(/SET (.*?) WHERE/i)[1]
                .split(", ")
                .forEach((c) => {
                  const m = c.match(/^"?([a-z_]+)"? = \$(\d+)$/i);
                  if (m) next[m[1]] = params[Number(m[2]) - 1];
                });
              orders.set(id, next);
              return { rows: [{ ...next }] };
            }
            if (/^INSERT INTO outbound_line \(/i.test(t)) {
              const cols = t
                .match(/\(([^)]*)\) VALUES/)[1]
                .split(", ")
                .map((c) => c.replace(/"/g, ""));
              const row = { outbound_line_id: `l-${lines.size + 1}` };
              cols.forEach((c, i) => {
                row[c] = params[i];
              });
              lines.set(row.outbound_line_id, row);
              return { rows: [row] };
            }
            throw new Error(`unrecognised SQL in the outbound fake: ${t}`);
          },
        },
      };
    }

    const lifecycle = [
      ["CREATED", "PICKING", true],
      ["CREATED", "CANCELLED", true],
      ["CREATED", "PACKED", false],
      ["CREATED", "DISPATCHED", false],
      ["PICKING", "PACKED", true],
      ["PICKING", "CANCELLED", true],
      ["PICKING", "DISPATCHED", false],
      ["PACKED", "DISPATCHED", true],
      ["PACKED", "CANCELLED", true],
      ["PACKED", "PICKING", false],
      ["DISPATCHED", "CANCELLED", false],
      ["CANCELLED", "PICKING", false],
    ];

    it("permits exactly the lifecycle the table declares", async () => {
      for (const [from, to, allowed] of lifecycle) {
        const { client: c } = outboundDb(from);
        if (allowed) {
          const row = await outbound.setStatus(c, {
            id: "o-1",
            status: to,
            actor: ACTOR,
          });
          expect(row.status).toBe(to);
        } else {
          const err = await rejection(
            outbound.setStatus(c, { id: "o-1", status: to, actor: ACTOR }),
          );
          expect(err.code).toBe("INVALID_TRANSITION");
        }
      }
    });

    it("cannot skip the pick — CREATED straight to DISPATCHED is refused", async () => {
      // Dispatch is what triggers the stock decrement downstream. Skipping the
      // pick means shipping stock nobody confirmed was there.
      const { client: c } = outboundDb("CREATED");
      const err = await rejection(
        outbound.setStatus(c, {
          id: "o-1",
          status: "DISPATCHED",
          actor: ACTOR,
        }),
      );
      expect(err.code).toBe("INVALID_TRANSITION");
    });

    it("stamps dispatched_at on dispatch, and only then", async () => {
      const packed = outboundDb("PACKED");
      const row = await outbound.setStatus(packed.client, {
        id: "o-1",
        status: "DISPATCHED",
        actor: ACTOR,
      });
      expect(row.dispatched_at).toBeInstanceOf(Date);

      const picking = outboundDb("CREATED");
      const other = await outbound.setStatus(picking.client, {
        id: "o-1",
        status: "PICKING",
        actor: ACTOR,
      });
      expect(other.dispatched_at).toBeNull();
    });

    it("makes DISPATCHED and CANCELLED terminal", async () => {
      for (const from of ["DISPATCHED", "CANCELLED"]) {
        for (const to of [
          "CREATED",
          "PICKING",
          "PACKED",
          "DISPATCHED",
          "CANCELLED",
        ]) {
          const { client: c } = outboundDb(from);

          const err = await rejection(
            outbound.setStatus(c, { id: "o-1", status: to, actor: ACTOR }),
          );
          expect(err.code).toBe("INVALID_TRANSITION");
        }
      }
    });

    it("refuses to add a line to an order that has left the picking stage", async () => {
      // Adding a line to a PACKED order means the paperwork and the pallet
      // disagree.
      for (const status of ["PACKED", "DISPATCHED", "CANCELLED"]) {
        const { client: c } = outboundDb(status);

        const err = await rejection(
          outbound.addLine(c, {
            orderId: "o-1",
            data: { sku: "S" },
            actor: ACTOR,
          }),
        );
        expect(err.code).toBe("ORDER_LOCKED");
        expect(err.status).toBe(422);
      }
    });

    it("allows lines while the order is still CREATED or PICKING", async () => {
      for (const status of ["CREATED", "PICKING"]) {
        const { client: c, lines } = outboundDb(status);

        const line = await outbound.addLine(c, {
          orderId: "o-1",
          data: { sku: "S", qty: 2 },
          actor: ACTOR,
        });
        expect(line.outbound_order_id).toBe("o-1");
        expect(lines.size).toBe(1);
      }
    });

    it("returns null for an unknown order", async () => {
      const { client: c } = outboundDb();
      expect(
        await outbound.setStatus(c, {
          id: "nope",
          status: "PICKING",
          actor: ACTOR,
        }),
      ).toBeNull();
      expect(
        await outbound.addLine(c, { orderId: "nope", data: {}, actor: ACTOR }),
      ).toBeNull();
    });
  });
});
