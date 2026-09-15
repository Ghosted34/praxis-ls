import { usePublishedServices } from "@/lib/use-services";

/**
 * Does this tenant have enough published to be worth a services panel?
 *
 * ── WHY THIS IS ITS OWN MODULE AND NOT A LINE IN EITHER OF THE TWO ────────
 *
 * It started life exported from `nav-services-panel.tsx`, which is the obvious
 * home for it and cost 3.5 kB gzip on the first-paint bundle — because the
 * header imported the hook, the hook lived beside the panel, and so the panel
 * (and through it the whole icon set, the mode table and the identity helpers)
 * was pulled into the entry chunk on every page whether or not a single tenant
 * ever opened it. `check:bundle` failed, which is exactly what it is for.
 *
 * The header must answer "is there a panel" SYNCHRONOUSLY — a chevron that
 * appears a beat after the nav is a nav that moves under the pointer. It must
 * not pay for the panel to answer it. One module that imports nothing but the
 * service cache is what separates the two, and the panel is `React.lazy` behind
 * it.
 *
 * `usePublishedServices` is a module-scoped promise that the site footer
 * already triggers on every page, so this adds no request and no bytes worth
 * counting.
 */
export function useServicesPanelReady(): boolean {
  const { groups, services, loading, disabled, failed } = usePublishedServices();
  if (loading || disabled || failed) return false;
  // One pillar holding one service is a link, not a menu. The panel earns its
  // place at two. A tenant who has published nothing gets no chevron at all —
  // the same rule as the announcements band, and for the same reason: a
  // disclosure that opens onto an empty grid is worse than no disclosure, and
  // it is the tenant's own homepage that would be showing it.
  return groups.length > 0 && services.length > 1;
}
