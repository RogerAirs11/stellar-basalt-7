import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const heritageAnalytics = readFileSync(join(root,"src","web","styles","heritage.analytics.css"),"utf8");
const heritageSystem = readFileSync(join(root,"src","web","styles","heritage.system.css"),"utf8");
const heritageTokens = readFileSync(join(root,"src","web","styles","heritage.tokens.css"),"utf8");
const heritageColor = readFileSync(join(root,"src","web","styles","heritage.color.css"),"utf8");
const heritageFinal = readFileSync(join(root,"src","web","styles","heritage.final.css"),"utf8");
const heritageRefinement = readFileSync(join(root,"src","web","styles","heritage.refinement.css"),"utf8");
const heritageMotion = readFileSync(join(root,"src","web","styles","heritage.motion.css"),"utf8");
const heritageNavigation = readFileSync(join(root,"src","web","styles","heritage.navigation.css"),"utf8");
const heritageMaterial = readFileSync(join(root,"src","web","styles","heritage.material.css"),"utf8");
const heritageLighting = readFileSync(join(root,"src","web","styles","heritage.lighting.css"),"utf8");
const heritageAppearance = readFileSync(join(root,"src","web","styles","heritage.appearance-studio.css"),"utf8");
const equidataCss = readFileSync(join(root,"src","web","frontends","equidata-elite","equidata.css"),"utf8");
const equidataPages = readFileSync(join(root,"src","web","frontends","equidata-elite","pages.tsx"),"utf8");
const heritageMain = readFileSync(join(root,"src","web","main.tsx"),"utf8");
const hostCss = readFileSync(join(root,"src","web","styles","app.css"),"utf8");
const problems=[];

// New Heritage surfaces must consume the canonical frontend design-system fonts,
// never the old host aliases that can fall through to OS-default Persian glyphs.
for (const legacy of ["var(--serif)","var(--sans)","var(--mono)"]) {
  if (heritageAnalytics.includes(legacy)) problems.push(`Heritage analytics uses legacy typography alias ${legacy}`);
}
for (const token of ["--h-font-display","--h-font-ui","--h-font-numeric"]) {
  if (!heritageSystem.includes(token)) problems.push(`Heritage canonical typography token missing: ${token}`);
  if (!heritageAnalytics.includes(`var(${token})`)) problems.push(`Heritage analytics does not consume canonical token: ${token}`);
}
if (!heritageAnalytics.includes('data-locale="fa"')) problems.push("Heritage analytics has no explicit Persian typography guard");
if (!heritageAnalytics.includes("stats-card.tone-")) problems.push("Heritage analytics lacks panel-scale semantic tone encoding");
for (const token of ["--h-info","--h-success","--h-warning","--h-danger"]) if (!heritageSystem.includes(token)) problems.push(`Heritage semantic token missing: ${token}`);

