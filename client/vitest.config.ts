import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { sharedAlias, SHARED_COMMONJS_INCLUDE } from "./config/shared-alias";
import { fileURLToPath } from "node:url";

// fileURLToPath rather than __dirname (unavailable in an ESM config) or
// import.meta.dirname (Node 20.11+; .nvmrc pins 20, so don't assume the patch).
const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest config (audit F15 — the client had ZERO tests against ~50 backend Jest
 * suites, on a frontend that drives journal entries, payroll runs and God-Mode
 * purges).
 *
 * Separate from vite.config.ts on purpose: that file carries the PWA plugin and
 * a manualChunks strategy, neither of which should run for tests.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
      // vite-plugin-pwa generates this module at build time and is not loaded
      // here (see above), so it resolves to nothing under vitest and any test
      // rendering a PWA component dies at import-analysis. The stub only has to
      // exist — tests vi.mock() the specifier to script the update lifecycle.
      "virtual:pwa-register/react": path.resolve(
        dirname,
        "src/test/stubs/pwa-register-react.ts",
      ),
      // @shared + zod come from config/shared-alias.ts — the SAME module vite.config.ts
      // uses. They were duplicated here and drifted: the tests transformed
      // packages/shared one way and the build another, so the package passed its
      // suite while `vite build` could not resolve its named exports at all.
      ...sharedAlias(dirname, "node"),
    },
  },
  // packages/shared is CommonJS source. Vitest inlines it rather than going
  // through Rollup's commonjs plugin, but keep the include aligned so a future
  // change to one path is visible in the other.
  build: { commonjsOptions: { include: SHARED_COMMONJS_INCLUDE } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    /**
     * Pin the timezone, or date assertions mean different things on different
     * desks.
     *
     * `dateFmt` formats with `toLocaleDateString` and no `timeZone`, i.e. in
     * whatever zone the machine is in. model.test.ts asserted an ETA of
     * `2026-07-04T23:00:00.000Z` renders "04 Jul 2026" — true at UTC, false one
     * hour later: in Douala (WAT, UTC+1) that instant is already the 5th. So the
     * suite passed on the UTC CI runner and failed for every developer on this
     * team, which is the wrong way round for a test to be wrong.
     *
     * There is no timestamp that fixes this. For a calendar date to survive
     * every real offset (UTC-12 to UTC+14) the UTC hour would have to be both
     * >= 12 and <= 9. Midday is stable everywhere except Kiritimati; nothing is
     * stable everywhere. Determinism has to come from pinning the zone.
     *
     * UTC because it matches CI and Docker, so a failure reproduces where it was
     * reported.
     *
     * NEW-11 — "a Postgres `date` serialised to a UTC instant at the API's local
     * midnight and then formatted in the browser's zone, so a viewer in a
     * different zone from the API sees the wrong day" — IS NOW FIXED, at the
     * source rather than in the renderer: `src/shared/db/pg-date-types.js` hands
     * `date` columns back as the `YYYY-MM-DD` string Postgres sent, and
     * `lib/format.ts` parses that as a calendar date instead of a UTC instant.
     * A `timestamptz` like `created_at` is still an instant and still renders in
     * the reader's zone, which is correct for an instant.
     *
     * The pin STAYS, and this is the caveat it now carries: UTC is the one zone
     * where a date that shifts by a day looks fine, so a suite that only ran
     * here could not see that class of bug at all. Tests that care about it set
     * `process.env.TZ` themselves — see `lib/format-dates.test.ts`.
     */
    env: { TZ: "UTC" },
    /**
     * 15s, not vitest's 5s.
     *
     * Headroom, not permission to be slow. The suite is 92 files across
     * parallel workers, normally run on a laptop already carrying two
     * `npm run dev` processes. The heaviest test in it — the vacancy interview,
     * which answers eight questions and then drafts — measures ~450ms idle. It
     * crossed 5s only under that load, and only sometimes.
     *
     * An interaction-heavy test that passes alone and fails in the suite is the
     * most expensive kind of red: the message says "timed out", the code is
     * fine, and the next real failure gets waved through because the suite "is
     * flaky". Worse, when vitest aborts a test mid-interaction the component
     * stays mounted long enough to poison the NEXT test — that is what turned
     * one timeout into three failures in the same file.
     *
     * The cost, so this is not raised again by reflex: a genuinely deadlocked
     * test now burns 15s instead of 5s before it reports. That is the trade.
     */
    testTimeout: 15_000,
  },
});
