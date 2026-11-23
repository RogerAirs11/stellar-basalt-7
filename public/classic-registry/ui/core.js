import { localizeDomainValue } from "./presentationState.js";
import { preferenceStorage } from "./storage.js";
import { playCue } from "./sound.js";
import { prepareModalForms } from "./modalForms.js";

export const state = {
  locale: (() => { const seed = new URLSearchParams(location.search).get("locale"); return ["en", "fa", "ar"].includes(seed) ? seed : (["fa", "ar"].includes(preferenceStorage.getItem("registry.locale")) ? preferenceStorage.getItem("registry.locale") : "en"); })(),
  density: preferenceStorage.getItem("registry.density") || "compact",
  fontPack: (()=>{const saved=preferenceStorage.getItem("registry.fontPack");return !saved||saved==="registry"?"classic":saved})(),
  palette: preferenceStorage.getItem("registry.palette") || "registry",
  appearance: preferenceStorage.getItem("registry.appearance") || "light",
  platform: null,
  auth: { user: null, csrfToken: null, permissions: [] },
  facets: null,
  route: { name: "home", params: {}, query: new URLSearchParams() },
};

const copy = {
  en: {
    app: "Equine Registry", subtitle: "Pedigree & Registry Information System", search: "Search", searchHint: "Horse name, #ID, owner, sire, dam…",
    home: "Home", registry: "Registry", people: "People", pedigree: "Pedigree", breeding: "Breeding", intelligence: "Analytics", content: "Library", account: "Account", admin: "Administration",
    language: "فارسی", density: "Density", compact: "Compact", comfortable: "Comfortable", fonts: "Fonts", signIn: "Sign in", signOut: "Sign out", demoAdmin: "Demo admin", theme: "Theme", customize: "Customize", appearance: "Appearance", light: "Light", dark: "Dark", system: "System", palette: "Color scheme", sounds: "Interface sounds", soundPack: "Sound style", volume: "Volume", resetPreferences: "Reset", previewSound: "Test", close: "Close",
    horses: "Horses", persons: "People", qualityIssues: "Open quality issues", bothParents: "Both parents recorded", dna: "DNA data", records: "records",
    openRegistry: "Open registry", explorePedigree: "Explore pedigree", breedingTools: "Breeding tools", viewAnalytics: "View analytics",
    registryIntro: "Browse the canonical horse registry with structured filters, facets and stable server-side sorting.", filters: "Filters", reset: "Reset", apply: "Apply", export: "Export", advanced: "Advanced filters",
    name: "Name", nativeName: "Native name", id: "ID", registerNo: "Register no.", year: "Year", breed: "Breed", sex: "Sex", color: "Color", place: "Birth place", sire: "Sire", dam: "Dam", owner: "Owner", breeder: "Breeder", status: "Status", strain: "Strain",
    all: "All", active: "Active", inactive: "Inactive", deceased: "Deceased", imported: "Imported", sport: "Sport", stallion: "Stallion", sportCard: "Sport card", fromYear: "From year", toYear: "To year", sort: "Sort", direction: "Direction", ascending: "Ascending", descending: "Descending",
    showing: "Showing", of: "of", previous: "Previous", next: "Next", noResults: "No matching records", noResultsHelp: "Try removing a filter or using a broader search term.",
    horseProfile: "Horse profile", overview: "Overview", family: "Family", details: "Registry details", connections: "People & roles", ancestors: "Ancestors", descendants: "Descendants", metrics: "Metrics", insights: "Insights", workflows: "Claims & changes",
    born: "Born", lifecycle: "Lifecycle", identifiers: "Identifiers", registryData: "Registry data", pedigreeData: "Pedigree data", flags: "Flags", role: "Role", current: "Current", aliases: "Aliases",
    father: "Father", mother: "Mother", unknown: "Unknown", depth: "Depth", load: "Load", coverage: "Coverage", coefficient: "Coefficient", completeness: "Completeness", uniqueAncestors: "Unique ancestors", repeatedAncestors: "Repeated ancestors",
    peopleIntro: "People linked to registry horses as owners, breeders, importers and passport receivers.", horseCount: "Horse count", roles: "Roles", profile: "Profile",
    relationship: "Relationship", relationshipIntro: "Analyze common ancestry, relationship paths and relationship coefficients between two horses.", fromHorse: "Horse A", toHorse: "Horse B", analyze: "Analyze", commonAncestors: "Common ancestors", relationshipCoefficient: "Relationship coefficient",
    pairing: "Pairing analysis", optimizer: "Mating optimizer", sireId: "Sire ID", damId: "Dam ID", fixedHorse: "Fixed horse", fixedRole: "Fixed role", candidates: "Candidate IDs", optimize: "Optimize", score: "Score", projectedCoi: "Projected COI", diversity: "Diversity",
    analytics: "Registry analytics", analyticsIntro: "Registry-wide coverage, rankings, lineage concentration and quality indicators.", quality: "Quality", refresh: "Refresh", unavailable: "Unavailable", platformHealth: "Platform health", source: "Source", contract: "Contract", capabilities: "Capabilities",
    library: "Registry library", libraryIntro: "Published registry news, articles and operational updates.", read: "Read", published: "Published", article: "Article", news: "News", update: "Update",
    accountIntro: "Authentication, ownership claims and change-request workflows.", email: "Email", password: "Password", myClaims: "My claims", myChanges: "My change requests", submitClaim: "Claim horse", requestChange: "Request change", evidence: "Evidence (JSON)", summary: "Summary", requestType: "Request type", field: "Field", proposedValue: "Proposed value", submit: "Submit",
    adminIntro: "Privileged curation, workflow review, audit and maintenance.", dashboard: "Dashboard", audit: "Audit", maintenance: "Maintenance", claims: "Claims", changeRequests: "Change requests", curation: "Horse curation", contentManager: "Content manager", reindex: "Process search reindex", reconcile: "Reconcile mutations", changes7d: "Changes · 7 days", pendingMutations: "Pending mutations", reindexJobs: "Reindex jobs", actor: "Actor", action: "Action", entity: "Entity", date: "Date", message: "Message", issue: "Issue", severity: "Severity", decision: "Decision", approve: "Approve", reject: "Reject",
    addHorse: "Add horse", editHorse: "Edit horse", archiveHorse: "Archive horse", save: "Save", cancel: "Cancel", rowVersion: "Row version", microchip: "Microchip", description: "Description",
    loading: "Loading…", retry: "Retry", error: "Something went wrong", notFound: "Page not found", backHome: "Back to home", signedInAs: "Signed in as", publicMode: "Public mode", live: "Live", stale: "Stale", ready: "Ready",
    recordsTab: "Records", competitionRecord: "Competition record", geneticTests: "Recorded genetic tests", breedingRecords: "Breeding records", publishedMedia: "Published media", registryCertificate: "View registry extract", certificateEnglish: "English version", platformReviewed: "platform-reviewed",
    starts: "Starts", wins: "Wins", podium: "Podium", eliminations: "Eliminations", rider: "Rider", result: "Result", foal: "Foal", season: "Season", file: "File", type: "Type", verification: "Recorded verification", verified: "platform-reviewed", geneticNote: "Reported laboratory data, not a diagnosis and not a genomic score.",
    noCompetitionRecord: "No competition record for this horse yet.", noGeneticTests: "No genetic test is recorded for this horse yet.", noBreedings: "No breeding events recorded.", noMedia: "No published media for this horse.",
    market: "Market", marketplace: "Marketplace", marketIntro: "Canonical sales listings from the registry. Hidden prices stay hidden; nothing here is a valuation.", listing: "Listing", noListings: "No listings right now.", askingPrice: "Asking price", priceNotPublished: "Price not published", negotiable: "negotiable", toman: "Toman", seller: "Seller", listedAt: "Listed", recordedParents: "Recorded parents", backToMarket: "Back to marketplace",
    sendInquiry: "Send inquiry", inquiryIntro: "Sign in to send an inquiry to the seller.", inquirySent: "Inquiry recorded in the platform. SMS/email delivery is not confirmed.", inquiryRequired: "Name and contact are required.", yourName: "Your name", contact: "Phone / email", note: "Note",
    reserved: "Reserved", experimental: "Experimental", stable: "Stable", privileged: "Privileged", authenticated: "Authenticated", public: "Public",
  },
  fa: {
    app: "سامانه ثبت اسب", subtitle: "سامانه اطلاعات ثبت و تبارنامه", search: "جست‌وجو", searchHint: "نام اسب، شناسه، مالک، پدر، مادر…",
    home: "خانه", registry: "دفتر ثبت", people: "اشخاص", pedigree: "تبارنامه", breeding: "اصلاح نژاد", intelligence: "تحلیل‌ها", content: "مطالب", account: "حساب", admin: "مدیریت",
    language: "English", density: "تراکم", compact: "فشرده", comfortable: "راحت", fonts: "فونت", signIn: "ورود", signOut: "خروج", demoAdmin: "مدیر آزمایشی", theme: "پوسته", customize: "شخصی‌سازی", appearance: "حالت نمایش", light: "روشن", dark: "تیره", system: "سیستم", palette: "ترکیب رنگ", sounds: "صداهای رابط", soundPack: "سبک صدا", volume: "بلندی صدا", resetPreferences: "بازنشانی", previewSound: "آزمایش", close: "بستن",
    horses: "اسب‌ها", persons: "اشخاص", qualityIssues: "موارد باز کیفیت داده", bothParents: "هر دو والد ثبت شده", dna: "داده DNA", records: "رکورد",
    openRegistry: "باز کردن دفتر", explorePedigree: "بررسی تبارنامه", breedingTools: "ابزار اصلاح نژاد", viewAnalytics: "مشاهده تحلیل‌ها",
    registryIntro: "مرور دفتر ثبت رسمی با فیلترهای ساختاریافته، دسته‌بندی و مرتب‌سازی سمت سرور.", filters: "فیلترها", reset: "پاک کردن", apply: "اعمال", export: "خروجی", advanced: "فیلترهای پیشرفته",
    name: "نام", nativeName: "نام فارسی", id: "شناسه", registerNo: "شماره ثبت", year: "سال", breed: "نژاد", sex: "جنسیت", color: "رنگ", place: "محل تولد", sire: "پدر", dam: "مادر", owner: "مالک", breeder: "پرورش‌دهنده", status: "وضعیت", strain: "تیره",
    all: "همه", active: "فعال", inactive: "غیرفعال", deceased: "تلف‌شده", imported: "وارداتی", sport: "ورزشی", stallion: "نریان", sportCard: "کارت ورزشی", fromYear: "از سال", toYear: "تا سال", sort: "مرتب‌سازی", direction: "جهت", ascending: "صعودی", descending: "نزولی",
    showing: "نمایش", of: "از", previous: "قبلی", next: "بعدی", noResults: "رکوردی پیدا نشد", noResultsHelp: "یک فیلتر را حذف کنید یا عبارت عمومی‌تری وارد کنید.",
    horseProfile: "پرونده اسب", overview: "خلاصه", family: "خانواده", details: "جزئیات ثبت", connections: "اشخاص و نقش‌ها", ancestors: "نیاکان", descendants: "نوادگان", metrics: "شاخص‌ها", insights: "بینش‌ها", workflows: "مالکیت و اصلاحات",
    born: "تولد", lifecycle: "چرخه وضعیت", identifiers: "شناسه‌ها", registryData: "داده ثبت", pedigreeData: "داده تبارنامه", flags: "نشانگر‌ها", role: "نقش", current: "فعلی", aliases: "نام‌های دیگر",
    father: "پدر", mother: "مادر", unknown: "نامشخص", depth: "عمق", load: "بارگذاری", coverage: "پوشش", coefficient: "ضریب", completeness: "کامل‌بودن", uniqueAncestors: "نیاکان یکتا", repeatedAncestors: "نیاکان تکراری",
    peopleIntro: "اشخاص مرتبط با اسب‌ها در نقش مالک، پرورش‌دهنده، واردکننده و دریافت‌کننده گذرنامه.", horseCount: "تعداد اسب", roles: "نقش‌ها", profile: "پرونده",
    relationship: "خویشاوندی", relationshipIntro: "تحلیل نیای مشترک، مسیرهای خویشاوندی و ضرایب بین دو اسب.", fromHorse: "اسب الف", toHorse: "اسب ب", analyze: "تحلیل", commonAncestors: "نیاکان مشترک", relationshipCoefficient: "ضریب خویشاوندی",
    pairing: "تحلیل جفت", optimizer: "بهینه‌ساز جفت‌گیری", sireId: "شناسه پدر", damId: "شناسه مادر", fixedHorse: "اسب ثابت", fixedRole: "نقش ثابت", candidates: "شناسه گزینه‌ها", optimize: "بهینه‌سازی", score: "امتیاز", projectedCoi: "COI پیش‌بینی‌شده", diversity: "تنوع",
    analytics: "تحلیل دفتر ثبت", analyticsIntro: "پوشش کل سامانه، رتبه‌بندی، تمرکز خطوط و شاخص‌های کیفیت.", quality: "کیفیت", refresh: "نوسازی", unavailable: "در دسترس نیست", platformHealth: "سلامت سامانه", source: "منبع", contract: "قرارداد", capabilities: "قابلیت‌ها",
    library: "مطالب سامانه", libraryIntro: "اخبار، مقاله‌ها و به‌روزرسانی‌های منتشرشده.", read: "مطالعه", published: "منتشر شده", article: "مقاله", news: "خبر", update: "به‌روزرسانی",
    accountIntro: "ورود، ادعای مالکیت و درخواست اصلاح اطلاعات.", email: "ایمیل", password: "رمز عبور", myClaims: "ادعاهای من", myChanges: "درخواست‌های من", submitClaim: "ادعای مالکیت", requestChange: "درخواست اصلاح", evidence: "مدرک (JSON)", summary: "خلاصه", requestType: "نوع درخواست", field: "فیلد", proposedValue: "مقدار پیشنهادی", submit: "ارسال",
    adminIntro: "ویرایش مدیریتی، بررسی درخواست‌ها، ممیزی و نگهداری سامانه.", dashboard: "داشبورد", audit: "ممیزی", maintenance: "نگهداری", claims: "ادعاها", changeRequests: "درخواست‌های اصلاح", curation: "ویرایش اسب", contentManager: "مدیریت محتوا", reindex: "پردازش نمایه جست‌وجو", reconcile: "تطبیق تغییرات", changes7d: "تغییرات · ۷ روز", pendingMutations: "تغییرات معلق", reindexJobs: "کارهای نمایه", actor: "کاربر", action: "عمل", entity: "رکورد", date: "تاریخ", message: "پیام", issue: "ایراد", severity: "شدت", decision: "تصمیم", approve: "تأیید", reject: "رد",
    addHorse: "افزودن اسب", editHorse: "ویرایش اسب", archiveHorse: "بایگانی اسب", save: "ذخیره", cancel: "انصراف", rowVersion: "نسخه رکورد", microchip: "میکروچیپ", description: "توضیحات",
    loading: "در حال بارگذاری…", retry: "تلاش دوباره", error: "خطایی رخ داد", notFound: "صفحه پیدا نشد", backHome: "بازگشت به خانه", signedInAs: "وارد شده با", publicMode: "حالت عمومی", live: "زنده", stale: "قدیمی", ready: "آماده",
    recordsTab: "رکوردها", competitionRecord: "سوابق مسابقات", geneticTests: "آزمون‌های ژنتیکی ثبت‌شده", breedingRecords: "سوابق تولیدمثل", publishedMedia: "رسانه منتشرشده", registryCertificate: "مشاهده استخراج اطلاعات ثبت", certificateEnglish: "نسخه انگلیسی", platformReviewed: "بررسی کارشناسان سامانه",
    starts: "شروع", wins: "برد", podium: "سکو", eliminations: "حذف", rider: "سوارکار", result: "نتیجه", foal: "کره", season: "فصل", file: "فایل", type: "نوع", verification: "وضعیت تأیید", verified: "بررسی کارشناسان سامانه", geneticNote: "داده آزمایشگاهی ثبت‌شده؛ نه تشخیص و نه امتیاز ژنومی.",
    noCompetitionRecord: "هنوز سابقه مسابقه‌ای برای این اسب ثبت نشده است.", noGeneticTests: "هنوز آزمون ژنتیکی برای این اسب ثبت نشده است.", noBreedings: "سابقه تولیدمثلی ثبت نشده است.", noMedia: "رسانه منتشرشده‌ای برای این اسب وجود ندارد.",
    market: "بازار", marketplace: "بازار اسب", marketIntro: "آگهی‌های فروش مرجع سامانه ثبت. قیمت‌های پنهان پنهان می‌مانند؛ هیچ‌چیز اینجا ارزش‌گذاری نیست.", listing: "آگهی", noListings: "در حال حاضر آگهی‌ای وجود ندارد.", askingPrice: "قیمت پیشنهادی", priceNotPublished: "قیمت منتشر نشده", negotiable: "قابل مذاکره", toman: "تومان", seller: "فروشنده", listedAt: "ثبت آگهی", recordedParents: "والدین ثبت‌شده", backToMarket: "بازگشت به بازار",
    sendInquiry: "ارسال استعلام", inquiryIntro: "برای ارسال استعلام وارد شوید.", inquirySent: "استعلام در سامانه ثبت شد؛ تحویل پیامک یا ایمیل تأیید نشده است.", inquiryRequired: "نام و راه ارتباطی الزامی است.", yourName: "نام شما", contact: "تلفن / ایمیل", note: "یادداشت",
    reserved: "رزرو شده", experimental: "آزمایشی", stable: "پایدار", privileged: "مدیریتی", authenticated: "نیازمند ورود", public: "عمومی",
  },
  ar: {
    app: "سجل الخيل",
    subtitle: "نظام معلومات الأنساب والسجل",
    search: "بحث",
    searchHint: "اسم الحصان، رقم المعرّف، المالك، الأب، الأم…",
    home: "الرئيسية",
    registry: "السجل",
    people: "الأشخاص",
    pedigree: "شجرة النسب",
    breeding: "التربية",
    intelligence: "التحليلات",
    content: "المكتبة",
    account: "الحساب",
    admin: "الإدارة",
    language: "English",
    density: "الكثافة",
    compact: "مضغوط",
    comfortable: "مريح",
    fonts: "الخطوط",
    signIn: "تسجيل الدخول",
    signOut: "تسجيل الخروج",
    demoAdmin: "مدير تجريبي",
    theme: "السمة",
    customize: "تخصيص",
    appearance: "المظهر",
    light: "فاتح",
    dark: "داكن",
    system: "النظام",
    palette: "مخطط الألوان",
    sounds: "أصوات الواجهة",
    soundPack: "نمط الصوت",
    volume: "مستوى الصوت",
    resetPreferences: "إعادة الضبط",
    previewSound: "تجربة",
    close: "إغلاق",
    horses: "الخيل",
    persons: "الأشخاص",
    qualityIssues: "مشكلات جودة مفتوحة",
    bothParents: "كلا الوالدين مسجّلان",
    dna: "بيانات DNA",
    records: "سجلات",
    openRegistry: "فتح السجل",
    explorePedigree: "استكشاف النسب",
    breedingTools: "أدوات التربية",
    viewAnalytics: "عرض التحليلات",
    registryIntro: "استعرض سجل الخيول المرجعي بمرشحات مهيكلة وأوجه وترتيبًا ثابتًا من الخادم.",
    filters: "عوامل التصفية",
    reset: "إعادة الضبط",
    apply: "تطبيق",
    export: "تصدير",
    advanced: "مرشحات متقدمة",
    name: "الاسم",
    nativeName: "الاسم الأصلي",
    id: "المعرّف",
    registerNo: "رقم التسجيل",
    year: "السنة",
    breed: "السلالة",
    sex: "الجنس",
    color: "لون المعطف",
    place: "مكان الميلاد",
    sire: "الأب",
    dam: "الأم",
    owner: "المالك",
    breeder: "المربّي",
    status: "الحالة",
    strain: "الشعبة",
    all: "الكل",
    active: "نشط",
    inactive: "غير نشط",
    deceased: "نافق",
    imported: "مستوردة",
    sport: "رياضي",
    stallion: "فحل",
    sportCard: "بطاقة رياضية",
    fromYear: "من سنة",
    toYear: "إلى سنة",
    sort: "ترتيب",
    direction: "الاتجاه",
    ascending: "تصاعدي",
    descending: "تنازلي",
    showing: "المعروض",
    of: "من",
    previous: "السابق",
    next: "التالي",
    noResults: "لا سجلات مطابقة",
    noResultsHelp: "جرّب إزالة مرشّح أو استخدام مصطلح بحث أوسع.",
    horseProfile: "ملف الحصان",
    overview: "نظرة عامة",
    family: "العائلة",
    details: "تفاصيل السجل",
    connections: "الأشخاص والأدوار",
    ancestors: "الأسلاف",
    descendants: "الذرية",
    metrics: "المقاييس",
    insights: "الرؤى",
    workflows: "المطالبات والتغييرات",
    born: "الميلاد",
    lifecycle: "دورة الحياة",
    identifiers: "المعرّفات",
    registryData: "بيانات السجل",
    pedigreeData: "بيانات النسب",
    flags: "الأعلام",
    role: "الدور",
    current: "الحالي",
    aliases: "الأسماء البديلة",
    father: "الأب",
    mother: "الأم",
    unknown: "غير معروف",
    depth: "العمق",
    load: "تحميل",
    coverage: "التغطية",
    coefficient: "المعامل",
    completeness: "الاكتمال",
    uniqueAncestors: "أسلاف متميّزون",
    repeatedAncestors: "أجداد متكررون",
    peopleIntro: "أشخاص مرتبطون بخيول السجل كمالكين ومربّين ومستوردين ومستلمي جوازات سفر.",
    horseCount: "عدد الخيول",
    roles: "الأدوار",
    profile: "الملف الشخصي",
    relationship: "القرابة",
    relationshipIntro: "حلّل النسب المشترك ومسارات القرابة ومعاملاتها بين حصانين.",
    fromHorse: "الحصان أ",
    toHorse: "الحصان ب",
    analyze: "تحليل",
    commonAncestors: "الأسلاف المشتركون",
    relationshipCoefficient: "معامل القرابة",
    pairing: "تحليل الاقتران",
    optimizer: "مُحسِّن التلقيح",
    sireId: "معرّف الأب",
    damId: "معرّف الأم",
    fixedHorse: "الحصان الثابت",
    fixedRole: "الدور الثابت",
    candidates: "معرّفات المرشحين",
    optimize: "تحسين",
    score: "النتيجة",
    projectedCoi: "معامل التزاوج الداخلي المتوقّع",
    diversity: "التنوّع",
    analytics: "تحليلات السجل",
    analyticsIntro: "تغطية السجل كاملًا وترتيبه وتركّز أنسابه ومؤشرات جودته.",
    quality: "الجودة",
    refresh: "تحديث",
    unavailable: "غير متاح",
    platformHealth: "صحة المنصة",
    source: "المصدر",
    contract: "العقد",
    capabilities: "القدرات",
    library: "مكتبة السجل",
    libraryIntro: "أخبار السجل ومقالاته وتحديثاته التشغيلية المنشورة.",
    read: "قراءة",
    published: "منشور",
    article: "مقال",
    news: "الأخبار",
    update: "تحديث",
    accountIntro: "المصادقة ومطالبات الملكية وسير طلبات التغيير.",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    myClaims: "مطالباتي",
    myChanges: "طلبات التغيير الخاصة بي",
    submitClaim: "المطالبة بحصان",
    requestChange: "طلب تغيير",
    evidence: "الدليل (JSON)",
    summary: "ملخّص",
    requestType: "نوع الطلب",
    field: "الحقل",
    proposedValue: "القيمة المقترحة",
    submit: "إرسال",
    adminIntro: "تنقيح مميّز ومراجعة سير العمل وتدقيق وصيانة.",
    dashboard: "لوحة التحكم",
    audit: "التدقيق",
    maintenance: "الصيانة",
    claims: "المطالبات",
    changeRequests: "طلبات التغيير",
    curation: "تنقيح الخيول",
    contentManager: "مدير المحتوى",
    reindex: "معالجة إعادة فهرسة البحث",
    reconcile: "مطابقة التغييرات",
    changes7d: "تغييرات · ٧ أيام",
    pendingMutations: "تغييرات معلّقة",
    reindexJobs: "مهام إعادة الفهرسة",
    actor: "الفاعل",
    action: "الإجراء",
    entity: "الكيان",
    date: "التاريخ",
    message: "الرسالة",
    issue: "مشكلة",
    severity: "الشدة",
    decision: "القرار",
    approve: "اعتماد",
    reject: "رفض",
    addHorse: "إضافة حصان",
    editHorse: "تحرير الحصان",
    archiveHorse: "أرشفة الحصان",
    save: "حفظ",
    cancel: "إلغاء",
    rowVersion: "نسخة الصف",
    microchip: "الشريحة الإلكترونية",
    description: "الوصف",
    loading: "جارٍ التحميل…",
    retry: "إعادة المحاولة",
    error: "حدث خطأ ما",
    notFound: "الصفحة غير موجودة",
    backHome: "العودة إلى الرئيسية",
    signedInAs: "مسجّل الدخول باسم",
    publicMode: "وضع علني",
    live: "مباشر",
    stale: "قديم",
    ready: "جاهز",
    recordsTab: "السجلات",
    competitionRecord: "سجل المسابقات",
    geneticTests: "الاختبارات الوراثية المسجّلة",
    breedingRecords: "سجلات التربية",
    publishedMedia: "وسائط منشورة",
    registryCertificate: "عرض مستخرج السجل",
    certificateEnglish: "النسخة الإنجليزية",
    platformReviewed: "مراجَع من المنصة",
    starts: "المشاركات",
    wins: "الفوز",
    podium: "منصة التتويج",
    eliminations: "استبعادات",
    rider: "الفارس",
    result: "النتيجة",
    foal: "مهر",
    season: "الموسم",
    file: "الملف",
    type: "النوع",
    verification: "تحقق مسجّل",
    verified: "مراجَع من المنصة",
    geneticNote: "بيانات مخبرية مُبلَّغ عنها، وليست تشخيصًا ولا نتيجة جينومية.",
    noCompetitionRecord: "لا سجل مسابقات لهذا الحصان بعد.",
    noGeneticTests: "لا اختبار وراثي مسجّل لهذا الحصان بعد.",
    noBreedings: "لا أحداث تربية مسجّلة.",
    noMedia: "لا وسائط منشورة لهذا الحصان.",
    market: "السوق",
    marketplace: "السوق",
    marketIntro: "إعلانات بيع مرجعية من السجل. الأسعار المخفية تبقى مخفية؛ ولا شيء هنا تقييمًا.",
    listing: "إعلان",
    noListings: "لا إعلانات حاليًا.",
    askingPrice: "السعر المطلوب",
    priceNotPublished: "السعر غير منشور",
    negotiable: "قابل للتفاوض",
    toman: "تومان",
    seller: "البائع",
    listedAt: "تاريخ النشر",
    recordedParents: "الوالدان المسجّلان",
    backToMarket: "العودة إلى السوق",
    sendInquiry: "إرسال الاستفسار",
    inquiryIntro: "سجّل الدخول لإرسال استفسار إلى البائع.",
    inquirySent: "سُجِّل الاستفسار في المنصة. تسليم الرسائل النصية/البريد غير مؤكد.",
    inquiryRequired: "الاسم ووسيلة التواصل مطلوبان.",
    yourName: "اسمك",
    contact: "الهاتف / البريد الإلكتروني",
    note: "ملاحظة",
    reserved: "محجوز",
    experimental: "تجريبي",
    stable: "إسطبل",
    privileged: "مميّز",
    authenticated: "تم تسجيل الدخول",
    public: "عام"
  },
};


