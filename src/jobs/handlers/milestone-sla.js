/**
 * Worker job: the milestone SLA scan (MOD-31).
 *
 * Runs twice a day by default — 06:00 and 18:00 tenant-local — and answers one
 * question per open chain: has anything changed that somebody needs to know
 * about? Re-baselines each dossier (so a schedule that has quietly gone stale
 * against the calendar is corrected), then emits on TRANSITIONS only.
 *
 * TRANSITIONS ONLY IS THE WHOLE DESIGN. A stuck file is stuck every twelve
 * hours forever; an alert every twelve hours forever is one nobody reads, and
 * the genuinely new breach then arrives in a stream of noise. `health` is
 * persisted on the instance precisely so this job can compare against what was
 * last reported and stay quiet when nothing moved.
 *
 * Job data: { tenantMeta, env }. The per-tenant fan-out is milestone-sla-scheduler.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const milestone = require("../../modules/operations/milestone/milestone.service");
const events = require("../../modules/operations/milestone/milestone.events");
const { emitEvent } = require("../../shared/events/emit");
const { logger } = require("../../config/logger");

/** Health values worth waking somebody for, and the event each one emits. */
const ALERTABLE = {
  AT_RISK: events.AT_RISK,
  DELAYED: events.OVERDUE,
  BREACH_FORECAST: events.SLA_BREACH_FORECAST,
};

async function scanTenant(client) {
  const open = await client.query(
    "SELECT DISTINCT dossier_id FROM milestone_instance mi " +
      " WHERE mi.status <> 'DONE' " +
      "   AND EXISTS (SELECT 1 FROM dossier_visible d WHERE d.dossier_id = mi.dossier_id " +
      "                 AND d.status NOT IN ('COMPLETED','CANCELLED'))",
  );

  let scanned = 0;
  let alerted = 0;

  for (const { dossier_id: dossierId } of open.rows) {
    // Health as it was last REPORTED, captured before the recalculation
    // overwrites it — the comparison is what makes this quiet.
    const before = await client.query(
      "SELECT milestone_instance_id, code, health FROM milestone_instance WHERE dossier_id = $1 AND status <> 'DONE'",
      [dossierId],
    );
    const previous = new Map(before.rows.map((r) => [r.milestone_instance_id, r.health]));

    await milestone.recalculate(client, { dossierId, trigger: "SCAN", actor: { user_id: null } });
    scanned += 1;

    const after = await client.query(
      "SELECT milestone_instance_id, code, health, planned_due, forecast_due, owner_tier " +
        "  FROM milestone_instance WHERE dossier_id = $1 AND status <> 'DONE'",
      [dossierId],
    );

    for (const row of after.rows) {
      const eventKey = ALERTABLE[row.health];
      if (!eventKey) continue;
      if (previous.get(row.milestone_instance_id) === row.health) continue; // no transition, no noise
      await emitEvent(client, {
        eventTypeKey: eventKey,
        moduleKey: events.MODULE,
        entityRef: "dossier:" + dossierId,
        actorUserId: null,
        payload: {
          milestone_instance_id: row.milestone_instance_id,
          code: row.code,
          health: row.health,
          planned_due: row.planned_due,
          forecast_due: row.forecast_due,
          owner_tier: row.owner_tier,
        },
      });
      alerted += 1;
    }
  }
  return { scanned, alerted };
}

module.exports = async function milestoneSla(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("milestone-sla job needs tenantMeta");
  const result = await registry.withTenantConnection(tenantMeta, env, (c) => scanTenant(c));
  logger.debug({ tenant: tenantMeta.db_name, env, ...result }, "[milestone] SLA scan");
  return result;
};

module.exports.scanTenant = scanTenant;
module.exports.ALERTABLE = ALERTABLE;
