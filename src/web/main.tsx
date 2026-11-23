import {SourceNotes} from '../frontend-kit/SourceNotes';
import { HERITAGE_DECORATION } from "./assetCatalog";
import { HeritageHeader } from "./heritage/Header";
import { uiText, parseUiLocale, isUiRtl, legacyUiLocale, engineUiLocale, type UiLocale } from "../shared/uiLocale";
import { DemoSessionPicker } from "./DemoSessionPicker";
import { principalScopeKey, useNavigationLayout, isRegistryId } from "../frontend-kit";
import { HierarchicalNavigation, ContextNavigation } from "./heritage/Navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { onVisualEncodingChange, readVisualEncoding } from "./registryVisualEncoding";
import { breedEncoding, coatColorEncoding, horseLifecycleGlyph, horseLifecycleLabel, horseLifecycleState, horseSexSymbol, registrySexKind } from "../frontend-kit/registryEncoding";
import "./styles/app.css";
import "./styles/heritage.system.css";
import "./styles/heritage.tokens.css";
import "./styles/heritage.color.css";
import "./styles/heritage.analytics.css";
import "./styles/heritage.final.css";
import "./styles/heritage.motion.css";
import "./styles/heritage.navigation.css";
import "./styles/heritage.refinement.css";
import "./styles/heritage.material.css";
import "./styles/heritage.lighting.css";
import "./styles/heritage.appearance-studio.css";
import "./styles/heritage.chrome.css";
import "./styles/heritage.assets.css";
import "./styles/heritage.interaction.css";
import "./styles/heritage.newsroom.css";
import "./styles/heritage.mobile-dock.css";
import "./styles/heritage.registry-encoding.css";
import "./styles/heritage.people.css";
import "./styles/heritage.density.css";
import "./styles/heritage.ai.css";
import "./styles/heritage.page-rhythm.css";
import "./styles/heritage.layout.css";
import "./styles/heritage.modules.css";
import "./styles/heritage.polish.css";
import "./styles/heritage.operations-polish.css";
import "./heritage/Navigation.css";
import "../frontend-kit/navigation-group-tokens.css";
import { bootstrapHeritagePresentation, setHeritagePresentation, useHeritagePresentation } from "./heritagePresentation";
import { setSubmissionDraftPrincipal } from "./heritage/submissionDraftMemory";
import { I18nProvider, useI18n, type Locale } from "./i18n";
import type { HeritageAuthNotice } from "./heritage/AuthPage";
import { evaluateFrontendCompatibility, getFrontendManifests, hasFrontend, loadFrontend, HERITAGE_PRESENTATIONS, type FrontendRuntimeProps } from "./frontendRegistry";
import type {
  AdminClaimRecord,
  AdminDashboardResponse,
  AdminHorseRecord,
  AdminQualityIssue,
  QualityQueueCounts,
  AuditEventSummary,
  ChangeRequestRecord,
  DescendantMetricsResponse,
  HorseInsightsResponse,
  HorseProfileResponse,
  HorseRecord,
  PedigreeCoefficientResponse,
  PedigreeMetricsResponse,
  PedigreePathResponse,
  PersonProfileResponse,
  RegistryAnalyticsResponse,
  QualitySummaryResponse,
  RegistryBrowseParams,
  RegistryFacetsResponse,
  RegistrySort,
  RegistrySortDirection,
  RelationshipCoefficientResponse,
  RelationshipResponse,
  PlatformClient,
  PlatformHealthResponse,
  PlatformMetaResponse,
  PlatformPermission,
  PlatformUser,
} from "../contracts/platform";

/** Narrow CSS variable typing for pedigree visual custom properties (replaces broad `any` casts). */
type HeritageCSSProperties = React.CSSProperties & Record<`--${string}`, string | number>;

/** T12: render a typed registry date in the viewer's locale calendar — the
 * Persian UI sees Solar Hijri, the English UI sees Gregorian, both from the
 * SAME stored fact, with an honesty label for imprecise dates. */
function typedDateText(date: RegistryDate | null | undefined, locale: UiLocale): string | null {
  if (!date || !date.value) return null;
  const outputCalendar = locale === "fa" ? "solar_hijri" : "gregorian";
  const formatted = formatRegistryDate(date, outputCalendar, locale === "fa" ? "fa" : "en");
  return formatted.text;
}
function profileBirth(date: RegistryDate|null|undefined, year:number|null|undefined): RegistryDate|null {
  return date ?? (year && Number.isInteger(year) && year>=1500 && year<=new Date().getFullYear() ? {value:String(year),precision:'year',calendar:'gregorian'} : null);
}
function typedDatePrecisionNote(date: RegistryDate | null | undefined, locale: UiLocale): string | null {
  if (!date || !date.value || date.precision === "day") return null;
  return uiText(locale, "recorded precision only", "فقط تا دقت ثبت‌شده");
}
import { createFetchAiStreamTransport, createPlatformClient } from "./platformClient";
// R133: prefetch route mapping lives in frontend-kit (raw-API audit rule)
import { dataUrlsForRoute } from "../frontend-kit/cachingTransport";
import { createCachedFetchTransport } from "../frontend-kit/cachingTransport";
import { formatRegistryDate, type RegistryDate } from "../registry/dates";
import { AssistantLauncher } from "../frontend-kit/ai/AssistantLauncher";
// R114-13 bundle split: these surfaces load on demand — the assistant full page,
// the appearance studio, admin AI settings and the horse-page capability panels
// (attestations/competitions/genetics/media, breeding, claims) leave the initial
// chunk. Recovery: lazy failures bubble to the existing FrontendErrorBoundary.
const AssistantPanel = React.lazy(() => import("../frontend-kit/ai/AssistantPanel").then(m => ({ default: m.AssistantPanel })));
import { SHARED_FRONTEND_ASSETS } from "./sharedAssets";
import { EMPTY_ADVANCED_REGISTRY_SEARCH, advancedRegistryParams, hasAdvancedRegistrySearch, type AdvancedRegistrySearch } from "./advancedSearch";
import { parseRegistryUrlState, serializeRegistryUrlState, type RegistryUrlState } from "../frontend-kit/registryUrlState";
import { isCanonicalHorseDbRoute, parseFrontendLocalRoute } from "../frontend-kit/routes";
import { publicHorseDetailFields } from "../frontend-kit/horseFields";
import { HorseCurationForm } from "./shared/HorseCurationForm";
import { fitScaleForBox } from "../frontend-kit/adaptiveComposition";
// R42 hyper-optimization: route pages load as async chunks so the initial
// bundle only carries the shell + search experience. Each page keeps its exact
// props contract; the Suspense boundary below renders a quiet page-sized
// placeholder while the chunk streams in (same pattern as ParticleHorseSplash).
const RegistryStatsPage = React.lazy(() => import("./heritage/RegistryStatsPage").then(module => ({ default: module.RegistryStatsPage })));
const RegistryDeskPage = React.lazy(() => import("./heritage/RegistryDeskPage").then(module => ({ default: module.RegistryDeskPage })));
const HorseSubmissionPage = React.lazy(() => import("./heritage/HorseSubmissionPage").then(module => ({ default: module.HorseSubmissionPage })));
const HeritageNewsroomPage = React.lazy(() => import("./heritage/NewsroomPage").then(module => ({ default: module.HeritageNewsroomPage })));
const HeritageEditorialStudioPage = React.lazy(() => import("./heritage/EditorialStudioPage").then(module => ({ default: module.HeritageEditorialStudioPage })));
const HeritageAdminAiSettings = React.lazy(() => import("./heritage/AdminAiSettings").then(m => ({ default: m.HeritageAdminAiSettings })));
// R141: the duplicate-resolution workbench — candidate miner + versioned
// merge/preview/unmerge, admin surface over the R117-19 commands.
const HeritageDuplicateWorkbench = React.lazy(() => import("./heritage/DuplicateWorkbench").then(m => ({ default: m.HeritageDuplicateWorkbench })));
// R117-18: the native privacy-redaction operator surface (admin role only —
// the backend queue/decide/fulfill routes all gate on the admin role).
const HeritagePrivacyRedactionPanel = React.lazy(() => import("./heritage/PrivacyRedactionPanel").then(m => ({ default: m.HeritagePrivacyRedactionPanel })));
import { HeritageMobileDockProvider, useHeritageMobileDock, type HeritageDockLayer } from "./heritage/MobileDock";
import { revealHeritageContent } from "./heritage/viewTransition";
const HeritageBreedingPanel = React.lazy(() => import("./heritage/HorseCapabilityPanels").then(m => ({ default: m.HeritageBreedingPanel })));
const HeritageClaimPanel = React.lazy(() => import("./heritage/HorseCapabilityPanels").then(m => ({ default: m.HeritageClaimPanel })));
import { analysisMethodLabel, componentCodeLabel, confidenceGradeLabel, founderAssumptionLabel, localizedAnalysisText, localizedDigits, localizedPercent, workflowStatusLabel } from "./heritage/presentationLocale";
import { HeritageBackgroundStage } from "./heritage/HeritageBackgroundStage";
import { HeritageLightingOverlay } from "./heritage/HeritageLightingOverlay";
import { HeritageSurfaceEffectsBinder } from "./heritage/HeritageSurfaceEffectsBinder";
import { bootstrapHeritageAppearance, setHeritageAppearance, useHeritageAppearanceValue } from "./heritageAppearance";
import { bootstrapHeritageLayout } from "./heritageLayout";
import { HERITAGE_SPLASH_ART_OPTIONS, bootstrapHeritageVisualAssets, getResolvedHeritageBackgroundEngine, resolveHeritageBackgroundSource, resolveHeritageBrandSource, resolveHeritageSplashSource, setHeritageVisualAssets, useHeritageVisualAssetsSnapshot } from "./heritageVisualAssets";

const ParticleHorseSplash=React.lazy(()=>import("./heritage/ParticleHorseSplash"));
const HeritageMarketplacePage=React.lazy(()=>import("./heritage/MarketplacePage").then(m=>({default:m.HeritageMarketplacePage})));
const HeritageCompetitionsPage=React.lazy(()=>import("./heritage/CompetitionsPage").then(m=>({default:m.HeritageCompetitionsPage})));
const HeritageDirectoryPage=React.lazy(()=>import("./heritage/DirectoryPage").then(m=>({default:m.HeritageDirectoryPage})));
const HeritageDirectoryPersonPage=React.lazy(()=>import("./heritage/DirectoryPage").then(m=>({default:m.HeritageDirectoryPersonPage})));
const HeritageProfileWorkbench=React.lazy(()=>import("./heritage/ProfileWorkbench").then(m=>({default:m.HeritageProfileWorkbench})));
const HeritageOrganizationWorkbench=React.lazy(()=>import("./heritage/OrganizationWorkbench").then(m=>({default:m.OrganizationWorkbench})));
const HeritageWorkspacesPage=React.lazy(()=>import("./heritage/WorkspacesPage").then(m=>({default:m.HeritageWorkspacesPage})));
const HeritageServiceRequestsPage=React.lazy(()=>import("./heritage/ServiceRequestsPage").then(m=>({default:m.HeritageServiceRequestsPage})));
const HeritageAuthPage=React.lazy(()=>import("./heritage/AuthPage").then(m=>({default:m.HeritageAuthPage})));
const HorseAttestationsPanel = React.lazy(() => import("./heritage/HorseModulesPanels").then(m => ({ default: m.HorseAttestationsPanel })));
const HorseCompetitionPanel = React.lazy(() => import("./heritage/HorseModulesPanels").then(m => ({ default: m.HorseCompetitionPanel })));
const HorseRacingPanel = React.lazy(() => import("./heritage/HorseModulesPanels").then(m => ({ default: m.HorseRacingPanel })));
const HorseGeneticsPanel = React.lazy(() => import("./heritage/HorseModulesPanels").then(m => ({ default: m.HorseGeneticsPanel })));
const HorseMediaGallery = React.lazy(() => import("./heritage/HorseModulesPanels").then(m => ({ default: m.HorseMediaGallery })));
const HorseCarePanel = React.lazy(() => import("./heritage/HorseCarePanel").then(m => ({ default: m.HorseCarePanel })));
const SupplementaryValues = React.lazy(() => import("./heritage/MetadataWorkbench").then(m => ({ default: m.SupplementaryValues })));
const ProfessionalGrantWorkbench = React.lazy(() => import("./shared/ProfessionalGrantWorkbench").then(m => ({ default: m.ProfessionalGrantWorkbench })));
const AccountSecurityPanel = React.lazy(() => import("./shared/AccountSecurityPanel").then(m => ({ default: m.AccountSecurityPanel })));
const AccountSecuritySessionNotice = React.lazy(() => import("./shared/AccountSecurityPanel").then(m => ({ default: m.AccountSecuritySessionNotice })));

type Horse = HorseRecord & { score?: number; matched_by?: string[] };
type SearchResponse = { query: string; results: Horse[] };
type AuthUser = PlatformUser;
type HealthResponse = PlatformHealthResponse;
type BrowseResponse = { rows: Horse[]; total: number; limit: number; offset: number; nextOffset: number|null; previousOffset: number|null; sort: string; dir: string; filter: string };
// R136: the internal serial column and the native-name column are gone from
// the explorer table. The serial is registry plumbing, not user information
// (the register number covers identification), and the native name always
// duplicated the primary/secondary name already shown in the horse cell.
// R151 (owner directive): the combined name cell shows ONLY the horse name
// and the owner, both larger. Register number and microchip number moved to
// dedicated optional columns that ship hidden by default.
type RegistryOptionalColumn = "aka"|"year"|"sex"|"breed"|"place"|"sire"|"dam"|"register"|"microchip";
const REGISTRY_OPTIONAL_COLUMNS: RegistryOptionalColumn[] = ["aka","year","sex","breed","place","sire","dam","register","microchip"];
const REGISTRY_DEFAULT_VISIBLE_COLUMNS: RegistryOptionalColumn[] = REGISTRY_OPTIONAL_COLUMNS.filter(column=>column!=="register"&&column!=="microchip");
type PedigreeWorkspacePane = "visualizer" | "intelligence";
type RecordWorkspacePane = "summary" | "record" | "claims";

function useHeritageSceneParallax(enabled:boolean,source:string,focusY:number,fitWidth:boolean){
  useEffect(()=>{
    const root=document.documentElement;
    const property="--h-scene-parallax-focus-y";
    if(!enabled){root.style.removeProperty(property);return;}
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
    const image=new Image();
    let naturalWidth=0,naturalHeight=0,raf=0,alive=true;
    const safeFocus=Math.max(0,Math.min(100,Number.isFinite(focusY)?focusY:50));
    const paint=()=>{
      raf=0;
      if(!alive)return;
      if(reduced.matches||!naturalWidth||!naturalHeight){root.style.setProperty(property,`${safeFocus}%`);return;}
      const shell=document.querySelector<HTMLElement>(".app-shell");
      const pseudo=shell?getComputedStyle(shell,"::before"):null;
      const stageWidth=Math.max(1,parseFloat(pseudo?.width||"")||window.innerWidth);
      const stageTop=Math.max(0,parseFloat(pseudo?.top||"")||(window.innerWidth<=720?56:66));
      const stageHeight=Math.max(1,parseFloat(pseudo?.height||"")||window.innerHeight-stageTop);
      const coverScale=Math.max(stageWidth/naturalWidth,stageHeight/naturalHeight);
      const renderedHeight=fitWidth?stageHeight*1.08:naturalHeight*coverScale;
      const hiddenHeight=Math.max(0,renderedHeight-stageHeight);
      const towardBottomRoom=hiddenHeight*((100-safeFocus)/100);
      const towardTopRoom=hiddenHeight*(safeFocus/100);
      const direction=towardBottomRoom>=towardTopRoom?1:-1;
      const availableRoom=Math.max(towardBottomRoom,towardTopRoom);
      const safeTravel=Math.min(56,availableRoom*.84);
      const pixelShift=Math.min(safeTravel,Math.max(0,window.scrollY)*.055);
      const focusShift=hiddenHeight>0?(pixelShift/hiddenHeight)*100*direction:0;
      root.style.setProperty(property,`${Math.max(0,Math.min(100,safeFocus+focusShift)).toFixed(3)}%`);
    };
    const schedule=()=>{if(!raf)raf=requestAnimationFrame(paint)};
    image.decoding="async";
    image.onload=()=>{naturalWidth=image.naturalWidth;naturalHeight=image.naturalHeight;schedule()};
    image.onerror=()=>{naturalWidth=0;naturalHeight=0;schedule()};
    image.src=source;
    paint();
    addEventListener("scroll",schedule,{passive:true});
    addEventListener("resize",schedule,{passive:true});
    reduced.addEventListener("change",schedule);
    return()=>{
      alive=false;
      removeEventListener("scroll",schedule);
      removeEventListener("resize",schedule);
      reduced.removeEventListener("change",schedule);
      if(raf)cancelAnimationFrame(raf);
      root.style.removeProperty(property);
    };
  },[enabled,source,focusY,fitWidth]);
}
type PedFitMode = "actual" | "all" | "width" | "height";
type PedMobileView = "compact" | "readable" | "map" | "vertical" | "radial";
type ProfileWorkspace = "all" | "pedigree" | "record" | "relationships" | "breeding" | "competitions" | "racing" | "media" | "genetics" | "care";

type PedigreeNode = { horse: Horse; relation: "self"|"father"|"mother"|"offspring"; generation: number; repeated: boolean; cycle: boolean; parents?: PedigreeNode[]; children?: PedigreeNode[] };


function localizedParentName(horse:Horse, relation:"father"|"mother", locale:Locale):string|number|null|undefined {
  // R129: FA *and* AR read native-first; EN/FR read Latin-first. When the
  // record carries no parent NAME at all we return null so the UI shows the
  // localized "Unknown" label instead of a bare numeric id (the id still
  // appears in the lineage card / table contexts where it is meaningful).
  const nativeFirst=locale==="fa"||locale==="ar";
  if(relation==="father") return nativeFirst ? (horse.father_name_native||horse.father_name||null) : (horse.father_name||horse.father_name_native||null);
  return nativeFirst ? (horse.mother_name_native||horse.mother_name||null) : (horse.mother_name||horse.mother_name_native||null);
}



// R53: the 24×24 stroke icon set now lives in ./heritage/icons.tsx and is shared
// with the federation feature-module pages (market / competitions / genetics / media).
import { SearchIcon, RegistryIcon, StatsIcon, NewsIcon, WallpaperIcon, AiIcon, AdminIcon, TrophyIcon, MarketIcon, PersonIcon, DnaIcon, MediaIcon, PedigreeIcon, DocIcon } from "./heritage/icons";

type FrontendBoundaryProps={frontendId:string;locale:Locale;onRecover:()=>void;children:React.ReactNode};
class FrontendErrorBoundary extends React.Component<FrontendBoundaryProps,{error:string|null}> {
  state:{error:string|null}={error:null};
  static getDerivedStateFromError(error:unknown){return {error:error instanceof Error?error.message:"Frontend render failure"};}
  componentDidUpdate(previous:Readonly<FrontendBoundaryProps>){if(previous.frontendId!==this.props.frontendId&&this.state.error)this.setState({error:null});}
  componentDidCatch(error:unknown){console.error(`[Horse DB] Frontend '${this.props.frontendId}' crashed`,error);}
  render(){if(this.state.error){const fa=this.props.locale==="fa";return <main className="frontend-load-state"><strong>{fa?"رابط کاربری با خطا متوقف شد.":"Frontend module crashed."}</strong><span>{this.state.error}</span><button onClick={this.props.onRecover}>{fa?"بازگشت به سامانه ثبت اصلی":"Return to Heritage Registry"}</button></main>}return this.props.children;}
}

function ExternalFrontendHost({frontendId,runtime,onRecover}:{frontendId:string;runtime:FrontendRuntimeProps;onRecover:()=>void}) {
  const [Component,setComponent]=useState<React.ComponentType<FrontendRuntimeProps>|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{let live=true;setComponent(null);setFailed(false);loadFrontend(frontendId).then(loaded=>{if(!live)return;if(loaded)setComponent(()=>loaded);else setFailed(true)}).catch(()=>{if(live)setFailed(true)});return()=>{live=false}},[frontendId]);
  if(failed)return <main className="frontend-load-state"><strong>{runtime.locale==="fa"?"رابط کاربری در دسترس نیست.":"Frontend module unavailable."}</strong><span>{runtime.locale==="fa"?"ماژول انتخاب‌شده بارگذاری نشد.":"The selected module could not be loaded."}</span><button onClick={onRecover}>{runtime.locale==="fa"?"بازگشت به سامانه ثبت اصلی":"Return to Heritage Registry"}</button></main>;
  if(!Component)return <main className="frontend-load-state"><strong>{runtime.locale==="fa"?"در حال بارگذاری رابط کاربری…":"Loading frontend module…"}</strong></main>;
  return <FrontendErrorBoundary frontendId={frontendId} locale={runtime.locale} onRecover={onRecover}><Component {...runtime}/></FrontendErrorBoundary>;
}

function FrontendSwitcher({value,onChange,platformMeta}:{value:string;onChange:(id:string)=>void;platformMeta:PlatformMetaResponse|null}) {
  const {locale}=useI18n();
  const L=(en:string,fa:string)=>uiText(locale,en,fa);
  const presentation=useHeritagePresentation();
  const [open,setOpen]=useState(false);
  const switcherRef=useRef<HTMLElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const dismiss=(event:PointerEvent)=>{if(!switcherRef.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);triggerRef.current?.focus();}};
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);};
  },[open]);
  useEffect(()=>{const show=()=>setOpen(true);addEventListener("heritage:open-frontend-switcher",show);return()=>removeEventListener("heritage:open-frontend-switcher",show)},[]);
  const manifests=useMemo(()=>getFrontendManifests(),[]);
  const current=manifests.find(item=>item.id===value)??manifests[0];
  const title=current?.name??L("Interface","رابط کاربری");
  return <aside ref={switcherRef} className={`frontend-switcher${open?" open":""}`}>
    <button ref={triggerRef} type="button" aria-controls={open?"frontend-switcher-options":undefined} aria-haspopup="dialog" className="frontend-switcher-trigger" onClick={()=>setOpen(next=>!next)} aria-expanded={open} title={L("Change interface","تغییر رابط کاربری")}><span>UI</span><b>{title}</b></button>
    {open&&<div id="frontend-switcher-options" className="frontend-switcher-popover" role="dialog" aria-label={L("Choose an interface","انتخاب رابط کاربری")}>
      <header><strong>{L("Choose an interface","انتخاب رابط کاربری")}</strong><small>{L("Your records and permissions stay the same.","پرونده‌ها و دسترسی‌های شما تغییری نمی‌کنند.")}</small></header>
      {HERITAGE_PRESENTATIONS.map(option=>{
        const active=value==="heritage"&&presentation===option.id;
        return <button type="button" key={option.id} aria-pressed={active} className={active?"active":""} onClick={()=>{setHeritagePresentation(option.id);if(value!=="heritage")onChange("heritage");setOpen(false)}}><span><b>{L(option.name.en,option.name.fa)}</b><small>{L(option.description.en,option.description.fa)}</small></span><em aria-hidden="true">{active?"✓":"→"}</em></button>;
      })}
      {manifests.filter(manifest=>manifest.id!=="heritage").map(manifest=>{
        const report=evaluateFrontendCompatibility(manifest,platformMeta);
        const compatible=report.platformKnown&&report.compatible;
        const issue=!report.platformKnown?L("Checking platform compatibility…","در حال بررسی سازگاری پلتفرم…"):report.blockingIssues[0]?.message??report.warnings[0]?.message;
        return <button key={manifest.id} type="button" aria-pressed={manifest.id===value} disabled={!compatible} className={`${manifest.id===value?"active":""}${compatible?"":" incompatible"}`} title={issue} onClick={()=>{if(compatible){onChange(manifest.id);setOpen(false)}}}><span><b>{manifest.name}</b><small>{compatible?manifest.description:issue}</small></span><em aria-hidden="true">{manifest.id===value?"✓":"→"}</em></button>;
      })}
    </div>}
  </aside>;
}

function safeStorageGet(key:string):string|null { try { return localStorage.getItem(key); } catch { return null; } }
function safeStorageSet(key:string,value:string):void { try { localStorage.setItem(key,value); } catch { /* persistence is optional */ } }


// Farsi is the product default. An explicit English selection is still honoured, and the
// pre-paint bootstrap below applies the resolved lang/dir before React mounts.
function storedLocale():Locale { return parseUiLocale(safeStorageGet("registry-locale")); }

// R134 PERFORMANCE: route CHUNK prefetch map. The R132 hover layer already
// warms the DATA of the destination page, but the page's JS chunk was still
// downloaded only at click time (React.lazy), so the first visit to every
// page paid a click -> chunk download -> render waterfall on top of the API
// latency. The module registry makes import() idempotent, so firing it from
// hover/focus/pointerdown is free and the later React.lazy call resolves
// instantly. Best-effort: failures are swallowed.
function routeChunkForRoute(pathname: string): Promise<unknown> | null {
  if (pathname.startsWith("/stats")) return import("./heritage/RegistryStatsPage");
  if (pathname.startsWith("/newsroom/studio")) return import("./heritage/EditorialStudioPage");
  if (pathname.startsWith("/newsroom")) return import("./heritage/NewsroomPage");
  if (pathname.startsWith("/competitions")) return import("./heritage/CompetitionsPage");
  if (pathname.startsWith("/market")) return import("./heritage/MarketplacePage");
  if (pathname.startsWith("/directory")) return import("./heritage/DirectoryPage");
  if (pathname.startsWith("/workspaces")) return import("./heritage/WorkspacesPage");
  if (pathname.startsWith("/services")) return import("./heritage/ServiceRequestsPage");
  if (pathname.startsWith("/login") || pathname.startsWith("/register")) return import("./heritage/AuthPage");
  if (pathname.startsWith("/f/heritage/desk/submit")) return import("./heritage/HorseSubmissionPage");
  if (pathname.startsWith("/f/heritage/desk")) return import("./heritage/RegistryDeskPage");
  if (/^\/horse\/\d+$/.test(pathname)) return import("./heritage/ProfileWorkbench");
  return null;
}

function prefetchRouteChunk(pathname: string): void {
  const chunk = routeChunkForRoute(pathname);
  if (chunk) void chunk.catch(() => {});
  // Non-heritage skins load through the frontend registry; hovering a link
  // into /f/<skin>/... warms that skin's whole entry chunk the same way.
  const routedFrontend = parseFrontendLocalRoute(pathname)?.frontendId;
  if (routedFrontend && routedFrontend !== "heritage" && hasFrontend(routedFrontend)) {
    void loadFrontend(routedFrontend).catch(() => {});
  }
}

