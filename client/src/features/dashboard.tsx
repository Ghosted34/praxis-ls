/**
 * Control Tower home — the Lovable "Control Tower" mock rendered in an isolated
 * <iframe srcDoc>, now fed with LIVE backend data instead of the static sample:
 *   GET /dashboard/control-tower → { operation_files, approvals_awaiting, live_shipments[] }
 *   GET /dashboard/kpis          → flat guarded counts
 *
 * We keep the mock's exact look (its own CSS/markup from features/dashboard-mock/*),
 * hide its duplicate app chrome (topbar / test banner / drawer — the app already
 * provides those), and inject a small script that rewrites the live-shipments list,
 * the "N active" pill, the hero subline and the Praxis briefing from real data. The
 * iframe's data-theme tracks the app's light/dark class.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { tenant } from "@/lib/api-client";
import { ErrorState } from "@/components/ui/states";
import { PageSkeleton } from "@/components/ui/skeleton";
import { errMsg } from "@/features/sales/ui";
import { dateFmt, enumLabel } from "@/lib/format";
import { tokenStore } from "@/lib/token-store";
// Natural Earth 110m land, ~100 kB. Imported (not fetched) so the map works
// offline and inside the srcDoc iframe, which can't require modules itself.
import { feature as topoFeature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";
import mockBody from "./dashboard-mock/body.html.txt?raw";
import mockStyle from "./dashboard-mock/style.css.txt?raw";
import mockScript from "./dashboard-mock/script.js.txt?raw";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Past-due receivables from `GET /receivables/overdue` (MOD-52).
 *
 * This replaced a derivation off the `receivables_ageing` report. Both the KPI
 * card and its drill-down now read this one payload, so the headline figure and
 * the invoice list reconcile by construction — previously the card came from the
 * ageing buckets (net of receipts) while the list came from raw invoices (not),
 * and they could disagree on screen. Returns null when the module is gated or
 * the user lacks the grant, so the card hides rather than showing a false zero.
 */
type OverduePayload = {
  total?: number;
  count?: number;
  clients?: number;
  invoices?: Row[];
};

/** Derive the mock status-pill class from a free-text status. */
function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (/await|approv|pending/.test(s)) return "st-orange";
  if (/transit|progress|port|clear|berth|road|moving/.test(s)) return "st-blue";
  if (/deliver|complete|closed|paid|done|arrived|departed/.test(s)) return "st-ok";
  if (/overdue|risk|hold|block|late/.test(s)) return "st-warn";
  return "st-mute";
}

/**
 * Map a live control-tower shipment to the shape the mock's liverow expects.
 *
 * Three defects fixed here (2026-08-01), all of which made the panel show less
 * than the backend was already sending:
 *
 *  1. ROUTE WAS ALWAYS EMPTY. This read `s.route ?? s.lane`, but the payload has
 *     never carried either key — `dashboard.repo.js` returns `origin`/`destination`
 *     (dossier.pol/pod). So `from`/`to` resolved to "" on every row and the list
 *     rendered a bare "→". Read the real keys first; the route/lane split is kept
 *     only as a fallback for a pre-formatted "A → B" string.
 *  2. RAW ISO TIMESTAMPS. `s.eta` went straight into the meta line, printing
 *     "2026-07-16T23:00:00.000Z". Now goes through dateFmt (FE_DESIGN_RULES §5).
 *  3. EVERY BAR SAT AT 45%. `Number(s.progress ?? s.prog ?? 0) || 45` fell through
 *     to the literal 45 because no progress field was sent — an OPEN dossier looked
 *     as advanced as one nearly delivered. The repo now derives progress from the
 *     milestone engine and sends null when a dossier has no milestones, which we
 *     pass through as null so the bar hides rather than inventing a number.
 */
function toLiveShipment(s: Row) {
  const origin = str(s.origin ?? s.pol ?? "");
  const destination = str(s.destination ?? s.pod ?? "");
  // Fallback only: some callers may pass a pre-joined "Douala → N'Djamena".
  const route = str(s.route ?? s.lane ?? "");
  const parts = route.split(/→|->|—|-|to/i).map((p) => p.trim()).filter(Boolean);
  const from = origin || parts[0] || "";
  const to = destination || parts[1] || "";
  const vessel = str(s.vessel ?? s.vessel_flight ?? "");
  const lane = [from, to, route].filter(Boolean).join(" ");
  // Mode comes from the dossier's service_type key when we have one — that's the
  // authoritative answer. Text sniffing is only a fallback for rows without a
  // service type, and it gets HINTERLAND_TRANSIT wrong (no vessel, two ordinary
  // city names → falls through to "sea"), which is why the map drew the
  // Douala→Ndjamena corridor as a shipping lane.
  const serviceKey = str(s.service_key ?? "").toUpperCase();
  const mode = /AIR/.test(serviceKey)
    ? "air"
    : /ROAD|TRANSIT|HINTERLAND|TRUCK|INLAND/.test(serviceKey)
      ? "road"
      : /SEA|OCEAN|MARITIME/.test(serviceKey)
        ? "sea"
        : // No service type on the dossier — fall back to the old heuristic.
          /air|flight|mawb|cdg|airport/i.test(vessel + " " + lane)
          ? "air"
          : /road|truck|corridor|transit/i.test(str(s.service ?? s.mode ?? "") + " " + lane)
            ? "road"
            : "sea";
  const rawStatus = str(s.status ?? s.state ?? "Active");
  // ETA is a DATE column — dateFmt, not dateTimeFmt: the midnight-UTC time
  // component is an artefact of serialisation, not information.
  const eta = s.eta ? dateFmt(str(s.eta)) : str(s.eta_label ?? "");
  const metaBits = [str(s.client ?? s.client_name ?? vessel), eta].filter(Boolean);
  const progress = s.progress === null || s.progress === undefined ? null : Number(s.progress);
  return {
    ref: str(s.ref ?? s.dossier_ref ?? s.reference ?? "—"),
    mode,
    from,
    to,
    // "IN_PROGRESS" → "In progress". The pill sat next to a formatted date while
    // still showing a raw enum token; same human-readable rule, same line of sight.
    st: enumLabel(rawStatus),
    stc: statusClass(rawStatus),
    meta: metaBits.join(" · "),
    prog: progress !== null && Number.isFinite(progress) ? progress : null,
  };
}

/* ───────────────────────── KPI drill-downs ─────────────────────────────────
 * Clicking a KPI card opens the mock's detail modal. That modal used to render
 * hardcoded sample rows (its own `kpiData` object) even though the card values
 * were live. We now build each drill-down from the same endpoints the rest of the
 * app uses and override the mock's `openKpi` so it renders real records.
 *
 * There is no dedicated drill-down endpoint and none is needed — every figure here
 * comes from a list the user is already entitled to read. Any source that 403s
 * (fleet is feature-gated, reports likewise) simply yields an empty drill-down
 * with an explanatory message rather than breaking the tower.
 */

