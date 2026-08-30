/**
 * Shipment tracking — `GET /api/tenant/public/tracking/:reference`.
 *
 * The endpoint is anonymous, pinned to LIVE, and rate-limited to 30 lookups per
 * 15 minutes per connection (`tracking_public.routes.js`). Two consequences the
 * UI has to carry:
 *
 *   · The reference is EXACT. There is no fuzzy search and no partial match, so
 *     "not found" is the honest answer and must not be dressed up as a server
 *     error — nor softened into a list of near-misses the tenant never approved.
 *   · An office behind one NAT address shares that 30. A "too many attempts"
 *     message has to be distinguishable from "no such shipment", or the twelfth
 *     colleague of the day concludes their cargo has vanished.
 *
 * The milestones are the CLIENT-VISIBLE set (`public_state`), not the internal
 * stage list — a stranger never sees a hold, an inspection note or an internal
 * exception, and this app must not invent a way to infer them from gaps.
 */
import { publicGet } from "./api";

export type PublicMilestone = {
  code: string;
  label: string;
  public_state: "COMPLETED" | "CURRENT" | "UPCOMING";
  is_complete: boolean;
  is_current: boolean;
  due_date: string | null;
  completed_at: string | null;
  location: string | null;
  stage_reference: string | null;
  progress_note: string | null;
};

/**
 * The service type behind the file, as the API sends it.
 *
 * Both names, unresolved: the visitor's language changes without a request, and
 * a server that picked one would make the language toggle refetch the page to
 * change a single word. `mode` is derived from the key server-side so the icon
 * and the origin/destination labels cannot disagree about what kind of shipment
 * this is — the browser does not re-guess it.
 *
 * Null on a file the desk has opened and not yet classified.
 */
export type PublicServiceType = {
  key: string;
  name_fr: string | null;
  name_en: string | null;
  mode: "SEA" | "AIR" | "RAIL" | "ROAD" | "WAREHOUSE" | "CUSTOMS" | "OTHER";
};

export type TrackingResult = {
  reference: string;
  computed_status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  service_type: PublicServiceType | null;
  /**
   * The latest milestone completion — NOT `dossier.updated_at`.
   *
   * The distinction is the whole value of the field: the dossier's timestamp
   * moves when anyone edits the file, so a corrected internal note would tell a
   * visitor their cargo had progressed. Null while nothing has completed, and
   * the page says so rather than printing the file's creation date under a
   * heading that reads "last update".
   */
  last_update: string | null;
  current_stage: PublicMilestone | null;
  origin: string | null;
  destination: string | null;
  progress: { completed: number; total: number; percent: number };
  milestones: PublicMilestone[];
};

export const trackShipment = (reference: string) =>
  publicGet<TrackingResult>(
    `/public/tracking/${encodeURIComponent(reference.trim())}`,
  );
