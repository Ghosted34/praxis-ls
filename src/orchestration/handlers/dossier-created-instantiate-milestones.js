/**
 * dossier.created → instantiate milestones (Plan A, operations kickoff).
 *
 * When a dossier opens WITH a service_type, stamp the service_type's active
 * milestone template onto it so the operational checklist (customs/transit/
 * delivery stages) exists from day one instead of being created by hand.
 *
 * IDEMPOTENT + safe: milestone.instantiate already refuses to double-instantiate
 * (ALREADY_INSTANTIATED) and needs an active template (NO_TEMPLATE) — both are
 * treated as clean skips. Dossiers opened without a service_type (e.g. the
 * opportunity.won auto-open) are skipped until a service_type is chosen.
 */
"use strict";

const milestone = require("../../modules/operations/milestone/milestone.service");

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "dossier.created",
  handlerKey: "dossier.created:instantiate-milestones",
  feature: null,
  async run(client, event) {
    const dossierId = idFromRef(event.entity_ref, "dossier");
    if (!dossierId) return { skipped: "no dossier ref" };

    const { rows } = await client.query("SELECT service_type_id FROM dossier WHERE dossier_id = $1", [dossierId]);
    const d = rows[0];
    if (!d) return { skipped: "dossier not found" };
    if (!d.service_type_id) return { skipped: "no service_type (nothing to instantiate)" };

    try {
      const out = await milestone.instantiate(client, { dossierId, serviceTypeId: d.service_type_id, actor: { user_id: null } });
      return { instantiated: Array.isArray(out) ? out.length : true };
    } catch (err) {
      if (err && (err.code === "ALREADY_INSTANTIATED" || err.code === "NO_TEMPLATE")) {
        return { skipped: err.code };
      }
      throw err;
    }
  },
};
