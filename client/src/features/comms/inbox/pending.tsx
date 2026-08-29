/**
 * DRAFTS AND THE OUTBOX — the two lists of mail that has not gone anywhere.
 *
 * ── BOTH WERE BUILT AND NEITHER HAD A SCREEN ────────────────────────────────
 *
 * `GET /mail/drafts`, `GET /mail/drafts/:id`, `DELETE /mail/drafts/:id`,
 * `GET /mail/outbox` and `POST /mail/send/:id/cancel` have all worked since
 * PR-1B. `tests/security/mail-client-api-wiring.test.js` even grandfathered
 * three of them by name — "no draft-list screen: the composer autosaves and
 * never re-opens by id" — which recorded the gap accurately and left it open.
 *
 * What that meant in practice, for the person at the keyboard:
 *
 *   DRAFTS   The composer autosaves every 1.5 seconds. Close it — deliberately,
 *            or by navigating away, or because a tab crashed — and the draft is
 *            still on the server, with its attachments, and there is no way
 *            back to it. Not a hidden way; none. The "Drafts" entry in the
 *            folder rail lists the IMAP DRAFTS folder, which by Q11 ("no
 *            provider draft sync") is exactly where our drafts are NOT. So the
 *            one place a person looks is the one place guaranteed to be empty.
 *
 *   OUTBOX   Worse, because the product promises it. Schedule a message for
 *            Tuesday and the composer says, in as many words, "You can cancel
 *            it from the outbox until then." There was no outbox. The undo
 *            toast is the only handle on a queued send and it lives inside the
 *            composer, so closing the composer was the last chance to stop it.
 *
 *            And FAILED rows sat there unseen. A send the queue gave up on —
 *            a rejected sender address, three attempts, permanent — leaves the
 *            row with `last_error` set and tells nobody. The operator saw the
 *            message accepted, saw the undo toast count down, and believed the
 *            invoice went out. That is the failure mode this screen exists for.
 *
 * ── WHY ONE FILE FOR TWO LISTS ──────────────────────────────────────────────
 *
 * They answer the same question — "where is the mail I wrote?" — and a person
 * who cannot find something they typed will look in both. Splitting them across
 * two modules would put the answer in two places for no gain; they share the
 * row chrome and nothing else.
 *
 * ── WHAT THESE LISTS ARE NOT ────────────────────────────────────────────────
 *
 * Not conversations. `ThreadList` renders `email_thread` rows with per-user
 * read state, stars, labels, bulk moves and a folder — none of which a draft or
 * a queued send has. Reusing it would mean teaching it two shapes it has no
 * business knowing, so these are their own lists with their own two verbs each:
 * open/discard, and cancel.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill, type Tone } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { dateTimeFmt, fmtRelative } from "@/lib/format";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

/** A draft or a queued send, drawn the same way. */
function Row({
  title,
  who,
  when,
  meta,
  tone,
  actions,
  onOpen,
}: {
  title: string;
  who: string;
  when: string;
  meta?: React.ReactNode;
  tone?: React.ReactNode;
  actions: React.ReactNode;
  onOpen?: () => void;
}) {
  return (
    <li className="flex items-start gap-2 border-b border-border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        {onOpen ? (
          <button type="button" onClick={onOpen} className="block w-full min-w-0 text-left">
            <span className="block truncate text-sm font-medium">{title}</span>
            <span className="num block truncate text-xs text-muted-foreground">{who}</span>
          </button>
        ) : (
          <>
            <span className="block truncate text-sm font-medium">{title}</span>
            <span className="num block truncate text-xs text-muted-foreground">{who}</span>
          </>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="num text-xs text-muted-foreground">{when}</span>
          {tone}
        </div>
        {meta}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </li>
  );
}

/* ── Drafts ───────────────────────────────────────────────────────────────── */

/**
 * `onOpen` hands the whole draft back rather than an id, so the composer opens
 * with the SAME `email_draft_id` and its next autosave updates the row it came
 * from. Passing an id and re-fetching would work too; passing the row means the
 * composer cannot open on a draft that has since been discarded in another tab.
 */
export function DraftList({ onOpen }: { onOpen: (draft: api.Draft) => void }) {
  const drafts = useResource(() => api.listDrafts(), []);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function discard(d: api.Draft) {
    const to = (d.to_address || []).join(", ");
    const ok = window.confirm(
      `${tr("Discard this draft?")}\n\n` +
      `${d.subject || tr("(no subject)")}${to ? ` — ${to}` : ""}\n\n` +
      tr("It is deleted, along with anything attached to it. This cannot be undone."),
    );
    if (!ok) return;
    setBusy(d.email_draft_id);
    try {
      await api.discardDraft(d.email_draft_id);
      drafts.reload();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(null);
    }
  }

  if (drafts.error) return <ErrorState message={drafts.error} />;
  const rows = drafts.data || [];

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <span className="num text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? tr("draft") : tr("drafts")}
        </span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {drafts.loading && <LoadingRow label={tr("Loading drafts…")} />}
        {!drafts.loading && rows.length === 0 && (
          <li className="p-4">
            <EmptyState
              title={tr("No drafts")}
              hint={tr("Anything you start writing and close is kept here until you send or discard it.")}
            />
          </li>
        )}
        {rows.map((d) => (
          <Row
            key={d.email_draft_id}
            title={d.subject || tr("(no subject)")}
            who={(d.to_address || []).join(", ") || tr("No recipient yet")}
            when={d.updated_at ? `${tr("Edited")} ${fmtRelative(d.updated_at)}` : ""}
            tone={d.kind !== "NEW" ? <Pill tone="mute">{tr(d.kind === "FORWARD" ? "Forward" : "Reply")}</Pill> : null}
            onOpen={() => onOpen(d)}
            actions={
              <>
                <Button size="sm" variant="outline" onClick={() => onOpen(d)}>
                  {tr("Open")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === d.email_draft_id}
                  onClick={() => discard(d)}
                >
                  {tr("Discard")}
                </Button>
              </>
            }
          />
        ))}
      </ul>
    </div>
  );
}

