/**
 * Milestones — a dossier's chain, and the templates that seed them.
 *
 * Split out of `features/operations/pages.tsx` in Phase 3 (audit F7).
 */
import * as React from "react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { ScreenAi } from "@/components/screen-ai";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";
import { tone } from "./shared";

export function MilestonesPage() {
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");
  const inst = useResource(() => (dossierId ? api.milestonesByDossier(dossierId) : Promise.resolve([])), [dossierId]);
  const templates = useList<api.MilestoneTemplate>("/milestones/templates");
  const [busyId, setBusyId] = React.useState<string | null>(null);

  // Errors were swallowed here: try/finally with no catch means a rejected
  // request just disappears and the button looks inert. That hid a 422 for as
  // long as this screen has existed — first because `to` was never sent at all,
  // then because PENDING → DONE isn't a legal transition. Surface it.
  const [advErr, setAdvErr] = React.useState<string | null>(null);

  async function advance(m: api.MilestoneInstance) {
    const to = api.nextMilestoneStatus(m.status);
    if (!to) return;
    setBusyId(m.milestone_instance_id);
    setAdvErr(null);
    try {
      await api.advanceMilestone(m.milestone_instance_id, { to });
      inst.reload();
    } catch (e) {
      setAdvErr(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  const instCols: Column<api.MilestoneInstance>[] = [
    { key: "label_fr", label: "Milestone", render: (r) => <span className="font-medium text-foreground">{r.label_fr || r.code}</span> },
    { key: "due_date", label: "Due", render: (r) => dateFmt(r.due_date) },
    { key: "status", label: "Status", render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill> },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          {/* Label names the actual next step (Start / Complete) rather than a
              generic "Advance" — a milestone goes PENDING → IN_PROGRESS → DONE,
              so one button meant two different things depending on the row. */}
          {api.nextMilestoneStatus(r.status) && (
            <Button size="sm" variant="outline" loading={busyId === r.milestone_instance_id} onClick={() => advance(r)}>
              {api.milestoneAdvanceLabel(r.status)}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const tplCols: Column<api.MilestoneTemplate>[] = [
    { key: "stage_seq", label: "#", className: "num" },
    { key: "code", label: "Code", render: (r) => <span className="num">{r.code}</span> },
    { key: "label_fr", label: "Label", render: (r) => r.label_fr || r.label_en || "—" },
    { key: "default_offset_days", label: "Offset (days)", className: "num text-right" },
  ];

  return (
    <PageContainer width="wide">
      <PageHeader
        eyebrow={<HubCrumb area="Operations" to="/operations" />}
        title="Milestones"
        description="Track a dossier's milestone chain; manage the templates that seed them."
      />
      <HubTabs />

      <div className="mb-4 flex items-center gap-3">
        <Select
          value={dossierId}
          onChange={(e) => setDossierId(e.target.value)}
          aria-label="Dossier"
          className="max-w-xs"
        >
          <option value="">Select a dossier…</option>
          {(dossiers || []).map((d) => (
            <option key={d.dossier_id} value={d.dossier_id}>
              {d.ref}
            </option>
          ))}
        </Select>
      </div>

      {advErr && (
        <div className="mb-3">
          <ErrorState message={advErr} />
        </div>
      )}

      {dossierId && (
        <div className="mb-8">
          <DataList
            columns={instCols}
            rows={inst.data}
            error={inst.error}
            loading={inst.loading}
            rowKey={(r) => r.milestone_instance_id}
            empty={{
              title: "No milestones",
              // Points at the cause rather than restating the symptom: a chain is
              // seeded from the service type's active template, so an empty one
              // almost always means the dossier has no service type, or that type
              // has no published template.
              hint: "New dossiers seed their chain from the service type's template. Check the dossier has a service type, and that it has a published template under Service types.",
            }}
          />
        </div>
      )}

      <h2 className="micro mb-2">Templates</h2>
      <DataList
        columns={tplCols}
        rows={templates.rows}
        error={templates.error}
        loading={templates.loading}
        rowKey={(r, i) => r.milestone_template_id || String(i)}
        empty={{
          title: "No templates",
          // This screen is read-only; templates are published per service type.
          // The old copy explained what templates are for and gave no way to make
          // one, which is the dead end that hid the whole onboarding gap.
          hint: "Templates are published per service type — open the Service types tab and use “Add milestones”.",
        }}
      />

      <ScreenAi path="operations/milestones" />
    </PageContainer>
  );
}
