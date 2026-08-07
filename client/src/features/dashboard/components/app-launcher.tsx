/**
 * Application launcher — the Control Tower's 11+1 shortcut grid.
 *
 * ELEVEN USER-PINNED TILES, plus a fixed "More" card in the twelfth slot that
 * expands the grid inline. Row 1 is six tiles across; row 2 is five tiles
 * plus the "More" card, keeping the block at exactly the same height whether
 * or not it is expanded. Below xl the columns drop by media query and the
 * grid still reads left-to-right in the same order.
 *
 * WHY EVERYTHING HERE IS DERIVED, NOT FETCHED. The candidates, the pinned
 * subset, and each tile's sub-nav preview all come from one input — the
 * `access` on ShellContext — through the same `buildRibbon` the ribbon
 * itself uses. That answer is served from `nav-access-cache` on the first
 * frame and revalidated on focus/navigation in `shell-providers.tsx`, so the
 * launcher does not add a request; a `useMemo` keyed on `access` recomputes
 * the tiles once per grant change and never on re-render.
 *
 * SUB-NAV DEEP LINKS ARE INSIDE THE CARD, and they must not activate the
 * card. Every subtitle button calls `stopPropagation` (and `preventDefault`
 * against the outer `<Link>`'s default) so a click on "Milestones" navigates
 * to `/operations/milestones` and NOT to `/operations`. The card's body is a
 * `<Link>` for middle-click and open-in-new-tab; the subtitle strip is a
 * `<Link>` too, for the same reason.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useShell } from "@/app/layout/shell-context";
import { buildRibbon, iconForArea } from "@/app/layout/ribbon-model";
import type { Area } from "@/app/layout/areas";
import {
  previewSections,
  resolveTowerPins,
  towerLandingRoute,
  unpinnedTowerAreas,
  unresolvedFallbackAreas,
  MAX_TOWER_PINS,
  type TowerSubnav,
} from "../tower-model";

type IP = React.SVGProps<SVGSVGElement>;

function MoreIcon(p: IP) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <circle cx={5} cy={12} r={1.4} />
      <circle cx={12} cy={12} r={1.4} />
      <circle cx={19} cy={12} r={1.4} />
    </svg>
  );
}

/**
 * The strip of deep links under a tile's title.
 *
 * A `<Link>` rather than a `<button>` so middle-click and ⌘-click open the
 * section in a new tab, which is how a lot of dashboard users work when the
 * Control Tower is their launch pad. `stopPropagation` on the click AND on
 * pointerdown, because React Router's `<Link>` fires navigation on click
 * — but the outer card's `<Link>` also intercepts pointer events on some
 * platforms during focus handling.
 */
