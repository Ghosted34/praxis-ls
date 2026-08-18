/** Milestone repository (MOD-31). template/stage/instance/calendar SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

function insertTemplate(client, data) { return insertOne(client, "milestone_template", data); }
function insertStage(client, data) { return insertOne(client, "milestone_template_stage", data); }

async function nextVersion(client, serviceTypeId) {
  const { rows } = await client.query("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM milestone_template WHERE service_type_id = $1", [serviceTypeId]);
  return rows[0].v;
}
async function activeTemplate(client, serviceTypeId) {
  const { rows } = await client.query(
    "SELECT * FROM milestone_template WHERE service_type_id = $1 AND is_active = true ORDER BY version DESC LIMIT 1",
    [serviceTypeId],
  );
  return rows[0] || null;
}
async function stages(client, templateId) {
  const { rows } = await client.query("SELECT * FROM milestone_template_stage WHERE milestone_template_id = $1 ORDER BY stage_seq", [templateId]);
  return rows;
}
async function deactivateOthers(client, serviceTypeId, keepId) {
  await client.query("UPDATE milestone_template SET is_active = false WHERE service_type_id = $1 AND milestone_template_id <> $2", [serviceTypeId, keepId]);
}
const getTemplate = (client, id) => getById(client, "milestone_template", "milestone_template_id", id);

function insertInstance(client, data) { return insertOne(client, "milestone_instance", data); }
const getInstance = (client, id) => getById(client, "milestone_instance", "milestone_instance_id", id);
async function updateInstance(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and writable allow-list in query-helpers.
  return updateOne(client, "milestone_instance", "milestone_instance_id", id, fields, "*", null);
}
async function listByDossier(client, dossierId) {
  // `label_fr` is an ALIAS, not a column: 0310 named it `label`, and the client
  // has always read `label_fr` — so every chain rendered stage CODES instead of
  // labels. Aliasing here fixes the read without a destructive rename of a
  // column that live dossiers depend on.
  const { rows } = await client.query(
    "SELECT *, label AS label_fr FROM milestone_instance WHERE dossier_id = $1 ORDER BY stage_seq",
    [dossierId],
  );
  return rows;
}
async function existingInstances(client, dossierId) {
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM milestone_instance WHERE dossier_id = $1", [dossierId]);
  return rows[0].n;
}
/**
 * The published templates, with what a reader needs to understand them: the
 * service type they seed, how many stages they carry, and the stages
 * themselves in chain order (10708). A stage list without its stages is a
 * number nobody can act on — the register's whole point is that a template
 * states, stage by stage, what the company promised a client.
 */
