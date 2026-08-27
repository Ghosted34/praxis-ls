/**
 * Control Tower map — projection and fitting. Pure geometry, no React, no DOM.
 *
 * ONE copy of the fit maths lives here, so land, graticule, lanes and nodes are
 * guaranteed to share a projection instead of drifting apart. In the iframe
 * build this ran in the parent and shipped ready-made SVG *strings* down to a
 * dumb renderer, because the frame could not import `world-atlas`. It is the
 * same maths; it now returns data instead of markup, which is what makes it
 * testable and what lets the renderer be ordinary JSX.
 *
 * Projection is plain equirectangular (lon→x, lat→y, one shared scale). It is
 * NOT area-accurate at high latitude, which is fine for an origin-destination
 * view of tropical-to-European trade lanes and keeps the maths inspectable.
 * KNOWN LIMIT: a viewport crossing the antimeridian (±180°) would tear. No lane
 * in a Douala-centred network does; revisit if one ever routes via the Pacific.
 */
import type { Lane, ShipmentMode } from "../model";
import {
  boundsOf,
  clusterNodes,
  labelOffset,
  type Bounds,
  type ClusteredNode,
  type PlacedNode,
} from "./selection";

export const MAP_W = 760;
export const MAP_H = 470;
const MAP_PAD = 54;

/**
 * Above this many endpoints, markers are clustered.
 *
 * OFF BY DEFAULT, ON WHEN IT MATTERS. Clustering four ports at the mouth of one
 * river into one marker LOSES information, and on a five-file map there is room
 * to draw all four. Past roughly two dozen endpoints there is not: they project
 * into the same few pixels and become a smear with no readable name in it — which
 * is the state a hundred-file tower is in, and the one a meeting is most likely
 * to hit. The threshold is where "we can show them all" stops being true.
 */
const CLUSTER_ABOVE_NODES = 24;
/** Markers closer than this many pixels are the same dot to a reader. */
const CLUSTER_RADIUS_PX = 14;

/** A closed ring of [lon, lat] pairs — one Natural Earth landmass outline. */
export type Ring = [number, number][];

export type MapLane = {
  id: string;
  /** The FILE this segment belongs to — what selection and focus key on. */
  dossierId: string;
  ref: string;
  /** SVG path data for the bowed great-circle-ish arc. */
  d: string;
  mode: ShipmentMode;
  /** `MAIN_CARRIAGE`, `PICKUP`, `FINAL_DELIVERY`… what this segment IS. */
  legType: string;
  seq: number;
  status: string;
  fromName: string;
  toName: string;
  /** The `<title>` text, kept for the no-JS/screen-reader path. */
  title: string;
  /** Midpoint in SVG units — where a hover card is anchored. */
  mid: { x: number; y: number };
  /** Marker travel time in seconds — air is quickest, sea slowest. */
  dur: number;
};

export type MapNode = ClusteredNode & {
  /** Label offset applied to clear a neighbouring label. */
  dy: number;
};

export type MapModel = {
  w: number;
  h: number;
  /** lon,lat → x,y. Exposed so land can be projected later, off the same fit. */
  project: (lon: number, lat: number) => { x: number; y: number };
  grid: string;
  gridLabels: { x: number; y: number; t: string }[];
  equatorY: number | null;
  lanes: MapLane[];
  nodes: MapNode[];
  counts: Record<ShipmentMode, number>;
};

export type BuildOptions = {
  /**
   * Fit the viewport to THESE lanes instead of to all of them.
   *
   * Selecting a file zooms to it. The other lanes are still drawn — de-emphasised
   * — because a route that vanishes when you click its neighbour makes the map
   * feel like it lost your data. They are simply outside the frame now, which is
   * what "focus" means.
   */
  focus?: Lane[] | null;
  /**
   * Extra points the viewport must contain, and — when there are no lanes at
   * all — the only thing it is fitted to.
   *
   * ADDITIVE, for the attendance map (clock-in revamp PR3). That map draws
   * punch pins and worksite circles, optionally over the same order lanes this
   * model already projects, and the two layers have to share ONE frame: two
   * projections in one picture put a pin and the yard it was taken at in
   * different places. Reusing this fit is also what keeps the guide's "do not
   * rewrite the Control Tower projection" honest — attendance adds points to
   * the existing model rather than carrying a second copy of the maths.
   *
   * Without lanes (attendance-only HR, who may not see commercial lanes at all)
   * `buildMapModel` would otherwise return null and there would be no map. With
   * points supplied it fits to them instead.
   */
  points?: { lat: number; lng: number }[] | null;
};

/** The box these points fit in, folded into a lane bounds. Either may be empty;
 *  null only when BOTH are. */
