/**
 * Payroll — run workstation (replaces the CRUD table). A monthly run moves
 * OPEN → Compute → Submit → Approve → Validate (posts the GL journal) → Disburse,
 * with segregation of duties (compute vs approve are different permissions,
 * enforced server-side). Payslips drill into the Cameroon statutory breakdown.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { DocButton } from "@/components/doc-button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt } from "@/lib/format";
import * as api from "@/lib/hr-api";

const shell = pageShell.wide;

const STATUS_TONE: Record<string, Tone> = {
  OPEN: "mute",
  COMPUTED: "blue",
  SUBMITTED: "warn",
  APPROVED: "warn",
  VALIDATED: "ok",
  DISBURSED: "ok",
  REJECTED: "bad",
};
const n = (v: unknown) => Number(v || 0);

type Act = {
  label: string;
  kind: "compute" | "status";
  to?: string;
  variant?: "default" | "outline";
};
function actionsFor(status: string): Act[] {
  switch (status) {
    case "OPEN":
      return [{ label: "Compute payslips", kind: "compute" }];
    case "COMPUTED":
      return [
        { label: "Recompute", kind: "compute", variant: "outline" },
        { label: "Submit", kind: "status", to: "SUBMITTED" },
      ];
    case "SUBMITTED":
      return [
        { label: "Reject", kind: "status", to: "REJECTED", variant: "outline" },
        { label: "Approve", kind: "status", to: "APPROVED" },
      ];
    case "APPROVED":
      return [
        { label: "Validate & post to GL", kind: "status", to: "VALIDATED" },
      ];
    case "VALIDATED":
      return [{ label: "Mark disbursed", kind: "status", to: "DISBURSED" }];
    default:
      return [];
  }
}

/* ── Payslip breakdown (Cameroon statutory) ── */
function Breakdown({ slip }: { slip?: api.Slip | null }) {
  const b = slip || {};
  const ee = b.employee || {};
  const er = b.employer || {};
  const Row = ({ k, v }: { k: string; v: unknown }) => (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="num">{money(v as number)}</span>
    </div>
  );
  const att = b.attendance;
  const attDeduction = n(b.attendance_deduction);
  const unpaidLeave = n(b.unpaid_leave_deduction);
  const recovery = n(b.total_post_tax_deductions);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-x-8 gap-y-1 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-2">
        {b.base != null && <Row k="Base salary" v={b.base} />}
        {b.earnings ? <Row k="Bonus / earnings" v={b.earnings} /> : null}
        {/* OFF GROSS — the employee did not work the time and did not earn it,
            so the statutory figures below are computed on the smaller number.
            Shown as negatives so the arithmetic down to Gross reads. */}
        {attDeduction > 0 ? (
          <Row
            k={`Lateness / absence${att ? ` (${att.late_days} late, ${att.absent_days} absent)` : ""}`}
            v={-attDeduction}
          />
        ) : null}
        {unpaidLeave > 0 ? (
          <Row k={`Unpaid leave${att ? ` (${att.unpaid_leave_days} d)` : ""}`} v={-unpaidLeave} />
        ) : null}
        <Row k="Gross" v={b.gross} />
        <Row k="CNPS (employee)" v={ee.cnps_pension} />
        <Row k="IRPP" v={ee.irpp} />
        <Row k="CAC" v={ee.cac} />
        <Row k="CFC (employee)" v={ee.cfc} />
        {/* OFF NET — they earned the full salary and were taxed on it; this is
            money they already received in an earlier month. */}
        {recovery > 0 ? (
          <>
            <Row k="Net before recovery" v={b.net_before_recovery} />
            {(b.post_tax_deductions || []).map((d, i) => (
              <Row key={i} k={d.label} v={-d.amount} />
            ))}
          </>
        ) : null}
        <Row k="Net pay" v={b.net_pay} />
        <Row k="Employer charges" v={b.total_employer_charges} />
        <Row
          k="— CNPS employer"
          v={n(er.pension) + n(er.family) + n(er.injury)}
        />
      </div>
      {b.advance && b.advance.recovered < b.advance.due && (
        // The instalment was capped at the net available. Saying so stops the
        // shortfall reading as a settled month.
        <p className="text-[11px] text-[rgb(var(--warn))]">
          Only {money(b.advance.recovered)} of the {money(b.advance.due)} instalment
          fitted this payslip. {money(b.advance.outstanding_after)} still outstanding.
        </p>
      )}
      {att && !att.reconciled && (
        <p className="text-[11px] text-muted-foreground">
          No day in this period was reconciled, so no lateness or absence has been
          applied.
        </p>
      )}
      {att && att.waived_days > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {att.waived_days} day(s) waived and not charged.
        </p>
      )}
    </div>
  );
}

