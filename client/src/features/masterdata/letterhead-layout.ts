/**
 * Rearranging a letterhead — the pure half of the studio's drag and arrows.
 *
 * Meeting 5 (21 Sep 2026): the bank block could not be moved down. Two causes,
 * both fixed here and on the server (`letterhead-blocks.mergeLayout`):
 *
 *   1. Blocks that share a row AND a column stack in one cell, and the stack
 *      was ordered by the catalogue alone. Every footer block sits in the
 *      footer's one cell by default, so dragging the payment block onto that
 *      cell "moved" it to where it already was. Placements now carry `order`,
 *      the block's place in its stack.
 *   2. A block's zone was the catalogue's. Dropping it on the header wrote a
 *      row number and left it in the footer. Placements now live in whichever
 *      zone's list carries them.
 *
 * Every function returns the FULL layout, never a patch: the server merges
 * what arrives over its defaults, and a move that renumbers a whole stack is
 * not describable as one block's patch.
 */
import type * as api from "@/lib/masterdata-api";

export type Zone = "header" | "footer";
export type Layout = { version: 1; header: api.LetterheadPlacement[]; footer: api.LetterheadPlacement[] };
type P = api.LetterheadPlacement & { row: number; col: number; order: number };

const ZONES: Zone[] = ["header", "footer"];

/** The composed blocks as a saveable layout, stacks numbered 0..n top-down. */
export function layoutOf(comp: { header: api.LetterheadBlock[]; footer: api.LetterheadBlock[] }): Layout {
  const out: Layout = { version: 1, header: [], footer: [] };
  for (const zone of ZONES) {
    out[zone] = normalise(
      comp[zone].map((b, i) => ({
        id: b.id,
        row: b.row,
        col: b.col,
        span: b.span,
        align: b.align,
        size: b.size,
        weight: b.weight,
        tone: b.tone,
        transform: b.transform,
        visible: b.visible,
        order: b.order ?? i,
      })),
    );
  }
  return out;
}

const sorted = (list: P[]) =>
  [...list].sort((a, b) => a.row - b.row || a.col - b.col || a.order - b.order);

/** Renumber every cell's stack 0..n in its current order. */
function normalise(list: api.LetterheadPlacement[]): P[] {
  const s = sorted(list as P[]);
  const seen = new Map<string, number>();
  return s.map((p) => {
    const key = `${p.row}:${p.col}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return { ...p, order: n };
  });
}

function find(layout: Layout, id: string): { zone: Zone; p: P } | null {
  for (const zone of ZONES) {
    const p = (layout[zone] as P[]).find((x) => x.id === id);
    if (p) return { zone, p };
  }
  return null;
}

/**
 * Put block `id` in `zone` at (`row`, `col`), at position `index` of that
 * cell's stack (default: the bottom of it).
 */
export function moveBlock(
  layout: Layout,
  id: string,
  to: { zone: Zone; row: number; col: number; index?: number },
): Layout {
  const hit = find(layout, id);
  if (!hit) return layout;
  const out: Layout = {
    version: 1,
    header: (layout.header as P[]).filter((p) => p.id !== id),
    footer: (layout.footer as P[]).filter((p) => p.id !== id),
  };
  const target = normalise(out[to.zone]);
  const mates = target.filter((p) => p.row === to.row && p.col === to.col);
  const index = Math.max(0, Math.min(to.index ?? mates.length, mates.length));
  // Open a gap at `index` by pushing the mates below it down one place.
  const shifted = target.map((p) =>
    p.row === to.row && p.col === to.col && p.order >= index ? { ...p, order: p.order + 1 } : p,
  );
  shifted.push({ ...hit.p, row: to.row, col: to.col, order: index });
  out[to.zone] = normalise(shifted);
  const other: Zone = to.zone === "header" ? "footer" : "header";
  out[other] = normalise(out[other]);
  return out;
}

/**
 * One step up (`-1`) or down (`+1`) the page — the keyboard path to what a drag
 * does, and the precise one.
 *
 *   inside a stack        swap with the neighbour
 *   top of its stack      to the row above (bottom of it); from the header's
 *                         top row, nowhere
 *   bottom of its stack   to a row of its own below; if it already is alone on
 *                         the zone's last row, across into the next zone
 *
 * So the payment block, pressed "down" enough times, walks down the footer; a
 * footer block pressed "up" from the top walks into the header.
 */
export function nudge(layout: Layout, id: string, dir: -1 | 1): Layout {
  const hit = find(layout, id);
  if (!hit) return layout;
  const { zone } = hit;
  const list = normalise(layout[zone]);
  const me = list.find((x) => x.id === id) as P;
  const stack = list.filter((x) => x.row === me.row && x.col === me.col);
  const pos = stack.findIndex((x) => x.id === id);

  if (dir === -1 && pos > 0) return moveBlock(layout, id, { zone, row: me.row, col: me.col, index: pos - 1 });
  if (dir === 1 && pos < stack.length - 1) return moveBlock(layout, id, { zone, row: me.row, col: me.col, index: pos + 1 });

  const rows = [...new Set(list.map((x) => x.row))].sort((a, b) => a - b);
  if (dir === -1) {
    const above = rows.filter((r) => r < me.row).pop();
    if (above !== undefined) return moveBlock(layout, id, { zone, row: above, col: me.col });
    if (zone === "footer") {
      const head = normalise(layout.header);
      const last = head.length ? Math.max(...head.map((x) => x.row)) : 0;
      return moveBlock(layout, id, { zone: "header", row: last, col: me.col });
    }
    return layout;
  }
  const alone = list.filter((x) => x.row === me.row).length === 1;
  const lastRow = rows[rows.length - 1];
  if (!(alone && me.row === lastRow)) {
    const below = rows.find((r) => r > me.row);
    // A row of its own directly below — or the next row down when this one is
    // already its own, so the block keeps moving rather than stalling.
    const row = alone && below !== undefined ? below : me.row + 1;
    return moveBlock(layout, id, { zone, row, col: me.col, index: 0 });
  }
  if (zone === "header") return moveBlock(layout, id, { zone: "footer", row: 0, col: me.col, index: 0 });
  return layout;
}

/** Apply a property patch to one block, wherever it lives. */
export function patchBlock(layout: Layout, id: string, patch: Partial<api.LetterheadPlacement>): Layout {
  const out: Layout = { version: 1, header: layout.header, footer: layout.footer };
  for (const zone of ZONES) {
    out[zone] = layout[zone].map((p) => (p.id === id ? { ...p, ...patch } : p));
  }
  return out;
}

/** Which zone a block is in, per the layout. */
export function zoneOf(layout: Layout, id: string): Zone | null {
  return find(layout, id)?.zone ?? null;
}
