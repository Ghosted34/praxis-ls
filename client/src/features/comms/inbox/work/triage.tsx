/**
 * THE SHARED-INBOX CONTROLS (§9.1–§9.5).
 *
 * Everything an operator does to a conversation that is not reading or
 * replying: claim it, hand it over, close it, bring it back later, decide who
 * can see it.
 *
 * ── CLAIMING IS THE POINT OF A SHARED MAILBOX ───────────────────────────────
 *
 * Two people answering the same client is the failure a shared mailbox exists
 * to prevent, and it is silent — nobody finds out until the client mentions it.
 * So the assignee is shown FIRST, before the reply button, and claiming is one
 * click.
 *
 * ── THE LOCK IS SOFT, AND SAYS WHOSE IT IS ──────────────────────────────────
 *
 * Opening the composer takes a two-minute lock. It expires, and taking one
 * never steals a live one — a lock nobody can release is a worse problem than
 * the one it solves, especially in a mailbox where the person holding it may
 * have closed their laptop. When somebody else holds it, this bar says WHO, so
 * the second person can go and ask rather than wait.
 *
 * ── SNOOZE IS A FOLLOW-UP, NOT A HIDE ───────────────────────────────────────
 *
 * A snoozed thread comes back. A client reply cancels every pending boomerang
 * on the thread silently — the sweep and the ingest path share one rule
 * server-side — so a follow-up never nags about a client who already answered.
 *
 * ── VISIBILITY IS A DECISION WITH CONSEQUENCES ──────────────────────────────
 *
 * PRIVATE / TEAM / COMPANY changes who can read the conversation, and the
 * change takes effect for everyone immediately. It is spelled out here rather
 * than left to three words in a dropdown, because someone marking a thread
 * COMPANY is publishing it to the whole tenant and should be told so.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill, type Tone } from "@/components/ui/pill";
import { Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { dateTimeFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

const STATUS: { value: api.WorkStatus; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "PENDING", label: "Waiting on them" },
  { value: "RESOLVED", label: "Done" },
];
const STATUS_TONE: Record<api.WorkStatus, Tone> = { OPEN: "blue", PENDING: "warn", RESOLVED: "ok" };

const VISIBILITY: { value: api.Visibility; label: string; note: string }[] = [
  { value: "PRIVATE", label: "Just me", note: "Only you and anyone you share it with." },
  { value: "TEAM", label: "This mailbox's team", note: "Everyone with access to this mailbox." },
  { value: "COMPANY", label: "Everyone", note: "Anyone in the company who opens the mailbox." },
];

/** Common relative snooze choices, resolved to an instant at click time. */
const SNOOZE = [
  { label: "This afternoon", hours: 4 },
  { label: "Tomorrow", hours: 24 },
  { label: "Next week", hours: 24 * 7 },
];

