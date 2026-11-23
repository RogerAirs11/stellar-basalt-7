#!/usr/bin/env node
/**
 * R43 anti-theft hardening: post-build HTML minification for dist/.
 *
 * Vite minifies JS (terser) and CSS (esbuild) but leaves emitted HTML
 * pretty-printed. This pass collapses whitespace and strips comments from
 * every emitted HTML file so the deployed markup reveals nothing about
 * source formatting.
 *
 * Safety choices (deliberate):
 *  - conservativeCollapse: never REMOVES inter-tag whitespace, only collapses
 *    runs to a single space. Aggressive removal would glue adjacent words
 *    across inline elements (e.g. "word <strong>bold</strong> word") which is
 *    especially damaging in RTL Persian prose.
 *  - keepClosingSlash + no attribute quote removal: stays byte-compatible
 *    with the CSP (no new inline style attribute shapes).
 *  - minifyJS off: production CSP forbids inline scripts, so there are none
 *    to minify; leaving it off avoids ever generating them.
 *
 * Idempotent: safe to run twice. Exits non-zero if dist/ is missing.
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { minify } from "html-minifier-terser";

const distRoot = new URL("../dist", import.meta.url).pathname;

async function* walkHtml(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkHtml(full);
    else if (entry.isFile() && entry.name.endsWith(".html")) yield full;
  }
}

async function main() {
  try {
    await stat(distRoot);
  } catch {
    console.error(`minify-html-dist: dist/ not found at ${distRoot} — run the build first.`);
    process.exit(1);
  }
  let files = 0;
  let savedBytes = 0;
  for await (const file of walkHtml(distRoot)) {
    const before = await readFile(file, "utf8");
    const after = await minify(before, {
      collapseWhitespace: true,
      conservativeCollapse: true,
      removeComments: true,
      keepClosingSlash: true,
      minifyCSS: true,
      minifyJS: false,
      caseSensitive: true,
    });
    if (after.length < before.length) {
      savedBytes += before.length - after.length;
      await writeFile(file, after);
      console.log(`minified ${file.replace(distRoot, "")} (${before.length} -> ${after.length} bytes)`);
    } else {
      console.log(`unchanged ${file.replace(distRoot, "")}`);
    }
    files += 1;
  }
  console.log(`minify-html-dist: ${files} HTML files, ${savedBytes} bytes saved`);
}

main().catch((cause) => {
  console.error("minify-html-dist failed:", cause);
  process.exit(1);
});
