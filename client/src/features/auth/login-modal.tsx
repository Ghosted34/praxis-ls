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
import { PIN_LENGTH, PinInput, PinKeypad } from "@/components/ui/pin-input";
import { lastSessionStore } from "@/lib/last-session";
import { passkeyDeviceStore } from "@/lib/passkey-devices";
import { passkeyOfferStore } from "@/lib/passkey-offer";
import { PASSKEY_SETTING_PATH } from "@/features/security/passkey-nudge";
import { pinStore } from "@/lib/pin-store";
import { listPasskeys, registerPasskey } from "@/lib/webauthn";
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
type Stage = "credentials" | "twofa" | "forgot" | "forgot-sent" | "offer-passkey";

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

  /**
   * The stored identity, and the two things the device knows about it.
   *
   * THE MODEL. `lastSession` is the account this device belongs to. While it is
   * set the modal is IDENTITY-FIRST: a greeting, a way out ("Not you? Switch
   * account"), and whichever quick credentials this device holds for that
   * account. Once it is cleared — by that switch link, or by "Sign out and
   * remove this account" in the shell — the modal is the classic form again and
   * the next person starts from an empty email field.
   *
   * WHICH CREDENTIAL LEADS is a device fact, not a preference, and both facts
   * are already recorded: `pinStore` knows whether this browser is one the PIN
   * was enrolled on, and `passkeyDeviceStore` knows whether a credential for
   * this account lives on this machine. Priority is PIN → passkey → password,
   * because a 4-digit PIN is the fewest taps of the three and the passkey
   * ceremony cannot run without a tap anyway. Without both halves the screen
   * would offer a route whose only outcome is "PIN works only on a device where
   * you enabled it".
   */
  const [lastSession, setLastSession] = React.useState(() => lastSessionStore.get());
  const [stage, setStage] = React.useState<Stage>("credentials");
  const initialEmail = lastSession?.email ?? "";
  const [email, setEmail] = React.useState(initialEmail);
  /**
   * Tabs exist only for the device that knows nobody. Somebody arriving at an
   * unknown browser may still hold a Quick PIN on it for their account, so the
   * password and PIN routes both have to be reachable — that is the whole job
   * of this state now. On the identity screen there is nothing to switch
   * between and the value is never read.
   */
  const [tab, setTab] = React.useState<Tab>("password");

  const remembered = lastSession;
  const rememberedEmail = remembered?.email ?? "";
  const pinDevice = rememberedEmail ? pinStore.get(rememberedEmail) : null;
  /**
   * A store read is not reactive, so the one place that can invalidate it — a
   * ceremony answering PASSKEY_NOT_FOUND — bumps this counter to re-read it in
   * the same commit. Without it the orb would stay on screen until the modal
   * was reopened, offering a button the user had just watched fail.
   */
  const [registryVersion, setRegistryVersion] = React.useState(0);
  const passkeyHere = React.useMemo(
    () => passkeyDeviceStore.get(rememberedEmail),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registryVersion is the invalidation signal for a localStorage read, which React cannot track.
    [rememberedEmail, registryVersion],
  );
  /** A quick route exists, so the password is a fallback rather than the door. */
  const hasQuickRoute = Boolean(pinDevice) || passkeyHere;

  const [password, setPassword] = React.useState("");
  /** The password field, revealed from the identity screen's fallback link. */
  const [passwordOpen, setPasswordOpen] = React.useState(false);
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

  const [offerBusy, setOfferBusy] = React.useState(false);
  const [offerError, setOfferError] = React.useState<string | null>(null);

  // The Escape listener is bound once, so it reads `dismiss` through a ref
  // rather than capturing the first render's copy — which would still be the
  // one that ignores the passkey-offer stage.
  const dismissRef = React.useRef<() => void>(() => onClose());

  const emailRef = React.useRef<HTMLInputElement>(null);
  const pinEmailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    // Focus strategy, identity screen: the PIN boxes focus themselves (the
    // PinInput `autoFocus` prop below), so nothing is grabbed here. Greeting a
    // returning user is not a reason to put their cursor in a field they did
    // not ask for — least of all the password one, next to a Touch ID button
    // that is the faster answer.
    if (stage !== "credentials" || remembered) return;
    if (tab === "password") emailRef.current?.focus();
    else pinEmailRef.current?.focus();
  }, [tab, stage, remembered]);

  // Revealing the password is a click the user just made, so moving focus into
  // the field is finishing their action rather than starting one for them.
  React.useEffect(() => {
    if (passwordOpen && !pinDevice) passwordRef.current?.focus();
  }, [passwordOpen, pinDevice]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismissRef.current();
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

  /*
   * There is deliberately NO effect syncing `email` back from `lastSession`.
   *
   * There used to be one — `if (lastSession?.email && !email) setEmail(
   * lastSession.email)` — written to "keep email in sync unless the user is
   * editing". It could not tell those two apart: an empty field is the state a
   * user reaches by DELETING the last character, so the moment they cleared the
   * remembered address to type a different one, the effect saw `!email`,
   * concluded the sync had not happened yet, and wrote the old address back in.
   * Backspace on the final character re-filled the whole thing, and "Use
   * another account" — whose entire job was `setEmail("")` — was undone in the
   * same commit.
   *
   * The effect is gone, and the field it fed is gone on any device that
   * remembers someone: the identity screen knows the address and does not ask
   * for it, so there is no longer a state where a prefilled value and an
   * editable email field exist together. The prefill still happens where the
   * value actually becomes known — `useState(initialEmail)` reads the store on
   * mount — and `login-modal.email.test.tsx` guards the handover that replaced
   * it: switching account releases the device and yields an empty, focused
   * field.
   */

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
        await finishSignIn(email.trim().toLowerCase());
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
      await finishSignIn((lastSessionStore.get()?.email || email.trim()).toLowerCase());
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

  /**
   * "Not you? Switch account" — the ONE way the device releases an identity.
   *
   * This is the deliberate half of an otherwise automatic screen. A device that
   * greets you by name and then refuses to accept anyone else's address is a
   * locked door on a shared workstation, so the release has to be visible and
   * it has to be a click away from the greeting. It is also the only thing that
   * clears the store: nothing here expires on a timer, because "permanently
   * stores that user" is the request.
   *
   * WHAT IT DOES NOT TOUCH. The credentials — `pinStore` and
   * `passkeyDeviceStore` are keyed by email and survive this. Forgetting who is
   * standing here is not the same as destroying their credential on this
   * machine, and the previous user signing back in should still get their PIN.
   * Destroying them is the other, louder exit: "Sign out and remove this
   * account" in the shell, which clears all three.
   */
  function onSwitchAccount() {
    lastSessionStore.clear();
    setLastSession(null);
    setEmail("");
    setPassword("");
    setPin("");
    setPasswordOpen(false);
    setError(null);
    setPasskeyError(null);
    setTab("password");
  }

  /** The button and the Enter key: submit whatever is in the boxes. */
  async function onPin(e?: React.FormEvent) {
    e?.preventDefault();
    return submitPin(pin);
  }

  /**
   * The PIN sign-in itself, taking the digits as an ARGUMENT.
   *
   * WHY IT CANNOT READ `pin` STATE, and this was a live bug: `PinInput` calls
   * `onChange(joined)` and then `onComplete(joined)` in the same tick, so the
   * state variable still holds the three digits from the previous render when
   * completion fires. The old handler read it anyway, decided the PIN was too
   * short, and answered `onComplete={() => onPin()}` — the auto-submit on the
   * fourth digit, the whole point of a PIN — with "PIN must be 4 digits." while
   * four digits sat on screen. Only the button worked.
   *
   * Taking the value from the callback removes the race instead of working
   * around it, which matters more here than it used to: the PIN is now the
   * primary action on the identity screen, so the broken path would have been
   * the first one a returning user met.
   */
  async function submitPin(entered: string) {
    const targetEmail = email.trim() || rememberedEmail;
    if (!targetEmail) {
      setError("Enter your email first.");
      return;
    }
    if (entered.length !== PIN_LENGTH) {
      setError(`PIN must be ${PIN_LENGTH} digits.`);
      return;
    }
    setBusy(true);
    setError(null);
    setPasskeyError(null);
    try {
      await pinLogin(targetEmail, entered);
      setLastSession(lastSessionStore.get());
      await finishSignIn(targetEmail.toLowerCase());
    } catch (err) {
      setError(friendly(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Last step of every password/PIN sign-in. A passkey is the one credential
   * that cannot be phished or reused, and the moment just after someone proves
   * who they are is the only moment they are both authenticated (the register
   * routes need it) and still thinking about signing in.
   *
   * It asks once per identity per device and never blocks the way in: no
   * support, already enrolled, previously declined, or an unreachable list all
   * fall through to the app. `listPasskeys` is settled rather than caught so a
   * failed lookup is an explicit outcome instead of a swallowed one.
   */
  async function finishSignIn(signedInEmail: string) {
    const go = () => navigate(from, { replace: true });
    if (!passkeySupported || !signedInEmail || passkeyOfferStore.declined(signedInEmail)) return go();
    const [existing] = await Promise.allSettled([listPasskeys()]);
    if (existing.status === "fulfilled" && existing.value.length === 0) {
      setStage("offer-passkey");
      return;
    }
    go();
  }

  async function onAddPasskeyNow() {
    setOfferBusy(true);
    setOfferError(null);
    try {
      await registerPasskey(null);
      navigate(from, { replace: true });
    } catch (err: any) {
      // A cancelled Face ID / Touch ID prompt is an answer, not a fault.
      if (err && (err.name === "NotAllowedError" || err.code === "NOT_ALLOWED")) {
        setOfferError(`Passkey setup was cancelled. You can add one any time under ${PASSKEY_SETTING_PATH}.`);
      } else {
        setOfferError(friendly(err));
      }
    } finally {
      setOfferBusy(false);
    }
  }

  /**
   * Closing at the passkey offer is not closing a sign-in — that already
   * succeeded — so it means "not now" and has to land them in the app. Wiring
   * the X, the backdrop and Escape to a bare onClose there would drop an
   * authenticated user back onto the signed-out page.
   */
  function dismiss() {
    if (stage === "offer-passkey") onSkipPasskey();
    else onClose();
  }

  React.useEffect(() => {
    dismissRef.current = dismiss;
  });

  function onSkipPasskey() {
    const e = (lastSessionStore.get()?.email || email.trim()).toLowerCase();
    if (e) passkeyOfferStore.decline(e);
    navigate(from, { replace: true });
  }

  async function onPasskey() {
    setPasskeyBusy(true);
    setPasskeyError(null);
    setError(null);
    try {
      // On the identity screen the device already knows whose account this is,
      // so the ceremony is scoped to their credentials rather than to whatever
      // is currently in a field that may not even be rendered.
      const hintEmail = rememberedEmail || email.trim();
      await passkeyLogin(hintEmail || undefined);
      setLastSession(lastSessionStore.get());
      navigate(from, { replace: true });
    } catch (err: any) {
      if (err && (err.name === "NotAllowedError" || err.code === "NOT_ALLOWED")) {
        // Dismissed. Not an answer about the credential, so the device's claim
        // stands and the orb stays where it is.
        setPasskeyError(null);
      } else {
        // PASSKEY_NOT_FOUND is the device being WRONG: the registry says this
        // machine holds a credential for the account and the server says there
        // is nothing to match. That happens often enough to matter — a key
        // deleted from the OS keychain, a restored laptop, a credential revoked
        // from another session. Correct the record and retire the orb, so the
        // next visit does not lead with a button that cannot work.
        if (err?.code === "PASSKEY_NOT_FOUND" && rememberedEmail) {
          passkeyDeviceStore.remove(rememberedEmail);
          setRegistryVersion((v) => v + 1);
        }
        setPasskeyError(friendly(err));
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  const avatarUrl = lastSession?.avatar_url || null;
  /**
   * The stored identity's name. Falls back to the email's local part, never to
   * "there" — the greeting has to name the account it is about to unlock.
   */
  const greetingName =
    remembered?.display_name || rememberedEmail.split("@")[0] || "";

  /**
   * The password block, in both places it appears: as the whole door when the
   * device knows nobody, and as the fallback under a greeting when it does.
   * `withEmail` is the difference — a known identity means the address is
   * already settled and re-asking for it would be asking a question the device
   * can answer itself.
   */
  function passwordFields(withEmail: boolean, autoFocusEmail: boolean) {
    return (
      <>
        {withEmail && (
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
                // eslint-disable-next-line jsx-a11y/no-autofocus -- hand-rolled scrim, nothing else moves focus in; see the file's own note on the forgot stage.
                autoFocus={autoFocusEmail}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="login-label" htmlFor="lm-pw">
            Password
          </label>
          <div className="login-field">
            <LockIcon width={17} height={17} />
            <input
              ref={passwordRef}
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
              {showPw ? (
                <EyeOffIcon width={17} height={17} />
              ) : (
                <EyeIcon width={17} height={17} />
              )}
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
            <span className="login-check-box">
              {keep && <CheckIcon width={13} height={13} />}
            </span>
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

        <button
          type="submit"
          className="login-submit"
          disabled={busy || !email.trim() || !password}
        >
          {busy ? "Signing in…" : "Sign in"}
          {!busy && <ArrowRightIcon width={16} height={16} />}
        </button>
      </>
    );
  }

  return (
    // Backdrop dismissal is pointer-only by design; Escape is wired in the
    // effect above and is the keyboard equivalent.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="login-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      onMouseDown={(e) => e.target === e.currentTarget && dismiss()}
    >
      <div className="login-card">
        <button
          type="button"
          className="login-close"
          aria-label={tr("Close")}
          onClick={dismiss}
        >
          <XIcon />
        </button>

        <p className="login-card-kicker">{brandName}</p>
        <h2 className="login-card-title">
          {stage === "credentials" && remembered
            ? `Welcome back ${greetingName}`
            : "Welcome back"}
        </h2>
        <p className="login-card-sub">
          {stage === "twofa"
            ? "Two-factor authentication"
            : stage === "forgot"
              ? "Reset your password"
              : stage === "forgot-sent"
                ? "Check your inbox"
                : stage === "offer-passkey"
                  ? "One last thing"
                  : stage === "credentials" && remembered
                    ? "This device is set up for you."
                    : "Sign in to your command center."}
        </p>

        {/*
          ── IDENTITY-FIRST SIGN-IN ───────────────────────────────────────────
          Rendered when this device has a stored account. The greeting is not
          decoration: on a shared workstation the first thing a person needs to
          know is WHICH account the machine is about to open, and saying it out
          loud is also what makes "Not you?" a question they can answer. The
          email field is gone on purpose — the device knows it, and a field
          nobody needs to fill in is a field that gets filled in wrongly.

          The tab strip is gone with it. With one identity and a known set of
          credentials there is nothing to switch between: the routes are all on
          the screen at once, ordered by how few taps they cost.
        */}
        {stage === "credentials" && remembered && (
          <div className="mt-5 flex flex-col gap-4">
            <div className="login-identity">
              <div className="login-identity-row">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="login-identity-avatar"
                  />
                ) : (
                  <span className="login-identity-initial" aria-hidden>
                    {(greetingName || rememberedEmail || "?")
                      .charAt(0)
                      .toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="login-identity-email">{rememberedEmail}</p>
                  <p className="login-identity-note">
                    {pinDevice && passkeyHere
                      ? "PIN or passkey — both work on this device"
                      : pinDevice
                        ? "Quick PIN is set up on this device"
                        : passkeyHere
                          ? "Passkey is set up on this device"
                          : "Sign in with your password"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="login-switch"
                onClick={onSwitchAccount}
              >
                Not you? Switch account
              </button>
            </div>

            {/*
              The passkey orb. A button, not an auto-prompt, and that is a hard
              constraint rather than a design choice: `navigator.credentials.
              get()` outside a user gesture is refused by every browser, so
              "defaults to the passkey" can only ever mean "the passkey is the
              thing in front of you, one tap away". Clicking it is the gesture.

              It is drawn only when this device actually holds a credential —
              see passkeyDeviceStore for why the browser, not the server, gets
              to answer that.
            */}
            {passkeyHere && (
              <div className="passkey-orb-wrap">
                <button
                  type="button"
                  className="passkey-orb"
                  onClick={onPasskey}
                  disabled={passkeyBusy || busy}
                  aria-label="Sign in with a passkey — Face ID, Touch ID, Windows Hello or a security key"
                >
                  <FingerprintIcon width={40} height={40} />
                </button>
                <p className="passkey-orb-hint">
                  {passkeyBusy
                    ? "Waiting for your device…"
                    : "Tap the fingerprint to sign in"}
                </p>
              </div>
            )}

            {(error || passkeyError) && (
              <div className="flex flex-col gap-2">
                {error && <p className="login-error">{error}</p>}
                {passkeyError && <p className="login-error">{passkeyError}</p>}
              </div>
            )}

            {pinDevice && (
              <form onSubmit={onPin} className="flex flex-col gap-3" noValidate>
                <div className="flex items-center justify-between">
                  <span className="login-label">Quick PIN</span>
                  <span className="text-[11px] text-white/35">
                    Device-bound • {PIN_LENGTH} digits
                  </span>
                </div>

                <PinInput
                  value={pin}
                  onChange={setPin}
                  onComplete={submitPin}
                  disabled={busy}
                  // The PIN is the fewest taps of anything on this screen, so it
                  // takes focus when it is offered. The orb above is still one
                  // Tab away for anyone who would rather use their finger.
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />

                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    className="login-keypad-toggle"
                    onClick={() => setShowKeypad((s) => !s)}
                  >
                    {showKeypad ? "Hide keypad" : "Show keypad"}
                  </button>
                </div>
                {showKeypad && (
                  <PinKeypad
                    disabled={busy}
                    onDigit={(d) =>
                      setPin((p) =>
                        (p + d).replace(/\D/g, "").slice(0, PIN_LENGTH),
                      )
                    }
                    onBackspace={() => setPin((p) => p.slice(0, -1))}
                  />
                )}

                <button
                  type="submit"
                  className="login-submit"
                  disabled={busy || pin.length !== PIN_LENGTH}
                >
                  {busy ? "Signing in…" : "Sign in with PIN"}
                  {!busy && <ArrowRightIcon width={16} height={16} />}
                </button>
              </form>
            )}

            {/*
              The password is the FALLBACK when a quick route exists, and the
              door when none does. Revealed rather than always visible: on a
              passkey device, an empty password box under the orb competes with
              the one action that is actually faster. Two sibling <form>s
              rather than one, so Enter in the password field signs in with the
              password and Enter in the PIN boxes uses the PIN — which is the
              behaviour each field's user expects.
            */}
            {!hasQuickRoute || passwordOpen ? (
              <form
                onSubmit={onCredentials}
                className="flex flex-col gap-4"
                noValidate
              >
                {passwordFields(false, false)}
              </form>
            ) : (
              <button
                type="button"
                className="login-fallback"
                onClick={() => setPasswordOpen(true)}
              >
                <KeyIcon width={15} height={15} /> Login with password
              </button>
            )}
          </div>
        )}

        {/* --- Segmented tabs — ONLY when this device has no stored account --- */}
        {stage === "credentials" && !remembered && (
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

        {/* --- Password tab (no stored account) --- */}
        {stage === "credentials" && !remembered && tab === "password" && (
          <form
            onSubmit={onCredentials}
            className="mt-5 flex flex-col gap-4"
            noValidate
          >
            {passwordFields(true, true)}
          </form>
        )}

        {/* --- Quick PIN tab (no stored account) --- */}
        {stage === "credentials" && !remembered && tab === "pin" && (
          <form
            onSubmit={onPin}
            className="mt-5 flex flex-col gap-4"
            noValidate
          >
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
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="login-label">Quick PIN</span>
                <span className="text-[11px] text-white/35">
                  Device-bound • {PIN_LENGTH} digits
                </span>
              </div>

              <PinInput
                value={pin}
                onChange={setPin}
                onComplete={submitPin}
                disabled={busy}
              />

              {/* Numeric keypad — collapsible for touch */}
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  className="login-keypad-toggle"
                  onClick={() => setShowKeypad((s) => !s)}
                >
                  {showKeypad ? "Hide keypad" : "Show keypad"}
                </button>
              </div>
              {showKeypad && (
                <PinKeypad
                  disabled={busy}
                  onDigit={(d) =>
                    setPin((p) =>
                      (p + d).replace(/\D/g, "").slice(0, PIN_LENGTH),
                    )
                  }
                  onBackspace={() => setPin((p) => p.slice(0, -1))}
                />
              )}
            </div>

            {error && <p className="login-error">{error}</p>}
            {passkeyError && (
              <p className="login-error text-center">{passkeyError}</p>
            )}

            <button
              type="submit"
              className="login-submit"
              disabled={busy || pin.length !== PIN_LENGTH}
            >
              {busy ? "Signing in…" : "Sign in with PIN"}
              {!busy && <ArrowRightIcon width={16} height={16} />}
            </button>
            <p className="login-note">
              PIN works only on a device where you enabled it. New device? Use
              your password.
            </p>

            <div className="relative my-1 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-[11px] tracking-widest text-white/35">
                OR
              </span>
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

        {/* --- Post-sign-in passkey offer --- */}
        {stage === "offer-passkey" && (
          <div className="mt-6 flex flex-col gap-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.06]">
                <FingerprintIcon width={22} height={22} />
              </span>
              <p className="login-note">
                You're signed in. Add a passkey and next time this device signs you in with
                {" "}<strong>Face ID, Touch ID, Windows Hello or your security key</strong> — no password, no PIN.
              </p>
              <p className="text-[11px] leading-relaxed text-white/40">
                The key stays on this device and your fingerprint never leaves it. Nothing to type, so nothing to phish.
              </p>
            </div>

            {offerError && <p className="login-error text-center">{offerError}</p>}

            <button type="button" className="login-submit" onClick={onAddPasskeyNow} disabled={offerBusy}>
              {offerBusy ? "Waiting for your device…" : "Add a passkey"}
            </button>
            <button
              type="button"
              onClick={onSkipPasskey}
              disabled={offerBusy}
              className="text-[12px] text-white/45 underline-offset-4 transition hover:text-white/70 hover:underline disabled:opacity-50"
            >
              Not now — add one later under {PASSKEY_SETTING_PATH}
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
