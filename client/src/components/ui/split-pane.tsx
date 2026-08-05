/**
 * SplitPane — a resizable master-detail layout (Phase 5, audit F9).
 *
 * WHY. The four 360 screens (client, dossier, employee, location) all use
 * `lg:grid-cols-[260px_1fr]`: a fixed 260px index against a fluid detail. That
 * number was chosen once, for one viewport, and it is wrong in both directions —
 * too narrow for a list of French company names at 1280px, and absurd at 2560px
 * where the detail pane has room to spare and the index still truncates every
 * entry. A fixed pane on a screen whose whole job is comparison is the
 * "stretched mobile view" F2 opens with, one component down.
 *
 * IT IS A REAL SEPARATOR, NOT A DRAGGABLE DIV. `role="separator"` with
 * `aria-valuenow` / `aria-valuemin` / `aria-valuemax` and `aria-controls` is the
 * WAI-ARIA Window Splitter pattern: arrow keys move it in 16px steps, Home and
 * End take it to its limits, Enter collapses and restores. That matters because
 * a drag handle is the most common mouse-only-by-construction control on the
 * web — this app already shipped two (the FAB, the sales kanban) and both had to
 * be fixed after the fact. Building the third one operable was cheaper than
 * fixing it would have been.
 *
 * IT ONLY SPLITS ON DESKTOP. Below `lg` the panes stack and the separator is not
 * rendered — dragging a divider is not a phone gesture, and 260px of a 360px
 * viewport is not a layout. `lg` is where the existing grids already switched,
 * so no screen changes behaviour at a width it did not already change at.
 *
 * @example
 * <SplitPane storageKey="master.clients" label="Client list width">
 *   <ClientIndex … />
 *   <ClientDetail … />
 * </SplitPane>
 *
 * BEST PRACTICE. Give every instance its own `storageKey` — the right width for
 * a column of vehicle plates is not the right width for one of client names.
 * Set `min` at the point the index stops being READABLE, not merely visible.
 */
import * as React from "react";
import { cn } from "@/lib/cn";

const PREFIX = "praxis.split.";
const STEP = 16;

function read(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(PREFIX + key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function SplitPane({
  children,
  storageKey,
  label,
  defaultSize = 280,
  min = 200,
  max = 560,
  className,
}: {
  /** Exactly two: the index pane, then the detail pane. */
  children: [React.ReactNode, React.ReactNode];
  /** Per-screen. Two screens should not share a width. */
  storageKey: string;
  /** What the separator resizes, e.g. "Client list width". */
  label: string;
  defaultSize?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [size, setSize] = React.useState(() => read(storageKey, defaultSize));
  /** The width to restore to. Non-null means the index pane is collapsed. */
  const [collapsedFrom, setCollapsedFrom] = React.useState<number | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const paneId = React.useId();
  const collapsed = collapsedFrom !== null;

  const clamp = React.useCallback((n: number) => Math.min(max, Math.max(min, n)), [min, max]);

  const commit = React.useCallback(
    (n: number) => {
      const next = clamp(n);
      setSize(next);
      try {
        localStorage.setItem(PREFIX + storageKey, String(next));
      } catch {
        /* preference still applies for this session */
      }
    },
    [clamp, storageKey],
  );

  const toggleCollapse = React.useCallback(() => {
    setCollapsedFrom((from) => {
      if (from === null) return size;
      setSize(from);
      return null;
    });
  }, [size]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Primary button only: a right-click landing on the separator should open a
    // context menu, not begin a resize the user cannot see themselves starting.
    if (e.button !== 0) return;
    e.preventDefault();
    const left = rootRef.current?.getBoundingClientRect().left ?? 0;
    setCollapsedFrom(null);
    const move = (ev: PointerEvent) => setSize(clamp(ev.clientX - left));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commit(ev.clientX - left);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
    // Set on <body> for the duration of the drag: without it the cursor flickers
    // back to a text caret every time the pointer crosses a text node.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const to: Record<string, number> = {
      ArrowLeft: size - STEP,
      ArrowRight: size + STEP,
      Home: min,
      End: max,
    };
    if (e.key in to) {
      e.preventDefault();
      setCollapsedFrom(null);
      commit(to[e.key]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      toggleCollapse();
    }
  };

  return (
    <div
      ref={rootRef}
      // One tree, two layouts. Below lg this is a single-column grid and the
      // panes stack; at lg the three-column template takes over. The width is a
      // live number, so it arrives as a custom property — a Tailwind arbitrary
      // value cannot hold one.
      style={{ "--split-w": `${collapsed ? 0 : size}px` } as React.CSSProperties}
      className={cn("grid gap-5 lg:grid-cols-[var(--split-w)_auto_minmax(0,1fr)] lg:gap-0", className)}
    >
      {/* overflow-hidden so a collapsed 0px pane clips rather than spilling its
          content across the detail. */}
      <div id={`${paneId}-pane`} className="min-w-0 overflow-hidden">
        {children[0]}
      </div>

      {/*
        jsx-a11y classifies `separator` as non-interactive and therefore objects
        to the handlers. It is wrong for this case, and the ARIA spec is explicit
        about why: a separator is non-interactive UNLESS it is focusable, and a
        FOCUSABLE separator is the Window Splitter — a widget with a value, a
        range and arrow-key semantics. All of that is present here. The rule has
        no way to see `tabIndex={0}` and reclassify, so this is disabled with the
        reason rather than the pattern being bent to satisfy it.
      */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-controls={`${paneId}-pane`}
        aria-valuenow={collapsed ? 0 : size}
        aria-valuemin={0}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={toggleCollapse}
        title={`${label} — drag, or use the arrow keys`}
        className={cn(
          "hidden lg:block",
          // A 9px hit strip around a 1px rule: the line stays hairline, the
          // target is wide enough to grab in the axis that matters.
          "group relative mx-2 w-[9px] shrink-0 cursor-col-resize",
          "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border before:transition-colors",
          "hover:before:bg-[rgb(var(--brand-blue))]",
          "focus-visible:outline-none focus-visible:before:w-0.5 focus-visible:before:bg-[rgb(var(--brand-blue))]",
        )}
      />

      <div className="min-w-0">{children[1]}</div>
    </div>
  );
}
