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
import type { Folder, Label, MailFolder, MailStream, Mailbox } from "@/lib/mail-api";

export type RailSelection = {
  connectionId?: string;
  folder: MailFolder;
  stream?: MailStream;
  label?: string;
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
    <nav aria-label="Mail folders" className="space-y-1">
      {/* A person with one mailbox should not be asked to choose it. */}
      {mailboxes.length > 1 && (
        <Field label="Mailbox">
          <Select
            value={selection.connectionId ?? ""}
            onChange={(e) =>
              set({ connectionId: e.target.value || undefined, label: undefined })
            }
          >
            <option value="">All my mailboxes</option>
            {mailboxes.map((m) => (
              <option key={m.email_connection_id} value={m.email_connection_id}>
                {m.email_address}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Heading>Triage</Heading>
      <RailButton
        active={selection.stream === "HUMAN"}
        onClick={() => set({ stream: "HUMAN", folder: "INBOX", label: undefined })}
        count={humanUnread}
      >
        People
      </RailButton>
      <RailButton
        active={selection.stream === "SYSTEM"}
        onClick={() => set({ stream: "SYSTEM", folder: "INBOX", label: undefined })}
        count={systemUnread}
      >
        Notices
      </RailButton>
      <RailButton
        active={!selection.stream && selection.folder === "INBOX" && !selection.label}
        onClick={() => set({ stream: undefined, folder: "INBOX", label: undefined })}
        count={inboxUnread}
      >
        Everything
      </RailButton>

      <Heading>Folders</Heading>
      {canonical.map((f) => (
        <RailButton
          key={f.email_folder_id}
          active={selection.folder === f.canonical && !selection.stream && !selection.label}
          onClick={() =>
            set({ folder: f.canonical as MailFolder, stream: undefined, label: undefined })
          }
          count={f.unread_count}
          indent
        >
          {FOLDER_LABEL[f.canonical as MailFolder] ?? f.display_name ?? f.provider_path}
        </RailButton>
      ))}
      {canonical.length === 0 && (
        // Not an error. A mailbox that has never synced has no folders yet, and
        // saying so is more useful than an empty gap the user has to interpret.
        <p className="px-2.5 text-xs text-muted-foreground">
          No folders yet — sync the mailbox to discover them.
        </p>
      )}

      {labels.length > 0 && (
        <>
          <Heading>My labels</Heading>
          {labels.map((l) => (
            <RailButton
              key={l.email_label_id}
              active={selection.label === l.name}
              onClick={() => set({ label: l.name, stream: undefined })}
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
          <Pill tone="warn">Some folders did not sync</Pill>
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
