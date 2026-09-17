/**
 * The Full view — the reconciliation sheet's picture (§6.2, PR 3).
 *
 * Three questions, three charts, in the order the owner asked them:
 *
 *   1. SPEND BY LINE — budget against disbursed against actual, per line.
 *      The first thing a reader asks of the picture, and what the Consumption
 *      Track on the sheet summarises into one bar. Over-budget lines say so
 *      in bad: colour carries emphasis, never the only meaning — the numbers
 *      and the hint column stay textual.
 *   2. THE VARIANCE WATERFALL — from the budget down to what actually went
 *      out, line by line. The "+4%" a person's eyes skip over on the sheet
 *      becomes "where it went".
 *   3. SPEND OVER THE FILE'S LIFE — the cumulative curve against the flat
 *      budget benchmark, possible only since PR 2 dated cost_entry.spent_on
 *      (dom-created cost entries fall back to their posting day — server
 *      side, one rule, netAmountSql).
 *
 * The charts lazy-load: chart.tsx resolves the recharts chunk only when the
 * drawer is open and the chart is on screen, so a reconciliation edit is
 * never delayed by chart code. The drawer itself renders nothing until open
 * either — a modal that is never opened pays for its content once, in one
 * render loop constant.
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { Dialog } from "@/components/ui/dialog";
import { Chart, SeriesBars, Waterfall, Trend, ConsumptionTrack } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useResource } from "@/lib/use-resource";
import { getReconTimeline, type ReconGrades, type ReconLine, type ReconSheet } from "@/lib/costing-api";
import { money } from "@/lib/format";

/* ── The three grades, THREE labelled verdicts (Q17) ─────────────────────── */

/**
 * One grade, always with its QUESTION — otherwise the verdict "Within budget"
 * reads as a statement about money the client cared about, when it may be
 * about efficiency on a file quoted too cheap (the case Q17 was written for).
 */
function GradeCell({
  question,
  label,
  tone,
  detail,
}: {
  question: string;
  label: string;
  tone: "ok" | "warn" | "bad" | "mute";
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-micro">{question}</div>
      <div
        className={
          tone === "ok"
            ? "text-sm font-medium text-[rgb(var(--ok))]"
            : tone === "warn"
              ? "text-sm font-medium text-[rgb(var(--warn))]"
              : tone === "bad"
                ? "text-sm font-medium text-[rgb(var(--bad))]"
                : "text-sm font-medium text-muted-foreground"
        }
      >
        {label}
      </div>
      <div className="micro num tabular-nums">{detail}</div>
    </div>
  );
}

/** The strip the sheet and the drawer share: three verdicts, three questions. */
export function GradesStrip({ grades, totals }: { grades: ReconGrades; totals: ReconSheet["totals"] }) {
  const exec = grades.execution;
  const acc = grades.accountability;
  const com = grades.commercial;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <GradeCell
        question={tr("Did we execute to plan?")}
        label={exec.label}
        tone={
          exec.key === "PENDING" ? "mute"
            : exec.key === "WITHIN_BUDGET" ? "ok"
            : "bad"
        }
        detail={
          exec.key === "PENDING"
            ? tr("No actuals recorded yet")
            : exec.key === "WITHIN_BUDGET"
              ? `${money(totals.variance)} ${tr("under the allowance")}`
              : `${money(-totals.variance)} ${tr("past the allowance")}`
        }
      />
      <GradeCell
        question={tr("Is the cash accounted for?")}
        label={acc.label}
        tone={acc.key === "ACCOUNTED" ? "ok" : "warn"}
        detail={
          acc.key === "ACCOUNTED"
            ? tr("Everything not spent came back to the vault.")
            : `${money(acc.amount)} ${tr("still to account for")}`
        }
      />
      <GradeCell
        question={tr("Did the file make money?")}
        label={com.label}
        tone={
          com.key === "NO_QUOTE" ? "mute"
            : com.key === "PROFITABLE" ? "ok"
            : "bad"
        }
        detail={
          com.key === "NO_QUOTE"
            ? tr("No accepted quotation on file — the margin question does not arise.")
            : totals.margin_ht === null || totals.margin_ht === undefined
              ? "—"
              : `${totals.margin_ht >= 0 ? "+" : ""}${money(totals.margin_ht)} HT ${com.key === "PROFITABLE" ? tr("earned over the actual cost") : tr("below the quoted price")}`
        }
      />
    </div>
  );
}

/* ── The drawer ──────────────────────────────────────────────────────────── */

function fmtDate(ddMmYyyy: string) {
  // The wire is ISO; the picture is read day-first (§6.4).
  const [y, m, d] = ddMmYyyy.split("-");
  return y && m && d ? `${d}/${m}/${y}` : ddMmYyyy;
}

function spendByLine(lines: ReconLine[]) {
  return {
    series: [
      { key: "budget", label: tr("Budget"), tone: "neutral" as const },
      { key: "disbursed", label: tr("Disbursed"), tone: "accent" as const },
      { key: "actual", label: tr("Actual"), tone: "ok" as const },
    ],
    data: lines.map((l) => ({
      label: l.item_code ? `${l.item_code} · ${l.label}` : l.label,
      values: { budget: l.budget_ttc, disbursed: l.disbursed, actual: l.actual_ttc },
      // Emphasis in place of the narrative: over-budget actuals say so in bad.
      tones: { actual: l.over_budget ? ("bad" as const) : ("ok" as const) },
    })),
  };
}

