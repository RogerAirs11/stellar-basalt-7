import React, { useEffect, useMemo, useRef, useState } from "react";
import { annularSectorPath, buildPedigreeTreeLayout, collectAncestorRadialSlots, fitScaleForBox, horseDbRoutes, polarPoint } from "../../../frontend-kit";
import type { FrontendRuntimeProps, HorseRecord, PedigreeNode, PlatformClient } from "../../../frontend-kit";
import { horseName, num, pct, text, year } from "./format";
import { currentEquiDataLocale, edxSexLabel, edxStatus, edxText, edxUnknown } from "./i18n";

export function Icon({ name }: { name: "home"|"search"|"horse"|"tree"|"compare"|"rank"|"lab"|"ai"|"stats"|"people"|"quality"|"star"|"arrow"|"check"|"warn" }) {
  const glyphs: Record<string, string> = { home:"⌂",search:"⌕",horse:"♞",tree:"⌘",compare:"⇄",rank:"◆",lab:"✧",ai:"✦",stats:"▥",people:"◉",quality:"◇",star:"☆",arrow:"→",check:"✓",warn:"!" };
  return <span className="edx-icon" aria-hidden="true">{glyphs[name]}</span>;
}

export function Panel({ children, className = "", ...attributes }: React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }) {
  return <section {...attributes} className={`edx-panel ${className}`}>{children}</section>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) { return <div className="edx-eyebrow"><span />{children}</div>; }

