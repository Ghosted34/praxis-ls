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
 * Rooms are namespaced per tenant + channel: `t:<slug>:c:<groupId>`, so there is
 * no cross-tenant bleed even if two tenants ever shared a channel UUID.
 *
 * Services publish through `publish(tenantSlug, groupId, event, payload)` after
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

const room = (slug, groupId) => `t:${slug}:c:${groupId}`;
const mailRoom = (slug) => `t:${slug}:mail`;
/**
 * One room per USER, for their own notifications.
 *
 * Notifications are the one payload here that is addressed to a person rather
 * than to a channel or a tenant, so they cannot ride `mailRoom` — that reaches
 * every authenticated socket in the tenant, and "your cash request was
 * rejected" is not everyone's business. The room is derived from the socket's
 * AUTHENTICATED user id, never from anything the client sends, so a client
 * cannot join someone else's by asking: there is no `notification:join` event
 * to ask with.
 */
const userRoom = (slug, uid) => `t:${slug}:u:${uid}`;

/**
 * Per-process count of a user's connected sockets, keyed "<slug>:<uid>".
 *
 * Presence math for one replica: a user with two tabs here is still online
 * when one of them closes, and the `online: false` broadcast must wait for
 * the LAST socket on this replica. Cross-replica accuracy comes for free —
 * a disconnect fires on the replica that HELD the socket, so every socket's
 * join/leave is announced exactly once through the adapter.
 */
