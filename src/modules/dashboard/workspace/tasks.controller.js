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
      sort: q.sort,
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
    service.getBoard(c, ctxOf(req), {
      audience: req.query.audience,
      assigned_to: req.query.assigned_to,
      dossier_id: req.query.dossier_id,
      // The same free-text search the list answers (title, notes, file
      // reference, client, step titles), so the Tasks page's one search box
      // narrows whichever view is showing.
      q: req.query.q,
    }),
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

/**
 * One task.
 *
 * The audience travels on the query string (B-03): the board can show a
 * manager a Team card, and a detail read that defaulted to "mine" answered
 * NOT FOUND for a card the same server had just rendered. `ctxOf` already
 * picks `req.query.audience` up, and the service narrows it against the
 * caller's real grants — the parameter asks, it never authorises.
 */
const getTask = asyncHandler(async (req, res) => {
  res.json({
    data: await req.tenantDb((c) => service.getTask(c, ctxOf(req), req.params.id, req.query.audience)),
  });
});

/**
 * Deadlines (task + subtask due dates) in a window — the calendar's overlay.
 *
 * Defaults an unbounded request to the current month, the same way `listEvents`
 * does, so the grid can ask without computing a fallback the server already
 * owns.
 */
const getDeadlines = asyncHandler(async (req, res) => {
  let { from, to } = req.query;
  if (!from || !to) {
    const defaults = await req.tenantDb((c) => tenantMonthWindow(c));
    from ||= defaults.from;
    to ||= defaults.to;
  }
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

/**
 * THE status path. Board drag, Move menu, keyboard drop, the detail panel's
 * select and the edit dialog all arrive here — the dialog by way of
 * `service.updateTask`, which splits a status out of a PATCH and replays it
 * through the same transition (B-04). One event, one audit row, one
 * completion-timestamp rule, one notification.
 */
const changeStatus = asyncHandler(async (req, res) => {
  res.json({
    data: await req.tenantDb((c) =>
      service.changeStatus(c, ctxOf(req), req.params.id, req.body.status, req.body.audience),
    ),
  });
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

/* ── children ───────────────────────────────────────────────────────────── */

const addChildTask = asyncHandler(async (req, res) => {
  res.status(201).json({
    data: await req.tenantDb((c) =>
      service.addChildTask(c, ctxOf(req), req.params.id, req.body, req.query.audience),
    ),
  });
});

/* ── dependencies ───────────────────────────────────────────────────────── */
//
// Every one of these answers with the WHOLE refreshed task rather than the
// edge it touched. A dependency changes `is_blocked`, `blocking_count` and the
// list the panel draws, so returning the edge alone would force the client to
// refetch anyway — and a client that forgot would render a task that says it
// is blocked beside a list with nothing in it.

const addDependency = asyncHandler(async (req, res) => {
  res.status(201).json({
    data: await req.tenantDb((c) =>
      service.addDependency(c, ctxOf(req), req.params.id, req.body, req.query.audience),
    ),
  });
});

const removeDependency = asyncHandler(async (req, res) => {
  res.json({
    data: await req.tenantDb((c) =>
      service.removeDependency(c, ctxOf(req), req.params.id, req.params.dependencyId, req.query.audience),
    ),
  });
});

const overrideDependency = asyncHandler(async (req, res) => {
  res.json({
    data: await req.tenantDb((c) =>
      service.setDependencyOverride(
        c, ctxOf(req), req.params.id, req.params.dependencyId, req.body, req.query.audience,
      ),
    ),
  });
});

/* ── watchers and pings ─────────────────────────────────────────────────── */

const addWatcher = asyncHandler(async (req, res) => {
  res.status(201).json({
    data: await req.tenantDb((c) =>
      service.addWatcher(c, ctxOf(req), req.params.id, req.body.user_id, req.query.audience),
    ),
  });
});

const removeWatcher = asyncHandler(async (req, res) => {
  await req.tenantDb((c) =>
    service.removeWatcher(c, ctxOf(req), req.params.id, req.params.userId, req.query.audience),
  );
  res.status(204).end();
});

const pingTask = asyncHandler(async (req, res) => {
  res.json({
    data: await req.tenantDb((c) =>
      service.pingTask(c, ctxOf(req), req.params.id, req.body, req.query.audience),
    ),
  });
});

/* ── blockages (13975) ────────────────────────────────────────────────────── */

/**
 * Register an external hold on the task. 201, like every other "a row now
 * exists" write; the response carries the shaped blockage plus who was told,
 * so the panel can confirm the fan-out in the same breath as the raise.
 */
const raiseBlockage = asyncHandler(async (req, res) => {
  res.status(201).json({
    data: await req.tenantDb((c) =>
      service.raiseBlockage(c, ctxOf(req), req.params.id, req.body, req.query.audience),
    ),
  });
});

/** Clear the hold — and, on an open task, move its due date by the blocked
 *  duration. The response says where the deadline landed, because that is the
 *  first question everybody asks. */
const resolveBlockage = asyncHandler(async (req, res) => {
  res.json({
    data: await req.tenantDb((c) =>
      service.resolveBlockage(c, ctxOf(req), req.params.id, req.params.blockageId, req.body, req.query.audience),
    ),
  });
});

/* ── analytics ──────────────────────────────────────────────────────────── */

/**
 * The whole operational dashboard in one authorised read.
 *
 * One request rather than six, because the panels must describe the same
 * population at the same instant — see the service's header. The audience the
 * server actually honoured rides in the body beside the figures, so the screen
 * can say whose work it is showing rather than echoing what was asked for.
 */
const getAnalytics = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((c) => service.analytics(c, ctxOf(req), req.query)) });
});

