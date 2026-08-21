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
import type { Label, MailFolder, MailStream, Message, ThreadDetail } from "@/lib/mail-api";
import { SignatureSlot } from "./composer/signature-slot";
import { WorkRail } from "./work";
import { VerdictBanner, VerdictPill } from "./work/guardrails";
import { Extractions } from "./work/intake";

const Composer = React.lazy(() => import("./composer"));

const MOVE_TO: MailFolder[] = ["INBOX", "ARCHIVE", "SPAM", "TRASH"];

/** PR-0 origin tag → what to actually show a person. */
function originNote(m: Message): string | null {
  if (m.direction !== "OUT") return null;
  const via = String(m.sent_via || "").toUpperCase();
  if (!via || via === "PRAXIS") return null;
  return "Sent from another device";
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
      ? `To ${to.join(", ") || "—"}`
      : `From ${message.from_name ? `${message.from_name} <${message.from_address}>` : message.from_address}`;

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
              {message.direction === "OUT" ? "Sent" : "Received"}
            </Pill>
            <Pill tone="mute">{message.folder}</Pill>
            {origin && <Pill tone="warn">{origin}</Pill>}
            {message.has_attachment && <Pill tone="mute">Attachment</Pill>}
            {/* §9.7. Absent verdict renders nothing — see the type. A green
                tick for "we did not check" would be the worst of the three
                possible outputs. */}
            <VerdictPill verdict={message.auth_verdict} />
          </div>

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
              Cc: <span className="num">{cc.join(", ")}</span>
            </p>
          )}
          {message.body_html ? (
            <div
              className="prose prose-sm max-w-none"
              // Sanitized on ingest — see the file header.
              dangerouslySetInnerHTML={{ __html: message.body_html }}
            />
          ) : (
            <div className="whitespace-pre-wrap text-sm">
              {message.body_text || message.body_preview || "(no content)"}
            </div>
          )}

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
  const [replying, setReplying] = React.useState(false);
  React.useEffect(() => { setReplying(false); }, [thread?.email_thread_id]);

  if (error) return <ErrorState message={error} />;
  if (loading && !thread) return <LoadingRow label="Opening conversation…" />;
  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="max-w-reading text-sm text-muted-foreground">
          Choose a conversation to read it. Everything here is scoped to you —
          what you have read, what you have starred, and the labels you made.
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

  return (
    <div className="flex min-h-0 flex-col">
      <header className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">
            {thread.subject || "(no subject)"}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} className="lg:hidden">
            Close
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
            Filed as a notice: {thread.stream_reason}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onToggleRead(thread.unread_count > 0)}
          >
            {thread.unread_count > 0 ? "Mark read" : "Mark unread"}
          </Button>
          <Select
            aria-label="Move to folder"
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && onMove(e.target.value as MailFolder)}
            className="h-8 w-auto text-xs"
          >
            <option value="">Move to…</option>
            {MOVE_TO.map((f) => (
              <option key={f} value={f}>
                {f.charAt(0) + f.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onStream(thread.stream === "SYSTEM" ? "HUMAN" : "SYSTEM")}
          >
            {thread.stream === "SYSTEM" ? "This is a person" : "This is a notice"}
          </Button>
          {labels.length > 0 && (
            <Select
              aria-label="Add a label"
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && onLabel(e.target.value)}
              className="h-8 w-auto text-xs"
            >
              <option value="">Label…</option>
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
          <React.Suspense fallback={<LoadingRow label="Opening the composer…" />}>
            <Composer
              connectionId={thread.email_connection_id}
              threadId={thread.email_thread_id}
              replyToMessageId={messages[lastIndex]?.email_message_id || null}
              kind="REPLY"
              initialTo={replyTo}
              initialSubject={/^re:/i.test(thread.subject || "") ? thread.subject : `Re: ${thread.subject || ""}`.trim()}
              quotedHtml={messages[lastIndex]?.body_html || null}
              quotedText={messages[lastIndex]?.body_text || null}
              entityRef={thread.entity_ref || null}
              onClose={() => setReplying(false)}
              onSent={onReplied}
              slots={{ "composer.footer.left": <SignatureSlot /> }}
            />
          </React.Suspense>
        ) : (
          <Button size="sm" onClick={() => setReplying(true)}>Reply</Button>
        )}
      </footer>
    </div>
  );
}
