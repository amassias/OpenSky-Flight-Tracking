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
      rollupOptions: {
        output: {
          // Libraries change far less often than the app: separate chunks
          // stay cached across deploys and download in parallel.
          manualChunks: {
            react: ["react", "react-dom", "react-dom/client", "@tanstack/react-query"],
            map: ["leaflet", "react-leaflet"],
            motion: ["motion/react"],
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