// Heritage glass is deliberately a three-degree semantic system. Prevent
// future patches from drifting back to one-off opacity/blur values for the
// canonical surface families. Registry transparency is intentional; readability comes from text edging.
for (const token of ["--h-frost-1-bg","--h-frost-2-bg","--h-frost-3-bg","--h-frost-1-blur","--h-frost-2-blur","--h-frost-3-blur"]) {
  if (!heritageSystem.includes(token)) problems.push(`Heritage frost token missing: ${token}`);
}
for (const mapping of [
  "--h-glass-panel:var(--h-frost-1-bg)",
  "--h-glass-card:var(--h-frost-2-bg)",
  "--h-popover-bg:var(--h-frost-3-bg)",
]) if (!heritageSystem.includes(mapping)) problems.push(`Heritage frost alias mapping missing: ${mapping}`);
for (const utility of [".h-glass-1", ".h-glass-2", ".h-glass-3"]) if (!heritageSystem.includes(utility)) problems.push(`Heritage frost utility missing: ${utility}`);
const lightBrowsePanel = heritageSystem.match(/:root\[data-frontend="heritage"\]\[data-mode="light"\]\[data-glass="1"\]\[data-page="browse"\]\s+\.table-panel\s*\{[\s\S]*?\}/)?.[0] ?? "";
if (!lightBrowsePanel.includes("var(--h-registry-frost-light)")) problems.push("Heritage light Registry outer table shell must use the dedicated readable glass token --h-registry-frost-light when glass is enabled");
if (!heritageSystem.includes('[data-glass="0"]') || !heritageSystem.includes("backdrop-filter:none")) problems.push("Heritage glass-off mode is not explicitly enforced");
if (!heritageMain.includes("ped-edge-flow") || heritageMain.includes('className={`ped-edge ${classes}`}') || heritageMain.includes('className={`ped-edge-spark ${classes}`}') || heritageMain.includes("ped-family-connector")) problems.push("Heritage pedigree connectors must use the v0.42.16 single moving dashed per-relationship path contract");
if (!heritageMain.includes("RadialPedigree")) problems.push("Heritage circular/radial pedigree visualizer is missing");
if (!heritageMain.includes("insight-code-${item.code}")) problems.push("Heritage insight tiles lack semantic code classes for systematic tinting");
if (!heritageSystem.includes(".horse-insight-strip") || !heritageSystem.includes(".horse-insight{")) problems.push("Heritage insight summaries are not boxed through the canonical surface system");
for (const token of ["--h-text-edge-strong","--h-surface-tint","--h-sire","--h-dam","--h-accent-data"]) if (!heritageSystem.includes(token)) problems.push(`Heritage semantic/readability token missing: ${token}`);
if (!heritageSystem.includes(".table-toolbar") || !heritageSystem.includes("var(--h-frost-2-bg)")) problems.push("Heritage Registry working controls do not consume Frost 2");
for (const token of ["--h-data-quality-label","--h-data-quality-meta"]) if (!heritageAnalytics.includes(token)) problems.push(`Heritage Data Quality typography token missing: ${token}`);
if (!heritageAnalytics.includes('#stats-quality :is(.stats-coverage-row>span')) problems.push("Heritage Data Quality block lacks explicit canonical typography guard");
if (!heritageAnalytics.includes("--h-surface-fill")) problems.push("Heritage analytics semantic tinting is flattened by Frost instead of compositing with it");
// Analytics typography is tokenized: raw component-local pixel sizes are forbidden.
// Token declarations themselves may use px, but rendered font-size/font shorthand must consume tokens.
if (/font-size\s*:\s*[0-9.]+px/i.test(heritageAnalytics)) problems.push("Heritage analytics contains raw component font-size pixels instead of typography tokens");
if (/font\s*:\s*[^;{}]*\b[0-9.]+px\b/i.test(heritageAnalytics)) problems.push("Heritage analytics contains raw font shorthand pixels instead of typography tokens");
for (const [token,minPx] of [["--h-data-quality-label",14],["--h-data-quality-meta",13]]) {
  const match=heritageAnalytics.match(new RegExp(`${token}\\s*:\\s*([0-9.]+)px`));
  if (!match || Number(match[1]) < minPx) problems.push(`Heritage Data Quality typography regressed below ${minPx}px: ${token}`);
}
// Map and Lineage deliberately use different composition grammars. Map is a
// compact horizontal generation graph; only Lineage centers the focal horse
// above sire/dam branches. This separation prevents the v0.42.3 long-trunk bug.
if (heritageMain.includes("PED_ROOT_GAP")) problems.push("Heritage pedigree reintroduced a dedicated focal-horse gap constant");
if (!heritageMain.includes("const width=PED_SIDE*2+PED_NODE_W+maxGeneration*PED_COL_STEP")) problems.push("Heritage Map no longer uses compact horizontal generation geometry");
if (!heritageMain.includes("return PED_SIDE+generation*PED_COL_STEP")) problems.push("Heritage Map generation columns are no longer evenly packed");
if (!heritageMain.includes('className="ped-ledger-root-head"')) problems.push("Heritage Lineage focal header missing");
if (!heritageMain.includes('ped-ledger-root-branches${layout.ancestorMode?" ancestry":" descendants"}')) problems.push("Heritage Lineage focal-above-parent branch grouping missing");


