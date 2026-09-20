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
 * The tenant's call settings (PR-3, §7.1) — the two rows 14020 seeds.
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
    noise_suppression: true,
  };
  try {
    const { rows } = await client.query(
      `SELECT key, value FROM setting WHERE section = 'comms' AND key = ANY($1)`,
      [["call_recording", "call_noise_suppression"]],
    );
    for (const row of rows) {
      if (row.key === "call_recording" && row.value && row.value.retention_days !== undefined) {
        const days = Math.trunc(Number(row.value.retention_days));
        if (Number.isFinite(days)) defaults.recording_retention_days = Math.min(Math.max(days, 1), 365);
      }
      if (row.key === "call_noise_suppression" && row.value && row.value.enabled !== undefined) {
        defaults.noise_suppression = row.value.enabled === true || row.value.enabled === "true";
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
  const recording = await recordingEnabled(client);
  const settings = await callSettings(client);
  const ringPayload = {
    call_id: call.call_id,
    from: { user_id: actor.user_id, name: nameRows[0]?.full_name || null },
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
  rtToUser(partner.user_id, "call:ringing", ringPayload);
  rtToUser(actor.user_id, "call:ringing_sent", ringPayload);

  // The push escalation (§4.6). A DELAYED JOB, not a timer in this process:
  // the ring outlives the request that started it, and a deployment restart
  // mid-ring must not lose the second channel. The job re-reads the row when it
  // fires, so a callee who acked at t=1 s is never pushed at t=5 s — the ack,
  // not the job's existence, is what stops it. Enqueue failure is logged and
  // swallowed: the socket ring has already gone out, and the sweep's NO_ANSWER
  // is the honest outcome if nothing else lands.
  void enqueueRingEscalation({ callId: call.call_id, tenantMeta, env });

  logger.info({ callId: call.call_id, caller: actor.user_id, callee: partner.user_id }, "call: RINGING");
  // The dialer's ICE config rides the create response: the call does not need
  // to be "answered" before the caller's engine can start collecting ICE
  // candidates, and a second round trip here is setup latency on every call.
  const { iceConfigFor } = require("./smartcomm.turn.service");
  return {
    ...call,
    ice: iceConfigFor(actor.user_id),
    recording_enabled: recording,
    noise_suppression: settings.noise_suppression,
  };
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
  const settings = await callSettings(client);
  return {
    ...updated,
    ice: iceConfigFor(actor.user_id),
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
async function hangup(client, { id, actor, reason = "hangup", tenantMeta = null, env = "live" }) {
  const call = await repo.findCall(client, id);
  if (!call || (call.caller_id !== actor.user_id && call.callee_id !== actor.user_id)) {
    throw new AppError("NOT_FOUND", "Call not found", 404);
  }
  if (call.status === "RINGING") {
    return declineCall(client, { id, actor, tenantMeta, env });
  }
  if (call.status === "IN_CALL") {
    return endCall(client, {
      id, fromStatus: "IN_CALL", status: "ENDED", reason, tenantMeta, env,
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
    id, fromStatus, status: "FAILED", reason: "ice_failed", tenantMeta, env,
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
}) {
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

  /**
   * PR-2: the record half starts here (§4.5). A call that ended is a call with
   * audio on two devices that are, at this second, still flushing it — so the
   * enqueue is DELAYED, and the clients re-trigger the same job the moment
   * their last part lands. The queue de-duplicates on the call id, and the
   * daily sweep catches any call whose pipeline never started at all.
   *
   * Fire-and-forget on purpose: the terminal transition has already committed,
   * and a queue that is down must not turn a clean hang-up into an error the
   * user sees. `startPipeline` logs and returns null in that case.
   */
  if (updated && (status === "ENDED" || (status === "FAILED" && updated.connected_at))) {
    await require("./smartcomm.call.pipeline.service").startPipeline({
      callId: id, tenantMeta, env, delayMs: PIPELINE_START_DELAY_MS,
    });
  }
  return updated;
}

/** How long the pipeline waits after a hang-up before it looks for audio. Long
 *  enough for both clients' part uploads to land, short enough that the caller's
 *  "transcribing…" state resolves inside the §3.4 budget. */
const PIPELINE_START_DELAY_MS = 20_000;

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

/* ── The ring escalation (PR-3, §4.6) ────────────────────────────────────── */

/** How long after the ring the push escalation fires without an ack. The
 *  guide's number (§4.6): long enough that an app which is open answers on the
 *  socket channel first — the ack is what stops this — and short enough that a
 *  phone in a pocket is buzzing while the caller still believes it is ringing,
 *  not after they have given up. */
const RING_PUSH_DELAY_MS = 5000;

/** The channels an ack may name. Anything else is refused rather than stored:
 *  the ring-channel metric is only worth having if its vocabulary is closed
 *  (see 14020's header — there is no CHECK on the column, so this is it). */
const RING_CHANNELS = new Set(["socket", "notification", "push"]);

/**
 * Queue the push escalation for a ring. Never throws — see the call site.
 *
 * The static `jobId` gives in-flight de-duplication for free: a dial that is
 * retried by a flaky client cannot queue two escalations for one ring.
 */
async function enqueueRingEscalation({ callId, tenantMeta, env = "live" }) {
  if (!callId) return null;
  try {
    const { enqueue } = require("../../jobs/queue-producer");
    return await enqueue(
      "comms-call-ring-escalate",
      "escalate",
      { callId, tenantMeta, env },
      {
        jobId: `callring-${callId}`,
        delay: RING_PUSH_DELAY_MS,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  } catch (err) {
    // Best-effort by contract. If this cannot be queued the ring still went out
    // on the socket, the browser Notification tier is the client's, and the
    // sweep closes the call at 60 s either way — a queue outage costs one
    // channel, not the call.
    logger.warn({ err, callId }, "call: could not enqueue the ring push escalation");
    return null;
  }
}

/**
 * A device tells us the ring LANDED, and on which channel (§4.6's
 * "`call:ring_ack` stops all channels", §7.4.4's channel split).
 *
 * Three things happen, in this order, and the order matters:
 *
 *   1. The row records the first ack (repo.markRingAck, guarded on
 *      `ring_ack_at IS NULL`). That write is the durable stop for the push
 *      escalation — the delayed job checks it when it fires.
 *   2. The ack is broadcast to the OTHER devices of the same callee, so the
 *      desk tab and the phone stop ringing together rather than each waiting
 *      to time out. It goes to the user's own room, never to the caller: the
 *      caller's UI is already saying "Ringing…" and has nothing to do with
 *      which of the callee's devices heard it first.
 *   3. Nothing else. Accepting the call is `acceptCall`; this is only "the bell
 *      was heard", which is why a late ack on a call that has already moved on
 *      is a quiet no-op rather than an error.
 *
 * Idempotent by construction: a second ack from a second device returns null
 * from the guarded UPDATE and is not re-broadcast.
 */
async function ackRing(client, { id, actor, channel = "socket", tenantSlug = null }) {
  const call = await repo.findCall(client, id);
  if (!call || (call.caller_id !== actor.user_id && call.callee_id !== actor.user_id)) {
    throw new AppError("NOT_FOUND", "Call not found", 404);
  }
  // Only a ring can be acknowledged, and only by the side that rings.
  if (call.status !== "RINGING") return null;
  if (call.caller_id === actor.user_id) return null;
  const safeChannel = RING_CHANNELS.has(channel) ? channel : "socket";

  const updated = await repo.markRingAck(client, { callId: id, channel: safeChannel });
  if (!updated) return null;

  const slug = tenantSlug || requestContext.getTenant();
  rtToUser(
    actor.user_id,
    "call:ring_ack",
    { call_id: id, channel: safeChannel, by: { user_id: actor.user_id } },
    slug,
  );
  logger.info({ callId: id, channel: safeChannel }, "call: ring acked");
  return updated;
}

/**
 * The delayed escalation job's body: push the ring, once, if the bell was never
 * heard.
 *
 * Every condition is re-read from the ROW rather than remembered from the
 * request that queued this — that is the point of using a delayed job instead
 * of a setTimeout. Between t=0 and t=5 s the call can have been answered
 * (IN_CALL), declined (DECLINED), cancelled by the caller, swept to NO_ANSWER,
 * or acked (ring_ack_at set). All of those are "do not push", and all of them
 * are facts the row already knows.
 *
 * The push itself goes through the ordinary `sendToUser` path — the same
 * subscriptions, the same pruning, the same VAPID handling every other
 * notification uses — with the call's own payload: a deep link, a collapsing
 * tag keyed on the call (so a second escalation of the same ring replaces
 * rather than stacks), `requireInteraction`, and the two actions the Android
 * and desktop shades render.
 */
async function escalateRing(client, { callId, tenantSlug = null }) {
  const call = await repo.findCall(client, callId);
  if (!call) return { pushed: false, reason: "call not found" };
  if (call.status !== "RINGING") return { pushed: false, reason: "no longer ringing" };
  if (call.ring_ack_at) return { pushed: false, reason: "already acknowledged" };

  // The claim: whoever sets ring_push_sent_at owns the send. A queue retry that
  // re-runs this job finds the stamp and stops.
  const claimed = await repo.markRingPushSent(client, callId);
  if (!claimed) return { pushed: false, reason: "already escalated" };

  const { rows: nameRows } = await client.query(
    "SELECT full_name FROM app_user WHERE user_id = $1",
    [call.caller_id],
  );
  const callerName = nameRows[0]?.full_name || null;
  const expiresAt = new Date(new Date(call.started_at).getTime() + RING_TIMEOUT_S * 1000).toISOString();

  const push = require("../../shared/push/push.service");
  const result = await push.sendToUser(client, {
    user_id: call.callee_id,
    // The server speaks English here like every other server-side string in
    // this codebase; the service worker re-renders both languages from the
    // device's own locale before showing it (client/public/push-handler.js).
    // The title is the caller's NAME, which needs no translation at all.
    title: callerName || "Praxis LS",
    body: "Incoming call",
    url: `/comms?call=${call.call_id}`,
    tag: `call:${call.call_id}`,
    renotify: true,
    // A ring that auto-dismisses after a few seconds is a ring nobody answers;
    // the OS holds it until the user acts or the call ends.
    requireInteraction: true,
    urgency: "high",
    // The ring is worth 60 seconds of a phone's attention, not a day. Past the
    // window this call cannot be answered anyway (§4.6: an expired ring is a
    // chat, not a call), and a push that surfaces tomorrow would open a dead
    // accept screen — the exact edge case PR-3 exists to close.
    ttl: RING_TIMEOUT_S,
    timestamp: Date.now(),
    actions: [
      { action: "accept", title: "Accept" },
      { action: "decline", title: "Decline" },
    ],
    data: {
      kind: "call",
      call_id: call.call_id,
      caller_id: call.caller_id,
      caller_name: callerName,
      expires_at: expiresAt,
    },
  });

  logger.info(
    {
      callId: call.call_id,
      // The tenant is on the line because this logger is the API process's, not
      // the job's: a fleet-wide grep for one tenant's rings needs it there.
      tenantSlug: tenantSlug || null,
      env: process.env.NODE_ENV,
      sent: result && result.sent,
      reason: result && result.reason,
    },
    "call: ring push escalated",
  );
  return { pushed: true, delivery: result };
}

/** The tenant's call settings, for the sweeps and the clients that need the
 *  numbers rather than the payload. */
async function settingsFor(client) {
  return callSettings(client);
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
  // Every call row a client reads carries the recording switch, so a screen
  // opened mid-call (or a reload) knows whether to show the consent banner.
  return { ...rows[0], recording_enabled: await recordingEnabled(client) };
}

module.exports = {
  RING_TIMEOUT_S,
  MAX_CALL_S,
  RING_PUSH_DELAY_MS,
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
  // PR-3.
  callSettings,
  settingsFor,
  ackRing,
  escalateRing,
  enqueueRingEscalation,
};
