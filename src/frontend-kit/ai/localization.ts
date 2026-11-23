import type { AiEvidenceReference, AiEntityReference } from "../../contracts/platform";

const PERSIAN_RE=/[\u0600-\u06ff]/;

export function localizeAiStatus(code:string,text:string,fa:boolean):string{
  if(!fa){
    switch(code){
      case "interaction_rebase": return "Reconnecting to the AI service…";
      case "history_paused": return "History cannot be saved right now; answering normally and saving resumes automatically later.";
      case "gemini_rate_retry": return "Gemini is temporarily busy; retrying shortly…";
      case "provider_retry": return "Retrying after a temporary AI service error…";
      case "provider_fallback": return "Gemini is unavailable; continuing with the configured fallback…";
      case "memory_compaction": return "Preparing the conversation context…";
      case "cost_rebase": case "context_rebase": return "Preparing the conversation context again…";
      case "budget_finalizing": return "Finishing the answer from the evidence gathered…";
      default:return text;
    }
  }
  switch(code){
    case "local_resolution": return "پاسخ مستقیماً از داده‌های مرجع Horse-DB تهیه شد.";
    case "interaction_rebase": return "در حال برقراری دوبارهٔ ارتباط با سرویس هوش مصنوعی…";
    case "history_paused": return "ذخیرهٔ سابقهٔ گفت‌وگو موقتاً ممکن نیست؛ پاسخ‌ها به‌درستی ادامه می‌یابند و ذخیره‌سازی بعداً خودکار از سر گرفته می‌شود.";
    case "gemini_rate_retry": return "ظرفیت Gemini موقتاً محدود است؛ کمی بعد دوباره تلاش می‌کنیم…";
    case "provider_retry": return "در حال تلاش دوباره پس از یک خطای موقت سرویس هوش مصنوعی…";
    case "provider_fallback": return "Gemini در دسترس نیست؛ ادامه با ارائه‌دهندهٔ پشتیبان پیکربندی‌شده…";
    case "memory_compaction": return "در حال آماده‌سازی سابقهٔ گفت‌وگو برای ادامه…";
    case "cost_rebase": case "context_rebase": return "در حال آماده‌سازی دوبارهٔ زمینهٔ گفت‌وگو…";
    case "budget_finalizing": return "در حال نهایی‌سازی پاسخ بر اساس شواهد گردآوری‌شده…";
    case "researching":{
      const lower=text.toLowerCase();
      if(lower.includes("pedigree")||lower.includes("relationship"))return "در حال بررسی تبارنامه و شواهد خویشاوندی…";
      if(lower.includes("statistics")||lower.includes("analytics"))return "در حال محاسبهٔ آمار سامانه ثبت…";
      if(lower.includes("published")||lower.includes("content"))return "در حال بررسی محتوای منتشرشدهٔ Horse-DB…";
      return "در حال جست‌وجو در سامانه ثبت…";
    }
    default:return PERSIAN_RE.test(text)?text:"در حال انجام درخواست…";
  }
}

