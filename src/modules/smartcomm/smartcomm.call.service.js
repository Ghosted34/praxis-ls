/**
 * Smart Comms Calls (PR-1) — server-authoritative 1:1 call state machine.
 *
 * The server owns the call row: it creates it (RINGING), moves it to IN_CALL,
 * and closes it (ENDED / NO_ANSWER / CANCELLED / DECLINED / BUSY / FAILED).
 * Clients are renderers — a client that lies about the state changes nothing,
 * because every transition is a guarded UPDATE that only matches the status
 * it is leaving, and the timers are re-derived from the ROWS by the sweep
 * (jobs/handlers/comms-call-sweep.js) rather than held in memory. A process
 * restart therefore loses no deadline: the next sweep sees the row and
 * finishes what the dead process was owed.
 *
 * Media never touches this process. This file deals in state and socket
 * signals only; the actual audio is P2P (STUN, TURN as the last tier).
 */
"use strict";

const repo = require("./smartcomm.call.repo");
const events = require("./smartcomm.events");
const { emitEvent, audit, resolveActorId } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");
const realtime = require("../../realtime");
const requestContext = require("../../config/request-context");
const { logger } = require("../../config/logger");

const cref = (id) => "comms_call:" + id;

/** The two timers, as constants on the row rather than in memory. The sweep
 *  (every 15 s) is the only clock; the clients run the same constants for the
 *  UX (29:00 warning, hang-up at 30:00). */
const RING_TIMEOUT_S = 60;
const MAX_CALL_S = 1800;

/** Push to ONE user's room on every replica (best-effort, no-op when the
 *  socket server is down — the row is already committed). The sweep runs
 *  from the worker, where the ambient request context does not exist, so a
 *  slug may be threaded in from the job. */
function rtToUser(userId, event, payload, slugOverride) {
  const slug = slugOverride || requestContext.getTenant();
  if (slug && userId) realtime.publishToUser(slug, userId, event, payload);
}

async function assertMember(client, groupId, userId) {
  const m = await require("./smartcomm.repo").findMember(client, groupId, userId);
  if (!m) throw new AppError("NOT_A_MEMBER", "You are not a member of this channel", 403);
  return m;
}

/**
 * Dial: create the RINGING row and send the ring to the other participant.
 *
 * `groupId` is the DIRECT channel of the two of you — the icon sits on its
 * header — and membership of it is the authorisation. The partner is the
 * channel's other member, resolved server-side: the client names a channel,
 * never a person, so there is no id to get wrong and no way to dial a user
 * who is not in the conversation.
 */