/* ── Outbox ───────────────────────────────────────────────────────────────── */

const STATUS: Record<api.OutboxEntry["status"], { tone: Tone; label: string; why: string }> = {
  HELD: {
    tone: "warn",
    label: "Waiting",
    why: "Not sent yet. Cancel it and it never goes.",
  },
  QUEUED: {
    tone: "blue",
    label: "Going out",
    why: "Released to the mail server — too late to stop.",
  },
  SENDING: {
    tone: "blue",
    label: "Sending",
    why: "On its way to the mail server right now.",
  },
  FAILED: {
    tone: "bad",
    label: "Did not send",
    why: "The mail server refused it. It will not be retried.",
  },
  SENT: { tone: "ok", label: "Sent", why: "" },
  CANCELLED: { tone: "mute", label: "Cancelled", why: "" },
};

/**
 * What is in the queue, and — for the rows that failed — why.
 *
 * The list refreshes on a timer because nothing pushes: a HELD row becomes
 * QUEUED when its release time passes, and a QUEUED one becomes SENT or FAILED
 * when the flusher gets to it, and neither event reaches this tab. Fifteen
 * seconds is slow enough to be free and fast enough that a person watching a
 * scheduled message go out sees it go.
 *
 * The server only ever returns HELD / QUEUED / SENDING / FAILED — a SENT row
 * has become a message in the thread list and does not belong in two places.
 */
export function OutboxList() {
  const outbox = useResource(() => api.listOutbox(), []);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const reload = outbox.reload;
  React.useEffect(() => {
    const t = setInterval(() => reload(), 15_000);
    return () => clearInterval(t);
  }, [reload]);

  async function cancel(e: api.OutboxEntry) {
    setBusy(e.email_send_queue_id);
    setNote(null);
    try {
      await api.cancelSend(e.email_send_queue_id);
      setNote(tr("Cancelled — it will not be sent."));
      outbox.reload();
    } catch (err) {
      // A 409 is the honest answer, not an apology: the flusher won the race
      // between the click and the request. Say so and refresh, so the row's
      // status shows what actually happened.
      const msg = (err as { message?: string })?.message;
      if ((err as { status?: number })?.status === 409) {
        setNote(msg || tr("Too late — that message has already left."));
        outbox.reload();
      } else {
        reportActionError(err);
      }
    } finally {
      setBusy(null);
    }
  }

  if (outbox.error) return <ErrorState message={outbox.error} />;
  const rows = outbox.data || [];
  const failed = rows.filter((r) => r.status === "FAILED").length;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="num text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? tr("message waiting") : tr("messages waiting")}
        </span>
        {/* Counted in the header as well as flagged per row: this is the number
            somebody needs to see without reading the list. */}
        {failed > 0 && (
          <Pill tone="bad">
            {`${failed} ${failed === 1 ? tr("did not send") : tr("did not send")}`}
          </Pill>
        )}
      </div>
      {note && (
        <p role="status" className="border-b border-border bg-muted px-3 py-2 text-xs">
          {note}
        </p>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {outbox.loading && !outbox.data && <LoadingRow label={tr("Loading the outbox…")} />}
        {!outbox.loading && rows.length === 0 && (
          <li className="p-4">
            <EmptyState
              title={tr("Nothing waiting")}
              hint={tr("Messages you schedule, and any the mail server has not accepted yet, wait here.")}
            />
          </li>
        )}
        {rows.map((e) => {
          const s = STATUS[e.status] || STATUS.QUEUED;
          return (
            <Row
              key={e.email_send_queue_id}
              title={e.payload?.subject || tr("(no subject)")}
              who={(e.payload?.to || []).join(", ") || "—"}
              when={
                e.status === "HELD"
                  ? `${tr("Goes out")} ${dateTimeFmt(e.release_at)}`
                  : `${tr("Queued")} ${fmtRelative(e.created_at)}`
              }
              tone={<Pill tone={s.tone}>{tr(s.label)}</Pill>}
              meta={
                <>
                  {s.why && <p className="mt-1 text-xs text-muted-foreground">{tr(s.why)}</p>}
                  {/* The server's own words. A failure paraphrased into
                      "something went wrong" is a failure nobody can fix — this
                      is where "550 sender not authorised" has to reach the
                      person who can change the From address. */}
                  {e.last_error && (
                    <p className="mt-1 text-xs text-[rgb(var(--danger))]">{e.last_error}</p>
                  )}
                  {e.attempts > 1 && (
                    <p className="num mt-0.5 text-xs text-muted-foreground">
                      {`${e.attempts} ${tr("attempts")}`}
                    </p>
                  )}
                </>
              }
              actions={
                // Only a HELD row can be cancelled — the server's UPDATE says
                // `WHERE status = 'HELD'`, and offering the button on a row it
                // will always refuse teaches people the button does not work.
                e.status === "HELD" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === e.email_send_queue_id}
                    onClick={() => cancel(e)}
                  >
                    {tr("Cancel")}
                  </Button>
                ) : null
              }
            />
          );
        })}
      </ul>
    </div>
  );
}
