import { useSyncExternalStore } from "react";
import type { HeritageMode } from "./heritage/theme/schema";

import { availablePublicAsset, FALLBACK_ASSETS, HERITAGE_DECORATION, PARTICLE_HORSE_MODEL_URL } from "./assetCatalog";

export type HeritageBackgroundArt=string;
export type HeritageBrandArt=string;
export type HeritageSplashArt=string;
export type HeritageSplashRenderMode="image"|"particle-horse";
export type HeritageSplashOption={id:HeritageSplashArt;label:string;labelFa?:string;source:string|null;renderMode?:HeritageSplashRenderMode};
export type HeritageBackgroundMode="dark"|"light"|"both";
export type HeritageVisualAssetKind="background"|"brand"|"splash";
/* R135: the WebGL depth-map engine is retired; saved "depth" preferences
   degrade to the parallax layers stage. Only flat + layers remain. */
export type HeritageBackgroundEngine="flat"|"layers";

export type HeritageBackgroundThreeDScene={
  id:string;
  preview:string;
  layerSources:readonly string[];
  /* R135: the depth-map stage is retired — the fields stay optional so old
     scene-pack registrations keep compiling but nothing consumes them. */
  depthBase?:string;
  depthMap?:string;
  preferredEngine?:Exclude<HeritageBackgroundEngine,"flat">;
};

export type HeritageBackgroundOption={
  id:HeritageBackgroundArt;
  label:string;
  labelFa?:string;
  source:string|null;
  mode:HeritageBackgroundMode;
  threeD?:HeritageBackgroundThreeDScene;
};

export type HeritageVisualAssetsSnapshot={
  backgroundArt:HeritageBackgroundArt;
  backgroundFocusX:number;
  backgroundFocusY:number;
  backgroundBottomFade:boolean;
  backgroundFitWidth:boolean;
  /** R37 — scroll-parallax & overscan switch. OFF (default) renders wallpapers perfectly fitted: no vertical overscan, no scroll-driven travel. */
  backgroundParallax:boolean;
  backgroundEngine:HeritageBackgroundEngine;
  background3DStrength:number;
  background3DZoom:number;
  background3DAutoMotion:boolean;
  background3DBlur:boolean;
  favoriteBackgrounds:HeritageBackgroundArt[];
  brandArt:HeritageBrandArt;
  brandScale:number;
  favoriteBrands:HeritageBrandArt[];
  splashArt:HeritageSplashArt;
  splashScale:number;
  favoriteSplashes:HeritageSplashArt[];
  customBackground:string;
  customBrand:string;
  customSplash:string;
};

export type HeritageVisualAssetsPortablePresetV1={
  version:1;
  backgroundArt:HeritageBackgroundArt;
  backgroundFocusX:number;
  backgroundFocusY:number;
  backgroundBottomFade:boolean;
  backgroundFitWidth?:boolean;
  backgroundParallax?:boolean;
  backgroundEngine?:HeritageBackgroundEngine;
  background3DStrength?:number;
  background3DZoom?:number;
  background3DAutoMotion?:boolean;
  background3DBlur?:boolean;
  favoriteBackgrounds:HeritageBackgroundArt[];
  brandArt:HeritageBrandArt;
  brandScale:number;
  favoriteBrands:HeritageBrandArt[];
  splashArt:HeritageSplashArt;
  splashScale:number;
  favoriteSplashes:HeritageSplashArt[];
};

const GENERATED_DARK_WALLPAPERS=import.meta.glob("./assets/heritage-wallpapers/dark/*.avif",{eager:true,import:"default"}) as Record<string,string>;
const GENERATED_LIGHT_WALLPAPERS=import.meta.glob("./assets/heritage-wallpapers/light/*.avif",{eager:true,import:"default"}) as Record<string,string>;
const EXTRA_BACKGROUND_LIBRARY=import.meta.glob("./assets/heritage-art-library/backgrounds/*.webp",{eager:true,import:"default"}) as Record<string,string>;
const EXTRA_LOGO_LIBRARY=import.meta.glob("./assets/heritage-art-library/logos/*.webp",{eager:true,import:"default"}) as Record<string,string>;

