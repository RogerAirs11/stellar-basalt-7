import type { StrCall, StrComparison } from '../contracts/equineCare';
export interface StrProfile {panel_version:string;nomenclature:string;calls:StrCall[]}
/** Product screening floor, NOT a claim of an accredited laboratory standard.
 * An official exclusion/confirmation needs the laboratory's validated panel,
 * QC, mutation model, population frequencies and chain of identity. */
export const STR_SCREENING_MINIMUM_COMPARABLE_MARKERS=12;
function mapCalls(profile:StrProfile):Map<string,StrCall> {
  const map=new Map<string,StrCall>();
  if(!profile || !Array.isArray(profile.calls) || profile.calls.length>64)throw new Error('Invalid bounded STR profile');
  for(const call of profile.calls){
    const key=call.marker.trim().toUpperCase();
    if(map.has(key))throw new Error('Duplicate STR marker');
    if(!key || !Array.isArray(call.alleles) || call.alleles.length!==2)throw new Error('A diploid STR call needs two explicitly reported alleles');
    map.set(key,call);
  }
  return map;
}
function usable(call:StrCall|undefined):call is StrCall {
  return !!call && call.quality==='pass' && call.alleles.every(a=>typeof a==='string' && /^[A-Za-z0-9.+-]{1,24}$/.test(a) && !['0','0.0','-','NA','N','NULL','UNKNOWN'].includes(a.toUpperCase()));
}
export function compareStrTrio(child:StrProfile,sire:StrProfile,dam:StrProfile):StrComparison {
  const profiles=[child,sire,dam].map(mapCalls),excluded:string[]=[],incompatible:string[]=[];
  const aligned=!!child.panel_version && !!child.nomenclature && [sire,dam].every(p=>p.panel_version===child.panel_version && p.nomenclature===child.nomenclature);
  let compared=0;
  const markers=new Set(profiles.flatMap(p=>[...p.keys()]));
  for(const marker of [...markers].sort()){
    const c=profiles[0]!.get(marker),s=profiles[1]!.get(marker),d=profiles[2]!.get(marker);
    if(!aligned||!usable(c)||!usable(s)||!usable(d)){excluded.push(marker);continue;}
    compared++;
    const [a,b]=c.alleles;
    if(!((s.alleles.includes(a)&&d.alleles.includes(b))||(s.alleles.includes(b)&&d.alleles.includes(a))))incompatible.push(marker);
  }
  const status:StrComparison['status']=incompatible.length?'incompatible_at_tested_markers':compared>=STR_SCREENING_MINIMUM_COMPARABLE_MARKERS?'compatible_at_tested_markers':'insufficient_evidence';
  return {status,compared_markers:compared,excluded_markers:excluded,incompatible_markers:incompatible,panel_version:child.panel_version,method:'diploid-trio-transmission-v1',probability_of_parentage:null,official_parentage_confirmed:false,limitations:[
    `This local screening policy needs ${STR_SCREENING_MINIMUM_COMPARABLE_MARKERS} comparable passing markers for a compatibility statement; this engineering floor is not an accreditation or a universal laboratory acceptance standard.`,
    'A compatible trio is not proof of parentage; alternative parents can share the same alleles. No parentage probability is computed without validated population allele frequencies and a statistical model.',
    'Incompatible markers require laboratory review for sample identity, technical error, mutation and other explanations; the app does not issue an official exclusion.',
    'Only identically versioned panels and allele nomenclature are compared. Missing, failed or uncertain calls are excluded and never imputed.',
  ]};
}
