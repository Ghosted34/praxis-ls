/**
 * A signed-in app with a faked API, for the desktop layout gate.
 *
 * WHY THIS IS MORE THAN "GOTO THE URL". `app-shell` only renders behind auth,
 * and the access token is in memory by design — only the refresh token is
 * persisted. So a browser run against the built `dist/` lands on the LANDING
 * PAGE unless the boot refresh is satisfied. Addendum 7 records exactly what
 * happens when it is not:
 *
 *   "the first run measured the landing page at four widths and reported one
 *    <h1> and no horizontal scroll, all of it true and all of it meaningless.
 *    A harness that renders the wrong screen still produces a confident table."
 *
 * Which is why `openScreen` below ASSERTS it arrived, and every spec asserts a
 * marker unique to the screen it thinks it is measuring.
 *
 * WHY THE API IS FAKED AND NOT RUN. A real API needs Postgres and Redis, which
 * turns a layout check into an integration environment. It would also make the
 * measurements depend on how much seed data a tenant happens to have — and a
 * gate whose numbers move when a fixture row is added is a gate that gets
 * ignored. Everything here is fixed, so a change in a measured number means a
 * change in the layout.
 */
import type { Page, Route } from "@playwright/test";

const USER = {
  user_id: "u-1",
  email: "ops@smartls.test",
  display_name: "Ops Lead",
  full_name: "Ops Lead",
  role: "ADMIN",
  avatar_url: null,
};

/** Enough rows to fill a table past one screen at 2560px. */
function accounts(n: number) {
  const CLASSES = [1, 2, 3, 4, 5, 6, 7];
  return Array.from({ length: n }, (_, i) => ({
    code: String(601000 + i * 100),
    parent_code: "601",
    label_fr: `Compte de charge numéro ${i + 1}`,
    label_en: `Expense account number ${i + 1}`,
    class: CLASSES[i % CLASSES.length],
    normal_balance: i % 2 ? "C" : "D",
    is_postable: i % 3 !== 0,
    requires_analytic: i % 5 === 0,
  }));
}

/**
 * path (after `/api`) → payload. Longest-prefix matched, as the vitest harness
 * does, so `/tenant/chart-of-accounts?limit=50` resolves from the bare key.
 */
/**
 * The navigation access the shell renders from.
 *
 * WITHOUT THIS THE GATE MEASURES THE WRONG SHELL. An unmocked read resolves to
 * `[]`, which the client coerces to "no access" — so the ribbon renders nothing
 * and every width below would be measured against an app with no navigation in
 * it. That is the Addendum 7 failure this file's own header describes, one level
 * down: a harness that renders the wrong screen still produces a confident
 * table.
 *
 * All six families, because a layout gate should measure the WIDEST chrome the
 * product can produce, not the narrowest. `byGroup` is the server's partition of
 * the visible modules — the client never invents it, so the fixture has to
 * carry it in the shape the endpoint returns.
 */
const NAV_ACCESS = (() => {
  const byGroup: Record<string, string[]> = {
    monitor: ["MOD-00A", "MOD-64", "MOD-74"],
    engage: ["MOD-20", "MOD-21", "MOD-23", "MOD-24", "MOD-27", "MOD-28", "MOD-60", "MOD-61", "MOD-62"],
    fulfill: ["MOD-29", "MOD-30", "MOD-31", "MOD-32", "MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-39", "MOD-41", "MOD-42"],
    transact: ["MOD-46", "MOD-47", "MOD-49", "MOD-51", "MOD-52", "MOD-53", "MOD-54", "MOD-56", "MOD-58", "MOD-59"],
    empower: ["MOD-02", "MOD-11", "MOD-12", "MOD-14", "MOD-15", "MOD-17"],
    configure: ["MOD-01", "MOD-03", "MOD-04", "MOD-05", "MOD-07", "MOD-08", "MOD-09", "MOD-10", "MOD-63", "MOD-65", "MOD-66", "MOD-67", "MOD-68", "MOD-70", "MOD-75"],
  };
  return {
    modules: Object.values(byGroup).flat().sort(),
    groups: Object.keys(byGroup),
    byGroup,
    isCeo: false,
    version: "e2efixture01",
  };
})();

