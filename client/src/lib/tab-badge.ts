/**
 * The unread count in the browser tab title.
 *
 * Between the in-app bell (needs the tab focused) and a push notification
 * (needs permission, a subscription, and on iOS an installed PWA) there is a
 * large, ordinary middle: the tab is open, behind something else, and the
 * person glances at their tab strip. Nothing addressed that.
 *
 * Title only, not the favicon. Repainting a favicon means a canvas, a data URI
 * and a `<link>` swap per change — and this app's favicon is TENANT branding,
 * rendered per tenant by the API, so drawing a badge over it would overwrite
 * the one piece of chrome white-labelling is most visible in. The title is
 * already ours to write.
 */

/** Remembered so the count can be swapped without accumulating prefixes. */
let base: string | null = null;

export function applyTabBadge(count: number): void {
  if (typeof document === "undefined") return;
  const current = document.title || "Praxis LS";
  // Capture the un-badged title once. Reading it on every call would re-capture
  // "(3) Praxis LS" as the base and compound to "(5) (3) Praxis LS".
  if (base === null) base = current.replace(/^\(\d+\+?\)\s*/, "");
  const n = Number.isFinite(count) && count > 0 ? count : 0;
  const next = n > 0 ? `(${n > 99 ? "99+" : n}) ${base}` : base;
  if (document.title !== next) document.title = next;
}

/** Let a route that sets its own title re-establish the base. */
export function resetTabBadgeBase(): void {
  base = null;
}
