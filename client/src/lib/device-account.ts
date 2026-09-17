/**
 * The account this device belongs to — and the ONE way to take it off.
 *
 * Three stores describe "who is this machine set up for", and the sign-in
 * screen reads all three to decide what to put in front of someone:
 *
 *   lastSessionStore        the identity itself. Turns the sign-in screen into
 *                           a greeting ("Welcome back Ama Nkeng") and removes
 *                           the email field entirely.
 *   pinStore                this device holds a Quick PIN for that account.
 *   passkeyDeviceStore      this device holds a passkey for that account.
 *
 * They are deliberately separate — a device can hold a PIN and no passkey, or a
 * passkey and no PIN — and that separation is what lets the sign-in screen lead
 * with the fastest route this machine can actually complete. But there is
 * exactly one operation that has to remove ALL of them together, and it is the
 * one a person reaches for when the machine is about to change hands: "Sign out
 * and remove this account from this device" (app-shell → sign-out-dialog).
 *
 * WHY IT IS A FUNCTION AND NOT THREE LINES AT THE CALL SITE. The release is the
 * security-relevant half of the feature. Leaving the PIN record behind is not a
 * cosmetic bug: the sign-in screen's PIN tab accepts ANY email plus a PIN, so a
 * PIN left on a shared workstation keeps opening the account that just signed
 * out. Splitting that reasoning across a call site invites one of the three to
 * be dropped in a refactor, and the loss would be invisible — the screen still
 * looks right, it just quietly still trusts the previous person. So the set
 * lives here with one name, and `device-account.test.ts` pins the set.
 *
 * WHAT THIS IS NOT: it does not touch the account itself. No API call, no
 * session revocation, no server-side PIN-device row. Revoking a PIN *device* is
 * a deliberate, auditable action in My security (which lists every device and
 * can remove one) and is not a side effect of signing out on this browser. The
 * passkey is in the OS keychain and cannot be deleted from a web page at all.
 */
import { lastSessionStore } from "./last-session";
import { pinStore } from "./pin-store";
import { passkeyDeviceStore } from "./passkey-devices";

/**
 * Take `email` off this device: the greeting, the PIN record and the passkey
 * record. Safe to call with an empty email (it is a no-op) so callers do not
 * have to guard a value that may be missing on a half-hydrated session.
 */
export function forgetDeviceAccount(email: string | null | undefined): void {
  const who = (email ?? "").trim();
  // The identity is cleared even without an email: a half-hydrated session that
  // cannot name itself is exactly when the device should stop answering for it.
  lastSessionStore.clear();
  if (!who) return;
  pinStore.remove(who);
  passkeyDeviceStore.remove(who);
}
