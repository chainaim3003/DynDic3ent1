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
    // CONT8 / M2-ε: allow Vite to read scenario JSON files from
    // A2A/js/src/shared/scenarios/ (one level up from the ui/ project root).
    // ui/src/lib/scenarios.ts uses import.meta.glob() to bundle those at
    // build time. Vite blocks reads outside fs.allow by default; explicitly
    // add the monorepo root so the cross-tree glob succeeds. This is a
    // dev-only setting; production builds bundle the JSON into the output.
    fs: {
      allow: [
        path.resolve(__dirname, ".."),
      ],
    },
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
