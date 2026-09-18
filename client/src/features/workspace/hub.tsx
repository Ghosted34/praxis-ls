/**
 * My workspace — one hub, four deep-linkable sections.
 *
 * Mirrors HrHub / FleetHub / WarehouseHub: `<TabbedHub>` zips the section list
 * from `app/layout/areas.ts` with the page components, so the tab strip and the
 * ribbon's second row are the same list by construction rather than by
 * discipline. `areas.test.ts` fails the build if a hub grows a page the list
 * does not know about.
 *
 * ── WHY THESE FOUR AND NOT MORE ────────────────────────────────────────────
 *
 * Today, Tasks and Calendar are three VIEWS of one queue, not three features,
 * and Analytics is that same queue counted. It earns a section rather than a
 * panel inside Tasks because it answers a different question — how work is
 * MOVING rather than what is next — and because the aggregate needs its own
 * bounded window and its own registry entry to be permission-filtered at all.
 * Approvals and notifications — the other two things this page used to show —
 * are their own screens (`/approvals`, `/notifications`) with their own
 * permissions, and duplicating them here would give the same list two homes
 * that drift. Today keeps a count of what is awaiting approval, and links to
 * the queue rather than re-rendering it.
 */
import { TabbedHub } from "@/components/tabbed-hub";
import { hubTabs } from "@/app/layout/areas";
import { TodayPage } from "./today";
import { TasksPage } from "./tasks/tasks-page";
import { CalendarPage } from "./calendar/calendar-page";
import { AnalyticsPage } from "./analytics/analytics-page";

export function WorkspaceHub() {
  return (
    <TabbedHub
      eyebrow="My workspace"
      basePath="/workspace"
      tabs={hubTabs("/workspace", {
        today: TodayPage,
        tasks: TasksPage,
        calendar: CalendarPage,
        analytics: AnalyticsPage,
      })}
    />
  );
}
