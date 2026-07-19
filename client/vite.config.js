import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
// Dev proxy: the SPA calls /api/* and Vite forwards to the Node API. `changeOrigin`
// + the Host header rewrite make tenant resolution work locally without editing
// your hosts file — the backend resolves the tenant from Host (see doc/SETUP.md).
// Set VITE_TENANT_HOST to the tenant you provisioned (e.g. smartls.praxisls.com).
var API_TARGET = process.env.VITE_API_TARGET || "http://localhost:8080";
var TENANT_HOST = process.env.VITE_TENANT_HOST || "smartls.praxisls.com";
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["favicon.ico"],
            // Per-tenant PWA: the manifest is served dynamically by the API from the
            // tenant's branding (src/routes/pwa.js). Subdomain-per-tenant = one origin
            // per tenant, so /manifest.webmanifest + /icons/* resolve by Host. The link
            // tag is added manually in index.html since the plugin emits none here.
            manifest: false,
            workbox: {
                // Cache the app shell for offline; never precache the dynamic manifest.
                navigateFallback: "/index.html",
                navigateFallbackDenylist: [/^\/api/, /^\/media/, /^\/manifest\.webmanifest$/, /^\/icons\//],
                globPatterns: ["**/*.{js,css,html,svg,woff2}"],
            },
        }),
    ],
    resolve: {
        alias: { "@": path.resolve(__dirname, "src") },
    },
    build: {
        rollupOptions: {
            output: {
                /**
                 * Split the bundle so no single chunk dominates (the build warned that
                 * chunks exceeded 500 kB once both streams' screens landed in one file).
                 * Vendors are separated from app code — they change rarely, so browsers
                 * keep them cached across deploys — and the heaviest feature areas get
                 * their own chunks. NOTE: routes are still imported eagerly in app.tsx,
                 * so this improves caching + parallel download, not first-load bytes;
                 * route-level React.lazy is the follow-up for that.
                 */
                manualChunks: function (id) {
                    if (id.includes("node_modules")) {
                        // React + router kept together deliberately: splitting them can
                        // surface module init-order issues for no real caching gain.
                        if (id.includes("react-router") || /[\\/]react(-dom)?[\\/]/.test(id))
                            return "vendor-react";
                        if (id.includes("recharts") || id.includes("d3-"))
                            return "vendor-charts";
                        return "vendor";
                    }
                    // The Control Tower mock is ~1.4k lines of raw html/css/js strings.
                    if (id.includes("features/dashboard-mock"))
                        return "dashboard-mock";
                    var m = /[\\/]src[\\/]features[\\/]([^\\/]+)[\\/]/.exec(id);
                    if (m) {
                        var area = m[1];
                        if (["finance", "sales", "commercial", "vault", "hr", "wms", "fleet", "operations", "procurement", "costing", "comms", "ai-control", "settings"].includes(area)) {
                            return "feature-".concat(area);
                        }
                    }
                    return undefined;
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
