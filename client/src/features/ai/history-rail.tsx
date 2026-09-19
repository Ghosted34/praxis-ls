/**
 * The workspace's left rail — Spaces above, conversations below.
 *
 * SPACES ARE SCOPES YOU HAVE PARKED IN. They are not a second taxonomy: the list
 * is `useAiScopes()`, the same permission-aware list the composer's scope chip
 * renders (`components/ai/context.tsx`). Picking Finance here does exactly what
 * picking Finance there does — it points the next question at Finance. Building
 * them as two concepts is how you end up with a product where "Finance" means
 * one thing in a dropdown and another in a sidebar.
 *
 * AND THE SPACES SECTION COLLAPSES (audit J4). It was fixed and always open, so
 * on a tenant with the full module set the scope list pushed the conversation
 * list below the fold and the rail's main job — finding a thread — happened in
 * whatever height was left over. The state is remembered PER USER, keyed by
 * user id: a shared workstation is two people with two different rails, and
 * a plain localStorage key would hand the second one the first one's layout.
 *
 * HISTORY IS GROUPED BY WHEN, NOT DATED. Nobody remembers they asked about the
 * Douala file on the 14th; they remember it was "the other day". Buckets
 * (`groupConversations`) match how the memory actually works, and empty ones are
 * dropped so the rail never shows a heading with nothing under it. Pinned
 * threads sit in their own group above those buckets — a pin whose thread still
 * slides from "Today" into "Previous 7 days" has not pinned anything.
 *
 * THE SEARCH FIELD FILTERS WHAT IS LOADED, and does not query the server. The
 * conversation list is metadata for one user — titles and timestamps — so it
 * arrives in one read and filtering it locally is instant. A search that goes to
 * the network to filter a list already in memory is a slower version of the same
 * answer.
 *
 * ROW AFFORDANCES (audit J5). Each row carries an overflow menu — pin, rename,
 * archive, delete. Two things about its shape are deliberate:
 *
 *   The row is a DIV CONTAINING TWO BUTTONS, not one button with a menu inside
 *   it. A button nested in a button is invalid, and the browsers that tolerate
 *   it deliver the click to whichever they feel like. The open control and the
 *   menu trigger are siblings; the div is layout and carries no handler, so
 *   nothing here needs an a11y suppression.
 *
 *   The trigger is TRANSPARENT UNTIL HOVER OR FOCUS, never absent. Rendering it
 *   only on hover would mean it does not exist for a keyboard or a screen
 *   reader; `group-focus-within` brings it back the instant it is tabbed to, so
 *   the quiet rail and the reachable control are the same markup.
 *
 * DELETE IS TWO-TIERED AND THE SECOND TIER IS OPT-IN. Deleting hides the thread
 * and stops it being loadable; the checkbox in the confirm also destroys the
 * transcript. That distinction exists because the audit's J1 case is somebody
 * who needs a sensitive conversation GONE, and a soft flag does not honour that
 * — but the hard half is irreversible, so it is a decision the person makes in
 * the dialog rather than a consequence of pressing Delete.
 *
 * NO NATIVE DIALOGS. `useConfirm` and `usePrompt` — see CLAUDE.md. A
 * `window.prompt` for the rename would have rendered "app.praxis-ls.com says"
 * over a white-labelled product, and `confirm` blocks the event loop, which on
 * this screen means blocking a stream that is mid-answer.
 *
 * This rail is the reason the drawer does not need history. Browsing past
 * conversations wants width, grouping and a search field; a 440px panel opened
 * over a screen you were reading wants none of those, and giving it them was
 * what made the old copilot's history sidebar cover its own transcript.
 */
import * as React from "react";
import { dateDmy } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useAuth } from "@/app/auth/auth-context";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { LoadingRow } from "@/components/ui/states";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/use-confirm";
import { usePrompt } from "@/components/ui/use-prompt";
import { ChevronIcon, PencilIcon, SearchIcon, TrashIcon } from "@/components/ui/icons";
import { useAiScopes } from "@/components/ai/context";
import { ArchiveIcon, KebabIcon, NewChatIcon, PinIcon, PraxisMark } from "@/components/ai/icons";
import { groupConversations } from "@/components/ai/thread";
import { errMsg } from "@/lib/use-resource";
import type { AiConversationMeta, AiConversationPatch } from "@/lib/ai-api";

