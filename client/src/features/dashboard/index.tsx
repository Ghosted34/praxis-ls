/**
 * Control Tower — the home screen.
 *
 * PHASE 3 / AUDIT F1. This was 1,196 lines of React that rendered no React: it
 * built an HTML string from three raw text assets (1,440 more lines) and injected
 * it into an `<iframe srcDoc>`, then grafted live data on by generating a
 * `<script>` that rewrote the frame's DOM with `innerHTML`, bridged navigation
 * over `postMessage`, and tracked the theme with a `MutationObserver` watching
 * `window.parent.document`. Everything that cost:
 *
 *   - A SECOND DESIGN SYSTEM. The frame shipped its own 584-line stylesheet
 *     redefining `--ink`, `--ok`, `--warn`, `.micro`, `.status` and `.st-*`. It
 *     had to be hand-patched twice already to track Phase 1's token retune, and
 *     `--primary` was never forwarded into it at all — so the white-label
 *     promise, the product's core commercial claim, did not reach the first
 *     screen every user sees. It does now: the map's road corridors, the KPI
 *     tints and the launcher all resolve `--primary`.
 *   - NO DESKTOP. The frame's own breakpoints stopped at `max-width: 1180px`.
 *     Above that it was frozen. The layout below has real `xl`/`2xl` tiers.
 *   - FIXED-HEIGHT GUESSWORK. `h-[calc(100vh-7rem)]` hardcoded the shell chrome
 *     at 112px against a real 66px header, `p-6` on `<main>`, and ~37px more for
 *     the sandbox banner — so the frame was mis-sized normally and clipped in
 *     TEST. Content sizes itself now.
 *   - A NOMINAL SANDBOX. `allow-scripts allow-same-origin` together are
 *     documented by the HTML spec as effectively removing the sandbox, and the
 *     theme sync depended on exactly that.
 *   - UNTESTABLE, un-instrumentable, unreachable by ⌘K, and outside the parent's
 *     focus order.
 *
 * WHAT IS DELIBERATELY UNCHANGED: the information design. The KPI band, the
 * drill-downs, the live-shipment list with milestone progress and the route map
 * are a genuinely good dashboard concept — the audit says so, and it was right.
 * This is a rehousing, not a redesign.
 */
import * as React from "react";
import { useAuth } from "@/app/auth/auth-context";
import { useCommandPalette } from "@/app/layout/command-palette-context";
import { PageContainer } from "@/components/layout/page-container";
import { ErrorState } from "@/components/ui/states";
import { PageSkeleton } from "@/components/ui/skeleton";
import { tokenStore } from "@/lib/token-store";
import { Button } from "@/components/ui/button";
import { AppLauncher } from "./components/app-launcher";
import { Briefing } from "./components/briefing";
import { ItineraryPanel } from "./components/itinerary-panel";
import { KpiDrilldown } from "./components/kpi-drilldown";
import { KpiStrip } from "./components/kpi-strip";
import { LiveShipments } from "./components/live-shipments";
import { MeetingMode, type MeetingStat } from "./components/meeting-mode";
import { OperationalActivityPanel } from "./components/operational-activity-panel";
import { RecentActivity } from "./components/recent-activity";
import { TowerHero } from "./components/tower-hero";
import { TowerFilters } from "./components/tower-filters";
import type { ControlTowerFilters } from "./use-control-tower";
import type { KpiId } from "./drilldowns";
import { LANE_STROKE, ShipmentMap } from "./map/shipment-map";
import type { Selection } from "./map/selection";
import { firstNameOf } from "./model";
import { useControlTower } from "./use-control-tower";

/** The filters in force, in words. Meeting mode shows it so the room knows what
 *  it is looking at rather than assuming "everything". */
function summariseFilters(f: ControlTowerFilters): string {
  const parts = [
    f.mode && `${f.mode.toLowerCase()} only`,
    f.layer === "MOVEMENT" && "moving files only",
    f.layer === "ACTIVITY" && "facility work only",
    f.verified === "UNVERIFIED" && "unverified locations only",
    f.verified === "VERIFIED" && "verified locations only",
    f.territory && `territory ${f.territory}`,
    f.service_type_id && "one service type",
    f.from && `from ${f.from}`,
    f.to && `to ${f.to}`,
    f.include_completed && "including completed",
  ].filter(Boolean) as string[];
  return parts.length
    ? `Open operation files — ${parts.join(", ")}`
    : "All open operation files";
}

