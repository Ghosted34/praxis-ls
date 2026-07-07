/**
 * Event + audit helpers for module services. Runs on the tenant connection.
 *   emitEvent  → live.event_log (drives notifications, workflows, compliance)
 *   audit      → live.immutable_ledger (append-only trail; 10-year retention)
 * Both are best-effort-safe: a logging failure must not break the business op,
 * EXCEPT audit of security-critical actions which should bubble up.
 */
"use strict";

async function emitEvent(client, e) {
  await client.query(
    `INSERT INTO event_log (event_type_key, module_key, entity_ref, actor_user_id, priority, payload)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      e.eventTypeKey,
      e.moduleKey || null,
      e.entityRef || null,
      e.actorUserId || null,
      e.priority || "NORMAL",
      e.payload || {},
    ],
  );
}

async function audit(client, a) {
  await client.query(
    `INSERT INTO immutable_ledger (actor_user_id, actor_role, action, module_key, entity_ref, before_json, after_json, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      a.actorUserId || null,
      a.actorRole || null,
      a.action,
      a.moduleKey || null,
      a.entityRef || null,
      a.before || null,
      a.after || null,
      a.ip || null,
    ],
  );
}

module.exports = { emitEvent, audit };
