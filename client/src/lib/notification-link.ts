/**
 * Where a notification row goes when it is clicked.
 *
 * ── WHY THIS IS A CLIENT FILE AND NOT JUST THE COLUMN ──────────────────────
 *
 * `link_url` is stamped when the notification is WRITTEN (migration 13793), so
 * every row that existed before that migration has a null one. Those rows are
 * not disposable — a notification inbox is a log, and "the ones from before the
 * fix are still dead" is the same complaint with a date attached. They all
 * carry `entity_ref`, which is exactly what the shared map turns into a route,
 * so they resolve on read instead.
 *
 * The map is `@praxis/shared`'s rather than a copy, because the server uses it
 * to stamp the column and this uses it to fill the gaps: two copies would drift,
 * and a drifted route does not throw. It matches `path="*"` and redirects to the
 * Control Tower, which looks exactly like the dead click this replaces.
 */
import { entityRoute } from "@praxis/shared";

export type NotificationTarget = {
  url: string;
  /** "record" opens the thing itself; "section" opens the list holding it. */
  precision: "record" | "section";
};

type LinkableNotification = {
  link_url?: string | null;
  entity_ref?: string | null;
};

/**
 * The destination for one notification, or null when it has none.
 *
 * Null is a first-class answer and callers must render it as such — as text,
 * not as a control. A row that looks clickable and does nothing is the defect
 * this module exists to remove, and handing back `/notifications` so that
 * everything "works" would reproduce it: click a notification, arrive at the
 * list of notifications you clicked it from.
 *
 * A stored `link_url` always wins. It is what the producer chose and what the
 * push for this same notification opened, so the phone and the bell agree.
 */
export function notificationLink(
  n: LinkableNotification | null | undefined,
): NotificationTarget | null {
  if (!n) return null;
  const stored = typeof n.link_url === "string" ? n.link_url.trim() : "";
  // Same-origin app paths only. A stored value is ours, but this is the one
  // place a string from the database becomes somewhere the user is sent, and
  // `//evil.example` is a protocol-relative URL that a router will happily
  // treat as external. One character of validation costs nothing here.
  if (stored.startsWith("/") && !stored.startsWith("//")) {
    return { url: stored, precision: "record" };
  }
  return entityRoute.linkFor(n.entity_ref ?? null);
}
