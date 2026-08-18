"use strict";
/**
 * training head + training_attendance children + requirements. All SQL is here.
 *
 * ── THE ROSTER JOINS THE EMPLOYEE NAME ─────────────────────────────────────
 *
 * `listAttendees` used to return bare `employee_id`s, and the screen resolved
 * them against `useList("/employees")` — an unpaginated call that the API caps
 * at 50 rows (query-helpers `page()`). Any employee past the fiftieth showed on
 * the roster as eight hex characters, and could not be ADDED to a session at
 * all, because the picker was built from the same truncated list. Joining the
 * name here removes the client's need to hold a roster of the whole company to
 * render five rows.
 */
const { makeRepo } = require("../../../shared/crud/resource");
const { insertOne, updateOne, getById, listComplete, page } = require("../../../shared/db/query-helpers");

const base = makeRepo({
  table: "training",
  pk: "training_id",
  activeColumn: null,
  searchColumn: "title",
  orderBy: "created_at DESC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at", "title", "starts_at"],
  // API F-28: this repo used makeRepo's list unchanged, which honours only
  // limit/offset/q — any other key was silently ignored. Now it is named.
  filterable: ["status", "mode", "training_requirement_id"],
});

/** One session, with the counts a screen needs beside it. Two subqueries rather
 *  than a GROUP BY so the head row survives a session with no roster. */
