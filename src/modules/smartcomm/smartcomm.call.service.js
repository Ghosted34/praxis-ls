/**
 * Smart Comms Calls (PR-1) — server-authoritative 1:1 call state machine.
 *
 * The server owns the call row: it creates it (RINGING), moves it to IN_CALL,
 * and closes it (ENDED / NO_ANSWER / CANCELLED / DECLINED / BUSY / FAILED).
 * Clients are renderers — a client that lies about the state changes nothing,
 * because every transition is a guarded UPDATE that only matches the status
 * it is leaving. Each call's deadlines are delayed jobs of its own
 * (smartcomm.call.clock.js, audit D1), re-checked against the ROW when they
 * fire, and a 5-minute safety sweep over tenants with calls backs them up. A
 * process restart therefore loses no deadline.
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

const clock = require("./smartcomm.call.clock");
const presence = require("./smartcomm.presence");
const signals = require("./smartcomm.call.signals");

const cref = (id) => "comms_call:" + id;

/** The two timers, as constants on the row. Each call's clock jobs enforce
 *  them; the clients run the same constants for the UX (29:00 warning,
 *  hang-up at 30:00). */
const RING_TIMEOUT_S = 60;
const MAX_CALL_S = 1800;
/** How long BOTH participants may be socket-less before an in-call call ends
 *  itself `disconnected` (field note FN-1). Beyond the matrix's 20 s
 *  airplane row (which drops one device — the other is still online), well
 *  under the 30-minute cap that remains the backstop if presence is down. */
const LIVENESS_OFFLINE_S = 60;
/** Dial limits (audit C6). Per caller is the route's limiter; per callee is
 *  here, where the callee is known: a colleague cannot be rung more than this
 *  in a minute, by anyone. */
const DIAL_LIMITS = Object.freeze({ perCalleePerMinute: 6 });

/** A day counter for the platform metrics (audit D4), on the call's UTC
 *  start day. Best-effort, like every signal. */
function countCall(call, field, { slug = null, env = "live", by = 1 } = {}) {
  return signals.count({
    slug: slug || requestContext.getTenant(), env, field, by, startedAt: call && call.started_at,
  });
}

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
 * Two switches, both required (PR-6, audit G1): the platform feature
 * `call_recording` (is recording available to this tenant) AND the tenant's
 * own opt-in, `comms.call_recording.enabled`, which a MOD-70 admin sets in
 * Settings → Calls and which starts OFF for a new tenant (14090).
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
      `SELECT state,
              (SELECT s.value -> 'enabled' FROM setting s
                WHERE s.section = 'comms' AND s.key = 'call_recording') AS tenant_enabled
         FROM feature_state WHERE feature_key = $1`,
      ["call_recording"],
    );
    const t = rows[0] && rows[0].tenant_enabled;
    return !!rows[0] && rows[0].state === "on" && (t === true || t === "true");
  } catch (err) {
    logger.warn({ err }, "call: could not read the recording flag");
    return false;
  }
}

/** Is THIS call being recorded: the tenant's switches, and not declined by
 *  the callee when answering (audit G5). */
