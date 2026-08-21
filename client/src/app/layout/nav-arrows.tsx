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
 * ONE CONTROL, NOT TWO BUTTONS. The two arrows are a vertical segmented pair
 * with a hairline between them, and they share a bordered pill with the refresh
 * cell below (`nav-cluster.tsx`, which draws it). Loose icon cells in a strip of
 * ten other icon cells read as more shortcuts; a segmented group reads as one
 * instrument, the way a toolbar's back/forward/reload always has.
 *
 * PRESS AND HOLD FOR THE TRAIL. Holding either arrow — or right-clicking it —
 * opens the named list of where that direction leads, so twelve steps back is
 * one gesture instead of twelve clicks. This is the whole reason the trail is
 * kept as a labelled record rather than as a bare call to `history.back()`:
 * the browser cannot tell you what is behind you, and this can. The gesture
 * itself lives in `use-hold-menu.ts`, shared with the refresh cell below.
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
import { useHoldMenu } from "./use-hold-menu";
import type { TrailEntry } from "./nav-trail";

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
  // A greyed arrow has nothing to list, so holding it must stay inert rather
  // than opening an empty menu — which would make the gesture look broken on
  // the one press where the user is already being told "there is nothing here".
  const menu = useHoldMenu(enabled && steps.length > 0, () => {
    if (enabled) onGo(direction);
  });

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
          {...menu.handlers}
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
        open={menu.open}
        onOpenChange={menu.setOpen}
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
 * The pair, and it is ALWAYS THERE.
 *
 * It used to return null until the trail held more than one entry, on the
 * theory that a first visit should not be given dead controls. That was wrong,
 * and wrong against this file's own rule two paragraphs up: the trail lives in
 * `sessionStorage`, so every fresh tab starts with exactly one entry — meaning
 * the arrows were absent every single time the app was opened, and appeared
 * only after the first click. A control you cannot see on load is a control you
 * do not know exists, and chrome that comes and goes is worse than chrome that
 * is greyed.
 *
 * So both arrows render from the first frame, disabled until there is somewhere
 * to go. Disabled is information here — it says the trail starts here, which is
 * true, and which a button wired to `history.back()` could never say.
 */
export function NavArrows() {
  const { t } = useTranslation();
  const { canBack, canForward, backTarget, forwardTarget, steps, go } =
    useNavTrail();

  return (
    <>
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
    </>
  );
}
