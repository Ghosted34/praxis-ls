/**
 * Keeping the device's memory of its person — which the browser would
 * otherwise throw away on its own schedule.
 *
 * The passkey itself lives in the operating system's keychain and no web page
 * can delete it. What the sign-in screen needs ON TOP of it — "this is Ama's
 * laptop, her passkey is here, lead with the fingerprint" — lives in
 * localStorage (`lastSessionStore`, `passkeyDeviceStore`), and the browser
 * erases that without asking anyone:
 *
 *   · Safari deletes every script-written store of a site that has not been
 *     opened in seven days of browsing;
 *   · every engine evicts storage it was never told to keep when the disk
 *     fills.
 *
 * Two defences, both here:
 *
 *   1. `recallDevice()` asks the SERVER what it remembers about this device.
 *      The server keeps that behind an HttpOnly cookie it set itself
 *      (src/modules/security/app_user/known-device.js), which is not
 *      script-written storage and survives both of the above. What comes back
 *      is merged into the local stores — never subtracted from them.
 *   2. `keepDeviceStorage()` asks the browser to make this site's storage
 *      PERSISTENT, so it is never evicted under pressure. Called when a passkey
 *      is set up or used — the moment the device became worth remembering.
 */
import { tenant } from "./api-client";
import { lastSessionStore } from "./last-session";
import { passkeyDeviceStore } from "./passkey-devices";

export type RememberedAccount = {
  email: string;
  display_name?: string | null;
  avatar_url?: string | null;
  has_quick_pin?: boolean;
  /** Passkeys proven on THIS device that the account still holds. */
  passkeys?: string[];
};

let inflight: Promise<RememberedAccount | null> | null = null;

/**
 * What the server remembers about this device, merged into the local stores.
 * Resolves null for a device it does not know (or when it cannot be asked —
 * the local stores then stand as they are). Concurrent callers share one call.
 *
 * MERGE, NEVER SUBTRACT. A passkey id the server lists is added; one it does
 * not list is left alone (it may predate the server's memory). The greeting is
 * filled in only when this browser has none — the local one is the newer
 * answer — except for the Quick PIN flag, where the server is the truth.
 */
export function recallDevice(): Promise<RememberedAccount | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await tenant<{ account: RememberedAccount | null }>("/auth/device", { auth: false, retry: false });
      const a = r && r.account;
      if (!a || typeof a.email !== "string" || !a.email) return null;
      const email = a.email.trim().toLowerCase();
      for (const id of Array.isArray(a.passkeys) ? a.passkeys : []) passkeyDeviceStore.add(email, id);
      const local = lastSessionStore.get();
      if (!local) {
        lastSessionStore.set({
          email,
          display_name: a.display_name ?? null,
          avatar_url: a.avatar_url ?? null,
          has_quick_pin: !!a.has_quick_pin,
        });
      } else if (local.email === email) {
        lastSessionStore.setQuickPin(email, !!a.has_quick_pin);
      }
      return { ...a, email };
    } catch {
      /* @silent:storage — offline, or a server without the route yet: the
         device's own stores stand as they are, which is what it had before. */
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Ask the browser never to evict this site's storage. Chrome and Safari decide
 * silently (installed apps and sites people use are granted); Firefox asks
 * once and remembers the answer. A refusal changes nothing that worked before.
 */
export async function keepDeviceStorage(): Promise<void> {
  try {
    const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!s || typeof s.persist !== "function") return;
    if (typeof s.persisted === "function" && (await s.persisted())) return;
    await s.persist();
  } catch {
    /* @silent:storage — no Storage API here; eviction stays the browser's
       call, and recallDevice() is the backstop. */
  }
}
