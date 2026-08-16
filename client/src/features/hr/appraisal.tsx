/**
 * Appraisals — performance review + reward (replaces the CRUD table). Each row is
 * a KPI rating; a manager can recommend a performance reward, which becomes a
 * PENDING payroll earning (added to gross next run, then locked once paid). This
 * is the appraisal → pay link.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { ScreenAi } from "@/components/screen-ai";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { AppraisalReviewModal } from "./appraisal-review";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, num, dateFmt } from "@/lib/format";
import * as api from "@/lib/hr-api";

const shell = pageShell.wide;
const rate = (v: string | number | null | undefined) =>
  v == null ? "—" : `${num(v)} / 5`;

function RewardBadge({ a }: { a: api.Appraisal }) {
  if (a.reward_status === "APPLIED")
    return <Pill tone="ok">Paid · {money(a.reward_amount)}</Pill>;
  if (a.reward_status === "PENDING")
    return <Pill tone="warn">Reward · {money(a.reward_amount)}</Pill>;
  return <span className="micro">—</span>;
}

function RewardForm({
  appraisal,
  onClose,
  onSaved,
}: {
  appraisal: api.Appraisal;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = React.useState(
    appraisal.reward_amount != null ? String(appraisal.reward_amount) : "",
  );
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.recommendReward(appraisal.appraisal_id, {
        amount: Number(amount),
        label: label.trim() || undefined,
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
      title="Recommend reward"
      description={`${appraisal.employee_name || "Employee"} · ${appraisal.period_code}. Added to gross next payroll run (taxable), then locked once paid.`}
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Reward amount (XAF)" required>
          <Input
            type="number"
            min="0"
            className="num text-right"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Label" hint="Optional — shows on the payslip">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`Performance bonus ${appraisal.period_code}`}
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
          <Button type="submit" loading={busy} disabled={amount === "" || busy}>
            Recommend reward
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The round, as opposed to the rows.
 *
 * `period_code` was a string on each KPI row, so nothing knew a review round
 * was open, scoring or finished, and "who has not been appraised for H1?" was
 * unanswerable — which is the single question anybody running one asks. A cycle
 * makes that a fact, and `Score from evidence` fills the grid from what the
 * system already knows instead of leaving a manager to remember twelve people.
 */
