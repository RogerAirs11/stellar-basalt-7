import { api,state,t,fa,esc,attr,domainValue,num,pageHead,panel,badge,loading,errorBox,horseLink,lifecycleBadge,horseFlags,toQuery,toast,L3 } from "../core.js";

export async function renderRegistry(root) {
  root.innerHTML = loading();
  try {
    if (!state.facets) state.facets = await api("/api/registry/facets");
    const q = new URLSearchParams(state.route.query);
    if (!q.has("limit")) q.set("limit","50");
    const data = await api(`/api/horses?${q}`);
    root.innerHTML = `${pageHead(t("registry"), t("registryIntro"), `${state.auth.permissions.includes("registry.export")?`<button class="btn" data-action="registry-export">${esc(t("export"))}</button>`:""}`)}
      ${state.facets?.snapshotStale?`<div class="notice warn">${esc(L3("Derived facet snapshot is stale; the platform is serving an exact live fallback for authoritative results.","\u0646\u0645\u0627\u06cc \u0641\u0633\u062a\u200c\u0647\u0627\u06cc \u0645\u0634\u062a\u0642\u200c\u0634\u062f\u0647 \u0642\u062f\u06cc\u0645\u06cc \u0627\u0633\u062a\u061b \u067e\u0644\u062a\u0641\u0631\u0645 \u0628\u0631\u0627\u06cc \u0646\u062a\u0627\u06cc\u062c \u062f\u0642\u06cc\u0642 \u0627\u0632 \u062c\u0627\u06cc\u06af\u0632\u06cc\u0646 \u0632\u0646\u062f\u0647 \u0627\u0633\u062a\u0641\u0627\u062f\u0647 \u0645\u06cc\u200c\u06a9\u0646\u062f."))}</div>`:""}
      ${filterPanel(q)}
      <div class="mt-3">${registryResults(data)}</div>`;
  } catch(err){ root.innerHTML = errorBox(err,"reload-route"); }
}

export function registryActions(action, el) {
  if(action === "registry-reset") { location.hash="#/registry"; }
  if(action === "registry-export") {
    const q=new URLSearchParams(state.route.query); q.delete("offset"); q.set("limit", String(Math.min(Number(q.get("limit")||50), state.platform?.limits?.registryExportRowsMax||500)));
    window.location.href=`/api/registry/export?${q}`;
  }
}

