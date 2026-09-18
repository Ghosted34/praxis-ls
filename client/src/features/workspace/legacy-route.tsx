/**
 * My Workspace's legacy query-tab adapter.
 *
 * Older notifications and bookmarks use `/workspace?tab=tasks&task=…` while
 * `TabbedHub` activates `/workspace/:section`. Translate only the known legacy
 * tabs and leave the canonical hub untouched when there is no tab to translate.
 * The redirect uses `replace` so a notification click does not add a dead
 * intermediate entry to the browser history.
 */
import { Navigate, useLocation } from "react-router-dom";
import { WorkspaceHub } from "./hub";

const TAB_TO_SECTION: Record<string, string> = {
  today: "today",
  tasks: "tasks",
  calendar: "calendar",
};

/** Pure for route and notification-link tests. */
export function legacyWorkspaceDestination(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const section = TAB_TO_SECTION[params.get("tab") || ""];
  if (!section) return null;
  params.delete("tab");
  const query = params.toString();
  return `/workspace/${section}${query ? `?${query}` : ""}`;
}

/** `/workspace` itself is Today; only old `tab` links take the redirect path. */
export function WorkspaceEntry() {
  const { search } = useLocation();
  const destination = legacyWorkspaceDestination(search);
  return destination ? <Navigate to={destination} replace /> : <WorkspaceHub />;
}
