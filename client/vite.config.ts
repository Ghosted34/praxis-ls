import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import {
  sharedAlias,
  SHARED_COMMONJS_INCLUDE,
  SHARED_OPTIMIZE_INCLUDE,
} from "./config/shared-alias";

// Dev proxy: the SPA calls /api/* and Vite forwards to the Node API. `changeOrigin`
// + the Host header rewrite make tenant resolution work locally without editing
// your hosts file — the backend resolves the tenant from Host (see doc/SETUP.md).
// Set VITE_TENANT_HOST to the tenant you provisioned (e.g. smartls.praxisls.com).
const API_TARGET = process.env.VITE_API_TARGET || "http://localhost:8080";
const TENANT_HOST = process.env.VITE_TENANT_HOST || "smartls.praxisls.com";

/**
 * node_modules packages deliberately left OUT of the `vendor` bucket so Rollup
 * can attach them to whichever lazy route actually imports them.
 *
 * world-atlas is ~500 kB of Natural Earth geometry read only by the Control
 * Tower map; a user sitting on the login screen should not download it. Leaving
 * a package out is always safe — Rollup then places it, and Rollup's own
 * chunking never produces a cycle. It is ADDING a bucket that is forbidden (see
 * the note on `build` below).
 */
const ROUTE_LOCAL_VENDOR = ["world-atlas", "topojson-client"];

const inPackage = (id: string, pkg: string) =>
  id.replace(/\\/g, "/").includes(`/node_modules/${pkg}/`);

/**
 * The font library (lib/fonts.ts) dynamic-imports fifteen @fontsource families
 * so the picker can render each name in its own face. Left in the `vendor`
 * bucket they all landed in the eagerly-loaded vendor stylesheet — 96
 * @font-face rules and 57 kB of render-blocking CSS on every page load, for a
 * set where a tenant uses three. Excluded here, Rollup attaches each family to
 * the dynamic import that pulls it, which is what makes the lazy loading real
 * rather than nominal.
 *
 * The same reasoning as ROUTE_LOCAL_VENDOR above; kept separate only because
 * this is a prefix match over a scope, not a list of package names.
 */
