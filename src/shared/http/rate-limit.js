/**
 * Shared rate limiters.
 *
 * Audit SEC-C3 (2026-08-04): `/auth/login`, `/auth/refresh`, `/auth/2fa/verify`
 * and `/auth/pin/login` had NO limiter. `forgot-password` and `reset-password`
 * did — so the recovery surface was protected while the surface you attack
 * first was not. Password guessing, refresh-token guessing, TOTP guessing (a
 * six-digit space) and PIN guessing were all unthrottled.
 *
 * Audit SEC-H5, fixed in the same pass because fixing C3 alone would have
 * shipped a limiter that does not limit:
 *
 *   1. **The store was per-process and in-memory.** The deploy runs an `api` and
 *      an `api-standby` container behind nginx (docker-compose.yml,
 *      scripts/deploy.sh), so a `max: 10` limiter actually allowed 10 per
 *      container. Redis-backed here, via the `rate-limit-redis` dependency that
 *      was already declared and never wired.
 *   2. **`trust proxy` was `true`.** Express then believes the LEFTMOST
 *      X-Forwarded-For entry it can reach, which the client controls — so an
 *      attacker rotated their own rate-limit key by sending a different header
 *      on each request. `server.js` now sets a hop count (TRUST_PROXY_HOPS,
 *      default 1 for the single nginx in front), which makes `req.ip` the
 *      address nginx actually saw.
 *
 * Redis is a soft dependency: if it is unavailable the limiter degrades to the
 * in-process store rather than failing the request. That is weaker, and it is
 * logged loudly at boot — an auth endpoint that 500s because the cache is down
 * is a worse outcome than one that is rate-limited per container.
 */

"use strict";

const rateLimit = require("express-rate-limit");
const { logger } = require("../../config/logger");

/** Shared 429 body. Deliberately identical across every limiter: a different
 *  message per endpoint tells an attacker which wall they hit. */
const TOO_MANY = {
  error: {
    code: "RATE_LIMITED",
    message: "Too many attempts. Please try again later.",
  },
};

const BASE = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
};

let store = null;
let storeKind = "memory";

/**
 * Build the Redis store once, lazily, after `initRedis()` has run.
 *
 * Called from server.js at boot rather than at require-time, because the
 * limiters below are constructed when their route module is required — which
 * happens before Redis connects.
 */
function initRateLimitStore() {
  try {
    // Both are already in the dependency tree; `rate-limit-redis` was declared
    // in package.json and imported nowhere before this.
    const { RedisStore } = require("rate-limit-redis");
    const { getClient } = require("../../config/redis");
    const client = getClient();
    store = new RedisStore({
      sendCommand: (...args) => client.call(...args),
      prefix: "rl:",
    });
    storeKind = "redis";
    logger.info({ store: storeKind }, "rate-limit store ready");
  } catch (err) {
    storeKind = "memory";
    logger.warn(
      { err },
      "rate-limit store falling back to in-memory — limits are PER PROCESS, so " +
        "a multi-container deploy enforces N times the configured maximum",
    );
  }
  return storeKind;
}

/** Which store ended up in use. Exposed for the readiness probe and tests. */
function rateLimitStoreKind() {
  return storeKind;
}

/**
 * A limiter that resolves its store at request time, so limiters constructed at
 * require-time still pick up the Redis store initialised later at boot.
 */
function makeLimiter({ name, max, windowMs, keyGenerator }) {
  const limiter = rateLimit({
    ...BASE,
    ...(windowMs ? { windowMs } : {}),
    max,
    ...(keyGenerator ? { keyGenerator } : {}),
    // express-rate-limit calls store methods per request; handing it a thin
    // proxy lets `initRateLimitStore()` land after these objects exist.
    store: {
      init(options) {
        this._options = options;
      },
      async increment(key) {
        const s = store;
        if (!s) return { totalHits: 1, resetTime: undefined };
        if (!s._praxisInit) {
          s.init(this._options);
          s._praxisInit = true;
        }
        return s.increment(key);
      },
      async decrement(key) {
        return store && store.decrement ? store.decrement(key) : undefined;
      },
      async resetKey(key) {
        return store && store.resetKey ? store.resetKey(key) : undefined;
      },
    },
  });

  // express-rate-limit returns an ANONYMOUS function, so a route's middleware
  // stack gives no way to tell a limiter from any other handler by name. That
  // matters: the structural test for SEC-C3 has to be able to assert "this
  // route is limited", and a test that cannot see the control is exactly the
  // failure mode this whole pass is about. Tag it explicitly.
  limiter.praxisRateLimit = name || "unnamed";
  limiter.praxisRateLimitMax = max;
  return limiter;
}

