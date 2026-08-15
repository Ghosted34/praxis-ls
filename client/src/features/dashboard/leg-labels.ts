/**
 * Human labels for the itinerary vocabulary.
 *
 * In its own module because five surfaces name a leg — the map's hover card, the
 * itinerary panel, the editor, the activity list and the meeting view — and a
 * SCREAMING_ENUM must never reach a screen (FRONTEND_GUIDE §5). One table, so
 * "Main carriage" cannot become "Main Carriage" in one of the five.
 */

/** Mirrors `dossier_itinerary_leg.leg_type` (0672). */
export const LEG_TYPE_LABEL: Record<string, string> = {
  PICKUP: "Pickup",
  MAIN_CARRIAGE: "Main carriage",
  CUSTOMS: "Customs",
  INLAND_TRANSIT: "Inland transit",
  WAREHOUSE: "Warehouse",
  FINAL_DELIVERY: "Final delivery",
  OTHER: "Other",
};

/** Mirrors `dossier_itinerary_leg.status`. */
export const LEG_STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  BLOCKED: "Blocked",
  CANCELLED: "Cancelled",
};

/**
 * The legs that happen AT a place rather than between two.
 *
 * A customs clearance and a warehouse custody period have one location, so the
 * editor stops asking for a destination and the validator stops requiring one —
 * demanding a second point would be asking an operator to invent data. Kept in
 * step with `SINGLE_POINT_LEGS` in `itinerary.service.js`.
 */
export const SINGLE_POINT_LEGS = new Set(["CUSTOMS", "WAREHOUSE", "OTHER"]);
