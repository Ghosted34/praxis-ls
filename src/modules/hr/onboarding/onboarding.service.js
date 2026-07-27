/**
 * Onboarding checklists (MOD-16). A per-new-hire checklist of items that get
 * ticked off; when the work is done the checklist is marked COMPLETED. Built on
 * the sop_onboarding tables (onboarding_checklist + onboarding_item).
 */
"use strict";
const { audit } = require("../../../shared/events/emit");

const MODULE = "MOD-16";
const ref = (id) => "onboarding_checklist:" + id;

async function list(client) {
  const { rows } = await client.query(
    `SELECT c.onboarding_checklist_id, c.employee_id, c.status, c.created_at,
            e.full_name AS employee_name,
            count(i.onboarding_item_id)::int AS total_items,
            count(i.onboarding_item_id) FILTER (WHERE i.is_done)::int AS done_items
       FROM onboarding_checklist c
       LEFT JOIN employee e ON e.employee_id = c.employee_id
       LEFT JOIN onboarding_item i ON i.onboarding_checklist_id = c.onboarding_checklist_id
      GROUP BY c.onboarding_checklist_id, e.full_name
      ORDER BY c.created_at DESC`,
  );
  return rows;
}

async function get(client, id) {
  const { rows: cs } = await client.query(
    `SELECT c.*, e.full_name AS employee_name
       FROM onboarding_checklist c
       LEFT JOIN employee e ON e.employee_id = c.employee_id
      WHERE c.onboarding_checklist_id = $1`,
    [id],
  );
  if (!cs[0]) return null;
  const { rows: items } = await client.query(
    `SELECT * FROM onboarding_item WHERE onboarding_checklist_id = $1 ORDER BY (done_at IS NOT NULL), onboarding_item_id`,
    [id],
  );
  return { ...cs[0], items };
}

async function create(client, { employee_id, items = [], actor = {} }) {
  const { rows } = await client.query(
    "INSERT INTO onboarding_checklist (employee_id) VALUES ($1) RETURNING *",
    [employee_id || null],
  );
  const checklist = rows[0];
  for (const label of items) {
    if (label && String(label).trim()) {
      await client.query(
        "INSERT INTO onboarding_item (onboarding_checklist_id, label) VALUES ($1,$2)",
        [checklist.onboarding_checklist_id, String(label).trim()],
      );
    }
  }
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.created", moduleKey: MODULE, entityRef: ref(checklist.onboarding_checklist_id), after: checklist });
  return get(client, checklist.onboarding_checklist_id);
}

async function addItem(client, { checklistId, label }) {
  const { rows } = await client.query(
    "INSERT INTO onboarding_item (onboarding_checklist_id, label) VALUES ($1,$2) RETURNING *",
    [checklistId, label],
  );
  return rows[0];
}

async function toggleItem(client, { itemId, isDone }) {
  const { rows } = await client.query(
    `UPDATE onboarding_item
        SET is_done = $2, done_at = CASE WHEN $2 THEN now() ELSE NULL END
      WHERE onboarding_item_id = $1 RETURNING *`,
    [itemId, isDone],
  );
  return rows[0] || null;
}

async function complete(client, { id, actor = {} }) {
  const { rows } = await client.query(
    "UPDATE onboarding_checklist SET status = 'COMPLETED' WHERE onboarding_checklist_id = $1 RETURNING *",
    [id],
  );
  if (!rows[0]) return null;
  await audit(client, { actorUserId: actor.user_id || null, action: "onboarding.completed", moduleKey: MODULE, entityRef: ref(id), after: rows[0] });
  return get(client, id);
}

module.exports = { list, get, create, addItem, toggleItem, complete };