export function SectionTitle({ eyebrow, title, copy, action, headingLevel = 2 }: { eyebrow?: string; title: React.ReactNode; copy?: React.ReactNode; action?: React.ReactNode; headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return <header className="edx-section-head"><div>{eyebrow&&<Eyebrow>{eyebrow}</Eyebrow>}<Heading>{title}</Heading>{copy&&<p>{copy}</p>}</div>{action&&<div className="edx-section-action">{action}</div>}</header>;
}

export function Metric({ label, value, note, tone = "cyan" }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "cyan"|"gold"|"green"|"rose"|"muted" }) {
  return <div className={`edx-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong>{note&&<small>{note}</small>}</div>;
}

export function CapabilityPill({ available, label }: { available: boolean; label: string }) {
  const locale=currentEquiDataLocale(); return <span className={`edx-cap-pill ${available?"live":"dormant"}`}><i />{label} · {edxStatus(locale,available)}</span>;
}

export function DormantFeature({ title, reason, preserved = true }: { title: string; reason: string; preserved?: boolean }) {
  const locale=currentEquiDataLocale(); return <Panel className="edx-dormant"><div className="edx-dormant-mark"><Icon name="warn"/></div><div><Eyebrow>{edxText(locale,"CAPABILITY DORMANT","قابلیت غیرفعال")}</Eyebrow><h3>{title}</h3><p>{reason}</p>{preserved&&<small>{edxText(locale,"The original mock implementation remains preserved inside this frontend's source archive for future compatible backends.","پیاده‌سازی اصلی این قابلیت در آرشیو همین رابط حفظ شده تا در آینده با سرویس سازگار دوباره فعال شود.")}</small>}</div></Panel>;
}

export function LoadingPanel({ label }: { label?: string }) { const locale=currentEquiDataLocale(); return <Panel className="edx-state" role="status"><span className="edx-loader"/><strong>{label??edxText(locale,"Synchronizing registry…","در حال همگام‌سازی سامانه ثبت…")}</strong></Panel>; }
export function ErrorPanel({ error, onRetry }: { error: string; onRetry?: () => void }) { const locale=currentEquiDataLocale(); return <Panel className="edx-state error" role="alert"><Icon name="warn"/><strong>{edxText(locale,"Registry request failed","درخواست سامانه ثبت ناموفق بود")}</strong><span>{error}</span>{onRetry&&<button className="edx-button secondary" onClick={onRetry}>{edxText(locale,"Retry","تلاش دوباره")}</button>}</Panel>; }
export function EmptyPanel({ title, copy }: { title: string; copy: string }) { return <Panel className="edx-state"><strong>{title}</strong><span>{copy}</span></Panel>; }

export function HorsePortrait({ horse, runtime, size = "md" }: { horse: HorseRecord; runtime: FrontendRuntimeProps; size?: "sm"|"md"|"lg" }) {
  // turn-33: prefer the record's own published portrait when the API provides
  // one (profile fetches carry profile_image_url; list projections may not —
  // those keep the deterministic placeholder). R140-F: the credit is now ALSO
  // visible text under the portrait (hover-only attribution was weak on
  // phones, per the second Master-AI audit); the tooltip stays for parity
  // with the Heritage hero.
  const ownPhoto = typeof horse.profile_image_url === "string" && horse.profile_image_url.length > 0;
  const photo = ownPhoto
    ? { src: horse.profile_image_url as string, width: 640, height: 640 }
    : runtime.assets.horsePlaceholderFor(horse.id);
  return <div className={`edx-horse-portrait ${size}`}><img src={photo.src} width={photo.width} height={photo.height} alt="" loading="lazy" decoding="async" title={ownPhoto ? horse.profile_image_credit ?? undefined : undefined}/><span>#{num(horse.id,runtime.locale)}</span>{ownPhoto && horse.profile_image_credit ? <small className="edx-photo-credit" dir="auto">{horse.profile_image_credit}</small> : null}</div>;
}

export function HorseCard({ horse, runtime, onOpen, favorite, onFavorite, selected, onSelect, headingLevel = 3 }: { horse: HorseRecord; runtime: FrontendRuntimeProps; onOpen: () => void; favorite?: boolean; onFavorite?: () => void; selected?: boolean; onSelect?: () => void; headingLevel?: 2 | 3 }) {
  const fa=runtime.locale==="fa";
  const stop=(event:React.SyntheticEvent)=>event.stopPropagation();
  const Heading=headingLevel===2?"h2":"h3";
  return <article className={`edx-horse-card is-clickable${selected?" selected":""}`}>
    <HorsePortrait horse={horse} runtime={runtime}/>
    <div className="edx-horse-card-body"><div className="edx-horse-title"><div><Heading dir="auto"><a className="edx-card-record-link" href={horseDbRoutes.horse(horse.id)} onClick={event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onOpen();}}}>{horseName(horse,runtime.locale)}</a></Heading>{(fa?horse.name_latin:horse.name_native)&&<small dir="auto">{fa?horse.name_latin:horse.name_native}</small>}</div>{onFavorite&&<button className={`edx-icon-button${favorite?" active":""}`} onClick={event=>{stop(event);onFavorite()}} aria-label={favorite?edxText(runtime.locale,"Remove from watchlist","حذف از فهرست پیگیری"):edxText(runtime.locale,"Add to watchlist","افزودن به فهرست پیگیری")}>★</button>}</div>
      <div className="edx-chip-row"><span>{text(horse.breed_desc,edxText(runtime.locale,"Registry","سامانه ثبت"))}</span><span>{horse.sex_desc?edxSexLabel(runtime.locale,horse.sex_desc):edxText(runtime.locale,"Sex unknown","جنسیت نامشخص")}</span><span>{year(horse.birth_year,runtime.locale)}</span></div>
      <dl className="edx-inline-dl"><div><dt>{edxText(runtime.locale,"Sire","پدر")}</dt><dd dir="auto">{fa?(horse.father_name_native||horse.father_name):(horse.father_name||horse.father_name_native)||edxText(runtime.locale,"Unknown","نامشخص")}</dd></div><div><dt>{edxText(runtime.locale,"Dam","مادر")}</dt><dd dir="auto">{fa?(horse.mother_name_native||horse.mother_name):(horse.mother_name||horse.mother_name_native)||edxText(runtime.locale,"Unknown","نامشخص")}</dd></div></dl>
      <div className="edx-card-actions">{onSelect&&<button className="edx-button ghost" onClick={event=>{stop(event);onSelect()}}>{selected?edxText(runtime.locale,"Selected","انتخاب‌شده"):edxText(runtime.locale,"Compare","مقایسه")}</button>}<button className="edx-button secondary" onClick={event=>{stop(event);onOpen()}}>{edxText(runtime.locale,"Open record","باز کردن رکورد")} <Icon name="arrow"/></button></div>
    </div>
  </article>;
}

export function HorseListRow({ horse, runtime, onOpen, favorite, onFavorite }: { horse: HorseRecord; runtime: FrontendRuntimeProps; onOpen: () => void; favorite?: boolean; onFavorite?: () => void }) {
  const fa=runtime.locale==="fa";
  const stop=(event:React.SyntheticEvent)=>event.stopPropagation();
  const parent=(relation:"father"|"mother")=>relation==="father"
    ? (fa?(horse.father_name_native||horse.father_name):(horse.father_name||horse.father_name_native))
    : (fa?(horse.mother_name_native||horse.mother_name):(horse.mother_name||horse.mother_name_native));
  return <article className="edx-registry-list-row">
    <HorsePortrait horse={horse} runtime={runtime} size="sm"/>
    <div className="edx-list-identity"><strong dir="auto"><a className="edx-card-record-link" href={horseDbRoutes.horse(horse.id)} onClick={event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onOpen();}}}>{horseName(horse,runtime.locale)}</a></strong>{(fa?horse.name_latin:horse.name_native)&&<small dir="auto">{fa?horse.name_latin:horse.name_native}</small>}<span>#{num(horse.id,runtime.locale)}{horse.register_no?` · ${horse.register_no}`:""}</span></div>
    <div className="edx-list-facts"><span><b>{edxText(runtime.locale,"Breed","نژاد")}</b><em dir="auto">{text(horse.breed_desc,edxText(runtime.locale,"Unknown","نامشخص"))}</em></span><span><b>{edxText(runtime.locale,"Sex","جنسیت")}</b><em>{horse.sex_desc?edxSexLabel(runtime.locale,horse.sex_desc):edxUnknown(runtime.locale)}</em></span><span><b>{edxText(runtime.locale,"Born","تولد")}</b><em>{year(horse.birth_year,runtime.locale)}</em></span><span><b>{edxText(runtime.locale,"Place","محل")}</b><em dir="auto">{text(horse.birth_place_desc,"—")}</em></span></div>
    <div className="edx-list-lineage"><span><b>{edxText(runtime.locale,"Sire","پدر")}</b><em dir="auto">{parent("father")||edxUnknown(runtime.locale)}</em></span><span><b>{edxText(runtime.locale,"Dam","مادر")}</b><em dir="auto">{parent("mother")||edxUnknown(runtime.locale)}</em></span></div>
    <div className="edx-list-actions">{onFavorite&&<button className={`edx-icon-button${favorite?" active":""}`} onClick={event=>{stop(event);onFavorite()}} aria-label={favorite?edxText(runtime.locale,"Remove from watchlist","حذف از فهرست پیگیری"):edxText(runtime.locale,"Add to watchlist","افزودن به فهرست پیگیری")}>★</button>}<button className="edx-button secondary" onClick={event=>{stop(event);onOpen()}}>{edxText(runtime.locale,"Open","باز کردن")} <Icon name="arrow"/></button></div>
  </article>;
}

export function HorsePicker({ platform, label, value, onChange, placeholder, locale="en" }: { platform: PlatformClient; label: string; value: HorseRecord | null; onChange: (horse: HorseRecord | null) => void; placeholder?: string; locale?: "en"|"fa"|"ar" }) {
  const searchPlaceholder=placeholder??edxText(locale,"Search by name or registry number…","جست‌وجو با نام یا شماره سامانه ثبت…");
  const [query,setQuery]=useState(""); const [rows,setRows]=useState<HorseRecord[]>([]); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  useEffect(()=>{ if(query.trim().length<2){setRows([]);setError("");return;} const controller=new AbortController(); const timer=setTimeout(()=>{setBusy(true);platform.search.horses(query,{limit:8,signal:controller.signal}).then(r=>setRows(r.results)).catch((e:unknown)=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:edxText(locale,"Search failed","جست‌وجو ناموفق بود"))}).finally(()=>{if(!controller.signal.aborted)setBusy(false)});},220); return()=>{clearTimeout(timer);controller.abort()};},[platform,query]);
  return <div className="edx-picker"><label>{label}</label>{value?<div className="edx-picker-selected"><div><strong dir="auto">{value.name_latin||value.name_native||`#${value.id}`}</strong><span>#{value.id} · {value.sex_desc?edxSexLabel(locale,value.sex_desc):edxText(locale,"sex unknown","جنسیت نامشخص")} · {year(value.birth_year,locale)}</span></div><button onClick={()=>{onChange(null);setQuery("")}}>{edxText(locale,"Change","تغییر")}</button></div>:<><div className="edx-searchbox"><Icon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={searchPlaceholder}/>{busy&&<span className="edx-mini-loader"/>}</div>{error&&<small className="edx-error-text">{error}</small>}{rows.length>0&&<div className="edx-picker-results">{rows.map(h=><button key={h.id} onClick={()=>{onChange(h);setRows([]);setQuery("")}}><strong dir="auto">{h.name_latin||h.name_native||`#${h.id}`}</strong><span>#{h.id} · {text(h.breed_desc,edxText(locale,"Registry","سامانه ثبت"))} · {year(h.birth_year,locale)}</span></button>)}</div>}</>}</div>;
}

export function PedigreeMap({ root, runtime, onOpen, maxGeneration = 4 }: { root: PedigreeNode; runtime: FrontendRuntimeProps; onOpen: (horse: HorseRecord) => void; maxGeneration?: number }) {
  const L=(en:string,fa:string)=>edxText(runtime.locale,en,fa);
  const layout=useMemo(()=>buildPedigreeTreeLayout(root,{maxGeneration,nodeWidth:190,nodeHeight:76,columnGap:74,rowGap:18,paddingX:28,paddingY:30,rtl:runtime.locale==="fa"}),[root,maxGeneration,runtime.locale]);
  const byKey=useMemo(()=>new Map(layout.nodes.map(item=>[item.key,item])),[layout.nodes]);const viewportRef=useRef<HTMLDivElement|null>(null);const[fitMode,setFitMode]=useState<"width"|"height"|"all"|"actual">("all");const[fitScale,setFitScale]=useState(1);const[fitHeight,setFitHeight]=useState(520);
  useEffect(()=>{const measure=()=>{const el=viewportRef.current;if(!el)return;const vh=window.visualViewport?.height??window.innerHeight;const rect=el.getBoundingClientRect();const aw=Math.max(240,el.clientWidth-16),ah=Math.max(280,vh-Math.max(0,rect.top)-24);setFitHeight(ah);setFitScale(fitScaleForBox(fitMode,aw,ah,layout.width,layout.height))};measure();const ro=new ResizeObserver(measure);if(viewportRef.current)ro.observe(viewportRef.current);window.addEventListener("resize",measure);window.visualViewport?.addEventListener("resize",measure);return()=>{ro.disconnect();window.removeEventListener("resize",measure);window.visualViewport?.removeEventListener("resize",measure)}},[fitMode,layout.width,layout.height]);
  const edgePath=(fromKey:string,toKey:string)=>{const from=byKey.get(fromKey),to=byKey.get(toKey);if(!from||!to)return"";const fromX=runtime.locale==="fa"?from.x:from.x+from.width;const toX=runtime.locale==="fa"?to.x+to.width:to.x;const y1=from.y+from.height/2,y2=to.y+to.height/2;const bend=(fromX+toX)/2;return`M ${fromX} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${toX} ${y2}`};
  const relation=(value:PedigreeNode["relation"])=>({self:L("subject","رکورد اصلی"),father:L("sire","پدر"),mother:L("dam","مادر"),offspring:L("offspring","فرزند")}[value]);const fitted=fitMode!=="actual",stageW=fitted?layout.width*fitScale:layout.width,stageH=fitted?layout.height*fitScale:layout.height,lod=fitScale<.43?"micro":fitScale<.68?"compact":"full";
  return <div className={`edx-pedigree-graph-shell lod-${lod}`}><div className="edx-pedigree-graph-key"><span className="sire"/>{L("Sire line","شاخه پدری")}<span className="dam"/>{L("Dam line","شاخه مادری")}<span className="repeat"/>{L("Repeated","تکراری")}<span className="cycle"/>{L("Cycle","چرخه")}</div><div className="edx-pedigree-fitbar"><span>{Math.round(fitScale*100)}%</span>{(["width","height","all","actual"] as const).map(mode=><button key={mode} className={fitMode===mode?"active":""} onClick={()=>setFitMode(mode)}>{mode==="width"?L("Fit width","عرض"):mode==="height"?L("Fit height","ارتفاع"):mode==="all"?L("Fit all","همه"):L("Actual","واقعی")}</button>)}</div>
    <div ref={viewportRef} className="edx-pedigree-viewport" style={fitted?{height:fitHeight}:undefined}><div className="edx-pedigree-fit-stage" style={{width:stageW,height:stageH}}><div className="edx-pedigree-canvas" style={{width:layout.width,height:layout.height,transform:fitted?`scale(${fitScale})`:undefined,transformOrigin:"top left"}}><svg className="edx-pedigree-edges" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true"><defs><filter id="edx-edge-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>{layout.edges.map(edge=><path key={edge.key} className={`relation-${edge.relation}${edge.repeated?" repeated":""}${edge.cycle?" cycle":""}`} d={edgePath(edge.from,edge.to)} pathLength="1"/>)}</svg>{layout.nodes.map(item=>{const node=item.node;return <button key={item.key} className={`edx-pedigree-node generation-${node.generation} relation-${node.relation}${node.repeated?" repeated":""}${node.cycle?" cycle":""}`} style={{left:item.x,top:item.y,width:item.width,height:item.height}} onClick={()=>onOpen(node.horse)} title={`${horseName(node.horse,runtime.locale)} · #${num(node.horse.id,runtime.locale)}`}><span className="edx-node-rel">G{num(node.generation,runtime.locale)} · {relation(node.relation)}</span><strong dir="auto">{horseName(node.horse,runtime.locale)}</strong><small>#{num(node.horse.id,runtime.locale)}{node.horse.birth_year?` · ${year(node.horse.birth_year,runtime.locale)}`:""}{node.repeated?` · ${L("repeat","تکرار")}`:""}{node.cycle?` · ${L("cycle","چرخه")}`:""}</small></button>})}</div></div></div></div>;
}
export function PedigreeLedger({ root, runtime, onOpen, maxGeneration = 4 }: { root: PedigreeNode; runtime: FrontendRuntimeProps; onOpen: (horse: HorseRecord) => void; maxGeneration?: number }) {
  const L=(en:string,fa:string)=>edxText(runtime.locale,en,fa);
  const relation=(value:PedigreeNode["relation"])=>({self:L("subject","رکورد اصلی"),father:L("sire","پدر"),mother:L("dam","مادر"),offspring:L("offspring","فرزند")}[value]);
  const generations=useMemo(()=>{const map=new Map<number,PedigreeNode[]>();const walk=(node:PedigreeNode)=>{if(node.generation<=maxGeneration){const list=map.get(node.generation)??[];list.push(node);map.set(node.generation,list);for(const relative of node.parents??node.children??[])walk(relative)}};walk(root);return[...map.entries()].sort((a,b)=>a[0]-b[0]);},[root,maxGeneration]);
  return <div className="edx-pedigree-map">{generations.map(([generation,nodes])=><section key={generation} className="edx-pedigree-generation"><header><span>G{num(generation,runtime.locale)}</span><small>{generation===0?L("Subject","رکورد اصلی"):`${num(nodes.length,runtime.locale)} ${L(nodes.length===1?"recorded position":"recorded positions","جایگاه ثبت‌شده")}`}</small></header><div>{nodes.map((node,index)=><button key={`${node.horse.id}-${index}`} className={`${node.repeated?"repeat ":""}${node.cycle?"cycle":""}`} onClick={()=>onOpen(node.horse)}><HorsePortrait horse={node.horse} runtime={runtime} size="sm"/><span><strong dir="auto">{horseName(node.horse,runtime.locale)}</strong><small>#{num(node.horse.id,runtime.locale)} · {relation(node.relation)}{node.repeated?` · ${L("repeated","تکرارشونده")}`:""}</small></span></button>)}</div></section>)}</div>;
}

export function PedigreeRadial({ root, runtime, onOpen, maxGeneration = 5 }: { root: PedigreeNode; runtime: FrontendRuntimeProps; onOpen: (horse: HorseRecord) => void; maxGeneration?: number }) {
  const L=(en:string,fa:string)=>edxText(runtime.locale,en,fa);const slices=useMemo(()=>collectAncestorRadialSlots(root,Math.min(maxGeneration,6)),[root,maxGeneration]);const depth=Math.max(1,...slices.map(slice=>slice.generation));const size=900,c=size/2,core=82,ring=Math.min(64,(c-core-24)/depth);const hostRef=useRef<HTMLDivElement|null>(null);const[diameter,setDiameter]=useState(700);
  useEffect(()=>{const measure=()=>{const el=hostRef.current;if(!el)return;const vh=window.visualViewport?.height??window.innerHeight;const rect=el.getBoundingClientRect();setDiameter(Math.max(280,Math.min(el.clientWidth,Math.max(280,vh-Math.max(0,rect.top)-24))))};measure();const ro=new ResizeObserver(measure);if(hostRef.current)ro.observe(hostRef.current);window.addEventListener("resize",measure);window.visualViewport?.addEventListener("resize",measure);return()=>{ro.disconnect();window.removeEventListener("resize",measure);window.visualViewport?.removeEventListener("resize",measure)}},[]);
  return <div className="edx-radial-shell"><div className="edx-radial-copy"><strong>{L("Circular family tree","درخت خانوادگی حلقوی")}</strong><span>{L("Sire/dam hue is layered with generation shade and the radial expands to the actual available short axis.","رنگ شاخه پدری/مادری با سایه نسل ترکیب می‌شود و نمودار تا محور کوتاه واقعی فضای موجود گسترش می‌یابد.")}</span></div><div ref={hostRef} className="edx-radial-host"><div className="edx-radial-stage" style={{width:diameter,height:diameter}}><svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={L("Circular family tree","درخت خانوادگی حلقوی")}>
    {Array.from({length:depth},(_,i)=><circle key={i} className={`edx-radial-guide generation-${i+1}`} cx={c} cy={c} r={core+(i+1)*ring}/>) }
    {slices.map(slice=>{const span=360/slice.slots,gap=Math.min(1.5,span*.06),start=-90+slice.slot*span+gap,end=-90+(slice.slot+1)*span-gap,inner=core+(slice.generation-1)*ring+4,outer=core+slice.generation*ring-4,mid=(start+end)/2,pos=polarPoint(c,c,(inner+outer)/2,mid),show=span>=14&&slice.generation<=4,name=horseName(slice.node.horse,runtime.locale);return <g key={slice.key} className={`edx-radial-slice generation-${slice.generation} relation-${slice.node.relation}${slice.node.repeated?" repeated":""}${slice.node.cycle?" cycle":""}`} role="link" tabIndex={0} onClick={()=>onOpen(slice.node.horse)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onOpen(slice.node.horse)}}}><title>{name} · #{num(slice.node.horse.id,runtime.locale)}</title><path d={annularSectorPath(c,c,inner,outer,start,end)}/>{show&&<text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${mid>90&&mid<270?mid+180:mid},${pos.x},${pos.y})`}><tspan x={pos.x}>{name.length>16?`${name.slice(0,14)}…`:name}</tspan><tspan x={pos.x} dy="1.25em" className="edx-radial-id">#{num(slice.node.horse.id,runtime.locale)}</tspan></text>}</g>})}<g className="edx-radial-core" role="link" tabIndex={0} onClick={()=>onOpen(root.horse)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onOpen(root.horse)}}}><circle cx={c} cy={c} r={core-12}/><text x={c} y={c-8} textAnchor="middle"><tspan x={c}>{horseName(root.horse,runtime.locale).slice(0,18)}</tspan><tspan x={c} dy="1.4em" className="edx-radial-id">#{num(root.horse.id,runtime.locale)}</tspan></text></g>
  </svg></div></div></div>;
}
export function RegistryPulse({ horseCount, peopleCount, analyticsReady }: { horseCount?: number; peopleCount?: number; analyticsReady?: boolean }) {
  const locale=currentEquiDataLocale(); return <div className="edx-pulse"><div><span className="edx-live-dot"/><strong>{edxText(locale,"LIVE REGISTRY","سامانه ثبت زنده")}</strong></div><span>{num(horseCount,locale)} {edxText(locale,"horses","اسب")}</span><span>{num(peopleCount,locale)} {edxText(locale,"people","فرد")}</span><span>{analyticsReady?edxText(locale,"analytics online","تحلیل‌ها آماده‌اند"):edxText(locale,"analytics warming","تحلیل‌ها در حال آماده‌سازی‌اند")}</span></div>;
}

export function CoefficientGauge({ label, percentValue, note }: { label: string; percentValue: number | null | undefined; note?: string }) {
  const value=Math.max(0,Math.min(100,percentValue??0));
  return <div className="edx-gauge"><div className="edx-gauge-ring" style={{"--edx-gauge":`${value*3.6}deg`} as React.CSSProperties}><span>{pct(percentValue,2)}</span></div><div><strong>{label}</strong>{note&&<small>{note}</small>}</div></div>;
}
