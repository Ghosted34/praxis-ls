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

const { categoryFor } = require("../notifications/categories");

// Roles that receive Watch-the-Watcher alerts (role.code, seeded in
// 9020_seed_rbac_events.sql). CEO already sees everything by design; MANAGEMENT
// is the oversight tier per the RBAC journey doc.
const WATCHER_ROLE_CODES = ["CEO", "MANAGEMENT"];

/** "permission.changed" → "Permission changed" (for human-readable notifications). */
function humanizeEventKey(key) {
  const w = String(key || "").replace(/[._]+/g, " ").trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : "Change";
}

/** "permission:f64ba62b-ff25-…" → "permission f64ba62b" (type + short id, no full UUID). */
function shortRef(ref) {
  if (!ref) return "";
  const s = String(ref);
  const i = s.indexOf(":");
  if (i === -1) return s.replace(/_/g, " ");
  const type = s.slice(0, i).replace(/_/g, " ");
  const id = s.slice(i + 1);
  return `${type} ${id.length > 8 ? id.slice(0, 8) : id}`.trim();
}

async function emitEvent(client, e) {
  const key = e.eventTypeKey;

  // Is this event type flagged security-critical? One small lookup. Resolving
  // it in JS (rather than an in-SQL subquery on the same INSERT) keeps every
  // statement below using each parameter in exactly one place — reusing a
  // placeholder across an INSERT value AND a subquery made Postgres fail to
  // deduce a single type for it (SQLSTATE 42P08).
  const crit = await client.query(
    `SELECT is_security_critical, is_approvable FROM event_type WHERE key = $1`,
    [key],
  );
  const isCritical = crit.rows[0] ? crit.rows[0].is_security_critical === true : false;
  const isApprovable = crit.rows[0] ? crit.rows[0].is_approvable === true : false;

  // priority: caller override wins; else HIGH for security-critical, else NORMAL.
  const priority = e.priority || (isCritical ? "HIGH" : "NORMAL");

  // actor_user_id is guarded for the same reason as in audit() below: it is
  // `REFERENCES app_user(user_id)` in the schema being written to, and under TEST
  // that's the SANDBOX schema while the user's row lives in LIVE (identity was
  // pinned there in session 3). A freshly wiped sandbox has no users at all, so
  // the raw value raised 23503 and took the whole business operation with it.
  // Degrade to a NULL actor rather than lose the event.
  await client.query(
    `INSERT INTO event_log (event_type_key, module_key, entity_ref, actor_user_id, priority, payload)
     SELECT $1,$2,$3,(SELECT user_id FROM app_user WHERE user_id = $4),$5,$6`,
    [key, e.moduleKey || null, e.entityRef || null, e.actorUserId || null, priority, e.payload || {}],
  );

  // Universal approval retrofit: if this event type is approvable, open the first
  // approval task (idempotent). No-op when no active workflow is bound, so the
  // record follows its own flow (auto-approve default). Runs in the caller's
  // transaction so the task is atomic with the change. `require` is lazy to keep
  // the module load order (executor → query-helpers only, no cycle back to emit).
  if (isApprovable && e.entityRef) {
    // eslint-disable-next-line global-require
    const executor = require("../../services/workflow/executor");
    const amountXaf = e.payload && (e.payload.amount_xaf ?? e.payload.amount ?? e.payload.total_ttc);
    await executor.start(client, { eventTypeKey: key, entityRef: e.entityRef, amountXaf: amountXaf ?? null, actorUserId: e.actorUserId || null });
  }

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
    // Human-readable title/body: humanize the dotted event key, resolve the actor
    // UUID to a name, and shorten the entity ref (type + short id) — otherwise the
    // inbox shows raw keys and full UUIDs. Baked at write time since the reader
    // (notification row) has no join back to app_user.
    let actorName = null;
    if (e.actorUserId) {
      const a = await client.query(
        "SELECT full_name, email FROM app_user WHERE user_id = $1",
        [e.actorUserId],
      );
      actorName = a.rows[0] ? a.rows[0].full_name || a.rows[0].email : null;
    }
    const label = humanizeEventKey(key);
    const refPart = e.entityRef ? ` on ${shortRef(e.entityRef)}` : "";
    const byPart = actorName ? ` by ${actorName}` : "";
    const title = `Security-critical change: ${label}`;
    const body = `${label}${refPart}${byPart}`;
    // Tag with the notification category so the inbox can filter it. These are
    // security-critical events, but categoryFor keeps the value accurate to the
    // event's domain (they resolve to 'security' for RBAC/auth keys).
    const category = categoryFor(key);
    await client.query(
      `INSERT INTO notification (user_id, channel, event_type_key, title, body, entity_ref, priority, category)
       SELECT DISTINCT u.user_id, 'IN_APP', $1, $2, $3, $4, 'HIGH', $6
         FROM app_user u
         JOIN user_role ur ON ur.user_id = u.user_id
         JOIN role r       ON r.role_id  = ur.role_id
        WHERE r.code = ANY($5::text[])
          AND u.status = 'ACTIVE'`,
      [key, title, body, e.entityRef || null, WATCHER_ROLE_CODES, category],
    );
  }

  // Curated domain-event notifications to the module's permission-holders
  // (finance to start). Allowlisted + best-effort inside — a no-op for the ~99%
  // of events not on the list, and never throws into the business op.
  await require("../notifications/notify-events").onEvent(client, {
    eventTypeKey: key,
    moduleKey: e.moduleKey || null,
    entityRef: e.entityRef || null,
    actorUserId: e.actorUserId || null,
    payload: e.payload || {},
  });
}

