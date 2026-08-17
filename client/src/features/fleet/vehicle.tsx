/**
 * Vehicle 360 — master/detail (replaces the CRUD table). Pick a vehicle to see
 * its registry card, drive the status ladder (Active ⇄ Inactive → Disposed) and
 * review its maintenance, dispatch, compliance, fuel and incident history.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageHeader } from "@/components/data-list";
import { TransitionButtons, type Transition } from "@/components/ui/workflow";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt, dateTimeFmt, enumLabel } from "@/lib/format";
import * as api from "@/lib/fleet-api";

const shell = pageShell.wide;
const VSTATUS_TONE: Record<string, Tone> = {
  ACTIVE: "ok",
  INACTIVE: "mute",
  DISPOSED: "bad",
};
const WO_TONE: Record<string, Tone> = {
  OPEN: "blue",
  IN_PROGRESS: "warn",
  DONE: "ok",
  CANCELLED: "bad",
};
const DISP_TONE: Record<string, Tone> = {
  ASSIGNED: "blue",
  OUT: "warn",
  RETURNED: "ok",
  CANCELLED: "bad",
};
const SEV_TONE: Record<string, Tone> = {
  MINOR: "blue",
  MAJOR: "warn",
  TOTAL: "bad",
};
const LADDER: Record<string, string[]> = {
  ACTIVE: ["INACTIVE", "DISPOSED"],
  INACTIVE: ["ACTIVE", "DISPOSED"],
  DISPOSED: [],
};

function expiryTone(d?: string | null): Tone {
  if (!d) return "mute";
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return "mute";
  const now = Date.now();
  if (t < now) return "bad";
  if (t < now + 30 * 864e5) return "warn";
  return "ok";
}

const TABS = [
  "Work orders",
  "Dispatch",
  "Compliance",
  "Fuel",
  "Incidents",
] as const;
type Tab = (typeof TABS)[number];

function MiniTable({
  head,
  children,
  empty,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  empty: boolean;
}) {
  if (empty)
    return <div className="px-3 py-6 text-center micro">{tr("Nothing here yet.")}</div>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>
);

function VehicleDetail({
  vehicle: initial,
  onChanged,
}: {
  vehicle: api.Vehicle;
  onChanged: () => void;
}) {
  const [vehicle, setVehicle] = React.useState(initial);
  React.useEffect(() => setVehicle(initial), [initial]);
  const [tab, setTab] = React.useState<Tab>("Work orders");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const vid = vehicle.vehicle_id;
  // Server-side per-vehicle filters so history is complete (not just the first
  // page of a global list); refetches when the selected vehicle changes.
  const wo = useResource(() => api.listWorkOrders(vid), [vid]);
  const disp = useResource(() => api.listDispatch(vid), [vid]);
  const comp = useResource(() => api.listVehicleCompliance(vid), [vid]);
  const fuel = useResource(() => api.listFuel(vid), [vid]);
  const inc = useResource(() => api.listIncidents(vid), [vid]);

  const forVeh = <T extends { vehicle_id?: string | null }>(rows: T[] | null) =>
    (rows || []).filter((r) => r.vehicle_id === vid);
  const woRows = forVeh(wo.data),
    dispRows = forVeh(disp.data),
    compRows = forVeh(comp.data),
    fuelRows = forVeh(fuel.data),
    incRows = forVeh(inc.data);

  async function toStatus(s: string) {
    setBusy(s);
    setError(null);
    try {
      setVehicle(await api.setVehicleStatus(vid, s));
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const counts: Record<Tab, number> = {
    "Work orders": woRows.length,
    Dispatch: dispRows.length,
    Compliance: compRows.length,
    Fuel: fuelRows.length,
    Incidents: incRows.length,
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="num text-lg font-semibold text-foreground">
                {vehicle.registration || vehicle.vehicle_id.slice(0, 8)}
              </h3>
              <Pill tone={VSTATUS_TONE[vehicle.status || ""] || "mute"}>
                {enumLabel(vehicle.status)}
              </Pill>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {[vehicle.category, vehicle.entity_name]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
          </div>
          <TransitionButtons
            items={(LADDER[vehicle.status || ""] || []).map(
              (s): Transition => ({
                to: s,
                label:
                  s === "ACTIVE"
                    ? "Reactivate"
                    : s === "INACTIVE"
                      ? "Deactivate"
                      : "Dispose",
                variant: s === "DISPOSED" ? "outline" : "default",
                loading: busy === s,
              }),
            )}
            onTransition={toStatus}
          />
        </div>
        {error && (
          <div className="mt-3">
            <ErrorState message={error} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t}
            <span className="ml-1.5 micro">{counts[t]}</span>
          </button>
        ))}
      </div>

      {tab === "Work orders" && (
        <MiniTable
          empty={woRows.length === 0}
          head={
            <>
              <Th>{tr("Kind")}</Th>
              <Th>{tr("Description")}</Th>
              <Th>{tr("Status")}</Th>
              <Th r>{tr("Cost")}</Th>
              <Th>{tr("Opened")}</Th>
            </>
          }
        >
          {woRows.map((r) => (
            <tr key={r.work_order_id}>
              <Td>{enumLabel(r.kind)}</Td>
              <Td>{r.description || "—"}</Td>
              <Td>
                <Pill tone={WO_TONE[r.status] || "mute"}>
                  {enumLabel(r.status)}
                </Pill>
              </Td>
              <Td r>{money(r.cost)}</Td>
              <Td>{dateFmt(r.opened_on)}</Td>
            </tr>
          ))}
        </MiniTable>
      )}
      {tab === "Dispatch" && (
        <MiniTable
          empty={dispRows.length === 0}
          head={
            <>
              <Th>{tr("Driver")}</Th>
              <Th>{tr("Status")}</Th>
              <Th>Out</Th>
              <Th>In</Th>
              <Th r>{tr("Distance")}</Th>
            </>
          }
        >
          {dispRows.map((r) => (
            <tr key={r.fleet_dispatch_id}>
              <Td>{r.driver_name || "—"}</Td>
              <Td>
                <Pill tone={DISP_TONE[r.status] || "mute"}>{r.status}</Pill>
              </Td>
              <Td>{r.check_out_at ? dateFmt(r.check_out_at) : "—"}</Td>
              <Td>{r.check_in_at ? dateFmt(r.check_in_at) : "—"}</Td>
              <Td r>
                {r.odometer_out != null && r.odometer_in != null
                  ? `${num(r.odometer_in - r.odometer_out)} km`
                  : "—"}
              </Td>
            </tr>
          ))}
        </MiniTable>
      )}
      {tab === "Compliance" && (
        <MiniTable
          empty={compRows.length === 0}
          head={
            <>
              <Th>{tr("Kind")}</Th>
              <Th>{tr("Expires")}</Th>
              <Th r>{tr("Status")}</Th>
            </>
          }
        >
          {compRows.map((r) => (
            <tr key={r.compliance_id}>
              <Td>{enumLabel(r.kind)}</Td>
              <Td>{dateFmt(r.expires_on)}</Td>
              <td className="px-3 py-1.5 text-right">
                <Pill tone={expiryTone(r.expires_on)}>
                  {expiryTone(r.expires_on) === "bad"
                    ? "Expired"
                    : expiryTone(r.expires_on) === "warn"
                      ? "Due soon"
                      : "Valid"}
                </Pill>
              </td>
            </tr>
          ))}
        </MiniTable>
      )}
      {tab === "Fuel" && (
        <MiniTable
          empty={fuelRows.length === 0}
          head={
            <>
              <Th>{tr("When")}</Th>
              <Th r>{tr("Odometer")}</Th>
              <Th r>{tr("Litres")}</Th>
              <Th r>{tr("Cost")}</Th>
            </>
          }
        >
          {fuelRows.map((r) => (
            <tr key={r.fuel_log_id}>
              <Td>{dateFmt(r.created_at)}</Td>
              <Td r>{num(r.odometer)}</Td>
              <Td r>{num(r.litres)}</Td>
              <Td r>{money(r.cost)}</Td>
            </tr>
          ))}
        </MiniTable>
      )}
      {tab === "Incidents" && (
        <MiniTable
          empty={incRows.length === 0}
          head={
            <>
              <Th>{tr("When")}</Th>
              <Th>{tr("Severity")}</Th>
              <Th>{tr("Status")}</Th>
              <Th>{tr("Description")}</Th>
            </>
          }
        >
          {incRows.map((r) => (
            <tr key={r.fleet_incident_id}>
              <Td>{r.occurred_at ? dateTimeFmt(r.occurred_at) : "—"}</Td>
              <Td>
                <Pill tone={SEV_TONE[r.severity || ""] || "mute"}>
                  {enumLabel(r.severity)}
                </Pill>
              </Td>
              <Td>{enumLabel(r.status)}</Td>
              <Td>{r.description || "—"}</Td>
            </tr>
          ))}
        </MiniTable>
      )}
    </div>
  );
}

function NewVehicleForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (v: api.Vehicle) => void;
}) {
  const [f, setF] = React.useState({ registration: "", category: "truck" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const v = await api.createVehicle({
        registration: f.registration,
        category: f.category,
      });
      onSaved(v);
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
      title="New vehicle"
      description="Add a vehicle to the fleet registry."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Registration")} required>
          <Input
            value={f.registration}
            onChange={(e) => set("registration", e.target.value)}
            placeholder="LT-4471"
          />
        </Field>
        <Field label={tr("Category")} required>
          <Select
            value={f.category}
            onChange={(e) => set("category", e.target.value)}
          >
            <option value="truck">{tr("Truck")}</option>
            <option value="low-bed">Low-bed</option>
            <option value="company_car">Company car</option>
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
          <Button
            type="submit"
            loading={busy}
            disabled={!f.registration || busy}
          >
            Add vehicle
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function VehiclesPage() {
  const vehicles = useResource(() => api.listVehicles(), []);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const rows = React.useMemo(() => vehicles.data || [], [vehicles.data]);
  const filtered = q
    ? rows.filter((v) =>
        (v.registration || "").toLowerCase().includes(q.toLowerCase()),
      )
    : rows;
  const selected = rows.find((v) => v.vehicle_id === selId) || null;
  React.useEffect(() => {
    if (!selId && rows.length) setSelId(rows[0].vehicle_id);
  }, [rows, selId]);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Fleet" to="/fleet" />}
        title={tr("Vehicles")}
        description="The fleet registry — pick a vehicle for its full maintenance, dispatch and compliance history."
        action={<Button onClick={() => setCreating(true)}>New vehicle</Button>}
      />
      <HubTabs />
      {creating && (
        <NewVehicleForm
          onClose={() => setCreating(false)}
          onSaved={(v) => {
            vehicles.reload();
            setSelId(v.vehicle_id);
          }}
        />
      )}
      {vehicles.error ? (
        <ErrorState message={vehicles.error} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            <Input
              placeholder="Search registration…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {vehicles.loading ? (
                <div className="px-3 py-4 micro">{tr("Loading…")}</div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-4 micro">No vehicles.</div>
              ) : (
                filtered.map((v) => (
                  <button
                    key={v.vehicle_id}
                    onClick={() => setSelId(v.vehicle_id)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${v.vehicle_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                  >
                    <span className="num font-medium">
                      {v.registration || v.vehicle_id.slice(0, 8)}
                    </span>
                    <Pill tone={VSTATUS_TONE[v.status || ""] || "mute"}>
                      {enumLabel(v.status)}
                    </Pill>
                  </button>
                ))
              )}
            </div>
          </div>
          {selected ? (
            <VehicleDetail vehicle={selected} onChanged={vehicles.reload} />
          ) : (
            <EmptyState
              title="No vehicle selected"
              hint="Choose a vehicle from the list."
            />
          )}
        </div>
      )}
      <ScreenAi path="fleet/vehicles" />
    </section>
  );
}

export default VehiclesPage;
