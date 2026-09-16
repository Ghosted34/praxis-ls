/**
 * Tasks — the board, with a detail panel beside it on a wide screen.
 *
 * ── THE AUDIENCE SWITCH OFFERS ONLY WHAT THE SERVER WILL HONOUR ────────────
 *
 * `GET /workspace/tasks/board` answers with `audiences`: the list this caller
 * may actually ask for, derived from their RBAC grants and organigramme
 * closure. The switch renders that list and nothing else. The alternative —
 * always showing "Everyone" and letting the server narrow it — is a control
 * that appears to do something and does not, which is worse than not offering
 * it, because the user concludes they have no team rather than no permission.
 *
 * ── MASTER-DETAIL ──────────────────────────────────────────────────────────
 *
 * `<SplitPane>` rather than a hand-rolled grid, per FRONTEND_GUIDE §3.14: the
 * open record has to stay visible next to the list, and the split is
 * keyboard-resizable. Below `lg` the panel becomes a Dialog, because a
 * side-by-side split on a phone is two unusable columns.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { pageShell } from "@/lib/layout";
import { PageHeader } from "@/components/data-list";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { ScreenError } from "@/components/connection/screen-error";
import { useTaskBoard } from "../hooks";
import type { Audience } from "../api";
import { AUDIENCE_LABEL } from "../labels";
import { TaskBoard } from "./task-board";
import { TaskDialog } from "./task-dialog";
import { TaskPanel } from "./task-panel";

export function TasksPage() {
  const [params, setParams] = useSearchParams();

  const [audience, setAudience] = React.useState<Audience>(
    (params.get("audience") as Audience) || "mine",
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const q = useTaskBoard({ audience });
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

  return (
    <section className={pageShell.wide}>
      <PageHeader
        title="Tasks"
        description="What has to happen, in the order it has to happen in. Drag a card to move it, or use the Move menu."
        action={<Button onClick={() => setCreateOpen(true)}>New task</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
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
      </div>

      {q.error ? (
        <ScreenError message={q.error.message} what="Your tasks" onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <TaskBoard
            board={q.data?.board}
            loading={q.isLoading}
            onOpen={setSelectedId}
            onCreate={() => setCreateOpen(true)}
          />

          {/* The detail column. `xl` and up only: below that the panel opens
              as a Dialog, because a split on a phone is two narrow columns
              that are each too small to read. */}
          <div className="hidden xl:block">
            {selectedId ? (
              <TaskPanel taskId={selectedId} onClose={() => setSelectedId(null)} />
            ) : (
              <Panel title="Task">
                <p className="micro">
                  Select a card to see its steps, who it belongs to, and the record it points at.
                </p>
              </Panel>
            )}
          </div>
        </div>
      )}

      {/* The same panel, as a sheet, where there is no room to sit it beside
          the board. One component, two placements — so the two cannot drift. */}
      <div className="xl:hidden">
        <Dialog
          open={!!selectedId}
          onClose={() => setSelectedId(null)}
          title="Task"
          placement="right"
          bodyClassName="p-0"
        >
          {selectedId && <TaskPanel taskId={selectedId} onClose={() => setSelectedId(null)} />}
        </Dialog>
      </div>

      <TaskDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </section>
  );
}