function CyclesPanel({ onOpenReview }: { onOpenReview: (id: string) => void }) {
  const cycles = useResource(() => api.appraisalCycles(), []);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const reviews = useResource(
    () => (openId ? api.listReviews({ cycle_id: openId }) : Promise.resolve([])),
    [openId],
  );

  async function score(id: string) {
    setBusy(id + "score");
    setError(null);
    setNote(null);
    try {
      const out = await api.scoreCycle(id);
      // "Skipped" is not a failure — those are the rows a human has decided,
      // which the scorer will never overwrite. Saying so is what makes the
      // button safe to press twice.
      setNote(
        `Scored ${out.scored} rating(s) across ${out.employees} employee(s).` +
          (out.skipped ? ` ${out.skipped} left alone — already set by a person.` : ""),
      );
      reviews.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function move(id: string, status: string) {
    setBusy(id + status);
    setError(null);
    try {
      await api.setCycleStatus(id, status);
      cycles.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const rows = cycles.data || [];
  if (!rows.length) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {error && <ErrorState message={error} />}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {rows.slice(0, 4).map((c) => (
        <div key={c.appraisal_cycle_id} className="lux-card flex flex-col gap-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{c.name}</span>
              <Pill tone={c.status === "RELEASED" ? "ok" : c.status === "CLOSED" ? "mute" : "warn"}>
                {c.status}
              </Pill>
              <span className="text-xs text-muted-foreground">
                {dateFmt(c.starts_on)} – {dateFmt(c.ends_on)}
                {c.review_count ? ` · ${c.settled_count}/${c.review_count} settled` : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOpenId(openId === c.appraisal_cycle_id ? null : c.appraisal_cycle_id)}
              >
                {openId === c.appraisal_cycle_id ? "Hide reviews" : "Reviews"}
              </Button>
              {["OPEN", "SCORING", "CALIBRATION"].includes(c.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === c.appraisal_cycle_id + "score"}
                  onClick={() => score(c.appraisal_cycle_id)}
                >
                  Score from evidence
                </Button>
              )}
              {c.status === "SCORING" && (
                <Button
                  size="sm"
                  loading={busy === c.appraisal_cycle_id + "RELEASED"}
                  onClick={() => move(c.appraisal_cycle_id, "RELEASED")}
                >
                  Release
                </Button>
              )}
            </div>
          </div>

          {openId === c.appraisal_cycle_id && (
            <div className="flex flex-col gap-1 border-t pt-2">
              {(reviews.data || []).map((r) => (
                <button
                  key={r.appraisal_review_id}
                  type="button"
                  onClick={() => onOpenReview(r.appraisal_review_id)}
                  className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-accent"
                >
                  <span className="text-foreground">{r.employee_name || "—"}</span>
                  <span className="flex items-center gap-2">
                    {r.overall_score != null && <span className="num text-muted-foreground">{r.overall_score}</span>}
                    <Pill tone={r.status === "DISPUTED" ? "bad" : r.status === "ACKNOWLEDGED" ? "ok" : "mute"}>
                      {r.status}
                    </Pill>
                  </span>
                </button>
              ))}
              {!(reviews.data || []).length && !reviews.loading && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  No reviews opened for this cycle yet.
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function AppraisalsPage() {
  const list = useResource(() => api.listAppraisals(), []);
  const [reward, setReward] = React.useState<api.Appraisal | null>(null);
  const [reviewId, setReviewId] = React.useState<string | null>(null);

  const cols: Column<api.Appraisal>[] = [
    {
      key: "emp",
      label: "Employee",
      render: (a) => (
        <span className="font-medium text-foreground">
          {a.employee_name || a.employee_id?.slice(0, 8) || "—"}
        </span>
      ),
    },
    {
      key: "period",
      label: "Period",
      render: (a) => <span className="num">{a.period_code}</span>,
    },
    {
      key: "metric",
      label: "KPI",
      render: (a) => (
        <span className="text-muted-foreground">{a.metric || "—"}</span>
      ),
    },
    {
      key: "rating",
      label: "Rating",
      className: "num text-right",
      render: (a) => rate(a.rating),
    },
    {
      key: "weighted",
      label: "Weighted",
      className: "num text-right",
      render: (a) => (a.weighted_score != null ? num(a.weighted_score) : "—"),
    },
    { key: "reward", label: "Reward", render: (a) => <RewardBadge a={a} /> },
    {
      key: "_a",
      label: "",
      render: (a) => (
        <div className="flex justify-end">
          {a.reward_status === "APPLIED" ? (
            <span className="micro">locked</span>
          ) : (
            <Button
              size="sm"
              variant={a.reward_status === "PENDING" ? "outline" : "default"}
              onClick={() => setReward(a)}
            >
              {a.reward_status === "PENDING"
                ? "Adjust reward"
                : "Recommend reward"}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Human capital" to="/hr" />}
        title="Appraisals"
        description="KPI ratings and performance rewards. A recommended reward is added to the employee's next payroll run."
      />
      <HubTabs />{" "}
      <CyclesPanel onOpenReview={setReviewId} />
      <DataList
        columns={cols}
        rows={list.data}
        error={list.error}
        loading={list.loading}
        rowKey={(a) => a.appraisal_id}
        empty={{
          title: "No appraisals",
          hint: "Rate an employee against a KPI target to begin.",
        }}
      />
      {reviewId && (
        <AppraisalReviewModal
          reviewId={reviewId}
          onClose={() => setReviewId(null)}
          onSaved={list.reload}
        />
      )}
      {reward && (
        <RewardForm
          appraisal={reward}
          onClose={() => setReward(null)}
          onSaved={list.reload}
        />
      )}
      <ScreenAi path="hr/appraisals" />
    </section>
  );
}

export default AppraisalsPage;
