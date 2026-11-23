#!/usr/bin/env node
/** R117-20 action 2 — FEI CSS selector/token owner map + overlap analysis.
 *
 * Parses every stylesheet in src/web/frontends/fei-classic/, classifies each
 * file ACTIVE (imported by entry.tsx) or INACTIVE, and produces:
 *   - per-file layer stats (rules, declarations, !important, token vs physical values);
 *   - selector reachability against the class names actually rendered by the
 *     fei-classic components plus the shared frontend-kit components they mount
 *     (a superset scan — a selector is only reported unreachable when NONE of
 *     the component trees can render its compound class chain);
 *   - the cross-layer overlap list: properties declared for the same selector
 *     in more than one ACTIVE layer (in entry.tsx import order), with the
 *     winning layer and whether !important decides the cascade.
 *
 * Output: JSON evidence (review-r117/evidence-local/r117-20/fei-css-layer-map.json)
 * and the stable docs/FEI_CSS_LAYER_MAP.md inventory (--write-doc).
 *
 * Bounded analysis tool: it reports, it never edits. Deleting a layer remains a
 * human/agent decision re-verified by the R117-13 matrix.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cssDir = join(root, "src/web/frontends/fei-classic");

// ---------- 1. Which layers does the app actually import? ----------
const entry = readFileSync(join(cssDir, "entry.tsx"), "utf8");
const importedFiles = [...entry.matchAll(/import\s+"\.\/([^"]+\.css)"/g)].map((m) => m[1]);
const allCss = readdirSync(cssDir).filter((n) => n.endsWith(".css")).sort();

// ---------- 2. Parse each stylesheet into flat rules ----------
function parseCss(text) {
  const rules = [];
  walk(text, 0, text.length, "");
  return rules;
  function walk(text, start, end, context) {
    let i = start;
    while (i < end) {
      const open = text.indexOf("{", i);
      if (open < 0 || open >= end) break;
      const prelude = text.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const close = findMatching(text, open);
      if (close < 0) break;
      if (prelude.startsWith("@media") || prelude.startsWith("@supports")) {
        // Descend INTO the block; nested rules inherit the context.
        walk(text, open + 1, close, context ? `${context} && ${prelude}` : prelude);
      } else if (prelude.startsWith("@keyframes") || prelude.startsWith("@font-face") || prelude.startsWith("@layer") || prelude.startsWith("@container")) {
        rules.push({ selector: prelude, declarations: [], atRule: true, context });
      } else if (prelude) {
        for (const selector of splitSelectors(prelude)) {
          rules.push({ selector, declarations: splitDeclarations(text.slice(open + 1, close)), atRule: false, context });
        }
      }
      i = close + 1;
    }
  }
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
function findMatching(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function splitDeclarations(body) {
  const out = [];
  for (const chunk of body.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const decl = chunk.trim();
    if (!decl) continue;
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    out.push({ property: decl.slice(0, colon).trim(), value: decl.slice(colon + 1).trim() });
  }
  return out;
}

// ---------- 3. Class names rendered by the component trees ----------
function collectRenderedClassNames() {
  const names = new Set();
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) scan(p);
      else if (/\.(tsx|ts)$/.test(entry.name)) {
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(/className\s*=\s*"([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c) names.add(c);
        // Template-literal class chains (static chunks only; ${...} parts are
        // captured by the literal-class regexes in components elsewhere).
        for (const m of text.matchAll(/className\s*=\s*\{`([^`]+)`\}/g))
          for (const c of m[1].split(/\s+/)) if (c && /^[A-Za-z0-9_-]+$/.test(c)) names.add(c);
        for (const m of text.matchAll(/classList\.add\("([^"]+)"\)/g)) names.add(m[1]);
        // JS-driven class joins used by the vanilla classic skin are not in
        // scope here; this map covers fei-classic only.
      }
    }
  };
  scan(join(root, "src/web/frontends/fei-classic"));
  scan(join(root, "src/frontend-kit"));
  return names;
}
const renderedClasses = collectRenderedClassNames();

function selectorClassTokens(selector) {
  // Only real class selectors — pseudo-classes/functions excluded.
  return [...selector.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]);
}
function reachable(selector) {
  const tokens = selectorClassTokens(selector);
  if (!tokens.length) return true; // element/attr/universal selectors stay conservative
  return tokens.every((t) => renderedClasses.has(t));
}

// ---------- 4. Build the layer table ----------
const layers = allCss.map((name) => {
  const text = readFileSync(join(cssDir, name), "utf8");
  const rules = parseCss(text);
  const active = importedFiles.includes(name);
  const importIndex = active ? importedFiles.indexOf(name) : -1;
  let declarations = 0, important = 0, tokenValues = 0, physicalValues = 0, liveRules = 0, deadRules = 0;
  for (const rule of rules) {
    if (rule.atRule) continue;
    declarations += rule.declarations.length;
    if (reachable(rule.selector)) liveRules++;
    else deadRules++;
    for (const d of rule.declarations) {
      if (d.value.includes("!important")) important++;
      if (d.value.includes("var(")) tokenValues++; else physicalValues++;
    }
  }
  return { name, active, importIndex, rules, stats: { rules: rules.filter((r) => !r.atRule).length, declarations, important, tokenValues, physicalValues, liveRules, deadRules } };
});

// ---------- 5. Cross-layer overlap list (ACTIVE layers, import order) ----------
const activeLayers = layers.filter((l) => l.active).sort((a, b) => a.importIndex - b.importIndex);
const bySelector = new Map(); // selector -> [{layer, declarations}] in cascade order
for (const layer of activeLayers) {
  for (const rule of layer.rules) {
    if (rule.atRule) continue;
    const key = `${rule.context ? rule.context + " | " : ""}${rule.selector}`;
    if (!bySelector.has(key)) bySelector.set(key, []);
    bySelector.get(key).push({ layer: layer.name, declarations: rule.declarations, context: rule.context });
  }
}
const overlaps = [];
for (const [selector, entries] of bySelector) {
  if (entries.length < 2) continue;
  const propertyOwners = new Map();
  for (const e of entries) {
    for (const d of e.declarations) {
      if (!propertyOwners.has(d.property)) propertyOwners.set(d.property, []);
      propertyOwners.get(d.property).push({ layer: e.layer, value: d.value, important: d.value.includes("!important") });
    }
  }
  for (const [property, owners] of propertyOwners) {
    if (owners.length < 2) continue;
    const winnerImportant = owners.filter((o) => o.important);
    overlaps.push({
      selector, property, owners,
      winner: winnerImportant.length ? `${winnerImportant[winnerImportant.length - 1].layer} (!important)` : `${owners[owners.length - 1].layer} (last)`,
      duplicateValues: owners.every((o) => o.value.replace(/\s+/g, "") === owners[0].value.replace(/\s+/g, "")),
    });
  }
}
overlaps.sort((a, b) => a.selector.localeCompare(b.selector) || a.property.localeCompare(b.property));

// ---------- 6. Report ----------
const evidence = {
  generatedAt: new Date().toISOString(),
  scope: "src/web/frontends/fei-classic/*.css vs rendered classes (fei-classic components + frontend-kit)",
  renderedClassCount: renderedClasses.size,
  importOrder: importedFiles,
  layers: layers.map((l) => ({ name: l.name, active: l.active, importIndex: l.importIndex, ...l.stats })),
  unreachableRulesByLayer: Object.fromEntries(
    layers.map((l) => [l.name, l.rules.filter((r) => !r.atRule && !reachable(r.selector)).map((r) => (r.context ? `${r.context} | ${r.selector}` : r.selector))])
  ),
  crossLayerOverlaps: overlaps,
  overlapSummary: {
    selectorsWithOverlap: new Set(overlaps.map((o) => o.selector)).size,
    overlappingProperties: overlaps.length,
    identicalDuplicates: overlaps.filter((o) => o.duplicateValues).length,
    decidedByImportant: overlaps.filter((o) => o.winner.includes("!important")).length,
  },
};

const evidenceDir = join(root, "review-r117/evidence-local/r117-20");
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(join(evidenceDir, "fei-css-layer-map.json"), JSON.stringify(evidence, null, 2));

// Console digest
console.log("FEI CSS layer map — entry.tsx import order:");
for (const f of importedFiles) {
  const l = layers.find((x) => x.name === f);
  console.log(`  ACTIVE   ${f} — ${l.stats.rules} rules, ${l.stats.declarations} decls, ${l.stats.important} !important, live ${l.stats.liveRules} / dead ${l.stats.deadRules}`);
}
for (const l of layers.filter((x) => !x.active)) {
  console.log(`  INACTIVE ${l.name} — ${l.stats.rules} rules, ${l.stats.declarations} decls (never imported by entry.tsx)`);
}
console.log(`\nCross-layer overlaps (ACTIVE layers): ${evidence.overlapSummary.overlappingProperties} properties across ${evidence.overlapSummary.selectorsWithOverlap} selectors`);
console.log(`  identical duplicate declarations: ${evidence.overlapSummary.identicalDuplicates}`);
console.log(`  decided by !important: ${evidence.overlapSummary.decidedByImportant}`);
console.log(`\nEvidence: review-r117/evidence-local/r117-20/fei-css-layer-map.json`);

// ---------- 7. Stable doc (--write-doc) ----------
if (process.argv.includes("--write-doc")) {
  const doc = `# FEI CSS layer map (R117-20)

> Generated by \`node tools/fei-css-layer-map.mjs --write-doc\` — regenerate after any
> layer change; do not hand-edit the tables. Reachability is measured against the class
> names rendered by the fei-classic components and the shared frontend-kit components
> they mount (a superset scan; a selector is listed unreachable only when no scanned
> component tree can render its full class chain). "Live" therefore means *reachable
> from the scanned trees*, not "visually verified" — visual verification is the
> R117-13 navigation/density matrix (\`tools/test-r117-nav-matrix.mjs\`).

## Layer inventory (entry.tsx import order = cascade order)

| Order | Layer | Rules | Declarations | !important | var() values | Physical values | Live rules | Unreachable rules |
|---|---|---|---|---|---|---|---|---|
${importedFiles.map((f, idx) => { const s = layers.find((x) => x.name === f).stats; return `| ${idx + 1} | ${f} | ${s.rules} | ${s.declarations} | ${s.important} | ${s.tokenValues} | ${s.physicalValues} | ${s.liveRules} | ${s.deadRules} |`; }).join("\n")}

**Inactive layers (present in the directory, never imported by entry.tsx):**

${layers.filter((l) => !l.active).map((l) => { const s = l.stats; return `- ${l.name} — ${s.rules} rules, ${s.declarations} declarations, ${s.important} !important. Loaded only by the standalone header dev-harness (\`tools/dev-harness/build.mjs\`) or nothing at all.`; }).join("\n") || "- none"}

## Cross-layer property overlaps (ACTIVE layers only)

Same selector + same CSS property declared in more than one active layer. The
"winner" column is the layer that actually wins the cascade (last declaration
wins at equal specificity; !important overrides order). These rows are the
candidates for token-ownership normalization: exactly one layer should own each
property.

${overlaps.length ? `| Selector | Property | Owners (cascade order) | Winner | Identical values |\n|---|---|---|---|---|\n${overlaps.map((o) => `| \`${o.selector.replace(/\|/g, "\\|")}\` | \`${o.property}\` | ${o.owners.map((x) => x.layer.replace(".css", "")).join(" → ")} | ${o.winner.replace(".css", "")} | ${o.duplicateValues ? "yes" : "no"} |`).join("\n")}` : "No cross-layer overlaps."}

## Unreachable selectors per active layer

Selectors whose class chain no scanned component can render. Dead rules in an
ACTIVE layer are safe deletion candidates ONLY after the R117-13 matrix re-run.

${activeLayers.map((l) => { const dead = evidence.unreachableRulesByLayer[l.name] || []; return `### ${l.name}\n${dead.length ? dead.map((s) => `- \`${s.replace(/\`/g, "")}\``).join("\n") : "- none"}`; }).join("\n\n")}
`;
  writeFileSync(join(root, "docs/FEI_CSS_LAYER_MAP.md"), doc);
  console.log("Doc written: docs/FEI_CSS_LAYER_MAP.md");
}
