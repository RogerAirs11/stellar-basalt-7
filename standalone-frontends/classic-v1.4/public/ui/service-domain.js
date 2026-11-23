// src/frontend-kit/errors.ts
var PlatformClientError = class extends Error {
  status;
  code;
  details;
  constructor(status, code, message, details) {
    super(message);
    this.name = "PlatformClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
};
function isPlatformClientError(value) {
  return value instanceof PlatformClientError;
}

// src/shared/serviceTransitions.ts
var SERVICE_TRANSITION_MATRIX = {
  new: {
    requester: ["closed", "withdrawn"],
    provider: ["acknowledged", "closed", "spam"],
    moderator: []
  },
  acknowledged: {
    requester: ["closed", "withdrawn"],
    provider: ["discussing", "closed", "spam"],
    moderator: []
  },
  discussing: {
    requester: ["closed", "withdrawn"],
    provider: ["closed", "spam"],
    moderator: []
  },
  closed: { requester: [], provider: [], moderator: [] },
  withdrawn: { requester: [], provider: [], moderator: [] },
  spam: { requester: [], provider: [], moderator: [] }
};
function serviceTransitionsFor(from, actor) {
  const state = SERVICE_TRANSITION_MATRIX[from];
  return state ? [...state[actor]] : [];
}

// src/frontend-kit/domain/resourceState.ts
function classifyResourceError(error) {
  if (isPlatformClientError(error)) {
    if (error.status === 403) return { phase: "forbidden", reason: error.message };
    if (error.status === 404 || error.status === 501 || error.status === 503) return { phase: "unavailable", reason: error.message };
    if (error.status === 429) return { phase: "error", reason: error.message, retryAfterSeconds: retryAfterSecondsOf(error.details) };
    return { phase: "error", reason: error.message };
  }
  const reason = error instanceof Error ? error.message : String(error);
  return { phase: "error", reason };
}
function retryAfterSecondsOf(details) {
  if (details == null || typeof details !== "object") return void 0;
  const value = details.retry_after_seconds ?? details.retryAfterSeconds;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.ceil(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0) return Math.ceil(Number(value));
  return void 0;
}

// src/frontend-kit/domain/commandModel.ts
function classifyCommandError(error) {
  if (isPlatformClientError(error)) {
    const deliberateRefusal = error.status >= 400 && error.status < 500 || error.status === 501;
    if (deliberateRefusal) {
      return {
        phase: "rejected",
        code: error.code,
        message: error.message,
        status: error.status,
        currentVersion: currentVersionOf(error.details),
        retryAfterSeconds: error.status === 429 ? retryAfterSecondsOf(error.details) : void 0
      };
    }
    return { phase: "failed", message: error.message, status: error.status, code: error.code };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { phase: "failed", message };
}
function currentVersionOf(details) {
  if (details == null || typeof details !== "object") return void 0;
  const record = details;
  const value = record.current_version ?? record.row_version;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  return void 0;
}

// src/frontend-kit/domain/arabicKitCopy.json
var arabicKitCopy_default = {
  Expires: "تنتهي",
  "No reviewed result": "لا توجد نتيجة مراجَعة",
  "Review required": "المراجعة مطلوبة",
  "Result is inconclusive": "النتيجة غير حاسمة",
  "Results disagree": "النتائج متعارضة",
  "Reviewed genotype": "الطرز الوراثي المراجَع",
  "Arabian variant evidence": "أدلة المتغيّرات لدى الخيل العربي",
  "Genetic evidence for this pairing": "الدليل الوراثي لهذا الاقتران",
  "Each estimate concerns one specified variant and one conception. Missing evidence stays unknown.": "كل تقدير يخصّ متغيّرًا محددًا واحدًا وإخصابًا واحدًا. والدليل المفقود يبقى مجهولًا.",
  "Loading reviewed evidence…": "جارٍ تحميل الأدلة المراجَعة…",
  "Refreshing evidence; the previous result is shown below.": "جارٍ تحديث الأدلة؛ النتيجة السابقة معروضة أدناه.",
  "Genetic evidence could not be loaded. The pedigree comparison remains available.": "تعذّر تحميل الدليل الوراثي. ولا تزال مقارنة شجرة النسب متاحة.",
  "Fictional demonstration evidence. No actual laboratory result is claimed.": "أدلة توضيحية افتراضية. لا يُدَّعى فيها أي نتيجة مخبرية فعلية.",
  "Test scope": "نطاق الفحص",
  "Genotype probabilities per conception": "احتمالات الطرز الوراثي لكل إخصاب",
  "0 copies": "٠ نسخة",
  "1 copy": "نسخة واحدة",
  "2 copies": "نسختان",
  "Insufficient evidence for an estimate": "الأدلة غير كافية لإصدار تقدير",
  "Only current, explicitly mapped, reviewed records contribute. Unmapped, withdrawn, expired or changed evidence is excluded.": "تُحتسب السجلات المراجَعة الحالية ذات الربط الصريح فقط. وتُستبعد الأدلة غير المربوطة أو المسحوبة أو المنتهية أو المتغيّرة.",
  "These are genotype probabilities, not a health guarantee or breeding approval. OAAM1 covers only the tested variant and does not rule out other forms of OAAM. Review original reports with an equine genetics specialist.": "هذه احتمالات للطرز الوراثي، وليست ضمانًا صحيًا أو موافقة على التربية. يغطّي فحص OAAM1 المتغيّر المفحوص فقط ولا يُنفيت أشكالًا أخرى من OAAM. راجع التقارير الأصلية مع مختص في وراثة الخيول.",
  "This file changed. Your visibility request is saved below; review the current status before retrying.": "تغيّرت حالة هذا الملف. طلبك محفوظ أدناه؛ راجع الحالة الحالية قبل إعادة المحاولة.",
  "This file changed. Review its current status before trying again.": "تغيّر هذا الملف. راجع حالته الحالية قبل المحاولة مجددًا.",
  "The action could not be confirmed. Check the current status and retry if needed.": "تعذّر تأكيد الإجراء. تحقّق من الحالة الحالية وأعد المحاولة عند الحاجة.",
  "Photo published. Visitors can now view it.": "نُشرت الصورة. يمكن للزوار مشاهدتها الآن.",
  "Publication withdrawn. This file is private and its previous access links are revoked.": "سُحبت الصورة من النشر. هذا الملف خاص وقد أُلغيت روابط الوصول السابقة إليه.",
  "Review rejected. The file is private and its previous access links are revoked.": "رُفضت المراجعة. الملف خاص وقد أُلغيت روابط الوصول السابقة إليه.",
  "Review saved. Publication still needs the uploader's separate consent.": "حُفظت المراجعة. لا يزال النشر بحاجة إلى موافقة منفصلة من المُحمِّل.",
  "Temporary link created. Anyone with this link can open the file until it expires or you revoke it.": "أُنشئ رابط مؤقت. يمكن لأي شخص يملكه فتح الملف حتى انتهاء صلاحيته أو إبطالك له.",
  "This temporary link is revoked.": "أُبطل هذا الرابط المؤقت.",
  "Choose a supported file. Convert AVIF to JPEG, PNG or WebP first.": "اختر ملفًا مدعومًا. حوّل AVIF إلى JPEG أو PNG أو WebP أولًا.",
  "Choose a non-empty file up to 3 MB.": "اختر ملفًا غير فارغ بحجم أقصاه ٣ ميغابايت.",
  "Uploaded privately. A photo needs staff review and your explicit publication before visitors can see it.": "رُفع الملف بشكل خاص. تحتاج الصورة إلى مراجعة الطاقم وموافقتك الصريحة على النشر قبل أن يراها الزوار.",
  "Reviewed by platform staff": "مراجَعة من طاقم المنصة",
  "Rejected — private": "مرفوضة — خاصة",
  "Owner submitted": "أرسلها المالك",
  "Awaiting review": "بانتظار المراجعة",
  "Approve review": "قبول المراجعة",
  "Reject review": "رفض المراجعة",
  "Temporary private link": "رابط خاص مؤقت",
  "Revoke this link": "إبطال هذا الرابط",
  "Create 15-minute access link": "إنشاء رابط وصول لمدة ١٥ دقيقة",
  "Photos and private documents": "الصور والوثائق الخاصة",
  "PHOTOS & DOCUMENTS": "الصور والوثائق",
  "Photos become public only after review and the uploader's explicit consent. Documents remain private. Staff review is not an issuer attestation.": "لا تصبح الصور علنية إلا بعد المراجعة والموافقة الصريحة من المُحمِّل. وتبقى الوثائق خاصة. ومراجعة الطاقم ليست شهادة مُصدر.",
  "photos you can view": "صور يمكنك مشاهدتها",
  "documents you can view": "وثائق يمكنك مشاهدتها",
  "Refreshing…": "جارٍ التحديث…",
  "Refresh media": "تحديث الوسائط",
  "Photos and documents could not be loaded.": "تعذّر تحميل الصور والوثائق.",
  "Loading photos and documents…": "جارٍ تحميل الصور والوثائق…",
  "No photos are available to you yet.": "لا توجد صور متاحة لك بعد.",
  "Horse photo": "صورة الحصان",
  "Open photo": "فتح الصورة",
  "Publish photo": "نشر الصورة",
  "Withdraw publication": "سحب من النشر",
  "Private document": "وثيقة خاصة",
  "File use": "استخدام الملف",
  "Gallery photo": "صورة المعرض",
  "Uploading…": "جارٍ الرفع…",
  "Choose and upload file": "اختيار ملف ورفعه",
  "Up to 3 MB. Uploads start private.": "بحجم أقصاه ٣ ميغابايت. تبدأ عمليات الرفع خاصة.",
  "Saved request:": "طلب محفوظ:",
  "Publish this photo": "نشر هذه الصورة",
  "Retry visibility change": "إعادة محاولة تغيير الإظهار",
  "Dismiss saved request": "إغلاق الطلب المحفوظ",
  "Printable registry information": "معلومات السجل للطباعة",
  "The server confirmed this inquiry; acceptance and notification delivery are not guaranteed.": "أكّد الخادم استلام هذا الاستفسار؛ ولا يُضمن قبوله ولا إيصال الإشعارات.",
  "The device recovery record expired, not the server request. Check My service requests before creating another inquiry.": "انتهت صلاحية سجل الاسترداد على الجهاز، لا طلب الخادم. راجع «طلبات الخدمات» قبل إنشاء استفسار آخر.",
  "No matching receipt is visible yet. The request may still be in flight; recheck and review My service requests before starting again.": "لا يظهر أي إيصال مطابق بعد. قد يكون الطلب قيد المعالجة؛ تحقّق مجددًا وراجع «طلبات الخدمات» قبل البدء من جديد.",
  "An older receipt cannot be linked to one request. Review existing requests or ask support before creating another inquiry.": "لا يمكن ربط إيصال أقدم بطلب واحد بعينه. راجع الطلبات القائمة أو تواصل مع الدعم قبل إنشاء استفسار آخر.",
  "Dispatch is uncertain: a crash can occur after sending. Recheck with the server before starting again.": "حالة الإرسال غير مؤكدة: قد يحدث انهيار بعد الإرسال. تحقّق من الخادم قبل البدء من جديد.",
  "The result cannot be verified yet. Recheck when connected; do not assume success or failure.": "يتعذّر التحقق من النتيجة بعد. تحقّق مجددًا عند الاتصال؛ ولا تفترض النجاح أو الفشل.",
  "Clear device recovery record": "مسح سجل الاسترداد على الجهاز",
  "Clearing this record does not cancel a server request. A new inquiry could create a duplicate.": "مسح هذا السجل لا يلغي طلبًا لدى الخادم. وقد يؤدي استفسار جديد إلى تكرار.",
  "Enter the horse’s registry ID.": "أدخل معرّف السجل الخاص بالحصان.",
  "Use a positive whole registry ID. Persian and Arabic digits are accepted.": "استخدم معرّف سجل عددًا صحيحًا موجبًا. تُقبل الأرقام الفارسية والعربية.",
  "Describe your ownership evidence in at least 10 characters.": "اشرح دليل ملكيتك بما لا يقل عن ١٠ أحرف.",
  "Keep the evidence note within 2,000 characters.": "اجعل ملاحظة الدليل في حدود ٢٠٠٠ حرف.",
  "Describe the correction in at least 3 characters.": "اشرح التصحيح بما لا يقل عن ٣ أحرف.",
  "Keep the correction summary within 2,000 characters.": "اجعل ملخص التصحيح في حدود ٢٠٠٠ حرف.",
  "Provide both a field name and its proposed value, or leave the field proposal empty.": "أدخل اسم الحرف وقيمته المقترحة معًا، أو اترك اقتراح الحقل فارغًا.",
  Closed: "مغلق",
  Spam: "مزعج",
  "Province reference confirmed": "تأكيد مرجع المحافظة"
};

// src/shared/uiCopy.ar.json
var uiCopy_ar_default = {
  "Equine Registry": "سجل الخيل",
  "Pedigree intelligence": "تحليل الأنساب",
  Home: "الرئيسية",
  Registry: "السجل",
  Stats: "الإحصاءات",
  News: "الأخبار",
  Desk: "مساحة العمل",
  AI: "الذكاء الاصطناعي",
  Admin: "الإدارة",
  records: "سجلات",
  "Toggle light and dark mode": "التبديل بين المظهر الفاتح والداكن",
  "Switch language": "تغيير اللغة",
  "Interface language": "لغة الواجهة",
  "Skip to content": "الانتقال إلى المحتوى",
  Account: "الحساب",
  "Sign in / register": "تسجيل الدخول / إنشاء حساب",
  "Sign in or register": "تسجيل الدخول أو إنشاء حساب",
  "Background scene": "الخلفية",
  Subtle: "هادئ",
  Rich: "غني",
  Full: "كامل",
  "Glass overlay mode": "تأثير الزجاج",
  "Global equine registry": "سجل الخيل العالمي",
  "Find the horse.": "ابحث عن الحصان.",
  "Trace the lineage.": "تتبّع نسبه.",
  "Search names, IDs, owners, breeders, years, places and imperfect spellings in one field—then move directly into the pedigree.": "ابحث بالأسماء والمعرّفات والمالكين والمربّين والسنوات والأماكن، حتى مع اختلاف الإملاء، ثم انتقل مباشرة إلى شجرة النسب.",
  "Horse, owner, breeder, ID, year, location…": "حصان، مالك، مربٍّ، معرّف، سنة، مكان…",
  Try: "جرّب",
  "Browse registry": "تصفّح السجل",
  "Enter search · live suggestions": "أدخل بحثًا · اقتراحات مباشرة",
  Search: "بحث",
  "Quick matches": "نتائج سريعة",
  "View all results": "عرض جميع النتائج",
  "Loading…": "جارٍ التحميل…",
  "Loading...": "جارٍ التحميل…",
  Loading: "جارٍ التحميل",
  Retry: "إعادة المحاولة",
  "Try again": "حاول مجددًا",
  Refresh: "تحديث",
  Reload: "إعادة التحميل",
  Cancel: "إلغاء",
  Close: "إغلاق",
  Back: "رجوع",
  Next: "التالي",
  Previous: "السابق",
  Save: "حفظ",
  Saved: "تم الحفظ",
  "Saving…": "جارٍ الحفظ…",
  Apply: "تطبيق",
  Reset: "إعادة الضبط",
  Clear: "مسح",
  "Clear filters": "مسح عوامل التصفية",
  Filters: "عوامل التصفية",
  Filter: "تصفية",
  Sort: "ترتيب",
  All: "الكل",
  None: "لا شيء",
  Yes: "نعم",
  No: "لا",
  More: "المزيد",
  Less: "أقل",
  Open: "فتح",
  View: "عرض",
  Details: "التفاصيل",
  Edit: "تعديل",
  Delete: "حذف",
  Remove: "إزالة",
  Add: "إضافة",
  Create: "إنشاء",
  Continue: "متابعة",
  Submit: "إرسال",
  Confirm: "تأكيد",
  Download: "تنزيل",
  Export: "تصدير",
  Import: "استيراد",
  Copy: "نسخ",
  Copied: "تم النسخ",
  Print: "طباعة",
  Name: "الاسم",
  Title: "العنوان",
  Description: "الوصف",
  Status: "الحالة",
  Type: "النوع",
  Date: "التاريخ",
  Year: "السنة",
  Time: "الوقت",
  Location: "المكان",
  City: "المدينة",
  Province: "المحافظة",
  Country: "البلد",
  Owner: "المالك",
  Breeder: "المربّي",
  Horse: "حصان",
  Horses: "الخيل",
  Sex: "الجنس",
  Breed: "السلالة",
  Color: "لون المعطف",
  Colour: "لون المعطف",
  Sire: "الأب",
  Dam: "الأم",
  Foal: "مهر",
  Pedigree: "شجرة النسب",
  Ancestors: "الأسلاف",
  Descendants: "الذرية",
  Generation: "جيل",
  Generations: "أجيال",
  Depth: "العمق",
  Unknown: "غير معروف",
  "Not recorded": "غير مسجّل",
  "Not available": "غير متاح",
  Unavailable: "غير متاح",
  Pending: "قيد الانتظار",
  Approved: "معتمد",
  Rejected: "مرفوض",
  Active: "نشط",
  Inactive: "غير نشط",
  Expired: "منتهي الصلاحية",
  Revoked: "ملغى",
  Draft: "مسودة",
  Published: "منشور",
  Archived: "مؤرشف",
  Verified: "متحقّق منه",
  Unverified: "غير متحقّق منه",
  Public: "عام",
  Private: "خاص",
  Required: "مطلوب",
  Optional: "اختياري",
  "Search by name": "البحث بالاسم",
  Email: "البريد الإلكتروني",
  Password: "كلمة المرور",
  "Sign in": "تسجيل الدخول",
  "Sign out": "تسجيل الخروج",
  Register: "إنشاء حساب",
  "Create account": "إنشاء حساب",
  "Forgot password?": "هل نسيت كلمة المرور؟",
  "Reset password": "إعادة تعيين كلمة المرور",
  "New password": "كلمة المرور الجديدة",
  "Confirm password": "تأكيد كلمة المرور",
  "Display name": "الاسم الظاهر",
  Profile: "الملف الشخصي",
  Settings: "الإعدادات",
  Security: "الأمان",
  Notifications: "الإشعارات",
  Messages: "الرسائل",
  History: "السجل السابق",
  Actions: "الإجراءات",
  Notes: "الملاحظات",
  Contact: "التواصل",
  Send: "إرسال",
  Accept: "قبول",
  Decline: "رفض",
  Approve: "اعتماد",
  Reject: "رفض",
  Revoke: "إلغاء",
  Archive: "أرشفة",
  Reopen: "إعادة الفتح",
  Total: "الإجمالي",
  Count: "العدد",
  Results: "النتائج",
  Overview: "نظرة عامة",
  Summary: "ملخّص",
  Snapshot: "لمحة",
  Intelligence: "تحليلات متعمّقة",
  Coverage: "التغطية",
  Influence: "التأثير",
  Distribution: "التوزيع",
  Leaders: "المتصدّرون",
  Population: "مجموعة الخيل",
  Demography: "التركيبة السكانية",
  Classification: "التصنيف",
  People: "الأشخاص",
  Rankings: "الترتيبات",
  Quality: "الجودة",
  Findings: "النتائج المرصودة",
  Era: "الفترة",
  "Navigation layout": "تخطيط التنقّل",
  Automatic: "تلقائي",
  Tabs: "علامات التبويب",
  Sidebar: "الشريط الجانبي",
  "Browse sections": "تصفّح الأقسام",
  "Find a section": "البحث عن قسم",
  "Clear section search": "مسح البحث عن قسم",
  "No matching section": "لا يوجد قسم مطابق",
  "Registry & people": "السجل والأشخاص",
  "Research & breeding": "البحث والتربية",
  "Market & operations": "السوق والإدارة",
  "Account & trust": "الحساب والتحقّق",
  "Explore the demo": "استكشاف العرض التجريبي",
  "Home & search": "الرئيسية والبحث",
  "Horse registry": "سجل الخيل",
  "Professional directory": "دليل المختصّين",
  "Registry analytics": "تحليلات السجل",
  "Pedigree explorer": "استكشاف الأنساب",
  "Relationship comparison": "مقارنة القرابة",
  "Breeding analysis": "تحليل التزاوج",
  "Research assistant": "مساعد البحث",
  "Horse marketplace": "سوق الخيل",
  "My marketplace desk": "مساحتي في السوق",
  "Issuer credentials": "وثائق جهات الإصدار",
  Competitions: "المسابقات",
  "Stable workspaces": "مساحات إدارة الإسطبل",
  "Service requests": "طلبات الخدمات",
  "News & updates": "الأخبار والمستجدّات",
  "Account & access": "الحساب والوصول",
  "Claims & corrections": "طلبات إثبات الصلة والتصحيحات",
  "Platform coverage": "الميزات المتاحة",
  "Registry rankings": "ترتيبات السجل",
  "Data quality": "جودة البيانات",
  Watchlist: "قائمة المتابعة",
  "Manage professional profile": "إدارة الملف المهني",
  "Manage organization": "إدارة المؤسسة",
  "Wallpaper presentation": "عرض الخلفية",
  "Pricing & business model": "الأسعار ونموذج العمل",
  "Management & audit (restricted)": "الإدارة والتدقيق (وصول مقيّد)",
  "Synthetic capability demo": "عرض للميزات ببيانات اصطناعية",
  "Current section: ": "القسم الحالي: ",
  "Navigation & appearance": "التنقّل والمظهر",
  "Appearance studio": "استوديو المظهر",
  "Appearance Studio": "استوديو المظهر",
  Appearance: "المظهر",
  "Navigation & layout": "التنقّل والتخطيط",
  "Navigation & Layout": "التنقّل والتخطيط",
  Light: "فاتح",
  Dark: "داكن",
  System: "النظام",
  Theme: "السمة",
  "Color palette": "لوحة الألوان",
  Palette: "لوحة الألوان",
  Accent: "لون التمييز",
  Contrast: "التباين",
  Density: "الكثافة",
  Compact: "مضغوط",
  Comfortable: "مريح",
  Relaxed: "متباعد",
  Typography: "الخطوط",
  Background: "الخلفية",
  Backgrounds: "الخلفيات",
  Motion: "الحركة",
  Animation: "الرسوم المتحركة",
  Animations: "الرسوم المتحركة",
  Lighting: "الإضاءة",
  "Ambient lighting": "الإضاءة المحيطية",
  Organic: "انسيابي",
  Soft: "ناعم",
  Balanced: "متوازن",
  Vibrant: "حيوي",
  Strong: "قوي",
  Off: "متوقف",
  On: "مفعّل",
  Low: "منخفض",
  Medium: "متوسط",
  High: "مرتفع",
  Default: "افتراضي",
  "Reset to defaults": "استعادة الإعدادات الافتراضية",
  "Restore defaults": "استعادة الإعدادات الافتراضية",
  "Orbiting light": "ضوء مداري",
  "Flowing drift": "انسياب متحرّك",
  "Automatic uses a sidebar only when there is room for both the navigation and a full registry workspace. Your manual choice is preserved.": "يعرض الوضع التلقائي شريطًا جانبيًا فقط عند توفّر مساحة كافية للتنقّل والسجل معًا. يُحفظ اختيارك اليدوي.",
  "Language preview: some advanced tools and other designs still use English. Registry names and original content are unchanged.": "معاينة اللغة: لا تزال بعض الأدوات المتقدّمة والتصاميم الأخرى تستخدم الإنجليزية. تبقى أسماء السجل والمحتويات الأصلية دون تغيير.",
  COMPETITIONS: "المسابقات",
  "Competition calendar & results": "تقويم المسابقات ونتائجها",
  "Explore events, open the results, and follow each horse back to its registry record.": "تصفّح الفعاليات ونتائجها، وانتقل إلى سجل كل حصان.",
  "matching events": "فعاليات مطابقة",
  Discipline: "الفئة الرياضية",
  "All disciplines": "جميع الفئات الرياضية",
  Season: "الموسم",
  "All seasons": "جميع المواسم",
  "Season (Persian year)": "الموسم (السنة في التقويم الفارسي)",
  "Show jumping": "قفز الحواجز",
  Dressage: "الترويض",
  Endurance: "القدرة والتحمّل",
  Racing: "سباقات الخيل",
  Eventing: "المسابقة المتكاملة",
  "Halter show": "عروض جمال الخيل",
  Freestyle: "الأداء الحر",
  Local: "محلي",
  Regional: "إقليمي",
  National: "وطني",
  International: "دولي",
  "Open results": "عرض النتائج",
  "Close results": "إغلاق النتائج",
  "No events match these filters.": "لا توجد فعاليات تطابق عوامل التصفية هذه.",
  "The calendar could not be loaded. This does not mean there are no events.": "تعذّر تحميل التقويم. لا يعني ذلك عدم وجود فعاليات.",
  "Results could not be loaded. Please try again.": "تعذّر تحميل النتائج. يُرجى المحاولة مجددًا.",
  "No published results for this event yet.": "لم تُنشر نتائج لهذه الفعالية بعد.",
  "Choose an event to view results.": "اختر فعالية لعرض نتائجها.",
  Placement: "المركز",
  Place: "المركز",
  Rider: "الفارس",
  Class: "الفئة",
  Score: "النتيجة",
  Points: "النقاط",
  Venue: "موقع الفعالية",
  Organizer: "الجهة المنظّمة",
  "Recorded results": "النتائج المسجّلة",
  "Partial results": "نتائج جزئية",
  "Previous page": "الصفحة السابقة",
  "Next page": "الصفحة التالية",
  Page: "الصفحة",
  of: "من",
  "Results pagination": "تصفّح صفحات النتائج",
  Organizations: "المؤسسات",
  "Service category": "فئة الخدمة",
  Languages: "اللغات",
  Availability: "التوفّر",
  "Contact preference": "تفضيل التواصل",
  Credentials: "المؤهّلات والوثائق",
  Verification: "التحقّق",
  "Self-declared (unverified)": "مصرّح به ذاتيًا (غير متحقّق منه)",
  "Expired (kept as history)": "منتهي الصلاحية (محفوظ في السجل)",
  "Contact is mediated by the platform per the stated preference.": "تتوسّط المنصّة في التواصل وفق التفضيل المحدّد.",
  "Credentials are self-declared until platform-reviewed or issuer-attested; expired credentials remain as history without an active state.": "تظلّ المؤهّلات مصرّحًا بها ذاتيًا إلى أن تراجعها المنصّة أو تؤكّدها جهة الإصدار. تُحفظ الوثائق المنتهية في السجل دون اعتبارها سارية.",
  "My requests": "طلباتي",
  "Provider inbox": "صندوق وارد مقدّم الخدمة",
  "A service request is not a confirmed appointment.": "طلب الخدمة ليس موعدًا مؤكّدًا.",
  "This is a lead, not a confirmed appointment. The provider sees your contact route only if you consented.": "هذا طلب تواصل أولي، وليس موعدًا مؤكّدًا. لا يرى مقدّم الخدمة بيانات التواصل إلا بموافقتك.",
  "Contact shared with this provider by explicit consent.": "تمت مشاركة بيانات التواصل مع هذا المقدّم بموافقة صريحة.",
  "Contact is not shared with this reader.": "بيانات التواصل غير مشتركة مع هذا القارئ.",
  "The note stays between you and the provider.": "تبقى الملاحظة خاصة بينك وبين مقدّم الخدمة.",
  Sent: "تم الإرسال",
  "Last change": "آخر تعديل",
  "Private note": "ملاحظة خاصة",
  "Private request note": "ملاحظة الطلب الخاصة",
  "Contact shared with consent:": "بيانات التواصل المشتركة بموافقة:",
  "Send and manage private requests with published professionals. Payment and message delivery are not confirmed.": "أرسل طلبات خاصة إلى المختصّين المنشورة ملفاتهم وأدرها. لا يُؤكّد الدفع أو تسليم الرسائل.",
  "Farm workspaces": "مساحات إدارة المزرعة",
  Herd: "القطيع",
  Reminders: "التذكيرات",
  Overdue: "متأخر عن الموعد",
  "Due soon": "قريب الاستحقاق",
  Later: "لاحقًا",
  Staff: "فريق العمل",
  Manager: "المدير",
  Team: "الفريق",
  Documents: "الوثائق",
  "My workspaces": "مساحات عملي",
  "Create a workspace": "إنشاء مساحة عمل",
  "Workspace name": "اسم مساحة العمل",
  "Select a workspace to see its herd, reminders, team and documents.": "اختر مساحة عمل لعرض قطيعها وتذكيراتها وفريقها ووثائقها.",
  "No workspaces yet. Creation is subject to the current plan limits.": "لا توجد مساحات عمل بعد. يخضع الإنشاء لحدود خطتك الحالية.",
  "A workspace is a working set of horses and reminders — never an ownership claim. Access is re-checked live on every request.": "مساحة العمل مجموعة من الخيل والتذكيرات، وليست ادعاءً بالملكية. تُراجع صلاحية الوصول عند كل طلب.",
  "A workspace is a working set, not an ownership claim. Adding a horse here changes no registry ownership assertion.": "مساحة العمل مجموعة عمل وليست ادعاءً بالملكية. لا تؤدّي إضافة حصان إليها إلى تغيير أي بيان ملكية في السجل.",
  "Removing a horse from a workspace never deletes the horse record.": "إزالة حصان من مساحة العمل لا تحذف سجله مطلقًا.",
  "Add reminder": "إضافة تذكير",
  "Due date (Gregorian)": "تاريخ الاستحقاق (ميلادي)",
  Category: "الفئة",
  "Timezone (IANA)": "المنطقة الزمنية (IANA)",
  "Mark complete": "تحديد كمكتمل",
  "Completed reminders": "التذكيرات المكتملة",
  Assignment: "الإسناد",
  "Horses in this working set": "الخيل في مجموعة العمل هذه",
  "Remove from working set": "الإزالة من مجموعة العمل",
  "No horses have been added to this working set.": "لم تُضف خيل إلى مجموعة العمل هذه.",
  "Team and invitations": "الفريق والدعوات",
  "Invite a staff member": "دعوة عضو إلى الفريق",
  "Revoke access": "إلغاء الوصول",
  "No active staff.": "لا يوجد أعضاء نشطون.",
  "My pending workspace invitations": "دعوات مساحة العمل المعلّقة",
  "Document trackers": "متابعة الوثائق",
  "Track a document": "متابعة وثيقة",
  "Create tracker": "إنشاء متابعة",
  "No document trackers in this workspace.": "لا توجد متابعات للوثائق في مساحة العمل هذه.",
  "Include archived": "تضمين المؤرشف",
  "Hide archived": "إخفاء المؤرشف",
  "archived — read-only history": "مؤرشف — سجل للقراءة فقط",
  "Save (versioned)": "حفظ (مع تتبّع الإصدار)",
  fixed: "ثابت",
  "Plans and offers": "الخطط والعروض",
  "Price catalog": "قائمة الأسعار",
  "My orders": "طلباتي",
  Order: "طلب شراء",
  "Free forever": "مجاني دائمًا",
  "My plan benefits": "مزايا خطتي",
  "Amounts are stored in integer rial (IRR).": "تُحفظ المبالغ بالريال الإيراني (IRR) كأعداد صحيحة.",
  "Toman is a display conversion only (1 toman = 10 rial); nothing is charged in toman.": "التومان تحويل للعرض فقط (تومان واحد = 10 ريالات)؛ لا تُحصّل أي مبالغ بالتومان.",
  "Offer prices are pilot hypotheses, not verified market rates.": "أسعار العروض افتراضات تجريبية وليست أسعار سوق متحقّقًا منها.",
  "Nothing here yet.": "لا يوجد شيء هنا بعد.",
  "You do not have access to this.": "ليس لديك صلاحية الوصول إلى هذا المحتوى.",
  "This is not available.": "هذا المحتوى غير متاح.",
  "This could not be loaded. An error is not evidence that nothing exists.": "تعذّر التحميل. لا يعني الخطأ عدم وجود بيانات.",
  "Showing the previously loaded data while it is being refreshed — it may be stale.": "تُعرض البيانات المحمّلة سابقًا أثناء تحديثها، وقد تكون قديمة.",
  Marketplace: "السوق",
  Market: "السوق",
  "My listings": "إعلاناتي",
  Listings: "الإعلانات",
  Listing: "إعلان",
  "Create listing": "إنشاء إعلان",
  "New listing": "إعلان جديد",
  Price: "السعر",
  "Asking price": "السعر المطلوب",
  Negotiable: "قابل للتفاوض",
  "Contact seller": "التواصل مع البائع",
  Inquiries: "الاستفسارات",
  "Sent inquiries": "الاستفسارات المرسلة",
  "Received inquiries": "الاستفسارات الواردة",
  Seller: "البائع",
  Buyer: "المشتري",
  "Add to watchlist": "الإضافة إلى قائمة المتابعة",
  "Remove from watchlist": "الإزالة من قائمة المتابعة",
  "Newest first": "الأحدث أولًا",
  "Price: low to high": "السعر: من الأقل إلى الأعلى",
  "Price: high to low": "السعر: من الأعلى إلى الأقل",
  "Minimum price": "أقل سعر",
  "Maximum price": "أعلى سعر",
  "Any breed": "جميع السلالات",
  "Any sex": "جميع الأجناس",
  "Any city": "جميع المدن",
  "All breeds": "جميع السلالات",
  "All sexes": "جميع الأجناس",
  "All cities": "جميع المدن",
  Arabian: "عربي أصيل",
  Thoroughbred: "ثوروبريد",
  "Akhal-Teke": "آخال تيكي",
  Turkoman: "تركماني",
  Kurdish: "كردي",
  Caspian: "قزويني",
  Crossbred: "مهجّن",
  Mare: "فرس",
  Stallion: "فحل",
  Gelding: "حصان مخصي",
  Colt: "مهر",
  Filly: "مهرة",
  Male: "ذكر",
  Female: "أنثى",
  Bay: "كميت",
  Chestnut: "أشقر",
  Black: "أدهم",
  Grey: "أشهب",
  Gray: "أشهب",
  White: "أبيض",
  Palomino: "بالومينو",
  Dun: "دن",
  Roan: "روان",
  Pinto: "أبلق",
  "Birth year": "سنة الميلاد",
  "Birth date": "تاريخ الميلاد",
  "Horse ID": "معرّف الحصان",
  "Registration number": "رقم التسجيل",
  "Microchip number": "رقم الشريحة الإلكترونية",
  "Passport number": "رقم جواز الخيل",
  "File number": "رقم الملف",
  "Lab number": "رقم المختبر",
  "Created at": "تاريخ الإنشاء",
  "Updated at": "آخر تحديث",
  "Recorded name": "الاسم المسجّل",
  "Original name": "الاسم الأصلي",
  "Pedigree completeness": "اكتمال شجرة النسب",
  "Inbreeding coefficient": "معامل زواج الأقارب",
  "Mean kinship": "متوسط القرابة",
  "Genetic tests": "الفحوص الجينية",
  Evidence: "الأدلة",
  "Insufficient evidence": "أدلة غير كافية",
  Source: "المصدر",
  Sources: "المصادر",
  Review: "مراجعة",
  Confidence: "الثقة",
  Method: "المنهج",
  Methodology: "المنهجية",
  Scope: "النطاق",
  "All sections": "جميع الأقسام",
  "Population structure": "بنية مجموعة الخيل",
  "People & organizations": "الأشخاص والمؤسسات",
  Breeding: "التربية",
  "Pedigree coverage": "تغطية شجرة النسب",
  Analytics: "التحليلات",
  "Analytics could not be loaded. Please try again.": "تعذّر تحميل التحليلات. يُرجى المحاولة مجددًا.",
  Comparison: "المقارنة",
  Compare: "مقارنة",
  "Profile overview": "نظرة عامة على الملف",
  Lineage: "النسب",
  Health: "الصحة",
  Ownership: "الملكية",
  Transfers: "نقل الملكية",
  Media: "الوسائط",
  Photos: "الصور",
  Videos: "الفيديو",
  Attachments: "المرفقات",
  Timeline: "التسلسل الزمني",
  Activity: "النشاط",
  "Print pedigree": "طباعة شجرة النسب",
  "Back to registry": "العودة إلى السجل",
  "Return to Heritage Registry": "العودة إلى سجل Heritage",
  "Frontend module unavailable.": "الواجهة غير متاحة.",
  "The selected module could not be loaded.": "تعذّر تحميل الواجهة المحدّدة.",
  "Loading frontend…": "جارٍ تحميل الواجهة…",
  "Session expired": "انتهت الجلسة",
  "Access denied": "الوصول مرفوض",
  "Something went wrong.": "حدث خطأ.",
  "Please try again.": "يُرجى المحاولة مجددًا.",
  "No results found.": "لم يُعثر على نتائج.",
  "No matches": "لا توجد نتائج مطابقة",
  "No records": "لا توجد سجلات",
  New: "جديد",
  Updated: "محدّث",
  "Read more": "قراءة المزيد",
  Latest: "الأحدث",
  "All news": "جميع الأخبار",
  "My profile": "ملفي الشخصي",
  "My account": "حسابي",
  "Account settings": "إعدادات الحساب",
  "Personal information": "المعلومات الشخصية",
  Organization: "المؤسسة",
  Phone: "الهاتف",
  Website: "الموقع الإلكتروني",
  Address: "العنوان",
  Biography: "السيرة",
  Specialties: "التخصّصات",
  Services: "الخدمات",
  "Request a service": "طلب خدمة",
  Veterinarian: "طبيب بيطري",
  Trainer: "مدرّب",
  Farrier: "بيطار",
  Transport: "النقل",
  Boarding: "إيواء الخيل",
  Training: "التدريب",
  Veterinary: "الطب البيطري",
  "Equestrian club": "نادي فروسية",
  Stable: "إسطبل",
  Farm: "مزرعة تربية",
  Help: "مساعدة",
  About: "حول",
  Language: "اللغة",
  Version: "الإصدار",
  Use: "استخدام",
  "Show all": "عرض الكل",
  Hide: "إخفاء",
  Show: "عرض",
  Enable: "تفعيل",
  Disable: "تعطيل",
  Expand: "توسيع",
  Collapse: "طيّ",
  "View profile": "عرض الملف",
  "Open profile": "فتح الملف",
  Recorded: "مسجّل",
  Eligible: "مؤهّل",
  Excluded: "مستبعد",
  Warnings: "تحذيرات",
  Warning: "تحذير",
  Integrity: "السلامة",
  Complete: "مكتمل",
  Incomplete: "غير مكتمل",
  "Not reviewed": "لم يُراجع",
  Reviewed: "تمت مراجعته",
  "Not verified": "غير متحقّق منه",
  "Published professionals": "المختصّون المنشورة ملفاتهم",
  "No professionals match these filters.": "لا يوجد مختصّون يطابقون عوامل التصفية هذه.",
  Select: "اختيار",
  Selected: "محدّد",
  "Select a horse": "اختيار حصان",
  "Search horses": "البحث عن خيل",
  "Submit request": "إرسال الطلب",
  "Your message": "رسالتك",
  "Private message": "رسالة خاصة",
  "Read-only": "للقراءة فقط",
  "No changes": "لا توجد تغييرات",
  "Unsaved changes": "تغييرات غير محفوظة",
  "Copy link": "نسخ الرابط",
  Share: "مشاركة",
  "Open in new tab": "فتح في علامة تبويب جديدة",
  Manage: "إدارة",
  Today: "اليوم",
  Tomorrow: "غدًا",
  Yesterday: "أمس",
  Never: "أبدًا",
  Always: "دائمًا",
  Monthly: "شهري",
  Yearly: "سنوي",
  "Export CSV": "تصدير CSV",
  "Import CSV": "استيراد CSV",
  "Search sections": "البحث في الأقسام",
  Layout: "التخطيط",
  Content: "المحتوى",
  Glass: "الزجاج",
  Opacity: "التعتيم",
  Blur: "التمويه",
  Saturation: "التشبّع",
  Brightness: "السطوع",
  Speed: "السرعة",
  Intensity: "الشدّة",
  Position: "الموضع",
  Size: "الحجم",
  Corners: "الزوايا",
  Border: "الحدود",
  Shadows: "الظلال",
  "Depth & shadows": "العمق والظلال",
  Surface: "السطح",
  Surfaces: "الأسطح",
  Global: "عام",
  Containers: "الحاويات",
  "Behind content": "خلف المحتوى",
  "In front of content": "أمام المحتوى",
  "Reduced motion": "تقليل الحركة",
  Static: "ثابت",
  Still: "ساكن",
  Performance: "الأداء",
  Accessibility: "إمكانية الوصول",
  Presets: "الإعدادات المسبقة",
  Custom: "مخصّص",
  Preview: "معاينة",
  Advanced: "متقدّم",
  Basics: "الإعدادات الأساسية",
  Brand: "الهوية البصرية",
  Logos: "الشعارات",
  Logo: "الشعار",
  Wallpaper: "خلفية الشاشة",
  Splash: "شاشة البداية",
  Navigation: "التنقّل",
  "Tabs & navigation": "علامات التبويب والتنقّل",
  "Live preview": "معاينة مباشرة",
  "Close settings": "إغلاق الإعدادات",
  "Close appearance studio": "إغلاق استوديو المظهر",
  "Open appearance studio": "فتح استوديو المظهر",
  "View all in registry": "عرض الكل في السجل",
  "horse records": "سجلات خيل",
  "search indexed": "مفهرسة للبحث",
  "pedigree graph": "مخطط الأنساب",
  Live: "مباشر",
  "Search results": "نتائج البحث",
  "Registry workspace": "مساحة السجل",
  "best matches": "أفضل النتائج المطابقة",
  "Built around the bloodline": "مرتكز على الأنساب",
  "ranked by relevance": "مرتّبة حسب الصلة",
  "Search · browse · trace · administer": "بحث · تصفّح · تتبّع · إدارة",
  "Searching registry…": "جارٍ البحث في السجل…",
  "No matching horse found.": "لا يوجد حصان مطابق.",
  "Try fewer clues, a spelling variation, HorseNo, or open the registry table.": "جرّب معايير أقل أو تهجئة مختلفة أو رقم الحصان، أو افتح جدول السجل.",
  "Browse database": "تصفّح قاعدة البيانات",
  "Unified intelligence search": "بحث ذكي موحّد",
  "Mix names, IDs, years, places, owners and breeders. Fuzzy ranking handles imperfect input.": "اجمع الأسماء والمعرّفات والسنوات والأماكن والمالكين والمربّين. يتعامل البحث التقريبي مع أخطاء الإدخال.",
  "Search registry": "البحث في السجل",
  "Professional registry table": "جدول السجل المهني",
  "Dense, sortable records for operators who want direct access to the underlying registry.": "سجلات مدمجة قابلة للترتيب للوصول المباشر إلى بيانات السجل.",
  "Browse records": "تصفّح السجلات",
  "Navigate sire and dam lines, repeated ancestors, descendants and common bloodlines.": "تصفّح خطوط النسب الأبوية والأمومية والأسلاف المتكرّرين والذرية والأنساب المشتركة.",
  "Open any horse to trace": "افتح ملف أي حصان لتتبّع نسبه",
  "Heritage data.\nModern navigation.": "بيانات أصيلة.\nتنقّل حديث.",
  "Master registry": "السجل الرئيسي",
  "Database explorer": "مستكشف قاعدة البيانات",
  "Fast, dense access to every horse record. Filter across horse name, native name, HorseNo, registration, breed and birthplace.": "وصول سريع إلى سجلات الخيل. صفِّ حسب الاسم والاسم الأصلي ورقم الحصان والتسجيل والسلالة ومكان الميلاد.",
  "Visible dataset": "البيانات المعروضة",
  "matching records": "سجلات مطابقة",
  "Filter rows — try CHABOCK, arabian, Esfahan, #1000…": "صفِّ الصفوف: جرّب CHABOCK أو arabian أو Esfahan أو ‎#1000…",
  searching: "جارٍ البحث",
  Roomy: "متباعد",
  "Phone view": "عرض الهاتف",
  Detailed: "مفصّل",
  Narrow: "ضيّق",
  "Filtering for": "تصفية حسب",
  "Showing registry master records": "عرض السجلات الرئيسية",
  "Smart results": "نتائج ذكية",
  "Relevance order": "ترتيب الصلة",
  "Smart search for": "بحث ذكي عن",
  "Same unified fuzzy search engine": "محرّك البحث التقريبي الموحّد نفسه",
  "Double-click a row to open the horse profile": "انقر نقرًا مزدوجًا على صف لفتح ملف الحصان",
  "No rows match this filter.": "لا توجد صفوف تطابق هذا المرشّح.",
  "Clear the filter or use unified search for fuzzy matching.": "امسح المرشّح أو استخدم البحث الموحّد للعثور على نتائج تقريبية.",
  Columns: "الأعمدة",
  "Reset columns": "إعادة ضبط الأعمدة",
  "Visual encoding": "الترميز البصري",
  "Registry facets": "تصنيفات التصفية في السجل",
  "Canonical filters with live counts": "عوامل تصفية للبيانات المرجعية مع أعداد محدّثة",
  Lifecycle: "دورة الحياة",
  Decade: "العقد",
  "Clear facets": "مسح تصنيفات التصفية",
  "Advanced search": "بحث متقدّم",
  "Field-based search": "بحث حسب الحقول",
  "Target specific registry fields without giving up the normal search box.": "استهدف حقولًا محدّدة في السجل مع الاحتفاظ بمربع البحث المعتاد.",
  "Clear fields": "مسح الحقول",
  "Horse name": "اسم الحصان",
  "Latin or native name": "الاسم اللاتيني أو الأصلي",
  HorseNo: "رقم الحصان",
  Registration: "التسجيل",
  "Owner name": "اسم المالك",
  "Breeder name": "اسم المربّي",
  Importer: "المستورد",
  "Importer name": "اسم المستورد",
  "Passport receiver": "مستلم جواز الخيل",
  "Passport receiver name": "اسم مستلم جواز الخيل",
  "Sire name": "اسم الأب",
  "Dam name": "اسم الأم",
  "Birth place": "مكان الميلاد",
  "Place name": "اسم المكان",
  "Born from": "الميلاد من",
  "Born to": "الميلاد حتى",
  "Native name": "الاسم الأصلي",
  "Matched by": "المطابقة حسب",
  "Registry services": "خدمات السجل",
  "Registry Desk": "مكتب السجل",
  "People, record quality and ownership workflows from the same canonical platform contract.": "الأشخاص وجودة السجلات وإجراءات الملكية ضمن المرجع الموحّد للمنصّة.",
  Authenticated: "تم تسجيل الدخول",
  Dormant: "غير نشط",
  "People capability": "ميزة الأشخاص",
  "People directory": "دليل الأشخاص",
  "Search owners, breeders, importers, passport receivers and organizations linked to canonical horse records.": "ابحث عن المالكين والمربّين والمستوردين ومستلمي جوازات الخيل والمؤسسات المرتبطة بالسجلات المرجعية للخيل.",
  "Find a person or organization…": "البحث عن شخص أو مؤسسة…",
  owned: "مملوك",
  bred: "من التربية",
  horses: "خيل",
  "Quality capability": "ميزة الجودة",
  "Data-quality watch": "متابعة جودة البيانات",
  "Current open quality issues and the most common issue classes in the registry.": "مشكلات الجودة المفتوحة حاليًا وأكثر فئاتها شيوعًا في السجل.",
  "open issues": "مشكلات مفتوحة",
  "Claims capability": "ميزة الطلبات",
  "My ownership claims": "طلبات إثبات ملكيتي",
  "Authenticated claim records stay attached to the canonical horse identity.": "تبقى الطلبات المقدّمة بعد تسجيل الدخول مرتبطة بالهوية المرجعية للحصان.",
  "This capability is preserved but not available from the connected platform.": "هذه الميزة محفوظة لكنها غير متاحة عبر المنصّة المتصلة.",
  "Sign in through the shared host to read or create ownership claims.": "سجّل الدخول لقراءة طلبات إثبات الملكية أو إنشائها.",
  "Open sign in": "فتح تسجيل الدخول",
  "Your current session does not expose this permission.": "لا تتضمّن جلستك الحالية هذه الصلاحية.",
  "No ownership claims are recorded for this account.": "لا توجد طلبات إثبات ملكية مسجّلة لهذا الحساب.",
  "Prospective pairing study": "دراسة تزاوج محتمل",
  "Analyze a sire × dam pairing from the recorded pedigree without pretending pedigree data is genomic prediction.": "حلّل تزاوج أب × أم اعتمادًا على الأنساب المسجّلة، دون اعتبار بيانات النسب تنبؤًا جينوميًا.",
  "current record": "السجل الحالي",
  "Search the other parent…": "البحث عن الوالد الآخر…",
  "Analyze pairing": "تحليل التزاوج",
  "Analyzing…": "جارٍ التحليل…",
  "Prospective offspring": "الذرية المحتملة",
  "pedigree COI": "معامل زواج الأقارب المستند إلى النسب",
  "Parental relationship": "العلاقة بين الوالدين",
  "Parental kinship": "قرابة الوالدين",
  "Sire coverage": "تغطية نسب الأب",
  "Dam coverage": "تغطية نسب الأم",
  "Common ancestors": "الأسلاف المشتركون",
  "Coefficient withheld because a pedigree safety condition was reached.": "حُجب المعامل لبلوغ شرط من شروط سلامة تحليل النسب.",
  "Finite-depth pedigree estimate only; not genomic similarity, performance prediction or breeding-value advice.": "تقدير من شجرة نسب محدودة العمق فقط؛ لا يعبّر عن تشابه جينومي أو تنبؤ بالأداء أو نصيحة بشأن القيمة الوراثية.",
  "Pairing analysis is preserved in this frontend but the connected backend does not currently provide it.": "تحليل التزاوج محفوظ في هذه الواجهة، لكن الخادم المتصل لا يوفّره حاليًا.",
  "Ownership workflow": "إجراءات الملكية",
  "Ownership claim": "طلب إثبات ملكية",
  "Create or inspect your claim for this canonical horse record.": "أنشئ طلبك لهذا السجل المرجعي أو اطّلع عليه.",
  "Current claim": "الطلب الحالي",
  "Sign in to create a claim": "سجّل الدخول لإنشاء طلب",
  "Claim ownership": "طلب إثبات الملكية",
  "Creating claim…": "جارٍ إنشاء الطلب…",
  "Ownership claim created.": "تم إنشاء طلب إثبات الملكية.",
  "Sire / paternal": "الأب / النسب الأبوي",
  "Dam / maternal": "الأم / النسب الأمومي",
  "No sire recorded": "الأب غير مسجّل",
  "No dam recorded": "الأم غير مسجّلة",
  "Registry identity": "الهوية في السجل",
  "Horse No.": "رقم الحصان",
  "Find related": "العثور على خيل ذات قرابة",
  "Active record": "سجل نشط",
  Index: "الفهرس",
  "Pedigree ready": "شجرة النسب متاحة",
  "Interactive pedigree": "شجرة نسب تفاعلية",
  "Breeding network": "شبكة التربية",
  "Bloodline map": "خريطة الأنساب",
  "Descendant map": "خريطة الذرية",
  "Paternal and maternal branches are color-coded. Repeated ancestors and data cycles are flagged visually.": "تُميَّز الفروع الأبوية والأمومية بالألوان. وتُعرض إشارات بصرية للأسلاف المتكرّرين ودورات البيانات.",
  "Explore recorded offspring and downstream lineage without loading the whole graph at once.": "استكشف الذرية المسجّلة وأنسابها دون تحميل المخطط كاملًا.",
  "Paternal line": "خط النسب الأبوي",
  "Maternal line": "خط النسب الأمومي",
  "Repeated ancestor": "سلف متكرّر",
  "Cycle warning": "تحذير من دورة في النسب",
  nodes: "عُقد",
  repeats: "تكرارات",
  cycles: "دورات",
  "Hover to trace a branch · click to focus": "مرّر المؤشر لتتبّع فرع · انقر للتركيز عليه",
  "Fit view": "ملاءمة العرض",
  "Fit all": "ملاءمة الكل",
  "Fit width": "ملاءمة العرض الأفقي",
  "Fit height": "ملاءمة الارتفاع",
  "Actual size": "الحجم الفعلي",
  "Mobile pedigree view": "عرض النسب على الهاتف",
  "Pedigree view": "عرض شجرة النسب",
  Readable: "مقروء",
  Vertical: "عمودي",
  Map: "خريطة",
  Radial: "شعاعي",
  "Generations unfold as semantic rings; paternal and maternal branches remain visually distinct.": "تظهر الأجيال في حلقات، مع الحفاظ على التمييز البصري بين الفروع الأبوية والأمومية.",
  "Each wedge is a recorded ancestor. Hover for identity; click to open the canonical record.": "يمثّل كل قطاع سلفًا مسجّلًا. مرّر المؤشر لرؤية هويته، وانقر لفتح سجله.",
  "This descendant view reached its safety cap. Narrow the depth to keep navigation responsive.": "بلغ عرض الذرية حدّ الأمان. قلّل العمق للحفاظ على سرعة التنقّل.",
  "Recorded ancestry coverage": "تغطية الأسلاف المسجّلين",
  "A structural reading of how much ancestry is known at the selected depth — designed to make pedigree quality understandable at a glance.": "عرض بنيوي للأسلاف المعروفين عند العمق المحدّد، لفهم جودة شجرة النسب بنظرة واحدة.",
  coverage: "التغطية",
  "Known pedigree positions": "مواضع النسب المعروفة",
  "Unique ancestors": "أسلاف متميّزون",
  "Repeated positions": "مواضع متكرّرة",
  "Deepest known": "أقصى عمق معروف",
  "Coverage by generation": "التغطية حسب الجيل",
  "Integrity clear": "لا توجد مشكلة سلامة مرصودة",
  "Partial record": "سجل جزئي",
  "Cycle detected": "اكتُشفت دورة",
  "Structural pedigree coverage only — not an inbreeding or genetic coefficient.": "تغطية بنيوية لشجرة النسب فقط؛ ليست معامل زواج أقارب أو معاملًا وراثيًا.",
  "Method v": "إصدار المنهج",
  "Reading pedigree structure…": "جارٍ قراءة بنية النسب…",
  "Counting known, repeated and unresolved ancestral positions.": "عدّ مواضع الأسلاف المعروفة والمتكرّرة وغير المحسومة.",
  "Paternal vs maternal coverage": "تغطية النسب الأبوي والأمومي",
  "Sire branch": "فرع الأب",
  "Dam branch": "فرع الأم",
  "Most repeated ancestors": "الأسلاف الأكثر تكرارًا",
  "No repeated ancestor identities at this depth.": "لا توجد هويات أسلاف متكرّرة عند هذا العمق.",
  positions: "مواضع",
  "nearest G": "أقرب جيل",
  "both sire & dam branches": "فرعا الأب والأم",
  "Descendant reach": "امتداد الذرية",
  "A bounded count of registered descendants reached through the selected generations.": "عدّ محدود للذرية المسجّلة التي يمكن الوصول إليها خلال الأجيال المختارة.",
  "Direct children": "الذرية المباشرة",
  "Known descendants": "الذرية المعروفة",
  "Generational reach": "الامتداد عبر الأجيال",
  "Descendants by generation": "الذرية حسب الجيل",
  "Registry reach only — not a breeding-value or genetic-influence score.": "امتداد في السجل فقط؛ ليس قيمة وراثية أو درجة تأثير جيني.",
  "Safety limit reached; the true descendant total may be higher.": "بُلِغ حدّ الأمان؛ قد يكون العدد الحقيقي للذرية أكبر.",
  "Pedigree inbreeding coefficient": "معامل زواج الأقارب المستند إلى النسب",
  "8-generation estimate": "تقدير عبر 8 أجيال",
  "pedigree estimate": "تقدير مستند إلى النسب",
  "Analyzed coverage": "التغطية المحلّلة",
  "Assumed founders": "الأصول المؤسِّسة المفترضة",
  "Finite-pedigree Wright/tabular estimate. This is not genomic DNA similarity.": "تقدير بطريقة رايت/الجدول على شجرة نسب محدودة. ليس قياسًا لتشابه الحمض النووي الجينومي.",
  "Coefficient withheld because this pedigree is cyclic or exceeded the safe analysis boundary.": "حُجب المعامل: تتضمّن شجرة النسب دورة أو تتجاوز حدّ التحليل الآمن.",
  "Zero means no inbreeding detected within the available pedigree — not evidence of being unrelated or safe.": "تعني القيمة صفر عدم رصد زواج أقارب ضمن النسب المتاح، وليست دليلًا على انعدام القرابة أو الأمان.",
  "Trace paths": "تتبّع المسارات",
  "Ancestor path atlas": "أطلس مسارات الأسلاف",
  "Tracing every recorded entry route…": "جارٍ تتبّع المسارات المسجّلة…",
  "recorded routes": "مسارات مسجّلة",
  "Additional paths exist beyond the safe display limit.": "توجد مسارات إضافية تتجاوز حدّ العرض الآمن.",
  "Direct lineage trails": "خطوط النسب المباشرة",
  "Tail-male line": "خط الذكور المباشر",
  "Tail-female line": "خط الإناث المباشر",
  "complete to analyzed depth": "مكتمل حتى العمق المحلّل",
  "stopped by data cycle": "توقّف بسبب دورة في البيانات",
  "reaches recorded boundary": "يبلغ حدود البيانات المسجّلة",
  "Branch imbalance": "اختلال توازن الفروع",
  "Tail-male depth": "عمق خط الذكور",
  "Tail-female depth": "عمق خط الإناث",
  "Pedigree COI": "معامل زواج الأقارب المستند إلى النسب",
  "Integrity warning": "تحذير بشأن السلامة",
  "Registry intelligence": "تحليلات السجل",
  "The registry at a glance": "السجل بنظرة واحدة",
  "Versioned whole-registry context, precomputed from the canonical data so global facts are instant and reproducible.": "سياق شامل للسجل بإصدارات موثّقة، محسوب مسبقًا من البيانات المرجعية لنتائج فورية قابلة لإعادة الإنتاج.",
  "Analytics snapshot": "لقطة تحليلية",
  "Four-generation pedigree": "نسب عبر أربعة أجيال",
  "average recorded coverage": "متوسط التغطية المسجّلة",
  "Prolific parent threshold": "عتبة الوالدين ذوي الذرية الكثيرة",
  "top 1% by recorded children": "أعلى 1٪ بحسب الذرية المسجّلة",
  "Most recorded offspring": "أكبر عدد من الذرية المسجّلة",
  "direct children": "ذرية مباشرة",
  "Most represented ancestor": "السلف الأكثر تمثيلًا",
  "depth-4 pedigree positions": "مواضع النسب عند عمق 4",
  "Registration history": "تاريخ التسجيل",
  "horses by birth decade": "الخيل حسب عقد الميلاد",
  "Registry-wide figures are derived analytics, not canonical horse attributes; every snapshot carries its source revision and method version.": "أرقام السجل الشاملة تحليلات مشتقّة وليست صفات مرجعية للخيل؛ تبيّن كل لقطة مراجعة المصدر وإصدار المنهج.",
  "Statistics & analytics": "الإحصاءات والتحليلات",
  "A complete, versioned view of the registry: population structure, pedigree depth, breeding reach, people, record coverage and data quality — organized for researchers, registries and serious pedigree enthusiasts.": "عرض شامل وموثّق الإصدارات للسجل: بنية مجموعة الخيل وعمق الأنساب وامتداد التربية والأشخاص وتغطية السجلات وجودة البيانات، للباحثين والسجلات والمهتمّين بالأنساب.",
  "snapshot ready": "اللقطة متاحة",
  "canonical registry records": "سجلات مرجعية",
  "Statistics sections": "أقسام الإحصاءات",
  "Loading registry intelligence…": "جارٍ تحميل تحليلات السجل…",
  "Reading the precomputed whole-registry analytics snapshot.": "قراءة اللقطة التحليلية المحسوبة مسبقًا للسجل.",
  "Registry analytics are unavailable": "تحليلات السجل غير متاحة",
  "Not available on this backend": "غير متاح على هذا الخادم",
  "The registry in one frame": "السجل في إطار واحد",
  "The fastest read of scale, pedigree coverage, people and operational quality.": "لمحة سريعة عن الحجم وتغطية الأنساب والأشخاص والجودة التشغيلية.",
  "active canonical dataset": "مجموعة البيانات المرجعية النشطة",
  owners: "مالكون",
  breeders: "مربّون",
  "Both parents recorded": "كلا الوالدين مسجّلان",
  "Pedigree analytics eligible": "مؤهّلة لتحليل النسب",
  "of registry": "من السجل",
  "Open quality findings": "ملاحظات جودة مفتوحة",
  "findings per horse": "ملاحظات لكل حصان",
  "Recorded birth-decade arc": "توزيع الميلاد حسب العقد",
  "recorded birth years · source artifacts may exist": "سنوات مسجّلة · قد تتضمّن شوائب من المصدر",
  "median recorded year": "وسيط السنة المسجّلة",
  "Parentage coverage": "تغطية الوالدين",
  "direct sire/dam availability": "توفّر بيانات الأب والأم",
  "One parent recorded": "أحد الوالدين مسجّل",
  "No parents recorded": "لا يوجد والد مسجّل",
  "Pedigree depth & integrity": "عمق الأنساب وسلامتها",
  "How far the registry can trace ancestry, how complete those generations are, and where integrity boundaries affect analysis.": "مدى قدرة السجل على تتبّع الأسلاف، واكتمال تلك الأجيال، وأثر حدود السلامة في التحليل.",
  "Recorded coverage by depth": "التغطية المسجّلة حسب العمق",
  "cycle-clean pedigrees only": "الأنساب الخالية من الدورات فقط",
  average: "المتوسط",
  median: "الوسيط",
  "at least 50% recorded": "مسجّل بنسبة 50٪ على الأقل",
  "Analytics integrity": "سلامة التحليلات",
  "cycle-aware population": "مجموعة تراعي وجود الدورات",
  "cycle-clean pedigrees": "أنساب خالية من الدورات",
  "Cycle nodes": "عُقد الدورات",
  "horses directly participating in a cycle": "خيل تدخل مباشرة في دورة",
  "Cycle-affected pedigrees": "أنساب متأثّرة بدورة",
  "recorded ancestry eventually reaches a cycle": "يصل النسب المسجّل في النهاية إلى دورة",
  "Most represented ancestors": "الأسلاف الأكثر تمثيلًا",
  "depth-4 positions": "مواضع عند عمق 4",
  "Breeding reach & family scale": "امتداد التربية وحجم العائلات",
  "Recorded offspring distributions and the sires and dams with the broadest direct registry reach.": "توزيع الذرية المسجّلة والآباء والأمهات ذوي أكبر امتداد مباشر في السجل.",
  "Recorded offspring distribution": "توزيع الذرية المسجّلة",
  "top 1% threshold": "عتبة أعلى 1٪",
  "horses have recorded offspring": "خيل لها ذرية مسجّلة",
  maximum: "الحد الأقصى",
  children: "ذرية مباشرة",
  "Top sires by recorded offspring": "الآباء الأعلى حسب الذرية المسجّلة",
  "Top dams by recorded offspring": "الأمهات الأعلى حسب الذرية المسجّلة",
  "Registry status signals": "مؤشّرات الحالة في السجل",
  "descriptive record flags": "علامات وصفية للسجلات",
  "Active records": "سجلات نشطة",
  "Recorded deceased": "خيل مسجّلة كنافقة",
  Imported: "مستوردة",
  "Stallion flag": "علامة فحل",
  "Sport flag": "علامة رياضة",
  "Sport card": "بطاقة رياضية",
  "Population composition": "تركيب مجموعة الخيل",
  "The leading recorded sex classes, breeds, birth places, colors and strain labels after placeholder values are excluded.": "أبرز فئات الجنس والسلالات وأماكن الميلاد والألوان وخطوط النسب المسجّلة بعد استبعاد القيم النائبة.",
  "Recorded sex classes": "فئات الجنس المسجّلة",
  "Top recorded breeds": "السلالات الأكثر تسجيلًا",
  "Top meaningful birth places": "أبرز أماكن الميلاد ذات البيانات الفعلية",
  "Top recorded colors": "الألوان الأكثر تسجيلًا",
  "Top meaningful main strains": "أبرز خطوط النسب الرئيسية ذات البيانات الفعلية",
  "Registry parties & organizations": "الأشخاص والمؤسسات في السجل",
  "The people and organizations connected to registry horses through recorded owner, breeder, importer and passport-receiver relationships.": "الأشخاص والمؤسسات المرتبطة بالخيل عبر أدوار المالك والمربّي والمستورد ومستلم الجواز المسجّلة.",
  "people of record": "أشخاص مسجّلون",
  "linked horses": "خيل مرتبطة",
  importers: "مستوردون",
  "passport receivers": "مستلمو الجوازات",
  "Top owners by linked horses": "المالكون الأعلى حسب الخيل المرتبطة",
  "Top breeders by linked horses": "المربّون الأعلى حسب الخيل المرتبطة",
  "Top importers by linked horses": "المستوردون الأعلى حسب الخيل المرتبطة",
  "Top passport receivers by linked horses": "مستلمو الجوازات الأعلى حسب الخيل المرتبطة",
  "Record coverage & quality": "تغطية السجلات وجودتها",
  "Where the dataset is strong, where fields are genuinely missing, and which quality findings deserve registry attention.": "نقاط قوة البيانات والحقول الناقصة فعليًا وملاحظات الجودة التي تستدعي اهتمام السجل.",
  "Meaningful field coverage": "تغطية الحقول ذات البيانات الفعلية",
  "placeholder values count as missing": "تُحسب القيم النائبة كبيانات مفقودة",
  "Open automated findings": "ملاحظات آلية مفتوحة",
  "Coverage by birth decade": "التغطية حسب عقد الميلاد",
  "recent historical trend": "الاتجاه التاريخي الحديث",
  "Derived analytics provenance": "مصدر التحليلات المشتقّة",
  "Registration no.": "رقم التسجيل",
  Microchip: "الشريحة الإلكترونية",
  "Main strain": "خط النسب الرئيسي",
  "DNA/sample detail": "تفاصيل الحمض النووي/العينة",
  "Passport no.": "رقم الجواز",
  "Both parents": "كلا الوالدين",
  "Any parent": "والد واحد على الأقل",
  "Owner link": "رابط المالك",
  "Breeder link": "رابط المربّي",
  "Importer link": "رابط المستورد",
  "Passport receiver link": "رابط مستلم الجواز",
  "Recorded-data completeness measures": "مقاييس اكتمال البيانات المسجّلة",
  "separate denominators, no blended score": "مقامات منفصلة دون درجة مدمجة",
  "Identity field coverage": "تغطية حقول الهوية",
  "Linked evidence coverage": "تغطية الأدلة المرتبطة",
  "Media coverage": "تغطية الوسائط",
  "Recorded activity coverage": "تغطية النشاط المسجّل",
  "These are recorded-data coverage measures; they never assert verification, authenticity, or that the registry itself is complete.": "تصف هذه المقاييس تغطية البيانات المسجّلة؛ ولا تؤكّد التحقّق أو الأصالة أو اكتمال السجل نفسه.",
  "Snapshot:": "اللقطة:",
  Errors: "أخطاء",
  Info: "معلومات",
  "Parent/year conflicts": "تعارضات الوالد/السنة",
  "Pedigree cycles": "دورات في الأنساب",
  "Birth-year outliers": "سنوات ميلاد شاذة",
  "Self-parent links": "روابط يكون فيها الحصان والدًا لنفسه",
  "Focus horse": "الحصان محلّ الدراسة",
  Father: "الأب",
  Mother: "الأم",
  Offspring: "الذرية",
  repeat: "تكرار",
  cycle: "دورة",
  Focus: "محور العرض",
  Parents: "الوالدان",
  Grandparents: "الأجداد",
  Children: "الذرية المباشرة",
  Grandchildren: "الأحفاد",
  "Record summary": "ملخّص السجل",
  Born: "الميلاد",
  "Registry parties": "الأطراف المرتبطة بالسجل",
  "No linked people in this record.": "لا يوجد أشخاص مرتبطون بهذا السجل.",
  "Data trust": "موثوقية البيانات",
  "Registry controls": "ضوابط السجل",
  "Canonical identity and pedigree relationships are served from normalized records. Internal quality findings remain staff-only by default.": "تأتي الهوية المرجعية وروابط النسب من سجلات منظّمة. تظلّ ملاحظات الجودة الداخلية خاصة بالموظّفين افتراضيًا.",
  "Relationship lab": "مختبر القرابة",
  "Relationship atlas": "أطلس القرابة",
  "Compare two horses through exact pedigree paths, shared ancestors and finite-pedigree kinship — not just a single family-tree label.": "قارن حصانين عبر مسارات النسب الدقيقة والأسلاف المشتركة والقرابة في شجرة نسب محدودة، لا بمجرد تسمية عائلية واحدة.",
  From: "من",
  "Search another horse…": "البحث عن حصان آخر…",
  "Tracing both pedigrees…": "جارٍ تتبّع شجرتَي النسب…",
  "Closest common ancestor": "أقرب سلف مشترك",
  generations: "أجيال",
  "No common ancestor was found within 12 generations.": "لم يُعثر على سلف مشترك ضمن 12 جيلًا.",
  "Same horse": "الحصان نفسه",
  "Direct ancestor": "سلف مباشر",
  "Direct descendant": "من الذرية المباشرة",
  "Full siblings": "أشقاء من الأب والأم",
  "Half siblings": "إخوة من أحد الوالدين",
  "Shared bloodline": "نسب مشترك",
  "No known connection": "لا توجد صلة معروفة",
  "Relationship pattern": "نمط القرابة",
  "common ancestors": "أسلاف مشتركون",
  "Pedigree relationship": "العلاقة المستندة إلى النسب",
  "Pedigree kinship": "القرابة المستندة إلى النسب",
  "Finite recorded-pedigree estimate under unrelated-founder assumptions; not genomic similarity.": "تقدير من النسب المسجّل المحدود بافتراض عدم قرابة الأصول المؤسِّسة؛ ليس تشابهًا جينوميًا.",
  "Traced relationship routes": "مسارات القرابة المتتبّعة",
  routes: "مسارات",
  "More recorded routes exist beyond the display limit.": "توجد مسارات مسجّلة إضافية تتجاوز حدّ العرض.",
  "Focus line": "خط النسب محلّ الدراسة",
  "Restricted console": "وحدة تحكّم مقيّدة",
  Administration: "الإدارة",
  "Sign in to create, correct, archive and review registry records.": "سجّل الدخول لإنشاء سجلات السجل وتصحيحها وأرشفتها ومراجعتها.",
  "Registry control": "إدارة السجل",
  "Steward the record.\nProtect the bloodline.": "صُن السجلات.\nواحفظ الأنساب.",
  "Permissioned changes, pedigree validation and a permanent audit trail for the registry.": "تغييرات مصرّح بها، وتحقّق من الأنساب، وسجل تدقيق دائم.",
  "Local development": "تطوير محلي",
  "Email is prefilled as admin@local.test. Use the password created during local bootstrap.": "العنوان admin@local.test مُعبّأ مسبقًا. استخدم كلمة المرور المنشأة أثناء الإعداد المحلي.",
  "Sign in to registry": "تسجيل الدخول إلى السجل",
  "Admin console": "وحدة تحكّم الإدارة",
  "Registry operations": "عمليات السجل",
  "Open issues": "مشكلات مفتوحة",
  "Changes · 7d": "تغييرات · 7 أيام",
  "Reindex queue": "قائمة إعادة الفهرسة",
  "Add horse": "إضافة حصان",
  "Minimal fast-entry form. Rich registry fields can be added without changing the audit/auth model.": "نموذج إدخال سريع. يمكن إضافة حقول تفصيلية دون تغيير نموذج المصادقة والتدقيق.",
  "Latin name": "الاسم اللاتيني",
  "Create record": "إنشاء سجل",
  "Recent audit events": "أحداث التدقيق الأخيرة",
  "Data-quality queue": "قائمة فحص الجودة",
  "Automated pedigree and source-data warnings requiring review.": "تحذيرات آلية بشأن الأنساب وبيانات المصدر تتطلّب المراجعة.",
  "Refresh search queue": "تحديث قائمة البحث",
  "Edit registry record": "تعديل سجل",
  "Search first; edits use optimistic concurrency and every successful save is audited.": "ابحث أولًا؛ تستخدم التعديلات ضبط التزامن التفاؤلي، ويُوثّق كل حفظ ناجح في سجل التدقيق.",
  "Pedigree intelligence platform": "منصّة تحليل الأنساب",
  results: "نتائج",
  "Demonstration calendar — the federation's official results service is the next integration step.": "تقويم تجريبي — لم تُستكمل بعدُ عملية ربط خدمة النتائج الرسمية للاتحاد.",
  "Select a competition to view results.": "اختر مسابقة لعرض نتائجها.",
  "Results could not be loaded.": "تعذّر تحميل النتائج.",
  "Competitions could not be loaded.": "تعذّر تحميل المسابقات.",
  "Some results are outside this preview.": "بعض النتائج غير مشمولة في هذه المعاينة.",
  "Choose a section": "اختر قسمًا",
  Acknowledged: "تم تأكيد الاستلام",
  Discussing: "قيد المناقشة",
  "Publication consent": "الموافقة على النشر",
  "Published in the directory": "منشور في الدليل",
  "Not published in the directory": "غير منشور في الدليل",
  "Publication consent withdrawn": "سُحبت الموافقة على النشر",
  "Not published; publication consent is absent or withdrawn": "غير منشور؛ الموافقة على النشر غير متاحة أو سُحبت",
  Monday: "الاثنين",
  Tuesday: "الثلاثاء",
  Wednesday: "الأربعاء",
  Thursday: "الخميس",
  Friday: "الجمعة",
  Saturday: "السبت",
  Sunday: "الأحد",
  "Preferred contact channel": "وسيلة التواصل المفضّلة",
  "Private contact detail": "بيانات التواصل الخاصة",
  "Working languages": "لغات العمل",
  "Service areas": "مناطق تقديم الخدمة",
  "Accessibility information": "معلومات إمكانية الوصول",
  "Opening hours": "ساعات العمل",
  "Evidence for review": "أدلة للمراجعة",
  "Person registry ID": "معرّف الشخص في السجل",
  "Organization registry ID": "معرّف المؤسسة في السجل",
  "Status unavailable": "الحالة غير متاحة",
  "price on request": "السعر عند الطلب",
  "billion toman": "مليار تومان",
  "million toman": "مليون تومان",
  toman: "تومان",
  MARKETPLACE: "السوق",
  "Horses for sale": "خيول للبيع",
  "Review the available pedigree, competition history and document status before contacting the seller.": "راجع النسب المتاح وسجل المشاركات في المنافسات وحالة المستندات قبل التواصل مع البائع.",
  "active listings": "إعلانات نشطة",
  "for sale": "للبيع",
  "Search listings": "البحث في الإعلانات",
  "Search name or register no…": "ابحث بالاسم أو رقم التسجيل…",
  "Sort listings": "ترتيب الإعلانات",
  Newest: "الأحدث",
  "Price ↑": "السعر تصاعديًا",
  "Price ↓": "السعر تنازليًا",
  "Listings could not be loaded. This does not mean there are no listings.": "تعذّر تحميل الإعلانات. لا يعني ذلك عدم وجود إعلانات.",
  "Loading listings…": "جارٍ تحميل الإعلانات…",
  "No listings match these filters.": "لا توجد إعلانات مطابقة لهذه المرشّحات.",
  y: "سنة",
  "contact seller": "تواصل مع البائع",
  negotiable: "قابل للتفاوض",
  "competition starts": "مشاركات في المنافسات",
  "verified docs": "مستندات تم التحقق منها",
  "The listing could not be loaded.": "تعذّر تحميل الإعلان.",
  "Loading listing...": "جارٍ تحميل الإعلان…",
  "My listings and inquiries": "إعلاناتي واستفساراتي",
  "The marketplace is an introduction surface — no payment, delivery or ownership transfer happens here. Status changes are versioned: if a listing changed elsewhere, the current version is reloaded before your edit can land.": "السوق وسيلة للتواصل بين الأطراف؛ لا تُجرى هنا مدفوعات أو عمليات تسليم أو نقل ملكية. ترتبط تغييرات الحالة بإصدار الإعلان: إذا عُدّل في مكان آخر، يُعاد تحميل أحدث إصدار قبل حفظ تعديلك.",
  "Loading your listings…": "جارٍ تحميل إعلاناتك…",
  "Your listing list is unavailable.": "قائمة إعلاناتك غير متاحة.",
  "Try loading again": "أعِد محاولة التحميل",
  "You have no listings and no received inquiries yet.": "ليس لديك إعلانات أو استفسارات واردة بعد.",
  "Inquiries received on your listings": "الاستفسارات الواردة بشأن إعلاناتك",
  "My sent inquiries": "استفساراتي المرسلة",
  "Loading your sent inquiries…": "جارٍ تحميل استفساراتك المرسلة…",
  "Your sent-inquiry list is unavailable.": "قائمة استفساراتك المرسلة غير متاحة.",
  "You have not sent any inquiries yet — open a listing and ask the seller a question.": "لم ترسل أي استفسار بعد. افتح إعلانًا لطرح سؤال على البائع.",
  "The listing changed elsewhere — the current version was reloaded; retry with the fresh version.": "عُدّل الإعلان في مكان آخر. أُعيد تحميل الإصدار الحالي؛ أعد المحاولة باستخدامه.",
  "Reload my listings": "إعادة تحميل إعلاناتي",
  "My watchlist": "الإعلانات التي أتابعها",
  "Loading your watchlist…": "جارٍ تحميل الإعلانات التي تتابعها…",
  "No saved listings yet — watch a listing to keep it here.": "لا توجد إعلانات محفوظة بعد. تابع إعلانًا للاحتفاظ به هنا.",
  saved: "محفوظ",
  "Open listing": "فتح الإعلان",
  "Removed from your watchlist.": "أُزيل الإعلان من قائمة المتابعة.",
  Unwatch: "إلغاء المتابعة",
  expires: "تنتهي صلاحيته",
  "View listing": "عرض الإعلان",
  "Listing status updated (versioned).": "حُدّثت حالة الإعلان مع التحقق من الإصدار.",
  "Listing reactivated with a bounded 30-day extension.": "أُعيد تفعيل الإعلان مع تمديد لمدة ٣٠ يومًا.",
  "Renew 30 days": "تمديد لمدة ٣٠ يومًا",
  listing: "إعلان",
  replies: "ردود",
  "Hide conversation": "إخفاء المحادثة",
  Conversation: "المحادثة",
  "Inquiry status updated (versioned).": "حُدّثت حالة الاستفسار مع التحقق من الإصدار.",
  "Mark contacted": "وضع علامة «تم التواصل»",
  "Close inquiry": "إغلاق الاستفسار",
  "Your inquiry is closed. No further replies are accepted.": "أُغلق استفسارك. لم يعد إرسال ردود جديدة متاحًا.",
  "Close my inquiry": "إغلاق استفساري",
  "Loading the conversation…": "جارٍ تحميل المحادثة…",
  "Only the participants can read this conversation.": "يمكن للمشاركين فقط قراءة هذه المحادثة.",
  "This inquiry is no longer available.": "لم يعد هذا الاستفسار متاحًا.",
  "The conversation could not be loaded.": "تعذّر تحميل المحادثة.",
  "No messages yet.": "لا توجد رسائل بعد.",
  "Reply sent to the conversation.": "أُرسل الرد إلى المحادثة.",
  Reply: "رد",
  "Send reply": "إرسال الرد",
  "This inquiry is closed — the conversation is read-only history.": "هذا الاستفسار مغلق؛ سجل المحادثة متاح للقراءة فقط.",
  "The inquiry changed elsewhere — reload its current version and retry.": "عُدّل الاستفسار في مكان آخر. أعد تحميل إصداره الحالي ثم حاول مجددًا.",
  "FOR SALE — BUYER RESEARCH VIEW": "للبيع — معلومات للمشتري",
  "Price & seller": "السعر والبائع",
  "on request": "عند الطلب",
  Listed: "تاريخ النشر",
  "Open full profile →": "فتح الملف الكامل ←",
  "Competition highlights": "أبرز نتائج المنافسات",
  "No competition record.": "لا توجد مشاركات مسجلة في المنافسات.",
  "Verified documents": "مستندات تم التحقق منها",
  "No documents shared yet.": "لم تُشارك أي مستندات بعد.",
  "Contact the seller": "التواصل مع البائع",
  "★ Saved — remove from watchlist": "★ محفوظ — إزالة من المتابعة",
  "☆ Save to watchlist": "☆ إضافة إلى المتابعة",
  "The seller's authority to sell this horse is no longer current; new inquiries are closed.": "لم يعد تفويض البائع ببيع هذا الحصان ساريًا؛ أُغلق استقبال الاستفسارات الجديدة.",
  "Your inquiry was sent to the seller.": "أُرسل استفسارك إلى البائع.",
  "Your name": "اسمك",
  "Phone or email": "الهاتف أو البريد الإلكتروني",
  "Message (optional)": "الرسالة (اختيارية)",
  "Reloading listing…": "جارٍ إعادة تحميل الإعلان…",
  "Send inquiry": "إرسال الاستفسار",
  "loading the current version…": "جارٍ تحميل الإصدار الحالي…",
  "You can also register an account to track your inquiries.": "يمكنك أيضًا إنشاء حساب لمتابعة استفساراتك.",
  "Listing suspended by moderation — the horse's registry profile is unaffected.": "عُلّق الإعلان بواسطة فريق الإشراف؛ لم يتأثر ملف الحصان في السجل.",
  "This listing's expiry date is invalid; actions are disabled until the seller corrects it.": "تاريخ انتهاء صلاحية هذا الإعلان غير صالح؛ عُطّلت الإجراءات إلى أن يصححه البائع.",
  "This listing has expired and no longer accepts new inquiries.": "انتهت صلاحية هذا الإعلان ولم يعد يقبل استفسارات جديدة.",
  "This horse has been reported sold.": "أُبلغ عن بيع هذا الحصان.",
  "The seller has withdrawn this listing.": "سحب البائع هذا الإعلان.",
  "The seller's mandate is no longer current — new inquiries are closed.": "لم يعد تفويض البائع ساريًا؛ أُغلق استقبال الاستفسارات الجديدة.",
  "in the calendar": "في التقويم",
  "Events could not be loaded. This is not an empty calendar.": "تعذّر تحميل الفعاليات. لا يعني ذلك أن التقويم فارغ.",
  "Loading events…": "جارٍ تحميل الفعاليات…",
  "Event pages": "صفحات الفعاليات",
  "Narrow the filters to access more events.": "ضيّق نطاق المرشّحات للوصول إلى مزيد من الفعاليات.",
  "Event results": "نتائج الفعالية",
  "EVENT RESULTS": "نتائج الفعالية",
  "The results could not be loaded.": "تعذّر تحميل النتائج.",
  "Loading results…": "جارٍ تحميل النتائج…",
  "No results have been published for this event.": "لم تُنشر نتائج لهذه الفعالية.",
  "Results shown": "النتائج المعروضة",
  "This is a limited results window, not the complete event history.": "المعروض جزء محدود من النتائج، وليس السجل الكامل للفعالية.",
  "Event results table": "جدول نتائج الفعالية",
  Result: "النتيجة",
  Eliminated: "مستبعد",
  Withdrawn: "منسحب",
  DIRECTORY: "الدليل",
  "Published professionals and organizations that gave explicit consent. Contact is mediated by the platform; nothing publishes without consent.": "مختصون ومؤسسات نُشرت ملفاتهم بموافقة صريحة. يجري التواصل عبر المنصة؛ ولا يُنشر شيء دون موافقة.",
  "All categories": "جميع الفئات",
  "All provinces": "جميع المحافظات",
  "Search by name…": "البحث بالاسم…",
  "No published profiles match these filters. An empty result is not a claim that no professionals exist.": "لا توجد ملفات منشورة مطابقة لهذه المرشّحات. خلو النتائج لا يعني عدم وجود مختصين.",
  "Directory results table — scrollable": "جدول نتائج الدليل — قابل للتمرير",
  Professional: "المختص",
  "Location needs confirmation": "الموقع بحاجة إلى تأكيد",
  "Platform message": "رسالة عبر المنصة",
  "First page": "الصفحة الأولى",
  Showing: "المعروض",
  "DIRECTORY PROFILE": "ملف الدليل",
  "Professional profile": "الملف المهني",
  "Location awaiting reference review": "الموقع بانتظار مراجعة المرجع",
  "Credentials table — scrollable": "جدول المؤهلات والاعتمادات — قابل للتمرير",
  Role: "الدور",
  Issuer: "الجهة المانحة",
  "Recorded date window": "الفترة المسجلة",
  "Within recorded dates": "ضمن الفترة المسجلة",
  "Dates not recorded": "التواريخ غير مسجلة",
  "Not yet in date": "لم يبدأ سريانه بعد",
  "Date review needed": "التواريخ بحاجة إلى مراجعة",
  "No credentials are recorded for this profile. Absence of a credential row is not evidence about qualification.": "لا توجد مؤهلات أو اعتمادات مسجلة لهذا الملف. عدم وجود سجل لا يثبت عدم التأهل.",
  "Sign in to send a private inquiry": "سجّل الدخول لإرسال استفسار خاص",
  "All professionals": "جميع المختصين",
  "Post types": "أنواع المنشورات",
  "All posts": "جميع المنشورات",
  Newsroom: "الأخبار",
  "News, articles & updates": "أخبار ومقالات ومستجدات",
  published: "منشور",
  "Editorial Studio": "استوديو التحرير",
  "Signing in…": "جارٍ تسجيل الدخول…",
  "Demo Admin Login": "دخول مشرف العرض التجريبي",
  "Loading newsroom…": "جارٍ تحميل الأخبار…",
  "No published posts yet.": "لا توجد منشورات منشورة بعد.",
  "Published posts appear here as soon as the editorial team releases them.": "تظهر المنشورات هنا فور نشرها من قِبل فريق التحرير.",
  "Back to Newsroom": "العودة إلى الأخبار",
  "Google grounded": "مستند إلى مصادر من Google",
  "Horse DB Editorial": "فريق تحرير Horse DB",
  "Want to try publishing?": "هل ترغب في تجربة النشر؟",
  "Use the one-click local demo administrator, then open the Editorial Studio.": "استخدم حساب المشرف التجريبي المحلي بنقرة واحدة، ثم افتح استوديو التحرير.",
  "Login as Demo Admin": "الدخول بصفة مشرف تجريبي",
  "Date unavailable": "التاريخ غير متاح",
  "SERVICE REQUESTS": "طلبات الخدمات",
  "Your professional connections": "تواصلك مع المختصين",
  "Find a professional": "ابحث عن مختص",
  "Sign in to see your private requests.": "سجّل الدخول للاطلاع على طلباتك الخاصة.",
  "Request inbox": "صندوق الطلبات",
  "Request action results": "نتائج الإجراءات على الطلبات",
  "No requests here yet": "لا توجد طلبات هنا بعد",
  "Choose a published professional to start a request.": "اختر مختصًا ذا ملف منشور لبدء طلب.",
  "Requests to the professionals you currently manage will appear here.": "ستظهر هنا الطلبات الموجّهة إلى المختصين الذين تدير ملفاتهم حاليًا.",
  "Browse the directory": "تصفّح الدليل",
  "Request details": "تفاصيل الطلب",
  "This request link is invalid.": "رابط هذا الطلب غير صالح.",
  "Select a request": "اختر طلبًا",
  "Review the current status, private note and consent controls before taking action.": "راجع الحالة الحالية والملاحظة الخاصة وخيارات الموافقة قبل اتخاذ إجراء.",
  Request: "الطلب",
  "Recording your change…": "جارٍ حفظ تعديلك…",
  "The change was recorded. Notification delivery is not confirmed.": "حُفظ التعديل. لم يُؤكّد تسليم الإشعار.",
  "Review the current request before another action. A failed response does not prove the earlier action failed.": "راجع الطلب الحالي قبل إجراء آخر. فشل الاستجابة لا يثبت فشل الإجراء السابق.",
  "Checking…": "جارٍ التحقق…",
  "Recheck current request": "إعادة التحقق من الطلب الحالي",
  "The reread failed. Recovery remains locked.": "فشلت إعادة القراءة. تظل الاستعادة مقفلة.",
  "The current request was read successfully. This does not independently confirm an earlier report or notification.": "قُرئ الطلب الحالي بنجاح. لا يؤكد ذلك وحده بلاغًا أو إشعارًا سابقًا.",
  "I reviewed the current request": "راجعت الطلب الحالي",
  Provider: "مقدّم الخدمة",
  "Last updated": "آخر تحديث",
  "No further status changes are available to your role.": "لا يتيح دورك مزيدًا من تغييرات الحالة.",
  "Privacy and safety controls": "خيارات الخصوصية والأمان",
  "Contact withdrawal and note redaction are one-way. Previously delivered messages cannot be recalled. Blocking prevents new requests; it does not close this one.": "سحب مشاركة بيانات التواصل وحجب الملاحظة إجراءان لا رجعة فيهما. لا يمكن استرداد الرسائل التي سُلّمت سابقًا. يمنع الحظر الطلبات الجديدة، لكنه لا يغلق هذا الطلب.",
  "Withdraw contact sharing": "سحب مشاركة بيانات التواصل",
  "Redact private note": "حجب الملاحظة الخاصة",
  "Block this provider": "حظر مقدّم الخدمة",
  "Private block reason (optional)": "سبب الحظر الخاص (اختياري)",
  "Block requester": "حظر صاحب الطلب",
  "Confirm privacy change": "تأكيد تغيير الخصوصية",
  "Apply the selected privacy change to this request?": "هل تريد تطبيق تغيير الخصوصية المحدد على هذا الطلب؟",
  "Confirm change": "تأكيد التغيير",
  "Report a concern (5–500 characters)": "الإبلاغ عن مشكلة (٥–٥٠٠ حرف)",
  "Submit private report": "إرسال بلاغ خاص",
  WORKSPACES: "مساحات العمل",
  "Sign in to see your farm workspaces.": "سجّل الدخول لعرض مساحات العمل الخاصة بمزرعتك.",
  "My collections": "مجموعاتي",
  "No workspaces yet. Creation is subject to the current free-tier or plan limits.": "لا توجد مساحات عمل بعد. يخضع إنشاؤها للحدود الحالية للباقة المجانية أو باقتك.",
  "Select a workspace to see its herd and reminders.": "اختر مساحة عمل لعرض خيولها وتذكيراتها.",
  "Reminder completed. A recurring reminder schedules its next occurrence exactly once.": "اكتمل التذكير. إذا كان متكررًا، يُجدول موعده التالي مرة واحدة فقط.",
  "Complete reminder": "إكمال التذكير",
  "horses in this working set": "خيول في هذه المجموعة",
  "Refresh workspace": "تحديث مساحة العمل",
  "Your plan is read-only. Existing information and permitted exports remain available.": "باقتك للقراءة فقط. تظل المعلومات الحالية وعمليات التصدير المسموح بها متاحة.",
  "Workspace sections": "أقسام مساحة العمل",
  "Reminder view": "عرض التذكيرات",
  "List view": "عرض القائمة",
  "Calendar view": "عرض التقويم",
  "Showing the first 500 open reminders. The complete task list requires pagination.": "تُعرض أول ٥٠٠ تذكير مفتوح. يتطلب عرض قائمة المهام كاملة دعم تقسيمها إلى صفحات.",
  "Reminder dates needing review": "تواريخ تذكيرات بحاجة إلى مراجعة",
  "Reminders by day": "التذكيرات حسب اليوم",
  "Previous month": "الشهر السابق",
  "Next month": "الشهر التالي",
  "Select a reminder to mark it complete. Dates use each reminder’s timezone.": "اختر تذكيرًا لوضع علامة اكتماله. تتبع التواريخ المنطقة الزمنية الخاصة بكل تذكير.",
  "No open reminders. Add one to track the next task for this workspace.": "لا توجد تذكيرات مفتوحة. أضف تذكيرًا لمتابعة المهمة التالية في مساحة العمل.",
  "Horse record": "سجل الحصان",
  "Assign or unassign a reminder (versioned)": "إسناد تذكير أو إلغاء إسناده (مع التحقق من الإصدار)",
  "Assignment updated and audit-recorded; the task version advanced.": "حُدّث الإسناد ووُثّق في سجل التدقيق، وانتقلت المهمة إلى إصدار جديد.",
  Reminder: "التذكير",
  "Choose…": "اختر…",
  "Assign to (blank = unassign)": "إسناد إلى (فارغ = إلغاء الإسناد)",
  "Update assignment": "تحديث الإسناد",
  "This reminder changed; reload and retry with the current version.": "تغيّر هذا التذكير. أعد تحميله ثم حاول باستخدام الإصدار الحالي.",
  "You need the tasks_manage action to assign reminders.": "يلزم إذن tasks_manage لإسناد التذكيرات.",
  "Loading completed reminders…": "جارٍ تحميل التذكيرات المكتملة…",
  "recurring occurrence": "موعد متكرر",
  "Import reminders": "استيراد التذكيرات",
  "Import reminders (no overwrite)": "استيراد التذكيرات (دون استبدال)",
  "Import up to 200 rows": "استيراد ما يصل إلى ٢٠٠ صف",
  "Import finished — every row reports its honest outcome below.": "اكتمل الاستيراد. تظهر أدناه النتيجة الفعلية لكل صف.",
  Row: "الصف",
  "Remove row": "إزالة الصف",
  "Add row": "إضافة صف",
  "Import receipts": "إيصالات الاستيراد",
  "Per-row receipts": "نتائج كل صف",
  imported: "مستورد",
  "already imported by a previous attempt of this import (accepted)": "سبق استيراده في محاولة سابقة لهذا الاستيراد (مقبول)",
  "an existing occurrence was skipped and reported — never overwritten": "تم تخطّي موعد موجود والإبلاغ عنه دون استبداله",
  "the write refused this row": "رُفض حفظ هذا الصف",
  "You need the tasks_manage action to import reminders.": "يلزم إذن tasks_manage لاستيراد التذكيرات.",
  ALL: "الكل",
  Statistics: "الإحصاءات",
  "Premium intelligence": "تحليلات متقدمة",
  "All premium intelligence": "جميع التحليلات المتقدمة",
  "Intelligence views": "طرق عرض التحليلات",
  "Appearance Studio sections": "أقسام استوديو المظهر",
  Validity: "الصلاحية",
  Concentration: "التركّز",
  "Generation intervals": "الفواصل بين الأجيال",
  "Lineage reach": "امتداد السلالات",
  "This platform introduces buyers to sellers. It does not escrow payments, inspect horses, verify veterinary condition or guarantee any transaction. Buyers and sellers perform their own due diligence.": "تربط هذه المنصة المشترين بالبائعين. وهي لا تحتفظ بالمدفوعات في حساب ضمان، ولا تفحص الخيول، ولا تتحقق من حالتها البيطرية، ولا تضمن أي معاملة. يتحمل المشترون والبائعون مسؤولية إجراء التحقق اللازم بأنفسهم.",
  "competition start": "مشاركة في المنافسات",
  "verified doc": "مستند تم التحقق منه",
  "Top tabs only": "علامات التبويب العلوية فقط",
  "Sidebar only": "الشريط الجانبي فقط",
  "Sidebar and top tabs together; the sidebar follows the viewport": "الشريط الجانبي مع علامات التبويب معًا؛ يتبع الشريط الجانبي عرض الشاشة",
  "Automatic: sidebar on wide viewports, tabs otherwise": "تلقائي: الشريط الجانبي على الشاشات العريضة وعلامات التبويب فيما عدا ذلك",
  "Only the synthetic demonstration dataset is connected.": "المتصل حاليًا مجموعة البيانات التجريبية الاصطناعية فقط.",
  "Connect the intended authorized dataset before validating production coverage.": "اربط مجموعة البيانات المصرّح بها المقصودة قبل تقييم تغطية الإنتاج.",
  "Registry data is not loaded.": "لم يتم تحميل بيانات السجل."
};

// src/frontend-kit/domain/engineText.ts
var KIT_ARABIC = arabicKitCopy_default;
var CORE_ARABIC = uiCopy_ar_default;
function kitText(locale, english, persian) {
  if (locale === "en") return english;
  if (locale === "fa") return persian;
  if (Object.hasOwn(KIT_ARABIC, english)) return KIT_ARABIC[english];
  if (Object.hasOwn(CORE_ARABIC, english)) return CORE_ARABIC[english];
  return english;
}
function kitNumberTag(locale) {
  return locale === "fa" ? "fa-IR" : locale === "ar" ? "ar-u-nu-arab" : "en-US";
}

// src/frontend-kit/domain/serviceWorkbench.ts
var STATUS = ["new", "acknowledged", "discussing", "closed", "withdrawn", "spam"];
var IDLE_COMMAND = Object.freeze({ state: { phase: "idle" }, recovery: "none" });
function validServiceRequestId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function serviceRequestStatusLabel(status, locale) {
  const labels = {
    new: ["New", "جدید"],
    acknowledged: ["Acknowledged", "دریافت تأیید شد"],
    discussing: ["Discussing", "در گفت‌وگو"],
    closed: ["Closed", "بسته شد"],
    withdrawn: ["Withdrawn", "پس گرفته شد"],
    spam: ["Spam", "هرزنامه"]
  };
  const pair = labels[status];
  return pair ? kitText(locale, pair[0], pair[1]) : status;
}
function validServiceRequest(value) {
  if (!value || typeof value !== "object") return false;
  const row = value;
  return validServiceRequestId(row.id) && validServiceRequestId(row.provider_person_id) && validServiceRequestId(row.row_version) && STATUS.includes(row.status) && typeof row.is_requester_view === "boolean" && typeof row.category === "string";
}
function initialSnapshot() {
  return {
    view: "mine",
    list: { phase: "idle" },
    selectedId: null,
    detail: { phase: "idle" },
    commands: {}
  };
}
function carried(state) {
  return state.phase === "ready" || state.phase === "reloading" ? state.data : void 0;
}
function errorReason(state) {
  return "reason" in state ? state.reason : void 0;
}
var ServiceRequestWorkbench = class {
  constructor(api, isCurrent = () => true) {
    this.api = api;
    this.isCurrent = isCurrent;
  }
  api;
  isCurrent;
  snapshot = initialSnapshot();
  listeners = /* @__PURE__ */ new Set();
  active = false;
  epoch = 0;
  listSequence = 0;
  detailSequence = 0;
  listAbort = null;
  detailAbort = null;
  reads = /* @__PURE__ */ new Set();
  busy = /* @__PURE__ */ new Set();
  reconciliationSequence = /* @__PURE__ */ new Map();
  authoritySequence = 0;
  readClock = 0;
  /** A later detail/recovery read supersedes an earlier list for this row.
   * undefined = still checking; null = denied/failed; a record = verified read. */
  recordReads = /* @__PURE__ */ new Map();
  privacyPending = /* @__PURE__ */ new Set();
  getSnapshot = () => this.snapshot;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  live(epoch = this.epoch) {
    return this.active && this.isCurrent() && epoch === this.epoch;
  }
  publish(patch) {
    if (!this.live()) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  setCommand(id, command) {
    this.publish({ commands: { ...this.snapshot.commands, [id]: command } });
  }
  start = () => {
    if (this.active || !this.isCurrent()) return;
    this.active = true;
    this.epoch += 1;
    void this.reload();
  };
  dispose = () => {
    this.active = false;
    this.epoch += 1;
    this.listAbort?.abort();
    this.detailAbort?.abort();
    for (const read of this.reads) read.abort();
    this.reads.clear();
    this.busy.clear();
    this.reconciliationSequence.clear();
    this.recordReads.clear();
    this.privacyPending.clear();
    this.authoritySequence += 1;
    this.snapshot = initialSnapshot();
  };
  commandFor = (id) => this.snapshot.commands[id] ?? IDLE_COMMAND;
  blocked(id) {
    const state = this.commandFor(id).state;
    return this.busy.has(id) || state.phase === "submitting" || state.phase === "failed" || state.phase === "rejected" && state.status === 409;
  }
  currentRecord(id) {
    if (this.recordReads.has(id) && !this.recordReads.get(id)?.record) return void 0;
    if (this.snapshot.selectedId === id && this.snapshot.detail.phase === "ready") return this.snapshot.detail.data;
    if (this.snapshot.list.phase === "ready") return this.snapshot.list.data.find((row) => row.id === id);
    return void 0;
  }
  canAct = (id) => this.live() && !this.blocked(id) && !!this.currentRecord(id);
  setView = (view) => {
    if (!this.live() || view !== "mine" && view !== "inbox" || view === this.snapshot.view) return;
    this.detailAbort?.abort();
    this.detailSequence += 1;
    this.publish({ view, list: { phase: "loading" }, selectedId: null, detail: { phase: "idle" } });
    void this.reload();
  };
  select = (id) => {
    if (!this.live() || id !== null && !validServiceRequestId(id)) return;
    this.detailAbort?.abort();
    this.detailSequence += 1;
    this.publish({ selectedId: id, detail: id === null ? { phase: "idle" } : { phase: "loading" } });
    if (id !== null) void this.readSelected(id);
  };
  reload = async () => {
    if (!this.live()) return;
    const epoch = this.epoch, view = this.snapshot.view, sequence = ++this.listSequence;
    this.listAbort?.abort();
    const abort = new AbortController();
    this.listAbort = abort;
    this.detailAbort?.abort();
    this.detailSequence += 1;
    this.authoritySequence += 1;
    for (const read of this.reads) read.abort();
    this.reads.clear();
    this.reconciliationSequence.clear();
    this.recordReads.clear();
    const selectedSequence = this.detailSequence, started = ++this.readClock;
    const commands = Object.fromEntries(Object.entries(this.snapshot.commands).map(([id, command]) => [id, command.recovery === "none" ? command : { ...command, recovery: "none", recoveryReason: void 0 }]));
    const previous = carried(this.snapshot.list);
    this.publish({
      commands,
      list: previous ? { phase: "reloading", data: previous.map(this.maskPrivate) } : { phase: "loading" },
      ...this.snapshot.selectedId !== null ? { detail: { phase: "loading" } } : {}
    });
    try {
      const result = await this.api[view]({ signal: abort.signal });
      if (!this.live(epoch) || sequence !== this.listSequence || abort.signal.aborted) return;
      if (!Array.isArray(result.requests) || !result.requests.every(validServiceRequest)) throw new Error("Invalid service request response.");
      const rows = result.requests.flatMap((row) => {
        const newer = this.recordReads.get(row.id);
        const record = newer && newer.sequence > started ? newer.record === void 0 ? this.maskPrivate(row) : newer.record : row;
        return record ? [this.visibleRecord(record)] : [];
      });
      this.publish({ list: rows.length ? { phase: "ready", data: rows } : { phase: "empty" } });
    } catch (error) {
      if (this.live(epoch) && sequence === this.listSequence && !abort.signal.aborted) {
        this.publish({ list: classifyResourceError(error) });
      }
    }
    if (this.live(epoch) && sequence === this.listSequence && this.detailSequence === selectedSequence && this.snapshot.selectedId !== null) {
      await this.readSelected(this.snapshot.selectedId);
    }
  };
  maskPrivate = (row) => ({ ...row, contact: null, note: void 0 });
  visibleRecord = (row) => this.privacyPending.has(row.id) ? this.maskPrivate(row) : row;
  replaceRecord(id, record) {
    if (record) record = this.visibleRecord(record);
    const patch = {};
    const rows = carried(this.snapshot.list);
    if (rows) {
      const next = rows.flatMap((row) => row.id !== id ? [row] : record ? [record] : []);
      patch.list = this.snapshot.list.phase === "reloading" ? { phase: "reloading", data: next } : next.length ? { phase: "ready", data: next } : { phase: "empty" };
    }
    if (this.snapshot.selectedId === id) patch.detail = record ? { phase: "ready", data: record } : { phase: "unavailable", reason: "This request is no longer available." };
    this.publish(patch);
  }
  readSelected = async (id) => {
    if (!this.live() || this.snapshot.selectedId !== id) return;
    const epoch = this.epoch, sequence = ++this.detailSequence, authority = this.authoritySequence;
    this.detailAbort?.abort();
    const abort = new AbortController();
    this.detailAbort = abort;
    const row = this.currentRecord(id), started = ++this.readClock;
    this.recordReads.set(id, { sequence: started, record: void 0 });
    this.reconciliationSequence.delete(id);
    const command = this.commandFor(id);
    if (command.recovery !== "none") this.setCommand(id, { ...command, recovery: "none", recoveryReason: void 0 });
    if (row) this.replaceRecord(id, this.maskPrivate(row));
    this.publish({ detail: { phase: "loading" } });
    const current = () => this.live(epoch) && authority === this.authoritySequence && sequence === this.detailSequence && !abort.signal.aborted && this.recordReads.get(id)?.sequence === started;
    try {
      const result = await this.api.detail(id, { signal: abort.signal });
      if (!current()) return;
      if (!validServiceRequest(result.request) || result.request.id !== id) throw new Error("Invalid service request response.");
      this.recordReads.set(id, { sequence: started, record: this.visibleRecord(result.request) });
      this.replaceRecord(id, result.request);
    } catch (error) {
      if (current()) {
        this.recordReads.set(id, { sequence: started, record: null });
        this.replaceRecord(id, null);
        this.publish({ detail: classifyResourceError(error) });
      }
    }
  };
  transition = (id, status) => {
    const row = this.currentRecord(id);
    if (!row || !serviceTransitionsFor(row.status, row.is_requester_view ? "requester" : "provider").includes(status)) return Promise.resolve(false);
    return this.execute(id, () => this.api.setStatus(id, status, { expectedVersion: row.row_version }), (result) => {
      const request = result?.request;
      return validServiceRequest(request) && request.id === id && request.status === status && request.row_version > row.row_version;
    });
  };
  withdrawConsent = (id) => {
    if (!this.currentRecord(id)?.is_requester_view) return Promise.resolve(false);
    return this.execute(id, () => this.api.withdrawConsent(id), (result) => {
      const receipt = result;
      return receipt?.withdrawn === true && receipt.request_id === id && receipt.share_contact === false;
    }, true);
  };
  redactNote = (id) => {
    if (!this.currentRecord(id)?.is_requester_view) return Promise.resolve(false);
    return this.execute(id, () => this.api.redactNote(id), (result) => {
      const receipt = result;
      return receipt?.redacted === true && receipt.request_id === id;
    }, true);
  };
  block = (id) => {
    const row = this.currentRecord(id);
    if (!row?.is_requester_view) return Promise.resolve(false);
    return this.execute(id, () => this.api.block(id), (result) => {
      const receipt = result;
      return receipt?.blocked === true && receipt.provider_person_id === row.provider_person_id;
    });
  };
  providerBlock = (id, reason) => {
    const row = this.currentRecord(id), note = reason?.trim();
    if (!row || row.is_requester_view || note && (note.length < 5 || note.length > 500)) return Promise.resolve(false);
    return this.execute(id, () => this.api.providerBlock(id, note ? { reason: note } : {}), (result) => {
      const receipt = result;
      return receipt?.blocked === true && receipt.requester_account === "blocked";
    });
  };
  report = (id, reason) => {
    const note = reason.trim();
    if (!this.currentRecord(id) || note.length < 5 || note.length > 500) return Promise.resolve(false);
    return this.execute(id, () => this.api.report(id, { reason: note }), (result) => {
      const receipt = result;
      return receipt?.reported === true && validServiceRequestId(receipt.report_id);
    });
  };
  async execute(id, run, valid, privacy = false) {
    if (!this.canAct(id)) return false;
    const epoch = this.epoch;
    this.busy.add(id);
    if (privacy) {
      const row = this.currentRecord(id);
      this.privacyPending.add(id);
      if (row) this.replaceRecord(id, this.maskPrivate(row));
    }
    this.setCommand(id, { state: { phase: "submitting" }, recovery: "none" });
    let accepted = false;
    try {
      const result = await run();
      if (!this.live(epoch)) return false;
      if (!valid(result)) throw new Error("The server response did not confirm this change. Recheck the request before another attempt.");
      accepted = true;
      this.privacyPending.delete(id);
      await this.reload();
      if (this.live(epoch)) this.setCommand(id, { state: { phase: "accepted", message: "Change recorded. Notification delivery is not confirmed." }, recovery: "none" });
    } catch (error) {
      if (this.live(epoch)) {
        const state = classifyCommandError(error);
        if (privacy && state.phase === "rejected" && state.status !== 409) {
          this.privacyPending.delete(id);
          await this.reload();
        }
        if (this.live(epoch)) this.setCommand(id, { state, recovery: "none" });
      }
    } finally {
      if (this.live(epoch)) this.busy.delete(id);
      if (this.live(epoch)) this.publish({ commands: { ...this.snapshot.commands } });
    }
    return accepted && this.live(epoch);
  }
  reconcile = async (id) => {
    if (!this.live() || this.busy.has(id) || !validServiceRequestId(id)) return;
    const command = this.commandFor(id);
    if (command.recovery === "reading") return;
    if (command.state.phase !== "failed" && !(command.state.phase === "rejected" && command.state.status === 409)) return;
    const epoch = this.epoch, authority = this.authoritySequence;
    const sequence = (this.reconciliationSequence.get(id) ?? 0) + 1;
    this.reconciliationSequence.set(id, sequence);
    const abort = new AbortController();
    this.reads.add(abort);
    const row = this.currentRecord(id), started = ++this.readClock;
    this.recordReads.set(id, { sequence: started, record: void 0 });
    if (this.snapshot.selectedId === id) {
      this.detailAbort?.abort();
      this.detailSequence += 1;
    }
    if (row) this.replaceRecord(id, this.maskPrivate(row));
    this.setCommand(id, { ...command, recovery: "reading", recoveryReason: void 0 });
    const current = () => this.live(epoch) && authority === this.authoritySequence && !abort.signal.aborted && this.reconciliationSequence.get(id) === sequence && this.recordReads.get(id)?.sequence === started;
    try {
      const result = await this.api.detail(id, { signal: abort.signal });
      if (!current()) return;
      if (!validServiceRequest(result.request) || result.request.id !== id) throw new Error("Invalid service request response.");
      this.privacyPending.delete(id);
      this.recordReads.set(id, { sequence: started, record: result.request });
      this.replaceRecord(id, result.request);
      this.setCommand(id, { ...command, recovery: "ready", recoveryReason: void 0 });
    } catch (error) {
      if (current()) {
        this.recordReads.set(id, { sequence: started, record: null });
        this.replaceRecord(id, null);
        const failed = classifyResourceError(error);
        if (this.snapshot.selectedId === id) this.publish({ detail: failed });
        this.setCommand(id, { ...command, recovery: "failed", recoveryReason: errorReason(failed) });
      }
    } finally {
      this.reads.delete(abort);
    }
  };
  acknowledge = (id) => {
    if (!this.live() || this.busy.has(id) || this.commandFor(id).recovery !== "ready" || !this.currentRecord(id)) return false;
    this.setCommand(id, IDLE_COMMAND);
    return true;
  };
};

// src/directory/catalog.json
var catalog_default = {
  province_code_scheme: "iso3166-2-ir:2020-11-24",
  sources: {
    provinces: "https://raw.githubusercontent.com/flyingcircusio/pycountry/main/src/pycountry/databases/iso3166-2.json",
    dc: "https://www.ecaho.org/about-ecaho/commissions-groups"
  },
  checked_at: "2026-10-05",
  service_categories: [
    {
      id: "veterinarian",
      en: "Veterinarian",
      fa: "دامپزشک",
      ar: "طبيب بيطري"
    },
    {
      id: "trainer",
      en: "Riding trainer",
      fa: "مربی سوارکاری",
      ar: "مدرب ركوب"
    },
    {
      id: "club",
      en: "Riding club",
      fa: "باشگاه سوارکاری",
      ar: "نادي ركوب الخيل"
    },
    {
      id: "breeder",
      en: "Breeder",
      fa: "پرورش‌دهنده",
      ar: "مربٍّ"
    },
    {
      id: "stud",
      en: "Stud service",
      fa: "خدمات نریان",
      ar: "خدمات الفحول"
    },
    {
      id: "rider",
      en: "Rider",
      fa: "سوارکار",
      ar: "فارس"
    },
    {
      id: "judge",
      en: "Judge",
      fa: "داور",
      ar: "حَكَم"
    },
    {
      id: "steward",
      en: "Steward",
      fa: "کلانتر",
      ar: "المشرف الميداني"
    },
    {
      id: "dc",
      en: "Disciplinary Committee (DC)",
      fa: "عضو کمیته انضباطی (DC)",
      ar: "عضو اللجنة التأديبية (DC)"
    },
    {
      id: "ringmaster",
      en: "Ringmaster",
      fa: "رینگ‌مستر",
      ar: "مدير الحلبة"
    },
    {
      id: "course_designer",
      en: "Course designer",
      fa: "طراح مسیر",
      ar: "مصمم المسار"
    },
    {
      id: "transport",
      en: "Horse transport",
      fa: "اسب‌کش",
      ar: "نقل الخيول"
    },
    {
      id: "farrier",
      en: "Farrier",
      fa: "نعل‌بند",
      ar: "حدّاد حوافر"
    },
    {
      id: "equipment",
      en: "Equipment shop",
      fa: "لوازم و تجهیزات",
      ar: "متجر العتاد"
    },
    {
      id: "feed",
      en: "Feed supplier",
      fa: "خوراک و مکمل",
      ar: "مورّد الأعلاف"
    },
    {
      id: "photographer",
      en: "Equine photographer",
      fa: "عکاس اسب",
      ar: "مصوّر الخيول"
    },
    {
      id: "lab",
      en: "Genetics laboratory",
      fa: "آزمایشگاه ژنتیک",
      ar: "مختبر الوراثة"
    },
    {
      id: "rehabilitation",
      en: "Rehabilitation service",
      fa: "توانبخشی",
      ar: "خدمة التأهيل"
    },
    {
      id: "groom",
      en: "Groom",
      fa: "مهتر",
      ar: "سائس"
    },
    {
      id: "boarding",
      en: "Boarding stable",
      fa: "پانسیون اسب",
      ar: "إسطبل الإيواء"
    },
    {
      id: "saddle_fitter",
      en: "Saddle fitter",
      fa: "متخصص تناسب زین",
      ar: "أخصائي ملاءمة السرج"
    },
    {
      id: "event_organizer",
      en: "Event organizer",
      fa: "برگزارکننده رویداد",
      ar: "منظّم الفعاليات"
    }
  ],
  provinces: [
    {
      code: "IR-00",
      en: "Markazi",
      fa: "مرکزی",
      ar: "مركزي"
    },
    {
      code: "IR-01",
      en: "Gilan",
      fa: "گیلان",
      ar: "غيلان"
    },
    {
      code: "IR-02",
      en: "Mazandaran",
      fa: "مازندران",
      ar: "مازندران"
    },
    {
      code: "IR-03",
      en: "East Azerbaijan",
      fa: "آذربایجان شرقی",
      ar: "أذربيجان الشرقية"
    },
    {
      code: "IR-04",
      en: "West Azerbaijan",
      fa: "آذربایجان غربی",
      ar: "أذربيجان الغربية"
    },
    {
      code: "IR-05",
      en: "Kermanshah",
      fa: "کرمانشاه",
      ar: "كرمانشاه"
    },
    {
      code: "IR-06",
      en: "Khuzestan",
      fa: "خوزستان",
      ar: "خوزستان"
    },
    {
      code: "IR-07",
      en: "Fars",
      fa: "فارس",
      ar: "فارس"
    },
    {
      code: "IR-08",
      en: "Kerman",
      fa: "کرمان",
      ar: "كرمان"
    },
    {
      code: "IR-09",
      en: "Razavi Khorasan",
      fa: "خراسان رضوی",
      ar: "خراسان رضوي"
    },
    {
      code: "IR-10",
      en: "Isfahan",
      fa: "اصفهان",
      ar: "أصفهان"
    },
    {
      code: "IR-11",
      en: "Sistan and Baluchestan",
      fa: "سیستان و بلوچستان",
      ar: "سيستان وبلوشستان"
    },
    {
      code: "IR-12",
      en: "Kurdistan",
      fa: "کردستان",
      ar: "كردستان"
    },
    {
      code: "IR-13",
      en: "Hamadan",
      fa: "همدان",
      ar: "همدان"
    },
    {
      code: "IR-14",
      en: "Chaharmahal and Bakhtiari",
      fa: "چهارمحال و بختیاری",
      ar: "چهارمحال وبختياري"
    },
    {
      code: "IR-15",
      en: "Lorestan",
      fa: "لرستان",
      ar: "لرستان"
    },
    {
      code: "IR-16",
      en: "Ilam",
      fa: "ایلام",
      ar: "إيلام"
    },
    {
      code: "IR-17",
      en: "Kohgiluyeh and Boyer-Ahmad",
      fa: "کهگیلویه و بویراحمد",
      ar: "كهكيلويه وبويرأحمد"
    },
    {
      code: "IR-18",
      en: "Bushehr",
      fa: "بوشهر",
      ar: "بوشهر"
    },
    {
      code: "IR-19",
      en: "Zanjan",
      fa: "زنجان",
      ar: "زنجان"
    },
    {
      code: "IR-20",
      en: "Semnan",
      fa: "سمنان",
      ar: "سمنان"
    },
    {
      code: "IR-21",
      en: "Yazd",
      fa: "یزد",
      ar: "يزد"
    },
    {
      code: "IR-22",
      en: "Hormozgan",
      fa: "هرمزگان",
      ar: "هرمزغان"
    },
    {
      code: "IR-23",
      en: "Tehran",
      fa: "تهران",
      ar: "طهران"
    },
    {
      code: "IR-24",
      en: "Ardabil",
      fa: "اردبیل",
      ar: "أردبيل"
    },
    {
      code: "IR-25",
      en: "Qom",
      fa: "قم",
      ar: "قم"
    },
    {
      code: "IR-26",
      en: "Qazvin",
      fa: "قزوین",
      ar: "قزوين"
    },
    {
      code: "IR-27",
      en: "Golestan",
      fa: "گلستان",
      ar: "كلستان"
    },
    {
      code: "IR-28",
      en: "North Khorasan",
      fa: "خراسان شمالی",
      ar: "خراسان الشمالية"
    },
    {
      code: "IR-29",
      en: "South Khorasan",
      fa: "خراسان جنوبی",
      ar: "خراسان الجنوبية"
    },
    {
      code: "IR-30",
      en: "Alborz",
      fa: "البرز",
      ar: "البرز"
    }
  ]
};

// src/directory/vocabulary.ts
var SERVICE_CATEGORIES = catalog_default.service_categories;
var SERVICE_CATEGORY_IDS = SERVICE_CATEGORIES.map((category) => category.id);
function isServiceCategoryId(id) {
  return SERVICE_CATEGORY_IDS.includes(id);
}
function serviceCategoryLabel(id, locale) {
  const category = SERVICE_CATEGORIES.find((entry) => entry.id === id);
  if (locale === "ar") return category ? category.ar ?? kitText("ar", category.en, category.fa) : id;
  return category ? locale === "fa" ? category.fa : category.en : id;
}
var PROVINCE_CODE_SCHEME = catalog_default.province_code_scheme;
var IRAN_PROVINCES = catalog_default.provinces;
function isValidProvinceCode(code) {
  return IRAN_PROVINCES.some((province) => province.code === code);
}
function provinceLabel(code, locale) {
  const province = IRAN_PROVINCES.find((entry) => entry.code === code);
  if (locale === "ar") return province ? province.ar ?? kitText("ar", province.en, province.fa) : code;
  return province ? locale === "fa" ? province.fa : province.en : code;
}

// src/frontend-kit/domain/mutationIntentStorage.ts
var MUTATION_INTENT_TTL_MS = 24 * 60 * 60 * 1e3;
var MUTATION_INTENT_PREFIX = "hr-intent:v1:";
var memoryStore = /* @__PURE__ */ new Map();
var MAX_RECORD_CHARACTERS = 8192;
var SUMMARY_FIELDS = /* @__PURE__ */ new Set(["workflow", "category", "provider_person_id", "share_contact", "note_length"]);
function intentStorageKey(scope, workflow, resource) {
  return `${MUTATION_INTENT_PREFIX}${encodeURIComponent(scope)}|${encodeURIComponent(workflow)}|${encodeURIComponent(resource)}`;
}
function boundedText(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
function parseRecord(raw) {
  if (raw.length > MAX_RECORD_CHARACTERS) return null;
  try {
    const value = JSON.parse(raw);
    const fields = /* @__PURE__ */ new Set(["key", "scope", "workflow", "resource", "summary", "phase", "createdAt", "updatedAt"]);
    if (!value || typeof value !== "object" || Object.keys(value).some((key) => !fields.has(key))) return null;
    if (!boundedText(value?.key, 128) || !boundedText(value.scope, 4096) || !boundedText(value.workflow, 80) || !boundedText(value.resource, 256) || value.phase !== "pending" && value.phase !== "submitted" || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || !value.summary || typeof value.summary !== "object" || Array.isArray(value.summary)) return null;
    for (const [field, item] of Object.entries(value.summary)) {
      if (!SUMMARY_FIELDS.has(field)) return null;
      if ((field === "workflow" || field === "category") && !boundedText(item, 80)) return null;
      if (field === "provider_person_id" && (typeof item !== "number" || !Number.isSafeInteger(item) || item <= 0)) return null;
      if (field === "note_length" && (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0 || item > 2e3)) return null;
      if (field === "share_contact" && typeof item !== "boolean") return null;
    }
    return value;
  } catch {
    return null;
  }
}
function openIntentStorage() {
  let backing = null;
  let durable = false;
  try {
    if (typeof localStorage !== "undefined") {
      backing = localStorage;
      const probe = `${MUTATION_INTENT_PREFIX}probe`;
      backing.setItem(probe, "1");
      backing.removeItem(probe);
      durable = true;
    }
  } catch {
    durable = false;
  }
  const remove = (key) => {
    try {
      backing?.removeItem(key);
    } catch {
      durable = false;
    }
    memoryStore.delete(key);
  };
  return {
    get durable() {
      return durable;
    },
    load(scope, workflow, resource) {
      const key = intentStorageKey(scope, workflow, resource);
      let record = null;
      if (durable && backing) {
        try {
          const raw = backing.getItem(key);
          if (raw === null) {
            memoryStore.delete(key);
            return null;
          }
          record = parseRecord(raw);
          if (!record) {
            remove(key);
            return null;
          }
        } catch {
          durable = false;
        }
      }
      record ??= memoryStore.get(key) ?? null;
      if (record && (record.scope !== scope || record.workflow !== workflow || record.resource !== resource)) {
        remove(key);
        return null;
      }
      if (record) memoryStore.set(key, record);
      return record;
    },
    save(record) {
      const raw = JSON.stringify(record);
      const validated = parseRecord(raw);
      if (!validated) throw new Error("Intent recovery metadata failed validation");
      const key = intentStorageKey(record.scope, record.workflow, record.resource);
      memoryStore.set(key, validated);
      try {
        if (durable && backing) backing.setItem(key, raw);
      } catch {
        durable = false;
      }
    },
    clear(scope, workflow, resource, expectedKey) {
      const key = intentStorageKey(scope, workflow, resource);
      if (expectedKey !== void 0) {
        const current = this.load(scope, workflow, resource);
        if (current && current.key !== expectedKey) return;
      }
      remove(key);
    },
    sweepForeignScopes(scope) {
      const mine = `${MUTATION_INTENT_PREFIX}${encodeURIComponent(scope)}|`;
      const foreign = (key) => key.startsWith(MUTATION_INTENT_PREFIX) && (scope === "anonymous" || !key.startsWith(mine));
      try {
        if (backing) {
          const doomed = [];
          for (let i = 0; i < backing.length; i++) {
            const key = backing.key(i);
            if (key !== null && foreign(key)) doomed.push(key);
          }
          for (const key of doomed) remove(key);
        }
      } catch {
        durable = false;
      }
      for (const key of [...memoryStore.keys()]) if (foreign(key)) memoryStore.delete(key);
    }
  };
}
function isIntentExpired(record, now = Date.now()) {
  const created = Date.parse(record.createdAt);
  return !Number.isFinite(created) || created > now + 5 * 6e4 || now - created > MUTATION_INTENT_TTL_MS;
}

// src/frontend-kit/domain/serviceComposer.ts
var WORKFLOW = "service-request";
function initial(durable) {
  return { command: { phase: "idle" }, intent: {
    phase: "idle",
    durable,
    record: null,
    requestId: null,
    unknownReason: null,
    reconciling: false
  }, canSubmit: false, canReplay: false };
}
var ServiceRequestComposer = class {
  constructor(api, scope, providerId, isCurrent = () => true, storage = openIntentStorage()) {
    this.api = api;
    this.scope = scope;
    this.providerId = providerId;
    this.isCurrent = isCurrent;
    this.storage = storage;
    this.resource = String(providerId);
    this.snapshot = initial(storage.durable);
  }
  api;
  scope;
  providerId;
  isCurrent;
  storage;
  snapshot;
  listeners = /* @__PURE__ */ new Set();
  active = false;
  epoch = 0;
  lookupSequence = 0;
  busy = false;
  replayReady = false;
  exact = null;
  resource;
  getSnapshot = () => this.snapshot;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  live(epoch = this.epoch) {
    return this.active && this.isCurrent() && epoch === this.epoch;
  }
  publish(patch) {
    if (!this.live()) return;
    const next = { ...this.snapshot, ...patch };
    this.snapshot = {
      ...next,
      intent: { ...next.intent, durable: this.storage.durable },
      canSubmit: !this.busy && !next.intent.reconciling && next.intent.record === null,
      canReplay: !this.busy && !next.intent.reconciling && !!next.intent.record && !!this.exact && this.replayReady
    };
    for (const listener of this.listeners) listener();
  }
  setIntent(patch) {
    this.publish({ intent: { ...this.snapshot.intent, ...patch } });
  }
  start = () => {
    if (this.active || !this.isCurrent() || this.scope === "anonymous" || !validServiceRequestId(this.providerId)) return;
    this.active = true;
    this.epoch += 1;
    this.storage.sweepForeignScopes(this.scope);
    const record = this.storage.load(this.scope, WORKFLOW, this.resource);
    if (record && isIntentExpired(record)) {
      this.storage.clear(this.scope, WORKFLOW, this.resource, record.key);
      this.setIntent({ phase: "expired", record: null });
    } else if (record) {
      this.setIntent({ phase: "unknown", record, unknownReason: "dispatch_unknown" });
      void this.reconcile();
    } else this.publish({});
  };
  dispose = () => {
    this.active = false;
    this.epoch += 1;
    this.lookupSequence += 1;
    this.exact = null;
    this.busy = false;
    this.replayReady = false;
    this.snapshot = initial(this.storage.durable);
  };
  confirm(requestId, key) {
    if (this.snapshot.intent.record?.key !== key) return;
    this.lookupSequence += 1;
    this.storage.clear(this.scope, WORKFLOW, this.resource, key);
    this.exact = null;
    this.replayReady = false;
    this.publish({
      command: { phase: "accepted", message: "Request recorded. It is not an appointment or a delivery receipt." },
      intent: { ...this.snapshot.intent, record: null, phase: "confirmed", requestId, unknownReason: null, reconciling: false }
    });
  }
  create = async (input) => {
    if (!this.live() || !this.snapshot.canSubmit || this.busy) return false;
    const existing = this.storage.load(this.scope, WORKFLOW, this.resource);
    if (existing) {
      this.setIntent({ phase: "unknown", record: existing, unknownReason: "dispatch_unknown" });
      return false;
    }
    const payload = { ...input, note: input.note?.trim(), city: input.city?.trim() ?? null };
    if (payload.provider_person_id !== this.providerId || !isServiceCategoryId(payload.category) || typeof payload.note !== "string" || payload.note.length < 10 || payload.note.length > 500 || typeof payload.share_contact !== "boolean" || (payload.city?.length ?? 0) > 120 || payload.horse_id != null && !validServiceRequestId(payload.horse_id) || payload.provider_organization_id != null || payload.province_code && (!isValidProvinceCode(payload.province_code) || payload.province_code_scheme !== PROVINCE_CODE_SCHEME)) {
      this.publish({ command: classifyCommandError(new PlatformClientError(400, "invalid_service_request", "Review the provider, category, province and a note of 10–500 characters.")) });
      return false;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const record = {
      key: crypto.randomUUID(),
      scope: this.scope,
      workflow: WORKFLOW,
      resource: this.resource,
      phase: "submitted",
      createdAt: now,
      updatedAt: now,
      summary: {
        workflow: WORKFLOW,
        provider_person_id: this.providerId,
        category: payload.category,
        share_contact: payload.share_contact,
        note_length: payload.note.length
      }
    };
    this.exact = Object.freeze(payload);
    this.storage.save(record);
    this.setIntent({ record, phase: "submitted", requestId: null, unknownReason: null });
    return this.dispatch(record);
  };
  async dispatch(record) {
    if (!this.live() || this.busy || !this.exact) return false;
    const epoch = this.epoch, payload = this.exact, wasUncertain = this.snapshot.intent.phase === "unknown";
    this.busy = true;
    this.replayReady = false;
    this.lookupSequence += 1;
    this.publish({ command: { phase: "submitting" }, intent: { ...this.snapshot.intent, phase: "submitted", reconciling: false } });
    let accepted = false;
    try {
      const result = await this.api.create(payload, { idempotencyKey: record.key });
      if (!this.live(epoch) || this.snapshot.intent.record?.key !== record.key) return false;
      if (result?.created !== true || !validServiceRequestId(result.request?.id) || result.request.provider_person_id !== payload.provider_person_id || result.request.category !== payload.category || result.request.share_contact !== payload.share_contact || typeof result.request_digest !== "string" || !result.request_digest) {
        throw new Error("The server response did not confirm this request. Recheck the exact request key.");
      }
      this.confirm(result.request.id, record.key);
      accepted = true;
    } catch (error) {
      if (!this.live(epoch) || this.snapshot.intent.record?.key !== record.key) return false;
      const command = classifyCommandError(error);
      if (!wasUncertain && command.phase === "rejected" && command.status !== 409) {
        this.storage.clear(this.scope, WORKFLOW, this.resource, record.key);
        this.exact = null;
        this.publish({ command, intent: { ...this.snapshot.intent, record: null, phase: "idle", unknownReason: null } });
      } else this.publish({ command, intent: { ...this.snapshot.intent, phase: "unknown", unknownReason: "dispatch_unknown" } });
    } finally {
      if (this.live(epoch)) {
        this.busy = false;
        this.publish({});
      }
    }
    return accepted && this.live(epoch);
  }
  reconcile = async () => {
    const record = this.snapshot.intent.record;
    if (!this.live() || this.busy || !record) return;
    const epoch = this.epoch, sequence = ++this.lookupSequence;
    this.replayReady = false;
    this.setIntent({ reconciling: true });
    const current = () => this.live(epoch) && sequence === this.lookupSequence && this.snapshot.intent.record?.key === record.key;
    try {
      const answer = await this.api.reconcileIntent(record.key);
      if (!current()) return;
      if (answer?.state === "confirmed" && validServiceRequestId(answer.request_id)) {
        this.confirm(answer.request_id, record.key);
      } else if (answer?.state === "unknown") {
        this.replayReady = !!this.exact;
        this.setIntent({ phase: "unknown", unknownReason: "no_receipt_on_server", reconciling: false });
      } else {
        this.setIntent({ phase: "unknown", unknownReason: answer?.state === "unresolved" ? "legacy_receipt_unresolved" : "invalid_receipt", reconciling: false });
      }
    } catch {
      if (current()) this.setIntent({ phase: "unknown", unknownReason: "reconcile_failed", reconciling: false });
    }
  };
  retryExact = async () => {
    const record = this.snapshot.intent.record;
    if (!this.live() || !this.snapshot.canReplay || !record) return false;
    const stored = this.storage.load(this.scope, WORKFLOW, this.resource);
    if (stored && stored.key !== record.key) {
      this.exact = null;
      this.replayReady = false;
      this.setIntent({ record: stored, phase: "unknown", unknownReason: "dispatch_unknown" });
      return false;
    }
    return this.dispatch(record);
  };
  /** UI must first explain that discarding local recovery does not cancel a request. */
  discard = () => {
    if (!this.live() || this.busy || this.snapshot.intent.reconciling) return false;
    const key = this.snapshot.intent.record?.key;
    const stored = this.storage.load(this.scope, WORKFLOW, this.resource);
    if (stored && stored.key !== key) {
      this.exact = null;
      this.replayReady = false;
      this.setIntent({ record: stored, phase: "unknown", unknownReason: "dispatch_unknown" });
      return false;
    }
    if (key) this.storage.clear(this.scope, WORKFLOW, this.resource, key);
    this.lookupSequence += 1;
    this.exact = null;
    this.replayReady = false;
    this.publish({ command: { phase: "idle" }, intent: { ...initial(this.storage.durable).intent } });
    return true;
  };
};

// src/frontend-kit/domain/mutationIntentCopy.ts
var COPY = {
  "confirmed": [
    "The server confirmed this inquiry; acceptance and notification delivery are not guaranteed.",
    "سرور ثبت این درخواست را تأیید کرد؛ پذیرش و تحویل اعلان تضمین نشده است."
  ],
  "expired": [
    "The device recovery record expired, not the server request. Check My service requests before creating another inquiry.",
    "سابقه بازیابی دستگاه منقضی شده، نه درخواست سرور. پیش از درخواست تازه، بخش درخواست‌های من را بررسی کنید."
  ],
  "no_receipt_on_server": [
    "No matching receipt is visible yet. The request may still be in flight; recheck and review My service requests before starting again.",
    "هنوز رسید مطابقی دیده نمی‌شود. ممکن است درخواست در حال پردازش باشد؛ دوباره بررسی کنید و پیش از شروع مجدد، درخواست‌های من را ببینید."
  ],
  "legacy_receipt_unresolved": [
    "An older receipt cannot be linked to one request. Review existing requests or ask support before creating another inquiry.",
    "رسید قدیمی به یک درخواست مشخص قابل انتساب نیست. پیش از ایجاد درخواست تازه، سوابق را بررسی کنید یا از پشتیبانی بپرسید."
  ],
  "dispatch_unknown": [
    "Dispatch is uncertain: a crash can occur after sending. Recheck with the server before starting again.",
    "وضعیت ارسال نامشخص است؛ ممکن است خطا پس از ارسال رخ داده باشد. پیش از شروع مجدد با سرور بررسی کنید."
  ],
  "unknown": [
    "The result cannot be verified yet. Recheck when connected; do not assume success or failure.",
    "نتیجه هنوز قابل تأیید نیست. پس از اتصال دوباره بررسی کنید؛ موفقیت یا شکست را فرض نکنید."
  ],
  "clear": [
    "Clear device recovery record",
    "پاک کردن سابقه بازیابی دستگاه"
  ],
  "clearWarning": [
    "Clearing this record does not cancel a server request. A new inquiry could create a duplicate.",
    "پاک کردن این سابقه، درخواست سرور را لغو نمی‌کند. درخواست تازه ممکن است تکراری باشد."
  ]
};
function mutationIntentCopy(key, locale) {
  const pair = COPY[key] ?? COPY.unknown;
  return kitText(locale, pair[0], pair[1]);
}

// src/frontend-kit/domain/principalIdentity.ts
function principalScopeKey(user, permissions) {
  if (!user) return "anonymous";
  const epoch = permissions && permissions.length > 0 ? `|p:${[...permissions].sort().join("+")}` : "";
  return `user:${user.id}${epoch}`;
}

// src/frontend-kit/domain/directoryDisplay.ts
function formatDirectoryLanguages(value, locale) {
  let languages;
  if (Array.isArray(value)) languages = value;
  else if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "—";
    try {
      const parsed = JSON.parse(text);
      languages = Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [text];
    } catch {
      languages = [text];
    }
  } else return "—";
  const entries = [...new Set(languages.map((item) => item.trim()).filter(Boolean))];
  return entries.map((language) => {
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) return language;
    try {
      return new Intl.DisplayNames([kitNumberTag(locale)], { type: "language", fallback: "code" }).of(language) || language;
    } catch {
      return language;
    }
  }).join(" · ") || "—";
}
export {
  IRAN_PROVINCES,
  PROVINCE_CODE_SCHEME,
  PlatformClientError,
  SERVICE_CATEGORIES,
  ServiceRequestComposer,
  ServiceRequestWorkbench,
  formatDirectoryLanguages,
  mutationIntentCopy,
  principalScopeKey,
  provinceLabel,
  serviceCategoryLabel,
  serviceRequestStatusLabel,
  serviceTransitionsFor,
  validServiceRequest,
  validServiceRequestId
};
