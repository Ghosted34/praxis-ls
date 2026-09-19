/**
 * The Tasks tab of an operations file 360 (13920).
 *
 * ── WHY THE FILE NEEDS ONE ─────────────────────────────────────────────────
 *
 * A file already shows what the SYSTEM knows is happening to it — milestones,
 * documents, invoices, queries. What it could not show is what PEOPLE have
 * undertaken to do about it: "chase the BL", "call the client about the
 * demurrage", "get the delivery order signed". That work was written down in
 * Workspace with no way to say which shipment it was for, so the file's own
 * screen could not report it and a handover meant reading somebody's to-do
 * list and matching it to a dossier by memory.
 *
 * ── IT IS THE TASKS LIST, NOT A COPY OF IT ─────────────────────────────────
 *
 * This renders the same `TaskList` the Workspace screen does, narrowed to one
 * file, rather than a bespoke table. Two renderings of the same rows drift on
 * the first column one of them grows — the milestone chain in this very file
 * carried that bug until `MilestoneChain` was shared — and the drift shows up
 * as "the Move menu works in Workspace but not on the file", which reads as a
 * missing feature rather than as the duplication it is.
 *
 * The file picker is deliberately NOT offered here: the file is fixed by the
 * page, and a picker would offer to navigate the reader away from the very
 * file whose tab they opened.
 *
 * ── AUDIENCE ───────────────────────────────────────────────────────────────
 *
 * `all`, requested — never granted by this screen. The server narrows an
 * audience the caller may not use, exactly as it does in Workspace, so this
 * asks for the widest reach and renders whatever it is actually given. Asking
 * for `mine` instead would be wrong in the dangerous direction: a file's tab
 * showing only the reader's own tasks would read as "nothing outstanding on
 * this shipment" while a colleague's overdue task sat on it.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TaskList } from "@/features/workspace/tasks/task-list";
import { TaskDialog } from "@/features/workspace/tasks/task-dialog";

export function FileTasksTab({ fileId }: { fileId: string }) {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = React.useState(false);

  /*
   * Opening a task leaves for Workspace rather than rendering the detail pane
   * inside this tab. The pane is tall — steps, watchers, dependencies, the
   * reminder list — and nesting it under a 360 that already has a KPI row and
   * a tab strip puts the thing the reader clicked below the fold. The deep
   * link is the one the bell and the board already use.
   */
  const openTask = React.useCallback(
    (id: string) => navigate(`/workspace/tasks?task=${encodeURIComponent(id)}`),
    [navigate],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro">
          Work people have undertaken on this file. Completing a task never moves a
          milestone — the chain is what was promised a client.
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          New task on this file
        </Button>
      </div>

      <TaskList
        audience="all"
        selectedId={null}
        onOpen={openTask}
        onCreate={() => setCreateOpen(true)}
        dossierId={fileId}
      />

      <TaskDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        // Pre-linked, and VISIBLY so: the form opens showing the file rather
        // than applying it on save, so the user can see what they are about to
        // attach the work to — and can still pick a milestone within it.
        initial={{ dossier_id: fileId }}
        onSaved={() => setCreateOpen(false)}
      />
    </div>
  );
}
