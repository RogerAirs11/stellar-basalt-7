import { useSyncExternalStore } from "react";
import operatorAppearanceDefaultJson from "../../public/appearance-default.json";
import { compileHeritageThemeTokens, type HeritageThemeTokenMap } from "./heritage/theme/compiler";
import { analyzeHeritageSceneImage, deriveHeritageAutoPaletteTokens, fallbackHeritageAutoPaletteTokens, resolveHeritageSceneImageSource, type HeritageAutoPaletteTokenMap } from "./heritage/theme/autoPalette";
import { applyHeritageVisualAssets } from "./heritageVisualAssets";
import {
  DEFAULT_HERITAGE_THEME_TUNING,
  LEGACY_R23_HERITAGE_THEME_TUNING,
  HERITAGE_PALETTES,
  HERITAGE_AMBIENT_PATTERNS,
  HERITAGE_AMBIENT_SCOPES,
  HERITAGE_AMBIENT_LAYER_SELECTIONS,
  HERITAGE_DENSITY_MODES,
  HERITAGE_PERFORMANCE_MODES,
  detectHeritageWeakDevice,
  clampHeritageThemeTuning,
  parseHeritageThemePreset,
  serializeHeritageThemePreset,
  type HeritageAmbientMotion,
  type HeritageAmbientPattern,
  type HeritageAmbientScope,
  type HeritageAmbientLayerSelection,
  type HeritageAppearanceSnapshot,
  type HeritageDensityMode,
  type HeritageMode,
  type HeritagePalette,
  type HeritagePerformanceMode,
  type HeritageSceneIntensity,
  type HeritageTabHierarchyMode,
  type HeritageThemePresetV22,
  type HeritageThemeTuning,
} from "./heritage/theme/schema";

const APPEARANCE_STORAGE_KEY="registry-heritage-appearance-v22";
const LEGACY_THEME_KEYS=["registry-theme-tuning-v20","registry-theme-tuning-v18","registry-theme-tuning-v16","registry-theme-tuning-v15","registry-theme-tuning-v14","registry-theme-tuning-v13","registry-theme-tuning-v12","registry-theme-tuning-v11","registry-theme-tuning-v10","registry-theme-tuning-v9","registry-theme-tuning-v8","registry-theme-tuning-v7","registry-theme-tuning-v6","registry-theme-tuning-v5"] as const;
const LEGACY_KEYS=["registry-palette","registry-tint-motion"] as const;
const listeners=new Set<()=>void>();
let persistTimer:number|undefined;
let appliedTokens:HeritageThemeTokenMap={};
let appliedAutoPaletteTokens:HeritageAutoPaletteTokenMap={};
const autoPaletteCache=new Map<string,HeritageAutoPaletteTokenMap>();
let autoPaletteGeneration=0;
let bootstrapped=false;

const safeStorage=()=>typeof localStorage!=="undefined"?localStorage:null;
const oneOf=<T extends string>(value:string|null,values:readonly T[],fallback:T):T=>value&&values.includes(value as T)?value as T:fallback;

/**
 * Product built-in default, projected from the user-supplied
 * `horse-registry-theme-auto-dark.json` (v22). Material/ambient/shine/color/navigation
 * tuning is byte-identical to the R24 profile and stays pinned by the portable JSON
 * mapping in heritage/theme/schema.ts; only the default mode moved to Dark, so the
 * scene-aware Auto palette samples the matching adaptive night background.
 *
 * R40: `public/appearance-default.json` is the operator startup default. When it is
 * a valid v22 preset it replaces this constant for fresh visitors AND for the
 * Appearance Studio "Reset" action, so the shipped default look is a plain JSON
 * file instead of compiled values. Personalized localStorage always wins.
 */
