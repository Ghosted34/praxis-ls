/**
 * The hover card on a route.
 *
 * WHY IT IS A DOM ELEMENT AND NOT AN SVG `<title>`. `<title>` is what the map had:
 * a native browser tooltip after a second's delay, unstyled, one line, and
 * invisible to a touch device. An operations meeting hovers a lane and needs the
 * file reference, the leg, the route, where it has got to and when it is due —
 * five facts, immediately. So the card is real markup positioned over the map.
 *
 * HOVER IS NEVER THE ONLY ROUTE TO THIS. The same card renders on keyboard focus,
 * and every fact in it is also in the itinerary panel a click opens. That is not
 * politeness, it is WCAG §1.4.13 and §2.1.1: information available on hover alone
 * is information a keyboard or screen-reader user does not have.
 *
 * `pointer-events-none` so the card cannot steal the hover that produced it — the
 * classic tooltip flicker, where moving toward the card leaves the lane, which
 * hides the card, which returns the hover to the lane.
 */
import { dateFmt } from "@/lib/format";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { MODE_ICON, MODE_LABEL } from "../mode-icons";
import { LEG_TYPE_LABEL } from "../leg-labels";
import type { MapLane } from "../map/projection";

export type HoverTarget = {
  lane: MapLane;
  /** Anchor in SVG user units — the map converts to a percentage for the caller. */
  x: number;
  y: number;
};

export function MapTooltip({
  target,
  width,
  height,
  eta,
  milestone,
  progress,
}: {
  target: HoverTarget;
  /** The SVG viewBox dimensions, so the anchor can be expressed as a percentage
   *  and stay correct at every rendered size — including full screen. */
  width: number;
  height: number;
  eta?: string | null;
  milestone?: string | null;
  progress?: number | null;
}) {
  const { lane, x, y } = target;
  const Icon = MODE_ICON[lane.mode];
  // Flip the card to the other side near an edge so it cannot be clipped by the
  // map's own overflow. The map is often the narrowest column on the page.
  const left = (x / width) * 100;
  const top = (y / height) * 100;
  const flipX = left > 62;
  const flipY = top > 68;

  return (
    <div
      // aria-hidden: the card duplicates what the focused route already announces
      // through its own accessible name, and a live region that repeats it would
      // read the whole thing twice on every arrow-key press.
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-[2] w-60 rounded-lg border bg-popover/95 p-2.5 shadow-lg backdrop-blur-sm",
        flipX ? "-translate-x-full" : "translate-x-2",
        flipY ? "-translate-y-full" : "translate-y-2",
      )}
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="num truncate text-label font-semibold text-primary-ink">{lane.ref}</span>
        <Pill tone="mute">{lane.status}</Pill>
      </div>

      <div className="mt-1 flex items-center gap-1.5 text-micro font-semibold normal-case text-muted-foreground">
        <Icon width={12} height={12} />
        {MODE_LABEL[lane.mode]}
        <span aria-hidden>·</span>
        {LEG_TYPE_LABEL[lane.legType] || lane.legType}
      </div>

      <p className="mt-1 truncate text-label font-medium text-foreground">
        {lane.fromName} → {lane.toName}
      </p>

      {milestone && <p className="mt-1 truncate text-micro normal-case text-muted-foreground">{milestone}</p>}
      {eta && (
        <p className="text-micro normal-case text-muted-foreground">
          Due {dateFmt(eta)}
        </p>
      )}

      {progress !== null && progress !== undefined && (
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-[rgb(var(--ink)_/_0.08)]">
          <span
            className="block h-full rounded-full bg-[linear-gradient(90deg,rgb(var(--brand-blue-bright)),var(--primary))]"
            style={{ width: `${progress}%` }}
          />
        </span>
      )}
    </div>
  );
}
