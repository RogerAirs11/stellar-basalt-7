import { registryAgeRange, type RegistryDate } from '../../../registry/dates';
import { L } from './i18n';

export type Colour = 'grey' | 'bay' | 'chestnut' | 'black';
export type Gender = 'stallion' | 'mare' | 'gelding';
export type Discipline = 'jumping' | 'dressage' | 'endurance';

export const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/* LIVE WIRING (owner): the donor's photos now live in /f/modern-horse/img/ so
 * the static-asset CSP (img-src 'self') keeps working with zero external hosts.
 * The donor's crop sizes are honoured by CSS object-cover as before. */
export const px = (id: number, _w = 800, _h = 600) =>
  `/f/modern-horse/img/${id}.jpg`;

export const IMG = {
  hero: 28505285,
  pair: 29775974,
  jumping: 37936169,
  jumping2: 38712161,
  jumping3: 13814411,
  jumping4: 13814187,
  herd: 18286317,
  arabianProfile: 29298348,
  pasture: 30892385,
  riderA: 9396611,
  riderB: 38180135,
  riderC: 9396616,
};

export const COLOUR_HEX: Record<Colour, string> = {
  grey: '#cdd3dd',
  bay: '#7a4a2a',
  chestnut: '#c27a1f',
  black: '#1d1f27',
};
export const COLOUR_L: Record<Colour, L> = {
  grey: L('Grey', 'خاکستری'),
  bay: L('Bay', 'کهر'),
  chestnut: L('Chestnut', 'اشقر'),
  black: L('Black', 'سیاه'),
};
export const GENDER_L: Record<Gender, L> = {
  stallion: L('Stallion', 'اسب نر'),
  mare: L('Mare', 'مادیان'),
  gelding: L('Gelding', 'اخته'),
};
export const BREEDS: L[] = [
  L('Persian Arabian', 'عرب ایرانی'),
  L('Turkoman', 'ترکمن'),
  L('Darashouri', 'داراشوری'),
  L('Kurdish', 'کُرد'),
  L('Caspian', 'خزری'),
];
export const DISCIPLINE_L: Record<Discipline, L> = {
  jumping: L('Show Jumping', 'پرش با اسب'),
  dressage: L('Dressage', 'درساژ'),
  endurance: L('Endurance', 'استقامت'),
};

/* ---------- ancestor pool ---------- */

export interface PoolEntry {
  name: L;
  colour: Colour;
  year: number;
}
const sireBase: [string, string][] = [
  ['Shahbaz', 'شهباز'], ['Rostam', 'رستم'], ['Bahram', 'بهرام'], ['Kaveh', 'کاوه'], ['Fereydoun', 'فریدون'],
  ['Jamshid', 'جمشید'], ['Sohrab', 'سهراب'], ['Shapour', 'شاپور'], ['Kourosh', 'کوروش'], ['Babak', 'بابک'],
  ['Khosrow', 'خسرو'], ['Tahmasb', 'طهماسب'], ['Arjang', 'ارژنگ'], ['Nader', 'نادر'], ['Piruz', 'پیروز'],
  ['Sepehr', 'سپهر'], ['Parviz', 'پرویز'], ['Behzad', 'بهزاد'], ['Farhad', 'فرهاد'], ['Siavash', 'سیاوش'],
  ['Shahriar', 'شهریار'], ['Mehrdad', 'مهرداد'], ['Bijan', 'بیژن'], ['Tirdad', 'تیرداد'], ['Dariush', 'داریوش'],
  ['Manouchehr', 'منوچهر'], ['Ardeshir', 'اردشیر'], ['Nariman', 'نریمان'], ['Esfandiar', 'اسفندیار'], ['Zal', 'زال'],
];
const damBase: [string, string][] = [
  ['Roshanak', 'روشنک'], ['Shirin', 'شیرین'], ['Mandana', 'ماندانا'], ['Azadeh', 'آزاده'], ['Banoo', 'بانو'],
  ['Parisa', 'پریسا'], ['Golnar', 'گلنار'], ['Atoosa', 'آتوسا'], ['Laleh', 'لاله'], ['Nasrin', 'نسرین'],
  ['Shabnam', 'شبنم'], ['Setareh', 'ستاره'], ['Soraya', 'ثریا'], ['Mitra', 'میترا'], ['Anahita', 'آناهیتا'],
  ['Negar', 'نگار'], ['Yalda', 'یلدا'], ['Sahar', 'سحر'], ['Ghazal', 'غزل'], ['Shiva', 'شیوا'],
  ['Nazanin', 'نازنین'], ['Ziba', 'زیبا'], ['Haleh', 'هاله'], ['Dorsa', 'درسا'], ['Mahrokh', 'ماهرخ'],
  ['Roya', 'رویا'], ['Afsaneh', 'افسانه'], ['Pegah', 'پگاه'], ['Taraneh', 'ترانه'], ['Elham', 'الهام'],
];
const places: [string, string][] = [
  ['Fars', 'فارس'], ['Gorgan', 'گرگان'], ['Alborz', 'البرز'], ['Zagros', 'زاگرس'], ['Khuzestan', 'خوزستان'],
  ['Isfahan', 'اصفهان'], ['Tabriz', 'تبریز'], ['Yazd', 'یزد'], ['Mazandaran', 'مازندران'], ['Kerman', 'کرمان'],
  ['Gilan', 'گیلان'], ['Qom', 'قم'], ['Khorasan', 'خراسان'], ['Hamadan', 'همدان'], ['Ardabil', 'اردبیل'],
  ['Lorestan', 'لرستان'], ['Semnan', 'سمنان'], ['Bushehr', 'بوشهر'], ['Kurdistan', 'کردستان'], ['Shiraz', 'شیراز'],
];
const palette: Colour[] = ['grey', 'bay', 'bay', 'chestnut', 'grey', 'black', 'bay', 'grey', 'chestnut', 'bay', 'grey', 'chestnut'];

