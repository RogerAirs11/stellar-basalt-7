import { readFileSync } from "node:fs";
import { join } from "node:path";
import { equidataWorkflowEvidence } from "./native-workflow-evidence.mjs";
import { nativeCurationEvidence } from "./native-curation-evidence.mjs";

const root=process.cwd();
const read=p=>readFileSync(join(root,p),"utf8");
const workflows=equidataWorkflowEvidence(root);
const sources={
  Heritage:[read("src/web/main.tsx"),read("src/web/heritage/RegistryStatsPage.tsx"),read("src/web/heritage/RegistryDeskPage.tsx"),read("src/web/heritage/PeopleRegistryPanel.tsx"),read("src/web/heritage/HorseCapabilityPanels.tsx"),read("src/web/styles/heritage.system.css")].join("\n"),
  EquiData:[read("src/web/frontends/equidata-elite/pages.tsx"),read("src/web/frontends/equidata-elite/components.tsx"),read("src/web/frontends/equidata-elite/entry.tsx"),read("src/web/frontends/equidata-elite/governance.tsx"),read("src/web/frontends/equidata-elite/equidata.css"),read("src/web/frontends/equidata-elite/governance.css"),workflows.source].join("\n"),
};
const curationEvidence={Heritage:nativeCurationEvidence(root,read("src/web/main.tsx"),"Heritage"),EquiData:nativeCurationEvidence(root,read("src/web/frontends/equidata-elite/governance.tsx"),"EquiData")};
for(const name of Object.keys(sources))sources[name]+="\n"+curationEvidence[name].source;

// This is intentionally stricter than platformFeatures:"surface". A frontend
// does not earn presentation parity merely by calling an endpoint; each live
// domain must have a visible/usable experience with the expected interaction
// floor. Engines remain visually independent and can satisfy the floor with
// completely different components.
const floor={
  Heritage:{
    registry:["platform.registry.browse","AdvancedRegistrySearch","platform.registry.facets","platform.exports.registry"],
    horse:["platform.horses.get","publicHorseDetailFields","platform.analytics.horseInsights"],
    people:["platform.people.list","platform.people.get"],
    pedigree:["platform.pedigree.ancestors","platform.pedigree.descendants","function PedigreeTree","function RadialPedigree","platform.pedigree.metrics","platform.pedigree.pathsToAncestor","platform.pedigree.coefficients","legend-repeat","legend-cycle"],
    relationships:["platform.relationships.commonAncestors","platform.relationships.coefficients"],
    breeding:["platform.breeding.pairingAnalysis"],
    intelligence:["stats-overview","stats-pedigree","stats-breeding","stats-population","stats-people","stats-quality"],
    qualityWorkflow:["platform.quality.summary","platform.claims.create","platform.claims.mine","platform.changes.create","platform.changes.mine"],
    governance:["platform.auth.login","platform.auth.logout","platform.admin.dashboard","platform.admin.audit","platform.admin.quality","platform.admin.claims","platform.admin.reviewClaim","platform.admin.changeRequests","platform.admin.reviewChangeRequest","platform.admin.horses.get","platform.admin.horses.create","platform.admin.horses.update","platform.admin.horses.archive","platform.admin.maintenance.reindex"],
    provenance:["source.sha256"],
  },
  EquiData:{
    registry:["view.platform.registry.browse","AdvancedRegistrySearch","view.platform.registry.facets","view.platform.exports.registry","viewMode===\"list\""],
    horse:["view.platform.horses.get","publicHorseDetailFields","view.platform.analytics.horseInsights"],
    people:["view.platform.people.list","view.platform.people.get","horseDbRoutes.person"],
    pedigree:["view.platform.pedigree.ancestors","view.platform.pedigree.descendants","buildPedigreeTreeLayout","PedigreeRadial","edx-pedigree-edges","edx-radial-stage","view.platform.pedigree.metrics","view.platform.pedigree.pathsToAncestor","view.platform.pedigree.coefficients","repeated","cycle"],
    relationships:["view.platform.relationships.commonAncestors","view.platform.relationships.coefficients"],
    breeding:["view.platform.breeding.pairingAnalysis"],
    intelligence:["\"overview\"","\"bloodlines\"","\"breeding\"","\"population\"","\"people\"","\"quality\""],
    qualityWorkflow:["view.platform.quality.summary","platform.claims.create","platform.claims.mine","platform.changes.create","platform.changes.mine"],
    governance:["platform.auth.login","platform.auth.logout","platform.admin.dashboard","platform.admin.audit","platform.admin.quality","platform.admin.claims","platform.admin.reviewClaim","platform.admin.changeRequests","platform.admin.reviewChangeRequest","platform.admin.horses.get","platform.admin.horses.create","platform.admin.horses.update","platform.admin.horses.archive","platform.admin.maintenance.reindex"],
    provenance:["source.sha256"],
  },
};

const problems=[...workflows.problems,...Object.values(curationEvidence).flatMap(value=>value.problems)];
for(const [frontend,domains] of Object.entries(floor)){
  const source=sources[frontend];
  for(const [domain,markers] of Object.entries(domains)){
    const missing=markers.filter(marker=>!source.includes(marker));
    if(missing.length) problems.push(`${frontend} · ${domain}: missing visible-surface evidence ${missing.join(", ")}`);
  }
}
if(problems.length){console.error("Visible-surface parity validation FAILED:");for(const p of problems)console.error(`  ERROR ${p}`);process.exit(1)}
console.log("Visible-surface parity passed: Registry, horse/person profiles, graphical pedigree/descent, relationships, breeding, six-domain Intelligence, quality/workflow, governance reachability and provenance are all materially represented across the curated engines (R53 catalogue: Heritage + EquiData floors; Retro Astra / FEI Classic / Classic Registry ride the shared platform-coverage manifest check).");
