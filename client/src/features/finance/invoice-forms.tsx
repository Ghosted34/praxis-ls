/**
 * Final-invoice write forms: create draft, submit for approval, edit a draft.
 *
 * Split out of `features/finance/pages.tsx` in Phase 3 (audit F7).
 */
import * as React from "react";
import { amount } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import * as fin from "@/lib/finance-api";
import type { InvoiceLineInput } from "@/lib/finance-api";
import { useOptions, optionLabel, expandInvLines, type InvLine, blankInvLine } from "./shared";
import { DictLineCell } from "./line-picker";

export function InvoiceDraftForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { opts: entities } = useOptions(fin.loadEntities, open);
  const { opts: clients } = useOptions(fin.loadClients, open);
  const { opts: dossiers } = useOptions(fin.loadDossiers, open);
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
        is_disbursement: l.is_disbursement || undefined,
        label: l.label || undefined,
        container_type_ref_id: l.container_type_ref_id || null,
      }));
      await fin.createInvoiceDraft({
        entity_id: entityId,
        client_id: clientId || undefined,
        dossier_id: dossierId || undefined,
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
            <div key={i} className="grid grid-cols-[1fr_8rem_auto_auto] items-start gap-2">
              <DictLineCell
                line={l}
                index={i}
                dossierId={dossierId || null}
                onPick={(id, label) => setLine(i, { dictionary_item_id: id, label, container_type_ref_id: undefined, container_type_label: undefined })}
                onPickMulti={(id, label, _hit, picks) => setLines((ls) => expandInvLines(ls, i, id, label, picks))}
              />
              <Input
                type="number"
                min="0"
                step="0.01"
                className="num text-right"
                placeholder="Amount"
                aria-label={`Amount, line ${i + 1}`}
                value={l.amount}
                onChange={(e) => setLine(i, { amount: e.target.value })}
              />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                <input type="checkbox" checked={l.is_disbursement} onChange={(e) => setLine(i, { is_disbursement: e.target.checked })} />
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

export function InvoiceSubmitForm({
  invoice,
  onClose,
  onSubmitted,
}: {
  invoice: Record<string, unknown> | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [entryDate, setEntryDate] = React.useState(fin.today());
  const [sourceRef, setSourceRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!invoice) return;
    setEntryDate(fin.today());
    setSourceRef(String(invoice.doc_number ?? invoice.ref ?? ""));
    setError(null);
  }, [invoice]);

  const id = invoice ? String(invoice.invoice_id ?? invoice.final_invoice_id ?? invoice.id ?? "") : "";
  const canSubmit = !!id && !!entryDate && !!sourceRef && !busy;
  const [totals, setTotals] = React.useState<Awaited<ReturnType<typeof fin.getInvoiceTotals>> | null>(null);
  React.useEffect(() => {
    if (!id) { setTotals(null); return; }
    let live = true;
    fin.getInvoiceTotals(id, entryDate).then((tt) => { if (live) setTotals(tt); }).catch(() => { if (live) setTotals(null); });
    return () => { live = false; };
  }, [id, entryDate]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await fin.submitInvoice(id, { entry_date: entryDate, source_doc_ref: sourceRef });
      onSubmitted();
      onClose();
    } catch (e) {
      setError(errMsg(e));
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
              <span className="text-muted-foreground">Service (HT)</span><span className="num text-right">{amount(totals.totals.subtotal_ht)}</span>
              <span className="text-muted-foreground">Disbursement (pass-through)</span><span className="num text-right">{amount(totals.totals.disbursement_total)}</span>
              <span className="text-muted-foreground">TVA</span><span className="num text-right">{amount(totals.totals.tax_total)}</span>
              <span className="font-medium text-foreground">Total TTC</span><span className="num text-right font-medium text-primary-ink">{amount(totals.totals.total)}</span>
              {totals.advance_open > 0 && (<><span className="text-muted-foreground">Customer advance to apply</span><span className="num text-right">−{amount(totals.advance_open)}</span></>)}
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

export function InvoiceEditForm({
  invoiceId,
  onClose,
  onSaved,
}: {
  invoiceId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = !!invoiceId;
  const { opts: clients } = useOptions(fin.loadClients, open);

  const [clientId, setClientId] = React.useState("");
  // Read-only here (the edit form does not move an invoice between files), but
  // it is what pre-fills the finder's equipment step from the dossier's boxes.
  const [dossierId, setDossierId] = React.useState("");
  const [lines, setLines] = React.useState<InvLine[]>([blankInvLine()]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!invoiceId) return;
    let live = true;
    setLoading(true);
    setError(null);
    fin.getInvoice(invoiceId)
      .then((inv) => {
        if (!live) return;
        setClientId(inv.client_id ? String(inv.client_id) : "");
        setDossierId(inv.dossier_id ? String(inv.dossier_id) : "");
        const ls = (inv.lines || []).map((l) => ({
          dictionary_item_id: l.dictionary_item_id ? String(l.dictionary_item_id) : "",
          amount: l.line_ht !== undefined && l.line_ht !== null ? String(l.line_ht) : "",
          is_disbursement: !!l.is_disbursement,
          label: l.label ? String(l.label) : "",
          // Read back so a re-save does not silently strip the equipment tag
          // off every line on the draft.
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
        is_disbursement: l.is_disbursement || undefined,
        label: l.label || undefined,
        container_type_ref_id: l.container_type_ref_id || null,
      }));
      await fin.updateInvoiceDraft(invoiceId, {
        client_id: clientId || undefined,
        lines: payloadLines,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
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
              <div key={i} className="grid grid-cols-[1fr_8rem_auto_auto] items-start gap-2">
                <DictLineCell
                  line={l}
                  index={i}
                  dossierId={dossierId || null}
                  onPick={(id, label) => setLine(i, { dictionary_item_id: id, label, container_type_ref_id: undefined, container_type_label: undefined })}
                  onPickMulti={(id, label, _hit, picks) => setLines((ls) => expandInvLines(ls, i, id, label, picks))}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="num text-right"
                  placeholder="Amount"
                  aria-label={`Amount, line ${i + 1}`}
                  value={l.amount}
                  onChange={(e) => setLine(i, { amount: e.target.value })}
                />
                <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  <input type="checkbox" checked={l.is_disbursement} onChange={(e) => setLine(i, { is_disbursement: e.target.checked })} />
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
