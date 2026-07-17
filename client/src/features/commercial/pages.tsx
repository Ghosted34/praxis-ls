/**
 * Commercial group — wired to live endpoints. (FS colleague to verify the
 * finance-side correctness of quotation totals / pricing-variance boundary.)
 *   - QuotationsPage            → MOD-27 /quotations  (feature-gated commercial.quotation)
 *   - MarginSimulationsPage     → MOD-27 /margin-simulations  (preview + persist)
 *   - ExtraChargeSimulationsPage→ MOD-28 /extra-charge-simulations  (demurrage)
 *   - PricingVariancePage       → MOD-27 /pricing-variance  (Sales R/Y/G view + compute)
 *
 * Shared primitives + Pixie-tinted design come from features/sales/ui.tsx.
 * AI panels are gated globally (components/ai-actions.tsx).
 */
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { Row, errMsg, cell, when, fmtMoney, useList, Badge, Chips, MetricTile } from "@/features/sales/ui";

/* ═══════════════════════════════════ QUOTATIONS (MOD-27) ═══════════════════════════════════ */

const QUOTATION_AI: AiAction[] = [
  { label: "Draft quotation", kind: "assist", describe: "Draft a quotation's lines from an opportunity, dossier or costing (human-reviewed before send)." },
  { label: "Send / accept", kind: "write", describe: "Send, reject, expire or accept a quotation (accept can spin a final-invoice draft)." },
];

const QUOTE_FILTERS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "CONVERTED", label: "Converted" },
  { value: "REJECTED", label: "Rejected" },
  { value: "EXPIRED", label: "Expired" },
];

type QLine = { label: string; qty: string; unit_price: string; is_debours: boolean };
const qLineTotal = (l: { qty?: unknown; unit_price?: unknown }) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0);

function EntityOptions({ entities }: { entities: Row[] | null }) {
  return (
    <>
      <option value="">— select —</option>
      {(entities || []).map((en) => (
        <option key={String(en.entity_id)} value={String(en.entity_id)}>
          {en.code ? `${cell(en.code)} · ${cell(en.legal_name)}` : cell(en.legal_name)}
        </option>
      ))}
    </>
  );
}

function QuotationForm({ open, editing, entities, clients, opportunities, onClose, onSaved }: { open: boolean; editing: Row | null; entities: Row[] | null; clients: Row[] | null; opportunities: Row[] | null; onClose: () => void; onSaved: () => void }) {
  const [entityId, setEntityId] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [opportunityId, setOpportunityId] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [quoteModel, setQuoteModel] = React.useState("HT_ON_TOP");
  const [validUntil, setValidUntil] = React.useState("");
  const [marginPercent, setMarginPercent] = React.useState("");
  const [lines, setLines] = React.useState<QLine[]>([]);
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
    setLines(el.length ? el.map((l) => ({ label: cell(l.label) === "—" ? "" : String(l.label), qty: l.qty != null ? String(l.qty) : "1", unit_price: l.unit_price != null ? String(l.unit_price) : "0", is_debours: l.is_debours === true })) : [{ label: "", qty: "1", unit_price: "0", is_debours: false }]);
    setError(null);
  }, [open, editing]);

  const setLine = (i: number, patch: Partial<QLine>) => setLines((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const total = lines.reduce((a, l) => a + qLineTotal(l), 0);

  async function submit() {
    setBusy(true);
    setError(null);
    const cleanLines = lines.filter((l) => l.label.trim()).map((l) => ({ label: l.label.trim(), qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0, is_debours: l.is_debours }));
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
    <Modal open={open} onClose={onClose} title={editing ? "Edit quotation" : "New quotation"} description="A priced offer — lines, VAT model and validity; sent then accepted (MOD-27)." size="xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {!editing && (
            <Field label="Entity" hint="Numbers the quote on send">
              <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                <EntityOptions entities={entities} />
              </Select>
            </Field>
          )}
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— none —</option>
              {(clients || []).map((c) => (
                <option key={String(c.client_id)} value={String(c.client_id)}>
                  {cell(c.name ?? c.legal_name)}
                </option>
              ))}
            </Select>
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
            <Button size="sm" variant="ghost" onClick={() => setLines((l) => [...l, { label: "", qty: "1", unit_price: "0", is_debours: false }])}>
              + Line
            </Button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="Service / description" className="min-w-[8rem] flex-1" />
              <Input type="number" min="0" step="1" className="num w-16 text-right" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder="qty" />
              <Input type="number" min="0" step="1" className="num w-28 text-right" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} placeholder="unit price" />
              <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Pass-through disbursement — never taxed">
                <input type="checkbox" checked={l.is_debours} onChange={(e) => setLine(i, { is_debours: e.target.checked })} />
                débours
              </label>
              <span className="w-28 text-right text-sm text-muted-foreground">{fmtMoney(qLineTotal(l), currency)}</span>
              <Button size="sm" variant="ghost" onClick={() => setLines((rs) => rs.filter((_, idx) => idx !== i))}>
                ✕
              </Button>
            </div>
          ))}
          <div className="flex justify-end pr-10 text-sm font-semibold">Total (HT): {fmtMoney(total, currency)}</div>
          <p className="text-right text-xs text-muted-foreground">VAT is applied server-side to taxed, non-débours lines; totals refresh on save.</p>
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

