/**
 * Milestones — a dossier's chain, and the templates that seed them.
 *
 * Split out of `features/operations/pages.tsx` in Phase 3 (audit F7).
 *
 * The chain itself is `<MilestoneChain>`, shared with the dossier 360°. Two
 * renderings of the same thing had already drifted once — this screen could
 * advance a stage and the 360° could only list it — and the engine's dates
 * (commitment vs forecast, health, attribution) are far too easy to render two
 * different ways. One component, two hosts.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { Select } from "@/components/ui/modal";
import { ScreenAi } from "@/components/screen-ai";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { useList } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";
import { MilestoneChain } from "./milestone-chain";
import { MilestoneAttribution } from "./milestone-attribution";
import { QTickets } from "./q-tickets";

export function MilestonesPage() {
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");
  const templates = useList<api.MilestoneTemplate>("/milestones/templates");

  const tplCols: Column<api.MilestoneTemplate>[] = [
    { key: "stage_seq", label: "#", className: "num" },
    {
      key: "code",
      label: "Code",
      render: (r) => <span className="num">{r.code}</span>,
    },
    {
      key: "label_fr",
      label: "Label",
      render: (r) => r.label_fr || r.label_en || "—",
    },
    {
      key: "default_offset_days",
      label: "Offset (days)",
      className: "num text-right",
    },
  ];

  return (
    <PageContainer width="wide">
      <PageHeader
        eyebrow={<HubCrumb area="Operations" to="/operations" />}
        title={tr("Milestones")}
        description="Track a dossier's milestone chain; manage the templates that seed them."
      />
      <HubTabs />

      <div className="mb-4 flex items-center gap-3">
        <Select
          value={dossierId}
          onChange={(e) => setDossierId(e.target.value)}
          aria-label={tr("Dossier")}
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

      {dossierId && (
        <div className="mb-8">
          <MilestoneChain dossierId={dossierId} />
        </div>
      )}

      <h2 className="micro mb-2">Client queries</h2>
      <div className="mb-8">
        <QTickets dossierId={dossierId || undefined} />
      </div>

      {/* Fleet-wide, not per-file: the question "who is costing us time" is
          only answerable across many dossiers. */}
      <h2 className="micro mb-2">Delay attribution</h2>
      <div className="mb-8">
        <MilestoneAttribution />
      </div>

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

export default MilestonesPage;
