import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    // Private dev server: this computer only (IPv4 loopback, so http://localhost:3000 always
    // connects), Host header checked, no cross-origin access — other websites can't reach /api.
    host: "127.0.0.1",
    port: 3000,
    // Frontend code calls relative /api/*; the FastAPI dev server runs on 8001.
    proxy: {
      "/api": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
});
