import * as React from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getLang, setLang } from "@/lib/i18n";
import { useBranding } from "@/app/branding";
import { BrandGlyph, CloseIcon, MenuIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { p } from "@/lib/base-path";

/**
 * The header: a utility strip, then the brand nav.
 *
 * WHY TWO ROWS. maersk.com puts "Track & trace", "Log in" and the language
 * switcher in a strip ABOVE the brand nav, and that ordering is the whole point:
 * a shipping site has two audiences arriving at one URL — someone who wants to
 * buy a service, and someone who is here about a container already on the water.
 * The strip resolves the second one in a single click without turning the
 * homepage into a login page. The reverse (one nav whose primary button is
 * "Sign in") tells a prospect the site is a tool they have to be issued
 * credentials for.
 *
 * The tenant's own brand drives the mark: their logo if they uploaded one, else
 * their initial in a filled square. The wordmark is the tenant's NAME and never
 * "Praxis" — this is their front door, and `app/branding.tsx` says why painting
 * the vendor's identity on it is the one bug that would make every page wrong at
 * once.
 *
 * STICKY, and deliberately so: the nav is the only route back to tracking from a
 * long page, and on a phone a non-sticky nav means scrolling 3,000px to reach
 * it. `site-header` carries a backdrop blur for that reason — the strip sits
 * over full-bleed imagery, and a plain semi-transparent fill turns the labels
 * into a contrast gamble on whatever photo scrolls under them.
 */
const NAV = [
  { to: p("/services"), labelKey: "site.nav.services" },
  { to: p("/track"), labelKey: "site.nav.track" },
  { to: p("/portfolio"), labelKey: "site.nav.portfolio" },
  { to: p("/careers"), labelKey: "site.nav.careers" },
  { to: p("#contact"), labelKey: "site.nav.contact" },
] as const;

export function SiteHeader() {
  const { t } = useTranslation();
  const { branding } = useBranding();
  const [open, setOpen] = React.useState(false);
  const location = useLocation();

  // A menu still open after a navigation is a menu hiding the page that was
  // just asked for.
  React.useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const name = branding.name || "Praxis";

  return (
    <header className="sticky top-0 z-40">
      <div className="site-utility">
        <div className="wrap flex h-10 items-center justify-between gap-4 text-xs">
          <Link
            to={p("/track")}
            className="font-medium text-[var(--hero-foreground)] transition-opacity hover:opacity-80"
          >
            {t("site.hero.cta2")}
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/portal/login"
              className="font-medium text-[var(--hero-foreground)] transition-opacity hover:opacity-80"
            >
              {t("site.chrome.portalEntry")}
            </Link>
            <span aria-hidden className="opacity-40">
              |
            </span>
            <LangToggle onDark />
          </div>
        </div>
      </div>

      <div className="site-header">
        <div className="wrap flex items-center justify-between gap-4 py-3">
          <Link
            to={p()}
            className="flex min-w-0 items-center gap-2.5"
            aria-label={name}
          >
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={name}
                className="h-9 w-auto max-w-[180px] object-contain object-left"
              />
            ) : (
              <>
                <BrandGlyph name={name} size={34} />
                <span className="truncate font-display text-lg font-semibold tracking-tight text-foreground">
                  {name}
                </span>
              </>
            )}
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className="navlink relative">
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to={p("#quote")}
              className="btn-primary hidden h-11 items-center rounded-[calc(var(--radius)-2px)] px-5 text-[0.9375rem] font-semibold md:inline-flex"
            >
              {t("site.hero.cta")}
            </Link>
            <button
              type="button"
              className="btn-surface grid h-11 w-11 place-items-center rounded-[calc(var(--radius)-2px)] lg:hidden"
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
              <span className="sr-only">
                {open ? t("site.chrome.closeMenu") : t("site.chrome.menu")}
              </span>
            </button>
          </div>
        </div>

        {open ? (
          <nav
            id="site-menu"
            aria-label="Mobile"
            className="border-t bg-background lg:hidden"
          >
            <ul className="wrap py-1">
              {NAV.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="block border-b py-3 font-medium"
                  >
                    {t(item.labelKey)}
                  </Link>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 border-b py-3">
                <Link
                  to="/portal/login"
                  className="font-medium text-primary-ink"
                >
                  {t("site.chrome.portalEntry")}
                </Link>
                <LangToggle />
              </li>
              <li className="py-3">
                <Link
                  to={p("#quote")}
                  className="btn-primary flex h-11 items-center justify-center rounded-[calc(var(--radius)-2px)] font-semibold"
                >
                  {t("site.hero.cta")}
                </Link>
              </li>
            </ul>
          </nav>
        ) : null}
      </div>
    </header>
  );
}

/**
 * EN / FR — two buttons, not a `<select>`. The choice is binary; a select costs a
 * second click and renders as a native control that cannot be made to look the
 * same across the Android/iOS/webkit spread this market is actually on.
 *
 * Each button announces WHICH LANGUAGE it switches to (not just "FR"), because
 * `aria-pressed` on a two-letter label tells a screen-reader user nothing about
 * what pressing it does.
 */
export function LangToggle({ onDark = false }: { onDark?: boolean }) {
  const { t } = useTranslation();
  const lang = getLang();
  return (
    <span
      role="group"
      aria-label={t("site.chrome.language")}
      className="inline-flex items-center gap-0.5"
    >
      {(["en", "fr"] as const).map((code) => {
        const active = lang === code;
        return (
          <button
            key={code}
            type="button"
            lang={code}
            aria-current={active ? "true" : undefined}
            onClick={() => setLang(code)}
            aria-label={
              code === "fr"
                ? t("site.chrome.toFrench")
                : t("site.chrome.toEnglish")
            }
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase transition-colors",
              onDark
                ? active
                  ? "bg-[rgb(237_238_238/0.2)] text-[var(--hero-foreground)]"
                  : "text-[var(--hero-muted)] hover:text-[var(--hero-foreground)]"
                : active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            {code}
          </button>
        );
      })}
    </span>
  );
}
