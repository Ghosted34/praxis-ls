/**
 * Commercial — the read/act drawer for a single quotation.
 *
 * Split from `quotation-forms.tsx` in Phase 4 (audit F7: no file over 400
 * lines). Separate from the editor for the same reason as Sales' proposal
 * drawer: writing a quotation and driving its lifecycle (send, accept, convert
 * to a dossier) are different jobs opened at different moments.
 */

import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/ui/modal";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";
import { cell, dateFmt, money } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { SearchSelect } from "@/components/ui/search-select";
import { DocButton } from "@/components/doc-button";
import { entityLabelOf, entityText, qLineTotal } from "./quotation-forms";

export function QuotationDetail({ quotation, entities, clientName, onClose, onChanged, onEdit }: { quotation: Row | null; entities: Row[] | null; clientName: Map<string, string>; onClose: () => void; onChanged: () => void; onEdit: (q: Row) => void }) {
  const open = !!quotation;
  const [data, setData] = React.useState<Row | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [action, setAction] = React.useState<null | "send" | "accept">(null);
  const [entityId, setEntityId] = React.useState("");
  const [convert, setConvert] = React.useState(false);

  React.useEffect(() => {
    if (!quotation) return;
    let live = true;
    setData(null);
    setError(null);
    setAction(null);
    setEntityId("");
    setConvert(false);
    tenant<Row>(`/quotations/${String(quotation.quotation_id)}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [quotation]);

  const status = data ? String(data.status) : "";
  const lines = (data?.lines as Row[] | undefined) || [];
  const id = quotation ? String(quotation.quotation_id) : "";

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }
  const transitionTo = (to: string, entity?: string) => run(() => tenant(`/quotations/${id}/transition`, { method: "POST", body: { to, entity_id: entity } }));
  const doAccept = () => run(() => tenant(`/quotations/${id}/accept`, { method: "POST", body: { convert } }));

  return (
    <Modal open={open} onClose={onClose} title={quotation && quotation.doc_number ? `Quotation ${cell(quotation.doc_number)}` : "Quotation (draft)"} description="Review, then move it through its lifecycle." size="xl">
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {data === null && !error ? (
          <LoadingRow label="Loading quotation…" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={status || "DRAFT"} />
              {data?.client_id ? <span className="text-xs text-muted-foreground">{clientName.get(String(data.client_id)) ?? "Client"}</span> : null}
              {data?.valid_until ? <span className="text-xs text-muted-foreground">valid until {dateFmt(data.valid_until)}</span> : null}
              <span className="ml-auto"><DocButton docType="QUOTATION" id={id} title={quotation?.doc_number ? String(quotation.doc_number) : "Quotation"} /></span>
            </div>

            {lines.length > 0 && (
              <div className="rounded-lg border">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Item</span>
                  <span className="w-12 text-right">Qty</span>
                  <span className="w-24 text-right">Unit</span>
                  <span className="w-28 text-right">Total</span>
                </div>
                {lines.map((l) => (
                  <div key={String(l.quotation_line_id)} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-1.5 text-sm">
                    <span>
                      {cell(l.label)}
                      {l.is_debours ? <span className="ml-1 text-xs text-muted-foreground">(débours)</span> : null}
                    </span>
                    <span className="w-12 text-right">{cell(l.qty)}</span>
                    <span className="w-24 text-right">{money(l.unit_price, data?.currency)}</span>
                    <span className="w-28 text-right">{money(qLineTotal(l), data?.currency)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col items-end gap-0.5 text-sm">
              <span className="text-muted-foreground">Total HT: {money(data?.total_ht, data?.currency)}</span>
              <span className="font-semibold">Total TTC: {money(data?.total_ttc, data?.currency)}</span>
            </div>

            {action === "send" && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <Field label="Entity" hint="Numbers the quotation on send" required>
                  <SearchSelect
                    path="/entities"
                    value={entityLabelOf(entities, entityId)}
                    placeholder="Search entities…"
                    getLabel={entityText}
                    getKey={(en) => String(en.entity_id)}
                    onSelect={(en) => setEntityId(String(en.entity_id))}
                  />
                </Field>
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAction(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button size="sm" loading={busy} disabled={!entityId} onClick={() => transitionTo("SENT", entityId)}>
                    Confirm send
                  </Button>
                </div>
              </div>
            )}
            {action === "accept" && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={convert} onChange={(e) => setConvert(e.target.checked)} />
                  Convert to a final-invoice draft
                </label>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAction(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button size="sm" loading={busy} onClick={doAccept}>
                    Confirm accept
                  </Button>
                </div>
              </div>
            )}

            {!action && (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
                {status === "DRAFT" && (
                  <>
                    <Button variant="outline" onClick={() => onEdit(data ?? (quotation as Row))}>
                      Edit
                    </Button>
                    {data?.entity_id ? (
                      <Button loading={busy} onClick={() => transitionTo("SENT")}>
                        Send
                      </Button>
                    ) : (
                      <Button onClick={() => setAction("send")}>Send…</Button>
                    )}
                  </>
                )}
                {status === "SENT" && (
                  <>
                    <Button variant="ghost" loading={busy} onClick={() => transitionTo("EXPIRED")}>
                      Expire
                    </Button>
                    <Button variant="ghost" loading={busy} onClick={() => transitionTo("REJECTED")}>
                      Reject
                    </Button>
                    <Button onClick={() => setAction("accept")}>Accept…</Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
