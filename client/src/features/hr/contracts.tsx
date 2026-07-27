/**
 * Contracts — lifecycle workstation (replaces the CRUD table). Issue a contract
 * to an employee and move it DRAFT → ISSUED → SIGNED → ENDED. A signed/ended
 * contract is terminal for forward flow.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { TransitionButtons } from "@/components/ui/workflow";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb } from "@/components/tabbed-hub";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { dateFmt, enumLabel } from "@/lib/format";
import * as api from "@/lib/hr-api";

const shell = "mx-auto max-w-6xl animate-fade-in";
const STATUS_TONE: Record<string, Tone> = { DRAFT: "mute", ISSUED: "blue", SIGNED: "ok", ENDED: "mute" };
const TRANSITIONS: Record<string, string[]> = { DRAFT: ["ISSUED"], ISSUED: ["SIGNED", "ENDED"], SIGNED: ["ENDED"], ENDED: [] };
const STATUS_LABEL: Record<string, string> = { ISSUED: "Issue", SIGNED: "Mark signed", ENDED: "End" };
const KIND_LABEL: Record<string, string> = { OFFER_LETTER: "Offer letter", EMPLOYMENT: "Employment", CONFIRMATION: "Confirmation", TERMINATION: "Termination" };

function NewContractForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: employees } = useList<{ employee_id: string; full_name?: string }>("/employees");
  const [f, setF] = React.useState({ employee_id: "", kind: "EMPLOYMENT", effective_on: "", end_on: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.createContract({ employee_id: f.employee_id || undefined, kind: f.kind, effective_on: f.effective_on || undefined, end_on: f.end_on || undefined });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New contract" description="Draft a contract for an employee. It starts in draft.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Employee" required>
          <Select value={f.employee_id} onChange={(e) => set("employee_id", e.target.value)}>
            <option value="">—</option>
            {(employees || []).map((d) => <option key={d.employee_id} value={d.employee_id}>{d.full_name || d.employee_id}</option>)}
          </Select>
        </Field>
        <Field label="Kind" required>
          <Select value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="OFFER_LETTER">Offer letter</option>
            <option value="EMPLOYMENT">Employment</option>
            <option value="CONFIRMATION">Confirmation</option>
            <option value="TERMINATION">Termination</option>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Effective on"><Input type="date" value={f.effective_on} onChange={(e) => set("effective_on", e.target.value)} /></Field>
          <Field label="Ends on"><Input type="date" value={f.end_on} onChange={(e) => set("end_on", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.employee_id || busy}>Create draft</Button>
        </div>
      </form>
    </Modal>
  );
}

export function ContractsPage() {
  const rows = useResource(() => api.listContracts(), []);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function toStatus(c: api.Contract, status: string) {
    setBusy(c.hr_contract_id + status); setError(null);
    try { await api.setContractStatus(c.hr_contract_id, status); rows.reload(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }

  const cols: Column<api.Contract>[] = [
    { key: "emp", label: "Employee", render: (c) => <span className="font-medium text-foreground">{c.employee_name || "—"}</span> },
    { key: "kind", label: "Kind", render: (c) => <span className="text-muted-foreground">{KIND_LABEL[c.kind || ""] || enumLabel(c.kind)}</span> },
    { key: "eff", label: "Effective", render: (c) => <span className="num text-muted-foreground">{dateFmt(c.effective_on)}</span> },
    { key: "end", label: "Ends", render: (c) => <span className="num text-muted-foreground">{dateFmt(c.end_on)}</span> },
    { key: "status", label: "Status", render: (c) => <Pill tone={STATUS_TONE[c.status] || "mute"}>{enumLabel(c.status)}</Pill> },
    {
      key: "_a", label: "",
      render: (c) => (
        <TransitionButtons
          items={(TRANSITIONS[c.status] || []).map((s) => ({ to: s, label: STATUS_LABEL[s] || s, variant: s === "ENDED" ? "outline" : "default", loading: busy === c.hr_contract_id + s }))}
          onTransition={(s) => toStatus(c, s)}
        />
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Human capital" />} title="Contracts" description="Issue and progress employee contracts through their lifecycle." action={<Button onClick={() => setCreating(true)}>New contract</Button>} />
      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      <DataList columns={cols} rows={rows.data} error={rows.error} loading={rows.loading} rowKey={(c) => c.hr_contract_id} empty={{ title: "No contracts", hint: "Draft a contract to get started." }} />
      {creating && <NewContractForm onClose={() => setCreating(false)} onSaved={rows.reload} />}
      <ScreenAi path="hr/contracts" />
    </section>
  );
}

export default ContractsPage;