/** Size of the procedural ancestor pool (per sex). Higher index = more recent. */
export const POOL_N = 600;
export function ancestor(p: 'S' | 'D', i: number): PoolEntry {
  const base = (p === 'S' ? sireBase : damBase)[(i * (p === 'S' ? 1 : 7)) % 30];
  const place = places[(Math.floor(i / 30) + (p === 'S' ? 0 : 7)) % 20];
  return {
    name: L(`${base[0]} of ${place[0]}`, `${base[1]} ${place[1]}`),
    colour: palette[(i * 5 + (p === 'S' ? 1 : 4)) % palette.length],
    year: 1962 + Math.round((i / POOL_N) * 52),
  };
}

/* ---------- horses ---------- */

export interface Ref {
  p: 'S' | 'D';
  i: number;
}
export interface Horse {
  id: string;
  regId: string;
  name: L;
  breed: L;
  gender: Gender;
  birth: string;
  registryFacts?: { birth: RegistryDate | null; coat: L; swatch: string; sex: L; breedingSex: boolean; recordedSex?: Gender; deceased?: boolean | null; simpleCoat: boolean };
  colour: Colour;
  photo: number;
  pos?: string;
  owner: L;
  breeder: L;
  location: L;
  height: number;
  discipline: Discipline;
  sire: Ref | null;
  dam: Ref | null;
  sireId?: string;
  damId?: string;
  verified: { owner: boolean; passport: boolean; federation: boolean };
  dna: boolean;
  carrier?: string[];
  sale?: { priceM: number };
  lastVet: string;
  duplicateWarning?: boolean;
  blurb: L;
  /** LIVE WIRING: a name-only stand-in for a real registry ancestor outside the
   * hydrated slice. Its birth year / colour are unknown, so views must not invent them. */
  shell?: boolean;
}

const owner = {
  farah: L('Farah Equestrian Co.', 'شرکت سوارکاری فرح'),
  alborz: L('Alborz Equine Group', 'گروه اسب البرز'),
  pars: L('Pars Stud', 'اصطبل پارس'),
  qashqai: L('Qashqai Heritage Farm', 'مزرعه میراث قشقایی'),
  kurd: L('Zagros Horse Club', 'باشگاه اسب زاگرس'),
  caspian: L('Caspian Riding Society', 'انجمن سوارکاری خزر'),
};
const breeder = {
  tehran: L('Tehran Stud Farm', 'اصطبل پرورش تهران'),
  gorgan: L('Gorgan Turkoman Stud', 'اصطبل ترکمن گرگان'),
  isfahan: L('Isfahan Heritage Stud', 'اصطبل میراث اصفهان'),
  shiraz: L('Fars Darashouri Stud', 'اصطبل داراشوری فارس'),
  sanandaj: L('Sanandaj Stud Farm', 'اصطبل سنندج'),
};
const city = {
  tehran: L('Tehran', 'تهران'), gorgan: L('Gorgan', 'گرگان'), isfahan: L('Isfahan', 'اصفهان'),
  shiraz: L('Shiraz', 'شیراز'), kurdistan: L('Sanandaj', 'سنندج'), karaj: L('Karaj', 'کرج'),
};
const ALL = { owner: true, passport: true, federation: true };

