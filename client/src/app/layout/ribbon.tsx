/**
 * The ribbon — two rows of chrome that replace the old area-nav strip and every
 * hub's in-page tab bar.
 *
 *   Row A   the workflow families, from `GET /permissions/mine`. Up to six.
 *   Row B   left, the destinations of the family you are in; right, the
 *           commands the current screen has published.
 *
 * WHAT THIS REPLACES, AND WHY IT IS FEWER ROWS AND NOT MORE. Before this, a
 * desktop user looking at an operations file passed three bands of navigation
 * before the first row of data: the title bar, an area menubar, and the hub's
 * own tab strip. The tab strip is now row B, so the count goes from three to
 * two, and the second one is doing the job the third used to.
 *
 * IT MUST LOOK RESOLVED AT ANY TAB COUNT. Access is per-role, so one user gets
 * six families and another gets two, and the two-tab case must not read as a
 * six-tab ribbon with four missing. That is why row A is a bounded TRACK —
 * a recessed group sized to its contents, like a segmented control — rather
 * than a row of links that runs out. Two segments in a track is a control; two
 * links in a 1600px row is a mistake. The pin toggle holds the right end at
 * every count, so the row is a pair of objects rather than a left-weighted
 * fringe.
 *
 * HEIGHT follows the density preference, exactly as `.wco` does — see `.ribbon`
 * in index.css. Two rows at the default level is 92px of chrome.
 *
 * NOT ON MOBILE. Below `md` this renders nothing: a horizontally scrolling
 * ribbon is the tell of a web page wearing an app's clothes. The phone gets the
 * bottom nav and a family sheet (`family-sheet.tsx`).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router-dom";
import { navT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { areaRoute, sectionRoute, type Area, type AreaSection } from "./areas";
import {
  buildRibbon,
  iconForArea,
  locate,
  type RibbonArea,
  type RibbonFamily,
} from "./ribbon-model";
import { useShell } from "./shell-context";
import { useRibbonCommandList } from "./ribbon-commands";
import { RibbonSkeleton } from "./shell-skeleton";
import { readCachedRibbonPinned } from "@/lib/nav-access-cache";
import { ChevronIcon, MoreIcon } from "./nav-icons";
import {
  DropdownMenu,
  DropdownItem,
  DropdownLabel,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * Progressive reveal for row B, by viewport tier.
 *
 * The same device `nav-model.ts` uses for the old top bar, and for the same
 * reason: Tailwind cannot see a class assembled at runtime, and measuring text
 * to decide what fits means a layout pass on every navigation. The overflow menu
 * beside the row always holds EVERY item — including the ones already shown —
 * so no destination is ever only reachable at one window width, and nobody has
 * to work out which bucket a section is in.
 */
const REVEAL = [
  "inline-flex",
  "inline-flex",
  "inline-flex",
  "inline-flex",
  "inline-flex",
  "inline-flex",
  "hidden lg:inline-flex",
  "hidden lg:inline-flex",
  "hidden xl:inline-flex",
  "hidden 2xl:inline-flex",
];
const revealClass = (i: number) => REVEAL[i] ?? "hidden";

/**
 * At what breakpoint every item in a row of length `count` is already visible,
 * so the overflow trigger can hide itself instead of sitting there as a
 * redundant "…" beside a complete row. Below that width the menu remains — no
 * destination is ever only reachable through it, and no destination is ever
 * unreachable without it.
 *
 * MUST TRACK REVEAL, and the layout gate asserts the equivalence in a real
 * browser rather than trusting this comment. A nine-item row completes at `xl`
 * and a ten-item row at `2xl`, which is what lets Master Data — nine sections,
 * the longest of them "Financial dictionary" — show every one of them on a
 * 1280px-wide viewport. That width is not hypothetical: a 1920px monitor at
 * Windows' 125% scaling reports 1536 CSS px, so the tier below `2xl` is where
 * a good share of real desktops actually sit.
 */
function overflowHiddenAt(count: number): string {
  if (count <= 6) return "hidden"; // never needed — every item shows at md
  if (count <= 8) return "lg:hidden";
  if (count === 9) return "xl:hidden";
  return "2xl:hidden"; // the tenth item is the only one held back to 2xl
}

/** A drawing pin, filled when the ribbon is held open. */
function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      aria-hidden
      fill={pinned ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3h6l-1 5 3 3v2H7v-2l3-3z" />
      <path d="M12 13v8" fill="none" />
    </svg>
  );
}