async function createCall(client, { groupId, actor }) {
  await assertMember(client, groupId, actor.user_id);
  const partner = await repo.directPartner(client, { groupId, userId: actor.user_id });
  if (!partner) {
    throw new AppError("NOT_A_DIRECT_CHANNEL", "Calls are available on direct conversations", 422);
  }

  // D8, named: the partial unique indexes are the guard, these SELECTs exist
  // so the error can say WHO is busy. A race between the check and the insert
  // lands in insertCall's 23505 branch and is answered with the same error.
  const callerBusy = await repo.findActiveCall(client, actor.user_id);
  if (callerBusy) {
    throw new AppError("CALLER_BUSY", "You are already on a call", 409);
  }
  const calleeBusy = await repo.findActiveCall(client, partner.user_id);
  if (calleeBusy) {
    throw new AppError("CALLEE_BUSY", "That person is already on a call", 409);
  }

  const { call, busyWith } = await repo.insertCall(client, {
    groupId,
    callerId: actor.user_id,
    calleeId: partner.user_id,
  });
  if (!call) {
    // Lost the race: one of the two just took a call between the check and
    // the insert. Say which one.
    const caller = busyWith && (busyWith.caller_id === actor.user_id || busyWith.callee_id === actor.user_id);
    throw new AppError(
      caller ? "CALLER_BUSY" : "CALLEE_BUSY",
      caller ? "You are already on a call" : "That person is already on a call",
      409,
    );
  }

  await emitEvent(client, {
    eventTypeKey: events.CALL_STARTED,
    moduleKey: events.MODULE,
    entityRef: cref(call.call_id),
    actorUserId: await resolveActorId(client, actor.user_id),
  });
  await audit(client, {
    actorUserId: await resolveActorId(client, actor.user_id),
    action: events.CALL_STARTED,
    moduleKey: events.MODULE,
    entityRef: cref(call.call_id),
    after: call,
  });

  // The ring shows a NAME, not an id — and the callee's app may be a cold
  // start that has not loaded the directory, so the name rides the payload
  // instead of being looked up client-side (where a failed lookup would read
  // as "someone" ringing).
  const { rows: nameRows } = await client.query(
    "SELECT full_name FROM app_user WHERE user_id = $1",
    [actor.user_id],
  );
  const ringPayload = {
    call_id: call.call_id,
    from: { user_id: actor.user_id, name: nameRows[0]?.full_name || null },
    ring_timeout_s: RING_TIMEOUT_S,
  };
  rtToUser(partner.user_id, "call:ringing", ringPayload);
  rtToUser(actor.user_id, "call:ringing_sent", ringPayload);

  logger.info({ callId: call.call_id, caller: actor.user_id, callee: partner.user_id }, "call: RINGING");
  // The dialer's ICE config rides the create response: the call does not need
  // to be "answered" before the caller's engine can start collecting ICE
  // candidates, and a second round trip here is setup latency on every call.
  const { iceConfigFor } = require("./smartcomm.turn.service");
  return { ...call, ice: iceConfigFor(actor.user_id) };
}

/** The callee answers. Must happen while the call is still RINGING — the
 *  five-second grace in the guide is the UI's, not the row's: a ring that
 *  timed out is NO_ANSWER and cannot be answered after. */
async function acceptCall(client, { id, actor }) {
  const call = await repo.findCall(client, id);
  if (!call || (call.caller_id !== actor.user_id && call.callee_id !== actor.user_id)) {
    throw new AppError("NOT_FOUND", "Call not found", 404);
  }
  if (call.caller_id === actor.user_id) {
    throw new AppError("BAD_ROLE", "The caller cannot answer their own call", 422);
  }
  const updated = await repo.transition(client, {
    callId: id,
    fromStatus: "RINGING",
    status: "IN_CALL",
    fields: { connected_at: new Date().toISOString() },
  });
  if (!updated) {
    throw new AppError("CALL_MOVED_ON", "This call has already ended", 409);
  }
  const other = call.caller_id;
  const payload = { call_id: id, by: { user_id: actor.user_id } };
  rtToUser(other, "call:accepted", payload);
  rtToUser(actor.user_id, "call:accepted", payload);
  logger.info({ callId: id }, "call: IN_CALL");
  // The callee's engine starts NOW (the mic opens at answer time), and its
  // ICE config rides this response the same way the dialer's did — one
  // fewer round trip in the second that decides whether the media path
  // forms before the caller gives up.
  const { iceConfigFor } = require("./smartcomm.turn.service");
  return { ...updated, ice: iceConfigFor(actor.user_id) };
}

/** The callee refuses. A hang-up from the CALLEE while still RINGING is the
 *  same act, and `hangup` routes it here. */
async function declineCall(client, { id, actor }) {
  const call = await repo.findCall(client, id);
  if (!call || (call.caller_id !== actor.user_id && call.callee_id !== actor.user_id)) {
    throw new AppError("NOT_FOUND", "Call not found", 404);
  }
  const terminal = call.status === "RINGING" && call.caller_id === actor.user_id
    ? "CANCELLED"
    : "DECLINED";
  const reason = terminal === "CANCELLED" ? "cancelled" : "declined";
  return endCall(client, {
    id,
    fromStatus: "RINGING",
    status: terminal,
    reason,
    notifyEvent: terminal === "CANCELLED" ? "call:cancelled" : "call:declined",
  });
}

