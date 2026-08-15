/**
 * Live shipment map — real geography, plotted from real dossiers, one segment per
 * itinerary leg.
 *
 * WHAT CHANGED, AND WHY IT MATTERS MORE THAN IT LOOKS. This drew one line per FILE,
 * from POL to POD. That is the main carriage and nothing else — so an end-to-end
 * file (collect from the shipper, sail, clear customs, truck inland, deliver to
 * the door) showed one of its five movements, and the four an operator is actually
 * chased about were invisible. The same file now draws five segments in three
 * colours, and selection ties them back together.
 *
 * IT IS ALSO INTERACTIVE NOW, and that is the difference between a picture of the
 * work and a tool for running a meeting: hover or focus a route for the file, the
 * leg, the route, the milestone and the date; click to select it, which zooms to
 * it, dims the rest and opens the itinerary; Escape to come back.
 *
 * EVERY INTERACTION HAS A KEYBOARD ROUTE. The routes are a single composite
 * widget — one tab stop, arrows to move between files, Enter or Space to select —
 * rather than one tab stop per lane, because a hundred-file map would otherwise be
 * three hundred presses wide and the keyboard would stop being a way to get
 * anywhere. Hover is never the only path to information (WCAG §1.4.13): the card
 * renders on focus too, and everything in it is in the panel a click opens.
 *
 * COLOUR AND SHAPE. Sea is green, air is blue, road is orange, from three declared
 * `--mode-*` tokens rather than borrowed brand colours — see `LANE_STROKE`. The
 * marker travelling each lane is that mode's own glyph (a ship, a plane, a truck)
 * turned along the path, and each endpoint is shaped by what kind of place it is,
 * so a map of twelve files is no longer twelve identical dots.
 *
 * ARCS. Lanes bow slightly. That is the usual origin-destination convention and
 * keeps overlapping lanes legible; it is NOT a claim about the sailed track.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { MapLegend } from "../components/map-legend";
import { ScreenOverlay } from "../components/screen-overlay";
import { MODE_GLYPH } from "../mode-icons";
import { MapTooltip, type HoverTarget } from "../components/map-tooltip";
import type { Lane, LiveShipment, ShipmentMode } from "../model";
import { buildMapModel, landPaths, MAP_H, MAP_W, type MapLane } from "./projection";
import { focusOrder, isSelected, lanesOfFile, nextSelection, stepFocus, type Selection } from "./selection";
import { useLandRings } from "./use-land";

/**
 * Stroke colour per mode: sea GREEN, air BLUE, road ORANGE.
 *
 * These read three declared tokens (`--mode-*`) rather than borrowing brand
 * colours, and that is a fix rather than a refactor. Sea was
 * `--brand-blue-bright` and air was `--brand-blue` — the same hue two steps
 * apart, which on a 2px dashed line at this zoom is not a distinction: on the
 * deployed map a vessel leg and a flight leg were one colour. Road was
 * `--primary`, so the third was a function of the tenant's brand and a blue-brand
 * tenant would have lost road onto air as well. See index.css for the values.
 *
 * Exported because the legend renders in three places — the map footer, full
 * screen and meeting mode — and a second copy of this table is how the legend
 * ends up describing a colour the map no longer uses.
 */
export const LANE_STROKE: Record<ShipmentMode, string> = {
  sea: "rgb(var(--mode-sea))",
  air: "rgb(var(--mode-air))",
  road: "rgb(var(--mode-road))",
  // A leg with no transport mode is an activity at a place, not a corridor. It
  // draws in the neutral ink so it never reads as one of the three modes in the
  // legend — and it has no lane to draw in the normal case anyway.
  other: "rgb(var(--ink) / 0.45)",
};
const LANE_DASH: Record<ShipmentMode, string> = { sea: "6 7", air: "3 6", road: "2 8", other: "1 5" };
const LANE_WIDTH: Record<ShipmentMode, number> = { sea: 2.2, air: 1.6, road: 2.6, other: 1.4 };
const LANE_ANIM: Record<ShipmentMode, string> = {
  sea: "animate-lane-sea",
  air: "animate-lane-air",
  road: "animate-lane-road",
  // No dash animation: nothing is travelling along it.
  other: "",
};