function QuotationDetail({ quotation, entities, clientName, onClose, onChanged, onEdit }: { quotation: Row | null; entities: Row[] | null; clientName: Map<string, string>; onClose: () => void; onChanged: () => void; onEdit: (q: Row) => void }) {
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
    <Modal open={open} onClose={onClose} title={quotation && quotation.doc_number ? `Quotation ${cell(quotation.doc_number)}` : "Quotation (draft)"} description="Review, then move it through its lifecycle (MOD-27)." size="xl">
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {data === null && !error ? (
          <LoadingRow label="Loading quotation…" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge label={status || "DRAFT"} />
              {data?.client_id ? <span className="text-xs text-muted-foreground">{clientName.get(String(data.client_id)) ?? "Client"}</span> : null}
              {data?.valid_until ? <span className="text-xs text-muted-foreground">valid until {when(data.valid_until)}</span> : null}
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
                    <span className="w-24 text-right">{fmtMoney(l.unit_price, data?.currency)}</span>
                    <span className="w-28 text-right">{fmtMoney(qLineTotal(l), data?.currency)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col items-end gap-0.5 text-sm">
              <span className="text-muted-foreground">Total HT: {fmtMoney(data?.total_ht, data?.currency)}</span>
              <span className="font-semibold">Total TTC: {fmtMoney(data?.total_ttc, data?.currency)}</span>
            </div>

            {action === "send" && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <Field label="Entity" hint="Numbers the quotation on send" required>
                  <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                    <EntityOptions entities={entities} />
                  </Select>
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

export function QuotationsPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/quotations", nonce);
  const { rows: entities } = useList("/entities", nonce);
  const { rows: clients } = useList("/clients", nonce);
  const { rows: opportunities } = useList("/opportunities", nonce);
  const [filter, setFilter] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [detail, setDetail] = React.useState<Row | null>(null);

  const clientName = React.useMemo(() => new Map((clients || []).map((c) => [String(c.client_id), cell(c.name ?? c.legal_name)])), [clients]);
  const filtered = React.useMemo(() => (rows || []).filter((r) => !filter || String(r.status) === filter), [rows, filter]);
  const gated = error && /feature|not enabled|disabled/i.test(error);

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Quotations</h1>
          <p className="mt-1 text-sm text-muted-foreground">Priced offers between opportunity and invoice — draft, send, accept (MOD-27).</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          New quotation
        </Button>
      </header>

      <div className="mb-4">
        <Chips value={filter} options={QUOTE_FILTERS} onChange={setFilter} />
      </div>

      {error ? (
        gated ? (
          <EmptyState title="Quotations aren't enabled for this tenant" hint="The commercial.quotation feature flag is off. Enable it in the developer dashboard to use quotations." />
        ) : (
          <ErrorState message={error} />
        )
      ) : rows === null ? (
        <LoadingRow label="Loading quotations…" />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length ? "No quotations match" : "No quotations yet"} hint={rows.length ? "Try another filter." : "Draft your first quotation."} />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <button key={String(r.quotation_id)} type="button" onClick={() => setDetail(r)} className="lux-card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-primary/40">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{r.doc_number ? `№ ${cell(r.doc_number)}` : "Draft"}</p>
                  <Badge label={String(r.status || "DRAFT")} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {r.client_id ? clientName.get(String(r.client_id)) ?? "Client" : "No client"} · {when(r.created_at)}
                </p>
              </div>
              <span className="text-sm font-semibold text-foreground">{fmtMoney(r.total_ttc ?? r.total_ht, r.currency)}</span>
            </button>
          ))}
        </div>
      )}

      <AiActions actions={QUOTATION_AI} />

      <QuotationForm open={formOpen} editing={editing} entities={entities} clients={clients} opportunities={opportunities} onClose={() => setFormOpen(false)} onSaved={reload} />
      <QuotationDetail
        quotation={detail}
        entities={entities}
        clientName={clientName}
        onClose={() => setDetail(null)}
        onChanged={reload}
        onEdit={(q) => {
          setDetail(null);
          setEditing(q);
          setFormOpen(true);
        }}
      />
    </section>
  );
}

