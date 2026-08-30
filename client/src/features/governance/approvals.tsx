/**
 * Governance — the approver's own queue.
 *
 * Split out of `features/governance/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { HubCrumb } from "@/components/tabbed-hub";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { money, num, dateFmt, enumLabel, humanizeRef } from "@/lib/format";
import { RowActions } from "@/components/ui/row-actions";
import { usePrompt } from "@/components/ui/use-prompt";

type ApprovalTask = {
  approval_task_id?: string;
  id?: string;
  entity_ref?: string | null;
  status?: string | null;
  step_kind?: string | null;
  step_seq?: number | null;
  amount_xaf?: number | string | null;
  workflow_name?: string | null;
  created_at?: string | null;
  leave_kind?: string | null;
  leave_employee?: string | null;
  leave_starts?: string | null;
  leave_ends?: string | null;
};
const actTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "APPROVED" || u === "VALIDATED") return "ok";
  if (u === "REJECTED") return "bad";
  if (u === "PENDING") return "warn";
  return "mute";
};
const LEAVE_KIND: Record<string, string> = {
  leave: "Leave",
  salary_advance: "Salary advance",
  mission: "Mission",
};
/** Human title + subtitle for an approval row's entity (leave summary, else humanised ref). */
function entityLabel(r: ApprovalTask): { title: string; sub?: string } {
  if (r.leave_employee) {
    const kind = LEAVE_KIND[r.leave_kind || "leave"] || "Leave";
    const dates = [r.leave_starts, r.leave_ends]
      .filter(Boolean)
      .map((d) => dateFmt(d))
      .join(" – ");
    return { title: `${kind} · ${r.leave_employee}`, sub: dates || undefined };
  }
  return { title: humanizeRef(r.entity_ref) };
}

export function ApprovalsPage() {
  const { rows, error, loading, reload } = useList<ApprovalTask>(
    "/approvals?status=PENDING",
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actError, setActError] = React.useState<string | null>(null);
  const [prompt, promptDialog] = usePrompt();
  const list = rows || [];
  const idOf = (r: ApprovalTask) => String(r.approval_task_id || r.id || "");

  async function act(
    r: ApprovalTask,
    action: "validate" | "approve" | "reject",
  ) {
    const id = idOf(r);
    if (!id) return;
    // The reason is what the requester reads to know what to change, so it gets
    // a labelled textarea rather than a one-line OS box. Still optional: the
    // validate hook is absent, so an empty answer submits.
    let note: string | undefined;
    if (action === "reject") {
      const typed = await prompt({
        title: "Reject this request?",
        description: "The requester sees this note. Say what would need to change.",
        label: "Reason for rejection",
        hint: "Optional, but a rejection without one usually comes back.",
        multiline: true,
        confirmLabel: "Reject request",
      });
      if (typed === null) return;
      note = typed || undefined;
    }
    setBusy(id + action);
    // Was `alert(errMsg(e))`. The refusals this screen now produces —
    // SELF_APPROVAL, NOT_ELIGIBLE, WRONG_ACTION_FOR_STEP — are explanatory
    // messages a user needs to read next to the row, not dismiss in a modal.
    try {
      await tenant(`/approvals/${id}/act`, {
        method: "POST",
        body: { action, note },
      });
      setActError(null);
      reload();
    } catch (e) {
      setActError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<ApprovalTask>[] = [
    {
      key: "entity_ref",
      label: "Item",
      render: (r) => {
        const { title, sub } = entityLabel(r);
        return (
          <div className="min-w-0">
            <div className="font-medium text-foreground">{title}</div>
            {sub && <div className="num micro">{sub}</div>}
          </div>
        );
      },
    },
    {
      key: "workflow",
      label: "Workflow",
      render: (r) => (
        <span className="text-muted-foreground">{r.workflow_name || "—"}</span>
      ),
    },
    {
      key: "stage",
      label: "Stage",
      render: (r) =>
        r.step_kind ? (
          <Pill tone="blue">
            {enumLabel(r.step_kind)}
            {r.step_seq ? ` · ${r.step_seq}` : ""}
          </Pill>
        ) : (
          "—"
        ),
    },
    {
      key: "amount",
      label: "Amount · XAF",
      className: "num text-right",
      render: (r) => money(r.amount_xaf),
    },
    { key: "created", label: "Raised", render: (r) => dateFmt(r.created_at) },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <Pill tone={actTone(r.status)}>{r.status || "PENDING"}</Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (r) => {
        const id = idOf(r);
        return (
          <RowActions>
            {r.step_kind === "VALIDATE" && (
              <Button
                size="sm"
                variant="outline"
                loading={busy === id + "validate"}
                onClick={() => act(r, "validate")}
              >
                Validate
              </Button>
            )}
            <Button
              size="sm"
              loading={busy === id + "approve"}
              onClick={() => act(r, "approve")}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={busy === id + "reject"}
              onClick={() => act(r, "reject")}
            >
              Reject
            </Button>
          </RowActions>
        );
      },
    },
  ];

  return (
    <section className={pageShell.wide}>
      {promptDialog}
      <PageHeader
        eyebrow={<HubCrumb area="Governance" to="/governance" />}
        title={tr("Approvals")}
        description="Your runtime approval queue — validate or approve/reject items routed to you by workflow."
      />
      <KpiRow>
        <KpiTile label={tr("Pending")} value={num(list.length)} />
        <KpiTile
          label="To validate"
          value={num(list.filter((r) => r.step_kind === "VALIDATE").length)}
        />
        <KpiTile
          label="To approve"
          value={num(list.filter((r) => r.step_kind === "APPROVE").length)}
        />
      </KpiRow>
      {actError && <ErrorState message={actError} />}
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => idOf(r)}
        empty={{
          title: "Nothing awaiting you",
          hint: "Items needing your validation or approval land here.",
        }}
      />
    </section>
  );
}
