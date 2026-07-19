/**
 * Master-data screens (Wave 1) wired to live endpoints + beautified on Praxis
 * tokens (KPI strip, status pills, money formatting, modal create/edit).
 *   Clients · Suppliers · Corporate entities · Expense rates · Financial dictionary
 * Treasury accounts + payment gateways live in features/settings/config-pages.tsx;
 * Currencies & Tax jurisdictions in features/settings/master-data-pages.tsx.
 */
import * as React from "react";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, ActivePill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt } from "@/lib/format";
import * as api from "@/lib/masterdata-api";

/* Shared modal footer. */
function FormButtons({ busy, disabled, onCancel, saveLabel = "Save" }: { busy: boolean; disabled?: boolean; onCancel: () => void; saveLabel?: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" loading={busy} disabled={disabled}>
        {saveLabel}
      </Button>
    </div>
  );
}

const shell = "mx-auto max-w-6xl animate-fade-in";

/* ══════════════════════════════ Clients ═════════════════════════ */

function ClientForm({ row, onClose, onSaved }: { row: api.Client | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const { rows: entities } = useList<api.Entity>("/entities");
  const [name, setName] = React.useState(row?.name ?? "");
  const [entityId, setEntityId] = React.useState(row?.entity_id ?? "");
  const [niu, setNiu] = React.useState(row?.niu ?? "");
  const [rccm, setRccm] = React.useState(row?.rccm ?? "");
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
          <Field label="Credit limit (XAF)">
            <Input type="number" min="0" step="0.01" className="num text-right" value={credit} onChange={(e) => setCredit(e.target.value)} />
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

function SupplierForm({ row, onClose, onSaved }: { row: api.Supplier | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const [name, setName] = React.useState(row?.name ?? "");
  const [type, setType] = React.useState(row?.supplier_type ?? "");
  const [niu, setNiu] = React.useState(row?.niu ?? "");
  const [rccm, setRccm] = React.useState(row?.rccm ?? "");
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
          <Field label="Rating (1–5)"><Input type="number" min="1" max="5" className="num" value={rating} onChange={(e) => setRating(e.target.value)} /></Field>
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
      <PageHeader title="Suppliers" description="Vendor master — payment, tax residency and rating." action={<Button onClick={() => setEditing("new")}>New supplier</Button>} />
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

function EntityForm({ row, onClose, onSaved }: { row: api.Entity | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const [code, setCode] = React.useState(row?.code ?? "");
  const [legalName, setLegalName] = React.useState(row?.legal_name ?? "");
  const [niu, setNiu] = React.useState(row?.niu ?? "");
  const [rccm, setRccm] = React.useState(row?.rccm ?? "");
  const [country, setCountry] = React.useState(row?.country_code ?? "CM");
  const [docPrefix, setDocPrefix] = React.useState(row?.doc_prefix ?? "");
  const [lang, setLang] = React.useState(row?.default_language ?? "fr");
  const [fyStart, setFyStart] = React.useState(row?.fiscal_year_start_month != null ? String(row.fiscal_year_start_month) : "1");
  // Address + bank block feed the letterhead/invoice documents. Both were writable
  // on the API but had no UI until 2026-07-18.
  const [address, setAddress] = React.useState(row?.address ?? "");
  const [bank, setBank] = React.useState<api.BankBlock>(row?.bank_block ?? {});
  const [logoLight, setLogoLight] = React.useState(row?.logo_light_ref ?? "");
  const [logoBusy, setLogoBusy] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const setBankField = (k: keyof api.BankBlock, v: string) => setBank((b) => ({ ...b, [k]: v }));

  /** Entities must exist before a logo can be attached (the upload is keyed by id). */
  async function pickLogo(file: File | null) {
    if (!file || isNew || !row) return;
    setLogoBusy(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read the file."));
        r.readAsDataURL(file);
      });
      const updated = await api.uploadEntityLogo(row.entity_id, dataUrl, "light");
      setLogoLight(updated.logo_light_ref ?? "");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLogoBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: api.EntityInput = {
      code,
      legal_name: legalName,
      niu: niu || undefined,
      rccm: rccm || undefined,
      country_code: country || undefined,
      doc_prefix: docPrefix || undefined,
      default_language: lang || undefined,
      fiscal_year_start_month: fyStart === "" ? undefined : Number(fyStart),
      address: address.trim() || null,
      bank_block: Object.fromEntries(Object.entries(bank).map(([k, v]) => [k, String(v ?? "").trim()]).filter(([, v]) => v)),
    };
    try {
      if (isNew) await api.createEntity(body);
      else await api.updateEntity(row!.entity_id, body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "New corporate entity" : "Edit corporate entity"} description="A legal entity we bill and report from.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required hint="Short unique key"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SLAS" /></Field>
          <Field label="Legal name" required><Input value={legalName} onChange={(e) => setLegalName(e.target.value)} /></Field>
          <Field label="NIU"><Input value={niu} onChange={(e) => setNiu(e.target.value)} /></Field>
          <Field label="RCCM"><Input value={rccm} onChange={(e) => setRccm(e.target.value)} /></Field>
          <Field label="Country"><Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="CM" /></Field>
          <Field label="Document prefix"><Input value={docPrefix} onChange={(e) => setDocPrefix(e.target.value)} placeholder="SLAS" /></Field>
          <Field label="Default language">
            <Select value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label="Fiscal year start month">
            <Select value={fyStart} onChange={(e) => setFyStart(e.target.value)}>
              {Array.from({ length: 12 }).map((_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i, 1).toLocaleString("en", { month: "long" })}</option>)}
            </Select>
          </Field>
          <Field label="Address" hint="Printed on invoices and letterhead" className="sm:col-span-2">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="BP 1234, Douala, Cameroon" />
          </Field>
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Bank details</p>
          <p className="text-xs text-muted-foreground">Rendered in the payment block on this entity&apos;s invoices. Blank fields are omitted.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bank name"><Input value={bank.bank_name ?? ""} onChange={(e) => setBankField("bank_name", e.target.value)} placeholder="Afriland First Bank" /></Field>
            <Field label="Branch"><Input value={bank.branch ?? ""} onChange={(e) => setBankField("branch", e.target.value)} placeholder="Akwa" /></Field>
            <Field label="Account number"><Input value={bank.account_number ?? ""} onChange={(e) => setBankField("account_number", e.target.value)} /></Field>
            <Field label="IBAN"><Input value={bank.iban ?? ""} onChange={(e) => setBankField("iban", e.target.value)} /></Field>
            <Field label="SWIFT / BIC"><Input value={bank.swift ?? ""} onChange={(e) => setBankField("swift", e.target.value)} /></Field>
          </div>
        </div>

        {!isNew && (
          <Field label="Letterhead logo" hint="PNG/JPG/WebP/SVG, max 512 KB — used on this entity's documents">
            <div className="flex items-center gap-3">
              {logoLight ? <img src={logoLight} alt="" className="h-10 w-auto rounded border bg-background object-contain p-1" /> : null}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                disabled={logoBusy}
                onChange={(e) => pickLogo(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
              />
            </div>
          </Field>
        )}

        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!code || !legalName || busy} onCancel={onClose} saveLabel={isNew ? "Create entity" : "Save changes"} />
      </form>
    </Modal>
  );
}

export function CorporateEntitiesPage() {
  const { rows, error, loading, reload } = useList<api.Entity>("/entities");
  const [editing, setEditing] = React.useState<api.Entity | "new" | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const entities = rows || [];

  async function toggle(en: api.Entity) {
    setBusyId(en.entity_id);
    try {
      await api.setEntityActive(en.entity_id, !en.is_active);
      reload();
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<api.Entity>[] = [
    { key: "code", label: "Code", render: (r) => <span className="num font-medium text-foreground">{r.code}</span> },
    { key: "legal_name", label: "Legal name" },
    { key: "country_code", label: "Country" },
    { key: "doc_prefix", label: "Doc prefix" },
    { key: "fiscal_year_start_month", label: "FY start", render: (r) => (r.fiscal_year_start_month ? new Date(2000, r.fiscal_year_start_month - 1, 1).toLocaleString("en", { month: "short" }) : "—") },
    { key: "is_active", label: "Status", render: (r) => <ActivePill active={r.is_active} /> },
    {
      key: "_a", label: "", render: (r) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
          <Button size="sm" variant="outline" loading={busyId === r.entity_id} onClick={() => toggle(r)}>{r.is_active ? "Deactivate" : "Activate"}</Button>
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader title="Corporate entities" description="The legal entities we bill and report from." action={<Button onClick={() => setEditing("new")}>New entity</Button>} />
      <KpiRow>
        <KpiTile label="Entities" value={num(entities.length)} />
        <KpiTile label="Active" value={num(entities.filter((e) => e.is_active).length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.entity_id} empty={{ title: "No entities yet", hint: "Add the legal entity that issues your documents." }} />
      {editing !== null && <EntityForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      <ScreenAi path="master/corporate-entities" />
    </section>
  );
}

/* ══════════════════════════ Expense rates ═══════════════════════ */

function ExpenseRateForm({ row, onClose, onSaved }: { row: api.ExpenseRate | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const { rows: dict } = useList<api.DictItem>("/financial-dictionary");
  const [dictId, setDictId] = React.useState(row?.dictionary_item_id ?? "");
  const [line, setLine] = React.useState(row?.shipping_line ?? "");
  const [variant, setVariant] = React.useState(row?.variant ?? "");
  const [rate, setRate] = React.useState(row?.rate != null ? String(row.rate) : "");
  const [currency, setCurrency] = React.useState(row?.currency ?? "XAF");
  const [from, setFrom] = React.useState(row?.effective_from ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: api.ExpenseRateInput = { dictionary_item_id: dictId, shipping_line: line, variant: variant || undefined, rate: Number(rate), currency: currency || undefined, effective_from: from || undefined };
    try {
      if (isNew) await api.createExpenseRate(body);
      else await api.updateExpenseRate(row!.expense_rate_id, body);
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "New expense rate" : "Edit expense rate"} description="Seeded-but-editable rate per shipping line — feeds costing.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dictionary item" required className="sm:col-span-2">
            <Select value={dictId} onChange={(e) => setDictId(e.target.value)}>
              <option value="">—</option>
              {(dict || []).map((d) => <option key={d.dictionary_item_id} value={d.dictionary_item_id}>{d.code} — {d.label_fr || d.label_en}</option>)}
            </Select>
          </Field>
          <Field label="Shipping line" required><Input value={line} onChange={(e) => setLine(e.target.value)} placeholder="MAERSK" /></Field>
          <Field label="Variant"><Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="20ft / 40ft" /></Field>
          <Field label="Rate" required><Input type="number" min="0" step="0.01" className="num text-right" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
          <Field label="Currency"><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
          <Field label="Effective from"><Input type="date" value={from ?? ""} onChange={(e) => setFrom(e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!dictId || !line || rate === "" || busy} onCancel={onClose} saveLabel={isNew ? "Create rate" : "Save changes"} />
      </form>
    </Modal>
  );
}

export function ExpenseRatesPage() {
  const { rows, error, loading, reload } = useList<api.ExpenseRate>("/expense-rates");
  const { rows: dict } = useList<api.DictItem>("/financial-dictionary");
  const [editing, setEditing] = React.useState<api.ExpenseRate | "new" | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const dictLabel = (id: string) => { const d = (dict || []).find((x) => x.dictionary_item_id === id); return d ? d.code : id.slice(0, 8); };

  async function remove(r: api.ExpenseRate) {
    if (!window.confirm("Delete this expense rate?")) return;
    setBusyId(r.expense_rate_id);
    try { await api.deleteExpenseRate(r.expense_rate_id); reload(); } finally { setBusyId(null); }
  }

  const columns: Column<api.ExpenseRate>[] = [
    { key: "dictionary_item_id", label: "Item", render: (r) => <span className="num">{dictLabel(r.dictionary_item_id)}</span> },
    { key: "shipping_line", label: "Shipping line", render: (r) => <span className="font-medium text-foreground">{r.shipping_line}</span> },
    { key: "variant", label: "Variant" },
    { key: "rate", label: "Rate", className: "num text-right", render: (r) => money(r.rate, r.currency || "XAF") },
    { key: "effective_from", label: "From", render: (r) => dateFmt(r.effective_from) },
    {
      key: "_a", label: "", render: (r) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
          <Button size="sm" variant="outline" loading={busyId === r.expense_rate_id} onClick={() => remove(r)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader title="Expense rates" description="Per-shipping-line rates that feed costing." action={<Button onClick={() => setEditing("new")}>New rate</Button>} />
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.expense_rate_id} empty={{ title: "No expense rates", hint: "Add a rate per shipping line and dictionary item." }} />
      {editing !== null && <ExpenseRateForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      <ScreenAi path="master/expense-rates" />
    </section>
  );
}

/* ══════════════════════ Financial dictionary ════════════════════ */

const CATEGORIES = ["debours", "service", "overhead", "asset", "other"] as const;
const CONTEXTS = ["sale", "purchase", "disbursement"] as const;
const catTone = (c: string): React.ComponentProps<typeof Pill>["tone"] => (c === "debours" ? "warn" : c === "service" ? "blue" : c === "asset" ? "ok" : "mute");

function DictForm({ row, onClose, onSaved }: { row: api.DictItem | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const [code, setCode] = React.useState(row?.code ?? "");
  const [labelFr, setLabelFr] = React.useState(row?.label_fr ?? "");
  const [labelEn, setLabelEn] = React.useState(row?.label_en ?? "");
  const [category, setCategory] = React.useState<string>(row?.category ?? "service");
  const [price, setPrice] = React.useState(row?.default_price != null ? String(row.default_price) : "");
  const [currency, setCurrency] = React.useState(row?.currency ?? "XAF");
  const [rules, setRules] = React.useState<api.PostingRule[]>([{ applies_context: "sale", debit_account: "", credit_account: "" }]);
  const [loadingRules, setLoadingRules] = React.useState(!isNew);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // On edit, load the item's real posting rules (GET /:id returns them) so they
  // can be edited in place rather than clobbered.
  React.useEffect(() => {
    if (isNew) return;
    let live = true;
    api.getDict(row!.dictionary_item_id)
      .then((full) => {
        if (!live) return;
        const rs = (full.posting_rules || []).map((r) => ({
          applies_context: r.applies_context,
          debit_account: r.debit_account ?? "",
          credit_account: r.credit_account ?? "",
          tax_code_id: r.tax_code_id,
          is_debours: r.is_debours,
        }));
        setRules(rs.length ? rs : [{ applies_context: "sale", debit_account: "", credit_account: "" }]);
      })
      .catch((e) => { if (live) setError(errMsg(e)); })
      .finally(() => { if (live) setLoadingRules(false); });
    return () => { live = false; };
  }, [isNew, row]);

  const setRule = (i: number, patch: Partial<api.PostingRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRule = () => setRules((rs) => [...rs, { applies_context: "sale", debit_account: "", credit_account: "" }]);
  const delRule = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const base = {
      code,
      label_fr: labelFr,
      label_en: labelEn || undefined,
      category: category as api.DictInput["category"],
      default_price: price === "" ? undefined : Number(price),
      currency: currency || undefined,
    };
    const posting_rules = rules.map((r) => ({ ...r, debit_account: r.debit_account || undefined, credit_account: r.credit_account || undefined }));
    try {
      if (isNew) await api.createDict({ ...base, posting_rules });
      else await api.updateDict(row!.dictionary_item_id, { ...base, posting_rules });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? "New dictionary item" : "Edit dictionary item"} description="A billable/cost line with its OHADA posting rules.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required><Input className="num" value={code} onChange={(e) => setCode(e.target.value)} placeholder="FREIGHT" /></Field>
          <Field label="Category" required>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Label (FR)" required><Input value={labelFr} onChange={(e) => setLabelFr(e.target.value)} /></Field>
          <Field label="Label (EN)"><Input value={labelEn ?? ""} onChange={(e) => setLabelEn(e.target.value)} /></Field>
          <Field label="Default price"><Input type="number" min="0" step="0.01" className="num text-right" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label="Currency"><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="micro">Posting rules</span>
            <Button type="button" size="sm" variant="ghost" onClick={addRule} disabled={loadingRules}>+ Add rule</Button>
          </div>
          {loadingRules ? (
            <p className="text-xs text-muted-foreground">Loading posting rules…</p>
          ) : (
            <div className="space-y-2">
              {rules.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                  <Field label="Context"><Select value={r.applies_context} onChange={(e) => setRule(i, { applies_context: e.target.value as api.PostingRule["applies_context"] })}>{CONTEXTS.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
                  <Field label="Debit"><Input className="num" value={r.debit_account ?? ""} onChange={(e) => setRule(i, { debit_account: e.target.value })} placeholder="6…" /></Field>
                  <Field label="Credit"><Input className="num" value={r.credit_account ?? ""} onChange={(e) => setRule(i, { credit_account: e.target.value })} placeholder="7…" /></Field>
                  <Button type="button" size="sm" variant="outline" disabled={rules.length === 1} onClick={() => delRule(i)}>✕</Button>
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!code || !labelFr || rules.length === 0 || loadingRules || busy} onCancel={onClose} saveLabel={isNew ? "Create item" : "Save changes"} />
      </form>
    </Modal>
  );
}

export function FinancialDictionaryPage() {
  const { rows, error, loading, reload } = useList<api.DictItem>("/financial-dictionary");
  const [editing, setEditing] = React.useState<api.DictItem | "new" | null>(null);
  const items = rows || [];
  const columns: Column<api.DictItem>[] = [
    { key: "code", label: "Code", render: (r) => <span className="num font-medium text-foreground">{r.code}</span> },
    { key: "label_fr", label: "Label", render: (r) => r.label_fr || r.label_en || "—" },
    { key: "category", label: "Category", render: (r) => <Pill tone={catTone(r.category)}>{r.category}</Pill> },
    { key: "default_price", label: "Default price", className: "num text-right", render: (r) => money(r.default_price, r.currency || "XAF") },
    { key: "is_active", label: "Status", render: (r) => <ActivePill active={r.is_active} /> },
  ];
  return (
    <section className={shell}>
      <PageHeader title="Financial dictionary" description="Billable & cost lines with their OHADA posting rules." action={<Button onClick={() => setEditing("new")}>New item</Button>} />
      <KpiRow>
        <KpiTile label="Items" value={num(items.length)} />
        <KpiTile label="Débours" value={num(items.filter((i) => i.category === "debours").length)} />
        <KpiTile label="Services" value={num(items.filter((i) => i.category === "service").length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.dictionary_item_id} onRowClick={(r) => setEditing(r)} empty={{ title: "Dictionary is empty", hint: "Add billable/cost items so quotes and costing can reference them." }} />
      {editing !== null && <DictForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      <ScreenAi path="master/financial-dictionary" />
    </section>
  );
}
