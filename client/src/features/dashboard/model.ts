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

export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
export const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Transport mode, which drives the map lane styling and the row's icon. */
export type ShipmentMode = "sea" | "road" | "air";

/**
 * Mode for a live shipment.
 *
 * The dossier's `service_type.key` is the authoritative answer and is tried
 * first. Text sniffing is a fallback for dossiers with no service type, and it
 * is known to be wrong for HINTERLAND_TRANSIT — no vessel, two ordinary city
 * names, so it falls through to the "sea" default and the Douala→N'Djamena
 * corridor was drawn as a shipping lane. That is exactly why the key wins.
 */
export function shipmentMode(s: Row, vessel: string, lane: string): ShipmentMode {
  const key = str(s.service_key).toUpperCase();
  if (/AIR/.test(key)) return "air";
  if (/ROAD|TRANSIT|HINTERLAND|TRUCK|INLAND/.test(key)) return "road";
  if (/SEA|OCEAN|MARITIME/.test(key)) return "sea";
  if (/air|flight|mawb|cdg|airport/i.test(`${vessel} ${lane}`)) return "air";
  if (/road|truck|corridor|transit/i.test(`${str(s.service ?? s.mode)} ${lane}`)) return "road";
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
  ref: string;
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
  const parts = route.split(/→|->|—|-|to/i).map((p) => p.trim()).filter(Boolean);
  const from = origin || parts[0] || "";
  const to = destination || parts[1] || "";
  const vessel = str(s.vessel ?? s.vessel_flight);
  const lane = [from, to, route].filter(Boolean).join(" ");
  const rawStatus = str(s.status ?? s.state) || "Active";
  const progress = numOrNull(s.progress);

  return {
    ref: str(s.ref ?? s.dossier_ref ?? s.reference) || "—",
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
 * A plottable lane: both endpoints resolved to real coordinates by the backend
 * (`geo_place` cache → Geoapify on a miss). A shipment whose POL/POD cannot be
 * resolved produces no lane — it still appears in the list.
 */
export type Lane = {
  ref: string;
  mode: ShipmentMode;
  status: string;
  from: { name: string; lat: number; lng: number };
  to: { name: string; lat: number; lng: number };
};

/** Lanes from the RAW payload — `toLiveShipment` drops `coords` by design. */
export function toLanes(rawShipments: Row[]): Lane[] {
  const out: Lane[] = [];
  rawShipments.forEach((s) => {
    const c = s.coords as { from?: Row; to?: Row } | null | undefined;
    if (!c || !c.from || !c.to) return;
    const fLat = Number(c.from.latitude);
    const fLng = Number(c.from.longitude);
    const tLat = Number(c.to.latitude);
    const tLng = Number(c.to.longitude);
    if (![fLat, fLng, tLat, tLng].every(Number.isFinite)) return;
    const mapped = toLiveShipment(s);
    out.push({
      ref: mapped.ref,
      mode: mapped.mode,
      status: mapped.status,
      from: { name: str(c.from.name) || str(s.origin), lat: fLat, lng: fLng },
      to: { name: str(c.to.name) || str(s.destination), lat: tLat, lng: tLng },
    });
  });
  return out;
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
export function firstNameOf(user: { display_name?: string | null; email?: string | null } | null): string {
  const display = str(user?.display_name).trim();
  if (display) return display.split(/\s+/)[0];
  const email = str(user?.email);
  return email ? email.split("@")[0] : "";
}

/** Grouped integer, e.g. 84 600 000. Money figures with no cents. */
export const grouped = (n: number): string => new Intl.NumberFormat("fr-FR").format(Math.round(n));

/** Compact millions for the KPI headline: 84 600 000 → "84.6". */
export const millions = (n: number): string => (n / 1e6).toFixed(1);

export const LOCKED_FINAL_STATUSES = ["ISSUED_LOCKED", "APPROVED_LOCKED", "POSTED_LOCKED"];

export const isLockedFinal = (r: Row): boolean =>
  str(r.type).toUpperCase() === "FINAL" &&
  LOCKED_FINAL_STATUSES.includes(str(r.status).toUpperCase());

export const daysBetween = (from: Date, to: Date): number =>
  Math.floor((to.getTime() - from.getTime()) / 86_400_000);
