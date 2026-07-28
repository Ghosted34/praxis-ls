/**
 * DocumentPage — a record shown as its OWN page (route `/documents/:docType/:id`),
 * rendered **natively in the app theme** (cards, dark UI) so it blends — NOT the
 * white print sheet. The white template is what Download/Send produce as the PDF.
 * Data comes from the template preview endpoint (`data`); reports (which have no
 * record shape) fall back to the paper preview.
 */
import * as React from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { tenant } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";
import { errMsg } from "@/lib/use-resource";
import { num, dateFmt, enumLabel } from "@/lib/format";

/** Auth-gated binary fetch of a vaulted document → open the blob in a new tab.
 *  Used when a signed copy has been uploaded (served instead of regenerating). */
async function openVaultDoc(id: string) {
  const token = tokenStore.getAccess();
  const res = await fetch(`/api/tenant/documents/${id}/download`, {
    headers: { "X-Praxis-Env": tokenStore.getEnv(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(res.status === 409 ? "This document hasn't been rendered yet." : "Download failed.");
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const SENDABLE = new Set([
  "FINAL_INVOICE", "PROFORMA_ADVANCE", "QUOTATION", "CREDIT_NOTE", "PAYMENT_RECEIPT",
  "PROPOSAL", "PURCHASE_ORDER", "DELIVERY_NOTE", "TRANSIT_ORDER", "PAYSLIP",
  "EMPLOYMENT_CONTRACT", "DUNNING_LETTER",
]);

type Party = { name?: string; lines?: string[] };
type Line = Record<string, unknown>;
type DocData = {
  number?: string; date?: string; due?: string; valid_until?: string; status?: string;
  period?: string; method?: string; po_ref?: string; original_ref?: string; reason?: string;
  staff_no?: string; supplier?: string; vehicle?: string; driver?: string; location?: string;
  kind?: string; effective_on?: string; end_on?: string; description?: string; qa_status?: string;
  odometer_out?: number; odometer_in?: number; distance?: number | null; origin?: string; destination?: string;
  party?: Party; parties?: Party[]; lines?: Line[]; parts?: Line[]; totals?: Record<string, number>;
  earnings?: Line[]; deductions?: Line[]; gross?: number; total_deductions?: number; net?: number;
  cost?: number; articles?: { title: string; body: string }[];
  amount?: number; sections?: { title: string; body: string }[]; body?: string; headline?: string;
  signed_vault_id?: string | null;
  currency?: string; [k: string]: unknown;
};

const PARTY_LABEL: Record<string, string> = {
  PURCHASE_ORDER: "Supplier", SUPPLIER_INVOICE: "Supplier", EMPLOYMENT_CONTRACT: "Employee",
  PAYSLIP: "Employee", DELIVERY_NOTE: "Consignee", TRIP_SHEET: "Vehicle",
};
type Entity = { legal_name?: string; niu?: string; rccm?: string; address?: string };
type Preview = { html: string; data?: DocData | null; title?: { fr?: string; en?: string }; entity?: Entity; report?: boolean };

/** The issuing entity renders as the "From" party. The preview returns it as
 *  { legal_name, niu, rccm } — map those onto the Party shape PartyCol expects
 *  (name/lines), otherwise "From" shows "—" while the PDF template shows it. */
const fromParty = (e?: Entity): Party | undefined =>
  e ? { name: e.legal_name, lines: [e.niu && `NIU ${e.niu}`, e.rccm && `RCCM ${e.rccm}`].filter(Boolean) as string[] } : undefined;

const money = (n: unknown, ccy = "XAF") => `${Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${ccy}`;
const STATUS_TONE = (s?: string): Tone => {
  const u = String(s || "").toUpperCase();
  if (/PAID|APPLIED|VALIDATED|SIGNED|DONE|DELIVERED|ACCEPTED|LOCKED/.test(u)) return "ok";
  if (/SENT|ISSUED|OUT|OPEN|IN_PROGRESS|SUBMITTED/.test(u)) return "blue";
  if (/REJECT|CANCEL|REVERSED|OVERDUE|FAIL/.test(u)) return "bad";
  if (/DRAFT|HOLD|PENDING/.test(u)) return "mute";
  return "mute";
};

const Card: React.FC<{ title?: string; children: React.ReactNode; action?: React.ReactNode }> = ({ title, children, action }) => (
  <div className="lux-card p-5">
    {(title || action) && (
      <div className="mb-3 flex items-center justify-between gap-2">
        {title && <div className="micro">{title}</div>}
        {action}
      </div>
    )}
    {children}
  </div>
);
const KV: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div><div className="micro mb-0.5">{label}</div><div className="text-sm text-foreground">{children || "—"}</div></div>
);
const PartyCol: React.FC<{ label: string; p?: Party }> = ({ label, p }) => (
  <div>
    <div className="micro mb-1">{label}</div>
    <div className="font-medium text-foreground">{(p && p.name) || "—"}</div>
    <div className="text-sm text-muted-foreground">{(p && p.lines ? p.lines.filter(Boolean) : []).join(" · ")}</div>
  </div>
);

function LineTable({ cols, rows }: { cols: { key: string; label: string; num?: boolean }[]; rows: Line[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-secondary text-muted-foreground">
          <tr>{cols.map((c) => <th key={c.key} className={`px-3 py-2 font-medium ${c.num ? "text-right" : "text-left"}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? <tr><td colSpan={cols.length} className="px-3 py-4 text-center micro">No lines</td></tr>
            : rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={`px-3 py-2 ${c.num ? "num text-right" : ""}`}>{String(r[c.key] ?? "")}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

export function DocumentPage() {
  const { docType = "", id = "" } = useParams();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const paramTitle = sp.get("title");
  const sendable = SENDABLE.has(docType);

  const [pv, setPv] = React.useState<Preview | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [height, setHeight] = React.useState(1100);

  React.useEffect(() => {
    let live = true;
    setError(null); setPv(null);
    tenant<Preview>(`/document-templates/${docType}/preview`, { method: "POST", body: { record_id: id } })
      .then((r) => { if (live) setPv(r); })
      .catch((e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, [docType, id]);

  async function download() {
    setBusy("dl"); setError(null); setNote(null);
    try {
      // Prefer an uploaded signed copy (e.g. a countersigned contract) over the
      // freshly-rendered template.
      const signed = pv?.data?.signed_vault_id;
      if (signed) { await openVaultDoc(String(signed)); return; }
      const out = await tenant<{ public_url?: string }>(`/document-templates/${docType}/generate`, { method: "POST", body: { record_id: id } });
      if (out.public_url) window.open(out.public_url, "_blank");
      else setNote("Generated and stored in the document vault.");
    } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }
  async function send() {
    const to = window.prompt("Send document to (email):");
    if (!to) return;
    setBusy("send"); setError(null); setNote(null);
    try { await tenant(`/document-templates/${docType}/${id}/send`, { method: "POST", body: { to } }); setNote(`Sent to ${to}.`); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  }

  const d = pv?.data || null;
  const title = paramTitle || (pv?.title && (pv.title.en || pv.title.fr)) || docType;
  const heading = d?.number ? d.number : title;
  const ccy = (d && d.currency) || "XAF";

  return (
    <section className="animate-fade-in">
      <header className="lux-topbar sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:-mx-6 md:px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>← Back</Button>
          <h1 className="font-display text-xl tracking-tight">{heading}</h1>
          {d?.status && <Pill tone={STATUS_TONE(d.status)}>{enumLabel(d.status)}</Pill>}
          {d?.signed_vault_id && <Pill tone="ok">Signed copy on file</Pill>}
        </div>
        <div className="flex gap-2">
          {sendable && <Button variant="outline" loading={busy === "send"} onClick={send}>Send</Button>}
          <Button loading={busy === "dl"} onClick={download}>{d?.signed_vault_id ? "Download signed" : "Download PDF"}</Button>
        </div>
      </header>

      {error && <div className="mx-auto mb-3 max-w-3xl"><ErrorState message={error} /></div>}
      {note && <div className="mx-auto mb-3 max-w-3xl rounded-lg border border-[rgb(var(--ok))]/40 bg-[rgb(var(--ok)/0.08)] px-3 py-2 text-sm">{note}</div>}

      {!pv ? (
        <div className="mx-auto max-w-3xl py-10 text-center micro">Loading…</div>
      ) : pv.report || !d ? (
        /* Reports have no record shape → show the branded paper preview. */
        <div className="-mx-4 rounded-2xl bg-[rgb(var(--ink)_/_0.06)] px-4 py-6 md:-mx-6 md:px-6">
          <iframe title="document" srcDoc={pv.html} sandbox="allow-same-origin"
            onLoad={(e) => { try { const doc = (e.target as HTMLIFrameElement).contentWindow?.document; if (doc && doc.body) setHeight(doc.body.scrollHeight + 48); } catch { /* blocked */ } }}
            style={{ height }} className="mx-auto block w-full max-w-[860px] rounded-md border border-black/5 bg-white shadow-2xl" />
        </div>
      ) : (
        /* Native, app-themed detail — blends with the dark UI. */
        <div className="mx-auto max-w-3xl space-y-4 pb-10">
          <Card>
            <div className="grid gap-5 sm:grid-cols-2">
              <PartyCol label="From" p={fromParty(pv.entity)} />
              {(d.party || (d.parties && d.parties[1])) && <PartyCol label={PARTY_LABEL[docType] || "Client"} p={d.party || (d.parties && d.parties[1])} />}
            </div>
          </Card>

          {(d.date || d.due || d.valid_until || d.period || d.method || d.po_ref || d.original_ref || d.reason || d.supplier || d.vehicle || d.driver || d.location || d.staff_no || d.kind || d.effective_on || d.end_on || d.qa_status || d.odometer_out != null || d.odometer_in != null || d.distance != null || d.origin || d.destination) && (
            <Card>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {d.date && <KV label="Date">{dateFmt(d.date)}</KV>}
                {d.due && <KV label="Due">{dateFmt(d.due)}</KV>}
                {d.valid_until && <KV label="Valid until">{dateFmt(d.valid_until)}</KV>}
                {d.kind && <KV label="Type">{enumLabel(d.kind)}</KV>}
                {d.effective_on && <KV label="Effective">{dateFmt(d.effective_on)}</KV>}
                {d.end_on && <KV label="Ends">{dateFmt(d.end_on)}</KV>}
                {d.period && <KV label="Period">{d.period}</KV>}
                {d.method && <KV label="Method">{d.method}</KV>}
                {d.po_ref && <KV label="PO ref">{d.po_ref}</KV>}
                {d.qa_status && <KV label="QA">{enumLabel(d.qa_status)}</KV>}
                {d.original_ref && <KV label="Original">{d.original_ref}</KV>}
                {d.reason && <KV label="Reason">{d.reason}</KV>}
                {d.supplier && <KV label="Supplier">{d.supplier}</KV>}
                {d.vehicle && <KV label="Vehicle">{d.vehicle}</KV>}
                {d.driver && <KV label="Driver">{d.driver}</KV>}
                {d.location && <KV label="Location">{d.location}</KV>}
                {d.staff_no && <KV label="Staff no.">{d.staff_no}</KV>}
                {(d.origin || d.destination) && <KV label="Route">{`${d.origin || ""} → ${d.destination || ""}`}</KV>}
                {d.odometer_out != null && <KV label="Odometer out">{`${num(d.odometer_out)} km`}</KV>}
                {d.odometer_in != null && <KV label="Odometer in">{`${num(d.odometer_in)} km`}</KV>}
                {d.distance != null && <KV label="Distance">{`${num(d.distance)} km`}</KV>}
              </div>
            </Card>
          )}

          {d.description && <Card title="Description"><p className="whitespace-pre-wrap text-sm text-muted-foreground">{d.description}</p></Card>}
          {d.headline && <Card><div className="font-display text-xl">{d.headline}</div></Card>}
          {d.sections && d.sections.map((s) => <Card key={s.title} title={s.title}><p className="whitespace-pre-wrap text-sm text-muted-foreground">{s.body}</p></Card>)}
          {d.articles && d.articles.map((s) => <Card key={s.title} title={s.title}><p className="whitespace-pre-wrap text-sm text-muted-foreground">{s.body}</p></Card>)}
          {d.body && <Card><p className="whitespace-pre-wrap text-sm">{d.body}</p></Card>}

          {d.lines && (
            <Card title="Items">
              <LineTable
                cols={inferCols(d.lines[0], ccy)}
                rows={d.lines.map((l) => fmtRow(l, ccy))}
              />
            </Card>
          )}

          {d.parts && (
            <Card title="Parts & labour">
              <LineTable
                cols={[{ key: "label", label: "Part / labour" }, { key: "qty", label: "Qty", num: true }, { key: "unit_cost", label: "Unit cost", num: true }, { key: "total", label: "Total", num: true }]}
                rows={d.parts.map((p) => ({ label: p.label, qty: num(p.qty as number), unit_cost: money(p.unit_cost, ccy), total: money(Number(p.qty || 0) * Number(p.unit_cost || 0), ccy) }))}
              />
            </Card>
          )}

          {d.earnings && (
            <Card title="Earnings"><LineTable cols={[{ key: "label", label: "Item" }, { key: "amount", label: "Amount", num: true }]} rows={d.earnings.map((e) => ({ label: e.label, amount: money(e.amount, ccy) }))} /></Card>
          )}
          {d.deductions && (
            <Card title="Deductions"><LineTable cols={[{ key: "label", label: "Item" }, { key: "amount", label: "Amount", num: true }]} rows={d.deductions.map((e) => ({ label: e.label, amount: money(e.amount, ccy) }))} /></Card>
          )}

          {(d.totals || d.amount != null || d.gross != null || d.cost != null) && (
            <Card>
              <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
                {d.totals?.service_ht != null && <Row label="Total HT" value={money(d.totals.service_ht, ccy)} />}
                {d.totals?.debours_total != null && <Row label="Débours" value={money(d.totals.debours_total, ccy)} />}
                {d.totals?.vat_total != null && <Row label="TVA" value={money(d.totals.vat_total, ccy)} />}
                {d.totals?.total_ttc != null && <Row label="Total TTC" value={money(d.totals.total_ttc, ccy)} grand />}
                {d.cost != null && <Row label="Total cost" value={money(d.cost, ccy)} grand />}
                {d.gross != null && <Row label="Gross" value={money(d.gross, ccy)} />}
                {d.total_deductions != null && <Row label="Deductions" value={money(d.total_deductions, ccy)} />}
                {d.net != null && <Row label="Net pay" value={money(d.net, ccy)} grand />}
                {d.amount != null && d.totals == null && d.gross == null && <Row label="Amount" value={money(d.amount, ccy)} grand />}
              </div>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}

function Row({ label, value, grand }: { label: string; value: string; grand?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${grand ? "border-t border-primary pt-2 text-base font-semibold text-foreground" : "text-muted-foreground"}`}>
      <span>{label}</span><span className="num">{value}</span>
    </div>
  );
}
function inferCols(sample: Line | undefined, _ccy: string) {
  if (!sample) return [{ key: "label", label: "Item" }];
  const order = ["label", "item", "qty", "ordered", "received", "expected", "counted", "variance", "unit", "tax", "amount", "condition", "weight"];
  const labels: Record<string, string> = { label: "Description", item: "Item", qty: "Qty", ordered: "Ordered", received: "Received", expected: "Expected", counted: "Counted", variance: "Variance", unit: "Unit", tax: "VAT", amount: "Amount", condition: "Condition", weight: "Weight" };
  const numeric = new Set(["qty", "ordered", "received", "expected", "counted", "variance", "unit", "amount", "weight"]);
  return Object.keys(sample).filter((kk) => order.includes(kk)).sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((kk) => ({ key: kk, label: labels[kk] || kk, num: numeric.has(kk) }));
}
function fmtRow(l: Line, ccy: string): Line {
  const o: Line = {};
  for (const [kk, v] of Object.entries(l)) {
    if (kk === "unit" || kk === "amount") o[kk] = money(v, ccy);
    else if (kk === "tax") o[kk] = v == null ? "" : `${v}%`;
    else if (kk === "qty") o[kk] = num(v as number);
    else o[kk] = v;
  }
  return o;
}

export default DocumentPage;
