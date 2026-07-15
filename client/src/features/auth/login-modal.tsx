/**
 * Login modal — opens over the dimmed landing hero ("command center" sign-in).
 *
 * Fully token-driven dark surface (accents resolve to the tenant's --primary).
 * Two tabs:
 *   • PASSWORD  — email + password, reveal, "keep me signed in", forgot link,
 *                 then the retained 2FA code step when the backend requires it.
 *   • QUICK PIN — device-bound fast unlock. UI stub only for now: there's no
 *                 backend endpoint yet, so it explains the flow and routes back
 *                 to password. Wire to a real /auth/quick-pin later.
 *
 * "Keep me signed in" is real: it controls whether the refresh token persists
 * across browser restarts (see token-store) — passed into login().
 */
import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { ApiError } from "@/lib/api-client";
import { OtpInput } from "@/components/ui/otp-input";
import {
  MailIcon,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  ArrowRightIcon,
  XIcon,
  KeyIcon,
  HashIcon,
  CheckIcon,
} from "@/components/ui/icons";

type Tab = "password" | "pin";
type Stage = "credentials" | "twofa";

export function LoginModal({ onClose }: { onClose: () => void }) {
  const { login, verify2fa, pinLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";

  const [tab, setTab] = React.useState<Tab>("password");
  const [stage, setStage] = React.useState<Stage>("credentials");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [keep, setKeep] = React.useState(true);
  const [code, setCode] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    emailRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function friendly(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.code === "INVALID_CREDENTIALS") return "That email or password doesn't match. Try again.";
      if (err.code === "USER_INACTIVE") return "This account is suspended. Contact your administrator.";
      if (err.code === "INVALID_2FA_CODE") return "That code isn't right. Check your authenticator and retry.";
      if (err.code === "ERROR") return "Can't reach the server. Check your connection.";
      if (err.code === "NO_PIN_DEVICE")
        return "No Quick PIN is set up on this device. Sign in with your password, then enable it in My security.";
      if (err.code === "INVALID_PIN") return "That PIN isn't right. Try again.";
      if (err.code === "PIN_LOCKED" || err.code === "PIN_LOGIN_UNAVAILABLE")
        return "Too many attempts — sign in with your password.";
      return err.message;
    }
    return "Something went wrong. Please try again.";
  }

  async function onCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { pending2fa } = await login(email.trim(), password, keep);
      if (pending2fa) setStage("twofa");
      else navigate(from, { replace: true });
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value: string) {
    setBusy(true);
    setError(null);
    try {
      await verify2fa(value.trim());
      navigate(from, { replace: true });
    } catch (err) {
      setError(friendly(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function onPin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pinLogin(email.trim(), pin);
      navigate(from, { replace: true });
    } catch (err) {
      setError(friendly(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="login-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="login-card">
        <button type="button" className="login-close" aria-label="Close" onClick={onClose}>
          <XIcon />
        </button>

        <p className="login-card-kicker">The Pixie Hub</p>
        <h2 className="login-card-title">Welcome back</h2>
        <p className="login-card-sub">
          {stage === "twofa" ? "Two-factor authentication" : "Sign in to your command center."}
        </p>

        {stage === "credentials" && (
          <div className="seg mt-5">
            <button type="button" className="seg-tab" data-active={tab === "password"} onClick={() => setTab("password")}>
              <KeyIcon width={15} height={15} /> Password
            </button>
            <button type="button" className="seg-tab" data-active={tab === "pin"} onClick={() => setTab("pin")}>
              <HashIcon width={15} height={15} /> Quick PIN
            </button>
          </div>
        )}

        {/* --- Password tab --- */}
        {stage === "credentials" && tab === "password" && (
          <form onSubmit={onCredentials} className="mt-5 flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <label className="login-label" htmlFor="lm-email">
                Email
              </label>
              <div className="login-field">
                <MailIcon width={17} height={17} />
                <input
                  ref={emailRef}
                  id="lm-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="login-label" htmlFor="lm-pw">
                Password
              </label>
              <div className="login-field">
                <LockIcon width={17} height={17} />
                <input
                  id="lm-pw"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOffIcon width={17} height={17} /> : <EyeIcon width={17} height={17} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="login-check">
                <input type="checkbox" className="sr-only" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                <span className="login-check-box">{keep && <CheckIcon width={13} height={13} />}</span>
                Keep me signed in
              </label>
              <button
                type="button"
                className="login-link"
                onClick={() => setError("Password resets aren't wired up yet — contact your administrator.")}
              >
                Forgot password?
              </button>
            </div>

            {error && <p className="login-error">{error}</p>}

            <button type="submit" className="login-submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              {!busy && <ArrowRightIcon width={16} height={16} />}
            </button>
          </form>
        )}

        {/* --- Quick PIN tab --- */}
        {stage === "credentials" && tab === "pin" && (
          <form onSubmit={onPin} className="mt-5 flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <label className="login-label" htmlFor="lm-pin-email">
                Email
              </label>
              <div className="login-field">
                <MailIcon width={17} height={17} />
                <input
                  id="lm-pin-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="login-label" htmlFor="lm-pin">
                Quick PIN
              </label>
              <div className="login-field">
                <HashIcon width={17} height={17} />
                <input
                  id="lm-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="••••"
                />
              </div>
            </div>

            {error && <p className="login-error">{error}</p>}

            <button type="submit" className="login-submit" disabled={busy || pin.length < 4}>
              {busy ? "Signing in…" : "Sign in with PIN"}
              {!busy && <ArrowRightIcon width={16} height={16} />}
            </button>
            <p className="login-note">PIN works only on a device where you enabled it. New device? Use your password.</p>
          </form>
        )}

        {/* --- 2FA stage (retained) --- */}
        {stage === "twofa" && (
          <form onSubmit={(e) => e.preventDefault()} className="mt-6 flex flex-col gap-5" noValidate>
            <p className="login-note">Enter the 6-digit code from your authenticator app.</p>
            <OtpInput value={code} onChange={setCode} onComplete={submitCode} autoFocus disabled={busy} />
            {error && <p className="login-error text-center">{error}</p>}
            <button
              type="button"
              className="login-submit"
              onClick={() => submitCode(code)}
              disabled={busy || code.length < 6}
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              className="login-note"
              onClick={() => {
                setStage("credentials");
                setError(null);
                setCode("");
              }}
            >
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
