/**
 * SectionTabs — the section strip of a 360 dossier, where the state is `?tab=`.
 *
 * WHY THIS IS NOT `<Tabs>`. A Radix tab strip owns its panels: the tab and the
 * content it switches are one control. A 360 does not work that way — the tab
 * is a URL parameter (`useUrlTab`), the panels are rendered by the page with
 * `{tab === "Documents" && …}`, and the strip has to survive a reload, a pasted
 * link and the back button. So the markup is a `<nav>` of links-in-disguise
 * (real `<button>`s, `aria-current="page"`) and the strip is `<ScrollStrip>`.
 * Both flavours share `TAB_TRIGGER`, so they look like one control even though
 * only one of them is a tablist — the alternative (declaring `role="tablist"`
 * over buttons that change the URL) would promise a screen reader a keyboard
 * contract these do not implement.
 *
 * WHY IT EXISTS AT ALL. Six 360s had hand-rolled the same eleven-line strip —
 * `entity-360`, `party-360`, `employee-360`, `location-360`,
 * `service-type-dossier`, `sales-360` — each with its own padding, its own
 * active-state classes and its own answer to "what happens on a phone". The
 * answers disagreed: entity-360 wrapped its TWELVE sections onto four rows,
 * location-360 scrolled but with a visible scrollbar and no fade, and
 * service-type-dossier wrapped too. That is audit F6's mechanism exactly (no
 * shared home, so the same problem gets solved differently in every area), and
 * this is the shared home.
 *
 * @example
 * const [tab, setTab] = useUrlTab(TABS, "Overview");
 * <SectionTabs
 *   label="Entity sections"
 *   value={tab}
 *   onChange={setTab}
 *   sticky
 *   tabs={TABS.map((t) => ({ value: t, label: t, count: counts[t] }))}
 * />
 */
import * as React from "react";
import { ScrollStrip, TAB_TRIGGER, TabCount } from "@/components/ui/scroll-strip";

export type SectionTab<T extends string> = {
  value: T;
  label: string;
  /**
   * What a PHONE calls this section, when the real name is too long to be worth
   * the width.
   *
   * Not cosmetic. A horizontal strip shows roughly two and a half tabs at
   * 390px, so the reader's ability to find their way depends on how many
   * SECTIONS are visible, not on how complete each name is: "Identity &
   * registrations · Documents · Tax & jurisdiction" is one tab of signpost and
   * two of prose. The corporate-entity dossier is the case that forced this —
   * twelve sections, four of them two words, several of those with an ampersand
   * the reader has already read twice.
   *
   * Only ever a shortening of the same idea ("Identity & registrations" →
   * "Identity"), never a different one, and never a mystery noun: the full name
   * stays the accessible name (below), the heading of the section it opens, and
   * the `?tab=` value in the URL. Applied at `md`, so a desktop is untouched.
   */
  shortLabel?: string;
  /** Rows in this section, shown inside the tab ("Documents 12", "3/7"). Omit
   *  where a count means nothing; pass 0 where it means "none yet". */
  count?: React.ReactNode;
  disabled?: boolean;
};

/**
 * The name a tab is announced as, when a breakpoint has swapped its visible
 * text.
 *
 * `aria-label` beats content in the accessible-name computation, so the badge
 * has to be spelled out here or a short-labelled tab stops announcing its
 * count. Only a countable badge can be spelled out; anything richer (a node)
 * falls back to the plain label, because "Documents [object Object]" is worse
 * than "Documents".
 */
function accessibleName(label: string, count: React.ReactNode): string {
  if (typeof count === "string" || typeof count === "number") return `${label} ${count}`;
  return label;
}

export function SectionTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  sticky = false,
  className,
}: {
  tabs: SectionTab<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Accessible name for the `<nav>`. Required — a landmark without a name is
   *  announced as "navigation" and the reader has no idea which one. */
  label: string;
  /** Pin the strip under the app bar. On by default at the 360 call sites: a
   *  dossier is long, and without it switching section from halfway down the
   *  page means scrolling back to the top first. */
  sticky?: boolean;
  className?: string;
}) {
  return (
    <ScrollStrip
      as="nav"
      label={label}
      sticky={sticky}
      activeKey={value}
      wrapperClassName={className}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            disabled={t.disabled}
            /* Both label spans are hidden from the accessibility tree, so the
               name has to be stated here — otherwise the button announces as
               "IdentityIdentity & registrations" in a browser that renders both
               breakpoints' text, or as nothing at all. The FULL label is the
               name at every width: a screen-reader user is not the person the
               short label was shortened for, and the short one is not a name
               anybody should have to learn. */
            aria-label={t.shortLabel ? accessibleName(t.label, t.count) : undefined}
            // A section of one record, not a different page: `aria-current` is
            // the honest attribute and it is what the hand-rolled strips in
            // this codebase already used. `data-strip-active` is the styling
            // hook `<ScrollStrip>` scrolls into view.
            aria-current={active ? "page" : undefined}
            data-strip-active={active ? "true" : undefined}
            className={TAB_TRIGGER}
          >
            {t.shortLabel ? (
              <>
                <span aria-hidden className="md:hidden">
                  {t.shortLabel}
                </span>
                <span aria-hidden className="hidden md:inline">
                  {t.label}
                </span>
              </>
            ) : (
              t.label
            )}
            <TabCount count={t.count} />
          </button>
        );
      })}
    </ScrollStrip>
  );
}
