/**
 * Build config for the verification-portal preview.
 *
 * Separate from the app's config on purpose: it aliases two modules to stubs,
 * and an alias that can reach a production build is a way to ship a stub. This
 * file is invoked only by `scripts/dev/render-portal.js`.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { sharedAlias } from "../../config/shared-alias";

const clientRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  root: __dirname,
  // Relative asset URLs, so the built page opens over file:// without a server.
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      // The two outside edges, stubbed. Order matters: the more specific
      // entries must precede the "@" catch-all or it swallows them.
      "@/lib/api-client": path.resolve(__dirname, "stub-api.ts"),
      "@/app/branding/branding-context": path.resolve(__dirname, "stub-branding.tsx"),
      "@": path.resolve(clientRoot, "src"),
      ...sharedAlias(clientRoot, "bundler"),
    },
  },
  css: { postcss: clientRoot },
  build: { outDir: path.resolve(__dirname, "dist"), emptyOutDir: true },
});