// A scene is selectable only when its complete original pack is shipped. The
// R147 upload omitted all packs; static imports made the entire build fail.
const SCENE_FILES=import.meta.glob("./assets/heritage-parallax-scenes/**/*.{avif,webp}",{eager:true,import:"default"}) as Record<string,string>;
function builtInScene(id:string,previewName:string,layerCount:number,extension:string):HeritageBackgroundThreeDScene|undefined{
  const prefix=`./assets/heritage-parallax-scenes/${id}/`;
  const preview=SCENE_FILES[`${prefix}${previewName}.${extension}`];
  const layerSources=Array.from({length:layerCount},(_,index)=>SCENE_FILES[`${prefix}layer-${index+1}.${extension}`]);
  if(!preview||layerSources.some(source=>!source))return undefined;
  return {id,preview,layerSources,preferredEngine:"layers"};
}
const BUILTIN_3D_SCENES={
  achaemenid:builtInScene("achaemenid","base",5,"avif"),
  horses:builtInScene("horses","base",5,"avif"),
  nightValley:builtInScene("night-valley","preview",4,"webp"),
  nightAxis:builtInScene("night-axis","preview",4,"webp"),
};

/* R53 — the six horse-portrait "wallpapers" (desert/mountain/shore/woodland/
   snow/wildflower) were retired: those images are registry profile placeholders
   (see sharedAssets.ts) and must never appear as page backgrounds. Backgrounds
   remain: adaptive day/night, the three 3D parallax scenes, the generated
   dark/light wallpaper collections, the art library and custom uploads.
   Any stored selection of a retired id normalizes back to the default. */
const SCENE_DEFINITIONS=[
  {id:"achaemenid-3d",label:"Achaemenid 3D Palace",labelFa:"کاخ هخامنشی سه‌بعدی",threeD:BUILTIN_3D_SCENES.achaemenid},
  {id:"arabian-valley-3d",label:"Arabian Horse Valley 3D",labelFa:"دره اسب عربی سه‌بعدی",threeD:BUILTIN_3D_SCENES.horses},
  {id:"moonlit-valley-overlook-3d",label:"Moonlit Valley Overlook 3D",labelFa:"چشم‌انداز دره مهتابی سه‌بعدی",threeD:BUILTIN_3D_SCENES.nightValley},
  {id:"moonlit-royal-axis-3d",label:"Moonlit Royal Axis 3D",labelFa:"محور شاهانه مهتابی سه‌بعدی",threeD:BUILTIN_3D_SCENES.nightAxis},
];
const LEGACY_BACKGROUND_OPTIONS:HeritageBackgroundOption[]=SCENE_DEFINITIONS.flatMap(option=>option.threeD?[{...option,source:option.threeD.preview,mode:"both"}]:[]);

const titleCase=(value:string)=>value
  .replace(/[-_]+/g," ")
  .replace(/\bavif\b/gi,"")
  .replace(/\bboa\b/gi,"BOA")
  .replace(/\bcgi\b/gi,"CGI")
  .replace(/\bhud\b/gi,"HUD")
  .replace(/\bscifi\b/gi,"Sci-Fi")
  .replace(/\s+/g," ")
  .trim()
  .replace(/\b([a-z])/g,char=>char.toUpperCase());
const pathStem=(path:string)=>path.split("/").pop()?.replace(/\.(?:avif|webp)$/i,"")??path;
const buildGeneratedOptions=(catalog:Record<string,string>,mode:Extract<HeritageBackgroundMode,"dark"|"light">):HeritageBackgroundOption[]=>Object.entries(catalog)
  .map(([path,source])=>({id:pathStem(path),label:titleCase(pathStem(path)),source,mode}))
  .sort((a,b)=>a.label.localeCompare(b.label));
const buildLibraryBackgroundOptions=(catalog:Record<string,string>):HeritageBackgroundOption[]=>Object.entries(catalog)
  .map(([path,source])=>({id:`library-bg-${pathStem(path)}`,label:titleCase(pathStem(path)),source,mode:"both" as const}))
  .sort((a,b)=>a.label.localeCompare(b.label));
