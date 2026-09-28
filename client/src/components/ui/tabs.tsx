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
 * ── WHAT CHANGED ON A PHONE (Phase 6) ──────────────────────────────────────
 *
 * The strip used to be `flex-wrap`, which is fine at 1440px and produced a
 * THREE-ROW wall of tabs on a 390px screen (the master-data hub in the mobile
 * audit: Clients / Suppliers / Corporate entities / Treasury, then Currencies /
 * Expense rates / Financial dictionary / Tax, then Service types). Eleven tabs
 * above the content of a page whose whole job is to show that content.
 *
 * It is now `<ScrollStrip>` — one row, scrolled horizontally, the active tab
 * centred, and a fade on whichever side has more. From `md` up it wraps exactly
 * as before, so a desktop sees no change at all. The visuals moved to
 * `TAB_TRIGGER` in `scroll-strip.tsx`, which `section-tabs.tsx` also uses, so
 * the app has one tab look rather than the two it had (the hub's `gap-x-5` /
 * `px-0.5` strip and the 360s' `gap-1` / `px-3` one).
 *
 * @example
 * <Tabs
 *   value={tab}
 *   onValueChange={setTab}
 *   label="Dossier sections"
 *   tabs={[
 *     { value: "milestones", label: "Milestones", content: <Milestones /> },
 *     { value: "money", label: "Money", count: 4, content: <Money /> },
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
import { ScrollStrip, TAB_TRIGGER, TabCount } from "@/components/ui/scroll-strip";

export type TabItem = {
  value: string;
  label: React.ReactNode;
  content?: React.ReactNode;
  disabled?: boolean;
  /** A count shown inside the tab ("Documents 12"). Omit for a plain label —
   *  a zero is information and a missing count is not, so pass the value. */
  count?: React.ReactNode;
};

/**
 * The value of the enclosing `<TabsRoot>`, for a `<TabList>` that is not told
 * which tab is active.
 *
 * WHY THIS EXISTS. The active tab is styled — underlined, bold, foreground —
 * off `data-strip-active`, and the strip scrolls whichever trigger carries it
 * into view. Radix knows which tab is active but says so in its own
 * `data-state`, which the shared trigger classes deliberately do not read (see
 * `TAB_TRIGGER`). So `TabList` has to put `data-strip-active` on the right
 * trigger itself, and it only could when the caller passed `activeKey`.
 *
 * Every standalone `<TabList>` in the app omitted it — the hub strip, the
 * milestones views, the inbox record drawer, the scaffold screens — so on
 * every one of them NO tab was marked: nothing was highlighted, and on a phone
 * the strip never scrolled to the section you were on. The master-data hub
 * opened on "Financial dictionary" with Clients / Suppliers / Corporate
 * entities / Treasury on screen, none of them lit, and the tab you were on
 * scrolled off the right-hand edge. A caller cannot forget this now: the Root
 * already holds the value, and the list reads it.
 */
const ActiveTabContext = React.createContext<string | undefined>(undefined);

/** The strip on its own, for hubs that render their panel elsewhere (TabbedHub
 *  publishes the bar through context and each page draws its own body). */
export function TabList({
  tabs,
  label,
  className,
  sticky = false,
  activeKey,
}: {
  tabs: TabItem[];
  /** Accessible name for the strip. Not rendered. */
  label: string;
  className?: string;
  /** Pin under the app bar on a phone. Used by the 360 sheets, where the tab
   *  strip is the only way back to another section of a long record. */
  sticky?: boolean;
  /** The tab to mark active and bring into view. Defaults to the enclosing
   *  `<TabsRoot>`'s value, which is right everywhere today; pass `null` to keep
   *  the highlight but stop the strip scrolling to it. */
  activeKey?: string | null;
}) {
  const rootValue = React.useContext(ActiveTabContext);
  const current = activeKey ?? rootValue;
  return (
    <RadixTabs.List asChild aria-label={label}>
      <ScrollStrip
        className={cn("mb-4", className)}
        sticky={sticky}
        activeKey={activeKey === null ? undefined : current}
      >
        {tabs.map((t) => (
          <RadixTabs.Trigger
            key={t.value}
            value={t.value}
            disabled={t.disabled}
            // `ScrollStrip` reads this to centre the tab you are on — including
            // on first paint, so `?tab=Renewals` opens with Renewals visible
            // rather than scrolled off the right-hand edge.
            data-strip-active={t.value === current ? "true" : undefined}
            className={TAB_TRIGGER}
          >
            {t.label}
            <TabCount count={t.count} />
          </RadixTabs.Trigger>
        ))}
      </ScrollStrip>
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
  sticky = false,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  tabs: TabItem[];
  label: string;
  className?: string;
  listClassName?: string;
  /** Pin the strip under the app bar while a panel scrolls. */
  sticky?: boolean;
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
      <TabList
        tabs={tabs}
        label={label}
        className={listClassName}
        sticky={sticky}
        activeKey={value}
      />
      {children}
      {tabs.map((t) =>
        t.content === undefined ? null : (
          <RadixTabs.Content
            key={t.value}
            value={t.value}
            className="focus-visible:outline-none"
          >
            {t.content}
          </RadixTabs.Content>
        ),
      )}
    </RadixTabs.Root>
  );
}

/**
 * Radix's Root, plus the one thing a `<TabList>` placed away from it needs: the
 * active value, on context (see `ActiveTabContext`). For a hub that composes
 * Root/List/Content itself because the panel cannot live next to the strip.
 * Prefer `<Tabs>` where it fits.
 *
 * Uncontrolled use (`defaultValue`) is tracked too, so the strip is marked
 * whichever way the Root is driven.
 */
export const TabsRoot = React.forwardRef<
  React.ElementRef<typeof RadixTabs.Root>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Root>
>(function TabsRoot({ value, defaultValue, onValueChange, ...rest }, ref) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  return (
    <ActiveTabContext.Provider value={value ?? uncontrolled}>
      <RadixTabs.Root
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        onValueChange={(v) => {
          setUncontrolled(v);
          onValueChange?.(v);
        }}
        {...rest}
      />
    </ActiveTabContext.Provider>
  );
});
export const TabsContent = RadixTabs.Content;
