import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
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
      // Mirrors vite.config.ts: packages/shared holds the Zod schemas the
      // Express API validates with, so the form tests exercise the SAME schema
      // objects the backend parses with rather than a copy (audit F12).
      "@shared": path.resolve(dirname, "../packages/shared"),
      // ONE zod instance. packages/shared is CommonJS and resolves `zod` from the
      // repo root, while client code imports its own — two copies means
      // `instanceof z.ZodType` is false across the boundary and zodResolver can
      // be handed a schema from the "wrong" zod. Deduping is not an optimisation
      // here, it is what makes the shared schemas work at all.
      zod: path.resolve(dirname, "../node_modules/zod"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
