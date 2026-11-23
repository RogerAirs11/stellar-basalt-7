import { readFileSync } from "node:fs";
import { join } from "node:path";
import { equidataWorkflowEvidence } from "./native-workflow-evidence.mjs";
import { nativeCurationEvidence } from "./native-curation-evidence.mjs";

const root=process.cwd();
const heritageStats=readFileSync(join(root,"src/web/heritage/RegistryStatsPage.tsx"),"utf8");
const heritageMain=readFileSync(join(root,"src/web/main.tsx"),"utf8");
const heritageDesk=readFileSync(join(root,"src/web/heritage/RegistryDeskPage.tsx"),"utf8")+readFileSync(join(root,"src/web/heritage/PeopleRegistryPanel.tsx"),"utf8");
const heritageCapabilities=readFileSync(join(root,"src/web/heritage/HorseCapabilityPanels.tsx"),"utf8");
// R76: the record-module surfaces (media/competitions/marketplace panels) carry the
// presentation evidence for the media/performance_records/market_data capabilities.
const heritageModules=readFileSync(join(root,"src/web/heritage/HorseModulesPanels.tsx"),"utf8")+readFileSync(join(root,"src/web/heritage/CompetitionsPage.tsx"),"utf8")+readFileSync(join(root,"src/web/heritage/MarketplacePage.tsx"),"utf8")+readFileSync(join(root,"src/web/heritage/DuplicateWorkbench.tsx"),"utf8");
const heritageCuration=nativeCurationEvidence(root,heritageMain,"Heritage");
const heritage=[heritageMain,heritageStats,heritageDesk,heritageCapabilities,heritageModules,heritageCuration.source].join("\n");
const equidata=readFileSync(join(root,"src/web/frontends/equidata-elite/pages.tsx"),"utf8");
const equidataComponents=readFileSync(join(root,"src/web/frontends/equidata-elite/components.tsx"),"utf8");
const equidataEntry=readFileSync(join(root,"src/web/frontends/equidata-elite/entry.tsx"),"utf8");
const equidataGovernance=readFileSync(join(root,"src/web/frontends/equidata-elite/governance.tsx"),"utf8");
const equidataRecords=readFileSync(join(root,"src/web/frontends/equidata-elite/recordModules.tsx"),"utf8");
const sharedMedia=readFileSync(join(root,"src/frontend-kit/HorseMediaPanel.tsx"),"utf8");
const sharedRecords=readFileSync(join(root,"src/frontend-kit/recordModules.ts"),"utf8");
const workflows=equidataWorkflowEvidence(root);
const equidataCuration=nativeCurationEvidence(root,equidataGovernance,"EquiData");
const equidataAll=[equidata,equidataComponents,equidataEntry,equidataGovernance,equidataRecords,sharedMedia,sharedRecords,workflows.source,equidataCuration.source].join("\n");

