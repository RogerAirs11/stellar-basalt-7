import { useLayoutEffect } from "react";
import { HERITAGE_MATERIAL_ANY_SELECTOR, getHeritageMaterialRole, heritageRoleUsesLocalLighting, type HeritageMaterialRole } from "../heritageSurfaceRegistry";

const ROLE_WEIGHT:Record<HeritageMaterialRole,number>={major:8,panel:4,card:1.5,control:.2};
function makeEffectsLayer(role:HeritageMaterialRole,phase:number){
  const layer=document.createElement("span");layer.className="heritage-v2-surface-effects";layer.dataset.effectRole=role;layer.setAttribute("aria-hidden","true");layer.style.setProperty("--h-v2-light-phase",`${-phase.toFixed(2)}s`);return layer;
}
function surfaceCost(el:HTMLElement,role:HeritageMaterialRole){
  if(el.closest(".theme-settings-portal-layer,.theme-settings-sidebar,.theme-controls"))return 0;
  const rect=el.getBoundingClientRect();const area=Math.max(1,Math.min(innerWidth,rect.right)-Math.max(0,rect.left))*Math.max(1,Math.min(innerHeight,rect.bottom)-Math.max(0,rect.top));
  const areaFactor=Math.max(.55,Math.min(2.8,Math.sqrt(area/70000)));return ROLE_WEIGHT[role]*areaFactor;
}

/** Transitional compatibility bridge. Explicit React-owned data-h-surface-role
 * wins; selector inference remains only for H42 markup not migrated yet. */
export function HeritageSurfaceEffectsBinder(){
  useLayoutEffect(()=>{
    const tracked=new Set<HTMLElement>(),visible=new Set<HTMLElement>();let phase=0,frame=0;const root=document.documentElement;let load:"normal"|"medium"|"high"="normal";
    const updateBudget=()=>{frame=0;let cost=0;for(const el of visible){const role=getHeritageMaterialRole(el);if(role)cost+=surfaceCost(el,role);}const next=load==="high"?(cost<38?"medium":"high"):load==="medium"?(cost>=48?"high":cost<20?"normal":"medium"):(cost>=48?"high":cost>=24?"medium":"normal");load=next;root.dataset.frostLoad=next;};
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(updateBudget)};
    const io=typeof IntersectionObserver!=="undefined"?new IntersectionObserver(entries=>{for(const entry of entries){const el=entry.target as HTMLElement;if(entry.isIntersecting)visible.add(el);else visible.delete(el);if(el.classList.contains("heritage-v2-light-surface"))el.dataset.hV2EffectVisible=entry.isIntersecting?"1":"0";}schedule();},{root:null,rootMargin:"180px 0px 180px",threshold:0}):null;
    const bind=(el:HTMLElement)=>{if(tracked.has(el))return;const role=getHeritageMaterialRole(el);if(!role)return;el.dataset.hMaterialRole=role;
      // R135 nested-frost collapse: a material surface already sitting inside
      // another frosted surface re-blurs an ALREADY blurred backdrop (the
      // spec's backdrop root) — visually near-identical to no blur of its own,
      // but one full extra composite pass per element. Mark it; material.css
      // drops its backdrop-filter and raises its fill opacity instead. Top-
      // level surfaces (topbar, panels, portaled popovers/dock) keep real frost.
      el.dataset.hFrostNested=el.parentElement?.closest("[data-h-material-role]")?"1":"0";
      tracked.add(el);io?.observe(el);if(!heritageRoleUsesLocalLighting(role))return;el.classList.add("heritage-v2-light-surface");el.dataset.hV2EffectVisible="1";if(!el.querySelector(":scope > .heritage-v2-surface-effects"))el.appendChild(makeEffectsLayer(role,(phase++%19)*.61));};
    const unbind=(el:HTMLElement)=>{if(!tracked.has(el))return;io?.unobserve(el);visible.delete(el);tracked.delete(el);el.querySelector(":scope > .heritage-v2-surface-effects")?.remove();el.classList.remove("heritage-v2-light-surface");el.removeAttribute("data-h-material-role");el.removeAttribute("data-h-frost-nested");el.removeAttribute("data-h-v2-effect-visible");};
    const process=(node:Node)=>{if(!(node instanceof HTMLElement))return;if(node.matches(HERITAGE_MATERIAL_ANY_SELECTOR))bind(node);node.querySelectorAll<HTMLElement>(HERITAGE_MATERIAL_ANY_SELECTOR).forEach(bind);};
    const cleanup=(node:Node)=>{if(!(node instanceof HTMLElement))return;if(tracked.has(node))unbind(node);node.querySelectorAll<HTMLElement>("[data-h-material-role]").forEach(unbind);schedule();};
    process(document.body);updateBudget();const observer=new MutationObserver(records=>{for(const record of records){for(const node of record.removedNodes)cleanup(node);for(const node of record.addedNodes)process(node);}});observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();io?.disconnect();if(frame)cancelAnimationFrame(frame);delete root.dataset.frostLoad;for(const el of [...tracked])unbind(el);};
  },[]);return null;
}
