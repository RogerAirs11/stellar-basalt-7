import { HORSES, IMG, RIDERS, hash, type Discipline, type Horse } from './data';
import { L } from './i18n';

export interface CalEvent {
  id: string; name: L; date: string; end?: string; venue: L; province: L; disc: Discipline; level: 'international' | 'national' | 'regional'; organizer: L;
  open: string; close: string; capacity: number; entries: number; fee: number; status: 'completed' | 'open' | 'upcoming'; judges: L[]; conditions: L[]; photo: number; minAge: number; sanctioned: boolean;
}
const J = [L('M. Hashemi (FEI 3*)', 'م. هاشمی (FEI ۳ ستاره)'), L('P. Sadat', 'پ. ساداتی'), L('L. Fakhri', 'ل. فخری'), L('A. Nouri', 'آ. نوری'), L('K. Behrooz', 'ک. بهروز')];
const COND = (min: number): L[] => [
  L('Horse must be federation-registered with a reviewed passport', 'اسب باید در فدراسیون ثبت و گذرنامه بررسی‌شده داشته باشد'),
  L('Valid vaccination (within 6 months)', 'واکسیناسیون معتبر (طی ۶ ماه)'),
  L(`Minimum horse age ${min} years`, `حداقل سن اسب ${min} سال`),
  L('Rider holds a valid competition licence', 'سوارکار مجوز معتبر مسابقه دارد'),
  L('No open conflict or duplicate flag on the horse record', 'رکورد اسب پرچم تعارض یا تکراری باز نداشته باشد'),
];
const mk = (id: string, name: L, date: string, venue: L, province: L, disc: Discipline, level: CalEvent['level'], org: L, status: CalEvent['status'], entries: number, cap: number, fee: number, photo: number, min: number): CalEvent => ({
  id, name, date, venue, province, disc, level, organizer: org, open: date.slice(0, 5) + '03-01', close: date.slice(0, 5) + date.slice(5, 7) + '-01', capacity: cap, entries, fee, status, judges: [J[hash(id) % 5], J[(hash(id) + 2) % 5], J[(hash(id) + 3) % 5]], conditions: COND(min), photo, minAge: min, sanctioned: level !== 'regional' || hash(id) % 2 === 0,
});
const AZ = L('Azadi Equestrian Club', 'باشگاه سوارکاری آزادی'), AL = L('Alborz Riding Club', 'باشگاه سوارکاری البرز'), PA = L('Pars Equestrian', 'سوارکاری پارس'), CA = L('Caspian Riders', 'سواران خزر'), FD = L('Iran Equestrian Federation', 'فدراسیون سوارکاری ایران');
export const CALENDAR: CalEvent[] = [
  mk('e0', L('National Show Jumping Championship', 'مسابقات قهرمانی ملی پرش با اسب'), '2025-03-15', L('Tehran Equestrian Centre', 'مرکز سوارکاری تهران'), L('Tehran', 'تهران'), 'jumping', 'national', FD, 'completed', 64, 64, 4500, IMG.jumping, 6),
  mk('e00', L('Isfahan Dressage Festival', 'جشنواره درساژ اصفهان'), '2025-02-20', L('Isfahan Hippodrome', 'هیپودروم اصفهان'), L('Isfahan', 'اصفهان'), 'dressage', 'national', PA, 'completed', 38, 40, 3000, IMG.jumping4, 5),
  mk('e1', L('Nowruz Grand Prix', 'گرندپری نوروز'), '2025-05-09', L('Tehran Equestrian Centre', 'مرکز سوارکاری تهران'), L('Tehran', 'تهران'), 'jumping', 'international', FD, 'open', 124, 150, 6000, IMG.jumping2, 7),
  mk('e2', L('Persian Gulf Endurance 160', 'استقامت ۱۶۰ خلیج فارس'), '2025-05-23', L('Bushehr Coastal Track', 'مسیر ساحلی بوشهر'), L('Bushehr', 'بوشهر'), 'endurance', 'international', FD, 'open', 86, 100, 5200, IMG.jumping3, 7),
  mk('e3', L('Golden Reins Dressage Gala', 'گالای درساژ عنان زرین'), '2025-06-06', L('Isfahan Hippodrome', 'هیپودروم اصفهان'), L('Isfahan', 'اصفهان'), 'dressage', 'national', PA, 'upcoming', 58, 80, 3200, IMG.jumping4, 5),
  mk('e4', L('Alborz Spring Open', 'اوپن بهاره البرز'), '2025-06-20', L('Karaj Riding Club', 'باشگاه سوارکاری کرج'), L('Alborz', 'البرز'), 'jumping', 'regional', AL, 'upcoming', 41, 90, 1800, IMG.jumping2, 4),
  mk('e5', L('Caspian Forest Ride 60', 'سواری جنگلی خزر ۶۰'), '2025-07-04', L('Gilan Forest Trail', 'مسیر جنگلی گیلان'), L('Gilan', 'گیلان'), 'endurance', 'regional', CA, 'upcoming', 22, 60, 1500, IMG.jumping3, 5),
  mk('e6', L('Turkoman Heritage Cup', 'جام میراث ترکمن'), '2025-07-18', L('Gorgan Plains', 'دشت گرگان'), L('Golestan', 'گلستان'), 'endurance', 'national', FD, 'upcoming', 47, 80, 2500, IMG.jumping3, 6),
  mk('e7', L('Shiraz Summer Jumping', 'پرش تابستانی شیراز'), '2025-08-08', L('Shiraz Equestrian Park', 'پارک سوارکاری شیراز'), L('Fars', 'فارس'), 'jumping', 'national', AZ, 'upcoming', 12, 100, 2800, IMG.jumping2, 5),
];

