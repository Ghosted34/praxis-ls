/**
 * The two tables the public careers surface owns (13792).
 *
 * Everything else this module reads belongs to `vacancy` and is reached through
 * `vacancy.repo` — this file is only the settings singleton and the job-alert
 * list, both of which exist because of the EMPTY careers page rather than the
 * full one.
 *
 * ── WHY THE GETTER TOLERATES A MISSING ROW ────────────────────────────────
 *
 * 13792 seeds `site_careers`, so there is always exactly one row and `null` is
 * unreachable in practice. It is handled anyway, for the reason
 * `site_settings.repo` states about its own singletons: a tenant database
 * restored from a partial backup is a real thing, and the careers page falling
 * back to "no open applications, no alerts" is a better answer than a 500 on a
 * public URL.
 */
"use strict";

/* ── settings ───────────────────────────────────────────────────────────────*/

/** What a tenant may change. `updated_at`/`updated_by` are stamped, never sent. */
const CAREERS_COLUMNS = ["open_applications", "alerts_enabled", "culture_tag"];

const getSettings = async (client) =>
  (await client.query("SELECT * FROM site_careers LIMIT 1")).rows[0] || null;

async function updateSettings(client, patch, actorId) {
  const cols = CAREERS_COLUMNS.filter((c) => patch[c] !== undefined);
  if (!cols.length) return getSettings(client);
  const vals = cols.map((c) => patch[c]);
  vals.push(actorId || null);
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  sets.push(`updated_by = $${vals.length}`, "updated_at = now()");
  const { rows } = await client.query(
    `UPDATE site_careers SET ${sets.join(", ")} WHERE singleton = true RETURNING *`,
    vals,
  );
  return rows[0] || null;
}

/* ── job alerts ─────────────────────────────────────────────────────────────*/

/**
 * Subscribe, or re-subscribe.
 *
 * `ON CONFLICT (email) DO UPDATE` rather than an insert that fails, because
 * `email` is UNIQUE and the second time somebody signs up is not an error — it
 * is somebody who was not sure it worked the first time. Re-subscribing after
 * an unsubscribe clears `unsubscribed_at` and restores `is_subscribed`.
 *
 * The token is NOT regenerated on conflict: an unsubscribe link already sitting
 * in somebody's inbox must keep working, and re-minting it on every duplicate
 * signup would quietly break every link already sent.
 *
 * `last_notified_at` is left alone for the same class of reason in reverse — a
 * returning subscriber should not be mailed the back catalogue they already had.
 */
async function subscribeAlert(client, { email, name = null, locale = "fr", token }) {
  const { rows } = await client.query(
    `INSERT INTO careers_alert (email, name, locale, unsubscribe_token)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
            SET name            = COALESCE(EXCLUDED.name, careers_alert.name),
                locale          = EXCLUDED.locale,
                is_subscribed   = true,
                unsubscribed_at = NULL,
                subscribed_at   = CASE WHEN careers_alert.is_subscribed
                                       THEN careers_alert.subscribed_at
                                       ELSE now() END
      RETURNING careers_alert_id, is_subscribed`,
    [email, name, locale, token],
  );
  return rows[0] || null;
}

/**
 * Unsubscribe by token.
 *
 * Returns the row when one matched and `null` when none did. The CALLER must
 * answer the same either way — a token that says "no such subscriber" is a
 * token that can be used to test whether an address is on the list.
 */
async function unsubscribeAlert(client, token) {
  const { rows } = await client.query(
    `UPDATE careers_alert
        SET is_subscribed = false, unsubscribed_at = now()
      WHERE unsubscribe_token = $1 AND is_subscribed
      RETURNING careers_alert_id`,
    [token],
  );
  return rows[0] || null;
}

/** Everyone still subscribed, for the sender. Watermark-ordered, capped. */
async function listPendingAlerts(client, { limit = 500 } = {}) {
  const { rows } = await client.query(
    `SELECT careers_alert_id, email, name, locale, unsubscribe_token,
            GREATEST(COALESCE(last_notified_at, subscribed_at), subscribed_at) AS since
       FROM careers_alert
      WHERE is_subscribed
      ORDER BY last_notified_at NULLS FIRST
      LIMIT $1`,
    [Math.min(Number(limit) || 500, 2000)],
  );
  return rows;
}

/** Move the watermark after a successful send. */
async function markAlertsNotified(client, ids, at = new Date()) {
  if (!ids || !ids.length) return 0;
  const { rowCount } = await client.query(
    "UPDATE careers_alert SET last_notified_at = $2 WHERE careers_alert_id = ANY($1::uuid[])",
    [ids, at],
  );
  return rowCount;
}

module.exports = {
  getSettings, updateSettings,
  subscribeAlert, unsubscribeAlert, listPendingAlerts, markAlertsNotified,
  CAREERS_COLUMNS,
};
