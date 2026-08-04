/**
 * Live shipment map — real geography, plotted from real dossiers.
 *
 * This replaces the mock's hand-drawn artwork: a stylised Cameroon+Chad blob,
 * three hardcoded lanes and edge tags reading "ANTWERP" and "PARIS CDG" that
 * pointed at nothing. The coastline is Natural Earth 110m (world-atlas), the
 * lanes are the actual POL→POD pairs on open dossiers resolved to coordinates
 * server-side, and the fit is computed from those lanes.
 *
 * ARCS. Lanes bow slightly. That is the usual origin-destination convention and
 * keeps overlapping lanes legible; it is NOT a claim about the sailed track.
 *
 * COLOUR. Road corridors draw in `--primary`, so a tenant's brand colour reaches
 * the map. Under the iframe it could not: `--primary` was never forwarded into
 * the frame, which redefined its own `--orange` and stayed SmartLS orange for
 * every tenant (audit F1).
 */
import * as React from "react";
import { Card } from "@/components/ui/card";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { MODE_ICON, MODE_LABEL } from "../mode-icons";
import type { Lane, ShipmentMode } from "../model";
import { buildMapModel, landPaths, MAP_H, MAP_W } from "./projection";
import { useLandRings } from "./use-land";

/** Stroke colour per mode. Road tracks the tenant accent; sea/air are the
 *  brand blues, which are semantic here (water and sky), not decorative. */
const LANE_STROKE: Record<ShipmentMode, string> = {
  sea: "rgb(var(--brand-blue-bright))",
  air: "rgb(var(--brand-blue))",
  road: "var(--primary)",
};
const LANE_DASH: Record<ShipmentMode, string> = { sea: "6 7", air: "3 6", road: "2 8" };
const LANE_WIDTH: Record<ShipmentMode, number> = { sea: 2.2, air: 1.6, road: 2.6 };
const LANE_ANIM: Record<ShipmentMode, string> = {
  sea: "animate-lane-sea",
  air: "animate-lane-air",
  road: "animate-lane-road",
};

/** A stable "HH:MM" for the footer, recomputed only when the lanes change. */
function useUpdatedAt(dep: unknown): string {
  return React.useMemo(
    () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dep],
  );
}

export function ShipmentMap({ lanes }: { lanes: Lane[] }) {
  const model = React.useMemo(() => buildMapModel(lanes), [lanes]);
  const rings = useLandRings();
  const reducedMotion = usePrefersReducedMotion();
  const updatedAt = useUpdatedAt(lanes);
  const land = React.useMemo(() => (model && rings ? landPaths(model, rings) : ""), [model, rings]);

  const counts = model?.counts ?? { sea: 0, road: 0, air: 0 };
  const laneCount = model?.lanes.length ?? 0;

  return (
    <Card className="relative flex flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-x-4 top-4 z-[1] flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-title font-semibold leading-tight tracking-tight">Live shipment map</h2>
          <p className="mt-0.5 text-label text-muted-foreground">
            {laneCount
              ? `${laneCount} route${laneCount === 1 ? "" : "s"} plotted from open operation files`
              : "No routes to plot"}
          </p>
        </div>
        <ul className="pointer-events-auto hidden shrink-0 gap-3 sm:flex">
          {(["sea", "air", "road"] as const).map((m) => (
            <li key={m} className="flex items-center gap-1.5 text-micro font-semibold text-muted-foreground">
              <span aria-hidden className="h-[3px] w-3.5 rounded-full" style={{ background: LANE_STROKE[m] }} />
              {MODE_LABEL[m]}
            </li>
          ))}
        </ul>
      </div>

      {/*
        The ocean is a CSS background on this region, not a `<rect>` inside the
        SVG. The SVG has a fixed aspect ratio, so when the grid stretches this
        card to match a taller shipments panel there is slack under the map —
        and a rect that stops at the SVG's own box left a visible waterline with
        bare card below it. As a background it simply fills.
      */}
      <div className="flex flex-1 items-center bg-[linear-gradient(135deg,rgb(var(--brand-blue-bright)/0.12),rgb(var(--brand-blue-deep)/0.05))]">
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={
          laneCount
            ? `Live shipment map — ${counts.sea} sea, ${counts.road} road and ${counts.air} air routes`
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
            No plottable routes — open dossiers need a port of loading and discharge.
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

            {model.lanes.map((l) => (
              <path
                key={l.id}
                id={l.id}
                d={l.d}
                fill="none"
                stroke={LANE_STROKE[l.mode]}
                strokeWidth={LANE_WIDTH[l.mode]}
                strokeDasharray={LANE_DASH[l.mode]}
                strokeLinecap={l.mode === "road" ? "round" : undefined}
                opacity={l.mode === "air" ? 0.7 : 0.9}
                className={LANE_ANIM[l.mode]}
              >
                <title>{l.title}</title>
              </path>
            ))}

            {/* SMIL, so it is NOT covered by the reduced-motion CSS rule — the
                markers are simply not rendered when the user asked for less. */}
            {!reducedMotion &&
              model.lanes.map((l) => (
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
                    r={n.emphasis ? 6 : 4.5}
                    fill={colour}
                    stroke="var(--card)"
                    strokeWidth={n.emphasis ? 2 : 1.5}
                  />
                  <text
                    x={lx.toFixed(1)}
                    y={ly.toFixed(1)}
                    textAnchor={right ? "end" : undefined}
                    className="fill-foreground text-[11px] font-semibold"
                  >
                    {n.name}
                  </text>
                </g>
              );
            })}
          </>
        )}
      </svg>
      </div>

      {/* `mt-auto` pins the footer to the bottom of the card. The map's SVG has a
          fixed aspect ratio, so when the grid stretches this card to match a
          taller shipments panel the slack has to go SOMEWHERE — under the map,
          against the card's own gradient, rather than as a floating strip with
          a gap beneath it. */}
      <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 border-t px-4 py-2.5">
        {(["sea", "road", "air"] as const).map((m) => {
          const Icon = MODE_ICON[m];
          return (
            <span key={m} className="flex items-center gap-1.5 text-label font-semibold text-muted-foreground">
              <Icon style={{ color: LANE_STROKE[m] }} />
              {counts[m]} {m}
            </span>
          );
        })}
        <span className="ml-auto flex items-center gap-1.5 text-micro font-semibold text-[rgb(var(--ok))]">
          <span aria-hidden className="h-[7px] w-[7px] animate-pulse rounded-full bg-[rgb(var(--ok))]" />
          Updated {updatedAt}
        </span>
      </div>
    </Card>
  );
}
