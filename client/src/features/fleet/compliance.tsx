/**
 * Vehicle compliance — expiry board (replaces the CRUD table). Insurance and
 * visite-technique records sorted by expiry, each flagged valid / due-soon /
 * expired, with a one-click Renew (push the expiry forward).
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import {
  dateFmt,
  enumLabel,
  expiryStatus,
  type ExpiryLevel,
} from "@/lib/format";
import * as api from "@/lib/fleet-api";

const shell = pageShell.wide;
const EXP_TONE: Record<ExpiryLevel, Tone> = {
  valid: "ok",
  soon: "warn",
  expired: "bad",
  none: "mute",
};
const EXP_LABEL: Record<ExpiryLevel, string> = {
  valid: "Valid",
  soon: "Due soon",
  expired: "Expired",
  none: "No date",
};
const KIND_LABEL: Record<string, string> = {
  insurance: "Insurance",
  visite_technique: "Visite technique",
};

function ExpiryPill({ date }: { date?: string | null }) {
  const s = expiryStatus(date);
  return <Pill tone={EXP_TONE[s]}>{EXP_LABEL[s]}</Pill>;
}

function NewComplianceForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const vehicles = useResource(() => api.listVehicles(), []);
  const [f, setF] = React.useState({
    vehicle_id: "",
    kind: "insurance",
    expires_on: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createCompliance({
        vehicle_id: f.vehicle_id,
        kind: f.kind,
        expires_on: f.expires_on || undefined,
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
      title="New compliance record"
      description="Track an insurance or visite-technique expiry."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Vehicle" required>
          <Select
            value={f.vehicle_id}
            onChange={(e) => set("vehicle_id", e.target.value)}
          >
            <option value="">—</option>
            {(vehicles.data || []).map((v) => (
              <option key={v.vehicle_id} value={v.vehicle_id}>
                {v.registration || v.vehicle_id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind" required>
            <Select
              value={f.kind}
              onChange={(e) => set("kind", e.target.value)}
            >
              <option value="insurance">Insurance</option>
              <option value="visite_technique">Visite technique</option>
            </Select>
          </Field>
          <Field label="Expires on">
            <Input
              type="date"
              value={f.expires_on}
              onChange={(e) => set("expires_on", e.target.value)}
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
          <Button type="submit" loading={busy} disabled={!f.vehicle_id || busy}>
            Add record
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RenewModal({
  row,
  onClose,
  onSaved,
}: {
  row: api.VehicleCompliance;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return;
    setBusy(true);
    setError(null);
    try {
      await api.renewCompliance(row.compliance_id, date);
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
      title="Renew"
      description={`${row.registration || "Vehicle"} · ${KIND_LABEL[row.kind || ""] || row.kind}`}
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field
          label="New expiry date"
          required
          hint={
            row.expires_on ? `Current: ${dateFmt(row.expires_on)}` : undefined
          }
        >
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
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
          <Button type="submit" loading={busy} disabled={!date || busy}>
            Renew
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function VehicleCompliancePage() {
  const rows = useResource(() => api.listVehicleCompliance(), []);
  const [creating, setCreating] = React.useState(false);
  const [renewing, setRenewing] = React.useState<api.VehicleCompliance | null>(
    null,
  );

  const cols: Column<api.VehicleCompliance>[] = [
    {
      key: "veh",
      label: "Vehicle",
      render: (r) => (
        <span className="num font-medium text-foreground">
          {r.registration || "—"}
        </span>
      ),
    },
    {
      key: "kind",
      label: "Kind",
      render: (r) => (
        <span className="text-muted-foreground">
          {KIND_LABEL[r.kind || ""] || enumLabel(r.kind)}
        </span>
      ),
    },
    {
      key: "exp",
      label: "Expires",
      render: (r) => (
        <span className="num text-muted-foreground">
          {dateFmt(r.expires_on)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <ExpiryPill date={r.expires_on} />,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setRenewing(r)}>
            Renew
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Fleet" to="/fleet" />}
        title="Vehicle compliance"
        description="Insurance and visite-technique expiry — renew before they lapse."
        action={<Button onClick={() => setCreating(true)}>New record</Button>}
      />
      <HubTabs />
      <DataList
        columns={cols}
        rows={rows.data}
        error={rows.error}
        loading={rows.loading}
        rowKey={(r) => r.compliance_id}
        empty={{
          title: "No compliance records",
          hint: "Add insurance or visite-technique expiries to track.",
        }}
      />
      {creating && (
        <NewComplianceForm
          onClose={() => setCreating(false)}
          onSaved={rows.reload}
        />
      )}
      {renewing && (
        <RenewModal
          row={renewing}
          onClose={() => setRenewing(null)}
          onSaved={rows.reload}
        />
      )}
      <ScreenAi path="fleet/compliance" />
    </section>
  );
}

export default VehicleCompliancePage;