const CORE: Horse[] = [
  {
    id: 'persian-star', regId: 'IR-2024-00123', name: L('Persian Star', 'ستاره پارسی'), breed: BREEDS[0], gender: 'stallion',
    birth: '2020-04-12', colour: 'grey', photo: 38616665, pos: 'center 30%', owner: owner.farah, breeder: breeder.tehran,
    location: city.tehran, height: 155, discipline: 'jumping', sire: { p: 'S', i: 583 }, dam: { p: 'D', i: 577 },
    verified: ALL, dna: true, sale: { priceM: 2400 }, lastVet: '2025-03-12', duplicateWarning: true,
    blurb: L('A powerful grey Arabian stallion with exceptional jumping scope and a calm, trainable temperament.',
      'اسب نر خاکستری عرب با قدرت پرش استثنایی و خلق‌وخوی آرام و آموزش‌پذیر.'),
  },
  {
    id: 'ramin', regId: 'IR-2019-0456', name: L('Ramin', 'رامین'), breed: BREEDS[1], gender: 'stallion',
    birth: '2019-03-21', colour: 'bay', photo: 25903858, pos: 'center', owner: owner.alborz, breeder: breeder.gorgan,
    location: city.gorgan, height: 158, discipline: 'jumping', sire: { p: 'S', i: 579 }, dam: { p: 'D', i: 558 },
    verified: ALL, dna: true, carrier: ['HYPP'], lastVet: '2025-02-03',
    blurb: L('A deep-bodied Turkoman bay stallion, known for stamina and a powerful stride.',
      'اسب نر کهر ترکمن با بدنی عمیق، معروف به استقامت و گام‌های قدرتمند.'),
  },
  {
    id: 'nika', regId: 'IR-2021-0789', name: L('Nika', 'نیکا'), breed: BREEDS[0], gender: 'mare',
    birth: '2021-05-02', colour: 'grey', photo: 32286997, pos: 'center 35%', owner: owner.pars, breeder: breeder.isfahan,
    location: city.isfahan, height: 151, discipline: 'dressage', sire: { p: 'S', i: 586 }, dam: { p: 'D', i: 574 },
    verified: ALL, dna: true, lastVet: '2025-01-19',
    blurb: L('An elegant grey Arabian mare with refined movement and outstanding bloodlines.',
      'مادیان خاکستری و برازنده عرب با حرکات ظریف و اصالت خونی برجسته.'),
  },
  {
    id: 'shabrang', regId: 'IR-2018-0311', name: L('Shabrang', 'شبرنگ'), breed: BREEDS[2], gender: 'stallion',
    birth: '2018-02-14', colour: 'bay', photo: 19496770, pos: 'center 40%', owner: owner.qashqai, breeder: breeder.shiraz,
    location: city.shiraz, height: 153, discipline: 'endurance', sire: { p: 'S', i: 577 }, dam: { p: 'D', i: 568 },
    verified: ALL, dna: true, lastVet: '2025-02-27',
    blurb: L('A hardy Darashouri stallion from the Fars plains, a proven endurance performer.',
      'اسب نر سرسخت داراشوری از دشت‌های فارس و ورزیده در استقامت.'),
  },
  {
    id: 'atash', regId: 'IR-2020-0654', name: L('Atash', 'آتش'), breed: BREEDS[1], gender: 'gelding',
    birth: '2020-06-30', colour: 'chestnut', photo: 34351739, pos: 'center 35%', owner: owner.alborz, breeder: breeder.gorgan,
    location: city.karaj, height: 160, discipline: 'jumping', sire: { p: 'S', i: 574 }, dam: { p: 'D', i: 565 },
    verified: ALL, dna: false, lastVet: '2025-03-01',
    blurb: L('A fiery chestnut gelding with a bold attitude over fences.',
      'اسب اخته اشقر و پرشور با جسارت چشمگیر در پرش از موانع.'),
  },
  {
    id: 'mahtab', regId: 'IR-2022-0912', name: L('Mahtab', 'مهتاب'), breed: BREEDS[0], gender: 'mare',
    birth: '2022-04-08', colour: 'grey', photo: 20685715, pos: 'center 30%', owner: owner.pars, breeder: breeder.tehran,
    location: city.tehran, height: 149, discipline: 'endurance', sire: { p: 'S', i: 583 }, dam: { p: 'D', i: 580 },
    verified: { owner: true, passport: false, federation: true }, dna: true, lastVet: '2025-02-11',
    blurb: L('A young grey Arabian mare with great promise for long-distance riding.',
      'مادیان جوان خاکستری عرب با آینده‌ای روشن در سوارکاری استقامت.'),
  },
  {
    id: 'simorgh', regId: 'IR-2017-0188', name: L('Simorgh', 'سیمرغ'), breed: BREEDS[0], gender: 'stallion',
    birth: '2017-01-25', colour: 'grey', photo: 32307546, pos: 'center 30%', owner: owner.farah, breeder: breeder.isfahan,
    location: city.isfahan, height: 157, discipline: 'dressage', sire: { p: 'S', i: 589 }, dam: { p: 'D', i: 583 },
    verified: ALL, dna: true, sale: { priceM: 3100 }, lastVet: '2025-03-20',
    blurb: L('A noble dressage stallion with spectacular presence and expressive paces.',
      'اسب نر اصیل درساژ با ظاهری شکوهمند و حرکاتی گویا.'),
  },
  {
    id: 'yaas', regId: 'IR-2021-0533', name: L('Yaas', 'یاس'), breed: BREEDS[3], gender: 'mare',
    birth: '2021-03-15', colour: 'chestnut', photo: 35623817, pos: 'center 30%', owner: owner.kurd, breeder: breeder.sanandaj,
    location: city.kurdistan, height: 150, discipline: 'endurance', sire: { p: 'S', i: 571 }, dam: { p: 'D', i: 562 },
    verified: { owner: true, passport: false, federation: false }, dna: false, lastVet: '2024-12-09',
    blurb: L('A gentle Kurdish mare, sure-footed and tireless in the mountains.',
      'مادیان آرام کُرد، پاگیر و خستگی‌ناپذیر در کوهستان.'),
  },
  {
    id: 'dena', sale: { priceM: 1500 }, regId: 'IR-2020-0377', name: L('Dena', 'دنا'), breed: BREEDS[2], gender: 'mare',
    birth: '2020-05-19', colour: 'bay', photo: 39955988, pos: 'center', owner: owner.qashqai, breeder: breeder.shiraz,
    location: city.shiraz, height: 152, discipline: 'endurance', sire: { p: 'S', i: 577 }, dam: { p: 'D', i: 574 },
    verified: ALL, dna: true, lastVet: '2025-01-30',
    blurb: L('A refined bay Darashouri mare with a smooth, ground-covering stride.',
      'مادیان کهر ظریف داراشوری با گام‌های روان و بلند.'),
  },
  {
    id: 'arash', regId: 'IR-2019-0602', name: L('Arash', 'آرش'), breed: BREEDS[1], gender: 'stallion',
    birth: '2019-07-04', colour: 'bay', photo: 25903851, pos: 'center', owner: owner.caspian, breeder: breeder.gorgan,
    location: city.karaj, height: 161, discipline: 'jumping', sire: { p: 'S', i: 586 }, dam: { p: 'D', i: 568 },
    verified: ALL, dna: true, sale: { priceM: 1800 }, lastVet: '2025-02-22',
    blurb: L('A quick, athletic bay stallion — a rising star of the national jumping circuit.',
      'اسب نر کهر چابک و ورزشکار، ستاره‌ای در حال ظهور در مسابقات پرش کشور.'),
  },
  {
    id: 'bahar', regId: 'IR-2022-1044', name: L('Bahar', 'بهار'), breed: BREEDS[3], gender: 'mare',
    birth: '2022-03-21', colour: 'chestnut', photo: 14934378, pos: 'center 35%', owner: owner.kurd, breeder: breeder.sanandaj,
    location: city.kurdistan, height: 148, discipline: 'dressage', sire: { p: 'S', i: 568 }, dam: { p: 'D', i: 559 },
    verified: { owner: true, passport: true, federation: false }, dna: true, lastVet: '2025-03-05',
    blurb: L('A sweet-natured chestnut mare with a white star and bright, willing eyes.',
      'مادیان اشقر مهربان با ستاره سفید و چشمانی روشن و مشتاق.'),
  },
  {
    id: 'kaveh', sale: { priceM: 2200 }, regId: 'IR-2018-0275', name: L('Kaveh', 'کاوه'), breed: BREEDS[0], gender: 'stallion',
    birth: '2018-04-02', colour: 'bay', photo: 32286998, pos: 'center 35%', owner: owner.pars, breeder: breeder.tehran,
    location: city.tehran, height: 156, discipline: 'dressage', sire: { p: 'S', i: 580 }, dam: { p: 'D', i: 577 },
    verified: ALL, dna: true, lastVet: '2025-03-14',
    blurb: L('A thoughtful bay stallion, a favourite with dressage trainers.',
      'اسب نر کهر و متفکر، محبوب مربیان درساژ.'),
  },
];


