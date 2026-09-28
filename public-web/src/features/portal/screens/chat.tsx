/**
 * Messages — the client's line to the team handling their cargo.
 *
 * One conversation, drawn the way every messaging app on the person's phone
 * draws one: their words on the right in their tint, the team's on the left,
 * a day marker between days, and a composer pinned under the thumb. A message
 * about one shipment carries that shipment's reference as a small tag, so the
 * team — and the colleague reading tomorrow — sees which file it concerns.
 *
 * Opened from a shipment, the composer starts tagged to it; the tag is one tap
 * to remove. The thread refreshes every fifteen seconds while it is open.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { portalMessages, portalSendMessage, type PortalMessage } from "@/lib/portal-api";
import { cn } from "@/lib/cn";
import { usePortal } from "../lib/portal-context";
import { Sheet, EmptyState, Shimmer, errorText, Busy, Avatar } from "../ui/kit";
import { ChatIcon, SendIcon, CloseIcon, ShipIcon, AlertIcon } from "../ui/icons";
import { dayLabel, timeOf } from "../lib/when";

export type ChatTarget = { dossierId?: string | null; ref?: string | null; draft?: string | null } | null;

type Pending = { id: string; body: string; dossierId: string | null; ref: string | null; failed: boolean };

const POLL_MS = 15_000;

export function ChatSheet({ open, target, onClose }: { open: boolean; target: ChatTarget; onClose: () => void }) {
  const { t } = useTranslation();
  const portal = usePortal();
  const me = portal.me.portal_user.email.toLowerCase();
  const [messages, setMessages] = React.useState<PortalMessage[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [text, setText] = React.useState("");
  const [about, setAbout] = React.useState<{ dossierId: string; ref: string | null } | null>(null);
  const end = React.useRef<HTMLDivElement>(null);
  const box = React.useRef<HTMLTextAreaElement>(null);

  // Each opening starts from what it was opened FOR: a shipment tag, a draft.
  React.useEffect(() => {
    if (!open) return;
    setAbout(target?.dossierId ? { dossierId: target.dossierId, ref: target.ref || null } : null);
    setText(target?.draft || "");
  }, [open, target]);

  const load = React.useCallback(async () => {
    try {
      setMessages(await portalMessages());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [open, load]);

  const count = (messages?.length || 0) + pending.length;
  React.useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "end" });
  }, [open, count]);

  async function send(body: string, tag: { dossierId: string; ref: string | null } | null, retryId?: string) {
    const id = retryId || `p${Date.now()}`;
    const entry: Pending = { id, body, dossierId: tag?.dossierId || null, ref: tag?.ref || null, failed: false };
    setPending((l) => (retryId ? l.map((p) => (p.id === id ? entry : p)) : [...l, entry]));
    try {
      const saved = await portalSendMessage(body, tag?.dossierId || null);
      setMessages((l) => [...(l || []), { ...saved, dossier_ref: saved.dossier_ref ?? tag?.ref ?? null }]);
      setPending((l) => l.filter((p) => p.id !== id));
    } catch {
      setPending((l) => l.map((p) => (p.id === id ? { ...p, failed: true } : p)));
    }
  }

  function submit() {
    const body = text.trim();
    if (!body) return;
    setText("");
    void send(body, about);
    box.current?.focus();
  }

  const coarse = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  const composer = (
    <div>
      {about ? (
        <div className="mb-2 flex">
          <span className="pt-pill" data-tone="brand" data-plain>
            <ShipIcon size={14} />
            <span className="pt-mono">{about.ref || t("portal.chat.thisShipment")}</span>
            <button type="button" className="-mr-1 grid h-5 w-5 place-items-center rounded-full" aria-label={t("portal.chat.untag")} onClick={() => setAbout(null)}>
              <CloseIcon size={12} />
            </button>
          </span>
        </div>
      ) : null}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="pt-chat-box" className="sr-only">
          {t("portal.chat.placeholder")}
        </label>
        <textarea
          id="pt-chat-box"
          ref={box}
          rows={1}
          value={text}
          data-autofocus
          placeholder={t("portal.chat.placeholder")}
          className="pt-field max-h-36 min-h-[48px] flex-1 resize-none !rounded-[24px] !py-3"
          onChange={(e) => {
            setText(e.target.value);
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !coarse) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="pt-btn pt-btn-primary !h-12 !min-h-0 !w-12 shrink-0 !rounded-full !p-0" disabled={!text.trim()} aria-label={t("portal.chat.send")}>
          <SendIcon size={20} />
        </button>
      </form>
    </div>
  );

  let lastDay = "";
  return (
    <Sheet open={open} onClose={onClose} title={t("portal.chat.title")} full wide footer={composer}>
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
        <ol className="grid gap-1.5 pb-2 pt-2" aria-live="polite">
          {messages.map((m) => {
            const day = dayLabel(m.created_at);
            const marker = day !== lastDay ? day : null;
            lastDay = day;
            const mine = m.direction === "CLIENT" && (m.author_email || "").toLowerCase() === me;
            const colleague = m.direction === "CLIENT" && !mine;
            const who = m.direction === "STAFF" ? m.author_name || t("portal.chat.team") : colleague ? m.author_email : null;
            return (
              <React.Fragment key={m.message_id}>
                {marker ? (
                  <li className="my-3 flex justify-center" aria-hidden="true">
                    <span className="pt-pill" data-plain>
                      {marker}
                    </span>
                  </li>
                ) : null}
                <li className={cn("flex items-end gap-2", mine ? "justify-end" : "justify-start")}>
                  {!mine ? <Avatar name={who} email={m.author_email} size={28} className="mb-1" /> : null}
                  <div className="pt-bubble" data-mine={mine || undefined}>
                    {who ? <p className="mb-0.5 text-xs font-semibold text-primary-ink">{who}</p> : null}
                    {m.dossier_ref ? (
                      <p className="pt-mono mb-1 inline-flex items-center gap-1 text-[0.7rem] font-semibold text-muted-foreground">
                        <ShipIcon size={12} />
                        {m.dossier_ref}
                      </p>
                    ) : null}
                    <p>{m.body}</p>
                    <p className="pt-num mt-1 text-right text-[0.68rem] text-muted-foreground">{timeOf(m.created_at)}</p>
                  </div>
                </li>
              </React.Fragment>
            );
          })}
          {pending.map((p) => (
            <li key={p.id} className="flex flex-col items-end gap-1">
              <div className={cn("pt-bubble", !p.failed && "opacity-70")} data-mine>
                {p.ref ? (
                  <p className="pt-mono mb-1 inline-flex items-center gap-1 text-[0.7rem] font-semibold text-muted-foreground">
                    <ShipIcon size={12} />
                    {p.ref}
                  </p>
                ) : null}
                <p>{p.body}</p>
              </div>
              {p.failed ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[rgb(var(--bad))]"
                  onClick={() => void send(p.body, p.dossierId ? { dossierId: p.dossierId, ref: p.ref } : null, p.id)}
                >
                  <AlertIcon size={14} />
                  {t("portal.chat.retry")}
                </button>
              ) : (
                <span className="text-[0.68rem] text-muted-foreground">
                  <Busy busy>{null}</Busy>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      <div ref={end} />
    </Sheet>
  );
}
