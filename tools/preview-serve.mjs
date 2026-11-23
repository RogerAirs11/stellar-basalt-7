#!/usr/bin/env node
// Production preview server for the Z.ai sandbox (R33).
//
// WHY THIS EXISTS — the user-facing preview reaches the sandbox through a
// remote gateway (Alibaba FC). Two dev-mode behaviors break that path:
//   1. Vite dev streams hundreds of unminified ES modules over the
//      high-latency link → choppy first render + choppy particle animation.
//   2. Vite's HMR websocket is periodically dropped by the gateway; the
//      client reacts by doing a FULL PAGE RELOAD → "the page keeps dying and
//      relaunching every few seconds" (user report).
// Serving the built client bundle removes BOTH problems: one hashed asset
// set, no HMR websocket, no reloads.
//
// HOW — a static file server for dist/ plus a headless Vite server running
// in middleware mode that hosts the local SQLite API plugin (it SSR-loads
// src/worker.ts from source, so API changes apply on restart without a
// client rebuild).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(root, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("[preview] dist/index.html is missing — run `node node_modules/vite/bin/vite.js build --mode sqlite` first.");
  process.exit(1);
}

const vite = await createServer({
  root,
  mode: "sqlite",
  server: { middlewareMode: true, hmr: false },
  // The client is a frozen build; nothing to watch. Keeping the watcher idle
  // saves CPU on the shared sandbox instance.
  watch: { ignored: ["**"] },
  logLevel: "warn",
});

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    // 1) API requests -> Vite middleware stack (local SQLite API plugin).
    if (url.pathname.startsWith("/api/")) {
      vite.middlewares(req, res);
      return;
    }
    // 2) Everything else: static dist/ with SPA fallback to index.html.
    let filePath = path.normalize(path.join(dist, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(dist)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    let isFile = false;
    try { isFile = fs.statSync(filePath).isFile(); } catch { isFile = false; }
    if (!isFile) {
      filePath = path.join(dist, "index.html");
      try { fs.statSync(filePath); } catch {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      // Hashed assets are immutable; the shell stays fresh for instant updates.
      "cache-control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500);
    res.end(String(error?.message ?? error));
  }
});

server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0", () => {
  console.log(`[preview] Horse Registry production build serving on http://0.0.0.0:${server.address().port}`);
  console.log("[preview] client: dist/ (built bundle) · API: local SQLite via headless Vite middleware");
});
