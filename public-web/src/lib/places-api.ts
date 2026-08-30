/**
 * Place search — `GET /api/tenant/public/places`.
 *
 * ── WHY THIS ENDPOINT EXISTS AT ALL ────────────────────────────────────────
 *
 * smartls.cm's wizard calls `photon.komoot.io` straight from the browser: an
 * unkeyed public instance, every keystroke of a prospect's route sent to a third
 * party, and — the part that makes it pointless as well as leaky — it never
 * submits the coordinates it captures. The desk receives a text string either
 * way.
 *
 * Resolved decision 4: we use our own. `src/services/geoapify.service.js` is
 * already keyed and cached for the operations side, and this is a public,
 * rate-limited wrapper on it. Nothing about the tenant's own place catalogue is
 * reachable through it — that holds customer doors.
 *
 * ── WHAT THE BROWSER MAY SEND BACK ─────────────────────────────────────────
 *
 * The `provider_place_id` and the text that produced it. NOT the coordinates it
 * was shown. The server re-asks the provider on submit and takes ITS answer, so
 * a page that posted a coordinate would be posting a claim nobody could check.
 * The lat/lng below are for drawing a pin while the visitor is still choosing.
 */
import { publicGet } from "./api";

export type PlaceCandidate = {
  provider_place_id: string;
  name: string | null;
  formatted: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  kind: string | null;
};

/**
 * Three answers, and the two that are not `OK` are both content states.
 *
 * `UNAVAILABLE` covers everything from a missing key to an exhausted quota,
 * collapsed server-side on purpose — each of those is a sentence about our
 * configuration and a visitor can act on none of them. To the wizard they mean
 * one thing: stop offering suggestions, keep taking text.
 */
export type PlaceSearchResult = {
  status: "OK" | "TOO_SHORT" | "UNAVAILABLE";
  results: PlaceCandidate[];
};

export const searchPlaces = (q: string, opts: { country?: string; signal?: AbortSignal } = {}) =>
  publicGet<PlaceSearchResult>("/public/places", {
    query: { q: q.trim(), country: opts.country },
    signal: opts.signal,
  });

/** What travels back to the intake endpoint. Deliberately not the coordinates. */
export type PlacePick = {
  provider_place_id: string;
  query: string;
  country?: string;
};

/** The line a person reads in the list, and the one that goes in the input. */
export const placeLabel = (c: PlaceCandidate): string =>
  c.formatted || c.name || "";
