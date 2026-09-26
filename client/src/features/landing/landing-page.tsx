/**
 * Landing (pre-auth) — the cinematic entry point at /login. A full-bleed hero
 * branded per tenant from the public /branding endpoint (name, logo, colour,
 * and the optional hero block edited on the Appearance screen). Every accent is
 * token-driven off --primary, so a tenant's colour repaints the whole page.
 *
 * "Enter workspace" opens the LoginModal over the dimmed hero. Any hero field the
 * tenant hasn't configured falls back to clean generic copy derived from the
 * brand name — so an un-set-up tenant still gets a presentable landing.
 */
import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { useBranding } from "@/app/branding/branding-context";
import { LoginModal } from "@/features/auth/login-modal";
import {
  BrandGlyph,
  ArrowRightIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
} from "@/components/ui/icons";
import { getMode, setMode, type ThemeMode } from "@/lib/theme-mode";
import { fetchLogin, type LoginConfig } from "@/lib/branding";
import { lastSessionStore } from "@/lib/last-session";

const NEXT: Record<ThemeMode, ThemeMode> = {
  light: "dark",
  dark: "system",
  system: "light",
};
const ICON = { light: SunIcon, dark: MoonIcon, system: MonitorIcon };

function ThemeCycle() {
  const [mode, setLocal] = React.useState<ThemeMode>(() => getMode());
  const Icon = ICON[mode];
  return (
    <button
      className="landing-ghost-btn"
      title={`Theme: ${mode}`}
      aria-label={`Theme: ${mode}. Click to change.`}
      onClick={() => {
        const next = NEXT[mode];
        setMode(next);
        setLocal(next);
      }}
    >
      <Icon width={17} height={17} />
    </button>
  );
}

export function LandingPage() {
  const { status } = useAuth();
  const { branding } = useBranding();
  const location = useLocation();
  const [open, setOpen] = React.useState(false);

  /**
   * Open the sign-in straight away for someone who is clearly here to sign in:
   * a device that remembers its person (the greeting and their passkey are the
   * whole point), or a redirect from a page they were trying to reach. The hero
   * and its "Enter workspace" button are for a device that knows nobody.
   */
  const wantsSignIn = !!lastSessionStore.get() || !!(location.state as { from?: string } | null)?.from;
  React.useEffect(() => {
    if (status === "anon" && wantsSignIn) setOpen(true);
  }, [status, wantsSignIn]);

  // Login-screen config (GET /branding/login) — authored on /settings/login.
  // It's the live source for hero copy/background; the legacy branding.hero
  // block is only a fallback for fields LoginConfig doesn't carry (eyebrow,
  // body, pills). null while loading / if the tenant hasn't configured one.
  const [login, setLogin] = React.useState<LoginConfig | null>(null);
  React.useEffect(() => {
    let alive = true;
    fetchLogin()
      .then((cfg) => alive && setLogin(cfg))
      .catch(() => {
        /* no login config / offline — fall back to hero + generic copy */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Already signed in? Skip the marketing page — unless the sign-in modal is
  // still open. It stays up after the tokens land to offer this device a
  // passkey, and redirecting here unmounted it the instant sign-in succeeded:
  // the offer was written, and nobody ever saw it.
  if (status === "authed" && !open) return <Navigate to="/" replace />;

  const brandName = branding.name || "Praxis LS";
  const hero = branding.hero || {};

  // Precedence: saved login config → legacy hero → generic copy.
  const eyebrow = hero.eyebrow || "Welcome to your operational command center";
  const kicker = brandName.toUpperCase();
  const headline =
    login?.headline ||
    hero.headline ||
    `Everything ${brandName} runs, in one workspace.`;
  const subheadline =
    login?.subtext ||
    hero.subheadline ||
    "Sign in to manage operations end to end — from the floor to global dispatch.";
  const body = hero.body || null;
  const pills = hero.pills || [];
  const backgroundUrl = login?.backgroundUrl || hero.imageUrl || null;
  const showLogo = login?.showLogo ?? true;
  const layout = login?.layout || "split";

  return (
    <div
      className="landing"
      data-layout={layout}
      style={
        login?.accentOverride
          ? ({ "--primary": login.accentOverride } as React.CSSProperties)
          : undefined
      }
    >
      <div
        className="landing-bg"
        style={
          backgroundUrl
            ? { backgroundImage: `url(${backgroundUrl})` }
            : undefined
        }
      />
      <div className="landing-veil" />

      <header className="landing-top">
        <div className="landing-brand">
          {showLogo &&
            (branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={brandName}
                style={{ height: 30, width: "auto" }}
              />
            ) : (
              <>
                <BrandGlyph className="landing-brand-glyph" />
                <span>
                  {brandName.split(" ")[0]}{" "}
                  <span className="accent">
                    {brandName.split(" ").slice(1).join(" ") || ""}
                  </span>
                </span>
              </>
            ))}
        </div>
        <ThemeCycle />
      </header>

      <main className="landing-content">
        <span className="landing-eyebrow">{eyebrow}</span>
        <span className="landing-kicker">{kicker}</span>
        <h1 className="landing-headline">{headline}</h1>
        <p className="landing-sub">{subheadline}</p>
        {body && <p className="landing-body">{body}</p>}
        {pills.length > 0 && (
          <div className="landing-pills">
            {pills.map((p, i) => (
              <span className="landing-pill" key={i}>
                {p.iconUrl ? (
                  <img src={p.iconUrl} alt="" />
                ) : (
                  <span className="landing-pill-dot">
                    <BrandGlyph width={13} height={13} />
                  </span>
                )}
                {p.label}
              </span>
            ))}
          </div>
        )}
        <button className="landing-enter" onClick={() => setOpen(true)}>
          Enter workspace
          <span className="arrow">
            <ArrowRightIcon width={15} height={15} />
          </span>
        </button>
      </main>

      {/* G4 — the PRD §5.4 [RULE] line, on the pre-auth marketing surface.
          Same placement and styling as the client portal's footer. */}
      <footer className="px-6 pb-8 pt-2 text-center text-xs text-muted-foreground">
        Powered by JBS Praxis LLC
      </footer>

      {open && <LoginModal onClose={() => setOpen(false)} />}
    </div>
  );
}
