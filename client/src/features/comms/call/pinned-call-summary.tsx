/**
 * The caller's call-summary draft, pinned above the composer of the
 * conversation the call was in (owner decision O3). Collapsed, it says what is
 * waiting; "Review & send" opens the same editor as the call's page, so the
 * caller edits, switches language, sends or discards without leaving the chat.
 * The summary notification opens the conversation with it expanded
 * (`?summary=<call id>`). Only the caller has drafts to pin; the callee sees
 * the summary once it is sent, as a message.
 */
import { Link } from "react-router-dom";
import { tr, tv } from "@/lib/i18n";
import { dateTimeFmt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { PhoneIcon } from "@/components/ui/icons";
import type { PendingCallSummary } from "@/lib/smartcomm-api";
import { CallSummaryEditor } from "./summary-draft";
import { callDuration } from "./call-labels";

export function PinnedCallSummary({
  drafts,
  openCallId,
  onOpenChange,
  onChanged,
  refreshKey,
}: {
  /** The caller's pending drafts in this conversation, newest first. */
  drafts: PendingCallSummary[];
  /** The draft to show expanded (from `?summary=`), or null. */
  openCallId: string | null;
  onOpenChange: (callId: string | null) => void;
  /** After a send or a discard: the card goes once the thread re-reads. */
  onChanged: () => void;
  /** Bumped when the server redrafted a summary. */
  refreshKey?: number;
}) {
  if (!drafts.length) return null;
  const draft = drafts.find((d) => d.call_id === openCallId) || drafts[0];
  const open = openCallId === draft.call_id;
  const others = drafts.length - 1;
  const regionId = `pinned-call-summary-${draft.call_id}`;
  const meta = [dateTimeFmt(draft.started_at), callDuration(draft.duration_seconds)].filter(Boolean).join(" · ");

  return (
    <section
      aria-label={tr("Call summary — Review & send")}
      className="flex min-h-0 flex-col border-t border-border bg-card px-3 py-2"
    >
      {/* The section may shrink (min-h-0) so on a short screen the editor
          scrolls inside the space left and the composer stays in view. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <PhoneIcon width={16} height={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{tr("Call summary — Review & send")}</p>
          <p className="truncate text-micro text-muted-foreground">
            {meta}
            {others > 0 ? ` · ${tv("{{n}} more waiting", { n: others })}` : ""}
          </p>
        </div>
        {others > 0 && (
          <Link to="/comms/calls" className="shrink-0 text-micro text-primary-ink hover:underline">
            {tr("All calls")}
          </Link>
        )}
        <Button
          size="sm"
          variant={open ? "outline" : "default"}
          icon={null}
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => onOpenChange(open ? null : draft.call_id)}
        >
          {open ? tr("Hide") : tr("Review & send")}
        </Button>
      </div>
      {open && (
        <div
          id={regionId}
          className="mt-2 max-h-[55vh] min-h-0 overflow-y-auto overscroll-contain rounded-[10px] border border-border bg-background p-3"
        >
          <CallSummaryEditor callId={draft.call_id} onChanged={onChanged} refreshKey={refreshKey} />
          <p className="mt-3 text-micro">
            <Link to={`/comms/calls/${draft.call_id}`} className="text-primary-ink hover:underline">
              {tr("Open the call record")}
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}
