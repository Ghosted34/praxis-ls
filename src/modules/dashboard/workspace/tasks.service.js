"use strict";
/**
 * My Workspace — the rules for tasks and calendar events (MOD-00A).
 *
 * ── THE ONE IDEA ───────────────────────────────────────────────────────────
 *
 * A task is a POINTER to work, not a note about it. `link_url` is derived on
 * every read from `entity_type` + `entity_id` by the shared entity-route map,
 * and it is never stored. Storing it would freeze today's routes into
 * yesterday's rows: a route that moves would leave a thousand tasks pointing at
 * the old path, and the failure is silent because the SPA catches the unknown
 * path and lands on the dashboard. Deriving it means a route added next year
 * becomes reachable from tasks written today, with no backfill.
 *
 * The same map is what notifications use, so the bell and the task panel open
 * the same screen. One map, two readers — that is the whole reason it lives in
 * packages/shared and not here.
 *
 * ── AUDIENCE ───────────────────────────────────────────────────────────────
 *
 * "Only certain roles see everyone else's" is NOT a new mechanism. It is
 * `req.permission_scope` / `req.scope_ids`, already set by
 * middleware/rbac.js from the caller's grants and their organigramme closure:
 * a caller with no scope rows is "all", a caller with them is "scoped". The
 * service reads that and never invents its own rule, because a second copy of
 * an authorisation rule is a second place to get it wrong.
 */

const { AppError } = require("../../../utils/errors");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { entityRoute } = require("@praxis/shared");
const { atomically } = require("../../../shared/db/tx");
const repo = require("./tasks.repo");
const events = require("./workspace.events");
const { timezoneOf, toInstant } = require("./workspace.time");
const recurrence = require("./recurrence");
const { logger } = require("../../../config/logger");

const VALID_STATUSES = ["TO_DO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"];
const DONE_STATUSES = new Set(["DONE", "CANCELLED"]);

/**
 * Turn the caller's repeat rule into the stored canonical form.
 *
 * `undefined` means "not in this PATCH" and must not touch the column; `null`
 * means "stop repeating" and clears it. Anything else goes through the parser,
 * which REJECTS rules this product does not implement — a 422 naming the field
 * rather than a silently half-applied RRULE (recurrence.js header).
 */
function ruleOrThrow(input) {
  if (input.recurrence_rule === undefined) return undefined;
  if (input.recurrence_rule === null) return null;
  try {
    return recurrence.canonicalise(input.recurrence_rule);
  } catch (err) {
    throw new AppError("INVALID_VALUE", `Repeat rule: ${err.message}`, 422, {
      recurrence_rule: [err.message],
    });
  }
}

/**
 * A repeat needs something to repeat FROM.
 *
 * ── WHY THIS IS A REFUSAL AND NOT A DEFAULT ────────────────────────────────
 *
 * `recurrence.js` computes each next occurrence from the current one's due
 * date. A rule with no due date therefore has no cursor: the sweep has nothing
 * to advance, the series never spawns, and the user is left with a task that
 * says "Repeats weekly" on its face and has never once repeated. That failure
 * is silent and it is discovered weeks later, by its absence.
 *
 * Defaulting the anchor to "now" would be worse, not better — it invents a
 * schedule the user did not choose and then honours it. So the rule is
 * refused, at the field, with the sentence that says what to do about it.
 */
function assertRecurrenceAnchored(rule, dueAt) {
  if (!rule) return;
  if (dueAt) return;
  throw new AppError(
    "INVALID_VALUE",
    "A repeating task needs a due date to repeat from. Set one, or turn the repeat off.",
    422,
    { due_at: ["a recurring task must have a due date"] },
  );
}

/**
 * Actor attribution for an audit row, from the caller we already hold.
 *
 * `audit()` snapshots `actor_name_snapshot` from what it is GIVEN and stores
 * NULL otherwise (shared/events/emit.js) — and a null name renders as a raw
 * UUID in the tenant-wide Audit Terminal, which is the "actors show as
 * identifiers" report. `req.user` already carries the name and email, so
 * stamping them here needs no extra query and makes a task/event row read as a
 * person rather than an id.
 */
const actorOf = (ctx) => ({
  actorUserId: ctx.user.user_id,
  actorName: ctx.user.display_name || ctx.user.email || null,
  actorEmail: ctx.user.email || null,
});

/* ── audience ─────────────────────────────────────────────────────────────── */

/**
 * Which audiences this caller may actually ask for.
 *
 * Returned to the client as well as used here, so the switch renders only the
 * options that would work. Offering "Everyone" to somebody the server would
 * quietly narrow to "mine" is a lie with a control on it.
 */
function audiencesFor(ctx) {
  const list = ["mine"];
  if (ctx.scope_ids && ctx.scope_ids.length) list.push("team");
  if (ctx.permission_scope === "all") list.push("all");
  return list;
}

/**
 * Resolve the requested audience down to one this caller is allowed.
 *
 * NARROWS rather than 403s. A user whose grants changed mid-session, or a
 * bookmarked URL carrying `?audience=all`, should see their own work — not an
 * error page. Over-reach is refused silently here because the alternative
 * (leaking) is the actual harm, and the refused user still gets a correct,
 * useful answer. The client only ever offers what `audiencesFor` returned.
 */
function resolveAudience(ctx, requested) {
  const allowed = audiencesFor(ctx);
  return allowed.includes(requested) ? requested : "mine";
}

/** The visibility bundle the repo filters on. */
function visibilityOf(ctx, audience) {
  return {
    audience,
    userId: ctx.user.user_id,
    scopeIds: ctx.scope_ids || null,
    // Personal tasks are hidden from everyone but their creator (and their
    // assignee) unless the caller is looking at the whole tenant as an
    // administrator — and even then, `is_personal` means what it says.
    personalOnly: true,
  };
}

/* ── derivation ───────────────────────────────────────────────────────────── */

/**
 * The screen a task's record lives on, or null.
 *
 * Never throws: an `entity_type` nobody has mapped yet is a normal state (the
 * map grows), and a task must still render — it simply has no link. That is
 * the honest version of the alternative, which is a task that errors.
 */
function deriveLink(row) {
  if (!row || !row.entity_type || !row.entity_id) return null;
  try {
    // The shared map speaks `type:id` refs, which is also the shape stamped on
    // the notification — so the bell and this panel cannot disagree.
    return entityRoute.urlFor(`${row.entity_type}:${row.entity_id}`) || null;
  } catch (err) {
    logger.debug({ err, entity_type: row.entity_type }, "no route for task entity");
    return null;
  }
}