function App() {
  const { layout: navigationLayout, chrome: navigationChrome } = useNavigationLayout("heritage");
  const [route, setRoute] = useState(location.pathname);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authNotice, setAuthNotice] = useState<HeritageAuthNotice>(null);
  const [adminGuestMode,setAdminGuestMode]=useState(false);
  const csrfRef=useRef<string|null>(null);
  const [permissions, setPermissions] = useState<PlatformPermission[]>([]);
  const principalScope = principalScopeKey(user, permissions);
  // R158 (owner directive): theme customization is an operator tool — the
  // Appearance Studio and its entry points render only for admin-level staff
  // (content.manage is granted to admin/super_admin, never editor/owner/user).
  const appearanceAdmin = Boolean(user && permissions.includes("content.manage"));
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [platformMeta,setPlatformMeta]=useState<PlatformMetaResponse|null>(null);
  const [locale, setLocale] = useState<Locale>(storedLocale);
  useEffect(() => {
    const syncLocale = (event: StorageEvent) => {
      if (event.key === "registry-locale" || event.key === null) setLocale(storedLocale());
    };
    window.addEventListener("storage", syncLocale);
    return () => window.removeEventListener("storage", syncLocale);
  }, []);

  const tabHierarchy=useHeritageAppearanceValue(value=>value.tabHierarchy);
  const appearanceMode=useHeritageAppearanceValue(value=>value.mode);
  const parallaxVisualAssets=useHeritageVisualAssetsSnapshot();
  const parallaxSceneSource=resolveHeritageBackgroundSource(parallaxVisualAssets,appearanceMode);
  const parallaxBackgroundEngine=getResolvedHeritageBackgroundEngine(parallaxVisualAssets,appearanceMode);
  const [frontendId,setFrontendId]=useState<string>(()=>{const routed=parseFrontendLocalRoute(location.pathname)?.frontendId;const saved=safeStorageGet("registry-frontend")||"heritage";return routed&&hasFrontend(routed)?routed:(hasFrontend(saved)?saved:"heritage")});
  // R147: revocable records always refetch. Only explicitly cacheable public
  // newsroom responses may use the small in-memory cache; HTTP policy and
  // session/mutation changes are honored by the fetch-aware transport.
  const cachingTransport=useMemo(()=>createCachedFetchTransport(),[]);
  const platform=useMemo(()=>createPlatformClient({transport:cachingTransport.transport,aiStreamTransport:createFetchAiStreamTransport(),csrfToken:()=>csrfRef.current,onSessionChange:session=>{setSubmissionDraftPrincipal(session.user?.id??null);cachingTransport.clear();setUser(session.user);setPermissions([...session.permissions]);csrfRef.current=session.csrfToken;if(session.user){setAdminGuestMode(false);setAuthNotice(null)}}}),[cachingTransport]);
  useHeritageSceneParallax(frontendId==="heritage"&&parallaxBackgroundEngine==="flat"&&parallaxVisualAssets.backgroundParallax,parallaxSceneSource,parallaxVisualAssets.backgroundFocusY,parallaxVisualAssets.backgroundFitWidth);
  // Viewport changes resolve navigation at render time. They must not rewrite
  // the user's saved tab-hierarchy preference (especially on rotate/zoom).
  useEffect(()=>{
    document.documentElement.dataset.frontend=frontendId;
    document.documentElement.dataset.visualArchitecture="2";
    safeStorageSet("registry-frontend",frontendId);
  },[frontendId]);
  useEffect(() => {
    const effectiveLocale = frontendId === "heritage" ? locale : engineUiLocale(locale);
    document.documentElement.lang = effectiveLocale;
    document.documentElement.dir = isUiRtl(effectiveLocale) ? "rtl" : "ltr";
    document.documentElement.dataset.locale = locale;
    document.title = uiText(locale, "Equine Registry", "سامانه ثبت اسب");
    safeStorageSet("registry-locale", locale);
  }, [locale, frontendId]);
  // R162: the boot gate depends entirely on platform/meta. A single hung or
  // dropped request used to strand every /f/* deep link on "checking
  // compatibility…" forever with no retry and no recovery button. Each attempt
  // now carries its own AbortSignal (a signaled request bypasses the caching
  // transport's dedupe, so a stuck shared promise can never poison retries),
  // times out, and retries with bounded backoff until it lands.
  const [metaBootToken,setMetaBootToken]=useState(0);
  useEffect(() => {
    platform.auth.me().catch(()=>{});
    let live=true; let attempt=0; let timer:ReturnType<typeof setTimeout>|undefined; let current:AbortController|undefined;
    const attemptOnce=()=>{
      if(!live)return;
      current=new AbortController();
      const timeout=setTimeout(()=>current?.abort(),8000);
      platform.meta({signal:current.signal}).then(meta=>{
        clearTimeout(timeout);
        if(!live)return;
        setPlatformMeta(meta);
        if(meta.health)setHealth(meta.health);
        else platform.health().then(setHealth).catch(()=>{});
      }).catch(()=>{
        clearTimeout(timeout);
        if(!live)return;
        attempt+=1;
        timer=setTimeout(attemptOnce,Math.min(1500*attempt,3000));
      });
    };
    attemptOnce();
    return ()=>{live=false;if(timer)clearTimeout(timer);current?.abort();};
  }, [platform, metaBootToken]);
  useEffect(() => {
    // R42 hyper-optimization: once the shell is interactive and the browser is
    // idle, prefetch the two most-visited async route chunks (stats, newsroom).
    // First paint stays light; the first navigation to them is then instant
    // because the module is already in the HTTP cache. Connections that stay
    // slow/idle-starved simply skip this — no behavior depends on it.
    // R132: the same idle slot now also warms the DATA for the most likely
    // first navigations (newsroom list + first browse page) through the
    // caching transport, so the first click lands on a warm cache too.
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };
    const schedule = w.requestIdleCallback ?? ((cb: () => void, opts?: { timeout: number }) => setTimeout(cb, opts?.timeout ?? 1600) as unknown as number);
    const cancel = w.cancelIdleCallback ?? ((handle: number) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));
    const handle = schedule(() => {
      void import("./heritage/RegistryStatsPage"); void import("./heritage/NewsroomPage");
      // R134: the horse profile is the most-visited destination type (every
      // browse/search result click lands on it) — warm its chunk and the
      // competitions/directory chunks too, unless the visitor asked the
      // browser to save data.
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      if (!connection?.saveData) {
        void import("./heritage/ProfileWorkbench");
        void import("./heritage/CompetitionsPage");
        void import("./heritage/DirectoryPage");
      }
      for (const url of dataUrlsForRoute("/newsroom", locale)) cachingTransport.prefetch(url);
      for (const url of dataUrlsForRoute("/browse", locale)) cachingTransport.prefetch(url);
    }, { timeout: 2500 });
    return () => cancel(handle);
  }, [platform, locale, cachingTransport]);
  useEffect(() => {
    // R132 PERFORMANCE: hover/focus prefetch. When the pointer rests on an
    // internal link (or a row that navigates via data-href), the data for
    // that destination starts loading immediately — the ~150-400ms of hover
    // intent is enough to finish the request before the click. Prefetch is
    // best-effort: the caching transport already skips cached/in-flight URLs,
    // and failures are swallowed.
    const prefetchTarget = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (anchor) {
        const href = anchor.getAttribute("href") ?? "";
        if (href.startsWith("/") && !href.startsWith("//")) return href;
      }
      const navigable = target.closest("[data-href]") as HTMLElement | null;
      if (navigable) {
        const href = navigable.dataset.href ?? "";
        if (href.startsWith("/")) return href;
      }
      return null;
    };
    const prefetchFor = (target: EventTarget | null) => {
      const href = prefetchTarget(target);
      if (!href) return;
      const pathname = href.split("?", 1)[0] ?? href;
      prefetchRouteChunk(pathname);
      for (const url of dataUrlsForRoute(pathname, locale)) cachingTransport.prefetch(url);
    };
    const onOver = (event: PointerEvent) => prefetchFor(event.target);
    const onDown = (event: PointerEvent) => prefetchFor(event.target);
    const onFocus = (event: FocusEvent) => prefetchFor(event.target);
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("focusin", onFocus, { passive: true });
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocus);
    };
  }, [locale, cachingTransport]);
  useEffect(() => {
    const onPop = () => { const nextRoute=location.pathname;setRoute(nextRoute);const routed=parseFrontendLocalRoute(nextRoute)?.frontendId;if(routed&&hasFrontend(routed))setFrontendId(routed); };
    addEventListener("popstate", onPop); return () => removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const page = route.startsWith("/browse") ? "browse" : route.startsWith("/stats") ? "stats" : route.startsWith("/newsroom") ? "newsroom" : route.startsWith("/competitions") ? "events" : route.startsWith("/assistant") ? "assistant" : route.startsWith("/directory") ? "directory" : route.startsWith("/workspaces") ? "workspaces" : route.startsWith("/services") ? "services" : route.startsWith("/f/heritage/wallpaper") ? "wallpaper" : route.startsWith("/f/heritage/desk/submit") ? "desk-submit" : route.startsWith("/f/heritage/desk") ? "desk" : route.startsWith("/admin") ? "admin" : /^\/horse\/\d+$/.test(route) ? "profile" : "home";
    document.documentElement.dataset.page = page;
  }, [route]);
  const navigate = (path: string, options?: { preserveScroll?: boolean }) => { const top=scrollY;const routed=parseFrontendLocalRoute(path)?.frontendId;const hostOwned=path.startsWith("/admin")||path.startsWith("/newsroom")||path.startsWith("/assistant")||path.startsWith("/f/heritage/desk");if(hostOwned)setFrontendId("heritage");else if(routed&&hasFrontend(routed))setFrontendId(routed);history.pushState({}, "", path);setRoute(location.pathname);if(options?.preserveScroll){requestAnimationFrame(()=>scrollTo({top,behavior:"auto"}));}else scrollTo({top:0, behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"}); };

  const rawHorseMatch = route.match(/^\/horse\/(\d+)$/);
  const horseMatch = rawHorseMatch && isRegistryId(Number(rawHorseMatch[1])) ? rawHorseMatch : null;
  const rawPersonMatch = route.match(/^\/person\/(\d+)$/);
  const personMatch = rawPersonMatch && isRegistryId(Number(rawPersonMatch[1])) ? rawPersonMatch : null;
  const invalidEntityRoute = (route.startsWith("/horse/") && !horseMatch) || (route.startsWith("/person/") && !personMatch);
  const directoryPersonMatch = route.match(/^\/directory\/(\d+)$/);
  const directoryManageMatch = route.match(/^\/directory\/manage\/(\d+)$/);
  const organizationManageMatch = route.match(/^\/organizations\/manage\/(\d+)$/);
  const directoryClaims = route === "/directory/claims";
  const admin = route.startsWith("/admin");
  const browse = route.startsWith("/browse");
  const stats = route.startsWith("/stats");
  const market = route.startsWith("/market");
  const competitions = route.startsWith("/competitions");
  const directory = route.startsWith("/directory");
  const workspaces = route.startsWith("/workspaces");
  const serviceRequests = route.startsWith("/services");
  const authPage = route.startsWith("/login") || route.startsWith("/register");
  const newsroomStudio = route.startsWith("/newsroom/studio");
  const newsroom = route.startsWith("/newsroom");
  const assistant = route.startsWith("/assistant");
  const wallpaper = route.startsWith("/f/heritage/wallpaper");
  const deskSubmit = route.startsWith("/f/heritage/desk/submit");
  const desk = !deskSubmit && route.startsWith("/f/heritage/desk");
  const switchFrontend=(id:string)=>{const next=hasFrontend(id)?id:"heritage";const nextRoute=isCanonicalHorseDbRoute(route)?`${route}${route==="/browse"?location.search:""}`:"/";setFrontendId(next);history.pushState({},"",nextRoute);setRoute(location.pathname);scrollTo({top:0,behavior:"auto"})};
  const runtime:FrontendRuntimeProps={route,navigate,locale:engineUiLocale(locale),setLocale,user,permissions,health,platformMeta,platform,assets:SHARED_FRONTEND_ASSETS};
  const aiPageContext={route,...(horseMatch?{horseId:Number(horseMatch[1])}:{}),...(personMatch?{personId:Number(personMatch[1])}:{})};
  if(frontendId!=="heritage"){
    const manifest=getFrontendManifests().find(item=>item.id===frontendId);
    const compatibility=manifest?evaluateFrontendCompatibility(manifest,platformMeta):null;
    const ready=Boolean(platformMeta&&compatibility?.compatible);
    const failure=platformMeta&&compatibility&&!compatibility.compatible?compatibility.blockingIssues[0]?.message:null;
    return <I18nProvider locale={legacyUiLocale(locale)}><>{locale === "fr" && <p className="h122-locale-preview" lang={locale} dir={isUiRtl(locale) ? "rtl" : "ltr"}>{uiText(locale, "This design currently uses English. Return to Core for your selected language.", "این رابط فعلاً انگلیسی است.")}</p>}<DemoSessionPicker platform={platform} locale={legacyUiLocale(locale)} enabled={Boolean(platformMeta?.demoAdminLoginAvailable)} userId={user?.id??null}/>{ready?<ExternalFrontendHost key={`${frontendId}:${principalScope}`} frontendId={frontendId} runtime={runtime} onRecover={()=>switchFrontend("heritage")}/>:<main className="frontend-load-state"><strong>{failure?(uiText(locale, "Frontend incompatible.", "رابط کاربری ناسازگار است.")):(uiText(locale, "Checking frontend compatibility…", "در حال بررسی سازگاری رابط کاربری…"))}</strong>{failure&&<span>{failure}</span>}{failure?<button onClick={()=>switchFrontend("heritage")}>{uiText(locale, "Return to Heritage Registry", "بازگشت به سامانه ثبت اصلی")}</button>:<button onClick={()=>setMetaBootToken(value=>value+1)}>{uiText(locale, "Retry", "تلاش دوباره")}</button>}</main>}<AssistantLauncher key={principalScope} platform={platform} locale={legacyUiLocale(locale)} pageContext={aiPageContext} variant={frontendId==="classic-registry"?"classic-registry":"default"}/><FrontendSwitcher value={frontendId} onChange={switchFrontend} platformMeta={platformMeta}/></></I18nProvider>;
  }
  return <I18nProvider locale={locale}><HeritageMobileDockProvider route={route} navigate={navigate} enabled={tabHierarchy==="docked" && navigationLayout!=="sidebar"}><FrontendErrorBoundary frontendId="heritage" locale={locale} onRecover={()=>{history.replaceState({},"","/");location.reload()}}><div className="app-shell" data-core-area={market ? "market" : competitions ? "events" : workspaces ? "workspaces" : serviceRequests ? "services" : authPage ? "account" : newsroom ? "newsroom" : directory ? "directory" : admin ? "administration" : "registry"} data-navigation-layout={wallpaper ? "tabs" : navigationLayout} data-nav-both={!wallpaper && navigationChrome.sidebar && navigationChrome.tabs ? "1" : undefined}>
    <HeritageBackgroundStage visualAssets={parallaxVisualAssets} mode={appearanceMode} enabled={frontendId==="heritage"}/>
    <HeritageSurfaceEffectsBinder />
    <HeritageLightingOverlay />
    <DemoSessionPicker platform={platform} locale={legacyUiLocale(locale)} enabled={Boolean(platformMeta?.demoAdminLoginAvailable)} userId={user?.id??null}/>
    <HeritageHeader health={health} route={route} navigate={navigate} locale={locale} setLocale={setLocale} user={user} navigationLayout={navigationLayout} navigationTabs={navigationChrome.tabs} showAppearanceTools={appearanceAdmin} />
    <div className="h102-workspace">
      {navigationLayout==="sidebar" && !wallpaper && <HierarchicalNavigation route={route} locale={locale} navigate={navigate} showAppearanceTools={appearanceAdmin}/>}
      <div key={principalScope} className="h102-content" id="heritage-main-content" tabIndex={-1}>
    {locale === "fr" && <p className="h122-locale-preview" role="status">{uiText(locale, "Language preview: some advanced tools and other designs still use English. Registry names and original content are unchanged.", "پیش‌نمایش زبان: بعضی ابزارها هنوز انگلیسی هستند.")}</p>}
    {invalidEntityRoute ? <main className="page"><h1>{uiText(locale, "Record not found", "\u0631\u06a9\u0648\u0631\u062f \u06cc\u0627\u0641\u062a \u0646\u0634\u062f")}</h1><p>{uiText(locale, "This address does not contain a valid registry ID.", "\u0634\u0646\u0627\u0633\u0647 \u0631\u06a9\u0648\u0631\u062f \u0645\u0639\u062a\u0628\u0631 \u0646\u06cc\u0633\u062a.")}</p><button onClick={()=>navigate("/browse")}>{uiText(locale, "Browse horses", "\u0641\u0647\u0631\u0633\u062a \u0627\u0633\u0628\u200c\u0647\u0627")}</button></main> : horseMatch ? <HorsePage id={Number(horseMatch[1])} navigate={navigate} platform={platform} platformMeta={platformMeta} user={user} permissions={permissions} />
      : personMatch ? <PersonPage id={Number(personMatch[1])} navigate={navigate} platform={platform} />
      : admin ? <AdminPage user={user} health={health} navigate={navigate} platform={platform} permissions={permissions} guestMode={adminGuestMode} setGuestMode={setAdminGuestMode} demoAdminAvailable={Boolean(platformMeta?.demoAdminLoginAvailable)} />
      : <React.Suspense fallback={<main className="page route-chunk-loading" aria-busy="true" aria-label="Loading" />}>
      {stats ? <RegistryStatsPage platform={platform} navigate={navigate} />
      : market ? <HeritageMarketplacePage navigate={navigate} platform={platform} user={user} />
      : competitions ? <HeritageCompetitionsPage navigate={navigate} platform={platform} initialId={Number(new URLSearchParams(location.search).get("id")) || undefined} />
      : directoryManageMatch ? <HeritageProfileWorkbench personId={Number(directoryManageMatch[1])} platform={platform} />
      : organizationManageMatch ? <HeritageOrganizationWorkbench organizationId={Number(organizationManageMatch[1])} platform={platform} user={user} scope={principalScope} />
      : directoryClaims ? <HeritageProfileWorkbench personId={null} platform={platform} />
      : directoryPersonMatch ? <HeritageDirectoryPersonPage navigate={navigate} platform={platform} user={user} permissions={permissions} personId={Number(directoryPersonMatch[1])} />
      : directory ? <HeritageDirectoryPage navigate={navigate} platform={platform} />
      : workspaces ? <HeritageWorkspacesPage key={user?.id ?? "anonymous"} navigate={navigate} platform={platform} user={user} />
      : serviceRequests ? <HeritageServiceRequestsPage platform={platform} user={user} permissions={permissions} route={route} navigate={navigate} />
      : authPage ? <HeritageAuthPage platform={platform} user={user} navigate={navigate} authNotice={authNotice} setAuthNotice={setAuthNotice} />
      : newsroomStudio ? <HeritageEditorialStudioPage platform={platform} platformMeta={platformMeta} user={user} permissions={permissions} navigate={navigate} />
      : newsroom ? <HeritageNewsroomPage platform={platform} platformMeta={platformMeta} user={user} permissions={permissions} navigate={navigate} />
      : assistant ? <HeritageAssistantPage platform={platform} />
      : wallpaper ? <WallpaperView navigate={navigate} />
      : deskSubmit ? <HorseSubmissionPage platform={platform} platformMeta={platformMeta} user={user} permissions={permissions} navigate={navigate} />
      : desk ? <RegistryDeskPage platform={platform} platformMeta={platformMeta} user={user} permissions={permissions} navigate={navigate} />
      : browse ? <BrowsePage navigate={navigate} health={health} platform={platform} platformMeta={platformMeta} user={user} permissions={permissions} />
      : <SearchPage navigate={navigate} health={health} platform={platform} />}
      </React.Suspense>}
      </div>
    </div>
    {!wallpaper&&<Footer health={health} />}
    <AssistantLauncher key={principalScope} platform={platform} locale={legacyUiLocale(locale)} pageContext={aiPageContext} variant="heritage"/>
    {!wallpaper&&<FrontendSwitcher value={frontendId} onChange={switchFrontend} platformMeta={platformMeta}/>}
  </div></FrontendErrorBoundary></HeritageMobileDockProvider></I18nProvider>;
}


function HeritageAssistantPage({platform}:{platform:PlatformClient}) {
  const {locale}=useI18n();
  return <main className="page heritage-ai-page heritage-ai-page--chat-only">
    <section className="welcome-workspace heritage-ai-workspace" data-h-surface-role="major" aria-label={uiText(locale, "Research chat", "گفت‌وگوی پژوهشی")}>
      <React.Suspense fallback={<main className="page route-chunk-loading" aria-busy="true" aria-label="Loading"/>}><AssistantPanel platform={platform} locale={legacyUiLocale(locale)} fullPage pageContext={{route:"/assistant"}} variant="heritage"/></React.Suspense>
    </section>
  </main>;
}

function WallpaperView({navigate}:{navigate:(path:string)=>void}) {
  const {locale}=useI18n();
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();navigate("/");}};
    addEventListener("keydown",onKey);return()=>removeEventListener("keydown",onKey);
  },[navigate]);
  return <main className="wallpaper-view" aria-label={uiText(locale, "Wallpaper presentation view", "نمای پس‌زمینه")}>
    <span className="wallpaper-view-a11y">{uiText(locale, "Choose any top navigation tab or press Escape to leave wallpaper view.", "برای خروج از نمای پس‌زمینه یکی از تب‌های بالا را انتخاب کنید یا کلید Escape را بزنید.")}</span>
  </main>;
}

function Footer({health}:{health:HealthResponse|null}) {
  const {t,n}=useI18n();
  // R115: the demo-workbench and business-model destinations moved into the
  // "Explore the demo" section of the More panel (shared navigation.ts) — the
  // footer keeps only the brand ornament and record count.
  return <footer className="site-footer">
    <div className="footer-rule"><img className="footer-ornament" src={HERITAGE_DECORATION.divider} alt=""/></div>
    <div className="footer-copy"><span>{t("brand.name")}</span><small>{health?.horses ? `${n(health.horses)} ${t("nav.records")} · ${t("brand.sub")}` : t("footer.platform")}</small></div>
  </footer>;
}

