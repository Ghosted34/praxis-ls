/**
 * The equipment on an operations file — "2 × 20' Flat Rack, 3 × 40' HC".
 *
 * WHY IT LOOKS LIKE THE EXPENSE-RATE GEAR MODAL. It reads the same registry:
 * `dictionary_ref` kind CONTAINER_TYPE, the rows expense rates are already
 * priced against per carrier (0634). A file's equipment and its rate card
 * therefore cannot disagree about what a 40' HC is, and a tenant who adds a
 * container type from the rate screen gets it here with no further work.
 *
 * TWO LEVELS OF DETAIL, and the file never waits for the second.
 *
 *   GROUPED  — how many of each type. This is what is known at booking, and it
 *              is enough for anything charged per type or per TEU.
 *   PER_BOX  — additionally the container numbers, seals and dates, which are
 *              what make anything charged per container per day exact rather
 *              than estimated. They arrive with the Bill of Lading, days later,
 *              so they are never required to save.
 *
 * Which one a file offers is a per-service-type setting (Service types →
 * Details), not a choice made here.
 *
 * WHOLE-COLLECTION SAVE. The dialog PUTs every line at once. Per-row requests
 * would leave the file half-edited if one failed, and would make "3 × 40HC"
 * briefly read as "0 × 40HC" between two calls. Per-box detail already recorded
 * survives a quantity correction — the server re-attaches units by container
 * number.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, Field } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { errMsg, useResource } from "@/lib/use-resource";
import { listDictRefs, type DictRef } from "@/lib/masterdata-api";
import { groupTypes, teuOf, typeLabel } from "@/lib/container-types";
import * as api from "@/lib/operations-api";

type Draft = {
  container_type_ref_id: string;
  load_mode_ref_id: string;
  qty: string;
  units: { container_no: string; seal_no: string }[];
};

const blank = (): Draft => ({
  container_type_ref_id: "",
  load_mode_ref_id: "",
  qty: "1",
  units: [],
});

export function ContainerEditor({
  dossierId,
  mode,
  onClose,
  onSaved,
}: {
  dossierId: string;
  mode: "GROUPED" | "PER_BOX";
  onClose: () => void;
  onSaved?: () => void;
}) {
  const types = useResource<DictRef[]>(
    () => listDictRefs("CONTAINER_TYPE"),
    [],
  );
  const modes = useResource<DictRef[]>(() => listDictRefs("LOAD_MODE"), []);
  const loaded = useResource<api.ContainerBlock>(
    () => api.getDossierContainers(dossierId),
    [dossierId],
  );

  const [rows, setRows] = React.useState<Draft[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!loaded.data) return;
    setRows(
      loaded.data.lines.map((l) => ({
        container_type_ref_id: l.container_type_ref_id,
        load_mode_ref_id: l.load_mode_ref_id || "",
        qty: String(l.qty),
        units: (l.units || []).map((u) => ({
          container_no: u.container_no || "",
          seal_no: u.seal_no || "",
        })),
      })),
    );
  }, [loaded.data]);

  if (loaded.error) return <ErrorState message={loaded.error} />;

  const set = (i: number, patch: Partial<Draft>) =>
    setRows((s) =>
      (s || []).map((r, ix) => (ix === i ? { ...r, ...patch } : r)),
    );
  const setUnit = (
    i: number,
    u: number,
    patch: Partial<{ container_no: string; seal_no: string }>,
  ) =>
    setRows((s) =>
      (s || []).map((r, ix) =>
        ix === i
          ? {
              ...r,
              units: r.units.map((x, ux) =>
                ux === u ? { ...x, ...patch } : x,
              ),
            }
          : r,
      ),
    );

  const typeList = (types.data || []).filter((t) => t.is_active !== false);
  const byId = new Map(typeList.map((t) => [t.ref_id, t]));

  const totals = (rows || []).reduce(
    (acc, r) => {
      const n = Number(r.qty) || 0;
      const teu = teuOf(byId.get(r.container_type_ref_id));
      return { boxes: acc.boxes + n, teu: acc.teu + teu * n };
    },
    { boxes: 0, teu: 0 },
  );

  const complete = (rows || []).every(
    (r) => r.container_type_ref_id && Number(r.qty) > 0,
  );
  // A row may carry at most `qty` container numbers — the server refuses more,
  // and catching it here says which row rather than failing the whole save.
  const overfilled = (rows || []).findIndex(
    (r) => r.units.filter((u) => u.container_no.trim()).length > Number(r.qty),
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.putDossierContainers(
        dossierId,
        (rows || []).map((r, i) => ({
          seq: (i + 1) * 10,
          container_type_ref_id: r.container_type_ref_id,
          load_mode_ref_id: r.load_mode_ref_id || null,
          qty: Number(r.qty),
          units: r.units
            .filter((u) => u.container_no.trim() || u.seal_no.trim())
            .map((u) => ({
              container_no: u.container_no.trim() || null,
              seal_no: u.seal_no.trim() || null,
            })),
        })),
      );
      onSaved?.();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Containers on this file"
      description="What is moving, by type and count. Container numbers can be added later, when the Bill of Lading arrives."
    >
      {!rows ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-4">
          {rows.length === 0 && (
            <p className="micro text-muted-foreground">
              No equipment recorded yet. Add a line for each type on the file.
            </p>
          )}

          {rows.map((r, i) => {
            const t = byId.get(r.container_type_ref_id);
            return (
              <div
                key={i}
                className="space-y-2 rounded-md border border-border p-3"
              >
                <div className="grid gap-3 sm:grid-cols-12">
                  <Field
                    label="Container type"
                    required
                    className="sm:col-span-6"
                  >
                    <Select
                      value={r.container_type_ref_id}
                      onChange={(e) =>
                        set(i, { container_type_ref_id: e.target.value })
                      }
                    >
                      <option value="">—</option>
                      {groupTypes(typeList).map(([family, list]) => (
                        <optgroup key={family} label={family}>
                          {list.map((x) => (
                            <option key={x.ref_id} value={x.ref_id}>
                              {typeLabel(x)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Quantity" required className="sm:col-span-3">
                    <Input
                      inputMode="numeric"
                      value={r.qty}
                      onChange={(e) =>
                        set(i, { qty: e.target.value.replace(/[^\d]/g, "") })
                      }
                    />
                  </Field>
                  <Field label="Load mode" className="sm:col-span-3">
                    <Select
                      value={r.load_mode_ref_id}
                      onChange={(e) =>
                        set(i, { load_mode_ref_id: e.target.value })
                      }
                    >
                      <option value="">—</option>
                      {(modes.data || []).map((m) => (
                        <option key={m.ref_id} value={m.ref_id}>
                          {m.name_en || m.name_fr}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                {mode === "PER_BOX" && (
                  <div className="space-y-2 border-t border-border pt-2">
                    <div className="flex items-center justify-between">
                      <p className="micro text-muted-foreground">
                        Container numbers (
                        {r.units.filter((u) => u.container_no.trim()).length} of{" "}
                        {r.qty || 0})
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          set(i, {
                            units: [
                              ...r.units,
                              { container_no: "", seal_no: "" },
                            ],
                          })
                        }
                      >
                        + Container
                      </Button>
                    </div>
                    {r.units.map((u, ux) => (
                      <div key={ux} className="grid gap-2 sm:grid-cols-12">
                        <Input
                          className="sm:col-span-5"
                          placeholder="MSKU1234567"
                          aria-label={`Container number ${ux + 1}`}
                          value={u.container_no}
                          onChange={(e) =>
                            setUnit(i, ux, {
                              container_no: e.target.value.toUpperCase(),
                            })
                          }
                        />
                        <Input
                          className="sm:col-span-5"
                          placeholder="Seal"
                          aria-label={`Seal number ${ux + 1}`}
                          value={u.seal_no}
                          onChange={(e) =>
                            setUnit(i, ux, { seal_no: e.target.value })
                          }
                        />
                        <Button
                          className="sm:col-span-2"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            set(i, {
                              units: r.units.filter((_, x) => x !== ux),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <p className="micro text-muted-foreground">
                    {t?.extra?.teu
                      ? `${(Number(r.qty) || 0) * Number(t.extra.teu)} TEU`
                      : ""}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRows(rows.filter((_, x) => x !== i))}
                  >
                    Remove line
                  </Button>
                </div>
              </div>
            );
          })}

          <Button
            size="sm"
            variant="outline"
            onClick={() => setRows([...rows, blank()])}
          >
            + Line
          </Button>

          {overfilled >= 0 && (
            <Callout
              tone="warn"
              title="More container numbers than the quantity allows"
            >
              Line {overfilled + 1} lists more numbers than its quantity. Raise
              the quantity or remove a number.
            </Callout>
          )}

          <p className="text-sm text-foreground">
            <span className="num font-medium">{totals.boxes}</span> box
            {totals.boxes === 1 ? "" : "es"} ·{" "}
            <span className="num font-medium">
              {Math.round(totals.teu * 100) / 100}
            </span>{" "}
            TEU
          </p>

          {error && <ErrorState message={error} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={save}
              loading={busy}
              disabled={busy || !complete || overfilled >= 0}
            >
              Save containers
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