/** Human name for the record a task points at, for "Open …" buttons. */
function entityLabel(entityType) {
  if (!entityType) return null;
  return String(entityType)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const withLink = (row) => {
  if (!row) return row;
  const link_url = deriveLink(row);
  return {
    ...row,
    link_url,
    entity_label: row.entity_type ? entityLabel(row.entity_type) : null,
    has_link: Boolean(link_url),
    // The stage SET (13950), beside 13920's single column. Derived from the
    // aggregate the repo reads so the ids and the labels cannot disagree;
    // events carry no set and keep no field.
    ...(Array.isArray(row.milestones)
      ? { milestone_instance_ids: row.milestones.map((m) => m.milestone_instance_id) }
      : {}),
  };
};

/**
 * The stage set a write names, in the vocabulary it used.
 *
 * `milestone_instance_ids` is the set (13950); `milestone_instance_id` is
 * 13920's single stage, still accepted so an older client or an AI caller
 * that learned the column keeps working — null there means "no stage", the
 * same as an empty list here. `undefined` means the caller said nothing.
 */
function namedStages(input) {
  if ("milestone_instance_ids" in input) {
    return [...new Set((input.milestone_instance_ids || []).filter(Boolean))];
  }
  if ("milestone_instance_id" in input) return input.milestone_instance_id ? [input.milestone_instance_id] : [];
  return undefined;
}

/** The set a row already carries — the aggregate when read, the column when not. */
function stagesOf(before) {
  if (!before) return [];
  if (Array.isArray(before.milestone_instance_ids)) return before.milestone_instance_ids;
  if (Array.isArray(before.milestones)) return before.milestones.map((m) => m.milestone_instance_id);
  return before.milestone_instance_id ? [before.milestone_instance_id] : [];
}

/**
 * Settle the operations-file link a write is asking for (13920).
 *
 * ── THE RULES, AND WHY THE DATABASE ENFORCES NEITHER ───────────────────────
 *
 * A milestone must belong to the file it is filed under, and a milestone with
 * no file at all is meaningless. The first could never have been a CHECK — it
 * reads a second table. The second could have been, and was, until 13920 had
 * to drop it: a constraint added above 13791 to a pre-existing table aborts
 * provisioning a NEW tenant, because 13791's sandbox repair pass reads live's
 * catalogue while sandbox is still behind it. See that migration's header.
 *
 * So both live here, which is where the better error was anyway: a mismatch
 * can name both records in a sentence the user can act on, rather than arrive
 * as a 23514 about a constraint they have never heard of.
 *
 * ── CLEARING THE FILE CLEARS THE STAGE ─────────────────────────────────────
 *
 * A stage is a narrowing of a file, not an alternative to one, so unpicking the
 * file must take the stage with it. Doing that HERE rather than asking the
 * dialog to send both nulls is deliberate: the API has other callers (the AI
 * adapter, a task raised from another screen), and a rule that lives in one
 * form is a rule the next caller breaks. The column pair can then never reach
 * a state the UI has no way to show.
 *
 * Returns the patch to apply. `before` is the row as it stands, so a PATCH that
 * names only the stage is checked against the file the task already has rather
 * than against nothing.
 */
async function resolveFileLink(client, input, before = null) {
  const patch = {};
  const touchesFile = "dossier_id" in input;
  const named = namedStages(input);
  const touchesStage = named !== undefined;
  if (!touchesFile && !touchesStage) return patch;

  const dossierId = touchesFile ? input.dossier_id || null : (before ? before.dossier_id : null) || null;
  let stageIds = touchesStage ? named : stagesOf(before);

  /*
   * The stage follows the file, in BOTH directions the file can move.
   *
   * Unpicking it is the obvious half. The other half is moving a task from one
   * file to another without mentioning the stage: the old stage belongs to the
   * old file, so carrying it forward would either store a stage of a shipment
   * the task is no longer on, or — since the check below would catch it — turn
   * a legitimate "move this to the other file" into a 400 about a milestone
   * the caller never named. Neither is what they asked for, and a stage is a
   * narrowing of a file rather than a thing that survives it, so it goes.
   *
   * A caller that DID name a stage is not second-guessed here: it is checked
   * against the new file below and refused by name if it is another file's.
   */
  const fileChanged = touchesFile && dossierId !== ((before ? before.dossier_id : null) || null);
  const stagesCleared = touchesFile && (!dossierId || (fileChanged && !touchesStage));
  if (stagesCleared) stageIds = [];

  if (stageIds.length) {
    if (!dossierId) {
      throw new AppError(
        "BAD_VALUE",
        "Pick the operations file before its milestone — a milestone belongs to a file.",
        400,
      );
    }
    // One lookup for the whole set (13950). Every stage must exist and must be
    // a stage of THIS file; the first stranger is refused by name.
    const found = await repo.milestoneFilesOf(client, stageIds);
    const byId = new Map(found.map((r) => [r.milestone_instance_id, r]));
    for (const id of stageIds) {
      const stage = byId.get(id);
      if (!stage) throw new AppError("NOT_FOUND", "That milestone no longer exists on this file.", 404);
      if (stage.dossier_id !== dossierId) {
        throw new AppError(
          "BAD_VALUE",
          `“${stage.label}” is a milestone of another operations file. Pick one from the file you linked.`,
          400,
        );
      }
    }
    // Chain order, whatever order the form sent: the projection column below
    // is "the first stage", and first means earliest in the chain.
    stageIds = [...stageIds].sort((a, b) => {
      const sa = Number(byId.get(a).stage_seq);
      const sb = Number(byId.get(b).stage_seq);
      if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
      return String(byId.get(a).label || "").localeCompare(String(byId.get(b).label || ""));
    });
  }

  if (touchesFile) patch.dossier_id = dossierId;
  // Written whenever the caller named the stages, and whenever the file moving
  // under them decided it for them — an omitted column would leave the old
  // stage on the row. Both forms travel together: the set is what
  // `replaceTaskMilestones` stores, the single column is its projection.
  if (touchesStage || stagesCleared) {
    patch.milestone_instance_id = stageIds[0] || null;
    patch.milestone_instance_ids = stageIds;
  }
  return patch;
}

/**
 * Normalise one reminder entry as the client sent it, into the row shape the
 * repo stores. Shared by the task and event writers; the two differ only in
 * which of the anchors (`due_at`, `start_at`) feeds a relative row, which is
 * what `anchor` carries.
 *
 * ── WHY THE RESOLUTION HAPPENS HERE AND NOT IN THE REPO ────────────────────
 *
 * The repo's job is to store rows and the sweep's job is to read them; which
 * of a relative/absolute pair a user asked for, what the tenant clock is,
 * and what happens when a relative reminder has an owner with no date are
 * shaping, not storage. Doing it here keeps one procedure ("what time does
 * this row fire") out of two surfaces, and keeps the sweep's relation pinned
 * on `remind_at <= now()` alone.
 */
function resolveReminderRows({ reminders, anchor, timeZone }) {
  const rows = [];
  (reminders || []).forEach((raw, idx) => {
    const ordinal = idx + 1; // the third slot on a record is the product's cap
    if (ordinal > 3) throw new AppError("BAD_VALUE", "At most three reminders per record.", 400);
    const email = raw && raw.email === true;
    const label = raw && raw.label ? String(raw.label).trim().slice(0, 80) || null : null;
    const scope = raw && raw.scope === "series" ? "series" : "this";
    const minutesRaw = raw && raw.reminder_minutes;
    const hasRelative = minutesRaw !== null && minutesRaw !== undefined;
    const remindAtRaw = raw && raw.remind_at;
    const hasAbsolute = remindAtRaw !== null && remindAtRaw !== undefined && remindAtRaw !== "";
    if (hasRelative && hasAbsolute) {
      throw new AppError("BAD_VALUE", "A reminder is relative OR at a time, never both.", 400);
    }
    if (!hasRelative && !hasAbsolute) {
      throw new AppError("BAD_VALUE", "A reminder needs minutes-before or a time; an empty one is not armed.", 400);
    }
    if (hasRelative) {
      const n = Number(minutesRaw);
      if (!Number.isInteger(n) || n < 0) throw new AppError("BAD_VALUE", "Minutes-before must be a whole number, zero or more.", 400);
      const anchorAt = anchor ? toInstant(anchor, { timeZone, dateOnlyTime: "17:00:00" }) : null;
      if (anchorAt === null) {
        throw new AppError("BAD_VALUE", "The record needs a date for a relative reminder to hang off.", 400);
      }
      rows.push({ reminderMinutes: n, remindAt: null, ordinal, label, email, scope });
    } else {
      const remindAt = toInstant(remindAtRaw, { timeZone, dateOnlyTime: "09:00:00" });
      if (remindAt === null) {
        throw new AppError("BAD_VALUE", "The reminder's exact time is not a readable moment.", 400);
      }
      rows.push({ reminderMinutes: null, remindAt, ordinal, label, email, scope });
    }
  });
  return rows;
}

/**
 * Backward-compat single-reminder shaper: a client that still speaks the
 * 13810 vocabulary (`reminder_minutes` alone, or `remind_at` with no list)
 * produces one row, same conversion, same slot.
 */
function legacyReminderRow({ reminder_minutes, remind_at, timeZone, anchor }) {
  if (remind_at !== undefined && remind_at !== null && remind_at !== "") {
    const remindAt = toInstant(remind_at, { timeZone, dateOnlyTime: "09:00:00" });
    if (remindAt === null) throw new AppError("BAD_VALUE", "The reminder's exact time is not a readable moment.", 400);
    return [{ reminderMinutes: null, remindAt, ordinal: 1, label: null, email: false, scope: "this" }];
  }
  if (reminder_minutes === null || reminder_minutes === undefined) return [];
  const n = Number(reminder_minutes);
  if (!Number.isInteger(n) || n < 0) throw new AppError("BAD_VALUE", "Minutes-before must be a whole number, zero or more.", 400);
  const anchorAt = anchor ? toInstant(anchor, { timeZone, dateOnlyTime: "17:00:00" }) : null;
  if (anchorAt === null) {
    throw new AppError("BAD_VALUE", "The record needs a date for a relative reminder to hang off.", 400);
  }
  return [{ reminderMinutes: n, remindAt: null, ordinal: 1, label: null, email: false, scope: "this" }];
}

/**
 * Write the reminders for one record — replacing the previous set, so an
 * update that re-specifies rows never adds a duplicate of a now-replaced
 * slot's entry. Runs alongside the parent-row mutation on the caller's
 * connection, inside the same transaction when there is one.
 *
 * ── WHICH SET, LEGACY OR LIST ───────────────────────────────────────────────
 *
 * A caller may present either the shape `reminders: [ ... ]` (PR 3's several
 * reminder rows) or the 13810 `reminder_minutes`/`remind_at` pair; both are
 * still accepted, and the pair is the one the older client speaks. The list
 * is the newer vocabulary and supersedes: if a client sends both, the list is
 * authoritative (it is the full set, the pair is one slot of it) — the pair
 * only wins when NO list is sent, so a caller editing one reminder cannot
 * silently drop the other two because their form happened to declare a
 * `reminder_minutes` field they meant to leave alone.
 */
async function writeReminders(client, { ownerType, ownerId, input, anchor, timeZone, actor }) {
  let rows;
  if (Array.isArray(input && input.reminders) && (input.reminders.length || "reminders" in (input || {}))) {
    rows = resolveReminderRows({ reminders: input.reminders, anchor, timeZone });
  } else {
    rows = legacyReminderRow({
      reminder_minutes: input ? input.reminder_minutes : undefined,
      remind_at: input ? input.remind_at : undefined,
      timeZone,
      anchor,
    });
  }
  if (!rows.length) {
    // An explicit "none" — a caller that names reminders: [] clears the set,
    // which is what an update that removes the last reminder must be able to
    // do. A caller that sends NO reminder keys says nothing and the lines
    // below are not reached.
    await repo.replaceReminders(client, { ownerType, ownerId, rows: [], actor });
    await repo.syncParentReminderColumns(client, ownerType, ownerId);
    return { changed: true, cleared: true, rows };
  }
  await repo.replaceReminders(client, { ownerType, ownerId, rows, actor });
  await repo.syncParentReminderColumns(client, ownerType, ownerId);
  return { changed: true, cleared: false, rows };
}

/* ══════════════════════════════════ TASKS ════════════════════════════════ */

/**
 * May this caller see this specific task?
 *
 * Mirrors the list predicate for the single-record path, because a list filter
 * and a get-by-id that disagree is the classic way a detail view leaks a row
 * the list correctly hid.
 */
function canSeeTask(task, ctx, audience) {
  if (!task) return false;
  const me = ctx.user.user_id;
  if (task.assigned_to === me || task.created_by === me) return true;
  // A personal task belongs to its creator alone, whatever else is true.
  if (task.is_personal && task.created_by !== me) return false;
  if (audience === "mine") return false;
  if (audience === "team") {
    const scopes = ctx.scope_ids || [];
    return !task.scope_id || scopes.includes(task.scope_id);
  }
  return true; // "all"
}

/** Does the caller have a visible relationship with this event? */
function canSeeEvent(event, ctx, audience, participants = []) {
  if (!event || !ctx || !ctx.user) return false;
  const me = ctx.user.user_id;
  if (event.created_by === me || participants.some((p) => p.user_id === me)) return true;
  if (audience === "all" && ctx.permission_scope === "all") return true;
  if (audience === "team" && ctx.scope_ids && ctx.scope_ids.length) {
    return !event.scope_id || ctx.scope_ids.includes(event.scope_id);
  }
  return false;
}

/** Event writes belong to the creator/organiser or an explicit tenant-wide manager. */
function canManageEvent(event, ctx, participants = []) {
  if (!event || !ctx || !ctx.user) return false;
  if (ctx.permission_scope === "all") return true;
  const me = ctx.user.user_id;
  return event.created_by === me || participants.some((p) => p.user_id === me && p.is_organiser === true);
}

function assertEventScope(ctx, scopeId) {
  if (!scopeId || ctx.permission_scope === "all") return;
  if (!ctx.scope_ids || !ctx.scope_ids.includes(scopeId)) {
    throw new AppError("SCOPE_FORBIDDEN", "You cannot place this event in that scope", 403);
  }
}

const eventVisibilityOf = (ctx, audience) => ({
  audience,
  userId: ctx.user.user_id,
  scopeIds: ctx.scope_ids || null,
  permissionScope: ctx.permission_scope || "scoped",
});

/**
 * Query windows are user-facing wall-clock values just like write fields. A
 * caller may send a bare date or `YYYY-MM-DDTHH:mm`; resolve it on the tenant
 * clock before PostgreSQL compares it with timestamptz columns. Offset-bearing
 * values remain the instant the caller supplied.
 */
async function resolveWindow(client, { from, to }) {
  const timeZone = await timezoneOf(client);
  return {
    from: toInstant(from, { timeZone, dateOnlyTime: "00:00:00" }) || from,
    to: toInstant(to, { timeZone, dateOnlyTime: "00:00:00" }) || to,
    timeZone,
  };
}

async function listTasks(client, ctx, q = {}) {
  const audience = resolveAudience(ctx, q.audience);
  const { rows, total } = await repo.listTasks(client, {
    ...visibilityOf(ctx, audience),
    status: q.status,
    // The validator accepted `priority` from day one but the service dropped it,
    // so the list could not actually be filtered by urgency — the column read as
    // a filter and filtered nothing. Honour it.
    priority: q.priority,
    assignedTo: q.assigned_to === "me" ? ctx.user.user_id : q.assigned_to,
    // 13920: the file's own Tasks tab reads the list through these, so the tab
    // and the Analytics rollup count one population rather than two.
    dossierId: q.dossier_id,
    milestoneInstanceId: q.milestone_instance_id,
    q: q.q,
    sort: q.sort,
    limit: q.limit,
    offset: q.offset,
  });
  const [blockedRows, childRows, blockageRows] = await Promise.all([
    repo.blockedCountsFor(client, rows.map((r) => r.task_id)),
    repo.childCountsFor(client, rows.map((r) => r.task_id)),
    repo.activeBlockagesFor(client, rows.map((r) => r.task_id)),
  ]);
  return { rows: rows.map(decorator(blockedRows, childRows, blockageRows)), total, audience, audiences: audiencesFor(ctx) };
}

/**
 * The kanban board, and an honest statement about how much of it this is.
 *
 * The board endpoint is capped (200 open rows) and always has been. What it did
 * not do was SAY so: four columns of the first two hundred cards look exactly
 * like four columns of everything, and the user concludes they have seen their
 * team's work. `total`/`shown`/`truncated` come from the same query as the rows
 * (a window function, not a second count), and the page turns them into "showing
 * 200 of 612 — open the List view" rather than leaving the gap invisible.
 *
 * Blocked and child counts are batched over the rendered ids, so a board of 200
 * cards costs two extra queries rather than four hundred.
 */
async function getBoard(client, ctx, q = {}) {
  const audience = resolveAudience(ctx, q.audience);
  const { board, total, shown, limit, truncated } = await repo.boardTasks(client, {
    ...visibilityOf(ctx, audience),
    assignedTo: q.assigned_to === "me" ? ctx.user.user_id : q.assigned_to,
    dossierId: q.dossier_id,
    q: q.q,
  });
  const ids = Object.values(board).flat().map((t) => t.task_id);
  const [blockedRows, childRows, blockageRows] = await Promise.all([
    repo.blockedCountsFor(client, ids),
    repo.childCountsFor(client, ids),
    repo.activeBlockagesFor(client, ids),
  ]);
  const decorate = decorator(blockedRows, childRows, blockageRows);
  for (const k of Object.keys(board)) board[k] = board[k].map(decorate);
  return {
    board,
    audience,
    audiences: audiencesFor(ctx),
    // The board's own completeness, named rather than implied.
    completeness: { total, shown, limit, truncated },
  };
}

/**
 * Stamp blocked/child metadata onto list and board cards.
 *
 * Built once from three batched reads rather than queried per card: the
 * alternative is the N+1 that turns a 200-card board into 601 round trips, and
 * it is invisible in development where a board holds four cards.
 *
 * "Blocked" here answers ONE question from two sources (13975): an unresolved
 * dependency edge OR a live blockage row. A card that said unblocked while a
 * customs hold sat on the task would be the exact lie the Blocked-work panel
 * exists to prevent, so both feed `is_blocked`, and the card carries the hold's
 * note as its snippet — the sentence a reader needs before opening the panel.
 */
function decorator(blockedRows = [], childRows = [], blockageRows = []) {
  const blocked = new Map(blockedRows.map((r) => [r.task_id, r]));
  const kids = new Map(childRows.map((r) => [r.parent_task_id, r]));
  const holds = new Map(blockageRows.map((r) => [r.task_id, r]));
  return (row) => {
    const b = blocked.get(row.task_id);
    const c = kids.get(row.task_id);
    const h = holds.get(row.task_id);
    const card = withLink(row);
    return {
      ...card,
      blocking_count: b ? b.blocking_count : 0,
      blockage: h ? shapeBlockage(h) : null,
      is_blocked: (Boolean(b) || Boolean(h)) && !DONE_STATUSES.has(row.status),
      blocked_since: olderOf(b ? b.blocked_since : null, h ? h.raised_at : null),
      child_count: c ? c.child_count : 0,
      child_done_count: c ? c.child_done_count : 0,
    };
  };
}

/** The earlier of two hold stamps, either possibly absent. */
function olderOf(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) <= new Date(b) ? a : b;
}

/**
 * A blockage row as the client renders it — one shape for the card snippet,
 * the panel's collapsible and the raised/resolved responses, so no screen can
 * drift from the others about what a hold carries.
 */
function shapeBlockage(r) {
  if (!r) return null;
  return {
    task_blockage_id: r.task_blockage_id,
    task_id: r.task_id,
    note: r.note,
    estimated_resolve_at: r.estimated_resolve_at || null,
    raised_by: r.raised_by || null,
    raised_by_name: r.raised_by_name || null,
    raised_at: r.raised_at,
    resolved_at: r.resolved_at || null,
    resolved_by_name: r.resolved_by_name || null,
    resolve_note: r.resolve_note || null,
    due_shift: r.due_shift || null,
  };
}

/**
 * One task, in full.
 *
 * ── THE AUDIENCE TRAVELS (B-03) ────────────────────────────────────────────
 *
 * `audience` is a parameter and not an assumption. The board can legitimately
 * show a caller a Team or All card, and a detail read that quietly defaulted to
 * "mine" answered NOT FOUND for a card the same server had just rendered — the
 * defect the guide records as B-03. So every caller passes the EFFECTIVE
 * audience through, and `resolveAudience` narrows it against the caller's real
 * grants before `canSeeTask` uses it. The query parameter is never authority;
 * it is a request that the server re-decides.
 */