const buildLibraryLogoOptions=(catalog:Record<string,string>)=>Object.entries(catalog)
  .map(([path,source])=>({id:`library-logo-${pathStem(path)}`,label:titleCase(pathStem(path)),source}))
  .sort((a,b)=>a.label.localeCompare(b.label));
const EXTRA_LOGO_OPTIONS=buildLibraryLogoOptions(EXTRA_LOGO_LIBRARY);

/* R150 — "none" wallpaper: a fine-grained, very faint girih star-and-cross
   lattice rendered from an inline SVG tile (no photo, no network fetch).
   One tile variant per mode keeps the strokes barely-there on both themes. */
const SUBTLE_PATTERN_TILE_DARK="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Cg fill='none' stroke='rgba(255,255,255,0.32)' stroke-width='1'%3E%3Crect x='24' y='24' width='48' height='48'/%3E%3Cpolygon points='48,10.6 85.4,48 48,85.4 10.6,48'/%3E%3Cg transform='rotate(45)'%3E%3Crect x='-24' y='-24' width='48' height='48'/%3E%3Crect x='72' y='-24' width='48' height='48'/%3E%3Crect x='-24' y='72' width='48' height='48'/%3E%3Crect x='72' y='72' width='48' height='48'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E";
const SUBTLE_PATTERN_TILE_LIGHT="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Cg fill='none' stroke='rgba(23,32,38,0.22)' stroke-width='1'%3E%3Crect x='24' y='24' width='48' height='48'/%3E%3Cpolygon points='48,10.6 85.4,48 48,85.4 10.6,48'/%3E%3Cg transform='rotate(45)'%3E%3Crect x='-24' y='-24' width='48' height='48'/%3E%3Crect x='72' y='-24' width='48' height='48'/%3E%3Crect x='-24' y='72' width='48' height='48'/%3E%3Crect x='72' y='72' width='48' height='48'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E";

export const HERITAGE_BACKGROUND_OPTIONS:readonly HeritageBackgroundOption[]=[
  {id:"none",label:"No wallpaper — subtle pattern",labelFa:"بدون تصویر — الگوی محو",source:null,mode:"both"},
  {id:"adaptive",label:"Adaptive Day / Night",labelFa:"تطبیقی روز / شب",source:null,mode:"both"},
  ...LEGACY_BACKGROUND_OPTIONS,
  ...buildGeneratedOptions(GENERATED_DARK_WALLPAPERS,"dark"),
  ...buildGeneratedOptions(GENERATED_LIGHT_WALLPAPERS,"light"),
  ...buildLibraryBackgroundOptions(EXTRA_BACKGROUND_LIBRARY),
  {id:"custom",label:"Custom image",labelFa:"تصویر سفارشی",source:null,mode:"both"},
] as const;

const ORIGINAL_BRAND_OPTIONS=[
  {id:"brand",label:"Classic Mark",source:"/assets/arabian-brand-mark.webp"},
  {id:"equine",label:"Equine Crest",source:"/assets/equine-crest.webp"},
  {id:"heritage",label:"Heritage Crest",source:"/assets/arabian-hero-crest.webp"},
  {id:"q8",label:"Q8 Heraldry",source:"/assets/arabian-q8-hero-fit.webp"},
];
export const HERITAGE_BRAND_ART_OPTIONS:readonly {id:HeritageBrandArt;label:string;source:string|null}[]=[
  {id:"registry-neutral",label:"Registry Monogram",source:FALLBACK_ASSETS.brand},
  ...ORIGINAL_BRAND_OPTIONS.filter(option=>availablePublicAsset(option.source)),
  ...EXTRA_LOGO_OPTIONS,
  {id:"custom",label:"Custom logo",source:null},
] as const;
const ORIGINAL_SPLASH_OPTIONS=[
  {id:"heritage",label:"Heritage Crest",source:"/assets/arabian-hero-crest.webp"},
  {id:"q8",label:"Q8 Full",source:"/assets/arabian-q8-hero-fit.webp"},
  {id:"q8crop",label:"Q8 Crop",source:"/assets/arabian-q8-hero-cropped.webp"},
  {id:"equine",label:"Equine Crest",source:"/assets/equine-crest.webp"},
  {id:"brand",label:"Classic Mark",source:"/assets/arabian-brand-mark.webp"},
];
export const HERITAGE_SPLASH_ART_OPTIONS:readonly HeritageSplashOption[]=[
  {id:"registry-neutral",label:"Registry Monogram",labelFa:"نشان ساده سامانه ثبت",source:FALLBACK_ASSETS.brand},
  ...ORIGINAL_SPLASH_OPTIONS.filter(option=>availablePublicAsset(option.source)),
  ...(PARTICLE_HORSE_MODEL_URL?[{id:"particle-horse",label:"Kinetic Particle Horse",labelFa:"اسب ذره‌ای جنبشی",source:null,renderMode:"particle-horse" as const}]:[]),
  ...EXTRA_LOGO_OPTIONS,
  {id:"custom",label:"Custom splash",source:null},
] as const;

