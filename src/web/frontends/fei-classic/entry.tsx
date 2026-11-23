import { FEI_HEADER_ASSET_STYLES } from "./headerAssets";
import { HierarchicalNavigation } from "./Navigation";
import { useNavigationLayout, safeDecodeRouteSegment, isRegistryId } from "../../../frontend-kit";
import { useEffect, useState } from "react";
import { horseDbRoutes, onVisualEncodingChange, parseFrontendLocalRoute, parseHorseDbRoute, readVisualEncoding, type FrontendRuntimeProps } from "../../../frontend-kit";
import { adaptRuntime } from "./adapter";
import { RegistryAnalyticsPage } from "./analytics";
import { ContentPage } from "./content";
import { Header, type ClassicNavKey } from "./Header";
import { t } from "./i18n";
import { ManagementPage } from "./management";
import { FeiCompetitionsPage, FeiMarketPage } from "./recordModules";
import { AiResearchPage, AuthPage, BreedingPage, HomePage, HorsePage, IntelligencePage, PedigreePage, PeoplePage, PersonPage, PlatformPage, QualityPage, RegistryPage, WorkflowPage } from "./pages";
import { FeiClassicProfileEditor } from "./ProfileEditor";
import { FeiDirectoryPage, FeiDirectoryPersonPage } from "./DirectoryPage";
import { FeiServiceRequestsPage } from "./ServiceRequestsPage";
import { FeiClassicOrganizationEditor } from "./OrganizationEditor";
import { FeiClassicWorkspaceDesk } from "./WorkspaceDesk";
import "./fei-classic.css";
import "./fei-donor-exact.css";
// R124: the data.fei.org donor header layers are LIVE again (restored from the
// R115 tree after the R117 compact-header package dropped their imports and
// R117-20 deleted the orphaned files). Import order matches the R115 layer
// stack so the donor-exact presentation is the default again.
import "./fei-classic-header-reference.css";
import "./fei-classic-header-pro.css";
import "./fei-classic-header-polish.css";
import "./fei-donor-header-exact.css";
import "./fei-visual-encoding.css";
import "./fei-classic-modern.css";
import "./density-tokens.css";
import "./compact-r88.css";
import "./ui-polish.css";
import "./Navigation.css";
import "./ui-system.css";

