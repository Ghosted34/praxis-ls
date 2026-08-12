/**
 * Idempotency — the same write, sent twice, happens once.
 *
 * WHY THIS EXISTS. The client holds writes that failed on a dead network and
 * replays them when the connection returns (client/src/lib/outbox.ts). That
 * rescue is only safe if a replay can be told apart from a genuine second
 * write, and the browser cannot tell us which it is: a rejected `fetch` covers
 * both "the request never left" and "the request was processed and the response
 * was lost coming back". Replaying blindly would let one press of Save post two
 * supplier invoices. In an OHADA ledger that is a material misstatement, so the
 * offline rescue could not ship without this.
 *
 * THE CONTRACT. A client sends `Idempotency-Key: <opaque token>` on an unsafe
 * method. The first request to arrive claims the key, runs normally, and has its
 * response recorded against it. Any later request bearing the same key is
 * answered from that record and does no work — the caller gets the ORIGINAL
 * response, including the created row's id, and can carry on as if its first
 * attempt had succeeded (which, as far as the ledger is concerned, it did).
 *
 * FOUR OUTCOMES, and the reasoning for each:
 *
 *   claimed        No such key. This request owns it. Proceed and record.
 *   replayed  200  Key completed earlier, same request. Return what we returned
 *                  then. This is the case the whole feature is for.
 *   in progress 409 Key claimed and still running. Two identical writes racing
 *                  is precisely what must not happen, so the second is refused
 *                  rather than queued — the client already knows how to retry.
 *   reused    422  Key completed earlier for a DIFFERENT request. That is a bug
 *                  or an attack, never a replay, and returning the stored
 *                  response would hand the caller someone else's data.
 *
 * FAILURES RELEASE THE KEY. A request that ends 4xx/5xx deletes its claim,
 * because nothing was committed and the user must be free to fix their input
 * and try again. Caching a 422 would pin them to their own typo.
 *
 * IT IS NEVER FATAL. A tenant whose schema predates migration 0660 has no
 * `idempotency_key` table; a database hiccup here is not a reason to fail a
 * write the user is waiting on. Both cases log and pass the request through
 * unchanged — i.e. degrade to exactly the behaviour that existed before this
 * file. The client's replay is then no worse off than it was, and no better.
 *
 * MOUNTED ONCE, on the tenant router (src/routes/index.js), above the module
 * loader — so every tenant write endpoint is covered without ~700 routes having
 * to opt in. Requests without the header are untouched, which is all of them
 * until a client chooses otherwise.
 */
"use strict";

const crypto = require("node:crypto");
const { AppError } = require("../utils/errors");
const { logger } = require("../config/logger");

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * A key is an opaque token, but it is also going into a primary key and a log
 * line, so it gets a shape. Generous enough for a UUID, a ULID or a caller's
 * own scheme; tight enough that nothing surprising reaches the database.
 */
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

/**
 * An in-flight claim older than this is assumed dead — the process that took it
 * was killed, or the request was abandoned. Without a reclaim window, one crash
 * mid-write would lock that key out permanently and the user's retry would 409
 * forever. Five minutes is comfortably longer than any request this API serves
 * and short enough that a real recovery is not left waiting.
 */
const STALE_CLAIM = "5 minutes";

/** SHA-256 over the parts a replay must match. */
function hashRequest(method, path, body) {
  const h = crypto.createHash("sha256");
  h.update(method);
  h.update("\n");
  h.update(path);
  h.update("\n");
  // `body` is whatever express.json parsed. Stringifying the parsed object
  // rather than the raw bytes is deliberate: a client that re-serialises its
  // payload before a replay (ours does — the outbox stores the object, not the
  // wire form) would otherwise produce a different hash for an identical
  // request and be told it was reusing the key.
  try {
    h.update(JSON.stringify(body ?? null));
  } catch {
    h.update("unserialisable");
  }
  return h.digest("hex");
}

/**
 * Take the key, or find out who already has it.
 *
 * The INSERT … ON CONFLICT DO UPDATE … WHERE is one statement on purpose: two
 * concurrent replays of the same key must not both see "no row" and both
 * proceed. The conflicting row is locked by the UPDATE, so the loser observes
 * the winner's claim rather than racing it. The WHERE only reclaims a row that
 * has expired or gone stale, so a live claim returns nothing and we fall
 * through to reading it.
 */
async function claim(db, { key, method, path, hash }) {
  const { rows } = await db.query(
    `INSERT INTO idempotency_key (key, method, path, request_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE
        SET method       = EXCLUDED.method,
            path         = EXCLUDED.path,
            request_hash = EXCLUDED.request_hash,
            state        = 'in_flight',
            status_code  = NULL,
            response_body= NULL,
            completed_at = NULL,
            created_at   = now(),
            expires_at   = now() + interval '48 hours'
      WHERE idempotency_key.expires_at <= now()
         OR (idempotency_key.state = 'in_flight'
             AND idempotency_key.created_at < now() - interval '${STALE_CLAIM}')
     RETURNING key`,
    [key, method, path, hash],
  );
  return rows.length > 0;
}

async function existing(db, key) {
  const { rows } = await db.query(
    `SELECT state, status_code, response_body, request_hash
       FROM idempotency_key
      WHERE key = $1 AND expires_at > now()`,
    [key],
  );
  return rows[0] || null;
}