async function getTask(client, ctx, id, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  const task = await repo.findTask(client, id);
  // Same answer for "missing" and "not yours". Distinguishing them tells a
  // caller which ids exist, which is information they did not ask for.
  if (!task || !canSeeTask(task, ctx, resolved)) {
    throw new AppError("NOT_FOUND", "Task not found", 404);
  }
  const [subtasks, watchers, dependencyRows, children, parent, reminders, activeBlockage, blockageHistory] = await Promise.all([
    repo.listSubtasks(client, id),
    repo.listWatchers(client, id),
    repo.listDependencies(client, id),
    // Only a parent can have children, and asking for the children of a child
    // is a guaranteed-empty query on every child task read.
    task.parent_task_id ? Promise.resolve([]) : repo.listChildTasks(client, id),
    task.parent_task_id ? repo.findTask(client, task.parent_task_id) : Promise.resolve(null),
    repo.listReminders(client, "task", id),
    // 13975: the live hold (the panel's collapsible header and Resolve button)
    // and the resolved ones (its history) in the same round trip as everything
    // else the panel draws — a task panel is one request or it is a spinner.
    repo.activeBlockageFor(client, id),
    repo.listBlockages(client, id),
  ]);

  const dependencies = dependencyRows.map((row) =>
    redactDependency(
      row,
      canSeeTask(
        {
          task_id: row.depends_on_task_id,
          assigned_to: row.depends_on_assigned_to,
          created_by: row.depends_on_created_by,
          is_personal: row.depends_on_is_personal,
          scope_id: row.depends_on_scope_id,
        },
        ctx,
        resolved,
      ),
    ),
  );
  // Counted over the RAW edges: work blocked by something the reader cannot
  // see is still blocked, and a count that dropped hidden edges would tell a
  // manager their task is ready when it is not.
  const blocking = blockingCount(dependencyRows);
  const blockedByHold = Boolean(activeBlockage);

  return {
    ...withLink(task),
    subtasks,
    watchers,
    dependencies,
    reminders,
    blocking_count: blocking,
    blockage: shapeBlockage(activeBlockage),
    // Newest first, live hold included: the panel renders this as the
    // collapsible's history, and a resolved hold is the evidence behind "late
    // because of X" — hiding it would hide the reason a due date moved.
    blockages: blockageHistory.map(shapeBlockage),
    is_blocked: (blocking > 0 || blockedByHold) && !DONE_STATUSES.has(task.status),
    // The roll-up counts EVERY child (an honest denominator) while the rendered
    // list carries only the ones this caller may open — see `listChildTasks`.
    children: children.filter((c) => canSeeTask(c, ctx, resolved)).map(withLink),
    hidden_child_count: children.filter((c) => !canSeeTask(c, ctx, resolved)).length,
    rollup: childRollup(children, subtasks),
    parent:
      parent && canSeeTask(parent, ctx, resolved)
        ? { task_id: parent.task_id, title: parent.title, status: parent.status, link_url: entityRouteFor(parent.task_id) }
        : parent
          ? { task_id: null, title: "A task you cannot view", status: null, link_url: null }
          : null,
  };
}

async function createTask(client, ctx, input) {
  const timeZone = await timezoneOf(client);
  assertRecurrenceAnchored(input.recurrence_rule, input.due_at);
  // A task due "15/09" is wanted by the end of the working day, not at
  // midnight: 00:00 would make it overdue the moment it is written and sort it
  // above everything else on the day it was created.
  const due_at = toInstant(input.due_at, { timeZone, dateOnlyTime: "17:00:00" });
  const rule = ruleOrThrow(input);
  // 13920: a stage must belong to the file it is filed under, and an unpicked
  // file takes its stage with it. Settled BEFORE the insert so a mismatch is a
  // 400 naming both records rather than a row the panel cannot render.
  const link = await resolveFileLink(client, input);
  // ── ONE TRANSACTION FROM THE INSERT TO THE AUDIT ROW ─────────────────────
  //
  // `req.tenantDb` pins a connection; it does not open a transaction. So when
  // a statement AFTER the insert failed — the reminder projection did, on
  // every dialog save, for as long as its placeholders were misnumbered — the
  // task was already committed and the caller was told 500: the board showed
  // a card the form said it had failed to create, and a retry made a second
  // one. Reminders, subtasks, the event and the audit line now land with the
  // row or not at all. `atomically` joins a caller's open transaction rather
  // than nesting one (shared/db/tx.js), so the AI write path and the HTTP path
  // behave the same.
  const task = await atomically(client, async () => {
    const row = await repo.insertTask(client, {
      ...input,
      ...link,
      due_at,
      created_by: ctx.user.user_id,
      recurrence_rule: rule,
    });
    // The stage set lands with the row (13950); the column the insert wrote
    // is its first member, so the two are never readable apart.
    if (link.milestone_instance_ids && link.milestone_instance_ids.length) {
      await repo.replaceTaskMilestones(client, row.task_id, link.milestone_instance_ids);
    }
    // The series id is the first occurrence's own id: one UPDATE after the INSERT
    // makes the template discoverable by its descendants with no registry table.
    if (rule) await repo.updateTask(client, row.task_id, { recurrence_series_id: row.task_id });
    // Reminders outlive the columns: a create declares them in 13810's pair
    // vocabulary or PR 3's list of up to three, and they land in
    // workspace_reminder on this same transaction so a committed task has its
    // armed rows with it, not eventually.
    if ("reminders" in input || "reminder_minutes" in input || "remind_at" in input) {
      await writeReminders(client, {
        ownerType: "task", ownerId: row.task_id, input, anchor: due_at, timeZone,
        actor: { user_id: ctx.user.user_id },
      });
    }
    if (input.subtasks && input.subtasks.length) {
      for (const [i, s] of input.subtasks.entries()) {
        await repo.insertSubtask(client, {
          task_id: row.task_id,
          title: s.title,
          display_order: s.display_order ?? i + 1,
          // A step's deadline resolves on the tenant clock exactly as the parent's
          // does — a bare date is end of the working day, not midnight.
          due_at: toInstant(s.due_at, { timeZone, dateOnlyTime: "17:00:00" }),
        });
      }
    }
    await emitEvent(client, {
      eventTypeKey: events.TASK_CREATED, moduleKey: events.MODULE,
      entityRef: `task:${row.task_id}`, actorUserId: ctx.user.user_id,
      payload: { status: row.status, priority: row.priority },
    });
    await audit(client, {
      ...actorOf(ctx), action: events.TASK_CREATED, moduleKey: events.MODULE,
      entityRef: `task:${row.task_id}`, after: { title: row.title, status: row.status, priority: row.priority },
    });
    return row;
  });
  const created = await getTask(client, ctx, task.task_id, ctx.audience);
  // Outside the transaction on purpose: a notification is a courtesy about a
  // record that now exists, and it may touch Redis, web-push and SMTP.
  await notifyAssignee(client, created);
  return created;
}

/**
 * Edit a task.
 *
 * ── STATUS IS NOT EDITED HERE, IT IS TRANSITIONED (B-04) ───────────────────
 *
 * The edit form carries a Status field, so a PATCH can legitimately arrive
 * carrying one — and until now that wrote the column directly, producing a
 * `task.updated` audit row where the very same user action from the board
 * produced `task.status_changed`, with a different notification and a
 * different completion-timestamp path. One action, two histories, and an audit
 * trail that cannot answer "when did this task move".
 *
 * So a status in the body is SPLIT OUT and replayed through `changeStatus`
 * after the rest of the edit lands. Every gesture in the product — board drag,
 * Move menu, keyboard drop, the panel's select, this form — now ends in the
 * same function, with the same event, the same audit row, the same
 * `completed_at` rule and the same watcher notification.
 */
async function updateTask(client, ctx, id, input) {
  const before = await getTask(client, ctx, id, ctx.audience);
  const timeZone = await timezoneOf(client);
  const { status: requestedStatus, ...rest } = input;
  input = rest;
  const patch = { ...input };
  assertRecurrenceAnchored(
    "recurrence_rule" in input ? input.recurrence_rule : before.recurrence_rule,
    "due_at" in input ? input.due_at : before.due_at,
  );

  if ("due_at" in input) {
    patch.due_at = toInstant(input.due_at, { timeZone, dateOnlyTime: "17:00:00" });
  }
  const rule = ruleOrThrow(input);
  if (rule !== undefined) patch.recurrence_rule = rule;
  // The link is settled against the row AS IT STANDS, so a PATCH naming only
  // the stage is checked against the file the task already carries (13920).
  Object.assign(patch, await resolveFileLink(client, input, before));

  // Reminder inputs are consumed by writeReminders below, not by
  // updateTask's column allow-list — the parent columns are now a read-only
  // projection of the workspace_reminder rows.
  const reminderTouched = "reminders" in input || "reminder_minutes" in input || "remind_at" in input;
  delete patch.reminders;
  delete patch.reminder_minutes;
  delete patch.remind_at;

  // The same boundary as createTask: the row, its reminder set, the series
  // rewrite, the event and the audit line commit together or not at all.
  // Consumed by replaceTaskMilestones below, not by the column allow-list.
  const stageSet = patch.milestone_instance_ids;
  delete patch.milestone_instance_ids;

  await atomically(client, async () => {
    const row = await repo.updateTask(client, id, patch);
    if (stageSet) await repo.replaceTaskMilestones(client, id, stageSet);
    if (reminderTouched) {
      await writeReminders(client, {
        ownerType: "task", ownerId: id, input,
        anchor: patch.due_at !== undefined ? patch.due_at : before.due_at,
        timeZone, actor: { user_id: ctx.user.user_id },
      });
    } else if ("due_at" in input) {
      // Moving a reminder's anchor re-arms what has fired — the same contract
      // 13810 pinned a single reminder to — applied to the whole armed set, so
      // a rescheduled task does not keep stamps for a date that is no longer
      // the deadline.
      await repo.rearmOwnerReminders(client, "task", id);
    }
    // A "whole series" edit rewrites the FUTURE of the series, not just this row.
    // `due_at` is deliberately not carried: each occurrence owns its date, and
    // stamping every row with one would collapse the series onto a single day.
    // Finished rows are excluded inside the repo, so history is never rewritten.
    if (input.series === "series" && before.recurrence_series_id) {
      const seriesPatch = { ...patch };
      delete seriesPatch.due_at;
      await repo.updateSeriesTasks(client, before.recurrence_series_id, seriesPatch, { exclude: id });
    }
    await emitEvent(client, {
      eventTypeKey: events.TASK_UPDATED, moduleKey: events.MODULE,
      entityRef: `task:${id}`, actorUserId: ctx.user.user_id, payload: { fields: Object.keys(input) },
    });
    await audit(client, {
      ...actorOf(ctx), action: events.TASK_UPDATED, moduleKey: events.MODULE,
      entityRef: `task:${id}`,
      before: { status: before.status, priority: before.priority, due_at: before.due_at },
      after: { status: row.status, priority: row.priority, due_at: row.due_at },
    });
  });
  // Read back AFTER the commit, so the answer carries the reminder projection
  // and the stage set the transaction just wrote, not the row mid-flight.
  let after = await getTask(client, ctx, id, ctx.audience);
  if (input.assigned_to && input.assigned_to !== before.assigned_to) await notifyAssignee(client, after);
  // The one status path. Replayed AFTER the field edits so the transition sees
  // the task as the user left it (a due date moved in the same save is already
  // stored when the completion stamp is written).
  if (requestedStatus && requestedStatus !== before.status) {
    after = await changeStatus(client, ctx, id, requestedStatus, ctx.audience);
  }
  return after;
}

/**
 * Move a task between columns.
 *
 * Its own route rather than a field on PATCH: a status change is the one edit
 * that has consequences beyond the row (completed_at, an event, the assignee's
 * notifications), and giving it a verb keeps that logic in one place instead
 * of scattered across "what changed?" checks.
 */
async function changeStatus(client, ctx, id, status, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  const before = await getTask(client, ctx, id, resolved);
  if (before.status === status) return before;

  // ── THE BLOCKED RULE, ENFORCED ONCE ──────────────────────────────────────
  //
  // Because every gesture now arrives here, this is the only place the rule
  // has to be written: unresolved prerequisites refuse COMPLETION, and nothing
  // else. Starting blocked work is a legitimate thing to do — people begin
  // preparing before the thing they are waiting on lands — so IN_PROGRESS is
  // not policed. Marking it DONE while its precondition has not happened is
  // the "silently mark unresolved work complete" the guide forbids.
  //
  // CANCELLED is allowed through: calling off blocked work is exactly what a
  // person does about a dead end, and refusing it would trap the task.
  if (status === "DONE" && before.is_blocked) {
    // A live hold refuses completion BEFORE the dependency message, because
    // its remedy is one button on the same panel (Resolve) whereas a
    // dependency's is a conversation with whoever owns the prerequisite —
    // naming the wrong remedy sends the reader on the wrong errand.
    if (before.blockage) {
      throw new AppError(
        "INVALID_VALUE",
        `This task has an active blockage: "${before.blockage.note}". Resolve the blockage first — resolving moves the due date by the time you were blocked.`,
        422,
        { status: ["this task has an active blockage"] },
      );
    }
    throw new AppError(
      "INVALID_VALUE",
      before.blocking_count === 1
        ? "This task is still waiting on another task. Finish it, or override the dependency first."
        : `This task is still waiting on ${before.blocking_count} other tasks. Finish them, or override the dependencies first.`,
      422,
      { status: ["this task is blocked by an unresolved dependency"] },
    );
  }

  await repo.updateTask(client, id, { status });
  // A finished task does not owe another alert. Sealed reminders are stamped
  // (not disarmed into silence) so the record of what was armed reflects what
  // happened: DONE ended them. The sweep skips DONE regardless; this just
  // stops a stampless row from being the record's quiet lie.
  if (DONE_STATUSES.has(status)) {
    await repo.settleRemindersForDoneTask(client, id, new Date().toISOString());
  }
  await emitEvent(client, {
    eventTypeKey: events.TASK_STATUS_CHANGED, moduleKey: events.MODULE,
    entityRef: `task:${id}`, actorUserId: ctx.user.user_id,
    payload: { from: before.status, to: status },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_STATUS_CHANGED, moduleKey: events.MODULE,
    entityRef: `task:${id}`, before: { status: before.status }, after: { status },
  });
  const after = await getTask(client, ctx, id, resolved);
  await notifyStatusWatchers(client, ctx, after, after.watchers || [], {
    from: before.status, to: status,
  });
  return after;
}

