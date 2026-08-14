/**
 * Commercial — the quotation editor and its detail drawer.
 *
 * Split out of `features/commercial/pages.tsx` (1,056 lines) in Phase 4, audit
 * F7. The editor is the biggest write surface in the module: a quotation
 * carries priced lines, a disbursement flag per line and a tax code per line, and
 * all three drive what the eventual invoice may legally contain.
 */

import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";
import { cell, money } from "@/lib/format";
import { SearchSelect } from "@/components/ui/search-select";
import { listSalesTaxCodes, type TaxCode } from "@/lib/masterdata-api";

export type QLine = { dictionary_item_id: string | null; label: string; qty: string; unit_price: string; is_disbursement: boolean; tax_code_id: string | null };
export const qLineTotal = (l: { qty?: unknown; unit_price?: unknown }) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0);
const blankLine = (): QLine => ({ dictionary_item_id: null, label: "", qty: "1", unit_price: "0", is_disbursement: false, tax_code_id: null });
const taxCodeLabel = (c: TaxCode) => `${c.code}${c.rate_percent != null ? ` · ${c.rate_percent}%` : ""}`;

export function entityText(en: Row): string {
  return en.code ? `${cell(en.code)} · ${cell(en.legal_name)}` : cell(en.legal_name);
}
export function entityLabelOf(entities: Row[] | null, id: string): string | null {
  const en = (entities || []).find((e) => String(e.entity_id) === id);
  return en ? entityText(en) : null;
}