/** A cell row; `tone` renders the LAST cell as one of the mock's status pills. */
type DrillRow = { cells: string[]; tone?: string };
type Drill = {
  title: string;
  chip: string;
  chipText: string;
  meta: string[];
  headers: string[];
  rows: DrillRow[];
  cta: string;
  empty: string;
};

/** Where each card's CTA sends the user in the real app (not the mock's own views). */
const KPI_ROUTE: Record<string, string> = {
  revenue: "/finance/invoices",
  sla: "/operations",
  overdue: "/finance/receivables",
  fleet: "/fleet/vehicles",
};

/**
 * The mock's "Applications" launcher renders every tile with a hardcoded
 * `onclick="go('ops')"` (see dashboard-mock/script.js.txt renderApps) — so all
 * twelve tiles opened the mock's *internal* Operations view full of sample
 * dossiers, whichever one you clicked. Keyed by the tile's visible label,
 * because that's the only identifier the mock's `apps` array carries.
 *
 * Same containment rule as KPI_ROUTE: the iframe posts a label, the parent owns
 * the label→route map, so the iframe can't navigate to an arbitrary path.
 */
const APP_ROUTE: Record<string, string> = {
  Operations: "/operations",
  Freight: "/operations/files",
  Fleet: "/fleet",
  Warehouse: "/wms",
  Invoicing: "/finance/invoices",
  Treasury: "/master/treasury-accounts",
  "OHADA Ledger": "/finance/journals",
  "Tax Center": "/finance/tax",
  CRM: "/sales/leads",
  Procurement: "/procurement",
  "HR & Payroll": "/hr/employees",
  Settings: "/settings",
  // Not a launcher tile — the floatbar's clock-in button reuses this channel.
  Attendance: "/hr/attendance",
};

const LOCKED_STATUSES = ["ISSUED_LOCKED", "APPROVED_LOCKED", "POSTED_LOCKED"];
const isLockedFinal = (r: Row) =>
  str(r.type).toUpperCase() === "FINAL" && LOCKED_STATUSES.includes(str(r.status).toUpperCase());

const grouped = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n));

/**
 * Drill-down `meta` entries carry deliberate <b> markup, so they're injected as
 * HTML. Any value interpolated into them comes from the database (client names,
 * dossier refs), so escape it here — the iframe runs allow-same-origin, which is
 * not a security boundary worth trusting.
 */
const escHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / 86_400_000);

/** Revenue → locked FINAL invoices, grouped by client (biggest first). */
function buildRevenueDrill(invoices: Row[] | null, clientName: Record<string, string>, cur: string): Drill {
  const finals = (invoices || []).filter(isLockedFinal);
  const byClient = new Map<string, { total: number; count: number }>();
  finals.forEach((r) => {
    const key = str(r.client_id) || "—";
    const prev = byClient.get(key) || { total: 0, count: 0 };
    byClient.set(key, { total: prev.total + (Number(r.total_ttc) || 0), count: prev.count + 1 });
  });
  const total = finals.reduce((s, r) => s + (Number(r.total_ttc) || 0), 0);
  const ranked = [...byClient.entries()].sort((a, b) => b[1].total - a[1].total);
  return {
    title: "Revenue · locked invoices",
    chip: "st-orange",
    chipText: `${finals.length} locked invoice${finals.length === 1 ? "" : "s"}`,
    meta: [
      `Total <b>${grouped(total)} ${cur}</b>`,
      `Invoices <b>${finals.length}</b>`,
      `Clients <b>${ranked.length}</b>`,
      ranked.length ? `Top <b>${escHtml(clientName[ranked[0][0]] || "Unattributed")}</b>` : "",
    ].filter(Boolean),
    headers: ["Client", "Invoices", cur, "Share"],
    rows: ranked.slice(0, 8).map(([id, v]) => ({
      cells: [
        clientName[id] || "Unattributed",
        String(v.count),
        grouped(v.total),
        total > 0 ? `${Math.round((v.total / total) * 100)}%` : "—",
      ],
    })),
    cta: "Open invoices →",
    empty: "No locked FINAL invoices yet — revenue posts here as invoices are locked.",
  };
}

/** SLA → dossiers that have both an ETA and an ATA; late ones surface first. */
function buildSlaDrill(dossiers: Row[] | null): Drill {
  const measured = (dossiers || []).filter((d) => d.eta && d.ata);
  const scored = measured.map((d) => {
    const eta = new Date(str(d.eta));
    const ata = new Date(str(d.ata));
    const slip = daysBetween(eta, ata);
    return { d, slip, onTime: slip <= 0 };
  });
  const late = scored.filter((s) => !s.onTime);
  const pct = measured.length ? Math.round(((measured.length - late.length) / measured.length) * 100) : null;
  const route = (d: Row) => [str(d.pol), str(d.pod)].filter(Boolean).join(" → ") || "—";
  return {
    title: "On-time delivery",
    chip: late.length ? "st-warn" : "st-ok",
    chipText: `${measured.length} arrival${measured.length === 1 ? "" : "s"} measured`,
    meta: [
      `On time <b>${pct === null ? "—" : pct + "%"}</b>`,
      `Measured <b>${measured.length}</b>`,
      `Late <b>${late.length}</b>`,
    ],
    headers: ["Dossier", "Route", "ETA", "Result"],
    // Late first, worst slip at the top — that's what a controller wants to see.
    rows: [...late.sort((a, b) => b.slip - a.slip), ...scored.filter((s) => s.onTime)].slice(0, 8).map((s) => ({
      cells: [
        str(s.d.ref),
        route(s.d),
        str(s.d.eta),
        s.onTime ? "On time" : `${s.slip} day${s.slip === 1 ? "" : "s"} late`,
      ],
      tone: s.onTime ? "st-ok" : s.slip > 3 ? "st-bad" : "st-warn",
    })),
    cta: "Open operation files →",
    empty: "No arrivals recorded yet — on-time rate needs both an ETA and an ATA on a dossier.",
  };
}

/**
 * Overdue → `GET /receivables/overdue`. Amounts are `outstanding` (total_ttc net
 * of payment_allocation), which is the same basis as the KPI card's total, so the
 * rows here sum to the headline figure.
 */
function buildOverdueDrill(payload: OverduePayload | null, clientName: Record<string, string>, cur: string): Drill {
  const invoices = payload?.invoices || [];
  const oldest = invoices.length ? Number(invoices[0].days_overdue) || 0 : 0;
  return {
    title: "Receivables · past due",
    chip: "st-warn",
    chipText: "Outstanding past due date",
    meta: [
      `Outstanding <b>${grouped(Number(payload?.total) || 0)} ${cur}</b>`,
      `Invoices <b>${payload?.count ?? invoices.length}</b>`,
      `Clients <b>${payload?.clients ?? 0}</b>`,
      invoices.length ? `Oldest <b>${oldest} days</b>` : "",
    ].filter(Boolean),
    headers: ["Invoice", "Client", cur, "Age"],
    rows: invoices.slice(0, 8).map((r) => {
      const age = Number(r.days_overdue) || 0;
      return {
        cells: [
          str(r.doc_number) || str(r.invoice_id).slice(0, 8),
          clientName[str(r.client_id)] || "—",
          grouped(Number(r.outstanding) || 0),
          `${age} days`,
        ],
        tone: age > 30 ? "st-bad" : "st-warn",
      };
    }),
    cta: "Open receivables →",
    empty: "Nothing past due — every locked invoice is within terms.",
  };
}

