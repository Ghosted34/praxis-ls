/**
 * The equipment step of the Dictionary Finder — "which box is this charge for,
 * and how many?"
 *
 * WHY IT EXISTS. 0632 moved equipment off the catalogue item and onto the rate:
 * one "Port Charges" line, priced per container type. That is the right shape,
 * and it means the DOCUMENT has to say which type it bought — otherwise a sheet
 * with 3 × 20' RF and 2 × 40' HC of port charges is two rows with the same label,
 * different unit costs, and nothing recording why they differ. 0663 gave the
 * four line tables the column; this is where a person fills it in.
 *
 * WHY IT PRE-FILLS FROM THE DOSSIER. The container editor already holds the
 * truth about what is on the file. Asking for it a second time here is how the
 * two come to disagree, so when a `dossierId` is supplied the types on the file
 * arrive already ticked with their box counts as the quantity. Everything stays
 * editable — the file says what is shipping, not what this particular charge
 * applies to, and those are not always the same.
 *
 * WITHOUT A DOSSIER (a purchase order, a standing request) it degrades to the
 * plain list: every active type, nothing ticked, quantity 1. That is the reason
 * `dossierId` is optional rather than required — a caller with no file still
 * gets a working step instead of an empty one.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useResource } from "@/lib/use-resource";
import { listDictRefs, type DictRef } from "@/lib/masterdata-api";
import { groupTypes, teuOf, typeLabel } from "@/lib/container-types";
import { getDossierContainers } from "@/lib/operations-api";

/** `label` rides along so the calling form can show what was picked without
 *  loading the whole registry a second time — the duplicate fetch this step
 *  exists to remove. */
export type EquipmentPick = {
  container_type_ref_id: string;
  qty: number;
  label: string;
};

export function EquipmentStep({
  dossierId,
  value,
  onChange,
  onConfirm,
  onBack,
  itemLabel,
}: {
  /** Dossier whose containers pre-fill the step. Omit outside dossier context. */
  dossierId?: string | null;
  value: EquipmentPick[];
  onChange: (picks: EquipmentPick[]) => void;
  onConfirm: () => void;
  onBack: () => void;
  /** The charge being priced, so the step says what it is a step of. */
  itemLabel?: string;
}) {
  const types = useResource<DictRef[]>(
    () => listDictRefs("CONTAINER_TYPE"),
    [],
  );
  // Resolves to null with no dossier — the step then renders the plain list
  // rather than waiting on a request it was never going to make.
  const onFile = useResource(
    () => (dossierId ? getDossierContainers(dossierId) : Promise.resolve(null)),
    [dossierId],
  );

  const active = React.useMemo(
    () => (types.data || []).filter((t) => t.is_active !== false),
    [types.data],
  );
  const byId = React.useMemo(
    () => new Map(active.map((t) => [t.ref_id, t])),
    [active],
  );

  // Pre-fill once, when both the registry and the file have landed. Guarded on
  // `value.length` so re-opening the step does not discard what was ticked.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current || types.loading || onFile.loading) return;
    seeded.current = true;
    if (value.length) return;
    const lines = onFile.data?.lines || [];
    const merged = new Map<string, number>();
    for (const l of lines) {
      if (!l.container_type_ref_id || !byId.has(l.container_type_ref_id))
        continue;
      // A file may hold the same type on two lines (different load modes); the
      // charge cares only about the type, so the counts add.
      merged.set(
        l.container_type_ref_id,
        (merged.get(l.container_type_ref_id) || 0) + (Number(l.qty) || 0),
      );
    }
    if (merged.size) {
      onChange(
        [...merged].map(([id, qty]) => ({
          container_type_ref_id: id,
          qty: qty || 1,
          label: typeLabel(byId.get(id)!),
        })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.loading, onFile.loading, byId]);

  const picked = new Map(value.map((p) => [p.container_type_ref_id, p.qty]));

  const toggle = (id: string) => {
    if (picked.has(id))
      onChange(value.filter((p) => p.container_type_ref_id !== id));
    else
      onChange([
        ...value,
        { container_type_ref_id: id, qty: 1, label: typeLabel(byId.get(id)!) },
      ]);
  };
  const setQty = (id: string, qty: string) => {
    const n = Number(qty.replace(/[^\d]/g, ""));
    onChange(
      value.map((p) => (p.container_type_ref_id === id ? { ...p, qty: n } : p)),
    );
  };

  const totalTeu = value.reduce(
    (s, p) => s + teuOf(byId.get(p.container_type_ref_id)) * (p.qty || 0),
    0,
  );
  const valid = value.length > 0 && value.every((p) => p.qty > 0);

  if (types.error) return <ErrorState message={types.error} />;

  return (
    <div className="flex max-h-[26rem] flex-col">
      <div className="border-b p-2">
        <p className="text-sm font-medium text-foreground">
          {itemLabel ? `${itemLabel} — which containers?` : "Which containers?"}
        </p>
        <p className="micro text-muted-foreground">
          {dossierId
            ? "Pre-filled from the file's equipment. One cost line per type."
            : "No operations file on this document — pick the types this charge covers."}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {types.loading ? (
          <Skeleton className="h-32 w-full" />
        ) : active.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            No container types are active. Add one under Dictionary settings →
            Container types.
          </div>
        ) : (
          groupTypes(active).map(([family, list]) => (
            <fieldset key={family} className="mb-1">
              <legend className="px-2 py-1 micro uppercase tracking-wide text-muted-foreground">
                {family}
              </legend>
              {list.map((t) => {
                const on = picked.has(t.ref_id);
                return (
                  <div
                    key={t.ref_id}
                    className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      id={`eq-${t.ref_id}`}
                      checked={on}
                      onChange={() => toggle(t.ref_id)}
                    />
                    <label
                      htmlFor={`eq-${t.ref_id}`}
                      className="min-w-0 flex-1 truncate text-sm text-foreground"
                    >
                      {typeLabel(t)}
                      {t.extra?.teu ? (
                        <span className="ml-1 micro text-muted-foreground">
                          {t.extra.teu} TEU
                        </span>
                      ) : null}
                    </label>
                    <Input
                      className="num w-16 text-right"
                      inputMode="numeric"
                      aria-label={`Quantity, ${typeLabel(t)}`}
                      disabled={!on}
                      value={on ? String(picked.get(t.ref_id) ?? "") : ""}
                      onChange={(e) => setQty(t.ref_id, e.target.value)}
                    />
                  </div>
                );
              })}
            </fieldset>
          ))
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t p-2">
        <p className="micro text-muted-foreground" aria-live="polite">
          {value.length === 0
            ? "Nothing selected"
            : `${value.length} line${value.length === 1 ? "" : "s"}${totalTeu ? ` · ${Math.round(totalTeu * 100) / 100} TEU` : ""}`}
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button type="button" size="sm" disabled={!valid} onClick={onConfirm}>
            Add lines
          </Button>
        </div>
      </div>
    </div>
  );
}
