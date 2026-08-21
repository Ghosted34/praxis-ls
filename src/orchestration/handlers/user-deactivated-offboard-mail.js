/**
 * A user who is no longer ACTIVE loses their mail access (PR-0 P1/P3).
 *
 * `mailbox.service.offboardUser` archives the person's personal mailbox and
 * revokes every shared-mailbox grant they hold, writing an `email_access_audit`
 * row for each. It was written, exported, made idempotent and audited — and
 * called by nothing. Suspending or locking an account therefore left the
 * departed employee's grants on `billing@`, `operations@` and the rest open
 * indefinitely; the only thing that stopped them reading was the login, and a
 * grant that outlives the account is exactly what an access review looks for.
 *
 * ── WHY A HANDLER RATHER THAN A CALL IN setStatus ───────────────────────────
 *
 * Mail must not become a hard dependency of the security module: a mailbox
 * archive that failed for its own reasons would then block an admin from
 * locking a compromised account, which is the wrong way round. Orchestration is
 * at-least-once and retried, so the grant is revoked even if the first attempt
 * fails, and the account is locked immediately either way.
 *
 * ── IDEMPOTENT, AND STATUS IS RE-READ ───────────────────────────────────────
 *
 * `app_user.updated` fires on every change to a user, not only a status change,
 * so the current status is read here rather than trusted from the payload — and
 * an ACTIVE user is a no-op. Re-running on an already-offboarded user archives
 * an archived mailbox and revokes no grants, which is the successful no-op the
 * registry requires.
 */
"use strict";

const mailbox = require("../../modules/mail/mail/mailbox.service");

function userIdFrom(entityRef) {
  if (typeof entityRef !== "string") return null;
  return entityRef.startsWith("app_user:") ? entityRef.slice("app_user:".length) : null;
}

module.exports = {
  eventKey: "app_user.updated",
  handlerKey: "app_user.updated:offboard-mail",
  feature: null,
  async run(client, event) {
    const userId = userIdFrom(event.entity_ref);
    if (!userId) return { skipped: "no app_user ref" };

    const { rows } = await client.query(
      `SELECT status FROM app_user WHERE user_id = $1`,
      [userId],
    );
    if (!rows[0]) return { skipped: "user not found" };
    if (rows[0].status === "ACTIVE") return { skipped: "still active" };

    return mailbox.offboardUser(client, userId, { user_id: event.actor_user_id || null });
  },
};
