import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Explicit local-only preview for a pure-source export. Production still
 * requires and validates the original asset bundle. These original vector
 * illustrations are UI scaffolding, never photographs of registry horses.
 */
const ART = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#182b31"/><stop offset="1" stop-color="#46574a"/></linearGradient><radialGradient id="sun"><stop stop-color="#e8c987" stop-opacity=".32"/><stop offset="1" stop-color="#e8c987" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="800" fill="url(#sky)"/><circle cx="860" cy="250" r="290" fill="url(#sun)"/><path d="M0 580 220 350 390 490 590 310 850 560 1200 380V800H0Z" fill="#829183" opacity=".22"/><path d="M0 680Q270 500 600 650T1200 590V800H0Z" fill="#182b2b"/><g transform="translate(455 254)" fill="none" stroke="#ddc28c" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><circle cx="150" cy="140" r="135" opacity=".35"/><path d="M88 252 73 212 95 156 102 103 149 60 168 38 173 85 203 109 234 160 216 182 169 163 144 187 161 248M146 78 127 106 120 155M112 135 144 120M155 163 185 158"/><path d="M99 155Q48 150 43 220M92 169Q62 186 62 236" opacity=".5"/><circle cx="177" cy="115" r="3" fill="#ddc28c"/></g></svg>`;

export function sourcePreviewAssets(root: string): Plugin {
  const prefix = "\0horse-registry-preview-asset:";
  const knownMissing = new Set<string>();
  return {
    name: "explicit-source-preview-illustrations",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".")) return null;
      const pathname = source.split("?", 1)[0];
      if (!/\.(?:avif|webp|png|jpe?g|glb)$/i.test(pathname)) return null;
      const absolute = path.resolve(path.dirname(importer.split("?", 1)[0]), pathname);
      if (fs.existsSync(absolute)) return null;
      knownMissing.add(path.relative(root, absolute));
      return prefix + absolute;
    },
    load(id) {
      if (!id.startsWith(prefix)) return null;
      // An absent 3D model keeps the component's explicit unavailable state.
      const value = id.endsWith(".glb") ? "data:application/octet-stream;base64," : `data:image/svg+xml,${encodeURIComponent(ART)}`;
      return `export default ${JSON.stringify(value)};`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let pathname: string;
        try { pathname = decodeURIComponent((req.url ?? "").split("?", 1)[0]); }
        catch { return next(); }
        if (!pathname.startsWith("/assets/") || !/\.(?:avif|webp|png|jpe?g|svg)$/i.test(pathname)) return next();
        const absolute = path.resolve(root, "public", "." + pathname);
        if (!absolute.startsWith(path.resolve(root, "public") + path.sep) || fs.existsSync(absolute)) return next();
        knownMissing.add("public" + pathname);
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Registry-Illustrative-Asset", "source-preview");
        res.end(ART);
      });
    },
    transformIndexHtml(html) {
      // The isolated source preview uses the skins' local/system fallback
      // stacks. Do not contact a font service merely to open a fictional demo.
      // This plugin is absent from normal production builds.
      const offlineHtml = html.replace(/<link\b(?=[^>]*\bhref=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com(?:\/[^"']*)?["'])[^>]*>\s*/gi, "");
      return offlineHtml.replace(/<html(?=\s|>)/i, '<html data-source-preview="true"').replace("</body>", `<div role="region" aria-label="Preview artwork notice" style="position:fixed;inset-inline-end:12px;bottom:10px;z-index:2147483000;background:#172a2c;color:#fff;border:1px solid #9c8656;border-radius:8px;padding:6px 10px;font:11px/1.4 system-ui;pointer-events:none">Illustrative artwork · تصاویر نمایشی</div></body>`);
    },
    closeBundle() {
      if (knownMissing.size) console.info(`[source-preview] ${knownMissing.size} unavailable assets use explicitly illustrative vectors. Original production asset validation remains required.`);
    },
  };
}
