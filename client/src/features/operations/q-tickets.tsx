/**
 * Q tickets — client queries raised against a milestone, answered in-system.
 *
 * THE POINT, from the kickoff (§11.7): a client watching their chain sees
 * something wrong and raises the query HERE rather than sending an email. An
 * email lives in one person's inbox, is invisible to everyone else on the file,
 * and disappears when they go on leave. A ticket is attached to the milestone it
 * is about, so the next person to open the file sees the question and the answer
 * beside the stage they concern.
 *
 * INTERNAL NOTES ARE IN THE SAME THREAD, marked. The alternative — somewhere
 * else to write "broker says red channel, don't tell the client yet" — is how
 * half a conversation goes missing. The portal filters them out server-side; the
 * client never receives them.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { errMsg, useResource } from "@/lib/use-resource";
import { dateTimeFmt } from "@/lib/format";
import { tenant } from "@/lib/api-client";

export type QTicket = {
  q_ticket_id: string;
  dossier_id: string;
  dossier_ref?: string | null;
  milestone_label?: string | null;
  milestone_code?: string | null;
  subject: string;
  body?: string | null;
  status: string;
  raised_by?: string | null;
  created_at: string;
};
type QReply = {
  q_ticket_reply_id: string;
  body: string;
  is_from_client: boolean;
  is_internal: boolean;
  author_label?: string | null;
  created_at: string;
};

const listTickets = (dossierId?: string) =>
  tenant<QTicket[]>(`/q-tickets${dossierId ? `?dossier_id=${dossierId}` : ""}`);
const getTicket = (id: string) => tenant<{ ticket: QTicket; replies: QReply[] }>(`/q-tickets/${id}`);
const postReply = (id: string, body: string, internal: boolean) =>
  tenant(`/q-tickets/${id}/replies`, { method: "POST", body: { body, internal } });
const resolveTicket = (id: string) => tenant(`/q-tickets/${id}/resolve`, { method: "POST", body: {} });

const TONE: Record<string, "ok" | "warn" | "blue" | "mute"> = {
  OPEN: "warn",
  IN_PROGRESS: "blue",
  RESOLVED: "ok",
};
const LABEL: Record<string, string> = {
  OPEN: "Waiting on us",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
};

function TicketThread({ ticketId, onChanged, onClose }: { ticketId: string; onChanged: () => void; onClose: () => void }) {
  const data = useResource(() => getTicket(ticketId), [ticketId]);
  const [body, setBody] = React.useState("");
  const [internal, setInternal] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await postReply(ticketId, body.trim(), internal);
      setBody("");
      data.reload();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    setError(null);
    try {
      await resolveTicket(ticketId);
      data.reload();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const t = data.data?.ticket;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t?.subject || "Query"}
      description={
        t
          ? `${t.dossier_ref || "File"}${t.milestone_label ? ` · ${t.milestone_label}` : ""} · raised ${dateTimeFmt(t.created_at)}${t.raised_by ? ` by ${t.raised_by}` : ""}`
          : undefined
      }
      headerRight={t ? <Pill tone={TONE[t.status] || "mute"}>{LABEL[t.status] || t.status}</Pill> : null}
      footer={
        <>
          {t && t.status !== "RESOLVED" && (
            <Button variant="outline" onClick={close} loading={busy}>Mark resolved</Button>
          )}
          <Button onClick={send} loading={busy} disabled={busy || !body.trim()}>Reply</Button>
        </>
      }
    >
      {data.error ? (
        <ErrorState message={data.error} />
      ) : !data.data ? (
        <SkeletonTable rows={3} cols={1} />
      ) : (
        <div className="space-y-3">
          {t?.body && (
            <div className="rounded-lg border border-border p-3">
              <p className="micro mb-1">Client</p>
              <p className="text-sm text-foreground">{t.body}</p>
            </div>
          )}
          {data.data.replies.map((r) => (
            <div
              key={r.q_ticket_reply_id}
              className={`rounded-lg border p-3 ${r.is_internal ? "border-dashed border-border" : "border-border"}`}
            >
              <p className="micro mb-1 flex items-center gap-2">
                {r.is_from_client ? "Client" : r.author_label || "Our team"}
                {r.is_internal && <Pill tone="mute">internal — not shown to the client</Pill>}
                <span className="ml-auto">{dateTimeFmt(r.created_at)}</span>
              </p>
              <p className="text-sm text-foreground">{r.body}</p>
            </div>
          ))}

          <Field label="Reply">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Chasing the inspector now — expect release tomorrow." />
          </Field>
          <Checkbox
            checked={internal}
            onCheckedChange={setInternal}
            label="Internal note — keep this off the client's portal"
          />
          {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

/** Raise a ticket from our side — a query that arrives by phone still belongs on the file. */
function RaiseDialog({ dossierId, onClose, onDone }: { dossierId: string; onClose: () => void; onDone: () => void }) {
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/q-tickets", { method: "POST", body: { dossier_id: dossierId, subject: subject.trim(), body: body.trim() || undefined } });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Log a client query"
      description="For a question that arrived by phone or email — it belongs on the file, where the next person to open it will see it."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={busy || !subject.trim()}>Log query</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Subject" required>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Why is customs still pending?" />
        </Field>
        <Field label="Detail">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
        </Field>
        {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
      </div>
    </Modal>
  );
}

export function QTickets({ dossierId }: { dossierId?: string }) {
  const list = useResource(() => listTickets(dossierId), [dossierId]);
  const [open, setOpen] = React.useState<string | null>(null);
  const [raising, setRaising] = React.useState(false);

  if (list.loading) return <SkeletonTable rows={3} cols={3} />;
  if (list.error) return <ErrorState message={list.error} />;

  const rows = list.data || [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro">
          Client queries raised against a milestone. Answering here keeps the question, the answer and
          the file in one place.
        </p>
        {dossierId && (
          <Button size="sm" variant="outline" onClick={() => setRaising(true)}>Log a query</Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No open queries" hint="Queries a client raises from the portal land here." />
      ) : (
        <ul className="space-y-1.5">
          {rows.map((t) => (
            <li key={t.q_ticket_id}>
              <button
                type="button"
                onClick={() => setOpen(t.q_ticket_id)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left hover:opacity-80"
              >
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{t.subject}</p>
                  <p className="micro">
                    {t.dossier_ref || "—"}
                    {t.milestone_label ? ` · ${t.milestone_label}` : ""}
                    {t.raised_by ? ` · ${t.raised_by}` : ""}
                  </p>
                </div>
                <Pill tone={TONE[t.status] || "mute"}>{LABEL[t.status] || t.status}</Pill>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && <TicketThread ticketId={open} onChanged={list.reload} onClose={() => setOpen(null)} />}
      {raising && dossierId && (
        <RaiseDialog dossierId={dossierId} onClose={() => setRaising(false)} onDone={list.reload} />
      )}
    </div>
  );
}
