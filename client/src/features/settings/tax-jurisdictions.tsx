/**
 * Settings — tax jurisdictions and their codes (TVA, WHT, IS, patente…).
 *
 * Split out of `features/settings/master-data-pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { errMsg, useList, useRefresh } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { smartCell, todayISO } from "@/lib/format";
import { Pill } from "@/components/ui/pill";

function NewJurisdictionForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [country, setCountry] = React.useState("CM");
  const [name, setName] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCountry("CM");
    setName("");
    setCurrency("XAF");
    setError(null);
  }, [open]);

  const canSubmit = !!name.trim() && !!country.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/tax-jurisdictions", { method: "POST", body: { country_code: country.trim().toUpperCase(), name: name.trim(), currency: currency.trim().toUpperCase() } });
      onCreated();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New tax jurisdiction" description="A jurisdiction groups the effective-dated tax codes (TVA, WHT, IS…) that account determination reads.">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Country" hint="ISO code" required>
            <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="CM" />
          </Field>
          <Field label="Name" required className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cameroon (CEMAC)" />
          </Field>
          <Field label="Currency">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="XAF" />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const TAX_CODE_KINDS = ["TVA", "WHT", "IS", "MIN_TAX", "PATENTE", "OTHER"];

function AddCodeForm({ jurisdictionId, onClose, onAdded }: { jurisdictionId: string | null; onClose: () => void; onAdded: () => void }) {
  const open = !!jurisdictionId;
  const [code, setCode] = React.useState("");
  const [kind, setKind] = React.useState("TVA");
  const [ratePercent, setRatePercent] = React.useState("");
  const [appliesTo, setAppliesTo] = React.useState("");
  const [recoverable, setRecoverable] = React.useState(false);
  const [effectiveFrom, setEffectiveFrom] = React.useState(todayISO());
  const [effectiveTo, setEffectiveTo] = React.useState("");
  const [legalRef, setLegalRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCode("");
    setKind("TVA");
    setRatePercent("");
    setAppliesTo("");
    setRecoverable(false);
    setEffectiveFrom(todayISO());
    setEffectiveTo("");
    setLegalRef("");
    setError(null);
  }, [open]);

  const canSubmit = !!code.trim() && Number(ratePercent) >= 0 && ratePercent !== "" && !busy;

  async function submit() {
    if (!jurisdictionId) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/tax-jurisdictions/${jurisdictionId}/codes`, {
        method: "POST",
        body: {
          code: code.trim().toUpperCase(),
          kind,
          rate_percent: Number(ratePercent),
          applies_to: appliesTo || undefined,
          recoverable,
          effective_from: effectiveFrom,
          effective_to: effectiveTo || undefined,
          legal_reference: legalRef || undefined,
        },
      });
      onAdded();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add tax code" description="Effective-dated rate card. To change a rate later, add a new code that supersedes it — history is never edited." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="TVA-19.25" />
          </Field>
          <Field label="Kind" required>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {TAX_CODE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rate %" required>
            <Input type="number" min="0" step="0.01" className="num text-right" value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} placeholder="19.25" />
          </Field>
          <Field label="Applies to" hint="e.g. SALES, PURCHASES">
            <Input value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} placeholder="SALES" />
          </Field>
          <Field label="Effective from" required>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </Field>
          <Field label="Effective to" hint="Blank = open-ended">
            <Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
          </Field>
          <Field label="Legal reference" className="sm:col-span-2">
            <Input value={legalRef} onChange={(e) => setLegalRef(e.target.value)} placeholder="CGI art. 149" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={recoverable} onChange={(e) => setRecoverable(e.target.checked)} />
          Recoverable (input VAT credit)
        </label>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Add code
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CodesPanel({ jurisdictionId, onAddCode }: { jurisdictionId: string; onAddCode: () => void }) {
  const { rows: codes, error } = useList(`/tax-jurisdictions/${jurisdictionId}/codes`);
  return (
    <div className="mt-2 rounded-lg border bg-muted/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Tax codes</span>
        <Button size="sm" variant="outline" onClick={onAddCode}>
          + Add code
        </Button>
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : codes === null ? (
        <LoadingRow label="Loading codes…" />
      ) : codes.length === 0 ? (
        <EmptyState title="No tax codes" hint="Add a rate card to this jurisdiction." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Kind</TH>
              <TH>Rate %</TH>
              <TH>Applies to</TH>
              <TH>From</TH>
              <TH>To</TH>
            </TR>
          </THead>
          <TBody>
            {codes.map((c, i) => (
              <TR key={i}>
                <TD className="text-sm font-medium">{smartCell(c.code)}</TD>
                <TD className="text-sm">{smartCell(c.kind)}</TD>
                <TD className="num text-sm">{smartCell(c.rate_percent)}</TD>
                <TD className="text-sm">{smartCell(c.applies_to)}</TD>
                <TD className="text-sm">{smartCell(c.effective_from)}</TD>
                <TD className="text-sm">{smartCell(c.effective_to)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

export function TaxJurisdictionsPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/tax-jurisdictions");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [addCodeFor, setAddCodeFor] = React.useState<string | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  async function setActive(id: string, active: boolean) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/tax-jurisdictions/${id}/active`, { method: "POST", body: { active } });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Settings" to="/settings" />} title="Tax rates & jurisdictions" description="Jurisdictions and their effective-dated tax codes (TVA/WHT/IS…) read by account determination." action={<Button onClick={() => setCreateOpen(true)}>New jurisdiction</Button>} />
      <HubTabs />

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
        <EmptyState title="No jurisdictions yet" hint="Create one to start adding tax codes." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Country</TH>
              <TH>Name</TH>
              <TH>Currency</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const id = String(r.jurisdiction_id);
              const active = r.is_active !== false;
              const isOpen = expandedId === id;
              return (
                <React.Fragment key={id}>
                  <TR>
                    <TD className="text-sm font-medium">{smartCell(r.country_code)}</TD>
                    <TD className="text-sm">{smartCell(r.name)}</TD>
                    <TD className="text-sm">{smartCell(r.currency)}</TD>
                    <TD className="text-sm">
                      {active ? (
                        <Pill tone="ok">active</Pill>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">inactive</span>
                      )}
                    </TD>
                    <TD>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setExpandedId(isOpen ? null : id)}>
                          {isOpen ? "Hide codes" : "Codes"}
                        </Button>
                        <Button size="sm" variant={active ? "outline" : "default"} loading={rowBusy === id} onClick={() => setActive(id, !active)}>
                          {active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                  {isOpen && (
                    <TR>
                      <TD colSpan={5}>
                        <CodesPanel jurisdictionId={id} onAddCode={() => setAddCodeFor(id)} />
                      </TD>
                    </TR>
                  )}
                </React.Fragment>
              );
            })}
          </TBody>
        </Table>
      )}

      <NewJurisdictionForm open={createOpen} onClose={() => setCreateOpen(false)} onCreated={reload} />
      <AddCodeForm jurisdictionId={addCodeFor} onClose={() => setAddCodeFor(null)} onAdded={reload} />
    </section>
  );
}
