/**
 * Financial dictionary — the gear behind the header. Every dropdown on the
 * dictionary is backed by `dictionary_ref` (seeded, never hardcoded); this panel
 * is where a manager adds/retires values without a release. Same inline "+ Add"
 * shape as master-data-settings.tsx.
 */
import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useResource, errMsg } from "@/lib/use-resource";
import * as api from "@/lib/masterdata-api";

const KINDS: { kind: api.DictRefKind; label: string }[] = [
  { kind: "SUBCATEGORY", label: "Sub-categories" },
  { kind: "UNIT", label: "Units" },
  { kind: "PROOF_SOURCE", label: "Proof sources" },
  { kind: "PROVIDER_KIND", label: "Provider kinds" },
];

function RefManager({ kind }: { kind: api.DictRefKind }) {
  const toast = useToast();
  const list = useResource(() => api.listDictRefs(kind, true), [kind]);
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ code: "", name_fr: "", name_en: "" });
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!form.code || !form.name_fr) { toast.error("Code and French name are required"); return; }
    setBusy(true);
    try {
      await api.createDictRef({ kind, code: form.code, name_fr: form.name_fr, name_en: form.name_en || undefined });
      toast.success("Value added"); setForm({ code: "", name_fr: "", name_en: "" }); setAdding(false); list.reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }
  async function toggle(r: api.DictRef) {
    try { await api.updateDictRef(r.ref_id, { is_active: !(r.is_active ?? true) }); list.reload(); }
    catch (e) { toast.error(errMsg(e)); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="micro">Values a manager can extend. Seeded rows are marked <em>System</em> but stay editable.</p>
        <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>+ Add new</Button>
      </div>
      {adding && (
        <div className="rounded-lg border bg-card p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="CODE" value={form.code} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value.toUpperCase() }))} />
            <Input placeholder="Nom (FR)" value={form.name_fr} onChange={(e) => setForm((s) => ({ ...s, name_fr: e.target.value }))} />
            <Input placeholder="Name (EN)" value={form.name_en} onChange={(e) => setForm((s) => ({ ...s, name_en: e.target.value }))} />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setForm({ code: "", name_fr: "", name_en: "" }); }}>Cancel</Button>
            <Button size="sm" loading={busy} onClick={submit}>Add</Button>
          </div>
        </div>
      )}
      {list.loading ? <LoadingRow label="Loading…" /> : list.error ? <ErrorState message={list.error} /> : (list.data || []).length === 0 ? <EmptyState title="Nothing yet" hint="Add your first value." /> : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {(list.data || []).map((r) => (
                <tr key={r.ref_id} className={r.is_active === false ? "opacity-50" : ""}>
                  <td className="px-3 py-1.5 num font-medium text-foreground">{r.code}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.name_fr}{r.name_en ? ` · ${r.name_en}` : ""}</td>
                  <td className="px-3 py-1.5">{r.is_system && <Pill tone="mute">System</Pill>}</td>
                  <td className="px-3 py-1.5 text-right"><button onClick={() => toggle(r)} className="text-sm text-primary-ink underline">{(r.is_active ?? true) ? "Deactivate" : "Activate"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function FinancialDictionarySettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = React.useState<api.DictRefKind>("SUBCATEGORY");
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title="Dictionary settings" description="Seeded-but-editable values behind every dropdown.">
      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {KINDS.map((k) => (
          <button key={k.kind} onClick={() => setKind(k.kind)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${kind === k.kind ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="max-h-[60vh] overflow-auto pr-1"><RefManager kind={kind} /></div>
    </Modal>
  );
}