// Core Consolidation v1: the Heritage design kernel is semantic and variable-only.
// Validators intentionally check live roles and reject dead token declarations instead
// of preserving historical Hotfix-number contracts.
if (!heritageTokens.includes("Heritage design-token kernel — Core Consolidation v1")) problems.push("Heritage active semantic design-token kernel missing");
if (heritageTokens.includes("@keyframes") || /\.[\w-]+\s*\{/.test(heritageTokens.replace(/html:root[^\{]*\{/g,""))) problems.push("Heritage token kernel contains component behavior instead of variables only");
for (const token of ["--h-ds-radius-panel","--h-ds-radius-workspace","--h-ds-frost-major-max","--h-ds-frost-panel-max","--h-ds-transition-base","--h-ds-ease-standard","--h-ds-nav-inactive-opacity","--h-ds-workspace-rim"]) if (!heritageTokens.includes(token)) problems.push(`Heritage active design role missing: ${token}`);
const heritageActiveCss=[heritageTokens,heritageSystem,heritageColor,heritageAnalytics,heritageFinal,heritageRefinement,heritageMotion,heritageNavigation,heritageMaterial,heritageLighting,heritageAppearance].join("\n");
const heritageDsTokens=[...new Set([...heritageTokens.matchAll(/(--h-ds-[\w-]+)\s*:/g)].map(match=>match[1]))];
for(const token of heritageDsTokens) if(heritageActiveCss.split(token).length-1<2) problems.push(`Heritage orphaned design token: ${token}`);
for (const ceiling of ["--h-ds-frost-major-max:64px","--h-ds-frost-panel-max:50px","--h-ds-frost-control-max:36px","--h-ds-frost-card-max:30px"]) if (!heritageTokens.includes(ceiling)) problems.push(`Heritage true-frost ceiling missing: ${ceiling}`);
if (!heritageFinal.includes("var(--h-ds-frost-major-max)") || !heritageFinal.includes("var(--h-ds-frost-card-max)")) problems.push("Heritage terminal frost ladder bypasses active design tokens");
if (!heritageRefinement.includes("--h-ds-owner-blur:var(--h-terminal-major-blur)") || !heritageRefinement.includes("--h-ds-owner-blur:var(--h-terminal-panel-blur)")) problems.push("Heritage major/panel material roles are not centrally owned");
if (heritageRefinement.includes("@keyframes")) problems.push("Heritage optical refinement defines animation instead of consuming motion channels");
if (!heritageMain.includes('import "./styles/heritage.system.css";\nimport "./styles/heritage.tokens.css";\nimport "./styles/heritage.color.css";\nimport "./styles/heritage.analytics.css";\nimport "./styles/heritage.final.css";\nimport "./styles/heritage.motion.css";\nimport "./styles/heritage.navigation.css";\nimport "./styles/heritage.refinement.css";\nimport "./styles/heritage.material.css";\nimport "./styles/heritage.lighting.css";')) problems.push("Heritage design-system import/layer order is not canonical");
if (heritageRefinement.includes("var(--h-sire)") || heritageRefinement.includes("var(--h-dam)")) problems.push("Optical refinement must not repurpose reserved pedigree sex colors");

// R53: the Q8/Aspnama and Prism Ultra design-system blocks were retired together
// with those frontends (owner catalogue consolidation). The curated set is Core,
// EquiData, Retro Astra, FEI Classic and Classic Registry.

// Preserve the named typefaces and usable local/system fallbacks. Remote font
// availability must not be a prerequisite for a readable bilingual interface.
for (const family of ["Orbitron","Rajdhani","Vazirmatn","Noto Kufi Arabic"]) {
  if (!equidataCss.includes(`"${family}"`)) problems.push(`EquiData named font family missing from its declared stacks: ${family}`);
}
for (const token of ["--edx-font-display","--edx-font-body","--edx-font-fa-display","--edx-font-fa-body"]) {
  const stack = equidataCss.match(new RegExp(`${token}:([^;]+);`))?.[1] ?? "";
  if (!/ui-sans-serif\s*,\s*sans-serif/.test(stack)) problems.push(`EquiData ${token} has no usable offline system fallback`);
}
if (/@import[^;]*fonts\.googleapis\.com/i.test(equidataCss)) problems.push("EquiData typography still requires a remote Google Fonts import");
if (!equidataCss.includes("--edx-font-fa-display") || !equidataCss.includes('data-edx-locale="fa"')) problems.push("EquiData Persian typography/RTL guard is incomplete");
if (!equidataCss.includes('select option{direction:rtl;text-align:right')) problems.push("EquiData native select/dropdown RTL alignment is not explicitly guarded");
if (!equidataCss.includes('--edx-font-fa-display:"Noto Kufi Arabic"')) problems.push("EquiData futuristic Persian display stack no longer prefers Noto Kufi Arabic");
for (const token of ["--edx-font-display","--edx-font-body"]) if (!equidataCss.includes(token)) problems.push(`EquiData typography token missing: ${token}`);
for (const token of ["--edx-info","--edx-success","--edx-warning","--edx-danger","--edx-frost-1-bg","--edx-frost-2-bg","--edx-frost-3-bg","--edx-frost-1-blur","--edx-frost-2-blur","--edx-frost-3-blur"]) {
  if (!equidataCss.includes(token)) problems.push(`EquiData design token missing: ${token}`);
}
for (const usage of ["background:var(--edx-frost-2-bg)","background:var(--edx-frost-3-bg)",".edx-source-proof"]) {
  if (!equidataCss.includes(usage)) problems.push(`EquiData canonical frost consumption missing: ${usage}`);
}
for (const asset of ["hero-mane.webp","hologram-horse.webp","lineage-horse.webp","performance-horse.webp","market-horse.webp"]) {
  if (!equidataPages.includes(asset)) problems.push(`EquiData original visual asset not represented in production adapter: ${asset}`);
}
for (const landmark of ["edx-hero-console","edx-ticker","edx-truth-stats","edx-core-modules","edx-science-truth"]) {
  if (!equidataPages.includes(landmark) && !equidataCss.includes(landmark)) problems.push(`EquiData original-fidelity landmark missing: ${landmark}`);
}
if (!equidataPages.includes("DORMANT")) problems.push("EquiData unsupported disciplines are no longer visibly preserved as dormant capabilities");

// Presentation architecture must remain progressive and complete, not merely capability-declared.
if (equidataPages.includes('className="edx-filterbar"')) problems.push("EquiData primary Registry surface exposes secondary filters outside Advanced");
for (const marker of ["edx-observatory-tabs","Complete population intelligence","topRepresentedAncestorsDepth4","sexDistribution","topMainStrains","topOwners","topBreeders","dataCoverage"]) {
  if (!equidataPages.includes(marker) && !equidataCss.includes(marker)) problems.push(`EquiData Observatory parity marker missing: ${marker}`);
}
// R54: the advanced rail restructured (studio parity) — facets now live in an
// indexed rail section. The invariant is unchanged: facets render ONLY inside
// the advanced rail portal, never on the browse surface by default.
if (!/{advancedOpen&&createPortal\(/.test(heritageMain) || !heritageMain.includes("advanced-registry-rail") || !heritageMain.includes('facets&&<section className="adv-rail-section"') || !heritageMain.includes("adv-rail-facets")) problems.push("Heritage Registry facets are not collapsed behind Advanced by default");
if (!heritageAnalytics.includes("--h-data-panel:var(--h-frost-1-bg)") || !heritageAnalytics.includes("--h-data-card:var(--h-frost-2-bg)")) problems.push("Heritage analytics still bypasses canonical Frost presets");
if (!heritageSystem.includes("Heritage Frost is the rendering authority")) problems.push("Heritage core surfaces are not permanently mapped to the canonical Frost hierarchy");

if (!heritageSystem.includes(".registry-pulse")) problems.push("Heritage registry pulse is not part of the canonical glass panel system");
if (/html\[data-page="browse"\](?!\[data-frontend="heritage"\])/.test(hostCss)) problems.push("Host browse viewport lock is not scoped to Heritage and can break external frontend scrolling");

if (problems.length) {
  console.error("Frontend design-system validation FAILED:");
  for (const p of problems) console.error(`  ERROR ${p}`);
  process.exit(1);
}
console.log("Frontend design-system validation passed: Heritage uses a layered token-kernel/material/motion architecture; Q8, EquiData and Prism Ultra preserve independent tokenized visual engines; Prism adds a global OKLCH parameter kernel while EquiData mock-data isolation remains intact.");
