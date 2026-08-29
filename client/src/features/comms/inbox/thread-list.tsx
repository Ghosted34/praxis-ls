/**
 * The conversation list — one row per conversation, not per message.
 *
 * ── WHY A ROW IS A CONVERSATION ─────────────────────────────────────────────
 *
 * Because that is the unit a person works in. "Have we answered Maersk about
 * the demurrage?" is a question about an exchange, not about a message, and a
 * list that shows nine rows for one exchange makes the operator do the
 * reconstruction the software should have done. `unread_count` and `is_starred`
 * on the row are the CALLER's, so this list looks different for two people
 * reading the same shared mailbox — as it must.
 *
 * ── SELECTION IS A SET, AND BULK ACTIONS REPORT THEIR FAILURES ──────────────
 *
 * Selecting forty conversations and archiving them is one request. The server
 * applies them one at a time and returns which failed, and this surfaces that
 * rather than showing a success toast over a partial result — an archive that
 * silently dropped two is worse than one that says which two.
 */
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { fmtRelative } from "@/lib/format";
import { tr } from "@/lib/i18n";
import type { BulkOp, MailFolder, Thread } from "@/lib/mail-api";

/** The star, as a button rather than an icon with a click handler on a span. */
function Star({
  on,
  onToggle,
  subject,
}: {
  on: boolean;
  onToggle: () => void;
  subject: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `${tr("Unstar")} ${subject}` : `${tr("Star")} ${subject}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "shrink-0 rounded p-0.5 text-base leading-none transition-colors",
        on ? "text-warning" : "text-muted-foreground/40 hover:text-muted-foreground",
      )}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

/**
 * Who the conversation is with — everyone except our own mailbox.
 *
 * Showing the mailbox's own address in its own thread list is noise: the user
 * knows which mailbox they are reading. When we are genuinely the only
 * participant (a note to self, a bounce), fall back to showing it rather than
 * rendering an empty cell that looks like a bug.
 */
function counterparties(t: Thread): string {
  const mine = String(t.mailbox_address || "").toLowerCase();
  // `Array.isArray`, not `|| []`. A non-array truthy value — which is exactly
  // what an uncast citext[] column sent — passes `|| []` and then throws on
  // `.filter`, and that one throw took down the whole Mailbox screen. The API
  // layer normalises this now; the guard stays because a row renderer should
  // never be the thing that costs somebody their workspace.
  const all = Array.isArray(t.participants) ? t.participants : [];
  const others = all.filter((p) => p !== mine);
  const list = others.length ? others : all;
  if (!list.length) return t.last_from || "—";
  const names = list.map((a) => a.split("@")[0]);
  return names.length <= 2
    ? names.join(", ")
    : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

export function ThreadRow({
  thread,
  selected,
  active,
  onOpen,
  onSelect,
  onStar,
}: {
  thread: Thread;
  selected: boolean;
  active: boolean;
  onOpen: () => void;
  onSelect: (on: boolean) => void;
  onStar: (on: boolean) => void;
}) {
  const unread = thread.unread_count > 0;
  const subject = thread.subject || tr("(no subject)");
  return (
    <li>
      <div
        className={cn(
          "flex items-start gap-2 border-b border-border px-3 py-2.5 transition-colors",
          active ? "bg-primary/10" : "hover:bg-muted/60",
        )}
      >
        <div className="pt-0.5">
          <Checkbox
            checked={selected}
            onCheckedChange={onSelect}
            label={<span className="sr-only">{tr("Select")} {subject}</span>}
          />
        </div>
        <Star on={thread.is_starred} onToggle={() => onStar(!thread.is_starred)} subject={subject} />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
          aria-current={active ? "true" : undefined}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                "truncate text-sm",
                unread ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {counterparties(thread)}
            </span>
            <span className="num shrink-0 text-xs text-muted-foreground">
              {fmtRelative(thread.last_message_at)}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "truncate text-sm",
                unread ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {subject}
            </span>
            {thread.message_count > 1 && (
              <span className="num shrink-0 text-xs text-muted-foreground">
                {thread.message_count}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {thread.preview || "—"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {thread.is_vip && <Pill tone="warn">VIP</Pill>}
            {thread.has_attachment && <Pill tone="mute">{tr("Attachment")}</Pill>}
            {thread.entity_ref && <Pill tone="blue">{thread.entity_ref}</Pill>}
            {/* The classifier's reason on hover: a verdict a person cannot
                interrogate is one they will not trust. */}
            {thread.stream === "SYSTEM" && (
              <span title={thread.stream_reason || undefined}>
                <Pill tone="mute">{tr("Notice")}</Pill>
              </span>
            )}
          </div>
        </button>
      </div>
    </li>
  );
}

const BULK: { op: BulkOp; label: string; folder?: MailFolder }[] = [
  { op: "read", label: "Mark read" },
  { op: "unread", label: "Mark unread" },
  { op: "move", label: "Archive", folder: "ARCHIVE" },
  { op: "move", label: "Spam", folder: "SPAM" },
  { op: "move", label: "Trash", folder: "TRASH" },
];

/**
 * Permanent deletion, offered only where deletion is what the person means.
 *
 * Everywhere else "Trash" is the destructive verb and it is reversible. In
 * Trash and Spam it is not available — moving a conversation from Trash to
 * Trash is a no-op — and "delete it properly" is the only thing left to want.
 * Restricting it to those two also matches the server: `emptyFolder`'s
 * allow-list is TRASH and SPAM by name.
 */
const DELETABLE = new Set<MailFolder>(["TRASH", "SPAM"]);

export function ThreadList({
  threads,
  loading,
  error,
  activeId,
  selected,
  onSelectedChange,
  onOpen,
  onStar,
  onBulk,
  folder,
  onEmptyFolder,
  bulkBusy,
  bulkFailures,
  onLoadMore,
  hasMore,
  emptyHint,
}: {
  threads: Thread[];
  loading: boolean;
  error?: string | null;
  activeId?: string | null;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onOpen: (t: Thread) => void;
  onStar: (t: Thread, on: boolean) => void;
  onBulk: (op: BulkOp, folder?: MailFolder) => void;
  /** Which folder is being listed — decides whether deletion is offered. */
  folder?: MailFolder;
  /** Empty the whole of Trash or Spam. Absent = not offered. */
  onEmptyFolder?: () => void;
  bulkBusy: boolean;
  bulkFailures: { email_thread_id: string; error: string }[];
  onLoadMore: () => void;
  hasMore: boolean;
  emptyHint: string;
}) {
  const allSelected = threads.length > 0 && selected.size === threads.length;
  const toggleAll = (on: boolean) =>
    onSelectedChange(on ? new Set(threads.map((t) => t.email_thread_id)) : new Set());
  const toggleOne = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelectedChange(next);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Checkbox
          checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
          onCheckedChange={toggleAll}
          label={<span className="sr-only">{tr("Select all conversations")}</span>}
        />
        {selected.size > 0 ? (
          <>
            <span className="num text-xs text-muted-foreground">
              {selected.size} {tr("selected")}
            </span>
            {BULK
              // "Move to Trash" while reading Trash is a no-op dressed as an
              // action; the same for Spam.
              .filter((b) => !(b.op === "move" && b.folder === folder))
              .map((b) => (
                <Button
                  key={b.label}
                  size="sm"
                  variant="outline"
                  disabled={bulkBusy}
                  onClick={() => onBulk(b.op, b.folder)}
                >
                  {tr(b.label)}
                </Button>
              ))}
            {folder && DELETABLE.has(folder) && (
              <Button
                size="sm"
                variant="outline"
                disabled={bulkBusy}
                onClick={() => onBulk("delete")}
              >
                {tr("Delete for ever")}
              </Button>
            )}
          </>
        ) : (
          <>
            <span className="num text-xs text-muted-foreground">
              {threads.length}
              {hasMore ? "+" : ""} {threads.length === 1 ? tr("conversation") : tr("conversations")}
            </span>
            {/* The "Empty Trash" the product did not have — `thread.service`'s
                own words for the endpoint it shipped without a screen. */}
            {onEmptyFolder && folder && DELETABLE.has(folder) && threads.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={bulkBusy}
                onClick={onEmptyFolder}
              >
                {folder === "TRASH" ? tr("Empty the bin") : tr("Empty spam")}
              </Button>
            )}
          </>
        )}
      </div>

      {/* A partial bulk result is stated, not swallowed. */}
      {bulkFailures.length > 0 && (
        <div
          role="status"
          className="border-b border-border bg-warning/10 px-3 py-2 text-xs text-foreground"
        >
          {bulkFailures.length} {bulkFailures.length === 1 ? tr("conversation") : tr("conversations")}{" "}
          {tr("could not be updated:")} {bulkFailures.map((f) => f.error).join("; ")}
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {threads.map((t) => (
          <ThreadRow
            key={t.email_thread_id}
            thread={t}
            selected={selected.has(t.email_thread_id)}
            active={activeId === t.email_thread_id}
            onOpen={() => onOpen(t)}
            onSelect={(on) => toggleOne(t.email_thread_id, on)}
            onStar={(on) => onStar(t, on)}
          />
        ))}
        {loading && <LoadingRow label={tr("Loading conversations…")} />}
        {!loading && !error && threads.length === 0 && (
          <li className="p-4">
            <EmptyState title={tr("Nothing here")} hint={emptyHint} />
          </li>
        )}
        {hasMore && !loading && (
          <li className="p-3 text-center">
            <Button size="sm" variant="outline" onClick={onLoadMore}>
              {tr("Load older")}
            </Button>
          </li>
        )}
      </ul>
    </div>
  );
}
