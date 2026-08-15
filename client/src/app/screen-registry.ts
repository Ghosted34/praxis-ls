/**
 * Typed accessor over the canonical UI screen registry (screen-registry.json).
 * The JSON is the single source of truth — the AI ingests it as the app's screen
 * map, and the frontend can use it for navigation/breadcrumbs. Keep the JSON in
 * sync when you add a <Route> (see doc/AI_READINESS.md).
 */
import registry from "./screen-registry.json";

export interface Screen {
  id: string;
  title: string;
  route: string;
  area: string;
  module_key: string | null;
  purpose: string;
  actions: string[];
  public?: boolean;
}

export const SCREENS: Screen[] = registry.screens as Screen[];
export const screenByRoute = (route: string): Screen | undefined =>
  SCREENS.find((s) => s.route === route);
export const screensForModule = (moduleKey: string): Screen[] =>
  SCREENS.filter((s) => s.module_key === moduleKey);

/**
 * Which module gates a route — the join the navigation shell filters on.
 *
 * `GET /permissions/mine` answers in MOD-xx keys because that is what the
 * catalogue and the RBAC engine speak. The shell needs to turn that into "may
 * this user see /fleet/drivers", and this registry is already the file the house
 * rules require a new route to be added to. So the mapping is a lookup here
 * rather than a second table in the layout code that a new screen would have to
 * remember to update as well.
 *
 * `null` means UNGATED, not unknown: /help has no module because nothing on the
 * server gates it. `undefined` means the route was never registered, which the
 * shell treats the same way — hiding a screen because someone forgot a registry
 * entry would be a worse failure than showing one that the API will refuse.
 */
export const moduleForRoute = (route: string): string | null | undefined =>
  screenByRoute(route)?.module_key;
