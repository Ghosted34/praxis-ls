/**
 * The icon rail — a fixed strip of shortcuts down the left edge.
 *
 * ICONS ONLY, AND IT NEVER WIDENS. The obvious pattern here is a rail that
 * expands to show labels on hover. It is the wrong one for this product: the
 * content beside it is tables, and a rail that widens reflows every column in
 * one while the pointer merely crosses the edge of the window on its way
 * somewhere else. Labels come from a tooltip, which costs nothing and moves
 * nothing.
 *
 * IT IS NOT A SECOND RIBBON. The contents do not change with the ribbon's
 * active family — see `rail-model.ts`. Control Tower and search are fixed, the
 * middle is whatever this user pinned, and the tail is the quick actions the
 * desktop menu and the touch cluster already share (`quick-actions.tsx`), so
 * there is one list of those rather than a third.
 *
 * THE `+` AT THE BOTTOM, AND ITS ONE JIGGLE. A customisable rail that nobody
 * knows is customisable is not customisable. A single short shake on a user's
 * first session teaches it; anything more is a tic. It fires once, is recorded
 * server-side (`railHintSeen`) so it does not repeat on another device, and is
 * suppressed entirely under `prefers-reduced-motion` — index.css kills the
 * animation globally too, but a hint that silently does nothing should not also
 * spend the one time it was allowed to fire.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { navT } from "@/lib/i18n";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";
import { useShell } from "./shell-context";
import { buildRibbon, iconForArea } from "./ribbon-model";
import { resolveRailPins, pinRoute } from "./rail-model";
import { useCommandPalette } from "./command-palette-context";
import { useQuickActions } from "@/components/quick-actions";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { RailPinsSkeleton } from "./shell-skeleton";
import { NavCluster } from "./nav-cluster";
import { SearchIcon, TowerIcon, type IP } from "./nav-icons";

function PlusIcon(p: IP) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      aria-hidden
      {...p}
    >
      <path d="M12 6v12M6 12h12" />
    </svg>
  );
}

/** One rail cell. A link when it navigates, a button when it acts. */
function RailButton({
  label,
  active,
  to,
  onSelect,
  className,
  children,
}: {
  label: string;
  active?: boolean;
  to?: string;
  onSelect?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const cls = cn("rail-btn", active && "active", className);
  return (
    <Tooltip content={label} side="right">
      {to ? (
        <Link to={to} className={cls} aria-label={label}>
          {children}
        </Link>
      ) : (
        <button
          type="button"
          className={cls}
          onClick={onSelect}
          aria-label={label}
        >
          {children}
        </button>
      )}
    </Tooltip>
  );
}

export function IconRail() {
  const { t } = useTranslation();
  const { access, ready, resolved, prefs, setPrefs } = useShell();
  const { pathname } = useLocation();
  const palette = useCommandPalette();
  const quickActions = useQuickActions();
  const reducedMotion = usePrefersReducedMotion();

  const families = React.useMemo(() => buildRibbon(access), [access]);
  const pins = React.useMemo(
    () => resolveRailPins(prefs.railPins, families),
    [prefs.railPins, families],
  );

  /*
   * Fire once, then record it — and DECIDE ONLY ONCE PER MOUNT.
   *
   * Two things would otherwise go wrong, and neither is visible in review.
   * Deciding before `ready` reads the all-null starting preferences as a first
   * login, so every returning user spends their one hint on a frame nobody
   * sees. And deriving the class from `prefs.railHintSeen` means the write that
   * records the hint immediately removes the class that is mid-animation — the
   * nudge would last one render. So the answer is latched in state, and the
   * write goes out beside it.
   */
  const [jiggle, setJiggle] = React.useState(false);
  const decided = React.useRef(false);
  React.useEffect(() => {
    if (!ready || decided.current) return;
    decided.current = true;
    // Under `prefers-reduced-motion` the hint is neither shown nor recorded:
    // index.css strips the animation anyway, and spending the one time it may
    // fire on a frame nobody sees teaches nothing.
    if (prefs.railHintSeen === null && !reducedMotion) {
      setJiggle(true);
      setPrefs({ railHintSeen: true });
    }
  }, [ready, prefs.railHintSeen, reducedMotion, setPrefs]);

  return (
    <nav
      className="rail hidden flex-none flex-col items-center md:flex"
      aria-label={navT(t, "Shortcuts")}
    >
      {/* Above everything, including Control Tower. Back, forward and refresh
          are the only controls here that act on where the user just WAS or on
          what they are already looking at, rather than on where they might go,
          and the top of the strip is the one place a hand reaches for them —
          see `nav-cluster.tsx` for why all three share one pill, and
          `nav-arrows.tsx` for why they are here at all and not in the title
          bar. Always rendered; the arrows grey when the trail starts here. */}
      <NavCluster />

      <RailButton
        label={navT(t, "Control Tower")}
        to="/"
        active={pathname === "/"}
      >
        <TowerIcon width={18} height={18} />
      </RailButton>
      <RailButton label={navT(t, "Search (⌘K)")} onSelect={palette.open}>
        <SearchIcon width={18} height={18} />
      </RailButton>

      <span className="rail-rule" aria-hidden />

      {/* Placeholders only on a genuine cache miss. The rail's fixed ends are
          not permission-derived, so they are themselves from the first frame;
          only the pinned middle — the part that really is unknown — shimmers,
          and it reserves the height the resolved pins will take. */}
      {!resolved ? (
        <RailPinsSkeleton />
      ) : (
        pins.map((area) => {
          const Icon = iconForArea(area.label);
          const to = pinRoute(area);
          return (
            <RailButton
              key={area.key}
              label={navT(t, area.label)}
              to={to}
              active={pathname === to || pathname.startsWith(to + "/")}
            >
              <Icon width={18} height={18} />
            </RailButton>
          );
        })
      )}

      {/* Pushes the quick actions and the editor to the bottom, so the pinned
          middle can grow without the two ends moving. */}
      <span className="flex-1" />

      {quickActions.map((a) => (
        <RailButton key={a.key} label={a.label} onSelect={a.onSelect}>
          <a.Icon width={18} height={18} />
        </RailButton>
      ))}

      <span className="rail-rule" aria-hidden />

      <RailButton
        label={navT(t, "Edit shortcuts")}
        to="/my-appearance"
        className={cn("rail-edit", jiggle && "rail-jiggle")}
      >
        <PlusIcon />
      </RailButton>
    </nav>
  );
}
