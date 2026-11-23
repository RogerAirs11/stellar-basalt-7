import { captureFormState, restoreFormState } from "./presentationState.js";
import { NAVIGATION_LABELS, fitNavigationTabs, navigationGroups, filterNavigation, navigationStorageKey, parseNavigationLayout } from "./navigationModel.js";
import { state,t,fa,esc,attr,num,bootstrapData,setLocale,parseHash,api,toast,closeModal,loading,errorBox , refreshAuth,L3 } from "./core.js";
import { renderHome } from "./views/home.js";
import { renderRegistry,registryActions,submitRegistryFilter } from "./views/registry.js";
import { renderHorse,horseActions,submitHorseDepth,submitPedigreePath } from "./views/horse.js";
import { renderPeople,renderPerson,submitPeopleSearch } from "./views/people.js";
import { renderPedigree,renderBreeding,renderAnalytics,submitRelationship,submitPedigreeOpen,submitPairing,submitOptimizer } from "./views/labs.js";
import { renderContent,renderPost } from "./views/content.js";
import { renderAccount,accountActions,submitLogin } from "./views/account.js";
import { renderAdmin,adminActions,submitAdminOpenHorse,resetAdminCaches } from "./views/admin.js";
import { renderMarket,submitMarketInquiry } from "./views/market.js";
import { renderSearch,submitPageSearch } from "./views/search.js";
import { renderPreferences,preferenceAction,preferenceChange,preferenceInput,closePreferences } from "./preferences.js";
import { playCue } from "./sound.js";

import { installClassicHostBridge } from "./hostBridge.js";
import { dispatchModalForm } from './modalForms.js';
import { horseRequestAction, resetHorseRequests, refreshHorseRequestPresentation } from './views/horseRequests.js';
import { renderDirectory, resetDirectoryWorkbench } from './views/directory.js';
import { renderServices, resetServiceWorkbench } from './views/services.js';

let root=document.getElementById("workspace");
const contextLocations = new Map();
// Give each async route its own DOM target. Late requests can only paint into
// a detached old target, never overwrite the newly selected view.
function freshWorkspace(){
 contextLocations.clear();
 const next=root.cloneNode(false); root.replaceWith(next); root=next;
 const context=document.getElementById("classic-context-navigation"); if(context)context.replaceChildren();
 return next;
}
const app=document.getElementById("app");

const navigationKey=navigationStorageKey("classic-registry");
let navigationLayout="tabs";
try { navigationLayout=parseNavigationLayout(localStorage.getItem(navigationKey)); } catch { /* Optional preference storage. */ }
let navigationQuery="";
let navigationOpen=false;
// R116: adaptive primary tab row — how many canonical destinations currently
// fit the measured bar width (Infinity until the first measurement, so the
// first paint keeps every destination visible like the React skins).
let fittedTabIndices=null;
let bootComplete = false;
window.addEventListener("storage",async event=>{
 if(event.key!==navigationKey)return;
 navigationLayout=parseNavigationLayout(event.newValue);
 if(bootComplete)renderChrome();
});
// R117: keep the fitted tab set honest — viewport resizes, host-iframe
// container changes and late webfont swaps all change what fits.
window.addEventListener("resize",fitPrimaryTabs);
if(typeof ResizeObserver!=="undefined"){
 const classicNavObserver=new ResizeObserver(()=>fitPrimaryTabs());
 const observePrimaryNav=()=>{const nav=document.getElementById("primary-nav");if(nav)classicNavObserver.observe(nav);};
 observePrimaryNav();
 window.addEventListener("hashchange",observePrimaryNav);
}
if(document.fonts?.ready)document.fonts.ready.then(()=>fitPrimaryTabs()).catch(()=>{});
document.fonts?.addEventListener?.("loadingdone",fitPrimaryTabs);
installClassicHostBridge({
  locale: async (locale) => {
    if (state.locale === locale) return;
    if (bootComplete) await changeLocale(locale);
    else setLocale(locale);
  },
  ai: (open) => { document.documentElement.dataset.hostAiOpen = open ? "1" : "0"; },
  // R107 NEXT-05: the HOST principal changed (login/logout/account switch).
  // Re-read the authoritative session, drop principal-scoped caches and
  // re-render: the admin/account view guards then render under the NEW
  // principal (or the public session) — the old principal's data never
  // survives the switch.
  session: async () => {
    if (!bootComplete) return;
    const pending = refreshAuth(); // clears in-memory authority synchronously
    resetAdminCaches(); resetHorseRequests(); resetDirectoryWorkbench(); resetServiceWorkbench(); closeModal();
    const target = freshWorkspace(); target.innerHTML = loading();
    renderChrome(); // old private DOM/chrome is gone before waiting for /me
    if (!await pending) return;
    renderChrome();
    await renderRoute();
  },
});
await bootstrapData();
parseHash();
renderChrome();
renderPreferences();
await renderRoute();
app.setAttribute("aria-busy","false");
bootComplete = true;
if (window.parent !== window) window.parent.postMessage({ type: "horse-db-classic-ready" }, location.origin);

