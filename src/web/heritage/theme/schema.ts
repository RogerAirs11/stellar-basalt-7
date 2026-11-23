export type HeritagePalette = "auto" | "neutral" | "heritage" | "midnight" | "oxblood";
export const HERITAGE_PALETTES:readonly HeritagePalette[]=["auto","neutral","heritage","midnight","oxblood"] as const;
export type HeritageMode = "dark" | "light";
export type HeritageSceneIntensity = "subtle" | "rich" | "full";
export type HeritageAmbientMotion = "animated" | "still" | "off";
export type HeritageAmbientPattern = "organic" | "chromatic" | "orbit" | "drift" | "breathe";
export const HERITAGE_AMBIENT_PATTERNS:readonly HeritageAmbientPattern[]=["organic","chromatic","orbit","drift","breathe"] as const;
export type HeritageAmbientScope = "surfaces" | "major" | "global";
export const HERITAGE_AMBIENT_SCOPES:readonly HeritageAmbientScope[]=["surfaces","major","global"] as const;
/** Which material depth layers receive the colorful local Ambient field. Default: 01 Major only. */
export type HeritageAmbientLayerSelection = "major" | "major,panel" | "major,panel,card";
export const HERITAGE_AMBIENT_LAYER_SELECTIONS:readonly HeritageAmbientLayerSelection[]=["major","major,panel","major,panel,card"] as const;
export type HeritageTabHierarchyMode = "contextual" | "stacked" | "docked";
export type HeritageMaterialRole = "major" | "panel" | "card" | "control";
/** Layout density: compact reduces paddings/margins so small screens fit more. */
export type HeritageDensityMode = "comfortable" | "compact";
export const HERITAGE_DENSITY_MODES:readonly HeritageDensityMode[]=["comfortable","compact"] as const;
/** Performance mode: auto detects weak devices; lite disables expensive decoration. */
export type HeritagePerformanceMode = "auto" | "full" | "lite";
export const HERITAGE_PERFORMANCE_MODES:readonly HeritagePerformanceMode[]=["auto","full","lite"] as const;

/** Runtime device heuristic for the "auto" performance mode. */
export function detectHeritageWeakDevice():boolean{
  if(typeof navigator==="undefined")return false;
  const nav=navigator as Navigator&{deviceMemory?:number};
  const memory=nav.deviceMemory??8;
  const cores=nav.hardwareConcurrency??8;
  return memory<=4||cores<=4;
}

export const HERITAGE_LIGHT_REVERSIBLE_TUNING_KEYS=[
  "majorBrightness","panelBrightness","cardBrightness","controlBrightness",
  "schemeBrightness","semanticBackgroundBrightness","semanticBrightness","contextColorBrightness",
  "ambientBrightness","shineBrightness",
] as const;
export type HeritageLightReversibleTuningKey=typeof HERITAGE_LIGHT_REVERSIBLE_TUNING_KEYS[number];

export type HeritageThemeTuning = {
  majorTransparency:number; panelTransparency:number; cardTransparency:number; controlTransparency:number;
  majorBrightness:number; panelBrightness:number; cardBrightness:number; controlBrightness:number;
  majorSaturation:number; panelSaturation:number; cardSaturation:number; controlSaturation:number;
  majorBlur:number; panelBlur:number; cardBlur:number; controlBlur:number;
  tintEnergy:number; semanticBackgroundVisibility:number; semanticBackgroundBrightness:number; semanticBackgroundSaturation:number;
  semanticTextVisibility:number; semanticBrightness:number; semanticSaturation:number;
  contextColorEnergy:number; contextBackgroundVisibility:number; contextColorBrightness:number; contextColorSaturation:number;
  schemeEnergy:number; schemeBrightness:number; schemeContrast:number; schemeSaturation:number; reverseLightBrightness:number;
  shineEnergy:number; shineBrightness:number; shineSaturation:number; shineMotion:number; shineSeconds:number; haloSoftness:number;
  ambientVisibility:number; ambientBrightness:number; ambientSaturation:number; motionSeconds:number; controlProminence:number;
  selectedStateStrength:number; selectedStateSaturation:number; selectedStateGlow:number; selectedStateMotion:number;
};

