/**
 * Keep `sandbox.app_user` populated with the LIVE users, so TEST-mode writes can
 * satisfy their actor foreign keys.
 *
 * WHY (2026-08-02). Session 3 pinned identity to the LIVE schema (`req.identityDb`)
 * so the LIVE/TEST toggle stops logging people out. Business data still writes
 * through `req.tenantDb`, which points at SANDBOX in TEST mode — and 60+ tenant
 * columns are typed `REFERENCES app_user(user_id)` (issued_by, validated_by,
 * approved_by, received_by, counted_by, owner_user_id, …). Storing a perfectly
 * valid live user id beside sandbox business data therefore raises 23503, usually
 * AFTER the business row has committed, surfacing as "Referenced record not found"
 * on a record that then already exists.
 *
 * Session 17 fixed this for the wipe path only: `provisioning.wipeSandbox` copied
 * `live.app_user` across after rebuilding the schema. Two holes were left open:
 *
 *   1. **A newly provisioned tenant.** Provisioning creates both schemas and runs
 *      the seeds, and no seed creates an app_user row; the first admin is created
 *      afterwards, by `createAdmin` / `scripts/tenant/create-admin.js`, into LIVE
 *      only. So `sandbox.app_user` is empty and the tenant's first TEST write dies.
 *      Calling the mirror during provisioning cannot help — at that point there is
 *      no user to copy.
 *   2. **Drift on an established tenant.** The mirror was a point-in-time snapshot
 *      taken at wipe. Every user created afterwards — a new employee onboarded
 *      months later — was absent from sandbox and hit exactly the same 23503, on a
 *      tenant that had been working fine.
 *
 * Both close at the source: mirror whenever a user is created or changed, not only
 * when the sandbox is rebuilt. `scripts/tenant/mirror-users.js` backfills tenants
 * provisioned before this existed.
 *
 * NOT a security widening. These rows are FK targets, not credentials in play:
 * auth, sessions and RBAC all resolve against `req.identityDb` (live), so nothing
 * signs in "as" a sandbox row. `password_hash` comes along only because the column
 * is NOT NULL — it is never read from this schema. `totp_secret_enc` and
 * `godmode_pin_hash` are omitted for the same reason. `employee_id` is deliberately
 * not copied: it references `sandbox.employee`, which a wipe empties, so carrying
 * it would trade one 23503 for another.
 */
"use strict";

const { logger } = require("../../config/logger");

// Columns that are safe AND sufficient: enough to satisfy every FK and to render
// a name where a sandbox screen joins app_user, without carrying a secret that
// this schema has no business holding.
const MIRROR_COLS =
  "user_id, username, email, full_name, password_hash, is_2fa_enabled, status, created_at, updated_at";

/**
 * Does this database have a sandbox schema with an app_user table?
 *
 * False during a wipe's drop/recreate window, and on any deployment that has not
 * run the tenant migrations yet. Checked rather than assumed so a mirror attempt
 * degrades to a no-op instead of an error inside somebody's user-create request.
 */
async function sandboxReady(client) {
  const { rows } = await client.query(
    "SELECT to_regclass('sandbox.app_user') IS NOT NULL AS ok",
  );
  return rows[0] ? rows[0].ok === true : false;
}

/**
 * Copy live users into sandbox. Pass `userId` for one user, omit it for all.
 *
 * Schemas are named explicitly rather than relying on `search_path`, because the
 * callers arrive with it set to whichever schema they were already working in
 * (live for the identity client, sandbox mid-wipe).
 *
 * `ON CONFLICT DO NOTHING` carries no conflict target on purpose — it must absorb
 * a `user_id` clash (already mirrored) AND an `email` clash (a stale sandbox row
 * from an older seed with the same address under a different id). The single-user
 * path verifies afterwards and warns, since an email collision is the one case
 * where "no rows inserted" still leaves the FK unsatisfied.
 *
 * Throws on a real database error — callers that must not fail should use
 * `mirrorUserBestEffort`.
 */
async function mirrorUsersIntoSandbox(client, { userId = null } = {}) {
  if (!(await sandboxReady(client))) return { mirrored: 0, skipped: "no-sandbox" };

  const where = userId ? " WHERE user_id = $1" : "";
  const params = userId ? [userId] : [];
  const res = await client.query(
    `INSERT INTO sandbox.app_user (${MIRROR_COLS})
     SELECT ${MIRROR_COLS} FROM live.app_user${where}
     ON CONFLICT DO NOTHING`,
    params,
  );

  if (userId) {
    const { rows } = await client.query(
      "SELECT 1 FROM sandbox.app_user WHERE user_id = $1",
      [userId],
    );
    if (rows.length === 0) {
      // Only reachable via an email collision with a differently-identified
      // sandbox row. Loud, because this user's TEST writes will 23503 until a
      // human clears the stale row.
      logger.warn(
        { userId },
        "[sandbox-mirror] user could not be mirrored (conflicting sandbox row) — TEST-mode writes by this user will fail their actor FK",
      );
    }
  }
  return { mirrored: res.rowCount };
}

/**
 * Mirror one user, swallowing anything that goes wrong.
 *
 * For the request path: a sandbox problem must never fail the live user create or
 * edit that triggered it. The cost of a miss is bounded and recoverable — that
 * user's TEST writes fail until the next mirror or a run of the backfill script —
 * whereas throwing here would break user administration in LIVE, which is worse.
 */
async function mirrorUserBestEffort(client, userId) {
  if (!userId) return;
  try {
    await mirrorUsersIntoSandbox(client, { userId });
  } catch (err) {
    logger.warn(
      { err: err.message, userId },
      "[sandbox-mirror] mirror failed; TEST-mode writes by this user may fail until it is retried",
    );
  }
}

module.exports = { mirrorUsersIntoSandbox, mirrorUserBestEffort, MIRROR_COLS };
