/**
 * Operations screens (Wave 2) — dossiers (operation files), transit orders,
 * delivery notes, milestones. Composes the locked shared kit (DataList,
 * PageHeader, KpiRow/KpiTile, Pill, modal forms) per doc/FE_WIRING_PLAN.md.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt } from "@/lib/format";
import type { Entity, Client } from "@/lib/masterdata-api";
import * as api from "@/lib/operations-api";
import { AiActions } from "@/components/ai-actions";
import { ScreenAi } from "@/components/screen-ai";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { Link, useSearchParams } from "react-router-dom";
import type { AiAction } from "@/features/scaffold/screen-specs";

const shell = "mx-auto max-w-6xl animate-fade-in";
const TONES: Record<string, Tone> = {
  OPEN: "blue", IN_PROGRESS: "warn", COMPLETED: "ok", CANCELLED: "bad",
  PENDING: "warn", DONE: "ok", DRAFT: "mute", SUBMITTED: "blue", CLEARED: "ok", DELIVERED: "ok",
};
const tone = (s?: string | null): Tone => TONES[String(s || "").toUpperCase()] || "mute";
const SERVICE_FAMILIES: { key: string; label: string; match: (k: string) => boolean }[] = [
  { key: "SEA", label: "Sea freight", match: (k) => k.includes("SEA") },
  { key: "AIR", label: "Air freight", match: (k) => k.includes("AIR") },
  { key: "HINTERLAND", label: "Hinterland transit", match: (k) => k.includes("HINTERLAND") || k.includes("TRANSIT") },
  { key: "WAREHOUSING", label: "Warehousing", match: (k) => k.includes("WAREHOUS") || k.includes("STORAGE") },
];
const humanizeKey = (k?: string | null): string => {
  if (!k) return "—";
  const s = String(k).replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const familyOf = (d: api.Dossier): string => {
  const k = String(d.service_key || d.service_name_en || "").toUpperCase();
  const fam = SERVICE_FAMILIES.find((x) => x.match(k));
  return fam ? fam.key : "OTHER";
};
const nameMap = <T extends Record<string, unknown>>(rows: T[] | null, idKey: string, nameKey: string) => {
  const m: Record<string, string> = {};
  (rows || []).forEach((r) => { m[String(r[idKey])] = String(r[nameKey] ?? ""); });
  return m;
};

function FormButtons({ busy, disabled, onCancel, saveLabel }: { busy: boolean; disabled?: boolean; onCancel: () => void; saveLabel: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button type="submit" loading={busy} disabled={disabled}>{saveLabel}</Button>
    </div>
  );
}

/* ═══════════════════════════ Operation files (dossiers) ═══════════════════════════ */

