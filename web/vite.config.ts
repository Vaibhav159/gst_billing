import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

/**
 * The app's first download (the entry chunk) stays under 500 kB: every page past the shell loads on demand (Ruling
 * 1B-4). react-pdf is far bigger, but it comes only with the first PDF made, so Vite's own warning (any chunk) is set
 * above it, and this one watches the entry.
 */
function firstDownload(limitKb = 500): Plugin {
  return {
    name: "first-download",
    generateBundle(_options, bundle) {
      for (const c of Object.values(bundle)) {
        if (c.type === "chunk" && c.isEntry && c.code.length > limitKb * 1000) {
          this.warn(`${c.fileName} is ${Math.round(c.code.length / 1000)} kB, over the ${limitKb} kB first download (Ruling 1B-4): load the page that grew it on demand in core/router/routes.tsx.`);
        }
      }
    },
  };
}

// v3 runs on 5180 on the sandbox (v2 keeps 5174). /api goes to VITE_API_TARGET: the sandbox
// nginx (http://nginx:80 inside compose, http://127.0.0.1:8060 from the host) or gunicorn in CI.
// Never 127.0.0.1:8000 on this VM: that port is Bahikhata production. /media goes there too, as in v2.
const api = process.env.VITE_API_TARGET || "http://127.0.0.1:8060";
export default defineConfig({
  plugins: [react(), firstDownload()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    host: process.env.VITE_DEV_HOST || "127.0.0.1",
    port: Number(process.env.VITE_DEV_PORT || 5180),
    strictPort: true,
    proxy: { "/api": { target: api }, "/media": { target: api, changeOrigin: true } },
  },
  // react-pdf's own chunk (about 1.25 MB) loads only when a PDF is made; firstDownload() watches the entry
  build: { chunkSizeWarningLimit: 1300 },
});
