/**
 * Operational document → advance the mapped milestone (Plan A, Phase 3).
 *
 * TWO SOURCES OF MAPPING, in priority order:
 *
 *  1. DECLARATIVE, on the stage itself — `milestone_instance.auto_advance_on_event`
 *     holds the event key that completes it, snapshotted from the template. This
 *     is the one the seeded chains use, so auto-advance works on a fresh tenant
 *     with nothing configured, and it survives a tenant renaming the stage
 *     because the trigger travels on the row rather than keying off the code.
 *
 *  2. The legacy tenant setting `operations.milestone_map` (event_type_key →
 *     stage `code`). Kept because tenants may already have configured it, and a
 *     setting somebody relies on should not stop working the day a better
 *     mechanism ships.
 *
 * SAFE + idempotent: no mapping → no-op; already-DONE → skip; a disallowed
 * transition (milestone.rules) is caught and skipped. Registered for the op-doc
 * events in handlers/index.js.
 */
"use strict";

const milestone = require("../../modules/operations/milestone/milestone.service");
const { getSetting } = require("../../shared/config/settings");

// event_type_key → { table, pk, refPrefix }. Whitelisted (table names are
// interpolated), never user input.
const SOURCES = {
  "transit_order.created": { table: "transit_order", pk: "transit_order_id", refPrefix: "transit_order" },
  "delivery_note.created": { table: "delivery_note", pk: "delivery_note_id", refPrefix: "delivery_note" },
  "invoice.issued": { table: "invoice", pk: "invoice_id", refPrefix: "invoice" },
};

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

async function run(client, event) {
  const src = SOURCES[event.event_type_key];
  if (!src) return { skipped: "unmapped event" };

  const id = idFromRef(event.entity_ref, src.refPrefix);
  if (!id) return { skipped: "no source ref" };

  const srcRow = await client.query(`SELECT dossier_id FROM ${src.table} WHERE ${src.pk} = $1`, [id]);
  const dossierId = srcRow.rows[0] && srcRow.rows[0].dossier_id;
  if (!dossierId) return { skipped: "source not tagged to a dossier" };

  // (1) the stage that declares this event as its own trigger.
  const declared = await client.query(
    "SELECT milestone_instance_id, status, code FROM milestone_instance " +
      " WHERE dossier_id = $1 AND auto_advance_on_event = $2 ORDER BY stage_seq LIMIT 1",
    [dossierId, event.event_type_key],
  );
  let inst = declared.rows[0];

  // (2) the legacy setting map, only when no stage declared itself.
  if (!inst) {
    const map = await getSetting(client, "operations", "milestone_map", null);
    if (!map || typeof map !== "object") return { skipped: "no declared trigger and no operations.milestone_map configured" };
    const code = map[event.event_type_key];
    if (!code) return { skipped: "event not in milestone_map" };
    const mapped = await client.query(
      "SELECT milestone_instance_id, status, code FROM milestone_instance WHERE dossier_id = $1 AND code = $2 LIMIT 1",
      [dossierId, code],
    );
    inst = mapped.rows[0];
    if (!inst) return { skipped: "no milestone '" + code + "' on dossier" };
  }

  if (inst.status === "DONE") return { skipped: "already done" };

  try {
    // PENDING cannot go straight to DONE (milestone.rules), and an op document
    // proves the work happened — so walk it through IN_PROGRESS rather than
    // skipping on a transition the document has already contradicted.
    if (inst.status === "PENDING") {
      await milestone.advance(client, { instanceId: inst.milestone_instance_id, to: "IN_PROGRESS", actor: { user_id: null } });
    }
    await milestone.advance(client, { instanceId: inst.milestone_instance_id, to: "DONE", actor: { user_id: null } });
    return { advanced: inst.code };
  } catch (err) {
    if (err && err.code === "BAD_TRANSITION") return { skipped: "transition not allowed from " + inst.status };
    throw err;
  }
}

module.exports = { run, SOURCES };
