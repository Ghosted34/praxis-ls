/**
 * Centralised error reporting.
 *
 * Audit OBS-E1 (Critical) — no centralised error tracking of any kind — and
 * OBS-E2 (Critical) — frontend errors completely invisible. Both are closed by
 * this one sink: server-side 5xx and crashes report here, and the browser
 * reports here through `POST /api/client-errors`.
 *
 * Before this, a 500 produced a log line on a box whose logs are not shipped and
 * are wiped on every deploy (OBS-L7), and a browser exception produced nothing
 * at all. Nobody could answer "what broke this week", and a bug that did not
 * generate a support ticket did not exist.
 *
 * DESIGN
 *
 *   Fingerprint + dedupe. An error in a hot path fires thousands of times a
 *   minute. Sending each one turns the alert channel into a firehose and gets
 *   it muted, which is the failure mode OBS-A1 warns about. Identical errors
 *   collapse onto a fingerprint (name + message + top frame) and are reported
 *   once per window, with the suppressed count attached to the next send.
 *
 *   Context, not just a stack. Every report carries tenant, user, request_id,
 *   release and environment, read from the same AsyncLocalStorage the logger
 *   uses (OBS-L3). "One tenant is broken" versus "everyone is broken" is the
 *   first question in any incident.
 *
 *   Never throws, never blocks. A reporting failure must not turn a handled
 *   500 into an unhandled one. Everything is best-effort and fire-and-forget.
 *
 *   Redaction reuses the logger's REDACT_PATHS list rather than restating it,
 *   so the two cannot drift (OBS-L4).
 *
 * The transport is the same ALERT_WEBHOOK_URL used by the deploy announcements.
 * When it is unset, reports still go to the structured log at error level with
 * a `reported: false` marker — so the pipeline is testable and honest before
 * anyone signs up for a service.
 */

"use strict";

const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const requestContext = require("../../config/request-context");
const store = require("./error-store");
const { scrub, scrubObject } = require("./scrub");

/**
 * Severities that reach the ALERT CHANNEL. Everything else is recorded and
 * counted, but never posted to the webhook and never charged against the rate
 * limit.
 *
 * WHY THIS DISTINCTION HAD TO EXIST BEFORE §2.3 pt 4 COULD BE HONOURED
 *
 *   The spec says "Backend must capture errors from … 4. API validation
 *   failures". That was deliberately not done, for a good reason: a 422 is a
 *   client mistake, and a channel whose first week is full of "email is
 *   required" gets muted — the OBS-A1 failure mode this module exists to avoid.
 *
 *   Both things are true at once, and the five-level scheme in §2.2 is what
 *   reconciles them. A validation failure is captured at `notice`: it lands in
 *   the feed, it is filterable, its count is tracked — and it does not page
 *   anyone, because `notice` never reaches the webhook and escalation rules
 *   default to `fatal`.
 *
 *   Skipping `withinRateLimit()` for these matters as much as skipping the post.
 *   The ceiling is 20 outbound reports a minute; if a broken signup form could
 *   spend it, a real 500 arriving in the same minute would be dropped. Noise
 *   must not be able to starve signal.
 */
const NOTIFY_SEVERITIES = new Set(["fatal", "error", "warning"]);

/** How long an identical error stays suppressed after being reported. */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
/** Hard ceiling on distinct fingerprints tracked, so this cannot grow unbounded. */
const MAX_TRACKED = 500;
/** Cap on outbound reports per minute, whatever the fingerprint spread. */
const MAX_PER_MINUTE = 20;

/** fingerprint -> { firstSeen, lastSent, suppressed } */
const seen = new Map();
let windowStart = Date.now();
let sentThisWindow = 0;

/**
 * Collapse an error to a stable key. The top stack frame is included so the
 * same message thrown from two places stays two problems.
 */
