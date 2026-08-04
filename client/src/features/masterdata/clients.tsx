/**
 * Master data — clients.
 *
 * Split out of `features/masterdata/pages.tsx` (682 lines) in Phase 4, audit F7.
 */

import * as React from "react";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { CountrySelect } from "@/components/country-select";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, ActivePill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { money, num } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import { shell } from "./shared";


/* ══════════════════════════════ Clients ═════════════════════════ */

export function ClientForm({ row, onClose, onSaved }: { row: api.Client | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const { rows: entities } = useList<api.Entity>("/entities");
  const [name, setName] = React.useState(row?.name ?? "");
  const [entityId, setEntityId] = React.useState(row?.entity_id ?? "");
  const [niu, setNiu] = React.useState(row?.niu ?? "");
  const [rccm, setRccm] = React.useState(row?.rccm ?? "");
  const [email, setEmail] = React.useState(row?.email ?? "");
  // 0480 — the bill-to address. There was no column and no field until then, so
  // an invoice could only identify the client by name and NIU, which is short of
  // what an OHADA-compliant invoice needs.
  const [address, setAddress] = React.useState(row?.address ?? "");
  const [city, setCity] = React.useState(row?.city ?? "");
  const [countryCode, setCountryCode] = React.useState(row?.country_code ?? "CM");
  const [terms, setTerms] = React.useState(row?.payment_terms_days != null ? String(row.payment_terms_days) : "");
  const [credit, setCredit] = React.useState(row?.credit_limit != null ? String(row.credit_limit) : "");
  const [wht, setWht] = React.useState(row?.is_withholding_agent ?? false);
  const [active, setActive] = React.useState(row?.is_active ?? true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: api.ClientInput = {
      name,
      entity_id: entityId || undefined,
      niu: niu || undefined,
      rccm: rccm || undefined,
      email: email || undefined,
      address: address || undefined,
      city: city || undefined,
      country_code: countryCode || undefined,
      payment_terms_days: terms === "" ? undefined : Number(terms),
      credit_limit: credit === "" ? undefined : Number(credit),
      is_withholding_agent: wht,
    };
    try {
      if (isNew) await api.createClient(body);
      else await api.updateClient(row!.client_id, { ...body, is_active: active });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "New client" : "Edit client"} description="Customer master record — terms, credit and withholding status.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Client legal / trade name" />
          </Field>
          <Field label="Corporate entity" hint="Which of our entities bills this client">
            <Select value={entityId ?? ""} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">—</option>
              {(entities || []).map((en) => (
                <option key={en.entity_id} value={en.entity_id}>{en.legal_name || en.code}</option>
              ))}
            </Select>
          </Field>
          <Field label="Payment terms (days)">
            <Input type="number" min="0" className="num text-right" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="30" />
          </Field>
          <Field label="NIU"><Input value={niu} onChange={(e) => setNiu(e.target.value)} /></Field>
          <Field label="RCCM"><Input value={rccm} onChange={(e) => setRccm(e.target.value)} /></Field>
          <Field label="Email" hint="Used to send invoices & receipts"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@client.cm" /></Field>
          <Field label="Credit limit (XAF)">
            <Input type="number" min="0" step="0.01" className="num text-right" value={credit} onChange={(e) => setCredit(e.target.value)} />
          </Field>
          <Field label="Address" className="sm:col-span-2" hint="Printed as the bill-to on invoices">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Akwa, Douala" />
          </Field>
          <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Douala" /></Field>
          <Field label="Country">
            <CountrySelect value={countryCode} onChange={setCountryCode} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wht} onChange={(e) => setWht(e.target.checked)} /> Withholding agent
          </label>
          {!isNew && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
            </label>
          )}
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!name || busy} onCancel={onClose} saveLabel={isNew ? "Create client" : "Save changes"} />
      </form>
    </Modal>
  );
}

export function ClientsPage() {
  const { rows, error, loading, reload } = useList<api.Client>("/clients");
  const [editing, setEditing] = React.useState<api.Client | "new" | null>(null);
  const clients = rows || [];
  const totalCredit = clients.reduce((s, c) => s + (Number(c.credit_limit) || 0), 0);

  const columns: Column<api.Client>[] = [
    { key: "name", label: "Client", render: (r) => <span className="font-medium text-foreground">{r.name}</span> },
    { key: "niu", label: "NIU" },
    { key: "payment_terms_days", label: "Terms", render: (r) => (r.payment_terms_days != null ? `${r.payment_terms_days} d` : "—") },
    { key: "credit_limit", label: "Credit limit", className: "num text-right", render: (r) => money(r.credit_limit) },
    { key: "is_withholding_agent", label: "WHT", render: (r) => (r.is_withholding_agent ? <Pill tone="blue">Agent</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "is_active", label: "Status", render: (r) => <ActivePill active={r.is_active} /> },
  ];

  return (
    <section className={shell}>
      <PageHeader title="Clients" description="Customer master — terms, credit and withholding status." action={<Button onClick={() => setEditing("new")}>New client</Button>} />
      <KpiRow>
        <KpiTile label="Clients" value={num(clients.length)} />
        <KpiTile label="Active" value={num(clients.filter((c) => c.is_active).length)} />
        <KpiTile label="WHT agents" value={num(clients.filter((c) => c.is_withholding_agent).length)} />
        <KpiTile label="Total credit" value={money(totalCredit)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.client_id} onRowClick={(r) => setEditing(r)} empty={{ title: "No clients yet", hint: "Add your first customer to start quoting and invoicing." }} />
      {editing !== null && <ClientForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      <ScreenAi path="master/clients" />
    </section>
  );
}

/* ══════════════════════════════ Suppliers ═══════════════════════ */
