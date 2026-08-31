/**
 * Corridors — `GET /api/tenant/public/corridors`.
 *
 * Lanes the tenant has actually run, aggregated server-side from the itinerary
 * ledger. Nobody authors these; there is no draft state, no publish switch and
 * no copy to review, which is what makes them safe to show on a page that has
 * no case notes yet.
 *
 * The endpoint applies a k-anonymity floor before it answers (at least five
 * distinct files, across at least three distinct clients, inside a trailing
 * 24-month window), so an empty array here is the NORMAL answer for a young
 * tenant and not an error. The caller renders the drawn panel in that case; it
 * must never fill the gap with something of its own.
 *
 * `mode` is the leg's own enum, so the marketing site can paint a lane in the
 * same `--mode-*` token the Control Tower map uses for the same fact.
 */
import { publicGet } from "./api";

export type Corridor = {
  origin: string;
  origin_country?: string | null;
  destination: string;
  destination_country?: string | null;
  mode: "AIR" | "SEA" | "LAND" | "OTHER";
  /** Distinct completed files on this lane inside the window. */
  files: number;
};

/** The brand's four transport colours, keyed by the ledger's own enum. `OTHER`
 *  has no transport colour because it makes no transport claim — it falls back
 *  to the neutral ink the rest of the card uses. */
export const MODE_ACCENT: Record<Corridor["mode"], "sea" | "air" | "road" | null> = {
  SEA: "sea",
  AIR: "air",
  LAND: "road",
  OTHER: null,
};

export const listCorridors = () => publicGet<Corridor[]>("/public/corridors");
