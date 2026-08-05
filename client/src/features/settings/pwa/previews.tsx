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
 * WHAT THE MASKS ARE. Android launchers crop a maskable icon to whatever shape
 * the device vendor chose — Pixel uses a circle, Samsung a squircle, others a
 * rounded square — and the icon has no say in it. That is the entire reason the
 * maskable variant exists and the entire reason this screen shows three of them
 * side by side: an icon that reads correctly in a rounded square can lose its
 * descender in a circle, and there is no way to discover that from a file
 * picker.
 */
import * as React from "react";
import { iconLayout, type EffectivePwa } from "@/lib/pwa-config";
import { contrast, parseHex } from "@/lib/theme";
import { cn } from "@/lib/cn";

export type MaskShape = "circle" | "squircle" | "rounded";

/** Border-radius per launcher mask, as a percentage of the icon box. */
const MASK_RADIUS: Record<MaskShape, string> = {
  circle: "50%",
  squircle: "28%",
  rounded: "22%",
};

const MASK_LABEL: Record<MaskShape, string> = {
  circle: "Circle",
  squircle: "Squircle",
  rounded: "Rounded",
};

/**
 * The icon exactly as the API will render it, at any display size.
 *
 * `maskable` switches to the safe-zone padding and the opaque brand background;
 * `mask` clips it the way a launcher would; `safeZone` overlays the circle that
 * a maskable icon is guaranteed to keep — content outside it is at the mercy of
 * the device.
 */
export function AppIcon({
  cfg,
  maskable = false,
  mask,
  size = 72,
  safeZone = false,
  className,
}: {
  cfg: EffectivePwa;
  maskable?: boolean;
  mask?: MaskShape;
  size?: number;
  safeZone?: boolean;
  className?: string;
}) {
  const layout = iconLayout(cfg, maskable);
  const background = maskable
    ? cfg.maskableBackground
    : cfg.iconBackground === "transparent"
      ? "transparent"
      : cfg.iconBackground;
  // A plain icon keeps the tenant's corner rounding; a maskable one must be a
  // full square, because the launcher supplies the shape and any rounding we
  // baked in would show as a lighter notch inside the crop.
  const radius = mask ? MASK_RADIUS[mask] : maskable ? "0%" : `${cfg.iconRadius}%`;

  return (
    <div
      className={cn("relative flex-none overflow-hidden", className)}
      style={{ width: size, height: size, borderRadius: radius, background }}
    >
      {cfg.iconUrl ? (
        <img
          src={cfg.iconUrl}
          alt=""
          style={{
            position: "absolute",
            left: `${layout.left * 100}%`,
            top: `${layout.top * 100}%`,
            width: `${layout.size * 100}%`,
            height: `${layout.size * 100}%`,
            objectFit: "contain",
          }}
        />
      ) : (
        // Matches the server's monogram fallback: brand colour, white letter.
        <div
          className="grid h-full w-full place-items-center font-semibold text-white"
          style={{ background: cfg.themeColor, fontSize: size * 0.5 }}
        >
          {(cfg.shortName || cfg.name || "P").charAt(0).toUpperCase()}
        </div>
      )}

      {safeZone && (
        <div
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            // The maskable safe zone: the centre circle of diameter 80%.
            // Anything outside it may be cropped by the launcher.
            inset: "10%",
            borderRadius: "50%",
            border: "1px dashed rgb(255 255 255 / 0.9)",
            boxShadow: "0 0 0 1px rgb(0 0 0 / 0.35) inset",
          }}
        />
      )}
    </div>
  );
}

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
export function TitleBarPreview({ cfg }: { cfg: EffectivePwa }) {
  const bar = parseHex(cfg.themeColor) ?? [244, 247, 251];
  const onDark = contrast([255, 255, 255], bar) >= contrast([17, 20, 24], bar);
  const ink = onDark ? "rgb(255 255 255 / 0.92)" : "rgb(0 0 0 / 0.75)";

  return (
    <figure className="m-0 w-full">
      <div className="overflow-hidden rounded-lg border shadow-m">
        <div className="flex items-center gap-2 px-2.5 py-2" style={{ background: cfg.themeColor }}>
          <AppIcon cfg={cfg} size={16} />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium" style={{ color: ink }}>
            {cfg.name}
          </span>
          {/* Minimise / maximise / close, as glyphs rather than an image so they
              take the computed ink colour. */}
          <span aria-hidden className="flex items-center gap-2 text-[10px] leading-none" style={{ color: ink }}>
            <span>&#8211;</span>
            <span>&#9633;</span>
            <span>&#10005;</span>
          </span>
        </div>
        <div className="h-11 bg-background" />
      </div>
      <figcaption className="micro mt-2 text-center">Desktop title bar</figcaption>
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
export function HomeScreenPreview({ cfg, mask }: { cfg: EffectivePwa; mask: MaskShape }) {
  const maskable = mask !== "rounded"; // iOS uses the plain icon; Android masks
  return (
    <PhoneFrame caption={`Home screen · ${MASK_LABEL[mask].toLowerCase()} crop`}>
      <div
        className="absolute inset-0 flex flex-col items-center justify-start gap-5 px-4 pt-10"
        style={{
          // A mid-tone wallpaper: light enough to expose a dark icon's edges,
          // dark enough to expose a white one's.
          background: "linear-gradient(160deg, #6b7a90 0%, #2f3946 55%, #1b2028 100%)",
        }}
      >
        <div className="text-center text-[11px] font-medium text-white/90">9:41</div>
        <div className="flex flex-col items-center gap-1.5">
          <AppIcon cfg={cfg} maskable={maskable} mask={mask} size={58} />
          <span className="max-w-[80px] truncate text-[10px] text-white drop-shadow">{cfg.shortName}</span>
        </div>
        {/* Two neighbours, so the tenant judges their icon in a row rather than
            in isolation — which is the only way anyone ever sees it. */}
        <div className="flex gap-4 opacity-60">
          {["#4b5563", "#374151"].map((c) => (
            <div key={c} className="flex flex-col items-center gap-1.5">
              <div className="h-[46px] w-[46px] rounded-[14px]" style={{ background: c }} />
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
export function MaskRow({ cfg, safeZone }: { cfg: EffectivePwa; safeZone: boolean }) {
  const shapes: MaskShape[] = ["circle", "squircle", "rounded"];
  return (
    // No wrapping: the three sit in one row because the comparison IS the
    // point. A mark that survives a rounded square and dies in a circle is only
    // obvious when the two are side by side.
    <div className="flex w-full items-start justify-between gap-2">
      {shapes.map((shape) => (
        <div key={shape} className="flex min-w-0 flex-col items-center gap-1.5">
          <AppIcon cfg={cfg} maskable mask={shape} size={72} safeZone={safeZone} />
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
      Android launchers crop to their own shape — a circle on Pixel, a squircle on Samsung, a rounded square
      elsewhere. iOS uses the plain icon and rounds it itself.
    </p>
  );
}
