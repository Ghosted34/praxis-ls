/**
 * Branded boot splash. Inspired by (not copied from) the JBS Praxis "Pixie Hub"
 * loading screen: centered glowing logo, wordmark, small-caps tagline, and a
 * progress bar with a live percentage — themed by the *tenant's* colour/logo.
 *
 * IMPORTANT: the identity block (logo + name + coloured glow) is only revealed
 * once `ready` is true — i.e. after the tenant's branding has actually loaded.
 * Before that it stays invisible (space reserved, no layout shift), so the
 * default "Praxis LS" / default colour never flashes; the splash simply reveals
 * the real tenant identity when it arrives. Intentionally dark regardless of app
 * theme (it fades into the app).
 */
import * as React from "react";

export function SplashScreen({
  name,
  logoUrl,
  primary,
  ready,
  progress,
  fading,
}: {
  name: string;
  logoUrl: string | null;
  primary: string;
  ready: boolean;
  progress: number;
  fading: boolean;
}) {
  const glow = ready ? primary : "#3a3f46"; // neutral until the tenant colour is known

  return (
    <div
      aria-hidden={fading}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(620px 320px at 50% 42%, ${glow}22, transparent), #0b0f10`,
        opacity: fading ? 0 : 1,
        transition: "opacity 0.45s ease",
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      {/* Identity — hidden until branding is ready, then fades in. Space reserved. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: ready ? 1 : 0,
          transition: "opacity 0.4s ease",
        }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={name}
            style={{ height: 60, width: "auto", filter: `drop-shadow(0 0 24px ${primary}66)` }}
          />
        ) : (
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: primary,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 600,
              boxShadow: `0 0 0 8px ${primary}1a, 0 0 44px 4px ${primary}66`,
            }}
          >
            {name.charAt(0).toUpperCase()}
          </div>
        )}
        <div style={{ marginTop: "1.4rem", fontSize: 22, fontWeight: 500, letterSpacing: "-0.01em", color: "#f4f6f5" }}>
          {name}
        </div>
      </div>

      <div style={{ marginTop: "0.5rem", fontSize: 11, letterSpacing: "0.22em", color: "#8a9a97" }}>
        LOADING YOUR WORKSPACE
      </div>

      <div
        style={{
          marginTop: "1.6rem",
          width: 220,
          height: 3,
          borderRadius: 99,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, progress))}%`,
            height: "100%",
            background: glow,
            borderRadius: 99,
            transition: "width 0.25s ease",
          }}
        />
      </div>
      <div style={{ marginTop: "0.55rem", fontSize: 11, letterSpacing: "0.1em", color: "#8a9a97" }}>
        {Math.round(progress)}%
      </div>
    </div>
  );
}
