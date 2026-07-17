/** Master-data registries wired to live endpoints:
 *   - ClientsPage           → MOD-03 /clients (+ /clients/:id/credit)
 *   - SuppliersPage         → MOD-04 /suppliers
 *   - CorporateEntitiesPage → MOD-01 /entities (+ /:id/active)
 *  Same primitives + patterns as features/settings/master-data-pages.tsx.
 *  AI panels are gated globally (components/ai-actions.tsx). */
import * as React from "react";
import { tenant, ApiError } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";

type Row = Record<string, unknown>;

function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "You don't have permission to do this.";
    return e.message || "Something went wrong.";
  }
  return "Something went wrong.";
}

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Load a resource into state, keyed on a reload nonce. */
function useList(path: string, nonce: number) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    tenant<Row[]>(path)
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [path, nonce]);
  return { rows, error };
}

function StatusPill({ active }: { active: boolean }) {
  return active ? (
    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">active</span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">inactive</span>
  );
}

/** Optional corporate-entity picker, shared by Clients + Suppliers. */
function EntitySelect({ entities, value, onChange }: { entities: Row[] | null; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— none —</option>
      {(entities || []).map((en) => {
        const name = cell(en.legal_name ?? en.entity_id);
        const label = en.code ? `${cell(en.code)} · ${name}` : name;
        return (
          <option key={String(en.entity_id)} value={String(en.entity_id)}>
            {label}
          </option>
        );
      })}
    </Select>
  );
}

