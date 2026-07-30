/**
 * Catalogue selects — line items must reference a real DB row (financial
 * dictionary or inventory) so records reconcile and nobody can free-type
 * arbitrary text. `onPick` returns both the id (stored as the FK) and the label
 * (kept as a denormalised display snapshot, like `po_item.label`).
 */
import { Select } from "@/components/ui/modal";
import { useResource } from "@/lib/use-resource";
import { loadDictionaryItems } from "@/lib/finance-api";
import { listInventory } from "@/lib/wms-api";

type Opt = { id: string; label: string };

function OptSelect({ value, onPick, options, loading, placeholder }: {
  value?: string | null;
  onPick: (id: string, label: string) => void;
  options: Opt[];
  loading?: boolean;
  placeholder?: string;
}) {
  return (
    <Select
      value={value ?? ""}
      onChange={(e) => {
        const id = e.target.value;
        const opt = options.find((o) => o.id === id);
        onPick(id, opt ? opt.label : "");
      }}
    >
      <option value="">{loading ? "Loading…" : (placeholder || "— select —")}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </Select>
  );
}

/** Financial-dictionary item (purchase requests, purchase orders, invoices). */
export function DictionaryItemSelect({ value, onPick }: { value?: string | null; onPick: (id: string, label: string) => void }) {
  const r = useResource(() => loadDictionaryItems(), []);
  return <OptSelect value={value} onPick={onPick} options={r.data || []} loading={r.loading} placeholder="— item —" />;
}

/** Warehouse inventory item (GRN, delivery note). */
export function InventoryItemSelect({ value, onPick }: { value?: string | null; onPick: (id: string, label: string) => void }) {
  const r = useResource(() => listInventory(), []);
  const options: Opt[] = (r.data || []).map((i) => ({ id: i.inventory_item_id, label: i.description || i.sku || i.inventory_item_id.slice(0, 8) }));
  return <OptSelect value={value} onPick={onPick} options={options} loading={r.loading} placeholder="— item —" />;
}