/** Fleet → the vehicle register (feature-gated `fleet`; empty when off). */
function buildFleetDrill(vehicles: Row[] | null): Drill {
  const all = vehicles || [];
  const active = all.filter((v) => str(v.status).toUpperCase() === "ACTIVE");
  return {
    title: "Fleet utilisation",
    chip: "st-blue",
    chipText: `${active.length} of ${all.length} active`,
    meta: [
      `Active <b>${active.length}</b>`,
      `Fleet size <b>${all.length}</b>`,
      `Utilisation <b>${all.length ? Math.round((active.length / all.length) * 100) + "%" : "—"}</b>`,
    ],
    headers: ["Vehicle", "Category", "Status"],
    rows: all.slice(0, 8).map((v) => ({
      cells: [str(v.registration) || str(v.vehicle_id).slice(0, 8), str(v.category) || "—", str(v.status) || "—"],
      tone: str(v.status).toUpperCase() === "ACTIVE" ? "st-blue" : "st-mute",
    })),
    cta: "Open fleet →",
    empty: "No vehicles visible — the fleet module may be switched off for this tenant.",
  };
}

/**
 * A plottable lane: both endpoints resolved to real coordinates by the backend
 * (`geo_place` cache → Geoapify on a miss). Shipments whose POL/POD can't be
 * resolved simply don't produce a lane — they still appear in the list.
 */
type Lane = {
  ref: string;
  mode: string;
  status: string;
  from: { name: string; lat: number; lng: number };
  to: { name: string; lat: number; lng: number };
};

/** Build map lanes from the raw control-tower payload (needs `coords`, which
 *  toLiveShipment drops — that shape is for the list rows). */
function toLanes(rawShips: Row[]): Lane[] {
  const out: Lane[] = [];
  rawShips.forEach((s) => {
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
      status: mapped.st,
      from: { name: str(c.from.name) || str(s.origin), lat: fLat, lng: fLng },
      to: { name: str(c.to.name) || str(s.destination), lat: tLat, lng: tLng },
    });
  });
  return out;
}

/* ───────────────────────────── Map model ──────────────────────────────────
 * Everything the map needs is computed HERE, in the parent, and handed to the
 * iframe as ready-to-draw SVG strings. The iframe is a dumb renderer.
 *
 * Why: the land geometry comes from `world-atlas` (Natural Earth 110m), which is
 * a module import — not something the injected script can require. Projecting in
 * the parent also keeps ONE copy of the fit maths, so land, graticule, lanes and
 * nodes are guaranteed to share a projection instead of drifting apart.
 *
 * Projection is plain equirectangular (lon→x, lat→y, one shared scale). It is
 * NOT area-accurate at high latitude, which is fine for an origin-destination
 * view of tropical-to-European trade lanes and keeps the maths inspectable.
 * KNOWN LIMIT: a viewport crossing the antimeridian (±180°) would tear. No lane
 * in a Douala-centred network does; revisit if one ever routes via the Pacific.
 */

const MAP_W = 760;
const MAP_H = 470;
const MAP_PAD = 54;

type MapModel = {
  w: number;
  h: number;
  land: string[];
  grid: string;
  gridLabels: { x: number; y: number; t: string }[];
  equatorY: number | null;
  lanes: { id: string; d: string; cls: string; title: string; dur: number; marker: string }[];
  nodes: { x: number; y: number; name: string; emphasis: boolean; dy: number }[];
  counts: { sea: number; road: number; air: number };
};

type Ring = [number, number][];

/**
 * Natural Earth land as flat rings, decoded once at module load.
 *
 * Defensive about the object key: world-atlas ships `objects.land` in
 * land-110m.json, but `countries-110m.json` carries both `countries` and `land`,
 * and a version bump could rename either. Falls back to the first object rather
 * than silently rendering an oceans-only map — and warns, because a swallowed
 * failure here looks exactly like "the map just has no land", which is very
 * hard to tell from a styling problem.
 */
let LAND_RINGS: Ring[] | null = null;
function landRings(): Ring[] {
  if (LAND_RINGS) return LAND_RINGS;
  const rings: Ring[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topo = landTopo as any;
    const objects = topo && topo.objects;
    if (!objects) throw new Error("topology has no `objects`");
    const key = objects.land ? "land" : Object.keys(objects)[0];
    if (!key) throw new Error("topology has no geometry objects");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geo = topoFeature(topo, objects[key]) as any;
    // feature() yields either a Feature or a FeatureCollection depending on the
    // object type — normalise to a list of geometries before walking.
    const geoms: unknown[] = geo.type === "FeatureCollection"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? geo.features.map((f: any) => f.geometry)
      : [geo.geometry];
    geoms.forEach((g) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geom = g as any;
      if (!geom || !geom.coordinates) return;
      const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      (polys as Ring[][]).forEach((poly) => poly.forEach((r) => rings.push(r)));
    });
    if (!rings.length) throw new Error("decoded 0 rings");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[control-tower] land basemap unavailable:", err);
  }
  LAND_RINGS = rings;
  return LAND_RINGS;
}