export const DEFAULT_HERITAGE_APPEARANCE_PRESET:HeritageAppearanceSnapshot=resolveStartupDefault(
  {
    // R136: the fallback literal mirrors the owner-supplied v22 default export
    // (light mode, compact density) in case the JSON file itself fails to parse.
    // R157: glassMode now ships OFF — solid material (no backdrop blur) is the
    // default surface look; frost remains opt-in from the Appearance Studio.
    palette:"auto",mode:"light",scene:"full",ambientMotion:"animated",ambientPattern:"chromatic",ambientScope:"surfaces",ambientLayers:"major",ambientDither:false,glassMode:false,tabHierarchy:"contextual",density:"compact",performanceMode:"auto",tuning:{...DEFAULT_HERITAGE_THEME_TUNING}
  }
);

function resolveStartupDefault(fallback:HeritageAppearanceSnapshot):HeritageAppearanceSnapshot{
  try{
    const fromFile=parseHeritageThemePreset(operatorAppearanceDefaultJson,fallback);
    return fromFile??fallback;
  }catch{
    return fallback;
  }
}

export const LEGACY_R23_HERITAGE_APPEARANCE_PRESET:HeritageAppearanceSnapshot={
  palette:"auto",mode:"dark",scene:"full",ambientMotion:"animated",ambientPattern:"chromatic",ambientScope:"surfaces",ambientLayers:"major,panel",ambientDither:false,glassMode:false,tabHierarchy:"docked",density:"comfortable",performanceMode:"auto",tuning:{...LEGACY_R23_HERITAGE_THEME_TUNING}
};

function defaultSnapshot():HeritageAppearanceSnapshot{
  const storage=safeStorage();
  const phone=typeof matchMedia!=="undefined"&&matchMedia("(max-width: 820px)").matches;
  const defaults=DEFAULT_HERITAGE_APPEARANCE_PRESET;
  return {
    palette:oneOf(storage?.getItem("registry-palette-v2")??storage?.getItem("registry-palette")??null,HERITAGE_PALETTES,defaults.palette),
    mode:oneOf(storage?.getItem("registry-mode")??null,["dark","light"] as const,defaults.mode),
    scene:oneOf(storage?.getItem("registry-scene")??null,["subtle","rich","full"] as const,defaults.scene),
    ambientMotion:oneOf(storage?.getItem("registry-ambient-motion-v2")??storage?.getItem("registry-tint-motion")??null,["animated","still","off"] as const,defaults.ambientMotion),
    ambientPattern:oneOf(storage?.getItem("registry-ambient-pattern-v1")??null,HERITAGE_AMBIENT_PATTERNS,defaults.ambientPattern),
    ambientScope:oneOf(storage?.getItem("registry-ambient-scope-v1")??null,HERITAGE_AMBIENT_SCOPES,defaults.ambientScope),
    ambientLayers:oneOf(storage?.getItem("registry-ambient-layers-v1")??null,HERITAGE_AMBIENT_LAYER_SELECTIONS,defaults.ambientLayers),
    ambientDither:storage?.getItem("registry-ambient-dither-v2")!=null?storage.getItem("registry-ambient-dither-v2")==="1":defaults.ambientDither,
    glassMode:storage?.getItem("registry-glass")!=null?storage.getItem("registry-glass")!=="0":defaults.glassMode,
    tabHierarchy:phone?"docked":oneOf(storage?.getItem("registry-tab-hierarchy")??null,["contextual","stacked","docked"] as const,defaults.tabHierarchy),
    density:oneOf(storage?.getItem("registry-density-v1")??null,HERITAGE_DENSITY_MODES,phone?"compact":defaults.density),
    performanceMode:oneOf(storage?.getItem("registry-performance-mode-v1")??null,HERITAGE_PERFORMANCE_MODES,defaults.performanceMode),
    tuning:loadLegacyTuning(storage,defaults.tuning),
  };
}