function waterfallOf(sheet: ReconSheet) {
  const b = sheet.totals.budget_ttc;
  const a = sheet.totals.actual_ttc;
  // Deltas as (actual − budget): a delta going DOWN is money saved (line
  // underspent, under budget → ok), one going UP is overspent line (bad) —
  // the caller declares both the tones and the legend labels to match.
  const deltas = sheet.lines
    .filter((l) => Math.abs((l.actual_ttc || 0) - (l.budget_ttc || 0)) > 0.005)
    .map((l) => ({
      label: l.label,
      kind: "delta" as const,
      value: Math.round(((l.actual_ttc || 0) - (l.budget_ttc || 0)) * 100) / 100,
    }));
  return [
    { label: tr("Budget"), kind: "total" as const, value: b },
    ...deltas,
    { label: tr("Actual"), kind: "total" as const, value: a },
  ];
}

export function FullViewDrawer({
  open,
  onClose,
  sheet,
  dossierLabel,
}: {
  open: boolean;
  onClose: () => void;
  sheet: ReconSheet;
  dossierLabel?: string | null;
}) {
  const timeline = useResource(
    () => (open ? getReconTimeline(sheet.dossier_id) : Promise.resolve(null)),
    [open, sheet.dossier_id],
  );

  const bars = React.useMemo(() => spendByLine(sheet.lines), [sheet.lines]);
  const fall = React.useMemo(() => waterfallOf(sheet), [sheet]);

  const trend = React.useMemo(() => {
    if (!timeline.data) return null;
    let cum = 0;
    return timeline.data.days.map((d) => {
      cum += d.actual_ttc;
      return {
        label: fmtDate(d.day),
        value: Math.round(cum * 100) / 100,
        benchmark: timeline.data!.budget_ttc,
      };
    });
  }, [timeline.data]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      placement="right"
      size="xl"
      title={tr("Full view — the picture of the file")}
      description={dossierLabel ? `${tr("File")} ${dossierLabel}` : undefined}
    >
      <div className="space-y-6">
        {/* The track, bigger here — this is the summary again, at the drawer's
            size, so a person grabbing one screenshot takes the one they mean. */}
        <section aria-label={tr("Consumption summary")}>
          <ConsumptionTrack
            budget={sheet.totals.budget_ttc}
            disbursed={sheet.totals.disbursed}
            actual={sheet.totals.actual_ttc}
            labels={{ budget: tr("Budget"), disbursed: tr("Disbursed"), actual: tr("Actual") }}
            values={{
              budget: money(sheet.totals.budget_ttc),
              disbursed: money(sheet.totals.disbursed),
              actual: money(sheet.totals.actual_ttc),
            }}
          />
        </section>

        <section aria-label={tr("Spend by line")}>
          <Chart
            title={tr("Spend by line")}
            description={tr("Budget against disbursed against actual — every line says its own three.")}
            height={Math.min(360, 56 + bars.data.length * 30)}
            ariaLabel={tr("Budget against disbursed against actual, per budget line")}>
            <SeriesBars data={bars.data} series={bars.series} height={Math.min(320, 32 + bars.data.length * 28)} formatValue={money} />
          </Chart>
        </section>

        <section aria-label={tr("Where the variance went")}>
          <Chart
            title={tr("Where the variance went")}
            description={tr("From the budget down to what actually went out, line by line.")}
            height={320}
            ariaLabel={tr("Waterfall from the budget to the actual, per line")}>
            <Waterfall
              data={fall}
              height={280}
              formatValue={money}
              seriesTone={{ positive: "bad", negative: "ok", total: "neutral" }}
              legendLabels={{ positive: tr("Overspent line"), negative: tr("Under budget"), total: tr("Totals") }}
            />
          </Chart>
        </section>

        <Chart
          title={timeline.data ? tr("Spend across the life of the file") : tr("Spend across the life of the file")}
          description={tr("The cumulative curve against the flat budget — the day the money actually left (spent_on).")}
          height={300}
          ariaLabel={tr("Cumulative spend against budget over the life of the file")}
        >
          {timeline.error ? (
            <ErrorState message={tr("The spend history could not be loaded.")} />
          ) : timeline.loading || !timeline.data ? (
            <Skeleton className="h-[280px] w-full rounded-md" />
          ) : trend && trend.length ? (
            <Trend
              data={trend}
              height={260}
              formatValue={money}
              valueLabel={tr("Cumulative spend")}
              benchmarkLabel={tr("Budget")}
            />
          ) : (
            <p className="micro">{tr("No posted spend yet — the curve starts with the first settled entry.")}</p>
          )}
        </Chart>
      </div>
    </Dialog>
  );
}

/** The one-liner on the sheet that opens the picture. Re-exported names for
 *  screens to build their own if they need them; the sheet does not reuse the
 *  wrapper — it renders ConsumptionTrack directly and the drawer on demand. */
export { ConsumptionTrack };