export const FONT_PACKS = Object.freeze([
  { id: "registry", en: "Readable · Source / Vazirmatn", fa: "خوانا · وزیرمتن" },
  { id: "sahel", en: "Soft · Sahel / Source", fa: "نرم · ساحل" },
  { id: "kufi", en: "Formal · Kufi", fa: "رسمی · کوفی" },
  { id: "nastaliq", en: "Handwritten · Nastaliq accents", fa: "دستنویس · نستعلیق" },
  { id: "classic", en: "Editorial · Amiri / Georgia", fa: "کلاسیک · امیری" },
]);

export const THEME_PALETTES = Object.freeze([
  { id:"registry", en:"Registry · Blue & Sage", fa:"ثبت · آبی و سبز", swatches:["#416c88","#70805b","#a06d4e"] },
  { id:"cobalt", en:"Cobalt · Copper", fa:"کبالت · مسی", swatches:["#3f6095","#a36a42","#71869a"] },
  { id:"forest", en:"Forest · Claret", fa:"جنگلی · شرابی", swatches:["#4d7156","#8a5964","#987848"] },
  { id:"slate", en:"Slate · Amber", fa:"سنگی · کهربایی", swatches:["#566a73","#a67b36","#6f7f70"] },
  { id:"indigo", en:"Indigo · Teal", fa:"نیلی · فیروزه‌ای", swatches:["#625f91","#4d7d78","#9a6f58"] },
  { id:"plum", en:"Plum · Moss", fa:"آلویی · خزه‌ای", swatches:["#7c5d77","#69795b","#8f7049"] },
]);
export const APPEARANCE_MODES = Object.freeze(["light","dark","system"]);

