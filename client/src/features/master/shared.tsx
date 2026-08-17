/**
 * Master data — the corporate-entity picker Clients and Suppliers both use.
 *
 * Split out of `features/master/pages.tsx` (687 lines) in Phase 4, audit F7.
 */

import { type Row } from "@/lib/use-resource";
import { tr } from "@/lib/i18n";
import { cell } from "@/lib/format";
import { Select } from "@/components/ui/modal";

/** Optional corporate-entity picker, shared by Clients + Suppliers. */
export function EntitySelect({
  entities,
  value,
  onChange,
}: {
  entities: Row[] | null;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select
      aria-label={tr("Corporate entity")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{tr("— none —")}</option>
      {(entities || []).map((en) => {
        const name = cell(en.legal_name ?? en.entity_id);
        const label = en.code ? `${cell(en.code)} · ${name}` : name;
        return (
          <option key={String(en.entity_id)} value={String(en.entity_id)}>
            {label}
          </option>
        );
      })}
    </Select>
  );
}

/* ──────────────────────────────── Clients ──────────────────────────────── */
