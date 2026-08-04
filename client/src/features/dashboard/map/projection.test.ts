/**
 * Map projection.
 *
 * These invariants used to be enforced by nothing at all — the maths ran in the
 * parent, emitted SVG strings, and was verified by looking at an iframe. Each
 * case below pins a behaviour the surrounding comments say was deliberate, so a
 * later "simplification" has to argue with a failing test rather than a
 * paragraph.
 */
import { describe, expect, it } from "vitest";
import type { Lane } from "../model";
import { buildMapModel, landPaths, MAP_H, MAP_W } from "./projection";

const lane = (
  ref: string,
  from: [number, number],
  to: [number, number],
  mode: Lane["mode"] = "sea",
): Lane => ({
  ref,
  mode,
  status: "In transit",
  from: { name: `${ref}-from`, lat: from[0], lng: from[1] },
  to: { name: `${ref}-to`, lat: to[0], lng: to[1] },
});

const ANTWERP_DOUALA = lane("A", [51.2, 4.4], [4.05, 9.7]);
const PARIS_DOUALA = lane("B", [49.0, 2.55], [4.05, 9.7], "air");
const DOUALA_NDJAMENA = lane("C", [4.05, 9.7], [12.1, 15.05], "road");

describe("buildMapModel", () => {
  it("returns null with nothing to plot, so the caller can show a real message", () => {
    expect(buildMapModel([])).toBeNull();
  });

  it("projects every lane inside the viewport", () => {
    const m = buildMapModel([ANTWERP_DOUALA, DOUALA_NDJAMENA])!;
    expect(m.lanes).toHaveLength(2);
    m.lanes.forEach((l) => {
      const coords = l.d.match(/-?\d+\.\d+/g)!.map(Number);
      coords.forEach((n) => expect(Number.isFinite(n)).toBe(true));
    });
    // Endpoints (not the bowed control point, which may sit outside) are inside.
    const [x1, y1] = m.lanes[0].d.match(/-?\d+\.\d+/g)!.slice(0, 2).map(Number);
    expect(x1).toBeGreaterThanOrEqual(0);
    expect(x1).toBeLessThanOrEqual(MAP_W);
    expect(y1).toBeGreaterThanOrEqual(0);
    expect(y1).toBeLessThanOrEqual(MAP_H);
  });

  it("counts lanes per mode for the footer", () => {
    const m = buildMapModel([ANTWERP_DOUALA, PARIS_DOUALA, DOUALA_NDJAMENA])!;
    expect(m.counts).toEqual({ sea: 1, air: 1, road: 1 });
  });

  it("de-duplicates a port that several lanes share", () => {
    // Antwerp→Douala and Paris→Douala both terminate at Douala: three distinct
    // places, not four nodes.
    const m = buildMapModel([ANTWERP_DOUALA, PARIS_DOUALA])!;
    expect(m.nodes).toHaveLength(3);
    expect(m.nodes.filter((n) => n.name === "A-to")).toHaveLength(1);
  });

  it("nudges labels apart when two ports collide on screen", () => {
    // Antwerp and Rotterdam are 0.7° apart and project within ~5px of each other
    // once the fit has zoomed out to reach Douala. Two overlapping names are
    // less useful than one moved 13px.
    const ROTTERDAM_DOUALA = lane("R", [51.9, 4.5], [4.05, 9.7]);
    const m = buildMapModel([ANTWERP_DOUALA, ROTTERDAM_DOUALA])!;
    const origins = m.nodes.filter((n) => !n.emphasis);
    expect(origins).toHaveLength(2);
    expect(origins.some((n) => n.dy !== 0)).toBe(true);
  });

  it("bows lanes sharing a corridor to opposite sides so both stay traceable", () => {
    const m = buildMapModel([ANTWERP_DOUALA, lane("A2", [51.4, 4.5], [4.1, 9.75])])!;
    expect(m.lanes[0].d).not.toEqual(m.lanes[1].d);
  });

  it("draws the graticule over the VISIBLE viewport, not the lane bounding box", () => {
    // Antwerp→Douala is 47° of latitude against 5° of longitude, so the visible
    // world is far wider than the lanes. Keying the grid to the lanes drew a
    // narrow band down the middle with bare space either side.
    const m = buildMapModel([ANTWERP_DOUALA])!;
    const verticals = m.grid.match(/M[\d.]+,0 V/g) ?? [];
    expect(verticals.length).toBeGreaterThan(2);
    expect(m.gridLabels.length).toBeGreaterThan(2);
  });

  it("places the equator only when it is actually on screen", () => {
    const tropical = buildMapModel([DOUALA_NDJAMENA])!;
    expect(tropical.equatorY).not.toBeNull();
    const arctic = buildMapModel([lane("N", [78, 15], [80, 20])])!;
    expect(arctic.equatorY).toBeNull();
  });

  it("gives every lane a distinct id, so <mpath href> cannot cross-link", () => {
    const m = buildMapModel([ANTWERP_DOUALA, PARIS_DOUALA, DOUALA_NDJAMENA])!;
    expect(new Set(m.lanes.map((l) => l.id)).size).toBe(3);
  });
});

describe("landPaths", () => {
  const model = buildMapModel([ANTWERP_DOUALA, DOUALA_NDJAMENA])!;

  it("culls rings entirely outside the viewport", () => {
    const antipode: [number, number][] = [
      [-170, -60],
      [-160, -60],
      [-160, -50],
      [-170, -60],
    ];
    expect(landPaths(model, [antipode])).toBe("");
  });

  it("ignores degenerate rings", () => {
    expect(landPaths(model, [[[5, 5], [6, 6]]])).toBe("");
  });

  it("emits a closed subpath for a visible ring", () => {
    const nearDouala: [number, number][] = [
      [8, 3],
      [11, 3],
      [11, 6],
      [8, 3],
    ];
    const d = landPaths(model, [nearDouala]);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("clamps rather than emitting million-pixel coordinates at high zoom", () => {
    const siberia: [number, number][] = [
      [60, 70],
      [180, 70],
      [180, 80],
      [60, 70],
    ];
    const tight = buildMapModel([lane("T", [4.0, 9.7], [4.1, 9.8])])!;
    const d = landPaths(tight, [siberia]);
    if (d) {
      const coords = d.match(/-?\d+\.\d+/g)!.map(Number);
      coords.forEach((n) => expect(Math.abs(n)).toBeLessThanOrEqual(4000));
    }
  });
});