/**
 * Hang-up, from either end, at any point.
 *
 * RINGING + caller  → CANCELLED (they gave up ringing)
 * RINGING + callee → DECLINED  (a hang-up that means "no")
 * IN_CALL + anyone → ENDED (hangup)
 * FAILED           → ice_failed is set by the engine report below, not here.
 */
async function hangup(client, { id, actor, reason = "hangup" }) {
  const call = await repo.findCall(client, id);
  if (!call || (call.caller_id !== actor.user_id && call.callee_id !== actor.user_id)) {
    throw new AppError("NOT_FOUND", "Call not found", 404);
  }
  if (call.status === "RINGING") {
    return declineCall(client, { id, actor });
  }
  if (call.status === "IN_CALL") {
    return endCall(client, { id, fromStatus: "IN_CALL", status: "ENDED", reason });
  }
  throw new AppError("CALL_MOVED_ON", "This call has already ended", 409);
}

/** The client's engine exhausted ICE: media never connected. Only legal
 *  while the call is still RINGING or IN_CALL — a call that already ENDED is
 *  history, and "it failed" is not a second ending. */
async function reportFailure(client, { id, actor }) {
  const call = await repo.findCall(client, id);
  if (!call || (call.caller_id !== actor.user_id && call.callee_id !== actor.user_id)) {
    throw new AppError("NOT_FOUND", "Call not found", 404);
  }
  const fromStatus = call.status;
  if (fromStatus !== "RINGING" && fromStatus !== "IN_CALL") {
    throw new AppError("CALL_MOVED_ON", "This call has already ended", 409);
  }
  return endCall(client, { id, fromStatus, status: "FAILED", reason: "ice_failed" });
}

/**
 * Terminal transition + the notification both ends need.
 *
 * The guarded UPDATE is the whole concurrency story: two racers (a hang-up
 * and the 30-minute sweep, a decline and a timeout) both call this, exactly
 * one matches `fromStatus`, and the loser gets CALL_MOVED_ON — which the
 * controller answers 409, the client reads as "it ended first, sync state",
 * and re-fetches. No locks, no second chance for a stale transition.
 */