const STORAGE_KEY="registry-heritage-visual-assets-v1";
const listeners=new Set<()=>void>();
export const LEGACY_R23_VISUAL_ASSETS:HeritageVisualAssetsSnapshot={
  backgroundArt:"adaptive",backgroundFocusX:50,backgroundFocusY:50,backgroundBottomFade:false,backgroundFitWidth:false,backgroundParallax:false,backgroundEngine:"flat",background3DStrength:100,background3DZoom:100,background3DAutoMotion:true,background3DBlur:false,favoriteBackgrounds:[],
  brandArt:availablePublicAsset("/assets/arabian-brand-mark.webp")?"brand":"registry-neutral",brandScale:100,favoriteBrands:[],
  splashArt:availablePublicAsset("/assets/arabian-hero-crest.webp")?"heritage":"registry-neutral",splashScale:100,favoriteSplashes:[],
  customBackground:"",customBrand:"",customSplash:""
};

/**
 * Product built-in default (owner directive, R150): no photo wallpaper — a
 * very subtle girih lattice pattern on the flat engine, the antique gold
 * crescent-horse emblem as the header logo and the Achaemenid horse-and-sun
 * medallion splash.
 */
export const DEFAULT_VISUAL_ASSETS:HeritageVisualAssetsSnapshot={
  backgroundArt:"none",backgroundFocusX:50,backgroundFocusY:50,backgroundBottomFade:true,backgroundFitWidth:true,backgroundParallax:false,backgroundEngine:"flat",background3DStrength:100,background3DZoom:100,background3DAutoMotion:true,background3DBlur:false,favoriteBackgrounds:[],
  brandArt:EXTRA_LOGO_OPTIONS.some(option=>option.id==="library-logo-antique_gold_crescent_horse_emblem")?"library-logo-antique_gold_crescent_horse_emblem":"registry-neutral",brandScale:100,favoriteBrands:[],
  splashArt:EXTRA_LOGO_OPTIONS.some(option=>option.id==="library-logo-achaemenid_horse_sun_medallion")?"library-logo-achaemenid_horse_sun_medallion":"registry-neutral",splashScale:100,favoriteSplashes:[],
  customBackground:"",customBrand:"",customSplash:""
};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const oneOf=<T extends string>(value:unknown,values:readonly T[],fallback:T):T=>typeof value==="string"&&values.includes(value as T)?value as T:fallback;
const uniqueKnown=<T extends string>(value:unknown,values:readonly T[]):T[]=>Array.isArray(value)?Array.from(new Set(value.filter((item):item is T=>typeof item==="string"&&values.includes(item as T)))):[];
const BACKGROUNDS=HERITAGE_BACKGROUND_OPTIONS.map(x=>x.id),BRANDS=HERITAGE_BRAND_ART_OPTIONS.map(x=>x.id),SPLASHES=HERITAGE_SPLASH_ART_OPTIONS.map(x=>x.id);
const BACKGROUND_ENGINES:[HeritageBackgroundEngine,...HeritageBackgroundEngine[]]=["flat","layers"];

const isOptionVisibleForMode=(option:HeritageBackgroundOption,mode:HeritageMode)=>option.mode==="both"||option.mode===mode;
const resolveBuiltInBackgroundOption=(id:HeritageBackgroundArt,mode:HeritageMode)=>HERITAGE_BACKGROUND_OPTIONS.find(option=>option.id===id&&isOptionVisibleForMode(option,mode));