const ROUTES: Record<string, unknown> = {
  "/tenant/auth/refresh": { access_token: "at", refresh_token: "rt", user: USER },
  "/tenant/auth/me": USER,
  "/branding": { name: "Smart Logistics", theme: "light" },
  "/tenant/chart-of-accounts": accounts(60),
  "/tenant/notifications/unread-count": { count: 0 },
  "/tenant/comms/unread-count": { count: 0 },
  "/tenant/ai/status": { enabled: false },
  "/tenant/permissions/mine": NAV_ACCESS,
  /*
   * Pinned open (the default), and the rail's one-time hint already spent.
   * `railHintSeen: false` would leave a 240ms shake running while the first
   * measurements are taken, which is a gate whose numbers depend on when the
   * screenshot happened to land.
   */
  "/tenant/me/preferences/shell": { ribbonPinned: true, railPins: null, railHintSeen: true },
};

function payloadFor(pathname: string): unknown {
  let best: string | null = null;
  for (const key of Object.keys(ROUTES)) {
    if ((pathname === key || pathname.startsWith(key)) && (best === null || key.length > best.length)) best = key;
  }
  // An unmocked lookup resolves to an empty list rather than a 404: a screen
  // that renders its empty state is a measurable layout; a screen that renders
  // an error banner is a measurement of the harness.
  return best ? ROUTES[best] : [];
}

export async function fakeApi(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // X-Total-Count is what the paged hooks read; without it a paged screen
      // reports "0 of 0" under a full table.
      headers: { "X-Total-Count": "60", "Access-Control-Expose-Headers": "X-Total-Count" },
      body: JSON.stringify(payloadFor(pathname)),
    });
  });
}

/**
 * Seed the persisted refresh token so the app boots signed in.
 *
 * Theme and density are pinned too. Both are persisted preferences, and a gate
 * that measures row height must not depend on what some earlier spec chose —
 * `density` is a parameter rather than a constant precisely so the density spec
 * can set it here, in ONE init script, instead of adding a second one that races
 * this one. (Init scripts run in the order they were added, so a per-test script
 * added before `openScreen` is silently overwritten by this. Found the obvious
 * way: all three densities measured the same.)
 */
export async function seedSession(page: Page, density: Density = "default") {
  await page.addInitScript((d) => {
    localStorage.setItem("praxis.refresh", "seed-refresh-token");
    localStorage.setItem("praxis.refresh.persist", "1");
    localStorage.setItem("praxis.env", "live");
    localStorage.setItem("praxis.theme", "light");
    localStorage.setItem("praxis.density", d);
  }, density);
}

export type Density = "compact" | "default" | "comfortable";

/**
 * Navigate, and prove we arrived. `marker` is text that exists ONLY on the
 * screen under test — see the Addendum 7 note at the top of this file.
 */
export async function openScreen(page: Page, path: string, marker: RegExp, density: Density = "default") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await seedSession(page, density);
  await fakeApi(page);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: marker }).waitFor({ timeout: 15_000 });
  return { errors };
}

/** The width of the routed screen's content column, in CSS pixels. */
export async function contentWidth(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector("main section, main > div > section, main [class*='max-w-']");
    return el ? Math.round(el.getBoundingClientRect().width) : -1;
  });
}

export async function hasHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

/** Desktop widths the audit measures at. 2560 is the case F2 opens with. */
export const DESKTOP_WIDTHS = [1280, 1440, 1920, 2560] as const;

/**
 * The icon rail's width — chrome the content column does not get.
 *
 * Stated here rather than measured from the page, because the point of the
 * column assertions is to catch the column changing width for a reason nobody
 * intended. Reading the rail's real width and subtracting it would make that
 * assertion true by construction: widen the rail by 40px and the test would
 * still pass while every table lost 40px. `ribbonHeight`/the rail test below
 * pin the constant against what actually renders, so the two together say
 * "the rail is this wide AND the column accounts for exactly that".
 *
 * Mirrors `.rail { width: 52px }` in index.css (46px at compact density).
 */
export const RAIL_PX = 52;

/** The rail's rendered width, or -1 when it is not there (below `md`). */
export async function railWidth(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".rail");
    return el ? Math.round(el.getBoundingClientRect().width) : -1;
  });
}

/** The ribbon's rendered height, or -1 when it is not there. */
export async function ribbonHeight(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".ribbon");
    return el ? Math.round(el.getBoundingClientRect().height) : -1;
  });
}