/** Per-user, because a shared workstation is two people and one localStorage. */
const spacesKey = (userId?: string | null) =>
  `praxis.ai.rail.spaces${userId ? `:${userId}` : ""}`;

function storedSpacesOpen(userId?: string | null): boolean {
  try {
    return localStorage.getItem(spacesKey(userId)) !== "closed";
  } catch {
    /* @silent:storage — private mode, or site data blocked. Open is the right
       default: it is what the rail did before this was configurable. */
    return true;
  }
}

/**
 * The irreversible half of Delete, as its own component.
 *
 * IT OWNS ITS STATE FOR A REASON. `useConfirm` captures `body` as a ReactNode
 * when the dialog opens, so a checkbox controlled by the CALLER's state would
 * never re-render — it would look permanently unticked however many times it
 * was clicked. A component with its own state re-renders on its own, captured
 * node or not, and reports the value outward.
 */
function PurgeChoice({ onChange }: { onChange: (on: boolean) => void }) {
  const [on, setOn] = React.useState(false);
  return (
    <Checkbox
      className="mt-3"
      checked={on}
      onCheckedChange={(v) => {
        setOn(v);
        onChange(v);
      }}
      label="Also erase it permanently"
      hint="Destroys the transcript and any action the assistant proposed but never carried out. Actions it did carry out are kept, detached — they are the record of a real change. This cannot be undone."
    />
  );
}

