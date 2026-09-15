import type { Corridor } from "./corridors-api";

/**
 * The corridor network, as a graph laid out in ABSTRACT space.
 *
 * ── WHY THIS IS NOT A MAP, AND THAT IS A DECISION NOT AN OMISSION ─────────
 *
 * `geo_place` carries latitude and longitude, so a world map with great-circle
 * arcs is one projection away and is the obvious thing to build for a set piece
 * called "the corridor network". `corridor-panel.tsx` already argued against it
 * and the argument still holds:
 *
 *   "an arc drawn between two points invites the reader to trace it, and the
 *    endpoints are exactly what the k-anonymity floor spent its design on
 *    protecting."
 *
 * The endpoint applies that floor before it answers — at least five distinct
 * files across at least three distinct clients in a trailing 24-month window —
 * so what arrives here is already safe to publish. What a projection adds is
 * not more data, it is more INFERENCE: a reader who can see the geography can
 * reason about routing, transit times and who else is on the lane, from a
 * picture we drew for them.
 *
 * So the scene is a network in space rather than a network on a map. Nodes are
 * placed on a ring by volume; lanes are chords across it. It states exactly
 * what the panel's list states — this lane, this often, this mode — and states
 * it once. Guide §7.5's own rule points the same way: "it must never imply
 * lanes the tenant does not run", and a projection implies rather more than the
 * rows contain.
 *
 * ── AND WHEN THERE IS NOTHING, IT IS ABSTRACT BY DESIGN ───────────────────
 *
 * A young tenant, or one under the k-anonymity floor, gets an empty array. §7.5
 * says the scene is then "abstract by design". `abstractGraph()` below builds a
 * symmetric network with NO place names and NO counts — it is visibly a
 * pattern, not a claim. Nothing in it can be read as a lane.
 */

export type GraphNode = {
  id: string;
  /** The place name, or null when the graph is the abstract stand-in. A node
   *  with no label asserts nothing, which is the whole point of that state. */
  label: string | null;
  /** Unit-circle position, -1…1 on both axes. The renderers scale it. */
  x: number;
  y: number;
  /** Files through this place. 0 in the abstract graph. */
  weight: number;
  /**
   * The tenant has a public entity in this place's COUNTRY (§6.9's entities
   * read, joined on `country_code`).
   *
   * "We deliver here" and "we are here" are different claims and the second is
   * the stronger one. Only true where BOTH sides said so: the corridor row
   * carries a country code and a `public_enabled` entity covers it. False for
   * every node when a tenant has published no entity, which is the default —
   * an absence marks nothing rather than guessing.
   */
  present: boolean;
};

export type GraphLane = {
  from: number;
  to: number;
  mode: Corridor["mode"];
  weight: number;
  /** 0…1, this lane's weight against the busiest. Drives stroke width and
   *  opacity so the picture's emphasis is the data's emphasis. */
  strength: number;
};

export type CorridorGraph = {
  nodes: GraphNode[];
  lanes: GraphLane[];
  /** True when this is the stand-in. Renderers use it to drop labels and any
   *  affordance that would imply the pattern means something. */
  abstract: boolean;
};

/** Ring position for node `i` of `n`, rotated so the first node sits left of
 *  top — a node at exactly 12 o'clock reads as a title rather than as part of
 *  the ring. */
function ringPoint(i: number, n: number): { x: number; y: number } {
  const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2 + 0.35;
  return { x: Math.cos(a), y: Math.sin(a) };
}

/**
 * Build the graph from what the ledger published.
 *
 * Places are de-duplicated across origins and destinations — a hub that is the
 * origin of three lanes and the destination of two is ONE node, which is what
 * makes the picture a network rather than a list of pairs drawn twice.
 *
 * Ordered by weight before placement, so the busiest places land opposite each
 * other and the chords cross the middle. Placing them in arrival order gives a
 * ring whose long lanes are all short chords at one edge, which looks like a
 * bug.
 */
