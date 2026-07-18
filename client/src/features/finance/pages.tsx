/** Finance screens — Phase 1 accounting spine + the asset register. Read surfaces
 *  (lists + computed statement/tax reports) plus the write forms that post to the
 *  ledger: journal entries, customer advances, and the final-invoice lifecycle. */
import * as React from "react";
import { Link } from "react-router-dom";
import { tenant, ApiError } from "@/lib/api-client";
import { ResourceList } from "@/components/resource-list";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { Modal, Field, Select } from "@/components/ui/modal";
import { SearchSelect } from "@/features/sales/ui";
import {
  loadEntities,
  loadClients,
  loadDossiers,
  loadDictionaryItems,
  loadPostableAccounts,
  postJournalEntry,
  payAdvance,
  createInvoiceDraft,
  submitInvoice,
  getInvoiceTotals,
  getInvoice,
  updateInvoiceDraft,
  reverseJournalEntry,
  listPeriods,
  closePeriod,
  today,
  TAX_KINDS,
  listDeclarations,
  fileDeclaration,
  approveDeclaration,
  submitDeclaration,
  loadFinalInvoices,
  listCreditNotes,
  getCreditNote,
  createCreditNote,
  updateCreditNote,
  postCreditNote,
  type Option,
  type JournalLineInput,
  type InvoiceLineInput,
  type Period,
  type TaxKind,
  type TaxDeclaration,
  type CreditNote,
  type CreditNoteLineInput,
} from "@/lib/finance-api";

/* ── shared helpers ─────────────────────────────────────────────── */

