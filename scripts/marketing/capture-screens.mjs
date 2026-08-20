#!/usr/bin/env node
/**
 * Marketing screenshots, captured from the REAL app.
 *
 * WHY THIS IS A SCRIPT AND NOT A DESIGNER'S EXPORT. Hand-made "product shots"
 * start accurate and rot: the UI ships a change, the website keeps showing last
 * quarter's screen, and the first person to notice is a prospect halfway
 * through a demo. Running this on every release means the site is never older
 * than the product, and a screen that no longer captures is a signal worth
 * having rather than a mystery.
 *
 * WHAT IT PRODUCES. Three screens x two themes x two languages = twelve images.
 * The French captures are not optional: a French page showing an English UI
 * undoes the whole point of writing the French by hand (see
 * doc/BRAND_GLOSSARY_FR_EN.md).
 *
 * WHAT IT NEEDS. A running app with SEEDED SANDBOX DATA and an account that can
 * see it. Point it at a demo tenant — never at a customer's live environment.
 * Screenshots leak whatever is on screen, and the ones on the website leak it
 * to everyone.
 *
 *   CAPTURE_BASE_URL=https://demo.praxisls.com \
 *   CAPTURE_EMAIL=demo@praxisls.com \
 *   CAPTURE_PASSWORD=... \
 *   node scripts/marketing/capture-screens.mjs
 *
 * Optional: CAPTURE_OUT (default ./captures), CAPTURE_WIDTH (1600),
 * CAPTURE_HEIGHT (1000), CAPTURE_DPR (2), CAPTURE_ONLY (comma-separated screen
 * ids), CAPTURE_TIMEOUT_MS (30000).
 *
 * Chromium comes from puppeteer, which this repo already depends on. If it is
 * not installed: `npx puppeteer browsers install chrome`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/* puppeteer is imported LAZILY, in main(). A top-level import runs before the
 * argument checks below, so a machine without `npm install` answered a missing
 * CAPTURE_BASE_URL with a module-resolution stack trace — the least useful of
 * the two errors, reported first. */

/* The three shots the site is built around — see doc/LANDING_PAGE_GUIDE.md §8.
 * `ready` is a selector that proves the screen actually rendered its data, not
 * merely that the route resolved. Without it you capture skeletons, which is
 * exactly the failure mode that makes people go back to manual screenshots.
 * Adjust these selectors when the screens change; a capture that times out is
 * telling you the page moved. */
const SCREENS = [
  {
    id: "operation-file",
    route: "/operations/files",
    ready: "[data-testid='operation-file-360'], main",
    note: "The operation file, 360 view",
  },
  {
    id: "control-tower",
    route: "/operations/milestones",
    ready: "[data-testid='milestone-board'], main",
    note: "The milestone control tower",
  },
  {
    id: "general-ledger",
    route: "/finance/general-ledger",
    ready: "[data-testid='gl-table'], main",
    note: "The GL, showing an entry an operation posted itself",
  },
];

const THEMES = ["dark", "light"]; // dark first — it is the primary expression
const LANGS = ["en", "fr"];

/* localStorage keys owned by the app. praxis.theme is written by
 * client/src/lib/theme-mode.ts; praxis.lang by client/src/lib/i18n.ts (LANG_KEY).
 * Setting them before the app boots is what makes a capture deterministic —
 * flipping the UI toggle after load races the first paint and produces the
 * occasional mixed-theme frame. */
const THEME_KEY = "praxis.theme";
const LANG_KEY = "praxis.lang";

const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};

