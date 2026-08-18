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
import { Select, Modal } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { ScreenAi } from "@/components/screen-ai";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { num, dateTimeFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";
import { MilestoneChain } from "./milestone-chain";
import { MilestoneAttribution } from "./milestone-attribution";
import { QTickets } from "./q-tickets";
import { TemplateForm } from "@/features/masterdata/service-type-template-form";

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

/** Pick which service type a new template is for. The ones without a chain
 *  come first — they are the dossiers currently opening with no milestones. */
function NewTemplatePicker({
  rows,
  onClose,
  onPicked,
}: {
  rows: api.MilestoneTemplate[];
  onClose: () => void;
  onPicked: (svc: api.ServiceType) => void;
}) {
  const types = useResource(() => api.listServiceTypes(), []);
  const hasActive = new Set(
    rows.filter((r) => r.is_active).map((r) => r.service_type_id),
  );
  const list = (types.data || [])
    .filter((t) => t.is_active !== false)
    .sort((a, b) => {
      const aMiss = hasActive.has(a.service_type_id) ? 1 : 0;
      const bMiss = hasActive.has(b.service_type_id) ? 1 : 0;
      return aMiss - bMiss || (a.name_en || a.name_fr).localeCompare(b.name_en || b.name_fr);
    });

  return (
    <Modal
      open
      onClose={onClose}
      title="New milestone template"
      description="A template is the chain every new dossier of a service type opens with. Pick the service type to write one for."
    >
      {types.loading ? (
        <p className="py-6 text-center micro">Loading service types…</p>
      ) : types.error ? (
        <ErrorState message={types.error} />
      ) : (
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {list.map((t) => (
            <button
              key={t.service_type_id}
              type="button"
              onClick={() => onPicked(t)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span className="font-medium text-foreground">
                {t.name_en || t.name_fr}
              </span>
              {hasActive.has(t.service_type_id) ? (
                <span className="micro text-muted-foreground">
                  has an active chain — publishing supersedes it
                </span>
              ) : (
                <Pill tone="warn">no chain yet</Pill>
              )}
            </button>
          ))}
          {list.length === 0 && (
            <p className="px-3 py-4 micro">
              No active service types — create one in Master data first.
            </p>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

function TemplatesPanel() {
  const templates = useList<api.MilestoneTemplate>("/milestones/templates");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [picking, setPicking] = React.useState(false);
  // What the editor is working on: a service type + the version it starts
  // from (undefined = a first template, seeded from what shipped).
  const [editing, setEditing] = React.useState<{
    svc: api.ServiceType;
    initial?: api.MilestoneStage[];
  } | null>(null);
  const [activating, setActivating] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
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
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpenId(openId === r.milestone_template_id ? null : r.milestone_template_id)}
          >
            {openId === r.milestone_template_id ? "Hide stages" : "Read stages"}
          </Button>
          {!r.is_active && (
            // The rollback publishing could never express: re-activate this
            // exact version instead of minting a byte-identical "v4".
            <Button
              size="sm"
              variant="outline"
              loading={activating === r.milestone_template_id}
              disabled={!!activating}
              onClick={() => {
                setActivating(r.milestone_template_id);
                setError(null);
                api
                  .activateMilestoneTemplate(r.milestone_template_id)
                  .then(() => templates.reload())
                  .catch((e) => setError(errMsg(e)))
                  .finally(() => setActivating(null));
              }}
            >
              Activate
            </Button>
          )}
        </div>
      ),
    },
  ];

  /** The editor for a service type — either its current chain, or nothing. */
  function openEditor(svc: api.ServiceType) {
    const current = rows
      .filter((r) => r.service_type_id === svc.service_type_id)
      .sort((a, b) => b.version - a.version)[0];
    setEditing({
      svc,
      initial: current?.is_active ? current.stages : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* WHAT THIS IS — the template's purpose, said plainly. The old screen
          showed an id, a version and offsets with no explanation of what a
          template does, which made the register unreadable — and unworkable. */}
      <Callout tone="info" title="What a template is">
        A template is what a service type promises about how a shipment runs.
        When a dossier is opened with that service type, the ACTIVE template is
        stamped onto it as its milestone chain — every stage, its owner, its
        weight and its due offset — and the engine forecasts each stage&rsquo;s
        due date from those offsets. Edit a chain and publish it to supersede
        the current version (existing dossiers keep the chain they were
        stamped with); Activate a superseded version to roll back without
        minting a fake new one.
      </Callout>

      <div className="flex items-center justify-between gap-3">
        <p className="micro text-muted-foreground">
          {active.length} service type{active.length === 1 ? "" : "s"} with an
          active chain
          {rows.length - active.length > 0
            ? ` · ${rows.length - active.length} superseded version${
                rows.length - active.length === 1 ? "" : "s"
              }`
            : ""}
        </p>
        <Button onClick={() => setPicking(true)}>New template</Button>
      </div>

      {error && <ErrorState message={error} />}

      <DataList
        columns={cols}
        rows={templates.loading ? null : rows}
        error={templates.error}
        loading={templates.loading}
        rowKey={(r) => r.milestone_template_id}
        empty={{
          title: "No templates",
          hint: "Publish one — it is the chain every new dossier of that service type opens with.",
          action: <Button onClick={() => setPicking(true)}>New template</Button>,
        }}
      />

      {openId &&
        (() => {
          const tpl = rows.find((r) => r.milestone_template_id === openId);
          if (!tpl) return null;
          return (
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-sm font-medium">
                    {tpl.service_type_name || tpl.service_type_code || "Template"} · v
                    {num(tpl.version)}
                  </p>
                  {tpl.is_active && <Pill tone="ok">Active</Pill>}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const svc: api.ServiceType = {
                        service_type_id: tpl.service_type_id || "",
                        key: tpl.service_type_code || "",
                        name_fr: tpl.service_type_name || tpl.service_type_code || "",
                        name_en: tpl.service_type_name || tpl.service_type_code || null,
                      };
                      openEditor(svc);
                    }}
                  >
                    {tpl.is_active ? "Edit chain" : "Edit & publish as new version"}
                  </Button>
                  {!tpl.is_active && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={activating === tpl.milestone_template_id}
                      disabled={!!activating}
                      onClick={() => {
                        setActivating(tpl.milestone_template_id);
                        setError(null);
                        api
                          .activateMilestoneTemplate(tpl.milestone_template_id)
                          .then(() => templates.reload())
                          .catch((e) => setError(errMsg(e)))
                          .finally(() => setActivating(null));
                      }}
                    >
                      Activate this version
                    </Button>
                  )}
                </div>
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

      {picking && (
        <NewTemplatePicker
          rows={rows}
          onClose={() => setPicking(false)}
          onPicked={(svc) => {
            setPicking(false);
            openEditor(svc);
          }}
        />
      )}
      {editing && (
        <TemplateForm
          svc={editing.svc}
          initial={editing.initial}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setOpenId(null);
            templates.reload();
          }}
        />
      )}
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