function idempotency(req, res, next) {
  const method = String(req.method || "").toUpperCase();
  if (!UNSAFE.has(method)) return next();

  const key = String(req.headers["idempotency-key"] || "").trim();
  if (!key) return next();

  /**
   * NO CREDENTIAL, NO CLAIM.
   *
   * This is mounted above the module loader so it covers every tenant write
   * without ~700 routes opting in — which also means it runs BEFORE each
   * module's auth middleware. Without this guard, an unauthenticated request
   * carrying an attacker-chosen key would take a connection from the tenant
   * pool and INSERT a row, before anything had established the caller was
   * allowed to be here: a cheap way to churn the pool and fill the table.
   *
   * A request with no bearer token is going to 401 downstream anyway, and a
   * 401 needs no replay protection — there is no write to protect.
   */
  const authorization = req.headers.authorization || "";
  if (!/^Bearer\s+\S/i.test(authorization)) return next();

  if (!KEY_PATTERN.test(key)) {
    return next(
      new AppError(
        "IDEMPOTENCY_KEY_INVALID",
        "Idempotency-Key must be 8–200 characters of letters, digits, dot, underscore, colon or hyphen.",
        400,
      ),
    );
  }

  // `originalUrl` rather than `path`: two endpoints can share a path and differ
  // only by query string, and a replay must match the request that was actually
  // made, query included.
  const path = req.originalUrl || req.url;
  const hash = hashRequest(method, path, req.body);

  req
    .tenantDb((db) => claim(db, { key, method, path, hash }))
    .then(async (mine) => {
      if (mine) {
        capture(req, res, key, method, path);
        return next();
      }

      const row = await req.tenantDb((db) => existing(db, key));
      if (!row) {
        // It expired between the claim attempt and this read. Vanishingly rare,
        // and the safe reading is "we do not know what happened before" — so
        // run it, rather than replay a response we no longer hold.
        capture(req, res, key, method, path);
        return next();
      }

      if (row.request_hash !== hash) {
        throw new AppError(
          "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key was already used for a different request. Use a new key.",
          422,
        );
      }

      if (row.state === "in_flight") {
        // 409 rather than blocking: holding the socket open would tie up a
        // connection from the tenant pool for the duration of a request we are
        // not serving, and the caller is a retry loop that can simply come back.
        res.setHeader("Retry-After", "2");
        throw new AppError(
          "IDEMPOTENCY_IN_PROGRESS",
          "An identical request is still being processed. Try again in a moment.",
          409,
        );
      }

      // The replay. `Idempotency-Replayed` tells an honest client that its
      // earlier attempt DID land — which is the difference between "created"
      // and "already created", and worth surfacing rather than hiding.
      res.setHeader("Idempotency-Replayed", "true");
      return res.status(row.status_code || 200).json(row.response_body);
    })
    .catch((err) => {
      if (err instanceof AppError) return next(err);
      // Missing table (un-migrated tenant), a dead pool, anything else: this
      // middleware is a safety net, not a gate. Failing the write here would
      // make the feature that protects against data loss a cause of it.
      logger.warn({ err, key }, "idempotency check unavailable — proceeding without replay protection");
      return next();
    });
}

/**
 * Record the outcome against the claimed key.
 *
 * `res.json` is wrapped rather than `res.on('finish')` for two reasons, both of
 * which are correctness rather than taste:
 *
 *   1. `tenantContext` registers its connection release on 'finish' BEFORE this
 *      middleware runs, so a listener added here fires after `req.releaseDb()`
 *      and would have no database connection to write with.
 *   2. The response must not be sent until the outcome is recorded. If the
 *      client learns "created" before the row is stored, a replay arriving in
 *      that window sees an in-flight claim — or, once it expires, executes
 *      again. Delaying the send by one small UPDATE closes that window
 *      completely.
 *
 * Every tenant response goes through `res.json`, successes and errors alike
 * (see src/middleware/error-handler.js), so this catches both.
 */
function capture(req, res, key, method, path) {
  const send = res.json.bind(res);
  const end = res.end.bind(res);
  let done = false;

  /**
   * Not every response goes through `res.json`. A 204 from a DELETE, a
   * `res.sendStatus()`, a streamed export — all of them finish via `res.end`
   * and would leave the claim `in_flight`, so the client's retry would meet a
   * 409 for the whole five-minute stale window instead of the original answer.
   *
   * Those responses carry no JSON body to replay, so the honest thing is to
   * RELEASE the key rather than store an empty one: the next attempt re-runs
   * the request, which is the behaviour that existed before this middleware.
   * Deleting after `end` is safe — the tenant lease is released on 'finish',
   * which fires after this returns, and a failed delete only leaves a row that
   * expires on its own.
   */
  res.end = (...args) => {
    if (!done) {
      done = true;
      req
        .tenantDb((db) => db.query(`DELETE FROM idempotency_key WHERE key = $1`, [key]))
        .catch((err) => logger.warn({ err, key, method, path }, "could not release idempotency claim"));
    }
    return end(...args);
  };

  res.json = (body) => {
    if (done) return send(body);
    done = true;

    const status = res.statusCode || 200;
    const ok = status >= 200 && status < 300;
    const userId = req.user ? req.user.user_id : null;

    const write = ok
      ? req.tenantDb((db) =>
          db.query(
            `UPDATE idempotency_key
                SET state = 'completed', status_code = $2, response_body = $3,
                    user_id = COALESCE($4, user_id), completed_at = now()
              WHERE key = $1`,
            [key, status, JSON.stringify(body ?? null), userId],
          ),
        )
      : // Released, not recorded: nothing was committed, so the caller must be
        // able to correct the request and send it again under the same key.
        req.tenantDb((db) => db.query(`DELETE FROM idempotency_key WHERE key = $1`, [key]));

    write
      .catch((err) => {
        logger.warn({ err, key, method, path }, "could not record idempotency outcome");
      })
      .finally(() => send(body));

    return res;
  };
}

module.exports = { idempotency, hashRequest, KEY_PATTERN };
