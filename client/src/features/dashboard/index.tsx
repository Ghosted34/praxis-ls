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
import { AppLauncher } from "./components/app-launcher";
import { Briefing } from "./components/briefing";
import { KpiDrilldown } from "./components/kpi-drilldown";
import { KpiStrip } from "./components/kpi-strip";
import { LiveShipments } from "./components/live-shipments";
import { RecentActivity } from "./components/recent-activity";
import { TowerHero } from "./components/tower-hero";
import { TowerFilters } from "./components/tower-filters";
import type { ControlTowerFilters } from "./use-control-tower";
import type { KpiId } from "./drilldowns";
import { ShipmentMap } from "./map/shipment-map";
import { firstNameOf } from "./model";
import { useControlTower } from "./use-control-tower";

export function DashboardPage() {
  const { user } = useAuth();
  const palette = useCommandPalette();
  const [filters, setFilters] = React.useState<ControlTowerFilters>({});
  const { data, error, loading } = useControlTower(filters);
  const [openKpi, setOpenKpi] = React.useState<KpiId | null>(null);

  const firstName = React.useMemo(
    () => firstNameOf(user as { display_name?: string | null; email?: string | null } | null),
    [user],
  );

  // tokenStore.getEnv() is the same value api-client sends as X-Praxis-Env, so
  // anything keyed off it cannot disagree with the schema the data came from. It
  // returns 'live' | 'sandbox'; the UI calls the latter TEST everywhere.
  const isTest = tokenStore.getEnv() !== "live";

  if (loading) return <PageSkeleton tiles={4} rows={5} cols={5} />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

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

      <div className="mb-5 grid gap-4 xl:grid-cols-[1.62fr_1fr]">
        <ShipmentMap lanes={data.lanes} />
        <LiveShipments shipments={data.shipments} />
      </div>

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

      <KpiDrilldown id={openKpi} kpis={data.kpis} onClose={() => setOpenKpi(null)} />
    </PageContainer>
  );
}
