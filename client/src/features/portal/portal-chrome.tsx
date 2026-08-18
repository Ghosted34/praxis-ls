/**
 * Client portal — the outer frame, and the one error formatter.
 *
 * Split out of `features/portal/portal-app.tsx` (622 lines) in Phase 4, audit
 * F7. This is a SEPARATE surface from the tenant app: a tenant's own customers,
 * investors and auditors sign in here, so it carries its own chrome rather than
 * the operator shell.
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/app/branding/branding-context";
import { LangToggle } from "@/components/lang-toggle";
import { portalToken, PortalError } from "@/lib/portal-api";

export const msg = (e: unknown) =>
  e instanceof PortalError
    ? e.message
    : "Something went wrong. Please try again.";

/* ── chrome ─────────────────────────────────────────────────────────────── */

export function PortalFrame({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  const { branding } = useBranding();
  const { t } = useTranslation();
  const name = branding?.name || "Client portal";
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div
          className={`mx-auto flex items-center justify-between px-6 py-4 ${wide ? "max-w-standard" : "max-w-md"}`}
        >
          <div className="flex items-center gap-3">
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="h-8 w-auto" />
            ) : (
              <span className="font-display text-lg text-foreground">
                {name}
              </span>
            )}
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {t("portal.portalName")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <LangToggle />
            {wide ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  portalToken.clear();
                  window.location.assign("/portal/login");
                }}
              >
                {t("shell.signOut")}
              </Button>
            ) : null}
          </div>
        </div>
      </header>
      <main
        className={`mx-auto px-6 py-10 ${wide ? "max-w-standard" : "max-w-md"}`}
      >
        {children}
      </main>
      <footer className="px-6 pb-10 text-center text-xs text-muted-foreground">
        Powered by JBS Praxis LLC
      </footer>
    </div>
  );
}

/* ── sign in ────────────────────────────────────────────────────────────── */