function SearchPage({navigate,health,platform}:{navigate:(p:string)=>void;health:HealthResponse|null;platform:PlatformClient}) {
  const {t,n,year,locale}=useI18n();
  const L=(en:string,fa:string)=>uiText(locale, en, fa);
  const [q,setQ]=useState(""); const [suggestions,setSuggestions]=useState<Horse[]>([]); const [loading,setLoading]=useState(false); const [error,setError]=useState("");
  const [registryAnalytics,setRegistryAnalytics]=useState<RegistryAnalyticsResponse|null>(null);
  const visualAssets=useHeritageVisualAssetsSnapshot();
  const [splashPickerOpen,setSplashPickerOpen]=useState(false);
  const [particleHorseCameraOrbit,setParticleHorseCameraOrbit]=useState(-0.18);
  const splashOptions=HERITAGE_SPLASH_ART_OPTIONS.filter(option=>option.id!=="custom"||Boolean(visualAssets.customSplash));
  const splashIndex=Math.max(0,splashOptions.findIndex(option=>option.id===visualAssets.splashArt));
  const selectedSplashOption=splashOptions[splashIndex]??splashOptions[0];
  const cycleSplash=(direction:-1|1)=>{const next=splashOptions[(splashIndex+direction+splashOptions.length)%splashOptions.length];if(next)setHeritageVisualAssets({splashArt:next.id});};
  const inputRef=useRef<HTMLInputElement>(null);
  const submitSearch=(query=q)=>{const value=query.trim();if(value.length<2){inputRef.current?.focus();return;}navigate(`/browse?q=${encodeURIComponent(value)}`)};
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();inputRef.current?.focus();inputRef.current?.select();}
      if(event.key==="Escape"&&document.activeElement===inputRef.current){setQ("");setSuggestions([]);}
    };
    addEventListener("keydown",onKey);return()=>removeEventListener("keydown",onKey);
  },[]);
  useEffect(()=>{let live=true;platform.analytics.registry().then(value=>{if(live)setRegistryAnalytics(value)}).catch(()=>{});return()=>{live=false}},[platform]);
  useEffect(()=>{
    const query=q.trim(); if(query.length<2){setSuggestions([]);setLoading(false);setError("");return;}
    const controller=new AbortController();
    const timer=setTimeout(async()=>{setLoading(true);setError("");try{const d=await platform.search.horses(query,{limit:6,signal:controller.signal});setSuggestions(d.results as Horse[])}catch(e){if((e as Error).name!=="AbortError")setError((e as Error).message)}finally{if(!controller.signal.aborted)setLoading(false)}},150);
    return()=>{clearTimeout(timer);controller.abort()};
  },[q,platform]);
  return <main className="home-page">
    {health && health.dataMode!=="client" && <div className={`data-state ${health?.dataMode??"empty"}`}>
      <strong>{health?.dataMode==="demo" ? L("Demo dataset is loaded, not the client registry.","مجموعه‌داده آزمایشی بارگذاری شده است، نه سامانه ثبت اصلی.") : L("Registry data is not loaded.","داده‌های سامانه ثبت بارگذاری نشده‌اند.")}</strong>
      <span>{health?.dataMode==="demo" ? `${n(health.horses)} ${L("synthetic records are currently connected.","رکورد آزمایشی اکنون متصل است.")}` : L("Load the client workbook into the local registry database before evaluating search.","پیش از ارزیابی جست‌وجو، فایل اصلی سامانه ثبت را در پایگاه‌داده محلی بارگذاری کنید.")}</span>
    </div>}
    <section className="hero premium-hero" data-h-surface-role="major">
      <div className="hero-scene" aria-hidden="true"></div>
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-rule"></span>{t("hero.eyebrow")}</div>
        <h1><span className="hero-title-line">{t("hero.title1")}</span><em className="hero-title-line hero-title-accent">{t("hero.title2")}</em></h1>
        <p className="hero-lede">{t("hero.lede")}</p>
        <div className={`hero-search-stack${q.trim().length>=2?" has-suggestions":""}`}>
          <form className={`search-wrap premium-search hero-search-form ${loading?"is-loading":""}`} onSubmit={e=>{e.preventDefault();submitSearch()}}>
            <span className="search-icon"><SearchIcon/></span>
            <input dir="auto" ref={inputRef} autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} aria-controls={q.trim().length>=2?"home-search-suggestions":undefined} />
            <button type="submit" className="hero-search-submit" aria-label={t("search.submit")} disabled={q.trim().length<2}><span><SearchIcon size={16}/></span><b>{t("search.submit")}</b></button>
          </form>
          {q.trim().length>=2&&<div className="home-search-suggestions" id="home-search-suggestions">
            <div className="suggestion-head"><span>{loading?t("results.searching"):t("search.quick")}</span><button type="button" onClick={()=>submitSearch()}>{t("search.viewAll")} →</button></div>
            {!loading&&error&&<div className="suggestion-state error">{error}</div>}
            {!loading&&!error&&suggestions.length===0&&<div className="suggestion-state">{t("results.none")}</div>}
            {suggestions.slice(0,4).map(h=><button type="button" key={h.id} className="quick-match" onClick={()=>navigate(`/horse/${h.id}`)}><span><strong dir="auto">{primaryHorseName(h,locale)}</strong>{secondaryHorseName(h,locale)&&<small dir="auto">{secondaryHorseName(h,locale)}</small>}</span><em>#{n(h.id)}{h.birth_year?` · ${year(h.birth_year)}`:""}</em></button>)}
          </div>}
          <div className="search-hints">
            <div className="search-hint-chips">
              <span>{t("search.try")}</span>
              <button type="button" onClick={()=>setQ("chabock")}>chabock</button>
              <button type="button" onClick={()=>setQ("arabian 2000")}>arabian 2000</button>
              <button type="button" onClick={()=>navigate("/browse")} className="browse-inline">{t("search.browse")} <b>↗</b></button>
            </div>
            <span className="key-hint">{t("search.keyhint")}</span>
          </div>
        </div>
        <div className="registry-metrics">
          <div><strong>{health?.horses!=null ? n(health.horses) : "—"}</strong><span>{t("metric.horses")}</span></div>
          <div><strong>{health?.searchRows!=null ? n(health.searchRows) : "—"}</strong><span>{t("metric.indexed")}</span></div>
          <div><strong>{t("metric.liveValue")}</strong><span>{t("metric.live")}</span></div>
        </div>
      </div>
      <div className={`hero-art hero-art-${visualAssets.splashArt}`}>
        <button className="hero-art-arrow hero-art-prev" type="button" onClick={()=>cycleSplash(-1)} aria-label={uiText(locale, "Previous emblem", "نشان قبلی")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5 7.5 12l7 7"/></svg></button>
        <div className={`hero-crest-frame${selectedSplashOption?.renderMode==="particle-horse"?" hero-crest-frame-particles":""}`}>
          {selectedSplashOption?.renderMode==="particle-horse"
            ? <React.Suspense fallback={<div className="particle-horse-loading" aria-hidden="true"/>}><ParticleHorseSplash locale={locale} cameraOrbit={particleHorseCameraOrbit}/></React.Suspense>
            : <img className={`hero-crest hero-crest-${visualAssets.splashArt}`} src={resolveHeritageSplashSource(visualAssets)} alt=""/>}
        </div>
        <button className="hero-art-arrow hero-art-next" type="button" onClick={()=>cycleSplash(1)} aria-label={uiText(locale, "Next emblem", "نشان بعدی")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7"/></svg></button>
        <button type="button" className="hero-art-browser" aria-expanded={splashPickerOpen} aria-controls="hero-art-picker" onClick={()=>setSplashPickerOpen(open=>!open)} title={uiText(locale, "Browse all splash artwork", "مشاهده همه نشان‌ها")}><span>{uiText(locale, "Artwork", "نشان‌ها")}</span><strong>{n(splashIndex+1)} / {n(splashOptions.length)}</strong><b aria-hidden="true">▦</b></button>
        {splashPickerOpen&&<div className="hero-art-picker" id="hero-art-picker" role="dialog" aria-modal="false" aria-label={uiText(locale, "Choose splash artwork", "انتخاب نشان خوش‌آمدگویی")}>
          <div className="hero-art-picker-head"><div><strong>{uiText(locale, "Splash artwork", "نشان خوش‌آمدگویی")}</strong><small>{locale==="fa"?`${n(splashOptions.length)} نشان در کتابخانه`:`${n(splashOptions.length)} artworks in the library`}</small></div><button type="button" onClick={()=>setSplashPickerOpen(false)} aria-label={uiText(locale, "Close", "بستن")}>×</button></div>
          <div className="hero-art-picker-grid">{splashOptions.map(option=>{const source=option.id==="custom"?visualAssets.customSplash:option.source;const kinetic=option.renderMode==="particle-horse";const label=locale==="fa"?(option.labelFa??option.label):option.label;return <button type="button" key={option.id} className={visualAssets.splashArt===option.id?"active":""} aria-pressed={visualAssets.splashArt===option.id} title={label} onClick={()=>{setHeritageVisualAssets({splashArt:option.id});setSplashPickerOpen(false)}}>{kinetic?<span className="particle-horse-mini" aria-hidden="true"/>:source?<img src={source} alt=""/>:<span>+</span>}<small>{label}</small></button>})}</div>
        </div>}
        {selectedSplashOption?.renderMode==="particle-horse"&&<div className="hero-particle-camera-controls" aria-label={uiText(locale, "Particle horse camera control", "کنترل نمای اسب ذره‌ای")}><div className="hero-particle-camera-row"><input type="range" min={-100} max={100} step={1} value={Math.round(particleHorseCameraOrbit*100)} aria-label={uiText(locale, "Rotate camera", "چرخش دوربین")} title={uiText(locale, "Rotate camera around the horse", "چرخش دوربین اطراف اسب")} onChange={event=>setParticleHorseCameraOrbit(Number(event.currentTarget.value)/100)}/></div></div>}
        <div className="hero-art-pager hero-art-pager-compact" aria-hidden="true">{splashOptions.length<=9?splashOptions.map(option=><i key={option.id} className={visualAssets.splashArt===option.id?"active":""}/>):<><i/><i/><i className="active"/><i/><i/></>}</div>
      </div>
    </section>
    {registryAnalytics&&<RegistryPulse analytics={registryAnalytics} navigate={navigate}/>}
    <section className="results-section welcome-workspace" data-h-surface-role="major">
      <div className="welcome-summary-card workspace-summary-card">
        <div className="welcome-summary-copy">
          <span className="section-kicker">{t("results.workspace")}</span>
          <h2>{t("results.bloodline")}</h2>
          <p className="workspace-sub">{t("results.workspaceSub")}</p>
        </div>
      </div>
      <FeatureGrid navigate={navigate} />
    </section>
  </main>;
}

function FeatureGrid({navigate}:{navigate:(p:string)=>void}){
  const {t}=useI18n();
  return <div className="feature-grid premium-features">
    <button className="feature-card feature-search" onClick={()=>document.querySelector<HTMLInputElement>('.premium-search input')?.focus()}><span className="feature-no">01</span><div className="feature-icon"><SearchIcon size={16}/></div><h3>{t("feature.search.title")}</h3><p>{t("feature.search.body")}</p><b>{t("feature.search.cta")} →</b></button>
    <button className="feature-card feature-table" onClick={()=>navigate('/browse')}><span className="feature-no">02</span><div className="feature-icon"><RegistryIcon size={16}/></div><h3>{t("feature.table.title")}</h3><p>{t("feature.table.body")}</p><b>{t("feature.table.cta")} →</b></button>
    <article className="feature-card feature-pedigree"><span className="feature-no">03</span><div className="feature-icon pedigree-mini"><PedigreeIcon size={17}/></div><h3>{t("feature.pedigree.title")}</h3><p>{t("feature.pedigree.body")}</p><b>{t("feature.pedigree.cta")} →</b></article>
    <article className="welcome-summary-card heritage-art-summary">
      <span className="heritage-art-copy">{t("feature.art").split("\n").map((line,i)=><React.Fragment key={`${line}-${i}`}>{i>0&&<br/>}{line}</React.Fragment>)}</span>
      <img src={HERITAGE_DECORATION.divider} alt=""/>
    </article>
  </div>
}

function BrowsePage({navigate,health,platform,platformMeta,user,permissions}:{navigate:(p:string)=>void;health:HealthResponse|null;platform:PlatformClient;platformMeta:PlatformMetaResponse|null;user:PlatformUser|null;permissions:PlatformPermission[]}) {
  const {t,n,year,locale}=useI18n();
  // D14: complete registry query state round-trips through the typed frontend-kit URL contract.
  const initialUrl=useMemo(()=>parseRegistryUrlState(location.search),[]);
  const [data,setData]=useState<BrowseResponse|null>(null);
  // R135 infinite scroll: rendered rows accumulate across page fetches. `data`
  // keeps the LAST fetched page (total/limit/nextOffset bookkeeping); `rows`
  // is what the table and the phone cards actually render.
  const [rows,setRows]=useState<Horse[]>([]);
  const registryQueryKeyRef=useRef("");
  const [facets,setFacets]=useState<RegistryFacetsResponse|null>(null);
  const [facetBreed,setFacetBreed]=useState(()=>initialUrl.breed);
  const [facetSex,setFacetSex]=useState(()=>initialUrl.sex);
  const [facetLifecycle,setFacetLifecycle]=useState(()=>initialUrl.lifecycle);
  const [facetDecade,setFacetDecade]=useState(()=>initialUrl.decade);
  const [facetColor,setFacetColor]=useState(()=>initialUrl.color);
  const [facetStrain,setFacetStrain]=useState(()=>initialUrl.mainStrain);
  const [facetImportedFrom,setFacetImportedFrom]=useState(()=>initialUrl.importedFrom);
  const [facetFlag,setFacetFlag]=useState<RegistryUrlState["flag"]>(()=>initialUrl.flag);
  const [filter,setFilter]=useState(initialUrl.q);
  const [appliedFilter,setAppliedFilter]=useState(initialUrl.q);
  const [sort,setSort]=useState<RegistrySort>(initialUrl.sort);
  const [dir,setDir]=useState<RegistrySortDirection>(initialUrl.dir);
  const [offset,setOffset]=useState(initialUrl.offset);
  const [queryMode,setQueryMode]=useState<RegistryUrlState["mode"]>(initialUrl.mode);
  // R56: the density (Compact/Roomy) toggle left the browse toolbar (it did nothing meaningful).
  const [mobileRegistryView,setMobileRegistryView]=useState<"detail"|"compact">(()=>safeStorageGet("registry-mobile-view-mode")==="compact"?"compact":"detail");
  const [visualEncoding,setVisualEncoding]=useState(readVisualEncoding);
  useEffect(()=>onVisualEncodingChange(setVisualEncoding),[]);
    // R157: storage key bumped to -v2 so the new aka (secondary name) column
  // adopts its own-column default for returning visitors too.
  const [visibleColumns,setVisibleColumns]=useState<Set<RegistryOptionalColumn>>(()=>{try{const raw=safeStorageGet("registry-columns-v2");const parsed=raw?JSON.parse(raw):REGISTRY_DEFAULT_VISIBLE_COLUMNS;return new Set((parsed as RegistryOptionalColumn[]).filter(x=>REGISTRY_OPTIONAL_COLUMNS.includes(x)))}catch{return new Set(REGISTRY_DEFAULT_VISIBLE_COLUMNS)}});
  const [columnsOpen,setColumnsOpen]=useState(false);
  const [advancedOpen,setAdvancedOpen]=useState(false);
  const [advanced,setAdvanced]=useState<AdvancedRegistrySearch>(()=>({...initialUrl.advanced}));
  const [appliedAdvanced,setAppliedAdvanced]=useState<AdvancedRegistrySearch>(()=>({...initialUrl.advanced}));
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const fieldAdvancedActive=hasAdvancedRegistrySearch(advanced);
  const appliedAdvancedActive=hasAdvancedRegistrySearch(appliedAdvanced);
  const facetsActive=Boolean(facetBreed||facetSex||facetLifecycle||facetDecade||facetColor||facetStrain||facetImportedFrom||facetFlag);
  const advancedActive=fieldAdvancedActive||facetsActive;
  const advancedFilterCount=Object.values(advanced).filter(Boolean).length+[facetBreed,facetSex,facetLifecycle,facetDecade,facetColor,facetStrain,facetImportedFrom,facetFlag].filter(Boolean).length;
  const smartMode=queryMode==="registry"?false:(!appliedAdvancedActive&&!facetsActive&&appliedFilter.trim().length>=2);
  const registryParams=useMemo<Omit<RegistryBrowseParams,"limit"|"offset">>(()=>{const decade=facetDecade?Number(facetDecade):null;const advancedParams=advancedRegistryParams(appliedAdvanced);const definedAdvanced=Object.fromEntries(Object.entries(advancedParams).filter(([,value])=>value!==undefined)) as Partial<RegistryBrowseParams>;return {sort,dir,lang:locale,q:appliedFilter||undefined,breed:facetBreed||undefined,sex:facetSex||undefined,lifecycle:facetLifecycle||undefined,color:facetColor||undefined,mainStrain:facetStrain||undefined,importedFrom:facetImportedFrom||undefined,isImported:facetFlag==="imported"||undefined,isSport:facetFlag==="sport"||undefined,isStallion:facetFlag==="stallion"||undefined,hasSportCard:facetFlag==="sport_card"||undefined,yearFrom:decade??undefined,yearTo:decade!=null?decade+9:undefined,...definedAdvanced}},[sort,dir,locale,appliedFilter,appliedAdvanced,facetBreed,facetSex,facetLifecycle,facetDecade,facetColor,facetStrain,facetImportedFrom,facetFlag]);
  const csvExport=platform.exports.registry(registryParams,"csv");
  const jsonExport=platform.exports.registry(registryParams,"json");
  useEffect(()=>{const onPop=()=>{registryQueryKeyRef.current="";const next=parseRegistryUrlState(location.search);setFilter(next.q);setAppliedFilter(next.q);setAdvanced({...next.advanced});setAppliedAdvanced({...next.advanced});setFacetBreed(next.breed);setFacetSex(next.sex);setFacetLifecycle(next.lifecycle);setFacetColor(next.color);setFacetStrain(next.mainStrain);setFacetImportedFrom(next.importedFrom);setFacetDecade(next.decade);setFacetFlag(next.flag);setSort(next.sort);setDir(next.dir);setOffset(next.offset);setQueryMode(next.mode)};addEventListener("popstate",onPop);return()=>removeEventListener("popstate",onPop)},[]);
  // R40: the advanced panel is a temporary side rail — Escape always dismisses it.
  useEffect(()=>{if(!advancedOpen)return;const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setAdvancedOpen(false)};addEventListener("keydown",onKey);return()=>removeEventListener("keydown",onKey)},[advancedOpen]);
  useEffect(()=>{if(!advancedOpen||facets)return;const controller=new AbortController();platform.registry.facets({signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setFacets(result)}).catch(()=>{});return()=>controller.abort();},[advancedOpen,facets,platform]);
  // Restored URL state is already applied. Only an actual draft edit resets its page.
  useEffect(()=>{if(filter.trim()===appliedFilter)return;const timer=setTimeout(()=>{setOffset(0);setAppliedFilter(filter.trim())},180);return()=>clearTimeout(timer)},[filter,appliedFilter]);
  useEffect(()=>{if((Object.keys(EMPTY_ADVANCED_REGISTRY_SEARCH) as Array<keyof AdvancedRegistrySearch>).every(key=>advanced[key]===appliedAdvanced[key]))return;const timer=setTimeout(()=>{setOffset(0);setAppliedAdvanced({...advanced})},180);return()=>clearTimeout(timer)},[advanced,appliedAdvanced]);
  useEffect(()=>{
    // Full structured query state (q, advanced/facet filters, sort, dir, offset, query mode)
    // round-trips through the typed URL contract; visual preferences stay local-only.
    const next=serializeRegistryUrlState({
      q:appliedFilter,advanced:appliedAdvanced,breed:facetBreed,sex:facetSex,lifecycle:facetLifecycle,color:facetColor,
      mainStrain:facetStrain,importedFrom:facetImportedFrom,decade:facetDecade,flag:facetFlag,sort,dir,offset,
      mode:appliedFilter.trim()?(smartMode?"smart":"registry"):null,
    });
    if(`${location.pathname}${location.search}`!==next)history.replaceState({},"",next);
  },[appliedFilter,appliedAdvanced,facetBreed,facetSex,facetLifecycle,facetColor,facetStrain,facetImportedFrom,facetDecade,facetFlag,sort,dir,offset,smartMode]);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError("");
    // R135 infinite scroll: a fetch either REPLACES the accumulated rows (new
    // query) or APPENDS the next page (same query, larger offset). The query
    // key is cleared by popstate so back/forward always replaces.
    const queryKey=smartMode?`smart:${appliedFilter}`:JSON.stringify({f:appliedFilter,p:registryParams});
    const isNextPage=offset>0&&registryQueryKeyRef.current===queryKey;
    registryQueryKeyRef.current=queryKey;
    setAppending(isNextPage);
    const absorb=(next:BrowseResponse)=>{
      if(controller.signal.aborted)return;
      setData(next);
      setRows(previous=>{
        if(!isNextPage)return next.rows;
        const seen=new Set(previous.map(row=>row.id));
        const fresh=next.rows.filter(row=>!seen.has(row.id));
        return fresh.length?[...previous,...fresh]:previous;
      });
    };
    if(smartMode){
      platform.search.horses(appliedFilter,{limit:50,signal:controller.signal}).then(result=>{if(!controller.signal.aborted){const list=result.results as Horse[];setData({rows:list,total:list.length,limit:50,offset:0,nextOffset:null,previousOffset:null,sort:"relevance",dir:"desc",filter:appliedFilter});setRows(list)}}).catch(e=>{if(!controller.signal.aborted&&(e as Error).name!=="AbortError")setError((e as Error).message)}).finally(()=>{if(!controller.signal.aborted){setLoading(false);setAppending(false)}});
    }else{
      platform.registry.browse({...registryParams,limit:50,offset},{signal:controller.signal}).then(result=>{absorb(result as BrowseResponse)}).catch(e=>{if(!controller.signal.aborted&&(e as Error).name!=="AbortError")setError((e as Error).message)}).finally(()=>{if(!controller.signal.aborted){setLoading(false);setAppending(false)}});
    }
    return()=>controller.abort();
  },[offset,appliedFilter,smartMode,registryParams,platform]);
  // R135 infinite scroll: keep loading the next page as the reader reaches the
  // bottom (sentinel + IntersectionObserver, one subscription for the lifetime
  // of the page). The visible "Load more" button stays as the keyboard/AT path.
  const loadMoreRef=useRef<()=>void>(()=>{});
  useEffect(()=>{
    if(typeof IntersectionObserver==="undefined")return;
    const io=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))loadMoreRef.current()},{rootMargin:"700px 0px 700px 0px"});
    for(const node of document.querySelectorAll(".registry-load-more-sentinel"))io.observe(node);
    // Sentinels re-render with the list; re-scan cheaply on DOM growth.
    const mo=new MutationObserver(()=>{for(const node of document.querySelectorAll(".registry-load-more-sentinel:not([data-io-bound])")){node.setAttribute("data-io-bound","1");io.observe(node)}});
    mo.observe(document.body,{childList:true,subtree:true});
    return()=>{io.disconnect();mo.disconnect()};
  },[]);
  useEffect(()=>{safeStorageSet("registry-columns-v2",JSON.stringify([...visibleColumns]))},[visibleColumns]);
  useEffect(()=>{safeStorageSet("registry-mobile-view-mode",mobileRegistryView)},[mobileRegistryView]);
  const toggleColumn=(column:RegistryOptionalColumn)=>setVisibleColumns(current=>{const next=new Set(current);if(next.has(column))next.delete(column);else next.add(column);return next});
  // R56: the Columns popover renders through a portal to document.body so it
  // escapes the glass surface stacking contexts (toolbar/subbar both z-index 2
  // with backdrop-filter) that used to paint OVER the inline popover.
  const columnsButtonRef=useRef<HTMLButtonElement|null>(null);
  const columnsPanelRef=useRef<HTMLDivElement>(null);
  const [columnsPopoverPos,setColumnsPopoverPos]=useState<{top:number;insetInlineEnd:number}|null>(null);
  useEffect(()=>{
    if(!columnsOpen){setColumnsPopoverPos(null);return}
    const measure=()=>{const button=columnsButtonRef.current;if(!button)return;const rect=button.getBoundingClientRect();const doc=document.documentElement;const isRtl=doc.dir==="rtl";const insetInlineEnd=isRtl?rect.left:Math.max(12,window.innerWidth-rect.right);setColumnsPopoverPos({top:rect.bottom+7,insetInlineEnd:Math.max(12,insetInlineEnd)})};
    measure();
    columnsPanelRef.current?.querySelector<HTMLInputElement>("input")?.focus({preventScroll:true});
    const onDocPointer=(e:PointerEvent)=>{if(!columnsPanelRef.current?.contains(e.target as Node)&&!columnsButtonRef.current?.contains(e.target as Node))setColumnsOpen(false)};
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape"){setColumnsOpen(false);columnsButtonRef.current?.focus({preventScroll:true})}};
    const onScroll=(e:Event)=>{if(!(e.target instanceof Node && columnsPanelRef.current?.contains(e.target)))measure()};
    window.addEventListener("resize",measure);window.addEventListener("scroll",onScroll,{capture:true,passive:true});
    document.addEventListener("pointerdown",onDocPointer,true);document.addEventListener("keydown",onKey,true);
    return()=>{window.removeEventListener("resize",measure);window.removeEventListener("scroll",onScroll,true);document.removeEventListener("pointerdown",onDocPointer,true);document.removeEventListener("keydown",onKey,true)};
  },[columnsOpen]);
  const apply=(e:React.FormEvent)=>{e.preventDefault();setOffset(0);setAppliedFilter(filter.trim())};
  const setSorting=(next:RegistrySort)=>{if(smartMode)return;if(sort===next)setDir(dir==="asc"?"desc":"asc");else{setSort(next);setDir("asc")}setOffset(0)};
  // R135: importance/significance first (champions, foundation sires, sport
  // records), then the reader-friendly orders. Each choice carries its natural
  // direction so the first click is never a surprise empty-feeling tail.
  const applySortChoice=(next:RegistrySort)=>{if(smartMode)return;setSort(next);setDir(next==="importance"||next==="year"?"desc":"asc");setOffset(0)};
  const canLoadMore=!smartMode&&!loading&&Array.isArray(data?.rows)&&(data?.rows.length??0)>0&&data?.nextOffset!=null&&rows.length<(data?.total??Infinity);
  const loadMore=useCallback(()=>{if(!canLoadMore||loading)return;setOffset(data?.nextOffset??offset)},[canLoadMore,loading,data?.nextOffset,offset]);
  useEffect(()=>{loadMoreRef.current=loadMore},[loadMore]);
  const [appending,setAppending]=useState(false);
  const updateAdvanced=(key:keyof AdvancedRegistrySearch,value:string)=>{setAdvanced(current=>({...current,[key]:value}));setOffset(0)};
  const clearAdvanced=()=>{setAdvanced({...EMPTY_ADVANCED_REGISTRY_SEARCH});setOffset(0)};
  const clearFacets=()=>{setFacetBreed("");setFacetSex("");setFacetLifecycle("");setFacetDecade("");setFacetColor("");setFacetStrain("");setFacetImportedFrom("");setFacetFlag("");setOffset(0)};
  const sortLabel=(key:RegistrySort,label:string)=>smartMode?<span className="table-sort static">{label}</span>:<button className="table-sort" onClick={()=>setSorting(key)}>{label}{sort===key?<span>{dir==="asc"?" ↑":" ↓"}</span>:null}</button>;
  return <main className="browse-page">
    <section className="browse-head premium-page-head" data-h-surface-role="major">
      <div><div className="eyebrow"><span className="eyebrow-rule"></span>{t("browse.eyebrow")}</div><h1>{t("browse.title")}</h1><p>{t("browse.lede")}</p></div>
      {/* R135 phone-first head: the advanced-search chip and the sort picker
          live in the title row itself (small, low-key), so the toolbar below
          spends no vertical space on chrome the list does not need. */}
      <div className="browse-head-tools">
        <button className={`ghost registry-toolbar-control advanced-toggle${advancedOpen?" active":""}${advancedActive?" has-filters":""}`} type="button" aria-pressed={advancedOpen} onClick={()=>setAdvancedOpen(v=>!v)} title={uiText(locale, "Advanced search: register number, owner, sire, dam and more open in a side rail; close with Esc or clicking outside.", "جست‌وجوی پیشرفته: شماره ثبت، مالک، پدر و مادر و… در یک نوار کناری باز می‌شود؛ با Esc یا کلیک بیرون بسته می‌شود.")}><span className="registry-toolbar-icon" aria-hidden="true">⌁</span><span className="advanced-toggle-label">{t("advanced.toggle")}</span>{advancedActive?<span className="advanced-count">{advancedFilterCount}</span>:null}</button>
        {!smartMode&&<label className="browse-sort-picker" title={uiText(locale,"Order the list by significance, name, year or record number.","ترتیب فهرست بر اساس اهمیت، نام، سال یا شماره رکورد.")}>
          <span className="registry-toolbar-icon" aria-hidden="true">⇅</span>
          <select aria-label={t("browse.sort")} value={sort} onChange={event=>applySortChoice(event.target.value as RegistrySort)}>
            <option value="importance">{t("sort.importance")}</option>
            <option value="name">{t("col.horse")}</option>
            <option value="year">{t("col.year")}</option>
            <option value="id">{t("col.id")}</option>
          </select>
        </label>}
        {smartMode&&<span className="relevance-badge">{t("browse.relevance")}</span>}
      </div>
      <div className="browse-count"><small>{smartMode?t("browse.smartResults"):t("browse.visible")}</small><strong>{n(data?.total??health?.horses??0)}</strong><span>{smartMode?t("browse.bestMatches"):t("browse.horses")}</span></div>
      <img className="page-head-ornament" src={HERITAGE_DECORATION.divider} alt=""/>
    </section>
    {health && health.dataMode!=="client"&&<div className="data-state demo"><strong>{health.dataMode==="empty"?(uiText(locale, "Registry data is not loaded.", "داده‌های سامانه ثبت بارگذاری نشده‌اند.")):(uiText(locale, "Only the synthetic demonstration dataset is connected.", "فقط داده‌های نمایشی متصل است."))}</strong><span>{uiText(locale, "Connect the intended authorized dataset before validating production coverage.", "پیش از ارزیابی پوشش نسخه واقعی، مجموعه‌داده موردنظر را با مجوز لازم متصل کنید.")}</span></div>}
    <section className={`table-panel density-compact mobile-view-${mobileRegistryView}${smartMode?" smart-results":""}${visualEncoding?" visual-encoding":""}${advancedOpen?" advanced-open":""}`} data-h-surface-role="major">
      <div className="table-toolbar">
        <form onSubmit={apply} className="table-filter"><span className="filter-icon"><SearchIcon size={16}/></span><input dir="auto" value={filter} onChange={e=>setFilter(e.target.value)} aria-label={t("browse.filter")} placeholder={t("browse.filter")} title={uiText(locale, "Type here to narrow the list instantly; try a name, number or other fields.", "تایپ کنید تا فهرست همان لحظه محدود شود؛ نام، شماره یا فیلدهای دیگر را امتحان کنید.")}/>{loading&&<span className="filter-working">{t("browse.searching")}</span>}{filter&&<button type="button" className="clear-filter" onClick={()=>setFilter("")} aria-label={uiText(locale, "Clear filter", "پاک کردن فیلتر")}>×</button>}</form>
        <div className="table-actions registry-toolbar-actions">
          {platformMeta?.capabilities.exports&&permissions.includes("registry.export")&&!smartMode&&<div className="registry-export-actions" aria-label={uiText(locale, "Registry export", "خروجی سامانه ثبت")}><a className="ghost registry-toolbar-control export-link" href={csvExport.href} download={csvExport.filename} title={uiText(locale, "CSV export of exactly the rows you see now (active filters included); up to 500 rows per download.", "خروجی CSV از همان ردیف‌هایی که الان می‌بینید (با فیلترهای فعال)؛ تا ۵۰۰ ردیف در هر بار.")}><span className="registry-toolbar-icon" aria-hidden="true">⇩</span><span>CSV</span></a><a className="ghost registry-toolbar-control export-link" href={jsonExport.href} download={jsonExport.filename} title={uiText(locale, "The same export as JSON for apps and analysis tools; up to 500 rows per download.", "همان خروجی اما در قالب JSON برای برنامه‌ها و ابزارهای تحلیل؛ تا ۵۰۰ ردیف در هر بار.")}><span className="registry-toolbar-icon" aria-hidden="true">⇩</span><span>JSON</span></a></div>}
          <div className="column-control"><button ref={columnsButtonRef} className={`ghost registry-toolbar-control column-button${columnsOpen?" active":""}`} type="button" aria-pressed={columnsOpen} aria-haspopup="true" aria-expanded={columnsOpen} onClick={()=>setColumnsOpen(v=>!v)} title={uiText(locale, "Show or hide optional columns (native name, year, sire…); your choice is remembered.", "ستون‌های اختیاری (نام بومی، سال، پدر و…) را نشان یا پنهان کنید؛ انتخاب شما به‌یاد سپرده می‌شود.")}><span className="registry-toolbar-icon" aria-hidden="true">▥</span><span>{t("browse.columns")}</span></button></div>
          {smartMode&&<span className="relevance-badge">{t("browse.relevance")}</span>}
        </div>
      </div>
      {columnsOpen&&createPortal(
        <div ref={columnsPanelRef} className="column-popover column-popover-portal" style={columnsPopoverPos?{top:columnsPopoverPos.top,insetInlineEnd:columnsPopoverPos.insetInlineEnd}:undefined} role="dialog" aria-label={uiText(locale, "Table columns", "ستون‌های جدول")}>
          {REGISTRY_OPTIONAL_COLUMNS.map(column=><label key={column}><input type="checkbox" checked={visibleColumns.has(column)} onChange={()=>toggleColumn(column)}/><span>{t(`col.${column}`)}</span></label>)}
          <button type="button" onClick={()=>setVisibleColumns(new Set(REGISTRY_DEFAULT_VISIBLE_COLUMNS))}>{t("browse.resetColumns")}</button>
        </div>,
        document.body)}
      {advancedOpen&&createPortal(<>
        <div className="advanced-registry-rail-scrim" onClick={()=>setAdvancedOpen(false)} aria-hidden="true"/>
        <aside className="advanced-registry-rail" role="dialog" aria-label={t("advanced.title")} data-h-surface-role="major">
          <header className="adv-rail-head">
            <div className="adv-rail-title">
              <span className="adv-rail-eyebrow">{uiText(locale, "CORE · ADVANCED SEARCH", "هسته · جست‌وجوی پیشرفته")}</span>
              <strong>{t("advanced.title")}</strong>
              <small>{t("advanced.help")}</small>
            </div>
            <button className="adv-rail-close ghost" type="button" onClick={()=>setAdvancedOpen(false)} aria-label={uiText(locale, "Close advanced search", "بستن جست‌وجوی پیشرفته")}>✕</button>
          </header>
          <section className="adv-rail-section" data-h-surface-role="panel" aria-label={uiText(locale, "Exact fields", "فیلدهای دقیق")}>
            <header className="adv-rail-section-head">
              <span className="adv-rail-index" aria-hidden="true">01</span>
              <div className="adv-rail-section-copy"><strong>{uiText(locale, "Exact fields", "فیلدهای دقیق")}</strong><small>{uiText(locale, "Optional — applies live as you type.", "اختیاری؛ همان لحظه که تایپ می‌کنید اعمال می‌شود.")}</small></div>
            </header>
            <AdvancedRegistryBar value={advanced} onChange={updateAdvanced}/>
            <footer className="adv-rail-actions">
              <span className={`adv-rail-count${advancedFilterCount?" active":""}`}>{locale==="fa"?`${advancedFilterCount} فیلتر فعال`:`${advancedFilterCount} active`}</span>
              <button type="button" className="ghost adv-rail-clear" onClick={clearAdvanced} disabled={!advancedActive}>{t("advanced.clear")}</button>
            </footer>
          </section>
          {facets&&<section className="adv-rail-section" data-h-surface-role="panel" aria-label={t("browse.facets")}>
            <header className="adv-rail-section-head">
              <span className="adv-rail-index" aria-hidden="true">02</span>
              <div className="adv-rail-section-copy"><strong>{t("browse.facets")}</strong><small>{t("browse.facetsHint")}</small></div>
              {facetsActive&&<button className="ghost facet-reset" type="button" onClick={clearFacets}>{t("browse.clearFacets")}</button>}
            </header>
            <div className={`heritage-facet-strip adv-rail-facets${facetsActive?" has-filters":""}`}> <label><span>{t("col.breed")}</span><select value={facetBreed} onChange={e=>{setFacetBreed(e.target.value);setOffset(0)}}><option value="">{t("browse.all")}</option>{facets.breeds.map(item=><option key={item.value} value={item.value}>{localizedControlledValue(item.value,locale,"breed")} · {n(item.count)}</option>)}</select></label><label><span>{t("col.sex")}</span><select value={facetSex} onChange={e=>{setFacetSex(e.target.value);setOffset(0)}}><option value="">{t("browse.all")}</option>{facets.sexes.map(item=><option key={item.value} value={item.value}>{sexLabel(item.value,locale)} · {n(item.count)}</option>)}</select></label><label><span>{uiText(locale, "Color", "رنگ")}</span><select value={facetColor} onChange={e=>{setFacetColor(e.target.value);setOffset(0)}}><option value="">{t("browse.all")}</option>{facets.colors.map(item=><option key={item.value} value={item.value}>{item.value} · {n(item.count)}</option>)}</select></label><label><span>{uiText(locale, "Main strain", "تیره اصلی")}</span><select value={facetStrain} onChange={e=>{setFacetStrain(e.target.value);setOffset(0)}}><option value="">{t("browse.all")}</option>{facets.mainStrains.map(item=><option key={item.value} value={item.value}>{item.value} · {n(item.count)}</option>)}</select></label><label><span>{uiText(locale, "Import origin", "مبدأ واردات")}</span><select value={facetImportedFrom} onChange={e=>{setFacetImportedFrom(e.target.value);setOffset(0)}}><option value="">{t("browse.all")}</option>{facets.importedFrom.map(item=><option key={item.value} value={item.value}>{item.value} · {n(item.count)}</option>)}</select></label><label><span>{t("browse.lifecycle")}</span><select value={facetLifecycle} onChange={e=>{setFacetLifecycle(e.target.value);setOffset(0)}}><option value="">{t("browse.all")}</option>{facets.lifecycle.map(item=><option key={item.value} value={item.value}>{lifecycleLabel(item.value,locale)} · {n(item.count)}</option>)}</select></label><label><span>{uiText(locale, "Registry flag", "نشانگر ثبت")}</span><select value={facetFlag} onChange={e=>{setFacetFlag(e.target.value as typeof facetFlag);setOffset(0)}}><option value="">{t("browse.all")}</option>{facets.flags.map(item=><option key={item.value} value={item.value}>{item.value.replaceAll("_"," ")} · {n(item.count)}</option>)}</select></label><label><span>{t("browse.decade")}</span><select value={facetDecade} onChange={e=>{setFacetDecade(e.target.value);setOffset(0)}}><option value="">{t("browse.all")}</option>{facets.decades.map(item=><option key={item.value} value={String(item.value)}>{item.value}s · {n(item.count)}</option>)}</select></label></div>
          </section>}
          {/* R135: the phone density toggle lives here instead of stealing a
              permanent row of the explorer — one tap in the rail, remembered. */}
          <section className="adv-rail-section adv-rail-display" data-h-surface-role="panel" aria-label={t("browse.mobileView")}>
            <header className="adv-rail-section-head">
              <span className="adv-rail-index" aria-hidden="true">03</span>
              <div className="adv-rail-section-copy"><strong>{t("browse.mobileView")}</strong><small>{uiText(locale, "Card density for phones — remembered on this device.", "تراکم کارت‌ها در گوشی؛ روی همین دستگاه به‌یاد سپرده می‌شود.")}</small></div>
            </header>
            <div className="mobile-registry-view-toggle" role="group" aria-label={t("browse.mobileView")}>
              <span className="mobile-registry-view-label">{t("browse.mobileView")}</span>
              <div className="mobile-registry-view-segment">
                <button type="button" className={mobileRegistryView==="detail"?"active":""} aria-pressed={mobileRegistryView==="detail"} onClick={()=>setMobileRegistryView("detail")}><span aria-hidden="true">▤</span>{t("browse.mobileDetail")}</button>
                <button type="button" className={mobileRegistryView==="compact"?"active":""} aria-pressed={mobileRegistryView==="compact"} onClick={()=>setMobileRegistryView("compact")}><span aria-hidden="true">≡</span>{t("browse.mobileCompact")}</button>
              </div>
            </div>
          </section>
        </aside>
      </>,document.body)}
      <div className="table-subbar"><span>{smartMode?<>{t("browse.smartFiltering")} <strong dir="auto">“{appliedFilter}”</strong></>:<>{t("browse.showing")}</>}</span><span>{smartMode?t("browse.sameEngine"):t("browse.openHint")}</span></div>
      {error&&<div className="error-card">{error}</div>}
      <div className="table-scroll"><table className="registry-table"><thead><tr><th className="sticky-name">{sortLabel("name",t("col.horse"))}</th>{visibleColumns.has("aka")&&<th className="cell-aka">{t("col.aka")}</th>}{smartMode&&<th className="cell-match">{t("col.match")}</th>}{visibleColumns.has("year")&&<th className="cell-year">{sortLabel("year",t("col.year"))}</th>}{visibleColumns.has("sex")&&<th className="cell-sex">{sortLabel("sex",t("col.sex"))}</th>}{visibleColumns.has("breed")&&<th className="cell-breed">{sortLabel("breed",t("col.breed"))}</th>}{visibleColumns.has("place")&&<th className="cell-place">{sortLabel("place",t("col.place"))}</th>}{visibleColumns.has("sire")&&<th className="cell-sire">{t("col.sire")}</th>}{visibleColumns.has("dam")&&<th className="cell-dam">{t("col.dam")}</th>}{visibleColumns.has("register")&&<th className="cell-register">{t("col.register")}</th>}{visibleColumns.has("microchip")&&<th className="cell-microchip">{t("col.microchip")}</th>}</tr></thead><tbody>{rows.map(h=>{const sex=registrySexKind(h.sex_desc);const life=horseLifecycleState(h.is_active,h.is_dead);const breed=breedEncoding(h.breed_desc,locale);const coat=coatColorEncoding(h.color_desc,locale);return <tr key={h.id} data-href={`/horse/${h.id}`} className={`sex-${sex} life-${life} registry-row-clickable`} onClick={()=>navigate(`/horse/${h.id}`)} onDoubleClick={()=>navigate(`/horse/${h.id}`)}><td className="sticky-name cell-name"><button className="table-name" onClick={()=>navigate(`/horse/${h.id}`)}><span className="table-name-primary" dir="auto">{life!=='active'?<i className={`enc-life-dot enc-life-${life}`} title={horseLifecycleLabel(life,locale)} aria-label={horseLifecycleLabel(life,locale)}></i>:null}<span className="horse-dot"></span><b>{primaryHorseName(h,locale)}</b></span>{(h.owner_name_native||h.owner_name)&&<small className="table-owner" dir="auto"><span className="table-owner-label">{t("table.owner")}</span>{locale==='fa'?(h.owner_name_native||h.owner_name):(h.owner_name||h.owner_name_native)}</small>}</button></td>{visibleColumns.has("aka")&&<td dir="auto" className="cell-aka">{secondaryHorseName(h,locale)||"—"}</td>}{smartMode&&<td className="cell-match">{h.matched_by?.length?<span className="table-match" title={h.matched_by.join(", ")}>≈ {h.matched_by.slice(0,2).map(x=>x.replaceAll("-"," ")).join(" · ")}</span>:"—"}</td>}{visibleColumns.has("year")&&<td className="cell-year">{year(h.birth_year)}</td>}{visibleColumns.has("sex")&&<td className="cell-sex"><span className={`sex-badge ${sex}`}>{horseSexSymbol(sex)} {sexLabel(h.sex_desc,locale)}</span></td>}{visibleColumns.has("breed")&&<td dir="auto" className="cell-breed">{h.breed_desc?<><i className={`enc-swatch enc-swatch-xs${coat?"":" enc-swatch-unknown"}`} aria-hidden="true" style={coat?({"--enc-swatch":coat.swatch,"--enc-swatch-alt":coat.swatchAlt??coat.swatch} as React.CSSProperties):undefined}></i><span className={breed?`enc-breed-text enc-breed-${breed.tone}`:undefined}>{breed?breed.label:localizedControlledValue(h.breed_desc,locale,"breed")}</span></>:"—"}</td>}{visibleColumns.has("place")&&<td dir="auto" className="cell-place">{h.birth_place_desc||"—"}</td>}{visibleColumns.has("sire")&&<td dir="auto" className="cell-sire">{h.father_name||h.father_id||"—"}</td>}{visibleColumns.has("dam")&&<td dir="auto" className="cell-dam">{h.mother_name||h.mother_id||"—"}</td>}{visibleColumns.has("register")&&<td dir="auto" className="cell-register">{h.register_no||"—"}</td>}{visibleColumns.has("microchip")&&<td dir="ltr" className="cell-microchip">{h.microchip_no||"—"}</td>}</tr>;})}</tbody></table>{loading&&<div className="table-loading">{t("browse.searching")}…</div>}{!loading&&rows.length===0&&<div className="empty-state"><strong>{t("browse.none")}</strong><span>{t("browse.noneHint")}</span></div>}<div className="registry-load-more-sentinel" aria-hidden="true"></div></div>
      <div className="mobile-registry-list">{rows.map(h=>{const sex=registrySexKind(h.sex_desc);const life=horseLifecycleState(h.is_active,h.is_dead);const coat=coatColorEncoding(h.color_desc,locale);const breed=breedEncoding(h.breed_desc,locale);return <button key={h.id} data-href={`/horse/${h.id}`} className={`mobile-registry-card sex-${sex} life-${life}`} onClick={()=>navigate(`/horse/${h.id}`)} title={life!=="active"?horseLifecycleLabel(life,locale):undefined}><span className="mobile-horse-accent" aria-hidden="true"></span><span className="mobile-card-head"><span className="mobile-card-title"><strong dir="auto">{primaryHorseName(h,locale)}</strong>{secondaryHorseName(h,locale)&&<small className="mobile-native" dir="auto">{secondaryHorseName(h,locale)}</small>}{(h.owner_name_native||h.owner_name)&&<small className="mobile-owner" dir="auto"><span className="table-owner-label">{t("table.owner")}</span>{locale==='fa'?(h.owner_name_native||h.owner_name):(h.owner_name||h.owner_name_native)}</small>}</span><span className="mobile-card-id">{smartMode&&h.matched_by?.length?<small className="mobile-match" title={h.matched_by.join(", ")}>≈ {h.matched_by.slice(0,2).map(x=>x.replaceAll("-"," ")).join(" · ")}</small>:null}<b dir="ltr">#{n(h.id)}</b></span></span><span className="mobile-card-chips"><span className={`enc-chip enc-sex-${sex}`}>{horseSexSymbol(sex)} {sexLabel(h.sex_desc,locale)}</span>{h.birth_year?<span className="enc-chip enc-chip-year">{year(h.birth_year)}</span>:null}{breed?<span className={`enc-chip enc-chip-breed ${breed.className}`}><i className="enc-dot" aria-hidden="true"></i>{breed.label}</span>:h.breed_desc?<span className="enc-chip enc-chip-breed"><i className="enc-dot" aria-hidden="true"></i><span dir="auto">{localizedControlledValue(h.breed_desc,locale,"breed")}</span></span>:null}{coat?<span className="enc-chip enc-chip-coat"><i className="enc-swatch" aria-hidden="true" style={{"--enc-swatch":coat.swatch,"--enc-swatch-alt":coat.swatchAlt??coat.swatch} as React.CSSProperties}></i>{coat.label}</span>:h.color_desc?<span className="enc-chip enc-chip-coat"><i className="enc-swatch enc-swatch-unknown" aria-hidden="true"></i><span dir="auto">{localizedControlledValue(h.color_desc,locale,"color")}</span></span>:null}{life!=="active"?<span className={`enc-chip enc-chip-life enc-life-${life}`}>{horseLifecycleGlyph(life)} {horseLifecycleLabel(life,locale)}</span>:null}</span><span className="mobile-lineage"><span className="mobile-lineage sire"><small className="tone-sire">{t("result.sire")}</small><b dir="auto">{localizedParentName(h,"father",locale)||t("result.unknown")}</b></span><span className="mobile-lineage dam"><small className="tone-dam">{t("result.dam")}</small><b dir="auto">{localizedParentName(h,"mother",locale)||t("result.unknown")}</b></span></span></button>})}{loading&&!appending&&<div className="table-loading mobile-loading">{t("browse.searching")}…</div>}{!loading&&rows.length===0&&<div className="empty-state"><strong>{t("browse.none")}</strong><span>{t("browse.noneHint")}</span></div>}<div className="registry-load-more-sentinel" aria-hidden="true"></div></div>
      {/* R135 infinite scroll: no more Previous/Next. The list keeps loading
          pages as the reader scrolls; this slim bar only reports progress and
          offers the explicit keyboard path. */}
      <div className="table-pager registry-load-more" aria-live="polite">
        <span className="pager-range">{smartMode?`${n(rows.length)} ${t("browse.bestMatches")}`:data&&data.total?<>{"\u200e"}{n(Math.min(rows.length,data.total))} {t("browse.of")} {n(data.total)} {t("browse.horses")}{loading&&appending?` · ${t("browse.searching")}…`:""}</>: `0 ${t("browse.records")}`}</span>
        {canLoadMore&&!appending&&<button type="button" className="ghost pager-button registry-more-button" onClick={loadMore}>{t("browse.loadMore")}</button>}
      </div>
    </section>
  </main>;
}

function AdvancedRegistryBar({value,onChange}:{value:AdvancedRegistrySearch;onChange:(key:keyof AdvancedRegistrySearch,value:string)=>void}){
  const {t}=useI18n();
  const fields:Array<[keyof AdvancedRegistrySearch,string,string]>=[
    ["horseName",t("advanced.horseName"),t("advanced.horseNamePh")],
    ["horseId",t("advanced.horseId"),"#78089"],
    ["registerNo",t("advanced.register"),t("advanced.registerPh")],
    ["owner",t("advanced.owner"),t("advanced.ownerPh")],
    ["breeder",t("advanced.breeder"),t("advanced.breederPh")],["importer",t("advanced.importer"),t("advanced.importerPh")],["passportReceiver",t("advanced.passportReceiver"),t("advanced.passportReceiverPh")],
    ["sire",t("advanced.sire"),t("advanced.sirePh")],
    ["dam",t("advanced.dam"),t("advanced.damPh")],
    ["place",t("advanced.place"),t("advanced.placePh")],
    ["yearFrom",t("advanced.yearFrom"),"1990"],
    ["yearTo",t("advanced.yearTo"),"2026"],
  ];
  return <div className="advanced-registry-grid">{fields.map(([key,label,placeholder])=><label key={key}><span>{label}</span><input dir="auto" inputMode={key.startsWith("year")||key==="horseId"?"numeric":undefined} value={value[key]} placeholder={placeholder} onChange={e=>onChange(key,e.target.value)}/></label>)}</div>;
}

/* R128: classification delegates to the shared semantic-encoding brain so every
   surface (table, cards, pedigree, profile) reads the same sex vocabulary —
   including the source system's "Geld." abbreviations. */
function normalizeSexClass(value?:string|null):string { return registrySexKind(value); }
function sexSymbol(value?:string|null):string { return horseSexSymbol(registrySexKind(value)); }
function sexLabel(value:string|null|undefined,locale:Locale):string { const raw=(value||'').trim().toLowerCase(); if(raw==='filly'||raw==='colt'){const female=raw==='filly';if(locale==='fa')return female?'کره ماده':'کره نر';if(locale==='fr')return female?'Pouliche':'Poulain';if(locale==='ar')return female?'مهرة':'مهر';} const c=registrySexKind(value); if(locale==="fa")return c==="female"?"مادیان":c==="male"?"سیلمی":c==="gelding"?"اخته":"نامشخص"; if(locale==="ar")return c==="female"?"فرس":c==="male"?"فحل":c==="gelding"?"حصان مخصي":"غير معروف"; if(locale==="fr")return c==="female"?"Jument":c==="male"?"Étalon":c==="gelding"?"Hongre":"Inconnu"; return value||"Unknown"; }
function lifecycleLabel(value:string|null|undefined,locale:Locale):string { const v=(value||"").trim().toLowerCase(); if(locale==="fa"){if(v==="active")return "فعال";if(v==="inactive")return "غیرفعال";if(v==="deceased")return "تلف‌شده";return value||"نامشخص";} if(locale==="ar"){if(v==="active")return "نشط";if(v==="inactive")return "غير نشط";if(v==="deceased")return "نافق";return value||"غير معروف";} if(locale==="fr"){if(v==="active")return "Actif";if(v==="inactive")return "Inactif";if(v==="deceased")return "Décédé";return value||"Inconnu";} return value||"Unknown"; }
const FA_BREED_LABELS:Record<string,string>={
  "arabian":"عرب","arab":"عرب","arabian horse":"عرب","partbred arabian":"دورگه عرب","half arabian":"نیمه‌عرب","thoroughbred":"تروبرد"
};
const FA_COLOR_LABELS:Record<string,string>={
  "bay":"کهر","dark bay":"کهر تیره","chestnut":"کرنگ","gray":"خاکستری","grey":"خاکستری","black":"سیاه","white":"سفید","roan":"ابرش","palomino":"طلایی"
};
const AR_BREED_LABELS:Record<string,string>={
  "arabian":"عربي","arab":"عربي","arabian horse":"حصان عربي","partbred arabian":"عربي مهجن","half arabian":"نصف عربي","thoroughbred":"ثوروبريد"
};
const AR_COLOR_LABELS:Record<string,string>={
  "bay":"كهر","dark bay":"كهر داكن","chestnut":"كستنائي","gray":"رمادي","grey":"رمادي","black":"أسود","white":"أبيض","roan":"أبلق","palomino":"بالومينو"
};
function localizedControlledValue(value:string|null|undefined,locale:Locale,kind:"breed"|"color"):string|null {
  if(!value)return null;
  const key=value.trim().toLowerCase();
  if(locale==="fa")return (kind==="breed"?FA_BREED_LABELS:FA_COLOR_LABELS)[key]||value;
  if(locale==="ar")return (kind==="breed"?AR_BREED_LABELS:AR_COLOR_LABELS)[key]||value;
  return value;
}
function partyRoleLabel(value:string|null|undefined,locale:Locale):string { const v=(value||"").toLowerCase(); if(locale==="fa"){if(v==="owner")return "مالک";if(v==="breeder")return "پرورش‌دهنده";if(v==="importer")return "واردکننده";if(v==="passport_receiver")return "گیرنده گذرنامه";return value||"—";} if(locale==="ar"){if(v==="owner")return "المالك";if(v==="breeder")return "المربّي";if(v==="importer")return "المستورد";if(v==="passport_receiver")return "مستلم جواز السفر";return value||"—";} if(locale==="fr"){if(v==="owner")return "Propriétaire";if(v==="breeder")return "Éleveur";if(v==="importer")return "Importateur";if(v==="passport_receiver")return "Destinataire du passeport";return value||"—";} return value||"—"; }
function primaryHorseName(horse:Horse, locale:Locale):string { return (locale==="fa"||locale==="ar") && horse.name_native ? horse.name_native : horse.name_latin; }
function secondaryHorseName(horse:Horse, locale:Locale):string|null { if((locale==="fa"||locale==="ar")&&horse.name_native&&horse.name_latin)return horse.name_latin; if(locale==="en"&&horse.name_native)return horse.name_native; return null; }

function ResultCard({horse,rank,onOpen,active=false}:{horse:Horse;rank:number;onOpen:()=>void;active?:boolean}){
  const {t,n,year,locale}=useI18n();
  const sex=registrySexKind(horse.sex_desc); const life=horseLifecycleState(horse.is_active,horse.is_dead); const breed=breedEncoding(horse.breed_desc,locale); const coat=coatColorEncoding(horse.color_desc,locale); const primary=primaryHorseName(horse,locale); const secondary=secondaryHorseName(horse,locale);
  return <button id={`result-${horse.id}`} className={`result-card sex-${sex} life-${life}${active?" active":""}`} onClick={onOpen}>
    <div className={`result-stripe ${sex}`}></div>
    <div className="rank">{String(rank).padStart(2,"0")}</div>
    <div className="result-main">
      <div className="result-title"><div><strong dir="auto">{primary}</strong>{secondary&&<span dir="auto">{secondary}</span>}</div><span className={`sex-badge ${sex}`}>{horseSexSymbol(sex)} {sexLabel(horse.sex_desc,locale)}</span>{life!=="active"?<span className={`enc-chip enc-chip-life enc-life-${life}`}>{horseLifecycleGlyph(life)} {horseLifecycleLabel(life,locale)}</span>:null}</div>
      <div className="meta"><span className="horse-no">#{n(horse.id)}</span>{horse.birth_year&&<span>{year(horse.birth_year)}</span>}{horse.breed_desc&&<span dir="auto" className={breed?`enc-breed-text enc-breed-${breed.tone}`:undefined}>{horse.color_desc?<i className={`enc-swatch enc-swatch-xs${coat?"":" enc-swatch-unknown"}`} aria-hidden="true" style={coat?({"--enc-swatch":coat.swatch,"--enc-swatch-alt":coat.swatchAlt??coat.swatch} as React.CSSProperties):undefined}></i>:null}{breed?breed.label:localizedControlledValue(horse.breed_desc,locale,"breed")}</span>}{horse.birth_place_desc&&<span dir="auto">{horse.birth_place_desc}</span>}</div>
      <div className="parents lineage-row"><span className="sire"><small className="tone-sire">{t("result.sire")}</small><b dir="auto">{localizedParentName(horse,"father",locale)||t("result.unknown")}</b></span><span className="dam"><small className="tone-dam">{t("result.dam")}</small><b dir="auto">{localizedParentName(horse,"mother",locale)||t("result.unknown")}</b></span></div>
      {horse.matched_by?.length?<div className="match-reasons"><small>{t("result.matched")}</small>{horse.matched_by.slice(0,4).map(reason=><span key={reason}>{reason.replaceAll("-"," ")}</span>)}</div>:null}
    </div>
    <div className="open-arrow"><span>{t("result.open")}</span>↗</div>
  </button>
}

function HorsePage({id,navigate,platform,platformMeta,user,permissions}:{id:number;navigate:(p:string)=>void;platform:PlatformClient;platformMeta:PlatformMetaResponse|null;user:PlatformUser|null;permissions:PlatformPermission[]}){
  const {t,n,year,locale}=useI18n();
    const visualAssets=useHeritageVisualAssetsSnapshot();
  const [attempt,retry]=useState(0);
  const [data,setData]=useState<HorseProfileResponse|null>(null); const [tree,setTree]=useState<PedigreeNode|null>(null); const [depth,setDepth]=useState(4); const [direction,setDirection]=useState<"ancestors"|"descendants">("ancestors"); const [truncated,setTruncated]=useState(false); const [copied,setCopied]=useState(false); const [error,setError]=useState(""); const [pedigreeError,setPedigreeError]=useState("");
  const [metrics,setMetrics]=useState<PedigreeMetricsResponse|null>(null); const [metricsLoading,setMetricsLoading]=useState(false);
  const [descendantMetrics,setDescendantMetrics]=useState<DescendantMetricsResponse|null>(null); const [descendantMetricsLoading,setDescendantMetricsLoading]=useState(false);
  const [coefficient,setCoefficient]=useState<PedigreeCoefficientResponse|null>(null); const [coefficientLoading,setCoefficientLoading]=useState(false);
  const [insights,setInsights]=useState<HorseInsightsResponse|null>(null);
  const [insightsError,setInsightsError]=useState(false);
  const [workspace,setWorkspace]=useState<ProfileWorkspace>(() => "all");
  const [pedigreePane,setPedigreePane]=useState<PedigreeWorkspacePane>("visualizer");
  const [recordPane,setRecordPane]=useState<RecordWorkspacePane>("summary");
  const workspaceContextRef=useRef<HTMLDivElement>(null);
  const wantsPedigreeIntelligence=workspace==="all"||(workspace==="pedigree"&&pedigreePane==="intelligence");
  useEffect(()=>{
    const controller=new AbortController();
    setData(null);setError("");setTree(null);setTruncated(false);setPedigreeError("");setMetrics(null);setDescendantMetrics(null);setCoefficient(null);setInsights(null);setInsightsError(false);
    platform.horses.get(id,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setData(value)}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)});
    return()=>controller.abort();
  },[id,platform,attempt]);
  useEffect(()=>{
    const controller=new AbortController();
    setTree(null);setTruncated(false);setPedigreeError("");
    const pedigreeRequest=direction==="ancestors"?platform.pedigree.ancestors(id,{depth},{signal:controller.signal}):platform.pedigree.descendants(id,{depth:Math.min(depth,6),maxNodes:160},{signal:controller.signal});
    pedigreeRequest.then(value=>{if(!controller.signal.aborted){setTree(value.tree as PedigreeNode);setTruncated("truncated" in value?Boolean(value.truncated):false)}}).catch(e=>{if(!controller.signal.aborted)setPedigreeError((e as Error).message)});
    return()=>controller.abort();
  },[id,depth,direction,platform]);
  useEffect(()=>{
    const controller=new AbortController();
    if(direction!=="ancestors"||!wantsPedigreeIntelligence){setMetricsLoading(false);setCoefficientLoading(false);return()=>controller.abort();}
    setMetricsLoading(true);setCoefficientLoading(true);setInsightsError(false);
    void (async()=>{
      let bundledInsights:HorseInsightsResponse|null=null;
      try{
        bundledInsights=await platform.analytics.horseInsights(id,{ancestorDepth:6,descendantDepth:4,metricsDepth:depth,coefficientDepth:8},{signal:controller.signal});
        if(controller.signal.aborted)return;
        setInsights(bundledInsights);
      }catch{
        if(controller.signal.aborted)return;
        setInsights(null);
        setInsightsError(true);
      }
      if(controller.signal.aborted)return;
      const metricsRequest=bundledInsights?.pedigreeMetrics?Promise.resolve(bundledInsights.pedigreeMetrics):platform.pedigree.metrics(id,{depth},{signal:controller.signal});
      const coefficientRequest=bundledInsights?.pedigreeCoefficient?Promise.resolve(bundledInsights.pedigreeCoefficient):platform.pedigree.coefficients(id,{depth:8},{signal:controller.signal});
      const [metricsResult,coefficientResult]=await Promise.allSettled([metricsRequest,coefficientRequest]);
      if(controller.signal.aborted)return;
      setMetrics(metricsResult.status==="fulfilled"?metricsResult.value:null);
      setCoefficient(coefficientResult.status==="fulfilled"?coefficientResult.value:null);
      if(!bundledInsights&&metricsResult.status==="rejected"&&coefficientResult.status==="rejected")setInsightsError(true);
    })().finally(()=>{if(!controller.signal.aborted){setMetricsLoading(false);setCoefficientLoading(false)}});
    return()=>controller.abort();
  },[id,depth,direction,platform,wantsPedigreeIntelligence]);
  useEffect(()=>{
    const controller=new AbortController();
    if(direction!=="descendants"||!wantsPedigreeIntelligence){setDescendantMetricsLoading(false);return()=>controller.abort();}
    setDescendantMetricsLoading(true);
    platform.pedigree.descendantMetrics(id,{depth:Math.min(depth,6),maxNodes:Math.min(1000,platformMeta?.limits.pedigreeDescendantMetricsNodesMax??1000)},{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setDescendantMetrics(value)}).catch(()=>{if(!controller.signal.aborted)setDescendantMetrics(null)}).finally(()=>{if(!controller.signal.aborted)setDescendantMetricsLoading(false)});
    return()=>controller.abort();
  },[id,depth,direction,platform,platformMeta,wantsPedigreeIntelligence]);
  const L=(en:string,fa:string)=>uiText(locale, en, fa);
  const focusWorkspace=()=>revealHeritageContent(".profile-workspace-context");
  const activateWorkspace=(next:ProfileWorkspace)=>{setWorkspace(next);focusWorkspace()};
  const activatePedigreePane=(next:PedigreeWorkspacePane)=>{setPedigreePane(next);focusWorkspace()};
  const activateRecordPane=(next:RecordWorkspacePane)=>{setRecordPane(next);focusWorkspace()};
  const activateDirection=(next:"ancestors"|"descendants")=>{setDirection(next);revealHeritageContent(".pedigree-section")};
  const profileDockLayers=useMemo<HeritageDockLayer[]>(()=>{
    const layers:HeritageDockLayer[]=[{id:"profile-sections",level:"secondary",ariaLabel:L("Horse profile sections","بخش‌های پروفایل اسب"),items:[
      {id:"all",label:L("All","همه"),active:workspace==="all",onActivate:()=>activateWorkspace("all"),revealTarget:".profile-workspace-context"},
      {id:"pedigree",label:L("Pedigree","تبارنامه"),active:workspace==="pedigree",onActivate:()=>activateWorkspace("pedigree"),revealTarget:".profile-workspace-context"},
      {id:"record",label:L("Record","رکورد"),active:workspace==="record",onActivate:()=>activateWorkspace("record"),revealTarget:".profile-workspace-context"},
      {id:"relationships",label:L("Relationships","خویشاوندی"),shortLabel:L("Relations","خویشاوندی"),active:workspace==="relationships",onActivate:()=>activateWorkspace("relationships"),revealTarget:".profile-workspace-context"},
      {id:"breeding",label:L("Breeding","جفت‌گیری"),active:workspace==="breeding",onActivate:()=>activateWorkspace("breeding"),revealTarget:".profile-workspace-context"},
      {id:"competitions",label:L("Competitions","مسابقات"),active:workspace==="competitions",onActivate:()=>activateWorkspace("competitions"),revealTarget:".profile-workspace-context"},
      {id:"racing",label:L("Racing","اسب‌دوانی"),active:workspace==="racing",onActivate:()=>activateWorkspace("racing"),revealTarget:".profile-workspace-context"},
      {id:"genetics",label:L("Genetics","ژنتیک"),active:workspace==="genetics",onActivate:()=>activateWorkspace("genetics"),revealTarget:".profile-workspace-context"},
      {id:"care",label:L("Private care","مراقبت خصوصی"),active:workspace==="care",onActivate:()=>activateWorkspace("care"),revealTarget:".profile-workspace-context"},
      {id:"media",label:L("Media","رسانه"),active:workspace==="media",onActivate:()=>activateWorkspace("media"),revealTarget:".profile-workspace-context"},
    ]}];
    if(workspace==="pedigree")layers.push({id:"profile-pedigree-views",level:"tertiary",ariaLabel:L("Pedigree views","نماهای تبارنامه"),items:[
      {id:"visualizer",label:L("Visualizer","نمایشگر"),active:pedigreePane==="visualizer",onActivate:()=>activatePedigreePane("visualizer"),revealTarget:".profile-workspace-context"},
      {id:"intelligence",label:L("Intelligence","هوشمندی"),active:pedigreePane==="intelligence",onActivate:()=>activatePedigreePane("intelligence"),revealTarget:".profile-workspace-context"},
    ]});
    if(workspace==="record")layers.push({id:"profile-record-views",level:"tertiary",ariaLabel:L("Record views","نماهای رکورد"),items:[
      {id:"summary",label:L("Summary","خلاصه"),active:recordPane==="summary",onActivate:()=>activateRecordPane("summary"),revealTarget:".profile-workspace-context"},
      {id:"record",label:L("Complete record","رکورد کامل"),shortLabel:L("Record","رکورد"),active:recordPane==="record",onActivate:()=>activateRecordPane("record"),revealTarget:".profile-workspace-context"},
      {id:"claims",label:L("Claims","ادعاها"),active:recordPane==="claims",onActivate:()=>activateRecordPane("claims"),revealTarget:".profile-workspace-context"},
    ]});
    return layers;
  },[locale,pedigreePane,recordPane,workspace]);
  useHeritageMobileDock("horse-profile",profileDockLayers);
  if(error)return <main className="page"><div className="error-card" role="alert"><p>{uiText(locale,"This record could not be opened.","باز کردن این پرونده ممکن نشد.")}</p><button type="button" className="ghost" onClick={()=>retry(a=>a+1)}>{uiText(locale,"Try again","تلاش دوباره")}</button></div></main>;
  if(!data)return <main className="page"><div className="loading-line" role="status">{uiText(locale,"Loading horse record…","در حال بارگذاری پرونده اسب…")}</div></main>;
  const h=data.horse as Horse; const sex=normalizeSexClass(h.sex_desc); const primary=primaryHorseName(h,locale); const secondary=secondaryHorseName(h,locale);
  const copyLink=async()=>{try{await navigator.clipboard.writeText(location.href);setCopied(true);setTimeout(()=>setCopied(false),1600)}catch{setCopied(false)}};
  const workspaceCopy:Record<ProfileWorkspace,{kicker:string;title:string;body:string}>={
    all:{kicker:L("HORSE PROFILE / ALL","پروفایل اسب / همه"),title:L("Complete horse dossier","پرونده کامل اسب"),body:L("Classic continuous view: every profile workspace remains visible in one scrollable dossier.","نمای پیوسته کلاسیک: همه بخش‌های پروفایل در یک پرونده پیمایشی قابل مشاهده‌اند.")},
    pedigree:{kicker:L("HORSE PROFILE / PEDIGREE","پروفایل اسب / تبارنامه"),title:pedigreePane==="visualizer"?L("Family visualizer","نمایشگر خانواده"):L("Pedigree intelligence","تحلیل تبارنامه"),body:pedigreePane==="visualizer"?L("Explore ancestry or descendants with the view best suited to the available space.","تبار یا نوادگان را با نمای مناسب فضای موجود بررسی کنید."):L("Coverage, repeated ancestors, coefficients and lineage evidence without visualizer clutter.","پوشش، اجداد تکراری، ضرایب و شواهد دودمانی بدون شلوغی نمایشگر.")},
    record:{kicker:L("HORSE PROFILE / RECORD","پروفایل اسب / رکورد"),title:recordPane==="summary"?L("Registry summary","خلاصه سامانه ثبت"):recordPane==="record"?L("Complete public record","رکورد کامل عمومی"):L("Ownership & claims","مالکیت و ادعاها"),body:recordPane==="summary"?L("Identity, people and trust controls at a glance.","هویت، افراد مرتبط و کنترل‌های اعتماد در یک نگاه."):recordPane==="record"?L("All safe canonical public fields in one structured ledger.","همه فیلدهای عمومی امن در یک نمای ساختاریافته."):L("Provenance and claim workflow for this registry record.","منشأ و گردش‌کار ادعا برای این رکورد سامانه ثبت.")},
    relationships:{kicker:L("HORSE PROFILE / RELATIONSHIPS","پروفایل اسب / خویشاوندی"),title:L("Relationship laboratory","آزمایشگاه خویشاوندی"),body:L("Compare two horses and trace common ancestors, routes and coefficients.","دو اسب را مقایسه و اجداد مشترک، مسیرها و ضرایب را ردیابی کنید.")},
    breeding:{kicker:L("HORSE PROFILE / BREEDING","پروفایل اسب / جفت‌گیری"),title:L("Breeding workspace","فضای جفت‌گیری"),body:L("Evaluate potential pairings with pedigree-aware evidence and explicit limitations.","جفت‌های احتمالی را با شواهد تبارنامه‌ای و محدودیت‌های روشن ارزیابی کنید.")}
 ,
    competitions:{kicker:L("HORSE PROFILE / COMPETITIONS","پروفایل اسب / مسابقات"),title:L("Competition record","سوابق مسابقات"),body:L("Starts, placements and riders for this horse across federation events.","شروع‌ها، مقام‌ها و سوارکاران این اسب در رویدادهای فدراسیون.")},
    racing:{kicker:L("HORSE PROFILE / RACING","پروفایل اسب / اسب‌دوانی"),title:L("Racing record","سوابق اسب‌دوانی"),body:L("Starts and placings served from the federation's official racing system with explicit provenance.","شروع‌ها و مقام‌ها از سامانه رسمی اسب‌دوانی فدراسیون، همراه با ذکر منبع صریح.")},
    genetics:{kicker:L("HORSE PROFILE / GENETICS","پروفایل اسب / ژنتیک"),title:L("Genetics & reproduction","ژنتیک و تولیدمثل"),body:L("Disease markers, coat loci and the covering ledger for this horse.","نشانگرهای بیماری، لوکوس‌های رنگ و دفتر جفت‌گیری این اسب.")},
    media:{kicker:L("HORSE PROFILE / MEDIA","پروفایل اسب / رسانه"),title:L("Photos & documents","عکس‌ها و مدارک"),body:L("Gallery, uploaded documents and a printable information extract (not a certificate).","گالری، مدارک و خلاصه اطلاعات قابل چاپ (نه گواهی).")},
    care:{kicker:L("HORSE PROFILE / PRIVATE CARE","پروفایل اسب / مراقبت خصوصی"),title:L("Care & laboratory evidence","مراقبت و شواهد آزمایشگاهی"),body:L("Permission-scoped clinical records, reproductive episodes, samples and independent evidence review.","سوابق درمانی، دوره‌های تولیدمثل، نمونه‌ها و بررسی مستقل شواهد در دامنه مجوز شما.")}
  };
  const workspaceLabel:Record<ProfileWorkspace,string>={all:L("All","همه"),pedigree:L("Pedigree","تبارنامه"),record:L("Record","رکورد"),relationships:L("Relationships","خویشاوندی"),breeding:L("Breeding","جفت‌گیری"),competitions:L("Competitions","مسابقات"),racing:L("Racing","اسب‌دوانی"),genetics:L("Genetics","ژنتیک"),media:L("Media","رسانه"),care:L("Private care","مراقبت خصوصی")};
  const workspacePaneLabel=workspace==="pedigree"?(pedigreePane==="visualizer"?L("Visualizer","نمایشگر"):L("Intelligence","هوشمندی")):workspace==="record"?(recordPane==="summary"?L("Summary","خلاصه"):recordPane==="record"?L("Complete record","رکورد کامل"):L("Claims","ادعاها")):null;
  return <main className="page horse-page">
    <div className="profile-toolbar"><div className="page-crumbs"><button className="back" onClick={()=>navigate("/")}>← {t("profile.search")}</button><span>/</span><button className="back" onClick={()=>navigate("/browse")}>{t("profile.registry")}</button><span>/</span><b>#{n(h.id)}</b></div><div className="profile-actions"><button className="ghost profile-action-button" onClick={()=>navigate(`/browse?q=${encodeURIComponent(h.name_latin)}`)} title={t("profile.findSimilar")}><SearchIcon size={14}/><span className="profile-action-label">{t("profile.findSimilar")}</span></button><button className="ghost profile-action-button" onClick={copyLink} title={copied?t("profile.copied"):t("profile.copyLink")}><span className="profile-action-symbol" aria-hidden="true">{copied?"✓":"⧉"}</span><span className="profile-action-label">{copied?t("profile.copied"):t("profile.copyLink")}</span></button></div></div>
    <section className="profile-hero premium-profile" data-h-surface-role="panel">
      <div className="profile-emblem">{h.profile_image_url
        ? <figure className="profile-photo-figure"><img src={h.profile_image_url} alt={primary} referrerPolicy="no-referrer" title={h.profile_image_credit ?? undefined} className="profile-photo" loading="lazy" decoding="async" width={132} height={132}/>{h.profile_image_credit?<figcaption className="profile-photo-credit" dir="auto">{L("Photo","عکس")}: {h.profile_image_credit}</figcaption>:null}</figure>
        : <img src={resolveHeritageSplashSource(visualAssets)} alt=""/>}</div>
      <div className="profile-main"><div className="eyebrow"><span className="eyebrow-rule"></span>{t("profile.horse")}</div><h1 dir="auto">{primary}</h1>{secondary&&<div className="native-name" dir="auto">{secondary}</div>}
        <div className="profile-tags"><span className={`sex-badge ${sex}`}>{sexSymbol(h.sex_desc)} {sexLabel(h.sex_desc,locale)}</span>{(()=>{const life=horseLifecycleState(h.is_active,h.is_dead);const breed=breedEncoding(h.breed_desc,locale);const coat=coatColorEncoding(h.color_desc,locale);const tags:Array<{key:string;node:React.ReactNode}>=[{key:"date",node:typedDateText(profileBirth(h.birth_date_typed,h.birth_year),locale)||(h.birth_year?year(h.birth_year):null)},{key:"color",node:h.color_desc?<>{coat?<i className="enc-swatch enc-swatch-xs" aria-hidden="true" style={{"--enc-swatch":coat.swatch,"--enc-swatch-alt":coat.swatchAlt??coat.swatch} as React.CSSProperties}></i>:null}<span dir="auto">{coat?coat.label:localizedControlledValue(h.color_desc,locale,"color")}</span></>:null},{key:"breed",node:h.breed_desc?<span dir="auto" className={breed?`enc-breed-text enc-breed-${breed.tone}`:undefined}>{breed?breed.label:localizedControlledValue(h.breed_desc,locale,"breed")}</span>:null},{key:"place",node:h.birth_place_desc?<span dir="auto">{h.birth_place_desc}</span>:null}];if(life!=="active")tags.unshift({key:"life",node:<span className={`enc-chip enc-chip-life enc-life-${life}`}>{horseLifecycleGlyph(life)} {horseLifecycleLabel(life,locale)}</span>});return tags.filter(tag=>Boolean(tag.node)).map(tag=><span dir="auto" key={tag.key}>{tag.node}</span>);})()}</div>
        {/* R140-I: the client proposal's per-field trust ask, v1 — honest chips
            computed from public facts only (staff-only data_origin is never
            exposed). The full per-field matrix deepens in R141 with a
            per-field trust API; the 4-level ladder vocabulary stays in the
            Record workspace's attestation panel. */}
        <div className="profile-trust-strip" aria-label={L("Data trust at a glance","نگاه سریع اعتماد داده")}>
          <span className={`enc-chip ${h.register_no?"trust-chip-ok":"trust-chip-missing"}`}>{h.register_no?L("Registry number recorded","شماره ثبت ثبت شده است"):L("No registry number yet","هنوز بدون شماره ثبت")}</span>
          <span className={`enc-chip ${h.father_id&&h.mother_id?"trust-chip-ok":"trust-chip-missing"}`}>{h.father_id&&h.mother_id?L("Sire and dam linked in pedigree","پدر و مادر در تبارنامه پیوند خورده‌اند"):L("Parentage incomplete","تبارنامه ناقص است")}</span>
          <span className="enc-chip trust-chip-ladder">{L("Verification levels apply — see the Record workspace","سطوح تأیید اعمال می‌شود — بخش رکورد را ببینید")}</span>
        </div>
        <div className="lineage-cards">
          <button className="lineage-card sire" data-href={h.father_id?`/horse/${h.father_id}`:undefined} disabled={!h.father_id} onClick={()=>h.father_id&&navigate(`/horse/${h.father_id}`)}><small>{t("profile.sire")}</small><strong dir="auto">{localizedParentName(h,"father",locale)||t("result.unknown")}</strong><span>{h.father_id?`#${n(h.father_id)}`:t("profile.noSire")}</span></button>
          <button className="lineage-card dam" data-href={h.mother_id?`/horse/${h.mother_id}`:undefined} disabled={!h.mother_id} onClick={()=>h.mother_id&&navigate(`/horse/${h.mother_id}`)}><small>{t("profile.dam")}</small><strong dir="auto">{localizedParentName(h,"mother",locale)||t("result.unknown")}</strong><span>{h.mother_id?`#${n(h.mother_id)}`:t("profile.noDam")}</span></button>
        </div>
      </div>
      <div className="identity-card"><small>{t("profile.identity")}</small><dl><div><dt>{t("profile.register")}</dt><dd dir="auto">{h.register_no||"—"}</dd></div><div><dt>{t("profile.horseNo")}</dt><dd>#{n(h.id)}</dd></div><div><dt>{t("profile.status")}</dt><dd><span className="status-inline">{horseLifecycleGlyph(horseLifecycleState(h.is_active,h.is_dead))} {horseLifecycleLabel(horseLifecycleState(h.is_active,h.is_dead),locale)}</span></dd></div><div><dt>{t("profile.index")}</dt><dd>{L("Record available","رکورد در دسترس")}</dd></div></dl></div>
    </section>
    <div ref={workspaceContextRef} className={`profile-workspace-context workspace-${workspace}`} data-view-transition-anchor data-h-surface-role="major">
      <div className="workspace-route-trail" role="group" aria-label={L("Current workspace path","مسیر فضای فعال")}>
        <span className="route-node">{L("Horse profile","پروفایل اسب")}</span><i className="route-link" aria-hidden="true"/><span className={`route-node${workspacePaneLabel?"":" is-current"}`}>{workspaceLabel[workspace]}</span>{workspacePaneLabel&&<><i className="route-link" aria-hidden="true"/><span className="route-node is-current">{workspacePaneLabel}</span></>}
      </div>
      <div className="profile-workspace-context-copy"><span>{workspaceCopy[workspace].kicker}</span><strong>{workspaceCopy[workspace].title}</strong><small>{workspaceCopy[workspace].body}</small></div>
      <ContextNavigation><nav className="profile-workspace-nav profile-workspace-tree" aria-label={L("Horse profile sections","بخش‌های پروفایل اسب")} data-count="10">
        <span className="tab-rail-label"><b>{L("PROFILE SECTIONS","بخش‌های پروفایل")}</b><small>{L("Choose what is shown below","محتوای نمایش‌داده‌شده را انتخاب کنید")}</small></span>
        <button data-workspace="all" className={workspace==="all"?"active":""} aria-current={workspace==="all"?"page":undefined} onClick={()=>activateWorkspace("all")} title={L("The full continuous profile: pedigree, record, relationships and breeding in one scroll.","پروفایل کامل پیوسته: تبارنامه، رکورد، خویشاوندی و جفت‌گیری در یک پیمایش.")}><span className="profile-workspace-symbol" aria-hidden="true">☷</span><span>{L("All","همه")}</span></button>
        {/* R131: the section rail is a real hierarchical tree. A section that
            owns views (pedigree, record) renders its child views nested under
            it — indented, connected to the parent branch, and only open while
            that parent is active — instead of a separate flat row that gave no
            visual hint of what belongs to what. */}
        <div className={`profile-tree-branch tone-teal${workspace==="pedigree"?" open":""}`} data-branch="pedigree">
          <button data-workspace="pedigree" className={workspace==="pedigree"?"active":""} aria-current={workspace==="pedigree"?"page":undefined} aria-expanded={workspace==="pedigree"} onClick={()=>activateWorkspace("pedigree")} title={L("Ancestor/descendant tree plus inbreeding and coverage analysis.","درخت نیاکان/نوادگان همراه با تحلیل هم‌خونی و پوشش.")}><PedigreeIcon size={17}/><span>{L("Pedigree","تبارنامه")}</span></button>
          <div className="profile-tree-children" role="group" aria-label={L("Pedigree views","نماهای تبارنامه")} hidden={workspace!=="pedigree"}>
            <span className="profile-tree-caption">{L("PEDIGREE VIEWS","نماهای تبارنامه")}</span>
            <button data-pane="visualizer" className={pedigreePane==="visualizer"?"active":""} onClick={()=>activatePedigreePane("visualizer")}>{L("Visualizer","نمایشگر")}</button>
            <button data-pane="intelligence" className={pedigreePane==="intelligence"?"active":""} onClick={()=>activatePedigreePane("intelligence")}>{L("Intelligence","هوشمندی")}</button>
          </div>
        </div>
        <div className={`profile-tree-branch tone-violet${workspace==="record"?" open":""}`} data-branch="record">
          <button data-workspace="record" className={workspace==="record"?"active":""} aria-current={workspace==="record"?"page":undefined} aria-expanded={workspace==="record"} onClick={()=>activateWorkspace("record")} title={L("Registry summary, the complete canonical record and ownership claims.","خلاصهٔ ثبت، رکورد کامل مرجع و ادعاهای مالکیت.")}><RegistryIcon size={17}/><span>{L("Record","رکورد")}</span></button>
          <div className="profile-tree-children" role="group" aria-label={L("Record views","نماهای رکورد")} hidden={workspace!=="record"}>
            <span className="profile-tree-caption">{L("RECORD VIEWS","نماهای رکورد")}</span>
            <button data-pane="summary" className={recordPane==="summary"?"active":""} onClick={()=>activateRecordPane("summary")}>{L("Summary","خلاصه")}</button>
            <button data-pane="record" className={recordPane==="record"?"active":""} onClick={()=>activateRecordPane("record")}>{L("Complete record","رکورد کامل")}</button>
            <button data-pane="claims" className={recordPane==="claims"?"active":""} onClick={()=>activateRecordPane("claims")}>{L("Claims","ادعاها")}</button>
          </div>
        </div>
        <button data-workspace="relationships" className={workspace==="relationships"?"active":""} aria-current={workspace==="relationships"?"page":undefined} onClick={()=>activateWorkspace("relationships")} title={L("Find how any two registered horses are related.","ببینید دو اسب ثبت‌شده چگونه به هم خویشاوندند.")}><span className="profile-workspace-symbol" aria-hidden="true">↔</span><span>{L("Relationships","خویشاوندی")}</span></button>
        <button data-workspace="breeding" className={workspace==="breeding"?"active":""} aria-current={workspace==="breeding"?"page":undefined} onClick={()=>activateWorkspace("breeding")} title={L("Plan a mating and see the predicted inbreeding coefficient before deciding.","جفت‌گیری را برنامه‌ریزی کنید و پیش از تصمیم، ضریب هم‌خونی پیش‌بینی‌شده را ببینید.")}><span className="profile-workspace-symbol" aria-hidden="true">◇</span><span>{L("Breeding","جفت‌گیری")}</span></button>
        <button data-workspace="competitions" className={workspace==="competitions"?"active":""} aria-current={workspace==="competitions"?"page":undefined} onClick={()=>activateWorkspace("competitions")} title={L("Starts, placements and riders across events.","شروع‌ها، مقام‌ها و سوارکاران در رویدادها.")}><TrophyIcon size={17}/><span>{L("Competitions","مسابقات")}</span></button>
        <button data-workspace="racing" className={workspace==="racing"?"active":""} aria-current={workspace==="racing"?"page":undefined} onClick={()=>activateWorkspace("racing")} title={L("Racing history from the federation's official racing system (asbdavani) — provenance-stamped.","تاریخچه اسب‌دوانی از سامانه رسمی فدراسیون (اسبدوانی) — با ذکر منبع.")}><span className="profile-workspace-symbol" aria-hidden="true">⚡</span><span>{L("Racing","اسب‌دوانی")}</span></button>
        <button data-workspace="genetics" className={workspace==="genetics"?"active":""} aria-current={workspace==="genetics"?"page":undefined} onClick={()=>activateWorkspace("genetics")} title={L("Disease markers, coat colour loci and reproduction record.","نشانگرهای بیماری، لوکوس‌های رنگ و سوابق تولیدمثل.")}><DnaIcon size={17}/><span>{L("Genetics","ژنتیک")}</span></button>
        <button data-workspace="care" className={workspace==="care"?"active":""} aria-current={workspace==="care"?"page":undefined} onClick={()=>activateWorkspace("care")} title={L("Private care records require current professional permission for this horse.","سوابق مراقبت خصوصی به مجوز حرفه‌ای معتبر برای همین اسب نیاز دارد.")}><span className="profile-workspace-symbol" aria-hidden="true">+</span><span>{L("Private care","مراقبت خصوصی")}</span></button>
        <button data-workspace="media" className={workspace==="media"?"active":""} aria-current={workspace==="media"?"page":undefined} onClick={()=>activateWorkspace("media")} title={L("Photos, documents and a printable information extract (not a certificate).","عکس‌ها، مدارک و خلاصه اطلاعات قابل چاپ (نه گواهی).")}><MediaIcon size={17}/><span>{L("Media","رسانه")}</span></button>
      </nav></ContextNavigation>
    </div>
    {(workspace==="pedigree"||workspace==="all")&&<section className={`pedigree-section premium-pedigree pedigree-pane-${workspace==="all"?"all":pedigreePane}`} data-h-surface-role="panel">
      <div className="section-title pedigree-section-toolbar"><div><span>{direction==="ancestors"?t("ped.eyebrow"):t("ped.descEyebrow")}</span><h2>{workspace==="all"?L("Pedigree","تبارنامه"):pedigreePane==="visualizer"?L("Pedigree visualizer","نمایشگر تبارنامه"):L("Pedigree intelligence","تحلیل تبارنامه")}</h2><p>{workspace==="all"?L("Visual pedigree and analytical evidence together in the classic continuous dossier.","نمایش بصری تبارنامه و شواهد تحلیلی کنار هم در پرونده پیوسته کلاسیک."):pedigreePane==="visualizer"?(direction==="ancestors"?t("ped.lede"):t("ped.descLede")):L("Analytical evidence for the selected direction and generation depth.","شواهد تحلیلی برای جهت و عمق نسل انتخاب‌شده.")}</p></div><div className="pedigree-controls"><div className="segmented"><button className={direction==="ancestors"?"active":""} onClick={()=>activateDirection("ancestors")}>{t("ped.ancestors")}</button><button className={direction==="descendants"?"active":""} onClick={()=>activateDirection("descendants")}>{t("ped.descendants")}</button></div><label>{t("ped.generations")} <select value={depth} onChange={e=>setDepth(Number(e.target.value))}>{[2,3,4,5,6,7].map(x=><option key={x}>{x}</option>)}</select></label></div></div>
      {(workspace==="all"||pedigreePane==="intelligence")&&direction==="ancestors"&&<PedigreeInsightPanel horseId={id} metrics={metrics} loading={metricsLoading} coefficient={coefficient} coefficientLoading={coefficientLoading} insights={insights} insightsError={insightsError} navigate={navigate} platform={platform} />}
      {(workspace==="all"||pedigreePane==="intelligence")&&direction==="descendants"&&<DescendantInsightPanel metrics={descendantMetrics} loading={descendantMetricsLoading} />}
      {(workspace==="all"||pedigreePane==="visualizer")&&<>{pedigreeError&&<p className="graph-notice error-card">{pedigreeError}</p>}<div className="pedigree-legend"><span className="legend-sire">{t("ped.sire")}</span><span className="legend-dam">{t("ped.dam")}</span><span className="legend-repeat">{t("ped.repeat")}</span><span className="legend-cycle">{t("ped.cycle")}</span></div>{truncated&&<p className="graph-notice">{t("ped.truncated")}</p>}{tree&&<PedigreeTree node={tree} navigate={navigate}/>}</>}
    </section>}
    {(workspace==="record"||workspace==="all")&&<section className={`record-workspace record-pane-${workspace==="all"?"all":recordPane}`} data-h-surface-role="major">
      {(workspace==="all"||recordPane==="summary")&&<SourceNotes id={id} fa={locale==="fa"}/>}
      {(workspace==="all"||recordPane==="summary")&&<section className="details-grid premium-details" data-h-surface-role="panel"><article><span>{t("details.registry")}</span><h3>{t("details.summary")}</h3><dl><div><dt>{t("profile.horseNo")}</dt><dd>#{n(h.id)}</dd></div><div><dt>{t("profile.register")}</dt><dd dir="auto">{h.register_no||"—"}</dd></div><div><dt>{t("details.born")}</dt><dd>{typedDateText(profileBirth(h.birth_date_typed,h.birth_year),locale)||year(h.birth_year)}{typedDatePrecisionNote(profileBirth(h.birth_date_typed,h.birth_year),locale)?<small className="precision-note" style={{display:"block",opacity:.65}}>{typedDatePrecisionNote(profileBirth(h.birth_date_typed,h.birth_year),locale)}</small>:null}</dd></div><div><dt>{t("details.birthplace")}</dt><dd dir="auto">{h.birth_place_desc||"—"}</dd></div>{(h.birth_city||h.birth_province)&&<div><dt>{uiText(locale, "Birth city / province", "شهر/استان تولد")}</dt><dd dir="auto">{[h.birth_city,h.birth_province].filter(Boolean).join(" · ")}</dd></div>}{(h.keeping_city||h.keeping_province)&&<div><dt>{uiText(locale, "Current keeping", "محل نگهداری فعلی")}</dt><dd dir="auto">{[h.keeping_city,h.keeping_province].filter(Boolean).join(" · ")}</dd></div>}{h.death_date_typed&&<div><dt>{uiText(locale, "Death date", "تاریخ تلف")}</dt><dd>{typedDateText(h.death_date_typed,locale)}{typedDatePrecisionNote(h.death_date_typed,locale)?<small className="precision-note" style={{display:"block",opacity:.65}}>{typedDatePrecisionNote(h.death_date_typed,locale)}</small>:null}</dd></div>}</dl></article><article><span>{t("details.people")}</span><h3>{t("details.parties")}</h3>{data.people?.length?data.people.map((p)=><button className="person-link" data-href={`/person/${p.id}`} key={`${p.role}-${p.id}`} onClick={()=>navigate(`/person/${p.id}`)}><b>{partyRoleLabel(p.role,locale)}</b><span dir="auto">{p.name_latin||p.name_native||`#${p.id}`}</span><small>#{n(p.id)} ↗</small></button>):<p>{t("details.noPeople")}</p>}</article><article><span>{t("details.trust")}</span><h3>{t("details.controls")}</h3><p>{t("details.trustBody")}</p><div className="trust-badges"><span>✓ API</span><span>✓ {uiText(locale, "Host audit", "حسابرسی میزبان")}</span><span>✓ {uiText(locale, "Cycle-safe", "ایمن در برابر چرخه")}</span></div></article></section>}
      {(workspace==="all"||recordPane==="record")&&<HeritageCanonicalRecord horse={h}/>}
      {(workspace==="all"||recordPane==="summary"||recordPane==="record")&&<React.Suspense fallback={null}><SupplementaryValues key={h.id} platform={platform} horseId={h.id}/></React.Suspense>}
      {(workspace==="all"||recordPane==="claims")&&<React.Suspense fallback={<section className="panel" aria-busy="true">{uiText(locale, "Loading…", "در حال بارگذاری…")}</section>}><HeritageClaimPanel horse={h} platform={platform} platformMeta={platformMeta} user={user} permissions={permissions}/></React.Suspense>}
      {/* Master-Ai plan T05: who checked what, when, in which scope + limitations. */}
      {(workspace==="all"||recordPane==="claims")&&<React.Suspense fallback={<section className="panel" aria-busy="true">{uiText(locale, "Loading…", "در حال بارگذاری…")}</section>}><HorseAttestationsPanel horseId={h.id} platform={platform} platformMeta={platformMeta} user={user}/></React.Suspense>}
    </section>}
    {(workspace==="relationships"||workspace==="all")&&<ComparePanel horse={h} navigate={navigate} platform={platform}/>}
    {(workspace==="breeding"||workspace==="all")&&<React.Suspense fallback={<section className="panel" aria-busy="true">{uiText(locale, "Loading…", "در حال بارگذاری…")}</section>}><HeritageBreedingPanel key={`breeding:${user?.id ?? "anonymous"}:${permissions.join("+")}`} horse={h} navigate={navigate} platform={platform} platformMeta={platformMeta} user={user} permissions={permissions}/></React.Suspense>}
    {(workspace==="competitions"||workspace==="all")&&<React.Suspense fallback={<section className="panel" aria-busy="true">{uiText(locale, "Loading…", "در حال بارگذاری…")}</section>}><HorseCompetitionPanel horseId={h.id} navigate={navigate} platform={platform}/></React.Suspense>}
    {(workspace==="racing"||workspace==="all")&&<React.Suspense fallback={<section className="panel" aria-busy="true">{uiText(locale, "Loading…", "در حال بارگذاری…")}</section>}><HorseRacingPanel horseId={h.id} platform={platform}/></React.Suspense>}
    {(workspace==="genetics"||workspace==="all")&&<React.Suspense fallback={<section className="panel" aria-busy="true">{uiText(locale, "Loading…", "در حال بارگذاری…")}</section>}><HorseGeneticsPanel key={`genetics:${user?.id ?? "anonymous"}:${permissions.join("+")}`} horseId={h.id} navigate={navigate} platform={platform} user={user} permissions={permissions}/></React.Suspense>}
    {workspace==="care"&&<React.Suspense fallback={<section className="panel" aria-busy="true">{uiText(locale, "Loading private care workspace…", "در حال بارگذاری فضای مراقبت خصوصی…")}</section>}><HorseCarePanel horseId={h.id} horseName={primary} platform={platform} user={user} permissions={permissions} navigate={navigate}/></React.Suspense>}
    {(workspace==="media"||workspace==="all")&&<React.Suspense fallback={<section className="panel" aria-busy="true">{uiText(locale, "Loading…", "در حال بارگذاری…")}</section>}><HorseMediaGallery horse={h} platform={platform} user={user} permissions={permissions}/></React.Suspense>}
  </main>
}

