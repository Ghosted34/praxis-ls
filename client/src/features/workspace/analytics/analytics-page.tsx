/**
 * Analytics — the fourth Workspace section, and the one that reports on the
 * other three.
 *
 * ── THE PROMISE THIS SCREEN MAKES ──────────────────────────────────────────
 *
 * Every figure here is the count of rows the reader could have paged through
 * themselves on the Tasks list. The server produces all of them from the SAME
 * visibility predicate the list and the board filter on, so "17 overdue" and a
 * list of seventeen rows are one statement rather than two that happen to
 * agree today. That is the acceptance criterion, not a nicety: a dashboard
 * which disagrees with the screen underneath it is worse than no dashboard,
 * because it is believed.
 *
 * The drill-downs are the proof. Each one navigates to `/workspace/tasks` with
 * the very filters the metric was computed under, so a reader who doubts a
 * number can open it. A metric with no drill-down would be an assertion.
 *
 * ── WHAT "PERFORMANCE" MEANS HERE, AND WHAT IT DOES NOT ────────────────────
 *
 * Work moving through a process: how much, how late, how long, how stuck. It
 * is NOT an appraisal score, not a compensation input and not an employee KPI
 * rating — those live in Empower HR behind their own module, their own grants
 * and their own retention rules. "Workload by assignee" says how much work is
 * open on somebody's desk. It does not say whether they are good at their job,
 * and the copy on this screen is careful never to imply that it does.
 *
 * ── EVERY CHART HAS A TABLE ────────────────────────────────────────────────
 *
 * An SVG of bars is no more self-explanatory to a screen reader than a canvas
 * is. Each figure is drawn once as a chart and once as a real `<table>` with
 * scoped headers; the table is not a fallback that appears when something
 * fails, it is always in the DOM and toggled by a control the user can reach.
 * Both are rendered from the same array, so they cannot disagree.
 *
 * ── ONE READ, ONE WINDOW, ONE INSTANT ──────────────────────────────────────
 *
 * The whole dashboard is a single request. Six requests resolving "now" six
 * times can show a summary saying 42 open beside a workload table adding to
 * 43, and the reader has no way to know which is right.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { pageShell } from "@/lib/layout";
import { PageHeader } from "@/components/data-list";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { NativeSelect } from "@/components/ui/select";
import { Field } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { Popover } from "@/components/ui/popover";
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon } from "@/components/ui/icons";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { Chart, SeriesBars, Trend } from "@/components/ui/chart";
import type { BarsPoint, BarsSeries, TrendPoint } from "@/components/ui/chart";
import { EmployeePicker } from "@/components/employee-picker";
import { OperationsFilePicker } from "@/components/operations/file-picker";
import { TASK_PRIORITIES, TASK_STATUSES } from "../api";
import type { Audience, AnalyticsResponse, TaskPriority, TaskStatus } from "../api";
import { useWorkspaceAnalytics, useWorkspaceContext } from "../hooks";
import { AUDIENCE_LABEL, PRIORITY_LABEL, STATUS_LABEL } from "../labels";
import { tenantDateTimeFmt, tenantToday, addTenantDays } from "../time";
import { cn } from "@/lib/cn";
import { useIsDesktop, useMediaQuery } from "@/lib/use-media-query";

/**
 * The windows the screen offers.
 *
 * Presets rather than two date inputs, because the question this screen
 * answers is nearly always "recently" at one of three zooms, and a free range
 * is the fastest way to ask for an aggregate over four years of history. The
 * server clamps anything wider than a year regardless and says when it did.
 */
const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
] as const;

type RangeValue = (typeof RANGES)[number]["value"];

/** A useful explanation, not a restatement of the chart title. */
type ChartHelp = {
  title: string;
  shows: string;
  matters: string;
  use: string;
};

const CHART_HELP = {
  throughput: {
    title: "Throughput",
    shows:
      "Tasks completed on each day inside the selected period and filters.",
    matters:
      "It reveals the delivery rhythm: steady completions, bursts of closure, and days when work stopped moving.",
    use: "Look for a sustained pattern rather than one exceptional day. Switch to Table for exact daily counts and compare periods when the rhythm changes.",
  },
  overdue: {
    title: "Overdue aging",
    shows:
      "Open overdue tasks grouped by how long their deadlines have been missed — not averaged together.",
    matters:
      "Older bands signal growing delivery and escalation risk. A small old backlog can need more attention than a large new one.",
    use: "Start with Over 30 days, then 8 to 30 days. Use Open the list to work from the oldest deadlines first.",
  },
  workload: {
    title: "Workload",
    shows: "Open, overdue, and blocked task counts on each assignee’s desk.",
    matters:
      "It helps a team rebalance work and offer support before one queue becomes a bottleneck. It is not a performance score.",
    use: "Compare the mix, not only the total: overdue and blocked work needs a different response from healthy open work. Confirm exact counts in Table.",
  },
  byFile: {
    title: "Work by operations file",
    shows:
      "Open, overdue, and blocked tasks linked to each operations file, with the most overdue files first.",
    matters:
      "It turns a task backlog into shipment risk, showing which live files need intervention. Unlinked personal tasks are intentionally excluded.",
    use: "Prioritise files with overdue or blocked work, then open that file’s tasks to resolve the specific holds.",
  },
  cycle: {
    title: "Cycle time",
    shows:
      "Completed tasks grouped by elapsed time from creation to closure, plus the typical median duration.",
    matters:
      "It shows how predictably work flows. A shift into older bands can expose hand-off or process friction before the backlog grows.",
    use: "Watch the shape across periods, especially movement into 8–30 and Over 30 days. Read it with throughput; speed alone does not measure quality.",
  },
  burndown: {
    title: "Burn-down",
    shows:
      "The number of open tasks left after each day’s new and completed work.",
    matters:
      "It answers whether the team is closing work faster than new work arrives. A falling line means the backlog is shrinking.",
    use: "Use Table to distinguish a truly quiet day from one where new and completed work cancelled each other out. Compare like-for-like periods and filters.",
  },
  blocked: {
    title: "Blocked work",
    shows:
      "Blocked open tasks grouped by assignee, including dependency holds and recorded blockage notes.",
    matters:
      "It locates work that cannot move without help. Removing one shared dependency can release several tasks at once.",
    use: "Tap a bar or assignee button to read every full note, what each task is waiting on, and how long it has been blocked.",
  },
  milestone: {
    title: "Work by milestone",
    shows:
      "Open and overdue tasks at each milestone of the selected operations file.",
    matters:
      "It shows where work is accumulating along this shipment’s chain without pretending that completing a task advances the milestone itself.",
    use: "Start with stages carrying overdue work, then open their tasks to clear the operational hold in context.",
  },
} satisfies Record<string, ChartHelp>;