export function getHeritageBackgroundOptions(mode:HeritageMode){return HERITAGE_BACKGROUND_OPTIONS.filter(option=>isOptionVisibleForMode(option,mode));}
export function getHeritageBackgroundOption(id:HeritageBackgroundArt,mode:HeritageMode=(typeof document!=="undefined"&&document.documentElement.dataset.mode==="light"?"light":"dark")){return resolveBuiltInBackgroundOption(id,mode)??HERITAGE_BACKGROUND_OPTIONS.find(option=>option.id===id);}
export function getHeritageBackgroundLabel(id:HeritageBackgroundArt,locale:"en"|"fa"="en"){
  const option=HERITAGE_BACKGROUND_OPTIONS.find(item=>item.id===id);
  if(!option)return id;
  return locale==="fa"?option.labelFa??option.label:option.label;
}
export function getHeritageBackgroundThreeDScene(id:HeritageBackgroundArt,mode:HeritageMode=(typeof document!=="undefined"&&document.documentElement.dataset.mode==="light"?"light":"dark")){return getHeritageBackgroundOption(id,mode)?.threeD;}
export function hasHeritageBackgroundThreeDScene(id:HeritageBackgroundArt,mode:HeritageMode=(typeof document!=="undefined"&&document.documentElement.dataset.mode==="light"?"light":"dark")){return Boolean(getHeritageBackgroundThreeDScene(id,mode));}
export function getResolvedHeritageBackgroundEngine(value=snapshot,mode:HeritageMode=(typeof document!=="undefined"&&document.documentElement.dataset.mode==="light"?"light":"dark")):HeritageBackgroundEngine{
  const scene3d=getHeritageBackgroundThreeDScene(value.backgroundArt,mode);
  if(!scene3d)return "flat";
  /* R135: the WebGL depth-map stage is retired (owner directive). oneOf()
     already re-normalizes any saved "depth" preference to the default, and
     scenes whose pack preferred depth now resolve to their parallax layers. */
  if(value.backgroundEngine==="layers"&&scene3d.layerSources.length)return "layers";
  if(value.backgroundEngine==="flat")return "flat";
  return scene3d.preferredEngine==="layers"&&scene3d.layerSources.length?"layers":"flat";
}

function normalizeVisualAssetsSnapshot(raw:Record<string,unknown>,splashFallback:HeritageSplashArt,customBackground:string,customBrand:string,customSplash:string):HeritageVisualAssetsSnapshot{
  let backgroundArt=oneOf(raw.backgroundArt,BACKGROUNDS,DEFAULT_VISUAL_ASSETS.backgroundArt);if(backgroundArt==="custom"&&!customBackground)backgroundArt=DEFAULT_VISUAL_ASSETS.backgroundArt;
  let brandArt=oneOf(raw.brandArt,BRANDS,DEFAULT_VISUAL_ASSETS.brandArt);if(brandArt==="custom"&&!customBrand)brandArt=DEFAULT_VISUAL_ASSETS.brandArt;
  let splashArt=oneOf(raw.splashArt,SPLASHES,splashFallback);if(splashArt==="custom"&&!customSplash)splashArt=splashFallback;
  return {
    backgroundArt,
    backgroundFocusX:clamp(Number(raw.backgroundFocusX??DEFAULT_VISUAL_ASSETS.backgroundFocusX),0,100),
    backgroundFocusY:clamp(Number(raw.backgroundFocusY??DEFAULT_VISUAL_ASSETS.backgroundFocusY),0,100),
    backgroundBottomFade:typeof raw.backgroundBottomFade==="boolean"?raw.backgroundBottomFade:DEFAULT_VISUAL_ASSETS.backgroundBottomFade,
    backgroundFitWidth:typeof raw.backgroundFitWidth==="boolean"?raw.backgroundFitWidth:DEFAULT_VISUAL_ASSETS.backgroundFitWidth,
    backgroundParallax:typeof raw.backgroundParallax==="boolean"?raw.backgroundParallax:DEFAULT_VISUAL_ASSETS.backgroundParallax,
    backgroundEngine:oneOf(raw.backgroundEngine,BACKGROUND_ENGINES,DEFAULT_VISUAL_ASSETS.backgroundEngine),
    background3DStrength:clamp(Number(raw.background3DStrength??DEFAULT_VISUAL_ASSETS.background3DStrength),20,180),
    background3DZoom:clamp(Number(raw.background3DZoom??DEFAULT_VISUAL_ASSETS.background3DZoom),75,125),
    background3DAutoMotion:typeof raw.background3DAutoMotion==="boolean"?raw.background3DAutoMotion:DEFAULT_VISUAL_ASSETS.background3DAutoMotion,
    background3DBlur:typeof raw.background3DBlur==="boolean"?raw.background3DBlur:DEFAULT_VISUAL_ASSETS.background3DBlur,
    favoriteBackgrounds:Array.isArray(raw.favoriteBackgrounds)?uniqueKnown(raw.favoriteBackgrounds,BACKGROUNDS):[...DEFAULT_VISUAL_ASSETS.favoriteBackgrounds],
    brandArt,
    brandScale:clamp(Number(raw.brandScale??DEFAULT_VISUAL_ASSETS.brandScale),60,145),
    favoriteBrands:Array.isArray(raw.favoriteBrands)?uniqueKnown(raw.favoriteBrands,BRANDS):[...DEFAULT_VISUAL_ASSETS.favoriteBrands],
    splashArt,
    splashScale:clamp(Number(raw.splashScale??DEFAULT_VISUAL_ASSETS.splashScale),55,145),
    favoriteSplashes:Array.isArray(raw.favoriteSplashes)?uniqueKnown(raw.favoriteSplashes,SPLASHES):[...DEFAULT_VISUAL_ASSETS.favoriteSplashes],
    customBackground,
    customBrand,
    customSplash,
  };
}