const problems=[...workflows.problems,...heritageCuration.problems,...equidataCuration.problems];
// Follow the real rendered composition. Shared method text alone is insufficient:
// both native surfaces must import and mount the component with their own context.
// R122 four-locale boundary evolved at R125: the shared media panel now takes
// the three-locale engine locale (AR resolves through its authored dictionary;
// FR still falls back to English at the kit boundary).
if (!heritageModules.includes('import { HorseMediaPanel }') || !/<HorseMediaPanel horseId=\{horse\.id\} platform=\{platform\} user=\{user\} permissions=\{permissions\} locale=\{(?:locale|legacyUiLocale\(locale\)|engineUiLocale\(locale\))\} appearance="core"/.test(heritageModules)) problems.push("Heritage's media gallery is not wired to the shared media component");
if (!equidataRecords.includes('HorseMediaPanel,') || !equidataRecords.includes('<HorseMediaPanel horseId={horseId} platform={view.platform} user={view.user} permissions={view.permissions} locale={view.locale} appearance="equidata"')) problems.push("EquiData's record view is not wired to the shared media component");
if (!equidataRecords.includes('loadHorseRecordDetails(view.platform, horseId, controller.signal)')) problems.push("EquiData's record details do not call the shared abortable loader");
const platformContractSource=readFileSync(join(root,"src/contracts/platform.ts"),"utf8");
const livePlatformFeatures=[...platformContractSource.matchAll(/^  ([a-z_]+): \{ version: "[^"]+", stability: "(core|stable|experimental|reserved)"/gm)].filter(([, ,stability])=>stability!=="reserved").map(([,feature])=>feature);

// Every analytics frontend must visibly consume the full live registry analytics domains.
const analyticsMarkers=[
  "sexDistribution","topBreeds","topBirthPlaces","topColors","topMainStrains",
  "parentage","activity","dataCoverage","progeny","topSires","topDams",
  "topRepresentedAncestorsDepth4","people","topOwners","topBreeders","topImporters","topPassportReceivers","importerCount","passportReceiverCount","quality",
  "cycleNodeCount","cycleContaminatedHorseCount","analyticsEligibleHorseCount",
];
for (const [name,source] of [["Heritage",heritageStats],["EquiData",equidata]]) {
  for (const marker of analyticsMarkers) if (!source.includes(marker)) problems.push(`${name} Intelligence does not visibly consume analytics field/domain: ${marker}`);
}

// Six-domain presentation floor: implementations can look unrelated, but information depth cannot silently shrink.
const sectionMarkers={
  Heritage:['{id:"overview",label:t("stats.nav.overview")','{id:"pedigree",label:t("stats.nav.pedigree")','{id:"breeding",label:t("stats.nav.breeding")','{id:"population",label:t("stats.nav.population")','{id:"people",label:t("stats.nav.people")','{id:"quality",label:t("stats.nav.quality")'],
  EquiData:['"overview"','"bloodlines"','"breeding"','"population"','"people"','"quality"'],
};
for (const [name,markers] of Object.entries(sectionMarkers)) {
  const source=name==="Heritage"?heritageStats:equidata;
  for (const marker of markers) if (!source.includes(marker)) problems.push(`${name} Intelligence presentation section missing: ${marker}`);
}

// Graphical pedigree is a presentation-parity floor, not a manifest checkbox.
// Each engine may look completely different, but ancestor + descendant navigation
// must include a real spatial family-tree surface, repeat/cycle encoding and a
// compact fallback. EquiData additionally exposes radial ancestry.
const pedigreePresentation={
  Heritage:[heritageMain,["function PedigreeTree","function RadialPedigree","pedigree-map-visual","desktopPedView"]],
  EquiData:[equidataAll,["buildPedigreeTreeLayout","PedigreeRadial","visual===\"graph\"","visual===\"radial\"","mode===\"descendants\""]],
};
for(const [name,[source,markers]] of Object.entries(pedigreePresentation)){for(const marker of markers){if(!source.includes(marker))problems.push(`${name} lacks first-class graphical pedigree presentation marker: ${marker}`)}}

// Progressive disclosure is a platform UX invariant for data-heavy explorers.
// Heritage renders its facet strip inside the Advanced side rail via a portal
// (advancedOpen&&createPortal + advanced-registry-rail) — same canonical pattern
// enforced by validate-design-systems.mjs. R54: the rail restructured to the
// studio section pattern (facets&&<section ... adv-rail-facets).
if (!/{advancedOpen&&createPortal\(/.test(heritageMain) || !heritageMain.includes("advanced-registry-rail") || !heritageMain.includes('facets&&<section className="adv-rail-section"') || !heritageMain.includes("adv-rail-facets")) problems.push("Heritage exposes secondary registry facets outside Advanced");
if (equidata.includes('className="edx-filterbar"') || !equidata.includes("edx-advanced-toggle")) problems.push("EquiData exposes secondary registry filters outside Advanced");
for (const marker of ["EMPTY_ADVANCED_REGISTRY_SEARCH","advancedRegistryParams(advanced)","advanced.horseName","advanced.horseId","advanced.registerNo","advanced.owner","advanced.breeder","advanced.importer","advanced.passportReceiver","advanced.sire","advanced.dam","advanced.yearFrom","advanced.yearTo"]) {
  if (!equidata.includes(marker)) problems.push(`EquiData structured Registry parity/DRY marker missing: ${marker}`);
}

// Unsupported donor capabilities must be explicit dormant states, never zero-valued pseudo-data.
for (const marker of ["NO DATASET","Genomics","Performance","Market"]) if (!equidata.includes(marker)) problems.push(`EquiData dormant capability truthfulness marker missing: ${marker}`);
if (!equidataComponents.includes("CAPABILITY DORMANT")) problems.push("EquiData dormant component no longer labels unsupported capabilities explicitly");
if (equidata.includes('["0.0.0",L("RESERVED CAPABILITY"')) problems.push("EquiData still presents a zero-like placeholder as if it were capability data");

// Every live platform capability needs a concrete, reachable implementation or an explicit host route.
// Markers are implementation evidence, not manifest declarations: this catches "declared parity"
// where a feature never reaches a real page/action.
const livePresentationEvidence={
  Heritage:{
    authentication:["platform.auth.login","platform.auth.logout"],
    search:["platform.search.horses"], structured_search:["AdvancedRegistrySearch"],
    registry:["platform.registry.browse"], registry_facets:["platform.registry.facets"], exports:["platform.exports.registry"],
    horse_profiles:["platform.horses.get"], people:["platform.people.list","platform.people.get","/person/${p.id}"],
    pedigree_ancestors:["platform.pedigree.ancestors"], pedigree_descendants:["platform.pedigree.descendants"],
    pedigree_metrics:["platform.pedigree.metrics","platform.pedigree.descendantMetrics"], pedigree_paths:["platform.pedigree.pathsToAncestor"],
    pedigree_coefficients:["platform.pedigree.coefficients"], relationships:["platform.relationships.commonAncestors","platform.relationships.coefficients"],
    horse_insights:["platform.analytics.horseInsights"], registry_analytics:["platform.analytics.registry"], quality_summary:["platform.quality.summary"],
    quality_queue:["platform.admin.quality","platform.admin.qualityResolve","platform.admin.qualityReopen","platform.admin.qualityBulkResolve","platform.admin.qualityScan"],
    evidence_summary:["platform.horses.evidenceSummary"], exact_identifier:["platform.search.exactIdentifier"],
    owner_claims:["platform.claims.create","platform.claims.mine"], change_requests:["platform.changes.create","platform.changes.mine"],
    audit:["platform.admin.audit"], admin:["platform.admin.dashboard"], curation:["platform.admin.horses.update","platform.admin.horses.create"],
    breeding_analysis:["platform.breeding.pairingAnalysis"],
    media:["modules.media.list","modules.media.upload","modules.media.fileUrl"],
    performance_records:["modules.competitions.list","modules.competitions.horseHistory"],
    market_data:["modules.market.list","modules.market.inquire"],
    ai_assistant:["AssistantLauncher"],
  },
  EquiData:{
    authentication:["platform.auth.login","platform.auth.logout"],
    search:["platform.search.horses"], structured_search:["edx-advanced-filters"],
    registry:["view.platform.registry.browse"], registry_facets:["view.platform.registry.facets"], exports:["view.platform.exports.registry"],
    horse_profiles:["view.platform.horses.get"], people:["view.platform.people.list","view.platform.people.get","horseDbRoutes.person"],
    pedigree_ancestors:["view.platform.pedigree.ancestors"], pedigree_descendants:["view.platform.pedigree.descendants"],
    pedigree_metrics:["view.platform.pedigree.metrics","view.platform.pedigree.descendantMetrics"], pedigree_paths:["view.platform.pedigree.pathsToAncestor"],
    pedigree_coefficients:["view.platform.pedigree.coefficients"], relationships:["view.platform.relationships.commonAncestors","view.platform.relationships.coefficients"],
    horse_insights:["view.platform.analytics.horseInsights"], registry_analytics:["view.platform.analytics.registry"], quality_summary:["view.platform.quality.summary"],
    quality_queue:["platform.admin.quality","platform.admin.qualityScan","platform.admin.qualityResolve"],
    evidence_summary:["platform.horses.evidenceSummary"], exact_identifier:["platform.search.exactIdentifier"],
    owner_claims:["platform.claims.create","platform.claims.mine"], change_requests:["platform.changes.create","platform.changes.mine"],
    audit:["platform.admin.audit"],
    admin:["platform.admin.dashboard","platform.admin.claims","platform.admin.reviewClaim","platform.admin.changeRequests","platform.admin.reviewChangeRequest","platform.admin.quality","platform.admin.maintenance.reindex"],
    curation:["platform.admin.horses.get","platform.admin.horses.create","platform.admin.horses.update","platform.admin.horses.archive"],
    breeding_analysis:["view.platform.breeding.pairingAnalysis"],
    media:["HorseMediaPanel","modules.media.list","modules.media.upload","modules.media.fileUrl"],
    performance_records:["loadHorseRecordDetails","modules.competitions.horseHistory"],
    market_data:["modules.market.list","modules.market.inquire"],
    ai_assistant:["AssistantPanel"],
  },
};
const presentationSources={Heritage:[heritage,sharedMedia].join("\n"),EquiData:equidataAll};
for(const [name,evidence] of Object.entries(livePresentationEvidence)){
  const source=presentationSources[name];
  for(const [feature,markers] of Object.entries(evidence)){
    for(const marker of markers) if(!source.includes(marker)) problems.push(`${name} live feature '${feature}' lacks concrete presentation evidence: ${marker}`);
  }
}

// Future-proof parity: every non-reserved platform feature must have explicit concrete
// presentation/reachability evidence for every full frontend. This prevents a newly
// added live capability from silently escaping the hand-written UI floor.
for(const [name,evidence] of Object.entries(livePresentationEvidence)){
  for(const feature of livePlatformFeatures){
    if(!(feature in evidence)) problems.push(`${name} has no concrete presentation-evidence rule for live platform feature '${feature}'`);
  }
}

// Relationship-role data must remain complete in analytics and advanced registry filtering.
for(const [name,source] of [["Heritage",heritage],["EquiData",equidataAll]]){
  for(const marker of ["importer","passportReceiver"]) if(!source.includes(marker)) problems.push(`${name} does not expose registry role/filter '${marker}'`);
}

if (problems.length) {
  console.error("Frontend presentation parity validation FAILED:");
  for (const problem of problems) console.error(`  ERROR ${problem}`);
  process.exit(1);
}
console.log("Frontend presentation parity passed: the curated full experiences (Heritage + EquiData) consume the full live analytics depth and live capability set; explorers use progressive disclosure, and unsupported future datasets stay explicitly dormant. Retro Astra / FEI Classic / Classic Registry are held to the shared manifest platform-coverage floor in validate-frontends.mjs.");
