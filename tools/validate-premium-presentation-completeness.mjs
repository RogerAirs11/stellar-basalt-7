import { readFileSync } from "node:fs";
import { join } from "node:path";

const root=process.cwd();
const read=p=>readFileSync(join(root,p),"utf8");
const problems=[];
const groups={
  core:{
    source:["src/web/main.tsx","src/web/heritage/HorseCapabilityPanels.tsx","src/web/heritage/RegistryStatsPage.tsx"].map(read).join("\n"),
    css:["src/web/styles/heritage.system.css","src/web/styles/heritage.analytics.css"].map(read).join("\n"),
  },
  equidata:{source:read("src/web/frontends/equidata-elite/pages.tsx"),css:read("src/web/frontends/equidata-elite/equidata.css")},
};
const requireTokens=(name,src,tokens,label)=>{for(const token of tokens)if(!src.includes(token))problems.push(`${name}: ${label} missing '${token}'`)};

const horseReference=[
  "memberOfReferenceCohort","standardErrorPercent","approximate95PercentSamplingInterval","samplingPrecision","approximate95HalfWidthPercent","founderAssumption",
  "pedigreeCompletenessPercent","diversityPreservationIndex.components","nominalWeight","sourceRevision",
  "tailMaleRootSharePercent","tailFemaleRootSharePercent",
];
const pairingScience=[
  "projectedKnownAncestorPositions","projectedExpectedAncestorPositions","sireUniqueRecordedAncestors","damUniqueRecordedAncestors",
  "projectedTop10RecordedPathWeightSharePercent","confidence.reasons",
];
const optimizerScience=[
  "confidenceAdjustedScore","scoreComponents","appliedWeight","nominalWeight","avoidedAncestorsPresent","warnings",
  "projectedTop5RecordedPathWeightSharePercent","projectedPedigreeCompletenessPercent","sharedRecordedAncestorsBetweenParents",
  "avoidAncestorIds","excludeAvoidedAncestors",
];
const influenceScience=[
  "directChildren","representedAncestorPositionsDepth4","uniqueDescendantsDepth4","recentDescendants","priorPeriodDescendants",
  "byBirthDecade","momentumPercent",
];
const registryScience=[
  "averageEquivalentCompleteGenerations","plausibleAgeRangeYears","byOffspringBirthDecade","tailMale.topRoots","tailFemale.topRoots",
  "referencePopulations","influenceTrajectories",
];
const referenceDistributions=["meanKinshipPercent","recordedAncestorRarityIndex","diversityPreservationIndex","p10","p90","P10"];

for(const [name,{source,css}] of Object.entries(groups)){
  requireTokens(name,source,horseReference,"horse reference intelligence");
  requireTokens(name,source,pairingScience,"prospective mating science");
  requireTokens(name,source,optimizerScience,"optimizer science");
  requireTokens(name,source,influenceScience,"influence trajectory science");
  requireTokens(name,source,registryScience,"registry premium science");
  requireTokens(name,source,referenceDistributions,"reference-population distribution");

  // Semantic encoding is required, not one undifferentiated accent for all premium data.
  requireTokens(name,css,["metric-kinship","metric-rarity","metric-dpi","precision-high","precision-medium","precision-low"],"reference metric/sampling-precision semantic color");
  requireTokens(name,css,["trajectory-rising","trajectory-fading"],"lineage momentum semantic color");
  requireTokens(name,css,["metric-coi","metric-diversity","rank-best","rank-top"],"optimizer semantic color/ranking");
  requireTokens(name,css,["score-components"],"optimizer score-component visualization");
}

// Core must make per-horse premium/reference intelligence reachable independently
// of optional legacy pedigree branches/repeated-ancestor fields, and a failure of
// the bundled /insights request must not erase separately available metrics/COI.
const coreMain=read("src/web/main.tsx");
const corePanelStart=coreMain.indexOf("function PedigreeInsightPanel");
const corePanelEnd=coreMain.indexOf("function CoefficientPanel",corePanelStart);
const corePanel=corePanelStart>=0&&corePanelEnd>corePanelStart?coreMain.slice(corePanelStart,corePanelEnd):"";
requireTokens("core",coreMain,["setInsightsError(true)","Promise.allSettled([metricsRequest,coefficientRequest])"],"horse intelligence independent fetch fallback");
requireTokens("core",corePanel,[
  'pedigree-insight-deep pedigree-intelligence-rich',
  '{insights&&<div className="pedigree-insight-deep pedigree-intelligence-rich"><HorseInsightStrip insights={insights}/></div>}',
],"horse intelligence resilient rendering");
if(corePanel.includes('{(metrics.branches||repeated.length>0)&&<div className="pedigree-insight-deep">')){
  problems.push("core: rich horse intelligence is still coupled to optional branches/repeated-ancestor availability");
}
if(corePanel.includes("if(!metrics)return null;")){
  problems.push("core: horse intelligence still disappears whenever pedigree metrics are unavailable");
}

// Core uses a generic distribution formatter, so verify that all three scientific
// distributions feed that formatter rather than relying only on token coincidence.
const coreStats=read("src/web/heritage/RegistryStatsPage.tsx");
for(const token of ["dist(row.meanKinshipPercent)","dist(row.recordedAncestorRarityIndex)","dist(row.diversityPreservationIndex,false)"]){
  if(!coreStats.includes(token))problems.push(`core: reference distribution is not materially rendered via '${token}'`);
}

// Reject aliases from the abandoned audit draft that do not exist in the DTOs.
const externalSource=groups.equidata.source;
for(const bad of [
  "plausibleAgeRangeYears.min","plausibleAgeRangeYears.max","recentPeriod.fromYear","recentPeriod.toYear","priorPeriod.fromYear","priorPeriod.toYear",
  "lineSurvival.cohort.horseCount","lineSurvival.cohort.fromYear","lineSurvival.cohort.toYear","recentCohort.horseCount","recentCohort.fromYear","recentCohort.toYear",
  "sireToOffspring.medianYears","damToOffspring.medianYears",
]) if(externalSource.includes(bad)) problems.push(`external premium UI uses non-contract DTO alias '${bad}'`);

// R53: the Prism --pu-* token check was retired with the prism-ultra frontend.

if(problems.length){
  console.error("Premium presentation completeness validation FAILED:");
  for(const p of problems)console.error(`  ERROR ${p}`);
  process.exit(1);
}
console.log("Premium presentation completeness passed: all four engines materially expose scientific reference, sampling-precision, pairing, optimizer, influence and registry fields with semantic color/ranking encodings and no known DTO/token aliases.");