/* ---------- generated registry records (demo of a large database) ---------- */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PHOTOS: Record<Colour, [number, string][]> = {
  grey: [[38616665, 'center 30%'], [32286997, 'center 35%'], [20685715, 'center 30%'], [32307546, 'center 30%'], [29298348, 'center'], [32256721, 'center 30%']],
  bay: [[25903858, 'center'], [19496770, 'center 40%'], [39955988, 'center'], [25903851, 'center'], [3969316, 'center'], [32286998, 'center 35%']],
  chestnut: [[34351739, 'center 35%'], [35623817, 'center 30%'], [14934378, 'center 35%'], [32286998, 'center 35%']],
  black: [[25903858, 'center'], [19496770, 'center 40%'], [39955988, 'center']],
};
const OWNERS: L[] = [
  L('Farah Equestrian Co.', 'شرکت سوارکاری فرح'), L('Alborz Equine Group', 'گروه اسب البرز'), L('Pars Stud', 'اصطبل پارس'), L('Qashqai Heritage Farm', 'مزرعه میراث قشقایی'),
  L('Zagros Horse Club', 'باشگاه اسب زاگرس'), L('Caspian Riding Society', 'انجمن سوارکاری خزر'), L('Khorasan Riders Club', 'باشگاه سواران خراسان'), L('Tabriz Equestrian Centre', 'مرکز سوارکاری تبریز'),
  L('Yazd Desert Stables', 'اصطبل‌های کویر یزد'), L('Kerman Horse Farm', 'مزرعه اسب کرمان'), L('Gilan Green Valley Farm', 'مزرعه دره سبز گیلان'), L('Hamadan Equine Co.', 'شرکت اسب همدان'),
];
const CITIES: L[] = [
  L('Tehran', 'تهران'), L('Isfahan', 'اصفهان'), L('Shiraz', 'شیراز'), L('Gorgan', 'گرگان'), L('Karaj', 'کرج'), L('Sanandaj', 'سنندج'),
  L('Tabriz', 'تبریز'), L('Mashhad', 'مشهد'), L('Yazd', 'یزد'), L('Kerman', 'کرمان'), L('Rasht', 'رشت'), L('Hamadan', 'همدان'),
];
const BREEDERS_L: L[] = [
  breeder.tehran, breeder.gorgan, breeder.isfahan, breeder.shiraz, breeder.sanandaj,
  L('Khuzestan Arabian Stud', 'اصطبل عرب خوزستان'), L('Mazandaran Stud Farm', 'اصطبل مازندران'), L('Qom Desert Stud', 'اصطبل کویر قم'),
];
const DISC: Discipline[] = ['jumping', 'dressage', 'endurance'];
const BLURB: Record<Discipline, L[]> = {
  jumping: [L('A bold, athletic jumper with a quick eye for the fence.', 'اسب پرش جسور و ورزیده با دید سریع برای مانع.'), L('Scopey and careful — a consistent clear-round performer.', 'پرشی قدرتمند و دقیق؛ همواره بدون خطا.')],
  dressage: [L('A supple mover with an elegant, expressive trot.', 'اسبی انعطاف‌پذیر با یورتمه‌ای برازنده و گویا.'), L('Calm, trainable and naturally balanced.', 'آرام، آموزش‌پذیر و دارای تعادل طبیعی.')],
  endurance: [L('Tireless over distance with a rapid heart-rate recovery.', 'خستگی‌ناپذیر در مسافت با بازیابی سریع ضربان قلب.'), L('A sure-footed, economical mover for long rides.', 'اسبی پاگیر و کم‌مصرف برای سواری‌های طولانی.')],
};
const mkRef = (p: 'S' | 'D', r: () => number): Ref | null => { const x = r(); if (x < 0.04) return null; return { p, i: x < 0.4 ? 6 + Math.floor(r() * 60) : 300 + Math.floor(r() * 280) }; };
const GEN_N = 180;
const generated: Horse[] = (() => {
  const r = rng(20250415);
  const out: Horse[] = [];
  for (let k = 0; k < GEN_N; k++) {
    const g = r();
    const gender: Gender = g < 0.4 ? 'stallion' : g < 0.88 ? 'mare' : 'gelding';
    const nm = ancestor(gender === 'mare' ? 'D' : 'S', 30 + k * 3).name;
    const cr = r();
    const colour: Colour = cr < 0.3 ? 'grey' : cr < 0.7 ? 'bay' : cr < 0.9 ? 'chestnut' : 'black';
    const ph = PHOTOS[colour][Math.floor(r() * PHOTOS[colour].length)];
    const year = 2007 + Math.floor(r() * 18);
    const month = 1 + Math.floor(r() * 6), day = 1 + Math.floor(r() * 27);
    const birth = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const discipline = DISC[Math.floor(r() * 3)];
    const v = r();
    const verified = v < 0.66 ? { owner: true, passport: true, federation: true } : v < 0.86 ? { owner: true, passport: true, federation: false } : v < 0.96 ? { owner: true, passport: false, federation: false } : { owner: false, passport: false, federation: false };
    const city = CITIES[Math.floor(r() * CITIES.length)];
    const bi = r();
    const breedIdx = bi < 0.38 ? 0 : bi < 0.58 ? 1 : bi < 0.75 ? 2 : bi < 0.9 ? 3 : 4;
    out.push({
      id: `h${k + 1}`, regId: `IR-${year + 1}-${String(1000 + k * 7).padStart(5, '0')}`, name: nm, breed: BREEDS[breedIdx], gender, birth, colour,
      photo: ph[0], pos: ph[1], owner: OWNERS[Math.floor(r() * OWNERS.length)], breeder: BREEDERS_L[Math.floor(r() * BREEDERS_L.length)], location: city,
      height: 144 + Math.floor(r() * 20), discipline, sire: mkRef('S', r), dam: mkRef('D', r),
      verified, dna: r() < 0.7, carrier: r() < 0.05 ? ['HYPP'] : undefined, sale: r() < 0.13 ? { priceM: 400 + Math.floor(r() * 36) * 100 } : undefined,
      lastVet: `2025-0${1 + Math.floor(r() * 3)}-${String(1 + Math.floor(r() * 27)).padStart(2, '0')}`,
      blurb: BLURB[discipline][Math.floor(r() * 2)],
    });
  }
  return out;
})();

