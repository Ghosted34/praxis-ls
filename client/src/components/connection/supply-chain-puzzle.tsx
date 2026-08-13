/**
 * Supply Chain Connection — the puzzle shown while the app cannot reach the
 * server.
 *
 * WHY A GAME AT ALL. Chrome's dinosaur is the reference, and the reason it
 * works is not that it is fun: it is that it converts dead time into something
 * with a visible end state, so a wait that feels indefinite feels finite. This
 * is the logistics version of the same trick — rotate the road and rail tiles
 * until the warehouse has a clear route to the truck.
 *
 * IT IS OPT-IN, AND THAT IS A PRODUCT DECISION, NOT A HEDGE. This is a system
 * of record; a CFO looking at why the entity register will not load should not
 * be met by a game they did not ask for. So `ConnectionLost` shows the status
 * and the retry, and offers this behind a link that remembers the answer. The
 * people who want it get it every time, the people who do not never see it
 * twice.
 *
 * NO DEPENDENCIES, NO CANVAS, NO IMAGES. One inline SVG per tile and a CSS
 * transform for the rotation, which is what keeps this affordable in a bundle
 * that has a size gate (`npm run check:bundle`) — and, more to the point, it is
 * loaded from the app shell the service worker already cached, so it works when
 * nothing else does. A puzzle that needed to fetch anything would be broken in
 * exactly the situation it exists for.
 *
 * EVERY PUZZLE IS SOLVABLE BY CONSTRUCTION. The generator lays a random walk
 * from the warehouse to the truck FIRST and derives the tiles from it, then
 * scrambles the rotations. There is no solver and no difficulty tuning, and no
 * possibility of an unwinnable board — the thing that would turn the
 * distraction back into a frustration.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  N,
  E,
  S,
  W,
  SIZE,
  type Mask,
  type Grid,
  freshGrid,
  connectedFromSource,
  isSolved,
} from "./puzzle-grid";

/* ── Tile art ──────────────────────────────────────────────────────────────*/

/**
 * One tile: a stub from the centre toward each connected edge.
 *
 * Drawn from the CANONICAL mask and turned with a CSS transform, so the
 * rotation animates and the geometry stays one code path. `currentColor`
 * throughout — the live/idle colour is set by the wrapper's text colour, which
 * is what keeps this inside the white-label palette rule (no raw colours).
 */
function TileArt({ mask, live }: { mask: Mask; live: boolean }) {
  const stubs: string[] = [];
  if (mask & N) stubs.push("M24 24 V2");
  if (mask & E) stubs.push("M24 24 H46");
  if (mask & S) stubs.push("M24 24 V46");
  if (mask & W) stubs.push("M24 24 H2");

  return (
    <svg
      viewBox="0 0 48 48"
      className="h-full w-full"
      aria-hidden
      focusable="false"
    >
      {/* The road bed: a wide, soft stroke. */}
      <g
        stroke="currentColor"
        strokeLinecap="round"
        fill="none"
        opacity={live ? 1 : 0.55}
      >
        <g strokeWidth={9}>
          {stubs.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        {/* Lane markings, only once the tile is carrying something — the visual
            difference between a road and a road in use. Painted in the card
            colour so they read as a gap in the road bed in either theme. */}
        {live && (
          <g
            strokeWidth={1.5}
            strokeDasharray="3 4"
            opacity={0.5}
            stroke="var(--card)"
          >
            {stubs.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        )}
      </g>
      {mask !== 0 && (
        <circle
          cx="24"
          cy="24"
          r={live ? 5 : 4}
          fill="currentColor"
          opacity={live ? 1 : 0.55}
        />
      )}
    </svg>
  );
}

const WarehouseGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M3 21V9l9-5 9 5v12" />
    <path d="M9 21v-6h6v6" />
  </svg>
);

const TruckGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M2 16V6h11v10" />
    <path d="M13 9h4l4 4v3h-8" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="18" r="2" />
  </svg>
);

const TrophyGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-6 w-6"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M8 21h8" />
    <path d="M12 17v4" />
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M17 5h3v2a3 3 0 0 1-3 3" />
    <path d="M7 5H4v2a3 3 0 0 0 3 3" />
  </svg>
);

