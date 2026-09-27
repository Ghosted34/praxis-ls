/**
 * Login modal — opens over the dimmed landing hero ("command center" sign-in).
 *
 * The card, the scrim and the ways to close it. Everything INSIDE — which
 * credential leads (passkey → PIN → password), 2FA, the forgotten-password
 * link, the passkey offer after a PIN or password sign-in — is `SignInPanel`,
 * shared with the lock screen so the two doors can never disagree.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { useLocation, useNavigate } from "react-router-dom";
import { XIcon } from "@/components/ui/icons";
import { SignInPanel } from "./sign-in-panel";

export function LoginModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";
  const titleId = React.useId();

  const go = React.useCallback(() => navigate(from, { replace: true }), [navigate, from]);

  // Escape closes, like every dialog. Read through a ref so the listener is
  // bound once.
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    // Backdrop dismissal is pointer-only by design; Escape is wired above and is
    // the keyboard equivalent.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="login-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="login-card">
        <button type="button" className="login-close" aria-label={tr("Close")} onClick={onClose}>
          <XIcon />
        </button>
        <SignInPanel mode="signin" titleId={titleId} onDone={go} />
      </div>
    </div>
  );
}
