/**
 * Salary advances (0698) — money already paid out, and the plan to get it back.
 *
 * ── WHY THIS SCREEN EXISTS AT ALL ─────────────────────────────────────────
 *
 * Advances have been approvable since 0330 and recoverable since never: the
 * request was approved, the employee was paid, and nothing expected it back.
 * Every one of those is on this screen the moment the migration runs — as
 * SUSPENDED, because nobody agreed a schedule and a migration must not start
 * taking money out of anybody's next payslip.
 *
 * So the primary job here is not "record an advance". It is: look at the debts
 * that already exist, agree a schedule with the person, and activate it.
 *
 * Desktop-first density: the outstanding total leads, the table fills the
 * remaining height with its own scroll, and the schedule editor is a modal
 * rather than an expanding row — a row that grows pushes every other debt off
 * the screen, which is the opposite of what this page is for.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { money } from "@/lib/format";
import * as api from "@/lib/hr-api";

const shell = pageShell.wide;

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "ok",
  SETTLED: "mute",
  SUSPENDED: "warn",
  WRITTEN_OFF: "bad",
};

const n = (v: unknown) => (v == null ? 0 : Number(v));
/** Next month — where recovery normally starts, the advance having just been paid. */
function nextPeriod() {
  const d = new Date();
  const y = d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 11 ? 1 : d.getUTCMonth() + 2;
  return `${y}-${String(m).padStart(2, "0")}`;
}

type Employee = { employee_id: string; full_name?: string | null };

