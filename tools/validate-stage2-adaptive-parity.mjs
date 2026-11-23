import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { equidataWorkflowEvidence } from "./native-workflow-evidence.mjs";
import { nativeCurationEvidence } from "./native-curation-evidence.mjs";

const root=process.cwd();
const workflows=equidataWorkflowEvidence(root);
const problems=[...workflows.problems];
const read=p=>readFileSync(join(root,p),"utf8");
const productionFiles=dir=>{const out=[];const walk=d=>{for(const name of readdirSync(join(root,d))){if(name==="original"||name==="archive")continue;const p=join(d,name);const st=statSync(join(root,p));if(st.isDirectory())walk(p);else if([".ts",".tsx"].includes(extname(name)))out.push(p)}};walk(dir);return out};
const frontends={
  equidata:{dir:"src/web/frontends/equidata-elite",entry:"src/web/frontends/equidata-elite/entry.tsx",css:"src/web/frontends/equidata-elite/equidata.css",ped:"src/web/frontends/equidata-elite/components.tsx"},
};
const liveOps=["search.horses","search.meta","registry.browse","registry.facets","exports.registry","horses.get","people.list","people.get","pedigree.ancestors","pedigree.descendants","pedigree.metrics","pedigree.descendantMetrics","pedigree.coefficients","pedigree.pathsToAncestor","relationships.commonAncestors","relationships.coefficients","breeding.pairingAnalysis","breeding.optimize","analytics.horseInsights","analytics.registry","quality.summary","claims.mine","claims.create","changes.mine","changes.create","auth.login","auth.logout","admin.dashboard","admin.audit","admin.quality","admin.claims","admin.reviewClaim","admin.changeRequests","admin.reviewChangeRequest","admin.horses.get","admin.horses.create","admin.horses.update","admin.horses.archive","admin.maintenance.reindex"];
const analytics=["birthYears","birthYearSummary","medianPercent","eligibleHorseCount","topParents","topSires","topDams","topRepresentedAncestorsDepth4","sourceRevision"];
const insights=["pedigree_coverage","branch_imbalance","repeated_ancestor","tail_male_line","tail_female_line","pedigree_inbreeding","descendant_reach","pedigree_integrity_warning"];
for(const [name,cfg] of Object.entries(frontends)){
  const curation=nativeCurationEvidence(root,read(`${cfg.dir}/governance.tsx`),name);problems.push(...curation.problems);
  const src=[...productionFiles(cfg.dir).map(read),workflows.source,curation.source].join("\n");
  for(const op of liveOps)if(!src.includes(op))problems.push(`${name}: missing live PlatformClient operation surface '${op}'`);
  for(const field of analytics)if(!src.includes(field))problems.push(`${name}: analytics field '${field}' is not materially represented`);
  for(const code of insights)if(!src.includes(code))problems.push(`${name}: horse insight family '${code}' is not explicitly represented`);
  const entry=read(cfg.entry),css=read(cfg.css);
  if(!entry.includes("browserAdaptiveViewport")||!entry.includes("adaptiveDataAttributes"))problems.push(`${name}: adaptive composition kernel not wired into root`);
  if(!css.includes('data-adaptive-height="short"')||!css.includes('data-adaptive-nav="compact"'))problems.push(`${name}: CSS does not consume adaptive height/navigation state`);
  const governancePath=`${cfg.dir}/governance.tsx`; const governance=read(governancePath);
  if(/(?:claims|changes|issues|audit)\.slice\(0,(?:14|18)\)/.test(governance))problems.push(`${name}: governance surface still contains arbitrary 14/18-row truncation`);
  if(!src.includes("people.list")||!src.includes("offset"))problems.push(`${name}: People directory is not server-traversable with offset paging`);
}
const adaptive=read("src/frontend-kit/adaptiveComposition.ts");
for(const token of ["usableHeight","aspectClass","navigation","composition","fitScaleForBox","visualViewport"])if(!adaptive.includes(token))problems.push(`adaptive kernel missing ${token}`);
const core=read("src/web/main.tsx"),equiPed=read(frontends.equidata.ped);
for(const [name,src] of [["Core",core],["EquiData",equiPed]])if(!src.includes("fitScaleForBox"))problems.push(`${name}: true Fit Width/Height/All helper not used`);
for(const [name,src] of [["Core",core],["EquiData",equiPed]])if(!src.includes("generation-${"))problems.push(`${name}: radial pedigree lacks generation-level semantic classing`);
// R32: the radial stage now derives its diameter from BOTH available axes
// (width and height) so tall/narrow viewports autofit without a second scroll.
const coreRadialStableWidth=core.includes("setBaseDiameter(Math.floor(Math.min(availableW,availableH,920)))")&&core.includes("const [radialZoom,setRadialZoom]=useState(1)");
if(!equiPed.includes("Math.min(el.clientWidth"))problems.push("EquiData radial pedigree no longer derives diameter from the available short axis");
if(!coreRadialStableWidth)problems.push("Core radial pedigree no longer uses the v0.42.6 stable width-derived default plus local zoom");
const equiPages=read("src/web/frontends/equidata-elite/pages.tsx");
if(!equiPages.includes("rel.atlas.connections.map")||!equiPages.includes("rel.commonAncestors.map"))problems.push("EquiData relationship analysis does not expose complete shared-ancestor/path atlas rows");
if(problems.length){console.error("Stage 2 adaptive/full-parity validation FAILED:\n"+problems.map(x=>`  ERROR ${x}`).join("\n"));process.exit(1)}
console.log(`Stage 2 adaptive/full-parity validation passed: ${liveOps.length} live client operations, ${analytics.length} analytics families/fields, all ${insights.length} horse-insight families, paged People directories, native governance, adaptive height/navigation, relationship-atlas completeness and exact pedigree fit/radial semantics are enforced across the curated external engines.`);