function filterPanel(q){
 const F=state.facets||{};
 const boolOptions=[["",t("all")],["1",L3("Yes","\u0628\u0644\u0647")],["0",L3("No","\u062e\u06cc\u0631")]];
 const ignored=new Set(["limit","offset","sort","dir"]);
 const activeFilters=[...q.entries()].filter(([key,value])=>value&&!ignored.has(key));
 return `<details class="panel panel-flat registry-filters" ${activeFilters.length?"open":""}><summary class="panel-head registry-filters-summary"><div><h2 class="panel-title">${esc(t("filters"))}</h2>${activeFilters.length?`<span class="registry-filter-count">${num(activeFilters.length)}</span>`:""}</div><span class="registry-filter-chevron" aria-hidden="true"></span></summary><div class="panel-body"><div class="registry-filter-actions"><span class="faint">${esc(L3("Select the bar above to expand or collapse filters.","\u0628\u0631\u0627\u06cc \u0628\u0627\u0632/\u0628\u0633\u062a\u0647 \u06a9\u0631\u062f\u0646\u060c \u0646\u0648\u0627\u0631 \u0628\u0627\u0644\u0627 \u0631\u0627 \u0627\u0646\u062a\u062e\u0627\u0628 \u06a9\u0646\u06cc\u062f."))}</span><button class="btn btn-small" type="button" data-action="registry-reset">${esc(t("reset"))}</button></div>
 <form id="registry-filter" class="form-grid">
  ${input("filter",L3("General search","\u062c\u0633\u062a\u200c\u0648\u062c\u0648\u06cc \u0639\u0645\u0648\u0645\u06cc"),q.get("filter")||q.get("q")||"",`placeholder="${attr(t("searchHint"))}"`)}
  ${input("name",t("name"),q.get("name")||"")}
  ${input("id",t("id"),q.get("id")||"",`inputmode="numeric"`)}
  ${input("register",t("registerNo"),q.get("register")||"")}
  ${sel("breed",t("breed"),F.breeds,q.get("breed"))}
  ${sel("sex",t("sex"),F.sexes,q.get("sex"))}
  ${sel("color",t("color"),F.colors,q.get("color"))}
  ${sel("mainStrain",t("strain"),F.mainStrains,q.get("mainStrain"))}
  ${input("place",t("place"),q.get("place")||"")}
  ${sel("importedFrom",L3("Imported from","\u0645\u0628\u062f\u0623 \u0648\u0627\u0631\u062f\u0627\u062a"),F.importedFrom,q.get("importedFrom"))}
  ${input("owner",t("owner"),q.get("owner")||"")}
  ${input("ownerId",L3("Owner ID","\u0634\u0646\u0627\u0633\u0647 \u0645\u0627\u0644\u06a9"),q.get("ownerId")||"",`inputmode="numeric"`)}
  ${input("breeder",t("breeder"),q.get("breeder")||"")}
  ${input("breederId",L3("Breeder ID","\u0634\u0646\u0627\u0633\u0647 \u067e\u0631\u0648\u0631\u0634\u200c\u062f\u0647\u0646\u062f\u0647"),q.get("breederId")||"",`inputmode="numeric"`)}
  ${input("importer",L3("Importer","\u0648\u0627\u0631\u062f\u06a9\u0646\u0646\u062f\u0647"),q.get("importer")||"")}
  ${input("passportReceiver",L3("Passport receiver","\u06af\u06cc\u0631\u0646\u062f\u0647 \u06af\u0630\u0631\u0646\u0627\u0645\u0647"),q.get("passportReceiver")||"")}
  ${input("sire",t("sire"),q.get("sire")||"")}
  ${input("dam",t("dam"),q.get("dam")||"")}
  ${selectSimple("lifecycle",t("status"),[["",t("all")],["active",t("active")],["inactive",t("inactive")],["deceased",t("deceased")]],q.get("lifecycle")||q.get("status"))}
  ${input("yearFrom",t("fromYear"),q.get("yearFrom")||"",`type="number" min="1500" max="2200"`)}
  ${input("yearTo",t("toYear"),q.get("yearTo")||"",`type="number" min="1500" max="2200"`)}
  ${selectSimple("hasSire",L3("Has sire","\u067e\u062f\u0631 \u062b\u0628\u062a\u200c\u0634\u062f\u0647"),boolOptions,q.get("hasSire"))}
  ${selectSimple("hasDam",L3("Has dam","\u0645\u0627\u062f\u0631 \u062b\u0628\u062a\u200c\u0634\u062f\u0647"),boolOptions,q.get("hasDam"))}
  ${selectSimple("isImported",t("imported"),boolOptions,q.get("isImported"))}
  ${selectSimple("isSport",t("sport"),boolOptions,q.get("isSport"))}
  ${selectSimple("isStallion",t("stallion"),boolOptions,q.get("isStallion"))}
  ${selectSimple("hasSportCard",t("sportCard"),boolOptions,q.get("hasSportCard"))}
  ${selectSimple("sort",t("sort"),[["id",t("id")],["name",t("name")],["year",t("year")],["breed",t("breed")],["sex",t("sex")],["place",t("place")]],q.get("sort")||"id")}
  ${selectSimple("dir",t("direction"),[["asc",t("ascending")],["desc",t("descending")]],q.get("dir")||"asc")}
  <input type="hidden" name="limit" value="${attr(q.get("limit")||"50")}">
  <div class="field span-2"><span class="field-label">&nbsp;</span><button class="btn btn-primary" type="submit">${esc(t("apply"))}</button></div>
 </form></div></details>`;
}