function loadSnapshot():HeritageVisualAssetsSnapshot{
  if(typeof localStorage==="undefined")return DEFAULT_VISUAL_ASSETS;
  let raw:Record<string,unknown>={};
  try{const saved=localStorage.getItem(STORAGE_KEY);if(saved)raw=JSON.parse(saved) as Record<string,unknown>;}catch{/* use defaults */}
  const legacyHero=localStorage.getItem("registry-hero-art");
  const splashFallback:HeritageSplashArt=legacyHero==="q8"?"q8":legacyHero?"heritage":DEFAULT_VISUAL_ASSETS.splashArt;
  const customBackground=typeof raw.customBackground==="string"?raw.customBackground:"";
  const customBrand=typeof raw.customBrand==="string"?raw.customBrand:"";
  const customSplash=typeof raw.customSplash==="string"?raw.customSplash:"";
  return normalizeVisualAssetsSnapshot(raw,splashFallback,customBackground,customBrand,customSplash);
}

let snapshot=loadSnapshot();
let bootstrapped=false;

export function resolveHeritageBackgroundSource(value=snapshot,mode:HeritageMode=(typeof document!=="undefined"&&document.documentElement.dataset.mode==="light"?"light":"dark")){
  if(value.backgroundArt==="custom"&&value.customBackground)return value.customBackground;
  if(value.backgroundArt==="none")return mode==="light"?SUBTLE_PATTERN_TILE_LIGHT:SUBTLE_PATTERN_TILE_DARK;
  if(value.backgroundArt==="adaptive")return mode==="light"?HERITAGE_DECORATION.day:HERITAGE_DECORATION.night;
  return resolveBuiltInBackgroundOption(value.backgroundArt,mode)?.source??(mode==="light"?HERITAGE_DECORATION.day:HERITAGE_DECORATION.night);
}
export function resolveHeritageBrandSource(value=snapshot){return value.brandArt==="custom"&&value.customBrand?value.customBrand:HERITAGE_BRAND_ART_OPTIONS.find(x=>x.id===value.brandArt)?.source??HERITAGE_DECORATION.brand;}
export function resolveHeritageSplashSource(value=snapshot){return value.splashArt==="custom"&&value.customSplash?value.customSplash:HERITAGE_SPLASH_ART_OPTIONS.find(x=>x.id===value.splashArt)?.source??HERITAGE_DECORATION.splash;}

