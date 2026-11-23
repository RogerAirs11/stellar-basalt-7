import { contextNavigation } from '../contextNavigation.js';
import { mountHorseMedia } from "./media.js";
import { openHorseRequest, submitHorseRequest } from './horseRequests.js';
import { api,state,t,fa,esc,attr,domainValue,num,pct,date,pageHead,panel,badge,loading,errorBox,primaryName,secondaryName,lifecycleBadge,horseFlags,horseLink,kv,renderJson,modal,closeModal,toast,isEditor,isAdmin,L3 } from "../core.js";

let current = null;

export async function renderHorse(root) {
  const id = Number(state.route.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { root.innerHTML = errorBox(new Error("Invalid horse ID")); return; }
  root.innerHTML = loading();
  try {
    const data = await api(`/api/horses/${id}`);
    if (!root.isConnected) return;
    current = data;
    const h=current.horse;
    const tab=state.route.query.get("tab")||"overview";
    root.innerHTML = `${pageHead(primaryName(h), `${t("horseProfile")} · #${h.id}`, profileActions(h), `<a href="#/registry">${esc(t("registry"))}</a><span>${esc(primaryName(h))}</span>`)}
      ${profileHeader(h)}
      ${tabs(h.id,tab)}
      <div id="horse-tab">${loading()}</div>`;
    await renderTab(tab,h,current);
  } catch(err){ root.innerHTML=errorBox(err,"reload-route"); }
}

async function renderTab(tab,h,data){
  const slot=document.getElementById("horse-tab"); if(!slot)return;
  try{
    if(tab==="overview") slot.innerHTML=overview(h,data);
    else if(tab==="ancestors") slot.innerHTML=pedigreePanel(await api(`/api/horses/${h.id}/pedigree?depth=${boundedDepth("depth",3,1,8)}`),"ancestors");
    else if(tab==="descendants") { const depth=boundedDepth("depth",3,1,6); const [treeData,reach]=await Promise.all([api(`/api/horses/${h.id}/descendants?depth=${depth}&max=160`),api(`/api/horses/${h.id}/pedigree/descendant-metrics?depth=${Math.max(1,depth)}&max=1000`)]); slot.innerHTML=descendantView(treeData,reach); }
    else if(tab==="metrics") {
      const [m,c]=await Promise.all([api(`/api/horses/${h.id}/pedigree/metrics?depth=${boundedDepth("depth",6,1,8)}`),api(`/api/horses/${h.id}/pedigree/coefficients?depth=${boundedDepth("depth",8,1,8)}`)]);
      slot.innerHTML=metrics(m,c);
    } else if(tab==="insights") slot.innerHTML=insights(await api(`/api/horses/${h.id}/insights`));
    else if(tab==="records") {
      slot.innerHTML=`<div data-classic-media></div><div data-classic-records>${loading()}</div>`;
      mountHorseMedia(slot.querySelector('[data-classic-media]'),h.id);
      const records=await recordsView(h);
      if(slot.isConnected) slot.querySelector('[data-classic-records]').innerHTML=records;
    }
    else if(tab==="workflows") slot.innerHTML=workflows(h);
    else slot.innerHTML=overview(h,data);
  } catch(err){slot.innerHTML=errorBox(err,"reload-route")}
}

function profileHeader(h){
 return `<section class="panel panel-blue mb-0"><div class="panel-body"><div class="profile-title"><div class="profile-id">#${esc(h.id)}</div><div class="min-0"><h2 class="section-title mb-0">${esc(primaryName(h))}</h2>${secondaryName(h)?`<div class="native-name">${esc(secondaryName(h))}</div>`:""}<div class="profile-flags">${lifecycleBadge(h)} ${horseFlags(h)} ${h.breed_desc?badge(domainValue(h.breed_desc),"info"):""} ${h.sex_desc?badge(domainValue(h.sex_desc)):""}</div></div></div></div></section>`;
}
function tabs(id,active){const arr=[["overview",t("overview")],["ancestors",t("ancestors")],["descendants",t("descendants")],["metrics",t("metrics")],["insights",t("insights")],["records",t("recordsTab")],["workflows",t("workflows")]];return contextNavigation(t("horseProfile"),arr.map(([key,label])=>({id:key,label,href:`#/horse/${id}?tab=${key}`})),active)}
function profileActions(h){return `${isEditor()?`<button class="btn" data-action="horse-edit" data-id="${h.id}">${esc(t("editHorse"))}</button>`:""}${isAdmin()?`<button class="btn btn-danger" data-action="horse-archive" data-id="${h.id}">${esc(t("archiveHorse"))}</button>`:""}<a class="btn" href="#/pedigree?horse=${h.id}">${esc(t("pedigree"))}</a>`}
function overview(h,data){
 const people=data.people||[];
 return `<div class="grid grid-main"><div class="stack">
   ${panel(t("registryData"),kv([
     [t("id"),`<span class="mono">#${esc(h.id)}</span>`],[t("registerNo"),esc(h.register_no||"—")],[t("born"),esc(h.birth_date||h.birth_year||"—")],[t("place"),esc(h.birth_place_desc||"—")],[t("breed"),esc(domainValue(h.breed_desc))],[t("sex"),esc(domainValue(h.sex_desc))],[t("color"),esc(domainValue(h.color_desc))],[t("strain"),esc([h.main_strain_desc,h.sub_strain_desc].filter(Boolean).join(" / ")||"—")]
   ]))}
   ${panel(t("pedigreeData"),kv([
     [t("sire"),parentValue(h.father_id,h.father_name,h.father_name_native)],[t("dam"),parentValue(h.mother_id,h.mother_name,h.mother_name_native)],[L3("DNA","DNA"),esc(h.dna_status||h.dna_desc||"—")],[L3("Originality","\u0627\u0635\u0627\u0644\u062a"),esc(h.originality||"—")]
   ]))}
   ${panel(t("connections"),peopleTable(people))}
   ${completePublicLedger(h)}
 </div><aside class="stack" aria-label="${attr(L3("Horse reference information","\u0627\u0637\u0644\u0627\u0639\u0627\u062a \u062a\u06a9\u0645\u06cc\u0644\u06cc \u0627\u0633\u0628"))}">
   ${panel(t("identifiers"),kv([["UEL",esc(h.uel_no||"—")],[L3("Life no.","\u0634\u0645\u0627\u0631\u0647 \u0639\u0645\u0631"),esc(h.life_number||"—")],[L3("Company","\u06a9\u062f \u0634\u0631\u06a9\u062a"),esc(h.company_code||"—")],[L3("Horse SR","\u0634\u0645\u0627\u0631\u0647 \u0627\u0633\u0628"),esc(h.horse_sr_no||"—")],[L3("Studbook version","\u0646\u0633\u062e\u0647 \u06a9\u062a\u0627\u0628 \u062a\u0628\u0627\u0631\u0646\u0627\u0645\u0647"),esc(h.book_version||"—")]]))}
   ${panel(t("flags"),`<div class="stack"><div class="spread"><span>${esc(t("status"))}</span>${lifecycleBadge(h)}</div>${flagRow(L3("Imported","\u0648\u0627\u0631\u062f\u0627\u062a\u06cc"),h.is_imported)}${flagRow(L3("Sport horse","\u0648\u0631\u0632\u0634\u06cc"),h.is_sport)}${flagRow(L3("Sport registered","\u062b\u0628\u062a \u0648\u0631\u0632\u0634\u06cc"),h.is_register_sport)}${flagRow(L3("Sport card","\u06a9\u0627\u0631\u062a \u0648\u0631\u0632\u0634\u06cc"),h.has_sport_card)}${flagRow(L3("Stallion registry flag","\u0646\u0631\u06cc\u0627\u0646"),h.is_stallion)}${flagRow(L3("Stallion approved","\u0646\u0631\u06cc\u0627\u0646 \u062a\u0623\u06cc\u06cc\u062f\u0634\u062f\u0647"),h.allow_stallion)}${h.death_date?`<div class="spread"><span>${esc(L3("Death date","\u062a\u0627\u0631\u06cc\u062e \u062a\u0644\u0641"))}</span><strong>${esc(h.death_date)}</strong></div>`:""}</div>`)}
   ${h.is_imported||h.imported_from_desc||h.imported_from_code||h.import_register_no||h.export_certificate?panel(t("imported"),kv([[L3("From","\u0627\u0632"),esc(h.imported_from_desc||"—")],[L3("Origin code","\u06a9\u062f \u0645\u0628\u062f\u0623"),esc(h.imported_from_code||"—")],[t("date"),esc(h.imported_date||"—")],[t("registerNo"),esc(h.import_register_no||"—")],[L3("Export certificate","\u06af\u0648\u0627\u0647\u06cc \u0635\u0627\u062f\u0631\u0627\u062a"),esc(h.export_certificate||"—")]])):""}
   ${panel(L3("Passport & registry people","\u06af\u0630\u0631\u0646\u0627\u0645\u0647 \u0648 \u0627\u0634\u062e\u0627\u0635 \u062b\u0628\u062a\u200c\u0634\u062f\u0647"),kv([[L3("Passport date","\u062a\u0627\u0631\u06cc\u062e \u06af\u0630\u0631\u0646\u0627\u0645\u0647"),esc(h.passport_date||"—")],[L3("Passport delivery date","\u062a\u0627\u0631\u06cc\u062e \u062a\u062d\u0648\u06cc\u0644 \u06af\u0630\u0631\u0646\u0627\u0645\u0647"),esc(h.passport_deliver_date||"—")],[L3("Passport receiver","\u06af\u06cc\u0631\u0646\u062f\u0647 \u06af\u0630\u0631\u0646\u0627\u0645\u0647"),personSnapshot(h.passport_receiver_name,h.passport_receiver_name_native)],[L3("Owner","\u0645\u0627\u0644\u06a9"),personSnapshot(h.owner_name,h.owner_name_native)],[L3("Breeder","\u067e\u0631\u0648\u0631\u0634\u200c\u062f\u0647\u0646\u062f\u0647"),personSnapshot(h.breeder_name,h.breeder_name_native)],[L3("Importer","\u0648\u0627\u0631\u062f\u06a9\u0646\u0646\u062f\u0647"),personSnapshot(h.importer_name,h.importer_name_native)]]))}
   ${data.aliases?.length?panel(t("aliases"),data.aliases.map(a=>`<div class="spread"><span>${esc(a.alias)}</span><span class="faint">${esc(a.alias_type||"")}</span></div>`).join("")):""}
 </aside></div>`;
}

function parentValue(id,latin,native){
 if(!id)return "—";
 const primary=fa()?(native||latin||`#${id}`):(latin||native||`#${id}`);
 const secondary=fa()?latin:native;
 return `<a href="#/horse/${id}">${esc(primary)}</a>${secondary&&secondary!==primary?`<div class="faint" dir="auto">${esc(secondary)}</div>`:""}`;
}
function personSnapshot(latin,native){
 const primary=fa()?(native||latin):(latin||native); const secondary=fa()?latin:native;
 if(!primary)return "—";
 return `${esc(primary)}${secondary&&secondary!==primary?`<div class="faint" dir="auto">${esc(secondary)}</div>`:""}`;
}
function flagRow(label,value){return `<div class="spread"><span>${esc(label)}</span><strong>${Number(value)===1?"✓":Number(value)===0?"—":"?"}</strong></div>`}