function HeritageCanonicalRecord({horse}:{horse:Horse}){
  const {locale}=useI18n();
  const fields=publicHorseDetailFields(horse,{locale}).filter(field=>!["register_no","birth_year","birth_place_desc","breed_desc","sex_desc","color_desc","main_strain_desc","sub_strain_desc","is_active","is_dead"].includes(String(field.key)));
  const value=(field:(typeof fields)[number])=>field.kind==="boolean"?(field.value===1?(uiText(locale, "Yes", "بله")):(uiText(locale, "No", "خیر"))):localizedDigits(field.value??"—",locale);
  if(!fields.length)return null;
  return <section className="heritage-record-ledger h-glass-2" data-h-surface-role="panel"><header><span>{uiText(locale, "Canonical detail", "جزئیات مرجع")}</span><h3>{uiText(locale, "Complete public registry record", "رکورد کامل عمومی")}</h3><p>{uiText(locale, "All safe public fields currently present in the canonical record; sensitive identifiers remain staff-only.", "همه فیلدهای امن و قابل انتشار موجود در رکورد مرجع؛ شناسه‌های حساس فقط در ابزار سرپرستی نمایش داده می‌شوند.")}</p></header><dl>{fields.map(field=><div key={String(field.key)} data-group={field.group}><dt>{uiText(locale, field.label.en, field.label.fa)}</dt><dd dir="auto">{value(field)}</dd></div>)}</dl></section>;
}

