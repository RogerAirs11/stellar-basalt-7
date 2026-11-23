import { parseRegistryDate } from '../../../registry/dates';
import { breedEncoding, coatColorEncoding } from '../../../frontend-kit/registryEncoding';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HORSES, setRegistryTotal, registerHorse, ALL_BY_ID, type Horse } from './data';
import type { L } from './i18n';

/**
 * LIVE DATA WIRING — the only seam between the exact donor app and the Horse DB platform.
 *
 * Design rules (owner directive): the donor app's components/pages/styles stay
 * byte-preserved; this module (plus tiny seams inside data.ts / Registry.tsx /
 * HorseDetail.tsx) replaces the mockup's demo registry with the real national
 * registry served by the same backend as the core frontend:
 *   - browse:   GET /api/horses?sort=importance&limit=100&offset=N
 *   - search:   GET /api/search?q=…            (the platform's forgiving search)
 *   - profile:  GET /api/horses/:id
 * Fields the platform does not record (trust tiers, DNA, sales, height) stay
 * honestly empty — nothing is invented.
 */

export const PAGE_SIZE = 100;
export const HYDRATE_PAGES = 8;

const PHOTO_PLACEHOLDER = 30892385; // donor's own pasture photograph (decorative, like the mockup)

const l = (en: string | null | undefined, fa: string | null | undefined): L =>
  ({ en: (en && en.trim()) || (fa && fa.trim()) || '—', fa: (fa && fa.trim()) || (en && en.trim()) || '—' });

const COLOUR_MAP: Record<string, Horse['colour']> = {
  grey: 'grey', gray: 'grey', bay: 'bay', brown: 'bay', roan: 'bay', dun: 'bay', buckskin: 'bay',
  chestnut: 'chestnut', sorrel: 'chestnut', red: 'chestnut', black: 'black',
};
const colourOf = (desc: string | null | undefined): Horse['colour'] => {
  const key = (desc ?? '').trim().toLowerCase();
  return COLOUR_MAP[key] ?? 'bay';
};

const genderOf = (sex: string | null | undefined): Horse['gender'] => {
  const key = (sex ?? '').trim().toLowerCase();
  if (key === 'mare' || key === 'filly') return 'mare';
  if (key === 'female') return 'mare';
  if (key === 'geld.' || key === 'gelding') return 'gelding';
  return 'stallion';
};

const breedOf = (desc: string | null | undefined): L => l(desc, breedEncoding(desc,'fa')?.label ?? desc);

export type RegistryRow = {
  id: number | string;
  register_no: string | null;
  microchip_no?: string | null;
  name_latin: string | null;
  name_native: string | null;
  father_id: number | string | null;
  father_name: string | null;
  father_name_native: string | null;
  mother_id: number | string | null;
  mother_name: string | null;
  mother_name_native: string | null;
  birth_year: number | null;
  birth_place_desc: string | null;
  breed_desc: string | null;
  sex_desc: string | null;
  color_desc: string | null;
  main_strain_desc?: string | null;
  sub_strain_desc?: string | null;
  is_active?: number;
  is_dead?: number | boolean;
  owner_name?: string | null;
  owner_name_native?: string | null;
  breeder_name?: string | null;
  breeder_name_native?: string | null;
  birth_date_typed?: string | { value?: unknown; calendar?: unknown; precision?: unknown } | null;
};

const birthOf = (row:RegistryRow) => {
  const typed=row.birth_date_typed, obj=typeof typed==='object'?typed:null;
  const value=String(obj?.value ?? (typeof typed==='string'?typed:row.birth_year) ?? '').trim();
  if (!value) return null;
  const precision=obj?.precision ?? ({4:'year',7:'month',10:'day'}[value.length]);
  try {const p=parseRegistryDate({value,precision,calendar:obj?.calendar ?? 'gregorian'},new Date().getFullYear());return p.ok?p.date:null;} catch {return null;}
};
export function mapRow(row: RegistryRow): Horse {
  const id = String(row.id);
  const birth=birthOf(row), raw=row.color_desc?.trim(), sex=row.sex_desc?.trim(), en=coatColorEncoding(raw,'en'), fa=coatColorEncoding(raw,'fa');
  const sexFa:Record<string,string>={stallion:'سیلمی',mare:'مادیان',filly:'کره ماده',colt:'کره نر',gelding:'اخته',male:'نر',female:'ماده'};
  noteExtras(row); // microchip + deceased flag for the live identity/status surfaces
  const strain = [row.main_strain_desc, row.sub_strain_desc].filter(Boolean).join(' · ');
  return {
    id,
    regId: row.register_no ?? '',
    name: l(row.name_latin, row.name_native),
    breed: breedOf(row.breed_desc),
    gender: genderOf(row.sex_desc),
    birth: birth?.value ?? '',
    registryFacts:{birth,recordedSex: /^(colt|filly|male|female|mare|stallion|geld\.|gelding)$/i.test(sex??'')?genderOf(sex):undefined,deceased:row.is_dead==null?null:!!row.is_dead,coat:l(en?.label??raw,fa?.label??raw),swatch:en?.swatch??'transparent',sex:l(sex,sexFa[(sex??'').toLowerCase()]??sex),breedingSex:/^(stallion|mare)$/i.test(sex??''),simpleCoat:/^(bay|black|grey|gray|chestnut|sorrel)$/i.test(raw??'')},
    colour: colourOf(row.color_desc),
    photo: PHOTO_PLACEHOLDER,
    owner: l(row.owner_name, row.owner_name_native),
    breeder: l(row.breeder_name, row.breeder_name_native),
    location: l(row.birth_place_desc, row.birth_place_desc),
    height: 0,
    discipline: 'endurance',
    sire: null,
    dam: null,
    sireId: row.father_id != null ? String(row.father_id) : undefined,
    damId: row.mother_id != null ? String(row.mother_id) : undefined,
    verified: { owner: false, passport: false, federation: false },
    dna: false,
    lastVet: '',
    blurb: strain ? l(strain, strain) : l('', ''),
  };
}

