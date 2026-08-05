/**
 * Applies the signed-in user's personal typography, once, on sign-in.
 *
 * WHY A SEPARATE COMPONENT. BrandingProvider sits OUTSIDE AuthProvider on
 * purpose — the login screen has to be branded before anyone has a token, so
 * the provider cannot depend on auth. But `/me/preferences/appearance` needs
 * one. This component lives inside AuthProvider, where both contexts are
 * readable, and pushes the result up into the branding layer. It renders
 * nothing.
 *
 * WHY THE PERSONAL LAYER IS NOT APPLIED PRE-LOGIN. It cannot be: the server
 * will not say who you are without a token. So the login screen is always the
 * tenant's type, and the user's own takes over on the first authenticated
 * paint. Fonts swapping once at sign-in is the honest behaviour here — the
 * alternative is caching a user's fonts in localStorage and painting them
 * before we know who is at the keyboard, which is wrong on a shared terminal.
 */
import * as React from "react";
import { useAuth } from "@/app/auth/auth-context";
import { useBranding } from "@/app/branding/branding-context";
import { fetchUserAppearance, EMPTY_USER_APPEARANCE } from "@/lib/preferences";

export function UserAppearanceSync() {
  const { status, user } = useAuth();
  const { setUserAppearance } = useBranding();

  const userId = user?.user_id ?? null;
  // Keyed on the user id, not just on `status`: signing out and back in as
  // someone else on the same machine must re-fetch, or the second user inherits
  // the first one's type.
  const appliedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (status !== "authed" || !userId) {
      // Signed out — drop the personal layer so the login screen and the next
      // user start from the tenant's fonts rather than the last session's.
      if (appliedFor.current !== null) {
        appliedFor.current = null;
        setUserAppearance(EMPTY_USER_APPEARANCE);
      }
      return;
    }
    if (appliedFor.current === userId) return;
    appliedFor.current = userId;

    let cancelled = false;
    fetchUserAppearance()
      .then((a) => {
        if (!cancelled) setUserAppearance(a);
      })
      .catch(() => {
        // Offline, or the endpoint is unreachable. The tenant's fonts are
        // already painted and remain correct — a personal preference is not
        // worth an error toast, and retrying would only repeat it.
        if (!cancelled) appliedFor.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [status, userId, setUserAppearance]);

  return null;
}

export default UserAppearanceSync;
