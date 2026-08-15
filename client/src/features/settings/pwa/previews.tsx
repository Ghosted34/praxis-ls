/**
 * Previews for the App & PWA editor.
 *
 * THE CONTRACT THESE KEEP. Every box here is drawn from `iconLayout()` in
 * `@shared/pwa-design` — the same function `src/routes/pwa.js` uses to position
 * the artwork when sharp composites the real PNG. The CSS equivalent of
 * `fit: "contain"` into a square box is `object-fit: contain` on a square
 * element, so the two renders agree by construction rather than by someone
 * keeping two sets of arithmetic in sync. If that ever stops being true, the
 * preview stops being evidence and becomes decoration.
 *
 * `AppIcon` itself now lives in `components/ui/app-icon` because the window
 * title bar renders the same mark; it is re-exported here so this module stays
 * the one import for everything the editor draws. See that file for the masks
 * and the safe zone.
 */
import * as React from "react";
import { resolveTitlebar, type EffectivePwa } from "@/lib/pwa-config";
import { contrast, parseHex } from "@/lib/theme";
import { readWcoState, type WcoState } from "@/lib/wco";
import { AppIcon, type MaskShape } from "@/components/ui/app-icon";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/cn";

export { AppIcon, type MaskShape };

const MASK_LABEL: Record<MaskShape, string> = {
  circle: "Circle",
  squircle: "Squircle",
  rounded: "Rounded",
};

/**
 * The desktop window's title bar, in the theme colour.
 *
 * WORTH A PREVIEW BECAUSE NOTHING ELSE SHOWS IT. `theme_color` is the one
 * manifest field whose effect is invisible inside the browser — it paints the
 * installed window's title bar (the Window Controls Overlay) and Android's
 * status bar, neither of which exists on the screen you are editing from. A
 * tenant picking it blind finds out after installing.
 *
 * The window glyphs flip between dark and light the way the OS does it, by the
 * bar's luminance — which is also the fastest way to see that a mid-tone choice
 * leaves them hard to make out.
 */
