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
import { ErrorState } from "@/components/ui/states";
import { SplitPane } from "@/components/ui/split-pane";
import { useResource } from "@/lib/use-resource";
import { getCommsSocket } from "@/lib/comms-socket";
import { reportActionError } from "@/lib/action-error";
import * as api from "@/lib/mail-api";
import { FolderRail, type RailSelection } from "./folder-rail";
import { ThreadList } from "./thread-list";
import { ThreadView } from "./thread-view";
import { SemanticResults } from "./work/semantic-search";

const PAGE = 50;

/** What an empty list means depends on why it is empty. Say the right thing. */
function emptyHintFor(sel: RailSelection, query: string): string {
  if (query.trim()) return `${tr("Nothing matches")} “${query.trim()}”. ${tr("Try fewer words, or drop an operator like from: or has:.")}`;
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
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [bulkFailures, setBulkFailures] = React.useState<
    { email_thread_id: string; error: string }[]
  >([]);
  const [limit, setLimit] = React.useState(PAGE);
  // Local overlay for the two optimistic flags, keyed by thread id. Cleared on
  // every reload, so the server's answer always wins in the end.
  const [flags, setFlags] = React.useState<
    Record<string, { unread_count?: number; is_starred?: boolean }>
  >({});

  const folders = useResource(
    () => api.listFolders(sel.connectionId),
    [sel.connectionId],
  );
  const labels = useResource(() => api.listLabels(), []);

  const threads = useResource(
    () =>
      api.listThreads({
        q: applied || undefined,
        connection_id: sel.connectionId,
        folder: sel.folder,
        stream: sel.stream,
        label: sel.label,
        limit,
      }),
    [applied, sel.connectionId, sel.folder, sel.stream, sel.label, limit],
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
    setLimit(PAGE);
  }, [applied, sel.connectionId, sel.folder, sel.stream, sel.label]);

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
    setBusy(true);
    setBulkFailures([]);
    try {
      const res = await api.bulkThreads({ ids: [...selected], op, folder });
      setBulkFailures(res.failed || []);
      setSelected(new Set());
      reload();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (mailboxes.error) return <ErrorState message={mailboxes.error} />;

  const boxes = mailboxes.data || [];
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
          selection={sel}
          onChange={(next) => {
            setSel(next);
            setOpenId(null);
          }}
          humanUnread={streams.HUMAN}
          systemUnread={streams.SYSTEM}
        />
      </aside>

      <div className="min-w-0 space-y-3">
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

        {meaning && (
          <SemanticResults
            query={meaning}
            onOpen={(id) => { setMeaning(""); open(id); }}
            onClear={() => setMeaning("")}
          />
        )}

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
            onReplied={reload}
            onWorkChanged={reload}
          />
        </SplitPane>

        {threads.error && <ErrorState message={threads.error} />}
      </div>
    </div>
  );
}
