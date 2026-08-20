/**
 * employee.updated → drop cached signature renders for the linked app_user.
 * Idempotent: deleting zero rows is a successful no-op (at-least-once delivery).
 */
"use strict";

const signatures = require("../../modules/mail/signature/signature.service");

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "employee.updated",
  handlerKey: "employee.updated:invalidate-signature",
  feature: null,
  async run(client, event) {
    const employeeId = idFromRef(event.entity_ref, "employee");
    if (!employeeId) return { skipped: "no employee ref" };
    const { rows } = await client.query(
      `SELECT user_id FROM app_user WHERE employee_id = $1`,
      [employeeId],
    );
    if (!rows[0]) return { skipped: "no linked user" };
    return signatures.invalidateForUser(client, rows[0].user_id);
  },
};
