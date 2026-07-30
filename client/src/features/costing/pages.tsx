/**
 * Costing screens (Wave 3) — costing sheets, cost tracking (actuals), cash
 * requests, régie d'avance. Locked shared kit; line editors kept minimal.
 */
import * as React from "react";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt, todayISO } from "@/lib/format";
import type { Entity, DictItem } from "@/lib/masterdata-api";
import type { Dossier } from "@/lib/operations-api";
import * as api from "@/lib/costing-api";

const shell = "mx-auto max-w-6xl animate-fade-in";
const TONES: Record<string, Tone> = { DRAFT: "mute", COMPUTED: "blue", APPROVED: "ok", APPROVED_LOCKED: "ok", SUBMITTED: "warn", SUBMITTED_FOR_VALIDATION: "warn", SUBMITTED_FOR_APPROVAL: "warn", REJECTED: "bad", DISBURSED: "ok", OPEN: "blue", SETTLED: "ok" };
const tone = (s?: string | null): Tone => TONES[String(s || "").toUpperCase()] || "mute";
const refOf = (rows: Dossier[] | null) => { const m: Record<string, string> = {}; (rows || []).forEach((d) => { m[d.dossier_id] = d.ref; }); return m; };

function FormButtons({ busy, disabled, onCancel, saveLabel }: { busy: boolean; disabled?: boolean; onCancel: () => void; saveLabel: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button type="submit" loading={busy} disabled={disabled}>{saveLabel}</Button>
    </div>
  );
}

/* ═══════════════════ Costing sheets ═══════════════════ */

function CostingForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");
  const [margin, setMargin] = React.useState("");
  const [lines, setLines] = React.useState<api.CostingLine[]>([{ label: "", qty: 1, unit_cost: 0 }]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const setLine = (i: number, p: Partial<api.CostingLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.createCosting({
        dossier_id: dossierId, margin_percent: margin === "" ? undefined : Number(margin),
        lines: lines.filter((l) => l.label).map((l) => ({ label: l.label, qty: Number(l.qty) || 1, unit_cost: Number(l.unit_cost) || 0 })),
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="New costing sheet" description="Planned cost + margin for a dossier.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dossier" required>
            <Select value={dossierId} onChange={(e) => setDossierId(e.target.value)}>
              <option value="">—</option>
              {(dossiers || []).map((d) => <option key={d.dossier_id} value={d.dossier_id}>{d.ref}</option>)}
            </Select>
          </Field>
          <Field label="Margin %"><Input type="number" step="0.01" className="num text-right" value={margin} onChange={(e) => setMargin(e.target.value)} /></Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="micro">Cost lines</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLines((l) => [...l, { label: "", qty: 1, unit_cost: 0 }])}>+ Add line</Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_120px_auto] items-end gap-2">
                <Field label="Label"><Input value={l.label ?? ""} onChange={(e) => setLine(i, { label: e.target.value })} /></Field>
                <Field label="Qty"><Input type="number" className="num text-right" value={String(l.qty ?? "")} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} /></Field>
                <Field label="Unit cost"><Input type="number" className="num text-right" value={String(l.unit_cost ?? "")} onChange={(e) => setLine(i, { unit_cost: Number(e.target.value) })} /></Field>
                <Button type="button" size="sm" variant="outline" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
          </div>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!dossierId || busy} onCancel={onClose} saveLabel="Create costing" />
      </form>
    </Modal>
  );
}

