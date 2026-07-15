/**
 * Device-bound Quick PIN registry. Maps email → { device_id, label } for PINs
 * registered on THIS device. Unlike the rest of client state (wiped on logout),
 * this survives sign-out on purpose — the whole point of Quick PIN is to sign
 * back in fast on a trusted device. auth-context preserves this key across the
 * logout localStorage.clear() via snapshot()/restore().
 */
const KEY = "praxis.pin.devices";

export type PinDevice = { device_id: string; label?: string | null };
type Registry = Record<string, PinDevice>;

function read(): Registry {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Registry;
  } catch {
    return {};
  }
}
function write(r: Registry) {
  localStorage.setItem(KEY, JSON.stringify(r));
}

export const pinStore = {
  get: (email: string): PinDevice | null => read()[email.trim().toLowerCase()] || null,
  set: (email: string, d: PinDevice) => {
    const r = read();
    r[email.trim().toLowerCase()] = d;
    write(r);
  },
  remove: (email: string) => {
    const r = read();
    delete r[email.trim().toLowerCase()];
    write(r);
  },
  snapshot: (): string => localStorage.getItem(KEY) || "{}",
  restore: (s: string) => localStorage.setItem(KEY, s),
};
