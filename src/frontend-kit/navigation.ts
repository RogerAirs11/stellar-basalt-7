/** Shared information architecture only. Each frontend owns its DOM and CSS. */
export type NavigationFrontend = "heritage" | "equidata-elite" | "fei-classic" | "retro-astra" | "classic-registry";
export type NavigationLayout = "tabs" | "sidebar";
export type NavigationLocale = "en" | "fa" | "fr" | "ar";
export interface NavigationLink { id: string; label: Readonly<Record<NavigationLocale, string>>; href: string; active: boolean; external: boolean }
export interface NavigationGroup { id: string; label: Readonly<Record<NavigationLocale, string>>; links: NavigationLink[] }
type Label = Readonly<Record<NavigationLocale, string>>;
// Keep this model self-contained: the Classic generator emits it as a browser module.
const NAV_TRANSLATIONS: Record<string, readonly [string, string]> = {
  "People": [
    "Personnes",
    "الأشخاص"
  ],
  "Navigation layout": [
    "Disposition de la navigation",
    "تخطيط التنقّل"
  ],
  "Automatic": [
    "Automatique",
    "تلقائي"
  ],
  "Tabs": [
    "Onglets",
    "علامات التبويب"
  ],
  "Sidebar": [
    "Barre latérale",
    "الشريط الجانبي"
  ],
  "Sidebar + tabs": [
    "Barre latérale + onglets",
    "الشريط الجانبي مع التبويبات"
  ],
  "Browse sections": [
    "Parcourir les rubriques",
    "تصفّح الأقسام"
  ],
  "Find a section": [
    "Rechercher une rubrique",
    "البحث عن قسم"
  ],
  "Clear section search": [
    "Effacer la recherche de rubrique",
    "مسح البحث عن قسم"
  ],
  "No matching section": [
    "Aucune rubrique correspondante",
    "لا يوجد قسم مطابق"
  ],
  "Registry & people": [
    "Registre et personnes",
    "السجل والأشخاص"
  ],
  "Research & breeding": [
    "Recherche et élevage",
    "البحث والتربية"
  ],
  "Market & operations": [
    "Marché et gestion",
    "السوق والإدارة"
  ],
  "Account & trust": [
    "Compte et vérification",
    "الحساب والتحقّق"
  ],
  "Explore the demo": [
    "Explorer la démonstration",
    "استكشاف العرض التجريبي"
  ],
  "Home & search": [
    "Accueil et recherche",
    "الرئيسية والبحث"
  ],
  "Horse registry": [
    "Registre des chevaux",
    "سجل الخيل"
  ],
  "Professional directory": [
    "Annuaire des professionnels",
    "دليل المختصّين"
  ],
  "Registry analytics": [
    "Analyses du registre",
    "تحليلات السجل"
  ],
  "Pedigree explorer": [
    "Explorateur de pedigrees",
    "استكشاف الأنساب"
  ],
  "Relationship comparison": [
    "Comparaison des liens de parenté",
    "مقارنة القرابة"
  ],
  "Breeding analysis": [
    "Analyse des accouplements",
    "تحليل التزاوج"
  ],
  "Research assistant": [
    "Assistant de recherche",
    "مساعد البحث"
  ],
  "Horse marketplace": [
    "Marché des chevaux",
    "سوق الخيل"
  ],
  "My marketplace desk": [
    "Mon espace marché",
    "مساحتي في السوق"
  ],
  "Issuer credentials": [
    "Attestations des organismes émetteurs",
    "وثائق جهات الإصدار"
  ],
  "Competitions": [
    "Compétitions",
    "المسابقات"
  ],
  "Stable workspaces": [
    "Espaces de gestion d’écurie",
    "مساحات إدارة الإسطبل"
  ],
  "Service requests": [
    "Demandes de services",
    "طلبات الخدمات"
  ],
  "News & updates": [
    "Actualités et nouveautés",
    "الأخبار والمستجدّات"
  ],
  "Account & access": [
    "Compte et accès",
    "الحساب والوصول"
  ],
  "Claims & corrections": [
    "Demandes de rattachement et corrections",
    "طلبات إثبات الصلة والتصحيحات"
  ],
  "Platform coverage": [
    "Fonctionnalités disponibles",
    "الميزات المتاحة"
  ],
  "Registry rankings": [
    "Classements du registre",
    "ترتيبات السجل"
  ],
  "Data quality": [
    "Qualité des données",
    "جودة البيانات"
  ],
  "Watchlist": [
    "Liste de suivi",
    "قائمة المتابعة"
  ],
  "Manage professional profile": [
    "Gérer le profil professionnel",
    "إدارة الملف المهني"
  ],
  "Manage organization": [
    "Gérer l’organisation",
    "إدارة المؤسسة"
  ],
  "Wallpaper presentation": [
    "Présentation de l’arrière-plan",
    "عرض الخلفية"
  ],
  "Pricing & business model": [
    "Tarifs et modèle économique",
    "الأسعار ونموذج العمل"
  ],
  "Management & audit (restricted)": [
    "Administration et audit (accès restreint)",
    "الإدارة والتدقيق (وصول مقيّد)"
  ],
  "Synthetic capability demo": [
    "Démonstration sur données fictives",
    "عرض للميزات ببيانات اصطناعية"
  ]
};
const L = (en: string, fa: string): Label => ({ en, fa, fr: NAV_TRANSLATIONS[en]?.[0] ?? en, ar: NAV_TRANSLATIONS[en]?.[1] ?? en });
export const NAVIGATION_LABELS = Object.freeze({
  layout: L("Navigation layout", "چیدمان منو"),
  auto: L("Automatic", "خودکار"),
  tabs: L("Tabs", "منوی بالا"),
  sidebar: L("Sidebar", "منوی کناری"),
  both: L("Sidebar + tabs", "منوی کناری و تب‌ها"),
  sections: L("Browse sections", "\u0628\u062e\u0634\u200c\u0647\u0627"),
  search: L("Find a section", "\u062c\u0633\u062a\u200c\u0648\u062c\u0648\u06cc \u0628\u062e\u0634"),
  clearSearch: L("Clear section search", "\u067e\u0627\u06a9 \u06a9\u0631\u062f\u0646 \u062c\u0633\u062a\u200c\u0648\u062c\u0648\u06cc \u0628\u062e\u0634"),
  empty: L("No matching section", "\u0628\u062e\u0634\u06cc \u06cc\u0627\u0641\u062a \u0646\u0634\u062f"),
});
const GROUP_LABELS = {
  registry: L("Registry & people", "اسب‌ها و افراد"),
  research: L("Research & breeding", "شجره‌نامه و پرورش"),
  business: L("Market & operations", "بازار و خدمات"),
  governance: L("Account & trust", "حساب و بررسی اطلاعات"),
  showcase: L("Explore the demo", "\u0646\u0645\u0627\u06cc\u0634 \u0627\u0645\u06a9\u0627\u0646\u0627\u062a"),
} as const;
type GroupId = keyof typeof GROUP_LABELS;
type RouteSet = Partial<Record<NavigationFrontend, string>>;
const local = (id: NavigationFrontend, path: string) => `/f/${id}${path}`;
const item = (id: string, group: GroupId, en: string, fa: string, routes: RouteSet, external = false) => ({ id, group, label: L(en, fa), routes, external });
// Deliberately no fabricated routes: missing native journeys are tracked in the audit.
const ITEMS = [
  item("home", "registry", "Home & search", "\u062e\u0627\u0646\u0647 \u0648 \u062c\u0633\u062a\u200c\u0648\u062c\u0648", { heritage: "/", "equidata-elite": "/", "fei-classic": "/", "retro-astra": "#/", "classic-registry": "#/home" }),
  item("horses", "registry", "Horse registry", "\u0641\u0647\u0631\u0633\u062a \u0627\u0633\u0628\u200c\u0647\u0627", { heritage: "/browse", "equidata-elite": "/browse", "fei-classic": "/browse", "retro-astra": "#/horses", "classic-registry": "#/registry" }),
  item("people", "registry", "People", "\u0627\u0641\u0631\u0627\u062f", { heritage: "/f/heritage/desk", "equidata-elite": local("equidata-elite", "/people"), "fei-classic": local("fei-classic", "/people"), "retro-astra": "#/collections/people", "classic-registry": "#/people" }),
  item("directory", "registry", "Professional directory", "\u0641\u0647\u0631\u0633\u062a \u0645\u062a\u062e\u0635\u0635\u0627\u0646", { heritage: "/directory", "equidata-elite": local("equidata-elite", "/directory"), "fei-classic": local("fei-classic", "/directory"), "retro-astra": "#/directory", "classic-registry": "#/directory" }),
  item("analytics", "research", "Registry analytics", "آمار و گزارش‌ها", { heritage: "/stats", "equidata-elite": "/stats", "fei-classic": "/stats", "retro-astra": "#/insights", "classic-registry": "#/analytics" }),
  item("pedigree", "research", "Pedigree explorer", "شجره‌نامه", { "fei-classic": local("fei-classic", "/pedigree"), "retro-astra": "#/pedigree", "classic-registry": "#/pedigree" }),
  item("compare", "research", "Relationship comparison", "مقایسه خویشاوندی", { "equidata-elite": local("equidata-elite", "/compare"), "retro-astra": "#/collections/relationships" }),
  item("breeding", "research", "Breeding analysis", "بررسی جفت‌گیری", { "equidata-elite": local("equidata-elite", "/breeding-lab"), "fei-classic": local("fei-classic", "/breeding"), "retro-astra": "#/collections/breeding", "classic-registry": "#/breeding" }),
  item("assistant", "research", "Research assistant", "\u062f\u0633\u062a\u06cc\u0627\u0631 \u067e\u0698\u0648\u0647\u0634", { heritage: "/assistant", "equidata-elite": local("equidata-elite", "/assistant"), "fei-classic": local("fei-classic", "/assistant"), "retro-astra": "#/assistant", "classic-registry": "/f/classic-registry/assistant" }),
  item("market", "business", "Horse marketplace", "\u0628\u0627\u0632\u0627\u0631 \u0627\u0633\u0628", { heritage: "/market", "equidata-elite": local("equidata-elite", "/market"), "fei-classic": local("fei-classic", "/market"), "retro-astra": "#/collections/market", "classic-registry": "#/market" }),
  // R117-15: the signed-in market lifecycle desk — the seller's own listings +
  // received inquiries, the buyer's sent inquiries and watchlist. In the
  // React skins this surface lives ON the market page itself; Classic serves
  // it as a native host-layer route beside the vanilla browse view.
  item("market-desk", "business", "My marketplace desk", "میز بازار من", { heritage: "/market", "equidata-elite": local("equidata-elite", "/market"), "fei-classic": local("fei-classic", "/market"), "retro-astra": "#/collections/market", "classic-registry": local("classic-registry", "/market-desk") }),
  // R117-16: the truthful credential-stories surface — the public read +
  // verification projections, the member-scoped issue, the owner-scoped
  // revoke/supersede and the private snapshot review.
  item("credential-desk", "governance", "Issuer credentials", "اعتبارنامه‌های مرجع", { heritage: "/horse/900000017", "equidata-elite": "/horse/900000017", "fei-classic": "/horse/900000017", "retro-astra": "#/collections/credentials", "classic-registry": local("classic-registry", "/credential-desk") }),
  item("events", "business", "Competitions", "\u0645\u0633\u0627\u0628\u0642\u0627\u062a", { heritage: "/competitions", "fei-classic": local("fei-classic", "/competitions"), "retro-astra": "#/collections/competitions" }),
  item("workspaces", "business", "Stable workspaces", "مدیریت اصطبل", { heritage: "/workspaces", "equidata-elite": local("equidata-elite", "/workspaces"), "fei-classic": local("fei-classic", "/workspaces"), "retro-astra": "#/workspaces", "classic-registry": local("classic-registry", "/workspaces") }),
  item("requests", "business", "Service requests", "درخواست خدمات", { heritage: "/services", "equidata-elite": local("equidata-elite", "/services"), "fei-classic": local("fei-classic", "/services"), "retro-astra": "#/services", "classic-registry": "#/services" }),
  item("news", "business", "News & updates", "\u0627\u062e\u0628\u0627\u0631", { heritage: "/newsroom", "equidata-elite": local("equidata-elite", "/newsroom"), "fei-classic": local("fei-classic", "/content"), "retro-astra": "#/newsroom", "classic-registry": "#/content" }),
  item("account", "governance", "Account & access", "حساب کاربری", { heritage: "/login", "equidata-elite": local("equidata-elite", "/governance"), "fei-classic": local("fei-classic", "/auth"), "retro-astra": "#/collections/governance", "classic-registry": "#/account" }),
  item("claims", "governance", "Claims & corrections", "درخواست‌ها و اصلاح اطلاعات", { heritage: "/directory/claims", "equidata-elite": local("equidata-elite", "/claims"), "fei-classic": local("fei-classic", "/workflows") }),
  item("coverage", "governance", "Platform coverage", "وضعیت امکانات", { "equidata-elite": local("equidata-elite", "/platform"), "fei-classic": local("fei-classic", "/platform") }),
  item("rankings", "research", "Registry rankings", "\u0631\u062a\u0628\u0647\u200c\u0628\u0646\u062f\u06cc", { "equidata-elite": local("equidata-elite", "/rankings"), "fei-classic": local("fei-classic", "/rankings") }),
  item("quality", "governance", "Data quality", "کیفیت اطلاعات", { "equidata-elite": local("equidata-elite", "/quality"), "fei-classic": local("fei-classic", "/quality") }),
  item("saved", "registry", "Watchlist", "\u0641\u0647\u0631\u0633\u062a \u067e\u06cc\u06af\u06cc\u0631\u06cc", { "equidata-elite": local("equidata-elite", "/watchlist") }),
  item("profile-management", "governance", "Manage professional profile", "مدیریت مشخصات حرفه‌ای", { "equidata-elite": local("equidata-elite", "/directory-profile"), "fei-classic": local("fei-classic", "/directory-profile"), "retro-astra": "#/directory-profile", "classic-registry": local("classic-registry", "/directory-profile") }),
  item("organization-management", "business", "Manage organization", "مدیریت سازمان", { "equidata-elite": local("equidata-elite", "/organization-profile"), "fei-classic": local("fei-classic", "/organization-profile"), "retro-astra": "#/organization-profile", "classic-registry": local("classic-registry", "/organization-profile") }),
  item("wallpaper", "showcase", "Wallpaper presentation", "نمای پس‌زمینه", { heritage: "/f/heritage/wallpaper" }),
  item("business-model", "showcase", "Pricing & business model", "مدل درآمد و قیمت‌گذاری", { heritage: "/business-model/", "equidata-elite": "/business-model/", "fei-classic": "/business-model/", "retro-astra": "/business-model/", "classic-registry": "/business-model/" }, true),
  item("management", "governance", "Management & audit (restricted)", "مدیریت و سوابق تغییرات", { heritage: "/admin", "fei-classic": local("fei-classic", "/management") }),
  item("demo", "showcase", "Synthetic capability demo", "نسخه نمایشی", { heritage: "/demo-workbench/", "equidata-elite": "/demo-workbench/", "fei-classic": "/demo-workbench/", "retro-astra": "/demo-workbench/", "classic-registry": "/demo-workbench/" }, true),
];
function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/\u064a/g, "\u06cc").replace(/\u0643/g, "\u06a9").replace(/[\u200c\u200d]/g, " ").replace(/\s+/g, " ").trim();
}
function routePath(value: string): string { return value.split("?", 1)[0]!.replace(/\/$/, "") || "/"; }
export function navigationGroups(frontend: NavigationFrontend, route: string, locale: NavigationLocale = "en"): NavigationGroup[] {
  const raw = routePath(route);
  // Native FEI analysis subviews share the canonical research destinations.
  const feiAliases: Record<string, string> = {
    "/f/fei-classic/analytics": "/stats",
    "/f/fei-classic/timeline": "/f/fei-classic/rankings",
    "/f/fei-classic/places": "/f/fei-classic/rankings",
  };
  const current = raw === `/f/${frontend}` ? "/" : frontend === "fei-classic" ? feiAliases[raw] ?? raw : raw;
  const links = ITEMS.flatMap(value => {
    const path = value.routes[frontend];
    if (!path) return [];
    const target = routePath(path);
    const home = ["/", "#", "#/home"].includes(target);
    const entityAlias = value.id === "horses" && (/^\/horse\/[1-9]\d*$/.test(current) || /^#\/horse\//.test(current));
    const personAlias = value.id === "people" && /^\/person\/[1-9]\d*$/.test(current);
    const active = !value.external && (entityAlias || personAlias || current === target || (!home && current.startsWith(target + "/")));
    return [{ ...value, href: value.external ? `${path}?lang=${locale}` : path, active }];
  });
  // Prefer the most-specific location (e.g. Directory / Claims) over its ancestor.
  const longest = Math.max(0, ...links.filter(link => link.active).map(link => link.href.length));
  // Some designs place the personal market desk on the market route itself.
  // One route must still have one current navigation item, not two highlights.
  const currentId = links.find(link => link.active && link.href.length === longest)?.id;
  return (Object.keys(GROUP_LABELS) as GroupId[]).map(id => ({ id, label: GROUP_LABELS[id], links: links.filter(link => link.group === id).map(({id: linkId,label,href,external}) => ({id: linkId,label,href,active: linkId === currentId,external})) })).filter(group => group.links.length);
}
export function filterNavigation(groups: readonly NavigationGroup[], query: string): NavigationGroup[] {
  const term = normalize(query).slice(0, 120);
  if (!term) return groups.map(group => ({ ...group, links: [...group.links] }));
  return groups.map(group => ({ ...group, links: normalize(Object.values(group.label).join(" ")).includes(term) ? [...group.links] : group.links.filter(link => normalize(Object.values(link.label).join(" ")).includes(term)) })).filter(group => group.links.length);
}
export function navigationStorageKey(frontend: NavigationFrontend): string { return `horse-registry:navigation:${frontend}:v1`; }
export function parseNavigationLayout(value: unknown, fallback: NavigationLayout = "tabs"): NavigationLayout { return value === "tabs" || value === "sidebar" ? value : fallback; }
export function isPlainNavigationClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}

