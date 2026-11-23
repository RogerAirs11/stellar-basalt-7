import { createElement, useEffect, useRef, useState } from "react";
import type { ClassicRuntime } from "./adapter";
import { Icon } from "./components";
import { t } from "./i18n";
import { LayoutSwitcher } from "./Navigation";
import { useNavigationLayout } from "../../../frontend-kit";

export type ClassicNavKey = "home"|"registry"|"people"|"pedigree"|"analytics"|"intelligence"|"quality"|"workflows"|"management"|"breeding"|"platform"|"content"|"auth" | "assistant" | "competitions" | "market";
interface NavChild { label:[string,string]; key:ClassicNavKey; show?:boolean }
interface NavItem { label:[string,string]; key:ClassicNavKey; children?:NavChild[]; show?:boolean }

const DONOR_VERSION = "2.289.2";
const IMG = "/assets/frontends/fei-classic/images";

/**
 * R115: the exact data.fei.org donor port (R64) is the default presentation
 * again — top bar, dome logo, ASP.NET-style hover menus, mobile drawer. The
 * R102 layout preference survives: "sidebar" keeps the donor top bar and moves
 * sections into the shared HierarchicalNavigation rail; "tabs" is the full
 * donor header. Every canonical destination stays reachable in both.
 */
export function Header({view,active,navigate}:{view:ClassicRuntime;active:ClassicNavKey;navigate:(key:ClassicNavKey)=>void}){
  const L=(en:string,fa:string)=>t(view.locale,en,fa);
  const {layout:navigationLayout}=useNavigationLayout("fei-classic");
  const managementAvailable=view.capabilities.audit||view.capabilities.admin||view.capabilities.curation;
  const nav:NavItem[]=[
    {label:["Calendar / Results","تقویم / نتایج"],key:"analytics",children:[
      {label:["Registry Analytics","تحلیل سامانه ثبت"],key:"analytics"},{label:["Competition Calendar","تقویم مسابقات"],key:"competitions"},{label:["Registry Timeline","خط زمانی سامانه ثبت"],key:"intelligence"},{label:["Data Quality","کیفیت داده"],key:"quality",show:view.capabilities.quality},
    ]},
    {label:["Horses","اسب‌ها"],key:"registry",children:[{label:["Search Horses","جست‌وجوی اسب‌ها"],key:"registry"},{label:["Pedigree / Performance","تبارنامه / عملکرد"],key:"pedigree"},{label:["Marketplace","بازار"],key:"market"},{label:["Breeding Analysis","تحلیل جفت‌گیری"],key:"breeding",show:view.capabilities.breeding}]},
    {label:["Persons","افراد"],key:"people",children:[{label:["Search Persons","جست‌وجوی افراد"],key:"people"},{label:["Claims / Changes","ادعاها / تغییرات"],key:"workflows",show:view.capabilities.claims||view.capabilities.changes}]},
    {label:["National Federations","فدراسیون‌های ملی"],key:"platform"},
    {label:["Rankings / Standings","رتبه‌بندی / جایگاه"],key:"intelligence",children:[{label:["Registry Intelligence","تحلیل سامانه ثبت"],key:"intelligence"},{label:["AI Research","پژوهش هوش مصنوعی"],key:"assistant" as ClassicNavKey,show:view.capabilities.ai},{label:["News / Updates","اخبار / به‌روزرسانی"],key:"content"},{label:["Platform Coverage","پوشش پلتفرم"],key:"platform"},{label:["Management / Audit","مدیریت / ممیزی"],key:"management",show:managementAvailable},{label:["Authentication","احراز هویت"],key:"auth",show:view.capabilities.authentication}]},
  ];
  // R64 donor-exact header: the Sys.WebForms.Menu behaviour (hover opens the
  // submenu, mouse-leave closes after disappearAfter=500ms, hovered tab gets
  // the "highlighted" class) is re-implemented with React state.
  const [open,setOpen]=useState<number|null>(null);
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [drawerItem,setDrawerItem]=useState<number|null>(null);
  const timer=useRef<number|null>(null);
  useEffect(()=>{setOpen(null);setDrawerOpen(false)},[active]);
  useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow=drawerOpen?"hidden":previous;return()=>{document.body.style.overflow=previous}},[drawerOpen]);
  const enter=(i:number)=>{if(timer.current)window.clearTimeout(timer.current);setOpen(i)};
  const leave=()=>{if(timer.current)window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>setOpen(null),500)};
  const activate=(key:ClassicNavKey)=>{navigate(key);setDrawerOpen(false)};
  // R125: donor nav labels are authored [en, fa]; Arabic resolves through the
  // engine's AR dictionary via the same t() funnel as every other string.
  const navLabel=(label:readonly[string,string])=>L(label[0],label[1]);
  const visibleNav=nav.filter(x=>x.show!==false);
  const stop=(fn:()=>void)=>(e:React.MouseEvent)=>{e.preventDefault();fn()};
  return <header className="fei-donor-header fei-donor-header-exact">
    {/* ── donor .top-bar — verbatim structure from data.fei.org/Default.aspx ── */}
    <div className="top-bar">
      <div className="top-bar-body">
        <div className="loginstatus" data-cy="LoginStatus">
          {view.user
            ?<><span className="fei-welcome" dir="auto">{L("Welcome","خوش آمدید")}, {view.user.display_name}</span><a href="#" onClick={stop(()=>activate("auth"))}>{L("Account / Logout","حساب / خروج")}</a></>
            :view.capabilities.authentication?<a href="#" onClick={stop(()=>activate("auth"))}>{L("Login","ورود")}</a>:null}
          {/* R125: three-locale cycle en → fa → ar → en; the link always names the NEXT language. */}
          <a href="#" className="fei-locale-link" onClick={stop(()=>view.setLocale(view.locale==="en"?"fa":view.locale==="fa"?"ar":"en"))} title={L("Switch language","تغییر زبان")}>{view.locale==="en"?"فارسی":view.locale==="fa"?"العربية":"EN"}</a>
          <span className="fei-topbar-layout"><LayoutSwitcher locale={view.locale}/></span>
        </div>
        <div className="extlinks">
          <a title="FEI Database Home Page" href="#" onClick={stop(()=>activate("home"))}>
            <img src={`${IMG}/btn-home.webp`} alt=""/>
            <span>{L("FEI Database","پایگاه داده FEI")}</span>
            {/* the donor rendered a literal <subscript> element; browsers treat unknown
                tags as unstyled inlines — normalize to the standard <sub> element */}
            {createElement("sub", null, DONOR_VERSION)}
          </a>
        </div>
        <h1 className="top-bar-body-logo">
          <a title="FEI Website" href="#" onClick={stop(()=>activate("home"))}>
            <img src={`${IMG}/logo.webp`} alt="FEI"/>
          </a>
        </h1>
      </div>
    </div>
    {/* ── donor .top-nav — the ASP.NET Menu (div.nav#topMenu) verbatim ── */}
    {navigationLayout==="tabs"&&<div className="top-nav">
      <div className="top-nav-body">
        <div className="nav" id="topMenu" onKeyDown={e=>{if(e.key==="Escape")setOpen(null)}}>
          <ul className="level1 static" tabIndex={0} role="menubar">
            {visibleNav.map((item,i)=>{
              const kids=(item.children||[]).filter(c=>c.show!==false);
              const hasPopup=kids.length>0;
              const isOpen=open===i;
              const label=navLabel(item.label);
              return <li key={item.label[0]} role="menuitem" className={hasPopup?`has-popup static${isOpen?" open":""}`:"static"}
                aria-haspopup={hasPopup?"menu":undefined} aria-expanded={hasPopup?isOpen:undefined}
                onMouseEnter={()=>enter(i)} onMouseLeave={()=>leave()}>
                <a title={label} href="#" className="level1 static" aria-current={active===item.key?"page":undefined}
                  onFocus={()=>enter(i)}
                  onClick={stop(()=>{if(hasPopup)setOpen(isOpen?null:i);else activate(item.key)})}>{label}</a>
                {hasPopup&&<ul className="level2 dynamic" style={{display:isOpen?"block":"none"}}>
                  {kids.map(c=>{
                    const cLabel=navLabel(c.label);
                    return <li key={c.label[0]} role="menuitem" className="dynamic">
                      <a title={cLabel} href="#" className={`level2 dynamic${active===c.key?" selected":""}`}
                        onClick={stop(()=>activate(c.key))}>{cLabel}</a>
                    </li>;
                  })}
                </ul>}
              </li>;
            })}
          </ul>
        </div>
        <div style={{clear:"left"}}/>
      </div>
    </div>}
    {navigationLayout==="sidebar"&&<div className="fc112-donor-layout-note" role="note">{L("Sections moved to the sidebar.","بخش‌ها به نوار کناری منتقل شدند.")}</div>}
    <div className="fei-mobile-bar"><button className="fei-mobile-logo" onClick={()=>activate("home")} aria-label={L("FEI Database home","خانه پایگاه داده FEI")}><img src={`${IMG}/logo.webp`} alt="FEI"/></button><button className="fei-hamburger" onClick={()=>setDrawerOpen(true)} aria-label={L("Open menu","باز کردن منو")}><span aria-hidden="true"></span></button></div>
    <nav className="fei-mobile-bottom-nav" aria-label={L("Mobile primary navigation","پیمایش اصلی موبایل")}>
      <button className={active==="home"?"active":""} onClick={()=>activate("home")}><Icon name="horse"/><small>{L("Home","خانه")}</small></button>
      <button className={active==="registry"||active==="people"?"active":""} onClick={()=>activate("registry")}><Icon name="search"/><small>{L("Horses","اسب‌ها")}</small></button>
      <button className={active==="pedigree"||active==="breeding"?"active":""} onClick={()=>activate("pedigree")}><Icon name="tree"/><small>{L("Pedigree","تبار")}</small></button>
      <button className={active==="analytics"||active==="intelligence"||active==="quality"?"active":""} onClick={()=>activate("analytics")}><Icon name="chart"/><small>{L("Analytics","تحلیل")}</small></button>
      <button className={drawerOpen?"active":""} onClick={()=>setDrawerOpen(true)} aria-label={L("More sections","بخش‌های بیشتر")}><span className="fei-mobile-more-icon">•••</span><small>{L("More","بیشتر")}</small></button>
    </nav>
    <div className={`fei-mobile-drawer ${drawerOpen?"open":""}`} aria-hidden={!drawerOpen}><button className="fei-drawer-backdrop" onClick={()=>setDrawerOpen(false)} aria-label={L("Close menu","بستن منو")}/><aside><div className="fei-drawer-head"><img className="fei-drawer-fei-logo" src={`${IMG}/logo.webp`} alt="FEI"/><button onClick={()=>setDrawerOpen(false)} aria-label={L("Close menu","بستن منو")}>×</button></div><nav>{visibleNav.map((item,i)=>{const expanded=drawerItem===i;const kids=(item.children||[]).filter(c=>c.show!==false);return <div className="fei-drawer-group" key={item.label[0]}><div><button className={active===item.key?"active":""} aria-current={active===item.key?"page":undefined} onClick={()=>activate(item.key)}>{navLabel(item.label)}</button>{kids.length>0&&<button className="fei-drawer-toggle" aria-label={L("Toggle submenu","باز و بستن زیرمنو")} onClick={()=>setDrawerItem(expanded?null:i)}><span className={`fei-chevron ${expanded?"open":""}`} aria-hidden="true"/></button>}</div>{kids.length>0&&<div className={`fei-drawer-sub ${expanded?"open":""}`}>{kids.map(c=><button key={c.label[0]} className={active===c.key?"active":""} onClick={()=>activate(c.key)}>{navLabel(c.label)}</button>)}</div>}</div>})}</nav><div className="fei-drawer-foot"><button className="btn-search" onClick={()=>activate("auth")}>{view.user?L("Account / Logout","حساب / خروج"):L("Login","ورود")}</button><small>Horse DB · Federation Classic · <bdi>{view.platformMeta?.contractVersion||view.platform.contractVersion}</bdi></small></div></aside></div>
  </header>;
}
