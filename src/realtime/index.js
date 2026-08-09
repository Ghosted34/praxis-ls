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
      /* ignore malformed bus messages */
    }
  });
  logger.info("[mail-bus] realtime bridge attached");
}

/** Emit an event to everyone subscribed to a channel. No-op if not initialised. */
function publish(tenantSlug, groupId, event, payload) {
  if (!io || !tenantSlug || !groupId) return;
  io.to(room(tenantSlug, groupId)).emit(event, payload);
}

module.exports = { initSocket, publish, isReady: () => io !== null };
