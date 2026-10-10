import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

// v3 runs on 5180 on the sandbox (v2 keeps 5174). /api goes to VITE_API_TARGET: the sandbox
// nginx (http://nginx:80 inside compose, http://127.0.0.1:8060 from the host) or gunicorn in CI.
// Never 127.0.0.1:8000 on this VM: that port is Bahikhata production.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    host: process.env.VITE_DEV_HOST || "127.0.0.1",
    port: Number(process.env.VITE_DEV_PORT || 5180),
    strictPort: true,
    proxy: { "/api": { target: process.env.VITE_API_TARGET || "http://127.0.0.1:8060" } },
  },
});
