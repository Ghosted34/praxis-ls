/**
 * Operational document → advance the mapped milestone (Plan A, Phase 3).
 *
 * Config-driven and inert until set: reads the tenant setting
 * `operations.milestone_map`, a map of event_type_key → milestone stage `code`,
 * e.g. { "transit_order.created": "CUSTOMS", "delivery_note.created": "DELIVERED" }.
 * When a mapped op-document is captured, the matching milestone on its dossier is
 * advanced to DONE.
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
};

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

async function run(client, event) {
  const src = SOURCES[event.event_type_key];
  if (!src) return { skipped: "unmapped event" };

  const map = await getSetting(client, "operations", "milestone_map", null);
  if (!map || typeof map !== "object") return { skipped: "no operations.milestone_map configured" };
  const code = map[event.event_type_key];
  if (!code) return { skipped: "event not in milestone_map" };

  const id = idFromRef(event.entity_ref, src.refPrefix);
  if (!id) return { skipped: "no source ref" };

  const srcRow = await client.query(`SELECT dossier_id FROM ${src.table} WHERE ${src.pk} = $1`, [id]);
  const dossierId = srcRow.rows[0] && srcRow.rows[0].dossier_id;
  if (!dossierId) return { skipped: "source not tagged to a dossier" };

  const mi = await client.query(
    "SELECT milestone_instance_id, status FROM milestone_instance WHERE dossier_id = $1 AND code = $2 LIMIT 1",
    [dossierId, code],
  );
  const inst = mi.rows[0];
  if (!inst) return { skipped: "no milestone '" + code + "' on dossier" };
  if (inst.status === "DONE") return { skipped: "already done" };

  try {
    await milestone.advance(client, { instanceId: inst.milestone_instance_id, to: "DONE", actor: { user_id: null } });
    return { advanced: code };
  } catch (err) {
    if (err && err.code === "BAD_TRANSITION") return { skipped: "transition not allowed from " + inst.status };
    throw err;
  }
}

module.exports = { run, SOURCES };