export function buildGraph(
  corridors: Corridor[],
  /** ISO codes the tenant's public entities sit in or cover — see
   *  `coveredCountries` in site-api.ts. Empty is the normal case. */
  covered: ReadonlySet<string> = new Set(),
): CorridorGraph {
  if (!corridors.length) return abstractGraph();

  const weights = new Map<string, number>();
  /* A place's country, taken from whichever corridor row mentions it. The
     endpoint publishes `origin_country`/`destination_country` as optional, so
     plenty of rows have neither — those places are simply never marked, which
     is the correct answer rather than a guess. */
  const country = new Map<string, string>();
  const note = (place: string, code?: string | null) => {
    if (code && !country.has(place)) country.set(place, code.toUpperCase());
  };
  for (const c of corridors) {
    weights.set(c.origin, (weights.get(c.origin) || 0) + c.files);
    weights.set(c.destination, (weights.get(c.destination) || 0) + c.files);
    note(c.origin, c.origin_country);
    note(c.destination, c.destination_country);
  }

  const order = [...weights.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  const index = new Map(order.map((name, i) => [name, i]));

  const nodes: GraphNode[] = order.map((name, i) => {
    const code = country.get(name);
    return {
      id: name,
      label: name,
      weight: weights.get(name) || 0,
      present: Boolean(code && covered.has(code)),
      ...ringPoint(i, order.length),
    };
  });

  const busiest = Math.max(...corridors.map((c) => c.files), 1);
  const lanes: GraphLane[] = corridors.map((c) => ({
    from: index.get(c.origin) ?? 0,
    to: index.get(c.destination) ?? 0,
    mode: c.mode,
    weight: c.files,
    strength: Math.min(c.files / busiest, 1),
  }));

  return { nodes, lanes, abstract: false };
}

/**
 * The stand-in, for a tenant whose ledger has nothing to publish yet.
 *
 * Seven nodes, a fixed chord pattern, no labels and no weights. It is
 * deliberately regular — a network that looked irregular would look like
 * DATA — so a reader sees an ornament, which is what it is. §7.5: "abstract by
 * design … it must never imply lanes the tenant does not run."
 */
export function abstractGraph(): CorridorGraph {
  const n = 7;
  const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    label: null,
    weight: 0,
    // Nothing in the ornament is a place, so nothing in it can be one the
    // tenant is present in.
    present: false,
    ...ringPoint(i, n),
  }));
  // Every node to the one two and three places around: a regular pattern that
  // reads as geometry rather than as a route map.
  const modes: Corridor["mode"][] = ["SEA", "AIR", "LAND", "OTHER"];
  const lanes: GraphLane[] = [];
  for (let i = 0; i < n; i++) {
    for (const step of [2, 3]) {
      const to = (i + step) % n;
      if (to > i) {
        lanes.push({
          from: i,
          to,
          mode: modes[(i + step) % modes.length],
          weight: 0,
          strength: 0.5,
        });
      }
    }
  }
  return { nodes, lanes, abstract: true };
}

/** The `--mode-*` token a lane paints with. `OTHER` makes no transport claim,
 *  so it gets no transport colour — the same rule `MODE_ACCENT` states. */
export function laneToken(mode: Corridor["mode"]): string | null {
  if (mode === "SEA") return "--mode-sea";
  if (mode === "AIR") return "--mode-air";
  if (mode === "LAND") return "--mode-road";
  return null;
}

/**
 * A lane's quadratic control point: pulled toward the ring's centre in
 * proportion to how far apart its ends are.
 *
 * A straight chord across a ring reads as a chord. Bowing it toward the middle
 * is what makes a set of them read as traffic through a hub, and scaling the
 * bow by span keeps short hops nearly straight — otherwise neighbouring nodes
 * are joined by a loop that dives through the centre for no reason.
 */
export function laneControl(a: GraphNode, b: GraphNode): { x: number; y: number } {
  const span = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  const pull = 0.15 + span * 0.55;
  return { x: (a.x + b.x) * (1 - pull) * 0.5, y: (a.y + b.y) * (1 - pull) * 0.5 };
}
