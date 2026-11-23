import { HORSES, IMG, RIDERS, DISCIPLINE_L, type Discipline, type PerfYear } from './data';
import { L } from './i18n';

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================= riders ================= */
export interface Rider {
  id: string;
  name: L;
  from: L;
  discipline: Discipline;
  pts: number;
  photo?: number;
  level: L;
  age: number;
  starts: number;
  wins: number;
  podiums: number;
  club: L;
  horses: string[];
  perf: PerfYear[];
  trend: number;
}

const FIRST: [string, string][] = [['Sara', 'سارا'], ['Kian', 'کیان'], ['Neda', 'ندا'], ['Armin', 'آرمین'], ['Mina', 'مینا'], ['Reza', 'رضا'], ['Leila', 'لیلا'], ['Pouya', 'پویا'], ['Parastoo', 'پرستو'], ['Omid', 'امید'], ['Elnaz', 'الناز'], ['Hamed', 'حامد'], ['Tara', 'تارا'], ['Behnam', 'بهنام'], ['Niloufar', 'نیلوفر'], ['Saman', 'سامان'], ['Roya', 'رویا'], ['Arash', 'آرش'], ['Maryam', 'مریم'], ['Dariush', 'داریوش']];
const LAST: [string, string][] = [['Rahimi', 'رحیمی'], ['Mohseni', 'محسنی'], ['Farhadi', 'فرهادی'], ['Tavakoli', 'توکلی'], ['Ghasemi', 'قاسمی'], ['Karimi', 'کریمی'], ['Jafari', 'جعفری'], ['Najafi', 'نجفی'], ['Hosseini', 'حسینی'], ['Sadeghi', 'صادقی'], ['Abbasi', 'عباسی'], ['Zandi', 'زندی'], ['Bagheri', 'باقری'], ['Shokri', 'شکری'], ['Mirzaei', 'میرزایی'], ['Yazdani', 'یزدانی']];
const REGIONS: L[] = [L('Tehran', 'تهران'), L('Isfahan', 'اصفهان'), L('Shiraz', 'شیراز'), L('Gorgan', 'گرگان'), L('Sanandaj', 'سنندج'), L('Tabriz', 'تبریز'), L('Mashhad', 'مشهد'), L('Karaj', 'کرج'), L('Rasht', 'رشت'), L('Yazd', 'یزد')];
const CLUBS: L[] = [L('Azadi Equestrian Club', 'باشگاه سوارکاری آزادی'), L('Alborz Riding Club', 'باشگاه سوارکاری البرز'), L('Pars Equestrian', 'سوارکاری پارس'), L('Caspian Riders', 'سواران خزر'), L('Zagros Horse Club', 'باشگاه اسب زاگرس'), L('Khorasan Riders', 'سواران خراسان')];
const LEVELS: L[] = [L('International · CEI/CSI', 'بین‌المللی'), L('National · Elite', 'ملی · نخبه'), L('National · Open', 'ملی · آزاد'), L('Regional', 'منطقه‌ای'), L('Junior', 'نوجوانان')];
const DISCS: Discipline[] = ['jumping', 'dressage', 'endurance'];

const perfOf = (r: () => number, base: number): PerfYear[] =>
  [2022, 2023, 2024, 2025].map((year, i) => {
    const starts = Math.max(3, Math.round(base * (0.6 + i * 0.15 + r() * 0.3)));
    return { year, starts, podiums: Math.max(1, Math.min(starts - 1, Math.round(starts * (0.25 + i * 0.07 + r() * 0.15)))) };
  });

