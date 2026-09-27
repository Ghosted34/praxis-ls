/**
 * Real-time layer (Smart Comms, MOD-64 / PRD §11.5).
 *
 * A socket.io server attached to the HTTP server. It authenticates every socket
 * the same way the HTTP stack does — verify the JWT access token, resolve the
 * tenant from the handshake Host (registry), and confirm the user is active in
 * that tenant's identity schema — then lets a client subscribe to the channels
 * it belongs to. Membership is re-checked on the server for every join, so a
 * socket can never listen to a channel the user isn't a member of.
 *
 * Rooms are namespaced per tenant, environment and channel:
 * `t:<slug>:<env>:c:<groupId>`, so there is no cross-tenant bleed even if two
 * tenants ever shared a channel UUID, and a sandbox schema that shares group
 * ids with live cannot reach live sockets (calls audit N1).
 *
 * Services publish through `publish(tenantSlug, env, groupId, event, payload)` after
 * a committed DB write (see smartcomm.service). Delivery is best-effort: if the
 * socket server isn't up (tests, workers) publish is a no-op.
 *
 * Handshake (client → server), all under `socket.handshake.auth`:
 *   { token: "<access jwt>", host?: "<tenant host>", env?: "live"|"sandbox" }
 * `host` is optional; the Origin/Host header is used when omitted.
 */
"use strict";

const jwt = require("jsonwebtoken");
const { config } = require("../config/env");
const { logger } = require("../config/logger");
const registry = require("../services/tenant/registry.service");
const identityCache = require("../shared/cache/identity-cache");

let io = null;

const room = (slug, env, groupId) => `t:${slug}:${env}:c:${groupId}`;
const mailRoom = (slug, env) => `t:${slug}:${env}:mail`;
/**
 * One room per USER and ENVIRONMENT, for what is addressed to a person
 * (notifications, calls). Derived from the socket's authenticated user id and
 * env, never from anything the client sends. The env is in the name because a
 * user's live and sandbox (training) tabs are different audiences: without it
 * a sandbox call rang live devices (calls audit A9).
 */
const ENVS = new Set(["live", "sandbox"]);
const userRoom = (slug, env, uid) => `t:${slug}:${env}:u:${uid}`;

/** The rooms every authenticated socket joins on connect. */
function joinPersonalRooms(socket) {
  const { tenantSlug, env, userId } = socket.data;
  if (!ENVS.has(env)) return;
  socket.join(mailRoom(tenantSlug, env));
  if (userId) socket.join(userRoom(tenantSlug, env, userId));
}

/** Same origin policy as the HTTP CORS: base domain + its subdomains, explicit
 *  extras, and localhost in development. */
function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true);
  const base = config.APP_BASE_DOMAIN.toLowerCase();
  const extra = new Set(config.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean));
  let host;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return cb(new Error("Bad origin"), false);
  }
  const onBase = host === base || host.endsWith("." + base);
  const devLocal = config.NODE_ENV !== "production" && (host === "localhost" || host === "127.0.0.1");
  if (onBase || devLocal || extra.has(origin)) return cb(null, true);
  return cb(new Error("Not allowed by CORS"), false);
}

