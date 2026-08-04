/**
 * RowActions — the right-aligned action cell in a clickable table row.
 *
 * WHY IT EXISTS (audit F6, F13). Fourteen screens had independently written the
 * same six lines, because a row with `onRowClick` needs its buttons to NOT
 * trigger the row:
 *
 *     <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
 *
 * Two of the fourteen had even been given names — `Actions` in
 * `security/pages.tsx:96` and `Acts` in `governance/pages.tsx:31` — locally, in
 * feature folders, invisible to each other. That is F5's mechanism exactly: no
 * shared home, so the same solution gets rebuilt with a different name in every
 * area, and each copy carries its own accessibility posture.
 *
 * It also concentrated an a11y suppression in fourteen places. `onClick` here is
 * not an interaction being ADDED to a div — it is an interaction being STOPPED,
 * the opposite of what `no-static-element-interactions` is about. The rule
 * cannot make that distinction, so the choice is one documented exception in a
 * shared component or fourteen scattered ones. This is the one.
 *
 * The row stays reachable by keyboard regardless: `DataList` renders column 0 as
 * a real `<button>` (`RowActivator`), so the row's own click handler is a
 * pointer convenience layered over a real control — and these buttons are
 * ordinary buttons in the tab order either way.
 *
 * @example
 * { key: "_a", label: "", render: (r) => (
 *     <RowActions>
 *       <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
 *       <Button size="sm" variant="outline" onClick={() => archive(r)}>Archive</Button>
 *     </RowActions>
 *   ) }
 */
import * as React from "react";
import { cn } from "@/lib/cn";

export function RowActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div className={cn("flex flex-wrap justify-end gap-2", className)} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
