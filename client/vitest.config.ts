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
  },
});