async function deleteTask(client, ctx, id) {
  const before = await getTask(client, ctx, id, ctx.audience);
  await repo.softDeleteTask(client, id);
  await emitEvent(client, {
    eventTypeKey: events.TASK_DELETED, moduleKey: events.MODULE,
    entityRef: `task:${id}`, actorUserId: ctx.user.user_id,
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_DELETED, moduleKey: events.MODULE,
    entityRef: `task:${id}`, before: { title: before.title }, isSensitive: false,
  });
  return { deleted: true };
}

/* ── subtasks ───────────────────────────────────────────────────────────── */

async function addSubtask(client, ctx, taskId, input) {
  await getTask(client, ctx, taskId); // existence + visibility, one check
  const timeZone = await timezoneOf(client);
  const row = await repo.insertSubtask(client, {
    task_id: taskId,
    title: input.title,
    display_order: input.display_order,
    due_at: toInstant(input.due_at, { timeZone, dateOnlyTime: "17:00:00" }),
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_UPDATED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, after: { subtask: row.title },
  });
  return row;
}

/**
 * Patch a step — tick it done, move its deadline, or both.
 *
 * `due_at` resolves on the tenant clock like every other deadline here; only
 * the keys the caller sent are touched, so setting a date does not un-tick a
 * done step and vice versa.
 */
async function patchSubtask(client, ctx, taskId, subtaskId, input) {
  await getTask(client, ctx, taskId);
  const patch = {};
  if ("is_done" in input) patch.is_done = input.is_done;
  if ("due_at" in input) {
    const timeZone = await timezoneOf(client);
    patch.due_at = toInstant(input.due_at, { timeZone, dateOnlyTime: "17:00:00" });
  }
  const row = await repo.updateSubtask(client, subtaskId, patch);
  if (!row || row.task_id !== taskId) throw new AppError("NOT_FOUND", "Subtask not found", 404);
  return row;
}

async function deleteSubtask(client, ctx, taskId, subtaskId) {
  await getTask(client, ctx, taskId);
  const ok = await repo.deleteSubtask(client, subtaskId);
  if (!ok) throw new AppError("NOT_FOUND", "Subtask not found", 404);
  return { deleted: true };
}


/* ── hierarchy, dependencies, and the blocked rule ──────────────────────── */

/**
 * ONE LEVEL, AND THE SCHEMA ALREADY SAID SO.
 *
 * 13810 gave `task.parent_task_id` a comment declaring the nesting
 * deliberately shallow: a checklist parent with separately-assigned children,
 * and `task_subtask` for the lightweight steps inside either. A tree deeper
 * than two is a project, which is a different product. This function is where
 * that sentence becomes enforceable rather than aspirational — a child may not
 * itself have children, so the roll-up is one query and a reader can hold the
 * whole structure in their head.
 */
function assertParentable(parent) {
  if (parent.parent_task_id) {
    throw new AppError(
      "INVALID_VALUE",
      "That task is already a child task. Work breaks down one level: add this step to its parent, or add a checklist step instead.",
      422,
      { parent_task_id: ["a child task cannot itself have children"] },
    );
  }
}

/**
 * Progress across a parent's children and checklist steps.
 *
 * ── WHY TWO DENOMINATORS AND NOT ONE PERCENTAGE ────────────────────────────
 *
 * A child task and a checklist step are not the same unit of work — one has an
 * owner, a status and a reminder, the other is a line somebody ticks — so
 * averaging them into a single number invents a weighting nobody chose. The
 * roll-up reports both and lets the panel say "2 of 3 child tasks, 4 of 6
 * steps", which is the sentence a manager actually needs.
 *
 * CANCELLED children are counted as SETTLED but not as DONE: work that was
 * called off is no longer outstanding, and leaving it in the denominator means
 * a parent whose last child was cancelled can never read as complete. It is
 * reported separately so "3 of 4, one cancelled" stays honest.
 *
 * Nothing here WRITES. The parent's own status is the parent's own
 * statement — the guide is explicit that a roll-up must not falsify historical
 * status or completion timestamps, so this is a read-side derivation and the
 * parent is never auto-completed behind its owner's back.
 */
function childRollup(children = [], subtasks = []) {
  const child_count = children.length;
  const child_done_count = children.filter((c) => c.status === "DONE").length;
  const child_cancelled_count = children.filter((c) => c.status === "CANCELLED").length;
  const child_open_count = child_count - child_done_count - child_cancelled_count;
  const step_count = subtasks.length;
  const step_done_count = subtasks.filter((s) => s.is_done).length;

  // The denominator excludes cancelled children for the reason above. A parent
  // with no children and no steps has no progress to report — `null` rather
  // than 0, because "0%" reads as "nothing done" and the truth is "nothing to
  // do yet".
  const settled = child_done_count + step_done_count;
  const outstanding = child_open_count + (step_count - step_done_count);
  const denominator = settled + outstanding;
  return {
    child_count,
    child_done_count,
    child_cancelled_count,
    child_open_count,
    step_count,
    step_done_count,
    progress_done: settled,
    progress_total: denominator,
    progress_ratio: denominator > 0 ? Number((settled / denominator).toFixed(4)) : null,
  };
}

/**
 * What a caller may be told about a task they cannot see.
 *
 * The guide's rule is precise and worth restating: a blocked indicator MAY be
 * shown without disclosing an unauthorised dependency's title or owner. So the
 * edge survives — the reader learns their work is waiting, which is true and
 * is the thing they need — and every identifying field is replaced rather than
 * omitted. Replaced, not omitted, because a missing key reads as a bug in the
 * client and an explicit `is_visible: false` reads as a decision.
 *
 * `depends_on_task_id` is withheld too. It is the one field that would let a
 * caller confirm a task exists by trying to open it.
 */
function redactDependency(row, visible) {
  const base = {
    task_dependency_id: row.task_dependency_id,
    task_id: row.task_id,
    is_visible: visible,
    is_overridden: Boolean(row.overridden_at),
    overridden_at: row.overridden_at || null,
    override_reason: visible ? row.override_reason || null : null,
    overridden_by_name: visible ? row.overridden_by_name || null : null,
    created_at: row.created_at,
    // Resolution state is NOT identity. Whether the thing you are waiting for
    // is finished is exactly what "am I blocked" means, so it is safe — and
    // necessary — to answer even when the prerequisite itself is hidden.
    is_resolved: row.depends_on_status === "DONE",
    is_cancelled: row.depends_on_status === "CANCELLED",
  };
  if (!visible) {
    return {
      ...base,
      depends_on_task_id: null,
      depends_on_title: "A task you cannot view",
      depends_on_status: null,
      depends_on_due_at: null,
      depends_on_assigned_to_name: null,
      link_url: null,
    };
  }
  return {
    ...base,
    depends_on_task_id: row.depends_on_task_id,
    depends_on_title: row.depends_on_title,
    depends_on_status: row.depends_on_status,
    depends_on_due_at: row.depends_on_due_at,
    depends_on_assigned_to_name: row.depends_on_assigned_to_name || null,
    link_url: entityRouteFor(row.depends_on_task_id),
  };
}

/** The canonical Workspace link for a task id, through the shared map. */
function entityRouteFor(taskId) {
  if (!taskId) return null;
  try {
    return entityRoute.urlFor(`task:${taskId}`) || null;
  } catch (err) {
    logger.debug({ err, taskId }, "no route for task");
    return null;
  }
}

/**
 * Is this edge still holding the blocked task up?
 *
 * The whole rule, in one place, so the panel, the board badge, the status
 * guard and Analytics cannot answer it three different ways:
 *
 *   DONE          resolved. The precondition happened.
 *   overridden    resolved BY DECISION, and the decision is attributed.
 *   CANCELLED     STILL BLOCKING. Abandoned is not finished — the recorded
 *                 product decision — so it needs an explicit override, which
 *                 is a person saying "proceed anyway" rather than the system
 *                 inferring it.
 *   anything else blocking.
 */
function dependencyBlocks(row) {
  if (!row) return false;
  if (row.overridden_at) return false;
  return row.depends_on_status !== "DONE";
}

/**
 * The dependencies of one task, authorised and shaped for the panel.
 *
 * Visibility is the INTERSECTION the guide specifies: the caller already
 * passed the check for the blocked task (they are holding it), and each
 * prerequisite is re-tested against the same predicate on its own merits.
 * Passing one does not imply passing the other, which is exactly the leak the
 * intersection rule exists to close.
 */
async function dependenciesFor(client, ctx, taskId, audience) {
  const rows = await repo.listDependencies(client, taskId);
  return rows.map((row) => {
    const prerequisite = {
      task_id: row.depends_on_task_id,
      assigned_to: row.depends_on_assigned_to,
      created_by: row.depends_on_created_by,
      is_personal: row.depends_on_is_personal,
      scope_id: row.depends_on_scope_id,
    };
    return redactDependency(row, canSeeTask(prerequisite, ctx, audience));
  });
}

/** How many unresolved prerequisites a task has, ignoring authorisation.
 *
 *  Deliberately counted over the RAW edges rather than the redacted ones: a
 *  task is blocked by work the reader cannot see just as surely as by work
 *  they can, and a count that quietly dropped the hidden edges would tell a
 *  manager their task is ready to start when it is not. */
const blockingCount = (rows = []) => rows.filter((r) => dependencyBlocks(r)).length;

/**
 * Add a blocked-by edge.
 *
 * Four refusals, in the order that gives the clearest message, all BEFORE the
 * insert so a rejected edge never reaches the table:
 *
 *   1. the caller must be able to see BOTH tasks (the intersection rule — you
 *      cannot sequence work you cannot see, and an error that distinguished
 *      "no such task" from "not yours" would be a probe);
 *   2. self-reference (the DB also holds this; saying it here names the field);
 *   3. duplicate (the unique index holds it; this turns a 23505 into English);
 *   4. cycle (the DB deliberately does NOT hold this — 13870's header).
 *
 * Cross-branch edges between a parent's children, or between tasks in
 * different families entirely, are ALLOWED. Sequence and breakdown are
 * different relationships: "the declaration waits on the BL release" is true
 * whether or not those two sit under one file.
 */
async function addDependency(client, ctx, taskId, { depends_on_task_id }, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  // Authorises the blocked task, and 404s identically for missing and hidden.
  await getTask(client, ctx, taskId, resolved);

  if (depends_on_task_id === taskId) {
    throw new AppError("INVALID_VALUE", "A task cannot wait for itself.", 422, {
      depends_on_task_id: ["a task cannot depend on itself"],
    });
  }
  // The prerequisite gets its OWN visibility check. Same 404 shape.
  await getTask(client, ctx, depends_on_task_id, resolved);

  if (await repo.dependencyWouldCycle(client, taskId, depends_on_task_id)) {
    throw new AppError(
      "INVALID_VALUE",
      "That would make the two tasks wait for each other, so neither could ever start.",
      422,
      { depends_on_task_id: ["this dependency would create a cycle"] },
    );
  }

  const row = await repo.insertDependency(client, {
    task_id: taskId,
    depends_on_task_id,
    created_by: ctx.user.user_id,
  });
  if (!row) {
    throw new AppError("INVALID_VALUE", "That dependency is already recorded.", 409, {
      depends_on_task_id: ["this dependency already exists"],
    });
  }

  await emitEvent(client, {
    eventTypeKey: events.TASK_DEPENDENCY_ADDED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, actorUserId: ctx.user.user_id,
    payload: { depends_on_task_id },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_DEPENDENCY_ADDED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, after: { depends_on_task_id },
  });
  return getTask(client, ctx, taskId, resolved);
}

async function removeDependency(client, ctx, taskId, dependencyId, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  await getTask(client, ctx, taskId, resolved);
  const row = await repo.findDependency(client, dependencyId);
  // `row.task_id !== taskId` matters: without it, an authorised caller could
  // delete an edge belonging to a task they cannot see by guessing its id.
  if (!row || row.task_id !== taskId) {
    throw new AppError("NOT_FOUND", "Dependency not found", 404);
  }
  await repo.deleteDependency(client, dependencyId);
  await emitEvent(client, {
    eventTypeKey: events.TASK_DEPENDENCY_REMOVED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, actorUserId: ctx.user.user_id,
    payload: { depends_on_task_id: row.depends_on_task_id },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_DEPENDENCY_REMOVED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, before: { depends_on_task_id: row.depends_on_task_id },
  });
  return getTask(client, ctx, taskId, resolved);
}

/**
 * "Proceed anyway", or withdraw that decision.
 *
 * This is the escape hatch the CANCELLED rule requires, and it is deliberately
 * an explicit, attributed, reversible ACT rather than an inference. The reason
 * is optional — forcing prose produces "n/a" — but the actor and the moment
 * are not, because unblocking work whose precondition never happened is a
 * judgement somebody should be able to be asked about.
 */
