"use strict";
/**
 * The mutation-envelope helper.
 *
 * Wraps a service action so its HTTP response body is the shape the client's
 * `useAction` hook and doc/ERROR_HANDLING.md agree on:
 *
 *     { ok: true, changed: true,  data: <payload> }
 *     { ok: true, changed: false, message: "…"    }
 *
 * `changed:false` is the case that made the session-kill bug look like nothing
 * happened. `service.kill()` already returned `{ killed:false }` on an
 * already-killed session (session.service.js:47 — "idempotent, not an error"),
 * but the client had no way to tell that from a successful revocation because
 * the body was answered as 200 either way and nothing in the shape said
 * "no-op". This helper is that shape.
 *
 * `ok:false` is deliberately not part of the shape. Failures throw and are
 * mapped by middleware/error-handler.js, so the client's single source of
 * truth for "did this fail" is `try/catch` — not a body-inspection path that
 * a caller could forget. See §5.1 of the PR guide.
 *
 * ROLLOUT. Wired to the ~25 action endpoints in this PR (POST /kill,
 * /revoke-all, /approve, /transition, /post, /purge, /supersede, /regularize).
 * CRUD writes still return `{ data }` unchanged — `useAction` treats a missing
 * envelope as `changed:true` so the ~466 unconverted routes keep working.
 * A later PR extends coverage and flips the default.
 *
 * WHY NOT 409 FOR IDEMPOTENT SUCCESS. An already-revoked session is not a
 * conflict, and turning idempotent success into a 4xx would break the offline
 * outbox (client/src/lib/outbox.ts) — it replays writes that failed offline,
 * and a replayed successful kill would then surface as an error for an
 * operation that worked. §5.2.
 */

/**
 * Turn a service result into the mutation envelope, classifying it as changed
 * or idempotent no-op.
 *
 * The service can return either a plain payload (treated as `changed:true`,
 * the common case) or a `{ changed, message?, data? }` shape it built
 * itself. The latter is what a service uses when it can distinguish a
 * successful mutation from a no-op — as session.service.js's `kill` does.
 *
 * @template T
 * @param {T | { changed: boolean; message?: string; data?: T }} result
 * @param {object} [opts]
 * @param {string} [opts.idle] Fallback message when the service reports a
 *   no-op without one of its own. Kept short and user-facing — the client
 *   already shows it verbatim in an info toast.
 * @returns {{ ok: true; changed: boolean; data?: T; message?: string }}
 */
function envelope(result, opts = {}) {
  // The self-classifying shape: the service already knew whether it changed
  // anything. Pass through as-is, filling in `data` if omitted so callers see
  // one consistent shape.
  if (result && typeof result === "object" && "changed" in result) {
    const { changed, message, data } = /** @type {any} */ (result);
    if (changed) {
      return { ok: true, changed: true, data: data !== undefined ? data : result };
    }
    return {
      ok: true,
      changed: false,
      message: message || opts.idle || "No change — the record was already in this state.",
    };
  }
  return { ok: true, changed: true, data: result };
}

/**
 * Express handler wrapper. Call the service, wrap the result in the envelope,
 * respond 200.
 *
 * Usage:
 *
 *     const kill = withResult(
 *       (req) => req.identityDb((c) => service.kill(c, { id: req.params.id, actor: req.user })),
 *       { idle: "That session was already revoked" },
 *     );
 *
 * The inner function is exactly the promise-returning body an asyncHandler
 * would wrap; this wraps AND envelopes in one call.
 */
function withResult(fn, opts = {}) {
  return async function withResultHandler(req, res, next) {
    try {
      const result = await fn(req, res);
      // A caller that responded itself (streaming, download) can opt out by
      // returning undefined AFTER writing. Nothing else in this codebase does
      // that today; the check keeps the door closed.
      if (res.headersSent) return;
      res.status(200).json(envelope(result, opts));
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { withResult, envelope };
