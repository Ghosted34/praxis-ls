/**
 * Transport-mode glyphs, shared by the map footer, the map legend and the live
 * shipments list — the three places that name a mode.
 *
 * They live here rather than in the map so the shipments panel does not have to
 * import from a sibling's internals to draw a row icon.
 */
import * as React from "react";
import type { ShipmentMode } from "./model";

/**
 * The path data, on its own, in a 24×24 box centred on (12,12).
 *
 * Separate from the components below because the MAP draws these too — as the
 * marker travelling along each lane, in place of the anonymous dot it used to
 * draw. A ship on a sea leg and a plane on a flight is the whole point, and two
 * copies of the same path data is how the map's ship and the legend's ship drift
 * into being different ships.
 *
 * Filled, not stroked: at the ~11px the map draws them, a 1.7px stroke on a 24px
 * glyph closes up into a blob. The icon components below stroke the same outlines,
 * which at 14px with a label beside them is the lighter, more legible treatment.
 */
export const MODE_GLYPH: Record<ShipmentMode, string> = {
  // A hull with a mast. Reads as a ship at 10px, which a more detailed vessel
  // does not.
  sea: "M2.5 13.5h19l-3 6h-13z M12 13V4 M12.6 5.5l6 3-6 2.5z",
  air: "M12 2.2l2 7.3 8.3 3.2v2l-8.3-1.6-1 5.2 3 2.2v1.5l-4-1.3-4 1.3v-1.5l3-2.2-1-5.2-8.3 1.6v-2l8.3-3.2z",
  // A cab, a box body and two wheels — the silhouette, not a technical drawing.
  road: "M2 8h11v8H2z M13.5 10.5h3.5l3 3.5v2h-6.5z M6.5 15.5a2 2 0 104 0 2 2 0 10-4 0 M15 15.5a2 2 0 104 0 2 2 0 10-4 0",
  // A train locomotive front with windshield, headlights and track base.
  rail: "M6 3h12a2 2 0 012 2v11a2 2 0 01-2 2l1.5 2v1h-2.5l-1.5-2H8.5l-1.5 2H4.5v-1l1.5-2a2 2 0 01-2-2V5a2 2 0 012-2zm1.5 3v4h9V6h-9zm1.5 7a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z",
  /**
   * A building, for the files that move nothing.
   *
   * Warehousing, customs brokerage and business representation are real files
   * with real deadlines and no route. They used to fall through to the sea glyph
   * and get drawn as shipping lanes; a facility mark is what they actually are.
   */
  other: "M3.5 20V9.5L12 4.5l8.5 5V20z",
};

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
  rail: mi(
    <>
      <rect x="4" y="3" width="16" height="13" rx="2" />
      <path d="M4 11h16" />
      <path d="M12 3v8" />
      <circle cx="8" cy="13.5" r="1" />
      <circle cx="16" cy="13.5" r="1" />
      <path d="M6 19l-2 2M18 19l2 2M8 19h8" />
    </>,
  ),
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
  rail: "Rail corridor",
  other: "No transport",
};
