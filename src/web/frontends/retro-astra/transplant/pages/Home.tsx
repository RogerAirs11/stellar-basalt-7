import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, ChevronUp, Eye, GitFork, Plus, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkspace } from '../lib/Workspace';
import { usePreferences } from '../preferences/PreferencesProvider';
import { isOneOf, navigate, useStoredState } from '../lib/hooks';
import { Button, HorseMark, IconButton, LinkButton, SexBadge, Status, TextLink } from '../components/ui';
import { DeskIcon } from '../components/DeskIcon';
import type { Horse } from '../data/horses';
// R117-29: canonical record-first sex display labels.
import { horseSexLabel } from '../../../../../frontend-kit';
import { useHorseDbAdapter } from '../HorseDbAdapter';
import pasture from '../../assets/donor/heritage-pasture.webp';

function DeskNotebook() {
  const { runtime } = useHorseDbAdapter();
  const { t, n } = usePreferences();
  const [meta,setMeta]=useState<{syntaxVersion:string;maxQueryLength:number;fieldCount:number;combinator:string}|null>(null);
  useEffect(()=>{let active=true;runtime.platform.search.meta().then(value=>{if(active)setMeta({syntaxVersion:value.syntaxVersion,maxQueryLength:value.maxQueryLength,fieldCount:value.fields.length,combinator:value.registryFieldSearch.combinator});}).catch(()=>{});return()=>{active=false;};},[runtime.platform]);
  return <section className="desk-notebook" aria-labelledby="notebook-title">
    <div className="notebook-binding" aria-hidden="true">{Array.from({length:8},(_,index)=><i key={index}/>)}</div>
    <div className="notebook-heading"><div><span className="notebook-kicker">HORSE DB</span><h2 id="notebook-title">{t('platformTools')}</h2></div><span className="pencil-decoration" aria-hidden="true"/></div>
    <div className="canonical-notebook-copy"><p><ShieldCheck size={14}/>{t('canonicalRegistry')}</p><dl><div><dt>Contract</dt><dd>{runtime.platformMeta?.contractVersion??runtime.platform.contractVersion}</dd></div><div><dt>Search syntax</dt><dd>{meta?.syntaxVersion??'—'}</dd></div><div><dt>Structured fields</dt><dd>{meta? n(meta.fieldCount):'—'}</dd></div><div><dt>Combinator</dt><dd>{meta?.combinator?.toUpperCase()??'—'}</dd></div><div><dt>Query limit</dt><dd>{meta? n(meta.maxQueryLength):'—'}</dd></div></dl></div>
    <div className="notebook-footer"><span><ShieldCheck size={12}/>{t('canonicalOnly')}</span><a href="#/collections/governance">{t('platformTools')}<ArrowRight size={12}/></a></div>
  </section>;
}