async function authenticate(socket, next) {
  try {
    const auth = socket.handshake.auth || {};
    const token = auth.token || (socket.handshake.headers.authorization || "").replace(/^Bearer /, "");
    if (!token) return next(new Error("AUTH_REQUIRED"));

    let payload;
    try {
      payload = jwt.verify(token, config.JWT_ACCESS_SECRET);
    } catch {
      return next(new Error("INVALID_TOKEN"));
    }
    if (payload.typ && payload.typ !== "access") return next(new Error("INVALID_TOKEN"));

    // SEC-M4. The HANDSHAKE HEADER, never `auth.host`.
    //
    // This read `auth.host || headers.host`, so a client CHOSE which tenant its
    // token was resolved against — the one input in the handshake that must not
    // be client-supplied. It failed closed today only because a user id from
    // tenant A does not exist in tenant B's `app_user`, i.e. the isolation was
    // resting on UUID non-collision rather than on a check. That stops being
    // true the moment any tenant database is restored, cloned or seeded from
    // another — a staging refresh or a support copy — and it would fail OPEN
    // then, silently, with a valid token reading another tenant's live stream.
    //
    // The HTTP path resolves the tenant from Host alone; production now matches
    // it, which is the actual fix: one rule for which request belongs to whom.
    //
    // NOT removed outright, because `auth.host` is a documented DEVELOPMENT
    // affordance — comms-socket.ts says "in dev, pass host/url overrides", and
    // it exists because the Vite dev server proxies the socket, so the Host
    // header is the dev server's and not the tenant subdomain's. Deleting it
    // would have closed the hole and broken every developer's local socket.
    // Gated on NODE_ENV instead, exactly as the origin check above already
    // gates `devLocal` — same rule, same place, one thing to reason about.
    const devHostOverride = config.NODE_ENV !== "production" ? auth.host : null;
    const host = String(devHostOverride || socket.handshake.headers.host || "")
      .toLowerCase()
      .split(":")[0];
    const tenant = await registry.resolveByHost(host);
    if (!tenant || tenant.status !== "LIVE") return next(new Error("TENANT_UNAVAILABLE"));

    // Identity is env-independent — resolve the user against the live schema.
    const user = await registry.withTenantConnection(tenant, "live", (c) => identityCache.getAuthUser(c, payload.sub));
    if (!user || user.status !== "ACTIVE") return next(new Error("USER_INACTIVE"));

    const requested = String(auth.env || "").toLowerCase();
    const env = !tenant.is_live && requested === "sandbox" ? "sandbox" : "live";
    socket.data = { tenant, tenantSlug: tenant.slug, env, userId: user.user_id };
    return next();
  } catch {
    return next(new Error("AUTH_FAILED"));
  }
}

