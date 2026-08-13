/**
 * Praxis AI — the side drawer. Mounted once in the app shell, so it rides along
 * on every screen in the product.
 *
 * WHAT THIS REPLACES, AND WHY. The previous surface (`praxis-copilot.tsx`) was a
 * 380×560 floating card pinned above the FAB. Three things were wrong with it,
 * and all three are structural rather than cosmetic:
 *
 *   IT SAT ON THE WORK. `fixed bottom-40 right-5` is where a list screen's last
 *   rows and its pager are — the same objection the audit raised against the
 *   draggable FAB (F9). A panel you have to move to read the thing you are
 *   asking about is a panel fighting its own purpose.
 *
 *   IT WAS A FIXED, SMALL BOX. An answer with a table in it, or a proposed
 *   action with eight fields, had 380px and no way to ask for more. The drawer
 *   is drag-resizable and remembers where you put it.
 *
 *   IT WAS A HAND-ROLLED PANEL. No focus trap, no restoration, no scroll lock —
 *   exactly the set of failures `ui/dialog.tsx` documents and Radix solves. This
 *   is built on the same Radix primitive, so the drawer gets them for free.
 *
 * EVERY OPEN IS A NEW THREAD. This is the decision that most changes how the
 * drawer feels. You open it FROM a screen, ABOUT that screen; inheriting
 * yesterday's conversation about receivables into a question about a delivery
 * note is what made the old panel feel like it was not listening. Nothing is
 * lost — the thread is persisted server-side the moment you send, and past
 * conversations live on the full page, which is where browsing them belongs and
 * where there is room to do it. The drawer is for the question you have now.
 *
 * THE MIDDLE BUTTON IS THE HINGE. Header controls are New chat · Expand · Close,
 * and the middle one carries the current thread into `/ai`, so "this needs more
 * room" costs one click and loses nothing.
 *
 * OVERLAY, NOT PUSH. It dims the page rather than reflowing it: a drawer that
 * squeezes the layout re-lays-out every table underneath it on open, on close,
 * and on every pixel of a resize drag.
 */
import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import { useAiEnabled } from "@/components/ai-actions";
import { Tooltip } from "@/components/ui/tooltip";
import { XIcon } from "@/components/ui/icons";
import { AiComposer, type ComposerValue } from "@/components/ai/composer";
import { AiThinking, AiTurnView } from "@/components/ai/turn";
import { useAiThread } from "@/components/ai/thread";
import { scopeForPath, suggestionsFor, useAiScopes, useScreenContext } from "@/components/ai/context";
import { ExpandIcon, GripIcon, NewChatIcon, PraxisMark } from "@/components/ai/icons";

const WIDTH_KEY = "praxis.ai.drawer.width";
const MIN_W = 360;
const MAX_W = 760;

/** Persisted width, clamped to what the current viewport can actually give. */
function initialWidth(): number {
  const fallback = 440;
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(raw) && raw >= MIN_W ? raw : fallback;
  } catch {
    return fallback;
  }
}

