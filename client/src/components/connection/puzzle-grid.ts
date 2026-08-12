/**
 * The Supply Chain Connection board — generation, rotation and connectivity.
 *
 * Split from the component so the invariant that matters can be tested
 * directly: EVERY generated board is solvable, and NO board starts solved. An
 * unwinnable puzzle would turn the distraction back into the frustration it was
 * meant to relieve, and it is precisely the defect that only surfaces on the one
 * random seed nobody tried by hand — so it is asserted against this module
 * rather than approximated through the rendered DOM.
 *
 * Keeping it here also keeps `supply-chain-puzzle.tsx` a file that exports only
 * components, which is what Fast Refresh needs to hot-reload the board without
 * remounting it.
 */
/* ── Directions as a bitmask ────────────────────────────────────────────────
 * N=1 E=2 S=4 W=8. A tile IS its mask; rotating 90° clockwise is a bit rotate,
 * which is why there is no per-shape rotation table anywhere below.
 */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export type Mask = number;

const rotateMask = (m: Mask, quarters: number): Mask => {
  const q = ((quarters % 4) + 4) % 4;
  return ((m << q) | (m >> (4 - q))) & 0b1111;
};

/** Row/column delta and the opposite bit, for the connectivity walk. */
const DIRS: Array<{ bit: Mask; dr: number; dc: number; opposite: Mask }> = [
  { bit: N, dr: -1, dc: 0, opposite: S },
  { bit: E, dr: 0, dc: 1, opposite: W },
  { bit: S, dr: 1, dc: 0, opposite: N },
  { bit: W, dr: 0, dc: -1, opposite: E },
];

export type Cell = {
  /** The canonical shape, before rotation. */
  base: Mask;
  /** Quarter-turns applied by the player. Drives both logic and the transform. */
  rot: number;
  /** Endpoints do not turn — the warehouse door faces where it faces. */
  locked: boolean;
};

export type Grid = Cell[][];

export const SIZE = 4;
const maskOf = (c: Cell): Mask => rotateMask(c.base, c.rot);

/* ── Generation ────────────────────────────────────────────────────────────*/

/**
 * A self-avoiding random walk from the warehouse to the truck.
 *
 * Randomised depth-first search rather than a straight line, so the route bends
 * differently every time — a puzzle whose answer is "rotate everything on the
 * diagonal" is solved once and never again. It always finds a path (the grid is
 * small and fully connected), but the iteration cap is kept as a guard against
 * a future SIZE change turning this into a visible pause.
 */
function randomPath(): Array<[number, number]> {
  const start: [number, number] = [0, 0];
  const goal: [number, number] = [SIZE - 1, SIZE - 1];
  const seen = new Set<string>();
  const path: Array<[number, number]> = [];
  let steps = 0;

  const walk = (r: number, c: number): boolean => {
    if (steps++ > 5_000) return false;
    seen.add(`${r},${c}`);
    path.push([r, c]);
    if (r === goal[0] && c === goal[1]) return true;

    // Shuffled, but nudged toward the goal so the route stays a route rather
    // than a maze that fills the whole board.
    const options = [...DIRS].sort(() => Math.random() - 0.6);
    for (const d of options) {
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (nr < 0 || nc < 0 || nr >= SIZE || nc >= SIZE) continue;
      if (seen.has(`${nr},${nc}`)) continue;
      if (walk(nr, nc)) return true;
    }
    path.pop();
    return false;
  };

  walk(start[0], start[1]);
  return path;
}

/** Which way you must leave `a` to arrive at `b`. */
function bearing(a: [number, number], b: [number, number]): Mask {
  if (b[0] === a[0] - 1) return N;
  if (b[0] === a[0] + 1) return S;
  if (b[1] === a[1] + 1) return E;
  return W;
}

const DECOYS: Mask[] = [N | S, N | E, N | E | S, N | S, N | E];

export function buildGrid(): Grid {
  const path = randomPath();
  const onPath = new Map<string, Mask>();

  path.forEach(([r, c], i) => {
    let mask = 0;
    if (i > 0) mask |= bearing([r, c], path[i - 1]);
    if (i < path.length - 1) mask |= bearing([r, c], path[i + 1]);
    onPath.set(`${r},${c}`, mask);
  });

  const grid: Grid = [];
  for (let r = 0; r < SIZE; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < SIZE; c++) {
      const base =
        onPath.get(`${r},${c}`) ??
        DECOYS[Math.floor(Math.random() * DECOYS.length)];
      const isEndpoint =
        (r === 0 && c === 0) || (r === SIZE - 1 && c === SIZE - 1);
      row.push({
        base,
        // Endpoints keep the orientation the route needs; everything else is
        // scrambled. Scrambling the endpoints too would mean the warehouse door
        // moves between puzzles, and the two fixed points are what make the
        // board readable at a glance.
        rot: isEndpoint ? 0 : Math.floor(Math.random() * 4),
        locked: isEndpoint,
      });
    }
    grid.push(row);
  }
  return grid;
}

/** Cells currently fed from the warehouse — the "flow", and the win condition. */
export function connectedFromSource(grid: Grid): Set<string> {
  const seen = new Set<string>(["0,0"]);
  const queue: Array<[number, number]> = [[0, 0]];

  while (queue.length) {
    const [r, c] = queue.shift() as [number, number];
    const mask = maskOf(grid[r][c]);
    for (const d of DIRS) {
      if (!(mask & d.bit)) continue;
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (nr < 0 || nc < 0 || nr >= SIZE || nc >= SIZE) continue;
      const key = `${nr},${nc}`;
      if (seen.has(key)) continue;
      // Both halves must agree: a pipe pointing at a wall is not a connection.
      if (!(maskOf(grid[nr][nc]) & d.opposite)) continue;
      seen.add(key);
      queue.push([nr, nc]);
    }
  }
  return seen;
}

export const isSolved = (flow: Set<string>) =>
  flow.has(`${SIZE - 1},${SIZE - 1}`);

/** A fresh board that is not already finished. */
export function freshGrid(): Grid {
  for (let i = 0; i < 24; i++) {
    const g = buildGrid();
    if (!isSolved(connectedFromSource(g))) return g;
  }
  return buildGrid();
}
