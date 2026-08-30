/**
 * Client portal — sign-in and first-password set.
 *
 * Split out of `features/portal/portal-app.tsx` in Phase 4 (audit F7), then moved
 * here from the tenant app with three deliberate changes:
 *
 *   · The fields are this app's `Input` (labelled, error-aware) rather than a bare
 *     `<input>` with a hand-written label — one focus ring and one label rhythm for
 *     every form a stranger touches, including this one.
 *   · Every sentence is a dictionary key. The version in `client` had four
 *     hardcoded English strings on the password Set path ("Saving…", "Use at least
 *     8 characters."), which is a form that switches language for everything
 *     except the moment somebody is told they did something wrong.
 *   · Client-side validation says the SAME thing the endpoint will say, in the
 *     same words, before the submit — the password minimum here mirrors
 *     `auth.validator.js` rather than being a guess at it.
 *
 * What is kept, unchanged, is the privacy behaviour of the forgot-password flow:
 * the response is identical whether or not the address is registered, and this file
 * does not "improve" that with a smarter message.
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ErrorState } from "@/components/state";
import { enumText } from "@/lib/format";
import { tList } from "@/lib/i18n";
import {
  portalToken,
  portalLogin,
  portalForgot,
  portalAccept,
} from "@/lib/portal-api";
import { PortalFrame, msg } from "./portal-chrome";
import { p } from "@/lib/base-path";

export function PortalLogin() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await portalLogin(email.trim(), password);
      portalToken.set(r.access_token);
      nav("/portal", { replace: true });
    } catch (err) {
      setError(msg(err, t("portal.signInFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email.trim()) return setError(t("portal.needEmailFirst"));
    setBusy(true);
    setError(null);
    try {
      await portalForgot(email.trim());
      // Always the same message: the endpoint deliberately doesn't reveal whether
      // an address is registered, and the UI must not undo that.
      setSent(true);
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalFrame>
      <h1 className="font-display text-h2 font-semibold tracking-tight">
        {t("portal.signIn")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("portal.signInSub")}
      </p>

      {/* What is actually behind the form.
          This screen is one of the two a paying client opens every week, and it
          was a bare pair of inputs on white: no statement of what the account is
          for, no route onward for someone who has arrived without one. Three
          lines of plain fact, not decoration — a stranger who cannot sign in
          should still learn what they are looking at. */}
      <ul className="mt-5 space-y-2 border-l-2 border-border pl-4">
        {tList<string>("portal.signInPromise").map((line) => (
          <li key={line} className="text-sm text-muted-foreground">
            {line}
          </li>
        ))}
      </ul>

      {sent ? (
        <p className="mt-6 rounded-[calc(var(--radius)+4px)] border border-border bg-card p-4 text-sm text-muted-foreground">
          {t("portal.forgotSent")}
        </p>
      ) : null}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Input
          id="portal-email"
          type="email"
          label={t("portal.email")}
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          id="portal-password"
          type="password"
          label={t("portal.password")}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy} loading={busy}>
          {busy ? t("portal.signingIn") : t("portal.signIn")}
        </Button>
        <button
          type="button"
          onClick={forgot}
          className="w-full text-sm text-muted-foreground transition-colors hover:text-primary-ink"
        >
          {t("portal.forgotPassword")}
        </button>
      </form>

      {/* The two ways out. Someone who has an invitation but no password lands
          here first and had nowhere to go; someone with no account at all was
          left at a dead end on a page that only offered to sign them in. */}
      <div className="mt-8 border-t border-border pt-5 text-sm text-muted-foreground">
        <p>
          {t("portal.invited")}{" "}
          <Link
            to="/portal/set-password"
            className="text-primary-ink underline underline-offset-4"
          >
            {t("portal.setPasswordTitle")}
          </Link>
        </p>
        <p className="mt-2">
          <Link
            to={p("/track")}
            className="text-primary-ink underline underline-offset-4"
          >
            {t("portal.trackWithout")}
          </Link>
        </p>
      </div>
    </PortalFrame>
  );
}

/* ── set password (invite + reset land here) ────────────────────────────── */

/** The ONLY client-side rule on this form.
 *
 * `portal_auth.service.js:78` runs `assertStrongPassword` — 12 characters, upper,
 * lower, digit, symbol, not the local part of the applicant's email, not present in
 * a breach corpus (`src/shared/security/password-policy.js`). This form deliberately
 * does NOT re-implement that list. Every duplicate of a security policy is a
 * second policy: the day the server adds a rule and this one does not, the page
 * starts telling people their password is fine, and the endpoint then refuses it
 * for a reason the sentence on screen contradicts. The policy is stated in the
 * field's hint (so it is visible before the mistake) and enforced by the response
 * (which names exactly what is missing, in order).
 *
 * The confirm check stays, because it is not a policy — it is a typing mistake,
 * and catching it here is free. */
const PASSWORD_MIN = 12;

export function PortalSetPassword() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(t("portal.passwordMismatch"));
    setBusy(true);
    setError(null);
    try {
      const r = await portalAccept(token, password);
      // Signed straight in: they've just proved control of the mailbox, so
      // bouncing them to a login form to retype what they typed is friction for
      // no security gain.
      portalToken.set(r.access_token);
      nav("/portal", { replace: true });
    } catch (err) {
      setError(msg(err, t("portal.setPasswordFailed")));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <PortalFrame>
        <ErrorState message={t("portal.incompleteLink")} />
        <p className="mt-4 text-sm">
          <Link
            to="/portal/login"
            className="text-primary-ink underline underline-offset-4"
          >
            {t("portal.backToSignIn")}
          </Link>
        </p>
      </PortalFrame>
    );
  }

  return (
    <PortalFrame>
      <h1 className="font-display text-h2 font-semibold tracking-tight">
        {t("portal.setPasswordTitle")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("portal.oneTimeLink")}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Input
          id="pw"
          type="password"
          label={t("portal.newPassword")}
          hint={t("portal.passwordHint")}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          // The browser's own minimum is the one number we mirror: it is the part
          // a person can act on without knowing the rest of the policy.
          minLength={PASSWORD_MIN}
        />
        <Input
          id="pw2"
          type="password"
          label={t("portal.confirmPassword")}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy} loading={busy}>
          {busy ? t("portal.saving") : t("portal.setPasswordCta")}
        </Button>
      </form>
    </PortalFrame>
  );
}

/* ── shared label helper ────────────────────────────────────────────────── */

/**
 * An enum value as a display label.
 *
 * The `client` original hand-rolled this (underscore-stripping and a manual
 * uppercase), which is exactly the shape that leaves the French portal reading
 * "In review": sentence-casing is not translation. It now delegates to
 * `enumText`, which sentence-cases AND looks the result up in the dictionary —
 * and it keeps its name and its export because the terminals import it.
 */
export const label = (s: string) => enumText(s);
