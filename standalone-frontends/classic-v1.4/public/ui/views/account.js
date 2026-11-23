import { api,state,t,fa,esc,attr,date,pageHead,panel,badge,loading,errorBox,toast,closeModal,L3 } from "../core.js";

export async function renderAccount(root){
  root.innerHTML=loading();
  try{
    if(!state.auth.user){
      root.innerHTML=`${pageHead(t("account"),t("accountIntro"))}<div class="grid grid-2">${panel(t("signIn"),loginForm())}${state.platform?.demoAdminLoginAvailable?panel(t("demoAdmin"),`<p class="muted">${esc(L3("One-click demo administrator access is enabled in this environment.","\u0648\u0631\u0648\u062f \u06cc\u06a9\u200c\u06a9\u0644\u06cc\u06a9\u06cc \u0645\u062f\u06cc\u0631 \u0622\u0632\u0645\u0627\u06cc\u0634\u06cc \u0628\u0631\u0627\u06cc \u0645\u062d\u06cc\u0637 \u062a\u0648\u0633\u0639\u0647 \u0641\u0639\u0627\u0644 \u0627\u0633\u062a."))}</p><button class="btn btn-primary mt-3" data-action="demo-admin-login">${esc(t("demoAdmin"))}</button>`):""}</div>`;
      return;
    }
    const [claims,changes]=await Promise.allSettled([api("/api/claims/mine"),api("/api/change-requests/mine")]);
    const u=state.auth.user;
    root.innerHTML=`${pageHead(t("account"),`${t("signedInAs")} ${u.display_name || u.email}`,`<button class="btn" data-action="logout">${esc(t("signOut"))}</button>`)}
      <div class="grid grid-main"><div class="stack">${panel(t("myClaims"),claims.status==="fulfilled"?claimList(claims.value.claims||[]):errorBox(claims.reason))}${panel(t("myChanges"),changes.status==="fulfilled"?changeList(changes.value.requests||[]):errorBox(changes.reason))}</div><aside class="stack">${panel(t("account"),`<div class="stack"><div><div class="faint">${esc(t("name"))}</div><strong>${esc(u.display_name||"—")}</strong></div><div><div class="faint">${esc(t("email"))}</div><strong>${esc(u.email)}</strong></div><div><div class="faint">${esc(t("role"))}</div><span class="badge info">${esc(u.role)}</span></div></div>`)}${panel(L3("Permissions","\u062f\u0633\u062a\u0631\u0633\u06cc\u200c\u0647\u0627"),`<div class="cluster">${state.auth.permissions.map(p=>badge(p)).join(" ")||"—"}</div>`)}</aside></div>`;
  }catch(e){root.innerHTML=errorBox(e,"reload-route")}
}
function loginForm(){return `<form id="login-form" class="stack"><div class="field"><label for="classic-login-email">${esc(t("email"))}</label><input id="classic-login-email" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="classic-login-password">${esc(t("password"))}</label><input id="classic-login-password" name="password" type="password" autocomplete="current-password" minlength="8" required></div><button class="btn btn-primary" type="submit">${esc(t("signIn"))}</button></form>`}
function claimList(rows){if(!rows.length)return `<div class="empty">${esc(L3("No ownership claims yet.","\u0627\u062f\u0639\u0627\u06cc\u06cc \u062b\u0628\u062a \u0646\u0634\u062f\u0647 \u0627\u0633\u062a."))}</div>`;return rows.map(r=>`<div class="news-item spread"><div><a class="news-title" href="#/horse/${r.horse_id}">${esc(fa()?(r.name_native||r.name_latin):(r.name_latin||r.name_native))}</a><div class="news-meta">#${esc(r.horse_id)} · ${date(r.created_at)}</div>${r.review_note?`<div class="news-summary">${esc(r.review_note)}</div>`:""}</div>${statusBadge(r.status)}</div>`).join("")}
function changeList(rows){if(!rows.length)return `<div class="empty">${esc(L3("No change requests yet.","\u062f\u0631\u062e\u0648\u0627\u0633\u062a \u0627\u0635\u0644\u0627\u062d\u06cc \u062b\u0628\u062a \u0646\u0634\u062f\u0647 \u0627\u0633\u062a."))}</div>`;return rows.map(r=>`<div class="news-item spread"><div><strong>${esc(r.summary)}</strong><div class="news-meta">${r.horse_id?`<a href="#/horse/${r.horse_id}">#${r.horse_id}</a> · `:""}${esc(r.request_type)} · ${date(r.submitted_at||r.created_at)}</div>${r.review_note?`<div class="news-summary">${esc(r.review_note)}</div>`:""}</div>${statusBadge(r.status)}</div>`).join("")}
function statusBadge(s){return badge(s,s==="approved"?"good":s==="rejected"?"bad":s==="pending"?"warn":"info")}
export async function accountActions(action){
  try{
    if(action==="demo-admin-login"){state.auth=await api("/api/auth/demo-admin",{method:"POST",json:{}});toast(L3("Signed in as demo administrator.","\u0648\u0631\u0648\u062f \u0645\u062f\u06cc\u0631 \u0622\u0632\u0645\u0627\u06cc\u0634\u06cc \u0627\u0646\u062c\u0627\u0645 \u0634\u062f."));location.hash="#/admin";location.reload()}
    if(action==="logout"){await api("/api/auth/logout",{method:"POST",json:{}});state.auth={user:null,csrfToken:null,permissions:[]};toast(L3("Signed out.","\u062e\u0627\u0631\u062c \u0634\u062f\u06cc\u062f."));location.hash="#/home";location.reload()}
  }catch(e){toast(e.message,"bad")}
}
export async function submitLogin(form){try{const d=new FormData(form);state.auth=await api("/api/auth/login",{method:"POST",json:{email:String(d.get("email")),password:String(d.get("password"))}});toast(L3("Signed in successfully.","\u0628\u0627 \u0645\u0648\u0641\u0642\u06cc\u062a \u0648\u0627\u0631\u062f \u0634\u062f\u06cc\u062f."));location.hash="#/home";location.reload()}catch(e){toast(e.message,"bad")}}