const allH: Horse[] = [...CORE, ...generated];
const yr = (h: Horse) => +h.birth.slice(0, 4);
(() => {
  const rl = rng(99);
  const studs = allH.filter((h) => h.gender === 'stallion');
  const dams = allH.filter((h) => h.gender === 'mare');
  allH.forEach((h) => {
    if (h.id === 'ramin' || h.id === 'nika' || yr(h) < 2011) return;
    if (rl() < 0.7) { const c = studs.filter((x) => x.id !== h.id && yr(x) <= yr(h) - 4); if (c.length) h.sireId = c[Math.floor(rl() * c.length)].id; }
    if (rl() < 0.75) { const c = dams.filter((x) => x.id !== h.id && yr(x) <= yr(h) - 3); if (c.length) h.damId = c[Math.floor(rl() * c.length)].id; }
  });
  generated.filter((h) => yr(h) === 2024).slice(0, 2).forEach((h) => { h.sireId = 'persian-star'; h.damId = 'nika'; });
  generated.filter((h) => yr(h) === 2023).slice(0, 2).forEach((h) => { h.sireId = 'ramin'; h.damId = 'dena'; });
})();

export const HORSES: Horse[] = allH;

/* LIVE WIRING SEAM (owner directive: exact donor app on the real platform).
 * The demo registry above renders until live.ts hydrates the real national
 * registry in place (same array object, so every import keeps working):
 *  - HORSES is replaced with the significance-ranked live slice;
 *  - REGISTRY_TOTAL becomes the real public total;
 *  - ALL_BY_ID registers every live horse plus real-name parent shells so
 *    pedigree links resolve; demo ids stay resolvable for the mockup's own
 *    breeding picks (they simply leave the public list). */