async function get(client, id) {
  const { rows } = await client.query(
    `SELECT t.*,
            r.title            AS requirement_title,
            r.valid_months     AS requirement_valid_months,
            r.warn_days        AS requirement_warn_days,
            fe.full_name       AS facilitator_name,
            (SELECT count(*) FROM training_attendance a WHERE a.training_id = t.training_id)                    AS booked_count,
            (SELECT count(*) FROM training_attendance a WHERE a.training_id = t.training_id AND a.attended)     AS attended_count
       FROM training t
       LEFT JOIN training_requirement r ON r.training_requirement_id = t.training_requirement_id
       LEFT JOIN employee fe            ON fe.employee_id = t.facilitator_employee_id
      WHERE t.training_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * The session list, with roster counts. Replaces makeRepo's plain list so the
 * table can show "12 booked / 9 attended" without one request per row — the
 * previous screen simply did not show it, which is why nobody could see a
 * session was over capacity until they opened it.
 */
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [];
  const where = [];
  if (q.status) { params.push(q.status); where.push(`t.status = $${params.length}`); }
  if (q.mode) { params.push(q.mode); where.push(`t.mode = $${params.length}`); }
  if (q.training_requirement_id) { params.push(q.training_requirement_id); where.push(`t.training_requirement_id = $${params.length}`); }
  if (q.q) { params.push(`%${q.q}%`); where.push(`t.title ILIKE $${params.length}`); }
  params.push(limit, offset);
  const { rows } = await client.query(
    `SELECT t.*,
            r.title      AS requirement_title,
            fe.full_name AS facilitator_name,
            count(*) OVER() AS total_count,
            (SELECT count(*) FROM training_attendance a WHERE a.training_id = t.training_id)                AS booked_count,
            (SELECT count(*) FROM training_attendance a WHERE a.training_id = t.training_id AND a.attended) AS attended_count
       FROM training t
       LEFT JOIN training_requirement r ON r.training_requirement_id = t.training_requirement_id
       LEFT JOIN employee fe            ON fe.employee_id = t.facilitator_employee_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      -- Newest first, but a session with no start time sorts by when it was
      -- created rather than vanishing to the end of the list.
      ORDER BY COALESCE(t.starts_at, t.created_at) DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  // Same contract as makeRepo.list: the pre-LIMIT total rides on a
  // non-enumerable property so the result stays a plain array for every caller
  // that treats it as one, and makeController — which knows to look — turns it
  // into the `meta` envelope.
  const total = rows.length ? Number(rows[0].total_count) : 0;
  rows.forEach((r) => delete r.total_count);
  Object.defineProperty(rows, "_total", { value: total, enumerable: false });
  Object.defineProperty(rows, "_page", { value: { limit, offset }, enumerable: false });
  return rows;
}

/* ── Roster ─────────────────────────────────────────────────────────────── */

const insertAttendee = (client, data) => insertOne(client, "training_attendance", data);
const getAttendee = (client, id) => getById(client, "training_attendance", "training_attendance_id", id);
const updateAttendee = (client, id, patch) => updateOne(client, "training_attendance", "training_attendance_id", id, patch);

async function listAttendees(client, trainingId) {
  const { rows } = await listComplete(
    client,
    `SELECT a.*, e.full_name AS employee_name, e.department, e.job_title
       FROM training_attendance a
       LEFT JOIN employee e ON e.employee_id = a.employee_id
      WHERE a.training_id = $1
      ORDER BY e.full_name NULLS LAST, a.training_attendance_id`,
    [trainingId],
    { label: "Training attendance", ceiling: 5000 },
  );
  return rows;
}

/** One person's row on one session — the uniqueness ux_training_attendance_person
 *  guarantees, used to answer "are they already on this?" without a race. */
async function findAttendee(client, trainingId, employeeId) {
  const { rows } = await client.query(
    "SELECT * FROM training_attendance WHERE training_id = $1 AND employee_id = $2",
    [trainingId, employeeId],
  );
  return rows[0] || null;
}

/** Everyone on the roster who joined but has not been judged yet — what the
 *  session close reads to derive attendance from presence. */
async function presenceRows(client, trainingId) {
  const { rows } = await client.query(
    "SELECT * FROM training_attendance WHERE training_id = $1",
    [trainingId],
  );
  return rows;
}

/* ── Notes ──────────────────────────────────────────────────────────────── */

const insertNote = (client, data) => insertOne(client, "training_note", data);

async function listNotes(client, trainingId) {
  const { rows } = await listComplete(
    client,
    `SELECT n.*, u.full_name AS author_name
       FROM training_note n
       LEFT JOIN app_user u ON u.user_id = n.author_id
      WHERE n.training_id = $1
      ORDER BY n.created_at ASC`,
    [trainingId],
    { label: "Training notes", ceiling: 2000 },
  );
  return rows;
}

/* ── Live dictation (10708) ─────────────────────────────────────────────── */

/**
 * Append a transcribed chunk to the session's running transcript.
 *
 * The separator is a real line break rather than a space: Whisper chunks
 * arrive mid-sentence, and a glued word boundary is worse than a line that
 * reads slightly awkwardly. An empty chunk is a no-op — a slice of room
 * silence transcribed to nothing must not sprinkle blank lines through the
 * record.
 */
async function appendTranscript(client, trainingId, chunk) {
  const text = String(chunk || "").trim();
  if (!text) {
    const { rows } = await client.query(
      "SELECT transcript FROM training WHERE training_id = $1",
      [trainingId],
    );
    return rows[0] || null;
  }
  const { rows } = await client.query(
    `UPDATE training
        SET transcript = CASE
              WHEN transcript IS NULL OR btrim(transcript) = '' THEN $2
              ELSE transcript || E'\\n' || $2
            END,
            updated_at = now()
      WHERE training_id = $1
      RETURNING *`,
    [trainingId, text],
  );
  return rows[0] || null;
}

/* ── Requirements ───────────────────────────────────────────────────────── */

const insertRequirement = (client, data) => insertOne(client, "training_requirement", data);
const getRequirement = (client, id) => getById(client, "training_requirement", "training_requirement_id", id);
const updateRequirement = (client, id, patch) => updateOne(client, "training_requirement", "training_requirement_id", id, patch);

async function listRequirements(client, { includeInactive = false } = {}) {
  const { rows } = await listComplete(
    client,
    `SELECT * FROM training_requirement
      ${includeInactive ? "" : "WHERE is_active = true"}
      ORDER BY is_active DESC, title ASC`,
    [],
    { label: "Training requirements", ceiling: 1000 },
  );
  return rows;
}

/**
 * Compliance, in one query: every active employee a requirement could apply to,
 * with their most recent PASS of it.
 *
 * The join is on `training.training_requirement_id`, not on the course title —
 * a title match would break the first time somebody scheduled "Forklift safety
 * (refresher)". DISTINCT ON takes the latest attended session per person, which
 * is the only one that decides whether they are current: an older pass cannot
 * make a lapsed certificate valid again.
 *
 * The employee list is NOT filtered by department here. Which staff a
 * requirement covers is `requirementApplies` in the rules — one place, shared
 * with the screen — and doing it in SQL as well would be a second copy of the
 * matching rule that could drift from the first.
 */
async function complianceRows(client, requirementId) {
  const { rows } = await client.query(
    `SELECT e.employee_id, e.full_name, e.department, e.job_title,
            p.attended_on, p.certificate_expires_on, p.certificate_vault_id, p.training_id, p.training_title
       FROM employee e
       LEFT JOIN LATERAL (
         SELECT DISTINCT ON (a.employee_id)
                a.employee_id,
                COALESCE(t.closed_at::date, t.starts_at::date, t.scheduled_on) AS attended_on,
                a.certificate_expires_on, a.certificate_vault_id,
                t.training_id, t.title AS training_title
           FROM training_attendance a
           JOIN training t ON t.training_id = a.training_id
          WHERE a.employee_id = e.employee_id
            AND a.attended = true
            AND t.training_requirement_id = $1
          ORDER BY a.employee_id, COALESCE(t.closed_at::date, t.starts_at::date, t.scheduled_on) DESC NULLS LAST
       ) p ON true
      WHERE e.is_active = true
      ORDER BY e.full_name`,
    [requirementId],
  );
  return rows;
}

/** Certificates lapsing inside `days` — the expiry watcher's only read. */
async function expiringCertificates(client, { days = 60 } = {}) {
  const { rows } = await client.query(
    `SELECT a.training_attendance_id, a.employee_id, a.certificate_expires_on, a.certificate_vault_id,
            e.full_name AS employee_name, e.department, e.job_title,
            t.title AS training_title, t.training_requirement_id,
            r.title AS requirement_title, r.warn_days
       FROM training_attendance a
       JOIN employee e ON e.employee_id = a.employee_id AND e.is_active = true
       JOIN training t ON t.training_id = a.training_id
       LEFT JOIN training_requirement r ON r.training_requirement_id = t.training_requirement_id
      WHERE a.certificate_expires_on IS NOT NULL
        AND a.attended = true
        AND a.certificate_expires_on <= (CURRENT_DATE + ($1 || ' days')::interval)
      ORDER BY a.certificate_expires_on ASC`,
    [String(Math.max(0, Number(days) || 0))],
  );
  return rows;
}

module.exports = {
  ...base,
  get, list,
  insertAttendee, getAttendee, updateAttendee, listAttendees, findAttendee, presenceRows,
  insertNote, listNotes, appendTranscript,
  insertRequirement, getRequirement, updateRequirement, listRequirements,
  complianceRows, expiringCertificates,
};
