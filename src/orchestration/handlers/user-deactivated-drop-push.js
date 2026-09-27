/**
 * A user who is no longer ACTIVE stops receiving pushes (calls audit C6).
 *
 * Their registered phones and laptops kept every push subscription, so a
 * suspended employee's device still showed "Incoming call from X" and every
 * chat notification. Dialing now requires an ACTIVE callee; this removes the
 * devices themselves, for calls and for everything else that pushes.
 *
 * Same shape as user-deactivated-offboard-mail.js: `app_user.updated` fires
 * on every change, so the status is re-read and an ACTIVE user is a no-op.
 * Re-running deletes nothing, which is the idempotent no-op the registry
 * requires. A user reactivated later subscribes again from their device.
 *
 * Both environments: a device subscribed from a Test-mode (sandbox) tab has
 * its row in `sandbox.push_subscription`, and sandbox calls push from there.
 * Identity is live, so the event arrives on the live schema and the sandbox
 * table is named explicitly, when it exists.
 */
"use strict";

function userIdFrom(entityRef) {
  if (typeof entityRef !== "string") return null;
  return entityRef.startsWith("app_user:") ? entityRef.slice("app_user:".length) : null;
}

module.exports = {
  eventKey: "app_user.updated",
  handlerKey: "app_user.updated:drop-push-subscriptions",
  feature: null,
  async run(client, event) {
    const userId = userIdFrom(event.entity_ref);
    if (!userId) return { skipped: "no app_user ref" };
    const { rows } = await client.query("SELECT status FROM app_user WHERE user_id = $1", [userId]);
    if (!rows[0]) return { skipped: "user not found" };
    if (rows[0].status === "ACTIVE") return { skipped: "still active" };
    const live = await client.query("DELETE FROM push_subscription WHERE user_id = $1", [userId]);
    let sandbox = { rowCount: 0 };
    const { rows: has } = await client.query(
      "SELECT to_regclass('sandbox.push_subscription') IS NOT NULL AS ok",
    );
    if (has[0] && has[0].ok) {
      sandbox = await client.query("DELETE FROM sandbox.push_subscription WHERE user_id = $1", [userId]);
    }
    return { deleted: (live.rowCount || 0) + (sandbox.rowCount || 0) };
  },
};