export function applyHeritageVisualAssets(mode?:HeritageMode){
  if(typeof document==="undefined")return;
  const root=document.documentElement,resolvedMode=mode??(root.dataset.mode==="light"?"light":"dark"),background=resolveHeritageBackgroundSource(snapshot,resolvedMode),scene3d=getHeritageBackgroundThreeDScene(snapshot.backgroundArt,resolvedMode),resolvedEngine=getResolvedHeritageBackgroundEngine(snapshot,resolvedMode);
  root.dataset.backgroundArt=snapshot.backgroundArt;
  root.dataset.backgroundBottomFade=snapshot.backgroundBottomFade?"1":"0";
  root.dataset.backgroundFitWidth=snapshot.backgroundFitWidth?"1":"0";
  root.dataset.backgroundParallax=snapshot.backgroundParallax?"1":"0";
  root.dataset.backgroundEngine=snapshot.backgroundEngine;
  root.dataset.hSceneEngine=resolvedEngine;
  root.dataset.hScene3d=scene3d?"1":"0";
  root.dataset.brandArt=snapshot.brandArt;
  root.dataset.splashArt=snapshot.splashArt;
  root.style.setProperty("--h-user-hero-scene",`url("${background.replace(/"/g,"%22")}")`);
  root.style.removeProperty("--hero-scene");
  root.style.setProperty("--h-divider",`url("${HERITAGE_DECORATION.divider}")`);
  root.style.setProperty("--h-scene-focus-x",`${snapshot.backgroundFocusX}%`);
  root.style.setProperty("--h-scene-focus-y",`${snapshot.backgroundFocusY}%`);
  root.style.setProperty("--h-scene-3d-strength",`${snapshot.background3DStrength/100}`);
  root.style.setProperty("--h-scene-3d-zoom",`${snapshot.background3DZoom/100}`);
  root.style.setProperty("--h-brand-art-scale",`${snapshot.brandScale/100}`);
  root.style.setProperty("--h-splash-art-scale",`${snapshot.splashScale/100}`);
}
function persist(){if(typeof localStorage==="undefined")return false;try{localStorage.setItem(STORAGE_KEY,JSON.stringify(snapshot));localStorage.removeItem("registry-hero-art");return true;}catch(error){console.warn("[Horse DB] Unable to persist visual assets",error);return false;}}
function emit(){for(const listener of listeners)listener();}
export function bootstrapHeritageVisualAssets(){if(!bootstrapped){bootstrapped=true;persist();}applyHeritageVisualAssets();return snapshot;}
export function getHeritageVisualAssets(){return snapshot;}
export function subscribeHeritageVisualAssets(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);}
export function setHeritageVisualAssets(patch:Partial<HeritageVisualAssetsSnapshot>){const previous=snapshot;snapshot={...snapshot,...patch};applyHeritageVisualAssets();if(!persist()){snapshot=previous;applyHeritageVisualAssets();return false;}emit();return true;}
export function resetHeritageVisualAssets(){const previous=snapshot;snapshot={...DEFAULT_VISUAL_ASSETS};applyHeritageVisualAssets();if(!persist()){snapshot=previous;applyHeritageVisualAssets();return false;}emit();return true;}
export type HeritageVisualAssetsBuiltInPreset="default"|"legacy-r23";
export function applyHeritageVisualAssetsBuiltInPreset(preset:HeritageVisualAssetsBuiltInPreset){
  const previous=snapshot;
  const source=preset==="legacy-r23"?LEGACY_R23_VISUAL_ASSETS:DEFAULT_VISUAL_ASSETS;
  snapshot={...source,customBackground:previous.customBackground,customBrand:previous.customBrand,customSplash:previous.customSplash};
  applyHeritageVisualAssets();
  if(!persist()){snapshot=previous;applyHeritageVisualAssets();return false;}
  emit();
  return true;
}
export function useHeritageVisualAssetsSnapshot(){return useSyncExternalStore(subscribeHeritageVisualAssets,getHeritageVisualAssets,getHeritageVisualAssets);}