const PUBLIC_LEDGER_GROUPS = [
  ["identity", [["register_no","Registry number","شماره سامانه ثبت"],["birth_year","Birth year","سال تولد"],["birth_date","Birth date","تاریخ تولد"],["breed_desc","Breed","نژاد"],["sex_desc","Sex","جنسیت"],["color_desc","Color","رنگ"]]],
  ["registry", [["company_code","Registry company code","کد شرکت سامانه ثبت"],["book_version","Studbook version","نسخه کتاب تبارنامه"],["originality","Originality","اصالت"],["breed_type","Breed type","نوع نژاد"],["sex_code","Sex code","کد جنسیت"],["color_code","Color code","کد رنگ"],["uel_no","UEL number","شماره UEL"],["life_number","Life number","شماره شناسایی مادام‌العمر"],["dna_status","DNA status","وضعیت DNA"],["dna_desc","DNA note","شرح DNA"],["passport_date","Passport date","تاریخ گذرنامه"],["passport_deliver_date","Passport delivery date","تاریخ تحویل گذرنامه"],["horse_sr_no","Registry serial","شماره سریال سامانه ثبت"],["source_created_at","Source record date","تاریخ ثبت در منبع"]]],
  ["origin", [["birth_place_desc","Birth place","محل تولد"],["birth_place_code","Birth place code","کد محل تولد"],["is_imported","Imported","وارداتی","bool"],["imported_date","Import date","تاریخ ورود"],["imported_from_desc","Imported from","مبدأ واردات"],["imported_from_code","Import origin code","کد مبدأ واردات"],["import_register_no","Import register number","شماره ثبت واردات"],["export_certificate","Export certificate","گواهی صادرات"]]],
  ["lineage", [["main_strain_desc","Main strain","تیره اصلی"],["main_strain_no","Main strain number","شماره تیره اصلی"],["sub_strain_desc","Sub strain","زیرتیره"],["sub_strain_no","Sub strain number","شماره زیرتیره"]]],
  ["status", [["is_active","Active","فعال","bool"],["is_dead","Deceased","تلف‌شده","bool"],["death_date","Death date","تاریخ تلف"],["is_stallion","Stallion registry flag","ثبت‌شده به‌عنوان نریان","bool"],["allow_stallion","Stallion approved","نریان تأییدشده","bool"],["is_sport","Sport horse","اسب ورزشی","bool"],["is_register_sport","Sport registered","ثبت‌شده به‌عنوان اسب ورزشی","bool"],["has_sport_card","Sport card","کارت ورزشی","bool"]]],
];
function completePublicLedger(h){
 const names={identity:L3("Identity","\u0647\u0648\u06cc\u062a"),registry:L3("Registry & identifiers","\u062b\u0628\u062a \u0648 \u0634\u0646\u0627\u0633\u0647\u200c\u0647\u0627"),origin:L3("Origin & import","\u0645\u0628\u062f\u0623 \u0648 \u0648\u0627\u0631\u062f\u0627\u062a"),lineage:L3("Strain & lineage","\u062a\u06cc\u0631\u0647 \u0648 \u062f\u0648\u062f\u0645\u0627\u0646"),status:L3("Status","\u0648\u0636\u0639\u06cc\u062a")};
 const groups=PUBLIC_LEDGER_GROUPS.map(([key,fields])=>`<section class="registry-ledger-group"><h4>${esc(names[key])}</h4>${kv(fields.map(([field,en,faLabel,kind])=>[fa()?faLabel:en,ledgerValue(h[field],kind)]))}</section>`).join("");
 return `<details class="panel registry-ledger"><summary class="panel-head"><strong class="panel-title">${esc(L3("Complete public registry record","\u0631\u06a9\u0648\u0631\u062f \u0639\u0645\u0648\u0645\u06cc \u06a9\u0627\u0645\u0644 \u0633\u0627\u0645\u0627\u0646\u0647 \u062b\u0628\u062a"))}</strong><span class="faint">${esc(L3("All public contract 2.13 horse fields","\u062a\u0645\u0627\u0645 \u0641\u06cc\u0644\u062f\u0647\u0627\u06cc \u0639\u0645\u0648\u0645\u06cc \u0642\u0631\u0627\u0631\u062f\u0627\u062f \u06f2\u066b\u06f1\u06f3"))}</span></summary><div class="panel-body registry-ledger-grid">${groups}</div></details>`;
}
function ledgerValue(value,kind){if(value===null||value===undefined||value==="")return "—";if(kind==="bool")return Number(value)===1?esc(L3("Yes","\u0628\u0644\u0647")):esc(L3("No","\u062e\u06cc\u0631"));return esc(value)}