const rr = rng(777);
const topExtra: Record<string, Partial<Rider>> = {
  sara: { discipline: 'jumping', level: LEVELS[0], age: 29, starts: 41, wins: 14, club: CLUBS[0], horses: ['persian-star', 'arash'] },
  kian: { discipline: 'jumping', level: LEVELS[0], age: 33, starts: 38, wins: 11, club: CLUBS[2], horses: ['arash', 'persian-star'] },
  neda: { discipline: 'dressage', level: LEVELS[1], age: 27, starts: 33, wins: 12, club: CLUBS[1], horses: ['nika', 'simorgh'] },
  armin: { discipline: 'endurance', level: LEVELS[1], age: 36, starts: 30, wins: 8, club: CLUBS[3], horses: ['ramin', 'atash'] },
  mina: { discipline: 'endurance', level: LEVELS[1], age: 31, starts: 29, wins: 9, club: CLUBS[4], horses: ['shabrang', 'yaas'] },
};
const base: Rider[] = RIDERS.map((x, i) => {
  const t = topExtra[x.id];
  return {
    id: x.id, name: x.name, from: x.from, photo: x.photo, pts: x.pts, discipline: t.discipline!, level: t.level!, age: t.age!, starts: t.starts!, wins: t.wins!,
    podiums: Math.round(t.starts! * 0.5), club: t.club!, horses: t.horses!, perf: perfOf(rr, 8), trend: 3 - i,
  };
});
const extra: Rider[] = Array.from({ length: 72 }, (_, k) => {
  const f = FIRST[Math.floor(rr() * FIRST.length)], l = LAST[Math.floor(rr() * LAST.length)];
  const pts = Math.round(930 - k * 11 - rr() * 25);
  const starts = 8 + Math.floor(rr() * 30);
  const wins = Math.floor(starts * (0.05 + rr() * 0.25));
  return {
    id: `r${k + 1}`, name: L(`${f[0]} ${l[0]}`, `${f[1]} ${l[1]}`), from: REGIONS[Math.floor(rr() * REGIONS.length)], discipline: DISCS[Math.floor(rr() * 3)],
    pts, level: LEVELS[k < 12 ? 1 : k < 35 ? 2 : k < 58 ? 3 : 4], age: 17 + Math.floor(rr() * 26), starts, wins, podiums: Math.max(wins, Math.floor(starts * (0.25 + rr() * 0.3))),
    club: CLUBS[Math.floor(rr() * CLUBS.length)], horses: [HORSES[Math.floor(rr() * HORSES.length)].id, HORSES[Math.floor(rr() * HORSES.length)].id], perf: perfOf(rr, starts / 3), trend: Math.floor(rr() * 9) - 4,
  };
});
export const ALL_RIDERS: Rider[] = [...base, ...extra].sort((a, b) => b.pts - a.pts);

/* ================= breeders ================= */
export interface Breeder {
  id: string;
  name: L;
  location: L;
  founded: number;
  horses: number;
  foals: number;
  rating: number;
  verified: boolean;
  licensed: boolean;
  breeds: number[];
  notable: string[];
  contact: string;
}
const BPRE: [string, string][] = [['Tehran', 'تهران'], ['Gorgan', 'گرگان'], ['Isfahan', 'اصفهان'], ['Fars', 'فارس'], ['Zagros', 'زاگرس'], ['Caspian', 'خزر'], ['Khuzestan', 'خوزستان'], ['Alborz', 'البرز'], ['Mazandaran', 'مازندران'], ['Kerman', 'کرمان'], ['Hamadan', 'همدان'], ['Tabriz', 'تبریز'], ['Yazd', 'یزد'], ['Qom', 'قم'], ['Kurdistan', 'کردستان'], ['Khorasan', 'خراسان']];
const BKIND: [string, string, string, string][] = [['Stud Farm', 'اصطبل پرورش', 'Arabian', 'عرب'], ['Heritage Stud', 'اصطبل میراث', 'Turkoman', 'ترکمن'], ['Equine Farm', 'مزرعه اسب', 'Darashouri', 'داراشوری'], ['Stud', 'اصطبل', 'Kurdish', 'کُرد']];
const rb = rng(31337);
export const BREEDERS: Breeder[] = Array.from({ length: 48 }, (_, k) => {
  const p = BPRE[k % BPRE.length], kind = BKIND[Math.floor(rb() * BKIND.length)];
  const horses = 12 + Math.floor(rb() * 160);
  return {
    id: `b${k + 1}`, name: L(`${p[0]} ${kind[0]}`, `${kind[1]} ${p[1]}`), location: REGIONS[Math.floor(rb() * REGIONS.length)], founded: 1965 + Math.floor(rb() * 52),
    horses, foals: Math.max(3, Math.round(horses * (0.12 + rb() * 0.1))), rating: Math.round((3.4 + rb() * 1.6) * 10) / 10, verified: rb() < 0.85, licensed: rb() < 0.9,
    breeds: [Math.floor(rb() * 5), Math.floor(rb() * 5)], notable: [HORSES[Math.floor(rb() * 40)].id, HORSES[Math.floor(rb() * 40)].id, HORSES[Math.floor(rb() * 40)].id],
    contact: `info@${p[0].toLowerCase()}-stud.ir`,
  };
}).sort((a, b) => b.horses - a.horses);

