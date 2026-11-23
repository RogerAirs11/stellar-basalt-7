#!/usr/bin/env node
/** R117-20 — provable identical-duplicate removal across the ACTIVE FEI layers.
 *
 * For each (media-context, selector, property) declared in more than one place,
 * an EARLIER declaration is removed only when its value — including the
 * !important flag — is identical (whitespace-normalized) to the LAST
 * declaration for that key. The surviving last copy produces the same cascade
 * outcome as the removed earlier copy in every case:
 *   - identical selector text => identical specificity;
 *   - identical value+importance => whichever of the two won, the value is the same;
 *   - intermediate competing declarations are untouched.
 * Rules that become empty after removal are dropped entirely.
 *
 * Non-identical overlaps (real value conflicts, most decided by !important) are
 * NOT touched — they are documented in docs/FEI_CSS_LAYER_MAP.md as the
 * token-ownership normalization backlog.
 *
 * Default: report only. --prune rewrites the files (byte-for-byte outside the
 * removed declaration spans).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prune = process.argv.includes("--prune");
const cssDir = join(root, "src/web/frontends/fei-classic");
const entry = readFileSync(join(cssDir, "entry.tsx"), "utf8");
const importedFiles = [...entry.matchAll(/import\s+"\.\/([^"]+\.css)"/g)].map((m) => m[1]);

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
const norm = (v) => v.replace(/\s+/g, " ").trim().toLowerCase();

// Pass 1 — collect every (context, selector, property) occurrence in cascade order.
const occurrences = new Map(); // key -> [{file, ruleId, value, important}]
const rulesIndex = []; // {file, id, bodyStart, bodyEnd, decls: [{propStart, declEnd, prop, value}], context, selectors}
for (const file of importedFiles) {
  const text = readFileSync(join(cssDir, file), "utf8");
  let ruleId = 0;
  const walk = (start, end, context) => {
    let i = start;
    while (i < end) {
      const open = text.indexOf("{", i);
      if (open < 0 || open >= end) break;
      const prelude = text.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const close = findMatching(text, open);
      if (close < 0) break;
      const ruleEnd = close + 1;
      if (prelude.startsWith("@media") || prelude.startsWith("@supports")) {
        walk(open + 1, close, context ? `${context} && ${prelude}` : prelude);
      } else if (!prelude.startsWith("@")) {
        const selectors = splitSelectors(prelude);
        const bodyStart = open + 1, bodyEnd = close;
        const body = text.slice(bodyStart, bodyEnd);
        const decls = [];
        let pos = 0;
        for (const chunk of body.split(";")) {
          const decl = chunk.trim();
          if (decl) {
            const colon = decl.indexOf(":");
            if (colon > 0) {
              const prop = decl.slice(0, colon).trim();
              const value = decl.slice(colon + 1).trim();
              const chunkStart = body.indexOf(chunk, pos);
              // Removal span includes the FOLLOWING semicolon so no dangling
              // ";" is left behind (the separator belongs to the declaration).
              const declStart = chunkStart + (chunk.length - chunk.trimStart().length);
              const declEndWithSep = Math.min(bodyEnd - bodyStart, chunkStart + chunk.trimEnd().length + 1);
              decls.push({ propStart: declStart, declEnd: declEndWithSep, prop, value });
            }
          }
          pos += chunk.length + 1;
        }
        const id = rulesIndex.length;
        rulesIndex.push({ file, id: ruleId++, preludeStart: i, bodyStart, bodyEnd, decls, context, selectors, text });
        for (const selector of selectors) {
          for (const d of decls) {
            const key = `${context} | ${selector} | ${d.prop}`;
            if (!occurrences.has(key)) occurrences.set(key, []);
            occurrences.get(key).push({ file, ruleId: id, prop: d.prop, value: d.value, important: d.value.includes("!important") });
          }
        }
      }
      i = ruleEnd;
    }
  };
  walk(0, text.length, "");
}

// Pass 2 — mark earlier identical duplicates for removal.
// SAFETY: a declaration may only leave a rule when EVERY selector fragment of
// that rule has a LATER occurrence with the identical value for the same
// property — otherwise a fragment that only this rule serves would lose its
// only source (e.g. a group rule "label, .x" where the later duplicate targets
// ".x" alone must keep serving "label").
const removals = new Map(); // ruleId -> Set("prop|normvalue")
let removedCount = 0;
for (const [key, occs] of occurrences) {
  if (occs.length < 2) continue;
  const last = occs[occs.length - 1];
  for (let idx = 0; idx < occs.length - 1; idx++) {
    const o = occs[idx];
    if (norm(o.value) !== norm(last.value)) continue;
    const rule = rulesIndex[o.ruleId];
    // Every fragment of the source rule must have a later identical copy.
    const safeForAllFragments = rule.selectors.every((frag) => {
      const fragOccs = occurrences.get(`${rule.context} | ${frag} | ${o.prop}`) || [];
      const ownPos = fragOccs.findIndex((x) => x.ruleId === o.ruleId && norm(x.value) === norm(o.value));
      return fragOccs.some((x, i) => i > ownPos && norm(x.value) === norm(last.value));
    });
    if (!safeForAllFragments) continue;
    if (!removals.has(o.ruleId)) removals.set(o.ruleId, new Set());
    removals.get(o.ruleId).add(`${o.prop}|${norm(o.value)}`);
  }
}
// Resolve marks to concrete declaration indexes (first match per mark).
const plan = []; // {file, rule, declIndexes}
for (const [ruleId, marks] of removals) {
  const rule = rulesIndex[ruleId];
  const used = new Set();
  const declIndexes = [];
  for (const mark of marks) {
    const idx = rule.decls.findIndex((d, i) => !used.has(i) && `${d.prop}|${norm(d.value)}` === mark);
    if (idx >= 0) { used.add(idx); declIndexes.push(idx); }
  }
  if (declIndexes.length) { plan.push({ rule, declIndexes }); removedCount += declIndexes.length; }
}

// Report
for (const { rule, declIndexes } of plan) {
  for (const di of declIndexes) console.log(`${rule.file}: duplicate earlier declaration of "${rule.decls[di].prop}: ${rule.decls[di].value.slice(0, 60)}" in ${rule.context ? `${rule.context} | ` : ""}${rule.selectors.join(", ").slice(0, 90)}`);
}
console.log(`\n${removedCount} identical earlier declarations can be removed (rules touched: ${plan.length}).`);

// Pass 3 — prune (per file, from the end so earlier offsets stay valid).
if (prune) {
  const byFile = new Map();
  for (const p of plan) {
    if (!byFile.has(p.rule.file)) byFile.set(p.rule.file, []);
    byFile.get(p.rule.file).push(p);
  }
  for (const [file, items] of byFile) {
    const path = join(cssDir, file);
    let text = readFileSync(path, "utf8");
    // Rules were indexed against the ORIGINAL text of that file; process in
    // reverse rule order so offsets remain valid.
    items.sort((a, b) => b.rule.bodyStart - a.rule.bodyStart);
    for (const { rule, declIndexes } of items) {
      const spans = declIndexes.map((di) => [rule.decls[di].propStart, rule.decls[di].declEnd]).sort((a, b) => b[0] - a[0]);
      const body = text.slice(rule.bodyStart, rule.bodyEnd);
      let out = body;
      for (const [s, e] of spans) out = out.slice(0, s) + out.slice(e);
      // Drop rules that become empty (nothing but separators/comments/whitespace).
      const stripped = out.replace(/\/\*[\s\S]*?\*\//g, "").replace(/[;\s]/g, "");
      if (!stripped) {
        // Remove the whole rule span: from the first non-whitespace char of
        // the prelude (selector included!) to past '}', plus the following
        // newline when the remainder of the line is empty.
        let start = rule.preludeStart;
        while (start < rule.bodyStart && /\s/.test(text[start])) start++;
        let end = rule.bodyEnd + 1; // past '}'
        const nl = text.indexOf("\n", end);
        if (text.slice(end, nl < 0 ? text.length : nl).trim() === "") end = nl < 0 ? text.length : nl + 1;
        // Also swallow whitespace BEFORE the rule when the line would be left empty.
        let lineStart = text.lastIndexOf("\n", start) + 1;
        if (text.slice(lineStart, start).trim() === "") start = lineStart;
        text = text.slice(0, start) + text.slice(end);
      } else {
        text = text.slice(0, rule.bodyStart) + out + text.slice(rule.bodyEnd);
      }
    }
    writeFileSync(path, text);
    console.log(`pruned: ${file}`);
  }
}