/** Load a set of options once when `enabled` flips true (i.e. a form opens). */
function useOptions(loader: () => Promise<Option[]>, enabled: boolean) {
  const [opts, setOpts] = React.useState<Option[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    loader()
      .then((o) => live && setOpts(o))
      .catch(() => live && setErr("Couldn't load options."));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return { opts, err };
}

function optionLabel(o: Option) {
  return o.extra ? `${o.extra} — ${o.label}` : o.label;
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "You don't have permission to do this.";
    if (e.status === 422 && e.details && typeof e.details === "object") {
      const parts = Object.entries(e.details as Record<string, string[]>).map(
        ([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`,
      );
      if (parts.length) return parts.join("; ");
    }
    return e.message;
  }
  return "Something went wrong. Try again.";
}

const money = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ── Journals: post a manual journal entry ──────────────────────── */

type LineRow = { account_code: string; debit: string; credit: string };
const blankLine = (): LineRow => ({ account_code: "", debit: "", credit: "" });

function JournalEntryForm({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: () => void }) {
  const { opts: entities } = useOptions(loadEntities, open);
  const { opts: accounts } = useOptions(loadPostableAccounts, open);

  const [entityId, setEntityId] = React.useState("");
  const [journalCode, setJournalCode] = React.useState("");
  const [entryDate, setEntryDate] = React.useState(today());
  const [description, setDescription] = React.useState("");
  const [sourceRef, setSourceRef] = React.useState("");
  const [validate, setValidate] = React.useState(false);
  const [lines, setLines] = React.useState<LineRow[]>([blankLine(), blankLine()]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    // reset each time it opens
    setEntityId("");
    setJournalCode("");
    setEntryDate(today());
    setDescription("");
    setSourceRef("");
    setValidate(false);
    setLines([blankLine(), blankLine()]);
    setError(null);
  }, [open]);

  const num = (s: string) => (s.trim() === "" ? 0 : Number(s));
  const totalDebit = lines.reduce((s, l) => s + (num(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (num(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;
  const linesValid = lines.every((l) => l.account_code && (num(l.debit) > 0 || num(l.credit) > 0));
  const canSubmit = !!entityId && !!journalCode && !!entryDate && !!sourceRef && balanced && linesValid && !busy;

  const setLine = (i: number, patch: Partial<LineRow>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payloadLines: JournalLineInput[] = lines.map((l) => {
        const d = num(l.debit);
        const c = num(l.credit);
        return { account_code: l.account_code, ...(d > 0 ? { debit: d } : {}), ...(c > 0 ? { credit: c } : {}) };
      });
      await postJournalEntry({
        entity_id: entityId,
        journal_code: journalCode,
        entry_date: entryDate,
        description: description || undefined,
        source_doc_ref: sourceRef,
        validate,
        lines: payloadLines,
      });
      onPosted();
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Post journal entry" description="Balanced-or-rejected. Validating locks the entry (reversal-not-edit)." size="xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">Select entity…</option>
              {entities.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Journal" required hint="OHADA journal code (e.g. VT, AC, BQ, PAIE, OD).">
            <Input list="journal-codes" value={journalCode} onChange={(e) => setJournalCode(e.target.value)} placeholder="VT" />
            <datalist id="journal-codes">
              <option value="VT">Ventes</option>
              <option value="AC">Achats</option>
              <option value="BQ">Banque</option>
              <option value="PAIE">Paie</option>
              <option value="OD">Opérations diverses</option>
            </datalist>
          </Field>
          <Field label="Entry date" required>
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Source document ref" required hint="Mandatory — the ledger rejects entries without a source ref.">
            <Input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder="INV-2026-0001" />
          </Field>
        </div>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Narrative (optional)" />
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Lines</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}>
              + Add line
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_7rem_7rem_auto] gap-2">
                <Select value={l.account_code} onChange={(e) => setLine(i, { account_code: e.target.value })}>
                  <option value="">Account…</option>
                  {accounts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="num text-right"
                  placeholder="Debit"
                  value={l.debit}
                  onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="num text-right"
                  placeholder="Credit"
                  value={l.credit}
                  onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={lines.length <= 2}
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  aria-label="Remove line"
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t pt-2 text-sm">
            <span className={balanced ? "text-muted-foreground" : "font-medium text-destructive"}>
              {balanced ? "Balanced" : `Out of balance by ${money(Math.abs(totalDebit - totalCredit))}`}
            </span>
            <span className="num tabular-nums text-muted-foreground">
              Dr {money(totalDebit)} &nbsp;·&nbsp; Cr {money(totalCredit)}
            </span>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={validate} onChange={(e) => setValidate(e.target.checked)} />
          Validate immediately (locks the entry; otherwise saved as a draft)
        </label>

        {error && <ErrorState message={error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            {validate ? "Validate & post" : "Save draft"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function JournalReverseForm({
  entry,
  onClose,
  onReversed,
}: {
  entry: Record<string, unknown> | null;
  onClose: () => void;
  onReversed: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [entryDate, setEntryDate] = React.useState(today());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!entry) return;
    setReason("");
    setEntryDate(today());
    setError(null);
  }, [entry]);

  const id = entry ? String(entry.entry_id ?? entry.id ?? "") : "";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await reverseJournalEntry(id, { reason: reason || undefined, entry_date: entryDate || undefined });
      onReversed();
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const label = entry ? String(entry.description ?? entry.source_doc_ref ?? id) : "";

  return (
    <Modal open={!!entry} onClose={onClose} title="Reverse entry" description="Posts a linked contra entry (reversal-not-edit); the original stays immutable.">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Reversing <span className="font-medium text-foreground">{label}</span>.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reversal date" required hint="Date the contra entry posts on.">
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it's being reversed" />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} loading={busy} disabled={!id || !entryDate || busy}>
            Reverse entry
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const JOURNAL_COLS = [
  { key: "entry_no", label: "No." },
  { key: "entry_date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "source_doc_ref", label: "Source ref" },
  { key: "status", label: "Status" },
];

export function JournalsPage() {
  const [rows, setRows] = React.useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [postOpen, setPostOpen] = React.useState(false);
  const [reverseTarget, setReverseTarget] = React.useState<Record<string, unknown> | null>(null);
  const reload = () => setNonce((n) => n + 1);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    tenant<Record<string, unknown>[]>("/journal-entries")
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403) setError("You don't have permission to view this.");
        else setError(e instanceof ApiError ? e.message : "Failed to load.");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const isValidated = (r: Record<string, unknown>) => String(r.status ?? "").toLowerCase() === "validated";
  const isReversal = (r: Record<string, unknown>) => !!r.corrects_entry_id;

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Journals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            General ledger journal entries — balanced-or-rejected, reversal-not-edit.
            General ledger journal entries — balanced-or-rejected, reversal-not-edit.
          </p>
        </div>
        <Button onClick={() => setPostOpen(true)}>Post entry</Button>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow />
      ) : rows.length === 0 ? (
        <EmptyState title="No entries yet" hint="Post a journal entry to get started." />
      ) : (
        <Table>
          <THead>
            <TR>
              {JOURNAL_COLS.map((c) => (
                <TH key={c.key}>{c.label}</TH>
              ))}
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={i}>
                {JOURNAL_COLS.map((c) => (
                  <TD key={c.key} className="text-sm">
                    {fmtCell(r[c.key])}
                    {c.key === "description" && isReversal(r) && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">reversal</span>
                    )}
                  </TD>
                ))}
                <TD>
                  {isValidated(r) && !isReversal(r) ? (
                    <Button size="sm" variant="outline" onClick={() => setReverseTarget(r)}>
                      Reverse
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <JournalEntryForm open={postOpen} onClose={() => setPostOpen(false)} onPosted={reload} />
      <JournalReverseForm entry={reverseTarget} onClose={() => setReverseTarget(null)} onReversed={reload} />
    </section>
  );
}

/* ── Proforma advances: record a customer advance ───────────────── */

function AdvancePaymentForm({ open, onClose, onPaid }: { open: boolean; onClose: () => void; onPaid: () => void }) {
  const { opts: entities } = useOptions(loadEntities, open);
  const { opts: clients } = useOptions(loadClients, open);
  const { opts: accounts } = useOptions(loadPostableAccounts, open);
  const { opts: dossiers } = useOptions(loadDossiers, open);

  const [entityId, setEntityId] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [dossierId, setDossierId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [treasuryCoa, setTreasuryCoa] = React.useState("");
  const [entryDate, setEntryDate] = React.useState(today());
  const [sourceRef, setSourceRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId("");
    setClientId("");
    setDossierId("");
    setAmount("");
    setTreasuryCoa("");
    setEntryDate(today());
    setSourceRef("");
    setError(null);
  }, [open]);

  const amt = amount.trim() === "" ? 0 : Number(amount);
  const canSubmit = !!entityId && amt > 0 && !!entryDate && !!sourceRef && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await payAdvance({
        entity_id: entityId,
        client_id: clientId || undefined,
        dossier_id: dossierId || undefined,
        amount: amt,
        treasury_coa: treasuryCoa || undefined,
        entry_date: entryDate,
        source_doc_ref: sourceRef,
      });
      onPaid();
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record customer advance" description="Posts the advance to 4191 (customer advances), not revenue." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">Select entity…</option>
              {entities.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select client…</option>
              {clients.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dossier" hint="Links this to an operation file — sets service type and matches advances.">
            <Select value={dossierId} onChange={(e) => setDossierId(e.target.value)}>
              <option value="">No dossier</option>
              {dossiers.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" required>
            <Input type="number" min="0" step="0.01" className="num text-right" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Treasury account" hint="Bank / cash / mobile-money account that received the funds.">
            <Select value={treasuryCoa} onChange={(e) => setTreasuryCoa(e.target.value)}>
              <option value="">Default treasury account</option>
              {accounts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Entry date" required>
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Source document ref" required>
            <Input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder="ADV-2026-0001" />
          </Field>
        </div>

        {error && <ErrorState message={error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Record advance
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export const ProformasPage = () => {
  const [open, setOpen] = React.useState(false);
  return (
    <ResourceList
      title="Proforma & advances"
      description="Advance payments received against a proforma — posts to 4191 (customer advances), not revenue. Priced offers with line items live in Quotations."
      endpoint="/proformas/advances"
      action={(reload) => (
        <div className="flex items-center gap-3">
          <Link to="/commercial/quotations" className="text-sm text-muted-foreground transition-colors hover:text-primary">View quotations →</Link>
          <Button onClick={() => setOpen(true)}>Record advance</Button>
          <AdvancePaymentForm open={open} onClose={() => setOpen(false)} onPaid={reload} />
        </div>
      )}
    />
  );
};

/* ── Final invoices: create draft + submit lifecycle ────────────── */

type InvLine = { dictionary_item_id: string; amount: string; is_debours: boolean; label: string };
const blankInvLine = (): InvLine => ({ dictionary_item_id: "", amount: "", is_debours: false, label: "" });

function InvoiceDraftForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { opts: entities } = useOptions(loadEntities, open);
  const { opts: clients } = useOptions(loadClients, open);
  const { opts: items } = useOptions(loadDictionaryItems, open);

  const { opts: dossiers } = useOptions(loadDossiers, open);
  const [entityId, setEntityId] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [dossierId, setDossierId] = React.useState("");
  const [lines, setLines] = React.useState<InvLine[]>([blankInvLine()]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId("");
    setClientId("");
    setDossierId("");
    setLines([blankInvLine()]);
    setError(null);
  }, [open]);

  const setLine = (i: number, patch: Partial<InvLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const filled = lines.filter((l) => l.dictionary_item_id && Number(l.amount) > 0);
  const canSubmit = !!entityId && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payloadLines: InvoiceLineInput[] = filled.map((l) => ({
        dictionary_item_id: l.dictionary_item_id,
        amount: Number(l.amount),
        is_debours: l.is_debours || undefined,
        label: l.label || undefined,
      }));
      await createInvoiceDraft({
        entity_id: entityId,
        client_id: clientId || undefined,
        dossier_id: dossierId || undefined,
        lines: payloadLines.length ? payloadLines : undefined,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New invoice draft" description="Create a draft; add lines now or later, then submit to recognise revenue." size="xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">Select entity…</option>
              {entities.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select client…</option>
              {clients.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dossier" hint="Links this to an operation file — sets service type and matches advances.">
            <Select value={dossierId} onChange={(e) => setDossierId(e.target.value)}>
              <option value="">No dossier</option>
              {dossiers.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Lines (optional)</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankInvLine()])}>
              + Add line
            </Button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_8rem_auto_auto] items-center gap-2">
              <Select value={l.dictionary_item_id} onChange={(e) => setLine(i, { dictionary_item_id: e.target.value })}>
                <option value="">Dictionary item…</option>
                {items.map((o) => (
                  <option key={o.id} value={o.id}>
                    {optionLabel(o)}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min="0"
                step="0.01"
                className="num text-right"
                placeholder="Amount"
                value={l.amount}
                onChange={(e) => setLine(i, { amount: e.target.value })}
              />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                <input type="checkbox" checked={l.is_debours} onChange={(e) => setLine(i, { is_debours: e.target.checked })} />
                débours
              </label>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={lines.length <= 1}
                onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                aria-label="Remove line"
              >
                ✕
              </Button>
            </div>
          ))}
        </div>

        {error && <ErrorState message={error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Create draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function InvoiceSubmitForm({
  invoice,
  onClose,
  onSubmitted,
}: {
  invoice: Record<string, unknown> | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [entryDate, setEntryDate] = React.useState(today());
  const [sourceRef, setSourceRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!invoice) return;
    setEntryDate(today());
    setSourceRef(String(invoice.doc_number ?? invoice.ref ?? ""));
    setError(null);
  }, [invoice]);

  const id = invoice ? String(invoice.invoice_id ?? invoice.final_invoice_id ?? invoice.id ?? "") : "";
  const canSubmit = !!id && !!entryDate && !!sourceRef && !busy;
  const [totals, setTotals] = React.useState<Awaited<ReturnType<typeof getInvoiceTotals>> | null>(null);
  React.useEffect(() => {
    if (!id) { setTotals(null); return; }
    let live = true;
    getInvoiceTotals(id, entryDate).then((tt) => { if (live) setTotals(tt); }).catch(() => { if (live) setTotals(null); });
    return () => { live = false; };
  }, [id, entryDate]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await submitInvoice(id, { entry_date: entryDate, source_doc_ref: sourceRef });
      onSubmitted();
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!invoice} onClose={onClose} title="Submit invoice" description="Recognises revenue, clears the advance and débours, and posts to the ledger.">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Posting date" required>
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Source document ref" required>
            <Input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder="INV-2026-0001" />
          </Field>
        </div>
        {totals && (
          <div className="rounded-lg border border-border bg-card/40 p-3 text-sm">
            <div className="micro mb-2 uppercase tracking-wide">Computed before posting</div>
            <div className="grid grid-cols-2 gap-y-1">
              <span className="text-muted-foreground">Service (HT)</span><span className="num text-right">{money(totals.totals.subtotal_ht)}</span>
              <span className="text-muted-foreground">Débours (pass-through)</span><span className="num text-right">{money(totals.totals.debours_total)}</span>
              <span className="text-muted-foreground">TVA</span><span className="num text-right">{money(totals.totals.tax_total)}</span>
              <span className="font-medium text-foreground">Total TTC</span><span className="num text-right font-medium text-[rgb(var(--primary))]">{money(totals.totals.total)}</span>
              {totals.advance_open > 0 && (<><span className="text-muted-foreground">Customer advance to apply</span><span className="num text-right">−{money(totals.advance_open)}</span></>)}
            </div>
          </div>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Submit invoice
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function InvoiceEditForm({
  invoiceId,
  onClose,
  onSaved,
}: {
  invoiceId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = !!invoiceId;
  const { opts: clients } = useOptions(loadClients, open);
  const { opts: items } = useOptions(loadDictionaryItems, open);

  const [clientId, setClientId] = React.useState("");
  const [lines, setLines] = React.useState<InvLine[]>([blankInvLine()]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!invoiceId) return;
    let live = true;
    setLoading(true);
    setError(null);
    getInvoice(invoiceId)
      .then((inv) => {
        if (!live) return;
        setClientId(inv.client_id ? String(inv.client_id) : "");
        const ls = (inv.lines || []).map((l) => ({
          dictionary_item_id: l.dictionary_item_id ? String(l.dictionary_item_id) : "",
          amount: l.line_ht !== undefined && l.line_ht !== null ? String(l.line_ht) : "",
          is_debours: !!l.is_debours,
          label: l.label ? String(l.label) : "",
        }));
        setLines(ls.length ? ls : [blankInvLine()]);
      })
      .catch((e) => live && setError(errMessage(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [invoiceId]);

  const setLine = (i: number, patch: Partial<InvLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function submit() {
    if (!invoiceId) return;
    setBusy(true);
    setError(null);
    try {
      const filled = lines.filter((l) => l.dictionary_item_id && Number(l.amount) > 0);
      const payloadLines: InvoiceLineInput[] = filled.map((l) => ({
        dictionary_item_id: l.dictionary_item_id,
        amount: Number(l.amount),
        is_debours: l.is_debours || undefined,
        label: l.label || undefined,
      }));
      await updateInvoiceDraft(invoiceId, {
        client_id: clientId || undefined,
        lines: payloadLines,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit invoice draft" description="Update the client and lines. Only DRAFT invoices can be edited." size="xl">
      {loading ? (
        <LoadingRow label="Loading invoice…" />
      ) : (
        <div className="space-y-4">
          <Field label="Client" className="sm:max-w-sm">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client</option>
              {clients.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Lines</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankInvLine()])}>
                + Add line
              </Button>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto_auto] items-center gap-2">
                <Select value={l.dictionary_item_id} onChange={(e) => setLine(i, { dictionary_item_id: e.target.value })}>
                  <option value="">Dictionary item…</option>
                  {items.map((o) => (
                    <option key={o.id} value={o.id}>
                      {optionLabel(o)}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="num text-right"
                  placeholder="Amount"
                  value={l.amount}
                  onChange={(e) => setLine(i, { amount: e.target.value })}
                />
                <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  <input type="checkbox" checked={l.is_debours} onChange={(e) => setLine(i, { is_debours: e.target.checked })} />
                  débours
                </label>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={lines.length <= 1}
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  aria-label="Remove line"
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>

          {error && <ErrorState message={error} />}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} disabled={busy}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const INVOICE_COLS = [
  { key: "doc_number", label: "Number" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "total_ttc", label: "Total TTC" },
  { key: "created_at", label: "Created" },
];

function invField(r: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k];
  return null;
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function InvoicesPage() {
  const [rows, setRows] = React.useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [draftOpen, setDraftOpen] = React.useState(false);
  const [submitTarget, setSubmitTarget] = React.useState<Record<string, unknown> | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const reload = () => setNonce((n) => n + 1);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    tenant<Record<string, unknown>[]>("/final-invoices")
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403) setError("You don't have permission to view this.");
        else setError(e instanceof ApiError ? e.message : "Failed to load.");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const isDraft = (r: Record<string, unknown>) => {
    const s = String(invField(r, ["status", "state"]) ?? "").toUpperCase();
    return s === "" || s === "DRAFT";
  };

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Final invoices — revenue recognition, clears advance + débours.
          </p>
        </div>
        <Button onClick={() => setDraftOpen(true)}>New draft</Button>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow />
      ) : rows.length === 0 ? (
        <EmptyState title="No invoices yet" hint="Create a draft to get started." />
      ) : (
        <Table>
          <THead>
            <TR>
              {INVOICE_COLS.map((c) => (
                <TH key={c.key}>{c.label}</TH>
              ))}
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={i}>
                <TD className="text-sm">{fmtCell(invField(r, ["doc_number", "ref"]) ?? "— (draft)")}</TD>
                <TD className="text-sm">{fmtCell(invField(r, ["type"]))}</TD>
                <TD className="text-sm">{fmtCell(invField(r, ["status", "state"]))}</TD>
                <TD className="num text-sm">{fmtCell(invField(r, ["total_ttc", "total", "amount_ttc"]))}</TD>
                <TD className="text-sm">{fmtCell(invField(r, ["created_at", "issued_on"]))}</TD>
                <TD>
                  {isDraft(r) ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditId(String(invField(r, ["invoice_id", "id"]) ?? ""))}
                      >
                        Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setSubmitTarget(r)}>
                        Submit
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <InvoiceDraftForm open={draftOpen} onClose={() => setDraftOpen(false)} onCreated={reload} />
      <InvoiceSubmitForm invoice={submitTarget} onClose={() => setSubmitTarget(null)} onSubmitted={reload} />
      <InvoiceEditForm invoiceId={editId} onClose={() => setEditId(null)} onSaved={reload} />
    </section>
  );
}

/* ── plain read-only surfaces ───────────────────────────────────── */

export const ReceivablesPage = () => (
  <ResourceList
    title="Receivables"
    description="Smart receivables ledger — open items, ageing and reminders."
    endpoint="/receivables"
  />
);

export const ChartOfAccountsPage = () => (
  <ResourceList
    title="Chart of accounts"
    description="SYSCOHADA/OHADA chart — hierarchical, is_postable / requires_analytic."
    endpoint="/chart-of-accounts"
  />
);

export const AssetsPage = () => (
  <ResourceList
    title="Assets"
    description="Fixed-asset register with depreciation schedule, period posting and disposal."
    endpoint="/assets"
    columns={[
      { key: "label", label: "Asset" },
      { key: "tag", label: "Tag" },
      { key: "acquisition_cost", label: "Cost" },
      { key: "method", label: "Method" },
      { key: "status", label: "Status" },
      { key: "acquired_on", label: "Acquired" },
    ]}
  />
);

/* ── report viewer with period filters ──────────────────────────── */
function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Report({ data }: { data: unknown }) {
  if (Array.isArray(data)) {
    if (data.length === 0) return <EmptyState title="Nothing to show" hint="The report returned no rows." />;
    const cols = Object.keys(data[0] as Record<string, unknown>).slice(0, 8);
    return (
      <Table>
        <THead>
          <TR>
            {cols.map((c) => (
              <TH key={c}>{c.replace(/_/g, " ")}</TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {(data as Record<string, unknown>[]).map((r, i) => (
            <TR key={i}>
              {cols.map((c) => (
                <TD key={c} className="num text-sm">
                  {fmt(r[c])}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    );
  }
  const entries = data && typeof data === "object" ? Object.entries(data as Record<string, unknown>) : [];
  if (entries.length === 0) return <EmptyState title="No data" hint="The report returned nothing for this period." />;
  return (
    <div className="lux-card divide-y">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 px-5 py-3">
          <span className="text-sm text-muted-foreground">{k.replace(/_/g, " ")}</span>
          <span className="num text-sm font-medium">{fmt(v)}</span>
        </div>
      ))}
    </div>
  );
}

type Params = { entity_id: string; period_code: string; period_id: string; from: string; to: string };
const EMPTY_PARAMS: Params = { entity_id: "", period_code: "", period_id: "", from: "", to: "" };

function toQuery(p: Params): string {
  const qs = new URLSearchParams();
  if (p.entity_id) qs.set("entity_id", p.entity_id);
  // Statements key on period_id; tax reports on period_code — send whichever is set.
  if (p.period_id) qs.set("period_id", p.period_id);
  if (p.period_code) qs.set("period_code", p.period_code);
  if (p.from) qs.set("from", p.from);
  if (p.to) qs.set("to", p.to);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/* Guided monthly close: list accounting periods, freeze/close the open ones. */
function PeriodStatusPill({ status }: { status: string }) {
  const s = status.toUpperCase();
  const tone =
    s === "OPEN"
      ? "bg-primary/10 text-primary"
      : s === "FROZEN"
        ? "bg-[rgb(var(--warn)/0.15)] text-[rgb(var(--warn))]"
        : "bg-muted text-muted-foreground";
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>{s}</span>;
}

function PeriodsPanel() {
  const [periods, setPeriods] = React.useState<Period[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [pending, setPending] = React.useState<{ period: Period; to: "FROZEN" | "CLOSED" } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const reload = () => setNonce((n) => n + 1);

  React.useEffect(() => {
    let live = true;
    setPeriods(null);
    setError(null);
    listPeriods()
      .then((d) => live && setPeriods(d.periods || []))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403) setError("You don't have permission to view accounting periods.");
        else setError(e instanceof ApiError ? e.message : "Failed to load periods.");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      await closePeriod({ period_id: pending.period.period_id, to: pending.to });
      setPending(null);
      reload();
    } catch (e) {
      setActionError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error ? (
        <ErrorState message={error} />
      ) : periods === null ? (
        <LoadingRow label="Loading periods…" />
      ) : periods.length === 0 ? (
        <EmptyState title="No accounting periods" hint="Periods are provisioned per entity fiscal calendar." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Period</TH>
              <TH>Start</TH>
              <TH>End</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {periods.map((p) => {
              const s = String(p.status).toUpperCase();
              return (
                <TR key={p.period_id}>
                  <TD className="text-sm font-medium">{p.code}</TD>
                  <TD className="text-sm">{p.starts_on ?? "—"}</TD>
                  <TD className="text-sm">{p.ends_on ?? "—"}</TD>
                  <TD>
                    <PeriodStatusPill status={s} />
                  </TD>
                  <TD>
                    <div className="flex gap-2">
                      {s === "OPEN" && (
                        <Button size="sm" variant="outline" onClick={() => setPending({ period: p, to: "FROZEN" })}>
                          Freeze
                        </Button>
                      )}
                      {(s === "OPEN" || s === "FROZEN") && (
                        <Button size="sm" variant="destructive" onClick={() => setPending({ period: p, to: "CLOSED" })}>
                          Close
                        </Button>
                      )}
                      {s === "CLOSED" && <span className="text-xs text-muted-foreground">locked</span>}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <Modal
        open={!!pending}
        onClose={() => !busy && setPending(null)}
        title={pending?.to === "CLOSED" ? "Close period" : "Freeze period"}
        description={
          pending?.to === "CLOSED"
            ? "Closing locks the period — no further entries can post to it. Requires a balanced trial balance."
            : "Freezing soft-locks the period; it can still be closed afterwards."
        }
      >
        <div className="space-y-4">
          <p className="text-sm">
            {pending?.to === "CLOSED" ? "Close" : "Freeze"} period{" "}
            <span className="font-medium">{pending?.period.code}</span>?
          </p>
          {actionError && <ErrorState message={actionError} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={pending?.to === "CLOSED" ? "destructive" : "default"}
              onClick={confirm}
              loading={busy}
            >
              {pending?.to === "CLOSED" ? "Close period" : "Freeze period"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

type Tab = { key: string; label: string; path?: string; render?: () => React.ReactNode };

function ReportTabs({
  title,
  description,
  tabs,
  periodMode = "period_code",
}: {
  title: string;
  description: string;
  tabs: Tab[];
  /** Statements bind on `period_id` (dropdown from /statements/periods); tax on `period_code`. */
  periodMode?: "period_code" | "period_id";
}) {
  const [active, setActive] = React.useState(tabs[0].key);
  const [data, setData] = React.useState<unknown>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  // draft holds the input values; `params` is the applied set that actually fetches
  const [draft, setDraft] = React.useState<Params>(EMPTY_PARAMS);
  const [params, setParams] = React.useState<Params>(EMPTY_PARAMS);
  const { opts: entities } = useOptions(loadEntities, true);

  // Period dropdown for statement-mode: loaded once, filtered by the chosen entity.
  const [periods, setPeriods] = React.useState<Period[]>([]);
  React.useEffect(() => {
    if (periodMode !== "period_id") return;
    let live = true;
    listPeriods()
      .then((d) => live && setPeriods(d.periods || []))
      .catch(() => {
        /* dropdown just stays empty; from/to still work */
      });
    return () => {
      live = false;
    };
  }, [periodMode]);
  const periodOptions = periods.filter((p) => !draft.entity_id || !p.entity_id || p.entity_id === draft.entity_id);

  const activeTab = tabs.find((t) => t.key === active)!;
  const isCustom = !!activeTab.render;
  const path = (activeTab.path ?? "") + toQuery(params);

  React.useEffect(() => {
    if (isCustom || !activeTab.path) return; // custom-render tabs fetch nothing
    let live = true;
    setLoading(true);
    setError(null);
    setData(null);
    tenant<unknown>(path)
      .then((d) => live && setData(d))
      .catch((err) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 403) setError("You don't have permission to view this.");
        else setError(err instanceof ApiError ? err.message : "Failed to load.");
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, isCustom, activeTab.path]);

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5">
        <h1 className="font-display text-2xl tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={
              "border-b-2 px-3 py-2 text-sm transition-colors " +
              (active === t.key
                ? "border-[rgb(var(--brand-orange))] font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {isCustom ? (
        activeTab.render!()
      ) : (
        <>
          <div className="lux-card mb-4 flex flex-wrap items-end gap-3 p-4">
            <Field label="Entity" className="min-w-[12rem]">
              <Select value={draft.entity_id} onChange={(e) => setDraft({ ...draft, entity_id: e.target.value })}>
                <option value="">All entities</option>
                {entities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {optionLabel(o)}
                  </option>
                ))}
              </Select>
            </Field>
            {periodMode === "period_id" ? (
              <Field label="Period" className="min-w-[11rem]">
                <Select value={draft.period_id} onChange={(e) => setDraft({ ...draft, period_id: e.target.value })}>
                  <option value="">All periods</option>
                  {periodOptions.map((p) => (
                    <option key={p.period_id} value={p.period_id}>
                      {p.code}
                      {p.status ? ` (${String(p.status).toLowerCase()})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Period code" hint="YYYY or YYYY-MM" className="w-32">
                <Input value={draft.period_code} onChange={(e) => setDraft({ ...draft, period_code: e.target.value })} placeholder="2026-06" />
              </Field>
            )}
            <Field label="From" className="w-40">
              <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </Field>
            <Field label="To" className="w-40">
              <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <Button onClick={() => setParams(draft)} loading={loading}>
                Apply
              </Button>
              {(params.entity_id || params.period_code || params.period_id || params.from || params.to) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraft(EMPTY_PARAMS);
                    setParams(EMPTY_PARAMS);
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {error ? <ErrorState message={error} /> : loading ? <LoadingRow /> : <Report data={data} />}
        </>
      )}
    </section>
  );
}

export const StatementsPage = () => (
  <ReportTabs
    title="Statements"
    description="SYSCOHADA financial statements, general ledger and the guided monthly close."
    periodMode="period_id"
    tabs={[
      { key: "tb", label: "Trial balance", path: "/statements/trial-balance" },
      { key: "is", label: "Compte de résultat", path: "/statements/income-statement" },
      { key: "bs", label: "Bilan", path: "/statements/balance-sheet" },
      { key: "gl", label: "Grand livre", path: "/statements/grand-livre" },
      { key: "cf", label: "Cash flow", path: "/statements/cash-flow" },
      { key: "notes", label: "Notes", path: "/statements/notes" },
      { key: "periods", label: "Periods / close", render: () => <PeriodsPanel /> },
    ]}
  />
);

/* ── tax filing workflow: persist a computed return, approve, submit ── */
function DeclStatusPill({ status }: { status: string }) {
  const s = status.toUpperCase();
  const tone =
    s === "FILED"
      ? "bg-primary/10 text-primary"
      : s === "APPROVED"
        ? "bg-[rgb(var(--ok)/0.15)] text-[rgb(var(--ok))]"
        : s === "COMPUTED"
          ? "bg-[rgb(var(--warn)/0.15)] text-[rgb(var(--warn))]"
          : "bg-muted text-muted-foreground";
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>{s || "DRAFT"}</span>;
}

function FileDeclarationForm({ open, onClose, onFiled }: { open: boolean; onClose: () => void; onFiled: () => void }) {
  const { opts: entities } = useOptions(loadEntities, open);
  const [entityId, setEntityId] = React.useState("");
  const [kind, setKind] = React.useState<TaxKind>("TVA");
  const [periodCode, setPeriodCode] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [dueOn, setDueOn] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId("");
    setKind("TVA");
    setPeriodCode("");
    setFrom("");
    setTo("");
    setDueOn("");
    setError(null);
  }, [open]);

  const validPeriod = /^\d{4}(-\d{2})?$/.test(periodCode);
  const canSubmit = validPeriod && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await fileDeclaration({
        entity_id: entityId || undefined,
        kind,
        period_code: periodCode,
        from: from || undefined,
        to: to || undefined,
        due_on: dueOn || undefined,
      });
      onFiled();
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="File a return" description="Persists the GL-computed return as a declaration (DRAFT/COMPUTED), then approve and submit." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" hint="Leave blank for all entities">
            <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              <option value="">All entities</option>
              {entities.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Return type" required>
            <Select value={kind} onChange={(e) => setKind(e.target.value as TaxKind)}>
              {TAX_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period code" hint="YYYY or YYYY-MM" required error={periodCode && !validPeriod ? "Use YYYY or YYYY-MM" : undefined}>
            <Input value={periodCode} onChange={(e) => setPeriodCode(e.target.value)} placeholder="2026-06" />
          </Field>
          <Field label="Due on">
            <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            File return
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SubmitDeclarationForm({ declaration, onClose, onSubmitted }: { declaration: TaxDeclaration | null; onClose: () => void; onSubmitted: () => void }) {
  const [filedRef, setFiledRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!declaration) return;
    setFiledRef(String(declaration.filed_ref ?? ""));
    setError(null);
  }, [declaration]);

  async function submit() {
    if (!declaration) return;
    setBusy(true);
    setError(null);
    try {
      await submitDeclaration(String(declaration.declaration_id), { filed_ref: filedRef || undefined });
      onSubmitted();
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!declaration} onClose={onClose} title="Submit declaration" description="Marks the return FILED with the tax authority's acknowledgement reference.">
      <div className="space-y-4">
        <Field label="Filed reference" hint="Receipt / acknowledgement number from the tax portal">
          <Input value={filedRef} onChange={(e) => setFiledRef(e.target.value)} placeholder="DGI-2026-…" />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={busy}>
            Mark filed
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeclarationsPanel() {
  const [rows, setRows] = React.useState<TaxDeclaration[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [fileOpen, setFileOpen] = React.useState(false);
  const [submitTarget, setSubmitTarget] = React.useState<TaxDeclaration | null>(null);
  const [approvingId, setApprovingId] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const reload = () => setNonce((n) => n + 1);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    listDeclarations()
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403) setError("You don't have permission to view declarations.");
        else setError(e instanceof ApiError ? e.message : "Failed to load declarations.");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  async function approve(id: string) {
    setApprovingId(id);
    setRowError(null);
    try {
      await approveDeclaration(id);
      reload();
    } catch (e) {
      setRowError(errMessage(e));
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setFileOpen(true)}>File a return</Button>
      </div>

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow label="Loading declarations…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No declarations yet" hint="File a computed return to start the filing workflow." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Type</TH>
              <TH>Period</TH>
              <TH>Amount</TH>
              <TH>Due</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const s = String(r.status ?? "").toUpperCase();
              const id = String(r.declaration_id);
              return (
                <TR key={id}>
                  <TD className="text-sm font-medium">{String(r.kind ?? "—")}</TD>
                  <TD className="text-sm">{String(r.period_code ?? "—")}</TD>
                  <TD className="num text-sm">{fmt(r.amount)}</TD>
                  <TD className="text-sm">{r.due_on ?? "—"}</TD>
                  <TD>
                    <DeclStatusPill status={s} />
                  </TD>
                  <TD>
                    <div className="flex gap-2">
                      {(s === "COMPUTED" || s === "DRAFT") && (
                        <Button size="sm" variant="outline" loading={approvingId === id} onClick={() => approve(id)}>
                          Approve
                        </Button>
                      )}
                      {s === "APPROVED" && (
                        <Button size="sm" onClick={() => setSubmitTarget(r)}>
                          Submit
                        </Button>
                      )}
                      {s === "FILED" && (
                        <span className="text-xs text-muted-foreground">{r.filed_ref ? `filed · ${r.filed_ref}` : "filed"}</span>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <FileDeclarationForm open={fileOpen} onClose={() => setFileOpen(false)} onFiled={reload} />
      <SubmitDeclarationForm declaration={submitTarget} onClose={() => setSubmitTarget(null)} onSubmitted={reload} />
    </div>
  );
}

export const TaxCenterPage = () => (
  <ReportTabs
    title="Tax center"
    description="OHADA/Cameroon tax outputs."
    tabs={[
      { key: "vat", label: "TVA return", path: "/tax/vat-return" },
      { key: "is", label: "Corporate tax", path: "/tax/corporate-tax" },
      { key: "declarations", label: "Declarations / filing", render: () => <DeclarationsPanel /> },
    ]}
  />
);

/* ── credit notes: create → edit → post ─────────────────── */
function cnPayloadLines(lines: InvLine[]): CreditNoteLineInput[] {
  return lines
    .filter((l) => l.label.trim() && Number(l.amount) >= 0 && l.amount !== "")
    .map((l) => ({
      label: l.label.trim(),
      amount: Number(l.amount),
      dictionary_item_id: l.dictionary_item_id || undefined,
      is_debours: l.is_debours || undefined,
    }));
}

function CreditNoteLines({ lines, setLines, items }: { lines: InvLine[]; setLines: React.Dispatch<React.SetStateAction<InvLine[]>>; items: Option[] }) {
  const setLine = (i: number, patch: Partial<InvLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Lines</span>
        <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankInvLine()])}>
          + Add line
        </Button>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_8rem_auto_auto] items-center gap-2">
          <Input placeholder="Label (required)" value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} />
          <Select value={l.dictionary_item_id} onChange={(e) => setLine(i, { dictionary_item_id: e.target.value })}>
            <option value="">Dictionary item…</option>
            {items.map((o) => (
              <option key={o.id} value={o.id}>
                {optionLabel(o)}
              </option>
            ))}
          </Select>
          <Input type="number" min="0" step="0.01" className="num text-right" placeholder="Amount" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            <input type="checkbox" checked={l.is_debours} onChange={(e) => setLine(i, { is_debours: e.target.checked })} />
            débours
          </label>
          <Button type="button" size="icon" variant="ghost" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Remove line">
            ✕
          </Button>
        </div>
      ))}
    </div>
  );
}

function CreditNoteCreateForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { opts: entities } = useOptions(loadEntities, open);
  const { opts: clients } = useOptions(loadClients, open);
  const { opts: items } = useOptions(loadDictionaryItems, open);
  const { opts: invoices } = useOptions(loadFinalInvoices, open);

  const [entityId, setEntityId] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [reversesInvoiceId, setReversesInvoiceId] = React.useState("");
  const [lines, setLines] = React.useState<InvLine[]>([blankInvLine()]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId("");
    setClientId("");
    setReversesInvoiceId("");
    setLines([blankInvLine()]);
    setError(null);
  }, [open]);

  const canSubmit = !!entityId && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payloadLines = cnPayloadLines(lines);
      await createCreditNote({
        entity_id: entityId,
        client_id: clientId || undefined,
        reverses_invoice_id: reversesInvoiceId || undefined,
        lines: payloadLines.length ? payloadLines : undefined,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const entityLabel = (() => { const o = entities.find((x) => x.id === entityId); return o ? optionLabel(o) : null; })();
  const clientLabel = (() => { const o = clients.find((x) => x.id === clientId); return o ? optionLabel(o) : null; })();
  const invoiceLabel = (() => { const o = invoices.find((x) => x.id === reversesInvoiceId); return o ? optionLabel(o) : null; })();

  return (
    <Modal open={open} onClose={onClose} title="New credit note" description="Reverses a finalised invoice; create a draft, then post to the ledger." size="xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <SearchSelect
              path="/entities"
              value={entityLabel}
              placeholder="Search entities…"
              getLabel={(r) => (r.code ? `${String(r.code)} — ${String(r.legal_name ?? r.entity_id)}` : String(r.legal_name ?? r.entity_id))}
              getKey={(r) => String(r.entity_id)}
              onSelect={(r) => setEntityId(String(r.entity_id))}
            />
          </Field>
          <Field label="Client">
            <SearchSelect
              path="/clients"
              value={clientLabel}
              placeholder="Search clients…"
              getLabel={(r) => (r.ref ? `${String(r.ref)} — ${String(r.name ?? r.client_id)}` : String(r.name ?? r.client_id))}
              getKey={(r) => String(r.client_id)}
              onSelect={(r) => setClientId(String(r.client_id))}
            />
          </Field>
          <Field label="Reverses invoice" hint="Finalised invoice this note credits" className="sm:col-span-2">
            <SearchSelect
              path="/final-invoices"
              value={invoiceLabel}
              placeholder="Search finalised invoices…"
              filter={(r) => String(r.status ?? r.state ?? "").toUpperCase() === "FINAL"}
              getLabel={(r) => String(r.doc_number ?? r.ref ?? r.invoice_id ?? r.final_invoice_id ?? "")}
              getKey={(r) => String(r.invoice_id ?? r.final_invoice_id ?? r.id)}
              onSelect={(r) => setReversesInvoiceId(String(r.invoice_id ?? r.final_invoice_id ?? r.id))}
            />
          </Field>
        </div>

        <CreditNoteLines lines={lines} setLines={setLines} items={items} />

        {error && <ErrorState message={error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Create draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CreditNoteEditForm({ creditNoteId, onClose, onSaved }: { creditNoteId: string | null; onClose: () => void; onSaved: () => void }) {
  const open = !!creditNoteId;
  const { opts: clients } = useOptions(loadClients, open);
  const { opts: items } = useOptions(loadDictionaryItems, open);
  const { opts: invoices } = useOptions(loadFinalInvoices, open);

  const [clientId, setClientId] = React.useState("");
  const [reversesInvoiceId, setReversesInvoiceId] = React.useState("");
  const [lines, setLines] = React.useState<InvLine[]>([blankInvLine()]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!creditNoteId) return;
    let live = true;
    setLoading(true);
    setError(null);
    getCreditNote(creditNoteId)
      .then((cn) => {
        if (!live) return;
        setClientId(cn.client_id ? String(cn.client_id) : "");
        setReversesInvoiceId(cn.reverses_invoice_id ? String(cn.reverses_invoice_id) : "");
        const ls = (cn.lines || []).map((l) => ({
          dictionary_item_id: l.dictionary_item_id ? String(l.dictionary_item_id) : "",
          amount: l.amount != null ? String(l.amount) : l.line_ht != null ? String(l.line_ht) : "",
          is_debours: !!l.is_debours,
          label: l.label ? String(l.label) : "",
        }));
        setLines(ls.length ? ls : [blankInvLine()]);
      })
      .catch((e) => live && setError(errMessage(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [creditNoteId]);

  async function submit() {
    if (!creditNoteId) return;
    setBusy(true);
    setError(null);
    try {
      await updateCreditNote(creditNoteId, {
        client_id: clientId || undefined,
        reverses_invoice_id: reversesInvoiceId || undefined,
        lines: cnPayloadLines(lines),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const clientLabel = (() => { const o = clients.find((x) => x.id === clientId); return o ? optionLabel(o) : null; })();
  const invoiceLabel = (() => { const o = invoices.find((x) => x.id === reversesInvoiceId); return o ? optionLabel(o) : null; })();

  return (
    <Modal open={open} onClose={onClose} title="Edit credit note" description="Update the client, reversed invoice and lines. Only drafts can be edited." size="xl">
      {loading ? (
        <LoadingRow label="Loading credit note…" />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client">
              <SearchSelect
                path="/clients"
                value={clientLabel}
                placeholder="Search clients…"
                getLabel={(r) => (r.ref ? `${String(r.ref)} — ${String(r.name ?? r.client_id)}` : String(r.name ?? r.client_id))}
                getKey={(r) => String(r.client_id)}
                onSelect={(r) => setClientId(String(r.client_id))}
              />
            </Field>
            <Field label="Reverses invoice">
              <SearchSelect
                path="/final-invoices"
                value={invoiceLabel}
                placeholder="Search finalised invoices…"
                filter={(r) => String(r.status ?? r.state ?? "").toUpperCase() === "FINAL"}
                getLabel={(r) => String(r.doc_number ?? r.ref ?? r.invoice_id ?? r.final_invoice_id ?? "")}
                getKey={(r) => String(r.invoice_id ?? r.final_invoice_id ?? r.id)}
                onSelect={(r) => setReversesInvoiceId(String(r.invoice_id ?? r.final_invoice_id ?? r.id))}
              />
            </Field>
          </div>

          <CreditNoteLines lines={lines} setLines={setLines} items={items} />

          {error && <ErrorState message={error} />}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} disabled={busy}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CreditNotePostForm({ creditNote, onClose, onPosted }: { creditNote: CreditNote | null; onClose: () => void; onPosted: () => void }) {
  const [entryDate, setEntryDate] = React.useState(today());
  const [sourceRef, setSourceRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!creditNote) return;
    setEntryDate(today());
    setSourceRef(String(creditNote.doc_number ?? ""));
    setError(null);
  }, [creditNote]);

  async function submit() {
    if (!creditNote) return;
    setBusy(true);
    setError(null);
    try {
      await postCreditNote(String(creditNote.credit_note_id), {
        entry_date: entryDate || undefined,
        source_doc_ref: sourceRef || undefined,
      });
      onPosted();
      onClose();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!creditNote} onClose={onClose} title="Post credit note" description="Posts the linked contra entry to the ledger and reverses the invoice.">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Posting date">
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Source document ref">
            <Input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder="CN-2026-0001" />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={busy}>
            Post credit note
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CreditNotesPage() {
  const [rows, setRows] = React.useState<CreditNote[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [postTarget, setPostTarget] = React.useState<CreditNote | null>(null);
  const reload = () => setNonce((n) => n + 1);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    listCreditNotes()
      .then((d) => live && setRows(Array.isArray(d) ? d : []))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403) setError("You don't have permission to view this.");
        else setError(e instanceof ApiError ? e.message : "Failed to load.");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const isDraft = (r: CreditNote) => {
    const s = String(r.status ?? "").toUpperCase();
    return s === "" || s === "DRAFT";
  };

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Credit notes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Reverse a finalised invoice — draft, then post the contra entry.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New credit note</Button>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow />
      ) : rows.length === 0 ? (
        <EmptyState title="No credit notes yet" hint="Create one to reverse a finalised invoice." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Number</TH>
              <TH>Status</TH>
              <TH>Total TTC</TH>
              <TH>Created</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={String(r.credit_note_id)}>
                <TD className="text-sm">{fmtCell(r.doc_number ?? "— (draft)")}</TD>
                <TD className="text-sm">{fmtCell(r.status)}</TD>
                <TD className="num text-sm">{fmtCell(r.total_ttc)}</TD>
                <TD className="text-sm">{fmtCell(r.created_at)}</TD>
                <TD>
                  {isDraft(r) ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditId(String(r.credit_note_id))}>
                        Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setPostTarget(r)}>
                        Post
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <CreditNoteCreateForm open={createOpen} onClose={() => setCreateOpen(false)} onCreated={reload} />
      <CreditNoteEditForm creditNoteId={editId} onClose={() => setEditId(null)} onSaved={reload} />
      <CreditNotePostForm creditNote={postTarget} onClose={() => setPostTarget(null)} onPosted={reload} />
    </section>
  );
}
