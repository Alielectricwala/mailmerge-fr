import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { parse } from "dotenv";

// Proxy to the API on the PORT the server reads from .env. Parsed directly: Vite's loadEnv()
// would also pick up the server's NODE_ENV=development and switch the client build to React's
// development bundle.
function serverPort(): string {
  const file = path.resolve(__dirname, ".env");
  const vars = fs.existsSync(file) ? parse(fs.readFileSync(file)) : {};
  return process.env.PORT ?? vars.PORT ?? "3010";
}

function clientPort(): number {
  const file = path.resolve(__dirname, ".env");
  const vars = fs.existsSync(file) ? parse(fs.readFileSync(file)) : {};
  const p = process.env.CLIENT_PORT ?? vars.CLIENT_PORT ?? process.env.VITE_PORT ?? vars.VITE_PORT ?? "5173";
  return parseInt(p, 10) || 5173;
}

export default defineConfig(() => {
  const apiTarget = `http://127.0.0.1:${serverPort()}`;

  return {
    plugins: [react()],
    // The root .env belongs to the server; the client needs no env vars.
    envDir: path.resolve(__dirname, "src/client"),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src/client"),
        "@shared": path.resolve(__dirname, "./src/shared"),
        "@server": path.resolve(__dirname, "./src/server"),
      },
    },
    server: {
      port: clientPort(),
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
        // Unsubscribe pages linked from emails
        "/u/": { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
      sourcemap: process.env.SOURCEMAP === "true",
      rollupOptions: {
        output: {
          // Long-lived vendor chunk so app deploys don't re-download React
          manualChunks: { vendor: ["react", "react-dom", "react-router-dom", "@tanstack/react-query", "zod"] },
        },
      },
    },
  };
});