function loadLegacyTuning(storage:Storage|null,fallback:HeritageThemeTuning):HeritageThemeTuning{
  if(!storage)return fallback;
  for(const key of LEGACY_THEME_KEYS){
    const raw=storage.getItem(key); if(!raw)continue;
    try{
      const parsed=JSON.parse(raw) as Record<string,unknown>;
      if(key!==LEGACY_THEME_KEYS[0]&&parsed.majorBlur===30&&parsed.panelBlur===20&&parsed.cardBlur===14&&parsed.controlBlur===8){parsed.majorBlur=24;parsed.panelBlur=14;parsed.cardBlur=8;parsed.controlBlur=4;}
      if(typeof parsed.majorBlur!=="number"&&typeof parsed.blur==="number"){
        const blur=Math.max(2,Math.min(64,parsed.blur)); parsed.majorBlur=blur;parsed.panelBlur=Math.max(4,Math.round(blur*.67));parsed.cardBlur=Math.max(3,Math.round(blur*.47));parsed.controlBlur=Math.max(2,Math.round(blur*.27));
      }
      for(const role of ["major","panel","card","control"] as const){if(typeof parsed[`${role}Brightness`]!=="number")parsed[`${role}Brightness`]=0;if(typeof parsed[`${role}Saturation`]!=="number")parsed[`${role}Saturation`]=100;}
      if(typeof parsed.haloSoftness!=="number"&&typeof parsed.gasSoftness==="number")parsed.haloSoftness=parsed.gasSoftness;
      if(typeof parsed.semanticBackgroundBrightness!=="number"&&typeof parsed.semanticBrightness==="number")parsed.semanticBackgroundBrightness=parsed.semanticBrightness;
      if(typeof parsed.semanticBackgroundSaturation!=="number"&&typeof parsed.semanticSaturation==="number")parsed.semanticBackgroundSaturation=parsed.semanticSaturation;
      if(typeof parsed.semanticTextVisibility!=="number")parsed.semanticTextVisibility=100;
      return clampHeritageThemeTuning(parsed as Partial<Record<keyof HeritageThemeTuning,unknown>>);
    }catch{/* try older key */}
  }
  return fallback;
}

function resolveResponsiveSnapshot(value:HeritageAppearanceSnapshot):HeritageAppearanceSnapshot{
  // Phone mode must paint Docked on the very first frame, even when a persisted
  // desktop/contextual v22 preset exists. The live media listener in App keeps
  // this invariant when the viewport crosses into phone mode after boot.
  const phone=typeof matchMedia!=="undefined"&&matchMedia("(max-width: 820px)").matches;
  return phone&&value.tabHierarchy!=="docked"?{...value,tabHierarchy:"docked"}:value;
}

function loadSnapshot():HeritageAppearanceSnapshot{
  const fallback=defaultSnapshot(),storage=safeStorage(),raw=storage?.getItem(APPEARANCE_STORAGE_KEY);
  if(!raw)return resolveResponsiveSnapshot(fallback);
  try{return resolveResponsiveSnapshot(parseHeritageThemePreset(JSON.parse(raw),fallback)??fallback);}catch{return resolveResponsiveSnapshot(fallback);}
}

let snapshot=loadSnapshot();

function applyTokens(root:HTMLElement,next:HeritageThemeTokenMap){
  for(const [name,value] of Object.entries(next))if(appliedTokens[name]!==value)root.style.setProperty(name,value);
  for(const name of Object.keys(appliedTokens))if(!(name in next))root.style.removeProperty(name);
  appliedTokens=next;
  for(const dead of ["--h-user-gas-softness","--h-user-gas-blur","--h-user-gas-spread-x","--h-user-gas-spread-y","--h-user-surface-motion-speed","--h-user-tab-motion-speed"])root.style.removeProperty(dead);
}

