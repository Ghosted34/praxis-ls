/**
 * milestone.advanced → dossier.milestones_completed (Plan A, Phase 3).
 *
 * When advancing a milestone leaves EVERY milestone on the dossier DONE, emit a
 * `dossier.milestones_completed` domain event — a clean signal a UI badge or a
 * future "ready to complete" prompt can consume. We emit a signal (not a user
 * notification) because a dossier has no single owner to notify; recipients are
 * a UI/subscriber concern.
 *
 * IDEMPOTENT: emits once — skips if the signal already exists for the dossier.
 */
"use strict";

const { emitEvent } = require("../../shared/events/emit");

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "milestone.advanced",
  handlerKey: "milestone.advanced:completed-signal",
  feature: null,
  async run(client, event) {
    const dossierId = idFromRef(event.entity_ref, "dossier");
    if (!dossierId) return { skipped: "no dossier ref" };

    const rows = (await client.query(
      "SELECT status FROM milestone_instance WHERE dossier_id = $1",
      [dossierId],
    )).rows;
    if (!rows.length) return { skipped: "no milestones" };
    if (rows.some((r) => r.status !== "DONE")) return { skipped: "not all done" };

    // Emit once.
    const already = await client.query(
      "SELECT 1 FROM event_log WHERE event_type_key = 'dossier.milestones_completed' AND entity_ref = $1 LIMIT 1",
      ["dossier:" + dossierId],
    );
    if (already.rows.length) return { skipped: "signal already emitted" };

    await emitEvent(client, {
      eventTypeKey: "dossier.milestones_completed",
      moduleKey: "MOD-29",
      entityRef: "dossier:" + dossierId,
      actorUserId: null,
    });
    return { signalled: true };
  },
};