function initSocket(httpServer) {
  let Server;
  try {
     
    ({ Server } = require("socket.io"));
  } catch {
    logger.warn("socket.io not installed — real-time disabled");
    return null;
  }
  // Every client event is small: chat goes over HTTP, and the largest socket
  // payload is a call's SDP (≤ 64 KB). socket.io's 1 MB default let one
  // socket push megabytes per event (calls audit C5).
  io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    maxHttpBufferSize: SIGNAL_LIMITS.bufferBytes,
  });

  /**
   * PERF S12. Attach the Redis adapter so `publish()` reaches every replica.
   *
   * `config/redis.js` documents "Pub/Sub coordination across Socket.io workers
   * (redis adapter)" and creates the publisher/subscriber pair for it. No
   * adapter was ever attached. Only mail-bus.js used the publisher.
   *
   * Without it `io.to(room).emit(...)` reaches only sockets connected to THIS
   * Node process. That is invisible on a single replica and becomes a silent
   * correctness failure the moment there are two: a Smart Comms message is
   * delivered to the subset of recipients who happen to be on the sending
   * process, with no error anywhere.
   *
   * Which matters now specifically because the PERF S1 fix makes running more
   * replicas the answer to the tenant ceiling — so the change that relieves one
   * problem would have quietly created this one.
   *
   * DEDICATED pub/sub connections, not the shared client: a connection in
   * subscriber mode can issue nothing but (P)SUBSCRIBE/UNSUBSCRIBE, so handing
   * the adapter a shared socket would break every other user of it. Same reason
   * as S11, different symptom.
   *
   * Degrades rather than fails: if the adapter package is absent, realtime
   * keeps working per-process and says so loudly, because a warning beats a
   * chat feature that will not start.
   */
  try {
     
    const { createAdapter } = require("@socket.io/redis-adapter");
     
    const { createConnection } = require("../config/redis");
    const pub = createConnection("socketio:pub");
    const sub = createConnection("socketio:sub");
    io.adapter(createAdapter(pub, sub));
    logger.info("socket.io redis adapter attached — realtime is cross-process");
  } catch (err) {
    logger.warn(
      { err },
      "socket.io redis adapter NOT attached — realtime events reach only this process; " +
        "install @socket.io/redis-adapter before running more than one API replica (PERF S12)",
    );
  }

  io.use(authenticate);

  io.on("connection", (socket) => {
    const { tenantSlug, env, userId, tenant } = socket.data;

    // The tenant mail room (inbound-mail events) and the user's own room for
    // their env. Joined here, not on request, so there is no client-supplied
    // id to get wrong. The 60-second badge poll stays as the reconciler.
    joinPersonalRooms(socket);

    socket.on("channel:join", async (groupId, ack) => {
      try {
         
        const repo = require("../modules/smartcomm/smartcomm.repo");
        const member = await registry.withTenantConnection(tenant, env, (c) => repo.findMember(c, groupId, userId));
        if (!member) return typeof ack === "function" && ack({ ok: false, error: "NOT_A_MEMBER" });
        socket.join(room(tenantSlug, env, groupId));
        return typeof ack === "function" && ack({ ok: true });
      } catch {
        return typeof ack === "function" && ack({ ok: false, error: "JOIN_FAILED" });
      }
    });

    socket.on("channel:leave", (groupId) => socket.leave(room(tenantSlug, env, groupId)));

    // Ephemeral typing indicator — broadcast to others in the room, not persisted.
    socket.on("channel:typing", (groupId) =>
      socket.to(room(tenantSlug, env, groupId)).emit("channel:typing", { group_id: groupId, user_id: userId }),
    );

    attachCallSignals(socket);
    attachPresence(socket);
  });

  attachMailBridge();

  // Error Command Center. A SEPARATE namespace, not another handler on `/`:
  // the connection handler above authenticates tenant users (typ="access",
  // tenant resolved from Host), and a platform token satisfies neither check.
  // See realtime/platform-ns.js for why loosening those checks instead would
  // punch a hole in the tenant/platform boundary.
  try {
    // eslint-disable-next-line global-require
    require("./platform-ns").initPlatformNamespace(io);
  } catch (err) {
    logger.warn({ err }, "platform error-feed namespace failed to attach — console falls back to polling");
  }

  logger.info("real-time (socket.io) ready");
  return io;
}

/**
 * 1:1 call signalling — relay only: SDP and ICE candidates between the two
 * participants, never stored or interpreted. The state machine is on the REST
 * paths.
 *
 * Bounded (calls audit C5, D7):
 *   - relayed only while the call is RINGING or IN_CALL;
 *   - the counterpart is looked up once per call per socket and cached, not
 *     once per candidate; the cache entry goes when a terminal call event
 *     reaches this socket (on whichever replica holds it) or after
 *     `cacheMs`, whichever is first;
 *   - an SDP is a string of at most 64 KB; a candidate is its four known
 *     fields, at most 2 KB, or null;
 *   - a token bucket per socket, shared by every call event.
 * A dropped signal gets no reply: an error would tell a prober there is a
 * call it is not in.
 */
