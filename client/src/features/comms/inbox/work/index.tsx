/**
 * THE WORK RAIL — everything about a thread that is not the thread.
 *
 * Binding, the record, what you can start from it, what is waiting to be filed,
 * what the team said about it, and how it is being worked.
 *
 * ── WHY ONE RAIL AND NOT SIX PANELS ─────────────────────────────────────────
 *
 * Each of these was specified separately and they compete for the same screen
 * edge. Rendering them as one accordion with one open section at a time keeps
 * the reading pane wide — which is the thing an operator actually spends the
 * day in — and, more importantly, keeps the COST bounded: only the open section
 * fetches, so opening a thread costs the binding call and nothing else.
 *
 * §3.6's 300 ms budget is not a property of any one of these panels. It is a
 * property of how many of them run at once, which is a decision that has to be
 * made here rather than inside any of them.
 *
 * ── THE ORDER IS THE WORKFLOW ───────────────────────────────────────────────
 *
 * Binding is first and always visible, because everything below it is empty
 * until a thread is bound and there is no way to discover that from a collapsed
 * section. Then the record, then what to do about it, then the team's notes.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { BindingChip } from "./binding";
import { DossierDrawer } from "./dossier-drawer";
import { ActionCards } from "./action-cards";
import { DocumentIntake } from "./intake";
import { ThreadNotes } from "./notes";
import { ConvertDialog } from "./convert";
import { ThreadSummary } from "./assist";
import { TriageBar, VisibilityControl } from "./triage";
import type { Visibility, WorkStatus } from "@/lib/mail-api";

type Section = "record" | "actions" | "documents" | "notes" | "sharing";

const SECTIONS: { key: Section; label: string; needsBinding: boolean }[] = [
  { key: "record", label: "The record", needsBinding: true },
  { key: "actions", label: "What you can start", needsBinding: true },
  { key: "documents", label: "Documents", needsBinding: false },
  { key: "notes", label: "Team notes", needsBinding: false },
  { key: "sharing", label: "Access", needsBinding: false },
];

export type WorkRailThread = {
  email_thread_id: string;
  entity_ref?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  work_status?: WorkStatus | null;
  visibility?: Visibility | null;
  sla_due_at?: string | null;
  sla_breached?: boolean | null;
  locked_by_name?: string | null;
  lock_expires_at?: string | null;
};

export function WorkRail({
  thread,
  onChanged,
  language = "en",
}: {
  thread: WorkRailThread;
  onChanged: () => void;
  language?: "en" | "fr";
}) {
  const [open, setOpen] = React.useState<Section | null>(null);
  const [converting, setConverting] = React.useState(false);
  const id = thread.email_thread_id;
  const bound = thread.entity_ref || null;

  // Collapse when the thread changes. Leaving a section open would fire its
  // fetch for the new thread the instant the list selection moves, which turns
  // arrowing down a folder into one request per row per open panel.
  React.useEffect(() => { setOpen(null); setConverting(false); }, [id]);

  return (
    <aside className="flex min-h-0 w-full flex-col gap-3 overflow-y-auto border-l border-border p-3 text-sm">
      <TriageBar thread={thread} onChanged={onChanged} />

      <ThreadSummary threadId={id} />

      <BindingChip
        threadId={id}
        entityRef={bound}
        onChanged={onChanged}
        onOpenRecord={() => setOpen("record")}
      />

      {!bound && (
        <Button size="sm" variant="outline" onClick={() => setConverting(true)}>
          Turn this into a record
        </Button>
      )}

      {SECTIONS.map((s) => {
        const disabled = s.needsBinding && !bound;
        const isOpen = open === s.key;
        return (
          <section key={s.key}>
            <button
              type="button"
              disabled={disabled}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : s.key)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-1 py-1.5 text-left text-xs font-medium",
                disabled ? "cursor-not-allowed text-muted-foreground/60" : "hover:bg-muted",
              )}
            >
              <span>{s.label}</span>
              <span aria-hidden>{isOpen ? "−" : "+"}</span>
            </button>
            {/* Disabled sections say WHY, in the place the reason belongs. A
                greyed row with no explanation is the pattern §7.3 spends a
                whole chapter refusing. */}
            {disabled && (
              <p className="px-1 text-xs text-muted-foreground">
                Link this thread to a client or a file first.
              </p>
            )}
            {isOpen && !disabled && (
              <div className="mt-1.5 px-1">
                {s.key === "record" && bound && <DossierDrawer entityRef={bound} />}
                {s.key === "actions" && <ActionCards threadId={id} language={language} />}
                {s.key === "documents" && <DocumentIntake threadId={id} />}
                {s.key === "notes" && <ThreadNotes threadId={id} />}
                {s.key === "sharing" && (
                  <VisibilityControl
                    threadId={id}
                    visibility={thread.visibility}
                    onChanged={onChanged}
                  />
                )}
              </div>
            )}
          </section>
        );
      })}

      {converting && (
        <ConvertDialog
          threadId={id}
          onClose={() => setConverting(false)}
          onConverted={onChanged}
        />
      )}
    </aside>
  );
}

export { BindingChip } from "./binding";
export { DossierDrawer } from "./dossier-drawer";
export { ActionCards } from "./action-cards";
export { DocumentIntake, Extractions, ChaseSnippet } from "./intake";
export { ThreadNotes } from "./notes";
export { ConvertDialog } from "./convert";
export { AssistToolbar, ThreadSummary, DraftProvenance } from "./assist";
export { GuardrailBar, VerdictBanner, VerdictPill } from "./guardrails";
export { TriageBar, VisibilityControl } from "./triage";
export { SchedulePicker } from "./schedule";

// `useGuardrails` (./use-guardrails) and `schedulePayload` / `ScheduleChoice`
// (./schedule-payload) are deliberately NOT re-exported here. This file defines
// WorkRail, so re-exporting a hook or a plain function through it costs the
// component its fast refresh — and nothing imported them from the barrel
// anyway: the composer and the tests both reach for the modules directly, which
// is the clearer import to read.
