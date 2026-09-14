/**
 * Login modal — opens over the dimmed landing hero ("command center" sign-in).
 *
 * Fully token-driven dark surface (accents resolve to the tenant's --primary).
 * Two tabs:
 *   • PASSWORD  — email + password, reveal, "keep me signed in", forgot link,
 *                 then the retained 2FA code step when the backend requires it.
 *   • QUICK PIN — device-bound fast unlock. Premium UX: segmented OTP boxes,
 *                 trusted-device identity card, read-only last-session email.
 *   • PASSKEY   — WebAuthn (Face ID / Touch ID / security key) when available.
 *
 * Last-session: after any successful sign-in we persist {email, display_name,
 * avatar_url} to localStorage (praxis.last_session). Next visit both tabs
 * prefill it; Quick PIN shows it as a read-only pill + avatar card with a
 * "Not you?" switch to re-enable editing. The value survives logout/restart,
 * like pinStore/deviceId — it's a device fact, not session state.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { useBranding } from "@/app/branding/branding-context";
import { ApiError, tenant } from "@/lib/api-client";
import { OtpInput } from "@/components/ui/otp-input";
import { PinInput, PinKeypad } from "@/components/ui/pin-input";
import { lastSessionStore } from "@/lib/last-session";
import { pinStore } from "@/lib/pin-store";
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
type Stage = "credentials" | "twofa" | "forgot" | "forgot-sent";

function FingerprintIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden width={16} height={16} {...props}>
      <path d="M12 2a7 7 0 0 0-7 7v3a7 7 0 0 0 7 7 7 7 0 0 0 7-7V9a7 7 0 0 0-7-7Z" />
      <path d="M12 6a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3 3 3 0 0 0 3-3V9a3 3 0 0 0-3-3Z" />
      <path d="M12 10v4" />
      <path d="M9.5 12.5A2.5 2.5 0 0 0 12 15a2.5 2.5 0 0 0 2.5-2.5" />
      <path d="M8 10.5A5 5 0 0 1 12 8a5 5 0 0 1 4 2.5" />
    </svg>
  );
}

export function LoginModal({ onClose }: { onClose: () => void }) {
  const { login, verify2fa, pinLogin, passkeyLogin } = useAuth();
  const { branding } = useBranding();
  const brandName = branding.name || "Praxis LS";
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";

  const [tab, setTab] = React.useState<Tab>("password");
  const [stage, setStage] = React.useState<Stage>("credentials");

  // Last-session: single remembered identity, prefill both tabs.
  const [lastSession, setLastSession] = React.useState(() => lastSessionStore.get());
  const initialEmail = lastSession?.email ?? "";
  const [email, setEmail] = React.useState(initialEmail);
  // Quick PIN read-only mode: when we have a remembered email, lock the field
  // and show only the PIN boxes + identity card. "Not you?" flips it to editable.
  const [pinEditingEmail, setPinEditingEmail] = React.useState(() => !lastSession?.email);
  const hasRemembered = Boolean(lastSession?.email);
  const isPinLocked = hasRemembered && !pinEditingEmail && tab === "pin";

  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [keep, setKeep] = React.useState(true);
  const [code, setCode] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [showKeypad, setShowKeypad] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = React.useState(false);
  const [passkeyError, setPasskeyError] = React.useState<string | null>(null);
  const [passkeySupported, setPasskeySupported] = React.useState<boolean | null>(null);

  const emailRef = React.useRef<HTMLInputElement>(null);
  const pinEmailRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    // Focus strategy: password tab -> email, PIN locked -> first PIN box, PIN editable -> email
    if (stage !== "credentials") return;
    if (tab === "password") emailRef.current?.focus();
    else if (pinEditingEmail) pinEmailRef.current?.focus();
    // When PIN is locked, PinInput autoFocus handles it
  }, [tab, pinEditingEmail, stage]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Detect WebAuthn support once
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const PKC = typeof window !== "undefined" ? (window.PublicKeyCredential as any) : undefined;
      if (!PKC) {
        if (alive) setPasskeySupported(false);
        return;
      }
      // A probe that REFUSES to answer is not a "no". Settle it explicitly rather
      // than catching: only a resolved `false` — this device has no platform
      // authenticator — takes the passkey route away.
      let ok = true;
      if (typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
        const [probe] = await Promise.allSettled([PKC.isUserVerifyingPlatformAuthenticatorAvailable()]);
        ok = probe.status === "fulfilled" ? !!probe.value : true;
      }
      if (alive) setPasskeySupported(ok);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Sync email across tabs: when lastSession loads, keep email in sync unless user is editing
  React.useEffect(() => {
    if (lastSession?.email && !email) setEmail(lastSession.email);
  }, [lastSession, email]);

  function friendly(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.code === "INVALID_CREDENTIALS")
        return "That email or password doesn't match. Try again.";
      if (err.code === "USER_INACTIVE")
        return "This account is suspended. Contact your administrator.";
      if (err.code === "INVALID_2FA_CODE")
        return "That code isn't right. Check your authenticator and retry.";
      if (err.code === "ERROR")
        return "Can't reach the server. Check your connection.";
      if (err.code === "NO_PIN_DEVICE")
        return "No Quick PIN is set up on this device for that email. Sign in with your password, then enable it in My security.";
      if (err.code === "INVALID_PIN") return "That PIN isn't right. Try again.";
      if (err.code === "PIN_LOCKED" || err.code === "PIN_LOGIN_UNAVAILABLE")
        return "Too many attempts — sign in with your password.";
      if (err.code === "WEBAUTHN_NOT_SUPPORTED") return "Passkeys aren't supported on this browser yet.";
      if (err.code === "PASSKEY_NOT_FOUND") return "No passkey found for that account. Sign in with password, then add one in My security.";
      return err.message;
    }
    if (err instanceof Error && err.message) return err.message;
    return "Something went wrong. Please try again.";
  }

  async function onCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setPasskeyError(null);
    try {
      const { pending2fa } = await login(email.trim(), password, keep);
      if (pending2fa) setStage("twofa");
      else {
        // Persist last-session immediately (auth-context also does, but this covers pending_2fa skip)
        setLastSession(lastSessionStore.get());
        navigate(from, { replace: true });
      }
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
      setLastSession(lastSessionStore.get());
      navigate(from, { replace: true });
    } catch (err) {
      setError(friendly(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant("/auth/forgot-password", {
        method: "POST",
        body: { email: email.trim() },
        auth: false,
        retry: false,
      });
      setStage("forgot-sent");
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPin(e?: React.FormEvent) {
    e?.preventDefault();
    const targetEmail = email.trim() || lastSession?.email || "";
    if (!targetEmail) {
      setError("Enter your email first.");
      return;
    }
    if (pin.length < 4) {
      setError("PIN must be 4–8 digits.");
      return;
    }
    setBusy(true);
    setError(null);
    setPasskeyError(null);
    try {
      await pinLogin(targetEmail, pin);
      setLastSession(lastSessionStore.get());
      navigate(from, { replace: true });
    } catch (err) {
      setError(friendly(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  async function onPasskey() {
    setPasskeyBusy(true);
    setPasskeyError(null);
    setError(null);
    try {
      const hintEmail = isPinLocked ? lastSession?.email ?? email.trim() : email.trim();
      await passkeyLogin(hintEmail || undefined);
      setLastSession(lastSessionStore.get());
      navigate(from, { replace: true });
    } catch (err: any) {
      if (err && (err.name === "NotAllowedError" || err.code === "NOT_ALLOWED")) {
        setPasskeyError(null);
      } else {
        setPasskeyError(friendly(err));
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  // For PIN identity card
  const pinHasDevice = React.useMemo(() => {
    const e = (email.trim() || lastSession?.email || "").toLowerCase();
    return e ? !!pinStore.get(e) : false;
  }, [email, lastSession]);

  const pinDeviceLabel = React.useMemo(() => {
    const e = (email.trim() || lastSession?.email || "").toLowerCase();
    return e ? pinStore.get(e)?.label : null;
  }, [email, lastSession]);

  const displayEmail = email.trim() || lastSession?.email || "";
  const displayName = lastSession?.display_name || displayEmail.split("@")[0] || "there";
  const avatarUrl = lastSession?.avatar_url || null;

  return (
    // Backdrop dismissal is pointer-only by design; Escape is wired in the
    // effect above and is the keyboard equivalent.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="login-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="login-card">
        <button
          type="button"
          className="login-close"
          aria-label={tr("Close")}
          onClick={onClose}
        >
          <XIcon />
        </button>

        <p className="login-card-kicker">{brandName}</p>
        <h2 className="login-card-title">Welcome back</h2>
        <p className="login-card-sub">
          {stage === "twofa"
            ? "Two-factor authentication"
            : stage === "forgot"
              ? "Reset your password"
              : stage === "forgot-sent"
                ? "Check your inbox"
                : "Sign in to your command center."}
        </p>

        {stage === "credentials" && (
          <div className="seg mt-5">
            <button
              type="button"
              className="seg-tab"
              data-active={tab === "password"}
              onClick={() => {
                setTab("password");
                setError(null);
                setPasskeyError(null);
              }}
            >
              <KeyIcon width={15} height={15} /> Password
            </button>
            <button
              type="button"
              className="seg-tab"
              data-active={tab === "pin"}
              onClick={() => {
                setTab("pin");
                setError(null);
                setPasskeyError(null);
              }}
            >
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
              {hasRemembered && email === lastSession?.email && (
                <span className="text-[11px] text-white/45">
                  Remembered from last sign-in •{" "}
                  <button type="button" className="underline decoration-white/20 hover:text-white/70" onClick={() => setEmail("")}>
                    Use another account
                  </button>
                </span>
              )}
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
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={keep}
                  onChange={(e) => setKeep(e.target.checked)}
                />
                <span className="login-check-box">{keep && <CheckIcon width={13} height={13} />}</span>
                Keep me signed in
              </label>
              <button
                type="button"
                className="login-link"
                onClick={() => {
                  setError(null);
                  setPasskeyError(null);
                  setStage("forgot");
                }}
              >
                Forgot password?
              </button>
            </div>

            {error && <p className="login-error">{error}</p>}

            <button type="submit" className="login-submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              {!busy && <ArrowRightIcon width={16} height={16} />}
            </button>

            {/* Passkey — secondary, always available as an alternative */}
            <div className="relative my-1 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-[11px] tracking-widest text-white/35">OR</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <button
              type="button"
              onClick={onPasskey}
              disabled={passkeyBusy || busy}
              className="flex h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.06] text-[13px] font-semibold text-white backdrop-blur transition hover:bg-white/[0.10] hover:border-white/18 disabled:opacity-50"
            >
              <FingerprintIcon width={16} height={16} />
              {passkeyBusy ? "Waiting for passkey…" : "Sign in with passkey"}
              <span className="hidden sm:inline text-white/45 font-normal">• Face ID / Touch ID</span>
            </button>
            {passkeyError && <p className="login-error text-center">{passkeyError}</p>}
            {passkeySupported === false && (
              <p className="text-center text-[11px] text-white/35">Passkeys need a secure browser (HTTPS + platform authenticator). Password + PIN still work everywhere.</p>
            )}
          </form>
        )}

        {/* --- Quick PIN tab — premium redesign --- */}
        {stage === "credentials" && tab === "pin" && (
          <form onSubmit={onPin} className="mt-4 flex flex-col gap-4" noValidate>
            {/* Identity card — read-only when we have a remembered session */}
            {isPinLocked ? (
              <div className="pin-identity">
                <div className="pin-identity-card">
                  <div className="flex items-center gap-3">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover ring-1 ring-white/10" />
                    ) : (
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                        {(displayName || displayEmail || "?").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{displayName}</div>
                      <div className="truncate text-xs text-white/60">{displayEmail}</div>
                    </div>
                    {pinHasDevice && (
                      <span className="status st-ok !gap-1 !py-1 !text-[11px]">
                        <CheckIcon width={12} height={12} /> This device
                      </span>
                    )}
                  </div>
                  {pinDeviceLabel && (
                    <div className="mt-2 text-[11px] text-white/45">
                      Device: <span className="text-white/70">{pinDeviceLabel}</span>
                    </div>
                  )}
                </div>
                <button type="button" className="pin-switch" onClick={() => setPinEditingEmail(true)}>
                  Not you? Use another account
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="login-label" htmlFor="lm-pin-email">
                  Email
                </label>
                <div className="login-field">
                  <MailIcon width={17} height={17} />
                  <input
                    ref={pinEmailRef}
                    id="lm-pin-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </div>
                {hasRemembered && (
                  <button type="button" className="self-start text-[11px] text-white/45 hover:text-white/70" onClick={() => setPinEditingEmail(false)}>
                    ← Back to {displayEmail}
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="login-label">Quick PIN</span>
                {!isPinLocked && <span className="text-[11px] text-white/35">Device-bound • 4–8 digits</span>}
              </div>

              <PinInput
                value={pin}
                onChange={setPin}
                onComplete={() => onPin()}
                disabled={busy}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus={isPinLocked || !hasRemembered}
              />

              {/* Numeric keypad — collapsible for touch */}
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  className="text-[11px] text-white/40 hover:text-white/70 underline decoration-white/20"
                  onClick={() => setShowKeypad((s) => !s)}
                >
                  {showKeypad ? "Hide keypad" : "Show keypad"}
                </button>
              </div>
              {showKeypad && (
                <PinKeypad
                  disabled={busy}
                  onDigit={(d) => setPin((p) => (p + d).replace(/\D/g, "").slice(0, 8))}
                  onBackspace={() => setPin((p) => p.slice(0, -1))}
                />
              )}
            </div>

            {error && <p className="login-error">{error}</p>}
            {passkeyError && <p className="login-error text-center">{passkeyError}</p>}

            <button type="submit" className="login-submit" disabled={busy || pin.length < 4}>
              {busy ? "Signing in…" : "Sign in with PIN"}
              {!busy && <ArrowRightIcon width={16} height={16} />}
            </button>
            <p className="login-note">
              PIN works only on a device where you enabled it. New device? Use your password.
            </p>

            <div className="relative my-1 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-[11px] tracking-widest text-white/35">OR</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <button
              type="button"
              onClick={onPasskey}
              disabled={passkeyBusy || busy}
              className="flex h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.06] text-[13px] font-semibold text-white backdrop-blur transition hover:bg-white/[0.10] hover:border-white/18 disabled:opacity-50"
            >
              <FingerprintIcon width={16} height={16} />
              {passkeyBusy ? "Waiting for passkey…" : "Sign in with passkey"}
            </button>
          </form>
        )}

        {/* --- Forgot-password stage --- */}
        {stage === "forgot" && (
          <form onSubmit={onForgot} className="mt-5 flex flex-col gap-4" noValidate>
            <p className="login-note">Enter your account email and we'll send you a link to reset your password.</p>
            <div className="flex flex-col gap-1.5">
              <label className="login-label" htmlFor="lm-forgot-email">
                Email
              </label>
              <div className="login-field">
                <MailIcon width={17} height={17} />
                <input
                  id="lm-forgot-email"
                  type="email"
                  autoComplete="username"
                  required
                  // Hand-rolled dialog (login-scrim), NOT the Radix one — nothing else
                  // moves focus into it on open, so this is the dialog's initial-focus
                  // step rather than an unsolicited grab.
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
            </div>

            {error && <p className="login-error">{error}</p>}

            <button type="submit" className="login-submit" disabled={busy || !email.trim()}>
              {busy ? "Sending…" : "Send reset link"}
              {!busy && <ArrowRightIcon width={16} height={16} />}
            </button>
            <button
              type="button"
              className="login-note"
              onClick={() => {
                setStage("credentials");
                setError(null);
                setPasskeyError(null);
              }}
            >
              ← Back to sign in
            </button>
          </form>
        )}

        {/* --- Forgot-password confirmation --- */}
        {stage === "forgot-sent" && (
          <div className="mt-6 flex flex-col gap-5">
            <p className="login-note">
              If an account exists for <strong>{email.trim()}</strong>, we've sent a password-reset link. It expires in 30 minutes. Check your
              inbox — and your spam folder just in case.
            </p>
            <button
              type="button"
              className="login-submit"
              onClick={() => {
                setStage("credentials");
                setError(null);
                setPasskeyError(null);
              }}
            >
              Back to sign in
            </button>
          </div>
        )}

        {/* --- 2FA stage (retained) --- */}
        {stage === "twofa" && (
          <form onSubmit={(e) => e.preventDefault()} className="mt-6 flex flex-col gap-5" noValidate>
            <p className="login-note">Enter the 6-digit code from your authenticator app.</p>
            {/* Focus moves to the OTP field when the 2FA stage replaces the
                password form — the element the user was typing in is gone by
                then, so this is focus RECOVERY, not an unsolicited grab. */}
            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={submitCode}
              // Directly above the prop it excuses, INSIDE the tag. As a
              // `{/* */}` above the element it guarded whichever line came
              // next — which stopped being `autoFocus` the moment the element
              // wrapped across lines, leaving an unused directive and an
              // unsuppressed error. Same placement place-picker.tsx uses.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              disabled={busy}
            />
            {error && <p className="login-error text-center">{error}</p>}
            <button type="button" className="login-submit" onClick={() => submitCode(code)} disabled={busy || code.length < 6}>
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              className="login-note"
              onClick={() => {
                setStage("credentials");
                setError(null);
                setCode("");
                setPasskeyError(null);
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
