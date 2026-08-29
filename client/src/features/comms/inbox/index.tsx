/**
 * The inbox — folder rail, conversation list, conversation view.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 *
 * The Mailbox tab's "Threads" table: one row per MESSAGE, in a DataList, with a
 * modal to read one. That was a message log, not an inbox. This is the model
 * PR-1A introduced — conversations, folders discovered from the server, a split
 * between human and machine mail, per-user read state, and search.
 *
 * ── SEARCH IS THE LIST, NOT A MODE ──────────────────────────────────────────
 *
 * Typing in the box narrows the same list the folder rail narrows. There is no
 * separate results screen, so every filter, every selection and every bulk
 * action keeps working on a search result exactly as it does on a folder. An
 * inbox that behaves differently once you type in the box is two inboxes to
 * build and two to maintain.
 *
 * ── OPTIMISM IS LIMITED TO WHAT CANNOT LIE ──────────────────────────────────
 *
 * Stars and read state flip locally before the server answers, because the user
 * pressed the button and waiting 200ms to see a star fill reads as broken. Moves
 * do NOT: a move can fail on the mail server, and a conversation that appears to
 * leave a folder and then comes back is worse than one that takes a moment to
 * go. Anything that can genuinely be refused waits for the answer.
 */
import * as React from "react";
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PencilIcon } from "@/components/ui/icons";
import { ErrorState } from "@/components/ui/states";
import { SplitPane } from "@/components/ui/split-pane";
import { NewMessageDialog } from "./composer/new-message";
import { useResource } from "@/lib/use-resource";
import { getCommsSocket } from "@/lib/comms-socket";
import { reportActionError } from "@/lib/action-error";
import * as api from "@/lib/mail-api";
import { FolderRail, type RailSelection } from "./folder-rail";
import { ThreadList } from "./thread-list";
import { ThreadView } from "./thread-view";
import { SemanticResults } from "./work/semantic-search";
import { DraftList, OutboxList } from "./pending";

const PAGE = 50;

/** What an empty list means depends on why it is empty. Say the right thing. */
function emptyHintFor(sel: RailSelection, query: string): string {
  if (query.trim()) return `${tr("Nothing matches")} “${query.trim()}”. ${tr("Try fewer words, or drop an operator like from: or has:.")}`;
  if (sel.view === "STARRED") return tr("Nothing is starred. Tap the star on a conversation to keep it here.");
  if (sel.view === "UNREAD") return tr("Everything is read.");
  if (sel.view === "VIP") return tr("No VIP conversations. A client or supplier marked VIP in their record lands here.");
  if (sel.view === "ATTACHMENT") return tr("No conversation here carries a file.");
  if (sel.label) return `${tr("Nothing carries the label")} “${sel.label}” ${tr("yet.")}`;
  if (sel.stream === "SYSTEM") return tr("No automated mail — carrier notices and system reports will collect here.");
  if (sel.stream === "HUMAN") return tr("No mail from people yet.");
  if (sel.folder === "SENT") return tr("Nothing sent from this mailbox yet.");
  return tr("This folder is empty. If a mailbox was just connected, give the first sync a moment.");
}

