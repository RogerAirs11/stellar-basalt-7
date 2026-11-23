import { localizeDomainValue } from "../presentationState.js";
import { api,state,t,fa,esc,attr,num,pageHead,panel,badge,loading,errorBox,primaryName,lifecycleBadge,L3 } from "../core.js";

export async function renderSearch(root){
  const q=state.route.query.get("q")||"";
  root.innerHTML=`${pageHead(t("search"),L3("Fast indexed search across names, parents, people, breed, place and other searchable fields.","\u062c\u0633\u062a\u200c\u0648\u062c\u0648\u06cc \u0633\u0631\u06cc\u0639 \u062f\u0631 \u0646\u0627\u0645\u060c \u0648\u0627\u0644\u062f\u06cc\u0646\u060c \u0627\u0634\u062e\u0627\u0635\u060c \u0646\u0698\u0627\u062f\u060c \u0645\u062d\u0644 \u0648 \u0633\u0627\u06cc\u0631 \u0641\u06cc\u0644\u062f\u0647\u0627\u06cc \u0646\u0645\u0627\u06cc\u0647\u200c\u0634\u062f\u0647."))}<form id="page-search" class="search-strip"><input class="control" name="q" value="${attr(q)}" placeholder="${attr(t("searchHint"))}" autofocus><button class="btn btn-primary">${esc(t("search"))}</button><a class="btn" href="#/registry${q?`?filter=${encodeURIComponent(q)}`:""}">${esc(t("registry"))}</a></form><div id="search-results">${q?loading():panel(t("search"),`<div class="empty">${esc(L3("Enter a search query.","\u0639\u0628\u0627\u0631\u062a \u062c\u0633\u062a\u200c\u0648\u062c\u0648 \u0631\u0627 \u0648\u0627\u0631\u062f \u06a9\u0646\u06cc\u062f."))}</div>`)}</div><div id="search-help" class="mt-4"></div>`;
  await Promise.all([q?load(q):Promise.resolve(),loadHelp()]);
}

async function load(q){
  const slot=document.getElementById("search-results");
  if(!slot)return;
  try{
    const d=await api(`/api/search?q=${encodeURIComponent(q)}&limit=50`);
    const rows=d.results||[];
    const body=rows.length
      ? `<div class="data-wrap"><table class="data-table"><thead><tr><th>${esc(t("id"))}</th><th>${esc(t("name"))}</th><th>${esc(t("year"))}</th><th>${esc(t("breed"))}</th><th>${esc(t("sex"))}</th><th>${esc(t("place"))}</th><th>${esc(t("status"))}</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="mono">#${r.id}</td><td class="primary-cell"><a href="#/horse/${r.id}">${esc(primaryName(r))}</a>${r.matched_by?.length?`<div class="cluster mt-1">${r.matched_by.slice(0,4).map(x=>badge(x,"info")).join(" ")}</div>`:""}</td><td>${num(r.birth_year)}</td><td>${esc(r.breed_desc||"—")}</td><td>${esc(localizeDomainValue(r.sex_desc,state.locale))}</td><td>${esc(r.birth_place_desc||"—")}</td><td>${lifecycleBadge(r)}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><strong>${esc(t("noResults"))}</strong><div>${esc(t("noResultsHelp"))}</div></div>`;
    slot.innerHTML=panel(`${t("search")} · ${num(rows.length)}`,body);
  }catch(e){
    slot.innerHTML=errorBox(e);
  }
}

export function submitPageSearch(form){
  const q=String(new FormData(form).get("q")||"").trim();
  location.hash=`#/search${q?`?q=${encodeURIComponent(q)}`:""}`;
}

async function loadHelp(){
  const slot=document.getElementById("search-help");
  if(!slot)return;
  try{
    const m=await api("/api/search/meta");
    const fields=(m.fields||[]).map(f=>`<span class="badge"><strong>${esc(f.key)}</strong>${f.aliases?.length?` · ${esc(f.aliases.join(", "))}`:""}</span>`).join(" ");
    const registry=m.registryFieldSearch||{};
    const registryFields=(registry.fields||[]).map(f=>`<div class="search-contract-field"><strong>${esc(f.key)}</strong><code>${esc(f.queryParam||"")}</code><span>${esc(f.type||"")}</span></div>`).join("");
    slot.innerHTML=`<details class="panel"><summary class="panel-head" style="cursor:pointer"><strong class="panel-title">${esc(L3("Structured search syntax","\u0631\u0627\u0647\u0646\u0645\u0627\u06cc \u062c\u0633\u062a\u200c\u0648\u062c\u0648\u06cc \u0633\u0627\u062e\u062a\u0627\u0631\u06cc\u0627\u0641\u062a\u0647"))}</strong><span class="faint">v${esc(m.syntaxVersion||"—")}</span></summary><div class="panel-body"><div class="platform-contract-grid"><div class="platform-contract-item"><span>${esc(L3("Maximum length","\u062d\u062f\u0627\u06a9\u062b\u0631 \u0637\u0648\u0644"))}</span><strong>${num(m.maxQueryLength||0)}</strong></div><div class="platform-contract-item"><span>${esc(L3("Registry field version","\u0646\u0633\u062e\u0647 \u0641\u06cc\u0644\u062a\u0631 \u0633\u0627\u0645\u0627\u0646\u0647 \u062b\u0628\u062a"))}</span><strong>${esc(registry.version||"—")}</strong></div><div class="platform-contract-item"><span>${esc(L3("Combinator","\u062a\u0631\u06a9\u06cc\u0628\u200c\u06af\u0631"))}</span><strong>${esc(String(registry.combinator||"—").toUpperCase())}</strong></div></div><h3 class="section-title mt-3">${esc(L3("Text-search keys","\u06a9\u0644\u06cc\u062f\u0647\u0627\u06cc \u062c\u0633\u062a\u200c\u0648\u062c\u0648\u06cc \u0645\u062a\u0646\u06cc"))}</h3><div class="cluster">${fields}</div>${registryFields?`<h3 class="section-title mt-3">${esc(L3("Registry browse fields","\u0641\u06cc\u0644\u062f\u0647\u0627\u06cc \u0645\u0631\u0648\u0631 \u0633\u0627\u0645\u0627\u0646\u0647 \u062b\u0628\u062a"))}</h3><div class="search-contract-map">${registryFields}</div>`:""}<div class="notice mt-3">${esc(L3("Example: sire:Azadi breed:Arabian owner:Rahimi \u2014 multiple fields are combined with AND semantics.","\u0646\u0645\u0648\u0646\u0647: sire:Azadi breed:Arabian owner:Rahimi \u2014 \u0641\u06cc\u0644\u062f\u0647\u0627\u06cc \u0645\u062a\u0639\u062f\u062f \u0628\u0627 AND \u062a\u0631\u06a9\u06cc\u0628 \u0645\u06cc\u200c\u0634\u0648\u0646\u062f."))}</div></div></details>`;
  }catch{
    slot.innerHTML="";
  }
}