window.addEventListener("hashchange",async()=>{navigationOpen=false;parseHash();renderChrome();if(await renderRoute()){root.focus({preventScroll:true});scrollTo({top:0,behavior:"instant"})}});

document.addEventListener("click",async(e)=>{
 const routeLink=e.target.closest('a[href^="#/"]'); if(routeLink)playCue("navigate");
 const el=e.target.closest("[data-action]"); if(!el)return; const action=el.dataset.action;
 if(preferenceAction(action,el))return;
 if(action==="toggle-language"){await changeLocale(state.locale==="en"?"fa":state.locale==="fa"?"ar":"en");return}
 if(action==="clear-navigation-search"){clearNavigationSearch();return}
 if(action==="toggle-navigation"){setNavigationOpen(!navigationOpen);return}
 if(action==="close-navigation"){setNavigationOpen(false,true);return}
 if(action==="close-navigation-more"){closeNavigationMore(true);return}
 if(action==="close-modal"){closeModal();return}
 if(action==='horse-request-refresh'||action==='horse-request-ack'){await horseRequestAction(action,el);return}
 if(action==="reload-route"){await renderRoute();return}
 if(action?.startsWith("registry-"))return registryActions(action,el);
 if(["horse-claim","horse-change","horse-edit","horse-archive","confirm-archive","submit-claim","submit-change","save-horse"].includes(action))return horseActions(action,el);
 if(["demo-admin-login","logout"].includes(action))return accountActions(action,el);
 if(["review-claim","review-change","submit-review","run-reindex","run-reconcile","add-horse","create-horse","add-content","edit-content","create-content","save-content","generate-content","submit-ai-generate","preview-content","publish-content","retract-content","history-content","privacy-decide","submit-privacy-decide","privacy-fulfill"].includes(action))return adminActions(action,el);
});

document.addEventListener("change", async (e)=>{
 const el=e.target; if(!(el instanceof HTMLInputElement||el instanceof HTMLSelectElement))return;
 if(el.id==="classic-navigation-layout"){
  navigationLayout=parseNavigationLayout(el.value);
  try { localStorage.setItem(navigationKey,navigationLayout); } catch { /* Work without persistent storage. */ }
  navigationOpen=false;renderChrome();
  document.getElementById("classic-navigation-layout")?.focus();return;
 }
 if(el.matches("select[data-context-route]")){location.hash=el.value;return}
 if(preferenceChange(el))return;
});
document.addEventListener("input",(e)=>{const el=e.target;if(el instanceof HTMLInputElement){if(el.id==="classic-navigation-search"){navigationQuery=el.value;renderSidebarGroups();return}preferenceInput(el)}});

document.addEventListener("submit",async(e)=>{
 const form=e.target; if(!(form instanceof HTMLFormElement))return;
 const id=form.id;
 if(!["global-search"].includes(id))e.preventDefault();
 try{
  if(await dispatchModalForm(form,{horse:horseActions,admin:adminActions}))return;
  if(id==="global-search"){e.preventDefault();const q=String(new FormData(form).get("q")||"").trim();location.hash=`#/search${q?`?q=${encodeURIComponent(q)}`:""}`}
  else if(id==="page-search")submitPageSearch(form);
  else if(id==="registry-filter")submitRegistryFilter(form);
  else if(id==="horse-depth-form")submitHorseDepth(form);
  else if(id==="pedigree-path-form")await submitPedigreePath(form);
  else if(id==="people-search")submitPeopleSearch(form);
  else if(id==="relationship-form")submitRelationship(form);
  else if(id==="pedigree-open-form")submitPedigreeOpen(form);
  else if(id==="pairing-form")await submitPairing(form);
  else if(id==="optimizer-form")await submitOptimizer(form);
  else if(id==="market-inquiry-form")await submitMarketInquiry(form);
  else if(id==="login-form")await submitLogin(form);
  else if(id==="admin-open-horse")submitAdminOpenHorse(form);
 }catch(err){toast(err.message||String(err),"bad")}
});

