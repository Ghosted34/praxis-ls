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
/** How long BOTH participants may be socket-less before an in-call call ends
 *  itself `disconnected` (field note FN-1). Beyond the matrix's 20 s
 *  airplane row (which drops one device — the other is still online), well
 *  under the 30-minute cap that remains the backstop if the registry is down. */
const LIVENESS_OFFLINE_S = 60;
/** Dial limits (audit C6). Per caller is the route's limiter; per callee is
 *  here, where the callee is known: a colleague cannot be rung more than this
 *  in a minute, by anyone. */
const DIAL_LIMITS = Object.freeze({ perCalleePerMinute: 6 });

/** Push to ONE user's room for the call's env, on every replica
 *  (best-effort; the row is already committed). Callers pass the env the call
 *  lives in; a request or job context supplies it otherwise (audit A9). */
function rtToUser(userId, event, payload, { slug = null, env = null } = {}) {
  const tenant = slug || requestContext.getTenant();
  const scope = env || requestContext.getEnv();
  if (tenant && userId) realtime.publishToUser(tenant, scope, userId, event, payload);
}

/**
 * Is the recording half of calls on for this tenant (PR-2, decision row 2)?
 *
 * Read here rather than in the client so BOTH ends learn it from the same place
 * at the same moment: the caller from its dial response, the callee from its
 * ring payload. A callee whose app never asks the question would show no consent
 * banner over a call that IS being recorded, which is the one failure this must
 * not have.
 *
 * Fails CLOSED (false) on any error: an unreadable flag must not put a banner
 * over a call that is not being recorded, and the recorder then simply does not
 * arm. Never throws — a call is not cancelled because a flag could not be read.
 */
async function recordingEnabled(client) {
  try {
    const { rows } = await client.query(
      "SELECT state FROM feature_state WHERE feature_key = $1",
      ["call_recording"],
    );
    return !!rows[0] && rows[0].state === "on";
  } catch (err) {
    logger.warn({ err }, "call: could not read the recording flag");
    return false;
  }
}

/**
 * The tenant's call settings (PR-3, §7.1) — the rows 14020 and 14060 seed.
 *
 * Read through `setting` rather than a column on some new table because that is
 * where every other tenant-level default lives (§3.5), and read HERE rather
 * than in the client for the same reason the recording flag is: both ends must
 * learn it from one place at one moment.
 *
 * FAILS OPEN TO THE PRODUCT DEFAULTS, and that is the opposite choice from
 * `recordingEnabled` above — deliberately. The recording flag fails closed
 * because a banner must not appear over a call that is not being recorded; a
 * NOISE FILTER is the other way round: if the settings table cannot be read the
 * honest answer is the shipped default (on, 30 days), and refusing to ring, to
 * filter, or to sweep would turn a settings blip into an outage of the feature
 * the settings belong to. Every value is clamped, because a setting is input:
 * a 900-day retention window is a typo, not a policy.
 */
async function callSettings(client) {
  const defaults = {
    recording_retention_days: 30,
    // Off until verified on devices (audit E5).
    noise_suppression: false,
    // comms.call_privacy (audit C13): relay-only calls, off by default.
    relay_only: false,
  };
  try {
    const { rows } = await client.query(
      `SELECT key, value FROM setting WHERE section = 'comms' AND key = ANY($1)`,
      [["call_recording", "call_noise_suppression", "call_privacy"]],
    );
    for (const row of rows) {
      if (row.key === "call_recording" && row.value && row.value.retention_days !== undefined) {
        const days = Math.trunc(Number(row.value.retention_days));
        if (Number.isFinite(days)) defaults.recording_retention_days = Math.min(Math.max(days, 1), 365);
      }
      if (row.key === "call_noise_suppression" && row.value && row.value.enabled !== undefined) {
        defaults.noise_suppression = row.value.enabled === true || row.value.enabled === "true";
      }
      if (row.key === "call_privacy" && row.value) {
        defaults.relay_only = row.value.relay_only === true || row.value.relay_only === "true";
      }
    }
  } catch (err) {
    logger.warn({ err }, "call: could not read the comms call settings — using the defaults");
  }
  return defaults;
}

