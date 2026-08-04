/** Status pill — thin wrapper over the design-system `.status` + `.st-*` classes
 *  so screens use a typed `tone` instead of remembering class names. */
import * as React from "react";
import { cn } from "@/lib/cn";
import { enumLabel } from "@/lib/format";

export type Tone = "ok" | "warn" | "bad" | "blue" | "orange" | "mute";

const TONE_CLASS: Record<Tone, string> = {
  ok: "st-ok",
  warn: "st-warn",
  bad: "st-bad",
  blue: "st-blue",
  orange: "st-orange",
  mute: "st-mute",
};

/**
 * Default status → tone mapping.
 *
 * This replaces `Badge` from `features/sales/ui.tsx:63-95`, whose 27-entry
 * hardcoded raw-Tailwind map (`bg-sky-500/10 text-sky-600 dark:text-sky-400`,
 * …) was the single largest source of the 122 raw-palette violations in F14 —
 * one table, not scatter. Every entry below is the same semantic decision
 * expressed in tokens, so it re-tints with the tenant's brand and follows the
 * AA-corrected `--ok`/`--warn`/`--bad` from Phase 1.
 *
 * Original palette → tone:
 *   sky → blue · amber → warn · emerald → ok · rose → bad · muted → mute
 *   violet → orange (there is no violet token; QUALIFIED keeps a distinct
 *   colour from NEW/OPEN, which is the only thing the violet was doing).
 *
 * Keys are the SCREAMING_SNAKE tokens the API returns, matched case-insensitively.
 */
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
  CONTACTED: "warn",
  REVIEWING: "warn",
  IN_REVIEW: "warn",
  PENDING: "warn",
  PAUSED: "warn",
  SIGNED_OFF: "warn",
  YELLOW: "warn",
  // Promising — was violet
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
  GREEN: "ok",
  // Resolved badly
  LOST: "bad",
  REJECTED: "bad",
  DECLINED: "bad",
  FAILED: "bad",
  RED: "bad",
};

/**
 * Tone for a status token, defaulting to `mute` for anything unmapped — an
 * unknown status renders as a neutral pill rather than disappearing.
 *
 * Reach for this only when a status has no module-specific meaning. Where a
 * module already defines its own map (payroll's OPEN → COMPUTED → VALIDATED
 * ladder, say), that map is more accurate and should win — a generic "OPEN is
 * blue" is wrong when OPEN is the state that blocks a month-end close.
 */
export function statusTone(status?: string | null): Tone {
  if (!status) return "mute";
  return STATUS_TONE[String(status).toUpperCase()] ?? "mute";
}

/**
 * Status pill that picks its own tone from the value. The drop-in replacement
 * for the deleted `Badge`.
 *
 * @example <StatusPill status={row.status} />           // "IN_REVIEW" → amber "In review"
 * @example <StatusPill status={row.stage} tone="ok" />  // override the mapping
 */
export function StatusPill({ status, tone, className }: { status?: string | null; tone?: Tone; className?: string }) {
  return (
    <Pill tone={tone ?? statusTone(status)} className={className}>
      {status || "—"}
    </Pill>
  );
}

/** String children are humanized ("POSTED_LOCKED" → "Posted locked", "OPEN" →
 *  "Open") — the Lovable reference never shows SCREAMING enum tokens. Pass a
 *  non-string child (e.g. <span>…</span>) to opt out. */
export function Pill({ tone = "mute", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  const content = typeof children === "string" ? enumLabel(children) : children;
  return <span className={cn("status", TONE_CLASS[tone], className)}>{content}</span>;
}

/** Active/Inactive convenience for the `is_active` flag most master-data rows carry. */
export function ActivePill({ active }: { active: boolean }) {
  return <Pill tone={active ? "ok" : "mute"}>{active ? "Active" : "Inactive"}</Pill>;
}
