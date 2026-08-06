/**
 * Master Data settings (spec §5.3, §6) — the gear behind the Clients and
 * Suppliers headers. Per-tenant configuration of:
 *   - which fields are REQUIRED / VISIBLE on the master forms (party_field_config),
 *   - the CLIENT and SUPPLIER category registries, and
 *   - the KYC document-type registry,
 * with the inline "+ Add" pattern for categories and document types (§6.1).
 *
 * A panel rather than a separate route, so it opens over the list a manager is
 * already on; the same component serves the "Settings → Master Data" entry.
 */
import * as React from "react";
import { Modal, Select } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useResource, errMsg } from "@/lib/use-resource";
import { enumLabel } from "@/lib/format";
import * as api from "@/lib/masterdata-api";

type Side = "CLIENT" | "SUPPLIER";
const SECTIONS = ["Required fields", "Categories", "Document types"] as const;
type Section = (typeof SECTIONS)[number];

/* ── Field-requirement config ──────────────────────────────────────────────── */

function FieldConfigEditor({ side }: { side: Side }) {
  const toast = useToast();
  const cfg = useResource(() => api.getMasterConfig(side), [side]);
  const [rows, setRows] = React.useState<api.FieldConfigRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (cfg.data) setRows(cfg.data.fields); }, [cfg.data]);

  const set = (key: string, patch: Partial<api.FieldConfigRow>) =>
    setRows((rs) => rs.map((r) => (r.field_key === key ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    try { await api.putMasterConfig(side, rows); toast.success("Field configuration saved"); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }

  if (cfg.loading) return <LoadingRow label="Loading configuration…" />;
  if (cfg.error) return <ErrorState message={cfg.error} />;

  const groups = cfg.data?.groups ?? [];
  return (
    <div className="space-y-4">
      <p className="micro">Toggle which fields are required and visible on the {side.toLowerCase()} form. `name` is always required.</p>
      {groups.map((g) => {
        const inGroup = rows.filter((r) => (r.field_group || "OTHER") === g);
        if (inGroup.length === 0) return null;
        return (
          <div key={g} className="rounded-lg border">
            <div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {inGroup.map((r) => (
                  <tr key={r.field_key}>
                    <td className="px-3 py-1.5 text-foreground">{r.label_override || enumLabel(r.field_key)}</td>
                    <td className="w-24 px-3 py-1.5">
                      <Checkbox checked={r.is_required} disabled={r.field_key === "name"} onCheckedChange={(v) => set(r.field_key, { is_required: !!v })} label={<span className="text-xs">Required</span>} />
                    </td>
                    <td className="w-24 px-3 py-1.5">
                      <Checkbox checked={r.is_visible} onCheckedChange={(v) => set(r.field_key, { is_visible: !!v })} label={<span className="text-xs">Visible</span>} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <div className="flex justify-end"><Button loading={busy} onClick={save}>Save configuration</Button></div>
    </div>
  );
}

/* ── Registry manager (categories + document types) ────────────────────────── */

type RegItem = { id: string; code: string; name: string; is_system?: boolean; is_active?: boolean; extra?: React.ReactNode };

function RegistryManager({
  title, load, create, deactivate, addFields,
}: {
  title: string;
  load: () => Promise<RegItem[]>;
  create: (body: Record<string, string>) => Promise<unknown>;
  deactivate: (id: string, active: boolean) => Promise<unknown>;
  addFields?: { key: string; label: string; options?: string[] }[];
}) {
  const toast = useToast();
  const list = useResource(load, []);
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!form.code || !form.name) { toast.error("Code and name are required"); return; }
    setBusy(true);
    try { await create(form); toast.success(`${title} added`); setForm({}); setAdding(false); list.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }
  async function toggle(it: RegItem) {
    try { await deactivate(it.id, !(it.is_active ?? true)); list.reload(); }
    catch (e) { toast.error(errMsg(e)); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>+ Add new</Button>
      </div>
      {adding && (
        <div className="rounded-lg border bg-card p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="CODE" value={form.code || ""} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
            <Input placeholder="Display name" value={form.name || ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            {(addFields || []).map((af) => (
              af.options ? (
                <Select key={af.key} value={form[af.key] || ""} onChange={(e) => setForm((f) => ({ ...f, [af.key]: e.target.value }))}>
                  <option value="">{af.label}…</option>
                  {af.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              ) : (
                <Input key={af.key} placeholder={af.label} value={form[af.key] || ""} onChange={(e) => setForm((f) => ({ ...f, [af.key]: e.target.value }))} />
              )
            ))}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setForm({}); }}>Cancel</Button>
            <Button size="sm" loading={busy} onClick={submit}>Add</Button>
          </div>
        </div>
      )}
      {list.loading ? <LoadingRow label="Loading…" /> : list.error ? <ErrorState message={list.error} /> : (list.data || []).length === 0 ? <EmptyState title="Nothing yet" hint="Add your first item." /> : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {(list.data || []).map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-1.5 font-medium text-foreground">{it.code}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{it.name}</td>
                  <td className="px-3 py-1.5">{it.extra}{it.is_system && <Pill tone="mute">System</Pill>}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button onClick={() => toggle(it)} className="text-sm text-primary-ink underline">
                      {(it.is_active ?? true) ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── The settings panel ────────────────────────────────────────────────────── */

export function MasterDataSettings({ open, onClose, initialSide = "CLIENT" }: { open: boolean; onClose: () => void; initialSide?: Side }) {
  const [side, setSide] = React.useState<Side>(initialSide);
  const [section, setSection] = React.useState<Section>("Required fields");
  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="Master data settings" description="Per-tenant field requirements, categories and KYC document types.">
      <div className="mb-4 flex items-center gap-2">
        {(["CLIENT", "SUPPLIER"] as Side[]).map((s) => (
          <Button key={s} size="sm" variant={side === s ? "default" : "outline"} onClick={() => setSide(s)}>{enumLabel(s)}s</Button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {SECTIONS.map((t) => (
          <button key={t} onClick={() => setSection(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${section === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="max-h-[60vh] overflow-auto pr-1">
        {section === "Required fields" && <FieldConfigEditor side={side} />}
        {section === "Categories" && (side === "CLIENT" ? (
          <RegistryManager title="Client categories"
            load={async () => (await api.listClientTypes()).map((t) => ({ id: t.client_type_id, code: t.code, name: t.name, is_system: t.is_system, is_active: t.is_active }))}
            create={(b) => api.createClientType({ code: b.code, name: b.name })}
            deactivate={(id, active) => api.updateClientType(id, { is_active: active })} />
        ) : (
          <RegistryManager title="Supplier categories"
            load={async () => (await api.listSupplierTypes()).map((t) => ({ id: t.supplier_type_id, code: t.code, name: t.name, is_system: t.is_system, is_active: t.is_active }))}
            create={(b) => api.createSupplierType({ code: b.code, name: b.name })}
            deactivate={(id, active) => api.updateSupplierType(id, { is_active: active })} />
        ))}
        {section === "Document types" && (
          <RegistryManager title="KYC document types"
            load={async () => (await api.listDocumentTypes()).map((t) => ({ id: t.document_type_id, code: t.code, name: t.name, is_system: t.is_system, is_active: t.is_active, extra: <Pill tone="mute">{t.applies_to}</Pill> }))}
            create={(b) => api.createDocumentType({ code: b.code, name: b.name, applies_to: b.applies_to || "BOTH" })}
            deactivate={(id, active) => api.updateDocumentType(id, { is_active: active })}
            addFields={[{ key: "applies_to", label: "Applies to", options: ["BOTH", "CLIENT", "SUPPLIER"] }]} />
        )}
      </div>
    </Modal>
  );
}