export function isHeritageVisualAssetFavorite(kind:HeritageVisualAssetKind,id:string,value=snapshot){
  const favorites=kind==="background"?value.favoriteBackgrounds:kind==="brand"?value.favoriteBrands:value.favoriteSplashes;
  return favorites.includes(id);
}
export function toggleHeritageVisualAssetFavorite(kind:HeritageVisualAssetKind,id:string){
  const key=kind==="background"?"favoriteBackgrounds":kind==="brand"?"favoriteBrands":"favoriteSplashes";
  const current=(snapshot[key] as string[]);
  const next=current.includes(id)?current.filter(item=>item!==id):[...current,id];
  return setHeritageVisualAssets({[key]:next} as Partial<HeritageVisualAssetsSnapshot>);
}

export function exportHeritageVisualAssetsPreset():HeritageVisualAssetsPortablePresetV1{
  return {
    version:1,
    backgroundArt:snapshot.backgroundArt,
    backgroundFocusX:snapshot.backgroundFocusX,
    backgroundFocusY:snapshot.backgroundFocusY,
    backgroundBottomFade:snapshot.backgroundBottomFade,
    backgroundFitWidth:snapshot.backgroundFitWidth,
    backgroundParallax:snapshot.backgroundParallax,
    backgroundEngine:snapshot.backgroundEngine,
    background3DStrength:snapshot.background3DStrength,
    background3DZoom:snapshot.background3DZoom,
    background3DAutoMotion:snapshot.background3DAutoMotion,
    background3DBlur:snapshot.background3DBlur,
    favoriteBackgrounds:[...snapshot.favoriteBackgrounds],
    brandArt:snapshot.brandArt,
    brandScale:snapshot.brandScale,
    favoriteBrands:[...snapshot.favoriteBrands],
    splashArt:snapshot.splashArt,
    splashScale:snapshot.splashScale,
    favoriteSplashes:[...snapshot.favoriteSplashes],
  };
}
export function importHeritageVisualAssetsPreset(input:unknown):boolean{
  const source=input&&typeof input==="object"&&"visualAssets" in (input as Record<string,unknown>)
    ? (input as Record<string,unknown>).visualAssets
    : input;
  if(!source||typeof source!=="object")return false;
  const raw=source as Record<string,unknown>;
  const previous=snapshot;
  const splashFallback:HeritageSplashArt=previous.splashArt==="custom"?"heritage":previous.splashArt;
  const next=normalizeVisualAssetsSnapshot(raw,splashFallback,previous.customBackground,previous.customBrand,previous.customSplash);
  if(raw.backgroundArt==="custom"&&!previous.customBackground)next.backgroundArt=previous.backgroundArt==="custom"?"none":previous.backgroundArt;
  if(raw.brandArt==="custom"&&!previous.customBrand)next.brandArt=previous.brandArt==="custom"?"brand":previous.brandArt;
  if(raw.splashArt==="custom"&&!previous.customSplash)next.splashArt=previous.splashArt==="custom"?"heritage":previous.splashArt;
  snapshot={...previous,...next};
  applyHeritageVisualAssets();
  if(!persist()){snapshot=previous;applyHeritageVisualAssets();return false;}
  emit();
  return true;
}

export async function optimizeHeritageVisualAsset(file:File,kind:"background"|"brand"|"splash"):Promise<string>{
  if(!file.type.startsWith("image/"))throw new Error("Please choose an image file.");
  const objectUrl=URL.createObjectURL(file);
  try{
    const image=new Image();image.decoding="async";image.src=objectUrl;if(typeof image.decode==="function")await image.decode();else await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error("Unable to decode image"));});
    const maxSide=kind==="background"?1800:1100,maxChars=kind==="background"?1_250_000:760_000;
    let scale=Math.min(1,maxSide/Math.max(image.naturalWidth,image.naturalHeight)),quality=kind==="background"?.82:.9,data="";
    for(let pass=0;pass<5;pass++){
      const width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale));const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const context=canvas.getContext("2d");if(!context)throw new Error("Canvas unavailable");context.drawImage(image,0,0,width,height);data=canvas.toDataURL("image/webp",quality);if(data.length<=maxChars)break;scale*=.82;quality=Math.max(.62,quality-.07);
    }
    if(data.length>maxChars)throw new Error("Image is still too large after optimization.");return data;
  }finally{URL.revokeObjectURL(objectUrl);}
}
