/**
 * Is the user typing right now?
 *
 * The one guard every global keyboard shortcut in this app has to pass before
 * it takes a chord. Alt+← moves the caret on Windows, and Option+R types "®" on
 * a Mac — so a shortcut that fires while somebody is halfway through a client
 * name either navigates away from a half-filled form or silently eats a
 * keystroke. Both were real, both look fine in review, and neither is
 * reproducible unless you happen to be typing when you press it.
 *
 * Lives in `lib/` rather than beside any one shortcut because there is now more
 * than one: the trail's Alt+← / Alt+→ (`app/layout/nav-trail-provider.tsx`) and
 * the rail's Alt+R refresh (`app/layout/nav-refresh.tsx`). A second private copy
 * is a second thing to remember to fix.
 */
export function isEditing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}
