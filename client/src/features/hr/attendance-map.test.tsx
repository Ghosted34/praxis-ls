/**
 * The attendance map tab and My HR's own pins (PR3).
 *
 * WHAT THESE PIN
 *
 *   - A pin is only ever drawn for a punch that HAD a coordinate. `Number(null)`
 *     is 0, so the failure mode is not a missing pin — it is a confident one in
 *     the Gulf of Guinea, which reads as a plausible outlier rather than as a
 *     null.
 *   - The ops overlay is fetched ONLY when the server said the caller holds the
 *     grant. An attendance-only manager must not fire a request that 403s, and
 *     must not see a commercial lane.
 *   - My HR reads `/attendance/punches/mine`, never the map endpoint. That is
 *     the boundary for "own pins only": an HR manager on their own My HR page
 *     must see themselves, not their team.
 *   - No tile key degrades to an OSM link rather than to a broken-looking map.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Hoisted: `vi.mock` factories run before the module body, so a plain `const`
 *  declared below would not exist yet when the factory closes over it. */
const h = vi.hoisted(() => ({ tenantSpy: vi.fn() }));

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const base = await apiClientMock();
  return {
    ...base,
    // Delegates to the harness's fixture resolver, but records the PATH — the
    // "did this screen even ask for the lanes" assertion is the point.
    tenant: (p: string, ...rest: unknown[]) => {
      h.tenantSpy(p);
      return (base.tenant as (...a: unknown[]) => unknown)(p, ...rest);
    },
  };
});
vi.mock("@/app/auth/auth-context", async () => {
  const { authContextMock } = await import("@/test/screen-harness");
  return authContextMock();
});

const attendanceMap = vi.fn();
const myPunches = vi.fn();
vi.mock("@/lib/hr-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hr-api")>("@/lib/hr-api");
  return {
    ...actual,
    attendanceMap: (...a: unknown[]) => attendanceMap(...a),
    myPunches: (...a: unknown[]) => myPunches(...a),
  };
});

// The coastline is a 500 kB dynamic import that adds nothing to these
// assertions; the component is built to render without it (land is drawn
// behind everything, so it may arrive late or never).
vi.mock("@/features/dashboard/map/use-land", () => ({ useLandRings: () => null }));

import { renderScreen } from "@/test/screen-harness";
import { AttendanceMapTab, MyAttendanceMap } from "./attendance-map";
import type { AttendanceMap, MapPunch, AttendanceRow } from "@/lib/hr-api";

const FROM = "2026-08-03";
const TO = "2026-08-07";

const pin = (over: Partial<MapPunch> = {}): MapPunch => ({
  attendance_id: "p1",
  employee_id: "e1",
  employee_name: "Ada Mbarga",
  clock_in_at: "2026-08-03T06:20:00Z",
  clock_out_at: null,
  latitude: 4.05,
  longitude: 9.7,
  distance_m: 12,
  within_geofence: true,
  geo_label: "Bonabéri yard",
  location_status: "on_site",
  ...over,
});

const mapPayload = (over: Partial<AttendanceMap> = {}): AttendanceMap => ({
  from: FROM,
  to: TO,
  scope: "team",
  punches: [pin()],
  worksites: [
    { work_site_id: "s1", name: "Bonabéri yard", latitude: 4.0501, longitude: 9.7001, radius_m: 150 },
  ],
  no_gps_count: 0,
  truncated: false,
  timezone: "Africa/Douala",
  tiles: null,
  ops: { allowed: false },
  ...over,
});

/** The `coords` projection `toLanes` plots when a file carries no itinerary
 *  legs — the minimum shape that yields one drawable lane. */