/** R23 built-in defaults retained as a one-click compatibility preset. */
export const LEGACY_R23_HERITAGE_THEME_TUNING:HeritageThemeTuning={majorTransparency:62,panelTransparency:71,cardTransparency:62,controlTransparency:62,majorBrightness:-86,panelBrightness:-74,cardBrightness:-81,controlBrightness:-92,majorSaturation:200,panelSaturation:100,cardSaturation:200,controlSaturation:200,majorBlur:21,panelBlur:25,cardBlur:11,controlBlur:7,tintEnergy:12,semanticBackgroundVisibility:100,semanticBackgroundBrightness:-15,semanticBackgroundSaturation:200,semanticTextVisibility:84,semanticBrightness:3,semanticSaturation:161,contextColorEnergy:12,contextBackgroundVisibility:47,contextColorBrightness:0,contextColorSaturation:98,schemeEnergy:7,schemeBrightness:3,schemeContrast:4,schemeSaturation:109,reverseLightBrightness:1,shineEnergy:3,shineBrightness:-29,shineSaturation:220,shineMotion:1,shineSeconds:10,haloSoftness:22,ambientVisibility:96,ambientBrightness:-44,ambientSaturation:220,motionSeconds:8,controlProminence:77,selectedStateStrength:86,selectedStateSaturation:155,selectedStateGlow:68,selectedStateMotion:58};

/**
 * R136 built-in defaults. These values are the exact tuning projection of the
 * owner-supplied v22 export shipped as `public/appearance-default.json`
 * (2026-10-25). Keep the portable JSON mapping in serialize/parse
 * authoritative so import/export remains schema-v22 compatible.
 */
export const DEFAULT_HERITAGE_THEME_TUNING:HeritageThemeTuning={majorTransparency:62,panelTransparency:57,cardTransparency:53,controlTransparency:41,majorBrightness:-100,panelBrightness:-100,cardBrightness:-76,controlBrightness:-100,majorSaturation:134,panelSaturation:100,cardSaturation:120,controlSaturation:130,majorBlur:24,panelBlur:22,cardBlur:6,controlBlur:2,tintEnergy:4,semanticBackgroundVisibility:76,semanticBackgroundBrightness:-19,semanticBackgroundSaturation:200,semanticTextVisibility:100,semanticBrightness:9,semanticSaturation:200,contextColorEnergy:15,contextBackgroundVisibility:43,contextColorBrightness:30,contextColorSaturation:100,schemeEnergy:22,schemeBrightness:-2,schemeContrast:-4,schemeSaturation:200,reverseLightBrightness:1,shineEnergy:5,shineBrightness:50,shineSaturation:100,shineMotion:1,shineSeconds:10,haloSoftness:12,ambientVisibility:74,ambientBrightness:-50,ambientSaturation:220,motionSeconds:14,controlProminence:100,selectedStateStrength:78,selectedStateSaturation:155,selectedStateGlow:68,selectedStateMotion:58};

