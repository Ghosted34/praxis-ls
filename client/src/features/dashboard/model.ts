/**
 * Control Tower — the pure model layer.
 *
 * Everything here is a plain function over the API payload: no React, no DOM,
 * no fetching. That is the point. In the iframe build (audit F1) this logic was
 * interleaved with string-concatenated HTML inside a `<script>` the parent
 * generated, so none of it could be tested, and a mistake in the mode heuristic
 * or the ETA formatting was only visible by looking at the rendered frame.
 *
 * The derivations themselves are carried over deliberately unchanged — they
 * encode real decisions about this domain (see `shipmentMode`) and the audit is
 * explicit that the Control Tower's information design is good work that must
 * survive the rehousing.
 */
import { dateFmt, enumLabel } from "@/lib/format";
import type { Tone } from "@/components/ui/pill";

export type Row = Record<string, unknown>;

export const str = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v);
export const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Transport mode, which drives the map lane styling and the row's icon.
 *
 * `other` is new, and it is the honest answer for the three service types that
 * move nothing: warehousing, customs brokerage, business representation. The
 * previous vocabulary had no slot for them, so `shipmentMode` fell through to
 * "sea" — and a storage file with a port name somewhere in it was drawn as a
 * shipping lane on the screen a Monday meeting runs off. Those files now render
 * as facility activity instead of as a fabricated route.
 */
export type ShipmentMode = "sea" | "road" | "air" | "rail" | "other";

/** The server's mode vocabulary → ours. The server derives it from the
 *  itinerary's main carriage, falling back to the service-type key, so this is a
 *  rename rather than a second heuristic. */
const MODE_FROM_SERVER: Record<string, ShipmentMode> = {
  SEA: "sea",
  AIR: "air",
  LAND: "road",
  RAIL: "rail",
  OTHER: "other",
};

/**
 * Mode for a live shipment.
 *
 * The dossier's `service_type.key` is the authoritative answer and is tried
 * first. Text sniffing is a fallback for dossiers with no service type, and it
 * is known to be wrong for HINTERLAND_TRANSIT — no vessel, two ordinary city
 * names, so it falls through to the "sea" default and the Douala→N'Djamena
 * corridor was drawn as a shipping lane. That is exactly why the key wins.
 */
export function shipmentMode(
  s: Row,
  vessel: string,
  lane: string,
): ShipmentMode {
  // The server's own answer wins outright when it is there. It is derived from
  // the file's itinerary — the main carriage's actual mode — which is the only
  // source that gets PROJECT_CARGO right: the key heuristic below had to put it
  // somewhere, chose the road corridors, and so drew a chartered vessel as a
  // truck. Everything after this line is the fallback for a payload that predates
  // the derivation.
  const fromServer = MODE_FROM_SERVER[str(s.mode).toUpperCase()];
  if (fromServer) return fromServer;
  const key = str(s.service_key).toUpperCase();
  if (/WAREHOUS|CUSTOMS_BROKERAGE|BUSINESS_REPRESENTATION/.test(key))
    return "other";
  if (/AIR/.test(key)) return "air";
  if (/RAIL|TRAIN|FERROVIAIRE/.test(key)) return "rail";
  if (/ROAD|TRANSIT|HINTERLAND|TRUCK|INLAND/.test(key)) return "road";
  if (/SEA|OCEAN|MARITIME/.test(key)) return "sea";
  if (/air|flight|mawb|cdg|airport/i.test(`${vessel} ${lane}`)) return "air";
  if (/rail|train|wagon|camrail|gare/i.test(`${str(s.service ?? s.mode)} ${vessel} ${lane}`))
    return "rail";
  if (
    /road|truck|corridor|transit/i.test(`${str(s.service ?? s.mode)} ${lane}`)
  )
    return "road";
  return "sea";
}

/**
 * Pill tone for a free-text or enum shipment status.
 *
 * Deliberately NOT `pill.statusTone`: that map is keyed on the generic
 * lifecycle vocabulary (NEW / WON / REJECTED) and knows nothing about "At
 * berth", "Clearing" or "In transit". Dossier status here is operational
 * language, so it is matched on meaning, as the iframe's `statusClass` did.
 */
