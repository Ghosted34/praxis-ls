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
 * COLOUR. Road corridors draw in `--primary`, so a tenant's brand colour reaches
 * the map. Sea and air are the brand blues, which are semantic here (water and
 * sky), not decorative.
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
import { MapTooltip, type HoverTarget } from "../components/map-tooltip";
import type { Lane, LiveShipment, ShipmentMode } from "../model";
import { buildMapModel, landPaths, MAP_H, MAP_W, type MapLane } from "./projection";
import { focusOrder, isSelected, lanesOfFile, nextSelection, stepFocus, type Selection } from "./selection";
import { useLandRings } from "./use-land";

/**
 * Stroke colour per mode. Road tracks the tenant accent; sea/air are the brand
 * blues, which are semantic here (water and sky), not decorative.
 *
 * Exported because the legend renders in three places — the map footer, full
 * screen and meeting mode — and a second copy of this table is how the legend
 * ends up describing a colour the map no longer uses.
 */
export const LANE_STROKE: Record<ShipmentMode, string> = {
  sea: "rgb(var(--brand-blue-bright))",
  air: "rgb(var(--brand-blue))",
  road: "var(--primary)",
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

  const mapBody = (
    <div className="relative flex flex-1 items-center bg-[linear-gradient(135deg,rgb(var(--brand-blue-bright)/0.12),rgb(var(--brand-blue-deep)/0.05))]">
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        className="block h-auto w-full"
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
                  <circle key={`${l.id}-marker`} r={4} fill={LANE_STROKE[l.mode]} stroke="var(--card)" strokeWidth={1.4}>
                    <animateMotion dur={`${l.dur}s`} repeatCount="indefinite" rotate="auto">
                      <mpath href={`#${l.id}`} />
                    </animateMotion>
                  </circle>
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
    <div className="pointer-events-none absolute inset-x-4 top-4 z-[1] flex items-start justify-between gap-4">
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
    <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-2.5">
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
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Live shipment map, full screen"
        className="fixed inset-0 z-50 flex flex-col bg-background p-3 sm:p-4"
      >
        <Card className="relative flex flex-1 flex-col overflow-hidden">
          {header}
          {mapBody}
          {footer}
        </Card>
      </div>
    );
  }

  return (
    <Card className={cn("relative flex flex-col overflow-hidden", presenting && "min-h-[60vh]")}>
      {header}
      {mapBody}
      {footer}
    </Card>
  );
}
