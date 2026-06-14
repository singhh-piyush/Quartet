import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies the demo API (and SSE) to the stdlib bridge on :8000 so the frontend can be
// served from Vite on :5173 with no CORS friction. Override with VITE_API_PORT.
const apiPort = process.env.VITE_API_PORT ?? "8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