export function QuotationForm({ open, editing, entities, clients, opportunities, onClose, onSaved }: { open: boolean; editing: Row | null; entities: Row[] | null; clients: Row[] | null; opportunities: Row[] | null; onClose: () => void; onSaved: () => void }) {
  const [entityId, setEntityId] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [clientLabel, setClientLabel] = React.useState("");
  const [opportunityId, setOpportunityId] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [quoteModel, setQuoteModel] = React.useState("HT_ON_TOP");
  const [validUntil, setValidUntil] = React.useState("");
  const [marginPercent, setMarginPercent] = React.useState("");
  const [lines, setLines] = React.useState<QLine[]>([]);
  const [taxCodes, setTaxCodes] = React.useState<TaxCode[]>([]);
  // B1 (class E — degraded read). listSalesTaxCodes returns
  // { codes, degraded, failed_jurisdictions } so an empty picker cannot be
  // confused with a working one — a jurisdiction whose /codes endpoint is
  // broken now shows an inline note under the picker instead of silently
  // missing rows. Kept as a boolean here; the failed IDs are for a fuller
  // breakdown if the picker ever needs one.
  const [taxCodesDegraded, setTaxCodesDegraded] = React.useState(false);
  const [taxCodesError, setTaxCodesError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEntityId(editing?.entity_id ? String(editing.entity_id) : "");
    setClientId(editing?.client_id ? String(editing.client_id) : "");
    setOpportunityId(editing?.opportunity_id ? String(editing.opportunity_id) : "");
    setCurrency(editing?.currency ? String(editing.currency) : "XAF");
    setQuoteModel(editing?.quote_model ? String(editing.quote_model) : "HT_ON_TOP");
    setValidUntil(editing?.valid_until ? String(editing.valid_until).slice(0, 10) : "");
    setMarginPercent(editing?.margin_percent != null ? String(editing.margin_percent) : "");
    const el = (editing?.lines as Row[] | undefined) || [];
    setLines(el.length ? el.map((l) => ({ dictionary_item_id: l.dictionary_item_id ? String(l.dictionary_item_id) : null, label: cell(l.label) === "—" ? "" : String(l.label), qty: l.qty != null ? String(l.qty) : "1", unit_price: l.unit_price != null ? String(l.unit_price) : "0", is_disbursement: l.is_disbursement === true, tax_code_id: l.tax_code_id ? String(l.tax_code_id) : null })) : [blankLine()]);
    setError(null);
  }, [open, editing]);

  /**
   * Resolve the client's display label, separately from the form reset above.
   *
   * It used to live inside that effect, which depends on `[open, editing]` only
   * — so the lookup ran against whatever `/clients` had returned at the moment
   * the modal opened. Open the editor before that request lands (the common case
   * on a cold navigation) and the client field renders BLANK on a quotation that
   * definitely has a client, with no way to tell it apart from one that has none.
   *
   * Adding `clients` to the reset effect's deps is the fix the linter suggests
   * and it would be worse: the whole form would reset — wiping every edit in
   * progress — each time the clients list refetched in the background.
   *
   * So it is its own effect, keyed on the two things it actually reads.
   */
  React.useEffect(() => {
    if (!open) return;
    const cm = (clients || []).find((c) => String(c.client_id) === clientId);
    setClientLabel(cm ? String(cm.name ?? cm.legal_name ?? "") : "");
  }, [open, clientId, clients]);

  // Load sales VAT codes once the modal opens (aggregated across jurisdictions).
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setTaxCodesError(null);
    listSalesTaxCodes()
      .then((r) => {
        if (!live) return;
        setTaxCodes(r.codes);
        setTaxCodesDegraded(r.degraded);
      })
      .catch((e) => {
        // B1 — the previous .catch(()=>[]) hid a broken jurisdictions list.
        // Surfacing the message here means an invoice line cannot silently
        // offer zero VAT codes when the tenant is correctly configured.
        if (!live) return;
        setTaxCodes([]);
        setTaxCodesDegraded(true);
        setTaxCodesError(errMsg(e));
      });
    return () => { live = false; };
  }, [open]);

  const setLine = (i: number, patch: Partial<QLine>) => setLines((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const total = lines.reduce((a, l) => a + qLineTotal(l), 0);

  async function submit() {
    setBusy(true);
    setError(null);
    const cleanLines = lines.filter((l) => l.label.trim()).map((l) => ({ dictionary_item_id: l.dictionary_item_id || null, label: l.label.trim(), qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0, is_disbursement: l.is_disbursement, tax_code_id: l.is_disbursement ? null : l.tax_code_id || null }));
    const common: Record<string, unknown> = {
      client_id: clientId || null,
      opportunity_id: opportunityId || null,
      currency: currency.trim().toUpperCase() || "XAF",
      quote_model: quoteModel,
      valid_until: validUntil || null,
      margin_percent: marginPercent === "" ? null : Number(marginPercent),
      lines: cleanLines,
    };
    try {
      if (editing) {
        await tenant(`/quotations/${String(editing.quotation_id)}`, { method: "PATCH", body: common });
      } else {
        await tenant("/quotations", { method: "POST", body: { ...common, entity_id: entityId || null } });
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
    <Modal open={open} onClose={onClose} title={editing ? "Edit quotation" : "New quotation"} description="A priced offer — lines, VAT model and validity; sent then accepted." size="xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {!editing && (
            <Field label="Entity" hint="Numbers the quote on send">
              <SearchSelect
                path="/entities"
                value={entityLabelOf(entities, entityId)}
                placeholder="Search entities…"
                getLabel={entityText}
                getKey={(en) => String(en.entity_id)}
                onSelect={(en) => setEntityId(String(en.entity_id))}
              />
            </Field>
          )}
          <Field label="Client">
            <SearchSelect
              path="/clients"
              value={clientLabel || null}
              placeholder="Search clients…"
              getLabel={(r) => String(r.name ?? r.legal_name ?? "")}
              getKey={(r) => String(r.client_id)}
              onSelect={(r) => {
                setClientId(String(r.client_id));
                setClientLabel(String(r.name ?? r.legal_name ?? ""));
              }}
            />
          </Field>
          <Field label="Opportunity" hint="Optional pipeline link">
            <Select value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
              <option value="">— none —</option>
              {(opportunities || []).map((o) => (
                <option key={String(o.opportunity_id)} value={String(o.opportunity_id)}>
                  {cell(o.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quote model">
            <Select value={quoteModel} onChange={(e) => setQuoteModel(e.target.value)}>
              <option value="HT_ON_TOP">HT + VAT on top</option>
              <option value="TTC">TTC (tax-inclusive)</option>
            </Select>
          </Field>
          <Field label="Currency">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} placeholder="XAF" />
          </Field>
          <Field label="Valid until">
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
          <Field label="Target margin %" hint="Optional">
            <Input type="number" min="0" max="100" step="0.1" className="num text-right" value={marginPercent} onChange={(e) => setMarginPercent(e.target.value)} placeholder="20" />
          </Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Line items</p>
            <Button size="sm" variant="ghost" onClick={() => setLines((l) => [...l, blankLine()])}>
              + Line
            </Button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="rounded-lg border border-border/60 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[10rem] flex-1">
                  <SearchSelect
                    path="/financial-dictionary"
                    value={l.label || null}
                    placeholder="Pick from dictionary or type a description…"
                    getLabel={(r) => `${cell(r.code)} — ${cell(r.label_fr ?? r.label_en)}`}
                    getKey={(r) => String(r.dictionary_item_id)}
                    onSelect={(r) =>
                      setLine(i, {
                        dictionary_item_id: String(r.dictionary_item_id),
                        label: String(r.label_fr ?? r.label_en ?? r.code ?? ""),
                        unit_price: r.default_price != null ? String(r.default_price) : l.unit_price,
                        is_disbursement: r.is_disbursement === true,
                      })
                    }
                    allowFreeText
                    onFreeText={(t) => setLine(i, { label: t, dictionary_item_id: null })}
                  />
                </div>
                <Input type="number" min="0" step="1" className="num w-16 text-right" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="qty" />
                <Input type="number" min="0" step="1" className="num w-28 text-right" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} placeholder="unit price" />
                <span className="w-28 text-right text-sm text-muted-foreground">{money(qLineTotal(l), currency)}</span>
                <Button size="sm" variant="ghost" onClick={() => setLines((rs) => rs.filter((_, idx) => idx !== i))}>
                  ✕
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 pl-1">
                <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Pass-through disbursement — never taxed">
                  <input type="checkbox" checked={l.is_disbursement} onChange={(e) => setLine(i, { is_disbursement: e.target.checked, tax_code_id: e.target.checked ? null : l.tax_code_id })} />
                  débours
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">Tax</span>
                  <Select
                    value={l.tax_code_id ?? ""}
                    disabled={l.is_disbursement}
                    onChange={(e) => setLine(i, { tax_code_id: e.target.value || null })}
                    className="h-8 py-0 text-xs"
                  >
                    <option value="">{l.is_disbursement ? "— untaxed —" : "— no VAT —"}</option>
                    {taxCodes.map((c) => (
                      <option key={c.tax_code_id} value={c.tax_code_id}>
                        {taxCodeLabel(c)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>
          ))}
          {taxCodesDegraded && (
            <p className="text-right text-xs text-[rgb(var(--warn))]">
              {taxCodesError
                ? `VAT codes couldn't load — ${taxCodesError}`
                : "Some jurisdictions couldn't load their VAT codes; the picker above is partial."}
            </p>
          )}
          <div className="flex justify-end pr-10 text-sm font-semibold">Total (HT): {money(total, currency)}</div>
          <p className="text-right text-xs text-muted-foreground">VAT is applied server-side from each line's tax code (débours lines are never taxed); totals refresh on save.</p>
        </div>

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={busy}>
            {editing ? "Save changes" : "Create draft"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
