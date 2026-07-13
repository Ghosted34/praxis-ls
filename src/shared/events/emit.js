/**
 * Event + audit helpers for module services. Runs on the tenant connection.
 *   emitEvent  → live.event_log (drives notifications, workflows, compliance)
 *   audit      → live.immutable_ledger (append-only trail; 10-year retention)
 * Both are best-effort-safe: a logging failure must not break the business op,
 * EXCEPT audit of security-critical actions which should bubble up.
 *
 * Watch-the-Watcher (PRD §5.7, WORK_TO_BE_DONE.md Phase 0) is implemented
 * *here*, centrally, so every security-critical event is caught no matter which
 * module emits it — rather than wiring a notifier into each of the three
 * (permission/role/field_visibility) services separately and missing the next
 * one someone adds. The `event_type.is_security_critical` flag (seeded in
 * 9020_seed_rbac_events.sql) is the single source of truth:
 *   - the event_log row's priority is forced to HIGH for those events, and
 *   - a HIGH IN_APP notification is fanned out to every active CEO / MANAGEMENT
 *     user (the "watchers").
 * Both run in the caller's transaction, so the notification is atomic with the
 * change that triggered it. The fan-out is a single INSERT…SELECT guarded by an
 * EXISTS on is_security_critical, so it is a no-op (zero rows) for the ~99% of
 * events that are NORMAL — no branching round-trip in JS.
 */
"use strict";

// Roles that receive Watch-the-Watcher alerts (role.code, seeded in
// 9020_seed_rbac_events.sql). CEO already sees everything by design; MANAGEMENT
// is the oversight tier per the RBAC journey doc.
const WATCHER_ROLE_CODES = ["CEO", "MANAGEMENT"];

async function emitEvent(client, e) {
  const key = e.eventTypeKey;

  // Is this event type flagged security-critical? One small lookup. Resolving
  // it in JS (rather than an in-SQL subquery on the same INSERT) keeps every
  // statement below using each parameter in exactly one place — reusing a
  // placeholder across an INSERT value AND a subquery made Postgres fail to
  // deduce a single type for it (SQLSTATE 42P08).
  const crit = await client.query(
    `SELECT is_security_critical FROM event_type WHERE key = $1`,
    [key],
  );
  const isCritical = crit.rows[0] ? crit.rows[0].is_security_critical === true : false;

  // priority: caller override wins; else HIGH for security-critical, else NORMAL.
  const priority = e.priority || (isCritical ? "HIGH" : "NORMAL");

  await client.query(
    `INSERT INTO event_log (event_type_key, module_key, entity_ref, actor_user_id, priority, payload)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [key, e.moduleKey || null, e.entityRef || null, e.actorUserId || null, priority, e.payload || {}],
  );

  // Watch-the-Watcher fan-out — only for security-critical events. A HIGH in-app
  // notification to every active CEO/MANAGEMENT user (the "watchers"), in the
  // caller's transaction so it's atomic with the change that triggered it.
  //
  // NOTE (1.2): this fan-out intentionally IGNORES notification_preference —
  // security-critical alerts to the watchers cannot be silenced. Any FUTURE
  // non-security notification path must instead consult
  // notification.repo.isChannelEnabled(client, userId, channel, category)
  // before inserting, so per-user opt-outs are honored (settings-are-enforced).
  if (isCritical) {
    const body = e.entityRef
      ? `${key} on ${e.entityRef}${e.actorUserId ? ` by ${e.actorUserId}` : ""}`
      : `${key}${e.actorUserId ? ` by ${e.actorUserId}` : ""}`;
    await client.query(
      `INSERT INTO notification (user_id, channel, event_type_key, title, body, entity_ref, priority)
       SELECT DISTINCT u.user_id, 'IN_APP', $1, $2, $3, $4, 'HIGH'
         FROM app_user u
         JOIN user_role ur ON ur.user_id = u.user_id
         JOIN role r       ON r.role_id  = ur.role_id
        WHERE r.code = ANY($5::text[])
          AND u.status = 'ACTIVE'`,
      [key, `Security-critical change: ${key}`, body, e.entityRef || null, WATCHER_ROLE_CODES],
    );
  }
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

module.exports = { emitEvent, audit, WATCHER_ROLE_CODES };