const ERROR_FA:Record<string,string>={
  conversation_busy:"یک درخواست دیگر برای این گفت‌وگو در حال اجراست.",
  conversation_not_found:"این گفت‌وگو پیدا نشد.",
  no_provider:"هیچ ارائه‌دهندهٔ هوش مصنوعی در دسترس نیست.",
  provider_network:"ارتباط با سرویس هوش مصنوعی برقرار نشد. دوباره تلاش کنید.",
  provider_stream:"ارتباط با سرویس هوش مصنوعی هنگام دریافت پاسخ قطع شد. دوباره تلاش کنید.",
  provider_request:"ارائه‌دهندهٔ هوش مصنوعی درخواست را نپذیرفت. جزئیات در گزارش عیب‌یابی ثبت شده است.",
  provider_unavailable:"ارائه‌دهندهٔ هوش مصنوعی موقتاً در دسترس نیست. دوباره تلاش کنید.",
  interaction_expired:"نشست ارائه‌دهنده منقضی شده است. گفت‌وگو بازسازی و دوباره امتحان می‌شود.",
  provider_context_limit:"حجم این گفت‌وگو از محدودهٔ قابل پردازش ارائه‌دهنده بیشتر شده است.",
  context_budget_exceeded:"حجم گفت‌وگو از بودجهٔ امن پردازش بیشتر شده است. یک گفت‌وگوی تازه یا درخواست کوتاه‌تر را امتحان کنید.",
  deepseek_request_cost:"این درخواست از سقف هزینهٔ پیکربندی‌شده بیشتر می‌شود.",
  rate_or_quota:"سهمیه یا ظرفیت لحظه‌ای ارائه‌دهنده کافی نیست. کمی بعد دوباره تلاش کنید.",
  gemini_provider_daily_quota:"سهمیهٔ روزانهٔ Gemini به پایان رسیده است.",
  gemini_daily_reserve_reached:"ذخیرهٔ روزانهٔ Gemini به حد تعیین‌شده رسیده است.",
  gemini_rpm_reserve_reached:"حد درخواست‌های دقیقه‌ای Gemini موقتاً پر شده است.",
  gemini_tpm_reserve_reached:"حد توکن ورودی دقیقه‌ای Gemini موقتاً پر شده است.",
  provider_missing_output:"سرویس هوش مصنوعی بدون پاسخ نهایی متوقف شد. دوباره تلاش کنید.",
  provider_ignored_tool_disable:"سرویس هوش مصنوعی نتوانست مرحلهٔ نهایی را طبق انتظار تکمیل کند.",
  tool_call_budget_exceeded:"این درخواست به عملیات بیشتری از سقف مجاز نیاز دارد. درخواست را محدودتر کنید.",
  tool_round_budget_exceeded:"دستیار در تعداد مراحل مجاز نتوانست درخواست را کامل کند. درخواست را محدودتر کنید.",
  provider_empty_response:"سرویس هوش مصنوعی پاسخ قابل نمایش تولید نکرد. دوباره تلاش کنید.",
  gemini_key_missing:"کلید API مربوط به Gemini پیکربندی نشده است.",
  gemini_region_blocked:"سرویس Gemini API برای منطقهٔ این سرور در دسترس نیست. یک کلید Vertex AI Express (که با «AQ.» شروع می‌شود) به GEMINI_API_KEYS اضافه کنید تا درخواست‌ها از مسیر Vertex AI ارسال شوند.",
  gemini_vertex_api_disabled:"کلید Vertex معتبر است اما API مربوط به Vertex AI باید ابتدا در پروژهٔ Google Cloud فعال شود. لینک فعال‌سازی در جزئیات خطا آمده است؛ آن را باز کنید، API را فعال کنید و دوباره تلاش کنید.",
  gemini_key_unauthorized:"کلید API ارائه‌شده پذیرفته نشد.",
  deepseek_key_missing:"کلید API مربوط به DeepSeek پیکربندی نشده است.",
  gemini_quota_unconfigured:"محدودیت‌های سهمیهٔ Gemini پیکربندی نشده‌اند.",
  ai_storage_not_ready:"ذخیره‌سازی گفت‌وگو آماده نیست؛ مهاجرت‌های پایگاه دادهٔ هوش مصنوعی را اعمال کنید.",
  conversation_create_failed:"گفت‌وگو ایجاد شد اما بارگذاری دوبارهٔ آن ناموفق بود.",
  message_create_failed:"پیام ذخیره شد اما بارگذاری دوبارهٔ آن ناموفق بود.",
  assistant_commit_failed:"پاسخ دستیار ذخیره شد اما بارگذاری دوبارهٔ آن ناموفق بود.",
  idempotency_conflict:"شناسهٔ این پیام قبلاً برای متن دیگری استفاده شده است.",
  daily_cost_limit:"این درخواست از سقف هزینهٔ روزانهٔ هوش مصنوعی بیشتر می‌شود.",
  cancelled:"درخواست متوقف شد.",
};

