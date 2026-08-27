/**
 * The attendance map — punches as pins, worksites as fences, and (only for
 * somebody who may see them) the operations lanes underneath.
 *
 * ── IT IS THE SAME MAP AS OPERATIONS, NOT A SECOND ONE ─────────────────────
 *
 * Decision 8 asks for the "same family as operations orders", and the way that
 * is honoured is by REUSING the Control Tower's projection (`buildMapModel`)
 * rather than restating it. Two projections in one product means a pin and the
 * yard it was taken at can land in different places, and nobody can tell which
 * of the two is lying. `buildMapModel` gained one additive option for this —
 * `points`, which fold into the same viewport fit — so an attendance-only user
 * with no lanes at all still gets a fitted map instead of `null`.
 *
 * ── AND IT IS RBAC-GATED, WHICH IS WHY THE CLIENT DOES NOT CHOOSE ──────────
 *
 * The pins are whatever `/attendance/map` returned. The server decided the
 * scope from the caller's grants and says which row of the matrix they landed
 * on; this component never picks between a "team" and a "self" request. A
 * client that chose would be the thing enforcing the boundary, and the first
 * bug in it would be a colleague's coordinates.
 *
 * The lanes are fetched SEPARATELY, from the Control Tower's own endpoint,
 * and only when the map payload said the caller holds that grant. So an
 * attendance-only manager never makes the request at all, and HR does not carry
 * a second copy of the operations query.
 *
 * ── NO TILES IS NOT A BROKEN MAP ───────────────────────────────────────────
 *
 * Preview tiles need a platform Geoapify key. Without one the map degrades to
 * coastline, fences and pins — which is most of what it was for — plus an OSM
 * link per pin, rather than an empty grey rectangle that reads as an outage.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { tenant } from "@/lib/api-client";
import * as api from "@/lib/hr-api";
import {
  buildMapModel,
  landPaths,
  MAP_H,
  MAP_W,
} from "@/features/dashboard/map/projection";
import { useLandRings } from "@/features/dashboard/map/use-land";
import { LANE_STROKE } from "@/features/dashboard/map/shipment-map";
import { toLanes, type Lane, type Row } from "@/features/dashboard/model";

/** Metres per degree of latitude — good to a fraction of a percent anywhere,
 *  and this is a fence drawn at country zoom, not a survey. */
const M_PER_DEG_LAT = 111320;

/** Pin colour by what the punch's location actually was. Deliberately the same
 *  three words the pills use, so the map and the table cannot disagree. */
const PIN_FILL: Record<string, string> = {
  on_site: "rgb(var(--ok))",
  off_site: "rgb(var(--bad))",
  unfenced: "rgb(var(--warn))",
  no_gps: "rgb(var(--muted-foreground))",
};

const pinFill = (status?: string | null) =>
  (status && PIN_FILL[status]) || "rgb(var(--muted-foreground))";

/** Where a coordinate can be looked at without a provider key. */
const osmLink = (lat: number, lng: number) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

export type MapPoint = { lat: number; lng: number };

/* ── The canvas ───────────────────────────────────────────────────────────── */

/**
 * Pure presentation: it is handed the pins it may draw and draws them. No
 * fetching and no permission logic, so the two containers below (the HR tab and
 * My HR's own-pins strip) cannot end up applying different rules to the same
 * picture.
 */
