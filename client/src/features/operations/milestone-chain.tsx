/**
 * A dossier's milestone chain — the operational view of one file.
 *
 * WHAT THE OLD VERSION SHOWED: a label, one date and a status pill. The engine
 * behind it now distinguishes the date the client was COMMITTED to from the
 * date we actually FORECAST, tracks health against the commitment, records who
 * a slip is attributed to, and can report that an SLA is already unreachable.
 * None of that was visible, so the one question this screen exists to answer —
 * "is this file going to be late, and whose fault is it" — could not be.
 *
 * TWO DATES, NOT THREE. The commitment leads because it is what was promised;
 * the forecast appears beside it ONLY when the two disagree, with the gap
 * spelled out ("4 days later"). Baseline is deliberately absent — it is the
 * yardstick for variance analytics, not something an ops user acts on, and a
 * third date on every row would bury the two that matter.
 *
 * THE BANNERS ARE THE POINT. A chain whose anchor has not landed is provisional
 * and says so; a chain forecast to miss its SLA says that at the top rather
 * than leaving someone to infer it from a row halfway down.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { errMsg, useResource } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import * as api from "@/lib/operations-api";

/** Whole days between two ISO dates — how a user reads a slip. */
function dayGap(a?: string | null, b?: string | null) {
  if (!a || !b) return 0;
  const ms = new Date(String(b).slice(0, 10)).getTime() - new Date(String(a).slice(0, 10)).getTime();
  return Math.round(ms / 86400000);
}

const gapLabel = (n: number) =>
  n === 0 ? "" : `${Math.abs(n)} ${Math.abs(n) === 1 ? "day" : "days"} ${n > 0 ? "later" : "earlier"}`;

/** Reopening is governed — a reason is required, so it gets its own dialog. */
function ReopenDialog({
  milestone,
  onClose,
  onDone,
}: {
  milestone: api.MilestoneInstance;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.reopenMilestone(milestone.milestone_instance_id, reason.trim());
      onDone();
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
      title={`Reopen ${milestone.label_fr || milestone.label || milestone.code}`}
      description="Completing a stage freezes its dates and records how late it ran. Reopening discards that measurement and re-forecasts everything after it, so it is recorded with a reason."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={busy || reason.trim().length < 3}>Reopen</Button>
        </>
      }
    >
      <Field label="Why is this being reopened?" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Marked complete on the wrong file" />
      </Field>
      {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
    </Modal>
  );
}

