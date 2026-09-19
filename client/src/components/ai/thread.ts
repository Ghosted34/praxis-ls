/**
 * One conversation, as state — shared by the drawer and the workspace.
 *
 * WHY IT IS A HOOK AND NOT TWO COMPONENTS' WORTH OF `useState`. The drawer and
 * the full page are the same conversation seen through two windows: the middle
 * button in the drawer's header opens the page ON the thread you were just in.
 * If each surface owned its own send/confirm/restore logic, "expand" would be a
 * hand-off between two implementations that had already drifted — the copilot's
 * panel and the page would disagree about what a failed send looks like, or
 * whether a confirmed action collapses. There is one implementation, and the
 * two surfaces differ only in what they draw.
 *
 * THE TWO START MODES ARE THE ACTUAL PRODUCT DECISION HERE.
 *
 *   fresh    The drawer. Every open is a NEW thread. You opened it from a
 *            screen, about that screen; inheriting yesterday's conversation
 *            about receivables into a question about a delivery note is how the
 *            old floating panel made people distrust it. Past threads are not
 *            lost — they are on the full page, which is where browsing
 *            conversations belongs and where there is room to do it.
 *   restore  The workspace. Loads a specific thread (deep link) or the current
 *            rolling one, because a page you navigated to deliberately should
 *            be where you left off.
 *
 * PERSISTENCE IS THE BACKEND'S. The transcript lives in `ai_message`, so
 * nothing here tries to cache it — a reload re-reads it, and two devices see
 * one thread.
 */
import * as React from "react";
import {
  askPraxisStream,
  classifyAiFailure,
  clearAiHistory,
  confirmAiAction,
  deleteAiConversation,
  fetchAiHistory,
  listAiConversations,
  patchAiConversation,
  type AiActionRun,
  type AiConversationMeta,
  type AiConversationPatch,
  type AiFailure,
  type AiSourceLike,
} from "@/lib/ai-api";
import { errMsg } from "@/lib/use-resource";
import type { AiMode } from "./context";

export type AiTurn = {
  /** Stable across re-renders. Keys the list and anchors the hover toolbar. */
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Write-actions the assistant proposes. Always AWAITING_CONFIRM. */
  actions?: AiActionRun[];
  batchId?: string | null;
  /** Structured sources, when the backend sends them. See `AskResult.sources`. */
  sources?: AiSourceLike[];
  /** Steps taken, when the backend sends them. Renders the trace disclosure. */
  trace?: string[];
  /**
   * What the assistant is doing RIGHT NOW, while it is doing it.
   *
   * Ephemeral by design: replaced on each step, cleared the moment the reply
   * starts arriving, never persisted and never part of `text`. It exists so a
   * turn that spends fifteen seconds reading six records has something honest to
   * show, without that narration ending up in the answer — which is exactly what
   * happened when the two shared a channel.
   */
  status?: string;
  /** What the user had the composer pointed at. Shown as meta on their turn. */
  scope?: string;
  mode?: AiMode;
  /** A failed send. Drawn as an error, and retryable. */
  failed?: boolean;
  /**
   * WHY the turn failed, when it did (audit G4).
   *
   * `transient` (a drop, a 5xx, a timeout) and `provider` (the vendor chain is
   * misconfigured) both keep the retry button — see `classifyAiFailure` — but
   * only the second one is worth telling somebody about, because no number of
   * retries fixes a credential. Absent on a turn that did not fail.
   */
  failureKind?: AiFailure["kind"];
};

let seq = 0;
const nextId = () => `t${++seq}`;

export type ThreadStart = "fresh" | "restore";

export type UseAiThread = {
  turns: AiTurn[];
  busy: boolean;
  /** True while a stored transcript is being fetched. */
  loadingHistory: boolean;
  conversationId: string | null;
  send: (text: string, opts?: { scope?: string; mode?: AiMode }) => void;
  /** Re-send the question that produced `turn`, replacing its answer. */
  retry: (turn: AiTurn) => void;
  newThread: () => void;
  openConversation: (id: string) => void;
  /** Past threads, for the workspace's history rail. Empty until `loadConversations`. */
  conversations: AiConversationMeta[];
  loadingConversations: boolean;
  loadConversations: (opts?: { includeArchived?: boolean }) => void;
  /**
   * Pin, rename or archive one thread (audit J1-J3). Resolves once the server
   * has confirmed; the list is patched from the row it answers with.
   */
  patchConversation: (
    id: string,
    patch: AiConversationPatch,
  ) => Promise<void>;
  /** Remove one thread. `purge` is the irreversible half. */
  removeConversation: (
    id: string,
    opts?: { purge?: boolean },
  ) => Promise<void>;
  confirmAction: (run: AiActionRun, payload: Record<string, unknown>) => void;
  confirming: string | null;
  doneActions: Record<string, boolean>;
};

