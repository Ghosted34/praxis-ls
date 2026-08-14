/**
 * Transport-mode glyphs, shared by the map footer, the map legend and the live
 * shipments list — the three places that name a mode.
 *
 * They live here rather than in the map so the shipments panel does not have to
 * import from a sibling's internals to draw a row icon.
 */
import * as React from "react";
import type { ShipmentMode } from "./model";

type IP = React.SVGProps<SVGSVGElement>;
const mi = (d: React.ReactNode) => (p: IP) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    width={14}
    height={14}
    {...p}
  >
    {d}
  </svg>
);

export const MODE_ICON: Record<ShipmentMode, (p: IP) => React.JSX.Element> = {
  sea: mi(
    <>
      <path d="M3 14l9-4 9 4-9 5z" />
      <path d="M12 10V4" />
    </>,
  ),
  air: mi(<path d="M2 12l20-7-7 20-3-8z" />),
  road: mi(
    <>
      <path d="M3 7h11l4 4v4h-2" />
      <circle cx="7" cy="16" r="2" />
      <circle cx="16" cy="16" r="2" />
    </>,
  ),
  /**
   * A building, for the files that move nothing.
   *
   * Warehousing, customs brokerage and business representation are real files
   * with real deadlines and no route. They used to fall through to the sea glyph
   * and get drawn as shipping lanes; a facility mark is what they actually are.
   */
  other: mi(
    <>
      <path d="M3 20V9l9-5 9 5v11" />
      <path d="M9 20v-6h6v6" />
    </>,
  ),
};

/** Human label for a mode, for legends and counts. */
export const MODE_LABEL: Record<ShipmentMode, string> = {
  sea: "Sea",
  air: "Air",
  road: "Road corridor",
  other: "No transport",
};