/* ── The win ───────────────────────────────────────────────────────────────*/

/**
 * The celebration. The puzzle's whole job is to turn a wait into something with
 * an END STATE — so the end state has to feel like one. A solved board that
 * just recoloured green and swapped a button label read as "nothing happened";
 * this is the "you won it" the moment earns. It calls back to the door the user
 * came through — the "Beat the downtime →" link on `ConnectionLost` — and marks
 * a genuine improvement so a second, faster run is worth attempting.
 *
 * Enters with a short pop: mounted at rest, then flipped on the next frame so
 * the transition has two states to move between. 200ms sits inside the motion
 * budget (scripts/check-motion.mjs) and the reduced-motion umbrella (index.css)
 * drops it to an instant appearance.
 */
function WinBanner({
  moves,
  best,
  newBest,
  onNext,
}: {
  moves: number;
  best: number | null;
  newBest: boolean;
  onNext: () => void;
}) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-auto mt-4 flex max-w-reading flex-col items-center gap-1.5 rounded-xl border border-ok/40 bg-ok/10 p-4 text-center",
        "transition duration-200 ease-out motion-reduce:transition-none",
        shown ? "scale-100 opacity-100" : "scale-95 opacity-0",
      )}
    >
      <span className="grid h-11 w-11 place-items-center rounded-full bg-ok/15 text-ok">
        <TrophyGlyph />
      </span>
      <p className="text-title font-semibold text-ok">
        Delivered — you beat the downtime!
      </p>
      <p className="text-sm text-muted-foreground">
        You linked the warehouse to the truck in {moves}{" "}
        {moves === 1 ? "move" : "moves"}.
      </p>
      {newBest && best !== null && (
        <span className="mt-0.5 rounded-full border border-ok/40 bg-ok/15 px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-ok">
          New best · {best} {best === 1 ? "move" : "moves"}
        </span>
      )}
      <Button
        size="sm"
        variant="outline"
        icon={null}
        onClick={onNext}
        className="mt-2"
      >
        Next route →
      </Button>
    </div>
  );
}

/* ── The board ─────────────────────────────────────────────────────────────*/