function fingerprint(err, extra = {}) {
  const name = (err && err.name) || "Error";
  const msg = String((err && err.message) || err || "unknown")
    // Strip ids, uuids and numbers so "user 41f2… not found" is ONE problem,
    // not one per user. Without this, dedupe never matches anything.
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 200);
  // Strip :line:col from the frame. Without this, the same function throwing
  // the same error becomes a NEW problem the moment an unrelated edit shifts
  // its line number — dedupe silently stops working and the channel floods on
  // the next deploy. The function and file are what identify the site.
  const frame =
    String((err && err.stack) || "")
      .split("\n")[1]
      ?.trim()
      .replace(/:\d+:\d+\)?$/, ")")
      .slice(0, 120) || extra.source || "";
  return `${name}|${msg}|${frame}`;
}

/**
 * Make a message safe to put in a log LINE.
 *
 * CodeQL "Log injection", Medium. `payload.message` is attacker-influenced —
 * `POST /api/client-errors` is unauthenticated and takes it verbatim — and it
 * is interpolated into pino's message string. A newline inside it forges a
 * whole log entry: an attacker reports an error whose message contains
 * `\n{"level":50,"msg":"payment settled"}` and the log stream now contains a
 * line nobody wrote. Anything that later greps or ships those logs believes it.
 *
 * The STRUCTURED field is already safe — pino JSON-encodes it, so newlines
 * survive as `\n` inside a string. Only the free-text line needs this, which is
 * why the fix is here and not in the scrubber.
 */
function logSafe(text, max = 300) {
  return String(text ?? "")
    // Newlines and tabs collapse to a space \u2014 that is the forgery vector.
    // C0 controls go entirely: a bare \u001b can inject an ANSI escape into
    // whatever renders the log, and \b can rewrite a terminal line.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, max);
}

function withinRateLimit() {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    sentThisWindow = 0;
  }
  if (sentThisWindow >= MAX_PER_MINUTE) return false;
  sentThisWindow += 1;
  return true;
}

/** Drop the oldest entries when the map gets large. */
function evictIfNeeded() {
  if (seen.size <= MAX_TRACKED) return;
  const oldest = [...seen.entries()].sort((a, b) => a[1].lastSent - b[1].lastSent);
  for (const [k] of oldest.slice(0, Math.ceil(MAX_TRACKED / 4))) seen.delete(k);
}

