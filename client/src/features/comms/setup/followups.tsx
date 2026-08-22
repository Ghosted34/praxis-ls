/**
 * Comms → Setup → Follow-ups (§9.3).
 *
 * Every conversation waiting to come back, and the one control that matters:
 * cancel.
 *
 * ── WHY THIS LIST EXISTS AT ALL ─────────────────────────────────────────────
 *
 * Snoozing is easy to do and easy to forget. A thread snoozed to "next week"
 * disappears, and the only way to find out what is queued is to wait for it. A
 * person coming back from leave, or taking over someone's mailbox, needs to see
 * what is about to reappear before it does.
 *
 * ── A REPLY CANCELS IT, SILENTLY ────────────────────────────────────────────
 *
 * The sweep and the ingest path share one rule server-side: a client reply
 * cancels every pending boomerang on the thread. So a follow-up that vanishes
 * from this list without anyone touching it is the system working, and the
 * screen says so — otherwise the first person to notice reports it as a bug.
 *
 * ── CANCELLING IS NOT DELETING THE THREAD ───────────────────────────────────
 *
 * Spelled out, because "cancel" next to a conversation is ambiguous enough that
 * somebody will hesitate over it. It drops the reminder; the conversation stays
 * exactly where it is.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill, type Tone } from "@/components/ui/pill";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { dateTimeFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

/** Overdue, soon, or later — the three states that change what you do next. */
function due(f: api.Followup): { label: string; tone: Tone } {
  const t = Date.parse(f.due_at);
  if (Number.isNaN(t)) return { label: "—", tone: "mute" };
  const delta = t - Date.now();
  if (delta < 0) return { label: tr("Overdue"), tone: "bad" };
  if (delta < 24 * 3600_000) return { label: tr("Today"), tone: "warn" };
  return { label: tr("Waiting"), tone: "mute" };
}

const TRIGGER_TEXT: Record<string, string> = {
  NO_REPLY: "if they have not replied",
  ALWAYS: "whatever happens",
  NOT_OPENED: "if it has not been opened",
};

export function FollowupsTab() {
  const followups = useResource(() => api.listFollowups(), []);
  const [busy, setBusy] = React.useState<string | null>(null);

  const rows = (followups.data || []).filter((f) => f.status === "PENDING" || !f.status);

  const columns: Column<api.Followup>[] = [
    {
      key: "due_at",
      label: tr("Comes back"),
      render: (r) => <span className="num">{dateTimeFmt(r.due_at)}</span>,
    },
    {
      key: "state",
      label: "",
      srLabel: tr("State"),
      render: (r) => {
        const d = due(r);
        return <Pill tone={d.tone}>{d.label}</Pill>;
      },
    },
    {
      key: "trigger",
      label: tr("Condition"),
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {TRIGGER_TEXT[r.trigger || "NO_REPLY"] ? tr(TRIGGER_TEXT[r.trigger || "NO_REPLY"]) : r.trigger}
        </span>
      ),
    },
    {
      key: "subject",
      label: tr("Conversation"),
      render: (r) => r.subject || tr("(no subject)"),
    },
    { key: "note", label: tr("Note"), render: (r) => r.note || "—" },
    {
      key: "_a",
      label: "",
      render: (r) => (
        <Button
          size="sm"
          variant="outline"
          disabled={busy === r.email_followup_id}
          onClick={async () => {
            setBusy(r.email_followup_id);
            try {
              await api.cancelFollowup(r.email_followup_id);
              followups.reload();
            } catch (err) {
              reportActionError(err);
            } finally {
              setBusy(null);
            }
          }}
        >
          {tr("Cancel")}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={tr("Follow-ups")}
        description={tr("Conversations waiting to come back. Cancelling drops the reminder — the conversation itself stays where it is.")}
      />

      {/* Said before anyone reports it as a bug. */}
      <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
        {tr("A follow-up cancels itself when the other side replies, so one disappearing from this list on its own is the system working.")}
      </p>

      <DataList
        columns={columns}
        rows={rows}
        error={followups.error}
        loading={followups.loading}
        rowKey={(r) => r.email_followup_id}
        empty={{
          title: tr("Nothing is waiting to come back"),
          hint: tr("Snooze a conversation from the reading pane and it appears here until it fires or they reply."),
        }}
      />
    </div>
  );
}
