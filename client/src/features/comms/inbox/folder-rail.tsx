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
 *
 * ── SECTIONS COLLAPSE, AND THE RAIL REMEMBERS ────────────────────────────────
 *
 * Triage, Views, Not sent yet, Folders and My labels each open and close from
 * their header — chevron right when shut, chevron down when open. Everything
 * starts shut except Folders: the rail opens on what the operator asked for
 * (their folders) rather than a full-page inventory. The choice persists in
 * localStorage, so it is a preference, not a ritual.
 *
 * Two things keep a collapsed rail from being disorienting. A shut section that
 * holds the current selection names it beside the header ("TRIAGE · People"),
 * so where you are is always legible. And navigating TO a row inside a shut
 * section — from the reading pane, not from here, since shut rows cannot be
 * clicked — opens that section, so the selection never sits somewhere
 * invisible. Collapsing is always the operator's own doing.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Pill } from "@/components/ui/pill";
import { ChevronIcon } from "@/components/ui/icons";
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

type SectionKey = "triage" | "views" | "pending" | "folders" | "labels";

/** Everything shut except the folders — the rail opens on what was asked for. */
const DEFAULT_OPEN: Record<SectionKey, boolean> = {
  triage: false,
  views: false,
  pending: false,
  folders: true,
  labels: false,
};

const SECTION_STORE_KEY = "praxis:mail-rail-sections:v1";

function loadOpen(): Record<SectionKey, boolean> {
  try {
    const raw = window.localStorage.getItem(SECTION_STORE_KEY);
    if (!raw) return { ...DEFAULT_OPEN };
    return { ...DEFAULT_OPEN, ...(JSON.parse(raw) as Partial<Record<SectionKey, boolean>>) };
  } catch {
    // No storage (private mode) or a corrupt value: the default is the rail,
    // and the worst case is that it forgets.
    return { ...DEFAULT_OPEN };
  }
}

/**
 * Which section a selection lives in — the mirror of the `active=` conditions
 * on the rows below, so the two cannot disagree about where anything is.
 */
function sectionFor(sel: RailSelection): SectionKey {
  if (sel.pending) return "pending";
  if (sel.view) return "views";
  if (sel.label) return "labels";
  if (sel.stream) return "triage";
  // No stream and no label: a folder row — except INBOX, which is Triage's
  // "Everything" wearing the inbox's clothes.
  return sel.folder === "INBOX" ? "triage" : "folders";
}

/**
 * What a SHUT section says beside its header when it holds the current
 * selection: "TRIAGE · People". Null when the section does not hold it, in
 * which case the header stands alone.
 */