export interface Entry { horse: Horse; rider: string; bib: number }
export function entriesOf(ev: CalEvent): Entry[] {
  const pool = HORSES.filter((h) => h.discipline === ev.disc && +h.birth.slice(0, 4) <= 2021).sort((a, b) => (hash(a.id + ev.id) % 1000) - (hash(b.id + ev.id) % 1000));
  return pool.slice(0, 14).map((h, i) => ({ horse: h, rider: RIDERS[hash(h.id + ev.id) % RIDERS.length].id, bib: 101 + i }));
}
export interface EvRes { rank: number; horse: Horse; rider: string; score: string; status: 'verified' | 'pending' | 'protest' }
export function eventResults(ev: CalEvent): EvRes[] {
  return entriesOf(ev).slice(0, 10).map((e, i) => ({
    rank: i + 1, horse: e.horse, rider: e.rider, status: i === 4 ? 'protest' : i < 3 ? 'verified' : hash(e.horse.id) % 3 === 0 ? 'pending' : 'verified',
    score: ev.disc === 'jumping' ? `${i < 2 ? '0' : i < 5 ? '4' : '8'} ${'faults'} · ${(62.3 + i * 1.7).toFixed(1)}s` : ev.disc === 'dressage' ? `${(74.2 - i * 1.35).toFixed(2)}%` : `${8 + Math.floor(i / 3)}h ${String(12 + i * 7).padStart(2, '0')}m`,
  }));
}

export interface MatchRow { id: string; src: string; raw: string; sub: L; horse?: string; by: 'microchip' | 'passport' | 'registry' | 'name'; conf: number; status: 'linked' | 'review' | 'rejected' }
export const MATCHES: MatchRow[] = [
  { id: 'm1', src: 'Asb Davani', raw: 'PERSIAN STAR · Grey · 2020', sub: L('Result: 1st · National Championship', 'نتیجه: اول · قهرمانی ملی'), horse: 'persian-star', by: 'microchip', conf: 99, status: 'linked' },
  { id: 'm2', src: 'FEI', raw: 'RAMIN (FEI 10311044)', sub: L('Result: 2nd · CSI2* Tehran', 'نتیجه: دوم · CSI2* تهران'), horse: 'ramin', by: 'passport', conf: 97, status: 'linked' },
  { id: 'm3', src: 'Organiser CSV', raw: 'Nika · IR-2021-0789', sub: L('Result: 1st · Isfahan Dressage', 'نتیجه: اول · درساژ اصفهان'), horse: 'nika', by: 'registry', conf: 95, status: 'linked' },
  { id: 'm4', src: 'Asb Davani', raw: 'SHABRANG', sub: L('Result: 3rd · Fars 80 km', 'نتیجه: سوم · ۸۰ کیلومتر فارس'), horse: 'shabrang', by: 'name', conf: 58, status: 'review' },
  { id: 'm5', src: 'Asb Davani', raw: 'ATASH · chestnut gelding', sub: L('Result: 5th · Nowruz Cup', 'نتیجه: پنجم · جام نوروز'), horse: 'atash', by: 'name', conf: 61, status: 'review' },
  { id: 'm6', src: 'Organiser CSV', raw: 'Yaas (no ID supplied)', sub: L('Result: 8th · Kurdish Ride', 'نتیجه: هشتم · سواری کُرد'), horse: 'yaas', by: 'name', conf: 44, status: 'review' },
  { id: 'm7', src: 'FEI', raw: 'ARASH · FEI 10288731', sub: L('Result: 2nd · National Championship', 'نتیجه: دوم · قهرمانی ملی'), horse: 'arash', by: 'passport', conf: 98, status: 'linked' },
  { id: 'm8', src: 'Asb Davani', raw: 'SIMORGH', sub: L('Result: 1st · Tehran Dressage', 'نتیجه: اول · درساژ تهران'), by: 'name', conf: 33, status: 'rejected' },
];