export function shipmentTone(status: string): Tone {
  const s = status.toLowerCase();
  if (/await|approv|pending/.test(s)) return "orange";
  if (/transit|progress|port|clear|berth|road|moving/.test(s)) return "blue";
  if (/deliver|complete|closed|paid|done|arrived|departed/.test(s)) return "ok";
  if (/overdue|risk|hold|block|late/.test(s)) return "warn";
  return "mute";
}

export type LiveShipment = {
  /** The file's real key. `ref` is a display string — two tenants can spell one
   *  the same way, and the previous tower keyed its deep links on it. */
  dossierId: string;
  ref: string;
  /** The service type's own name, for the activity list and the hover card. */
  serviceName: string;
  /** Does this file MOVE something, or record work at a place? Server-derived. */
  isMovement: boolean;
  /** Any endpoint present but unverified, so it must not be drawn as a route. */
  needsLocation: boolean;
  mode: ShipmentMode;
  from: string;
  to: string;
  status: string;
  tone: Tone;
  /** Milestone label, or the vessel/flight when no milestone chain exists. */
  stage: string;
  eta: string;
  /** 0-100, or null when the dossier has no milestone template instantiated. */
  progress: number | null;
};

/**
 * Map one `/dashboard/control-tower` shipment to what the panel renders.
 *
 * Three defects the iframe build had already fixed are preserved here, and one
 * more is fixed by this rebuild:
 *
 *  1. ROUTE. The payload carries `origin`/`destination` (dossier.pol/pod), not
 *     `route`/`lane`. Read the real keys first; the split is a fallback for a
 *     pre-joined "A → B" string.
 *  2. ETA is a DATE column — `dateFmt`, not `dateTimeFmt`. The midnight-UTC time
 *     component is a serialisation artefact, not information.
 *  3. PROGRESS is null when a dossier has no milestones. The bar hides rather
 *     than defaulting to a number, because a default width lies and a 0%-width
 *     bar reads as "not started".
 *  4. NEW: `current_milestone` is now shown. The repo has computed it since the
 *     milestone engine landed (`dashboard.repo.js` — the in-progress or next
 *     pending stage label) and the iframe renderer never read it, printing the
 *     vessel string instead. "Costing approval" is what an operator scanning
 *     this list wants; "MSC Lucia" is not.
 */
