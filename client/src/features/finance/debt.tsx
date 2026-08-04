/**
 * Debt / financing (MOD-53) — loan engagements with drawdown & repayment posting,
 * outstanding tracking and a repayment-history drawer. Locked shared kit; accents
 * resolve to --primary (settings-driven).
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt, todayISO } from "@/lib/format";
import type { Entity } from "@/lib/masterdata-api";
import * as api from "@/lib/finance-api";

const shell = pageShell.wide;
const TONES: Record<string, Tone> = { ACTIVE: "blue", SETTLED: "ok", DEFAULTED: "bad" };
const tone = (s?: string | null): Tone => TONES[String(s || "").toUpperCase()] || "mute";
const LENDERS = ["BANK", "THIRD_PARTY", "DIRECTOR"];

function FormButtons({ busy, disabled, onCancel, saveLabel }: { busy: boolean; disabled?: boolean; onCancel: () => void; saveLabel: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button type="submit" loading={busy} disabled={disabled}>{saveLabel}</Button>
    </div>
  );
}

/* ── create / edit engagement ── */
function DebtForm({ row, onClose, onSaved }: { row: api.DebtEngagement | null; onClose: () => void; onSaved: () => void }) {
  const isNew = row === null;
  const { rows: entities } = useList<Entity>("/entities");
  const [f, setF] = React.useState({
    entity_id: row?.entity_id ?? "", lender_kind: row?.lender_kind ?? "BANK", lender_name: row?.lender_name ?? "",
    principal: row?.principal != null ? String(row.principal) : "", interest_rate: row?.interest_rate != null ? String(row.interest_rate) : "",
    started_on: row?.started_on ?? "", due_on: row?.due_on ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (isNew) {
        await api.createDebt({
          entity_id: f.entity_id, lender_kind: f.lender_kind, lender_name: f.lender_name || undefined,
          principal: Number(f.principal), interest_rate: f.interest_rate === "" ? undefined : Number(f.interest_rate),
          started_on: f.started_on || undefined, due_on: f.due_on || undefined,
        });
      } else {
        await api.updateDebt(row!.debt_engagement_id, {
          lender_name: f.lender_name || undefined, interest_rate: f.interest_rate === "" ? undefined : Number(f.interest_rate),
          started_on: f.started_on || undefined, due_on: f.due_on || undefined,
        });
      }
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={isNew ? "New financing" : "Edit financing"} description="A loan or credit facility the business draws down and repays.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entity" required>
            <Select value={f.entity_id} onChange={(e) => set("entity_id", e.target.value)} disabled={!isNew}>
              <option value="">—</option>
              {(entities || []).map((en) => <option key={en.entity_id} value={en.entity_id}>{en.legal_name || en.code}</option>)}
            </Select>
          </Field>
          <Field label="Lender kind" required>
            <Select value={f.lender_kind} onChange={(e) => set("lender_kind", e.target.value)} disabled={!isNew}>
              {LENDERS.map((l) => <option key={l} value={l}>{l.replace(/_/g, " ")}</option>)}
            </Select>
          </Field>
          <Field label="Lender name" className="sm:col-span-2"><Input value={f.lender_name} onChange={(e) => set("lender_name", e.target.value)} placeholder="Ecobank / director name" /></Field>
          <Field label="Principal" required><Input type="number" min="0" step="0.01" className="num text-right" value={f.principal} onChange={(e) => set("principal", e.target.value)} disabled={!isNew} /></Field>
          <Field label="Interest rate %"><Input type="number" min="0" step="0.01" className="num text-right" value={f.interest_rate} onChange={(e) => set("interest_rate", e.target.value)} /></Field>
          <Field label="Started on"><Input type="date" value={f.started_on} onChange={(e) => set("started_on", e.target.value)} /></Field>
          <Field label="Due on"><Input type="date" value={f.due_on} onChange={(e) => set("due_on", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={busy || (isNew && !(f.entity_id && Number(f.principal) > 0))} onCancel={onClose} saveLabel={isNew ? "Create facility" : "Save changes"} />
      </form>
    </Modal>
  );
}

/* ── repay ── */
function RepayForm({ debt, onClose, onSaved }: { debt: api.DebtEngagement; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ entry_date: todayISO(), principal_part: "", interest_part: "", source_doc_ref: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.repayDebt(debt.debt_engagement_id, {
        entry_date: f.entry_date, principal_part: f.principal_part === "" ? undefined : Number(f.principal_part),
        interest_part: f.interest_part === "" ? undefined : Number(f.interest_part), source_doc_ref: f.source_doc_ref || undefined,
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Record repayment" description="Split principal and interest; posts the cash and interest entries.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entry date" required><Input type="date" value={f.entry_date} onChange={(e) => set("entry_date", e.target.value)} /></Field>
          <Field label="Source doc ref"><Input value={f.source_doc_ref} onChange={(e) => set("source_doc_ref", e.target.value)} /></Field>
          <Field label="Principal part"><Input type="number" min="0" step="0.01" className="num text-right" value={f.principal_part} onChange={(e) => set("principal_part", e.target.value)} /></Field>
          <Field label="Interest part"><Input type="number" min="0" step="0.01" className="num text-right" value={f.interest_part} onChange={(e) => set("interest_part", e.target.value)} /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons busy={busy} disabled={busy || !(Number(f.principal_part) > 0 || Number(f.interest_part) > 0)} onCancel={onClose} saveLabel="Post repayment" />
      </form>
    </Modal>
  );
}

/* ── detail drawer ── */
function DebtDrawer({ debt, onClose, onRepay }: { debt: api.DebtEngagement; onClose: () => void; onRepay: () => void }) {
  const d = useResource(() => api.getDebt(debt.debt_engagement_id), [debt.debt_engagement_id]);
  const x = d.data;
  return (
    <Modal open onClose={onClose} size="lg" title={`${debt.lender_name || debt.lender_kind || "Facility"} · ${money(debt.principal)}`} description={debt.due_on ? `Due ${dateFmt(debt.due_on)}` : undefined}>
      {d.loading ? <div className="py-8 text-center micro">Loading…</div> : d.error ? <ErrorState message={errMsg(d.error)} /> : x ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-card/40 px-3.5 py-2.5"><div className="micro mb-1">Principal</div><div className="num text-lg font-medium">{money(x.principal)}</div></div>
            <div className="rounded-lg border border-border bg-card/40 px-3.5 py-2.5"><div className="micro mb-1">Repaid</div><div className="num text-lg font-medium">{money(x.repaid?.principal)}</div></div>
            <div className="rounded-lg border border-border bg-card/40 px-3.5 py-2.5"><div className="micro mb-1">Outstanding</div><div className="num text-lg font-medium text-[rgb(var(--primary))]">{money(x.outstanding_principal)}</div></div>
          </div>
          <div className="flex justify-end">
            {x.status === "ACTIVE" && <Button size="sm" onClick={onRepay}>Record repayment</Button>}
          </div>
          <div>
            <div className="micro mb-2">Repayment history</div>
            {(x.repayments || []).length ? (
              <ol className="space-y-1.5">
                {(x.repayments || []).map((rp) => (
                  <li key={rp.debt_repayment_id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm">
                    <span className="num">{dateFmt(rp.paid_on)}</span>
                    <span className="flex items-center gap-4"><span className="micro">int {money(rp.interest_part)}</span><span className="num text-[rgb(var(--primary))]">{money(rp.principal_part)}</span></span>
                  </li>
                ))}
              </ol>
            ) : <span className="micro">No repayments recorded yet.</span>}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export function DebtPage() {
  const { rows, error, loading, reload } = useList<api.DebtEngagement>("/financing");
  const [editing, setEditing] = React.useState<api.DebtEngagement | "new" | null>(null);
  const [repay, setRepay] = React.useState<api.DebtEngagement | null>(null);
  const [view, setView] = React.useState<api.DebtEngagement | null>(null);
  const list = rows || [];
  const totalPrincipal = list.reduce((s, r) => s + Number(r.principal || 0), 0);
  const activeCount = list.filter((r) => r.status === "ACTIVE").length;

  const columns: Column<api.DebtEngagement>[] = [
    { key: "lender", label: "Lender", render: (r) => <span className="font-medium text-foreground">{r.lender_name || r.lender_kind || "—"}</span> },
    { key: "lender_kind", label: "Kind", render: (r) => <Pill tone="mute">{(r.lender_kind || "—").replace(/_/g, " ")}</Pill> },
    { key: "principal", label: "Principal", className: "num text-right", render: (r) => money(r.principal) },
    { key: "interest_rate", label: "Rate", className: "num text-right", render: (r) => (r.interest_rate != null ? `${num(r.interest_rate)}%` : "—") },
    { key: "due_on", label: "Due", render: (r) => dateFmt(r.due_on) },
    { key: "status", label: "Status", render: (r) => <Pill tone={tone(r.status)}>{r.status}</Pill> },
    {
      key: "_a", label: "", render: (r) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
          {r.status === "ACTIVE" && <Button size="sm" variant="outline" onClick={() => setRepay(r)}>Repay</Button>}
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Finance" to="/finance" />} title="Financing" description="Loan facilities — drawdowns, repayments and outstanding principal." action={<Button onClick={() => setEditing("new")}>New facility</Button>} />
      <KpiRow>
        <KpiTile label="Facilities" value={num(list.length)} />
        <KpiTile label="Active" value={num(activeCount)} />
        <KpiTile label="Total principal" value={money(totalPrincipal)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => r.debt_engagement_id} onRowClick={(r) => setView(r)} empty={{ title: "No financing yet", hint: "Register a loan or credit facility to track drawdowns and repayments." }} />
      {editing !== null && <DebtForm row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {repay && <RepayForm debt={repay} onClose={() => setRepay(null)} onSaved={reload} />}
      {view && <DebtDrawer debt={view} onClose={() => setView(null)} onRepay={() => { setRepay(view); setView(null); }} />}
    </section>
  );
}
