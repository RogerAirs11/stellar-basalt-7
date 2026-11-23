import { api,state,t,fa,esc,num,pct,date,pageHead,panel,stat,badge,loading,errorBox,go,L3 } from "../core.js";

export async function renderHome(root) {
  root.innerHTML = loading();
  try {
    const [posts, quality] = await Promise.allSettled([api("/api/content/posts?limit=5"), api("/api/quality/summary")]);
    const p = state.platform;
    const s = p?.stats || {};
    root.innerHTML = `
      <section class="hero">
        <div>
          <div class="eyebrow">${esc(p?.application?.shortName || t("app"))}</div>
          <h1>${esc(L3("A professional registry built for serious pedigree work","\u0645\u0631\u062c\u0639 \u062d\u0631\u0641\u0647\u200c\u0627\u06cc \u062b\u0628\u062a \u0648 \u062a\u0628\u0627\u0631\u0646\u0627\u0645\u0647 \u0627\u0633\u0628"))}</h1>
          <p>${esc(L3("Search, browse, pedigree, relationship intelligence and breeding analysis in one compact interface designed for long working sessions.","\u062c\u0633\u062a\u200c\u0648\u062c\u0648\u060c \u0645\u0631\u0648\u0631\u060c \u062a\u0628\u0627\u0631\u0646\u0627\u0645\u0647\u060c \u062a\u062d\u0644\u06cc\u0644 \u062e\u0648\u06cc\u0634\u0627\u0648\u0646\u062f\u06cc \u0648 \u0627\u0628\u0632\u0627\u0631\u0647\u0627\u06cc \u0627\u0635\u0644\u0627\u062d \u0646\u0698\u0627\u062f \u062f\u0631 \u06cc\u06a9 \u0631\u0627\u0628\u0637 \u0641\u0634\u0631\u062f\u0647\u060c \u062e\u0648\u0627\u0646\u0627 \u0648 \u0633\u0631\u06cc\u0639."))}</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="#/registry">${esc(t("openRegistry"))}</a>
            <a class="btn" href="#/pedigree">${esc(t("explorePedigree"))}</a>
            <a class="btn" href="#/breeding">${esc(t("breedingTools"))}</a>
          </div>
        </div>
        <div class="hero-box">
          <strong>${esc(p?.demoAdminLoginAvailable ? (L3("Demonstration dataset","\u0645\u062c\u0645\u0648\u0639\u0647\u200c\u062f\u0627\u062f\u0647\u0654 \u0646\u0645\u0627\u06cc\u0634\u06cc")) : (L3("Active registry","\u062f\u0641\u062a\u0631 \u062b\u0628\u062a \u0641\u0639\u0627\u0644")))}</strong>
          <div class="cluster">${badge(p?.health?.ok ? t("live") : t("unavailable"), p?.health?.ok ? "good" : "bad")} ${badge(p?.snapshotStale ? t("stale") : t("ready"), p?.snapshotStale ? "warn" : "info")}</div>
          <small>${num(s.horses)} ${esc(L3("horse records","\u0631\u06a9\u0648\u0631\u062f \u0627\u0633\u0628"))} · ${num(s.people)} ${esc(L3("linked people","\u0641\u0631\u062f \u0645\u0631\u062a\u0628\u0637"))}</small>
          <small>${esc(p?.demoAdminLoginAvailable ? (L3("Fictional records for exploring the workflows.","\u0627\u0637\u0644\u0627\u0639\u0627\u062a \u0627\u06cc\u0646 \u0645\u062d\u06cc\u0637 \u0628\u0631\u0627\u06cc \u062a\u0645\u0631\u06cc\u0646 \u0633\u0627\u062e\u062a\u0647 \u0634\u062f\u0647 \u0627\u0633\u062a.")) : (L3("Explore horse records, pedigrees and linked people.","\u062c\u0633\u062a\u200c\u0648\u062c\u0648\u060c \u0627\u0637\u0644\u0627\u0639\u0627\u062a \u0627\u0633\u0628\u200c\u0647\u0627 \u0648 \u062a\u0628\u0627\u0631\u0646\u0627\u0645\u0647\u200c\u0647\u0627 \u062f\u0631 \u062f\u0633\u062a\u0631\u0633 \u0634\u0645\u0627\u0633\u062a.")))}</small>
        </div>
      </section>

      <div class="grid grid-4 mt-4">
        ${stat(t("horses"), num(s.horses), t("records"))}
        ${stat(t("persons"), num(s.people), L3("linked people","\u0627\u0641\u0631\u0627\u062f \u0645\u0631\u062a\u0628\u0637"))}
        ${stat(t("bothParents"), num(s.horsesWithBothParents), s.horses ? pct((s.horsesWithBothParents/s.horses)*100) : "")}
        ${stat(t("qualityIssues"), num(quality.status === "fulfilled" ? quality.value.openIssues : s.openQualityIssues), "", Number(s.openQualityIssues)>0 ? "warn" : "good")}
      </div>

      <div class="grid grid-main mt-4">
        <div class="stack">
          ${panel(L3("Quick access","\u062f\u0633\u062a\u0631\u0633\u06cc \u0633\u0631\u06cc\u0639"), `
            <div class="feature-links">
              ${feature("registry", t("registry"), L3("Browse, filter and sort the canonical registry","\u0645\u0631\u0648\u0631 \u0648 \u0641\u06cc\u0644\u062a\u0631 \u062f\u0641\u062a\u0631 \u062b\u0628\u062a"))}
              ${feature("people", t("people"), L3("Owners, breeders and other linked roles","\u0645\u0627\u0644\u06a9\u060c \u067e\u0631\u0648\u0631\u0634\u200c\u062f\u0647\u0646\u062f\u0647 \u0648 \u0646\u0642\u0634\u200c\u0647\u0627\u06cc \u0645\u0631\u062a\u0628\u0637"))}
              ${feature("pedigree", t("pedigree"), L3("Ancestors, descendants and relationships","\u0646\u06cc\u0627\u06a9\u0627\u0646\u060c \u0646\u0648\u0627\u062f\u06af\u0627\u0646 \u0648 \u062e\u0648\u06cc\u0634\u0627\u0648\u0646\u062f\u06cc"))}
              ${feature("breeding", t("breeding"), L3("Pairing analysis and candidate optimizer","\u062a\u062d\u0644\u06cc\u0644 \u062c\u0641\u062a \u0648 \u0628\u0647\u06cc\u0646\u0647\u200c\u0633\u0627\u0632\u06cc"))}
              ${feature("analytics", t("intelligence"), L3("Rankings, coverage and quality","\u0631\u062a\u0628\u0647\u200c\u0628\u0646\u062f\u06cc\u060c \u067e\u0648\u0634\u0634 \u0648 \u06a9\u06cc\u0641\u06cc\u062a"))}
              ${feature("account", t("account"), L3("Claims and change requests","\u0645\u0627\u0644\u06a9\u06cc\u062a \u0648 \u062f\u0631\u062e\u0648\u0627\u0633\u062a \u0627\u0635\u0644\u0627\u062d"))}
            </div>`) }
          ${panel(t("quality"), quality.status === "fulfilled" ? qualitySummary(quality.value) : errorBox(quality.reason))}
        </div>
        <div class="stack">
          ${panel(t("library"), posts.status === "fulfilled" ? postList(posts.value.posts || []) : errorBox(posts.reason), { actions: `<a href="#/content">${esc(L3("All","\u0647\u0645\u0647"))}</a>` })}
          ${panel(L3("Data status","\u0648\u0636\u0639\u06cc\u062a \u062f\u0627\u062f\u0647"), dataStatus(p))}
        </div>
      </div>`;
  } catch (err) { root.innerHTML = errorBox(err, "reload-route"); }
}

