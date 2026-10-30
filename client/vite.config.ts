import { defineConfig } from "vite";

// In development, Vite serves the client and proxies the API + WebSocket to
// the Node server on port 3000. In production the Node server serves dist/.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
  // main.ts uses top-level await (PixiJS init), which needs an ES2022 output.
  // Every browser from 2021 on supports it, phones included.
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