/* ──────────────────────────────── Clients (MOD-03) ──────────────────────────────── */

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
    <Modal open={open} onClose={onClose} title={editing ? "Edit client" : "New client"} description="Customer registry entry — referenced across sales, operations and receivables (MOD-03)." size="lg">
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

  const money = (v: unknown) => (v === null || v === undefined ? "no limit" : `${Number(v).toLocaleString()} XAF`);

  return (
    <Modal open={open} onClose={onClose} title={`Credit status — ${client ? cell(client.name) : ""}`} description="Live credit availability from the client master (MOD-03).">
      <div className="space-y-4">
        {error ? (
          <ErrorState message={error} />
        ) : data === null ? (
          <LoadingRow label="Checking credit…" />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="KYC complete" value={data.kyc_complete ? "yes" : "no"} good={data.kyc_complete === true} />
            <Stat label="Within limit" value={data.within ? "yes" : "over"} good={data.within === true} />
            <Stat label="Credit limit" value={money(data.limit)} />
            <Stat label="Receivables used" value={money(data.used)} />
            <Stat label="Available" value={data.available === null ? "—" : money(data.available)} />
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

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${good === undefined ? "text-foreground" : good ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{value}</p>
    </div>
  );
}

export function ClientsPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/clients", nonce);
  const { rows: entities } = useList("/entities", nonce);
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
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">Customer registry referenced across sales, operations and receivables (MOD-03).</p>
        </div>
        <Button onClick={openNew}>New client</Button>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow />
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
                  <StatusPill active={r.is_active !== false} />
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

/* ─────────────────────────────── Suppliers (MOD-04) ─────────────────────────────── */

const SUPPLIER_AI: AiAction[] = [
  { label: "Find duplicate suppliers", kind: "assist", describe: "Scan the supplier master for likely duplicates by name / NIU." },
  { label: "Summarise supplier", kind: "read", describe: "Summarise a supplier's payment method, rating and recent activity." },
];

const PAYMENT_METHODS = ["", "BANK", "CASH", "MOBILE_MONEY", "CHEQUE"];

function SupplierForm({ open, editing, entities, onClose, onSaved }: { open: boolean; editing: Row | null; entities: Row[] | null; onClose: () => void; onSaved: () => void }) {
  const [entityId, setEntityId] = React.useState("");
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState("");
  const [niu, setNiu] = React.useState("");
  const [rccm, setRccm] = React.useState("");
  const [method, setMethod] = React.useState("");
  const [momoNetwork, setMomoNetwork] = React.useState("");
  const [momoNumber, setMomoNumber] = React.useState("");
  const [nonResident, setNonResident] = React.useState(false);
  const [rating, setRating] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId(editing?.entity_id ? String(editing.entity_id) : "");
    setName(editing?.name ? String(editing.name) : "");
    setType(editing?.supplier_type ? String(editing.supplier_type) : "");
    setNiu(editing?.niu ? String(editing.niu) : "");
    setRccm(editing?.rccm ? String(editing.rccm) : "");
    setMethod(editing?.payment_method ? String(editing.payment_method) : "");
    setMomoNetwork(editing?.momo_network ? String(editing.momo_network) : "");
    setMomoNumber(editing?.momo_number ? String(editing.momo_number) : "");
    setNonResident(editing?.is_non_resident === true);
    setRating(editing?.rating != null ? String(editing.rating) : "");
    setActive(editing?.is_active !== false);
    setError(null);
  }, [open, editing]);

  const isMomo = method === "MOBILE_MONEY";
  const canSubmit = !!name.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: name.trim(),
      entity_id: entityId || undefined,
      supplier_type: type.trim() || undefined,
      niu: niu.trim() || undefined,
      rccm: rccm.trim() || undefined,
      payment_method: method || undefined,
      momo_network: isMomo ? momoNetwork.trim() || undefined : undefined,
      momo_number: isMomo ? momoNumber.trim() || undefined : undefined,
      is_non_resident: nonResident,
      rating: rating === "" ? undefined : Number(rating),
    };
    if (editing) body.is_active = active;
    try {
      if (editing) await tenant(`/suppliers/${String(editing.supplier_id)}`, { method: "PATCH", body });
      else await tenant("/suppliers", { method: "POST", body });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit supplier" : "New supplier"} description="Vendor registry entry — referenced across procurement and payables (MOD-04)." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sonara Fuels SA" />
          </Field>
          <Field label="Corporate entity" hint="Which of your legal entities pays this vendor" className="sm:col-span-2">
            <EntitySelect entities={entities} value={entityId} onChange={setEntityId} />
          </Field>
          <Field label="Category" hint="e.g. Freight, Customs, Fuel">
            <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Freight" />
          </Field>
          <Field label="Rating (1–5)">
            <Input type="number" min="1" max="5" step="1" className="num text-right" value={rating} onChange={(e) => setRating(e.target.value)} placeholder="4" />
          </Field>
          <Field label="NIU">
            <Input value={niu} onChange={(e) => setNiu(e.target.value)} placeholder="M0987654321B" />
          </Field>
          <Field label="RCCM">
            <Input value={rccm} onChange={(e) => setRccm(e.target.value)} placeholder="RC/DLA/2019/B/5678" />
          </Field>
          <Field label="Payment method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m || "none"} value={m}>
                  {m ? m.replace("_", " ") : "— select —"}
                </option>
              ))}
            </Select>
          </Field>
          {isMomo && (
            <>
              <Field label="Mobile-money network">
                <Input value={momoNetwork} onChange={(e) => setMomoNetwork(e.target.value)} placeholder="MTN / Orange" />
              </Field>
              <Field label="Mobile-money number">
                <Input value={momoNumber} onChange={(e) => setMomoNumber(e.target.value)} placeholder="6XXXXXXXX" />
              </Field>
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={nonResident} onChange={(e) => setNonResident(e.target.checked)} />
          Non-resident (foreign supplier — affects withholding)
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
            {editing ? "Save changes" : "Create supplier"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SuppliersPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/suppliers", nonce);
  const { rows: entities } = useList("/entities", nonce);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setFormOpen(true);
  }

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Suppliers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Vendor registry referenced across procurement and payables (MOD-04).</p>
        </div>
        <Button onClick={openNew}>New supplier</Button>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow />
      ) : rows.length === 0 ? (
        <EmptyState title="No suppliers yet" hint="Create the first supplier to reference it in purchase orders and supplier invoices." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Category</TH>
              <TH>NIU</TH>
              <TH>Payment</TH>
              <TH>Rating</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={String(r.supplier_id)}>
                <TD className="text-sm font-medium">{cell(r.name)}</TD>
                <TD className="text-sm">{cell(r.supplier_type)}</TD>
                <TD className="text-sm">{cell(r.niu)}</TD>
                <TD className="text-sm">{r.payment_method ? cell(r.payment_method).replace("_", " ") : "—"}</TD>
                <TD className="num text-sm">{r.rating != null ? `${cell(r.rating)}/5` : "—"}</TD>
                <TD className="text-sm">
                  <StatusPill active={r.is_active !== false} />
                </TD>
                <TD>
                  <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                    Edit
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <AiActions actions={SUPPLIER_AI} />

      <SupplierForm open={formOpen} editing={editing} entities={entities} onClose={() => setFormOpen(false)} onSaved={reload} />
    </section>
  );
}

/* ──────────────────────────── Corporate entities (MOD-01) ──────────────────────────── */