async function listTemplates(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset]; const wh = [];
  if (q.service_type_id) { params.push(q.service_type_id); wh.push(`t.service_type_id = $${params.length}`); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT t.*, st.code AS service_type_code, st.name AS service_type_name,
            (SELECT count(*)::int FROM milestone_template_stage s
              WHERE s.milestone_template_id = t.milestone_template_id) AS stage_count
       FROM milestone_template t
       LEFT JOIN service_type st ON st.service_type_id = t.service_type_id
       ${where}
      ORDER BY t.is_active DESC, t.created_at DESC
      LIMIT $1 OFFSET $2`,
    params,
  );
  for (const tpl of rows) {
    tpl.stages = await stages(client, tpl.milestone_template_id);
  }
  return rows;
}

/* ── Scheduling inputs ──────────────────────────────────────────────────── */

/**
 * Everything the scheduler needs to resolve a dossier's horizon in one trip:
 * the file's own promise, the carrier's estimate, and the service type's
 * default duration — the three rungs of the target-date cascade.
 */
async function scheduleContext(client, dossierId) {
  const { rows } = await client.query(
    "SELECT d.dossier_id, d.entity_id, d.created_at, d.promised_delivery_date, d.eta, " +
      "       st.service_type_id, st.default_duration_days, st.duration_basis, st.is_open_ended " +
      "  FROM dossier_visible d LEFT JOIN service_type st ON st.service_type_id = d.service_type_id " +
      " WHERE d.dossier_id = $1",
    [dossierId],
  );
  return rows[0] || null;
}

/**
 * The calendar that governs a dossier: the entity's own if it has one, else the
 * tenant default. Returned as raw rows for milestone.calendar to compile —
 * building the spec is pure and belongs there, not in SQL.
 */
async function workingCalendar(client, entityId = null) {
  const { rows } = await client.query(
    "SELECT * FROM working_calendar " +
      " WHERE is_active AND (entity_id = $1 OR entity_id IS NULL) " +
      " ORDER BY (entity_id IS NOT NULL) DESC, is_default DESC LIMIT 1",
    [entityId],
  );
  const calendar = rows[0];
  if (!calendar) return null;
  const [days, holidays] = await Promise.all([
    client.query("SELECT weekday, opens_at, closes_at FROM working_calendar_day WHERE working_calendar_id = $1", [calendar.working_calendar_id]),
    client.query("SELECT holiday_date, is_recurring FROM working_calendar_holiday WHERE working_calendar_id = $1", [calendar.working_calendar_id]),
  ]);
  return { timezone: calendar.timezone, days: days.rows, holidays: holidays.rows };
}

async function assumptions(client, serviceTypeId, { clientVisibleOnly = false } = {}) {
  const { rows } = await client.query(
    "SELECT * FROM service_type_assumption WHERE service_type_id = $1" +
      (clientVisibleOnly ? " AND is_client_visible" : "") + " ORDER BY seq, code",
    [serviceTypeId],
  );
  return rows;
}

/**
 * The stages of the SHIPPED system default for a service type (9091's v1).
 *
 * Two jobs, both in the editor: show a tenant what they have changed away from,
 * and give "restore the default" something to restore FROM. The seeded v1
 * template is never deleted when a tenant publishes their own version — it is
 * just deactivated — so the shipped chain remains available indefinitely
 * without storing a second copy of it anywhere.
 */
async function systemDefaultStages(client, serviceTypeId) {
  const { rows } = await client.query(
    "SELECT s.* FROM milestone_template_stage s " +
      "  JOIN milestone_template t ON t.milestone_template_id = s.milestone_template_id " +
      " WHERE t.service_type_id = $1 AND t.is_system AND s.is_system " +
      " ORDER BY t.version ASC, s.stage_seq ASC",
    [serviceTypeId],
  );
  return rows;
}

/**
 * Replace a service type's assumptions register.
 *
 * Wholesale, like the working calendar and for the same reason: it is a short
 * ordered list edited as one thing, and diffing rows would buy nothing. The
 * caller wraps this in its own transaction so a half-written register can never
 * be what a client reads.
 */
async function replaceAssumptions(client, serviceTypeId, rows) {
  await client.query("DELETE FROM service_type_assumption WHERE service_type_id = $1", [serviceTypeId]);
  for (let i = 0; i < rows.length; i += 1) {
    const a = rows[i];
    await client.query(
      "INSERT INTO service_type_assumption (service_type_id, seq, code, text_fr, text_en, is_client_visible, is_system) " +
        " VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (service_type_id, code) DO NOTHING",
      [serviceTypeId, i + 1, a.code, a.text_fr, a.text_en || null, a.is_client_visible !== false, !!a.is_system],
    );
  }
  return assumptions(client, serviceTypeId);
}

/**
 * Delay attribution, aggregated — "who is costing us time".
 *
 * Reads COMPLETED milestones rather than the rebaseline log: the log records
 * every date movement, but a stage that slipped and was then re-forecast three
 * times would count three times. The completed instance carries the single
 * settled number (`variance_hours`) and the tier it was charged to, which is the
 * honest denominator.
 *
 * Force-majeure is separated, never netted away. "The carrier cost us four days"
 * and "four days were lost to a port strike we published as a risk" are
 * different sentences, and collapsing them into one average is how a scorecard
 * stops being trusted by the people it scores.
 */
async function attributionSummary(client, { from = null, to = null, serviceTypeId = null } = {}) {
  const params = [];
  const where = ["mi.status = 'DONE'", "mi.attributed_to IS NOT NULL", "mi.variance_hours > 0"];
  if (from) { params.push(from); where.push("mi.completed_at >= $" + params.length); }
  if (to) { params.push(to); where.push("mi.completed_at < ($" + params.length + "::date + 1)"); }
  if (serviceTypeId) { params.push(serviceTypeId); where.push("d.service_type_id = $" + params.length); }

  const { rows } = await client.query(
    "SELECT mi.attributed_to AS owner_tier, " +
      "       COUNT(*)::int AS slips, " +
      "       ROUND(SUM(mi.variance_hours)::numeric, 0)::int AS total_hours, " +
      "       ROUND(AVG(mi.variance_hours)::numeric, 1)::float AS avg_hours, " +
      "       COUNT(*) FILTER (WHERE mi.cause_reason_code IS NOT NULL)::int AS excused, " +
      "       COALESCE(ROUND(SUM(mi.variance_hours) FILTER (WHERE mi.cause_reason_code IS NOT NULL)::numeric, 0), 0)::int AS excused_hours " +
      "  FROM milestone_instance mi JOIN dossier_visible d USING (dossier_id) " +
      " WHERE " + where.join(" AND ") +
      " GROUP BY mi.attributed_to ORDER BY total_hours DESC",
    params,
  );
  return rows;
}

/** The same slips broken down by stage, so a tier's number is explainable. */
async function attributionByStage(client, { from = null, to = null, serviceTypeId = null, limit = 20 } = {}) {
  const params = [];
  const where = ["mi.status = 'DONE'", "mi.attributed_to IS NOT NULL", "mi.variance_hours > 0"];
  if (from) { params.push(from); where.push("mi.completed_at >= $" + params.length); }
  if (to) { params.push(to); where.push("mi.completed_at < ($" + params.length + "::date + 1)"); }
  if (serviceTypeId) { params.push(serviceTypeId); where.push("d.service_type_id = $" + params.length); }
  params.push(limit);

  const { rows } = await client.query(
    "SELECT mi.code, mi.label, mi.attributed_to AS owner_tier, st.name_fr AS service_fr, st.name_en AS service_en, " +
      "       COUNT(*)::int AS slips, ROUND(AVG(mi.variance_hours)::numeric, 1)::float AS avg_hours, " +
      "       ROUND(SUM(mi.variance_hours)::numeric, 0)::int AS total_hours " +
      "  FROM milestone_instance mi JOIN dossier_visible d USING (dossier_id) " +
      "  LEFT JOIN service_type st ON st.service_type_id = d.service_type_id " +
      " WHERE " + where.join(" AND ") +
      " GROUP BY mi.code, mi.label, mi.attributed_to, st.name_fr, st.name_en " +
      " ORDER BY total_hours DESC LIMIT $" + params.length,
    params,
  );
  return rows;
}

function logRebaseline(client, data) { return insertOne(client, "milestone_rebaseline_log", data); }

/**
 * Open milestones across every dossier, for the SLA scan. Ordered by dossier so
 * the scanner can process one chain at a time without re-querying, and bounded
 * so one enormous tenant cannot make the job unbounded.
 */
async function openInstances(client, { limit = 5000 } = {}) {
  const { rows } = await client.query(
    "SELECT mi.*, d.entity_id, d.promised_delivery_date, d.eta, d.created_at AS dossier_created_at " +
      "  FROM milestone_instance mi JOIN dossier_visible d USING (dossier_id) " +
      " WHERE mi.status NOT IN ('DONE') AND d.status NOT IN ('COMPLETED','CANCELLED') " +
      " ORDER BY mi.dossier_id, mi.stage_seq LIMIT $1",
    [limit],
  );
  return rows;
}

/** Next free sub-sequence between two stages, for an inserted ad-hoc milestone. */
async function seqBetween(client, dossierId, afterSeq) {
  const { rows } = await client.query(
    "SELECT MIN(stage_seq) AS next FROM milestone_instance WHERE dossier_id = $1 AND stage_seq > $2",
    [dossierId, afterSeq],
  );
  const next = rows[0] && rows[0].next;
  // numeric(10,4) is what makes an insert between two stages possible without
  // renumbering the chain (0310_operations.sql:59).
  return next === null || next === undefined ? Number(afterSeq) + 1 : (Number(afterSeq) + Number(next)) / 2;
}

module.exports = {
  insertTemplate, insertStage, nextVersion, activeTemplate, stages, deactivateOthers, getTemplate,
  insertInstance, getInstance, updateInstance, listByDossier, existingInstances, listTemplates,
  scheduleContext, workingCalendar, assumptions, replaceAssumptions, logRebaseline, openInstances, seqBetween,
  attributionSummary, attributionByStage,
  systemDefaultStages,
};