const userSocketCount = new Map();

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
  io = new Server(httpServer, { cors: { origin: corsOrigin, credentials: true } });

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

    // Every authenticated socket joins its tenant's mail room, so inbound-mail
    // notifications (published from the worker via the Redis bus) reach the
    // Comms → Mail view live. Membership is tenant-scoped; the API still enforces
    // per-record access when the client re-fetches.
    socket.join(mailRoom(tenantSlug));

    // …and their own notification room. Joined here rather than on request for
    // two reasons: there is no client-supplied id to get wrong, and a user who
    // has the app open should be told the moment something lands, not whenever
    // the next 60-second badge poll happens to come round. That poll is what
    // this replaces as the live path; it stays as the reconciler for a socket
    // that was down when the notification was written.
    if (userId) socket.join(userRoom(tenantSlug, userId));

    socket.on("channel:join", async (groupId, ack) => {
      try {
         
        const repo = require("../modules/smartcomm/smartcomm.repo");
        const member = await registry.withTenantConnection(tenant, env, (c) => repo.findMember(c, groupId, userId));
        if (!member) return typeof ack === "function" && ack({ ok: false, error: "NOT_A_MEMBER" });
        socket.join(room(tenantSlug, groupId));
        return typeof ack === "function" && ack({ ok: true });
      } catch {
        return typeof ack === "function" && ack({ ok: false, error: "JOIN_FAILED" });
      }
    });

    socket.on("channel:leave", (groupId) => socket.leave(room(tenantSlug, groupId)));

    // Ephemeral typing indicator — broadcast to others in the room, not persisted.
    socket.on("channel:typing", (groupId) =>
      socket.to(room(tenantSlug, groupId)).emit("channel:typing", { group_id: groupId, user_id: userId }),
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
 * 1:1 call signaling (PR-1) — RELAY ONLY.
 *
 * The server carries the SDP offer/answer and ICE candidates between the two
 * participants and nothing else: it never stores them, never parses them, and
 * the media itself is P2P (guide D4 — our servers relay signaling only). The
 * state machine (RINGING → IN_CALL → terminal) is not driven from here; it
 * lives on the REST paths, because a state change writes a row and this file
 * must not own two sources of truth for one call.
 *
 * Participant check per event, exactly like `channel:join`: the row is the
 * authorisation and it is re-read every time, so a socket that is no longer a
 * participant (removed from the channel mid-call, call already closed) stops
 * being relayed to with no bookkeeping to get wrong. A non-participant's
 * signal is answered with silence, not an error — an error here would be a
 * probe for "is there a call I am not in".
 */
function attachCallSignals(socket) {
  const { tenant, env, tenantSlug, userId } = socket.data;

  async function relay(callId, event, extra) {
    if (typeof callId !== "string") return;
    const callRepo = require("../modules/smartcomm/smartcomm.call.repo");
    const other = await registry.withTenantConnection(tenant, env, (c) =>
      callRepo.otherParticipant(c, { callId, userId }),
    );
    if (!other) return;
    publishToUser(tenantSlug, other.user_id, event, { call_id: callId, ...(extra || {}) });
  }

  socket.on("call:offer", ({ callId, sdp } = {}) => {
    if (sdp) {
      relay(callId, "call:offer", { sdp }).catch((err) =>
        logger.warn({ err, callId }, "call:offer relay failed"),
      );
    }
  });
  socket.on("call:answer", ({ callId, sdp } = {}) => {
    if (sdp) {
      relay(callId, "call:answer", { sdp }).catch((err) =>
        logger.warn({ err, callId }, "call:answer relay failed"),
      );
    }
  });
  socket.on("call:ice", ({ callId, candidate } = {}) => {
    relay(callId, "call:ice", { candidate: candidate || null }).catch((err) =>
      logger.warn({ err, callId }, "call:ice relay failed"),
    );
  });
  socket.on("call:ring_ack", ({ callId, channel } = {}) => {
    // PR-3 (§4.6). The ack is what stops the other channels: it is written to
    // the row (which the delayed push escalation re-reads before it sends) and
    // broadcast to this user's other devices so the desk tab and the phone stop
    // ringing together.
    //
    // The write goes through the SERVICE, not the repo, because the service is
    // where the two rules live that make the ack meaningful: only the callee can
    // ack a ring, and only the FIRST ack counts (a second device acking 20 ms
    // later must not overwrite which channel landed).
    //
    // A failure here is swallowed on purpose: the ring times out on its own 60
    // seconds later, so an unvalidated ack costs at most one push and never the
    // call — and a warning per ack on a flaky network is a log nobody can read.
    if (typeof callId !== "string") return;
    const callService = require("../modules/smartcomm/smartcomm.call.service");
    registry
      .withTenantConnection(tenant, env, (c) =>
        callService.ackRing(c, {
          id: callId,
          actor: { user_id: userId },
          channel: typeof channel === "string" ? channel : "socket",
          tenantSlug,
        }),
      )
      .catch(
        /* @silent:db — see above. */
        () => {},
      );
  });
}

/**
 * Presence + last seen (PR-1, guide §4.11).
 *
 * "Online now" = a socket is connected; the broadcast rides the tenant-wide
 * room (mailRoom — every authenticated socket in the tenant already joins
 * it, so presence needs no new room and no client change to hear it). The
 * persistent half is comms_user_presence.last_seen_at, flushed on connect,
 * on every `comms:seen` beat (the client throttles to one per 60 s), and on
 * disconnect.
 */
function attachPresence(socket) {
  const { tenant, env, tenantSlug, userId } = socket.data;
  if (!userId) return;
  const key = `${tenantSlug}:${userId}`;

  const touch = () => {
    const callRepo = require("../modules/smartcomm/smartcomm.call.repo");
    registry
      .withTenantConnection(tenant, env, (c) => callRepo.touchPresence(c, userId))
      .catch((err) => logger.warn({ err, userId }, "presence flush failed"));
  };

  const n = (userSocketCount.get(key) || 0) + 1;
  userSocketCount.set(key, n);
  touch();
  if (n === 1) {
    io.to(mailRoom(tenantSlug)).emit("comms:presence", { user_id: userId, online: true });
  }

  socket.on("comms:seen", () => touch());

  socket.on("disconnect", () => {
    const left = (userSocketCount.get(key) || 1) - 1;
    if (left <= 0) {
      userSocketCount.delete(key);
      touch();
      io.to(mailRoom(tenantSlug)).emit("comms:presence", { user_id: userId, online: false });
    } else {
      userSocketCount.set(key, left);
    }
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
      const { slug, payload } = JSON.parse(message);
      if (slug) io.to(mailRoom(slug)).emit("mail:new", payload || {});
    } catch {
      /* @silent:parse — a malformed message on the bus is not something this
         subscriber can act on, and throwing would detach it from every LATER
         message. */
    }
  });
  logger.info("[mail-bus] realtime bridge attached");
}

/** Emit an event to everyone subscribed to a channel. No-op if not initialised. */
function publish(tenantSlug, groupId, event, payload) {
  if (!io || !tenantSlug || !groupId) return;
  io.to(room(tenantSlug, groupId)).emit(event, payload);
}

/**
 * Emit to ONE user's notification room, on every app instance.
 *
 * Best-effort by design and silent when the socket server is not up (workers,
 * tests, a cold boot): the notification row is already committed and the badge
 * poll still reconciles, so a missed live event costs latency, never the
 * notification. That is the same contract `publish` has, and it is why neither
 * is ever awaited inside a transaction.
 */
function publishToUser(tenantSlug, userId, event, payload) {
  if (!io || !tenantSlug || !userId) return;
  io.to(userRoom(tenantSlug, userId)).emit(event, payload);
}

module.exports = { initSocket, publish, publishToUser, isReady: () => io !== null };
