/**
 * The tenant's installed-app icon, at any display size.
 *
 * THE CONTRACT IT KEEPS. The artwork is positioned from `iconLayout()` in
 * `@shared/pwa-design` — the same function `src/routes/pwa.js` uses when sharp
 * composites the real PNG that the operating system shows on the home screen
 * and in the taskbar. The CSS equivalent of sharp's `fit: "contain"` into a
 * square box is `object-fit: contain` on a square element, so the two renders
 * agree by construction rather than by someone keeping two sets of arithmetic
 * in sync. If that ever stops being true, this stops being the icon and
 * becomes a picture of one.
 *
 * WHY IT LIVES IN ui/ RATHER THAN THE SETTINGS FEATURE. It started as a piece
 * of the App & PWA editor's preview, but the window title bar needs the very
 * same mark (see `AppMark` in app/layout/app-shell.tsx) — and a shell that
 * imports from a lazily-loaded settings screen both inverts the layering and
 * drags that screen's chunk into the eager bundle. Shared by two callers, it is
 * a primitive.
 *
 * WHAT THE MASKS ARE. Android launchers crop a maskable icon to whatever shape
 * the device vendor chose — Pixel uses a circle, Samsung a squircle, others a
 * rounded square — and the icon has no say in it. That is the entire reason the
 * maskable variant exists, and the reason the editor shows three of them side
 * by side: an icon that reads correctly in a rounded square can lose its
 * descender in a circle, and there is no way to discover that from a file
 * picker.
 */
import { iconLayout, type EffectivePwa } from "@/lib/pwa-config";
import { cn } from "@/lib/cn";

export type MaskShape = "circle" | "squircle" | "rounded";

/** Border-radius per launcher mask, as a percentage of the icon box. */
const MASK_RADIUS: Record<MaskShape, string> = {
  circle: "50%",
  squircle: "28%",
  rounded: "22%",
};

/**
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