/* ════════════════════════════ CALENDAR EVENTS ═══════════════════════════ */

const listEvents = asyncHandler(async (req, res) => {
  const q = req.query;
  // A window with no bounds would be the whole history of the tenant, so an
  // unbounded request defaults to the current month rather than refusing: the
  // calendar grid always asks for a month anyway, and a default beats a 422
  // the user cannot act on.
  let { from, to } = q;
  if (!from || !to) {
    const defaults = await req.tenantDb((c) => tenantMonthWindow(c));
    from ||= defaults.from;
    to ||= defaults.to;
  }
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
async function tenantTodayParts(client) {
  const { timezoneOf } = require("./workspace.time");
  const tz = await timezoneOf(client);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return { tz, parts };
}

async function startOfToday(client) {
  const { toInstant } = require("./workspace.time");
  const { tz, parts } = await tenantTodayParts(client);
  return toInstant(`${parts}T00:00`, { timeZone: tz });
}

async function endOfToday(client) {
  const { toInstant } = require("./workspace.time");
  const { tz, parts } = await tenantTodayParts(client);
  // All Workspace windows are half-open. The end is the first instant of the
  // following tenant-local day, not 23:59:59, so fractional-second records do
  // not fall through the boundary.
  const [year, month, day] = parts.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextParts = next.toISOString().slice(0, 10);
  return toInstant(`${nextParts}T00:00`, { timeZone: tz });
}

/** The default Calendar window is the current month on the tenant clock. */
async function tenantMonthWindow(client) {
  const { toInstant } = require("./workspace.time");
  const { tz, parts } = await tenantTodayParts(client);
  const [year, month] = parts.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const first = `${year}-${pad(month)}-01T00:00`;
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return {
    from: toInstant(first, { timeZone: tz }),
    to: toInstant(`${next}T00:00`, { timeZone: tz }),
  };
}

module.exports = {
  listTasks, getBoard, getDay, getDeadlines, getTask, createTask, updateTask, changeStatus, deleteTask,
  addSubtask, patchSubtask, deleteSubtask, addWatcher, removeWatcher,
  addChildTask, addDependency, removeDependency, overrideDependency, pingTask,
  raiseBlockage, resolveBlockage, getAnalytics,
  listEvents, getEvent, createEvent, updateEvent, deleteEvent,
  addParticipant, respondParticipant, removeParticipant,
};
