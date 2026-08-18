/**
 * Back and forward, at the top of the icon rail.
 *
 * WHY THE RAIL AND NOT THE TITLE BAR. The title bar is the obvious answer —
 * it is where every browser puts these — and it is the wrong one here. That
 * strip IS the window's drag region under Window Controls Overlay (`.wco` in
 * index.css), it already carries search, the clock, the environment chip, the
 * language and theme toggles, quick actions, alerts and the account menu, and
 * below `lg` it is full. Two more buttons there would be taken out of the only
 * area a user can grab to move the window.
 *
 * The rail's top, meanwhile, is already the fixed zone: Control Tower and
 * search, above the rule, unchanged by which family the ribbon is showing
 * (see `icon-rail.tsx`). Navigation controls belong with them, and putting
 * them at the very top puts them in the same screen corner a browser's back
 * button occupies — which is the muscle memory that actually matters.
 *
 * ONE CONTROL, NOT TWO BUTTONS. They are drawn as a vertical segmented pair
 * inside a single bordered pill with a hairline between them. Two loose icon
 * cells in a strip of ten other icon cells read as two more shortcuts; a
 * segmented pair reads as one instrument with two ends, the way a toolbar's
 * back/forward always has.
 *
 * PRESS AND HOLD FOR THE TRAIL. Holding either arrow — or right-clicking it —
 * opens the named list of where that direction leads, so twelve steps back is
 * one gesture instead of twelve clicks. This is the whole reason the trail is
 * kept as a labelled record rather than as a bare call to `history.back()`:
 * the browser cannot tell you what is behind you, and this can.
 *
 * DISABLED IS INFORMATION. At the start of a session both arrows are greyed,
 * and that is a true statement rather than a limitation — it says the trail
 * starts here. A button wired straight to `history.back()` can never say it.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { navT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownItem,
  DropdownLabel,
} from "@/components/ui/dropdown-menu";
import { useNavTrail } from "./nav-trail-context";
import type { TrailEntry } from "./nav-trail";

/** How long a press becomes a hold. 450ms is the platform convention for a
 *  long-press menu — short enough to discover by accident, long enough that a
 *  deliberate click never trips it. */
const HOLD_MS = 450;

/**
 * The chevrons.
 *
 * Drawn here rather than taken from `nav-icons.tsx` because the set's shared
 * `sic()` helper fixes a 24px box and 1.9 stroke tuned for area glyphs, and a
 * bare two-segment chevron at that weight reads thin beside them. These carry
 * a slightly heavier stroke and a narrower shoulder, which is what keeps a
 * pure-geometry mark looking deliberate at 18px instead of looking like the
 * default triangle every framework ships.
 */
function ChevronLeft(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

function ChevronRight(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={17}
      height={17}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </svg>
  );
}

/** "Files" with "Operations" above it — the two lines a trail row shows. */
function EntryLines({ entry }: { entry: TrailEntry }) {
  return (
    <span className="flex min-w-0 flex-col">
      {entry.context && (
        <span className="truncate text-[11px] leading-tight text-muted-foreground/70">
          {entry.context}
        </span>
      )}
      <span className="truncate leading-tight">{entry.label}</span>
    </span>
  );
}

function ArrowButton({
  direction,
  label,
  target,
  enabled,
  steps,
  onGo,
  className,
}: {
  direction: -1 | 1;
  label: string;
  target: TrailEntry | undefined;
  enabled: boolean;
  steps: { entry: TrailEntry; delta: number }[];
  onGo: (delta: number) => void;
  className?: string;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const holdTimer = React.useRef<number | null>(null);
  // Set the moment a hold fires, so the pointerup that follows is not also
  // treated as a click. Without it, holding would open the menu and navigate.
  const held = React.useRef(false);

  const clearHold = React.useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  React.useEffect(() => clearHold, [clearHold]);

  function startHold(e: React.PointerEvent) {
    // Primary button only — a right-click has its own path below, and a
    // middle-click should do nothing at all.
    if (e.button !== 0 || !enabled || steps.length === 0) return;
    held.current = false;
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      held.current = true;
      setMenuOpen(true);
    }, HOLD_MS);
  }

  function endHold() {
    clearHold();
  }

  function onClick() {
    // The click that ends a hold is the hold, not a navigation.
    if (held.current) {
      held.current = false;
      return;
    }
    if (enabled) onGo(direction);
  }

  const tip = target
    ? `${label} — ${target.context ? `${target.context} · ` : ""}${target.label}`
    : `${label} (nothing ${direction === -1 ? "behind" : "ahead"})`;

  return (
    <div className="relative">
      <Tooltip content={tip} side="right">
        <button
          type="button"
          className={cn("rail-nav-btn", className)}
          aria-label={tip}
          aria-disabled={!enabled}
          onClick={onClick}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onContextMenu={(e) => {
            if (!enabled || steps.length === 0) return;
            e.preventDefault();
            setMenuOpen(true);
          }}
        >
          {direction === -1 ? <ChevronLeft /> : <ChevronRight />}
        </button>
      </Tooltip>
      {/*
        The menu anchors to the button without Radix owning the button's click:
        the trigger is an inert overlay pinned to the same box, so `open` stays
        ours to set from a hold or a right-click while a plain click still
        navigates. `modal={false}` keeps the rail behind it live, so a user who
        opened the menu by accident can simply click the arrow again.
      */}
      <DropdownMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        modal={false}
        align="start"
        label={label}
        trigger={
          <span
            className="pointer-events-none absolute inset-0"
            aria-hidden
            tabIndex={-1}
          />
        }
      >
        <DropdownLabel>{label}</DropdownLabel>
        {steps.map(({ entry, delta }) => (
          <DropdownItem
            key={`${entry.idx}:${entry.url}`}
            onSelect={() => onGo(delta)}
          >
            <EntryLines entry={entry} />
          </DropdownItem>
        ))}
      </DropdownMenu>
    </div>
  );
}

/**
 * The pair. Renders nothing at all when the trail has nowhere to go in either
 * direction AND has never had anywhere to go — a first visit gets no dead
 * controls. Once the user has moved once, the pair stays put: a control that
 * appears and disappears under the pointer is worse than a greyed one.
 */
export function NavArrows() {
  const { t } = useTranslation();
  const { canBack, canForward, backTarget, forwardTarget, steps, go, trail } =
    useNavTrail();

  if (trail.entries.length <= 1) return null;

  return (
    <div className="rail-nav" role="group" aria-label={navT(t, "History")}>
      <ArrowButton
        direction={-1}
        label={navT(t, "Back")}
        target={backTarget}
        enabled={canBack}
        steps={steps(-1)}
        onGo={go}
      />
      <span className="rail-nav-split" aria-hidden />
      <ArrowButton
        direction={1}
        label={navT(t, "Forward")}
        target={forwardTarget}
        enabled={canForward}
        steps={steps(1)}
        onGo={go}
      />
    </div>
  );
}
