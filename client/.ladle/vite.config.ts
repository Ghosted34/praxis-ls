/**
 * Vite config for the workbench only.
 *
 * The app's `vite.config.ts` carries the PWA plugin and a `manualChunks`
 * strategy. Letting Ladle inherit them made it emit a service worker and a
 * precache manifest for a page of buttons — same reasoning as `vitest.config.ts`
 * having its own.
 *
 * The ALIASES must match the app's exactly. A story that resolves `@/…`,
 * `@shared` or `zod` differently from the real screen stops being evidence
 * about the real screen, which is the one thing a workbench must not do.
 */
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "../src"),
      "@shared": path.resolve(dirname, "../../packages/shared"),
      // One zod instance — see the note in vite.config.ts.
      zod: path.resolve(dirname, "../../node_modules/zod"),
    },
  },
});
