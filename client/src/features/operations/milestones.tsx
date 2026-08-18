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
 *
 * ── WHAT THE TEMPLATE REGISTER IS FOR (10708) ─────────────────────────────
 *
 * A template is a service type's promise about how a shipment will run: the
 * stages every dossier of that type opens with, who owns each stage, how much
 * of the timeline it is due after, which ones the client sees, which ones
 * count as hard commitments. The register below states that promise in full —
 * the previous table showed an id, a version and four numbers, which told a
 * reader nothing about what the template DOES.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Button } from "@/components/ui/button";
import { ScreenAi } from "@/components/screen-ai";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { useList } from "@/lib/use-resource";
import { num, dateTimeFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";
import { MilestoneChain } from "./milestone-chain";
import { MilestoneAttribution } from "./milestone-attribution";
import { QTickets } from "./q-tickets";

/* ── The template register ──────────────────────────────────────────────── */

/** One stage row, rendered with a plain-English gloss per field — the part
 *  that turns the register from an id list into something readable. */
function StageRows({ stages }: { stages: api.MilestoneStage[] }) {
  if (!stages.length) {
    return <p className="px-3 py-2 micro">No stages on this template.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">Code</th>
            <th className="px-3 py-2 font-semibold">Label</th>
            <th className="px-3 py-2 text-right font-semibold">Due offset</th>
            <th className="px-3 py-2 text-right font-semibold">Weight</th>
            <th className="px-3 py-2 font-semibold">Owned by</th>
            <th className="px-3 py-2 font-semibold">Flags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {stages.map((s, i) => (
            <tr key={s.stage_id || s.code || String(i)} className="align-top">
              <td className="num px-3 py-1.5 text-muted-foreground">{s.stage_seq ?? i + 1}</td>
              <td className="num px-3 py-1.5 font-medium">{s.code}</td>
              <td className="px-3 py-1.5">
                {s.label_fr || s.label_en || "—"}
                {s.label_en && s.label_en !== s.label_fr && (
                  <span className="block text-[11px] text-muted-foreground">{s.label_en}</span>
                )}
              </td>
              {/* Offset: how many days after the previous stage the due date
                  is forecast. The register states it so a client can read
                  what the company promised. */}
              <td className="num px-3 py-1.5 text-right text-muted-foreground">
                {s.default_offset_days != null ? `+${s.default_offset_days} d` : "—"}
              </td>
              <td className="num px-3 py-1.5 text-right text-muted-foreground">
                {s.weight != null ? `${s.weight}%` : "—"}
              </td>
              <td className="px-3 py-1.5">
                {s.owner_tier ? api.OWNER_TIER_LABEL[s.owner_tier] : "—"}
              </td>
              <td className="px-3 py-1.5">
                <span className="flex flex-wrap gap-1">
                  {s.is_anchor && <Pill tone="blue">Anchor</Pill>}
                  {s.is_target_lock && <Pill tone="warn">SLA locked</Pill>}
                  {s.is_client_visible === false && <Pill tone="mute">Internal only</Pill>}
                  {s.is_optional && <Pill tone="mute">Optional</Pill>}
                  {s.required_evidence_doc_type && (
                    <Pill tone="blue">Needs proof</Pill>
                  )}
                  {s.auto_advance_on_event && <Pill tone="ok">Auto</Pill>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TemplatesPanel() {
  const templates = useList<api.MilestoneTemplate>("/milestones/templates");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const rows = templates.rows || [];
  const active = rows.filter((r) => r.is_active);

  const cols: Column<api.MilestoneTemplate>[] = [
    {
      key: "service",
      label: "Service type",
      render: (r) => (
        <span className="font-medium text-foreground">
          {r.service_type_name || r.service_type_code || "—"}
        </span>
      ),
    },
    {
      key: "version",
      label: "Version",
      className: "num text-right",
      render: (r) => num(r.version),
    },
    {
      key: "stages",
      label: "Stages",
      className: "num text-right",
      render: (r) => num(r.stage_count),
    },
    {
      key: "published",
      label: "Published",
      render: (r) => (
        <span className="num text-muted-foreground">
          {r.published_at ? dateTimeFmt(r.published_at) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <Pill tone={(r.is_active ? "ok" : "mute") as Tone}>
          {r.is_active ? "Active — seeds new dossiers" : "Superseded"}
        </Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpenId(openId === r.milestone_template_id ? null : r.milestone_template_id)}
          >
            {openId === r.milestone_template_id ? "Hide stages" : "Read stages"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* WHAT THIS IS — the template's purpose, said plainly. The old screen
          showed an id, a version and offsets with no explanation of what a
          template does, which made the register unreadable. */}
      <Callout tone="info" title="What a template is">
        A template is what a service type promises about how a shipment runs.
        When a dossier is opened with that service type, the ACTIVE template is
        stamped onto it as its milestone chain — every stage, its owner, its
        weight and its due offset — and the engine forecasts each stage&rsquo;s
        due date from those offsets. Publishing a new version supersedes the
        old one (existing dossiers keep the chain they were stamped with).
      </Callout>

      <DataList
        columns={cols}
        rows={templates.loading ? null : rows}
        error={templates.error}
        loading={templates.loading}
        rowKey={(r) => r.milestone_template_id}
        empty={{
          title: "No templates",
          // Templates are published per service type — this register is the
          // read side, and the write side names itself.
          hint: "Templates are published per service type — open the Service types tab and use “Add milestones”.",
        }}
      />

      {openId &&
        (() => {
          const tpl = rows.find((r) => r.milestone_template_id === openId);
          if (!tpl) return null;
          return (
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {tpl.service_type_name || tpl.service_type_code || "Template"} · v
                  {num(tpl.version)}
                </p>
                <p className="micro text-muted-foreground">
                  {active.some((a) => a.milestone_template_id === tpl.milestone_template_id)
                    ? "This is the active template — it is what a new dossier opens with."
                    : "Superseded — existing dossiers stamped with it keep it."}
                </p>
              </div>
              <StageRows stages={tpl.stages || []} />
              <p className="mt-2 micro text-muted-foreground">
                <span className="font-medium">Due offset</span> — how many days after the
                previous stage this one falls due. <span className="font-medium">Weight</span> —
                the stage&rsquo;s share of the chain horizon. <span className="font-medium">Anchor</span> —
                a hard date the chain is built around. <span className="font-medium">SLA locked</span> —
                its commitment cannot be compressed by re-baselining. <span className="font-medium">Needs proof</span> —
                a document must be filed to complete it.
              </p>
            </div>
          );
        })()}
    </div>
  );
}

export function MilestonesPage() {
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");

  return (
    <PageContainer width="wide">
      <PageHeader
        eyebrow={<HubCrumb area="Operations" to="/operations" />}
        title={tr("Milestones")}
        description="Track a dossier's milestone chain; read the templates that seed them."
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
      <TemplatesPanel />

      <ScreenAi path="operations/milestones" />
    </PageContainer>
  );
}

export default MilestonesPage;
