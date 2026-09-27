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
 * Redis is a soft dependency: if the Redis store cannot be built, each limiter
 * counts in its own express-rate-limit `MemoryStore` instead of failing the
 * request. That is weaker (limits are per process), and it is logged at WARN at
 * boot — an auth endpoint that 500s because the cache is down is a worse outcome
 * than one that is rate-limited per container. It never means "unlimited".
 */

"use strict";

const rateLimit = require("express-rate-limit");
const { MemoryStore } = rateLimit;
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
function makeLimiter({ name, max, windowMs, keyGenerator, failuresOnly = false }) {
  const limiter = rateLimit({
    ...BASE,
    ...(windowMs ? { windowMs } : {}),
    max,
    ...(keyGenerator ? { keyGenerator } : {}),
    // Count only the attempts that FAILED. See "FAILURES, NOT SIGN-INS" below.
    ...(failuresOnly ? { skipSuccessfulRequests: true } : {}),
    // express-rate-limit calls store methods per request; handing it a thin
    // proxy lets `initRateLimitStore()` land after these objects exist.
    store: {
      init(options) {
        this._options = options;
      },
      /** The shared Redis store once it exists; until then (or if it never
       *  does) this limiter's own in-process MemoryStore. */
      active() {
        if (store) {
          if (!store._praxisInit) {
            store.init(this._options);
            store._praxisInit = true;
          }
          return store;
        }
        if (!this._memory) {
          this._memory = new MemoryStore();
          this._memory.init(this._options);
        }
        return this._memory;
      },
      async increment(key) {
        return this.active().increment(key);
      },
      async decrement(key) {
        return this.active().decrement(key);
      },
      async resetKey(key) {
        return this.active().resetKey(key);
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
  limiter.praxisRateLimitFailuresOnly = failuresOnly;
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
/*
 * ── FAILURES, NOT SIGN-INS ──────────────────────────────────────────────────
 *
 * These limiters are keyed by IP, and an office is one IP. They used to count
 * EVERY request, successful ones included — so the eleventh person in a
 * twenty-person office to sign in within a quarter of an hour was told "Too
 * many attempts", having made one. The two-hour session ceiling makes that
 * the normal case rather than the Monday-morning one: everyone who signed in
 * at 08:00 unlocks at 10:00. And refresh was worse: 60 per 15 minutes shared by
 * every open tab in the building, where a 429 is indistinguishable from a dead
 * session and LOCKS the screen.
 *
 * What these defend against is guessing, and a guess is an attempt that
 * FAILED. So the credential limiters count failures only
 * (`skipSuccessfulRequests`): a hundred people signing in correctly cost
 * nothing, and a script working through PINs is stopped exactly as before.
 */
const loginLimiter = makeLimiter({ name: "login", max: 10, failuresOnly: true });

/** TOTP is a 6-digit space — 1,000,000 codes, valid for ~30s. Tighter. */
const totpLimiter = makeLimiter({ name: "totp", max: 5, failuresOnly: true });

/**
 * Device PIN is short by design; the device binding is the real control (five
 * wrong PINs revoke the device). Ten failures per IP leaves room for an office
 * of honest typos while still stopping a spray across devices.
 */
const pinLimiter = makeLimiter({ name: "pin", max: 10, failuresOnly: true });

/**
 * Refresh is called legitimately by every open tab on a timer, so this is set
 * to catch token guessing — failed refreshes — and never to police normal
 * traffic, where a 429 would lock a working user's screen.
 */
const refreshLimiter = makeLimiter({ name: "refresh", max: 60, failuresOnly: true });

/** Enumeration / spam surface on public recovery. */
const forgotLimiter = makeLimiter({ name: "forgot", max: 5 });
const resetLimiter = makeLimiter({ name: "reset", max: 10 });

/**
 * Self-service change-password. Behind authMiddleware, so this is not an
 * anonymous guessing surface — but it DOES compare a submitted current password,
 * which makes it the one place a stolen access token can be turned into a
 * permanent takeover by guessing. Sized like login: a human who mistypes their
 * old password a few times is fine, a script working through candidates is not.
 *
 * KEYED BY USER, not by IP — the opposite call to loginLimiter, and for the
 * reason that made loginLimiter per-IP: keying a PUBLIC route per account lets
 * anyone lock a colleague out, but here the caller has already proved who they
 * are, so the only account a key can exhaust is the caller's own. Per-IP would
 * meanwhile let one office behind one NAT exhaust the budget for everyone in it.
 * IP remains the fallback for a request that somehow arrives unauthenticated.
 */
const changePasswordLimiter = makeLimiter({
  name: "change-password",
  max: 10,
  keyGenerator: (req) => (req.user && req.user.user_id ? `user:${req.user.user_id}` : `ip:${req.ip}`),
});

/**
 * WebAuthn passkey verification and enrolment — failed assertions / attestation
 * spam. A signature cannot be guessed, so this is about cost, not odds.
 */
const webauthnLimiter = makeLimiter({ name: "webauthn", max: 20, failuresOnly: true });

/**
 * Passkey sign-in OPTIONS always succeed and read no table (they reveal nothing
 * — see webauthn.service), so counting failures would count nothing. Counted in
 * full, and sized for an office unlocking at once after the two-hour lock.
 */
const webauthnOptionsLimiter = makeLimiter({ name: "webauthn-options", max: 300 });

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
  changePasswordLimiter,
  webauthnLimiter,
  webauthnOptionsLimiter,
  TOO_MANY,
};
