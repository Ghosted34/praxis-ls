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
     * reported. NOTE what this deliberately does NOT do: it does not make the
     * app's date handling correct. `eta` is a Postgres `date` serialised to a
     * UTC instant at the API's local midnight and then formatted in the
     * browser's zone, so a viewer in a different zone from the API still sees
     * the wrong day. That is NEW-11, and it needs a decision about where dates
     * are rendered, not a test setting.
     */
    env: { TZ: "UTC" },
  },
});
