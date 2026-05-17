import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    // Iteration 3: moved from 8080 → 5173 because the seller agent already
    // owns 8080. 5173 is Vite's published default port; if a future tool
    // hardcodes the dashboard URL it's the well-known choice.
    port: 5173,
    strictPort: false,
    proxy: {
      // Proxy requests to buyer agent to avoid CORS issues in dev
      '/buyer-agent': {
        target: 'http://localhost:9090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/buyer-agent/, ''),
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
