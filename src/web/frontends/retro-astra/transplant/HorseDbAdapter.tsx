import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  FrontendRuntimeProps,
  HorseRecord,
  HorseProfileResponse,
  HorseInsightsResponse,
  RegistryBrowseParams,
  RegistryBrowseResponse,
  RegistryFacetsResponse,
} from '../../../../frontend-kit';
import type { Horse, HorseStatus, Sex } from './data/horses';
// R117-29: canonical donor category — see data/horses.ts donorSexCategory.
import { donorSexCategory } from './data/horses';
import greyHorse from '../assets/donor/grey-horse.webp';
import pasture from '../assets/donor/heritage-pasture.webp';
import studbookHero from '../assets/donor/studbook-hero.webp';

// R117-29: sexOf removed. The donor category now derives from the canonical
// kit classifier (data/horses.ts donorSexCategory): colt and کره نر are male,
// filly and کره ماده are female — exact vocabulary, never a substring guess.
// The raw source value stays untouched in recordedSex.
function statusOf(record: HorseRecord): HorseStatus {
  if (record.is_dead) return 'Deceased';
  if (record.is_active) return 'Active';
  if (record.is_imported) return 'Imported';
  return 'Recorded';
}
function decorativeImage(record: HorseRecord) {
  if ((record.color_desc??'').toLowerCase().includes('grey') || (record.color_desc??'').includes('خاکست')) return greyHorse;
  return record.id % 2 ? pasture : studbookHero;
}
function recordSummary(record: HorseRecord) {
  const parts=[record.register_no ? `Registry ${record.register_no}` : `Horse DB #${record.id}`];
  if(record.birth_year) parts.push(`foaled ${record.birth_year}`);
  if(record.breed_desc) parts.push(record.breed_desc);
  if(record.birth_place_desc) parts.push(`recorded at ${record.birth_place_desc}`);
  return `${parts.join(' · ')}. This text summarizes canonical registry fields; the decorative reference image is not a canonical horse photograph.`;
}

export function toDonorHorse(record: HorseRecord, extra: Partial<Horse> = {}): Horse {
  return {
    id:String(record.id), numericId:record.id,
    name:record.name_latin || record.name_native || `Horse #${record.id}`,
    nativeName:record.name_native || undefined,
    year:record.birth_year || 0,
    sex:donorSexCategory(record.sex_desc), recordedSex:record.sex_desc,
    breed:record.breed_desc || record.breed_type || '—',
    coat:record.color_desc || '—',
    country:record.birth_place_desc || record.imported_from_desc || '—',
    height:'—',
    status:statusOf(record),
    sireId:record.father_id ? String(record.father_id) : undefined,
    damId:record.mother_id ? String(record.mother_id) : undefined,
    sireName:record.father_name || record.father_name_native || undefined,
    damName:record.mother_name || record.mother_name_native || undefined,
    image:decorativeImage(record), imageCanonical:false,
    stud:record.breeder_name || record.breeder_name_native || '—',
    owner:record.owner_name || record.owner_name_native || '—',
    registration:record.register_no || record.life_number || `HDB-${record.id}`,
    description:recordSummary(record),
    knownParents:Number(Boolean(record.father_id))+Number(Boolean(record.mother_id)),
    imported:Boolean(record.is_imported), ...extra,
  };
}

interface AdapterValue {
  runtime: FrontendRuntimeProps;
  horses: Horse[];
  total: number;
  facets: RegistryFacetsResponse | null;
  loading: boolean;
  error: string | null;
  lastBrowse: RegistryBrowseResponse | null;
  browse: (params?: RegistryBrowseParams) => Promise<RegistryBrowseResponse>;
  horseProfile: (id:number) => Promise<{profile:HorseProfileResponse; horse:Horse; insights:HorseInsightsResponse|null}>;
  /** Stable, presentation-safe horse list for featured surfaces. Unlike
   * `horses` (which every browse — including the directory's default
   * name-ascending sort — replaces wholesale), this list is captured once
   * from the initial registry-order load and never overwritten. R62: the
   * legacy data contains dash-named records that sort first by name and
   * must never become the featured record. */
  featuredHorses: Horse[];
}
const AdapterContext=createContext<AdapterValue|null>(null);

export function HorseDbAdapterProvider({runtime,children}:{runtime:FrontendRuntimeProps;children:ReactNode}){
  const [horses,setHorses]=useState<Horse[]>([]);
  const [featuredHorses,setFeaturedHorses]=useState<Horse[]>([]);
  const [total,setTotal]=useState(runtime.platformMeta?.stats.horses ?? 0);
  const [facets,setFacets]=useState<RegistryFacetsResponse|null>(null);
  const [lastBrowse,setLastBrowse]=useState<RegistryBrowseResponse|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  const browse=useCallback(async(params:RegistryBrowseParams={})=>{
    const response=await runtime.platform.registry.browse(params);
    setLastBrowse(response); setTotal(response.total); setHorses(response.rows.map(row=>toDonorHorse(row)));
    return response;
  },[runtime.platform]);

  useEffect(()=>{
    let active=true;
    setLoading(true); setError(null);
    Promise.all([
      runtime.platform.registry.browse({limit:24,offset:0,sort:'id',dir:'asc'}),
      runtime.platform.registry.facets().catch(()=>null),
    ]).then(([response,nextFacets])=>{
      if(!active)return; setLastBrowse(response);setTotal(response.total);setHorses(response.rows.map(row=>toDonorHorse(row)));setFacets(nextFacets);
      // R62: capture the registry-order opening page as the stable featured
      // pool (foundation records — named, with lineage) before any page's
      // browse can replace the shared `horses` list with a name-ascending
      // page full of legacy dash-named records.
      setFeaturedHorses(response.rows.map(row=>toDonorHorse(row)));
    }).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:String(reason));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[runtime.platform]);

  const horseProfile=useCallback(async(id:number)=>{
    const [profile,insights]=await Promise.all([
      runtime.platform.horses.get(id),
      runtime.platform.analytics.horseInsights(id).catch(()=>null),
    ]);
    const metrics=insights?.pedigreeMetrics;
    const coefficient=insights?.pedigreeCoefficient;
    const descendant=insights?.descendantMetrics;
    const horse=toDonorHorse(profile.horse,{
      aliases:profile.aliases.map(item=>item.alias),
      recordedOffspring:descendant?.knownDescendants ?? null,
      pedigreeCompleteness:metrics?.completenessPercent ?? null,
      inbreedingCoefficient:coefficient?.inbreedingCoefficient ?? null,
      owner:profile.people.find(item=>item.role==='owner'&&item.is_current)?.name_latin || profile.people.find(item=>item.role==='owner')?.name_latin || profile.horse.owner_name || '—',
    });
    setHorses(previous=>[horse,...previous.filter(item=>item.id!==horse.id)]);
    return {profile,horse,insights};
  },[runtime.platform]);

  const value=useMemo<AdapterValue>(()=>({runtime,horses,total,facets,loading,error,lastBrowse,browse,horseProfile,featuredHorses}),[runtime,horses,total,facets,loading,error,lastBrowse,browse,horseProfile,featuredHorses]);
  return <AdapterContext.Provider value={value}>{children}</AdapterContext.Provider>;
}
export function useHorseDbAdapter(){const value=useContext(AdapterContext);if(!value)throw new Error('HorseDbAdapterProvider is required.');return value;}
