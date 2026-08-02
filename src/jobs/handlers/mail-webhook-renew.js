/**
 * Worker job: renew mail push subscriptions for one tenant before they expire
 * (Graph ~3d, Gmail ~7d). Job data: { tenantMeta, env }. Delegates to
 * mail.service.renewSubscriptions, which renews everything due within 24h.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const mail = require("../../modules/mail/mail.service");

module.exports = async function mailWebhookRenew(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("mail-webhook-renew job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, (c) => mail.renewSubscriptions(c));
};
