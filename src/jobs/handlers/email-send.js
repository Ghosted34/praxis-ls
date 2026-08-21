/** Worker job: send one email from a purpose's verified identity via the tenant's
 *  SMTP. Job data: { tenantMeta, env, to, subject, html, text, from, replyTo,
 *  attachments, purpose, moduleKey, sendPoint, entityId }. `attachments` are
 *  nodemailer descriptors ({filename, content, encoding, contentType}) —
 *  scheduled reports pass rendered csv/xlsx as base64 so the job stays
 *  JSON-serialisable.
 *
 *  ── WHY `sendPoint` HAD TO BE ADDED HERE ───────────────────────────────────
 *
 *  Every queued send — campaigns, scheduled reports — landed on this handler,
 *  which resolved the sender from the broad `purpose` alone. So a tenant could
 *  bind "Marketing campaign" to marketing@ in the console, have the binding
 *  stored, and watch every campaign go out from the notifications address
 *  anyway: the key never survived the trip through Redis.
 *
 *  Resolved HERE rather than at enqueue time on purpose. The job may sit in the
 *  queue for minutes; freezing the sender at enqueue would mean a binding
 *  changed in between is ignored by mail that has not left yet, which is the
 *  opposite of what an administrator changing it expects. */
"use strict";
const registry = require("../../services/tenant/registry.service");
const email = require("../../services/email.service");
module.exports = async function emailSend(job) {
  const {
    tenantMeta, env = "live", to, subject, html, text, from, replyTo,
    attachments, purpose, moduleKey, sendPoint = null, entityId = null,
  } = job.data || {};
  if (!tenantMeta) throw new Error("email job needs tenantMeta (sender identity is per-tenant/per-purpose)");
  return registry.withTenantConnection(tenantMeta, env, (c) => email.send(c, {
    to, subject, html, text, from, replyTo, attachments, purpose, moduleKey,
    sendPoint, entityId,
  }));
};
