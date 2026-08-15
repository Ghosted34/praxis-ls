/**
 * The dictionary cell on a finance document line.
 *
 * Finance used a bare `<Select>` over all 176 catalogue items on three line
 * editors (two invoice forms, one credit-note form) while costing, quotation,
 * cash requests and procurement all used `<DictionaryFinder>`. That is the
 * split the finder's own docstring argues against: an operator reading a
 * carrier invoice looks for "surestaries" and the catalogue says Demurrage, and
 * a flat select answers that with the nearest-looking line.
 *
 * Adopting the finder here is also what gives these forms the equipment step
 * for free — the payoff of putting it in the shared control rather than in each
 * document. One pick of a charge priced per container type becomes one line per
 * type, which is `expandInvLines` below.
 */
import { DictionaryFinder } from "@/components/dictionary-finder";
import type { EquipmentPick } from "@/components/equipment-step";
import type { DictSearchHit } from "@/lib/masterdata-api";
import type { InvLine } from "./shared";

export function DictLineCell({
  line,
  index,
  dossierId,
  onPick,
  onPickMulti,
}: {
  line: InvLine;
  index: number;
  dossierId?: string | null;
  onPick: (id: string, label: string, hit?: DictSearchHit) => void;
  onPickMulti: (
    id: string,
    label: string,
    hit: DictSearchHit,
    picks: EquipmentPick[],
  ) => void;
}) {
  return (
    <div className="min-w-0">
      <DictionaryFinder
        label={`Item, line ${index + 1}`}
        placeholder="Dictionary item…"
        value={line.dictionary_item_id}
        valueLabel={line.label || line.dictionary_item_id}
        dossierId={dossierId}
        onPick={onPick}
        onPickMulti={onPickMulti}
      />
      {line.container_type_label && (
        <p className="mt-0.5 truncate micro text-muted-foreground">
          {line.container_type_label}
        </p>
      )}
    </div>
  );
}
