/**
 * The layout gate — the four-width run Phases 3 and 4 took by hand, plus the
 * phone.
 *
 * Every assertion here corresponds to a finding the audit opens with:
 *
 *   F2  "renders identically at 1280px, 1920px and 2560px"  → the column grows
 *   F3  "every page self-caps at 1152px"                    → and by how much
 *   F9  "~46px rows against a 28-32px standard"             → row height
 *   F13 "~116 of 117 pages have no <h1>"                    → exactly one
 *   F17 "500ms entrance on every card and table mount"      → no page errors,
 *                                                             content painted
 *
 * It was called `desktop-layout` for one commit, and the name was the problem.
 * Phase 5's work was desktop-shaped, the gate was written at desktop widths, and
 * a desktop density number (`--row-control-h: 20px`) leaked onto every phone tap
 * target with nothing to catch it. A gate that only measures the surface you
 * were thinking about ratifies your blind spot. The phone block below is the
 * correction, and it is not optional going forward.
 */
import { test, expect } from "@playwright/test";
import { openScreen, contentWidth, hasHorizontalScroll, DESKTOP_WIDTHS, type Density } from "./fixtures";

/** Density → row height. Mirrors DENSITY_ROW_PX in src/lib/density.ts. */
const ROW_PX = { compact: 28, default: 32, comfortable: 40 } as const;

