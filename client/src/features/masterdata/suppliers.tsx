/**
 * Master data — suppliers.
 *
 * Split out of `features/masterdata/pages.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { CountrySelect } from "@/components/country-select";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, ActivePill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { num } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import { shell } from "./shared";

function SupplierForm({ row, onClose, onSaved }: { row: api.Supplier | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const [name, setName] = React.useState(row?.name ?? "");
  const [type, setType] = React.useState(row?.supplier_type ?? "");
  const [niu, setNiu] = React.useState(row?.niu ?? "");
  const [rccm, setRccm] = React.useState(row?.rccm ?? "");
  const [email, setEmail] = React.useState(row?.email ?? "");
  // 0480 — supplier address, for POs and matched supplier invoices.
  const [address, setAddress] = React.useState(row?.address ?? "");
  const [city, setCity] = React.useState(row?.city ?? "");
  const [countryCode, setCountryCode] = React.useState(row?.country_code ?? "CM");
  const [method, setMethod] = React.useState(row?.payment_method ?? "");
  const [rating, setRating] = React.useState(row?.rating != null ? String(row.rating) : "");
  const [nonResident, setNonResident] = React.useState(row?.is_non_resident ?? false);
  const [active, setActive] = React.useState(row?.is_active ?? true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: api.SupplierInput = {
      name,
      supplier_type: type || undefined,
      niu: niu || undefined,
      rccm: rccm || undefined,
      email: email || undefined,
      address: address || undefined,
      city: city || undefined,
      country_code: countryCode || undefined,
      payment_method: (method || undefined) as api.SupplierInput["payment_method"],
      rating: rating === "" ? undefined : Number(rating),
      is_non_resident: nonResident,
    };
    try {
      if (isNew) await api.createSupplier(body);
      else await api.updateSupplier(row!.supplier_id, { ...body, is_active: active });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "New supplier" : "Edit supplier"} description="Vendor master — payment method, tax residency and rating.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Type"><Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Carrier, agent, utility…" /></Field>
          <Field label="Payment method">
            <Select value={method ?? ""} onChange={(e) => setMethod(e.target.value)}>
              <option value="">—</option>
              {["BANK", "CASH", "MOBILE_MONEY", "CHEQUE"].map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="NIU"><Input value={niu} onChange={(e) => setNiu(e.target.value)} /></Field>
          <Field label="RCCM"><Input value={rccm} onChange={(e) => setRccm(e.target.value)} /></Field>
          <Field label="Email" hint="Used to send purchase orders"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ap@supplier.cm" /></Field>
          <Field label="Rating (1–5)"><Input type="number" min="1" max="5" className="num" value={rating} onChange={(e) => setRating(e.target.value)} /></Field>
          <Field label="Address" className="sm:col-span-2" hint="Shown on purchase orders">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Zone industrielle, Bonabéri" />
          </Field>
          <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Douala" /></Field>
          <Field label="Country">
            <CountrySelect value={countryCode} onChange={setCountryCode} />
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={nonResident} onChange={(e) => setNonResident(e.target.checked)} /> Non-resident (WHT)</label>
          {!isNew && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>}
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!name || busy} onCancel={onClose} saveLabel={isNew ? "Create supplier" : "Save changes"} />
      </form>
    </Modal>
  );
}

export function SuppliersPage() {
  const { rows, error, loading, reload } = useList<api.Supplier>("/suppliers");
  const [editing, setEditing] = React.useState<api.Supplier | "new" | null>(null);
  const suppliers = rows || [];
  const columns: Column<api.Supplier>[] = [
    { key: "name", label: "Supplier", render: (r) => <span className="font-medium text-foreground">{r.name}</span> },
    { key: "supplier_type", label: "Type" },
    { key: "payment_method", label: "Pay method", render: (r) => (r.payment_method ? <Pill tone="mute">{r.payment_method}</Pill> : "—") },
    { key: "rating", label: "Rating", render: (r) => (r.rating ? "★".repeat(r.rating) : "—") },
    { key: "is_non_resident", label: "WHT", render: (r) => (r.is_non_resident ? <Pill tone="warn">Non-resident</Pill> : <span className="text-muted-foreground">—</span>) },
    { key: "is_active", label: "Status", render: (r) => <ActivePill active={r.is_active} /> },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Master data" to="/master" />} title="Suppliers" description="Vendor master — payment, tax residency and rating." action={<Button onClick={() => setEditing("new")}>New supplier</Button>} />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Suppliers" value={num(suppliers.length)} />
        <KpiTile label="Active" value={num(suppliers.filter((s) => s.is_active).length)} />
        <KpiTile label="Non-resident" value={num(suppliers.filter((s) => s.is_non_resident).length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.supplier_id} onRowClick={(r) => setEditing(r)} empty={{ title: "No suppliers yet", hint: "Add vendors to raise POs and supplier invoices." }} />
      {editing !== null && <SupplierForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      <ScreenAi path="master/suppliers" />
    </section>
  );
}

/* ══════════════════════════ Corporate entities ══════════════════ */