const isFontPackage = (id: string) =>
  id.replace(/\\/g, "/").includes("/node_modules/@fontsource");

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt" (was "autoUpdate"): an ERP shouldn't reload itself out from
      // under a user mid-task. The service worker installs the new build in the
      // background and we surface a "New version available — Reload" toast
      // (components/pwa/pwa-updater.tsx) so the user applies it when ready.
      registerType: "prompt",
      // We register the SW ourselves via virtual:pwa-register/react (the updater
      // component) so we can drive the update/offline-ready toasts — so the
      // plugin must NOT also auto-inject a registration script.
      injectRegister: false,
      includeAssets: ["favicon.ico"],
      // Per-tenant PWA: the manifest is served dynamically by the API from the
      // tenant's branding (src/routes/pwa.js). Subdomain-per-tenant = one origin
      // per tenant, so /manifest.webmanifest + /icons/* resolve by Host. The link
      // tag is added manually in index.html since the plugin emits none here.
      manifest: false,
      workbox: {
        // Without this, clicking "Reload" in the update toast can silently do
        // nothing (or only take effect much later). The click sends SKIP_WAITING
        // to the new SW, which activates — but activating alone does not hand it
        // control of the ALREADY-OPEN tab. pwa-updater.tsx's reload is gated on
        // the browser's `controllerchange` event, which only fires for this tab
        // once the new SW calls `clients.claim()` in its activate handler.
        // `clientsClaim: true` makes that happen the moment the user clicks, so
        // control (and the reload) follow within the same tick. This is separate
        // from `skipWaiting`, which we deliberately leave off: that would make
        // every new build auto-activate on install, before the user consents —
        // exactly the forced-reload-mid-task behavior "prompt" mode exists to
        // avoid (see the file-level comment above).
        clientsClaim: true,
        // Cache the app shell for offline; never precache the dynamic manifest.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /^\/api/,
          /^\/media/,
          /^\/manifest\.webmanifest$/,
          /^\/icons\//,
        ],
        // woff2 is NOT precached. The glob used to include it, which was right
        // when one family was bundled and became wrong the moment fifteen were:
        // the service worker would have downloaded all 94 files — 2.8 MB — on
        // install, for every user, to serve the three a tenant actually uses.
        // That is precisely the eager cost the lazy library exists to avoid,
        // and it would have been paid on the metered mobile connections this
        // PWA is built for.
        globPatterns: ["**/*.{js,css,html,svg}"],
        // Fonts are cached on first use instead. A family is written to the
        // cache the first time text is actually rendered in it, so the offline
        // promise still holds for the fonts a user has in force (audit F17) —
        // it is just earned on first paint rather than prepaid for all fifteen.
        // One year, 60 entries: comfortably more than the library, and the
        // hashed filenames make staleness impossible.
        runtimeCaching: [
          {
            urlPattern: ({ request }: { request: Request }) =>
              request.destination === "font",
            handler: "CacheFirst",
            options: {
              cacheName: "praxis-fonts",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Brand media — the logo, the login hero, the favicon (and any other
          // image the app served, e.g. avatars). Cached on first view so the
          // OFFLINE screen shows the tenant's identity rather than broken image
          // frames: appearance-cache restores the brand's colours and NAME from
          // localStorage, but the logo and hero are /media files, and a cached
          // <Branding> pointing at an uncached image is still a stranger's page.
          //
          // StaleWhileRevalidate, not CacheFirst: /media URLs are NOT
          // content-hashed (a tenant re-uploads a logo to the same path), so the
          // cache must refresh in the background on the next online load while
          // still serving instantly — and offline — from what it has.
          {
            urlPattern: ({ request }: { request: Request }) =>
              request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "praxis-media",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Add web-push display handlers (push + notificationclick) to the
        // generated SW without switching to a fully custom injectManifest SW.
        // push-handler.js lives in client/public/ so it's served at the root.
        importScripts: ["/push-handler.js"],
      },
    }),
  ],
  // @praxis/shared is a LINKED CommonJS package. Linked packages are not
  // pre-bundled by default, and without pre-bundling the dev server serves its
  // raw `require()` / `module.exports` straight to the browser —
  // build.commonjsOptions is build-only and does nothing for `npm run dev`.
  optimizeDeps: { include: SHARED_OPTIMIZE_INCLUDE },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // @shared + zod resolve through config/shared-alias.ts, which vitest.config.ts
      // imports too — the build and the tests must not disagree about this again.
      ...sharedAlias(__dirname, "bundler"),
    },
  },
  /**
   * CHUNKING. A chunk graph must be a DAG, and a hand-drawn partition can cut a
   * cycle into one. That is not hypothetical here — it shipped, and it served
   * smartls.praxisls.com a blank page.
   *
   * The previous config split `vendor-react` (react, react-dom, react-router)
   * out of `vendor` (everything else). But react-dom needs `scheduler` and
   * react-router-dom needs `@remix-run/router`, and neither name matched the
   * react rule, so both landed in `vendor`:
   *
   *     vendor  ──── needs react ────▶  vendor-react
   *     vendor  ◀── needs scheduler ──  vendor-react
   *
   * The browser began evaluating `vendor-react`, which re-entered `vendor`
   * before React's export binding had been assigned. Rollup emits that binding
   * as a hoisted `var`, so it read `undefined` rather than throwing a TDZ error,
   * and TanStack Query's top-level `createContext` died on it:
   * "Cannot read properties of undefined (reading 'createContext')". It throws
   * during module evaluation, before React renders anything, so neither the root
   * ErrorBoundary nor the per-route one could catch it. Blank page, no message.
   *
   * The cycle was latent for as long as nothing in `vendor` touched React at
   * import time. Phase 2 added TanStack Query, Radix and React Hook Form — all
   * of which do — and it fired. The `feature-*` buckets were circular too
   * (settings → hr → wms → fleet → settings); they were next.
   *
   * THE RULE, and it is the whole strategy:
   *
   *   1. ONE manual bucket, `vendor`. A single bucket cannot import itself, so
   *      it is acyclic by construction. Do NOT split node_modules into two or
   *      more named chunks: that requires proving no edge runs backwards, and
   *      you cannot prove that against a lockfile that moves. To keep something
   *      out of the first-load payload, exclude it (ROUTE_LOCAL_VENDOR above)
   *      and let Rollup place it — never give it a bucket of its own.
   *
   *   2. App code is NOT partitioned by hand at all. Route-level React.lazy in
   *      app/app.tsx makes every screen a dynamic import, and Rollup derives
   *      those chunks from the real graph — correctly, and without a config
   *      change each time a feature area is added.
   *
   * `onwarn` makes a violation fail the build, and `npm run check:bundle`
   * re-checks the emitted artifact. Both run in CI.
   */
  build: {
    // packages/shared is CommonJS source, not a dependency — see shared-alias.ts.
    commonjsOptions: { include: SHARED_COMMONJS_INCLUDE },
    rollupOptions: {
      onwarn(warning, warn) {
        // Rollup DID warn about the cycle that blanked production — "Circular
        // chunk: vendor -> vendor-react -> vendor" was the first line of the
        // build log, and the build went green anyway. A warning nobody reads is
        // not a gate. CI runs `npm run build`, so make it fatal there.
        if (warning.code === "CIRCULAR_CHUNK") {
          throw new Error(
            `${warning.message}\n\n` +
              "A circular chunk graph ships a blank page: one chunk reads another's " +
              "exports before they are assigned. Do not add a manualChunks bucket to " +
              "resolve this — see the CHUNKING note in client/vite.config.ts.",
          );
        }
        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (ROUTE_LOCAL_VENDOR.some((pkg) => inPackage(id, pkg)))
            return undefined;
          if (isFontPackage(id)) return undefined;
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        headers: { Host: TENANT_HOST },
      },
      // Stored files (tenant logos, later documents) served by the API at /media.
      "/media": {
        target: API_TARGET,
        changeOrigin: true,
        headers: { Host: TENANT_HOST },
      },
      // Per-tenant PWA manifest + icons are served by the API, Host-resolved.
      "/manifest.webmanifest": {
        target: API_TARGET,
        changeOrigin: true,
        headers: { Host: TENANT_HOST },
      },
      "/icons": {
        target: API_TARGET,
        changeOrigin: true,
        headers: { Host: TENANT_HOST },
      },
    },
  },
});