test.describe("desktop layout", () => {
  for (const width of DESKTOP_WIDTHS) {
    test(`chart of accounts at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const { errors } = await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);

      // Arrived on the right screen — not the landing page (Addendum 7).
      await expect(page.getByRole("table")).toBeVisible();

      const column = await contentWidth(page);
      const shellPadding = width >= 1600 ? 64 : 48; // main is p-6, 2xl:px-8
      const cap = 2160; // maxWidth.wide

      /*
       * THE F2/F3 ASSERTION. The column must USE the viewport up to the cap.
       * Before Phase 1 this number was 1152 at every width; after Phase 1 it was
       * 1664 from 1920 upward, which is why 1920 and 2560 rendered identically
       * and why Addenda 6 and 7 both left the 2560 case open.
       */
      expect(column).toBeGreaterThan(0);
      expect(column).toBeLessThanOrEqual(cap);
      expect(column).toBeCloseTo(Math.min(cap, width - shellPadding), -1);

      // A content column wider than its viewport is the failure this hides.
      expect(await hasHorizontalScroll(page)).toBe(false);

      // F13: exactly one page heading, never zero and never two.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

      expect(errors, `page errors at ${width}px`).toEqual([]);
    });
  }

  test("the content column actually grows between 1920 and 2560", async ({ page }) => {
    /*
     * The single assertion the audit's opening paragraph asks for, and the one
     * three phases deferred. Written as a comparison rather than a constant so
     * it fails if `maxWidth.wide` is ever pulled back below the 1920 case —
     * which is exactly how 1664 came to sit there for three phases without
     * anyone noticing 2560 was unaddressed.
     */
    await page.setViewportSize({ width: 1920, height: 900 });
    await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);
    const at1920 = await contentWidth(page);

    await page.setViewportSize({ width: 2560, height: 900 });
    await page.waitForFunction(() => true);
    const at2560 = await contentWidth(page);

    expect(at2560).toBeGreaterThan(at1920);
  });
});

test.describe("row density", () => {
  /**
   * F17 measured ~46px rows against a 28-32px category standard. These are the
   * assertions that keep them where Phase 5 put them, and that keep the
   * PREFERENCE working — a refactor that drops `--row-py` leaves `py-row`
   * resolving to nothing and every density collapsing to one height, which
   * compiles, passes every unit test, and is visible only in a browser.
   *
   * They also close the hole that let the density work look finished for two
   * phases: Phase 1 changed the padding, jsdom has no layout engine so no unit
   * test could see the result, and the Phase 3/4 browser runs measured the
   * content column and the h1 count. Nobody measured a row until now, and it
   * was 49px.
   */
  for (const [density, height] of Object.entries(ROW_PX)) {
    test(`${density} rows measure ${height}px`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 900 });
      await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i, density as Density);

      const measured = await page.evaluate(() => {
        const row = document.querySelector("tbody tr") as HTMLElement;
        const td = row.querySelector("td") as HTMLElement;
        return {
          rowPy: getComputedStyle(document.documentElement).getPropertyValue("--row-py").trim(),
          padTop: getComputedStyle(td).paddingTop,
          rowH: row.getBoundingClientRect().height,
          /*
           * The tallest thing in the row, as the MARGIN box — which is what
           * actually contributes to the row's height. Border box would be wrong
           * and would fail on a control that is deliberately larger than its
           * footprint: `RowActivator` is a 24px button with `-my-0.5`, so it
           * occupies 20px. Reading the wrong box is how this assertion first
           * failed against a row that was the correct height.
           */
          tallest: Math.max(
            ...Array.from(row.querySelectorAll("td > *")).map((el) => {
              const cs = getComputedStyle(el);
              return el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
            }),
          ),
        };
      });

      // The token resolved — exact, no tolerance. This is the one that fails if
      // `--row-py` is renamed or the attribute stops being written.
      expect(measured.padTop).toBe(`${(height - 20) / 2}px`);

      /*
       * The rendered row, within 2px: a `<tr>` carries a 1px hairline bottom
       * border on top of the cell box, and a 13px/20px line box measures 20.5px
       * after font metrics. Stated rather than absorbed into ROW_PX, so those
       * stay the numbers the design is written in.
       */
      expect(Math.abs(measured.rowH - height), `${density} row was ${measured.rowH}px`).toBeLessThanOrEqual(2);

      /*
       * NOTHING IN THE ROW EXCEEDS THE CONTROL HEIGHT. This is the assertion
       * that would have caught the original defect. `<Button size="sm">` is 36px
       * and 67 screens put one in the actions column, so the row was 48px
       * whatever the padding said — the padding was never what set the height.
       */
      expect(measured.tallest, "a cell child is taller than --row-control-h").toBeLessThanOrEqual(21);
    });
  }
});

test.describe("wide-table affordances", () => {
  test("the column heading stays put while the body scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);

    const box = page.locator("table").locator("xpath=..");
    const before = await page.locator("thead th").first().boundingBox();
    await box.evaluate((el) => el.scrollBy(0, 400));
    const after = await page.locator("thead th").first().boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    // Sticky: the heading did not travel with the rows.
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
  });

  test("the identity column stays put while the table scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 }); // narrow enough to force overflow
    await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);

    const box = page.locator("table").locator("xpath=..");
    const cell = page.locator("tbody tr td").first();
    const before = await cell.boundingBox();
    await box.evaluate((el) => el.scrollBy(600, 0));
    const after = await cell.boundingBox();

    expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThanOrEqual(1);
  });
});

/**
 * PHONE. The gate had none of these, and that is exactly how the desktop
 * density work leaked onto touch.
 *
 * `--row-control-h` was set on `:root` and applied by `<RowActions>`, which
 * DataList renders in BOTH branches — so the 20px meant for a dense desktop row
 * became the tap target on every phone. Under WCAG 2.2 §2.5.8 that fails AA
 * (24×24 CSS px); against iOS HIG and Material it is under half. Nothing caught
 * it because every assertion in this file was written at a desktop width.
 *
 * A gate that only measures the surface you were thinking about is a gate that
 * ratifies your blind spot.
 */
test.describe("phone", () => {
  const PHONE = { width: 390, height: 844 }; // iPhone 14

  test("renders the card fallback, not a squeezed table", async ({ page }) => {
    await page.setViewportSize(PHONE);
    const { errors } = await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);

    // The table branch is `hidden sm:block`; below 640px the cards are the UI.
    await expect(page.getByRole("table")).toBeHidden();
    expect(await hasHorizontalScroll(page)).toBe(false);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("EVERY tap target clears the 24px minimum", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);

    const small = await page.evaluate(() => {
      // Measure the hit area, not the ink: a control may legitimately be drawn
      // smaller than it is touchable — that is what `.tap-24` / `.tap-44` do,
      // and reading the border box would report a false failure on exactly the
      // fix this asserts.
      const hit = (el: Element) => {
        const own = el.getBoundingClientRect();
        const before = getComputedStyle(el, "::before");
        if (before.content !== "none" && before.position === "absolute") {
          const inset = Math.abs(parseFloat(before.insetBlockStart || "0")) || 0;
          return { w: own.width + inset * 2, h: own.height + inset * 2 };
        }
        return { w: own.width, h: own.height };
      };
      const cards = document.querySelector(".animate-fade-up.sm\\:hidden");
      if (!cards) return [{ name: "NO CARD LIST", w: 0, h: 0 }];
      return Array.from(cards.querySelectorAll("button, [role='checkbox'], a[href]"))
        .map((el) => {
          const { w, h } = hit(el);
          return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40), w, h };
        })
        // The row activator is a text link inside a sentence of content — WCAG
        // 2.5.8 exempts inline targets, and padding it to 24px would push every
        // card's first line apart. Everything else is a discrete control.
        .filter((c) => !/^\d/.test(c.name))
        .filter((c) => c.h < 24 || c.w < 24);
    });

    expect(small, `controls under 24×24: ${JSON.stringify(small)}`).toEqual([]);
  });

  test("row actions are touch-sized, not the 20px table figure", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);

    const h = await page.evaluate(() => {
      const cards = document.querySelector(".animate-fade-up.sm\\:hidden");
      const btn = cards?.querySelector<HTMLElement>("[class*='justify-end'] button");
      return btn ? btn.getBoundingClientRect().height : -1;
    });

    // 44px is the platform guidance, and the `:root` default the table opts
    // down from. This is the exact number that regressed.
    expect(h).toBeGreaterThanOrEqual(44);
  });

  test("multi-select works on a phone", async ({ page }) => {
    // It did not exist below 640px: the checkbox lived in a <th>.
    await page.setViewportSize(PHONE);
    await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);

    const first = page.getByRole("checkbox", { name: /^Select 6/ }).first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.getByRole("status")).toContainText("1 account selected");

    await page.getByRole("checkbox", { name: "Select all" }).click();
    await expect(page.getByRole("status")).toContainText("60 accounts selected");
  });
});