/* ================= news ================= */
export type NewsCat = 'registry' | 'breeding' | 'sport' | 'services' | 'community';
export interface News {
  id: string;
  date: string;
  cat: NewsCat;
  title: L;
  body: L;
  photo: number;
  author: L;
  min: number;
  featured?: boolean;
}
export const NEWS_CAT: Record<NewsCat, { l: L; phase: 'registry' | 'breeding' | 'sport' | 'services' | 'people' }> = {
  registry: { l: L('Registry', 'ثبت'), phase: 'registry' },
  breeding: { l: L('Breeding', 'پرورش'), phase: 'breeding' },
  sport: { l: L('Sport', 'ورزش'), phase: 'sport' },
  services: { l: L('Services', 'خدمات'), phase: 'services' },
  community: { l: L('Community', 'جامعه'), phase: 'people' },
};
const AU = { a: L('Editorial desk', 'تحریریه'), b: L('Federation press office', 'روابط عمومی فدراسیون'), c: L('Registry office', 'دفتر ثبت'), d: L('Genetics lab', 'آزمایشگاه ژنتیک') };
export const NEWS: News[] = [
  { id: 'n1', date: '2025-04-10', cat: 'registry', featured: true, photo: IMG.arabianProfile, author: AU.c, min: 4,
    title: L('Digital passports now mandatory for all new registrations', 'گذرنامه دیجیتال برای همه ثبت‌های جدید اجباری شد'),
    body: L('From next month every newly registered horse receives a tamper-proof digital passport linked to its microchip and federation record. Existing passports will be migrated automatically over the next twelve months. Owners can verify and download theirs from the Documents tab of any horse profile.',
      'از ماه آینده هر اسب تازه ثبت‌شده یک گذرنامه دیجیتال غیرقابل جعل متصل به میکروچیپ و پرونده فدراسیون دریافت می‌کند. گذرنامه‌های موجود طی دوازده ماه آینده به‌صورت خودکار منتقل می‌شوند. مالکان می‌توانند از زبانه مدارک هر اسب آن را بررسی و دریافت کنند.') },
  { id: 'n2', date: '2025-04-08', cat: 'sport', photo: IMG.jumping, author: AU.b, min: 3,
    title: L('Persian Star wins the National Show Jumping Championship', 'ستاره پارسی قهرمان مسابقات ملی پرش شد'),
    body: L('In a thrilling jump-off at the Tehran Equestrian Centre, Persian Star and Sara Rahimi clinched the national title with a clear round in record time. Arash and Kian Mohseni finished second.',
      'در یک پرش تعیین‌کننده در مرکز سوارکاری تهران، ستاره پارسی و سارا رحیمی با یک دور بدون خطا در زمانی رکوردی عنوان قهرمانی ملی را کسب کردند. آرش و کیان محسنی دوم شدند.') },
  { id: 'n3', date: '2025-04-05', cat: 'breeding', photo: IMG.pair, author: AU.d, min: 5,
    title: L('New mating advisor shows inbreeding risk across six generations', 'مشاور جدید جفت‌گیری ریسک هم‌خونی را در شش نسل نشان می‌دهد'),
    body: L('Breeders can now compare any stallion and mare, view shared ancestors and see the estimated inbreeding coefficient before deciding. Coat colour probabilities and carrier alerts for hereditary conditions are included.',
      'پرورش‌دهندگان اکنون می‌توانند هر اسب نر و مادیان را مقایسه کنند، نیاکان مشترک را ببینند و پیش از تصمیم ضریب هم‌خونی تخمینی را مشاهده کنند. احتمال رنگ پوشش و هشدار ناقلین بیماری‌های ارثی نیز در دسترس است.') },
  { id: 'n4', date: '2025-04-02', cat: 'services', photo: IMG.pasture, author: AU.a, min: 3,
    title: L('Verified marketplace opens with 5 inspected listings', 'بازار تأییدشده با ۵ آگهی بازرسی‌شده آغاز به کار کرد'),
    body: L('Every listing on the new marketplace is checked against the national registry, so buyers can rely on identity, ownership and health records before they enquire.',
      'هر آگهی در بازار جدید با ثبت ملی تطبیق داده می‌شود تا خریداران پیش از پرس‌وجو بتوانند به سوابق هویت، مالکیت و سلامت اعتماد کنند.') },
  { id: 'n5', date: '2025-03-29', cat: 'community', photo: IMG.riderA, author: AU.a, min: 6,
    title: L('Rider profile: Sara Rahimi on preparing a champion', 'پروفایل سوارکار: سارا رحیمی و آماده‌سازی یک قهرمان'),
    body: L('The reigning national jumping champion talks about training routines, her partnership with Persian Star and the road to international competition.',
      'قهرمان فعلی پرش کشور از برنامه‌های تمرینی، همراهی‌اش با ستاره پارسی و مسیر رسیدن به مسابقات بین‌المللی می‌گوید.') },
  { id: 'n6', date: '2025-03-25', cat: 'registry', photo: IMG.herd, author: AU.c, min: 2,
    title: L('Duplicate-record detection now runs on every submission', 'تشخیص رکورد تکراری اکنون برای هر ثبت اجرا می‌شود'),
    body: L('The registry now compares name, microchip and parentage with existing records and warns officers before a possible duplicate is approved.',
      'ثبت ملی اکنون نام، میکروچیپ و والدین را با رکوردهای موجود مقایسه می‌کند و پیش از تأیید رکورد احتمالی تکراری به کارشناسان هشدار می‌دهد.') },
  { id: 'n7', date: '2025-03-20', cat: 'sport', photo: IMG.jumping3, author: AU.b, min: 3,
    title: L('Persian Gulf Endurance 160 opens entries', 'ثبت‌نام استقامت ۱۶۰ خلیج فارس آغاز شد'),
    body: L('Entries are open for the 160 km endurance ride on the Bushehr coastal track. Vet-gate protocols and welfare rules have been updated for 2025.',
      'ثبت‌نام سواری استقامت ۱۶۰ کیلومتر در مسیر ساحلی بوشهر آغاز شد. پروتکل‌های ایست‌های دامپزشکی و قوانین رفاه حیوان برای ۲۰۲۵ به‌روز شده است.') },
  { id: 'n8', date: '2025-03-14', cat: 'breeding', photo: IMG.pasture, author: AU.d, min: 4,
    title: L('HYPP carrier screening recommended for stallions', 'غربالگری ناقلین HYPP برای اسب‌های نر توصیه شد'),
    body: L('The genetics lab recommends screening all breeding stallions for HYPP. Results appear on the horse profile and are factored into mating advice.',
      'آزمایشگاه ژنتیک غربالگری همه اسب‌های نر مولد را برای HYPP توصیه می‌کند. نتایج در پروفایل اسب نمایش داده می‌شود و در مشاوره جفت‌گیری لحاظ می‌گردد.') },
  { id: 'n9', date: '2025-03-09', cat: 'services', photo: IMG.jumping2, author: AU.a, min: 3,
    title: L('Licensed transport network expands to 18 provinces', 'شبکه حمل‌ونقل دارای مجوز به ۱۸ استان گسترش یافت'),
    body: L('Welfare-approved horse transporters can now be booked through the platform in 18 provinces, with live tracking planned for later this year.',
      'حمل‌کنندگان اسب دارای تأیید رفاه اکنون در ۱۸ استان از طریق پلتفرم قابل رزرو هستند و ردیابی زنده برای اواخر امسال برنامه‌ریزی شده است.') },
  { id: 'n10', date: '2025-03-02', cat: 'community', photo: IMG.riderB, author: AU.a, min: 5,
    title: L('Youth riders programme welcomes 300 new members', 'برنامه سوارکاران نوجوان ۳۰۰ عضو جدید پذیرفت'),
    body: L('The national youth programme pairs young riders with certified coaches and calm, verified horses across 12 clubs.',
      'برنامه ملی نوجوانان، سوارکاران جوان را با مربیان دارای گواهی و اسب‌های آرام و تأییدشده در ۱۲ باشگاه همراه می‌کند.') },
];

