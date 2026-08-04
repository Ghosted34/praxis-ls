/**
 * Mail — the provider-agnostic email engine surface (doc/EMAIL_ENGINE_PLAN.md).
 *   • Threads   — inbound/outbound messages per connected mailbox; open, read, reply.
 *   • Mailboxes — connect IMAP/SMTP or Microsoft 365 / Google via OAuth; test + sync.
 *   • Log       — the legacy per-purpose sender identities + outbound send log.
 * Kit-styled; accents resolve to --primary. Bodies are server-sanitized on ingest.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { Pill, type Tone } from "@/components/ui/pill";
import { HubTabs, HubCrumb } from "@/components/tabbed-hub";
import { useResource, errMsg } from "@/lib/use-resource";
import { getCommsSocket } from "@/lib/comms-socket";
import { dateFmt } from "@/lib/format";
import * as api from "@/lib/mail-api";
import { reportActionError } from "@/lib/action-error";

const sendTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "SENT" || u === "DELIVERED") return "ok";
  if (u === "QUEUED") return "blue";
  return "bad";
};
const connTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "CONNECTED") return "ok";
  if (u === "PENDING") return "warn";
  return "bad";
};
const providerLabel: Record<api.Provider, string> = {
  imap_smtp: "IMAP / SMTP",
  microsoft_graph: "Microsoft 365",
  google_gmail: "Google Workspace",
};

/* ── Threads ─────────────────────────────────────────────────────────────── */

