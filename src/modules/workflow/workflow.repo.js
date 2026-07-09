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
  async listApprovals(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = [];
    if (q.status) {
      params.push(q.status);
      wh.push(`status = $${params.length}`);
    }
    const where = wh.length ? `WHERE ${wh.join(" AND ")}` : "";
    const { rows } = await client.query(
      `SELECT * FROM approval_task ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },
};