const SIGNAL_LIMITS = Object.freeze({
  sdpBytes: 64 * 1024,
  candidateBytes: 2048,
  bufferBytes: 128 * 1024,
  burst: 120,
  refillPerSecond: 20,
  cacheMs: 30_000,
  cacheEntries: 8,
});
const TERMINAL_CALL_EVENTS = new Set(["call:ended", "call:declined", "call:cancelled", "call:no_answer"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanSdp(sdp) {
  if (typeof sdp !== "string" || !sdp || Buffer.byteLength(sdp) > SIGNAL_LIMITS.sdpBytes) return undefined;
  return sdp;
}

/** null (end of candidates), the candidate's known fields, or undefined (drop). */
function cleanCandidate(c) {
  if (c === null || c === undefined) return null;
  if (typeof c !== "object" || Array.isArray(c)) return undefined;
  const out = {};
  if (typeof c.candidate === "string") out.candidate = c.candidate;
  if (typeof c.sdpMid === "string" || c.sdpMid === null) out.sdpMid = c.sdpMid;
  if (Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex === null) out.sdpMLineIndex = c.sdpMLineIndex;
  if (typeof c.usernameFragment === "string" || c.usernameFragment === null) out.usernameFragment = c.usernameFragment;
  if (Buffer.byteLength(JSON.stringify(out)) > SIGNAL_LIMITS.candidateBytes) return undefined;
  return out;
}

function tokenBucket({ burst, refillPerSecond }, now = () => Date.now()) {
  let tokens = burst;
  let last = now();
  return () => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * refillPerSecond);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/** A client event's payload as an object. `null`, an array or a primitive
 *  becomes `{}`: destructuring `null` throws inside socket.io's listener, and
 *  an uncaught exception there exits the API process (server.js). */
const asObject = (p) => (p && typeof p === "object" && !Array.isArray(p) ? p : {});

function attachCallSignals(socket) {
  const { tenant, env, tenantSlug, userId } = socket.data;
  const allow = tokenBucket(SIGNAL_LIMITS);
  const counterparts = new Map(); // callId → { userId, at }

  if (typeof socket.onAnyOutgoing === "function") {
    socket.onAnyOutgoing((event, payload) => {
      if (TERMINAL_CALL_EVENTS.has(event) && payload && payload.call_id) counterparts.delete(payload.call_id);
    });
  }

  async function counterpartFor(callId) {
    const hit = counterparts.get(callId);
    if (hit && Date.now() - hit.at < SIGNAL_LIMITS.cacheMs) return hit.userId;
    counterparts.delete(callId);
    const callRepo = require("../modules/smartcomm/smartcomm.call.repo");
    const other = await registry.withTenantConnection(tenant, env, (c) =>
      callRepo.liveCounterpart(c, { callId, userId }),
    );
    if (!other) return null;
    if (counterparts.size >= SIGNAL_LIMITS.cacheEntries) counterparts.delete(counterparts.keys().next().value);
    counterparts.set(callId, { userId: other.user_id, at: Date.now() });
    return other.user_id;
  }

  function relay(event, callId, extra) {
    if (typeof callId !== "string" || !UUID.test(callId) || !allow()) return;
    counterpartFor(callId)
      .then((other) => {
        if (other) publishToUser(tenantSlug, env, other, event, { call_id: callId, ...extra });
      })
      .catch((err) => logger.warn({ err, callId }, `${event} relay failed`));
  }

  socket.on("call:offer", (p) => {
    const { callId, sdp } = asObject(p);
    const clean = cleanSdp(sdp);
    if (clean !== undefined) relay("call:offer", callId, { sdp: clean });
  });
  socket.on("call:answer", (p) => {
    const { callId, sdp } = asObject(p);
    const clean = cleanSdp(sdp);
    if (clean !== undefined) relay("call:answer", callId, { sdp: clean });
  });
  socket.on("call:ice", (p) => {
    const { callId, candidate } = asObject(p);
    const clean = cleanCandidate(candidate);
    if (clean !== undefined) relay("call:ice", callId, { candidate: clean });
  });
  // PR-4 (E3): the callee's engine is listening; the caller re-sends its
  // offer if it has no answer. No payload beyond the call id.
  socket.on("call:ready", (p) => {
    relay("call:ready", asObject(p).callId, {});
  });
  socket.on("call:ring_ack", (p) => {
    const { callId, channel } = asObject(p);
    // Which channel a ring landed on, for the ring-channel metric only: it
    // stops no push and no other device (audit A12). Through the service,
    // which holds the rules (only the callee acks; the first ack counts).
    // A failure is swallowed: it costs a metric row, never the call.
    if (typeof callId !== "string" || !UUID.test(callId) || !allow()) return;
    const callService = require("../modules/smartcomm/smartcomm.call.service");
    registry
      .withTenantConnection(tenant, env, (c) =>
        callService.ackRing(c, {
          id: callId,
          actor: { user_id: userId },
          channel: typeof channel === "string" ? channel : "socket",
        }),
      )
      .catch(
        /* @silent:db — see above. */
        () => {},
      );
  });
}

/**
 * Presence + last seen (guide §4.11; calls audit B3, C9, D6, D8, E12).
 *
 * "Online now" is kept in Redis per user (smartcomm.presence.js): one entry
 * per live socket, refreshed by this replica every 30 s and gone 90 s after
 * the last refresh, so it is right across replicas and after a crash.
 *
 *   - On connect, the socket gets a snapshot of its user's DIRECT contacts
 *     (`comms:presence_snapshot`), and the contacts hear `comms:presence`
 *     in their own user rooms when this is the user's first live socket.
 *   - On the last socket's disconnect, the contacts hear the user go
 *     offline, and a live call gets its liveness check at +60 s.
 *   - `last_seen_at` is written at most once per user per 5 minutes, and a
 *     socket's `comms:seen` beats are ignored inside 30 s (C9).
 *
 * Every Redis or database failure here is logged and absorbed: presence is
 * advisory, and the 30-minute cap stays the backstop for a call.
 */
const PRESENCE_SEEN_MIN_MS = 30_000;

function attachPresence(socket) {
  const { tenant, env, tenantSlug, userId } = socket.data;
  if (!userId || !ENVS.has(env)) return;
  const presence = require("../modules/smartcomm/smartcomm.presence");
  const callRepo = require("../modules/smartcomm/smartcomm.call.repo");
  const redis = () => require("../config/redis").getClient();
  const who = { slug: tenantSlug, env, userId, socketId: socket.id };
  let lastSeenBeat = 0;

  const contacts = () => presence.contactsFor(redis(), {
    ...who,
    load: () => registry.withTenantConnection(tenant, env, (c) => callRepo.directContacts(c, userId)),
  });

  const announce = async (online) => {
    const list = await contacts();
    if (!list.length || !io) return;
    io.to(list.map((uid) => userRoom(tenantSlug, env, uid))).emit("comms:presence", { user_id: userId, online });
  };

  const flushLastSeen = async () => {
    if (!(await presence.claimLastSeenFlush(redis(), who))) return;
    await registry.withTenantConnection(tenant, env, (c) => callRepo.touchPresence(c, userId));
  };

  const warn = (what) => (err) => logger.warn({ err, userId }, `presence: ${what} failed`);

  const joined = (async () => {
    const before = await presence.join(redis(), who);
    const list = await contacts();
    const users = await presence.onlineMap(redis(), { slug: tenantSlug, env, userIds: list });
    socket.emit("comms:presence_snapshot", { users });
    if (before === 0) await announce(true);
    await flushLastSeen();
  })().catch(warn("connect"));

  const heartbeat = setInterval(() => {
    presence.beat(redis(), who).catch(warn("heartbeat"));
  }, presence.PRESENCE.heartbeatMs);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  socket.on("comms:seen", () => {
    const now = Date.now();
    if (now - lastSeenBeat < PRESENCE_SEEN_MIN_MS) return;
    lastSeenBeat = now;
    flushLastSeen().catch(warn("last seen"));
  });

  socket.on("disconnect", () => {
    clearInterval(heartbeat);
    // After the join has landed, so a quick disconnect cannot leave this
    // socket's entry behind it (it would count as online for 90 s).
    joined.then(async () => {
      const left = await presence.leave(redis(), who);
      if (left > 0) return;
      await announce(false);
      await flushLastSeen();
      // A call this user was in gets its liveness check (audit D1).
      const callId = await presence.activeCall(redis(), who);
      if (callId) {
        const clock = require("../modules/smartcomm/smartcomm.call.clock");
        const { LIVENESS_OFFLINE_S } = require("../modules/smartcomm/smartcomm.call.service");
        await clock.scheduleLiveness({
          callId, tenantMeta: tenant, env, atMs: Date.now() + LIVENESS_OFFLINE_S * 1000 + clock.GRACE_MS,
        });
      }
    }).catch(warn("disconnect"));
  });
}

/**
 * Subscribe to the Redis mail bus and re-emit inbound-mail events to each tenant's
 * mail room. Retries until Redis is ready (initRedis resolves shortly after boot).
 * G-7: retries indefinitely with capped backoff instead of giving up after 20
 * tries — if Redis comes up even briefly after boot, live `mail:new` resumes
 * (interval polling remains the safety net regardless).
 */
function attachMailBridge(attempt = 0) {
  let subscriber;
  try {
    subscriber = require("../config/redis").getSubscriber();
  } catch {
    const delay = Math.min(500 * 2 ** Math.min(attempt, 5), 15000); // 500ms → 16s, capped
    setTimeout(() => attachMailBridge(attempt + 1), delay);
    return;
  }
  subscriber.on("error", () => { /* redis will retry via its own reconnect logic */ });
  const { CHANNEL } = require("./mail-bus");
  subscriber.subscribe(CHANNEL).catch((err) => logger.warn({ err }, "[mail-bus] subscribe failed"));
  subscriber.on("message", (channel, message) => {
    if (channel !== CHANNEL || !io) return;
    try {
      const { slug, env, payload } = JSON.parse(message);
      // Every replica receives the bus message and re-emits it, so each must
      // reach only its OWN sockets (io.local): through the redis adapter,
      // `io.to` sent one duplicate `mail:new` per replica (calls audit N2).
      if (slug) io.local.to(mailRoom(slug, ENVS.has(env) ? env : "live")).emit("mail:new", payload || {});
    } catch {
      /* @silent:parse — a malformed message on the bus is not something this
         subscriber can act on, and throwing would detach it from every LATER
         message. */
    }
  });
  logger.info("[mail-bus] realtime bridge attached");
}

/** Emit an event to everyone subscribed to a channel in one env. No-op if
 *  not initialised or without a valid env. */
function publish(tenantSlug, env, groupId, event, payload) {
  if (!io || !tenantSlug || !groupId || !ENVS.has(env)) return;
  io.to(room(tenantSlug, env, groupId)).emit(event, payload);
}

/**
 * The worker has no socket server, so it publishes through the Redis emitter
 * onto the same channels the API's redis adapter subscribes to (calls audit
 * A6: `call:summary_ready` from the pipeline job reached nobody). Created on
 * first use from the shared Redis client.
 */
let emitter = null;
function getEmitter() {
  if (!emitter) {
    const { Emitter } = require("@socket.io/redis-emitter");
    emitter = new Emitter(require("../config/redis").getClient());
  }
  return emitter;
}

/**
 * Emit to ONE user's room for ONE environment, on every app instance: through
 * the socket server in the API, through the Redis emitter in the worker. `env`
 * is required; a publish without a valid one goes nowhere rather than to the
 * live room. Best-effort and never awaited inside a transaction: the row is
 * committed and the badge poll reconciles, so a missed event costs latency.
 */
function publishToUser(tenantSlug, env, userId, event, payload) {
  if (!tenantSlug || !userId || !ENVS.has(env)) return;
  const target = userRoom(tenantSlug, env, userId);
  try {
    if (io) io.to(target).emit(event, payload);
    else getEmitter().to(target).emit(event, payload);
  } catch (err) {
    logger.warn({ err, event }, "realtime: publish to user failed");
  }
}

module.exports = {
  initSocket,
  publish,
  publishToUser,
  joinPersonalRooms,
  attachCallSignals,
  attachPresence,
  attachMailBridge,
  rooms: { room, mailRoom, userRoom },
  setIoForTests: (server) => { io = server; },
  SIGNAL_LIMITS,
  isReady: () => io !== null,
  resetEmitterForTests: () => { emitter = null; },
};
