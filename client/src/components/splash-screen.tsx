/**
 * Branded boot splash — the screen a tenant sees while the app starts, and the
 * thing they design in Settings › App & PWA › Splash. Inspired by (not copied
 * from) the JBS Praxis "Pixie Hub" loading screen: centered glowing mark,
 * wordmark, small-caps tagline, and a progress bar with a live percentage.
 *
 * ONE COMPONENT, TWO CALLERS. `BootGate` renders it full-screen for real, and
 * the editor renders the SAME component inside a phone frame to preview it. A
 * preview built from a second implementation would drift from the real thing on
 * the first change to either, and the whole reason the editor exists is that a
 * tenant can trust what it shows. `variant="preview"` changes only the
 * positioning (absolute inside the frame instead of fixed over the app), the
 * scale of the type, and the fact that it never captures pointer events.
 *
 * IDENTITY IS REVEALED, NOT FLASHED. The logo/name/colour block stays invisible
 * (space reserved, no layout shift) until `ready` — i.e. after the tenant's own
 * branding has loaded — so the default "Praxis LS" never appears first.
 *
 * The animations are CSS classes (`.splash-*` in index.css) chosen from a closed
 * preset list: the tenant picks a preset, the colours, and how long the splash
 * stays up, and cannot introduce a duration of their own. Under
 * prefers-reduced-motion the global kill in index.css reduces every preset to
 * its static composition — which is why each one is designed to be legible at
 * rest.
 */
import type { EffectivePwa } from "@/lib/pwa-config";
import { contrast, parseHex } from "@/lib/theme";

/**
 * Ink that clears AA on whatever background the tenant chose. The splash paints
 * OUTSIDE the token layer — it covers the app before the CSS variables mean
 * anything — so it cannot use `--foreground` and has to make the light/dark
 * decision itself. Measured with the same WCAG helpers `applyBrand` uses.
 */
function inkFor(background: string): {
  strong: string;
  muted: string;
  track: string;
} {
  const bg = parseHex(background) ?? [11, 15, 16];
  const onDark = contrast([255, 255, 255], bg) >= contrast([17, 20, 24], bg);
  return onDark
    ? { strong: "#f4f6f5", muted: "#9aa8a6", track: "rgb(255 255 255 / 0.10)" }
    : { strong: "#101418", muted: "#5b666f", track: "rgb(0 0 0 / 0.10)" };
}

/** Preset → the class applied to the mark. `mesh` animates the BACKDROP
 *  instead, so its mark just uses the quiet entrance. */
const MARK_CLASS: Record<EffectivePwa["splashPreset"], string> = {
  none: "",
  fade: "splash-fade",
  pulse: "splash-pulse",
  shimmer: "splash-shimmer",
  ring: "splash-ring",
  mesh: "splash-fade",
};

export function SplashScreen({
  cfg,
  ready,
  progress,
  fading,
  variant = "boot",
}: {
  cfg: EffectivePwa;
  /** Tenant branding has loaded — reveal the identity block. */
  ready: boolean;
  progress: number;
  fading: boolean;
  variant?: "boot" | "preview";
}) {
  const preview = variant === "preview";
  const bg = cfg.splashBackground;
  const ink = inkFor(bg);
  const accent = ready ? cfg.themeColor : "#3a3f46"; // neutral until the tenant colour is known
  const name = cfg.name;

  return (
    <div
      aria-hidden={fading || preview}
      style={{
        position: preview ? "absolute" : "fixed",
        inset: 0,
        zIndex: preview ? 1 : 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: bg,
        opacity: fading ? 0 : 1,
        transition: "opacity 0.45s ease",
        pointerEvents: fading || preview ? "none" : "auto",
        // Consumed by `.splash-ring::before` — the orbit takes the tenant's
        // colour without needing a second inline style per preset.
        ["--splash-accent" as string]: accent,
      }}
    >
      {/* Backdrop. `mesh` promotes it to two drifting brand-coloured blooms;
          every other preset gets the still radial wash. */}
      {cfg.splashPreset === "mesh" ? (
        <>
          <div
            className="splash-mesh-layer"
            style={{
              position: "absolute",
              inset: "-20%",
              background: `radial-gradient(closest-side, ${accent}55, transparent 70%)`,
              transform: "translate3d(-12%, -10%, 0)",
            }}
          />
          <div
            className="splash-mesh-layer"
            style={{
              position: "absolute",
              inset: "-20%",
              background: `radial-gradient(closest-side, ${accent}33, transparent 70%)`,
              transform: "translate3d(14%, 12%, 0)",
              animationDelay: "-3s",
            }}
          />
        </>
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(620px 320px at 50% 42%, ${accent}22, transparent)`,
          }}
        />
      )}

      {/* Identity — hidden until branding is ready, then fades in. */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: ready ? 1 : 0,
          transition: "opacity 0.4s ease",
        }}
      >
        <div
          className={MARK_CLASS[cfg.splashPreset] || undefined}
          style={{ display: "grid", placeItems: "center" }}
        >
          {cfg.splashLogoUrl ? (
            <img
              src={cfg.splashLogoUrl}
              alt={name}
              style={{
                height: preview ? 44 : 60,
                width: "auto",
                maxWidth: preview ? 120 : 200,
                objectFit: "contain",
                filter: `drop-shadow(0 0 24px ${accent}66)`,
              }}
            />
          ) : (
            <div
              style={{
                width: preview ? 48 : 64,
                height: preview ? 48 : 64,
                borderRadius: 18,
                background: accent,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: preview ? 22 : 28,
                fontWeight: 600,
                boxShadow: `0 0 0 8px ${accent}1a, 0 0 44px 4px ${accent}66`,
              }}
            >
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div
          style={{
            marginTop: preview ? "1rem" : "1.4rem",
            fontSize: preview ? 15 : 22,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            color: ink.strong,
          }}
        >
          {name}
        </div>
      </div>

      {cfg.splashTagline && (
        <div
          style={{
            position: "relative",
            marginTop: "0.5rem",
            fontSize: preview ? 9 : 11,
            letterSpacing: "0.22em",
            color: ink.muted,
            textAlign: "center",
            padding: "0 1rem",
          }}
        >
          {cfg.splashTagline}
        </div>
      )}

      {cfg.splashShowProgress && (
        <>
          <div
            style={{
              position: "relative",
              marginTop: preview ? "1.1rem" : "1.6rem",
              width: preview ? 130 : 220,
              height: 3,
              borderRadius: 99,
              background: ink.track,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.max(0, progress))}%`,
                height: "100%",
                background: accent,
                borderRadius: 99,
                transition: "width 0.25s ease",
              }}
            />
          </div>
          <div
            style={{
              position: "relative",
              marginTop: "0.55rem",
              fontSize: preview ? 9 : 11,
              letterSpacing: "0.1em",
              color: ink.muted,
            }}
          >
            {Math.round(progress)}%
          </div>
        </>
      )}
    </div>
  );
}
