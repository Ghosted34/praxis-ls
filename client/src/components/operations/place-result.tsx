/**
 * One row in the place picker — a catalogue place or a provider suggestion.
 *
 * WHY THIS IS ITS OWN COMPONENT WITH THIS MUCH IN IT. The failure it prevents is
 * ambiguity, and ambiguity is the normal case in freight geography: there is a
 * Kribi city and a Kribi deep-sea port 15 km apart, a Manzanillo in Mexico and a
 * Manzanillo in Panama, and three things called Douala (the port, the airport,
 * the city). A picker that shows only a name makes those indistinguishable, and
 * the operator's only feedback that they chose the wrong one is a lane in the
 * wrong place on the map a month later.
 *
 * So every row carries: the name, the code an operator recognises (UN/LOCODE or
 * IATA — the identifier that is actually on the booking), the kind, the country,
 * and the formatted address. That is enough to tell any two apart.
 *
 * PROVIDER CONTENT IS UNTRUSTED and is rendered as TEXT through React's normal
 * escaping — no `innerHTML`, no `dangerouslySetInnerHTML`, no URLs built from
 * provider fields anywhere in this file.
 *
 * WHICH facts a row shows is decided in `place-meta.ts` (pure, tested); this file
 * decides how they look.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { PLACE_KIND_LABEL, type PlaceKind } from "@/lib/operations-api";
import type { PlaceMeta } from "./place-meta";

/** Kind glyph. Small, mode-shaped, and semantic — a ship for a seaport reads
 *  faster than the word does when scanning ten rows. */
function KindGlyph({ kind }: { kind?: string | null }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: 14,
    height: 14,
    "aria-hidden": true,
  };
  switch (kind) {
    case "SEAPORT":
      return (
        <svg {...common}>
          <path d="M3 14l9-4 9 4-9 5z" />
          <path d="M12 10V4" />
        </svg>
      );
    case "AIRPORT":
      return (
        <svg {...common}>
          <path d="M2 12l20-7-7 20-3-8z" />
        </svg>
      );
    case "TERMINAL":
    case "RAIL_TERMINAL":
    case "WAREHOUSE":
      return (
        <svg {...common}>
          <path d="M3 20V9l9-5 9 5v11" />
          <path d="M9 20v-6h6v6" />
        </svg>
      );
    case "BORDER_POST":
      return (
        <svg {...common}>
          <path d="M6 21V3" />
          <path d="M6 4h12l-3 4 3 4H6" />
        </svg>
      );
    case "CITY":
    case "INLAND":
      return (
        <svg {...common}>
          <path d="M4 21V8l5-3v16" />
          <path d="M9 21V11l6-2v12" />
          <path d="M15 21V12l5 2v7" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z" />
          <circle cx="12" cy="10" r="2.4" />
        </svg>
      );
  }
}

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="num rounded border px-1 py-px text-micro font-semibold text-muted-foreground">
    {children}
  </span>
);

/**
 * The row itself. Rendered as an `<option>` inside the picker's listbox, so it
 * takes `id`/`selected` and reports nothing itself — the combobox owns keyboard
 * state (see place-picker.tsx).
 */
export function PlaceResultRow({
  meta,
  id,
  selected,
  onPick,
  onHover,
  suffix,
}: {
  meta: PlaceMeta;
  id: string;
  selected: boolean;
  onPick: () => void;
  onHover: () => void;
  /** Trailing hint, e.g. "Confirm to use" for a provider suggestion. */
  suffix?: React.ReactNode;
}) {
  const line2 = [
    meta.kind ? PLACE_KIND_LABEL[meta.kind as PlaceKind] || meta.kind : null,
    meta.region,
    meta.country,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={selected}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        // preventDefault keeps focus on the input, so the combobox does not
        // close from a blur before the click lands.
        e.preventDefault();
        onPick();
      }}
      className={cn(
        "block w-full rounded-md px-2.5 py-2 text-left",
        selected ? "bg-muted" : "hover:bg-muted",
      )}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden className="shrink-0 text-muted-foreground">
          <KindGlyph kind={meta.kind} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {meta.name}
        </span>
        {meta.code && <Chip>{meta.code}</Chip>}
        {meta.isReferencePoint && <Chip>Reference</Chip>}
        {meta.unverified && <Chip>Unverified</Chip>}
        {suffix}
      </span>
      {(line2 || meta.address) && (
        <span className="mt-0.5 block truncate pl-[22px] text-micro normal-case text-muted-foreground">
          {[line2, meta.address].filter(Boolean).join(" — ")}
        </span>
      )}
    </button>
  );
}
