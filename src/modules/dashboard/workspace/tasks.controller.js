"use strict";
/**
 * My Workspace — HTTP handlers for tasks and calendar events (MOD-00A).
 *
 * Thin by rule (doc/CONVENTIONS.md): no SQL, no business rules. Each handler
 * resolves the caller's context, hands it to the service inside the request's
 * tenant connection, and shapes the response.
 *
 * `ctx` is the whole of what the service is allowed to know about the caller.
 * Building it here rather than passing `req` down means the service cannot
 * reach for a header it was never meant to read, and a test can construct a
 * caller without an HTTP request in sight.
 */

const { asyncHandler } = require("../../../utils/errors");
const { sendPaged } = require("../../../shared/http/paged");
const service = require("./tasks.service");

/**
 * Who is asking, and how far their reach goes.
 *
 * `permission_scope` and `scope_ids` are set by `requirePermission` in
 * middleware/rbac.js — the CEO gets "all", everybody else gets their
 * organigramme closure. Nothing here re-derives them, because a second copy of
 * an authorisation rule is a second place to get it wrong.
 */
const ctxOf = (req) => ({
  user: req.user,
  permission_scope: req.permission_scope || "all",
  scope_ids: req.scope_ids || null,
  audience: req.query && req.query.audience,
  requestId: req.request_id,
});

/* ══════════════════════════════════ TASKS ════════════════════════════════ */

const listTasks = asyncHandler(async (req, res) => {
  const q = req.query;
  const out = await req.tenantDb((c) =>
    service.listTasks(c, ctxOf(req), {
      audience: q.audience,
      status: q.status,
      priority: q.priority,
      assigned_to: q.assigned_to,
      q: q.q,
      limit: q.limit,
      offset: q.offset,
      entity: q.entity_type && q.entity_id ? { entity_type: q.entity_type, entity_id: q.entity_id } : null,
    }),
  );
  // `audiences` travels on the header rather than in the body so the payload
  // stays a plain list of rows, which is what every other list endpoint here
  // returns and what the client's list hooks already expect.
  res.set("X-Available-Audiences", out.audiences.join(","));
  res.set("X-Effective-Audience", out.audience);
  sendPaged(res, out);
});

const getBoard = asyncHandler(async (req, res) => {
  const out = await req.tenantDb((c) =>
    service.getBoard(c, ctxOf(req), { audience: req.query.audience, assigned_to: req.query.assigned_to }),
  );
  // The board carries fields BESIDE the columns (which audiences this caller may
  // pick, and which one the server actually honoured). They ride INSIDE `data`
  // — the same shape as `/workspace/day` — because the client's `tenant()`
  // helper returns only the `data` payload and would drop any sibling keys.
  res.json({ data: { board: out.board, audience: out.audience, audiences: out.audiences } });
});

/**
 * Tasks and events for one window, interleaved by time — the Today surface.
 *
 * A caller that sends no window gets today in the tenant's own clock, which is
 * the answer they meant: "today" is not a UTC concept and a user in Douala
 * asking at 23:30 local is not asking about tomorrow.
 */
const getDay = asyncHandler(async (req, res) => {
  const from = req.query.from || (await req.tenantDb((c) => startOfToday(c)));
  const to = req.query.to || (await req.tenantDb((c) => endOfToday(c)));
  res.json({
    data: await req.tenantDb((c) =>
      service.dayTimeline(c, ctxOf(req), { from, to, audience: req.query.audience }),
    ),
  });
});

const getTask = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.getTask(c, ctxOf(req), req.params.id)) });
});

/**
 * Deadlines (task + subtask due dates) in a window — the calendar's overlay.
 *
 * Defaults an unbounded request to the current month, the same way `listEvents`
 * does, so the grid can ask without computing a fallback the server already
 * owns.
 */
const getDeadlines = asyncHandler(async (req, res) => {
  const from = req.query.from || startOfMonthUtc();
  const to = req.query.to || endOfMonthUtc();
  res.json({
    data: await req.tenantDb((c) =>
      service.deadlinesInRange(c, ctxOf(req), { from, to, audience: req.query.audience }),
    ),
  });
});

const createTask = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await req.tenantDb((c) => service.createTask(c, ctxOf(req), req.body)) });
});

const updateTask = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.updateTask(c, ctxOf(req), req.params.id, req.body)) });
});

const changeStatus = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.changeStatus(c, ctxOf(req), req.params.id, req.body.status)) });
});

