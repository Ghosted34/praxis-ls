import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The icon set — hand-authored, stroke-only, `currentColor`.
 *
 * WHY NOT AN ICON PACKAGE. This app's whole payload budget is a stranger on a
 * metered connection in Douala, and an icon library is the classic way to ship
 * 40 kB of geometry to use eleven glyphs. The other option — an `<img>` per icon
 * — loses `currentColor`, and `currentColor` is what makes an icon survive a
 * tenant re-brand without a second asset.
 *
 * The strokes are 1.5px on a 24 grid, which is the weight that reads at 16-20px
 * against a light background; at 1px they disappear next to 16px type, and at 2px
 * they look like office clip-art.
 */
type Props = React.SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, className, children, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ArrowRightIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 12h15" />
    <path d="m13 6 6 6-6 6" />
  </Svg>
);

export const ChevronDownIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const CheckIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);

export const AlertIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16.2h.01" />
  </Svg>
);

export const DownloadIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.5v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </Svg>
);

export const GlobeIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3.5 9.5h17" />
    <path d="M3.5 14.5h17" />
    <path d="M12 3c2.6 3 2.6 15 0 18-2.6-3-2.6-15 0-18Z" />
  </Svg>
);

export const SunIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </Svg>
);

export const MoonIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Svg>
);

export const MenuIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const CloseIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

/* ── The mode marks: what the cargo is on ─────────────────────────────────── */

export const ShipIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3.5 15.5 5 11h14l1.5 4.5" />
    <path d="M12 11V6.5H8.5" />
    <path d="M3.5 15.5c1.6 0 1.6 1.8 3.2 1.8s1.6-1.8 3.2-1.8 1.6 1.8 3.2 1.8 1.6-1.8 3.2-1.8 1.6 1.8 3.2 1.8" />
  </Svg>
);

export const PlaneIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M10.5 3.5 12 3l1.5 5.5 7 4v1.8l-7.2-1.6-1.3 4 2.3 1.8v1.2L12 19l-2.3.7v-1.2l2.3-1.8-1.3-4L3.5 14.3v-1.8l7-4Z" />
  </Svg>
);

export const TruckIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 6.5h11v9H3z" />
    <path d="M14 9.5h3.5L21 13v2.5h-7" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </Svg>
);

export const WarehouseIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M3 10 12 5l9 5v9.5H3z" />
    <path d="M7.5 19.5V13h9v6.5" />
    <path d="M7.5 16.2h9" />
  </Svg>
);

export const DocumentIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M6 3h7l5 5v13H6z" />
    <path d="M13 3v5h5" />
    <path d="M9 13h6M9 16.5h6" />
  </Svg>
);

export const ShieldIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.2 5 6v6.5c0 4 3 6.8 7 8.3 4-1.5 7-4.3 7-8.3V6Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Svg>
);

export const ClockIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M12 7.2V12l3.4 2" />
  </Svg>
);

export const BoxIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.5 20 8v8l-8 4.5L4 16V8Z" />
    <path d="M4 8l8 4.5L20 8" />
    <path d="M12 12.5V21" />
  </Svg>
);

/** The not-found state's glyph. A magnifier, not a warning triangle: nothing
 *  went wrong when a reference does not match — the visitor mistyped it, or the
 *  desk has not opened the file yet, and an alert icon would tell them their
 *  cargo is in trouble. */
export const SearchIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);

/** A mark for surfaces with no tenant logo: the initial, in a filled square —
 *  the same construction the staff app uses, so a tenant with no logo looks the
 *  same in the portal as on their own marketing page. */
export function BrandGlyph({
  name,
  className,
  size = 32,
}: {
  name: string;
  className?: string;
  size?: number;
}) {
  const initial = (name || "P").trim().charAt(0).toUpperCase() || "P";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-[8px] bg-primary font-display font-semibold text-primary-foreground",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {initial}
    </span>
  );
}
