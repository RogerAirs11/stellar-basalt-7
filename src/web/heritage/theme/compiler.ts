import type { HeritageLightReversibleTuningKey, HeritageMode, HeritageThemeTuning } from "./schema";

export type HeritageThemeTokenMap=Record<string,string>;
const pct=(value:number)=>`${value.toFixed(2)}%`;
const splitSaturation=(value:number)=>({desaturate:Math.max(0,100-value)*.82,vivid:Math.max(0,value-100)*.72});

export function compileHeritageThemeTokens(t:HeritageThemeTuning,mode:HeritageMode):HeritageThemeTokenMap{
  const out:HeritageThemeTokenMap={};
  const set=(name:string,value:string)=>{out[name]=value};
  const brightnessDirection=mode==="light"&&t.reverseLightBrightness>=.5?-1:1;
  const resolveSignedTone=(key:HeritageLightReversibleTuningKey,limit:number)=>Math.max(-limit,Math.min(limit,t[key]))*brightnessDirection;
  for(const role of ["major","panel","card","control"] as const){
    const transparency=t[`${role}Transparency`]; const brightness=resolveSignedTone(`${role}Brightness`,100); const darken=Math.max(0,-brightness); const brighten=Math.max(0,brightness);
    set(`--h-user-${role}-alpha`,`${100-transparency}%`); set(`--h-user-${role}-darken`,pct(darken)); set(`--h-user-${role}-brighten`,pct(brighten)); set(`--h-user-${role}-tone-scale`,(1-darken/100).toFixed(3)); set(`--h-user-${role}-chroma-scale`,(t[`${role}Saturation`]/100).toFixed(3)); set(`--h-user-${role}-blur`,`${t[`${role}Blur`]}px`);
  }
  const semanticTint=t.tintEnergy, contextTint=t.contextColorEnergy, schemeTint=t.schemeEnergy;
  const schemeSat=splitSaturation(t.schemeSaturation), semanticTextSat=splitSaturation(t.semanticSaturation), semanticBackgroundSat=splitSaturation(t.semanticBackgroundSaturation), contextSat=splitSaturation(t.contextColorSaturation), shineSat=splitSaturation(t.shineSaturation);
  // Ambient saturation is applied as a post-gradient chroma filter instead of
  // mixing toward brighter "vivid" swatches. This keeps saturation perceptually
  // separate from brightness: 0% is grayscale, 100% is neutral, 220% is vivid.
  const ambientChroma=Math.max(0,Math.min(220,t.ambientSaturation))/100;
  const schemeBrightness=resolveSignedTone("schemeBrightness",30), schemeContrast=Math.max(-40,Math.min(40,t.schemeContrast));
  const semanticTextBrightness=resolveSignedTone("semanticBrightness",30), semanticBackgroundBrightness=resolveSignedTone("semanticBackgroundBrightness",30), contextBrightness=resolveSignedTone("contextColorBrightness",30), ambientBrightness=resolveSignedTone("ambientBrightness",50), shineBrightness=resolveSignedTone("shineBrightness",50);
  const semanticBackgroundScale=Math.max(0,Math.min(1,t.semanticBackgroundVisibility/100)), semanticTextScale=Math.max(0,Math.min(1,t.semanticTextVisibility/100)), contextBackgroundScale=Math.max(0,Math.min(1,t.contextBackgroundVisibility/100));
  set("--h-user-semantic-text-visibility",pct(semanticTextScale*100)); set("--h-user-semantic-alpha",pct(18*semanticBackgroundScale)); set("--h-user-semantic-soft-alpha",pct(14*semanticBackgroundScale)); set("--h-user-semantic-strong-alpha",pct(26*semanticBackgroundScale)); set("--h-user-semantic-cell-alpha",pct(10*semanticBackgroundScale)); set("--h-user-semantic-border-alpha",pct(Math.min(64,semanticTint*1.75))); set("--h-user-semantic-hover-border-alpha",pct(Math.min(76,Math.max(44,semanticTint*2.05))));
  set("--h-user-semantic-brighten",pct(Math.max(0,semanticTextBrightness))); set("--h-user-semantic-darken",pct(Math.max(0,-semanticTextBrightness))); set("--h-user-semantic-desaturate",pct(semanticTextSat.desaturate)); set("--h-user-semantic-vivid",pct(semanticTextSat.vivid)); set("--h-user-semantic-bg-brighten",pct(Math.max(0,semanticBackgroundBrightness))); set("--h-user-semantic-bg-darken",pct(Math.max(0,-semanticBackgroundBrightness))); set("--h-user-semantic-bg-desaturate",pct(semanticBackgroundSat.desaturate)); set("--h-user-semantic-bg-vivid",pct(semanticBackgroundSat.vivid));
  set("--h-user-context-soft-alpha",pct(contextTint*.72*contextBackgroundScale)); set("--h-user-context-brighten",pct(Math.max(0,contextBrightness))); set("--h-user-context-darken",pct(Math.max(0,-contextBrightness))); set("--h-user-context-desaturate",pct(contextSat.desaturate)); set("--h-user-context-vivid",pct(contextSat.vivid));
  set("--h-v13-scheme-soft",pct(schemeTint*.58)); set("--h-user-scheme-brighten",pct(Math.max(0,schemeBrightness))); set("--h-user-scheme-darken",pct(Math.max(0,-schemeBrightness))); set("--h-user-scheme-contrast-up",pct(Math.max(0,schemeContrast)*.52)); set("--h-user-scheme-contrast-down",pct(Math.max(0,-schemeContrast)*.72)); set("--h-user-scheme-desaturate",pct(schemeSat.desaturate)); set("--h-user-scheme-vivid",pct(schemeSat.vivid));
  set("--h-user-ambient-scheme-character",pct(Math.min(98,72+schemeTint*1.18))); set("--h-user-ambient-scheme-chroma",pct(Math.min(38,16+schemeTint*.95))); set("--h-user-ambient-scheme-metal",pct(Math.min(26,10+schemeTint*.62))); set("--h-user-scheme-alpha","0%"); set("--h-user-scheme-soft-alpha","0%"); set("--h-user-tint-alpha","0%"); set("--h-user-tint-soft-alpha","0%");
  set("--h-user-ambient-brighten",pct(Math.max(0,ambientBrightness))); set("--h-user-ambient-darken",pct(Math.max(0,-ambientBrightness)));
  // Keep the legacy pre-blend knobs neutral; chroma now belongs to one explicit
  // filter token so raising saturation cannot accidentally lift luminance.
  set("--h-user-ambient-desaturate","0%"); set("--h-user-ambient-vivid","0%"); set("--h-user-ambient-chroma-filter",ambientChroma.toFixed(3));
  set("--h-user-shine-brighten",pct(Math.max(0,shineBrightness))); set("--h-user-shine-darken",pct(Math.max(0,-shineBrightness))); set("--h-user-shine-desaturate",pct(shineSat.desaturate)); set("--h-user-shine-vivid",pct(shineSat.vivid));
  set("--h-user-shine-alpha",`${t.shineEnergy}%`); set("--h-user-shine-soft-alpha",pct(t.shineEnergy*.55)); set("--h-user-shine-edge-alpha",pct(t.shineEnergy*.42)); set("--h-user-shine-motion-speed",`${t.shineSeconds}s`); set("--h-user-halo-softness",`${t.haloSoftness}px`);
  const ambientEnergy=Math.max(0,Math.min(200,t.ambientVisibility))/100; set("--h-user-ambient-visibility",ambientEnergy.toFixed(3));
  const controlProminence=Math.max(0,Math.min(100,t.controlProminence))/100; set("--h-user-control-prominence",controlProminence.toFixed(3)); set("--h-user-control-tint-alpha",pct(5+13*controlProminence)); set("--h-user-control-active-alpha",pct(14+22*controlProminence)); set("--h-user-control-border-alpha",pct(24+38*controlProminence)); set("--h-user-control-active-border-alpha",pct(44+34*controlProminence)); set("--h-user-control-shadow-alpha",pct(7+10*controlProminence));
  const selectedStrength=Math.max(0,Math.min(100,t.selectedStateStrength))/100;
  const selectedGlow=Math.max(0,Math.min(100,t.selectedStateGlow))/100;
  const selectedMotion=Math.max(0,Math.min(100,t.selectedStateMotion))/100;
  const selectedChroma=Math.max(.5,Math.min(2.2,t.selectedStateSaturation/100));
  set("--h-user-selected-fill-alpha",pct(16+32*selectedStrength));
  set("--h-user-selected-border-alpha",pct(48+42*selectedStrength));
  set("--h-user-selected-tone-mix",pct(72+24*selectedStrength));
  set("--h-user-selected-chroma",selectedChroma.toFixed(3));
  set("--h-user-selected-brightness",(1.01+.09*selectedStrength).toFixed(3));
  set("--h-user-selected-glow-alpha",pct(5+27*selectedGlow));
  set("--h-user-selected-glow-size",`${(8+22*selectedGlow).toFixed(1)}px`);
  set("--h-user-selected-peak-glow-alpha",pct(5+27*selectedGlow+18*selectedGlow*selectedMotion));
  set("--h-user-selected-pulse-lift",`${(1.8*selectedMotion).toFixed(2)}px`);
  set("--h-user-selected-pulse-scale",(1+.012*selectedMotion).toFixed(4));
  set("--h-user-selected-pulse-seconds",`${(3.2-1.05*selectedMotion).toFixed(2)}s`);
  set("--h-user-motion-speed",`${t.motionSeconds}s`); set("--h-user-ambient-motion-speed",`${t.motionSeconds}s`); set("--h-user-ambient-motion-speed-a",`${t.motionSeconds}s`);
  return out;
}
