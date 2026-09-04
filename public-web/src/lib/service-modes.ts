import {
  BoxIcon,
  DocumentIcon,
  PlaneIcon,
  ShipIcon,
  TrainIcon,
  TruckIcon,
  WarehouseIcon,
} from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icon-tile";
import type { EnquiryShape, ServiceCard, ServiceMode } from "./services-api";

/**
 * The transport modes, as the quote wizard's first question.
 *
 * ── WHY THIS FILE DOES NOT DECIDE WHICH MODES EXIST ───────────────────────
 *
 * It used to. The wizard opened with four cards — Sea / Air / Road-or-rail /
 * Storage — written into the component as a literal, and that was wrong in both
 * directions at once for every tenant: it offered storage to a tenant who does
 * not warehouse, and it had no card at all for a tenant whose business is
 * customs brokerage. A stranger who picks "By sea" on a form belonging to an
 * air-freight-only agent has been invited to describe a shipment nobody there
 * will quote.
 *
 * So the LIST is data — `modesOf` reads it off the tenant's own published
 * services — and this file owns only the two things that are genuinely ours:
 * the glyph, and the order the cards appear in. Those are presentation, and
 * presentation is what a scaffold is allowed to own (`WEB_BUILD_BRIEF.md` N12).
 *
 * ── AND WHY THE ORDER IS FIXED RATHER THAN READ ───────────────────────────
 *
 * `sort_order` on the profile orders SERVICES, not modes, and folding it up
 * would make the first card of the form move whenever somebody reordered a
 * grid on the services page. A stable order is worth more here: this is the
 * screen a returning visitor half-remembers.
 */
export const MODE_ORDER: readonly ServiceMode[] = [
  "SEA",
  "AIR",
  "ROAD",
  "RAIL",
  "CUSTOMS",
  "WAREHOUSE",
  "OTHER",
] as const;

export const MODE_ICONS: Record<ServiceMode, IconComponent> = {
  SEA: ShipIcon,
  AIR: PlaneIcon,
  ROAD: TruckIcon,
  RAIL: TrainIcon,
  CUSTOMS: DocumentIcon,
  WAREHOUSE: WarehouseIcon,
  OTHER: BoxIcon,
};

/**
 * Which modes this tenant actually sells, in display order.
 *
 * Distinct rather than one card per service: eleven cards is not a question, it
 * is a menu, and the whole point of the first step is that it asks ONE easy
 * thing before the form starts costing the visitor anything. The services
 * themselves are the second half of the step, filtered to whatever was picked.
 */
export function modesOf(services: ServiceCard[]): ServiceMode[] {
  const present = new Set(services.map((s) => s.mode));
  return MODE_ORDER.filter((m) => present.has(m));
}

/** The services offered under one mode, in the order the server sent them. */
export const servicesIn = (
  services: ServiceCard[],
  mode: ServiceMode | "",
): ServiceCard[] => (mode ? services.filter((s) => s.mode === mode) : []);

/**
 * Which pair of route labels a mode asks for.
 *
 * The same three-way split `tracking_public.routeLabels` applies server-side,
 * and for the same reason: a form that asks an air-freight prospect for a port
 * of loading is asking a question with no answer, and one that asks a customs
 * broker's client for either is asking about a movement they are not buying.
 * RAIL and CUSTOMS both take the neutral place labels — a rail movement is
 * collected and delivered, and a clearance file names a place, never a leg.
 */
export function routeLabelKeys(mode: ServiceMode | ""): {
  origin: string;
  destination: string;
} {
  if (mode === "SEA") return { origin: "originPort", destination: "destinationPort" };
  if (mode === "AIR") return { origin: "originAirport", destination: "destinationAirport" };
  return { origin: "originPlace", destination: "destinationPlace" };
}

/**
 * The shape of the services under a mode — which decides what the wizard's
 * second step asks, and whether it exists at all.
 *
 * ── WHY THIS IS A FOLD AND NOT A LOOKUP ────────────────────────────────────
 *
 * The shape belongs to the SERVICE, and the visitor picks a mode first. So
 * before they have chosen a service the honest answer is "whatever the services
 * under this mode agree on" — and where they disagree, the answer is ROUTE,
 * because asking for a route and letting somebody leave it blank is recoverable,
 * and skipping a route the desk needed is not.
 *
 * Once a service IS chosen its own shape wins outright; this only covers the
 * moment in between, and the case of a mode whose services all agree — storage,
 * where the step has always been different.
 */
export function shapeOfMode(
  services: ServiceCard[],
  mode: ServiceMode | "",
): EnquiryShape {
  const rows = servicesIn(services, mode);
  /* NO SERVICES TO CONSULT — the pre-launch fallback, where the four hardcoded
     mode cards are all the form has. The mode is then the only thing that knows
     anything, and "Storage only" has meant a place and a duration since the
     first version of this wizard.
 
     Returning ROUTE here was a real regression and the tests caught it: a
     visitor on a tenant with nothing published picked "Storage only" and was
     asked for a port of loading, a port of discharge and a required Incoterm —
     the exact defect this whole change set out to remove, reintroduced for the
     tenants least able to notice it. */
  if (!rows.length) return mode === "WAREHOUSE" ? "STORAGE" : "ROUTE";
  const first = rows[0].enquiry_shape;
  return rows.every((s) => s.enquiry_shape === first) ? first : "ROUTE";
}
