import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  // `vite preview` serves the optimized dist/ build — the default end-user
  // path (npm start → scripts/dev-web.mjs --prod). Keep it aligned with the
  // dev server: same host + port, strictPort so a busy port fails loudly
  // instead of silently moving. The launcher pre-resolves a free port and
  // passes --port, so this only guards against a surprise collision.
  preview: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
  },
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    // The dev server must NEVER reload because of files the app itself
    // writes during a turn. When Claude (or any provider) edits the
    // current project's HTML/asset files, that's user data — not source
    // code. Without these ignores, a single chat turn that runs five
    // Edit tool calls turns into five full page reloads, wiping the
    // chat state, the canvas status banner, the thinking placeholder,
    // and the auto-scroll position. User repro on the `shaders`
    // project: 14 page reloads in 13 minutes — the chat felt frozen
    // because every reload killed the visible feedback. The runtime
    // also writes to `.df/` (snapshots, sessions, manifests) and
    // `.df-attachments/` (uploaded images) on every turn — same story.
    watch: {
      ignored: ["**/projects/**", "**/design-systems/**", "**/.df/**", "**/.df-attachments/**"],
    },
  },
}));
