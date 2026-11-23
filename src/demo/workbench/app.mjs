import {DEMO_REVISION,escapeHtml as e,readState,writeState,newState,parseRoute,toggleSaved,addInquiry,transitionInquiry,withdrawInquiry,addTask,informationExtract,STORAGE_KEY,newDemoId} from './model.mjs';
import {createViews} from './views.mjs';
import {calculateEconomics,DEFAULT_ECONOMICS} from '../business-model/economics.js';

const ROOT=document.querySelector('#app');
const dialog=document.querySelector('#request-dialog');
const isBusiness=location.pathname.includes('/business-model/');
let language=new URLSearchParams(location.search).get('lang')==='fa'?'fa':'en';
let data,state,storage,storageNotice=null,filters={},route=parseRoute(location.hash,isBusiness),density='compact';
let toastTimer,dialogOpener=null;
try {storage=window.localStorage;} catch {storage=null;}
const t=(en,fa)=>language==='fa'?fa:en;
const navigation=[
 ['home','01','Overview','\u0646\u0645\u0627\u06cc \u06a9\u0644\u06cc'],['horses','02','Horse registry','\u067e\u0627\u06cc\u06af\u0627\u0647 \u0627\u0633\u0628'],['compare','03','Pedigree lab','\u0628\u0631\u0631\u0633\u06cc \u0634\u062c\u0631\u0647'],['people','04','People','\u0627\u0641\u0631\u0627\u062f'],['directory','05','Professionals','\u0645\u062a\u062e\u0635\u0635\u0627\u0646'],['marketplace','06','Horse market','\u0628\u0627\u0632\u0627\u0631 \u0627\u0633\u0628'],['products','07','Equipment & supplies','\u0644\u0648\u0627\u0632\u0645 \u0648 \u062a\u062c\u0647\u06cc\u0632\u0627\u062a'],['events','08','Events & results','\u0631\u0648\u06cc\u062f\u0627\u062f \u0648 \u0646\u062a\u0627\u06cc\u062c'],['workspace','09','Stable workspace','\u0645\u062f\u06cc\u0631\u06cc\u062a \u0627\u0635\u0637\u0628\u0644'],['inbox','10','Private inquiries','\u062f\u0631\u062e\u0648\u0627\u0633\u062a\u200c\u0647\u0627'],['saved','11','Saved horses','\u0630\u062e\u06cc\u0631\u0647\u200c\u0634\u062f\u0647\u200c\u0647\u0627'],['business','12','Business model','\u0645\u062f\u0644 \u062f\u0631\u0622\u0645\u062f'],['trust','13','Trust & privacy','\u0627\u0639\u062a\u0645\u0627\u062f \u0648 \u062d\u0631\u06cc\u0645 \u062e\u0635\u0648\u0635\u06cc'],['capabilities','14','Capability map','\u0646\u0642\u0634\u0647 \u0627\u0645\u06a9\u0627\u0646\u0627\u062a'],
];
function views(){return createViews(data,state,language,filters);}
function render(focus=false){
 const v=views(),allowed=new Set(['home','horses','saved','horse','people','person','directory','provider','marketplace','listing','products','compare','workspace','inbox','events','event','business','capabilities','trust']);
 const method=allowed.has(route.name)?v[route.name]:v.notFound;
 const active=({horse:'horses',person:'people',provider:'directory',listing:'marketplace',event:'events'})[route.name]||route.name;
 document.documentElement.lang=language;document.documentElement.dir=language==='fa'?'rtl':'ltr';
 document.body.classList.toggle('compact',density==='compact');document.body.dataset.density=density;
 document.querySelector('.skip').textContent=t('Skip to content','\u0631\u0641\u062a\u0646 \u0628\u0647 \u0645\u062d\u062a\u0648\u0627');
 ROOT.innerHTML=`<div class="shell"><aside class="sidebar"><a href="#/home" class="brand"><span class="brandmark" aria-hidden="true">A</span><div><strong>Equine Atlas</strong><small>${t('The connected horse platform','\u0633\u0627\u0645\u0627\u0646\u0647 \u067e\u06cc\u0648\u0633\u062a\u0647 \u0627\u0633\u0628')}</small></div></a><div class="nav-group">${t('Explore / organize / connect','\u062c\u0633\u062a\u200c\u0648\u062c\u0648 / \u0645\u062f\u06cc\u0631\u06cc\u062a / \u0627\u0631\u062a\u0628\u0627\u0637')}</div><nav class="nav-list" aria-label="${t('Main navigation','\u0645\u0633\u06cc\u0631\u06cc\u0627\u0628\u06cc \u0627\u0635\u0644\u06cc')}">${navigation.map(([name,icon,en,fa])=>`<a class="nav-link" href="#/${name}"${active===name?' aria-current="page"':''}><span class="nav-icon mono" aria-hidden="true">${icon}</span><span>${t(en,fa)}</span>${name==='inbox'&&state.inquiries.length?`<span class="nav-count">${state.inquiries.length}</span>`:''}</a>`).join('')}</nav><div class="sidebar-note">${e(DEMO_REVISION)} / ${e(data.namespace)}<br>${t('Synthetic data. Real possibilities.','\u062f\u0627\u062f\u0647 \u0646\u0645\u0627\u06cc\u0634\u06cc\u060c \u0642\u0627\u0628\u0644\u06cc\u062a \u0645\u0644\u0645\u0648\u0633.')}<br>${e(data.as_of)}</div></aside><div class="frame"><header class="topbar"><span class="context">${t('Independent platform / Client demonstration','\u0633\u0627\u0645\u0627\u0646\u0647 \u0645\u0633\u062a\u0642\u0644 / \u0646\u0645\u0627\u06cc\u0634 \u0628\u0647 \u06a9\u0627\u0631\u0641\u0631\u0645\u0627')}</span><div class="topbar-actions"><button data-action="density" aria-pressed="${density==='compact'}">${density==='compact'?t('Compact','\u0641\u0634\u0631\u062f\u0647'):t('Comfortable','\u0628\u0627\u0641\u0627\u0635\u0644\u0647')}</button><button data-action="language" lang="${language==='en'?'fa':'en'}">${language==='en'?'\u0641\u0627\u0631\u0633\u06cc':'English'}</button></div></header><div class="demo-banner"><strong>${t('DEMO MODE','\u062d\u0627\u0644\u062a \u0646\u0645\u0627\u06cc\u0634')}</strong><span>${t('Fictional records. Local interactions. No real messages, credentials or payments.','\u067e\u0631\u0648\u0646\u062f\u0647 \u0633\u0627\u062e\u062a\u06af\u06cc\u060c \u062a\u0639\u0627\u0645\u0644 \u0645\u062d\u0644\u06cc. \u0628\u062f\u0648\u0646 \u067e\u06cc\u0627\u0645\u060c \u0645\u062c\u0648\u0632 \u06cc\u0627 \u067e\u0631\u062f\u0627\u062e\u062a \u0648\u0627\u0642\u0639\u06cc.')}</span><a href="#/trust">${t('Read boundaries','\u0645\u062d\u062f\u0648\u062f\u06cc\u062a\u200c\u0647\u0627')}</a></div><main class="main" id="main"><p class="print-only">DEMO ONLY - NOT AN OFFICIAL DOCUMENT</p>${storageNotice?`<div class="alert section-gap">${e(storageNotice)}</div>`:''}${method(route.id)}<footer class="footnote">${t('Demonstration. Do not enter real personal information. Fixture date:','\u0646\u0645\u0627\u06cc\u0634. \u0627\u0637\u0644\u0627\u0639\u0627\u062a \u0634\u062e\u0635\u06cc \u0648\u0627\u0642\u0639\u06cc \u0648\u0627\u0631\u062f \u0646\u06a9\u0646\u06cc\u062f. \u062a\u0627\u0631\u06cc\u062e \u0646\u0645\u0648\u0646\u0647:')} ${e(data.as_of)} / <a href="#/capabilities">${t('Production boundaries','\u0645\u0631\u0632\u0647\u0627\u06cc \u0646\u0633\u062e\u0647 \u0648\u0627\u0642\u0639\u06cc')}</a></footer></main></div></div>`;
 document.title=`${document.querySelector('main h1')?.textContent||'Equine Atlas'} | ${DEMO_REVISION} DEMO`;
 if(focus)document.querySelector('main h1')?.focus({preventScroll:true});
}
function announce(message){document.querySelector('#announcer').textContent=message;document.querySelector('.toast')?.remove();clearTimeout(toastTimer);const el=document.createElement('div');el.className='toast';el.textContent=message;document.body.append(el);toastTimer=setTimeout(()=>el.remove(),4500);}
function commit(next,message){state=next;storageNotice=writeState(storage,state,data);render();if(message)announce(message);}
function go(name){if(location.hash===`#/${name}`){route=parseRoute(location.hash,isBusiness);render(true);}else location.hash=`/${name}`;}
function closeDialog(){dialog.close();dialogOpener?.focus?.();}
function scenario(name){
 const x=structuredClone(DEFAULT_ECONOMICS);
 if(name==='growth'||name==='downside'){x.products[0].monthlyUnits=60;x.products[1].monthlyUnits=120;x.products[2].monthlyUnits=100;}
 if(name==='downside')for(const p of x.products)p.monthlyUnits=Math.floor(p.monthlyUnits*.75);
 filters.economics=x;render();
}
function economicsFromForm(form){
 const fd=new FormData(form),read=key=>{const raw=String(fd.get(key)??'');if(!/^\d+$/.test(raw))throw new Error(t('All assumptions must be non-negative whole numbers.','\u0647\u0645\u0647 \u0641\u0631\u0636\u200c\u0647\u0627 \u0628\u0627\u06cc\u062f \u0639\u062f\u062f \u0635\u062d\u06cc\u062d \u063a\u06cc\u0631\u0645\u0646\u0641\u06cc \u0628\u0627\u0634\u0646\u062f.'));return Number(raw);};
 return {fixedMonthlyCostToman:read('fixed'),products:DEFAULT_ECONOMICS.products.map(p=>({id:p.id,monthlyUnits:read(`${p.id}-units`),unitPriceToman:read(`${p.id}-price`),unitVariableCostToman:read(`${p.id}-cost`)}))};
}
function refreshEconomics(form){
 const result=document.querySelector('#economics-results');if(!result)return;
 try {const value=economicsFromForm(form);const output=calculateEconomics(value);filters.economics=value;result.innerHTML=views().businessResults(output);}
 catch(error){result.innerHTML=`<div class="alert error" id="model-error" role="alert">${e(error.message)}</div>`;}
}
ROOT.addEventListener('click',event=>{
 const button=event.target.closest('[data-action]');if(!button)return;
 const {action,id}=button.dataset;
 try {
  if(action==='save')commit(toggleSaved(state,Number(id),data),t('Updated your local saved list.','\u0641\u0647\u0631\u0633\u062a \u0645\u062d\u0644\u06cc \u0628\u0647\u200c\u0631\u0648\u0632 \u0634\u062f.'));
  if(action==='language'){language=language==='en'?'fa':'en';const u=new URL(location.href);u.searchParams.set('lang',language);history.replaceState(null,'',u);render(true);}
  if(action==='density'){density=density==='compact'?'comfortable':'compact';render();}
  if(action==='clear-filters'){filters={};render();}
  if(action==='inquire'){dialogOpener=button;dialog.innerHTML=views().requestDialog(id);dialog.showModal();dialog.querySelector('textarea').focus();}
  if(action==='pair-preset'){filters={sire:Number(button.dataset.sire),dam:Number(button.dataset.dam)};render();}
  if(action==='cart'){if(!data.products.some(p=>p.id===id))throw new Error('Unknown product');commit({...state,cart:state.cart.includes(id)?state.cart.filter(x=>x!==id):[...state.cart,id]},t('Quote shortlist updated; no purchase created.','\u0641\u0647\u0631\u0633\u062a \u0628\u0647\u200c\u0631\u0648\u0632 \u0634\u062f\u061b \u062e\u0631\u06cc\u062f\u06cc \u0627\u0646\u062c\u0627\u0645 \u0646\u0634\u062f.'));}
  if(action==='complete-task'){const row=state.tasks.find(x=>x.id===id);if(!row||row.status!=='open')throw new Error('Task already closed');commit({...state,tasks:state.tasks.map(x=>x.id===id?{...x,status:'done'}:x)},t('Demo reminder completed.','\u06cc\u0627\u062f\u0622\u0648\u0631 \u0646\u0645\u0627\u06cc\u0634\u06cc \u0627\u0646\u062c\u0627\u0645 \u0634\u062f.'));}
  if(action==='inquiry-status')commit(transitionInquiry(state,id,button.dataset.status),t('Local simulation advanced; no provider replied.','\u0634\u0628\u06cc\u0647\u200c\u0633\u0627\u0632\u06cc \u0645\u062d\u0644\u06cc \u0628\u0647\u200c\u0631\u0648\u0632 \u0634\u062f\u061b \u067e\u0627\u0633\u062e \u0648\u0627\u0642\u0639\u06cc \u0646\u06cc\u0633\u062a.'));
  if(action==='withdraw')commit(withdrawInquiry(state,id),t('Local note cleared and simulated consent withdrawn.','\u06cc\u0627\u062f\u062f\u0627\u0634\u062a \u0645\u062d\u0644\u06cc \u067e\u0627\u06a9 \u0648 \u0631\u0636\u0627\u06cc\u062a \u0646\u0645\u0627\u06cc\u0634\u06cc \u0644\u063a\u0648 \u0634\u062f.'));
  if(action==='scenario')scenario(button.dataset.scenario);
  if(action==='reset'&&confirm(t('Reset only this demo notes, saved horses, reminders and shortlist? Other browser storage will not be touched.','\u0641\u0642\u0637 \u06cc\u0627\u062f\u062f\u0627\u0634\u062a\u200c\u0647\u0627\u060c \u0630\u062e\u06cc\u0631\u0647\u200c\u0647\u0627 \u0648 \u06cc\u0627\u062f\u0622\u0648\u0631\u0647\u0627\u06cc \u0646\u0645\u0627\u06cc\u0634 \u0628\u0627\u0632\u0646\u0634\u0627\u0646\u06cc \u0634\u0648\u062f\u061f'))){commit(newState(),t('Only this demo was reset.','\u0641\u0642\u0637 \u0627\u06cc\u0646 \u0646\u0645\u0627\u06cc\u0634 \u0628\u0627\u0632\u0646\u0634\u0627\u0646\u06cc \u0634\u062f.'));}
  if(action==='extract'){
   const extract=informationExtract(data,Number(id),new Date().toISOString());const blob=new Blob([JSON.stringify(extract,null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`DEMO-NOT-OFFICIAL-H${id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);announce(t('Synthetic information extract created, not an official document.','\u062e\u0631\u0648\u062c\u06cc \u0633\u0627\u062e\u062a\u06af\u06cc \u0627\u0633\u062a\u060c \u0646\u0647 \u0633\u0646\u062f \u0631\u0633\u0645\u06cc.'));
  }
 }catch(error){announce(error.message);}
});
ROOT.addEventListener('submit',event=>{
 const form=event.target;if(!(form instanceof HTMLFormElement))return;event.preventDefault();
 const fd=new FormData(form);
 try {
  if(['horse-filters','directory-filters','compare-form'].includes(form.id)){filters=Object.fromEntries(fd);render(true);}
  if(form.id==='task-form')commit(addTask(state,{title:fd.get('title'),due:fd.get('due'),horseId:Number(fd.get('horseId'))},data,newDemoId()),t('Local reminder created.','\u06cc\u0627\u062f\u0622\u0648\u0631 \u0645\u062d\u0644\u06cc \u0633\u0627\u062e\u062a\u0647 \u0634\u062f.'));
  if(form.id==='economics-form')refreshEconomics(form);
 }catch(error){announce(error.message);}
});
ROOT.addEventListener('input',event=>{const form=event.target.closest('#economics-form');if(form)refreshEconomics(form);});
dialog.addEventListener('click',event=>{if(event.target.closest('[data-action="close-dialog"]'))closeDialog();});
dialog.addEventListener('submit',event=>{
 event.preventDefault();const form=event.target,fd=new FormData(form);
 try {const next=addInquiry(state,{targetId:fd.get('targetId'),note:fd.get('note'),shareContact:fd.get('shareContact')==='on'},data,newDemoId(),new Date().toISOString());closeDialog();commit(next);go('inbox');announce(t('Created in this browser only. No real message sent.','\u0641\u0642\u0637 \u062f\u0631 \u0627\u06cc\u0646 \u0645\u0631\u0648\u0631\u06af\u0631 \u0630\u062e\u06cc\u0631\u0647 \u0634\u062f. \u067e\u06cc\u0627\u0645\u06cc \u0627\u0631\u0633\u0627\u0644 \u0646\u0634\u062f.'));}
 catch(error){dialog.querySelector('#request-error').textContent=error.message;}
});
window.addEventListener('hashchange',()=>{filters={};route=parseRoute(location.hash,isBusiness);render(true);window.scrollTo(0,0);});
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY&&data){const loaded=readState(storage,data);state=loaded.state;storageNotice=loaded.notice;render();}});
async function boot(){
 try {
  const response=await fetch(new URL('./data.json',import.meta.url),{cache:'no-store'});if(!response.ok)throw new Error('Synthetic data unavailable');data=await response.json();
  if(data.is_demo!==true||data.namespace!=='synthetic:r88'||!Array.isArray(data.horses))throw new Error('Refusing non-demo data');
  const loaded=readState(storage,data);state=loaded.state;storageNotice=loaded.notice;render();
 }catch(error){ROOT.innerHTML=`<main class="main" id="main"><h1>Demonstration unavailable</h1><p>${e(error.message)}</p><p>Serve the public directory with a local HTTP server. No production data is used as a fallback.</p><button id="retry-boot">Retry</button></main>`;document.querySelector('#retry-boot').addEventListener('click',boot);}
}
boot();
