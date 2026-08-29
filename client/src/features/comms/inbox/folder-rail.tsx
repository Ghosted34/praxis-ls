/**
 * The left rail: mailbox picker, the two streams, folders, labels.
 *
 * ── WHY THE STREAM SPLIT IS AT THE TOP, ABOVE THE FOLDERS ───────────────────
 *
 * Because it is the thing that makes the inbox usable at all. A logistics
 * mailbox receives more machine mail than human mail — carrier notices, cPanel
 * backups, tracking updates, delivery reports — and burying a client's question
 * three screens down is how correspondence gets missed. The split is a triage
 * decision, not a folder, so it sits where triage decisions belong: first.
 *
 * ── EVERY COUNT HERE IS THE CALLER'S OWN ────────────────────────────────────
 *
 * `unread_count` comes from `email_message_state` keyed on (message, user).
 * Marie and Paul both work billing@ and see different numbers from the same
 * messages. If a count in this rail ever matches for two different people
 * looking at the same shared mailbox, something has regressed to a column on
 * the message.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Pill } from "@/components/ui/pill";
import { Field, Select } from "@/components/ui/modal";
import { tr } from "@/lib/i18n";
import type { Folder, Label, MailFolder, MailStream, Mailbox } from "@/lib/mail-api";

export type RailSelection = {
  connectionId?: string;
  folder: MailFolder;
  stream?: MailStream;
  label?: string;
  /**
   * The four saved views (§5.6 "VIP filter").
   *
   * `listThreads` has accepted `starred`, `unread`, `vip` and `has_attachment`
   * since PR-1A — the repo builds a predicate for each, `thread.service` parses
   * each, and `ThreadQuery` in mail-api.ts declares all four. Nothing offered
   * them. The consequences were not symmetric:
   *
   *   STARRED     the list draws a star on every row and stars flip
   *               optimistically, so people used them — and then had no way to
   *               ever see what they had starred. A one-way marker.
   *   VIP         `thread.repo` already orders `is_vip DESC` and the row draws a
   *               VIP pill, but the LANE the chapter specifies, where you look
   *               at the VIPs and nothing else, did not exist.
   *   UNREAD      the obvious triage move in any mail client.
   *   ATTACHMENT  "the bill of lading came in last week" is an attachment
   *               search, and it was a scroll.
   */
  view?: "STARRED" | "UNREAD" | "VIP" | "ATTACHMENT";
  /**
   * The two lists that are not conversations: mail that has not gone anywhere.
   *
   * DRAFTS   The composer's own saved drafts (`email_draft`), which is where a
   *          draft written HERE actually lives. The canonical DRAFTS folder
   *          below is the mail server's, and Q11 settled that we do no provider
   *          draft sync — so it is precisely where our drafts are NOT, and a
   *          person who closed a half-written email and went looking found the
   *          one empty folder in the rail.
   * OUTBOX   The send queue: scheduled messages still cancellable, and sends
   *          the mail server refused. The composer has told people "you can
   *          cancel it from the outbox until then" since PR-5; this is the
   *          outbox it meant.
   */
  pending?: "DRAFTS" | "OUTBOX";
};

/** English + French, because the two are used interchangeably in the office. */
const FOLDER_LABEL: Record<MailFolder, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFTS: "Drafts",
  ARCHIVE: "Archive",
  SPAM: "Spam",
  TRASH: "Trash",
};

/**
 * The four saved views. Glyphs rather than an icon set: the star has to be the
 * SAME character the thread list draws, or the view and the control that fills
 * it do not read as the same feature.
 */
const VIEWS: { key: NonNullable<RailSelection["view"]>; label: string; glyph: string }[] = [
  { key: "UNREAD", label: "Unread", glyph: "●" },
  { key: "STARRED", label: "Starred", glyph: "★" },
  { key: "VIP", label: "VIP", glyph: "◆" },
  { key: "ATTACHMENT", label: "With attachments", glyph: "◫" },
];

/** The canonical name, translated; anything else is the server's own text. */
function folderLabel(f: Folder): string {
  const canonical = FOLDER_LABEL[f.canonical as MailFolder];
  return canonical ? tr(canonical) : (f.display_name ?? f.provider_path);
}