/** A minimal real-horse shell so pedigree links resolve to real names even
 * when the parent itself is outside the hydrated slice. Never listed.
 * Birth year and colour stay unknown (see Horse.shell) — nothing is invented. */
export function shellOf(id: string, name: L, birth: string, gender: Horse['gender']): Horse {
  return {
    id, regId: '', name, breed: l('Unknown', 'نامشخص'), gender, birth, colour: 'bay', shell: true, registryFacts:{birth:null,coat:l(null,null),sex:l(null,null),swatch:'transparent',breedingSex:false,simpleCoat:false},
    photo: PHOTO_PLACEHOLDER, owner: l('—', '—'), breeder: l('—', '—'), location: l('—', '—'),
    height: 0, discipline: 'endurance', sire: null, dam: null,
    verified: { owner: false, passport: false, federation: false }, dna: false, lastVet: '',
    blurb: l('', ''),
  };
}

/* ---------------- hydration state ---------------- */

let hydrateStarted = false;
let hydrateDone = false;
const hydratedSubs = new Set<() => void>();
export const isHydrated = () => hydrateDone;

let browseState: 'loading' | 'ready' | 'failed' = 'loading';
const browseSubs = new Set<() => void>();
const subscribeBrowse = (fn: () => void) => { browseSubs.add(fn); return () => { browseSubs.delete(fn); }; };
export const useBrowseState = () => useSyncExternalStore(subscribeBrowse, () => browseState);
function setBrowseState(s: typeof browseState) { browseState = s; browseSubs.forEach(fn => fn()); }

function markHydrated() {
  if (hydrateDone) return;
  hydrateDone = true;
  hydratedSubs.forEach((x) => x());
}

/** Re-render trigger for pages already mounted while hydration finishes. */
export function useHydratedTick(): number {
  const [tick,setTick] = useState(hydrateDone ? 1 : 0);
  useEffect(() => { const fn = () => setTick(n => n+1); hydratedSubs.add(fn); if(hydrateDone)fn(); return () => { hydratedSubs.delete(fn); }; }, []);
  return tick;
}

function applyRows(rows: RegistryRow[], total: number | null) {
  const mapped = rows.map(mapRow);
  for (const h of mapped) registerHorse(h);
  HORSES.length = 0;
  HORSES.push(...mapped);
  if (total != null) setRegistryTotal(total);
  // parent shells: real names for parents outside the slice (never listed)
  for (const row of rows) {
    for (const [pid, pname, pfa, pgender] of [
      [row.father_id, row.father_name, row.father_name_native, 'stallion'],
      [row.mother_id, row.mother_name, row.mother_name_native, 'mare'],
    ] as const) {
      if (pid == null || ALL_BY_ID.has(String(pid))) continue;
      ALL_BY_ID.set(String(pid), shellOf(String(pid), l(pname, pfa), '', pgender as Horse['gender']));
    }
  }
}

/** Fetch the significance-ranked slice of the real registry. Runs once at
 * boot; the app renders the donor's demo set until this resolves (or fails
 * silently — the demo app stays fully usable either way). */