export function SupplyChainPuzzle({ className }: { className?: string }) {
  const [grid, setGrid] = React.useState<Grid>(freshGrid);
  const [moves, setMoves] = React.useState(0);
  const [best, setBest] = React.useState<number | null>(null);
  const [newBest, setNewBest] = React.useState(false);
  const [focus, setFocus] = React.useState<[number, number]>([0, 1]);
  const cellRefs = React.useRef(new Map<string, HTMLButtonElement>());

  const flow = React.useMemo(() => connectedFromSource(grid), [grid]);
  const solved = isSolved(flow);

  // Recorded once per solve, not on every render the solved board survives.
  const scored = React.useRef(false);
  React.useEffect(() => {
    if (solved && !scored.current) {
      scored.current = true;
      // Beating a PREVIOUS best is the thing worth a badge; a first solve is not
      // "a new best", it is simply the first — so only flag a genuine improvement.
      setNewBest(best !== null && moves < best);
      setBest(best === null ? moves : Math.min(best, moves));
    }
  }, [solved, moves, best]);

  const rotate = (r: number, c: number) => {
    if (grid[r][c].locked || solved) return;
    setGrid((g) =>
      g.map((row, ri) =>
        row.map((cell, ci) =>
          ri === r && ci === c ? { ...cell, rot: cell.rot + 1 } : cell,
        ),
      ),
    );
    setMoves((m) => m + 1);
  };

  const reset = () => {
    scored.current = false;
    setNewBest(false);
    setGrid(freshGrid());
    setMoves(0);
  };

  /**
   * Roving focus. A 4×4 grid of buttons would otherwise put sixteen stops in
   * the tab order between the puzzle and the Retry button below it — which
   * would make the OPTIONAL distraction an obstacle for the keyboard user
   * trying to reach the thing that actually fixes their problem.
   */
  const onKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      const nr = Math.min(SIZE - 1, Math.max(0, r + dr));
      const nc = Math.min(SIZE - 1, Math.max(0, c + dc));
      setFocus([nr, nc]);
      cellRefs.current.get(`${nr},${nc}`)?.focus();
    };
    if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowLeft") move(0, -1);
    else if (e.key === "ArrowRight") move(0, 1);
  };

  return (
    <div className={cn("select-none", className)}>
      <div
        role="grid"
        aria-label="Supply chain connection puzzle. Rotate the tiles to link the warehouse to the truck."
        className="mx-auto grid w-fit grid-cols-4 gap-1.5 rounded-xl border bg-muted/30 p-2"
      >
        {grid.map((row, r) => (
          /**
           * `role="row"` is required — `gridcell` has no meaning without it and
           * axe fails the whole grid (aria-required-parent). `display: contents`
           * keeps the row out of the layout so the 4×4 CSS grid on the parent
           * still positions the tiles directly; a real wrapper box would put a
           * flex/grid row between them and break the board.
           */
          <div key={r} role="row" className="contents">
            {row.map((cell, c) => {
              const key = `${r},${c}`;
              const live = flow.has(key);
              const isSource = r === 0 && c === 0;
              const isSink = r === SIZE - 1 && c === SIZE - 1;
              const focused = focus[0] === r && focus[1] === c;

              return (
                <button
                  key={key}
                  ref={(el) => {
                    if (el) cellRefs.current.set(key, el);
                    else cellRefs.current.delete(key);
                  }}
                  type="button"
                  role="gridcell"
                  // Roving tabindex: exactly one cell is in the tab order.
                  tabIndex={focused ? 0 : -1}
                  disabled={cell.locked || solved}
                  onFocus={() => setFocus([r, c])}
                  onKeyDown={(e) => onKeyDown(e, r, c)}
                  onClick={() => rotate(r, c)}
                  aria-label={
                    isSource
                      ? "Warehouse"
                      : isSink
                        ? "Delivery truck"
                        : `Tile row ${r + 1}, column ${c + 1}. ${live ? "Connected." : "Not connected."} Press Enter to rotate.`
                  }
                  className={cn(
                    "relative grid h-12 w-12 place-items-center rounded-lg border transition-colors sm:h-14 sm:w-14",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    live
                      ? "border-ok/40 bg-ok/10 text-ok"
                      : "border-border/60 bg-card text-muted-foreground",
                    !cell.locked &&
                      !solved &&
                      "hover:border-brand-blue/50 cursor-pointer",
                    cell.locked && "cursor-default",
                  )}
                >
                  {/* 180ms sits inside the 250ms motion budget the gate enforces
                    (scripts/check-motion.mjs) and is fast enough that a run of
                    quick taps never queues up behind its own animation. */}
                  <span
                    className="block h-full w-full p-0.5 transition-transform duration-[180ms] ease-out motion-reduce:transition-none"
                    style={{ transform: `rotate(${cell.rot * 90}deg)` }}
                  >
                    <TileArt mask={cell.base} live={live} />
                  </span>

                  {(isSource || isSink) && (
                    <span
                      className={cn(
                        "pointer-events-none absolute grid h-7 w-7 place-items-center rounded-md",
                        live ? "bg-ok text-card" : "bg-muted text-foreground",
                      )}
                    >
                      {isSource ? <WarehouseGlyph /> : <TruckGlyph />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* The solve is celebrated, not just drawn — and still announced, the same
          live-region rule the rest of the app follows for async outcomes (F13).
          Until then the counter carries the move tally and the reshuffle. */}
      {solved ? (
        <WinBanner moves={moves} best={best} newBest={newBest} onNext={reset} />
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
          <p role="status" aria-live="polite" className="font-medium text-muted-foreground">
            {moves} {moves === 1 ? "move" : "moves"}
          </p>
          {best !== null && (
            <p className="text-micro text-muted-foreground">Best: {best}</p>
          )}
          <Button size="sm" variant="outline" icon={null} onClick={reset}>
            New route
          </Button>
        </div>
      )}
    </div>
  );
}
