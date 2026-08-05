/**
 * Desktop layout gate (Phase 5).
 *
 * Phases 3 and 4 both measured the app in a real browser at 1280 / 1440 / 1920 /
 * 2560 — and both threw the harness away afterwards, deferring "stand it up in
 * CI" to the next phase. This is that harness, committed.
 *
 * WHY IT MEASURES NUMBERS AND NOT PIXELS, which is the design decision worth
 * defending. The obvious reading of "visual regression baselines" is a set of
 * committed screenshots and a pixel diff. That would be a false gate here: a
 * baseline captured on this machine and compared on ubuntu-latest differs on
 * font hinting and subpixel rendering before anything about the app has changed,
 * so its first CI run is red for a reason nobody can act on. This codebase has
 * already written down what happens next — Addendum 4: "a warning nobody reads
 * is not a gate", and Addendum 7 on the two gates that "failed in the way that
 * gets a gate disabled".
 *
 * What actually regressed in the failures this audit is about was never a pixel.
 * It was a NUMBER: a content column that did not grow past 1152px, a row 46px
 * tall instead of 32, a page that scrolled sideways, an entrance that took half
 * a second. Those are deterministic across platforms, they are the properties
 * Phases 3 and 4 hand-measured, and they are what this asserts.
 *
 * Screenshots are still captured — as artifacts on failure, for a human to look
 * at. They are evidence, not the assertion.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /**
   * Serves the BUILT app, not the dev server. The dev server transforms modules
   * on demand and does not run the production chunk graph — and the one
   * production incident this audit records (Addendum 4, the blank page) was
   * invisible in dev and fatal in the built bundle.
   *
   * `--host 127.0.0.1` IS LOAD-BEARING. `vite preview` defaults to binding
   * `localhost`, and what that resolves to depends on the machine: this sandbox
   * has no IPv6, so Node bound 127.0.0.1 and everything passed. A GitHub runner
   * resolves `localhost` to `::1` first, Node binds there, and Playwright — which
   * polls the literal `url` below — waits the full two minutes for a server that
   * is up and listening on an address it is not asking about. The failure it
   * reports is `Timed out waiting 120000ms from config.webServer`, which says
   * nothing about why. Binding an explicit address makes both machines agree.
   *
   * `stdout: "pipe"` exists because of that same run: the server's own output is
   * swallowed by default, so the CI log had the timeout and not one line about
   * the cause. A gate that cannot say why it failed costs more than it saves.
   */
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