const TOWER = {
  live_shipments: [
    {
      dossier_id: "d1",
      ref: "OPS-1",
      mode: "SEA",
      status: "IN_TRANSIT",
      origin: "Douala",
      destination: "Antwerp",
      coords: {
        from: { name: "Douala", latitude: 4.05, longitude: 9.7 },
        to: { name: "Antwerp", latitude: 51.22, longitude: 4.4 },
      },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  attendanceMap.mockResolvedValue(mapPayload());
  myPunches.mockResolvedValue([]);
});

/* ── The HR map tab ───────────────────────────────────────────────────────── */

describe("AttendanceMapTab", () => {
  it("asks for the window it was given, and draws the pins and the fence", async () => {
    const { container } = renderScreen(<AttendanceMapTab from={FROM} to={TO} />);
    await waitFor(() => expect(attendanceMap).toHaveBeenCalledWith({ from: FROM, to: TO }));
    await screen.findByText(/1 pin/);
    // One punch pin, plus the fence ring and its centre dot.
    expect(container.querySelectorAll("svg circle").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/1 worksite\(s\)/)).toBeInTheDocument();
  });

  it("does NOT fetch the operations lanes without the grant", async () => {
    renderScreen(<AttendanceMapTab from={FROM} to={TO} />, {
      routes: { "/dashboard/control-tower": TOWER },
    });
    await screen.findByText(/1 pin/);
    // Attendance-only HR must never see commercial lanes — and must not fire a
    // request that would 403 on their behalf.
    expect(h.tenantSpy).not.toHaveBeenCalledWith("/dashboard/control-tower");
    expect(screen.queryByText(/order leg/)).not.toBeInTheDocument();
  });

  it("fetches and draws the lanes when the server says the caller may see them", async () => {
    attendanceMap.mockResolvedValue(mapPayload({ ops: { allowed: true } }));
    renderScreen(<AttendanceMapTab from={FROM} to={TO} />, {
      routes: { "/dashboard/control-tower": TOWER },
    });
    await waitFor(() =>
      expect(h.tenantSpy).toHaveBeenCalledWith("/dashboard/control-tower"),
    );
    expect(await screen.findByText(/order leg/)).toBeInTheDocument();
  });

  it("counts no-GPS punches instead of pinning them", async () => {
    attendanceMap.mockResolvedValue(mapPayload({ punches: [pin()], no_gps_count: 3 }));
    renderScreen(<AttendanceMapTab from={FROM} to={TO} />);
    // Never placed at 0,0 — said out loud instead.
    expect(await screen.findByText(/3 punch\(es\) with no location/)).toBeInTheDocument();
  });

  it("degrades to an OSM link when no tile provider is configured", async () => {
    const { container } = renderScreen(<AttendanceMapTab from={FROM} to={TO} />);
    expect(await screen.findByText(/No map tiles configured/)).toBeInTheDocument();

    const dots = container.querySelectorAll("svg circle");
    await userEvent.click(dots[dots.length - 1]);
    const link = await screen.findByRole("link", { name: /OpenStreetMap/i });
    expect(link.getAttribute("href")).toContain("mlat=4.05");
    expect(link.getAttribute("href")).toContain("mlon=9.7");
  });

  it("says so when the window was cut short rather than showing a partial map silently", async () => {
    attendanceMap.mockResolvedValue(mapPayload({ truncated: true }));
    renderScreen(<AttendanceMapTab from={FROM} to={TO} />);
    expect(await screen.findByText(/Too many punches to plot/)).toBeInTheDocument();
  });

  it("tells a self-scoped caller that the pins are only their own", async () => {
    attendanceMap.mockResolvedValue(mapPayload({ scope: "self", worksites: [] }));
    renderScreen(<AttendanceMapTab from={FROM} to={TO} />);
    expect(await screen.findByText(/Your own clock-in locations/)).toBeInTheDocument();
  });

  it("renders an honest empty state when nothing in the window had a location", async () => {
    attendanceMap.mockResolvedValue(mapPayload({ punches: [], worksites: [], no_gps_count: 2 }));
    renderScreen(<AttendanceMapTab from={FROM} to={TO} />);
    expect(await screen.findByText(/Nothing to map/)).toBeInTheDocument();
  });
});

/* ── My HR: own pins only ─────────────────────────────────────────────────── */

describe("MyAttendanceMap", () => {
  const row = (over: Partial<AttendanceRow> = {}): AttendanceRow => ({
    attendance_id: "p1",
    employee_id: "me",
    employee_name: "Ada Mbarga",
    clock_in_at: "2026-08-03T06:20:00Z",
    latitude: 4.05,
    longitude: 9.7,
    within_geofence: true,
    geo_label: "Bonabéri yard",
    location_status: "on_site",
    ...over,
  });

  it("reads /punches/mine — NOT the map endpoint", async () => {
    myPunches.mockResolvedValue([row()]);
    renderScreen(<MyAttendanceMap from={FROM} to={TO} />);
    await waitFor(() => expect(myPunches).toHaveBeenCalledWith({ from: FROM, to: TO }));
    // The map endpoint would hand an HR manager their whole team on their own
    // My HR page. The boundary is the endpoint, not a filter applied after.
    expect(attendanceMap).not.toHaveBeenCalled();
  });

  it("never pins a punch that had no coordinates", async () => {
    myPunches.mockResolvedValue([
      row(),
      row({ attendance_id: "p2", latitude: null, longitude: null, location_status: "no_gps" }),
    ]);
    const { container } = renderScreen(<MyAttendanceMap from={FROM} to={TO} />);
    await screen.findByText(/1 pin/);
    // `Number(null)` is 0: without a presence check this would be a second,
    // confident pin at 0°N 0°E rather than a missing one.
    expect(container.querySelectorAll("svg circle")).toHaveLength(1);
    expect(screen.getByText(/1 punch\(es\) with no location/)).toBeInTheDocument();
  });

  it("draws no worksite fences — the site register is not 'my attendance'", async () => {
    myPunches.mockResolvedValue([row()]);
    renderScreen(<MyAttendanceMap from={FROM} to={TO} />);
    await screen.findByText(/1 pin/);
    expect(screen.queryByText(/worksite\(s\)/)).not.toBeInTheDocument();
  });

  it("explains an empty map rather than showing a blank box", async () => {
    myPunches.mockResolvedValue([]);
    renderScreen(<MyAttendanceMap from={FROM} to={TO} />);
    expect(await screen.findByText(/Nothing to map/)).toBeInTheDocument();
    expect(screen.getByText(/it is flagged, not refused/)).toBeInTheDocument();
  });
});