export function toLiveShipment(s: Row): LiveShipment {
  const origin = str(s.origin ?? s.pol);
  const destination = str(s.destination ?? s.pod);
  const route = str(s.route ?? s.lane);
  const parts = route
    .split(/→|->|—|-|to/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const from = origin || parts[0] || "";
  const to = destination || parts[1] || "";
  const vessel = str(s.vessel ?? s.vessel_flight);
  const lane = [from, to, route].filter(Boolean).join(" ");
  const rawStatus = str(s.status ?? s.state) || "Active";
  const progress = numOrNull(s.progress);

  return {
    dossierId: str(s.dossier_id) || str(s.ref) || "",
    ref: str(s.ref ?? s.dossier_ref ?? s.reference) || "—",
    serviceName:
      str(s.service_name) || enumLabel(str(s.service_key)) || "Operations file",
    isMovement: s.is_movement !== false,
    needsLocation: s.needs_location === true,
    mode: shipmentMode(s, vessel, lane),
    from,
    to,
    // "IN_PROGRESS" → "In progress". The pill sat next to a formatted date while
    // still showing a raw enum token.
    status: enumLabel(rawStatus),
    tone: shipmentTone(rawStatus),
    stage: str(s.current_milestone) || vessel,
    eta: s.eta ? dateFmt(str(s.eta)) : str(s.eta_label),
    progress: progress !== null && Number.isFinite(progress) ? progress : null,
  };
}

/**
 * How much we actually know about a point on the map.
 *
 * The same four states the place picker's badge shows, so a route drawn in the
 * tower and the field it came from cannot disagree about what is verified. The
 * map uses them to draw honestly: a `reference` endpoint gets a hollow marker
 * because it is near the real place rather than at it, and `unknown` never
 * reaches the map at all — a leg with an unresolved end is not plottable.
 */
export type EndpointState = "verified" | "reference" | "unverified" | "unknown";

export type Waypoint = {
  name: string;
  lat: number;
  lng: number;
  /** `SEAPORT`, `AIRPORT`, `WAREHOUSE`… drives the marker glyph. */
  kind?: string | null;
  state?: EndpointState;
};

/**
 * ONE DRAWN SEGMENT. Both endpoints resolved to real coordinates server-side.
 *
 * A lane used to be a whole file: one line from POL to POD. That is the main
 * carriage and nothing else, so an end-to-end file — collect, sail, clear, truck
 * inland, deliver — showed one of its five movements, and the four an operator is
 * chased about were invisible. A lane is now one ITINERARY LEG, so the same file
 * draws five segments in three colours, and `dossierId` is what ties them back
 * together for selection.
 *
 * `id` is stable across renders and derived from the leg, not from array index.
 * The map uses it for `<mpath href>`, for keyboard focus and for selection — all
 * three break subtly when an id shifts because a filter removed an earlier file.
 */
export type Lane = {
  id: string;
  dossierId: string;
  ref: string;
  mode: ShipmentMode;
  status: string;
  /** `MAIN_CARRIAGE`, `PICKUP`, `FINAL_DELIVERY`… what this segment IS. */
  legType: string;
  /** Position within the file's itinerary, 1-based. */
  seq: number;
  from: Waypoint;
  to: Waypoint;
};

const finite = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A leg endpoint from the API's itinerary projection. */
function waypointOf(
  raw: Row | null | undefined,
  fallbackName: string,
): Waypoint | null {
  if (!raw) return null;
  const lat = finite(raw.latitude);
  const lng = finite(raw.longitude);
  if (lat === null || lng === null) return null;
  return {
    name: str(raw.name) || fallbackName,
    lat,
    lng,
    kind: raw.kind ? str(raw.kind) : null,
    state: (str(raw.state) as EndpointState) || undefined,
  };
}

/**
 * Lanes from the RAW payload — one per plottable itinerary leg, falling back to
 * the parent POL→POD lane for a file with no structured itinerary.
 *
 * THE FALLBACK IS NOT LEGACY CRUFT. A file created before itineraries existed,
 * and a file whose service type has no template, both have real POL/POD and
 * belong on the map. Drawing them as a single synthetic main carriage is exactly
 * what they are.
 *
 * `toLiveShipment` drops `coords` by design, so this reads the raw rows.
 */
export function toLanes(rawShipments: Row[]): Lane[] {
  const out: Lane[] = [];
  rawShipments.forEach((s, fileIndex) => {
    const mapped = toLiveShipment(s);
    // `dossier_id` is the real key; `ref` is a display string and the index is a
    // last resort so a payload without ids still produces stable-within-render
    // selection rather than colliding on an empty string.
    const dossierId = str(s.dossier_id) || str(s.ref) || `row-${fileIndex}`;
    const legs = Array.isArray(s.legs) ? (s.legs as Row[]) : [];

    const plotted = legs.filter((l) => l && l.plottable === true);
    if (plotted.length) {
      plotted.forEach((leg, i) => {
        // `*_endpoint` is the nested projection; `origin`/`destination` stay the
        // plain text so a leg can be read and written back unchanged.
        const from = waypointOf(leg.origin_endpoint as Row, str(leg.origin));
        const to = waypointOf(
          leg.destination_endpoint as Row,
          str(leg.destination),
        );
        if (!from || !to) return;
        const seq = finite(leg.seq) ?? i + 1;
        out.push({
          id: `${dossierId}:${str(leg.itinerary_leg_id) || `seq-${seq}`}`,
          dossierId,
          ref: mapped.ref,
          mode: MODE_FROM_SERVER[str(leg.mode).toUpperCase()] || "other",
          status: enumLabel(str(leg.status) || mapped.status),
          legType: str(leg.leg_type) || "OTHER",
          seq,
          from,
          to,
        });
      });
      return;
    }

    const c = s.coords as { from?: Row; to?: Row } | null | undefined;
    if (!c || !c.from || !c.to) return;
    const from = waypointOf(c.from, str(s.origin));
    const to = waypointOf(c.to, str(s.destination));
    if (!from || !to) return;
    out.push({
      id: `${dossierId}:parent`,
      dossierId,
      ref: mapped.ref,
      mode: mapped.mode,
      status: mapped.status,
      legType: "MAIN_CARRIAGE",
      seq: 1,
      from,
      to,
    });
  });
  return out;
}

/**
 * One leg of a file's itinerary, as the panel and the editor read it.
 *
 * A near-mirror of the server's projection (`itinerary.service.projectLeg`) with
 * the field names the client uses. Deliberately NOT re-derived here: `plottable`
 * and `needsLocation` are the server's verdicts, because it knows whether an
 * endpoint is absent or present-but-unverified, and the browser cannot tell those
 * apart from a coordinate alone.
 */
export type ItineraryLeg = {
  id: string;
  seq: number;
  legType: string;
  mode: ShipmentMode;
  status: string;
  isOptional: boolean;
  /** `TEMPLATE` legs came from the service type; `MANUAL` ones a person added. */
  source: string;
  plannedDeparture: string | null;
  plannedArrival: string | null;
  actualDeparture: string | null;
  actualArrival: string | null;
  providerName: string | null;
  notes: string | null;
  origin: { name: string | null; state?: EndpointState };
  destination: { name: string | null; state?: EndpointState };
  plottable: boolean;
  needsLocation: boolean;
};

const endpointOf = (raw: unknown): ItineraryLeg["origin"] => {
  const r = (raw || {}) as Row;
  return {
    name: str(r.name) || null,
    state: (str(r.state) as EndpointState) || undefined,
  };
};

export function toItineraryLeg(raw: Row, index: number): ItineraryLeg {
  return {
    id: str(raw.itinerary_leg_id) || `leg-${index}`,
    seq: numOrNull(raw.seq) ?? index + 1,
    legType: str(raw.leg_type) || "OTHER",
    mode: MODE_FROM_SERVER[str(raw.mode).toUpperCase()] || "other",
    status: str(raw.status) || "PLANNED",
    isOptional: raw.is_optional === true,
    source: str(raw.source) || "MANUAL",
    plannedDeparture: raw.planned_departure ? str(raw.planned_departure) : null,
    plannedArrival: raw.planned_arrival ? str(raw.planned_arrival) : null,
    actualDeparture: raw.actual_departure ? str(raw.actual_departure) : null,
    actualArrival: raw.actual_arrival ? str(raw.actual_arrival) : null,
    providerName: raw.provider_name ? str(raw.provider_name) : null,
    notes: raw.notes ? str(raw.notes) : null,
    origin: endpointOf(raw.origin_endpoint ?? { name: raw.origin }),
    destination: endpointOf(
      raw.destination_endpoint ?? { name: raw.destination },
    ),
    plottable: raw.plottable === true,
    needsLocation: raw.needs_location === true,
  };
}

/** Every file's legs, keyed by dossier id — what the itinerary panel indexes. */
export function legsByFile(
  rawShipments: Row[],
): Record<string, ItineraryLeg[]> {
  const out: Record<string, ItineraryLeg[]> = {};
  rawShipments.forEach((s, i) => {
    const key = str(s.dossier_id) || str(s.ref) || `row-${i}`;
    const legs = Array.isArray(s.legs) ? (s.legs as Row[]) : [];
    // Property name from the payload, so it is only ever a VALUE here — the same
    // remote-property-injection rule the server's partition loop documents.
    Object.defineProperty(out, key, {
      value: legs.map(toItineraryLeg),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  });
  return out;
}

/**
 * A file that belongs on the tower but NOT on the map: warehousing, brokerage,
 * business representation, and anything whose endpoints are still unresolved.
 *
 * Split out here rather than filtered in the panel so there is one definition of
 * "this has no route" and the map, the counts and the activity list cannot
 * disagree. `needsLocation` is the server's verdict — it knows whether an endpoint
 * is merely absent or is present-but-unverified, which the browser cannot tell
 * from coordinates alone.
 */
export type ActivityRecord = {
  dossierId: string;
  ref: string;
  serviceName: string;
  status: string;
  tone: Tone;
  stage: string;
  eta: string;
  /** Why it is here: no route at all, or a route we cannot trust yet. */
  reason: "activity" | "needs-location";
  /** A verified facility, when the file names one — so it can still get a pin. */
  facility: Waypoint | null;
};

export function toActivityRecords(rawShipments: Row[]): ActivityRecord[] {
  const out: ActivityRecord[] = [];
  rawShipments.forEach((s, i) => {
    const isMovement = s.is_movement === true;
    const needsLocation = s.needs_location === true;
    const legs = Array.isArray(s.legs) ? (s.legs as Row[]) : [];
    const hasRoute = legs.some((l) => l && l.plottable === true) || !!s.coords;
    // On the map already and nothing unresolved about it — not an exception.
    if (hasRoute && !needsLocation) return;
    if (isMovement && !needsLocation && !hasRoute) {
      // A movement file with no endpoints named at all. The server does not call
      // that "needs location" (nothing was typed to verify), but an operator
      // looking for what is missing wants to see it.
      out.push(activityOf(s, i, "needs-location", legs));
      return;
    }
    out.push(
      activityOf(s, i, needsLocation ? "needs-location" : "activity", legs),
    );
  });
  return out;
}

function activityOf(
  s: Row,
  i: number,
  reason: ActivityRecord["reason"],
  legs: Row[],
): ActivityRecord {
  const mapped = toLiveShipment(s);
  // A warehousing file's custody location is a real, verified point when the
  // operator picked one — so it earns a facility pin rather than nothing.
  let facility: Waypoint | null = null;
  for (const leg of legs) {
    facility =
      waypointOf(leg.origin_endpoint as Row, str(leg.origin)) ||
      waypointOf(leg.destination_endpoint as Row, str(leg.destination));
    if (facility) break;
  }
  if (!facility) {
    const c = s.coords as { from?: Row } | null | undefined;
    facility = waypointOf(c?.from, str(s.origin));
  }
  return {
    dossierId: str(s.dossier_id) || str(s.ref) || `row-${i}`,
    ref: mapped.ref,
    serviceName:
      str(s.service_name) || enumLabel(str(s.service_key)) || "Operations file",
    status: mapped.status,
    tone: mapped.tone,
    stage: mapped.stage,
    eta: mapped.eta,
    reason,
    facility,
  };
}

/**
 * "Good morning, Amara".
 *
 * The mock hardcoded the name, so every user in every tenant was greeted as
 * Amara. Takes a Date so the boundary behaviour is testable rather than
 * dependent on when the suite happens to run.
 */
export function greeting(now: Date, firstName?: string | null): string {
  const h = now.getHours();
  const part = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  return `Good ${part}${firstName ? `, ${firstName}` : ""}`;
}

/** First name from the display name, falling back to the email local part.
 *  A bare "Good evening" reads fine; an invented name does not. */
export function firstNameOf(
  user: { display_name?: string | null; email?: string | null } | null,
): string {
  const display = str(user?.display_name).trim();
  if (display) return display.split(/\s+/)[0];
  const email = str(user?.email);
  return email ? email.split("@")[0] : "";
}

/** Grouped integer, e.g. 84 600 000. Money figures with no cents. */
export const grouped = (n: number): string =>
  new Intl.NumberFormat("fr-FR").format(Math.round(n));

/** Compact millions for the KPI headline: 84 600 000 → "84.6". */
export const millions = (n: number): string => (n / 1e6).toFixed(1);

export const LOCKED_FINAL_STATUSES = [
  "ISSUED_LOCKED",
  "APPROVED_LOCKED",
  "POSTED_LOCKED",
];

export const isLockedFinal = (r: Row): boolean =>
  str(r.type).toUpperCase() === "FINAL" &&
  LOCKED_FINAL_STATUSES.includes(str(r.status).toUpperCase());

export const daysBetween = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / 86_400_000);