/**
 * Append to the immutable ledger.
 *
 * `actor_user_id` is written via a guarded sub-select rather than the raw value
 * (fix 2026-08-01). It is `uuid REFERENCES app_user(user_id)` in whichever schema
 * is being written to — and since session 3 pinned identity to the LIVE schema,
 * those two are not the same place under TEST:
 *
 *   - the user's row lives in `live.app_user` (auth, RBAC, sessions),
 *   - but business writes go through `req.tenantDb` → the SANDBOX schema,
 *   - so the audit row lands in `sandbox.immutable_ledger` carrying a user id
 *     that `sandbox.app_user` has never heard of → 23503.
 *
 * That surfaced as "Referenced record not found" on the FIRST create in a freshly
 * wiped sandbox (no `90*` seed creates users), AFTER the business row had already
 * committed — so the record existed but the request 409'd, and a retry then hit a
 * duplicate-key error. It affected every module on the shared CRUD kit, not one.
 *
 * `WHERE EXISTS` degrades that to a NULL actor: the audit row is still written —
 * which matters, because the ledger's job is to record that the action happened —
 * and the attribution is simply absent where it cannot be validated. Losing an
 * actor id on a sandbox row is a far smaller harm than losing the row, or than
 * dropping the FK and letting a real ledger reference a user who never existed.
 */
async function audit(client, a) {
  await client.query(
    `INSERT INTO immutable_ledger (actor_user_id, actor_role, action, module_key, entity_ref, before_json, after_json, ip)
     SELECT (SELECT user_id FROM app_user WHERE user_id = $1), $2,$3,$4,$5,$6,$7,$8`,
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

/**
 * Resolve an actor id to one that actually exists in the schema being written to,
 * or null.
 *
 * Any column typed `REFERENCES app_user(user_id)` is a landmine under TEST:
 * identity is pinned to the LIVE schema (session 3), but business writes go
 * through `req.tenantDb` → the SANDBOX schema, and a freshly wiped sandbox has no
 * users at all (no `90*` seed creates them). So a perfectly valid live user id
 * raises 23503 the moment it's stored beside sandbox business data.
 *
 * `emitEvent`/`audit`/`soft_delete` inline this guard. Use THIS helper for the
 * per-module columns that have the same FK — `milestone_instance.completed_by`,
 * and anything similar added later — rather than writing the sub-select again.
 *
 * Returns null rather than throwing: losing an attribution is a much smaller harm
 * than failing the business operation it describes.
 */
async function resolveActorId(client, userId) {
  if (!userId) return null;
  const { rows } = await client.query("SELECT user_id FROM app_user WHERE user_id = $1", [userId]);
  return rows[0] ? rows[0].user_id : null;
}

module.exports = { emitEvent, audit, resolveActorId, WATCHER_ROLE_CODES };
