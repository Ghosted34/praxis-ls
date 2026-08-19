/**
 * Send-rate arithmetic and mailbox health — the two calculations the mailbox
 * layer has to get right and nothing else should re-derive.
 *
 * ── WHY A THROTTLE EXISTS AT ALL ────────────────────────────────────────────
 *
 * The first tenant sends through cPanel, and shared cPanel hosting caps outbound
 * mail per domain per hour — commonly 200 to 500. Crossing the cap does not
 * queue the overflow: it SUSPENDS the mailbox. A month-end invoice run plus a
 * notification fan-out can cross it in minutes, and the failure is the company's
 * email going dark rather than a few messages arriving late.
 *
 * ── SPILLOVER RATHER THAN REFUSAL ───────────────────────────────────────────
 *
 * When a send would cross the cap it is HELD for the next window and the sender
 * is told when it will go. That is a normal state with an honest label. Failing
 * the send instead would teach people to send from Outlook, which defeats the
 * whole point of the mailbox living here.
 *
 * PURE. `decide()` takes counts and limits and returns a verdict; the repo does
 * the counting and the service does the holding.
 */
"use strict";

const HOUR_MS = 60 * 60 * 1000;

/** Conservative defaults. A tenant that knows its host's real ceiling raises them. */
const DEFAULTS = { send_limit_hourly: 150, send_limit_daily: 1000, sync_depth_days: 90 };

/** The hour a moment belongs to — the key of `email_send_window`. */
function windowStart(at = new Date()) {
  const d = new Date(at);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** The next hour boundary: when a held message becomes sendable again. */
function nextWindow(at = new Date()) {
  return new Date(windowStart(at).getTime() + HOUR_MS);
}

/**
 * Effective limits for a connection: its own override, else the tenant default,
 * else the built-in. NULL on the row means inherit, deliberately — so raising the
 * tenant default actually moves every mailbox that never set its own.
 */
function effectiveLimits(connection = {}, tenantDefaults = {}) {
  const pick = (key) => {
    for (const v of [connection[key], tenantDefaults[key], DEFAULTS[key]]) {
      if (v !== null && v !== undefined && v !== "") return Number(v);
    }
    return DEFAULTS[key];
  };
  return {
    send_limit_hourly: pick("send_limit_hourly"),
    send_limit_daily: pick("send_limit_daily"),
    sync_depth_days: pick("sync_depth_days"),
  };
}

/**
 * May this message go now?
 *
 * `count` is how many are being sent in this operation (1 for a normal send, N
 * for a run), so a bulk caller gets one verdict instead of discovering the cap
 * halfway through.
 */
function decide({ hourlyUsed = 0, dailyUsed = 0, limits = {}, at = new Date(), count = 1 } = {}) {
  const hourly = Number(limits.send_limit_hourly ?? DEFAULTS.send_limit_hourly);
  const daily = Number(limits.send_limit_daily ?? DEFAULTS.send_limit_daily);

  if (dailyUsed + count > daily) {
    // Tomorrow, not the next hour: the daily cap does not clear on the hour, and
    // saying it does would have the UI promise a delivery that will not happen.
    const midnight = new Date(at);
    midnight.setUTCHours(24, 0, 0, 0);
    return { allowed: false, reason: "DAILY_LIMIT", limit: daily, used: dailyUsed, retryAt: midnight };
  }
  if (hourlyUsed + count > hourly) {
    return { allowed: false, reason: "HOURLY_LIMIT", limit: hourly, used: hourlyUsed, retryAt: nextWindow(at) };
  }
  return {
    allowed: true, reason: null, retryAt: null,
    remaining_hour: Math.max(0, hourly - hourlyUsed - count),
    remaining_day: Math.max(0, daily - dailyUsed - count),
  };
}

/**
 * How a mailbox is doing, in one word plus a reason.
 *
 * The reason matters as much as the level: "not connected since Tuesday" is
 * actionable, a red dot is not. Thresholds are deliberately forgiving — a
 * mailbox that missed one poll is not a problem, and crying about it teaches
 * people to ignore the indicator.
 */
function health(connection = {}, { now = new Date(), staleAfterHours = 6 } = {}) {
  const status = String(connection.status || "").toUpperCase();
  if (status === "ARCHIVED") return { level: "ARCHIVED", reason: "This mailbox was retired." };
  if (status === "DISABLED") return { level: "OFF", reason: "Syncing is switched off for this mailbox." };
  if (status === "PENDING") return { level: "PENDING", reason: "Not verified yet — run a test to finish setting it up." };

  const failures = Number(connection.consecutive_failures || 0);
  if (status === "ERROR" || failures >= 3) {
    return {
      level: "DOWN",
      reason: connection.last_error
        ? `Failing to connect: ${connection.last_error}`
        : `Failed to connect ${failures} times in a row.`,
      failures,
    };
  }
  if (failures > 0) {
    return { level: "WARN", reason: `Last ${failures === 1 ? "attempt" : `${failures} attempts`} failed; still retrying.`, failures };
  }

  const last = connection.last_success_at || connection.last_sync_at;
  if (!last) return { level: "PENDING", reason: "Connected, but it has not synced yet." };
  const hours = (new Date(now).getTime() - new Date(last).getTime()) / HOUR_MS;
  if (hours > staleAfterHours) {
    return { level: "WARN", reason: `No successful sync for ${Math.floor(hours)} hours.`, stale_hours: Math.floor(hours) };
  }
  return { level: "OK", reason: "Syncing normally." };
}

module.exports = { HOUR_MS, DEFAULTS, windowStart, nextWindow, effectiveLimits, decide, health };
