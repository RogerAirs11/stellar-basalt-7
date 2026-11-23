import { uiText, type UiLocale } from "../shared/uiLocale";
export type AnalysisLocale=UiLocale;
const FA_DIGITS="۰۱۲۳۴۵۶۷۸۹";
function digits(value:unknown){return String(value??"").replace(/\d/g,d=>FA_DIGITS[Number(d)])}

const EXACT_FA:Record<string,string>={
  "Direct recorded sire-of-sire and dam-of-dam root representation in the recent analytical cohort; this is lineage persistence, not whole-genome ancestry.":"نمایش ریشه‌های مستقیم پدرِ پدر و مادرِ مادر در گروه تحلیلی اخیر؛ این شاخص پایداری خط خونی را نشان می‌دهد، نه تبار کل ژنوم.",
  "Recorded ancestor-position appearances across cycle-clean horse pedigrees through four generations; not a genetic contribution score.":"تعداد حضور نیاکان در جایگاه‌های تبارنامهٔ اسب‌های بدون چرخه تا چهار نسل؛ این شاخص امتیاز سهم ژنتیکی نیست.",
  "Pedigree completeness and represented-ancestor aggregates exclude horses whose recorded ancestry reaches a detected cycle.":"در تجمیع کامل‌بودن تبارنامه و نیاکان پرتکرار، اسب‌هایی که تبار ثبت‌شدهٔ آن‌ها به چرخهٔ شناسایی‌شده می‌رسد کنار گذاشته می‌شوند.",
  "Cycle-clean recent same-breed reference population. Mean kinship distributions are based on exact pedigree kinship to a stable deterministic sample, not genomic relationships.":"جمعیت مرجع اخیرِ هم‌نژاد و بدون چرخه؛ توزیع میانگین خویشاوندی بر پایهٔ خویشاوندی دقیق تبارنامه‌ای با یک نمونهٔ قطعی و پایدار است، نه روابط ژنومی.",
  "Unique recorded descendants reached through four generations, partitioned by descendant birth period. This measures registry lineage reach/momentum, not genetic merit, phenotype or breeding value.":"نوادگان یکتای ثبت‌شده تا چهار نسل، تفکیک‌شده بر اساس دورهٔ تولد نواده؛ این شاخص گستره و روند تبار در سامانه ثبت را می‌سنجد، نه ارزش ژنتیکی، فنوتیپ یا ارزش اصلاحی.",
  "Records carrying the exact 19010101 source/default date are excluded from premium demographic trends.":"رکوردهایی که تاریخ پیش‌فرض/منبع دقیق ۱۹۰۱۰۱۰۱ دارند از روندهای جمعیتی پیشرفته کنار گذاشته می‌شوند.",
  "Premium birth-year trends use plausible source years after documented sentinel exclusion; raw registry years remain available separately.":"روندهای پیشرفتهٔ سال تولد پس از حذف مستند مقدار نشانه، فقط از سال‌های معتبر و محتمل منبع استفاده می‌کنند؛ سال‌های خام سامانه ثبت جداگانه در دسترس می‌مانند.",
  "Horses whose recorded ancestry reaches a cycle are excluded from population pedigree aggregates.":"اسب‌هایی که تبار ثبت‌شدهٔ آن‌ها به چرخه می‌رسد از تجمیع‌های جمعیتی تبارنامه کنار گذاشته می‌شوند.",
  "Population pedigree aggregates use cycle-clean recorded pedigrees; per-horse reports still expose integrity warnings explicitly.":"تجمیع‌های جمعیتی تبارنامه فقط از تبارنامه‌های ثبت‌شدهٔ بدون چرخه استفاده می‌کنند؛ گزارش هر اسب همچنان هشدارهای یکپارچگی را صریح نمایش می‌دهد.",
  "Concentration of registry horse-to-person role links. These measure registry linkage concentration, not business quality, economic market share, or current physical custody unless the source role itself establishes that context.":"تمرکز پیوندهای نقشی اسب به افراد در سامانه ثبت؛ این شاخص تمرکز پیوندهای ثبتی را می‌سنجد، نه کیفیت کسب‌وکار، سهم بازار اقتصادی یا نگهداری فیزیکی جاری، مگر آن‌که نقش منبع چنین معنایی داشته باشد.",
  "Equivalent complete generations sum positional completeness fractions by generation through depth 8; pedigree-only structural depth, not genomic diversity.":"نسل‌های کامل معادل از جمع کسر کامل‌بودن جایگاهی هر نسل تا عمق ۸ به دست می‌آید؛ این فقط عمق ساختاری تبارنامه است، نه تنوع ژنومی.",
  "Disposable registry-wide analytics derived from canonical Horse DB records with explicit premium analytical eligibility/exclusion rules. Rebuild when sourceRevision changes.":"آمار مشتق‌شدهٔ کل سامانه ثبت از رکوردهای مرجع Horse DB با قواعد صریح ورود و حذف تحلیلی پیشرفته ساخته شده است و با تغییر نسخهٔ منبع باید بازسازی شود.",
  "recorded pedigree cycle detected":"چرخه در تبارنامهٔ ثبت‌شده شناسایی شد",
  "analysis node boundary reached":"تحلیل به مرز ایمن تعداد گره‌ها رسید",
  "cycle-clean recorded pedigree with at least 75% positional coverage":"تبارنامهٔ ثبت‌شده بدون چرخه است و دست‌کم ۷۵٪ پوشش جایگاهی دارد",
  "analysis boundary reached":"تحلیل به مرز ایمن تعیین‌شده رسید",
  "cycle-clean parent pedigrees with at least 75% projected positional coverage":"تبارنامهٔ هر دو والد بدون چرخه است و پوشش جایگاهی پیش‌بینی‌شده دست‌کم ۷۵٪ است",
  "mean kinship not precomputed because this horse is outside the current recent reference cohort; rarity/direct-line context remains available":"میانگین خویشاوندی از پیش محاسبه نشده، زیرا این اسب خارج از گروه مرجع اخیر است؛ اطلاعات کمیابی و خطوط مستقیم همچنان در دسترس است.",
  "Path-weighted rarity of recorded ancestors relative to their presence across the recent same-breed reference population.":"کمیابی نیاکان ثبت‌شده با وزن‌دهی مسیر، نسبت به میزان حضور آن‌ها در جمعیت مرجع اخیرِ هم‌نژاد محاسبه شده است.",
  "Horse DB decision-support index combining low sampled mean kinship, rare recorded ancestors and rare direct lines. It is not a breeding value, genomic score, health prediction or measure of horse quality.":"شاخص پشتیبان تصمیم Horse DB با ترکیب میانگین خویشاوندی نمونه‌ای پایین، نیاکان ثبت‌شدهٔ کمیاب و خطوط مستقیم کمیاب ساخته می‌شود؛ این شاخص ارزش اصلاحی، امتیاز ژنومی، پیش‌بینی سلامت یا سنجهٔ کیفیت اسب نیست.",
  "Population-relative pedigree intelligence using cycle-clean canonical parentage and a deterministic same-breed recent reference sample. No genomic similarity is inferred.":"تحلیل تبارنامه‌ای نسبت به جمعیت، بر پایهٔ والدین مرجعِ بدون چرخه و نمونهٔ مرجع قطعی از جمعیت اخیرِ هم‌نژاد محاسبه می‌شود؛ هیچ شباهت ژنومی از آن استنباط نمی‌شود.",
  "Sampling precision is unavailable because a valid sampled mean-kinship standard error is not available for this record.":"دقت نمونه‌گیری در دسترس نیست، زیرا خطای استاندارد معتبر برای میانگین خویشاوندی نمونه‌ای این رکورد موجود نیست.",
  "Recorded-pedigree path-weight diversity/concentration. Ancestor path weights use 1/2^generation and normalized shares are shares of recorded pedigree path evidence, not genomic ancestry or genetic merit.":"تنوع و تمرکز مسیرهای تبارنامهٔ ثبت‌شده؛ وزن مسیر نیاکان بر پایهٔ ۱/۲ به توان نسل است و سهم‌های نرمال‌شده فقط سهم شواهد مسیرهای ثبت‌شده‌اند، نه تبار ژنومی یا ارزش ژنتیکی.",
  "Bounded pedigree path atlas showing recorded ancestry routes through shared ancestors. Multiple paths may overlap; counts are traced routes, not independent genetic contributions.":"اطلس محدود مسیرهای تبارنامه که راه‌های ثبت‌شدهٔ تبار از میان نیاکان مشترک را نشان می‌دهد؛ مسیرها ممکن است هم‌پوشانی داشته باشند و تعداد مسیرها سهم‌های مستقل ژنتیکی محسوب نمی‌شوند.",
  "Prospective offspring pedigree COI equals parental kinship for the selected finite pedigree depth. This is a structural pedigree estimate, not genomic COI, genetic-disease risk, fertility, performance, market value, or a breeding recommendation.":"ضریب هم‌خونی تبارنامه‌ای فرزند فرضی در عمق محدود انتخاب‌شده برابر خویشاوندی والدین است؛ این فقط برآورد ساختاری تبارنامه است و ضریب هم‌خونی ژنومی، خطر بیماری ژنتیکی، باروری، عملکرد، ارزش بازار یا توصیهٔ جفت‌گیری نیست.",
  "Prospective offspring recorded-pedigree diversity projection from sire and dam ancestry. Path weights use 1/2^generation and are not genomic ancestry, disease risk, performance prediction, or breeding merit.":"پیش‌بینی تنوع تبارنامهٔ ثبت‌شدهٔ فرزند فرضی از تبار پدر و مادر؛ وزن مسیرها بر پایهٔ ۱/۲ به توان نسل است و تبار ژنومی، خطر بیماری، پیش‌بینی عملکرد یا ارزش اصلاحی محسوب نمی‌شود.",
  "Explainable ranking over a user-supplied candidate set using recorded-pedigree COI, projected ancestor diversity/concentration and optional reference-population diversity context. Recorded sire/dam sex-role contradictions are not ranked; unknown historical sex remains analyzable with an explicit warning.":"رتبه‌بندی توضیح‌پذیرِ نامزدهای انتخاب‌شدهٔ کاربر بر پایهٔ ضریب هم‌خونی تبارنامه‌ای، تنوع و تمرکز پیش‌بینی‌شدهٔ نیاکان و در صورت وجود، زمینهٔ تنوع جمعیت مرجع؛ نامزدهای دارای تعارض روشن بین جنسیت ثبت‌شده و نقش پدر/مادر رتبه‌بندی نمی‌شوند و جنسیت تاریخی نامشخص با هشدار صریح قابل تحلیل است.",
  "Explainable ranking over a user-supplied candidate set using recorded-pedigree COI, projected ancestor diversity/concentration and optional reference-population diversity context. Recorded sire/dam sex-role contradictions are excluded; unknown historical sex remains analyzable with reduced confidence. Missing score components renormalize the remaining weights.":"رتبه‌بندی توضیح‌پذیرِ نامزدهای انتخاب‌شدهٔ کاربر بر پایهٔ ضریب هم‌خونی تبارنامه‌ای، تنوع و تمرکز پیش‌بینی‌شدهٔ نیاکان و در صورت وجود، زمینهٔ تنوع جمعیت مرجع؛ تعارض روشن جنسیت ثبت‌شده با نقش پدر/مادر حذف می‌شود، جنسیت تاریخی نامشخص با اطمینان کمتر تحلیل می‌شود و در صورت نبود بعضی مؤلفه‌ها وزن مؤلفه‌های باقی‌مانده دوباره نرمال می‌شود.",
  "Decision support only. This is not genetic merit, genomic compatibility, health, fertility, conformation, temperament, performance or market-value prediction.":"این ابزار فقط برای پشتیبانی تصمیم است و ارزش ژنتیکی، سازگاری ژنومی، سلامت، باروری، ساختار بدنی، خلق‌وخو، عملکرد یا ارزش بازار را پیش‌بینی نمی‌کند.",
  "Structural pedigree coverage; repeated ancestors count in every occupied pedigree position. This is not a genetic coefficient.":"پوشش ساختاری تبارنامه؛ نیاکان تکراری در هر جایگاه اشغال‌شدهٔ تبارنامه شمارش می‌شوند. این شاخص ضریب ژنتیکی نیست.",
  "Unique registered descendants reached within the selected bounded depth; this is a registry reach count, not a genetic influence score.":"تعداد نوادگان یکتای ثبت‌شده که در عمق محدود انتخاب‌شده قابل دسترسی‌اند؛ این یک شمارش گسترهٔ ثبت است، نه امتیاز نفوذ ژنتیکی.",
  "Candidate is missing, deleted, or its pedigree graph could not be loaded.":"نامزد پیدا نشد، حذف شده است یا نمودار تبارنامهٔ آن بارگذاری نشد.",
  "candidate reference-population DPI unavailable; weights renormalized":"DPI جمعیت مرجع برای نامزد در دسترس نیست؛ وزن‌ها دوباره نرمال شدند",
  "Outcross — projected offspring COI below 1%":"اوت‌کراس — ضریب هم‌خونی پیش‌بینی‌شدهٔ فرزند کمتر از ۱٪",
  "Mild linebreeding — projected COI 1–6.25%":"لاین‌بریدینگ ملایم — ضریب هم‌خونی پیش‌بینی‌شده ۱ تا ۶٫۲۵٪",
  "Linebreeding — projected COI 6.25–12.5%":"لاین‌بریدینگ — ضریب هم‌خونی پیش‌بینی‌شده ۶٫۲۵ تا ۱۲٫۵٪",
  "Close inbreeding — projected COI 12.5% or higher":"هم‌خونی نزدیک — ضریب هم‌خونی پیش‌بینی‌شده ۱۲٫۵٪ یا بیشتر",
  "Insufficient ancestry — too few recorded ancestors behind this pairing for a comparative label; the COI estimate over unobserved ancestry is not evidence of unrelatedness":"تبار ثبت‌شده برای این جفت‌گیری برای برچسب مقایسه‌ای کافی نیست؛ برآورد ضریب هم‌خونی روی تبارِ مشاهده‌نشده، دلیل بی‌ربطی والدین نیست",
  "Unknown — insufficient pedigree for classification":"نامشخص — تبارنامه برای طبقه‌بندی کافی نیست",
  "Comparative pedigree labels require a minimum of recorded ancestry defined by this registry's documented policy; the threshold is a policy choice, not a scientific consensus.":"برچسب‌های مقایسه‌ای تبارنامه به حداقلی از تبار ثبت‌شده طبق سیاست مستند این ثبت نیاز دارند؛ این آستانه یک انتخاب سیاستی است، نه اجماع علمی.",
};