export const HERITAGE_THEME_TUNING_LIMITS:Record<keyof HeritageThemeTuning,[number,number]>={
  majorTransparency:[35,92],panelTransparency:[35,90],cardTransparency:[25,86],controlTransparency:[20,80],majorBrightness:[-100,100],panelBrightness:[-100,100],cardBrightness:[-100,100],controlBrightness:[-100,100],majorSaturation:[0,200],panelSaturation:[0,200],cardSaturation:[0,200],controlSaturation:[0,200],majorBlur:[4,64],panelBlur:[4,64],cardBlur:[3,48],controlBlur:[2,32],
  tintEnergy:[0,40],semanticBackgroundVisibility:[0,100],semanticBackgroundBrightness:[-30,30],semanticBackgroundSaturation:[0,200],semanticTextVisibility:[0,100],semanticBrightness:[-30,30],semanticSaturation:[0,200],contextColorEnergy:[0,28],contextBackgroundVisibility:[0,100],contextColorBrightness:[-30,30],contextColorSaturation:[0,200],
  schemeEnergy:[0,22],schemeBrightness:[-30,30],schemeContrast:[-40,40],schemeSaturation:[0,200],reverseLightBrightness:[0,1],shineEnergy:[0,40],shineBrightness:[-50,50],shineSaturation:[0,220],shineMotion:[0,1],shineSeconds:[10,42],haloSoftness:[12,52],ambientVisibility:[0,200],ambientBrightness:[-50,50],ambientSaturation:[0,220],motionSeconds:[8,36],controlProminence:[0,100],selectedStateStrength:[0,100],selectedStateSaturation:[50,220],selectedStateGlow:[0,100],selectedStateMotion:[0,100]
};

export function clampHeritageThemeTuning(input:Partial<Record<keyof HeritageThemeTuning,unknown>>):HeritageThemeTuning{
  const next={...DEFAULT_HERITAGE_THEME_TUNING};
  for(const key of Object.keys(DEFAULT_HERITAGE_THEME_TUNING) as (keyof HeritageThemeTuning)[]){
    const value=input[key]; if(typeof value!=="number"||!Number.isFinite(value))continue;
    const [min,max]=HERITAGE_THEME_TUNING_LIMITS[key]; next[key]=Math.max(min,Math.min(max,value));
  }
  return next;
}

export const HERITAGE_THEME_PRESET_VERSION=22 as const;
export type HeritageMaterialDepthPreset={transparency:number;shade:number;saturation:number;blur:number};
export type HeritageThemePresetV22={
  version:typeof HERITAGE_THEME_PRESET_VERSION;
  palette:HeritagePalette; mode:HeritageMode; scene:HeritageSceneIntensity; glassMode:boolean; tabHierarchy:HeritageTabHierarchyMode;
  material:Record<HeritageMaterialRole,HeritageMaterialDepthPreset>;
  ambient:{motion:HeritageAmbientMotion;pattern:HeritageAmbientPattern;scope:HeritageAmbientScope;dither:boolean;visibility:number;brightness:number;saturation:number;motionSeconds:number;layers?:HeritageAmbientLayerSelection};
  shine:{energy:number;brightness:number;saturation:number;motion:boolean;seconds:number;haloSoftness:number};
  color:{semanticCueStrength:number;semanticBackgroundVisibility:number;semanticBackgroundBrightness:number;semanticBackgroundSaturation:number;semanticTextVisibility:number;semanticBrightness:number;semanticSaturation:number;contextStrength:number;contextBackgroundVisibility:number;contextBrightness:number;contextSaturation:number;schemeStrength:number;schemeBrightness:number;schemeContrast:number;schemeSaturation:number;reverseLightBrightness:boolean};
  navigation:{controlProminence:number;selectedStateStrength?:number;selectedStateSaturation?:number;selectedStateGlow?:number;selectedStateMotion?:number};
  presentation?:{density:HeritageDensityMode;performanceMode:HeritagePerformanceMode};
};

export type HeritageAppearanceSnapshot={palette:HeritagePalette;mode:HeritageMode;scene:HeritageSceneIntensity;ambientMotion:HeritageAmbientMotion;ambientPattern:HeritageAmbientPattern;ambientScope:HeritageAmbientScope;ambientLayers:HeritageAmbientLayerSelection;ambientDither:boolean;glassMode:boolean;tabHierarchy:HeritageTabHierarchyMode;density:HeritageDensityMode;performanceMode:HeritagePerformanceMode;tuning:HeritageThemeTuning};

