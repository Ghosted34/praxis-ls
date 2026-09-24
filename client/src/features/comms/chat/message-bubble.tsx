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
import * as React from "react";
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
import { LinkCards } from "./link-card";
import type { LinkPreview } from "@/lib/smartcomm-api";


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
  /** This tenant's cached previews for the URLs in this message. */
  links,
  /** Touch only: whether this bubble's action rail is currently shown. */
  revealed = false,
  onToggleReveal,
  onReacted,
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
  links?: Record<string, LinkPreview>;
  revealed?: boolean;
  onToggleReveal?: () => void;
  onReacted?: () => void;
}) {
  const toast = useToast();
  const [confirm, confirmElement] = useConfirm();

  const attachments = message.attachments || [];
  const deleted = !!message.deleted_at;

  async function react(emoji: string) {
    try {
      await api.react(message.message_id, emoji);
      onChanged();
      // A reaction was the thing the rail existed for. On a phone it then gets
      // out of the way, rather than sitting over the next message the reader is
      // already reaching for.
      onReacted?.();
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

  /**
   * Tap the message to get its actions, on a device with no hover.
   *
   * WHY `onPointerDown`/`onPointerUp` AND NOT `onClick`. Not to dodge a lint
   * rule — to describe the real gesture. `no-static-element-interactions` and
   * `click-events-have-key-events` are right about a `<div onClick>`: a click a
   * keyboard cannot produce is an affordance with half a user in it. Here the
   * other half of every gesture is already covered by CSS — hover on a mouse,
   * `group-focus-within` on a keyboard — and this handler exists only for the
   * finger, which has no hover to wait for. A pointer pair is also the only way
   * to tell a TAP from a SCROLL: a `click` on a bubble fires after a flick that
   * started on it in some browsers, which would mean an action rail appearing on
   * every message a reader swipes past. The 12px and the button check below are
   * what make the gesture mean "I meant this message".
   *
   * One rail at a time is not this component's business — `team-chat.tsx` owns
   * which message is open, so fifty bubbles cannot all be revealed at once.
   */
  const press = React.useRef<{ x: number; y: number } | null>(null);
  function onPointerDown(event: React.PointerEvent) {
    if (!onToggleReveal) return;
    // An ALLOWLIST of pointer types, not a check for `=== "mouse"`: a synthetic or
    // oddly-sourced event with no pointer type must not open anything, and the
    // promise this component makes is that it only ever answers a finger.
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    press.current = { x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event: React.PointerEvent) {
    const start = press.current;
    press.current = null;
    if (!start || !onToggleReveal) return;
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;
    // A tap that landed on something already actionable belongs to that thing.
    // Without this, tapping a link or an already-visible reaction button would
    // also toggle the rail, and on a phone "close the rail" and "open the link"
    // would be the same tap — which reads as the link being broken.
    const el = event.target as HTMLElement | null;
    if (el?.closest?.("a,button,input,textarea,select,[role='button'],[role='menuitem']")) return;
    onToggleReveal();
  }

  return (
    <div
      data-message-bubble
      /**
       * The reveal state, readable from the DOM rather than by parsing a Tailwind
       * class string. The same reason the composer marks a chip with
       * `[data-mention-id]`: when a visual state is the entire behaviour, a test
       * that has to match `opacity-0 group-hover:opacity-100 …` breaks on a
       * cosmetic edit, and a reader who cannot see the rail has no way to tell
       * whether it is hidden or simply empty.
       */
      data-revealed={revealed ? "true" : undefined}
      // `animate-rise-in` is a 0.2s soft slide+fade, once, on mount. The list is
      // keyed by message_id, so a poll that returns the same messages does not
      // remount them and only a genuinely NEW message animates in. Reduced-motion
      // is honoured by the global kill in index.css.
      className={cn("group relative flex animate-rise-in", mine ? "justify-end" : "justify-start")}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        press.current = null;
      }}
    >
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
              "group-hover:opacity-100 group-focus-within:opacity-100",
              // On a touch device the rail is NOT permanently visible. It used to
              // be — `[@media(hover:none)]:opacity-100` — because hiding it behind
              // a hover that a finger cannot produce left reactions unreachable.
              // The fix for an unreachable control is a reachable gesture, not a
              // permanent strip of six emoji over every message in the thread;
              // `revealed` is that gesture, and the space stays reserved so
              // revealing it never shifts the bubble under the reader's finger.
              revealed && "opacity-100 pointer-events-auto",
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
            // The finish (tint, tail, ambient shadow) lives on the .msg-bubble
            // classes in index.css so the accent tint can be a color-mix of the
            // TENANT's --primary over the theme's base; the spacing stays here.
            "text-sm",
            deleted
              ? "msg-bubble msg-bubble--deleted px-3.5 py-2.5"
              : mine
                ? "msg-bubble msg-bubble--mine px-3.5 py-2.5"
                : "msg-bubble msg-bubble--theirs px-3.5 py-2.5",
          )}
        >
          {!mine && !deleted && senderName && (
            <div className="mb-0.5 text-[11px] font-semibold text-primary-ink">{senderName}</div>
          )}

          {repliedTo && !deleted && (
            <div
              className={cn(
                // Both bubbles are now tinted SURFACES (not a solid accent fill),
                // so the quote uses the accent bar + muted text in either case.
                "mb-1.5 rounded-md border-l-2 border-primary/60 bg-primary/10 py-1 pl-2 pr-2 text-[11px] text-muted-foreground",
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
                  <Attachments
                    attachments={attachments}
                    onPromote={promote}
                    // Both bubbles are now a tint of the accent over the theme's
                    // base surface (see .msg-bubble--mine/--theirs), so children
                    // read on a SURFACE in both cases — which also retires the old
                    // "--muted-foreground on solid --primary is 1.01:1 in dark"
                    // hazard that the `tone` split was invented for.
                    tone="surface"
                  />
                </div>
              )}
              {/* mine={false}: the ground is a tinted surface, not a solid accent
                  fill, so text and links take the surface (primary-ink) styling. */}
              {message.body && <MessageText body={message.body} mine={false} />}
              {message.link_urls?.length ? (
                <LinkCards urls={message.link_urls} links={links} tone="surface" />
              ) : null}
            </>
          )}

          {!deleted && (
            <div
              className={cn(
                "mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground",
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
