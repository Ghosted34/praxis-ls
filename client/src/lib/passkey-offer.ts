/**
 * Remembers who has been asked about passkeys, so the ask is persistent
 * without being a nag. Like pinStore and lastSession these are DEVICE facts and
 * survive logout on purpose.
 *
 * TWO surfaces ask, and they are dismissed SEPARATELY on purpose:
 *
 *   · the sign-in step (sign-in-panel) interrupts right after someone proves
 *     who they are with a PIN or password — the one moment they are both
 *     authenticated (enrolment needs a FRESH sign-in) and still thinking about
 *     signing in. "Not now" SNOOZES it on that device for a week, not forever:
 *     the owner wants people urged towards a passkey, and with the screen
 *     locking every two hours a once-and-never ask reaches almost nobody.
 *   · the dashboard nudge is the quiet standing reminder, and carries the
 *     route to the setting so the location is learnable. Dismissing it is
 *     permanent — it is the one that points, not the one that asks.
 *
 * One shared flag would collapse the pair. Neither is a permanent refusal: My
 * security offers enrolment for as long as this device has no passkey.
 */
const DECLINED_KEY = "praxis.passkey.offer.declined";
const NUDGE_KEY = "praxis.passkey.nudge.dismissed";

/** How long "Not now" holds the sign-in ask off, on this device. */
export const OFFER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** `true` is the old "never ask again"; a number is when "Not now" was said. */
type Registry = Record<string, true | number>;

function read(key: string): Registry {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") as Registry;
  } catch {
    /* @silent:storage — private mode or a malformed entry; asking again is
       the harmless direction to fail in. */
    return {};
  }
}

function mark(key: string, email: string, value: true | number) {
  const r = read(key);
  r[email.trim().toLowerCase()] = value;
  try {
    localStorage.setItem(key, JSON.stringify(r));
  } catch {
    /* @silent:storage — quota or private mode; the ask reappears next time,
       which is worse than silence but not a broken sign-in. */
  }
}

export const passkeyOfferStore = {
  /** The sign-in interrupt: snoozed on this device right now? */
  declined: (email: string, now = Date.now()): boolean => {
    const v = read(DECLINED_KEY)[email.trim().toLowerCase()];
    // A pre-snooze "never" is honoured as one snooze from today's upgrade —
    // treated as expired, so the person is asked once more under the new rule.
    if (typeof v !== "number") return false;
    return now - v < OFFER_SNOOZE_MS;
  },
  decline: (email: string, now = Date.now()) => mark(DECLINED_KEY, email, now),

  /** The dashboard nudge. */
  nudgeDismissed: (email: string): boolean => !!read(NUDGE_KEY)[email.trim().toLowerCase()],
  dismissNudge: (email: string) => mark(NUDGE_KEY, email, true),
};
