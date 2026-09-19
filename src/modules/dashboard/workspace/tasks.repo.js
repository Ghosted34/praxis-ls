"use strict";
/**
 * My Workspace — data access for tasks and calendar events (MOD-00A).
 *
 * Every function takes the tenant client first, so it joins the request's
 * connection and can be called inside a transaction. SQL lives ONLY here
 * (doc/CONVENTIONS.md, "Layer rules").
 *
 * ── VISIBILITY ─────────────────────────────────────────────────────────────
 *
 * `visibleWhere` below is the single place the audience rules are written, and
 * it is the whole of them. Three audiences, decided by the service from
 * `req.permission_scope` (set by middleware/rbac.js):
 *
 *   mine  assigned to me OR written by me
 *   team  additionally, everything belonging to my part of the organigramme
 *         (req.scope_ids — the scope CLOSURE, so a manager at HQ sees branches)
 *   all   the tenant
 *
 * `personalOnly` is layered on top and is not an audience: a task flagged
 * `is_personal` is on its creator's desk and nobody else's, whatever the
 * caller's reach. It cannot be expressed as a scope because it is a property
 * of the row, not of the reader.
 *
 * The scope predicate deliberately keeps rows with NO scope visible
 * (`t.scope_id IS NULL OR …`) — see shared/crud/resource.js for why excluding
 * them is the worse failure.
 */

/**
 * Build the shared visibility predicate.
 *
 * Returns the SQL fragment and how many placeholders it consumed, so callers
 * can keep numbering their own parameters after it. Building this once rather
 * than per query is the point: a rule that lives in six WHERE clauses drifts,
 * and the drift is invisible because each query still returns rows.
 */
const { atomically } = require("../../../shared/db/tx");

function visibleWhere(v = {}, start = 1) {
  const p = [];
  const sql = [];
  if (v.audience === "mine" && v.userId) {
    p.push(v.userId);
    sql.push(`(t.assigned_to = $${start + p.length - 1} OR t.created_by = $${start + p.length - 1})`);
  } else if (v.audience === "team" && v.userId) {
    if (v.scopeIds && v.scopeIds.length) {
      p.push(v.userId, v.scopeIds);
      sql.push(
        `(t.assigned_to = $${start} OR t.created_by = $${start}
          OR t.scope_id IS NULL OR t.scope_id = ANY($${start + 1}::uuid[]))`,
      );
    } else {
      p.push(v.userId);
      sql.push(`(t.assigned_to = $${start} OR t.created_by = $${start})`);
    }
  }
  // A personal task is the creator's alone. `assigned_to = me` still shows it:
  // you were handed it, so it is on your desk whatever its flag says.
  if (v.personalOnly && v.userId) {
    p.push(v.userId);
    sql.push(`(t.is_personal = false OR t.created_by = $${start + p.length - 1} OR t.assigned_to = $${start + p.length - 1})`);
  }
  return { sql, params: p, next: start + p.length };
}

/**
 * Event visibility uses the same audience vocabulary as Tasks, with one
 * additional personal relationship: an invited internal participant can see
 * the event even when they did not create it.
 *
 * `calendar_event.scope_id` is deliberately nullable. An unscoped event is
 * visible to an authorised team read, while a scoped event requires the
 * caller's organigramme closure.
 */
function eventVisibleWhere(v = {}, start = 1) {
  const p = [];
  const sql = [];
  if (!v.userId) return { sql: ["FALSE"], params: p, next: start };

  p.push(v.userId);
  const userParam = start;
  const participant = `EXISTS (SELECT 1 FROM calendar_participant pv WHERE pv.calendar_event_id = e.calendar_event_id AND pv.user_id = $${userParam})`;

  if (v.audience === "all" && v.permissionScope === "all") {
    return { sql, params: p.slice(0, 0), next: start };
  }
  if (v.audience === "team" && v.scopeIds && v.scopeIds.length) {
    p.push(v.scopeIds);
    sql.push(`(e.created_by = $${userParam} OR ${participant} OR e.scope_id IS NULL OR e.scope_id = ANY($${start + 1}::uuid[]))`);
  } else {
    sql.push(`(e.created_by = $${userParam} OR ${participant})`);
  }
  return { sql, params: p, next: start + p.length };
}

/** Subtask progress, as two correlated counts rather than a join+group. */
const SUBTASK_COUNTS = `
  (SELECT count(*)::int FROM task_subtask s WHERE s.task_id = t.task_id) AS subtask_count,
  (SELECT count(*)::int FROM task_subtask s WHERE s.task_id = t.task_id AND s.is_done) AS subtask_done_count`;

/**
 * The linked operations file and stage, as a reader needs them (13920).
 *
 * `dossier_visible`, not `dossier`: the picker only ever offers non-draft
 * files, so joining the view costs nothing and keeps this out of the
 * base-table allow-list `dossier-draft-isolation.test.js` maintains. A LEFT
 * join throughout — the link is optional on nearly every task, and an INNER
 * join here would silently drop every unlinked row from the list.
 */
const LINK_JOINS = `
    LEFT JOIN dossier_visible dv ON dv.dossier_id = t.dossier_id
    LEFT JOIN client_master dcm ON dcm.client_id = dv.client_id
    LEFT JOIN milestone_instance mi ON mi.milestone_instance_id = t.milestone_instance_id`;

/**
 * Every stage the task is on, in chain order (13950).
 *
 * A correlated aggregate rather than a fourth LEFT JOIN: a join would multiply
 * each task row by its stage count and break `COUNT(*) OVER()`, the board's
 * per-column cap and every LIMIT in this file. `t.milestone_instance_id` stays
 * joined above as the FIRST stage — it is the projection the service keeps
 * in step with this set, so a reader that knows only 13920's column still
 * sees a stage. Empty array, never NULL, so a card can `.map` without a guard.
 */
const MILESTONES_COL = `(SELECT COALESCE(json_agg(json_build_object(
                    'milestone_instance_id', tmi.milestone_instance_id,
                    'label', tmi.label,
                    'stage_seq', tmi.stage_seq,
                    'status', tmi.status)
                  ORDER BY tmi.stage_seq, tmi.label), '[]'::json)
            FROM task_milestone tm
            JOIN milestone_instance tmi ON tmi.milestone_instance_id = tm.milestone_instance_id
           WHERE tm.task_id = t.task_id) AS milestones`;

const LINK_COLS = `
         dv.ref        AS dossier_ref,
         dcm.name      AS dossier_client_name,
         mi.label      AS milestone_label,
         mi.stage_seq  AS milestone_stage_seq,
         mi.status     AS milestone_status,
         ${MILESTONES_COL}`;


const TASK_SELECT = `
  SELECT t.*,
         a.full_name AS assigned_to_name,
         c.full_name AS created_by_name,
         ${LINK_COLS},
         ${SUBTASK_COUNTS}
    FROM task t
    LEFT JOIN app_user a ON a.user_id = t.assigned_to
    LEFT JOIN app_user c ON c.user_id = t.created_by${LINK_JOINS}`;

/**
 * The same select plus the pre-LIMIT total, for the one caller that paginates.
 *
 * A separate `SELECT COUNT(*)` would need this exact WHERE clause a second
 * time, and the two copies would drift the first time a filter is added to one
 * and not the other — which is precisely the bug API F-26 records.
 */
const TASK_SELECT_PAGED = TASK_SELECT.replace(
  "SELECT t.*,",
  "SELECT t.*, COUNT(*) OVER() AS _total,",
);

/* ══════════════════════════════════ TASKS ════════════════════════════════ */

/**
 * One page of tasks.
 *
 * LIMIT/OFFSET are $1/$2 — the same shape shared/db/query-helpers `page()`
 * produces — so the pagination contract is identical to every other list in
 * the product. `COUNT(*) OVER()` gets the pre-LIMIT total in the SAME query:
 * a second `SELECT COUNT(*)` would duplicate this WHERE and the two copies
 * would drift (API F-26).
 */
/**
 * "Is on this stage" — the list's milestone filter, against the SET (13950).
 *
 * Not `t.milestone_instance_id = $n`: that column is only the first stage of
 * the set, and a task filed under two stages would vanish from the second
 * stage's view — the exact gap several stages exist to close.
 */
const onStage = (n) =>
  `EXISTS (SELECT 1 FROM task_milestone tm WHERE tm.task_id = t.task_id AND tm.milestone_instance_id = $${n})`;

/**
 * Free-text search over what a person remembers about a task.
 *
 * The title alone was the whole of `q` until now, and it is the field people
 * remember LEAST reliably: "the one about the Brasseries container" is a
 * client name, "the BL chase on SL3213" is a file reference, and "call before
 * the scanner slot" lives in the notes. So `q` matches the title, the notes,
 * the linked file's reference and its client's name, and the title of any
 * step under the task. One pattern, bound once, tested against each column —
 * the same `ILIKE '%…%'` the rest of the module's search uses, on lists whose
 * scope (a person's own work, a team's) is small enough that an index would
 * not change the answer.
 *
 * `_` and `%` in what the user typed are escaped so "100%" searches for the
 * literal string rather than for "100" followed by anything.
 */
const searchPattern = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const SEARCH_WHERE = (n) =>
  `(t.title ILIKE $${n} OR t.description ILIKE $${n} OR dv.ref ILIKE $${n} OR dcm.name ILIKE $${n}
      OR EXISTS (SELECT 1 FROM task_subtask sq WHERE sq.task_id = t.task_id AND sq.title ILIKE $${n}))`;

/**
 * A safe ORDER BY, built from an allow-list rather than interpolated — a sort
 * column taken from the query string and dropped into SQL is the one injection
 * this endpoint would otherwise expose.
 */
const TASK_ORDER = {
  due_asc: "ORDER BY (t.due_at IS NULL), t.due_at ASC NULLS LAST, t.created_at DESC",
  due_desc: "ORDER BY t.due_at DESC NULLS LAST, t.created_at DESC",
  created_desc: "ORDER BY t.created_at DESC",
  priority_desc: "ORDER BY array_position(ARRAY['LOW','NORMAL','HIGH','URGENT'], t.priority) DESC, t.created_at DESC",
};

async function listTasks(client, { audience, userId, scopeIds, personalOnly, status, priority, assignedTo, q, entity, dossierId, milestoneInstanceId, sort = "due_asc", limit = 50, offset = 0 }) {
  const params = [limit, offset];
  const where = ["t.is_deleted = false"];
  if (status) { params.push(status); where.push(`t.status = $${params.length}`); }
  if (priority) { params.push(priority); where.push(`t.priority = $${params.length}`); }
  if (assignedTo) { params.push(assignedTo); where.push(`t.assigned_to = $${params.length}`); }
  if (dossierId) { params.push(dossierId); where.push(`t.dossier_id = $${params.length}`); }
  if (milestoneInstanceId) { params.push(milestoneInstanceId); where.push(onStage(params.length)); }
  if (q) { params.push(searchPattern(q)); where.push(SEARCH_WHERE(params.length)); }
  if (entity) {
    params.push(entity.entity_type, entity.entity_id);
    where.push(`t.entity_type = $${params.length - 1} AND t.entity_id = $${params.length}`);
  }
  const vis = visibleWhere({ audience, userId, scopeIds, personalOnly }, params.length + 1);
  params.push(...vis.params);
  where.push(...vis.sql);

  const order = TASK_ORDER[sort] || TASK_ORDER.due_asc;
  const { rows } = await client.query(
    `${TASK_SELECT_PAGED}
      WHERE ${where.join(" AND ")}
      ${order}
      LIMIT $1 OFFSET $2`,
    params,
  );
  return { rows, total: rows.length ? Number(rows[0]._total) : 0 };
}