function buildMapModel(lanes: Lane[]): MapModel | null {
  if (!lanes.length) return null;

  const lons: number[] = [];
  const lats: number[] = [];
  lanes.forEach((l) => {
    lons.push(l.from.lng, l.to.lng);
    lats.push(l.from.lat, l.to.lat);
  });
  const cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  // Floor the span so one short corridor doesn't zoom to street level, where a
  // 110m coastline is a blocky mess. 18% headroom keeps node labels off the edge.
  const spanLon = Math.max(Math.max(...lons) - Math.min(...lons), 12) * 1.18;
  const spanLat = Math.max(Math.max(...lats) - Math.min(...lats), 12) * 1.18;
  // One scale for both axes: true proportions. With real coastline drawn behind,
  // the "dead space" a tall narrow lane set leaves is filled by actual geography,
  // so stretching to fill (which would skew every landmass) buys nothing.
  const scale = Math.min((MAP_W - MAP_PAD * 2) / spanLon, (MAP_H - MAP_PAD * 2) / spanLat);
  const px = (lon: number) => MAP_W / 2 + (lon - cLon) * scale;
  const py = (lat: number) => MAP_H / 2 - (lat - cLat) * scale;

  // ── land ──
  // Cull rings fully outside the viewport, and clamp the rest: at high zoom an
  // unclamped Siberia projects to coordinates in the millions and bloats the
  // path string for pixels nobody sees.
  const CLAMP = 4000;
  const clamp = (v: number) => (v < -CLAMP ? -CLAMP : v > CLAMP ? CLAMP : v);
  const land: string[] = [];
  landRings().forEach((ring) => {
    if (ring.length < 3) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [lon, lat] of ring) {
      const x = px(lon), y = py(lat);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX < 0 || minX > MAP_W || maxY < 0 || minY > MAP_H) return; // off-screen
    let d = "";
    for (let i = 0; i < ring.length; i += 1) {
      const x = clamp(px(ring[i][0])).toFixed(1);
      const y = clamp(py(ring[i][1])).toFixed(1);
      d += (i === 0 ? "M" : "L") + x + "," + y;
    }
    land.push(d + "Z");
  });

  // ── graticule ──
  // Computed over the VISIBLE viewport, not the lane bounding box. Those differ
  // a lot: one axis always wins the `min()` above, so with tall narrow lanes
  // (Antwerp→Douala is 47° of latitude but 15° of longitude) the visible world
  // is far wider than the lanes. Keying the grid to the lanes drew it as a
  // narrow band down the middle with bare space either side.
  const halfLon = MAP_W / 2 / scale;
  const halfLat = MAP_H / 2 / scale;
  const lonMin = cLon - halfLon, lonMax = cLon + halfLon;
  const latMin = cLat - halfLat, latMax = cLat + halfLat;
  const visSpan = lonMax - lonMin;
  const step = visSpan > 120 ? 30 : visSpan > 60 ? 20 : visSpan > 24 ? 10 : 5;
  const snap = (v: number) => Math.ceil(v / step) * step;
  let grid = "";
  const gridLabels: { x: number; y: number; t: string }[] = [];
  for (let lon = snap(lonMin); lon <= lonMax; lon += step) {
    const x = px(lon);
    grid += `M${x.toFixed(1)},0 V${MAP_H}`;
    gridLabels.push({ x: x + 3, y: MAP_H - 10, t: `${Math.round(lon)}°` });
  }
  // Clamp to the poles — equirectangular has no geometry beyond ±90, and a
  // "100°" gridline would be nonsense.
  for (let lat = snap(Math.max(latMin, -85)); lat <= Math.min(latMax, 85); lat += step) {
    const y = py(lat);
    if (y < 12 || y > MAP_H - 22) continue; // clear of the top and the lon labels
    grid += `M0,${y.toFixed(1)} H${MAP_W}`;
    gridLabels.push({ x: 6, y: y - 4, t: `${Math.round(lat)}°` });
  }
  const eqY = py(0);
  const equatorY = eqY > 0 && eqY < MAP_H ? eqY : null;

  // ── lanes + nodes ──
  const outLanes: MapModel["lanes"] = [];
  const nodes: MapModel["nodes"] = [];
  const seen = new Set<string>();
  const counts = { sea: 0, road: 0, air: 0 };

  // Lanes that share a corridor (Antwerp→Douala and Paris CDG→Douala start ~500km
  // apart but converge on the same port) project almost on top of each other. Bow
  // them alternately to either side, fanning wider as the cluster grows, so each
  // stays separately traceable and hoverable.
  const cluster = new Map<string, number>();
  const clusterIndex = (l: Lane) => {
    // 5° buckets: close enough to overlap on screen, coarse enough not to split
    // two genuinely-adjacent ports into different clusters.
    const k = `${Math.round(l.from.lat / 5)},${Math.round(l.from.lng / 5)}>${Math.round(l.to.lat / 5)},${Math.round(l.to.lng / 5)}`;
    const n = cluster.get(k) ?? 0;
    cluster.set(k, n + 1);
    return n;
  };

  lanes.forEach((l, i) => {
    const x1 = px(l.from.lng), y1 = py(l.from.lat);
    const x2 = px(l.to.lng), y2 = py(l.to.lat);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    // Bow ∝ length: long hauls arc, a short corridor stays near-straight so it
    // doesn't read as a detour. Convention only — not the sailed track.
    const ci = clusterIndex(l);
    const side = ci % 2 === 0 ? 1 : -1;
    const spread = 1 + Math.floor(ci / 2) * 0.6;
    const bow = Math.min(len * 0.16, 70) * spread * side;
    const mx = (x1 + x2) / 2 + (-dy / len) * bow;
    const my = (y1 + y2) / 2 + (dx / len) * bow;
    const mode = l.mode === "road" || l.mode === "air" ? l.mode : "sea";
    counts[mode as "sea" | "road" | "air"] += 1;
    outLanes.push({
      id: `lane${i}`,
      d: `M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`,
      cls: mode === "road" ? "route-road" : mode === "air" ? "route-air" : "route-sea",
      title: `${l.ref} · ${l.from.name} → ${l.to.name} · ${l.status}`,
      dur: mode === "air" ? 9 : mode === "road" ? 11 : 15,
      marker: mode === "road" ? "rgb(var(--orange))" : "rgb(var(--blue-bright))",
    });
  });
  const mark = (p: Lane["from"], emphasis: boolean) => {
    const k = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
    if (seen.has(k)) return;
    seen.add(k);
    const x = px(p.lng);
    const y = py(p.lat);
    // Nudge a label off any already-placed one it would sit on top of. Ports
    // cluster (Antwerp and Paris CDG are ~5° apart and collide at this zoom), and
    // two overlapping names are less useful than one moved 12px. Alternates up
    // and down so a run of near-coincident nodes fans out rather than drifting.
    let dy = 0;
    for (let guard = 0; guard < 6; guard += 1) {
      const clash = nodes.some(
        (n) => Math.abs(n.x - x) < 84 && Math.abs(n.y + n.dy - (y + dy)) < 13,
      );
      if (!clash) break;
      dy = dy <= 0 ? -dy + 13 : -dy;
    }
    nodes.push({ x, y, name: p.name, emphasis, dy });
  };
  lanes.forEach((l) => mark(l.to, true));
  lanes.forEach((l) => mark(l.from, false));

  return { w: MAP_W, h: MAP_H, land, grid, gridLabels, equatorY, lanes: outLanes, nodes, counts };
}

type LiveData = {
  shipments: ReturnType<typeof toLiveShipment>[];
  lanes: Lane[];
  map: MapModel | null;
  activeCount: number;
  heroSub: string;
  briefing: string;
  /** Signed-in user's first name — the mock hardcodes "Amara" in greet(). */
  firstName: string;
  /** Current data environment, mirrored into the hero headline. See envWord. */
  envWord: string;
  isTest: boolean;
  kpi: {
    revenue: number | null;
    revenueCur: string;
    sla: number | null;
    fleetActive: number | null;
    fleetTotal: number | null;
    overdue: number | null;
  };
  drill: Record<string, Drill>;
};

