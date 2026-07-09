/**
 * White-label login — the one screen built to final quality (client/README.md).
 * Pure white-label: tenant logo + colour tokens + the JBS Praxis footer, nothing
 * competing. The bar is craft, not surface area — leading field affordances,
 * password reveal, a segmented 2FA code step, smooth entrance, real loading /
 * error states, autofocus flow, correct on mobile, full dark mode.
 */
import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OtpInput } from "@/components/ui/otp-input";
import { MailIcon, LockIcon, EyeIcon, EyeOffIcon, ArrowRightIcon } from "@/components/ui/icons";
import { useBranding } from "@/app/branding/branding-context";
import { bootSignal } from "@/lib/boot-signal";

type Stage = "credentials" | "twofa";

export function LoginPage() {
  const { login, verify2fa } = useAuth();
  const { branding } = useBranding();
  const brandName = branding.name || "Praxis LS";
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";

  const [stage, setStage] = React.useState<Stage>("credentials");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);

  // Focus the email only once the boot splash is gone — focusing it underneath
  // the splash pops the browser's autofill dropdown over the loading screen.
  React.useEffect(() => bootSignal.onDone(() => emailRef.current?.focus()), []);

  function friendly(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.code === "INVALID_CREDENTIALS") return "That email or password doesn't match. Try again.";
      if (err.code === "USER_INACTIVE") return "This account is suspended. Contact your administrator.";
      if (err.code === "INVALID_2FA_CODE") return "That code isn't right. Check your authenticator and retry.";
      if (err.code === "ERROR") return "Can't reach the server. Check your connection.";
      return err.message;
    }
    return "Something went wrong. Please try again.";
  }

  async function onCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { pending2fa } = await login(email.trim(), password);
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

  return (
    <div className="login-backdrop flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={brandName} className="h-12 w-auto" />
          ) : (
            <div
              className="flex items-center justify-center rounded-2xl bg-primary text-xl font-semibold text-primary-foreground"
              style={{ height: 52, width: 52, boxShadow: "0 0 0 6px var(--accent), 0 0 32px -6px var(--primary)" }}
            >
              {brandName.charAt(0)}
            </div>
          )}
          <h1 className="mt-4 text-xl font-semibold tracking-tight">{brandName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stage === "credentials" ? "Sign in to your workspace" : "Two-factor authentication"}
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          {stage === "credentials" ? (
            <form onSubmit={onCredentials} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <MailIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={emailRef}
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.cm"
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <LockIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="px-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPw ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" loading={busy} className="mt-1 h-11 w-full">
                {busy ? "Signing in…" : "Sign in"}
                {!busy && <ArrowRightIcon />}
              </Button>
            </form>
          ) : (
            <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-5" noValidate>
              <p className="text-center text-sm text-muted-foreground">
                Enter the 6-digit code from your authenticator app.
              </p>

              <OtpInput value={code} onChange={setCode} onComplete={submitCode} autoFocus disabled={busy} />

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-center text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="button" loading={busy} className="h-11 w-full" onClick={() => submitCode(code)} disabled={code.length < 6}>
                {busy ? "Verifying…" : "Verify"}
              </Button>
              <button
                type="button"
                className="text-center text-sm text-muted-foreground hover:text-foreground"
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

        <p className="mt-8 text-center text-xs text-muted-foreground">Powered by JBS Praxis LLC</p>
      </div>
    </div>
  );
}