export function localizedAnalysisText(text:string,locale:AnalysisLocale):string{
  if(locale!=="fa")return uiText(locale,text);
  if(EXACT_FA[text])return EXACT_FA[text];
  let m=text.match(/^([0-9.]+)% recorded pedigree completeness through generation ([0-9]+)$/);
  if(m)return `کامل‌بودن تبارنامهٔ ثبت‌شده تا نسل ${digits(m[2])}: ${digits(m[1])}٪`;
  m=text.match(/^(.*?) recent reference population n=([0-9]+)$/);
  if(m)return `جمعیت مرجع اخیر ${m[1]}؛ تعداد ${digits(m[2])}`;
  m=text.match(/^sampled exact pedigree mean kinship using deterministic reference sample n=([0-9]+)$/);
  if(m)return `میانگین خویشاوندی دقیق تبارنامه‌ای با نمونهٔ مرجع قطعی؛ اندازهٔ نمونه ${digits(m[1])}`;
  m=text.match(/^([0-9]+) unresolved parent reference\(s\)$/);
  if(m)return `${digits(m[1])} ارجاع والد حل‌نشده`;
  m=text.match(/^pedigree completeness ([0-9.]+)%$/);
  if(m)return `کامل‌بودن تبارنامه ${digits(m[1])}٪`;
  m=text.match(/^projected pedigree completeness ([0-9.]+)%$/);
  if(m)return `کامل‌بودن پیش‌بینی‌شدهٔ تبارنامه ${digits(m[1])}٪`;
  m=text.match(/^pedigree integrity status: (.+)$/);
  if(m)return `وضعیت یکپارچگی تبارنامه: ${localizedCodeLabel(m[1],locale)}`;
  m=text.match(/^fixed horse recorded sex \((.+)\) conflicts with requested (sire|dam) role; no candidates ranked$/);
  if(m)return `جنسیت ثبت‌شدهٔ اسب ثابت (${localizedCodeLabel(m[1],locale)}) با نقش درخواستی ${m[2]==="sire"?"پدر":"مادر"} سازگار نیست؛ هیچ نامزدی رتبه‌بندی نشد.`;
  m=text.match(/^fixed horse recorded sex is (.+); (sire|dam) role is user-supplied and confidence is reduced$/);
  if(m)return `جنسیت ثبت‌شدهٔ اسب ثابت ${localizedCodeLabel(m[1],locale)} است؛ نقش ${m[2]==="sire"?"پدر":"مادر"} را کاربر تعیین کرده و سطح اطمینان کاهش یافته است.`;
  m=text.match(/^candidate recorded sex \((.+)\) conflicts with required (sire|dam) role\.$/);
  if(m)return `جنسیت ثبت‌شدهٔ نامزد (${localizedCodeLabel(m[1],locale)}) با نقش لازم ${m[2]==="sire"?"پدر":"مادر"} سازگار نیست.`;
  m=text.match(/^candidate recorded sex is (.+); (sire|dam) role is user-supplied$/);
  if(m)return `جنسیت ثبت‌شدهٔ نامزد ${localizedCodeLabel(m[1],locale)} است؛ نقش ${m[2]==="sire"?"پدر":"مادر"} را کاربر تعیین کرده است.`;
  m=text.match(/^fixed horse recorded sex is (.+); (sire|dam) role is user-supplied$/);
  if(m)return `جنسیت ثبت‌شدهٔ اسب ثابت ${localizedCodeLabel(m[1],locale)} است؛ نقش ${m[2]==="sire"?"پدر":"مادر"} را کاربر تعیین کرده است.`;
  m=text.match(/^([0-9]+) requested avoid-ancestor\(s\) present; score penalized$/);
  if(m)return `${digits(m[1])} نیای مورد پرهیز در تبارنامه حضور دارد؛ امتیاز کاهش داده شد.`;
  m=text.match(/^Excluded because ([0-9]+) requested avoid-ancestor\(s\) are present in the bounded recorded pedigree\.$/);
  if(m)return `به‌دلیل حضور ${digits(m[1])} نیای مورد پرهیز در تبارنامهٔ ثبت‌شدهٔ محدود، نامزد حذف شد.`;
  m=text.match(/^Projected pedigree COI ([0-9.]+)% exceeds configured ceiling ([0-9.]+)%\.$/);
  if(m)return `ضریب هم‌خونی تبارنامه‌ای پیش‌بینی‌شده ${digits(m[1])}٪ از سقف تنظیم‌شدهٔ ${digits(m[2])}٪ بیشتر است.`;
  if(text.startsWith("Sampling precision is graded from the normal-theory nominal 95% half-width")){
    const n=text.match(/\(([0-9.]+) percentage points\)/)?.[1];
    return `دقت نمونه‌گیری از نیم‌عرض اسمی ۹۵٪ بر پایهٔ تقریب نرمال${n?` (${digits(n)} واحد درصد)`:""} درجه‌بندی می‌شود. این بازه فقط شاخص دقت نمونه است و تضمین پوشش تجربی ۹۵٪ یا قطعیت ژنومی نیست.`;
  }
  if(/[\u0600-\u06ff]/.test(text))return text;
  return "توضیح تحلیلی این مورد هنوز به فارسی بومی‌سازی نشده است.";
}