function extendBounds(
  base: Bounds | null,
  points: { lat: number; lng: number }[],
): Bounds | null {
  const usable = points.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  if (!usable.length) return base;
  let minLon = base ? base.minLon : Infinity;
  let maxLon = base ? base.maxLon : -Infinity;
  let minLat = base ? base.minLat : Infinity;
  let maxLat = base ? base.maxLat : -Infinity;
  for (const p of usable) {
    if (p.lng < minLon) minLon = p.lng;
    if (p.lng > maxLon) maxLon = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return { minLon, maxLon, minLat, maxLat };
}

/**
 * A lane id, made safe to use as an SVG fragment id.
 *
 * `<mpath href="#…">` and `getElementById` both need a valid id, and a lane id is
 * built from a dossier uuid and a leg uuid joined by a colon — which is legal in
 * HTML5 but is a pseudo-class separator in a CSS selector, so anything that later
 * reaches for it with `querySelector` breaks in a way that is hard to trace.
 */
const cssId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "-");

export function buildMapModel(
  lanes: Lane[],
  options: BuildOptions = {},
): MapModel | null {
  const points = options.points || [];
  if (!lanes.length && !points.length) return null;

  // The fit is computed from the focused subset when there is one, and from
  // everything otherwise — but the LANES drawn below are always all of them.
  const framing = options.focus && options.focus.length ? options.focus : lanes;
  const bounds = extendBounds(boundsOf(framing), points);
  if (!bounds) return null;
  const cLon = (bounds.minLon + bounds.maxLon) / 2;
  const cLat = (bounds.minLat + bounds.maxLat) / 2;
  // Floor the span so one short corridor doesn't zoom to street level, where a
  // 110m coastline is a blocky mess. 18% headroom keeps node labels off the edge.
  const spanLon = Math.max(bounds.maxLon - bounds.minLon, 12) * 1.18;
  const spanLat = Math.max(bounds.maxLat - bounds.minLat, 12) * 1.18;
  // One scale for both axes: true proportions. With real coastline drawn behind,
  // the "dead space" a tall narrow lane set leaves is filled by actual geography,
  // so stretching to fill (which would skew every landmass) buys nothing.
  const scale = Math.min(
    (MAP_W - MAP_PAD * 2) / spanLon,
    (MAP_H - MAP_PAD * 2) / spanLat,
  );
  const px = (lon: number) => MAP_W / 2 + (lon - cLon) * scale;
  const py = (lat: number) => MAP_H / 2 - (lat - cLat) * scale;

  // ── graticule ──
  // Computed over the VISIBLE viewport, not the lane bounding box. Those differ
  // a lot: one axis always wins the `min()` above, so with tall narrow lanes
  // (Antwerp→Douala is 47° of latitude but 15° of longitude) the visible world
  // is far wider than the lanes. Keying the grid to the lanes drew it as a
  // narrow band down the middle with bare space either side.
  const halfLon = MAP_W / 2 / scale;
  const halfLat = MAP_H / 2 / scale;
  const lonMin = cLon - halfLon;
  const lonMax = cLon + halfLon;
  const latMin = cLat - halfLat;
  const latMax = cLat + halfLat;
  const visSpan = lonMax - lonMin;
  const step = visSpan > 120 ? 30 : visSpan > 60 ? 20 : visSpan > 24 ? 10 : 5;
  const snap = (v: number) => Math.ceil(v / step) * step;
  let grid = "";
  const gridLabels: MapModel["gridLabels"] = [];
  for (let lon = snap(lonMin); lon <= lonMax; lon += step) {
    const x = px(lon);
    grid += `M${x.toFixed(1)},0 V${MAP_H}`;
    gridLabels.push({ x: x + 3, y: MAP_H - 10, t: `${Math.round(lon)}°` });
  }
  // Clamp to the poles — equirectangular has no geometry beyond ±90, and a
  // "100°" gridline would be nonsense.
  for (
    let lat = snap(Math.max(latMin, -85));
    lat <= Math.min(latMax, 85);
    lat += step
  ) {
    const y = py(lat);
    if (y < 12 || y > MAP_H - 22) continue; // clear of the top and the lon labels
    grid += `M0,${y.toFixed(1)} H${MAP_W}`;
    gridLabels.push({ x: 6, y: y - 4, t: `${Math.round(lat)}°` });
  }
  const eqY = py(0);
  const equatorY = eqY > 0 && eqY < MAP_H ? eqY : null;

  // ── lanes ──
  const outLanes: MapLane[] = [];
  const counts: Record<ShipmentMode, number> = {
    sea: 0,
    road: 0,
    air: 0,
    rail: 0,
    other: 0,
  };

  // Lanes that share a corridor (Antwerp→Douala and Paris CDG→Douala start ~500km
  // apart but converge on the same port) project almost on top of each other. Bow
  // them alternately to either side, fanning wider as the cluster grows, so each
  // stays separately traceable and hoverable.
  const cluster = new Map<string, number>();
  const clusterIndex = (l: Lane) => {
    // 5° buckets: close enough to overlap on screen, coarse enough not to split
    // two genuinely-adjacent ports into different clusters.
    const k = `${Math.round(l.from.lat / 5)},${Math.round(l.from.lng / 5)}>${Math.round(l.to.lat / 5)},${Math.round(l.to.lng / 5)}`;
    const n = cluster.get(k) ?? 0;
    cluster.set(k, n + 1);
    return n;
  };

  lanes.forEach((l) => {
    const x1 = px(l.from.lng);
    const y1 = py(l.from.lat);
    const x2 = px(l.to.lng);
    const y2 = py(l.to.lat);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    // Bow ∝ length: long hauls arc, a short corridor stays near-straight so it
    // doesn't read as a detour. Convention only — not the sailed track.
    const ci = clusterIndex(l);
    const side = ci % 2 === 0 ? 1 : -1;
    const spread = 1 + Math.floor(ci / 2) * 0.6;
    const bow = Math.min(len * 0.16, 70) * spread * side;
    const mx = (x1 + x2) / 2 + (-dy / len) * bow;
    const my = (y1 + y2) / 2 + (dx / len) * bow;
    counts[l.mode] += 1;
    outLanes.push({
      // `ct-lane-<i>` was an ARRAY INDEX, and it is referenced by `<mpath href>`,
      // by keyboard focus and by selection. A filter that removed an earlier file
      // renumbered every lane after it, so the travelling marker jumped to a
      // different route and focus landed on a file nobody chose. The lane's own
      // id is stable across renders; the prefix keeps it a valid SVG fragment id.
      id: `ct-lane-${cssId(l.id)}`,
      dossierId: l.dossierId,
      ref: l.ref,
      d: `M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`,
      mode: l.mode,
      legType: l.legType,
      seq: l.seq,
      status: l.status,
      fromName: l.from.name,
      toName: l.to.name,
      title: `${l.ref} · ${l.from.name} → ${l.to.name} · ${l.status}`,
      // The Q curve's own control point is not on the curve; its midpoint is at
      // t=0.5, which is where a hover card should point.
      mid: { x: (x1 + 2 * mx + x2) / 4, y: (y1 + 2 * my + y2) / 4 },
      dur: l.mode === "air" ? 9 : l.mode === "road" ? 11 : 15,
    });
  });

  // ── nodes ──
  //
  // Placed, then clustered, then labelled — in that order, because clustering
  // changes how many labels there are to keep apart and labelling a set that is
  // about to collapse wastes the offsets on markers nobody will see.
  const placed: PlacedNode[] = [];
  const seen = new Set<string>();
  const mark = (p: Lane["from"], emphasis: boolean) => {
    const k = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
    if (seen.has(k)) return;
    seen.add(k);
    placed.push({
      x: px(p.lng),
      y: py(p.lat),
      name: p.name,
      kind: p.kind ?? null,
      state: p.state,
      emphasis,
    });
  };
  // Destinations first, so a place that is both a terminus and a waypoint is
  // marked as the terminus — losing a terminus into a waypoint is the wrong way
  // round to drop information.
  lanes.forEach((l) => mark(l.to, true));
  lanes.forEach((l) => mark(l.from, false));

  const clustered =
    placed.length > CLUSTER_ABOVE_NODES
      ? clusterNodes(placed, CLUSTER_RADIUS_PX)
      : placed.map((n) => ({ ...n, count: 1, names: [n.name] }));

  const nodes: MapNode[] = [];
  clustered.forEach((n) => {
    // Nudge a label off any already-placed one it would sit on top of. Ports
    // cluster (Antwerp and Paris CDG are ~5° apart and collide at this zoom), and
    // two overlapping names are less useful than one moved 13px.
    nodes.push({ ...n, dy: labelOffset(nodes, n.x, n.y) });
  });

  return {
    w: MAP_W,
    h: MAP_H,
    project: (lon, lat) => ({ x: px(lon), y: py(lat) }),
    grid,
    gridLabels,
    equatorY,
    lanes: outLanes,
    nodes,
    counts,
  };
}

