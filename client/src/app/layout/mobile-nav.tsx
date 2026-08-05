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
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/dialog";
import { areaRoute, sectionRoute } from "./areas";
import { buildRibbon, iconForArea, locate, type RibbonFamily } from "./ribbon-model";
import { useShell } from "./shell-context";
import { SearchIcon } from "./nav-icons";

/** Everything inside one family, as a phone reads it: area, then its screens. */
function FamilySheet({ family, onClose }: { family: RibbonFamily | null; onClose: () => void }) {
  return (
    <Dialog open={!!family} onClose={onClose} title={family?.label ?? ""} size="md">
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
                  <span>{area.label}</span>
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
                        {s.label}
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
 * The bottom bar. One thumb target per family, plus search.
 *
 * Seven targets on a 360px screen is 51px each, which is above the 44px
 * platform minimum but not by much — so the label is 10px and the padding is
 * tight, and that is the trade being made rather than an oversight. Most users
 * have fewer than six families; a CEO with all six is the dense case.
 */
export function BottomNav({ onSearch }: { onSearch: () => void }) {
  const { access } = useShell();
  const { pathname } = useLocation();
  const families = React.useMemo(() => buildRibbon(access), [access]);
  const [open, setOpen] = React.useState<string | null>(null);
  const active = locate(families, pathname).family;

  React.useEffect(() => setOpen(null), [pathname]);

  return (
    <>
      <nav className="lux-botnav flex md:hidden" aria-label="Primary">
        {families.map((f) => (
          <button
            key={f.key}
            type="button"
            className={cn("lux-botnav-btn", active?.key === f.key && "active")}
            aria-expanded={open === f.key}
            onClick={() => setOpen(f.key)}
          >
            <f.Icon width={20} height={20} />
            <span>{f.label}</span>
          </button>
        ))}
        <button type="button" className="lux-botnav-btn" onClick={onSearch}>
          <SearchIcon width={20} height={20} />
          <span>Search</span>
        </button>
      </nav>

      <FamilySheet family={families.find((f) => f.key === open) ?? null} onClose={() => setOpen(null)} />
    </>
  );
}
