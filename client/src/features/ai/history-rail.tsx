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
 * HISTORY IS GROUPED BY WHEN, NOT DATED. Nobody remembers they asked about the
 * Douala file on the 14th; they remember it was "the other day". Buckets
 * (`groupConversations`) match how the memory actually works, and empty ones are
 * dropped so the rail never shows a heading with nothing under it.
 *
 * THE SEARCH FIELD FILTERS WHAT IS LOADED, and does not query the server. The
 * conversation list is metadata for one user — titles and timestamps — so it
 * arrives in one read and filtering it locally is instant. A search that goes to
 * the network to filter a list already in memory is a slower version of the same
 * answer.
 *
 * This rail is the reason the drawer does not need history. Browsing past
 * conversations wants width, grouping and a search field; a 440px panel opened
 * over a screen you were reading wants none of those, and giving it them was
 * what made the old copilot's history sidebar cover its own transcript.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { LoadingRow } from "@/components/ui/states";
import { SearchIcon } from "@/components/ui/icons";
import { useAiScopes } from "@/components/ai/context";
import { NewChatIcon, PraxisMark } from "@/components/ai/icons";
import { groupConversations } from "@/components/ai/thread";
import type { AiConversationMeta } from "@/lib/ai-api";

export function AiHistoryRail({
  conversations,
  loading,
  activeId,
  onOpen,
  onNew,
  scope,
  onScope,
  busy,
}: {
  conversations: AiConversationMeta[];
  loading: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  scope: string;
  onScope: (key: string) => void;
  busy: boolean;
}) {
  const [q, setQ] = React.useState("");
  const scopes = useAiScopes();

  const groups = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? conversations.filter((c) => (c.title || "").toLowerCase().includes(needle))
      : conversations;
    return groupConversations(list);
  }, [conversations, q]);

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
          <h3 id="ai-spaces" className="micro px-2 pb-1 uppercase text-muted-foreground">
            Spaces
          </h3>
          <ul className="space-y-0.5">
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
                    <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center">
                      {s.key === "all" ? <PraxisMark width={13} height={13} /> : <Icon width={14} height={14} />}
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
              {q ? "No conversation matches that." : "No conversations yet. Ask something to start one."}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.heading} className="mb-3">
                <h4 className="micro px-2 pb-1 uppercase text-muted-foreground">{g.heading}</h4>
                <ul className="space-y-0.5">
                  {g.items.map((c) => {
                    const on = c.conversation_id === activeId;
                    return (
                      <li key={c.conversation_id}>
                        <button
                          type="button"
                          onClick={() => onOpen(c.conversation_id)}
                          aria-current={on ? "true" : undefined}
                          className={cn(
                            "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
                            on ? "bg-accent" : "hover:bg-accent/60",
                          )}
                        >
                          <span
                            className={cn(
                              "line-clamp-1 text-sm",
                              on ? "font-medium text-foreground" : "text-foreground/90",
                            )}
                          >
                            {c.title || "Untitled conversation"}
                          </span>
                          <span className="micro text-muted-foreground">
                            {new Date(c.last_at).toLocaleDateString()} · {c.message_count} message
                            {c.message_count === 1 ? "" : "s"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