/** Insert a stage between two existing ones — the "a problem came up" case. */
function InsertDialog({
  dossierId,
  afterSeq,
  afterLabel,
  onClose,
  onDone,
}: {
  dossierId: string;
  afterSeq: number;
  afterLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [owner, setOwner] = React.useState<api.OwnerTier>("INTERNAL");
  const [hours, setHours] = React.useState("8");
  const [visible, setVisible] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.addDossierMilestone(dossierId, {
        after_seq: afterSeq,
        code: code.trim().toUpperCase(),
        label: label.trim(),
        owner_tier: owner,
        min_duration_hours: Number(hours) || 0,
        is_client_visible: visible,
      });
      onDone();
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
      title={`Insert a stage after ${afterLabel}`}
      description="For something this file needs that the template did not anticipate. Everything after it is re-forecast."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={busy || !code.trim() || !label.trim()}>Insert stage</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Code" required>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CUSTOMS_QUERY" />
        </Field>
        <Field label="Label" required>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Réserve douanière à lever" />
        </Field>
        <Field label="Owner" hint="Who a delay on this stage is attributed to.">
          <Select value={owner} onChange={(e) => setOwner(e.target.value as api.OwnerTier)}>
            {api.OWNER_TIERS.map((t) => (
              <option key={t} value={t}>{api.OWNER_TIER_LABEL[t]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Minimum duration (hours)" hint="The floor this stage cannot be compressed below.">
          <Input value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9]/g, ""))} className="num" />
        </Field>
        <Checkbox checked={visible} onCheckedChange={setVisible} label="Visible to the client on the portal" />
        {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
      </div>
    </Modal>
  );
}

export function MilestoneChain({ dossierId, compact = false }: { dossierId: string; compact?: boolean }) {
  const chain = useResource(() => api.milestonesByDossier(dossierId), [dossierId]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reopening, setReopening] = React.useState<api.MilestoneInstance | null>(null);
  const [inserting, setInserting] = React.useState<api.MilestoneInstance | null>(null);

  const rows = React.useMemo(() => chain.data || [], [chain.data]);

  async function advance(m: api.MilestoneInstance) {
    const to = api.nextMilestoneStatus(m.status);
    if (!to) return;
    setBusyId(m.milestone_instance_id);
    setError(null);
    try {
      await api.advanceMilestone(m.milestone_instance_id, { to });
      chain.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  async function recalc() {
    setBusyId("all");
    setError(null);
    try {
      await api.recalculateMilestones(dossierId);
      chain.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  if (chain.loading) return <SkeletonTable rows={5} cols={4} />;
  if (chain.error) return <ErrorState message={chain.error} />;
  if (!rows.length) {
    return (
      <EmptyState
        title="No milestone chain yet"
        hint="A chain is seeded from the service type's active template when the file is opened — this file has no service type, or that type has no template."
      />
    );
  }

  const breaching = rows.some((r) => r.health === "BREACH_FORECAST");
  const anchor = rows.find((r) => r.is_anchor);
  const provisional = !!anchor && anchor.status !== "DONE";
  const done = rows.filter((r) => r.status === "DONE").length;

  return (
    <div className="space-y-3">
      {breaching && (
        <Callout tone="bad" title="Forecast to miss the committed date">
          What remains will not fit before the SLA date even at each stage&apos;s minimum duration.
          The commitment is unchanged — this is the warning that it is now at risk.
        </Callout>
      )}
      {provisional && !breaching && (
        <Callout tone="info" title="Schedule is provisional">
          Dates after {anchor?.label_fr || anchor?.label || anchor?.code} are estimates until it actually
          happens; the rest of the chain re-forecasts from the real event.
        </Callout>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="micro">{done} of {rows.length} complete</span>
        {!compact && (
          <Button size="sm" variant="outline" onClick={recalc} loading={busyId === "all"}>
            Re-forecast
          </Button>
        )}
      </div>

      <ol className="space-y-1.5">
        {rows.map((m) => {
          const label = m.label_fr || m.label || m.code;
          const committed = m.planned_due || m.due_date;
          const forecast = m.forecast_due;
          const slip = dayGap(committed, forecast);
          const next = api.nextMilestoneStatus(m.status);
          return (
            <li key={m.milestone_instance_id} className="rounded-md border border-border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-foreground">{label}</span>
                    {m.is_target_lock && <Pill tone="orange">SLA</Pill>}
                    {m.is_anchor && <Pill tone="blue">anchor</Pill>}
                    {m.is_ad_hoc && <Pill tone="mute">added</Pill>}
                    {!m.is_client_visible && <Pill tone="mute">internal</Pill>}
                  </div>
                  <span className="micro">
                    {m.owner_tier ? api.OWNER_TIER_LABEL[m.owner_tier] : "—"}
                    {m.status === "DONE" && m.attributed_to && m.variance_hours != null && m.variance_hours > 0
                      ? ` · ${Math.round(m.variance_hours)}h late, charged to ${api.OWNER_TIER_LABEL[m.attributed_to]}`
                      : ""}
                    {m.reopen_reason ? ` · reopened: ${m.reopen_reason}` : ""}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="micro">{dateFmt(committed)}</div>
                    {/* The forecast appears only when it disagrees with the promise —
                        two identical dates on every row is noise. */}
                    {slip !== 0 && (
                      <div className={`micro ${slip > 0 ? "text-[rgb(var(--bad))]" : ""}`}>
                        forecast {dateFmt(forecast)} · {gapLabel(slip)}
                      </div>
                    )}
                  </div>
                  <Pill tone={api.milestoneHealthTone(m.health || m.status)}>
                    {api.MILESTONE_HEALTH_LABEL[String(m.health || m.status)] || m.status}
                  </Pill>
                  {!compact && (
                    <div className="flex items-center gap-1">
                      {next && (
                        <Button size="sm" variant="outline" loading={busyId === m.milestone_instance_id} onClick={() => advance(m)}>
                          {api.milestoneAdvanceLabel(m.status)}
                        </Button>
                      )}
                      {m.status === "DONE" && (
                        <Button size="sm" variant="ghost" onClick={() => setReopening(m)}>Reopen</Button>
                      )}
                      <button
                        type="button"
                        onClick={() => setInserting(m)}
                        aria-label={`Insert a stage after ${label}`}
                        className="px-1 text-muted-foreground hover:text-foreground"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {error && <ErrorState message={error} />}

      {reopening && (
        <ReopenDialog milestone={reopening} onClose={() => setReopening(null)} onDone={chain.reload} />
      )}
      {inserting && (
        <InsertDialog
          dossierId={dossierId}
          afterSeq={Number(inserting.stage_seq || 0)}
          afterLabel={inserting.label_fr || inserting.label || inserting.code || "this stage"}
          onClose={() => setInserting(null)}
          onDone={chain.reload}
        />
      )}
    </div>
  );
}
