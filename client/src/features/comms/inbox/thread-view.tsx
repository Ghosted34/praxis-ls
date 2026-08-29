/**
 * One conversation, opened: every message in order, oldest first.
 *
 * ── OLDEST FIRST, AND THE LAST ONE EXPANDED ─────────────────────────────────
 *
 * A conversation is read the way it happened. Collapsing everything but the
 * latest message is the convention every mail client settled on for the same
 * reason: the thing you came for is almost always the newest thing, and the
 * history is context you want available rather than in your way.
 *
 * ── THE ORIGIN TAG IS SHOWN, NOT HIDDEN ─────────────────────────────────────
 *
 * PR-0 stamps every outbound message with where it was sent from, so a reply a
 * colleague typed on their phone appears here labelled as such. That answers
 * "did anyone reply to this?" without anyone having to ask in chat — which was
 * the actual request behind the whole origin-tagging design.
 *
 * ── HTML BODIES ARE SANITIZED ON INGEST, NOT HERE ───────────────────────────
 *
 * `mail.service.cleanHtml` runs once when the message is stored, so what is in
 * the database is already safe. Sanitizing again on every render would be
 * cheaper to argue for and slower to run; the invariant to protect is that
 * NOTHING reaches `email_message.body_html` without passing the ingest filter.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/modal";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { dateTimeFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import type { Attachment, Label, MailFolder, MailStream, Message, ThreadDetail } from "@/lib/mail-api";
import { downloadAttachment, listMsgAttachments } from "@/lib/mail-api";
import { SignatureSlot } from "./composer/signature-slot";
import { WorkRail } from "./work";
import { VerdictBanner, VerdictPill } from "./work/guardrails";
import { Extractions } from "./work/intake";
import {
  blockRemoteContent,
  restoreRemoteContent,
  splitQuotedHtml,
  splitQuotedText,
} from "./message-body";

const Composer = React.lazy(() => import("./composer"));

const MOVE_TO: MailFolder[] = ["INBOX", "ARCHIVE", "SPAM", "TRASH"];

/** PR-0 origin tag → what to actually show a person. */
function originNote(m: Message): string | null {
  if (m.direction !== "OUT") return null;
  const via = String(m.sent_via || "").toUpperCase();
  if (!via || via === "PRAXIS") return null;
  return tr("Sent from another device");
}

/** Bytes → the shortest honest string. Attachment sizes are the one number in
 *  this pane a person compares at a glance ("is that the 12 MB scan?"). */
