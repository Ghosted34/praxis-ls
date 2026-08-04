/**
 * Master data — corporate entities: the legal companies the tenant trades as.
 *
 * Split out of `features/master/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell } from "@/lib/format";
import { ActivePill } from "@/components/ui/pill";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";

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
    <Modal open={open} onClose={onClose} title={editing ? "Edit corporate entity" : "New corporate entity"} description="A legal entity you operate — used by treasury, tax and document numbering." size="lg">
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
  const reload = useRefresh();
  const { rows, error } = useList("/entities");
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
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Master data" to="/master" />} title="Corporate entities" description="The legal entities you operate — used by treasury, tax and document numbering." action={<Button onClick={openNew}>New entity</Button>} />

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
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
                    <ActivePill active={active} />
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
