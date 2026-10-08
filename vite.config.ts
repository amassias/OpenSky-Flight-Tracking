import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const apiOrigin = environment.SKYTRACE_API_ORIGIN || "http://localhost:8000";

  return {
    plugins: [react()],
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
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // Libraries change far less often than the app, so they ship in one
          // chunk that stays cached across deploys. A single vendor chunk
          // cannot form an import cycle between library chunks (splitting
          // React from its consumers broke module initialisation order).
          manualChunks(id) {
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
    },
  };
});
