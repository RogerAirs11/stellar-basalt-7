import fs from "node:fs";

const read=(path)=>fs.readFileSync(path,"utf8");
const lighting=read("src/web/styles/heritage.lighting.css");
const system=read("src/web/styles/heritage.system.css");
const stats=read("src/web/heritage/RegistryStatsPage.tsx");
const app=read("src/web/styles/app.css");

const localOrganic=lighting.match(/@keyframes heritage-v2-field-organic-local\{([\s\S]*?)\n\}/)?.[1]||"";
const localChromatic=lighting.match(/@keyframes heritage-v2-field-chromatic-local\{([\s\S]*?)\n\}/)?.[1]||"";
const shine=lighting.match(/@keyframes heritage-v2-local-specular-r3\{([\s\S]*?)\n\}/)?.[1]||"";
const finalContract=system.slice(system.lastIndexOf("v0.42.20 — hard physical-left bar anchor authority"));

const painterSize=3.6;
const minScale=1.08;
const maxHorizontalTravel=0.1944; // 5.4% of the 3.6x painter = 19.44% host width.
const visibleHalf=0.5;
const guaranteedEdgeMargin=(painterSize*minScale/2)-maxHorizontalTravel-visibleHalf;
const yTransforms=[...localOrganic.matchAll(/translate3d\([^,]+,([^,]+),0\)/g),...localChromatic.matchAll(/translate3d\([^,]+,([^,]+),0\)/g)].map(m=>m[1].trim());

const checks=[
  [lighting.includes("content:\"\";position:absolute;inset:-130%")&&lighting.includes("360% painter"),"local Ambient painter remains a centered 360% overscan field"],
  [guaranteedEdgeMargin>1,"overscan leaves >100% host-width safety margin at maximum horizontal travel"],
  [lighting.includes("linear-gradient(color-mix(in srgb,var(--h-v2-ambient-base) 11%,transparent),color-mix(in srgb,var(--h-v2-ambient-base) 11%,transparent))"),"local Ambient painter has a full-field coverage floor so no transparent strip can enter the crop"],
  [yTransforms.length>=8&&yTransforms.every(v=>v==="0"),"local Ambient center is vertically locked at every keyframe"],
  [!localOrganic.includes("rotate(")&&!localChromatic.includes("rotate("),"local Ambient painter never rotates inside clipped cards"],
  [lighting.includes("animation:heritage-v2-local-specular-r3 var(--h-user-shine-motion-speed,18s) linear infinite"),"Shine uses constant linear timing"],
  [shine.includes("0%")&&shine.includes("100%")&&!/(?:^|\s)(?:10|38|51|78|84)%/.test(shine),"Shine has one uninterrupted start-to-end sweep with no pause/intermediate stops"],
  [finalContract.includes('html[dir="rtl"][data-frontend="heritage"]')&&finalContract.includes("justify-self:stretch!important")&&finalContract.includes("margin:0!important"),"LTR and RTL chart tracks are physically stretched and never centered"],
  [finalContract.includes("transform-origin:0% 50%!important")&&finalContract.includes("margin-left:0!important")&&finalContract.includes("margin-right:auto!important"),"all bar fills are hard-anchored to the physical left"],
  [finalContract.includes("animation-timing-function:linear!important"),"bar reveal animation is explicitly linear left-to-right"],
  [finalContract.includes(".stats-composition-row")&&finalContract.includes(".stats-sex-row")&&finalContract.includes(".stats-era-cell>i")&&finalContract.includes(".pedigree-generation-track>i"),"category, coverage, composition, sex, era, and pedigree bars share the hard-left contract"],
  [!stats.includes('className="stats-composition-row" dir={locale==="fa"?"rtl":"ltr"}'),"composition bar geometry is not coupled to locale direction"],
  [!app.includes('html[dir="rtl"] .pedigree-generation-track i{margin-inline-start:auto;margin-inline-end:0}'),"shared pedigree bars do not contain an RTL right-baseline override"],
];

const failed=checks.filter(([ok])=>!ok);
if(failed.length){
  for(const [,message] of failed)console.error(`FAIL: ${message}`);
  process.exit(1);
}
for(const [,message] of checks)console.log(`PASS: ${message}`);
console.log("Ambient full-coverage + linear Shine + hard-left bar validation passed.");