function FeaturedRecord({horse}:{horse:Horse}){
  const {horses,openModal}=useWorkspace(); const {t,text,n}=usePreferences();
  const sire=horses.find(item=>item.id===horse.sireId),dam=horses.find(item=>item.id===horse.damId);
  const metric=(value:number|null|undefined,suffix='')=>value==null?'—':`${n(value,{maximumFractionDigits:1})}${suffix}`;
  return <section className="desk-record-sheet" aria-labelledby="featured-title"><div className="desk-window-heading heading-forest"><span className="heading-icon"><DeskIcon name="registry" size={23}/></span><h2 id="featured-title">{t('featured')}</h2><span className="engraved-caption">{t('canonicalRegistry')}</span><span className="heading-rivet"/></div><div className="featured-record-body">
    <a href={`#/horses/${horse.id}`} className="mounted-photo"><img src={horse.image} alt=""/><i className="photo-corner corner-tl"/><i className="photo-corner corner-tr"/><i className="photo-corner corner-bl"/><i className="photo-corner corner-br"/><span className="mounted-photo-label">{text(horse.stud)} <span>/ {text(horse.country)}</span></span></a>
    <div className="featured-record-details"><div className="featured-record-code"><bdi dir="ltr">{horse.registration}</bdi><span className="demo-label">{t('horseRecord')}</span></div><a href={`#/horses/${horse.id}`} className="featured-record-name">{text(horse.name)}</a><div className="featured-record-meta"><SexBadge sex={horse.sex} recordedSex={horse.recordedSex}/><span>{horse.year?n(horse.year,{useGrouping:false}):'—'}<span className="inline-dot"/>{text(horse.coat)}<span className="inline-dot"/>{text(horse.breed)}</span></div>
      <dl className="featured-lineage">{([{key:'sire',record:sire,name:horse.sireName,id:horse.sireId},{key:'dam',record:dam,name:horse.damName,id:horse.damId}] as const).map(parent=><div key={parent.key}><dt><span className={`line-key ${parent.key}-key`}/>{t(parent.key)}</dt><dd>{parent.id?<a href={`#/horses/${parent.id}`}>{text(parent.record?.name??parent.name??'—')}<ChevronRight size={10}/></a>:t('noData')}</dd></div>)}</dl>
      <div className="featured-results"><div><strong>{metric(horse.recordedOffspring)}</strong><span>{t('recordedOffspringMetric')}</span></div><div><strong>{metric(horse.knownParents)}</strong><span>{t('knownParentsMetric')}</span></div><div><strong>{metric(horse.pedigreeCompleteness,'%')}</strong><span>{t('pedigreeCompletenessMetric')}</span></div><DeskIcon name="registry" size={31}/></div>
    </div></div><div className="desk-record-footer"><Status status={horse.status}/><div><IconButton label={t('quickLookHorse',{name:text(horse.name)})} onClick={()=>openModal({type:'preview',horseId:horse.id})}><Eye size={15}/></IconButton><TextLink href={`#/horses/${horse.id}`}>{t('openRecord')}</TextLink></div></div></section>;
}

function PedigreeWindow({horse}:{horse:Horse}){
  const {horses,openModal}=useWorkspace(); const {t,text,n}=usePreferences();
  return <section className="desk-pedigree-sheet" aria-labelledby="family-title"><div className="desk-window-heading heading-blue"><span className="heading-icon"><DeskIcon name="pedigree" size={23}/></span><h2 id="family-title">{t('furtherBack')}</h2><span className="engraved-caption">{t('familyTree')}</span><span className="heading-rivet"/></div><div className="pedigree-preview"><div className="preview-legend"><span><i className="line-key sire-key"/>{t('sireLine')}</span><span><i className="line-key dam-key"/>{t('damLine')}</span></div><div className="mini-tree"><button className="mini-node mini-root" onClick={()=>openModal({type:'preview',horseId:horse.id})}><span className="node-label">{t('subject')}</span><HorseMark/><strong>{text(horse.name)}</strong><small>{horse.year?n(horse.year,{useGrouping:false}):'—'} / {text(horse.coat)}</small></button><div className="mini-tree-branches">{([{key:'sire',id:horse.sireId,name:horse.sireName},{key:'dam',id:horse.damId,name:horse.damName}] as const).map((parent,index)=>{const record=horses.find(item=>item.id===parent.id);return <button key={parent.key} className={`mini-node mini-${parent.key}`} onClick={()=>parent.id&&navigate(`/horses/${parent.id}`)} disabled={!parent.id}><span className="node-label">{t(parent.key)}<span>{n(index+1,{minimumIntegerDigits:2})}</span></span><strong>{text(record?.name??parent.name??t('noData'))}</strong><small>{record?`${record.year||'—'} / ${text(record.coat)}`:t('unknownAncestor')}</small><ChevronRight size={12}/></button>;})}</div></div><div className="tree-caption"><span/>{t('familyMotto')}<span/></div></div><div className="desk-record-footer"><span className="pedigree-footer-note"><GitFork size={13}/>{t('canonicalRegistry')}</span><TextLink href={`#/pedigree/${horse.id}`}>{t('unfoldPedigree')}</TextLink></div></section>;
}

