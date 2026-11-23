import { HERITAGE_DECORATION } from "../../assetCatalog";
import type { HeritageMode } from "./schema";

export type HeritageAutoPaletteTokenMap=Record<string,string>;
type Rgb={r:number;g:number;b:number};
type Hsl={h:number;s:number;l:number};
type HueBin={weight:number;sin:number;cos:number;saturation:number;lightness:number};

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const wrapHue=(value:number)=>((value%360)+360)%360;
const round=(value:number)=>Math.round(value);
const channelHex=(value:number)=>clamp(round(value),0,255).toString(16).padStart(2,"0");
const hex=(rgb:Rgb)=>`#${channelHex(rgb.r)}${channelHex(rgb.g)}${channelHex(rgb.b)}`;
const rgba=(rgb:Rgb,alpha:number)=>`rgba(${round(rgb.r)},${round(rgb.g)},${round(rgb.b)},${clamp(alpha,0,1).toFixed(3)})`;

function rgbToHsl({r,g,b}:Rgb):Hsl{
  const rn=r/255,gn=g/255,bn=b/255,max=Math.max(rn,gn,bn),min=Math.min(rn,gn,bn),d=max-min;
  let h=0;const l=(max+min)/2;
  if(d){if(max===rn)h=((gn-bn)/d)%6;else if(max===gn)h=(bn-rn)/d+2;else h=(rn-gn)/d+4;h*=60;if(h<0)h+=360;}
  const s=d===0?0:d/(1-Math.abs(2*l-1));
  return {h,s,l};
}
function hslToRgb({h,s,l}:Hsl):Rgb{
  const hue=wrapHue(h),sat=clamp(s,0,1),lit=clamp(l,0,1),c=(1-Math.abs(2*lit-1))*sat,x=c*(1-Math.abs((hue/60)%2-1)),m=lit-c/2;
  let rp=0,gp=0,bp=0;
  if(hue<60){rp=c;gp=x}else if(hue<120){rp=x;gp=c}else if(hue<180){gp=c;bp=x}else if(hue<240){gp=x;bp=c}else if(hue<300){rp=x;bp=c}else{rp=c;bp=x}
  return {r:(rp+m)*255,g:(gp+m)*255,b:(bp+m)*255};
}
const hslHex=(h:number,s:number,l:number)=>hex(hslToRgb({h,s,l}));
const hueDistance=(a:number,b:number)=>Math.abs(((a-b+540)%360)-180);

export type HeritageSceneColorSignature={
  hue:number;
  saturation:number;
  lightness:number;
  secondaryHue:number|null;
  confidence:number;
};

export function deriveHeritageSceneColorSignature(pixels:Uint8ClampedArray):HeritageSceneColorSignature{
  const bins:HueBin[]=Array.from({length:24},()=>({weight:0,sin:0,cos:0,saturation:0,lightness:0}));
  let totalWeight=0,weightedSaturation=0,weightedLightness=0,globalSin=0,globalCos=0;
  for(let index=0;index+3<pixels.length;index+=4){
    const alpha=pixels[index+3]/255;if(alpha<.3)continue;
    const hsl=rgbToHsl({r:pixels[index],g:pixels[index+1],b:pixels[index+2]});
    if(hsl.l<.025||hsl.l>.985)continue;
    const chromaWeight=.12+Math.pow(hsl.s,1.35)*1.8;
    const middleWeight=.55+.45*(1-Math.abs(hsl.l-.5)*2);
    const weight=alpha*chromaWeight*clamp(middleWeight,.25,1);
    const radians=hsl.h*Math.PI/180;
    const bin=bins[Math.floor(hsl.h/15)%bins.length];
    bin.weight+=weight;bin.sin+=Math.sin(radians)*weight;bin.cos+=Math.cos(radians)*weight;bin.saturation+=hsl.s*weight;bin.lightness+=hsl.l*weight;
    totalWeight+=weight;weightedSaturation+=hsl.s*weight;weightedLightness+=hsl.l*weight;globalSin+=Math.sin(radians)*weight;globalCos+=Math.cos(radians)*weight;
  }
  if(totalWeight<=0)return {hue:205,saturation:.28,lightness:.45,secondaryHue:35,confidence:0};
  const ranked=bins.map((bin,index)=>({bin,index})).filter(item=>item.bin.weight>0).sort((a,b)=>b.bin.weight-a.bin.weight);
  const primary=ranked[0]?.bin;
  let hue=wrapHue(Math.atan2(primary?.sin??globalSin,primary?.cos??globalCos)*180/Math.PI);
  if(!Number.isFinite(hue))hue=205;
  const saturation=clamp(weightedSaturation/totalWeight,0,1),lightness=clamp(weightedLightness/totalWeight,0,1);
  const secondary=ranked.find(item=>item.bin.weight>=(primary?.weight??0)*.08&&hueDistance(wrapHue(Math.atan2(item.bin.sin,item.bin.cos)*180/Math.PI),hue)>=45);
  const secondaryHue=secondary?wrapHue(Math.atan2(secondary.bin.sin,secondary.bin.cos)*180/Math.PI):null;
  const confidence=clamp(((primary?.weight??0)/totalWeight)*2.4+saturation*.35,0,1);
  return {hue,saturation,lightness,secondaryHue,confidence};
}