/**
 * Project Natural Earth rings onto a built model, as SVG path data.
 *
 * Split out of `buildMapModel` so the coastline can arrive AFTER first paint:
 * the geometry is ~500 kB and the map is the first thing a user sees on the home
 * screen. Land is drawn behind everything, so adding it late shifts nothing.
 *
 * Rings fully outside the viewport are culled, and the rest are clamped: at high
 * zoom an unclamped Siberia projects to coordinates in the millions and bloats
 * the path string for pixels nobody sees.
 */
export function landPaths(model: MapModel, rings: Ring[]): string {
  const CLAMP = 4000;
  const clamp = (v: number) => (v < -CLAMP ? -CLAMP : v > CLAMP ? CLAMP : v);
  const out: string[] = [];
  rings.forEach((ring) => {
    if (ring.length < 3) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [lon, lat] of ring) {
      const { x, y } = model.project(lon, lat);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX < 0 || minX > model.w || maxY < 0 || minY > model.h) return; // off-screen
    let d = "";
    for (let i = 0; i < ring.length; i += 1) {
      const { x, y } = model.project(ring[i][0], ring[i][1]);
      d +=
        (i === 0 ? "M" : "L") + clamp(x).toFixed(1) + "," + clamp(y).toFixed(1);
    }
    out.push(d + "Z");
  });
  return out.join("");
}
