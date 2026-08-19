/**
 * Worker job: régie-aging fan-out (KB §6.8 step 4). One job per tenant
 * environment PER CORPORATE ENTITY.
 *
 * WHY THIS EXISTS. `regie-aging` has been a registered worker since the régie
 * module shipped (workers.js:27) and NOTHING EVER ENQUEUED IT — grep the repo
 * and the only references are the handler itself and two comments in other
 * handlers describing it as the pattern to copy. The aging step was reachable
 * only by someone manually POSTing /regie/age-due, which means in practice it
 * never ran: an advance past its policy window sat in 581 indefinitely, and the
 * `AGED_UNJUSTIFIED` state that Landing A made reversible was unreachable by the
 * route that is supposed to produce it.
 *
 * WHY IT FANS OUT PER ENTITY, unlike every other scheduler here.
 *
 * `regie.ageDue` POSTS a reclassification (581 → 4211), and
 * `journalEntry.buildAndInsert` requires an `entity_id` — a journal entry
 * belongs to one legal entity and an accounting period is per entity. Every
 * other fan-out in this directory passes only `{ tenantMeta, env }` because
 * nothing they do touches the ledger. This one cannot: with no entity there is
 * no period to post into, which is exactly why the handler throws
 * "regie-aging job needs tenantMeta + entityId".
 *
 * So the scheduler resolves the tenant's entities and enqueues one job each.
 * A tenant with three legal entities ages each one's advances against its own
 * period, which is the only correct reading of §6.8.
 *
 * WHY LIVE ONLY. Same reasoning as contract-lapse: this writes JOURNAL ENTRIES.
 * A rehearsal advance in a Test environment aging into 4211 would post a real
 * reclassification into that environment's books, and a sandbox whose ledger
 * moves on its own is not a rehearsal any more. Aging in Test remains available
 * through the route for anyone deliberately exercising the flow.
 *
 * IDEMPOTENCY. `ageOne` writes through `aged_entry_id` and is guarded by
 * `ux_one_reversal_per_entry` (0464:59), and `rules.isAged` re-checks the window
 * per advance, so a double tick re-selects nothing. The per-entity `jobId`
 * dedupes an in-flight run anyway, so a slow tenant never piles up duplicates.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

module.exports = async function regieAgingScheduler() {
  const tenants = await registry.listActiveTenants();
  let enqueued = 0;
  let skipped = 0;

  for (const meta of tenants) {
    let entities = [];
    try {
      entities = await registry.withTenantConnection(meta, "live", async (c) => {
        const { rows } = await c.query(
          "SELECT entity_id FROM corporate_entity ORDER BY created_at",
        );
        return rows;
      });
    } catch (err) {
      // One unreachable tenant must not stop the fan-out for the rest — the
      // whole point of a per-tenant job is isolation.
      logger.warn(
        { err, tenant: meta.db_name },
        "[regie] aging scheduler could not list entities",
      );
      skipped += 1;
      continue;
    }

    for (const e of entities) {
      await enqueue(
        "regie-aging",
        "age",
        { tenantMeta: meta, env: "live", entityId: e.entity_id },
        {
          // A BullMQ custom job id may contain `:` only when it splits into
          // exactly three segments (a backwards-compat allowance for old
          // repeatable-job ids). Four segments throws `Custom Id cannot contain :`.
          // `live-<entity_id>` keeps the env marker without a fourth colon —
          // entity_id is a uuid, so it never itself contains a colon.
          jobId: `regieaging:${meta.db_name}:live-${e.entity_id}`,
          attempts: 2,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      enqueued += 1;
    }
  }

  logger.debug(
    { tenants: tenants.length, enqueued, skipped },
    "[regie] aging scheduler tick",
  );
  return { tenants: tenants.length, enqueued, skipped };
};