export { DISCIPLINE_L };

/* ================= vets, labs, clubs, organisers ================= */
export type OrgKind = 'club' | 'vet' | 'lab' | 'organizer' | 'trainer' | 'authority' | 'transport';
export const ORG_KIND: Record<OrgKind, { l: L; pl: L; tone: string }> = {
  club: { l: L('Club', 'باشگاه'), pl: L('Clubs', 'باشگاه‌ها'), tone: 'indigo' },
  vet: { l: L('Veterinarian', 'دامپزشک'), pl: L('Veterinarians', 'دامپزشکان'), tone: 'green' },
  lab: { l: L('Genetics lab', 'آزمایشگاه ژنتیک'), pl: L('Genetics labs', 'آزمایشگاه‌ها'), tone: 'fuchsia' },
  organizer: { l: L('Event organiser', 'برگزارکننده'), pl: L('Organisers', 'برگزارکنندگان'), tone: 'amber' },
  trainer: { l: L('Trainer', 'مربی'), pl: L('Trainers', 'مربیان'), tone: 'sky' },
  authority: { l: L('Official body', 'نهاد رسمی'), pl: L('Official bodies', 'نهادهای رسمی'), tone: 'violet' },
  transport: { l: L('Transport', 'حمل‌ونقل'), pl: L('Transport', 'حمل‌ونقل'), tone: 'teal' },
};
export interface Org { id: string; kind: OrgKind; name: L; city: L; licensed: boolean; since: number; services: L[]; contact: string; rating: number; a: number; b: number }
const rO = rng(9091);
const mkOrgs = (kind: OrgKind, names: [string, string][], svc: L[], n = 0): Org[] =>
  names.map((nm, i) => ({
    id: `o-${kind}-${i}`, kind, name: L(nm[0], nm[1]), city: REGIONS[Math.floor(rO() * REGIONS.length)], licensed: rO() < 0.92, since: 1990 + Math.floor(rO() * 33), rating: Math.round((3.6 + rO() * 1.4) * 10) / 10,
    services: svc.filter(() => rO() < 0.7).slice(0, 3).concat(svc[0]).filter((v, k, a) => a.indexOf(v) === k), contact: `${kind}${i + n}@equine.ir`, a: 20 + Math.floor(rO() * 800), b: 3 + Math.floor(rO() * 60),
  }));