/** Width-constrained selection shared by every renderer (including generated Classic).
 * Reserve the active tab BEFORE fitting other tabs; never append it afterwards.
 * Widths and gaps are physical CSS pixels, independent of document direction.
 * A zero-width/hidden mount retains all routes until layout becomes measurable.
 * If even the active tab cannot fit, it is retained and the renderer must truncate
 * its label (with a full accessible name) rather than lose the current location.
 */
export function fitNavigationTabs(
  widths: readonly number[], available: number, moreWidth: number,
  gap = 0, activeIndex = -1, alwaysShowMore = false,
): number[] {
  const all = widths.map((_, index) => index);
  if (!widths.length || !Number.isFinite(available) || available <= 0) return all;
  const safe = widths.map(width => Number.isFinite(width) ? Math.max(0, width) : 0);
  const spacing = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  const more = Number.isFinite(moreWidth) ? Math.max(0, moreWidth) : 96;
  const completeWidth = safe.reduce((sum, width) => sum + width, 0)
    + Math.max(0, safe.length - 1) * spacing + (alwaysShowMore ? more + spacing : 0);
  if (completeWidth <= available) return all;
  const pinned = Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < safe.length ? activeIndex : 0;
  const selected = new Set<number>([pinned]);
  let used = safe[pinned]! + more + spacing;
  for (let index = 0; index < safe.length; index++) {
    if (index === pinned) continue;
    const next = safe[index]! + spacing;
    if (used + next > available) break;
    selected.add(index); used += next;
  }
  return [...selected].sort((a, b) => a - b);
}
