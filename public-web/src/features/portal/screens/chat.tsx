/**
 * Messages — the client's line to the team handling their cargo.
 *
 * A General conversation with the company, and one per shipment (owner
 * decision 1/12): a question about container MSKU 123 lives with that
 * shipment, not scrolled past by last month's invoice question. On a phone the
 * list and a conversation take turns, as in every messaging app; on a desk the
 * list stays on the left and the conversation fills the right.
 *
 * Photos, PDFs, voice notes and a location travel in it (`chat-composer.tsx`);
 * opened from a shipment's stage, the first message is already tagged with it.
 * A conversation refreshes every ten seconds while it is on screen, the list
 * every twenty, and neither polls from a background tab.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  portalChatThreads,
  portalChatMessages,
  portalChatSend,
  portalChatRead,
  portalShipments,
  type ChatThread,
  type ChatMessage,
  type ChatAttachment,
  type ChatSend,
  type ShipmentCard,
} from "@/lib/portal-api";
import { getLang } from "@/lib/i18n";
import { useBranding } from "@/app/branding";
import { cn } from "@/lib/cn";
import { usePortal } from "../lib/portal-context";
import { Sheet, EmptyState, Shimmer, errorText, IconDisc, useLoad } from "../ui/kit";
import { ChatIcon, CloseIcon, ShipIcon, AlertIcon, ChevronLeftIcon, PlusIcon, ChevronDownIcon, ImageIcon, MicIcon, PinIcon, DocIcon } from "../ui/icons";
import { dayLabel, whenShort } from "../lib/when";
import { seedAttachmentUrl } from "../lib/chat-media";
import { Bubble, DayMarker, PhotoViewer, type Sending } from "./chat-parts";
import { Composer, type Outgoing } from "./chat-composer";

export type ChatTarget = {
  dossierId?: string | null;
  ref?: string | null;
  draft?: string | null;
  /** Opened from a stage of the shipment: the first message is about it. */
  milestone?: { id: string; label: string } | null;
  /** Straight into General — a notification about it, tapped on a phone. */
  general?: boolean;
} | null;

type Open = { thread: string; ref: string | null };

const MESSAGES_MS = 10_000;
const THREADS_MS = 20_000;

/** Run `fn` every `ms` while the tab is visible, and once more when it comes back. */
function usePoll(fn: () => void, ms: number, on: boolean) {
  const ref = React.useRef(fn);
  ref.current = fn;
  React.useEffect(() => {
    if (!on) return;
    const tick = () => {
      if (document.visibilityState === "visible") ref.current();
    };
    const id = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, on]);
}

function useWide() {
  const query = "(min-width: 768px)";
  const [wide, setWide] = React.useState(() => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches);
  React.useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return wide;
}

