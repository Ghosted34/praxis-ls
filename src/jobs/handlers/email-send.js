/** Worker job: send one email via the tenant's configured SMTP.
 *  Job data: { tenantMeta, env, to, subject, html, text, from }. */
"use strict";
const registry = require("../../services/tenant/registry.service");
const email = require("../../services/email.service");
module.exports = async function emailSend(job) {
  const { tenantMeta, env = "live", to, subject, html, text, from } = job.data || {};
  if (!tenantMeta) throw new Error("email job needs tenantMeta (SMTP config is per-tenant)");
  return registry.withTenantConnection(tenantMeta, env, (c) => email.send(c, { to, subject, html, text, from }));
};
