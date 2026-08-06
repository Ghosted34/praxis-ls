/**
 * One turn in the thread, and everything hung off it.
 *
 * THE ANATOMY, top to bottom, and why each part is there:
 *
 *   trace     A quiet "Trace · 4 steps ▸" disclosure ABOVE the answer. Above,
 *             not below, because it is the route taken to get there and reads in
 *             that order — and collapsed, because on a good answer nobody opens
 *             it. It renders only when the backend sends steps.
 *   answer    Markdown, through the app's own renderer. No bubble on the
 *             assistant side: a bordered box around every reply turns a
 *             conversation into a stack of cards, and the reply is the page's
 *             content, not an object on it. The USER's turn keeps a bubble —
 *             it is the thing that needs distinguishing from the page.
 *   actions   Proposed writes, as editable forms with an explicit confirm. This
 *             is the product's central safety property and it is drawn like it:
 *             a bordered card, a sentence saying what will happen, and a button
 *             the human presses.
 *   sources   The records the answer stands on, as chips that navigate. An
 *             assistant that says "three invoices are overdue" and makes you go
 *             and find them has moved the work, not done it.
 *   toolbar   Copy, Listen, Retry, Canvas, and feedback.
 *
 * WHEN THE TOOLBAR SHOWS. Always on the LAST assistant turn, on hover or
 * keyboard focus for earlier ones. Permanently-visible controls under every
 * turn make a long thread look like a settings screen; permanently-hidden ones
 * are undiscoverable and unreachable by keyboard. The last turn is the one
 * being acted on, so it is the one that shows without being asked.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { Markdown } from "@/components/markdown";
import { ActionForm } from "@/components/action-form";
import { Tooltip } from "@/components/ui/tooltip";
import { CheckIcon } from "@/components/ui/icons";
import { extractSources, extractTable, isLongForm, mergeSources, type AiSource } from "./grounding";
import {
  CanvasIcon,
  CopyIcon,
  ListenIcon,
  PraxisMark,
  RetryIcon,
  SourceIcon,
  StopIcon,
  ThumbDownIcon,
  ThumbUpIcon,
  TraceIcon,
} from "./icons";
import { useSpeech } from "./speech";
import { AI_MODES } from "./context";
import type { AiTurn } from "./thread";
import type { AiActionRun } from "@/lib/ai-api";

/** What the canvas would show for this turn, if anything. Computed once. */
export type TurnCanvas =
  | { kind: "artifact"; title: string; text: string }
  | { kind: "table"; title: string; header: string[]; rows: string[][] };

export function canvasFor(turn: AiTurn): TurnCanvas | null {
  if (turn.role !== "assistant" || turn.failed) return null;
  const table = extractTable(turn.text);
  // A table beats prose: a person looking at fifteen rows of receivables wants
  // the sortable one, and the prose is still in the thread either way.
  if (table) return { kind: "table", title: "Result", header: table.header, rows: table.rows };
  if (isLongForm(turn.text)) {
    const heading = turn.text.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    return { kind: "artifact", title: heading || "Draft", text: turn.text };
  }
  return null;
}

export function AiTurnView({
  turn,
  isLast,
  busy,
  onRetry,
  onConfirmAction,
  confirming,
  doneActions,
  onOpenCanvas,
  compact,
}: {
  turn: AiTurn;
  isLast: boolean;
  busy?: boolean;
  onRetry?: (turn: AiTurn) => void;
  onConfirmAction: (run: AiActionRun, payload: Record<string, unknown>) => void;
  confirming: string | null;
  doneActions: Record<string, boolean>;
  /** Absent in the drawer, which has no canvas — the button hides rather than
   *  opening a pane that is not there. */
  onOpenCanvas?: (turn: AiTurn, canvas: TurnCanvas) => void;
  compact?: boolean;
}) {
  if (turn.role === "user") return <UserTurn turn={turn} />;
  return (
    <AssistantTurn
      turn={turn}
      isLast={isLast}
      busy={busy}
      onRetry={onRetry}
      onConfirmAction={onConfirmAction}
      confirming={confirming}
      doneActions={doneActions}
      onOpenCanvas={onOpenCanvas}
      compact={compact}
    />
  );
}

