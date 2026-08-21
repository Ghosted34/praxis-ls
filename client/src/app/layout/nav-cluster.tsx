/**
 * Back, forward and refresh — one instrument, at the top of the icon rail.
 *
 * WHY THEY SHARE A PILL. The rail is a column of ten icon cells, and three more
 * loose cells at the top of it read as three more shortcuts. A single bordered
 * pill with hairlines between its segments reads as one control with three
 * ends, which is what a browser toolbar's back/forward/reload has always been —
 * and that triad, in that order, in that corner, is the muscle memory this is
 * borrowing. Splitting refresh into its own pill would keep the pixels and lose
 * the reason they work.
 *
 * WHY IT IS ITS OWN FILE. The pill used to be drawn by `nav-arrows.tsx`, which
 * meant adding refresh to it made the arrows import the refresh cell — and with
 * it a hard dependency on a QueryClient, for a component whose whole subject is
 * the history stack. This file owns the container so that neither of the two
 * controls inside it has to know the other exists.
 *
 * The two halves are genuinely different verbs — the arrows act on WHERE the
 * user is, refresh acts on WHAT they are looking at — and they are documented
 * apart, in `nav-arrows.tsx` and `nav-refresh.tsx` respectively. What they
 * share is metrics, the hold gesture (`use-hold-menu.ts`) and this frame.
 */
import { useTranslation } from "react-i18next";
import { navT } from "@/lib/i18n";
import { NavArrows } from "./nav-arrows";
import { NavRefresh } from "./nav-refresh";

export function NavCluster() {
  const { t } = useTranslation();
  return (
    <div className="rail-nav" role="group" aria-label={navT(t, "Navigation")}>
      <NavArrows />
      <span className="rail-nav-split" aria-hidden />
      <NavRefresh />
    </div>
  );
}