function EntityForm({ open, editing, onClose, onSaved }: { open: boolean; editing: Row | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = React.useState("");
  const [legalName, setLegalName] = React.useState("");
  const [niu, setNiu] = React.useState("");
  const [rccm, setRccm] = React.useState("");
  const [country, setCountry] = React.useState("CM");
  const [address, setAddress] = React.useState("");
  const [docPrefix, setDocPrefix] = React.useState("");
  const [language, setLanguage] = React.useState("fr");
  const [fyStart, setFyStart] = React.useState("1");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCode(editing?.code ? String(editing.code) : "");
    setLegalName(editing?.legal_name ? String(editing.legal_name) : "");
    setNiu(editing?.niu ? String(editing.niu) : "");
    setRccm(editing?.rccm ? String(editing.rccm) : "");
    setCountry(editing?.country_code ? String(editing.country_code) : "CM");
    setAddress(editing?.address ? String(editing.address) : "");
    setDocPrefix(editing?.doc_prefix ? String(editing.doc_prefix) : "");
    setLanguage(editing?.default_language ? String(editing.default_language) : "fr");
    setFyStart(editing?.fiscal_year_start_month != null ? String(editing.fiscal_year_start_month) : "1");
    setError(null);
  }, [open, editing]);

  const canSubmit = !!legalName.trim() && (!!editing || !!code.trim()) && country.trim().length === 2 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const common: Record<string, unknown> = {
      legal_name: legalName.trim(),
      niu: niu.trim() || null,
      rccm: rccm.trim() || null,
      country_code: country.trim().toUpperCase(),
      address: address.trim() || null,
      doc_prefix: docPrefix.trim() || undefined,
      default_language: language,
      fiscal_year_start_month: Number(fyStart),
    };
    try {
      if (editing) {
        await tenant(`/entities/${String(editing.entity_id)}`, { method: "PATCH", body: common });
      } else {
        await tenant("/entities", { method: "POST", body: { ...common, code: code.trim() } });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit corporate entity" : "New corporate entity"} description="A legal entity you operate — used by treasury, tax and document numbering (MOD-01)." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" hint={editing ? "Immutable" : "Short unique key"} required={!editing}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PRAXIS-CM" disabled={!!editing} />
          </Field>
          <Field label="Country" hint="ISO-2" required error={country && country.trim().length !== 2 ? "2-letter code" : undefined}>
            <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="CM" />
          </Field>
          <Field label="Legal name" required className="sm:col-span-2">
            <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Praxis Logistics Services SARL" />
          </Field>
          <Field label="NIU">
            <Input value={niu} onChange={(e) => setNiu(e.target.value)} placeholder="P0123456789A" />
          </Field>
          <Field label="RCCM">
            <Input value={rccm} onChange={(e) => setRccm(e.target.value)} placeholder="RC/DLA/2018/B/9012" />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Bonanjo, Douala" />
          </Field>
          <Field label="Document prefix" hint="Prefixes invoice/dossier numbers">
            <Input value={docPrefix} onChange={(e) => setDocPrefix(e.target.value)} placeholder="PLS" />
          </Field>
          <Field label="Default language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label="Fiscal year start month" hint="1 = January">
            <Select value={fyStart} onChange={(e) => setFyStart(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={String(m)}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {editing ? "Save changes" : "Create entity"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CorporateEntitiesPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/entities", nonce);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setFormOpen(true);
  }

  async function setActive(id: string, active: boolean) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/entities/${id}/active`, { method: "POST", body: { active } });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Corporate entities</h1>
          <p className="mt-1 text-sm text-muted-foreground">The legal entities you operate — used by treasury, tax and document numbering (MOD-01).</p>
        </div>
        <Button onClick={openNew}>New entity</Button>
      </header>

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow />
      ) : rows.length === 0 ? (
        <EmptyState title="No entities yet" hint="Create the legal entity you invoice and bank under." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Legal name</TH>
              <TH>NIU</TH>
              <TH>RCCM</TH>
              <TH>Country</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const id = String(r.entity_id);
              const active = r.is_active !== false;
              return (
                <TR key={id}>
                  <TD className="text-sm font-medium">{cell(r.code)}</TD>
                  <TD className="text-sm">{cell(r.legal_name)}</TD>
                  <TD className="text-sm">{cell(r.niu)}</TD>
                  <TD className="text-sm">{cell(r.rccm)}</TD>
                  <TD className="text-sm">{cell(r.country_code)}</TD>
                  <TD className="text-sm">
                    <StatusPill active={active} />
                  </TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                        Edit
                      </Button>
                      <Button size="sm" variant={active ? "ghost" : "default"} loading={rowBusy === id} onClick={() => setActive(id, !active)}>
                        {active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <EntityForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={reload} />
    </section>
  );
}
