import { useEffect, useMemo, useRef, useState } from "react";
import type { HeritageMode } from "./theme/schema";
import { getHeritageBackgroundThreeDScene, getResolvedHeritageBackgroundEngine, resolveHeritageBackgroundSource, type HeritageVisualAssetsSnapshot } from "../heritageVisualAssets";

type HeritageBackgroundStageProps={
  visualAssets:HeritageVisualAssetsSnapshot;
  mode:HeritageMode;
  enabled:boolean;
};

const LAYER_DEPTHS=[0.14,0.32,0.54,0.76,1] as const;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const lerp=(from:number,to:number,t:number)=>from+(to-from)*t;

function useReducedMotion(){
  const [reduced,setReduced]=useState(false);
  useEffect(()=>{
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync=()=>setReduced(media.matches);
    sync();
    media.addEventListener("change",sync);
    return()=>media.removeEventListener("change",sync);
  },[]);
  return reduced;
}


function HeritageFlatStage({source}:{source:string}){
  return <div className="heritage-bg-stage heritage-bg-stage-flat" aria-hidden="true">
    <div className="heritage-bg-flat-image" style={{backgroundImage:`url(${source})`}}/>
    <div className="heritage-bg-stage-tint heritage-bg-stage-bottom-tint"/>
  </div>;
}

function HeritageLayerStage({scene,intensity,zoom,autoMotion,blur,scrollParallax}:{scene:NonNullable<ReturnType<typeof getHeritageBackgroundThreeDScene>>;intensity:number;zoom:number;autoMotion:boolean;blur:boolean;scrollParallax:boolean}){
  const stageRef=useRef<HTMLDivElement>(null);
  const layerRefs=useRef<(HTMLDivElement|null)[]>([]);
  const reducedMotion=useReducedMotion();
  useEffect(()=>{
    const stage=stageRef.current;
    if(!stage)return;
    let alive=true;
    let raf=0;
    let nx=0,ny=0,tx=0,ty=0;
    const strength=clamp(intensity,0.2,1.8);
    // R32 idle-cost control: the loop keeps running (it must, for drift), but
    // per-layer transform/filter strings are only rebuilt when the composed
    // parallax state actually moved — an idle converged stage costs almost
    // nothing instead of rebuilding 5 style strings every frame.
    let lastNx=Number.NaN,lastNy=Number.NaN,lastScroll=Number.NaN;
    const onPointer=(event:PointerEvent)=>{
      tx=clamp((event.clientX/window.innerWidth-.5)*2,-1,1);
      ty=clamp((event.clientY/window.innerHeight-.5)*2,-1,1);
    };
    const onLeave=()=>{tx=0;ty=0;};
    const animate=(time:number)=>{
      if(!alive)return;
      const driftX=autoMotion&&!reducedMotion?Math.sin(time*.00017)*.10:0;
      const driftY=autoMotion&&!reducedMotion?Math.cos(time*.00013)*.06:0;
      nx=lerp(nx,reducedMotion?0:tx+driftX,.055);
      ny=lerp(ny,reducedMotion?0:ty+driftY,.055);
      const scrollInfluence=(scrollParallax&&!reducedMotion)?Math.min(1,window.scrollY/980):0;
      const settled=Math.abs(nx-lastNx)<.0004&&Math.abs(ny-lastNy)<.0004&&Math.abs(scrollInfluence-lastScroll)<.0004;
      if(!settled){
        lastNx=nx;lastNy=ny;lastScroll=scrollInfluence;
        const stageRx=-ny*1.2*strength;
        const stageRy=nx*1.75*strength;
        layerRefs.current.forEach((layer,index)=>{
          if(!layer)return;
          const depth=LAYER_DEPTHS[index]??((index+1)/Math.max(1,scene.layerSources.length));
          const x=-nx*depth*22*strength;
          const y=(-ny*12+scrollInfluence*32)*depth*strength;
          const z=depth*28*strength;
          const scale=1+depth*.014*strength;
          layer.style.transform=`perspective(780px) rotateX(${stageRx}deg) rotateY(${stageRy}deg) translate3d(${x}px,${y}px,${z}px) scale(${scale})`;
          if(blur)layer.style.filter=`blur(${Math.max(0,(1-depth)*.45*strength).toFixed(2)}px)`;
          else if(layer.style.filter)layer.style.filter="none";
        });
      }
      raf=requestAnimationFrame(animate);
    };
    window.addEventListener("pointermove",onPointer,{passive:true});
    window.addEventListener("pointerleave",onLeave);
    raf=requestAnimationFrame(animate);
    return()=>{
      alive=false;
      window.removeEventListener("pointermove",onPointer);
      window.removeEventListener("pointerleave",onLeave);
      if(raf)cancelAnimationFrame(raf);
    };
  },[autoMotion,blur,intensity,reducedMotion,scene.layerSources.length,scrollParallax]);
  return <div ref={stageRef} className="heritage-bg-stage heritage-bg-stage-layers" aria-hidden="true">
    <img className="heritage-bg-layer-underlay" src={scene.preview} alt=""/>
    <div className="heritage-bg-stage-layers-shell" style={{transform:`scale(${zoom})`}}>{scene.layerSources.map((source,index)=><div key={`${scene.id}-${index}`} ref={node=>{layerRefs.current[index]=node;}} className="heritage-bg-layer" style={{backgroundImage:`url(${source})`,zIndex:index+1}}/>)}</div>
    <div className="heritage-bg-stage-tint heritage-bg-stage-bottom-tint"/>
  </div>;
}

export function HeritageBackgroundStage({visualAssets,mode,enabled}:HeritageBackgroundStageProps){
  const scene=useMemo(()=>getHeritageBackgroundThreeDScene(visualAssets.backgroundArt,mode),[mode,visualAssets.backgroundArt]);
  const engine=useMemo(()=>getResolvedHeritageBackgroundEngine(visualAssets,mode),[mode,visualAssets]);
  const flatSource=useMemo(()=>resolveHeritageBackgroundSource(visualAssets,mode),[mode,visualAssets]);
  if(!enabled)return null;
  if(engine==="flat"||!scene)return <HeritageFlatStage source={flatSource}/>;
  const intensity=visualAssets.background3DStrength/100;
  const zoom=visualAssets.background3DZoom/100;
  const scrollParallax=visualAssets.backgroundParallax;
  return <HeritageLayerStage scene={scene} intensity={intensity} zoom={zoom} autoMotion={visualAssets.background3DAutoMotion} blur={visualAssets.background3DBlur} scrollParallax={scrollParallax}/>;
}