function captionFor(sel: RailSelection, section: SectionKey, folders: Folder[]): string | null {
  if (sectionFor(sel) !== section) return null;
  switch (section) {
    case "triage":
      return sel.stream === "SYSTEM" ? tr("Notices") : sel.stream === "HUMAN" ? tr("People") : tr("Everything");
    case "views":
      return sel.view ? tr(VIEWS.find((v) => v.key === sel.view)?.label || sel.view) : null;
    case "pending":
      return sel.pending === "OUTBOX" ? tr("Outbox") : tr("My drafts");
    case "folders": {
      const f = folders.find((x) => x.canonical === sel.folder);
      return f ? folderLabel(f) : null;
    }
    case "labels":
      return sel.label || null;
  }
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

/**
 * One collapsible rail section: a header button carrying the disclosure chevron
 * (right when shut, down when open), and the rows beneath it when open.
 *
 * The caption — the active row's name on a shut section — is a SIBLING of the
 * button, deliberately, not its child: inside, it would join the accessible
 * name and "Triage People" would answer to a search for the People row.
 */
function Section({
  sectionKey,
  title,
  open,
  onToggle,
  caption,
  children,
}: {
  sectionKey: SectionKey;
  title: string;
  open: boolean;
  onToggle: () => void;
  caption?: string | null;
  children: React.ReactNode;
}) {
  const panelId = `mail-rail-${sectionKey}`;
  return (
    <div>
      <div className="flex items-center gap-1 pt-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2.5 pb-1 text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronIcon
            width={12}
            height={12}
            className={cn("shrink-0 transition-transform duration-150", !open && "-rotate-90")}
          />
          <span className="truncate">{title}</span>
        </button>
        {caption && (
          <span className="shrink-0 truncate px-2.5 text-xs text-muted-foreground">
            {caption}
          </span>
        )}
      </div>
      {open && <div id={panelId}>{children}</div>}
    </div>
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

  const [open, setOpen] = React.useState<Record<SectionKey, boolean>>(loadOpen);
  const toggle = (key: SectionKey) =>
    setOpen((o) => ({ ...o, [key]: !o[key] }));

  // The choice persists; the write lives here rather than in `toggle` so the
  // auto-open below is remembered too — the rail reopens looking the way it
  // was left, not the way it was toggled.
  React.useEffect(() => {
    try {
      window.localStorage.setItem(SECTION_STORE_KEY, JSON.stringify(open));
    } catch {
      /* @silent:storage — private mode forgets, and forgetting is harmless */
    }
  }, [open]);

  // Navigating to a row inside a shut section opens it, so the selection never
  // sits somewhere invisible. Skipped on mount: the first paint honours the
  // stored (or default) state, and only movement after that rearranges it.
  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const key = sectionFor(selection);
    setOpen((o) => (o[key] ? o : { ...o, [key]: true }));
  }, [selection]);

  const canonical = folders.filter((f) => f.canonical);
  const inboxUnread =
    canonical.find((f) => f.canonical === "INBOX")?.unread_count ?? 0;

  // A shut section names the selection it holds; an open one shows it.
  const caption = (key: SectionKey) =>
    open[key] ? null : captionFor(selection, key, folders);

  return (
    <nav aria-label={tr("Mail folders")} className="space-y-1">
      {/* A person with one mailbox should not be asked to choose it — but the
          rail is still SCOPED to that mailbox, whether or not the picker is
          drawn. There is no "all my mailboxes" option, because there is no such
          rail to draw: folders, their counts and the two stream totals belong
          to one connection, and the option only ever resolved to an empty rail
          under a message about syncing. Two mailboxes means a choice between
          them, not a choice between them and nothing. */}
      {mailboxes.length > 1 && (
        <Field label={tr("Mailbox")}>
          <Select
            value={selection.connectionId ?? mailboxes[0].email_connection_id}
            onChange={(e) => set({ connectionId: e.target.value, label: undefined })}
          >
            {mailboxes.map((m) => (
              <option key={m.email_connection_id} value={m.email_connection_id}>
                {m.email_address}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Section
        sectionKey="triage"
        title={tr("Triage")}
        open={open.triage}
        onToggle={() => toggle("triage")}
        caption={caption("triage")}
      >
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
      </Section>

      <Section
        sectionKey="views"
        title={tr("Views")}
        open={open.views}
        onToggle={() => toggle("views")}
        caption={caption("views")}
      >
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
      </Section>

      <Section
        sectionKey="pending"
        title={tr("Not sent yet")}
        open={open.pending}
        onToggle={() => toggle("pending")}
        caption={caption("pending")}
      >
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
      </Section>

      <Section
        sectionKey="folders"
        title={tr("Folders")}
        open={open.folders}
        onToggle={() => toggle("folders")}
        caption={caption("folders")}
      >
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
        {canonical.length === 0 && mailboxes.length > 0 && (
          // Not an error, and now it means what it says. This used to be what
          // EVERYONE saw: the rail opened with no mailbox selected, an
          // unqualified folder call answered with nothing, and a mailbox that had
          // synced fine was reported as never synced. The rail is pointed at a
          // mailbox from the first render now, so reaching this line means that
          // mailbox genuinely has no folders yet.
          //
          // Gated on knowing WHICH mailbox, because "this mailbox has no folders"
          // is a claim, and for the half-second before the mailbox list arrives
          // there is no mailbox to make it about.
          <p className="px-2.5 text-xs text-muted-foreground">
            {tr("No folders yet — sync the mailbox to discover them.")}
          </p>
        )}
      </Section>

      {labels.length > 0 && (
        <Section
          sectionKey="labels"
          title={tr("My labels")}
          open={open.labels}
          onToggle={() => toggle("labels")}
          caption={caption("labels")}
        >
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
        </Section>
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