function ThreadMessage({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const msg = useResource(() => api.getMessage(id), [id]);
  const atts = useResource(() => api.listMsgAttachments(id), [id]);
  const [reply, setReply] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const m = msg.data;

  React.useEffect(() => { if (m && !m.is_read) api.markThreadRead(id).then(onChanged).catch(() => {}); }, [m, id, onChanged]);

  async function sendReply() {
    if (!m?.email_connection_id) return;
    setBusy(true); setError(null);
    try {
      await api.replyMail(id, { connectionId: m.email_connection_id, text: reply });
      setSent(true); setReply(""); onChanged();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={m?.subject || "(no subject)"} description={m ? `${m.direction === "OUT" ? "To" : "From"} ${m.direction === "OUT" ? m.to_address : m.from_address}` : ""}>
      {msg.error && <ErrorState message={msg.error} />}
      {m && (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-y-1">
            <span className="text-muted-foreground">From</span><span className="num">{m.from_address}</span>
            <span className="text-muted-foreground">To</span><span className="num">{m.to_address || "—"}</span>
            <span className="text-muted-foreground">Received</span><span className="num">{dateFmt(m.received_at)}</span>
            <span className="text-muted-foreground">Linked to</span><span className="num">{m.entity_ref || "—"}</span>
          </div>

          {m.body_html
            ? <div className="prose prose-sm max-w-none rounded-lg border border-border bg-card/40 px-3 py-2" dangerouslySetInnerHTML={{ __html: m.body_html }} />
            : <div className="rounded-lg border border-border bg-card/40 px-3 py-2 whitespace-pre-wrap">{m.body_text || m.body_preview || "(no content)"}</div>}

          {(atts.data || []).length > 0 && (
            <div>
              <div className="micro mb-1">Attachments</div>
              <div className="flex flex-wrap gap-2">
                {(atts.data || []).map((a) => (
                  <Pill key={a.email_attachment_id} tone="mute">{a.filename || "file"}{a.size_bytes ? ` · ${Math.round((a.size_bytes || 0) / 1024)} KB` : ""}</Pill>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-border pt-3">
            {m.email_connection_id ? (
              <>
                <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Write a reply…"
                  />
                {error && <div className="mt-2"><ErrorState message={error} /></div>}
                <div className="mt-2 flex items-center justify-end gap-3">
                  {sent && <span className="micro text-[rgb(var(--ok))]">✓ Reply sent</span>}
                  <Button size="sm" onClick={sendReply} loading={busy} disabled={busy || !reply.trim()}>Send reply</Button>
                </div>
              </>
            ) : (
              <p className="micro">This is a legacy message with no linked mailbox — replies aren’t available.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function ThreadsSection() {
  const conns = useResource(() => api.listConnections(), []);
  const [connId, setConnId] = React.useState<string>("");
  const thread = useResource(() => api.listThread(connId || undefined), [connId]);
  const [viewId, setViewId] = React.useState<string | null>(null);
  const list = conns.data || [];

  // Live refresh: the server pushes `mail:new` to the tenant mail room when the
  // sync worker ingests inbound mail. Reload the thread on any signal.
  const reloadRef = React.useRef(thread.reload);
  reloadRef.current = thread.reload;
  React.useEffect(() => {
    const s = getCommsSocket();
    const onNew = () => reloadRef.current();
    s.on("mail:new", onNew);
    return () => { s.off("mail:new", onNew); };
  }, []);

  const cols: Column<api.ThreadMsg>[] = [
    { key: "dir", label: "", render: (m) => <Pill tone={m.direction === "OUT" ? "blue" : "mute"}>{m.direction === "OUT" ? "sent" : "in"}</Pill> },
    { key: "who", label: "Correspondent", render: (m) => <span className={`num ${m.is_read || m.direction === "OUT" ? "text-muted-foreground" : "font-medium text-foreground"}`}>{m.direction === "OUT" ? m.to_address : m.from_address}</span> },
    { key: "subject", label: "Subject", render: (m) => (m.is_read || m.direction === "OUT" ? m.subject || <span className="text-muted-foreground">(no subject)</span> : <span className="font-medium text-foreground">{m.subject || "(no subject)"}</span>) },
    { key: "linked", label: "Linked", render: (m) => (m.entity_ref ? <span className="num text-muted-foreground">{m.entity_ref}</span> : "—") },
    { key: "when", label: "When", render: (m) => dateFmt(m.received_at) },
  ];

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="chips">
          <button onClick={() => setConnId("")} className={`chip ${!connId ? "on" : ""}`}>All mailboxes</button>
          {list.filter((c) => c.status === "CONNECTED").map((c) => (
            <button key={c.email_connection_id} onClick={() => setConnId(c.email_connection_id)} className={`chip ${connId === c.email_connection_id ? "on" : ""}`}>{c.email_address}</button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => thread.reload()}>Refresh</Button>
      </div>
      <DataList columns={cols} rows={thread.data} error={thread.error} loading={thread.loading}
        rowKey={(m) => m.email_inbound_id} onRowClick={(m) => setViewId(m.email_inbound_id)}
        empty={{ title: "No messages yet", hint: "Connect a mailbox under Mailboxes, then messages sync in here." }} />
      {viewId && <ThreadMessage id={viewId} onClose={() => setViewId(null)} onChanged={() => thread.reload()} />}
    </>
  );
}

/* ── Mailboxes (connections) ─────────────────────────────────────────────── */

function ImapConnectForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = React.useState({ email_address: "", display_name: "", imap_host: "", imap_port: "993", smtp_host: "", smtp_port: "587", auth_user: "", password: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [discovering, setDiscovering] = React.useState(false);
  const [hint, setHint] = React.useState<string>("");
  const [result, setResult] = React.useState<api.TestResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function discover() {
    if (!f.email_address) return;
    setDiscovering(true); setHint(""); setError(null);
    try {
      const cfg = await api.autodiscover(f.email_address);
      setF((s) => ({
        ...s,
        imap_host: cfg.imap_host || s.imap_host, imap_port: cfg.imap_port ? String(cfg.imap_port) : s.imap_port,
        smtp_host: cfg.smtp_host || s.smtp_host, smtp_port: cfg.smtp_port ? String(cfg.smtp_port) : s.smtp_port,
      }));
      setHint(cfg.oauth_hint ? `Tip: ${cfg.oauth_hint === "google_gmail" ? "Google" : "Microsoft"} — consider OAuth above instead of a password.` : `Settings from ${cfg.source}. Verify, then connect.`);
    } catch (err) { setError(errMsg(err)); } finally { setDiscovering(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setResult(null);
    try {
      const r = await api.connectImap({
        email_address: f.email_address, display_name: f.display_name || undefined,
        imap_host: f.imap_host, imap_port: Number(f.imap_port) || undefined,
        smtp_host: f.smtp_host, smtp_port: Number(f.smtp_port) || undefined,
        auth_user: f.auth_user || undefined, password: f.password,
      });
      setResult(r.test || { ok: r.status === "CONNECTED" });
      onDone();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="font-display text-base">Connect an IMAP / SMTP mailbox</h3>
      <p className="micro mb-3">Any host (cPanel, private server, provider). Password is encrypted at rest.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email address" required><Input value={f.email_address} onChange={(e) => set("email_address", e.target.value)} placeholder="info@company.cm" /></Field>
        <Field label="Display name"><Input value={f.display_name} onChange={(e) => set("display_name", e.target.value)} placeholder="Company Info" /></Field>
        <Field label="IMAP host" required><Input value={f.imap_host} onChange={(e) => set("imap_host", e.target.value)} placeholder="mail.company.cm" /></Field>
        <Field label="IMAP port"><Input type="number" className="num" value={f.imap_port} onChange={(e) => set("imap_port", e.target.value)} /></Field>
        <Field label="SMTP host" required><Input value={f.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} placeholder="mail.company.cm" /></Field>
        <Field label="SMTP port"><Input type="number" className="num" value={f.smtp_port} onChange={(e) => set("smtp_port", e.target.value)} /></Field>
        <Field label="Login user" hint="Defaults to the email address."><Input value={f.auth_user} onChange={(e) => set("auth_user", e.target.value)} placeholder="optional" /></Field>
        <Field label="Password" required><Input type="password" value={f.password} onChange={(e) => set("password", e.target.value)} placeholder="••••••" /></Field>
      </div>
      {hint && <p className="mt-2 micro">{hint}</p>}
      {error && <div className="mt-2"><ErrorState message={error} /></div>}
      {result && <div className="mt-2 micro">{result.ok ? <span className="text-[rgb(var(--ok))]">✓ Connected</span> : <span className="text-[rgb(var(--bad))]">✗ {String(result.error || "Failed").slice(0, 90)}</span>}</div>}
      <div className="mt-3 flex items-center justify-between gap-3">
        <Button type="button" size="sm" variant="outline" onClick={discover} loading={discovering} disabled={discovering || !f.email_address}>Autodiscover</Button>
        <Button type="submit" size="sm" loading={busy} disabled={busy || !f.email_address || !f.imap_host || !f.smtp_host || !f.password}>Connect &amp; test</Button>
      </div>
    </form>
  );
}

function MailboxesSection() {
  const conns = useResource(() => api.listConnections(), []);
  const [busyId, setBusyId] = React.useState<string>("");
  const [note, setNote] = React.useState<string>("");

  async function oauth(kind: "ms" | "gg") {
    try { const r = kind === "ms" ? await api.startMicrosoft() : await api.startGoogle(); window.location.href = r.url; }
    catch (err) { setNote(errMsg(err)); }
  }
  async function test(id: string) { setBusyId(id); setNote(""); try { const r = await api.testConnection(id); setNote(r.ok ? "✓ Connection OK" : `✗ ${r.error || "failed"}`); conns.reload(); } catch (e) { reportActionError(e); } finally { setBusyId(""); } }
  async function sync(id: string) { setBusyId(id); setNote(""); try { const r = await api.syncConnection(id); setNote(r.error ? `✗ ${r.error}` : `✓ Synced — ${r.inserted ?? 0} new`); conns.reload(); } catch (e) { reportActionError(e); } finally { setBusyId(""); } }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => oauth("ms")}>Connect Microsoft 365</Button>
        <Button variant="outline" onClick={() => oauth("gg")}>Connect Google Workspace</Button>
        {note && <span className="micro">{note}</span>}
      </div>

      {conns.error && <ErrorState message={conns.error} />}
      <div className="grid gap-3">
        {(conns.data || []).map((c) => (
          <div key={c.email_connection_id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="num font-medium text-foreground">{c.email_address}</span>
                <Pill tone="mute">{providerLabel[c.provider]}</Pill>
                <Pill tone={connTone(c.status)}>{c.status}</Pill>
              </div>
              <p className="micro mt-0.5">Last sync {dateFmt(c.last_sync_at)}{c.last_error ? ` · ${c.last_error.slice(0, 60)}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => test(c.email_connection_id)} disabled={busyId === c.email_connection_id}>Test</Button>
              <Button size="sm" onClick={() => sync(c.email_connection_id)} loading={busyId === c.email_connection_id}>Sync now</Button>
            </div>
          </div>
        ))}
        {(conns.data || []).length === 0 && !conns.loading && <p className="micro">No mailboxes connected yet.</p>}
      </div>

      <ImapConnectForm onDone={conns.reload} />
    </div>
  );
}

/* ── Legacy sender log (Outbound / Inbound by purpose) ───────────────────── */

function LegacyLog() {
  const senders = useResource(() => api.listSenders(), []);
  const [identityId, setIdentityId] = React.useState<string>("");
  const [dir, setDir] = React.useState<"out" | "in">("out");
  const sent = useResource(() => api.listSent(identityId || undefined), [identityId]);
  const inbox = useResource(() => api.listInbox(identityId || undefined), [identityId]);
  const list = senders.data || [];

  const outCols: Column<api.SentMail>[] = [
    { key: "to", label: "To", render: (m) => <span className="num text-foreground">{m.to_address}</span> },
    { key: "subject", label: "Subject", render: (m) => m.subject || <span className="text-muted-foreground">(no subject)</span> },
    { key: "section", label: "Section", render: (m) => (m.purpose ? <Pill tone="mute">{m.purpose}</Pill> : "—") },
    { key: "status", label: "Status", render: (m) => <Pill tone={sendTone(m.status)}>{m.status}</Pill> },
    { key: "sent", label: "Sent", render: (m) => dateFmt(m.sent_at || m.queued_at) },
  ];
  const inCols: Column<api.InboundMail>[] = [
    { key: "from", label: "From", render: (m) => <span className="num">{m.from_address}</span> },
    { key: "subject", label: "Subject", render: (m) => m.subject || <span className="text-muted-foreground">(no subject)</span> },
    { key: "section", label: "Into", render: (m) => (m.purpose ? <Pill tone="mute">{m.purpose}</Pill> : "—") },
    { key: "received", label: "Received", render: (m) => dateFmt(m.received_at) },
  ];

  return (
    <>
      <div className="mb-3 inline-flex gap-1 rounded-xl border bg-muted p-1">
        {(["out", "in"] as const).map((d) => (
          <button key={d} onClick={() => setDir(d)} className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${dir === d ? "bg-primary font-semibold text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {d === "out" ? "Outbound" : "Inbound"}
          </button>
        ))}
      </div>
      <div className="chips mb-4">
        <button onClick={() => setIdentityId("")} className={`chip ${!identityId ? "on" : ""}`}>All sections</button>
        {list.map((s) => (
          <button key={s.email_identity_id} onClick={() => setIdentityId(s.email_identity_id)} className={`chip ${identityId === s.email_identity_id ? "on" : ""}`}>{s.purpose}</button>
        ))}
      </div>
      {dir === "out"
        ? <DataList columns={outCols} rows={sent.data} error={sent.error} loading={sent.loading} rowKey={(m) => m.email_send_id} empty={{ title: "No mail sent yet", hint: "Outgoing mail from each section appears here." }} />
        : <DataList columns={inCols} rows={inbox.data} error={inbox.error} loading={inbox.loading} rowKey={(m) => m.email_inbound_id} empty={{ title: "Inbox empty", hint: "Replies into these mailboxes appear here." }} />}
    </>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

type Mode = "threads" | "mailboxes" | "log";
const MODES: { key: Mode; label: string }[] = [
  { key: "threads", label: "Threads" },
  { key: "mailboxes", label: "Mailboxes" },
  { key: "log", label: "Send log" },
];

export function MailPage() {
  const [mode, setMode] = React.useState<Mode>("threads");
  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Comms" to="/comms" />} title="Mail" description="Connect any mailbox — Microsoft 365, Google, or IMAP/SMTP — and work every conversation in one place." />
      <HubTabs />

      <div className="mb-4 inline-flex gap-1 rounded-xl border bg-muted p-1">
        {MODES.map((m) => (
          <button key={m.key} onClick={() => setMode(m.key)} className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${mode === m.key ? "bg-primary font-semibold text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {m.label}
          </button>
        ))}
      </div>

      {mode === "threads" && <ThreadsSection />}
      {mode === "mailboxes" && <MailboxesSection />}
      {mode === "log" && <LegacyLog />}
    </section>
  );
}
