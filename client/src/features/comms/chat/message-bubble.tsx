/**
 * One message.
 *
 * ── WHAT HANGS OFF A BUBBLE, AND WHY IT IS NOT ALL ALWAYS VISIBLE ─────────
 *
 * Reply, react, star, edit, delete, forward. Six actions on every message would
 * bury the message; all six behind one menu costs two clicks for the two people
 * actually use. So the reaction bar and the reply arrow appear on hover (and on
 * focus — keyboard users are not a second-class path), and the rest live in a
 * menu.
 *
 * ── DELETE IS THE ONE THAT NEEDS A CONFIRM, AND NOT A NATIVE ONE ──────────
 *
 * `useConfirm()`, never `window.confirm`. A native dialog renders in OS chrome
 * titled "app.praxis-ls.com says", which discards the tenant's white-labelling
 * at the exact moment the product is asking someone to destroy something, and
 * it blocks the event loop — which in this very feature would mean a draft
 * autosave landing after the delete. See CLAUDE.md.
 *
 * ── A DELETED MESSAGE STILL OCCUPIES ITS PLACE ────────────────────────────
 *
 * `softDeleteMessage` nulls the body and stamps `deleted_at`; the row stays.
 * The bubble renders "This message was deleted" rather than vanishing, because
 * a conversation where a reply survives and the thing it replied to silently
 * disappears reads as the product having lost it.
 */
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { ReactionBar, ReactionChips } from "@/components/ui/emoji-picker";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/smartcomm-api";
import type { CommMessage, CommAttachment } from "@/lib/smartcomm-api";
import { Attachments } from "./attachments";
import { MessageText } from "./message-text";


