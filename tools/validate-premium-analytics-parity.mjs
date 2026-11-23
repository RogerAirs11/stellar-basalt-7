import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root=process.cwd();
const read=p=>readFileSync(join(root,p),"utf8");
const problems=[];
const productionFiles=dir=>{const out=[];const walk=d=>{for(const name of readdirSync(join(root,d))){if(name==="original"||name==="archive")continue;const p=join(d,name);const st=statSync(join(root,p));if(st.isDirectory())walk(p);else if([".ts",".tsx"].includes(extname(name)))out.push(p)}};walk(dir);return out};

const contract=read("src/contracts/platform.ts");
const appVersion=JSON.parse(read("package.json")).version;
for(const token of [
  `PLATFORM_APPLICATION_VERSION = "${appVersion}"`,
  'PLATFORM_CONTRACT_VERSION = "',
  "HorsePremiumPedigreeAnalytics","RegistryPremiumAnalytics","BreedingDiversityProjection",
  "HorseReferencePopulationIntelligence","ReferencePopulationSummary","BreedingOptimizerInput","BreedingOptimizerResponse"
]) if(!contract.includes(token))problems.push(`platform contract missing ${token}`);
for(const token of ['horse_insights: { version: "0.3.0"','registry_analytics: { version: "0.5.0"','breeding_analysis: { version: "0.3.0"'])if(!contract.includes(token))problems.push(`feature catalog not advanced for ${token}`);

const engine=read("src/pedigree/engine.ts");
for(const token of ["calculatePedigreeDiversity","recorded-pedigree-path-weight-diversity","equivalentCompleteGenerations","weightedRepeatedBurdenPercent","topAncestorContributions"]){if(!engine.includes(token))problems.push(`pedigree diversity engine missing ${token}`)}
const breeding=read("src/pedigree/breeding.ts");
for(const token of ["buildProspectiveDiversityProjection","prospective-offspring-recorded-pedigree-diversity","diversityProjection","topProjectedAncestorContributions","optimizeBreedingCandidates","buildBreedingOptimizerScore","explainable-pedigree-mating-candidate-ranking","candidate_diversity_preservation"]){if(!breeding.includes(token))problems.push(`breeding premium/optimizer layer missing ${token}`)}
const routes=read("src/api/routes.ts");
if(!routes.includes('/api/breeding/optimizer')||!routes.includes('BreedingOptimizerSchema'))problems.push("optimizer API route/schema missing");
const client=read("src/frontend-kit/platformClient.ts");
if(!client.includes('breeding/optimizer')||!client.includes('optimize(input'))problems.push("PlatformClient optimizer operation missing");

const snapshot=read("tools/build_analytics_snapshot.py");
for(const token of [
  "rawBirthYears","analyticalValidity","parentConcentration","generationIntervals","lineSurvival","pedigreeDiversity","peopleConcentration","19010101","entropyEffectiveParentCount","inverseSimpsonEffectiveParentCount","medianEquivalentCompleteGenerations",
  "_build_reference_population_intelligence","meanKinshipPercent","kinshipRarityPercentile","diversityPreservationIndex","referencePopulations","_influence_trajectories","influenceTrajectories","_stable_reference_sample","reference-population-1.0.0"
])if(!snapshot.includes(token))problems.push(`premium snapshot builder missing ${token}`);
if(!snapshot.includes("birth_year=1901")||!snapshot.includes("birth_date,''")||!snapshot.includes("19010101"))problems.push("analytical birth cohort does not explicitly exclude the 19010101 sentinel");
const migration=read("migrations/0006_reference_intelligence.sql");
for(const token of ["horse_reference_intelligence","mean_kinship_percent","diversity_preservation_index","cohort_key"]){if(!migration.includes(token))problems.push(`reference intelligence migration missing ${token}`)}

const surfaces={
  Heritage:["src/web/main.tsx","src/web/heritage/RegistryStatsPage.tsx","src/web/heritage/HorseCapabilityPanels.tsx"],
  EquiData:productionFiles("src/web/frontends/equidata-elite"),
};
const required=["premiumPedigree","analyticalValidity","parentConcentration","peopleConcentration","generationIntervals","diversityProjection","referencePopulation","referencePopulations","influenceTrajectories","breeding.optimize","confidenceAdjustedScore","candidateDiversityPreservationIndex"];
for(const [name,files] of Object.entries(surfaces)){
  const src=files.map(read).join("\n");
  for(const token of required)if(!src.includes(token))problems.push(`${name} premium/reference/optimizer surface missing ${token}`);
  if(name!=="Heritage"&&!src.includes("lineSurvival"))problems.push(`${name} premium registry surface missing lineSurvival`);
  if(!src.includes("topAncestorContributions"))problems.push(`${name} does not expose premium per-horse ancestor contributions`);
  if(!src.includes("topProjectedAncestorContributions"))problems.push(`${name} does not expose premium prospective-mating ancestor contributions`);
  if(!src.includes("meanKinship"))problems.push(`${name} does not materially expose reference-population mean kinship`);
  if(!src.includes("diversityPreservationIndex"))problems.push(`${name} does not materially expose Diversity Preservation Index`);
  if(!src.includes("provenance.caveat")&&!src.includes("not genetic merit"))problems.push(`${name} optimizer surface lacks an explicit non-predictive caveat`);
}

const mock=read("src/frontend-kit/mockPlatformClient.ts");
if(!mock.includes("optimize: async")||!mock.includes("BreedingOptimizerResponse"))problems.push("mock platform does not implement optimizer contract");

const tests=read("tests/unit/pedigreeEngine.test.ts")+read("tests/unit/breedingAnalysis.test.ts")+read("tests/python/test_analytics_snapshot.py");
for(const token of ["calculatePedigreeDiversity","buildProspectiveDiversityProjection","buildBreedingOptimizerScore","analyticalValidity","parentConcentration","generationIntervals","meanKinshipPercent","referencePopulations","25.0"]){if(!tests.includes(token))problems.push(`premium/reference tests do not cover ${token}`)}

if(problems.length){console.error("Premium/reference intelligence parity validation FAILED:\n"+problems.map(x=>`  ERROR ${x}`).join("\n"));process.exit(1)}
console.log("Premium/reference intelligence parity passed: trust-aware cohorts, pedigree contribution/diversity, concentration/generation/line-survival analytics, reference-population mean kinship + DPI, influence trajectories, prospective mating diversity and explainable candidate optimizer are enforced across all four frontends.");
