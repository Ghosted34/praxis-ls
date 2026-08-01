/**
 * Service types — the tenant's own service taxonomy, plus the milestone template
 * that each one seeds onto a dossier.
 *
 * WHY THIS SCREEN EXISTS. `0310_operations.sql:7` states the intent — "Services
 * as DATA, not code (transcript §11.3). User-creatable" — but `service_type` had
 * no module and no UI until 2026-08-01, and `POST /milestones/templates` existed
 * with nothing calling it. The only thing that ever created either was
 * `seed-sandbox.sql`. So a freshly provisioned tenant could not define its
 * services, could not have milestone templates, and therefore got dossiers with
 * no milestone chain — onboarding required an engineer with database access.
 *
 * The two are on one screen deliberately: a service type without an active
 * template is a trap (dossiers silently come out bare), so the list makes that
 * state visible and the fix is one click away rather than in another module.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { Pill } from "@/components/ui/pill";
import { useResource, errMsg } from "@/lib/use-resource";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { ScreenAi } from "@/components/screen-ai";
import * as api from "@/lib/operations-api";

const shell = "space-y-5";

/** A stage row in the template editor. */
type Stage = { code: string; label_fr: string; label_en: string; default_offset_days: string };

const BLANK: Stage = { code: "", label_fr: "", label_en: "", default_offset_days: "0" };

/**
 * Starter chains, offered as a starting point rather than a default. They match
 * the shapes in seed-sandbox.sql so a tenant recognises something workable, but
 * every stage stays editable — a forwarder's milestone chain IS their operating
 * procedure, and shipping one company's process as everyone's is the thing this
 * screen exists to stop.
 */
const PRESETS: Record<string, Stage[]> = {
  Sea: [
    { code: "BOOKING", label_fr: "Réservation", label_en: "Booking", default_offset_days: "0" },
    { code: "DEPARTURE", label_fr: "Départ navire", label_en: "Vessel departure", default_offset_days: "5" },
    { code: "ARRIVAL", label_fr: "Arrivée port", label_en: "Port arrival", default_offset_days: "30" },
    { code: "CUSTOMS", label_fr: "Dédouanement", label_en: "Customs clearance", default_offset_days: "33" },
    { code: "DELIVERY", label_fr: "Livraison finale", label_en: "Final delivery", default_offset_days: "37" },
  ],
  Air: [
    { code: "BOOKING", label_fr: "Réservation", label_en: "Booking", default_offset_days: "0" },
    { code: "DEPARTURE", label_fr: "Départ vol", label_en: "Flight departure", default_offset_days: "2" },
    { code: "ARRIVAL", label_fr: "Arrivée aéroport", label_en: "Airport arrival", default_offset_days: "4" },
    { code: "CUSTOMS", label_fr: "Dédouanement", label_en: "Customs clearance", default_offset_days: "6" },
    { code: "DELIVERY", label_fr: "Livraison finale", label_en: "Final delivery", default_offset_days: "8" },
  ],
  Transit: [
    { code: "T1_LODGED", label_fr: "Déclaration T1 déposée", label_en: "T1 lodged", default_offset_days: "0" },
    { code: "ESCORT", label_fr: "Escorte douanière", label_en: "Customs escort", default_offset_days: "2" },
    { code: "BORDER", label_fr: "Passage frontière", label_en: "Border crossing", default_offset_days: "5" },
    { code: "ARRIVAL", label_fr: "Arrivée destination", label_en: "Destination arrival", default_offset_days: "8" },
    { code: "DISCHARGE", label_fr: "Déchargement", label_en: "Discharge", default_offset_days: "9" },
  ],
};

/* ─────────────────────────── Service type form ─────────────────────────── */