function timeShort(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Sent / delivered / read, from the column that has carried it since 0430 and
 *  that nothing ever rendered. Own messages only — ticks on somebody else's
 *  message would be telling them what they already know. */
function DeliveryTicks({ delivery }: { delivery?: string | null }) {
  if (!delivery) return null;
  const read = delivery === "READ";
  const delivered = read || delivery === "DELIVERED";
  return (
    <span
      aria-label={read ? tr("Read") : delivered ? tr("Delivered") : tr("Sent")}
      title={read ? tr("Read") : delivered ? tr("Delivered") : tr("Sent")}
      className={cn("ml-1 text-[11px] leading-none", read ? "text-primary-ink" : "opacity-70")}
    >
      {delivered ? "✓✓" : "✓"}
    </span>
  );
}

export function MessageBubble({
  message,
  mine,
  senderName,
  repliedTo,
  meId,
  onReply,
  onForward,
  onChanged,
  onEdit,
}: {
  message: CommMessage;
  mine: boolean;
  senderName?: string | null;
  /** The message this one replies to, when it is on the same page. */
  repliedTo?: CommMessage | null;
  meId?: string;
  onReply: (m: CommMessage) => void;
  onForward: (m: CommMessage) => void;
  onChanged: () => void;
  onEdit?: (message: CommMessage) => void;
}) {
  const toast = useToast();
  const [confirm, confirmElement] = useConfirm();

  const attachments = message.attachments || [];
  const deleted = !!message.deleted_at;

  async function react(emoji: string) {
    try {
      await api.react(message.message_id, emoji);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e) || tr("Couldn't add that reaction."));
    }
  }

  async function remove() {
    const ok = await confirm({
      title: tr("Delete this message for everyone?"),
      body: tr("It will be replaced by “This message was deleted” in the conversation. Certified exports of this channel keep a record that a message was here."),
      confirmLabel: tr("Delete message"),
      cancelLabel: tr("Keep it"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteMessage(message.message_id);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e) || tr("Couldn't delete that message."));
    }
  }

  async function toggleStar() {
    try {
      await api.star(message.message_id);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e) || tr("Couldn't star that message."));
    }
  }

  async function promote(attachment: CommAttachment) {
    if (!attachment.media_id) return;
    try {
      const res = await api.promoteMedia(attachment.media_id);
      toast.success(res.already ? tr("Already in the vault.") : tr("Saved to the document vault."));
      onChanged();
    } catch (e) {
      toast.error(errMsg(e) || tr("Couldn't save that to the vault."));
    }
  }

  const myReactions = (message.reactions || [])
    .filter((r) => meId && (r.users || []).includes(meId))
    .map((r) => r.emoji);

  return (
    <div className={cn("group relative flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[78%] min-w-0", mine && "flex flex-col items-end")}>
        {/* The hover rail.
            REVEALED BY CSS, not by state. Mouse and keyboard handlers on this
            wrapper would be interaction handlers on a non-interactive element
            (jsx-a11y/no-static-element-interactions), and the workaround — a
            role and a tabindex on every bubble — would put fifty stops in the
            tab order of a conversation. `group-focus-within` gives keyboard
            users the identical affordance for free, and no re-render per hover.
            The rail stays in the DOM; it is eight buttons, and lazy-mounting it
            is what created the accessibility problem in the first place. */}
        {!deleted && (
          <div
            className={cn(
              "mb-1 flex items-center gap-1 opacity-0 transition-opacity",
              "pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto",
              "group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto",
              mine ? "flex-row-reverse" : "flex-row",
            )}
          >
            <ReactionBar onReact={react} mine={myReactions} />
            <button
              type="button"
              onClick={() => onReply(message)}
              aria-label={tr("Reply to this message")}
              title={tr("Reply")}
              className="grid h-7 w-7 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow-[var(--shadow-m)] hover:text-foreground"
            >
              ↩
            </button>
            {/* No `label`: Radix names the menu from its trigger, which carries
                an aria-label. Overriding it here would be the wrong lever —
                see the header of dropdown-menu.tsx. */}
            <DropdownMenu
              trigger={
                <button
                  type="button"
                  aria-label={tr("Message actions")}
                  className="grid h-7 w-7 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow-[var(--shadow-m)] hover:text-foreground"
                >
                  ⋯
                </button>
              }
            >
              <DropdownItem onSelect={() => onReply(message)}>{tr("Reply")}</DropdownItem>
              <DropdownItem onSelect={() => onForward(message)}>{tr("Forward")}</DropdownItem>
              <DropdownItem onSelect={toggleStar}>
                {message.starred_by_me ? tr("Remove star") : tr("Star")}
              </DropdownItem>
              {mine && message.body && onEdit && (
                <>
                  <DropdownSeparator />
                  <DropdownItem onSelect={() => onEdit?.(message)}>
                    {tr("Edit")}
                  </DropdownItem>
                </>
              )}
              {mine && (
                <DropdownItem destructive onSelect={remove}>{tr("Delete")}</DropdownItem>
              )}
            </DropdownMenu>
          </div>
        )}

        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-sm",
            deleted
              ? "border border-dashed border-border bg-transparent text-muted-foreground"
              : mine
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card",
          )}
        >
          {!mine && !deleted && senderName && (
            <div className="mb-0.5 text-[11px] font-medium text-primary-ink">{senderName}</div>
          )}

          {repliedTo && !deleted && (
            <div
              className={cn(
                "mb-1.5 border-l-2 pl-2 text-[11px]",
                mine ? "border-primary-foreground/40 text-primary-foreground/80" : "border-primary text-muted-foreground",
              )}
            >
              <span className="line-clamp-2 break-words">
                {repliedTo.deleted_at
                  ? tr("This message was deleted")
                  : repliedTo.body || tr("(attachment)")}
              </span>
            </div>
          )}

          {deleted ? (
            <span className="italic">{tr("This message was deleted")}</span>
          ) : (
            <>
              {attachments.length > 0 && (
                <div className={cn(message.body && "mb-1.5")}>
                  <Attachments attachments={attachments} onPromote={promote} />
                </div>
              )}
              {message.body && <MessageText body={message.body} />}
            </>
          )}

          {!deleted && (
            <div
              className={cn(
                "mt-0.5 flex items-center justify-end gap-1 text-[10px]",
                mine ? "text-primary-foreground/70" : "text-muted-foreground",
              )}
            >
              {message.starred_by_me && <span aria-label={tr("Starred")} title={tr("Starred")}>★</span>}
              {message.edited_at && <span>{tr("(edited)")}</span>}
              <span>{timeShort(message.created_at)}</span>
              {mine && <DeliveryTicks delivery={message.delivery} />}
            </div>
          )}
        </div>

        {!deleted && (
          <ReactionChips reactions={message.reactions || []} meId={meId} onToggle={react} />
        )}
      </div>
      {confirmElement}
    </div>
  );
}