export function AiHistoryRail({
  conversations,
  loading,
  activeId,
  onOpen,
  onNew,
  onPatch,
  onRemove,
  onReload,
  scope,
  onScope,
  busy,
}: {
  conversations: AiConversationMeta[];
  loading: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Pin / rename / archive. Resolves once the server has confirmed. */
  onPatch: (id: string, patch: AiConversationPatch) => Promise<void>;
  /** Delete, soft or purged. */
  onRemove: (id: string, opts?: { purge?: boolean }) => Promise<void>;
  /** Re-read the list — used when the archived section is opened or closed. */
  onReload: (opts: { includeArchived: boolean }) => void;
  scope: string;
  onScope: (key: string) => void;
  busy: boolean;
}) {
  const { user } = useAuth();
  const [q, setQ] = React.useState("");
  const scopes = useAiScopes();
  const [confirm, confirmDialog] = useConfirm();
  const [prompt, promptDialog] = usePrompt();
  const toast = useToast();

  const [spacesOpen, setSpacesOpen] = React.useState(() =>
    storedSpacesOpen(user?.user_id),
  );
  const [showArchived, setShowArchived] = React.useState(false);
  /** The row with a mutation in flight, so its menu cannot be double-fired. */
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);

  // Re-read the per-user preference when the user changes (a re-login in the
  // same tab), rather than keeping the previous person's rail.
  React.useEffect(() => {
    setSpacesOpen(storedSpacesOpen(user?.user_id));
  }, [user?.user_id]);

  React.useEffect(() => {
    try {
      localStorage.setItem(spacesKey(user?.user_id), spacesOpen ? "open" : "closed");
    } catch {
      /* @silent:storage — see storedSpacesOpen. A rail that forgets its
         collapsed state is not worth interrupting anybody over. */
    }
  }, [spacesOpen, user?.user_id]);

  const { groups, archived } = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? conversations.filter((c) => (c.title || "").toLowerCase().includes(needle))
      : conversations;
    return {
      // Archived threads get their own section at the bottom rather than being
      // folded back into the time buckets they were archived out of.
      groups: groupConversations(list.filter((c) => c.archived_at == null)),
      archived: list.filter((c) => c.archived_at != null),
    };
  }, [conversations, q]);

  /**
   * Run one row mutation, holding the row until the server has answered.
   *
   * A FAILURE HAS TO SAY SO. These are the one class of action on this screen
   * where silence is indistinguishable from success — the menu closes either
   * way — and the worst of them is archive: a thread the user believes they
   * have put away and has not. The toast is also what stops a rejected promise
   * escaping as an unhandled rejection, since nothing above awaits these.
   */
  async function run(id: string, fn: () => Promise<void>, failure: string) {
    setRowBusy(id);
    try {
      await fn();
    } catch (e) {
      toast.error(`${failure} ${errMsg(e)}`);
    } finally {
      setRowBusy(null);
    }
  }

  const label = (c: AiConversationMeta) => c.title || "Untitled conversation";

  async function rename(c: AiConversationMeta) {
    const next = await prompt({
      title: "Rename this conversation",
      label: "Title",
      defaultValue: c.title || "",
      // Not "required": clearing it is a real intention, and it restores the
      // derived title rather than leaving a blank row.
      hint: "Leave it empty to go back to the first thing you asked.",
      confirmLabel: "Rename",
    });
    if (next === null) return;
    await run(
      c.conversation_id,
      () => onPatch(c.conversation_id, { title: next }),
      "Could not rename this conversation.",
    );
  }

  async function remove(c: AiConversationMeta) {
    // Read through a ref: the dialog's body is captured, so the checkbox
    // reports outward rather than being read back from state at resolve time.
    const purge = { current: false };
    const ok = await confirm({
      title: "Delete this conversation?",
      body: (
        <>
          <p>
            “{label(c)}” leaves your history and stops opening, including from a
            link you already have.
          </p>
          <PurgeChoice onChange={(v) => (purge.current = v)} />
        </>
      ),
      confirmLabel: "Delete conversation",
      destructive: true,
    });
    if (!ok) return;
    await run(
      c.conversation_id,
      () => onRemove(c.conversation_id, { purge: purge.current }),
      "Could not delete this conversation.",
    );
  }

  function toggleArchived() {
    const next = !showArchived;
    setShowArchived(next);
    onReload({ includeArchived: next });
  }

  function row(c: AiConversationMeta) {
    const on = c.conversation_id === activeId;
    const pinned = c.pinned_at != null;
    const isArchived = c.archived_at != null;
    const rowIsBusy = rowBusy === c.conversation_id;

    return (
      <li key={c.conversation_id}>
        <div
          className={cn(
            "group relative flex items-center rounded-md transition-colors",
            on ? "bg-accent" : "hover:bg-accent/60",
          )}
        >
          <button
            type="button"
            onClick={() => onOpen(c.conversation_id)}
            aria-current={on ? "true" : undefined}
            className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left"
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              {pinned ? (
                <PinIcon
                  width={11}
                  height={11}
                  className="shrink-0 text-muted-foreground"
                />
              ) : null}
              <span
                className={cn(
                  "line-clamp-1 text-sm",
                  on ? "font-medium text-foreground" : "text-foreground/90",
                )}
              >
                {label(c)}
              </span>
            </span>
            <span className="micro text-muted-foreground">
              {dateDmy(c.last_at)} · {c.message_count} message
              {c.message_count === 1 ? "" : "s"}
            </span>
          </button>

          <DropdownMenu
            align="end"
            trigger={
              <button
                type="button"
                disabled={rowIsBusy}
                // Present for the keyboard at all times; visible once the row is
                // hovered, the trigger is focused, or its menu is open.
                className={cn(
                  "mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity",
                  "hover:bg-accent hover:text-foreground focus-visible:opacity-100",
                  "group-hover:opacity-100 group-focus-within:opacity-100",
                  "data-[state=open]:opacity-100 disabled:opacity-50",
                )}
                aria-label={`Actions for ${label(c)}`}
              >
                <KebabIcon width={14} height={14} />
              </button>
            }
          >
            <DropdownItem
              onSelect={() =>
                run(
                  c.conversation_id,
                  () => onPatch(c.conversation_id, { pinned: !pinned }),
                  pinned ? "Could not unpin this conversation." : "Could not pin this conversation.",
                )
              }
            >
              <PinIcon width={14} height={14} />
              {pinned ? "Unpin" : "Pin to top"}
            </DropdownItem>
            <DropdownItem onSelect={() => rename(c)}>
              <PencilIcon width={14} height={14} />
              Rename
            </DropdownItem>
            <DropdownItem
              onSelect={() =>
                run(
                  c.conversation_id,
                  () => onPatch(c.conversation_id, { archived: !isArchived }),
                  isArchived
                    ? "Could not restore this conversation."
                    : "Could not archive this conversation.",
                )
              }
            >
              <ArchiveIcon width={14} height={14} />
              {isArchived ? "Restore" : "Archive"}
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem destructive onSelect={() => remove(c)}>
              <TrashIcon width={14} height={14} />
              Delete
            </DropdownItem>
          </DropdownMenu>
        </div>
      </li>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="space-y-2.5 border-b border-border p-3">
        <button
          type="button"
          onClick={onNew}
          disabled={busy}
          className="btn-primary flex h-9 w-full items-center justify-center gap-2 rounded-md text-[13px] font-medium disabled:opacity-50"
        >
          <NewChatIcon width={15} height={15} />
          New conversation
        </button>
        <div className="relative">
          <SearchIcon
            width={14}
            height={14}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <section aria-labelledby="ai-spaces">
          <h3 id="ai-spaces">
            <button
              type="button"
              onClick={() => setSpacesOpen((v) => !v)}
              aria-expanded={spacesOpen}
              aria-controls="ai-spaces-list"
              className="micro flex w-full items-center gap-1 rounded-md px-2 py-1 uppercase text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <ChevronIcon
                width={12}
                height={12}
                className={cn("transition-transform", spacesOpen ? "rotate-0" : "-rotate-90")}
              />
              Spaces
            </button>
          </h3>
          <ul id="ai-spaces-list" hidden={!spacesOpen} className="space-y-0.5 pt-1">
            {scopes.map((s) => {
              const on = s.key === scope;
              const Icon = s.Icon;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => onScope(s.key)}
                    aria-pressed={on}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      on
                        ? "bg-primary/12 font-medium text-primary-ink"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span
                      aria-hidden
                      className="grid h-4 w-4 shrink-0 place-items-center"
                    >
                      {s.key === "all" ? (
                        <PraxisMark width={13} height={13} />
                      ) : (
                        <Icon width={14} height={14} />
                      )}
                    </span>
                    <span className="truncate">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="ai-history" className="mt-4">
          <h3 id="ai-history" className="sr-only">
            Conversations
          </h3>
          {loading ? (
            <LoadingRow />
          ) : groups.length === 0 ? (
            <p className="micro px-2 py-2 text-muted-foreground">
              {q
                ? "No conversation matches that."
                : "No conversations yet. Ask something to start one."}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.heading} className="mb-3">
                <h4 className="micro px-2 pb-1 uppercase text-muted-foreground">
                  {g.heading}
                </h4>
                <ul className="space-y-0.5">{g.items.map(row)}</ul>
              </div>
            ))
          )}
        </section>

        <section aria-labelledby="ai-archived" className="mt-1">
          <h3 id="ai-archived">
            <button
              type="button"
              onClick={toggleArchived}
              aria-expanded={showArchived}
              aria-controls="ai-archived-list"
              className="micro flex w-full items-center gap-1 rounded-md px-2 py-1 uppercase text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <ChevronIcon
                width={12}
                height={12}
                className={cn("transition-transform", showArchived ? "rotate-0" : "-rotate-90")}
              />
              Archived
            </button>
          </h3>
          {showArchived ? (
            <ul id="ai-archived-list" className="space-y-0.5 pt-1">
              {archived.length ? (
                archived.map(row)
              ) : (
                <li className="micro px-2 py-2 text-muted-foreground">
                  Nothing archived.
                </li>
              )}
            </ul>
          ) : null}
        </section>
      </div>

      {confirmDialog}
      {promptDialog}
    </div>
  );
}