const ID="fei-classic";
type Local={kind:"home"}|{kind:"people"}|{kind:"pedigree";id?:number}|{kind:"analytics"}|{kind:"rankings"}|{kind:"timeline"}|{kind:"places"}|{kind:"quality"}|{kind:"workflows"}|{kind:"management"}|{kind:"auth"}|{kind:"breeding"}|{kind:"platform"}|{kind:"content";slug?:string}|{kind:"assistant";horseId?:number}|{kind:"competitions"}|{kind:"competition";id:number}|{kind:"market"}|{kind:"listing";id:string}|{kind:"directory-profile";personId?:number}|{kind:"organization-profile";organizationId?:number}|{kind:"workspaces";workspaceId?:number}|{kind:"directory"}|{kind:"directory-person";id:number}|{kind:"services";id?:number}|{kind:"unknown"};
function localRoute(path:string):Local{
  // R53 parity: a direct visit or refresh on /f/fei-classic/ resolves to the
  // local root path — it must land on Home, not the 404 card.
  if(path==="/")return{kind:"home"};
  if(path==="/people")return{kind:"people"};const p=path.match(/^\/pedigree(?:\/(\d+))?$/);if(p&&(!p[1]||isRegistryId(Number(p[1]))))return{kind:"pedigree",id:p[1]?Number(p[1]):undefined};if(path==="/analytics")return{kind:"analytics"};if(path==="/rankings")return{kind:"rankings"};if(path==="/timeline")return{kind:"timeline"};if(path==="/places")return{kind:"places"};if(path==="/quality")return{kind:"quality"};if(path==="/workflows")return{kind:"workflows"};if(path==="/management")return{kind:"management"};if(path==="/auth")return{kind:"auth"};if(path==="/breeding")return{kind:"breeding"};if(path==="/platform")return{kind:"platform"};const ai=path.match(/^\/assistant(?:\/(\d+))?$/);if(ai&&(!ai[1]||isRegistryId(Number(ai[1]))))return{kind:"assistant",horseId:ai[1]?Number(ai[1]):undefined};const c=path.match(/^\/content(?:\/(.+))?$/);if(c){const slug=c[1]?safeDecodeRouteSegment(c[1]):undefined;return slug===null?{kind:"unknown"}:{kind:"content",slug};}
  // F06 (R75): institutional record pages — competition calendar + marketplace.
  if(path==="/competitions")return{kind:"competitions"};const comp=path.match(/^\/competitions\/(\d+)$/);if(comp&&isRegistryId(Number(comp[1])))return{kind:"competition",id:Number(comp[1])};
  if(path==="/market")return{kind:"market"};const listing=path.match(/^\/market\/([A-Za-z0-9_-]+)$/);if(listing)return{kind:"listing",id:listing[1]!};
  if(path==="/directory")return{kind:"directory"};
  const person=path.match(/^\/directory\/(\d+)$/);if(person&&isRegistryId(Number(person[1])))return{kind:"directory-person",id:Number(person[1])};
  const service=path.match(/^\/services(?:\/(\d+))?$/);if(service&&(!service[1]||isRegistryId(Number(service[1]))))return{kind:"services",id:service[1]?Number(service[1]):undefined};
  const dp=path.match(/^\/directory-profile(?:\/(\d+))?$/);if(dp&&(!dp[1]||isRegistryId(Number(dp[1]))))return{kind:"directory-profile",personId:dp[1]?Number(dp[1]):undefined};
  const op=path.match(/^\/organization-profile(?:\/(\d+))?$/);if(op&&(!op[1]||isRegistryId(Number(op[1]))))return{kind:"organization-profile",organizationId:op[1]?Number(op[1]):undefined};const ws=path.match(/^\/workspaces(?:\/(\d+))?$/);if(ws&&(!ws[1]||isRegistryId(Number(ws[1]))))return{kind:"workspaces",workspaceId:ws[1]?Number(ws[1]):undefined};
  return{kind:"unknown"}}

