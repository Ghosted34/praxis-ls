/**
 * The page an invitation (or a reset) email opens: choose a password, and be
 * signed straight in.
 *
 * The checklist mirrors `src/shared/security/password-policy.js` — twelve
 * characters, upper, lower, digit, symbol — so nobody types a password the
 * server will refuse. The server still decides (it also rejects the email's
 * name and breached passwords); this only saves the round trip.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { portalAccept, portalMe } from "@/lib/portal-api";
import { portalSession } from "@/lib/portal-session";
import { firstNameOf } from "../lib/portal-context";
import { SignInFrame } from "./sign-in";
import { PasswordField, Switch, errorText, Busy } from "../ui/kit";
import { CheckIcon, AlertIcon } from "../ui/icons";

const RULES: [string, (p: string) => boolean][] = [
  ["portal.setPassword.rule.length", (p) => p.length >= 12],
  ["portal.setPassword.rule.upper", (p) => /[A-Z]/.test(p)],
  ["portal.setPassword.rule.lower", (p) => /[a-z]/.test(p)],
  ["portal.setPassword.rule.digit", (p) => /\d/.test(p)],
  ["portal.setPassword.rule.symbol", (p) => /[^A-Za-z0-9]/.test(p)],
];

export function SetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [trust, setTrust] = React.useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches,
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const passes = RULES.map(([, ok]) => ok(password));
  const ready = passes.every(Boolean) && password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const tokens = await portalAccept(token, password, trust);
      portalSession.store(tokens);
      if (trust) {
        let company: string | null = null;
        try {
          company = (await portalMe()).company?.name || null;
        } catch {
          /* class D, best-effort — the greeting can wait */
        }
        portalSession.remember({ email: tokens.portal_user.email, firstName: firstNameOf(tokens.portal_user.full_name), company });
      }
      navigate("/portal", { replace: true, state: { justSignedIn: true, trusted: trust, firstVisit: true } });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <SignInFrame>
        <span className="pt-icon-disc" data-tone="warn" style={{ width: 60, height: 60, borderRadius: 20 }}>
          <AlertIcon size={26} />
        </span>
        <h1 className="pt-display mt-4 text-[1.7rem]">{t("portal.setPassword.badLinkTitle")}</h1>
        <p className="mt-2 text-[0.95rem] text-muted-foreground">{t("portal.setPassword.badLink")}</p>
        <button type="button" className="pt-btn pt-btn-soft pt-btn-block mt-6" onClick={() => navigate("/portal/login")}>
          {t("portal.signin.back")}
        </button>
      </SignInFrame>
    );
  }

  return (
    <SignInFrame>
      <form onSubmit={(e) => void submit(e)}>
        <h1 className="pt-display text-[1.9rem]">{t("portal.setPassword.title")}</h1>
        <p className="mt-1 text-[0.95rem] text-muted-foreground">{t("portal.setPassword.sub")}</p>
        <div className="mt-6 grid gap-4">
          <PasswordField label={t("portal.setPassword.new")} value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5" aria-live="polite">
            {RULES.map(([key], i) => (
              <li key={key} className={passes[i] ? "flex items-center gap-1.5 text-xs font-semibold text-[rgb(var(--ok))]" : "flex items-center gap-1.5 text-xs text-muted-foreground"}>
                <CheckIcon size={14} className={passes[i] ? "" : "opacity-40"} />
                {t(key)}
              </li>
            ))}
          </ul>
          <PasswordField
            label={t("portal.setPassword.confirm")}
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            invalid={!!confirm && confirm !== password}
          />
        </div>
        {confirm && confirm !== password ? <p className="mt-2 text-sm text-[rgb(var(--bad))]">{t("portal.setPassword.mismatch")}</p> : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-[rgb(var(--bad))]">
            {error}
          </p>
        ) : null}
        <button type="submit" className="pt-btn pt-btn-primary pt-btn-block mt-6" disabled={!ready || busy}>
          <Busy busy={busy} />
          {t("portal.setPassword.cta")}
        </button>
        <div className="mt-6 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("portal.signin.keep")}</p>
            <p className="text-xs text-muted-foreground">{t("portal.signin.keepHint")}</p>
          </div>
          <Switch checked={trust} onChange={setTrust} label={t("portal.signin.keep")} />
        </div>
      </form>
    </SignInFrame>
  );
}
