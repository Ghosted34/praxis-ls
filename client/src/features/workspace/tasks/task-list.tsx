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
 * Day-first: every date renders through `dateFmt`, and a search box is an
 * `<Input>`, not a date control, so the day-first gate has nothing to catch.
 */
import * as React from "react";
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
              <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left">
                <button
                  type="button"
                  onClick={() => onOpen(task.task_id)}
                  className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-current={task.task_id === selectedId ? "true" : undefined}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{task.title}</span>
                    {task.recurrence_rule && <Pill tone="blue">{describeRule(task.recurrence_rule)}</Pill>}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {task.due_at && <span className="num">{dateFmt(task.due_at)}</span>}
                    {task.assigned_to_name && <span>{task.assigned_to_name}</span>}
                  </span>
                </button>
                <Pill tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Pill>
                <Pill tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Pill>
                <DropdownMenu
                  align="end"
                  trigger={
                    <Button size="sm" variant="outline" aria-label={`Move “${task.title}” to another column`}>
                      Move
                    </Button>
                  }
                >
                  {BOARD_COLUMNS.filter((c) => c !== task.status).map((c) => (
                    <DropdownItem key={c} onSelect={() => void moveTo(task, c)}>
                      {STATUS_LABEL[c]}
                    </DropdownItem>
                  ))}
                </DropdownMenu>
              </div>
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
