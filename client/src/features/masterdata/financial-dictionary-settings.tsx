/**
 * Financial dictionary — the gear behind the header. Every dropdown on the
 * dictionary is backed by `dictionary_ref` (seeded, never hardcoded); this panel
 * is where a manager adds/retires values without a release. Same inline "+ Add"
 * shape as master-data-settings.tsx.
 */
import * as React from "react";
import { Modal, Field, Select } from "@/components/ui/modal";
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
  // Seed-only until the API enum was opened. A carrier introducing a 50' box
  // used to mean a code change; it is now the same three fields as any other
  // registry value, plus the equipment facts below.
  { kind: "CONTAINER_TYPE", label: "Container types" },
  { kind: "LOAD_MODE", label: "Load modes" },
];

/** Seeded families, so a first container type on a fresh tenant still has a
 *  list to choose from. The live distinct values are merged in on top — the
 *  set is open, and a tenant who invents one keeps it. */
const SEED_FAMILIES = ["DRY", "REEFER", "FLATRACK", "OPENTOP", "ISOTANK", "VENTILATED", "BULK"];

const BLANK_FORM = { code: "", name_fr: "", name_en: "", teu: "", size: "", family: "DRY", aliases: "" };

function RefManager({ kind }: { kind: api.DictRefKind }) {
  const toast = useToast();
  const list = useResource(() => api.listDictRefs(kind, true), [kind]);
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState(BLANK_FORM);
  const [busy, setBusy] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  // A container type carries three facts nothing else does, and the cost of
  // leaving them blank is silent rather than loud: `Number(undefined) || 0`
  // makes the box count as zero TEU in the dossier editor and in the shipment
  // TEU total, and no `size` means the rate card has no key to look it up by.
  // So they are captured here, and the API refuses the row without them.
  const isContainer = kind === "CONTAINER_TYPE";
  const teuError = isContainer && !(Number(form.teu) > 0) ? "TEU is required and must be greater than 0." : null;
  const sizeError = isContainer && !form.size.trim() ? "Size is the rate-card lookup key — required." : null;

  const families = React.useMemo(() => {
    const seen = new Set(SEED_FAMILIES);
    for (const r of list.data || []) if (r.extra?.family) seen.add(r.extra.family);
    return [...seen];
  }, [list.data]);

  const reset = () => { setForm(BLANK_FORM); setTouched(false); };

  async function submit() {
    setTouched(true);
    if (!form.code || !form.name_fr) { toast.error("Code and French name are required"); return; }
    if (teuError || sizeError) return;
    setBusy(true);
    try {
      const aliases = form.aliases.split(",").map((a) => a.trim()).filter(Boolean);
      await api.createDictRef({
        kind, code: form.code, name_fr: form.name_fr, name_en: form.name_en || undefined,
        extra: isContainer
          ? { teu: Number(form.teu), size: form.size.trim(), family: form.family, ...(aliases.length ? { aliases } : {}) }
          : undefined,
      });
      toast.success("Value added"); reset(); setAdding(false); list.reload();
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
        <Button size="sm" variant="outline" onClick={() => { setAdding((a) => !a); reset(); }}>+ Add new</Button>
      </div>
      {adding && (
        <div className="rounded-lg border bg-card p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="CODE" aria-label="Code" value={form.code} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value.toUpperCase() }))} />
            <Input placeholder="Nom (FR)" aria-label="Nom (FR)" value={form.name_fr} onChange={(e) => setForm((s) => ({ ...s, name_fr: e.target.value }))} />
            <Input placeholder="Name (EN)" aria-label="Name (EN)" value={form.name_en} onChange={(e) => setForm((s) => ({ ...s, name_en: e.target.value }))} />
          </div>
          {isContainer && (
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <Field label="TEU" required error={touched ? teuError || undefined : undefined}
                hint="Capacity. A 20' is 1, a 40' is 2.">
                <Input type="number" min="0" step="0.01" inputMode="decimal" className="num text-right"
                  placeholder="2" value={form.teu}
                  onChange={(e) => setForm((s) => ({ ...s, teu: e.target.value }))} />
              </Field>
              <Field label="Size key" required error={touched ? sizeError || undefined : undefined}
                hint="What the rate card calls it — 20, 40, 40HC.">
                <Input placeholder="50HC" value={form.size}
                  onChange={(e) => setForm((s) => ({ ...s, size: e.target.value.toUpperCase() }))} />
              </Field>
              <Field label="Family" hint="Groups the sized variants of one kind.">
                <Select value={form.family} onChange={(e) => setForm((s) => ({ ...s, family: e.target.value }))}>
                  {families.map((f) => <option key={f} value={f}>{f}</option>)}
                </Select>
              </Field>
              <Field label="Also known as" hint="Comma-separated, for the finder's search.">
                <Input placeholder="50hq, 50dc" value={form.aliases}
                  onChange={(e) => setForm((s) => ({ ...s, aliases: e.target.value }))} />
              </Field>
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); reset(); }}>Cancel</Button>
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
                  {/* The equipment facts are shown because they are the ones a
                      manager cannot infer from the name, and a wrong TEU is
                      otherwise invisible until a capacity report is wrong. */}
                  {isContainer && (
                    <td className="px-3 py-1.5 micro text-muted-foreground">
                      {r.extra?.teu ? `${r.extra.teu} TEU` : <span className="text-destructive">no TEU</span>}
                      {r.extra?.size ? ` · ${r.extra.size}` : ""}
                      {r.extra?.family ? ` · ${r.extra.family}` : ""}
                    </td>
                  )}
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
