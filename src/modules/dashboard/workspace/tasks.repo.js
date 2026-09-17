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

/** Subtask progress, as two correlated counts rather than a join+group. */
const SUBTASK_COUNTS = `
  (SELECT count(*)::int FROM task_subtask s WHERE s.task_id = t.task_id) AS subtask_count,
  (SELECT count(*)::int FROM task_subtask s WHERE s.task_id = t.task_id AND s.is_done) AS subtask_done_count`;

const TASK_SELECT = `
  SELECT t.*,
         a.full_name AS assigned_to_name,
         c.full_name AS created_by_name,
         ${SUBTASK_COUNTS}
    FROM task t
    LEFT JOIN app_user a ON a.user_id = t.assigned_to
    LEFT JOIN app_user c ON c.user_id = t.created_by`;

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
async function listTasks(client, { audience, userId, scopeIds, personalOnly, status, assignedTo, q, entity, limit = 50, offset = 0 }) {
  const params = [limit, offset];
  const where = ["t.is_deleted = false"];
  if (status) { params.push(status); where.push(`t.status = $${params.length}`); }
  if (assignedTo) { params.push(assignedTo); where.push(`t.assigned_to = $${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`t.title ILIKE $${params.length}`); }
  if (entity) {
    params.push(entity.entity_type, entity.entity_id);
    where.push(`t.entity_type = $${params.length - 1} AND t.entity_id = $${params.length}`);
  }
  const vis = visibleWhere({ audience, userId, scopeIds, personalOnly }, params.length + 1);
  params.push(...vis.params);
  where.push(...vis.sql);

  const { rows } = await client.query(
    `${TASK_SELECT_PAGED}
      WHERE ${where.join(" AND ")}
      ORDER BY (t.due_at IS NULL), t.due_at ASC NULLS LAST, t.created_at DESC
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
async function boardTasks(client, { audience, userId, scopeIds, personalOnly, assignedTo }) {
  const params = [];
  const where = ["t.is_deleted = false", "t.status <> 'CANCELLED'"];
  if (assignedTo) { params.push(assignedTo); where.push(`t.assigned_to = $${params.length}`); }
  const vis = visibleWhere({ audience, userId, scopeIds, personalOnly }, params.length + 1);
  params.push(...vis.params);
  where.push(...vis.sql);

  const { rows } = await client.query(
    `${TASK_SELECT}
      WHERE ${where.join(" AND ")}
      ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
               (t.due_at IS NULL), t.due_at ASC NULLS LAST, t.created_at DESC
      LIMIT 200`,
    params,
  );
  const board = { TO_DO: [], IN_PROGRESS: [], IN_REVIEW: [], DONE: [] };
  for (const r of rows) if (board[r.status]) board[r.status].push(r);
  return board;
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
  const { rows } = await client.query(
    `SELECT s.task_subtask_id, s.task_id, s.title, s.due_at, s.is_done,
            t.title AS task_title, t.status AS task_status, t.priority AS task_priority,
            t.entity_type, t.entity_id
       FROM task_subtask s
       JOIN task t ON t.task_id = s.task_id
      WHERE ${where.join(" AND ")}
      ORDER BY s.due_at ASC NULLS LAST
      LIMIT 200`,
    params,
  );
  return rows;
}

async function insertTask(client, t) {
  const { rows } = await client.query(
    `INSERT INTO task (
       title, description, status, priority, assigned_to, created_by, due_at,
       parent_task_id, entity_type, entity_id, is_personal, scope_id,
       reminder_minutes, remind_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      t.title, t.description ?? null, t.status || "TO_DO", t.priority || "NORMAL",
      t.assigned_to ?? null, t.created_by, t.due_at ?? null, t.parent_task_id ?? null,
      t.entity_type ?? null, t.entity_id ?? null, t.is_personal === true, t.scope_id ?? null,
      t.reminder_minutes ?? null, t.remind_at ?? null,
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
 * service computes it and passes `rearm` when it changes.
 */
async function updateTask(client, id, patch, { rearm = false } = {}) {
  const sets = [];
  const params = [];
  for (const key of ["title", "description", "status", "priority", "assigned_to", "due_at",
    "entity_type", "entity_id", "is_personal", "reminder_minutes", "remind_at"]) {
    if (!(key in patch)) continue;
    params.push(patch[key] ?? null);
    sets.push(`${key} = $${params.length}`);
  }
  if (rearm) {
    // Moving a reminder re-arms it. Without this a rescheduled task would keep
    // its fired stamp and never remind anyone again — silently.
    sets.push("reminder_sent_at = NULL");
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
async function listEvents(client, { from, to, eventType, userId, mine }) {
  const params = [from, to];
  const where = ["e.is_deleted = false", "e.start_at < $2", "e.end_at >= $1"];
  if (eventType) { params.push(eventType); where.push(`e.event_type = $${params.length}`); }
  if (mine && userId) { params.push(userId); where.push(`e.created_by = $${params.length}`); }
  const { rows } = await client.query(
    `${EVENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY e.start_at ASC LIMIT 500`,
    params,
  );
  return rows;
}

async function insertEvent(client, e) {
  const { rows } = await client.query(
    `INSERT INTO calendar_event (
       title, event_type, location, description, start_at, end_at, all_day,
       recurrence_rule, created_by, reminder_minutes, remind_at, entity_type, entity_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      e.title, e.event_type || "other", e.location ?? null, e.description ?? null,
      e.start_at, e.end_at, e.all_day === true, e.recurrence_rule ?? null,
      e.created_by ?? null, e.reminder_minutes ?? null, e.remind_at ?? null,
      e.entity_type ?? null, e.entity_id ?? null,
    ],
  );
  return rows[0];
}

async function findEvent(client, id) {
  const { rows } = await client.query(`${EVENT_SELECT} WHERE e.calendar_event_id = $1 AND e.is_deleted = false`, [id]);
  return rows[0] || null;
}

async function updateEvent(client, id, patch, { rearm = false } = {}) {
  const sets = [];
  const params = [];
  for (const key of ["title", "event_type", "location", "description", "start_at", "end_at",
    "all_day", "recurrence_rule", "reminder_minutes", "remind_at", "entity_type", "entity_id"]) {
    if (!(key in patch)) continue;
    params.push(patch[key] ?? null);
    sets.push(`${key} = $${params.length}`);
  }
  if (rearm) sets.push("reminder_sent_at = NULL");
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
 * Reads the partial index (13810): `reminder_sent_at IS NULL` is IN the index
 * predicate, so in a tenant where almost everything has already fired this
 * scans almost nothing. Tasks exclude DONE/CANCELLED — reminding someone about
 * work that is finished is how an alert gets filtered forever.
 */
async function dueTaskReminders(client, nowIso, limit) {
  const { rows } = await client.query(
    `SELECT task_id, title, due_at, assigned_to, created_by, priority, entity_type, entity_id
       FROM task
      WHERE remind_at <= $1 AND reminder_sent_at IS NULL AND is_deleted = false
        AND status NOT IN ('DONE','CANCELLED')
      ORDER BY remind_at
      LIMIT $2`,
    [nowIso, limit],
  );
  return rows;
}

async function dueEventReminders(client, nowIso, limit) {
  const { rows } = await client.query(
    `SELECT e.calendar_event_id, e.title, e.start_at, e.location, e.created_by, e.entity_type, e.entity_id,
            COALESCE(array_agg(DISTINCT p.user_id) FILTER (WHERE p.user_id IS NOT NULL), '{}') AS participant_user_ids
       FROM calendar_event e
       LEFT JOIN calendar_participant p ON p.calendar_event_id = e.calendar_event_id
      WHERE e.remind_at <= $1 AND e.reminder_sent_at IS NULL AND e.is_deleted = false
      GROUP BY e.calendar_event_id
      ORDER BY e.remind_at
      LIMIT $2`,
    [nowIso, limit],
  );
  return rows;
}

/**
 * Stamp a reminder as fired.
 *
 * The sweep calls this EVEN WHEN DELIVERY FAILED. Losing one notification is
 * recoverable — the user sees the task on their desk. A row that never gets
 * stamped is re-selected every minute forever, and one bad row then consumes
 * the batch and stops every other reminder in the tenant from firing. That is
 * the wedge this prevents, and it is why the stamp is not conditional.
 */
async function markTaskReminderSent(client, id, nowIso) {
  await client.query("UPDATE task SET reminder_sent_at = $2 WHERE task_id = $1", [id, nowIso]);
}

async function markEventReminderSent(client, id, nowIso) {
  await client.query("UPDATE calendar_event SET reminder_sent_at = $2 WHERE calendar_event_id = $1", [id, nowIso]);
}

module.exports = {
  visibleWhere,
  listTasks, boardTasks, tasksInRange, subtasksInRange, insertTask, findTask, updateTask, softDeleteTask,
  listSubtasks, insertSubtask, updateSubtask, deleteSubtask,
  listWatchers, addWatcher, removeWatcher,
  listEvents, insertEvent, findEvent, updateEvent, softDeleteEvent, findEventClashes,
  listParticipants, insertParticipant, respondParticipant, removeParticipant,
  dueTaskReminders, dueEventReminders, markTaskReminderSent, markEventReminderSent,
};
