#!/usr/bin/env node
/* Dev harness server: serves the FEI header replica with the REAL repo CSS
 * files live (edits apply on reload). Path rewrites:
 *   /assets/*  -> public/assets/*
 *   /css/fei/* -> src/web/frontends/fei-classic/*
 *   /harness/* -> tools/dev-harness/*
 * Usage: node tools/dev-harness/serve.mjs [port]
 */
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const port = Number(process.argv[2] || 4180);
const types = { ".html": "text/html", ".css": "text/css", ".woff2": "font/woff2", ".webp": "image/webp", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

function resolvePath(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (p === "/" || p === "/harness" || p === "/harness/") return path.join(root, "tools/dev-harness/index.html");
  if (p.startsWith("/harness/")) return path.join(root, "tools/dev-harness", p.slice("/harness/".length));
  if (p.startsWith("/css/fei/")) return path.join(root, "src/web/frontends/fei-classic", p.slice("/css/fei/".length));
  if (p.startsWith("/assets/")) return path.join(root, "public/assets", p.slice("/assets/".length));
  if (/^\/[a-z0-9-]+\.html$/.test(p)) return path.join(root, "tools/dev-harness", p.slice(1));
  return null;
}

http.createServer((req, res) => {
  const file = resolvePath(req.url);
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("harness: not found " + req.url);
    return;
  }
  res.writeHead(200, {
    "content-type": types[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`FEI header harness: http://127.0.0.1:${port}/  (root: ${root})`));
