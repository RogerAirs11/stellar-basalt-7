import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const root=join(process.cwd(),"src","web","frontends","equidata-elite");
const problems=[];
const production=[];
for(const file of walk(root)){
  if(file.includes(`${join("equidata-elite","original")}`))continue;
  if([".ts",".tsx"].includes(extname(file)))production.push([file,readFileSync(file,"utf8")]);
}
const combined=production.map(([,s])=>s).join("\n");
for(const forbidden of ["genomicScore","speedIndex","staminaIndex","marketValue","simulateFoal(","generateAnswer(","Solaris Vaulted","128,000+"]){
  if(combined.includes(forbidden))problems.push(`mock-only production leakage detected: ${forbidden}`);
}
if(/(?:from|import\s*\()\s*["'][^"']*original\//.test(combined))problems.push("production code imports preserved original/mock source");
if(!combined.includes("platform.breeding.pairingAnalysis"))problems.push("production Breeding Lab is not using canonical breeding analysis");
if(!combined.includes('supports("structured_search")'))problems.push("structured registry search capability is not negotiated");
if(!combined.includes('supports("pedigree_paths")'))problems.push("pedigree path capability is not negotiated");
if(!combined.includes("platform.pedigree.pathsToAncestor"))problems.push("available pedigree path API is not exposed by production EquiData");
if(!combined.includes("platform.pedigree.descendants"))problems.push("available descendant tree API is not exposed by production EquiData");
for(const marker of ["buildPedigreeTreeLayout","PedigreeRadial","edx-pedigree-edges","edx-radial-stage","visual===\"graph\"","mode===\"descendants\""]) if(!combined.includes(marker)) problems.push(`first-class pedigree visualizer missing: ${marker}`);
if(!combined.includes("featureCatalog"))problems.push("production EquiData has no complete platform feature inventory surface");
if(!combined.includes('viewMode')||!combined.includes('"list"'))problems.push("registry list/grid view support is missing");
if(!combined.includes("HorseListRow")||!combined.includes("edx-registry-list-row"))problems.push("registry list mode has regressed to card-only rendering");
if(!combined.includes("edx-detail-groups"))problems.push("canonical public horse fields are missing grouped readable presentation");
if(!combined.includes("edxQualityIssueLabel"))problems.push("canonical quality issue codes are not localized for Farsi");
if(!combined.includes('dir={view.locale!=="en"?"rtl":"ltr"}'))problems.push("full frontend RTL direction gate is missing");
if(!combined.includes('role="link"')||!combined.includes('onClick={onOpen}'))problems.push("registry horse cards are not fully clickable/openable");
if(!combined.includes('edxSexLabel')||!combined.includes('edxLifecycleLabel'))problems.push("known canonical enum labels are not localized for Farsi");
if(!combined.includes('supports("genomics")')||!combined.includes('supports("market_data")')||!combined.includes('supports("ai_assistant")'))problems.push("future/dormant capability negotiation is incomplete");
const css=readFileSync(join(root,"equidata.css"),"utf8");
if(!css.includes(".edx-year-series{height:")||!css.includes("overflow-x:auto"))problems.push("exact birth-year history lacks a bounded horizontal chart presentation");
if(!css.includes("edx-active-tab-scan")||!css.includes("edx-topnav-signal"))problems.push("selected EquiData tabs lack explicit animated state signaling");
if(problems.length){console.error("EquiData integration validation FAILED:");for(const p of problems)console.error(`  ERROR ${p}`);process.exit(1)}
console.log("EquiData integration validation passed: mock scientific/market data isolated, canonical breeding/capability gates active.");

function* walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())yield*walk(p);else if(e.isFile())yield p}}
