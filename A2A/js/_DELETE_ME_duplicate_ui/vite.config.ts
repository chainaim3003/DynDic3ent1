import { defineConfig } from "vite";
import react           from "@vitejs/plugin-react";

// LegentPro Dashboard — Vite dev server config.
// Runs on http://localhost:5173 and proxies /api/* to the buyer agent on
// http://localhost:9090 so the React code never has to know the port.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:9090",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
