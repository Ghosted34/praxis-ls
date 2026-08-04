/**
 * Driver licences — expiry board (replaces the CRUD table). Licences and certs
 * per driver, flagged valid / due-soon / expired, with a one-click Renew.
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
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { dateFmt, expiryStatus, type ExpiryLevel } from "@/lib/format";
import * as api from "@/lib/fleet-api";

const shell = pageShell.wide;
const EXP_TONE: Record<ExpiryLevel, Tone> = { valid: "ok", soon: "warn", expired: "bad", none: "mute" };
const EXP_LABEL: Record<ExpiryLevel, string> = { valid: "Valid", soon: "Due soon", expired: "Expired", none: "No date" };

function ExpiryPill({ date }: { date?: string | null }) {
  const s = expiryStatus(date);
  return <Pill tone={EXP_TONE[s]}>{EXP_LABEL[s]}</Pill>;
}

function NewLicenceForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: drivers } = useList<{ employee_id: string; full_name?: string }>("/employees");
  const [f, setF] = React.useState({ employee_id: "", license_class: "", license_number: "", issued_on: "", expires_on: "", certification: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.createLicense({
        employee_id: f.employee_id, license_class: f.license_class,
        license_number: f.license_number || undefined, issued_on: f.issued_on || undefined,
        expires_on: f.expires_on || undefined, certification: f.certification || undefined,
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New licence" description="Record a driver licence or certification with its expiry.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Driver" required>
          <Select value={f.employee_id} onChange={(e) => set("employee_id", e.target.value)}>
            <option value="">—</option>
            {(drivers || []).map((d) => <option key={d.employee_id} value={d.employee_id}>{d.full_name || d.employee_id}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Class" required><Input value={f.license_class} onChange={(e) => set("license_class", e.target.value)} placeholder="Poids lourd C/E" /></Field>
          <Field label="Number"><Input value={f.license_number} onChange={(e) => set("license_number", e.target.value)} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Issued on"><Input type="date" value={f.issued_on} onChange={(e) => set("issued_on", e.target.value)} /></Field>
          <Field label="Expires on"><Input type="date" value={f.expires_on} onChange={(e) => set("expires_on", e.target.value)} /></Field>
        </div>
        <Field label="Certification"><Input value={f.certification} onChange={(e) => set("certification", e.target.value)} placeholder="ADR / dangerous goods…" /></Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.employee_id || !f.license_class || busy}>Add licence</Button>
        </div>
      </form>
    </Modal>
  );
}

function RenewModal({ row, onClose, onSaved }: { row: api.DriverLicense; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!date) return; setBusy(true); setError(null);
    try { await api.renewLicense(row.driver_license_id, date); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Renew licence" description={`${row.driver_name || "Driver"} · ${row.license_class || ""}`}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="New expiry date" required hint={row.expires_on ? `Current: ${dateFmt(row.expires_on)}` : undefined}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!date || busy}>Renew</Button>
        </div>
      </form>
    </Modal>
  );
}

export function DriversPage() {
  const rows = useResource(() => api.listLicenses(), []);
  const [creating, setCreating] = React.useState(false);
  const [renewing, setRenewing] = React.useState<api.DriverLicense | null>(null);

  const cols: Column<api.DriverLicense>[] = [
    { key: "drv", label: "Driver", render: (r) => <span className="font-medium text-foreground">{r.driver_name || "—"}</span> },
    { key: "class", label: "Class", render: (r) => <span className="text-muted-foreground">{r.license_class || "—"}</span> },
    { key: "num", label: "Number", render: (r) => <span className="num text-muted-foreground">{r.license_number || "—"}</span> },
    { key: "cert", label: "Certification", render: (r) => <span className="text-muted-foreground">{r.certification || "—"}</span> },
    { key: "exp", label: "Expires", render: (r) => <span className="num text-muted-foreground">{dateFmt(r.expires_on)}</span> },
    { key: "status", label: "Status", render: (r) => <ExpiryPill date={r.expires_on} /> },
    { key: "_a", label: "", render: (r) => <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setRenewing(r)}>Renew</Button></div> },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Fleet" to="/fleet" />} title="Driver licences" description="Licences and certifications per driver — renew before they expire." action={<Button onClick={() => setCreating(true)}>New licence</Button>} />
      <HubTabs />
      <DataList columns={cols} rows={rows.data} error={rows.error} loading={rows.loading} rowKey={(r) => r.driver_license_id} empty={{ title: "No licences", hint: "Record driver licences to track expiry." }} />
      {creating && <NewLicenceForm onClose={() => setCreating(false)} onSaved={rows.reload} />}
      {renewing && <RenewModal row={renewing} onClose={() => setRenewing(null)} onSaved={rows.reload} />}
      <ScreenAi path="fleet/drivers" />
    </section>
  );
}

export default DriversPage;