function RailButton({
  active,
  onClick,
  children,
  count,
  indent,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
        indent && "pl-6",
        active
          ? "bg-primary/10 font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span className="truncate">{children}</span>
      {count !== undefined && count > 0 && (
        <span className="num shrink-0 text-xs tabular-nums">{count}</span>
      )}
    </button>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-4 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

export function FolderRail({
  mailboxes,
  folders,
  labels,
  selection,
  onChange,
  humanUnread,
  systemUnread,
}: {
  mailboxes: Mailbox[];
  folders: Folder[];
  labels: Label[];
  selection: RailSelection;
  onChange: (next: RailSelection) => void;
  humanUnread: number;
  systemUnread: number;
}) {
  const set = (patch: Partial<RailSelection>) =>
    onChange({ ...selection, ...patch });

  const canonical = folders.filter((f) => f.canonical);
  const inboxUnread =
    canonical.find((f) => f.canonical === "INBOX")?.unread_count ?? 0;

  return (
    <nav aria-label={tr("Mail folders")} className="space-y-1">
      {/* A person with one mailbox should not be asked to choose it. */}
      {mailboxes.length > 1 && (
        <Field label={tr("Mailbox")}>
          <Select
            value={selection.connectionId ?? ""}
            onChange={(e) =>
              set({ connectionId: e.target.value || undefined, label: undefined })
            }
          >
            <option value="">{tr("All my mailboxes")}</option>
            {mailboxes.map((m) => (
              <option key={m.email_connection_id} value={m.email_connection_id}>
                {m.email_address}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Heading>{tr("Triage")}</Heading>
      <RailButton
        active={selection.stream === "HUMAN" && !selection.view && !selection.pending}
        onClick={() => set({ stream: "HUMAN", folder: "INBOX", label: undefined, view: undefined, pending: undefined })}
        count={humanUnread}
      >
        {tr("People")}
      </RailButton>
      <RailButton
        active={selection.stream === "SYSTEM" && !selection.view && !selection.pending}
        onClick={() => set({ stream: "SYSTEM", folder: "INBOX", label: undefined, view: undefined, pending: undefined })}
        count={systemUnread}
      >
        {tr("Notices")}
      </RailButton>
      <RailButton
        active={!selection.stream && !selection.view && !selection.pending && selection.folder === "INBOX" && !selection.label}
        onClick={() => set({ stream: undefined, folder: "INBOX", label: undefined, view: undefined, pending: undefined })}
        count={inboxUnread}
      >
        {tr("Everything")}
      </RailButton>

      <Heading>{tr("Views")}</Heading>
      {/* Saved views, not folders: they cut ACROSS folders, which is why they
          clear `folder` rather than set one. A starred conversation that has
          been archived is still starred, and a view that only looked in the
          inbox would be the same dead end with a different shape. */}
      {VIEWS.map((v) => (
        <RailButton
          key={v.key}
          active={selection.view === v.key && !selection.pending}
          onClick={() =>
            set(
              selection.view === v.key
                ? { view: undefined, folder: "INBOX", stream: "HUMAN", label: undefined, pending: undefined }
                : { view: v.key, folder: "INBOX", stream: undefined, label: undefined, pending: undefined },
            )
          }
          indent
        >
          <span className="mr-1.5" aria-hidden>{v.glyph}</span>
          {tr(v.label)}
        </RailButton>
      ))}

      <Heading>{tr("Not sent yet")}</Heading>
      {/* Above the folders, because they are about mail the PERSON still owes
          somebody, and because the canonical DRAFTS folder immediately below is
          the mail server's and will not contain what they are looking for. */}
      <RailButton
        active={selection.pending === "DRAFTS"}
        onClick={() => set({ pending: "DRAFTS", view: undefined, label: undefined, stream: undefined })}
        indent
      >
        {tr("My drafts")}
      </RailButton>
      <RailButton
        active={selection.pending === "OUTBOX"}
        onClick={() => set({ pending: "OUTBOX", view: undefined, label: undefined, stream: undefined })}
        indent
      >
        {tr("Outbox")}
      </RailButton>

      <Heading>{tr("Folders")}</Heading>
      {canonical.map((f) => (
        <RailButton
          key={f.email_folder_id}
          active={selection.folder === f.canonical && !selection.stream && !selection.label && !selection.view && !selection.pending}
          onClick={() =>
            set({ folder: f.canonical as MailFolder, stream: undefined, label: undefined, view: undefined, pending: undefined })
          }
          count={f.unread_count}
          indent
        >
          {folderLabel(f)}
        </RailButton>
      ))}
      {canonical.length === 0 && (
        // Not an error. A mailbox that has never synced has no folders yet, and
        // saying so is more useful than an empty gap the user has to interpret.
        <p className="px-2.5 text-xs text-muted-foreground">
          {tr("No folders yet — sync the mailbox to discover them.")}
        </p>
      )}

      {labels.length > 0 && (
        <>
          <Heading>{tr("My labels")}</Heading>
          {labels.map((l) => (
            <RailButton
              key={l.email_label_id}
              active={selection.label === l.name && !selection.view && !selection.pending}
              onClick={() => set({ label: l.name, stream: undefined, view: undefined, pending: undefined })}
              count={l.thread_count}
              indent
            >
              {l.name}
            </RailButton>
          ))}
        </>
      )}

      {/* A folder the server refused is worth surfacing here rather than in a
          log: the user is looking at a list that is quietly incomplete. */}
      {folders.some((f) => f.last_error) && (
        <div className="mt-4 px-2.5">
          <Pill tone="warn">{tr("Some folders did not sync")}</Pill>
          <p className="mt-1 text-xs text-muted-foreground">
            {folders
              .filter((f) => f.last_error)
              .map((f) => f.display_name || f.provider_path)
              .join(", ")}
          </p>
        </div>
      )}
    </nav>
  );
}