/**
 * PERF S18 — the global ceiling. Nothing limited the API as a whole.
 *
 * Every existing limiter guards one authentication route (SEC-C3). Beyond
 * those, any caller could issue unlimited requests: a runaway client loop, a
 * scraper, or one tenant's integration retrying hard consumed the single
 * Postgres, the single Redis and the single host that every OTHER tenant is
 * served from. On a shared-nothing deployment that is one customer's problem;
 * here it is everyone's, and there was no signal until the box fell over.
 *
 * KEYED BY TENANT FIRST, then IP. Keying on IP alone is wrong in both
 * directions here: an office behind one NAT looks like a single abusive client,
 * while a distributed integration for one tenant looks like a thousand innocent
 * ones. The tenant slug is the unit of fairness, because the tenant is what the
 * capacity is shared between. IP is the fallback before the Host resolves and
 * for the platform surface.
 *
 * SET HIGH ON PURPOSE. This is a CIRCUIT BREAKER, not a quota — it exists to
 * stop one caller taking the estate down, not to shape normal traffic. A busy
 * screen fans out to a dozen calls, so a working day of heavy use must sit
 * comfortably underneath it. A ceiling that trips on legitimate use gets raised
 * in a panic during an incident, and then it is not a control any more.
 * Deliberately generous, and worth revisiting with real numbers once
 * `praxis_http_requests_total` has some history.
 */
const apiLimiter = makeLimiter({
  name: "api-global",
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API_PER_MIN || 600),
  keyGenerator: (req) => {
    const tenant = req.tenant && req.tenant.slug;
    if (tenant) return `tenant:${tenant}`;
    return `ip:${req.ip}`;
  },
});

/** True if an Express layer handle is one of our limiters. */
function isRateLimiter(handle) {
  return Boolean(handle && handle.praxisRateLimit);
}

/**
 * Credential-guessing surfaces. 10 attempts / 15 min / IP.
 *
 * Sized against a human who mistypes a password a few times and a bot that does
 * not. It is intentionally NOT per-account: keying on the submitted email would
 * let anyone lock a colleague out by failing their login ten times, which trades
 * a brute-force problem for a denial-of-service one. Account lockout is a
 * separate control (the `failed_login_count` column that SEC-C3 also notes is
 * never enforced) and wants its own decision.
 */
const loginLimiter = makeLimiter({ name: "login", max: 10 });

/** TOTP is a 6-digit space — 1,000,000 codes, valid for ~30s. Tighter. */
const totpLimiter = makeLimiter({ name: "totp", max: 5 });

/** Device PIN is short by design; the device binding is the real control. */
const pinLimiter = makeLimiter({ name: "pin", max: 5 });

/**
 * Refresh is called legitimately by every open tab on a timer, so this is set
 * to catch token guessing, not to police normal traffic. A 15-minute access TTL
 * across a handful of tabs stays well under this.
 */
const refreshLimiter = makeLimiter({ name: "refresh", max: 60 });

/** Enumeration / spam surface on public recovery. */
const forgotLimiter = makeLimiter({ name: "forgot", max: 5 });
const resetLimiter = makeLimiter({ name: "reset", max: 10 });

module.exports = {
  initRateLimitStore,
  rateLimitStoreKind,
  makeLimiter,
  isRateLimiter,
  apiLimiter,
  loginLimiter,
  totpLimiter,
  pinLimiter,
  refreshLimiter,
  forgotLimiter,
  resetLimiter,
  TOO_MANY,
};
