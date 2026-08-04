/**
 * Tabs — switch between sibling views of one screen.
 *
 * WHY RADIX (audit F13: "Tabs are not tabs"). Three independent tab bars
 * existed and none of them was a tab bar:
 *
 *   - `components/tabbed-hub.tsx:41-57` — a <div> of <button>s with no
 *     role="tablist", no role="tab", no aria-selected and no arrow keys.
 *   - `features/scaffold/screen-scaffold.tsx:62-76` — a third visual variant of
 *     the same non-semantics.
 *   - Plus `.chip` filter rows used for the same job on Finance (F14: "three
 *     interaction patterns for one job").
 *
 * A screen reader announced them as a row of unrelated buttons with no
 * indication of which view was showing. A keyboard user tabbed through every
 * tab to reach the content. The WAI-ARIA Authoring Practices tab pattern —
 * one tab stop for the strip, Left/Right (or Up/Down) between tabs, Home/End
 * to the ends, and the panel associated with its tab — is exactly what Radix
 * implements, and exactly what all three copies lacked.
 *
 * `activationMode="manual"` is deliberate. With automatic activation, arrowing
 * across the strip MOUNTS each panel in turn — and in this app a panel mount is
 * a data fetch, so a user arrowing from the first tab to the fourth would fire
 * three throwaway requests. Manual means arrows move focus and Enter/Space
 * activates.
 *
 * @example
 * <Tabs
 *   value={tab}
 *   onValueChange={setTab}
 *   label="Dossier sections"
 *   tabs={[
 *     { value: "milestones", label: "Milestones", content: <Milestones /> },
 *     { value: "money", label: "Money", content: <Money /> },
 *   ]}
 * />
 *
 * BEST PRACTICE. Tabs are for sibling views of ONE subject — a dossier's
 * milestones and its money. They are not navigation: if each "tab" is really a
 * different screen with its own URL, use routes (that is what `TabbedHub` does,
 * and why it deep-links). Keep labels to one or two words; a tab strip that
 * wraps to two lines has stopped being a strip.
 */
import * as React from "react";
import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

export type TabItem = {
  value: string;
  label: React.ReactNode;
  content?: React.ReactNode;
  disabled?: boolean;
};

/** The strip on its own, for hubs that render their panel elsewhere (TabbedHub
 *  publishes the bar through context and each page draws its own body). */
export function TabList({
  tabs,
  label,
  className,
}: {
  tabs: TabItem[];
  /** Accessible name for the strip. Not rendered. */
  label: string;
  className?: string;
}) {
  return (
    <RadixTabs.List aria-label={label} className={cn("mb-4 flex flex-wrap gap-x-5 border-b", className)}>
      {tabs.map((t) => (
        <RadixTabs.Trigger
          key={t.value}
          value={t.value}
          disabled={t.disabled}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 border-transparent px-0.5 pb-2.5 text-sm text-muted-foreground transition-colors",
            "hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
            "data-[state=active]:border-primary data-[state=active]:font-semibold data-[state=active]:text-foreground",
          )}
        >
          {t.label}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  );
}

export function Tabs({
  value,
  onValueChange,
  tabs,
  label,
  className,
  listClassName,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  tabs: TabItem[];
  label: string;
  className?: string;
  listClassName?: string;
  /** Rendered between the strip and the panels — e.g. a toolbar. */
  children?: React.ReactNode;
}) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={onValueChange}
      // See the header: automatic activation would fetch every panel on the way
      // past it.
      activationMode="manual"
      className={className}
    >
      <TabList tabs={tabs} label={label} className={listClassName} />
      {children}
      {tabs.map((t) =>
        t.content === undefined ? null : (
          <RadixTabs.Content key={t.value} value={t.value} className="focus-visible:outline-none">
            {t.content}
          </RadixTabs.Content>
        ),
      )}
    </RadixTabs.Root>
  );
}

/** Re-exported so a hub can compose Root/List/Content itself when the panel
 *  cannot live next to the strip. Prefer `<Tabs>` where it fits. */
export const TabsRoot = RadixTabs.Root;
export const TabsContent = RadixTabs.Content;
