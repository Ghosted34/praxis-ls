/**
 * Per-user preferences — backend `GET/PUT/DELETE /me/preferences/appearance`
 * (src/modules/preference). Authenticated and always scoped to the caller;
 * there is no user id in the path, so this cannot read or write anyone else's.
 */
import { tenant } from "./api-client";

/**
 * A user's personal typography. Only the three type tokens are overridable —
 * colour, logo and favicon stay the company's (see preference.service.js).
 * `null` on a field means "inherit whatever the tenant set".
 */
export type UserAppearance = {
  fontDisplay: string | null;
  fontBody: string | null;
  fontMono: string | null;
};

export const EMPTY_USER_APPEARANCE: UserAppearance = {
  fontDisplay: null,
  fontBody: null,
  fontMono: null,
};

export const fetchUserAppearance = () => tenant<UserAppearance>("/me/preferences/appearance");

/** Partial — omit a key to leave it, send null to clear it back to the tenant's. */
export const saveUserAppearance = (patch: Partial<UserAppearance>) =>
  tenant<UserAppearance>("/me/preferences/appearance", { method: "PUT", body: patch });

/** Clear all three overrides at once. */
export const resetUserAppearance = () =>
  tenant<UserAppearance>("/me/preferences/appearance", { method: "DELETE" });