/** Row B's left cluster: what this family contains, scoped to where you are. */
function NavCluster({
  family,
  active,
}: {
  family: RibbonFamily;
  active?: RibbonArea;
}) {
  const { t } = useTranslation();
  const area = active ?? family.areas[0];
  if (!area) return null;

  // An area with no sections of its own (the Control Tower, God mode) has
  // nothing to list, so the row lists the family's AREAS instead. That is the
  // right answer for `monitor`, whose four members are each a single screen —
  // and it means the row is never a lone dropdown with nothing beside it.
  const asAreas = area.sections.length === 0;
  const items: { key: string; label: string; to: string; end?: boolean }[] =
    asAreas
      ? family.areas.map((a) => ({
          key: a.area.key,
          label: navT(t, a.area.label),
          to: areaRoute(a.area),
          end: true,
        }))
      : area.sections.map((s: AreaSection) => ({
          key: s.key,
          label: navT(t, s.label),
          to: sectionRoute(area.area, s),
        }));

  return (
    <div className="flex min-w-0 items-center gap-1">
      {!asAreas && family.areas.length > 1 && (
        <AreaSwitcher family={family} current={area.area} />
      )}
      <nav
        className="flex min-w-0 items-center gap-0.5"
        aria-label={
          asAreas ? `${navT(t, family.label)} areas` : `${navT(t, area.area.label)} sections`
        }
      >
        {items.map((it, i) => (
          <NavLink
            key={it.key}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn("ribbon-item", revealClass(i), isActive && "active")
            }
          >
            {it.label}
          </NavLink>
        ))}
      </nav>
      {items.length > 4 && (
        <DropdownMenu
          align="start"
          className="grid w-[min(30rem,calc(100vw-8rem))] grid-cols-2 gap-0.5"
          trigger={
            <button
              type="button"
              className={cn("ribbon-item", overflowHiddenAt(items.length))}
              aria-label={`All ${asAreas ? navT(t, family.label) : navT(t, area.area.label)} destinations`}
            >
              <MoreIcon />
            </button>
          }
        >
          <DropdownLabel>
            <span className="micro">
              {asAreas ? navT(t, family.label) : navT(t, area.area.label)}
            </span>
          </DropdownLabel>
          {items.map((it) => (
            <DropdownItem key={it.key} to={it.to}>
              <span className="truncate">{it.label}</span>
            </DropdownItem>
          ))}
        </DropdownMenu>
      )}
    </div>
  );
}

/** Which area of the family you are in, and how to reach its siblings. */
function AreaSwitcher({
  family,
  current,
}: {
  family: RibbonFamily;
  current: Area;
}) {
  return (
    <DropdownMenu
      align="start"
      trigger={
        <button type="button" className="ribbon-area">
          <span className="truncate">{current.label}</span>
          <ChevronIcon />
        </button>
      }
    >
      <DropdownLabel>
        <span className="micro">{family.label}</span>
      </DropdownLabel>
      {family.areas.map(({ area }) => {
        const Icon = iconForArea(area.label);
        return (
          <DropdownItem key={area.key} to={areaRoute(area)}>
            <Icon />
            <span className="truncate">{area.label}</span>
          </DropdownItem>
        );
      })}
    </DropdownMenu>
  );
}

/** Row B's right cluster. Right-aligned, and never empty while you are inside
 *  an area — getting back to a hub's landing page previously meant finding the
 *  breadcrumb. */