function SubnavStrip({ items }: { items: TowerSubnav[] }) {
  if (items.length === 0) return null;
  // No handler on the <ul>: the strip sits above the tile's stretched body-link
  // (`::after` at inset 0) via `position: relative; z-index: 10` in Tile, so a
  // click on a deep link lands on THAT link — the body link never sees it.
  // The per-link stopPropagation is defence in depth for platforms whose
  // pointer-events model doesn't respect z-order for `::after` overlays.
  return (
    <ul className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
      {items.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2 text-label text-muted-foreground">
          <Link
            to={s.to}
            className="rounded-sm underline-offset-2 hover:text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {s.label}
          </Link>
          {i < items.length - 1 && <span aria-hidden className="text-muted-foreground/60">·</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * One tile. Two child anchors — a body link that carries the main-card click
 * and a subtitle strip of deep links — because nested `<a>` tags are invalid
 * HTML and swallow inner clicks. The visible card is a plain container; the
 * body-link is stretched across it with `absolute inset-0` so the whole tile
 * is one click target for the primary destination, except where a subtitle
 * anchor sits above it in the stacking order.
 */
function Tile({
  area,
  subnav,
  tint,
}: {
  area: Area;
  subnav: TowerSubnav[];
  tint: "primary" | "blue";
}) {
  const Icon = iconForArea(area.label);
  const to = towerLandingRoute(area);

  return (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-lg border bg-card p-4 shadow-[var(--shadow-s)]",
        "transition-colors focus-within:border-[color-mix(in_srgb,var(--primary)_35%,var(--border))]",
        "hover:border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] hover:bg-accent/40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mb-3 grid h-10 w-10 place-items-center rounded-md",
          tint === "primary"
            ? "bg-[color-mix(in_srgb,var(--primary)_11%,transparent)] text-primary-ink"
            : "bg-[rgb(var(--brand-blue)_/_0.12)] text-[rgb(var(--brand-blue-ink))]",
        )}
      >
        <Icon />
      </span>
      {/* The stretched link IS the tile — the body's click target. Sits under
          the subtitle strip in the stacking order so a click on a deep link
          hits that link, not this one. */}
      <Link
        to={to}
        className="rounded-sm text-base font-semibold leading-tight after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {area.label}
      </Link>
      {/* Positioned relative so it sits above the stretched link's `::after`. */}
      <div className="relative z-10">
        <SubnavStrip items={subnav} />
      </div>
    </div>
  );
}

/**
 * The "+1" trigger.
 *
 * A `<button>`, not a `<Link>` — it toggles state, it does not navigate. The
 * label swaps as the panel opens ("More" → "Less") so the twelfth slot never
 * turns into a dead card; `aria-expanded` and `aria-controls` tell assistive
 * tech which panel it opens.
 */
function MoreCard({
  open,
  count,
  onToggle,
  controls,
}: {
  open: boolean;
  count: number;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className={cn(
        "flex h-full flex-col rounded-lg border border-dashed bg-card p-4 text-left shadow-[var(--shadow-s)]",
        "transition-colors hover:border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] hover:bg-accent/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
      )}
    >
      <span
        aria-hidden
        className="mb-3 grid h-10 w-10 place-items-center rounded-md bg-[color-mix(in_srgb,var(--primary)_11%,transparent)] text-primary-ink"
      >
        <MoreIcon />
      </span>
      <span className="text-base font-semibold leading-tight">{open ? "Less" : "More"}</span>
      <span className="mt-0.5 text-label text-muted-foreground">
        {count === 0 ? "Everything is pinned" : open ? "Hide the rest" : `${count} more module${count === 1 ? "" : "s"}`}
      </span>
    </button>
  );
}

/**
 * The 11+1 grid.
 *
 * `pinned` fills the first eleven cells; the twelfth is `MoreCard`. When
 * `open`, `rest` renders in the same grid below — which is what the user
 * asked for: an INLINE expansion, not a popover, not a modal. The block
 * below the grid slides down because the DOM does; nothing overlays.
 */
export function AppLauncher({ onBrowseAll }: { onBrowseAll: () => void }) {
  const { access, resolved, prefs } = useShell();
  const families = React.useMemo(() => buildRibbon(access), [access]);

  // ONE memo, keyed on access + pins + resolved. Everything below derives
  // from those and each is already stable across re-renders — `access` only
  // ticks on grant changes, `prefs.towerPins` only on the user's own toggle,
  // `resolved` flips once per shell mount.
  //
  // WHY THE `!resolved` BRANCH EXISTS. Same rule as `useCanOpenRoute`: an
  // unresolved read looks identical to a user with no access, and the ribbon
  // that feeds `buildRibbon` is empty during that frame. Filtering against it
  // would collapse the launcher to a single "More" card on every genuine
  // first login — a home screen that arrives that way teaches the user the
  // feature is broken. Over-offering for one frame is recoverable; a real
  // 403 on click lands on the same page any stale link would.
  const { pinned, rest, subnavByKey } = React.useMemo(() => {
    if (!resolved) {
      const fallback = unresolvedFallbackAreas().slice(0, MAX_TOWER_PINS);
      return { pinned: fallback, rest: [], subnavByKey: new Map<string, TowerSubnav[]>() };
    }
    const pins = resolveTowerPins(prefs.towerPins, families);
    const remaining = unpinnedTowerAreas(pins, families);
    const map = new Map<string, TowerSubnav[]>();
    for (const a of [...pins, ...remaining]) map.set(a.key, previewSections(a, families));
    return { pinned: pins, rest: remaining, subnavByKey: map };
  }, [resolved, prefs.towerPins, families]);

  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();

  // Alternating tint by GRID POSITION so a re-order does not break the
  // "no orange band" pattern. The `<More>` card counts as a slot, so `rest`
  // continues the alternation past the trigger.
  const tintAt = (i: number): "primary" | "blue" => (i % 2 === 0 ? "primary" : "blue");

  return (
    <section aria-labelledby="ct-apps">
      <div className="mb-3 mt-6 flex items-center gap-3">
        <h2 id="ct-apps" className="text-title font-semibold tracking-tight">
          Applications
        </h2>
        <span aria-hidden className="h-px flex-1 bg-border" />
        <button
          type="button"
          onClick={onBrowseAll}
          className="rounded-sm text-label font-semibold text-primary-ink hover:underline"
        >
          Browse everything →
        </button>
      </div>

      {/*
        SIX COLUMNS AT XL, dropping to four/three/two below. The 6+5+1 shape
        is only exact at xl; below it, the same tiles reflow into whatever
        the media query allows, and the "More" card stays as the last item
        so the trigger is always the tail of the grid.
      */}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {pinned.map((area, i) => (
          <li key={area.key}>
            <Tile area={area} subnav={subnavByKey.get(area.key) ?? []} tint={tintAt(i)} />
          </li>
        ))}
        <li key="__more">
          <MoreCard
            open={open}
            count={rest.length}
            onToggle={() => setOpen((v) => !v)}
            controls={panelId}
          />
        </li>
      </ul>

      {/*
        The inline expansion. Same grid so the columns line up with the pinned
        tiles above, and `hidden` rather than a conditional render so the DOM
        exists at mount — the browser's focus manager can then find a tile
        that opens from a URL parameter (a future enhancement) without a
        second layout pass.

        THE `grid` UTILITY MUST STAY CONDITIONAL ON `open`. The native
        `hidden` attribute and Tailwind's `grid` class both set `display`
        with the same specificity (an attribute selector vs. a single class
        selector); whichever rule the cascade sees last wins, and Tailwind's
        stylesheet loads after the UA default that backs `[hidden]`. With
        `grid` applied unconditionally, `hidden` never actually hid this
        panel — the "8 more modules" tiles rendered permanently, whether the
        trigger read "More" or "Less". Only the "grid" token needs to be
        conditional; `grid-cols-*`/`gap-*` don't touch `display` so they're
        harmless either way.
      */}
      <ul
        id={panelId}
        aria-label="More applications"
        hidden={!open}
        className={cn(
          "mt-3 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
          open && "grid",
          // Border-top rule for the visual distinction from the pinned set —
          // subtle, because the two rows are the same kind of tile, not two
          // different concepts.
          !!rest.length && "border-t border-dashed pt-3",
        )}
      >
        {rest.map((area, i) => (
          <li key={area.key}>
            <Tile area={area} subnav={subnavByKey.get(area.key) ?? []} tint={tintAt(pinned.length + 1 + i)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
