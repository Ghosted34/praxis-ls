"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { atomically } = require("../../../shared/db/tx");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./inventory.repo");
const events = require("./inventory.events");

// Stock state machine + movement journal. `move` applies a signed qty delta to
// qty_on_hand, optionally relocates the item, and appends a stock_movement row.
const STATE_TRANSITIONS = {
  AVAILABLE: ["QA_HOLD", "ALLOCATED", "DAMAGED"],
  QA_HOLD: ["AVAILABLE", "DAMAGED"],
  ALLOCATED: ["AVAILABLE", "DISPATCHED"],
  DISPATCHED: [],
  DAMAGED: ["AVAILABLE"],
};

const base = makeService({ repo, moduleKey: events.MODULE, entity: "inventory", events });

module.exports = {
  ...base,
  listMovements: (client, id) => repo.listMovements(client, id),

  async setState(client, { id, state, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = STATE_TRANSITIONS[before.state] || [];
    if (!allowed.includes(state)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move stock ${before.state} → ${state}`, 422);
    }
    const row = await repo.update(client, id, { state, updated_at: new Date() });
    const entityRef = `inventory:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATE_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATE_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },

  /**
   * Apply a signed stock delta. ATOMIC and LOCKED (audit DATA 5.1, Critical).
   *
   * What this used to be: a plain SELECT, a quantity computed in JavaScript, an
   * UPDATE writing the ABSOLUTE value, then insertMovement, emitEvent and audit
   * — five statements, each autocommitting independently because the controller
   * calls through req.tenantDb with no wrapper. Three distinct failures:
   *
   *   1. LOST UPDATE. Two concurrent moves both read qty = 10; one wrote 5, the
   *      other wrote 7. Final answer 7 instead of 2 — silent, and undetectable
   *      afterwards because both movement rows were written.
   *   2. The negative-stock guard was racy with no database backstop. Two
   *      concurrent -6 moves against qty = 10 both passed.
   *   3. Balance and journal diverged PERMANENTLY. If insertMovement failed the
   *      quantity change was already committed, and because qty_on_hand is an
   *      absolute value rather than a derived sum there is no way to detect or
   *      reconstruct it.
   *
   * Three changes, each covering a different failure:
   *   · one transaction (shared/db/tx.js) so balance + movement + event + audit
   *     are a single unit — and nested calls join it rather than committing it
   *   · SELECT … FOR UPDATE so concurrent moves on one item serialise
   *   · the delta applied IN SQL with `WHERE qty_on_hand + $2 >= 0`, so the
   *     floor is enforced by the database against the row it holds, not by a
   *     check that ran before the lock
   *
   * Migration 0497 adds CHECK (qty_on_hand >= 0) as the last line of defence.
   */
  async move(client, { id, movement_kind, qty, from_location, to_location, actor }) {
    const delta = Number(qty);
    return atomically(client, async () => {
      const before = await repo.findByIdForUpdate(client, id);
      if (!before) return null;

      const row = await repo.applyDelta(client, id, delta, {
        location_id: to_location || undefined,
      });
      if (!row) {
        // Zero rows matched: the `qty_on_hand + delta >= 0` guard rejected it.
        // Reported with the balance the DATABASE held under lock, not the one
        // we read before it. Throwing rolls the transaction back.
        throw new AppError(
          "NEGATIVE_STOCK",
          `Move would drive qty below zero (${before.qty_on_hand} + ${delta})`,
          422,
        );
      }

      await repo.insertMovement(client, {
        inventory_item_id: id,
        movement_kind,
        qty: delta,
        from_location: from_location || before.location_id || null,
        to_location: to_location || null,
        moved_by: await resolveActorId(client, actor.user_id),
      });
      const entityRef = `inventory:${id}`;
      await emitEvent(client, { eventTypeKey: events.MOVED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
      await audit(client, { actorUserId: actor.user_id, action: events.MOVED, moduleKey: events.MODULE, entityRef, before, after: row });

      return row;
    });
  },
};