function ChartHelpContent({
  help,
  showTitle = true,
}: {
  help: ChartHelp;
  showTitle?: boolean;
}) {
  return (
    <div className="space-y-4">
      {showTitle && (
        <div className="flex items-center gap-2 border-b pb-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary-ink">
            <InfoIcon width={17} height={17} />
          </span>
          <h3 className="font-semibold text-foreground">About {help.title}</h3>
        </div>
      )}
      <dl className="space-y-3.5">
        {[
          ["What it shows", help.shows],
          ["Why it matters", help.matters],
          ["How to use it", help.use],
        ].map(([label, copy]) => (
          <div key={label} className="border-l-2 border-primary/30 pl-3">
            <dt className="micro font-semibold text-primary-ink">{label}</dt>
            <dd className="mt-0.5 text-sm leading-relaxed text-foreground">
              {copy}
            </dd>
          </div>
        ))}
      </dl>
      <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Uses the current period and filters, and only work you are authorised to
        see.
      </p>
    </div>
  );
}

/** A readable popover on larger screens and a thumb-friendly sheet on phones. */
function ChartInfo({ help }: { help: ChartHelp }) {
  const [open, setOpen] = React.useState(false);
  // Dialog's responsive shell is a bottom sheet below `sm`; from `sm` upward
  // an anchored popover preserves context and avoids a needlessly modal read.
  const canUsePopover = useMediaQuery("(min-width: 640px)", true);
  const trigger = (
    <button
      type="button"
      aria-label={`About ${help.title}`}
      title={`About ${help.title}`}
      onClick={canUsePopover ? undefined : () => setOpen(true)}
      className="grid h-9 w-9 place-items-center rounded-full border border-primary/20 bg-primary/5 text-primary-ink transition-colors hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <InfoIcon width={17} height={17} />
    </button>
  );

  if (canUsePopover) {
    return (
      <Popover
        trigger={trigger}
        label={`About ${help.title}`}
        open={open}
        onOpenChange={setOpen}
        className="w-[min(22rem,calc(100vw-1.5rem))] p-4"
      >
        <ChartHelpContent help={help} />
      </Popover>
    );
  }

  return (
    <>
      {trigger}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`About ${help.title}`}
        description="What this chart means and how to act on it."
        titleIcon={
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary-ink">
            <InfoIcon width={18} height={18} />
          </span>
        }
      >
        <ChartHelpContent help={help} showTitle={false} />
      </Dialog>
    </>
  );
}

function ChartActions({
  help,
  children,
}: {
  help: ChartHelp;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {children}
      <ChartInfo help={help} />
    </div>
  );
}

/**
 * Mobile: exactly one full-width card, changed by explicit Previous / Next
 * controls. Desktop: the established two-column overview. There is no
 * horizontal scroller in either branch, so a chart can never grow a flex item
 * past the viewport and expose only its first bars.
 */
