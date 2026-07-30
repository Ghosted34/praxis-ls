/**
 * Clients — customer 360 (replaces the flat CRUD list). Pick a client to see
 * their master terms plus a live rollup: outstanding balance, dossiers, overdue
 * invoices and receipts — mirroring the Dossier 360 pattern for customers.
 */
import * as React from "react";
import { ScreenAi } from "@/components/screen-ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt, enumLabel } from "@/lib/format";
import * as api from "@/lib/masterdata-api";
import { listDossiers, type Dossier } from "@/lib/operations-api";
import { ClientForm } from "./pages";

const shell = "mx-auto max-w-6xl animate-fade-in";
const DOSSIER_TONE: Record<string, Tone> = { DRAFT: "mute", IN_PROGRESS: "blue", COMPLETED: "ok", CANCELLED: "bad" };

const TABS = ["Dossiers", "Overdue", "Receipts"] as const;
type Tab = (typeof TABS)[number];

function MiniTable({ head, children, empty }: { head: React.ReactNode; children: React.ReactNode; empty: boolean }) {
  if (empty) return <div className="px-3 py-6 text-center micro">Nothing here yet.</div>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground"><tr>{head}</tr></thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>{children}</th>;
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>;

function ClientDetail({ client: initial, onChanged, onEdit }: { client: api.Client; onChanged: () => void; onEdit: () => void }) {
  const [client, setClient] = React.useState(initial);
  React.useEffect(() => setClient(initial), [initial]);
  const [tab, setTab] = React.useState<Tab>("Dossiers");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cid = client.client_id;

  const credit = useResource(() => api.getClientCredit(cid), [cid]);
  const overdue = useResource(() => api.clientOverdue(cid), [cid]);
  const receipts = useResource(() => api.clientReceipts(cid), [cid]);
  const dossiers = useResource(() => listDossiers(), []);

  const myDossiers = React.useMemo(() => (dossiers.data || []).filter((d: Dossier) => d.client_id === cid), [dossiers.data, cid]);
  const ovInvoices = overdue.data?.invoices || [];
  const rcpts = receipts.data || [];

  async function toggleActive() {
    setBusy(true); setError(null);
    try { setClient(await api.updateClient(cid, { is_active: !client.is_active })); onChanged(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  const counts: Record<Tab, number> = { Dossiers: myDossiers.length, Overdue: ovInvoices.length, Receipts: rcpts.length };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground">{client.name}</h3>
              <Pill tone={client.is_active ? "ok" : "mute"}>{client.is_active ? "Active" : "Inactive"}</Pill>
              {client.is_withholding_agent && <Pill tone="blue">WHT agent</Pill>}
            </div>
            <p className="mt-1 micro">{[client.niu && `NIU ${client.niu}`, client.rccm && `RCCM ${client.rccm}`, client.payment_terms_days != null && `${client.payment_terms_days}d terms`].filter(Boolean).join(" · ") || "—"}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
            <Button size="sm" variant={client.is_active ? "outline" : "default"} loading={busy} onClick={toggleActive}>{client.is_active ? "Deactivate" : "Activate"}</Button>
          </div>
        </div>
        {error && <div className="mt-3"><ErrorState message={error} /></div>}
      </div>

      <KpiRow>
        <KpiTile label="Credit limit" value={money(client.credit_limit)} />
        <KpiTile label="Outstanding" value={credit.data ? money(credit.data.outstanding) : "…"} />
        <KpiTile label="Available" value={credit.data && credit.data.available != null ? money(credit.data.available) : "—"} />
        <KpiTile label="Overdue" value={overdue.data ? money(overdue.data.total) : "…"} />
      </KpiRow>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}<span className="ml-1.5 micro">{counts[t]}</span>
          </button>
        ))}
      </div>

      {tab === "Dossiers" && (
        <MiniTable empty={myDossiers.length === 0} head={<><Th>Ref</Th><Th>Route</Th><Th>Status</Th><Th r>Costing</Th></>}>
          {myDossiers.map((d) => (
            <tr key={d.dossier_id}><Td>{d.ref}</Td><Td>{[d.pol, d.pod].filter(Boolean).join(" → ") || "—"}</Td><Td><Pill tone={DOSSIER_TONE[d.status] || "mute"}>{enumLabel(d.status)}</Pill></Td><Td r>{d.costing_total != null ? money(d.costing_total) : "—"}</Td></tr>
          ))}
        </MiniTable>
      )}
      {tab === "Overdue" && (
        <MiniTable empty={ovInvoices.length === 0} head={<><Th>Invoice</Th><Th>Due</Th><Th r>Days</Th><Th r>Outstanding</Th></>}>
          {ovInvoices.map((i) => (
            <tr key={i.invoice_id}><Td>{i.doc_number || i.invoice_id.slice(0, 8)}</Td><Td>{dateFmt(i.payment_due_on)}</Td><Td r>{num(i.days_overdue)}</Td><Td r>{money(i.outstanding)}</Td></tr>
          ))}
        </MiniTable>
      )}
      {tab === "Receipts" && (
        <MiniTable empty={rcpts.length === 0} head={<><Th>Received</Th><Th>Method</Th><Th>Status</Th><Th r>Amount</Th></>}>
          {rcpts.map((r) => (
            <tr key={r.receipt_id}><Td>{dateFmt(r.received_on)}</Td><Td>{r.method || "—"}</Td><Td>{enumLabel(r.status)}</Td><Td r>{money(r.amount)}</Td></tr>
          ))}
        </MiniTable>
      )}
    </div>
  );
}

export function ClientsPage() {
  const clients = useResource(() => api.listClients(), []);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<api.Client | "new" | null>(null);

  const rows = clients.data || [];
  const filtered = q ? rows.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : rows;
  const selected = rows.find((c) => c.client_id === selId) || null;
  React.useEffect(() => { if (!selId && rows.length) setSelId(rows[0].client_id); }, [rows, selId]);

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Master data" to="/master" />} title="Clients" description="Customer master with a live 360 — terms, outstanding balance, dossiers and receipts." action={<Button onClick={() => setEditing("new")}>New client</Button>} />
      <HubTabs />
      {clients.error ? <ErrorState message={clients.error} /> : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <div className="space-y-2">
            <Input placeholder="Search client…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {clients.loading ? <div className="px-3 py-4 micro">Loading…</div> : filtered.length === 0 ? <div className="px-3 py-4 micro">No clients.</div> : filtered.map((c) => (
                <button key={c.client_id} onClick={() => setSelId(c.client_id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${c.client_id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}>
                  <span className="truncate font-medium">{c.name}</span>
                  <Pill tone={c.is_active ? "ok" : "mute"}>{c.is_active ? "Active" : "Off"}</Pill>
                </button>
              ))}
            </div>
          </div>
          {selected ? <ClientDetail client={selected} onChanged={clients.reload} onEdit={() => setEditing(selected)} /> : <EmptyState title="No client selected" hint="Choose a client from the list." />}
        </div>
      )}
      {editing !== null && <ClientForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={clients.reload} />}
      <ScreenAi path="master/clients" />
    </section>
  );
}

export default ClientsPage;