export function TriageBar({
  thread,
  onChanged,
}: {
  thread: {
    email_thread_id: string;
    assigned_to?: string | null;
    assigned_to_name?: string | null;
    work_status?: api.WorkStatus | null;
    visibility?: api.Visibility | null;
    sla_due_at?: string | null;
    sla_breached?: boolean | null;
    locked_by_name?: string | null;
    lock_expires_at?: string | null;
  };
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = React.useState(false);
  const [customDue, setCustomDue] = React.useState("");
  const [handOverOpen, setHandOverOpen] = React.useState(false);
  const [assignee, setAssignee] = React.useState("");

  const id = thread.email_thread_id;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try { await fn(); onChanged(); } catch (err) { reportActionError(err); } finally { setBusy(null); }
  }

  const status = (thread.work_status || "OPEN") as api.WorkStatus;
  const overdue = Boolean(thread.sla_breached);
  const dueSoon = !overdue && thread.sla_due_at && Date.parse(thread.sla_due_at) - Date.now() < 3600_000;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Assignee first — see the header. */}
        {thread.assigned_to ? (
          <Pill tone="blue">{thread.assigned_to_name || tr("Assigned")}</Pill>
        ) : (
          <Button size="sm" disabled={busy !== null} onClick={() => run("claim", () => api.claimThread(id))}>
            {tr("Claim this")}
          </Button>
        )}

        <Pill tone={STATUS_TONE[status]}>{tr(STATUS.find((s) => s.value === status)?.label || status)}</Pill>

        <Select
          value={status}
          aria-label={tr("Work status")}
          disabled={busy !== null}
          onChange={(e) => run("status", () => api.setWorkStatus(id, e.target.value as api.WorkStatus))}
          className="h-8 w-auto text-xs"
        >
          {STATUS.map((s) => (
            <option key={s.value} value={s.value}>{tr(s.label)}</option>
          ))}
        </Select>

        <Button size="sm" variant="outline" onClick={() => setHandOverOpen((v) => !v)}>
          {thread.assigned_to ? tr("Hand over") : tr("Give it to someone")}
        </Button>

        <Button size="sm" variant="outline" onClick={() => setSnoozeOpen((v) => !v)}>
          {tr("Bring it back")}
        </Button>
      </div>

      {/* §9.1: "a thread in a shared mailbox is unassigned until someone claims
          it (OR A LEAD ASSIGNS IT)". Claim shipped; assign did not, so a lead
          could only ask the person to go and claim it themselves, while the
          route, the service and the client wrapper all sat there unreached.
          Assigning over a live assignee is deliberately allowed: handing work
          over IS taking it off somebody, and refusing would strand a thread on
          whoever went on leave. */}
      {handOverOpen && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const uid = assignee.trim();
            if (!uid) return;
            run("assign", () => api.assignThread(id, uid)).then(() => {
              setAssignee("");
              setHandOverOpen(false);
            });
          }}
        >
          <Input
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder={tr("Colleague")}
            aria-label={tr("Hand this conversation to")}
            className="h-8 text-xs"
          />
          <Button size="sm" type="submit" disabled={busy !== null || !assignee.trim()}>
            {tr("Hand over")}
          </Button>
        </form>
      )}

      {/* The SLA, in the terms an operator cares about: is it late. */}
      {thread.sla_due_at && (
        <p className={overdue ? "text-xs font-medium text-[rgb(var(--bad))]" : "text-xs text-muted-foreground"}>
          {overdue
            ? `${tr("A first reply was due")} ${dateTimeFmt(thread.sla_due_at)}.`
            : dueSoon
              ? `${tr("A first reply is due within the hour —")} ${dateTimeFmt(thread.sla_due_at)}.`
              : `${tr("A first reply is due")} ${dateTimeFmt(thread.sla_due_at)}.`}
        </p>
      )}

      {thread.locked_by_name && (
        // Names the person, so the second operator can ask rather than wait for
        // a lock they cannot see the end of.
        <p className="text-xs text-muted-foreground">
          {thread.locked_by_name} {tr("is writing a reply")}
          {thread.lock_expires_at ? <> {tr("until")} {dateTimeFmt(thread.lock_expires_at)}</> : null}.
        </p>
      )}

      {snoozeOpen && (
        <div className="space-y-1.5 rounded-lg border border-border bg-card/40 px-3 py-2">
          <div className="flex flex-wrap gap-2">
            {SNOOZE.map((s) => (
              <Button
                key={s.label}
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  run("snooze", () =>
                    api.snoozeThread(id, new Date(Date.now() + s.hours * 3600_000).toISOString()))
                    .then(() => setSnoozeOpen(false))
                }
              >
                {tr(s.label)}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="datetime-local"
              value={customDue}
              onChange={(e) => setCustomDue(e.target.value)}
              aria-label={tr("Bring it back at")}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              disabled={busy !== null || !customDue}
              onClick={() =>
                run("snooze", () => api.snoozeThread(id, new Date(customDue).toISOString()))
                  .then(() => setSnoozeOpen(false))
              }
            >
              {tr("Set")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {tr("If they reply before then, this cancels itself.")}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Who can read this conversation.
 *
 * Separate from the triage bar because it is a different kind of decision —
 * rarer, and with a consequence that does not undo itself. The note under the
 * dropdown changes with the selection so the reader sees what they are about to
 * do before they do it.
 */
export function VisibilityControl({
  threadId,
  visibility,
  onChanged,
}: {
  threadId: string;
  visibility?: api.Visibility | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const current = (visibility || "TEAM") as api.Visibility;
  const note = VISIBILITY.find((v) => v.value === current)?.note;

  return (
    <div className="space-y-3">
    <div className="space-y-1">
      <label className="block text-xs font-medium text-muted-foreground" htmlFor={`vis-${threadId}`}>
        {tr("Who can see this")}
      </label>
      <Select
        id={`vis-${threadId}`}
        value={current}
        disabled={busy}
        className="h-8 w-auto text-xs"
        onChange={async (e) => {
          setBusy(true);
          try {
            await api.setVisibility(threadId, e.target.value as api.Visibility);
            onChanged();
          } catch (err) {
            reportActionError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {VISIBILITY.map((v) => (
          <option key={v.value} value={v.value}>{tr(v.label)}</option>
        ))}
      </Select>
      {note && <p className="text-xs text-muted-foreground">{tr(note)}</p>}
    </div>

    {/* Sharing is the EXCEPTION to the visibility rule, not a second way of
        expressing it. A PRIVATE thread shared with one colleague stays private
        to everyone else — which is why the two controls sit together and the
        share list only earns its place when the thread is not already
        company-wide. */}
    {current !== "COMPANY" && <ThreadShares threadId={threadId} />}
    </div>
  );
}

/**
 * Who else can read this one conversation (§9.5).
 *
 * The visibility setting answers "which group", and this answers "and also
 * these people". `triage/visibility`'s single predicate reads both, so a share
 * is not a workaround for a PRIVATE thread — it is part of the same rule.
 *
 * Revoking is offered next to every name for the reason unbinding is: the
 * person who notices a share is wrong is usually not the person who made it,
 * and they will not go hunting for a way to correct someone else's work.
 */
function ThreadShares({ threadId }: { threadId: string }) {
  const shares = useResource(() => api.listShares(threadId), [threadId]);
  const [userId, setUserId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); shares.reload(); } catch (err) { reportActionError(err); } finally { setBusy(false); }
  }

  const rows = shares.data || [];

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{tr("Shared with")}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tr("Nobody outside the group above.")}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((s) => (
            <li key={s.user_id} className="flex items-center justify-between gap-2 text-xs">
              <span>{s.user_name || s.user_id}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => run(() => api.unshareThread(threadId, s.user_id))}
              >
                {tr("Remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const id = userId.trim();
          if (!id) return;
          run(() => api.shareThread(threadId, id)).then(() => setUserId(""));
        }}
      >
        <Input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder={tr("Colleague")}
          aria-label={tr("Share with")}
          className="h-8 text-xs"
        />
        <Button size="sm" type="submit" disabled={busy || !userId.trim()}>{tr("Share")}</Button>
      </form>
    </div>
  );
}
