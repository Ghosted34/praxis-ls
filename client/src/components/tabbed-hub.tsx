/**
 * TabbedHub — the shared hub shell. Deep-linkable via `<basePath>` and
 * `<basePath>/:section`; each tab renders its page unchanged, so per-module
 * RBAC/org-workflow are untouched.
 *
 * WHERE THE TABS ARE DRAWN, and why that changed. The strip used to be
 * published on context and rendered by each page under its own header. On a
 * desktop that put THREE navigation rows above the first row of data: the title
 * bar, the area nav, and the hub's own tabs. The ribbon (app/layout/ribbon.tsx)
 * carries the hub's sections in its second row now, so the in-page strip is a
 * third copy of navigation the user has already been given.
 *
 * It survives BELOW `md`, because that is where the ribbon does not exist — a
 * phone gets the bottom nav and a family sheet, and inside an area the strip is
 * still how you move between sections. One conditional class rather than two
 * components, so the two can never disagree about what the sections are.
 *
 * AND IT IS A FALLBACK, NOT AN UNCONDITIONAL REMOVAL. The ribbon renders
 * nothing until the permissions read settles, and nothing at all if that read
 * failed. Hiding the strip on every desktop regardless therefore had a state
 * where a user stood inside a hub with no row B and no tabs — unable to reach
 * another section of the screen they were already looking at, with no error to
 * explain it. So the strip hides only while the ribbon is demonstrably carrying
 * this area's sections; the rest of the time it is there. Not a duplicate when
 * the chrome works, a fallback when it does not.
 *
 * The tab list itself comes from `app/layout/areas.ts`, which is also what the
 * ribbon reads. `areas.test.ts` pins that a hub's tabs and the ribbon's row are
 * the same list — the failure it exists to catch is a tab added to a hub that
 * silently never appears in the chrome.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { TabList, TabsRoot, TabsContent } from "@/components/ui/tabs";
import type { HubTab } from "@/app/layout/areas";
import { buildRibbon } from "@/app/layout/ribbon-model";
import { useShell } from "@/app/layout/shell-context";

export type { HubTab };

const HubTabsContext = React.createContext<React.ReactNode>(null);

/** Renders the current hub's tab bar. Drop it in a page right under its header.
 *  Below `md`, and on desktop whenever the ribbon is not carrying this area's
 *  sections — see the file header. */
export function HubTabs() {
  return <>{React.useContext(HubTabsContext)}</>;
}

/**
 * Is the ribbon currently showing this area's sections?
 *
 * The answer comes from `buildRibbon`, the same function the ribbon itself
 * renders from, so the strip and the chrome cannot disagree about it. Deriving
 * it a second way here — checking `access.modules` against the area's routes —
 * would be a copy of the ribbon's placement rules that nothing keeps in step,
 * and the failure mode of that copy is precisely the one this hook exists to
 * prevent: a user with no tabs anywhere.
 *
 * WHILE THE READ IS IN FLIGHT the answer is "yes". The ribbon owns that window
 * — it is one round trip, and showing the strip through it would mean a visible
 * strip that disappears a moment later on every hub load, which is worse than
 * the wait. Once the read settles, `families` is empty on failure and the strip
 * comes back.
 */
function useRibbonCarries(basePath: string): boolean {
  const { access, ready } = useShell();
  return React.useMemo(() => {
    if (!ready) return true;
    return buildRibbon(access).some((f) =>
      f.areas.some(
        (a) => a.area.basePath === basePath && a.sections.length > 0,
      ),
    );
  }, [access, ready, basePath]);
}

/**
 * `inlineTabs` — render the tab bar in the shell itself (with the eyebrow above it)
 * instead of only publishing it on context. Hubs whose tab pages already call
 * <HubTabs/> under their own <PageHeader/> leave this off (the default); hubs whose
 * pages own their headers and never call <HubTabs/> (e.g. Master data) switch it on
 * so the bar still shows. Lets every hub share one implementation either way.
 */
export function TabbedHub({
  eyebrow,
  basePath,
  tabs,
  inlineTabs = false,
  inPlace = false,
}: {
  eyebrow: string;
  basePath: string;
  tabs: HubTab[];
  inlineTabs?: boolean;
  inPlace?: boolean;
}) {
  const { section } = useParams();
  const navigate = useNavigate();
  // `inPlace` swaps tab content in local state without touching the route, so the
  // hub stays on one page (no URL change / scroll reset). Routed hubs keep their
  // deep-linkable `<basePath>/:section` behaviour (the default).
  const [localKey, setLocalKey] = React.useState(
    () => tabs.find((t) => t.key === section)?.key ?? tabs[0].key,
  );
  const activeKey = inPlace ? localKey : section;
  const active = tabs.find((t) => t.key === activeKey) || tabs[0];
  const Active = active.Component;
  const go = (key: string) =>
    inPlace ? setLocalKey(key) : navigate(`${basePath}/${key}`);

  // `inPlace` hubs swap content without a route change, so the ribbon cannot
  // follow them — it only knows the URL. Keep them in step: a ribbon click
  // changes the route, and this pulls the local key back onto it.
  React.useEffect(() => {
    if (inPlace && section && tabs.some((t) => t.key === section))
      setLocalKey(section);
  }, [inPlace, section, tabs]);

  // Hidden on desktop ONLY while the ribbon is actually carrying this area's
  // sections. Below `md` there is no ribbon, so the class never applies there
  // and the strip is always the navigation.
  const carried = useRibbonCarries(basePath);

  // Was a bare <div> of <button>s: no role="tablist", no role="tab", no
  // aria-selected and no arrow keys (audit F13, "Tabs are not tabs"). A screen
  // reader announced a row of unrelated buttons with no indication of which
  // view was showing, and a keyboard user tabbed through every tab to reach the
  // content.
  //
  // The strip is published on CONTEXT and drawn by each page, so it sits far
  // from its panel in the DOM. Radix needs both inside one Root — hence the Root
  // around the whole hub, with a single Content keyed on the active tab rather
  // than one Content per tab (only the active page is mounted, which is what
  // keeps a hub from fetching every tab's data at once).
  const tabsNode = (
    <div className={cn(carried && "md:hidden")}>
      <TabList
        label={`${eyebrow} sections`}
        tabs={tabs.map((t) => ({ value: t.key, label: t.label }))}
      />
    </div>
  );

  return (
    <TabsRoot value={active.key} onValueChange={go} activationMode="manual">
      <HubTabsContext.Provider value={tabsNode}>
        {inlineTabs && (
          <div className={cn("mb-4", pageShell.wide)}>
            <div className="micro mb-2">{eyebrow}</div>
            {tabsNode}
          </div>
        )}
        <TabsContent
          key={active.key}
          value={active.key}
          className="animate-fade-in focus-visible:outline-none"
        >
          <Active />
        </TabsContent>
      </HubTabsContext.Provider>
    </TabsRoot>
  );
}

/** Breadcrumb "Hub › <area>". Hub links to the Control Tower; when `to` is given
 *  the area is a link back to its own hub (e.g. Finance → /finance). */
export function HubCrumb({ area, to }: { area: string; to?: string }) {
  return (
    <span className="micro">
      <Link to="/" className="transition-colors hover:text-primary-ink">
        Hub
      </Link>{" "}
      ›{" "}
      {to ? (
        <Link to={to} className="transition-colors hover:text-primary-ink">
          {area}
        </Link>
      ) : (
        area
      )}
    </span>
  );
}
