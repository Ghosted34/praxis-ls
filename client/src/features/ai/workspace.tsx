/**
 * Praxis AI — the full workspace at `/ai`.
 *
 * THE SHAPE: three panes, the outer two collapsible.
 *
 *   left    Spaces + conversation history (`history-rail.tsx`).
 *   centre  The thread, on a reading-width column, with the composer under it.
 *   right   Canvas / Table / Record / Sources (`right-pane.tsx`).
 *
 * WHY THREE AND NOT TWO. An ERP answer is rarely just prose. "What's overdue"
 * has rows behind it; "draft the reminder" has a document behind it; every
 * figure has a record behind it. A two-pane assistant has to choose between
 * showing you those inline — where a twenty-row table is unreadable and
 * unsortable — or making you leave the conversation to see them. The third pane
 * is what lets an answer keep its prose in the thread and put its OUTPUT
 * somewhere it can be worked with.
 *
 * IT KEEPS THE SHELL AND DROPS THE PAGE HEADER — the only screen that does.
 *
 * The ribbon and the icon rail stay, because the alternative — hiding the
 * chrome for a distraction-free canvas — would make the assistant feel like a
 * separate product bolted to the side of the ERP, when the entire proposition
 * is that it is inside it and acting as you.
 *
 * But `PageHeader` goes. Every other screen earns one: it names what you are
 * about to read before you read it. This screen is not something you read, it
 * is a room you work in, and the header was spending the top eighth of that
 * room restating the ribbon tab immediately above it. The full height goes to
 * the thread instead, and the permissions assurance it used to carry now sits
 * under the composer, where the person about to ask a question can see it.
 *
 * That exception should stay singular. A product where every screen argues for
 * its own chrome has no chrome; the argument here is that this is the only
 * route whose content is a conversation rather than a record.
 *
 * ITS RELATIONSHIP TO THE DRAWER. Same thread state (`useAiThread`), same
 * composer, same turn rendering. The drawer's middle button lands here with
 * `?c=<conversation_id>`, so "this needs more room" is one click and loses
 * nothing. The one deliberate divergence: the drawer starts fresh every open,
 * this restores — a panel you flicked open over a screen and a page you
 * navigated to on purpose are different intentions.
 */
import * as React from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";
import { useAiEnabled } from "@/components/ai-actions";
import { useAuth } from "@/app/auth/auth-context";
import { AiComposer, type ComposerValue } from "@/components/ai/composer";
import {
  AiThinking,
  AiTurnView,
  hasOutput,
  outputFor,
  type TurnOutput,
} from "@/components/ai/turn";
import { useAiThread, type AiTurn } from "@/components/ai/thread";
import {
  DESK_STARTERS,
  scopeByKey,
  useAiScopes,
  type AiMode,
} from "@/components/ai/context";
import {
  extractSources,
  extractTables,
  mergeSources,
  type AiSource,
  type AiTable,
} from "@/components/ai/grounding";
import {
  PanelLeftIcon,
  PanelRightIcon,
  PraxisMarkLarge,
} from "@/components/ai/icons";
import { PlusIcon } from "@/components/ui/icons";
import { AiHistoryRail } from "./history-rail";
import { AiRightPane, EMPTY_PANE, type PaneState } from "./right-pane";

/** Rail/pane open state, remembered — a layout you chose should stay chosen. */
const LAYOUT_KEY = "praxis.ai.workspace.panes";

function storedLayout(): { left: boolean; right: boolean } {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw)
      return { left: true, right: false, ...(JSON.parse(raw) as object) };
  } catch {
    /* private mode — defaults are fine */
  }
  // Right starts CLOSED: it has nothing in it until an answer puts something
  // there, and a pane that opens empty teaches the user it is usually empty.
  return { left: true, right: false };
}

