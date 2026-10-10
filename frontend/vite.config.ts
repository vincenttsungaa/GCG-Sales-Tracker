import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// https://vite.dev/config/
export default defineConfig({
  // basicSsl: serve https (self-signed) so phone browsers allow the camera for Scan — they only do on
  // https or localhost. Open https://<PC-IP>:3000 and accept the certificate warning once.
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    // Listen on the local network so phones on the same Wi-Fi can open https://<PC-IP>:3000.
    // Host header still checked. Set back to "127.0.0.1" to make it this-computer-only again.
    host: true,
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
