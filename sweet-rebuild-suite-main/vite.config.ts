import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Dev ports live in the environment, not in this file. CI starts Django on
  // 8000 and expects Vite on 8080, so those stay the defaults; put your own
  // preference in sweet-rebuild-suite-main/.env.local (gitignored):
  //   VITE_DEV_PORT=5001
  //   VITE_API_TARGET=http://127.0.0.1:5002
  const env = { ...process.env, ...loadEnv(mode, __dirname, "") };
  const apiTarget = env.VITE_API_TARGET || "http://127.0.0.1:8000";
  return ({
  server: {
    host: "::",
    port: Number(env.VITE_DEV_PORT) || 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/media": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Pin PostCSS config path — without this, Vite walks up to the repo root
  // and finds an orphaned postcss.config.js from the old webpack frontend
  // that references tailwindcss not installed at the repo root.
  css: {
    postcss: path.resolve(__dirname, "./postcss.config.js"),
  },
  build: {
    rollupOptions: {
      output: {
        // Group heavy vendor libs into separate chunks so the user only
        // pays for them when they visit a page that uses them.
        // recharts is on every dashboard/reports page, framer-motion is
        // everywhere — keep them in the main chunk. The PDF stack
        // (pdf-lib, @react-pdf/renderer, jszip) is only used by
        // BatchPrint/BulkPDF; QR by InvoiceDetail + QRScanner; xlsx by
        // import/export paths. Splitting these saves ~1.5 MB from the
        // initial bundle on most page loads.
        manualChunks: {
          "vendor-pdf": ["pdf-lib", "@react-pdf/renderer", "jszip"],
          "vendor-qr": ["qrcode", "html5-qrcode"],
          "vendor-charts": ["recharts"],
        },
      },
    },
    // Existing chunk size warning at 500 kB was firing on the single
    // mega-bundle. With manualChunks + lazy routes, individual chunks
    // are well under this — bump to 800 to silence the vendor-charts
    // warning (recharts is ~250 kB minified, near the threshold).
    chunkSizeWarningLimit: 800,
  },
});
});
