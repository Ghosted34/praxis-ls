/**
 * Questions about a shipment — raised against one step of its journey, or the
 * shipment as a whole, and answered in the same thread.
 *
 * Asking is one tap for the questions everybody asks ("When will this be
 * done?") and a sentence for anything else. The question lands with the team
 * running the file (Q tickets, MOD-31), and the reply comes back here.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { portalRaiseTicket, portalTicket, portalReplyTicket, type PortalTicket, type TicketReply, type Milestone } from "@/lib/portal-api";
import { cn } from "@/lib/cn";
import { Sheet, Pill, IconDisc, TextArea, errorText, Busy, useToast, useLoad, Shimmer, type Tone } from "../ui/kit";
import { SendIcon, ChatIcon, CheckCircleIcon, ClockIcon, ChevronRightIcon } from "../ui/icons";
import { dayLabel, timeOf, relDayTitle } from "../lib/when";

const QUICK = ["when", "needMe", "faster"] as const;

export function AskSheet({
  open,
  dossierId,
  step,
  onClose,
  onDone,
  onChat,
}: {
  open: boolean;
  dossierId: string;
  step: Milestone | null;
  onClose: () => void;
  onDone: () => void;
  /** A conversation instead of a question on record: the shipment's chat, tagged with the step. */
  onChat?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [quick, setQuick] = React.useState<(typeof QUICK)[number] | "other" | null>(null);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuick(null);
    setText("");
    setError(null);
  }, [open, step]);

  const body = text.trim();
  const ready = quick === "other" ? body.length > 0 : !!quick;

  async function send() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const subject = quick && quick !== "other" ? t(`portal.ask.quick.${quick}`) : body.slice(0, 120);
    try {
      await portalRaiseTicket({
        dossier_id: dossierId,
        ...(step?.milestone_instance_id ? { milestone_instance_id: step.milestone_instance_id } : {}),
        subject,
        ...(body && quick !== "other" ? { body } : body.length > 120 ? { body } : {}),
      });
      toast(t("portal.ask.sent"));
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={step ? t("portal.ask.aboutStep") : t("portal.ask.title")}
      footer={
        <button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={!ready || busy} onClick={() => void send()}>
          <Busy busy={busy}>
            <SendIcon size={20} />
          </Busy>
          {t("portal.ask.send")}
        </button>
      }
    >
      {step ? (
        <Pill tone="brand" className="mb-4">
          {step.label}
        </Pill>
      ) : null}
      <div className="grid gap-2">
        {[...QUICK, "other" as const].map((k) => (
          <button key={k} type="button" className="pt-chip justify-start" aria-pressed={quick === k} onClick={() => setQuick(k)}>
            {t(`portal.ask.quick.${k}`)}
          </button>
        ))}
      </div>
      {quick ? (
        <TextArea
          className="mt-4"
          label={quick === "other" ? t("portal.ask.yourQuestion") : t("portal.ask.addDetail")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={4000}
          autoFocus={quick === "other"}
        />
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
      {onChat ? (
        <button type="button" className="pt-btn pt-btn-ghost pt-btn-block mt-3" onClick={onChat}>
          <ChatIcon size={20} />
          {t("portal.ask.chatInstead")}
        </button>
      ) : null}
    </Sheet>
  );
}

const TICKET_TONE: Record<PortalTicket["status"], Tone> = { OPEN: "warn", IN_PROGRESS: "info", RESOLVED: "ok" };

export function TicketRow({ tk, onOpen }: { tk: PortalTicket; onOpen: (tk: PortalTicket) => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="pt-row" onClick={() => onOpen(tk)}>
      <IconDisc tone={TICKET_TONE[tk.status]}>{tk.status === "RESOLVED" ? <CheckCircleIcon /> : tk.status === "OPEN" ? <ClockIcon /> : <ChatIcon />}</IconDisc>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.95rem] font-semibold text-foreground">{tk.subject}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Pill tone={TICKET_TONE[tk.status]}>{t(`portal.ask.status.${tk.status}`)}</Pill>
          {tk.milestone_label ? <Pill plain>{tk.milestone_label}</Pill> : null}
          <Pill plain>{relDayTitle(tk.created_at, 6)}</Pill>
        </span>
      </span>
      <ChevronRightIcon size={18} className="text-muted-foreground" />
    </button>
  );
}

/** One question and its answers, with a box to reply. */
export function TicketSheet({ tk, onClose, onChanged }: { tk: PortalTicket | null; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [tick, setTick] = React.useState(0);
  const detail = useLoad(() => (tk ? portalTicket(tk.q_ticket_id) : Promise.resolve(null)), tk ? `tk:${tk.q_ticket_id}:${tick}` : "none");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const end = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setText("");
    setError(null);
  }, [tk]);
  React.useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [detail.data]);

  async function reply() {
    if (!tk || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await portalReplyTicket(tk.q_ticket_id, text.trim());
      setText("");
      setTick((n) => n + 1);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const d = detail.data;
  const thread: { body: string; mine: boolean; at: string; who: string | null }[] = d
    ? [
        { body: [d.ticket.subject, d.ticket.body].filter(Boolean).join("\n\n"), mine: true, at: d.ticket.created_at, who: null },
        ...d.replies.map((r: TicketReply) => ({ body: r.body, mine: r.is_from_client, at: r.created_at, who: r.is_from_client ? null : r.author_label || t("portal.chat.team") })),
      ]
    : [];
  let lastDay = "";

  return (
    <Sheet
      open={!!tk}
      onClose={onClose}
      title={tk?.milestone_label || t("portal.ask.question")}
      wide
      footer={
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void reply();
          }}
        >
          <label htmlFor="pt-tk-reply" className="sr-only">
            {t("portal.ask.reply")}
          </label>
          <textarea
            id="pt-tk-reply"
            rows={1}
            className="pt-field max-h-36 min-h-[48px] flex-1 resize-none !rounded-[24px] !py-3"
            placeholder={t("portal.ask.reply")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="pt-btn pt-btn-primary !h-12 !min-h-0 !w-12 shrink-0 !rounded-full !p-0" disabled={!text.trim() || busy} aria-label={t("portal.chat.send")}>
            <Busy busy={busy}>
              <SendIcon size={20} />
            </Busy>
          </button>
        </form>
      }
    >
      {tk ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Pill tone={TICKET_TONE[tk.status]}>{t(`portal.ask.status.${tk.status}`)}</Pill>
          {tk.dossier_ref ? (
            <Pill plain>
              <span className="pt-mono">{tk.dossier_ref}</span>
            </Pill>
          ) : null}
        </div>
      ) : null}
      {!d && !detail.error ? (
        <div className="grid gap-3 pt-3" aria-hidden="true">
          <Shimmer className="ml-auto h-12 w-3/5" />
          <Shimmer className="h-14 w-2/3" />
        </div>
      ) : null}
      {detail.error ? <p className="mt-3 text-sm text-[rgb(var(--bad))]">{detail.error}</p> : null}
      <ol className="grid gap-1.5 pt-2">
        {thread.map((m, i) => {
          const day = dayLabel(m.at);
          const marker = day !== lastDay ? day : null;
          lastDay = day;
          return (
            <React.Fragment key={i}>
              {marker ? (
                <li className="my-2 flex justify-center" aria-hidden="true">
                  <span className="pt-pill" data-plain>
                    {marker}
                  </span>
                </li>
              ) : null}
              <li className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
                <div className="pt-bubble" data-mine={m.mine || undefined}>
                  {m.who ? <p className="mb-0.5 text-xs font-semibold text-primary-ink">{m.who}</p> : null}
                  <p>{m.body}</p>
                  <p className="pt-num mt-1 text-right text-[0.68rem] text-muted-foreground">{timeOf(m.at)}</p>
                </div>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
      <div ref={end} />
    </Sheet>
  );
}