export function localizeAiError(code:string|undefined,message:string,fa:boolean):string{
  if(!fa){
    // Actionable region notices: keep the enable URL clickable/plain in English.
    if(code==="gemini_region_blocked"&&!message.includes("AQ."))return message+" Add a Vertex AI Express API key (starts with \"AQ.\") to GEMINI_API_KEYS to route requests through Vertex AI, which is not region-blocked.";
    return message;
  }
  if(code&&ERROR_FA[code])return ERROR_FA[code];
  if(PERSIAN_RE.test(message))return message;
  const lower=message.toLowerCase();
  if(lower.includes("network")||lower.includes("fetch")||lower.includes("reach"))return ERROR_FA.provider_network;
  if(lower.includes("not found"))return "مورد درخواستی پیدا نشد.";
  if(lower.includes("quota")||lower.includes("rate limit"))return ERROR_FA.rate_or_quota;
  return "در اجرای درخواست مشکلی پیش آمد. دوباره تلاش کنید؛ جزئیات فنی در گزارش عیب‌یابی ثبت شده است.";
}

export function localizeEvidenceTitle(e:AiEvidenceReference,fa:boolean):string{
  if(!fa)return e.title;
  const s=e.sourceRef||"";
  const parts=s.split(":");
  if(s.startsWith("search:"))return `جست‌وجوی سامانه ثبت: ${s.slice(7)}`;
  if(s.startsWith("horse:"))return `پروفایل اسب: #${parts[1]}`;
  if(s.startsWith("registry-browse:"))return "مرور ساختاریافتهٔ سامانه ثبت";
  if(s.startsWith("people-search:"))return parts[1]?`جست‌وجوی افراد: ${parts[1]}`:"فهرست افراد";
  if(s.startsWith("person:"))return `پروفایل فرد: #${parts[1]}`;
  if(s.startsWith("ancestors:"))return `نیاکان اسب #${parts[1]}`;
  if(s.startsWith("descendants:"))return `نوادگان اسب #${parts[1]}`;
  if(s.startsWith("relationship:"))return `خویشاوندی اسب #${parts[1]} و #${parts[2]}`;
  if(s.startsWith("coi:"))return `ضریب هم‌خونی تبارنامه‌ای اسب #${parts[1]}`;
  if(s.startsWith("relationship-coefficient:"))return `ضریب خویشاوندی اسب #${parts[1]} و #${parts[2]}`;
  if(s.startsWith("insights:"))return `تحلیل تبارنامهٔ اسب #${parts[1]}`;
  if(s.startsWith("pairing:"))return `تحلیل جفت‌گیری فرضی #${parts[1]} × #${parts[2]}`;
  if(s.startsWith("analytics:count:"))return "شمارش دقیق رکوردهای فیلترشده";
  if(s.startsWith("analytics-snapshot:"))return `تحلیل مرجع سامانه ثبت: ${parts[1]||""}`.trim();
  if(s.startsWith("analytics:"))return `توزیع ${parts[1]||"فیلترشده"} در سامانه ثبت`;
  if(s.startsWith("content-search:"))return `جست‌وجوی محتوا: ${s.slice("content-search:".length)}`;
  if(s.startsWith("content:"))return PERSIAN_RE.test(e.title)?e.title:"محتوای منتشرشده";
  if(PERSIAN_RE.test(e.title))return e.title;
  switch(e.kind){
    case "registry_record":return "رکورد سامانه ثبت";
    case "pedigree_calculation":return "محاسبهٔ تبارنامه";
    case "registry_analytics":return "تحلیل سامانه ثبت";
    case "published_content":return "محتوای منتشرشده";
    case "external_source":return "منبع بیرونی";
    case "user_attachment":return "پیوست کاربر";
  }
}

export function localizeEntityLabel(ref:AiEntityReference,fa:boolean):string{
  if(!fa||PERSIAN_RE.test(ref.label)||ref.kind!=="content")return ref.label;
  return "محتوای منتشرشده";
}

/** Conversations persisted before the canonical routes shipped stored plural
 * profile paths (/horses, /people); rebuild horse/person targets from kind+id so
 * every stored evidence link still lands on the real profile. */
export function canonicalEntityHref(ref:AiEntityReference):string{
  if(ref.kind==="horse")return `/horse/${encodeURIComponent(ref.id)}`;
  if(ref.kind==="person")return `/person/${encodeURIComponent(ref.id)}`;
  return ref.href;
}
