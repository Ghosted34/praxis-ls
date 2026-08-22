/**
 * §9.5 at the ROUTE layer — the gate the audit's C-4 says was missing.
 *
 * WHY THIS FILE EXISTS
 *
 * The visibility predicate itself has always been correct and has always lived
 * in exactly one place (`triage/visibility.js`). What was missing was any
 * discipline about *applying* it: the list, the detail read, search, the
 * timeline and AI grounding all went through repo builders that carry it, and
 * roughly thirty other thread-scoped routes — notes, cards, suggestions, bind,
 * snooze, follow-up, lock, shares, OCR, AI draft — reached the same rows by id
 * with nothing checking that the caller may see them.
 *
 * `mail-visibility-wiring.test.js` asserted the predicate on the repo builders
 * and on four named call sites, so every one of those routes passed every gate.
 * The lesson the in-house field notes drew from FN-2 — "a write that RETURNS
 * the row is a read" — was applied to four triage writes and never enumerated
 * across the module.
 *
 * So the predicate moves to where routes cannot forget it. Every thread-,
 * message- and attachment-scoped route in the mail module mounts one of these,
 * and `tests/security/mail-route-visibility.test.js` walks the mounted routers
 * and FAILS on any such route that does not. A new route is now gated by
 * default-or-fail rather than by whether its author remembered.
 *
 * WHY 404 AND NOT 403
 *
 * Every refusal here answers `NOT_FOUND`, identical to a thread that does not
 * exist. A 403 on a private thread confirms the thread is real, which for a
 * conversation whose existence is the sensitive part (a grievance, a
 * termination, an acquisition) is most of the disclosure. This also means these
 * routes cannot be used as existence oracles by iterating ids — which
 * `POST /threads/:id/snooze` and `/followup` previously were, purely through
 * their FK failing differently for a real id than a fake one.
 *
 * WHY A GATE READ AND NOT ONLY AN IN-STATEMENT PREDICATE
 *
 * Both, where a write is involved. The gate answers "may this caller see this
 * thread at all" before any work happens; the predicate riding inside the
 * UPDATE closes the window in which the thread's visibility changed between the
 * two. The four triage writes that already did this are the pattern; this file
 * generalises it rather than replacing it.
 */
"use strict";

const { asyncHandler, AppError } = require("../../../utils/errors");
const repo = require("./thread.repo");

const notFound = () => new AppError("NOT_FOUND", "conversation not found", 404);
const userOf = (req) => (req.user && req.user.user_id) || null;

/**
 * Tag the middleware so the route-enumeration gate can SEE it.
 *
 * `asyncHandler` returns an anonymous arrow, so the inner function's name never
 * reaches the express layer and a gate that matched on handler names would
 * match nothing while reporting success — the precise failure mode this whole
 * exercise is about. An explicit property is checkable and cannot be produced
 * by accident.
 */
function tag(kind, mw) {
  Object.defineProperty(mw, "__mailVisibilityGate", { value: kind, enumerable: false });
  return mw;
}

/**
 * Gate on a thread id in the PATH. `requireVisibleThread()` for the usual
 * `:id`; pass a name for a route that calls it something else.
 *
 * On success the row is parked on `req.mailThread` so a handler that needs the
 * thread does not pay for a second read — but nothing is *required* to use it,
 * because a gate that only works when the handler cooperates is not a gate.
 */
function requireVisibleThread(param = "id") {
  return tag("thread", asyncHandler(async function visibleThread(req, _res, next) {
    const threadId = req.params[param];
    if (!threadId) throw notFound();
    const row = await req.identityDb((c) => repo.headIfVisible(c, userOf(req), threadId));
    if (!row) throw notFound();
    req.mailThread = row;
    return next();
  }));
}

/**
 * Gate on a thread id in the BODY — the shape the AI routes use
 * (`{ thread_id }`). `optional` is for the routes where the field genuinely may
 * be absent (compose from nothing, rewrite a pasted paragraph): absent skips
 * the gate, present is checked. Absent-or-invisible must not be the same
 * outcome as absent, so a present-but-invisible id still 404s.
 */
function requireVisibleThreadBody(field = "thread_id", { optional = false } = {}) {
  return tag("threadBody", asyncHandler(async function visibleThreadBody(req, _res, next) {
    const threadId = req.body && req.body[field];
    if (!threadId) {
      if (optional) return next();
      throw notFound();
    }
    const row = await req.identityDb((c) => repo.headIfVisible(c, userOf(req), threadId));
    if (!row) throw notFound();
    req.mailThread = row;
    return next();
  }));
}

/**
 * Gate on a MESSAGE id — resolves to its thread and applies the same predicate.
 * Used by the extractions read and by anything else addressed per message.
 */
function requireVisibleMessage(param = "id") {
  return tag("message", asyncHandler(async function visibleMessage(req, _res, next) {
    const messageId = req.params[param];
    if (!messageId) throw notFound();
    const row = await req.identityDb((c) => repo.messageIfVisible(c, userOf(req), messageId));
    if (!row) throw notFound();
    req.mailMessage = row;
    return next();
  }));
}

/**
 * Gate on an ATTACHMENT id.
 *
 * This is the sharpest of the three. `POST /assist/ocr/:attachmentId` resolved
 * an arbitrary attachment id, read the vault bytes and sent them to an external
 * vision vendor — so an ungated attachment id did not merely disclose a private
 * thread's file, it *exported* it. The download route added for H-2 rides the
 * same gate.
 *
 * An attachment on a DRAFT has no thread. Those are reachable only by the draft
 * owner, so they resolve through draft ownership instead of thread visibility;
 * an attachment belonging to neither is not found.
 */
function requireVisibleAttachment(param = "attachmentId") {
  return tag("attachment", asyncHandler(async function visibleAttachment(req, _res, next) {
    const attachmentId = req.params[param];
    if (!attachmentId) throw new AppError("NOT_FOUND", "attachment not found", 404);
    const row = await req.identityDb((c) => repo.attachmentIfVisible(c, userOf(req), attachmentId));
    if (!row) throw new AppError("NOT_FOUND", "attachment not found", 404);
    req.mailAttachment = row;
    return next();
  }));
}

/**
 * The batch shape. `POST /suggestions/accept-batch` takes up to 200 thread ids.
 *
 * Refusing the whole batch when one id is invisible would make the endpoint an
 * oracle — the caller learns which of 200 guesses was real. Instead the list is
 * narrowed to what the caller may actually see, and the count that was dropped
 * is reported back so this is a stated narrowing and not a silent cap. The
 * handler then operates on `req.body[field]`, which is now the visible subset.
 */
function restrictThreadIdsBody(field = "thread_ids") {
  return tag("threadIds", asyncHandler(async function visibleThreadIds(req, _res, next) {
    const requested = (req.body && req.body[field]) || [];
    if (!requested.length) return next();
    const visible = await req.identityDb((c) =>
      repo.filterVisibleThreadIds(c, userOf(req), requested));
    req.body[field] = visible;
    req.mailThreadIdsDropped = requested.length - visible.length;
    return next();
  }));
}

module.exports = {
  GATE_PROP: "__mailVisibilityGate",
  requireVisibleThread,
  requireVisibleThreadBody,
  requireVisibleMessage,
  requireVisibleAttachment,
  restrictThreadIdsBody,
};