/**
 * The user's turn.
 *
 * Right-aligned, filled with the brand accent, capped at 85% so it never spans
 * the column — an asymmetric thread is readable at a glance in a way a
 * left-aligned one is not, and this is the one place `--primary` as a large
 * fill is exactly right.
 *
 * The meta line under it appears ONLY when the question was qualified: scoped to
 * an area, or asked in a mode other than Ask. Printing "All my work · Ask" under
 * every question is noise; printing "Finance · Analyse" under the one that was
 * scoped is a record of what was actually asked, which matters when the answer
 * is surprising.
 */
function UserTurn({ turn }: { turn: AiTurn }) {
  const mode = AI_MODES.find((m) => m.value === turn.mode);
  const scoped = turn.scope && turn.scope !== "all";
  const qualified = scoped || (mode && mode.value !== "ask");
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
        {turn.text}
      </div>
      {qualified && (
        <div className="micro text-muted-foreground">
          {[scoped ? turn.scope : null, mode && mode.value !== "ask" ? mode.label : null].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

function AssistantTurn({
  turn,
  isLast,
  busy,
  onRetry,
  onConfirmAction,
  confirming,
  doneActions,
  onOpenCanvas,
  compact,
}: {
  turn: AiTurn;
  isLast: boolean;
  busy?: boolean;
  onRetry?: (turn: AiTurn) => void;
  onConfirmAction: (run: AiActionRun, payload: Record<string, unknown>) => void;
  confirming: string | null;
  doneActions: Record<string, boolean>;
  onOpenCanvas?: (turn: AiTurn, canvas: TurnCanvas) => void;
  compact?: boolean;
}) {
  const sources = React.useMemo(
    () => mergeSources(extractSources(turn.text), turn.sources),
    [turn.text, turn.sources],
  );
  const canvas = React.useMemo(() => canvasFor(turn), [turn]);
  const pending = (turn.actions ?? []).filter((a) => !doneActions[a.action_run_id]);
  const done = (turn.actions ?? []).filter((a) => doneActions[a.action_run_id]);

  return (
    <div className="group/turn flex gap-2.5">
      {/* Mark gutter. Hidden in the drawer, where 28px of width is a real cost
          and there is no ambiguity about who is speaking anyway. */}
      {!compact && (
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md",
            turn.failed ? "bg-bad-fill/12 text-bad" : "bg-primary/12 text-primary-ink",
          )}
        >
          <PraxisMark width={13} height={13} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        {turn.trace && turn.trace.length > 0 && <TraceDisclosure steps={turn.trace} />}

        <div
          className={cn(
            "text-sm",
            turn.failed && "rounded-lg border border-bad/30 bg-bad-fill/8 px-3 py-2 text-bad",
          )}
        >
          {turn.failed ? turn.text : <Markdown text={turn.text} />}
        </div>

        {pending.length > 0 && (
          <div className="mt-2.5 space-y-2">
            {pending.map((a) => (
              <ActionCard
                key={a.action_run_id}
                action={a}
                busy={confirming === a.action_run_id}
                onConfirm={(payload) => onConfirmAction(a, payload)}
              />
            ))}
          </div>
        )}

        {done.length > 0 && (
          <div className="mt-2 space-y-1">
            {done.map((a) => (
              <div key={a.action_run_id} className="flex items-center gap-1.5 text-micro text-ok">
                <CheckIcon width={12} height={12} />
                <span>{a.action_key.replace(/_/g, " ")} — done</span>
              </div>
            ))}
          </div>
        )}

        {sources.length > 0 && <GroundingFooter sources={sources} />}

        {!turn.failed && (
          <TurnToolbar
            turn={turn}
            isLast={isLast}
            busy={busy}
            canvas={canvas}
            onOpenCanvas={onOpenCanvas}
            onRetry={onRetry}
          />
        )}
        {turn.failed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(turn)}
            disabled={busy}
            className="mt-1.5 inline-flex items-center gap-1.5 text-micro font-medium text-primary-ink hover:underline disabled:opacity-50"
          >
            <RetryIcon width={12} height={12} /> Try again
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The reasoning trace.
 *
 * Collapsed by default and styled down to `micro` on purpose: this is provenance
 * for the moment you doubt an answer, not a feature to show off. `<details>`
 * rather than a state toggle, so it is keyboard-operable and expandable before
 * hydration for free.
 */
function TraceDisclosure({ steps }: { steps: string[] }) {
  return (
    <details className="group/trace mb-1.5">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md py-0.5 text-micro text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <TraceIcon />
        <span>
          Trace · {steps.length} step{steps.length === 1 ? "" : "s"}
        </span>
        <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform group-open/trace:rotate-90">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </summary>
      <ol className="mt-1.5 space-y-1 border-l border-border pl-3 text-micro text-muted-foreground">
        {steps.map((s, i) => (
          <li key={i} className="relative">
            <span aria-hidden className="absolute -left-[15px] top-[5px] h-1.5 w-1.5 rounded-full bg-border" />
            {s}
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * A proposed write, awaiting a human.
 *
 * Wrapped rather than replaced: `ActionForm` already renders the payload as an
 * editable, schema-driven form with reference dropdowns, and re-implementing
 * that would be the audit's favourite failure. What this adds is the FRAME —
 * the sentence naming the action, and the reminder that it runs as you. The
 * frame is the part that makes the form feel like a decision rather than
 * another field to fill in.
 */
function ActionCard({
  action,
  busy,
  onConfirm,
}: {
  action: AiActionRun;
  busy?: boolean;
  onConfirm: (payload: Record<string, unknown>) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-warn/35 bg-warn-fill/[0.06]">
      <div className="flex items-start gap-2 border-b border-warn/25 px-3 py-2">
        <span aria-hidden className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-warn-fill/20 text-warn">
          <svg viewBox="0 0 24 24" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden>
            <path d="M12 8v5M12 17h.01" />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="text-label font-semibold text-foreground">
            Praxis wants to {action.action_key.replace(/_/g, " ")}
          </div>
          <p className="micro mt-0.5 text-muted-foreground">
            Check the values, then confirm. It runs with your permissions, as you.
          </p>
        </div>
      </div>
      <div className="px-3 py-2">
        <ActionForm action={action} busy={busy} onConfirm={onConfirm} />
      </div>
    </div>
  );
}

/**
 * What the answer stands on.
 *
 * Internal references are `<Link>`s so they route without a reload; external
 * ones open in a new tab with the usual `rel`. The chips are small, quiet and
 * numerous by design — this is a footnote, and a footnote that competes with
 * the text is a badly set page.
 */
function GroundingFooter({ sources }: { sources: AiSource[] }) {
  return (
    <div className="mt-2.5 border-t border-border/70 pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="micro shrink-0 text-muted-foreground">Based on</span>
        {sources.map((s) =>
          s.kind === "external" ? (
            <a
              key={s.href}
              href={s.href}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex max-w-[15rem] items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-micro text-muted-foreground transition-colors hover:border-primary hover:text-primary-ink"
            >
              <SourceIcon width={11} height={11} className="shrink-0" />
              <span className="truncate">{s.label}</span>
            </a>
          ) : (
            <Link
              key={s.href}
              to={s.href}
              className={cn(
                "inline-flex max-w-[15rem] items-center gap-1 rounded-md border px-1.5 py-0.5 text-micro transition-colors hover:border-primary hover:text-primary-ink",
                s.kind === "report"
                  ? "border-brand-blue/30 bg-brand-blue/8 text-brand-blue-ink"
                  : "border-border text-muted-foreground",
              )}
            >
              <SourceIcon width={11} height={11} className="shrink-0" />
              <span className="truncate">{s.label}</span>
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

/** One icon button in the toolbar. Icon-only, so the label is the tooltip AND
 *  the accessible name — never only the tooltip. */
function ToolButton({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "tap-24 grid h-7 w-7 place-items-center rounded-md transition-colors disabled:opacity-40",
          active ? "bg-accent text-primary-ink" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function TurnToolbar({
  turn,
  isLast,
  busy,
  canvas,
  onOpenCanvas,
  onRetry,
}: {
  turn: AiTurn;
  isLast: boolean;
  busy?: boolean;
  canvas: TurnCanvas | null;
  onOpenCanvas?: (turn: AiTurn, canvas: TurnCanvas) => void;
  onRetry?: (turn: AiTurn) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const [vote, setVote] = React.useState<"up" | "down" | null>(null);
  const speech = useSpeech();
  const speaking = speech.speakingId === turn.id;

  async function copy() {
    try {
      await navigator.clipboard.writeText(turn.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard denied (insecure context, or the user said no). The button
         simply does not confirm — there is nothing useful to say about it. */
    }
  }

  return (
    <div
      className={cn(
        "-ml-1 mt-1 flex items-center gap-0.5 transition-opacity",
        // Always on for the turn being acted on; revealed on hover or keyboard
        // focus for the rest, so the thread stays quiet without going dark.
        isLast
          ? "opacity-100"
          : "opacity-0 focus-within:opacity-100 group-hover/turn:opacity-100 max-md:opacity-100",
      )}
    >
      <ToolButton label={copied ? "Copied" : "Copy"} onClick={copy} active={copied}>
        {copied ? <CheckIcon width={14} height={14} /> : <CopyIcon />}
      </ToolButton>

      {speech.supported && (
        <ToolButton
          label={speaking ? "Stop" : "Listen"}
          onClick={() => speech.toggle(turn.id, turn.text)}
          active={speaking}
        >
          {speaking ? <StopIcon /> : <ListenIcon />}
        </ToolButton>
      )}

      {onRetry && (
        <ToolButton label="Ask again" onClick={() => onRetry(turn)} disabled={busy || !isLast}>
          <RetryIcon />
        </ToolButton>
      )}

      {canvas && onOpenCanvas && (
        <ToolButton label={canvas.kind === "table" ? "Open as table" : "Open in canvas"} onClick={() => onOpenCanvas(turn, canvas)}>
          <CanvasIcon />
        </ToolButton>
      )}

      <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />

      <ToolButton
        label="Good answer"
        active={vote === "up"}
        onClick={() => setVote((v) => (v === "up" ? null : "up"))}
      >
        <ThumbUpIcon />
      </ToolButton>
      <ToolButton
        label="Bad answer"
        active={vote === "down"}
        onClick={() => setVote((v) => (v === "down" ? null : "down"))}
      >
        <ThumbDownIcon />
      </ToolButton>
    </div>
  );
}

/**
 * The thinking indicator.
 *
 * Three dots on a baseline rather than a spinner: a spinner is a page loading, a
 * pulse is somebody composing a reply. Reduced-motion users get the text alone,
 * which is why the label is real text and not `sr-only`.
 */
export function AiThinking({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" role="status">
      {!compact && (
        <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/12 text-primary-ink">
          <PraxisMark width={13} height={13} />
        </span>
      )}
      <span className="micro text-muted-foreground">Praxis is working…</span>
      <span aria-hidden className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/50"
            style={{ animationDelay: `${i * 160}ms`, animationDuration: "1.1s" }}
          />
        ))}
      </span>
    </div>
  );
}