export function AiWorkspace() {
  const aiEnabled = useAiEnabled();
  const { user } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const scopes = useAiScopes();

  // The drawer hands the thread over through `?c=`, and its composer state
  // through router state, so expanding preserves what you had pointed at.
  const handed = location.state as { scope?: string; mode?: AiMode } | null;
  const thread = useAiThread("restore", params.get("c"));

  const [composer, setComposer] = React.useState<ComposerValue>({
    scope: handed?.scope ?? "all",
    mode: handed?.mode ?? "ask",
  });
  const [layout, setLayout] = React.useState(storedLayout);
  const [pane, setPane] = React.useState<PaneState>(EMPTY_PANE);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* see storedLayout */
    }
  }, [layout]);

  // History is loaded once, for the rail. Not on every thread switch: switching
  // conversations does not change which conversations exist.
  React.useEffect(() => {
    if (aiEnabled) thread.loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEnabled]);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.turns, thread.busy]);

  /**
   * Every source the conversation has cited, newest answer first.
   *
   * Recomputed across the whole thread rather than accumulated as answers
   * arrive: switching conversations has to REPLACE this list, and a list built
   * by accumulation would carry the last thread's records into the next one —
   * which, on a screen whose whole job is provenance, is the worst possible bug.
   */
  const allSources: AiSource[] = React.useMemo(() => {
    const out: AiSource[] = [];
    for (let i = thread.turns.length - 1; i >= 0; i--) {
      const t = thread.turns[i];
      if (t.role !== "assistant") continue;
      out.push(...mergeSources(extractSources(t.text), t.sources));
    }
    const seen = new Set<string>();
    return out.filter((s) =>
      seen.has(s.href) ? false : (seen.add(s.href), true),
    );
  }, [thread.turns]);

  React.useEffect(() => {
    setPane((p) => ({ ...p, sources: allSources }));
  }, [allSources]);

  /**
   * Every table the conversation has produced, newest answer first.
   *
   * STACKED, LIKE SOURCES, and for the same reason. The pane used to hold only
   * the latest answer's tables, so asking a follow-up silently destroyed the
   * comparison you were in the middle of making — the 20%-margin scenario you
   * had open vanished the moment you asked what 25% would look like. Both halves
   * of that comparison have to be on screen at once or the pane is answering a
   * question nobody asked.
   *
   * Recomputed across the thread rather than accumulated as answers arrive, so
   * switching conversations REPLACES the list instead of carrying the last
   * thread's numbers into the next one. Deduplicated on title + shape, because
   * an answer that restates a table it already showed should not double it.
   */
  const allTables: AiTable[] = React.useMemo(() => {
    const out: AiTable[] = [];
    const seen = new Set<string>();
    for (let i = thread.turns.length - 1; i >= 0; i--) {
      const t = thread.turns[i];
      if (t.role !== "assistant" || t.failed) continue;
      for (const table of extractTables(t.text)) {
        const key = `${table.title}|${table.header.join("|")}|${table.rows.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(table);
      }
    }
    return out;
  }, [thread.turns]);

  /**
   * THE PANE FILLS ITSELF. This is the behaviour that was missing.
   *
   * Before this, an answer's tables and drafts sat inert until you found the
   * small canvas icon in a hover toolbar and clicked it — which meant that in
   * practice nobody ever saw the right pane do anything, and it read as three
   * empty tabs and a broken feature. An answer that produced a seven-table
   * financial model showed you an empty panel until you went looking.
   *
   * So: every new assistant turn populates the pane and opens it, on the richest
   * thing it produced — tables first, then the document. Nothing to click.
   *
   * IT TRACKS THE LATEST ANSWER, not a pinned one. The pane is a view of the
   * conversation's current state, so a new answer replaces it; the toolbar on an
   * older turn is how you deliberately go back to that one (`openOutput`).
   *
   * WHY IT DOES NOT FIGHT YOU. Two separate questions, deliberately kept apart:
   * WHAT the pane shows follows the latest answer continuously, so a table that
   * is still arriving keeps filling in; WHETHER the pane opens fires once per
   * answer. Close it mid-stream and it stays closed until the NEXT answer, with
   * its content quietly kept current behind it. Tying both to the turn id — the
   * original design — is what broke it: see `lastOutput` below.
   */
  const lastAnswer = React.useMemo(() => {
    for (let i = thread.turns.length - 1; i >= 0; i--) {
      if (thread.turns[i].role === "assistant") return thread.turns[i];
    }
    return null;
  }, [thread.turns]);

  /**
   * What the latest answer has produced SO FAR.
   *
   * Recomputed as the answer streams, which is the correction to the bug that
   * made this whole pane look broken. The old effect claimed the turn id and
   * returned:
   *
   *     if (!lastAnswer || filledFor.current === lastAnswer.id) return;
   *     filledFor.current = lastAnswer.id;          // ← claimed too early
   *     if (!hasOutput(outputFor(lastAnswer))) return;
   *
   * A streamed answer is created as an EMPTY assistant turn the moment you press
   * send (`thread.ts`), so the effect ran once against empty text, burned the id
   * on an answer that had nothing in it yet, and was then permanently barred
   * from that turn. Every token that followed — including the seven tables —
   * arrived under an id the effect had already dismissed. The pane went on
   * showing the PREVIOUS answer's output, which is why the table on screen never
   * matched the answer above it.
   */
  const lastOutput = React.useMemo<TurnOutput>(
    () => (lastAnswer ? outputFor(lastAnswer) : { tables: [], artifact: null }),
    [lastAnswer],
  );

  /**
   * The answer the user pulled up by hand from an older turn's toolbar.
   *
   * Without it, keeping the pane in sync with the streaming answer would yank a
   * deliberately-opened older output away again on the next token. A NEW answer
   * still wins — the pane is a view of where the conversation is now — so this
   * is cleared as soon as the latest answer changes.
   */
  const [pinned, setPinned] = React.useState<string | null>(null);

  /** The turn we last tracked, and the turn we last auto-OPENED the pane for. */
  const trackedId = React.useRef<string | null>(null);
  const openedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!lastAnswer) return;
    if (trackedId.current !== lastAnswer.id) {
      trackedId.current = lastAnswer.id;
      setPinned(null);
    }
    if (pinned) return;
    if (!hasOutput(lastOutput)) return;

    // The id is claimed HERE — on the first render where the answer actually has
    // something in it — not on sight of the turn. That single move is the fix.
    const firstFill = openedFor.current !== lastAnswer.id;
    setPane((p) => ({
      ...p,
      // Tables stack across the thread; the canvas does not. A document is a
      // single artefact you are reading — three drafts stacked in one scroll is
      // not a canvas, it is a pile — whereas tables are data you compare.
      output: { tables: allTables, artifact: lastOutput.artifact },
      // The tab is chosen once, when the pane opens for this answer. Re-choosing
      // it on every token would drag the user off Sources mid-read.
      ...(firstFill
        ? {
            tab: lastOutput.tables.length
              ? ("table" as const)
              : ("canvas" as const),
          }
        : {}),
    }));
    if (firstFill) {
      openedFor.current = lastAnswer.id;
      // Still once per answer: close the pane and it stays closed until the NEXT
      // one arrives. Content keeps refreshing behind it either way.
      setLayout((l) => (l.right ? l : { ...l, right: true }));
    }
  }, [lastAnswer, lastOutput, allTables, pinned]);

  /**
   * Tables are kept current INDEPENDENTLY of the effect above, the same way
   * sources are.
   *
   * That effect is gated on the latest answer having output of its own, because
   * that gate is what decides whether to intrude by opening the pane. Tying the
   * table list to it too would mean a thread whose newest answer is a one-line
   * "yes, that's right" quietly emptied the pane of the five tables above it —
   * the pane going blank because the LAST thing said happened to contain no rows.
   */
  React.useEffect(() => {
    if (pinned) return;
    setPane((p) =>
      p.output.tables === allTables
        ? p
        : { ...p, output: { ...p.output, tables: allTables } },
    );
  }, [allTables, pinned]);

  // Keep the URL pointing at the thread on screen, so the page is refreshable
  // and shareable. `replace`, so switching conversations does not stack a dozen
  // history entries between the user and the page they arrived from.
  React.useEffect(() => {
    if (!thread.conversationId || params.get("c") === thread.conversationId)
      return;
    setParams({ c: thread.conversationId }, { replace: true });
  }, [thread.conversationId, params, setParams]);

  // AI off for the tenant: nothing here to show, and the nav entry is hidden
  // too, so a direct URL goes home (doc/AI_GATE_BE_HANDOFF.md).
  if (!aiEnabled) return <Navigate to="/" replace />;

  /** Manual re-open, from an older answer's toolbar. Auto-population handles
   *  the latest one; this is how you pull a previous answer's output back.
   *  Pinning it stops the live answer's sync from taking it straight back. */
  function openOutput(turn: AiTurn, output: TurnOutput) {
    setPinned(turn.id);
    setPane((p) => ({
      ...p,
      tab: output.tables.length ? "table" : "canvas",
      output,
    }));
    setLayout((l) => ({ ...l, right: true }));
  }

  const empty =
    thread.turns.length === 0 && !thread.busy && !thread.loadingHistory;
  const activeScope = scopeByKey(scopes, composer.scope);
  const title = thread.turns.find((t) => t.role === "user")?.text;

  return (
    /*
      NO PAGE HEADER — the one screen in the product that gets to skip it.

      Every other screen opens with `PageHeader`: eyebrow, title, a line of
      description. That contract is right for a screen you arrive at to READ,
      because the header says what you are looking at before you look at it.
      This screen is a room you arrive to WORK in, and the header was spending
      the top eighth of it restating what the ribbon tab already said —
      "Praxis AI › Assistant", above a thread that then had to fight for the
      remaining height.

      The assurance line it carried is not lost; it was always in two places at
      once. It lives under the composer, where somebody about to type a question
      about live financial data can actually see it, rather than above a
      transcript they have already scrolled past.

      Deliberately THE exception, and it should stay the only one. A product
      where every screen argues for its own chrome has no chrome, and the
      argument here is specific: this is the only route whose content is a
      conversation rather than a record.
    */
    <section
      className={cn(
        "flex h-full min-h-[36rem] flex-col",
        /*
          FULL-BLEED, from `md` up.

          `<main>` pads its content — `p-4 pb-24 md:p-6 md:pb-6 2xl:px-8` — which
          is right for every screen that is a document on a page. This one is not
          a document on a page; it is the page. Sat inside that padding, and
          wrapped in the rounded bordered card this used to have, it read as a
          large modal floating on an empty surface rather than as a screen. The
          negative margins cancel the padding so the rails reach the window edge,
          and the height is grown by the same amount so the bottom does not fall
          short of it.

          The exception lives HERE rather than in the shell, deliberately: the
          shell should not know the name of a route. The cost is that these
          numbers mirror `app-shell.tsx`'s padding and would need changing with
          it — which is why they are spelled out rather than hidden in a utility.

          NOT below `md`. There the padding includes `pb-24`, which is clearance
          for the mobile bottom nav — bleeding into it would put the composer
          underneath the navigation bar.
        */
        "md:-m-6 md:h-[calc(100%+3rem)] 2xl:-mx-8",
      )}
    >
      {/*
        No border, no radius, no card. The panes ARE the page; each brings its
        own edge (`border-r` on the rail, `border-l` on the answer panel), which
        is what a three-pane application looks like — as opposed to a box that
        happens to contain three columns.
      */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-background">
        {/* LEFT RAIL. Static from `lg`; an overlay below it, because at 1024px
            three columns plus a reading measure is not three columns, it is
            three gutters. */}
        {layout.left && (
          <>
            <div
              aria-hidden
              onClick={() => setLayout((l) => ({ ...l, left: false }))}
              className="absolute inset-0 z-10 bg-black/20 lg:hidden"
            />
            <aside
              aria-label="Spaces and conversations"
              className="absolute inset-y-0 left-0 z-20 w-[17rem] shrink-0 border-r border-border lg:static lg:z-auto"
            >
              <AiHistoryRail
                conversations={thread.conversations}
                loading={thread.loadingConversations}
                activeId={thread.conversationId}
                busy={thread.busy}
                scope={composer.scope}
                onScope={(key) => setComposer((c) => ({ ...c, scope: key }))}
                onOpen={(id) => {
                  thread.openConversation(id);
                  setPane(EMPTY_PANE);
                  setPinned(null);
                }}
                onNew={() => {
                  thread.newThread();
                  setPane(EMPTY_PANE);
                  setPinned(null);
                }}
              />
            </aside>
          </>
        )}

        {/* CENTRE */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <PaneToggle
              label={layout.left ? "Hide conversations" : "Show conversations"}
              on={layout.left}
              onClick={() => setLayout((l) => ({ ...l, left: !l.left }))}
            >
              <PanelLeftIcon />
            </PaneToggle>

            <div className="min-w-0 flex-1 text-center">
              <span className="truncate text-label font-medium text-muted-foreground">
                {title ? title.slice(0, 80) : "New conversation"}
              </span>
              {activeScope.key !== "all" && (
                <span className="micro ml-2 rounded-full bg-primary/12 px-2 py-0.5 text-primary-ink">
                  {activeScope.label}
                </span>
              )}
            </div>

            {/*
              NEW CONVERSATION, as a `+` rather than a labelled button in a page
              header. It sits with the two pane toggles because it belongs to the
              same class of control — things that change what this frame is
              showing — and because that is where the eye already goes when the
              answer on screen is finished with.

              Icon-only is affordable here in a way it would not be alone: the
              tooltip names it, `aria-label` names it, and it is flanked by two
              controls the user has already learned. A lone unlabelled `+` in a
              page header would be a guess.
            */}
            <Tooltip content="New conversation">
              <button
                type="button"
                onClick={() => {
                  thread.newThread();
                  setPane(EMPTY_PANE);
                  setPinned(null);
                }}
                disabled={thread.busy}
                aria-label="Start a new conversation"
                className="tap-24 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-primary-ink disabled:opacity-40"
              >
                <PlusIcon width={16} height={16} />
              </button>
            </Tooltip>

            <span aria-hidden className="h-4 w-px bg-border" />

            <PaneToggle
              label={layout.right ? "Hide answer panel" : "Show answer panel"}
              on={layout.right}
              onClick={() => setLayout((l) => ({ ...l, right: !l.right }))}
            >
              <PanelRightIcon />
            </PaneToggle>
          </div>

          {empty ? (
            <Landing
              name={user?.display_name}
              onPick={(prompt) => thread.send(prompt, composer)}
              composer={composer}
              onComposerChange={setComposer}
              onSend={(text, opts) => thread.send(text, opts)}
              busy={thread.busy}
            />
          ) : (
            <>
              <div
                ref={bodyRef}
                className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
              >
                <div className="mx-auto flex max-w-reading flex-col gap-6">
                  {thread.loadingHistory && thread.turns.length === 0 && (
                    <p className="micro text-muted-foreground">
                      Loading this conversation…
                    </p>
                  )}
                  {thread.turns.map((t, i) => (
                    <AiTurnView
                      key={t.id}
                      turn={t}
                      isLast={i === thread.turns.length - 1}
                      busy={thread.busy}
                      onRetry={thread.retry}
                      onConfirmAction={thread.confirmAction}
                      confirming={thread.confirming}
                      doneActions={thread.doneActions}
                      onOpenCanvas={openOutput}
                    />
                  ))}
                  {thread.busy &&
                    (() => {
                      // Hide the generic indicator once the turn has something
                      // better to say for itself: a growing answer IS the thinking,
                      // and a status line names the step. "Praxis is working…"
                      // stacked above "Reading the dossier 360°…" is two spinners
                      // for one wait.
                      const last = thread.turns[thread.turns.length - 1];
                      const speaking =
                        last &&
                        last.role === "assistant" &&
                        (last.text.length > 0 || !!last.status);
                      return speaking ? null : <AiThinking />;
                    })()}
                </div>
              </div>

              <div className="border-t border-border px-4 py-3">
                <div className="mx-auto max-w-reading">
                  <AiComposer
                    value={composer}
                    onValueChange={setComposer}
                    onSend={(text, opts) => thread.send(text, opts)}
                    busy={thread.busy}
                  />
                  <p className="micro mt-2 text-center text-muted-foreground">
                    Praxis acts with your permissions only — writes always ask
                    first.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* RIGHT PANE */}
        {layout.right && (
          <>
            <div
              aria-hidden
              onClick={() => setLayout((l) => ({ ...l, right: false }))}
              className="absolute inset-0 z-10 bg-black/20 xl:hidden"
            />
            <aside
              aria-label="Answer panel"
              className="absolute inset-y-0 right-0 z-20 w-[min(26rem,92vw)] shrink-0 border-l border-border xl:static xl:z-auto"
            >
              <AiRightPane
                state={pane}
                onChange={setPane}
                onClose={() => setLayout((l) => ({ ...l, right: false }))}
              />
            </aside>
          </>
        )}
      </div>
    </section>
  );
}

function PaneToggle({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={on}
        className={cn(
          "tap-24 grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors",
          on
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The landing state — greeting, composer, suggestion deck.
 *
 * VERTICALLY CENTRED, not top-aligned. An empty thread top-aligned leaves a
 * screen of dead space under it and reads as a page that failed to load; centred
 * it reads as an invitation. It re-anchors to the top the moment there is a
 * turn, which is where a transcript belongs.
 *
 * THE DECK STATES QUESTIONS, NOT FIGURES. A card reading "3 invoices overdue"
 * needs a briefing endpoint behind it, and inventing the 3 would be a lie
 * printed on the first screen of an accounting product. The cards ask the
 * question instead — the count arrives with the answer, from the ledger. The
 * `badge` slot is where a real figure goes when there is a real endpoint for it.
 */
function Landing({
  name,
  onPick,
  composer,
  onComposerChange,
  onSend,
  busy,
}: {
  name?: string;
  onPick: (prompt: string) => void;
  composer: ComposerValue;
  onComposerChange: (v: ComposerValue) => void;
  onSend: (text: string, opts: ComposerValue) => void;
  busy: boolean;
}) {
  const hour = new Date().getHours();
  const part =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // First name only. "Good afternoon, Blake" is a greeting; "Good afternoon,
  // Blake Asaah Tom" is a mail merge.
  const first = (name || "").trim().split(/\s+/)[0];

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8">
      <div className="w-full max-w-reading">
        <div className="mb-5 flex flex-col items-center text-center">
          <span
            aria-hidden
            className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/12 text-primary-ink"
          >
            <PraxisMarkLarge />
          </span>
          <h2 className="font-display text-h2 font-semibold tracking-tight">
            {part}
            {first ? `, ${first}` : ""}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask about anything on your desk — receivables, operation files,
            costing, procurement.
          </p>
        </div>

        <AiComposer
          size="hero"
          focusOnMount
          value={composer}
          onValueChange={onComposerChange}
          onSend={onSend}
          busy={busy}
          placeholder="Ask Praxis anything…"
        />

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {DESK_STARTERS.map((s) => (
            <button
              key={s.prompt}
              type="button"
              onClick={() => onPick(s.prompt)}
              className="group/card rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-primary/[0.04]"
            >
              <span className="block text-label font-semibold text-foreground transition-colors group-hover/card:text-primary-ink">
                {s.label}
              </span>
              <span className="micro mt-0.5 line-clamp-2 block text-muted-foreground">
                {s.prompt}
              </span>
            </button>
          ))}
        </div>

        <p className="micro mt-5 text-center text-muted-foreground">
          Praxis acts with your permissions only — writes always ask first.
        </p>
      </div>
    </div>
  );
}