async function post(payload) {
  if (!config.ALERT_WEBHOOK_URL) return false;
  try {
    const body = JSON.stringify({ text: format(payload), praxis: payload });
    const res = await fetch(config.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    // Deliberately swallowed: a reporting failure must never escalate into an
    // application failure. It is visible in the log line written below.
    return false;
  }
}

function format(p) {
  const bits = [
    `${p.severity === "fatal" ? "FATAL" : "ERROR"} · ${p.origin}`,
    p.message,
    p.tenant ? `tenant: ${p.tenant}` : null,
    p.user_id ? `user: ${p.user_id}` : null,
    p.route ? `at: ${p.route}` : null,
    p.request_id ? `request: ${p.request_id}` : null,
    p.release ? `build: ${p.release}` : null,
    p.suppressed ? `(+${p.suppressed} identical suppressed in the last 5 min)` : null,
    p.stack ? `\n${p.stack.split("\n").slice(0, 5).join("\n")}` : null,
  ].filter(Boolean);
  return bits.join("\n");
}

/**
 * Report an error. Fire-and-forget: callers must not await it, and it resolves
 * rather than rejects under every failure mode.
 *
 * @param {Error|string} err
 * @param {object} [meta]
 * @param {"server"|"browser"|"worker"} [meta.origin]
 * @param {"error"|"fatal"} [meta.severity]
 * @param {string} [meta.route]   request path or client route
 * @param {string} [meta.request_id]
 */
function report(err, meta = {}) {
  try {
    // SCRUB FIRST — spec §11. Everything downstream of this line (the
    // fingerprint, the webhook, the log line, platform.error_event, and the AI
    // explain prompt built from it) sees the sanitised text, because the
    // alternative is four sinks each promising to scrub and one of them
    // forgetting. See shared/observability/scrub.js for what is caught and, as
    // importantly, what is deliberately left alone.
    //
    // Doing it before fingerprint() also collapses "no user marie@x.cm" and "no
    // user paul@x.cm" onto ONE signature — the same treatment the fingerprint
    // already gives uuids and bare numbers, applied to the identifier that was
    // slipping through.
    const safeMessage = scrub(String((err && err.message) || err || "unknown"));
    const safeStack = scrub((err && err.stack) || null);

    const fp = fingerprint({ name: (err && err.name) || "Error", message: safeMessage, stack: safeStack }, meta);
    const now = Date.now();
    const entry = seen.get(fp);

    const ctx = requestContext.get() || {};
    const payload = {
      origin: meta.origin || "server",
      severity: meta.severity || "error",
      message: safeMessage,
      name: (err && err.name) || "Error",
      stack: safeStack,
      route: scrub(meta.route || null),
      request_id: meta.request_id || null,
      tenant: ctx.tenant || meta.tenant || null,
      user_id: ctx.userId || meta.user_id || null,
      release: config.BUILD_SHA || "unknown",
      env: config.NODE_ENV,
      fingerprint: fp,
      suppressed: entry ? entry.suppressed : 0,
      ts: new Date().toISOString(),
      ...(meta.extra ? { extra: scrubObject(meta.extra) } : {}),
    };

    // OBS-E3 / Error Command Center. Persist BEFORE the dedupe gate below.
    //
    // The gate exists to stop the alert channel being flooded, and it is right
    // to. But `occurrence_count` is the number the Error Center sorts, charts
    // and escalates on — so if persistence sat behind the same gate, a hot
    // error firing 40k times in five minutes would be recorded as having fired
    // ONCE, and every threshold rule in §5 would silently never trigger.
    //
    // Notification is deduped. Counting is not. They are different questions.
    store.persist(payload);

    // RECORDED, NOT NOTIFIED. Below the notify threshold the work is already
    // done: the row is written and counted. No webhook, no rate-limit spend, no
    // dedupe bookkeeping (`seen` would otherwise fill with fingerprints that can
    // never notify), and a log line at info rather than error so a validation
    // failure does not read as a fault in the log stream either.
    if (!NOTIFY_SEVERITIES.has(payload.severity)) {
      logger.info(
        { err_report: { ...payload, stack: undefined }, reported: false },
        `recorded ${payload.severity} (${payload.origin}): ${logSafe(payload.message)}`,
      );
      return Promise.resolve({ reported: false, reason: "not_notifiable", fingerprint: fp });
    }

    if (entry && now - entry.lastSent < DEDUPE_WINDOW_MS) {
      entry.suppressed += 1;
      return Promise.resolve({ reported: false, reason: "deduped" });
    }

    const suppressed = entry ? entry.suppressed : 0;
    seen.set(fp, { firstSeen: entry ? entry.firstSeen : now, lastSent: now, suppressed: 0 });
    evictIfNeeded();
    payload.suppressed = suppressed;

    if (!withinRateLimit()) {
      logger.warn({ fingerprint: fp }, "error report rate-limited (>20/min)");
      return Promise.resolve({ reported: false, reason: "rate_limited" });
    }

    // Always log, whether or not a webhook is configured. The log line is the
    // durable record; the webhook is the notification.
    return post(payload).then((ok) => {
      // Was `severity === "fatal" ? "error" : "error"` — both branches the same,
      // so the ternary decided nothing and a warning logged as an error.
      const level = payload.severity === "warning" ? "warn" : "error";
      logger[level](
        { err_report: { ...payload, stack: undefined }, reported: ok },
        `reported ${payload.origin} error: ${logSafe(payload.message)}`,
      );
      return { reported: ok, fingerprint: fp, suppressed };
    });
  } catch (selfErr) {
    // The reporter breaking must not break the caller.
    try {
      logger.error({ err: selfErr }, "error-reporter itself failed");
    } catch {
      /* nothing left to do */
    }
    return Promise.resolve({ reported: false, reason: "reporter_failed" });
  }
}

/** Test seam: clear dedupe + rate-limit state. */
function __reset() {
  seen.clear();
  windowStart = Date.now();
  sentThisWindow = 0;
}

module.exports = {
  report,
  fingerprint,
  __reset,
  DEDUPE_WINDOW_MS,
  MAX_PER_MINUTE,
  NOTIFY_SEVERITIES,
};
