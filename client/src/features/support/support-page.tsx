/**
 * Support & Feedback (tenant side, PRD §11.2) — the tenant→Praxis channel.
 * Users raise support/bug/feature (and more) tickets with screenshots, watch
 * their lifecycle (NEW → TRIAGED → IN_PROGRESS → SHIPPED/DECLINED), and now
 * carry the THREAD with Praxis: replies land here and in the notification
 * bell, and the console side is the mirror. CSAT once a ticket is resolved.
 * Backed by the ungated tenant API `/support/tickets` (central platform ticket
 * store, scoped to this tenant).
 *
 * THE PAGE IS A CALLER, NOT THE OWNER, of the raise form — GlobalRaiseTicket
 * mounts it once at the shell so the icon rail can open it from any screen.
 * `?ticket=<id>` (from a notification's deep link) opens that ticket's thread
 * and is then stripped, the same shape the mail inbox uses for `?thread=`.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill } from "@/components/ui/pill";
import { RowActions } from "@/components/ui/row-actions";
import { useList, errMsg } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import {
  postCsat,
  KIND_LABEL,
  KIND_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  isResolved,
  type Ticket,
} from "./support-api";
import { TicketThreadModal } from "./ticket-thread";
import { openRaiseTicket, SUPPORT_CHANGED_EVENT } from "./raise-ticket-bus";

function CsatModal({
  ticket,
  onClose,
  onRated,
}: {
  ticket: Ticket;
  onClose: () => void;
  onRated: () => void;
}) {
  const [score, setScore] = React.useState<number>(5);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postCsat(ticket.ticket_id, score);
      onRated();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Rate this resolution"
      description={ticket.title}
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="How satisfied are you?" required>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                className={`h-10 w-10 rounded-md border text-lg transition ${n <= score ? "border-primary bg-primary/10 text-primary-ink" : "border-input text-muted-foreground"}`}
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
              >
                ★
              </button>
            ))}
          </div>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Submit rating
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function SupportPage() {
  const { rows, error, loading, reload } = useList<Ticket>("/support/tickets");
  const [rating, setRating] = React.useState<Ticket | null>(null);
  const [thread, setThread] = React.useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const list = rows || [];

  const open = list.filter((t) => !isResolved(t.status)).length;
  const resolved = list.filter((t) => isResolved(t.status)).length;

  // A notification's deep link: /support?ticket=<id>. Consume it once, then
  // strip it so a refresh does not re-open the thread (the mail inbox does
  // exactly this for ?thread=).
  React.useEffect(() => {
    const id = searchParams.get("ticket");
    if (!id) return;
    setThread(id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("ticket");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // The raise modal and the thread live outside this page now — when either
  // creates or changes anything, the list re-reads from wherever it happened.
  React.useEffect(() => {
    const h = () => reload();
    window.addEventListener(SUPPORT_CHANGED_EVENT, h);
    return () => window.removeEventListener(SUPPORT_CHANGED_EVENT, h);
  }, [reload]);

  const columns: Column<Ticket>[] = [
    {
      key: "title",
      label: "Ticket",
      render: (r) => (
        <button
          type="button"
          onClick={() => setThread(r.ticket_id)}
          className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <div className="font-medium text-foreground hover:underline">
            {r.title}
          </div>
          {r.body ? (
            <div className="micro line-clamp-1 max-w-md text-muted-foreground">
              {r.body}
            </div>
          ) : null}
        </button>
      ),
    },
    {
      key: "kind",
      label: "Type",
      render: (r) => (
        <Pill tone={KIND_TONE[r.kind] || "mute"}>
          {KIND_LABEL[r.kind] || r.kind}
        </Pill>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <Pill tone={STATUS_TONE[r.status] || "mute"}>
          {STATUS_LABEL[r.status] || r.status}
        </Pill>
      ),
    },
    {
      key: "created_at",
      label: "Raised",
      render: (r) => dateFmt(r.created_at),
    },
    {
      key: "csat",
      label: "Rating",
      render: (r) => {
        if (r.csat)
          return (
            <span className="num text-primary-ink">
              {"★".repeat(r.csat)}
              <span className="text-muted-foreground">
                {"★".repeat(5 - r.csat)}
              </span>
            </span>
          );
        if (isResolved(r.status))
          return (
            <RowActions>
              <Button size="sm" variant="outline" onClick={() => setRating(r)}>
                Rate
              </Button>
            </RowActions>
          );
        return <span className="text-muted-foreground">—</span>;
      },
    },
  ];

  return (
    <section className={pageShell.wide}>
      <PageHeader
        title="Support & feedback"
        description="Reach the Praxis team directly. Raise a ticket with a screenshot, and carry the conversation to the end."
        action={
          <Button onClick={() => openRaiseTicket()}>Raise a ticket</Button>
        }
      />
      <KpiRow>
        <KpiTile label="Total tickets" value={num(list.length)} />
        <KpiTile label={tr("Open")} value={num(open)} />
        <KpiTile label="Resolved" value={num(resolved)} />
      </KpiRow>
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.ticket_id}
        onRowClick={(r) => setThread(r.ticket_id)}
        empty={{
          title: "No tickets yet",
          hint: "Raise a ticket to reach the Praxis team — support, a bug, a feature request, or anything in between.",
        }}
      />
      {thread && (
        <TicketThreadModal
          ticketId={thread}
          onClose={() => setThread(null)}
          onChanged={reload}
        />
      )}
      {rating && (
        <CsatModal
          ticket={rating}
          onClose={() => setRating(null)}
          onRated={reload}
        />
      )}
    </section>
  );
}