export const t = (key) => copy[state.locale]?.[key] ?? copy.en[key] ?? key;
export const fa = () => state.locale === "fa";
export const isRtlLocale = () => state.locale === "fa" || state.locale === "ar";
const AR_INLINE = {
  "One-click demo administrator access is enabled in this environment.": "وصول المدير التجريبي بنقرة واحدة مُفعَّل في هذه البيئة.",
  "Permissions": "الأذونات",
  "No ownership claims yet.": "لا مطالبات ملكية بعد.",
  "No change requests yet.": "لا طلبات تغيير بعد.",
  "Signed in as demo administrator.": "تم تسجيل الدخول كمدير تجريبي.",
  "Signed out.": "تم تسجيل الخروج.",
  "Signed in successfully.": "تم تسجيل الدخول بنجاح.",
  "Administrative access required.": "وصول إداري مطلوب.",
  "Privacy queue": "قائمة الخصوصية",
  "No open issues.": "لا مشكلات مفتوحة.",
  "Create a new canonical horse record. Additional fields can be edited after creation.": "أنشئ سجل حصان مرجعيًا جديدًا. يمكن تحرير الحقول الإضافية بعد الإنشاء.",
  "Generate with AI": "توليد بالذكاء الاصطناعي",
  "New post": "منشور جديد",
  "Edit": "تعديل",
  "Preview": "معاينة",
  "Complete English edition required": "النسخة الإنجليزية الكاملة مطلوبة",
  "Publish": "نشر",
  "Retract": "سحب",
  "History": "السجل السابق",
  "Processes a bounded batch of the search reindex queue.": "يعالج دفعة محدودة من قائمة إعادة فهرسة البحث.",
  "Reconciles pending canonical mutation audit entries.": "يطابق إدخالات تدقيق التغييرات المرجعية المعلّقة.",
  "Executed — receipt recorded": "نُفِّذ — سُجِّل الإيصال",
  "Granted — blocked by active hold": "ممنوح — محجوب بتجميد نشط",
  "Granted — not yet executed": "ممنوح — لم يُنفَّذ بعد",
  "Refused — not applicable": "مرفوض — لا ينطبق",
  "Awaiting decision": "بانتظار القرار",
  "Service-request notes": "ملاحظات طلب الخدمة",
  "Service-request contact & location": "تواصل طلب الخدمة وموقعه",
  "Subject redaction queue": "قائمة حجب صاحب العلاقة",
  "The operator decision and the audited execution are separate steps. Only the executor's receipt reports completion.": "قرار المشغّل والتنفيذ المدقَّق خطوتان منفصلتان. إيصال المنفّذ وحده يُثبت الإتمام.",
  "received": "مستلم",
  "deferred": "مؤجَّل",
  "granted": "ممنوح",
  "executed": "مُنفَّذ",
  "Requests": "الطلبات",
  "Subject": "الموضوع",
  "Category": "الفئة",
  "Status": "الحالة",
  "Fulfillment": "التنفيذ",
  "untargeted": "بدون هدف محدد",
  "active hold": "تجميد نشط",
  "Execution receipt": "إيصال التنفيذ",
  "Decide": "اتخاذ قرار",
  "Execute": "تنفيذ",
  "No redaction requests have been filed.": "لم يُقدَّم أي طلب حجب.",
  "Review saved.": "حُفظت المراجعة.",
  "Horse created.": "أُنشئ الحصان.",
  "Edit post": "تحرير المنشور",
  "Cover image URL": "رابط صورة الغلاف",
  "Cover source URL": "رابط مصدر الغلاف",
  "Cover image credit": "نسب صورة الغلاف",
  "Sources — one “title | URL” per line": "المصادر — «عنوان | رابط» في كل سطر",
  "Content record metadata": "بيانات سجل المحتوى",
  "Row version": "نسخة الصف",
  "Author": "المؤلف",
  "Author user ID": "معرّف مستخدم المؤلف",
  "Created": "أُنشئ",
  "Updated": "محدّث",
  "Published": "منشور",
  "AI prompt": "توجيه الذكاء الاصطناعي",
  "Post saved.": "حُفظ المنشور.",
  "Post updated.": "حُدِّث المنشور.",
  "Published. The public newsroom serves it now.": "نُشر. تخدمه غرفة الأخبار العلنية الآن.",
  "Redaction decision": "قرار الحجب",
  "Decision": "القرار",
  "Grant (decision, not execution)": "المنح (قرار، لا تنفيذ)",
  "Refuse": "رفض",
  "Decision note (at least 10 characters)": "ملاحظة القرار (١٠ أحرف على الأقل)",
  "Execution note (optional, 10+ chars) — confirm the redaction execution:": "ملاحظة التنفيذ (اختيارية، +١٠ أحرف) — تأكيد تنفيذ الحجب:",
  "Retracted. The public newsroom no longer serves this post.": "سُحب. لم تعد غرفة الأخبار العلنية تخدم هذا المنشور.",
  "Version history": "سجل النسخ",
  "No recorded revisions.": "لا مراجعات مسجّلة.",
  "Generate bilingual content": "توليد محتوى ثنائي اللغة",
  "Topic / instruction": "الموضوع / التعليمة",
  "Use web grounding": "استخدام التأسيس على الويب",
  "AI generation is draft-only; publishing is always a separate human editor action.": "توليد الذكاء الاصطناعي للمسودات فقط؛ والنشر دائمًا إجراء منفصل لمحرر بشري.",
  "Generate": "توليد",
  "Draft generated. Review and save it before publishing.": "أُنشئت المسودة. راجعها واحفظها قبل النشر.",
  "No published content.": "لا محتوى منشور.",
  "Image source": "مصدر الصورة",
  "The English edition of this post is not complete yet — the Persian original is shown below.": "لم تكتمل النسخة الإنجليزية من هذا المنشور بعد — يُعرض الأصل الفارسي أدناه.",
  "Sources": "المصادر",
  "Content provenance": "منشأ المحتوى",
  "Model": "النموذج",
  "Generation instruction": "تعليمة التوليد",
  "A professional registry built for serious pedigree work": "سجل مهني مبني لعمل الأنساب الجاد",
  "Demonstration dataset": "مجموعة بيانات عرض",
  "Active registry": "سجل نشط",
  "horse records": "سجلات خيل",
  "linked people": "أشخاص مرتبطون",
  "Fictional records for exploring the workflows.": "سجلات افتراضية لاستكشاف سير العمل.",
  "Explore horse records, pedigrees and linked people.": "استكشف سجلات الخيول وأنسابها والأشخاص المرتبطين.",
  "Quick access": "وصول سريع",
  "Browse, filter and sort the canonical registry": "استعرض وصفِّ ورتّب السجل المرجعي",
  "Owners, breeders and other linked roles": "المالكون والمربّون وسائر الأدوار المرتبطة",
  "Ancestors, descendants and relationships": "الأجداد والسلالة والقرابات",
  "Pairing analysis and candidate optimizer": "تحليل الاقتران ومُحسِّن المرشحين",
  "Rankings, coverage and quality": "الترتيب والتغطية والجودة",
  "Claims and change requests": "المطالبات وطلبات التغيير",
  "All": "الكل",
  "Data status": "حالة البيانات",
  "No published posts yet.": "لا توجد منشورات منشورة بعد.",
  "Search index": "فهرس البحث",
  "Fictional demonstration records": "سجلات عرض افتراضية",
  "Registry records": "سجلات السجل",
  "Data source details": "تفاصيل مصدر البيانات",
  "DNA": "DNA",
  "Originality": "الأصالة",
  "Life no.": "رقم الحياة",
  "Company": "الشركة",
  "Horse SR": "SR الحصان",
  "Studbook version": "إصدارة كتاب الأنساب",
  "Imported": "مستوردة",
  "Sport horse": "حصان رياضي",
  "Sport registered": "مسجَّل رياضيًا",
  "Sport card": "بطاقة رياضية",
  "Stallion registry flag": "علم سجل الفحول",
  "Stallion approved": "فحل معتمد",
  "Death date": "تاريخ النفوق",
  "From": "من",
  "Origin code": "رمز المنشأ",
  "Export certificate": "تصدير الشهادة",
  "Passport & registry people": "جواز السفر وأشخاص السجل",
  "Passport date": "تاريخ جواز السفر",
  "Passport delivery date": "تاريخ تسليم جواز السفر",
  "Passport receiver": "مستلم جواز الخيل",
  "Owner": "المالك",
  "Breeder": "المربّي",
  "Importer": "المستورد",
  "Identity": "الهوية",
  "Registry & identifiers": "السجل والمعرّفات",
  "Origin & import": "المنشأ والاستيراد",
  "Strain & lineage": "الشعبة والنسب",
  "Complete public registry record": "سجل السجل العلني الكامل",
  "All public contract 2.13 horse fields": "كل حقول الحصان العلنية في العقد 2.13",
  "Yes": "نعم",
  "No": "لا",
  "Vertical ancestor family tree": "شجرة الأجداد الرأسية",
  "Vertical descendant family tree": "شجرة السلالة الرأسية",
  "Truncated": "مبتورة",
  "Offspring": "الذرية",
  "Repeated": "متكرر",
  "Cycle": "دورة",
  "Direct children": "الذرية المباشرة",
  "Known descendants": "الذرية المعروفة",
  "Max generation": "أقصى جيل",
  "Ancestor ID": "معرّف الجدّ",
  "Max paths": "أقصى مسارات",
  "Ancestor paths": "مسارات الأجداد",
  "Inbreeding coefficient": "معامل زواج الأقارب",
  "Premium pedigree analytics": "تحليلات النسب المتميزة",
  "Submit an ownership claim for this horse for staff review.": "أرسل مطالبة ملكية لهذا الحصان لمراجعة الطاقم.",
  "Propose a correction to this registry record.": "اقترح تصحيحًا على سجل السجل هذا.",
  "Demonstration data": "بيانات عرض توضيحي",
  "User supplied": "قدّمه المستخدم",
  "Source marked: federation": "المصدر الموسوم: اتحاد",
  "Derived record": "سجل مشتقّ",
  "Source not specified": "المصدر غير محدد",
  "Eliminated": "مستبعد",
  "Withdrawn": "منسحب",
  "Competition": "مسابقة",
  "Class": "الفئة",
  "Source": "المصدر",
  "Test": "الاختبار",
  "Reported result": "النتيجة المُبلَّغ عنها",
  "Sire": "الأب",
  "Dam": "الأم",
  "Role": "الدور",
  "Horse archived.": "أُرشف الحصان.",
  "Main strain": "خط النسب الرئيسي",
  "File number": "رقم الملف",
  "Lab number": "رقم المختبر",
  "Passport number": "رقم جواز الخيل",
  "Created at": "تاريخ الإنشاء",
  "Updated at": "آخر تحديث",
  "Canonical staff metadata": "بيانات الطاقم المرجعية",
  "Horse record saved.": "حُفظ سجل الحصان.",
  "No path found at this depth.": "لا مسار عند هذا العمق.",
  "Horse reference information": "معلومات مرجعية عن الحصان",
  "Pedigree measures": "مقاييس النسب",
  "Enter two horse IDs to begin.": "أدخل معرّفي حصانين للبدء.",
  "Direct pedigree lookup": "بحث مباشر في النسب",
  "Each horse profile contains ancestors, descendants, metrics and insights in dedicated tabs.": "يحتوي كل ملف حصان على الأجداد والسلالة والمقاييس والرؤى في تبويبات مخصصة.",
  "A depth": "عمق أ",
  "B depth": "عمق ب",
  "Total": "الإجمالي",
  "No common ancestor found at this depth.": "لا جدّ مشترك عند هذا العمق.",
  "Calculation details": "تفاصيل الحساب",
  "Pedigree-based decision support for breeding; not genetic or veterinary advice.": "دعم قرار مبني على النسب للتربية؛ وليس نصيحة وراثية أو بيطرية.",
  "COI ceiling %": "سقمع COI ٪",
  "Sire completeness": "اكتمال نسب الفحل",
  "Dam completeness": "اكتمال نسب الأم",
  "Candidate ranking": "ترتيب المرشحين",
  "Confidence": "الثقة",
  "Excluded candidates": "مرشحون مستبعدون",
  "Runtime health": "صحة التشغيل",
  "Active users": "مستخدمون نشطون",
  "Recorded parents": "الوالدان المسجّلان",
  "Top represented parents": "الآباء الأكثر تمثيلًا",
  "Data coverage": "تغطية البيانات",
  "Sex distribution": "توزيع الجنس",
  "Top breeds": "أعلى السلالات",
  "Analytics metadata": "بيانات التحليلات الوصفية",
  "Recorded-data completeness measures": "مقاييس اكتمال البيانات المسجّلة",
  "Five separate measures over the same denominator: all non-deleted canonical horse records. Recorded-data coverage only — never a verification or registry-completeness claim.": "خمس مقاييس منفصلة على المقسوم نفسه: كل سجلات الخيول المرجعية غير المحذوفة. تغطية بيانات مسجّلة فقط — وليست أبدًا ادعاء توثيق أو اكتمال سجل.",
  "Snapshot": "لمحة",
  "Covered": "مغطّى",
  "Premium analytics": "التحليلات المتميزة",
  "Identity field coverage": "تغطية حقول الهوية",
  "Recorded ancestry coverage": "تغطية الأسلاف المسجّلين",
  "Linked evidence coverage": "تغطية الأدلة المرتبطة",
  "Media coverage": "تغطية الوسائط",
  "Recorded activity coverage": "تغطية النشاط المسجّل",
  "Source file": "الملف المصدر",
  "Sheet": "الورقة",
  "Rows": "الصفوف",
  "Completed": "اكتمل",
  "Source provenance is not exposed in this environment.": "منشأ المصدر غير مكشوف في هذه البيئة.",
  "Contract, limits & provenance": "العقد والحدود والمنشأ",
  "Contract version": "إصدارة العقد",
  "Application": "التطبيق",
  "Short name": "الاسم المختصر",
  "Snapshot stale": "اللقطة قديمة",
  "Demo admin login": "دخول المدير التجريبي",
  "Available": "متاح",
  "Unavailable": "غير متاح",
  "All runtime limits & health fields": "كل حدود التشغيل وحقول الصحة",
  "Canonical import provenance": "منشأ الاستيراد المرجعي",
  "Live": "مباشر",
  "Reserved": "محجوز",
  "Platform capability map": "خريطة قدرات المنصة",
  "Contract-backed capabilities and their access surfaces": "قدرات مدعومة بالعقد وأسطح وصولها",
  "live": "حي",
  "reserved": "محجوز",
  "Person name": "اسم الشخص",
  "Passport": "جواز السفر",
  "Horse list is capped at 100 records.": "قائمة الخيول مقيدة بمئة سجل.",
  "Derived facet snapshot is stale; the platform is serving an exact live fallback for authoritative results.": "لقطة الأوجه المشتقّة قديمة؛ تخدم المنصة بديلًا حيًا دقيقًا للنتائج الموثوقة.",
  "Select the bar above to expand or collapse filters.": "اختر الشريط أعلاه لتوسيع المرشحات أو طيّها.",
  "General search": "بحث عام",
  "Imported from": "مستورد من",
  "Owner ID": "معرّف المالك",
  "Breeder ID": "معرّف المربّي",
  "Has sire": "له أب مسجّل",
  "Has dam": "له أم مسجّلة",
  "Fast indexed search across names, parents, people, breed, place and other searchable fields.": "بحث مفهرَس سريع عبر الأسماء والآباء والأشخاص والسلالة والمكان وسائر الحقول القابلة للبحث.",
  "Enter a search query.": "أدخل استعلام بحث.",
  "Structured search syntax": "صياغة البحث المهيكل",
  "Maximum length": "أقصى طول",
  "Registry field version": "إصدارة حقل السجل",
  "Combinator": "الجامع",
  "Text-search keys": "مفاتيح البحث النصي",
  "Registry browse fields": "حقول استعراض السجل",
  "Classic registry content": "محتوى السجل الكلاسيكي",
  "Skip to content": "الانتقال إلى المحتوى",
  "Primary navigation": "التنقل الرئيس",
  "Close sections": "إغلاق الأقسام",
  "More": "المزيد",
  "Horse records and pedigrees": "سجلات الخيول وأنسابها",
  "Professional directory": "دليل المختصّين",
  "Service requests": "طلبات الخدمات",
  "The Persian edition may be completed later — publishing requires the English title and body, and each language's readiness is reported separately and honestly.": "يمكن إكمال النسخة الفارسية لاحقًا — يتطلب النشر العنوان والمتن الإنجليزيين، وتُبلَّغ جاهزية كل لغة على حدة بصدق.",
  "Search, browse, pedigree, relationship intelligence and breeding analysis in one compact interface designed for long working sessions.": "بحث واستعراض ونسب وذكاء قرابات وتحليل تربية في واجهة مدمجة واحدة صُممت لجلسات عمل طويلة.",
  "This archives the canonical record. The server will refuse the operation if active descendants still reference this horse.": "هذا يؤرشف السجل المرجعي. سيرفض الخادم العملية إذا كانت سلالة نشطة ما تزال تشير إلى هذا الحصان.",
  "Example: sire:Azadi breed:Arabian owner:Rahimi — multiple fields are combined with AND semantics.": "مثال: sire:Azadi breed:Arabian owner:Rahimi — تُجمع الحقول المتعددة بدلالة AND."
};
/** R123: three-locale ternary resolver — Arabic through the authored inline dictionary, then truthful English. */
export const L3 = (en, fa) => state.locale === "fa" ? fa : state.locale === "ar" ? (Object.prototype.hasOwnProperty.call(AR_INLINE, en) ? AR_INLINE[en] : en) : en;