export function DashboardPage() {
  const { user } = useAuth();
  const palette = useCommandPalette();
  const [filters, setFilters] = React.useState<ControlTowerFilters>({});
  const { data, error, loading, refresh } = useControlTower(filters);
  const [openKpi, setOpenKpi] = React.useState<KpiId | null>(null);
  /** The file under discussion. Owned here so the map, the list, the activity
   *  panel and the itinerary panel cannot disagree about which one it is. */
  const [selected, setSelected] = React.useState<Selection>(null);
  const [meeting, setMeeting] = React.useState(false);

  const firstName = React.useMemo(
    () =>
      firstNameOf(
        user as { display_name?: string | null; email?: string | null } | null,
      ),
    [user],
  );

  // tokenStore.getEnv() is the same value api-client sends as X-Praxis-Env, so
  // anything keyed off it cannot disagree with the schema the data came from. It
  // returns 'live' | 'sandbox'; the UI calls the latter TEST everywhere.
  const isTest = tokenStore.getEnv() !== "live";

  if (loading) return <PageSkeleton tiles={4} rows={5} cols={5} />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const selectedShipment = selected ? data.byId[selected] : undefined;
  const selectedLegs = (selected && data.legs[selected]) || [];

  const map = (
    <ShipmentMap
      lanes={data.lanes}
      selected={selected}
      onSelect={setSelected}
      shipmentsById={data.byId}
      activityCount={data.activityFiles}
      unresolvedCount={data.needsLocation}
      presenting={meeting}
    />
  );

  const meetingStats: MeetingStat[] = [
    { label: "Active files", value: String(data.activeFiles) },
    { label: "Moving", value: String(data.movementFiles) },
    { label: "At a facility", value: String(data.activityFiles) },
    {
      label: "Need a location",
      value: String(data.needsLocation),
      tone: data.needsLocation > 0 ? "warn" : "ok",
    },
    {
      label: "Approvals waiting",
      value: String(data.approvals),
      tone: data.approvals > 0 ? "warn" : "ok",
    },
  ];

  return (
    <PageContainer width="wide">
      <TowerHero
        firstName={firstName}
        activeFiles={data.activeFiles}
        approvals={data.approvals}
        isTest={isTest}
      />

      {/*
        The tower grid. One column up to lg, then the mock's 1.62fr / 1fr split
        from xl — which is the breakpoint the frame never had. Below xl the map
        stacks above the shipment list rather than being squeezed to a strip.
      */}
      <TowerFilters value={filters} page={data.page} onChange={setFilters} />

      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setMeeting(true)}
        >
          Meeting view
        </Button>
      </div>

      <div className="mb-5 grid gap-4 xl:grid-cols-[1.62fr_1fr]">
        {map}
        {/*
          The right column answers whichever question is live: the itinerary of
          the file under discussion, or the list of everything open. One column
          rather than a third one, because a tower that grows a panel per feature
          is the wall of information this redesign exists to avoid.
        */}
        {selectedShipment ? (
          <ItineraryPanel
            shipment={selectedShipment}
            legs={selectedLegs}
            onClose={() => setSelected(null)}
          />
        ) : (
          <LiveShipments
            shipments={data.shipments}
            selected={selected}
            onSelect={(dossierId) => setSelected(dossierId)}
          />
        )}
      </div>

      {data.activity.length > 0 && (
        <div className="mb-5">
          <OperationalActivityPanel
            records={data.activity}
            selected={selected}
            onSelect={(dossierId) =>
              setSelected((current) =>
                current === dossierId ? null : dossierId,
              )
            }
          />
        </div>
      )}

      <KpiStrip kpis={data.kpis} onOpen={setOpenKpi} />

      <Briefing
        activeFiles={data.activeFiles}
        approvals={data.approvals}
        complianceFlags={data.complianceFlags}
        unpostedJournals={data.unpostedJournals}
        isTest={isTest}
      />

      <AppLauncher onBrowseAll={palette.open} />

      {/*
        Recent activity — the self-scoped audit widget. Placed BELOW the
        launcher grid so the tower's primary read (my day, my numbers,
        my apps) sits above the reflective "what I did" strip. Its data
        source is /tenant/audit/my-feed (see components/recent-activity.tsx).
      */}
      <RecentActivity />

      <KpiDrilldown
        id={openKpi}
        kpis={data.kpis}
        onClose={() => setOpenKpi(null)}
      />

      <MeetingMode
        open={meeting}
        onClose={() => setMeeting(false)}
        onRefresh={refresh}
        stats={meetingStats}
        counts={{
          sea: data.lanes.filter((l) => l.mode === "sea").length,
          air: data.lanes.filter((l) => l.mode === "air").length,
          road: data.lanes.filter((l) => l.mode === "road").length,
          other: data.lanes.filter((l) => l.mode === "other").length,
        }}
        stroke={LANE_STROKE}
        activityCount={data.activityFiles}
        unresolvedCount={data.needsLocation}
        filterSummary={summariseFilters(filters)}
      >
        <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[2fr_1fr]">
          {map}
          {selectedShipment && (
            <ItineraryPanel
              shipment={selectedShipment}
              legs={selectedLegs}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      </MeetingMode>
    </PageContainer>
  );
}
