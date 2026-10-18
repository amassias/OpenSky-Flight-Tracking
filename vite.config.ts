import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { readFileSync } from "node:fs";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const apiOrigin = environment.SKYTRACE_API_ORIGIN || "http://localhost:8000";

  return {
    plugins: [react(), {
      name: "aircraft-sprite",
      // One shared vector sprite in the initial document: no model requests,
      // duplicated path geometry per marker, or geometry in the JS entry.
      transformIndexHtml(html) {
        const sprite = readFileSync(new URL("./src/assets/aircraft/models/sprites.svg", import.meta.url), "utf8");
        return html.replace("</body>", `${sprite}</body>`);
      },
    }],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: apiOrigin, changeOrigin: true },
        "/aircraft.svg": { target: apiOrigin, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
      chunkSizeWarningLimit: 1000, // the on-demand maplibre chunk is about 940 kB raw (ADR 0009)
      rollupOptions: {
        output: {
          // Libraries change far less often than the app, so they ship in one
          // chunk that stays cached across deploys. A single vendor chunk
          // cannot form an import cycle between library chunks (splitting
          // React from its consumers broke module initialisation order).
          //
          // MapLibre GL is the one exception (ADR 0009): it is about as large
          // as everything else together, imports nothing from the other
          // libraries, and is only needed once a view holds more than 750
          // aircraft, so it loads on demand instead of in the first paint.
          manualChunks(id) {
            if (id.includes("/node_modules/maplibre-gl/") || id.includes("/node_modules/@mapbox/") || id.includes("/node_modules/@maplibre/")) return "maplibre";
            return id.includes("/node_modules/") ? "vendor" : undefined;
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      include: ["src/**/*.test.{ts,tsx}"],
      css: true,
      testTimeout: 15_000,
    },
  };
});