export const ALL_BY_ID = new Map<string, Horse>();
for (const h of HORSES) ALL_BY_ID.set(h.id, h);
export function registerHorse(h: Horse) { ALL_BY_ID.set(h.id, h); }

export let REGISTRY_TOTAL = 48230;
export function setRegistryTotal(n: number) { REGISTRY_TOTAL = n; }

export const horseById = (id: string) => ALL_BY_ID.get(id) ?? HORSES.find((h) => h.id === id);

export const verifyStatus = (h: Horse): 'verified' | 'partial' | 'pending' => {
  const v = Object.values(h.verified).filter(Boolean).length;
  return v === 3 ? 'verified' : v === 0 ? 'pending' : 'partial';
};

const ageRange = (h: Horse) => {
  const b = h.registryFacts ? h.registryFacts.birth : h.birth ? {value:h.birth,precision:'day' as const,calendar:'gregorian' as const} : null;
  if (!b) return null;
  const now = new Date();
  return registryAgeRange(b,{gy:now.getFullYear(),gm:now.getMonth()+1,gd:now.getDate()});
};
export const ageOf = (h: Horse) => { const a=ageRange(h);return a && a.min===a.max ? a.min : NaN; };
export const ageText = (h: Horse) => {const a=ageRange(h);return !a?'—':a.min===a.max?String(a.min):`${a.min}–${a.max}`;};
export const coatLabel = (h:Horse) => h.registryFacts?.coat ?? COLOUR_L[h.colour];
export const coatSwatch = (h:Horse) => h.registryFacts?.swatch ?? COLOUR_HEX[h.colour];
export const sexDisplay = (h:Horse) => h.registryFacts?.sex ?? GENDER_L[h.gender];

/* ---------- competitions ---------- */

