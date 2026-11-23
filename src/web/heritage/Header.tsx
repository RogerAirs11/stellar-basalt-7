import { uiText } from "../../shared/uiLocale";
import React, { useEffect, useRef } from "react";
import type { PlatformHealthResponse, PlatformUser } from "../../contracts/platform";
import { useI18n, type Locale } from "../i18n";
import { useHeritageVisualAssetsSnapshot, resolveHeritageBrandSource } from "../heritageVisualAssets";
import { PrimaryNavigation, LayoutSwitcherButton } from "./Navigation";
import { PersonIcon } from "./icons";
import { LanguageSelector } from "./LanguageSelector";

const AppearanceStudio = React.lazy(() => import("./AppearanceStudio").then(module => ({ default: module.AppearanceStudio })));

export function HeritageHeader({health,route,navigate,locale,setLocale,user,navigationLayout,navigationTabs=true,showAppearanceTools=false}:{health:PlatformHealthResponse|null;route:string;navigate:(p:string)=>void;locale:Locale;setLocale:(l:Locale)=>void;user:PlatformUser|null;navigationLayout:"tabs"|"sidebar";navigationTabs?:boolean;showAppearanceTools?:boolean}){
  const {t,n}=useI18n();
  const visualAssets=useHeritageVisualAssetsSnapshot();
  const headerRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    const header=headerRef.current;
    if(!header)return;
    const measure=()=>document.documentElement.style.setProperty("--h-chrome-topbar-height",`${Math.ceil(header.getBoundingClientRect().height)}px`);
    measure();
    const observer=new ResizeObserver(measure);observer.observe(header);
    return()=>{observer.disconnect();document.documentElement.style.removeProperty("--h-chrome-topbar-height");};
  },[]);
  // R124: the header shows the top tab row whenever the current chrome has tabs —
  // that is layout "tabs", the narrow fallback of "auto", and every viewport of
  // "both" (sidebar + tabs together). The wallpaper route keeps its own rule.
  const showTabs=(navigationTabs||navigationLayout!=="sidebar")&&!route.startsWith("/f/heritage/wallpaper");
  return <header ref={headerRef} className="topbar h112-header">
    <a className="h102-skip" href="#heritage-main-content">{uiText(locale, "Skip to content", "پرش به محتوا")}</a>
    <button className="brand" onClick={()=>navigate("/")} aria-label={`${t("brand.name")} ${t("brand.sub")}`}>
      <span className="brand-emblem"><img src={resolveHeritageBrandSource(visualAssets)} alt=""/></span>
      <span className="brand-copy"><strong>{t("brand.name")}</strong>{" "}<small>{t("brand.sub")}</small></span>
    </button>
    {showTabs && <PrimaryNavigation route={route} locale={locale} navigate={navigate} showAppearanceTools={showAppearanceTools}/>}
    <div className="topbar-tools">
      <div className="registry-status" title={health?`${n(health.horses)} · ${n(health.searchRows)}`:"…"}>
        <span className={`status-dot ${health?.searchReady?"ready":"warn"}`}></span>
        <span>{health ? n(health.horses) : "…"}</span><small>{t("nav.records")}</small>
      </div>
      {showAppearanceTools && <React.Suspense fallback={<span className="h122-toolbar-placeholder" aria-busy="true" aria-label={t("common.loading", "Loading…")}/>}><AppearanceStudio/></React.Suspense>}
      <LayoutSwitcherButton locale={locale}/>
      <button className="locale-toggle auth-entry" onClick={()=>navigate("/login")} title={user?(locale==="fa"?`حساب: ${user.display_name}`:"Account"):(uiText(locale, "Sign in / register", "ورود / ثبت‌نام"))} aria-label={user?(uiText(locale, "Account", "حساب کاربری")):(uiText(locale, "Sign in or register", "ورود یا ثبت‌نام"))}>
        <PersonIcon size={16}/>
      </button>
      <LanguageSelector locale={locale} onChange={setLocale}/>
    </div>
  </header>;
}
