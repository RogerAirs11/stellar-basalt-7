import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { localSqliteApiPlugin } from "./tools/local-sqlite-vite";
import frontendReleasePolicy from "./src/web/frontendReleasePolicy.json";
import { sourcePreviewAssets } from "./tools/source-preview-assets";

function frontendReleasePolicyGuard() {
  return {
    name: "frontend-release-policy-guard",
    configResolved() {
      const active = new Set(frontendReleasePolicy.activeFrontends);
      const external = new Set(frontendReleasePolicy.activeExternalFrontends);
      if (!active.has("heritage")) throw new Error("frontend release policy must keep Heritage/Core active");
      for (const id of external) {
        if (!active.has(id)) throw new Error(`frontend release policy mismatch: '${id}' is external-active but not active`);
      }
      for (const [id, assets] of Object.entries(frontendReleasePolicy.requiredProductionAssets)) {
        if (!active.has(id)) throw new Error(`frontend release policy mismatch: asset owner '${id}' is not active`);
        for (const asset of assets) {
          for (const retiredRoot of frontendReleasePolicy.retiredPublicAssetRoots) {
            if (asset === retiredRoot || asset.startsWith(`${retiredRoot}/`)) {
              throw new Error(`active frontend asset '${asset}' is inside retired root '${retiredRoot}'`);
            }
          }
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const root = process.cwd();
  const cloudflareMode = mode === "cloudflare";
  const sourcePreview = process.env.HORSE_REGISTRY_SOURCE_PREVIEW === "1";
  if (cloudflareMode && sourcePreview) throw new Error("Source-preview illustrations are local only; restore the original artwork for a production build.");
  return {
    plugins: [
      react(),
      // R151: Tailwind 4 drives only the modern-horse external frontend's own
      // stylesheet (theme + utilities, no preflight) — Heritage CSS is untouched.
      tailwindcss(),
      sourcePreview ? sourcePreviewAssets(root) : null,
      frontendReleasePolicyGuard(),
      cloudflareMode ? cloudflare() : localSqliteApiPlugin(path.resolve(root)),
    ].filter(Boolean),
    server: {
      hmr: process.env.HORSE_REGISTRY_DEMO_MODE === "1" && process.env.HORSE_REGISTRY_UI_AUDIT === "1" ? false : undefined,
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      // Local-first default. A private sandbox proxy must opt in to its exact host;
      // never use allowedHosts:true on a development server exposing local files.
      allowedHosts: (process.env.HORSE_REGISTRY_DEV_ALLOWED_HOSTS ?? "").split(",").map(host => host.trim()).filter(Boolean),
      // Windows native fs.watch fails with EBUSY whenever a file is being written by another process
      // - atomic editors, sync tools, the harness file tools staging `.Name.<pid>.<uuid>.tmpdir/`
      // directories inside the tree. chokidar surfaces that as an unhandled FSWatcher 'error' event
      // and the whole Vite process dies, which is what repeatedly killed the dev server mid-edit.
      // Polling never calls fs.watch per file, so that entire failure mode disappears; the extra
      // ignores keep transient atomic-write artifacts out of the watch set as well.
      watch: {
        usePolling: true,
        interval: 250,
        ignored: [/.tmpdir[\\/]/, /\.tmp$/, "**/.git/**", "**/node_modules/**"],
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
    build: {
      sourcemap: false,
      target: "es2022",
      // R43 anti-theft hardening: terser with top-level mangling, multi-pass
      // compression, all comments stripped (default keeps @license banners) and
      // log-level console calls dropped. Property mangling deliberately stays
      // OFF: the app is JSON-schema driven (surface registry, appearance
      // themes), so renaming object keys would break runtime lookups.
      minify: "terser",
      terserOptions: {
        compress: {
          passes: 2,
          pure_funcs: ["console.log", "console.info", "console.debug"],
        },
        mangle: { toplevel: true },
        format: { comments: false },
      },
    },
  };
});