document.getElementById("modal")?.addEventListener("click",e=>{if(e.target.id==="modal")closeModal()});
const preferenceDialog=document.getElementById("preferences-drawer");
preferenceDialog?.addEventListener("click",e=>{if(e.target===preferenceDialog)closePreferences()});
preferenceDialog?.addEventListener("cancel",e=>{e.preventDefault();closePreferences()});

function renderChrome(){document.getElementById("workspace")?.setAttribute("aria-label",L3("Classic registry content","\u0645\u062d\u062a\u0648\u0627\u06cc \u062f\u0641\u062a\u0631 \u062b\u0628\u062a \u06a9\u0644\u0627\u0633\u06cc\u06a9"));restoreContextNavigation();app.dataset.navigationLayout=navigationLayout;app.dataset.navigationOpen=String(navigationOpen);document.getElementById("workspace")?.setAttribute("data-route",navActive());renderHeader();renderNav();renderFooter();attachContextNavigation();const skip=document.querySelector(".skip-link");if(skip)skip.textContent=L3("Skip to content","\u067e\u0631\u0634 \u0628\u0647 \u0645\u062d\u062a\u0648\u0627");document.getElementById("primary-nav").setAttribute("aria-label",L3("Primary navigation","\u067e\u06cc\u0645\u0627\u06cc\u0634 \u0627\u0635\u0644\u06cc"));document.title=`${titleForRoute()} · ${t("app")}`}
function renderHeader(){
 const u=state.auth.user;const q=state.route.name==="search"?(state.route.query.get("q")||""):"";
 document.getElementById("site-header").innerHTML=`<div class="masthead"><a class="brand" href="#/home"><span class="brand-mark" aria-hidden="true">R</span><span class="brand-copy"><strong>${esc(t("app"))}</strong><span>${esc(t("subtitle"))}</span></span></a><form id="global-search" class="global-search" role="search"><label class="sr-only" for="global-q">${esc(t("search"))}</label><input id="global-q" name="q" value="${attr(q)}" placeholder="${attr(t("searchHint"))}" autocomplete="off"><button type="submit">${esc(t("search"))}</button></form><div class="header-tools"><label class="classic-layout-select"><span class="sr-only">${esc(NAVIGATION_LABELS.layout[state.locale])}</span><select id="classic-navigation-layout" aria-label="${attr(NAVIGATION_LABELS.layout[state.locale])}"><option value="tabs" ${navigationLayout==="tabs"?"selected":""}>${esc(NAVIGATION_LABELS.tabs[state.locale])}</option><option value="sidebar" ${navigationLayout==="sidebar"?"selected":""}>${esc(NAVIGATION_LABELS.sidebar[state.locale])}</option></select></label><button class="header-tool theme-tool" data-action="open-preferences" aria-haspopup="dialog" aria-expanded="false" aria-controls="preferences-drawer"><span class="theme-tool-icon" aria-hidden="true"></span>${esc(t("customize"))}</button><button class="header-tool" data-action="toggle-language">${esc(t("language"))}</button><a class="header-tool user-chip" href="#/account">${esc(u?.display_name||t("publicMode"))}</a></div></div>`;
}
function renderNav(){
 const nav=document.getElementById("primary-nav");
 if(navigationLayout==="sidebar"){
  nav.innerHTML=`<button class="classic-sidebar-toggle" data-action="toggle-navigation" aria-expanded="${navigationOpen}" aria-controls="classic-sidebar-body"><span>${esc(NAVIGATION_LABELS.sections[state.locale])}</span><span aria-hidden="true">⌄</span></button><div id="classic-sidebar-body"><div class="classic-sidebar-search"><label for="classic-navigation-search">${esc(NAVIGATION_LABELS.search[state.locale])}</label><div class="classic-search-controls"><input id="classic-navigation-search" type="search" maxlength="120" value="${attr(navigationQuery)}"><button type="button" data-action="clear-navigation-search" aria-label="${attr(NAVIGATION_LABELS.clearSearch[state.locale])}" ${navigationQuery?"":"disabled"}><span aria-hidden="true">&#215;</span></button></div></div><div id="classic-context-navigation"></div><div id="classic-sidebar-groups"></div><button class="classic-sidebar-close" data-action="close-navigation">${esc(L3("Close sections","\u0628\u0633\u062a\u0646 \u0641\u0647\u0631\u0633\u062a"))}</button></div>`;
  renderSidebarGroups();return;
 }
 const groups=currentNavigationGroups();
 const all=groups.flatMap(group=>group.links);
 const fit=fittedTabIndices||all.map((_,index)=>index);
 const overflowed=all.filter((_,index)=>!fit.includes(index));
 const shown=all.filter((_,index)=>fit.includes(index));
 const shownIds=new Set(shown.map(link=>link.id));
 const overflowGroups=groups.map(group=>({...group,links:group.links.filter(link=>!shownIds.has(link.id))})).filter(group=>group.links.length);
 const current=overflowGroups.flatMap(group=>group.links).find(link=>link.active);
 nav.innerHTML=`<div class="nav-inner"><div class="nav-measure" aria-hidden="true">${all.map(link=>`<span${link.active?' data-active="true"':""}>${esc(link.label[state.locale])}</span>`).join("")}</div>${shown.map(link=>`<a class="nav-link" data-nav="${attr(link.id)}" href="${attr(link.href)}" ${link.active?'aria-current="page"':""}>${esc(link.label[state.locale])}</a>`).join("")}${overflowGroups.length>0?`<details class="classic-nav-more"><summary class="${current?'is-current':''}"><span>${esc(L3("More","\u0628\u06cc\u0634\u062a\u0631"))}</span>${overflowed.length>0?`<span class="classic-more-count" aria-hidden="true">${overflowed.length}</span>`:""}<span aria-hidden="true">⌄</span></summary><div class="classic-nav-more-panel">${navigationGroupsMarkup(overflowGroups)}<button class="classic-nav-close" data-action="close-navigation-more">${esc(L3("Close sections","\u0628\u0633\u062a\u0646 \u0641\u0647\u0631\u0633\u062a"))}</button></div></details>`:""}</div>`;
 requestAnimationFrame(fitPrimaryTabs);
}
function renderFooter(){const p=state.platform;document.getElementById("site-footer").innerHTML=`<span>${esc(t("app"))} · ${esc(L3("Horse records and pedigrees","\u0633\u0648\u0627\u0628\u0642 \u0648 \u062a\u0628\u0627\u0631 \u0627\u0633\u0628\u200c\u0647\u0627"))}</span><span>${p?.health?.ok?`● ${esc(t("live"))}`:`○ ${esc(t("unavailable"))}`} · ${num(p?.stats?.horses||0)} ${esc(t("horses"))}</span>`}
function compact(n){return new Intl.NumberFormat(L3("en-US","fa-IR"),{notation:"compact",maximumFractionDigits:1}).format(n)}
function navActive(){const n=state.route.name;if(["horse","search"].includes(n))return "registry";if(n==="person")return "people";if(n==="post")return "content";return n}
function titleForRoute(){const m={directory:L3("Professional directory","\u0641\u0647\u0631\u0633\u062a \u0645\u062a\u062e\u0635\u0635\u0627\u0646"),services:L3("Service requests","\u062f\u0631\u062e\u0648\u0627\u0633\u062a\u200c\u0647\u0627\u06cc \u062e\u062f\u0645\u062a"),home:t("home"),registry:t("registry"),search:t("search"),horse:t("horseProfile"),people:t("people"),person:t("profile"),pedigree:t("pedigree"),breeding:t("breeding"),market:t("marketplace"),analytics:t("analytics"),content:t("content"),post:t("content"),account:t("account"),admin:t("admin")};return m[state.route.name]||t("app")}
async function renderRoute(){
 const target=freshWorkspace();
 target.setAttribute("aria-busy","true");
 try{
  const n=state.route.name;
  if(n==="home")await renderHome(target);
  else if(n==="registry")await renderRegistry(target);
  else if(n==="search")await renderSearch(target);
  else if(n==="horse")await renderHorse(target);
  else if(n==="people")await renderPeople(target);
  else if(n==="person")await renderPerson(target);
  else if(n==="directory")await renderDirectory(target);
  else if(n==="services")await renderServices(target);
  else if(n==="pedigree")await renderPedigree(target);
  else if(n==="breeding")await renderBreeding(target);
  else if(n==="market")await renderMarket(target);
  else if(n==="analytics")await renderAnalytics(target);
  else if(n==="content")await renderContent(target);
  else if(n==="post")await renderPost(target);
  else if(n==="account")await renderAccount(target);
  else if(n==="admin")await renderAdmin(target);
  else target.innerHTML=`<div class="empty"><strong>${esc(t("notFound"))}</strong><a class="btn mt-3" href="#/home">${esc(t("backHome"))}</a></div>`;
 }catch(err){target.innerHTML=errorBox(err,"reload-route")}finally{
  if(target===root){attachContextNavigation();target.setAttribute("aria-busy","false")}
 }
 return target===root;
}