/** A stable "HH:MM" for the footer, recomputed only when the lanes change. */
function useUpdatedAt(dep: unknown): string {
  return React.useMemo(
    () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dep],
  );
}

/** Marker radius by role. A cluster is drawn larger because it stands for several. */
const nodeRadius = (emphasis: boolean, count: number) => (count > 1 ? 7.5 : emphasis ? 6 : 4.5);

/**
 * The glyph for a PLACE, by what kind of place it is.
 *
 * Two vocabularies on this map, and they answer two different questions — which is
 * the reason they are not the same table:
 *
 *   what MOVES  → `MODE_GLYPH`, on the marker travelling along the lane. A ship
 *                 on a vessel leg, a plane on a flight, a truck on a road leg.
 *   where it STOPS → this, on the fixed endpoint. A port is a port whichever leg
 *                 touches it, and a port that is the end of a sea leg and the
 *                 start of a road leg cannot be given one mode without picking a
 *                 side. Its KIND is unambiguous.
 *
 * So a road leg's endpoints are cities and addresses rather than trucks, and that
 * is correct: the truck is the thing moving between them.
 *
 * These are the same shapes `place-result.tsx` puts on each row of the picker, so
 * the place an operator chose and the marker that appears for it look alike.
 */
const KIND_GLYPH: Record<string, string> = {
  SEAPORT: MODE_GLYPH.sea,
  AIRPORT: MODE_GLYPH.air,
  TERMINAL: MODE_GLYPH.other,
  RAIL_TERMINAL: MODE_GLYPH.other,
  WAREHOUSE: MODE_GLYPH.other,
  // A gate: two posts and a bar.
  BORDER_POST: "M4.5 20V5h2v15z M17.5 20V5h2v15z M6.5 9h11v2.5h-11z",
  // Three rooftops of differing heights.
  CITY: "M3.5 20V9l4.5-2.5V20z M9 20V11.5l5-1.8V20z M15 20v-8l5.5 2.2V20z",
  INLAND: "M3.5 20V9l4.5-2.5V20z M9 20V11.5l5-1.8V20z M15 20v-8l5.5 2.2V20z",
};

/** `viewBox` units per side of the glyph box, so a marker can be sized in px. */
const GLYPH_BOX = 24;

/**
 * One marker, drawn as a glyph in a 24-unit box scaled to `size` and centred on
 * (x, y). A plain `<path>` cannot be centred on a point, so the transform does it.
 */
function Glyph({
  d,
  x,
  y,
  size,
  fill,
  stroke,
  strokeWidth = 0,
  rotate,
  children,
}: {
  d: string;
  x: number;
  y: number;
  size: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  rotate?: number;
  /** A `<title>`, which is how a marker gets an accessible name. */
  children?: React.ReactNode;
}) {
  const k = size / GLYPH_BOX;
  return (
    <path
      d={d}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth ? strokeWidth / k : undefined}
      strokeLinejoin="round"
      transform={
        `translate(${x.toFixed(1)} ${y.toFixed(1)})` +
        (rotate ? ` rotate(${rotate})` : "") +
        ` scale(${k.toFixed(4)}) translate(${-GLYPH_BOX / 2} ${-GLYPH_BOX / 2})`
      }
    >
      {children}
    </path>
  );
}

export type ShipmentMapProps = {
  lanes: Lane[];
  /** The selected file, owned by the page so the panel and the list agree with it. */
  selected: Selection;
  onSelect: (next: Selection) => void;
  /** Per-file facts the hover card shows, keyed by dossier id. */
  shipmentsById?: Record<string, LiveShipment>;
  /** Files with no drawable route, for the legend's honesty counts. */
  activityCount?: number;
  unresolvedCount?: number;
  /** Meeting mode renders the map alone and larger; it suppresses the card's
   *  chrome rather than the map. */
  presenting?: boolean;
};

