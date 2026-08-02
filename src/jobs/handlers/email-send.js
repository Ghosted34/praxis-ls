/** Worker job: send one email from a purpose's verified identity via the tenant's
 *  SMTP. Job data: { tenantMeta, env, to, subject, html, text, from, replyTo,
 *  attachments, purpose, moduleKey }. `attachments` are nodemailer descriptors
 *  ({filename, content, encoding, contentType}) — scheduled reports pass rendered
 *  csv/xlsx as base64 so the job stays JSON-serialisable. */
"use strict";
const registry = require("../../services/tenant/registry.service");
const email = require("../../services/email.service");
module.exports = async function emailSend(job) {
  const { tenantMeta, env = "live", to, subject, html, text, from, replyTo, attachments, purpose, moduleKey } = job.data || {};
  if (!tenantMeta) throw new Error("email job needs tenantMeta (sender identity is per-tenant/per-purpose)");
  return registry.withTenantConnection(tenantMeta, env, (c) => email.send(c, { to, subject, html, text, from, replyTo, attachments, purpose, moduleKey }));
};