/**
 * The kanban board: open tasks grouped by status.
 *
 * CANCELLED is excluded by the predicate, not filtered afterwards — a
 * cancelled task is not a column, and shipping it to the client to hide would
 * mean the "50 per column" cap counted rows nobody sees.
 *
 * Ordered urgent-first then soonest-due, so a column reads as a work queue
 * rather than as a list in the order things happened to be written.
 */
const BOARD_LIMIT = 200;

async function boardTasks(client, { audience, userId, scopeIds, personalOnly, assignedTo, dossierId, q, limit = BOARD_LIMIT }) {
  const params = [];
  const where = ["t.is_deleted = false", "t.status <> 'CANCELLED'"];
  if (assignedTo) { params.push(assignedTo); where.push(`t.assigned_to = $${params.length}`); }
  if (dossierId) { params.push(dossierId); where.push(`t.dossier_id = $${params.length}`); }
  // The same search the list answers, so Board↔List does not change what a
  // typed query finds (title, notes, file reference, client, step titles).
  if (q) { params.push(searchPattern(q)); where.push(SEARCH_WHERE(params.length)); }
  const vis = visibleWhere({ audience, userId, scopeIds, personalOnly }, params.length + 1);
  params.push(...vis.params);
  where.push(...vis.sql);

  // `COUNT(*) OVER()` gives the pre-LIMIT total in the SAME query and against
  // the SAME predicate — the only way the board can honestly say "showing 200
  // of 612" rather than presenting a truncated wall of cards as the whole
  // truth. A second `SELECT COUNT(*)` would duplicate this WHERE and the two
  // copies would drift (API F-26, the reason `TASK_SELECT_PAGED` exists).
  const limitParam = params.length + 1;
  params.push(limit);
  const { rows } = await client.query(
    `${TASK_SELECT_PAGED}
      WHERE ${where.join(" AND ")}
      ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
               (t.due_at IS NULL), t.due_at ASC NULLS LAST, t.created_at DESC
      LIMIT $${limitParam}`,
    params,
  );
  const board = { TO_DO: [], IN_PROGRESS: [], IN_REVIEW: [], DONE: [] };
  // `_total` is the window function's bookkeeping, not a field of a task. It is
  // dropped from every card so the board payload stays the shape the client's
  // `Task` type declares rather than leaking a column named like a private.
  for (const r of rows) {
    if (!board[r.status]) continue;
    const { _total, ...card } = r;
    board[r.status].push(card);
  }
  const total = rows.length ? Number(rows[0]._total) : 0;
  return { board, total, shown: rows.length, limit, truncated: total > rows.length };
}

/**
 * Tasks whose due date falls in a range. Feeds the merged Today timeline,
 * where tasks and events are interleaved by WHEN rather than listed apart.
 */
async function tasksInRange(client, { from, to, visibility }) {
  const params = [from, to];
  const where = ["t.is_deleted = false", "t.due_at >= $1", "t.due_at < $2"];
  const vis = visibleWhere(visibility, params.length + 1);
  params.push(...vis.params);
  where.push(...vis.sql);
  const { rows } = await client.query(
    `${TASK_SELECT} WHERE ${where.join(" AND ")} ORDER BY t.due_at ASC NULLS LAST LIMIT 200`,
    params,
  );
  return rows;
}

/**
 * Subtask deadlines falling in a range, with the parent they belong to.
 *
 * Joined to `task` so the SAME visibility rule that hides a task hides its
 * steps — a step you cannot see the task for is a leak. `visibleWhere` writes
 * its predicate against `t.`, which is why the parent is aliased `t` here.
 */
async function subtasksInRange(client, { from, to, visibility }) {
  const params = [from, to];
  const where = ["t.is_deleted = false", "s.due_at >= $1", "s.due_at < $2"];
  const vis = visibleWhere(visibility, params.length + 1);
  params.push(...vis.params);
  where.push(...vis.sql);
  // The parent's notes and file ride along so the calendar's filter can find
  // a step by what its task is about — the same words that find the task.
  const { rows } = await client.query(
    `SELECT s.task_subtask_id, s.task_id, s.title, s.due_at, s.is_done,
            t.title AS task_title, t.status AS task_status, t.priority AS task_priority,
            t.entity_type, t.entity_id, t.description AS task_description,
            dv.ref AS dossier_ref, dcm.name AS dossier_client_name
       FROM task_subtask s
       JOIN task t ON t.task_id = s.task_id
       LEFT JOIN dossier_visible dv ON dv.dossier_id = t.dossier_id
       LEFT JOIN client_master dcm ON dcm.client_id = dv.client_id
      WHERE ${where.join(" AND ")}
      ORDER BY s.due_at ASC NULLS LAST
      LIMIT 200`,
    params,
  );
  return rows;
}

const DAY_TASK_LIMIT = 200;
const DAY_SUBTASK_LIMIT = 200;

/** One segment of actionable task deadlines for Today. */
async function dayTaskSegment(client, { from, to, visibility, overdue, limit = DAY_TASK_LIMIT }) {
  // The overdue segment is bounded by `from` alone, so `to` is NOT bound into
  // its statement. It cannot simply be carried along for symmetry: Postgres has
  // no type for a parameter the statement never mentions and refuses the query
  // with SQLSTATE 42P18 ("could not determine data type of parameter $2"). One
  // segment failing rejects the `Promise.all` behind `/workspace/day`, so the
  // whole Today read returned a 500. The rule is that a query's parameter array
  // is built for THAT query's placeholders — `params.length + 1` below is what
  // keeps the visibility and limit numbering correct either way.
  const params = overdue ? [from] : [from, to];
  const where = [
    "t.is_deleted = false",
    "t.status NOT IN ('DONE','CANCELLED')",
    overdue ? "t.due_at < $1" : "t.due_at >= $1 AND t.due_at < $2",
  ];
  const vis = visibleWhere(visibility, params.length + 1);
  params.push(...vis.params);
  where.push(...vis.sql);
  const limitParam = params.length + 1;
  params.push(limit);
  const { rows } = await client.query(
    `${TASK_SELECT.replace("SELECT t.*,", "SELECT t.*, COUNT(*) OVER() AS _total,")}
      WHERE ${where.join(" AND ")}
      ORDER BY t.due_at ${overdue ? "DESC" : "ASC"} NULLS LAST
      LIMIT $${limitParam}`,
    params,
  );
  const total = rows.length ? Number(rows[0]._total) : 0;
  return { rows, total, truncated: total > rows.length };
}

/**
 * Today includes the current tenant-local window and the most recent overdue
 * carry-over. Keeping the two segments separate lets the response advertise a
 * cap without allowing a large historical overdue queue to crowd out today's
 * work.
 */
async function dayTasks(client, { from, to, visibility, limit = DAY_TASK_LIMIT }) {
  const [current, overdue] = await Promise.all([
    dayTaskSegment(client, { from, to, visibility, overdue: false, limit }),
    dayTaskSegment(client, { from, to, visibility, overdue: true, limit }),
  ]);
  return {
    rows: [...current.rows, ...overdue.rows],
    total: current.total + overdue.total,
    truncated: current.truncated || overdue.truncated,
  };
}

async function daySubtaskSegment(client, { from, to, visibility, overdue, limit = DAY_SUBTASK_LIMIT }) {
  // Same one-bound window as `dayTaskSegment` above, and the same reason `to`
  // is bound only when the statement actually reads it.
  const params = overdue ? [from] : [from, to];
  const where = [
    "t.is_deleted = false",
    "t.status NOT IN ('DONE','CANCELLED')",
    "s.is_done = false",
    overdue ? "s.due_at < $1" : "s.due_at >= $1 AND s.due_at < $2",
  ];
  const vis = visibleWhere(visibility, params.length + 1);
  params.push(...vis.params);
  where.push(...vis.sql);
  const limitParam = params.length + 1;
  params.push(limit);
  const { rows } = await client.query(
    `SELECT s.task_subtask_id, s.task_id, s.title, s.due_at, s.is_done,
            t.title AS task_title, t.status AS task_status, t.priority AS task_priority,
            t.entity_type, t.entity_id, COUNT(*) OVER() AS _total
       FROM task_subtask s
       JOIN task t ON t.task_id = s.task_id
      WHERE ${where.join(" AND ")}
      ORDER BY s.due_at ${overdue ? "DESC" : "ASC"} NULLS LAST
      LIMIT $${limitParam}`,
    params,
  );
  const total = rows.length ? Number(rows[0]._total) : 0;
  return { rows, total, truncated: total > rows.length };
}

async function daySubtasks(client, { from, to, visibility, limit = DAY_SUBTASK_LIMIT }) {
  const [current, overdue] = await Promise.all([
    daySubtaskSegment(client, { from, to, visibility, overdue: false, limit }),
    daySubtaskSegment(client, { from, to, visibility, overdue: true, limit }),
  ]);
  return {
    rows: [...current.rows, ...overdue.rows],
    total: current.total + overdue.total,
    truncated: current.truncated || overdue.truncated,
  };
}

