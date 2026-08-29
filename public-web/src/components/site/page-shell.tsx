import * as React from "react";
import { useTranslation } from "react-i18next";
import { getLang } from "@/lib/i18n";
import { useBranding } from "@/app/branding";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

/**
 * The chrome every stranger-facing page wears: skip link, header, main, footer.
 *
 * `<main id="main">` plus the skip link is not ceremony. A keyboard user landing
 * on a marketing page with eight sections would otherwise tab through the whole
 * nav to reach the form they came for, and `aria-label` on `<main>` names the
 * landmark per page so "main" is announced as "Contact — main" rather than as
 * nothing. This is WCAG 2.4.1 (bypass blocks), the checkpoint a generated
 * template always fails.
 *
 * The `lang` attribute is set on `<html>` from the ACTIVE language rather than left
 * at the build-time `en` in index.html: a screen reader with the wrong `lang`
 * pronounces "Douane" as English. `useLang()` in `main.tsx` re-runs this on every
 * toggle, which is the whole reason the attribute lives in a component instead of
 * the static file.
 */
export function PageShell({
  children,
  label,
  footer = true,
}: {
  children: React.ReactNode;
  /** Accessible name for the main landmark — the page's purpose. */
  label?: string;
  footer?: boolean;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const { branding } = useBranding();

  React.useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="skip-link">
        {t("site.chrome.skip")}
      </a>
      <SiteHeader />
      <main
        id="main"
        aria-label={label || branding.name || undefined}
        className="flex-1"
      >
        {children}
      </main>
      {footer ? <SiteFooter /> : null}
    </div>
  );
}

/** The content container used by every page except the full-bleed bands. */
export function PageContainer({
  children,
  className = "",
  size = "standard",
}: {
  children: React.ReactNode;
  className?: string;
  size?: "reading" | "standard" | "wide";
}) {
  const max = {
    reading: "max-w-reading",
    standard: "max-w-standard",
    wide: "max-w-wide",
  }[size];
  // `.wrap` owns the gutters, the inner div owns the measure. Collapsing them
  // into one element is how a container ends up with `px-0` fighting the
  // clamp() and text touching the edge of a phone at 320px.
  return (
    <div className="wrap">
      <div className={`mx-auto py-10 md:py-14 ${max} ${className}`}>
        {children}
      </div>
    </div>
  );
}
