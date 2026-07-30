/**
 * Appraisals — performance review + reward (replaces the CRUD table). Each row is
 * a KPI rating; a manager can recommend a performance reward, which becomes a
 * PENDING payroll earning (added to gross next run, then locked once paid). This
 * is the appraisal → pay link.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num } from "@/lib/format";
import * as api from "@/lib/hr-api";

const shell = "mx-auto max-w-6xl animate-fade-in";
const rate = (v: string | number | null | undefined) => (v == null ? "—" : `${num(v)} / 5`);

function RewardBadge({ a }: { a: api.Appraisal }) {
  if (a.reward_status === "APPLIED") return <Pill tone="ok">Paid · {money(a.reward_amount)}</Pill>;
  if (a.reward_status === "PENDING") return <Pill tone="warn">Reward · {money(a.reward_amount)}</Pill>;
  return <span className="micro">—</span>;
}

function RewardForm({ appraisal, onClose, onSaved }: { appraisal: api.Appraisal; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = React.useState(appraisal.reward_amount != null ? String(appraisal.reward_amount) : "");
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.recommendReward(appraisal.appraisal_id, { amount: Number(amount), label: label.trim() || undefined });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Recommend reward" description={`${appraisal.employee_name || "Employee"} · ${appraisal.period_code}. Added to gross next payroll run (taxable), then locked once paid.`}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Reward amount (XAF)" required><Input type="number" min="0" className="num text-right" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Label" hint="Optional — shows on the payslip"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`Performance bonus ${appraisal.period_code}`} /></Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={amount === "" || busy}>Recommend reward</Button>
        </div>
      </form>
    </Modal>
  );
}

export function AppraisalsPage() {
  const list = useResource(() => api.listAppraisals(), []);
  const [reward, setReward] = React.useState<api.Appraisal | null>(null);

  const cols: Column<api.Appraisal>[] = [
    { key: "emp", label: "Employee", render: (a) => <span className="font-medium text-foreground">{a.employee_name || a.employee_id?.slice(0, 8) || "—"}</span> },
    { key: "period", label: "Period", render: (a) => <span className="num">{a.period_code}</span> },
    { key: "metric", label: "KPI", render: (a) => <span className="text-muted-foreground">{a.metric || "—"}</span> },
    { key: "rating", label: "Rating", className: "num text-right", render: (a) => rate(a.rating) },
    { key: "weighted", label: "Weighted", className: "num text-right", render: (a) => (a.weighted_score != null ? num(a.weighted_score) : "—") },
    { key: "reward", label: "Reward", render: (a) => <RewardBadge a={a} /> },
    {
      key: "_a", label: "",
      render: (a) => (
        <div className="flex justify-end">
          {a.reward_status === "APPLIED" ? (
            <span className="micro">locked</span>
          ) : (
            <Button size="sm" variant={a.reward_status === "PENDING" ? "outline" : "default"} onClick={() => setReward(a)}>
              {a.reward_status === "PENDING" ? "Adjust reward" : "Recommend reward"}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader eyebrow={<HubCrumb area="Human capital" to="/hr" />} title="Appraisals" description="KPI ratings and performance rewards. A recommended reward is added to the employee's next payroll run." />
      <HubTabs />      <DataList columns={cols} rows={list.data} error={list.error} loading={list.loading} rowKey={(a) => a.appraisal_id} empty={{ title: "No appraisals", hint: "Rate an employee against a KPI target to begin." }} />
      {reward && <RewardForm appraisal={reward} onClose={() => setReward(null)} onSaved={list.reload} />}
      <ScreenAi path="hr/appraisals" />
    </section>
  );
}

export default AppraisalsPage;
