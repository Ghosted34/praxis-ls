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
import { ErrorState, EmptyState } from "@/components/ui/states";
import { TabList, TabsRoot, TabsContent, type TabItem } from "@/components/ui/tabs";
import { useIsDesktop } from "@/lib/use-media-query";
import { cn } from "@/lib/cn";
import { ScreenAi } from "@/components/screen-ai";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { num, dateTimeFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";
import { MilestoneChain } from "./milestone-chain";
import { MilestoneAttribution } from "./milestone-attribution";
import { QTickets } from "./q-tickets";
import { TemplateForm } from "@/features/masterdata/service-type-template-form";

/** The two views of this screen. Content is rendered by <TabsContent> below
 *  rather than carried here, so the strip can sit in a row of its own. */
const TAB_ITEMS: TabItem[] = [
  { value: "chain", label: "Chain" },
  { value: "templates", label: "Templates" },
];

/* ── The template register ──────────────────────────────────────────────── */

/** One stage row, rendered with a plain-English gloss per field — the part
 *  that turns the register from an id list into something readable. */
function StageRows({ stages }: { stages: api.MilestoneStage[] }) {
  if (!stages.length) {
    return <p className="px-3 py-2 micro">No stages on this template.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
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

/** The legend under the stage table. Extracted so the modal and the mobile
 *  page cannot drift into explaining the same columns two different ways. */
function StageLegend() {
  return (
    <p className="micro text-muted-foreground">
      <span className="font-medium">Due offset</span> — how many days after the
      previous stage this one falls due. <span className="font-medium">Weight</span> —
      the stage&rsquo;s share of the chain horizon. <span className="font-medium">Anchor</span> —
      a hard date the chain is built around. <span className="font-medium">SLA locked</span> —
      its commitment cannot be compressed by re-baselining. <span className="font-medium">Needs proof</span> —
      a document must be filed to complete it.
    </p>
  );
}

/**
 * A template's stages, plus the actions that operate on that version.
 *
 * The BODY only — no dialog, no page shell. Both hosts (the desktop modal and
 * the <1024px page) render this exact tree, which is the whole point: "Read
 * stages" has to answer the same question the same way on both, and the
 * previous inline block could only ever live in one of them.
 */
function TemplateStagesBody({
  tpl,
  onEdit,
  onActivate,
  activating,
}: {
  tpl: api.MilestoneTemplate;
  onEdit: (tpl: api.MilestoneTemplate) => void;
  onActivate: (tpl: api.MilestoneTemplate) => void;
  activating: string | null;
}) {
  const stages = tpl.stages || [];
  // The header counts: what a reader wants before scanning 20 rows. Derived
  // rather than stored — `stage_count` is the register's number and these are
  // about the stages actually in hand.
  const anchors = stages.filter((s) => s.is_anchor).length;
  const locked = stages.filter((s) => s.is_target_lock).length;
  const internal = stages.filter((s) => s.is_client_visible === false).length;
  const proof = stages.filter((s) => s.required_evidence_doc_type).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Dense summary strip — the shape of the promise in one line, so the
          table below is read as detail rather than as the whole answer. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="micro text-muted-foreground">
          <span className="num font-medium text-foreground">{num(stages.length)}</span> stage
          {stages.length === 1 ? "" : "s"}
        </span>
        {anchors > 0 && (
          <span className="micro text-muted-foreground">
            <span className="num font-medium text-foreground">{num(anchors)}</span> anchor
            {anchors === 1 ? "" : "s"}
          </span>
        )}
        {locked > 0 && (
          <span className="micro text-muted-foreground">
            <span className="num font-medium text-foreground">{num(locked)}</span> SLA locked
          </span>
        )}
        {internal > 0 && (
          <span className="micro text-muted-foreground">
            <span className="num font-medium text-foreground">{num(internal)}</span> internal only
          </span>
        )}
        {proof > 0 && (
          <span className="micro text-muted-foreground">
            <span className="num font-medium text-foreground">{num(proof)}</span> need proof
          </span>
        )}
        {tpl.published_at && (
          <span className="micro text-muted-foreground">
            Published <span className="num">{dateTimeFmt(tpl.published_at)}</span>
          </span>
        )}
      </div>

      <div className="rounded-lg border">
        <StageRows stages={stages} />
      </div>

      <StageLegend />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onEdit(tpl)}>
          {tpl.is_active ? "Edit chain" : "Edit & publish as new version"}
        </Button>
        {!tpl.is_active && (
          <Button
            size="sm"
            variant="outline"
            loading={activating === tpl.milestone_template_id}
            disabled={!!activating}
            onClick={() => onActivate(tpl)}
          >
            Activate this version
          </Button>
        )}
      </div>
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
      description="A template is the chain every new file of a service type opens with. Pick the service type to write one for."
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
  // Which template is being READ. On desktop this opens a wide modal; below
  // 1024px the panel hands the whole surface over to the reader instead (see
  // the early return further down) — a 7-column register does not survive
  // being squeezed into a phone-width dialog.
  const [openId, setOpenId] = React.useState<string | null>(null);
  const isDesktop = useIsDesktop();
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
          {r.is_active ? "Active — seeds new files" : "Superseded"}
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
            onClick={() => setOpenId(r.milestone_template_id)}
          >
            Read stages
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

  /* Both hosts of <TemplateStagesBody> drive these, so editing or activating
     from the desktop modal and from the mobile page do the same thing. */

  const openTpl = openId
    ? rows.find((r) => r.milestone_template_id === openId) || null
    : null;

  function editTemplate(tpl: api.MilestoneTemplate) {
    // Close the reader first. The editor is itself a dialog, and opening it
    // from inside the read modal would stack two focus traps — Escape would
    // dismiss the editor back into a modal the user had mentally already left,
    // and the accessibility tree would carry two aria-modals at once.
    setOpenId(null);
    openEditor({
      service_type_id: tpl.service_type_id || "",
      key: tpl.service_type_code || "",
      name_fr: tpl.service_type_name || tpl.service_type_code || "",
      name_en: tpl.service_type_name || tpl.service_type_code || null,
    });
  }

  function activateTemplate(tpl: api.MilestoneTemplate) {
    setActivating(tpl.milestone_template_id);
    setError(null);
    api
      .activateMilestoneTemplate(tpl.milestone_template_id)
      .then(() => templates.reload())
      .catch((e) => setError(errMsg(e)))
      .finally(() => setActivating(null));
  }

  /**
   * BELOW 1024px, READING A TEMPLATE IS ITS OWN VIEW.
   *
   * Not a dialog: the register is a seven-column table, and a phone-width modal
   * turns it into a horizontally-scrolling strip inside a vertically-scrolling
   * sheet, with the only exit somewhere above the fold. Replacing the panel
   * gives the table the full width and puts an unmissable Back at the top.
   *
   * It is a view swap rather than a route so the register's loaded state
   * survives Back — pushing a route here would remount the panel and re-fetch
   * the list to return to a screen the user never actually left.
   *
   * Every hook above runs before this return, so the branch cannot change the
   * hook order between renders when the viewport crosses 1024px.
   */
  if (openTpl && !isDesktop) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpenId(null)}>
            ← All templates
          </Button>
          {openTpl.is_active ? (
            <Pill tone="ok">Active</Pill>
          ) : (
            <Pill tone="mute">Superseded</Pill>
          )}
        </div>
        <div>
          <h2 className="text-h2 tracking-tight">
            {openTpl.service_type_name || openTpl.service_type_code || "Template"} · v
            {num(openTpl.version)}
          </h2>
          <p className="micro text-muted-foreground">
            The stages a file of this service type opens with, in chain order.
          </p>
        </div>
        {error && <ErrorState message={error} />}
        {/* No <TemplateForm> here: `editTemplate` clears `openId`, so this
            branch has already given way to the register by the time the editor
            mounts. The editor is rendered once, in the main return. */}
        <TemplateStagesBody
          tpl={openTpl}
          onEdit={editTemplate}
          onActivate={activateTemplate}
          activating={activating}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* WHAT THIS IS — the template's purpose, said plainly. The old screen
          showed an id, a version and offsets with no explanation of what a
          template does, which made the register unreadable — and unworkable. */}
      <Callout tone="info" title="What a template is">
        A template is what a service type promises about how a shipment runs.
        When a file is opened with that service type, the ACTIVE template is
        stamped onto it as its milestone chain — every stage, its owner, its
        weight and its due offset — and the engine forecasts each stage&rsquo;s
        due date from those offsets. Edit a chain and publish it to supersede
        the current version (existing files keep the chain they were
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
          hint: "Publish one — it is the chain every new file of that service type opens with.",
          action: <Button onClick={() => setPicking(true)}>New template</Button>,
        }}
      />

      {/* Reading a template. Desktop gets a WIDE modal — the register keeps
          its context (the list stays behind it, the reader closes back onto the
          same scroll position). Below 1024px the panel becomes the reader
          instead, handled by the early return above: a dialog that tall on a
          phone is a scroll trap with a close button somewhere off-screen. */}
      {openTpl && isDesktop && (
        <Modal
          open
          size="wide"
          onClose={() => setOpenId(null)}
          title={`${openTpl.service_type_name || openTpl.service_type_code || "Template"} · v${num(openTpl.version)}`}
          description="The stages a file of this service type opens with, in chain order."
          headerRight={
            openTpl.is_active ? (
              <Pill tone="ok">Active</Pill>
            ) : (
              <Pill tone="mute">Superseded</Pill>
            )
          }
        >
          <TemplateStagesBody
            tpl={openTpl}
            onEdit={editTemplate}
            onActivate={activateTemplate}
            activating={activating}
          />
        </Modal>
      )}

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
  /**
   * WHY TEMPLATES IS A TAB RATHER THAN THE FOURTH BLOCK DOWN.
   *
   * The register used to sit under the chain, the client queries and the delay
   * attribution — so reading a template meant scrolling past three unrelated
   * surfaces, and the file picker at the top scrolled away with them even
   * though it governs none of it. The two things are a genuine tab pair: the
   * chain is ABOUT the selected file, the register is about every file
   * that has not been opened yet. Neither is a sub-view of the other.
   *
   * Sibling views of one screen, one URL — `<Tabs>`, not routes, exactly as
   * components/ui/tabs.tsx says. The hub's own strip above is the navigation.
   */
  const [tab, setTab] = React.useState("chain");

  const dossierPicker = (
    <Select
      value={dossierId}
      onChange={(e) => setDossierId(e.target.value)}
      aria-label={tr("Operations file")}
      className="w-full sm:w-72"
    >
      <option value="">Select an operations file…</option>
      {(dossiers || []).map((d) => (
        <option key={d.dossier_id} value={d.dossier_id}>
          {d.ref}
        </option>
      ))}
    </Select>
  );

  return (
    <PageContainer width="wide">
      <PageHeader
        eyebrow={<HubCrumb area="Operations" to="/operations" />}
        title={tr("Milestones")}
        description="Track a file's milestone chain; read the templates that seed them."
      />
      <HubTabs />

      <TabsRoot
        value={tab}
        onValueChange={setTab}
        activationMode="manual"
        className="flex min-h-0 flex-1 flex-col"
      >
        {/*
          The picker and the tab strip share one row from `sm` up, which is what
          "beside the dropdown" means on a desktop: one control line instead of
          two stacked bands, buying a full row of vertical space back for the
          content. They stack on phones — a select and a tab strip side by side
          at 380px would squeeze both.

          The picker is deliberately OUTSIDE the panels: it belongs to the chain
          tab, but pulling it inside would make the row jump as the strip
          re-anchors when the user switches. It disables on Templates instead,
          which says the same thing without moving anything.
        */}
        <div className="mb-4 flex flex-col gap-3 border-b sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <TabList
            label="Milestone views"
            tabs={TAB_ITEMS}
            className="mb-0 border-b-0"
          />
          <div
            className={cn(
              "pb-2.5 transition-opacity sm:pb-2",
              tab === "templates" && "pointer-events-none opacity-40",
            )}
            aria-hidden={tab === "templates"}
          >
            {dossierPicker}
          </div>
        </div>

        <TabsContent value="chain" className="focus-visible:outline-none">
          {/*
            DESKTOP GETS TWO COLUMNS, and that is the whole vertical-space
            argument on this screen. The chain, the client queries and the
            delay attribution were three full-width blocks stacked down the
            page: on a 2560px display each used about a third of the available
            width and pushed the next one below the fold, so nothing but the
            chain was ever visible at once.

            At `xl` the chain takes a wide column and the two supporting reads
            stack in a narrower one beside it — all three on screen together.
            Below `xl` it collapses back to the single column, because at
            1024-1279px a split would make the chain too narrow to read.
          */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              {dossierId ? (
                <MilestoneChain dossierId={dossierId} />
              ) : (
                <EmptyState
                  title="No operations file selected"
                  hint="Pick a file above to see its milestone chain — every stage, its owner and its three dates."
                />
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-6">
              <section className="flex min-w-0 flex-col gap-2">
                <h2 className="micro">Client queries</h2>
                <QTickets dossierId={dossierId || undefined} />
              </section>

              {/* Fleet-wide, not per-file: the question "who is costing us time" is
                  only answerable across many dossiers. */}
              <section className="flex min-w-0 flex-col gap-2">
                <h2 className="micro">Delay attribution</h2>
                <MilestoneAttribution />
              </section>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="templates" className="focus-visible:outline-none">
          <TemplatesPanel />
        </TabsContent>
      </TabsRoot>

      <ScreenAi path="operations/milestones" />
    </PageContainer>
  );
}

export default MilestonesPage;