export function AttendanceMapCanvas({
  punches,
  worksites = [],
  lanes = [],
  tiles = null,
  noGpsCount = 0,
  emptyHint,
}: {
  punches: api.MapPunch[];
  worksites?: api.MapWorkSite[];
  lanes?: Lane[];
  tiles?: "geoapify" | null;
  noGpsCount?: number;
  emptyHint?: string;
}) {
  const rings = useLandRings();
  /*
   * Two states, not one. With a single `active` toggled by both handlers, a
   * mouse user's click ARRIVES AFTER their own mouseenter has already selected
   * the pin — so clicking a pin closed the card that hovering had just opened,
   * which reads as the map refusing to open. Hover previews; a click pins the
   * card open and clicking again releases it. Keyboard and touch reach the same
   * card through the click path alone.
   */
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [pinned, setPinned] = React.useState<string | null>(null);
  const active = pinned || hovered;

  const model = React.useMemo(() => {
    // Everything that must be inside the frame: the pins AND the fences. A fit
    // computed from the pins alone would push a worksite circle off the edge
    // exactly when nobody clocked in near it, which is the case you most want
    // to see.
    const points: MapPoint[] = [
      ...punches.map((p) => ({ lat: p.latitude, lng: p.longitude })),
      ...worksites.map((w) => ({ lat: w.latitude, lng: w.longitude })),
    ];
    return buildMapModel(lanes, { points });
  }, [punches, worksites, lanes]);

  // `useLandRings` resolves to null until the 110m outlines have arrived, and
  // deliberately stays null if they never do — the coast is drawn BEHIND
  // everything, so a map without it is complete, just plainer.
  const land = React.useMemo(
    () => (model && rings && rings.length ? landPaths(model, rings) : ""),
    [model, rings],
  );

  if (!model) {
    return (
      <EmptyState
        title={tr("Nothing to map")}
        hint={
          emptyHint ||
          tr(
            "No punch in this window carried a location. Punches without GPS are still recorded — they are flagged, not placed.",
          )
        }
      />
    );
  }

  const activePunch = punches.find((p) => p.attendance_id === active) || null;

  return (
    <div>
      <div className="rounded-lg border bg-[rgb(var(--surface-2))]">
        <svg
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          className="h-auto w-full"
          role="img"
          aria-label={tr("Map of clock-in locations")}
        >
          {land && (
            <path d={land} fill="rgb(var(--muted))" stroke="none" opacity={0.55} />
          )}
          <path d={model.grid} stroke="rgb(var(--border))" strokeWidth={0.5} fill="none" />

          {/* Lanes UNDER everything HR. They are context for where the work is,
              not the subject of this screen, so they are drawn thin and dimmed
              — but in the operations map's own per-mode colours, read from the
              one exported table, so the two screens never describe the same
              leg in different colours. */}
          {model.lanes.map((l) => (
            <path
              key={l.id}
              d={l.d}
              fill="none"
              stroke={LANE_STROKE[l.mode]}
              strokeWidth={1.25}
              strokeDasharray="4 3"
              opacity={0.4}
            >
              <title>{l.title}</title>
            </path>
          ))}

          {/* Worksite geofences. The radius is projected by measuring a point
              one radius NORTH of the centre through the same projection —
              rather than inventing a metres-per-pixel constant, which would be
              wrong at every zoom but one. */}
          {worksites.map((w) => {
            const c = model.project(w.longitude, w.latitude);
            const edge = model.project(
              w.longitude,
              w.latitude + w.radius_m / M_PER_DEG_LAT,
            );
            const r = Math.max(3, Math.abs(c.y - edge.y));
            return (
              <g key={w.work_site_id}>
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={r}
                  fill="rgb(var(--primary))"
                  fillOpacity={0.08}
                  stroke="rgb(var(--primary))"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                  strokeDasharray="3 2"
                />
                <circle cx={c.x} cy={c.y} r={2.5} fill="rgb(var(--primary))" />
                <title>{`${w.name} — ${w.radius_m} m`}</title>
              </g>
            );
          })}

          {/* Pins last, so a punch is never hidden under a fence. */}
          {punches.map((p) => {
            const { x, y } = model.project(p.longitude, p.latitude);
            const on = active === p.attendance_id;
            return (
              <g key={p.attendance_id}>
                <circle
                  cx={x}
                  cy={y}
                  r={on ? 6 : 4}
                  fill={pinFill(p.location_status)}
                  stroke="rgb(var(--surface-1))"
                  strokeWidth={1.25}
                  className="cursor-pointer"
                  onMouseEnter={() => setHovered(p.attendance_id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() =>
                    setPinned(pinned === p.attendance_id ? null : p.attendance_id)
                  }
                >
                  <title>
                    {[p.employee_name, dateFmt(p.clock_in_at), p.geo_label]
                      .filter(Boolean)
                      .join(" · ")}
                  </title>
                </circle>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="micro normal-case text-muted-foreground">
          {punches.length} {tr("pin(s)")}
          {worksites.length ? ` · ${worksites.length} ${tr("worksite(s)")}` : ""}
          {model.lanes.length ? ` · ${model.lanes.length} ${tr("order leg(s)")}` : ""}
        </span>
        {noGpsCount > 0 && (
          /* Counted, never placed. Inventing a coordinate for a punch that had
             none is the spoofing the guide forbids; dropping them in silence
             makes the map read as "everybody was on site". */
          <Pill tone="mute">
            {noGpsCount} {tr("punch(es) with no location")}
          </Pill>
        )}
        {!tiles && (
          <span className="micro normal-case text-muted-foreground">
            {tr("No map tiles configured — open a pin to view it on OpenStreetMap.")}
          </span>
        )}
      </div>

      {activePunch && (
        <div className="mt-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">
              {activePunch.employee_name || "—"}
            </span>
            <span className="num micro text-muted-foreground">
              {dateFmt(activePunch.clock_in_at)}
            </span>
            {activePunch.location_status && (
              <Pill
                tone={
                  activePunch.location_status === "on_site"
                    ? "ok"
                    : activePunch.location_status === "off_site"
                      ? "bad"
                      : "mute"
                }
              >
                {activePunch.location_status}
              </Pill>
            )}
          </div>
          <p className="micro normal-case text-muted-foreground">
            {activePunch.geo_label || tr("No place name")}
            {activePunch.distance_m != null
              ? ` · ${Math.round(activePunch.distance_m)} m ${tr("from the worksite")}`
              : ""}
            {activePunch.device_label ? ` · ${activePunch.device_label}` : ""}
          </p>
          <p className="num micro text-muted-foreground">
            {activePunch.latitude.toFixed(5)}, {activePunch.longitude.toFixed(5)}{" "}
            <a
              className="underline"
              href={osmLink(activePunch.latitude, activePunch.longitude)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {tr("Open on OpenStreetMap")}
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

/* ── My HR: the caller's own pins ─────────────────────────────────────────── */

/**
 * The last unfinished PR2 contract item (guide §3.2, "own map pins only").
 *
 * Reads `/attendance/punches/mine`, which resolves the employee from the TOKEN
 * — not `/attendance/map`, which would hand an HR manager looking at their own
 * My HR page the whole team's pins. The endpoint is the boundary here, not a
 * filter applied afterwards.
 */
export function MyAttendanceMap({ from, to }: { from: string; to: string }) {
  const punches = useResource(() => api.myPunches({ from, to }), [from, to]);

  const { pins, noGps } = React.useMemo(() => {
    const rows = punches.data || [];
    const out: api.MapPunch[] = [];
    let missing = 0;
    for (const r of rows) {
      const lat = Number(r.latitude);
      const lng = Number(r.longitude);
      // `Number(null)` is 0, so presence is tested before the coercion — a
      // finite check alone would pin every no-GPS punch at 0°N 0°E.
      if (r.latitude == null || r.longitude == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        missing += 1;
        continue;
      }
      out.push({
        attendance_id: r.attendance_id,
        employee_id: r.employee_id || "",
        employee_name: r.employee_name || null,
        clock_in_at: r.clock_in_at || null,
        clock_out_at: r.clock_out_at || null,
        latitude: lat,
        longitude: lng,
        distance_m: r.distance_m == null ? null : Number(r.distance_m),
        within_geofence: r.within_geofence ?? null,
        geo_label: r.geo_label || null,
        location_status: r.location_status,
      });
    }
    return { pins: out, noGps: missing };
  }, [punches.data]);

  if (punches.error) return <ErrorState message={errMsg(punches.error)} />;
  if (punches.loading && !punches.data) {
    return <div className="micro text-muted-foreground">{tr("Loading…")}</div>;
  }

  return (
    <AttendanceMapCanvas
      punches={pins}
      noGpsCount={noGps}
      emptyHint={tr(
        "None of your punches in this window carried a location. A punch without GPS still counts — it is flagged, not refused.",
      )}
    />
  );
}

/* ── HR: the Map tab ──────────────────────────────────────────────────────── */

export function AttendanceMapTab({
  from,
  to,
  className,
}: {
  from: string;
  to: string;
  className?: string;
}) {
  const map = useResource(() => api.attendanceMap({ from, to }), [from, to]);
  const allowedOps = !!map.data?.ops.allowed;

  /*
   * The lanes, from the Control Tower's OWN endpoint — and only once the map
   * payload has confirmed the grant. Requesting them first and letting a 403
   * decide would put a permission error on the screen of every attendance-only
   * manager, for a layer they were never offered.
   */
  const tower = useResource(
    () => (allowedOps ? tenant<Row>("/dashboard/control-tower") : Promise.resolve(null)),
    [allowedOps],
  );

  const lanes = React.useMemo<Lane[]>(() => {
    if (!allowedOps || !tower.data) return [];
    const raw = Array.isArray(tower.data.live_shipments)
      ? (tower.data.live_shipments as Row[])
      : [];
    return toLanes(raw);
  }, [allowedOps, tower.data]);

  if (map.error) return <ErrorState message={errMsg(map.error)} />;
  if (map.loading && !map.data) {
    return <div className="micro text-muted-foreground">{tr("Loading…")}</div>;
  }

  const data = map.data;
  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground">{tr("Map")}</h2>
        <p className="micro normal-case text-muted-foreground">
          {data?.scope === "self"
            ? tr("Your own clock-in locations. Other people's pins need the attendance view grant.")
            : tr("Clock-in locations and worksite geofences for the window.")}
          {allowedOps ? " " + tr("Order legs are shown underneath.") : ""}
        </p>
      </div>
      {data?.truncated && (
        <p className="micro normal-case text-[rgb(var(--warn))]">
          {tr("Too many punches to plot them all — narrow the window.")}
        </p>
      )}
      <AttendanceMapCanvas
        punches={data?.punches || []}
        worksites={data?.worksites || []}
        lanes={lanes}
        tiles={data?.tiles ?? null}
        noGpsCount={data?.no_gps_count || 0}
      />
    </div>
  );
}
