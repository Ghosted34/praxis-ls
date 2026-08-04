/**
 * Natural Earth 110m land outlines, loaded AFTER first paint.
 *
 * WHY LAZY. `world-atlas/land-110m.json` is ~500 kB of geometry and
 * `topojson-client` decodes it. In the iframe build both were static imports at
 * the top of the Control Tower module, which meant the app's most-visited screen
 * could not paint until half a megabyte of coastline had arrived — on a product
 * that advertises thin-connectivity operation from ports. Land is drawn BEHIND
 * the ocean fill, the graticule, the lanes and the nodes, so it can arrive late
 * without shifting a single pixel of anything else: no layout jump, no flash of
 * wrong content, just the coast fading in under a map that was already useful.
 *
 * The dynamic import also gives Rollup its own chunk for the two packages
 * (they are excluded from the `vendor` bucket by `ROUTE_LOCAL_VENDOR` in
 * vite.config.ts), so they leave the Control Tower's first-load payload rather
 * than merely leaving the entry bundle.
 */
import * as React from "react";
import type { Ring } from "./projection";

/** Decoded once per session and shared by every mount of the map. */
let cached: Ring[] | null = null;
let inflight: Promise<Ring[]> | null = null;

async function loadLandRings(): Promise<Ring[]> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    const rings: Ring[] = [];
    try {
      const [{ feature: topoFeature }, topoMod] = await Promise.all([
        import("topojson-client"),
        import("world-atlas/land-110m.json"),
      ]);
      const topo = ((topoMod as any).default ?? topoMod) as any;
      const objects = topo && topo.objects;
      if (!objects) throw new Error("topology has no `objects`");
      // Defensive about the key: world-atlas ships `objects.land` in
      // land-110m.json, but countries-110m.json carries both `countries` and
      // `land`, and a version bump could rename either. Fall back to the first
      // object rather than silently rendering an oceans-only map.
      const key = objects.land ? "land" : Object.keys(objects)[0];
      if (!key) throw new Error("topology has no geometry objects");
      const geo = topoFeature(topo, objects[key]) as any;
      // feature() yields either a Feature or a FeatureCollection depending on
      // the object type — normalise to a list of geometries before walking.
      const geoms: unknown[] =
        geo.type === "FeatureCollection" ? geo.features.map((f: any) => f.geometry) : [geo.geometry];
      geoms.forEach((g) => {
        const geom = g as any;
        if (!geom || !geom.coordinates) return;
        const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
        (polys as Ring[][]).forEach((poly) => poly.forEach((r) => rings.push(r)));
      });
      if (!rings.length) throw new Error("decoded 0 rings");
    } catch (err) {
      // A swallowed failure here looks exactly like "the map just has no land",
      // which is very hard to tell from a styling problem — so it warns, and the
      // map degrades to ocean + lanes rather than to nothing.
      console.warn("[control-tower] land basemap unavailable:", err);
    }
    cached = rings;
    return rings;
  })();

  return inflight;
}

/** `null` until the geometry has been fetched and decoded; then the rings. */
export function useLandRings(): Ring[] | null {
  const [rings, setRings] = React.useState<Ring[] | null>(cached);
  React.useEffect(() => {
    if (rings) return;
    let alive = true;
    void loadLandRings().then((r) => {
      if (alive) setRings(r);
    });
    return () => {
      alive = false;
    };
  }, [rings]);
  return rings;
}