function foundation(mode:HeritageMode,hue:number,saturation:number){
  const surfaceSat=clamp(saturation*.22,.025,.13);
  const color=(lightness:number,satMultiplier=1)=>hslToRgb({h:hue,s:clamp(surfaceSat*satMultiplier,0,.18),l:lightness});
  if(mode==="dark"){
    const bg=color(.055,.9),elev=color(.082,1),elev2=color(.115,1.08),elev3=color(.15,1.12),panel=color(.095,1),panelStrong=color(.145,1.08),line=color(.205,.85),lineStrong=color(.31,.9),input=color(.068,.95);
    return {bg,elev,elev2,elev3,panel,panelStrong,line,lineStrong,input,tableHover:color(.132,1),glass:color(.045,.9),panelAlpha:.89,glassAlpha:.80,sceneAlpha:.11};
  }
  const bg=color(.945,.7),elev=color(.982,.52),elev2=color(.925,.72),elev3=color(.885,.8),panel=color(.982,.52),panelStrong=color(.93,.68),line=color(.825,.55),lineStrong=color(.70,.62),input=color(.992,.45);
  return {bg,elev,elev2,elev3,panel,panelStrong,line,lineStrong,input,tableHover:color(.91,.66),glass:color(.985,.5),panelAlpha:.92,glassAlpha:.86,sceneAlpha:.075};
}

