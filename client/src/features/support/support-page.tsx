/**
 * Support & Feedback (tenant side, PRD §11.2) — the tenant→Praxis channel. Users
 * raise support / bug / feature tickets and watch their lifecycle
 * (NEW → TRIAGED → IN_PROGRESS → SHIPPED/DECLINED); Praxis triages them on the
 * Platform Console. CSAT can be given once a ticket is resolved. Backed by the
 * ungated tenant API `/support/tickets` (writes the central platform ticket
 * store, scoped to this tenant).
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { num, dateFmt } from "@/lib/format";
import { tenant } from "@/lib/api-client";

type Kind = "SUPPORT" | "BUG" | "FEATURE";
type Status = "NEW" | "TRIAGED" | "IN_PROGRESS" | "SHIPPED" | "DECLINED";

type Ticket = {
  ticket_id: string;
  kind: Kind;
  title: string;
  body?: string | null;
  status: Status;
  csat?: number | null;
  created_at?: string | null;
};

const KIND_LABEL: Record<Kind, string> = { SUPPORT: "Support", BUG: "Bug", FEATURE: "Feature" };
const KIND_TONE: Record<Kind, Tone> = { SUPPORT: "blue", BUG: "bad", FEATURE: "orange" };
const STATUS_LABEL: Record<Status, string> = {
  NEW: "New", TRIAGED: "Triaged", IN_PROGRESS: "In progress", SHIPPED: "Shipped", DECLINED: "Declined",
};
const STATUS_TONE: Record<Status, Tone> = {
  NEW: "warn", TRIAGED: "blue", IN_PROGRESS: "blue", SHIPPED: "ok", DECLINED: "bad",
};
const isResolved = (s: Status) => s === "SHIPPED" || s === "DECLINED";

function NewTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [kind, setKind] = React.useState<Kind>("SUPPORT");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant("/support/tickets", { method: "POST", body: { kind, title: title.trim(), body: body.trim() } });
      onCreated();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Raise a ticket" description="Reach the Praxis team directly — ask for help, report a bug, or request a feature.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Type" required>
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="SUPPORT">Support — I need help</option>
            <option value="BUG">Bug — something’s broken</option>
            <option value="FEATURE">Feature — I’d like an improvement</option>
          </Select>
        </Field>
        <Field label="Summary" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="One line describing it" autoFocus maxLength={200} />
        </Field>
        <Field label="Details" hint="What happened, what you expected, where in the app (optional).">
          <textarea
            className="flex min-h-[110px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add any detail that would help us…"
            maxLength={5000}
          />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={title.trim().length < 3 || busy}>Send to Praxis</Button>
        </div>
      </form>
    </Modal>
  );
}

function CsatModal({ ticket, onClose, onRated }: { ticket: Ticket; onClose: () => void; onRated: () => void }) {
  const [score, setScore] = React.useState<number>(5);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await tenant(`/support/tickets/${ticket.ticket_id}/csat`, { method: "POST", body: { csat: score } });
      onRated();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Rate this resolution" description={ticket.title}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="How satisfied are you?" required>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                className={`h-10 w-10 rounded-md border text-lg transition ${n <= score ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground"}`}
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
              >
                ★
              </button>
            ))}
          </div>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>Submit rating</Button>
        </div>
      </form>
    </Modal>
  );
}

export function SupportPage() {
  const { rows, error, loading, reload } = useList<Ticket>("/support/tickets");
  const [creating, setCreating] = React.useState(false);
  const [rating, setRating] = React.useState<Ticket | null>(null);
  const list = rows || [];

  const open = list.filter((t) => !isResolved(t.status)).length;
  const resolved = list.filter((t) => isResolved(t.status)).length;

  const columns: Column<Ticket>[] = [
    {
      key: "title", label: "Ticket", render: (r) => (
        <div>
          <div className="font-medium text-foreground">{r.title}</div>
          {r.body ? <div className="micro line-clamp-1 max-w-md text-muted-foreground">{r.body}</div> : null}
        </div>
      ),
    },
    { key: "kind", label: "Type", render: (r) => <Pill tone={KIND_TONE[r.kind] || "mute"}>{KIND_LABEL[r.kind] || r.kind}</Pill> },
    { key: "status", label: "Status", render: (r) => <Pill tone={STATUS_TONE[r.status] || "mute"}>{STATUS_LABEL[r.status] || r.status}</Pill> },
    { key: "created_at", label: "Raised", render: (r) => dateFmt(r.created_at) },
    {
      key: "csat", label: "Rating", render: (r) => {
        if (r.csat) return <span className="num text-primary">{"★".repeat(r.csat)}<span className="text-muted-foreground">{"★".repeat(5 - r.csat)}</span></span>;
        if (isResolved(r.status)) return (
          <div onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="outline" onClick={() => setRating(r)}>Rate</Button>
          </div>
        );
        return <span className="text-muted-foreground">—</span>;
      },
    },
  ];

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <PageHeader
        title="Support & feedback"
        description="Reach the Praxis team directly. Raise a ticket and track it from New through to Shipped."
        action={<Button onClick={() => setCreating(true)}>Raise a ticket</Button>}
      />
      <KpiRow>
        <KpiTile label="Total tickets" value={num(list.length)} />
        <KpiTile label="Open" value={num(open)} />
        <KpiTile label="Resolved" value={num(resolved)} />
      </KpiRow>
      <DataList
        columns={columns}
        rows={rows}
        error={error}
        loading={loading}
        rowKey={(r) => r.ticket_id}
        empty={{ title: "No tickets yet", hint: "Raise a ticket to reach the Praxis team — support, a bug, or a feature request." }}
      />
      {creating && <NewTicketModal onClose={() => setCreating(false)} onCreated={reload} />}
      {rating && <CsatModal ticket={rating} onClose={() => setRating(null)} onRated={reload} />}
    </section>
  );
}