async function setDependencyOverride(client, ctx, taskId, dependencyId, { overridden, reason }, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  await getTask(client, ctx, taskId, resolved);
  const row = await repo.findDependency(client, dependencyId);
  if (!row || row.task_id !== taskId) {
    throw new AppError("NOT_FOUND", "Dependency not found", 404);
  }
  if (overridden) {
    await repo.overrideDependency(client, dependencyId, { userId: ctx.user.user_id, reason });
  } else {
    await repo.clearDependencyOverride(client, dependencyId);
  }
  await emitEvent(client, {
    eventTypeKey: events.TASK_DEPENDENCY_OVERRIDDEN, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, actorUserId: ctx.user.user_id,
    payload: { dependency_id: dependencyId, overridden: Boolean(overridden) },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_DEPENDENCY_OVERRIDDEN, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`,
    before: { overridden: Boolean(row.overridden_at) },
    after: { overridden: Boolean(overridden), reason: reason || null },
  });
  return getTask(client, ctx, taskId, resolved);
}

/**
 * Create a child task under a parent.
 *
 * Children INHERIT the parent's operations-file link by default — that is the
 * whole point of splitting a file's work among people, and re-picking the same
 * dossier on every child is the kind of friction that ends with half the
 * children unlinked. `entity_type`/`entity_id` in the body still win, so a
 * child about a different record is expressible.
 *
 * What is NOT inherited: the assignee (a child exists to be given to somebody
 * else), the status, the reminder and the recurrence rule. A child of a
 * repeating parent is a one-off piece of work, not a second series — spawning
 * children per occurrence would multiply the board by the recurrence count.
 *
 * Authorisation is NOT inherited either: `createTask` re-runs the same scope
 * and personal-task checks it runs for a top-level task, so being able to see
 * a parent is not authority to place work in somebody else's scope.
 */
async function addChildTask(client, ctx, parentTaskId, input, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  const parent = await getTask(client, ctx, parentTaskId, resolved);
  assertParentable(parent);
  if (parent.is_personal && parent.created_by !== ctx.user.user_id) {
    // Unreachable through `getTask` today, and kept as a belt: a personal task
    // is its creator's alone, and giving it children would put other people's
    // work inside a private record.
    throw new AppError("FORBIDDEN", "That personal task is not yours to break down.", 403);
  }
  const child = await createTask(client, ctx, {
    ...input,
    parent_task_id: parentTaskId,
    entity_type: input.entity_type !== undefined ? input.entity_type : parent.entity_type,
    entity_id: input.entity_id !== undefined ? input.entity_id : parent.entity_id,
    // The operations-file link is inherited on the same terms (13920). A child
    // is a separately-assigned piece of the SAME work, so it is on the same
    // file and the same stage unless the caller says otherwise — and a child
    // that silently lost its file would go missing from the file's own Tasks
    // tab while plainly being work on it.
    dossier_id: input.dossier_id !== undefined ? input.dossier_id : parent.dossier_id,
    // The whole stage SET (13950), and only while the child stays on the
    // parent's file: a child moved to another file inherits no stage, because
    // the parent's stages are the other file's and would be refused by name.
    ...(namedStages(input) === undefined && (input.dossier_id === undefined || input.dossier_id === parent.dossier_id)
      ? { milestone_instance_ids: stagesOf(parent) }
      : {}),
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_UPDATED, moduleKey: events.MODULE,
    entityRef: `task:${parentTaskId}`, after: { child_task_id: child.task_id, child_title: child.title },
  });
  return child;
}

/** A parent's children, each re-checked against the caller's own reach. */
async function childrenFor(client, ctx, parentTaskId, audience) {
  const rows = await repo.listChildTasks(client, parentTaskId);
  return rows.filter((r) => canSeeTask(r, ctx, audience)).map(withLink);
}

/* ── collaboration: watchers, pings, and who hears about what ───────────── */

/**
 * Everyone who should hear that something happened to this task.
 *
 * Creator, assignee and watchers, deduplicated, minus the person who did it —
 * nobody needs to be told about their own action, and a notification that
 * arrives because you clicked something teaches people to ignore the bell.
 *
 * Returned as an array of ids rather than as a fan-out, because the CALLER
 * decides what to say; this only decides who is listening.
 */
function recipientsOf(task, watchers = [], { exclude } = {}) {
  const ids = new Set();
  if (task.created_by) ids.add(task.created_by);
  if (task.assigned_to) ids.add(task.assigned_to);
  for (const w of watchers) if (w.user_id) ids.add(w.user_id);
  if (exclude) ids.delete(exclude);
  return [...ids];
}

/**
 * Send one notification per recipient, with a RECIPIENT-SPECIFIC dedupe key.
 *
 * ── THE BUG THIS SHAPE EXISTS TO AVOID ─────────────────────────────────────
 *
 * `notification.service.notify()` claims a dedupe key globally for its process
 * or Redis window. A key like `task-ping:<task id>` therefore means the FIRST
 * recipient suppresses every later one: four watchers, one delivery, three
 * people who never learn anything happened and no error anywhere. The key must
 * carry the recipient, and that is why every call below appends the user id.
 *
 * Never throws, for the same reason `notifyAssignee` does not: the task is the
 * record and the notification is a courtesy about it. A ping that fails to
 * deliver must not roll back the ping's audit row.
 */
async function notifyEach(client, userIds, build) {
  const { notify } = require("../../notification/notification.service");
  const results = [];
  for (const userId of userIds) {
    try {
      results.push(await notify(client, { ...build(userId), userId }));
    } catch (err) {
      logger.error({ err, userId }, "workspace task notification failed");
      results.push(null);
    }
  }
  return results;
}

async function addWatcher(client, ctx, taskId, userId, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  await getTask(client, ctx, taskId, resolved);
  const row = await repo.addWatcher(client, taskId, userId);
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_WATCHER_ADDED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, after: { watcher_user_id: userId },
  });
  return row;
}

async function removeWatcher(client, ctx, taskId, userId, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  await getTask(client, ctx, taskId, resolved);
  const ok = await repo.removeWatcher(client, taskId, userId);
  if (!ok) throw new AppError("NOT_FOUND", "Watcher not found", 404);
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_WATCHER_REMOVED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, before: { watcher_user_id: userId },
  });
  return { deleted: true };
}

/**
 * Ping somebody about this task — the meeting's "notify them from the task".
 *
 * ── WHY THE RECIPIENTS ARE NOT FREE ────────────────────────────────────────
 *
 * A ping can only reach people already connected to the task: its assignee,
 * its creator, or a watcher. Anything wider is an unaudited message channel
 * bolted to a to-do list, and "notify any user id" is how a task panel becomes
 * a way to bypass Smart Comms. Adding somebody to the conversation is
 * therefore an explicit act — make them a watcher — which is visible on the
 * task rather than invisible in a delivery log.
 *
 * ── WHY THE DEDUPE KEY CARRIES A TIMESTAMP ─────────────────────────────────
 *
 * A ping is a deliberate, repeatable act: "any news?" on Tuesday and again on
 * Thursday are two messages, not one retried. Task-and-recipient alone would
 * silently swallow the second. The minute bucket keeps a double-click idempotent
 * while letting a genuine second ping through.
 */
async function pingTask(client, ctx, taskId, { user_ids, message }, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  const task = await getTask(client, ctx, taskId, resolved);
  const allowed = new Set(recipientsOf(task, task.watchers || []));
  const targets = (user_ids && user_ids.length ? user_ids : [...allowed])
    .filter((id) => allowed.has(id) && id !== ctx.user.user_id);

  if (!targets.length) {
    throw new AppError(
      "INVALID_VALUE",
      "There is nobody to ping. Assign the task or add a watcher first.",
      422,
      { user_ids: ["no eligible recipient on this task"] },
    );
  }

  const from = ctx.user.display_name || ctx.user.email || "A colleague";
  const minute = new Date().toISOString().slice(0, 16);
  await notifyEach(client, targets, (userId) => ({
    eventTypeKey: events.TASK_PINGED,
    title: `${from} pinged you about a task`,
    body: message ? `${task.title} — ${message}` : task.title,
    entityRef: `task:${taskId}`,
    priority: task.priority === "URGENT" ? "HIGH" : "NORMAL",
    url: entityRouteFor(taskId),
    dedupeKey: `task-ping:${taskId}:${userId}:${minute}`,
  }));

  await emitEvent(client, {
    eventTypeKey: events.TASK_PINGED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, actorUserId: ctx.user.user_id,
    payload: { recipients: targets.length },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_PINGED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, after: { recipients: targets, has_message: Boolean(message) },
  });
  return { pinged: targets.length, user_ids: targets };
}

/* ── blockages (13975) ────────────────────────────────────────────────────── */

/**
 * Register an external hold on a task — "customs' network is down" — with the
 * note that explains it and an optional estimate of when it clears.
 *
 * ── WHY THE FAN-OUT IS WIDER THAN A PING'S ─────────────────────────────────
 *
 * A ping may only reach people already on the task, because a ping is a
 * nudge about work the recipient already owns. A blockage is the opposite:
 * its whole purpose is to reach the person who can LIFT the hold, who is
 * usually NOT on the task — the customs manager, the client's contact, the
 * network provider's account handler. So `notify_user_ids` here accepts any
 * user in the tenant. That is not an unaudited message channel bolted to a
 * to-do list (the defect the ping rule exists to prevent): every named
 * recipient receives a SmartComm direct message that lives in the comms
 * record, and the raise itself is an audit row. The reach is deliberate and
 * the paper trail is the comms thread.
 *
 * ── WHY THE NOTIFICATION IS FORCED ─────────────────────────────────────────
 *
 * A hold nobody noticed is a hold that becomes a missed sailing. The raise
 * therefore uses `force` on the notification service: in-app, push and email
 * all fire regardless of per-category silencing — the same treatment the
 * security category gets, and for the same reason: the cost of one unwanted
 * alert is trivial against the cost of one unnoticed hold. Resolving is NOT
 * forced (see `resolveBlockage`): good news can wait for preferences.
 *
 * ── WHY DELIVERY IS BEST-EFFORT AND AFTER THE WRITE ────────────────────────
 *
 * The blockage row is the record; the messages are courtesies about it. A
 * SmartComm channel that rejects the post (archived, membership gone) must
 * not roll back a hold that is real, so every leg is individually caught and
 * logged, exactly like `notifyEach`.
 */
async function raiseBlockage(client, ctx, taskId, body, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  const task = await getTask(client, ctx, taskId, resolved);
  if (DONE_STATUSES.has(task.status)) {
    throw new AppError(
      "INVALID_VALUE",
      "A finished task cannot be blocked. Reopen it first if the hold is real.",
      422,
      { status: ["closed tasks cannot carry a blockage"] },
    );
  }
  if (task.blockage) {
    throw new AppError(
      "INVALID_VALUE",
      "This task already has an active blockage. Resolve it before raising another.",
      422,
      { blockage: ["one active blockage per task"] },
    );
  }

  const eta = body.estimated_resolve_at || null;
  const row = await repo.insertBlockage(client, {
    taskId,
    note: body.note,
    estimatedResolveAt: eta,
    raisedBy: ctx.user.user_id,
  });
  await emitEvent(client, {
    eventTypeKey: events.TASK_BLOCKAGE_RAISED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, actorUserId: ctx.user.user_id,
    payload: { blockage_id: row.task_blockage_id, estimated_resolve_at: eta },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_BLOCKAGE_RAISED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`,
    after: { blockage_id: row.task_blockage_id, note: body.note, estimated_resolve_at: eta },
  });

  const auto = recipientsOf(task, task.watchers || [], { exclude: ctx.user.user_id });
  const extra = [...new Set((body.notify_user_ids || []).filter((id) => id !== ctx.user.user_id))];
  const validExtra = extra.length ? await repo.existingUserIds(client, extra) : [];
  const targets = [...new Set([...auto, ...validExtra])];
  const from = ctx.user.display_name || ctx.user.email || "A colleague";
  const message =
    `Blockage on "${task.title}": ${body.note}` +
    (eta ? ` — expected to clear by ${new Date(eta).toISOString().slice(0, 10)}` : "");

  if (targets.length) {
    await notifyEach(client, targets, (userId) => ({
      eventTypeKey: events.TASK_BLOCKAGE_RAISED,
      title: `${from} registered a blockage on a task`,
      body: message,
      entityRef: `task:${taskId}`,
      priority: "HIGH",
      url: entityRouteFor(taskId),
      dedupeKey: `task-blockage:${row.task_blockage_id}:${userId}`,
      force: true,
    }));

    // The in-house message: one DM per named person, created if it does not
    // exist yet (createChannel dedupes DIRECT channels), posted as the raiser
    // so the thread reads as them saying it — because it is them saying it.
    // notifyMembers OFF: these people already got the forced notification,
    // and a second, preference-honouring bell for the same sentence is noise.
    const comms = require("../../smartcomm/smartcomm.service");
    for (const userId of targets) {
      try {
        const dm = await comms.createChannel(client, {
          data: { kind: "DIRECT", member_ids: [userId] },
          actor: ctx.user,
        });
        await comms.postMessage(client, {
          groupId: dm.group_id,
          body: `${message}\n${entityRouteFor(taskId)}`,
          actor: ctx.user,
          notifyMembers: false,
        });
      } catch (err) {
        logger.error({ err, userId, taskId }, "blockage SmartComm DM failed");
      }
    }
  }

  // Group channels the raiser picked ("tell the customs channel"). Members
  // are notified through comms' own preference-honouring fan-out — that IS
  // the channel's normal contract, and they did not get a forced bell.
  const commsForGroups = require("../../smartcomm/smartcomm.service");
  const postedChannels = [];
  for (const groupId of body.channel_ids || []) {
    try {
      await commsForGroups.postMessage(client, { groupId, body: message, actor: ctx.user, notifyMembers: true });
      postedChannels.push(groupId);
    } catch (err) {
      logger.error({ err, groupId, taskId }, "blockage SmartComm channel post failed");
    }
  }

  return {
    blockage: shapeBlockage({ ...row, raised_by_name: ctx.user.display_name || ctx.user.email || null }),
    notified: targets.length,
    channels_posted: postedChannels,
  };
}

/**
 * Clear the hold. Resolving does three things a raise deliberately does not:
 *
 *   1. closes the row (the partial unique index then frees the task for a
 *      future hold),
 *   2. moves an OPEN task's due date forward by exactly the blocked duration
 *      and records that movement on the blockage row (`due_shift`), so "why
 *      is this deadline later than the one I wrote" is answerable from the
 *      task's own history — the performance-review promise the feature exists
 *      for: the delay is attributed to the hold, not to the person,
 *   3. tells the people on the task — through their PREFERENCES, not forced,
 *      because "you are unblocked, start" is good news and good news respects
 *      the switches people set. The forced leg was the raise.
 *
 * A finished task's due date is NOT moved: its deadline is history by then,
 * and rewriting history to flatter the present is exactly what the audit
 * ledger exists to make impossible.
 */
