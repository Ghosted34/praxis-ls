/**
 * Team chat — the internal Smart Comms workstation, matching pixie's SmartComm
 * ChannelList/thread UI: hashed-colour avatars, search, filter tabs, rows with
 * pin/mute + accent-when-unread time + unread badge, and a message thread.
 * Conversation rides in the URL (?channel=…). On our Control-Tower skin.
 */
import * as React from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import { useAuth } from "@/app/auth/auth-context";
import { cn } from "@/lib/cn";
import * as api from "@/lib/smartcomm-api";
import { useCommsChannel } from "@/lib/comms-socket";

/* avatar colouring — a fixed per-person palette (pixie parity), not the brand accent */
const AVATAR_COLOURS = ["#C9A86C", "#7FB069", "#5B9BD5", "#C0626E", "#9B7EDE", "#4DB6AC", "#E2934D", "#D46BA3"];
function avatarColour(name?: string | null) {
  if (!name) return AVATAR_COLOURS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}
function initials(name?: string | null) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}
function timeShort(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtRelative(iso?: string | null) {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

type Filter = "all" | "unread" | "inhouse" | "groups" | "whatsapp" | "instagram" | "email";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "inhouse", label: "In-house" },
  { key: "groups", label: "Groups" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
  { key: "email", label: "Email" },
];
const EXTERNAL: Filter[] = ["whatsapp", "instagram", "email"];

function NewChatModal({ colleagues, onClose, onCreated }: { colleagues: api.Colleague[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [mode, setMode] = React.useState<"DIRECT" | "GROUP">("DIRECT");
  const [name, setName] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = mode === "DIRECT"
        ? { name: colleagues.find((c) => c.user_id === selected[0])?.full_name || "Direct message", kind: "DIRECT" as const, member_ids: selected.slice(0, 1) }
        : { name, kind: "DEPARTMENT" as const, member_ids: selected };
      const ch = await api.createChannel(body);
      onCreated(ch.group_id); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  const canSubmit = mode === "DIRECT" ? selected.length === 1 : !!name && selected.length > 0;
  return (
    <Modal open onClose={onClose} title="New conversation" description="Start a direct message or a group channel with colleagues.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Type">
          <Select value={mode} onChange={(e) => setMode(e.target.value as "DIRECT" | "GROUP")}>
            <option value="DIRECT">Direct message</option>
            <option value="GROUP">Group channel</option>
          </Select>
        </Field>
        {mode === "GROUP" && <Field label="Channel name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ops — Douala corridor" /></Field>}
        <Field label={mode === "DIRECT" ? "Colleague" : "Members"}>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {colleagues.map((c) => (
              <label key={c.user_id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                <input type={mode === "DIRECT" ? "radio" : "checkbox"} name="member" checked={selected.includes(c.user_id)} onChange={() => (mode === "DIRECT" ? setSelected([c.user_id]) : toggle(c.user_id))} />
                {c.full_name || c.email}
              </label>
            ))}
          </div>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!canSubmit || busy}>Start</Button>
        </div>
      </form>
    </Modal>
  );
}

function PinIcon() { return <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3z" /></svg>; }
function MuteIcon() { return <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path d="M3 3l18 18M18 8a6 6 0 00-9-5M6 8v4l-2 3h11" /></svg>; }

function ChannelRow({ c, active, onClick }: { c: api.Channel; active: boolean; onClick: () => void }) {
  const unread = c.unread || 0;
  return (
    <button type="button" onClick={onClick}
      className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors", active ? "bg-accent" : "hover:bg-accent/60")}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white" style={{ backgroundColor: avatarColour(c.name) }}>{initials(c.name)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-1">
          <span className={cn("flex items-center gap-1 truncate text-[12.5px]", unread > 0 ? "font-medium text-foreground" : "text-muted-foreground")}>
            <span className="truncate">{c.name}</span>
            {c.is_pinned && <span className="shrink-0 text-[rgb(var(--primary))]"><PinIcon /></span>}
            {c.is_muted && <span className="shrink-0 text-muted-foreground"><MuteIcon /></span>}
          </span>
          <span className={cn("shrink-0 text-[10px]", unread > 0 ? "font-semibold text-[rgb(var(--primary))]" : "text-muted-foreground")}>{fmtRelative(c.last_message?.created_at)}</span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-1">
          <span className={cn("truncate text-[11.5px]", unread > 0 ? "text-foreground" : "text-muted-foreground")}>{c.last_message?.body || "No messages yet"}</span>
          {unread > 0 && <span className={cn("grid h-4 min-w-[16px] shrink-0 place-items-center rounded-full px-1 text-[9px] font-bold", c.is_muted ? "bg-[rgb(var(--ink-3)/0.4)] text-primary-foreground" : "bg-primary text-primary-foreground")}>{unread}</span>}
        </span>
      </span>
    </button>
  );
}

function InfoPane({ channel }: { channel: api.Channel | null }) {
  if (!channel) return <div className="flex flex-1 items-center justify-center p-6 text-center micro">Details appear here.</div>;
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex flex-col items-center gap-2 border-b border-border pb-4 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full text-lg font-semibold text-white" style={{ backgroundColor: avatarColour(channel.name) }}>{initials(channel.name)}</span>
        <div className="text-sm font-semibold">{channel.name}</div>
        {channel.kind && <span className="micro">{channel.kind.toLowerCase()}</span>}
      </div>
      <div className="space-y-3 pt-4 text-sm">
        <div>
          <div className="micro mb-1 uppercase tracking-wide">About</div>
          <p className="text-muted-foreground">{channel.kind === "DIRECT" ? "Direct message." : "Group conversation — auditable and exportable."}</p>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Members</span>
          <span className="num">{channel.member_count ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Opened</span>
          <span className="num">{channel.created_at ? new Date(channel.created_at).toLocaleDateString() : "—"}</span>
        </div>
      </div>
    </div>
  );
}

export function TeamChatPage() {
  const { user } = useAuth();
  const meId = (user as { user_id?: string; id?: string } | null)?.user_id || (user as { id?: string } | null)?.id || "";
  const [params, setParams] = useSearchParams();
  const activeId = params.get("channel");
  const channels = useResource(() => api.listChannels(), []);
  const colleagues = useResource(() => api.listColleagues(), []);
  const [newChat, setNewChat] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const navigate = useNavigate();

  const nameOf = React.useMemo(() => {
    const m: Record<string, string> = {};
    (colleagues.data || []).forEach((c) => { m[c.user_id] = c.full_name || c.email; });
    return m;
  }, [colleagues.data]);

  const all = channels.data || [];
  const unreadTotal = all.reduce((s, c) => s + (c.unread || 0), 0);
  const filtered = all.filter((c) => {
    if (filter === "unread" && !c.unread) return false;
    if (filter === "inhouse" && c.kind !== "DIRECT") return false;
    if (filter === "groups" && c.kind === "DIRECT") return false;
    if (EXTERNAL.includes(filter)) return false;
    if (q.trim()) {
      const hay = `${c.name} ${c.last_message?.body || ""}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const select = (id: string) => { const n = new URLSearchParams(params); n.set("channel", id); setParams(n); };

  return (
    <section className="animate-fade-in">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Messaging</h1>
          <p className="micro">Unified inbox</p>
        </div>
        <button onClick={() => navigate("/comms/setup")} className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:text-foreground" aria-label="Setup & channels" title="Setup & channels">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="3" /><path d="M19.4 13a7.9 7.9 0 000-2l2-1.5-2-3.5-2.4 1a8 8 0 00-1.7-1L14 3h-4l-.6 2.5a8 8 0 00-1.7 1l-2.4-1-2 3.5 2 1.5a7.9 7.9 0 000 2l-2 1.5 2 3.5 2.4-1a8 8 0 001.7 1L10 21h4l.6-2.5a8 8 0 001.7-1l2.4 1 2-3.5z" /></svg>
        </button>
      </div>

      <div className="grid h-[calc(100vh-11rem)] grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:grid-cols-[320px_1fr] lg:grid-cols-[320px_1fr_300px]">
        {/* conversation list */}
        <div className={cn("flex flex-col border-border md:border-r", activeId ? "hidden md:flex" : "flex")}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-[15px] font-medium">Inbox</h2>
              {unreadTotal > 0 && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{unreadTotal > 99 ? "99+" : unreadTotal}</span>}
            </div>
            <button onClick={() => setNewChat(true)} className="text-muted-foreground hover:text-foreground" title="New conversation" aria-label="New conversation">
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <div className="px-3 py-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations…" />
          </div>
          <div className="flex gap-1 overflow-x-auto px-3 pb-2">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={cn("shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors", filter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {channels.loading ? (
              <div className="space-y-1 p-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl border border-border bg-accent/40" />)}</div>
            ) : channels.error ? <div className="p-4"><ErrorState message={errMsg(channels.error)} /></div> : filtered.length ? (
              <div className="space-y-px">{filtered.map((c) => <ChannelRow key={c.group_id} c={c} active={activeId === c.group_id} onClick={() => select(c.group_id)} />)}</div>
            ) : <div className="px-4 py-12 text-center micro">{q || filter !== "all" ? "No conversations match." : "No conversations yet"}</div>}
          </div>
        </div>

        {/* thread */}
        <div className={cn("flex min-w-0 flex-col", activeId ? "flex" : "hidden md:flex")}>
          {activeId ? (
            <Thread key={activeId} channelId={activeId} meId={meId} nameOf={nameOf} onBack={() => { const n = new URLSearchParams(params); n.delete("channel"); setParams(n); }} onSent={() => channels.reload()} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center micro">Pick a conversation to start.</div>
          )}
        </div>

        {/* customer / channel 360 — third pane on wide screens */}
        <div className="hidden flex-col border-l border-border lg:flex">
          <InfoPane channel={all.find((c) => c.group_id === activeId) || null} />
        </div>
      </div>

      {newChat && <NewChatModal colleagues={colleagues.data || []} onClose={() => setNewChat(false)} onCreated={(id) => { channels.reload(); select(id); }} />}
    </section>
  );
}

function Thread({ channelId, meId, nameOf, onBack, onSent }: { channelId: string; meId: string; nameOf: Record<string, string>; onBack: () => void; onSent: () => void }) {
  const ch = useResource(() => api.getChannel(channelId), [channelId]);
  const thread = useResource(() => api.getThread(channelId), [channelId]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const msgs = thread.data?.messages || [];

  // Live updates (socket.io). Any channel event refreshes the thread; a peer's
  // typing shows a transient indicator. The 8s poll below stays as a fallback
  // for when the socket can't connect.
  const [typingName, setTypingName] = React.useState<string | null>(null);
  const typingTimer = React.useRef<number | null>(null);
  const { setTyping } = useCommsChannel(channelId, {
    "comms:message": () => { thread.reload(); onSent(); },
    "comms:message_edited": () => thread.reload(),
    "comms:message_deleted": () => thread.reload(),
    "comms:reaction": () => thread.reload(),
    "channel:typing": (p: { user_id?: string }) => {
      if (!p?.user_id || p.user_id === meId) return;
      setTypingName(nameOf[p.user_id] || "Someone");
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => setTypingName(null), 3000);
    },
  });

  React.useEffect(() => { api.markRead(channelId).catch(() => {}); }, [channelId, msgs.length]);
  React.useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);
  React.useEffect(() => { const t = window.setInterval(() => thread.reload(), 8000); return () => window.clearInterval(t); }, [thread]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const b = text.trim();
    if (!b || busy) return;
    setText(""); setBusy(true);
    try { await api.postMessage(channelId, b); thread.reload(); onSent(); } catch { setText(b); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <button className="text-muted-foreground hover:text-foreground md:hidden" onClick={onBack} aria-label="Back">←</button>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: avatarColour(ch.data?.name) }}>{initials(ch.data?.name || "?")}</span>
        <span className="text-sm font-semibold">{ch.data?.name || "Conversation"}</span>
        {ch.data?.kind && <span className="micro">· {ch.data.kind.toLowerCase()}</span>}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto bg-[rgb(var(--ink-3)/0.04)] px-4 py-3">
        {thread.loading && msgs.length === 0 ? <div className="micro">Loading…</div> : thread.error ? <ErrorState message={errMsg(thread.error)} /> : msgs.length ? msgs.map((m) => {
          const mine = !!meId && m.sender_user_id === meId;
          return (
            <div key={m.message_id} className={mine ? "flex justify-end" : "flex justify-start"}>
              <div className={cn("max-w-[78%] rounded-2xl px-3 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "border border-border bg-card")}>
                {!mine && m.sender_user_id && <div className="mb-0.5 text-[11px] font-medium text-[rgb(var(--primary))]">{nameOf[m.sender_user_id] || "Someone"}</div>}
                <div className="whitespace-pre-wrap">{m.body || (m.media_vault_id ? "(attachment)" : "")}</div>
                <div className={cn("mt-0.5 text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>{timeShort(m.created_at)}</div>
              </div>
            </div>
          );
        }) : <div className="flex h-full items-center justify-center micro">No messages yet — say hello.</div>}
        <div ref={bottomRef} />
      </div>
      {typingName && <div className="px-4 pb-1 text-[11px] italic text-muted-foreground">{typingName} is typing…</div>}
      <form className="flex items-center gap-2 border-t border-border px-3 py-2" onSubmit={send}>
        <Input value={text} onChange={(e) => { setText(e.target.value); setTyping(); }} placeholder="Write a message…" className="flex-1" />
        <Button type="submit" loading={busy} disabled={!text.trim()}>Send</Button>
      </form>
    </>
  );
}
