/**
 * Team chat — the internal Smart Comms workstation, matching pixie's SmartComm
 * ChannelList/thread UI: hashed-colour avatars, search, filter tabs, rows with
 * pin/mute + accent-when-unread time + unread badge, and a message thread.
 * Conversation rides in the URL (?channel=…). On our Control-Tower skin.
 */
import * as React from "react";
import { dateDmy } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { Link, useSearchParams } from "react-router-dom";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import { useAuth } from "@/app/auth/auth-context";
import { cn } from "@/lib/cn";
import { PlusIcon, PhoneIcon } from "@/components/ui/icons";
import * as api from "@/lib/smartcomm-api";
import { getCommsSocket, useCommsChannel } from "@/lib/comms-socket";
import { useOnline, lastSeenText } from "./presence";
import { dial, useCall } from "./call/call-session";
import { PinnedCallSummary } from "./call/pinned-call-summary";
import { NewMessageDialog } from "./inbox/composer/new-message";
import { Composer } from "./chat/composer";
import { MessageBubble } from "./chat/message-bubble";
import { ForwardDialog } from "./chat/forward-dialog";

/* avatar colouring — a fixed per-person palette (pixie parity), not the brand accent */
const AVATAR_COLOURS = [
  "#C9A86C",
  "#7FB069",
  "#5B9BD5",
  "#C0626E",
  "#9B7EDE",
  "#4DB6AC",
  "#E2934D",
  "#D46BA3",
];
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

const AVATAR_SIZES = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-[12px]",
  lg: "h-16 w-16 text-lg",
} as const;

/** Avatar — the user's uploaded profile photo (avatar_ref /media URL) when they
 *  have one, else the hashed-colour initials chip (pixie parity). */
function Avatar({
  name,
  src,
  size = "md",
}: {
  name?: string | null;
  src?: string | null;
  size?: keyof typeof AVATAR_SIZES;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name || "avatar"}
        className={cn("shrink-0 rounded-full object-cover", AVATAR_SIZES[size])}
      />
    );
  }
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-white",
        AVATAR_SIZES[size],
      )}
      style={{ backgroundColor: avatarColour(name) }}
    >
      {initials(name)}
    </span>
  );
}
function fmtRelative(iso?: string | null) {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  // en-GB, not the workstation locale — "11 Sep", never "Sep 11".
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
}

/**
 * ── THE "EMAIL" CHIP IS GONE, AND WHY ───────────────────────────────────────
 *
 * There used to be a fifth filter here labelled "Email", and selecting it ran
 * `if (EXTERNAL.includes(filter)) return false` over every channel — which is
 * to say it filtered out everything, always, and drew "No conversations match."
 * It could never do anything else: this list is `comms_channel` rows, in-house
 * chat, and there has never been an email conversation in it to show.
 *
 * It was not a bug so much as a wrong answer to a real question. Somebody
 * arriving at Comms sees "Inbox" with an "Email" tab under it and reasonably
 * concludes this is where their email is; then it is empty, and now the product
 * appears to have two email sections, one of which is broken. Email lives one
 * tab over, in Mailbox, and the empty state below says so with a link rather
 * than a chip that leads nowhere.
 *
 * The "Email" option in the New (+) chooser stays — that one always worked. It
 * opens the mail composer, which is a genuinely useful thing to reach from a
 * chat about a client.
 */
type Filter = "all" | "unread" | "inhouse" | "groups";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "inhouse", label: "In-house" },
  { key: "groups", label: "Groups" },
];

