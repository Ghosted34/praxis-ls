/**
 * This browser's device id for the time clock (0524).
 *
 * WHAT THIS IS NOT. A random id this browser generated once and kept — not a
 * hardware identifier and not an authentication factor. Anyone who wants to
 * copy it can. Its value is that a SECOND device showing up against one
 * employee becomes a dated row a manager can see, which is what turns casual
 * buddy-punching into something deliberate that leaves a trace.
 *
 * NOT a browser-signal fingerprint (canvas, fonts, screen metrics) on purpose:
 * those identify the person across sites whether or not they consented, which
 * is a far larger thing to do to an employee than the problem warrants. A
 * random value in this app's own storage identifies the device only to this
 * app, and clearing site data resets it — the cost of which is one
 * re-registration.
 *
 * WHY THIS LIVES HERE RATHER THAN IN hr-api. It has to SURVIVE SIGN-OUT, so its
 * key is on the device list sign-out never touches (device-keys.ts). Sitting in
 * hr-api it would have dragged the whole HR API surface into the auth module;
 * as its own leaf module the list imports one constant. The register is a record of HARDWARE — a
 * device does not stop being the same laptop because the person on it signed
 * out, and re-minting the id on every sign-out made the register count
 * sessions instead of devices.
 */
const DEVICE_KEY = "praxis.device.id";
export const DEVICE_ID_KEY = DEVICE_KEY;

/** This browser's device id, minted on first read. Empty string when storage is
 *  unavailable (private mode, embedded webview) — the server treats a missing
 *  fingerprint as "no device presented" rather than failing the punch. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (
        crypto.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
      ).replace(/-/g, "");
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}
