/**
 * Glyphs for the Praxis AI surfaces (drawer + workspace).
 *
 * WHY A LOCAL SET AND NOT `ui/icons`. `components/ui/icons.tsx` is the app's
 * general kit — mail, lock, trash, the things a form needs. These are the
 * assistant's own vocabulary: expand-to-page, scope, grounding, lineage,
 * canvas. Keeping them here means the assistant can grow its iconography
 * without widening a module every screen imports.
 *
 * Everything reuses `ui/icons` where the glyph already exists (X, plus, send,
 * search, check, chevron) rather than drawing a second version of it — two
 * subtly different close buttons in one product is exactly the drift the audit
 * kept finding.
 *
 * All icons are 1.7-1.8 stroke on a 24-box, `currentColor`, and `aria-hidden`:
 * they never carry the label. The label is the button's accessible name.
 */
import type * as React from "react";

export type IP = React.SVGProps<SVGSVGElement>;

/** Shared stroke defaults, so a caller only ever passes size or className. */
const s = (p: IP) => ({
  viewBox: "0 0 24 24",
  width: 16,
  height: 16,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

/**
 * The Praxis AI mark — a nucleus with four cardinal rays.
 *
 * Deliberately NOT a generic four-point sparkle. Every assistant on the market
 * uses that glyph, so it identifies the category rather than the product. This
 * is the mark already used by the copilot's header (`praxis-copilot.tsx`),
 * promoted here so the drawer, the workspace and the launcher share one.
 */
export const PraxisMark = (p: IP) => (
  <svg {...s(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

/** Denser variant for the empty-state hero, where the mark carries real size. */
export const PraxisMarkLarge = (p: IP) => (
  <svg {...s(p)} width={28} height={28} strokeWidth={1.5}>
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5" />
    <path d="M4.9 4.9l2.4 2.4M16.7 16.7l2.4 2.4M19.1 4.9l-2.4 2.4M7.3 16.7l-2.4 2.4" opacity="0.55" />
  </svg>
);

/** Expand the drawer into the full workspace. The drawer header's middle button. */
export const ExpandIcon = (p: IP) => (
  <svg {...s(p)}>
    <path d="M14 4h6v6M20 4l-7.5 7.5M10 20H4v-6M4 20l7.5-7.5" />
  </svg>
);

/** Start a fresh thread. A page with a pen, not a bare plus — a plus reads as
 *  "add" in a toolbar that also contains destructive controls. */
export const NewChatIcon = (p: IP) => (
  <svg {...s(p)}>
    <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L13 14l-4 1 1-4z" />
  </svg>
);

/** Collapse/expand the workspace's left rail. */
export const PanelLeftIcon = (p: IP) => (
  <svg {...s(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
);

/** Collapse/expand the workspace's right pane. */
export const PanelRightIcon = (p: IP) => (
  <svg {...s(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </svg>
);

/** Scope — a target. Reads as "narrow this", which is what the control does. */
export const ScopeIcon = (p: IP) => (
  <svg {...s(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
  </svg>
);

/** A grounding source — a record the answer was read from. */
export const SourceIcon = (p: IP) => (
  <svg {...s(p)} width={13} height={13}>
    <path d="M14 3h5v5" />
    <path d="M19 3l-8 8" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

/** The reasoning-trace disclosure. A route with waypoints, not a lightbulb —
 *  what expands is the STEPS taken, not an idea. */
export const TraceIcon = (p: IP) => (
  <svg {...s(p)} width={13} height={13}>
    <circle cx="5" cy="6" r="2" />
    <circle cx="19" cy="18" r="2" />
    <path d="M5 8v6a4 4 0 0 0 4 4h8" />
    <path d="M12 6h7" />
  </svg>
);

/** Copy an answer to the clipboard. */
export const CopyIcon = (p: IP) => (
  <svg {...s(p)} width={14} height={14}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/** Ask again. */
export const RetryIcon = (p: IP) => (
  <svg {...s(p)} width={14} height={14}>
    <path d="M3 12a9 9 0 1 0 2.6-6.4" />
    <path d="M3 4v5h5" />
  </svg>
);

export const ThumbUpIcon = (p: IP) => (
  <svg {...s(p)} width={14} height={14}>
    <path d="M7 21V10l4.5-7a2 2 0 0 1 2.9 2.2L13.5 9H19a2 2 0 0 1 2 2.4l-1.6 7A2 2 0 0 1 17.4 21z" />
    <path d="M7 10H4v11h3" />
  </svg>
);

export const ThumbDownIcon = (p: IP) => (
  <svg {...s(p)} width={14} height={14}>
    <path d="M17 3v11l-4.5 7a2 2 0 0 1-2.9-2.2L10.5 15H5a2 2 0 0 1-2-2.4l1.6-7A2 2 0 0 1 6.6 3z" />
    <path d="M17 14h3V3h-3" />
  </svg>
);

/**
 * Read this answer aloud. Toggles to `StopIcon` while speaking.
 *
 * Earns its place on a logistics desk specifically: the person reading a
 * dispatch summary is often also on a phone, or in a yard, or looking at the
 * truck rather than the screen. It is `speechSynthesis`, so it costs nothing
 * and needs no model.
 */
export const ListenIcon = (p: IP) => (
  <svg {...s(p)} width={14} height={14}>
    <path d="M11 5L6.5 8.5H3v7h3.5L11 19z" />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);

/** Stop reading aloud. */
export const StopIcon = (p: IP) => (
  <svg {...s(p)} width={14} height={14}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

/** Dictate a question. Idle state of the composer's mic. */
export const MicIcon = (p: IP) => (
  <svg {...s(p)}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21" />
  </svg>
);

/** Adjust how this answer was given — shorter, more detail, show the figures. */
export const TuneIcon = (p: IP) => (
  <svg {...s(p)} width={14} height={14}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="16" cy="18" r="2" />
  </svg>
);

/** Open this answer's long-form output in the canvas. */
export const CanvasIcon = (p: IP) => (
  <svg {...s(p)} width={14} height={14}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 8h7M7 12h10M7 16h5" />
  </svg>
);

/** A generated document/artifact in the right pane's tab strip. */
export const DocIcon = (p: IP) => (
  <svg {...s(p)}>
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v5h5" />
  </svg>
);

/** A result set shown as a real table in the right pane. */
export const TableIcon = (p: IP) => (
  <svg {...s(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 10v10" />
  </svg>
);

/** An ERP record previewed in the right pane. */
export const RecordIcon = (p: IP) => (
  <svg {...s(p)}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h4" />
  </svg>
);

/** Sources & lineage tab — what was read, and under which permission. */
export const LineageIcon = (p: IP) => (
  <svg {...s(p)}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="12" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <path d="M8.2 7.3l7.6 3.6M8.2 16.7l7.6-3.6" />
  </svg>
);

/** Pin a thread to the top of the history list. */
export const PinIcon = (p: IP) => (
  <svg {...s(p)} width={14} height={14}>
    <path d="M9 3h6l-1 6 3.5 3.5H6.5L10 9z" />
    <path d="M12 12.5V21" />
  </svg>
);

/** Row overflow in the history list. */
export const KebabIcon = (p: IP) => (
  <svg {...s(p)} width={14} height={14} strokeWidth={2.2}>
    <path d="M12 5.5h.01M12 12h.01M12 18.5h.01" />
  </svg>
);

/** The drawer's drag-to-resize grip. Rendered inside the hit area, not as it. */
export const GripIcon = (p: IP) => (
  <svg {...s(p)} width={10} height={22} viewBox="0 0 10 22" strokeWidth={1.6}>
    <path d="M4 6v10M7 6v10" />
  </svg>
);
