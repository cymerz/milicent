import { createLogger, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const baseLogger = createLogger();
const customLogger = {
  ...baseLogger,
  error(msg: string, options?: Parameters<typeof baseLogger.error>[1]) {
    const code = (options?.error as { code?: string } | undefined)?.code;
    if (
      msg.includes("ws proxy socket error") &&
      (code === "ECONNABORTED" || code === "ECONNRESET")
    ) {
      return;
    }
    baseLogger.error(msg, options);
  },
};

export default defineConfig({
  customLogger,
  plugins: [react()],
  resolve: {
    alias: {
      "@protocol": path.resolve(__dirname, "./protocol"),
      "@frontend": path.resolve(__dirname, "./frontend"),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    proxy: {
      "/api/logs": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["cache-control"] = "no-cache";
            proxyRes.headers["connection"] = "keep-alive";
          });
        },
      },
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        timeout: 180_000,
        proxyTimeout: 180_000,
      },
      "/ws": {
        target: "ws://127.0.0.1:3001",
        ws: true,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