function feature(path,title,desc){const tone={registry:"blue",people:"green",pedigree:"violet",breeding:"amber",analytics:"teal",account:"rose"}[path]||"blue";return `<a class="feature-link tone-${tone}" href="#/${path}"><strong>${esc(title)}</strong><span>${esc(desc)}</span></a>`}
function postList(posts){
  if(!posts.length) return `<div class="empty">${esc(L3("No published posts yet.","\u0647\u0646\u0648\u0632 \u0645\u0637\u0644\u0628\u06cc \u0645\u0646\u062a\u0634\u0631 \u0646\u0634\u062f\u0647 \u0627\u0633\u062a."))}</div>`;
  return posts.map(p=>`<article class="news-item"><a class="news-title" href="#/post/${encodeURIComponent(p.slug)}">${esc(fa()?p.title_fa:p.title_en)}</a><div class="news-meta">${esc(t(p.kind) || p.kind)} · ${date(p.published_at || p.created_at)}</div><p class="news-summary">${esc((fa()?p.summary_fa:p.summary_en)||"")}</p></article>`).join("");
}
function qualitySummary(q){
  const sev=(q.severities||[]).map(x=>`${badge(`${x.value}: ${num(x.count)}`, x.value==="error"?"bad":x.value==="warning"?"warn":"info")}`).join(" ");
  const codes=(q.topIssueCodes||[]).slice(0,6).map(x=>`<div class="spread"><span>${esc(x.value)}</span><strong>${num(x.count)}</strong></div>`).join("");
  return `<div class="cluster">${sev}</div>${codes?`<div class="divider"></div><div class="stack">${codes}</div>`:""}`;
}
function dataStatus(p){
  const source=p?.source;
  return `<div class="stack">
    <div class="spread"><span>${esc(t("horses"))}</span><strong>${num(p?.stats?.horses)}</strong></div>
    <div class="spread"><span>${esc(t("dna"))}</span><strong>${num(p?.stats?.horsesWithDnaData)}</strong></div>
    <div class="spread"><span>${esc(L3("Search index","\u0646\u0645\u0627\u06cc\u0647 \u062c\u0633\u062a\u200c\u0648\u062c\u0648"))}</span><strong>${num(p?.health?.searchRows)}</strong></div>
    <div class="divider"></div>
    <div class="muted">${esc(p?.demoAdminLoginAvailable ? (L3("Fictional demonstration records","\u062f\u0627\u062f\u0647\u200c\u0647\u0627\u06cc \u0646\u0645\u0627\u06cc\u0634\u06cc \u0648 \u0633\u0627\u062e\u062a\u06af\u06cc")) : (L3("Registry records","\u0631\u06a9\u0648\u0631\u062f\u0647\u0627\u06cc \u062f\u0641\u062a\u0631 \u062b\u0628\u062a")))}</div>
    <details><summary>${esc(L3("Data source details","\u062c\u0632\u0626\u06cc\u0627\u062a \u0645\u0646\u0628\u0639 \u062f\u0627\u062f\u0647"))}</summary><div class="stack mt-2"><div class="faint" dir="auto">${esc(source?.filename || "—")}</div><div class="faint">${esc(source?.status || "—")} · ${date(source?.completedAt)}</div><small>${esc(t("contract"))}: ${esc(p?.contractVersion || "—")}</small></div></details>
  </div>`;
}
