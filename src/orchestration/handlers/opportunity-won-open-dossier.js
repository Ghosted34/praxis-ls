/**
 * opportunity.won → open a delivery dossier (Plan A, Phase 1).
 *
 * When a sales opportunity is won, ensure a dossier exists and is linked. This
 * makes the sales→operations handoff automatic instead of the opt-in
 * `win({ createDossier })` flag — while staying compatible with it:
 *
 *   IDEMPOTENT: if the opportunity already has a dossier_id (manual path, or a
 *   prior run of this handler), it no-ops. Delivery is at-least-once, so this
 *   guard is what keeps replays from creating duplicate dossiers.
 *
 * Creates a DRAFT/OPEN dossier only (no money, no SoD bypass). Entity is resolved
 * to the tenant's corporate entity (single-business default); multi-entity tenants
 * would carry entity on the opportunity — noted in the plan.
 */
"use strict";

const dossierSvc = require("../../modules/operations/operations_file/operations_file.service");

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "opportunity.won",
  handlerKey: "opportunity.won:open-dossier",
  feature: null,
  async run(client, event) {
    const oppId = idFromRef(event.entity_ref, "opportunity");
    if (!oppId) return { skipped: "no opportunity ref" };

    const { rows } = await client.query(
      "SELECT opportunity_id, client_id, dossier_id, name FROM opportunity WHERE opportunity_id = $1",
      [oppId],
    );
    const opp = rows[0];
    if (!opp) return { skipped: "opportunity not found" };
    if (opp.dossier_id) return { skipped: "already linked", dossier_id: opp.dossier_id };

    // Resolve an entity to allocate the dossier ref against.
    const ent = await client.query("SELECT entity_id FROM corporate_entity ORDER BY created_at ASC LIMIT 1");
    const entityId = ent.rows[0] && ent.rows[0].entity_id;
    if (!entityId) return { skipped: "no corporate_entity to allocate a dossier ref" };

    // dossierSvc.create manages its own transaction + numbering + audit.
    const d = await dossierSvc.create(client, {
      data: { entity_id: entityId, client_id: opp.client_id, service_type_id: null, title: opp.name },
      actor: { user_id: null },
    });

    // Link back. Guarded on dossier_id IS NULL so a concurrent/duplicate run
    // never overwrites an existing link.
    await client.query(
      "UPDATE opportunity SET dossier_id = $1, updated_at = now() WHERE opportunity_id = $2 AND dossier_id IS NULL",
      [d.dossier_id, oppId],
    );
    return { created: true, dossier_id: d.dossier_id };
  },
};