export function ChatSheet({ open, target, onClose, onRead }: { open: boolean; target: ChatTarget; onClose: () => void; onRead?: () => void }) {
  const { t } = useTranslation();
  const portal = usePortal();
  const wide = useWide();
  const titleId = React.useId();
  const [active, setActive] = React.useState<Open | null>(null);
  const [threads, setThreads] = React.useState<ChatThread[] | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [picking, setPicking] = React.useState(false);

  const loadThreads = React.useCallback(async () => {
    try {
      setThreads(await portalChatThreads());
      setListError(null);
    } catch (e) {
      setListError(errorText(e));
    }
  }, []);

  // Each opening starts from what it was opened FOR: a shipment, else the
  // list — or, on a desk where both show, General.
  React.useEffect(() => {
    if (!open) return;
    void loadThreads();
    if (target?.dossierId) setActive({ thread: target.dossierId, ref: target.ref || null });
    else setActive(wide || target?.general ? { thread: "general", ref: null } : null);
    // `wide` is read once per opening on purpose: rotating a tablet mid-chat
    // must not close the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target, loadThreads]);

  usePoll(() => void loadThreads(), THREADS_MS, open);

  const read = React.useCallback(() => {
    void loadThreads();
    onRead?.();
  }, [loadThreads, onRead]);

  const showList = wide || !active;
  const opener = target?.dossierId && active?.thread === target.dossierId ? target : null;

  return (
    <Sheet open={open} onClose={onClose} bare full wide className="pt-chat-sheet" labelledBy={titleId}>
      <div className="pt-chat">
        {showList ? (
          <section className="pt-chat-list" aria-labelledby={titleId}>
            <header className="flex items-center gap-3 px-5 pb-2 pt-4">
              <h2 id={titleId} className="pt-display min-w-0 flex-1 text-[1.3rem]">
                {t("portal.chat.title")}
              </h2>
              {!wide ? (
                <button type="button" data-close onClick={onClose} className="pt-icon-btn -mr-2" aria-label={t("portal.common.close")}>
                  <CloseIcon size={20} />
                </button>
              ) : null}
            </header>
            <ThreadList
              threads={threads}
              error={listError}
              active={active?.thread || null}
              onOpen={(th) => setActive({ thread: th.thread, ref: th.dossier_ref })}
            />
            {portal.canOps ? (
              <div className="border-t border-[var(--pt-line)] p-3">
                <button type="button" className="pt-btn pt-btn-soft pt-btn-block" onClick={() => setPicking(true)}>
                  <PlusIcon size={20} />
                  {t("portal.chat.newAbout")}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {active ? (
          <Conversation
            key={active.thread}
            thread={active.thread}
            refLabel={active.ref}
            milestone={opener?.milestone || null}
            draft={opener?.draft || null}
            wide={wide}
            titleId={wide ? undefined : titleId}
            onBack={() => {
              setActive(null);
              void loadThreads();
            }}
            onClose={onClose}
            onRead={read}
            onSent={() => void loadThreads()}
          />
        ) : null}
      </div>

      <ShipmentPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(s) => {
          setPicking(false);
          setActive({ thread: s.dossier_id, ref: s.ref });
        }}
      />
    </Sheet>
  );
}

/* ── the list ────────────────────────────────────────────────────────────── */

const KIND_ICON: Record<string, React.ReactNode> = {
  IMAGE: <ImageIcon size={14} />,
  FILE: <DocIcon size={14} />,
  VOICE: <MicIcon size={14} />,
  LOCATION: <PinIcon size={14} />,
};

function ThreadList({ threads, error, active, onOpen }: { threads: ChatThread[] | null; error: string | null; active: string | null; onOpen: (t: ChatThread) => void }) {
  const { t } = useTranslation();
  const { branding } = useBranding();
  if (error && !threads)
    return (
      <p role="alert" className="mx-5 mt-4 flex items-center gap-2 text-sm text-[rgb(var(--bad))]">
        <AlertIcon size={18} />
        {error}
      </p>
    );
  if (!threads)
    return (
      <div className="grid gap-3 px-5 pt-3" aria-hidden="true">
        <Shimmer className="h-14" />
        <Shimmer className="h-14" />
      </div>
    );
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
      {threads.map((th) => {
        const general = th.thread === "general";
        const last = th.last;
        return (
          <li key={th.thread}>
            <button type="button" className="pt-chat-thread" aria-current={active === th.thread ? "true" : undefined} onClick={() => onOpen(th)}>
              <IconDisc tone={general ? "brand" : "info"} size={46}>
                {general ? <ChatIcon size={22} /> : <ShipIcon size={22} />}
              </IconDisc>
              <span className="min-w-0 flex-1 text-left">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn("truncate text-[0.95rem] font-bold text-foreground", !general && "pt-mono")}>{general ? t("portal.chat.general") : th.dossier_ref || t("portal.chat.shipment")}</span>
                  {last ? <span className={cn("pt-num shrink-0 text-xs", th.unread ? "font-semibold text-primary-ink" : "text-muted-foreground")}>{whenShort(last.at)}</span> : null}
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-1 text-sm text-muted-foreground">
                    {last ? (
                      <>
                        {last.mine ? <span className="shrink-0 font-semibold">{t("portal.chat.you")}:</span> : null}
                        {last.kind !== "TEXT" && !last.preview ? KIND_ICON[last.kind] : null}
                        <span className="truncate">{last.preview || t(`portal.chat.kind.${last.kind}`)}</span>
                      </>
                    ) : (
                      <span className="truncate">{general ? t("portal.chat.generalHint") : branding.name || t("portal.chat.team")}</span>
                    )}
                  </span>
                  {th.unread ? (
                    <span className="pt-chat-unread pt-num">
                      <span aria-hidden="true">{th.unread > 99 ? "99+" : th.unread}</span>
                      <span className="sr-only">{t("portal.chat.unread", { count: th.unread })}</span>
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "Message about a shipment": the active ones, one tap each. */
function ShipmentPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (s: ShipmentCard) => void }) {
  const { t } = useTranslation();
  const lang = getLang();
  const ships = useLoad(() => (open ? portalShipments("active", lang) : Promise.resolve([] as ShipmentCard[])), open ? `chat-ships:${lang}` : "none");
  return (
    <Sheet open={open} onClose={onClose} title={t("portal.chat.pickShipment")}>
      {ships.error ? <p className="text-sm text-[rgb(var(--bad))]">{ships.error}</p> : null}
      {!ships.data && !ships.error ? (
        <div className="grid gap-2">
          <Shimmer className="h-14" />
          <Shimmer className="h-14" />
        </div>
      ) : ships.data && !ships.data.length ? (
        <EmptyState icon={<ShipIcon size={28} />} title={t("portal.chat.noShipments")} />
      ) : (
        <ul className="pt-rows">
          {(ships.data || []).map((s) => (
            <li key={s.dossier_id}>
              <button type="button" className="pt-row w-full" onClick={() => onPick(s)}>
                <IconDisc tone="info">
                  <ShipIcon />
                </IconDisc>
                <span className="min-w-0 flex-1 text-left">
                  <span className="pt-mono block truncate font-bold text-foreground">{s.ref}</span>
                  {s.origin || s.destination ? (
                    <span className="block truncate text-sm text-muted-foreground">{[s.origin, s.destination].filter(Boolean).join(" → ")}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/* ── one conversation ────────────────────────────────────────────────────── */

type Pending = {
  id: string;
  input: ChatSend;
  file: File | null;
  local: string | null;
  kind: Outgoing["kind"];
  stageLabel: string | null;
  state: "sending" | "failed";
  pct: number | null;
  at: string;
};

/** Newest data wins; order is by time, then id for a tie. */
function merge(into: ChatMessage[], more: ChatMessage[]): ChatMessage[] {
  const byId = new Map(into.map((m) => [m.message_id, m]));
  for (const m of more) byId.set(m.message_id, m);
  return [...byId.values()].sort((a, b) => (a.created_at === b.created_at ? (a.message_id < b.message_id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
}

let seq = 0;

function Conversation({
  thread,
  refLabel,
  milestone,
  draft,
  wide,
  titleId,
  onBack,
  onClose,
  onRead,
  onSent,
}: {
  thread: string;
  refLabel: string | null;
  milestone: { id: string; label: string } | null;
  draft: string | null;
  wide: boolean;
  titleId?: string;
  onBack: () => void;
  onClose: () => void;
  onRead: () => void;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const { branding } = useBranding();
  const portal = usePortal();
  const lang = getLang();
  const general = thread === "general";
  const [messages, setMessages] = React.useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [stage, setStage] = React.useState(milestone);
  const [photo, setPhoto] = React.useState<ChatAttachment | null>(null);
  const [older, setOlder] = React.useState(false);
  const [fresh, setFresh] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement>(null);
  const nearBottom = React.useRef(true);
  const readUpTo = React.useRef<string | null>(null);

  const messagesRef = React.useRef(messages);
  messagesRef.current = messages;

  const load = React.useCallback(async () => {
    try {
      const page = await portalChatMessages(thread, lang);
      setMessages((prev) => {
        const next = merge(prev || [], page.messages);
        if (prev && next.length > prev.length && !nearBottom.current) setFresh(true);
        return next;
      });
      // A poll reads only the newest page; whether there is more ABOVE is
      // decided by the first read and by "earlier", not by every refresh.
      setHasMore((h) => (messagesRef.current ? h : page.has_more));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [thread, lang]);

  React.useEffect(() => {
    void load();
  }, [load]);
  usePoll(() => void load(), MESSAGES_MS, true);

  // Reading is telling the server how far I have read: the newest message from
  // anyone but me. The badge and the list follow.
  React.useEffect(() => {
    if (!messages || !messages.length) return;
    const newest = [...messages].reverse().find((m) => !m.mine);
    if (!newest || (readUpTo.current && newest.created_at <= readUpTo.current)) return;
    readUpTo.current = newest.created_at;
    portalChatRead(thread, newest.created_at)
      .then(onRead)
      .catch(() => {
        /* @silent:storage a missed read receipt only leaves the badge one poll behind */
      });
  }, [messages, thread, onRead]);

  // Stay pinned to the newest message while the reader is at the bottom.
  const count = (messages?.length || 0) + pending.length;
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom.current) setFresh(false);
  }

  function toBottom() {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    nearBottom.current = true;
    setFresh(false);
  }

  async function earlier() {
    const el = scroller.current;
    const first = messages && messages[0];
    if (!first) return;
    setOlder(true);
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const page = await portalChatMessages(thread, lang, first.created_at);
      setMessages((prev) => merge(prev || [], page.messages));
      setHasMore(page.has_more);
      // Keep the reader where they were: the new rows go ABOVE them.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setOlder(false);
    }
  }

  async function run(p: Pending) {
    setPending((l) => l.map((x) => (x.id === p.id ? { ...p, state: "sending", pct: p.file ? 0 : null } : x)));
    try {
      const saved = await portalChatSend(p.input, lang, p.file, p.file ? (pct) => setPending((l) => l.map((x) => (x.id === p.id ? { ...x, pct } : x))) : undefined);
      const att = saved.attachments[0];
      if (p.local && att) seedAttachmentUrl(att.attachment_id, p.kind === "IMAGE", p.local);
      setMessages((prev) => merge(prev || [], [saved]));
      setPending((l) => l.filter((x) => x.id !== p.id));
      onSent();
    } catch {
      setPending((l) => l.map((x) => (x.id === p.id ? { ...x, state: "failed", pct: null } : x)));
    }
  }

  function send(items: Outgoing[]) {
    const now = new Date().toISOString();
    const made: Pending[] = items.map((it) => {
      seq += 1;
      const milestoneId = stage && !general ? stage.id : null;
      const base = { id: `p${seq}`, state: "sending" as const, pct: null, at: now, kind: it.kind, stageLabel: milestoneId && stage ? stage.label : null };
      if (it.kind === "TEXT") return { ...base, input: { thread, body: it.body, milestone_instance_id: milestoneId }, file: null, local: null };
      if (it.kind === "LOCATION")
        return { ...base, input: { thread, milestone_instance_id: milestoneId, location: { lat: it.fix.lat, lng: it.fix.lng, label: it.label || null } }, file: null, local: null };
      if (it.kind === "VOICE") {
        const local = URL.createObjectURL(it.recording.file);
        return { ...base, input: { thread, milestone_instance_id: milestoneId, duration_ms: it.recording.durationMs }, file: it.recording.file, local };
      }
      return { ...base, input: { thread, body: it.body, milestone_instance_id: milestoneId, width: it.width, height: it.height }, file: it.file, local: it.previewUrl };
    });
    // A stage names the conversation's next message, not every one after it.
    if (stage) setStage(null);
    nearBottom.current = true;
    setPending((l) => [...l, ...made]);
    // One after another, so a burst of photos arrives in the order it was picked.
    void (async () => {
      for (const p of made) await run(p);
    })();
  }

  /** The bubble a pending send draws — the same bubble the saved message will be. */
  const asMessage = (p: Pending): ChatMessage => ({
    message_id: p.id,
    dossier_id: null,
    dossier_ref: null,
    direction: "CLIENT",
    body: p.input.body || "",
    created_at: p.at,
    author: { name: null, email: portal.me.portal_user.email },
    mine: true,
    seen: false,
    milestone: p.input.milestone_instance_id ? { milestone_instance_id: p.input.milestone_instance_id, label: p.stageLabel } : null,
    location: p.input.location ? { lat: p.input.location.lat, lng: p.input.location.lng, label: p.input.location.label || null } : null,
    attachments: p.file
      ? [
          {
            attachment_id: "",
            kind: p.kind === "VOICE" ? "VOICE" : p.kind === "FILE" ? "FILE" : "IMAGE",
            name: p.file.name,
            mime_type: p.file.type,
            size: p.file.size,
            width: p.input.width || null,
            height: p.input.height || null,
            duration_ms: p.input.duration_ms || null,
          },
        ]
      : [],
  });

  let lastDay = "";
  let lastAuthor = "";
  const title = general ? t("portal.chat.general") : refLabel || t("portal.chat.shipment");

  return (
    <section className="pt-chat-pane" aria-label={title}>
      <header className="pt-chat-head">
        {!wide ? (
          <button type="button" className="pt-icon-btn -ml-2 shrink-0" aria-label={t("portal.chat.all")} onClick={onBack}>
            <ChevronLeftIcon size={24} />
          </button>
        ) : null}
        <IconDisc tone={general ? "brand" : "info"} size={40}>
          {general ? <ChatIcon size={20} /> : <ShipIcon size={20} />}
        </IconDisc>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className={cn("truncate text-[1.05rem] font-bold text-foreground", !general && "pt-mono")}>
            {title}
          </h2>
          <p className="truncate text-xs text-muted-foreground">{general ? branding.name || t("portal.chat.team") : t("portal.chat.shipment")}</p>
        </div>
        <button type="button" data-close onClick={onClose} className="pt-icon-btn -mr-2 shrink-0" aria-label={t("portal.common.close")}>
          <CloseIcon size={20} />
        </button>
      </header>

      <div ref={scroller} className="pt-chat-scroll" onScroll={onScroll}>
        {error && !messages ? (
          <p role="alert" className="mt-6 flex items-center gap-2 text-sm text-[rgb(var(--bad))]">
            <AlertIcon size={18} />
            {error}
          </p>
        ) : !messages ? (
          <div className="grid gap-3 pt-4" aria-hidden="true">
            <Shimmer className="h-12 w-3/5" />
            <Shimmer className="ml-auto h-10 w-2/5" />
            <Shimmer className="h-16 w-2/3" />
          </div>
        ) : messages.length === 0 && pending.length === 0 ? (
          <EmptyState icon={<ChatIcon size={28} />} title={t("portal.chat.emptyTitle")} hint={t("portal.chat.emptyHint")} />
        ) : (
          <>
            {hasMore ? (
              <div className="flex justify-center py-2">
                <button type="button" className="pt-chip" onClick={() => void earlier()} disabled={older}>
                  {t("portal.chat.earlier")}
                </button>
              </div>
            ) : null}
            <ol className="grid gap-1.5 pb-2 pt-2" role="log" aria-live="polite">
              {messages.map((m) => {
                const day = dayLabel(m.created_at);
                const marker = day !== lastDay ? day : null;
                const author = `${m.direction}:${m.author.name || m.author.email || ""}`;
                const showAuthor = !!marker || author !== lastAuthor;
                lastDay = day;
                lastAuthor = author;
                return (
                  <React.Fragment key={m.message_id}>
                    {marker ? <DayMarker label={marker} /> : null}
                    <Bubble m={m} showAuthor={showAuthor && !m.mine} onOpenPhoto={setPhoto} />
                  </React.Fragment>
                );
              })}
              {pending.map((p) => {
                const sending: Sending = { state: p.state, pct: p.pct };
                return (
                  <React.Fragment key={p.id}>
                    <Bubble m={asMessage(p)} showAuthor={false} sending={sending} local={p.local} />
                    {p.state === "failed" ? (
                      <li className="flex justify-end">
                        <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-[rgb(var(--bad))]" onClick={() => void run(p)}>
                          <AlertIcon size={14} />
                          {t("portal.chat.retry")}
                        </button>
                      </li>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </ol>
          </>
        )}
      </div>

      {fresh ? (
        <button type="button" className="pt-chat-fresh" onClick={toBottom}>
          <ChevronDownIcon size={16} />
          {t("portal.chat.newMessages")}
        </button>
      ) : null}

      <Composer onSend={send} stage={general ? null : stage} onClearStage={() => setStage(null)} draft={draft} />
      <PhotoViewer att={photo} onClose={() => setPhoto(null)} />
    </section>
  );
}
