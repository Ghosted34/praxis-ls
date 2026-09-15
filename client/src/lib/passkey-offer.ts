/**
 * Remembers who has already been asked about passkeys, so nobody is asked
 * twice by the same surface. Like pinStore and lastSession these are DEVICE
 * facts and survive logout on purpose: the answer to "do you want a passkey on
 * this laptop" does not change because the session ended.
 *
 * TWO surfaces ask, and they are dismissed SEPARATELY on purpose:
 *
 *   · the sign-in step (login-modal) interrupts once, right after someone
 *     proves who they are, and "Not now" silences it on that device for good.
 *     An interrupt that returns after being declined is a nag.
 *   · the dashboard nudge is the quiet standing reminder, and carries the
 *     route to the setting so the location is learnable.
 *
 * One shared flag would collapse the pair: everyone without a passkey meets
 * the sign-in step first, so a single "Not now" would suppress the nudge
 * before it had ever rendered, and the reminder would be dead code. Declining
 * the interrupt therefore says nothing about the nudge, and dismissing the
 * nudge says nothing about the interrupt.
 *
 * Neither is a permanent refusal: My security offers enrolment for as long as
 * the account has no passkey, and that is the route back for anyone who
 * changes their mind — which is what the nudge points at.
 */
const DECLINED_KEY = "praxis.passkey.offer.declined";
const NUDGE_KEY = "praxis.passkey.nudge.dismissed";

type Registry = Record<string, true>;

function read(key: string): Registry {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") as Registry;
  } catch {
    /* @silent:storage — private mode or a malformed entry; asking again is
       the harmless direction to fail in. */
    return {};
  }
}

function mark(key: string, email: string) {
  const r = read(key);
  r[email.trim().toLowerCase()] = true;
  try {
    localStorage.setItem(key, JSON.stringify(r));
  } catch {
    /* @silent:storage — quota or private mode; the ask reappears next time,
       which is worse than silence but not a broken sign-in. */
  }
}

export const passkeyOfferStore = {
  /** The sign-in interrupt. */
  declined: (email: string): boolean => !!read(DECLINED_KEY)[email.trim().toLowerCase()],
  decline: (email: string) => mark(DECLINED_KEY, email),

  /** The dashboard nudge. */
  nudgeDismissed: (email: string): boolean => !!read(NUDGE_KEY)[email.trim().toLowerCase()],
  dismissNudge: (email: string) => mark(NUDGE_KEY, email),
};