export interface Riders {
  id: string;
  name: L;
  pts: number;
  photo?: number;
  from: L;
}
export const RIDERS: Riders[] = [
  { id: 'sara', name: L('Sara Rahimi', 'سارا رحیمی'), pts: 1245, photo: IMG.riderA, from: L('Tehran', 'تهران') },
  { id: 'kian', name: L('Kian Mohseni', 'کیان محسنی'), pts: 1180, photo: IMG.riderB, from: L('Isfahan', 'اصفهان') },
  { id: 'neda', name: L('Neda Farhadi', 'ندا فرهادی'), pts: 1102, photo: IMG.riderC, from: L('Shiraz', 'شیراز') },
  { id: 'armin', name: L('Armin Tavakoli', 'آرمین توکلی'), pts: 987, from: L('Gorgan', 'گرگان') },
  { id: 'mina', name: L('Mina Ghasemi', 'مینا قاسمی'), pts: 940, from: L('Sanandaj', 'سنندج') },
];

export interface Result {
  id: string;
  horseId: string;
  date: string;
  name: L;
  venue: L;
  discipline: Discipline;
  place: number;
  rider: string;
}
export const RESULTS: Result[] = [
  { id: 'r1', horseId: 'persian-star', date: '2025-03-15', name: L('National Show Jumping Championship', 'مسابقات قهرمانی ملی پرش با اسب'), venue: L('Tehran Equestrian Centre', 'مرکز سوارکاری تهران'), discipline: 'jumping', place: 1, rider: 'sara' },
  { id: 'r2', horseId: 'persian-star', date: '2025-02-02', name: L('Tehran Equestrian Tour', 'تور سوارکاری تهران'), venue: L('Azadi Arena', 'میدان آزادی'), discipline: 'jumping', place: 3, rider: 'sara' },
  { id: 'r3', horseId: 'persian-star', date: '2024-11-20', name: L('Endurance Ride – 120 km', 'سواری استقامت – ۱۲۰ کیلومتر'), venue: L('Qom Desert Track', 'مسیر کویر قم'), discipline: 'endurance', place: 2, rider: 'kian' },
  { id: 'r4', horseId: 'persian-star', date: '2024-09-08', name: L('Alborz Cup Grand Prix', 'جام بزرگ البرز'), venue: L('Karaj Riding Club', 'باشگاه سوارکاری کرج'), discipline: 'jumping', place: 1, rider: 'sara' },
  { id: 'r5', horseId: 'persian-star', date: '2024-05-17', name: L('Spring Dressage Classic', 'کلاسیک بهاره درساژ'), venue: L('Isfahan Hippodrome', 'هیپودروم اصفهان'), discipline: 'dressage', place: 3, rider: 'neda' },
  { id: 'r6', horseId: 'persian-star', date: '2023-10-12', name: L('Autumn Open Jumping', 'پرش آزاد پاییزه'), venue: L('Shiraz Equestrian Park', 'پارک سوارکاری شیراز'), discipline: 'jumping', place: 4, rider: 'sara' },
  { id: 'r7', horseId: 'ramin', date: '2025-03-01', name: L('Turkoman Heritage Cup', 'جام میراث ترکمن'), venue: L('Gorgan Plains', 'دشت گرگان'), discipline: 'endurance', place: 1, rider: 'armin' },
  { id: 'r8', horseId: 'nika', date: '2025-02-20', name: L('Isfahan Dressage Festival', 'جشنواره درساژ اصفهان'), venue: L('Isfahan Hippodrome', 'هیپودروم اصفهان'), discipline: 'dressage', place: 1, rider: 'neda' },
  { id: 'r9', horseId: 'arash', date: '2025-03-15', name: L('National Show Jumping Championship', 'مسابقات قهرمانی ملی پرش با اسب'), venue: L('Tehran Equestrian Centre', 'مرکز سوارکاری تهران'), discipline: 'jumping', place: 2, rider: 'kian' },
  { id: 'r10', horseId: 'shabrang', date: '2025-01-18', name: L('Fars 80 km Endurance', 'استقامت ۸۰ کیلومتر فارس'), venue: L('Persepolis Trail', 'مسیر تخت‌جمشید'), discipline: 'endurance', place: 1, rider: 'mina' },
  { id: 'r11', horseId: 'simorgh', date: '2025-02-25', name: L('Tehran Dressage Open', 'درساژ آزاد تهران'), venue: L('Azadi Arena', 'میدان آزادی'), discipline: 'dressage', place: 1, rider: 'neda' },
  { id: 'r12', horseId: 'atash', date: '2025-03-15', name: L('National Show Jumping Championship', 'مسابقات قهرمانی ملی پرش با اسب'), venue: L('Tehran Equestrian Centre', 'مرکز سوارکاری تهران'), discipline: 'jumping', place: 5, rider: 'armin' },
];

