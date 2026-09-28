import { useTranslation } from "react-i18next";
import { useBranding } from "@/app/branding";
import { cn } from "@/lib/cn";

/**
 * The tenant's mark, and nothing of ours: this is THEIR portal (white-label).
 * On a dark photograph the tenant's alternate logo is used when they have one.
 * With no logo at all, their name — and only when they have not named the
 * workspace either, the portal's own noun.
 */
export function BrandMark({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  const { branding } = useBranding();
  const { t } = useTranslation();
  const logo = onDark ? branding.logoAltUrl || branding.logoUrl : branding.logoUrl;
  const name = branding.name || t("portal.brandFallback");
  if (logo) return <img src={logo} alt={name} className={cn("pt-logo", className)} />;
  return <span className={cn("pt-display truncate text-[1.15rem]", className)}>{name}</span>;
}

/**
 * The picture behind the sign-in: the tenant's own website hero, else the
 * backdrop they set for their staff sign-in. This repository ships no
 * photographs (public-web/scripts/check-assets.mjs), so without either the
 * scene below is drawn instead — their colour as light over carbon, with the
 * faint lines of routes between ports. Nothing in it claims to be a photograph
 * of anyone's operations.
 */
export function useSignInPhoto(): string | null {
  const { branding, login } = useBranding();
  return branding.siteHeroUrl || (login && login.backgroundUrl) || null;
}

export function SignInScene() {
  // A wireframe globe, lit from the top left, with three trade lanes arcing
  // over it in the tenant's colour and the ports at their ends. Static on
  // purpose: the sign-in is held to the same motion budget as everything else,
  // and a scene that moves is a scene someone waits for.
  return (
    <div className="pt-signin-scene" aria-hidden="true">
      <div className="pt-signin-dots" />
      <svg className="pt-signin-globe" viewBox="-500 -500 1000 1000">
        <defs>
          <radialGradient id="pt-sphere" cx="32%" cy="26%" r="80%">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="0.55" stopColor="currentColor" stopOpacity="0.04" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="pt-lane" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "var(--primary)", stopOpacity: 0 }} />
            <stop offset="0.5" style={{ stopColor: "var(--primary)", stopOpacity: 1 }} />
            <stop offset="1" style={{ stopColor: "var(--hero-foreground)", stopOpacity: 0.9 }} />
          </linearGradient>
          <filter id="pt-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <g transform="rotate(-16)">
          <circle r="420" fill="url(#pt-sphere)" />
          <circle r="420" fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.2" />
          <g fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="1">
            <line x1="0" y1="-420" x2="0" y2="420" />
            <ellipse rx="129.8" ry="420" />
            <ellipse rx="258.6" ry="420" />
            <ellipse rx="356.2" ry="420" />
            <ellipse rx="410.8" ry="420" />
            <ellipse cy="-337.2" rx="210.0" ry="78.7" />
            <ellipse cy="-250.3" rx="321.7" ry="120.5" />
            <ellipse cy="-133.2" rx="394.7" ry="147.8" />
            <ellipse cy="0.0" rx="420.0" ry="157.3" />
            <ellipse cy="133.2" rx="394.7" ry="147.8" />
            <ellipse cy="250.3" rx="321.7" ry="120.5" />
            <ellipse cy="337.2" rx="210.0" ry="78.7" />
          </g>
          <g fill="none" strokeLinecap="round">
            <g stroke="url(#pt-lane)" strokeWidth="7" opacity="0.55" filter="url(#pt-glow)">
              <path d="M-300 150 Q -60 -260 250 -120" />
              <path d="M-170 -250 Q 120 -420 330 60" />
              <path d="M-360 -40 Q -120 280 190 230" />
            </g>
            <g stroke="url(#pt-lane)" strokeWidth="2.2">
              <path d="M-300 150 Q -60 -260 250 -120" />
              <path d="M-170 -250 Q 120 -420 330 60" />
              <path d="M-360 -40 Q -120 280 190 230" />
            </g>
          </g>
          <g>
            {[
              [-300, 150],
              [250, -120],
              [-170, -250],
              [330, 60],
              [-360, -40],
              [190, 230],
            ].map(([x, y]) => (
              <g key={`${x}:${y}`} transform={`translate(${x} ${y})`}>
                <circle r="16" style={{ fill: "var(--primary)" }} opacity="0.18" />
                <circle r="5.5" style={{ fill: "var(--hero-foreground)" }} />
              </g>
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}
