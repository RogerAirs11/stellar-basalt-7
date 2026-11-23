export type AdaptiveWidthClass = "micro" | "compact" | "medium" | "wide" | "ultra";
export type AdaptiveHeightClass = "short" | "regular" | "tall";
export type AdaptiveAspectClass = "portrait" | "balanced" | "landscape" | "ultrawide";
export type AdaptiveInteraction = "touch" | "pointer";
export type AdaptiveDensity = "dense" | "balanced" | "spacious";
export type AdaptiveNavigation = "overflow" | "compact" | "full";
export type AdaptiveComposition = "stacked" | "tabs" | "split" | "columns";

export interface AdaptiveViewportInput {
  width: number;
  height: number;
  headerHeight?: number;
  stickyHeight?: number;
  safeTop?: number;
  safeBottom?: number;
  coarsePointer?: boolean;
  densityBias?: number;
}

export interface AdaptiveViewportState {
  width: number;
  height: number;
  usableHeight: number;
  shortAxis: number;
  widthClass: AdaptiveWidthClass;
  heightClass: AdaptiveHeightClass;
  aspectClass: AdaptiveAspectClass;
  interaction: AdaptiveInteraction;
  density: AdaptiveDensity;
  navigation: AdaptiveNavigation;
  composition: AdaptiveComposition;
}

const finite=(value:number|undefined,fallback:number)=>Number.isFinite(value)?Math.max(0,Number(value)):fallback;

export function classifyAdaptiveViewport(input: AdaptiveViewportInput): AdaptiveViewportState {
  const width=Math.max(240,finite(input.width,1280));
  const height=Math.max(320,finite(input.height,800));
  const header=finite(input.headerHeight,0),sticky=finite(input.stickyHeight,0),safeTop=finite(input.safeTop,0),safeBottom=finite(input.safeBottom,0);
  const usableHeight=Math.max(260,height-header-sticky-safeTop-safeBottom);
  const ratio=width/Math.max(1,height);
  const widthClass:AdaptiveWidthClass=width<=380?"micro":width<=680?"compact":width<=1080?"medium":width<=2080?"wide":"ultra";
  const heightClass:AdaptiveHeightClass=usableHeight<=620?"short":usableHeight>=980?"tall":"regular";
  const aspectClass:AdaptiveAspectClass=ratio<=.82?"portrait":ratio>=2.05?"ultrawide":ratio>=1.28?"landscape":"balanced";
  const interaction:AdaptiveInteraction=input.coarsePointer?"touch":"pointer";
  const bias=finite(input.densityBias,1);
  const density:AdaptiveDensity=(widthClass==="micro"||widthClass==="compact"||heightClass==="short"||bias<.86)?"dense":(widthClass==="ultra"&&bias>1.04)?"spacious":"balanced";
  const navigation:AdaptiveNavigation=(widthClass==="micro"||widthClass==="compact")?"overflow":(widthClass==="medium"||heightClass==="short")?"compact":"full";
  const composition:AdaptiveComposition=(widthClass==="micro"||widthClass==="compact")?(heightClass==="short"?"tabs":"stacked"):(heightClass==="short"?"tabs":widthClass==="medium"?"split":"columns");
  return {width,height,usableHeight,shortAxis:Math.max(240,Math.min(width,usableHeight)),widthClass,heightClass,aspectClass,interaction,density,navigation,composition};
}

export function browserAdaptiveViewport(overrides: Omit<AdaptiveViewportInput,"width"|"height">={}): AdaptiveViewportState {
  if(typeof window==="undefined")return classifyAdaptiveViewport({width:1280,height:800,...overrides});
  const vv=window.visualViewport;
  return classifyAdaptiveViewport({
    width:vv?.width??window.innerWidth,
    height:vv?.height??window.innerHeight,
    coarsePointer:window.matchMedia?.("(pointer: coarse)").matches??false,
    ...overrides,
  });
}

export function adaptiveDataAttributes(state: AdaptiveViewportState): Record<string,string> {
  return {
    "data-adaptive-width":state.widthClass,
    "data-adaptive-height":state.heightClass,
    "data-adaptive-aspect":state.aspectClass,
    "data-adaptive-interaction":state.interaction,
    "data-adaptive-density":state.density,
    "data-adaptive-nav":state.navigation,
    "data-adaptive-composition":state.composition,
  };
}

export function adaptiveCssVariables(state: AdaptiveViewportState): Record<string,string> {
  return {
    "--adaptive-vw":`${Math.round(state.width)}px`,
    "--adaptive-vh":`${Math.round(state.height)}px`,
    "--adaptive-usable-height":`${Math.round(state.usableHeight)}px`,
    "--adaptive-short-axis":`${Math.round(state.shortAxis)}px`,
  };
}

export function fitScaleForBox(mode:"actual"|"width"|"height"|"all", availableWidth:number, availableHeight:number, contentWidth:number, contentHeight:number):number{
  if(mode==="actual")return 1;
  const widthScale=Math.max(.01,availableWidth/Math.max(1,contentWidth));
  const heightScale=Math.max(.01,availableHeight/Math.max(1,contentHeight));
  return Math.min(1,mode==="width"?widthScale:mode==="height"?heightScale:Math.min(widthScale,heightScale));
}