function DossierForm({ row, onClose, onSaved }: { row: api.Dossier | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const { rows: entities } = useList<Entity>("/entities");
  const { rows: clients } = useList<Client>("/clients");
  const [f, setF] = React.useState({
    entity_id: row?.entity_id ?? "", client_id: row?.client_id ?? "", incoterm: row?.incoterm ?? "",
    pol: row?.pol ?? "", pod: row?.pod ?? "", customs_regime: row?.customs_regime ?? "", bl_mawb: row?.bl_mawb ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const body: api.DossierInput = {
      entity_id: f.entity_id, client_id: f.client_id || undefined, incoterm: f.incoterm || undefined,
      pol: f.pol || undefined, pod: f.pod || undefined, customs_regime: f.customs_regime || undefined, bl_mawb: f.bl_mawb || undefined,
    };
    try {
      if (isNew) await api.createDossier(body);
      else await api.updateDossier(row!.dossier_id, body);
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "New operation file" : "Edit operation file"} description="A dossier is the anchor everything (costing, transit, invoicing) tags.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select value={f.entity_id} onChange={(e) => set("entity_id", e.target.value)}>
              <option value="">—</option>
              {(entities || []).map((en) => <option key={en.entity_id} value={en.entity_id}>{en.legal_name || en.code}</option>)}
            </Select>
          </Field>
          <Field label="Client">
            <Select value={f.client_id} onChange={(e) => set("client_id", e.target.value)}>
              <option value="">—</option>
              {(clients || []).map((c) => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Port of loading"><Input value={f.pol} onChange={(e) => set("pol", e.target.value)} placeholder="Shanghai" /></Field>
          <Field label="Port of discharge"><Input value={f.pod} onChange={(e) => set("pod", e.target.value)} placeholder="Douala" /></Field>
          <Field label="Incoterm"><Input value={f.incoterm} onChange={(e) => set("incoterm", e.target.value)} placeholder="CIF" /></Field>
          <Field label="Customs regime"><Input value={f.customs_regime} onChange={(e) => set("customs_regime", e.target.value)} /></Field>
          <Field label="BL / MAWB" className="sm:col-span-2"><Input value={f.bl_mawb} onChange={(e) => set("bl_mawb", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!f.entity_id || busy} onCancel={onClose} saveLabel={isNew ? "Create file" : "Save changes"} />
      </form>
    </Modal>
  );
}

function Stat({ label, value, tone: t }: { label: string; value: React.ReactNode; tone?: "warn" | "ok" | "default" }) {
  const color = t === "warn" ? "text-[rgb(var(--warn))]" : t === "ok" ? "text-[rgb(var(--primary))]" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card/40 px-3.5 py-2.5">
      <div className="micro mb-1">{label}</div>
      <div className={`num text-lg font-medium ${color}`}>{value}</div>
    </div>
  );
}

/** 360° drawer: the per-file rollup (costing vs actual, invoicing, margin, docs, milestone chain). */
function Dossier360Modal({ dossier, clientLabel, onClose }: { dossier: api.Dossier; clientLabel: string; onClose: () => void }) {
  const ov = useResource(() => api.getOverview(dossier.dossier_id), [dossier.dossier_id]);
  const chain = useResource(() => api.milestonesByDossier(dossier.dossier_id), [dossier.dossier_id]);
  const d = ov.data;
  const svc = dossier.service_name_en || dossier.service_name_fr || humanizeKey(dossier.service_key);
  return (
    <Modal open onClose={onClose} size="xl" title={`Operation file · ${dossier.ref}`} description={`${clientLabel}${svc && svc !== "—" ? " · " + svc : ""}`}>
      {ov.loading ? (
        <div className="py-10 text-center micro">Loading 360…</div>
      ) : ov.error ? (
        <ErrorState message={errMsg(ov.error)} />
      ) : d ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Planned cost" value={money(d.costing.planned_cost)} />
            <Stat label="Actual cost" value={money(d.costs.actual_cost)} />
            <Stat label="Billed" value={money(d.invoicing.billed_ttc)} tone="ok" />
            <Stat label="Outstanding" value={money(d.invoicing.outstanding)} tone="warn" />
          </div>
          {d.economics && d.economics.gross_margin != null && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="Gross margin" value={money(d.economics.gross_margin)} tone={Number(d.economics.gross_margin) < 0 ? "warn" : "ok"} />
              <Stat label="Margin %" value={d.economics.margin_percent != null ? `${num(d.economics.margin_percent)}%` : "—"} />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Invoices" value={num(d.invoicing.count)} />
            <Stat label="Purchase orders" value={`${num(d.procurement.po_count)} · ${money(d.procurement.po_total)}`} />
            <Stat label="Transit orders" value={num(d.documents.transit_orders)} />
            <Stat label="Delivery notes" value={num(d.documents.delivery_notes)} />
          </div>
          <div>
            <div className="micro mb-2">Milestone chain</div>
            {chain.loading ? (
              <div className="py-3 text-center micro">Loading…</div>
            ) : (chain.data || []).length ? (
              <ol className="space-y-1.5">
                {(chain.data || []).map((m) => (
                  <li key={m.milestone_instance_id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
                    <span className="text-sm text-foreground">{m.label_fr || m.code}</span>
                    <div className="flex items-center gap-3">
                      <span className="micro">{dateFmt(m.due_date)}</span>
                      <Pill tone={tone(m.status)}>{m.status}</Pill>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <span className="micro">No milestone chain seeded for this file yet.</span>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

const OPS_FILES_AI: AiAction[] = [
  { label: "List / get dossiers", kind: "read", describe: "List operation files (dossiers) or fetch one." },
  { label: "Open / advance dossier", kind: "write", describe: "Open a dossier, update it, or advance its status." },
];

export function OperationsFilesPage() {
  const { rows, error, loading, reload } = useList<api.Dossier>("/operations");
  const { rows: clients } = useList<Client>("/clients");
  const [editing, setEditing] = React.useState<api.Dossier | "new" | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<api.Dossier | null>(null);
  // `?ref=` deep-links a single dossier — the Control Tower's live-shipment rows
  // use it, since there's no dossier-detail route to send them to. It only seeds
  // the initial search; the user can clear or change it like any other query.
  const [searchParams] = useSearchParams();
  const [q, setQ] = React.useState(() => searchParams.get("ref") || "");
  const [family, setFamily] = React.useState("ALL");
  const files = rows || [];
  const clientName = nameMap(clients, "client_id", "name");

  const clientOf = (r: api.Dossier) => r.client_name || (r.client_id ? clientName[r.client_id] : "") || "—";
  const routeOf = (r: api.Dossier) => (r.pol || r.pod ? `${r.pol || "?"} → ${r.pod || "?"}` : "—");
  const svcLabel = (r: api.Dossier) => r.service_name_en || r.service_name_fr || humanizeKey(r.service_key);
  const pctOf = (r: api.Dossier) => (r.milestone_total ? Math.round((100 * (r.milestone_done || 0)) / r.milestone_total) : 0);

  const famCounts = React.useMemo(() => {
    const m: Record<string, number> = { ALL: files.length };
    SERVICE_FAMILIES.forEach((fam) => { m[fam.key] = 0; });
    files.forEach((r) => { const k = familyOf(r); if (m[k] != null) m[k] += 1; });
    return m;
  }, [files]);

  const filtered = files.filter((r) => {
    if (family !== "ALL" && familyOf(r) !== family) return false;
    if (!q.trim()) return true;
    const hay = `${r.ref} ${clientOf(r)} ${routeOf(r)} ${svcLabel(r)} ${r.bl_mawb || ""} ${r.vessel_flight || ""}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  async function advance(d: api.Dossier) {
    const next = d.status === "OPEN" ? "IN_PROGRESS" : d.status === "IN_PROGRESS" ? "COMPLETED" : null;
    if (!next) return;
    setBusyId(d.dossier_id);
    try { await api.transitionDossier(d.dossier_id, next); reload(); } finally { setBusyId(null); }
  }

  const columns: Column<api.Dossier>[] = [
    { key: "ref", label: "Reference", render: (r) => <span className="num font-medium text-foreground">{r.ref}</span> },
    { key: "client", label: "Client", render: (r) => clientOf(r) },
    { key: "service", label: "Service", render: (r) => (r.service_key || r.service_name_en ? <Pill tone="mute">{svcLabel(r)}</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "route", label: "Route", render: (r) => <span className="text-muted-foreground">{routeOf(r)}</span> },
    {
      key: "milestone", label: "Milestone", render: (r) => {
        const pct = pctOf(r);
        return (
          <div className="min-w-[9rem] max-w-[12rem]">
            <div className="micro mb-1 truncate">{r.current_milestone || (pct >= 100 ? "All milestones done" : "—")}</div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-[rgb(var(--ink-3)/0.15)]">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="num text-[11px] text-muted-foreground">{pct}%</span>
            </div>
          </div>
        );
      },
    },
    { key: "costing", label: "Costing · XAF", className: "num text-right", render: (r) => money(r.costing_total) },
    { key: "status", label: "Status", render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill> },
    {
      key: "_a", label: "", render: (r) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
          {(r.status === "OPEN" || r.status === "IN_PROGRESS") && (
            <Button size="sm" variant="outline" loading={busyId === r.dossier_id} onClick={() => advance(r)}>
              {r.status === "OPEN" ? "Start" : "Complete"}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const chips = [{ key: "ALL", label: "All" }, ...SERVICE_FAMILIES.filter((fam) => (famCounts[fam.key] || 0) > 0)];

  return (
    <section className={shell}>
      <header className="mb-4 border-b border-border pb-4">
        <div className="micro mb-1 uppercase tracking-wide"><Link to="/" className="transition-colors hover:text-primary">Hub</Link> › Operations</div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Operation files</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">The dossier is the centre of gravity — route, milestones, costing, money and documents in one 360° view.</p>
          </div>
          <Button onClick={() => setEditing("new")}>New file</Button>
        </div>
      </header>
      <HubTabs />
      <KpiRow>
        <KpiTile label="Files" value={num(files.length)} />
        <KpiTile label="Open" value={num(files.filter((d) => d.status === "OPEN").length)} />
        <KpiTile label="In progress" value={num(files.filter((d) => d.status === "IN_PROGRESS").length)} />
        <KpiTile label="Completed" value={num(files.filter((d) => d.status === "COMPLETED").length)} />
      </KpiRow>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const on = family === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setFamily(c.key)}
                className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${on ? "border-transparent bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {c.label} <span className="num opacity-70">{famCounts[c.key] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ref, client, BL/MAWB, vessel…" className="w-full max-w-xs" />
      </div>
      <DataList columns={columns} rows={filtered} error={error} loading={loading} rowKey={(r) => r.dossier_id} onRowClick={(r) => setView(r)} empty={{ title: "No operation files yet", hint: "Open a dossier to start moving a shipment." }} />
      {editing !== null && <DossierForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {view && <Dossier360Modal dossier={view} clientLabel={clientOf(view)} onClose={() => setView(null)} />}
      <AiActions actions={OPS_FILES_AI} />
    </section>
  );
}

/* ═══════════════════════════ Transit orders ═══════════════════════════ */

const CUSTOMS = ["IM4", "IM7", "IM8", "EX1", "EX2"];

function TransitForm({ row, onClose, onSaved }: { row: api.TransitOrder | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const { rows: entities } = useList<Entity>("/entities");
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [f, setF] = React.useState({
    entity_id: row?.entity_id ?? "", dossier_id: row?.dossier_id ?? "", customs_regime: row?.customs_regime ?? "",
    service_direction: row?.service_direction ?? "", declared_value: row?.declared_value != null ? String(row.declared_value) : "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const body: api.TransitOrderInput = {
      entity_id: f.entity_id, dossier_id: f.dossier_id || undefined, customs_regime: f.customs_regime || undefined,
      service_direction: f.service_direction || undefined, declared_value: f.declared_value === "" ? undefined : Number(f.declared_value),
    };
    try {
      if (isNew) await api.createTransitOrder(body);
      else await api.updateTransitOrder(row!.transit_order_id, body);
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "New transit order" : "Edit transit order"} description="Customs transit declaration tied to a dossier.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select value={f.entity_id} onChange={(e) => set("entity_id", e.target.value)}>
              <option value="">—</option>
              {(entities || []).map((en) => <option key={en.entity_id} value={en.entity_id}>{en.legal_name || en.code}</option>)}
            </Select>
          </Field>
          <Field label="Dossier">
            <Select value={f.dossier_id} onChange={(e) => set("dossier_id", e.target.value)}>
              <option value="">—</option>
              {(dossiers || []).map((d) => <option key={d.dossier_id} value={d.dossier_id}>{d.ref}</option>)}
            </Select>
          </Field>
          <Field label="Customs regime">
            <Select value={f.customs_regime} onChange={(e) => set("customs_regime", e.target.value)}>
              <option value="">—</option>
              {CUSTOMS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Direction">
            <Select value={f.service_direction} onChange={(e) => set("service_direction", e.target.value)}>
              <option value="">—</option>
              <option value="IMPORT">Import</option>
              <option value="EXPORT">Export</option>
            </Select>
          </Field>
          <Field label="Declared value" className="sm:col-span-2"><Input type="number" min="0" step="0.01" className="num text-right" value={f.declared_value} onChange={(e) => set("declared_value", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!f.entity_id || busy} onCancel={onClose} saveLabel={isNew ? "Create order" : "Save changes"} />
      </form>
    </Modal>
  );
}

export function TransitOrdersPage() {
  const { rows, error, loading, reload } = useList<api.TransitOrder>("/transit-orders");
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [editing, setEditing] = React.useState<api.TransitOrder | "new" | null>(null);
  const dref = nameMap(dossiers, "dossier_id", "ref");
  const list = rows || [];
  const columns: Column<api.TransitOrder>[] = [
    { key: "ref", label: "Ref", render: (r) => <span className="num font-medium text-foreground">{r.ref || r.transit_order_id.slice(0, 8)}</span> },
    { key: "dossier_id", label: "Dossier", render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—") },
    { key: "customs_regime", label: "Regime", render: (r) => (r.customs_regime ? <Pill tone="mute">{r.customs_regime}</Pill> : "—") },
    { key: "service_direction", label: "Direction" },
    { key: "declared_value", label: "Declared value", className: "num text-right", render: (r) => money(r.declared_value) },
    { key: "status", label: "Status", render: (r) => (r.status ? <Pill tone={tone(r.status)}>{r.status}</Pill> : "—") },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Operations" />} title="Transit orders" description="Customs transit declarations." action={<Button onClick={() => setEditing("new")}>New order</Button>} />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Orders" value={num(list.length)} />
        <KpiTile label="Import" value={num(list.filter((t) => t.service_direction === "IMPORT").length)} />
        <KpiTile label="Export" value={num(list.filter((t) => t.service_direction === "EXPORT").length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.transit_order_id} onRowClick={(r) => setEditing(r)} empty={{ title: "No transit orders", hint: "Raise a transit declaration against a dossier." }} />
      {editing !== null && <TransitForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      <ScreenAi path="operations/transit-orders" />
    </section>
  );
}

/* ═══════════════════════════ Delivery notes ═══════════════════════════ */

function DeliveryForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: entities } = useList<Entity>("/entities");
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [f, setF] = React.useState({ entity_id: "", dossier_id: "", consignee: "", city_zone: "", contact_person: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.createDeliveryNote({ entity_id: f.entity_id, dossier_id: f.dossier_id || undefined, consignee: f.consignee || undefined, city_zone: f.city_zone || undefined, contact_person: f.contact_person || undefined });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="New delivery note" description="Proof-of-delivery for a consignee.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select value={f.entity_id} onChange={(e) => set("entity_id", e.target.value)}>
              <option value="">—</option>
              {(entities || []).map((en) => <option key={en.entity_id} value={en.entity_id}>{en.legal_name || en.code}</option>)}
            </Select>
          </Field>
          <Field label="Dossier">
            <Select value={f.dossier_id} onChange={(e) => set("dossier_id", e.target.value)}>
              <option value="">—</option>
              {(dossiers || []).map((d) => <option key={d.dossier_id} value={d.dossier_id}>{d.ref}</option>)}
            </Select>
          </Field>
          <Field label="Consignee" className="sm:col-span-2"><Input value={f.consignee} onChange={(e) => set("consignee", e.target.value)} /></Field>
          <Field label="City / zone"><Input value={f.city_zone} onChange={(e) => set("city_zone", e.target.value)} /></Field>
          <Field label="Contact person"><Input value={f.contact_person} onChange={(e) => set("contact_person", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!f.entity_id || busy} onCancel={onClose} saveLabel="Create note" />
      </form>
    </Modal>
  );
}

export function DeliveryNotesPage() {
  const { rows, error, loading, reload } = useList<api.DeliveryNote>("/delivery-notes");
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [open, setOpen] = React.useState(false);
  const dref = nameMap(dossiers, "dossier_id", "ref");
  const columns: Column<api.DeliveryNote>[] = [
    { key: "ref", label: "Ref", render: (r) => <span className="num font-medium text-foreground">{r.ref || r.delivery_note_id.slice(0, 8)}</span> },
    { key: "dossier_id", label: "Dossier", render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—") },
    { key: "consignee", label: "Consignee" },
    { key: "city_zone", label: "City / zone" },
    { key: "contact_person", label: "Contact" },
    { key: "status", label: "Status", render: (r) => (r.status ? <Pill tone={tone(r.status)}>{r.status}</Pill> : "—") },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Operations" />} title="Delivery notes" description="Proof-of-delivery documents." action={<Button onClick={() => setOpen(true)}>New note</Button>} />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Notes" value={num((rows || []).length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.delivery_note_id} empty={{ title: "No delivery notes", hint: "Issue a delivery note when goods reach the consignee." }} />
      {open && <DeliveryForm onClose={() => setOpen(false)} onSaved={reload} />}
      <ScreenAi path="operations/delivery-notes" />
    </section>
  );
}

/* ═══════════════════════════ Milestones ═══════════════════════════ */

export function MilestonesPage() {
  const { rows: dossiers } = useList<api.Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");
  const inst = useResource(() => (dossierId ? api.milestonesByDossier(dossierId) : Promise.resolve([])), [dossierId]);
  const templates = useList<api.MilestoneTemplate>("/milestones/templates");
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function advance(m: api.MilestoneInstance) {
    setBusyId(m.milestone_instance_id);
    try { await api.advanceMilestone(m.milestone_instance_id); inst.reload(); } finally { setBusyId(null); }
  }

  const instCols: Column<api.MilestoneInstance>[] = [
    { key: "label_fr", label: "Milestone", render: (r) => <span className="font-medium text-foreground">{r.label_fr || r.code}</span> },
    { key: "due_date", label: "Due", render: (r) => dateFmt(r.due_date) },
    { key: "status", label: "Status", render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill> },
    {
      key: "_a", label: "", render: (r) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          {r.status !== "DONE" && r.status !== "COMPLETED" && (
            <Button size="sm" variant="outline" loading={busyId === r.milestone_instance_id} onClick={() => advance(r)}>Advance</Button>
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
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Operations" />} title="Milestones" description="Track a dossier's milestone chain; manage the templates that seed them." />
      <HubTabs />
      <div className="mb-4 flex items-center gap-3">
        <span className="micro">Dossier</span>
        <Select value={dossierId} onChange={(e) => setDossierId(e.target.value)} className="max-w-xs">
          <option value="">Select a dossier…</option>
          {(dossiers || []).map((d) => <option key={d.dossier_id} value={d.dossier_id}>{d.ref}</option>)}
        </Select>
      </div>
      {dossierId ? (
        <div className="mb-8">
          <DataList columns={instCols} rows={inst.data} error={inst.error} loading={inst.loading} rowKey={(r) => r.milestone_instance_id} empty={{ title: "No milestones", hint: "This dossier has no milestone chain yet." }} />
        </div>
      ) : null}
      <div className="micro mb-2">Templates</div>
      <DataList columns={tplCols} rows={templates.rows} error={templates.error} loading={templates.loading} rowKey={(r, i) => r.milestone_template_id || String(i)} empty={{ title: "No templates", hint: "Milestone templates seed each dossier's chain." }} />
      <ScreenAi path="operations/milestones" />
    </section>
  );
}