export function useAiThread(
  start: ThreadStart,
  initialConversationId?: string | null,
): UseAiThread {
  const [turns, setTurns] = React.useState<AiTurn[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [loadingHistory, setLoadingHistory] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | null>(
    initialConversationId ?? null,
  );
  const [conversations, setConversations] = React.useState<
    AiConversationMeta[]
  >([]);
  const [loadingConversations, setLoadingConversations] = React.useState(false);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [doneActions, setDoneActions] = React.useState<Record<string, boolean>>(
    {},
  );

  // The last thing asked, so `retry` can re-ask it without the caller holding it.
  const lastAsk = React.useRef<{
    text: string;
    scope?: string;
    mode?: AiMode;
  } | null>(null);

  /** Load a stored transcript into the thread. Shared by restore and switch. */
  const load = React.useCallback((id?: string) => {
    setLoadingHistory(true);
    fetchAiHistory(id)
      .then((h) => {
        setConversationId(h.conversation_id);
        // Grounding comes back WITH the transcript (0521). It used to be dropped
        // here — the map built `{id, role, text}` and threw `sources`/`trace`
        // away — so reopening a conversation emptied the Sources tab and removed
        // every trace disclosure from answers that visibly had both minutes
        // earlier. `?? undefined` because the columns are null for anything
        // stored before the migration, and the renderers test presence.
        setTurns(
          (h.messages || []).map((m) => ({
            id: m.ai_message_id || nextId(),
            role: m.role === "user" ? "user" : "assistant",
            text: m.content,
            sources: m.sources ?? undefined,
            trace: m.trace ?? undefined,
          })),
        );
      })
      // Silent. An assistant that cannot recall is still an assistant; greeting
      // someone with an error because the history read blinked is worse than
      // starting them on an empty thread they can immediately use.
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, []);

  // Mount behaviour, and the whole of the fresh/restore difference.
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (start === "restore") load(initialConversationId || undefined);
    // `fresh` does nothing on purpose: no conversation id, no transcript. The
    // first send creates the thread server-side and tells us its id.
  }, [start, initialConversationId, load]);

  // Abort controller for the active stream — cancelled when the user navigates
  // away, starts a new question, or clears the thread.
  const streamAbort = React.useRef<AbortController | null>(null);

  /**
   * Send a question, streaming the answer word-by-word.
   *
   * WHY STREAMING AND NOT THE OLD `askPraxis`. The non-streaming path waited
   * 5–15 seconds for the full completion before rendering anything — the user
   * stared at "Praxis is working…" with no indication of progress. Streaming
   * starts showing the first token within ~500ms, which is the difference
   * between "this is slow" and "this is typing".
   *
   * The assistant turn is created immediately with empty text and updated in
   * place as deltas arrive. Actions, sources, and trace arrive as discrete
   * events at the end and are merged into the same turn.
   *
   * FALLBACK. If the streaming endpoint is unreachable, `askPraxisStream`
   * internally falls back to the non-streaming `askPraxis` and yields a single
   * `answer` event — the rendering is identical, just not incremental.
   */
  const send = React.useCallback(
    (text: string, opts?: { scope?: string; mode?: AiMode }) => {
      const q = text.trim();
      if (!q || busy) return;
      lastAsk.current = { text: q, ...opts };

      // Cancel any in-flight stream (user asked a new question mid-answer).
      streamAbort.current?.abort();
      const abort = new AbortController();
      streamAbort.current = abort;

      // Add the user turn and an empty assistant turn that will grow.
      const userTurnId = nextId();
      const assistantTurnId = nextId();
      setTurns((t) => [
        ...t,
        {
          id: userTurnId,
          role: "user",
          text: q,
          scope: opts?.scope,
          mode: opts?.mode,
        },
        { id: assistantTurnId, role: "assistant", text: "" },
      ]);
      setBusy(true);

      // Consume the stream, updating the assistant turn in place.
      (async () => {
        let accText = "";
        let accActions: AiActionRun[] | undefined;
        let accBatchId: string | null | undefined;
        let accSources: AiSourceLike[] | undefined;
        let accTrace: string[] | undefined;

        try {
          for await (const event of askPraxisStream(
            q,
            conversationId || undefined,
            { scope: opts?.scope, mode: opts?.mode },
            abort.signal,
          )) {
            if (abort.signal.aborted) return;

            if (event.type === "delta") {
              accText += event.text;
              // Update the turn text in place. Using the stable id avoids
              // re-rendering the whole thread on every token.
              // The reply starting is what retires the status line — a step
              // description left standing under a finished answer reads as if
              // the assistant is still working.
              const snap = accText;
              setTurns((t) =>
                t.map((x) =>
                  x.id === assistantTurnId
                    ? { ...x, text: snap, status: undefined }
                    : x,
                ),
              );
            } else if (event.type === "status") {
              // REPLACED, not appended. This is one line saying what is
              // happening now, not a log — appending is how the last version
              // ended up showing the model's whole train of thought.
              const step = event.text;
              setTurns((t) =>
                t.map((x) =>
                  x.id === assistantTurnId ? { ...x, status: step } : x,
                ),
              );
            } else if (event.type === "reset") {
              // The server began an answer optimistically and then reached for a
              // tool, which means what we rendered was a preamble. Take it back
              // rather than leaving "Let me check that…" sitting above the real
              // reply forever.
              accText = "";
              setTurns((t) =>
                t.map((x) =>
                  x.id === assistantTurnId ? { ...x, text: "" } : x,
                ),
              );
            } else if (event.type === "answer") {
              accText = event.text || accText;
              const snap = accText;
              setTurns((t) =>
                t.map((x) =>
                  x.id === assistantTurnId
                    ? { ...x, text: snap, status: undefined }
                    : x,
                ),
              );
            } else if (event.type === "actions") {
              accActions = event.actions;
              accBatchId = event.batch_id;
              setTurns((t) =>
                t.map((x) =>
                  x.id === assistantTurnId
                    ? { ...x, actions: accActions, batchId: accBatchId }
                    : x,
                ),
              );
            } else if (event.type === "sources") {
              accSources = event.sources;
              setTurns((t) =>
                t.map((x) =>
                  x.id === assistantTurnId ? { ...x, sources: accSources } : x,
                ),
              );
            } else if (event.type === "trace") {
              accTrace = event.trace;
              setTurns((t) =>
                t.map((x) =>
                  x.id === assistantTurnId ? { ...x, trace: accTrace } : x,
                ),
              );
            } else if (event.type === "done") {
              if (event.conversation_id)
                setConversationId(event.conversation_id);
              // A completed turn that names no vendor is the provider chain
              // exhausted (audit B2/G4). It arrives looking like a perfectly
              // good answer — prose explaining the problem — so until now
              // nothing marked it, and the person got an explanation with no
              // control beside it.
              const why = classifyAiFailure({
                provider: event.provider,
                completed: true,
              });
              if (why)
                setTurns((t) =>
                  t.map((x) =>
                    x.id === assistantTurnId
                      ? {
                          ...x,
                          text: accText || why.message,
                          failed: true,
                          failureKind: why.kind,
                        }
                      : x,
                  ),
                );
            } else if (event.type === "error") {
              setTurns((t) =>
                t.map((x) =>
                  x.id === assistantTurnId
                    ? {
                        ...x,
                        text: event.message,
                        failed: true,
                        failureKind: "transient",
                      }
                    : x,
                ),
              );
            }
          }
        } catch (e) {
          if (!abort.signal.aborted) {
            const why: AiFailure =
              classifyAiFailure({ error: e }) ??
              { kind: "transient", message: errMsg(e) };
            setTurns((t) =>
              t.map((x) =>
                x.id === assistantTurnId
                  ? { ...x, text: why.message, failed: true, failureKind: why.kind }
                  : x,
              ),
            );
          }
        } finally {
          if (!abort.signal.aborted) {
            setBusy(false);
            // A status line is a claim that work is in progress. However the
            // stream ended — cleanly, in error, or by giving up — it is not, so
            // the line must not survive the turn.
            setTurns((t) =>
              t.map((x) =>
                x.id === assistantTurnId ? { ...x, status: undefined } : x,
              ),
            );
          }
          if (streamAbort.current === abort) streamAbort.current = null;
        }
      })();
    },
    [busy, conversationId],
  );

  /**
   * Ask the last question again, dropping the answer it produced.
   *
   * Drops the FAILED/unwanted answer rather than appending a second one: a
   * thread that accumulates every rejected attempt is unreadable, and the whole
   * point of retry is that the first answer was not the one you wanted.
   */
  const retry = React.useCallback(
    (turn: AiTurn) => {
      if (busy || !lastAsk.current) return;
      setTurns((t) => {
        const i = t.findIndex((x) => x.id === turn.id);
        return i === -1 ? t : t.slice(0, i);
      });
      const { text, scope, mode } = lastAsk.current;
      // Deferred a tick so the removal above has committed before the re-ask
      // appends the user turn again.
      setTimeout(() => send(text, { scope, mode }), 0);
    },
    [busy, send],
  );

  const newThread = React.useCallback(() => {
    // Abort any in-flight stream before clearing.
    streamAbort.current?.abort();
    streamAbort.current = null;
    setBusy(false);
    setTurns([]);
    setDoneActions({});
    lastAsk.current = null;
    // The old thread is RETAINED, not deleted — `ai_action_run` rows reference
    // it, and the history rail is the point of keeping it.
    clearAiHistory()
      .then((h) => setConversationId(h.conversation_id))
      .catch(() => setConversationId(null));
  }, []);

  const openConversation = React.useCallback(
    (id: string) => {
      if (busy || id === conversationId) return;
      setDoneActions({});
      load(id);
    },
    [busy, conversationId, load],
  );

  /**
   * Whether the rail is currently showing archived threads.
   *
   * Held in a ref rather than state because nothing RENDERS from it — it exists
   * so that a reload triggered by a mutation asks for the same view the user is
   * looking at. Putting it in state would re-render every consumer of this hook
   * to change a query string.
   */
  const withArchived = React.useRef(false);

  const loadConversations = React.useCallback(
    (opts?: { includeArchived?: boolean }) => {
      if (opts?.includeArchived !== undefined) {
        withArchived.current = opts.includeArchived;
      }
      setLoadingConversations(true);
      listAiConversations({ includeArchived: withArchived.current })
        .then(setConversations)
        .catch(() => setConversations([]))
        .finally(() => setLoadingConversations(false));
    },
    [],
  );

  /**
   * Pin, rename or archive one thread (audit J1-J3).
   *
   * NOT OPTIMISTIC, DELIBERATELY. Three of these four properties are cheap to
   * get back if the call fails, but the fourth is archive, and an archive that
   * appears to work and silently did not is a thread the user believes they
   * have put away. Waiting for the row the server answers with also settles
   * rename properly: clearing the title restores the DERIVED one — the first
   * user message, trimmed — which the client has no way to compute, so an
   * optimistic write would flash a wrong title and then correct itself.
   *
   * ARCHIVING THE THREAD YOU ARE READING STARTS A NEW ONE. It has just left the
   * rail, and `currentConversation` server-side will not resume into it, so
   * carrying on typing in it would be the one state where the screen and the
   * backend disagree about which thread you are in.
   *
   * A thread that no longer belongs in the current view (archived, while the
   * archived section is closed) is dropped from the list rather than left in
   * it; everything else is replaced in place and re-ordered by
   * `groupConversations`, which applies the same pinned-first rule the server
   * does.
   */
  const patchConversation = React.useCallback(
    async (id: string, patch: AiConversationPatch) => {
      const row = await patchAiConversation(id, patch);
      const leaves = row.archived_at != null && !withArchived.current;
      setConversations((list) =>
        leaves
          ? list.filter((c) => c.conversation_id !== id)
          : list.map((c) => (c.conversation_id === id ? row : c)),
      );
      if (patch.archived === true && id === conversationId) newThread();
    },
    [conversationId, newThread],
  );

  /**
   * Remove one thread — soft by default, `purge` for the irreversible half.
   *
   * The row goes from the list either way: a soft delete is not "hidden with a
   * marker", it is the thread leaving, and the backend backs that up by
   * refusing to load it by id afterwards. Removing the thread on screen moves
   * to a fresh one, because the alternative is a transcript the user has just
   * deleted still sitting in front of them.
   */
  const removeConversation = React.useCallback(
    async (id: string, opts?: { purge?: boolean }) => {
      await deleteAiConversation(id, opts);
      setConversations((list) => list.filter((c) => c.conversation_id !== id));
      if (id === conversationId) newThread();
    },
    [conversationId, newThread],
  );

  /**
   * Execute one proposed action with the values the user edited in its form.
   *
   * Per-ACTION done state, not per-message: an answer proposing three actions
   * collapses them one at a time as each is confirmed, so the user can take two
   * of the three and leave the last.
   */
  const confirmAction = React.useCallback(
    (run: AiActionRun, payload: Record<string, unknown>) => {
      setConfirming(run.action_run_id);
      confirmAiAction(run.action_run_id, payload)
        .then((r) => {
          setDoneActions((s) => ({ ...s, [run.action_run_id]: true }));
          // The recap + auto-proposed next actions. `next_actions` is the snooze
          // fix: after confirming one step, the server auto-proposes the next one
          // instead of asking "shall I proceed?". The user sees the narration and
          // the new action card together — one click to confirm the next step.
          const nextActions = r.next_actions;
          if (r.message || nextActions?.length) {
            setTurns((t) => [
              ...t,
              {
                id: nextId(),
                role: "assistant",
                text: (r.message as string) || "",
                actions: nextActions?.length ? nextActions : undefined,
              },
            ]);
          }
        })
        .catch((e) =>
          setTurns((t) => [
            ...t,
            { id: nextId(), role: "assistant", text: errMsg(e), failed: true },
          ]),
        )
        .finally(() => setConfirming(null));
    },
    [],
  );

  return {
    turns,
    busy,
    loadingHistory,
    conversationId,
    send,
    retry,
    newThread,
    openConversation,
    conversations,
    loadingConversations,
    loadConversations,
    patchConversation,
    removeConversation,
    confirmAction,
    confirming,
    doneActions,
  };
}