function applyAutoPaletteTokens(root:HTMLElement,next:HeritageAutoPaletteTokenMap){
  for(const [name,value] of Object.entries(next))if(appliedAutoPaletteTokens[name]!==value)root.style.setProperty(name,value,"important");
  for(const name of Object.keys(appliedAutoPaletteTokens))if(!(name in next))root.style.removeProperty(name);
  appliedAutoPaletteTokens=next;
}
function clearAutoPaletteTokens(root:HTMLElement){
  for(const name of Object.keys(appliedAutoPaletteTokens))root.style.removeProperty(name);
  appliedAutoPaletteTokens={};delete root.dataset.autoPaletteStatus;delete root.dataset.autoPaletteSource;
}
async function refreshAutoPaletteFor(value:HeritageAppearanceSnapshot,{force=false}:{force?:boolean}={}){
  if(typeof document==="undefined"||value.palette!=="auto")return false;
  const root=document.documentElement,mode=value.mode,source=resolveHeritageSceneImageSource(mode,root),key=`${mode}|${source}`;
  const generation=++autoPaletteGeneration;
  applyAutoPaletteTokens(root,fallbackHeritageAutoPaletteTokens(mode));root.dataset.autoPaletteStatus="sampling";root.dataset.autoPaletteSource=source;
  try{
    if(force)autoPaletteCache.delete(key);
    let tokens=autoPaletteCache.get(key);
    if(!tokens){const signature=await analyzeHeritageSceneImage(source);tokens=deriveHeritageAutoPaletteTokens(signature,mode);autoPaletteCache.set(key,tokens);}
    if(generation!==autoPaletteGeneration||snapshot.palette!=="auto"||snapshot.mode!==mode)return false;
    applyAutoPaletteTokens(root,tokens);root.dataset.autoPaletteStatus="ready";return true;
  }catch{
    if(generation!==autoPaletteGeneration||snapshot.palette!=="auto"||snapshot.mode!==mode)return false;
    root.dataset.autoPaletteStatus="fallback";return false;
  }
}

export function applyHeritageAppearance(value:HeritageAppearanceSnapshot){
  if(typeof document==="undefined")return;
  const root=document.documentElement;
  root.dataset.palette=value.palette;root.dataset.mode=value.mode;root.dataset.scene=value.scene;root.dataset.ambientMotion=value.ambientMotion;root.dataset.ambientPattern=value.ambientPattern;root.dataset.ambientScope=value.ambientScope;root.dataset.ambientLayers=value.ambientLayers;root.dataset.ambientDither=value.ambientDither?"1":"0";root.dataset.glass=value.glassMode?"1":"0";root.dataset.tabHierarchy=value.tabHierarchy;root.dataset.visualArchitecture="2";root.dataset.density=value.density;
  // Performance mode: "auto" resolves to lite on weak devices so slow hardware
  // skips the heaviest decoration without any manual configuration.
  root.dataset.perf=value.performanceMode==="lite"||(value.performanceMode==="auto"&&detectHeritageWeakDevice())?"lite":"full";
  // Transitional compatibility only. Historical animation branches remain frozen
  // under a deliberately renamed channel while the live Ambient contract uses
  // data-ambient-motion exclusively.
  root.dataset.hLegacyMotion="still";
  root.dataset.shineMotion=value.tuning.shineMotion>=.5?"1":"0";
  applyHeritageVisualAssets(value.mode);
  applyTokens(root,compileHeritageThemeTokens(value.tuning,value.mode));
  if(value.palette==="auto")void refreshAutoPaletteFor(value);else{autoPaletteGeneration++;clearAutoPaletteTokens(root);}
}

function persist(){
  persistTimer=undefined;const storage=safeStorage();if(!storage)return;
  storage.setItem(APPEARANCE_STORAGE_KEY,JSON.stringify(serializeHeritageThemePreset(snapshot)));
}
function schedulePersist(){if(typeof window==="undefined")return;if(persistTimer!==undefined)window.clearTimeout(persistTimer);persistTimer=window.setTimeout(persist,180);}
function emit(){for(const listener of listeners)listener();}
function commit(next:HeritageAppearanceSnapshot,{persistChange=true}:{persistChange?:boolean}={}){snapshot=next;applyHeritageAppearance(snapshot);emit();if(persistChange)schedulePersist();}

