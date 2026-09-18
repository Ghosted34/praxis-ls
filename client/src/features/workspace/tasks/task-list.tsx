/**
 * The List view — the board's cap-proof twin (13840).
 *
 * ── WHY THIS EXISTS BESIDE THE KANBAN ──────────────────────────────────────
 *
 * The board endpoint is hard-capped at 200 open rows with no indication anything
 * is missing; past that, four columns of the wrong rows read as the whole truth.
 * The list is the honest shape for "over a hundred tasks": it reads the paginated
 * endpoint, which returns the pre-LIMIT total, and it can be searched, filtered
 * and sorted — the things a board deliberately cannot do.
 *
 * Moving a task here is the same Move menu the board offers, and the row opens
 * the very pane the board opens, so the two views never teach two gestures for
 * one action.
 *
 * ── THE TITLE IS TWO LINES, WITH A DOOR ────────────────────────────────────
 *
 * A row is read, not scanned, so a long title earns TWO lines before it is
 * clamped. Whether it is clamped is MEASURED (scroll vs client height), not
 * guessed from word counts — eight short words fit, six long ones do not, and
 * the answer changes with the width and the tenant's typeface. When it IS
 * clamped, the dots beside the title are a real button: it expands the row in
 * place to the full title, and the same dots collapse it again, without
 * opening the task. Opening the task stays the title's own tap; the dots are a
 * SIBLING of that button, never a child, because a button may not hold a
 * button.
 *
 * The clamped flag is set while collapsed and then KEPT through the cycle:
 * expanded, the span is unclamped, so measuring it would report "not clamped"
 * and the only way back out would vanish with the button.
 *
 * ── THE PILLS SHARE ONE WRAP ROW, AND THE NARROW ROW IS THE ONE THAT WARDS ──
 *
 * Recurrence, priority and status — plus the Move menu — sit in ONE flex-wrap
 * container. The pills are `white-space: nowrap` and cannot shrink, so on a
 * 360px row a "Repeats every day until 20 Sept 2026" beside the title used to
 * overflow the title zone and land on top of the priority and status pills.
 * One wrap row has nothing to overflow into: below `md` the container takes
 * the whole row (title / meta / pills, top to bottom, all of them visible),
 * and at `md` and up the SAME container is the right-hand cluster the row
 * always had. One DOM, one layout, a breakpoint for width only.
 *
 * Day-first: every date renders through `dateFmt`, and a search box is an
 * `<Input>`, not a date control, so the day-first gate has nothing to catch.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { BOARD_COLUMNS, TASK_PRIORITIES, TASK_STATUSES } from "../api";
import type { Audience, Task, TaskPriority, TaskStatus } from "../api";
import { useMoveTask, useTaskListPaged } from "../hooks";
import { PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE } from "../labels";
import { describeRule } from "../repeat";

const PAGE = 50;

const SORT_OPTIONS = [
  { value: "due_asc", label: "Soonest due first" },
  { value: "due_desc", label: "Latest due first" },
  { value: "priority_desc", label: "Most urgent first" },
  { value: "created_desc", label: "Newest first" },
];

export function TaskList({
  audience,
  selectedId,
  onOpen,
  onCreate,
}: {
  audience: Audience;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const toast = useToast();
  const move = useMoveTask();
  const [text, setText] = React.useState("");
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<"" | TaskStatus>("");
  const [priority, setPriority] = React.useState<"" | TaskPriority>("");
  const [sort, setSort] = React.useState("due_asc");
  const [offset, setOffset] = React.useState(0);

  // Debounce the search so a typed word is one request, not one per keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [text]);

  // Any filter change returns to the first page.
  React.useEffect(() => {
    setOffset(0);
  }, [status, priority, sort, audience]);

  const query = useTaskListPaged({
    audience,
    q: q || undefined,
    status: status || undefined,
    priority: priority || undefined,
    sort,
    limit: PAGE,
    offset,
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? rows.length;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);

  async function moveTo(task: Task, next: TaskStatus) {
    try {
      await move.mutateAsync({ id: task.task_id, status: next });
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  const filtered = Boolean(q || status || priority);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="micro mb-1 block" htmlFor="task-list-search">
            Search
          </label>
          <Input
            id="task-list-search"
            value={text}
            placeholder="Search titles…"
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div>
          <label className="micro mb-1 block" htmlFor="task-list-status">
            Status
          </label>
          <NativeSelect
            id="task-list-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | TaskStatus)}
          >
            <option value="">All statuses</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label className="micro mb-1 block" htmlFor="task-list-priority">
            Priority
          </label>
          <NativeSelect
            id="task-list-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as "" | TaskPriority)}
          >
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label className="micro mb-1 block" htmlFor="task-list-sort">
            Sort
          </label>
          <NativeSelect id="task-list-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingRow label="Loading tasks…" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? "Nothing matches those filters" : "Nothing on your list"}
          hint={filtered ? "Clear a filter or two and it will come back." : undefined}
          action={
            !filtered ? (
              <button type="button" className="btn-primary" onClick={onCreate}>
                Add the first task
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((task) => (
            <li key={task.task_id}>
              <TaskRow
                task={task}
                selected={task.task_id === selectedId}
                onOpen={() => onOpen(task.task_id)}
                onMove={(next) => moveTo(task, next)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="micro num text-muted-foreground">
          {from}–{to} of {total}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={offset === 0 || query.isFetching}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={to >= total || query.isFetching}
            onClick={() => setOffset((o) => o + PAGE)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One row: the title (two lines, expandable in place), the meta line, and the
 * shared pill row. A component because the clamp is a measurement with state —
 * a `useEffect` per row — and hooks do not live in a `.map()`.
 */