/* The New (+) chooser: in-house message, group channel, or email. */
function NewChoiceModal({
  onPick,
  onClose,
}: {
  onPick: (k: "direct" | "group" | "email") => void;
  onClose: () => void;
}) {
  const opt =
    "block w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary/5";
  return (
    <Modal
      open
      onClose={onClose}
      title={tr("New")}
      description={tr("Start an in-house message, a group channel, or an email.")}
    >
      <div className="space-y-2">
        <button type="button" className={opt} onClick={() => onPick("direct")}>
          <span className="block font-medium text-foreground">
            {tr("In-house message")}
          </span>
          <span className="micro">{tr("Direct message a colleague")}</span>
        </button>
        <button type="button" className={opt} onClick={() => onPick("group")}>
          <span className="block font-medium text-foreground">
            {tr("Group channel")}
          </span>
          <span className="micro">{tr("A shared channel with your team")}</span>
        </button>
        <button type="button" className={opt} onClick={() => onPick("email")}>
          <span className="block font-medium text-foreground">{tr("Email")}</span>
          <span className="micro">
            {tr("Email a client, supplier, colleague or lead — from your mailbox")}
          </span>
        </button>
      </div>
    </Modal>
  );
}

function NewChatModal({
  colleagues,
  initialMode,
  onClose,
  onCreated,
}: {
  colleagues: api.Colleague[];
  initialMode?: "DIRECT" | "GROUP";
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [mode, setMode] = React.useState<"DIRECT" | "GROUP">(
    initialMode || "DIRECT",
  );
  const [name, setName] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "DIRECT"
          ? {
              name:
                colleagues.find((c) => c.user_id === selected[0])?.full_name ||
                "Direct message",
              kind: "DIRECT" as const,
              member_ids: selected.slice(0, 1),
            }
          : { name, kind: "DEPARTMENT" as const, member_ids: selected };
      const ch = await api.createChannel(body);
      onCreated(ch.group_id);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  const canSubmit =
    mode === "DIRECT" ? selected.length === 1 : !!name && selected.length > 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={tr("New conversation")}
      description="Start a direct message or a group channel with colleagues."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("Type")}>
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value as "DIRECT" | "GROUP")}
          >
            <option value="DIRECT">Direct message</option>
            <option value="GROUP">Group channel</option>
          </Select>
        </Field>
        {mode === "GROUP" && (
          <Field label="Channel name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ops — Douala corridor"
            />
          </Field>
        )}
        <Field label={mode === "DIRECT" ? "Colleague" : "Members"}>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {colleagues.map((c) => (
              <label
                key={c.user_id}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
              >
                <input
                  type={mode === "DIRECT" ? "radio" : "checkbox"}
                  name="member"
                  checked={selected.includes(c.user_id)}
                  onChange={() =>
                    mode === "DIRECT"
                      ? setSelected([c.user_id])
                      : toggle(c.user_id)
                  }
                />
                <Avatar name={c.full_name} src={c.avatar_ref} size="sm" />
                <span className="min-w-0 truncate">
                  {c.full_name || c.email}
                </span>
              </label>
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
          <Button type="submit" loading={busy} disabled={!canSubmit || busy}>
            Start
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3z" />
    </svg>
  );
}
function MuteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M3 3l18 18M18 8a6 6 0 00-9-5M6 8v4l-2 3h11" />
    </svg>
  );
}

/**
 * What the channel row previews: the words when there are words, otherwise what
 * the message carries. A media-only message has `body = NULL`, so reading the
 * body alone left a voice note previewing as "No messages yet".
 */
function channelPreview(c: api.Channel): string {
  const lm = c.last_message;
  if (!lm) return "No messages yet";
  if (lm.body) return lm.body;
  if (lm.has_voice_note) return tr("Voice note");
  if (lm.has_erp) return tr("Shared a record");
  if (lm.first_media_kind === "IMAGE") {
    return (lm.attachment_count || 1) > 1 ? tr("Photos") : tr("Photo");
  }
  if (lm.first_media_kind === "VIDEO") return tr("Video");
  if ((lm.attachment_count || 0) > 0) return tr("Attachment");
  if (lm.media_vault_id) return tr("Attachment");
  return "No messages yet";
}

