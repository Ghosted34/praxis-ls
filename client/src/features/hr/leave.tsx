/**
 * Leave & allowances — request queue (replaces the CRUD table). Requests
 * (leave / salary advance / mission) come in as REQUESTED and are decided once —
 * Approve or Reject (MOD-15 "approve" permission). Managers work the pending
 * queue; a "New request" raises one.
 *
 * ── WHAT 0696 PUT ON THIS SCREEN, AND WHY IT HAD TO BE HERE ────────────────
 *
 * The approver could not see a balance, because there wasn't one: this screen
 * showed a name and two dates and offered an Approve button, and no part of the
 * product knew whether that person had a day left. Two columns close that —
 * DAYS (what the request costs, counted in working days with public holidays
 * excluded) and BALANCE (what they have) — and the balance is rendered in the
 * warning tone when the request would overdraw it, so the answer is legible
 * before the click rather than in the 422 after it.
 *
 * The balance is fetched per employee in the visible queue and cached for the
 * page: a pending list is short, and asking the server one question per person
 * is honest about what it costs. Requests that are not leave (advances,
 * missions) consume no entitlement and are not asked about at all.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, useList, errMsg } from "@/lib/use-resource";
import { money, dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";

const shell = pageShell.wide;

const STATUS_TONE: Record<string, Tone> = {
  REQUESTED: "warn",
  APPROVED: "ok",
  REJECTED: "bad",
  CANCELLED: "mute",
  TAKEN: "blue",
};
const KIND: Record<string, { label: string; tone: Tone }> = {
  leave: { label: "Leave", tone: "blue" },
  salary_advance: { label: "Salary advance", tone: "warn" },
  mission: { label: "Mission", tone: "mute" },
};
const kindOf = (k?: string | null) =>
  KIND[k || "leave"] || { label: k || "—", tone: "mute" as Tone };

const isLeave = (r: api.LeaveRequest) => (r.kind || "leave") === "leave";
const num = (v: unknown) => (v == null ? 0 : Number(v));
/** "4.5 days" / "1 day", without a trailing ".0" on whole days. */
const days = (v: number) => `${Math.round(v * 100) / 100} ${v === 1 ? "day" : "days"}`;

type Employee = { employee_id: string; full_name?: string | null };

/**
 * Balances for the employees on screen, fetched once each and cached.
 *
 * Keyed by employee: a single person's balances arrive for every leave type in
 * one call, so asking per type would be the same data several times over.
 */