export const localeTag = () => state.locale === "fa" ? "fa-IR" : state.locale === "ar" ? "ar-u-nu-arab" : "en-US";
export const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
export const attr = esc;
export const domainValue = value => localizeDomainValue(value,state.locale);
export const num = (value) => value === null || value === undefined || value === "" ? "—" : new Intl.NumberFormat(localeTag()).format(Number(value));
export const pct = (value, digits = 1) => value === null || value === undefined ? "—" : `${new Intl.NumberFormat(localeTag(), { maximumFractionDigits: digits }).format(Number(value))}${isRtlLocale() ? "٪" : "%"}`;
export const date = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  return new Intl.DateTimeFormat(localeTag(), { year: "numeric", month: "short", day: "numeric" }).format(d);
};
export const yesNo = (v) => v ? (fa() ? "بله" : "Yes") : (fa() ? "خیر" : "No");
export const primaryName = (row) => fa() ? (row?.name_native || row?.name_latin || `#${row?.id ?? ""}`) : (row?.name_latin || row?.name_native || `#${row?.id ?? ""}`);
export const secondaryName = (row) => fa() ? row?.name_latin : row?.name_native;
export const hasPermission = (p) => state.auth.permissions.includes(p);
export const isEditor = () => ["editor", "admin", "super_admin"].includes(state.auth.user?.role);
export const isAdmin = () => ["admin", "super_admin"].includes(state.auth.user?.role);

