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
import {
  openScreen,
  contentWidth,
  hasHorizontalScroll,
  railWidth,
  ribbonHeight,
  DESKTOP_WIDTHS,
  RAIL_PX,
  type Density,
} from "./fixtures";

/** Density → row height. Mirrors DENSITY_ROW_PX in src/lib/density.ts. */
const ROW_PX = { compact: 28, default: 32, comfortable: 40 } as const;

test.describe("desktop layout", () => {
  for (const width of DESKTOP_WIDTHS) {
    test(`chart of accounts at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const { errors } = await openScreen(
        page,
        "/finance/chart-of-accounts",
        /Chart of accounts/i,
      );

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
       *
       * `RAIL_PX` joined the sum when the icon rail shipped: the rail is an
       * in-flow column beside the content, so it is width the screen does not
       * get. It is written as a term rather than folded into `shellPadding`
       * because it is a different KIND of thing — padding is the screen's own
       * breathing room and can be tuned per width, the rail is a fixed piece of
       * chrome — and because the next person to read a failure here needs to
       * see which one moved.
       */
      expect(column).toBeGreaterThan(0);
      expect(column).toBeLessThanOrEqual(cap);
      expect(column).toBeCloseTo(
        Math.min(cap, width - RAIL_PX - shellPadding),
        -1,
      );

      // A content column wider than its viewport is the failure this hides.
      expect(await hasHorizontalScroll(page)).toBe(false);

      // F13: exactly one page heading, never zero and never two.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

      expect(errors, `page errors at ${width}px`).toEqual([]);
    });
  }

  test("the content column actually grows between 1920 and 2560", async ({
    page,
  }) => {
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

/**
 * THE CHROME BUDGET. The ribbon replaced a 52px nav row with two rows, so the
 * question "how much of the window is furniture now" is the one a reviewer asks
 * first — and it is not answerable from a unit test, because jsdom has no
 * layout engine and the height comes from CSS the tests never load.
 *
 * The budget is ~96px at the default density, and it must TRACK the density
 * preference: someone who asked for compact rows did not ask for compact rows
 * under a fat header. That coupling is one `[data-density] .ribbon` rule away
 * from silently not applying, which is exactly the shape of the defect that let
 * `--row-py` look correct for two phases while the rendered row was 49px.
 */
test.describe("the ribbon's chrome budget", () => {
  /** Two rows of `--ribbon-row-h`, plus the hairline between them and under. */
  const BUDGET = { compact: 82, default: 94, comfortable: 110 } as const;

  for (const [density, height] of Object.entries(BUDGET)) {
    test(`${density} chrome is ${height}px, following the density preference`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openScreen(
        page,
        "/finance/chart-of-accounts",
        /Chart of accounts/i,
        density as Density,
      );

      const measured = await ribbonHeight(page);
      expect(
        measured,
        "the ribbon did not render — is /permissions/mine mocked?",
      ).toBeGreaterThan(0);
      expect(
        Math.abs(measured - height),
        `${density} chrome was ${measured}px`,
      ).toBeLessThanOrEqual(2);
    });
  }

  test("the rail is exactly the width the column assertions subtract", async ({
    page,
  }) => {
    // Without this, widening the rail would quietly narrow every table while
    // the column assertions kept passing — they subtract a constant, and this
    // is what holds the constant to what actually renders.
    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);
    expect(await railWidth(page)).toBe(RAIL_PX);
  });

  /**
   * THE APP MARK SITS ON THE RAIL'S CENTRE LINE, and only a browser can say so.
   *
   * The mark and the rail's Control Tower button are the top two things down the
   * left edge, one directly above the other, so a few pixels of disagreement
   * between them reads as a mistake. The offset is `(--rail-w -
   * --wco-mark-size) / 2` in `.wco-mark`, which is a computed style over two
   * custom properties and a media query — jsdom evaluates none of that, and the
   * unit test can therefore only pin that the component publishes its size. The
   * sum itself is measurable here and nowhere else.
   *
   * TOLERANCE IS 0.05px, NOT HALF A PIXEL. The first version of the CSS centred
   * the mark on `--rail-w` and forgot that it is a BORDER-box width — the rail's
   * buttons centre in `--rail-w - --rail-border`, so the mark landed exactly
   * 0.5px right of the Home button. A half-pixel tolerance is the one figure
   * that would have called that alignment good. Both boxes are fixed sizes with
   * no text in them, so the honest expectation is equality.
   */
  test("the title bar's app mark is centred on the rail below it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);

    const markBox = await page
      .locator(".wco .wco-mark > :first-child")
      .boundingBox();
    const homeBox = await page
      .locator('.rail .rail-btn[aria-label="Control Tower"]')
      .boundingBox();
    expect(markBox, "the app mark should be in the title bar").not.toBeNull();
    expect(
      homeBox,
      "the rail should carry a Control Tower button",
    ).not.toBeNull();

    const centre = (b: { x: number; width: number }) => b.x + b.width / 2;
    expect(centre(markBox!)).toBeCloseTo(centre(homeBox!), 1);
  });

  /**
   * ROW B REVEALS PROGRESSIVELY, and this is the only place that can be
   * checked. The row hides its tail with `hidden` / `2xl:inline-flex`, which
   * jsdom cannot evaluate — it applies no media queries and loads no
   * stylesheet — so a unit test sees ten links at every width and is satisfied.
   *
   * It shipped broken for exactly that reason: `.ribbon-item` sets
   * `display: inline-flex` and was written as plain CSS after the utilities, so
   * it beat `hidden` on source order and all ten of Finance's sections rendered
   * at 1280px. The failure was a crowded row, not an error, and the only thing
   * that would ever have caught it is a browser.
   *
   * THE MENU IS THERE EXACTLY WHEN SOMETHING IS HIDDEN. This used to assert the
   * overflow was visible full stop, which is a weaker statement than it looks:
   * it passed while the "…" sat beside a row that was already showing every
   * destination it had, a trigger whose only job was to open a list you could
   * already read in full. The property worth holding is the reachability one —
   * at any width where the row has shed something the menu is there to reach
   * it, and at a width where nothing is hidden there is nothing for it to do.
   * Asserting it as an equivalence also means a future change to REVEAL cannot
   * strand a destination without failing here.
   */
  test("row B sheds its tail at narrow widths and shows it at wide ones", async ({
    page,
  }) => {
    const measure = async (width: number) => {
      await page.setViewportSize({ width, height: 900 });
      await openScreen(
        page,
        "/finance/chart-of-accounts",
        /Chart of accounts/i,
      );
      const shown = await page.evaluate(() => {
        const nav = document.querySelector("nav[aria-label$='sections']");
        return Array.from(nav?.querySelectorAll("a") ?? []).filter(
          (a) => a.getBoundingClientRect().width > 0,
        ).length;
      });
      const overflow = await page
        .getByRole("button", { name: /All Finance destinations/i })
        .isVisible();
      return { shown, overflow };
    };

    // Finance has ten sections — more than fit at 1280, which is the width the
    // shed has to be observable at if it is observable anywhere.
    const narrow = await measure(1280);
    const wide = await measure(1920);

    expect(narrow.shown).toBeGreaterThan(0);
    expect(
      narrow.shown,
      "nothing was hidden at 1280 — is .ribbon-item beating `hidden`?",
    ).toBeLessThan(10);
    expect(
      wide.shown,
      "a wider window showed no more than a narrow one",
    ).toBeGreaterThan(narrow.shown);

    // Hidden ⇔ reachable through the menu, at both widths.
    for (const [width, m] of [
      [1280, narrow],
      [1920, wide],
    ] as const) {
      expect(
        m.overflow,
        m.shown < 10
          ? `${10 - m.shown} section(s) were hidden at ${width} with no menu to reach them`
          : `the row showed every section at ${width} and still drew a redundant "…"`,
      ).toBe(m.shown < 10);
    }
  });

  /**
   * MASTER DATA FITS AT 1280, ALL NINE OF IT, and that is a promise to a real
   * desktop rather than a nice-to-have. A 1920px monitor at Windows' 125%
   * scaling reports 1536 CSS px; at 150% it reports 1280. So the tier below
   * `2xl` is not the narrow case, it is the ordinary one, and a row that hides
   * its ninth destination there hides it from a large share of the people
   * using this product on a full-size screen.
   *
   * Nine labels including "Financial dictionary" and "Corporate entities" is
   * the longest row in the app that is expected to complete, so this is also
   * the assertion that would fail first if a section were renamed to something
   * that no longer fits, or if a control were added to row B. Checking the
   * clipping explicitly matters because the nav cluster carries `min-w-0`:
   * flex would sooner shrink a label to an ellipsis than report an overflow,
   * so "nothing overflowed" on its own is not evidence that anything is
   * readable.
   */
  test("master data shows all nine sections at 1280, unclipped", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openScreen(page, "/master/clients", /Clients/i);

    const row = await page.evaluate(() => {
      const nav = document.querySelector("nav[aria-label$='sections']") as
        | HTMLElement
        | undefined;
      const links = Array.from(nav?.querySelectorAll("a") ?? []).filter(
        (a) => a.getBoundingClientRect().width > 0,
      );
      return {
        labels: links.map((a) => a.textContent ?? ""),
        clipped: links
          .filter((a) => a.scrollWidth > a.clientWidth)
          .map((a) => a.textContent),
        navOverflow: nav ? nav.scrollWidth - nav.clientWidth : -1,
        pageScrollX:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });

    expect(row.labels).toEqual([
      "Clients",
      "Suppliers",
      "Corporate entities",
      "Treasury",
      "Currencies",
      "Expense rates",
      "Financial dictionary",
      "Tax",
      "Service types",
    ]);
    expect(row.clipped, "a section label was cut to fit").toEqual([]);
    expect(row.navOverflow, "the section row overflowed its space").toBe(0);
    expect(row.pageScrollX, "row B pushed the page sideways").toBe(0);

    // Nothing is hidden, so there is nothing for the menu to hold.
    await expect(
      page.getByRole("button", { name: /All Master data destinations/i }),
    ).toBeHidden();
  });

  test("the hub draws no tab strip of its own on a desktop", async ({
    page,
  }) => {
    /*
     * The whole point of the ribbon: its second row IS the hub's tab strip, so
     * the page must not draw a second one. Three bands of navigation before the
     * first row of data is what this replaced, and a `md:hidden` that gets
     * dropped in a refactor puts the third band straight back — visible only in
     * a browser, because jsdom applies no media queries.
     */
    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);

    const stripsInPage = await page.evaluate(
      () => document.querySelectorAll("main [role='tablist']").length,
    );
    expect(stripsInPage).toBe(0);

    // …and the destinations it used to carry are in the chrome instead.
    await expect(
      page.getByRole("navigation", { name: /Finance sections/i }),
    ).toBeVisible();
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
      await openScreen(
        page,
        "/finance/chart-of-accounts",
        /Chart of accounts/i,
        density as Density,
      );

      const measured = await page.evaluate(() => {
        const row = document.querySelector("tbody tr") as HTMLElement;
        const td = row.querySelector("td") as HTMLElement;
        return {
          rowPy: getComputedStyle(document.documentElement)
            .getPropertyValue("--row-py")
            .trim(),
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
              return (
                el.getBoundingClientRect().height +
                parseFloat(cs.marginTop) +
                parseFloat(cs.marginBottom)
              );
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
      expect(
        Math.abs(measured.rowH - height),
        `${density} row was ${measured.rowH}px`,
      ).toBeLessThanOrEqual(2);

      /*
       * NOTHING IN THE ROW EXCEEDS THE CONTROL HEIGHT. This is the assertion
       * that would have caught the original defect. `<Button size="sm">` is 36px
       * and 67 screens put one in the actions column, so the row was 48px
       * whatever the padding said — the padding was never what set the height.
       */
      expect(
        measured.tallest,
        "a cell child is taller than --row-control-h",
      ).toBeLessThanOrEqual(21);
    });
  }
});

test.describe("wide-table affordances", () => {
  test("the column heading stays put while the body scrolls", async ({
    page,
  }) => {
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

  test("the identity column stays put while the table scrolls sideways", async ({
    page,
  }) => {
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
    const { errors } = await openScreen(
      page,
      "/finance/chart-of-accounts",
      /Chart of accounts/i,
    );

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
          const inset =
            Math.abs(parseFloat(before.insetBlockStart || "0")) || 0;
          return { w: own.width + inset * 2, h: own.height + inset * 2 };
        }
        return { w: own.width, h: own.height };
      };
      const cards = document.querySelector(".animate-fade-up.sm\\:hidden");
      if (!cards) return [{ name: "NO CARD LIST", w: 0, h: 0 }];
      return (
        Array.from(cards.querySelectorAll("button, [role='checkbox'], a[href]"))
          .map((el) => {
            const { w, h } = hit(el);
            return {
              name: (
                el.getAttribute("aria-label") ||
                el.textContent ||
                el.tagName
              )
                .trim()
                .slice(0, 40),
              w,
              h,
            };
          })
          // The row activator is a text link inside a sentence of content — WCAG
          // 2.5.8 exempts inline targets, and padding it to 24px would push every
          // card's first line apart. Everything else is a discrete control.
          .filter((c) => !/^\d/.test(c.name))
          .filter((c) => c.h < 24 || c.w < 24)
      );
    });

    expect(small, `controls under 24×24: ${JSON.stringify(small)}`).toEqual([]);
  });

  test("row actions are touch-sized, not the 20px table figure", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openScreen(page, "/finance/chart-of-accounts", /Chart of accounts/i);

    const h = await page.evaluate(() => {
      const cards = document.querySelector(".animate-fade-up.sm\\:hidden");
      const btn = cards?.querySelector<HTMLElement>(
        "[class*='justify-end'] button",
      );
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

    // SCOPED to the selection bar rather than `getByRole("status")` alone.
    //
    // `role="status"` is a polite live region, and the app legitimately has
    // more than one — the maintenance banner is also a status, sits above every
    // route, and would be present during a scheduled window. An unscoped
    // getByRole("status") matches whichever ones exist and fails Playwright's
    // strict-mode check the moment a second appears, which reads as "multi-
    // select is broken" when nothing about multi-select changed.
    const selectionBar = page
      .getByRole("status")
      .filter({ hasText: /selected/ });

    const first = page.getByRole("checkbox", { name: /^Select 6/ }).first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(selectionBar).toContainText("1 account selected");

    await page.getByRole("checkbox", { name: "Select all" }).click();
    await expect(selectionBar).toContainText("60 accounts selected");
  });
});
