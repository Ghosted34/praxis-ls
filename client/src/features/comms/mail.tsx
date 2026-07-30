/**
 * Mail — per-section senders with an Outbound send log and an Inbound inbox.
 * Each section (Billing / Documents / Notifications / Support) mails from its own
 * verified identity; filter by section, switch direction, and inspect a message.
 * Kit-styled; accents resolve to --primary.
 */
import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { Pill, type Tone } from "@/components/ui/pill";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import * as api from "@/lib/mail-api";

const statusTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "SENT" || u === "DELIVERED") return "ok";
  if (u === "QUEUED") return "blue";
  return "bad";
};

function OutMessage({ m, onClose }: { m: api.SentMail; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="lg" title={m.subject || "(no subject)"} description={`To ${m.to_address}`}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-y-1">
          <span className="text-muted-foreground">From</span><span>{m.from_name ? `${m.from_name} · ` : ""}{m.from_address || "—"}</span>
          <span className="text-muted-foreground">Section</span><span>{m.purpose || "—"}</span>
          <span className="text-muted-foreground">Source doc</span><span className="num">{m.entity_ref || "—"}</span>
          <span className="text-muted-foreground">Status</span><span><Pill tone={statusTone(m.status)}>{m.status}</Pill></span>
          <span className="text-muted-foreground">Queued</span><span className="num">{dateFmt(m.queued_at)}</span>
          <span className="text-muted-foreground">Sent</span><span className="num">{dateFmt(m.sent_at)}</span>
        </div>
        {m.error && <div className="rounded-lg border border-[rgb(var(--bad))]/40 bg-[rgb(var(--bad)/0.08)] px-3 py-2 text-sm">{m.error}</div>}
      </div>
    </Modal>
  );
}

function InMessage({ m, onClose }: { m: api.InboundMail; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="lg" title={m.subject || "(no subject)"} description={`From ${m.from_address}`}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-y-1">
          <span className="text-muted-foreground">Into</span><span>{m.purpose || "—"} · {m.to_address || "—"}</span>
          <span className="text-muted-foreground">Received</span><span className="num">{dateFmt(m.received_at)}</span>
          <span className="text-muted-foreground">Ref</span><span className="num">{m.entity_ref || "—"}</span>
        </div>
        {m.body_preview && <div className="rounded-lg border border-border bg-card/40 px-3 py-2 whitespace-pre-wrap">{m.body_preview}</div>}
      </div>
    </Modal>
  );
}

type Dir = "out" | "in";

export function MailPage() {
  const senders = useResource(() => api.listSenders(), []);
  const [identityId, setIdentityId] = React.useState<string>("");
  const [dir, setDir] = React.useState<Dir>("out");
  const sent = useResource(() => api.listSent(identityId || undefined), [identityId]);
  const inbox = useResource(() => api.listInbox(identityId || undefined), [identityId]);
  const [viewOut, setViewOut] = React.useState<api.SentMail | null>(null);
  const [viewIn, setViewIn] = React.useState<api.InboundMail | null>(null);
  const list = senders.data || [];

  const outCols: Column<api.SentMail>[] = [
    { key: "to", label: "To", render: (m) => <span className="num text-foreground">{m.to_address}</span> },
    { key: "subject", label: "Subject", render: (m) => m.subject || <span className="text-muted-foreground">(no subject)</span> },
    { key: "section", label: "Section", render: (m) => (m.purpose ? <Pill tone="mute">{m.purpose}</Pill> : "—") },
    { key: "entity", label: "Source doc", render: (m) => (m.entity_ref ? <span className="num text-muted-foreground">{m.entity_ref}</span> : "—") },
    { key: "status", label: "Status", render: (m) => <Pill tone={statusTone(m.status)}>{m.status}</Pill> },
    { key: "sent", label: "Sent", render: (m) => dateFmt(m.sent_at || m.queued_at) },
  ];
  const inCols: Column<api.InboundMail>[] = [
    { key: "from", label: "From", render: (m) => <span className={`num ${m.is_read ? "text-muted-foreground" : "font-medium text-foreground"}`}>{m.from_address}</span> },
    { key: "subject", label: "Subject", render: (m) => (m.is_read ? m.subject : <span className="font-medium text-foreground">{m.subject || "(no subject)"}</span>) },
    { key: "section", label: "Into", render: (m) => (m.purpose ? <Pill tone="mute">{m.purpose}</Pill> : "—") },
    { key: "received", label: "Received", render: (m) => dateFmt(m.received_at) },
    { key: "state", label: "", render: (m) => (!m.is_read ? <Pill tone="warn">new</Pill> : null) },
  ];

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <PageHeader eyebrow={<HubCrumb area="Comms" to="/comms" />} title="Mail" description="Every section sends from its own verified address — outbound log and inbound replies." />
      <HubTabs />

      {/* direction toggle */}
      <div className="mb-3 inline-flex gap-1 rounded-xl border bg-muted p-1">
        {(["out", "in"] as Dir[]).map((d) => (
          <button key={d} onClick={() => setDir(d)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${dir === d ? "bg-primary font-semibold text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {d === "out" ? "Outbound" : "Inbound"}
          </button>
        ))}
      </div>

      {/* section chips */}
      <div className="chips mb-4">
        <button onClick={() => setIdentityId("")} className={`chip ${!identityId ? "on" : ""}`}>
          All sections
        </button>
        {list.map((s) => (
          <button key={s.email_identity_id} onClick={() => setIdentityId(s.email_identity_id)} className={`chip ${identityId === s.email_identity_id ? "on" : ""}`}>
            {s.purpose}{!s.is_active && <span className="opacity-70">· off</span>}
          </button>
        ))}
      </div>
      {senders.error && <ErrorState message={errMsg(senders.error)} />}
      {identityId && (() => {
        const s = list.find((x) => x.email_identity_id === identityId);
        return s ? <p className="mb-3 micro">Mailbox <span className="num text-foreground">{s.from_name} &lt;{s.from_address}&gt;</span></p> : null;
      })()}

      {dir === "out" ? (
        <DataList columns={outCols} rows={sent.data} error={sent.error ? errMsg(sent.error) : null} loading={sent.loading} rowKey={(m) => m.email_send_id} onRowClick={(m) => setViewOut(m)} empty={{ title: "No mail sent yet", hint: "Outgoing mail from each section appears here." }} />
      ) : (
        <DataList columns={inCols} rows={inbox.data} error={inbox.error ? errMsg(inbox.error) : null} loading={inbox.loading} rowKey={(m) => m.email_inbound_id} onRowClick={(m) => setViewIn(m)} empty={{ title: "Inbox empty", hint: "Replies received into these mailboxes appear here." }} />
      )}

      {viewOut && <OutMessage m={viewOut} onClose={() => setViewOut(null)} />}
      {viewIn && <InMessage m={viewIn} onClose={() => setViewIn(null)} />}
    </section>
  );
}
