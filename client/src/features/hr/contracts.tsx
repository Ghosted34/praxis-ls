/**
 * Contracts — lifecycle workstation (replaces the CRUD table). Issue a contract
 * to an employee and move it DRAFT → ISSUED → SIGNED → ENDED. A signed/ended
 * contract is terminal for forward flow.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { TransitionButtons } from "@/components/ui/workflow";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
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
  const [f, setF] = React.useState({ employee_id: "", kind: "EMPLOYMENT", effective_on: "", end_on: "", email: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setNote(null);
    try {
      const created = await api.createContract({ employee_id: f.employee_id || undefined, kind: f.kind, effective_on: f.effective_on || undefined, end_on: f.end_on || undefined });
      // Draft the contract from the template and email it to the employee.
      if (f.email.trim() && created.hr_contract_id) {
        try { await api.sendContract(created.hr_contract_id, f.email.trim()); }
        catch (sendErr) { setNote(`Contract created, but the email failed: ${errMsg(sendErr)}`); }
      }
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
        <Field label="Email contract to (optional)">
          <Input type="email" placeholder="employee@company.cm" value={f.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        {note && <div className="rounded-lg border border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn)/0.08)] px-3 py-2 text-sm">{note}</div>}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.employee_id || busy}>{f.email.trim() ? "Create & send" : "Create draft"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

/** Upload an already-signed contract PDF and tie it to the contract row. */
export function UploadSigned({ contract, onDone }: { contract: api.Contract; onDone: () => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try { await api.uploadContractSigned(contract.hr_contract_id, await readAsDataUrl(file)); onDone(); }
    catch (err) { window.alert(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <>
      <input ref={ref} type="file" accept="application/pdf" className="hidden" onChange={pick} />
      <Button size="sm" variant="ghost" loading={busy} onClick={() => ref.current?.click()}>
        {contract.pdf_vault_id ? "Replace signed" : "Upload signed"}
      </Button>
    </>
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
        <div className="flex items-center justify-end gap-2">
          {c.pdf_vault_id && <Pill tone="ok">Signed on file</Pill>}
          <DocButton docType="EMPLOYMENT_CONTRACT" id={c.hr_contract_id} title={c.employee_name || `Contract ${c.hr_contract_id.slice(0, 8)}`} label="View" />
          <UploadSigned contract={c} onDone={rows.reload} />
          <TransitionButtons
            items={(TRANSITIONS[c.status] || []).map((s) => ({ to: s, label: STATUS_LABEL[s] || s, variant: s === "ENDED" ? "outline" : "default", loading: busy === c.hr_contract_id + s }))}
            onTransition={(s) => toStatus(c, s)}
          />
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Human capital" to="/hr" />} title="Contracts" description="Issue and progress employee contracts through their lifecycle." action={<Button onClick={() => setCreating(true)}>New contract</Button>} />
      <HubTabs />      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      <DataList columns={cols} rows={rows.data} error={rows.error} loading={rows.loading} rowKey={(c) => c.hr_contract_id} empty={{ title: "No contracts", hint: "Draft a contract to get started." }} />
      {creating && <NewContractForm onClose={() => setCreating(false)} onSaved={rows.reload} />}
      <ScreenAi path="hr/contracts" />
    </section>
  );
}

export default ContractsPage;
