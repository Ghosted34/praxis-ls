/**
 * The app must own its own scrolling — nothing may scroll the DOCUMENT.
 *
 * ── THE BUG THIS GATE EXISTS FOR ───────────────────────────────────────────
 *
 * Reported as "I click upload and the screen goes black; I have to Ctrl+F5 to
 * see anything." It reproduced on Cancel as well as on choosing a file, which
 * is what ruled the upload code out entirely: the trigger was the FOCUS, not
 * the file.
 *
 * `sr-only` is `position: absolute` with no offsets, so an `sr-only` control
 * with no positioned ancestor is laid out against the initial containing block
 * — the document — and contributes to the DOCUMENT's scrollable overflow even
 * though it visually sits inside the shell's own scroll container. Clicking a
 * dropzone focuses its hidden file input, the browser scrolls the focused
 * element into view, and it scrolls the document: the whole shell leaves the
 * viewport. `html, body, #root` are `overflow: hidden`, so there is no
 * scrollbar left to bring it back and only a reload recovers. Measured at
 * 1440×900: document scrollTop 50 → 768, `#root` top 0 → -768.
 *
 * ── WHY IT IS ASSERTED THIS WAY ────────────────────────────────────────────
 *
 * The narrow fix is a `relative` on one label, and a test that asserted that
 * class would pass while the next `sr-only` control reintroduced the same
 * failure somewhere else. So this asserts the PROPERTY instead: on a real
 * screen in a real browser, the document has no scrollable overflow, and
 * focusing the app's own visually-hidden controls does not move the shell.
 * That is the invariant — one custom scroll container, and it is not the
 * document — and it holds no matter which component breaks it next.
 *
 * jsdom cannot host this: it has no layout engine, so scrollHeight is 0 and
 * every assertion here would pass vacuously. It has to be a real browser.
 */
import { test, expect } from "@playwright/test";
import { seedSession, fakeApi, DESKTOP_WIDTHS } from "./fixtures";

/**
 * The article editor, because it renders two real `<FileDrop>`s — a cover and a
 * gallery — below a column of copy fields. That is the shape the report came
 * from: a dropzone far enough down a long screen that the hidden input it
 * contains sits below the fold.
 */
const DROPZONE_SCREEN = "/settings/website/articles/a-1";

async function openDropzoneScreen(page: import("@playwright/test").Page) {
  await seedSession(page);
  await fakeApi(page);
  await page.goto(DROPZONE_SCREEN, { waitUntil: "domcontentloaded" });
  // The marker is the dropzone itself — asserting the screen under test is the
  // screen that actually rendered (fixtures.ts, Addendum 7).
  await page
    .locator("label:has(input[type=file])")
    .first()
    .waitFor({ timeout: 15_000 });
}

/** Scrollable overflow of the document, in CSS pixels. Zero is the contract. */
async function shellPosition(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const el = document.scrollingElement as HTMLElement;
    return {
      overflow: el.scrollHeight - el.clientHeight,
      scrollTop: Math.round(el.scrollTop),
      rootTop: Math.round(
        document.getElementById("root")!.getBoundingClientRect().top,
      ),
    };
  });
}

test.describe("the document never scrolls", () => {
  for (const width of DESKTOP_WIDTHS) {
    test(`a screen with dropzones adds no document overflow at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openDropzoneScreen(page);
      // Not "small" — zero. Any overflow is an element that escaped the shell's
      // scroll container, which is the whole failure mode.
      expect((await shellPosition(page)).overflow).toBe(0);
    });
  }

  test("clicking a dropzone does not carry the app out of the viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDropzoneScreen(page);

    // Cancel the picker rather than choosing a file. The report reproduced on
    // Cancel too, which is what proves the FOCUS moves the page and not the
    // upload — so the gate must not depend on a file existing either.
    page.on("filechooser", () => {});

    const label = page.locator("label:has(input[type=file])").last();
    await label.scrollIntoViewIfNeeded();
    const before = await shellPosition(page);

    await label.click();
    await page.waitForTimeout(300);
    const after = await shellPosition(page);

    expect(after.rootTop).toBe(before.rootTop);
    expect(after.scrollTop).toBe(0);
  });

  test("focusing every visually-hidden control leaves the shell still", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDropzoneScreen(page);

    const moved = await page.evaluate(() => {
      const root = document.getElementById("root")!;
      const start = root.getBoundingClientRect().top;
      let worst = 0;
      for (const el of Array.from(document.querySelectorAll(".sr-only"))) {
        (el as HTMLElement).focus?.();
        worst = Math.max(
          worst,
          Math.abs(root.getBoundingClientRect().top - start),
        );
      }
      return worst;
    });

    expect(moved).toBe(0);
  });
});
