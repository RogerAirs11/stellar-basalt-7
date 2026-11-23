#!/usr/bin/env node
/** R117-20 — provable dead-rule removal for the FEI layers (report + --prune).
 *
 * A rule is REMOVED only when every class token in its selector is absent as a
 * substring from the built application oracle:
 *   - dist/client/assets/*.js  (every className string the app can render,
 *     including dynamically composed names — substring match is deliberately
 *     over-conservative so composed names survive);
 *   - dist/client/*.html and dist/client/f/** (server-served markup);
 *   - tools/dev-harness/*.frag.html + build.mjs template (the standalone
 *     header harness still renders captured donor fragments).
 *
 * Element/universal/attribute selectors without class tokens are NEVER removed
 * (too broad to prove dead). @keyframes/@font-face blocks are never touched.
 * Default mode only reports; --prune rewrites the stylesheets removing exactly
 * the reported rule spans (byte-for-byte outside the removed spans).
 *
 * After pruning, re-run: the build, tools/fei-css-layer-map.mjs, and the
 * R117-13 navigation matrix (tools/test-r117-nav-matrix.mjs).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prune = process.argv.includes("--prune");
const cssDir = join(root, "src/web/frontends/fei-classic");
const entry = readFileSync(join(cssDir, "entry.tsx"), "utf8");
const importedFiles = [...entry.matchAll(/import\s+"\.\/([^"]+\.css)"/g)].map((m) => m[1]);

// ---------- Oracle ----------
const oracleChunks = [];
function collect(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (/\.(js|html)$/.test(e.name)) oracleChunks.push(readFileSync(p, "utf8"));
  }
}
collect(join(root, "dist/client"));
collect(join(root, "tools/dev-harness"));
if (!oracleChunks.length) {
  console.error("Oracle is empty — run `npm run build` first. Refusing to analyze.");
  process.exit(1);
}
const oracle = oracleChunks.join("\n");

// ---------- Line-aware rule scan ----------
function findMatching(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function splitSelectors(prelude) {
  const out = [];
  let depth = 0, current = "";
  for (const ch of prelude) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(current.trim()); current = ""; }
    else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}
function lineAt(text, pos) { return text.slice(0, pos).split("\n").length; }

function scanFile(name) {
  const path = join(cssDir, name);
  const text = readFileSync(path, "utf8");
  const dead = [];
  const keep = []; // [start, end) spans to KEEP (all non-dead content is preserved by span removal)
  function walk(start, end) {
    let i = start;
    while (i < end) {
      const open = text.indexOf("{", i);
      if (open < 0 || open >= end) break;
      const preludeStart = i;
      const prelude = text.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const close = findMatching(text, open);
      if (close < 0) break;
      const ruleEnd = close + 1;
      if (prelude.startsWith("@media") || prelude.startsWith("@supports")) {
        walk(open + 1, close); // descend; the @media block itself always stays
      } else if (prelude.startsWith("@keyframes") || prelude.startsWith("@font-face") || prelude.startsWith("@layer") || prelude.startsWith("@container") || !prelude) {
        // never touch
      } else {
        // Split the prelude on top-level commas only (paren-aware: :is(a,b)
        // and :not(a,b) stay intact), then decide per RULE: a rule leaves the
        // file only when EVERY selector fragment is provably dead.
        const fragments = splitSelectors(prelude);
        const fragmentDead = fragments.map((selector) => {
          const tokens = [...selector.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]);
          if (!tokens.length) return false; // element/attr selectors: not provable, keep
          return tokens.every((t) => !oracle.includes(t));
        });
        if (fragments.length && fragmentDead.every(Boolean)) {
          dead.push({
            selector: fragments.join(", "),
            startLine: lineAt(text, preludeStart),
            endLine: lineAt(text, ruleEnd),
            // The span runs from the first non-space char of the prelude to the
            // closing brace; trailing newline consumed so the line disappears.
            start: preludeStart + (text.slice(preludeStart, open).length - text.slice(preludeStart, open).trimStart().length),
            end: ruleEnd,
          });
        }
      }
      i = ruleEnd;
    }
  }
  walk(0, text.length);
  return { path, text, dead };
}

let totalRemoved = 0, totalChars = 0;
const perFile = [];
for (const name of importedFiles) {
  const { path, text, dead } = scanFile(name);
  perFile.push({ name, dead });
  if (!dead.length) continue;
  // Merge spans (multi-selector lines can yield overlapping spans).
  const spans = dead.map((d) => [d.start, d.end]).sort((a, b) => a[0] - b[0]);
  const merged = [spans[0]];
  for (const s of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push(s);
  }
  console.log(`${name}: ${dead.length} dead selectors (${merged.length} spans)`);
  for (const d of dead) console.log(`  L${d.startLine}-${d.endLine}  ${d.selector.slice(0, 110)}`);
  if (prune) {
    let out = "", cursor = 0;
    for (const [s, e] of merged) { out += text.slice(cursor, s); cursor = e; if (text[cursor] === "\n") cursor++; }
    out += text.slice(cursor);
    totalChars += text.length - out.length;
    writeFileSync(path, out);
    totalRemoved += dead.length;
  }
}
console.log(prune ? `\nPruned ${totalRemoved} dead selectors (~${totalChars} bytes) from ${importedFiles.length} active layers.` : "\nReport-only mode. Re-run with --prune to remove the listed rules.");
if (!prune && process.env.REQUIRE_REPORT_JSON) {
  writeFileSync(process.env.REQUIRE_REPORT_JSON, JSON.stringify(perFile.map((f) => ({ file: f.name, deadSelectors: f.dead.map((d) => ({ selector: d.selector, line: d.startLine })) })), null, 2));
}