function PedigreeInsightPanel({horseId,metrics,loading,coefficient,coefficientLoading,insights,insightsError,navigate,platform}:{horseId:number;metrics:PedigreeMetricsResponse|null;loading:boolean;coefficient:PedigreeCoefficientResponse|null;coefficientLoading:boolean;insights:HorseInsightsResponse|null;insightsError:boolean;navigate:(p:string)=>void;platform:PlatformClient}){
  const {t,n,locale}=useI18n();
  const [traceAncestor,setTraceAncestor]=useState<number|null>(null); const [trace,setTrace]=useState<PedigreePathResponse|null>(null); const [traceBusy,setTraceBusy]=useState(false);
  const tracePaths=async(ancestorId:number)=>{setTraceAncestor(ancestorId);setTraceBusy(true);try{setTrace(await platform.pedigree.pathsToAncestor(horseId,ancestorId,{depth:Math.max(6,metrics?.depth??6),maxPaths:8}))}catch{setTrace(null)}finally{setTraceBusy(false)}};
  const loadNotice=insightsError?<div className="pedigree-intelligence-notice" role="status"><strong>{uiText(locale, "Premium intelligence unavailable", "هوشمندی پیشرفته در دسترس نیست")}</strong><span>{uiText(locale, "Core pedigree metrics are loaded independently; reference-population and premium analysis data have not been discarded.", "شاخص‌های پایهٔ تبارنامه به‌طور مستقل بارگذاری می‌شوند؛ داده‌های جمعیت مرجع و تحلیل پیشرفته حذف نشده‌اند.")}</span></div>:null;
  if(loading&&!metrics&&!insights)return <div className="pedigree-insight pedigree-insight-loading" aria-live="polite"><span className="pedigree-insight-pulse"/><div><strong>{t("analytics.loading")}</strong><small>{t("analytics.loadingBody")}</small></div></div>;
  if(!metrics)return insights||insightsError?<section className="pedigree-insight status-partial" aria-label={t("analytics.title")}>{loadNotice}{insights&&<div className="pedigree-insight-deep pedigree-intelligence-rich"><HorseInsightStrip insights={insights}/></div>}</section>:null;
  const pct=Math.max(0,Math.min(100,metrics.completenessPercent));
  const percent=(value:number)=>localizedPercent(value,locale,1);
  const statusKey=metrics.integrity.cycleDetected?"cycle":metrics.status==="partial"?"partial":"clean";
  const repeated=metrics.topRepeatedAncestors??[];
  const deepPedigreeEvidence=Boolean(metrics.branches||repeated.length>0||coefficient||metrics.lineages||traceAncestor);
  const name=(h:{name_latin:string;name_native?:string|null})=>locale==="fa"?(h.name_native||h.name_latin):(h.name_latin||h.name_native||"");
  return <section className={`pedigree-insight status-${statusKey}`} aria-label={t("analytics.title")}>
    {loadNotice}
    <div className="pedigree-insight-score">
      <div className="pedigree-score-orb" role="progressbar" aria-label={uiText(locale, "Pedigree coverage", "پوشش تبارنامه")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} style={{background:`conic-gradient(var(--accent) ${pct}%, color-mix(in srgb,var(--line-strong) 58%,transparent) ${pct}% 100%)`}}>
        <span><strong>{percent(pct)}</strong><small>{t("analytics.coverage")}</small></span>
      </div>
      <div><span className="analytics-eyebrow">{t("analytics.eyebrow")}</span><h3>{t("analytics.title")}</h3><p>{t("analytics.lede")}</p></div>
    </div>
    <div className="pedigree-insight-facts">
      <div><small>{t("analytics.known")}</small><strong>{n(metrics.knownAncestorPositions)}<em>/ {n(metrics.expectedAncestorPositions)}</em></strong></div>
      <div><small>{t("analytics.unique")}</small><strong>{n(metrics.uniqueAncestors)}</strong></div>
      <div><small>{t("analytics.repeated")}</small><strong>{n(metrics.repeatedAncestorPositions)}</strong></div>
      <div><small>{t("analytics.depth")}</small><strong>{locale==="fa"?`${t("generation.gen")} ${n(metrics.maxKnownGeneration)}`:`G${n(metrics.maxKnownGeneration)}`}</strong></div>
    </div>
    <div className="pedigree-generation-profile">
      <header><span>{t("analytics.generations")}</span><b className={`analytics-status ${statusKey}`}>{statusKey==="cycle"?"⚠":statusKey==="partial"?"◐":"✓"} {t(`analytics.status.${statusKey}`)}</b></header>
      <div className="pedigree-generation-bars">{metrics.generations.map(g=><div className="pedigree-generation-row" key={g.generation}><span>{locale==="fa"?`${t("generation.gen")} ${n(g.generation)}`:`G${n(g.generation)}`}</span><div className="pedigree-generation-track" role="progressbar" aria-label={locale==="fa"?`پوشش نسل ${n(g.generation)}`:`Generation ${n(g.generation)} coverage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.completenessPercent)}><i style={{width:`${Math.max(0,Math.min(100,g.completenessPercent))}%`}}/></div><strong>{percent(g.completenessPercent)}</strong><small>{n(g.knownPositions)}/{n(g.expectedPositions)}</small></div>)}</div>
      <footer><span>ⓘ {t("analytics.note")}</span><small>{t("analytics.algorithm")} {metrics.provenance.algorithmVersion}</small></footer>
    </div>
    {deepPedigreeEvidence&&<div className="pedigree-insight-deep">
      {metrics.branches&&<article className="pedigree-branch-balance"><header>{t("analytics.branches")}</header>{([metrics.branches.sire,metrics.branches.dam] as const).map(branch=><div className={`pedigree-branch-row ${branch.relation}`} key={branch.relation}><span>{branch.relation==="sire"?t("analytics.sireBranch"):t("analytics.damBranch")}</span><div><i style={{width:`${Math.max(0,Math.min(100,branch.completenessPercent))}%`}}/></div><strong>{percent(branch.completenessPercent)}</strong><small>{n(branch.knownPositions)}/{n(branch.expectedPositions)}</small></div>)}</article>}
      <article className="pedigree-repeat-leaders"><header>{t("analytics.repeatLeaders")}</header>{repeated.length?<div>{repeated.slice(0,5).map(item=><div className="repeat-leader-row" key={item.horse.id}><button className="repeat-leader-horse" data-href={`/horse/${item.horse.id}`} onClick={()=>navigate(`/horse/${item.horse.id}`)}><span dir="auto"><b>{name(item.horse)}</b><small>#{n(item.horse.id)} · {t("analytics.nearest")} {n(item.nearestGeneration)}{item.generationOccurrences?.length?` · ${item.generationOccurrences.map(g=>`${locale==="fa"?`${t("generation.gen")} ${n(g.generation)}`:`G${n(g.generation)}`}${g.count>1?`×${n(g.count)}`:""}`).join(" · ")}`:""}{item.crossesBranches?` · ${t("analytics.bothBranches")}`:""}</small></span><strong>×{n(item.occurrences)}</strong><em>{percent(item.positionSharePercent)}</em></button><button className="repeat-trace-action" onClick={()=>tracePaths(item.horse.id)}>{traceAncestor===item.horse.id&&traceBusy?"…":t("analytics.trace")}</button></div>)}</div>:<p>{t("analytics.repeatNone")}</p>}</article>
      <CoefficientPanel coefficient={coefficient} loading={coefficientLoading}/>
      {metrics.lineages&&<LineageTrails lineages={metrics.lineages} navigate={navigate}/>}
      {traceAncestor&&<PedigreePathExplorer trace={trace} loading={traceBusy} navigate={navigate}/>}
    </div>}
    {insights&&<div className="pedigree-insight-deep pedigree-intelligence-rich"><HorseInsightStrip insights={insights}/></div>}
  </section>;
}

function CoefficientPanel({coefficient,loading}:{coefficient:PedigreeCoefficientResponse|null;loading:boolean}){
  const {t,n,locale}=useI18n();
  const percent=(value:number,digits=0)=>localizedPercent(value,locale,digits,digits);
  if(loading&&!coefficient)return <article className="coefficient-panel is-loading"><span className="pedigree-insight-pulse"/><div><small>{t("analytics.coi")}</small><strong>…</strong></div></article>;
  if(!coefficient)return null;
  const value=coefficient.inbreedingPercent;
  return <article className={`coefficient-panel status-${coefficient.status}`}><header><span>{t("analytics.coi")}</span><small>{t("analytics.depth8")}</small></header><div className="coefficient-value"><strong>{value==null?"—":percent(value,2)}</strong><span>{t("analytics.pedigreeEstimate")}</span></div><dl><div><dt>{t("analytics.coiCoverage")}</dt><dd>{percent(coefficient.pedigreeCompletenessPercent)}</dd></div><div><dt>{t("analytics.assumedFounders")}</dt><dd>{n(coefficient.assumedFounderNodes)}</dd></div></dl><footer>ⓘ {coefficient.status==="ok"?(coefficient.zeroWithinIncompleteAncestry?t("analytics.coiZeroIncomplete"):t("analytics.coiNote")):t("analytics.coiUnavailable")}</footer></article>;
}

function LineageTrails({lineages,navigate}:{lineages:NonNullable<PedigreeMetricsResponse["lineages"]>;navigate:(p:string)=>void}){
  const {t,n,locale}=useI18n();
  const render=(lineage:typeof lineages.tailMale,label:string)=><article className={`lineage-trail ${lineage.relation}`}><header><span>{label}</span><small>{lineage.completeToDepth?t("analytics.lineComplete"):lineage.stoppedByCycle?t("analytics.lineCycle"):t("analytics.lineBoundary")}</small></header><div>{lineage.horses.map((horse,index)=><React.Fragment key={`${lineage.relation}-${horse.id}-${index}`}>{index>0&&<i>›</i>}<button onClick={()=>navigate(`/horse/${horse.id}`)} data-href={`/horse/${horse.id}`}><b dir="auto">{primaryHorseName(horse as Horse,locale)}</b><small>#{n(horse.id)}</small></button></React.Fragment>)}</div></article>;
  return <div className="lineage-trails"><header>{t("analytics.lineages")}</header>{render(lineages.tailMale,t("analytics.tailMale"))}{render(lineages.tailFemale,t("analytics.tailFemale"))}</div>;
}

function PedigreePathExplorer({trace,loading,navigate}:{trace:PedigreePathResponse|null;loading:boolean;navigate:(p:string)=>void}){
  const {t,n}=useI18n();
  return <article className="pedigree-path-explorer"><header><span>{t("analytics.pathAtlas")}</span><small>{loading?t("analytics.pathLoading"):trace?`${n(trace.paths.length)} ${t("analytics.routes")}`:""}</small></header>{trace?.paths?.map((item,index)=><div className={`pedigree-trace-route ${item.branch??"root"}`} key={`${item.path.join("-")}-${index}`} style={{animationDelay:`${index*60}ms`}}>{item.path.map((id,i)=><React.Fragment key={`${id}-${i}`}>{i>0&&<i>→</i>}<button onClick={()=>navigate(`/horse/${id}`)}>#{n(id)}</button></React.Fragment>)}</div>)}{trace?.truncated&&<small>{t("analytics.pathTruncated")}</small>}</article>;
}

function HorseInsightStrip({insights}:{insights:HorseInsightsResponse}){
  const {t,n,locale}=useI18n();
  const [detailsOpen,setDetailsOpen]=useState(false);
  const percent=(value:number,digits=0)=>localizedPercent(value,locale,digits);
  const generation=(value:number)=>locale==="fa"?`${t("generation.gen")} ${n(value)}`:`G${n(value)}`;
  const L=(en:string,fa:string)=>uiText(locale, en, fa);
  const toggleLinkedDetails=(event:React.MouseEvent<HTMLElement>)=>{event.preventDefault();setDetailsOpen(open=>!open)};
  const disclosureSummary=(title:string)=><summary onClick={toggleLinkedDetails}>
    <span className="intelligence-disclosure-icon" aria-hidden="true">✦</span>
    <span className="intelligence-disclosure-copy"><b>{title}</b><small>{detailsOpen?L("Hide the expanded evidence in both panels","بستن شواهد بازشده در هر دو پنل"):L("Show the hidden evidence in both panels","نمایش شواهد پنهان در هر دو پنل")}</small></span>
    <span className="intelligence-disclosure-cta">{detailsOpen?L("COLLAPSE","بستن"):L("REVEAL","نمایش")}<i aria-hidden="true">⌄</i></span>
  </summary>;
  const render=(item:HorseInsightsResponse["insights"][number])=>{
    let value=""; const label=t(`insight.${item.code}`);
    if(item.code==="pedigree_coverage")value=percent(Number(item.values.completenessPercent??0));
    else if(item.code==="branch_imbalance")value=`Δ ${percent(Number(item.values.gapPercent??0))}`;
    else if(item.code==="repeated_ancestor")value=`×${n(Number(item.values.occurrences??0))}`;
    else if(item.code==="pedigree_inbreeding")value=item.values.inbreedingPercent==null?"—":percent(Number(item.values.inbreedingPercent),2);
    else if(item.code==="descendant_reach")value=n(Number(item.values.knownDescendants??0));
    else if(item.code==="tail_male_line"||item.code==="tail_female_line")value=generation(Number(item.values.knownGenerations??0));
    else value="⚠";
    return <article className={`horse-insight insight-${item.importance} insight-code-${item.code}`} key={item.code}><small>{label}</small><strong>{value}</strong></article>;
  };
  const p=insights.premiumPedigree;
  const r=insights.referencePopulation;
  return <>
    <div className="horse-insight-strip">{insights.insights.map(render)}</div>
    {p&&<section className={`horse-premium-pedigree confidence-${p.confidence.grade}`}>
      <header><span>{L("Premium pedigree intelligence","هوشمندی پیشرفته تبارنامه")}</span><b>{locale==="fa"?`سطح اعتماد: ${confidenceGradeLabel(p.confidence.grade,locale)}`:`${confidenceGradeLabel(p.confidence.grade,locale)} confidence`}</b></header>
      <div className="horse-premium-grid"><div className="metric-depth"><small>{L("Equivalent complete generations","نسل‌های کامل معادل")}</small><strong>{new Intl.NumberFormat(locale==="fa"?"fa-IR":"en-US",{maximumFractionDigits:2}).format(p.equivalentCompleteGenerations)}</strong></div><div className="metric-diversity"><small>{L("Recorded ancestor diversity","تنوع نیاکان ثبت‌شده")}</small><strong>{percent(p.ancestorDiversityPercent,1)}</strong></div><div className="metric-repetition"><small>{L("Weighted repetition burden","بار تکرار وزنی")}</small><strong>{percent(p.weightedRepeatedBurdenPercent,1)}</strong></div><div className="metric-concentration"><small>{L("Top-5 path concentration","تمرکز پنج نیای برتر")}</small><strong>{percent(p.top5RecordedPathWeightSharePercent,1)}</strong></div><div className="metric-crossbranch"><small>{L("Cross-branch repeated ancestors","نیاکان تکراری در هر دو شاخه")}</small><strong>{n(p.crossBranchRepeatedAncestorCount)}</strong></div><div className="metric-coverage"><small>{L("Weighted path coverage","پوشش وزنی مسیرها")}</small><strong>{percent(p.weightedCoveragePercent,1)}</strong></div></div>
      <details className="intelligence-disclosure intelligence-disclosure-premium" open={detailsOpen}>{disclosureSummary(L("Ancestor contribution & method","سهم نیاکان و روش محاسبه"))}<div className="horse-premium-ancestors">{p.topAncestorContributions.map(a=><button key={a.horse.id} onClick={()=>location.assign(`/horse/${a.horse.id}`)}><span dir="auto">{locale==="fa"?(a.horse.name_native||a.horse.name_latin):(a.horse.name_latin||a.horse.name_native)}</span><b>{percent(a.shareOfRecordedPathWeightPercent,2)}</b><small>×{n(a.occurrences)} · {generation(a.nearestGeneration)}{a.crossesBranches?` · ${L("both branches","هر دو شاخه")}`:""}</small></button>)}</div><p>{localizedAnalysisText(p.provenance.interpretation,locale)}</p><p>{p.confidence.reasons.map(reason=>localizedAnalysisText(reason,locale)).join(" · ")}</p></details>
    </section>}
    {r&&<ReferencePopulationHorsePanel reference={r} detailsOpen={detailsOpen} disclosureSummary={disclosureSummary}/>}
  </>;
}

function ReferencePopulationHorsePanel({reference,detailsOpen,disclosureSummary}:{reference:NonNullable<HorseInsightsResponse["referencePopulation"]>;detailsOpen:boolean;disclosureSummary:(title:string)=>React.ReactNode}){
  const {locale,n}=useI18n();
  const L=(en:string,fa:string)=>uiText(locale, en, fa);
  const pct=(v:number|null,d=1)=>v==null?"—":localizedPercent(v,locale,d);
  const mk=reference.meanKinship,lines=reference.directLines;
  const cohortLabel=localizedControlledValue(reference.cohort.label,locale,"breed")||reference.cohort.label;
  return <section className={`horse-reference-intelligence confidence-${reference.confidence.grade}`}>
    <header><div><span>{L("Reference-population intelligence","تحلیل جمعیت مرجع")}</span><h4>{cohortLabel} · {n(reference.cohort.startYear)}–{n(reference.cohort.endYear)}</h4><small className="reference-cohort-meta">{L(`population ${n(reference.cohort.populationSize)} · sample ${n(reference.cohort.sampleSize)}`,`جمعیت ${n(reference.cohort.populationSize)} · نمونه ${n(reference.cohort.sampleSize)}`)} · {reference.cohort.memberOfReferenceCohort?L("current cohort member","عضو گروه مرجع جاری"):L("historical/context record","رکورد تاریخی/زمینه‌ای")}</small></div><b>{L("Diversity preservation index","شاخص حفظ تنوع")} {new Intl.NumberFormat(locale==="fa"?"fa-IR":"en-US",{maximumFractionDigits:1}).format(reference.diversityPreservationIndex.score)}</b></header>
    <div className="horse-reference-grid"><div className="metric-kinship"><small>{L("Mean kinship to current cohort","میانگین خویشاوندی با گروه جاری")}</small><strong>{pct(mk.estimatePercent,2)}</strong><span>{mk.rarityPercentile==null?L("Not precomputed for historical/non-current record","برای رکورد تاریخی یا خارج از گروه جاری از پیش محاسبه نشده"):`${L("rarity percentile","صدک کمیابی")} ${pct(mk.rarityPercentile,0)}`}</span></div><div className="metric-rarity"><small>{L("Recorded ancestor rarity","کمیابی نیاکان ثبت‌شده")}</small><strong>{pct(reference.recordedAncestorRarity.index,1)}</strong><span>{L("cohort percentile","صدک گروه")} {pct(reference.recordedAncestorRarity.percentile,0)}</span></div><div className="metric-sire"><small>{L("Tail-male cohort share","سهم خط مستقیم پدری در گروه")}</small><strong>{pct(lines.tailMaleRootSharePercent,2)}</strong>{lines.tailMaleRootId&&<button onClick={()=>location.assign(`/horse/${lines.tailMaleRootId}`)}>#{n(lines.tailMaleRootId)} ↗</button>}</div><div className="metric-dam"><small>{L("Tail-female cohort share","سهم خط مستقیم مادری در گروه")}</small><strong>{pct(lines.tailFemaleRootSharePercent,2)}</strong>{lines.tailFemaleRootId&&<button onClick={()=>location.assign(`/horse/${lines.tailFemaleRootId}`)}>#{n(lines.tailFemaleRootId)} ↗</button>}</div></div>
    {mk.approximate95PercentSamplingInterval&&<p>{L("Nominal 95% sampling interval","بازه اسمی ۹۵٪ نمونه‌گیری")}: {pct(mk.approximate95PercentSamplingInterval[0],2)}–{pct(mk.approximate95PercentSamplingInterval[1],2)} · {L("SE","خطای معیار")} {pct(mk.standardErrorPercent,3)}</p>}
    <details className="intelligence-disclosure intelligence-disclosure-reference" open={detailsOpen}>{disclosureSummary(L("Index composition, confidence & method","ترکیب شاخص، اعتماد و روش"))}<div className="horse-reference-components">{reference.diversityPreservationIndex.components.map(x=><span key={x.code} className={`component-${x.code}`}><small>{componentCodeLabel(x.code,locale)}</small><b>{pct(x.score,1)}</b><em>×{new Intl.NumberFormat(locale==="fa"?"fa-IR":"en-US",{maximumFractionDigits:2}).format(x.nominalWeight)}</em></span>)}</div><div className="reference-method-ledger"><span><small>{L("Mean-kinship percentile","صدک میانگین خویشاوندی")}</small><b>{pct(mk.percentile,0)}</b></span><span className={`sampling-precision precision-${mk.samplingPrecision.grade}`}><small>{L("Sampling precision","دقت نمونه‌گیری")}</small><b>{confidenceGradeLabel(mk.samplingPrecision.grade,locale)}</b><em>{mk.samplingPrecision.approximate95HalfWidthPercent==null?"—":`±${pct(mk.samplingPrecision.approximate95HalfWidthPercent,2)}`}</em></span><span><small>{L("Pedigree completeness","کامل‌بودن تبارنامه")}</small><b>{pct(reference.confidence.pedigreeCompletenessPercent,1)}</b></span><span><small>{L("Kinship method","روش خویشاوندی")}</small><b>{analysisMethodLabel(mk.method,locale)}</b></span><span><small>{L("Founder assumption","فرض بنیان‌گذار")}</small><b>{founderAssumptionLabel(mk.founderAssumption,locale)}</b></span><span><small>{L("Algorithm","الگوریتم")}</small><b>{localizedDigits(reference.provenance.algorithmVersion,locale)}</b></span><span><small>{L("Source revision","نسخه منبع")}</small><b>{localizedDigits(reference.provenance.sourceRevision,locale)}</b></span></div><p>{localizedAnalysisText(mk.samplingPrecision.interpretation,locale)}</p><p>{localizedAnalysisText(reference.recordedAncestorRarity.interpretation,locale)}</p><p>{localizedAnalysisText(reference.diversityPreservationIndex.interpretation,locale)}</p><p>{reference.confidence.reasons.map(reason=>localizedAnalysisText(reason,locale)).join(" · ")}</p><p>{localizedAnalysisText(reference.provenance.interpretation,locale)}</p></details>
  </section>;
}

function RegistryPulse({analytics,navigate}:{analytics:RegistryAnalyticsResponse;navigate:(p:string)=>void}){
  const {t,n,locale}=useI18n();
  const percent=(value:number)=>localizedPercent(value,locale,0);
  const completeness=analytics.pedigree.completeness.find(x=>x.depth===4)??analytics.pedigree.completeness[0];
  const top=analytics.progeny.topParents[0];
  const ancestor=analytics.pedigree.topRepresentedAncestorsDepth4[0];
  const decades=analytics.birthDecades.filter(x=>x.count>0).slice(-10); const max=Math.max(1,...decades.map(x=>x.count));
  return <section className="registry-pulse" aria-label={t("pulse.title")}><div className="registry-pulse-head"><div><span className="section-kicker">{t("pulse.eyebrow")}</span><h2>{t("pulse.title")}</h2><p>{t("pulse.lede")}</p></div><small>{t("pulse.snapshot")} · {new Date(analytics.generatedAt).toLocaleDateString(locale==="fa"?"fa-IR":"en-US")}</small></div><div className="registry-pulse-grid"><article className="pulse-stat"><small>{t("pulse.depth4")}</small><strong>{completeness?percent(completeness.averagePercent):"—"}</strong><span>{t("pulse.avgCoverage")}</span></article><article className="pulse-stat"><small>{t("pulse.prolific")}</small><strong>{n(analytics.progeny.percentiles.p99)}+</strong><span>{t("pulse.p99")}</span></article>{top&&<button className="pulse-horse" onClick={()=>navigate(`/horse/${top.id}`)}><small>{t("pulse.topParent")}</small><strong dir="auto">{primaryHorseName(top as Horse,locale)}</strong><span>{n(top.count)} {t("pulse.children")}</span></button>}{ancestor&&<button className="pulse-horse" onClick={()=>navigate(`/horse/${ancestor.id}`)}><small>{t("pulse.represented")}</small><strong dir="auto">{primaryHorseName(ancestor as Horse,locale)}</strong><span>{n(ancestor.count)} {t("pulse.positions")}</span></button>}<article className="pulse-decades"><header><span>{t("pulse.history")}</span><small>{t("pulse.births")}</small></header><div>{decades.map(row=><span key={row.decade} title={`${row.decade}: ${row.count}`}><i style={{height:`${Math.max(3,row.count/max*100)}%`}}/><small>{locale==="fa"?`دهه ${n(row.decade)}`:String(row.decade).slice(-2)+"s"}</small></span>)}</div></article></div><footer><span>ⓘ {t("pulse.note")}</span><button onClick={()=>navigate("/stats")}>{t("nav.stats")} <b>→</b></button></footer></section>;
}

function DescendantInsightPanel({metrics,loading}:{metrics:DescendantMetricsResponse|null;loading:boolean}){
  const {t,n,locale}=useI18n();
  if(loading&&!metrics)return <div className="descendant-insight descendant-insight-loading"><span className="pedigree-insight-pulse"/><div><strong>{t("analytics.descTitle")}</strong><small>{t("analytics.descLede")}</small></div></div>;
  if(!metrics)return null;
  const maxCount=Math.max(1,...metrics.generations.map(g=>g.count));
  return <section className="descendant-insight">
    <div className="descendant-insight-head"><span className="analytics-eyebrow">{t("analytics.eyebrow")}</span><h3>{t("analytics.descTitle")}</h3><p>{t("analytics.descLede")}</p></div>
    <div className="descendant-insight-facts"><div><small>{t("analytics.children")}</small><strong>{n(metrics.directChildren)}</strong></div><div><small>{t("analytics.descendants")}</small><strong>{n(metrics.knownDescendants)}</strong></div><div><small>{t("analytics.reach")}</small><strong>{locale==="fa"?`${t("generation.gen")} ${n(metrics.maxKnownGeneration)}`:`G${n(metrics.maxKnownGeneration)}`}</strong></div></div>
    <div className="descendant-generation-profile"><header><span>{t("analytics.descProfile")}</span><small>{t("analytics.algorithm")} {metrics.provenance.algorithmVersion}</small></header><div>{metrics.generations.map(g=><div className="descendant-generation-row" key={g.generation}><b>{locale==="fa"?`${t("generation.gen")} ${n(g.generation)}`:`G${n(g.generation)}`}</b><span><i style={{width:`${g.count===0?0:Math.max(3,(g.count/maxCount)*100)}%`}}/></span><strong>{n(g.count)}</strong></div>)}</div><footer>ⓘ {metrics.truncated?t("analytics.truncated"):t("analytics.descNote")}</footer></div>
  </section>;
}

function PersonPage({id,navigate,platform}:{id:number;navigate:(p:string)=>void;platform:PlatformClient}){
  const {t,n,locale}=useI18n();
  const [attempt,retry]=useState(0);
  const [data,setData]=useState<PersonProfileResponse|null>(null);const[error,setError]=useState("");
  useEffect(()=>{const controller=new AbortController();setData(null);setError("");platform.people.get(id,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setData(value)}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)});return()=>controller.abort()},[id,platform,attempt]);
  if(error)return <main className="page"><div className="error-card" role="alert"><p>{uiText(locale,"This record could not be opened.","باز کردن این پرونده ممکن نشد.")}</p><button type="button" className="ghost" onClick={()=>retry(a=>a+1)}>{uiText(locale,"Try again","تلاش دوباره")}</button></div></main>;
  if(!data)return <main className="page"><div className="loading-line">{uiText(locale, "Loading registry person…", "در حال بارگذاری فرد مرتبط…")}</div></main>;
  const person=data.person;
  const display=locale==="fa"?(person.name_native||person.name_latin):(person.name_latin||person.name_native);
  const secondary=locale==="fa"&&person.name_native?person.name_latin:person.name_native;
  return <main className="page"><button className="back" onClick={()=>history.back()}>← {uiText(locale, "Back", "بازگشت")}</button>
    <section className="profile-hero person-hero"><div><div className="eyebrow">{uiText(locale, "REGISTRY PERSON", "فرد مرتبط با سامانه ثبت")} #{n(person.id)}</div><h1 dir="auto">{display||`#${n(person.id)}`}</h1>{secondary&&secondary!==display&&<div className="native-name" dir="auto">{secondary}</div>}</div>
      <div className="identity-card"><small>{uiText(locale, "Registry relationships", "روابط سامانه ثبت")}</small><dl><div><dt>{uiText(locale, "Owned horses", "اسب‌های تحت مالکیت")}</dt><dd>{n(person.owner_count)}</dd></div><div><dt>{uiText(locale, "Bred horses", "اسب‌های پرورش‌یافته")}</dt><dd>{n(person.breeder_count)}</dd></div><div><dt>{uiText(locale, "Importer links", "پیوندهای واردکننده")}</dt><dd>{n(person.importer_count)}</dd></div><div><dt>{uiText(locale, "Passport receiver links", "گیرنده گذرنامه")}</dt><dd>{n(person.passport_receiver_count)}</dd></div><div><dt>{uiText(locale, "Person No.", "شماره فرد")}</dt><dd>{n(person.id)}</dd></div></dl></div></section>
    <section className="results-section person-results"><div className="results-head"><h2>{uiText(locale, "Linked horses", "اسب‌های مرتبط")}</h2><span>{data.truncated?(uiText(locale, "Showing first 100 records", "نمایش ۱۰۰ رکورد نخست")):(uiText(locale, "All linked records shown", "همه رکوردهای مرتبط نمایش داده شده‌اند"))}</span></div><div className="result-grid">{data.horses.map((h,i:number)=><div className="person-horse-row" key={`${h.role}-${h.id}`}><span className="role-pill">{partyRoleLabel(h.role,locale)}</span><ResultCard horse={h} rank={i+1} onOpen={()=>navigate(`/horse/${h.id}`)}/></div>)}</div></section>
  </main>
}

function ComparePanel({horse,navigate,platform}:{horse:Horse;navigate:(p:string)=>void;platform:PlatformClient}){
  const {t,n,year,locale}=useI18n();
  const percent=(value:number,digits=0)=>localizedPercent(value,locale,digits,digits);
  const [q,setQ]=useState(""); const [options,setOptions]=useState<Horse[]>([]); const [selected,setSelected]=useState<Horse|null>(null); const [comparison,setComparison]=useState<RelationshipResponse|null>(null); const [coefficient,setCoefficient]=useState<RelationshipCoefficientResponse|null>(null); const [loading,setLoading]=useState(false);
  useEffect(()=>{if(selected||q.trim().length<2){setOptions([]);return;}const controller=new AbortController();const timer=setTimeout(()=>platform.search.horses(q,{limit:6,signal:controller.signal}).then(x=>{if(!controller.signal.aborted)setOptions(x.results.filter(x=>x.id!==horse.id) as Horse[])}).catch(()=>{}),140);return()=>{clearTimeout(timer);controller.abort()}},[q,selected,horse.id,platform]);
  const compareGeneration=useRef(0);
  const compare=async(target:Horse)=>{const generation=++compareGeneration.current;setSelected(target);setQ(primaryHorseName(target,locale));setOptions([]);setLoading(true);setCoefficient(null);try{const [relation,coeff]=await Promise.all([platform.relationships.commonAncestors(horse.id,target.id,{depth:12}),platform.relationships.coefficients(horse.id,target.id,{depth:10}).catch(()=>null)]);if(compareGeneration.current!==generation)return;setComparison(relation);setCoefficient(coeff)}finally{if(compareGeneration.current===generation)setLoading(false)}};
  const first=comparison?.commonAncestors?.[0]; const summary=comparison?.summary; const atlas=comparison?.atlas;
  const kind=summary?.kind? t(`compare.kind.${summary.kind}`):null;
  const branchLabel=(v:"sire"|"dam"|null)=>v==="sire"?t("analytics.sireBranch"):v==="dam"?t("analytics.damBranch"):t("compare.rootBranch");
  const generation=(value:number)=>locale==="fa"?`${t("generation.gen")} ${n(value)}`:`G${n(value)}`;
  return <section className="compare-section relationship-lab" data-h-surface-role="major"><div className="section-title"><div><span>{t("compare.eyebrow")}</span><h2>{t("compare.title")}</h2><p>{t("compare.lede")}</p></div></div><div className="compare-box" data-h-surface-role="panel"><div className="compare-horse"><small>{t("compare.from")}</small><strong dir="auto">{primaryHorseName(horse,locale)}</strong><span>#{n(horse.id)}</span></div><div className="compare-symbol">↔</div><div className="compare-search"><input dir="auto" value={q} onChange={e=>{setQ(e.target.value);setSelected(null);setComparison(null);setCoefficient(null)}} placeholder={t("compare.placeholder")}/>{options.length>0&&<div className="compare-options">{options.map(o=><button key={o.id} onClick={()=>compare(o)}><strong dir="auto">{primaryHorseName(o,locale)}</strong><span>#{n(o.id)}{o.birth_year?` · ${year(o.birth_year)}`:""}</span></button>)}</div>}</div></div>{loading&&<p className="compare-status">{t("compare.tracing")}</p>}{comparison&&<div className="relationship-result relationship-atlas-result" data-h-surface-role="panel">{summary&&<div className="relationship-kind"><small>{t("compare.connection")}</small><strong>{kind}</strong><span>{n(summary.commonAncestorCount)} {t("compare.commonCount")}</span></div>}{coefficient&&<div className={`relationship-coefficients status-${coefficient.status}`}><div><small>{t("compare.relationshipCoefficient")}</small><strong>{coefficient.relationshipPercent==null?"—":percent(coefficient.relationshipPercent,2)}</strong></div><div><small>{t("compare.kinship")}</small><strong>{coefficient.kinshipPercent==null?"—":percent(coefficient.kinshipPercent,2)}</strong></div><div><small>{t("compare.coveragePair")}</small><strong>{percent(coefficient.fromPedigreeCompletenessPercent)} · {percent(coefficient.toPedigreeCompletenessPercent)}</strong></div><p>ⓘ {t("compare.coeffNote")}</p></div>}{first?<><div className="closest-common"><small>{t("compare.closest")}</small><button dir="auto" onClick={()=>navigate(`/horse/${first.horse.id}`)}>{primaryHorseName(first.horse as Horse,locale)}</button><span>#{n(first.horse.id)}</span></div><div className="relationship-depths"><span dir="auto">{primaryHorseName(horse,locale)} <b>{n(first.fromDepth)}</b> {t("compare.generations")}</span><span dir="auto">{selected&&primaryHorseName(selected,locale)} <b>{n(first.toDepth)}</b> {t("compare.generations")}</span></div></>:summary?.kind==="direct_ancestor"||summary?.kind==="direct_descendant"?null:<p>{t("compare.none")}</p>}{atlas?.connections?.length?<div className="relationship-path-atlas"><header><span>{t("compare.atlas")}</span><small>{n(atlas.tracedConnectionCount)} {t("compare.tracedRoutes")}</small></header>{atlas.connections.slice(0,6).map((path,index)=><article key={`${path.via.id}-${index}`} style={{animationDelay:`${Math.min(index*55,275)}ms`}}><button onClick={()=>navigate(`/horse/${path.via.id}`)} dir="auto">{primaryHorseName(path.via as Horse,locale)}</button><span>{branchLabel(path.fromBranch)} · {generation(path.fromDepth)}</span><i>↔</i><span>{branchLabel(path.toBranch)} · {generation(path.toDepth)}</span><em>Σ {n(path.totalDepth)}</em></article>)}{atlas.pathEnumerationTruncated&&<small className="atlas-truncated">{t("compare.moreRoutes")}</small>}</div>:null}{summary?.integrity.cycleDetected&&<p className="relationship-warning">⚠ {t("analytics.status.cycle")}</p>}</div>}</section>
}

type PedLayoutItem={key:string;node:PedigreeNode;x:number;y:number;width:number};
type PedLayoutEdge={key:string;from:string;to:string;relation:PedigreeNode["relation"];repeated:boolean;cycle:boolean};
type PedLayout={items:PedLayoutItem[];edges:PedLayoutEdge[];width:number;height:number;maxGeneration:number;repeats:number;cycles:number;ancestorMode:boolean};
const PED_NODE_W=228; const PED_ROOT_W=168; const PED_NODE_H=112; const PED_COL_STEP=292; const PED_ROW_STEP=132; const PED_TOP=68; const PED_SIDE=24;

function pedigreeBranches(node:PedigreeNode):PedigreeNode[]{return node.parents?.length?node.parents:(node.children??[])}
function pedigreeMaxGeneration(node:PedigreeNode):number { const branches=pedigreeBranches(node); return branches.length?Math.max(node.generation,...branches.map(pedigreeMaxGeneration)):node.generation; }
function buildPedigreeLayout(root:PedigreeNode,isRTL:boolean):PedLayout {
  const maxGeneration=pedigreeMaxGeneration(root); let leaf=0; const temp:Array<{key:string;node:PedigreeNode;y:number}>=[]; const edges:PedLayoutEdge[]=[];
  const walk=(node:PedigreeNode,key:string,parentKey?:string):number=>{
    const branches=pedigreeBranches(node); let center:number;
    if(branches.length){const centers=branches.map((child,index)=>walk(child,`${key}.${index}`,key));center=(Math.min(...centers)+Math.max(...centers))/2;}
    else{center=PED_TOP+PED_NODE_H/2+(leaf++*PED_ROW_STEP);}
    temp.push({key,node,y:center-PED_NODE_H/2});
    if(parentKey)edges.push({key:`${parentKey}>${key}`,from:parentKey,to:key,relation:node.relation,repeated:node.repeated,cycle:node.cycle});
    return center;
  };
  walk(root,"root");
  const ancestorMode=Boolean(root.parents?.length);
  const leafCount=Math.max(leaf,1);
  // R151: the canvas must hug the rendered cards. The old formula reserved a
  // full extra row (leafCount*PED_ROW_STEP) plus padding beyond the deepest
  // card, so scrolling past the last generation revealed dead empty space.
  const lastCardBottom=PED_TOP+PED_NODE_H+(leafCount-1)*PED_ROW_STEP;
  const height=Math.max(300,lastCardBottom+36);
  // Map mode is a horizontal generation graph. The focal horse stays centered
  // between its sire/dam branches and the parents keep their own generation
  // column. The focal-above-parents composition belongs to Lineage mode only;
  // applying it to Map created the very long vertical trunk visible in v0.42.3.
  const width=PED_SIDE*2+PED_NODE_W+maxGeneration*PED_COL_STEP;
  const ltrX=(generation:number)=>{
    if(!ancestorMode||generation>0)return PED_SIDE+generation*PED_COL_STEP;
    return PED_SIDE+Math.round((PED_COL_STEP-PED_ROOT_W)/2);
  };
  const items=temp.map(entry=>{const itemWidth=ancestorMode&&entry.node.generation===0?PED_ROOT_W:PED_NODE_W;const logical=ltrX(entry.node.generation);return {key:entry.key,node:entry.node,x:isRTL?width-logical-itemWidth:logical,y:entry.y,width:itemWidth}});
  return {items,edges,width,height,maxGeneration,ancestorMode,repeats:items.filter(x=>x.node.repeated).length,cycles:items.filter(x=>x.node.cycle).length};
}

function PedigreeLedgerBranch({node,navigate,isRoot=false,includeChildren=true}:{node:PedigreeNode;navigate:(p:string)=>void;isRoot?:boolean;includeChildren?:boolean}){
  const {t,n:fmt,year,locale}=useI18n();
  const children=pedigreeBranches(node);
  const horse=node.horse;
  const primary=primaryHorseName(horse,locale);
  const relationLabel=isRoot?t("generation.self"):t(`relation.${node.relation}`);
  return <div className={`ped-ledger-item relation-${node.relation}${isRoot?" is-root":""}${node.repeated?" repeated":""}${node.cycle?" cycle":""}`}>
    <button className="ped-ledger-row" onClick={()=>navigate(`/horse/${horse.id}`)}>
      <span className="ped-ledger-relation"><i aria-hidden="true"></i><b>{relationLabel}</b></span>
      <span className="ped-ledger-name" dir="auto"><strong>{primary}</strong></span>
      <span className="ped-ledger-meta"><b>#{fmt(horse.id)}</b>{horse.birth_year&&<span>{year(horse.birth_year)}</span>}{node.repeated&&<em>×2</em>}{node.cycle&&<em className="cycle-mark">!</em>}</span>
    </button>
    {includeChildren&&children.length>0&&<div className="ped-ledger-children">{children.map((child,index)=><PedigreeLedgerBranch key={`${horse.id}-${child.horse.id}-${child.relation}-${index}`} node={child} navigate={navigate}/>)}</div>}
  </div>;
}


type RadialPedigreeSlice={node:PedigreeNode;generation:number;slot:number;slots:number;key:string};
type RadialLabelMode="name-id"|"name"|"id"|"none";
function collectRadialPedigree(root:PedigreeNode,maxDepth:number):RadialPedigreeSlice[]{
  const slices:RadialPedigreeSlice[]=[];
  const visit=(current:PedigreeNode,generation:number,slot:number,key:string)=>{
    if(generation>maxDepth)return;
    if(generation>0)slices.push({node:current,generation,slot,slots:2**generation,key});
    const parents=current.parents??[];
    const father=parents.find(parent=>parent.relation==="father");
    const mother=parents.find(parent=>parent.relation==="mother");
    if(father)visit(father,generation+1,slot*2,`${key}.f`);
    if(mother)visit(mother,generation+1,slot*2+1,`${key}.m`);
  };
  visit(root,0,0,"root");
  return slices;
}
function polar(cx:number,cy:number,r:number,angle:number){const a=(angle-90)*Math.PI/180;return{x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)}}
function annularSectorPath(cx:number,cy:number,inner:number,outer:number,start:number,end:number){
  const a=polar(cx,cy,outer,start),b=polar(cx,cy,outer,end),c=polar(cx,cy,inner,end),d=polar(cx,cy,inner,start);const large=end-start>180?1:0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${outer} ${outer} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} L ${c.x.toFixed(2)} ${c.y.toFixed(2)} A ${inner} ${inner} 0 ${large} 0 ${d.x.toFixed(2)} ${d.y.toFixed(2)} Z`;
}
function radialLabelMode(actualArcPx:number,generation:number):RadialLabelMode{
  if(actualArcPx>=142&&generation<=4)return "name-id";
  if(actualArcPx>=82)return "name";
  if(actualArcPx>=54)return "id";
  return "none";
}
function radialNameLayout(name:string,actualArcPx:number,generation:number){
  const clean=name.replace(/\s+/g," ").trim();
  const persian=/[\u0600-\u06ff]/.test(clean);
  const averageGlyph=persian?6.7:/[A-Z]{2,}/.test(clean)?7.7:7.1;
  const edgeReserve=generation<=2?22:16;
  const budget=Math.max(34,actualArcPx-edgeReserve);
  const naturalWidth=Math.max(1,clean.length*averageGlyph);
  if(naturalWidth<=budget)return{text:clean,scale:1};
  const scale=Math.max(.78,Math.min(1,budget/naturalWidth));
  if(scale>.82)return{text:clean,scale};
  const maxChars=Math.max(5,Math.floor(budget/(averageGlyph*.9)));
  if(clean.length<=maxChars)return{text:clean,scale:.82};
  const raw=clean.slice(0,Math.max(4,maxChars-1)).trimEnd();
  const wordCut=raw.lastIndexOf(" ");
  const shortened=wordCut>=Math.floor(raw.length*.58)?raw.slice(0,wordCut):raw;
  return{text:`${shortened}…`,scale:1};
}
function RadialPedigree({node,navigate}:{node:PedigreeNode;navigate:(p:string)=>void}){
  const {t,n,year,locale}=useI18n();
  const maxDepth=Math.min(6,Math.max(1,...collectRadialPedigree(node,6).map(x=>x.generation)));
  const slices=useMemo(()=>collectRadialPedigree(node,maxDepth),[node,maxDepth]);
  const size=1000,c=size/2,core=88,edgeInset=4,ring=(c-core-edgeInset)/Math.max(1,maxDepth);
  const rootName=primaryHorseName(node.horse,locale);
  const hostRef=useRef<HTMLDivElement|null>(null);
  const [baseDiameter,setBaseDiameter]=useState(760);
  const [radialZoom,setRadialZoom]=useState(1);
  useEffect(()=>{
    const measure=()=>{const el=hostRef.current;if(!el)return;const availableW=Math.max(280,el.clientWidth-8);const availableH=Math.max(300,el.clientHeight-8);setBaseDiameter(Math.floor(Math.min(availableW,availableH,920)))};
    measure();const ro=new ResizeObserver(measure);if(hostRef.current)ro.observe(hostRef.current);window.addEventListener("resize",measure);return()=>{ro.disconnect();window.removeEventListener("resize",measure)}
  },[]);
  const diameter=Math.max(250,Math.round(baseDiameter*radialZoom));
  const visualScale=Math.max(.28,diameter/size);
  const radialTypeVars={"--ped-radial-name-size":`${(13.5/Math.max(.72,visualScale)).toFixed(2)}px`,"--ped-radial-id-size":`${(12/Math.max(.72,visualScale)).toFixed(2)}px`,"--ped-radial-core-size":`${(15.5/Math.max(.72,visualScale)).toFixed(2)}px`,"--ped-radial-core-id-size":`${(12.5/Math.max(.72,visualScale)).toFixed(2)}px`} as React.CSSProperties;
  const rootMaxChars=baseDiameter>=680?24:baseDiameter>=520?20:16;
  return <section className="pedigree-radial pedigree-visual-stage" aria-label={t("ped.radial")}>
    <header className="pedigree-radial-head"><div><span>{t("ped.radial")}</span><strong>{t("ped.radialHint")}</strong></div><div className="pedigree-radial-actions"><div className="pedigree-radial-key"><i className="sire"/>{t("result.sire")}<i className="dam"/>{t("result.dam")}</div><div className="pedigree-radial-zoom" role="group" aria-label="Radial zoom"><button type="button" onClick={()=>setRadialZoom(v=>Math.max(.7,Math.round((v-.1)*10)/10))}>−</button><button type="button" onClick={()=>setRadialZoom(1)}>{Math.round(radialZoom*100)}%</button><button type="button" onClick={()=>setRadialZoom(v=>Math.min(1.5,Math.round((v+.1)*10)/10))}>+</button></div></div></header>
    <div ref={hostRef} className={`pedigree-radial-host${radialZoom>1?" is-zoomed-in":" is-fit"}`}><div className="pedigree-radial-stage" style={{width:diameter,height:diameter,...radialTypeVars}}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${t("ped.radial")} · ${rootName}`}>
        <defs><filter id="heritage-radial-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {Array.from({length:maxDepth},(_,i)=><circle key={`ring-${i}`} className={`radial-guide generation-${i+1}`} cx={c} cy={c} r={core+(i+1)*ring}/>) }
        {slices.map(slice=>{const span=360/slice.slots;const gap=Math.min(1.6,span*.055);const start=-90+slice.slot*span+gap;const end=-90+(slice.slot+1)*span-gap;const inner=core+(slice.generation-1)*ring+5;const outer=core+slice.generation*ring-2;const mid=(start+end)/2;const labelR=(inner+outer)/2;const pos=polar(c,c,labelR,mid);const horse=slice.node.horse;const relation=slice.node.relation;const name=primaryHorseName(horse,locale);const arcLengthPx=((Math.max(1,end-start)*Math.PI/180)*labelR)*visualScale;const labelMode=radialLabelMode(arcLengthPx,slice.generation);const labelLayout=radialNameLayout(name,arcLengthPx,slice.generation);const shortName=labelLayout.text;return <g key={slice.key} style={{["--ped-radial-slice-scale"]:String(labelLayout.scale)} as HeritageCSSProperties} className={`radial-slice generation-${slice.generation} relation-${relation} label-${labelMode}${slice.node.repeated?" repeated":""}${slice.node.cycle?" cycle":""}`} role="link" tabIndex={0} onClick={()=>navigate(`/horse/${horse.id}`)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();navigate(`/horse/${horse.id}`)}}}><title>{`${name} · #${n(horse.id)}${horse.birth_year?` · ${year(horse.birth_year)}`:""}`}</title><path d={annularSectorPath(c,c,inner,outer,start,end)}/>{labelMode!=="none"&&<text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${mid>90&&mid<270?mid+180:mid},${pos.x},${pos.y})`}>{labelMode!=="id"&&<tspan x={pos.x} dy={labelMode==="name-id"?"-0.15em":"0"}>{shortName}</tspan>}{(labelMode==="name-id"||labelMode==="id")&&<tspan x={pos.x} dy={labelMode==="name-id"?"1.25em":"0"} className="radial-id">#{n(horse.id)}</tspan>}</text>}</g>})}
        <g className="radial-core" role="link" tabIndex={0} onClick={()=>navigate(`/horse/${node.horse.id}`)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();navigate(`/horse/${node.horse.id}`)}}}><circle cx={c} cy={c} r={core-12}/><text x={c} y={c-10} textAnchor="middle"><tspan x={c}>{rootName.length>rootMaxChars?`${rootName.slice(0,Math.max(8,rootMaxChars-2))}…`:rootName}</tspan><tspan className="radial-id" x={c} dy="1.45em">#{n(node.horse.id)}</tspan></text></g>
      </svg>
    </div></div>
    <footer>{t("ped.radialFoot")}</footer>
  </section>;
}

function PedigreeTree({node,navigate}:{node:PedigreeNode;navigate:(p:string)=>void}){
  const {t,n,year,isRTL,locale}=useI18n();
  const layout=useMemo(()=>buildPedigreeLayout(node,isRTL),[node,isRTL]);
  const byKey=useMemo(()=>new Map(layout.items.map(item=>[item.key,item])),[layout.items]);
  const shellRef=useRef<HTMLDivElement>(null);
  const viewportRef=useRef<HTMLDivElement>(null);
  const [fitMode,setFitMode]=useState<PedFitMode>("all");
  const [fitScale,setFitScale]=useState(1);
  const [fitViewportHeight,setFitViewportHeight]=useState(620);
  const [isFullscreen,setIsFullscreen]=useState(false);
  const [activeKey,setActiveKey]=useState<string|null>(null);
  const [activeHorseId,setActiveHorseId]=useState<number|null>(null);
  const [mobilePedView,setMobilePedView]=useState<PedMobileView>("compact");
  const [desktopPedView,setDesktopPedView]=useState<"map"|"radial"|"lineage">("map");
  useEffect(()=>{
    const viewport=viewportRef.current;if(!viewport)return;
    const calculate=()=>{
      const vv=window.visualViewport;const viewportHeight=vv?.height??window.innerHeight;const rect=viewport.getBoundingClientRect();
      const availableW=Math.max(260,viewport.clientWidth-20);
      const remaining=Math.max(0,viewportHeight-Math.max(0,rect.top)-20);
      const availableH=Math.max(440,Math.min(viewportHeight*.84,Math.max(remaining,viewportHeight*.56)));
      setFitViewportHeight(availableH);
      setFitScale(fitScaleForBox(fitMode,availableW,availableH,layout.width,layout.height));
    };
    calculate();
    const observer=new ResizeObserver(calculate);observer.observe(viewport);
    addEventListener("resize",calculate);window.visualViewport?.addEventListener("resize",calculate);return()=>{observer.disconnect();removeEventListener("resize",calculate);window.visualViewport?.removeEventListener("resize",calculate)};
  },[fitMode,layout.width,layout.height,mobilePedView,isFullscreen]);
  useEffect(()=>{
    const sync=()=>setIsFullscreen(document.fullscreenElement===shellRef.current);
    document.addEventListener("fullscreenchange",sync);
    return()=>document.removeEventListener("fullscreenchange",sync);
  },[]);
  const toggleFullscreen=async()=>{
    const shell=shellRef.current;if(!shell)return;
    try{if(document.fullscreenElement)await document.exitFullscreen();else await shell.requestFullscreen();}catch{}
  };
  const generationLabel=(generation:number)=>{
    if(generation===0)return t("generation.self");
    const ancestorMode=Boolean(node.parents?.length);
    if(ancestorMode&&generation===1)return t("generation.parents");
    if(ancestorMode&&generation===2)return t("generation.grandparents");
    if(!ancestorMode&&generation===1)return t("generation.children");
    if(!ancestorMode&&generation===2)return t("generation.grandchildren");
    return `${t("generation.gen")} ${n(generation)}`;
  };
  const mobileGenerations=useMemo(()=>Array.from({length:layout.maxGeneration+1},(_,generation)=>({generation,items:layout.items.filter(item=>item.node.generation===generation).sort((a,b)=>a.y-b.y)})),[layout.items,layout.maxGeneration]);
  const fitted=fitMode!=="actual";const scaledW=Math.round(layout.width*fitScale);const scaledH=Math.round(layout.height*fitScale);
  // Outside fullscreen, fitted maps hug the rendered pedigree instead of
  // reserving a tall viewport that becomes dead space below short trees.
  // R151: actual-size maps hug too — the viewport never extends more than a
  // small margin past the deepest card, so the scroller cannot wander into
  // emptiness below the last row. Fullscreen and explicit fit-height keep the
  // full workspace height so the map fills the screen there.
  const renderedViewportHeight=(isFullscreen||fitMode==="height")
    ?fitViewportHeight
    :Math.min(fitViewportHeight,Math.max(340,(fitted?scaledH:layout.height)+24));
  const stageOffsetY=fitted&&scaledH<renderedViewportHeight?Math.max(0,Math.round((renderedViewportHeight-scaledH)/2)):0;
  // Map typography belongs to the canvas. Fit/zoom scales cards and text together
  // so compact views remain proportionally coherent instead of keeping giant text.
  const pedigreeTypeVars={
    "--ped-map-label-size":"12.5px",
    "--ped-map-primary-size":"16px",
    "--ped-map-secondary-size":"12.5px",
    "--ped-map-meta-size":"12px",
  } as React.CSSProperties;
  const fitButtons:Array<[PedFitMode,string,string]>=[["all",t("ped.fitAll"),"⌗"],["width",t("ped.fitWidth"),"↔"],["height",t("ped.fitHeight"),"↕"],["actual",t("ped.actual"),"100"]];
  return <div ref={shellRef} style={pedigreeTypeVars} data-h-surface-role="panel" className={`pedigree-map-shell${fitted?" fit-mode":""}${isFullscreen?" is-fullscreen":""}${fitScale<.46?" lod-micro":fitScale<.68?" lod-compact":""} mobile-${mobilePedView} desktop-${desktopPedView}`}>
    <div className="ped-desktop-view-switch" role="group" aria-label={t("ped.desktopView")}><button className={desktopPedView==="map"?"active":""} onClick={()=>setDesktopPedView("map")}><PedigreeIcon size={15}/>{t("ped.mapView")}</button>{layout.ancestorMode&&<button className={desktopPedView==="radial"?"active":""} onClick={()=>setDesktopPedView("radial")}><span aria-hidden="true">◉</span>{t("ped.radial")}</button>}<button className={desktopPedView==="lineage"?"active":""} onClick={()=>setDesktopPedView("lineage")}><span aria-hidden="true">☷</span>{t("ped.compact")}</button><button className="ped-fullscreen-toggle" onClick={toggleFullscreen} title={locale==="fa"?(isFullscreen?"خروج از تمام‌صفحه":"تمام‌صفحه"):(isFullscreen?"Exit fullscreen":"Fullscreen")} aria-label={locale==="fa"?(isFullscreen?"خروج از تمام‌صفحه":"تمام‌صفحه"):(isFullscreen?"Exit fullscreen":"Fullscreen")}><span aria-hidden="true">{isFullscreen?"⊡":"⛶"}</span></button></div>
    {layout.ancestorMode&&<div className="pedigree-radial-view pedigree-visual-stage"><RadialPedigree node={node} navigate={navigate}/></div>}
    <div className="pedigree-desktop-lineage">
      <div className="ped-ledger-head"><span><b>{t("ped.compact")}</b><small>{n(layout.items.length)} {t("ped.nodes")}</small></span><span className="ped-ledger-key"><i className="sire"></i>{t("result.sire")}<i className="dam"></i>{t("result.dam")}</span></div>
      <div className="ped-ledger-tree pedigree-visual-stage">
        <div className="ped-ledger-root-head"><PedigreeLedgerBranch node={node} navigate={navigate} isRoot includeChildren={false}/></div>
        {pedigreeBranches(node).length>0&&<div className={`ped-ledger-root-branches${layout.ancestorMode?" ancestry":" descendants"}`}>{pedigreeBranches(node).map((branch,index)=><PedigreeLedgerBranch key={`desktop-${node.horse.id}-${branch.horse.id}-${branch.relation}-${index}`} node={branch} navigate={navigate}/>)}</div>}
      </div>
    </div>
    <div className="ped-mobile-view-switch" role="group" aria-label={t("ped.mobileView")}><button className={mobilePedView==="compact"?"active":""} onClick={()=>setMobilePedView("compact")}>{t("ped.compact")}</button><button className={mobilePedView==="readable"?"active":""} onClick={()=>setMobilePedView("readable")}>{t("ped.readable")}</button><button className={mobilePedView==="vertical"?"active":""} onClick={()=>setMobilePedView("vertical")}>{t("ped.vertical")}</button><button className={mobilePedView==="map"?"active":""} onClick={()=>setMobilePedView("map")}>{t("ped.mapView")}</button>{layout.ancestorMode&&<button className={mobilePedView==="radial"?"active":""} onClick={()=>setMobilePedView("radial")}>{t("ped.radial")}</button>}<button className="ped-fullscreen-toggle" onClick={toggleFullscreen} title={locale==="fa"?(isFullscreen?"خروج از تمام‌صفحه":"تمام‌صفحه"):(isFullscreen?"Exit fullscreen":"Fullscreen")} aria-label={locale==="fa"?(isFullscreen?"خروج از تمام‌صفحه":"تمام‌صفحه"):(isFullscreen?"Exit fullscreen":"Fullscreen")}><span aria-hidden="true">{isFullscreen?"⊡":"⛶"}</span></button></div>
    <div className="pedigree-mobile-compact">
      <div className="ped-ledger-head"><span><b>{t("ped.compact")}</b><small>{n(layout.items.length)} {t("ped.nodes")}</small></span><span className="ped-ledger-key"><i className="sire"></i>{t("result.sire")}<i className="dam"></i>{t("result.dam")}</span></div>
      <div className="ped-ledger-tree"><PedigreeLedgerBranch node={node} navigate={navigate} isRoot/></div>
    </div>
    <div className="pedigree-mobile-readable">
      <div className="ped-mobile-summary"><span><strong>{n(layout.items.length)}</strong>{t("ped.nodes")}</span><span className={layout.repeats?"has-repeat":""}><strong>{n(layout.repeats)}</strong>{t("ped.repeats")}</span>{layout.cycles>0&&<span className="has-cycle"><strong>{n(layout.cycles)}</strong>{t("ped.cycles")}</span>}</div>
      <div className="ped-mobile-generations">{mobileGenerations.map(group=><section className="ped-mobile-generation" key={group.generation}><header><strong>{generationLabel(group.generation)}</strong><span>{n(group.items.length)}</span></header><div className="ped-mobile-card-row">{group.items.map(item=>{const horse=item.node.horse;const sex=normalizeSexClass(horse.sex_desc);const primary=primaryHorseName(horse,locale);const secondary=secondaryHorseName(horse,locale);return <button className={`ped-mobile-card relation-${item.node.relation}${item.node.repeated?" repeated":""}${item.node.cycle?" cycle":""}`} key={item.key} onClick={()=>navigate(`/horse/${horse.id}`)}><span className="ped-mobile-accent"></span><span className="ped-mobile-card-top"><small>{t(`relation.${item.node.relation}`)}</small><span className={`ped-sex-chip ${sex}`}><b>{sexSymbol(horse.sex_desc)}</b><span className="sex-label">{sexLabel(horse.sex_desc,locale)}</span></span></span><strong dir="auto">{primary}</strong>{secondary&&<span className="ped-mobile-secondary" dir="auto">{secondary}</span>}<span className="ped-mobile-card-bottom"><b>#{n(horse.id)}</b>{horse.birth_year&&<span>{year(horse.birth_year)}</span>}{item.node.repeated&&<em>{t("relation.repeat")}</em>}</span></button>})}</div></section>)}</div>
    </div>
    <div className="pedigree-mobile-vertical">
      <div className="ped-mobile-summary"><span><strong>{n(layout.items.length)}</strong>{t("ped.nodes")}</span><span className={layout.repeats?"has-repeat":""}><strong>{n(layout.repeats)}</strong>{t("ped.repeats")}</span>{layout.cycles>0&&<span className="has-cycle"><strong>{n(layout.cycles)}</strong>{t("ped.cycles")}</span>}</div>
      <div className="ped-vertical-stack">{mobileGenerations.map(group=><section className="ped-vertical-generation" key={`vertical-${group.generation}`}><header><strong>{generationLabel(group.generation)}</strong><span>{n(group.items.length)}</span></header><div className="ped-vertical-grid">{group.items.map(item=>{const horse=item.node.horse;const sex=normalizeSexClass(horse.sex_desc);const primary=primaryHorseName(horse,locale);const secondary=secondaryHorseName(horse,locale);return <button className={`ped-vertical-card relation-${item.node.relation}${item.node.repeated?" repeated":""}${item.node.cycle?" cycle":""}`} key={`v-${item.key}`} onClick={()=>navigate(`/horse/${horse.id}`)}><span className="ped-mobile-accent"></span><span className="ped-vertical-top"><small>{t(`relation.${item.node.relation}`)}</small><span className={`ped-sex-chip ${sex}`}><b>{sexSymbol(horse.sex_desc)}</b></span></span><strong dir="auto">{primary}</strong>{secondary&&<span className="ped-mobile-secondary" dir="auto">{secondary}</span>}<span className="ped-vertical-bottom"><b>#{n(horse.id)}</b>{horse.birth_year&&<span>{year(horse.birth_year)}</span>}</span></button>})}</div></section>)}</div>
    </div>
    <div className="pedigree-map-visual">
      <div className="pedigree-map-meta" data-h-surface-role="panel"><div><strong>{n(layout.items.length)}</strong><span>{t("ped.nodes")}</span></div><div className={layout.repeats?"has-repeat":""}><strong>{n(layout.repeats)}</strong><span>{t("ped.repeats")}</span></div><div className={layout.cycles?"has-cycle":""}><strong>{n(layout.cycles)}</strong><span>{t("ped.cycles")}</span></div><p>{t("ped.tip")}</p><div className="ped-fit-group" role="group" aria-label={t("ped.fit")}><span className="ped-fit-scale">{new Intl.NumberFormat(locale==="fa"?"fa-IR":"en-US").format(Math.round(fitScale*100))}%</span>{fitButtons.map(([mode,label,icon])=><button key={mode} className={`ped-fit-toggle${fitMode===mode?" active":""}`} onClick={()=>setFitMode(mode)} title={label} aria-label={`${icon} ${label}`}><b>{icon}</b>{" "}<span>{label}</span></button>)}</div></div>
      <div ref={viewportRef} className="pedigree-scroll modern-pedigree pedigree-visual-stage" dir="ltr" style={fitted?{height:renderedViewportHeight}:undefined}>
        <div className="pedigree-fit-stage" style={fitted?{width:scaledW,height:scaledH,margin:`${stageOffsetY}px auto 0`}:{width:layout.width,height:layout.height}}>
          <div className={`pedigree-canvas${isRTL?" is-rtl":""}`} style={{width:layout.width,height:layout.height,transform:fitted?`scale(${fitScale})`:undefined,transformOrigin:"top left"}}>
            {Array.from({length:layout.maxGeneration+1},(_,generation)=>{if(layout.ancestorMode&&generation===0)return null;const item=layout.items.find(entry=>entry.node.generation===generation);if(!item)return null;return <div key={generation} className="generation-label" style={{left:item.x,width:item.width}}>{generationLabel(generation)}</div>})}
            <svg className="pedigree-edges" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
              {layout.edges.map(edge=>{const from=byKey.get(edge.from);const to=byKey.get(edge.to);if(!from||!to)return null;const x1=isRTL?from.x:from.x+from.width;const x2=isRTL?to.x+to.width:to.x;const y1=from.y+PED_NODE_H/2;const y2=to.y+PED_NODE_H/2;const mid=x1+(x2-x1)*.5;const d=`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;const onPath=Boolean(activeKey&&(activeKey===edge.to||activeKey.startsWith(`${edge.to}.`)));const interaction=activeKey?(onPath?" path-active":" path-dim"):"";const classes=`relation-${edge.relation}${edge.repeated?" repeated":""}${edge.cycle?" cycle":""}${interaction}`;return <path key={edge.key} className={`ped-edge-flow ${classes}`} d={d}/>})}
            </svg>
            {layout.items.map(item=>{const onPath=Boolean(activeKey&&(activeKey===item.key||activeKey.startsWith(`${item.key}.`)));const sameHorse=activeHorseId!=null&&item.node.horse.id===activeHorseId;const interaction=activeKey?(onPath?" path-active":" path-dim"):"";return <PedigreeCard key={item.key} item={item} navigate={navigate} interactionClass={`${interaction}${sameHorse?" same-horse":""}`} onHover={(key,horseId)=>{setActiveKey(key);setActiveHorseId(horseId)}} onLeave={()=>{setActiveKey(null);setActiveHorseId(null)}}/>}) }
          </div>
        </div>
      </div>
    </div>
  </div>
}