const deleteTask = asyncHandler(async (req, res) => {
  await req.tenantDb((c) => service.deleteTask(c, ctxOf(req), req.params.id));
  res.status(204).end();
});

/* ── subtasks ───────────────────────────────────────────────────────────── */

const addSubtask = asyncHandler(async (req, res) => {
  res.status(201).json({
    data: await req.tenantDb((c) => service.addSubtask(c, ctxOf(req), req.params.id, req.body)),
  });
});

const patchSubtask = asyncHandler(async (req, res) => {
  res.json({
    data: await req.tenantDb((c) =>
      service.patchSubtask(c, ctxOf(req), req.params.id, req.params.subtaskId, req.body),
    ),
  });
});

const deleteSubtask = asyncHandler(async (req, res) => {
  await req.tenantDb((c) => service.deleteSubtask(c, ctxOf(req), req.params.id, req.params.subtaskId));
  res.status(204).end();
});

/* ── watchers ───────────────────────────────────────────────────────────── */

const addWatcher = asyncHandler(async (req, res) => {
  res.status(201).json({
    data: await req.tenantDb((c) => service.addWatcher(c, ctxOf(req), req.params.id, req.body.user_id)),
  });
});

const removeWatcher = asyncHandler(async (req, res) => {
  await req.tenantDb((c) => service.removeWatcher(c, ctxOf(req), req.params.id, req.params.userId));
  res.status(204).end();
});

/* ════════════════════════════ CALENDAR EVENTS ═══════════════════════════ */

const listEvents = asyncHandler(async (req, res) => {
  const q = req.query;
  // A window with no bounds would be the whole history of the tenant, so an
  // unbounded request defaults to the current month rather than refusing: the
  // calendar grid always asks for a month anyway, and a default beats a 422
  // the user cannot act on.
  const from = q.from || startOfMonthUtc();
  const to = q.to || endOfMonthUtc();
  res.json({ data: await req.tenantDb((c) => service.listEvents(c, ctxOf(req), { ...q, from, to })) });
});

const getEvent = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.getEvent(c, ctxOf(req), req.params.id)) });
});

const createEvent = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await req.tenantDb((c) => service.createEvent(c, ctxOf(req), req.body)) });
});

const updateEvent = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.updateEvent(c, ctxOf(req), req.params.id, req.body)) });
});

const deleteEvent = asyncHandler(async (req, res) => {
  await req.tenantDb((c) => service.deleteEvent(c, ctxOf(req), req.params.id));
  res.status(204).end();
});

/* ── participants ───────────────────────────────────────────────────────── */

const addParticipant = asyncHandler(async (req, res) => {
  res.status(201).json({
    data: await req.tenantDb((c) => service.addParticipant(c, ctxOf(req), req.params.id, req.body)),
  });
});

const respondParticipant = asyncHandler(async (req, res) => {
  res.json({
    data: await req.tenantDb((c) =>
      service.respondParticipant(c, ctxOf(req), req.params.id, req.params.participantId, req.body.status),
    ),
  });
});

const removeParticipant = asyncHandler(async (req, res) => {
  await req.tenantDb((c) => service.removeParticipant(c, ctxOf(req), req.params.id, req.params.participantId));
  res.status(204).end();
});

/* ══════════════════════════════ WINDOW DEFAULTS ═══════════════════════════ */

/**
 * "Today" on the tenant's clock, as a UTC window.
 *
 * Computed from the tenant timezone rather than the server's, for the reason
 * spelled out in workspace.time.js: a UTC day and a Douala day are not the
 * same 24 hours, and getting this wrong shows yesterday's events at 23:00.
 */
async function startOfToday(client) {
  const { timezoneOf, toInstant } = require("./workspace.time");
  const tz = await timezoneOf(client);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()); // en-CA renders YYYY-MM-DD
  return toInstant(`${parts}T00:00`, { timeZone: tz });
}

async function endOfToday(client) {
  const { timezoneOf, toInstant } = require("./workspace.time");
  const tz = await timezoneOf(client);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
  return toInstant(`${parts}T23:59:59`, { timeZone: tz });
}

/** Current calendar month in UTC — a bound, not a statement about the user. */
function startOfMonthUtc() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString();
}

function endOfMonthUtc() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString();
}

module.exports = {
  listTasks, getBoard, getDay, getDeadlines, getTask, createTask, updateTask, changeStatus, deleteTask,
  addSubtask, patchSubtask, deleteSubtask, addWatcher, removeWatcher,
  listEvents, getEvent, createEvent, updateEvent, deleteEvent,
  addParticipant, respondParticipant, removeParticipant,
};