export function analysisMethodLabel(value:string,locale:AnalysisLocale):string{
  if(locale!=="fa")return uiText(locale,value);
  const labels:Record<string,string>={
    "sampled-exact-pedigree-kinship":"خویشاوندی دقیق تبارنامه‌ای بر پایهٔ نمونهٔ مرجع",
    "recorded-pedigree-path-weight-diversity":"تنوع وزنی مسیرهای تبارنامهٔ ثبت‌شده",
    "finite-pedigree-tabular-relationship":"رابطهٔ تبارنامه‌ای محدود و جدولی",
    "bounded-pedigree-path-atlas":"اطلس محدود مسیرهای تبارنامه",
    "normal-half-width-calibration-v1":"کالیبراسیون دقت نمونه بر پایهٔ نیم‌عرض اسمی",
    "prospective-offspring-pedigree-coi-from-parental-kinship":"ضریب هم‌خونی تبارنامه‌ای فرزند فرضی بر پایهٔ خویشاوندی والدین",
    "prospective-offspring-recorded-pedigree-diversity":"تنوع تبارنامهٔ ثبت‌شدهٔ فرزند فرضی",
    "explainable-pedigree-mating-candidate-ranking":"رتبه‌بندی توضیح‌پذیر نامزدهای جفت‌گیری بر پایهٔ تبارنامه",
    "pedigree-position-coverage":"پوشش جایگاه‌های تبارنامه",
    "bounded-descendant-reach":"گسترهٔ محدود نوادگان",
  };
  return labels[value]??value.replaceAll("-"," ");
}