function peopleTable(rows){if(!rows.length)return `<div class="empty">—</div>`;return `<div class="data-wrap"><table class="data-table" style="min-width:520px"><thead><tr><th>${esc(t("role"))}</th><th>${esc(t("name"))}</th><th>${esc(t("current"))}</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${esc(roleText(p.role))}</td><td><a href="#/person/${p.id}">${esc(fa()?(p.name_native||p.name_latin):(p.name_latin||p.name_native))}</a>${p.name_native&&p.name_latin?`<div class="faint">${esc(fa()?p.name_latin:p.name_native)}</div>`:""}</td><td>${Number(p.is_current)?badge(t("current"),"good"):"—"}</td></tr>`).join("")}</tbody></table></div>`}
function roleText(role){return ({owner:L3("Owner","\u0645\u0627\u0644\u06a9"),breeder:L3("Breeder","\u067e\u0631\u0648\u0631\u0634\u200c\u062f\u0647\u0646\u062f\u0647"),importer:L3("Importer","\u0648\u0627\u0631\u062f\u06a9\u0646\u0646\u062f\u0647"),passport_receiver:L3("Passport receiver","\u062f\u0631\u06cc\u0627\u0641\u062a\u200c\u06a9\u0646\u0646\u062f\u0647 \u06af\u0630\u0631\u0646\u0627\u0645\u0647")})[role]||role}

function pedigreePanel(data,kind){
 const depth=data.depth;
 const label=kind==="ancestors"?(L3("Vertical ancestor family tree","\u062f\u0631\u062e\u062a \u0639\u0645\u0648\u062f\u06cc \u0646\u06cc\u0627\u06a9\u0627\u0646")):(L3("Vertical descendant family tree","\u062f\u0631\u062e\u062a \u0639\u0645\u0648\u062f\u06cc \u0646\u0648\u0627\u062f\u06af\u0627\u0646"));
 return `<div class="spread mb-0 pedigree-toolbar"><div><strong>${esc(label)}</strong><div class="muted">${esc(t("depth"))}: ${num(depth)}${data.truncated?` · ${badge(L3("Truncated","\u06a9\u0648\u062a\u0627\u0647\u200c\u0634\u062f\u0647"),"warn")}`:""}</div></div><form class="cluster" id="horse-depth-form"><input type="hidden" name="tab" value="${attr(kind)}"><label class="field-label" for="horse-depth">${esc(t("depth"))}</label><input class="control" id="horse-depth" name="depth" type="number" min="1" max="${kind==="ancestors"?8:6}" value="${depth}" style="width:70px"><button class="btn btn-small">${esc(t("load"))}</button></form></div><div class="family-tree-scroll mt-3"><div class="family-tree" data-family-kind="${attr(kind)}">${familyTree(data.tree,kind)}</div></div>`;
}
function familyTree(node,kind,level=0){
 if(!node)return `<div class="empty">—</div>`;
 const h=node.horse||node;
 const children=kind==="ancestors"?(node.parents||[]):(node.children||[]);
 const relation=node.relation|| (level===0?"self":"offspring");
 const relationLabel=relation==="father"?t("sire"):relation==="mother"?t("dam"):relation==="offspring"?(L3("Offspring","\u0641\u0631\u0632\u0646\u062f")):(L3("Subject","\u0627\u0633\u0628 \u0627\u0635\u0644\u06cc"));
 const relationClass=relation==="father"?"sire":relation==="mother"?"dam":relation==="offspring"?"offspring":"subject";
 const childMarkup=children.map(c=>familyTree(c,kind,level+1)).join("");
 return `<div class="family-branch family-level-${Math.min(level,8)} family-branch-${relationClass}" data-relation="${attr(relationClass)}"><article class="family-node family-${relationClass}"><div class="family-node-top"><span class="family-role">${esc(relationLabel)}</span><span class="family-generation">${esc(fa()?`نسل ${level}`:`G${level}`)}</span></div><div class="family-name">${h.id?`<a href="#/horse/${h.id}">${esc(primaryName(h))}</a>`:esc(primaryName(h))}</div><div class="family-meta"><span class="mono">#${esc(h.id??"—")}</span><span>${esc(h.birth_year||"—")}</span>${h.breed_desc?`<span>${esc(h.breed_desc)}</span>`:""}</div>${node.repeated||node.cycle?`<div class="family-flags">${node.repeated?badge(L3("Repeated","\u062a\u06a9\u0631\u0627\u0631\u06cc"),"warn"):""}${node.cycle?badge(L3("Cycle","\u0686\u0631\u062e\u0647"),"bad"):""}</div>`:""}</article>${children.length?`<div class="family-children" style="--child-count:${children.length};--family-columns:${Math.min(children.length,4)}">${childMarkup}</div>`:""}</div>`;
}


