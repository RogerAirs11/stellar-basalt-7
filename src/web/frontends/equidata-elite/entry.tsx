import { HierarchicalNavigation, LayoutSwitcher, PrimaryNavigation } from "./Navigation";
import { useNavigationLayout, isRegistryId, parseRouteId } from "../../../frontend-kit";
import React, { useEffect, useState } from "react";
import {
  horseDbRoutes,
  parseFrontendLocalRoute,
  parseHorseDbRoute,
  type FrontendRuntimeProps,
  adaptiveCssVariables, adaptiveDataAttributes, browserAdaptiveViewport,
} from "../../../frontend-kit";
import { adaptRuntime } from "./adapter";
import { GovernanceConsole } from "./governance";
import { Icon } from "./components";
import { useFavorites } from "./hooks";
import { edxText } from "./i18n";
import { NewsroomPage } from "./newsroom";
import { EquiDataMarketPage } from "./pages";
import { EquiDataDirectoryPage, EquiDataDirectoryPersonPage } from "./DirectoryPage";
import { EquiDataServiceRequestsPage } from "./ServiceRequestsPage";
import { EquiDataProfileEditor } from "./ProfileEditor";
import { EquiDataOrganizationEditor } from "./OrganizationEditor";
import { EquiDataWorkspaceDesk } from "./WorkspaceDesk";
import {
  AssistantPage,
  BreedingLabPage,
  ClaimsPage,
  ComparePage,
  HomePage,
  HorseProfilePage,
  PedigreePage,
  PeoplePage,
  PersonPage,
  PlatformCapabilitiesPage,
  QualityPage,
  RankingsPage,
  RegistryPage,
  StatsPage,
  WatchlistPage,
} from "./pages";
import "./equidata.css";
import "./density-tokens.css";
import "./compact-r88.css";
import "./Navigation.css";
import "./ui-system.css";

const FRONTEND_ID = "equidata-elite";

type LocalRoute =
  | { kind:"home" } | { kind:"compare" } | { kind:"pedigree"; id:number } | { kind:"rankings" } | { kind:"breeding" }
  | { kind:"assistant" } | { kind:"people" } | { kind:"quality" } | { kind:"watchlist" } | { kind:"claims" } | { kind:"governance" } | { kind:"platform" } | { kind:"newsroom" }
  | { kind:"market" } | { kind:"listing"; id:string }
  | { kind:"directory" } | { kind:"directory-person"; id:number } | { kind:"services"; id?:number }
  | { kind:"directory-profile" }
  | { kind:"organization-profile" }
  | { kind:"workspaces"; workspaceId?:number }
  | { kind:"unknown"; path:string };

function localRoute(path:string):LocalRoute {
  // R53 parity: a direct visit or refresh on /f/equidata-elite/ resolves to
  // the local root path — it must land on Home, not the 404 card.
  if(path==="/")return{kind:"home"};
  if(path==="/compare")return{kind:"compare"};
  const ped=path.match(/^\/pedigree\/(\d+)$/);if(ped&&isRegistryId(Number(ped[1])))return{kind:"pedigree",id:Number(ped[1])};
  const listing=path.match(/^\/market\/([A-Za-z0-9_-]+)$/);if(listing)return{kind:"listing",id:listing[1]!};
  if(path==="/market")return{kind:"market"};
  if(path==="/rankings")return{kind:"rankings"};if(path==="/breeding-lab")return{kind:"breeding"};
  if(path==="/assistant")return{kind:"assistant"};if(path==="/people")return{kind:"people"};
  if(path==="/quality")return{kind:"quality"};if(path==="/watchlist")return{kind:"watchlist"};if(path==="/claims")return{kind:"claims"};if(path==="/governance")return{kind:"governance"};if(path==="/platform")return{kind:"platform"};
  if(path==="/newsroom")return{kind:"newsroom"};
  const dp=path.match(/^\/directory-profile(?:\/(\d+))?$/);if(dp&&(!dp[1]||isRegistryId(Number(dp[1]))))return{kind:"directory-profile"};
  // R107 NEXT-06-elite: the native public directory + consented service flow.
  if(path==="/directory")return{kind:"directory"};
  const dperson=path.match(/^\/directory\/(\d+)$/);if(dperson&&isRegistryId(Number(dperson[1])))return{kind:"directory-person",id:Number(dperson[1])};
  const service=path.match(/^\/services(?:\/(\d+))?$/);if(service&&(!service[1]||isRegistryId(Number(service[1]))))return{kind:"services",id:service[1]?Number(service[1]):undefined};
  const op=path.match(/^\/organization-profile(?:\/(\d+))?$/);if(op&&(!op[1]||isRegistryId(Number(op[1]))))return{kind:"organization-profile"};
  const ws=path.match(/^\/workspaces(?:\/(\d+))?$/);if(ws&&(!ws[1]||isRegistryId(Number(ws[1]))))return{kind:"workspaces",workspaceId:ws[1]?Number(ws[1]):undefined};
  return{kind:"unknown",path};
}