function clearNavigationSearch(){
 navigationQuery="";const input=document.getElementById("classic-navigation-search");
 if(input){input.value="";input.focus()}renderSidebarGroups();
}
document.getElementById("primary-nav")?.addEventListener("keydown",event=>{
 if(event.key!=="Escape"||event.defaultPrevented||navigationLayout!=="sidebar")return;
 if(navigationQuery){event.preventDefault();event.stopPropagation();clearNavigationSearch();return}
 const toggle=document.querySelector(".classic-sidebar-toggle");
 if(navigationOpen&&toggle?.getClientRects().length){event.preventDefault();event.stopPropagation();navigationOpen=false;app.dataset.navigationOpen="false";toggle.setAttribute("aria-expanded","false");toggle.focus()}
});
function currentNavigationGroups(){
 const current=state.route.name==="horse"?"#/registry":state.route.name==="person"?"#/people":state.route.name==="post"?"#/content":location.hash||"#/home";
 const groups=navigationGroups("classic-registry",current,state.locale);
 if(["editor","admin","super_admin"].includes(state.auth.user?.role))groups.find(group=>group.id==="governance")?.links.push({id:"admin",label:{en:t("admin"),fa:t("admin")},href:"#/admin",active:state.route.name==="admin",external:false});
 return groups;
}
function navigationGroupsMarkup(groups,query=""){
 return groups.map((group,index)=>`<details class="classic-nav-group" data-group="${attr(group.id)}" ${query||group.links.some(link=>link.active)||index===0?'open':''}><summary>${esc(group.label[state.locale])} <span class="nav-group-count" aria-hidden="true">${group.links.length}</span></summary><ul>${group.links.map(link=>`<li><a href="${attr(link.href)}" ${!link.href.startsWith("#")?'target="_top"':""} ${link.active?'aria-current="page"':""}>${esc(link.label[state.locale])}${link.external?' <span aria-hidden="true">↗</span>':""}</a></li>`).join("")}</ul></details>`).join("")||`<p role="status">${esc(NAVIGATION_LABELS.empty[state.locale])}</p>`;
}
/* R116: measure the hidden twin row against the real nav width and re-render
 only when the fitted count actually changes (converges in one pass; the More
 reserve keeps the fold stable once applied). Zero-width rows (hidden mounts)
 keep every destination visible. */