function descendantView(treeData,reach){return `<div class="grid grid-4">${statMini(L3("Direct children","\u0641\u0631\u0632\u0646\u062f\u0627\u0646 \u0645\u0633\u062a\u0642\u06cc\u0645"),reach.directChildren)}${statMini(L3("Known descendants","\u0646\u0648\u0627\u062f\u06af\u0627\u0646 \u0634\u0646\u0627\u062e\u062a\u0647\u200c\u0634\u062f\u0647"),reach.knownDescendants)}${statMini(L3("Max generation","\u0628\u06cc\u0634\u062a\u0631\u06cc\u0646 \u0646\u0633\u0644"),reach.maxKnownGeneration)}${statMini(L3("Truncated","\u06a9\u0648\u062a\u0627\u0647\u200c\u0634\u062f\u0647"),reach.truncated?"Yes":"No")}</div><div class="mt-4">${pedigreePanel(treeData,"descendants")}</div>`}
function statMini(label,value){return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${typeof value==="number"?num(value):esc(value)}</div></div>`}
function metrics(m,c){
 const gen=(m.generations||[]).map(g=>`<div class="metric-bar"><span>${esc(fa()?`نسل ${g.generation}`:`Gen ${g.generation}`)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,Math.min(100,Number(g.coveragePercent||g.completenessPercent||0)))}%"></div></div><strong>${pct(g.coveragePercent??g.completenessPercent)}</strong></div>`).join("");
 const pathTool=`<form id="pedigree-path-form" class="form-grid"><div class="field"><label>${esc(L3("Ancestor ID","\u0634\u0646\u0627\u0633\u0647 \u0646\u06cc\u0627\u06cc \u0645\u0648\u0631\u062f\u0646\u0638\u0631"))}</label><input name="ancestor" type="number" min="1" required></div><div class="field"><label>${esc(t("depth"))}</label><input name="depth" type="number" min="1" max="8" value="8"></div><div class="field"><label>${esc(L3("Max paths","\u062d\u062f\u0627\u06a9\u062b\u0631 \u0645\u0633\u06cc\u0631"))}</label><input name="maxPaths" type="number" min="1" max="32" value="12"></div><div class="field"><span class="field-label">&nbsp;</span><button class="btn">${esc(t("load"))}</button></div></form><div id="pedigree-path-result" class="mt-3"></div>`;
 return `<div class="grid grid-main"><div class="stack">${panel(t("coverage"),gen||renderJson(m))}${panel(t("coefficient"),renderJson(c))}${panel(L3("Ancestor paths","\u0645\u0633\u06cc\u0631\u0647\u0627\u06cc \u0646\u06cc\u0627\u06cc\u06cc"),pathTool)}</div><aside class="stack" aria-label="${attr(L3("Pedigree measures","\u0634\u0627\u062e\u0635\u200c\u0647\u0627\u06cc \u062a\u0628\u0627\u0631"))}">${panel(t("metrics"),kv([[t("completeness"),pct(m.completenessPercent??m.coveragePercent)],[t("uniqueAncestors"),num(m.uniqueAncestors??m.distinctAncestors)],[t("repeatedAncestors"),num(m.repeatedAncestorPositions??m.repeatedAncestors??m.duplicateAncestors)],[L3("Inbreeding coefficient","\u0636\u0631\u06cc\u0628 \u0647\u0645\u200c\u062e\u0648\u0646\u06cc"),c.inbreedingPercent!==undefined?pct(c.inbreedingPercent):num(c.inbreedingCoefficient)] ]))}</aside></div>`;
}
function insights(i){
 const summary=i.summary||i.profile||{};
 return `<div class="grid grid-2">${panel(t("insights"),renderJson(summary))}${panel(L3("Premium pedigree analytics","\u062a\u062d\u0644\u06cc\u0644 \u0645\u0645\u062a\u0627\u0632 \u062a\u0628\u0627\u0631\u0646\u0627\u0645\u0647"),renderJson(i.premiumPedigree||i.pedigreeMetrics||i))}</div>`;
}
function workflows(h){
 if(!state.auth.user) return panel(t("workflows"),`<div class="empty"><strong>${esc(t("signIn"))}</strong><div>${esc(t("accountIntro"))}</div><a class="btn mt-3" href="#/account">${esc(t("signIn"))}</a></div>`);
 return `<div class="grid grid-2">${panel(t("submitClaim"),`<p class="muted">${esc(L3("Submit an ownership claim for this horse for staff review.","\u0628\u0631\u0627\u06cc \u0627\u06cc\u0646 \u0627\u0633\u0628 \u062f\u0631\u062e\u0648\u0627\u0633\u062a \u062a\u0623\u06cc\u06cc\u062f \u0645\u0627\u0644\u06a9\u06cc\u062a \u062b\u0628\u062a \u06a9\u0646\u06cc\u062f."))}</p><button class="btn btn-primary mt-3" data-action="horse-claim" data-id="${h.id}">${esc(t("submitClaim"))}</button>`)}${panel(t("requestChange"),`<p class="muted">${esc(L3("Propose a correction to this registry record.","\u0627\u0635\u0644\u0627\u062d \u0627\u0637\u0644\u0627\u0639\u0627\u062a \u0627\u06cc\u0646 \u0631\u06a9\u0648\u0631\u062f \u0631\u0627 \u067e\u06cc\u0634\u0646\u0647\u0627\u062f \u062f\u0647\u06cc\u062f."))}</p><button class="btn mt-3" data-action="horse-change" data-id="${h.id}">${esc(t("requestChange"))}</button>`)}</div>`;
}

