/**
 * TabbedHub — the shared hub shell. The tab bar is provided via context and
 * rendered by each page with <HubTabs/> right under its header, so tabs sit below
 * the title/subtitle (not above the breadcrumb). Deep-linkable via `<basePath>`
 * and `<basePath>/:section`; each tab renders its page unchanged, so per-module
 * RBAC/org-workflow are untouched. Active tab uses the --primary accent.
 */
import * as React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { cn } from "@/lib/cn";

export type HubTab = { key: string; label: string; Component: React.ComponentType };

const HubTabsContext = React.createContext<React.ReactNode>(null);

/** Renders the current hub's tab bar. Drop it in a page right under its header. */
export function HubTabs() {
  return <>{React.useContext(HubTabsContext)}</>;
}

/**
 * `inlineTabs` — render the tab bar in the shell itself (with the eyebrow above it)
 * instead of only publishing it on context. Hubs whose tab pages already call
 * <HubTabs/> under their own <PageHeader/> leave this off (the default); hubs whose
 * pages own their headers and never call <HubTabs/> (e.g. Master data) switch it on
 * so the bar still shows. Lets every hub share one implementation either way.
 */
export function TabbedHub({ eyebrow, basePath, tabs, inlineTabs = false }: { eyebrow: string; basePath: string; tabs: HubTab[]; inlineTabs?: boolean }) {
  const { section } = useParams();
  const navigate = useNavigate();
  const active = tabs.find((t) => t.key === section) || tabs[0];
  const Active = active.Component;

  const tabsNode = (
    <div aria-label={`${eyebrow} sections`} className="mb-4 inline-flex flex-wrap gap-1 rounded-xl border bg-muted p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => navigate(`${basePath}/${t.key}`)}
          className={cn(
            "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors",
            active.key === t.key
              ? "bg-primary font-semibold text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <HubTabsContext.Provider value={tabsNode}>
      {inlineTabs && (
        <div className="mx-auto mb-4 max-w-6xl">
          <div className="micro mb-2">{eyebrow}</div>
          {tabsNode}
        </div>
      )}
      <div key={active.key} className="animate-fade-in">
        <Active />
      </div>
    </HubTabsContext.Provider>
  );
}

/** Breadcrumb "Hub › <area>" where Hub links to the Control Tower (dashboard). */
export function HubCrumb({ area }: { area: string }) {
  return (
    <span className="micro">
      <Link to="/" className="transition-colors hover:text-primary">Hub</Link> › {area}
    </span>
  );
}