export default function FederationClassicFrontend(runtime:FrontendRuntimeProps){
  const {layout:navigationLayout}=useNavigationLayout("fei-classic");
  const view=adaptRuntime(runtime);const L=(en:string,fa:string)=>t(view.locale,en,fa);const goLocal=(path:string)=>view.navigate(horseDbRoutes.frontend(ID,path));const canonical=parseHorseDbRoute(view.route);const parsed=parseFrontendLocalRoute(view.route);const local=parsed?.frontendId===ID?localRoute(parsed.path):null;
  // R64: mirror the CORE visual-encoding toggle (Appearance Studio → Foundation)
  // onto [data-encoding] — one shared preference across every frontend.
  const [encoding,setEncoding]=useState<boolean>(()=>readVisualEncoding());
  useEffect(()=>onVisualEncodingChange(setEncoding),[]);
  let page:React.ReactNode;
  if(canonical.kind==="home")page=<HomePage view={view} goLocal={goLocal}/>;else if(local?.kind==="home")page=<HomePage view={view} goLocal={goLocal}/>;else if(canonical.kind==="browse")page=<RegistryPage view={view}/>;else if(canonical.kind==="stats")page=<RegistryAnalyticsPage view={view}/>;else if(canonical.kind==="horse")page=<HorsePage view={view} id={canonical.id} goLocal={goLocal}/>;else if(canonical.kind==="person")page=<PersonPage view={view} id={canonical.id}/>;else if(local?.kind==="people")page=<PeoplePage view={view}/>;else if(local?.kind==="pedigree")page=<PedigreePage view={view} initialId={local.id}/>;else if(local?.kind==="analytics")page=<RegistryAnalyticsPage view={view}/>;else if(local?.kind==="rankings")page=<IntelligencePage view={view}/>;else if(local?.kind==="timeline")page=<IntelligencePage view={view} section="timeline"/>;else if(local?.kind==="places")page=<IntelligencePage view={view} section="places"/>;else if(local?.kind==="quality")page=<QualityPage view={view}/>;else if(local?.kind==="workflows")page=<WorkflowPage view={view} goLocal={goLocal}/>;else if(local?.kind==="management")page=<ManagementPage view={view} goLocal={goLocal}/>;else if(local?.kind==="auth")page=<AuthPage view={view}/>;else if(local?.kind==="breeding")page=<BreedingPage view={view}/>;else if(local?.kind==="platform")page=<PlatformPage view={view}/>;else if(local?.kind==="content")page=<ContentPage view={view} slug={local.slug} goLocal={goLocal}/>;else if(local?.kind==="assistant")page=<AiResearchPage view={view} horseId={local.horseId}/>;else if(local?.kind==="competitions")page=<FeiCompetitionsPage view={view} goLocal={goLocal}/>;else if(local?.kind==="competition")page=<FeiCompetitionsPage view={view} goLocal={goLocal} competitionId={local.id}/>;else if(local?.kind==="market")page=<FeiMarketPage view={view} goLocal={goLocal}/>;else if(local?.kind==="listing")page=<FeiMarketPage view={view} goLocal={goLocal} listingId={local.id}/>;else if(local?.kind==="directory")page=<FeiDirectoryPage view={view} goLocal={goLocal}/>;else if(local?.kind==="directory-person")page=<FeiDirectoryPersonPage view={view} goLocal={goLocal} personId={local.id}/>;else if(local?.kind==="services")page=<FeiServiceRequestsPage view={view} goLocal={goLocal} requestId={local.id}/>;else if(local?.kind==="directory-profile")page=<main className="fc-main"><h1 className="fc-section-title">{L("Professional profile","مشخصات حرفه‌ای")}</h1><FeiClassicProfileEditor locale={view.locale} personId={local.personId ?? null} platform={view.platform} user={view.user}/></main>;else if(local?.kind==="organization-profile")page=<main className="fc-main"><h1 className="fc-section-title">{L("Organization profile","مشخصات سازمان")}</h1><FeiClassicOrganizationEditor locale={view.locale} organizationId={local.organizationId ?? null} platform={view.platform} user={view.user}/></main>;else if(local?.kind==="workspaces")page=<main className="fc-main"><h1 className="fc-section-title">{L("Stable Workspaces","فضاهای کاری اصطبل")}</h1><FeiClassicWorkspaceDesk locale={view.locale} workspaceId={local.workspaceId ?? null} platform={view.platform} user={view.user}/></main>;else page=<main className="fc-main"><div className="fc-state"><b>404</b>{L("Federation Classic route not found.","مسیر Federation Classic یافت نشد.")}<button className="btn-search" onClick={()=>view.navigate(horseDbRoutes.home())}>{L("Home","خانه")}</button></div></main>;
  const active:ClassicNavKey=canonical.kind==="home"||local?.kind==="home"?"home":canonical.kind==="browse"?"registry":canonical.kind==="stats"?"analytics":canonical.kind==="horse"?"registry":canonical.kind==="person"?"people":local?.kind==="people"?"people":local?.kind==="pedigree"?"pedigree":local?.kind==="analytics"?"analytics":local?.kind==="rankings"||local?.kind==="timeline"||local?.kind==="places"?"intelligence":local?.kind==="quality"?"quality":local?.kind==="workflows"?"workflows":local?.kind==="management"?"management":local?.kind==="breeding"?"breeding":local?.kind==="platform"?"platform":local?.kind==="content"?"content":local?.kind==="competitions"||local?.kind==="competition"?"competitions":local?.kind==="market"||local?.kind==="listing"?"market":local?.kind==="assistant"?"intelligence":local?.kind==="auth"?"auth":"home";
  const navigate=(key:ClassicNavKey)=>{switch(key){case"home":view.navigate(horseDbRoutes.home());break;case"registry":view.navigate(horseDbRoutes.browse());break;case"people":goLocal("/people");break;case"pedigree":goLocal("/pedigree");break;case"analytics":view.navigate(horseDbRoutes.stats());break;case"intelligence":goLocal("/rankings");break;case"assistant":goLocal("/assistant");break;case"quality":goLocal("/quality");break;case"workflows":goLocal("/workflows");break;case"management":goLocal("/management");break;case"breeding":goLocal("/breeding");break;case"platform":goLocal("/platform");break;case"content":goLocal("/content");break;case"auth":goLocal("/auth");break;case"competitions":goLocal("/competitions");break;case"market":goLocal("/market");break;}}
  const skipLabel=t(view.locale,"Skip to content","پرش به محتوا");
  if(local?.kind==="auth")return <div className="fei-classic-ui fei-auth-shell" dir={view.locale!=="en"?"rtl":"ltr"} lang={view.locale} data-locale={view.locale} data-encoding={encoding?"on":"off"}><a className="fei-skip-link" href="#fei-main-content">{skipLabel}</a><div id="fei-main-content" tabIndex={-1}>{page}</div></div>;
  return <div className="fei-classic-ui" style={FEI_HEADER_ASSET_STYLES} data-source-preview={typeof document !== "undefined" && document.documentElement.hasAttribute("data-source-preview") ? "true" : undefined} data-navigation-layout={navigationLayout} dir={view.locale!=="en"?"rtl":"ltr"} lang={view.locale} data-locale={view.locale} data-encoding={encoding?"on":"off"}><a className="fei-skip-link" href="#fei-main-content">{skipLabel}</a><Header view={view} active={active} navigate={navigate}/><section className="fc102-layout-bar" aria-label={L("About this interface", "درباره این رابط")}><small>{L("Independent Horse DB interface; not an official federation website.","\u0631\u0627\u0628\u0637 \u0645\u0633\u062a\u0642\u0644 Horse DB\u061b \u0648\u0628\u200c\u0633\u0627\u06cc\u062a \u0631\u0633\u0645\u06cc \u0641\u062f\u0631\u0627\u0633\u06cc\u0648\u0646 \u0646\u06cc\u0633\u062a.")}</small></section><div className="fc102-workspace">{navigationLayout==="sidebar"&&<HierarchicalNavigation route={view.route} locale={view.locale} navigate={view.navigate}/>}<div className="fc102-content fei-content-shell" id="fei-main-content" tabIndex={-1}>{page}</div></div><DonorFooter view={view} navigate={navigate}/><ScrollTop locale={view.locale}/></div>;
}