export function PraxisDrawer() {
  const aiEnabled = useAiEnabled();
  const [open, setOpen] = React.useState(false);
  // Remounts the body on every open, which is what makes "every open is a new
  // thread" true rather than aspirational: the thread hook's state goes with it.
  const [session, setSession] = React.useState(0);

  // A prompt handed in by an AI-action card, sent as soon as the body mounts.
  const [pending, setPending] = React.useState<string | null>(null);

  // Width lives here rather than in the body, because the element it sizes is
  // `Dialog.Content`, which now lives here too. It survives the `key` remount
  // that gives every open a fresh thread — the panel you sized should stay that
  // size across conversations, which was not true when the two shared a scope.
  const [width, setWidth] = React.useState(initialWidth);

  React.useEffect(() => {
    const onOpen = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt;
      setSession((s) => s + 1);
      setPending(prompt ?? null);
      setOpen(true);
    };
    // The event name is unchanged from the copilot it replaces: the command
    // palette, the quick-actions menu, the touch FAB and every screen's AI
    // action cards already dispatch it, and renaming it would be a rename
    // across four call sites to no benefit.
    window.addEventListener("praxis:open-copilot", onOpen);
    return () => window.removeEventListener("praxis:open-copilot", onOpen);
  }, []);

  /** Drag the left edge. Width is committed to storage on release, not per frame. */
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const ceiling = Math.min(MAX_W, window.innerWidth - 80);
    let latest = width;
    const move = (ev: PointerEvent) => {
      latest = Math.min(Math.max(MIN_W, window.innerWidth - ev.clientX), ceiling);
      setWidth(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(latest)));
      } catch {
        /* private mode — the drawer still resized, it just will not remember */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Keyboard resize, so the drag handle is not a pointer-only control. */
  function keyResize(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 64 : 16;
    const d = e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
    if (!d) return;
    e.preventDefault();
    const next = Math.min(Math.max(MIN_W, width + d), Math.min(MAX_W, window.innerWidth - 80));
    setWidth(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      /* see above */
    }
  }

  // Global AI gate: with AI off for the tenant, no Praxis affordance exists
  // anywhere in the app (doc/AI_GATE_BE_HANDOFF.md).
  if (!aiEnabled) return null;

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        {/*
          SCRIM, NOT A BLUR. It was `backdrop-blur-[1px]` and that was wrong on
          this surface specifically: the drawer's whole proposition is that you
          are asking about the screen it is sitting over, and the context chip
          says so by name. Frosting that screen removes the thing the question
          is about. `ui/dialog.tsx` blurs because a modal WANTS your attention
          off the page; a side drawer wants it on.
        */}
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-fade-in" />

        {/*
          CONTENT IS A DIRECT CHILD OF PORTAL, and it has to be.

          This was `<DrawerBody/>` — a plain function component wrapping
          `Dialog.Content` — and that is what broke the drawer: `DialogPortal`
          wraps every child in `<Presence>`, which clones it with a ref to track
          mount/unmount. A component that is not `forwardRef` swallows that ref,
          so Radix never registers the content layer. In modal mode it is that
          registration that flips `pointer-events` back on for the dialog while
          the rest of the document stays inert — miss it and NOTHING is
          clickable, the drawer included, which is exactly how it presented.

          So `Content` lives here, and the width state it needs lives here with
          it. `DrawerBody` keeps the conversation and is now an ordinary child
          INSIDE the content, where being a function component costs nothing.

          Note it is written INLINE rather than as a `<DrawerShell>` — extracting
          it for tidiness would put a function component back between `Portal`
          and `Content` and reintroduce the same bug one level up.
        */}
        {/*
          IT STOPS AT THE TITLE BAR, and that is not a cosmetic choice.

          This was `inset-y-0`, i.e. the full window height. In an installed
          window the top strip is not ours alone: `window-controls-overlay`
          hands the page the title bar but the OS still paints the caption
          buttons over its right end — the same right end this drawer is pinned
          to. So the drawer's header ran underneath them, and the three
          controls that header carries (New chat, Expand, Close) sat behind
          minimise, maximise and close. Clicking the drawer's close button
          closed the application.

          `--titlebar-h` (index.css) is the strip's height composed with the
          caption buttons' own, so starting there clears it on Windows and
          macOS alike, and in a browser tab — where the env() falls back to
          zero — it simply parks the drawer under the app's utility bar, which
          is where it reads better anyway: the bar stays whole across the
          window instead of being sliced by a panel.
        */}
        <RadixDialog.Content
          aria-describedby={undefined}
          style={{ width: `min(${width}px, 100vw)` }}
          className="fixed bottom-0 right-0 top-[var(--titlebar-h)] z-50 flex flex-col border-l border-t border-border bg-card shadow-2xl outline-none data-[state=open]:animate-fade-in"
        >
          <RadixDialog.Title className="sr-only">Praxis AI</RadixDialog.Title>

          {/*
            Resize handle — the ARIA window-splitter pattern.

            A 12px hit area over a 1px visual line: the affordance the eye reads
            is the edge, but the target the pointer has to hit cannot BE the edge
            or nobody catches it on the way past.

            It is a FOCUSABLE separator with `aria-valuenow`, which is what makes
            it operable without a pointer — arrows move it 16px, Shift+arrows
            64px, and a screen reader announces the width against its range.
            That is the reason for the `jsx-a11y` suppression: the rule treats
            `role="separator"` as non-interactive, but a separator WITH
            `tabindex` and `aria-valuenow` is exactly the interactive variant
            the ARIA spec defines for this, and the `<button>` it would push us
            to cannot express a value.
          */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div
            role="separator"
            aria-label="Resize panel"
            aria-orientation="vertical"
            aria-valuenow={Math.round(width)}
            aria-valuemin={MIN_W}
            aria-valuemax={MAX_W}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={keyResize}
            className="group/grip absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize items-center justify-center focus-visible:outline-none md:flex"
          >
            <span className="h-full w-px bg-transparent transition-colors group-hover/grip:bg-primary/40 group-focus-visible/grip:bg-primary" />
            <span className="absolute text-border transition-colors group-hover/grip:text-primary-ink">
              <GripIcon />
            </span>
          </div>

          <DrawerBody key={session} onClose={() => setOpen(false)} initialPrompt={pending} />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function DrawerBody({ onClose, initialPrompt }: { onClose: () => void; initialPrompt: string | null }) {
  const navigate = useNavigate();
  const screen = useScreenContext();
  const scopes = useAiScopes();
  const thread = useAiThread("fresh");
  const bodyRef = React.useRef<HTMLDivElement>(null);

  // Open pre-scoped to the area you are standing in. A question asked from
  // /finance/receivables is, overwhelmingly, a question about Finance — and the
  // chip is right there to widen it when it is not.
  const [composer, setComposer] = React.useState<ComposerValue>(() => ({
    scope: scopeForPath(scopes, screen?.route ?? "").key,
    mode: "ask",
  }));
  // `scopes` resolves a beat after mount (the access read). Re-derive once it
  // has, but never after the user has touched the control.
  const touched = React.useRef(false);
  React.useEffect(() => {
    if (touched.current || !screen) return;
    setComposer((c) => ({ ...c, scope: scopeForPath(scopes, screen.route).key }));
  }, [scopes, screen]);

  const suggestions = React.useMemo(() => suggestionsFor(screen), [screen]);

  // Auto-send a prompt handed in by an AI-action card. Once, on mount.
  const sent = React.useRef(false);
  React.useEffect(() => {
    if (sent.current || !initialPrompt) return;
    sent.current = true;
    thread.send(initialPrompt, composer);
  }, [initialPrompt, thread, composer]);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.turns, thread.busy]);

  /** Take this thread to the full page. The hinge between the two surfaces. */
  function expand() {
    const id = thread.conversationId;
    navigate(id ? `/ai?c=${encodeURIComponent(id)}` : "/ai", {
      state: { scope: composer.scope, mode: composer.mode },
    });
    onClose();
  }

  const empty = thread.turns.length === 0 && !thread.busy;

  return (
    <>
      <DrawerHeader onNew={thread.newThread} onExpand={expand} busy={thread.busy} />

      <div ref={bodyRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {empty ? (
          <DrawerEmptyState
            screen={screen}
            suggestions={suggestions}
            onPick={(prompt) => thread.send(prompt, composer)}
          />
        ) : (
          thread.turns.map((t, i) => (
            <AiTurnView
              key={t.id}
              turn={t}
              compact
              isLast={i === thread.turns.length - 1}
              busy={thread.busy}
              onRetry={thread.retry}
              onConfirmAction={thread.confirmAction}
              confirming={thread.confirming}
              doneActions={thread.doneActions}
              // No canvas in the drawer — the button hides rather than opening
              // a pane that does not exist here. That IS the expand button's job.
            />
          ))
        )}
        {thread.busy && (() => {
          // Same rule as the workspace: the generic indicator stands down once
          // the turn is showing its own text or naming the step it is on.
          const last = thread.turns[thread.turns.length - 1];
          const speaking = last && last.role === "assistant" && (last.text.length > 0 || !!last.status);
          return speaking ? null : <AiThinking compact />;
        })()}
      </div>

      <div className="border-t border-border px-3 pb-2.5 pt-2.5">
        <AiComposer
          size="compact"
          busy={thread.busy}
          focusOnMount
          screen={screen}
          value={composer}
          onValueChange={(v) => {
            touched.current = true;
            setComposer(v);
          }}
          onSend={(text, opts) => thread.send(text, opts)}
        />
        {/* The standing reassurance. It is short, it is always there, and it is
            the sentence that lets somebody use this on live financial data. */}
        <p className="micro mt-2 text-center text-muted-foreground">
          Praxis acts with your permissions only — writes always ask first.
        </p>
      </div>
    </>
  );
}

function DrawerHeader({ onNew, onExpand, busy }: { onNew: () => void; onExpand: () => void; busy: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary-ink">
        <PraxisMark />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-tight">Praxis AI</div>
        <div className="micro truncate text-muted-foreground">Reads freely · writes need your sign-off</div>
      </div>

      {/* Three controls, and the ORDER is the point: the middle one is expand,
          which is the one people reach for and the one the design is built
          around. Close stays last, where a close button always is. */}
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip content="New chat">
          <button
            type="button"
            onClick={onNew}
            disabled={busy}
            aria-label="Start a new conversation"
            className="tap-24 grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <NewChatIcon />
          </button>
        </Tooltip>
        <Tooltip content="Open full page">
          <button
            type="button"
            onClick={onExpand}
            aria-label="Open this conversation in the full page"
            className="tap-24 grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-primary-ink"
          >
            <ExpandIcon />
          </button>
        </Tooltip>
        <RadixDialog.Close asChild>
          <button
            type="button"
            aria-label="Close"
            className="tap-24 grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <XIcon width={16} height={16} />
          </button>
        </RadixDialog.Close>
      </div>
    </div>
  );
}

/**
 * The empty drawer.
 *
 * Names the screen it was opened from in the opening sentence, then offers the
 * three questions that screen actually raises. That is the whole difference
 * between an assistant that feels present and one that feels bolted on: the old
 * panel offered the same three starters on every screen in the product, so on
 * 108 of 110 of them at least one was irrelevant.
 */
function DrawerEmptyState({
  screen,
  suggestions,
  onPick,
}: {
  screen: { label: string } | null;
  suggestions: { label: string; prompt: string }[];
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-primary/12 text-primary-ink">
          <PraxisMark width={19} height={19} />
        </span>
        <p className="pt-1 text-sm text-foreground">
          {screen ? (
            <>
              Ask about <span className="font-semibold">{screen.label}</span> — or anything else on your desk.
            </>
          ) : (
            <>Ask about anything on your desk.</>
          )}
        </p>
        <p className="micro text-muted-foreground">
          I only read and act within your permissions. This is a fresh thread; past conversations are on the full page.
        </p>
      </div>

      <div className="flex flex-col items-start gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s.prompt}
            type="button"
            onClick={() => onPick(s.prompt)}
            className="max-w-full rounded-full border border-border px-3 py-1.5 text-left text-label text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary-ink"
          >
            <span className="line-clamp-1">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
