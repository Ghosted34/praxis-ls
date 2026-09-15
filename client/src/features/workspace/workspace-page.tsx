/**
 * The old My workspace screen, kept as a redirect.
 *
 * ── WHY THIS FILE STILL EXISTS ─────────────────────────────────────────────
 *
 * `/workspace` used to render a read-only roll-up of approvals awaiting the
 * signed-in user and their unread alerts. Those two things grew real homes —
 * `/approvals` and `/notifications`, each with their own permissions and their
 * own list — and the surface itself became a hub with three sections
 * (see `hub.tsx`).
 *
 * This component is what a bookmark, an emailed link or an open tab from
 * before that change lands on. It sends them to Today, which is the section
 * that answers the question this screen used to answer, and it keeps the two
 * counts visible on the way through so nothing the old page told them is
 * silently gone.
 *
 * It is not routed any more (`app.tsx` points `/workspace` at `WorkspaceHub`),
 * so it exists for the deep links and for anyone reading the history of this
 * folder. Deleting it is fine once you are confident nothing points here.
 */
import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { pageShell } from "@/lib/layout";
import { PageHeader } from "@/components/data-list";
import { Panel } from "@/components/ui/panel";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { useResource } from "@/lib/use-resource";
import { num } from "@/lib/format";
import { tenant } from "@/lib/api-client";

type Mine = {
  approvals_awaiting_me?: unknown[];
  unread_notifications?: unknown[];
};

export function WorkspacePage() {
  const navigate = useNavigate();
  // Read the counts BEFORE navigating, so the frame the user sees for a moment
  // is the page they asked for rather than a blank one.
  const r = useResource(() => tenant<Mine>("/workspace"), []);
  const approvals = r.data?.approvals_awaiting_me?.length ?? 0;
  const unread = r.data?.unread_notifications?.length ?? 0;

  useEffect(() => {
    const t = window.setTimeout(() => navigate("/workspace/today", { replace: true }), 1200);
    return () => window.clearTimeout(t);
  }, [navigate]);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        title="My workspace has moved"
        description="Taking you to Today — your tasks and appointments, in one list."
      />

      <KpiRow>
        <KpiTile label="Awaiting my approval" value={num(approvals)} />
        <KpiTile label="Unread alerts" value={num(unread)} />
      </KpiRow>

      <Panel title="Where things went" className="mt-4">
        <ul className="space-y-2 text-sm">
          <li>
            <Link to="/workspace/today" className="text-primary-ink hover:underline">
              Today
            </Link>{" "}
            — tasks and appointments in time order.
          </li>
          <li>
            <Link to="/workspace/tasks" className="text-primary-ink hover:underline">
              Tasks
            </Link>{" "}
            — the board.
          </li>
          <li>
            <Link to="/workspace/calendar" className="text-primary-ink hover:underline">
              Calendar
            </Link>{" "}
            — the month.
          </li>
          <li>
            <Link to="/approvals" className="text-primary-ink hover:underline">
              Approvals
            </Link>{" "}
            — the queue this page used to summarise.
          </li>
          <li>
            <Link to="/notifications" className="text-primary-ink hover:underline">
              Notifications
            </Link>{" "}
            — every alert, not just the unread ones.
          </li>
        </ul>
      </Panel>
    </section>
  );
}
