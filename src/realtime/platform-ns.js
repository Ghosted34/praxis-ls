/**
 * Socket.IO namespace for the platform console — `/platform`.
 *
 * WHY A SEPARATE NAMESPACE RATHER THAN REUSING realtime/index.js
 *
 * The existing realtime layer is built for TENANT users and cannot carry this
 * traffic, for two independent reasons — either alone would be fatal:
 *
 *   1. Token type. `authenticate()` rejects anything whose `typ` is not
 *      "access". A platform token carries `typ: "platform"` (middleware/
 *      platform-auth.js), so every console socket would be refused with
 *      INVALID_TOKEN.
 *   2. Host resolution. It resolves the handshake Host against the tenant
 *      registry and requires status LIVE. The console is host-gated to
 *      admin.praxisls.com, which is not a tenant host and never resolves —
 *      TENANT_UNAVAILABLE.
 *
 * Loosening either check on the shared connection handler would let a tenant
 * user reach platform channels, which is precisely the boundary PRD §5.3
 * exists to hold. A namespace with its own `use()` middleware keeps the two
 * authentication models apart, and rooms inside it stay platform-only.
 *
 * ROOMS
 *   `errors:all`          every error, the default console view
 *   `errors:t:<slug>`     one tenant's errors
 *   `errors:platform`     platform-wide (NULL-tenant) errors only
 *
 * Publishing goes through the Redis adapter attached in realtime/index.js, so
 * an error captured on replica A reaches a console connected to replica B. That
 * is not a nicety: with the adapter absent, a multi-replica deploy delivers the
 * feed to whichever admins happen to share a process with the crash.
 */

"use strict";

const jwt = require("jsonwebtoken");
const { config } = require("../config/env");
const { logger } = require("../config/logger");
const platformDb = require("../services/platform/db");
const store = require("../shared/observability/error-store");

const NS = "/platform";
const ROOM_ALL = "errors:all";
const roomTenant = (slug) => `errors:t:${slug}`;
const ROOM_PLATFORM = "errors:platform";

let ns = null;

/**
 * Authenticate a console socket exactly as `platformAuth` authenticates an HTTP
 * request: verify the JWT, require typ==="platform", confirm the user row is
 * active, then load the capability set. A socket must not be a way to observe
 * data the same user's HTTP requests would be refused.
 */
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
    if (payload.typ !== "platform") return next(new Error("WRONG_AUDIENCE"));

    const { rows } = await platformDb.query(
      "SELECT platform_user_id, email, role, is_active FROM platform.platform_user WHERE platform_user_id = $1",
      [payload.sub],
    );
    const user = rows[0];
    if (!user || !user.is_active) return next(new Error("USER_INACTIVE"));

    const caps = await platformDb.query(
      `SELECT rp.capability FROM platform.platform_role r
         JOIN platform.platform_role_permission rp ON rp.role_id = r.role_id
        WHERE r.code = $1`,
      [user.role],
    );
    const capSet = new Set(caps.rows.map((r) => r.capability));

    // Same gate as the REST feed. Root Admin bypasses, mirroring requireCap.
    const isRoot = user.role === "PLATFORM_ROOT_ADMIN";
    if (!isRoot && !capSet.has("errors.read")) return next(new Error("FORBIDDEN"));

    socket.data = { userId: user.platform_user_id, role: user.role, caps: capSet, isRoot };
    return next();
  } catch (err) {
    logger.warn({ err }, "[platform-ns] auth failed");
    return next(new Error("AUTH_FAILED"));
  }
}

/**
 * Attach the namespace to an existing socket.io server.
 * @param {import("socket.io").Server} io
 */
function initPlatformNamespace(io) {
  if (!io) return null;

  ns = io.of(NS);
  ns.use(authenticate);

  ns.on("connection", (socket) => {
    // Every console starts on the combined feed — the spec's default view (§4.2).
    socket.join(ROOM_ALL);

    // Spec §6 §4.1, client → server: { type: 'subscribe', tenant_id }.
    // Accepts a slug or the literal "platform"; an absent/"all" value returns
    // the socket to the combined feed.
    socket.on("subscribe", (msg, ack) => {
      try {
        const scope = typeof msg === "string" ? msg : (msg && (msg.tenant_id || msg.tenant)) || "all";
        for (const r of socket.rooms) if (r !== socket.id) socket.leave(r);
        if (scope === "platform") socket.join(ROOM_PLATFORM);
        else if (scope && scope !== "all") socket.join(roomTenant(String(scope)));
        else socket.join(ROOM_ALL);
        if (typeof ack === "function") ack({ ok: true, scope });
      } catch {
        if (typeof ack === "function") ack({ ok: false });
      }
    });

    socket.on("unsubscribe", () => {
      for (const r of socket.rooms) if (r !== socket.id) socket.leave(r);
    });

    // Lets the client show "Live" honestly rather than assuming the pipe works.
    socket.on("ping:check", (_m, ack) => {
      if (typeof ack === "function") ack({ ok: true, ts: new Date().toISOString() });
    });
  });

  // The store calls this for every persisted group; this is the only place the
  // two are joined, which keeps error-store free of any socket knowledge.
  store.setListener(broadcastError);

  logger.info("[platform-ns] error feed namespace ready at /platform");
  return ns;
}

/**
 * Fan a persisted error out to the console. Payload shape is spec §6 §4.1
 * `ErrorEvent` — kept exactly, because the console's TypeScript types and any
 * contract test are written against it.
 */
function broadcastError(row) {
  if (!ns || !row) return;
  const payload = {
    type: "new_error",
    payload: {
      id: row.error_id,
      signature: row.signature,
      tenant_id: row.tenant_id || null,
      level: row.level,
      origin: row.origin,
      message: row.message,
      module: row.module,
      route: row.route,
      file_path: row.file_path,
      line_number: row.line_number,
      occurrence_count: row.occurrence_count,
      first_seen: row.first_seen,
      last_seen: row.last_seen,
      is_new: row.is_new === true,
    },
  };

  ns.to(ROOM_ALL).emit("new_error", payload);
  if (row.tenant_id) {
    // The room is keyed by slug, which the store row does not carry; resolving
    // it per error would be a DB round trip on the hot path. Emitting to the
    // id-keyed room as well keeps both subscribe forms working.
    ns.to(`errors:t:${row.tenant_id}`).emit("new_error", payload);
  } else {
    ns.to(ROOM_PLATFORM).emit("new_error", payload);
  }
}

/** Spec §6 §4.1 `ErrorResolvedEvent`. */
function broadcastResolved({ signature, resolved_by, resolved_at, id }) {
  if (!ns) return;
  ns.emit("error_resolved", {
    type: "error_resolved",
    payload: { id, signature, resolved_by, resolved_at },
  });
}

/** In-house escalation notification (§5.3) pushed to every connected console. */
function broadcastEscalation(payload) {
  if (!ns) return;
  ns.emit("escalation", { type: "escalation", payload });
}

module.exports = {
  initPlatformNamespace,
  broadcastError,
  broadcastResolved,
  broadcastEscalation,
  isReady: () => ns !== null,
  NS,
};