export class ApiError extends Error {
  constructor(message, status, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

let authRevision = 0;
export async function api(path, options = {}) {
  const revision = authRevision;
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const init = { credentials: "same-origin", ...options, headers };
  if (options.json !== undefined) {
    init.body = JSON.stringify(options.json);
    init.headers.set("Content-Type", "application/json");
    delete init.json;
  }
  if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase()) && state.auth.csrfToken) init.headers.set("X-CSRF-Token", state.auth.csrfToken);
  const response = await fetch(path, init);
  const text = await response.text();
  if (revision !== authRevision) throw new ApiError("Session changed; reload the current view", 409, "session_superseded");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const e = data?.error;
    throw new ApiError(typeof e?.message === "string" ? e.message : `HTTP ${response.status}`, response.status, typeof e?.code === "string" ? e.code : "http_error", e?.details);
  }
  return data;
}

export async function bootstrapData() {
  applyPreferences();
  // Start the epoch before the public metadata request captures it.
  const auth = refreshAuth();
  const [platform] = await Promise.allSettled([api("/api/platform/meta"), auth]);
  if (platform.status === "fulfilled") state.platform = platform.value;
}

/** R107 NEXT-05: re-read the authoritative session from the platform.
 * Called when the EMBEDDING HOST tells us its principal changed (login,
 * logout, account switch) — the iframe itself never caches a session beyond
 * the current view. A refused/unavailable /me collapses to the public
 * session (fail closed), never to a stale principal. */