async function insertTask(client, t) {
  const { rows } = await client.query(
    `INSERT INTO task (
       title, description, status, priority, assigned_to, created_by, due_at,
       parent_task_id, entity_type, entity_id, is_personal, scope_id,
       recurrence_rule, recurrence_series_id, dossier_id, milestone_instance_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      t.title, t.description ?? null, t.status || "TO_DO", t.priority || "NORMAL",
      t.assigned_to ?? null, t.created_by, t.due_at ?? null, t.parent_task_id ?? null,
      t.entity_type ?? null, t.entity_id ?? null, t.is_personal === true, t.scope_id ?? null,
      t.recurrence_rule ?? null, t.recurrence_series_id ?? null,
      t.dossier_id ?? null, t.milestone_instance_id ?? null,
    ],
  );
  return rows[0];
}

/**
 * One task with its owner names. `findTask` is deliberately NOT visibility
 * filtered: deciding whether the caller may see it is the SERVICE's job, so
 * that "does not exist" and "not yours" can be answered differently — and so
 * the reminder sweep can read any row regardless of who is asking.
 */
async function findTask(client, id) {
  const { rows } = await client.query(`${TASK_SELECT} WHERE t.task_id = $1 AND t.is_deleted = false`, [id]);
  return rows[0] || null;
}

/**
 * Patch the mutable columns.
 *
 * `remind_at` is NOT in the allow-list on purpose: it is derived, and letting a
 * caller set it directly would desynchronise it from `reminder_minutes`. The
 * service computes it and passes `rearm` when it changes. `recurrence_cursor_at`
 * is excluded for the same reason — it is the sweep's bookkeeping and is written
 * only by `advanceTaskCursor`/`endTaskRecurrence`, never by a PATCH.
 */
async function updateTask(client, id, patch) {
  const sets = [];
  const params = [];
  for (const key of ["title", "description", "status", "priority", "assigned_to", "due_at",
    "entity_type", "entity_id", "dossier_id", "milestone_instance_id", "is_personal",
    "recurrence_rule", "recurrence_series_id"]) {
    if (!(key in patch)) continue;
    params.push(patch[key] ?? null);
    sets.push(`${key} = $${params.length}`);
  }
  if (patch.status === "DONE") {
    sets.push("completed_at = now()");
  } else if (patch.status && patch.status !== "DONE") {
    sets.push("completed_at = NULL");
  }
  if (!sets.length) return findTask(client, id);
  params.push(id);
  const { rows } = await client.query(
    `UPDATE task SET ${sets.join(", ")}, updated_at = now() WHERE task_id = $${params.length} AND is_deleted = false RETURNING *`,
    params,
  );
  return rows[0] || null;
}

const softDeleteTask = async (client, id) => {
  const { rows } = await client.query(
    "UPDATE task SET is_deleted = true, updated_at = now() WHERE task_id = $1 AND is_deleted = false RETURNING task_id",
    [id],
  );
  return Boolean(rows[0]);
};

/* ── subtasks ───────────────────────────────────────────────────────────── */

async function listSubtasks(client, taskId) {
  const { rows } = await client.query(
    "SELECT * FROM task_subtask WHERE task_id = $1 ORDER BY display_order, created_at",
    [taskId],
  );
  return rows;
}

async function insertSubtask(client, { task_id, title, display_order, due_at }) {
  const { rows } = await client.query(
    `INSERT INTO task_subtask (task_id, title, display_order, due_at)
     VALUES ($1,$2,COALESCE($3, (SELECT COALESCE(max(display_order),0)+1 FROM task_subtask WHERE task_id = $1)),$4)
     RETURNING *`,
    [task_id, title, display_order ?? null, due_at ?? null],
  );
  return rows[0];
}

/**
 * Patch a step: tick it done, move its deadline, or both.
 *
 * `completed_at` rides with `is_done` in the SAME statement — stamped on the way
 * to done, cleared on the way back — so a step and its completion time can never
 * disagree. An empty patch re-reads rather than issuing `UPDATE … SET `, the
 * same guard `updateTask` makes.
 */
async function updateSubtask(client, subtaskId, patch) {
  const sets = [];
  const params = [];
  if ("due_at" in patch) {
    params.push(patch.due_at ?? null);
    sets.push(`due_at = $${params.length}`);
  }
  if ("is_done" in patch) {
    params.push(patch.is_done === true);
    const i = params.length;
    sets.push(`is_done = $${i}`);
    sets.push(`completed_at = CASE WHEN $${i} THEN now() ELSE NULL END`);
  }
  if (!sets.length) {
    const { rows } = await client.query("SELECT * FROM task_subtask WHERE task_subtask_id = $1", [subtaskId]);
    return rows[0] || null;
  }
  params.push(subtaskId);
  const { rows } = await client.query(
    `UPDATE task_subtask SET ${sets.join(", ")} WHERE task_subtask_id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function deleteSubtask(client, subtaskId) {
  const { rowCount } = await client.query("DELETE FROM task_subtask WHERE task_subtask_id = $1", [subtaskId]);
  return rowCount > 0;
}

/* ── watchers ───────────────────────────────────────────────────────────── */

async function listWatchers(client, taskId) {
  const { rows } = await client.query(
    `SELECT w.user_id, u.full_name, u.email
       FROM task_watcher w JOIN app_user u ON u.user_id = w.user_id
      WHERE w.task_id = $1 ORDER BY u.full_name`,
    [taskId],
  );
  return rows;
}

async function addWatcher(client, taskId, userId) {
  const { rows } = await client.query(
    `INSERT INTO task_watcher (task_id, user_id) VALUES ($1,$2)
     ON CONFLICT (task_id, user_id) DO UPDATE SET task_id = EXCLUDED.task_id
     RETURNING *`,
    [taskId, userId],
  );
  return rows[0];
}

const removeWatcher = async (client, taskId, userId) => {
  const { rowCount } = await client.query(
    "DELETE FROM task_watcher WHERE task_id = $1 AND user_id = $2", [taskId, userId],
  );
  return rowCount > 0;
};


/* ── children ───────────────────────────────────────────────────────────── */

/**
 * The separately-assigned operational children of one task (13810's
 * `parent_task_id`).
 *
 * NOT visibility filtered, and that is deliberate rather than an oversight: the
 * service needs the WHOLE child set to compute an honest roll-up, and a parent
 * whose progress read "2 of 2" because the reader could not see the third child
 * would be a lie with a number on it. The service redacts the rows it RENDERS
 * and counts the rows it COUNTS separately — see `childRollup` there.
 *
 * Soft-deleted children are excluded: a deleted child is not outstanding work.
 */
async function listChildTasks(client, parentTaskId) {
  const { rows } = await client.query(
    `${TASK_SELECT} WHERE t.parent_task_id = $1 AND t.is_deleted = false
      ORDER BY (t.due_at IS NULL), t.due_at ASC NULLS LAST, t.created_at ASC`,
    [parentTaskId],
  );
  return rows;
}

/**
 * Child counts for a set of parents, for the list and board roll-up badges.
 *
 * Batched over an array so a board of 200 cards costs one query rather than
 * 200 — the same reason `blockedCountsFor` below takes a set.
 */
async function childCountsFor(client, parentIds) {
  if (!parentIds || !parentIds.length) return [];
  const { rows } = await client.query(
    `SELECT parent_task_id,
            count(*)::int                                     AS child_count,
            count(*) FILTER (WHERE status = 'DONE')::int      AS child_done_count,
            count(*) FILTER (WHERE status = 'CANCELLED')::int AS child_cancelled_count
       FROM task
      WHERE parent_task_id = ANY($1::uuid[]) AND is_deleted = false
      GROUP BY parent_task_id`,
    [parentIds],
  );
  return rows;
}

/* ── dependencies (13870) ───────────────────────────────────────────────── */

/**
 * What this task is waiting for, with enough of the prerequisite to decide
 * whether it still blocks — and enough identity for the SERVICE to decide
 * whether the caller may be told what it is.
 *
 * The title and owner ride along ON PURPOSE. Redaction is an authorisation
 * decision and belongs where the audience rules live; doing it here would mean
 * this query needed the caller's scope closure, which is how a repo function
 * ends up holding a second copy of a visibility rule (13810's header).
 */
async function listDependencies(client, taskId) {
  const { rows } = await client.query(
    `SELECT d.task_dependency_id, d.task_id, d.depends_on_task_id,
            d.overridden_at, d.overridden_by, d.override_reason, d.created_at,
            o.full_name    AS overridden_by_name,
            p.title        AS depends_on_title,
            p.status       AS depends_on_status,
            p.due_at       AS depends_on_due_at,
            p.assigned_to  AS depends_on_assigned_to,
            p.created_by   AS depends_on_created_by,
            p.is_personal  AS depends_on_is_personal,
            p.scope_id     AS depends_on_scope_id,
            p.entity_type  AS depends_on_entity_type,
            p.entity_id    AS depends_on_entity_id
       FROM task_dependency d
       JOIN task p ON p.task_id = d.depends_on_task_id AND p.is_deleted = false
       LEFT JOIN app_user o ON o.user_id = d.overridden_by
      WHERE d.task_id = $1
      ORDER BY d.created_at`,
    [taskId],
  );
  return rows;
}

/** The reverse read: what this task is holding up. Same redaction contract. */
async function listDependents(client, taskId) {
  const { rows } = await client.query(
    `SELECT d.task_dependency_id, d.task_id, d.depends_on_task_id, d.overridden_at,
            b.title       AS blocked_title,
            b.status      AS blocked_status,
            b.assigned_to AS blocked_assigned_to,
            b.created_by  AS blocked_created_by,
            b.is_personal AS blocked_is_personal,
            b.scope_id    AS blocked_scope_id
       FROM task_dependency d
       JOIN task b ON b.task_id = d.task_id AND b.is_deleted = false
      WHERE d.depends_on_task_id = $1
      ORDER BY d.created_at`,
    [taskId],
  );
  return rows;
}

/**
 * Would adding "taskId is blocked by dependsOnTaskId" close a loop?
 *
 * Walks the blocked-by graph forward from the PROPOSED PREREQUISITE: if the
 * task that would become blocked is already reachable among that
 * prerequisite's own transitive prerequisites, the new edge completes a cycle
 * and nothing in the loop could ever start.
 *
 * `UNION` rather than `UNION ALL` is load-bearing: it dedupes the frontier, so
 * a graph that ALREADY contains a cycle (rows written before this check
 * existed, or by a direct SQL fix) terminates instead of spinning. The depth
 * cap is the second belt for a very wide graph — 64 is far past any real chain
 * of work, and reaching it refuses the edge rather than hanging the request.
 *
 * The database does NOT hold this rule; 13870's header says why, and this is
 * the function that header points at.
 */
async function dependencyWouldCycle(client, taskId, dependsOnTaskId) {
  const { rows } = await client.query(
    `WITH RECURSIVE reach(task_id, depth) AS (
       SELECT $2::uuid, 0
       UNION
       SELECT d.depends_on_task_id, r.depth + 1
         FROM task_dependency d
         JOIN reach r ON r.task_id = d.task_id
        WHERE r.depth < 64
     )
     SELECT 1 FROM reach WHERE task_id = $1::uuid LIMIT 1`,
    [taskId, dependsOnTaskId],
  );
  return rows.length > 0;
}

async function findDependency(client, dependencyId) {
  const { rows } = await client.query(
    "SELECT * FROM task_dependency WHERE task_dependency_id = $1",
    [dependencyId],
  );
  return rows[0] || null;
}

/**
 * Add an edge.
 *
 * `ON CONFLICT DO NOTHING` returns no row for a duplicate, which the service
 * turns into an honest sentence rather than a 23505 the user has never heard
 * of. The unique index is still what makes the duplicate impossible; this only
 * decides how it is REPORTED.
 */
async function insertDependency(client, { task_id, depends_on_task_id, created_by }) {
  const { rows } = await client.query(
    `INSERT INTO task_dependency (task_id, depends_on_task_id, created_by)
     VALUES ($1,$2,$3)
     ON CONFLICT (task_id, depends_on_task_id) DO NOTHING
     RETURNING *`,
    [task_id, depends_on_task_id, created_by ?? null],
  );
  return rows[0] || null;
}

/** Record the "proceed anyway" decision, attributably (13870). */
async function overrideDependency(client, dependencyId, { userId, reason }) {
  const { rows } = await client.query(
    `UPDATE task_dependency
        SET overridden_at = now(), overridden_by = $2, override_reason = $3
      WHERE task_dependency_id = $1
      RETURNING *`,
    [dependencyId, userId ?? null, reason ?? null],
  );
  return rows[0] || null;
}

/** Withdraw an override — the edge blocks again. */
async function clearDependencyOverride(client, dependencyId) {
  const { rows } = await client.query(
    `UPDATE task_dependency
        SET overridden_at = NULL, overridden_by = NULL, override_reason = NULL
      WHERE task_dependency_id = $1
      RETURNING *`,
    [dependencyId],
  );
  return rows[0] || null;
}

async function deleteDependency(client, dependencyId) {
  const { rowCount } = await client.query(
    "DELETE FROM task_dependency WHERE task_dependency_id = $1",
    [dependencyId],
  );
  return rowCount > 0;
}

/**
 * Which of these tasks are blocked, and by how many unresolved prerequisites.
 *
 * "Unresolved" is the whole semantic in one predicate: not DONE, not
 * overridden, not soft-deleted. CANCELLED is deliberately NOT treated as
 * resolved — an abandoned prerequisite is not a finished one, and it keeps
 * blocking until somebody overrides the edge. That is the recorded decision,
 * and it is the reason `overridden_at` exists at all.
 *
 * Batched over an array so a board of 200 cards is one query, not 200.
 */
async function blockedCountsFor(client, taskIds) {
  if (!taskIds || !taskIds.length) return [];
  const { rows } = await client.query(
    `SELECT d.task_id,
            count(*)::int     AS blocking_count,
            min(d.created_at) AS blocked_since
       FROM task_dependency d
       JOIN task p ON p.task_id = d.depends_on_task_id AND p.is_deleted = false
      WHERE d.task_id = ANY($1::uuid[])
        AND d.overridden_at IS NULL
        AND p.status <> 'DONE'
      GROUP BY d.task_id`,
    [taskIds],
  );
  return rows;
}

/* ── WHAT "BLOCKED" MEANS: dependency edges (13870) OR live holds (13975) ──
 *
 * Two tables, one question — "can this finish today?" A task waiting on an
 * unfinished, non-overridden prerequisite is blocked; so is a task carrying an
 * active `task_blockage` row ("customs' network is down"). Every blocked
 * count, panel and list builds its predicate from these snippets so the card,
 * the panel callout and the Monitor's Blocked-work table can never disagree
 * about which tasks are stuck. `alias` is the task row's alias in the calling
 * query — `t` everywhere in analytics today.
 */
const depBlockedSql = (alias) =>
  `EXISTS (SELECT 1 FROM task_dependency d JOIN task p ON p.task_id = d.depends_on_task_id AND p.is_deleted = false WHERE d.task_id = ${alias}.task_id AND d.overridden_at IS NULL AND p.status <> 'DONE')`;
const blockageBlockedSql = (alias) =>
  `EXISTS (SELECT 1 FROM task_blockage b WHERE b.task_id = ${alias}.task_id AND b.resolved_at IS NULL)`;
const blockedSql = (alias) => `(${depBlockedSql(alias)} OR ${blockageBlockedSql(alias)})`;

/* ════════════════════════ BLOCKAGES (13975) ═══════════════════════════════ */

const BLOCKAGE_SELECT = `
  SELECT b.*, u.full_name AS raised_by_name, r.full_name AS resolved_by_name
    FROM task_blockage b
    LEFT JOIN app_user u ON u.user_id = b.raised_by
    LEFT JOIN app_user r ON r.user_id = b.resolved_by`;

/**
 * The live hold on each of these tasks, batched for boards and lists.
 *
 * At most ONE row per task: `uq_task_blockage_one_active` makes a second
 * concurrent hold unrepresentable, so this is a lookup, not an aggregation —
 * and the card's snippet is the whole note, not the newest of several.
 */
async function activeBlockagesFor(client, taskIds) {
  if (!taskIds || !taskIds.length) return [];
  const { rows } = await client.query(
    `${BLOCKAGE_SELECT}
      WHERE b.task_id = ANY($1::uuid[]) AND b.resolved_at IS NULL`,
    [taskIds],
  );
  return rows;
}

/** The live hold on ONE task, for the panel and the raise-time refusal. */
async function activeBlockageFor(client, taskId) {
  const { rows } = await client.query(
    `${BLOCKAGE_SELECT}
      WHERE b.task_id = $1 AND b.resolved_at IS NULL
      LIMIT 1`,
    [taskId],
  );
  return rows[0] || null;
}

/**
 * The task's holds, newest first — the panel's collapsible history. Resolved
 * rows are the evidence behind "late because of X for N days", so they are
 * read here rather than filtered out.
 */
async function listBlockages(client, taskId) {
  const { rows } = await client.query(
    `${BLOCKAGE_SELECT}
      WHERE b.task_id = $1
      ORDER BY b.raised_at DESC`,
    [taskId],
  );
  return rows;
}

async function insertBlockage(client, { taskId, note, estimatedResolveAt = null, raisedBy = null }) {
  const { rows } = await client.query(
    `INSERT INTO task_blockage (task_id, note, estimated_resolve_at, raised_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [taskId, note, estimatedResolveAt, raisedBy],
  );
  return rows[0];
}

/**
 * Close the hold. `resolved_at IS NULL` in the WHERE is the guard: two racing
 * resolve clicks produce one resolution, and the loser gets zero rows back
 * and reports 404 rather than re-shifting the due date.
 */
async function resolveBlockageRow(client, blockageId, { resolvedBy, resolveNote = null }) {
  const { rows } = await client.query(
    `UPDATE task_blockage
        SET resolved_at = now(), resolved_by = $2, resolve_note = $3
      WHERE task_blockage_id = $1 AND resolved_at IS NULL
      RETURNING *`,
    [blockageId, resolvedBy, resolveNote],
  );
  return rows[0] || null;
}

/** Record the due-date movement on the row that caused it — see 13975. */
async function setBlockageDueShift(client, blockageId, seconds) {
  const { rows } = await client.query(
    `UPDATE task_blockage
        SET due_shift = ($2 || ' seconds')::interval
      WHERE task_blockage_id = $1
      RETURNING due_shift`,
    [blockageId, seconds],
  );
  return rows[0] ? rows[0].due_shift : null;
}

/**
 * Move an open task's deadline forward by the blocked duration. Only touches
 * rows that HAVE a due date; a task with no deadline has nothing to shift and
 * the blockage's `due_shift` stays NULL, which is the truthful record.
 */
async function shiftTaskDue(client, taskId, seconds) {
  const { rows } = await client.query(
    `UPDATE task
        SET due_at = due_at + ($2 || ' seconds')::interval
      WHERE task_id = $1 AND due_at IS NOT NULL
      RETURNING due_at`,
    [taskId, seconds],
  );
  return rows[0] ? rows[0].due_at : null;
}

/** Which of these user ids exist — the blockage chooser may name anybody. */
async function existingUserIds(client, userIds) {
  if (!userIds || !userIds.length) return [];
  const { rows } = await client.query(
    "SELECT user_id FROM app_user WHERE user_id = ANY($1::uuid[])",
    [userIds],
  );
  return rows.map((r) => r.user_id);
}

/* ════════════════════════════ CALENDAR EVENTS ════════════════════════════ */

const EVENT_SELECT = `
  SELECT e.*, c.full_name AS created_by_name,
         (SELECT count(*)::int FROM calendar_participant p WHERE p.calendar_event_id = e.calendar_event_id) AS participant_count
    FROM calendar_event e
    LEFT JOIN app_user c ON c.user_id = e.created_by`;

/**
 * Events overlapping a window.
 *
 * `start_at < to AND end_at >= from` — an event is in the window if any part of
 * it falls inside, so a three-day event shows on all three days of a grid. The
 * naive `start_at BETWEEN from AND to` hides it on days two and three, which
 * is the classic empty-calendar bug.
 */
async function listEventsWindow(client, { from, to, eventType, visibility, userId, mine, limit = 500 }) {
  const params = [from, to];
  const where = ["e.is_deleted = false", "e.start_at < $2", "e.end_at >= $1"];
  if (eventType) { params.push(eventType); where.push(`e.event_type = $${params.length}`); }
  const v = visibility || {
    audience: mine ? "mine" : "all",
    permissionScope: mine ? "scoped" : "all",
    userId,
  };
  const visible = eventVisibleWhere(v, params.length + 1);
  params.push(...visible.params);
  where.push(...visible.sql);
  const limitParam = params.length + 1;
  params.push(limit);
  const { rows } = await client.query(
    `${EVENT_SELECT.replace("SELECT e.*,", "SELECT e.*, COUNT(*) OVER() AS _total,")} WHERE ${where.join(" AND ")} ORDER BY e.start_at ASC LIMIT $${limitParam}`,
    params,
  );
  const total = rows.length ? Number(rows[0]._total) : 0;
  return { rows, total, truncated: total > rows.length };
}

async function listEvents(client, options) {
  return (await listEventsWindow(client, options)).rows;
}

async function insertEvent(client, e) {
  const { rows } = await client.query(
    `INSERT INTO calendar_event (
       title, event_type, location, description, start_at, end_at, all_day,
       recurrence_rule, recurrence_series_id, created_by,
       entity_type, entity_id, scope_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      e.title, e.event_type || "other", e.location ?? null, e.description ?? null,
      e.start_at, e.end_at, e.all_day === true, e.recurrence_rule ?? null,
      e.recurrence_series_id ?? null, e.created_by ?? null,
      e.entity_type ?? null, e.entity_id ?? null, e.scope_id ?? null,
    ],
  );
  return rows[0];
}

async function findEvent(client, id) {
  const { rows } = await client.query(`${EVENT_SELECT} WHERE e.calendar_event_id = $1 AND e.is_deleted = false`, [id]);
  return rows[0] || null;
}

async function updateEvent(client, id, patch) {
  const sets = [];
  const params = [];
  for (const key of ["title", "event_type", "location", "description", "start_at", "end_at",
    "all_day", "recurrence_rule", "recurrence_series_id",
    "entity_type", "entity_id", "scope_id"]) {
    if (!(key in patch)) continue;
    params.push(patch[key] ?? null);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) return findEvent(client, id);
  params.push(id);
  const { rows } = await client.query(
    `UPDATE calendar_event SET ${sets.join(", ")}, updated_at = now()
      WHERE calendar_event_id = $${params.length} AND is_deleted = false RETURNING *`,
    params,
  );
  return rows[0] || null;
}

const softDeleteEvent = async (client, id) => {
  const { rows } = await client.query(
    "UPDATE calendar_event SET is_deleted = true, updated_at = now() WHERE calendar_event_id = $1 AND is_deleted = false RETURNING calendar_event_id",
    [id],
  );
  return Boolean(rows[0]);
};

/**
 * Events sharing a location that overlap the proposed slot.
 *
 * `existing.start < new.end AND existing.end > new.start` is the overlap test;
 * anything else under-reports (touching endpoints are not a clash) or
 * over-reports (containment missed). Only events WITH a location clash — two
 * meetings with no room booked cannot collide over a room.
 */
async function findEventClashes(client, { location, start_at, end_at, excludeId }) {
  const params = [location, start_at, end_at];
  let sql = `WHERE e.is_deleted = false AND e.location IS NOT NULL
             AND lower(btrim(e.location)) = lower(btrim($1))
             AND e.start_at < $3 AND e.end_at > $2`;
  if (excludeId) { params.push(excludeId); sql += ` AND e.calendar_event_id <> $${params.length}`; }
  const { rows } = await client.query(
    `SELECT e.calendar_event_id, e.title, e.start_at, e.end_at, e.location FROM calendar_event e ${sql} ORDER BY e.start_at LIMIT 10`,
    params,
  );
  return rows;
}

/* ── participants ───────────────────────────────────────────────────────── */

async function listParticipants(client, eventId) {
  const { rows } = await client.query(
    `SELECT p.*, u.full_name AS user_name, u.email
       FROM calendar_participant p
       LEFT JOIN app_user u ON u.user_id = p.user_id
      WHERE p.calendar_event_id = $1
      ORDER BY p.is_organiser DESC, COALESCE(u.full_name, p.external_name)`,
    [eventId],
  );
  return rows;
}

async function insertParticipant(client, p) {
  const { rows } = await client.query(
    `INSERT INTO calendar_participant (calendar_event_id, user_id, external_name, is_organiser)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [p.calendar_event_id, p.user_id ?? null, p.external_name ?? null, p.is_organiser === true],
  );
  return rows[0] || null;
}

async function respondParticipant(client, participantId, status) {
  const { rows } = await client.query(
    `UPDATE calendar_participant SET response_status = $2, responded_at = now()
      WHERE calendar_participant_id = $1 RETURNING *`,
    [participantId, status],
  );
  return rows[0] || null;
}

async function removeParticipant(client, participantId) {
  const { rowCount } = await client.query(
    "DELETE FROM calendar_participant WHERE calendar_participant_id = $1", [participantId],
  );
  return rowCount > 0;
}

/* ═══════════════════════════ REMINDER SWEEP ═════════════════════════════ */

/**
 * Armed reminders whose time has come, oldest first.
 *
 * 13890: the sweep reads `workspace_reminder`, not the parent's reminder
 * columns, so several reminders on one record are one honest row each rather
 * than a race for one slot. The predicate is the same as 13810's
 * (`reminder_sent_at IS NULL` = armed, `remind_at` = due, partial index
 * keeps it compact); what changed is WHERE those columns live. Relative
 * reminders arrive here by re-materialisation, not by read: a series-level
 * row is inserted per occurrence with its `remind_at` pre-computed from the
 * occurrence's own anchor, so the row the sweep sees is always the one whose
 * alarm time is literally set. Tasks exclude DONE/CANCELLED — reminding
 * someone about work that is finished is how an alert gets filtered forever.
 *
 * One query per owner, not a union: the two shapes differ in their sweep rule
 * (task: assignee-or-creator and not finished; event: organiser + invited
 * participants) and folding them into one SELECT would copy the distinction
 * the table's owner_type is there to make possible without re-inventing.
 */
async function dueTaskReminders(client, nowIso, limit) {
  const { rows } = await client.query(
    `SELECT r.workspace_reminder_id, r.owner_id AS task_id, r.reminder_minutes, r.remind_at, r.email, r.label, r.ordinal,
            t.title, t.due_at, t.assigned_to, t.created_by, t.priority, t.entity_type, t.entity_id
       FROM workspace_reminder r
       JOIN task t ON t.task_id = r.owner_id AND t.is_deleted = false
      WHERE r.owner_type = 'task' AND r.is_deleted = false
        AND r.reminder_sent_at IS NULL
        AND r.remind_at <= $1
        AND t.status NOT IN ('DONE','CANCELLED')
      ORDER BY r.remind_at
      LIMIT $2`,
    [nowIso, limit],
  );
  return rows;
}

async function dueEventReminders(client, nowIso, limit) {
  const { rows } = await client.query(
    `SELECT r.workspace_reminder_id, r.owner_id AS calendar_event_id, r.reminder_minutes, r.remind_at, r.email, r.label, r.ordinal,
            e.title, e.start_at, e.location, e.created_by, e.entity_type, e.entity_id,
            COALESCE(array_agg(DISTINCT p.user_id) FILTER (WHERE p.user_id IS NOT NULL), '{}') AS participant_user_ids
       FROM workspace_reminder r
       JOIN calendar_event e ON e.calendar_event_id = r.owner_id AND e.is_deleted = false
       LEFT JOIN calendar_participant p ON p.calendar_event_id = e.calendar_event_id
      WHERE r.owner_type = 'calendar_event' AND r.is_deleted = false
        AND r.reminder_sent_at IS NULL
        AND r.remind_at <= $1
      GROUP BY r.workspace_reminder_id, e.calendar_event_id
      ORDER BY r.remind_at
      LIMIT $2`,
    [nowIso, limit],
  );
  return rows;
}

/* ── read-side: the several reminders a record carries, in display order ── */

/**
 * Reminders for one record, ordered for the dialog.
 *
 * Any reader is reading them before deciding which edits to offer which is
 * the same query for the detail read and the form's seed — never two
 * orderings re-derived by two callers.
 */
async function listReminders(client, ownerType, ownerId) {
  const { rows } = await client.query(
    `SELECT workspace_reminder_id, owner_type, owner_id, reminder_minutes, remind_at,
            reminder_sent_at, ordinal, email, scope, created_at, updated_at
       FROM workspace_reminder
      WHERE owner_type = $1 AND owner_id = $2 AND is_deleted = false
      ORDER BY ordinal`,
    [ownerType, ownerId],
  );
  return rows;
}

/**
 * Delete a row without making what was armed look like what was never there.
 * Soft-delete rather than CASCADE-only: the sweep's armed set is a partial
 * index, and a hard deletion would make the armed reminder invisible from
 * what was never armed — which is exactly the failure it was built to avoid.
 */
async function deleteReminder(client, workspaceReminderId, ownerType, ownerId) {
  const { rows } = await client.query(
    `UPDATE workspace_reminder
        SET is_deleted = true, updated_at = now()
      WHERE workspace_reminder_id = $1 AND owner_type = $2 AND owner_id = $3 AND is_deleted = false
      RETURNING workspace_reminder_id`,
    [workspaceReminderId, ownerType, ownerId],
  );
  return Boolean(rows[0]);
}

/* ── write-side: replacing the whole reminder set of a record ───────────── */

/**
 * Insert one row of a record's reminder set, ordered callers may rewrite.
 *
 * The variant placeholder is `remind_at` for an absolute row and null for a
 * relative one; `reminder_minutes` for a relative row and null for an
 * absolute. Both-null is the CHECK's own refusal (num_nulls = 1), both-set is
 * the other — a row the service computed is one of the two, never both, by
 * the time this is called. `email` is opt-in per row, never inherited —
 * ticking the box on one row does not say it for the others.
 */
async function insertReminder(client, { ownerType, ownerId, reminderMinutes = null, remindAt = null, ordinal, label = null, email = false, scope = "this", actor = {} }) {
  const { rows } = await client.query(
    `INSERT INTO workspace_reminder (
       owner_type, owner_id, reminder_minutes, remind_at, ordinal, label, email, scope, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [ownerType, ownerId, reminderMinutes ?? null, remindAt ?? null, ordinal, label ?? null, email === true, scope, actor.user_id ?? null, actor.user_id ?? null],
  );
  return rows[0];
}

/**
 * Rewrite the reminder set for one record, in one transaction.
 *
 * The previous set is soft-deleted before the new rows insert, so a row
 * number (`ordinal`) that already existed is never double-armed for the same
 * (owner, ordinal) and the sweep's armed set does not see the old and new
 * values together in one tick. A failed second row then leaves the first as
 * never-armed rather than as set replacement that was half-written. Callers
 * pass raw `remindAt` from workspace.time.toInstant — a computed conditioned
 * on the owner's due/start — so there is only one conversion per instant
 * rather than one per row.
 */
async function replaceReminders(client, { ownerType, ownerId, rows, actor = {} }) {
  // `atomically` rather than a raw BEGIN: the join may arrive on a caller's
  // already-open transaction, in which case we chain on it and commit nothing
  // of theirs. See shared/db/tx.js's header for the whole rule.
  return atomically(client, async () => {
    await client.query(
      `UPDATE workspace_reminder
          SET is_deleted = true, updated_at = now()
        WHERE owner_type = $1 AND owner_id = $2 AND is_deleted = false`,
      [ownerType, ownerId],
    );
    const out = [];
    for (const row of rows) {
      out.push(await insertReminder(client, { ownerType, ownerId, actor, ...row }));
    }
    return out;
  });
}

/**
 * SERIES reminders for the rows the spawn sweep is about to materialise, in
 * one read rather than one query per row's occurrence.
 *
 * The service walks the spawn list, asks which owners have a SERIES row and
 * in what shape (the reminder_minutes preset only — an absolute row on a
 * series is a "01 March at 09:00" that belongs to the template's date, not
 * each occurrence), and then materialises one fresh, per-occurrence row per
 * (owner, ordinal) at the newly-created row's anchor. The join on
 * `owner_id` keeps it one query for a batch, so a 200-row tick does not
 * re-read every series' reminders per occurrence.
 */
async function listReminderTemplates(client, ownerType, ownerIds) {
  if (!ownerIds || !ownerIds.length) return [];
  const { rows } = await client.query(
    `SELECT workspace_reminder_id, owner_type, owner_id, reminder_minutes, ordinal, label, email
       FROM workspace_reminder
      WHERE owner_type = $1 AND owner_id = ANY($2::uuid[])
        AND is_deleted = false AND scope = 'series' AND reminder_minutes IS NOT NULL
      ORDER BY owner_type, owner_id, ordinal`,
    [ownerType, ownerIds],
  );
  return rows;
}

/**
 * Materialise the per-occurrence reminders for one spawned row.
 *
 * One fresh row per series template, with its `remind_at` pre-computed from
 * `anchor` (a due date or an event start, already a UTC instant) minus the
 * preset's `reminder_minutes`. This is insert-only: the sweep writes the
 * occurrence and then adds its reminders, and the template itself carries
 * nothing for this occurrence — a per-occurrence row is its own reality
 * rather than the series' memory of one, and it does not get the per-
 * occurrence anchor's date back when it is edited.
 */
async function materialiseReminders(client, { ownerType, ownerId, anchorIso, templates }) {
  let n = 0;
  for (const t of templates) {
    const remindAt = new Date(new Date(anchorIso).getTime() - Number(t.reminder_minutes) * 60000).toISOString();
    const { rows: tpl } = await client.query(
      "SELECT created_by FROM workspace_reminder WHERE workspace_reminder_id = $1",
      [t.workspace_reminder_id],
    );
    const createdBy = tpl[0]?.created_by ?? null;
    await client.query(
      `INSERT INTO workspace_reminder (
         owner_type, owner_id, reminder_minutes, remind_at, ordinal, label, email, scope, created_by, updated_by
       ) VALUES ($1,$2,NULL,$3,$4,$5,$6,'this',$7,$7)`,
      [ownerType, ownerId, remindAt, t.ordinal, t.label ?? null, t.email === true, createdBy],
    );
    n += 1;
  }
  return n;
}

/**
 * Stamp a reminder as fired — workspace_reminder's own row, not its parent.
 *
 * The sweep calls this EVEN WHEN DELIVERY FAILED. Losing one notification
 * is recoverable — the task is on the desk, the record renders the date. A
 * row that never gets stamped is re-selected every minute forever, and one
 * bad row then eats the batch and stops every reminder in the tenant from
 * firing. That is the wedge this prevents, and it is why the stamp is not
 * conditional.
 */
async function markReminderSent(client, id, nowIso) {
  await client.query(
    "UPDATE workspace_reminder SET reminder_sent_at = $2, updated_at = now() WHERE workspace_reminder_id = $1",
    [id, nowIso],
  );
}

/** Stamp every armed reminder of a now-DONE owner — completion quiets the rest. */
async function settleRemindersForDoneTask(client, ownerId, nowIso) {
  await client.query(
    `UPDATE workspace_reminder
        SET reminder_sent_at = $2, updated_at = now()
      WHERE owner_type = 'task' AND owner_id = $1 AND is_deleted = false
        AND reminder_sent_at IS NULL`,
    [ownerId, nowIso],
  );
}

/**
 * Re-arm every armed reminder of an owner whose date basis moved.
 *
 * A moved due date re-arms the record's reminders — the 13810 contract that
 * the captured stamp means stale, not done — deliberately applied to the
 * whole set, not one row: moving ONE reminder's arming would forget the
 * others, and a stamp that refers to a date that no longer exists is
 * precisely the alarm-clock-for-a-date-that-is-no-longer-Thursday failure
 * the sweep is meant to avoid.
 */
async function rearmOwnerReminders(client, ownerType, ownerId) {
  await client.query(
    `UPDATE workspace_reminder
        SET reminder_sent_at = NULL, updated_at = now()
      WHERE owner_type = $1 AND owner_id = $2 AND is_deleted = false
        AND reminder_sent_at IS NOT NULL`,
    [ownerType, ownerId],
  );
}

/**
 * Project a single-reminder owner's state onto the parent columns.
 *
 * ── THE PLACEHOLDERS ARE NUMBERED BY MEANING, AND THAT IS THE WHOLE BUG ─────
 *
 * This UPDATE is the LAST statement of every task or event write that names
 * its reminders — the dialog always does, even to say "none" — so a fault
 * here is a 500 on every create and edit made from the dialog, AFTER the
 * parent row is already in. That is exactly what shipped: the `reminder_sent_at`
 * subselect below used to read `owner_type = $1 AND owner_id = $2` (the
 * numbering of the SELECT above it), but in THIS statement `$1` is the owner
 * id and `$2` is `reminder_minutes`. Postgres refused it at parse time —
 * `42883 operator does not exist: text = uuid` — on every call, whatever the
 * values, and the unit tests could not see it because a scripted client
 * accepts any SQL.
 *
 * So the parameters are now bound once each with one meaning each: `$1` the
 * owner id (row to update AND reminders to read), `$2`/`$3` the projected
 * pair, `$4` the owner type. Anything else is the same bug waiting to come
 * back, which is why `tests/unit/workspace-reminders-write.test.js` now
 * checks what each `$n` in an `owner_id =` / `owner_type =` comparison is
 * bound to, and `tests/integration/workspace-reminder-sync.test.js` runs the
 * statement against the real tables.
 */
async function syncParentReminderColumns(client, ownerType, ownerId) {
  const table = ownerType === "task" ? "task" : "calendar_event";
  const idColumn = ownerType === "task" ? "task_id" : "calendar_event_id";
  const { rows } = await client.query(
    `SELECT
       (SELECT reminder_minutes FROM workspace_reminder
         WHERE owner_type = $1 AND owner_id = $2 AND is_deleted = false ORDER BY ordinal LIMIT 1) AS reminder_minutes,
       (SELECT remind_at FROM workspace_reminder
         WHERE owner_type = $1 AND owner_id = $2 AND is_deleted = false ORDER BY ordinal LIMIT 1) AS remind_at`,
    [ownerType, ownerId],
  );
  const { reminder_minutes = null, remind_at = null } = rows[0] || {};
  await client.query(
    `UPDATE ${table}
        SET reminder_minutes = $2, remind_at = $3,
            reminder_sent_at = CASE
              WHEN $2::integer IS NULL AND $3::timestamptz IS NULL THEN reminder_sent_at
              ELSE (
                SELECT reminder_sent_at FROM workspace_reminder
                 WHERE owner_type = $4 AND owner_id = $1 AND is_deleted = false ORDER BY ordinal LIMIT 1
              )
            END,
            updated_at = now()
      WHERE ${idColumn} = $1`,
    [ownerId, reminder_minutes, remind_at, ownerType],
  );
}

/* ═══════════════════════════ RECURRENCE (13840) ═════════════════════════ */

/**
 * Recurring rows whose next occurrence is due to be materialised.
 *
 * The predicate is `COALESCE(recurrence_cursor_at, due_at) <= now()` — a row
 * that has never spawned anchors on its own due date, and one that has anchors
 * on the occurrence it created. That single expression is the whole state
 * machine; there is no "pending/running/done" column to get out of step.
 *
 * DELIBERATELY NOT FILTERED ON STATUS OR ON `reminder_sent_at`. A recurring
 * filing that the accountant completes on the 10th still has to produce next
 * month's row on the 14th, and `dueTaskReminders` above excludes DONE rows
 * because reminding someone about finished work is noise. Coupling the two
 * scans would stop every series whose owner is diligent — the exact opposite of
 * the behaviour that earns a reminder system its keep.
 */
async function listSpawnDueTasks(client, nowIso, limit) {
  const { rows } = await client.query(
    `SELECT task_id, title, description, priority, assigned_to, created_by, due_at,
            parent_task_id, entity_type, entity_id, is_personal, scope_id,
            recurrence_rule, recurrence_series_id
       FROM task
      WHERE recurrence_rule IS NOT NULL AND is_deleted = false AND due_at IS NOT NULL
        AND COALESCE(recurrence_cursor_at, due_at) <= $1
      ORDER BY COALESCE(recurrence_cursor_at, due_at)
      LIMIT $2`,
    [nowIso, limit],
  );
  return rows;
}

async function listSpawnDueEvents(client, nowIso, limit) {
  const { rows } = await client.query(
    `SELECT calendar_event_id, title, event_type, location, description,
            start_at, end_at, all_day, created_by, entity_type, entity_id, scope_id,
            recurrence_rule, recurrence_series_id
       FROM calendar_event
      WHERE recurrence_rule IS NOT NULL AND is_deleted = false
        AND COALESCE(recurrence_cursor_at, start_at) <= $1
      ORDER BY COALESCE(recurrence_cursor_at, start_at)
      LIMIT $2`,
    [nowIso, limit],
  );
  return rows;
}

/**
 * How many rows a series already has — what makes `COUNT=5` mean five
 * occurrences rather than five more. Counts soft-deleted rows too: deleting an
 * occurrence should consume it, not buy the series another turn.
 */
async function countSeriesTasks(client, seriesId) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM task WHERE recurrence_series_id = $1",
    [seriesId],
  );
  return rows[0]?.n ?? 0;
}

async function countSeriesEvents(client, seriesId) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM calendar_event WHERE recurrence_series_id = $1",
    [seriesId],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Materialise the next occurrence of a task.
 *
 * `ON CONFLICT DO NOTHING` against `ux_task_series_occurrence` is what makes the
 * sweep safe to run twice, and safe to race itself: two rows of one series come
 * due in the same tick, both compute the same next date, and one insert wins.
 * The loser returns null and still advances its cursor — see the migration's
 * header for why NOT advancing it would wedge the scan.
 */
async function insertSpawnedTask(client, t) {
  const { rows } = await client.query(
    `INSERT INTO task (
       title, description, status, priority, assigned_to, created_by, due_at,
       parent_task_id, entity_type, entity_id, is_personal, scope_id,
       recurrence_rule, recurrence_series_id
     ) VALUES ($1,$2,'TO_DO',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (recurrence_series_id, due_at)
       WHERE recurrence_series_id IS NOT NULL AND due_at IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [
      t.title, t.description ?? null, t.priority || "NORMAL", t.assigned_to ?? null,
      t.created_by, t.due_at, t.parent_task_id ?? null, t.entity_type ?? null,
      t.entity_id ?? null, t.is_personal === true, t.scope_id ?? null,
      t.recurrence_rule ?? null, t.recurrence_series_id ?? null,
    ],
  );
  return rows[0] || null;
}

async function insertSpawnedEvent(client, e) {
  const { rows } = await client.query(
    `INSERT INTO calendar_event (
       title, event_type, location, description, start_at, end_at, all_day,
       recurrence_rule, recurrence_series_id, created_by,
       entity_type, entity_id, scope_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (recurrence_series_id, start_at)
       WHERE recurrence_series_id IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [
      e.title, e.event_type || "other", e.location ?? null, e.description ?? null,
      e.start_at, e.end_at, e.all_day === true, e.recurrence_rule ?? null,
      e.recurrence_series_id ?? null, e.created_by ?? null,
      e.entity_type ?? null, e.entity_id ?? null, e.scope_id ?? null,
    ],
  );
  return rows[0] || null;
}

/**
 * Carry a task's steps into its next occurrence.
 *
 * TITLES AND ORDER ONLY, and never their `is_done`: "file the return, notify
 * the director, archive the receipt" is the same checklist every month, and
 * copying last month's ticks would hand the accountant a finished list. Deadlines
 * are not copied either — a step due "the 14th" belongs to the occurrence it was
 * written on, and a copied absolute date would be in the past.
 */
async function copySubtasks(client, fromTaskId, toTaskId) {
  await client.query(
    `INSERT INTO task_subtask (task_id, title, display_order)
     SELECT $2, title, display_order FROM task_subtask WHERE task_id = $1`,
    [fromTaskId, toTaskId],
  );
}

/**
 * Carry an event's invitees into its next occurrence.
 *
 * A monthly meeting that loses its attendees every month is a meeting nobody
 * turns up to. Responses are NOT copied: "accepted" is an answer about one
 * date, and September's yes is not October's. Everyone starts back at INVITED,
 * which is the honest default the column already has.
 */
async function copyParticipants(client, fromEventId, toEventId) {
  await client.query(
    `INSERT INTO calendar_participant (calendar_event_id, user_id, external_name, is_organiser)
     SELECT $2, user_id, external_name, is_organiser
       FROM calendar_participant WHERE calendar_event_id = $1`,
    [fromEventId, toEventId],
  );
}

/**
 * Record that this row has materialised `cursor`, so it leaves the spawn scan
 * until that instant arrives.
 *
 * Called whether or not the insert won the race. A row that lost and did not
 * advance would match the scan again next minute, forever, computing the same
 * date and losing the same conflict — the exact wedge the reminder stamp exists
 * to prevent, in the other half of the sweep.
 */
async function advanceTaskCursor(client, id, cursorIso) {
  await client.query("UPDATE task SET recurrence_cursor_at = $2 WHERE task_id = $1", [id, cursorIso]);
}

async function advanceEventCursor(client, id, cursorIso) {
  await client.query(
    "UPDATE calendar_event SET recurrence_cursor_at = $2 WHERE calendar_event_id = $1",
    [id, cursorIso],
  );
}

/**
 * A series that has reached its UNTIL or its COUNT stops repeating.
 *
 * The rule is cleared and the series id KEPT: the rows stay linked as the
 * history of a series that ran, and the row leaves the spawn scan for good
 * because the scan is predicated on the rule.
 */
async function endTaskRecurrence(client, id) {
  await client.query(
    "UPDATE task SET recurrence_rule = NULL, recurrence_cursor_at = NULL, updated_at = now() WHERE task_id = $1",
    [id],
  );
}

async function endEventRecurrence(client, id) {
  await client.query(
    "UPDATE calendar_event SET recurrence_rule = NULL, recurrence_cursor_at = NULL, updated_at = now()\n     WHERE calendar_event_id = $1",
    [id],
  );
}

/**
 * Apply an edit to the rest of a series.
 *
 * Only rows that are NOT finished are touched. Editing "every month on the
 * 14th" to "the 15th" is a statement about the future; rewriting a filing that
 * was completed on the 14th of last month would falsify a record, and the
 * immutable-ledger ethos of this product is that history is not edited.
 *
 * `exclude` is the row the user is looking at, which `updateTask` has already
 * patched — so it is not written twice with two different `updated_at` values.
 */
async function updateSeriesTasks(client, seriesId, patch, { exclude } = {}) {
  const sets = [];
  const params = [];
  for (const key of ["title", "description", "priority", "assigned_to", "due_at",
    "entity_type", "entity_id", "is_personal", "recurrence_rule"]) {
    if (!(key in patch)) continue;
    params.push(patch[key] ?? null);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) return 0;
  params.push(seriesId, exclude);
  const { rowCount } = await client.query(
    `UPDATE task SET ${sets.join(", ")}, updated_at = now()
      WHERE recurrence_series_id = $${params.length - 1}
        AND task_id <> $${params.length}
        AND is_deleted = false AND status NOT IN ('DONE','CANCELLED')`,
    params,
  );
  return rowCount || 0;
}

async function updateSeriesEvents(client, seriesId, patch, { exclude } = {}) {
  const sets = [];
  const params = [];
  for (const key of ["title", "event_type", "location", "description", "start_at", "end_at",
    "all_day", "recurrence_rule", "scope_id"]) {
    if (!(key in patch)) continue;
    params.push(patch[key] ?? null);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) return 0;
  params.push(seriesId, exclude);
  const { rowCount } = await client.query(
    `UPDATE calendar_event SET ${sets.join(", ")}, updated_at = now()
      WHERE recurrence_series_id = $${params.length - 1}
        AND calendar_event_id <> $${params.length}
        AND is_deleted = false`,
    params,
  );
  return rowCount || 0;
}


/* ══════════════════════════════ ANALYTICS ════════════════════════════════ */
/**
 * Operational aggregations for `/workspace/analytics`.
 *
 * ── ONE POPULATION, COUNTED SIX WAYS ───────────────────────────────────────
 *
 * Every query below reuses `visibleWhere` — the SAME predicate the Tasks list,
 * the board and Today filter on. That is the whole reason Analytics can be
 * trusted: a metric built from its own bespoke WHERE clause would eventually
 * disagree with the list a user can open, and the user would be right and the
 * chart wrong. A total here is, by construction, the count of rows the caller
 * could have paged through themselves.
 *
 * ── WHY THE BUCKETS ARE COMPUTED IN SQL ────────────────────────────────────
 *
 * Aging bands, day keys and cycle times are `date_trunc`/`width_bucket`
 * expressions rather than post-processing in JavaScript, because the
 * alternative is shipping every row to the API process to count it — which
 * reintroduces the cap the aggregate exists to avoid, and makes "500 open
 * tasks" a 500-row response.
 *
 * ── TENANT TIME ────────────────────────────────────────────────────────────
 *
 * Day keys use `AT TIME ZONE $tz` so a bar labelled "15 September" is the
 * tenant's 15 September, matching Today and the Calendar. The zone arrives as
 * a parameter from `workspace.time.timezoneOf()`; it is never the server's.
 * `timezoneOf` validates the setting against the runtime's tzdb and falls back
 * to Douala, so a bad `hr.timezone` value cannot reach Postgres as SQLSTATE
 * 22023 ("invalid value for parameter 'TimeZone'").
 *
 * ── THIS IS OPERATIONAL DATA AND NOTHING ELSE ──────────────────────────────
 *
 * There is no join to appraisal, KPI rating, payroll or contract anywhere in
 * this section, and there must not be. "Workload by assignee" is how much work
 * is open on somebody's desk; it is not a score, and the Empower HR surfaces
 * that DO hold ratings have their own module and their own grants.
 */

/** The shared FROM/WHERE for every aggregate: one authorised task population. */
function analyticsScope(v, { from, to, status, priority, assignedTo, scopeId, dossierId }, start = 1) {
  const params = [];
  const where = ["t.is_deleted = false"];
  if (status) { params.push(status); where.push(`t.status = $${start + params.length - 1}`); }
  if (priority) { params.push(priority); where.push(`t.priority = $${start + params.length - 1}`); }
  if (assignedTo) { params.push(assignedTo); where.push(`t.assigned_to = $${start + params.length - 1}`); }
  if (scopeId) { params.push(scopeId); where.push(`t.scope_id = $${start + params.length - 1}`); }
  // The operations-file narrowing (13920). In the SHARED scope rather than in
  // the one panel that groups by it, so picking a file narrows every figure on
  // the dashboard — the summary, the throughput line and the workload table
  // included. A filter honoured by one panel and ignored by the other seven is
  // the exact disagreement this section's header refuses to ship.
  if (dossierId) { params.push(dossierId); where.push(`t.dossier_id = $${start + params.length - 1}`); }
  const vis = visibleWhere(v, start + params.length);
  params.push(...vis.params);
  where.push(...vis.sql);
  return { where, params, next: start + params.length, from, to };
}

/**
 * The headline counts: open, overdue, blocked, completed in the window.
 *
 * All four in ONE pass over the population rather than four round trips, and
 * all four from the same predicate — which is what makes "open 42" here and a
 * list showing 42 rows the same statement rather than two coincidences.
 */
async function analyticsSummary(client, { visibility, filters, nowIso }) {
  const s = analyticsScope(visibility, filters, 3);
  const params = [filters.from, filters.to, ...s.params];
  const nowParam = params.push(nowIso);
  const { rows } = await client.query(
    `SELECT
       count(*) FILTER (WHERE t.status NOT IN ('DONE','CANCELLED'))::int AS open_count,
       count(*) FILTER (WHERE t.status NOT IN ('DONE','CANCELLED')
                          AND t.due_at IS NOT NULL AND t.due_at < $${nowParam})::int AS overdue_count,
       count(*) FILTER (WHERE t.status = 'DONE'
                          AND t.completed_at >= $1 AND t.completed_at < $2)::int AS completed_count,
       count(*) FILTER (WHERE t.status = 'CANCELLED')::int AS cancelled_count,
       count(*) FILTER (WHERE t.status NOT IN ('DONE','CANCELLED') AND ${blockedSql("t")})::int AS blocked_count,
       count(*)::int AS total_count
     FROM task t
     WHERE ${s.where.join(" AND ")}`,
    params,
  );
  return rows[0];
}

/**
 * Throughput — tasks completed per tenant-local day in the window.
 *
 * Completion is `completed_at`, which `updateTask` stamps on the transition to
 * DONE and clears on the way back, so a task re-opened and finished again
 * counts on the day it was ACTUALLY finished rather than on both.
 */
async function analyticsThroughput(client, { visibility, filters, timeZone }) {
  const s = analyticsScope(visibility, filters, 4);
  const params = [filters.from, filters.to, timeZone, ...s.params];
  const { rows } = await client.query(
    `SELECT to_char(date_trunc('day', t.completed_at AT TIME ZONE $3), 'YYYY-MM-DD') AS day,
            count(*)::int AS completed
       FROM task t
      WHERE ${s.where.join(" AND ")}
        AND t.status = 'DONE'
        AND t.completed_at >= $1 AND t.completed_at < $2
      GROUP BY 1
      ORDER BY 1`,
    params,
  );
  return rows;
}

/**
 * Overdue aging — how long open work has been late, in bands.
 *
 * Bands rather than a mean: one task 200 days late and nine a day late average
 * to "21 days late", which describes none of them. The bands are the shape an
 * operations manager actually triages by.
 */
async function analyticsOverdueAging(client, { visibility, filters, nowIso }) {
  const s = analyticsScope(visibility, filters, 2);
  const params = [nowIso, ...s.params];
  const { rows } = await client.query(
    `SELECT CASE
              WHEN age_days < 1  THEN '<1'
              WHEN age_days < 3  THEN '1-2'
              WHEN age_days < 8  THEN '3-7'
              WHEN age_days < 31 THEN '8-30'
              ELSE '30+'
            END AS bucket,
            count(*)::int AS tasks
       FROM (
         SELECT EXTRACT(EPOCH FROM ($1::timestamptz - t.due_at)) / 86400.0 AS age_days
           FROM task t
          WHERE ${s.where.join(" AND ")}
            AND t.status NOT IN ('DONE','CANCELLED')
            AND t.due_at IS NOT NULL AND t.due_at < $1
       ) aged
      GROUP BY 1`,
    params,
  );
  return rows;
}

/**
 * Workload — open work per assignee, with the overdue and blocked slice.
 *
 * Unassigned rows are kept as a NULL group rather than dropped: "nobody owns
 * eleven of these" is the most actionable line on the chart, and hiding it
 * makes the totals disagree with the summary.
 */
async function analyticsWorkload(client, { visibility, filters, nowIso, limit = 25 }) {
  const s = analyticsScope(visibility, filters, 2);
  const params = [nowIso, ...s.params];
  const limitParam = params.push(limit);
  const { rows } = await client.query(
    `SELECT t.assigned_to AS user_id,
            a.full_name   AS assignee_name,
            count(*)::int AS open_tasks,
            count(*) FILTER (WHERE t.due_at IS NOT NULL AND t.due_at < $1)::int AS overdue_tasks,
            count(*) FILTER (WHERE ${blockedSql("t")})::int AS blocked_tasks
       FROM task t
       LEFT JOIN app_user a ON a.user_id = t.assigned_to
      WHERE ${s.where.join(" AND ")}
        AND t.status NOT IN ('DONE','CANCELLED')
      GROUP BY t.assigned_to, a.full_name
      ORDER BY open_tasks DESC, assignee_name NULLS LAST
      LIMIT $${limitParam}`,
    params,
  );
  return rows;
}

/**
 * Work by operations file — the rollup the file link exists for (13920).
 *
 * ── WHAT A ROW SAYS ────────────────────────────────────────────────────────
 *
 * One line per file that has work on it: how much is open, how much of that is
 * late, how much is waiting on something else, and how much was finished
 * inside the window. Ordered by overdue first and then by open volume, because
 * the question this panel is opened with is "which file is in trouble", not
 * "which file is busiest" — a file with forty tasks and none late needs
 * nobody's attention this morning.
 *
 * ── WHY `open_tasks` AND `completed_tasks` ARE COUNTED DIFFERENTLY ─────────
 *
 * Open/overdue/blocked are a snapshot of NOW; completed is a count inside the
 * window. That is the same split `analyticsSummary` makes, and it is the only
 * honest pairing: "still open" has no window (a task opened two years ago is
 * still open today) while "completed" without one would report the file's
 * whole history beside a seven-day backlog.
 *
 * ── UNLINKED WORK IS NOT A ROW ─────────────────────────────────────────────
 *
 * `dossier_id IS NOT NULL` — unlike the workload table, which keeps its
 * unassigned group because "nobody owns eleven of these" is actionable. Here
 * the NULL group would be every personal reminder in the tenant, dwarfing
 * every real file and saying nothing: this panel answers "how is work moving
 * per file", and a task with no file is not an answer to it. The summary above
 * still counts those rows, so nothing goes missing from the dashboard — it is
 * this ONE panel that is scoped to linked work, which is what its title says.
 */
async function analyticsByFile(client, { visibility, filters, nowIso, limit = 25 }) {
  const s = analyticsScope(visibility, filters, 4);
  const params = [nowIso, filters.from, filters.to, ...s.params];
  const limitParam = params.push(limit);
  const { rows } = await client.query(
    `SELECT t.dossier_id,
            dv.ref        AS dossier_ref,
            dcm.name      AS client_name,
            count(*) FILTER (WHERE t.status NOT IN ('DONE','CANCELLED'))::int AS open_tasks,
            count(*) FILTER (WHERE t.status NOT IN ('DONE','CANCELLED')
                               AND t.due_at IS NOT NULL AND t.due_at < $1)::int AS overdue_tasks,
            count(*) FILTER (WHERE t.status NOT IN ('DONE','CANCELLED') AND ${blockedSql("t")})::int AS blocked_tasks,
            count(*) FILTER (WHERE t.status = 'DONE'
                               AND t.completed_at >= $2 AND t.completed_at < $3)::int AS completed_tasks,
            count(*)::int AS total_tasks
       FROM task t
       LEFT JOIN dossier_visible dv ON dv.dossier_id = t.dossier_id
       LEFT JOIN client_master dcm ON dcm.client_id = dv.client_id
      WHERE ${s.where.join(" AND ")}
        AND t.dossier_id IS NOT NULL
      GROUP BY t.dossier_id, dv.ref, dcm.name
      ORDER BY overdue_tasks DESC, open_tasks DESC, dossier_ref NULLS LAST
      LIMIT $${limitParam}`,
    params,
  );
  return rows;
}

/**
 * Open work by milestone, for the ONE file a reader has narrowed to (13920).
 *
 * Only computed when `filters.dossierId` is set, and deliberately so: milestone
 * labels repeat across files ("Customs cleared" exists on every one of them),
 * so a tenant-wide grouping would add rows from unrelated shipments together
 * under one heading and present the sum as a stage's backlog. Narrowed to a
 * file, the labels are unique and the grouping means what it reads as.
 *
 * Through the SET (13950), so a task on two stages is counted under both —
 * the work is on both — and a task on none lands in the "No milestone" row
 * the LEFT JOIN keeps for it.
 */
async function analyticsByMilestone(client, { visibility, filters, nowIso, limit = 50 }) {
  const s = analyticsScope(visibility, filters, 2);
  const params = [nowIso, ...s.params];
  const limitParam = params.push(limit);
  const { rows } = await client.query(
    `SELECT tm.milestone_instance_id,
            mi.label      AS milestone_label,
            mi.status     AS milestone_status,
            mi.stage_seq  AS stage_seq,
            count(*) FILTER (WHERE t.status NOT IN ('DONE','CANCELLED'))::int AS open_tasks,
            count(*) FILTER (WHERE t.status NOT IN ('DONE','CANCELLED')
                               AND t.due_at IS NOT NULL AND t.due_at < $1)::int AS overdue_tasks,
            count(*)::int AS total_tasks
       FROM task t
       LEFT JOIN task_milestone tm ON tm.task_id = t.task_id
       LEFT JOIN milestone_instance mi ON mi.milestone_instance_id = tm.milestone_instance_id
      WHERE ${s.where.join(" AND ")}
      GROUP BY tm.milestone_instance_id, mi.label, mi.status, mi.stage_seq
      ORDER BY stage_seq NULLS LAST, milestone_label NULLS LAST
      LIMIT $${limitParam}`,
    params,
  );
  return rows;
}

/**
 * Which file each named stage belongs to — the service's cross-check on a
 * link (13920, several at once since 13950). One query for the whole set,
 * with the chain position, so the service can refuse a stranger by name and
 * order the rest as the chain does.
 */
async function milestoneFilesOf(client, milestoneInstanceIds) {
  if (!milestoneInstanceIds || !milestoneInstanceIds.length) return [];
  const { rows } = await client.query(
    `SELECT milestone_instance_id, dossier_id, label, stage_seq
       FROM milestone_instance
      WHERE milestone_instance_id = ANY($1::uuid[])`,
    [milestoneInstanceIds],
  );
  return rows;
}

/** One stage's file — 13920's single-stage form of the lookup above. */
async function milestoneFileOf(client, milestoneInstanceId) {
  const rows = await milestoneFilesOf(client, [milestoneInstanceId]);
  return rows[0] || null;
}

/**
 * Make the task's stage set exactly `ids` (13950).
 *
 * Two statements, both idempotent: rows no longer wanted go, rows already
 * present stay (ON CONFLICT on the pair), so a form that re-posts the same
 * three stages on every save churns nothing and a set of none clears the
 * table for that task. The caller runs this inside the task's transaction
 * with the projection column already written, so the two cannot be read
 * apart.
 */
async function replaceTaskMilestones(client, taskId, ids) {
  const wanted = [...new Set((ids || []).filter(Boolean))];
  await client.query(
    "DELETE FROM task_milestone WHERE task_id = $1 AND NOT (milestone_instance_id = ANY($2::uuid[]))",
    [taskId, wanted],
  );
  if (!wanted.length) return [];
  const { rows } = await client.query(
    `INSERT INTO task_milestone (task_id, milestone_instance_id)
     SELECT $1, unnest($2::uuid[])
     ON CONFLICT DO NOTHING
     RETURNING milestone_instance_id`,
    [taskId, wanted],
  );
  return rows.map((r) => r.milestone_instance_id);
}

/**
 * Cycle time — creation to completion, for work finished in the window.
 *
 * Reported as a distribution (bands) plus the median, not a mean. A single
 * task that sat open for a year drags a mean past every real value; the median
 * is what "how long does this usually take" means.
 */
async function analyticsCycleTime(client, { visibility, filters }) {
  const s = analyticsScope(visibility, filters, 3);
  const params = [filters.from, filters.to, ...s.params];
  const { rows } = await client.query(
    `SELECT CASE
              WHEN days < 1  THEN '<1'
              WHEN days < 3  THEN '1-2'
              WHEN days < 8  THEN '3-7'
              WHEN days < 31 THEN '8-30'
              ELSE '30+'
            END AS bucket,
            count(*)::int AS tasks,
            round(avg(days)::numeric, 2) AS avg_days
       FROM (
         SELECT EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 86400.0 AS days
           FROM task t
          WHERE ${s.where.join(" AND ")}
            AND t.status = 'DONE'
            AND t.completed_at IS NOT NULL
            AND t.completed_at >= $1 AND t.completed_at < $2
       ) c
      GROUP BY 1`,
    params,
  );
  const [{ median_days = null } = {}] = (
    await client.query(
      `SELECT round(percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 86400.0
              )::numeric, 2) AS median_days
         FROM task t
        WHERE ${s.where.join(" AND ")}
          AND t.status = 'DONE'
          AND t.completed_at IS NOT NULL
          AND t.completed_at >= $1 AND t.completed_at < $2`,
      params,
    )
  ).rows;
  return { buckets: rows, median_days };
}

/**
 * Blocked work — open tasks with an unresolved prerequisite OR a live
 * blockage, oldest hold first.
 *
 * The prerequisite's TITLE is not selected. A blocked task may be visible to
 * the caller while the thing blocking it is not, and the table's job is to say
 * "this is waiting", not to disclose what on. A BLOCKAGE note IS selected, and
 * the difference is deliberate: the note was written to be read by exactly
 * this reader ("held at customs — network down"), whereas a prerequisite is a
 * task row with its own visibility. The detail panel resolves the
 * prerequisite through the same intersection rule and redacts there.
 *
 * `blocked_since` is the older of the two holds, because the panel orders by
 * "longest wait first" and a task that has been held since Tuesday is not
 * younger than its Wednesday dependency.
 */
async function analyticsBlocked(client, { visibility, filters, limit = 50 }) {
  const s = analyticsScope(visibility, filters, 1);
  const params = [...s.params];
  const limitParam = params.push(limit);
  const { rows } = await client.query(
    `SELECT t.task_id, t.title, t.status, t.priority, t.due_at,
            t.assigned_to, a.full_name AS assigned_to_name,
            t.entity_type, t.entity_id,
            COALESCE(deps.blocking_count, 0) AS blocking_count,
            deps.blocked_since AS dependency_since,
            hold.task_blockage_id,
            hold.note               AS blockage_note,
            hold.raised_at          AS blockage_since,
            hold.estimated_resolve_at AS blockage_eta,
            least(deps.blocked_since, hold.raised_at) AS blocked_since
       FROM task t
       LEFT JOIN app_user a ON a.user_id = t.assigned_to
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS blocking_count, min(d.created_at) AS blocked_since
           FROM task_dependency d
           JOIN task p ON p.task_id = d.depends_on_task_id AND p.is_deleted = false
          WHERE d.task_id = t.task_id AND d.overridden_at IS NULL AND p.status <> 'DONE'
       ) deps ON deps.blocking_count > 0
       LEFT JOIN LATERAL (
         SELECT b.task_blockage_id, b.note, b.raised_at, b.estimated_resolve_at
           FROM task_blockage b
          WHERE b.task_id = t.task_id AND b.resolved_at IS NULL
          LIMIT 1
       ) hold ON true
      WHERE ${s.where.join(" AND ")}
        AND t.status NOT IN ('DONE','CANCELLED')
        AND (deps.blocking_count > 0 OR hold.task_blockage_id IS NOT NULL)
      ORDER BY blocked_since ASC
      LIMIT $${limitParam}`,
    params,
  );
  return rows;
}

/**
 * Burn-down — how the open backlog moved across the window.
 *
 * WORK VOLUME, not money: this is the operational burn-down the guide names,
 * and it has nothing to do with cash. Each tenant-local day carries what was
 * CREATED and what was COMPLETED that day; the running open balance is derived
 * in the service from the opening backlog, so the chart and its table are one
 * calculation rather than two.
 */
async function analyticsBurndown(client, { visibility, filters, timeZone }) {
  const s = analyticsScope(visibility, filters, 4);
  const params = [filters.from, filters.to, timeZone, ...s.params];
  const { rows } = await client.query(
    `WITH scoped AS (
       SELECT t.task_id, t.created_at, t.completed_at, t.status
         FROM task t
        WHERE ${s.where.join(" AND ")}
     ),
     created AS (
       SELECT to_char(date_trunc('day', created_at AT TIME ZONE $3), 'YYYY-MM-DD') AS day,
              count(*)::int AS n
         FROM scoped WHERE created_at >= $1 AND created_at < $2 GROUP BY 1
     ),
     closed AS (
       SELECT to_char(date_trunc('day', completed_at AT TIME ZONE $3), 'YYYY-MM-DD') AS day,
              count(*)::int AS n
         FROM scoped
        WHERE status = 'DONE' AND completed_at >= $1 AND completed_at < $2 GROUP BY 1
     )
     SELECT COALESCE(created.day, closed.day) AS day,
            COALESCE(created.n, 0) AS created,
            COALESCE(closed.n, 0)  AS completed
       FROM created FULL OUTER JOIN closed ON created.day = closed.day
      ORDER BY 1`,
    params,
  );
  // The backlog as it stood the instant the window opened. Without it the line
  // starts at zero and reads as "we had no work", which is never true.
  //
  // ITS OWN SCOPE, AND ITS OWN NUMBERING. The opening read is a different shape
  // from the day series — one window bound, no `AT TIME ZONE`, no bucketing —
  // so it cannot borrow the series' WHERE clause and parameter array. Doing
  // that left `$2` (the window's `to`) and `$3` (the zone) referenced nowhere in
  // the statement, and Postgres refuses a bound parameter it cannot type:
  // SQLSTATE 42P18, "could not determine data type of parameter $2". It is a
  // hard error on every request, in one of the eight reads the dashboard
  // `Promise.all`s, so the failure was total — every figure on /workspace/
  // analytics answered with a 500 rather than the one panel going blank.
  //
  // The rule this encodes: a query's placeholder numbering must be built for
  // the query that uses it. `analyticsScope`'s `start` exists for exactly this,
  // and the unit test below now asserts the *whole* series is bound — not just
  // that the highest `$n` fits inside `params`.
  const open = analyticsScope(visibility, filters, 2);
  const { rows: opening } = await client.query(
    `SELECT count(*)::int AS open_at_start
       FROM task t
      WHERE ${open.where.join(" AND ")}
        AND t.created_at < $1
        AND (t.completed_at IS NULL OR t.completed_at >= $1)
        AND t.status <> 'CANCELLED'`,
    [filters.from, ...open.params],
  );
  return { days: rows, open_at_start: opening[0] ? opening[0].open_at_start : 0 };
}

/** Open work by status and by priority — the two composition reads. */
async function analyticsComposition(client, { visibility, filters }) {
  const s = analyticsScope(visibility, filters, 1);
  const { rows } = await client.query(
    `SELECT t.status, t.priority, count(*)::int AS tasks
       FROM task t
      WHERE ${s.where.join(" AND ")}
      GROUP BY t.status, t.priority`,
    s.params,
  );
  return rows;
}

module.exports = {
  visibleWhere,
  listTasks, boardTasks, tasksInRange, subtasksInRange, dayTasks, daySubtasks, insertTask, findTask, updateTask, softDeleteTask,
  listSubtasks, insertSubtask, updateSubtask, deleteSubtask,
  listWatchers, addWatcher, removeWatcher,
  listChildTasks, childCountsFor,
  listDependencies, listDependents, dependencyWouldCycle, findDependency, insertDependency,
  overrideDependency, clearDependencyOverride, deleteDependency, blockedCountsFor,
  activeBlockagesFor, activeBlockageFor, listBlockages, insertBlockage, resolveBlockageRow,
  setBlockageDueShift, shiftTaskDue, existingUserIds,
  analyticsScope, analyticsSummary, analyticsThroughput, analyticsOverdueAging,
  analyticsWorkload, analyticsCycleTime, analyticsBlocked, analyticsBurndown,
  analyticsComposition, analyticsByFile, analyticsByMilestone, milestoneFileOf, milestoneFilesOf, replaceTaskMilestones,
  eventVisibleWhere, listEventsWindow, listEvents, insertEvent, findEvent, updateEvent, softDeleteEvent, findEventClashes,
  listParticipants, insertParticipant, respondParticipant, removeParticipant,
  dueTaskReminders, dueEventReminders, markReminderSent,
  listReminders, insertReminder, replaceReminders, deleteReminder,
  listReminderTemplates, materialiseReminders, settleRemindersForDoneTask,
  rearmOwnerReminders, syncParentReminderColumns,
  listSpawnDueTasks, listSpawnDueEvents, countSeriesTasks, countSeriesEvents,
  insertSpawnedTask, insertSpawnedEvent, copySubtasks, copyParticipants,
  advanceTaskCursor, advanceEventCursor, endTaskRecurrence, endEventRecurrence,
  updateSeriesTasks, updateSeriesEvents,
};