function PedigreeCard({item,navigate,interactionClass="",onHover,onLeave}:{item:PedLayoutItem;navigate:(p:string)=>void;interactionClass?:string;onHover?:(key:string,horseId:number)=>void;onLeave?:()=>void}){
  const {t,n,locale}=useI18n(); const horse=item.node.horse; const primary=primaryHorseName(horse,locale); const sex=normalizeSexClass(horse.sex_desc);
  const normalizedPrimary=primary.replace(/\s+/g," ").trim();
  const primaryLen=normalizedPrimary.length;
  const hasDenseLatin=/[A-Z]/.test(normalizedPrimary) && /\s/.test(normalizedPrimary);
  const primaryScale=primaryLen>40?.72:primaryLen>32?.80:primaryLen>24||hasDenseLatin?.9:1;
  return <button className={`ped-card sex-${sex} relation-${item.node.relation}${item.node.generation===0?" focal-junction":""}${item.node.repeated?" repeated":""}${item.node.cycle?" cycle":""}${interactionClass}`} style={{left:item.x,top:item.y,width:item.width,["--ped-primary-scale"]:String(primaryScale)} as HeritageCSSProperties} onMouseEnter={()=>onHover?.(item.key,horse.id)} onFocus={()=>onHover?.(item.key,horse.id)} onMouseLeave={onLeave} onBlur={onLeave} onClick={()=>navigate(`/horse/${horse.id}`)} title={`${primary} · ${horse.name_latin} #${horse.id}`}>
    <span className="ped-card-frame"></span>
    <span className="ped-card-accent"></span>
    <span className="ped-card-corner"></span>
    <strong dir="auto">{primary}</strong>
    <span className="ped-card-bottom"><span className="ped-meta">#{n(horse.id)}</span></span>
    <span className="ped-flags">{item.node.repeated&&<em className="repeat-flag">{t("relation.repeat")}</em>}{item.node.cycle&&<em className="cycle-flag">{t("relation.cycle")}</em>}</span>
  </button>
}