function registryResults(d){
 const rows=d.rows||[];
 if(!rows.length) return `<section class="panel">${`<div class="panel-body"><div class="empty"><strong>${esc(t("noResults"))}</strong><div>${esc(t("noResultsHelp"))}</div></div></div>`}</section>`;
 const desktop=`<div class="data-wrap responsive-table"><table class="data-table"><thead><tr><th>${esc(t("id"))}</th><th>${esc(t("name"))}</th><th>${esc(t("year"))}</th><th>${esc(t("breed"))}</th><th>${esc(t("sex"))}</th><th>${esc(t("color"))}</th><th>${esc(t("sire"))}</th><th>${esc(t("dam"))}</th><th>${esc(t("owner"))}</th><th>${esc(t("status"))}</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="mono">#${num(r.id)}</td><td class="primary-cell">${horseLink(r)}${r.name_native&&r.name_latin!==r.name_native?`<div class="faint">${esc(r.name_native)}</div>`:""}</td><td>${num(r.birth_year)}</td><td>${esc(domainValue(r.breed_desc))}</td><td>${esc(domainValue(r.sex_desc))}</td><td>${esc(domainValue(r.color_desc))}</td><td>${r.father_id?`<a href="#/horse/${r.father_id}">${esc(r.father_name||`#${r.father_id}`)}</a>`:"—"}</td><td>${r.mother_id?`<a href="#/horse/${r.mother_id}">${esc(r.mother_name||`#${r.mother_id}`)}</a>`:"—"}</td><td>${esc(r.owner_name||"—")}</td><td>${lifecycleBadge(r)}</td></tr>`).join("")}</tbody></table></div>`;
 const mobile=`<div class="mobile-list">${rows.map(r=>`<article class="record-card"><div class="record-top"><div><div class="record-name">${horseLink(r)}</div><div class="faint mono">#${esc(r.id)}${r.register_no?` · ${esc(r.register_no)}`:""}</div></div>${lifecycleBadge(r)}</div><div class="record-meta"><span>${esc(r.birth_year||"—")}</span><span>${esc(domainValue(r.breed_desc))}</span><span>${esc(domainValue(r.sex_desc))}</span><span>${esc(domainValue(r.color_desc))}</span></div><div class="cluster mt-2">${horseFlags(r)}</div></article>`).join("")}</div>`;
 return `<section class="panel"><header class="panel-head"><h2 class="panel-title">${esc(t("showing"))} ${num(d.offset+1)}–${num(Math.min(d.offset+d.limit,d.total))} ${esc(t("of"))} ${num(d.total)}</h2><span class="faint">${esc(d.sort)} · ${esc(d.dir)}</span></header><div class="panel-body" style="padding:0">${desktop}${mobile}</div>${pager(d)}</section>`;
}
function pager(d){const q=new URLSearchParams(state.route.query);q.set("limit",String(d.limit));const prev=d.previousOffset!==null?(()=>{const x=new URLSearchParams(q);x.set("offset",d.previousOffset);return `#/registry?${x}`})():"";const next=d.nextOffset!==null?(()=>{const x=new URLSearchParams(q);x.set("offset",d.nextOffset);return `#/registry?${x}`})():"";return `<footer class="table-footer"><span>${num(d.total)} ${esc(t("records"))}</span><div class="cluster">${prev?`<a class="btn btn-small" href="${attr(prev)}">${esc(t("previous"))}</a>`:""}${next?`<a class="btn btn-small" href="${attr(next)}">${esc(t("next"))}</a>`:""}</div></footer>`}
function input(name,label,value,extra=""){return `<div class="field"><label for="f-${attr(name)}">${esc(label)}</label><input id="f-${attr(name)}" name="${attr(name)}" value="${attr(value)}" ${extra}></div>`}
function sel(name,label,items=[],value=""){return selectSimple(name,label,[["",t("all")],...items.map(x=>[x.value,`${x.value} (${num(x.count)})`])],value)}
function selectSimple(name,label,items,value=""){return `<div class="field"><label for="f-${attr(name)}">${esc(label)}</label><select id="f-${attr(name)}" name="${attr(name)}">${items.map(([v,l])=>`<option value="${attr(v)}" ${String(v)===String(value||"")?"selected":""}>${esc(l)}</option>`).join("")}</select></div>`}
function check(name,label,on){return `<label class="check"><input type="checkbox" name="${attr(name)}" value="1" ${on?"checked":""}> ${esc(label)}</label>`}

export function submitRegistryFilter(form){const q=toQuery(form);q.delete("offset");location.hash=`#/registry?${q}`}
