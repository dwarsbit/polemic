import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// `--mode web` builds the editor for the browser: the Tauri modules the
// app imports are answered by src/web instead of the desktop app.
const webAliases = [
  { find: /^@tauri-apps\/api\/core$/, replacement: src("web/core.ts") },
  { find: /^@tauri-apps\/api\/app$/, replacement: src("web/app.ts") },
  { find: /^@tauri-apps\/plugin-dialog$/, replacement: src("web/dialog.ts") },
  { find: /^@tauri-apps\/plugin-opener$/, replacement: src("web/opener.ts") },
];

// https://vite.dev/config/
// The browser build talks to polemic-server on its own origin. In
// development the dev server passes /api on to a server running
// locally (POLEMIC_SERVER, the API's address).
const apiProxy = {
  "/api": {
    target: process.env.POLEMIC_SERVER ?? "http://localhost:4000",
    ws: true,
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],

  // The browser build is served at /projects on the services app.
  base: mode === "web" ? "/projects/" : "/",

  define: {
    __APP_VERSION__: JSON.stringify(version),
  },

  resolve: {
    alias: [
      ...(mode === "web" ? webAliases : []),
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },

  build: {
    // The desktop app bundles dist (tauri.conf.json); the browser build
    // goes next to it.
    outDir: mode === "web" ? "dist-web" : "dist",
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    proxy: mode === "web" ? apiProxy : undefined,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