/** Build the live-data injection script that runs after the mock's own script. */
function liveInjectionScript(live: LiveData): string {
  return `
(function(){
  var LIVE = ${JSON.stringify(live)};
  function esc(s){ return String(s==null?"":s).replace(/[&<>]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]; }); }
  function fmtM(v){ var n = Number(v) || 0; return (n/1e6).toFixed(1); }
  function icon(mode){
    if(mode==='sea') return '<svg viewBox="0 0 24 24"><path d="M3 14l9-4 9 4-9 5z"/><path d="M12 10V4"/></svg>';
    if(mode==='air') return '<svg viewBox="0 0 24 24"><path d="M2 12l20-7-7 20-3-8z"/></svg>';
    return '<svg viewBox="0 0 24 24"><path d="M3 7h11l4 4v4h-2"/><circle cx="7" cy="16" r="2"/><circle cx="16" cy="16" r="2"/></svg>';
  }
  function liveRow(d){
    // Route line: hide the whole row when neither end is known, rather than
    // drawing a lone arrow pointing at nothing (which is what shipped before).
    var routeLine = '';
    if(d.from || d.to){
      var label = d.from && d.to ? (esc(d.from) + ' &rarr; ' + esc(d.to)) : esc(d.from || d.to);
      routeLine = '<div class="rt"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'+label+'</div>';
    }
    // Progress is null when the dossier has no milestones instantiated — no bar,
    // because a 0%-width bar reads as "not started" and a default width lies.
    var bar = (d.prog === null || d.prog === undefined)
      ? ''
      : '<div class="bar" title="'+esc(d.prog)+'% of milestones complete"><i style="width:'+d.prog+'%"></i></div>';
    return '<div class="liverow">'
      + '<div class="ck '+d.mode+'">'+icon(d.mode)+'</div>'
      + '<div class="lb">'
      + '<div class="r1"><span class="ref">'+esc(d.ref)+'</span><span class="status '+d.stc+'" style="padding:2px 7px">'+esc(d.st)+'</span></div>'
      + routeLine
      + '<div class="meta">'+esc(d.meta)+'</div>'
      + bar
      + '</div></div>';
  }
  try {
    var list = document.getElementById('liveList');
    if(list){
      list.innerHTML = LIVE.shipments.length
        ? LIVE.shipments.slice(0,7).map(liveRow).join('')
        : '<div class="meta" style="padding:18px">No live shipments right now.</div>';
    }
    var pill = document.querySelector('.livepanel .lph .status');
    if(pill) pill.textContent = LIVE.activeCount + ' active';
    var hsub = document.querySelector('#v-home .hsub');
    if(hsub && LIVE.heroSub) hsub.textContent = LIVE.heroSub;
    var brief = document.querySelector('.praxis .pt p');
    if(brief && LIVE.briefing) brief.innerHTML = LIVE.briefing;
    // KPI strip: all four cards are live now. Order in the mock is
    // [revenue, sla, overdue, fleet]; any metric that resolves null hides its card
    // rather than showing a stale mock value.
    var cards = document.querySelectorAll('.kpis .kpi');
    function setKpi(i, kv, kd){ var c = cards[i]; if(!c) return; var a = c.querySelector('.kv'); if(a) a.innerHTML = kv; var b = c.querySelector('.kd'); if(b){ b.textContent = kd || ''; b.className = 'kd'; } }
    function hideKpi(i){ var c = cards[i]; if(c) c.style.display = 'none'; }
    var K = LIVE.kpi || {};
    if(K.revenue == null) hideKpi(0); else setKpi(0, fmtM(K.revenue) + '<small> M ' + esc(K.revenueCur || 'XAF') + '</small>', 'Locked FINAL invoices');
    if(K.sla == null) hideKpi(1); else setKpi(1, esc(K.sla) + '<small> %</small>', 'On-time delivery');
    if(K.overdue == null) hideKpi(2); else setKpi(2, fmtM(K.overdue) + '<small> M ' + esc(K.revenueCur || 'XAF') + '</small>', 'Past due (1–90+ days)');
    if(K.fleetTotal == null || Number(K.fleetTotal) === 0) hideKpi(3); else setKpi(3, esc(K.fleetActive || 0) + '<small> / ' + esc(K.fleetTotal) + ' vehicles</small>', 'Active now');
  } catch(e){ /* keep the mock visible even if injection fails */ }

  // ── Hero headline mirrors the data environment ──
  // The mock hardcodes "Your network, <em>live</em>." — which is a lie in TEST
  // mode, where every figure on this page comes from the sandbox schema. The <em>
  // is the orange accent word, so swapping its text keeps the typography intact.
  // In TEST we also tint it with the warning colour so the page reads differently
  // at a glance, matching the app shell's TEST banner.
  try {
    var titleEm = document.querySelector('#v-home .htitle em');
    if (titleEm && LIVE.envWord) {
      titleEm.textContent = LIVE.envWord;
      if (LIVE.isTest) titleEm.style.color = 'rgb(var(--warn, 234 179 8))';
    }
  } catch(e){}

  // ── Greeting ──
  // The mock's greet() computes the time of day but hardcodes the name, so every
  // user was greeted as "Amara". Re-run it with the signed-in user's first name.
  try {
    var g = document.getElementById('greet');
    if (g) {
      var h = new Date().getHours();
      var part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
      g.textContent = 'Good ' + part + (LIVE.firstName ? ', ' + LIVE.firstName : '');
    }
  } catch(e){}

  // ── Live shipment rows → the real dossier ──
  // liveRow() above renders without the mock's onclick="openDossier()", so these
  // rows carried real refs but did nothing when clicked. Send the ref up and let
  // the parent open Operations filtered to it.
  try {
    var rows = document.querySelectorAll('#liveList .liverow');
    for (var i = 0; i < rows.length; i++) {
      (function(row){
        var refEl = row.querySelector('.ref');
        var ref = refEl ? refEl.textContent.trim() : '';
        if (!ref || ref === '—') return;
        row.style.cursor = 'pointer';
        row.setAttribute('role', 'link');
        row.setAttribute('tabindex', '0');
        function goRef(){
          try { window.parent.postMessage({ type: 'praxis-dossier-nav', ref: ref }, '*'); } catch(e){}
        }
        row.onclick = goRef;
        row.onkeydown = function(ev){
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); goRef(); }
        };
      })(rows[i]);
    }
  } catch(e){}

  // ── Hero CTAs, floating search, clock ──
  // All of these ran the mock's internal navigation (go('ops') / go('finance') /
  // openPalette() / a fake timesheet modal). Route them into the real app.
  try {
    var heroBtns = document.querySelectorAll('#v-home .heroactions .btn');
    var HERO = ['Operations', 'Invoicing'];
    for (var b = 0; b < heroBtns.length; b++) {
      (function(btn, label){
        if (!label) return;
        btn.onclick = function(ev){
          if (ev && ev.preventDefault) ev.preventDefault();
          try { window.parent.postMessage({ type: 'praxis-app-nav', label: label }, '*'); } catch(e){}
          return false;
        };
      })(heroBtns[b], HERO[b]);
    }
    // The topbar/botnav/drawer copies of the palette trigger are hidden by
    // HIDE_CHROME, but the floating action button is not — it still opened the
    // mock's palette over the mock's own app list.
    var fab = document.querySelector('.fab');
    if (fab) {
      fab.onclick = function(ev){
        if (ev && ev.preventDefault) ev.preventDefault();
        try { window.parent.postMessage({ type: 'praxis-open-palette' }, '*'); } catch(e){}
        return false;
      };
    }
    // Clock in/out answered with a fabricated timesheet ("8h 12m today"). Send the
    // user to the real attendance screen instead of inventing hours.
    var clockBtn = document.querySelector('.floatbar .fb-btn[onclick*="openClock"]');
    if (clockBtn) {
      clockBtn.onclick = function(ev){
        if (ev && ev.preventDefault) ev.preventDefault();
        try { window.parent.postMessage({ type: 'praxis-app-nav', label: 'Attendance' }, '*'); } catch(e){}
        return false;
      };
    }
  } catch(e){}

  // ── Remove the mock's Praxis chat ──
  // It has a live-looking input but praxisSend() just cycles canned replies on a
  // timer, and it opens with "Hi Amara — I'm tracking 7 live dossiers". The real
  // assistant already renders app-side (components/praxis-copilot.tsx, mounted in
  // app-shell and self-gating on ai_enabled), so this is a fake duplicate.
  try {
    var fakeChatBtn = document.querySelector('.floatbar .fb-btn.praxis');
    if (fakeChatBtn && fakeChatBtn.parentNode) fakeChatBtn.parentNode.removeChild(fakeChatBtn);
    var fakePanel = document.getElementById('praxisPanel');
    if (fakePanel && fakePanel.parentNode) fakePanel.parentNode.removeChild(fakePanel);
  } catch(e){}

  // ── Recent activity ──
  // Four hardcoded rows (Bolloré, MSC Lucia, SLAS-INV-2026-0314, truck LT-4471).
  // There is no activity-feed endpoint, so rather than leave fiction sitting under
  // live KPIs, drop the section entirely. Restore it when a feed exists.
  try {
    var actCard = document.querySelector('#v-home .activity');
    if (actCard) {
      var actHead = actCard.previousElementSibling;
      if (actHead && actHead.classList.contains('sec')) actHead.parentNode.removeChild(actHead);
      actCard.parentNode.removeChild(actCard);
    }
  } catch(e){}

  // ── Map: real geography, plotted from real dossiers ──
  //
  // Replaces the mock's hand-drawn artwork (a stylised Cameroon+Chad landmass,
  // three hardcoded lanes, edge tags reading "ANTWERP" and "PARIS CDG" that
  // pointed at nothing) with an equirectangular projection of the actual POL→POD
  // pairs on open dossiers, resolved to coordinates server-side.
  //
  // COASTLINE is real: Natural Earth 110m via world-atlas, projected in the
  // parent (buildMapModel) and handed down as SVG path strings — the iframe
  // can't import modules. The mock's original stylised Cameroon+Chad blob had to
  // go regardless: it would be actively wrong once the viewport spans Antwerp to
  // Shanghai.
  //
  // This block is now a DUMB RENDERER. All projection, fitting and geometry lives
  // in buildMapModel() above, so land / graticule / lanes / nodes cannot drift
  // onto different projections.
  //
  // ARCS. Lanes bow slightly. That's the usual origin-destination convention and
  // keeps overlapping lanes legible; it is NOT a claim about the sailed track.
  try {
    var M = LIVE.map;
    var svg = document.querySelector('.mapsvg');
    var laneCount = M ? M.lanes.length : 0;
    // We replace the SVG's innerHTML, which would drop the mock's <defs> and
    // leave url(#ocean) resolving to nothing (transparent). Re-declare them.
    var DEFS = '<defs>'
      + '<linearGradient id="ocean" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="rgb(var(--blue-bright))" stop-opacity="0.12"/>'
      + '<stop offset="1" stop-color="rgb(var(--blue-deep))" stop-opacity="0.05"/>'
      + '</linearGradient>'
      // Same two stops the mock used for its stylised landmass, so the restored
      // look matches the original even though the shapes are now real.
      + '<linearGradient id="land" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="rgb(var(--ink))" stop-opacity="0.05"/>'
      + '<stop offset="1" stop-color="rgb(var(--ink))" stop-opacity="0.02"/>'
      + '</linearGradient></defs>';

    // Always drop the "sample view" badge — the map is no longer a sample.
    var stale = document.querySelector('[data-sample-badge]');
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);

    if (svg) {
      if (!M || !laneCount) {
        svg.innerHTML = DEFS
          + '<rect x="0" y="0" width="760" height="470" fill="url(#ocean)"/>'
          + '<text x="380" y="235" text-anchor="middle" class="node-sub">'
          + 'No plottable routes — open dossiers need a port of loading and discharge.</text>';
      } else {
        var landPath = M.land.length
          ? '<g fill="url(#land)" stroke="rgb(var(--ink) / 0.18)" stroke-width="0.8" stroke-linejoin="round">'
            + '<path d="' + M.land.join('') + '"/></g>'
          : '';
        var grid = '<path d="' + M.grid + '"/>';
        var labels = M.gridLabels.map(function(l){
          return '<text x="'+l.x.toFixed(1)+'" y="'+l.y.toFixed(1)+'" class="node-sub">'+esc(l.t)+'</text>';
        }).join('');
        var equator = M.equatorY === null ? ''
          : '<path d="M0,'+M.equatorY.toFixed(1)+' H760" stroke="rgb(var(--ink) / 0.16)" stroke-width="1.2" stroke-dasharray="6 5"/>';
        var routes = M.lanes.map(function(l){
          return '<path id="'+l.id+'" class="'+l.cls+'" fill="none" d="'+l.d+'">'
            + '<title>'+esc(l.title)+'</title></path>'
            + '<circle r="4" fill="'+l.marker+'" stroke="#fff" stroke-width="1.4">'
            + '<animateMotion dur="'+l.dur+'s" repeatCount="indefinite" rotate="auto">'
            + '<mpath href="#'+l.id+'"/></animateMotion></circle>';
        }).join('');
        var nodes = M.nodes.map(function(n){
          var col = n.emphasis ? 'rgb(var(--orange))' : 'rgb(var(--blue))';
          // Flip the label to the left near the right edge so it can't run off.
          var right = n.x > 640;
          var lx = right ? n.x - 9 : n.x + 9;
          var ly = n.y + 4 + (n.dy || 0);
          // When a label was nudged clear of a neighbour, tie it back to its dot
          // with a hairline so it's obvious which port it belongs to.
          var leader = (n.dy || 0) === 0 ? ''
            : '<path d="M'+n.x.toFixed(1)+','+n.y.toFixed(1)+' L'+lx.toFixed(1)+','+(ly-3.5).toFixed(1)+'" '
              + 'stroke="'+col+'" stroke-width="0.9" opacity="0.5" fill="none"/>';
          return leader
            + '<circle cx="'+n.x.toFixed(1)+'" cy="'+n.y.toFixed(1)+'" r="'+(n.emphasis?6:4.5)+'" fill="'+col+'" stroke="#fff" stroke-width="'+(n.emphasis?2:1.5)+'"/>'
            + '<text x="'+lx.toFixed(1)+'" y="'+ly.toFixed(1)+'" class="node-label"'
            + (right ? ' text-anchor="end"' : '') + '>'+esc(n.name)+'</text>';
        }).join('');
        // Draw order matters: ocean → land → graticule over land → equator →
        // degree labels → routes → nodes on top.
        svg.innerHTML = DEFS
          + '<rect x="0" y="0" width="760" height="470" fill="url(#ocean)"/>'
          + landPath
          + '<g stroke="rgb(var(--ink) / 0.06)" stroke-width="1" fill="none">'+grid+'</g>'
          + equator
          + '<g opacity="0.5">'+labels+'</g>'
          + routes + nodes;
      }
    }

    // Subtitle + footer counts, both hardcoded in the mock ("Douala gateway ·
    // West/Central Africa theatre", "3 vessels / 4 trucks / 1 flight", a frozen
    // "Updated live · 18:42").
    var sub = document.querySelector('.maphead p');
    if (sub) {
      sub.textContent = laneCount
        ? laneCount + ' route' + (laneCount === 1 ? '' : 's') + ' plotted from open operation files'
        : 'No routes to plot';
    }
    var foot = document.querySelector('.mapfoot');
    if (foot) {
      var n = M ? M.counts : { sea: 0, road: 0, air: 0 };
      var when = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      foot.innerHTML =
          '<span class="mf sea"><svg viewBox="0 0 24 24"><path d="M3 14l9-4 9 4-9 5z"/><path d="M12 10V4"/></svg>'+n.sea+' sea</span>'
        + '<span class="mf road"><svg viewBox="0 0 24 24"><path d="M3 7h11l4 4v4h-2"/><circle cx="7" cy="16" r="2"/><circle cx="16" cy="16" r="2"/></svg>'+n.road+' road</span>'
        + '<span class="mf air"><svg viewBox="0 0 24 24"><path d="M2 12l20-7-7 20-3-8z"/></svg>'+n.air+' air</span>'
        + '<span class="live">Updated '+when+'</span>';
    }
  } catch(e){ /* map is additive — never block the tower */ }

  // ── KPI drill-downs ──
  // The mock's openKpi renders its own sample rows and simulates an ~18% random
  // load failure. Both are wrong once the data is real, so we replace openKpi
  // outright (it's a top-level function declaration, hence a window property, so
  // the inline onclick="openKpi('revenue')" handlers pick this up). closeKpi and
  // setupKpiKeyboard are reused as-is — they only touch the DOM.
  try {
    var DRILL = LIVE.drill || {};
    function pill(tone, label){ return '<span class="status ' + esc(tone) + '">' + esc(label) + '</span>'; }
    function drillTable(d){
      var head = d.headers.map(function(h){ return '<th>' + esc(h) + '</th>'; }).join('');
      var body = d.rows.map(function(r){
        var last = r.cells.length - 1;
        var tds = r.cells.map(function(c, i){
          if(r.tone && i === last) return '<td>' + pill(r.tone, c) + '</td>';
          // Column 0 is the identifier, and the money column is right-aligned
          // numerals — same treatment the mock gives its own tables.
          if(i === 0) return '<td><span class="ref">' + esc(c) + '</span></td>';
          if(i === 2) return '<td><span class="num" style="font-weight:600">' + esc(c) + '</span></td>';
          return '<td>' + esc(c) + '</td>';
        }).join('');
        return '<tr>' + tds + '</tr>';
      }).join('');
      return '<div class="tablecard card" style="margin-top:4px"><table class="data">'
        + '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
    }
    function drillEmpty(msg){
      return '<div class="kpi-empty"><div class="ei"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor">'
        + '<path d="M20 6L9 17l-5-5"/></svg></div><b>All clear</b><p>' + esc(msg) + '</p></div>';
    }
    var openId = null;
    window.openKpi = function(id, opts){
      opts = opts || {};
      var d = DRILL[id];
      if(!d) return;
      openId = id;
      document.getElementById('kpiTitle').textContent = d.title || id;
      var chip = document.getElementById('kpiChip');
      chip.className = 'status ' + d.chip;
      chip.textContent = d.chipText;
      document.getElementById('kpiMeta').innerHTML = d.meta.map(function(m){ return '<span>' + m + '</span>'; }).join('');
      document.getElementById('kpiCta').innerHTML = esc(d.cta);
      document.getElementById('kpiBody').innerHTML = d.rows.length ? drillTable(d) : drillEmpty(d.empty);
      document.getElementById('kpiScrim').classList.add('show');
      // Keep the mock's deep-link behaviour so its closeKpi()/popstate still match.
      if(!opts.fromHash && location.hash !== '#kpi=' + id){
        history.pushState({ kpi: id }, '', '#kpi=' + id);
      }
      if(typeof setupKpiKeyboard === 'function') setupKpiKeyboard();
    };
    // The CTA leaves the mock entirely: ask the parent app to route. We send only
    // the card id — the parent owns the id→route map, so the iframe can't drive
    // navigation to an arbitrary path.
    window.kpiGoto = function(){
      var id = openId;
      if(typeof closeKpi === 'function') closeKpi();
      try { window.parent.postMessage({ type: 'praxis-kpi-nav', id: id }, '*'); } catch(e){}
    };
  } catch(e){ /* drill-downs are additive — never block the tower */ }

  // ── Application launcher ──
  // renderApps() hardcodes onclick="go('ops')" on every tile, so all twelve
  // opened the mock's sample Operations view. Rebind each tile to the real app.
  // We rewrite the rendered DOM rather than redefining renderApps, because the
  // mock already called it on load — and doing it this way keeps working if the
  // mock's markup changes, since we only depend on the .lt tiles inside #launch.
  try {
    var tiles = document.querySelectorAll('#launch .lt');
    for (var t = 0; t < tiles.length; t++) {
      (function(tile){
        var labelEl = tile.querySelector('b');
        var label = labelEl ? labelEl.textContent.trim() : '';
        tile.onclick = function(){
          try { window.parent.postMessage({ type: 'praxis-app-nav', label: label }, '*'); } catch(e){}
        };
        // The mock styles .lt as clickable already; make the affordance honest
        // for keyboard users too, since these are divs rather than buttons.
        tile.setAttribute('role', 'link');
        tile.setAttribute('tabindex', '0');
        tile.onkeydown = function(ev){
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tile.onclick(); }
        };
      })(tiles[t]);
    }
    // "Browse all 39 →" opens the mock's own palette, which searches the mock's
    // sample app list and then calls go() — same dead end. Point it at the real
    // command palette instead; the parent owns what that means.
    var browse = document.querySelector('.sec a[onclick*="openPalette"]');
    if (browse) {
      browse.onclick = function(ev){
        if (ev && ev.preventDefault) ev.preventDefault();
        try { window.parent.postMessage({ type: 'praxis-open-palette' }, '*'); } catch(e){}
        return false;
      };
    }
  } catch(e){ /* launcher rebinding is additive — never block the tower */ }

  // Track the app's light/dark theme (parent uses a .dark class; mock uses data-theme).
  function syncTheme(){
    try {
      var dark = window.parent.document.documentElement.classList.contains('dark');
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    } catch(e){}
  }
  syncTheme();
  try { new MutationObserver(syncTheme).observe(window.parent.document.documentElement, { attributes:true, attributeFilter:['class'] }); } catch(e){}
})();
`;
}