/* ═══════════════════════════════ MARGIN SIMULATION (MOD-27) ═══════════════════════════════ */

const MARGIN_AI: AiAction[] = [
  { label: "Suggest pricing", kind: "assist", describe: "Suggest unit prices to hit a target margin on the service lines." },
];

type MLine = { label: string; qty: string; unit_cost: string; unit_price: string; is_debours: boolean };

function MarginSimForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [currency, setCurrency] = React.useState("XAF");
  const [lines, setLines] = React.useState<MLine[]>([{ label: "", qty: "1", unit_cost: "0", unit_price: "0", is_debours: false }]);
  const [totals, setTotals] = React.useState<Row | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCurrency("XAF");
    setLines([{ label: "", qty: "1", unit_cost: "0", unit_price: "0", is_debours: false }]);
    setTotals(null);
    setError(null);
  }, [open]);

  const setLine = (i: number, patch: Partial<MLine>) => setLines((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const payloadLines = () => lines.filter((l) => l.label.trim() || Number(l.unit_price) || Number(l.unit_cost)).map((l) => ({ label: l.label.trim() || "Line", qty: Number(l.qty) || 1, unit_cost: Number(l.unit_cost) || 0, unit_price: Number(l.unit_price) || 0, is_debours: l.is_debours }));

  async function preview() {
    setPreviewing(true);
    setError(null);
    try {
      const t = await tenant<Row>("/margin-simulations/preview", { method: "POST", body: { lines: payloadLines() } });
      setTotals(t);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPreviewing(false);
    }
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/margin-simulations", { method: "POST", body: { currency: currency.trim().toUpperCase() || "XAF", lines: payloadLines() } });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Margin simulation" description="Rapid quote maths — margin on services only, débours pass-through. No GL (MOD-27, KB §6.7)." size="xl">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Lines</p>
            <Button size="sm" variant="ghost" onClick={() => setLines((l) => [...l, { label: "", qty: "1", unit_cost: "0", unit_price: "0", is_debours: false }])}>
              + Line
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_3rem_6rem_6rem_auto_auto] gap-2 text-xs font-medium text-muted-foreground">
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit cost</span>
            <span className="text-right">Unit price</span>
            <span>déb.</span>
            <span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_3rem_6rem_6rem_auto_auto] items-center gap-2">
              <Input value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder="Service" />
              <Input type="number" min="0" className="num text-right" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
              <Input type="number" min="0" className="num text-right" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} />
              <Input type="number" min="0" className="num text-right" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} />
              <input type="checkbox" checked={l.is_debours} onChange={(e) => setLine(i, { is_debours: e.target.checked })} aria-label="débours" />
              <Button size="sm" variant="ghost" onClick={() => setLines((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))}>
                ✕
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={preview} loading={previewing}>
            Preview
          </Button>
          <div className="w-24">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} placeholder="XAF" />
          </div>
        </div>

        {totals && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile label="Total cost" value={fmtMoney(totals.total_cost, currency)} />
            <MetricTile label="Total price" value={fmtMoney(totals.total_price, currency)} />
            <MetricTile label="Margin" value={fmtMoney(totals.margin_amount, currency)} accent />
            <MetricTile label="Margin %" value={totals.margin_percent != null ? `${cell(totals.margin_percent)}%` : "—"} accent />
          </div>
        )}

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save simulation
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function MarginSimulationsPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/margin-simulations", nonce);
  const [formOpen, setFormOpen] = React.useState(false);

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Margin simulation</h1>
          <p className="mt-1 text-sm text-muted-foreground">What-if quote maths — margin on services only, no accounting entries (MOD-27).</p>
        </div>
        <Button onClick={() => setFormOpen(true)}>New simulation</Button>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow label="Loading simulations…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No simulations yet" hint="Run a margin simulation to price a service package before quoting." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={String(r.margin_simulation_id)} className="lux-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{when(r.created_at)}</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{r.margin_percent != null ? `${cell(r.margin_percent)}%` : "—"}</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-foreground">{fmtMoney(r.total_price, r.currency)}</p>
              <p className="text-xs text-muted-foreground">cost {fmtMoney(r.total_cost, r.currency)}</p>
            </div>
          ))}
        </div>
      )}

      <AiActions actions={MARGIN_AI} />
      <MarginSimForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={reload} />
    </section>
  );
}