function useBalances(rows: api.LeaveRequest[] | null) {
  const [byEmployee, setByEmployee] = React.useState<Record<string, api.LeaveBalance[]>>({});
  const wanted = React.useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows || []) if (isLeave(r) && r.employee_id) ids.add(r.employee_id);
    return [...ids];
  }, [rows]);

  React.useEffect(() => {
    let live = true;
    const missing = wanted.filter((id) => !(id in byEmployee));
    if (!missing.length) return undefined;
    (async () => {
      const pairs = await Promise.all(
        missing.map(async (id) => {
          try {
            return [id, await api.leaveBalances(id)] as const;
          } catch {
            // A balance we could not read must not blank the queue — the row
            // renders without one and the server still refuses an overdraw.
            return [id, []] as const;
          }
        }),
      );
      if (!live) return;
      setByEmployee((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    })();
    return () => {
      live = false;
    };
  }, [wanted, byEmployee]);

  /** The balance for one request's employee and leave type, or null if unknown. */
  return React.useCallback(
    (r: api.LeaveRequest): api.LeaveBalance | null => {
      if (!isLeave(r) || !r.employee_id) return null;
      const mine = byEmployee[r.employee_id];
      if (!mine) return null;
      return mine.find((b) => b.leave_type_id === r.leave_type_id) || null;
    },
    [byEmployee],
  );
}

/** The chosen employee's standing in the chosen leave type, on the form. */
function BalanceHint({
  employeeId,
  leaveTypeId,
}: {
  employeeId: string;
  leaveTypeId: string;
}) {
  const q = useResource(
    () => (employeeId ? api.leaveBalances(employeeId) : Promise.resolve([])),
    [employeeId],
  );
  if (!employeeId) return null;
  if (q.loading) return <p className="text-xs text-muted-foreground">Checking entitlement…</p>;
  const b = (q.data || []).find((x) => x.leave_type_id === leaveTypeId);
  if (!b) return null;
  return (
    <p className="text-xs text-muted-foreground">
      <span className={cn("num font-semibold", b.balance <= 0 ? "text-destructive" : "text-foreground")}>
        {days(b.balance)}
      </span>{" "}
      available for {b.period_year} — {days(b.accrued + b.carried)} earned, {days(b.taken)} taken.
    </p>
  );
}

function NewRequestForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: employees } = useList<Employee>("/employees");
  const types = useResource(() => api.leaveTypes(), []);
  const [f, setF] = React.useState({
    employee_id: "",
    kind: "leave",
    leave_type_id: "",
    starts_on: "",
    ends_on: "",
    reason: "",
    amount: "",
  });
  const [halfStart, setHalfStart] = React.useState(false);
  const [halfEnd, setHalfEnd] = React.useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const isAdvance = f.kind === "salary_advance";
  const wantsLeave = f.kind === "leave";

  // Default to the first type offered (ANNUAL is seeded first) rather than
  // leaving it blank — the server falls back to ANNUAL anyway, and a blank
  // select makes the balance hint below look broken.
  // Memoised: `types.data || []` mints a fresh array on every render, which
  // would re-run the defaulting effect below forever.
  const typeRows = React.useMemo(() => types.data || [], [types.data]);
  React.useEffect(() => {
    if (!f.leave_type_id && typeRows.length) set("leave_type_id", typeRows[0].leave_type_id);
  }, [typeRows, f.leave_type_id]);

  const chosenType = typeRows.find((t) => t.leave_type_id === f.leave_type_id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createLeave({
        employee_id: f.employee_id,
        kind: f.kind,
        leave_type_id: wantsLeave && f.leave_type_id ? f.leave_type_id : undefined,
        starts_on: f.starts_on || undefined,
        ends_on: f.ends_on || undefined,
        half_day_start: wantsLeave && halfStart ? true : undefined,
        half_day_end: wantsLeave && halfEnd ? true : undefined,
        reason: f.reason || undefined,
        amount: isAdvance && f.amount !== "" ? Number(f.amount) : undefined,
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
      title={tr("New request")}
      description="Raise a leave, salary-advance or mission request for approval."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Employee")} required>
            <Select
              value={f.employee_id}
              onChange={(e) => set("employee_id", e.target.value)}
            >
              <option value="">—</option>
              {(employees || []).map((em) => (
                <option key={em.employee_id} value={em.employee_id}>
                  {em.full_name || em.employee_id}
                </option>
              ))}
            </Select>
          </Field>
          {/* "Salary advance" was an option here AND a screen of its own, and
              the two wrote DIFFERENT TABLES — this form writes a leave_request
              of kind salary_advance, while the Advances tab writes the
              salary_advance row (0698) that payroll actually recovers against.
              An advance raised here was therefore invisible to the recovery
              schedule. Advances belong to their own tab; the kind is kept in
              the label map above so historical rows still render. */}
          <Field label="Request" required hint="Salary advances are raised from the Advances tab.">
            <Select
              value={f.kind}
              onChange={(e) => set("kind", e.target.value)}
            >
              <option value="leave">{tr("Leave")}</option>
              <option value="mission">Mission</option>
            </Select>
          </Field>
          {wantsLeave && (
            <Field
              label="Leave type"
              required
              className="sm:col-span-2"
              hint={
                chosenType && !chosenType.is_paid
                  ? "Unpaid — this leave still needs approving, and payroll treats it as unpaid."
                  : undefined
              }
            >
              <Select
                value={f.leave_type_id}
                onChange={(e) => set("leave_type_id", e.target.value)}
              >
                {typeRows.map((t) => (
                  <option key={t.leave_type_id} value={t.leave_type_id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={tr("From")}>
            <Input
              type="date"
              value={f.starts_on}
              onChange={(e) => set("starts_on", e.target.value)}
            />
          </Field>
          <Field label={tr("To")}>
            <Input
              type="date"
              value={f.ends_on}
              onChange={(e) => set("ends_on", e.target.value)}
            />
          </Field>
          {wantsLeave && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
              {/* The common real request is "from Wednesday afternoon until
                  Monday morning"; rounding both ends up costs the employee a
                  day they never took. */}
              <Checkbox
                checked={halfStart}
                onCheckedChange={(v) => setHalfStart(v === true)}
                label="First day is a half day"
              />
              <Checkbox
                checked={halfEnd}
                onCheckedChange={(v) => setHalfEnd(v === true)}
                label="Last day is a half day"
              />
            </div>
          )}
          {wantsLeave && (
            <div className="sm:col-span-2">
              <BalanceHint employeeId={f.employee_id} leaveTypeId={f.leave_type_id} />
            </div>
          )}
          {isAdvance && (
            <Field
              label={tr("Amount (XAF)")}
              hint="Recovered in payroll (→ 4211)"
              className="sm:col-span-2"
            >
              <Input
                type="number"
                min="0"
                className="num text-right"
                value={f.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </Field>
          )}
          <Field label={tr("Reason")} className="sm:col-span-2">
            <Input
              value={f.reason}
              onChange={(e) => set("reason", e.target.value)}
              placeholder="Optional — helps whoever decides this"
            />
          </Field>
        </div>
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
            disabled={!f.employee_id || busy}
          >
            Submit request
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function LeavePage() {
  const [pendingOnly, setPendingOnly] = React.useState(true);
  const q = useResource(
    // Advances have had their own tab since 0698, and were appearing here as
    // well — decided differently in each place (a date range and a day count
    // here, an amount and a recovery schedule there). Excluded SERVER-side
    // because this list is capped at 50 rows: filtering in the browser would
    // show fewer than fifty leave requests and present that as all of them.
    () =>
      api.listLeave({
        ...(pendingOnly ? { status: "REQUESTED" } : {}),
        exclude_kind: "salary_advance",
      }),
    [pendingOnly],
  );
  const balanceFor = useBalances(q.data);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  async function decide(r: api.LeaveRequest, status: "APPROVED" | "REJECTED") {
    setBusy(r.leave_request_id + status);
    setError(null);
    try {
      await api.decideLeave(r.leave_request_id, status);
      q.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(r: api.LeaveRequest) {
    setBusy(r.leave_request_id + "CANCEL");
    setError(null);
    try {
      await api.cancelLeave(r.leave_request_id);
      q.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const cols: Column<api.LeaveRequest>[] = [
    {
      key: "emp",
      label: "Employee",
      render: (r) => (
        <span className="font-medium text-foreground">
          {r.employee_name || r.employee_id?.slice(0, 8) || "—"}
        </span>
      ),
    },
    {
      key: "kind",
      label: "Type",
      render: (r) => {
        const k = kindOf(r.kind);
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={k.tone}>{k.label}</Pill>
            {isLeave(r) && r.leave_type_name && (
              <span className="text-xs text-muted-foreground">{r.leave_type_name}</span>
            )}
          </div>
        );
      },
    },
    {
      key: "period",
      label: "Period",
      render: (r) => (
        <span className="num text-muted-foreground">
          {r.starts_on ? dateFmt(r.starts_on) : "—"}
          {r.ends_on ? ` → ${dateFmt(r.ends_on)}` : ""}
        </span>
      ),
    },
    {
      key: "days",
      label: "Days",
      className: "num text-right",
      // What the request COSTS. Working days with weekends and public holidays
      // already excluded — frozen when the request was raised, so a later
      // change to the holiday calendar cannot re-price an approved booking.
      render: (r) =>
        isLeave(r) && num(r.days) > 0 ? (
          <span className="num text-foreground">
            {num(r.days)}
            {(r.half_day_start || r.half_day_end) && (
              <span className="ml-1 text-xs text-muted-foreground">½</span>
            )}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "balance",
      label: "Balance",
      className: "num text-right",
      // What they HAVE. The column that did not exist, and without which an
      // approval was a guess.
      render: (r) => {
        const b = balanceFor(r);
        if (!b) return <span className="text-muted-foreground">—</span>;
        const short = num(r.days) > 0 && b.balance < num(r.days) && !b.allow_negative;
        return (
          <span
            className={cn("num", short ? "font-semibold text-destructive" : "text-muted-foreground")}
            title={short ? "Approving this would overdraw the balance — the server will refuse it." : undefined}
          >
            {b.balance}
          </span>
        );
      },
    },
    {
      key: "amount",
      label: "Amount",
      className: "num text-right",
      render: (r) =>
        r.amount != null && Number(r.amount) > 0 ? money(r.amount) : "—",
    },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <Pill tone={STATUS_TONE[r.status] || "mute"}>{r.status}</Pill>
      ),
    },
    {
      key: "_a",
      label: "",
      render: (r) => {
        if (r.status === "REQUESTED") {
          return (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                loading={busy === r.leave_request_id + "REJECTED"}
                onClick={() => decide(r, "REJECTED")}
              >
                Reject
              </Button>
              <Button
                size="sm"
                loading={busy === r.leave_request_id + "APPROVED"}
                onClick={() => decide(r, "APPROVED")}
              >
                Approve
              </Button>
            </div>
          );
        }
        // APPROVED was terminal, so an employee whose plans changed left a
        // standing booking everyone had to remember. Cancelling gives the days
        // back with an opposite ledger entry.
        if (r.status === "APPROVED") {
          return (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                loading={busy === r.leave_request_id + "CANCEL"}
                onClick={() => cancel(r)}
              >
                Cancel
              </Button>
            </div>
          );
        }
        return null;
      },
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Human capital" to="/hr" />}
        title="Leave & allowances"
        description="Approve or reject leave, salary-advance and mission requests."
        action={<Button onClick={() => setCreating(true)}>{tr("New request")}</Button>}
      />
      <HubTabs />{" "}
      <div className="mb-4 inline-flex rounded-lg border p-0.5 text-sm">
        {[
          { k: true, l: "Pending" },
          { k: false, l: "All" },
        ].map((t) => (
          <button
            key={t.l}
            onClick={() => setPendingOnly(t.k)}
            className={cn(
              "rounded-md px-3 py-1.5 transition-colors",
              pendingOnly === t.k
                ? "bg-accent font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.l}
          </button>
        ))}
      </div>
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
        rowKey={(r) => r.leave_request_id}
        empty={{
          title: pendingOnly ? "Nothing pending" : "No requests",
          hint: pendingOnly
            ? "No requests awaiting a decision."
            : "Raise a request to get started.",
        }}
      />
      {creating && (
        <NewRequestForm onClose={() => setCreating(false)} onSaved={q.reload} />
      )}
      <ScreenAi path="hr/leave" />
    </section>
  );
}

export default LeavePage;
