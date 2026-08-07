/**
 * Master data — suppliers, as a 360° command centre (spec §8.2).
 *
 * The flat CRUD list became a list + rich dossier, mirroring the client master:
 * pick a supplier to see AVL/compliance state, KYC documents, banks, contacts,
 * registrations and the GL-derived payables rollup, with verify / block / convert
 * actions. The detail view is shared (party-360.tsx); the edit form stays here.
 */
import * as React from "react";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { SplitPane } from "@/components/ui/split-pane";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { SmartCountryPicker } from "@/components/smart-country-picker";
import { CountryRegistrationFields, useCountryRegistrations, toRegistrationsPayload, type RegValues } from "./country-registration-fields";
import { Pill } from "@/components/ui/pill";
import { useResource, errMsg } from "@/lib/use-resource";
import * as api from "@/lib/masterdata-api";
import { shell } from "./shared";
import { PartyDossier } from "./party-360";
import { MasterDataSettings } from "./master-data-settings";

function SupplierForm({ row, onClose, onSaved }: { row: (api.Supplier & Partial<api.PartyExtras>) | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const [countryCode, setCountryCode] = React.useState(row?.country_code ?? "CM");
  const [legalName, setLegalName] = React.useState(row?.legal_name ?? row?.name ?? "");
  const [tradingName, setTradingName] = React.useState(row?.trading_name ?? "");
  const [type, setType] = React.useState(row?.supplier_type ?? "");
  const [email, setEmail] = React.useState(row?.email ?? "");
  const [method, setMethod] = React.useState(row?.payment_method ?? "");
  const [rating, setRating] = React.useState(row?.rating != null ? String(row.rating) : "");
  const [nonResident, setNonResident] = React.useState(row?.is_non_resident ?? false);
  const [active, setActive] = React.useState(row?.is_active ?? true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Country drives the dynamic tax/legal IDs (§2.2); registrations + primary
  // contact/address are collected here and written as their own rows on save.
  const reqs = useCountryRegistrations(countryCode);
  const [regs, setRegs] = React.useState<RegValues>(() => ({ NIU: row?.niu ?? "", RCCM: row?.rccm ?? "" }));
  const [contact, setContact] = React.useState({ name: "", email: "" });
  const [address, setAddress] = React.useState({ line1: row?.address ?? "", city: row?.city ?? "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const name = legalName.trim() || tradingName.trim();
    const primary_contact = contact.name.trim() ? { name: contact.name.trim(), email: contact.email.trim() || undefined } : undefined;
    const primary_address = address.line1.trim() || address.city.trim()
      ? { line1: address.line1.trim() || undefined, city: address.city.trim() || undefined, country_code: countryCode || undefined }
      : undefined;
    const body: api.SupplierInput = {
      name,
      legal_name: legalName.trim() || undefined,
      trading_name: tradingName.trim() || undefined,
      supplier_type: type || undefined,
      email: email || undefined,
      country_code: countryCode || undefined,
      payment_method: (method || undefined) as api.SupplierInput["payment_method"],
      rating: rating === "" ? undefined : Number(rating),
      is_non_resident: nonResident,
      registrations: toRegistrationsPayload(reqs, regs, countryCode),
      ...(isNew ? { primary_contact, primary_address } : {}),
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
    <Modal open onClose={onClose} title={isNew ? "New supplier" : "Edit supplier"} description="Vendor master — country, registrations, payment method and WHT.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* 1 · Identity — country first, it drives the registration IDs. */}
          <Field label="Country" required className="sm:col-span-2">
            <SmartCountryPicker value={countryCode} onChange={setCountryCode} allowEmpty={false} />
          </Field>
          <Field label="Legal name" required><Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Bolloré Transport SA" /></Field>
          <Field label="Trading / DBA name"><Input value={tradingName} onChange={(e) => setTradingName(e.target.value)} placeholder="Bolloré" /></Field>

          {/* 2 · Country-driven tax / legal IDs. */}
          <div className="sm:col-span-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tax &amp; legal registration</div>
          <CountryRegistrationFields country={countryCode} values={regs} onChange={setRegs} />

          <Field label="Category"><Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Carrier, agent, utility…" /></Field>
          <Field label="Payment method">
            <Select value={method ?? ""} onChange={(e) => setMethod(e.target.value)}>
              <option value="">—</option>
              {["BANK", "CASH", "MOBILE_MONEY", "CHEQUE"].map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>

          {/* 3 · Primary contact + address (new-supplier only). */}
          {isNew && (
            <>
              <div className="sm:col-span-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Primary contact &amp; address</div>
              <Field label="Contact name"><Input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder="Jean Fotso" /></Field>
              <Field label="Contact email"><Input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="ap@supplier.cm" /></Field>
              <Field label="Address line"><Input value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} placeholder="Zone industrielle, Bonabéri" /></Field>
              <Field label="City"><Input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} placeholder="Douala" /></Field>
            </>
          )}

          {/* 4 · Terms. */}
          <div className="sm:col-span-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Terms</div>
          <Field label="Email" hint="Used to send purchase orders"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ap@supplier.cm" /></Field>
          <Field label="Rating (1–5)"><Input type="number" min="1" max="5" className="num" value={rating} onChange={(e) => setRating(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={nonResident} onChange={(e) => setNonResident(e.target.checked)} /> Non-resident (WHT)</label>
          {!isNew && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>}
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!legalName.trim() || busy} onCancel={onClose} saveLabel={isNew ? "Create supplier" : "Save changes"} />
      </form>
    </Modal>
  );
}

export function SuppliersPage() {
  const suppliers = useResource(() => api.listSuppliers(), []);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<api.Supplier | "new" | null>(null);
  const [settings, setSettings] = React.useState(false);

  const rows = React.useMemo(() => suppliers.data || [], [suppliers.data]);
  const filtered = q ? rows.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())) : rows;
  const selected = rows.find((s) => s.supplier_id === selId) || null;
  React.useEffect(() => { if (!selId && rows.length) setSelId(rows[0].supplier_id); }, [rows, selId]);

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Master data" to="/master" />}
        title="Suppliers"
        description="Vendor master with a live 360 — AVL, KYC, banks, WHT and payables."
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSettings(true)}>⚙ Settings</Button>
            <Button onClick={() => setEditing("new")}>New supplier</Button>
          </div>
        }
      />
      <HubTabs />
      {suppliers.error ? <ErrorState message={suppliers.error} /> : (
        <SplitPane storageKey="master.suppliers" label="Supplier list width" defaultSize={260} min={200} max={480}>
          <div className="space-y-2">
            <Input placeholder="Search supplier…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {suppliers.loading ? <LoadingRow label="Loading suppliers…" /> : filtered.length === 0 ? <div className="px-3 py-4 micro">No suppliers.</div> : filtered.map((s) => (
                <button key={s.supplier_id} onClick={() => setSelId(s.supplier_id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${s.supplier_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}>
                  <span className="truncate font-medium">{s.name}</span>
                  <Pill tone={s.is_active ? "ok" : "mute"}>{s.is_active ? "Active" : "Off"}</Pill>
                </button>
              ))}
            </div>
          </div>
          {selected
            ? <PartyDossier kind="supplier" partyId={selected.supplier_id} onEdit={() => setEditing(selected)} onChanged={suppliers.reload} />
            : <EmptyState title="No supplier selected" hint="Choose a supplier from the list." />}
        </SplitPane>
      )}
      {editing !== null && <SupplierForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={suppliers.reload} />}
      <MasterDataSettings open={settings} onClose={() => setSettings(false)} initialSide="SUPPLIER" />
      <ScreenAi path="master/suppliers" />
    </section>
  );
}
