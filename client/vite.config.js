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
            manifest: {
                name: "Praxis LS",
                short_name: "Praxis LS",
                description: "Praxis LS — logistics & accounting platform",
                theme_color: "#0b1220",
                background_color: "#ffffff",
                display: "standalone",
                start_url: "/",
                icons: [
                    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
                    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
                    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
                ],
            },
        }),
    ],
    resolve: {
        alias: { "@": path.resolve(__dirname, "src") },
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
        },
    },
});
