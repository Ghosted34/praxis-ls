/**
 * Place presentation logic — pure functions over an API payload, no React.
 *
 * Split from the components that render it for the same reason the Control
 * Tower's `model.ts` is split from its map: this is where the decisions live —
 * which code an operator recognises, what "verified" means, which facts make two
 * same-named places distinguishable — and decisions want tests, not a renderer.
 */
import type { GeoPlace, PlaceSuggestion } from "@/lib/operations-api";

/* ── verification ────────────────────────────────────────────────────────── */

/**
 * FOUR STATES, and the distinction between the middle two is the whole point of
 * this feature:
 *
 *   verified    somebody confirmed this place — catalogue, a provider result they
 *               picked, or hand entry. The normal, quiet state.
 *   reference   verified, but explicitly NOT the exact spot: a point nearby that
 *               the operator agreed to use because the real address is not
 *               mappable. Honest rather than precise.
 *   unverified  a coordinate exists but nobody ever looked at it — the
 *               background-geocode population. Actionable: offer an upgrade.
 *   unknown     no place record at all. Legacy free text, or nothing.
 */
export type VerificationState = "verified" | "reference" | "unverified" | "unknown";

export function verificationOf(place: GeoPlace | null | undefined): VerificationState {
  if (!place) return "unknown";
  if (place.is_reference_point) return "reference";
  return place.verified_at ? "verified" : "unverified";
}

/** The label, and the sentence that explains it. Tone never carries the meaning
 *  on its own (WCAG §1.4.1), so every state ships its own word. */
export const VERIFICATION_COPY: Record<VerificationState, { label: string; hint: string }> = {
  verified: {
    label: "Verified",
    hint: "This place is in the catalogue with a confirmed coordinate.",
  },
  reference: {
    label: "Reference point",
    hint: "A verified point near the real address, agreed as a stand-in for the map. Delivery instructions on the file still describe the exact spot.",
  },
  unverified: {
    label: "Unverified",
    hint: "A coordinate was resolved automatically and nobody has confirmed it. Open the place search to check or replace it.",
  },
  unknown: {
    label: "No place record",
    hint: "This is text only — it is not linked to a place, so it cannot be mapped. Pick a place to fix that.",
  },
};

/* ── identity ────────────────────────────────────────────────────────────── */

/**
 * The code an operator would recognise.
 *
 * UN/LOCODE where the place has one. Otherwise the IATA code, which airport rows
 * carry at the head of `formatted` ("NBO · Nairobi Jomo Kenyatta airport,
 * Nairobi") because UN/LOCODE codes the LOCALITY and so cannot distinguish a
 * city's port from its airport — see migration 0675, which is why the two codes
 * live in two columns.
 */
export function codeOf(place: Pick<GeoPlace, "unlocode" | "formatted">): string | null {
  if (place.unlocode) return place.unlocode;
  const head = String(place.formatted || "").split("·")[0].trim();
  return /^[A-Z]{3}$/.test(head) ? head : null;
}

/** The address line, minus the code prefix a badge already shows. */
export function addressOf(place: Pick<GeoPlace, "formatted">): string | null {
  const raw = String(place.formatted || "").trim();
  if (!raw) return null;
  const parts = raw.split("·");
  return (parts.length > 1 ? parts.slice(1).join("·") : raw).trim() || null;
}

/**
 * The facts one row shows.
 *
 * A catalogue place and a provider suggestion reduce to the SAME shape before
 * rendering, so the two can never drift apart visually — which matters because
 * they sit in one list and the operator is comparing them.
 */
export type PlaceMeta = {
  name: string;
  code: string | null;
  kind?: string | null;
  country?: string | null;
  region?: string | null;
  address: string | null;
  isReferencePoint: boolean;
  unverified: boolean;
  /** Provider confidence, 0..1. Only suggestions have one. */
  confidence: number | null;
};

export function metaOfPlace(place: GeoPlace): PlaceMeta {
  return {
    name: place.name,
    code: codeOf(place),
    kind: place.kind,
    country: place.country,
    region: place.region,
    address: addressOf(place),
    isReferencePoint: place.is_reference_point === true,
    unverified: !place.verified_at,
    confidence: null,
  };
}

export function metaOfSuggestion(s: PlaceSuggestion): PlaceMeta {
  return {
    name: s.name,
    code: null,
    kind: s.kind,
    country: s.country,
    region: s.region,
    address: s.formatted || null,
    isReferencePoint: false,
    unverified: false,
    confidence: typeof s.confidence === "number" ? s.confidence : null,
  };
}

/* ── matching a stored value to a place ──────────────────────────────────── */

/**
 * The same folding `geo_place.query_key` is built from (see
 * `geo_place.repo.normalise`): strip accents, drop apostrophes, collapse
 * everything else to single spaces, lowercase.
 *
 * DUPLICATED ON PURPOSE, and this is the one place in the feature where that is
 * true. The client needs it to decide whether the name a dossier stores IS the
 * place a search returned — a question asked before any request, to answer from
 * cache. Shipping it as a shared package for one twelve-line function would cost
 * more than the duplication; the tests assert the two agree on the cases that
 * motivated the original (Yaoundé, N'Djamena, trailing space, mixed case).
 */
export function placeKey(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['‘’`]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

/** The place in `places` that IS `value`, or null. Exact identity after folding —
 *  never a "close enough" match, which is the failure mode being removed. */
export function matchStoredValue(value: string, places: GeoPlace[]): GeoPlace | null {
  const key = placeKey(value);
  if (!key) return null;
  return places.find((p) => placeKey(p.name) === key) || null;
}