function fitPrimaryTabs(){
 if(navigationLayout!=="tabs")return;
 const nav=document.getElementById("primary-nav");
 const inner=nav?.querySelector(".nav-inner");
 const row=nav?.querySelector(".nav-measure");
 if(!nav||!inner||!row)return;
 const cs=getComputedStyle(inner);
 const available=inner.clientWidth-parseFloat(cs.paddingInlineStart||cs.paddingLeft||"0")-parseFloat(cs.paddingInlineEnd||cs.paddingRight||"0");
 const all=currentNavigationGroups().flatMap(group=>group.links);
 const widths=Array.from(row.children,tab=>tab.getBoundingClientRect().width);
 const more=nav.querySelector(".classic-nav-more");
 const next=fitNavigationTabs(widths,available,more?.getBoundingClientRect().width||96,parseFloat(cs.columnGap)||0,all.findIndex(link=>link.active));
 if(!fittedTabIndices||next.length!==fittedTabIndices.length||next.some((value,i)=>value!==fittedTabIndices[i])){
  const open=!!more?.open;
  const focused=document.activeElement;
  const focusedId=focused?.getAttribute("data-nav");
  const focusMore=!!more?.contains(focused);
  fittedTabIndices=next;renderNav();
  const updated=nav.querySelector(".classic-nav-more");if(open&&updated)updated.open=true;
  if(focusedId){
   let target=nav.querySelector(`[data-nav="${CSS.escape(focusedId)}"]`);
   if(!target){
    const href=all.find(link=>link.id===focusedId)?.href;
    const overflow=nav.querySelector("details.classic-nav-more");
    if(overflow&&href){overflow.open=true;target=overflow.querySelector(`a[href="${CSS.escape(href)}"]`);}
   }
   (target||nav.querySelector(".classic-nav-more summary"))?.focus({preventScroll:true});
  }
  else if(focusMore)updated?.querySelector("summary")?.focus();
 }
}
function renderSidebarGroups(){
 const clear=document.querySelector('[data-action="clear-navigation-search"]');if(clear)clear.disabled=!navigationQuery;
 const target=document.getElementById("classic-sidebar-groups");if(!target)return;
 target.innerHTML=navigationGroupsMarkup(filterNavigation(currentNavigationGroups(),navigationQuery),navigationQuery);
}
function setNavigationOpen(open,restoreFocus=false){
 navigationOpen=open;app.dataset.navigationOpen=String(open);
 const toggle=document.querySelector(".classic-sidebar-toggle");toggle?.setAttribute("aria-expanded",String(open));
 if(restoreFocus)toggle?.focus();
}
function closeNavigationMore(restoreFocus=false){
 const more=document.querySelector(".classic-nav-more");if(!more?.open)return;more.open=false;
 if(restoreFocus)more.querySelector("summary")?.focus();
}
document.addEventListener("pointerdown",event=>{if(!event.target.closest("#primary-nav")){closeNavigationMore();if(navigationOpen)setNavigationOpen(false)}});
document.getElementById("primary-nav")?.addEventListener("keydown",event=>{if(event.key==="Escape"&&document.querySelector(".classic-nav-more[open]")){event.preventDefault();event.stopPropagation();closeNavigationMore(true)}});

