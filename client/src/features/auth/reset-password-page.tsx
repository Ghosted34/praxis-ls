/**
 * Reset-password page — the landing point for the emailed one-time link
 * (/reset-password?token=…). Public route (the user is, by definition, locked
 * out). Posts to the public /auth/reset-password endpoint; the token is
 * validated and the full password policy (length/complexity + breach check) is
 * enforced server-side, so we surface those errors inline. On success the
 * backend has already force-logged-out every session, so we just send the user
 * to sign in with their new password.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, tenant } from "@/lib/api-client";
import { useBranding } from "@/app/branding/branding-context";
import {
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  ArrowRightIcon,
  CheckIcon,
} from "@/components/ui/icons";

const MIN_LENGTH = 12;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { branding } = useBranding();
  const brandName = branding.name || "Praxis LS";

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const meetsLength = password.length >= MIN_LENGTH;
  const matches = confirm.length > 0 && password === confirm;
  const canSubmit = !!token && meetsLength && matches && !busy;

  function friendly(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.code === "INVALID_RESET_TOKEN")
        return "This reset link is invalid or has expired. Request a new one from the sign-in screen.";
      if (err.code === "WEAK_PASSWORD" || err.code === "BREACHED_PASSWORD")
        return err.message;
      if (err.code === "RATE_LIMITED")
        return "Too many attempts. Please wait a few minutes and try again.";
      if (err.code === "ERROR")
        return "Can't reach the server. Check your connection.";
      return err.message;
    }
    return "Something went wrong. Please try again.";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await tenant("/auth/reset-password", {
        method: "POST",
        body: { token, new_password: password },
        auth: false,
        retry: false,
      });
      setDone(true);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-scrim" style={{ position: "fixed", inset: 0 }}>
      <div className="login-card">
        <p className="login-card-kicker">{brandName}</p>

        {!token ? (
          <>
            <h2 className="login-card-title">Reset link needed</h2>
            <p className="login-card-sub">
              This page opens from the link in your reset email.
            </p>
            <p className="login-note mt-5">
              We couldn't find a reset token in this link. Please open the most
              recent link from your email, or request a new one from the sign-in
              screen.
            </p>
            <button
              type="button"
              className="login-submit mt-5"
              onClick={() => navigate("/login")}
            >
              Back to sign in
            </button>
          </>
        ) : done ? (
          <>
            <h2 className="login-card-title">Password updated</h2>
            <p className="login-card-sub">You're all set</p>
            <p className="login-note mt-5">
              Your password has been changed and you've been signed out
              everywhere. Sign in with your new password to continue.
            </p>
            <button
              type="button"
              className="login-submit mt-5"
              onClick={() => navigate("/login")}
            >
              Go to sign in
              <ArrowRightIcon width={16} height={16} />
            </button>
          </>
        ) : (
          <>
            <h2 className="login-card-title">Choose a new password</h2>
            <p className="login-card-sub">
              At least {MIN_LENGTH} characters, with a mix of cases, a number
              and a symbol.
            </p>

            <form
              onSubmit={onSubmit}
              className="mt-5 flex flex-col gap-4"
              noValidate
            >
              <div className="flex flex-col gap-1.5">
                <label className="login-label" htmlFor="rp-pw">
                  New password
                </label>
                <div className="login-field">
                  <LockIcon width={17} height={17} />
                  <input
                    id="rp-pw"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
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

              <div className="flex flex-col gap-1.5">
                <label className="login-label" htmlFor="rp-confirm">
                  Confirm password
                </label>
                <div className="login-field">
                  <LockIcon width={17} height={17} />
                  <input
                    id="rp-confirm"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••••••"
                  />
                </div>
              </div>

              <ul
                className="flex flex-col gap-1"
                style={{ listStyle: "none", padding: 0, margin: 0 }}
              >
                <li
                  className="login-note"
                  data-ok={meetsLength}
                  style={{ opacity: meetsLength ? 1 : 0.55 }}
                >
                  {meetsLength ? <CheckIcon width={13} height={13} /> : "•"} At
                  least {MIN_LENGTH} characters
                </li>
                <li
                  className="login-note"
                  data-ok={matches}
                  style={{ opacity: matches ? 1 : 0.55 }}
                >
                  {matches ? <CheckIcon width={13} height={13} /> : "•"}{" "}
                  Passwords match
                </li>
              </ul>

              {error && <p className="login-error">{error}</p>}

              <button
                type="submit"
                className="login-submit"
                disabled={!canSubmit}
              >
                {busy ? "Updating…" : "Update password"}
                {!busy && <ArrowRightIcon width={16} height={16} />}
              </button>
              <button
                type="button"
                className="login-note"
                onClick={() => navigate("/login")}
              >
                ← Back to sign in
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