export function TitleBarPreview({
  cfg,
  theme,
  caption,
}: {
  cfg: EffectivePwa;
  theme: "dark" | "light";
  caption?: string;
}) {
  const bar = resolveTitlebar(cfg, theme);
  const rgb = parseHex(bar.base) ?? [244, 247, 251];
  const onDark = contrast([255, 255, 255], rgb) >= contrast([17, 20, 24], rgb);
  const ink = onDark ? "rgb(255 255 255 / 0.92)" : "rgb(0 0 0 / 0.75)";
  const app = theme === "dark" ? "#0b0d11" : "#f3f6fb";

  return (
    <figure className="m-0 w-full">
      <div className="overflow-hidden rounded-lg border shadow-m">
        <div
          className="relative flex items-center gap-2 px-2.5 py-2"
          style={{ background: bar.base }}
        >
          {/* The artwork layer, rendered exactly as `.wco-art` does in the real
              shell: a separate low-opacity plane UNDER the content, so the text
              above it keeps full contrast no matter what image is chosen. */}
          {bar.imageUrl && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: `url("${bar.imageUrl}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                opacity: bar.opacity,
                filter: bar.blur ? `blur(${bar.blur}px)` : undefined,
              }}
            />
          )}
          <AppIcon cfg={cfg} size={16} className="relative" />
          <span
            className="relative min-w-0 flex-1 truncate text-[11px] font-medium"
            style={{ color: ink }}
          >
            {cfg.name}
          </span>
          {/* Minimise / maximise / close, as glyphs rather than an image so they
              take the computed ink colour — which is also the fastest way to see
              that a mid-tone bar leaves them hard to make out. */}
          <span
            aria-hidden
            className="relative flex items-center gap-2 text-[10px] leading-none"
            style={{ color: ink }}
          >
            <span>&#8211;</span>
            <span>&#9633;</span>
            <span>&#10005;</span>
          </span>
        </div>
        <div className="h-11" style={{ background: app }} />
      </div>
      <figcaption className="micro mt-2 text-center">
        {caption ?? "Desktop title bar"}
      </figcaption>
    </figure>
  );
}

/** A device frame the previews sit inside. Deliberately plain — the point is
 *  the content, and a photoreal bezel would just compete with it. */
export function PhoneFrame({
  children,
  caption,
  className,
}: {
  children: React.ReactNode;
  caption?: string;
  className?: string;
}) {
  return (
    <figure className={cn("m-0 flex flex-col items-center gap-2", className)}>
      <div className="relative h-[340px] w-[172px] overflow-hidden rounded-[26px] border-[6px] border-foreground/85 bg-card shadow-l">
        <div className="absolute left-1/2 top-1.5 z-10 h-1.5 w-12 -translate-x-1/2 rounded-full bg-foreground/70" />
        {children}
      </div>
      {caption && <figcaption className="micro">{caption}</figcaption>}
    </figure>
  );
}

/**
 * The icon on a home screen, at the size and against the kind of ground it will
 * actually land on. The wallpaper is a neutral gradient rather than a brand one
 * on purpose: a tenant who previews their icon against their own colour will
 * approve an icon that disappears on every real phone.
 */
export function HomeScreenPreview({
  cfg,
  mask,
}: {
  cfg: EffectivePwa;
  mask: MaskShape;
}) {
  const maskable = mask !== "rounded"; // iOS uses the plain icon; Android masks
  return (
    <PhoneFrame
      caption={`Home screen · ${MASK_LABEL[mask].toLowerCase()} crop`}
    >
      <div
        className="absolute inset-0 flex flex-col items-center justify-start gap-5 px-4 pt-10"
        style={{
          // A mid-tone wallpaper: light enough to expose a dark icon's edges,
          // dark enough to expose a white one's.
          background:
            "linear-gradient(160deg, #6b7a90 0%, #2f3946 55%, #1b2028 100%)",
        }}
      >
        <div className="text-center text-[11px] font-medium text-white/90">
          9:41
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <AppIcon cfg={cfg} maskable={maskable} mask={mask} size={58} />
          <span className="max-w-[80px] truncate text-[10px] text-white drop-shadow">
            {cfg.shortName}
          </span>
        </div>
        {/* Two neighbours, so the tenant judges their icon in a row rather than
            in isolation — which is the only way anyone ever sees it. */}
        <div className="flex gap-4 opacity-60">
          {["#4b5563", "#374151"].map((c) => (
            <div key={c} className="flex flex-col items-center gap-1.5">
              <div
                className="h-[46px] w-[46px] rounded-[14px]"
                style={{ background: c }}
              />
              <span className="h-1.5 w-8 rounded-full bg-white/50" />
            </div>
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}

/**
 * The three launcher masks at once, with the safe-zone circle drawn on. This is
 * the screen's core evidence: it is where a wordmark logo visibly fails, and
 * where the padding slider visibly fixes it.
 */
export function MaskRow({
  cfg,
  safeZone,
}: {
  cfg: EffectivePwa;
  safeZone: boolean;
}) {
  const shapes: MaskShape[] = ["circle", "squircle", "rounded"];
  return (
    // No wrapping: the three sit in one row because the comparison IS the
    // point. A mark that survives a rounded square and dies in a circle is only
    // obvious when the two are side by side.
    <div className="flex w-full items-start justify-between gap-2">
      {shapes.map((shape) => (
        <div key={shape} className="flex min-w-0 flex-col items-center gap-1.5">
          <AppIcon
            cfg={cfg}
            maskable
            mask={shape}
            size={72}
            safeZone={safeZone}
          />
          <span className="micro truncate">{MASK_LABEL[shape]}</span>
        </div>
      ))}
    </div>
  );
}

/** Names the vendors so the three shapes above read as real devices rather than
 *  as arbitrary options. Kept out of the labels themselves: at this column width
 *  "Squircle (Samsung)" truncates, and a truncated label teaches nothing. */
export function MaskLegend() {
  return (
    <p className="text-[11px] leading-snug text-muted-foreground">
      Android launchers crop to their own shape — a circle on Pixel, a squircle
      on Samsung, a rounded square elsewhere. iOS uses the plain icon and rounds
      it itself.
    </p>
  );
}

/**
 * Live report on whether the overlay is actually active, on THIS window.
 *
 * Added after a real failure: the title bar was configured correctly, the
 * manifest was correct, and the installed app still showed Chrome's own title
 * bar above the app's — with nothing anywhere saying so. Because the shell is
 * designed to degrade silently (`env(titlebar-area-*)` with fallbacks), a
 * failed overlay looks exactly like a working ordinary bar, and the only way to
 * tell was to notice two title bars stacked and start uninstalling things.
 *
 * Each state names the next action, because "not active" on its own sends
 * someone back around the same loop.
 */
export function TitleBarStatus() {
  const [state, setState] = React.useState<WcoState>(() => readWcoState());

  React.useEffect(() => {
    // `geometrychange` fires when the overlay appears, disappears or resizes —
    // so this stays correct if the window is restored, snapped or moved between
    // displays rather than reporting whatever was true at mount.
    const wco = (
      navigator as Navigator & {
        windowControlsOverlay?: {
          addEventListener: (t: "geometrychange", f: () => void) => void;
          removeEventListener: (t: "geometrychange", f: () => void) => void;
        };
      }
    ).windowControlsOverlay;
    const onChange = () => setState(readWcoState());
    wco?.addEventListener("geometrychange", onChange);
    return () => wco?.removeEventListener("geometrychange", onChange);
  }, []);

  const REPORT: Record<
    WcoState,
    { tone: "ok" | "info" | "warn"; title: string; detail: string }
  > = {
    active: {
      tone: "ok",
      title: "Active in this window.",
      detail:
        "The app is drawing its own title bar — what you see at the top of this window is the design below.",
    },
    windowed: {
      tone: "info",
      title: "You're in a browser tab.",
      detail:
        "There is no title bar to take over here, so this row renders as the app's ordinary utility bar. Install the app to see the real thing.",
    },
    unsupported: {
      tone: "info",
      title: "Not supported by this browser.",
      detail:
        "Window Controls Overlay is desktop Chromium only — Chrome, Edge, Brave. Everywhere else the app keeps its normal header, and the colour below tints the browser or status bar instead.",
    },
    inactive: {
      tone: "warn",
      title: "Installed, but the overlay is off.",
      detail:
        "The app is running as a window and this browser supports the overlay, but the operating system is still drawing its own title bar — so you are seeing two. That means the INSTALLED copy of the manifest has no window-controls-overlay in it. Two things cause it: the app was installed before the setting existed and the browser has not refreshed the manifest yet, or it was added with \u201cCreate shortcut\u201d rather than installed as an app. Check chrome://web-app-internals, find this app, and look at display_override.",
    },
  };

  const r = REPORT[state];
  return (
    <Callout tone={r.tone} title={r.title}>
      {r.detail}
    </Callout>
  );
}