export interface PerfYear {
  year: number;
  starts: number;
  podiums: number;
}
export function perfFor(horseId: string): PerfYear[] {
  if (horseId === 'persian-star')
    return [
      { year: 2022, starts: 4, podiums: 1 },
      { year: 2023, starts: 6, podiums: 3 },
      { year: 2024, starts: 8, podiums: 4 },
      { year: 2025, starts: 7, podiums: 5 },
    ];
  let s = 0;
  for (const c of horseId) s = (s * 31 + c.charCodeAt(0)) % 97;
  return [2022, 2023, 2024, 2025].map((year, i) => {
    const starts = 3 + ((s + i * 5) % 6) + i;
    return { year, starts, podiums: Math.max(1, Math.min(starts - 1, 1 + ((s + i * 3) % 4) + Math.floor(i / 2))) };
  });
}

export interface EventItem {
  id: string;
  date: string;
  name: L;
  venue: L;
  discipline: Discipline;
  photo: number;
  entries: number;
}
export const EVENTS: EventItem[] = [
  { id: 'e1', date: '2025-05-09', name: L('Nowruz Grand Prix', 'گرندپری نوروز'), venue: L('Tehran Equestrian Centre', 'مرکز سوارکاری تهران'), discipline: 'jumping', photo: IMG.jumping2, entries: 124 },
  { id: 'e2', date: '2025-05-23', name: L('Persian Gulf Endurance 160', 'استقامت ۱۶۰ خلیج فارس'), venue: L('Bushehr Coastal Track', 'مسیر ساحلی بوشهر'), discipline: 'endurance', photo: IMG.jumping3, entries: 86 },
  { id: 'e3', date: '2025-06-06', name: L('Golden Reins Dressage Gala', 'گالای درساژ عنان زرین'), venue: L('Isfahan Hippodrome', 'هیپودروم اصفهان'), discipline: 'dressage', photo: IMG.jumping4, entries: 58 },
];

/* ---------- services ---------- */

export interface Service {
  key: string;
  title: L;
  desc: L;
}
export const SERVICES: Service[] = [
  { key: 'registry', title: L('Horse Registration', 'ثبت اسب'), desc: L('Register foals and adults with identity, ownership and passport verification.', 'ثبت کره‌ها و اسب‌های بالغ با تأیید هویت، مالکیت و گذرنامه.') },
  { key: 'passport', title: L('Digital Passport', 'گذرنامه دیجیتال'), desc: L('Tamper-proof digital passports linked to microchip and federation records.', 'گذرنامه دیجیتال غیرقابل جعل متصل به میکروچیپ و سوابق فدراسیون.') },
  { key: 'dna', title: L('DNA & Parentage', 'آزمایش DNA و تعیین والدین'), desc: L('Accredited laboratories for parentage confirmation and genetic testing.', 'آزمایشگاه‌های معتبر برای تأیید والدین و آزمایش‌های ژنتیکی.') },
  { key: 'vet', title: L('Veterinary Network', 'شبکه دامپزشکی'), desc: L('Connected vets keep vaccination and health records always up to date.', 'دامپزشکان متصل، سوابق واکسن و سلامت را همواره به‌روز نگه می‌دارند.') },
  { key: 'market', title: L('Verified Marketplace', 'بازار تأییدشده'), desc: L('Buy and sell with confidence — every listing is checked and verified.', 'با اطمینان بخرید و بفروشید؛ همه آگهی‌ها بررسی و تأیید می‌شوند.') },
  { key: 'transport', title: L('Transport', 'حمل‌ونقل'), desc: L('Licensed, welfare-approved horse transport across the country.', 'حمل‌ونقل دارای مجوز و مورد تأیید رفاه حیوان در سراسر کشور.') },
  { key: 'insurance', title: L('Insurance', 'بیمه'), desc: L('Mortality, medical and liability cover tailored to equine owners.', 'پوشش مرگ‌ومیر، درمان و مسئولیت مناسب مالکان اسب.') },
  { key: 'training', title: L('Training & Coaching', 'آموزش و مربیگری'), desc: L('Certified coaches and academies for riders and horses of every level.', 'مربیان و آکادمی‌های دارای گواهی برای سوارکاران و اسب‌ها در همه سطوح.') },
];

export const shownSex=(h:Horse) => h.registryFacts ? h.registryFacts.recordedSex : h.gender;
export const eligibleParent=(h:Horse | undefined, role:'stallion'|'mare') => !!(h?.registryFacts && h.registryFacts.breedingSex && !h.registryFacts.deceased && shownSex(h)===role);
