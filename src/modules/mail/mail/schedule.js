/**
 * Scheduled send and recipient-local-time delivery (§9.3, §1.4).
 *
 * The send queue already had everything needed: a message is enqueued with a
 * `release_at` and the flusher drains what is due. Undo-send is that mechanism
 * with a 20-second delay. Scheduling is the same mechanism with a longer one —
 * §1.4 says it is "nearly free once the send queue exists", and it was, once
 * something computed the release time.
 *
 * ── WHAT THIS MUST NOT DO ───────────────────────────────────────────────────
 *
 * §9.3, stated as a MUST NOT: "offer or imply 'best time to send' optimisation.
 * Open data does not exist (Q32) and the UI must not pretend otherwise."
 *
 * So there is no model here, no heuristic, and no "recommended" time. There are
 * exactly two things a caller may ask for:
 *
 *   send_at                     an instant the operator chose
 *   send_in_recipient_morning   09:00 on the recipient's clock
 *
 * The second is a TIMEZONE conversion, not a prediction. It answers "when is it
 * 09:00 where they are", which is knowable, rather than "when will they read
 * it", which is not.
 *
 * ── DST IS HANDLED BY THE ZONE, NOT AN OFFSET ───────────────────────────────
 *
 * §9.10 criterion 5: scheduling for a Paris client's 09:00 sends at 08:00
 * Douala in summer and 09:00 in winter. That falls out of using an IANA zone
 * and real arithmetic — `sla-clock.zonedToUtc` already does it, correctly, and
 * is reused here rather than reimplemented, because two answers to "what
 * instant is 09:00 there" is how one of them ends up wrong in October.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const clock = require("../triage/sla-clock");

/** §9.3's phrase: "send at 09:00 in the recipient's local time". */
const MORNING_HOUR = 9;

/**
 * A scheduled send may not be further out than this.
 *
 * The frozen payload in `email_send_queue` includes the resolved signature and
 * the body as composed. A year-out schedule would send a message written under
 * a job title, an address and a price list that no longer exist, and nobody
 * would remember queuing it. Ninety days is long enough for every real use
 * (a renewal, a season, a contract date) and short enough that the payload is
 * still recognisably the thing that was written.
 */
const MAX_DAYS = 90;

/**
 * The recipient's timezone, from whichever party record we can match.
 *
 * Matched on the address, then the domain, over clients, suppliers and leads.
 * Returns null when nothing matches — and null is an answer the caller must
 * handle, not a reason to guess. A guessed timezone sends a "good morning" at
 * three in the morning, which is worse than sending it now.
 */
async function recipientTimezone(client, address) {
  const email = String(address || "").toLowerCase().trim();
  if (!email.includes("@")) return null;
  const domain = email.split("@")[1];

  const { rows } = await client.query(
    `SELECT timezone, 1 AS rank FROM client_master   WHERE lower(email) = $1 AND timezone IS NOT NULL
     UNION ALL
     SELECT timezone, 1 FROM supplier_master WHERE lower(email) = $1 AND timezone IS NOT NULL
     UNION ALL
     SELECT timezone, 1 FROM lead            WHERE lower(email) = $1 AND timezone IS NOT NULL
     UNION ALL
     SELECT timezone, 2 FROM client_master   WHERE lower(split_part(email,'@',2)) = $2 AND timezone IS NOT NULL
     UNION ALL
     SELECT timezone, 2 FROM supplier_master WHERE lower(split_part(email,'@',2)) = $2 AND timezone IS NOT NULL
     ORDER BY rank
     LIMIT 1`,
    [email, domain],
  ).catch(() => ({ rows: [] }));

  return (rows[0] && rows[0].timezone) || null;
}

/** A zone Node's ICU actually knows. An unknown one must not become UTC silently. */
function isValidZone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The next 09:00 on that clock, strictly in the future.
 *
 * "Next" rather than "today's", because scheduling a morning delivery at 11:00
 * their time means tomorrow morning. Anything else is a message the operator
 * believes is scheduled and which has in fact already gone.
 */
function nextMorning(tz, now = new Date()) {
  const p = clock.partsIn(now, tz);
  let at = clock.zonedToUtc({ y: p.y, m: p.m, d: p.d, h: MORNING_HOUR, mi: 0 }, tz);
  if (at <= now) {
    const tomorrow = new Date(Date.UTC(p.y, p.m - 1, p.d) + 24 * 3600 * 1000);
    at = clock.zonedToUtc({
      y: tomorrow.getUTCFullYear(), m: tomorrow.getUTCMonth() + 1, d: tomorrow.getUTCDate(),
      h: MORNING_HOUR, mi: 0,
    }, tz);
  }
  return at;
}

/**
 * Resolve what the caller asked for into a release instant, or nothing.
 *
 * Returns `null` when the send is immediate, which leaves the undo-send window
 * to decide — the two must not both compute a release time, because then a
 * scheduled message would still be cancellable for twenty seconds and then not
 * for six days, which is not what either feature means.
 *
 * @returns {null | {releaseAt: Date, reason: string, timezone?: string, note: string}}
 */
async function resolveReleaseAt(client, input = {}, { now = new Date(), to = [] } = {}) {
  if (input.send_at) {
    const at = new Date(input.send_at);
    if (Number.isNaN(at.getTime())) {
      throw new AppError("VALIDATION_ERROR", "send_at is not a valid date", 422);
    }
    if (at <= now) {
      throw new AppError("VALIDATION_ERROR", "send_at is in the past.", 422);
    }
    if (at.getTime() - now.getTime() > MAX_DAYS * 24 * 3600 * 1000) {
      throw new AppError(
        "VALIDATION_ERROR",
        `A message can be scheduled up to ${MAX_DAYS} days ahead. Beyond that the signature, prices and job titles baked into it will have moved on.`,
        422,
      );
    }
    return { releaseAt: at, reason: "EXPLICIT", note: `Delivers ${at.toISOString()}.` };
  }

  if (input.send_in_recipient_morning) {
    const first = [].concat(to || []).filter(Boolean)[0];
    const tz = await recipientTimezone(client, first);

    // No timezone on file is a fact to report, not a default to invent. The
    // composer shows it and offers to send now or pick a time.
    if (!tz || !isValidZone(tz)) {
      throw new AppError(
        "NO_RECIPIENT_TIMEZONE",
        "We do not know this recipient's timezone, so we cannot schedule for their morning. Set a timezone on their record, or choose a time yourself.",
        422,
      );
    }

    const at = nextMorning(tz, now);
    return {
      releaseAt: at,
      reason: "RECIPIENT_MORNING",
      timezone: tz,
      // Stated plainly, as §9.3 requires — the UI repeats this verbatim rather
      // than rendering its own guess at what the conversion did.
      note: `Delivers at ${String(MORNING_HOUR).padStart(2, "0")}:00 ${tz.split("/").pop().replace(/_/g, " ")} time.`,
    };
  }

  return null;
}

module.exports = {
  MORNING_HOUR, MAX_DAYS,
  resolveReleaseAt, recipientTimezone, nextMorning, isValidZone,
};