export function founderAssumptionLabel(value:string,locale:AnalysisLocale):string{
  if(locale!=="fa")return uiText(locale,value);
  if(value.includes("unobserved")&&value.includes("unrelated")&&value.includes("founder"))return "والدین مشاهده‌نشده یا خارج از عمق تحلیل، بنیان‌گذاران نامرتبط و بدون هم‌خونی فرض می‌شوند.";
  return localizedAnalysisText(value,locale);
}

export function localizedCodeLabel(value:string,locale:AnalysisLocale):string{
  if(locale!=="fa")return uiText(locale,value);
  const key=value.toLowerCase().replaceAll("-","_").replaceAll(" ","_");
  return ({
    high:"زیاد",medium:"متوسط",low:"کم",unavailable:"ناموجود",unknown:"نامشخص",ambiguous:"مبهم",male:"نر",female:"ماده",stallion:"نریان",mare:"مادیان",sire:"پدر",dam:"مادر",ok:"سالم",partial:"ناقص",cycle:"چرخه",truncated:"محدودشده",
    missing_candidate:"نامزد ناموجود",sex_role_conflict:"تعارض جنسیت و نقش",avoid_ancestor_exclusion:"حذف به‌دلیل نیای مورد پرهیز",coi_ceiling_exceeded:"عبور از سقف ضریب هم‌خونی",
    low_projected_coi:"ضریب هم‌خونی پیش‌بینی‌شدهٔ پایین",ancestor_diversity:"تنوع نیاکان",low_ancestor_concentration:"تمرکز پایین نیاکان",candidate_diversity_preservation:"حفظ تنوع نامزد",
  } as Record<string,string>)[key]??value;
}