export async function hydrateRegistry(): Promise<void> {
  if (hydrateStarted) return;
  hydrateStarted = true;
  setBrowseState('loading');
  try {
    const first = await fetch(`/api/horses?sort=importance&limit=${PAGE_SIZE}&offset=0`, { signal: AbortSignal.timeout(12000), headers: { accept: 'application/json' } });
    if (!first.ok) throw new Error(`browse ${first.status}`);
    const head = await first.json() as { rows: RegistryRow[]; total: number };
    const total = typeof head.total === 'number' ? head.total : null;
    if (!Array.isArray(head.rows)) throw new Error('Invalid registry response');
    // Do not wait for seven optional pages before displaying genuine records.
    applyRows(head.rows,total); markHydrated(); setBrowseState('ready');
    const pages = head.rows.length < PAGE_SIZE ? 1 : Math.min(HYDRATE_PAGES, Math.ceil((total ?? HYDRATE_PAGES * PAGE_SIZE) / PAGE_SIZE));
    const rest = await Promise.all(
      Array.from({ length: Math.max(0,pages - 1) }, (_, k) => k + 1).map(async (page) => {
        try {
          const res = await fetch(`/api/horses?sort=importance&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, { headers: { accept: 'application/json' } });
          if (!res.ok) return [] as RegistryRow[];
          const body = await res.json() as { rows: RegistryRow[] };
          return body.rows ?? [];
        } catch { return [] as RegistryRow[]; }
      }),
    );
    if (rest.some(page => page.length)) { applyRows([...head.rows, ...rest.flat()], total); hydratedSubs.forEach(fn => fn()); }
  } catch { if (!hydrateDone) { hydrateStarted = false; setBrowseState('failed'); } }
}

/* ---------------- platform meta ---------------- */

/** Live public registry-wide statistics from GET /api/platform/meta — the
 * same numbers the core frontend presents. Fetched once per session. */
export type PlatformMeta = { horses: number; people: number; ownerLinks: number; breederLinks: number; horsesWithBothParents: number; horsesWithDnaData: number };
let platformMeta: PlatformMeta | null = null;
const metaSubs = new Set<() => void>();
let metaStarted = false;
async function hydrateMeta(): Promise<void> {
  if (metaStarted) return;
  metaStarted = true;
  try {
    const res = await fetch('/api/platform/meta', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const body = await res.json() as { stats?: Record<string, number> };
    const s = body.stats;
    if (!s) return;
    platformMeta = {
      horses: s.horses ?? 0, people: s.people ?? 0, ownerLinks: s.ownerLinks ?? 0, breederLinks: s.breederLinks ?? 0,
      horsesWithBothParents: s.horsesWithBothParents ?? 0, horsesWithDnaData: s.horsesWithDnaData ?? 0,
    };
    metaSubs.forEach((fn) => fn());
  } catch { /* offline: demo numbers stay */ }
}
export function usePlatformMeta(): PlatformMeta | null {
  const [v, setV] = useState<PlatformMeta | null>(platformMeta);
  useEffect(() => {
    hydrateMeta();
    const fn = () => setV(platformMeta);
    metaSubs.add(fn);
    return () => { metaSubs.delete(fn); };
  }, []);
  return v;
}

/* ---------------- live search ---------------- */

type SearchState = { loading: boolean; failed?: boolean; rows: Horse[] | null };

/** Server-backed search for the Explorer. null = no active query (local
 * filtering only); rows = the platform's forgiving-search answers. */
export function useLiveSearch(q: string): SearchState {
  const trimmed = q.trim();
  const [state, setState] = useState<SearchState>({ loading: false, rows: null });
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    if (trimmed.length < 2) { setState({ loading: false, rows: null }); return; }
    const controller = new AbortController();
    setState({ loading: true, rows: null });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal, headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json() as { results: RegistryRow[] };
        if (controller.signal.aborted || seq.current !== id) return;
        const rows = (body.results ?? []).map(mapRow);
        for (const h of rows) registerHorse(h); // pickers/stores resolve live ids via horseById
        setState({ loading: false, rows });
      } catch {
        if (controller.signal.aborted || seq.current !== id) return;
        setState({ loading: false, rows: null, failed: true });
      }
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [trimmed]);
  return state;
}

/* ---------------- live ancestor tree ---------------- */

/** One node of the platform's ancestor tree (GET /api/horses/:id/pedigree —
 * the same endpoint the core frontend's pedigree intelligence uses). */
type AncestorNode = { horse: RegistryRow; relation: string; generation: number; parents?: AncestorNode[] };

const ancestorTreesFetched = new Set<string>();

/* module-level lineage version — bumped every time ancestor rows land, so
 * memoized pedigree builders can recompute even when the `horse` prop object
 * itself did not change identity. */
let lineageVersion = 0;
const lineageSubs = new Set<() => void>();

/** Subscribe to ancestor-tree arrivals. Tree-building components must include
 * this in their buildPedigree memo deps or newly registered ancestors will
 * never appear. */
export function useLineageVersion(): number {
  const [v, setV] = useState(lineageVersion);
  useEffect(() => {
    const fn = () => setV(lineageVersion);
    lineageSubs.add(fn);
    return () => { lineageSubs.delete(fn); };
  }, []);
  return v;
}

/** Fetch the real ancestor tree for a horse and register every ancestor so the
 * donor's pedigree builder resolves generation after generation — real ids,
 * real names, real parent links, exactly as the database holds them. Horses
 * already known in full are left untouched; name-only shells are upgraded.
 * Returns true when the tree actually landed; failures are NOT cached, so a
 * later attempt retries instead of poisoning the session with an empty tree. */
export async function fetchAncestorTree(id: string, depth = 5, onTick?: () => void): Promise<boolean> {
  if (ancestorTreesFetched.has(id)) return false;
  try {
    const res = await fetch(`/api/horses/${encodeURIComponent(id)}/pedigree?depth=${depth}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return false;
    const body = await res.json() as { tree?: AncestorNode };
    if (!body.tree) return false;
    let added = 0;
    const walk = (n: AncestorNode) => {
      (n.parents ?? []).forEach(walk);
      const hid = n.horse && n.horse.id != null ? String(n.horse.id) : null;
      if (!hid || hid === id) return; // the root profile is owned by useLiveHorse
      const existing = ALL_BY_ID.get(hid);
      if (existing && existing.regId !== '') return;
      registerHorse(mapRow(n.horse));
      added++;
    };
    walk(body.tree);
    ancestorTreesFetched.add(id);
    if (added) {
      lineageVersion++;
      lineageSubs.forEach((f) => f());
      onTick?.();
    }
    return true;
  } catch { return false; /* the pedigree stays with whatever the hydrated slice knows */ }
}

/** Live lineage for the horse-detail views: pulls the platform's real ancestor
 * tree once per horse (cached for the session, failures retried) and
 * re-renders as it lands. */
export function useLineage(horse: Horse | undefined, depth = 5): number {
  const [tick, setTick] = useState(0);
  const id = horse?.id;
  const numeric = /^[0-9]+$/.test(id ?? '');
  useEffect(() => {
    if (!id || !numeric) return;
    let live = true;
    (async () => {
      // one immediate attempt, then two spaced retries — a transient network
      // or edge hiccup must not leave the pedigree empty for the whole session
      for (let attempt = 0; attempt < 3; attempt++) {
        const ok = await fetchAncestorTree(id, depth, () => { if (live) setTick((t) => t + 1); });
        if (ok || !live) return;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    })();
    return () => { live = false; };
  }, [id, numeric, depth]);
  return tick;
}

/* ---------------- live profile ---------------- */

/** Fetch a full profile for a horse outside the hydrated slice. */
export function useLiveHorse(id: string | null): Horse | undefined {
  const [horse, setHorse] = useState<Horse | undefined>(undefined);
  useEffect(() => {
    if (!id) { setHorse(undefined); return; }
    let live = true;
    setHorse(undefined);
    (async () => {
      try {
        const res = await fetch(`/api/horses/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
        if (!res.ok) return;
        const body = await res.json() as { horse: RegistryRow };
        if (!live || !body.horse) return;
        const mapped = mapRow(body.horse);
        registerHorse(mapped);
        if (live) setHorse(mapped);
      } catch { /* the profile view shows its own not-found state */ }
    })();
    return () => { live = false; };
  }, [id]);
  return horse;
}

/* =====================================================================
   R161 DATA PARITY — the remaining read endpoints the core (heritage)
   frontend serves, wired into the donor app through this same seam:
   people directory + person profiles, horse competitions + racing,
   descendants (offspring), pedigree intelligence (COI/completeness),
   registry-wide analytics, newsroom content, marketplace listings and
   the platform's breeding pairing analysis. All read-only, anonymous,
   failure-safe (the demo surfaces remain as fallback, nothing invented).
   ===================================================================== */

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

/** Extra live-only facts (microchip, deceased flag) kept beside the mapped
 * Horse without widening the donor's own data model. */
export type LiveHorseExtra = { microchip: string | null; deceased: boolean };
const liveExtras = new Map<string, LiveHorseExtra>();
export function liveExtraOf(id: string): LiveHorseExtra | null {
  return liveExtras.get(id) ?? null;
}
function noteExtras(row: RegistryRow) {
  const id = row.id != null ? String(row.id) : null;
  if (!id) return;
  const microchip = row.microchip_no != null && String(row.microchip_no).trim() !== '' ? String(row.microchip_no).trim() : null;
  const deceased = row.is_dead === 1 || row.is_dead === true;
  if (microchip || deceased) liveExtras.set(id, { microchip, deceased });
}

/* ---------------- people directory (live) ---------------- */

export type LivePerson = {
  id: number;
  name: L;
  ownerCount: number;
  breederCount: number;
  importerCount: number;
  passportCount: number;
};

export type LivePersonProfile = {
  person: LivePerson;
  horses: Array<{ horse: Horse; role: string }>;
  truncated: boolean;
};

function mapPerson(p: { id: number; name_latin?: string | null; name_native?: string | null; owner_count?: number; breeder_count?: number; importer_count?: number; passport_receiver_count?: number }): LivePerson {
  return {
    id: p.id,
    name: l(p.name_latin, p.name_native),
    ownerCount: p.owner_count ?? 0,
    breederCount: p.breeder_count ?? 0,
    importerCount: p.importer_count ?? 0,
    passportCount: p.passport_receiver_count ?? 0,
  };
}

/** Search/paginate the platform people registry (GET /api/people). */
export async function fetchPeople(q: string, limit = 60, offset = 0, breedersOnly = false): Promise<{ people: LivePerson[]; nextOffset: number | null } | null> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (breedersOnly) params.set("role","breeder");
  if (q.trim()) params.set('q', q.trim());
  const body = await getJSON<{ people?: Parameters<typeof mapPerson>[0][]; nextOffset?: number | null }>(`/api/people?${params.toString()}`);
  if (!body || !Array.isArray(body.people)) return null;
  return { people: body.people.map(mapPerson), nextOffset: body.nextOffset === undefined ? (body.people.length >= limit ? offset + body.people.length : null) : body.nextOffset };
}

/** One person's profile with the horses they are linked to (GET /api/people/:id). */
export async function fetchPersonProfile(id: number): Promise<LivePersonProfile | null> {
  const body = await getJSON<{ person?: Parameters<typeof mapPerson>[0]; horses?: Array<RegistryRow & { role?: string }>; truncated?: boolean }>(`/api/people/${id}`);
  if (!body || !body.person) return null;
  const horses = (body.horses ?? []).map((row) => ({ horse: mapRow(row), role: row.role ?? '' }));
  for (const h of horses) registerHorse(h.horse);
  return { person: mapPerson(body.person), horses, truncated: body.truncated ?? false };
}

/* ---------------- horse competitions + racing (live) ---------------- */

export type LiveCompetitionResult = {
  event: string;
  date: string | null;
  discipline: string | null;
  className: string | null;
  rider: string | null;
  club: string | null;
  placement: number | null;
  placementText: string | null;
  score: string | null;
  eliminated: boolean;
  withdrawn: boolean;
};

export type LiveCompetitions = {
  starts: number;
  wins: number;
  podium: number;
  eliminations: number;
  results: LiveCompetitionResult[];
  hasMore: boolean;
};

export type LiveRacingResult = {
  date: string | null;
  season: string | null;
  location: string | null;
  raceName: string | null;
  plan: string | null;
  distanceM: number | null;
  rank: number | null;
  timeS: number | null;
  rider: string | null;
  ran: boolean;
};

export type LiveRacing = {
  starts: number;
  wins: number;
  seconds: number;
  thirds: number;
  firstRace: string | null;
  lastRace: string | null;
  seasons: number;
  results: LiveRacingResult[];
  source: string;
};

export async function fetchHorseCompetitions(id: string): Promise<LiveCompetitions | null> {
  const body = await getJSON<{
    summary?: { starts?: number; wins?: number; podium?: number; eliminations?: number };
    results?: Array<{
      competition_name?: string | null; name_latin?: string | null; name_native?: string | null;
      event_date?: string | null; class_name?: string | null; rider_name?: string | null; rider_club?: string | null;
      placement?: number | null; placement_text?: string | null; score?: string | null;
      is_eliminated?: number; is_withdrawn?: number;
    }>;
    history_page?: { has_more?: boolean };
  }>(`/api/horses/${encodeURIComponent(id)}/competitions`);
  if (!body) return null;
  const results = (body.results ?? []).map((r) => ({
    event: r.competition_name ?? r.name_latin ?? r.name_native ?? '—',
    date: r.event_date ?? null,
    discipline: null,
    className: r.class_name ?? null,
    rider: r.rider_name ?? null,
    club: r.rider_club ?? null,
    placement: r.placement ?? null,
    placementText: r.placement_text ?? null,
    score: r.score ?? null,
    eliminated: r.is_eliminated === 1,
    withdrawn: r.is_withdrawn === 1,
  }));
  const s = body.summary ?? {};
  return {
    starts: s.starts ?? results.length,
    wins: s.wins ?? 0,
    podium: s.podium ?? 0,
    eliminations: s.eliminations ?? 0,
    results,
    hasMore: body.history_page?.has_more ?? false,
  };
}

export async function fetchHorseRacing(id: string): Promise<LiveRacing | null> {
  const body = await getJSON<{
    summary?: { starts?: number; wins?: number; second_places?: number; third_places?: number; first_race_date?: string | null; last_race_date?: string | null; seasons_count?: number };
    results?: Array<{
      week_date?: string | null; season?: string | null; location?: string | null; race_name?: string | null;
      plan_name?: string | null; distance_m?: number | null; rank?: number | null; time_s?: number | null;
      rider_name?: string | null; is_run?: number | null;
    }>;
    provenance?: { source?: string };
  }>(`/api/horses/${encodeURIComponent(id)}/racing`);
  if (!body) return null;
  const s = body.summary;
  // no record at all (all-null summary, no rows) → null so the page shows its honest empty state
  if (!s && !(body.results ?? []).length) return null;
  const results = (body.results ?? []).map((r) => ({
    date: r.week_date ?? null,
    season: r.season ?? null,
    location: r.location ?? null,
    raceName: r.race_name ?? null,
    plan: r.plan_name ?? null,
    distanceM: r.distance_m ?? null,
    rank: r.rank ?? null,
    timeS: r.time_s ?? null,
    rider: r.rider_name ?? null,
    ran: r.is_run !== 0,
  }));
  return {
    starts: s?.starts ?? results.length,
    wins: s?.wins ?? 0,
    seconds: s?.second_places ?? 0,
    thirds: s?.third_places ?? 0,
    firstRace: s?.first_race_date ?? null,
    lastRace: s?.last_race_date ?? null,
    seasons: s?.seasons_count ?? 0,
    results,
    source: body.provenance?.source ?? 'asbdavani',
  };
}

/* ---------------- descendants / offspring (live) ---------------- */

export async function fetchDescendants(id: string, depth = 1): Promise<{ kids: Horse[]; truncated: boolean } | null> {
  const body = await getJSON<{ tree?: { horse?: RegistryRow; children?: Array<{ horse?: RegistryRow; relation?: string }> }; truncated?: boolean }>(
    `/api/horses/${encodeURIComponent(id)}/descendants?depth=${depth}`,
  );
  if (!body || !body.tree) return null;
  const kids: Horse[] = [];
  for (const child of body.tree.children ?? []) {
    if (!child.horse || child.horse.id == null) continue;
    const mapped = mapRow(child.horse);
    registerHorse(mapped);
    kids.push(mapped);
  }
  return { kids, truncated: body.truncated ?? false };
}

/* ---------------- pedigree intelligence (live COI) ---------------- */

export type LiveCoefficients = {
  inbreedingPercent: number | null;
  completenessPercent: number;
  analyzedHorses: number;
  zeroWithinIncomplete: boolean;
  status: string;
};

export async function fetchCoefficients(id: string, depth = 4): Promise<LiveCoefficients | null> {
  const body = await getJSON<{
    inbreedingPercent?: number | null; pedigreeCompletenessPercent?: number; analyzedHorses?: number;
    zeroWithinIncompleteAncestry?: boolean; status?: string;
  }>(`/api/horses/${encodeURIComponent(id)}/pedigree/coefficients?depth=${depth}`);
  if (!body || body.status === undefined && body.pedigreeCompletenessPercent === undefined) return null;
  return {
    inbreedingPercent: body.inbreedingPercent ?? null,
    completenessPercent: body.pedigreeCompletenessPercent ?? 0,
    analyzedHorses: body.analyzedHorses ?? 0,
    zeroWithinIncomplete: body.zeroWithinIncompleteAncestry ?? false,
    status: body.status ?? 'ok',
  };
}

/* ---------------- registry-wide analytics (live) ---------------- */

export type LiveAnalytics = {
  horseCount: number;
  algorithmVersion: string;
  birthDecades: Array<{ decade: number; count: number }>;
  sexDistribution: Array<{ label: string; count: number }>;
  topBreeds: Array<{ label: string; count: number }>;
  topBirthPlaces: Array<{ label: string; count: number }>;
  parentage: { bothParentsPercent: number; oneParentPercent: number; noParentsPercent: number } | null;
  activity: { active?: { count: number; percent: number }; deceased?: { count: number; percent: number }; imported?: { count: number; percent: number }; stallions?: { count: number; percent: number } } | null;
};

let liveAnalytics: LiveAnalytics | null = null;
const analyticsSubs = new Set<() => void>();
let analyticsStarted = false;

/** GET /api/analytics/registry — the same analytical workspace the core
 * frontend's /stats pages render, fetched once per session. */
export function useRegistryAnalytics(): LiveAnalytics | null {
  const [v, setV] = useState<LiveAnalytics | null>(liveAnalytics);
  useEffect(() => {
    if (!analyticsStarted) {
      analyticsStarted = true;
      (async () => {
        const body = await getJSON<Record<string, unknown>>('/api/analytics/registry');
        if (!body || typeof body.horseCount !== 'number') return;
        const parentage = body.parentage as { bothParentsPercent?: number; oneParentPercent?: number; noParentsPercent?: number } | undefined;
        liveAnalytics = {
          horseCount: body.horseCount,
          algorithmVersion: String(body.algorithmVersion ?? ''),
          birthDecades: (body.birthDecades as Array<{ decade: number; count: number }>) ?? [],
          sexDistribution: (body.sexDistribution as Array<{ label: string; count: number }>) ?? [],
          topBreeds: (body.topBreeds as Array<{ label: string; count: number }>) ?? [],
          topBirthPlaces: (body.topBirthPlaces as Array<{ label: string; count: number }>) ?? [],
          parentage: parentage ? { bothParentsPercent: parentage.bothParentsPercent ?? 0, oneParentPercent: parentage.oneParentPercent ?? 0, noParentsPercent: parentage.noParentsPercent ?? 0 } : null,
          activity: (body.activity as LiveAnalytics['activity']) ?? null,
        };
        analyticsSubs.forEach((fn) => fn());
      })();
    }
    const fn = () => setV(liveAnalytics);
    analyticsSubs.add(fn);
    return () => { analyticsSubs.delete(fn); };
  }, []);
  return v;
}

/* ---------------- newsroom content (live) ---------------- */

export type LivePost = {
  id: string;
  kind: string;
  title: L;
  summary: L;
  body: L;
  tags: string[];
  cover: string | null;
  publishedAt: string | null;
  author: string | null;
};

export async function fetchContentPosts(limit = 12, offset = 0): Promise<{ posts: LivePost[]; total: number } | null> {
  const body = await getJSON<{
    posts?: Array<{
      id?: string; slug?: string; kind?: string;
      title_en?: string; title_fa?: string; summary_en?: string; summary_fa?: string; body_en?: string; body_fa?: string;
      tags?: string[]; cover_image_url?: string | null; published_at?: string | null; author_label?: string | null;
    }>;
    total?: number;
  }>(`/api/content/posts?limit=${limit}&offset=${offset}`);
  if (!body || !Array.isArray(body.posts)) return null;
  return {
    posts: body.posts.map((p) => ({
      id: p.id ?? p.slug ?? '',
      kind: p.kind ?? 'article',
      title: l(p.title_en, p.title_fa),
      summary: l(p.summary_en, p.summary_fa),
      body: l(p.body_en, p.body_fa),
      tags: p.tags ?? [],
      cover: p.cover_image_url ?? null,
      publishedAt: p.published_at ?? null,
      author: p.author_label ?? null,
    })),
    total: body.total ?? body.posts.length,
  };
}

/* ---------------- marketplace listings (live) ---------------- */

export type LiveListing = {
  id: string;
  horseId: number | null;
  title: string | null;
  horseName: L;
  breed: L;
  sex: string | null;
  birthYear: number | null;
  priceToman: number | null;
  priceVisible: boolean;
  negotiable: boolean;
  city: string | null;
  starts: number | null;
  status: string;
  listedAt: string;
};

export async function fetchMarketListings(limit = 24, offset = 0): Promise<{ listings: LiveListing[]; total: number } | null> {
  const body = await getJSON<{
    rows?: Array<{
      id?: string; horse_id?: number | null; title?: string | null; name_latin?: string | null; name_native?: string | null;
      breed_desc?: string | null; sex_desc?: string | null; birth_year?: number | null;
      asking_price_toman?: number | null; price_visible?: number; negotiable?: number; seller_city?: string | null;
      competition_starts?: number | null; status?: string; listed_at?: string;
    }>;
    total?: number;
  }>(`/api/market/listings?limit=${limit}&offset=${offset}`);
  if (!body || !Array.isArray(body.rows)) return null;
  return {
    listings: body.rows.map((r) => ({
      id: r.id ?? '',
      horseId: r.horse_id ?? null,
      title: r.title ?? null,
      horseName: l(r.name_latin, r.name_native),
      breed: l(r.breed_desc, r.breed_desc),
      sex: r.sex_desc ?? null,
      birthYear: r.birth_year ?? null,
      priceToman: r.asking_price_toman ?? null,
      priceVisible: r.price_visible !== 0,
      negotiable: r.negotiable === 1,
      city: r.seller_city ?? null,
      starts: r.competition_starts ?? null,
      status: r.status ?? 'active',
      listedAt: r.listed_at ?? '',
    })),
    total: body.total ?? body.rows.length,
  };
}

/* ---------------- breeding pairing analysis (live) ---------------- */

export type LivePairing = {
  projectedCoiPercent: number | null;
  relationshipPercent: number | null;
  kinshipPercent: number | null;
  sireCoiPercent: number | null;
  damCoiPercent: number | null;
  sireCompleteness: number|null;
  damCompleteness: number|null;
  commonAncestors: Array<{ id: number; name: L; occurrences: number; generation: number | null }>;
  classification: string | null;
  classificationLabel: string | null;
  closeMatingWarning: boolean;
  closeMatingWarningText: string | null;
  foalAvkPercent: number | null;
};

type CommonAncestorRow = { horse?: { id?: number; name_latin?: string | null; name_native?: string | null }; occurrences?: number; nearestGeneration?: number | null };

export async function fetchPairingAnalysis(sireId: string, damId: string, depth = 4): Promise<LivePairing | null> {
  if (!/^[0-9]+$/.test(sireId) || !/^[0-9]+$/.test(damId) || sireId === damId) return null;
  const body = await getJSON<{
    projectedOffspringInbreedingPercent?: number | null;
    parentalRelationshipPercent?: number | null;
    parentalKinshipPercent?: number | null;
    sireInbreedingPercent?: number | null;
    damInbreedingPercent?: number | null;
    sirePedigreeCompletenessPercent?: number;
    damPedigreeCompletenessPercent?: number;
    commonAncestors?: CommonAncestorRow[];
    verdict?: { classification?: string; classificationLabel?: string; closeMatingWarning?: boolean; closeMatingWarningText?: string | null };
    ancestorLoss?: { projectedFoalAvkPercent?: number | null };
  }>(`/api/breeding/pairing-analysis?sire=${encodeURIComponent(sireId)}&dam=${encodeURIComponent(damId)}&depth=${depth}`);
  if (!body) return null;
  return {
    projectedCoiPercent: body.projectedOffspringInbreedingPercent ?? null,
    relationshipPercent: body.parentalRelationshipPercent ?? null,
    kinshipPercent: body.parentalKinshipPercent ?? null,
    sireCoiPercent: body.sireInbreedingPercent ?? null,
    damCoiPercent: body.damInbreedingPercent ?? null,
    sireCompleteness: body.sirePedigreeCompletenessPercent ?? null,
    damCompleteness: body.damPedigreeCompletenessPercent ?? null,
    commonAncestors: (body.commonAncestors ?? []).map((c) => ({
      id: c.horse?.id ?? 0,
      name: l(c.horse?.name_latin, c.horse?.name_native),
      occurrences: c.occurrences ?? 0,
      generation: c.nearestGeneration ?? null,
    })),
    classification: body.verdict?.classification ?? null,
    classificationLabel: body.verdict?.classificationLabel ?? null,
    closeMatingWarning: body.verdict?.closeMatingWarning ?? false,
    closeMatingWarningText: body.verdict?.closeMatingWarningText ?? null,
    foalAvkPercent: body.ancestorLoss?.projectedFoalAvkPercent ?? null,
  };
}

/* ---------------- generic on-mount fetch hook ---------------- */

/** Fetch-once-per-key state helper: (null, false) = loading/not applicable,
 * (data, false) = ready, (null, true) = genuinely empty or failed. */
export function useLiveFetch<T>(key: string | null, fetcher: (k: string) => Promise<T | null>): { data: T | null; done: boolean } {
  const [state, setState] = useState<{ data: T | null; done: boolean }>({ data: null, done: false });
  useEffect(() => {
    if (!key) { setState({ data: null, done: false }); return; }
    let live = true;
    setState({ data: null, done: false });
    (async () => {
      const data = await fetcher(key);
      if (live) setState({ data, done: true });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/* ---------------- professional directory (live) ---------------- */

export type LiveDirectoryPerson = {
  personId: number;
  name: L;
  categories: string[];
  province: string | null;
  provinceNeedsReview: boolean;
  city: string | null;
  languages: string | null;
  availability: string | null;
  contactNote: string;
};

export type LiveDirectoryCredential = {
  role: string;
  issuerName: string;
  identifier: string;
  issuedAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  verificationLevel: string;
  verificationState: string;
};

function mapDirectoryPerson(p: {
  person_id?: number; name_latin?: string | null; name_native?: string | null; service_categories?: string[];
  province_code?: string | null; province_needs_review?: boolean; city?: string | null;
  languages?: string | null; availability_text?: string | null; contact_note?: string;
}): LiveDirectoryPerson {
  return {
    personId: p.person_id ?? 0,
    name: l(p.name_latin, p.name_native),
    categories: p.service_categories ?? [],
    province: p.province_code ?? null,
    provinceNeedsReview: p.province_needs_review ?? false,
    city: p.city ?? null,
    languages: p.languages ?? null,
    availability: p.availability_text ?? null,
    contactNote: p.contact_note ?? '',
  };
}

export async function fetchDirectoryPersons(opts: { category?: string; name?: string; cursor?: number } = {}): Promise<{ persons: LiveDirectoryPerson[]; nextCursor: number | null } | null> {
  const params = new URLSearchParams();
  if (opts.category) params.set('category', opts.category);
  if (opts.name?.trim()) params.set('name', opts.name.trim());
  if (opts.cursor != null) params.set('cursor', String(opts.cursor));
  const body = await getJSON<{ persons?: Parameters<typeof mapDirectoryPerson>[0][]; next_cursor?: number | null }>(`/api/directory/persons?${params.toString()}`);
  if (!body || !Array.isArray(body.persons)) return null;
  return { persons: body.persons.map(mapDirectoryPerson), nextCursor: body.next_cursor ?? null };
}

export async function fetchDirectoryPerson(id: number): Promise<{ person: LiveDirectoryPerson; credentials: LiveDirectoryCredential[] } | null> {
  const body = await getJSON<{
    person?: Parameters<typeof mapDirectoryPerson>[0];
    credentials?: Array<{ role?: string; issuer_name?: string; identifier?: string; issued_at?: string | null; expires_at?: string | null; is_active?: boolean; verification_level?: string; verification_state?: string }>;
  }>(`/api/directory/persons/${id}`);
  if (!body || !body.person) return null;
  return {
    person: mapDirectoryPerson(body.person),
    credentials: (body.credentials ?? []).map((c) => ({
      role: c.role ?? '',
      issuerName: c.issuer_name ?? '',
      identifier: c.identifier ?? '',
      issuedAt: c.issued_at ?? null,
      expiresAt: c.expires_at ?? null,
      isActive: c.is_active ?? false,
      verificationLevel: c.verification_level ?? '',
      verificationState: c.verification_state ?? '',
    })),
  };
}

/* ---------------- sport: federation races + competition calendar (live) ---------------- */

export type LiveRaceRow = {
  raceId: string;
  name: string | null;
  date: string | null;
  location: string | null;
  distanceM: number | null;
  ageClass: string | null;
  breed: string | null;
  status: string | null;
  starters: number | null;
  prizes: string | null;
};

export type LiveCompetitionRow = {
  id: number;
  name: L;
  date: string;
  venue: string;
  discipline: string;
  tier: string;
  season: number;
  resultCount: number | null;
};

export async function fetchRacingRaces(limit = 12, offset = 0): Promise<{ races: LiveRaceRow[]; total: number; source: string } | null> {
  const body = await getJSON<{
    races?: Array<{ race_id?: string; race_name?: string | null; week_date?: string | null; location?: string | null; distance_m?: number | null; age_class?: string | null; breed?: string | null; status?: string | null; starters_count?: number; prizes?: string | null }>;
    total?: number;
    provenance?: { source?: string };
  }>(`/api/racing/races?limit=${limit}&offset=${offset}`);
  if (!body || !Array.isArray(body.races)) return null;
  return {
    races: body.races.map((r) => ({
      raceId: r.race_id ?? '',
      name: r.race_name ?? null,
      date: r.week_date ?? null,
      location: r.location ?? null,
      distanceM: r.distance_m ?? null,
      ageClass: r.age_class ?? null,
      breed: r.breed ?? null,
      status: r.status ?? null,
      starters: r.starters_count ?? null,
      prizes: r.prizes ?? null,
    })),
    total: body.total ?? body.races.length,
    source: body.provenance?.source ?? 'asbdavani',
  };
}

export async function fetchCompetitions(limit = 12, offset = 0): Promise<{ rows: LiveCompetitionRow[]; total: number } | null> {
  const body = await getJSON<{
    rows?: Array<{ id?: number; name_native?: string; name_latin?: string | null; event_date?: string; venue?: string; discipline?: string; tier?: string; season?: number; result_count?: number }>;
    total?: number;
  }>(`/api/competitions?limit=${limit}&offset=${offset}`);
  if (!body || !Array.isArray(body.rows)) return null;
  return {
    rows: body.rows.map((r) => ({
      id: r.id ?? 0,
      name: l(r.name_latin ?? r.name_native, r.name_native),
      date: r.event_date ?? '',
      venue: r.venue ?? '',
      discipline: r.discipline ?? '',
      tier: r.tier ?? '',
      season: r.season ?? 0,
      resultCount: r.result_count ?? null,
    })),
    total: body.total ?? body.rows.length,
  };
}
