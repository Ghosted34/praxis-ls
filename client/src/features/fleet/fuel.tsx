/**
 * Fuel log — capture + efficiency (replaces the CRUD table). Log fills against a
 * vehicle (odometer is guarded from going backwards server-side); pick a vehicle
 * to see its consumption stats (litres, cost, distance, L/100km).
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Stat } from "@/components/ui/stat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt } from "@/lib/format";
import * as api from "@/lib/fleet-api";

const shell = pageShell.wide;
type Dossier = { dossier_id: string; ref?: string | null };

function LogFillForm({
  vehicles,
  presetVehicle,
  onClose,
  onSaved,
}: {
  vehicles: api.Vehicle[];
  presetVehicle: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [f, setF] = React.useState({
    vehicle_id: presetVehicle,
    odometer: "",
    litres: "",
    cost: "",
    dossier_id: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createFuel({
        vehicle_id: f.vehicle_id,
        odometer: f.odometer === "" ? undefined : Number(f.odometer),
        litres: f.litres === "" ? undefined : Number(f.litres),
        cost: f.cost === "" ? undefined : Number(f.cost),
        dossier_id: f.dossier_id || undefined,
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
      title="Log fuel fill"
      description="Record a fill. The odometer can't go below the last recorded reading."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Vehicle")} required>
          <Select
            value={f.vehicle_id}
            onChange={(e) => set("vehicle_id", e.target.value)}
          >
            <option value="">—</option>
            {vehicles.map((v) => (
              <option key={v.vehicle_id} value={v.vehicle_id}>
                {v.registration || v.vehicle_id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Odometer (km)">
            <Input
              type="number"
              className="num text-right"
              value={f.odometer}
              onChange={(e) => set("odometer", e.target.value)}
            />
          </Field>
          <Field label={tr("Litres")}>
            <Input
              type="number"
              step="any"
              className="num text-right"
              value={f.litres}
              onChange={(e) => set("litres", e.target.value)}
            />
          </Field>
          <Field label={tr("Cost")}>
            <Input
              type="number"
              step="any"
              className="num text-right"
              value={f.cost}
              onChange={(e) => set("cost", e.target.value)}
            />
          </Field>
        </div>
        <Field
          label={tr("Dossier")}
          hint="Optional — attribute the fuel cost to an operation"
        >
          <Select
            value={f.dossier_id}
            onChange={(e) => set("dossier_id", e.target.value)}
          >
            <option value="">—</option>
            {(dossiers || []).map((d) => (
              <option key={d.dossier_id} value={d.dossier_id}>
                {d.ref || d.dossier_id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </Field>
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
          <Button type="submit" loading={busy} disabled={!f.vehicle_id || busy}>
            Log fill
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function FuelLogPage() {
  const vehicles = useResource(() => api.listVehicles(), []);
  const [veh, setVeh] = React.useState("");
  const fills = useResource(() => api.listFuel(veh || undefined), [veh]);
  const [logging, setLogging] = React.useState(false);
  const vehMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    (vehicles.data || []).forEach((v) => {
      m[v.vehicle_id] = v.registration || v.vehicle_id.slice(0, 8);
    });
    return m;
  }, [vehicles.data]);

  // Per-vehicle efficiency, computed from that vehicle's fills.
  const eff = React.useMemo(() => {
    if (!veh) return null;
    const rows = fills.data || [];
    const litres = rows.reduce((s, r) => s + Number(r.litres || 0), 0);
    const cost = rows.reduce((s, r) => s + Number(r.cost || 0), 0);
    const odos = rows
      .map((r) => Number(r.odometer))
      .filter((n) => Number.isFinite(n));
    const distance =
      odos.length >= 2 ? Math.max(...odos) - Math.min(...odos) : 0;
    const l100 = distance > 0 ? (litres / distance) * 100 : null;
    return { fills: rows.length, litres, cost, distance, l100 };
  }, [veh, fills.data]);

  const cols: Column<api.FuelLog>[] = [
    {
      key: "when",
      label: "Date",
      render: (r) => (
        <span className="num text-muted-foreground">
          {dateFmt(r.created_at)}
        </span>
      ),
    },
    ...(!veh
      ? [
          {
            key: "veh",
            label: "Vehicle",
            render: (r: api.FuelLog) => (
              <span className="num font-medium text-foreground">
                {vehMap[r.vehicle_id || ""] || "—"}
              </span>
            ),
          } as Column<api.FuelLog>,
        ]
      : []),
    {
      key: "odo",
      label: "Odometer",
      className: "text-right",
      render: (r) => <span className="num">{num(r.odometer)}</span>,
    },
    {
      key: "litres",
      label: "Litres",
      className: "text-right",
      render: (r) => <span className="num">{num(r.litres)}</span>,
    },
    {
      key: "cost",
      label: "Cost",
      className: "text-right",
      render: (r) => <span className="num">{money(r.cost)}</span>,
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Fleet" to="/fleet" />}
        title="Fuel log"
        description="Log fills and track consumption per vehicle."
        action={<Button onClick={() => setLogging(true)}>Log fill</Button>}
      />
      <HubTabs />

      <div className="mb-4 max-w-xs">
        <Select
          aria-label="Filter by vehicle"
          value={veh}
          onChange={(e) => setVeh(e.target.value)}
        >
          <option value="">All vehicles</option>
          {(vehicles.data || []).map((v) => (
            <option key={v.vehicle_id} value={v.vehicle_id}>
              {v.registration || v.vehicle_id.slice(0, 8)}
            </option>
          ))}
        </Select>
      </div>

      {eff && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Fills" value={num(eff.fills)} />
          <Stat label={tr("Litres")} value={num(Math.round(eff.litres))} />
          <Stat label="Fuel cost" value={money(eff.cost)} />
          <Stat
            label={tr("Distance")}
            value={eff.distance ? `${num(eff.distance)} km` : "—"}
          />
          <Stat
            label="L / 100km"
            value={eff.l100 != null ? eff.l100.toFixed(1) : "—"}
          />
        </div>
      )}

      <DataList
        columns={cols}
        rows={fills.data}
        error={fills.error}
        loading={fills.loading}
        rowKey={(r) => r.fuel_log_id}
        empty={{
          title: "No fills",
          hint: "Log a fuel fill to start tracking consumption.",
        }}
      />
      {logging && (
        <LogFillForm
          vehicles={vehicles.data || []}
          presetVehicle={veh}
          onClose={() => setLogging(false)}
          onSaved={fills.reload}
        />
      )}
      <ScreenAi path="fleet/fuel" />
    </section>
  );
}

export default FuelLogPage;
