/**
 * House rules (MOD-16 / 0697) — the SOP made operational.
 *
 * ── WHY THIS LIVES WITH THE SOP AND NOT WITH ATTENDANCE ────────────────────
 *
 * A lateness deduction is not an attendance feature; it is a CLAUSE, and the
 * clause is in the staff handbook. Putting the rules here — beside
 * `sop_document`, behind the same grant — is what makes "which document says I
 * can be charged for this?" answerable, and it means an HR manager editing the
 * handbook is in the same place as the switch that enforces it.
 *
 * Attendance reads these rules; it does not own them. Payroll (0698) reads what
 * attendance charged, and never the rules directly — so there is exactly one
 * place a rule is interpreted.
 *
 * ── ACTIVATION IS THE DANGEROUS EDIT, AND IT IS AUDITED AS SUCH ────────────
 *
 * Every seeded rule ships INACTIVE (see the migration): money must not start
 * coming out of anybody's pay because a migration ran. Switching one on is the
 * moment the company starts charging its staff, so it is audited with the whole
 * rule as the payload — an employee asking "since when?" gets a date and a
 * person, not an inference from when deductions first appeared.
 */
"use strict";
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const MODULE = "MOD-16";
const ref = (id) => `hr_rule:${id}`;

/** Tiers are the rule; a malformed list would silently charge 0% forever. */
function assertTiers(tiers) {
  if (tiers === undefined) return;
  if (!Array.isArray(tiers)) {
    throw new AppError("VALIDATION_ERROR", "Tiers must be a list", 422, { tiers: ["Expected a list of tiers."] });
  }
  for (const t of tiers) {
    const after = Number(t && t.after_minutes);
    const pct = Number(t && t.deduction_pct);
    if (!Number.isFinite(after) || after < 0 || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new AppError("VALIDATION_ERROR", "Each tier needs minutes and a percentage between 0 and 100", 422, {
        tiers: ["Each tier is { after_minutes, deduction_pct }, with the percentage between 0 and 100."],
      });
    }
  }
}

async function list(client, q = {}) {
  const params = [];
  const wh = [];
  if (q.kind) { params.push(q.kind); wh.push(`r.kind = $${params.length}`); }
  if (q.active === "true") wh.push("r.is_active");
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    `SELECT r.*, s.title AS sop_title
       FROM hr_rule r
       LEFT JOIN sop_document s ON s.sop_document_id = r.sop_document_id
       ${where}
      ORDER BY r.kind, r.code`,
    params,
  );
  return rows;
}

async function get(client, id) {
  const { rows } = await client.query(
    `SELECT r.*, s.title AS sop_title
       FROM hr_rule r
       LEFT JOIN sop_document s ON s.sop_document_id = r.sop_document_id
      WHERE r.hr_rule_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function create(client, { data, actor = {} }) {
  assertTiers(data.tiers);
  const { rows: clash } = await client.query("SELECT 1 FROM hr_rule WHERE code = $1", [data.code]);
  if (clash[0]) throw new AppError("DUPLICATE", `A rule with code ${data.code} already exists`, 409);
  const { rows } = await client.query(
    `INSERT INTO hr_rule (code, name, description, kind, metric, comparator, threshold, tiers,
                          effect, effect_value, auto_query, query_severity, query_due_days,
                          sop_document_id, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8,'[]'::jsonb),coalesce($9,'QUERY_ONLY'),$10,
             coalesce($11,false),coalesce($12,'WARNING'),coalesce($13,2),$14,coalesce($15,false))
     RETURNING *`,
    [data.code, data.name, data.description ?? null, data.kind, data.metric ?? null,
      data.comparator ?? null, data.threshold ?? null, data.tiers ? JSON.stringify(data.tiers) : null,
      data.effect, data.effect_value ?? null, data.auto_query, data.query_severity,
      data.query_due_days, data.sop_document_id ?? null, data.is_active],
  );
  await audit(client, { actorUserId: actor.user_id || null, action: "hr_rule.created", moduleKey: MODULE, entityRef: ref(rows[0].hr_rule_id), after: rows[0] });
  return rows[0];
}

/** `code` is not patchable — attendance resolves rules by kind and cites them
 *  by id, and a renamed code orphans the days already charged under it. */
const WRITABLE = ["name", "description", "metric", "comparator", "threshold", "tiers", "effect",
  "effect_value", "auto_query", "query_severity", "query_due_days", "sop_document_id", "is_active"];

async function update(client, { id, patch, actor = {} }) {
  const before = await get(client, id);
  if (!before) return null;
  assertTiers(patch.tiers);
  const sets = [];
  const params = [id];
  for (const c of WRITABLE) {
    if (patch[c] === undefined) continue;
    params.push(c === "tiers" ? JSON.stringify(patch[c]) : patch[c]);
    sets.push(`${c} = $${params.length}${c === "tiers" ? "::jsonb" : ""}`);
  }
  if (!sets.length) return before;
  const { rows } = await client.query(
    `UPDATE hr_rule SET ${sets.join(", ")}, updated_at = now() WHERE hr_rule_id = $1 RETURNING *`, params);
  // Turning a rule ON is the moment the company starts charging its staff.
  // Named separately in the audit so "since when?" has an answer that is not an
  // inference from when deductions first appeared.
  const action = patch.is_active !== undefined && patch.is_active !== before.is_active
    ? (patch.is_active ? "hr_rule.activated" : "hr_rule.deactivated")
    : "hr_rule.updated";
  await audit(client, { actorUserId: actor.user_id || null, action, moduleKey: MODULE, entityRef: ref(id), before, after: rows[0] });
  return rows[0];
}

async function archive(client, { id, actor = {} }) {
  const before = await get(client, id);
  if (!before) return null;
  if (before.is_system) {
    // A seeded rule may be deactivated but not deleted: `attendance_day` rows
    // point at it, and losing it turns every charge it made into an unexplained
    // number.
    throw new AppError("PROTECTED", `${before.name} is a built-in rule — deactivate it instead of deleting it`, 422);
  }
  await client.query("UPDATE hr_rule SET is_active = false, updated_at = now() WHERE hr_rule_id = $1", [id]);
  await audit(client, { actorUserId: actor.user_id || null, action: "hr_rule.deactivated", moduleKey: MODULE, entityRef: ref(id), before });
  return { archived: true, hr_rule_id: id };
}

module.exports = { list, get, create, update, archive, assertTiers };