function ChannelRow({
  c,
  active,
  senderName,
  onClick,
}: {
  c: api.Channel;
  active: boolean;
  /** Display name of the last message's sender, "You" when it was the viewer. */
  senderName?: string | null;
  onClick: () => void;
}) {
  const unread = c.unread || 0;
  /* Who said it, on group channels: in a DIRECT conversation there are two
   * people and the avatar already says which half is which, but "Voice note"
   * under "Ops Task Force" is useless without a name on it. */
  const showSender = c.kind !== "DIRECT" && !!c.last_message && !!senderName;
  const isDirect = c.kind === "DIRECT" && !!c.partner_user_id;
  /* Presence (guide §4.11): the dot is the socket — live, not a guess. When
   * the partner is OFFLINE the row says when they were last here, day-first;
   * when they're ONLINE the row is a normal chat row (the green dot carries
   * the news). Hook is unconditional — the row is one component for both. */
  const partnerOnline = useOnline(isDirect ? c.partner_user_id : null);
  const offlineSince = isDirect && !partnerOnline ? lastSeenText(c.partner_last_seen_at) : "";
  const preview = showSender
    ? `${senderName}: ${channelPreview(c)}`
    : offlineSince || channelPreview(c);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <Avatar
        name={c.name}
        src={c.kind === "DIRECT" ? c.partner_avatar_ref : null}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-1">
          <span
            className={cn(
              "flex items-center gap-1 truncate text-[12.5px]",
              unread > 0
                ? "font-medium text-foreground"
                : "text-muted-foreground",
            )}
          >
            {isDirect && (
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  partnerOnline ? "bg-[rgb(var(--ok))]" : "bg-[rgb(var(--ink-3))]",
                )}
                aria-hidden
              />
            )}
            <span className="truncate">{c.name}</span>
            {c.is_pinned && (
              <span className="shrink-0 text-primary-ink">
                <PinIcon />
              </span>
            )}
            {c.is_muted && (
              <span className="shrink-0 text-muted-foreground">
                <MuteIcon />
              </span>
            )}
          </span>
          <span
            className={cn(
              "shrink-0 text-[10px]",
              unread > 0
                ? "font-semibold text-primary-ink"
                : "text-muted-foreground",
            )}
          >
            {fmtRelative(c.last_message?.created_at)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-1">
          <span
            className={cn(
              "truncate text-[11.5px]",
              unread > 0 ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {preview}
          </span>
          {unread > 0 && (
            <span
              className={cn(
                "grid h-4 min-w-[16px] shrink-0 place-items-center rounded-full px-1 text-[9px] font-bold",
                c.is_muted
                  ? "bg-[rgb(var(--ink-3)/0.4)] text-primary-foreground"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/** The honest presence line (guide §4.11): a LIVE dot that is the socket —
 *  green only while a socket is connected — and, under it, when the socket
 *  is gone, the last beat in the house day-first form. A dot with no signal
 *  behind it is a lie, so the green is conditional on the socket, never on
 *  the timestamp. */
function PartnerPresence({
  userId,
  lastSeenAt,
}: {
  userId: string;
  lastSeenAt?: string | null;
}) {
  const online = useOnline(userId);
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          online ? "bg-[rgb(var(--ok))]" : "bg-[rgb(var(--ink-3))]",
        )}
        aria-hidden
      />
      <span aria-live="polite">
        {online ? tr("Online now") : lastSeenText(lastSeenAt)}
      </span>
    </span>
  );
}

function InfoPane({ channel }: { channel: api.Channel | null }) {
  if (!channel)
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center micro">
        Details appear here.
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <div className="flex flex-col items-center gap-2 border-b border-border pb-4 text-center">
        <Avatar
          name={channel.name}
          src={channel.kind === "DIRECT" ? channel.partner_avatar_ref : null}
          size="lg"
        />
        <div className="text-sm font-semibold">{channel.name}</div>
        {channel.kind && (
          <span className="micro">{channel.kind.toLowerCase()}</span>
        )}
        {channel.kind === "DIRECT" && channel.partner_user_id && (
          <>
            <PartnerPresence
              userId={channel.partner_user_id}
              lastSeenAt={channel.partner_last_seen_at}
            />
            {/* The member-area dial affordance (the top one lives on the
                thread header) — the same action, the same row it sits on. */}
            <button
              type="button"
              onClick={() => void dial(channel.group_id, channel.name)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-accent"
            >
              <PhoneIcon width={14} height={14} />
              {tr("Start a voice call")}
            </button>
          </>
        )}
      </div>
      <div className="space-y-3 pt-4 text-sm">
        <div>
          <div className="micro mb-1 uppercase tracking-wide">About</div>
          <p className="text-muted-foreground">
            {channel.kind === "DIRECT"
              ? "Direct message."
              : "Group conversation — auditable and exportable."}
          </p>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Members</span>
          <span className="num">{channel.member_count ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{tr("Opened")}</span>
          <span className="num">
            {channel.created_at
              ? dateDmy(channel.created_at)
              : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function TeamChatPage() {
  const [infoOpen, setInfoOpen] = React.useState(() => {
    try { return localStorage.getItem("comms:info-open") !== "false"; }
    catch { return true; /* @silent:storage — use the first-visit default */ }
  });
  const [mobileInfoOpen, setMobileInfoOpen] = React.useState(false);
  const toggleInfo = () => {
    const next = !infoOpen;
    setInfoOpen(next);
    try { localStorage.setItem("comms:info-open", String(next)); }
    catch { /* @silent:storage — the toggle still works for this visit */ }
  };
  React.useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeDrawer = () => { if (desktop.matches) setMobileInfoOpen(false); };
    desktop.addEventListener("change", closeDrawer);
    return () => desktop.removeEventListener("change", closeDrawer);
  }, []);
  const { user } = useAuth();
  const meId =
    (user as { user_id?: string; id?: string } | null)?.user_id ||
    (user as { id?: string } | null)?.id ||
    "";
  const [params, setParams] = useSearchParams();
  const activeId = params.get("channel");
  const channels = useResource(() => api.listChannels(), []);
  const colleagues = useResource(() => api.listColleagues(), []);
  const [newKind, setNewKind] = React.useState<
    "" | "menu" | "direct" | "group" | "email"
  >("");
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");

  const nameOf = React.useMemo(() => {
    const m: Record<string, string> = {};
    (colleagues.data || []).forEach((c) => {
      m[c.user_id] = c.full_name || c.email;
    });
    return m;
  }, [colleagues.data]);

  const all = channels.data || [];
  const unreadTotal = all.reduce((s, c) => s + (c.unread || 0), 0);

  /* ── LIVE UNREAD, AT THE LIST LEVEL ───────────────────────────────────────
   *
   * The server publishes `comms:message` to the channel's room only, and the
   * open thread is the sole joiner — so without this, a message arriving in
   * any channel the reader is NOT viewing never moves this list's badges, and
   * the Ops Task Force counter sits stale until something is sent from here.
   * Join every member channel (membership-checked server-side, idempotent with
   * the thread's own join) and reload the list on arrival. The 15s interval is
   * the reconciler for a socket that was down when the message landed — the
   * same live-plus-poll bargain the thread itself already makes.
   *
   * Keyed on the joined id string, not the array: a reload returns a fresh
   * array with the same membership, and re-joining every room on each of those
   * would churn the socket for nothing. */
  const reloadRef = React.useRef(() => {});
  reloadRef.current = () => channels.reload();
  const channelKey = all.map((c) => c.group_id).join(",");
  React.useEffect(() => {
    const ids = channelKey ? channelKey.split(",") : [];
    if (!ids.length) return;
    const s = getCommsSocket();
    const onMessage = () => reloadRef.current();
    const join = () => {
      for (const id of ids) s.emit("channel:join", id);
    };
    s.on("comms:message", onMessage);
    if (s.connected) join();
    s.on("connect", join);
    return () => {
      s.off("comms:message", onMessage);
      s.off("connect", join);
      for (const id of ids) s.emit("channel:leave", id);
    };
  }, [channelKey]);
  React.useEffect(() => {
    const t = window.setInterval(() => reloadRef.current(), 15000);
    return () => window.clearInterval(t);
  }, []);
  const filtered = all.filter((c) => {
    if (filter === "unread" && !c.unread) return false;
    if (filter === "inhouse" && c.kind !== "DIRECT") return false;
    if (filter === "groups" && c.kind === "DIRECT") return false;
    if (q.trim()) {
      const hay = `${c.name} ${channelPreview(c)}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const select = (id: string) => {
    const n = new URLSearchParams(params);
    n.set("channel", id);
    setParams(n);
  };

  return (
    <section className="animate-fade-in flex min-h-0 flex-1 flex-col">
      {/* Size from the shell's remaining space, never from a guessed viewport offset. */}
      <div className={cn(
        "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:grid-cols-[320px_minmax(0,1fr)]",
        infoOpen && "lg:grid-cols-[320px_minmax(0,1fr)_300px]",
      )}>
        {/* conversation list */}
        <div
          className={cn(
            "flex min-h-0 flex-col overflow-hidden border-border md:border-r",
            activeId ? "hidden md:flex" : "flex",
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-[15px] font-medium">{tr("Chats")}</h2>
              {unreadTotal > 0 && (
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {unreadTotal > 99 ? "99+" : unreadTotal}
                </span>
              )}
            </div>
            {/* Labeled, not a bare glyph: the previous 16px "+" read as a
                generic "add" control and the compose entry was invisible to
                new users. Text at md+, icon-only below (WS feedback). */}
            <Button
              size="sm"
              onClick={() => setNewKind("menu")}
              title={tr("New conversation")}
              aria-label={tr("New conversation")}
              icon={<PlusIcon width={16} height={16} />}
            >
              <span className="hidden md:inline">{tr("New")}</span>
            </Button>
          </div>
          <div className="px-3 py-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tr("Search conversations…")}
            />
          </div>
          <div className="flex gap-1 overflow-x-auto px-3 pb-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
                  filter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {tr(f.label)}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
            {channels.loading ? (
              <div className="space-y-1 p-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 animate-pulse rounded-xl border border-border bg-accent/40"
                  />
                ))}
              </div>
            ) : channels.error ? (
              <div className="p-4">
                <ErrorState message={channels.error} />
              </div>
            ) : filtered.length ? (
              <div className="space-y-px">
                {filtered.map((c) => {
                  const senderId = c.last_message?.sender_user_id || null;
                  const isMine = !!meId && !!senderId && senderId === meId;
                  return (
                    <ChannelRow
                      key={c.group_id}
                      c={c}
                      active={activeId === c.group_id}
                      senderName={
                        isMine ? tr("You") : senderId ? nameOf[senderId] || null : null
                      }
                      onClick={() => select(c.group_id)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2 px-4 py-12 text-center micro">
                <p>
                  {q || filter !== "all"
                    ? tr("No conversations match.")
                    : tr("No conversations yet")}
                </p>
                {/* The question this answers is "where is my email?", and it is
                    asked here because the header says Inbox. One sentence and a
                    link beats the chip that used to sit above and go nowhere. */}
                {!q && filter === "all" && (
                  <p>
                    {tr("This is in-house chat.")}{" "}
                    <Link to="/comms/mail" className="font-medium text-foreground underline underline-offset-2">
                      {tr("Your email is in Mailbox.")}
                    </Link>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* thread */}
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-col overflow-hidden",
            activeId ? "flex" : "hidden md:flex",
          )}
        >
          {activeId ? (
            <Thread
              key={activeId}
              channelId={activeId}
              meId={meId}
              nameOf={nameOf}
              channels={all}
              onBack={() => {
                const n = new URLSearchParams(params);
                n.delete("channel");
                setParams(n);
              }}
              infoOpen={infoOpen}
              onToggleInfo={toggleInfo}
              onOpenMobileInfo={() => setMobileInfoOpen(true)}
              onSent={() => channels.reload()}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center micro">
              {tr("Pick a conversation to start.")}
            </div>
          )}
        </div>

        {/* customer / channel 360 — third pane on wide screens */}
        <div id="chat-info-panel" className={cn("hidden min-h-0 flex-col overflow-hidden border-l border-border", infoOpen && "lg:flex")}>
          <div className="flex shrink-0 items-center justify-between border-b border-border p-3">
            <span className="text-sm font-semibold">{tr("Conversation info")}</span>
            <Button size="sm" variant="ghost" onClick={toggleInfo}>{tr("Hide")}</Button>
          </div>
          <InfoPane
            channel={all.find((c) => c.group_id === activeId) || null}
          />
        </div>
      </div>

      <Dialog open={mobileInfoOpen} onClose={() => setMobileInfoOpen(false)}
        title={tr("Conversation info")} placement="right" bodyClassName="p-0">
        <InfoPane channel={all.find((c) => c.group_id === activeId) || null} />
      </Dialog>

      {newKind === "menu" && (
        <NewChoiceModal
          onPick={(k) => setNewKind(k)}
          onClose={() => setNewKind("")}
        />
      )}
      {(newKind === "direct" || newKind === "group") && (
        <NewChatModal
          colleagues={colleagues.data || []}
          initialMode={newKind === "group" ? "GROUP" : "DIRECT"}
          onClose={() => setNewKind("")}
          onCreated={(id) => {
            channels.reload();
            select(id);
          }}
        />
      )}
      {newKind === "email" && (
        <NewMessageDialog
          open
          onClose={() => setNewKind("")}
          onSent={() => setNewKind("")}
        />
      )}
    </section>
  );
}

function Thread({
  channelId,
  meId,
  nameOf,
  channels,
  onBack,
  onSent,
  infoOpen,
  onToggleInfo,
  onOpenMobileInfo,
}: {
  infoOpen: boolean;
  onToggleInfo: () => void;
  onOpenMobileInfo: () => void;
  channelId: string;
  meId: string;
  nameOf: Record<string, string>;
  /** Every channel the viewer is in — the forward picker's options. */
  channels: api.Channel[];
  onBack: () => void;
  onSent: () => void;
}) {
  const ch = useResource(() => api.getChannel(channelId), [channelId]);
  const thread = useResource(() => api.getThread(channelId), [channelId]);
  // The caller's call-summary drafts for this conversation, pinned above the
  // composer (owner decision O3). `?summary=<call>` opens one: that is where
  // the summary notification lands.
  const [params, setParams] = useSearchParams();
  const openSummary = params.get("summary");
  const setOpenSummary = React.useCallback((callId: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (callId) next.set("summary", callId);
      else next.delete("summary");
      return next;
    }, { replace: true });
  }, [setParams]);
  const { summaryTick } = useCall();
  const reloadThread = thread.reload;
  React.useEffect(() => {
    if (summaryTick) reloadThread();
  }, [summaryTick, reloadThread]);
  const followedInitially = React.useRef(false);
  const nearBottom = React.useRef(true);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  // Memoised because `thread.data?.messages || []` is a fresh array on every
  // render, which would make the reply-quote map below rebuild each time.
  const msgs = React.useMemo(() => thread.data?.messages || [], [thread.data]);
  /** One card per distinct URL in this page, from the tenant's own preview cache. */
  const linkPreviews = React.useMemo(
    () => thread.data?.links || undefined,
    [thread.data],
  );

  /**
   * Which message's action rail a touch device is currently showing.
   *
   * State lives HERE rather than in each bubble, and that placement is the whole
   * design: one open rail at a time is what makes "tap the message" unambiguous.
   * Tapping a second message closes the first, so a thread cannot accumulate
   * fifteen emoji strips, and the reader always knows which message the bar
   * belongs to. An Escape key and a tap outside clear it, because a control that
   * can only be dismissed by finding the right message to tap again is a modal
   * that forgot to trap anything.
   */
  const [revealedId, setRevealedId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!revealedId) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRevealedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [revealedId]);
  // Changing channel while a rail is open must not leave the id pointing at a
  // message in the channel that is no longer on screen.
  React.useEffect(() => setRevealedId(null), [channelId]);

  const composerBusy = React.useRef(false);
  const [editingMessage, setEditingMessage] = React.useState<api.CommMessage | null>(null);
  const [replyTo, setReplyTo] = React.useState<api.CommMessage | null>(null);
  const [forwarding, setForwarding] = React.useState<api.CommMessage | null>(null);

  // Live updates (socket.io). Any channel event refreshes the thread; a peer's
  // typing shows a transient indicator. The 8s poll below stays as a fallback
  // for when the socket can't connect.
  const [typingName, setTypingName] = React.useState<string | null>(null);
  const typingTimer = React.useRef<number | null>(null);
  const { setTyping } = useCommsChannel(channelId, {
    "comms:message": () => {
      thread.reload();
      onSent();
    },
    "comms:message_edited": () => thread.reload(),
    "comms:message_deleted": () => thread.reload(),
    "comms:reaction": () => thread.reload(),
    // A voice note's transcript lands after the message it belongs to — the
    // clip is posted immediately and transcribed afterwards, deliberately.
    // This is what makes the words appear under a bubble somebody is already
    // looking at rather than on their next reload.
    "comms:transcript": () => thread.reload(),
    "channel:typing": (p: { user_id?: string }) => {
      if (!p?.user_id || p.user_id === meId) return;
      setTypingName(nameOf[p.user_id] || "Someone");
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => setTypingName(null), 3000);
    },
  });

  /* Through a ref, not the prop: `onSent` is an inline arrow in the parent, so
   * depending on it would re-mark-read on every parent render, and the reload
   * it triggers IS a parent render. */
  const onSentRef = React.useRef(onSent);
  onSentRef.current = onSent;
  React.useEffect(() => {
    api
      .markRead(channelId)
      /* …and then say so upstairs. Marking read without reloading the list
         left the channel's own badge standing after the messages had been
         read — the second half of the stale-counter complaint. */
      .then(() => onSentRef.current())
      .catch(() => {
        /* @silent:storage — an unsent read marker costs a stale unread badge until
           the next open, never a message */
      });
  }, [channelId, msgs.length]);

  /**
   * Follow the conversation, but only when the reader is already at the bottom.
   *
   * Scrolling unconditionally is the defect every chat has had at least once:
   * somebody reading back through yesterday gets yanked to the end each time a
   * colleague types, and there is no way to finish reading a paragraph.
   */
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (!msgs.length) return;
    // Only move this pane. scrollIntoView also moves the shell/ancestors.
    if (!followedInitially.current || nearBottom.current) {
      el.scrollTop = el.scrollHeight;
      followedInitially.current = true;
    }
  }, [msgs.length]);

  React.useEffect(() => {
    const t = window.setInterval(() => thread.reload(), 8000);
    return () => window.clearInterval(t);
  }, [thread]);

  // Reply quotes resolve against the page the reader has. A reply to something
  // older than the loaded window renders without its quote rather than
  // fetching one message at a time while scrolling.
  const byId = React.useMemo(
    () => new Map(msgs.map((m) => [m.message_id, m])),
    [msgs],
  );

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <button
          className="text-muted-foreground hover:text-foreground md:hidden"
          onClick={onBack}
          aria-label={tr("Back")}
        >
          ←
        </button>
        <Avatar
          name={ch.data?.name}
          src={ch.data?.kind === "DIRECT" ? ch.data?.partner_avatar_ref : null}
          size="sm"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {ch.data?.name || "Conversation"}
        </span>
        {ch.data?.kind && (
          <span className="micro">· {ch.data.kind.toLowerCase()}</span>
        )}
        {/* The dial affordance lives on the DIRECT header itself — where the
            eyes already are when choosing whom to call. The partner is
            resolved server-side from the channel; the UI only names the
            channel (guide D8 — no person id to get wrong). */}
        {ch.data?.kind === "DIRECT" && (
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={tr("Start a voice call")}
            title={tr("Start a voice call")}
            onClick={() => {
              if (ch.data) void dial(ch.data.group_id, ch.data.name);
            }}
          >
            <PhoneIcon width={16} height={16} />
          </button>
        )}
        <Button size="sm" variant="ghost" className="hidden shrink-0 lg:inline-flex"
          aria-expanded={infoOpen} aria-controls="chat-info-panel" onClick={onToggleInfo}>
          {tr(infoOpen ? "Hide info" : "Show info")}
        </Button>
        <Button size="sm" variant="ghost" className="shrink-0 lg:hidden"
          aria-haspopup="dialog" onClick={onOpenMobileInfo}>{tr("Info")}</Button>
      </div>

      <div
        ref={scrollerRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain bg-[rgb(var(--ink-3)/0.04)] px-4 py-3"
        // A tap on the empty scroller — beside a bubble, in the gap between two —
        // is the reader saying "not this one". The bubbles themselves stop nothing,
        // so this only fires for the background.
        onPointerDown={(event) => {
          if (!revealedId) return;
          // Bubbles handle their own taps (see `message-bubble.tsx`), and the
          // pointer event from one of those arrives here too, because events
          // bubble. Without this guard the ancestor would clear what the child
          // just set, in the same tick, and the rail would never appear at all —
          // the single most likely way to get this interaction wrong.
          const target = event.target as HTMLElement | null;
          if (target?.closest?.("[data-message-bubble]")) return;
          setRevealedId(null);
        }}
      >
        {thread.loading && msgs.length === 0 ? (
          <div className="micro">{tr("Loading…")}</div>
        ) : thread.error ? (
          <ErrorState message={thread.error} />
        ) : msgs.length ? (
          msgs.map((m) => (
            <MessageBubble
              key={m.message_id}
              message={m}
              mine={!!meId && m.sender_user_id === meId}
              meId={meId}
              senderName={m.sender_user_id ? nameOf[m.sender_user_id] || tr("Someone") : null}
              repliedTo={m.reply_to_message_id ? byId.get(m.reply_to_message_id) || null : null}
              onEdit={(message) => { if (!composerBusy.current) setEditingMessage(message); }}
              onReply={(message) => { if (!composerBusy.current) setReplyTo(message); }}
              onForward={setForwarding}
              onChanged={() => { thread.reload(); onSent(); }}
              links={linkPreviews}
              revealed={revealedId === m.message_id}
              onToggleReveal={() =>
                setRevealedId((current) => (current === m.message_id ? null : m.message_id))
              }
              onReacted={() => setRevealedId(null)}
            />
          ))
        ) : (
          <div className="flex h-full items-center justify-center micro">
            {tr("No messages yet — say hello.")}
          </div>
        )}
      </div>

      {typingName && (
        <div className="px-4 pb-1 text-[11px] italic text-muted-foreground">
          {typingName} {tr("is typing…")}
        </div>
      )}

      <PinnedCallSummary
        drafts={thread.data?.pending_call_summaries || []}
        openCallId={openSummary}
        onOpenChange={setOpenSummary}
        onChanged={() => {
          setOpenSummary(null);
          thread.reload();
          onSent();
        }}
        refreshKey={summaryTick}
      />

      <Composer
        channelId={channelId}
        editingMessage={editingMessage}
        onBusyChange={(busy) => { composerBusy.current = busy; }}
        onCancelEdit={() => setEditingMessage(null)}
        onEditLast={() => {
          const last = [...msgs].reverse().find((m) => m.sender_user_id === meId && !!m.body && !m.deleted_at);
          if (last) setEditingMessage(last);
        }}
        replyTo={
          replyTo
            ? {
              message_id: replyTo.message_id,
              body: replyTo.body,
              sender: replyTo.sender_user_id ? nameOf[replyTo.sender_user_id] : null,
            }
            : null
        }
        onCancelReply={() => setReplyTo(null)}
        onTyping={setTyping}
        onSent={() => { thread.reload(); onSent(); }}
      />

      <ForwardDialog
        message={forwarding}
        channels={channels}
        currentChannelId={channelId}
        onClose={() => setForwarding(null)}
        onForwarded={onSent}
      />
    </>
  );
}