function AnalyticsPager({ children }: { children: React.ReactNode }) {
  const desktop = useIsDesktop();
  const [index, setIndex] = React.useState(0);
  const topRef = React.useRef<HTMLDivElement>(null);
  const items = React.Children.toArray(children);
  const count = items.length;
  const safeIndex = Math.min(index, Math.max(0, count - 1));

  React.useEffect(() => {
    if (index !== safeIndex) setIndex(safeIndex);
  }, [index, safeIndex]);

  if (desktop) {
    return (
      <div className="grid min-w-0 grid-cols-2 gap-4">
        {items.map((child, i) => (
          <div key={i} className="min-w-0 max-w-full overflow-hidden">
            {child}
          </div>
        ))}
      </div>
    );
  }

  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(next, count - 1));
    if (bounded === safeIndex) return;
    setIndex(bounded);
    requestAnimationFrame(() =>
      topRef.current?.scrollIntoView?.({ block: "start" }),
    );
  };

  return (
    <section
      ref={topRef}
      aria-label="Analytics charts"
      className="min-w-0 max-w-full scroll-mt-4"
    >
      <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border bg-card/60 px-3 py-2">
        <p className="text-sm font-medium text-foreground">
          Chart <span className="num">{safeIndex + 1}</span> of{" "}
          <span className="num">{count}</span>
        </p>
        <div
          className="flex items-center gap-1.5"
          aria-label="Choose an analytics chart"
        >
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show chart ${i + 1} of ${count}`}
              aria-current={i === safeIndex ? "true" : undefined}
              onClick={() => goTo(i)}
              className={cn(
                "h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                i === safeIndex
                  ? "w-6 bg-primary"
                  : "w-2 bg-[rgb(var(--ink)_/_0.14)] hover:bg-[rgb(var(--ink)_/_0.28)]",
              )}
            />
          ))}
        </div>
      </div>

      <div
        className="w-full min-w-0 max-w-full overflow-hidden"
        data-testid="active-analytics-card"
      >
        {items[safeIndex]}
      </div>

      <nav
        aria-label="Analytics chart pages"
        className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2"
      >
        <Button
          type="button"
          variant="outline"
          disabled={safeIndex === 0}
          onClick={() => goTo(safeIndex - 1)}
          className="justify-self-start"
        >
          <ArrowLeftIcon width={16} height={16} />
          Previous
        </Button>
        <span className="micro tabular-nums" aria-live="polite">
          {safeIndex + 1} / {count}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={safeIndex === count - 1}
          onClick={() => goTo(safeIndex + 1)}
          className="justify-self-end"
        >
          Next
          <ArrowRightIcon width={16} height={16} />
        </Button>
      </nav>
    </section>
  );
}

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const contextQ = useWorkspaceContext();
  const timeZone = contextQ.data?.timeZone ?? "Africa/Douala";

  // Every filter lives in the URL. A dashboard someone screenshots and pastes
  // into a message has to reproduce for the person who opens it, and the back
  // button has to undo a filter rather than leave the screen.
  const range = (params.get("range") as RangeValue) || "30";
  const audienceParam = params.get("audience") as Audience | null;
  const status = (params.get("status") as TaskStatus | null) || "";
  const priority = (params.get("priority") as TaskPriority | null) || "";
  /*
   * WHOSE work, and on WHICH file.
   *
   * `assigned_to` is a uuid or the literal "me" — the same parameter the
   * Workload panel's drill-down has always carried, now also writable from a
   * picker. `assignee_name` and `dossier_ref` ride beside their ids purely so
   * the chips read as a person and a reference after a reload: the ids are the
   * filter, the names are how it is shown, and holding them in the URL keeps a
   * pasted link reproducing exactly what the sender saw.
   *
   * NOTHING here widens what the reader may see. The server applies the
   * assignee and the file ON TOP of the same visibility predicate the Tasks
   * list uses, so picking somebody outside your reach narrows to nothing
   * rather than revealing their work — which is why the picker needs no
   * permission logic of its own, and why the note below explains an empty
   * dashboard instead of the screen pretending the filter did something.
   */
  const assignedTo = params.get("assigned_to");
  const assigneeName = params.get("assignee_name");
  const mineOnly = assignedTo === "me";
  const dossierId = params.get("dossier_id");

  const window_ = React.useMemo(() => {
    // Computed on the TENANT's clock, not the browser's: the server reads a
    // zoneless value on the workplace timezone, and a laptop in another zone
    // must not shift which day the window starts on.
    const today = tenantToday(timeZone);
    return { from: addTenantDays(today, -Number(range)), to: addTenantDays(today, 1) };
  }, [range, timeZone]);

  const q = useWorkspaceAnalytics({
    from: window_.from,
    to: window_.to,
    audience: audienceParam || undefined,
    status: status || undefined,
    priority: priority || undefined,
    assigned_to: assignedTo || undefined,
    dossier_id: dossierId || undefined,
  });

  const data = q.data;
  const offered = data?.audiences ?? ["mine"];
  const effective = data?.audience ?? audienceParam ?? "mine";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  /** An id and the label it is shown by, set or cleared together. Two calls to
   *  `setParam` would write the URL twice and lose the first. */
  function setLabelledParam(
    idKey: string,
    labelKey: string,
    value: { id: string; label: string } | null,
  ) {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(idKey, value.id);
      next.set(labelKey, value.label);
    } else {
      next.delete(idKey);
      next.delete(labelKey);
    }
    setParams(next, { replace: true });
  }

  /**
   * Open the Tasks list filtered exactly the way this metric was counted.
   *
   * The audience travels too. A drill-down that dropped it would show a
   * manager their own work under a figure computed across their team, and the
   * two would disagree for a reason nobody could see.
   */
  function drillDown(extra: Record<string, string> = {}) {
    const search = new URLSearchParams({ view: "list" });
    if (effective !== "mine") search.set("audience", effective);
    if (status) search.set("status", status);
    if (priority) search.set("priority", priority);
    if (assignedTo) {
      search.set("assigned_to", assignedTo);
      // The name travels with the id so the list can show whose work it is
      // narrowed to rather than a filter the reader cannot see.
      if (assigneeName) search.set("assignee_name", assigneeName);
    }
    // The file travels too. The ID alone — the list's picker resolves the
    // reference itself, so a drill-down cannot hand it a stale label.
    if (dossierId) search.set("dossier_id", dossierId);
    for (const [k, v] of Object.entries(extra)) search.set(k, v);
    navigate(`/workspace/tasks?${search.toString()}`);
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        title="Analytics"
        description="How operational work is moving: what is open, what is late, how long things take, and what is waiting on something else. These are the same tasks the Tasks list shows, counted — not an appraisal, a rating or a pay decision."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Period" htmlFor="analytics-range">
          <NativeSelect
            id="analytics-range"
            value={range}
            onChange={(e) => setParam("range", e.target.value === "30" ? null : e.target.value)}
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Status" htmlFor="analytics-status">
          <NativeSelect
            id="analytics-status"
            value={status}
            onChange={(e) => setParam("status", e.target.value || null)}
          >
            <option value="">Every status</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Priority" htmlFor="analytics-priority">
          <NativeSelect
            id="analytics-priority"
            value={priority}
            onChange={(e) => setParam("priority", e.target.value || null)}
          >
            <option value="">Every priority</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {/* The switch offers only what the server said it would honour — the
            same contract the Tasks board uses. Showing "Everyone" to somebody
            the server narrows is a control that appears to work and does not. */}
        {offered.length > 1 && (
          <Segmented
            label="Whose work to measure"
            value={effective}
            onChange={(v) => setParam("audience", v === "mine" ? null : v)}
            options={offered.map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }))}
          />
        )}
      </div>

      {/* WHOSE work, and on WHICH file. Both narrow every figure below rather
          than one panel each — a filter honoured by one chart and ignored by
          the other seven is the disagreement this screen exists not to ship. */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[15rem]">
          {assignedTo ? (
            <Field label="Employee" htmlFor="analytics-employee">
              <div
                id="analytics-employee"
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  {mineOnly ? "Me" : assigneeName || "Selected employee"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLabelledParam("assigned_to", "assignee_name", null)}
                >
                  Clear
                </Button>
              </div>
            </Field>
          ) : (
            <EmployeePicker
              id="analytics-employee"
              label="Employee"
              placeholder="Everyone — search staff by name or job title…"
              requireAccount
              onPick={(e) => {
                // A task is assigned to a LOGIN, so an employee with no account
                // can hold none — `requireAccount` keeps those out of the list
                // rather than offering a filter that returns nothing.
                if (!e.account_user_id) return;
                setLabelledParam("assigned_to", "assignee_name", {
                  id: e.account_user_id,
                  label: e.full_name || "Selected employee",
                });
              }}
            />
          )}
        </div>

        <div className="min-w-[15rem]">
          <OperationsFilePicker
            id="analytics-file"
            label="Operations file"
            placeholder="Every file — search ref, client, B/L…"
            value={dossierId}
            onSelect={(file) => setParam("dossier_id", file.dossier_id)}
            onClear={() => setParam("dossier_id", null)}
          />
        </div>
      </div>

      {/*
        The one case where an empty dashboard is the filter working correctly
        rather than failing. `mine` measures YOUR work; the server applies a
        chosen employee on top of that, so asking for somebody else's while
        measuring your own can only return the overlap — usually nothing. Said
        here, at the control, because zeros across eight panels is otherwise
        indistinguishable from a broken read.
      */}
      {assignedTo && !mineOnly && effective === "mine" && offered.length > 1 && (
        <Callout tone="warn">
          You are measuring your own work, so {assigneeName || "that employee"}’s
          tasks are counted only where they overlap with yours. Switch to{" "}
          {AUDIENCE_LABEL[offered.find((a) => a !== "mine") ?? "team"]} to see
          all of them.
        </Callout>
      )}

      {q.error ? (
        /* One read was the deliberate PR 2 choice — one instant, one predicate,
           panels cannot disagree — and its failure story is the whole screen,
           not six inline gaps the reader has to assemble. So the error NAMES
           the read that failed and states what each panel underneath was about
           to show, rather than leaving "Something went wrong" to stand for all
           of them. `ScreenError` is the right primitive (it handles the offline /
           retry states for free), but the shared `message` alone cannot say
           which of the six panels was the casualty, because they share one
           endpoint. The `Panel` copy does that explicitly. */
        <Panel title="Analytics">
          <ScreenError
            message={
              "The analytics read — the one authorised query that feeds all six panels " +
              "(open, overdue, blocked, throughput, cycle time and workload) — could not be answered. " +
              q.error.message
            }
            what="Your analytics"
            onRetry={() => void q.refetch()}
          />
        </Panel>
      ) : q.isLoading || !data ? (
        <Panel title="Analytics">
          <LoadingRow label="Counting your work…" />
        </Panel>
      ) : (
        <div className="space-y-4">
          {data.window.clamped && (
            <Callout tone="warn">
              That period is wider than this report will cover, so it has been
              narrowed to the last {data.window.max_days} days.
            </Callout>
          )}

          <SummaryStrip data={data} onDrill={drillDown} />

          <AnalyticsPager>
            <ThroughputPanel data={data} />
            <OverdueAgingPanel data={data} onDrill={drillDown} />
            <WorkloadPanel data={data} onDrill={drillDown} />
            <WorkByFilePanel data={data} onDrill={drillDown} />
            <CycleTimePanel data={data} />
            <BurndownPanel data={data} />
            <BlockedPanel data={data} timeZone={timeZone} />
          </AnalyticsPager>

          {dossierId && <ByMilestonePanel data={data} onDrill={drillDown} />}

          <p className="micro">
            Counted in {data.window.timezone} over{" "}
            {tenantDateTimeFmt(data.window.from, data.window.timezone)} to{" "}
            {tenantDateTimeFmt(data.window.to, data.window.timezone)}. Figures cover
            only the work you are authorised to see, so they match the Tasks list
            filtered the same way.
          </p>
        </div>
      )}
    </section>
  );
}

/* ── the headline strip ───────────────────────────────────────────────────── */

/**
 * Four numbers, each a button.
 *
 * They are buttons rather than read-outs because a figure you cannot open is a
 * figure you cannot check, and "is that really seventeen?" is the first
 * question anybody asks a dashboard.
 */
function SummaryStrip({
  data,
  onDrill,
}: {
  data: AnalyticsResponse;
  onDrill: (extra?: Record<string, string>) => void;
}) {
  const cards: { key: string; label: string; value: number; hint: string; drill: Record<string, string> }[] = [
    {
      key: "open",
      label: "Open",
      value: data.summary.open,
      hint: "Not done and not cancelled.",
      drill: { status: "TO_DO" },
    },
    {
      key: "overdue",
      label: "Overdue",
      value: data.summary.overdue,
      hint: "Open, with a deadline already past.",
      drill: { sort: "due_asc" },
    },
    {
      key: "blocked",
      label: "Blocked",
      value: data.summary.blocked,
      hint: "Waiting on a task that is not finished.",
      drill: {},
    },
    {
      key: "completed",
      label: "Completed",
      value: data.summary.completed,
      hint: "Finished inside this period.",
      drill: { status: "DONE" },
    },
  ];
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <li key={c.key}>
          <button
            type="button"
            onClick={() => onDrill(c.drill)}
            className="w-full rounded-lg border bg-card/40 p-4 text-left transition-colors hover:border-primary"
          >
            <span className="micro block">{c.label}</span>
            <span className="num block text-2xl font-medium">{c.value}</span>
            <span className="micro block">{c.hint}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ── the six panels ───────────────────────────────────────────────────────── */

function ThroughputPanel({ data }: { data: AnalyticsResponse }) {
  const rows = data.throughput;
  const points: BarsPoint[] = rows.map((r) => ({ label: r.day, values: { completed: r.completed } }));
  const series: BarsSeries[] = [{ key: "completed", tone: "accent", label: "Completed" }];
  return (
    <Panel
      title="Throughput"
      subtitle="Tasks completed each day in this period."
      action={<ChartActions help={CHART_HELP.throughput} />}
      className="min-w-0 overflow-hidden"
    >
      <FigureWithTable
        chartTitle="Completed per day"
        ariaLabel={`Tasks completed on each of ${rows.length} days in the selected period.`}
        empty={rows.length === 0}
        emptyTitle="Nothing completed yet"
        emptyHint="Finish a task in this period and it appears here the same day."
        chart={<SeriesBars data={points} series={series} height={200} />}
        columns={["Day", "Completed"]}
        rows={rows.map((r) => [r.day, String(r.completed)])}
        caption="Tasks completed per day"
      />
    </Panel>
  );
}

function OverdueAgingPanel({
  data,
  onDrill,
}: {
  data: AnalyticsResponse;
  onDrill: (extra?: Record<string, string>) => void;
}) {
  const rows = data.overdue_aging;
  const points: BarsPoint[] = rows.map((r) => ({
    label: BUCKET_LABEL[r.bucket] ?? r.bucket,
    values: { tasks: r.tasks },
    // The oldest band wears the bad tone because that is a genuine state, and
    // it sits beside its own label and number — never colour alone.
    tones: r.bucket === "30+" ? { tasks: "bad" } : r.bucket === "8-30" ? { tasks: "warn" } : undefined,
  }));
  const total = rows.reduce((n, r) => n + r.tasks, 0);
  return (
    <Panel
      title="Overdue aging"
      subtitle="How long open work has been late. Bands, not an average — one task a year late and nine a day late average to nothing anybody recognises."
      action={
        <ChartActions help={CHART_HELP.overdue}>
          {total > 0 ? (
            <Button size="sm" variant="outline" onClick={() => onDrill({ sort: "due_asc" })}>
              Open the list
            </Button>
          ) : undefined}
        </ChartActions>
      }
      className="min-w-0 overflow-hidden"
    >
      <FigureWithTable
        chartTitle="Overdue by age"
        ariaLabel={`${total} overdue tasks grouped into five age bands.`}
        empty={total === 0}
        emptyTitle="Nothing is late"
        emptyHint="Every open task with a deadline is still inside it."
        chart={<SeriesBars data={points} series={[{ key: "tasks", tone: "warn", label: "Overdue tasks" }]} height={200} />}
        columns={["Days late", "Tasks"]}
        rows={rows.map((r) => [BUCKET_LABEL[r.bucket] ?? r.bucket, String(r.tasks)])}
        caption="Overdue tasks by age band"
      />
    </Panel>
  );
}

function WorkloadPanel({
  data,
  onDrill,
}: {
  data: AnalyticsResponse;
  onDrill: (extra?: Record<string, string>) => void;
}) {
  const rows = data.workload;
  const points: BarsPoint[] = rows.map((r) => ({
    label: r.assignee_name,
    values: { open: r.open_tasks, overdue: r.overdue_tasks, blocked: r.blocked_tasks },
  }));
  const series: BarsSeries[] = [
    { key: "open", tone: "accent", label: "Open" },
    { key: "overdue", tone: "bad", label: "Overdue" },
    { key: "blocked", tone: "warn", label: "Blocked" },
  ];
  return (
    <Panel
      title="Workload"
      subtitle="Open work per person, so it can be levelled. This is how much is on a desk — it is not a rating and it is not a measure of anybody's performance."
      action={<ChartActions help={CHART_HELP.workload} />}
      className="min-w-0 overflow-hidden"
    >
      <FigureWithTable
        chartTitle="Open work by assignee"
        ariaLabel={`Open, overdue and blocked task counts for ${rows.length} assignees.`}
        empty={rows.length === 0}
        emptyTitle="No open work"
        emptyHint="Nothing in this period is assigned and still open."
        chart={<SeriesBars data={points} series={series} height={240} />}
        columns={["Assignee", "Open", "Overdue", "Blocked", ""]}
        rows={rows.map((r) => [
          r.assignee_name,
          String(r.open_tasks),
          String(r.overdue_tasks),
          String(r.blocked_tasks),
          r.user_id ? (
            <button
              key={r.user_id}
              type="button"
              className="micro text-primary-ink underline"
              // The NAME rides along too, and must: `drillDown` seeds the
              // filter's own assignee name first, so a row that overrode only
              // the id would open a list labelled with somebody else.
              onClick={() =>
                onDrill({ assigned_to: r.user_id as string, assignee_name: r.assignee_name })
              }
            >
              Open
            </button>
          ) : (
            ""
          ),
        ])}
        caption="Open work by assignee"
      />
    </Panel>
  );
}

/**
 * Work by operations file — the panel the task↔file link exists for (13920).
 *
 * ── ORDERED BY TROUBLE, NOT BY VOLUME ──────────────────────────────────────
 *
 * Overdue first, then open. The question this panel is opened with is "which
 * file is in trouble this morning", and a file with forty tasks and none late
 * needs nobody. Sorting by volume would put it at the top every day and bury
 * the three-task file whose customs deadline passed on Friday.
 *
 * ── LINKED WORK ONLY, AND THE PANEL SAYS SO ────────────────────────────────
 *
 * Tasks with no file are absent by construction (the server's `by_file` is
 * scoped to linked work). That is deliberate — the alternative is one
 * enormous "No file" row, made of every personal reminder in the tenant,
 * dwarfing every real file and answering nothing. The subtitle states it so
 * the reader is never left to work out why these counts are smaller than the
 * summary strip above.
 *
 * Every row drills into the Tasks list narrowed to that file, so a count here
 * and the rows a reader can page through are one statement, not two.
 */
function WorkByFilePanel({
  data,
  onDrill,
}: {
  data: AnalyticsResponse;
  onDrill: (extra: Record<string, string>) => void;
}) {
  /*
   * `?? []` and not a bare read. This is a PWA: a response cached before this
   * panel shipped has no `by_file`, and the whole dashboard is ONE query — so
   * an undefined here is not a blank panel, it is a white screen where eight
   * panels were. The type says the field is always sent, and the server always
   * sends it; the fallback is for the copy of yesterday's answer sitting in a
   * service worker, which no type can reach.
   */
  const rows = data.by_file ?? [];
  const points: BarsPoint[] = rows.map((r) => ({
    label: r.label,
    values: { open: r.open_tasks, overdue: r.overdue_tasks, blocked: r.blocked_tasks },
  }));
  const series: BarsSeries[] = [
    { key: "open", tone: "accent", label: "Open" },
    { key: "overdue", tone: "bad", label: "Overdue" },
    { key: "blocked", tone: "warn", label: "Blocked" },
  ];
  return (
    <Panel
      title="Work by operations file"
      subtitle="Which shipments have work outstanding on them, most overdue first. Counts only tasks linked to a file — a personal reminder is not work on a shipment."
      action={<ChartActions help={CHART_HELP.byFile} />}
      className="min-w-0 overflow-hidden"
    >
      <FigureWithTable
        chartTitle="Open work by operations file"
        ariaLabel={`Open, overdue and blocked task counts for ${rows.length} operations files.`}
        empty={rows.length === 0}
        emptyTitle="No work linked to a file"
        emptyHint="Link a task to an operations file and it will be counted here."
        chart={<SeriesBars data={points} series={series} height={240} />}
        columns={["File", "Client", "Open", "Overdue", "Done", ""]}
        rows={rows.map((r) => [
          r.label,
          r.client_name ?? "—",
          String(r.open_tasks),
          String(r.overdue_tasks),
          String(r.completed_tasks),
          <button
            key={r.dossier_id}
            type="button"
            className="micro text-primary-ink underline"
            onClick={() => onDrill({ dossier_id: r.dossier_id })}
          >
            Open
          </button>,
        ])}
        caption="Open work by operations file"
      />
    </Panel>
  );
}

/**
 * Where the work sits along ONE file's chain (13920).
 *
 * Rendered only when a file is picked, and computed only then, because
 * milestone labels repeat across files: every sea export has a "Customs
 * cleared", so a tenant-wide grouping would add unrelated shipments together
 * under one heading and present the sum as a stage's backlog. Narrowed to a
 * file the labels are unique and the grouping means what it reads as.
 *
 * "No milestone" is a real row, not a gap — work on the file as a whole is the
 * most common shape a link takes, and dropping it would make this panel
 * disagree with the file's own Tasks tab.
 */
function ByMilestonePanel({
  data,
  onDrill,
}: {
  data: AnalyticsResponse;
  onDrill: (extra: Record<string, string>) => void;
}) {
  const rows = data.by_milestone ?? [];
  const points: BarsPoint[] = rows.map((r) => ({
    label: r.label,
    values: { open: r.open_tasks, overdue: r.overdue_tasks },
  }));
  const series: BarsSeries[] = [
    { key: "open", tone: "accent", label: "Open" },
    { key: "overdue", tone: "bad", label: "Overdue" },
  ];
  return (
    <Panel
      title="Work by milestone"
      subtitle="Where this file's work sits along its chain. Linking a task to a milestone never moves it — the chain is what was promised a client, and a to-do list does not get to advance it."
      action={<ChartActions help={CHART_HELP.milestone} />}
      className="min-w-0 overflow-hidden"
    >
      <FigureWithTable
        chartTitle="Open work by milestone"
        ariaLabel={`Open and overdue task counts across ${rows.length} milestones of this file.`}
        empty={rows.length === 0}
        emptyTitle="No work on this file"
        emptyHint="Nothing in this period is linked to the file you picked."
        chart={<SeriesBars data={points} series={series} height={200} />}
        columns={["Milestone", "Open", "Overdue", "Total", ""]}
        rows={rows.map((r) => [
          r.label,
          String(r.open_tasks),
          String(r.overdue_tasks),
          String(r.total_tasks),
          r.milestone_instance_id ? (
            <button
              key={r.milestone_instance_id}
              type="button"
              className="micro text-primary-ink underline"
              onClick={() =>
                onDrill({
                  milestone_instance_id: r.milestone_instance_id as string,
                  // The label travels with the id for the same reason the
                  // file's reference does: the list has no way to resolve one
                  // and would otherwise show a narrowing it cannot name.
                  milestone_label: r.label,
                })
              }
            >
              Open
            </button>
          ) : (
            ""
          ),
        ])}
        caption="Open work by milestone"
      />
    </Panel>
  );
}

function CycleTimePanel({ data }: { data: AnalyticsResponse }) {
  const rows = data.cycle_time.buckets;
  const total = rows.reduce((n, r) => n + r.tasks, 0);
  const points: BarsPoint[] = rows.map((r) => ({
    label: BUCKET_LABEL[r.bucket] ?? r.bucket,
    values: { tasks: r.tasks },
  }));
  return (
    <Panel
      title="Cycle time"
      subtitle={
        data.cycle_time.median_days === null
          ? "How long finished work took, from writing it down to closing it."
          : `Typically ${data.cycle_time.median_days} days from writing a task down to closing it. The median, not the mean — one task that sat open all year would drag an average past every real value.`
      }
      action={<ChartActions help={CHART_HELP.cycle} />}
      className="min-w-0 overflow-hidden"
    >
      <FigureWithTable
        chartTitle="Time to complete"
        ariaLabel={`${total} completed tasks grouped by how many days they took.`}
        empty={total === 0}
        emptyTitle="Nothing finished yet"
        emptyHint="Complete a task in this period to see how long work is taking."
        chart={<SeriesBars data={points} series={[{ key: "tasks", tone: "accent", label: "Tasks" }]} height={200} />}
        columns={["Days to complete", "Tasks", "Average days"]}
        rows={rows.map((r) => [
          BUCKET_LABEL[r.bucket] ?? r.bucket,
          String(r.tasks),
          r.avg_days === undefined ? "—" : String(r.avg_days),
        ])}
        caption="Completed tasks by cycle time"
      />
    </Panel>
  );
}

function BurndownPanel({ data }: { data: AnalyticsResponse }) {
  const rows = data.burndown.days;
  const points: TrendPoint[] = rows.map((d) => ({ label: d.day, value: d.open }));
  return (
    <Panel
      title="Burn-down"
      subtitle="The open backlog across the period — work arriving against work closing. This is volume of work, not money."
      action={<ChartActions help={CHART_HELP.burndown} />}
      className="min-w-0 overflow-hidden"
    >
      <FigureWithTable
        chartTitle="Open work over time"
        ariaLabel={`Open task backlog across ${rows.length} days, starting from ${data.burndown.open_at_start}.`}
        empty={rows.length === 0}
        emptyTitle="No movement in this period"
        emptyHint="Nothing was created or completed, so the backlog did not move."
        chart={<Trend data={points} height={200} valueLabel="Open work" />}
        columns={["Day", "Created", "Completed", "Still open"]}
        rows={rows.map((d) => [d.day, String(d.created), String(d.completed), String(d.open)])}
        caption={`Backlog movement, opening at ${data.burndown.open_at_start}`}
      />
    </Panel>
  );
}

/**
 * Blocked work answers two questions in one card: the chart locates the jam;
 * selecting one bar reveals the actual tasks and their COMPLETE blockage notes.
 * The labelled buttons mirror every bar, so the same interaction is available
 * to touch, keyboard and assistive-technology users.
 */
function BlockedPanel({
  data,
  timeZone,
}: {
  data: AnalyticsResponse;
  timeZone: string;
}) {
  const navigate = useNavigate();
  const rows = data.blocked;
  const [filter, setFilter] = React.useState<string | null>(null);

  const byAssignee = React.useMemo(() => {
    const grouped = new Map<string, { count: number; noted: number }>();
    for (const row of rows) {
      const name = row.assigned_to_name || "Unassigned";
      const current = grouped.get(name) || { count: 0, noted: 0 };
      current.count += 1;
      if (row.blockage_note) current.noted += 1;
      grouped.set(name, current);
    }
    return Array.from(grouped.entries())
      .map(([name, values]) => ({ name, ...values }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [rows]);

  const points: BarsPoint[] = byAssignee.map((group) => ({
    // Keep the full value here. The shared chart shortens only the painted axis
    // label, while clicks still return the exact assignee used by the rows.
    label: group.name,
    values: { blocked: group.count },
  }));
  const visibleRows = filter
    ? rows.filter((row) => (row.assigned_to_name || "Unassigned") === filter)
    : rows;
  const selectAssignee = (name: string) =>
    setFilter((current) => (current === name ? null : name));

  if (rows.length === 0) {
    return (
      <Panel
        title="Blocked work"
        subtitle="Open tasks waiting on something unfinished or carrying a registered blockage, longest wait first."
        action={<ChartActions help={CHART_HELP.blocked} />}
        className="min-w-0 overflow-hidden"
      >
        <EmptyState
          title="Nothing is blocked"
          hint="No open task is waiting on an unresolved dependency or carrying a blockage."
        />
      </Panel>
    );
  }

  const chart = (
    <SeriesBars
      data={points}
      series={[{ key: "blocked", tone: "warn", label: "Blocked" }]}
      height={200}
      selectedLabel={filter}
      onPointClick={(point) => selectAssignee(point.label)}
    />
  );

  return (
    <Panel
      title="Blocked work"
      subtitle="Open tasks waiting on something unfinished or carrying a registered blockage — tap a bar or assignee below to read every note."
      action={<ChartActions help={CHART_HELP.blocked} />}
      className="min-w-0 overflow-hidden"
    >
      <FigureWithTable
        chartTitle="Blocked by assignee"
        ariaLabel={`${rows.length} blocked tasks across ${byAssignee.length} assignees. Select a bar or assignee button to read the blockage notes.`}
        empty={false}
        emptyTitle="Nothing is blocked"
        emptyHint="No open task is blocked."
        chart={chart}
        columns={["Task", "Assignee", "Waiting on / note", "Since"]}
        rows={visibleRows.map((row) => [
          <button
            key={`${row.task_id}-title`}
            type="button"
            className="text-left text-primary-ink underline"
            onClick={() =>
              navigate(row.link_url || `/workspace/tasks?task=${row.task_id}`)
            }
          >
            {row.title}
          </button>,
          row.assigned_to_name ?? "Nobody yet",
          <span
            key={`${row.task_id}-wait`}
            className="inline-flex max-w-72 flex-col gap-1 whitespace-normal"
          >
            {row.blocking_count > 0 && (
              <Pill tone={row.blocking_count > 1 ? "bad" : "warn"}>
                {row.blocking_count}{" "}
                {row.blocking_count === 1 ? "task" : "tasks"}
              </Pill>
            )}
            <span className="break-words text-xs leading-relaxed text-muted-foreground">
              {row.blockage_note || "No separate blockage note recorded."}
            </span>
          </span>,
          row.blocked_since
            ? tenantDateTimeFmt(row.blocked_since, timeZone)
            : "—",
        ])}
        caption="Blocked tasks and their blockage notes"
      />

      <div className="mt-4 border-t pt-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Read blockage notes
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Choose the assignee whose bar you want to inspect.
            </p>
          </div>
          {filter && (
            <button
              type="button"
              onClick={() => setFilter(null)}
              className="shrink-0 text-xs font-medium text-primary-ink underline underline-offset-2"
            >
              Clear
            </button>
          )}
        </div>

        <div
          className="mt-3 flex flex-wrap gap-2"
          aria-label="Blocked assignees"
        >
          {byAssignee.map((group) => (
            <button
              key={group.name}
              type="button"
              aria-pressed={filter === group.name}
              onClick={() => selectAssignee(group.name)}
              className={cn(
                "min-h-9 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === group.name
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card text-foreground hover:border-primary/40 hover:bg-accent",
              )}
            >
              {group.name} · {group.count}
              <span className="sr-only">
                {group.count === 1 ? " blocked task" : " blocked tasks"},{" "}
                {group.noted} with notes
              </span>
            </button>
          ))}
        </div>

        {filter ? (
          <section
            aria-live="polite"
            aria-label={`Blockage details for ${filter}`}
            className="mt-4 rounded-xl border border-[rgb(var(--warn-fill)_/_0.35)] bg-[rgb(var(--warn-fill)_/_0.06)] p-3 sm:p-4"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="micro text-[rgb(var(--warn))]">
                  Selected assignee
                </p>
                <h4 className="font-semibold text-foreground">{filter}</h4>
              </div>
              <Pill tone="warn">
                {visibleRows.length}{" "}
                {visibleRows.length === 1 ? "blocked task" : "blocked tasks"}
              </Pill>
            </div>

            <ul className="space-y-3">
              {visibleRows.map((row) => (
                <li
                  key={row.task_id}
                  className="rounded-lg border bg-card p-3 shadow-[var(--shadow-s)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium leading-snug text-foreground">
                        {row.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.blocked_since
                          ? `Blocked since ${tenantDateTimeFmt(row.blocked_since, timeZone)}`
                          : "Blocked start time not recorded"}
                      </p>
                    </div>
                    {row.blocking_count > 0 && (
                      <Pill tone={row.blocking_count > 1 ? "bad" : "warn"}>
                        Waiting on {row.blocking_count}
                      </Pill>
                    )}
                  </div>

                  <div className="mt-3 rounded-md border-l-4 border-[rgb(var(--warn-fill))] bg-muted/50 px-3 py-2.5">
                    <p className="micro font-semibold text-muted-foreground">
                      Blockage note
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                      {row.blockage_note ||
                        (row.blocking_count > 0
                          ? "Waiting for the linked prerequisite task to be finished. No separate note was recorded."
                          : "No blockage note was recorded.")}
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {row.blockage_eta
                        ? `Expected release: ${tenantDateTimeFmt(row.blockage_eta, timeZone)}`
                        : "No release estimate recorded"}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate(
                          row.link_url ||
                            `/workspace/tasks?task=${row.task_id}`,
                        )
                      }
                    >
                      Open task
                      <ArrowRightIcon width={15} height={15} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            Tap a chart bar or an assignee above to reveal full notes and task
            details here.
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ── the chart/table pair ─────────────────────────────────────────────────── */

/** Band keys as a person reads them. The server sends stable keys; the words
 *  live here beside the other words, where a copy change needs no deployment
 *  of the API. */
const BUCKET_LABEL: Record<string, string> = {
  "<1": "Under a day",
  "1-2": "1 to 2 days",
  "3-7": "3 to 7 days",
  "8-30": "8 to 30 days",
  "30+": "Over 30 days",
};

/**
 * One figure, drawn twice: as a chart, and as a real table.
 *
 * ── WHY THE TABLE IS ALWAYS BUILT AND NEVER A FALLBACK ─────────────────────
 *
 * A "chart or table" toggle where the table only exists in the alternative
 * branch means the accessible version is the one nobody looks at, and it rots.
 * Both are rendered from ONE array, so a bug in the numbers is a bug in both
 * and is therefore visible to the person maintaining them.
 *
 * The toggle is a real control rather than a screen-reader-only escape hatch
 * because sighted readers want the numbers too — "is that bar 40 or 45" is the
 * most common question a bar chart provokes.
 */
function FigureWithTable({
  chartTitle,
  ariaLabel,
  chart,
  columns,
  rows,
  caption,
  empty,
  emptyTitle,
  emptyHint,
}: {
  chartTitle: string;
  ariaLabel: string;
  chart: React.ReactNode;
  columns: string[];
  rows: React.ReactNode[][];
  caption: string;
  empty: boolean;
  emptyTitle: string;
  emptyHint: string;
}) {
  const [mode, setMode] = React.useState<"chart" | "table">("chart");
  if (empty) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  return (
    <div className="space-y-2">
      <Segmented
        label={`${chartTitle} — how to show it`}
        value={mode}
        onChange={(v) => setMode(v as "chart" | "table")}
        options={[
          { value: "chart", label: "Chart" },
          { value: "table", label: "Table" },
        ]}
      />
      {mode === "chart" ? (
        // h3: the panel around it is the h2, so h4 would skip a level and
        // invent a subsection that is not there.
        <Chart title={chartTitle} ariaLabel={ariaLabel} height={220} titleAs="h3">
          {chart}
        </Chart>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b text-left">
                {columns.map((c, i) => (
                  <th key={c || `col-${i}`} scope="col" className="micro py-1.5 pr-3 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, i) => (
                <tr key={`row-${i}`} className="border-b last:border-0">
                  {cells.map((cell, j) => (
                    <td key={`cell-${i}-${j}`} className={j === 0 ? "py-1.5 pr-3" : "num py-1.5 pr-3"}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
