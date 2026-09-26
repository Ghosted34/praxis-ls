/**
 * The sign-in panel — every way in, in the owner's order, used by BOTH doors:
 *
 *   · the landing page's sign-in modal (`mode="signin"`, login-modal.tsx), and
 *   · the lock screen (`mode="unlock"`, lock-screen.tsx), which appears over the
 *     blurred app when the session ends.
 *
 * One panel, so the two can never disagree about which credential leads, what
 * an error means, or when a passkey is offered.
 *
 * ── WHICH CREDENTIAL LEADS ──────────────────────────────────────────────────
 *
 * The device remembers whose it is (`lastSessionStore`) and which quick
 * credentials it holds for them. The screen greets that person and leads with
 * the best route THIS DEVICE can complete:
 *
 *     1. a passkey that lives here   → the fingerprint orb, and the ceremony
 *                                      starts by itself when the window has
 *                                      focus (a browser that insists on a tap
 *                                      first just leaves the orb waiting)
 *     2. a Quick PIN set up here     → the four PIN boxes
 *     3. neither                     → the password
 *
 * The others stay one tap away underneath ("Use PIN", "Use password"), because
 * a credential can be revoked from another session and the person at the
 * machine must always have a way in.
 *
 * A passkey leads because it is the one credential that is two factors at once
 * (the device, and the fingerprint/face that unlocks it), cannot be phished,
 * and costs a single touch.
 *
 * ── THE PASSKEY OFFER ───────────────────────────────────────────────────────
 *
 * After a PIN or password sign-in on a device that could hold a passkey but
 * does not, the panel offers one on the spot — the only moment the person is
 * both freshly authenticated (enrolment requires it) and thinking about
 * signing in. "Not now" snoozes it for a week on this device.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { useAuth } from "@/app/auth/auth-context";
import { useBranding } from "@/app/branding/branding-context";
import { ApiError, NETWORK_DOWN, tenant } from "@/lib/api-client";
import { OtpInput } from "@/components/ui/otp-input";
import { PIN_LENGTH, PinInput, PinKeypad } from "@/components/ui/pin-input";
import { lastSessionStore } from "@/lib/last-session";
import { passkeyDeviceStore } from "@/lib/passkey-devices";
import { passkeyOfferStore } from "@/lib/passkey-offer";
import { pinStore } from "@/lib/pin-store";
import {
  biometricName,
  deviceLabel,
  isPasskeyCancel,
  isPasskeySupported,
  platformAuthenticatorAvailable,
  registerPasskey,
} from "@/lib/webauthn";
import { cn } from "@/lib/cn";
import { PASSKEY_SETTING_PATH } from "@/features/security/passkey-nudge";
import {
  MailIcon,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  KeyIcon,
  HashIcon,
  CheckIcon,
} from "@/components/ui/icons";

export type SignInMode = "signin" | "unlock";
type Stage = "credentials" | "twofa" | "forgot" | "forgot-sent" | "offer-passkey";
type Route = "passkey" | "pin" | "password";
type Identity = { email: string; display_name?: string | null; avatar_url?: string | null };

export function FingerprintIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      width={16}
      height={16}
      {...props}
    >
      <path d="M5.1 9.2A7.6 7.6 0 0 1 18.9 9" />
      <path d="M4.4 13.6c.3-.8.5-1.7.5-2.6" />
      <path d="M19.4 12.4c0 2.5-.4 4.8-1.2 6.8" />
      <path d="M7.4 18.6c.8-1.6 1.2-3.4 1.2-5.3v-1.6a3.4 3.4 0 0 1 6.8 0v1.1" />
      <path d="M15.3 16.1c-.2 1.9-.8 3.7-1.7 5.3" />
      <path d="M11.9 11.7v1.8c0 2.9-.8 5.6-2.2 7.9" />
      <path d="M5.6 16.9c-.3.7-.6 1.3-1 1.9" />
      <path d="M17.1 6.3A7.9 7.9 0 0 0 12 4.4c-1.7 0-3.3.6-4.6 1.5" />
    </svg>
  );
}

function friendly(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "INVALID_CREDENTIALS":
        return "That email or password doesn't match. Try again.";
      case "USER_INACTIVE":
        return "This account is suspended. Contact your administrator.";
      case "INVALID_2FA_CODE":
        return "That code isn't right. Check your authenticator and retry.";
      case NETWORK_DOWN:
      case "ERROR":
        return "Can't reach the server. Check your connection and try again.";
      case "RATE_LIMITED":
        return "Too many attempts from this network. Wait a few minutes, then try again.";
      case "NO_PIN_DEVICE":
        return "No Quick PIN is set up on this device for that email. Sign in with your password, then set one up in My security.";
      case "PIN_LOGIN_UNAVAILABLE":
        return "Quick PIN is no longer available on this device. Sign in with your password.";
      case "WEBAUTHN_NOT_SUPPORTED":
        return "Passkeys aren't supported on this browser yet.";
      default:
        return err.message || "Something went wrong. Please try again.";
    }
  }
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "WEBAUTHN_NOT_SUPPORTED") return "Passkeys aren't supported on this browser yet.";
  if (e?.code === "PASSKEY_INSECURE_CONTEXT") return e.message || "Passkeys need a secure connection.";
  if (e?.message) return e.message;
  return "Something went wrong. Please try again.";
}

export function SignInPanel({
  mode,
  identity,
  onDone,
  onSwitchAccount,
  reason,
  titleId,
  autoPrompt = true,
}: {
  mode: SignInMode;
  /** unlock: whose screen this is. signin: omitted — the device's remembered identity. */
  identity?: Identity | null;
  /** Signed in (or unlocked), including any passkey offer that followed. */
  onDone: () => void;
  /** unlock: "Not you?" — the host drops everything and reloads. */
  onSwitchAccount?: () => void;
  /** unlock: one line on why the screen locked. */
  reason?: string | null;
  /** id for the heading, so the host dialog can be labelled by it. */
  titleId?: string;
  /** Start the passkey ceremony by itself when the window has focus. */
  autoPrompt?: boolean;
}) {
  const { login, verify2fa, pinLogin, passkeyLogin } = useAuth();
  const { branding } = useBranding();
  const brandName = branding.name || "Praxis LS";

  const [remembered, setRemembered] = React.useState<Identity | null>(
    () => identity ?? lastSessionStore.get(),
  );
  const rememberedEmail = remembered?.email?.trim().toLowerCase() ?? "";
  const [stage, setStage] = React.useState<Stage>("credentials");
  const [email, setEmail] = React.useState(rememberedEmail);
  /** Tabs exist only for the device that knows nobody. */
  const [tab, setTab] = React.useState<"password" | "pin">("password");

  /**
   * Store reads are not reactive. The events that change them here — a PIN
   * locked out, a passkey the server no longer knows — bump this to re-read in
   * the same commit, so the screen stops offering a route the user just
   * watched fail.
   */
  const [registryVersion, bumpRegistry] = React.useReducer((n: number) => n + 1, 0);
  const pinDevice = React.useMemo(
    () => (rememberedEmail ? pinStore.get(rememberedEmail) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registryVersion invalidates a localStorage read React cannot track.
    [rememberedEmail, registryVersion],
  );
  const passkeyHere = React.useMemo(
    () => isPasskeySupported() && !!rememberedEmail && passkeyDeviceStore.get(rememberedEmail),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above.
    [rememberedEmail, registryVersion],
  );
  const defaultRoute: Route = passkeyHere ? "passkey" : pinDevice ? "pin" : "password";
  const [routeChoice, setRouteChoice] = React.useState<Route | null>(null);
  const routeAvailable = (r: Route) =>
    r === "password" || (r === "pin" && !!pinDevice) || (r === "passkey" && passkeyHere);
  const route: Route = routeChoice && routeAvailable(routeChoice) ? routeChoice : defaultRoute;

  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [showKeypad, setShowKeypad] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = React.useState(false);
  const [signedInEmail, setSignedInEmail] = React.useState<string>("");
  const [offerBusy, setOfferBusy] = React.useState(false);
  const [offerMsg, setOfferMsg] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [discoverable, setDiscoverable] = React.useState<boolean>(() => isPasskeySupported());

  const emailRef = React.useRef<HTMLInputElement>(null);
  const pinEmailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const orbRef = React.useRef<HTMLButtonElement>(null);

  // A passkey button on a device with no authenticator of its own would only
  // ever offer a phone's QR code; show it where it can complete here.
  React.useEffect(() => {
    let alive = true;
    void platformAuthenticatorAvailable().then((ok) => alive && setDiscoverable(ok));
    return () => {
      alive = false;
    };
  }, []);

  // Focus: the field the current route needs. The PIN boxes focus themselves.
  React.useEffect(() => {
    if (stage !== "credentials") return;
    if (!remembered) {
      if (tab === "password") emailRef.current?.focus();
      else pinEmailRef.current?.focus();
      return;
    }
    if (route === "password") passwordRef.current?.focus();
    else if (route === "passkey") orbRef.current?.focus();
  }, [tab, stage, remembered, route]);

  function clearErrors() {
    setError(null);
  }

  function chooseRoute(r: Route) {
    clearErrors();
    setPin("");
    setRouteChoice(r);
  }

  // ── After any successful sign-in ─────────────────────────────────────────
  async function afterSignIn(who: string, method: "passkey" | "pin" | "password") {
    const signed = (lastSessionStore.get()?.email || who).trim().toLowerCase();
    setSignedInEmail(signed);
    if (method !== "passkey" && signed && !passkeyDeviceStore.get(signed) && !passkeyOfferStore.declined(signed)) {
      const can = await platformAuthenticatorAvailable();
      if (can) {
        setStage("offer-passkey");
        return;
      }
    }
    onDone();
  }

  // ── Password ─────────────────────────────────────────────────────────────
  async function onCredentials(e: React.FormEvent) {
    e.preventDefault();
    const target = (remembered ? rememberedEmail : email).trim();
    if (!target || !password) return;
    setBusy(true);
    clearErrors();
    try {
      const { pending2fa } = await login(target, password);
      if (pending2fa) setStage("twofa");
      else {
        setRemembered(lastSessionStore.get() ?? remembered);
        await afterSignIn(target, "password");
      }
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value: string) {
    setBusy(true);
    clearErrors();
    try {
      await verify2fa(value.trim());
      await afterSignIn(rememberedEmail || email.trim(), "password");
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
    clearErrors();
    try {
      await tenant("/auth/forgot-password", {
        method: "POST",
        body: { email: (email || rememberedEmail).trim() },
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
   * "Not you? Switch account". On the lock screen the host drops everything
   * and reloads — the previous person's work is in memory behind the blur. On
   * the landing modal the device releases the remembered identity (credentials
   * keyed by email survive; "Sign out and remove this account" destroys them)
   * and hands over an empty, focused email field.
   */
  function onSwitch() {
    if (mode === "unlock") {
      onSwitchAccount?.();
      return;
    }
    lastSessionStore.clear();
    setRemembered(null);
    setEmail("");
    setPassword("");
    setPin("");
    setRouteChoice(null);
    clearErrors();
    setTab("password");
  }

  // ── Quick PIN ────────────────────────────────────────────────────────────
  async function onPin(e?: React.FormEvent) {
    e?.preventDefault();
    return submitPin(pin);
  }

  /**
   * Takes the digits as an ARGUMENT: `PinInput` fires onChange and onComplete in
   * the same tick, so state still holds the previous render's three digits when
   * completion fires. Reading state here is how the fourth-digit auto-submit
   * once answered "PIN must be 4 digits." with four digits on screen.
   */
  async function submitPin(entered: string) {
    const target = (remembered ? rememberedEmail : email).trim();
    if (!target) {
      setError("Enter your email first.");
      return;
    }
    if (entered.length !== PIN_LENGTH) {
      setError(`PIN must be ${PIN_LENGTH} digits.`);
      return;
    }
    setBusy(true);
    clearErrors();
    try {
      await pinLogin(target, entered);
      setRemembered(lastSessionStore.get() ?? remembered);
      await afterSignIn(target, "pin");
    } catch (err) {
      setPin("");
      if (err instanceof ApiError && (err.code === "PIN_LOCKED" || err.code === "PIN_LOGIN_UNAVAILABLE")) {
        // auth-context has removed this device's PIN record; re-read so the
        // screen moves to the password instead of offering dead boxes.
        bumpRegistry();
        setRouteChoice("password");
      }
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  // ── Passkey ──────────────────────────────────────────────────────────────
  async function onPasskey(auto = false) {
    if (passkeyBusy || busy) return;
    setPasskeyBusy(true);
    if (!auto) clearErrors();
    try {
      // Scoped to the person this screen is for: their credentials on this
      // device, and a ceremony nobody else's passkey can answer.
      await passkeyLogin(rememberedEmail || undefined);
      setRemembered(lastSessionStore.get() ?? remembered);
      await afterSignIn(rememberedEmail, "passkey");
    } catch (err) {
      if (isPasskeyCancel(err)) {
        // Dismissed, timed out, or the browser wanted a tap first. Not a fact
        // about the credential: the orb stays, quietly.
        return;
      }
      if (err instanceof ApiError && err.code === "PASSKEY_REVOKED") bumpRegistry();
      setError(friendly(err));
    } finally {
      setPasskeyBusy(false);
    }
  }

  /**
   * The passkey starts by itself — "the primary means of connection" — when the
   * window has focus, once per visit to the tab. Leaving the tab and coming
   * back asks again, which is exactly the moment someone returns to a locked
   * screen. A browser that insists on a tap first (Safari) refuses quietly and
   * the orb waits for one.
   */
  const onPasskeyRef = React.useRef(onPasskey);
  onPasskeyRef.current = onPasskey;
  const passkeyBusyRef = React.useRef(passkeyBusy);
  passkeyBusyRef.current = passkeyBusy;
  React.useEffect(() => {
    if (!autoPrompt || stage !== "credentials" || route !== "passkey") return;
    let tried = false;
    const attempt = () => {
      if (tried || document.visibilityState !== "visible" || !document.hasFocus()) return;
      tried = true;
      void onPasskeyRef.current(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") tried = false;
      else attempt();
    };
    // The OS sheet takes focus while the ceremony runs; only a blur while NOT
    // busy is the person leaving.
    const onBlur = () => {
      if (!passkeyBusyRef.current) tried = false;
    };
    const t = window.setTimeout(attempt, 300);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", attempt);
    window.addEventListener("blur", onBlur);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", attempt);
      window.removeEventListener("blur", onBlur);
    };
  }, [autoPrompt, stage, route]);

  // ── The passkey offer ────────────────────────────────────────────────────
  async function onAddPasskeyNow() {
    setOfferBusy(true);
    setOfferMsg(null);
    try {
      await registerPasskey({ email: signedInEmail, label: deviceLabel() });
      setOfferMsg({ kind: "ok", text: `Done. Next time, ${biometricName()} is all it takes.` });
      window.setTimeout(onDone, 900);
    } catch (err) {
      const e = err as { code?: string } | null;
      if (e?.code === "PASSKEY_ALREADY_ON_DEVICE") {
        setOfferMsg({ kind: "ok", text: "This device already has a passkey for your account — you're all set." });
        window.setTimeout(onDone, 1200);
      } else if (isPasskeyCancel(err)) {
        setOfferMsg({ kind: "err", text: `Setup was cancelled. You can add one any time under ${PASSKEY_SETTING_PATH}.` });
      } else {
        setOfferMsg({ kind: "err", text: friendly(err) });
      }
    } finally {
      setOfferBusy(false);
    }
  }

  function onSkipPasskey() {
    if (signedInEmail) passkeyOfferStore.decline(signedInEmail);
    onDone();
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const avatarUrl = remembered?.avatar_url || null;
  /** The greeting names the account it is about to unlock — never "there". */
  const fullName = remembered?.display_name || rememberedEmail.split("@")[0] || "";
  const firstName = fullName.trim().split(/\s+/)[0] || fullName;
  const bio = biometricName();

  const title =
    stage === "offer-passkey"
      ? "One touch next time"
      : stage === "twofa"
        ? "Two-step verification"
        : stage === "forgot" || stage === "forgot-sent"
          ? "Reset your password"
          : remembered
            ? `Welcome back, ${firstName}`
            : "Welcome back";

  const sub =
    stage === "twofa"
      ? "Enter the 6-digit code from your authenticator app."
      : stage === "forgot"
        ? "We'll email you a link to choose a new password."
        : stage === "forgot-sent"
          ? "Check your inbox."
          : stage === "offer-passkey"
            ? `You're in. Make ${bio} your key to ${brandName} on this device.`
            : mode === "unlock"
              ? reason || "Your session is locked. Sign in to pick up where you left off."
              : remembered
                ? "This device is set up for you."
                : "Sign in to your command center.";

  const alternatives: { key: Route; label: string; icon: React.ReactNode }[] = [];
  if (passkeyHere && route !== "passkey")
    alternatives.push({
      key: "passkey",
      label: `Use ${bio === "your passkey" ? "passkey" : bio}`,
      icon: <FingerprintIcon width={14} height={14} />,
    });
  if (pinDevice && route !== "pin")
    alternatives.push({ key: "pin", label: "Use PIN", icon: <HashIcon width={14} height={14} /> });
  if (route !== "password")
    alternatives.push({ key: "password", label: "Use password", icon: <KeyIcon width={14} height={14} /> });

  function passwordFields(withEmail: boolean) {
    return (
      <>
        {withEmail && (
          <div className="flex flex-col gap-1.5">
            <label className="login-label" htmlFor={`lm-email-${mode}`}>
              Email
            </label>
            <div className="login-field">
              <MailIcon width={17} height={17} />
              <input
                ref={emailRef}
                id={`lm-email-${mode}`}
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
          </div>
        )}
        {!withEmail && (
          // Gives password managers the account to fill against — there is no
          // visible email field on a device that already knows the account.
          <input type="hidden" name="username" autoComplete="username" value={rememberedEmail} readOnly />
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="login-label" htmlFor={`lm-pw-${mode}`}>
              Password
            </label>
            <button
              type="button"
              className="login-link text-[0.74rem]"
              onClick={() => {
                clearErrors();
                setStage("forgot");
              }}
            >
              Forgot password?
            </button>
          </div>
          <div className="login-field">
            <LockIcon width={17} height={17} />
            <input
              ref={passwordRef}
              id={`lm-pw-${mode}`}
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

        <button
          type="submit"
          className="login-submit"
          disabled={busy || !(withEmail ? email.trim() : rememberedEmail) || !password}
        >
          {busy ? "Signing in…" : mode === "unlock" ? "Unlock" : "Sign in"}
          {!busy && <ArrowRightIcon width={16} height={16} />}
        </button>
      </>
    );
  }

  function pinBlock(autoFocus: boolean) {
    return (
      <form onSubmit={onPin} className="flex flex-col gap-3" noValidate>
        <div className="flex items-center justify-between">
          <span className="login-label">Quick PIN</span>
          <span className="login-hint">This device only · {PIN_LENGTH} digits</span>
        </div>
        <PinInput
          value={pin}
          onChange={setPin}
          onComplete={submitPin}
          disabled={busy}
          // The PIN takes focus when it is the route offered: it is what the
          // person came here to type.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
        />
        <div className="flex items-center justify-center">
          <button type="button" className="login-keypad-toggle" onClick={() => setShowKeypad((s) => !s)}>
            {showKeypad ? "Hide keypad" : "Show keypad"}
          </button>
        </div>
        {showKeypad && (
          <PinKeypad
            disabled={busy}
            onDigit={(d) => setPin((p) => (p + d).replace(/\D/g, "").slice(0, PIN_LENGTH))}
            onBackspace={() => setPin((p) => p.slice(0, -1))}
          />
        )}
        <button type="submit" className="login-submit" disabled={busy || pin.length !== PIN_LENGTH}>
          {busy ? "Signing in…" : mode === "unlock" ? "Unlock with PIN" : "Sign in with PIN"}
          {!busy && <ArrowRightIcon width={16} height={16} />}
        </button>
      </form>
    );
  }

  return (
    <div className="login-panel" data-mode={mode}>
      {/* The lock screen carries the brand above the card already. */}
      {mode === "signin" && <p className="login-card-kicker">{brandName}</p>}
      <h2 id={titleId} className="login-card-title">
        {title}
      </h2>
      <p className="login-card-sub">{sub}</p>

      {/* ── IDENTITY-FIRST: the device knows whose it is ─────────────────── */}
      {stage === "credentials" && remembered && (
        <div className="mt-5 flex flex-col gap-4">
          <div className="login-identity">
            <div className="login-identity-row">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="login-identity-avatar" />
              ) : (
                <span className="login-identity-initial" aria-hidden>
                  {(fullName || rememberedEmail || "?").charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="login-identity-name">{fullName}</p>
                <p className="login-identity-email">{rememberedEmail}</p>
              </div>
              <button type="button" className="login-switch" onClick={onSwitch} aria-label="Not you? Switch account">
                Not you?
              </button>
            </div>
          </div>

          {route === "passkey" && (
            <div className="passkey-orb-wrap">
              <button
                ref={orbRef}
                type="button"
                className="passkey-orb"
                data-busy={passkeyBusy || undefined}
                onClick={() => void onPasskey(false)}
                disabled={busy}
                aria-label={`${mode === "unlock" ? "Unlock" : "Sign in"} with your passkey — ${bio}`}
              >
                <span className="login-orb-ring" data-active={passkeyBusy || undefined} aria-hidden />
                <FingerprintIcon width={46} height={46} />
              </button>
              <p className="passkey-orb-title">
                {passkeyBusy ? "Waiting for your device…" : `${mode === "unlock" ? "Unlock" : "Sign in"} with ${bio}`}
              </p>
              <p className="passkey-orb-hint">
                {passkeyBusy
                  ? `Confirm with ${bio} to continue.`
                  : "Tap the fingerprint. It never leaves this device."}
              </p>
            </div>
          )}

          {route === "pin" && pinBlock(true)}

          {route === "password" && (
            <form onSubmit={onCredentials} className="flex flex-col gap-4" noValidate>
              {passwordFields(false)}
            </form>
          )}

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          {alternatives.length > 0 && (
            <div className="login-alt" role="group" aria-label="Other ways to sign in">
              <span className="login-alt-rule" aria-hidden>
                <span>or</span>
              </span>
              <div className="login-alt-row">
                {alternatives.map((a) => (
                  <button key={a.key} type="button" className="login-alt-btn" onClick={() => chooseRoute(a.key)} disabled={busy || passkeyBusy}>
                    {a.icon}
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── A device that knows nobody: tabs, and a discoverable passkey ─── */}
      {stage === "credentials" && !remembered && (
        <>
          <div className="seg mt-5">
            <button
              type="button"
              className="seg-tab"
              data-active={tab === "password"}
              onClick={() => {
                setTab("password");
                clearErrors();
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
                clearErrors();
              }}
            >
              <HashIcon width={15} height={15} /> Quick PIN
            </button>
          </div>

          {tab === "password" && (
            <form onSubmit={onCredentials} className="mt-5 flex flex-col gap-4" noValidate>
              {passwordFields(true)}
            </form>
          )}

          {tab === "pin" && (
            <div className="mt-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="login-label" htmlFor={`lm-pin-email-${mode}`}>
                  Email
                </label>
                <div className="login-field">
                  <MailIcon width={17} height={17} />
                  <input
                    ref={pinEmailRef}
                    id={`lm-pin-email-${mode}`}
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </div>
              </div>
              {pinBlock(false)}
              <p className="login-note">A Quick PIN works only on the device where you set it up. New device? Use your password.</p>
            </div>
          )}

          {error && (
            <p className="login-error mt-4" role="alert">
              {error}
            </p>
          )}

          {discoverable && (
            <div className="login-alt mt-5">
              <span className="login-alt-rule" aria-hidden>
                <span>or</span>
              </span>
              <button
                type="button"
                onClick={() => void onPasskey(false)}
                disabled={passkeyBusy || busy}
                className="login-fallback"
              >
                <FingerprintIcon width={16} height={16} />
                {passkeyBusy ? "Waiting for your device…" : "Sign in with a passkey"}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Forgot password ─────────────────────────────────────────────── */}
      {stage === "forgot" && (
        <form onSubmit={onForgot} className="mt-5 flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <label className="login-label" htmlFor={`lm-forgot-email-${mode}`}>
              Email
            </label>
            <div className="login-field">
              <MailIcon width={17} height={17} />
              <input
                id={`lm-forgot-email-${mode}`}
                type="email"
                autoComplete="username"
                required
                // The stage replaced the field the user was typing in, so this
                // is focus RECOVERY, not an unsolicited grab.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={email || rememberedEmail}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
          </div>
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="login-submit" disabled={busy || !(email || rememberedEmail).trim()}>
            {busy ? "Sending…" : "Send reset link"}
            {!busy && <ArrowRightIcon width={16} height={16} />}
          </button>
          <button
            type="button"
            className="login-back"
            onClick={() => {
              setStage("credentials");
              clearErrors();
            }}
          >
            <ArrowLeftIcon width={14} height={14} /> Back
          </button>
        </form>
      )}

      {stage === "forgot-sent" && (
        <div className="mt-6 flex flex-col gap-5">
          <p className="login-note">
            If an account exists for <strong>{(email || rememberedEmail).trim()}</strong>, a reset link is on its way. It expires in
            30 minutes — check your spam folder too.
          </p>
          <button
            type="button"
            className="login-submit"
            onClick={() => {
              setStage("credentials");
              clearErrors();
            }}
          >
            Back to sign in
          </button>
        </div>
      )}

      {/* ── The passkey offer ───────────────────────────────────────────── */}
      {stage === "offer-passkey" && (
        <div className="mt-6 flex flex-col gap-5">
          <div className="login-offer">
            <span className="login-offer-glyph" aria-hidden>
              <FingerprintIcon width={30} height={30} />
            </span>
            <ul className="login-offer-points">
              <li>
                <CheckIcon width={14} height={14} /> {mode === "unlock" ? "Unlock" : "Sign in"} with one touch — no password, no PIN
              </li>
              <li>
                <CheckIcon width={14} height={14} /> Belongs to this device only; your fingerprint never leaves it
              </li>
              <li>
                <CheckIcon width={14} height={14} /> Can't be phished, guessed or reused
              </li>
            </ul>
          </div>

          {offerMsg && (
            <p className={cn(offerMsg.kind === "ok" ? "login-success" : "login-error", "text-center")} role="status">
              {offerMsg.text}
            </p>
          )}

          <button type="button" className="login-submit" onClick={onAddPasskeyNow} disabled={offerBusy || offerMsg?.kind === "ok"}>
            <FingerprintIcon width={16} height={16} />
            {offerBusy ? "Waiting for your device…" : `Set up ${bio}`}
          </button>
          <button type="button" onClick={onSkipPasskey} disabled={offerBusy} className="login-back justify-center">
            Not now
          </button>
        </div>
      )}

      {/* ── 2FA ─────────────────────────────────────────────────────────── */}
      {stage === "twofa" && (
        <form onSubmit={(e) => e.preventDefault()} className="mt-6 flex flex-col gap-5" noValidate>
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={submitCode}
            // Focus RECOVERY: the field the user was typing in is gone.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            disabled={busy}
          />
          {error && (
            <p className="login-error text-center" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="login-submit" onClick={() => submitCode(code)} disabled={busy || code.length < 6}>
            {busy ? "Verifying…" : "Verify"}
          </button>
          <button
            type="button"
            className="login-back"
            onClick={() => {
              setStage("credentials");
              clearErrors();
              setCode("");
            }}
          >
            <ArrowLeftIcon width={14} height={14} /> {tr("Back")}
          </button>
        </form>
      )}
    </div>
  );
}
