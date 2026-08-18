/**
 * Navigation below `md` — the bottom bar, and the sheet a family opens into.
 *
 * WHY NOT THE RIBBON, SHRUNK. A ribbon on a phone is a horizontally scrolling
 * strip of tabs, and a horizontally scrolling strip of tabs is the single
 * clearest tell that you are looking at a desktop web page in a browser
 * pretending to be an app. Content that scrolls sideways under a thumb also
 * competes with the browser's own back gesture on both platforms.
 *
 * So the phone gets the pattern phones actually use: persistent bottom
 * destinations, and a sheet that rises from the bottom when you pick one. The
 * destinations are the same six families as the ribbon's first row, filtered
 * the same way, from the same source — a phone user and a desktop user are
 * looking at the same product, not two products that happen to share an API.
 *
 * The sheet is `Dialog`, not a hand-rolled panel: focus trap, Escape, scroll
 * lock and the `aria-labelledby` wiring are the things a bespoke drawer gets
 * wrong, and `Dialog` is already a bottom sheet at this width.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { navT } from "@/lib/i18n";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/dialog";
import { areaRoute, sectionRoute } from "./areas";
import {
  buildRibbon,
  iconForArea,
  locate,
  type RibbonFamily,
} from "./ribbon-model";
import { useShell } from "./shell-context";
import { GridIcon } from "./nav-icons";

/** Everything inside one family, as a phone reads it: area, then its screens. */
function FamilySheet({
  family,
  onClose,
}: {
  family: RibbonFamily | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={!!family}
      onClose={onClose}
      title={family?.label ? navT(t, family.label) : ""}
      size="md"
    >
      {family && (
        <div className="flex flex-col gap-5">
          {family.areas.map(({ area, sections }) => {
            const Icon = iconForArea(area.label);
            return (
              <section key={area.key}>
                <Link
                  to={areaRoute(area)}
                  onClick={onClose}
                  className="flex items-center gap-2.5 rounded-md px-1 py-2 text-sm font-semibold text-foreground"
                >
                  <Icon />
                  <span>{navT(t, area.label)}</span>
                </Link>
                {sections.length > 0 && (
                  <div className="mt-0.5 flex flex-col gap-0.5 pl-[26px]">
                    {sections.map((s) => (
                      <Link
                        key={s.key}
                        to={sectionRoute(area, s)}
                        onClick={onClose}
                        className="rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                      >
                        {navT(t, s.label)}
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}

/**
 * The bottom bar. One thumb target per family, and nothing else.
 *
 * SEARCH USED TO BE THE LAST CELL, and taking it out is the point rather than a
 * side effect. The title bar's search button is now unconditional (it was
 * `lg:flex`, which left 768–1023px with no touch path to search at all), so
 * this cell had become a second control opening the same palette — and it was
 * charging every family a share of the width for it.
 *
 * The arithmetic that pays for: six families on a 360px screen is ~58px each
 * against the 44px platform minimum, where seven was 51px and the 10px label
 * plus tight padding was the price of clearing it at all. Most users have fewer
 * than six families; a CEO with all six is the dense case, and it is now the
 * dense case with headroom.
 *
 * THREE STATES, AND THE BAR HAS TO SAY WHICH. `buildRibbon(NO_ACCESS)` returns
 * nothing, so a bar that only read `access` looked exactly the same whether the
 * permissions read was still in flight, had failed, or had honestly come back
 * with nothing this user can reach. With Search gone the empty case is now
 * empty — a bar of pure background — which makes the distinction MORE
 * load-bearing, not less: on a phone the bottom bar IS the navigation, so
 * "finished, and blank" is the worst of the three to present.
 *
 *   loading   placeholders, `aria-busy` — visibly unfinished, nothing to press
 *   nothing   a route into the hamburger drawer, which is the complete,
 *             deliberately unfiltered index and is reachable regardless of what
 *             the permissions read did
 *   families  the real bar
 */
export function BottomNav({ onMenu }: { onMenu?: () => void }) {
  const { t } = useTranslation();
  const { access, ready } = useShell();
  const { pathname } = useLocation();
  const families = React.useMemo(() => buildRibbon(access), [access]);
  const [open, setOpen] = React.useState<string | null>(null);
  const active = locate(families, pathname).family;

  React.useEffect(() => setOpen(null), [pathname]);

  return (
    <>
      <nav
        className="lux-botnav flex md:hidden"
        aria-label="Primary"
        aria-busy={!ready || undefined}
      >
        {!ready ? (
          /*
           * Three inert cells, so the bar occupies its real height and reads as
           * "not yet" rather than as "nothing". No animation: this resolves in
           * one round trip, and a pulse on a strip the thumb rests against is
           * motion for its own sake.
           */
          <>
            {[0, 1, 2].map((i) => (
              <span key={i} className="lux-botnav-btn" aria-hidden>
                <span className="h-5 w-5 rounded-md bg-current opacity-20" />
                <span className="mt-0.5 h-2 w-8 rounded bg-current opacity-20" />
              </span>
            ))}
            <span className="sr-only">Loading navigation…</span>
          </>
        ) : families.length === 0 ? (
          /*
           * Nothing to show, for whatever reason. The drawer lists every area in
           * the product and is NOT permission-filtered, so it is the honest
           * escape hatch: the user can still reach a screen and find out from
           * the API whether they may open it, rather than being told by a blank
           * bar that the product has nothing in it.
           */
          <button type="button" className="lux-botnav-btn" onClick={onMenu}>
            <GridIcon width={20} height={20} />
            <span>All areas</span>
          </button>
        ) : (
          families.map((f) => (
            <button
              key={f.key}
              type="button"
              className={cn(
                "lux-botnav-btn",
                active?.key === f.key && "active",
              )}
              aria-expanded={open === f.key}
              onClick={() => setOpen(f.key)}
            >
              <f.Icon width={20} height={20} />
              <span>{navT(t, f.label)}</span>
            </button>
          ))
        )}
      </nav>

      <FamilySheet
        family={families.find((f) => f.key === open) ?? null}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