const materialDepth=(tuning:HeritageThemeTuning,role:HeritageMaterialRole):HeritageMaterialDepthPreset=>({transparency:tuning[`${role}Transparency`],shade:tuning[`${role}Brightness`],saturation:tuning[`${role}Saturation`],blur:tuning[`${role}Blur`]});
export function serializeHeritageThemePreset(snapshot:HeritageAppearanceSnapshot):HeritageThemePresetV22{
  const t=snapshot.tuning;
  return {version:22,palette:snapshot.palette,mode:snapshot.mode,scene:snapshot.scene,glassMode:snapshot.glassMode,tabHierarchy:snapshot.tabHierarchy,
    material:{major:materialDepth(t,"major"),panel:materialDepth(t,"panel"),card:materialDepth(t,"card"),control:materialDepth(t,"control")},
    ambient:{motion:snapshot.ambientMotion,pattern:snapshot.ambientPattern,scope:snapshot.ambientScope,dither:snapshot.ambientDither,visibility:t.ambientVisibility,brightness:t.ambientBrightness,saturation:t.ambientSaturation,motionSeconds:t.motionSeconds,layers:snapshot.ambientLayers},
    shine:{energy:t.shineEnergy,brightness:t.shineBrightness,saturation:t.shineSaturation,motion:t.shineMotion>=.5,seconds:t.shineSeconds,haloSoftness:t.haloSoftness},
    color:{semanticCueStrength:t.tintEnergy,semanticBackgroundVisibility:t.semanticBackgroundVisibility,semanticBackgroundBrightness:t.semanticBackgroundBrightness,semanticBackgroundSaturation:t.semanticBackgroundSaturation,semanticTextVisibility:t.semanticTextVisibility,semanticBrightness:t.semanticBrightness,semanticSaturation:t.semanticSaturation,contextStrength:t.contextColorEnergy,contextBackgroundVisibility:t.contextBackgroundVisibility,contextBrightness:t.contextColorBrightness,contextSaturation:t.contextColorSaturation,schemeStrength:t.schemeEnergy,schemeBrightness:t.schemeBrightness,schemeContrast:t.schemeContrast,schemeSaturation:t.schemeSaturation,reverseLightBrightness:t.reverseLightBrightness>=.5},
    navigation:{controlProminence:t.controlProminence,selectedStateStrength:t.selectedStateStrength,selectedStateSaturation:t.selectedStateSaturation,selectedStateGlow:t.selectedStateGlow,selectedStateMotion:t.selectedStateMotion},
    presentation:{density:snapshot.density,performanceMode:snapshot.performanceMode}};
}