function RegistryLedger({folded}:{folded:boolean}){
  const {horses,featuredHorses,viewport,openModal}=useWorkspace(); const {t,text,n,language}=usePreferences();
  // R62: showcase the stable registry-order pool on the home desk so the ledger
  // never degrades into the dash-named legacy page after a directory visit.
  const ledgerPool=featuredHorses.length?featuredHorses:horses;
  const [mode,setMode]=useState<'all'|'active'>('all'); const rows=(mode==='active'?ledgerPool.filter(h=>h.status==='Active'):ledgerPool); const rowLimit=viewport.phone?4:Math.max(3,Math.min(8,Math.floor((viewport.height-(folded?510:680))/46)+3)); const listed=rows.slice(0,rowLimit);
  return <section className="desk-ledger" aria-labelledby="desk-ledger-title"><div className="desk-window-heading heading-ledger"><DeskIcon name="registry" size={23}/><h2 id="desk-ledger-title">{t('directory')}</h2><div className="ledger-view-tabs" role="group"><button className={mode==='all'?'active':''} onClick={()=>setMode('all')}>{t('allRecords')}</button><button className={mode==='active'?'active':''} onClick={()=>setMode('active')}>{text('Active')} <span>{n(ledgerPool.filter(h=>h.status==='Active').length)}</span></button></div></div><div className="desk-ledger-scroll"><table className="desk-ledger-table"><thead><tr><th className="ledger-number-column">{t('number')}</th><th>{t('horseRecord')}</th><th>{t('foaled')}</th><th>{t('status')}</th><th><span className="sr-only">{t('actions')}</span></th></tr></thead><tbody>{listed.map((horse,index)=><tr key={horse.id}><td className="ledger-number-column">{n(index+1,{minimumIntegerDigits:2})}</td><td><a className="horse-cell" href={`#/horses/${horse.id}`}><img src={horse.image} alt=""/><span><strong>{text(horse.name)}</strong><small>{text(horse.coat)} {horseSexLabel(horse.recordedSex ?? horse.sex, language)}</small></span></a></td><td className="ledger-year">{horse.year?n(horse.year,{useGrouping:false}):'—'}<small>{text(horse.country)}</small></td><td><Status status={horse.status}/></td><td><div className="row-actions"><IconButton label={t('quickLookHorse',{name:text(horse.name)})} onClick={()=>openModal({type:'preview',horseId:horse.id})}><Eye size={14}/></IconButton><a className="icon-button row-open-link" href={`#/horses/${horse.id}`} aria-label={`${t('openRecord')}: ${text(horse.name)}`}><ChevronRight size={14}/></a></div></td></tr>)}</tbody></table></div><div className="desk-record-footer"><span className="ledger-record-count">{t('recordsCount',{count:rows.length})}</span><TextLink href="#/horses">{t('openDirectory')}</TextLink></div></section>;
}

