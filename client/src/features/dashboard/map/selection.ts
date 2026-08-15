/**
 * Selection, focus order and marker clustering — pure functions, no React, no DOM.
 *
 * WHY THIS IS ITS OWN MODULE. Three behaviours the Control Tower gains here are
 * the kind that are only ever verified by looking at the screen, and then quietly
 * regress: which lanes belong to the file you clicked, what Tab and the arrow keys
 * do next, and whether forty ports at the mouth of one river collapse into one
 * marker or forty overlapping ones. Each is a decision with an argument behind it,
 * so each is a function with a test rather than a branch inside a renderer.
 *
 * `boundsOf` also lives here because both callers need it and must agree: the
 * projection fits the whole map with it, and selecting a file re-fits to that
 * file's lanes with it. Two copies of the same maths drifting apart is how a
 * "zoom to selection" ends up framing the wrong thing.
 */
import type { Lane } from "../model";

/** The file the operator has picked, by dossier id. `null` is "nothing picked",
 *  which is a real state and not a placeholder — the tower opens in it. */
export type Selection = string | null;

/* ── selection ───────────────────────────────────────────────────────────── */

/**
 * Clicking the selected file again clears the selection.
 *
 * A toggle rather than a one-way set, because the selected state DIMS every other
 * route: without a way back, an operator who clicks a lane to read it has no
 * obvious route to seeing the whole picture again, and the only recovery is a
 * page reload. Escape does the same thing; this is the mouse's version.
 */
export function nextSelection(current: Selection, clicked: string): Selection {
  return current === clicked ? null : clicked;
}

/** Every drawn segment belonging to one file, in itinerary order. */
export function lanesOfFile(lanes: Lane[], dossierId: Selection): Lane[] {
  if (!dossierId) return [];
  return lanes.filter((l) => l.dossierId === dossierId).sort((a, b) => a.seq - b.seq);
}

/**
 * Is this lane part of the selection?
 *
 * Selection is per FILE, not per leg, and that is deliberate. An operator clicks
 * the sea leg of an end-to-end file because they want that FILE — the truck that
 * has not collected yet is the thing they are about to ask about, and dimming it
 * because they happened to click a different segment would hide the answer.
 */
export const isSelected = (lane: Lane, selection: Selection): boolean =>
  selection !== null && lane.dossierId === selection;

/* ── keyboard order ──────────────────────────────────────────────────────── */

/**
 * The order the keyboard walks: one stop per FILE, not per leg.
 *
 * A file with five legs would otherwise take five presses to step over, so a
 * twelve-file map becomes forty presses wide and the keyboard stops being a way
 * to get anywhere. Ties break on the first lane's id so the order is total and
 * two renders of the same data always walk the same way.
 */
export function focusOrder(lanes: Lane[]): string[] {
  const seen = new Map<string, Lane>();
  lanes.forEach((l) => {
    const first = seen.get(l.dossierId);
    if (!first || l.seq < first.seq || (l.seq === first.seq && l.id < first.id)) seen.set(l.dossierId, l);
  });
  return [...seen.entries()]
    .sort(([, a], [, b]) => a.ref.localeCompare(b.ref) || a.id.localeCompare(b.id))
    .map(([dossierId]) => dossierId);
}

/**
 * Step the focus, wrapping at both ends.
 *
 * Wrapping rather than stopping: the map is a ring of routes, not a list with a
 * bottom, and a key that silently does nothing at the last item reads as broken.
 * From nothing selected, forward starts at the first and backward at the last.
 */
export function stepFocus(order: string[], current: Selection, delta: number): Selection {
  if (!order.length) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at === -1) return delta > 0 ? order[0] : order[order.length - 1];
  const next = (((at + delta) % order.length) + order.length) % order.length;
  return order[next];
}

/* ── geographic bounds ───────────────────────────────────────────────────── */

export type Bounds = { minLon: number; maxLon: number; minLat: number; maxLat: number };

/** The box every endpoint of these lanes fits in. Null for nothing to bound. */
export function boundsOf(lanes: Lane[]): Bounds | null {
  if (!lanes.length) return null;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const l of lanes) {
    for (const p of [l.from, l.to]) {
      if (p.lng < minLon) minLon = p.lng;
      if (p.lng > maxLon) maxLon = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }
  }
  return { minLon, maxLon, minLat, maxLat };
}

/* ── marker clustering ───────────────────────────────────────────────────── */

/** A projected point, before clustering. */
export type PlacedNode = {
  x: number;
  y: number;
  name: string;
  kind?: string | null;
  state?: string;
  /** Destinations are emphasised; origins are secondary. */
  emphasis: boolean;
};

export type ClusteredNode = PlacedNode & {
  /** How many places this marker stands for. 1 for an ordinary marker. */
  count: number;
  /** Every place folded into it, for the label and the tooltip. */
  names: string[];
};

/**
 * Collapse markers that land on top of each other.
 *
 * WHY IT IS NEEDED AT ALL. This product's network converges: Douala, Douala
 * Airport, Kribi and Limbe are four distinct places within a few degrees, and at
 * a whole-Atlantic zoom they project into the same forty pixels. With a hundred
 * files on screen that is a smear of overlapping dots and labels with no
 * readable name among them — the state the tower is unusable in, and the one a
 * meeting is most likely to hit.
 *
 * FIRST-WINS, NOT CENTROID. The surviving marker keeps the first node's exact
 * position rather than averaging the group, because an averaged pin sits in the
 * sea between two ports and points at neither. The first node is a real place;
 * the count says how many others are hidden behind it, and the names travel with
 * it so the tooltip can list them.
 *
 * Emphasis is sticky: if any member of a cluster is a destination, the cluster
 * is drawn as one, because a terminus disappearing into a waypoint is the wrong
 * way round to lose information.
 */
export function clusterNodes(nodes: PlacedNode[], radiusPx: number): ClusteredNode[] {
  const out: ClusteredNode[] = [];
  for (const node of nodes) {
    const near = out.find(
      (c) => Math.abs(c.x - node.x) <= radiusPx && Math.abs(c.y - node.y) <= radiusPx,
    );
    if (!near) {
      out.push({ ...node, count: 1, names: [node.name] });
      continue;
    }
    near.count += 1;
    if (!near.names.includes(node.name)) near.names.push(node.name);
    if (node.emphasis) near.emphasis = true;
  }
  return out;
}

/**
 * Nudge a label clear of one already placed.
 *
 * Lifted out of the projection so the rule is testable: ports cluster, two
 * overlapping names are less useful than one moved thirteen pixels, and the
 * alternation up-then-down is what makes a run of near-coincident labels fan out
 * instead of drifting one way off the edge.
 */
export function labelOffset(
  placed: { x: number; y: number; dy: number }[],
  x: number,
  y: number,
): number {
  let dy = 0;
  for (let guard = 0; guard < 6; guard += 1) {
    const clash = placed.some((n) => Math.abs(n.x - x) < 84 && Math.abs(n.y + n.dy - (y + dy)) < 13);
    if (!clash) break;
    dy = dy <= 0 ? -dy + 13 : -dy;
  }
  return dy;
}