export default function EquiDataEliteFrontend(runtime: FrontendRuntimeProps) {
  const {layout:navigationLayout}=useNavigationLayout("equidata-elite");
  const view=adaptRuntime(runtime);const favorites=useFavorites();
  const [adaptive,setAdaptive]=useState(()=>browserAdaptiveViewport({headerHeight:66}));
  const goLocal=(path:string)=>view.navigate(horseDbRoutes.frontend(FRONTEND_ID,path));
  const routed=parseFrontendLocalRoute(view.route);const canonical=parseHorseDbRoute(view.route);const local=routed?.frontendId===FRONTEND_ID?localRoute(routed.path):null;
  useEffect(()=>{const update=()=>setAdaptive(browserAdaptiveViewport({headerHeight:66}));update();const vv=window.visualViewport;window.addEventListener("resize",update);vv?.addEventListener("resize",update);return()=>{window.removeEventListener("resize",update);vv?.removeEventListener("resize",update)}},[]);
  let page:React.ReactNode;
  if(canonical.kind==="home")page=<HomePage view={view} goLocal={goLocal} favorites={favorites}/>;
  else if(local?.kind==="home")page=<HomePage view={view} goLocal={goLocal} favorites={favorites}/>;
  else if(canonical.kind==="browse")page=<RegistryPage view={view} favorites={favorites}/>;
  else if(canonical.kind==="stats")page=<StatsPage view={view}/>;
  else if(canonical.kind==="horse")page=<HorseProfilePage view={view} id={canonical.id} goLocal={goLocal} favorites={favorites}/>;
  else if(canonical.kind==="person")page=<PersonPage view={view} id={canonical.id}/>;
  else if(local?.kind==="compare")page=<ComparePage view={view}/>;
  else if(local?.kind==="pedigree")page=<PedigreePage view={view} id={local.id}/>;
  else if(local?.kind==="rankings")page=<RankingsPage view={view}/>;
  else if(local?.kind==="breeding")page=<BreedingLabPage view={view}/>;
  else if(local?.kind==="assistant")page=<AssistantPage view={view} goLocal={goLocal}/>;
  else if(local?.kind==="people")page=<PeoplePage view={view}/>;
  else if(local?.kind==="quality")page=<QualityPage view={view}/>;
  else if(local?.kind==="watchlist")page=<WatchlistPage view={view} favorites={favorites}/>;
  else if(local?.kind==="claims")page=<ClaimsPage view={view}/>;
  else if(local?.kind==="newsroom")page=<NewsroomPage view={view}/>;
  else if(local?.kind==="market")page=<EquiDataMarketPage view={view} goLocal={goLocal}/>;
  else if(local?.kind==="listing")page=<EquiDataMarketPage view={view} goLocal={goLocal} listingId={local.id}/>;
  else if(local?.kind==="directory")page=<EquiDataDirectoryPage view={view} goLocal={goLocal}/>;
  else if(local?.kind==="directory-person")page=<EquiDataDirectoryPersonPage view={view} goLocal={goLocal} personId={local.id}/>;
  else if(local?.kind==="services")page=<EquiDataServiceRequestsPage view={view} requestId={local.id}/>;
  else if(local?.kind==="governance")page=<main className="edx-content edx-page edx-governance"><GovernanceConsole runtime={runtime} skin="equidata"/></main>;
  else if(local?.kind==="directory-profile")page=<main className="edx-content edx-page"><h1 className="edx112-page-title">{edxText(view.locale,"Manage professional profile","ویرایشگر نمایه فهرست")}</h1><EquiDataProfileEditor locale={view.locale} personId={parseRouteId(routed?.path.match(/^\/directory-profile\/(\d+)$/)?.[1])} platform={view.platform} user={view.user}/></main>;
  else if(local?.kind==="organization-profile")page=<main className="edx-content edx-page"><h1 className="edx112-page-title">{edxText(view.locale,"Manage organization","ویرایشگر سازمان")}</h1><EquiDataOrganizationEditor locale={view.locale} organizationId={parseRouteId(routed?.path.match(/^\/organization-profile\/(\d+)$/)?.[1])} platform={view.platform} user={view.user}/></main>;
  else if(local?.kind==="workspaces")page=<main className="edx-content edx-page"><h1 className="edx112-page-title">{edxText(view.locale,"Stable workspaces","فضاهای کاری اصطبل")}</h1><EquiDataWorkspaceDesk locale={view.locale} workspaceId={local.workspaceId ?? null} platform={view.platform} user={view.user}/></main>;
  else if(local?.kind==="platform")page=<PlatformCapabilitiesPage view={view} goLocal={goLocal}/>;
  else page=<main className="edx-content edx-page"><div className="edx-notfound"><span>404</span><h1>{edxText(view.locale,"Signal not found","مسیر پیدا نشد")}</h1><p>{edxText(view.locale,"This EquiData route is not mapped to the current Horse DB platform.","این مسیر در اتصال فعلی EquiData به Horse DB تعریف نشده است.")}</p><button className="edx-button primary" onClick={()=>view.navigate(horseDbRoutes.home())}>{edxText(view.locale,"RETURN HOME","بازگشت به خانه")}</button></div></main>;
  return <div className="equidata-elite-ui" data-navigation-layout={navigationLayout} data-edx-locale={view.locale} {...adaptiveDataAttributes(adaptive)} lang={view.locale} dir={view.locale!=="en"?"rtl":"ltr"} style={adaptiveCssVariables(adaptive) as React.CSSProperties}>
    <a className="edx-skip-link" href="#edx-main-content">{edxText(view.locale,"Skip to content","پرش به محتوا")}</a>
    <header className="edx112-header">
      <div className="edx112-identity-row">
        <a className="edx112-brand" href="/" onClick={event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();goLocal("/");}}} title={edxText(view.locale,"Home","خانه")}><span>E</span><b>EQUIDATA <i>ELITE</i></b></a>
        <div className="edx112-header-actions"><LayoutSwitcher locale={view.locale}/><button type="button" className="edx112-saved" onClick={()=>goLocal("/watchlist")} aria-label={edxText(view.locale,`Watchlist, ${favorites.count} saved`,`فهرست پیگیری، ${favorites.count} ذخیره‌شده`)}><Icon name="star"/><b>{favorites.count}</b></button><button type="button" className="edx112-locale" onClick={()=>view.setLocale(view.locale==="en"?"fa":"en")} aria-label={edxText(view.locale,"فارسی · Switch to Persian","EN · تغییر زبان به انگلیسی")}>{view.locale==="en"?"فارسی":"EN"}</button></div>
      </div>
      {navigationLayout==="tabs"&&<PrimaryNavigation route={view.route} locale={view.locale} navigate={view.navigate}/>}
    </header>
    <div className="edx102-workspace">{navigationLayout==="sidebar"&&<HierarchicalNavigation route={view.route} locale={view.locale} navigate={view.navigate}/>}<div className="edx102-content" id="edx-main-content" tabIndex={-1}>{page}</div></div>
    <footer className="edx-footer"><div><strong>EQUIDATA ELITE</strong><span>{edxText(view.locale,"Horse records, analytics and professional services","سوابق اسب، تحلیل‌ها و خدمات متخصصان")} </span></div><div><button onClick={()=>goLocal("/quality")}>{edxText(view.locale,"Data Quality","کیفیت داده")}</button><button onClick={()=>goLocal("/directory")}>{edxText(view.locale,"Directory","فهرست متخصصان")}</button><button onClick={()=>goLocal("/services")}>{edxText(view.locale,"Service Requests","درخواست خدمات")}</button><button onClick={()=>goLocal("/people")}>{edxText(view.locale,"People","افراد")}</button><button onClick={()=>goLocal("/governance")}>{edxText(view.locale,"Governance","حکمرانی")}</button><button onClick={()=>goLocal("/platform")}>{edxText(view.locale,"Capabilities","قابلیت‌ها")}</button><button onClick={()=>goLocal("/assistant")}>{edxText(view.locale,"AI Service","سرویس هوش مصنوعی")}</button><span className={view.health?.ok?"online":"offline"}>{view.health?.ok?edxText(view.locale,"PLATFORM ONLINE","پلتفرم آنلاین"):edxText(view.locale,"PLATFORM STATUS UNKNOWN","وضعیت پلتفرم نامشخص")}</span></div></footer>
  </div>;
}