export const ORGS: Org[] = [
  ...mkOrgs('vet', [['Tehran Equine Clinic', 'کلینیک اسب تهران'], ['Dr. Mehdi Karimi', 'دکتر مهدی کریمی'], ['Isfahan Equine Hospital', 'بیمارستان اسب اصفهان'], ['Fars Veterinary Centre', 'مرکز دامپزشکی فارس'], ['Dr. Leila Bagheri', 'دکتر لیلا باقری'], ['Gorgan Horse Clinic', 'کلینیک اسب گرگان']], [L('Vaccination', 'واکسیناسیون'), L('Lameness exams', 'معاینه لنگش'), L('Reproduction & foaling', 'تولیدمثل و زایمان'), L('Pre-purchase exams', 'معاینه پیش از خرید'), L('Microchipping', 'میکروچیپ')]),
  ...mkOrgs('lab', [['National Equine Genetics Lab', 'آزمایشگاه ملی ژنتیک اسب'], ['Pars Genomics', 'ژنومیکس پارس'], ['Zagros DNA Lab', 'آزمایشگاه DNA زاگرس']], [L('STR parentage', 'والدسنجی STR'), L('Coat colour panel', 'پنل رنگ پوشش'), L('Disease panels', 'پنل بیماری‌ها'), L('SNP genotyping (pilot)', 'ژنوتایپینگ SNP (آزمایشی)')]),
  ...mkOrgs('club', [['Azadi Equestrian Club', 'باشگاه سوارکاری آزادی'], ['Alborz Riding Club', 'باشگاه سوارکاری البرز'], ['Pars Equestrian', 'سوارکاری پارس'], ['Caspian Riders', 'سواران خزر'], ['Zagros Horse Club', 'باشگاه اسب زاگرس'], ['Khorasan Riders', 'سواران خراسان'], ['Tabriz Equestrian Centre', 'مرکز سوارکاری تبریز'], ['Yazd Desert Stables', 'اصطبل‌های کویر یزد']], [L('Boarding', 'نگهداری'), L('Lessons', 'آموزش'), L('Show jumping', 'پرش'), L('Dressage', 'درساژ'), L('Endurance', 'استقامت')]),
  ...mkOrgs('organizer', [['Iran Equestrian Federation events', 'رویدادهای فدراسیون'], ['Tehran Show Committee', 'کمیته مسابقات تهران'], ['Gulf Endurance Organisers', 'برگزارکنندگان استقامت خلیج فارس']], [L('Show jumping events', 'مسابقات پرش'), L('Endurance rides', 'سواری استقامت'), L('Breed shows', 'شوهای نژادی')]),
  ...mkOrgs('trainer', [['Reza Mirzaei', 'رضا میرزایی'], ['Parastoo Zandi', 'پرستو زندی'], ['Omid Sadeghi', 'امید صادقی'], ['Niloufar Shokri', 'نیلوفر شکری']], [L('Jumping coaching', 'مربیگری پرش'), L('Dressage coaching', 'مربیگری درساژ'), L('Young horse training', 'آموزش اسب جوان'), L('Endurance conditioning', 'آماده‌سازی استقامت')]),
  ...mkOrgs('authority', [['Iran Equestrian Federation', 'فدراسیون سوارکاری ایران'], ['Veterinary Organisation of Iran', 'سازمان دامپزشکی ایران'], ['Ministry of Agriculture · Livestock', 'وزارت جهاد کشاورزی · امور دام']], [L('Registry authority', 'مرجع ثبت'), L('Passport issuance', 'صدور گذرنامه'), L('Regulation', 'مقررات‌گذاری')]),
  ...mkOrgs('transport', [['Safe Horse Transport', 'حمل اسب امن'], ['Pars Horse Logistics', 'لجستیک اسب پارس'], ['North Equine Haulage', 'حمل اسب شمال']], [L('Welfare-approved vehicles', 'وسایل مورد تأیید رفاه'), L('Inter-province transport', 'حمل بین‌استانی'), L('Veterinary escort', 'همراهی دامپزشک')]),
];
