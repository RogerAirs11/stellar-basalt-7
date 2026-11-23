#!/usr/bin/env node
/** R132: self-host the Google Fonts set.
 *
 * Downloads the css2 responses for both the main app's and the Classic
 * registry's font requests (with a modern Chrome UA so the woff2 +
 * unicode-range subsets are served), downloads every referenced woff2 file
 * once, rewrites the CSS to local /fonts/ paths, and writes the merged
 * stylesheet to public/fonts/fonts.css.
 *
 * Why: the render-blocking fonts.googleapis.com stylesheet cost a
 * third-party DNS+TLS+download round trip before first paint (especially
 * slow for visitors in Iran). Same-origin fonts ride the already-open
 * HTTP/3 connection with immutable caching. The @font-face declarations
 * (families, weights, unicode-ranges, font-display: swap) stay IDENTICAL to
 * what Google served — only the source host changes.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const root = path.resolve("/home/z/my-project/repos/horse-registry");
const outDir = path.join(root, "public", "fonts");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAIN_CSS_URL = "https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,600;0,700;1,400&family=Archivo:wght@400;500;600;700&family=Cormorant+Garamond:wght@500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&family=Noto+Nastaliq+Urdu:wght@500;600;700&family=Noto+Serif+Arabic:wght@600;700&family=Vazirmatn:wght@400;500;600;700;800&display=swap";
const CLASSIC_CSS_URL = "https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@400;500;700&family=Noto+Naskh+Arabic:wght@400;500;700&family=Noto+Nastaliq+Urdu:wght@500;600;700&family=Source+Sans+3:wght@400;600;700&family=Vazirmatn:wght@400;500;600;700&display=swap";

async function fetchCss(url) {
  const response = await fetch(url, { headers: { "User-Agent": UA } });
  if (!response.ok) throw new Error(`CSS fetch failed ${response.status}: ${url}`);
  return response.text();
}

function extractFontUrls(css) {
  const urls = new Set();
  const re = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;
  let match;
  while ((match = re.exec(css))) urls.add(match[1]);
  return [...urls];
}

function fileNameFor(url) {
  const parsed = new URL(url);
  const base = path.basename(parsed.pathname); // e.g. Dxx78j6PP2D_kn2LUkAbFg.woff2
  const familyDir = path.basename(path.dirname(parsed.pathname)); // e.g. vazirmatn
  const name = base.replace(/\.woff2$/, "");
  return `${familyDir}-${name}.woff2`;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const cssMain = await fetchCss(MAIN_CSS_URL);
  const cssClassic = await fetchCss(CLASSIC_CSS_URL);

  const urls = [...new Set([...extractFontUrls(cssMain), ...extractFontUrls(cssClassic)])];
  console.log(`unique woff2 files: ${urls.length}`);

  const urlToFile = new Map();
  let totalBytes = 0;
  for (const url of urls) {
    const file = fileNameFor(url);
    const response = await fetch(url, { headers: { "User-Agent": UA } });
    if (!response.ok) throw new Error(`woff2 fetch failed ${response.status}: ${url}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 300_000) throw new Error(`suspiciously large font (${buffer.length}B): ${url}`);
    totalBytes += buffer.length;
    await writeFile(path.join(outDir, file), buffer);
    urlToFile.set(url, file);
    process.stdout.write(".");
  }
  console.log(`\ndownloaded ${urlToFile.size} files, ${(totalBytes / 1024).toFixed(0)} KB total`);

  // Rewrite both CSS docs to local paths, drop Google's comment prologues,
  // and merge (dedupe identical @font-face blocks by family+style+weight+range).
  const localize = (css) => css.replace(/url\(https:\/\/fonts\.gstatic\.com\/[^)]+\)/g, (m) => {
    const url = m.slice(4, -1);
    const file = urlToFile.get(url);
    if (!file) throw new Error(`missing mapping for ${url}`);
    return `url(/fonts/${file})`;
  });

  const blockKey = (block) => {
    const family = /font-family:\s*'([^']+)'/.exec(block)?.[1] ?? "";
    const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? "";
    const weight = /font-weight:\s*([\d ]+)/.exec(block)?.[1] ?? "";
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? "";
    return `${family}|${style}|${weight}|${range}`;
  };

  const collect = (css) => localize(css).split("@font-face").slice(1).map((body) => `@font-face${body}`.trim());
  const seen = new Map();
  for (const block of [...collect(cssMain), ...collect(cssClassic)]) {
    const key = blockKey(block);
    if (!seen.has(key)) seen.set(key, block);
  }
  const merged = `/* Self-hosted Google Fonts (R132). @font-face declarations are byte-equivalent
 * to Google's css2 responses for the app's exact family/weight requests —
 * families, unicode-ranges and font-display: swap unchanged; only the file
 * host is same-origin. Regenerate with scripts/selfhost-fonts.mjs. */
${[...seen.values()].join("\n")}
`;
  await writeFile(path.join(outDir, "fonts.css"), merged, "utf-8");
  console.log(`fonts.css: ${seen.size} @font-face blocks`);

  // Report Vazirmatn arabic/latin 400+700 files for the preload hints.
  const critical = [];
  for (const [key, block] of seen) {
    if (!key.startsWith("Vazirmatn|normal|")) continue;
    if (!/font-weight:\s*400\b|font-weight:\s*700\b/.test(block)) continue;
    const url = /url\(([^)]+)\)/.exec(block)?.[1];
    const isArabic = block.includes("U+0600");
    const isLatin = block.includes("U+0000");
    if (url && (isArabic || isLatin)) critical.push({ key, url, subset: isArabic ? "arabic" : "latin" });
  }
  console.log("critical vazirmatn files for preload:");
  for (const item of critical) console.log(`  ${item.subset}: ${item.url}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