export function deriveHeritageAutoPaletteTokens(signature:HeritageSceneColorSignature,mode:HeritageMode):HeritageAutoPaletteTokenMap{
  const imageSat=clamp(signature.saturation,0,1);
  const lowColor=imageSat<.08;
  const primaryHue=lowColor?205:wrapHue(signature.hue);
  const colorSat=lowColor?clamp(.06+imageSat*.50,.06,.12):clamp(.24+imageSat*.46,.26,.68);
  const secondaryHue=!lowColor&&signature.secondaryHue!==null?signature.secondaryHue:wrapHue(primaryHue+150);
  const chromeHue=hueDistance(secondaryHue,primaryHue)<=75?secondaryHue:wrapHue(primaryHue+22);
  const splitA=wrapHue(primaryHue+150),splitB=wrapHue(primaryHue-150);
  const warmHue=primaryHue>=10&&primaryHue<=85?primaryHue:wrapHue(primaryHue+195);
  const f=foundation(mode,primaryHue,imageSat);
  const dark=mode==="dark";
  const schemeBase=hslHex(primaryHue,colorSat*.70,dark ? .57 : .43);
  const schemeChrome=hslHex(chromeHue,colorSat*.78,dark ? .66 : .38);
  const schemeBaseVivid=hslHex(primaryHue,clamp(colorSat*1.18,0,1),dark ? .62 : .46);
  const schemeChromeVivid=hslHex(chromeHue,clamp(colorSat*1.22,0,1),dark ? .70 : .42);
  const accentRaw=hslHex(primaryHue,lowColor?clamp(colorSat*.95,.06,.14):clamp(colorSat*.95,.34,.72),dark ? .64 : .37);
  const accentVivid=hslHex(primaryHue,lowColor?clamp(colorSat*1.28,.08,.18):clamp(colorSat*1.28,.44,.90),dark ? .66 : .41);
  const accentStrongRaw=hslHex(primaryHue,lowColor?clamp(colorSat*.72,.05,.12):clamp(colorSat*.72,.28,.62),dark ? .78 : .28);
  const accentStrongVivid=hslHex(primaryHue,lowColor?clamp(colorSat*1.08,.07,.16):clamp(colorSat*1.08,.40,.84),dark ? .82 : .31);
  const metal=hslHex(lowColor?primaryHue:warmHue,lowColor?clamp(colorSat*.70,.04,.10):clamp(.28+imageSat*.22,.30,.52),dark ? .61 : .39);
  const metalBright=hslHex(lowColor?primaryHue:warmHue,lowColor?clamp(colorSat*.82,.05,.12):clamp(.32+imageSat*.24,.34,.58),dark ? .76 : .29);
  const chroma=(h:number,vivid=false)=>hslHex(h,lowColor?clamp(colorSat*(vivid?1.18:.78),.05,.16):clamp(colorSat*(vivid?1.22:.82),.30,.90),dark?(vivid ? .68 : .57):(vivid ? .42 : .34));
  return {
    "--bg":hex(f.bg),"--bg-elev":hex(f.elev),"--bg-elev-2":hex(f.elev2),"--bg-elev-3":hex(f.elev3),
    "--panel":rgba(f.panel,f.panelAlpha),"--panel-solid":hex(f.panel),"--panel-strong":hex(f.panelStrong),
    "--line":hex(f.line),"--line-strong":hex(f.lineStrong),"--glass":rgba(f.glass,f.glassAlpha),"--table-hover":hex(f.tableHover),"--input":hex(f.input),
    "--scene-tint":rgba(f.bg,f.sceneAlpha),
    "--h-scheme-base-raw":schemeBase,"--h-scheme-chrome-raw":schemeChrome,"--h-scheme-base-vivid":schemeBaseVivid,"--h-scheme-chrome-vivid":schemeChromeVivid,
    "--h-accent-raw":accentRaw,"--h-accent-vivid":accentVivid,"--h-accent-strong-raw":accentStrongRaw,"--h-accent-strong-vivid":accentStrongVivid,
    "--accent-soft":rgba(hslToRgb({h:primaryHue,s:lowColor?clamp(colorSat*.95,.06,.14):clamp(colorSat*.95,.34,.72),l:dark ? .64 : .37}),.10),"--metal":metal,"--metal-bright":metalBright,
    "--h-v2-chroma-a-raw":chroma(primaryHue),"--h-v2-chroma-a-vivid":chroma(primaryHue,true),
    "--h-v2-chroma-b-raw":chroma(splitA),"--h-v2-chroma-b-vivid":chroma(splitA,true),
    "--h-v2-chroma-c-raw":chroma(splitB),"--h-v2-chroma-c-vivid":chroma(splitB,true),
    "--h-auto-swatch-a":accentRaw,"--h-auto-swatch-b":metal,
  };
}

export const HERITAGE_AUTO_PALETTE_FALLBACK_SIGNATURE:Record<HeritageMode,HeritageSceneColorSignature>={
  dark:{hue:202,saturation:.32,lightness:.17,secondaryHue:35,confidence:.88},
  light:{hue:38,saturation:.64,lightness:.78,secondaryHue:63,confidence:.91},
};

export function fallbackHeritageAutoPaletteTokens(mode:HeritageMode):HeritageAutoPaletteTokenMap{
  return deriveHeritageAutoPaletteTokens(HERITAGE_AUTO_PALETTE_FALLBACK_SIGNATURE[mode],mode);
}

export function resolveHeritageSceneImageSource(mode:HeritageMode,root:HTMLElement=document.documentElement):string{
  const fallback=mode==="light"?HERITAGE_DECORATION.day:HERITAGE_DECORATION.night;
  try{
    const raw=getComputedStyle(root).getPropertyValue("--hero-scene").trim();
    const match=raw.match(/url\((?:["']?)(.*?)(?:["']?)\)/i);
    return match?.[1]?.trim()||fallback;
  }catch{return fallback;}
}

export async function analyzeHeritageSceneImage(source:string):Promise<HeritageSceneColorSignature>{
  if(typeof document==="undefined"||typeof Image==="undefined")throw new Error("Image analysis requires a browser");
  const image=new Image();image.decoding="async";
  const href=typeof location!=="undefined"?new URL(source,location.href).href:source;
  image.src=href;
  if(typeof image.decode==="function")await image.decode();else await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error("Unable to load scene image"));});
  const width=96,height=Math.max(32,Math.round(96*(image.naturalHeight||1)/(image.naturalWidth||1)));
  const canvas=document.createElement("canvas");canvas.width=width;canvas.height=Math.min(96,height);
  const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)throw new Error("Canvas color analysis unavailable");
  context.drawImage(image,0,0,canvas.width,canvas.height);
  return deriveHeritageSceneColorSignature(context.getImageData(0,0,canvas.width,canvas.height).data);
}
