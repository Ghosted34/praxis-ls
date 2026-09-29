/**
 * The DEVICE's own facts in localStorage — the keys signing out must never
 * touch — and the one function that signs a browser out without touching them.
 *
 * ── WHY A LIST OF WHAT TO KEEP, AND NOT clear() + restore ───────────────────
 *
 * Sign-out used to `localStorage.clear()` everything and then write back a
 * snapshot of each device store. That shape forgets by default: a device fact
 * that was not in the snapshot list was wiped, and anything that went wrong
 * between the clear and the restore (a throw, a closed tab, a second tab
 * reading at that instant) lost the lot — the greeting AND the record of the
 * passkey. Owner decision, 29 Sep 2026: a device forgets its passkey only when
 * the person removes it. So sign-out now removes session keys one by one and
 * leaves these exactly where they are; there is no moment when they are gone.
 *
 * Add a key here when it describes the MACHINE rather than the session.
 * `device-keys.test.ts` checks each store's own key is listed.
 */
import { lastSessionStore } from "./last-session";
import { PASSKEY_DEVICES_KEY } from "./passkey-devices";
import { DEVICE_ID_KEY } from "./device-id";
import { PASSKEY_OFFER_KEYS } from "./passkey-offer";

export const DEVICE_KEYS: readonly string[] = [
  // Whose device this is (the greeting) and whether their Quick PIN is set.
  lastSessionStore.KEY,
  // Which passkeys live on this device, per account.
  PASSKEY_DEVICES_KEY,
  // The time clock's record of this hardware.
  DEVICE_ID_KEY,
  // "Not now" on the passkey offer and a dismissed nudge — answers about this device.
  ...PASSKEY_OFFER_KEYS,
];

/**
 * Remove every localStorage key that is NOT a device fact: tokens, the cached
 * user, preferences, drafts. Device facts are never read, rewritten or removed.
 */
export function clearSessionKeepDevice(): void {
  try {
    const keep = new Set(DEVICE_KEYS);
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== null && !keep.has(k)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* @silent:storage — private mode or a locked store. The session keys that
       matter (tokens, the user record) are removed by logout itself first. */
  }
}
