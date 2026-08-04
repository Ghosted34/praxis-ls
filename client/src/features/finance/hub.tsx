/**
 * Finance & treasury — the command-center view, mirroring the Lovable reference:
 * a trial-balance banner, Receivables-ageing + Cash-position (donut) panels, then
 * chips (Invoices / Proforma / Receipts / Journals) filtering one table. The
 * top-right button follows the active chip (New invoice → New proforma …). The
 * deeper modules sit as links beside that button and open via /finance/<slug>.
 * Accents resolve to --primary (settings-driven).
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Panel } from "@/components/ui/panel";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataList, type Column } from "@/components/data-list";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, useListPaged, useResource } from "@/lib/use-resource";
import { Pagination } from "@/components/ui/pagination";
import { useDebounced } from "@/lib/use-debounced";
import { money, dateFmt, enumLabel } from "@/lib/format";
import type { Client } from "@/lib/masterdata-api";
import * as api from "@/lib/finance-api";
import { InvoicesPage } from "./invoices";
import { ProformasPage } from "./proformas";
import { CreditNotesPage } from "./credit-notes";
import { JournalsPage } from "./journals";
import { StatementsPage } from "./statements";
import { TaxCenterPage } from "./tax-center";
import { AssetsPage } from "./assets";
import { ReceivablesPage } from "./receivables";
import { DebtPage } from "./debt";
import { ChartOfAccountsPage } from "./chart-of-accounts";

const shell = pageShell.wide;
const statusTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u.includes("LOCKED") || u === "VALIDATED" || u === "PAID" || u === "APPLIED") return "ok";
  if (u.includes("SUBMITTED") || u === "OPEN") return "blue";
  if (u === "DRAFT" || u === "UNREVIEWED") return "mute";
  if (u.includes("REJECT") || u.includes("OVERDUE") || u.includes("REVERSED")) return "bad";
  return "mute";
};
const nameMap = (rows: Client[] | null) => {
  const m: Record<string, string> = {};
  (rows || []).forEach((c) => { m[String(c.client_id)] = c.name; });
  return m;
};

const DEEP: Record<string, React.ComponentType> = {
  invoices: InvoicesPage, proformas: ProformasPage, receivables: ReceivablesPage, journals: JournalsPage,
  "credit-notes": CreditNotesPage, "chart-of-accounts": ChartOfAccountsPage, statements: StatementsPage,
  tax: TaxCenterPage, assets: AssetsPage, debt: DebtPage,
};
/* the deeper modules — links beside the New-X button */
const MORE = [
  { slug: "credit-notes", label: "Credit notes" }, { slug: "debt", label: "Financing" },
  { slug: "chart-of-accounts", label: "Chart of accounts" }, { slug: "statements", label: "Statements" },
  { slug: "tax", label: "Tax center" }, { slug: "assets", label: "Assets" },
];

type ChipKey = "invoices" | "proformas" | "receipts" | "journals";
/* per-chip: table-switch label + top-right create button noun + create route */
const CHIP_META: Record<ChipKey, { label: string; noun: string; route: string }> = {
  invoices: { label: "Invoices", noun: "New invoice", route: "/finance/invoices" },
  proformas: { label: "Proforma", noun: "New proforma", route: "/finance/proformas" },
  receipts: { label: "Receipts", noun: "New receipt", route: "/finance/receivables" },
  journals: { label: "Journals", noun: "New journal", route: "/finance/journals" },
};