const BASE = env("CAPTURE_BASE_URL", "").replace(/\/+$/, "");
const EMAIL = env("CAPTURE_EMAIL", "");
const PASSWORD = env("CAPTURE_PASSWORD", "");
const OUT = path.resolve(env("CAPTURE_OUT", "captures"));
const WIDTH = Number(env("CAPTURE_WIDTH", "1600"));
const HEIGHT = Number(env("CAPTURE_HEIGHT", "1000"));
const DPR = Number(env("CAPTURE_DPR", "2"));
const TIMEOUT = Number(env("CAPTURE_TIMEOUT_MS", "30000"));
const ONLY = env("CAPTURE_ONLY", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function fail(message) {
  console.error(`capture-screens: ${message}`);
  process.exit(1);
}

if (!BASE) {
  fail(
    "CAPTURE_BASE_URL is required (e.g. https://demo.praxisls.com).\n" +
      "  Point it at a DEMO tenant with seeded sandbox data — never a live customer.",
  );
}
if (!EMAIL || !PASSWORD) {
  fail("CAPTURE_EMAIL and CAPTURE_PASSWORD are required.");
}
if (/\/\/(admin|console|api)\./.test(BASE)) {
  fail(`${BASE} is a platform host, not a tenant workspace. Use a demo tenant.`);
}

/**
 * Seed theme + language before any app code runs, so the first paint is right.
 *
 * The callback below is SERIALISED AND RUN IN THE BROWSER, not in Node — which
 * is why `localStorage` is legitimate here and why eslint, configured for this
 * repo's Node sources, cannot know that. The `global` directive says so rather
 * than disabling the rule: `no-undef` stays live for the rest of this file, so
 * a genuine typo in Node code is still caught.
 *
 * It also has to stay self-contained. Puppeteer serialises the function and
 * evaluates it in a fresh context, so it closes over NOTHING from this
 * module — every value it needs arrives as an argument. That is why the keys
 * are passed in rather than read from the constants a few lines up.
 */
/* global localStorage */
async function seedPreferences(page, theme, lang) {
  await page.evaluateOnNewDocument(
    (themeKey, themeValue, langKey, langValue) => {
      try {
        localStorage.setItem(themeKey, themeValue);
        localStorage.setItem(langKey, langValue);
      } catch {
        /* storage unavailable — the app falls back to its defaults and the
           capture is simply in the default theme, which is visible in the
           output rather than silent. */
      }
    },
    THEME_KEY,
    theme,
    LANG_KEY,
    lang,
  );
}

/**
 * Sign in once per browser context. The landing page opens a login modal rather
 * than routing to a form (client/src/features/landing/landing-page.tsx), so we
 * click through it the way a person would instead of posting to the API — that
 * way this script keeps working if the auth endpoint changes shape, and stops
 * working loudly if the login UI does.
 */
async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: TIMEOUT });

  const enter = await page.$("button[aria-label='Sign in']");
  if (enter) await enter.click();

  await page.waitForSelector("input[type='email']", { timeout: TIMEOUT });
  await page.type("input[type='email']", EMAIL, { delay: 8 });
  await page.type("input[type='password']", PASSWORD, { delay: 8 });

  await Promise.all([
    page.keyboard.press("Enter"),
    page
      .waitForNavigation({ waitUntil: "networkidle2", timeout: TIMEOUT })
      .catch(() => {
        /* SPA login swaps state without navigating; the readiness wait below is
           the real check. */
      }),
  ]);

  const stillOnLogin = await page.$("input[type='password']");
  if (stillOnLogin) {
    fail("sign-in did not complete — check CAPTURE_EMAIL / CAPTURE_PASSWORD.");
  }
}

async function capture(browser, screen, theme, lang) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const name = `${screen.id}--${theme}--${lang}.png`;

  try {
    await page.setViewport({
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: DPR,
    });
    await seedPreferences(page, theme, lang);
    await signIn(page);

    await page.goto(`${BASE}${screen.route}`, {
      waitUntil: "networkidle2",
      timeout: TIMEOUT,
    });
    await page.waitForSelector(screen.ready, { timeout: TIMEOUT });

    /* Freeze anything that would make two runs of the same screen differ —
       a diff that is all caret blink and spinner phase is a diff nobody reads. */
    await page.addStyleTag({
      content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`,
    });
    await new Promise((r) => setTimeout(r, 400));

    await page.screenshot({ path: path.join(OUT, name), type: "png" });
    console.log(`  ✓ ${name}`);
    return { name, ok: true };
  } catch (err) {
    console.error(`  ✗ ${name} — ${err.message}`);
    return { name, ok: false, error: err.message };
  } finally {
    await context.close();
  }
}

async function main() {
  const screens = ONLY.length
    ? SCREENS.filter((s) => ONLY.includes(s.id))
    : SCREENS;
  if (!screens.length) {
    fail(`CAPTURE_ONLY matched no screens. Known ids: ${SCREENS.map((s) => s.id).join(", ")}`);
  }

  const puppeteer = await import("puppeteer").then((m) => m.default).catch(() => {
    fail(
      "puppeteer is not installed. Run `npm install`, and if Chromium is still\n" +
        "  missing: `npx puppeteer browsers install chrome`.",
    );
  });

  await mkdir(OUT, { recursive: true });
  console.log(`capture-screens: ${BASE} → ${OUT}`);
  console.log(`  ${screens.length} screens x ${THEMES.length} themes x ${LANGS.length} languages\n`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
  });

  const results = [];
  try {
    for (const screen of screens) {
      console.log(`${screen.id} — ${screen.note}`);
      for (const theme of THEMES) {
        for (const lang of LANGS) {
          results.push(await capture(browser, screen, theme, lang));
        }
      }
      console.log("");
    }
  } finally {
    await browser.close();
  }

  await writeFile(
    path.join(OUT, "manifest.json"),
    JSON.stringify(
      { capturedAt: new Date().toISOString(), base: BASE, viewport: { width: WIDTH, height: HEIGHT, dpr: DPR }, results },
      null,
      2,
    ) + "\n",
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} captured → ${OUT}`);
  if (failed.length) {
    console.error(`\n${failed.length} failed. A timeout usually means the screen moved — check the`);
    console.error(`selectors in SCREENS against the current app before assuming the app is broken.`);
    process.exit(1);
  }
}

main().catch((err) => fail(err.stack || err.message));