// R76 (F08 completion): native record modules — competitions, genetic tests,
// breeding records, published media and the registry certificate. Each module
// loads independently and an error in one section is reported honestly
// instead of hiding the others (same doctrine as the F04 Heritage panels).
function provenanceText(value){return ({demo:L3("Demonstration data","\u062f\u0627\u062f\u0647 \u0646\u0645\u0627\u06cc\u0634\u06cc"),user:L3("User supplied","\u062b\u0628\u062a \u06a9\u0627\u0631\u0628\u0631"),federation:L3("Source marked: federation","\u0645\u0646\u0628\u0639 \u062b\u0628\u062a\u200c\u0634\u062f\u0647: \u0641\u062f\u0631\u0627\u0633\u06cc\u0648\u0646"),derived:L3("Derived record","\u0631\u06a9\u0648\u0631\u062f \u0627\u0633\u062a\u062e\u0631\u0627\u062c\u200c\u0634\u062f\u0647")})[value]||(L3("Source not specified","\u0645\u0646\u0628\u0639 \u0646\u0627\u0645\u0634\u062e\u0635"))}
function placementText(row){if(Number(row.is_eliminated)===1)return L3("Eliminated","\u062d\u0630\u0641");if(Number(row.is_withdrawn)===1)return L3("Withdrawn","\u0627\u0646\u0635\u0631\u0627\u0641");return row.placement!=null?num(row.placement):(row.placement_text||"—")}
function sectionBox(result,render){return result.status==="fulfilled"?render(result.value):`<div class="error-box"><strong>${esc(t("error"))}</strong><div>${esc(result.reason?.message||String(result.reason))}</div><button class="btn btn-small mt-3" data-action="reload-route">${esc(t("retry"))}</button></div>`}
async function recordsView(h){
 const [comps,genes,breeds]=await Promise.allSettled([
  api(`/api/horses/${h.id}/competitions`),
  api(`/api/horses/${h.id}/genetics`),
  api(`/api/horses/${h.id}/breedings`),
 ]);
 const compSummary=comps.status==="fulfilled"&&comps.value?.summary?`<div class="grid grid-4 mb-0">${statMini(t("starts"),comps.value.summary.starts??0)}${statMini(t("wins"),comps.value.summary.wins??0)}${statMini(t("podium"),comps.value.summary.podium??0)}${statMini(t("eliminations"),comps.value.summary.eliminations??0)}</div>`:"";
 const compTable=sectionBox(comps,data=>(data.results||[]).length?`<div class="data-wrap"><table class="data-table"><thead><tr><th>${esc(t("date"))}</th><th>${esc(L3("Competition","\u0645\u0633\u0627\u0628\u0642\u0647"))}</th><th>${esc(L3("Class","\u0631\u062f\u0647"))}</th><th>${esc(t("rider"))}</th><th>${esc(t("result"))}</th><th>${esc(L3("Source","\u0645\u0646\u0628\u0639"))}</th></tr></thead><tbody>${data.results.map(row=>`<tr><td class="nowrap">${esc(row.event_date||"—")}</td><td dir="auto">${esc(row.competition_name||"—")}</td><td dir="auto">${esc(row.class_name??"—")}</td><td dir="auto">${esc(row.rider_name??"—")}</td><td><strong>${esc(placementText(row))}</strong></td><td>${esc(provenanceText(row.provenance))}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">${esc(t("noCompetitionRecord"))}</div>`);
 const geneTable=sectionBox(genes,data=>(data.tests||[]).length?`<div class="data-wrap"><table class="data-table"><thead><tr><th>${esc(L3("Test","\u0622\u0632\u0645\u0648\u0646"))}</th><th>${esc(L3("Reported result","\u0646\u062a\u06cc\u062c\u0647 \u062b\u0628\u062a\u200c\u0634\u062f\u0647"))}</th><th>${esc(L3("Source","\u0645\u0646\u0628\u0639"))}</th></tr></thead><tbody>${data.tests.map(row=>`<tr><td dir="auto">${esc(row.test_type)}</td><td dir="auto"><strong>${esc(row.result)}</strong>${Number(row.verified)===1?` ${badge(t("verified"),"good")}`:""}</td><td>${esc(provenanceText(row.provenance))}</td></tr>`).join("")}</tbody></table></div><p class="muted mt-2">${esc(t("geneticNote"))}</p>`:`<div class="empty">${esc(t("noGeneticTests"))}</div>`);
 const breedRows=breeds.status==="fulfilled"?[...(breeds.value.as_sire||[]).map(r=>[L3("Sire","\u0646\u0631\u06cc\u0627\u0646"),r]),...(breeds.value.as_dam||[]).map(r=>[L3("Dam","\u0645\u0627\u062f\u06cc\u0646"),r])]:[];
 const breedTable=sectionBox(breeds,()=>breedRows.length?`<div class="data-wrap"><table class="data-table"><thead><tr><th>${esc(L3("Role","\u0646\u0642\u0634"))}</th><th>${esc(t("foal"))}</th><th>${esc(t("season"))}</th><th>${esc(L3("Source","\u0645\u0646\u0628\u0639"))}</th></tr></thead><tbody>${breedRows.map(([role,r])=>`<tr><td>${esc(role)}</td><td>${r.foal_id!=null?`<a href="#/horse/${r.foal_id}">${esc(r.foal_name||`#${r.foal_id}`)}</a>`:"—"}</td><td>${r.season==null?"—":num(r.season)}</td><td>${esc(provenanceText(r.provenance))}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">${esc(t("noBreedings"))}</div>`);
 return `<div class="stack">
  ${panel(t("competitionRecord"),`${compSummary}<div class="mt-3">${compTable}</div>`)}
  <div class="grid grid-2">${panel(t("geneticTests"),geneTable)}${panel(t("breedingRecords"),breedTable)}</div>
 </div>`;
}
function boundedDepth(key,fallback,min,max){const n=Number(state.route.query.get(key));return Number.isInteger(n)?Math.max(min,Math.min(max,n)):fallback}

export async function horseActions(action,el){
 const id=Number(el?.dataset?.id||current?.horse?.id);
 if(action==="horse-claim") openHorseRequest('claim', id, primaryName(current?.horse));
 if(action==="horse-change") openHorseRequest('change', id, primaryName(current?.horse));
 if(action==="horse-edit") await openEdit(id);
 if(action==="horse-archive") openArchive(id);
 if(action==="confirm-archive") await archiveHorse(id);
 if(action==="submit-claim" || action==="submit-change") await submitHorseRequest(el instanceof HTMLFormElement ? el : document.getElementById(action === 'submit-claim' ? 'claim-form' : 'change-form'));
 if(action==="save-horse") await saveHorse(id);
}
function openArchive(id){modal(t("archiveHorse"),`<div class="notice">${esc(L3("This archives the canonical record. The server will refuse the operation if active descendants still reference this horse.","\u0627\u06cc\u0646 \u0639\u0645\u0644\u06cc\u0627\u062a \u0631\u06a9\u0648\u0631\u062f \u0631\u0627 \u0628\u0627\u06cc\u06af\u0627\u0646\u06cc \u0645\u06cc\u200c\u06a9\u0646\u062f \u0648 \u062f\u0631 \u0635\u0648\u0631\u062a \u062f\u0627\u0634\u062a\u0646 \u0646\u0648\u0627\u062f\u06af\u0627\u0646 \u0641\u0639\u0627\u0644 \u0645\u0645\u06a9\u0646 \u0627\u0633\u062a \u062a\u0648\u0633\u0637 \u0633\u0631\u0648\u0631 \u0631\u062f \u0634\u0648\u062f."))}</div>`,`<button class="btn" data-action="close-modal">${esc(t("cancel"))}</button><button class="btn btn-danger" data-action="confirm-archive" data-id="${id}">${esc(t("archiveHorse"))}</button>`)}
async function archiveHorse(id){try{await api(`/api/horses/${id}`,{method:"DELETE"});closeModal();toast(L3("Horse archived.","\u0631\u06a9\u0648\u0631\u062f \u0628\u0627\u06cc\u06af\u0627\u0646\u06cc \u0634\u062f."));location.hash="#/registry"}catch(e){toast(e.message,"bad")}}
async function openEdit(id){try{const data=await api(`/api/admin/horses/${id}`);const h=data.horse;modal(t("editHorse"),`<form id="horse-edit-form" class="form-grid">${editFields(h)}${adminHorseLedger(h)}<input type="hidden" name="row_version" value="${h.row_version}"></form>`,`<button class="btn" data-action="close-modal">${esc(t("cancel"))}</button><button class="btn btn-primary" data-action="save-horse" data-id="${id}">${esc(t("save"))}</button>`)}catch(e){toast(e.message,"bad")}}
function editFields(h){const fields=[["name_latin",t("name")],["name_native",t("nativeName")],["register_no",t("registerNo")],["microchip_no",t("microchip")],["father_id",t("sire")],["mother_id",t("dam")],["birth_year",t("year")],["birth_place_desc",t("place")],["breed_desc",t("breed")],["sex_desc",t("sex")],["color_desc",t("color")]];return fields.map(([k,l])=>`<div class="field"><label>${esc(l)}</label><input name="${k}" value="${attr(h[k]??"")}"></div>`).join("")+`<div class="field span-all"><label>${esc(t("description"))}</label><textarea name="description">${esc(h.description||"")}</textarea></div>`}
function adminHorseLedger(h){const rows=[[L3("Main strain","\u062a\u06cc\u0631\u0647 \u0627\u0635\u0644\u06cc"),h.main_strain_desc],[L3("File number","\u0634\u0645\u0627\u0631\u0647 \u067e\u0631\u0648\u0646\u062f\u0647"),h.file_number],[L3("Lab number","\u0634\u0645\u0627\u0631\u0647 \u0622\u0632\u0645\u0627\u06cc\u0634\u06af\u0627\u0647"),h.lab_no],[L3("Passport number","\u0634\u0645\u0627\u0631\u0647 \u06af\u0630\u0631\u0646\u0627\u0645\u0647"),h.passport_no],[L3("Created at","\u0632\u0645\u0627\u0646 \u0627\u06cc\u062c\u0627\u062f"),h.created_at],[L3("Updated at","\u0632\u0645\u0627\u0646 \u0648\u06cc\u0631\u0627\u06cc\u0634"),h.updated_at],[L3("Row version","\u0646\u0633\u062e\u0647 \u0631\u062f\u06cc\u0641"),h.row_version]];return `<details class="content-admin-provenance span-all"><summary><strong>${esc(L3("Canonical staff metadata","\u0641\u0631\u0627\u062f\u0627\u062f\u0647 \u0645\u0631\u062c\u0639 \u06a9\u0627\u0631\u06a9\u0646\u0627\u0646"))}</strong></summary><dl>${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd dir="auto">${value==null||value===""?"—":esc(value)}</dd></div>`).join("")}</dl></details>`}
async function saveHorse(id){try{const f=document.getElementById("horse-edit-form");const d=Object.fromEntries(new FormData(f));const expected=Number(d.row_version);delete d.row_version;for(const k of ["father_id","mother_id","birth_year"]) d[k]=d[k]===""?null:Number(d[k]);for(const k of Object.keys(d)) if(d[k]==="") d[k]=null;await api(`/api/horses/${id}`,{method:"PATCH",json:{expected_row_version:expected,changes:d}});closeModal();toast(L3("Horse record saved.","\u0631\u06a9\u0648\u0631\u062f \u0630\u062e\u06cc\u0631\u0647 \u0634\u062f."));location.reload()}catch(e){toast(e.message,"bad")}}

export async function submitPedigreePath(form){const slot=document.getElementById("pedigree-path-result");if(!slot||!current?.horse)return;slot.innerHTML=loading();try{const d=new FormData(form);const r=await api(`/api/horses/${current.horse.id}/pedigree/paths?ancestor=${encodeURIComponent(d.get("ancestor"))}&depth=${encodeURIComponent(d.get("depth")||8)}&maxPaths=${encodeURIComponent(d.get("maxPaths")||12)}`);slot.innerHTML=(r.paths||[]).length?`<div class="stack">${r.paths.map((p,i)=>`<div class="notice"><strong>${esc(fa()?`مسیر ${i+1}`:`Path ${i+1}`)}</strong> · ${esc(p.branch||"—")}<div class="mono mt-1">${p.path.map(id=>`#${id}`).join(" → ")}</div></div>`).join("")}</div>`:`<div class="empty">${esc(L3("No path found at this depth.","\u0645\u0633\u06cc\u0631\u06cc \u062f\u0631 \u0639\u0645\u0642 \u0627\u0646\u062a\u062e\u0627\u0628\u200c\u0634\u062f\u0647 \u06cc\u0627\u0641\u062a \u0646\u0634\u062f."))}</div>`}catch(e){slot.innerHTML=errorBox(e)}}

export function submitHorseDepth(form){const q=new URLSearchParams(state.route.query);const d=new FormData(form);q.set("tab",String(d.get("tab")));q.set("depth",String(d.get("depth")));location.hash=`#/horse/${current.horse.id}?${q}`}