/* ── ageing panel ── */
function AgeingPanel({ a }: { a: api.Ageing | null }) {
  const rows = [
    { label: "Current", v: a?.current, tone: "--ok" },
    { label: "1–30 days", v: a?.d1_30, tone: "--primary" },
    { label: "31–60 days", v: a?.d31_60, tone: "--warn" },
    { label: "60+ days", v: Number(a?.d61_90 || 0) + Number(a?.d90_plus || 0), tone: "--bad" },
  ];
  const max = Math.max(1, ...rows.map((r) => Number(r.v || 0)));
  return (
    <Panel title="Receivables ageing" subtitle="Smart receivables ledger · XAF">
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 text-sm">
            <span className="w-24 text-muted-foreground">{r.label}</span>
            <span className="h-2.5 flex-1 rounded-full bg-[rgb(var(--ink-3)/0.15)]">
              <span className="block h-full rounded-full" style={{ width: `${Math.round((Number(r.v || 0) / max) * 100)}%`, background: `rgb(var(${r.tone}))` }} />
            </span>
            <span className="num w-32 text-right font-medium">{money(r.v)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ── cash-position donut (treasury kind → coa_code → class-5 TB balance) ── */
const KIND_META: Record<string, { label: string; tone: string }> = {
  BANK: { label: "Bank", tone: "--primary" },
  MOMO: { label: "Mobile money", tone: "--warn" },
  CASH: { label: "Cash", tone: "--ok" },
};
function CashPanel({ tb, accts }: { tb: api.TrialBalance | null; accts: api.TreasuryAccount[] | null }) {
  const balOf = (coa: string) =>
    (tb?.rows || []).filter((r) => String(r.account_code).startsWith(coa)).reduce((s, r) => s + (Number(r.debit || 0) - Number(r.credit || 0)), 0);
  const groups = (["BANK", "MOMO", "CASH"] as const).map((kind) => {
    const inKind = (accts || []).filter((x) => x.kind === kind);
    const bal = inKind.reduce((s, x) => s + balOf(x.coa_code), 0);
    const labels = inKind.map((x) => `${x.label} · ${x.coa_code}`);
    return { kind, ...KIND_META[kind], bal, labels };
  }).filter((g) => Math.abs(g.bal) > 0);
  const total = groups.reduce((s, g) => s + g.bal, 0);

  let acc = 0;
  const stops = groups.map((g) => {
    const pct = total > 0 ? (g.bal / total) * 100 : 0;
    const seg = `rgb(var(${g.tone})) ${acc}% ${acc + pct}%`;
    acc += pct;
    return seg;
  });
  const gradient = stops.length ? `conic-gradient(${stops.join(", ")})` : "";

  return (
    <Panel title="Cash position" subtitle="Treasury · bank · cash · mobile money">
      {groups.length ? (
        <div className="flex flex-wrap items-center gap-6">
          <div className="relative h-36 w-36 shrink-0 rounded-full" style={{ background: gradient }}>
            <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-card">
              <span className="num text-xl font-semibold">{money(total).replace(" XAF", "")}</span>
              <span className="micro">XAF total</span>
            </div>
          </div>
          <ul className="flex-1 space-y-2 text-sm">
            {groups.map((g) => (
              <li key={g.kind} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `rgb(var(${g.tone}))` }} />
                  <span className="text-muted-foreground">{g.labels[0] || g.label}</span>
                </span>
                <span className="num font-medium">{money(g.bal)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : <span className="micro">No treasury movement posted yet.</span>}
    </Panel>
  );
}

function CommandCenter() {
  const navigate = useNavigate();
  const { rows: clients } = useList<Client>("/clients");
  const clientName = nameMap(clients);
  // dossier_id → ref, so the invoice table shows "SBX-2026-0002", not "…af31" (§5)
  const { rows: dossiers } = useList<{ dossier_id: string; ref?: string | null }>("/operations");
  const dossierRef = React.useMemo(() => {
    const m: Record<string, string> = {};
    (dossiers || []).forEach((d) => { if (d.ref) m[d.dossier_id] = d.ref; });
    return m;
  }, [dossiers]);
  const tb = useResource(() => api.getTrialBalance(), []);
  const ageing = useResource(() => api.getAgeing(), []);
  const treasury = useList<api.TreasuryAccount>("/treasury-accounts");
  const [chip, setChip] = React.useState<ChipKey>("invoices");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(0);
  // Search hits the API now, so it is debounced — see useDebounced.
  const search = useDebounced(q, 300);

  // A new search or a new tab must restart at page 1. Without this, searching
  // while on page 3 asks for offset 50 of a result set that may hold 2 rows,
  // and the table renders empty for a query that matched.
  React.useEffect(() => { setPage(0); }, [search, chip]);

  // SERVER-PAGED AND SERVER-SEARCHED (audit F8).
  //
  // These were four unpaginated `useList` calls whose results were filtered in
  // the browser. The API clamps every list to 50 rows, so the hub was filtering
  // the 50 most recent records and reporting "No invoices match" for records
  // that existed further down — wrong data, not just slow data. Both the paging
  // and the text search now happen in SQL; see the repo `q` clauses.
  //
  // All four are still fetched, as before, because the chip counts show all
  // four at once. Only the ACTIVE tab pages — the others sit on page 1, since
  // nothing but their total is read.
  const pageSize = 25;
  const at = (k: ChipKey) => ({ page: chip === k ? page : 0, pageSize, q: search });
  const invoices = useListPaged<api.InvoiceRow>("/final-invoices", at("invoices"));
  const proformas = useListPaged<api.ProformaRow>("/proformas/advances", at("proformas"));
  const receipts = useListPaged<api.Receipt>("/receivables", at("receipts"));
  const journals = useListPaged<api.JournalRow>("/journal-entries", at("journals"));

  // These are now TRUE totals from X-Total-Count. They previously read
  // `rows.length` off a response the API had already clamped to 50, so a tenant
  // with 300 invoices saw the chip claim "50".
  const counts: Record<ChipKey, number> = {
    invoices: invoices.total, proformas: proformas.total,
    receipts: receipts.total, journals: journals.total,
  };
  const activeList = { invoices, proformas, receipts, journals }[chip];
  const clientOf = (id?: string | null) => (id ? clientName[id] || "—" : "—");
  const active = CHIP_META[chip];

  const invCols: Column<api.InvoiceRow>[] = [
    { key: "doc", label: "Invoice", render: (r) => <span className="num font-medium text-[rgb(var(--primary))]">{r.doc_number || r.invoice_id.slice(0, 8)}</span> },
    { key: "client", label: "Client", render: (r) => <span className="font-medium text-foreground">{clientOf(r.client_id)}</span> },
    { key: "dossier", label: "Dossier", render: (r) => (r.dossier_id ? <span className="num text-muted-foreground">{dossierRef[r.dossier_id] || r.dossier_id.slice(0, 8)}</span> : "—") },
    { key: "amt", label: "Amount · XAF", className: "num text-right", render: (r) => money(r.total_ttc) },
    { key: "due", label: "Due", render: (r) => dateFmt(r.payment_due_on) },
    { key: "status", label: "Status", render: (r) => <Pill tone={statusTone(r.status)}>{enumLabel(r.status)}</Pill> },
  ];
  const pfCols: Column<api.ProformaRow>[] = [
    { key: "created", label: "Created", render: (r) => <span className="num font-medium text-[rgb(var(--primary))]">{r.created_at ? dateFmt(r.created_at) : `Advance ${r.advance_id.slice(0, 8)}`}</span> },
    { key: "client", label: "Client", render: (r) => clientOf(r.client_id) },
    { key: "amt", label: "Amount · XAF", className: "num text-right", render: (r) => money(r.amount) },
    { key: "applied", label: "Applied", className: "num text-right", render: (r) => money(r.applied_amount) },
    { key: "status", label: "Status", render: (r) => <Pill tone={statusTone(r.status)}>{enumLabel(r.status || "OPEN")}</Pill> },
  ];
  const rcCols: Column<api.Receipt>[] = [
    { key: "received", label: "Received", render: (r) => <span className="num">{dateFmt(r.received_on)}</span> },
    { key: "client", label: "Client", render: (r) => clientOf(r.client_id) },
    { key: "method", label: "Method", render: (r) => <Pill tone="mute">{enumLabel(r.method)}</Pill> },
    { key: "amt", label: "Amount · XAF", className: "num text-right", render: (r) => money(r.amount) },
    { key: "status", label: "Status", render: (r) => <Pill tone={statusTone(r.status)}>{enumLabel(r.status)}</Pill> },
  ];
  const jnCols: Column<api.JournalRow>[] = [
    { key: "date", label: "Date", render: (r) => <span className="num">{dateFmt(r.entry_date)}</span> },
    { key: "ref", label: "Source ref", render: (r) => r.source_doc_ref || "—" },
    { key: "source", label: "Source", render: (r) => <Pill tone="mute">{enumLabel(r.source || "—")}</Pill> },
    { key: "status", label: "Status", render: (r) => <Pill tone={statusTone(r.status)}>{enumLabel(r.status)}</Pill> },
  ];

  const t = tb.data?.totals;
  return (
    <section className={shell}>
      {/* header — title left, module links + dynamic create button right */}
      <header className="mb-5 border-b border-border pb-4">
        <div className="micro mb-1 uppercase tracking-wide">Hub › Finance · OHADA</div>
        <h1 className="font-display text-3xl tracking-tight text-foreground">Finance &amp; treasury</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Every money event posts to the SYSCOHADA ledger at source. Débours never inflate turnover.</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="chips">
            {MORE.map((m) => (
              <button key={m.slug} onClick={() => navigate(`/finance/${m.slug}`)} className="chip">{m.label}</button>
            ))}
          </div>
          <Button onClick={() => navigate(active.route)}>{active.noun}</Button>
        </div>
      </header>

      {/* trial-balance banner */}
      <div className={`mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 shadow-sm ${t?.balanced ? "border-[rgb(var(--ok))]/30 bg-[rgb(var(--ok)/0.07)]" : "border-[rgb(var(--warn))]/30 bg-[rgb(var(--warn)/0.07)]"}`}>
        <div className="flex items-center gap-3">
          <span className={`grid h-9 w-9 place-items-center rounded-lg ${t?.balanced ? "bg-[rgb(var(--ok)/0.18)] text-[rgb(var(--ok))]" : "bg-[rgb(var(--warn)/0.18)] text-[rgb(var(--warn))]"}`}>
            {t?.balanced ? "✓" : "!"}
          </span>
          <div>
            <div className="text-sm font-semibold">Trial balance {tb.loading ? "…" : t?.balanced ? "is in balance" : "needs attention"}</div>
            <div className="micro">Σ Débit = Σ Crédit · posted from validated journals</div>
          </div>
        </div>
        <div className="flex items-center gap-8">
          <div className="text-right"><div className="micro uppercase tracking-wide">Total débit</div><div className="num font-display text-lg">{money(t?.debit)}</div></div>
          <div className="text-right"><div className="micro uppercase tracking-wide">Total crédit</div><div className="num font-display text-lg">{money(t?.credit)}</div></div>
        </div>
      </div>

      {/* ageing + cash */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <AgeingPanel a={ageing.data} />
        <CashPanel tb={tb.data} accts={treasury.rows} />
      </div>

      {/* chips + search */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="chips">
          {(Object.keys(CHIP_META) as ChipKey[]).map((k) => {
            const on = chip === k;
            return (
              <button key={k} onClick={() => setChip(k)} className={`chip ${on ? "on" : ""}`}>
                {CHIP_META[k].label} <span className="ct num">{counts[k]}</span>
              </button>
            );
          })}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice, client, dossier…" className="w-full max-w-xs" />
      </div>

      {/* No `.filter(...)` on any of these: the server has already applied the
          search across the WHOLE table, so what arrives is the answer rather
          than a prefix of it. The empty-state hint distinguishes "nothing here"
          from "nothing matched", which the old client-side filter could not. */}
      {chip === "invoices" && (
        <DataList columns={invCols} rows={invoices.rows} error={invoices.error} loading={invoices.loading} rowKey={(r) => r.invoice_id} onRowClick={() => navigate("/finance/invoices")} empty={search ? { title: "No invoices match", hint: `Nothing matches “${search}”.` } : { title: "No invoices", hint: "Issue a final invoice from an approved costing." }} />
      )}
      {chip === "proformas" && (
        <DataList columns={pfCols} rows={proformas.rows} error={proformas.error} loading={proformas.loading} rowKey={(r) => r.advance_id} onRowClick={() => navigate("/finance/proformas")} empty={search ? { title: "No proformas match", hint: `Nothing matches “${search}”.` } : { title: "No proformas", hint: "Raise a proforma / advance request." }} />
      )}
      {chip === "receipts" && (
        <DataList columns={rcCols} rows={receipts.rows} error={receipts.error} loading={receipts.loading} rowKey={(r) => r.receipt_id} onRowClick={() => navigate("/finance/receivables")} empty={search ? { title: "No receipts match", hint: `Nothing matches “${search}”.` } : { title: "No receipts", hint: "Log a customer payment." }} />
      )}
      {chip === "journals" && (
        <DataList columns={jnCols} rows={journals.rows} error={journals.error} loading={journals.loading} rowKey={(r) => r.entry_id} onRowClick={() => navigate("/finance/journals")} empty={search ? { title: "No journal entries match", hint: `Nothing matches “${search}”.` } : { title: "No journal entries", hint: "Postings land here as documents are locked." }} />
      )}

      <Pagination page={activeList.page} pageSize={activeList.pageSize} total={activeList.total} onPageChange={setPage} />
    </section>
  );
}

export function FinanceHub() {
  const { section } = useParams();
  const Deep = section ? DEEP[section] : null;
  // The deep pages now carry a clickable "Hub › Finance" crumb, so the old
  // "← Back to Finance & treasury" link is redundant and has been removed.
  if (Deep) return <div className="animate-fade-in"><Deep /></div>;
  return <CommandCenter />;
}
