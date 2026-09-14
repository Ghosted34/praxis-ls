/**
 * Remembers that someone said "Not now" to the post-sign-in passkey offer, so
 * the offer is made once per identity per device rather than after every
 * sign-in. Like pinStore and lastSession this is a DEVICE fact and survives
 * logout on purpose: the answer to "do you want a passkey on this laptop" does
 * not change because the session ended.
 *
 * Declining is not a permanent refusal — My security still offers enrolment,
 * and that is the route back for anyone who changes their mind.
 */
const KEY = "praxis.passkey.offer.declined";

type Registry = Record<string, true>;

function read(): Registry {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Registry;
  } catch {
    /* @silent:storage — private mode or a malformed entry; offering again is
       the harmless direction to fail in. */
    return {};
  }
}

export const passkeyOfferStore = {
  declined: (email: string): boolean => !!read()[email.trim().toLowerCase()],
  decline: (email: string) => {
    const r = read();
    r[email.trim().toLowerCase()] = true;
    try {
      localStorage.setItem(KEY, JSON.stringify(r));
    } catch {
      /* @silent:storage — quota or private mode; the offer reappears next time,
         which is worse than silence but not a broken sign-in. */
    }
  },
};