/** CSS that hides the mock's own app chrome so it sits inside the real app shell. */
const HIDE_CHROME = `
  .testban, header.topbar, .botnav, .drawer, .drawer-scrim { display: none !important; }
  /* The mock's own floating sun-FAB and clock/quick-tools floatbar are removed —
     the real app provides a single draggable action cluster (floating-actions.tsx). */
  .fab, .floatbar { display: none !important; }
  html, body { background: transparent; }
  .app { min-height: auto; }
  .scroll { padding-top: 8px; height: auto; overflow: visible; }
`;

function buildSrcDoc(live: LiveData | null): string {
  const inject = live ? `<script>${liveInjectionScript(live)}</script>` : "";
  return `<!doctype html><html data-theme="light"><head><meta charset="utf-8" />
<style>${mockStyle}\n${HIDE_CHROME}</style></head>
<body>${mockBody}
<script>${mockScript}</script>
${inject}
</body></html>`;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [live, setLive] = React.useState<LiveData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // The mock greets "Amara" regardless of who signed in. Take the first word of
  // the display name; fall back to the email local part, then to no name at all
  // (a bare "Good evening" reads fine — an invented name doesn't).
  const firstName = React.useMemo(() => {
    const display = str(user?.display_name).trim();
    if (display) return display.split(/\s+/)[0];
    const email = str(user?.email);
    return email ? email.split("@")[0] : "";
  }, [user]);

  // The iframe asks the parent to navigate — it never routes itself. It sends an
  // identifier only (a KPI card id, or an app tile's label) and the id→route maps
  // live here, so the iframe can't reach an arbitrary path.
  React.useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data as { type?: string; id?: string; label?: string; ref?: string } | null;
      if (!d) return;
      if (d.type === "praxis-kpi-nav") {
        const to = d.id ? KPI_ROUTE[d.id] : null;
        if (to) navigate(to);
        return;
      }
      if (d.type === "praxis-app-nav") {
        const to = d.label ? APP_ROUTE[d.label] : null;
        if (to) navigate(to);
        return;
      }
      if (d.type === "praxis-dossier-nav") {
        // There's no dossier-detail route — Operations is a list — so we deep-link
        // its search instead. The ref is the only thing the iframe controls, and it
        // lands in a query param, never in the path.
        if (d.ref) navigate(`/operations/files?ref=${encodeURIComponent(d.ref)}`);
        return;
      }
      if (d.type === "praxis-open-palette") {
        // The ⌘K palette's open state lives in app-shell, which owns it via a
        // document keydown listener — there's no prop or context reaching down
        // here. Re-firing the app's own shortcut is the least invasive way to
        // ask for it; lifting that state into context would be the tidier fix
        // if anything else ever needs to open the palette programmatically.
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
        );
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      tenant<Row>("/dashboard/control-tower").catch(() => ({}) as Row),
      tenant<Row>("/dashboard/kpis").catch(() => ({}) as Row),
      // Past-due receivables, invoice-level and net of receipts. Feeds BOTH the
      // KPI card and its drill-down so the two always agree (MOD-52, gated
      // `accounting.core`) → null when off, card hides.
      tenant<OverduePayload>("/receivables/overdue").catch(() => null),
      // Drill-down sources. Each is a list the user may or may not be entitled to
      // read — a 403 yields null and that card's detail shows its empty state.
      tenant<Row[]>("/final-invoices").catch(() => null),
      tenant<Row[]>("/clients").catch(() => null),
      tenant<Row[]>("/operations").catch(() => null),
      tenant<Row[]>("/vehicles").catch(() => null),
    ])
      .then(([ct, kpis, overdue, invoices, clients, dossiers, vehicles]) => {
        if (!alive) return;
        const rawShips = Array.isArray(ct.live_shipments) ? (ct.live_shipments as Row[]) : [];
        const shipments = rawShips.map(toLiveShipment);
        const of = (ct.operation_files as Row) || {};
        const active = Number(of.active ?? of.open ?? shipments.length) || shipments.length;
        const approvals = Number(ct.approvals_awaiting ?? kpis.approvals_awaiting ?? 0) || 0;
        const flags = Number(kpis.open_compliance_flags ?? kpis.compliance_flags ?? 0) || 0;
        const unposted = Number(kpis.unposted_journals ?? 0) || 0;
        const heroSub =
          `${active} operation file${active === 1 ? "" : "s"} in motion` +
          (approvals ? ` — ${approvals} awaiting your approval.` : ".");
        // tokenStore.getEnv() is the same value api-client sends as X-Praxis-Env,
        // so anything keyed off it can never disagree with the schema the data
        // came from. It returns 'live' | 'sandbox'; the UI calls the latter TEST
        // everywhere (segmented control, banner), so we say "test", not "sandbox".
        const isTest = tokenStore.getEnv() !== "live";
        const briefing =
          `<b>${active}</b> active operation file${active === 1 ? "" : "s"}` +
          (approvals ? `, <b>${approvals}</b> awaiting approval` : "") +
          (flags ? `, <b>${flags}</b> open compliance flag${flags === 1 ? "" : "s"}` : "") +
          (unposted ? `, <b>${unposted}</b> unposted journal${unposted === 1 ? "" : "s"}` : "") +
          (isTest ? ". Sandbox data — Control Tower in TEST." : ". Live from the Control Tower.");
        const cur = str(kpis.revenue_currency || "XAF");
        const clientName: Record<string, string> = {};
        (clients || []).forEach((c) => { clientName[str(c.client_id)] = str(c.name); });

        const lanes = toLanes(rawShips);

        setLive({
          shipments,
          lanes,
          map: buildMapModel(lanes),
          activeCount: active,
          heroSub,
          briefing,
          firstName,
          envWord: isTest ? "test" : "live",
          isTest,
          kpi: {
            revenue: numOrNull(kpis.revenue_final_ttc),
            revenueCur: cur,
            sla: numOrNull(kpis.sla_on_time_pct),
            fleetActive: numOrNull(kpis.fleet_active),
            fleetTotal: numOrNull(kpis.fleet_total),
            overdue: overdue ? numOrNull(overdue.total) : null,
          },
          drill: {
            revenue: buildRevenueDrill(invoices, clientName, cur),
            sla: buildSlaDrill(dossiers),
            overdue: buildOverdueDrill(overdue, clientName, cur),
            fleet: buildFleetDrill(vehicles),
          },
        });
      })
      .catch((e) => alive && setError(errMsg(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // firstName is in the deps so the greeting can't go stale against the session.
    // It only changes when the signed-in user does, so this doesn't add refetches.
  }, [firstName]);

  const srcDoc = React.useMemo(() => buildSrcDoc(live), [live]);

  if (loading) return <PageSkeleton tiles={4} rows={5} cols={5} />;
  if (error) return <ErrorState message={error} />;

  return (
    <iframe
      title="Control Tower"
      srcDoc={srcDoc}
      className="h-[calc(100vh-7rem)] w-full border-0"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