async function endCall(client, { id, fromStatus, status, reason, notifyEvent, tenantSlug = null }) {
  const before = await repo.findCall(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Call not found", 404);

  const fields = { end_reason: reason };
  if (status === "ENDED" || status === "FAILED") {
    fields.ended_at = new Date().toISOString();
    fields.duration_seconds = durationSeconds(before, status === "IN_CALL" ? reason : null);
  }
  const updated = await repo.transition(client, { callId: id, fromStatus, status, fields });
  if (!updated) {
    throw new AppError("CALL_MOVED_ON", "This call has already ended", 409);
  }

  await emitEvent(client, {
    eventTypeKey: status === "ENDED" ? events.CALL_ENDED : events.CALL_CLOSED,
    moduleKey: events.MODULE,
    entityRef: cref(id),
    actorUserId: null,
  });
  await audit(client, {
    actorUserId: null,
    action: status === "ENDED" ? events.CALL_ENDED : events.CALL_CLOSED,
    moduleKey: events.MODULE,
    entityRef: cref(id),
    before,
    after: updated,
  });

  const payload = {
    call_id: id,
    reason,
    status,
    duration_seconds: updated.duration_seconds ?? null,
    ended_at: updated.ended_at ?? null,
  };
  rtToUser(before.caller_id, notifyEvent || "call:ended", payload, tenantSlug);
  rtToUser(before.callee_id, notifyEvent || "call:ended", payload, tenantSlug);
  logger.info({ callId: id, status, reason }, "call: terminal");
  return updated;
}

/**
 * Duration for a finished call. The row's `connected_at` is the honest start
 * (a call that rang 40 s and talked 30 min lasted 30 min, not 30:40). A call
 * that never connected has none, and the sweep's max_duration end uses the
 * full cap rather than pretending to measure it.
 */
function durationSeconds(call, reason) {
  if (!call.connected_at) return reason === "max_duration" ? MAX_CALL_S : 0;
  const end = reason === "max_duration"
    ? new Date(new Date(call.connected_at).getTime() + MAX_CALL_S * 1000)
    : new Date();
  return Math.max(0, Math.min(MAX_CALL_S, Math.round((end - new Date(call.connected_at)) / 1000)));
}

/**
 * The sweep (jobs/handlers/comms-call-sweep.js) — the ONLY clock.
 *
 * Per tenant+env, per tick: ring calls older than RING_TIMEOUT_S become
 * NO_ANSWER, and in-call calls older than MAX_CALL_S become
 * ENDED(max_duration). Each is a guarded transition, so a sweep that races a
 * real hang-up loses silently, and a deployment with several API/worker
 * replicas can never end one call twice. Returns how many it moved, so a
 * quiet tick is a 0, not an absence.
 */
async function sweep(client, { tenantSlug = null } = {}) {
  const due = await client.query(
    `SELECT * FROM comms_call
     WHERE (status = 'RINGING' AND started_at <= now() - make_interval(secs => $1::int))
        OR (status = 'IN_CALL' AND connected_at <= now() - make_interval(secs => $2::int))`,
    [RING_TIMEOUT_S, MAX_CALL_S],
  );
  let moved = 0;
  for (const call of due.rows) {
    const result = await sweepOne(client, call, tenantSlug);
    if (result) moved += 1;
  }
  return { moved };
}

async function sweepOne(client, call, tenantSlug) {
  const target = call.status === "RINGING"
    ? { status: "NO_ANSWER", reason: "no_answer", notifyEvent: "call:no_answer" }
    : { status: "ENDED", reason: "max_duration", notifyEvent: "call:ended" };
  try {
    await endCall(client, {
      id: call.call_id,
      fromStatus: call.status,
      tenantSlug,
      ...target,
    });
    return true;
  } catch (err) {
    // The hang-up (or the other replica's sweep) landed first: the row is
    // terminal either way, and the 409 is the guarded transition telling us
    // the other writer won. Anything else is a real error — let it retry.
    if (err && err.status === 409) return false;
    throw err;
  }
}

/** Fresh ICE config for a call's participant — the credential is scoped to
 *  the USER (their id is in the username), so a refresh mid-call never
 *  reuses the other participant's, and neither can replay the other's. */
async function turnFor(client, { id, actor }) {
  const ok = await repo.isParticipant(client, { callId: id, userId: actor.user_id });
  if (!ok) throw new AppError("NOT_FOUND", "Call not found", 404);
  const { iceConfigFor } = require("./smartcomm.turn.service");
  return iceConfigFor(actor.user_id);
}

// ── Reads ──────────────────────────────────────────────────────────────────
async function listCalls(client, actor) {
  return repo.listCallsForUser(client, actor.user_id);
}

async function getCall(client, { id, actor }) {
  const ok = await repo.isParticipant(client, { callId: id, userId: actor.user_id });
  if (!ok) throw new AppError("NOT_FOUND", "Call not found", 404);
  const { rows } = await client.query(
    `SELECT c.*, g.name AS channel_name,
            cu.full_name AS caller_name,
            bu.full_name AS callee_name
     FROM comms_call c
     JOIN comms_group g ON g.group_id = c.group_id
     JOIN app_user cu ON cu.user_id = c.caller_id
     JOIN app_user bu ON bu.user_id = c.callee_id
     WHERE c.call_id = $1`,
    [id],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Call not found", 404);
  return rows[0];
}

module.exports = {
  RING_TIMEOUT_S,
  MAX_CALL_S,
  createCall,
  acceptCall,
  declineCall,
  hangup,
  reportFailure,
  sweep,
  listCalls,
  getCall,
  turnFor,
};