function AdminPage({user,health,navigate,platform,permissions,guestMode,setGuestMode,demoAdminAvailable}:{user:AuthUser|null;health:HealthResponse|null;navigate:(p:string)=>void;platform:PlatformClient;permissions:PlatformPermission[];guestMode:boolean;setGuestMode:(value:boolean)=>void;demoAdminAvailable:boolean}){
  const {locale}=useI18n();
  const staffAccess=permissions.some(permission=>permission==="horse.create"||permission==="horse.edit"||permission==="quality.read"||permission==="audit.read"||permission==="claim.review"||permission==="change.review"||permission==="maintenance.run");
  const content=user&&staffAccess?<AdminDashboard user={user} platform={platform} permissions={permissions} navigate={navigate}/>:guestMode?<GuestAdminDashboard platform={platform} health={health} navigate={navigate} onExit={()=>setGuestMode(false)}/>:user?<AdminAccessRestricted user={user} navigate={navigate} onGuest={()=>setGuestMode(true)} platform={platform} demoAdminAvailable={demoAdminAvailable}/>:<Login platform={platform} health={health} onGuest={()=>setGuestMode(true)} demoAdminAvailable={demoAdminAvailable}/>;
  return <><React.Suspense fallback={null}><AccountSecuritySessionNotice platform={platform} locale={locale}/></React.Suspense>{content}</>;
}
function AdminAccessRestricted({user,navigate,onGuest,platform,demoAdminAvailable}:{user:AuthUser;navigate:(p:string)=>void;onGuest:()=>void;platform:PlatformClient;demoAdminAvailable:boolean}){
  const {locale}=useI18n();const L=(en:string,fa:string)=>uiText(locale, en, fa);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const demoAdmin=async()=>{setBusy(true);setError("");try{await platform.auth.demoAdmin()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
  return <main className="admin-page"><section className="panel admin-access-card" data-h-surface-role="card"><div className="eyebrow">{L("MANAGEMENT ACCESS","دسترسی مدیریت")}</div><h1>{L("Staff permissions required","نیازمند مجوز کارکنان")}</h1><p>{L(`${user.display_name} is signed in, but this account does not have staff-management permissions. The public registry remains available normally.`,`${user.display_name} وارد شده است، اما این حساب مجوز مدیریت کارکنان را ندارد. سامانه ثبت عمومی همچنان به‌صورت عادی در دسترس است.`)}</p>{error&&<div className="form-error">{error}</div>}{demoAdminAvailable?<div className="admin-access-actions"><button className="primary" onClick={()=>void demoAdmin()} disabled={busy}>{busy?L("Signing in…","در حال ورود…"):L("Sign in as Demo Administrator","ورود به‌عنوان مدیر دمو")}</button><button className="ghost" onClick={onGuest}>{L("Open read-only demo","باز کردن نمایش فقط‌خواندنی")}</button></div>:<div className="admin-access-actions"><button className="primary" onClick={onGuest}>{L("Open read-only demo","باز کردن نمایش فقط‌خواندنی")}</button><button className="ghost" onClick={()=>navigate("/")}>{L("Back to registry","بازگشت به سامانه ثبت")}</button></div>}</section></main>;
}
function Login({platform,health,onGuest,demoAdminAvailable}:{platform:PlatformClient;health:HealthResponse|null;onGuest:()=>void;demoAdminAvailable:boolean}){
  const {t,locale}=useI18n();
  const L=(en:string,fa:string)=>uiText(locale, en, fa);
  const visualAssets=useHeritageVisualAssetsSnapshot();
  const [email,setEmail]=useState(health?.env!=="production"?"admin@local.test":"");const[password,setPassword]=useState("");const[error,setError]=useState("");const[demoBusy,setDemoBusy]=useState(false);
  useEffect(()=>{if(health?.env!=="production"&&!email)setEmail("admin@local.test")},[health?.env]);
  const [loginBusy,setLoginBusy]=useState(false);const loginFlight=useRef(false);
  const submit=async(e:React.FormEvent)=>{e.preventDefault();if(loginFlight.current||demoBusy)return;loginFlight.current=true;setLoginBusy(true);setError("");try{await platform.auth.login({email,password})}catch(e){setError((e as Error).message)}finally{loginFlight.current=false;setLoginBusy(false)}};
  const demoAdmin=async()=>{setDemoBusy(true);setError("");try{await platform.auth.demoAdmin()}catch(e){setError((e as Error).message)}finally{setDemoBusy(false)}};
  const artTitle=t("login.artTitle").split("\n");
  return <main className="admin-page login-page"><section className="login-stage"><div className="login-art"><img className="login-crest" src={resolveHeritageSplashSource(visualAssets)} alt=""/><div className="login-art-copy"><span>{t("login.control")}</span><strong>{artTitle.map((line,i)=><React.Fragment key={line}>{i>0&&<br/>}{line}</React.Fragment>)}</strong><p>{t("login.artBody")}</p></div><img className="login-divider" src={HERITAGE_DECORATION.divider} alt=""/></div><div className="login-card"><div className="eyebrow"><span className="eyebrow-rule"></span>{t("login.eyebrow")}</div><h1>{t("login.title")}</h1><p>{t("login.lede")}</p>{health?.env!=="production"&&<div className="local-admin-note"><strong>{t("login.local")}</strong><span>{t("login.localBody")}</span></div>}{demoAdminAvailable&&<button type="button" className="login-demo-admin-button" onClick={()=>void demoAdmin()} disabled={demoBusy||loginBusy}><span className="login-guest-icon" aria-hidden="true">◆</span><span><strong>{demoBusy?L("Signing in the demo administrator…","در حال ورود مدیر دمو…"):L("Continue as Demo Administrator","ادامه به‌عنوان مدیر دمو")}</strong><small>{L("One click · full management access on this deployment","یک کلیک · دسترسی کامل مدیریتی در این استقرار")}</small></span><b aria-hidden="true">→</b></button>}{demoAdminAvailable&&<div className="login-demo-separator"><span></span><b>{L("or","یا")}</b><span></span></div>}<form onSubmit={submit} aria-busy={loginBusy}><label>{t("login.email")}<input dir="ltr" type="email" autoComplete="username" disabled={loginBusy||demoBusy} value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" required/></label><label>{t("login.password")}<input dir="ltr" type="password" autoComplete="current-password" disabled={loginBusy||demoBusy} value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••••••" required/></label>{error&&<div className="form-error" role="alert">{error}</div>}<button className="primary login-submit" disabled={loginBusy||demoBusy}>{loginBusy?L("Signing in…","در حال ورود…"):t("login.submit")}</button></form><div className="login-demo-separator"><span></span><b>{L("or","یا")}</b><span></span></div><button type="button" className="login-guest-button" onClick={onGuest}><span className="login-guest-icon" aria-hidden="true">◈</span><span><strong>{L("Enter as Guest · Demo","ورود مهمان · حالت نمایشی")}</strong><small>{L("Explore the Admin dashboard safely in read-only showcase mode","داشبورد مدیریت را در حالت نمایشی و فقط‌خواندنی مشاهده کنید")}</small></span><b aria-hidden="true">→</b></button><p className="login-guest-note">{L("Guest Demo never receives staff permissions and cannot change registry data.","حالت مهمان هیچ مجوز مدیریتی دریافت نمی‌کند و قادر به تغییر داده‌های سامانه ثبت نیست.")}</p></div></section></main>
}

function GuestAdminDashboard({platform,health,navigate,onExit}:{platform:PlatformClient;health:HealthResponse|null;navigate:(p:string)=>void;onExit:()=>void}){
  const {locale,n,year}=useI18n();
  const L=(en:string,fa:string)=>uiText(locale, en, fa);
  const [analytics,setAnalytics]=useState<RegistryAnalyticsResponse|null>(null);
  const [quality,setQuality]=useState<QualitySummaryResponse|null>(null);
  const [recent,setRecent]=useState<Horse[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{let live=true;setLoading(true);Promise.allSettled([platform.analytics.registry(),platform.quality.summary(),platform.registry.browse({sort:"id",dir:"desc",limit:8})]).then(results=>{if(!live)return;const [a,q,r]=results;if(a.status==="fulfilled")setAnalytics(a.value);if(q.status==="fulfilled")setQuality(q.value);if(r.status==="fulfilled")setRecent(r.value.rows);setLoading(false)});return()=>{live=false}},[platform]);
  const horses=analytics?.horseCount??health?.horses??null;
  const people=analytics?.people?.peopleCount??null;
  const openIssues=quality?.openIssues??analytics?.quality?.openIssues??null;
  const breeds=analytics?.topBreeds?.length??null;
  const birthPlaces=analytics?.topBirthPlaces?.length??null;
  const statRows:[[string,number|null],[string,number|null],[string,number|null],[string,number|null],[string,number|null]]=[
    [L("Registry horses","اسب‌های سامانه ثبت"),horses],[L("People records","رکوردهای اشخاص"),people],[L("Open quality signals","موارد کیفی باز"),openIssues],[L("Breed groups","گروه‌های نژادی"),breeds],[L("Birth-place groups","گروه‌های محل تولد"),birthPlaces],
  ];
  const severities=quality?.severities??[];
  const issueCodes=quality?.topIssueCodes??[];
  return <main className="admin-page wide guest-admin-demo">
    <div className="admin-head"><div><div className="eyebrow">{L("ADMIN CONSOLE · GUEST DEMO","کنسول مدیریت · نمایش مهمان")}</div><h1>{L("Registry administration","مدیریت سامانه ثبت")}</h1></div><div className="admin-user"><span>{L("Guest · Read only","مهمان · فقط‌خواندنی")}</span><button className="ghost" onClick={onExit}>{L("Exit demo","خروج از نمایش")}</button></div></div>
    <div className="guest-demo-banner"><span className="guest-demo-mark" aria-hidden="true">◈</span><div><strong>{L("Safe showcase mode","حالت نمایشی امن")}</strong><p>{L("This view uses real public registry data, but all privileged actions, private audit records and review queues stay locked. Sign in with a staff account to enable administration.","این نما از داده‌های عمومی واقعی سامانه ثبت استفاده می‌کند، اما همه عملیات مدیریتی، سوابق خصوصی ممیزی و صف‌های بررسی قفل هستند. برای فعال‌کردن مدیریت با حساب کارکنان وارد شوید.")}</p></div><span className="guest-demo-pill">{L("READ ONLY","فقط‌خواندنی")}</span></div>
    <div className="stat-grid">{statRows.map(([label,value])=><article key={label}><span>{label}</span><strong>{typeof value==="number"?n(value):loading?"…":"—"}</strong></article>)}</div>
    <div className="admin-grid guest-admin-grid">
      <section className="panel guest-admin-locked"><div className="panel-head"><div><h2>{L("Create registry record","ایجاد رکورد سامانه ثبت")}</h2><p>{L("A preview of the staff creation workflow. Writes are disabled for Guest Demo.","پیش‌نمایش فرایند ایجاد رکورد توسط کارکنان؛ ثبت اطلاعات در حالت مهمان غیرفعال است.")}</p></div><span className="guest-lock-badge">🔒 {L("STAFF","کارکنان")}</span></div><form><label>{L("Latin name","نام لاتین")}<input disabled placeholder="AL KHAYR"/></label><label>{L("Birth year","سال تولد")}<input disabled placeholder="2024"/></label><label>{L("Registry number","شماره سامانه ثبت")}<input disabled placeholder="REG-…"/></label><button type="button" className="primary" disabled>{L("Create record","ایجاد رکورد")}</button></form></section>
      <section className="panel"><div className="panel-head"><div><h2>{L("Recent registry records","رکوردهای اخیر سامانه ثبت")}</h2><p>{L("Live public records shown inside the administrative workspace.","رکوردهای عمومی زنده در فضای کاری مدیریت نمایش داده می‌شوند.")}</p></div></div><div className="audit-list guest-recent-list">{recent.length?recent.map(h=><button key={h.id} onClick={()=>navigate(`/horse/${h.id}`)}><span>{h.birth_year?year(h.birth_year):"—"}</span><b>#{n(h.id)}</b><small dir="auto">{locale==="fa"?(h.name_native||h.name_latin):(h.name_latin||h.name_native)}</small></button>):<div className="guest-demo-empty">{loading?L("Loading live registry…","در حال بارگذاری سامانه ثبت زنده…"):L("No public records available.","رکورد عمومی در دسترس نیست.")}</div>}</div></section>
    </div>
    <section className="panel quality-panel guest-quality-panel"><div className="panel-head"><div><h2>{L("Data-quality observatory","پایش کیفیت داده")}</h2><p>{L("Public quality summary only; individual privileged issue records remain hidden in Guest Demo.","فقط خلاصه عمومی کیفیت نمایش داده می‌شود؛ جزئیات ممتاز هر مورد در حالت مهمان پنهان می‌ماند.")}</p></div><span className="issue-count">{openIssues==null?"—":n(openIssues)}</span></div><div className="guest-quality-grid"><div><strong>{L("Severity distribution","توزیع شدت")}</strong>{severities.length?severities.map(item=><span key={item.value}><b>{item.value}</b><em>{n(item.count)}</em></span>):<small>{loading?L("Loading…","در حال بارگذاری…"):L("No public severity summary.","خلاصه شدت عمومی موجود نیست.")}</small>}</div><div><strong>{L("Top issue codes","کدهای پرتکرار")}</strong>{issueCodes.length?issueCodes.slice(0,6).map(item=><span key={item.value}><b>{item.value}</b><em>{n(item.count)}</em></span>):<small>{loading?L("Loading…","در حال بارگذاری…"):L("No public issue summary.","خلاصه عمومی موارد موجود نیست.")}</small>}</div></div></section>
    <section className="panel guest-governance-preview"><div className="panel-head"><div><h2>{L("Privileged governance workspace","بخش مدیریت ویژه")}</h2><p>{L("These administrative capabilities are visible for demonstration but stay server-protected.","این قابلیت‌های مدیریتی برای نمایش قابل مشاهده‌اند اما همچنان در سمت سرور محافظت می‌شوند.")}</p></div></div><div className="guest-capability-grid">{[L("Audit trail","ردپای ممیزی"),L("Ownership-claim review","بررسی ادعای مالکیت"),L("Change-request review","بررسی درخواست تغییر"),L("Horse record editing","ویرایش رکورد اسب"),L("Archive controls","کنترل بایگانی"),L("Search maintenance","نگهداری موتور جست‌وجو")].map(label=><div key={label}><span aria-hidden="true">🔒</span><strong>{label}</strong><small>{L("Sign in required","نیازمند ورود کارکنان")}</small></div>)}</div></section>
  </main>;
}

function compactAdminValue(value:unknown):string{
  if(value===null||value===undefined)return "—";
  if(typeof value==="string")return value;
  if(typeof value==="number"||typeof value==="boolean")return String(value);
  try{const serialized=JSON.stringify(value);return serialized.length>180?`${serialized.slice(0,177)}…`:serialized;}catch{return String(value);}
}

function AdminDashboard({user,platform,permissions,navigate}:{user:AuthUser;platform:PlatformClient;permissions:PlatformPermission[];navigate:(p:string)=>void}){
  const {t,n,locale}=useI18n();
  const L=(en:string,fa:string)=>uiText(locale, en, fa);
  const canCreate=permissions.includes("horse.create");
  const canEdit=permissions.includes("horse.edit");
  const canAudit=permissions.includes("audit.read");
  const canQuality=permissions.includes("quality.read");
  const canReviewClaims=permissions.includes("claim.review");
  const canReviewChanges=permissions.includes("change.review");
  const canMaintain=permissions.includes("maintenance.run");
  const permissionKey=permissions.join("|");
  const [stats,setStats]=useState<AdminDashboardResponse|null>(null);
  const [audits,setAudits]=useState<AuditEventSummary[]>([]);
  const [issues,setIssues]=useState<AdminQualityIssue[]>([]);
  const [qualityCounts,setQualityCounts]=useState<QualityQueueCounts | null>(null);
  const [qualityCodes,setQualityCodes]=useState<string[]>([]);
  const [qualityStatus,setQualityStatus]=useState<"open"|"assigned"|"resolved"|"all">("open");
  const [claims,setClaims]=useState<AdminClaimRecord[]>([]);
  const [changeRequests,setChangeRequests]=useState<ChangeRequestRecord[]>([]);
  const [msg,setMsg]=useState("");
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState("");

  const reloadAdminData=async()=>{
    setLoading(true);setLoadError("");let failed=false;
    await Promise.all([
      platform.admin.dashboard().then(setStats).catch(error=>{failed=true;setStats(null);setLoadError((error as Error).message)}),
      canAudit?platform.admin.audit().then(x=>setAudits(x.events)).catch(error=>{failed=true;setAudits([]);setLoadError(current=>current||(error as Error).message)}):Promise.resolve(setAudits([])),
      canQuality?platform.admin.quality({status:qualityStatus}).then(x=>{setIssues(x.issues);setQualityCounts(x.counts);setQualityCodes(x.low_risk_bulk_codes)}).catch(error=>{failed=true;setIssues([]);setQualityCounts(null);setLoadError(current=>current||(error as Error).message)}):Promise.resolve(setIssues([])),
      canReviewClaims?platform.admin.claims().then(x=>setClaims(x.claims)).catch(error=>{failed=true;setClaims([]);setLoadError(current=>current||(error as Error).message)}):Promise.resolve(setClaims([])),
      canReviewChanges?platform.admin.changeRequests().then(x=>setChangeRequests(x.requests)).catch(error=>{failed=true;setChangeRequests([]);setLoadError(current=>current||(error as Error).message)}):Promise.resolve(setChangeRequests([])),
    ]);
    if(!failed)setLoadError("");setLoading(false);
  };
  useEffect(()=>{void reloadAdminData()},[platform,permissionKey,qualityStatus]);

  const logout=async()=>{try{await platform.auth.logout()}finally{navigate("/")}};
  const runMaintenance=async()=>{if(!canMaintain)return;setMsg("");try{const d=await platform.admin.maintenance.reindex();setMsg(locale==="fa"?`${n(d.processed)} رکورد جست‌وجو به‌روزرسانی شد${d.failed?`؛ ${n(d.failed)} ناموفق`:""}.`:`Search maintenance: ${d.processed} refreshed${d.failed?`, ${d.failed} failed`:""}.`);await reloadAdminData()}catch(e){setMsg((e as Error).message)}};
  const reconcileMutations=async()=>{if(!canMaintain)return;setMsg("");try{const d=await platform.admin.maintenance.reconcileMutations();setMsg(locale==="fa"?`${n(d.processed)} رویداد ممیزی بازیابی شد${d.quarantined?`؛ ${n(d.quarantined)} مورد قرنطینه شد`:""}.`:`Mutation audit recovery: ${d.processed} reconciled${d.quarantined?`, ${d.quarantined} quarantined`:""}.`);await reloadAdminData()}catch(e){setMsg((e as Error).message)}};
  const reviewClaim=async(id:string,decision:"approved"|"rejected")=>{setMsg("");try{await platform.admin.reviewClaim(id,decision);setMsg(uiText(locale, "Ownership-claim decision recorded.", "تصمیم ادعای مالکیت ثبت شد."));await reloadAdminData()}catch(e){setMsg((e as Error).message)}};
  // R145-E04: the quality-queue workflow verbs (assign/resolve/reopen/note).
  // Every action appends to the issue's server-side event history.
  const qualityAssign=async(id:number)=>{setMsg("");try{const d=await platform.admin.qualityAssign(id,user.id);setMsg(uiText(locale, `Issue #${d.id} assigned to you.`, `مورد #${n(d.id)} به شما واگذار شد.`));await reloadAdminData()}catch(e){setMsg((e as Error).message)}};
  const qualityResolve=async(id:number)=>{setMsg("");const note=(window.prompt(uiText(locale, "Resolution note (required):", "یادداشت حل (الزامی):"))??"").trim();if(note.length<3)return;try{await platform.admin.qualityResolve(id,note);setMsg(uiText(locale, `Issue #${id} resolved.`, `مورد #${n(id)} حل شد.`));await reloadAdminData()}catch(e){setMsg((e as Error).message)}};
  const qualityReopen=async(id:number)=>{setMsg("");const note=(window.prompt(uiText(locale, "Why is this being reopened? (required):", "چرا این مورد دوباره باز می‌شود؟ (الزامی):"))??"").trim();if(note.length<3)return;try{await platform.admin.qualityReopen(id,note);setMsg(uiText(locale, `Issue #${id} reopened.`, `مورد #${n(id)} دوباره باز شد.`));await reloadAdminData()}catch(e){setMsg((e as Error).message)}};
  const qualityScan=async()=>{setMsg("");try{let d=await platform.admin.qualityScan();let passes=1;while(!d.completed&&passes<80){d=await platform.admin.qualityScan({resume_after:d.resume_after??undefined});passes++}setMsg(uiText(locale, `Scan (${passes} pass${passes===1?"":"es"}): ${d.created} new issue(s) this pass from ${d.detected_candidates} candidate(s); ${d.open_issues} open${d.completed?"":" · MORE PASSES NEEDED"}.`, `اسکن (${n(passes)} گذر): ${n(d.created)} مورد جدید در این گذر از ${n(d.detected_candidates)} کاندید؛ ${n(d.open_issues)} باز${d.completed?"":" · گذرهای بیشتری لازم است"}.`));await reloadAdminData()}catch(e){setMsg((e as Error).message)}};
  const qualityBulk=async()=>{setMsg("");const ids=issues.filter(x=>x.severity==="info"&&qualityCodes.includes(x.issue_code)).map(x=>x.id);if(!ids.length){setMsg(uiText(locale, "No low-risk info issues to bulk-resolve.", "مورد کم‌ریسکی برای حل گروهی نیست."));return}const note=(window.prompt(uiText(locale, `Bulk-resolve ${ids.length} low-risk issue(s). Note (required):`, `حل گروهی ${n(ids.length)} مورد کم‌ریسک. یادداشت (الزامی):`))??"").trim();if(note.length<3)return;try{const d=await platform.admin.qualityBulkResolve(ids,note);setMsg(uiText(locale, `Bulk-resolved ${d.resolved} issue(s).`, `${n(d.resolved)} مورد گروهی حل شد.`));await reloadAdminData()}catch(e){setMsg((e as Error).message)}};
  const reviewChange=async(id:string,decision:"approved"|"rejected"|"needs_changes")=>{setMsg("");try{
    // T11: needs_changes returns the submission to the submitter's drafts with
    // an explanatory note; approve on a create_horse submission atomically
    // creates the canonical horse (the response then carries its id).
    const note=decision==="needs_changes"?(window.prompt(uiText(locale, "What must change? (note required)", "چه چیزی باید اصلاح شود؟ (یادداشت الزامی)"))??""):null;
    if(decision==="needs_changes"&&!(note?? "").trim())return;
    const d=await platform.admin.reviewChangeRequest(id,decision,note);
    setMsg(d.canonical_horse_id!=null?(locale==="fa"?`ثبت شد؛ اسب #${n(d.canonical_horse_id)} به‌صورت رسمی ایجاد شد.`:`Approved; horse #${d.canonical_horse_id} created.`):(uiText(locale, "Change-request decision recorded.", "تصمیم درخواست تغییر ثبت شد.")));
    await reloadAdminData()}catch(e){setMsg((e as Error).message)}};
  const auditEntityLabel=(event:AuditEventSummary)=>event.entity_type==="horse"&&/^\d+$/.test(event.entity_id)?`#${n(Number(event.entity_id))}`:`${event.entity_type} · ${event.entity_id.length>14?`${event.entity_id.slice(0,12)}…`:event.entity_id}`;
  const statRows:Array<[string,number|undefined]>=[[t("admin.horses"),stats?.horses],[t("admin.people"),stats?.people],[t("admin.issues"),stats?.openIssues],[t("admin.changes"),stats?.changesLast7Days],[t("admin.reindex"),stats?.reindexJobs]];
  if(canMaintain)statRows.push([L("Pending mutation audits","ممیزی‌های تغییر در انتظار"),stats?.pendingMutations]);

  return <main className="admin-page wide"><div className="admin-head"><div><div className="eyebrow">{t("admin.console")} · {user.role.toUpperCase()}</div><h1>{t("admin.title")}</h1></div><div className="admin-user"><span>{user.display_name}</span><button className="ghost admin-refresh" onClick={()=>void reloadAdminData()} disabled={loading}>{loading?L("Refreshing…","در حال تازه‌سازی…"):L("Refresh","تازه‌سازی")}</button><button className="ghost" onClick={logout}>{t("admin.signout")}</button></div></div>
    <React.Suspense fallback={<section className="panel" aria-busy="true">{L("Loading account security…","در حال بارگذاری امنیت حساب…")}</section>}><AccountSecurityPanel platform={platform} locale={locale} scope={principalScopeKey(user,permissions)}/></React.Suspense>
    {canAudit&&<React.Suspense fallback={<section className="panel" aria-busy="true">{L("Loading professional access…","در حال بارگذاری دسترسی حرفه‌ای…")}</section>}><ProfessionalGrantWorkbench platform={platform} locale={locale} scope={principalScopeKey(user,permissions)} canRead={canAudit} canManage={canMaintain}/></React.Suspense>}
    {loadError&&<div className="admin-load-state" role="status"><strong>{L("Some management data could not be loaded.","بخشی از داده‌های مدیریت بارگذاری نشد.")}</strong><span>{loadError}</span><button className="ghost" onClick={()=>void reloadAdminData()}>{L("Retry","تلاش دوباره")}</button></div>}
    <div className="stat-grid">{statRows.map(([label,value])=><article key={String(label)}><span>{label}</span><strong>{typeof value==="number"?n(value):loading?"…":"—"}</strong></article>)}</div>
    <div className="admin-grid">{canCreate&&<section className="panel"><h2>{t("admin.add")}</h2><p>{L("Create a canonical record with source-backed identity, dates, parents and private staff details.","رکورد مرجع را با هویت، تاریخ‌ها، والدین و جزئیات خصوصی کارکنان بر پایه منبع ایجاد کنید.")}</p><HorseCurationForm platform={platform} locale={locale} scope={principalScopeKey(user,permissions)} onSaved={async horse=>{setMsg(L(`Created horse #${horse.id}.`,`اسب #${horse.id} ایجاد شد.`));await reloadAdminData()}}/></section>}
      {canAudit&&<section className="panel"><div className="panel-head"><div><h2>{t("admin.audit")}</h2><p>{L("Latest privileged registry mutations and workflow actions.","آخرین تغییرات ممتاز سامانه ثبت و اقدامات گردش‌کار.")}</p></div><span className="issue-count">{n(audits.length)}</span></div><div className="audit-list">{audits.length?audits.slice(0,16).map(a=><button key={a.id} onClick={()=>a.entity_type==="horse"&&/^\d+$/.test(a.entity_id)&&navigate(`/horse/${a.entity_id}`)} title={`${a.entity_type} · ${a.entity_id}`}><span>{a.action}</span><b>{auditEntityLabel(a)}</b><small>{a.actor||"system"} · {a.created_at}</small></button>):<div className="admin-empty-state">{loading?L("Loading audit trail…","در حال بارگذاری ردپای ممیزی…"):L("No audit events available.","رویداد ممیزی موجود نیست.")}</div>}</div></section>}</div>
    {(canReviewClaims||canReviewChanges)&&<section className="panel governance-panel" data-h-surface-role="panel"><div className="panel-head"><div><h2>{L("Review & governance queue","صف بررسی و حاکمیت")}</h2><p>{L("Ownership claims and change requests are reviewed through versioned PlatformClient operations.","ادعاها و درخواست‌های تغییر از مسیرهای نسخه‌بندی‌شده PlatformClient بررسی می‌شوند.")}</p></div></div><div className="governance-grid">{canReviewClaims&&<div><h3>{L("Ownership claims","ادعاهای مالکیت")}</h3><div className="governance-list">{claims.length?claims.slice(0,12).map(claim=><article key={claim.id}><button className="governance-record" onClick={()=>navigate(`/horse/${claim.horse_id}`)}><strong dir="auto">{locale==="fa"?(claim.name_native||claim.name_latin||`#${claim.horse_id}`):(claim.name_latin||claim.name_native||`#${claim.horse_id}`)}</strong><small>{claim.claimant||"—"} · {workflowStatusLabel(claim.status,locale)}</small></button>{claim.status==="pending"&&<span><button onClick={()=>void reviewClaim(claim.id,"approved")}>{L("Approve","تأیید")}</button><button className="reject" onClick={()=>void reviewClaim(claim.id,"rejected")}>{L("Reject","رد")}</button></span>}</article>):<div className="desk-empty">{L("No ownership claims in queue.","ادعایی در صف نیست.")}</div>}</div></div>}{canReviewChanges&&<div><h3>{L("Change requests","درخواست‌های تغییر")}</h3><div className="governance-list">{changeRequests.length?changeRequests.slice(0,12).map(request=><article key={request.id}><button className="governance-record" onClick={()=>request.horse_id&&navigate(`/horse/${request.horse_id}`)}><strong dir="auto">{request.summary||request.request_type}</strong><small>{request.submitted_by||"—"} · {workflowStatusLabel(request.status,locale)}</small></button>{request.items?.length>0&&<details className="governance-detail"><summary>{L(`${request.items.length} proposed field changes`,`${n(request.items.length)} تغییر پیشنهادی فیلد`)}</summary><div>{request.items.map((item,index)=><span key={`${request.id}-${item.field_name}-${index}`}><b>{item.field_name}</b><small dir="auto">{compactAdminValue(item.old_value)} → {compactAdminValue(item.proposed_value)}</small></span>)}</div></details>}{(request.status==="pending"||request.status==="draft")&&<span><button onClick={()=>void reviewChange(request.id,"approved")}>{L("Approve","تأیید")}</button><button className="reject" onClick={()=>void reviewChange(request.id,"rejected")}>{L("Reject","رد")}</button><button className="bounce" onClick={()=>void reviewChange(request.id,"needs_changes")}>{L("Needs changes","نیازمند اصلاح")}</button></span>}{request.canonical_horse_id!=null&&<button className="governance-record" onClick={()=>navigate(`/horse/${request.canonical_horse_id!}`)}><strong>{locale==="fa"?`اسب ثبت‌شده #${n(request.canonical_horse_id)}`:`Created horse #${request.canonical_horse_id}`}</strong></button>}</article>):<div className="desk-empty">{L("No change requests in queue.","درخواست تغییری در صف نیست.")}</div>}</div></div>}</div></section>}
    {canQuality&&<section className="panel quality-panel" data-h-surface-role="panel"><div className="panel-head"><div><h2>{t("admin.quality")}</h2><p>{t("admin.qualityBody")}</p></div><span className="issue-count">{n(qualityCounts?qualityCounts.open+qualityCounts.assigned:issues.length)}</span></div>
      <div className="quality-tools" style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center",marginBottom:"8px"}}>
        <label>{L("Status","وضعیت")} <select value={qualityStatus} onChange={e=>setQualityStatus(e.target.value as typeof qualityStatus)}><option value="open">{L("Open","باز")}</option><option value="assigned">{L("Assigned","واگذارشده")}</option><option value="resolved">{L("Resolved","حل‌شده")}</option><option value="all">{L("All","همه")}</option></select></label>
        {qualityCounts&&<small>{L("open","باز")}: {n(qualityCounts.open)} · {L("assigned","واگذارشده")}: {n(qualityCounts.assigned)} · {L("resolved","حل‌شده")}: {n(qualityCounts.resolved)}</small>}
        <button className="ghost" onClick={()=>void qualityScan()}>{L("Scan corpus","اسکن داده‌ها")}</button>
        <button className="ghost" onClick={()=>void qualityBulk()}>{L("Bulk-resolve low-risk","حل گروهی کم‌ریسک")}</button>
      </div>
      <div className="quality-list">{issues.length?issues.slice(0,30).map(x=><div key={x.id} className="quality-row" style={{display:"flex",gap:"8px",alignItems:"center",borderBottom:"1px solid rgba(128,128,128,.15)",padding:"4px 0"}}>
        <button onClick={()=>x.horse_id&&navigate(`/horse/${x.horse_id}`)} style={{flex:"1",textAlign:"start"}}><span className={`severity ${x.severity}`}>{x.severity}</span><strong dir="auto">{x.name_latin||`#${n(x.horse_id ?? 0)}`}</strong><small>{x.issue_code} · {x.message}{x.assigned_to?` · ${L("assigned to","واگذار به")} ${x.assignee_name||x.assigned_to}`:""}{x.age_days!=null?` · ${n(x.age_days)}d`:""}</small></button>
        {x.status!=="resolved"&&<button className="ghost" onClick={()=>void qualityAssign(x.id)}>{L("Take","برداشت")}</button>}
        {x.status!=="resolved"&&<button className="ghost" onClick={()=>void qualityResolve(x.id)}>{L("Resolve","حل")}</button>}
        {x.status==="resolved"&&<button className="ghost" onClick={()=>void qualityReopen(x.id)}>{L("Reopen","بازکردن")}</button>}
      </div>):<div className="admin-empty-state">{loading?L("Loading quality queue…","در حال بارگذاری صف کیفیت…"):L("No unresolved quality issues.","مورد کیفیت حل‌نشده‌ای وجود ندارد.")}</div>}</div>
      <p className="h-mod-test-meta">{L("Bulk review is restricted to explicitly low-risk info codes. Duplicate and parent-conflict cases go through the duplicate workbench — name-only bulk auto-merging is unavailable by design.","بررسی گروهی فقط برای کدهای کم‌ریسک مجاز است. موارد تکراری و تعارض والدین از میز کار تکراری‌ها می‌گذرند — ادغام خودکار گروهی فقط با نام عمداً در دسترس نیست.")}</p>
    </section>}
    <React.Suspense fallback={<section className="panel" aria-busy="true">{uiText(locale, "Loading…", "در حال بارگذاری…")}</section>}><HeritageAdminAiSettings platform={platform} user={user} permissions={permissions}/></React.Suspense>
    {user.role==="admin"&&<React.Suspense fallback={<section className="panel" aria-busy="true">{uiText(locale, "Loading…", "در حال بارگذاری…")}</section>}><HeritagePrivacyRedactionPanel platform={platform} user={user}/></React.Suspense>}
    {canEdit&&<React.Suspense fallback={<section className="panel" aria-busy="true">{uiText(locale, "Loading…", "در حال بارگذاری…")}</section>}><HeritageDuplicateWorkbench platform={platform} permissions={permissions}/></React.Suspense>}
    {canMaintain&&<section className="panel admin-maintenance-panel" data-h-surface-role="panel"><div className="panel-head"><div><h2>{L("Maintenance & recovery","نگهداری و بازیابی")}</h2><p>{L("Server-protected operational actions. Each run is CSRF-protected and audited.","عملیات نگهداری محافظت‌شده در سمت سرور؛ هر اجرا در برابر CSRF محافظت و ممیزی می‌شود.")}</p></div></div><div className="admin-maintenance-grid"><article><span>{L("Search reindex queue","صف بازسازی نمایهٔ جست‌وجو")}</span><strong>{n(stats?.reindexJobs??0)}</strong><p>{L("Refresh queued search projections after canonical record changes.","نمایه‌های جست‌وجوی در صف را پس از تغییرات رکورد مرجع تازه می‌کند.")}</p><button className="ghost" onClick={()=>void runMaintenance()} disabled={!stats?.reindexJobs}>{L("Process queue","پردازش صف")}</button></article><article><span>{L("Pending mutation audits","ممیزی‌های تغییر در انتظار")}</span><strong>{n(stats?.pendingMutations??0)}</strong><p>{L("Recover durable mutation intents whose audit side-effect did not finish cleanly.","درخواست‌های تغییر ماندگار را که ثبت ممیزی آن‌ها کامل نشده بازیابی می‌کند.")}</p><button className="ghost" onClick={()=>void reconcileMutations()} disabled={!stats?.pendingMutations}>{L("Reconcile audit trail","بازیابی ردپای ممیزی")}</button></article></div></section>}
    {msg&&<div className="admin-action-message" role="status">{msg}</div>}
    {canEdit&&<AdminHorseEditor platform={platform} permissions={permissions} scope={principalScopeKey(user,permissions)} navigate={navigate} onMutated={reloadAdminData}/>}
  </main>
}

function AdminHorseEditor({platform,permissions,scope,navigate,onMutated}:{platform:PlatformClient;permissions:PlatformPermission[];scope:string;navigate:(p:string)=>void;onMutated?:()=>void|Promise<void>}){
  const {t,locale,n}=useI18n();const L=(en:string,fa:string)=>uiText(locale,en,fa);
  const [q,setQ]=useState("");const[results,setResults]=useState<Horse[]>([]);const[selected,setSelected]=useState<AdminHorseRecord|null>(null);const[msg,setMsg]=useState("");const[busy,setBusy]=useState(false);
  const loadController=useRef<AbortController|null>(null);
  useEffect(()=>()=>loadController.current?.abort(),[]);
  useEffect(()=>{setResults([]);if(selected||q.trim().length<2)return;const controller=new AbortController();const timer=setTimeout(()=>platform.search.horses(q,{limit:8,signal:controller.signal}).then(x=>{if(!controller.signal.aborted)setResults(x.results)}).catch(()=>{if(!controller.signal.aborted)setMsg(L("Search failed. Try again.","جست‌وجو ناموفق بود. دوباره تلاش کنید."))}),160);return()=>{clearTimeout(timer);controller.abort()}},[q,selected,platform]);
  const choose=async(h:Horse)=>{loadController.current?.abort();const controller=new AbortController();loadController.current=controller;setBusy(true);setMsg("");try{const d=await platform.admin.horses.get(h.id,{signal:controller.signal});if(controller.signal.aborted)return;setSelected(d.horse);setQ(locale==="fa"?(d.horse.name_native||d.horse.name_latin):d.horse.name_latin);setResults([])}catch(e){if(!controller.signal.aborted)setMsg((e as Error).message)}finally{if(!controller.signal.aborted)setBusy(false)}};
  const archive=async()=>{if(!selected||!permissions.includes("horse.archive")||!confirm(L(`Archive ${selected.name_latin}? The record will be hidden and retained in history.`,`رکورد ${selected.name_latin} بایگانی شود؟ رکورد پنهان و تاریخچه حفظ می‌شود.`)))return;setBusy(true);try{await platform.admin.horses.archive(selected.id);setMsg(L(`Archived #${selected.id}`,`#${n(selected.id)} بایگانی شد`));setSelected(null);setQ("");await onMutated?.()}catch(e){setMsg((e as Error).message)}finally{setBusy(false)}};
  return <section className="panel admin-editor"><div className="panel-head"><div><h2>{t("admin.edit")}</h2><p>{t("admin.editBody")}</p></div>{selected&&<button className="ghost" onClick={()=>navigate(`/horse/${selected.id}`)}>{L("Open profile","باز کردن پروفایل")} ↗</button>}</div><div className="admin-record-search"><input aria-label={L("Find horse to curate","یافتن اسب برای ویرایش")} dir="auto" value={q} onChange={e=>{loadController.current?.abort();setQ(e.target.value);setSelected(null);setMsg("");setBusy(false)}} placeholder={L("Search horse name or registry number…","نام یا شماره ثبت اسب را جست‌وجو کنید…")}/>{results.length>0&&<div className="admin-search-results">{results.map(h=><button key={h.id} onClick={()=>choose(h)}><strong dir="auto">{primaryHorseName(h,locale)}</strong><span>#{n(h.id)}</span></button>)}</div>}</div>{selected&&<><HorseCurationForm platform={platform} horse={selected} locale={locale} scope={scope} canEdit={permissions.includes("horse.edit")} onSaved={async horse=>{setSelected(horse);setMsg(L("Saved and audited.","ذخیره و ممیزی شد."));await onMutated?.()}}/>{permissions.includes("horse.archive")&&<button className="danger" onClick={archive} disabled={busy}>{L("Archive record","بایگانی رکورد")}</button>}</>}{busy&&!selected&&<p role="status">{L("Loading…","در حال بارگذاری…")}</p>}{msg&&<p role="status">{msg}</p>}</section>;
}

{
  const root=document.documentElement;
  const initialLocale=storedLocale();
  root.lang=initialLocale;root.dir=isUiRtl(initialLocale)?"rtl":"ltr";root.dataset.locale=initialLocale;
  const routed=parseFrontendLocalRoute(location.pathname)?.frontendId;const saved=safeStorageGet("registry-frontend")||"heritage";root.dataset.frontend=routed&&hasFrontend(routed)?routed:(hasFrontend(saved)?saved:"heritage");root.dataset.visualArchitecture="2";
  const route=location.pathname;root.dataset.page=route.startsWith("/browse")?"browse":route.startsWith("/stats")?"stats":route.startsWith("/newsroom")?"newsroom":route.startsWith("/f/heritage/wallpaper")?"wallpaper":route.startsWith("/f/heritage/desk")?"desk":route.startsWith("/admin")?"admin":/^\/horse\/\d+$/.test(route)?"profile":"home";
}
bootstrapHeritageVisualAssets();
bootstrapHeritageAppearance();
bootstrapHeritagePresentation();
bootstrapHeritageLayout();
const appRoot=<App/>;
const strictQa=import.meta.env.DEV&&import.meta.env.VITE_REACT_STRICT_QA==="1";
createRoot(document.getElementById("root")!).render(strictQa?<React.StrictMode>{appRoot}</React.StrictMode>:appRoot);