function sizeLabel(bytes?: number | null): string {
  const n = Number(bytes || 0);
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The attachment strip (audit H-2).
 *
 * Before this, `has_attachment` rendered a pill reading "Attachment" and that
 * was the entire feature: the product could tell you a bill of lading had
 * arrived and could not show it to you. Acceptance criterion 8 was half met —
 * storage and hashing yes, retrieval no.
 *
 * Fetched lazily, per message, only when the message is expanded and only when
 * it actually has one. A thread of forty messages must not fire forty requests
 * to draw a pane where thirty-nine of them are collapsed.
 *
 * A failure renders as a readable line rather than an empty space, because the
 * empty space is indistinguishable from "this message has no attachments" —
 * and that is the state the user has already been living with.
 */
function AttachmentStrip({ messageId }: { messageId: string }) {
  const [rows, setRows] = React.useState<Attachment[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    listMsgAttachments(messageId)
      .then((r) => { if (live) setRows(r || []); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [messageId]);

  if (failed) {
    return (
      <p className="text-xs text-muted-foreground">
        {tr("Could not load the attachments on this message.")}
      </p>
    );
  }
  if (!rows) return <LoadingRow />;
  if (!rows.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((a) => {
        const size = sizeLabel(a.size_bytes);
        return (
          <Button
            key={a.email_attachment_id}
            size="sm"
            variant="outline"
            disabled={busy === a.email_attachment_id}
            onClick={() => {
              setBusy(a.email_attachment_id);
              downloadAttachment(a.email_attachment_id, a.filename)
                .catch(() => setFailed(true))
                .finally(() => setBusy(null));
            }}
          >
            <span className="truncate max-w-[16rem]">{a.filename || tr("Attachment")}</span>
            {size && <span className="num ml-1.5 text-xs text-muted-foreground">{size}</span>}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * The message itself: images held back, history folded.
 *
 * ── WHY BOTH DECISIONS LIVE IN ONE COMPONENT ────────────────────────────────
 *
 * They are the same decision seen twice — "do not render everything this
 * message would like you to render until the reader has asked". §5.6.3
 * specifies both, and neither existed: the pane handed `body_html` straight to
 * `dangerouslySetInnerHTML`, so every tracking pixel in every supplier footer
 * fired on open, and a ten-message thread rendered the previous nine inside the
 * tenth.
 *
 * ── THE STATE IS PER MESSAGE, AND DELIBERATELY NOT REMEMBERED ───────────────
 *
 * §5.6.3 offers a per-sender "always show" stored per user. That is a
 * preference table and a settings surface; this is the control it would sit on
 * top of, and it is the half that stops the pixels. Showing images is one click
 * per message until that lands, which is the same trade Gmail shipped for
 * years. What must not happen is the reverse — a remembered "always show" with
 * no way to see or withdraw it — so the persistence waits for the screen that
 * can show what has been allowed.
 *
 * Sanitized on ingest (see the file header); this is privacy, not safety.
 */
function MessageBody({ message }: { message: Message }) {
  const [showImages, setShowImages] = React.useState(false);
  const [showQuote, setShowQuote] = React.useState(false);

  const html = message.body_html || "";
  const parts = React.useMemo(
    () => (html ? splitQuotedHtml(html) : splitQuotedText(message.body_text || "")),
    [html, message.body_text],
  );
  const scan = React.useMemo(
    () => (html ? blockRemoteContent(parts.visible) : { html: parts.visible, blocked: 0 }),
    [html, parts.visible],
  );
  const quoteScan = React.useMemo(
    () => (html && parts.quoted ? blockRemoteContent(parts.quoted) : { html: parts.quoted || "", blocked: 0 }),
    [html, parts.quoted],
  );

  const blocked = scan.blocked + quoteScan.blocked;
  const render = (frag: { html: string; blocked: number }) =>
    showImages ? restoreRemoteContent(frag.html) : frag.html;

  return (
    <div className="space-y-2">
      {blocked > 0 && !showImages && (
        // Named and counted. "Images blocked" with no number reads as a setting;
        // "3 images" reads as a message that has something in it.
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          <span>
            {blocked === 1
              ? tr("One image was not loaded — remote images can tell the sender when you opened this.")
              : `${blocked} ${tr("images were not loaded — remote images can tell the sender when you opened this.")}`}
          </span>
          <button
            type="button"
            onClick={() => setShowImages(true)}
            className="font-medium text-foreground underline underline-offset-2"
          >
            {tr("Show images")}
          </button>
        </div>
      )}

      {html ? (
        <div
          className="prose prose-sm max-w-none"
          // Sanitized on ingest — see the file header.
          dangerouslySetInnerHTML={{ __html: render(scan) }}
        />
      ) : (
        <div className="whitespace-pre-wrap text-sm">
          {parts.visible || message.body_preview || tr("(no content)")}
        </div>
      )}

      {parts.quoted && (
        <div>
          {/* The ellipsis every mail client uses, because everybody already
              knows what it means. Folded, never dropped: this is the record of
              who said what, and it stays one click away. */}
          <button
            type="button"
            onClick={() => setShowQuote((v) => !v)}
            aria-expanded={showQuote}
            className="rounded border border-border px-2 py-0.5 text-xs leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
            title={showQuote ? tr("Hide the earlier messages") : tr("Show the earlier messages")}
          >
            {showQuote ? tr("Hide earlier messages") : "···"}
          </button>
          {showQuote && (
            html ? (
              <div
                className="prose prose-sm mt-2 max-w-none border-l-2 border-border pl-3 text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: render(quoteScan) }}
              />
            ) : (
              <div className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm text-muted-foreground">
                {parts.quoted}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function MessageBlock({
  message,
  defaultOpen,
}: {
  message: Message;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const origin = originNote(message);
  // Same reasoning as counterparties() in thread-list: guard the shape rather
  // than trust it, because the cost of being wrong here is the whole screen.
  const to = Array.isArray(message.to_address) ? message.to_address : [];
  const cc = Array.isArray(message.cc_address) ? message.cc_address : [];
  const who =
    message.direction === "OUT"
      ? `${tr("To")} ${to.join(", ") || "—"}`
      : `${tr("From")} ${message.from_name ? `${message.from_name} <${message.from_address}>` : message.from_address}`;

  return (
    <article
      className={cn(
        "rounded-lg border border-border",
        message.is_read ? "bg-card/40" : "bg-card",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{who}</span>
          {!open && (
            <span className="block truncate text-xs text-muted-foreground">
              {message.body_preview || "—"}
            </span>
          )}
        </span>
        <span className="num shrink-0 text-xs text-muted-foreground">
          {dateTimeFmt(message.received_at)}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={message.direction === "OUT" ? "blue" : "mute"}>
              {message.direction === "OUT" ? tr("Sent") : tr("Received")}
            </Pill>
            <Pill tone="mute">{message.folder}</Pill>
            {origin && <Pill tone="warn">{origin}</Pill>}
            {/* The pill stays as the at-a-glance marker; the strip below is the
                part that was missing (H-2). */}
            {message.has_attachment && <Pill tone="mute">{tr("Attachment")}</Pill>}
            {/* §9.7. Absent verdict renders nothing — see the type. A green
                tick for "we did not check" would be the worst of the three
                possible outputs. */}
            <VerdictPill verdict={message.auth_verdict} />
          </div>

          {message.has_attachment && (
            <AttachmentStrip messageId={message.email_message_id} />
          )}

          <VerdictBanner
            verdict={message.auth_verdict}
            detail={
              typeof message.auth_detail?.reason === "string"
                ? message.auth_detail.reason
                : null
            }
          />
          {cc.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {tr("Cc")}: <span className="num">{cc.join(", ")}</span>
            </p>
          )}
          <MessageBody message={message} />

          {/* §8.6 — whatever was read off this message's attachments, staged
              and awaiting a person. Renders nothing when there is nothing. */}
          {message.has_attachment && (
            <Extractions messageId={message.email_message_id} />
          )}
        </div>
      )}
    </article>
  );
}

export function ThreadView({
  thread,
  loading,
  error,
  labels,
  onMove,
  onStream,
  onLabel,
  onToggleRead,
  onDelete,
  onClose,
  onReplied,
  onWorkChanged,
  busy,
}: {
  thread: ThreadDetail | null;
  loading: boolean;
  error?: string | null;
  labels: Label[];
  onMove: (folder: MailFolder) => void;
  onStream: (stream: MailStream) => void;
  onLabel: (labelId: string) => void;
  onToggleRead: (read: boolean) => void;
  /**
   * Delete this conversation for ever. Absent = not offered.
   *
   * Only supplied while reading Trash or Spam, where "move to Trash" is a
   * no-op and permanent deletion is the only remaining thing to want. The
   * server is retention-aware — anything sealed into `email_archive` is kept
   * and counted — so the caller reports what actually happened rather than
   * assuming a success.
   */
  onDelete?: () => void;
  onClose: () => void;
  /** Called once a reply is accepted into the send queue, so the list refreshes. */
  onReplied?: () => void;
  /**
   * Anything in the work rail changed the thread — a binding, a claim, a
   * status, a visibility. Reloads the thread AND the list, because most of
   * these are visible in both and a rail that updated only its own half would
   * leave the list showing the previous assignee.
   */
  onWorkChanged?: () => void;
  busy: boolean;
}) {
  // Declared before the early returns below, because hooks cannot be conditional.
  const [replying, setReplying] = React.useState<null | "REPLY" | "REPLY_ALL" | "FORWARD">(null);
  React.useEffect(() => { setReplying(null); }, [thread?.email_thread_id]);

  if (error) return <ErrorState message={error} />;
  if (loading && !thread) return <LoadingRow label={tr("Opening conversation…")} />;
  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="max-w-reading text-sm text-muted-foreground">
          {tr("Choose a conversation to read it. Everything here is scoped to you — what you have read, what you have starred, and the labels you made.")}
        </p>
      </div>
    );
  }

  const messages = thread.messages || [];
  const lastIndex = messages.length - 1;

  // Who a reply goes to: the last INBOUND sender, not simply the last message.
  // Replying to your own last message would address the mail to yourself.
  const lastInbound = [...messages].reverse().find((m) => m.direction === "IN");
  const replyTo = lastInbound ? [lastInbound.from_address] : (messages[lastIndex]?.to_address || []);

  /* ── REPLY ALL, and the one address it must never carry ───────────────────
   *
   * Everyone who was on the last inbound message, minus the people already in
   * To, and minus OUR OWN MAILBOX. Leaving ourselves in the Cc of our own reply
   * is the classic reply-all defect: every answer lands back in the inbox it
   * was sent from, the thread doubles, and the unread count is permanently
   * wrong. `mailbox_address` is the one address on the thread that is
   * definitionally us.
   *
   * Compared lower-cased because an address is case-insensitive in its domain
   * and, in practice, everywhere — a Cc reading `Ops@maersk.com` beside a To of
   * `ops@maersk.com` is one recipient, not two, and sending to both is how a
   * counterparty gets the same mail twice.
   */
  const mine = String(thread.mailbox_address || "").toLowerCase();
  const source = lastInbound || messages[lastIndex] || null;
  const replyAllCc = (() => {
    const seen = new Set([mine, ...replyTo.map((a) => a.toLowerCase())]);
    const out: string[] = [];
    for (const a of [
      ...(Array.isArray(source?.to_address) ? source.to_address : []),
      ...(Array.isArray(source?.cc_address) ? source.cc_address : []),
    ]) {
      const k = String(a).toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
    return out;
  })();

  /* A FORWARD carries the message, not the conversation's recipients: the whole
   * point is that it goes to somebody who was not on it. So To starts empty and
   * the operator types who — and the quoted body below is what they are
   * actually sending. Prefixing Fwd: only when it is not already there keeps a
   * twice-forwarded subject from reading "Fwd: Fwd: Fwd:". */
  const subj = thread.subject || "";
  const replySubject = /^re:/i.test(subj) ? subj : `Re: ${subj}`.trim();
  const forwardSubject = /^fwd?:/i.test(subj) ? subj : `Fwd: ${subj}`.trim();

  return (
    <div className="flex min-h-0 flex-col">
      <header className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">
            {thread.subject || tr("(no subject)")}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} className="lg:hidden">
            {tr("Close")}
          </Button>
        </div>
        <p className="num text-xs text-muted-foreground">
          {(Array.isArray(thread.participants) ? thread.participants : []).join(", ")}
        </p>

        {/* WHY the classifier put this here, in words, next to the control that
            overrides it. A verdict without a reason is one people learn to
            distrust; a reason without a way to correct it is worse. */}
        {thread.stream === "SYSTEM" && thread.stream_reason && (
          <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            {tr("Filed as a notice:")} {thread.stream_reason}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onToggleRead(thread.unread_count > 0)}
          >
            {thread.unread_count > 0 ? tr("Mark read") : tr("Mark unread")}
          </Button>
          <Select
            aria-label={tr("Move to folder")}
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && onMove(e.target.value as MailFolder)}
            className="h-8 w-auto text-xs"
          >
            <option value="">{tr("Move to…")}</option>
            {MOVE_TO.map((f) => (
              <option key={f} value={f}>
                {tr(f.charAt(0) + f.slice(1).toLowerCase())}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onStream(thread.stream === "SYSTEM" ? "HUMAN" : "SYSTEM")}
          >
            {thread.stream === "SYSTEM" ? tr("This is a person") : tr("This is a notice")}
          </Button>
          {onDelete && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onDelete}>
              {tr("Delete for ever")}
            </Button>
          )}
          {labels.length > 0 && (
            <Select
              aria-label={tr("Add a label")}
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && onLabel(e.target.value)}
              className="h-8 w-auto text-xs"
            >
              <option value="">{tr("Label…")}</option>
              {labels.map((l) => (
                <option key={l.email_label_id} value={l.email_label_id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
          {thread.entity_ref && <Pill tone="blue">{thread.entity_ref}</Pill>}
        </div>
      </header>

      {/* The conversation and the work rail, side by side on a wide screen and
          stacked below one. The rail is second in the DOM so a keyboard or
          screen-reader user reaches the correspondence first — it is what they
          opened the thread for. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {messages.map((m, i) => (
            <MessageBlock
              key={m.email_message_id}
              message={m}
              defaultOpen={i === lastIndex}
            />
          ))}
        </div>
        <div className="min-h-0 shrink-0 xl:w-[22rem]">
          <WorkRail thread={thread} onChanged={onWorkChanged || (() => {})} />
        </div>
      </div>

      {/* The composer, when the reader opens it. Lazily: TipTap and ProseMirror
          are ~150 kB gzipped and most of the time somebody is reading, not
          writing — see the isEditorPackage note in vite.config.ts. */}
      <footer className="border-t border-border px-4 py-3">
        {replying ? (
          <React.Suspense fallback={<LoadingRow label={tr("Opening the composer…")} />}>
            <Composer
              // Remounted when the mode changes, so switching from Reply to
              // Reply all actually re-seeds the recipients. `initialTo` is read
              // once, on mount — without the key, the second choice would open
              // the first choice's composer and quietly lose the Cc.
              key={replying}
              connectionId={thread.email_connection_id}
              threadId={thread.email_thread_id}
              replyToMessageId={messages[lastIndex]?.email_message_id || null}
              kind={replying}
              initialTo={replying === "FORWARD" ? [] : replyTo}
              initialCc={replying === "REPLY_ALL" ? replyAllCc : []}
              initialSubject={replying === "FORWARD" ? forwardSubject : replySubject}
              quotedHtml={messages[lastIndex]?.body_html || null}
              quotedText={messages[lastIndex]?.body_text || null}
              entityRef={thread.entity_ref || null}
              onClose={() => setReplying(null)}
              onSent={onReplied}
              slots={{ "composer.footer.left": <SignatureSlot /> }}
            />
          </React.Suspense>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setReplying("REPLY")}>{tr("Reply")}</Button>
            {/* Offered only when there IS somebody else on it. A "Reply all"
                that produces the same message as "Reply" is a button that
                teaches people the two are interchangeable — and then they use
                it on the thread where they are not. */}
            {replyAllCc.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReplying("REPLY_ALL")}
                title={`${tr("Also copies")} ${replyAllCc.join(", ")}`}
              >
                {`${tr("Reply all")} (${replyAllCc.length + replyTo.length})`}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setReplying("FORWARD")}>
              {tr("Forward")}
            </Button>
          </div>
        )}
      </footer>
    </div>
  );
}
