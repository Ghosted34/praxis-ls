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

          <div className="grid gap-4 xl:grid-cols-2">
            <ThroughputPanel data={data} />
            <OverdueAgingPanel data={data} onDrill={drillDown} />
            <WorkloadPanel data={data} onDrill={drillDown} />
            <WorkByFilePanel data={data} onDrill={drillDown} />
            <CycleTimePanel data={data} />
            <BurndownPanel data={data} />
            <BlockedPanel data={data} timeZone={timeZone} />
          </div>

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
    <Panel title="Throughput" subtitle="Tasks completed each day in this period.">
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
        total > 0 ? (
          <Button size="sm" variant="outline" onClick={() => onDrill({ sort: "due_asc" })}>
            Open the list
          </Button>
        ) : undefined
      }
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
 * Blocked work — a table only, and deliberately so.
 *
 * A chart of "things that are stuck" tells a manager a count they already have
 * in the strip above. What they need is WHICH ones, oldest first, so they can
 * go and unstick them. The prerequisite's title is absent: a task may be
 * visible to this reader while the thing blocking it is not, and the row's job
 * is to say "this is waiting", not to disclose what on.
 */
function BlockedPanel({ data, timeZone }: { data: AnalyticsResponse; timeZone: string }) {
  const navigate = useNavigate();
  const rows = data.blocked;
  return (
    <Panel title="Blocked work" subtitle="Open tasks waiting on something unfinished or carrying a registered blockage, longest wait first.">
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing is blocked"
          hint="No open task is waiting on an unresolved dependency or carrying a blockage."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Open tasks with unresolved dependencies</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="micro py-1.5 pr-3 font-medium">Task</th>
                <th scope="col" className="micro py-1.5 pr-3 font-medium">Assignee</th>
                <th scope="col" className="micro py-1.5 pr-3 font-medium">Waiting on</th>
                <th scope="col" className="micro py-1.5 font-medium">Since</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.task_id} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">
                    <button
                      type="button"
                      className="text-left text-primary-ink underline"
                      onClick={() => navigate(r.link_url || `/workspace/tasks?task=${r.task_id}`)}
                    >
                      {r.title}
                    </button>
                  </td>
                  <td className="py-1.5 pr-3">{r.assigned_to_name ?? "Nobody yet"}</td>
                  <td className="num py-1.5 pr-3">
                    {/* 13975: the wait has two possible sources and the row shows
                        whichever is true — a prerequisite count, a blockage note,
                        or both. The note travels because it was written for
                        exactly this reader; a prerequisite title does not. */}
                    {r.blocking_count > 0 && (
                      <Pill tone={r.blocking_count > 1 ? "bad" : "warn"}>
                        {r.blocking_count} {r.blocking_count === 1 ? "task" : "tasks"}
                      </Pill>
                    )}
                    {r.blockage_note && (
                      <span
                        className="block max-w-56 truncate text-xs text-muted-foreground"
                        title={r.blockage_note}
                      >
                        ⛔ {r.blockage_note}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5">
                    {r.blocked_since ? tenantDateTimeFmt(r.blocked_since, timeZone) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
