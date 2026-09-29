/**
 * A costing on a phone: open it, Print / preview, Back — in a real browser.
 *
 * ── THE REPORTS THIS GATE EXISTS FOR ───────────────────────────────────────
 *
 *   1. "Under costing, the screen keeps flashing." Blank, the list, the sheet,
 *      the full worksheet page, blank again, several times a second, forever.
 *      Back from the document page remounts the list with `?focus=` already in
 *      the address. `useIsDesktop` answered its `true` fallback on that first
 *      render, the list exchanged `?focus=` for the route, the route handed the
 *      phone straight back to `?focus=`, and round it went. Replayed here on
 *      the hook before the fix it is ~180 navigations in four seconds; the
 *      jsdom half is `src/lib/record-360.test.tsx`.
 *
 *   2. "The draft preview was empty." The document page renders the SAVED
 *      costing, and Print / preview left a worksheet with unsaved lines
 *      without a word — so the preview had none of them. It now saves first.
 *
 * WHY COUNT NAVIGATIONS rather than look at the screen: the loop's frames are
 * all legitimate screens — the list, the sheet, the page — so any single
 * screenshot of it passes. What is never legitimate is the address changing
 * when nobody touched anything. The init script records every history write
 * and every Back, and Back from the document page must be exactly ONE of them.
 */
import { test, expect, devices, type Page } from "@playwright/test";
import { seedSession, fakeApi } from "./fixtures";

const ID = "c-1";

const ROW = {
  costing_id: ID,
  doc_number: null,
  dossier_ref: "SBX-2026-0002",
  client_name: "Dangote Cement Cameroon",
  service_name_en: "Sea Freight Import",
  created_at: "2026-09-21T09:00:00Z",
  status: "DRAFT",
  currency: "XAF",
  total_ttc: 0,
};

/** A draft with no saved lines — the sheet from the report. */
const SHEET = {
  ...ROW,
  dossier_id: "d-1",
  exchange_rate_to_xaf: 1,
  remarks: null,
  validator_id: null,
  lines: [],
  totals: { total_ht: 0, vat_total: 0, total_ttc: 0 },
  file: {
    dossier_id: "d-1",
    ref: "SBX-2026-0002",
    client_name: "Dangote Cement Cameroon",
  },
  containers: [],
  shipment_details: null,
  amendment: null,
};

const PREVIEW = {
  html: "<p></p>",
  sample: false,
  data: {
    number: ID,
    date: "2026-09-21",
    status: "DRAFT",
    party: { name: "Dangote Cement Cameroon", lines: [] },
    lines: [],
    totals: { total_ttc: 0 },
    currency: "XAF",
  },
  language: "en",
  title: { en: "Costing sheet" },
  entity: { legal_name: "JBS Praxis SA" },
  report: false,
};

/** Registered AFTER `fakeApi`: Playwright runs the last-registered route first. */
async function openCosting(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __nav: string[] };
    w.__nav = [];
    const rec = (kind: string) =>
      w.__nav.push(`${kind} ${location.pathname}${location.search}`);
    for (const k of ["pushState", "replaceState"] as const) {
      const orig = history[k].bind(history);
      history[k] = ((...args: Parameters<History["pushState"]>) => {
        orig(...args);
        rec(k === "pushState" ? "push" : "replace");
      }) as History["pushState"];
    }
    addEventListener("popstate", () => rec("pop"));
  });
  await seedSession(page);
  await fakeApi(page);
  await page.route("**/api/tenant/costings**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/kpis")
      ? { total: 1, to_validate: 0, to_approve: 0, total_ttc_xaf: 0 }
      : path.endsWith("/validators")
        ? []
        : path.endsWith(`/costings/${ID}`)
          ? SHEET
          : [ROW];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.route("**/api/tenant/document-templates/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PREVIEW),
    }),
  );
  await page.goto("/costing/costing", { waitUntil: "domcontentloaded" });
  // Below `sm` the register is cards; the table copy is in the DOM, hidden.
  await page.locator("text=SBX-2026-0002 >> visible=true").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

const navLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __nav: string[] }).__nav.slice());

/** Back from the document page, then long enough for any bounce to show. */
async function backAndSettle(page: Page, how: "gesture" | "button") {
  const before = (await navLog(page)).length;
  if (how === "gesture") await page.goBack();
  else await page.getByRole("button", { name: "← Back" }).click();
  // The loop runs at ~45 navigations a second; 1.5s of quiet is conclusive.
  await page.waitForTimeout(1500);
  return (await navLog(page)).slice(before);
}

/** A phone — size, touch and user agent — without `defaultBrowserType`, which
 *  Playwright refuses inside a describe group (it would force a new worker). */
const { defaultBrowserType: _browser, ...PHONE } = devices["Pixel 7"];

test.describe("a costing on a phone", () => {
  test.use(PHONE);

  for (const how of ["gesture", "button"] as const) {
    test(`Back (${how}) from Print / preview lands on the sheet, once`, async ({
      page,
    }) => {
      await openCosting(page);
      await page.getByRole("button", { name: "Print / preview" }).click();
      await expect(page.getByRole("button", { name: "← Back" })).toBeVisible();

      expect(await backAndSettle(page, how)).toEqual([
        `pop /costing/costing?focus=${ID}`,
      ]);
      await expect(page.getByRole("dialog")).toBeVisible();
    });
  }

  test("unsaved edits are saved before the preview opens", async ({ page }) => {
    await openCosting(page);
    await page.getByLabel("Remarks").fill("Priced the ocean leg.");
    await page.getByRole("button", { name: "Print / preview" }).click();

    await expect(
      page.getByText("Save your changes before previewing?"),
    ).toBeVisible();
    const saved = page.waitForRequest(
      (r) => r.method() === "PATCH" && r.url().endsWith(`/costings/${ID}`),
    );
    await page.getByRole("button", { name: "Save and preview" }).click();
    expect((await saved).postDataJSON()).toMatchObject({
      remarks: "Priced the ocean leg.",
    });
    await expect(page.getByRole("button", { name: "← Back" })).toBeVisible();

    expect(await backAndSettle(page, "gesture")).toEqual([
      `pop /costing/costing?focus=${ID}`,
    ]);
  });
});
