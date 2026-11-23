import { z } from 'zod';
import { HttpError } from '../api/http';
import { validateGregorianDay } from '../genetics/breedingDates';
import { timestampMillis } from '../security/timestamps';

const uuid = z.string().uuid();
const reference = z.string().trim().min(3).max(240);
const notes = z.string().trim().max(6000).nullable().optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  try { validateGregorianDay(value); return true; } catch { return false; }
}, 'An exact valid Gregorian date is required');
const optionalDay = day.nullable().optional();
const command = {
  operation_id: uuid, reason: z.string().trim().min(8).max(1000),
  // Gate E — same override semantics as the canonical write paths.
  rule_overrides: z.array(z.object({ rule_id: z.string().trim().min(1).max(200), reason: z.string().trim().min(3).max(2000) }).strict()).max(20).optional(),
};
const evidence = { evidence_media_id: uuid.nullable().optional() };
const justification=z.string().trim().min(8).max(1000);
const lifecycleContext=z.object({kind:z.enum(['postmortem','record_review']),evidence_ref:reference,justification}).strict();
const clinical = {
  ...command, ...evidence,
  event_type: z.enum(['examination','vaccination','diagnosis','procedure','medication','allergy','other']),
  occurred_on: optionalDay, title: z.string().trim().min(3).max(240),
  findings: z.string().trim().min(1).max(12000), source_ref: reference,
  product_name: z.string().trim().max(240).nullable().optional(), batch_ref: reference.nullable().optional(), next_due_on: optionalDay,
  lifecycle_context:lifecycleContext.nullable().optional(),
};
function clinicalDates(d: {occurred_on?:string|null;next_due_on?:string|null}) { return !d.next_due_on || !d.occurred_on || d.next_due_on >= d.occurred_on; }
function clinicalContext(d:{event_type:string;lifecycle_context?:{kind:string}|null}):boolean {
  if(!d.lifecycle_context)return true;
  if(['vaccination','medication'].includes(d.event_type))return false;
  return d.lifecycle_context.kind==='record_review'?['diagnosis','allergy','other'].includes(d.event_type):['examination','diagnosis','procedure','other'].includes(d.event_type);
}
export const ClinicalSchema = z.object(clinical).strict().refine(clinicalDates, 'Next due date cannot precede the recorded event').refine(clinicalContext,'The lifecycle context is incompatible with this physical event type');
export const ClinicalAmendSchema = z.object({...clinical, expected_version:z.number().int().positive(),status:z.enum(['recorded','voided'])}).strict().refine(clinicalDates, 'Next due date cannot precede the recorded event').refine(clinicalContext,'The lifecycle context is incompatible with this physical event type');
const storedMaterial=z.object({donor_horse_id:z.number().int().positive(),material:z.enum(['semen','embryo','oocyte']),collected_on:optionalDay,evidence_ref:reference,justification}).strict();
const reproduction = {
  ...command, ...evidence,
  sire_id:z.number().int().positive().nullable().optional(),recipient_dam_id:z.number().int().positive().nullable().optional(),
  method:z.enum(['natural_cover','artificial_insemination','embryo_transfer','icsi','unknown']),
  covering_on:optionalDay,transfer_on:optionalDay,outcome_on:optionalDay,
  outcome:z.enum(['planned','covered','pregnant','not_pregnant','pregnancy_loss','foaled','cancelled']),
  offspring:z.array(z.object({foal_horse_id:z.number().int().positive().nullable().optional(),outcome:z.enum(['live','stillborn','died_after_birth']),sex_at_birth:z.enum(['male','female','unknown']).nullable().optional(),notes}).strict()).max(8),
  source_ref:reference,notes,stored_material:z.array(storedMaterial).max(3).optional(),
};
function reproductionValid(d:z.infer<z.ZodObject<typeof reproduction>>,ctx:z.RefinementCtx) {
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  if(d.recipient_dam_id && !['embryo_transfer','icsi'].includes(d.method)) fail('A recipient dam requires embryo_transfer or icsi');
  if(d.transfer_on && (!d.recipient_dam_id || !['embryo_transfer','icsi'].includes(d.method))) fail('A transfer date requires a recipient dam and a transfer method');
  if(d.covering_on && d.transfer_on && d.transfer_on<d.covering_on) fail('Transfer cannot precede covering or insemination');
  if(d.outcome_on && ((d.covering_on && d.outcome_on<d.covering_on)||(d.transfer_on && d.outcome_on<d.transfer_on))) fail('Outcome cannot precede covering or transfer');
  if(d.outcome==='foaled' && (!d.outcome_on || d.offspring.length===0)) fail('Foaling needs its observed date and at least one offspring outcome');
  if(d.outcome!=='foaled' && d.offspring.length>0) fail('Offspring outcomes can be recorded only with foaled outcome');
  const ids=d.offspring.flatMap(x=>x.foal_horse_id?[x.foal_horse_id]:[]);if(new Set(ids).size!==ids.length) fail('Each registered foal can appear only once');
  const materials=(d.stored_material??[]).map(x=>`${x.donor_horse_id}:${x.material}`);if(new Set(materials).size!==materials.length)fail('A donor and stored material kind may be recorded only once');
}
export const ReproductionSchema=z.object(reproduction).strict().superRefine(reproductionValid);
export const ReproductionAmendSchema=z.object({...reproduction,expected_version:z.number().int().positive()}).strict().superRefine(reproductionValid);
export const SampleSchema=z.object({...command,...evidence,sample_ref:reference,specimen:z.enum(['hair_root','blood','buccal','semen','tissue','other']),collected_on:optionalDay,identity_check:z.enum(['microchip_matched','document_checked','not_checked']),observed_microchip:z.string().trim().min(1).max(80).nullable().optional(),identity_evidence_ref:reference,source_ref:reference,notes}).strict();
export const CustodySchema=z.object({...command,event_type:z.enum(['received','transferred','stored','discarded','correction']),occurred_at:z.string().refine(v=>/(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&timestampMillis(v)!==null,'An explicit UTC or offset timestamp is required'),custodian_ref:reference,source_ref:reference,notes}).strict();
export const BaseColorCallsSchema=z.object({MC1R:z.enum(['E/E','E/e','e/e']),ASIP:z.enum(['A/A','A/a','a/a'])}).strict();
const strCall=z.object({marker:z.string().trim().regex(/^[A-Za-z0-9_-]{2,30}$/),alleles:z.tuple([z.string().trim().regex(/^[A-Za-z0-9.+-]{1,24}$/),z.string().trim().regex(/^[A-Za-z0-9.+-]{1,24}$/)]),quality:z.enum(['pass','uncertain','failed'])}).strict();
export const ReportSchema=z.object({...command,sample_id:uuid,laboratory_ref:reference,accession_ref:reference,report_revision:z.string().trim().min(1).max(80).default('original'),issued_on:day,panel_version:reference,method:reference,evidence_media_id:uuid,evidence_sha256:z.string().regex(/^[a-fA-F0-9]{64}$/).transform(v=>v.toLowerCase()),supersedes_report_id:uuid.nullable().optional(),result:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('base_color'),calls:BaseColorCallsSchema}).strict(),
  z.object({kind:z.literal('str_parentage'),nomenclature:reference,calls:z.array(strCall).min(1).max(64)}).strict().refine(v=>new Set(v.calls.map(c=>c.marker.toUpperCase())).size===v.calls.length,'Marker names must be unique'),
  z.object({kind:z.literal('disease'),calls:z.array(z.object({variant:reference,assay:reference,result:z.string().trim().min(1).max(240)}).strict()).min(1).max(64)}).strict(),
  z.object({kind:z.literal('other'),result_text:z.string().trim().min(1).max(12000)}).strict(),
])}).strict();
export const ReportReviewSchema=z.object({...command,expected_version:z.number().int().positive(),decision:z.enum(['accepted','rejected','withdrawn']),review_ref:reference,identity_checked:z.boolean(),report_authenticity_checked:z.boolean(),scope_checked:z.boolean()}).strict().refine(d=>d.decision!=='accepted'||(d.identity_checked&&d.report_authenticity_checked&&d.scope_checked),'Acceptance requires identity, report authenticity and scope checks');
export function validated<T>(schema:z.ZodType<T>,value:unknown):T {const result=schema.safeParse(value);if(!result.success)throw new HttpError(400,'invalid_care_record','Care record failed validation',result.error.flatten());return result.data;}
export function validateNotFuture(value:string|null|undefined,field:string):void {if(value && value>new Date().toISOString().slice(0,10))throw new HttpError(422,'future_observation',`${field} is an observation and cannot be future dated`);}
