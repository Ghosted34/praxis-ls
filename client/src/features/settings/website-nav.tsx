/**
 * The website area's own sub-navigation.
 *
 * ── WHY A LINK ROW AND NOT A `<Tabs>` ──────────────────────────────────────
 *
 * `components/ui/tabs.tsx` says it plainly in its own header: tabs are sibling
 * views of ONE subject, and "if each tab is really a different screen with its
 * own URL, use routes". Pages and articles are different screens over different
 * tables with different permissions to come; a Radix tablist here would put
 * two routes behind one tab stop and break the back button for whichever one
 * lost. So these are links that look like a strip, with `aria-current` doing
 * the work `aria-selected` would have done.
 *
 * It exists at all because the Settings ribbon deliberately holds only the
 * handful of editors an administrator opens repeatedly (see `layout/areas.ts`),
 * and the website screens are not among them. Without a strip here, somebody
 * editing the home page had no way to reach the articles except by going back
 * to the settings card grid and hunting for a second card.
 */
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";

const ITEMS = [
  { to: "/settings/website", label: () => tr("Pages"), end: true },
  { to: "/settings/website/articles", label: () => tr("Insights"), end: false },
];

export function WebsiteNav() {
  return (
    /* `ListPage` renders this slot immediately after `PageHeader` with no gap of
       its own, so the strip has to carry its own breathing room — without it the
       tabs sit flush under the description and read as part of it. Margin below
       as well: the rule under the strip belongs to the strip, not to the table
       that follows. */
    <nav
      aria-label={tr("Website sections")}
      className="mb-5 mt-6 border-b border-[var(--border)]"
    >
      <ul className="flex flex-wrap items-center gap-1">
        {ITEMS.map((i) => (
          <li key={i.to}>
            <NavLink
              to={i.to}
              end={i.end}
              className={({ isActive }) =>
                cn(
                  "inline-flex h-9 items-center rounded-t-[calc(var(--radius)-2px)] border-b-2 px-3 text-sm font-medium transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
                  isActive
                    ? "border-[var(--primary)] text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )
              }
            >
              {i.label()}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