export function Home(){
  const {horses,featuredHorses,name,viewport,density}=useWorkspace(); const {t,text,n}=usePreferences(); const {runtime,loading,error,total}=useHorseDbAdapter();
  const [query,setQuery]=useState(''),[breed,setBreed]=useState(''),[welcomeState,setWelcomeState]=useStoredState<'auto'|'open'|'closed'>('retroastra.presentation.welcome.v1','auto',isOneOf(['auto','open','closed']));
  const folded=welcomeState==='closed'||(welcomeState==='auto'&&(viewport.short||density==='compact'));
  // R62: the canonical registry contains legacy records whose "name" is literally
  // dashes (unnamed horses from the source import). Featuring the first row of a
  // name-ascending sort put one of those on the desk — the record card showed
  // "---------" and an empty pedigree tree, which reads as broken text/titles.
  // Feature a horse that actually has a name, preferring one with both parents
  // known so the pedigree window shows real lineage.
  const placeholderName=/^[-–—\s_.]*$|^(unknown|فاقد نام|بدون نام|نامعلوم)$/i;
  const isUnnamed=(h:Horse)=>placeholderName.test((h.name??'').trim())&&placeholderName.test((h.nativeName??'').trim());
  const featuredPool=featuredHorses.length?featuredHorses:horses;
  const featured=featuredPool.find(h=>!isUnnamed(h)&&h.sireId&&h.damId)??featuredPool.find(h=>!isUnnamed(h))??featuredPool[0];
  const submit=(e:React.FormEvent)=>{e.preventDefault();const q=[query.trim(),breed].filter(Boolean).join(' ');window.location.hash=q?`#/horses?q=${encodeURIComponent(q)}`:'#/horses';};
  return <div className="home-page"><div className="desk-page-title"><div><span className="desk-section-marker">{n(1,{minimumIntegerDigits:2})}</span>{folded?<h1>{t('welcome')}</h1>:<h2>{t('welcome')}</h2>}<span className="desk-welcome-message">{t('welcomeGreeting',{greeting:'',name:text(name)})}</span></div><div className="desk-title-actions">{welcomeState!=='auto'&&<IconButton label={t('autoWelcome')} onClick={()=>setWelcomeState('auto')}><RotateCcw size={12}/></IconButton>}<button className="fold-welcome" aria-label={t(folded?'unfoldWelcome':'foldWelcome')} onClick={()=>setWelcomeState(folded?'open':'closed')} aria-expanded={!folded}>{folded?<ChevronDown size={13}/>:<ChevronUp size={13}/>}<span>{t(folded?'unfoldWelcome':'foldWelcome')}</span></button>{runtime.permissions.includes('horse.create')&&<Button small onClick={()=>navigate('/collections/governance')}><Plus size={14}/>{t('newHorse')}</Button>}</div></div>
    <AnimatePresence initial={false}>{!folded&&<motion.div className="welcome-plate-wrapper" id="welcome-plate" initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} transition={{duration:.25}}><section className="welcome-hero" aria-labelledby="welcome-title"><motion.img className="hero-image" src={pasture} alt="" initial={{scale:1.025}} animate={{scale:1}} transition={{duration:1.2}} fetchPriority="high"/><div className="hero-wash"/><div className="hero-copy"><span className="hero-eyebrow">HORSE DB · {t('canonicalRegistry')}</span><h1 id="welcome-title">{t('appName')}<span>.</span></h1><p className="hero-manifesto">{t('heroHeadline')}</p><p className="hero-description">{t('heroDescription')}</p><div className="hero-actions"><LinkButton primary href="#/horses"><DeskIcon name="registry" size={19}/>{t('openDirectory')}<ArrowRight size={14}/></LinkButton>{featured&&<a className="hero-secondary" href={`#/pedigree/${featured.id}`}><GitFork size={14}/>{t('followBloodline')}<ChevronRight size={13}/></a>}</div></div></section></motion.div>}</AnimatePresence>
    <form className={`desk-findbar ${folded?'is-folded':''}`} onSubmit={submit}><span className="findbar-label"><Search size={15}/>{t('quickFind')}</span><input dir="auto" aria-label={t('findHorse')} value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('quickFindPlaceholder')}/><select aria-label={t('breed')} value={breed} onChange={e=>setBreed(e.target.value)}><option value="">{t('allBreeds')}</option>{[...new Set(horses.map(h=>h.breed).filter(v=>v&&v!=='—'))].map(v=><option key={v} value={v}>{text(v)}</option>)}</select><Button type="submit" small>{t('findHorse')}<ArrowRight size={13}/></Button><span className="findbar-count">{loading?'Loading…':error||t('onShelf',{count:total})}</span></form>
    <div className="home-feature-grid">{featured?<><FeaturedRecord horse={featured}/><PedigreeWindow horse={featured}/></>:<section className="desk-record-sheet"><div className="empty-state"><HorseMark/><h3>{loading?'Loading canonical registry…':'No registry record available'}</h3><p>{error??'The donor surface is waiting for canonical Horse DB data.'}</p></div></section>}</div>
    <div className="home-bottom-grid"><RegistryLedger folded={folded}/><DeskNotebook/></div>
  </div>;
}