/**
 * Group threads the way a person looks for one: pinned first, then by when they
 * last touched it.
 *
 * Buckets, not dates. Nobody remembers that they asked about the Douala file on
 * the 14th; they remember it was "the other day". Empty buckets are dropped so
 * the rail never shows a heading with nothing under it.
 *
 * PINNED IS A GROUP, NOT A MARKER ON A ROW (audit J2). A pin's whole job is
 * that the thread stops moving — leaving pinned rows inside the time buckets
 * and drawing an icon on them would mean the thread you pinned still slid from
 * "Today" to "Previous 7 days" and then out of the visible list, which is the
 * problem the pin was pressed to solve. Its own section at the top is the only
 * shape that holds.
 *
 * ORDERED THE SAME WAY THE SERVER ORDERS IT — pinned by `pinned_at` DESC, the
 * rest by `last_at` DESC. The list arrives already sorted, and re-deriving it
 * here rather than trusting the arrival order is what keeps a locally-patched
 * row (a pin the user just pressed) in the right place without a refetch.
 */
export function groupConversations(
  list: AiConversationMeta[],
): { heading: string; items: AiConversationMeta[] }[] {
  const now = Date.now();
  const DAY = 86_400_000;
  const at = (v?: string | null) => (v ? +new Date(v) : 0);

  const pinned = list
    .filter((c) => c.pinned_at != null)
    .sort((a, b) => at(b.pinned_at) - at(a.pinned_at));

  const buckets: {
    heading: string;
    max: number;
    items: AiConversationMeta[];
  }[] = [
    { heading: "Today", max: DAY, items: [] },
    { heading: "Yesterday", max: 2 * DAY, items: [] },
    { heading: "Previous 7 days", max: 7 * DAY, items: [] },
    { heading: "Previous 30 days", max: 30 * DAY, items: [] },
    { heading: "Older", max: Infinity, items: [] },
  ];
  for (const c of list
    .filter((c) => c.pinned_at == null)
    .sort((a, b) => at(b.last_at) - at(a.last_at))) {
    const age = now - at(c.last_at);
    (
      buckets.find((b) => age < b.max) ?? buckets[buckets.length - 1]
    ).items.push(c);
  }
  return [
    ...(pinned.length ? [{ heading: "Pinned", items: pinned }] : []),
    ...buckets
      .filter((b) => b.items.length)
      .map(({ heading, items }) => ({ heading, items })),
  ];
}