export async function refreshAuth() {
  const revision = ++authRevision;
  state.auth = { user: null, csrfToken: null, permissions: [] };
  try {
    const data = await api("/api/auth/me");
    if (revision !== authRevision) return false;
    const anonymous = data?.user === null && data?.csrfToken === null && Array.isArray(data?.permissions) && data.permissions.length === 0;
    const authenticated = data?.user && typeof data.user.id === "string" && data.user.id.length > 0
      && typeof data.user.email === "string" && typeof data.user.display_name === "string" && typeof data.user.role === "string"
      && typeof data.csrfToken === "string" && data.csrfToken.length > 0
      && Array.isArray(data.permissions) && data.permissions.every(p => typeof p === "string");
    if (!anonymous && !authenticated) throw new ApiError("Invalid session response", 502, "invalid_session_response");
    state.auth = { user: data.user, csrfToken: data.csrfToken, permissions: [...data.permissions] };
  } catch {
    if (revision !== authRevision) return false;
    state.auth = { user: null, csrfToken: null, permissions: [] };
  }
  return true;
}

export function applyPreferences() {
  const root=document.documentElement;
  state.palette=THEME_PALETTES.some((p)=>p.id===state.palette)?state.palette:"registry";
  state.appearance=APPEARANCE_MODES.includes(state.appearance)?state.appearance:"light";
  root.lang=state.locale;
  root.dir=isRtlLocale()?"rtl":"ltr";
  root.dataset.density=state.density;
  root.dataset.fontPack=FONT_PACKS.some((pack)=>pack.id===state.fontPack)?state.fontPack:"classic";
  root.dataset.palette=state.palette;
  root.dataset.appearancePreference=state.appearance;
  applyResolvedAppearance();
}
function applyResolvedAppearance(){
  const root=document.documentElement;
  const dark=state.appearance==="dark"||(state.appearance==="system"&&window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const resolved=dark?"dark":"light";
  root.dataset.appearance=resolved;
  root.style.colorScheme=resolved;
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute("content",dark?"#20292d":"#315f7d");
}
const appearanceMedia=window.matchMedia?.("(prefers-color-scheme: dark)");
appearanceMedia?.addEventListener?.("change",()=>{if(state.appearance==="system")applyResolvedAppearance()});

export function setLocale(locale) {
  state.locale = locale === "fa" ? "fa" : locale === "ar" ? "ar" : "en";
  preferenceStorage.setItem("registry.locale", state.locale);
  document.documentElement.lang = state.locale;
  document.documentElement.dir = isRtlLocale() ? "rtl" : "ltr";
}
export function toggleDensity() {
  state.density = state.density === "compact" ? "comfortable" : "compact";
  preferenceStorage.setItem("registry.density", state.density);
  document.documentElement.dataset.density = state.density;
}
export function setFontPack(fontPack) {
  state.fontPack = FONT_PACKS.some((pack) => pack.id === fontPack) ? fontPack : "classic";
  preferenceStorage.setItem("registry.fontPack", state.fontPack);
  document.documentElement.dataset.fontPack = state.fontPack;
}

export function setPalette(palette) {
  state.palette = THEME_PALETTES.some((p) => p.id === palette) ? palette : "registry";
  preferenceStorage.setItem("registry.palette", state.palette);
  document.documentElement.dataset.palette = state.palette;
}
export function setAppearance(appearance) {
  state.appearance = APPEARANCE_MODES.includes(appearance) ? appearance : "light";
  preferenceStorage.setItem("registry.appearance", state.appearance);
  document.documentElement.dataset.appearancePreference = state.appearance;
  applyResolvedAppearance();
}
export function resetVisualPreferences() {
  state.palette="registry"; state.appearance="light"; state.density="compact"; state.fontPack="classic";
  for(const key of ["registry.palette","registry.appearance","registry.density","registry.fontPack"])preferenceStorage.removeItem(key);
  applyPreferences();
}

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "") || "home";
  const [pathPart, queryPart = ""] = raw.split("?");
  let parts;
  try { parts = pathPart.split("/").filter(Boolean).map(decodeURIComponent); }
  catch { state.route = { name: "not-found", params: {}, rest: [], query: new URLSearchParams() }; return state.route; }
  const [name = "home", ...rest] = parts;
  const params = {};
  if (["horse", "person", "post", "market", "directory", "services"].includes(name)) params.id = rest[0];
  state.route = { name, params, rest, query: new URLSearchParams(queryPart) };
  return state.route;
}
export function go(path, query) {
  const qs = query instanceof URLSearchParams ? query.toString() : query ? new URLSearchParams(query).toString() : "";
  location.hash = `#/${path}${qs ? `?${qs}` : ""}`;
}

