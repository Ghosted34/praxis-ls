"use strict";
/**
 * Which notifications INTERRUPT — make a sound, stay on screen until dealt
 * with, vibrate a phone — and which merely appear.
 *
 * ── WHY THIS IS A RULE AND NOT A PREFERENCE DEFAULT SCATTERED IN TWO PLACES ──
 *
 * The server needs it to stamp the push payload (the service worker cannot ask
 * a database what `requireInteraction` should be). The client needs it to
 * decide whether to play a sound on a socket event, and to draw the right
 * default in the Preferences matrix for a user who has never set one. Same
 * question, three callers, one answer — or the phone buzzes for something the
 * screen stayed silent about.
 *
 * ── THE DEFAULT, AND THE REASON IT IS NOT "EVERYTHING" ───────────────────────
 *
 * A channel that interrupts for everything gets muted wholesale, and a muted
 * channel notifies nobody about anything — which is the failure this is meant
 * to prevent, arrived at by a different road. So the default is the set where
 * a delay has a cost somebody feels:
 *
 *   - anything HIGH, whatever its category. Security alerts are forced HIGH by
 *     the Watch-the-Watcher fan-out, so they are covered without naming them.
 *   - `approvals` — a costing or cash request sitting unapproved is a truck not
 *     loading. This is the case the whole feature exists for.
 *   - `comms` — mail AND Smart Comms messages. Somebody is addressing a person
 *     and waiting for an answer.
 *
 * Everything else — an invoice posted, a vehicle inspection logged — lands in
 * the bell and the badge without making a noise.
 *
 * A user can override any category either way; `interruptFor` takes their
 * stored preference and falls back to this when there isn't one. That is the
 * same shape as every other row in `notification_preference`: a missing row
 * means "the default", so the table stays small and the default stays live
 * rather than being frozen into rows at signup.
 */

/** Categories that interrupt regardless of priority. */
const INTERRUPT_CATEGORIES = new Set(["approvals", "comms"]);

/**
 * Should this notification interrupt, absent any preference from the user?
 *
 * `priority` is the notification's own ("HIGH" | "NORMAL"); `category` is its
 * key from `shared/notifications/categories`.
 */
function defaultInterrupt({ priority, category } = {}) {
  if (String(priority || "").toUpperCase() === "HIGH") return true;
  return INTERRUPT_CATEGORIES.has(String(category || "").toLowerCase());
}

/**
 * The answer for one notification and one user.
 *
 * `preference` is that user's stored choice for this CATEGORY — true, false, or
 * null/undefined when they have never set one. An explicit `false` silences a
 * category even for HIGH: a user who has said "do not interrupt me about
 * approvals" has said it about the urgent ones too, and quietly overriding them
 * is how people stop trusting the switch.
 *
 * The one thing a preference cannot silence is a SECURITY notification, and
 * that is enforced where every other channel enforces it — `isSecurityCategory`
 * in the notification service, which never consults preferences at all. It is
 * not re-checked here, because a second copy of that rule is a second place for
 * it to be wrong.
 */
function interruptFor({ priority, category, preference } = {}) {
  if (preference === true || preference === false) return preference;
  return defaultInterrupt({ priority, category });
}

/** The pseudo-channel these preferences are stored under. See migration 13795. */
const INTERRUPT_CHANNEL = "INTERRUPT";

module.exports = {
  INTERRUPT_CATEGORIES,
  INTERRUPT_CHANNEL,
  defaultInterrupt,
  interruptFor,
};
