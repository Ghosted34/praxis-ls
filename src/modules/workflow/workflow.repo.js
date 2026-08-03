/**
 * Data access for the Universal Event Engine admin surface. Spans four tables
 * (all migrations/tenant/0120_events_workflow.sql):
 *   event_type    — the registry of emittable events (registration endpoint)
 *   workflow      — a validate/approve chain bound to an approvable event_type
 *   workflow_step — the ordered steps of that chain
 *   approval_task — runtime instances (read-only here; created by the emit path
 *                   when Phase 1/2 business flows start raising approvals)
 * No ORM — parameterised query helpers, same convention as every other repo.
 */
"use strict";

const { insertOne, updateOne, getById, page } = require("../../shared/db/query-helpers");

module.exports = {
  // ---- event_type (registration) ----
  async listEventTypes(client, q = {}) {
    const { limit, offset } = page(q);
    const { rows } = await client.query(
      `SELECT * FROM event_type ORDER BY module_key, key LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  },
  getEventTypeByKey(client, key) {
    return client
      .query(`SELECT * FROM event_type WHERE key = $1`, [key])
      .then((r) => r.rows[0] || null);
  },
  registerEventType(client, data) {
    // key is UNIQUE — ON CONFLICT keeps registration idempotent (re-registering
    // an existing key updates its descriptive fields rather than 500-ing).
    return client
      .query(
        `INSERT INTO event_type (key, module_key, name, description, is_security_critical, is_approvable)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (key) DO UPDATE SET
           module_key = EXCLUDED.module_key,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           is_security_critical = EXCLUDED.is_security_critical,
           is_approvable = EXCLUDED.is_approvable
         RETURNING *`,
        [
          data.key,
          data.module_key,
          data.name,
          data.description || null,
          data.is_security_critical === true,
          data.is_approvable === true,
        ],
      )
      .then((r) => r.rows[0]);
  },

  // ---- workflow ----
  async listWorkflows(client, q = {}) {
    const { limit, offset } = page(q);
    const { rows } = await client.query(
      `SELECT w.*, et.key AS event_type_key
         FROM workflow w
         JOIN event_type et ON et.event_type_id = w.event_type_id
        ORDER BY w.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  },
  getWorkflow(client, id) {
    return getById(client, "workflow", "workflow_id", id);
  },
  createWorkflow(client, data) {
    return insertOne(client, "workflow", {
      event_type_id: data.event_type_id,
      name: data.name,
    });
  },
  updateWorkflow(client, id, patch) {
    return updateOne(client, "workflow", "workflow_id", id, patch);
  },

  // ---- workflow_step ----
  async listSteps(client, workflowId) {
    const { rows } = await client.query(
      `SELECT * FROM workflow_step WHERE workflow_id = $1 ORDER BY step_seq ASC`,
      [workflowId],
    );
    return rows;
  },
  addStep(client, data) {
    return insertOne(client, "workflow_step", {
      workflow_id: data.workflow_id,
      step_seq: data.step_seq,
      step_kind: data.step_kind,
      role_id: data.role_id || null,
      capability_code: data.capability_code || null,
      scope_id: data.scope_id || null,
      min_amount_xaf: data.min_amount_xaf ?? null,
      max_amount_xaf: data.max_amount_xaf ?? null,
    });
  },
  async removeStep(client, workflowId, stepId) {
    const { rows } = await client.query(
      `DELETE FROM workflow_step WHERE workflow_step_id = $1 AND workflow_id = $2 RETURNING workflow_step_id`,
      [stepId, workflowId],
    );
    return rows[0] || null;
  },

  // ---- approval_task (read-only runtime view) ----
  /**
   * The approvals queue.
   *
   * `approval_task` is introduced in schema as "approvals waiting on me"
   * (0120_events_workflow.sql:62) but this filtered on status and nothing else,
   * so every user with MOD-67 view saw every pending task in the tenant and the
   * KPI tiles counted the lot (audit finding W12).
   *
   * `viewer` narrows it to what the caller could actually act on:
   *   · roleIds     — a task assigned to a role the caller does not hold is not
   *                   theirs. Tasks with NO assigned role stay visible: an
   *                   unassigned step is open to anyone, which is every step
   *                   built through the designer before it grew a role picker,
   *                   so excluding them would empty the inbox on real data.
   *   · moduleKeys  — modules the caller holds `approve` on, matching the
   *                   per-task gate on the act route (0488 / W3). Tasks with a
   *                   null module_key stay visible for the same reason the
   *                   permission check falls back rather than denying.
   *   · isCeo       — sees everything, consistent with the RBAC bypass.
   *
   * Passing no `viewer` returns the unfiltered queue — that is the admin
   * overview and what the existing callers get until they opt in.
   */
  async listApprovals(client, q = {}, viewer = null) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.status) {
      params.push(q.status);
      wh.push(`at.status = $${params.length}`);
    }
    if (viewer && viewer.isCeo !== true) {
      const roleIds = Array.isArray(viewer.roleIds) ? viewer.roleIds : [];
      params.push(roleIds);
      wh.push(`(at.assigned_role_id IS NULL OR at.assigned_role_id = ANY($${params.length}::uuid[]))`);

      const moduleKeys = Array.isArray(viewer.moduleKeys) ? viewer.moduleKeys : [];
      params.push(moduleKeys);
      wh.push(`(at.module_key IS NULL OR at.module_key = ANY($${params.length}::citext[]))`);
    }
    const where = wh.length ? `WHERE ${wh.join(" AND ")}` : "";
    // Decorate for a human-readable inbox: the workflow name, the current stage,
    // and (for the live HR case) a leave summary so rows don't read as raw
    // "prefix:uuid". Other entity types fall back to a humanised ref client-side.
    const { rows } = await client.query(
      `SELECT at.*,
              w.name        AS workflow_name,
              ws.step_kind  AS step_kind,
              ws.step_seq   AS step_seq,
              lr.kind       AS leave_kind,
              lr.starts_on  AS leave_starts,
              lr.ends_on    AS leave_ends,
              e.full_name   AS leave_employee
         FROM approval_task at
         LEFT JOIN workflow      w  ON w.workflow_id       = at.workflow_id
         LEFT JOIN workflow_step ws ON ws.workflow_step_id = at.workflow_step_id
         LEFT JOIN leave_request lr ON at.entity_ref = 'leave_allowance:' || lr.leave_request_id::text
         LEFT JOIN employee      e  ON e.employee_id = lr.employee_id
         ${where}
        ORDER BY at.created_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
};