function TaskRow({
  task,
  selected,
  onOpen,
  onMove,
}: {
  task: Task;
  selected: boolean;
  onOpen: () => void;
  onMove: (next: TaskStatus) => Promise<void>;
}) {
  const titleRef = React.useRef<HTMLSpanElement>(null);
  // True while the title overflows the two-line clamp, and kept through the
  // expand/collapse cycle (see the file header for why it must survive).
  const [clamped, setClamped] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    const el = titleRef.current;
    // Expanded, the span is unclamped and its scroll height says nothing about
    // the clamp — measuring it would clear the flag and take the dots away,
    // leaving the expanded row with no way back. So the flag is only ever
    // written while collapsed, and re-written on the way back down.
    if (!el || expanded) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight);
    measure();
    // The clamp box's BORDER size never changes (two lines either way), so a
    // typeface arriving over the fallback after mount can change the scroll
    // height without the observer ever firing. Measure again when the fonts
    // settle, and on every size change for rotation and zoom.
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
      ro?.disconnect();
    };
  }, [task.title, expanded]);

  const titleId = `task-list-title-${task.task_id}`;

  return (
    <div className="flex w-full flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2 text-left">
      {/*
        The open target. Title AND meta stay one button, so "tap the row" keeps
        meaning "open the task" exactly as before — the dots are beside it,
        never inside it.
      */}
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-current={selected ? "true" : undefined}
        >
          <span
            ref={titleRef}
            id={titleId}
            className={cn("text-sm font-medium", expanded ? "block" : "line-clamp-2")}
          >
            {task.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {task.due_at && <span className="num">{dateFmt(task.due_at)}</span>}
            {task.assigned_to_name && <span>{task.assigned_to_name}</span>}
          </span>
        </button>
        {clamped && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={titleId}
            aria-label={expanded ? "Collapse title" : "Show full title"}
            className="-mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium leading-none text-muted-foreground transition-colors hover:border-primary hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            …
          </button>
        )}
      </div>

      {/*
        ONE wrap row for the pills and the Move menu — see the file header for
        the overlap it ends. `max-md:w-full` is the whole breakpoint: below it
        the row becomes title / meta / pills, and above it this is the
        right-hand cluster, in the same DOM.
      */}
      <div className="flex flex-wrap items-center gap-1.5 max-md:w-full">
        {task.recurrence_rule && (
          <Pill tone="blue">{describeRule(task.recurrence_rule)}</Pill>
        )}
        <Pill tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Pill>
        <Pill tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Pill>
        <DropdownMenu
          align="end"
          trigger={
            <Button
              size="sm"
              variant="outline"
              aria-label={`Move “${task.title}” to another column`}
            >
              Move
            </Button>
          }
        >
          {BOARD_COLUMNS.filter((c) => c !== task.status).map((c) => (
            <DropdownItem key={c} onSelect={() => void onMove(c)}>
              {STATUS_LABEL[c]}
            </DropdownItem>
          ))}
        </DropdownMenu>
      </div>
    </div>
  );
}
