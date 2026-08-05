/**
 * Master data — corporate entities: the legal companies the tenant invoices as.
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
import { ActivePill } from "@/components/ui/pill";
import { RowActions } from "@/components/ui/row-actions";
import { useList, errMsg } from "@/lib/use-resource";
import { num } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import { reportActionError } from "@/lib/action-error";
import { shell } from "./shared";

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
          <Field label="Country"><CountrySelect value={country} onChange={setCountry} allowEmpty={false} /></Field>
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
    } catch (e) { reportActionError(e); } finally {
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
        <RowActions>
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
          <Button size="sm" variant="outline" loading={busyId === r.entity_id} onClick={() => toggle(r)}>{r.is_active ? "Deactivate" : "Activate"}</Button>
        </RowActions>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Master data" to="/master" />} title="Corporate entities" description="The legal entities we bill and report from." action={<Button onClick={() => setEditing("new")}>New entity</Button>} />
      <HubTabs />
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
