import * as React from "react";
import { cn } from "@/lib/cn";
import { enumLabel } from "@/lib/format";
import { tr } from "@/lib/i18n";

/**
 * Status pills — the same tone table the staff app uses, so `COMPLETED` is green
 * in the ERP and green in the portal.
 *
 * Ported from `client/src/components/ui/pill.tsx` (its STATUS_TONE map is the
 * replacement for a 27-entry hardcoded Tailwind badge that was the largest source
 * of raw-palette violations in audit F14). Every entry below is semantic, so a
 * tenant re-brand re-tints the pills without a rebuild.
 *
 * ONE DEVIATION: the label goes through `tr()` after `enumLabel`. `client` prints
 * `enumLabel(status)`, which sentence-cases the English token — so the French
 * portal reads "In review" while the rest of the page is French. Routing it
 * through the dictionary means a translated status string lights up both apps'
 * vocabulary at once, and an untranslated one still falls back to English rather
 * than going blank. Nothing is invented here.
 */
export type Tone = "ok" | "warn" | "bad" | "blue" | "orange" | "mute";

const TONE_CLASS: Record<Tone, string> = {
  ok: "st-ok",
  warn: "st-warn",
  bad: "st-bad",
  blue: "st-blue",
  orange: "st-orange",
  mute: "st-mute",
};

const STATUS_TONE: Record<string, Tone> = {
  // Neutral / not yet started
  DRAFT: "mute",
  CLOSED: "mute",
  ENDED: "mute",
  EXPIRED: "mute",
  CANCELLED: "mute",
  // Live but unresolved
  NEW: "blue",
  OPEN: "blue",
  TRIAGED: "blue",
  SENT: "blue",
  ISSUED: "blue",
  SCHEDULED: "blue",
  // In flight / needs someone
  IN_PROGRESS: "warn",
  PENDING: "warn",
  PAUSED: "warn",
  REVIEWING: "warn",
  IN_REVIEW: "warn",
  SIGNED_OFF: "warn",
  YELLOW: "warn",
  // Promising — was violet in the badge this replaced
  QUALIFIED: "orange",
  // Resolved well
  CONVERTED: "ok",
  WON: "ok",
  ACCEPTED: "ok",
  ACTIVE: "ok",
  PUBLISHED: "ok",
  APPROVED: "ok",
  SIGNED: "ok",
  DONE: "ok",
  COMPLETED: "ok",
  PAID: "ok",
  GREEN: "ok",
  // Resolved badly
  LOST: "bad",
  REJECTED: "bad",
  DECLINED: "bad",
  FAILED: "bad",
  OVERDUE: "bad",
  RED: "bad",
};

/** Tone for a status token, `mute` for anything unmapped — an unknown status
 *  renders as a neutral pill rather than disappearing. */
export function statusTone(status?: string | null): Tone {
  if (!status) return "mute";
  return STATUS_TONE[String(status).toUpperCase()] ?? "mute";
}

export function Pill({
  tone = "mute",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  const content =
    typeof children === "string" ? tr(enumLabel(children)) : children;
  return (
    <span className={cn("status", TONE_CLASS[tone], className)}>{content}</span>
  );
}

/** Status pill that picks its own tone from the value. */
export function StatusPill({
  status,
  tone,
  className,
}: {
  status?: string | null;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Pill tone={tone ?? statusTone(status)} className={className}>
      {status || "—"}
    </Pill>
  );
}

/**
 * A neutral tag — department, location, contract type.
 *
 * Separate from `Pill` on purpose: a pill carries a STATUS, and status is the one
 * thing in this product that must never be invented. A job advert's "Douala" is a
 * fact, not a state machine, so it gets no coloured dot and no tone lookup — and
 * reusing the status component for it is how a chip eventually inherits a
 * red/green meaning nobody gave it.
 */
export function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-[6px] bg-[rgb(var(--ink)/0.06)] px-2 py-0.5 text-xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The same tag on a dark band, where `--ink` inverts and 6 % of the wrong colour
 *  turns into a grey smudge. */
export function ChipOnDark({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-[6px] bg-[rgb(237_238_238/0.10)] px-2 py-0.5 text-xs text-[var(--hero-muted)]">
      {children}
    </span>
  );
}