async function recordingForCall(client, call) {
  if (call && call.recording_declined_at) return false;
  return recordingEnabled(client);
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
    // comms.call_recording.transcript_retention_days (audit G3): absent keeps
    // transcripts and summaries; a number deletes them after that many days.
    transcript_retention_days: null,
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
      if (row.key === "call_recording" && row.value && row.value.transcript_retention_days !== undefined
          && row.value.transcript_retention_days !== null) {
        const days = Math.trunc(Number(row.value.transcript_retention_days));
        if (Number.isFinite(days)) defaults.transcript_retention_days = Math.min(Math.max(days, 30), 3650);
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
  // Do not disturb (PR-6, audit C6): the callee has asked not to be rung.
  // Read fail-open: a preference that cannot be read must not stop a call.
  let prefs = {};
  try {
    prefs = (await repo.callPrefsFor(client, [partner.user_id]))[partner.user_id] || {};
  } catch (err) {
    logger.warn({ err }, "call: could not read the callee's call preferences");
  }
  if (prefs.do_not_disturb === true) {
    throw new AppError("CALLEE_DND", "That person has calls on do not disturb", 409, {
      user_message: "That person is not taking calls right now. Send them a message instead.",
    });
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
  // The ring's own deadline (D1); the tenant joins the safety sweep's set.
  await countCall(call, "calls_started", { slug: tenantMeta && tenantMeta.slug, env });
  await clock.markTenantActive(tenantMeta, env);
  await clock.scheduleRingDeadline({
    callId: call.call_id, tenantMeta, env, ringTimeoutS: RING_TIMEOUT_S, startedAt: call.started_at,
  });

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
async function acceptCall(client, { id, actor, tenantMeta = null, env = "live", record = true }) {
  const call = await repo.findCall(client, id);
  if (!call || (call.caller_id !== actor.user_id && call.callee_id !== actor.user_id)) {
    throw new AppError("NOT_FOUND", "Call not found", 404);
  }
  if (call.caller_id === actor.user_id) {
    throw new AppError("BAD_ROLE", "The caller cannot answer their own call", 422);
  }
  // "Answer without recording" (PR-6, audit G5): the callee's choice is on
  // the row, so the pipeline refuses this call's parts and neither end arms.
  const fields = { connected_at: new Date().toISOString() };
  if (record === false) {
    fields.recording_declined_at = fields.connected_at;
    fields.recording_declined_by = actor.user_id;
  }
  const updated = await repo.transition(client, {
    callId: id,
    fromStatus: "RINGING",
    status: "IN_CALL",
    fields,
  });
  if (!updated) {
    throw new AppError("CALL_MOVED_ON", "This call has already ended", 409);
  }
  const recording = await recordingForCall(client, updated);
  const other = call.caller_id;
  const payload = { call_id: id, by: { user_id: actor.user_id }, recording_enabled: recording };
  rtToUser(other, "call:accepted", payload, { env });
  // The callee's own room too: their other devices stop ringing (audit E8).
  rtToUser(actor.user_id, "call:accepted", payload, { env });
  void enqueueRingCancel({ callId: id, outcome: "answered", tenantMeta, env });
  // The 30-minute cap (D1), and the live call each side's disconnect checks.
  await countCall(updated, "calls_answered", { slug: tenantMeta && tenantMeta.slug, env });
  await clock.markTenantActive(tenantMeta, env);
  await clock.scheduleCap({ callId: id, tenantMeta, env, maxCallS: MAX_CALL_S, connectedAt: updated.connected_at });
  await rememberActiveCall(updated, { slug: tenantMeta && tenantMeta.slug, env });
  logger.info({ callId: id }, "call: IN_CALL");
  // The callee's engine starts now, so its ICE config rides this response.
  const settings = await callSettings(client);
  return {
    ...publicCall(updated),
    ice: await iceFor(client, updated, settings),
    recording_enabled: recording,
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
  logger.info({ callId: id, status, reason, env }, "call: terminal");
  const counted = { slug: tenantSlug || (tenantMeta && tenantMeta.slug), env };
  if (TERMINAL_COUNTERS[status]) await countCall(updated, TERMINAL_COUNTERS[status], counted);
  if ((status === "ENDED" || status === "FAILED") && updated.connected_at) {
    await countCall(updated, "answered_ended", counted);
    await countCall(updated, "duration_sum", { ...counted, by: Number(updated.duration_seconds) || 0 });
  }
  if (fromStatus === "IN_CALL") {
    await forgetActiveCall(before, { slug: tenantSlug || (tenantMeta && tenantMeta.slug), env });
  }
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
 * The safety sweep (jobs/handlers/comms-call-sweep.js), every 5 minutes, for
 * a tenant in the active set only. Each call's own clock jobs are the primary
 * deadlines (D1); this catches a job that was never queued or was lost.
 *
 * Ends ring calls older than RING_TIMEOUT_S (NO_ANSWER), in-call calls older
 * than MAX_CALL_S (ENDED max_duration) and in-call calls whose two
 * participants have both been gone for LIVENESS_OFFLINE_S (ENDED
 * disconnected). Every end is a guarded transition, so racing a real hang-up
 * or another replica is harmless. Returns how many it moved and how many
 * calls are still live, so the scheduler can drop an idle tenant.
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
  const { rows: live } = await client.query(
    "SELECT call_id, caller_id, callee_id, status FROM comms_call WHERE status IN ('RINGING','IN_CALL')",
  );
  let disconnected = 0;
  for (const call of live) {
    if (call.status !== "IN_CALL") continue;
    const verdict = await livenessVerdict(call, { tenantSlug, env });
    if (verdict.gone && await endDisconnected(client, call, { tenantSlug, tenantMeta, env })) disconnected += 1;
  }
  return { moved: moved + disconnected, live: live.length - disconnected };
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

/** The ring's deadline job: NO_ANSWER if the row still rings and is due. */
async function expireRing(client, { callId, tenantMeta = null, env = "live" }) {
  const call = await repo.findCall(client, callId);
  if (!call || call.status !== "RINGING") return { moved: false, reason: "not ringing" };
  const dueAt = new Date(call.started_at).getTime() + RING_TIMEOUT_S * 1000;
  if (dueAt > Date.now()) {
    await clock.scheduleRingDeadline({ callId, tenantMeta, env, ringTimeoutS: RING_TIMEOUT_S, startedAt: call.started_at });
    return { moved: false, reason: "not due" };
  }
  return { moved: await sweepOne(client, call, tenantMeta && tenantMeta.slug, { tenantMeta, env }) };
}

/** The 30-minute cap job: ENDED(max_duration) if still in the call. */
async function capCall(client, { callId, tenantMeta = null, env = "live" }) {
  const call = await repo.findCall(client, callId);
  if (!call || call.status !== "IN_CALL") return { moved: false, reason: "not in a call" };
  const dueAt = new Date(call.connected_at).getTime() + MAX_CALL_S * 1000;
  if (dueAt > Date.now()) {
    await clock.scheduleCap({ callId, tenantMeta, env, maxCallS: MAX_CALL_S, connectedAt: call.connected_at });
    return { moved: false, reason: "not due" };
  }
  return { moved: await sweepOne(client, call, tenantMeta && tenantMeta.slug, { tenantMeta, env }) };
}

/**
 * Are both participants gone, and for long enough (field note FN-1)?
 *
 * A participant is gone while none of their sockets is live in presence
 * (smartcomm.presence.js, TTL-bound, so a crashed replica's sockets stop
 * counting within 90 s). `{ gone, dueAt }`: `dueAt` is when both will have
 * been gone for LIVENESS_OFFLINE_S. Any presence failure answers "not gone":
 * liveness must never be what ends a healthy call, and the cap remains.
 */
async function livenessVerdict(call, { tenantSlug, env }, now = Date.now()) {
  if (!tenantSlug) return { gone: false, reason: "no tenant" };
  let since;
  try {
    since = await presence.offlineSince(require("../../config/redis").getClient(), {
      slug: tenantSlug, env, userIds: [call.caller_id, call.callee_id], now,
    });
  } catch (err) {
    logger.warn({ err, tenantSlug }, "call liveness: presence unavailable — the 30-minute cap remains the backstop");
    return { gone: false, reason: "presence unavailable" };
  }
  const a = since[call.caller_id];
  const b = since[call.callee_id];
  if (a === null || b === null || a === undefined || b === undefined) return { gone: false, reason: "online" };
  // BOTH gone for the full window (audit B2: the later of the two counts).
  const dueAt = Math.max(a, b) + LIVENESS_OFFLINE_S * 1000;
  return { gone: dueAt <= now, dueAt };
}

async function endDisconnected(client, call, { tenantSlug, tenantMeta, env }) {
  try {
    await endCall(client, {
      id: call.call_id,
      fromStatus: "IN_CALL",
      status: "ENDED",
      reason: "disconnected",
      notifyEvent: "call:ended",
      tenantSlug,
      tenantMeta,
      env,
    });
    return true;
  } catch (err) {
    if (err && err.status === 409) return false; // a hang-up won the race
    throw err;
  }
}

/**
 * The liveness job, queued 60 s after a participant's last socket left
 * mid-call. Ends the call if both are gone for the window; if both are gone
 * but not yet for long enough, checks again when they will have been.
 */
async function checkLiveness(client, { callId, tenantMeta = null, env = "live" }) {
  const call = await repo.findCall(client, callId);
  if (!call || call.status !== "IN_CALL") return { moved: false, reason: "not in a call" };
  const tenantSlug = tenantMeta && tenantMeta.slug;
  const verdict = await livenessVerdict(call, { tenantSlug, env });
  if (verdict.gone) return { moved: await endDisconnected(client, call, { tenantSlug, tenantMeta, env }) };
  if (verdict.dueAt) {
    await clock.scheduleLiveness({ callId, tenantMeta, env, atMs: verdict.dueAt + clock.GRACE_MS });
    return { moved: false, reason: "rechecking" };
  }
  return { moved: false, reason: verdict.reason };
}

/** Both participants' live call, for the disconnect → liveness check. Never throws. */
async function rememberActiveCall(call, { slug, env }) {
  if (!slug || !call) return;
  try {
    await presence.setActiveCall(require("../../config/redis").getClient(), {
      slug, env, userIds: [call.caller_id, call.callee_id], callId: call.call_id,
    });
  } catch (err) {
    logger.warn({ err, callId: call.call_id }, "call: could not record the live call — the cap remains the backstop");
  }
}

async function forgetActiveCall(call, { slug, env }) {
  if (!slug || !call) return;
  try {
    await presence.clearActiveCall(require("../../config/redis").getClient(), {
      slug, env, userIds: [call.caller_id, call.callee_id], callId: call.call_id,
    });
  } catch {
    /* @silent:storage — the key expires on its own (PRESENCE.activeCallS). */
  }
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

/** The day counter a terminal status adds to (audit D4). */
const TERMINAL_COUNTERS = Object.freeze({
  NO_ANSWER: "calls_no_answer", DECLINED: "calls_declined", BUSY: "calls_busy", FAILED: "calls_failed",
});

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

/**
 * Ring-queue priority (BullMQ: lower runs first). First alerts and cancels
 * go ahead of re-alerts; within a class, each tenant's jobs are ranked by how
 * many it has queued in the last 10 s, so a burst at one tenant cannot delay
 * another tenant's ring (every tenant's first ring has rank 1).
 */
const RING_RANK_SPAN = 100_000;
const RING_RANK_WINDOW_S = 10;
async function ringPriority({ slug, urgent }) {
  let rank = 1;
  try {
    const bucket = Math.floor(Date.now() / (RING_RANK_WINDOW_S * 1000));
    const key = `praxis:ringrank:${slug}:${bucket}`;
    const r = require("../../config/redis").getClient();
    rank = Number(await r.incr(key)) || 1;
    if (rank === 1) await r.expire(key, RING_RANK_WINDOW_S * 3);
  } catch {
    /* @silent:storage — unranked, the job still runs in its class. */
  }
  return 1 + (urgent ? 0 : RING_RANK_SPAN) + Math.min(rank - 1, RING_RANK_SPAN - 1);
}

async function enqueueRingJob(name, data, opts) {
  const { enqueue } = require("../../jobs/queue-producer");
  const urgent = name === "cancel" || !data.alert;
  const priority = await ringPriority({ slug: data.tenantMeta && data.tenantMeta.slug, urgent });
  return enqueue("comms-call-ring-escalate", name, data, {
    attempts: 1, removeOnComplete: true, removeOnFail: 50, priority, ...opts,
  });
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
  if (updated) {
    logger.info({ callId: id, channel: safeChannel }, "call: ring acked");
    await countCall(updated, `ring_${safeChannel}`, { env: requestContext.getEnv() });
  }
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
async function testRing(client, { actor, endpoint, nonce = null }) {
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
    // `nonce`: Test calls' step 4 — the service worker echoes it to the page,
    // which is how the run knows the push reached THIS device.
    data: nonce ? { kind: "call_test", nonce } : { kind: "call_test" },
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

/**
 * "How calls are processed" (PR-6, audit G2): the outside companies that
 * actually receive this tenant's call data, read from the configured vendors
 * rather than hard-coded. Order is the pipeline's (owner decisions O1, O2):
 * transcription Groq, then Google (Gemini) when Groq fails; summaries Google
 * (Gemini), then DeepSeek as the last resort. A vendor with neither an active
 * platform credential nor an environment key is left out: it receives nothing.
 */
const PROCESSORS = Object.freeze({
  groq: { name: "Groq", country: "United States" },
  gemini: { name: "Google (Gemini)", country: "United States" },
  deepseek: { name: "DeepSeek", country: "China" },
});

async function vendorConfigured(vendor) {
  const { config } = require("../../config/env");
  const envKey = { groq: config.GROQ_API_KEY, gemini: config.GEMINI_API_KEY, deepseek: config.DEEPSEEK_API_KEY }[vendor];
  try {
    const cfg = await require("../../services/platform/ai-vendor.service").getConfig(vendor);
    if (cfg && cfg.is_active !== false && cfg.api_key) return true;
  } catch (err) {
    logger.warn({ err, vendor }, "call: could not read a vendor for the processing disclosure");
  }
  return !!envKey;
}

async function processingDisclosure(client) {
  const pick = async (vendor, role) => ((await vendorConfigured(vendor)) ? [{ vendor, role, ...PROCESSORS[vendor] }] : []);
  const { usesGoogleStun } = require("./smartcomm.turn.service");
  return {
    recording_enabled: await recordingEnabled(client),
    transcription: [...(await pick("groq", "first")), ...(await pick("gemini", "when_first_fails"))],
    summary: [...(await pick("gemini", "first")), ...(await pick("deepseek", "last_resort"))],
    // Connection set-up only (no audio): Google's STUN sees the callers'
    // network addresses when no relay of the company's own is configured.
    network: usesGoogleStun() ? [{ vendor: "google_stun", role: "connection_setup", name: "Google (STUN)", country: "United States" }] : [],
  };
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
  return { ...publicCall(rows[0]), recording_enabled: await recordingForCall(client, rows[0]) };
}

module.exports = {
  DIAL_LIMITS,
  RING_TIMEOUT_S,
  MAX_CALL_S,
  RING_REALERT_MS,
  RING_MAX_REALERTS,
  RING_CHANNELS,
  ringPriority,
  createCall,
  acceptCall,
  declineCall,
  hangup,
  reportFailure,
  sweep,
  expireRing,
  capCall,
  checkLiveness,
  LIVENESS_OFFLINE_S,
  listCalls,
  getCall,
  turnFor,
  credentialTtl,
  publicCall,
  // The one recording-flag helper (audit B14): the pipeline reads it too.
  recordingEnabled,
  recordingForCall,
  processingDisclosure,
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
