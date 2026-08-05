/**
 * Master data — clients, and their credit limit.
 *
 * Split out of `features/master/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell } from "@/lib/format";
import { ActivePill } from "@/components/ui/pill";
import { Stat } from "@/components/ui/stat";
import { money } from "@/lib/format";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { EntitySelect } from "./shared";

const CLIENT_AI: AiAction[] = [
  { label: "Find duplicate clients", kind: "assist", describe: "Scan the client master for likely duplicates by name / NIU and suggest merges." },
  { label: "Check credit status", kind: "read", describe: "Summarise a client's credit limit, receivables and available headroom." },
  { label: "Draft KYC follow-up", kind: "write", describe: "Draft a message requesting missing KYC documents (human-confirmed before send)." },
];

function ClientForm({ open, editing, entities, onClose, onSaved }: { open: boolean; editing: Row | null; entities: Row[] | null; onClose: () => void; onSaved: () => void }) {
  const [entityId, setEntityId] = React.useState("");
  const [name, setName] = React.useState("");
  const [niu, setNiu] = React.useState("");
  const [rccm, setRccm] = React.useState("");
  const [terms, setTerms] = React.useState("");
  const [creditLimit, setCreditLimit] = React.useState("");
  const [withholding, setWithholding] = React.useState(false);
  const [active, setActive] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId(editing?.entity_id ? String(editing.entity_id) : "");
    setName(editing?.name ? String(editing.name) : "");
    setNiu(editing?.niu ? String(editing.niu) : "");
    setRccm(editing?.rccm ? String(editing.rccm) : "");
    setTerms(editing?.payment_terms_days != null ? String(editing.payment_terms_days) : "");
    setCreditLimit(editing?.credit_limit != null ? String(editing.credit_limit) : "");
    setWithholding(editing?.is_withholding_agent === true);
    setActive(editing?.is_active !== false);
    setError(null);
  }, [open, editing]);

  const canSubmit = !!name.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: name.trim(),
      entity_id: entityId || undefined,
      niu: niu.trim() || undefined,
      rccm: rccm.trim() || undefined,
      payment_terms_days: terms === "" ? undefined : Number(terms),
      credit_limit: creditLimit === "" ? undefined : Number(creditLimit),
      is_withholding_agent: withholding,
    };
    if (editing) body.is_active = active;
    try {
      if (editing) await tenant(`/clients/${String(editing.client_id)}`, { method: "PATCH", body });
      else await tenant("/clients", { method: "POST", body });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit client" : "New client"} description="Customer registry entry — referenced across sales, operations and receivables." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Logistics SARL" />
          </Field>
          <Field label="Corporate entity" hint="Which of your legal entities owns this relationship" className="sm:col-span-2">
            <EntitySelect entities={entities} value={entityId} onChange={setEntityId} />
          </Field>
          <Field label="NIU" hint="Taxpayer number">
            <Input value={niu} onChange={(e) => setNiu(e.target.value)} placeholder="P0123456789A" />
          </Field>
          <Field label="RCCM" hint="Trade register">
            <Input value={rccm} onChange={(e) => setRccm(e.target.value)} placeholder="RC/DLA/2020/B/1234" />
          </Field>
          <Field label="Payment terms (days)">
            <Input type="number" min="0" step="1" className="num text-right" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="30" />
          </Field>
          <Field label="Credit limit (XAF)" hint="Blank = no limit">
            <Input type="number" min="0" step="1" className="num text-right" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="5000000" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withholding} onChange={(e) => setWithholding(e.target.checked)} />
          Withholding agent (retains tax on our invoices)
        </label>
        {editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {editing ? "Save changes" : "Create client"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CreditModal({ client, onClose }: { client: Row | null; onClose: () => void }) {
  const open = !!client;
  const [data, setData] = React.useState<Row | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!client) return;
    let live = true;
    setData(null);
    setError(null);
    tenant<Row>(`/clients/${String(client.client_id)}/credit`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [client]);

  const limit = (v: unknown) => (v === null || v === undefined ? "no limit" : money(v));

  return (
    <Modal open={open} onClose={onClose} title={`Credit status — ${client ? cell(client.name) : ""}`} description="Live credit availability from the client master.">
      <div className="space-y-4">
        {error ? (
          <ErrorState message={error} />
        ) : data === null ? (
          <LoadingRow label="Checking credit…" />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="KYC complete" value={data.kyc_complete ? "Yes" : "No"} tone={data.kyc_complete === true ? "ok" : "bad"} />
            <Stat label="Within limit" value={data.within ? "Yes" : "Over"} tone={data.within === true ? "ok" : "bad"} />
            <Stat label="Credit limit" value={limit(data.limit)} />
            <Stat label="Receivables used" value={money(data.used)} />
            <Stat label="Available" value={limit(data.available)} />
          </div>
        )}
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}


export function ClientsPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/clients");
  const { rows: entities } = useList("/entities");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [creditFor, setCreditFor] = React.useState<Row | null>(null);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setFormOpen(true);
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Master data" to="/master" />} title="Clients" description="Customer registry referenced across sales, operations and receivables." action={<Button onClick={openNew}>New client</Button>} />

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState title="No clients yet" hint="Create the first client to reference it in quotations, dossiers and invoices." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>NIU</TH>
              <TH>RCCM</TH>
              <TH>Terms</TH>
              <TH>Credit limit</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={String(r.client_id)}>
                <TD className="text-sm font-medium">{cell(r.name)}</TD>
                <TD className="text-sm">{cell(r.niu)}</TD>
                <TD className="text-sm">{cell(r.rccm)}</TD>
                <TD className="num text-sm">{r.payment_terms_days != null ? `${cell(r.payment_terms_days)} d` : "—"}</TD>
                <TD className="num text-sm">{r.credit_limit != null ? Number(r.credit_limit).toLocaleString() : "—"}</TD>
                <TD className="text-sm">
                  <ActivePill active={r.is_active !== false} />
                </TD>
                <TD>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setCreditFor(r)}>
                      Credit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                      Edit
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <AiActions actions={CLIENT_AI} />

      <ClientForm open={formOpen} editing={editing} entities={entities} onClose={() => setFormOpen(false)} onSaved={reload} />
      <CreditModal client={creditFor} onClose={() => setCreditFor(null)} />
    </section>
  );
}

/* ─────────────────────────────── Suppliers ─────────────────────────────── */