export function InboxPage() {
  const mailboxes = useResource(() => api.myMailboxes(), []);
  const [sel, setSel] = React.useState<RailSelection>({ folder: "INBOX", stream: "HUMAN" });
  const [query, setQuery] = React.useState("");
  const [applied, setApplied] = React.useState("");
  /* §8.9. A second ANSWER to the same box, not a second screen — results open
   * the same thread view the keyword list does. */
  const [meaning, setMeaning] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [composeOpen, setComposeOpen] = React.useState(false);
  /* A draft being continued, from the Drafts list. Separate from `composeOpen`
   * because they are different intents and the dialog is titled differently:
   * "New message" opens a blank one, "Continue this draft" adopts the saved
   * `email_draft_id` so the next autosave updates it rather than forking. */
  const [resuming, setResuming] = React.useState<api.Draft | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [bulkFailures, setBulkFailures] = React.useState<
    { email_thread_id: string; error: string }[]
  >([]);
  /** What a deletion actually did — see `emptyFolder`. */
  const [note, setNote] = React.useState<string | null>(null);
  const [limit, setLimit] = React.useState(PAGE);
  // Local overlay for the two optimistic flags, keyed by thread id. Cleared on
  // every reload, so the server's answer always wins in the end.
  const [flags, setFlags] = React.useState<
    Record<string, { unread_count?: number; is_starred?: boolean }>
  >({});

  /* ── THE RAIL IS ALWAYS POINTED AT A MAILBOX ──────────────────────────────
   *
   * Folders, folder counts and the two stream totals all belong to ONE
   * connection — the rail has no "across every mailbox" shape to draw. So the
   * selection starting empty was not a neutral default, it was an empty rail:
   * every person landed on "No folders yet — sync the mailbox to discover
   * them" over a mailbox that had synced fine, and someone with a single
   * mailbox never got out of it, because the mailbox picker only appears once
   * there are two.
   *
   * The mailbox is therefore DERIVED, not stored: whatever the person picked,
   * or their primary mailbox until they pick. Derived rather than written back
   * into `sel` by an effect, so there is no first render with no mailbox and
   * no wasted fetch that answers for nothing. */
  const boxes = React.useMemo(() => mailboxes.data || [], [mailboxes.data]);
  const connectionId =
    sel.connectionId ?? api.primaryMailbox(boxes)?.email_connection_id;

  const folders = useResource(
    () => (connectionId ? api.listFolders(connectionId) : Promise.resolve(null)),
    [connectionId],
  );
  const labels = useResource(() => api.listLabels(), []);

  /* A saved view cuts ACROSS folders — a starred conversation that has been
   * archived is still starred — so it sends its flag and NO folder. Pinning it
   * to the inbox would rebuild the dead end it exists to remove. The four flags
   * have been supported by `listThreads` since PR-1A; only the rail was
   * missing. See `RailSelection.view`. */
  const threads = useResource(
    () =>
      api.listThreads({
        q: applied || undefined,
        connection_id: connectionId,
        folder: sel.view ? undefined : sel.folder,
        stream: sel.stream,
        label: sel.label,
        starred: sel.view === "STARRED" || undefined,
        unread: sel.view === "UNREAD" || undefined,
        vip: sel.view === "VIP" || undefined,
        has_attachment: sel.view === "ATTACHMENT" || undefined,
        limit,
      }),
    [applied, connectionId, sel.folder, sel.stream, sel.label, sel.view, limit],
  );

  const thread = useResource(
    () => (openId ? api.getThread(openId) : Promise.resolve(null)),
    [openId],
  );

  /* Live refresh. The sync worker publishes `mail:new` when it ingests, and the
   * counts in the rail are as stale as the list is — so both reload. */
  const reload = React.useCallback(() => {
    setFlags({});
    threads.reload();
    folders.reload();
    labels.reload();
    if (openId) thread.reload();
  }, [threads, folders, labels, thread, openId]);
  const reloadRef = React.useRef(reload);
  reloadRef.current = reload;
  React.useEffect(() => {
    const s = getCommsSocket();
    const onNew = () => reloadRef.current();
    s.on("mail:new", onNew);
    return () => {
      s.off("mail:new", onNew);
    };
  }, []);

  // Changing what is being listed drops the selection. Keeping a selection
  // across a folder change is how a bulk action lands on rows nobody can see.
  React.useEffect(() => {
    setSelected(new Set());
    setBulkFailures([]);
    setNote(null);
    setLimit(PAGE);
  }, [applied, connectionId, sel.folder, sel.stream, sel.label, sel.view, sel.pending]);

  const rows = React.useMemo(
    () =>
      (threads.data || []).map((t) => ({ ...t, ...(flags[t.email_thread_id] || {}) })),
    [threads.data, flags],
  );

  const folderRows = folders.data?.folders || [];
  const streams = folders.data?.streams || { HUMAN: 0, SYSTEM: 0 };

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  /** Star and read flip locally first — see the header. */
  function optimistic(id: string, patch: { unread_count?: number; is_starred?: boolean }) {
    setFlags((f) => ({ ...f, [id]: { ...(f[id] || {}), ...patch } }));
  }

  async function star(id: string, on: boolean) {
    optimistic(id, { is_starred: on });
    try {
      await api.setThreadStarred(id, on);
      folders.reload();
    } catch (err) {
      optimistic(id, { is_starred: !on });
      reportActionError(err);
    }
  }

  async function open(id: string) {
    setOpenId(id);
    // Opening marks read, the way every mail client does. Optimistic, because a
    // row that stays bold after you clicked it looks like the click was lost.
    const row = rows.find((t) => t.email_thread_id === id);
    if (row && row.unread_count > 0) {
      optimistic(id, { unread_count: 0 });
      try {
        await api.setThreadRead(id, true);
        folders.reload();
      } catch (err) {
        optimistic(id, { unread_count: row.unread_count });
        reportActionError(err);
      }
    }
  }

  async function bulk(op: api.BulkOp, folder?: api.MailFolder) {
    if (!selected.size) return;
    // Deletion is the one bulk verb with no undo, so it is the one that asks.
    // A message sealed into the compliance archive is retained rather than
    // deleted — said here, before, rather than reported afterwards as a
    // surprise.
    if (op === "delete") {
      const ok = window.confirm(
        `${tr("Delete")} ${selected.size} ${selected.size === 1 ? tr("conversation") : tr("conversations")} ${tr("for ever?")}\n\n` +
        tr("This cannot be undone. Anything sealed into the compliance archive is kept and will be reported."),
      );
      if (!ok) return;
    }
    setBusy(true);
    setBulkFailures([]);
    setNote(null);
    try {
      const res = await api.bulkThreads({ ids: [...selected], op, folder });
      setBulkFailures(res.failed || []);
      setSelected(new Set());
      if (op === "delete") setNote(`${res.succeeded} ${tr("deleted.")}`);
      reload();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  /** One conversation, for ever. The retained count is reported, never hidden. */
  async function deleteOne(id: string) {
    const ok = window.confirm(
      `${tr("Delete this conversation for ever?")}\n\n` +
      tr("This cannot be undone. Anything sealed into the compliance archive is kept."),
    );
    if (!ok) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await api.deleteThread(id);
      setNote(
        res.retained_archived
          ? `${res.deleted} ${tr("deleted.")} ${res.retained_archived} ${tr("kept — sealed into the compliance archive.")}`
          : `${res.deleted} ${tr("deleted.")}`,
      );
      // Only drop the open thread when the row itself went. A conversation
      // holding sealed messages survives, and closing the pane on it would say
      // "gone" about something that is still there.
      if (res.thread_removed) setOpenId(null);
      reload();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Empty Trash or Spam.
   *
   * The report afterwards is the point, not the confirmation before it.
   * `emptyFolder` returns `retained_archived` — the messages under retention
   * that stayed — and a success toast over a partial result would tell somebody
   * their correspondence is gone when it is not.
   */
  async function emptyFolder(folder: "TRASH" | "SPAM") {
    const ok = window.confirm(
      `${folder === "TRASH" ? tr("Empty the bin?") : tr("Empty spam?")}\n\n` +
      tr("Every conversation in it is deleted for ever. This cannot be undone. Anything sealed into the compliance archive is kept."),
    );
    if (!ok) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await api.emptyFolder(folder);
      setNote(
        res.retained_archived
          ? `${res.deleted} ${tr("deleted.")} ${res.retained_archived} ${tr("kept — sealed into the compliance archive.")}`
          : `${res.deleted} ${tr("deleted.")}`,
      );
      setBulkFailures(res.failed || []);
      reload();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (mailboxes.error) return <ErrorState message={mailboxes.error} />;

  if (!mailboxes.loading && boxes.length === 0) {
    return (
      <div className={pageShell.wide}>
        <ErrorState
          message={tr("No mailbox is connected to your account yet.")}
          action={
            <Button size="sm" onClick={() => { window.location.href = "/comms/setup"; }}>
              {tr("Set up my mailbox")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <FolderRail
          mailboxes={boxes}
          folders={folderRows}
          labels={labels.data || []}
          selection={{ ...sel, connectionId }}
          onChange={(next) => {
            setSel(next);
            setOpenId(null);
          }}
          humanUnread={streams.HUMAN}
          systemUnread={streams.SYSTEM}
        />
      </aside>

      <div className="min-w-0 space-y-3">
        {/* Compose entry — labelled, matching the Comms hub (WS feedback). The
            Mailbox tab's message log had one but this default inbox had none,
            so there was no obvious way to start an email from the screen you
            read on. Disabled while no mailbox is connected. */}
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            onClick={() => setComposeOpen(true)}
            disabled={!boxes.some((b) => b.status === "CONNECTED")}
            title={
              boxes.some((b) => b.status === "CONNECTED")
                ? tr("Write a new email")
                : tr("Connect a mailbox first")
            }
            icon={<PencilIcon width={16} height={16} />}
          >
            <span className="hidden sm:inline">{tr("Compose")}</span>
          </Button>
        </div>
        {!sel.pending && (
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(query);
            setMeaning("");
          }}
          className="flex gap-2"
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("Search — try from:maersk has:attachment demurrage")}
            aria-label={tr("Search mail")}
          />
          <Button type="submit" variant="outline" size="sm">
            {tr("Search")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={query.trim().length < 2}
            onClick={() => { setMeaning(query); setApplied(""); }}
            title={tr("Find conversations that read like this, even if they do not use these words")}
          >
            {tr("By meaning")}
          </Button>
          {applied && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                setApplied("");
                setMeaning("");
              }}
            >
              {tr("Clear")}
            </Button>
          )}
        </form>
        )}

        {note && (
          <p role="status" className="rounded-md bg-muted px-3 py-2 text-xs">
            {note}
          </p>
        )}

        {meaning && !sel.pending && (
          <SemanticResults
            query={meaning}
            onOpen={(id) => { setMeaning(""); open(id); }}
            onClear={() => setMeaning("")}
          />
        )}

        {/* Neither of these is a conversation, so neither goes through the
            thread list: a draft has no read state, no star, no folder and no
            counterparty yet, and a queued send has a status and an error
            instead. See `pending.tsx`. */}
        {sel.pending === "DRAFTS" && (
          <div className="rounded-xl border border-border">
            <DraftList onOpen={(d) => setResuming(d)} />
          </div>
        )}
        {sel.pending === "OUTBOX" && (
          <div className="rounded-xl border border-border">
            <OutboxList />
          </div>
        )}

        {!sel.pending && (
        <SplitPane
          storageKey="comms.inbox"
          label={tr("Conversation list width")}
          defaultSize={380}
          min={280}
          max={620}
          className="rounded-xl border border-border"
        >
          <ThreadList
            threads={rows}
            loading={threads.loading}
            error={threads.error}
            activeId={openId}
            selected={selected}
            onSelectedChange={setSelected}
            onOpen={(t) => open(t.email_thread_id)}
            onStar={(t, on) => star(t.email_thread_id, on)}
            onBulk={bulk}
            folder={sel.view || sel.label ? undefined : sel.folder}
            onEmptyFolder={
              sel.folder === "TRASH" || sel.folder === "SPAM"
                ? () => emptyFolder(sel.folder as "TRASH" | "SPAM")
                : undefined
            }
            bulkBusy={busy}
            bulkFailures={bulkFailures}
            onLoadMore={() => setLimit((n) => n + PAGE)}
            hasMore={(threads.data || []).length >= limit}
            emptyHint={emptyHintFor(sel, applied)}
          />
          <ThreadView
            thread={thread.data ?? null}
            loading={thread.loading}
            error={thread.error}
            labels={labels.data || []}
            busy={busy}
            onClose={() => setOpenId(null)}
            onMove={(folder) =>
              openId && run(() => api.moveThread(openId, folder))
            }
            onStream={(stream) =>
              openId && run(() => api.setThreadStream(openId, stream))
            }
            onLabel={(labelId) =>
              openId && run(() => api.setThreadLabel(openId, labelId, true))
            }
            onToggleRead={(read) =>
              openId && run(() => api.setThreadRead(openId, read))
            }
            onDelete={
              openId && (sel.folder === "TRASH" || sel.folder === "SPAM") && !sel.view
                ? () => deleteOne(openId)
                : undefined
            }
            onReplied={reload}
            onWorkChanged={reload}
          />
        </SplitPane>
        )}

        {(composeOpen || resuming) && (
          <NewMessageDialog
            open
            draft={resuming}
            onClose={() => { setComposeOpen(false); setResuming(null); }}
            onSent={() => {
              setResuming(null);
              // The Drafts list has one fewer row after a send, and the Outbox
              // has one more. Remounting the pane is what refreshes both.
              setSel((cur) => ({ ...cur }));
              reload();
            }}
          />
        )}

        {threads.error && <ErrorState message={threads.error} />}
      </div>
    </div>
  );
}