async function resolveBlockage(client, ctx, taskId, blockageId, body, audience) {
  const resolved = resolveAudience(ctx, audience ?? ctx.audience);
  const task = await getTask(client, ctx, taskId, resolved);
  const row = await repo.resolveBlockageRow(client, blockageId, {
    resolvedBy: ctx.user.user_id,
    resolveNote: body.resolve_note || null,
  });
  if (!row || row.task_id !== taskId) {
    throw new AppError("NOT_FOUND", "Blockage not found on this task, or already resolved", 404);
  }

  const seconds = Math.max(0, Math.round((new Date(row.resolved_at).getTime() - new Date(row.raised_at).getTime()) / 1000));
  let newDueAt = null;
  if (seconds > 0 && !DONE_STATUSES.has(task.status)) {
    newDueAt = await repo.shiftTaskDue(client, taskId, seconds);
    if (newDueAt) await repo.setBlockageDueShift(client, blockageId, seconds);
  }

  await emitEvent(client, {
    eventTypeKey: events.TASK_BLOCKAGE_RESOLVED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`, actorUserId: ctx.user.user_id,
    payload: { blockage_id: blockageId, due_shift_seconds: newDueAt ? seconds : 0 },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.TASK_BLOCKAGE_RESOLVED, moduleKey: events.MODULE,
    entityRef: `task:${taskId}`,
    before: { note: row.note, raised_at: row.raised_at },
    after: {
      blockage_id: blockageId,
      resolve_note: body.resolve_note || null,
      due_shift_seconds: newDueAt ? seconds : 0,
      new_due_at: newDueAt,
    },
  });

  const targets = recipientsOf(task, task.watchers || [], { exclude: ctx.user.user_id });
  if (targets.length) {
    const from = ctx.user.display_name || ctx.user.email || "A colleague";
    const duration = humanDuration(seconds);
    await notifyEach(client, targets, (userId) => ({
      eventTypeKey: events.TASK_BLOCKAGE_RESOLVED,
      title: `A blockage on a task was resolved`,
      body: newDueAt
        ? `${from} cleared "${row.note}" after ${duration}. The due date moved to ${new Date(newDueAt).toISOString().slice(0, 10)}.`
        : `${from} cleared "${row.note}" after ${duration}.`,
      entityRef: `task:${taskId}`,
      priority: "NORMAL",
      url: entityRouteFor(taskId),
      dedupeKey: `task-blockage-resolved:${blockageId}:${userId}`,
    }));
  }

  const full = (await repo.listBlockages(client, taskId)).find((b) => b.task_blockage_id === blockageId);
  return { blockage: shapeBlockage(full || row), new_due_at: newDueAt };
}

/** "2d 4h" / "3h" / "20m" — a hold's length as a person says it, for the
 *  resolve notification. Days first because a customs hold is measured in
 *  days and "52h" makes a reader do arithmetic nobody should do on a lock
 *  screen. */
function humanDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * Tell the watchers a task moved.
 *
 * Separate from `notifyAssignee`, which announces OWNERSHIP ("this is yours
 * now") — a different sentence to a different audience, and one that should
 * still fire when nobody is watching. This is the "something you follow
 * changed" message, and its dedupe key carries both the recipient and the
 * target status so two distinct moves are two notifications.
 */
async function notifyStatusWatchers(client, ctx, task, watchers, { from, to }) {
  const targets = recipientsOf(task, watchers, { exclude: ctx.user.user_id });
  if (!targets.length) return [];
  return notifyEach(client, targets, (userId) => ({
    eventTypeKey: events.TASK_STATUS_CHANGED,
    title: "A task you follow moved",
    body: `${task.title}: ${from} → ${to}`,
    entityRef: `task:${task.task_id}`,
    priority: "NORMAL",
    url: entityRouteFor(task.task_id),
    dedupeKey: `task-status:${task.task_id}:${to}:${userId}`,
  }));
}

/* ── notifications ──────────────────────────────────────────────────────── */

/**
 * Tell the assignee they have been given something.
 *
 * NEVER throws, and that is load-bearing rather than defensive: `notify`
 * touches Redis, web-push and possibly SMTP, and a task that fails to SAVE
 * because an alert could not be delivered is a worse outcome than an alert
 * that does not arrive. The task is the record; the notification is a
 * courtesy about it.
 *
 * `link_url` comes from the same derivation the UI uses, so the phone and the
 * screen open the same place.
 */
async function notifyAssignee(client, task) {
  if (!task || !task.assigned_to) return null;
  if (task.assigned_to === task.created_by) return null; // assigning it to yourself is not news
  try {
    const { notify } = require("../../notification/notification.service");
    return await notify(client, {
      userId: task.assigned_to,
      eventTypeKey: events.TASK_ASSIGNED,
      title: "A task was assigned to you",
      body: task.title,
      entityRef: `task:${task.task_id}`,
      priority: task.priority === "URGENT" ? "HIGH" : "NORMAL",
      url: task.link_url,
      dedupeKey: `task-assigned:${task.task_id}:${task.assigned_to}`,
    });
  } catch (err) {
    logger.error({ err, task_id: task.task_id }, "task assignment notification failed");
    return null;
  }
}

/* ════════════════════════════ CALENDAR EVENTS ═══════════════════════════ */

/**
 * Events in a window.
 *
 * `mine` is the default and it is not the same question as the task audience:
 * an event is an appointment in a diary, and "show me the team's diary" is a
 * different product (a shared resource calendar). Invited internal users are
 * still included in `mine`, because an appointment they were asked to attend
 * is actionable work even when they did not create it. `audience=all` is
 * honoured only for a caller whose grants make them tenant-wide; `team` uses
 * the event's nullable organisational scope.
 */
async function listEvents(client, ctx, q = {}) {
  const audience = resolveAudience(ctx, q.audience);
  const window = await resolveWindow(client, q);
  const rows = await repo.listEvents(client, {
    from: window.from, to: window.to, eventType: q.event_type,
    visibility: eventVisibilityOf(ctx, audience),
  });
  return rows.map((row) => {
    const event = { ...row };
    delete event._total;
    return withLink(event);
  });
}

async function readEvent(client, id) {
  const event = await repo.findEvent(client, id);
  if (!event) return null;
  const [participants, reminders] = await Promise.all([
    repo.listParticipants(client, id),
    repo.listReminders(client, "calendar_event", id),
  ]);
  return { ...withLink(event), participants, reminders };
}

async function getEvent(client, ctx, id) {
  const event = await readEvent(client, id);
  if (!event) throw new AppError("NOT_FOUND", "Event not found", 404);
  const audience = resolveAudience(ctx, ctx.audience);
  if (!canSeeEvent(event, ctx, audience, event.participants)) {
    throw new AppError("NOT_FOUND", "Event not found", 404);
  }
  return event;
}

async function getManageableEvent(client, ctx, id) {
  const event = await readEvent(client, id);
  if (!event) throw new AppError("NOT_FOUND", "Event not found", 404);
  if (!canManageEvent(event, ctx, event.participants)) {
    const audience = resolveAudience(ctx, ctx.audience);
    if (!canSeeEvent(event, ctx, audience, event.participants)) {
      throw new AppError("NOT_FOUND", "Event not found", 404);
    }
    throw new AppError("EVENT_FORBIDDEN", "Only the organiser or an authorised manager can change this event", 403);
  }
  return event;
}

async function createEvent(client, ctx, input) {
  assertEventScope(ctx, input.scope_id);
  const timeZone = await timezoneOf(client);
  // An event ON a bare date starts at midnight — that is what "all day" means,
  // and it is deliberately not the 17:00 a bare DUE date gets.
  const start_at = toInstant(input.start_at, { timeZone, dateOnlyTime: "00:00:00" });
  const end_at = toInstant(input.end_at, { timeZone, dateOnlyTime: "23:59:00" });
  if (start_at && end_at && end_at < start_at) {
    throw new AppError("INVALID_VALUE", "The event must end after it starts", 422, { end_at: ["must be at or after the start"] });
  }
  // Compare converted instants, not the browser's zoneless wall-clock strings.
  // Clash detection is advisory and OPT-OUT (`force`), not a hard block.
  if (input.location && !input.force) {
    const clashes = await repo.findEventClashes(client, {
      location: input.location, start_at, end_at,
    });
    if (clashes.length) {
      throw new AppError(
        "CLASH_DETECTED",
        `${clashes.length} event${clashes.length > 1 ? "s are" : " is"} already booked at ${input.location} during this time. Save again to book it anyway.`,
        409,
        { clashes },
      );
    }
  }
  const rule = ruleOrThrow(input);
  const event = await repo.insertEvent(client, {
    ...input, start_at, end_at, created_by: ctx.user.user_id,
    recurrence_rule: rule,
  });
  if (rule) await repo.updateEvent(client, event.calendar_event_id, { recurrence_series_id: event.calendar_event_id });
  if ("reminders" in input || "reminder_minutes" in input || "remind_at" in input) {
    await writeReminders(client, {
      ownerType: "calendar_event", ownerId: event.calendar_event_id, input, anchor: start_at, timeZone,
      actor: { user_id: ctx.user.user_id },
    });
  }
  for (const p of input.participants || []) {
    const row = await repo.insertParticipant(client, { calendar_event_id: event.calendar_event_id, ...p });
    // An event written with its guests already on it owes them their invites
    // just as an add does — the create form and the add endpoint are one
    // promise, or the "you're invited" depends on WHICH button you pressed.
    if (row) await notifyInvitation(client, event, row, ctx.user.user_id);
  }
  await emitEvent(client, {
    eventTypeKey: events.EVENT_CREATED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${event.calendar_event_id}`, actorUserId: ctx.user.user_id,
  });
  await audit(client, {
    ...actorOf(ctx), action: events.EVENT_CREATED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${event.calendar_event_id}`,
    after: { title: event.title, start_at: event.start_at, end_at: event.end_at },
  });
  return getEvent(client, ctx, event.calendar_event_id);
}

async function updateEvent(client, ctx, id, input) {
  const before = await getManageableEvent(client, ctx, id);
  assertEventScope(ctx, input.scope_id);
  const timeZone = await timezoneOf(client);
  const patch = { ...input };
  if ("start_at" in input) patch.start_at = toInstant(input.start_at, { timeZone, dateOnlyTime: "00:00:00" });
  if ("end_at" in input) patch.end_at = toInstant(input.end_at, { timeZone, dateOnlyTime: "23:59:00" });
  const nextStart = patch.start_at ?? before.start_at;
  const nextEnd = patch.end_at ?? before.end_at;
  if (nextStart && nextEnd && nextEnd < nextStart) {
    throw new AppError("INVALID_VALUE", "The event must end after it starts", 422, { end_at: ["must be at or after the start"] });
  }
  const nextLocation = "location" in patch ? patch.location : before.location;
  if (nextLocation && !input.force && ("location" in input || "start_at" in input || "end_at" in input)) {
    const clashes = await repo.findEventClashes(client, {
      location: nextLocation, start_at: nextStart, end_at: nextEnd, excludeId: id,
    });
    if (clashes.length) {
      throw new AppError(
        "CLASH_DETECTED",
        `${clashes.length} event${clashes.length > 1 ? "s are" : " is"} already booked at ${nextLocation} during this time. Save again to book it anyway.`,
        409,
        { clashes },
      );
    }
  }
  const reminderTouched = "reminders" in input || "reminder_minutes" in input || "remind_at" in input;
  delete patch.reminders;
  delete patch.reminder_minutes;
  delete patch.remind_at;
  const rule = ruleOrThrow(input);
  if (rule !== undefined) patch.recurrence_rule = rule;

  await repo.updateEvent(client, id, patch);
  if (reminderTouched) {
    await writeReminders(client, {
      ownerType: "calendar_event", ownerId: id, input,
      anchor: patch.start_at !== undefined ? patch.start_at : before.start_at,
      timeZone, actor: { user_id: ctx.user.user_id },
    });
  } else if ("start_at" in input) {
    // A moved slot re-arms the whole armed set — same reason a moved task
    // re-arms its reminders; a stamp on a date that moved would silence the
    // later alerts the record still owes.
    await repo.rearmOwnerReminders(client, "calendar_event", id);
  }
  // Series scope mirrors updateTask, minus the per-occurrence start/end: every
  // occurrence keeps its own slot in the diary.
  if (input.series === "series" && before.recurrence_series_id) {
    const seriesPatch = { ...patch };
    delete seriesPatch.start_at;
    delete seriesPatch.end_at;
    await repo.updateSeriesEvents(client, before.recurrence_series_id, seriesPatch, { exclude: id });
  }
  await emitEvent(client, {
    eventTypeKey: events.EVENT_UPDATED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${id}`, actorUserId: ctx.user.user_id, payload: { fields: Object.keys(input) },
  });
  await audit(client, {
    ...actorOf(ctx), action: events.EVENT_UPDATED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${id}`,
    before: { start_at: before.start_at, end_at: before.end_at },
    after: { start_at: patch.start_at ?? before.start_at, end_at: patch.end_at ?? before.end_at },
  });
  return getEvent(client, ctx, id);
}

async function deleteEvent(client, ctx, id) {
  const before = await getManageableEvent(client, ctx, id);
  await repo.softDeleteEvent(client, id);
  await emitEvent(client, {
    eventTypeKey: events.EVENT_DELETED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${id}`, actorUserId: ctx.user.user_id,
  });
  await audit(client, {
    ...actorOf(ctx), action: events.EVENT_DELETED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${id}`, before: { title: before.title },
  });
  return { deleted: true };
}

/* ── participants ───────────────────────────────────────────────────────── */

/**
 * Tell the invitee. Names the event and its time, so the notification is the
 * invite, not a pointer at one. Never throws — the participant row is the
 * thing of record; a missed push is rescued by the reminder the invited row
 * also fans out to. Dedupe is per (event, person): re-adding the same guest
 * after a remove is a fresh INVITED row, which gets its own key from the
 * participant id and so does tell them again — deliberately.
 */
async function notifyInvitation(client, event, row, actorId) {
  if (!row || !row.user_id || row.user_id === actorId) return null;
  try {
    const { notify } = require("../../notification/notification.service");
    const timeZone = await timezoneOf(client);
    const when = fmtParticipantWhen(event.start_at, timeZone);
    return await notify(client, {
      userId: row.user_id,
      eventTypeKey: events.EVENT_PARTICIPANT_INVITED,
      title: "You're invited",
      body: when ? `“${event.title}” — ${when}${event.location ? ` · ${event.location}` : ""}.` : `You're invited to “${event.title}”.`,
      entityRef: `calendar_event:${event.calendar_event_id}`,
      priority: "NORMAL",
      url: `/workspace/calendar?event=${event.calendar_event_id}`,
      dedupeKey: `event-invite:${row.calendar_participant_id}`,
    });
  } catch (err) {
    logger.error({ err, calendar_event_id: event.calendar_event_id }, "invitation notification failed");
    return null;
  }
}