export function CostingPage() {
  const { rows, error, loading, reload } = useList<api.Costing>("/costings");
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const dref = refOf(dossiers);
  const list = rows || [];

  async function approve(c: api.Costing) {
    setBusyId(c.costing_id);
    try { await api.setCostingStatus(c.costing_id, "APPROVE"); reload(); } finally { setBusyId(null); }
  }

  const columns: Column<api.Costing>[] = [
    { key: "ref", label: "Ref", render: (r) => <span className="num font-medium text-foreground">{r.doc_number || r.ref || r.costing_id?.slice(0, 8) || "—"}</span> },
    { key: "dossier_id", label: "Dossier", render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—") },
    { key: "margin_percent", label: "Margin", render: (r) => (r.margin_percent != null ? `${r.margin_percent}%` : "—") },
    { key: "total", label: "Total", className: "num text-right", render: (r) => money(r.total ?? r.total_cost) },
    { key: "status", label: "Status", render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill> },
    {
      key: "_a", label: "", render: (r) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          {!["APPROVED_LOCKED", "REJECTED"].includes(r.status) && <Button size="sm" variant="outline" loading={busyId === r.costing_id} onClick={() => approve(r)}>Approve</Button>}
        </div>
      ),
    },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Costing" to="/costing" />} title="Costing" description="Planned cost sheets and margin per dossier." action={<Button onClick={() => setOpen(true)}>New costing</Button>} />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Costings" value={num(list.length)} />
        <KpiTile label="Approved" value={num(list.filter((c) => c.status === "APPROVED_LOCKED").length)} />
        <KpiTile label="Draft" value={num(list.filter((c) => c.status === "DRAFT").length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.costing_id} empty={{ title: "No costings yet", hint: "Build a costing sheet for a dossier." }} />
      {open && <CostingForm onClose={() => setOpen(false)} onSaved={reload} />}
    </section>
  );
}

/* ═══════════════════ Cost tracking (actuals) ═══════════════════ */

export function CostTrackingPage() {
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [dossierId, setDossierId] = React.useState("");
  const entries = useResource(() => (dossierId ? api.costEntriesByDossier(dossierId) : Promise.resolve([])), [dossierId]);
  const recon = useResource<Record<string, unknown>>(() => (dossierId ? api.reconcileDossier(dossierId) : Promise.resolve({})), [dossierId]);

  const cols: Column<api.CostEntry>[] = [
    { key: "label", label: "Item", render: (r) => r.label || r.category || "—" },
    { key: "category", label: "Category" },
    { key: "entry_date", label: "Date", render: (r) => dateFmt(r.entry_date) },
    { key: "amount", label: "Amount", className: "num text-right", render: (r) => money(r.amount) },
  ];
  const rc = (recon.data || {}) as Record<string, number>;

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Costing" to="/costing" />} title="Cost tracking" description="Actual costs booked against a dossier, vs the plan." />
      <HubTabs />
      <div className="mb-4 flex items-center gap-3">
        <span className="micro">Dossier</span>
        <Select value={dossierId} onChange={(e) => setDossierId(e.target.value)} className="max-w-xs">
          <option value="">Select a dossier…</option>
          {(dossiers || []).map((d) => <option key={d.dossier_id} value={d.dossier_id}>{d.ref}</option>)}
        </Select>
      </div>
      {dossierId && (
        <>
          <KpiRow>
            <KpiTile label="Planned" value={money(rc.planned_cost ?? rc.planned)} />
            <KpiTile label="Actual" value={money(rc.actual_cost ?? rc.actual)} />
            <KpiTile label="Variance" value={money(rc.variance)} />
          </KpiRow>
          <DataList columns={cols} rows={entries.data} error={entries.error} loading={entries.loading} rowKey={(r, i) => r.cost_entry_id || String(i)} empty={{ title: "No cost entries", hint: "No actuals booked to this dossier yet." }} />
        </>
      )}
    </section>
  );
}

/* ═══════════════════ Cash requests ═══════════════════ */

function CashRequestForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: dossiers } = useList<Dossier>("/operations");
  const { rows: dict } = useList<DictItem>("/financial-dictionary");
  const [dossierId, setDossierId] = React.useState("");
  const [lines, setLines] = React.useState<api.CashLine[]>([{ dictionary_item_id: null, label: "", budget_amount: 0 }]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const setLine = (i: number, p: Partial<api.CashLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  // Pick a budget line from the Financial Dictionary; the item's label is stored
  // alongside its id so the request reads the same standardised category names.
  const pickItem = (i: number, id: string) => {
    const item = (dict || []).find((d) => d.dictionary_item_id === id);
    setLine(i, { dictionary_item_id: id || null, label: item ? item.label_fr || item.code : "" });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.createCashRequest({
        dossier_id: dossierId || undefined,
        lines: lines.filter((l) => l.dictionary_item_id || l.label).map((l) => ({ dictionary_item_id: l.dictionary_item_id || undefined, label: l.label || "Line", budget_amount: Number(l.budget_amount) || 0 })),
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="New cash request" description="Request an advance against a dossier budget.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Dossier">
          <Select value={dossierId} onChange={(e) => setDossierId(e.target.value)}>
            <option value="">—</option>
            {(dossiers || []).map((d) => <option key={d.dossier_id} value={d.dossier_id}>{d.ref}</option>)}
          </Select>
        </Field>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="micro">Budget lines</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLines((l) => [...l, { dictionary_item_id: null, label: "", budget_amount: 0 }])}>+ Add line</Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_auto] items-end gap-2">
                <Field label="Budget line">
                  <Select value={l.dictionary_item_id ?? ""} onChange={(e) => pickItem(i, e.target.value)}>
                    <option value="">Select a category…</option>
                    {(dict || []).filter((d) => d.is_active !== false).map((d) => <option key={d.dictionary_item_id} value={d.dictionary_item_id}>{d.label_fr || d.code}</option>)}
                  </Select>
                </Field>
                <Field label="Budget"><Input type="number" className="num text-right" value={String(l.budget_amount ?? "")} onChange={(e) => setLine(i, { budget_amount: Number(e.target.value) })} /></Field>
                <Button type="button" size="sm" variant="outline" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
          </div>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={busy} onCancel={onClose} saveLabel="Create request" />
      </form>
    </Modal>
  );
}

export function CashRequestsPage() {
  const { rows, error, loading, reload } = useList<api.CashRequest>("/cash-requests");
  const { rows: dossiers } = useList<Dossier>("/operations");
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const dref = refOf(dossiers);
  const list = rows || [];

  async function submitCr(c: api.CashRequest) {
    setBusyId(c.cash_request_id);
    try { await api.transitionCashRequest(c.cash_request_id, "SUBMITTED"); reload(); } finally { setBusyId(null); }
  }

  const columns: Column<api.CashRequest>[] = [
    { key: "ref", label: "Ref", render: (r) => <span className="num font-medium text-foreground">{r.doc_number || r.ref || r.cash_request_id?.slice(0, 8) || "—"}</span> },
    { key: "dossier_id", label: "Dossier", render: (r) => (r.dossier_id ? dref[r.dossier_id] || "—" : "—") },
    { key: "total_budget", label: "Budget", className: "num text-right", render: (r) => money(r.total_budget) },
    { key: "status", label: "Status", render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill> },
    {
      key: "_a", label: "", render: (r) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <DocButton docType="CASH_REQUEST" id={r.cash_request_id} title={r.ref || `Cash request ${r.cash_request_id.slice(0, 8)}`} label="View" />
          {(r.status === "DRAFT" || !r.status) && <Button size="sm" variant="outline" loading={busyId === r.cash_request_id} onClick={() => submitCr(r)}>Submit</Button>}
        </div>
      ),
    },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Costing" to="/costing" />} title="Cash requests" description="Advances requested against dossier budgets." action={<Button onClick={() => setOpen(true)}>New request</Button>} />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Requests" value={num(list.length)} />
        <KpiTile label="Approved" value={num(list.filter((c) => c.status === "APPROVED").length)} />
        <KpiTile label="Submitted" value={num(list.filter((c) => c.status === "SUBMITTED").length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.cash_request_id} empty={{ title: "No cash requests", hint: "Request an advance for a dossier." }} />
      {open && <CashRequestForm onClose={() => setOpen(false)} onSaved={reload} />}
    </section>
  );
}

/* ═══════════════════ Régie d'avance ═══════════════════ */

function RegieForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: entities } = useList<Entity>("/entities");
  const [f, setF] = React.useState({ entity_id: "", amount: "", source_doc_ref: "", entry_date: todayISO() });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.issueRegie({ entity_id: f.entity_id, amount: Number(f.amount), source_doc_ref: f.source_doc_ref, entry_date: f.entry_date });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Issue régie advance" description="Cash float issued to a holder; ages back to the client if unjustified.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select value={f.entity_id} onChange={(e) => set("entity_id", e.target.value)}>
              <option value="">—</option>
              {(entities || []).map((en) => <option key={en.entity_id} value={en.entity_id}>{en.legal_name || en.code}</option>)}
            </Select>
          </Field>
          <Field label="Amount" required><Input type="number" min="0" step="0.01" className="num text-right" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
          <Field label="Source doc ref" required><Input value={f.source_doc_ref} onChange={(e) => set("source_doc_ref", e.target.value)} /></Field>
          <Field label="Date" required><Input type="date" value={f.entry_date} onChange={(e) => set("entry_date", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={!f.entity_id || f.amount === "" || !f.source_doc_ref || busy} onCancel={onClose} saveLabel="Issue advance" />
      </form>
    </Modal>
  );
}

export function RegiePage() {
  const { rows, error, loading, reload } = useList<api.Regie>("/regie");
  const [open, setOpen] = React.useState(false);
  const list = rows || [];
  const columns: Column<api.Regie>[] = [
    { key: "ref", label: "Ref", render: (r) => <span className="num font-medium text-foreground">{r.doc_number || r.ref || r.regie_advance_id?.slice(0, 8) || "—"}</span> },
    { key: "amount", label: "Amount", className: "num text-right", render: (r) => money(r.amount) },
    { key: "status", label: "Status", render: (r) => { const st = r.state ?? r.status; return st ? <Pill tone={tone(st)}>{st}</Pill> : "—"; } },
    { key: "issued_on", label: "Issued", render: (r) => dateFmt(r.issued_on || r.created_at) },
    { key: "_a", label: "", render: (r) => <div className="flex justify-end"><DocButton docType="REGIE_ADVANCE" id={r.regie_advance_id} title={`Régie ${r.regie_advance_id.slice(0, 8)}`} label="View" /></div> },
  ];
  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Costing" to="/costing" />} title="Régie d'avance" description="Cash advances (floats) and their ageing." action={<Button onClick={() => setOpen(true)}>Issue advance</Button>} />
      <HubTabs />
      <KpiRow>
        <KpiTile label="Advances" value={num(list.length)} />
        <KpiTile label="Total float" value={money(list.reduce((s, r) => s + (Number(r.amount) || 0), 0))} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.regie_advance_id} empty={{ title: "No advances", hint: "Issue a cash advance to a holder." }} />
      {open && <RegieForm onClose={() => setOpen(false)} onSaved={reload} />}
    </section>
  );
}