function ServiceTypeForm({ row, onClose, onSaved }: { row: api.ServiceType | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const [f, setF] = React.useState({
    key: row?.key ?? "",
    name_fr: row?.name_fr ?? "",
    name_en: row?.name_en ?? "",
    territory: row?.territory ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        await api.createServiceType({
          key: f.key.trim().toUpperCase(),
          name_fr: f.name_fr,
          name_en: f.name_en || undefined,
          territory: f.territory || undefined,
        });
      } else {
        // `key` is intentionally absent: it's the stable identifier referenced by
        // dictionary_item.service_type_key, so renaming would orphan references.
        await api.updateServiceType(row!.service_type_id, {
          name_fr: f.name_fr,
          name_en: f.name_en || null,
          territory: f.territory || null,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "New service type" : "Edit service type"}
      description="A service you sell. Dossiers are classified by it, and each one carries its own milestone chain."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Key" required className={isNew ? "" : "opacity-60"}>
            <Input
              value={f.key}
              onChange={(e) => set("key", e.target.value.toUpperCase())}
              placeholder="SEA_FREIGHT_IMPORT"
              disabled={!isNew}
            />
            {isNew ? (
              <p className="micro mt-1">Permanent identifier, SCREAMING_SNAKE. Cannot be changed later.</p>
            ) : (
              <p className="micro mt-1">Fixed — other records reference this key.</p>
            )}
          </Field>
          <Field label="Territory">
            <Select value={f.territory} onChange={(e) => set("territory", e.target.value)}>
              <option value="">—</option>
              {api.TERRITORIES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ").toLowerCase()}</option>
              ))}
            </Select>
          </Field>
          <Field label="Name (FR)" required>
            <Input value={f.name_fr} onChange={(e) => set("name_fr", e.target.value)} placeholder="Fret maritime import" />
          </Field>
          <Field label="Name (EN)">
            <Input value={f.name_en} onChange={(e) => set("name_en", e.target.value)} placeholder="Sea freight import" />
          </Field>
        </div>
        {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !f.name_fr || (isNew && !f.key)}>
            {isNew ? "Create" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ───────────────────────── Milestone template editor ───────────────────── */

function TemplateForm({ svc, onClose, onSaved }: { svc: api.ServiceType; onClose: () => void; onSaved: () => void }) {
  const [stages, setStages] = React.useState<Stage[]>([{ ...BLANK }]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const setStage = (i: number, k: keyof Stage, v: string) =>
    setStages((s) => s.map((st, ix) => (ix === i ? { ...st, [k]: v } : st)));
  const addStage = () => setStages((s) => [...s, { ...BLANK }]);
  const removeStage = (i: number) => setStages((s) => (s.length === 1 ? s : s.filter((_, ix) => ix !== i)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.publishMilestoneTemplate({
        service_type_id: svc.service_type_id,
        // stage_seq is 1..n in listed order — the backend accepts fractional
        // values so a stage can later be inserted between two without a renumber.
        stages: stages.map((s, i) => ({
          stage_seq: i + 1,
          code: s.code.trim().toUpperCase(),
          label_fr: s.label_fr.trim(),
          label_en: s.label_en.trim() || undefined,
          default_offset_days: Number(s.default_offset_days) || 0,
        })),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const valid = stages.every((s) => s.code.trim() && s.label_fr.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title={`Milestone template — ${svc.name_en || svc.name_fr}`}
      description="The stages every new dossier of this service type starts with. Publishing creates a new active version; dossiers already created keep the stages they were given."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="micro">Start from:</span>
          {Object.keys(PRESETS).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setStages(PRESETS[p].map((s) => ({ ...s })))}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              {p}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <div className="hidden gap-2 px-1 sm:grid sm:grid-cols-[2fr_3fr_3fr_1.2fr_auto]">
            <span className="micro">Code</span>
            <span className="micro">Label (FR)</span>
            <span className="micro">Label (EN)</span>
            <span className="micro">Offset (days)</span>
            <span />
          </div>
          {stages.map((s, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[2fr_3fr_3fr_1.2fr_auto]">
              <Input value={s.code} onChange={(e) => setStage(i, "code", e.target.value.toUpperCase())} placeholder="BOOKING" />
              <Input value={s.label_fr} onChange={(e) => setStage(i, "label_fr", e.target.value)} placeholder="Réservation" />
              <Input value={s.label_en} onChange={(e) => setStage(i, "label_en", e.target.value)} placeholder="Booking" />
              <Input
                value={s.default_offset_days}
                onChange={(e) => setStage(i, "default_offset_days", e.target.value.replace(/[^0-9-]/g, ""))}
                className="num"
              />
              <button
                type="button"
                onClick={() => removeStage(i)}
                disabled={stages.length === 1}
                aria-label="Remove stage"
                className="px-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                ×
              </button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addStage}>Add stage</Button>
          <p className="micro">
            Offset is days from the dossier's start — the due date of each stage. They should increase down the list.
          </p>
        </div>

        {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy || !valid}>Publish template</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────────────────────────── Page ──────────────────────────────────── */

export function ServiceTypesPage() {
  const [includeInactive, setIncludeInactive] = React.useState(false);
  const list = useResource(() => api.listServiceTypes({ includeInactive }), [includeInactive]);
  const [editing, setEditing] = React.useState<api.ServiceType | null | undefined>(undefined);
  const [templating, setTemplating] = React.useState<api.ServiceType | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function archive(s: api.ServiceType) {
    setBusyId(s.service_type_id);
    try {
      await api.archiveServiceType(s.service_type_id);
      list.reload();
    } finally {
      setBusyId(null);
    }
  }

  const cols: Column<api.ServiceType>[] = [
    {
      key: "name_fr",
      label: "Service",
      render: (r) => (
        <div>
          <div className="font-medium text-foreground">{r.name_en || r.name_fr}</div>
          <div className="micro">{r.key}</div>
        </div>
      ),
    },
    { key: "territory", label: "Territory", render: (r) => (r.territory ? r.territory.replace(/_/g, " ").toLowerCase() : "—") },
    {
      key: "has_active_template",
      label: "Milestones",
      render: (r) =>
        r.has_active_template ? (
          <Pill tone="ok">v{r.template_versions}</Pill>
        ) : (
          // The trap this screen exists to make visible: no active template means
          // every dossier of this type is created with no milestone chain.
          <Pill tone="warn">none</Pill>
        ),
    },
    { key: "is_active", label: "Status", render: (r) => (r.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="mute">Archived</Pill>) },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" onClick={() => setTemplating(r)}>
            {r.has_active_template ? "New version" : "Add milestones"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(r)}>Edit</Button>
          {r.is_active && !r.is_system && (
            <Button size="sm" variant="outline" loading={busyId === r.service_type_id} onClick={() => archive(r)}>
              Archive
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Operations" to="/operations" />}
        title="Service types"
        description="The services you sell. Dossiers are classified by service type, and each one carries the milestone chain new files start with."
        action={<Button onClick={() => setEditing(null)}>New service type</Button>}
      />
      <HubTabs />

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
        Show archived
      </label>

      <DataList
        columns={cols}
        rows={list.data}
        error={list.error}
        loading={list.loading}
        rowKey={(r) => r.service_type_id}
        empty={{
          title: "No service types yet",
          hint: "Add the services you sell — sea freight import, air freight, hinterland transit. Dossiers can't carry a milestone chain until one exists.",
        }}
      />

      <ScreenAi path="operations/service-types" />

      {editing !== undefined && (
        <ServiceTypeForm row={editing} onClose={() => setEditing(undefined)} onSaved={list.reload} />
      )}
      {templating && (
        <TemplateForm svc={templating} onClose={() => setTemplating(null)} onSaved={list.reload} />
      )}
    </section>
  );
}
