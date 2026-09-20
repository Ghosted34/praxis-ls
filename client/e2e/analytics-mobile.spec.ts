import { expect, test } from "@playwright/test";
import { hasHorizontalScroll, openScreen } from "./fixtures";

/**
 * The regression captured on 20 September 2026: the analytics pager made each
 * card an auto-sized flex item inside an 88vw horizontal scroller. Recharts'
 * intrinsic SVG width then won, so Overdue aging showed its first bar and only
 * part of its second. This browser gate checks geometry — something jsdom
 * cannot — and also proves that a real Recharts bar opens the blocked notes.
 */
test("mobile analytics cards fit the viewport and blocked bars reveal full notes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const { errors } = await openScreen(
    page,
    "/workspace/analytics",
    /Analytics/i,
  );

  const pager = page.getByRole("region", { name: "Analytics charts" });
  const active = page.getByTestId("active-analytics-card");
  await expect(pager).toContainText("Chart 1 of 7");
  await expect(
    active.getByRole("heading", { name: "Throughput" }),
  ).toBeVisible();
  await expect(page.getByText(/Swipe to see more/i)).toHaveCount(0);

  // The card and its chart occupy the available column — neither creates a
  // second horizontal plane under the app shell's clipped main container.
  expect(await hasHorizontalScroll(page)).toBe(false);
  const firstGeometry = await active.evaluate((element) => {
    const card = element.getBoundingClientRect();
    return {
      left: card.left,
      right: card.right,
      viewport: document.documentElement.clientWidth,
      containsOverflow: element.scrollWidth > element.clientWidth + 1,
    };
  });
  expect(firstGeometry.left).toBeGreaterThanOrEqual(0);
  expect(firstGeometry.right).toBeLessThanOrEqual(firstGeometry.viewport + 1);
  expect(firstGeometry.containsOverflow).toBe(false);

  // The reported problem card: all five age bands must be painted inside the
  // one visible card, with no sideways gesture needed to reach the last one.
  await page.getByRole("button", { name: "Show chart 2 of 7" }).click();
  await expect(
    active.getByRole("heading", { name: "Overdue aging" }),
  ).toBeVisible();
  const ageChart = active.getByRole("img", {
    name: /overdue tasks grouped into five age bands/i,
  });
  await expect(ageChart).toBeVisible();
  await expect(
    ageChart.locator(".recharts-xAxis .recharts-cartesian-axis-tick"),
  ).toHaveCount(5);

  const chartGeometry = await ageChart.evaluate((element) => {
    const chart = element.getBoundingClientRect();
    const card = element
      .closest('[data-testid="active-analytics-card"]')!
      .getBoundingClientRect();
    return {
      chartLeft: chart.left,
      chartRight: chart.right,
      cardLeft: card.left,
      cardRight: card.right,
    };
  });
  expect(chartGeometry.chartLeft).toBeGreaterThanOrEqual(
    chartGeometry.cardLeft - 1,
  );
  expect(chartGeometry.chartRight).toBeLessThanOrEqual(
    chartGeometry.cardRight + 1,
  );
  expect(await hasHorizontalScroll(page)).toBe(false);

  // On a phone the chart help is a bottom sheet, with actionable copy rather
  // than a title repeated in a tooltip.
  await page.getByRole("button", { name: "About Overdue aging" }).click();
  const help = page.getByRole("dialog", { name: "About Overdue aging" });
  await expect(help).toBeVisible();
  await expect(help.getByText("What it shows")).toBeVisible();
  await expect(help.getByText("Why it matters")).toBeVisible();
  await expect(help.getByText("How to use it")).toBeVisible();
  await help.getByRole("button", { name: "Close" }).click();

  // Chart 7 is not a decorative summary: clicking its actual SVG bar selects
  // the assignee and reveals the untruncated note and operational context.
  await page.getByRole("button", { name: "Show chart 7 of 7" }).click();
  await expect(
    active.getByRole("heading", { name: "Blocked work" }),
  ).toBeVisible();
  const blockedBar = active.locator(".recharts-bar-rectangle").first();
  await expect(blockedBar).toBeVisible();
  await blockedBar.click();

  const details = active.getByRole("region", {
    name: "Blockage details for Ops Lead",
  });
  await expect(details).toBeVisible();
  await expect(
    details.getByText(/original certificate of origin from the supplier/i),
  ).toBeVisible();
  await expect(details.getByText(/Blocked since/i)).toBeVisible();
  await expect(details.getByText(/Expected release/i)).toBeVisible();
  expect(await hasHorizontalScroll(page)).toBe(false);
  expect(errors).toEqual([]);
});
