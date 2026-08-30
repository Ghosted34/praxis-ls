import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Dev proxy: the app calls `/api/*` and `/media/*`, Vite forwards to the Node
 * API. `changeOrigin` + the Host header rewrite make TENANT resolution work
 * locally without editing your hosts file — the backend picks the tenant from
 * `Host` (doc/SETUP.md), and every route in this app is tenant-scoped
 * (`/api/tenant/public/…`, `/api/tenant/portal/…`).
 *
 * Identical mechanism to `client/vite.config.ts`, deliberately: the same
 * `VITE_TENANT_HOST` you already provisioned works for both apps, so a dev
 * running the ERP and this site side by side sees the same tenant.
 */
const API_TARGET = process.env.VITE_API_TARGET || "http://localhost:8080";

/**
 * Extra hostnames `vite dev`/`vite preview` may answer to, comma-separated.
 *
 * Vite rejects a request whose `Host` is not localhost or an IP, and a check-out
 * reached through a proxy or a tunnel — a review environment, an agent sandbox —
 * presents some other hostname, so the dev server answers 403 and the app looks
 * broken when nothing is wrong with the app. Default is unchanged (nothing
 * extra), because that check exists to stop DNS rebinding against a dev server
 * that can read the tenant database through its proxy.
 */
const ALLOWED_HOSTS = (process.env.VITE_ALLOWED_HOSTS || "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
const TENANT_HOST = process.env.VITE_TENANT_HOST || "smartls.praxisls.com";

export default defineConfig({
  // Mounted at the ROOT of the tenant host and served for /public/* and
  // /portal/* only (see the note on the mount in src/server.js), so asset URLs
  // stay absolute-from-root. A build copied to a subpath would need base set.
  base: "/",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    // 5173 is client, 5174 is platform-console.
    port: 5175,
    host: "0.0.0.0",
    ...(ALLOWED_HOSTS.length ? { allowedHosts: ALLOWED_HOSTS } : {}),
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        headers: { Host: TENANT_HOST },
      },
      // Tenant brand media — the logo, the marketing cover images.
      "/media": {
        target: API_TARGET,
        changeOrigin: true,
        headers: { Host: TENANT_HOST },
      },
    },
  },
  preview: {
    port: 4173,
    host: "0.0.0.0",
    ...(ALLOWED_HOSTS.length ? { allowedHosts: ALLOWED_HOSTS } : {}),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    /**
     * NOT the default "assets", and this is load-bearing.
     *
     * On the tenant host this app is mounted under path prefixes (see the note on
     * the mount in src/server.js) and the ERP's own build already answers
     * /assets/*. Under the default, this app's index.html asks for
     * /assets/index-<hash>.js; that path matches no prefix the mount claims, so
     * the request falls through to client/dist (a miss — different hashes) and
     * then to the ERP's `app.get("*")`, which returns index.html with
     * 200 text/html. The browser refuses to execute HTML as a module and paints
     * nothing: the page loads and the app never starts.
     *
     * Neither `vite dev` nor `vite preview` goes through that mount, which is why
     * this is invisible in development and only appears once SERVE_PUBLIC_WEB is
     * on in a container.
     *
     * A directory name of this app's own, claimed by PUBLIC_WEB_PATH, is what
     * makes the static handler resolve it. The two must stay in step;
     * tests/unit/public-web-mount.test.js reads both files and pins them together.
     */
    assetsDir: "public-assets",
    rollupOptions: {
      onwarn(warning, warn) {
        // The one warning that must never be a warning. A circular chunk graph
        // reads another chunk's exports before they are assigned and paints a
        // blank page — it took production down once in client/ (see the
        // CHUNKING note there). This app has ONE manual bucket (below), which is
        // acyclic by construction; this guard keeps it that way.
        if (warning.code === "CIRCULAR_CHUNK") {
          throw new Error(
            `${warning.message}\n\nA circular chunk graph ships a blank page. ` +
              "Keep the single `vendor` bucket — do not add a second manual bucket.",
          );
        }
        warn(warning);
      },
      output: {
        manualChunks(id) {
          // ONE bucket for node_modules, for the reason above: a single bucket
          // cannot import itself. App code is NOT partitioned by hand — the
          // route-level React.lazy in src/app/router.tsx makes every screen a
          // dynamic import and Rollup derives those chunks from the real graph.
          //
          // i18next and react-i18next are excluded: they are the heaviest thing
          // here that a first-time visitor on a slow connection could do without,
          // and leaving them out lets Rollup attach them to the chunk that
          // imports them instead of putting them in the always-loaded payload.
          if (!id.includes("/node_modules/")) return undefined;
          const p = id.replace(/\\/g, "/");
          if (p.includes("/node_modules/@fontsource")) return undefined;
          if (
            p.includes("/node_modules/i18next") ||
            p.includes("/node_modules/react-i18next")
          ) {
            return undefined;
          }
          return "vendor";
        },
      },
    },
  },
});