export function bootstrapHeritageAppearance(){
  if(bootstrapped){applyHeritageAppearance(snapshot);return snapshot;}
  bootstrapped=true;applyHeritageAppearance(snapshot);
  const storage=safeStorage();
  if(storage){
    // Migration cleanup happens once at startup rather than during slider input.
    for(const key of LEGACY_THEME_KEYS)storage.removeItem(key);
    for(const key of LEGACY_KEYS)storage.removeItem(key);
    storage.setItem("registry-palette-v2",snapshot.palette);storage.setItem("registry-mode",snapshot.mode);storage.setItem("registry-scene",snapshot.scene);storage.setItem("registry-ambient-motion-v2",snapshot.ambientMotion);storage.setItem("registry-ambient-pattern-v1",snapshot.ambientPattern);storage.setItem("registry-ambient-scope-v1",snapshot.ambientScope);storage.setItem("registry-ambient-layers-v1",snapshot.ambientLayers);storage.setItem("registry-ambient-dither-v2",snapshot.ambientDither?"1":"0");storage.setItem("registry-glass",snapshot.glassMode?"1":"0");storage.setItem("registry-tab-hierarchy",snapshot.tabHierarchy);storage.setItem("registry-tab-hierarchy-phone-default-v1","1");storage.setItem("registry-density-v1",snapshot.density);storage.setItem("registry-performance-mode-v1",snapshot.performanceMode);
    persist();
  }
  return snapshot;
}

export const getHeritageAppearance=()=>snapshot;
export const subscribeHeritageAppearance=(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener)};
export function setHeritageAppearance(patch:Partial<Omit<HeritageAppearanceSnapshot,"tuning">>&{tuning?:HeritageThemeTuning}){commit({...snapshot,...patch,tuning:patch.tuning??snapshot.tuning});}
export function setHeritageThemeTuning(tuning:HeritageThemeTuning){commit({...snapshot,tuning:clampHeritageThemeTuning(tuning)});}
export function updateHeritageThemeTuning(key:keyof HeritageThemeTuning,value:number){setHeritageThemeTuning(clampHeritageThemeTuning({...snapshot.tuning,[key]:value}));}
export function resetHeritageThemeTuning(){setHeritageThemeTuning(DEFAULT_HERITAGE_APPEARANCE_PRESET.tuning);}
export type HeritageBuiltInPreset="default"|"legacy-r23";
export function applyHeritageBuiltInPreset(preset:HeritageBuiltInPreset){
  const source=preset==="legacy-r23"?LEGACY_R23_HERITAGE_APPEARANCE_PRESET:DEFAULT_HERITAGE_APPEARANCE_PRESET;
  const next=resolveResponsiveSnapshot({...source,tuning:{...source.tuning}});
  commit(next);
  return next;
}
export function refreshHeritageAutoPalette(){return refreshAutoPaletteFor(snapshot,{force:true});}
export function exportHeritageThemePreset():HeritageThemePresetV22{return serializeHeritageThemePreset(snapshot);}
export function importHeritageThemePreset(input:unknown):boolean{const next=parseHeritageThemePreset(input,snapshot);if(!next)return false;commit(next);return true;}

export function useHeritageAppearanceValue<T>(selector:(value:HeritageAppearanceSnapshot)=>T):T{
  return useSyncExternalStore(subscribeHeritageAppearance,()=>selector(snapshot),()=>selector(snapshot));
}
export function useHeritageAppearanceSnapshot():HeritageAppearanceSnapshot{return useSyncExternalStore(subscribeHeritageAppearance,getHeritageAppearance,getHeritageAppearance);}

export type { HeritageAppearanceSnapshot, HeritageThemeTuning, HeritagePalette, HeritageMode, HeritageSceneIntensity, HeritageAmbientMotion, HeritageAmbientPattern, HeritageAmbientScope, HeritageAmbientLayerSelection, HeritageDensityMode, HeritagePerformanceMode, HeritageTabHierarchyMode };