function DonorFooter({view,navigate}:{view:ReturnType<typeof adaptRuntime>;navigate:(key:ClassicNavKey)=>void}){const L=(en:string,fa:string)=>t(view.locale,en,fa);return <footer className="fei-donor-footer"><div><span>© {new Date().getFullYear()} Horse DB · Federation Classic · {L("Canonical Registry","سامانه ثبت مرجع")}</span><div><button onClick={()=>navigate("home")}>{L("Home","خانه")}</button><button onClick={()=>navigate("content")}>{L("News / Updates","اخبار / به‌روزرسانی")}</button><button onClick={()=>navigate("platform")}>{L("Platform coverage","پوشش پلتفرم")}</button>{(view.capabilities.admin||view.capabilities.audit||view.capabilities.curation)&&<button onClick={()=>navigate("management")}>{L("Management","مدیریت")}</button>}<span><bdi>{view.platformMeta?.contractVersion||view.platform.contractVersion}</bdi></span></div></div></footer>}
function ScrollTop({locale}:{locale:"en"|"fa"|"ar"}){const[visible,setVisible]=useState(false);useEffect(()=>{const el=document.scrollingElement;const fn=()=>setVisible((el?.scrollTop??window.scrollY)>480);window.addEventListener("scroll",fn,{passive:true});return()=>window.removeEventListener("scroll",fn)},[]);return <button className={`fei-scroll-top ${visible?"visible":""}`} onClick={()=>window.scrollTo({top:0,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"})} aria-label={t(locale,"Back to top","بازگشت به بالا")}>↑</button>}