function CommandCluster({
  area,
  pathname,
}: {
  area?: RibbonArea;
  pathname: string;
}) {
  const commands = useRibbonCommandList();
  const landing = area ? areaRoute(area.area) : "";
  const showLanding =
    !!area && area.sections.length > 0 && pathname !== landing;

  /*
   * NOTHING TO SAY, SO SAY NOTHING.
   *
   * Only one screen publishes commands today, so on an area's landing page —
   * and on the five areas that are a single screen — this cluster had no
   * children and rendered an empty box. That is what made the row look
   * half-built: a region reserved for something that never arrives reads as a
   * missing feature, whereas a nav row with no commands beside it is simply a
   * nav row. Office does the same thing with its contextual tabs; they are
   * absent, not empty.
   *
   * Returning null also lets the row's `justify-between` collapse to a plain
   * left-aligned list rather than holding a spacer against nothing.
   */
  if (!showLanding && commands.length === 0) return null;

  return (
    <div className="flex flex-none items-center gap-1.5">
      {showLanding && (
        <Link to={landing} className="ribbon-item">
          {area.area.label} overview
        </Link>
      )}
      {commands.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.onSelect}
          className={cn("ribbon-cmd", c.primary && "primary")}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function Ribbon({ pathname }: { pathname: string }) {
    const { access, resolved, prefs, setPrefs } = useShell();
  const families = React.useMemo(() => buildRibbon(access), [access]);
  const { family: routeFamily, area: routeArea } = React.useMemo(
    () => locate(families, pathname),
    [families, pathname],
  );

  // Which family row B is describing. Normally the route decides. `chosen` only
  // carries you across a screen that is not in the ribbon at all — My
  // appearance, a document viewer — so the row does not snap back to the first
  // family the moment you open one.
  const [chosen, setChosen] = React.useState<string | null>(null);
  const family =
    routeFamily ?? families.find((f) => f.key === chosen) ?? families[0];

  // Read once per mount, not per render: the live value is `prefs.ribbonPinned`
  // the moment it exists, so re-reading storage would only ever return the same
  // answer the mirror was seeded with.
  const [cachedPinned] = React.useState(readCachedRibbonPinned);
  // `?? cached ?? true`, and the middle term is the one doing work. The API's
  // `null` means BOTH "still loading" and "never chosen", so a shell that fell
  // straight to `true` would open row B for a user who had collapsed it and
  // then shut it again when the preference landed — a 46px jump in the chrome,
  // which is precisely the shift the optimistic access cache exists to remove.
  // The local mirror is written by ShellProvider; see PINNED_KEY in
  // lib/nav-access-cache.ts for why it is not a second source of truth.
  const pinned = prefs.ribbonPinned ?? cachedPinned ?? true;
  // Unpinned, row B is summoned by clicking a family and dismissed by using it.
  // It overlays rather than expands, so summoning it never reflows the table
  // underneath — the reason Office's unpinned ribbon floats.
  const [peek, setPeek] = React.useState(false);
  React.useEffect(() => setPeek(false), [pathname]);
  React.useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPeek(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [peek]);

  // A CACHE MISS IS A SKELETON, NOT A HOLE. `resolved` is false only when this
  // device has never seen an answer for this user — a genuine first login. Every
  // other load draws the previous session's ribbon on the first frame and
  // reconciles behind it, so this branch is rare and is the only one where the
  // band's height would otherwise be zero.
  //
  // `families.length === 0` AFTER resolving is a different statement: the read
  // answered, and the answer is that there is nothing to show (a failed fetch,
  // or a user with no visible module). That stays blank — a permanent skeleton
  // over a ribbon that is never coming is worse than no ribbon.
  if (!resolved) return <RibbonSkeleton />;
  if (families.length === 0) return null;

  const showRowB = pinned || peek;

  return (
    <header
      className="ribbon relative z-30 hidden flex-none flex-col md:flex"
      aria-label="Ribbon"
    >
      <div className="ribbon-row flex items-center gap-3 px-4 md:px-6">
        {/*
          LINKS, NOT `role="tab"`. It looks like a segmented control and it
          behaves like one, so tab semantics are tempting — and they would be a
          lie: `role="tab"` promises arrow-key traversal and an associated
          `tabpanel`, and this has neither. That exact mismatch is what audit
          F13 caught across three hand-rolled tab bars in this codebase
          ("declared menu semantics with zero keyboard handling"), and the fix
          there was to stop claiming a pattern rather than to fake it.

          These ARE navigation: each family has a landing area, so each is a
          real href that middle-clicks and opens in a new tab. `aria-current`
          carries which one you are in.
        */}
        <nav className="ribbon-track" aria-label="Workflow">
          {families.map((f) => {
            const on = f.key === family?.key;
            const first = f.areas[0];
            return (
              <Link
                key={f.key}
                to={first ? areaRoute(first.area) : "/"}
                aria-current={on ? "page" : undefined}
                className={cn("ribbon-tab", on && "active")}
                onClick={() => {
                  setChosen(f.key);
                  if (!pinned) setPeek(true);
                }}
              >
                <f.Icon />
                <span>{f.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <Tooltip
          content={pinned ? "Collapse the ribbon" : "Keep the ribbon open"}
        >
          <button
            type="button"
            aria-pressed={pinned}
            aria-label={pinned ? "Collapse the ribbon" : "Keep the ribbon open"}
            onClick={() => {
              setPrefs({ ribbonPinned: !pinned });
              setPeek(false);
            }}
            className={cn("ribbon-pin", pinned && "active")}
          >
            <PinIcon pinned={pinned} />
          </button>
        </Tooltip>
      </div>

      {showRowB && family && (
        <div
          className={cn(
            // `justify-between` rather than a spacer div: when the command
            // cluster has nothing to show it renders null, and a row built
            // around a spacer would still be holding one against nothing.
            "ribbon-row flex items-center justify-between gap-3 px-4 md:px-6",
            // Unpinned, the row floats over the content instead of pushing it
            // down — a table that jumps 46px because you glanced at the nav is
            // the thing an unpinned ribbon exists to avoid.
            !pinned &&
              "absolute left-0 right-0 top-full border-b bg-card shadow-[var(--shadow-l)]",
          )}
        >
          <NavCluster family={family} active={routeArea} />
          <CommandCluster area={routeArea} pathname={pathname} />
        </div>
      )}
    </header>
  );
}