export function ShipmentMap({
  lanes,
  selected,
  onSelect,
  shipmentsById = {},
  activityCount = 0,
  unresolvedCount = 0,
  presenting = false,
}: ShipmentMapProps) {
  const [fullScreen, setFullScreen] = React.useState(false);
  const [hover, setHover] = React.useState<HoverTarget | null>(null);
  /** The file the arrow keys are currently on, which is not always the selection:
   *  moving through routes should preview them without committing. */
  const [cursor, setCursor] = React.useState<Selection>(null);

  const rings = useLandRings();
  const reducedMotion = usePrefersReducedMotion();
  const updatedAt = useUpdatedAt(lanes);
  const exitRef = React.useRef<HTMLButtonElement>(null);

  const focused = lanesOfFile(lanes, selected);
  const model = React.useMemo(
    () => buildMapModel(lanes, { focus: focused.length ? focused : null }),
    // `focused` is derived from these two, and depending on the array identity
    // would rebuild the whole projection on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lanes, selected],
  );
  const land = React.useMemo(() => (model && rings ? landPaths(model, rings) : ""), [model, rings]);
  const order = React.useMemo(() => focusOrder(lanes), [lanes]);

  const counts = model?.counts ?? { sea: 0, road: 0, air: 0, other: 0 };
  const laneCount = model?.lanes.length ?? 0;
  const fileCount = order.length;

  /** Escape leaves full screen first, then clears the selection. Two jobs, one key,
   *  in the order a user expects: the mode they entered last is the one they leave. */
  React.useEffect(() => {
    if (!fullScreen && selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (fullScreen) setFullScreen(false);
      else onSelect(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullScreen, selected, onSelect]);

  // Entering full screen moves focus to the exit control, so a keyboard user is
  // not left focused on a button that has scrolled out of the viewport behind an
  // overlay — and so the way out is the first thing they land on.
  React.useEffect(() => {
    if (fullScreen) exitRef.current?.focus();
  }, [fullScreen]);

  function hoverLane(lane: MapLane) {
    setHover({ lane, x: lane.mid.x, y: lane.mid.y });
  }

  function onRoutesKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = stepFocus(order, cursor ?? selected, 1);
      setCursor(next);
      previewFile(next);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = stepFocus(order, cursor ?? selected, -1);
      setCursor(next);
      previewFile(next);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const target = cursor ?? selected;
      if (target) onSelect(nextSelection(selected, target));
    }
  }

  /** Show the card for a file the keyboard has moved onto, without selecting it. */
  function previewFile(dossierId: Selection) {
    if (!dossierId || !model) return setHover(null);
    const first = model.lanes.find((l) => l.dossierId === dossierId);
    if (first) hoverLane(first);
  }

  const hoveredShipment = hover ? shipmentsById[hover.lane.dossierId] : undefined;

  /**
   * Does the map get a box to fit inside, or does it set its own height?
   *
   * In the dashboard card it sets its own: `h-auto w-full` derives the height from
   * the width through the viewBox, which is what makes the card the right shape.
   *
   * In full screen and the meeting view it is handed the leftover height instead,
   * and it must FIT that — `h-full` plus the viewBox's default "meet" letterboxes
   * it. Left on `h-auto` it computed a height from a much wider viewport, overflowed
   * the bottom of the screen, and cut the southern half of the world off; on the
   * deployed build Rio de Janeiro sat on the very edge with its label clipped.
   */
  const fit = fullScreen || presenting;

  const mapBody = (
    <div
      className={cn(
        "relative flex bg-[linear-gradient(135deg,rgb(var(--brand-blue-bright)/0.12),rgb(var(--brand-blue-deep)/0.05))]",
        // `min-h-0` is what lets it shrink: a flex item defaults to
        // `min-height:auto` and refuses to go below its content's height.
        fit ? "min-h-0 flex-1 items-stretch" : "flex-1 items-center",
      )}
    >
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        preserveAspectRatio="xMidYMid meet"
        className={cn("block w-full", fit ? "h-full" : "h-auto")}
        role="img"
        aria-label={
          laneCount
            ? `Live shipment map — ${counts.sea} sea, ${counts.road} road and ${counts.air} air legs across ${fileCount} operation ${fileCount === 1 ? "file" : "files"}`
            : "Live shipment map — no plottable routes"
        }
      >
        <defs>
          <linearGradient id="ct-land" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgb(var(--ink))" stopOpacity="0.05" />
            <stop offset="1" stopColor="rgb(var(--ink))" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Draw order: land → graticule → equator → degree labels → routes →
            nodes, over the CSS ocean above. Land arrives after first paint (see
            useLandRings) and sits at the bottom of the stack, so nothing above
            it moves when it lands. */}
        {!model ? (
          <text x={MAP_W / 2} y={MAP_H / 2} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            No plottable routes — open files need a verified origin and destination.
          </text>
        ) : (
          <>
            {land && (
              <g fill="url(#ct-land)" stroke="rgb(var(--ink) / 0.18)" strokeWidth={0.8} strokeLinejoin="round">
                <path d={land} />
              </g>
            )}

            <g stroke="rgb(var(--ink) / 0.06)" strokeWidth={1} fill="none">
              <path d={model.grid} />
            </g>
            {model.equatorY !== null && (
              <path
                d={`M0,${model.equatorY.toFixed(1)} H${MAP_W}`}
                stroke="rgb(var(--ink) / 0.16)"
                strokeWidth={1.2}
                strokeDasharray="6 5"
              />
            )}
            <g opacity={0.5}>
              {model.gridLabels.map((l) => (
                <text key={`${l.x}-${l.y}-${l.t}`} x={l.x.toFixed(1)} y={l.y.toFixed(1)} className="fill-muted-foreground text-[8.5px] font-semibold">
                  {l.t}
                </text>
              ))}
            </g>

            {/*
              ONE TAB STOP for every route, with arrows inside it.
              A hundred-file map has ~300 legs; one stop each would make the
              keyboard a worse way to move than the mouse, which is how keyboard
              support ends up unused and then removed.
            */}
            <g
              role="application"
              tabIndex={0}
              aria-label={`${fileCount} operation ${fileCount === 1 ? "file" : "files"} on the map. Use the arrow keys to move between them and Enter to open one.`}
              onKeyDown={onRoutesKeyDown}
              onBlur={() => setHover(null)}
              className="outline-none [&:focus-visible>rect]:opacity-100"
            >
              {/* The focus ring for the composite widget. A `<g>` cannot show one
                  itself, so a rect inside it does — visible only on
                  focus-visible, so a mouse click does not draw a box. */}
              <rect
                x={1}
                y={1}
                width={MAP_W - 2}
                height={MAP_H - 2}
                fill="none"
                stroke="var(--ring)"
                strokeWidth={2}
                rx={6}
                opacity={0}
                className="transition-opacity"
              />

              {model.lanes.map((l) => {
                const on = isSelected({ dossierId: l.dossierId } as Lane, selected);
                const dimmed = selected !== null && !on;
                const cursored = cursor === l.dossierId;
                return (
                  <g key={l.id}>
                    {/*
                      A wide invisible stroke over the visible one. A 2px dashed
                      path is close to unhittable with a mouse, and a route the
                      operator cannot reliably click is a route they will stop
                      trying to click.
                    */}
                    <path
                      id={l.id}
                      d={l.d}
                      fill="none"
                      stroke={LANE_STROKE[l.mode]}
                      strokeWidth={on || cursored ? LANE_WIDTH[l.mode] + 1.2 : LANE_WIDTH[l.mode]}
                      strokeDasharray={LANE_DASH[l.mode]}
                      strokeLinecap={l.mode === "road" ? "round" : undefined}
                      opacity={dimmed ? 0.22 : l.mode === "air" ? 0.75 : 0.92}
                      className={dimmed ? "" : LANE_ANIM[l.mode]}
                    >
                      <title>{l.title}</title>
                    </path>
                    <path
                      d={l.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      className="cursor-pointer"
                      onMouseEnter={() => hoverLane(l)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => {
                        setCursor(l.dossierId);
                        onSelect(nextSelection(selected, l.dossierId));
                      }}
                    />
                  </g>
                );
              })}
            </g>

            {/* SMIL, so it is NOT covered by the reduced-motion CSS rule — the
                markers are simply not rendered when the user asked for less.
                Suppressed on a dimmed lane too: a dot travelling along a route
                the operator has de-selected is movement with no meaning. */}
            {!reducedMotion &&
              model.lanes
                .filter((l) => selected === null || l.dossierId === selected)
                .map((l) => (
                  /*
                   * The mode's own glyph, not a dot — a ship on a vessel leg, a
                   * plane on a flight, a truck on a road leg. `rotate="auto"`
                   * turns it along the path, so it also shows the DIRECTION of
                   * travel, which an anonymous dot never did.
                   *
                   * The glyphs are drawn nose-up in their box and the path
                   * tangent is nose-right, so each is pre-rotated 90° inside the
                   * <g> that animateMotion is turning.
                   */
                  <g key={`${l.id}-marker`}>
                    <Glyph
                      d={MODE_GLYPH[l.mode]}
                      x={0}
                      y={0}
                      size={l.mode === "air" ? 13 : 12}
                      rotate={90}
                      fill={LANE_STROKE[l.mode]}
                      stroke="var(--card)"
                      strokeWidth={1.1}
                    />
                    <animateMotion dur={`${l.dur}s`} repeatCount="indefinite" rotate="auto">
                      <mpath href={`#${l.id}`} />
                    </animateMotion>
                  </g>
                ))}

            {model.nodes.map((n) => {
              const colour = n.emphasis ? "var(--primary)" : "rgb(var(--brand-blue))";
              // Flip the label to the left near the right edge so it can't run off.
              const right = n.x > MAP_W - 120;
              const lx = right ? n.x - 9 : n.x + 9;
              const ly = n.y + 4 + n.dy;
              // A reference point is drawn HOLLOW. It is a verified coordinate near
              // the real address rather than at it, and a solid pin would claim a
              // precision nobody promised. The legend says so in words.
              const hollow = n.state === "reference";
              const glyph = n.kind ? KIND_GLYPH[n.kind] : undefined;
              const label = n.count > 1 ? `${n.name} +${n.count - 1}` : n.name;
              return (
                <g key={`${n.x}-${n.y}-${n.name}`}>
                  {/* When a label was nudged clear of a neighbour, tie it back to
                      its dot with a hairline so it is obvious which port it is. */}
                  {n.dy !== 0 && (
                    <path
                      d={`M${n.x.toFixed(1)},${n.y.toFixed(1)} L${lx.toFixed(1)},${(ly - 3.5).toFixed(1)}`}
                      stroke={colour}
                      strokeWidth={0.9}
                      opacity={0.5}
                      fill="none"
                    />
                  )}
                  {/*
                    A SHAPE, not a dot — a ship for a port, a plane for an
                    airport, rooftops for a city, a warehouse for a terminal. The
                    map used to draw one anonymous circle for all of them, so a
                    twelve-file map was twelve identical marks and the only way to
                    tell a port from a customer address was to read the label.

                    THE TWO AXES STAY SEPARATE. Shape says what kind of place;
                    fill says whether the coordinate is trusted. A reference point
                    is still drawn HOLLOW — verified, and explicitly not the exact
                    address — so adding shape did not cost the honesty the legend
                    describes in words.

                    A cluster keeps the circle. It stands for several places of
                    possibly different kinds, and stamping the first one's shape on
                    the group would claim they are all ports.
                  */}
                  {glyph && n.count === 1 ? (
                    <Glyph
                      d={glyph}
                      x={n.x}
                      y={n.y}
                      size={n.emphasis ? 15 : 12}
                      fill={hollow ? "var(--card)" : colour}
                      stroke={colour}
                      strokeWidth={hollow ? 1.6 : 1}
                    >
                      <title>{n.names.join(", ")}</title>
                    </Glyph>
                  ) : (
                    <circle
                      cx={n.x.toFixed(1)}
                      cy={n.y.toFixed(1)}
                      r={nodeRadius(n.emphasis, n.count)}
                      fill={hollow ? "var(--card)" : colour}
                      stroke={hollow ? colour : "var(--card)"}
                      strokeWidth={hollow ? 2 : n.emphasis ? 2 : 1.5}
                    >
                      <title>{n.names.join(", ")}</title>
                    </circle>
                  )}
                  <text
                    x={lx.toFixed(1)}
                    y={ly.toFixed(1)}
                    textAnchor={right ? "end" : undefined}
                    className="fill-foreground text-[11px] font-semibold"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </>
        )}
      </svg>

      {hover && (
        <MapTooltip
          target={hover}
          width={MAP_W}
          height={MAP_H}
          eta={hoveredShipment?.eta}
          milestone={hoveredShipment?.stage}
          progress={hoveredShipment?.progress ?? null}
        />
      )}
    </div>
  );

  const header = (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-[2] flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-title font-semibold leading-tight tracking-tight">Live shipment map</h2>
        <p className="mt-0.5 text-label text-muted-foreground">
          {laneCount
            ? `${laneCount} ${laneCount === 1 ? "leg" : "legs"} across ${fileCount} open ${fileCount === 1 ? "file" : "files"}`
            : "No routes to plot"}
          {selected !== null && " · 1 selected"}
        </p>
      </div>
      <div className="pointer-events-auto flex shrink-0 items-center gap-2">
        {selected !== null && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onSelect(null)}>
            Clear selection
          </Button>
        )}
        {!presenting && (
          <Button
            ref={fullScreen ? exitRef : undefined}
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={fullScreen}
            onClick={() => setFullScreen((v) => !v)}
          >
            {fullScreen ? "Exit full screen" : "Full screen"}
          </Button>
        )}
      </div>
    </div>
  );

  const footer = (
    // `flex-none`: the legend and the clock are the two things that must survive a
    // short viewport intact. Without it the map's flex-1 competes with them and the
    // footer is the half that loses.
    <div className="mt-auto flex flex-none flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-2.5">
      {/*
        Meeting mode renders the legend itself, in its own footer, at full size.
        Drawing it here as well would stack two identical legends with the same
        numbers — which reads as one figure disagreeing with itself, and is worse
        than either alone. The map keeps its live "updated" clock either way.
      */}
      {!presenting && (
        <MapLegend
          counts={counts}
          stroke={LANE_STROKE}
          activityCount={activityCount}
          unresolvedCount={unresolvedCount}
          compact
        />
      )}
      <span className="ml-auto flex items-center gap-1.5 text-micro font-semibold text-[rgb(var(--ok))]">
        <span aria-hidden className="h-[7px] w-[7px] animate-pulse rounded-full bg-[rgb(var(--ok))]" />
        Updated {updatedAt}
      </span>
    </div>
  );

  /*
   * FULL SCREEN IS A FIXED OVERLAY, not the Fullscreen API.
   *
   * `requestFullscreen` takes the whole display, which sounds like what is wanted
   * until a meeting needs to alt-tab to a document, or the projector is mirroring
   * a window rather than a screen. An overlay is also the only version that works
   * in an iframe-embedded deployment and on iOS Safari, where the API is
   * unavailable on non-video elements.
   *
   * `role="dialog"` + `aria-modal` so a screen reader treats the rest of the page
   * as inert while it is open, and Escape closes it (see the effect above).
   */
  if (fullScreen) {
    return (
      <ScreenOverlay label="Live shipment map, full screen" className="p-3 sm:p-4">
        <Card className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {header}
          {mapBody}
          {footer}
        </Card>
      </ScreenOverlay>
    );
  }

  return (
    <Card
      className={cn(
        "relative flex flex-col overflow-hidden",
        // Presenting: take the height the meeting view has left rather than
        // demanding 60vh of it, which on a laptop pushed the footer legend off the
        // bottom of the screen.
        presenting && "min-h-0 flex-1",
      )}
    >
      {header}
      {mapBody}
      {footer}
    </Card>
  );
}
