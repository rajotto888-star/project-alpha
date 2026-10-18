import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@project-alpha/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      // The browser must never call localhost directly for API work in production;
      // in dev we proxy relative /api calls to the local worker.
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
});
