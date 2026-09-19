/**
 * Tasks — the board, with the open task in a column beside it.
 *
 * ── THE DETAIL GOES IN THE LAYOUT, NOT OVER IT ─────────────────────────────
 *
 * A board is a surface you keep working on: triage, drag, re-read. A drawer
 * that slides over it and scrims everything behind it takes the board away for
 * as long as the detail is open — and it covers exactly the region the board
 * occupies, so opening a card to read one line costs the whole view. Where
 * there is room for both, there is no reason to choose: the detail is an
 * `<aside>` beside the columns, with no scrim, no focus trap, and the next card
 * one click away instead of one close-and-reopen away.
 *
 * ── THE PANE IS NOT RESERVED WHILE IT IS EMPTY ─────────────────────────────
 *
 * It used to be a permanent 22rem column holding "Select a card to see its
 * steps…": a fifth of every wide screen spent on a sentence about a pane, paid
 * for by the four kanban columns it squeezed — on the screen whose entire point
 * is the cards. The column now exists while there is a task in it, and the board
 * has the width at every other moment. Below `xl`, where a side-by-side split
 * would be two unreadable columns, the same panel opens as a `<Dialog>` sheet.
 *
 * ── WHY THE BRANCH IS IN JAVASCRIPT ────────────────────────────────────────
 *
 * `xl:hidden` around the sheet read correctly and hid nothing: Radix renders the
 * dialog through a PORTAL into `<body>`, so the wrapper never becomes an
 * ancestor of anything visible and `display: none` on it takes no effect. The
 * sheet therefore opened over the board at every width, on top of the reserved
 * column it was supposed to replace. A CSS media query cannot branch a portalled
 * component; `useIsWide` decides in JavaScript, which is also the rule for the
 * 360 screens (guide §3.11).
 *
 * ── THE AUDIENCE SWITCH OFFERS ONLY WHAT THE SERVER WILL HONOUR ────────────
 *
 * `GET /workspace/tasks/board` answers with `audiences`: the list this caller
 * may actually ask for, derived from their RBAC grants and organigramme
 * closure. The switch renders that list and nothing else. The alternative —
 * always showing "Everyone" and letting the server narrow it — is a control
 * that appears to do something and does not, which is worse than not offering
 * it, because the user concludes they have no team rather than no permission.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/cn";
import { pageShell } from "@/lib/layout";
import { useIsWide } from "@/lib/use-media-query";
import { PageHeader } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { ScreenError } from "@/components/connection/screen-error";
import { tr } from "@/lib/i18n";
import { useTaskBoard } from "../hooks";
import { SearchField } from "../search-field";
import type { Audience } from "../api";
import { AUDIENCE_LABEL } from "../labels";
import { TaskBoard } from "./task-board";
import { TaskDialog } from "./task-dialog";
import { TaskList } from "./task-list";
import { TaskPanel } from "./task-panel";

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const isWide = useIsWide();

  const [audience, setAudience] = React.useState<Audience>(
    (params.get("audience") as Audience) || "mine",
  );
  // Board is the default; the List view is the cap-proof shape for >100 tasks.
  const view: "board" | "list" = params.get("view") === "list" ? "list" : "board";
  // The operations-file narrowing lives in the URL like every other filter
  // (13920): an Analytics drill-down arrives carrying it, and a screenshotted
  // list has to reproduce for whoever opens it. `dossier_ref` rides alongside
  // so the chip reads as a reference without a second request for the name.
  const dossierId = params.get("dossier_id");
  const dossierRef = params.get("dossier_ref");
  const milestoneInstanceId = params.get("milestone_instance_id");
  const milestoneLabel = params.get("milestone_label");
  // Whose work — a uuid or the literal "me". An Analytics drill-down carries
  // it, and the list has to honour it or the figure the reader clicked opens a
  // different set of rows than it counted.
  const assignedTo = params.get("assigned_to");
  const assigneeName = params.get("assignee_name");
  // The search, in the URL like every other narrowing: it is one box for both
  // views, and a link to "the tasks about Brasseries" should open on them.
  const search = params.get("q") ?? "";
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  // The file filter and the search reach the board too, so switching
  // Board↔List keeps the narrowing rather than silently widening back to the
  // whole tenant.
  const q = useTaskBoard({
    audience,
    dossier_id: dossierId || undefined,
    assigned_to: assignedTo || undefined,
    q: search || undefined,
  });
  const showList = React.useCallback(() => {
    const next = new URLSearchParams(params);
    next.set("view", "list");
    setParams(next, { replace: true });
  }, [params, setParams]);
  // Memoised: the effect below depends on it, and a fresh array per render
  // would run that effect on every render.
  const offered = React.useMemo<Audience[]>(() => q.data?.audiences ?? ["mine"], [q.data]);
  const effective = q.data?.audience ?? audience;

  // A deep link (`?task=<id>`) opens the panel on arrival, then the parameter
  // is stripped so a refresh does not reopen what the user has since closed.
  React.useEffect(() => {
    const id = params.get("task");
    if (!id) return;
    setSelectedId(id);
    params.delete("task");
    setParams(params, { replace: true });
  }, [params, setParams]);

  // The server narrows an audience the caller may not use; keep the switch on
  // the truth rather than on the wish.
  React.useEffect(() => {
    if (!offered.includes(audience)) setAudience("mine");
  }, [offered, audience]);

  function chooseAudience(next: Audience) {
    setAudience(next);
    if (next === "mine") params.delete("audience");
    else params.set("audience", next);
    setParams(params, { replace: true });
  }

  function chooseFile(file: { dossier_id: string; ref: string } | null) {
    const next = new URLSearchParams(params);
    if (file) {
      next.set("dossier_id", file.dossier_id);
      next.set("dossier_ref", file.ref);
    } else {
      next.delete("dossier_id");
      next.delete("dossier_ref");
      // A stage is a narrowing of a file, so clearing the file clears it here
      // exactly as it does on the task itself — leaving it behind would filter
      // the list by a stage with no file beside it to explain the emptiness.
      next.delete("milestone_instance_id");
      next.delete("milestone_label");
    }
    setParams(next, { replace: true });
  }

  function clearMilestone() {
    const next = new URLSearchParams(params);
    next.delete("milestone_instance_id");
    next.delete("milestone_label");
    setParams(next, { replace: true });
  }

  function clearAssignee() {
    const next = new URLSearchParams(params);
    next.delete("assigned_to");
    next.delete("assignee_name");
    setParams(next, { replace: true });
  }

  const chooseSearch = React.useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next.trim()) out.set("q", next.trim());
          else out.delete("q");
          return out;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  function chooseView(next: "board" | "list") {
    if (next === "list") params.set("view", "list");
    else params.delete("view");
    setParams(params, { replace: true });
  }

  const closeTask = React.useCallback(() => setSelectedId(null), []);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        title="Tasks"
        description="What has to happen, in the order it has to happen in. Drag a card to move it, or use the Move menu."
        action={<Button onClick={() => setCreateOpen(true)}>New task</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="Tasks layout"
          value={view}
          onChange={(v) => chooseView(v as "board" | "list")}
          options={[
            { value: "board", label: "Board" },
            { value: "list", label: "List" },
          ]}
        />
        {offered.length > 1 && (
          <Segmented
            label="Whose work to show"
            value={effective}
            onChange={(v) => chooseAudience(v as Audience)}
            options={offered.map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }))}
          />
        )}
        {effective !== "mine" && (
          <span className="micro text-muted-foreground">
            Showing {AUDIENCE_LABEL[effective].toLowerCase()}.
          </span>
        )}
        {/* One search for both views. The server matches the title, the
            notes, the linked file's reference and its client, and step
            titles — the words a person actually remembers a task by. */}
        <SearchField
          id="tasks-search"
          value={search}
          onChange={chooseSearch}
          label={tr("Search tasks")}
          placeholder={tr("Search title, notes, file or client…")}
          className="ml-auto max-w-md"
        />
      </div>

      {q.error ? (
        <ScreenError message={q.error.message} what="Your tasks" onRetry={() => void q.refetch()} />
      ) : (
        /*
          `items-start` so the detail column is its natural height and can stick
          — a stretched grid item is as tall as the board and has nothing to
          stick to. The template only gains its second column while a task is
          open, and `xl:` is the same number as `useIsWide`, so the CSS and the
          branch agree at every width by construction.
        */
        <div
          className={cn(
            "grid items-start gap-4",
            isWide && selectedId && "xl:grid-cols-[minmax(0,1fr)_22rem]",
          )}
        >
          {view === "board" ? (
            <TaskBoard
              board={q.data?.board}
              loading={q.isLoading}
              selectedId={selectedId}
              onOpen={setSelectedId}
              onCreate={() => setCreateOpen(true)}
              query={search}
              onClearQuery={() => chooseSearch("")}
              // The reach the cards were rendered at travels with every move
              // and into the detail read, so a Team or All card opens and
              // mutates as the same task the board showed (B-03).
              audience={effective}
              completeness={q.data?.completeness}
              onShowList={showList}
            />
          ) : (
            <TaskList
              audience={effective}
              selectedId={selectedId}
              onOpen={setSelectedId}
              onCreate={() => setCreateOpen(true)}
              search={search}
              dossierId={dossierId}
              dossierRef={dossierRef}
              milestoneInstanceId={milestoneInstanceId}
              milestoneLabel={milestoneLabel}
              onMilestoneClear={clearMilestone}
              assignedTo={assignedTo}
              assigneeName={assigneeName}
              onAssigneeClear={clearAssignee}
              onDossierChange={chooseFile}
            />
          )}

          {/*
            THE detail column. Only while a task is open (see the header), and
            `sticky` because a board with a few cards in it is taller than the
            viewport: a panel that scrolls away is a panel the user has to
            scroll back to, and the task they just opened is the thing they are
            reading. Its own `max-h` + scroll is what keeps a long task (thirty
            steps, a paragraph of description) reachable at the bottom.
          */}
          {isWide && selectedId && (
            <aside
              aria-label="Task"
              className="min-w-0 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto"
            >
              <TaskPanel taskId={selectedId} onClose={closeTask} audience={effective} />
            </aside>
          )}
        </div>
      )}

      {/*
        The same panel, as a sheet, where there is no room to sit it beside the
        board. One component, two placements — so the two cannot drift. Rendered
        only below `xl`, and that is a JavaScript branch rather than a CSS one
        for the portal reason in the header: a `<Dialog>` hidden by a wrapper's
        breakpoint is not hidden at all.
      */}
      {!isWide && (
        <Dialog
          open={!!selectedId}
          onClose={closeTask}
          title="Task"
          placement="right"
          bodyClassName="p-0"
        >
          {selectedId && <TaskPanel taskId={selectedId} onClose={closeTask} audience={effective} />}
        </Dialog>
      )}

      <TaskDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </section>
  );
}
