/// <reference types="node" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

const backendPort = Number(process.env.VITE_BACKEND_PORT || process.env.BACKEND_PORT || 8000);
const backendTarget = `http://127.0.0.1:${backendPort}`;

export default defineConfig({
  plugins: [
    react(),
    process.env.ANALYZE === "true" ? visualizer({ open: true }) : undefined
  ].filter(Boolean),
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    hmr: {
      host: "127.0.0.1"
    },
    proxy: {
      // Proxy API calls to backend
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        secure: false
      },
      // Proxy other backend endpoints
      "/games": {
        target: backendTarget,
        changeOrigin: true,
        secure: false
      },
      "/auth": {
        target: backendTarget,
        changeOrigin: true,
        secure: false
      },
      "/downloads": {
        target: backendTarget,
        changeOrigin: true,
        secure: false
      },
      // Proxy Steam video requests to bypass CORS
      "/steam-video": {
        target: "https://video.akamai.steamstatic.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/steam-video/, ""),
        headers: {
          "Origin": "https://store.steampowered.com",
          "Referer": "https://store.steampowered.com/"
        }
      },
      "/steam-cdn": {
        target: "https://cdn.cloudflare.steamstatic.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/steam-cdn/, "")
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "ui-vendor": ["framer-motion", "lucide-react"]
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
});
