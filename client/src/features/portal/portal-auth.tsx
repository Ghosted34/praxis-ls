/**
 * Client portal — sign-in and first-password set.
 *
 * Split out of `features/portal/portal-app.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/states";
import { portalToken, portalLogin, portalForgot, portalAccept } from "@/lib/portal-api";
import { PortalFrame, msg } from "./portal-chrome";

export function PortalLogin() {
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
      nav("/client-portal", { replace: true });
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email.trim()) return setError("Enter your email address first.");
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
      <h1 className="font-display text-2xl text-foreground">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Track your shipments, documents and invoices.
      </p>

      {sent ? (
        <p className="mt-6 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          If that address has portal access, we've sent a link to set a new password. It can only be used once.
        </p>
      ) : null}

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm text-foreground" htmlFor="portal-email">Email</label>
          <Input id="portal-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm text-foreground" htmlFor="portal-password">Password</label>
          <Input id="portal-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error ? <p className="text-sm text-[hsl(var(--bad))]">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <button type="button" onClick={forgot} className="w-full text-sm text-muted-foreground transition-colors hover:text-primary-ink">
          Forgot your password?
        </button>
      </form>
    </PortalFrame>
  );
}

/* ── set password (invite + reset land here) ────────────────────────────── */

export function PortalSetPassword() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords don't match.");
    if (password.length < 8) return setError("Use at least 8 characters.");
    setBusy(true);
    setError(null);
    try {
      const r = await portalAccept(token, password);
      // Signed straight in: they've just proved control of the mailbox, so
      // bouncing them to a login form to retype what they typed is friction for
      // no security gain.
      portalToken.set(r.access_token);
      nav("/client-portal", { replace: true });
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <PortalFrame>
        <ErrorState message="That link is incomplete. Please use the link exactly as it appears in your email." />
        <p className="mt-4 text-sm">
          <Link to="/client-portal/login" className="text-primary-ink">Back to sign in</Link>
        </p>
      </PortalFrame>
    );
  }

  return (
    <PortalFrame>
      <h1 className="font-display text-2xl text-foreground">Choose a password</h1>
      <p className="mt-1 text-sm text-muted-foreground">This link can only be used once.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm text-foreground" htmlFor="pw">New password</label>
          <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm text-foreground" htmlFor="pw2">Confirm password</label>
          <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error ? <p className="text-sm text-[hsl(var(--bad))]">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Saving…" : "Set password and continue"}
        </Button>
      </form>
    </PortalFrame>
  );
}

/* ── the portal itself ──────────────────────────────────────────────────── */

export const label = (s: string) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());


/* ── investor terminal ──────────────────────────────────────────────────── */