const oneOf=<T extends string>(value:unknown,allowed:readonly T[],fallback:T):T=>typeof value==="string"&&allowed.includes(value as T)?value as T:fallback;
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"?value as Record<string,unknown>:{};
export function parseHeritageThemePreset(input:unknown,base:HeritageAppearanceSnapshot):HeritageAppearanceSnapshot|null{
  const raw=object(input); if(!Object.keys(raw).length)return null;
  // v20 and earlier portable presets used one flat `tuning` object. Accept them as a migration input.
  if(raw.tuning&&typeof raw.tuning==="object"){
    return {...base,
      palette:oneOf(raw.palette,HERITAGE_PALETTES,base.palette),mode:oneOf(raw.mode,["dark","light"] as const,base.mode),scene:oneOf(raw.scene,["subtle","rich","full"] as const,base.scene),
      ambientMotion:oneOf(raw.ambientMotion,["animated","still","off"] as const,base.ambientMotion),ambientPattern:oneOf(raw.ambientPattern,HERITAGE_AMBIENT_PATTERNS,base.ambientPattern),ambientScope:oneOf(raw.ambientScope,HERITAGE_AMBIENT_SCOPES,base.ambientScope),ambientDither:typeof raw.ambientDither==="boolean"?raw.ambientDither:base.ambientDither,glassMode:typeof raw.glassMode==="boolean"?raw.glassMode:base.glassMode,tabHierarchy:oneOf(raw.tabHierarchy,["contextual","stacked","docked"] as const,base.tabHierarchy),tuning:clampHeritageThemeTuning(raw.tuning as Partial<Record<keyof HeritageThemeTuning,unknown>>)};
  }
  if(raw.version!==HERITAGE_THEME_PRESET_VERSION||!raw.material||typeof raw.material!=="object")return null;
  const material=object(raw.material),ambient=object(raw.ambient),shine=object(raw.shine),color=object(raw.color),navigation=object(raw.navigation),presentation=object(raw.presentation);
  const flattened:Partial<Record<keyof HeritageThemeTuning,unknown>>={...base.tuning};
  for(const role of ["major","panel","card","control"] as const){const depth=object(material[role]);flattened[`${role}Transparency`]=depth.transparency;flattened[`${role}Brightness`]=depth.shade;flattened[`${role}Saturation`]=depth.saturation;flattened[`${role}Blur`]=depth.blur;}
  Object.assign(flattened,{ambientVisibility:ambient.visibility,ambientBrightness:ambient.brightness,ambientSaturation:ambient.saturation,motionSeconds:ambient.motionSeconds,shineEnergy:shine.energy,shineBrightness:shine.brightness,shineSaturation:shine.saturation,shineMotion:typeof shine.motion==="boolean"?(shine.motion?1:0):shine.motion,shineSeconds:shine.seconds,haloSoftness:shine.haloSoftness,tintEnergy:color.semanticCueStrength,semanticBackgroundVisibility:color.semanticBackgroundVisibility,semanticBackgroundBrightness:color.semanticBackgroundBrightness,semanticBackgroundSaturation:color.semanticBackgroundSaturation,semanticTextVisibility:color.semanticTextVisibility,semanticBrightness:color.semanticBrightness,semanticSaturation:color.semanticSaturation,contextColorEnergy:color.contextStrength,contextBackgroundVisibility:color.contextBackgroundVisibility,contextColorBrightness:color.contextBrightness,contextColorSaturation:color.contextSaturation,schemeEnergy:color.schemeStrength,schemeBrightness:color.schemeBrightness,schemeContrast:color.schemeContrast,schemeSaturation:color.schemeSaturation,reverseLightBrightness:typeof color.reverseLightBrightness==="boolean"?(color.reverseLightBrightness?1:0):color.reverseLightBrightness,controlProminence:navigation.controlProminence,selectedStateStrength:navigation.selectedStateStrength,selectedStateSaturation:navigation.selectedStateSaturation,selectedStateGlow:navigation.selectedStateGlow,selectedStateMotion:navigation.selectedStateMotion});
  return {...base,palette:oneOf(raw.palette,HERITAGE_PALETTES,base.palette),mode:oneOf(raw.mode,["dark","light"] as const,base.mode),scene:oneOf(raw.scene,["subtle","rich","full"] as const,base.scene),glassMode:typeof raw.glassMode==="boolean"?raw.glassMode:base.glassMode,tabHierarchy:oneOf(raw.tabHierarchy,["contextual","stacked","docked"] as const,base.tabHierarchy),ambientMotion:oneOf(ambient.motion,["animated","still","off"] as const,base.ambientMotion),ambientPattern:oneOf(ambient.pattern,HERITAGE_AMBIENT_PATTERNS,base.ambientPattern),ambientScope:oneOf(ambient.scope,HERITAGE_AMBIENT_SCOPES,base.ambientScope),ambientLayers:oneOf(ambient.layers,HERITAGE_AMBIENT_LAYER_SELECTIONS,base.ambientLayers),ambientDither:typeof ambient.dither==="boolean"?ambient.dither:base.ambientDither,tuning:clampHeritageThemeTuning(flattened),density:oneOf(presentation.density,HERITAGE_DENSITY_MODES,base.density),performanceMode:oneOf(presentation.performanceMode,HERITAGE_PERFORMANCE_MODES,base.performanceMode)};
}
