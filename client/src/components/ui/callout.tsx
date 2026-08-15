/**
 * Callout — an inline, tone-carrying message block.
 *
 * WHY THIS EXISTS (audit F6, F14). "The operation you just ran said something"
 * had no primitive, so five screens each built one out of raw palette colours:
 *
 *   settings/config-pages.tsx:797   API-key test result
 *   settings/master-data-pages.tsx  FX sync test result
 *   sales/pages.tsx:2275            "queued N messages"
 *   vault/pages.tsx:978             hash verification verdict
 *   document-view.tsx:179           a note banner
 *
 * Every one used `emerald`/`rose` literals, so none of them re-tinted for a
 * tenant and none had had its contrast measured. That is F14's mechanism in
 * miniature: no shared home for a pattern, so the pattern gets rebuilt in
 * whatever colours are nearest to hand.
 *
 * WHEN TO USE WHICH:
 *   <Callout>            an outcome the user caused and is reading right now —
 *                        a test result, a save confirmation, a count queued.
 *   <ErrorState>         the screen could not load. Replaces the content.
 *   <Toast>              an outcome the user does NOT need to read to continue.
 *   <Pill>               the state of a ROW or record, not of an action.
 *
 * ACCESSIBILITY. `ok`/`info` announce politely, `warn`/`bad` assertively — a
 * failed hash verification should interrupt, a "Saved." should not. The audit
 * found three live regions in ~40,000 lines (F13) and no arrival signal for any
 * async result; this is one of the places that gap was most visible, because the
 * whole point of the block is that something just finished.
 *
 * The tone is never carried by colour alone (WCAG §1.4.1): each one ships a
 * glyph, and the text says what happened.
 */
import * as React from "react";
import { cn } from "@/lib/cn";

export type CalloutTone = "ok" | "warn" | "bad" | "info";

const TONE: Record<
  CalloutTone,
  { box: string; ink: string; live: "polite" | "assertive" }
> = {
  ok: { box: "border-ok/40 bg-ok-fill/10", ink: "text-ok", live: "polite" },
  warn: {
    box: "border-warn/40 bg-warn-fill/10",
    ink: "text-warn",
    live: "assertive",
  },
  bad: {
    box: "border-bad/40 bg-bad-fill/10",
    ink: "text-bad",
    live: "assertive",
  },
  info: {
    box: "border-brand-blue/40 bg-brand-blue/10",
    ink: "text-brand-blue-ink",
    live: "polite",
  },
};

function Glyph({ tone }: { tone: CalloutTone }) {
  const common = {
    viewBox: "0 0 20 20",
    width: 16,
    height: 16,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "mt-0.5 shrink-0",
  };
  if (tone === "ok")
    return (
      <svg {...common}>
        <path d="M4 10.5l4 4 8-8" />
      </svg>
    );
  if (tone === "bad")
    return (
      <svg {...common}>
        <path d="M5 5l10 10M15 5L5 15" />
      </svg>
    );
  if (tone === "warn")
    return (
      <svg {...common}>
        <path d="M10 3l7.5 13.5h-15L10 3zM10 8v4M10 14.5v.01" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v4.5M10 6.5v.01" />
    </svg>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: CalloutTone;
  /** Emphasised lead-in. Keep it to a few words — the detail goes in children. */
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** A single control — "Retry", "Undo", "View report". */
  action?: React.ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      role="status"
      aria-live={t.live}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm",
        t.box,
        className,
      )}
    >
      <span className={t.ink}>
        <Glyph tone={tone} />
      </span>
      <div className="min-w-0 flex-1">
        {title ? (
          <span className={cn("font-semibold", t.ink)}>{title}</span>
        ) : null}
        {title && children ? " " : null}
        {children ? <span className="text-foreground">{children}</span> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
