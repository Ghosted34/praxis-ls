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
 * WHY IT IS A NORMAL PAGE. It keeps the ribbon, the icon rail and a standard
 * `PageHeader`, and it is reached from Overview like any other destination.
 * The alternative — hiding the chrome for a distraction-free canvas — would
 * make the assistant feel like a separate product bolted to the side of the
 * ERP, when the entire proposition is that it is inside it and acting as you.
 * The immersion is bought instead with a quiet conversation bar inside the
 * workspace frame, which is where it costs nothing.
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
import { PageHeader } from "@/components/data-list";
import { Tooltip } from "@/components/ui/tooltip";
import { useAiEnabled } from "@/components/ai-actions";
import { useAuth } from "@/app/auth/auth-context";
import { AiComposer, type ComposerValue } from "@/components/ai/composer";
import { AiThinking, AiTurnView, type TurnCanvas } from "@/components/ai/turn";
import { useAiThread, type AiTurn } from "@/components/ai/thread";
import { DESK_STARTERS, scopeByKey, useAiScopes, type AiMode } from "@/components/ai/context";
import { extractSources, mergeSources, type AiSource } from "@/components/ai/grounding";
import { NewChatIcon, PanelLeftIcon, PanelRightIcon, PraxisMarkLarge } from "@/components/ai/icons";
import { AiHistoryRail } from "./history-rail";
import { AiRightPane, EMPTY_PANE, type PaneState } from "./right-pane";

/** Rail/pane open state, remembered — a layout you chose should stay chosen. */
const LAYOUT_KEY = "praxis.ai.workspace.panes";

function storedLayout(): { left: boolean; right: boolean } {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return { left: true, right: false, ...(JSON.parse(raw) as object) };
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
    return out.filter((s) => (seen.has(s.href) ? false : (seen.add(s.href), true)));
  }, [thread.turns]);

  React.useEffect(() => {
    setPane((p) => ({ ...p, sources: allSources }));
  }, [allSources]);

  // Keep the URL pointing at the thread on screen, so the page is refreshable
  // and shareable. `replace`, so switching conversations does not stack a dozen
  // history entries between the user and the page they arrived from.
  React.useEffect(() => {
    if (!thread.conversationId || params.get("c") === thread.conversationId) return;
    setParams({ c: thread.conversationId }, { replace: true });
  }, [thread.conversationId, params, setParams]);

  // AI off for the tenant: nothing here to show, and the nav entry is hidden
  // too, so a direct URL goes home (doc/AI_GATE_BE_HANDOFF.md).
  if (!aiEnabled) return <Navigate to="/" replace />;

  function openCanvas(_turn: AiTurn, canvas: TurnCanvas) {
    setPane((p) => ({ ...p, tab: canvas.kind === "table" ? "table" : "canvas", canvas }));
    setLayout((l) => ({ ...l, right: true }));
  }

  const empty = thread.turns.length === 0 && !thread.busy && !thread.loadingHistory;
  const activeScope = scopeByKey(scopes, composer.scope);
  const title = thread.turns.find((t) => t.role === "user")?.text;

  return (
    <section className="flex h-full min-h-[36rem] flex-col">
      <PageHeader
        eyebrow="Praxis AI"
        title="Assistant"
        description="Reads freely across everything you have access to · writes always ask for your sign-off · acts with your permissions, as you."
        action={
          <button
            type="button"
            onClick={() => {
              thread.newThread();
              setPane(EMPTY_PANE);
            }}
            disabled={thread.busy}
            className="btn-surface inline-flex h-9 items-center gap-2 rounded-md px-3 text-[13px] font-medium disabled:opacity-50"
          >
            <NewChatIcon width={15} height={15} />
            New conversation
          </button>
        }
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
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
                }}
                onNew={() => {
                  thread.newThread();
                  setPane(EMPTY_PANE);
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
              <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
                <div className="mx-auto flex max-w-reading flex-col gap-6">
                  {thread.loadingHistory && thread.turns.length === 0 && (
                    <p className="micro text-muted-foreground">Loading this conversation…</p>
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
                      onOpenCanvas={openCanvas}
                    />
                  ))}
                  {thread.busy && <AiThinking />}
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
                    Praxis acts with your permissions only — writes always ask first.
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
          on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
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
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // First name only. "Good afternoon, Blake" is a greeting; "Good afternoon,
  // Blake Asaah Tom" is a mail merge.
  const first = (name || "").trim().split(/\s+/)[0];

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8">
      <div className="w-full max-w-reading">
        <div className="mb-5 flex flex-col items-center text-center">
          <span aria-hidden className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/12 text-primary-ink">
            <PraxisMarkLarge />
          </span>
          <h2 className="font-display text-h2 font-semibold tracking-tight">
            {part}
            {first ? `, ${first}` : ""}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask about anything on your desk — receivables, operation files, costing, procurement.
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
              <span className="micro mt-0.5 line-clamp-2 block text-muted-foreground">{s.prompt}</span>
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