/** The when of an invite in the reader's idiom — same contract as the sweep's fmtWhen. */
function fmtParticipantWhen(value, timeZone) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  }).format(d);
}

async function addParticipant(client, ctx, eventId, input) {
  const event = await getManageableEvent(client, ctx, eventId);
  const row = await repo.insertParticipant(client, { calendar_event_id: eventId, ...input });
  if (!row) throw new AppError("ALREADY_EXISTS", "That person is already on this event", 409);
  await notifyInvitation(client, event, row, ctx.user.user_id);
  await emitEvent(client, {
    eventTypeKey: events.EVENT_PARTICIPANT_INVITED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${eventId}`, actorUserId: ctx.user.user_id,
    payload: { user_id: row.user_id, external: Boolean(row.external_name) },
  });
  return row;
}

async function respondParticipant(client, ctx, eventId, participantId, status) {
  const event = await readEvent(client, eventId);
  if (!event) throw new AppError("NOT_FOUND", "Event not found", 404);
  const audience = resolveAudience(ctx, ctx.audience);
  const canManage = canManageEvent(event, ctx, event.participants);
  if (!canManage && !canSeeEvent(event, ctx, audience, event.participants)) {
    throw new AppError("NOT_FOUND", "Event not found", 404);
  }
  const participant = event.participants.find((p) => p.calendar_participant_id === participantId);
  if (!participant || (!canManage && participant.user_id !== ctx.user.user_id)) {
    throw new AppError("PARTICIPANT_FORBIDDEN", "You can respond only to your own invitation", 403);
  }
  const row = await repo.respondParticipant(client, participantId, status);
  if (!row || row.calendar_event_id !== eventId) throw new AppError("NOT_FOUND", "Participant not found", 404);
  await emitEvent(client, {
    eventTypeKey: events.EVENT_PARTICIPANT_RESPONDED, moduleKey: events.MODULE,
    entityRef: `calendar_event:${eventId}`, actorUserId: ctx.user.user_id,
    payload: { user_id: row.user_id, status },
  });
  // The organiser watches their own party: a yes/no is told to them, in the
  // respondent's name, never to themselves. A status-named dedupe so a
  // changed mind lands once per answer, not once per click.
  if (row.user_id && event.created_by && row.user_id !== event.created_by) {
    try {
      const { notify } = require("../../notification/notification.service");
      const who = event.participants.find((p) => p.calendar_participant_id === participantId);
      const whoName = who?.user_name ?? who?.external_name ?? "An invitee";
      await notify(client, {
        userId: event.created_by,
        eventTypeKey: events.EVENT_PARTICIPANT_RESPONDED,
        title: `${whoName} ${status === "ACCEPTED" ? "accepted" : status === "DECLINED" ? "declined" : "answered maybe to"} “${event.title}”`,
        entityRef: `calendar_event:${eventId}`,
        url: `/workspace/calendar?event=${eventId}`,
        dedupeKey: `event-response:${participantId}:${status}`,
      });
    } catch (err) {
      logger.error({ err, calendar_event_id: eventId }, "response notification failed");
    }
  }
  return row;
}

async function removeParticipant(client, ctx, eventId, participantId) {
  await getManageableEvent(client, ctx, eventId);
  const ok = await repo.removeParticipant(client, participantId);
  if (!ok) throw new AppError("NOT_FOUND", "Participant not found", 404);
  return { deleted: true };
}

/* ══════════════════════════════ THE MERGED DAY ═══════════════════════════ */

/**
 * Tasks and events for one window, interleaved by WHEN.
 *
 * This is the surface the "Today" tab renders, and the merge is the feature:
 * a fitting at 10:00 and a task due at 17:00 are the same kind of thing to the
 * person living the day — something that will want them at a time. Two panels
 * side by side would make them read the calendar, then read the list, and hold
 * both in their head. One list, in time order, does not ask that of them.
 *
 * The merge happens HERE rather than in SQL because the two rows have different
 * shapes and the ordering key differs (a due date is a deadline, a start is an
 * appointment) — expressing that as a UNION would mean casting both into a
 * lowest-common-denominator row and throwing the detail away.
 */
/**
 * Interleave tasks and events by WHEN. Pure — no client, no caller — because
 * the ordering IS the feature and it should be checkable without a database.
 *
 * The merge happens here rather than in SQL because the two rows have different
 * shapes and the ordering key differs (a due date is a deadline, a start is an
 * appointment); a UNION would mean casting both into a lowest-common-denominator
 * row and throwing the detail away.
 */
function mergeTimeline(tasks, eventsRows, subtasksRows = []) {
  const items = [
    ...(tasks || []).map((t) => ({
      kind: "task", at: t.due_at, id: t.task_id, title: t.title,
      status: t.status, priority: t.priority, link_url: deriveLink(t),
      entity_type: t.entity_type, entity_id: t.entity_id,
      assigned_to_name: t.assigned_to_name, subtask_count: t.subtask_count,
      subtask_done_count: t.subtask_done_count,
      is_overdue: t.status !== "DONE" && t.status !== "CANCELLED"
        && Boolean(t.due_at) && new Date(t.due_at) < new Date(),
    })),
    ...(subtasksRows || []).map((s) => ({
      kind: "subtask", at: s.due_at, id: s.task_subtask_id,
      task_id: s.task_id, title: s.title, task_title: s.task_title,
      status: s.task_status, priority: s.task_priority,
      link_url: null, entity_type: s.entity_type, entity_id: s.entity_id,
      is_overdue: Boolean(s.due_at) && new Date(s.due_at) < new Date(),
    })),
    ...(eventsRows || []).map((e) => ({
      kind: "event", at: e.start_at, id: e.calendar_event_id,
      title: e.title, event_type: e.event_type, location: e.location,
      all_day: e.all_day, end_at: e.end_at, link_url: deriveLink(e),
      entity_type: e.entity_type, entity_id: e.entity_id,
      participant_count: e.participant_count,
    })),
  ];

  // Undated work sorts last rather than first: a task with no due date is not
  // the most urgent thing on the list, it is the thing with no claim on today.
  items.sort((a, b) => {
    if (!a.at && !b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    const d = new Date(a.at) - new Date(b.at);
    if (d !== 0) return d;
    // Same instant: the appointment first. A meeting has a room and other
    // people in it; a task can slip ten minutes and nobody is kept waiting.
    return a.kind === "event" ? -1 : 1;
  });
  return items;
}

/**
 * Tasks and events for one window, interleaved by time.
 *
 * This is the surface the "Today" tab renders, and the merge is the feature: a
 * fitting at 10:00 and a task due at 17:00 are the same kind of thing to the
 * person living the day — something that will want them at a time. Two panels
 * side by side would make them read the calendar, then read the list, and hold
 * both in their head. One list, in time order, does not ask that of them.
 */
async function dayTimeline(client, ctx, { from, to, audience }) {
  const resolved = resolveAudience(ctx, audience);
  const vis = visibilityOf(ctx, resolved);
  const eventVis = eventVisibilityOf(ctx, resolved);
  const window = await resolveWindow(client, { from, to });
  const [tasksOut, subtasksOut, eventsOut] = await Promise.all([
    repo.dayTasks(client, { from: window.from, to: window.to, visibility: vis }),
    repo.daySubtasks(client, { from: window.from, to: window.to, visibility: vis }),
    repo.listEventsWindow(client, { from: window.from, to: window.to, visibility: eventVis }),
  ]);
  const items = mergeTimeline(tasksOut.rows, eventsOut.rows, subtasksOut.rows);
  return {
    items,
    audience: resolved,
    audiences: audiencesFor(ctx),
    timezone: window.timeZone,
    tasks: tasksOut.rows.length,
    events: eventsOut.rows.length,
    deadlines: subtasksOut.rows.length,
    counts: {
      tasks: tasksOut.total,
      events: eventsOut.total,
      deadlines: subtasksOut.total,
    },
    truncated: {
      tasks: tasksOut.truncated,
      events: eventsOut.truncated,
      deadlines: subtasksOut.truncated,
    },
  };
}

/**
 * Every deadline in a window — task due dates AND subtask due dates — for the
 * calendar's overlay.
 *
 * This is the "deadlines appear on the calendar" surface: the month grid draws
 * events from `/workspace/events` and lays these on top as due-date chips. Kept
 * SEPARATE from `listEvents` because a deadline is not an appointment — it has
 * no duration, it opens the task rather than an event dialog, and folding it
 * into the events list would make it editable as one. Both halves go through the
 * same `visibilityOf`, so a deadline chip can never show for a task the caller
 * could not open.
 */
async function deadlinesInRange(client, ctx, { from, to, audience }) {
  const resolved = resolveAudience(ctx, audience);
  const vis = visibilityOf(ctx, resolved);
  const window = await resolveWindow(client, { from, to });
  const [tasks, subtasks] = await Promise.all([
    repo.tasksInRange(client, { from: window.from, to: window.to, visibility: vis }),
    repo.subtasksInRange(client, { from: window.from, to: window.to, visibility: vis }),
  ]);
  const now = Date.now();
  // What a person types to find a deadline rides on the item: the notes, the
  // file's reference and its client, and the stages of the chain. The
  // calendar filters the fetched window on the client, so these are the
  // words that search can see there — for a step, they are its parent's.
  const searchable = (row) => ({
    description: row.description ?? null,
    dossier_id: row.dossier_id ?? null,
    dossier_ref: row.dossier_ref ?? null,
    dossier_client_name: row.dossier_client_name ?? null,
    milestone_labels: Array.isArray(row.milestones) ? row.milestones.map((m) => m.label) : [],
  });
  const items = [
    ...tasks
      .filter((t) => t.status !== "CANCELLED")
      .map((t) => ({
        kind: "task", task_id: t.task_id, subtask_id: null,
        title: t.title, task_title: null, at: t.due_at,
        status: t.status, priority: t.priority, is_done: t.status === "DONE",
        is_overdue: t.status !== "DONE" && Boolean(t.due_at) && new Date(t.due_at).getTime() < now,
        ...searchable(t),
      })),
    ...subtasks
      .filter((s) => s.task_status !== "CANCELLED")
      .map((s) => ({
        kind: "subtask", task_id: s.task_id, subtask_id: s.task_subtask_id,
        title: s.title, task_title: s.task_title, at: s.due_at,
        status: s.task_status, priority: s.task_priority, is_done: s.is_done,
        is_overdue: !s.is_done && Boolean(s.due_at) && new Date(s.due_at).getTime() < now,
        ...searchable({ ...s, description: s.task_description }),
      })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return { items, audience: resolved, audiences: audiencesFor(ctx) };
}

/* ═══════════════════════ RECURRENCE SPAWN (13840) ═══════════════════════ */

/**
 * Materialise the occurrences that have come due — the spawn half of the sweep.
 *
 * This is the ONLY place occurrences are created, and it is designed to the same
 * shape as the reminder sweep it rides beside: a bounded scan over armed rows,
 * idempotent by construction (the unique series index makes a duplicate a no-op),
 * and safe to run twice because every row advances its cursor whether or not it
 * won the insert race. See the migration's header for the reasoning.
 *
 * Kept OUT of the reminder sweep's own loop so a series whose owner finished
 * early still advances: the reminder scan skips DONE rows, the spawn scan does
 * not, and coupling them would stop every series whose accountant is diligent.
 */
async function spawnDue(client, { now = new Date(), limit = 200 } = {}) {
  const timeZone = await timezoneOf(client);
  const nowIso = now.toISOString();
  let tasks = 0;
  let eventsFired = 0;

  for (const row of await repo.listSpawnDueTasks(client, nowIso, limit)) {
    const existingCount = row.recurrence_rule.includes("COUNT=")
      ? await repo.countSeriesTasks(client, row.recurrence_series_id)
      : null;
    const next = recurrence.nextOccurrence(row.recurrence_rule, {
      after: row.due_at, timeZone, existingCount,
    });
    if (!next) { await repo.endTaskRecurrence(client, row.task_id); continue; }
    const spawned = await repo.insertSpawnedTask(client, {
      title: row.title, description: row.description, priority: row.priority,
      assigned_to: row.assigned_to, created_by: row.created_by, due_at: next,
      parent_task_id: row.parent_task_id, entity_type: row.entity_type,
      entity_id: row.entity_id, is_personal: row.is_personal, scope_id: row.scope_id,
      recurrence_rule: row.recurrence_rule, recurrence_series_id: row.recurrence_series_id,
    });
    if (spawned) {
      await repo.copySubtasks(client, row.task_id, spawned.task_id);
      // Series-level relative reminders re-materialise per occurrence: the
      // template stays on the parent (scope=series), and this row is the one
      // fresh, armed, per-occurrence copy — computed from THIS occurrence's
      // date, which is exactly what "the morning of every Monday" means.
      const templates = await repo.listReminderTemplates(client, "task", [row.task_id]);
      if (templates.length) {
        await repo.materialiseReminders(client, {
          ownerType: "task", ownerId: spawned.task_id, anchorIso: next, templates,
        });
        await repo.syncParentReminderColumns(client, "task", spawned.task_id);
      }
      tasks += 1;
    }
    await repo.advanceTaskCursor(client, row.task_id, next);
  }

  for (const row of await repo.listSpawnDueEvents(client, nowIso, limit)) {
    const existingCount = row.recurrence_rule.includes("COUNT=")
      ? await repo.countSeriesEvents(client, row.recurrence_series_id)
      : null;
    const nextStart = recurrence.nextOccurrence(row.recurrence_rule, {
      after: row.start_at, timeZone, existingCount,
    });
    if (!nextStart) { await repo.endEventRecurrence(client, row.calendar_event_id); continue; }
    // The slot keeps its length: a one-hour meeting stays an hour, whatever day
    // it lands on.
    const durationMs = new Date(row.end_at) - new Date(row.start_at);
    const nextEnd = new Date(new Date(nextStart).getTime() + durationMs).toISOString();
    const spawned = await repo.insertSpawnedEvent(client, {
      title: row.title, event_type: row.event_type, location: row.location,
      description: row.description, start_at: nextStart, end_at: nextEnd,
      all_day: row.all_day, created_by: row.created_by, entity_type: row.entity_type,
      entity_id: row.entity_id, scope_id: row.scope_id,
      recurrence_rule: row.recurrence_rule, recurrence_series_id: row.recurrence_series_id,
    });
    if (spawned) {
      await repo.copyParticipants(client, row.calendar_event_id, spawned.calendar_event_id);
      const templates = await repo.listReminderTemplates(client, "calendar_event", [row.calendar_event_id]);
      if (templates.length) {
        await repo.materialiseReminders(client, {
          ownerType: "calendar_event", ownerId: spawned.calendar_event_id, anchorIso: nextStart, templates,
        });
        await repo.syncParentReminderColumns(client, "calendar_event", spawned.calendar_event_id);
      }
      eventsFired += 1;
    }
    await repo.advanceEventCursor(client, row.calendar_event_id, nextStart);
  }

  return { tasks, events: eventsFired };
}


/* ══════════════════════════════ ANALYTICS ════════════════════════════════ */
/**
 * `/workspace/analytics` — authorised operational metrics over the SAME task
 * population Tasks and Today show.
 *
 * ── THE RECONCILIATION PROMISE ─────────────────────────────────────────────
 *
 * Every figure this section returns is produced by `visibleWhere` — the exact
 * predicate the list and the board filter on — so a user who reads "17
 * overdue" can open the list, filter the same way, and count seventeen rows.
 * That is not a nice property, it is the acceptance criterion: a dashboard
 * that disagrees with the screen underneath it is worse than no dashboard,
 * because it is believed.
 *
 * ── AND WHAT IT IS NOT ─────────────────────────────────────────────────────
 *
 * "Performance" here means work moving through a process: how much, how late,
 * how long, how stuck. It is NOT an appraisal score, not a compensation input
 * and not an employee KPI rating — those live in Empower HR behind their own
 * module, their own grants and their own retention rules. Nothing in this file
 * reads any of those tables, and a future metric that wants to must go and get
 * its own permission rather than borrowing MOD-00A's.
 *
 * ── BOUNDED BY CONSTRUCTION ────────────────────────────────────────────────
 *
 * The window is resolved and CLAMPED before any query runs: an unbounded
 * aggregate over a tenant's whole history is a table scan a user can trigger
 * from a URL. A too-wide range is narrowed and SAID SO in the response rather
 * than being silently obeyed or refused.
 */

/** The widest window an aggregate will honour, in days. */
const ANALYTICS_MAX_DAYS = 370;
/** What a caller who names no window gets. */
const ANALYTICS_DEFAULT_DAYS = 30;

/**
 * Resolve, default and clamp the analytics window on the tenant's clock.
 *
 * Returns the clamp decision alongside the window so the screen can say "showing
 * the last 370 days" instead of quietly answering a different question from the
 * one the URL asked.
 */
async function resolveAnalyticsWindow(client, { from, to }) {
  const timeZone = await timezoneOf(client);
  const now = new Date();
  const toAt = toInstant(to, { timeZone, dateOnlyTime: "00:00:00" }) || now.toISOString();
  const defaultFrom = new Date(new Date(toAt).getTime() - ANALYTICS_DEFAULT_DAYS * 86400000).toISOString();
  let fromAt = toInstant(from, { timeZone, dateOnlyTime: "00:00:00" }) || defaultFrom;

  let clamped = false;
  if (new Date(fromAt).getTime() >= new Date(toAt).getTime()) {
    // An inverted or empty range is a typo, not a request for no data.
    fromAt = defaultFrom;
    clamped = true;
  }
  const maxMs = ANALYTICS_MAX_DAYS * 86400000;
  if (new Date(toAt).getTime() - new Date(fromAt).getTime() > maxMs) {
    fromAt = new Date(new Date(toAt).getTime() - maxMs).toISOString();
    clamped = true;
  }
  return { from: fromAt, to: toAt, timeZone, clamped, max_days: ANALYTICS_MAX_DAYS };
}

/**
 * The whole dashboard in one authorised read.
 *
 * ONE endpoint rather than seven, because the six panels must describe the
 * same population at the same instant: seven requests resolving `now` seven
 * times can show a summary saying 42 open beside a workload table adding to
 * 43, and the user has no way to know which is right. One window, one `now`,
 * one predicate, one answer.
 */
async function analytics(client, ctx, q = {}) {
  const audience = resolveAudience(ctx, q.audience);
  const visibility = visibilityOf(ctx, audience);
  const window = await resolveAnalyticsWindow(client, q);
  const nowIso = new Date().toISOString();
  const filters = {
    from: window.from,
    to: window.to,
    status: q.status || null,
    priority: q.priority || null,
    // `assigned_to=me` is resolved here, exactly as the list resolves it, so
    // the drill-down link can carry the same parameter through unchanged.
    assignedTo: q.assigned_to === "me" ? ctx.user.user_id : q.assigned_to || null,
    scopeId: q.scope_id || null,
    // 13920. In `filters` and therefore in `analyticsScope`, so picking a file
    // narrows EVERY figure rather than only the panel that groups by it.
    dossierId: q.dossier_id || null,
  };
  const args = { visibility, filters, nowIso, timeZone: window.timeZone };

  const [summary, throughput, overdueAging, workload, cycleTime, blocked, burndown, composition, byFile, byMilestone] =
    await Promise.all([
      repo.analyticsSummary(client, args),
      repo.analyticsThroughput(client, args),
      repo.analyticsOverdueAging(client, args),
      repo.analyticsWorkload(client, args),
      repo.analyticsCycleTime(client, args),
      repo.analyticsBlocked(client, args),
      repo.analyticsBurndown(client, args),
      repo.analyticsComposition(client, args),
      repo.analyticsByFile(client, args),
      // Only when a file is picked: milestone labels repeat across files, so a
      // tenant-wide grouping would add unrelated shipments together under one
      // heading. Skipped rather than computed-and-hidden, because the tenth
      // read on a dashboard nobody asked for it on is still a read.
      filters.dossierId ? repo.analyticsByMilestone(client, args) : Promise.resolve([]),
    ]);

  return {
    window: {
      from: window.from, to: window.to, timezone: window.timeZone,
      clamped: window.clamped, max_days: window.max_days,
    },
    audience,
    audiences: audiencesFor(ctx),
    filters: {
      status: filters.status, priority: filters.priority,
      assigned_to: q.assigned_to || null, scope_id: filters.scopeId,
      dossier_id: filters.dossierId,
    },
    summary: {
      open: summary.open_count,
      overdue: summary.overdue_count,
      blocked: summary.blocked_count,
      completed: summary.completed_count,
      cancelled: summary.cancelled_count,
      total: summary.total_count,
    },
    throughput: throughput.map((r) => ({ day: r.day, completed: r.completed })),
    overdue_aging: fillBuckets(overdueAging, AGE_BUCKETS),
    workload: workload.map((r) => ({
      user_id: r.user_id,
      // Not a raw id in user-facing copy: an unassigned group is a sentence.
      assignee_name: r.assignee_name || (r.user_id ? "Unnamed user" : "Unassigned"),
      open_tasks: r.open_tasks,
      overdue_tasks: r.overdue_tasks,
      blocked_tasks: r.blocked_tasks,
    })),
    cycle_time: {
      buckets: fillBuckets(cycleTime.buckets, AGE_BUCKETS),
      median_days: cycleTime.median_days === null ? null : Number(cycleTime.median_days),
    },
    blocked: blocked.map((r) => ({
      task_id: r.task_id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      due_at: r.due_at,
      assigned_to_name: r.assigned_to_name,
      blocking_count: r.blocking_count,
      blocked_since: r.blocked_since,
      // 13975: the hold's own sentence, when the wait is a blockage rather
      // than (or beside) a prerequisite. Written to be read by this reader,
      // so unlike a prerequisite title it travels.
      blockage_note: r.blockage_note || null,
      blockage_eta: r.blockage_eta || null,
      link_url: entityRouteFor(r.task_id),
    })),
    burndown: burndownSeries(burndown),
    composition: composition.map((r) => ({ status: r.status, priority: r.priority, tasks: r.tasks })),
    // Work per operations file, and — only when one is picked — per stage of
    // its chain (13920). A file whose reference the reader cannot resolve is
    // named as such rather than shown as a bare uuid: `dossier_visible` is a
    // LEFT join, so a link to a file that has since become invisible (deleted,
    // or reverted to DRAFT) leaves `ref` NULL, and "A file you cannot view" is
    // the truthful line — dropping the row would make this panel's counts
    // disagree with the summary above it.
    by_file: byFile.map((r) => ({
      dossier_id: r.dossier_id,
      dossier_ref: r.dossier_ref || null,
      client_name: r.client_name || null,
      label: r.dossier_ref || "A file you cannot view",
      open_tasks: r.open_tasks,
      overdue_tasks: r.overdue_tasks,
      blocked_tasks: r.blocked_tasks,
      completed_tasks: r.completed_tasks,
      total_tasks: r.total_tasks,
    })),
    by_milestone: byMilestone.map((r) => ({
      milestone_instance_id: r.milestone_instance_id,
      // An unlinked task inside a picked file is a real group, not a gap: the
      // work is on the file but on no particular stage of it, and that is the
      // most common shape a link takes.
      label: r.milestone_label || "No milestone",
      status: r.milestone_status || null,
      stage_seq: r.stage_seq === null || r.stage_seq === undefined ? null : Number(r.stage_seq),
      open_tasks: r.open_tasks,
      overdue_tasks: r.overdue_tasks,
      total_tasks: r.total_tasks,
    })),
  };
}

/** The aging/cycle bands, in the order a person reads them. */
const AGE_BUCKETS = ["<1", "1-2", "3-7", "8-30", "30+"];

/**
 * Every band, in order, including the empty ones.
 *
 * A chart whose x-axis changes shape as data arrives is unreadable: "3-7 days"
 * sitting where "30+" was last week makes two screenshots incomparable. Absent
 * bands are zero, not missing.
 */
function fillBuckets(rows, order) {
  const by = new Map(rows.map((r) => [r.bucket, r]));
  return order.map((bucket) => {
    const hit = by.get(bucket);
    return {
      bucket,
      tasks: hit ? hit.tasks : 0,
      ...(hit && hit.avg_days !== undefined ? { avg_days: Number(hit.avg_days) } : {}),
    };
  });
}

/**
 * Turn per-day created/completed counts into the open-backlog line.
 *
 * Derived HERE rather than in the client so the chart and its accessible table
 * are one calculation. Two implementations of a running total is two chances
 * to be off by one day, and the table is the version a screen-reader user
 * gets — it must not be the version that is wrong.
 */
function burndownSeries({ days, open_at_start }) {
  let open = open_at_start || 0;
  return {
    open_at_start: open_at_start || 0,
    days: days.map((d) => {
      open = open + d.created - d.completed;
      return { day: d.day, created: d.created, completed: d.completed, open };
    }),
  };
}

module.exports = {
  VALID_STATUSES, DONE_STATUSES,
  audiencesFor, resolveAudience, visibilityOf, eventVisibilityOf, resolveReminderRows, writeReminders, withLink, deriveLink,
  canSeeTask, canSeeEvent, canManageEvent,
  listTasks, getBoard, getTask, createTask, updateTask, changeStatus, deleteTask,
  addSubtask, patchSubtask, deleteSubtask, addWatcher, removeWatcher, notifyAssignee,
  listEvents, getEvent, createEvent, updateEvent, deleteEvent,
  addParticipant, respondParticipant, removeParticipant,
  mergeTimeline, dayTimeline, deadlinesInRange,
  spawnDue,
  // PR 2 — hierarchy, dependencies, collaboration and operational Analytics.
  assertParentable, assertRecurrenceAnchored, childRollup, redactDependency, dependencyBlocks,
  blockingCount, entityRouteFor, recipientsOf, decorator, shapeBlockage, humanDuration,
  raiseBlockage, resolveBlockage,
  addChildTask, childrenFor, dependenciesFor,
  addDependency, removeDependency, setDependencyOverride,
  pingTask, notifyStatusWatchers,
  analytics, resolveAnalyticsWindow, burndownSeries, fillBuckets,
  ANALYTICS_MAX_DAYS, ANALYTICS_DEFAULT_DAYS, AGE_BUCKETS,
  // 13920. Exported so the two rules it encodes — a stage belongs to its file,
  // and clearing the file clears the stage — are tested directly rather than
  // through a create/update that would need half the module mocked to reach.
  resolveFileLink,
};
