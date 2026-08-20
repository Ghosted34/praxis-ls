/**
 * Worker job: fire one tenant's due follow-ups (§9.3).
 *
 * Reminders only — nothing here sends mail. Q24 forbids auto-send and §9.3
 * applies that to sequence steps as well.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const followup = require("../../modules/mail/triage/followup.service");

module.exports = async function mailFollowupSweep(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("mail-followup-sweep job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, (c) => followup.sweep(c));
};