/* ── Run detail (payslips + lifecycle) ── */
function RunDetail({
  runId,
  onClose,
  onChanged,
}: {
  runId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const run = useResource(() => api.getPayrollRun(runId), [runId]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [openItem, setOpenItem] = React.useState<string | null>(null);
  const d = run.data;
  const items = d?.items || [];
  const totals = items.reduce(
    (t, it) => ({
      gross: t.gross + n(it.gross),
      net: t.net + n(it.net_pay),
      er: t.er + n(it.breakdown?.total_employer_charges),
    }),
    { gross: 0, net: 0, er: 0 },
  );

  async function run_(a: Act) {
    setBusy(a.label);
    setError(null);
    try {
      if (a.kind === "compute") await api.computePayroll(runId);
      else await api.setPayrollStatus(runId, a.to!);
      run.reload();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const cols: Column<api.PayrollItem>[] = [
    {
      key: "emp",
      label: "Employee",
      render: (it) => (
        <span className="font-medium text-foreground">
          {it.employee_name || it.employee_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "gross",
      label: "Gross",
      className: "num text-right",
      render: (it) => money(it.gross),
    },
    {
      key: "net",
      label: "Net pay",
      className: "num text-right",
      render: (it) => money(it.net_pay),
    },
    {
      key: "_a",
      label: "",
      render: (it) => (
        <div className="flex justify-end gap-2">
          {it.payroll_run_item_id && (
            <DocButton
              docType="PAYSLIP"
              id={it.payroll_run_item_id}
              title={`Payslip ${it.employee_name || ""}`.trim()}
              label="Payslip"
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setOpenItem(openItem === it.employee_id ? null : it.employee_id)
            }
          >
            {openItem === it.employee_id ? "Hide" : "Breakdown"}
          </Button>
        </div>
      ),
    },
  ];

  const headerRight = d ? (
    <div className="flex items-center gap-2">
      <Pill tone={STATUS_TONE[d.status] || "mute"}>{d.status}</Pill>
      {d.entry_id && <Pill tone="ok">Posted to GL</Pill>}
    </div>
  ) : undefined;

  const footer =
    d && actionsFor(d.status).length ? (
      <>
        {actionsFor(d.status).map((a) => (
          <Button
            key={a.label}
            variant={a.variant || "default"}
            loading={busy === a.label}
            onClick={() => run_(a)}
          >
            {a.label}
          </Button>
        ))}
      </>
    ) : undefined;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={d ? `Payroll · ${d.period_code}` : "Payroll run"}
      description={d ? `${num(items.length)} employees` : "Loading…"}
      headerRight={headerRight}
      footer={footer}
    >
      {run.loading ? (
        <div className="py-10 text-center micro">Loading run…</div>
      ) : run.error ? (
        <ErrorState message={run.error} />
      ) : d ? (
        <div className="space-y-5">
          <KpiRow>
            <KpiTile label="Employees" value={num(items.length)} />
            <KpiTile label="Gross" value={money(totals.gross)} />
            <KpiTile label="Net pay" value={money(totals.net)} />
            <KpiTile label="Employer charges" value={money(totals.er)} />
          </KpiRow>

          {error && <ErrorState message={error} />}

          {items.length === 0 ? (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              No payslips yet — Compute to generate them over the active roster.
            </div>
          ) : (
            <div className="space-y-2">
              <DataList
                columns={cols}
                rows={items}
                loading={false}
                error={null}
                rowKey={(it) => it.employee_id}
              />
              {openItem && (
                <Breakdown
                  slip={
                    items.find((it) => it.employee_id === openItem)?.breakdown
                  }
                />
              )}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

/* ── New run ── */
type Entity = {
  entity_id: string;
  code?: string | null;
  legal_name?: string | null;
  name?: string | null;
};
function NewRunForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { rows: entities } = useList<Entity>("/entities");
  const [entityId, setEntityId] = React.useState("");
  const [period, setPeriod] = React.useState(() =>
    new Date().toISOString().slice(0, 7),
  ); // YYYY-MM
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const run = await api.createPayrollRun({
        entity_id: entityId,
        period_code: period,
      });
      onSaved(run.payroll_run_id);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="New payroll run"
      description="One run per entity per month. Compute generates payslips over the active roster."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Entity" required>
          <Select
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
          >
            <option value="">—</option>
            {(entities || []).map((en) => (
              <option key={en.entity_id} value={en.entity_id}>
                {en.code ? `${en.code} — ` : ""}
                {en.legal_name || en.name || en.entity_id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Period" hint="Month (YYYY-MM)" required>
          <Input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={!entityId || !period || busy}
          >
            Create run
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function PayrollPage() {
  const runs = useResource(() => api.listPayrollRuns(), []);
  const [view, setView] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const cols: Column<api.PayrollRun>[] = [
    {
      key: "period",
      label: "Period",
      render: (r) => (
        <span className="font-medium text-foreground">{r.period_code}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <Pill tone={STATUS_TONE[r.status] || "mute"}>{r.status}</Pill>
      ),
    },
    {
      key: "gl",
      label: "GL",
      render: (r) =>
        r.entry_id ? (
          <Pill tone="ok">Posted</Pill>
        ) : (
          <span className="micro">—</span>
        ),
    },
    {
      key: "created",
      label: "Created",
      render: (r) => <span className="num">{dateFmt(r.created_at)}</span>,
    },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setView(r.payroll_run_id)}
          >
            Open
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Human capital" to="/hr" />}
        title="Payroll"
        description="Monthly runs — compute payslips, run the approval chain, and post the payroll journal."
        action={<Button onClick={() => setCreating(true)}>New run</Button>}
      />
      <HubTabs />
      <DataList
        columns={cols}
        rows={runs.data}
        error={runs.error}
        loading={runs.loading}
        rowKey={(r) => r.payroll_run_id}
        empty={{
          title: "No payroll runs",
          hint: "Create a run for the month to begin.",
        }}
      />
      {view && (
        <RunDetail
          runId={view}
          onClose={() => setView(null)}
          onChanged={runs.reload}
        />
      )}
      {creating && (
        <NewRunForm
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            runs.reload();
            setView(id);
          }}
        />
      )}
      <ScreenAi path="hr/payroll" />
    </section>
  );
}

export default PayrollPage;
