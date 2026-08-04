/**
 * Structured logging with Pino.
 *
 * Use logger.info({ key: 'value' }, 'message') — never string-format JSON.
 * Pretty-printed in dev, JSON in production.
 */

"use strict";

const pino = require("pino");

const isDev =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

/**
 * Fields that must never reach a log line.
 *
 * Widened 2026-08-04 (audit OBS-L4 / SEC-L4). Three things were wrong, and the
 * third one bit the first version of this very fix:
 *
 * 1. **Pino path matching is LITERAL, not substring.** `*.password` matches a
 *    key named exactly `password`. It does not match `password_hash`,
 *    `refresh_token`, `access_token`, `totp_secret_enc` or `secret_enc` — all
 *    of which were being written in full.
 *
 * 2. **The worst leak was not a named field at all.** `logger.error({ err, sql })`
 *    in config/database.js and middleware/error-handler.js serialises a pg error
 *    object, and a unique-violation carries
 *        detail: "Key (email)=(someone@example.com) already exists"
 *    so a duplicate-signup attempt wrote a customer's address to disk in plain
 *    text, from a call site that looks entirely innocent.
 *
 * 3. **A wildcard spans exactly ONE intermediate level, and does not cover the
 *    top level at all.** `*.password_hash` matches `{ user: { password_hash } }`
 *    but NOT `{ password_hash }` — so a list that looked complete still let
 *    `logger.info({ password_hash: row.password_hash })` through. Both forms are
 *    generated from SENSITIVE_KEYS below so neither shape can be missed, and
 *    `req.body.user.password` is listed explicitly because it sits two levels
 *    down.
 *
 * ORDERING CONSTRAINT: this had to land BEFORE log shipping (OBS-L7, Phase 2).
 * Shipping first exports every one of the above to a third party, and you
 * cannot un-send it.
 *
 * REDACT_PATHS is exported so tests/unit/log-redaction.test.js asserts against
 * the list that actually ships rather than a copy — a copy drifts, and then the
 * test guards something that is no longer what runs.
 */
const SENSITIVE_KEYS = [
  "password",
  "password_hash",
  "confirm_password",
  "new_password",
  "current_password",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "secret",
  "secret_enc",
  "totp_secret",
  "totp_secret_enc",
  "api_key",
  "apiKey",
  "private_key",
  "client_secret",
  "bank_account_number",
  "pin",
  "pin_hash",
];

const REDACT_PATHS = [
  ...SENSITIVE_KEYS,          // top level:  { password_hash: … }
  ...SENSITIVE_KEYS.map((k) => `*.${k}`), // one level deep: { user: { password_hash: … } }
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "req.body.password",
  "req.body.confirm_password",
  "req.body.new_password",
  "req.body.current_password",
  "req.body.token",
  "req.body.refresh_token",
  "req.body.pin",
  "req.body.user.password",
  "res.headers['set-cookie']",
  // pg error objects: `detail` quotes the offending ROW VALUES, and `where`
  // can quote a PL/pgSQL context line containing them.
  "err.detail",
  "err.where",
  "error.detail",
];

/**
 * Attach the ambient tenant/user to EVERY log line (audit OBS-L3, Critical).
 *
 * The audit found that of ~120 logger call sites, not one carried a tenant
 * identifier and only a handful carried a user. In a database-per-tenant ERP
 * that means an error spike cannot answer the first question anyone asks in an
 * incident — "is one tenant broken, or is everyone broken?"
 *
 * The obvious fix is to add `{ tenant }` to 120 call sites. That is the wrong
 * fix twice over: it is a large mechanical diff that will miss some, and every
 * log line written afterwards has to remember. A pino `mixin` runs on every
 * line and reads the AsyncLocalStorage that `config/request-context.js` already
 * populates for RLS — so existing call sites need no edit, and new ones cannot
 * forget.
 *
 * Notes:
 *   - `require` is inside the function to avoid a require-time cycle:
 *     request-context is dependency-free, but logger is required extremely
 *     early (env.js, boot) and this keeps the edge one-directional.
 *   - Nothing is emitted when there is no context — background workers, crons
 *     and boot legitimately have none, and `tenant: null` on every line of a
 *     worker log is noise, not signal.
 *   - Explicit fields WIN. `mixinMergeStrategy` puts the call site's own object
 *     last, so `logger.info({ tenant: other }, …)` is not silently overwritten
 *     by the ambient value.
 *   - `cross_tenant` is surfaced rather than hidden: a CEO/group request reading
 *     across tenants is exactly what you want to be able to find later.
 */
function contextMixin() {
  let ctx;
  try {
    ctx = require("./request-context").get();
  } catch {
    return {};
  }
  if (!ctx) return {};
  const out = {};
  if (ctx.tenant) out.tenant = ctx.tenant;
  if (ctx.userId) out.user_id = ctx.userId;
  if (ctx.crossTenant) out.cross_tenant = true;
  return out;
}

const baseConfig = {
  level: process.env.LOG_LEVEL || "info",
  base: {
    app: process.env.APP_NAME || "praxis-ls-api",
    env: process.env.NODE_ENV || "development",
  },
  mixin: contextMixin,
  // Call-site fields take precedence over the ambient ones.
  mixinMergeStrategy(mergeObject, mixinObject) {
    return Object.assign({}, mixinObject, mergeObject);
  },
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

const logger = isDev
  ? pino({
      ...baseConfig,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    })
  : pino(baseConfig);

module.exports = { logger, REDACT_PATHS, contextMixin };
