import type { ClinicalEventInput, ReproductiveEpisodeInput, StoredReproductiveMaterial } from '../contracts/equineCare';
import { HttpError } from '../api/http';
import { dateBounds } from '../registry/registrationDetails';
import { parseRegistryDate } from '../registry/dates';
import type { CareContext, SqlGuard } from './access';

export interface CareLifecycleRow {
  id:number;row_version:number;sex_desc:string|null;is_dead:number;life_status:string;
  birth_date_value:string|null;birth_date_precision:string|null;birth_date_calendar:string|null;
  death_date_value:string|null;death_date_precision:string|null;death_date_calendar:string|null;
}
export const CARE_LIFECYCLE_COLUMNS='id,sex_desc,row_version,is_dead,life_status,birth_date_value,birth_date_precision,birth_date_calendar,death_date_value,death_date_precision,death_date_calendar';

/** No calendar/precision default for historical rows. Unknown dates remain
 * uncertain, and an overlapping partial period never becomes a definite day. */
function interval(row:CareLifecycleRow,event:'birth'|'death'):{min:number;max:number}|null {
  const value=row[`${event}_date_value`],precision=row[`${event}_date_precision`],calendar=row[`${event}_date_calendar`];
  if(!value || !['day','month','year'].includes(precision??'') || !['gregorian','solar_hijri'].includes(calendar??''))return null;
  try {
    const parsed=parseRegistryDate({value,precision,calendar},9999);if(!parsed.ok)return null;
    const bounds=dateBounds(parsed.date);return Number.isFinite(bounds.min)&&Number.isFinite(bounds.max)?bounds:null;
  }catch{return null;}
}
function eventTime(day:string):number {return dateBounds({value:day,precision:'day',calendar:'gregorian'}).min;}
function conflict(row:CareLifecycleRow,field:string,message:string):never {
  throw new HttpError(422,'care_lifecycle_conflict',message,{horse_id:Number(row.id),field});
}
function noPrebirth(row:CareLifecycleRow,day:string|null|undefined,field:string):void {
  if(!day)return;const birth=interval(row,'birth');
  if(birth && eventTime(day)<birth.min)conflict(row,field,'The event precedes the entire recorded birth interval; review the event or canonical lifecycle record');
}
function afterDeath(row:CareLifecycleRow,day:string|null|undefined):boolean {
  const death=interval(row,'death');return Boolean(day&&death&&eventTime(day)>death.max);
}
function liveEvent(row:CareLifecycleRow,day:string|null|undefined,field:string,storedMaterial=false):void {
  noPrebirth(row,day,field);
  // A missing historical death date is not a guessed date. Independently,
  // current deceased status rules out a future physical event. Documented
  // genetic material may still be used; it does not keep the donor alive.
  if(!storedMaterial&&day&&day>new Date().toISOString().slice(0,10)&&(Number(row.is_dead)===1||row.life_status==='dead'))conflict(row,field,'A horse currently recorded deceased cannot have a future live-animal event');
  if(!storedMaterial&&afterDeath(row,day))conflict(row,field,'The live-animal event follows the entire recorded death interval; review the event or canonical lifecycle record');
}
export async function clinicalLifecycleGuard(context:CareContext,input:ClinicalEventInput,voiding=false):Promise<SqlGuard> {
  const row=await context.db.prepare(`SELECT ${CARE_LIFECYCLE_COLUMNS} FROM horses WHERE id=? AND deleted_at IS NULL`).bind(context.horseId).first<CareLifecycleRow>();
  if(!row)throw new HttpError(422,'invalid_care_subject','The clinical subject is unavailable');
  // A contradictory historical entry must remain voidable. This preserves its
  // history without validating the original assertion as an observed fact.
  if(!voiding){
    const kind=input.lifecycle_context?.kind;
    if(kind==='record_review'){
      // This is explicitly the date of reviewing records, not a physical event
      // or a relabeling of medication/vaccination after death.
    }else if(kind==='postmortem'){
      noPrebirth(row,input.occurred_on,'occurred_on');
      const death=interval(row,'death');
      if(input.occurred_on&&death&&eventTime(input.occurred_on)<death.min)conflict(row,'occurred_on','The stated postmortem event precedes the entire recorded death interval');
    }else liveEvent(row,input.occurred_on,'occurred_on');
  }
  return {sql:'EXISTS(SELECT 1 FROM horses WHERE id=? AND deleted_at IS NULL AND row_version=?)',bindings:[context.horseId,Number(row.row_version)]};
}

/** Check physical roles rather than requiring every genetic parent to remain
 * alive until foaling. Sire death after covering and genetic-dam death after
 * transfer are compatible with later recipient foaling. No fertility or
 * gestation-length model, birth-date imputation or breed policy is invented. */
export function validateReproductiveLifecycles(rows:CareLifecycleRow[],geneticDamId:number,input:ReproductiveEpisodeInput):void {
  const byId=new Map(rows.map(row=>[Number(row.id),row]));
  const dam=byId.get(geneticDamId)!;
  const materials=input.stored_material??[];
  const permitted=(material:StoredReproductiveMaterial)=>{
    if(material.material==='semen')return material.donor_horse_id===input.sire_id&&['artificial_insemination','embryo_transfer','icsi'].includes(input.method);
    return material.donor_horse_id===geneticDamId&&Boolean(input.recipient_dam_id)
      &&(material.material==='oocyte'?input.method==='icsi':['embryo_transfer','icsi'].includes(input.method));
  };
  for(const material of materials){
    if(!permitted(material))throw new HttpError(422,'invalid_stored_material','Stored material must match the genetic donor, reproductive method and recipient role');
    const donor=byId.get(material.donor_horse_id)!;
    noPrebirth(donor,material.collected_on,'stored_material.collected_on');
    const usedOn=material.material==='embryo'?input.transfer_on:input.covering_on;
    if(material.collected_on&&usedOn&&material.collected_on>usedOn)throw new HttpError(422,'invalid_stored_material','Material collection cannot follow its recorded use');
    // Postmortem tissue/gamete recovery is not rejected by a guessed elapsed
    // time limit: its source and justification are explicit professional data.
  }
  if(input.outcome==='cancelled')return; // An administrative cancellation may postdate death.
  const has=(donor:number,material:StoredReproductiveMaterial['material'])=>materials.some(m=>m.donor_horse_id===donor&&m.material===material);
  liveEvent(dam,input.covering_on,'genetic_dam.covering_on',input.method==='icsi'&&has(geneticDamId,'oocyte'));
  if(input.sire_id){const sire=byId.get(input.sire_id)!;liveEvent(sire,input.covering_on,'sire.covering_on',has(input.sire_id,'semen'));}
  if(input.recipient_dam_id){
    const recipient=byId.get(input.recipient_dam_id)!;
    liveEvent(dam,input.transfer_on,'genetic_dam.transfer_on',has(geneticDamId,'embryo')||(input.method==='icsi'&&has(geneticDamId,'oocyte')));
    liveEvent(recipient,input.transfer_on,'recipient.transfer_on');
    liveEvent(recipient,input.outcome_on,'recipient.outcome_on');
  }else liveEvent(dam,input.outcome_on,'genetic_dam.outcome_on');
}
