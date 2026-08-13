/**
 * Credit-note write surfaces: line editor, create, edit and post.
 *
 * Split from `./credit-notes` in Phase 3 (audit F7) so neither file carries a
 * screen and its four forms at once.
 */
import * as React from "react";
import { errMsg } from "@/lib/use-resource";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { SearchSelect } from "@/components/ui/search-select";
import * as fin from "@/lib/finance-api";
import type { CreditNote, CreditNoteLineInput } from "@/lib/finance-api";
import { useOptions, optionLabel, expandInvLines, type InvLine, blankInvLine } from "./shared";
import { DictLineCell } from "./line-picker";

function cnPayloadLines(lines: InvLine[]): CreditNoteLineInput[] {
  return lines
    .filter((l) => l.label.trim() && Number(l.amount) >= 0 && l.amount !== "")
    .map((l) => ({
      label: l.label.trim(),
      amount: Number(l.amount),
      dictionary_item_id: l.dictionary_item_id || undefined,
      is_disbursement: l.is_disbursement || undefined,
      container_type_ref_id: l.container_type_ref_id || null,
    }));
}

function CreditNoteLines({ lines, setLines, dossierId }: { lines: InvLine[]; setLines: React.Dispatch<React.SetStateAction<InvLine[]>>; dossierId?: string | null }) {
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
        <div key={i} className="grid grid-cols-[1fr_1fr_8rem_auto_auto] items-start gap-2">
          <Input placeholder="Label (required)" aria-label={`Label, line ${i + 1}`} value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} />
          {/* Picking a charge fills the label too — it is required here, and the
              catalogue's own wording is the one that keeps grouping honest. */}
          <DictLineCell
            line={l}
            index={i}
            dossierId={dossierId}
            onPick={(id, label) => setLine(i, { dictionary_item_id: id, label: label || l.label, container_type_ref_id: undefined, container_type_label: undefined })}
            onPickMulti={(id, label, _hit, picks) => setLines((ls) => expandInvLines(ls, i, id, label, picks))}
          />
          <Input type="number" min="0" step="0.01" className="num text-right" placeholder="Amount" aria-label={`Amount, line ${i + 1}`} value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            <input type="checkbox" checked={l.is_disbursement} onChange={(e) => setLine(i, { is_disbursement: e.target.checked })} />
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

export function CreditNoteCreateForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { opts: entities } = useOptions(fin.loadEntities, open);
  const { opts: clients } = useOptions(fin.loadClients, open);
  const { opts: invoices } = useOptions(fin.loadFinalInvoices, open);

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
      await fin.createCreditNote({
        entity_id: entityId,
        client_id: clientId || undefined,
        reverses_invoice_id: reversesInvoiceId || undefined,
        lines: payloadLines.length ? payloadLines : undefined,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(errMsg(e));
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

        {/* No dossier on a stand-alone credit note — the equipment step lists
            all active types rather than pre-filling from a file. */}
        <CreditNoteLines lines={lines} setLines={setLines} dossierId={null} />

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

export function CreditNoteEditForm({ creditNoteId, onClose, onSaved }: { creditNoteId: string | null; onClose: () => void; onSaved: () => void }) {
  const open = !!creditNoteId;
  const { opts: clients } = useOptions(fin.loadClients, open);
  const { opts: invoices } = useOptions(fin.loadFinalInvoices, open);

  const [clientId, setClientId] = React.useState("");
  const [dossierId, setDossierId] = React.useState("");
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
    fin.getCreditNote(creditNoteId)
      .then((cn) => {
        if (!live) return;
        setClientId(cn.client_id ? String(cn.client_id) : "");
        setDossierId(cn.dossier_id ? String(cn.dossier_id) : "");
        setReversesInvoiceId(cn.reverses_invoice_id ? String(cn.reverses_invoice_id) : "");
        const ls = (cn.lines || []).map((l) => ({
          dictionary_item_id: l.dictionary_item_id ? String(l.dictionary_item_id) : "",
          amount: l.amount != null ? String(l.amount) : l.line_ht != null ? String(l.line_ht) : "",
          is_disbursement: !!l.is_disbursement,
          label: l.label ? String(l.label) : "",
          // Read back so re-saving a draft does not strip the equipment tag.
          container_type_ref_id: l.container_type_ref_id ? String(l.container_type_ref_id) : undefined,
          container_type_label: l.container_type_en || l.container_type_fr || l.container_type_code || undefined,
        }));
        setLines(ls.length ? ls : [blankInvLine()]);
      })
      .catch((e) => live && setError(errMsg(e)))
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
      await fin.updateCreditNote(creditNoteId, {
        client_id: clientId || undefined,
        reverses_invoice_id: reversesInvoiceId || undefined,
        lines: cnPayloadLines(lines),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
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

          <CreditNoteLines lines={lines} setLines={setLines} dossierId={dossierId || null} />

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

export function CreditNotePostForm({ creditNote, onClose, onPosted }: { creditNote: CreditNote | null; onClose: () => void; onPosted: () => void }) {
  const [entryDate, setEntryDate] = React.useState(fin.today());
  const [sourceRef, setSourceRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!creditNote) return;
    setEntryDate(fin.today());
    setSourceRef(String(creditNote.doc_number ?? ""));
    setError(null);
  }, [creditNote]);

  async function submit() {
    if (!creditNote) return;
    setBusy(true);
    setError(null);
    try {
      await fin.postCreditNote(String(creditNote.credit_note_id), {
        entry_date: entryDate || undefined,
        source_doc_ref: sourceRef || undefined,
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
