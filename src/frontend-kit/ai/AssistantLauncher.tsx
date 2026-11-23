import React,{useEffect,useState} from "react";
import {MessageCircle,Sparkles,X} from "lucide-react";
import type { AiAssistantStatus,PlatformClient } from "../../contracts/platform";
import type { AssistantPageContext,AssistantVisualVariant } from "./AssistantPanel";
// R114-13: the panel (markdown view, sound cues, entity links) only loads when
// the assistant opens; the launcher button itself stays on the critical path.
const AssistantPanel=React.lazy(()=>import("./AssistantPanel").then(m=>({default:m.AssistantPanel})));

function readinessLabel(status:AiAssistantStatus|null,locale:"en"|"fa"|"ar"){
 const fa=locale==="fa";
 if(!status)return fa?"در حال بررسی وضعیت دستیار…":"Checking assistant status…";
 if(status.available)return fa?"دستیار هوش مصنوعی آماده است":"AI assistant ready";
 if(status.reason==="assistant_disabled")return fa?"دستیار هوش مصنوعی غیرفعال است":"AI assistant is disabled";
 if(status.reason==="storage_not_ready")return fa?"ذخیره‌سازی دستیار آماده نیست":"AI assistant storage is not ready";
 if(status.reason==="no_provider_configured")return fa?"ارائه‌دهنده هوش مصنوعی تنظیم نشده است":"No AI provider is configured";
 return fa?"دستیار هوش مصنوعی هنوز آماده نیست":"AI assistant is not ready yet";
}
function launcherLabel(variant:AssistantVisualVariant,locale:"en"|"fa"|"ar"){
 const fa=locale==="fa";
 if(variant==="classic-registry")return fa?"پژوهش با هوش مصنوعی":"AI Research";
 if(variant==="heritage")return fa?"دستیار سامانه ثبت":"Registry AI";
 return fa?"دستیار هوش مصنوعی":"AI Assistant";
}

export function AssistantLauncher({platform,locale,pageContext,variant="default"}:{platform:PlatformClient;locale:"en"|"fa"|"ar";pageContext?:AssistantPageContext;variant?:AssistantVisualVariant}){
 const[status,setStatus]=useState<AiAssistantStatus|null>(null),[open,setOpen]=useState(false);
 useEffect(()=>{let live=true;setStatus(null);platform.ai.status().then(s=>{if(live)setStatus(s)}).catch(()=>{if(live)setStatus({available:false,defaultModel:null,models:[],visionAvailable:false,storageReady:false,reason:"status_unreachable"})});return()=>{live=false}},[platform]);
 useEffect(()=>{if(!open)return;const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false)};addEventListener("keydown",onKey);return()=>removeEventListener("keydown",onKey)},[open]);
 const readiness=status?.available?"ready":status?"unavailable":"checking",title=readinessLabel(status,locale),label=launcherLabel(variant,locale);
 return <div className={`hdb-ai-launcher hdb-ai-launcher-${variant} ${open?"open":""}`} data-ai-readiness={readiness} dir={locale==="fa"?"rtl":"ltr"}>
  {open?<div className="hdb-ai-popover" role="dialog" aria-label={label}><React.Suspense fallback={<p role="status">…</p>}><AssistantPanel platform={platform} locale={locale} pageContext={pageContext} onClose={()=>setOpen(false)} variant={variant}/></React.Suspense></div>:null}
  <button className="hdb-ai-fab" onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-label={open?(locale==="fa"?"بستن گفت‌وگوی هوش مصنوعی":"Close AI chat"):(locale==="fa"?"باز کردن گفت‌وگوی هوش مصنوعی":"Open AI chat")} title={title}>
   <span className="hdb-ai-fab-icon" aria-hidden="true">{open?<X size={18}/>:variant==="heritage"?<Sparkles size={18}/>:<MessageCircle size={18}/>}</span><span className="hdb-ai-fab-label">{label}</span><i className="hdb-ai-fab-status" aria-hidden="true"/>
  </button>
 </div>;
}