function attachContextNavigation(){
 if(navigationLayout!=="sidebar"||!matchMedia("(min-width:861px)").matches)return;
 const slot=document.getElementById("classic-context-navigation");
 if(!slot)return;
 slot.replaceChildren();
 // Native DOM controls retain their delegated events; no duplicate state or links.
 const focused=document.activeElement;
 for(const controls of root.querySelectorAll("[data-context-navigation]")){const marker=document.createComment("classic-context-position");controls.before(marker);contextLocations.set(controls,marker);slot.append(controls);}
 if(focused?.isConnected&&focused!==document.activeElement)focused.focus({preventScroll:true});
}

function restoreContextNavigation(){
 const focused=document.activeElement;
 for(const [controls,marker] of contextLocations){if(marker.isConnected)marker.replaceWith(controls);}
 if(focused?.isConnected&&focused!==document.activeElement)focused.focus({preventScroll:true});
 contextLocations.clear();
}

async function changeLocale(locale){
 const drafts=captureFormState(root);
 const route=location.hash, authority=state.auth;
 const top=window.scrollY;
 setLocale(locale);renderChrome();renderPreferences();refreshHorseRequestPresentation();
 if(await renderRoute() && route===location.hash && authority===state.auth){
  if(!["directory","services"].includes(state.route.name)) restoreFormState(root,drafts);
  else {
   // Native controllers own these values, including accepted draft clearing.
   // Restore only the focused control and caret, never an obsolete field value.
   const focused=drafts.find(field=>field.focused);
   const form=focused&&document.getElementById(focused.form);
   const control=form&&[...form.elements].find(field=>(field.name||field.id)===focused.key);
   if(control&&!control.disabled){control.focus({preventScroll:true});if(typeof focused.start==="number"&&control.setSelectionRange){try{control.setSelectionRange(focused.start,focused.end)}catch{}}}
  }
  window.scrollTo({top,behavior:"instant"});
 }
}

matchMedia("(min-width:861px)").addEventListener("change",()=>{restoreContextNavigation();attachContextNavigation();setNavigationOpen(false)});
