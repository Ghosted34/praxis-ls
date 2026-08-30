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
import { tStatic } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/app/branding";
import { LangToggle } from "@/components/site/site-header";
import { portalToken, PortalError } from "@/lib/portal-api";

/**
 * One error formatter for the whole portal.
 *
 * `PortalError` carries a message the SERVER wrote for a stranger
 * (`lib/portal-api.ts` keeps the staff-only detail out of it). Anything else is
 * unexpected, and the fallback is a fixed sentence rather than the thrown
 * error's text: printing `TypeError: Failed to fetch` or a driver message in a
 * customer's face leaks internals and reads worse than an honest "try again".
 */
export const msg = (e: unknown, fallback?: string) =>
  e instanceof PortalError
    ? e.message
    : fallback || tStatic("errors.generic");

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
  // The wordmark is the tenant's name, never the vendor's — this is the tenant's
  // portal (`BRAND_GUIDELINES.md` §2: a lockup is the tenant name or the glyph).
  // The portal's own noun is the fallback for a workspace nobody has named yet.
  const name = branding?.name || t("portal.portalName");
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
            {/* Only when the wordmark is the TENANT. With no name and no logo
                the wordmark already falls back to "Client portal" above, and the
                eyebrow repeated it verbatim — the header read
                "Client portal CLIENT PORTAL", which is what an unconfigured
                workspace showed every one of its clients. */}
            {branding?.name || branding?.logoUrl ? (
              <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {t("portal.portalName")}
              </span>
            ) : null}
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
      {/* The vendor line the brand sheet allows on a white-labelled surface, from
          the dictionary — the same sentence the marketing footer prints, so the
          portal and the site do not disagree about who built this. */}
      <footer className="px-6 pb-10 text-center text-xs text-muted-foreground">
        {t("site.footer.powered")}
      </footer>
    </div>
  );
}

/* ── sign in ────────────────────────────────────────────────────────────── */
