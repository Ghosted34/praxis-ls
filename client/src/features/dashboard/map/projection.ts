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

export const MAP_W = 760;
export const MAP_H = 470;
const MAP_PAD = 54;

/** A closed ring of [lon, lat] pairs — one Natural Earth landmass outline. */
export type Ring = [number, number][];

export type MapLane = {
  id: string;
  /** SVG path data for the bowed great-circle-ish arc. */
  d: string;
  mode: ShipmentMode;
  title: string;
  /** Marker travel time in seconds — air is quickest, sea slowest. */
  dur: number;
};

export type MapNode = {
  x: number;
  y: number;
  name: string;
  /** Destinations are emphasised; origins are secondary. */
  emphasis: boolean;
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

export function buildMapModel(lanes: Lane[]): MapModel | null {
  if (!lanes.length) return null;

  const lons: number[] = [];
  const lats: number[] = [];
  lanes.forEach((l) => {
    lons.push(l.from.lng, l.to.lng);
    lats.push(l.from.lat, l.to.lat);
  });
  const cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  // Floor the span so one short corridor doesn't zoom to street level, where a
  // 110m coastline is a blocky mess. 18% headroom keeps node labels off the edge.
  const spanLon = Math.max(Math.max(...lons) - Math.min(...lons), 12) * 1.18;
  const spanLat = Math.max(Math.max(...lats) - Math.min(...lats), 12) * 1.18;
  // One scale for both axes: true proportions. With real coastline drawn behind,
  // the "dead space" a tall narrow lane set leaves is filled by actual geography,
  // so stretching to fill (which would skew every landmass) buys nothing.
  const scale = Math.min((MAP_W - MAP_PAD * 2) / spanLon, (MAP_H - MAP_PAD * 2) / spanLat);
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
  for (let lat = snap(Math.max(latMin, -85)); lat <= Math.min(latMax, 85); lat += step) {
    const y = py(lat);
    if (y < 12 || y > MAP_H - 22) continue; // clear of the top and the lon labels
    grid += `M0,${y.toFixed(1)} H${MAP_W}`;
    gridLabels.push({ x: 6, y: y - 4, t: `${Math.round(lat)}°` });
  }
  const eqY = py(0);
  const equatorY = eqY > 0 && eqY < MAP_H ? eqY : null;

  // ── lanes ──
  const outLanes: MapLane[] = [];
  const counts: Record<ShipmentMode, number> = { sea: 0, road: 0, air: 0, other: 0 };

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

  lanes.forEach((l, i) => {
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
      id: `ct-lane-${i}`,
      d: `M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`,
      mode: l.mode,
      title: `${l.ref} · ${l.from.name} → ${l.to.name} · ${l.status}`,
      dur: l.mode === "air" ? 9 : l.mode === "road" ? 11 : 15,
    });
  });

  // ── nodes ──
  const nodes: MapNode[] = [];
  const seen = new Set<string>();
  const mark = (p: Lane["from"], emphasis: boolean) => {
    const k = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
    if (seen.has(k)) return;
    seen.add(k);
    const x = px(p.lng);
    const y = py(p.lat);
    // Nudge a label off any already-placed one it would sit on top of. Ports
    // cluster (Antwerp and Paris CDG are ~5° apart and collide at this zoom), and
    // two overlapping names are less useful than one moved 13px. Alternates up
    // and down so a run of near-coincident nodes fans out rather than drifting.
    let dy = 0;
    for (let guard = 0; guard < 6; guard += 1) {
      const clash = nodes.some((n) => Math.abs(n.x - x) < 84 && Math.abs(n.y + n.dy - (y + dy)) < 13);
      if (!clash) break;
      dy = dy <= 0 ? -dy + 13 : -dy;
    }
    nodes.push({ x, y, name: p.name, emphasis, dy });
  };
  lanes.forEach((l) => mark(l.to, true));
  lanes.forEach((l) => mark(l.from, false));

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
      d += (i === 0 ? "M" : "L") + clamp(x).toFixed(1) + "," + clamp(y).toFixed(1);
    }
    out.push(d + "Z");
  });
  return out.join("");
}