function ScheduleModal({
  advance,
  onClose,
  onSaved,
}: {
  advance: api.SalaryAdvance;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    instalments: String(advance.instalments),
    instalment_amount: String(n(advance.instalment_amount)),
    first_period_code: advance.first_period_code,
    note: advance.note || "",
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const outstanding = n(advance.outstanding);
  const months = Number(f.instalments) || 1;
  const each = Number(f.instalment_amount) || 0;
  const covers = each * months >= outstanding;

  // Editing the number of months re-divides; editing the amount does not, so
  // an employer can agree either "over six months" or "40,000 a month" without
  // the other field fighting them.
  function setMonths(v: string) {
    const m = Number(v) || 1;
    setF((s) => ({
      ...s,
      instalments: v,
      instalment_amount: String(Math.ceil((outstanding / m) * 100) / 100),
    }));
  }

  async function submit(e: React.FormEvent, activate: boolean) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateAdvance(advance.salary_advance_id, {
        instalments: months,
        instalment_amount: each,
        first_period_code: f.first_period_code,
        note: f.note || undefined,
        ...(activate ? { status: "ACTIVE" as const } : {}),
      });
      onSaved();
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
      title="Recovery schedule"
      description={`${advance.employee_name || "This employee"} — ${money(outstanding)} outstanding`}
    >
      <form className="space-y-4" onSubmit={(e) => submit(e, false)}>
        {advance.status === "SUSPENDED" && (
          <Callout tone="warn" title="Nothing is being recovered">
            This advance is on hold. Agree the schedule below, then activate it —
            payroll starts taking the instalment from the first period named here.
          </Callout>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Over how many months">
            <Input
              type="number"
              min="1"
              max="60"
              className="num text-right"
              value={f.instalments}
              onChange={(e) => setMonths(e.target.value)}
            />
          </Field>
          <Field
            label="Each month"
            error={covers ? undefined : "These instalments never clear the advance."}
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              className="num text-right"
              value={f.instalment_amount}
              onChange={(e) => set("instalment_amount", e.target.value)}
            />
          </Field>
          <Field label="Starting" hint="Payroll period, YYYY-MM.">
            <Input
              value={f.first_period_code}
              onChange={(e) => set("first_period_code", e.target.value)}
              placeholder={nextPeriod()}
            />
          </Field>
          <Field label="Note" className="sm:col-span-2">
            <Input value={f.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
        </div>

        {/* The last instalment is the remainder, so the plan is honest about
            what the final month looks like rather than overshooting. */}
        <p className="text-xs text-muted-foreground">
          {months} × {money(each)} — the last one is capped at whatever is left.
        </p>

        {error && <ErrorState message={error} />}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="outline" loading={busy} disabled={!covers}>
            Save
          </Button>
          {advance.status !== "ACTIVE" && (
            <Button type="button" loading={busy} disabled={!covers} onClick={(e) => submit(e, true)}>
              Save &amp; activate
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function NewAdvanceForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: employees } = useList<Employee>("/employees");
  const [f, setF] = React.useState({
    employee_id: "",
    amount: "",
    instalments: "1",
    first_period_code: nextPeriod(),
    note: "",
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createAdvance({
        employee_id: f.employee_id,
        amount: Number(f.amount),
        instalments: Number(f.instalments) || 1,
        first_period_code: f.first_period_code,
        note: f.note || undefined,
      });
      onSaved();
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
      title="Record an advance"
      description="Money already paid out, and how it comes back."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Employee" required className="sm:col-span-2">
            <Select value={f.employee_id} onChange={(e) => set("employee_id", e.target.value)}>
              <option value="">—</option>
              {(employees || []).map((em) => (
                <option key={em.employee_id} value={em.employee_id}>
                  {em.full_name || em.employee_id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (XAF)" required>
            <Input
              type="number"
              min="0"
              className="num text-right"
              value={f.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </Field>
          <Field label="Over how many months" hint="The instalment is worked out from this.">
            <Input
              type="number"
              min="1"
              max="60"
              className="num text-right"
              value={f.instalments}
              onChange={(e) => set("instalments", e.target.value)}
            />
          </Field>
          <Field label="Starting" required hint="Payroll period, YYYY-MM.">
            <Input
              value={f.first_period_code}
              onChange={(e) => set("first_period_code", e.target.value)}
            />
          </Field>
          <Field label="Note" className="sm:col-span-2">
            <Input value={f.note} onChange={(e) => set("note", e.target.value)} />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!f.employee_id || !f.amount || busy}>
            Record
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AdvancesPage() {
  const q = useResource(() => api.listAdvances(), []);
  const [scheduling, setScheduling] = React.useState<api.SalaryAdvance | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const rows = q.data || [];
  const outstanding = rows
    .filter((a) => a.status === "ACTIVE" || a.status === "SUSPENDED")
    .reduce((t, a) => t + n(a.outstanding), 0);
  const unscheduled = rows.filter((a) => a.status === "SUSPENDED").length;

  async function suspend(a: api.SalaryAdvance) {
    setBusy(a.salary_advance_id);
    setError(null);
    try {
      await api.updateAdvance(a.salary_advance_id, {
        status: a.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
      });
      q.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const cols: Column<api.SalaryAdvance>[] = [
    {
      key: "emp",
      label: "Employee",
      render: (a) => (
        <span className="font-medium text-foreground">{a.employee_name || "—"}</span>
      ),
    },
    { key: "amount", label: "Advanced", className: "num text-right", render: (a) => money(a.amount) },
    {
      key: "recovered",
      label: "Recovered",
      className: "num text-right",
      render: (a) => <span className="text-muted-foreground">{money(a.recovered)}</span>,
    },
    {
      key: "outstanding",
      label: "Outstanding",
      className: "num text-right",
      render: (a) => (
        <span className={n(a.outstanding) > 0 ? "num font-semibold text-foreground" : "num text-muted-foreground"}>
          {money(a.outstanding)}
        </span>
      ),
    },
    {
      key: "plan",
      label: "Plan",
      render: (a) => (
        <span className="text-xs text-muted-foreground">
          {a.instalments} × {money(a.instalment_amount)} from {a.first_period_code}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (a) => <Pill tone={STATUS_TONE[a.status] || "mute"}>{a.status.replace("_", " ")}</Pill>,
    },
    {
      key: "_a",
      label: "",
      render: (a) =>
        a.status === "SETTLED" || a.status === "WRITTEN_OFF" ? null : (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              loading={busy === a.salary_advance_id}
              onClick={() => suspend(a)}
            >
              {a.status === "ACTIVE" ? "Pause" : "Resume"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setScheduling(a)}>
              Schedule
            </Button>
          </div>
        ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Human capital" to="/hr" />}
        title="Salary advances"
        description="Money paid out ahead of payroll, and the schedule that recovers it. Instalments come off net pay — the salary was already taxed."
        action={<Button onClick={() => setCreating(true)}>Record an advance</Button>}
      />
      <HubTabs />{" "}

      {/* The number that matters, before the table. */}
      <div className="mb-4 flex flex-wrap items-center gap-6 text-sm">
        <span className="text-muted-foreground">
          Outstanding <span className="num font-semibold text-foreground">{money(outstanding)}</span>
        </span>
        {unscheduled > 0 && (
          <span className="text-[rgb(var(--warn))]">
            {unscheduled} awaiting a schedule
          </span>
        )}
      </div>

      {unscheduled > 0 && (
        // The backfill. These are real debts nobody agreed a plan for, and
        // saying so is better than leaving them looking like paused decisions
        // somebody made on purpose.
        <div className="mb-4">
          <Callout tone="warn" title="Advances approved before recovery existed">
            These were paid out and never recovered. Nothing is being taken from
            anybody's pay until a schedule is agreed and activated.
          </Callout>
        </div>
      )}

      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}
      <DataList
        columns={cols}
        rows={q.data}
        error={q.error}
        loading={q.loading}
        rowKey={(a) => a.salary_advance_id}
        empty={{
          title: "No advances",
          hint: "Advances approved in the leave queue appear here with a recovery plan.",
        }}
      />
      {scheduling && (
        <ScheduleModal
          advance={scheduling}
          onClose={() => setScheduling(null)}
          onSaved={q.reload}
        />
      )}
      {creating && <NewAdvanceForm onClose={() => setCreating(false)} onSaved={q.reload} />}
      <ScreenAi path="hr/advances" />
    </section>
  );
}

export default AdvancesPage;
