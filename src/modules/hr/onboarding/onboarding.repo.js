/**
 * Onboarding repository (MOD-16 / 0703) — checklists, items and templates.
 *
 * The SQL moved here from `onboarding.service.js`, which held it inline against
 * the module convention. Nothing else in this module could be tested or reused
 * while the queries lived in the same functions as the business rules.
 */
"use strict";
const { insertOne, getById, updateOne, listComplete } = require("../../../shared/db/query-helpers");

/* ── Checklists ─────────────────────────────────────────────────────────── */

/**
 * The checklist list, with progress counted in SQL.
 *
 * `overdue_items` is counted here rather than in the caller because it is the
 * column the list is SORTED by — a checklist with a statutory registration
 * three days late belongs at the top, and a screen that filters after fetching
 * can only sort the page it happens to have.
 */
async function listChecklists(client, { status = null } = {}) {
  const params = [];
  let where = "";
  if (status) { params.push(status); where = `WHERE c.status = $${params.length}`; }
  const { rows } = await listComplete(
    client,
    `SELECT c.onboarding_checklist_id, c.employee_id, c.status, c.created_at,
            c.starts_on, c.completed_at, c.onboarding_template_id, c.applicant_id,
            e.full_name AS employee_name, e.department, e.job_title,
            t.name AS template_name,
            count(i.onboarding_item_id)::int                                     AS total_items,
            count(i.onboarding_item_id) FILTER (WHERE i.is_done)::int            AS done_items,
            count(i.onboarding_item_id) FILTER (
              WHERE NOT i.is_done AND i.due_on IS NOT NULL AND i.due_on < CURRENT_DATE
            )::int                                                               AS overdue_items,
            count(i.onboarding_item_id) FILTER (
              WHERE NOT i.is_done AND i.is_mandatory
            )::int                                                               AS mandatory_outstanding
       FROM onboarding_checklist c
       LEFT JOIN employee e            ON e.employee_id = c.employee_id
       LEFT JOIN onboarding_template t ON t.onboarding_template_id = c.onboarding_template_id
       LEFT JOIN onboarding_item i     ON i.onboarding_checklist_id = c.onboarding_checklist_id
       ${where}
      GROUP BY c.onboarding_checklist_id, e.full_name, e.department, e.job_title, t.name
      ORDER BY overdue_items DESC, c.created_at DESC`,
    params,
    { label: "Onboarding checklists", ceiling: 5000 },
  );
  return rows;
}

async function getChecklist(client, id) {
  const { rows } = await client.query(
    `SELECT c.*, e.full_name AS employee_name, e.department, e.job_title,
            t.name AS template_name
       FROM onboarding_checklist c
       LEFT JOIN employee e            ON e.employee_id = c.employee_id
       LEFT JOIN onboarding_template t ON t.onboarding_template_id = c.onboarding_template_id
      WHERE c.onboarding_checklist_id = $1`,
    [id],
  );
  return rows[0] || null;
}

const insertChecklist = (client, data) => insertOne(client, "onboarding_checklist", data);
const updateChecklist = (client, id, patch) => updateOne(client, "onboarding_checklist", "onboarding_checklist_id", id, patch);

/** Does this employee already have a checklist? The guard that stops the HIRED
 *  hook raising a second one when somebody re-saves the status. */
async function checklistForEmployee(client, employeeId) {
  const { rows } = await client.query(
    "SELECT * FROM onboarding_checklist WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 1",
    [employeeId],
  );
  return rows[0] || null;
}

/* ── Items ──────────────────────────────────────────────────────────────── */

const insertItem = (client, data) => insertOne(client, "onboarding_item", data);
const getItem = (client, id) => getById(client, "onboarding_item", "onboarding_item_id", id);
const updateItem = (client, id, patch) => updateOne(client, "onboarding_item", "onboarding_item_id", id, patch);

