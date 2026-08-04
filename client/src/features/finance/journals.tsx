/**
 * Journals — post a manual journal entry, and reverse a posted one.
 *
 * Split out of the 2,581-line `features/finance/pages.tsx` in Phase 3 (audit F7:
 * that file held 34 components behind 4 exports, so nothing inside it was
 * reachable, testable or reusable — a sibling screen needing the same
 * journal-line editor had to copy it).
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant, ApiError } from "@/lib/api-client";
import { dateFmt, amount, smartCell } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import * as fin from "@/lib/finance-api";
import type { JournalLineInput } from "@/lib/finance-api";
import { useOptions, optionLabel } from "./shared";

type LineRow = { account_code: string; debit: string; credit: string };
const blankLine = (): LineRow => ({ account_code: "", debit: "", credit: "" });

function JournalEntryForm({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: () => void }) {
  const { opts: entities } = useOptions(fin.loadEntities, open);
  const { opts: accounts } = useOptions(fin.loadPostableAccounts, open);

  const [entityId, setEntityId] = React.useState("");
  const [journalCode, setJournalCode] = React.useState("");
  const [entryDate, setEntryDate] = React.useState(fin.today());
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
    setEntryDate(fin.today());
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
      await fin.postJournalEntry({
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
      setError(errMsg(e));
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
              {balanced ? "Balanced" : `Out of balance by ${amount(Math.abs(totalDebit - totalCredit))}`}
            </span>
            <span className="num tabular-nums text-muted-foreground">
              Dr {amount(totalDebit)} &nbsp;·&nbsp; Cr {amount(totalCredit)}
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
  const [entryDate, setEntryDate] = React.useState(fin.today());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!entry) return;
    setReason("");
    setEntryDate(fin.today());
    setError(null);
  }, [entry]);

  const id = entry ? String(entry.entry_id ?? entry.id ?? "") : "";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await fin.reverseJournalEntry(id, { reason: reason || undefined, entry_date: entryDate || undefined });
      onReversed();
      onClose();
    } catch (e) {
      setError(errMsg(e));
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

  const list = rows ?? [];
  const columns: Column<Record<string, unknown>>[] = [
    ...JOURNAL_COLS.map((c): Column<Record<string, unknown>> => ({
      key: c.key,
      label: c.label,
      render: (r) => (
        <span className="text-sm">
          {c.key === "entry_date" ? dateFmt(r[c.key] as string) : smartCell(r[c.key])}
          {c.key === "description" && isReversal(r) && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">reversal</span>}
        </span>
      ),
    })),
    {
      key: "_a", label: "", render: (r) => (
        isValidated(r) && !isReversal(r)
          ? <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setReverseTarget(r)}>Reverse</Button></div>
          : <span className="text-xs text-muted-foreground">—</span>
      ),
    },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Finance" to="/finance" />}
        title="Journals"
        description="General ledger journal entries — balanced-or-rejected, reversal-not-edit."
        action={<Button onClick={() => setPostOpen(true)}>Post entry</Button>}
      />
      <KpiRow>
        <KpiTile label="Entries" value={String(list.length)} />
        <KpiTile label="Validated" value={String(list.filter(isValidated).length)} />
      </KpiRow>
      <DataList
        columns={columns}
        rows={list}
        loading={rows === null}
        error={error}
        rowKey={(r, i) => String(r.entry_id ?? r.entry_no ?? i)}
        empty={{ title: "No entries yet", hint: "Post a journal entry to get started." }}
      />

      <JournalEntryForm open={postOpen} onClose={() => setPostOpen(false)} onPosted={reload} />
      <JournalReverseForm entry={reverseTarget} onClose={() => setReverseTarget(null)} onReversed={reload} />
    </section>
  );
}