export function pageHead(title, subtitle = "", actions = "", breadcrumb = "") {
  return `${breadcrumb ? `<div class="breadcrumb">${breadcrumb}</div>` : ""}<div class="page-head"><div><h1 class="page-title">${esc(title)}</h1>${subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : ""}</div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
}
export const panel = (title, body, opts = {}) => `<section class="panel ${opts.className || ""}">${title ? `<header class="panel-head"><h2 class="panel-title">${title}</h2>${opts.actions || ""}</header>` : ""}<div class="panel-body">${body}</div>${opts.foot ? `<footer class="panel-foot">${opts.foot}</footer>` : ""}</section>`;
export const stat = (label, value, note = "", cls = "") => `<div class="stat ${cls}"><div class="stat-label">${esc(label)}</div><div class="stat-value">${value}</div>${note ? `<div class="stat-note">${esc(note)}</div>` : ""}</div>`;
export const badge = (text, cls = "") => `<span class="badge ${cls}">${esc(text)}</span>`;
export const field = (name, label, value = "", type = "text", extra = "") => `<div class="field"><label for="${attr(name)}">${esc(label)}</label><input id="${attr(name)}" name="${attr(name)}" type="${attr(type)}" value="${attr(value)}" ${extra}></div>`;
export const select = (name, label, options, value = "", extra = "") => `<div class="field"><label for="${attr(name)}">${esc(label)}</label><select id="${attr(name)}" name="${attr(name)}" ${extra}>${options.map(([v,l]) => `<option value="${attr(v)}" ${String(v)===String(value)?"selected":""}>${esc(l)}</option>`).join("")}</select></div>`;
export const empty = (title, help = "") => `<div class="empty"><strong>${esc(title)}</strong>${help ? `<div>${esc(help)}</div>` : ""}</div>`;
export const loading = () => `<div class="loading"><div><div class="spinner"></div>${esc(t("loading"))}</div></div>`;
export const errorBox = (err, retryAction = "") => `<div class="error-box"><strong>${esc(t("error"))}</strong><div>${esc(err?.message || String(err))}</div>${retryAction ? `<button class="btn btn-small mt-3" data-action="${attr(retryAction)}">${esc(t("retry"))}</button>` : ""}</div>`;

export function horseLink(row, label) { return `<a href="#/horse/${Number(row.id)}">${esc(label ?? primaryName(row))}</a>`; }
export function personLink(row, label) { return `<a href="#/person/${Number(row.id)}">${esc(label ?? primaryName(row))}</a>`; }
export function lifecycleBadge(h) {
  if (Number(h?.is_dead)) return badge(t("deceased"), "bad");
  if (Number(h?.is_active)) return badge(t("active"), "good");
  return badge(t("inactive"), "warn");
}
export function horseFlags(h) {
  return [
    Number(h?.is_imported) ? badge(t("imported"), "info") : "",
    Number(h?.is_sport) ? badge(t("sport"), "violet") : "",
    Number(h?.is_stallion) ? badge(t("stallion"), "warn") : "",
    Number(h?.has_sport_card) ? badge(t("sportCard"), "good") : "",
  ].filter(Boolean).join(" ");
}
export function kv(items) {
  return `<dl class="kv-list">${items.filter(([,v]) => v !== undefined).map(([k,v]) => `<div class="kv"><dt>${esc(k)}</dt><dd>${v === null || v === "" ? "—" : v}</dd></div>`).join("")}</dl>`;
}
export function toast(message, kind = "good") {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const el = document.createElement("div"); el.className = `toast ${kind}`; el.textContent = message; stack.append(el);
  playCue(kind === "bad" ? "error" : kind === "warn" ? "warning" : "success");
  setTimeout(() => el.remove(), 4200);
}
export function modal(title, body, foot = "") {
  const dialog = document.getElementById("modal");
  const slot = document.getElementById("modal-body");
  const previous = dialog.contains(document.activeElement) ? document.activeElement : null;
  const previousId = previous?.id;
  const wasOpen = dialog.open;
  delete dialog.dataset.horseRequest;
  dialog.removeAttribute('aria-busy');
  dialog.setAttribute('aria-labelledby', 'classic-modal-title');
  slot.innerHTML = `<header class="modal-head"><strong id="classic-modal-title">${esc(title)}</strong><button type="button" class="btn btn-small" data-action="close-modal" aria-label="${esc(t("cancel"))}">×</button></header><div class="modal-body">${body}</div>${foot ? `<footer class="modal-foot">${foot}</footer>` : ""}`;
  prepareModalForms(slot);
  if (!wasOpen) dialog.showModal();
  const restored = previousId ? document.getElementById(previousId) : null;
  const target = restored && !restored.disabled ? restored : wasOpen ? slot.querySelector('[role="alert"], [role="status"]') : slot.querySelector('form input:not([type="hidden"]):not([disabled]), form textarea:not([disabled]), form select:not([disabled])');
  if (target) { if (!target.matches('input,select,textarea,button,a')) target.tabIndex = -1; target.focus({ preventScroll: true }); }
  playCue("open");
}
export function closeModal() { document.getElementById("modal")?.close(); playCue("close"); }

export function toQuery(form) {
  const data = new FormData(form); const q = new URLSearchParams();
  for (const [k,v] of data.entries()) if (String(v).trim() !== "") q.set(k, String(v).trim());
  return q;
}

export function renderJson(value, depth = 0) {
  if (value === null) return `<span class="value">null</span>`;
  if (typeof value !== "object") return `<span class="value">${esc(typeof value === "string" ? value : JSON.stringify(value))}</span>`;
  const entries = Array.isArray(value) ? value.map((v,i)=>[i,v]) : Object.entries(value);
  if (!entries.length) return `<span class="value">${Array.isArray(value)?"[]":"{}"}</span>`;
  return `<div class="json-tree">${entries.map(([k,v]) => typeof v === "object" && v !== null ? `<details ${depth < 1 ? "open" : ""}><summary><span class="key">${esc(k)}</span></summary>${renderJson(v, depth+1)}</details>` : `<div><span class="key">${esc(k)}</span>: ${renderJson(v, depth+1)}</div>`).join("")}</div>`;
}

export function capabilityAvailable(key) { return Boolean(state.platform?.capabilities?.[key]); }
export function roleLabel(role) {
  const m = fa() ? { owner:"مالک", breeder:"پرورش‌دهنده", importer:"واردکننده", passport_receiver:"دریافت‌کننده گذرنامه" } : { owner:"Owner", breeder:"Breeder", importer:"Importer", passport_receiver:"Passport receiver" };
  return m[role] || role;
}