async function listItems(client, checklistId) {
  const { rows } = await listComplete(
    client,
    `SELECT i.*, s.title AS sop_title, u.full_name AS assignee_name, d.full_name AS done_by_name
       FROM onboarding_item i
       LEFT JOIN sop_document s ON s.sop_document_id = i.sop_document_id
       LEFT JOIN app_user u     ON u.user_id = i.assigned_to
       LEFT JOIN app_user d     ON d.user_id = i.done_by
      WHERE i.onboarding_checklist_id = $1
      -- By plan order, not by done-ness. Sinking completed items reorders the
      -- list under somebody as they tick, which loses their place.
      ORDER BY i.sort_order, i.due_on NULLS LAST, i.onboarding_item_id`,
    [checklistId],
    { label: "Onboarding items", ceiling: 2000 },
  );
  return rows;
}

/** Everything outstanding and dated, across every open checklist — what a
 *  "what is late" panel reads without fetching each checklist in turn. */
async function outstandingItems(client, { days = 14 } = {}) {
  const { rows } = await client.query(
    `SELECT i.onboarding_item_id, i.label, i.due_on, i.owner_role, i.is_mandatory,
            i.onboarding_checklist_id,
            e.full_name AS employee_name, c.starts_on
       FROM onboarding_item i
       JOIN onboarding_checklist c ON c.onboarding_checklist_id = i.onboarding_checklist_id
       LEFT JOIN employee e        ON e.employee_id = c.employee_id
      WHERE i.is_done = false
        AND c.status = 'OPEN'
        AND i.due_on IS NOT NULL
        AND i.due_on <= (CURRENT_DATE + ($1 || ' days')::interval)
      ORDER BY i.due_on ASC`,
    [String(Math.max(0, Number(days) || 0))],
  );
  return rows;
}

/* ── Templates ──────────────────────────────────────────────────────────── */

const insertTemplate = (client, data) => insertOne(client, "onboarding_template", data);
const getTemplate = (client, id) => getById(client, "onboarding_template", "onboarding_template_id", id);
const updateTemplate = (client, id, patch) => updateOne(client, "onboarding_template", "onboarding_template_id", id, patch);

async function listTemplates(client, { includeInactive = false } = {}) {
  const { rows } = await listComplete(
    client,
    `SELECT t.*,
            (SELECT count(*)::int FROM onboarding_template_item x
              WHERE x.onboarding_template_id = t.onboarding_template_id) AS item_count
       FROM onboarding_template t
      ${includeInactive ? "" : "WHERE t.is_active = true"}
      ORDER BY t.is_active DESC, t.priority DESC, t.name`,
    [],
    { label: "Onboarding templates", ceiling: 500 },
  );
  return rows;
}

const insertTemplateItem = (client, data) => insertOne(client, "onboarding_template_item", data);
const getTemplateItem = (client, id) => getById(client, "onboarding_template_item", "onboarding_template_item_id", id);
const updateTemplateItem = (client, id, patch) => updateOne(client, "onboarding_template_item", "onboarding_template_item_id", id, patch);

async function listTemplateItems(client, templateId) {
  const { rows } = await listComplete(
    client,
    `SELECT i.*, s.title AS sop_title
       FROM onboarding_template_item i
       LEFT JOIN sop_document s ON s.sop_document_id = i.sop_document_id
      WHERE i.onboarding_template_id = $1
      ORDER BY i.sort_order, i.onboarding_template_item_id`,
    [templateId],
    { label: "Onboarding template items", ceiling: 500 },
  );
  return rows;
}

async function deleteTemplateItem(client, id) {
  const { rows } = await client.query(
    "DELETE FROM onboarding_template_item WHERE onboarding_template_item_id = $1 RETURNING *",
    [id],
  );
  return rows[0] || null;
}

module.exports = {
  listChecklists, getChecklist, insertChecklist, updateChecklist, checklistForEmployee,
  insertItem, getItem, updateItem, listItems, outstandingItems,
  listTemplates, getTemplate, insertTemplate, updateTemplate,
  listTemplateItems, getTemplateItem, insertTemplateItem, updateTemplateItem, deleteTemplateItem,
};
