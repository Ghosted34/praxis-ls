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

export type TrackingResult = {
  reference: string;
  computed_status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
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
