/**
 * Leave & allowances — request queue (replaces the CRUD table). Requests
 * (leave / salary advance / mission) come in as REQUESTED and are decided once —
 * Approve or Reject (MOD-15 "approve" permission). Managers work the pending
 * queue; a "New request" raises one.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
};
const KIND: Record<string, { label: string; tone: Tone }> = {
  leave: { label: "Leave", tone: "blue" },
  salary_advance: { label: "Salary advance", tone: "warn" },
  mission: { label: "Mission", tone: "mute" },
};
const kindOf = (k?: string | null) =>
  KIND[k || "leave"] || { label: k || "—", tone: "mute" as Tone };

type Employee = { employee_id: string; full_name?: string | null };

function NewRequestForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { rows: employees } = useList<Employee>("/employees");
  const [f, setF] = React.useState({
    employee_id: "",
    kind: "leave",
    starts_on: "",
    ends_on: "",
    amount: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const isAdvance = f.kind === "salary_advance";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createLeave({
        employee_id: f.employee_id,
        kind: f.kind,
        starts_on: f.starts_on || undefined,
        ends_on: f.ends_on || undefined,
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
      title="New request"
      description="Raise a leave, salary-advance or mission request for approval."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Employee" required>
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
          <Field label="Type" required>
            <Select
              value={f.kind}
              onChange={(e) => set("kind", e.target.value)}
            >
              <option value="leave">Leave</option>
              <option value="salary_advance">Salary advance</option>
              <option value="mission">Mission</option>
            </Select>
          </Field>
          <Field label="From">
            <Input
              type="date"
              value={f.starts_on}
              onChange={(e) => set("starts_on", e.target.value)}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={f.ends_on}
              onChange={(e) => set("ends_on", e.target.value)}
            />
          </Field>
          {isAdvance && (
            <Field
              label="Amount (XAF)"
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
    () => api.listLeave(pendingOnly ? { status: "REQUESTED" } : undefined),
    [pendingOnly],
  );
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
        return <Pill tone={k.tone}>{k.label}</Pill>;
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
      render: (r) =>
        r.status === "REQUESTED" ? (
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
        ) : null,
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Human capital" to="/hr" />}
        title="Leave & allowances"
        description="Approve or reject leave, salary-advance and mission requests."
        action={<Button onClick={() => setCreating(true)}>New request</Button>}
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
