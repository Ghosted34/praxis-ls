/**
 * Locations — zone/bin tree (replaces the flat CRUD table). Slots grouped by
 * zone (yard slots last), each showing its aisle · rack · bin and capacity, with
 * a New location form.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { num } from "@/lib/format";
import * as api from "@/lib/wms-api";

const shell = pageShell.wide;

function NewLocationForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    zone: "",
    aisle: "",
    rack: "",
    bin: "",
    yard: "",
    capacity_units: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createLocation({
        zone: f.zone || undefined,
        aisle: f.aisle || undefined,
        rack: f.rack || undefined,
        bin: f.bin || undefined,
        yard: f.yard || undefined,
        capacity_units:
          f.capacity_units === "" ? undefined : Number(f.capacity_units),
      });
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
      title={tr("New location")}
      description="Add a slotting location — a zone/aisle/rack/bin, or a yard slot."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Zone")}>
            <Input
              value={f.zone}
              onChange={(e) => set("zone", e.target.value)}
              placeholder="A"
            />
          </Field>
          <Field label={tr("Aisle")}>
            <Input
              value={f.aisle}
              onChange={(e) => set("aisle", e.target.value)}
              placeholder="01"
            />
          </Field>
          <Field label={tr("Rack")}>
            <Input
              value={f.rack}
              onChange={(e) => set("rack", e.target.value)}
              placeholder="R1"
            />
          </Field>
          <Field label={tr("Bin")}>
            <Input
              value={f.bin}
              onChange={(e) => set("bin", e.target.value)}
              placeholder="B1"
            />
          </Field>
          <Field label={tr("Yard")} hint="For open-yard slots">
            <Input
              value={f.yard}
              onChange={(e) => set("yard", e.target.value)}
              placeholder="Y1"
            />
          </Field>
          <Field label="Capacity (units)">
            <Input
              type="number"
              className="num text-right"
              value={f.capacity_units}
              onChange={(e) => set("capacity_units", e.target.value)}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Add location
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function LocationsPage() {
  const locs = useResource(() => api.listLocations(), []);
  const [creating, setCreating] = React.useState(false);

  const groups = React.useMemo(() => {
    const m: Record<string, api.WarehouseLocation[]> = {};
    (locs.data || []).forEach((l) => {
      const key = l.zone || (l.yard ? "Yard" : "Unzoned");
      (m[key] || (m[key] = [])).push(l);
    });
    return Object.entries(m).sort(([a], [b]) =>
      a === "Yard" ? 1 : b === "Yard" ? -1 : a.localeCompare(b),
    );
  }, [locs.data]);

  const slot = (l: api.WarehouseLocation) =>
    [l.aisle, l.rack, l.bin].filter(Boolean).join(" · ") ||
    l.yard ||
    api.locationLabel(l);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Warehouse" to="/wms" />}
        title="Locations"
        description="Warehouse slotting by zone, aisle, rack and bin."
        action={<Button onClick={() => setCreating(true)}>{tr("New location")}</Button>}
      />
      <HubTabs />
      {locs.error ? (
        <ErrorState message={locs.error} />
      ) : locs.loading ? (
        <div className="px-3 py-6 text-center micro">{tr("Loading…")}</div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No locations yet.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([zone, items]) => (
            <div key={zone} className="overflow-hidden rounded-xl border">
              <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
                <span className="text-sm font-semibold text-foreground">
                  Zone {zone}
                </span>
                <span className="micro">
                  {items.length} slot{items.length === 1 ? "" : "s"}
                </span>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {items.map((l) => (
                    <tr key={l.location_id}>
                      <td className="px-4 py-2 num font-medium text-foreground">
                        {slot(l)}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {l.capacity_units != null
                          ? `${num(l.capacity_units)} units`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      {creating && (
        <NewLocationForm
          onClose={() => setCreating(false)}
          onSaved={locs.reload}
        />
      )}
    </section>
  );
}

export default LocationsPage;