/* ═══════════════════════════ EXTRA-CHARGE / DEMURRAGE SIMULATION (MOD-28) ═══════════════════════════ */

const EXTRA_AI: AiAction[] = [
  { label: "Explain the charge", kind: "assist", describe: "Explain a demurrage estimate — which days fall in which tier and why." },
];

type Tier = { from_day: string; to_day: string; rate: string };

function ExtraSimForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [shippingLine, setShippingLine] = React.useState("");
  const [variant, setVariant] = React.useState("");
  const [freeDays, setFreeDays] = React.useState("0");
  const [occupiedDays, setOccupiedDays] = React.useState("0");
  const [currency, setCurrency] = React.useState("XAF");
  const [tiers, setTiers] = React.useState<Tier[]>([{ from_day: "1", to_day: "", rate: "0" }]);
  const [computed, setComputed] = React.useState<Row | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setShippingLine("");
    setVariant("");
    setFreeDays("0");
    setOccupiedDays("0");
    setCurrency("XAF");
    setTiers([{ from_day: "1", to_day: "", rate: "0" }]);
    setComputed(null);
    setError(null);
  }, [open]);

  const setTier = (i: number, patch: Partial<Tier>) => setTiers((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  function body(): Record<string, unknown> {
    return {
      shipping_line: shippingLine.trim() || undefined,
      container_variant: variant.trim() || undefined,
      free_days: Number(freeDays) || 0,
      occupied_days: Number(occupiedDays) || 0,
      currency: currency.trim().toUpperCase() || "XAF",
      tiers: tiers
        .filter((t) => t.from_day && t.rate)
        .map((t) => ({ from_day: Number(t.from_day), to_day: t.to_day === "" ? null : Number(t.to_day), rate: Number(t.rate) })),
    };
  }

  async function preview() {
    setPreviewing(true);
    setError(null);
    try {
      const c = await tenant<Row>("/extra-charge-simulations/preview", { method: "POST", body: body() });
      setComputed(c);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPreviewing(false);
    }
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/extra-charge-simulations", { method: "POST", body: body() });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const breakdown = (computed?.breakdown as Row[] | undefined) || [];

  return (
    <Modal open={open} onClose={onClose} title="Demurrage / extra-charge simulation" description="Per-day charge beyond the free period, from a tiered tariff. No GL (MOD-28)." size="xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Shipping line">
            <Input value={shippingLine} onChange={(e) => setShippingLine(e.target.value)} placeholder="Maersk" />
          </Field>
          <Field label="Container variant">
            <Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="40HC" />
          </Field>
          <Field label="Free days">
            <Input type="number" min="0" className="num text-right" value={freeDays} onChange={(e) => setFreeDays(e.target.value)} />
          </Field>
          <Field label="Occupied days">
            <Input type="number" min="0" className="num text-right" value={occupiedDays} onChange={(e) => setOccupiedDays(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Tariff tiers <span className="text-xs text-muted-foreground">(day ranges after the free period; blank “to” = open-ended)</span></p>
            <Button size="sm" variant="ghost" onClick={() => setTiers((t) => [...t, { from_day: "", to_day: "", rate: "0" }])}>
              + Tier
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground">
            <span>From day</span>
            <span>To day</span>
            <span>Rate / day</span>
            <span />
          </div>
          {tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
              <Input type="number" min="1" className="num text-right" value={t.from_day} onChange={(e) => setTier(i, { from_day: e.target.value })} />
              <Input type="number" min="1" className="num text-right" value={t.to_day} onChange={(e) => setTier(i, { to_day: e.target.value })} placeholder="∞" />
              <Input type="number" min="0" className="num text-right" value={t.rate} onChange={(e) => setTier(i, { rate: e.target.value })} />
              <Button size="sm" variant="ghost" onClick={() => setTiers((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))}>
                ✕
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={preview} loading={previewing}>
            Preview
          </Button>
          <div className="w-24">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} placeholder="XAF" />
          </div>
        </div>

        {computed && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-3">
              <MetricTile label="Chargeable days" value={String(computed.chargeable_days ?? "—")} />
              <MetricTile label="Free days" value={String(computed.free_days ?? "—")} />
              <MetricTile label="Total" value={fmtMoney(computed.total_amount, currency)} accent />
            </div>
            {breakdown.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border text-sm">
                {breakdown.map((b) => (
                  <div key={String(b.day)} className="flex justify-between border-b px-3 py-1 last:border-0">
                    <span className="text-muted-foreground">Day {cell(b.day)}</span>
                    <span>{fmtMoney(b.rate, currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save simulation
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ExtraChargeSimulationsPage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/extra-charge-simulations", nonce);
  const [formOpen, setFormOpen] = React.useState(false);

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Extra-charge simulation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Demurrage / detention estimates from a tiered tariff — no accounting entries (MOD-28).</p>
        </div>
        <Button onClick={() => setFormOpen(true)}>New simulation</Button>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow label="Loading simulations…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No simulations yet" hint="Estimate a demurrage charge before it lands on a dossier." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <div key={String(r.extra_charge_simulation_id)} className="lux-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{cell(r.shipping_line) === "—" ? "Demurrage" : cell(r.shipping_line)}</span>
                <span className="text-xs text-muted-foreground">{when(r.created_at)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{cell(r.container_variant)} · {r.free_days != null ? `${cell(r.free_days)} free days` : "—"}</p>
              <p className="mt-2 text-sm font-semibold text-primary">{fmtMoney(r.total_amount, r.currency)}</p>
            </div>
          ))}
        </div>
      )}

      <AiActions actions={EXTRA_AI} />
      <ExtraSimForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={reload} />
    </section>
  );
}

/* ═══════════════════════════════ PRICING VARIANCE (MOD-27) ═══════════════════════════════ */

const PV_AI: AiAction[] = [
  { label: "Flag at-risk dossiers", kind: "assist", describe: "Summarise dossiers whose pricing variance is amber/red and why." },
];

const PV_FILTERS = [
  { value: "", label: "All" },
  { value: "GREEN", label: "Green" },
  { value: "YELLOW", label: "Yellow" },
  { value: "RED", label: "Red" },
];

function ComputeVarianceModal({ open, dossiers, quotations, onClose, onDone }: { open: boolean; dossiers: Row[] | null; quotations: Row[] | null; onClose: () => void; onDone: () => void }) {
  const [dossierId, setDossierId] = React.useState("");
  const [quotationId, setQuotationId] = React.useState("");
  const [quotedPrice, setQuotedPrice] = React.useState("");
  const [actualCost, setActualCost] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDossierId("");
    setQuotationId("");
    setQuotedPrice("");
    setActualCost("");
    setError(null);
  }, [open]);

  async function submit() {
    if (!dossierId) {
      setError("Choose a dossier.");
      return;
    }
    if (!quotationId && !quotedPrice) {
      setError("Provide a quotation or a quoted price.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await tenant("/pricing-variance/compute", {
        method: "POST",
        body: {
          dossier_id: dossierId,
          quotation_id: quotationId || undefined,
          quoted_price: quotedPrice === "" ? undefined : Number(quotedPrice),
          actual_cost: actualCost === "" ? undefined : Number(actualCost),
        },
      });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Compute pricing variance" description="Quote vs actual cost → a R/Y/G flag. Actual cost stays finance-only (MOD-27).">
      <div className="space-y-4">
        <Field label="Dossier" required>
          <Select value={dossierId} onChange={(e) => setDossierId(e.target.value)}>
            <option value="">— select —</option>
            {(dossiers || []).map((d) => (
              <option key={String(d.dossier_id)} value={String(d.dossier_id)}>
                {cell(d.reference ?? d.title ?? d.dossier_id)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quotation" hint="Supplies the quoted price (or enter one below)">
          <Select value={quotationId} onChange={(e) => setQuotationId(e.target.value)}>
            <option value="">— none —</option>
            {(quotations || []).map((q) => (
              <option key={String(q.quotation_id)} value={String(q.quotation_id)}>
                {q.doc_number ? `№ ${cell(q.doc_number)}` : `Draft · ${fmtMoney(q.total_ht, q.currency)}`}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quoted price" hint="Override">
            <Input type="number" min="0" className="num text-right" value={quotedPrice} onChange={(e) => setQuotedPrice(e.target.value)} />
          </Field>
          <Field label="Actual cost" hint="Finance-only; blank = from cost entries">
            <Input type="number" min="0" className="num text-right" value={actualCost} onChange={(e) => setActualCost(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Compute
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function PricingVariancePage() {
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/pricing-variance", nonce);
  const { rows: dossiers } = useList("/operations", nonce);
  const { rows: quotations } = useList("/quotations", nonce);
  const [filter, setFilter] = React.useState("");
  const [computeOpen, setComputeOpen] = React.useState(false);

  const filtered = React.useMemo(() => (rows || []).filter((r) => !filter || String(r.flag) === filter), [rows, filter]);
  const dossierRef = React.useMemo(() => new Map((dossiers || []).map((d) => [String(d.dossier_id), cell(d.reference ?? d.title ?? d.dossier_id)])), [dossiers]);

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Pricing variance</h1>
          <p className="mt-1 text-sm text-muted-foreground">Quote vs actual cost as a red/yellow/green flag. Raw cost stays finance-only (MOD-27).</p>
        </div>
        <Button onClick={() => setComputeOpen(true)}>Compute variance</Button>
      </header>

      <div className="mb-4">
        <Chips value={filter} options={PV_FILTERS} onChange={setFilter} />
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow label="Loading variance index…" />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length ? "No rows match" : "No variance computed yet"} hint={rows.length ? "Try another flag." : "Compute variance for a dossier to see its R/Y/G flag."} />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div key={String(r.pricing_variance_id)} className="lux-card flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{dossierRef.get(String(r.dossier_id)) ?? `Dossier ${String(r.dossier_id).slice(0, 8)}`}</p>
                  <Badge label={String(r.flag || "—")} />
                </div>
                <p className="truncate text-xs text-muted-foreground">Computed {when(r.computed_at)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-foreground">{r.variance_percent != null ? `${cell(r.variance_percent)}%` : "—"}</p>
                <p className="text-xs text-muted-foreground">quote {fmtMoney(r.quoted_price)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <AiActions actions={PV_AI} />
      <ComputeVarianceModal open={computeOpen} dossiers={dossiers} quotations={quotations} onClose={() => setComputeOpen(false)} onDone={reload} />
    </section>
  );
}