async function assertMember(client, groupId, userId) {
  const m = await require("./smartcomm.repo").findMember(client, groupId, userId);
  if (!m) throw new AppError("NOT_A_MEMBER", "You are not a member of this channel", 403);
  return m;
}

/**
 * The per-callee dial counter (audit C6), one Redis key per callee per
 * minute. Fails open: a Redis outage must not stop calls, and the route's
 * per-caller limiter still holds.
 */
async function assertCalleeNotFlooded(calleeId, env) {
  const tenant = requestContext.getTenant();
  let count = 0;
  try {
    const redis = require("../../config/redis").getClient();
    const key = `praxis:comms:dialled:${tenant}:${env}:${calleeId}`;
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);
  } catch (err) {
    logger.warn({ err }, "call: dial counter unavailable — per-callee limit skipped");
    return;
  }
  if (count > DIAL_LIMITS.perCalleePerMinute) {
    // Generic on purpose: naming the callee would tell this caller that other
    // people have been calling them.
    throw new AppError("RATE_LIMITED", "Too many calls just now. Try again in a minute.", 429);
  }
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
async function createCall(client, { groupId, actor, tenantMeta = null, env = "live" }) {
  await assertMember(client, groupId, actor.user_id);
  const partner = await repo.directPartner(client, { groupId, userId: actor.user_id });
  if (!partner) {
    if (await repo.isDirectChannel(client, groupId)) {
      throw new AppError("CALLEE_INACTIVE", "That person's account is not active", 422);
    }
    throw new AppError("NOT_A_DIRECT_CHANNEL", "Calls are available on direct conversations", 422);
  }
  await assertCalleeNotFlooded(partner.user_id, env);

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

  // The relay token is written with the row, so the dial response can mint
  // a credential even if the callee declines before it is sent (audit C2).
  const { newCallToken } = require("./smartcomm.turn.service");
  const { call, busyWith } = await repo.insertCall(client, {
    groupId,
    callerId: actor.user_id,
    calleeId: partner.user_id,
    turnToken: newCallToken(),
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
  const callerName = await fullName(client, actor.user_id);
  const recording = await recordingEnabled(client);
  const settings = await callSettings(client);
  const ringPayload = {
    call_id: call.call_id,
    group_id: call.group_id,
    from: { user_id: actor.user_id, name: callerName },
    ring_timeout_s: RING_TIMEOUT_S,
    // The callee's consent banner depends on this arriving WITH the ring: a
    // banner that appears a second into the call is a banner that was not there
    // when the call started.
    recording_enabled: recording,
    // PR-3: the ring is also where the tenant's noise-filter default arrives,
    // for the same reason — an engine that starts unfiltered and is told about
    // the filter 300 ms later has already sent 300 ms of forklift down the
    // wire, and the yard is exactly where that matters.
    noise_suppression: settings.noise_suppression,
  };
  rtToUser(partner.user_id, "call:ringing", ringPayload, { env });
  // The caller's other devices: "calling X from another device".
  rtToUser(actor.user_id, "call:ringing_sent", {
    ...ringPayload,
    to: { user_id: partner.user_id, name: await fullName(client, partner.user_id) },
  }, { env });

  // The ring push goes to every device of the callee NOW, not after an ack
  // window (audit A12), through a job so a restart mid-ring loses nothing; the
  // job queues its own re-alerts.
  void enqueueRingPush({ callId: call.call_id, tenantMeta, env, alert: 0 });

  logger.info({ callId: call.call_id, caller: actor.user_id, callee: partner.user_id }, "call: RINGING");
  // The dialer's ICE config rides the create response, so its engine can
  // gather candidates while the callee's phone rings.
  return {
    ...publicCall(call),
    ice: await iceFor(client, call, settings),
    recording_enabled: recording,
    noise_suppression: settings.noise_suppression,
  };
}

/** The callee answers. Must happen while the call is still RINGING — the
 *  five-second grace in the guide is the UI's, not the row's: a ring that
 *  timed out is NO_ANSWER and cannot be answered after. */
async function acceptCall(client, { id, actor, tenantMeta = null, env = "live" }) {
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
  rtToUser(other, "call:accepted", payload, { env });
  // The callee's own room too: their other devices stop ringing (audit E8).
  rtToUser(actor.user_id, "call:accepted", payload, { env });
  void enqueueRingCancel({ callId: id, outcome: "answered", tenantMeta, env });
  logger.info({ callId: id }, "call: IN_CALL");
  // The callee's engine starts now, so its ICE config rides this response.
  const settings = await callSettings(client);
  return {
    ...publicCall(updated),
    ice: await iceFor(client, updated, settings),
    recording_enabled: await recordingEnabled(client),
    noise_suppression: settings.noise_suppression,
  };
}

/** The callee refuses. A hang-up from the CALLEE while still RINGING is the
 *  same act, and `hangup` routes it here. */
async function declineCall(client, { id, actor, tenantMeta = null, env = "live" }) {
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
    tenantMeta,
    env,
    actorUserId: actor.user_id,
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
async function hangup(client, { id, actor, tenantMeta = null, env = "live" }) {
  const call = await repo.findCall(client, id);
  if (!call || (call.caller_id !== actor.user_id && call.callee_id !== actor.user_id)) {
    throw new AppError("NOT_FOUND", "Call not found", 404);
  }
  if (call.status === "RINGING") {
    return declineCall(client, { id, actor, tenantMeta, env });
  }
  if (call.status === "IN_CALL") {
    // The reason is the server's (audit B9): a person hanging up is a
    // hangup, whatever the client claims.
    return endCall(client, {
      id, fromStatus: "IN_CALL", status: "ENDED", reason: "hangup", tenantMeta, env, actorUserId: actor.user_id,
    });
  }
  throw new AppError("CALL_MOVED_ON", "This call has already ended", 409);
}

/** The client's engine exhausted ICE: media never connected. Only legal
 *  while the call is still RINGING or IN_CALL — a call that already ENDED is
 *  history, and "it failed" is not a second ending. */
async function reportFailure(client, { id, actor, tenantMeta = null, env = "live" }) {
  const call = await repo.findCall(client, id);
  if (!call || (call.caller_id !== actor.user_id && call.callee_id !== actor.user_id)) {
    throw new AppError("NOT_FOUND", "Call not found", 404);
  }
  const fromStatus = call.status;
  if (fromStatus !== "RINGING" && fromStatus !== "IN_CALL") {
    throw new AppError("CALL_MOVED_ON", "This call has already ended", 409);
  }
  return endCall(client, {
    id, fromStatus, status: "FAILED", reason: "ice_failed", tenantMeta, env, actorUserId: actor.user_id,
  });
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
async function endCall(client, {
  id, fromStatus, status, reason, notifyEvent, tenantSlug = null, tenantMeta = null, env = "live",
  actorUserId = null,
}) {
  const before = await repo.findCall(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Call not found", 404);

  const fields = { end_reason: reason };
  if (status === "ENDED" || status === "FAILED") {
    fields.ended_at = new Date().toISOString();
    fields.duration_seconds = durationSeconds(before);
  }
  const updated = await repo.transition(client, { callId: id, fromStatus, status, fields });
  if (!updated) {
    throw new AppError("CALL_MOVED_ON", "This call has already ended", 409);
  }

  // The person who acted (audit B8); null only for the sweep.
  const actorId = actorUserId ? await resolveActorId(client, actorUserId) : null;
  await emitEvent(client, {
    eventTypeKey: status === "ENDED" ? events.CALL_ENDED : events.CALL_CLOSED,
    moduleKey: events.MODULE,
    entityRef: cref(id),
    actorUserId: actorId,
  });
  await audit(client, {
    actorUserId: actorId,
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
  rtToUser(before.caller_id, notifyEvent || "call:ended", payload, { slug: tenantSlug, env });
  rtToUser(before.callee_id, notifyEvent || "call:ended", payload, { slug: tenantSlug, env });
  logger.info({ callId: id, status, reason }, "call: terminal");
  // A ring that ends unanswered: replace it on the callee's devices (A7).
  if (fromStatus === "RINGING") {
    void enqueueRingCancel({ callId: id, outcome: CANCEL_OUTCOMES[status] || "ended", tenantMeta, env });
  }

  // The record half (audit PR-2): each part is transcribed as it uploads and
  // each side declares when it is done, which starts finalise. This delayed
  // job is the deadline for a side that never declares. Fire-and-forget: the
  // transition has committed, and a queue outage must not fail the hang-up.
  if (updated && (status === "ENDED" || (status === "FAILED" && updated.connected_at))) {
    await require("./smartcomm.call.pipeline.service").scheduleDeadline({ callId: id, tenantMeta, env });
  }
  return publicCall(updated);
}

/**
 * Talk time: from `connected_at` (a call that rang 40 s and talked 30 min
 * lasted 30 min), clamped to the cap, so the sweep's max_duration end records
 * exactly 1800.
 */
function durationSeconds(call) {
  if (!call.connected_at) return 0;
  const measured = Math.round((Date.now() - new Date(call.connected_at).getTime()) / 1000);
  return Math.max(0, Math.min(MAX_CALL_S, measured));
}

/**
 * The sweep (jobs/handlers/comms-call-sweep.js) — the ONLY clock.
 *
 * Per tenant+env, per tick: ring calls older than RING_TIMEOUT_S become
 * NO_ANSWER, and in-call calls older than MAX_CALL_S become
 * ENDED(max_duration). In-call calls whose two devices have both been gone
 * for LIVENESS_OFFLINE_S become ENDED(disconnected) — the row's fourth way to
 * end (sweepLiveness, FN-1). Each is a guarded transition, so a sweep that
 * races a real hang-up loses silently, and a deployment with several API/
 * worker replicas can never end one call twice. Returns how many it moved, so
 * a quiet tick is a 0, not an absence.
 */
async function sweep(client, { tenantSlug = null, tenantMeta = null, env = "live" } = {}) {
  const due = await client.query(
    `SELECT * FROM comms_call
     WHERE (status = 'RINGING' AND started_at <= now() - make_interval(secs => $1::int))
        OR (status = 'IN_CALL' AND connected_at <= now() - make_interval(secs => $2::int))`,
    [RING_TIMEOUT_S, MAX_CALL_S],
  );
  let moved = 0;
  for (const call of due.rows) {
    const result = await sweepOne(client, call, tenantSlug, { tenantMeta, env });
    if (result) moved += 1;
  }
  // The fourth way to end (FN-1): both devices gone. Runs on a quiet tick too
  // — an abandoned call has no deadline of its own; this check IS its
  // deadline.
  moved += await sweepLiveness(client, { tenantSlug, tenantMeta, env });
  return { moved };
}

async function sweepOne(client, call, tenantSlug, { tenantMeta = null, env = "live" } = {}) {
  const target = call.status === "RINGING"
    ? { status: "NO_ANSWER", reason: "no_answer", notifyEvent: "call:no_answer" }
    : { status: "ENDED", reason: "max_duration", notifyEvent: "call:ended" };
  try {
    await endCall(client, {
      id: call.call_id,
      fromStatus: call.status,
      tenantSlug,
      tenantMeta,
      env,
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

/**
 * The row's fourth way to end (field note FN-1).
 *
 * A call ends by client report, by the 60 s ring deadline, or by the
 * 30-minute cap. The fourth way is what the first real-hardware run exposed:
 * BOTH devices gone — the window closed, the phone's OS killed the
 * backgrounded page — nobody is left to report, and the cap would hold the
 * call IN_CALL, and both users BUSY, for up to 30 minutes.
 *
 * The rule: a participant is "gone" while their sockets are absent from the
 * online registry (realtime/index.js keeps one SET per tenant+env, one member
 * per socket). An IN_CALL call whose two participants have both been gone for
 * LIVENESS_OFFLINE_S ends ENDED(disconnected). The 60 s sits beyond the
 * matrix's airplane row (I3 drops ONE device for 20 s — the other is still in
 * the set, so the rule cannot fire). Every read here fails toward "leave it
 * alone": liveness must never be what ends a healthy call, so a registry
 * outage skips the pass and the 30-minute cap remains the backstop.
 */
async function sweepLiveness(client, { tenantSlug = null, tenantMeta = null, env = "live" } = {}) {
  if (!tenantSlug) return 0;
  let redis;
  try {
    redis = require("../../config/redis").getClient();
    if (!redis) return 0;
  } catch (err) {
    logger.warn({ err, tenantSlug }, "call liveness: redis unavailable — the 30-minute cap remains the backstop");
    return 0;
  }
  let rows;
  try {
    ({ rows } = await client.query(
      "SELECT call_id, caller_id, callee_id FROM comms_call WHERE status = 'IN_CALL'",
    ));
  } catch (err) {
    logger.warn({ err, tenantSlug }, "call liveness: row scan failed — skipping this tick");
    return 0;
  }
  if (!rows.length) return 0;

  const onlineKey = `praxis:comms:online:${tenantSlug}:${env}`;
  const offlineKey = `praxis:comms:call-offline:${tenantSlug}:${env}`;
  let members;
  try {
    members = await redis.smembers(onlineKey);
  } catch (err) {
    logger.warn({ err, tenantSlug }, "call liveness: could not read the online set — skipping this tick");
    return 0;
  }
  const online = new Set(members.map((m) => String(m).split(":")[0]));
  const nowS = Math.floor(Date.now() / 1000);
  const offlineSince = {};
  try {
    const entries = await redis.zrange(offlineKey, 0, -1, "WITHSCORES");
    for (let i = 0; i + 1 < entries.length; i += 2) offlineSince[entries[i]] = Number(entries[i + 1]);
  } catch {
    /* @silent:storage — an unreadable book is read as "nobody proven gone yet". */
  }

  let moved = 0;
  for (const call of rows) {
    for (const uid of [call.caller_id, call.callee_id]) {
      if (online.has(uid)) {
        if (offlineSince[uid] !== undefined) delete offlineSince[uid];
        try { await redis.zrem(offlineKey, uid); } catch { /* @silent:storage */ }
      } else if (offlineSince[uid] === undefined) {
        offlineSince[uid] = nowS;
        try { await redis.zadd(offlineKey, nowS, uid); } catch { /* @silent:storage */ }
      }
    }
    const outCaller = offlineSince[call.caller_id];
    const outCallee = offlineSince[call.callee_id];
    if (outCaller === undefined || outCallee === undefined) continue;
    // BOTH gone for the full window (audit B2: `min` ended the call when only
    // one had been gone that long and the other had just blinked).
    if (Math.max(outCaller, outCallee) > nowS - LIVENESS_OFFLINE_S) continue;
    try {
      const ended = await endCall(client, {
        id: call.call_id,
        fromStatus: "IN_CALL",
        status: "ENDED",
        reason: "disconnected",
        notifyEvent: "call:ended",
        tenantSlug,
        tenantMeta,
        env,
      });
      if (ended) {
        moved += 1;
        try { await redis.zrem(offlineKey, call.caller_id, call.callee_id); } catch { /* @silent:storage */ }
      }
    } catch (err) {
      if (err && err.status === 409) continue; // a hang-up won the race; the row is terminal
      throw err;
    }
  }
  return moved;
}

/* ── The ring on every device (PR-4; O4, audit A7, A12, A14) ─────────────── */

/** Re-alert cadence while the row still rings, and how many re-alerts. */
const RING_REALERT_MS = 15_000;
const RING_MAX_REALERTS = 4;
/** A ring's vibration on the devices that vibrate. */
const RING_VIBRATE = Object.freeze([600, 250, 600, 250, 600]);

/** The channels an ack may name (the metric's closed vocabulary; 14020 has
 *  no CHECK on the column). */
const RING_CHANNELS = new Set(["socket", "notification", "push"]);

/** A terminal status reached from RINGING, as the cancel push says it. */
const CANCEL_OUTCOMES = Object.freeze({ DECLINED: "declined", CANCELLED: "missed", NO_ANSWER: "missed", FAILED: "ended" });

async function fullName(client, userId) {
  const { rows } = await client.query("SELECT full_name FROM app_user WHERE user_id = $1", [userId]);
  return rows[0]?.full_name || null;
}

/** Seconds left in the ring window, by this process's clock. */
function ringSecondsLeft(call, now = Date.now()) {
  return Math.ceil((new Date(call.started_at).getTime() + RING_TIMEOUT_S * 1000 - now) / 1000);
}

function enqueueRingJob(name, data, opts) {
  const { enqueue } = require("../../jobs/queue-producer");
  return enqueue("comms-call-ring-escalate", name, data, { attempts: 1, removeOnComplete: true, removeOnFail: 50, ...opts });
}

/**
 * Queue one ring push: alert 0 at once, each re-alert RING_REALERT_MS after
 * the one before. The jobId is per call and alert, so a retried dial cannot
 * queue two. Never throws: the socket ring has gone out either way.
 */
async function enqueueRingPush({ callId, tenantMeta, env = "live", alert = 0 }) {
  if (!callId || !tenantMeta) return null;
  try {
    return await enqueueRingJob("ring", { callId, tenantMeta, env, alert }, {
      jobId: `callring-${callId}-${alert}`,
      delay: alert === 0 ? 0 : RING_REALERT_MS,
    });
  } catch (err) {
    logger.warn({ err, callId, alert }, "call: could not queue the ring push");
    return null;
  }
}

/** Queue the cancel push for a ring that ended. Never throws. */
async function enqueueRingCancel({ callId, outcome, tenantMeta, env = "live" }) {
  if (!callId || !tenantMeta) return null;
  try {
    return await enqueueRingJob("cancel", { callId, outcome, tenantMeta, env }, { jobId: `callcancel-${callId}` });
  } catch (err) {
    logger.warn({ err, callId }, "call: could not queue the ring cancel");
    return null;
  }
}

/**
 * A device says the ring landed, and on which channel: the ring-channel
 * metric (§7.4.4), first ack wins (guarded UPDATE). It stops nothing, on this
 * device or any other: every device keeps ringing until the call is answered,
 * declined or ends (audit A12).
 */
async function ackRing(client, { id, actor, channel = "socket" }) {
  const call = await repo.findCall(client, id);
  if (!call || (call.caller_id !== actor.user_id && call.callee_id !== actor.user_id)) {
    throw new AppError("NOT_FOUND", "Call not found", 404);
  }
  if (call.status !== "RINGING") return null;
  if (call.caller_id === actor.user_id) return null;
  const safeChannel = RING_CHANNELS.has(channel) ? channel : "socket";
  const updated = await repo.markRingAck(client, { callId: id, channel: safeChannel });
  if (updated) logger.info({ callId: id, channel: safeChannel }, "call: ring acked");
  return updated;
}

/**
 * One ring push (the job's body): to EVERY device of the callee, while the
 * row still rings. Each alert is claimed on the row before it is sent, so a
 * queue retry cannot send it twice; the next re-alert is queued before the
 * send, while the window has room for it.
 */
async function ringPush(client, { callId, alert = 0, tenantSlug = null, tenantMeta = null, env = "live" }) {
  const call = await repo.findCall(client, callId);
  if (!call) return { pushed: false, reason: "call not found" };
  if (call.status !== "RINGING") return { pushed: false, reason: "no longer ringing" };
  const left = ringSecondsLeft(call);
  if (left <= 0) return { pushed: false, reason: "ring window over" };
  const claimed = await repo.claimRingAlert(client, { callId, alert });
  if (!claimed) return { pushed: false, reason: "already sent" };
  if (alert < RING_MAX_REALERTS && left * 1000 > RING_REALERT_MS) {
    void enqueueRingPush({ callId, tenantMeta, env, alert: alert + 1 });
  }

  const callerName = await fullName(client, call.caller_id);
  const expiresAt = new Date(new Date(call.started_at).getTime() + RING_TIMEOUT_S * 1000).toISOString();
  const push = require("../../shared/push/push.service");
  // English here like every server string; the service worker renders the
  // body and actions in the device's language. The title is the caller.
  const result = await push.sendToUser(client, {
    user_id: call.callee_id,
    title: callerName || "Praxis LS",
    body: "Incoming call",
    url: `/comms?ring=${call.call_id}`,
    tag: `call:${call.call_id}`,
    renotify: true,
    requireInteraction: true,
    vibrate: [...RING_VIBRATE],
    urgency: "high",
    // Never delivered after the ring is over.
    ttl: left,
    timestamp: new Date(call.started_at).getTime(),
    actions: [
      { action: "accept", title: "Answer" },
      { action: "decline", title: "Decline" },
    ],
    data: {
      kind: "call_ring",
      call_id: call.call_id,
      group_id: call.group_id,
      caller_id: call.caller_id,
      caller_name: callerName,
      expires_at: expiresAt,
      alert,
    },
  });
  logger.info(
    { callId: call.call_id, alert, tenantSlug: tenantSlug || null, env, sent: result && result.sent, reason: result && result.reason },
    "call: ring pushed",
  );
  return { pushed: true, alert, delivery: result };
}

const CANCEL_TITLES = Object.freeze({
  answered: () => "Answered on another device",
  declined: () => "Call ended",
  missed: (name) => (name ? `Missed call — ${name}` : "Missed call"),
  ended: () => "Call ended",
});

/**
 * The ring is over: replace it on the callee's devices (same tag) with a
 * quiet, non-sticky line. A push that shows nothing breaks the browsers'
 * user-visible rule, and Safari revokes subscriptions for it, so the cancel
 * is a real notification (the service worker localises it). Sent only when
 * a ring push went out: otherwise there is nothing to replace.
 */
async function ringCancel(client, { callId, outcome = "ended", tenantSlug = null }) {
  const call = await repo.findCall(client, callId);
  if (!call) return { pushed: false, reason: "call not found" };
  if (!call.ring_push_sent_at) return { pushed: false, reason: "no ring was pushed" };
  const safeOutcome = CANCEL_TITLES[outcome] ? outcome : "ended";
  const callerName = await fullName(client, call.caller_id);
  const push = require("../../shared/push/push.service");
  const result = await push.sendToUser(client, {
    user_id: call.callee_id,
    title: CANCEL_TITLES[safeOutcome](callerName),
    body: "",
    url: `/comms?channel=${call.group_id}`,
    tag: `call:${call.call_id}`,
    renotify: false,
    requireInteraction: false,
    urgency: "high",
    // A missed call is still worth reading hours later; the rest only need
    // to reach a device that got the ring.
    ttl: safeOutcome === "missed" ? 86_400 : 3_600,
    timestamp: Date.now(),
    data: {
      kind: "call_cancel",
      call_id: call.call_id,
      group_id: call.group_id,
      outcome: safeOutcome,
      caller_name: callerName,
    },
  });
  logger.info({ callId, outcome: safeOutcome, tenantSlug: tenantSlug || null, sent: result && result.sent }, "call: ring cancelled");
  return { pushed: true, delivery: result };
}

/** GET /calls/ringing — the calls ringing for me now (audit A13). */
async function listRinging(client, actor) {
  const rows = await repo.listRingingForUser(client, { userId: actor.user_id, windowS: RING_TIMEOUT_S });
  if (!rows.length) return [];
  const recording = await recordingEnabled(client);
  const settings = await callSettings(client);
  return rows.map((r) => ({
    ...publicCall(r),
    caller_name: r.caller_name || null,
    ring_seconds_left: Number(r.ring_seconds_left) || 0,
    recording_enabled: recording,
    noise_suppression: settings.noise_suppression,
  }));
}

/** POST /calls/test-ring — a ring-shaped push to THIS device only (A15). */
async function testRing(client, { actor, endpoint }) {
  const push = require("../../shared/push/push.service");
  return push.sendToUser(client, {
    user_id: actor.user_id,
    endpoint,
    title: "Test ring",
    body: "This device can ring for calls.",
    url: "/settings/calls",
    tag: "call:test",
    renotify: true,
    requireInteraction: false,
    vibrate: [...RING_VIBRATE],
    urgency: "high",
    ttl: 60,
    timestamp: Date.now(),
    data: { kind: "call_test" },
  });
}

/** The tenant's call settings, for the sweeps and the clients that need the
 *  numbers rather than the payload. */
async function settingsFor(client) {
  return callSettings(client);
}

/**
 * Relay credentials and the TTL they carry (audit C2). Minted only for a call
 * that is RINGING or IN_CALL: an ended call's id is worth nothing to a relay.
 * The TTL is what is left of the call plus a minute. A ringing call can still
 * become a full-length one, so it gets the rest of the ring plus the cap.
 */
function credentialTtl(call, now = Date.now()) {
  const since = (iso) => (now - new Date(iso).getTime()) / 1000;
  const remaining = call.status === "IN_CALL" && call.connected_at
    ? MAX_CALL_S - since(call.connected_at)
    : RING_TIMEOUT_S - since(call.started_at) + MAX_CALL_S;
  return Math.max(0, Math.ceil(remaining)) + 60;
}

/** ICE config for a call the caller of this function has just seen live
 *  (created, answered, or checked by turnFor). The token comes from the row;
 *  only a call dialled before 14060 has none, and gets one here. */
async function iceFor(client, call, settings = null) {
  const { iceConfigFor, newCallToken } = require("./smartcomm.turn.service");
  const token = call.turn_token
    || await repo.ensureTurnToken(client, { callId: call.call_id, token: newCallToken() });
  if (!token) throw new AppError("NOT_FOUND", "Call not found", 404);
  const { relay_only: relayOnly } = settings || await callSettings(client);
  return iceConfigFor({ token, ttlSeconds: credentialTtl(call), relayOnly });
}

/** GET /calls/:id/turn — a refreshed credential for a participant of a live
 *  call. Anything else (a stranger, an ended call) is the same 404. */
async function turnFor(client, { id, actor }) {
  const call = await repo.findCall(client, id);
  if (!call || (call.caller_id !== actor.user_id && call.callee_id !== actor.user_id)
      || (call.status !== "RINGING" && call.status !== "IN_CALL")) {
    throw new AppError("NOT_FOUND", "Call not found", 404);
  }
  return iceFor(client, call);
}

/** A call row as clients read it: without the relay token, and without the
 *  stored transcription error, which can hold vendor text (audit C11). */
function publicCall(row) {
  if (!row) return row;
  const rest = { ...row };
  delete rest.turn_token;
  delete rest.transcription_error;
  return rest;
}

// ── Reads ──────────────────────────────────────────────────────────────────
async function listCalls(client, actor) {
  return (await repo.listCallsForUser(client, actor.user_id)).map(publicCall);
}

async function getCall(client, { id, actor }) {
  const ok = await repo.isParticipant(client, { callId: id, userId: actor.user_id });
  if (!ok) throw new AppError("NOT_FOUND", "Call not found", 404);
  const { rows } = await client.query(
    `SELECT c.*, g.name AS channel_name,
            cu.full_name AS caller_name,
            bu.full_name AS callee_name,
            s.draft_status
     FROM comms_call c
     JOIN comms_group g ON g.group_id = c.group_id
     JOIN app_user cu ON cu.user_id = c.caller_id
     JOIN app_user bu ON bu.user_id = c.callee_id
     LEFT JOIN comms_call_summary s ON s.call_id = c.call_id
     WHERE c.call_id = $1`,
    [id],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Call not found", 404);
  // Every call row a client reads carries the recording switch, so a screen
  // opened mid-call (or a reload) knows whether to show the consent banner.
  return { ...publicCall(rows[0]), recording_enabled: await recordingEnabled(client) };
}

module.exports = {
  DIAL_LIMITS,
  RING_TIMEOUT_S,
  MAX_CALL_S,
  RING_REALERT_MS,
  RING_MAX_REALERTS,
  RING_CHANNELS,
  createCall,
  acceptCall,
  declineCall,
  hangup,
  reportFailure,
  sweep,
  listCalls,
  getCall,
  turnFor,
  credentialTtl,
  publicCall,
  // The one recording-flag helper (audit B14): the pipeline reads it too.
  recordingEnabled,
  // PR-3.
  callSettings,
  settingsFor,
  ackRing,
  ringPush,
  ringCancel,
  enqueueRingPush,
  enqueueRingCancel,
  listRinging,
  testRing,
};
